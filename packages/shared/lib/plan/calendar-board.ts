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

/** One event as Google's calendar API gives it, with only the fields we ask for. */
export type GoogleEventItem = {
  id?: string;
  status?: string;
  /** Set on a repeating event's own row: its rules. */
  recurrence?: string[];
  /** Set on one occurrence of a repeating event: the event it belongs to. */
  recurringEventId?: string;
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
      sources.push({
        id,
        kind: "google",
        name,
        accountEmail,
        calendarId,
        ...(entry.showAll === true ? { showAll: true } : null),
      });
      continue;
    }
    const url = typeof entry.url === "string" ? entry.url : null;
    if (!url) continue;
    sources.push({ id, kind: "ics", name, url });
  }
  return sources;
}

/**
 * What at the start of an event's description puts it on the board:
 * "REDD-DO" or "DH-TO-DO", in any case. The same rule as calendar-sync.js.
 */
export const BOARD_MARKER = /^(redd-do|dh-to-do)/i;

/** The events a calendar shows: only the marked ones, unless it shows all. */
export function eventsForSource(
  source: Pick<CalendarSource, "showAll">,
  events: CalendarBoardEvent[]
): CalendarBoardEvent[] {
  if (source.showAll) return events;
  return events.filter((event) => BOARD_MARKER.test(event.description.trim()));
}

/*
 * Reading a calendar again, by what changed.
 *
 * The server keeps each calendar's events (calendar-sources.ts) and asks
 * Google only what changed since its last read ("updatedMin"), which
 * includes what was deleted. Google's change tokens would be its first
 * choice, but they cannot be bounded in time, and the board reads fourteen
 * months, not a calendar's whole life.
 *
 * The changes are read with repeats not expanded, because expanding a
 * series with no end, unbounded in time, never ends. A change to a series,
 * or to one occurrence of it, is answered with a full read of the window:
 * which occurrences fall where is Google's to work out. Series change
 * rarely; one-off events are what changes from day to day.
 */

/** The window's events, by id. */
export type StoredBoardEvents = Record<string, CalendarBoardEvent>;

/** How long a stored copy may go between full reads. */
export const BOARD_FULL_READ_EVERY_MS = 24 * 60 * 60 * 1000;
/**
 * The oldest "changed since" to ask with. Google keeps what was deleted for
 * a while, not for ever, so a copy older than this is read again whole.
 */
export const BOARD_CHANGES_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type StoredBoardState = {
  windowMin: string;
  windowMax: string;
  /** When the last read started: the next one asks for changes since. */
  readAt: Date;
  fullAt: Date;
};

/** Whether to read the whole window rather than what changed. */
export function needsFullRead(
  stored: StoredBoardState | null,
  window: { timeMin: string; timeMax: string },
  now: Date,
  force: boolean
): boolean {
  if (force || !stored) return true;
  if (stored.windowMin !== window.timeMin || stored.windowMax !== window.timeMax) return true;
  if (now.getTime() - stored.fullAt.getTime() >= BOARD_FULL_READ_EVERY_MS) return true;
  return now.getTime() - stored.readAt.getTime() >= BOARD_CHANGES_MAX_AGE_MS;
}

/** One event as Google gives it, as the board wants it, or null. */
export function toBoardEvent(item: GoogleEventItem): CalendarBoardEvent | null {
  return toBoardEvents([item])[0] ?? null;
}

/** Whether an event touches the window at all. */
function inWindow(
  event: CalendarBoardEvent,
  window: { timeMin: string; timeMax: string }
): boolean {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return end > Date.parse(window.timeMin) && start < Date.parse(window.timeMax);
}

/**
 * The stored events with the changes put on, or null when a change is to a
 * repeating series and the window has to be read whole.
 *
 * A deleted event goes, and so do its occurrences: an occurrence's id is
 * the series' id, an underscore, and its date. An event moved out of the
 * window goes too.
 */
export function applyBoardChanges(
  stored: StoredBoardEvents,
  changes: GoogleEventItem[],
  window: { timeMin: string; timeMax: string }
): StoredBoardEvents | null {
  const next: StoredBoardEvents = { ...stored };
  for (const item of changes) {
    if (!item.id) continue;
    if (item.status === "cancelled") {
      if (item.recurringEventId) return null;
      delete next[item.id];
      const occurrence = `${item.id}_`;
      for (const id of Object.keys(next)) {
        if (id.startsWith(occurrence)) delete next[id];
      }
      continue;
    }
    if (item.recurrence?.length || item.recurringEventId) return null;
    const event = toBoardEvent(item);
    if (event && inWindow(event, window)) next[item.id] = event;
    else delete next[item.id];
  }
  return next;
}

/** The stored events as the board takes them: by start, earliest first. */
export function storedBoardEventList(stored: StoredBoardEvents): CalendarBoardEvent[] {
  return Object.values(stored).sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0
  );
}
