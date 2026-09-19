/**
 * The board of Digital Habits: To-Do 2.x, taken over at the first start of 3.x.
 *
 * 2.x kept everything in the web view's localStorage, under one key. 3.x keeps
 * the board in SQLite. The desktop app has the same identifier as 2.x and the
 * same web view origin, so after an update the old value is still there, in
 * the storage of the new app. Without this, a reader who updates from 2.9
 * opens an empty board, with every task still on the disk and out of reach.
 *
 * The old value is a 2.x backup file as it stands: 2.x wrote its backups by
 * saving this same value. So it goes to the importer that reads such a file,
 * and no second reader of the format exists. See `importTodoBackup`.
 *
 * The Planner view's calendar and two settings come over too. They stay in
 * localStorage in 3.x, under other names. See `carryLegacySettings`.
 *
 * Rules:
 *
 * - Only in the desktop app. The planner's To-Do tab is the team's board.
 * - Only into an empty board. A board with a list or a task on it is a board
 *   somebody made in 3.x, and old lists must not appear in it unasked. The
 *   backup import in Settings does that when it is wanted.
 * - Once. A mark says what was done, so a reader who then clears the board
 *   does not get the old one back at the next start.
 * - The old value is never changed and never removed. It is the only copy
 *   of the 2.x board, and a reader who goes back to 2.9 must find it.
 * - A failure leaves no mark, so the next start tries again.
 */

/** Where 2.x kept its board. */
export const LEGACY_BOARD_KEY = "redd-todo-data";

/** What this module did, and when. Its presence is what stops a second run. */
export const LEGACY_IMPORT_MARK_KEY = "dh-todo-legacy-import";

type Api = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * The Planner view's calendar, and two settings. 2.x kept them in the same
 * storage under other names. Each is copied to the name 3.x reads, and only
 * when 3.x has nothing under that name, so a value made in 3.x always wins.
 * The old names are left as they are.
 *
 * Not the last sync time: the calendars then sync at once, which is right
 * after an update. Not the 2.x list of goal people: a week goal in 3.x is
 * for a person from the board. It is read, to give each old goal a name that
 * the board can match. See `goalsWithNames`.
 */
const LEGACY_PLAN_PREFIX = "redd-do-plan-";
const PLAN_PREFIX = "redd-todo-plan-";
const PLAN_KEYS = [
  "calendars",
  "freeform-notes",
  "freeform-lines",
  "groups",
  "active-group",
  "calendar-view-mode",
];
const WEEK_GOALS = "week-goals";
const LEGACY_GOAL_PEOPLE = "goal-assignees";

/** 3.x names, as TodoPage.tsx has them. */
const SETTINGS: [legacy: string, current: string, allowed: string[]][] = [
  ["language", "redd-plan-todo-lang", ["en", "da"]],
  ["theme", "redd-plan-todo-theme", ["light", "dark", "system"]],
];
/** The Planner view is off in 3.x until it is turned on. "1" is on. */
const PLAN_ENABLED_KEY = "redd-plan-todo-plan";

/**
 * 2.x gave each goal the id of a person from its own list, "a" or "b". The
 * board does not know those ids. It can match a first name, so the goal
 * gets the first name from the 2.x list, in lower case. A goal whose person
 * is "Person 1" then matches nobody and shows with no name, which is right.
 */
function goalsWithNames(rawGoals: string, rawPeople: string | null): string {
  try {
    const people: unknown = rawPeople ? JSON.parse(rawPeople) : [];
    const names = new Map<string, string>();
    if (Array.isArray(people)) {
      for (const p of people) {
        if (!isRecord(p) || typeof p.label !== "string") continue;
        const first = p.label.trim().split(/\s+/)[0]?.toLowerCase();
        if (first && p.id != null) names.set(String(p.id), first);
      }
    }
    const byWeek: unknown = JSON.parse(rawGoals);
    if (!isRecord(byWeek)) return rawGoals;
    for (const goals of Object.values(byWeek)) {
      if (!Array.isArray(goals)) continue;
      for (const goal of goals) {
        if (!isRecord(goal) || goal.assignee == null) continue;
        goal.assignee = names.get(String(goal.assignee)) ?? goal.assignee;
      }
    }
    return JSON.stringify(byWeek);
  } catch {
    return rawGoals;
  }
}

/**
 * Copy the calendar and the settings of 2.x. Returns how many values it
 * copied.
 *
 * Synchronous on purpose. The page reads its language and theme in an effect
 * on mount, and this must be done before that effect runs.
 */
export function carryLegacySettings(store: Store): number {
  let copied = 0;
  const copy = (from: string, to: string, change?: (v: string) => string | null) => {
    try {
      if (store.getItem(to) != null) return;
      const value = store.getItem(from);
      if (value == null) return;
      const next = change ? change(value) : value;
      if (next == null) return;
      store.setItem(to, next);
      copied += 1;
    } catch {
      /* A value that cannot be copied is one the reader sets again. */
    }
  };
  try {
    if (store.getItem(LEGACY_IMPORT_MARK_KEY)) return 0;
  } catch {
    return 0;
  }

  let calendar = 0;
  for (const key of PLAN_KEYS) {
    const before = copied;
    copy(LEGACY_PLAN_PREFIX + key, PLAN_PREFIX + key);
    calendar += copied - before;
  }
  {
    const before = copied;
    let people: string | null = null;
    try {
      people = store.getItem(LEGACY_PLAN_PREFIX + LEGACY_GOAL_PEOPLE);
    } catch {
      people = null;
    }
    copy(LEGACY_PLAN_PREFIX + WEEK_GOALS, PLAN_PREFIX + WEEK_GOALS, (v) =>
      goalsWithNames(v, people),
    );
    calendar += copied - before;
  }
  // Somebody with a calendar in 2.x used the Planner view. Show it to them.
  if (calendar > 0) {
    try {
      if (store.getItem(PLAN_ENABLED_KEY) == null) store.setItem(PLAN_ENABLED_KEY, "1");
    } catch {
      /* The reader turns it on in Settings. */
    }
  }
  for (const [legacy, current, allowed] of SETTINGS) {
    copy(legacy, current, (v) => (allowed.includes(v) ? v : null));
  }
  return copied;
}

export type LegacyImportResult =
  | {
      outcome: "imported";
      lists: number;
      tasks: number;
      groups: number;
      /** "again": 2.x was signed in to Basecamp and its sign-in did not carry over. */
      basecamp: "none" | "carried" | "again";
    }
  | { outcome: "skipped"; reason: "no-old-board" | "done-before" | "board-in-use" | "old-board-empty" }
  | { outcome: "failed"; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function count(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (isRecord(v)) return Object.keys(v).length;
  return 0;
}

function mark(store: Store, value: Record<string, unknown>) {
  try {
    store.setItem(
      LEGACY_IMPORT_MARK_KEY,
      JSON.stringify({ ...value, at: new Date().toISOString() }),
    );
  } catch {
    /* A store that cannot be written to is one the old board is not in. */
  }
}

/**
 * Take the 2.x board over, if there is one and this board is empty.
 *
 * `api` is the board's own: `/api/todo/state` to see the board, and
 * `/api/todo/import` to write to it. In the desktop app both go to SQLite.
 */
export async function importLegacyBoard(
  api: Api,
  store: Store,
): Promise<LegacyImportResult> {
  let raw: string | null;
  try {
    if (store.getItem(LEGACY_IMPORT_MARK_KEY)) {
      return { outcome: "skipped", reason: "done-before" };
    }
    raw = store.getItem(LEGACY_BOARD_KEY);
  } catch {
    return { outcome: "skipped", reason: "no-old-board" };
  }
  if (!raw) return { outcome: "skipped", reason: "no-old-board" };

  let old: unknown;
  try {
    old = JSON.parse(raw);
  } catch {
    // Not a board. Nothing later will make it one, so do not look again.
    mark(store, { outcome: "skipped", reason: "old-board-empty" });
    return { outcome: "skipped", reason: "old-board-empty" };
  }
  if (!isRecord(old) || count(old.tabs) === 0) {
    mark(store, { outcome: "skipped", reason: "old-board-empty" });
    return { outcome: "skipped", reason: "old-board-empty" };
  }

  try {
    const { state } = await api("/api/todo/state", "GET");
    const board = isRecord(state) ? state : {};
    if (count(board.lists) > 0 || count(board.tasks) > 0) {
      mark(store, { outcome: "skipped", reason: "board-in-use" });
      return { outcome: "skipped", reason: "board-in-use" };
    }

    const { imported } = await api("/api/todo/import", "POST", old);
    const done = isRecord(imported) ? imported : {};
    const basecamp = await carryBasecampOver(api, old);
    const result = {
      outcome: "imported" as const,
      lists: Number(done.lists ?? 0),
      tasks: Number(done.tasks ?? 0),
      groups: Number(done.groups ?? 0),
      basecamp,
    };
    mark(store, result);
    return result;
  } catch (err) {
    return {
      outcome: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The Basecamp sign-in of 2.x, so linked lists go on syncing with no new
 * sign-in. 2.x kept its tokens in the same value as the board.
 *
 * Never a reason to fail the import: a token that Basecamp no longer takes
 * only means the reader signs in again, as after any expiry. The lists keep
 * their Basecamp links either way.
 */
async function carryBasecampOver(
  api: Api,
  old: Record<string, unknown>,
): Promise<"none" | "carried" | "again"> {
  const config = isRecord(old.basecampConfig) ? old.basecampConfig : null;
  const accessToken =
    config && typeof config.accessToken === "string" ? config.accessToken : "";
  if (!config || !accessToken) return "none";
  try {
    const answer = await api("/api/todo/basecamp/manual", "POST", {
      accessToken,
      refreshToken:
        typeof config.refreshToken === "string" ? config.refreshToken : null,
    });
    return answer.connected === true ? "carried" : "again";
  } catch {
    return "again";
  }
}
