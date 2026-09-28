/**
 * Minutes from what was typed in a duration box.
 *
 * Every box reads its words the same way: the whole number at the front.
 * "12abc" is 12, "1.5" is 1, "45m" is 45, and 0, nothing or no number at
 * the front is no duration. The card's box, the big card's box, a step's
 * box, the add row and the Calendar's add box all use it. (They once read
 * three ways: "1.5" was 15 minutes in the big card and a step's box, and
 * a step kept 0 as 0.)
 *
 * No React in here, so a test can read it.
 */

/** The digits at the front, when more than 0. */
export function minutesFromTyped(raw: string): number | null {
  const minutes = Number.parseInt(raw, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

/** How long a task added in the Calendar's hours is: its duration, or 30. */
export function calendarLengthMinutes(raw: string): number {
  return minutesFromTyped(raw) ?? 30;
}
