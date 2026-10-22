/**
 * The three-copy rule for a task and its issue, as pure functions.
 *
 * The same rule as the Basecamp sync (basecamp-sync.ts): each side is
 * measured against the last state both sides held, the base. A field
 * changed on a side when it differs from the base, and only then. Each
 * field settles on its own, so a title edited here and a body edited on
 * GitHub both survive. The clock decides only when both sides changed the
 * same field, or when there is no base to measure against.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import {
  type BodySubtask,
  htmlToMarkdown,
  markdownToHtml,
  normalizeMarkdown,
  notePictures,
} from "./github-markdown";

/** The last state both sides held. Kept as JSON in todo_tasks.github_base. */
export type GithubBase = {
  title: string;
  /** The note part of the body, in markdown, as GitHub holds it. */
  body: string;
  /** The note as this side holds it, in HTML. */
  notesHtml: string;
  closed: boolean;
  /** Lower-cased logins, sorted. */
  assignees: string[];
  subtasks: BodySubtask[];
  /**
   * Which converter drew notesHtml from the body. A note drawn by an older
   * one, and not edited here since, is drawn again (github-sync.ts).
   */
  notesFormat?: number;
};

/**
 * The note converter's version. 2: pictures from GitHub are pictures (1
 * showed their tags as text).
 */
export const GITHUB_NOTES_FORMAT = 2;

export function parseGithubBase(value: unknown): GithubBase | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const base = JSON.parse(value) as Partial<GithubBase>;
    if (typeof base.title !== "string") return null;
    return {
      title: base.title,
      body: base.body ?? "",
      notesHtml: base.notesHtml ?? "",
      closed: Boolean(base.closed),
      assignees: Array.isArray(base.assignees) ? base.assignees : [],
      subtasks: Array.isArray(base.subtasks) ? base.subtasks : [],
      notesFormat: typeof base.notesFormat === "number" ? base.notesFormat : 1,
    };
  } catch {
    return null;
  }
}

export type Settled<T> = { value: T; push: boolean; pull: boolean };

/** Which side to believe for one field. */
export function settle<T>(
  local: T,
  remote: T,
  base: T | null,
  localIsNewer: boolean,
  same: (a: T, b: T) => boolean = (a, b) => a === b
): Settled<T> {
  if (same(local, remote)) return { value: local, push: false, pull: false };
  if (base !== null) {
    const localMoved = !same(local, base);
    const remoteMoved = !same(remote, base);
    if (localMoved && !remoteMoved) return { value: local, push: true, pull: false };
    if (remoteMoved && !localMoved) return { value: remote, push: false, pull: true };
  }
  return localIsNewer
    ? { value: local, push: true, pull: false }
    : { value: remote, push: false, pull: true };
}

/**
 * The note. Compared as markdown on both sides, so a note that only
 * changed its HTML (a picture added, an attribute Trix wrote) is no edit
 * GitHub can see. A note taken from GitHub keeps the local pictures.
 */
export function settleNotes(
  localHtml: string,
  remoteMd: string,
  base: GithubBase | null,
  localIsNewer: boolean
): { html: string; markdown: string; push: boolean; pull: boolean } {
  const localMd = htmlToMarkdown(localHtml);
  const remote = normalizeMarkdown(remoteMd);
  const none = { html: localHtml, markdown: remote, push: false, pull: false };
  if (localMd === remote) return none;
  // Each side against what it held: the HTML this side wrote last, and
  // the markdown GitHub held last.
  const localMoved = base ? htmlToMarkdown(base.notesHtml) !== localMd : true;
  const remoteMoved = base ? normalizeMarkdown(base.body) !== remote : true;
  if (!localMoved && !remoteMoved) return none;
  if (remoteMoved && (!localMoved || !localIsNewer)) {
    return {
      html: markdownToHtml(remote) + notePictures(localHtml),
      markdown: remote,
      push: false,
      pull: true,
    };
  }
  return { html: localHtml, markdown: localMd, push: true, pull: false };
}

/** Logins as one comparable value. */
export function loginSet(logins: string[]): string[] {
  return [...new Set(logins.map((l) => l.toLowerCase()))].sort();
}

export function sameLogins(a: string[], b: string[]): boolean {
  return loginSet(a).join(",") === loginSet(b).join(",");
}

/** Subtasks are matched by their text; the same text twice is two keys. */
function keyed(items: BodySubtask[]): Map<string, BodySubtask> {
  const map = new Map<string, BodySubtask>();
  const counts = new Map<string, number>();
  for (const item of items) {
    const text = item.text.trim();
    const n = (counts.get(text) ?? 0) + 1;
    counts.set(text, n);
    map.set(n === 1 ? text : `${text}\u0000${n}`, { text, done: item.done });
  }
  return map;
}

export function sameSubtasks(a: BodySubtask[], b: BodySubtask[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, i) => item.text.trim() === b[i].text.trim() && item.done === b[i].done)
  );
}

/**
 * The subtasks, item by item.
 *
 * A checkbox has no id, so an item is its text. A tick settles like any
 * field. An item on one side only was added there when the base does not
 * have it, and taken away on the other side when the base does. A renamed
 * item is one taken away and one added. Changed on one side and taken away
 * on the other, the change wins: work is not lost to a delete.
 *
 * The order is the local order, with items new from GitHub after the rest.
 */
export function mergeSubtasks(
  local: BodySubtask[],
  remote: BodySubtask[],
  base: BodySubtask[] | null,
  localIsNewer: boolean
): BodySubtask[] {
  if (sameSubtasks(local, remote)) return local;
  if (base === null) return localIsNewer ? local : remote;
  if (sameSubtasks(remote, base)) return local;
  if (sameSubtasks(local, base)) return remote;

  const l = keyed(local);
  const r = keyed(remote);
  const b = keyed(base);
  const out: BodySubtask[] = [];
  for (const [key, mine] of l) {
    const theirs = r.get(key);
    const was = b.get(key);
    if (theirs) {
      out.push({
        text: mine.text,
        done: settle(mine.done, theirs.done, was ? was.done : null, localIsNewer).value,
      });
    } else if (!was || mine.done !== was.done) {
      out.push(mine);
    }
  }
  for (const [key, theirs] of r) {
    if (l.has(key)) continue;
    const was = b.get(key);
    if (!was || theirs.done !== was.done) out.push(theirs);
  }
  return out;
}
