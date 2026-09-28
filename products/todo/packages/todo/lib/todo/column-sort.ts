/**
 * How a board column orders its tasks.
 *
 * Due date is the default: what is due soonest is at the top, and the
 * tasks with no date follow in the order they were dragged into. The
 * other orders are picked per column from the header, and kept per
 * device.
 */
import { TODO_BOARD_COLUMNS, type TodoBoardColumn, type TodoPerson, type TodoTask } from "./types";

export type ColumnSort =
  | "manual"
  | "due"
  | "assignee"
  | "alpha"
  | "duration"
  | "recent";

export const COLUMN_SORTS: readonly ColumnSort[] = [
  "manual",
  "due",
  "assignee",
  "alpha",
  "duration",
  "recent",
];

export const DEFAULT_COLUMN_SORT: ColumnSort = "due";

export function isColumnSort(value: unknown): value is ColumnSort {
  return (COLUMN_SORTS as readonly unknown[]).includes(value);
}

type Sortable = Pick<
  TodoTask,
  | "dueOn"
  | "position"
  | "createdAt"
  | "text"
  | "expectedDurationMinutes"
  | "assigneeIds"
>;

/** The drag order: the position, then age for ties. */
export function byPosition(a: Sortable, b: Sortable): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
}

/** How a column is ordered: which key, and whether it runs backwards. */
export type ColumnOrder = { sort: ColumnSort; desc: boolean };

export const DEFAULT_COLUMN_ORDER: ColumnOrder = {
  sort: DEFAULT_COLUMN_SORT,
  desc: false,
};

/**
 * The key one order sorts by, in its natural direction, or null where
 * the task has nothing to sort by. "Recently added" is newest first by
 * nature, so its key is the age turned negative.
 */
function sortKey(
  sort: ColumnSort,
  t: Sortable,
  personName: (id: string) => string
): number | string | null {
  switch (sort) {
    case "manual":
      return null;
    case "due":
      return t.dueOn ? Number(t.dueOn.replace(/-/g, "")) : null;
    case "assignee":
      return t.assigneeIds.length
        ? personName(t.assigneeIds[0]).toLowerCase()
        : null;
    case "alpha":
      return t.text.toLowerCase();
    case "duration":
      return t.expectedDurationMinutes ?? null;
    case "recent":
      return -Date.parse(t.createdAt);
  }
}

/**
 * The comparator for one order.
 *
 * Reversed, the key runs the other way and nothing else does: a task
 * with nothing to sort by stays at the foot either way, and two tasks
 * that tie keep the places the reader dragged them into.
 *
 * `personName` turns an assignee id into the name to sort by: the
 * comparator sees tasks, and a task holds ids.
 */
export function columnComparator(
  order: ColumnOrder,
  personName: (id: string) => string = (id) => id
): (a: Sortable, b: Sortable) => number {
  if (order.sort === "manual") return byPosition;
  const dir = order.desc ? -1 : 1;
  return (a, b) => {
    const ka = sortKey(order.sort, a, personName);
    const kb = sortKey(order.sort, b, personName);
    if (ka === null && kb === null) return byPosition(a, b);
    if (ka === null) return 1;
    if (kb === null) return -1;
    const cmp =
      typeof ka === "string" && typeof kb === "string"
        ? ka.localeCompare(kb)
        : Number(ka) - Number(kb);
    return dir * cmp || byPosition(a, b);
  };
}

/** Each column's order, kept per device. */
export const COLUMN_SORT_KEY = "redd-plan-todo-column-sort";

/** The words key of each order's name, in the header and in its menu. */
export const SORT_LABEL_KEY: Record<ColumnSort, string> = {
  manual: "sortManual",
  due: "sortDue",
  assignee: "sortAssignee",
  alpha: "sortAlpha",
  duration: "sortDuration",
  recent: "sortRecent",
};

/** The orders this device keeps, or due date for a column it keeps none for. */
export function loadColumnSorts(): Record<TodoBoardColumn, ColumnOrder> {
  const sorts = {
    someday: DEFAULT_COLUMN_ORDER,
    backlog: DEFAULT_COLUMN_ORDER,
    week: DEFAULT_COLUMN_ORDER,
    today: DEFAULT_COLUMN_ORDER,
  };
  if (typeof window === "undefined") return sorts;
  try {
    const raw = localStorage.getItem(COLUMN_SORT_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const column of TODO_BOARD_COLUMNS) {
      const value = parsed[column];
      // The first shape kept the sort's name alone.
      if (isColumnSort(value)) {
        sorts[column] = { sort: value, desc: false };
      } else if (value && typeof value === "object") {
        const { sort, desc } = value as { sort?: unknown; desc?: unknown };
        if (isColumnSort(sort)) sorts[column] = { sort, desc: desc === true };
      }
    }
  } catch {
    /* private mode, or an old shape */
  }
  return sorts;
}

/** Every column's order, as the board keeps them. */
export type ColumnSorts = Record<TodoBoardColumn, ColumnOrder>;

/** With assigning off, a column kept on "assignee" reads by due date. */
export function columnSortsInUse(stored: ColumnSorts, assignEnabled: boolean): ColumnSorts {
  if (assignEnabled) return stored;
  const next = { ...stored };
  for (const column of Object.keys(next) as TodoBoardColumn[]) {
    if (next[column].sort === "assignee") {
      next[column] = DEFAULT_COLUMN_ORDER;
    }
  }
  return next;
}

/**
 * Pick an order: its natural direction. Pick the order the column is
 * already on: the other direction. Manual has no direction to flip.
 */
export function pickedColumnSorts(
  current: ColumnSorts,
  column: TodoBoardColumn,
  sort: ColumnSort
): ColumnSorts {
  const was = current[column];
  const desc = sort !== "manual" && was.sort === sort ? !was.desc : false;
  return { ...current, [column]: { sort, desc } };
}

/*
  Each column in its own order. Not during a drag: then the rows follow
  the preview, and the sort takes over again when the task lands.
*/
export function sortColumnTasks<T extends Sortable>(
  order: ColumnOrder,
  tasks: T[],
  people: Pick<TodoPerson, "id" | "name">[],
  dragging: boolean
): T[] {
  if (order.sort === "manual" || dragging) return tasks;
  const names = new Map(people.map((p) => [p.id, p.name]));
  return [...tasks].sort(columnComparator(order, (id) => names.get(id) ?? ""));
}
