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

/**
 * Everything: a fixed first group, there with two groups or more. It holds
 * every list, and its tab row lists the groups: All, then a tab per group
 * that shows that group's tasks. It has no × and does not move.
 */
export const TODO_EVERYTHING_GROUP_ID = "__everything__";
const GROUP_TAB_PREFIX = "group:";

export const EVERYTHING_GROUP: TodoGroup = {
  id: TODO_EVERYTHING_GROUP_ID,
  name: "Everything",
  colour: null,
  position: -1,
};

export function isEverythingGroup(group: TodoGroup | null | undefined): boolean {
  return group?.id === TODO_EVERYTHING_GROUP_ID;
}

/** Whether Everything is offered: groups on, and two of them or more. */
export function hasEverythingGroup(groupsEnabled: boolean, groupsSorted: TodoGroup[]): boolean {
  return groupsEnabled && groupsSorted.length >= 2;
}

/** The tab in Everything's row that stands for one group. */
export function groupTabId(groupId: string): string {
  return GROUP_TAB_PREFIX + groupId;
}

/** The group a tab of Everything's row stands for, or null for All or a list. */
export function groupOfTab(listId: string | null): string | null {
  return listId?.startsWith(GROUP_TAB_PREFIX) ? listId.slice(GROUP_TAB_PREFIX.length) : null;
}

/** The open group: the one chosen, or the first. None with groups off. */
export function activeGroupOf(
  groupsEnabled: boolean,
  groupsSorted: TodoGroup[],
  currentGroupId: string | null
): TodoGroup | null {
  if (currentGroupId === TODO_EVERYTHING_GROUP_ID && hasEverythingGroup(groupsEnabled, groupsSorted)) {
    return EVERYTHING_GROUP;
  }
  return groupsEnabled
    ? (groupsSorted.find((g) => g.id === currentGroupId) ?? groupsSorted[0] ?? null)
    : null;
}

/**
 * The lists the board shows: the open group's, in a drag's order during
 * one. In Everything, every list, or one group's when its tab is open.
 */
export function listsInScope(
  listsSorted: TodoList[],
  groupsEnabled: boolean,
  activeGroup: TodoGroup | null,
  previewIds: string[] | null,
  currentListId: string | null = null
): TodoList[] {
  if (isEverythingGroup(activeGroup)) {
    const groupId = groupOfTab(currentListId);
    return groupId ? listsSorted.filter((l) => l.groupId === groupId) : listsSorted;
  }
  const scoped =
    groupsEnabled && activeGroup
      ? listsSorted.filter((l) => l.groupId === activeGroup.id)
      : listsSorted;
  return inPreviewOrder(scoped, previewIds);
}

/**
 * The lists a task can be moved to: every list, not only the open group's.
 * The open group's lists come first, then each other group's in group
 * order, then the lists in no group. Each carries the name of its group,
 * so the menu can head the lists of a group that is not the open one.
 * Lists in no group get an empty heading: a line, with no name. With
 * groups off, or in Everything, there are no headings.
 */
export function moveTargetLists(
  listsSorted: TodoList[],
  groupsSorted: TodoGroup[],
  groupsEnabled: boolean,
  activeGroup: TodoGroup | null
): { list: TodoList; heading: string | null }[] {
  if (!groupsEnabled || !activeGroup || isEverythingGroup(activeGroup)) {
    return listsSorted.map((list) => ({ list, heading: null }));
  }
  const others = groupsSorted.filter((g) => g.id !== activeGroup.id);
  const known = new Set(groupsSorted.map((g) => g.id));
  return [
    ...listsSorted
      .filter((l) => l.groupId === activeGroup.id)
      .map((list) => ({ list, heading: null })),
    ...others.flatMap((g) =>
      listsSorted
        .filter((l) => l.groupId === g.id)
        .map((list) => ({ list, heading: g.name }))
    ),
    ...listsSorted
      .filter((l) => !l.groupId || !known.has(l.groupId))
      .map((list) => ({ list, heading: "" })),
  ];
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
