/**
 * The demo app's invented board: a small Copenhagen studio getting a
 * harbour exhibition ready. The people are the same invented cast as the
 * Mail demo (apps/mail/src/demo/data.ts). Nothing here is a real person,
 * place or address.
 *
 * Every date counts from the day the app starts, so the week view always
 * has a full week and the months always have plans ahead. Tasks before
 * today are done, as a week that went well; the ones from today on are
 * still to do.
 */

/** "YYYY-MM-DD" of a date, as the board keeps one. */
function key(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A day counted from today. */
export function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return key(d);
}

/** A weekday of this week (0 = Monday), or of a week after it. */
export function weekday(n: number, weeksAhead = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n + weeksAhead * 7);
  return key(d);
}

/** A day of the month that is `months` after this one. */
export function monthDay(months: number, dayOfMonth: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(dayOfMonth);
  return key(d);
}

/** Minutes after midnight, from "HH:MM". */
function at(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export type DemoTask = {
  id: string;
  list: string;
  text: string;
  /** "today" and "backlog" are columns; "week" is the column between. */
  column: "today" | "week" | "backlog";
  due?: string;
  /** Shown in the months too, not only in the week. */
  calendar?: boolean;
  minutes?: number;
  /** Seconds spent so far. */
  spent?: number;
  done?: boolean;
  who?: string[];
  notes?: string;
  steps?: [string, boolean][];
  /** A block in the week view, "HH:MM"–"HH:MM". */
  time?: [string, string];
};

export const PEOPLE = [
  { id: "p-ingrid", name: "Ingrid Isbjørn", colour: "#1e2d3e" },
  { id: "p-anton", name: "Anton Asmund", colour: "#2a9d8f" },
  { id: "p-frida", name: "Frida Fisker", colour: "#d4605a" },
  { id: "p-gustav", name: "Gustav Gulerod", colour: "#e9a23b" },
];

/** The reader: the "Me" of the People dialog. */
export const ME = "p-ingrid";

/** List marks are Lucide icon names, as the list dialog keeps them. */
export const LISTS = [
  { id: "l-show", name: "Harbour exhibition", emoji: "image" },
  { id: "l-cat", name: "Catalogue", emoji: "book-open" },
  { id: "l-studio", name: "Studio", emoji: "briefcase" },
  { id: "l-home", name: "Home", emoji: "house" },
];

/** Whether a day is before today: its task is done. */
const past = (d: string) => d < day(0);

/** A dated task: done when its day is past, in Today when its day is today. */
function task(t: DemoTask): DemoTask {
  if (t.due === day(0)) return { ...t, column: "today" };
  return t.due && past(t.due) && t.done === undefined ? { ...t, done: true, spent: t.spent ?? (t.minutes ?? 20) * 60 } : t;
}

export function demoTasks(): DemoTask[] {
  return [
    // This week, Monday to Friday. The days before today are done.
    task({ id: "w1", list: "l-studio", column: "week", text: "Plan the week with Anton", due: weekday(0), minutes: 30, who: [ME, "p-anton"], time: ["09:00", "09:30"] }),
    task({ id: "w2", list: "l-cat", column: "week", text: "Collect the captions from Frida", due: weekday(0), minutes: 20, who: ["p-frida"] }),
    task({ id: "w3", list: "l-show", column: "week", text: "Agree the floor plan with the curator", due: weekday(1), minutes: 60, who: [ME], time: ["10:00", "11:00"] }),
    task({ id: "w4", list: "l-home", column: "week", text: "Book the train to Aarhus", due: weekday(1), minutes: 10 }),
    task({ id: "w5", list: "l-cat", column: "week", text: "Send the catalogue proofs to the printer", due: weekday(2), minutes: 45, who: [ME, "p-frida"], time: ["13:00", "13:45"],
      notes: "<div>Gustav has the colour profile. Ask for one printed proof of the cover.</div>" }),
    task({ id: "w6", list: "l-show", column: "week", text: "Write the label texts for room one", due: weekday(2), minutes: 90, who: [ME],
      steps: [["Read the curator's notes", true], ["Draft the six labels", false], ["Check the names and years", false]] }),
    task({ id: "w7", list: "l-studio", column: "week", text: "Order more picture wire", due: weekday(3), minutes: 10, who: ["p-gustav"] }),
    task({ id: "w8", list: "l-show", column: "week", text: "Hang the north wall while the light is good", due: weekday(3), minutes: 120, spent: 1800, who: [ME, "p-anton"], time: ["09:00", "11:00"],
      notes: "<div>Start with the two large frames. The smaller works go in room three.</div>",
      steps: [["Measure the wall", true], ["Mark the hanging line", true], ["Hang the two large frames", false], ["Check the spacing from the door", false]] }),
    task({ id: "w9", list: "l-cat", column: "week", text: "Choose the paper for the cover", due: weekday(4), minutes: 20, who: ["p-frida"],
      notes: "<div>150 gsm is back in stock. It takes the deep blue well.</div>" }),
    task({ id: "w10", list: "l-show", column: "week", text: "Send the invitations for the opening", due: weekday(4), minutes: 40, who: [ME], time: ["14:00", "14:40"] }),
    task({ id: "w11", list: "l-home", column: "week", text: "Birthday present for Frida", due: weekday(5), calendar: true }),

    // Today: the reader's Today column, on top of what falls due today.
    { id: "t1", list: "l-studio", column: "today", text: "Reply to Caroline about the studio visit", minutes: 15, who: [ME] },
    { id: "t2", list: "l-show", column: "today", text: "Ring the framer about the oak frames", minutes: 10, who: [ME] },
    { id: "t3", list: "l-studio", column: "today", text: "Draft the presentation notes", minutes: 45, who: [ME],
      steps: [["Collect the numbers", true], ["Write the outline", false], ["Choose the pictures", false]] },

    // Next weeks.
    task({ id: "n1", list: "l-show", column: "week", text: "Ship the two crates to Leipzig", due: weekday(1, 1), minutes: 60, who: ["p-anton"], calendar: true }),
    task({ id: "n2", list: "l-show", column: "week", text: "Book the hall for the opening talk", due: weekday(2, 1), who: ["p-anton"] }),
    task({ id: "n3", list: "l-cat", column: "backlog", text: "Photograph the last three works", due: weekday(3, 1), minutes: 120, who: ["p-gustav"] }),
    task({ id: "n4", list: "l-studio", column: "backlog", text: "Frames: ask for a quote in oak", due: weekday(0, 2), minutes: 15, who: ["p-gustav"] }),
    task({ id: "n5", list: "l-show", column: "backlog", text: "Plan the workshop for families", due: weekday(3, 2), who: ["p-anton", "p-frida"], calendar: true }),

    // Months ahead: shown in the months as well.
    task({ id: "m1", list: "l-cat", column: "backlog", text: "Catalogue to the printer", due: monthDay(1, 6), calendar: true, who: ["p-frida"] }),
    task({ id: "m2", list: "l-show", column: "backlog", text: "Opening night: thank-you speech", due: monthDay(1, 19), calendar: true, who: [ME] }),
    task({ id: "m3", list: "l-studio", column: "backlog", text: "Renew the studio lease", due: monthDay(2, 3), calendar: true }),
    task({ id: "m4", list: "l-show", column: "backlog", text: "Take down the exhibition", due: monthDay(3, 12), calendar: true, who: ["p-anton", "p-gustav"] }),
    task({ id: "m5", list: "l-home", column: "backlog", text: "Plan the summer house week", due: monthDay(4, 2), calendar: true }),
    task({ id: "m6", list: "l-show", column: "backlog", text: "Press preview at the harbour", due: monthDay(1, 16), calendar: true, who: [ME, "p-anton"] }),
    task({ id: "m7", list: "l-cat", column: "backlog", text: "Catalogue launch at the bookshop", due: monthDay(1, 27), calendar: true, who: ["p-frida"] }),
    task({ id: "m8", list: "l-studio", column: "backlog", text: "Apply for the spring residency", due: monthDay(2, 14), calendar: true, who: [ME] }),
    task({ id: "m9", list: "l-show", column: "backlog", text: "Artist talk with the curator", due: monthDay(2, 25), calendar: true, who: [ME, "p-gustav"] }),
    task({ id: "m10", list: "l-studio", column: "backlog", text: "Year review with the team", due: monthDay(3, 5), calendar: true, who: [ME, "p-anton", "p-frida", "p-gustav"] }),
    task({ id: "m11", list: "l-home", column: "backlog", text: "Book the ferry to Bornholm", due: monthDay(3, 24), calendar: true }),
    task({ id: "m12", list: "l-studio", column: "backlog", text: "Send the season's newsletter", due: monthDay(2, 8), calendar: true, who: [ME] }),
    task({ id: "m13", list: "l-cat", column: "backlog", text: "Order the catalogue reprint", due: monthDay(3, 8), calendar: true, who: ["p-frida"] }),
    task({ id: "m14", list: "l-show", column: "backlog", text: "Spring show: first plan", due: monthDay(4, 4), calendar: true, who: [ME, "p-anton"] }),

    // Someday: no date.
    { id: "b1", list: "l-studio", column: "backlog", text: "Clear the shelf by the window" },
    { id: "b2", list: "l-cat", column: "backlog", text: "Write the thank-you page" },
    { id: "b3", list: "l-home", column: "backlog", text: "Renew the library card" },
  ];
}

/** The connected calendars. The addresses go nowhere: a sync fails and keeps these events. */
export const CALENDARS = [
  { id: "cal-work", name: "Work", url: "https://calendar.example/work.ics", fontColor: "#4a90e2" },
  { id: "cal-home", name: "Home", url: "https://calendar.example/home.ics", fontColor: "#8e6cc7" },
];

type Calendar = (typeof CALENDARS)[number];

function event(cal: Calendar, uid: string, text: string, dateKey: string, time?: [string, string]) {
  return {
    id: `cal-${uid}`,
    text,
    dateKey,
    offsetX: 0,
    isCalendarEvent: true,
    calendarEventUid: uid,
    isAllDay: !time,
    startMinutes: time ? at(time[0]) : null,
    endMinutes: time ? at(time[1]) : null,
    source: "calendar",
    calendarId: cal.id,
    calendarName: cal.name,
    fontFamily: "Inter",
    fontColor: cal.fontColor,
  };
}

/** The events of the connected calendars, as the calendar keeps them after a sync. */
export function demoEvents() {
  const [work, home] = CALENDARS;
  return {
    notes: [
      // This week, around the tasks' blocks.
      event(work, "e1", "Studio stand-up", weekday(0), ["09:30", "10:00"]),
      event(work, "e2", "Lunch with Caroline Citron", weekday(1), ["12:00", "13:00"]),
      event(work, "e3", "Print check at the printer's", weekday(2), ["10:00", "11:30"]),
      event(work, "e4", "Call with the arts centre", weekday(3), ["15:00", "16:00"]),
      event(work, "e5", "Studio stand-up", weekday(4), ["09:30", "10:00"]),
      event(home, "e6", "Swimming with Karen", weekday(1), ["17:30", "18:30"]),
      event(home, "e7", "Dinner at Jens and Dorte's", weekday(4), ["18:30", "21:00"]),
      event(home, "e8", "Flea market at the harbour", weekday(5), ["10:00", "13:00"]),
      // Next week.
      event(work, "e9", "Studio stand-up", weekday(0, 1), ["09:30", "10:00"]),
      event(work, "e10", "Crates collected", weekday(2, 1)),
      // The months.
      event(home, "e11", "Frida's birthday", weekday(6)),
      event(work, "e12", "Flight to Leipzig", monthDay(1, 8)),
      event(work, "e13", "Team day", monthDay(1, 14)),
      event(home, "e14", "Dentist", monthDay(2, 10), ["08:30", "09:15"]),
      event(work, "e15", "Design fair", monthDay(2, 22)),
      event(home, "e16", "Egon's wedding", monthDay(3, 20)),
      // Earlier this month, so the months open full.
      event(work, "e17", "Gallery walk-through", monthDay(0, 2)),
      event(work, "e18", "Framing workshop", monthDay(0, 6), ["10:00", "12:00"]),
      event(work, "e19", "Board meeting", monthDay(0, 9), ["14:00", "15:30"]),
      event(home, "e20", "Concert at the harbour", monthDay(0, 13)),
    ],
    lines: [],
  };
}

/** The reader's own notes on the calendar (the months). */
export function demoNotes() {
  const note = (id: string, text: string, dateKey: string) => ({ id, text, dateKey, offsetX: 8, group: "personal" });
  return [
    note("cn1", "Opening night", monthDay(1, 19)),
    note("cn2", "Leipzig", monthDay(1, 9)),
    note("cn3", "Catalogue to print", monthDay(1, 6)),
    note("cn4", "Winter show opens", monthDay(3, 3)),
    note("cn5", "Studio closed", monthDay(4, 6)),
  ];
}

/** The week view's task blocks, by task id. */
export function demoTaskTimes(tasks: DemoTask[]) {
  return Object.fromEntries(
    tasks.filter((t) => t.time).map((t) => [t.id, { startMinutes: at(t.time![0]), endMinutes: at(t.time![1]) }]),
  );
}
