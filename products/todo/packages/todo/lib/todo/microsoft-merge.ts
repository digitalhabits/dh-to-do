/**
 * What a task and its Microsoft task both held last (the base), and the
 * two fields that Microsoft keeps in its own way: the due day and the note.
 *
 * The three-copy rule itself is the GitHub sync's `settle`
 * (github-merge.ts), and the note rule is the Google sync's
 * (google-merge.ts): Microsoft To Do keeps a note as plain text too.
 *
 * Part of microsoft.ts, which re-exports what the rest of the app uses.
 */

import { htmlToPlain, normalizePlain } from "./google-merge";
import type { MicrosoftDateTime, MicrosoftTask } from "./microsoft-tasks";

/** The last state both sides held. Kept as JSON in todo_microsoft_tasks.base. */
export type MicrosoftBase = {
  /** The account and the Microsoft list the task is on. */
  account: string;
  list: string;
  title: string;
  /** The note as Microsoft holds it: plain text. */
  notes: string;
  /** The note as this side holds it, in HTML. */
  notesHtml: string;
  done: boolean;
  /** "YYYY-MM-DD", or null. */
  due: string | null;
};

export function parseMicrosoftBase(value: unknown): MicrosoftBase | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const base = JSON.parse(value) as Partial<MicrosoftBase>;
    if (typeof base.title !== "string" || typeof base.list !== "string") return null;
    return {
      account: base.account ?? "",
      list: base.list,
      title: base.title,
      notes: base.notes ?? "",
      notesHtml: base.notesHtml ?? "",
      done: Boolean(base.done),
      due: base.due ?? null,
    };
  } catch {
    return null;
  }
}

const HALF_DAY_MS = 12 * 60 * 60_000;

function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * Microsoft's due time as the board's day.
 *
 * Microsoft To Do keeps a due day as the start of that day where the
 * person was, and Graph gives that moment in UTC. For a person in
 * Copenhagen, 20 November reads "2026-11-19T23:00:00" UTC. So the day is
 * the local day of that moment, and not the first ten characters.
 *
 * Half a day is added first. The moment is then near noon of the right
 * day, so a task made in another time zone (on a journey, or by a
 * colleague) gives the right day too.
 *
 * A time in a zone other than UTC is a wall-clock time: its day is as
 * written.
 */
export function dueFromMicrosoft(due: MicrosoftDateTime | null | undefined): string | null {
  const text = due?.dateTime ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return null;
  if (due?.timeZone && due.timeZone.toUpperCase() !== "UTC") return text.slice(0, 10);
  // Seven decimals from Graph; a Date reads three.
  const ms = Date.parse(`${text.slice(0, 19)}Z`);
  if (Number.isNaN(ms)) return null;
  return localDay(new Date(ms + HALF_DAY_MS));
}

/** The board's day as Microsoft keeps one: the start of that day here, in UTC. */
export function dueToMicrosoft(dueOn: string | null): MicrosoftDateTime | null {
  const m = dueOn?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { dateTime: `${start.toISOString().slice(0, 19)}.0000000`, timeZone: "UTC" };
}

/** A task's note as plain text, in one spelling. */
export function notesFromMicrosoft(body: MicrosoftTask["body"]): string {
  const content = body?.content ?? "";
  if (body?.contentType?.toLowerCase() !== "html") return normalizePlain(content);
  // In HTML a line end in the source is a space, and none between two tags.
  return htmlToPlain(content.replace(/>\s+</g, "><").replace(/\s*\r?\n\s*/g, " "));
}
