"use client";

import * as React from "react";
import { toast } from "sonner";

import type { TodoApi } from "@/components/todo/use-write-tracking";
import { placeByPosition } from "@/lib/todo/board-order";
import { describeError } from "@/lib/todo/errors";
import {
  ROW_SLIDE_HOLD_MS,
  measureRowTops,
  slideRowsIntoPlace,
} from "@/lib/todo/list-flip";
import { newClientId, nextStepPosition, optimisticTask } from "@/lib/todo/optimistic-task";
import { notesHtmlIsEmpty } from "@/lib/todo/task-draft";
import type { TodoState, TodoTask, TodoTaskPatch } from "@/lib/todo/types";

/**
 * A task's subtasks in the big card: grouped from the board's tasks,
 * added, their notes and durations, the row being written, and the drag
 * that orders them, with the slide of a ticked step to the pile.
 */
export function useSubtasks({
  state,
  setState,
  api,
  makerKeys,
  mutateTask,
  openNotesTaskId,
  notesExpanded,
  focusSubtaskOnOpenRef,
  t,
}: {
  state: TodoState;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  api: TodoApi;
  makerKeys: string[];
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
  openNotesTaskId: string | null;
  notesExpanded: boolean;
  /** Set by openTaskOverlay when a card's subtask button opened the card. */
  focusSubtaskOnOpenRef?: React.MutableRefObject<boolean>;
  t: (key: string) => string;
}) {
  /**
   * A task's subtasks are its child tasks, grouped from the one state the
   * board holds. The work first, the done pile under it, each in position
   * order — and a tick sends the row to the top of the pile (the check
   * button moves its position there).
   */
  const subtasksByTask = React.useMemo(() => {
    const map = new Map<string, TodoTask[]>();
    for (const task of state.tasks) {
      if (!task.parentTaskId) continue;
      const list = map.get(task.parentTaskId);
      if (list) list.push(task);
      else map.set(task.parentTaskId, [task]);
    }
    for (const list of map.values()) {
      list.sort((a, b) =>
        a.completed !== b.completed
          ? (a.completed ? 1 : -1)
          : a.position - b.position
      );
    }
    return map;
  }, [state.tasks]);

  /**
   * A step ticked or unticked. A tick puts the step at the top of its
   * task's done pile: the freshest tick reads first, as on the board.
   */
  function toggleSubtaskDone(subtask: TodoTask) {
    const completing = !subtask.completed;
    const patch: TodoTaskPatch = { completed: completing };
    if (completing && subtask.parentTaskId) {
      const done = (subtasksByTask.get(subtask.parentTaskId) ?? []).filter(
        (st) => st.completed && st.id !== subtask.id
      );
      if (done.length) {
        const top = Math.min(...done.map((st) => st.position));
        if (subtask.position >= top) patch.position = top - 1;
      }
    }
    void mutateTask(subtask.id, patch);
  }

  /**
   * A subtask is a full task, so its edits are `mutateTask` and its delete
   * is `removeTask` — the same optimistic paths, undo included. Only the
   * create differs: the new row carries its parent.
   */
  async function addSubtask(
    parent: TodoTask,
    text: string,
    extras: {
      assigneeIds?: string[];
      notesHtml?: string | null;
      expectedDurationMinutes?: number | null;
    } = {}
  ) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = newClientId();
    const siblings = subtasksByTask.get(parent.id) ?? [];
    const now = new Date().toISOString();
    const optimistic = optimisticTask({
      id,
      listId: parent.listId,
      createdBy: makerKeys[0] ?? null,
      text: trimmed,
      notesHtml: extras.notesHtml ?? null,
      assigneeIds: extras.assigneeIds ?? [],
      expectedDurationMinutes: extras.expectedDurationMinutes ?? null,
      position: nextStepPosition(siblings),
      parentTaskId: parent.id,
      createdAt: now,
    });
    setState((s) => ({ ...s, tasks: [...s.tasks, optimistic] }));
    try {
      const json = await api("/api/todo/tasks", "POST", {
        id,
        listId: parent.listId,
        parentTaskId: parent.id,
        text: trimmed,
        ...(extras.assigneeIds?.length ? { assigneeIds: extras.assigneeIds } : {}),
        ...(extras.notesHtml ? { notesHtml: extras.notesHtml } : {}),
        ...(extras.expectedDurationMinutes != null
          ? { expectedDurationMinutes: extras.expectedDurationMinutes }
          : {}),
      });
      const saved = json.task as TodoTask | undefined;
      if (saved?.id) {
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...saved } : t)),
        }));
      }
    } catch (err) {
      setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
      toast.error(describeError(err, t("addSubtaskFailed")));
    }
  }

  /**
   * The subtask whose note is open in the expanded card, and its draft.
   *
   * Its own pair, not the board's `openNotesTaskId`: the expanded card's
   * Notes field is already bound to that machinery for the parent, and one
   * slot cannot hold two drafts.
   */
  const [subtaskNotesId, setSubtaskNotesId] = React.useState<string | null>(null);
  const [subtaskNotesDraft, setSubtaskNotesDraft] = React.useState("");
  /** The subtask whose duration box is open. */
  const [subtaskDurEditId, setSubtaskDurEditId] = React.useState<string | null>(null);

  /** The subtask being written in the expanded card: its words, and what it will carry. */
  const [newSubtaskText, setNewSubtaskText] = React.useState("");
  const [newSubtaskAssigneeIds, setNewSubtaskAssigneeIds] = React.useState<string[]>([]);
  const [newSubtaskNotes, setNewSubtaskNotes] = React.useState("");
  const [newSubtaskNotesOpen, setNewSubtaskNotesOpen] = React.useState(false);
  const [newSubtaskDuration, setNewSubtaskDuration] = React.useState<number | null>(null);
  const [newSubtaskDurEditing, setNewSubtaskDurEditing] = React.useState(false);
  const newSubtaskInputRef = React.useRef<HTMLInputElement | null>(null);
  /* Opened from a card's subtask button: the caret goes to "Add a subtask",
     after the card has drawn.

     A task with notes has a notes editor in the card. It loads a moment
     later and then takes the caret itself (its autoFocus, on
     "trix-initialize"), so the caret is given back once that happens. After
     2s the card is the reader's: a later click into the notes keeps it. */
  React.useEffect(() => {
    if (!notesExpanded || !focusSubtaskOnOpenRef?.current) return;
    focusSubtaskOnOpenRef.current = false;
    const focusInput = () => {
      const input = newSubtaskInputRef.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.scrollIntoView({ block: "nearest" });
    };
    const frames: number[] = [requestAnimationFrame(focusInput)];
    const onEditorReady = () => frames.push(requestAnimationFrame(focusInput));
    document.addEventListener("trix-initialize", onEditorReady);
    const stop = window.setTimeout(
      () => document.removeEventListener("trix-initialize", onEditorReady),
      2000
    );
    return () => {
      frames.forEach(cancelAnimationFrame);
      document.removeEventListener("trix-initialize", onEditorReady);
      window.clearTimeout(stop);
    };
  }, [notesExpanded, openNotesTaskId, focusSubtaskOnOpenRef]);

  function resetNewSubtask() {
    setNewSubtaskText("");
    setNewSubtaskAssigneeIds([]);
    setNewSubtaskNotes("");
    setNewSubtaskNotesOpen(false);
    setNewSubtaskDuration(null);
    setNewSubtaskDurEditing(false);
  }

  // A draft belongs to the card it was typed in.
  React.useEffect(() => {
    resetNewSubtask();
  }, [openNotesTaskId]);

  function submitNewSubtask(parent: TodoTask) {
    if (!newSubtaskText.trim()) return;
    void addSubtask(parent, newSubtaskText, {
      assigneeIds: newSubtaskAssigneeIds,
      notesHtml: notesHtmlIsEmpty(newSubtaskNotes) ? null : newSubtaskNotes,
      expectedDurationMinutes: newSubtaskDuration,
    });
    resetNewSubtask();
    newSubtaskInputRef.current?.focus();
  }

  function saveSubtaskNotes(subtask: TodoTask) {
    const html = subtaskNotesDraft;
    const isEmpty = !html || html === "<p><br></p>";
    setSubtaskNotesId(null);
    setSubtaskNotesDraft("");
    const next = isEmpty ? null : html;
    if (next !== subtask.notesHtml) {
      void mutateTask(subtask.id, { notesHtml: next });
    }
  }

  /** The subtask being carried, and the order the pointer is drawing. */
  const [subtaskDragId, setSubtaskDragId] = React.useState<string | null>(null);
  const [subtaskPreview, setSubtaskPreview] = React.useState<string[] | null>(null);
  const subtaskListRef = React.useRef<HTMLDivElement | null>(null);

  /*
    A step ticked off sorts to the pile at the bottom. It slides there,
    after a beat in which the tick is seen to land, and the steps it
    passes make way: the rows' places are kept from one order to the next
    and the change is drawn as a move. Not while a row is being carried —
    the pointer is drawing that order, and it should follow the hand.
  */
  const subtaskTopsRef = React.useRef<Map<string, number>>(new Map());
  const subtaskHoldRef = React.useRef(false);
  const overlaySubtaskOrder = React.useMemo(() => {
    if (!openNotesTaskId || !notesExpanded) return "";
    const mine = subtasksByTask.get(openNotesTaskId) ?? [];
    return (subtaskPreview ?? mine.map((st) => st.id)).join("|");
  }, [openNotesTaskId, notesExpanded, subtasksByTask, subtaskPreview]);
  React.useLayoutEffect(() => {
    const list = subtaskListRef.current;
    // Only the steps: the add row carries no id and holds no place.
    const rows = ":scope > .task-subtask-row[data-subtask-id]";
    if (!list || subtaskDragId) {
      subtaskTopsRef.current = measureRowTops(list, rows, "data-subtask-id");
      subtaskHoldRef.current = false;
      return;
    }
    subtaskTopsRef.current = slideRowsIntoPlace(list, subtaskTopsRef.current, rows, "data-subtask-id", {
      holdMs: subtaskHoldRef.current ? ROW_SLIDE_HOLD_MS : 0,
    });
    subtaskHoldRef.current = false;
  }, [overlaySubtaskOrder, subtaskDragId]);

  /**
   * Put one subtask where it was dropped.
   *
   * One write nearly always: the moved row takes the midpoint between its
   * new neighbours. Only when the floats leave no room between them is the
   * whole list renumbered — and order is local either way, because Basecamp
   * has no route for a step's position.
   */
  function reorderSubtasks(taskId: string, order: string[], movedId: string) {
    const rows = subtasksByTask.get(taskId) ?? [];
    const writes = placeByPosition(rows, order, movedId);
    if (!writes) return;
    // Each write is an ordinary task mutation — optimistic, queued offline —
    // and the grouped sort draws the new order from the positions.
    for (const write of writes) {
      void mutateTask(write.id, { position: write.position });
    }
  }

  /** The grip's pointer-drag: the session queue's, on smaller rows. */
  function startSubtaskDrag(
    event: React.PointerEvent,
    taskId: string,
    subtaskId: string
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let lastOrder: string[] | null = null;

    const onMove = (move: PointerEvent) => {
      if (!started) {
        if (
          Math.abs(move.clientX - startX) < 4 &&
          Math.abs(move.clientY - startY) < 4
        ) {
          return;
        }
        started = true;
        window.getSelection()?.removeAllRanges();
        setSubtaskDragId(subtaskId);
      }
      const rows = Array.from(
        subtaskListRef.current?.querySelectorAll<HTMLElement>(
          ":scope > .task-subtask-row[data-subtask-id]"
        ) ?? []
      ).filter((row) => row.dataset.subtaskId !== subtaskId);
      let index = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        if (move.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      const order = rows
        .map((row) => row.dataset.subtaskId)
        .filter((id): id is string => Boolean(id));
      order.splice(index, 0, subtaskId);
      lastOrder = order;
      setSubtaskPreview((prevOrder) =>
        prevOrder &&
        prevOrder.length === order.length &&
        prevOrder.every((v, i) => v === order[i])
          ? prevOrder
          : order
      );
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setSubtaskDragId(null);
      setSubtaskPreview(null);
      if (started && lastOrder) reorderSubtasks(taskId, lastOrder, subtaskId);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  return {
    subtasksByTask,
    toggleSubtaskDone,
    addSubtask,
    subtaskNotesId,
    setSubtaskNotesId,
    subtaskNotesDraft,
    setSubtaskNotesDraft,
    subtaskDurEditId,
    setSubtaskDurEditId,
    newSubtaskText,
    setNewSubtaskText,
    newSubtaskAssigneeIds,
    setNewSubtaskAssigneeIds,
    newSubtaskNotes,
    setNewSubtaskNotes,
    newSubtaskNotesOpen,
    setNewSubtaskNotesOpen,
    newSubtaskDuration,
    setNewSubtaskDuration,
    newSubtaskDurEditing,
    setNewSubtaskDurEditing,
    newSubtaskInputRef,
    submitNewSubtask,
    saveSubtaskNotes,
    subtaskDragId,
    subtaskPreview,
    subtaskListRef,
    subtaskHoldRef,
    startSubtaskDrag,
  };
}
