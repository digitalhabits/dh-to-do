/**
 * The calendar shapes that To-Do's Calendar View shares with its host.
 *
 * To-Do's own copy of four types from the planner's
 * packages/shared/lib/plan/calendar-board.ts. TypeScript compares types by
 * shape, so the two copies fit each other while they stay the same. Change
 * both together; tests/todo-shared-copies.test.mts fails when they differ.
 */

/** A calendar the reader picked, as the board keeps it. */
export type CalendarSource = {
  id: string;
  kind: "ics" | "google";
  name: string;
  /** Set when `kind` is "ics". */
  url?: string;
  /** Both set when `kind` is "google". */
  accountEmail?: string;
  calendarId?: string;
  /**
   * Every event, not only those marked for the board (the "All events"
   * choice on a calendar). Unset is marked only.
   */
  showAll?: boolean;
};

/**
 * An event as the Calendar tab needs it.
 *
 * The description is here because the marker that puts an event on the
 * board is the first word of it.
 */
export type CalendarBoardEvent = {
  uid: string;
  summary: string;
  description: string;
  location: string;
  /** RFC 3339 for an event with a time; "YYYY-MM-DD" for a whole day. */
  start: string;
  /** The same. A whole day ends the morning after, as iCalendar has it. */
  end: string;
  isAllDay: boolean;
};

/** What one calendar gave the board, or why it gave nothing. */
export type CalendarFeed = {
  id: string;
  events: CalendarBoardEvent[];
  /** Plain words for the board to show on the calendar's own row. */
  error: string | null;
};

/** One account, and the calendars the picker may offer from it. */
export type PickableAccount = {
  email: string;
  calendars: { id: string; name: string; primary: boolean }[];
  /** Set when the account cannot be read yet; `calendars` is then empty. */
  error: string | null;
};
