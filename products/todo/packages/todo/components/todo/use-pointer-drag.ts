"use client";

import * as React from "react";
import { toast } from "sonner";

import type { TodoApi } from "@/components/todo/use-write-tracking";
import { planTaskDrop, positionFromNeighbours } from "@/lib/todo/board-drop";
import { placeInColumn } from "@/lib/todo/board-order";
import { describeError } from "@/lib/todo/errors";
import type { TodoView } from "@/lib/todo/list-scope";
import {
  TODO_ALL_LIST_ID,
  boardColumnOf,
  emptyBoardColumns,
  isTodoBoardColumn,
  type TodoBoardColumn,
  type TodoState,
  type TodoTask,
  type TodoTaskPatch,
} from "@/lib/todo/types";

/** What the page mirrors into liveRef for its window listeners. */
export type LivePage = {
  view: TodoView;
  searchRevealed: boolean;
  searchQuery: string;
  assigneeFilterIds: string[];
  taskPreviewIds: string[] | null;
  listPreviewIds: string[] | null;
  groupPreviewIds: string[] | null;
  personPreviewIds: string[] | null;
  state: TodoState;
  currentListId: string | null;
  currentGroupId: string | null;
  groupsEnabled: boolean;
  somedayEnabled: boolean;
  modalOpen: boolean;
};

/**
 * The pointer drags of the page: a card, a list tab, a group tab and a
 * person pill, with the preview while one is carried. The drags start in
 * the page's rows; the window's listeners here carry them and drop them.
 */
export function useDragState() {
  const [draggingTaskId, setDraggingTaskId] = React.useState<string | null>(null);
  const [draggingListId, setDraggingListId] = React.useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = React.useState<string | null>(null);
  const [draggingPersonId, setDraggingPersonId] = React.useState<string | null>(
    null
  );
  /** While dragging on the board: which column the pointer is over. */
  const [boardDragHover, setBoardDragHover] = React.useState<{
    taskId: string;
    column: TodoBoardColumn;
  } | null>(null);
  const boardDragHoverRef = React.useRef<{
    taskId: string;
    column: TodoBoardColumn;
  } | null>(null);
  /** A drop on a rail must not also expand or collapse that column. */
  const suppressRailClickRef = React.useRef(false);
  const [taskPreviewIds, setTaskPreviewIds] = React.useState<string[] | null>(null);
  /** The list tab a dragged task is over, if any. Dropping there moves it. */
  const [taskDropListId, setTaskDropListId] = React.useState<string | null>(null);
  const taskDropListIdRef = React.useRef<string | null>(null);
  const [listPreviewIds, setListPreviewIds] = React.useState<string[] | null>(null);
  const [groupPreviewIds, setGroupPreviewIds] = React.useState<string[] | null>(null);
  const [personPreviewIds, setPersonPreviewIds] = React.useState<
    string[] | null
  >(null);
  const taskDragRef = React.useRef<{
    taskId: string;
    startX: number;
    startY: number;
    started: boolean;
    /** "touch" or "mouse"/"pen": a finger has to hold before it can drag. */
    pointerType: string;
    /** The hold that turns a still finger into a drag; null once it fired or went. */
    holdTimer: number | null;
  } | null>(null);
  /**
   * While a card is carried near the top or bottom of what scrolls, that
   * scrolls, so a card can go further than the screen shows — the only
   * way on a phone, where there is no wheel to turn mid-drag.
   */
  const dragAutoScrollRef = React.useRef<{ el: HTMLElement; dy: number } | null>(null);
  const dragAutoScrollFrameRef = React.useRef<number | null>(null);
  const tabDragRef = React.useRef<{
    listId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const groupDragRef = React.useRef<{
    groupId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const personDragRef = React.useRef<{
    personId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const tabsRowRef = React.useRef<HTMLDivElement | null>(null);
  const groupsRowRef = React.useRef<HTMLDivElement | null>(null);
  const filterRowRef = React.useRef<HTMLDivElement | null>(null);
  const suppressTabClickUntil = React.useRef(0);
  const suppressGroupClickUntil = React.useRef(0);
  const suppressPersonClickUntil = React.useRef(0);

  return {
    draggingTaskId,
    setDraggingTaskId,
    draggingListId,
    setDraggingListId,
    draggingGroupId,
    setDraggingGroupId,
    draggingPersonId,
    setDraggingPersonId,
    boardDragHover,
    setBoardDragHover,
    boardDragHoverRef,
    suppressRailClickRef,
    taskPreviewIds,
    setTaskPreviewIds,
    taskDropListId,
    setTaskDropListId,
    taskDropListIdRef,
    listPreviewIds,
    setListPreviewIds,
    groupPreviewIds,
    setGroupPreviewIds,
    personPreviewIds,
    setPersonPreviewIds,
    taskDragRef,
    dragAutoScrollRef,
    dragAutoScrollFrameRef,
    tabDragRef,
    groupDragRef,
    personDragRef,
    tabsRowRef,
    groupsRowRef,
    filterRowRef,
    suppressTabClickUntil,
    suppressGroupClickUntil,
    suppressPersonClickUntil,
  };
}

export function isInteractiveDragTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  return Boolean(
    el.closest(
      /* `trix-editor` and a bare `[contenteditable]`, not the Quill classes
         that used to be here and not `[contenteditable="true"]` either:
         Trix does not spell the attribute that way, so selecting words in
         a note read as the start of a card drag and tilted the card. */
      "input, button, a, textarea, select, [contenteditable]," +
        " trix-editor, .trix-notes-bubble, .task-menu, .assign-menu"
    )
  );
}

/**
 * The window's listeners that carry a drag, and the drops: where a card
 * lands, and the new place of a tab, a group or a person.
 */
/**
 * The section a card joins when it is let go in the plain list: its own,
 * when a row next to it is in its own section (a move within it), else
 * the section of the row above it, or of the row below at the top.
 */
export function plainListColumn(
  dragged: TodoTask,
  order: string[],
  live: Pick<LivePage, "state" | "somedayEnabled">
): TodoBoardColumn {
  const own = boardColumnOf(dragged, live.somedayEnabled);
  const at = order.indexOf(dragged.id);
  const near = [order[at - 1], order[at + 1]]
    .map((id) => live.state.tasks.find((t) => t.id === id))
    .filter((t): t is TodoTask => Boolean(t))
    .map((t) => boardColumnOf(t, live.somedayEnabled));
  if (near.length === 0 || near.includes(own)) return own;
  return near[0];
}

export function usePointerDrag({
  drag,
  api,
  refresh,
  setState,
  mutateTask,
  liveRef,
  boardScopeRef,
  tasksContainerRef,
  isManualColumn,
  setManualColumn,
  t,
}: {
  drag: ReturnType<typeof useDragState>;
  api: TodoApi;
  refresh: () => Promise<void>;
  setState: React.Dispatch<React.SetStateAction<TodoState>>;
  mutateTask: (id: string, patch: TodoTaskPatch) => Promise<unknown>;
  liveRef: React.RefObject<LivePage>;
  boardScopeRef: React.RefObject<TodoTask[]>;
  tasksContainerRef: React.RefObject<HTMLDivElement | null>;
  /** The column keeps the order the cards were put in (the "⇅" Manual). */
  isManualColumn: (column: TodoBoardColumn) => boolean;
  /** Put the column on Manual, once a drop gave it an order by hand. */
  setManualColumn: (column: TodoBoardColumn) => void;
  t: (key: string) => string;
}) {
  const {
    setDraggingTaskId,
    setDraggingListId,
    setDraggingGroupId,
    setDraggingPersonId,
    setBoardDragHover,
    boardDragHoverRef,
    suppressRailClickRef,
    setTaskPreviewIds,
    setTaskDropListId,
    taskDropListIdRef,
    setListPreviewIds,
    setGroupPreviewIds,
    setPersonPreviewIds,
    taskDragRef,
    dragAutoScrollRef,
    dragAutoScrollFrameRef,
    tabDragRef,
    groupDragRef,
    personDragRef,
    tabsRowRef,
    groupsRowRef,
    filterRowRef,
    suppressTabClickUntil,
    suppressGroupClickUntil,
    suppressPersonClickUntil,
  } = drag;

  /** The nearest thing above `from` that scrolls and has more to show. */
  function scrollableAbove(from: Element | null): HTMLElement | null {
    let el = from as HTMLElement | null;
    while (el && el !== document.body) {
      const overflow = getComputedStyle(el).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Scroll what a carried card is over when the card is near its edge —
   * or past it: the add row sits over a column's foot, and a finger that
   * has gone below the column still means "further down".
   */
  function steerDragAutoScroll(x: number, y: number) {
    const edge = 56;
    const el =
      scrollableAbove(document.elementFromPoint(x, y)) ??
      scrollableAbove(document.querySelector(".task-item.dragging"));
    let dy = 0;
    if (el) {
      const rect = el.getBoundingClientRect();
      const speed = (factor: number) => Math.ceil(Math.min(1, Math.max(0, factor)) * 14);
      if (y < rect.top + edge) dy = -speed((rect.top + edge - y) / edge);
      else if (y > rect.bottom - edge) dy = speed((y - (rect.bottom - edge)) / edge);
    }
    dragAutoScrollRef.current = el && dy ? { el, dy } : null;
    if (dragAutoScrollRef.current && dragAutoScrollFrameRef.current == null) {
      const step = () => {
        const scroll = dragAutoScrollRef.current;
        if (!scroll || !taskDragRef.current?.started) {
          dragAutoScrollFrameRef.current = null;
          return;
        }
        scroll.el.scrollTop += scroll.dy;
        dragAutoScrollFrameRef.current = requestAnimationFrame(step);
      };
      dragAutoScrollFrameRef.current = requestAnimationFrame(step);
    }
  }

  /**
   * The drop handlers of the newest render, for the listeners below. They
   * are bound once, on mount, and a handler they held from that first
   * render read that render's state: a card dropped on a Reminders-linked
   * tab moved, but no reminder was made, because Reminders read as not
   * connected.
   */
  const finishDragRef = React.useRef({
    finishTaskDrag,
    finishTabDrag,
    finishGroupDrag,
    finishPersonDrag,
  });
  finishDragRef.current = {
    finishTaskDrag,
    finishTabDrag,
    finishGroupDrag,
    finishPersonDrag,
  };

  // Pointer-drag: window-level move/up so drags survive leaving the row.
  React.useEffect(() => {
    /** A card is carried: the preview order, the column or tab under it. */
    const moveTaskDrag = (
      e: PointerEvent,
      taskDrag: NonNullable<typeof taskDragRef.current>
    ) => {
      if (!taskDrag.started) {
        const moved =
          Math.abs(e.clientX - taskDrag.startX) >= 4 ||
          Math.abs(e.clientY - taskDrag.startY) >= 4;
        if (taskDrag.pointerType === "touch") {
          // A finger that moves before the hold is up is scrolling the
          // list, not carrying a card. The hold is called off and the
          // page scrolls as it always did.
          if (
            Math.abs(e.clientX - taskDrag.startX) >= 8 ||
            Math.abs(e.clientY - taskDrag.startY) >= 8
          ) {
            if (taskDrag.holdTimer != null) window.clearTimeout(taskDrag.holdTimer);
            taskDragRef.current = null;
          }
          return;
        }
        if (!moved) return;
        taskDrag.started = true;
        setDraggingTaskId(taskDrag.taskId);
      }
      e.preventDefault();
      const container = tasksContainerRef.current;
      if (!container) return;
      steerDragAutoScroll(e.clientX, e.clientY);
      const live = liveRef.current;
      const dragged = live.state.tasks.find((t) => t.id === taskDrag.taskId);
      // A search hides rows; it does not stop the board being a board.
      // Where the task belongs in the column it cannot see is worked out
      // by placeInColumn.
      const boardMode = live.view === "lists" && dragged;

      // A tab under the pointer means another list, not another place in
      // this one. Take the drop there and leave the order alone.
      const tabUnder = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>(".tab[data-list-id]");
      const dropListId = tabUnder?.dataset.listId;
      const overTab =
        dropListId &&
        dropListId !== TODO_ALL_LIST_ID &&
        dragged &&
        dropListId !== dragged.listId
          ? dropListId
          : null;
      if (taskDropListIdRef.current !== overTab) {
        taskDropListIdRef.current = overTab;
        setTaskDropListId(overTab);
      }
      if (overTab) {
        boardDragHoverRef.current = null;
        setBoardDragHover(null);
        setTaskPreviewIds(null);
        return;
      }

      /*
        Board View off, the list is one column that holds every section
        (Today, then the week, then the Backlog). Its rows are the
        container's own, and a card joins the section of the rows it is
        let go by (see plainListColumn).
      */
      const plainList = Boolean(
        boardMode &&
          dragged &&
          !dragged.completed &&
          !container.querySelector("[data-board-column]")
      );
      let column: TodoBoardColumn | null = null;
      if (boardMode && dragged && !plainList) {
        const under = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-board-column]");
        const hoverAttr = under?.dataset.boardColumn;
        column = isTodoBoardColumn(hoverAttr)
          ? hoverAttr
          : boardColumnOf(dragged, live.somedayEnabled);
        const hover = { taskId: taskDrag.taskId, column };
        boardDragHoverRef.current = hover;
        setBoardDragHover((prev) =>
          prev?.taskId === hover.taskId && prev.column === hover.column
            ? prev
            : hover
        );
      } else if (!plainList) {
        boardDragHoverRef.current = null;
        setBoardDragHover(null);
      }

      const scope =
        column != null
          ? container.querySelector<HTMLElement>(
              `[data-board-column="${column}"] .board-column-tasks`
            )
          : container;
      if (!scope) return;
      const rows = Array.from(
        scope.querySelectorAll<HTMLElement>(":scope > .task-item")
      ).filter((el) => el.dataset.taskId !== taskDrag.taskId);
      let index = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }
      const colIds = rows
        .map((el) => el.dataset.taskId)
        .filter((id): id is string => Boolean(id));
      colIds.splice(index, 0, taskDrag.taskId);

      if (plainList && dragged) {
        const hover = {
          taskId: taskDrag.taskId,
          column: plainListColumn(dragged, colIds, live),
        };
        boardDragHoverRef.current = hover;
        setBoardDragHover((prev) =>
          prev?.taskId === hover.taskId && prev.column === hover.column
            ? prev
            : hover
        );
      }

      let ids = colIds;
      if (column != null && dragged) {
        // What the board is drawing, in its order — see boardScopeRef.
        const open = boardScopeRef.current;
        const byCol = emptyBoardColumns<string>();
        for (const t of open) {
          if (t.id === taskDrag.taskId) continue;
          byCol[boardColumnOf(t, live.somedayEnabled)].push(t.id);
        }
        byCol[column] = placeInColumn(byCol[column], colIds, taskDrag.taskId);
        ids = [
          ...byCol.someday,
          ...byCol.backlog,
          ...byCol.week,
          ...byCol.today,
        ];
      }

      setTaskPreviewIds((prev) =>
        prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
          ? prev
          : ids
      );
    };

    /** A list tab is carried along its row. */
    const moveTabDrag = (
      e: PointerEvent,
      tabDrag: NonNullable<typeof tabDragRef.current>
    ) => {
      if (!tabDrag.started) {
        if (
          Math.abs(e.clientX - tabDrag.startX) < 4 &&
          Math.abs(e.clientY - tabDrag.startY) < 4
        )
          return;
        tabDrag.started = true;
        setDraggingListId(tabDrag.listId);
      }
      e.preventDefault();
      const row = tabsRowRef.current;
      if (!row) return;
      const tabEls = Array.from(
        row.querySelectorAll<HTMLElement>(".tab")
      ).filter(
        (el) =>
          el.dataset.listId &&
          el.dataset.listId !== TODO_ALL_LIST_ID &&
          el.dataset.listId !== tabDrag.listId
      );
      let index = tabEls.length;
      for (let i = 0; i < tabEls.length; i++) {
        const rect = tabEls[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
      const ids = tabEls
        .map((el) => el.dataset.listId)
        .filter((id): id is string => Boolean(id));
      ids.splice(index, 0, tabDrag.listId);
      setListPreviewIds((prev) =>
        prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
          ? prev
          : ids
      );
    };

    /** A group tab is carried along its row. */
    const moveGroupDrag = (
      e: PointerEvent,
      groupDrag: NonNullable<typeof groupDragRef.current>
    ) => {
      if (!groupDrag.started) {
        if (
          Math.abs(e.clientX - groupDrag.startX) < 4 &&
          Math.abs(e.clientY - groupDrag.startY) < 4
        )
          return;
        groupDrag.started = true;
        setDraggingGroupId(groupDrag.groupId);
      }
      e.preventDefault();
      const row = groupsRowRef.current;
      if (!row) return;
      const groupEls = Array.from(
        row.querySelectorAll<HTMLElement>(".group-tab")
      ).filter((el) => el.dataset.groupId !== groupDrag.groupId);
      let index = groupEls.length;
      for (let i = 0; i < groupEls.length; i++) {
        const rect = groupEls[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
      const ids = groupEls
        .map((el) => el.dataset.groupId)
        .filter((id): id is string => Boolean(id));
      ids.splice(index, 0, groupDrag.groupId);
      setGroupPreviewIds((prev) =>
        prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
          ? prev
          : ids
      );
    };

    /** A person chip is carried along the filter row. */
    const movePersonDrag = (
      e: PointerEvent,
      personDrag: NonNullable<typeof personDragRef.current>
    ) => {
      if (!personDrag.started) {
        if (
          Math.abs(e.clientX - personDrag.startX) < 4 &&
          Math.abs(e.clientY - personDrag.startY) < 4
        )
          return;
        personDrag.started = true;
        setDraggingPersonId(personDrag.personId);
      }
      e.preventDefault();
      const row = filterRowRef.current;
      if (!row) return;
      // Everyone carries no person id, so it is never a place to drop and
      // never moves: the chips order behind it.
      const chipEls = Array.from(
        row.querySelectorAll<HTMLElement>("[data-person-id]")
      ).filter((el) => el.dataset.personId !== personDrag.personId);
      let index = chipEls.length;
      for (let i = 0; i < chipEls.length; i++) {
        const rect = chipEls[i].getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          index = i;
          break;
        }
      }
      const ids = chipEls
        .map((el) => el.dataset.personId)
        .filter((id): id is string => Boolean(id));
      ids.splice(index, 0, personDrag.personId);
      setPersonPreviewIds((prev) =>
        prev && prev.length === ids.length && prev.every((v, i) => v === ids[i])
          ? prev
          : ids
      );
    };

    const onPointerMove = (e: PointerEvent) => {
      const taskDrag = taskDragRef.current;
      if (taskDrag) {
        moveTaskDrag(e, taskDrag);
        return;
      }

      const tabDrag = tabDragRef.current;
      if (tabDrag) {
        moveTabDrag(e, tabDrag);
        return;
      }

      const groupDrag = groupDragRef.current;
      if (groupDrag) {
        moveGroupDrag(e, groupDrag);
        return;
      }

      const personDrag = personDragRef.current;
      if (personDrag) {
        movePersonDrag(e, personDrag);
      }
    };

    const onPointerUp = () => {
      const taskDrag = taskDragRef.current;
      taskDragRef.current = null;
      if (taskDrag?.holdTimer != null) window.clearTimeout(taskDrag.holdTimer);
      dragAutoScrollRef.current = null;
      const tabDrag = tabDragRef.current;
      tabDragRef.current = null;
      const groupDrag = groupDragRef.current;
      groupDragRef.current = null;
      const personDrag = personDragRef.current;
      personDragRef.current = null;
      const finish = finishDragRef.current;
      if (taskDrag?.started) {
        finish.finishTaskDrag(taskDrag.taskId);
      } else if (taskDrag) {
        boardDragHoverRef.current = null;
        setBoardDragHover(null);
      }
      if (tabDrag?.started) {
        suppressTabClickUntil.current = Date.now() + 250;
        finish.finishTabDrag(tabDrag.listId);
      }
      if (groupDrag?.started) {
        suppressGroupClickUntil.current = Date.now() + 250;
        finish.finishGroupDrag(groupDrag.groupId);
      }
      if (personDrag?.started) {
        suppressPersonClickUntil.current = Date.now() + 250;
        finish.finishPersonDrag(personDrag.personId);
      }
    };

    // Once a card is carried, the finger's movement is the card's, not the
    // page's. Only a listener that is not passive can say so; React's are.
    const onTouchMove = (e: TouchEvent) => {
      if (taskDragRef.current?.started && e.cancelable) e.preventDefault();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("touchmove", onTouchMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finishTaskDrag(taskId: string) {
    const {
      taskPreviewIds: ids,
      view: liveView,
      state: liveState,
      somedayEnabled: liveSomeday,
    } = liveRef.current;
    const hover = boardDragHoverRef.current;
    const dropListId = taskDropListIdRef.current;
    if (hover) suppressRailClickRef.current = true;
    boardDragHoverRef.current = null;
    taskDropListIdRef.current = null;
    setBoardDragHover(null);
    setTaskDropListId(null);
    setDraggingTaskId(null);
    setTaskPreviewIds(null);

    // The column it lands in. When that column is sorted (due date, name…)
    // the drop writes the order the drag drew. A task moved inside its own
    // column then puts the column on Manual. A task from another column
    // leaves the sort alone: the sort puts it in place, and only where the
    // sort has nothing to go by (no due date) does the drawn order count.
    const dragged = liveState.tasks.find((task) => task.id === taskId);
    const column =
      hover?.taskId === taskId
        ? hover.column
        : dragged
          ? boardColumnOf(dragged, liveSomeday)
          : null;
    const sortedColumn =
      liveView === "lists" && column !== null && !isManualColumn(column);
    // Put back where it was picked up: the column keeps its sort. Only the
    // column's own rows are compared, as the list draws a section at a time.
    const inColumn = (task: TodoTask) =>
      ids?.includes(task.id) && boardColumnOf(task, liveSomeday) === column;
    const shown = boardScopeRef.current.filter(inColumn).map((task) => task.id);
    const drawn = ids?.filter((id) => shown.includes(id)) ?? [];
    const unmoved =
      ids !== null &&
      dragged !== undefined &&
      column === boardColumnOf(dragged, liveSomeday) &&
      drawn.length === shown.length &&
      drawn.every((id, i) => id === shown[i]);
    if (sortedColumn && unmoved) return;
    const writes = planTaskDrop({
      taskId,
      previewIds: ids,
      hover,
      dropListId,
      view: liveView,
      tasks: liveState.tasks,
      somedayEnabled: liveSomeday,
      now: Date.now(),
      sortedColumn,
    });
    for (const write of writes) void mutateTask(write.id, write.patch);
    const fromOtherColumn =
      dragged !== undefined && column !== boardColumnOf(dragged, liveSomeday);
    if (sortedColumn && !fromOtherColumn && writes.some((write) => "position" in write.patch)) {
      setManualColumn(column);
    }
  }

  function finishTabDrag(listId: string) {
    const { listPreviewIds: ids, state: liveState } = liveRef.current;
    setDraggingListId(null);
    setListPreviewIds(null);
    if (!ids) return;
    const position = positionFromNeighbours(ids, listId, liveState.lists);
    if (position === null) return;
    setState((s) => ({
      ...s,
      lists: s.lists.map((l) => (l.id === listId ? { ...l, position } : l)),
    }));
    void api("/api/todo/lists", "PATCH", { id: listId, position }).catch(
      (err) => {
        toast.error(describeError(err, t("reorderFailed")));
        void refresh();
      }
    );
  }

  function finishGroupDrag(groupId: string) {
    const { groupPreviewIds: ids, state: liveState } = liveRef.current;
    setDraggingGroupId(null);
    setGroupPreviewIds(null);
    if (!ids) return;
    const position = positionFromNeighbours(ids, groupId, liveState.groups);
    if (position === null) return;
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, position } : g)),
    }));
    void api("/api/todo/groups", "PATCH", { id: groupId, position }).catch(
      (err) => {
        toast.error(describeError(err, t("reorderFailed")));
        void refresh();
      }
    );
  }

  /**
   * Writes where a dragged filter chip was let go.
   *
   * The chips show only the people with a task on this list, so the two the
   * chip landed between can have others sitting between them on the roster.
   * A position halfway between the two neighbours puts the person where the
   * user dropped them relative to the chips they can see, which is the order
   * they were arranging.
   */
  function finishPersonDrag(personId: string) {
    const { personPreviewIds: ids, state: liveState } = liveRef.current;
    setDraggingPersonId(null);
    setPersonPreviewIds(null);
    if (!ids) return;
    const position = positionFromNeighbours(ids, personId, liveState.people);
    if (position === null) return;
    setState((s) => ({
      ...s,
      people: s.people.map((person) =>
        person.id === personId ? { ...person, position } : person
      ),
    }));
    void api("/api/todo/people", "PATCH", { id: personId, position }).catch(
      (err) => {
        toast.error(describeError(err, t("reorderFailed")));
        void refresh();
      }
    );
  }

}
