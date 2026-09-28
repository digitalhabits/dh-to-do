/*
 * The focus window's task switcher, as redd-do has it.
 *
 * Browsing: one list at a time, chosen from a row of tabs that say how
 * many open tasks each holds; the focused task's own list first. Searching
 * crosses every list, the hits grouped under their list's name, the
 * focused task's list first and the tasks within a group alphabetical.
 * The port had a flat list of every task and a search over it, which on
 * a board of hundreds was a wall.
 *
 * Moved out of TodoFocusPanel as it stood, so it can be tested without a
 * window.
 */

import {
  boardColumnOf,
  type TodoBoardColumn,
  type TodoList,
  type TodoTask,
} from "./types";

export type FocusSwitcherInput = {
  tasks: TodoTask[];
  lists: TodoList[];
  /** The task in focus here. It is not offered. */
  taskId: string;
  /** Tasks up in another focus window. They are not offered either. */
  focusedElsewhere: Set<string>;
  /** The list of the task in focus, or null. */
  focusedListId: string | null;
  /** The list tab picked in the switcher; null until one is. */
  switchListId: string | null;
  /** What is typed in the switcher's search. */
  switchQuery: string;
  /** The board's view: Board View on, and Someday on. */
  switchBoard: { kanban: boolean; someday: boolean };
  t: (key: string) => string;
};

export function buildFocusSwitcher({
  tasks,
  lists,
  taskId,
  focusedElsewhere,
  focusedListId,
  switchListId,
  switchQuery,
  switchBoard,
  t,
}: FocusSwitcherInput) {
  const openTasks = tasks.filter(
    (candidate) =>
      !candidate.completed &&
      candidate.id !== taskId &&
      !focusedElsewhere.has(candidate.id)
  );
  const switchLists = [...lists]
    .sort((a, b) => a.position - b.position)
    .map((list) => ({
      list,
      tasks: openTasks.filter((candidate) => candidate.listId === list.id),
    }));
  const currentSwitchListId =
    switchListId && switchLists.some((entry) => entry.list.id === switchListId)
      ? switchListId
      : focusedListId && switchLists.some((entry) => entry.list.id === focusedListId)
        ? focusedListId
        : (switchLists[0]?.list.id ?? null);
  const switchNeedle = switchQuery.trim().toLowerCase();
  const byText = (a: TodoTask, b: TodoTask) =>
    (a.text || "").localeCompare(b.text || "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  const switchGroups = switchNeedle
    ? (() => {
        const groups = switchLists
          .map((entry) => ({
            ...entry,
            tasks: entry.tasks
              .filter((candidate) =>
                (candidate.text || "").toLowerCase().includes(switchNeedle)
              )
              .sort(byText),
          }))
          .filter((entry) => entry.tasks.length > 0);
        const currentIdx = groups.findIndex(
          (entry) => entry.list.id === focusedListId
        );
        if (currentIdx > 0) {
          const [current] = groups.splice(currentIdx, 1);
          groups.unshift(current);
        }
        return groups;
      })()
    : null;
  const browsingTasks =
    switchLists.find((entry) => entry.list.id === currentSwitchListId)?.tasks ??
    [];
  /* With the board on, the list reads as the board does: its columns in
     the board's order, each named, empty ones left out. */
  const columnOrder: TodoBoardColumn[] = [
    "today",
    "week",
    "backlog",
    ...(switchBoard.someday ? (["someday"] as const) : []),
  ];
  const columnLabel = (column: TodoBoardColumn) =>
    column === "today"
      ? t("boardToday")
      : column === "week"
        ? t("boardThisWeek")
        : column === "backlog"
          ? t("boardBacklog")
          : t("boardSomeday");
  const browsingColumns = switchBoard.kanban
    ? columnOrder
        .map((column) => ({
          column,
          tasks: browsingTasks.filter(
            (candidate) =>
              boardColumnOf(candidate, switchBoard.someday) === column
          ),
        }))
        .filter((group) => group.tasks.length > 0)
    : null;
  return {
    switchLists,
    currentSwitchListId,
    switchGroups,
    browsingTasks,
    browsingColumns,
    columnLabel,
  };
}
