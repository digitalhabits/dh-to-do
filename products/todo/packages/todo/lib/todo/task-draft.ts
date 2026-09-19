/**
 * What the add-task row holds while a task is being typed.
 *
 * One object per composer rather than a state per field: the row has six
 * fields now, and the board keeps one composer per column.
 */

import type { TodoLang } from "./i18n";

export type SubtaskDraft = {
  /** Client-side key for React and for the assign menu. Not the task id. */
  key: string;
  text: string;
  assigneeIds: string[];
};

export type TaskDraft = {
  text: string;
  /** Minutes as typed. Empty means no duration. */
  duration: string;
  assigneeIds: string[];
  /** "YYYY-MM-DD", or null. See TodoTask.dueOn. */
  dueOn: string | null;
  /** Plain text. It becomes note HTML when the task is made. */
  /** The note as HTML, from the same editor a task's own note uses. */
  notes: string;
  subtasks: SubtaskDraft[];
  /** A list picked in the row. Null means the list the tab is on. */
  listId: string | null;
};

export const EMPTY_TASK_DRAFT: TaskDraft = {
  text: "",
  duration: "",
  assigneeIds: [],
  dueOn: null,
  notes: "",
  subtasks: [],
  listId: null,
};

/** Whether anything but the title is set. */
export function draftHasExtras(draft: TaskDraft): boolean {
  return (
    draft.assigneeIds.length > 0 ||
    draft.duration !== "" ||
    draft.dueOn !== null ||
    !notesHtmlIsEmpty(draft.notes) ||
    draft.subtasks.length > 0 ||
    draft.listId !== null
  );
}

export function newDraftKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Plain text to the HTML the notes field keeps.
 *
 * The same shape the MCP writes: markup is escaped, a blank line starts a
 * paragraph, a single newline is a line break. Empty text is no note.
 */
export function plainTextToNotesHtml(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Whether a note's HTML holds nothing: no words and no picture.
 *
 * The add row writes its note in the same editor the card does, and an
 * editor that has been typed in and emptied again hands back a paragraph
 * with a line break in it, not an empty string. That is no note.
 */
export function notesHtmlIsEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<(img|figure|bc-attachment|action-text-attachment)\b/i.test(html)) {
    return false;
  }
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;| /g, " ")
    .trim();
  return text.length === 0;
}

/* ------------------------------------------------------------ due dates */

/** Today as "YYYY-MM-DD" in the reader's own zone. */
export function todayDueOn(now = new Date()): string {
  return dateToDueOn(now);
}

export function dateToDueOn(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * "YYYY-MM-DD" to a Date at local midnight.
 *
 * Not `new Date(string)`: that reads a bare date as UTC, which is the
 * evening before in the Americas and shows the wrong weekday.
 */
export function dueOnToDate(dueOn: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueOn);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Days from today to the due date: negative is overdue, 0 is today. */
export function daysUntilDue(dueOn: string, now = new Date()): number | null {
  const due = dueOnToDate(dueOn);
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/**
 * The due date as the reader says it: "Today", "Tomorrow", or "Fri, Sep 11".
 * A date in another year carries the year.
 */
export function formatDueOn(
  dueOn: string,
  lang: TodoLang,
  t: (key: string) => string,
  now = new Date()
): string {
  const date = dueOnToDate(dueOn);
  if (!date) return dueOn;
  const days = daysUntilDue(dueOn, now);
  if (days === 0) return t("dueToday");
  if (days === 1) return t("dueTomorrow");
  if (days === -1) return t("dueYesterday");
  const locale = lang === "da" ? "da-DK" : "en-US";
  return date.toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * The due date at a glance, for a chip on the card: "Today", "Tomorrow",
 * a weekday within the week ahead ("Fri"), otherwise the day and month.
 */
export function formatDueOnShort(
  dueOn: string,
  lang: TodoLang,
  t: (key: string) => string,
  now = new Date()
): string {
  const date = dueOnToDate(dueOn);
  if (!date) return dueOn;
  const days = daysUntilDue(dueOn, now);
  if (days === 0) return t("dueToday");
  if (days === 1) return t("dueTomorrow");
  if (days === -1) return t("dueYesterday");
  const locale = lang === "da" ? "da-DK" : "en-US";
  if (days != null && days > 1 && days < 7) {
    return date.toLocaleDateString(locale, { weekday: "short" });
  }
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
