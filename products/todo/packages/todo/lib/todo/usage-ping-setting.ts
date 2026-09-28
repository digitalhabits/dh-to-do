/**
 * The "Send anonymous usage count" setting of the standalone To-Do app.
 *
 * Only the standalone app (Mac App Store, Microsoft Store) sends the ping,
 * from apps/todo/src/usage-ping.ts. The planner's To-Do tab never sends one
 * and never shows the switch. The setting lives in localStorage because it
 * belongs to this install, like the ping's own key.
 */

export const USAGE_PING_ENABLED_KEY = "todo_usage_ping_enabled";

/** On unless the user turned it off. */
export function readUsagePingEnabled(): boolean {
  try {
    return localStorage.getItem(USAGE_PING_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeUsagePingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(USAGE_PING_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* localStorage may be disabled; the ping then stays on */
  }
}
