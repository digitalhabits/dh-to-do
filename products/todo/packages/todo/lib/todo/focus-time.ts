/**
 * The focus timer's reading. Shared by the floating focus panel and the
 * Today session, so both count the same way.
 */

/** redd-do's updateFocusTimer: countdown vs expected duration, red overtime. */
export function formatFocusTime(
  elapsedMs: number,
  durationMinutes: number | null
): { text: string; overtime: boolean } {
  let displayMs = elapsedMs;
  let overtime = false;
  if (durationMinutes) {
    const totalMs = durationMinutes * 60 * 1000;
    if (elapsedMs >= totalMs) {
      overtime = true;
      displayMs = elapsedMs - totalMs;
    } else {
      displayMs = Math.ceil((totalMs - elapsedMs) / 1000) * 1000;
    }
  }
  const hours = Math.floor(displayMs / 3_600_000);
  const minutes = Math.floor((displayMs % 3_600_000) / 60_000);
  const seconds = Math.floor((displayMs % 60_000) / 1000);
  const text = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return { text: overtime && durationMinutes ? `-${text}` : text, overtime };
}

/**
 * "Always show the timer in Focus Mode", a switch in Settings. Some people
 * find a running clock stressful. With the switch off, a timer shows only
 * for a task that has a duration, where it counts down to something the
 * reader asked for. The time spent on the task is still counted and saved.
 *
 * Missing key = on, as the app was before the switch. "0" is off.
 */
export const FOCUS_TIMER_ALWAYS_KEY = "redd-plan-todo-focus-timer-always";

/** The message on the focus channel that tells open focus windows. */
export const FOCUS_TIMER_PREF_MESSAGE = "focus-timer-pref";

export function readFocusTimerAlways(): boolean {
  try {
    return localStorage.getItem(FOCUS_TIMER_ALWAYS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function focusTimerShown(
  always: boolean,
  durationMinutes: number | null | undefined
): boolean {
  return always || Boolean(durationMinutes);
}
