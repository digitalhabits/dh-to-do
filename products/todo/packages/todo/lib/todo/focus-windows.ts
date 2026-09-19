/**
 * How many focus windows can be up, and which one gives way.
 *
 * Two windows: one for the task the reader works on, and one for a task
 * that something else works on in the meantime, such as an AI agent. A third
 * task takes the place of the newer of the two, so the first stays where it
 * is. The planner shell has the same rule for its two panels.
 *
 * No React in here, so a test can read it.
 */

export const MAX_FOCUS_WINDOWS = 2;

/**
 * The task whose window must close before a window for `opening` comes up,
 * or null when there is room. `active` is in the order the windows opened.
 */
export function focusToGiveWay(
  active: string[],
  opening: string,
  max = MAX_FOCUS_WINDOWS,
): string | null {
  if (active.includes(opening)) return null;
  if (active.length < max) return null;
  return active[active.length - 1] ?? null;
}
