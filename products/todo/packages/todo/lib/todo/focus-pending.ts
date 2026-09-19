/**
 * A tick from the focus window that no board was open to take.
 *
 * The focus window tells the board "this task is done" over a channel, and
 * the board completes it by its own path — which is the only path for a
 * task that lives in the board's own storage. A message on a channel
 * reaches who is listening at that moment. With To-Do on no tile, nobody
 * is, and the tick was lost.
 *
 * So the planner keeps the tick here while it opens a To-Do tile, and the
 * board takes it up once its tasks are loaded. localStorage, not memory:
 * a tile can be a frame of its own, with its own copy of this module.
 */

const KEY = "dh-todo-focus-pending-complete";
/** A tick older than this belongs to a session that is over. */
const MAX_AGE_MS = 2 * 60 * 1000;

export type PendingFocusComplete = {
  taskId: string;
  timeSpentSeconds?: number;
  at: number;
};

function read(): PendingFocusComplete[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is PendingFocusComplete =>
        Boolean(item) &&
        typeof (item as PendingFocusComplete).taskId === "string" &&
        typeof (item as PendingFocusComplete).at === "number"
    );
  } catch {
    return [];
  }
}

export function queuePendingFocusComplete(taskId: string, timeSpentSeconds?: number): void {
  try {
    const kept = read().filter(
      (item) => item.taskId !== taskId && Date.now() - item.at < MAX_AGE_MS
    );
    kept.push({ taskId, timeSpentSeconds, at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* private mode: the write to the server still went */
  }
}

/** Every tick still fresh, taken off the list. */
export function drainPendingFocusCompletes(): PendingFocusComplete[] {
  const all = read();
  if (!all.length) return [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
  return all.filter((item) => Date.now() - item.at < MAX_AGE_MS);
}
