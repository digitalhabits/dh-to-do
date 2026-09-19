/**
 * What a focus window was showing, so a reload gives it back.
 *
 * The desktop shell keeps its focus panels loaded and hidden, and hands
 * each one its task by an event when the panel is shown. A reload of the
 * panel's page — Cmd+R, or the dev server after a change — throws that
 * away: the page comes back with no task in its address, waits for an
 * event that has already been sent, and shows "…" over a timer at zero.
 *
 * So the panel writes what it is showing to the browser's storage, one
 * record per window, and reads it back when it mounts after a reload.
 * Only after a reload: a panel loaded fresh at launch has no session to
 * take up, and a record left over from a quit must not start a hidden
 * timer. The record goes when the panel closes.
 *
 * No React in here, so a test can read it.
 */

export type FocusSessionRecord = {
  taskId: string;
  title: string;
  durationMinutes: number | null;
  /** When the timer's current run started, epoch ms. */
  sessionStart: number;
  /** When this record was last written, epoch ms. */
  savedAt: number;
};

/** localStorage, as far as this reads it. */
export type FocusSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** How the page came to load, from the Navigation Timing API. */
export type NavigationKind = "navigate" | "reload" | "back_forward" | "prerender" | undefined;

/**
 * A record older than this is not taken up after a reload. A panel kept
 * open for longer is a panel someone forgot, and its time is long saved.
 */
export const FOCUS_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * With no word on how the page loaded, a record this fresh is taken as a
 * reload: a launch takes longer than this to get from a quit to a panel.
 */
export const FOCUS_SESSION_FRESH_MS = 3 * 60 * 1000;

/** One record per window: each panel by its slot, the fullscreen window apart. */
export function focusSessionKey(slot: number, fullscreen = false): string {
  return `redd-plan-todo-focus-slot-${slot}${fullscreen ? "-fullscreen" : ""}`;
}

/** The record the window left, when a reload should take it up; else null. */
export function readFocusSession(
  storage: FocusSessionStorage,
  key: string,
  at: { now: number; navigation: NavigationKind }
): FocusSessionRecord | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const age = at.now - parsed.savedAt;
  if (age < 0 || age > FOCUS_SESSION_MAX_AGE_MS) return null;
  if (at.navigation === "reload") return parsed;
  if (at.navigation === undefined && age <= FOCUS_SESSION_FRESH_MS) return parsed;
  return null;
}

export function writeFocusSession(
  storage: FocusSessionStorage,
  key: string,
  record: FocusSessionRecord
): void {
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    /* a browser with no storage: the reload will just start over */
  }
}

export function clearFocusSession(storage: FocusSessionStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** How the current page came to load, or undefined where the API is missing. */
export function currentNavigationKind(): NavigationKind {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const kind = entry?.type;
    return kind === "navigate" ||
      kind === "reload" ||
      kind === "back_forward" ||
      kind === "prerender"
      ? kind
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is FocusSessionRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.taskId === "string" &&
    v.taskId.length > 0 &&
    typeof v.title === "string" &&
    (v.durationMinutes === null || typeof v.durationMinutes === "number") &&
    typeof v.sessionStart === "number" &&
    Number.isFinite(v.sessionStart) &&
    typeof v.savedAt === "number" &&
    Number.isFinite(v.savedAt)
  );
}
