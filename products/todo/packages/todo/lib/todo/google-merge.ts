/**
 * The three-copy rule for a task and its Google task, as pure functions.
 *
 * The same rule as the GitHub sync (github-merge.ts), and `settle` is that
 * file's: each side is measured against the last state both sides held,
 * the base. A field changed on a side when it differs from the base. The
 * clock decides only when both sides changed the same field.
 *
 * The note needs its own rule. Google keeps a note as plain text; this
 * app keeps it with bold, lists and pictures. So the two are compared as
 * plain text, and a note that Google did not change is never drawn again
 * from Google's copy: its formatting stays.
 *
 * Part of google.ts, which re-exports what the rest of the app uses.
 */

import { decodeEntities, notePictures } from "./github-markdown";
import { fitNotes } from "./google-tasks";

/** The last state both sides held. Kept as JSON in todo_tasks.google_base. */
export type GoogleBase = {
  /** The account and the Google list the task is on. */
  account: string;
  list: string;
  title: string;
  /** The note as Google holds it: plain text. */
  notes: string;
  /** The note as this side holds it, in HTML. */
  notesHtml: string;
  done: boolean;
  /** "YYYY-MM-DD", or null. */
  due: string | null;
  /** The Google id of the task this one is a subtask of, or null. */
  parent: string | null;
};

export function parseGoogleBase(value: unknown): GoogleBase | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const base = JSON.parse(value) as Partial<GoogleBase>;
    if (typeof base.title !== "string" || typeof base.list !== "string") return null;
    return {
      account: base.account ?? "",
      list: base.list,
      title: base.title,
      notes: base.notes ?? "",
      notesHtml: base.notesHtml ?? "",
      done: Boolean(base.done),
      due: base.due ?? null,
      parent: base.parent ?? null,
    };
  } catch {
    return null;
  }
}

/** Google's `due` to the board's day, and back. */
export function dueFromGoogle(due: string | undefined | null): string | null {
  return due && /^\d{4}-\d{2}-\d{2}/.test(due) ? due.slice(0, 10) : null;
}

export function dueToGoogle(dueOn: string | null): string | null {
  return dueOn ? `${dueOn}T00:00:00.000Z` : null;
}

/** One spelling of a plain note: no carriage returns, no space at the ends. */
export function normalizePlain(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A note's words as plain text, the way Google can hold them. A block or a
 * line break ends a line, a list item starts with "- ", and a picture is
 * left out (Google has no place for it). No DOM: the sync also runs in
 * tests under Node.
 */
export function htmlToPlain(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<figure\b[\s\S]*?<\/figure>|<bc-attachment\b[\s\S]*?<\/bc-attachment>/gi, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<\/(div|p|li|h[1-6]|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normalizePlain(decodeEntities(text));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A plain note as the notes editor keeps one: one block, a line break for
 * each new line, so an empty line between two parts stays an empty line.
 */
export function plainToHtml(text: string | null | undefined): string {
  const plain = normalizePlain(text);
  if (!plain) return "";
  return `<div>${plain.split("\n").map(escapeHtml).join("<br>")}</div>`;
}

export type SettledNotes = {
  /** The note for this side. */
  html: string;
  /** The note for Google. */
  plain: string;
  push: boolean;
  pull: boolean;
};

/**
 * Which note to believe. Each side is measured in plain text against what
 * it held at the base: this side's HTML then, and Google's text then.
 * When Google's copy wins, the local pictures stay under the new words.
 */
export function settleGoogleNotes(
  localHtml: string,
  remotePlain: string,
  base: Pick<GoogleBase, "notes" | "notesHtml"> | null,
  localIsNewer: boolean,
  /** Cuts a note to what the other side can hold. Microsoft's sync gives its own. */
  fit: (notes: string) => string = fitNotes
): SettledNotes {
  const local = htmlToPlain(localHtml);
  const remote = normalizePlain(remotePlain);
  const none: SettledNotes = { html: localHtml, plain: remote, push: false, pull: false };
  if (fit(local) === remote) return none;
  const localMoved = base ? htmlToPlain(base.notesHtml) !== local : true;
  const remoteMoved = base ? normalizePlain(base.notes) !== remote : true;
  if (!localMoved && !remoteMoved) return none;
  if (remoteMoved && (!localMoved || !localIsNewer)) {
    return {
      html: plainToHtml(remote) + notePictures(localHtml),
      plain: remote,
      push: false,
      pull: true,
    };
  }
  return { html: localHtml, plain: fit(local), push: true, pull: false };
}
