"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import type { TodoApi } from "@/components/todo/use-write-tracking";
import { isOfflineNow } from "@/lib/offline/todo-offline";
import {
  createRemindersTask,
  deleteRemindersTask,
  updateRemindersDue,
  updateRemindersStatus,
  updateRemindersTitle,
} from "@/lib/native-shell";
import { minutesFromTyped } from "@/lib/todo/duration-input";
import { planManualOrder } from "@/lib/todo/board-drop";
import { byPosition, type ColumnOrder, type ColumnSort } from "@/lib/todo/column-sort";
import { describeError } from "@/lib/todo/errors";
import type { TodoView } from "@/lib/todo/list-scope";
import {
  ROW_GLIDE_EASING,
  ROW_SLIDE_MS,
  holdRowsInPlace,
  measureRowBoxes,
} from "@/lib/todo/list-flip";
import {
  landingColumn,
  newClientId,
  newTaskPosition,
  optimisticSteps,
  optimisticTask,
  seededAssignees,
} from "@/lib/todo/optimistic-task";
import {
  queueReordered,
  queueWithAdded,
  queueWithFirst,
  queueWithLast,
  sessionQueueOf,
} from "@/lib/todo/session-queue";
import {
  FLIGHT_GLIDE_EASING,
  FLIGHT_GLIDE_MS,
  FLIGHT_HOLD_MS,
  spawnCompletionParty,
  spawnTaskGhost,
  waitAnimationFrames,
} from "@/lib/todo/task-celebration";
import { EMPTY_TASK_DRAFT, notesHtmlIsEmpty, type TaskDraft } from "@/lib/todo/task-draft";
import { animTargetKey } from "@/lib/todo/task-helpers";
import {
  BOARD_TASK_CHANGED_MESSAGE,
  boardColumnOf,
  boardColumnPatch,
  type TodoBoardColumn,
  type TodoList,
  type TodoPerson,
  type TodoState,
  type TodoTask,
  type TodoTaskPatch,
} from "@/lib/todo/types";

/** The confirm dialog: what it asks, and what a yes does. */
export type ConfirmModalState = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
} | null;

/**
 * How long a task stays marked as the one just added.
 *
 * Long enough to find with the eye after the column has scrolled, short
 * enough to be gone before it reads as a state the task is in.
 */
const JUST_ADDED_MS = 1600;

/**
 * What the page does to a task: the write and its echo to Reminders and
 * the focus windows, the tick with its flight to the Done pile, adding,
 * moving to an end, deleting, and the steps of the Today session.
 */
export function useTaskActions({
  noFlight,
  onTaskCompleted,
  onTaskDeleted,
  api,
  refresh,
  state,
  setState,
  t,
  view,
  lists,
  addTargetList,
  listOfTask,
  listsRef,
  tasksRef,
  openTasks,
  doneTasks,
  boardColumns,
  showBoard,
  isSearching,
  somedayEnabled,
  doneCollapsed,
  assigneeFilterIds,
  assigneeFilterPeople,
  makerKeys,
  pushReminders,
  focusChannelRef,
  registerUndo,
  showUndo,
  setConfirmModal,
  setSessionIds,
  setJustAddedTaskId,
  justAddedTimer,
  setAnimHiddenTargets,
  dropAnimTarget,
  tasksContainerRef,
  doneTasksRef,
  doneHeadingRowRef,
  columnSorts,
  sortColumn,
  pickColumnSort,
}: {
  /** Told when a task is ticked off (the Planner asks for a next step). */
  onTaskCompleted?: (task: TodoTask) => void;
  /** A task was deleted (not a step inside a task). */
  onTaskDeleted?: (task: TodoTask) => void;
  /** No flight to Done: the board is not on screen (an embedded card). */
  noFlight?: boolean;
  api: TodoApi;
  refresh: () => Promise<void>;
  state: TodoState;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  t: (key: string) => string;
  view: TodoView;
  lists: TodoList[];
  addTargetList: TodoList | null | undefined;
  listOfTask: (task: TodoTask) => TodoList | undefined;
  listsRef: React.RefObject<TodoList[]>;
  tasksRef: React.RefObject<TodoTask[]>;
  openTasks: TodoTask[];
  doneTasks: TodoTask[];
  boardColumns: Record<TodoBoardColumn, TodoTask[]>;
  showBoard: boolean;
  isSearching: boolean;
  somedayEnabled: boolean;
  doneCollapsed: boolean;
  assigneeFilterIds: string[];
  assigneeFilterPeople: TodoPerson[];
  makerKeys: string[];
  pushReminders: (fn: () => Promise<unknown>) => void;
  focusChannelRef: React.RefObject<BroadcastChannel | null>;
  registerUndo: (restore: () => void) => void;
  showUndo: (message: string, restore: () => void) => void;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
  setSessionIds: React.Dispatch<React.SetStateAction<string[] | null>>;
  setJustAddedTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  justAddedTimer: React.RefObject<number | null>;
  setAnimHiddenTargets: React.Dispatch<React.SetStateAction<Set<string>>>;
  dropAnimTarget: (key: string) => void;
  tasksContainerRef: React.RefObject<HTMLDivElement | null>;
  doneTasksRef: React.RefObject<HTMLDivElement | null>;
  doneHeadingRowRef: React.RefObject<HTMLDivElement | null>;
  columnSorts: Record<TodoBoardColumn, ColumnOrder>;
  sortColumn: (column: TodoBoardColumn, tasks: TodoTask[]) => TodoTask[];
  pickColumnSort: (column: TodoBoardColumn, sort: ColumnSort) => void;
}) {
  function patchTaskLocal(id: string, patch: Partial<TodoTask>) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }

  async function mutateTask(id: string, patch: TodoTaskPatch) {
    const existing = tasksRef.current.find((t) => t.id === id);
    if (!existing) return;

    patchTaskLocal(id, patch as Partial<TodoTask>);
    try {
      const json = await api("/api/todo/tasks", "PATCH", { id, ...patch });
      const task = json.task as TodoTask;
      patchTaskLocal(id, task);
      /*
        A step ticked, or its people changed: the store may have put people
        on its task or taken them off (settleParentPeople), and only it
        knows who was put on the task by hand. Read the board again.
      */
      if (
        existing.parentTaskId &&
        (patch.completed !== undefined || patch.assigneeIds !== undefined) &&
        !isOfflineNow()
      ) {
        void refresh();
      }
      // A focus window that shows this task must not keep the old text.
      focusChannelRef.current?.postMessage({
        type: BOARD_TASK_CHANGED_MESSAGE,
        taskId: id,
        task,
      });
      /*
        Onto a list Reminders mirrors, from one it does not: the task gets
        its reminder now, the way a task added on that list does.
      */
      const movedOnto =
        patch.listId && task.remindersId == null
          ? listsRef.current.find((l) => l.id === patch.listId)
          : undefined;
      if (movedOnto?.remindersListId && !isOfflineNow()) {
        const remindersListId = movedOnto.remindersListId;
        pushReminders(async () => {
          const reminder = await createRemindersTask(
            remindersListId,
            task.text,
            task.dueOn
          );
          if (reminder.id) {
            await api("/api/todo/tasks", "PATCH", {
              id: task.id,
              remindersId: reminder.id,
            });
            patchTaskLocal(task.id, { remindersId: reminder.id });
          }
        });
      }
      if (
        !isOfflineNow() &&
        task.remindersId &&
        listOfTask(task)?.remindersListId
      ) {
        if (patch.completed !== undefined) {
          pushReminders(() =>
            updateRemindersStatus(task.remindersId as string, task.completed)
          );
        }
        if (patch.text !== undefined) {
          pushReminders(() =>
            updateRemindersTitle(task.remindersId as string, task.text)
          );
        }
        if (patch.dueOn !== undefined) {
          pushReminders(() =>
            updateRemindersDue(task.remindersId as string, task.dueOn)
          );
        }
      }
    } catch (err) {
      toast.error(describeError(err, t("updateFailed")));
      if (!isOfflineNow()) void refresh();
    }
  }

  async function finishTaskFlight(opts: {
    taskId: string;
    toCompleted?: boolean;
    boardColumn?: TodoBoardColumn;
    /** Board column moves use a gentle slide; DONE uses the scale flight. */
    motion?: "slide" | "flight";
    /**
     * How long the card stands ticked before it goes. A tick under the
     * pointer holds briefly; a tick from the focus window holds longer,
     * since the reader's eyes are still on their way over from it.
     */
    holdMs?: number;
    startRect: DOMRect;
    wrap: HTMLElement;
    ghost: HTMLElement;
    /**
     * Lets the other rows go, with the glide the card sets off on. They wait
     * for the card: see holdRowsInPlace.
     */
    releaseRows?: (glide: { durationMs: number; easing: string }) => void;
  }) {
    const {
      taskId,
      toCompleted,
      boardColumn,
      motion = "flight",
      holdMs = FLIGHT_HOLD_MS,
      startRect,
      wrap,
      ghost,
      releaseRows,
    } = opts;
    const animKey = animTargetKey(taskId, Boolean(toCompleted));

    const findTarget = () => {
      if (toCompleted) {
        const landed = doneTasksRef.current?.querySelector(
          `.task-item[data-task-id="${CSS.escape(taskId)}"]`
        ) as HTMLElement | null;
        // React may not have painted the row yet, so wait for a real box.
        if (landed && landed.getBoundingClientRect().height > 0) return landed;
        // Done is shut: the list is display:none and no row will ever have a
        // box there. The task flies to the Done bar and fades into it.
        if (doneCollapsed) return doneHeadingRowRef.current;
        return landed;
      }
      if (boardColumn) {
        return document.querySelector(
          `.todo-shell [data-board-column="${boardColumn}"] .task-item[data-task-id="${CSS.escape(taskId)}"]`
        ) as HTMLElement | null;
      }
      return tasksContainerRef.current?.querySelector(
        `.task-item[data-task-id="${CSS.escape(taskId)}"]`
      ) as HTMLElement | null;
    };

    let targetElement: HTMLElement | null = null;
    for (let i = 0; i < 24; i++) {
      targetElement = findTarget();
      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) break;
      }
      await waitAnimationFrames(1);
    }

    if (!targetElement) {
      releaseRows?.({ durationMs: ROW_SLIDE_MS, easing: ROW_GLIDE_EASING });
      dropAnimTarget(animKey);
      wrap.remove();
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    // Landing on the Done bar, not on a card of its own: the ghost fades out
    // there, and the bar must stay visible to receive it.
    const landsOnCard = targetElement.classList.contains("task-item");
    // Keep the landing card hidden while the ghost slides — must clear after,
    // or React reuse leaves Today/Week cards permanently invisible.
    if (landsOnCard) targetElement.style.visibility = "hidden";

    try {
      const dx = targetRect.left - startRect.left;
      const dy = targetRect.top - startRect.top;

      if (motion === "slide") {
        ghost.style.transition =
          "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";
        await waitAnimationFrames(1);
        releaseRows?.({ durationMs: ROW_SLIDE_MS, easing: ROW_GLIDE_EASING });
        ghost.style.transform = `translate(${dx}px, ${dy}px)`;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 400);
        });
      } else {
        // Translate only — do not scale to the DONE width. Non-uniform
        // scaleX stretches column cards (~1/3 width) into the full-width
        // done list and makes the text look rubbery.
        //
        // The card holds still for a moment first. The tick, the line
        // through the words and the party all land in that moment, and the
        // card leaves after them instead of under them. The curve eases in
        // and out, so the card sets off gently rather than shooting away.
        ghost.style.transition =
          `transform ${FLIGHT_GLIDE_MS}ms ${FLIGHT_GLIDE_EASING},` +
          ` opacity ${FLIGHT_GLIDE_MS}ms ease`;
        await waitAnimationFrames(1);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, holdMs);
        });
        releaseRows?.({
          durationMs: FLIGHT_GLIDE_MS,
          easing: FLIGHT_GLIDE_EASING,
        });
        ghost.style.transform = `translate(${dx}px, ${dy}px)`;
        ghost.style.opacity = landsOnCard ? "0.92" : "0";

        if (toCompleted) {
          // The bar answers as the card reaches it, not as it sets off.
          const heading = document.querySelector(".todo-shell .done-heading");
          window.setTimeout(() => {
            heading?.classList.add("receiving-task");
            window.setTimeout(
              () => heading?.classList.remove("receiving-task"),
              400
            );
          }, FLIGHT_GLIDE_MS - 260);
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, FLIGHT_GLIDE_MS + 40);
        });
      }
    } finally {
      releaseRows?.({ durationMs: ROW_SLIDE_MS, easing: ROW_GLIDE_EASING });
      if (landsOnCard) targetElement.style.visibility = "";
      wrap.remove();
      dropAnimTarget(animKey);
    }
  }

  /** Open the Today session on the column as it stands. */
  function startTodaySession() {
    const queue = sessionQueueOf(boardColumns.today);
    if (queue.length === 0) return;
    setSessionIds(queue);
  }

  /*
    The session's open tasks are the Today column's, in the board's order
    (sessionTasksFromBoard). So what changes the order in the session
    changes it on the board, and the two never disagree.
  */

  /** Take a finished task back up: not done, and first in Today again. */
  function uncompleteSessionTask(task: TodoTask) {
    void mutateTask(task.id, { completed: false });
    moveTaskToEdge(task, "top");
    setSessionIds((ids) => queueWithFirst(ids, task.id));
  }

  /** Skip: the task goes to the end of Today, and the next one runs. */
  function skipSessionTask(task: TodoTask) {
    moveTaskToEdge(task, "bottom");
    setSessionIds((ids) => queueWithLast(ids, task.id));
  }

  /** The session's tasks dragged into a new order: Today takes that order. */
  function reorderSessionTasks(taskIds: string[]) {
    const open = boardColumns.today.filter((task) => !task.completed);
    const moved = taskIds
      .map((id) => open.find((task) => task.id === id))
      .filter((task): task is TodoTask => Boolean(task));
    const order = [...moved, ...open.filter((task) => !taskIds.includes(task.id))];
    for (const write of planManualOrder(order, Date.now())) {
      void mutateTask(write.id, write.patch);
    }
    if (columnSorts.today.sort !== "manual") pickColumnSort("today", "manual");
    setSessionIds((ids) => queueReordered(ids, taskIds));
  }

  /** A task added inside the session joins the end of its queue. */
  async function addSessionTask(text: string, durationMinutes: number | null) {
    const id = await addTask("today", {
      ...EMPTY_TASK_DRAFT,
      text,
      duration: durationMinutes == null ? "" : String(durationMinutes),
    });
    if (id) setSessionIds((ids) => queueWithAdded(ids, id));
  }

  /**
   * Send a task to one end of the run it sits in: its board column, or the
   * favourites list when that view is up. New tasks land at the bottom, so
   * this is the way to either end without a drag.
   */
  function moveTaskToEdge(task: TodoTask, edge: "top" | "bottom") {
    const step = (values: number[]) =>
      edge === "top" ? Math.min(0, ...values) - 1 : Math.max(0, ...values) + 1;
    if (view === "favourites") {
      const peers = state.tasks.filter(
        (t) => t.isFavourite && !t.completed && t.id !== task.id && !t.parentTaskId
      );
      void mutateTask(task.id, {
        favouritePosition: step(peers.map((t) => t.favouritePosition ?? 0)),
      });
      return;
    }
    // Every list, not only this one: the All tab mixes them in one column,
    // and a per-list tab is a subset of that.
    const column = boardColumnOf(task, somedayEnabled);
    const peers = state.tasks.filter(
      (t) =>
        !t.completed &&
        t.id !== task.id &&
        !t.parentTaskId &&
        boardColumnOf(t, somedayEnabled) === column
    );
    if (columnSorts[column].sort === "manual") {
      void mutateTask(task.id, { position: step(peers.map((t) => t.position)) });
      return;
    }
    // A sorted column (due date, name…): the order it shows is kept, with
    // this task at the edge, in as few writes as can do it. The column goes
    // Manual, or the sort would put the task back where it was.
    const shown = sortColumn(column, [...peers].sort(byPosition));
    const order = edge === "top" ? [task, ...shown] : [...shown, task];
    for (const write of planManualOrder(order, Date.now())) {
      void mutateTask(write.id, write.patch);
    }
    pickColumnSort(column, "manual");
  }

  function toggleFavourite(task: TodoTask) {
    // Heart is Favourites-only — independent of Backlog / Soon (-ish) / Today.
    void mutateTask(task.id, { isFavourite: !task.isFavourite });
  }

  function toggleTaskCompleted(
    task: TodoTask,
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const sourceElement = event.currentTarget.closest(
      ".task-item"
    ) as HTMLElement | null;
    completeTaskWithFlight(
      task,
      !task.completed,
      event.currentTarget,
      sourceElement
    );
  }

  /**
   * The tick as the board does it: the box checked, the words struck, the
   * little party, and the card's flight to Done. From the checkbox on the
   * row, and from the focus window's tick, which names the row from the
   * other side of a channel (see the focus channel effect).
   */
  function completeTaskWithFlight(
    task: TodoTask,
    nextCompleted: boolean,
    checkbox: HTMLInputElement | null,
    sourceElement: HTMLElement | null,
    holdMs?: number,
    /** More to write with the tick: the focus window sends its time. */
    extra: TodoTaskPatch = {}
  ) {
    // Ticking a task off is what Cmd+Z takes back, wherever it is done
    // from — a card, the focus window, the Today session.
    if (nextCompleted) {
      registerUndo(() => void mutateTask(task.id, { completed: false }));
      onTaskCompleted?.(task);
    }

    // Favourites / search: no DONE flight target — just toggle. The board
    // and the single list both get the party and the flight.
    if (view === "favourites" || isSearching || !sourceElement || noFlight) {
      void mutateTask(task.id, { ...extra, completed: nextCompleted });
      return;
    }

    // Paint strikethrough / checkbox immediately for the ghost clone.
    sourceElement.classList.toggle("completed-task", nextCompleted);
    const textSpan = sourceElement.querySelector(".task-text");
    textSpan?.classList.toggle("completed", nextCompleted);
    if (checkbox) checkbox.checked = nextCompleted;

    if (nextCompleted && textSpan) {
      textSpan.classList.remove("pre-complete-pop");
      void (textSpan as HTMLElement).offsetWidth;
      textSpan.classList.add("pre-complete-pop");
      spawnCompletionParty(sourceElement);
    }

    // Clone the ghost BEFORE React unmounts the source row on state update.
    const { startRect, wrap, ghost } = spawnTaskGhost(sourceElement);

    // Where every other row is now, in the open list and in Done. The change
    // is drawn at once, so the rows can be held there until the card sets
    // off: the gap it leaves closes behind it, and the rows where it lands
    // make way as it comes.
    const rowLists = [tasksContainerRef.current, doneTasksRef.current];
    const rowsBefore = measureRowBoxes(
      rowLists,
      ".task-item[data-task-id]",
      "data-task-id"
    );

    const completedAt = nextCompleted ? new Date().toISOString() : null;
    flushSync(() => {
      setAnimHiddenTargets((keys) =>
        new Set(keys).add(animTargetKey(task.id, nextCompleted))
      );
      patchTaskLocal(task.id, {
        ...extra,
        completed: nextCompleted,
        completedAt,
      });
    });
    const releaseRows = holdRowsInPlace(
      rowLists,
      rowsBefore,
      ".task-item[data-task-id]",
      "data-task-id",
      { skipId: task.id }
    );

    const boardColumn =
      !nextCompleted && view === "lists" && !isSearching && showBoard
        ? boardColumnOf(task, somedayEnabled)
        : undefined;

    void finishTaskFlight({
      taskId: task.id,
      toCompleted: nextCompleted,
      boardColumn,
      holdMs,
      startRect,
      wrap,
      ghost,
      releaseRows,
    });

    void (async () => {
      try {
        const json = await api("/api/todo/tasks", "PATCH", {
          ...extra,
          id: task.id,
          completed: nextCompleted,
        });
        const updated = json.task as TodoTask;
        patchTaskLocal(task.id, updated);
        if (updated.remindersId && listOfTask(updated)?.remindersListId) {
          pushReminders(() =>
            updateRemindersStatus(
              updated.remindersId as string,
              updated.completed
            )
          );
        }
      } catch (err) {
        toast.error(describeError(err, t("updateFailed")));
        void refresh();
      }
    })();
  }

  /**
   * Bring the task that was just added onto the screen, and say which one it
   * is for a moment.
   *
   * It lands at the foot of its column, which on a full column is past the
   * bottom of the box — so without this the box looks unchanged and the typing
   * looks lost. React has not painted the row when this is called, so the row
   * is waited for rather than looked for once.
   */
  async function revealAddedTask(
    taskId: string,
    column: TodoBoardColumn | null
  ) {
    setJustAddedTaskId(taskId);
    if (justAddedTimer.current) window.clearTimeout(justAddedTimer.current);
    justAddedTimer.current = window.setTimeout(
      () => setJustAddedTaskId(null),
      JUST_ADDED_MS
    );

    const find = () =>
      (column
        ? document.querySelector(
            `.todo-shell [data-board-column="${column}"] .task-item[data-task-id="${CSS.escape(taskId)}"]`
          )
        : tasksContainerRef.current?.querySelector(
            `.task-item[data-task-id="${CSS.escape(taskId)}"]`
          )) as HTMLElement | null;

    for (let i = 0; i < 24; i++) {
      const row = find();
      if (row && row.getBoundingClientRect().height > 0) {
        // "nearest" scrolls the column only as far as it has to, so a board
        // that was already showing the foot of the column does not move.
        row.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      await waitAnimationFrames(1);
    }
  }

  /**
   * Make a task from what an add row holds. The caller clears its own row.
   *
   * The draft's list wins over the tab's: a list picked in the row on the
   * All tab makes a server task, where the tab alone would keep it local.
   */
  async function addTask(
    column: TodoBoardColumn = "week",
    draft: TaskDraft
  ): Promise<string | null> {
    const text = draft.text.trim();
    if (!text) return null;

    const pickedList = draft.listId
      ? (lists.find((l) => l.id === draft.listId) ?? null)
      : null;
    const targetList = pickedList ?? addTargetList;
    // All tab, no list picked: a task on no list, the reader's own.
    const listId = targetList?.id ?? null;

    const expected = minutesFromTyped(draft.duration);
    const draftAssignees = draft.assigneeIds;
    // The add row's note is HTML from the notes editor, pictures and all.
    const notesHtml = notesHtmlIsEmpty(draft.notes) ? null : draft.notes;
    const dueOn = draft.dueOn;
    const landing = landingColumn(column, dueOn);
    const flags = boardColumnPatch(landing);
    const isToday = flags.isToday;
    const isBacklog = flags.isBacklog;
    const isSomeday = flags.isSomeday;
    const tempId = newClientId();
    const seedAssignees = seededAssignees(
      draftAssignees,
      assigneeFilterIds,
      assigneeFilterPeople
    );
    const optimistic = optimisticTask({
      id: tempId,
      listId,
      createdBy: makerKeys[0] ?? null,
      text,
      notesHtml,
      dueOn,
      isBacklog,
      isToday,
      isSomeday,
      assigneeIds: seedAssignees,
      expectedDurationMinutes: expected,
      position: newTaskPosition(openTasks, state.tasks, listId, landing, somedayEnabled),
      createdAt: new Date().toISOString(),
    });
    // The steps go in with the parent, so the card shows them at once.
    const optimisticSubtasks = optimisticSteps(optimistic, draft.subtasks);
    setState((s) => ({
      ...s,
      tasks: [optimistic, ...optimisticSubtasks, ...s.tasks],
    }));
    // Which column to look in is about how the board is laid out, not about
    // which box the words were typed into.
    void revealAddedTask(tempId, showBoard && !isSearching ? landing : null);

    try {
      const json = await api("/api/todo/tasks", "POST", {
        id: tempId,
        listId,
        text,
        notesHtml,
        dueOn,
        expectedDurationMinutes: expected,
        isBacklog,
        isToday,
        isSomeday,
        // Send the seeded people too. Without them the server answer has no
        // assignees, and a filtered board drops the task the user just added.
        assigneeIds: seedAssignees,
      });
      const created = json.task as TodoTask;
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) => (t.id === tempId ? { ...t, ...created } : t)),
      }));
      // Ticked in the add row's day picker. A second write, as the Calendar's
      // own add does: the create does not take the flag. Only a dated task
      // can be on the Calendar.
      if (draft.showOnCalendar && dueOn) {
        await mutateTask(tempId, { showOnCalendar: true });
      }
      // One at a time, in order: the server numbers each step after the
      // last, so a parallel send could land them shuffled.
      for (const subtask of optimisticSubtasks) {
        try {
          const stepJson = await api("/api/todo/tasks", "POST", {
            id: subtask.id,
            listId,
            parentTaskId: tempId,
            text: subtask.text,
            assigneeIds: subtask.assigneeIds,
          });
          const savedStep = stepJson.task as TodoTask | undefined;
          if (savedStep?.id) {
            setState((s) => ({
              ...s,
              tasks: s.tasks.map((t) =>
                t.id === subtask.id ? { ...t, ...savedStep } : t
              ),
            }));
          }
        } catch (err) {
          setState((s) => ({
            ...s,
            tasks: s.tasks.filter((t) => t.id !== subtask.id),
          }));
          toast.error(describeError(err, t("addSubtaskFailed")));
        }
      }
      if (targetList?.remindersListId && !isOfflineNow()) {
        pushReminders(async () => {
          const reminder = await createRemindersTask(
            targetList.remindersListId as string,
            created.text,
            created.dueOn
          );
          if (reminder.id) {
            await api("/api/todo/tasks", "PATCH", {
              id: created.id,
              remindersId: reminder.id,
            });
            patchTaskLocal(created.id, { remindersId: reminder.id });
          }
        });
      }
    } catch (err) {
      toast.error(describeError(err, t("addTaskFailed")));
      setState((s) => ({
        ...s,
        tasks: s.tasks.filter(
          (t) => t.id !== tempId && t.parentTaskId !== tempId
        ),
      }));
      return null;
    }
    return tempId;
  }

  async function recreateTask(task: TodoTask): Promise<void> {
    const json = await api("/api/todo/tasks", "POST", {
      id: task.id.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      )
        ? task.id
        : newClientId(),
      listId: task.listId,
      text: task.text,
      expectedDurationMinutes: task.expectedDurationMinutes,
      isFavourite: task.isFavourite,
      isBacklog: task.isBacklog,
      isToday: task.isToday,
      isSomeday: task.isSomeday,
      assigneeIds: task.assigneeIds,
      ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    });
    const created = json.task as TodoTask;
    const patch: TodoTaskPatch = {};
    if (task.completed) patch.completed = true;
    if (task.notesHtml) patch.notesHtml = task.notesHtml;
    if (task.colour) patch.colour = task.colour;
    if (task.timeSpentSeconds) patch.timeSpentSeconds = task.timeSpentSeconds;
    if (task.position !== undefined) patch.position = task.position;
    if (Object.keys(patch).length) {
      await api("/api/todo/tasks", "PATCH", { id: created.id, ...patch });
    }
  }

  async function removeTask(id: string) {
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));

    try {
      await api(`/api/todo/tasks?id=${encodeURIComponent(id)}`, "DELETE");
      if (!task.parentTaskId) onTaskDeleted?.(task);
      if (task.remindersId && listOfTask(task)?.remindersListId) {
        pushReminders(() => deleteRemindersTask(task.remindersId as string));
      }
      // A step says so: "Task deleted" over a card of steps read as
      // though the whole task had gone.
      showUndo(t(task.parentTaskId ? "subtaskDeleted" : "taskDeleted"), () => {
        void recreateTask(task).then(refresh);
      });
    } catch (err) {
      toast.error(describeError(err, t("deleteFailed")));
      void refresh();
    }
  }

  function clearDone() {
    if (!doneTasks.length) return;
    const snapshot = [...doneTasks];
    setConfirmModal({
      title: t("clearAll"),
      message: t("deleteAllCompleted"),
      confirmLabel: t("delete"),
      danger: true,
      onConfirm: () => {
        const ids = snapshot.map((task) => task.id);
        setState((s) => ({
          ...s,
          tasks: s.tasks.filter((task) => !ids.includes(task.id)),
        }));
        const restore = () => {
          void Promise.all(snapshot.map(recreateTask)).then(refresh);
        };
        void Promise.all(
          ids.map((id) =>
            api(`/api/todo/tasks?id=${encodeURIComponent(id)}`, "DELETE")
          )
        )
          .then(() => showUndo(t("taskDeleted"), restore))
          .catch((err) => {
            toast.error(describeError(err, t("deleteFailed")));
            void refresh();
          });
      },
    });
  }

  return {
    patchTaskLocal,
    mutateTask,
    startTodaySession,
    uncompleteSessionTask,
    skipSessionTask,
    reorderSessionTasks,
    addSessionTask,
    moveTaskToEdge,
    toggleFavourite,
    toggleTaskCompleted,
    completeTaskWithFlight,
    addTask,
    recreateTask,
    removeTask,
    clearDone,
  };
}
