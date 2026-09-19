/**
 * When a task was finished, said the way the mail list says when a
 * message came: a heading per stretch of days, and a stamp on the row.
 *
 * The rules are Mail's (`products/mail/.../lib/mail/date-format.ts`): the
 * two products share no code, so they are written out again here rather
 * than reached across for. Pure functions — they read the clock and the
 * language, and nothing else.
 */

import type { TodoLang } from "@/lib/todo/i18n";

/** The headings a done pile is cut into, newest first. */
export const DONE_BUCKETS = [
  "doneToday",
  "doneYesterday",
  "doneEarlierThisWeek",
  "doneLastWeek",
  "doneEarlier",
] as const;

export type DoneBucket = (typeof DONE_BUCKETS)[number];

function startOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The heading a finish belongs under. A task finished before the app kept
 * the hour — or with the hour lost — falls to the foot, under "Earlier".
 */
export function doneBucket(completedAt: string | null, now = new Date()): DoneBucket {
  const at = completedAt ? new Date(completedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return "doneEarlier";
  const today = startOfDay(now);
  const then = startOfDay(at);
  if (then >= today) return "doneToday";
  if (then >= today - DAY_MS) return "doneYesterday";
  const daysAgo = Math.floor((today - then) / DAY_MS);
  // Monday-based: how far into this week we are.
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  if (daysAgo < weekday) return "doneEarlierThisWeek";
  if (daysAgo < weekday + 7) return "doneLastWeek";
  return "doneEarlier";
}

/**
 * The stamp on the row. Today and yesterday have a heading of their own
 * above them, so there the hour is what is left to say; further back the
 * day is, and further back still the date.
 */
export function doneStamp(
  completedAt: string | null,
  lang: TodoLang,
  now = new Date()
): string {
  const at = completedAt ? new Date(completedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  /*
    Mail's own choice: Danish is Danish, and English is left to the
    machine — so the clock reads 24-hour on a machine that does, which is
    what the mail list beside this one shows.
  */
  const locale = lang === "da" ? "da-DK" : undefined;
  const bucket = doneBucket(completedAt, now);
  if (bucket === "doneToday" || bucket === "doneYesterday") {
    return at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (bucket === "doneEarlierThisWeek") {
    return at.toLocaleDateString(locale, { weekday: "short" });
  }
  return at.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: at.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * The done pile cut into its headings, in the order the headings read.
 * An empty stretch is left out, so the pile of one day carries one
 * heading. The tasks keep the order they came in — newest finish first.
 */
export function groupDoneTasks<T extends { completedAt: string | null }>(
  tasks: T[],
  now = new Date()
): { bucket: DoneBucket; tasks: T[] }[] {
  const byBucket = new Map<DoneBucket, T[]>();
  for (const task of tasks) {
    const bucket = doneBucket(task.completedAt, now);
    const held = byBucket.get(bucket);
    if (held) held.push(task);
    else byBucket.set(bucket, [task]);
  }
  return DONE_BUCKETS.filter((bucket) => byBucket.has(bucket)).map((bucket) => ({
    bucket,
    tasks: byBucket.get(bucket) as T[],
  }));
}
