/**
 * What the Calendar tab reads, in the shapes both sides agree on.
 *
 * Pure, so a test can read it. The parts that hold a token or reach Google
 * are in `@/lib/plan/calendar-sources` and `@/lib/google/calendar`, and say
 * so at the top.
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

/** One event as Google's calendar API gives it, with only the fields we ask for. */
export type GoogleEventItem = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

/**
 * Google's events, as the board wants them.
 *
 * An event with no start or end is dropped rather than guessed at: the board
 * places everything by date, and an event without one has nowhere to go.
 * A cancelled event is a tombstone, not an event.
 */
export function toBoardEvents(items: GoogleEventItem[]): CalendarBoardEvent[] {
  const events: CalendarBoardEvent[] = [];
  for (const item of items) {
    if (!item.id || item.status === "cancelled") continue;
    // A whole day has `date`; an event with a time has `dateTime`.
    const start = item.start?.dateTime ?? item.start?.date;
    const end = item.end?.dateTime ?? item.end?.date;
    if (!start || !end) continue;
    events.push({
      uid: item.id,
      summary: item.summary ?? "",
      description: item.description ?? "",
      location: item.location ?? "",
      start,
      end,
      isAllDay: Boolean(item.start?.date && !item.start?.dateTime),
    });
  }
  return events;
}

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

/** One page of events, as Google answers. */
export type GoogleEventPage = {
  items?: GoogleEventItem[];
  nextPageToken?: string;
};

/**
 * Page after page, until Google runs out or the guard is reached.
 *
 * Google gives 250 events at a time at most, and counts every repeat as its
 * own event, so a busy calendar loses everything after the first page unless
 * the pages are followed. `maxEvents` is a guard against a calendar that
 * never ends, not a target.
 *
 * The reading is passed in, so the loop can be tested without a token.
 */
export async function collectBoardEvents(
  readPage: (pageToken?: string) => Promise<GoogleEventPage>,
  maxEvents: number
): Promise<CalendarBoardEvent[]> {
  const events: CalendarBoardEvent[] = [];
  let pageToken: string | undefined;
  do {
    const page = await readPage(pageToken);
    for (const event of toBoardEvents(page.items ?? [])) {
      events.push(event);
      if (events.length >= maxEvents) return events;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}

/** How far back and forward the board reads: it draws about fourteen months. */
const MONTHS_BACK = 2;
const MONTHS_AHEAD = 12;

/**
 * The stretch of time the board asks Google for.
 *
 * It matches the stretch the browser keeps after filtering, so an event is
 * never fetched to be thrown away, and never missing because it fell a day
 * outside.
 */
export function boardWindow(now = new Date()): {
  timeMin: string;
  timeMax: string;
} {
  const timeMin = new Date(now.getFullYear(), now.getMonth() - MONTHS_BACK, 1);
  const timeMax = new Date(
    now.getFullYear(),
    now.getMonth() + MONTHS_AHEAD + 1,
    1
  );
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}

/**
 * The picked calendars, from the shared state the Calendar tab saves.
 *
 * The state is whatever the browser last wrote, so every field is checked
 * here. A row written before calendars had a kind has a url and no kind, so
 * it reads as "ics" and keeps working.
 */
export function toCalendarSources(raw: unknown): CalendarSource[] {
  if (!Array.isArray(raw)) return [];
  const sources: CalendarSource[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : null;
    if (!id) continue;
    const name = typeof entry.name === "string" ? entry.name : "Calendar";
    if (entry.kind === "google") {
      const accountEmail =
        typeof entry.accountEmail === "string" ? entry.accountEmail : null;
      const calendarId =
        typeof entry.calendarId === "string" ? entry.calendarId : null;
      if (!accountEmail || !calendarId) continue;
      sources.push({ id, kind: "google", name, accountEmail, calendarId });
      continue;
    }
    const url = typeof entry.url === "string" ? entry.url : null;
    if (!url) continue;
    sources.push({ id, kind: "ics", name, url });
  }
  return sources;
}
