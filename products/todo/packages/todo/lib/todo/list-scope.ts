/**
 * Which lists and tasks the board is showing.
 *
 * The lists in their order, those of the open group when groups are on;
 * the All tab, which exists with two lists or more; and the tasks of the
 * view: the favourites, every list's on All, or one list's. A drag draws
 * its own order until the drop, and these follow it.
 *
 * No React in here, so a test can read it.
 */

import { byPosition } from "./column-sort";
import { TODO_ALL_LIST_ID, type TodoGroup, type TodoList, type TodoTask } from "./types";

/** The board's three views. */
export type TodoView = "lists" | "favourites" | "plan";

/** Lists, groups and people in the order their positions put them. */
export function byPositionOrder<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

/**
 * The items in the order a drag is drawing, or as they are with no drag.
 * An id the drag names that is not among the items is left out.
 */
export function inPreviewOrder<T extends { id: string }>(
  items: T[],
  previewIds: string[] | null
): T[] {
  if (!previewIds) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  return previewIds
    .map((id) => byId.get(id))
    .filter((item): item is T => Boolean(item));
}

/** The open group: the one chosen, or the first. None with groups off. */
export function activeGroupOf(
  groupsEnabled: boolean,
  groupsSorted: TodoGroup[],
  currentGroupId: string | null
): TodoGroup | null {
  return groupsEnabled
    ? (groupsSorted.find((g) => g.id === currentGroupId) ?? groupsSorted[0] ?? null)
    : null;
}

/** The lists with a tab: the open group's, in a drag's order during one. */
export function listsInScope(
  listsSorted: TodoList[],
  groupsEnabled: boolean,
  activeGroup: TodoGroup | null,
  previewIds: string[] | null
): TodoList[] {
  const scoped =
    groupsEnabled && activeGroup
      ? listsSorted.filter((l) => l.groupId === activeGroup.id)
      : listsSorted;
  return inPreviewOrder(scoped, previewIds);
}

/**
 * All, or one list. All is the tab of two lists or more, and it is open
 * when chosen, when nothing is chosen, or when the list chosen is not one
 * of these. With one list, that list is open whatever was chosen.
 */
export function listScopeOf(
  lists: TodoList[],
  currentListId: string | null
): { isAllListsView: boolean; activeList: TodoList | null } {
  // Nothing chosen (null) is one of the lists that are not there.
  const isAllListsView =
    lists.length > 1 &&
    (currentListId === TODO_ALL_LIST_ID ||
      !lists.some((l) => l.id === currentListId));
  const activeList = isAllListsView
    ? null
    : (lists.find((l) => l.id === currentListId) ??
      (lists.length === 1 ? lists[0] : null));
  return { isAllListsView, activeList };
}

/**
 * The tasks of the view. Favourites: every favourite. All: the tasks of
 * the lists with a tab, and the reader's own on no list. One list: its.
 */
export function tasksInView(
  parentTasks: TodoTask[],
  view: TodoView,
  isAllListsView: boolean,
  scopedListIds: Set<string>,
  /** The open list's id, off the All tab; null when none is open. */
  activeListId: string | null
): TodoTask[] {
  return view === "favourites"
    ? parentTasks.filter((t) => t.isFavourite)
    : isAllListsView
      ? parentTasks.filter(
          (t) => t.listId === null || scopedListIds.has(t.listId)
        )
      : activeListId
        ? parentTasks.filter((t) => t.listId === activeListId)
        : [];
}

/** Where a task stands among the favourites: last, when it has no place. */
export const favKey = (t: TodoTask) =>
  t.favouritePosition ?? Number.MAX_SAFE_INTEGER;

/**
 * The open tasks in the drag order: see `byPosition`. Favourites keep their
 * own order first. Each board column puts its own order on top of this.
 */
export function openTasksInOrder(tasksForView: TodoTask[], view: TodoView): TodoTask[] {
  return tasksForView
    .filter((t) => !t.completed)
    .sort(
      view === "favourites"
        ? (a, b) => favKey(a) - favKey(b) || byPosition(a, b)
        : byPosition
    );
}

/** The done tasks, the last finished first. Favourites show none. */
export function doneTasksInOrder(tasksForView: TodoTask[], view: TodoView): TodoTask[] {
  return view === "favourites"
    ? []
    : tasksForView
        .filter((t) => t.completed)
        .sort((a, b) => {
          const timeA = a.completedAt ? Date.parse(a.completedAt) : 0;
          const timeB = b.completedAt ? Date.parse(b.completedAt) : 0;
          return timeB - timeA;
        });
}
