/**
 * A message for the user from whatever was thrown.
 *
 * The planner throws an Error for a failed request. The standalone app does
 * not: Tauri rejects an invoke with a plain string, and that string is the only
 * text that names the cause. A test for `instanceof Error` therefore drops it,
 * and every different failure reads as the same fallback. Three faults hid
 * behind one message that way — a plugin that was never registered, a stale
 * permission, and a missing prompt.
 *
 * Use this wherever a caught value becomes user-visible text.
 */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return fallback;
}

/**
 * A network blip, as the engines phrase it.
 *
 * WebKit says "Load failed" for a fetch that a reload killed and for one
 * that never reached the server; Chromium says "Failed to fetch". Neither
 * text tells the user anything, and the state that provoked it is usually
 * gone by the next try. Callers retry these quietly and only speak when
 * the retry fails too.
 */
export function isNetworkBlip(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const text = err.message.toLowerCase();
  return (
    text.includes("load failed") ||
    text.includes("failed to fetch") ||
    text.includes("network")
  );
}
