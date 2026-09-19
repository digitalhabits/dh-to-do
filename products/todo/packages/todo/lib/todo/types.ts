/** Wire/domain types for the shared to-do client (ported from redd-do). */

/** BroadcastChannel name syncing the To-Do tab with floating focus windows. */
export const FOCUS_CHANNEL = "redd-plan-todo-focus";

/**
 * The board saved a change to a task: its text, its duration, its notes. A
 * focus window that shows the task takes the new values at once. Not
 * "task-updated": that one goes the other way, from a focus window to the
 * board, and the board answers it with a full read.
 */
export const BOARD_TASK_CHANGED_MESSAGE = "board-task-changed";

/**
 * Which list the To-Do page opens on, kept per device.
 *
 * Here rather than in the page, because the planner sets it too: the
 * morning briefing opens To-Do on every list, so the whole of the day it
 * just wrote is in the Today column rather than the part of it that
 * happens to live on the list last read.
 */
export const TODO_CURRENT_LIST_KEY = "redd-plan-todo-current-list";

/** The one shape a due date takes, Basecamp's `due_on`: YYYY-MM-DD. */
export const DUE_ON_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Virtual list: the tasks of every list in the current group scope. */
export const TODO_ALL_LIST_ID = "__all__";

export type TodoGroup = {
  id: string;
  name: string;
  /** Preset palette key ("blue", …) or "#rrggbb", as in redd-do. */
  colour: string | null;
  position: number;
};

export type TodoGroupPatch = Partial<
  Pick<TodoGroup, "name" | "colour" | "position">
>;

export type TodoList = {
  id: string;
  name: string;
  groupId: string | null;
  /** Named palette key ("blue", …) or "#rrggbb", as in redd-do / blocker. */
  colour: string | null;
  /** Optional list icon: Lucide preset id (e.g. "target"), or legacy emoji. */
  emoji: string | null;
  position: number;
  basecampProjectId: string | null;
  basecampListId: string | null;
  remindersListId: string | null;
};

/** Person on the shared board roster (assignable to tasks). */
export type TodoPerson = {
  id: string;
  name: string;
  colour: string | null;
  photoUrl: string | null;
  /** Where the row came from. Separate from the Basecamp link below. */
  sourceKind: "team" | "crm" | "manual" | "basecamp" | null;
  sourceId: string | null;
  /** Matches board people to Basecamp people. Lower-cased on write. */
  email: string | null;
  /** The same human in Basecamp, when known. Any sourceKind may have one. */
  basecampPersonId: string | null;
  position: number;
};

/** Candidate from CRM / org Team when adding to the board roster. */
export type TodoPersonCandidate = {
  key: string;
  name: string;
  photoUrl: string | null;
  sourceKind: "team" | "crm";
  sourceId: string;
  /** Carried through on add, so Basecamp sync can match this person later. */
  email: string | null;
  subtitle: string | null;
};

export type TodoTask = {
  id: string;
  /**
   * The list the task is on, or null for a task on no list.
   *
   * A task with no list is personal: it belongs to whoever made it
   * (`created_by`), shows on the All tab for them alone, and is on no
   * Basecamp or Reminders list. Putting it on a list makes it the team's.
   */
  listId: string | null;
  text: string;
  notesHtml: string | null;
  /**
   * The day the task is due, in the shape Basecamp keeps it: "YYYY-MM-DD",
   * no time and no zone. Null means no due date.
   */
  dueOn: string | null;
  completed: boolean;
  completedAt: string | null;
  isFavourite: boolean;
  favouritePosition: number | null;
  /** Soft-deferred; shown in the Backlog column of the list board. */
  isBacklog: boolean;
  /** Due-focus column on the list board (independent of Favourites / heart). */
  isToday: boolean;
  /**
   * Parking column for work that is not in the real backlog.
   * The reader may or may not do it.
   */
  isSomeday: boolean;
  /**
   * Show the task on the Calendar view, on its due day. Only a task with a
   * due date can be shown, and only when the reader asked for it.
   */
  showOnCalendar: boolean;
  /** Assigned board people (ordered). */
  assigneeIds: string[];
  colour: string | null;
  expectedDurationMinutes: number | null;
  timeSpentSeconds: number;
  position: number;
  basecampId: string | null;
  remindersId: string | null;
  /**
   * The task this one is a step of, or null for a task of the board.
   *
   * A subtask is a full task row — people, notes, duration, focus time all
   * work on it — shown inside its parent's expanded card rather than as a
   * card of its own. The board draws only rows without a parent. In
   * Basecamp a child is the parent to-do's step, synced by the same sync.
   */
  parentTaskId: string | null;
  /**
   * Who made the task: the planner's owner key for the reader, the desktop
   * app's THIS_DEVICE_MAKER, or null when nobody was recorded (Basecamp,
   * older rows). "My tasks" uses it for a task with nobody on it.
   */
  createdBy: string | null;
  createdAt: string;
};

/** Columns of the per-list board (incomplete tasks only). */
export type TodoBoardColumn = "someday" | "backlog" | "week" | "today";

export const TODO_BOARD_COLUMNS: TodoBoardColumn[] = [
  "someday",
  "backlog",
  "week",
  "today",
];

/** The three columns the reader can reorder. Someday stays on the left. */
export const MOVABLE_BOARD_COLUMNS: TodoBoardColumn[] = [
  "backlog",
  "week",
  "today",
];

export function isTodoBoardColumn(
  value: string | undefined
): value is TodoBoardColumn {
  return (
    value === "someday" ||
    value === "backlog" ||
    value === "week" ||
    value === "today"
  );
}

export function emptyBoardColumns<T>(): Record<TodoBoardColumn, T[]> {
  return { someday: [], backlog: [], week: [], today: [] };
}

export function boardColumnOf(
  task: Pick<TodoTask, "isBacklog" | "isToday" | "isSomeday">,
  somedayEnabled = true
): TodoBoardColumn {
  if (somedayEnabled && task.isSomeday) return "someday";
  if (task.isBacklog || task.isSomeday) return "backlog";
  if (task.isToday) return "today";
  return "week";
}

/** Flags to place a task in a board column. Heart/favourite is separate. */
export function boardColumnPatch(
  column: TodoBoardColumn
): Pick<TodoTask, "isBacklog" | "isToday" | "isSomeday"> {
  if (column === "someday") {
    return { isSomeday: true, isBacklog: false, isToday: false };
  }
  if (column === "backlog") {
    return { isSomeday: false, isBacklog: true, isToday: false };
  }
  if (column === "today") {
    return { isSomeday: false, isBacklog: false, isToday: true };
  }
  return { isSomeday: false, isBacklog: false, isToday: false };
}

export type TodoState = {
  groups: TodoGroup[];
  lists: TodoList[];
  tasks: TodoTask[];
  people: TodoPerson[];
};

export type TodoTaskPatch = Partial<
  Pick<
    TodoTask,
    | "listId"
    | "text"
    | "notesHtml"
    | "dueOn"
    | "completed"
    | "isFavourite"
    | "favouritePosition"
    | "isBacklog"
    | "isToday"
    | "isSomeday"
    | "showOnCalendar"
    | "assigneeIds"
    | "colour"
    | "expectedDurationMinutes"
    | "timeSpentSeconds"
    | "position"
    | "remindersId"
  >
>;

export type TodoPersonPatch = Partial<
  Pick<TodoPerson, "name" | "colour" | "photoUrl" | "position">
>;

export type TodoListPatch = Partial<
  Pick<
    TodoList,
    | "name"
    | "groupId"
    | "colour"
    | "emoji"
    | "position"
    | "basecampProjectId"
    | "basecampListId"
    | "remindersListId"
  >
>;
