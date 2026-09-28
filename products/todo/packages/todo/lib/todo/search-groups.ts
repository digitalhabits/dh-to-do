/**
 * The search: open tasks whose words hold the query, grouped per list, the
 * preferred list first — as redd-do's getListSearchGroups did. On the lists
 * view the board stays up and the open tasks are filtered in place; on
 * Favourites one group shows at a time, picked by the hit chips.
 *
 * No React in here, so a test can read it.
 */

import { byPosition } from "./column-sort";
import { inPreviewOrder, type TodoView } from "./list-scope";
import type { TodoList, TodoTask } from "./types";

export type SearchGroup = { list: TodoList; tasks: TodoTask[] };

/** The query as it is matched: no space at either end, small letters. */
export function searchQueryOf(raw: string): string {
  return raw.trim().toLowerCase();
}

function matches(task: TodoTask, query: string): boolean {
  return (task.text || "").toLowerCase().includes(query);
}

/** The open hits of each list, in the drag order; the preferred list first. */
export function searchGroupsOf(
  listsSorted: TodoList[],
  tasks: TodoTask[],
  query: string,
  preferredId: string | null
): SearchGroup[] {
  const groups = listsSorted
    .map((list) => ({
      list,
      tasks: tasks
        .filter(
          (t) =>
            t.listId === list.id &&
            !t.completed &&
            matches(t, query)
        )
        .sort(byPosition),
    }))
    .filter((g) => g.tasks.length > 0);
  const idx = groups.findIndex((g) => g.list.id === preferredId);
  if (idx > 0) {
    const [preferred] = groups.splice(idx, 1);
    groups.unshift(preferred);
  }
  return groups;
}

/** The group the chips have picked, or the first. */
export function selectedSearchGroupOf(
  groups: SearchGroup[],
  searchListId: string | null
): SearchGroup | null {
  return groups.find((g) => g.list.id === searchListId) ?? groups[0] ?? null;
}

/** The hits on the other lists, for the chips that go there. */
export function otherListHits(groups: SearchGroup[], activeListId: string): SearchGroup[] {
  return groups.filter((g) => g.list.id !== activeListId);
}

/**
 * The open tasks the view shows.
 *
 * Lists view keeps the board: the current tab's open tasks, filtered in
 * place. A drag may be under way — the board can be dragged while
 * filtering — so the rows that show follow the preview like any others.
 * Favourites: the picked group alone. With no search, every open task.
 */
export function openTasksShown(options: {
  isSearching: boolean;
  view: TodoView;
  query: string;
  selectedGroup: SearchGroup | null;
  previewIds: string[] | null;
  openTasksSorted: TodoTask[];
}): TodoTask[] {
  const { isSearching, view, query, selectedGroup, previewIds, openTasksSorted } = options;
  if (isSearching && view === "lists") {
    const hits = openTasksSorted.filter((t) => matches(t, query));
    return inPreviewOrder(hits, previewIds);
  }
  if (isSearching) {
    return selectedGroup ? selectedGroup.tasks : [];
  }
  return inPreviewOrder(openTasksSorted, previewIds);
}
