/**
 * Small rules about one task, from the page: how a task read from the
 * server or an old cache is made whole, what a due date writes, the words
 * a done row and a list's letters show, and an id in or out of a list.
 *
 * No React in here, so a test can read it.
 */

import { formatSpentTime } from "./duration";
import { todayDueOn } from "./task-draft";
import { boardColumnPatch, type TodoList, type TodoTask, type TodoTaskPatch } from "./types";

/**
 * What setting a due date writes: the date, and a move to Today when the
 * date is today or already past.
 *
 * A task in Today given a later date leaves Today for Soon(-ish), the week
 * column, and so leaves a running Today session too (Ulrik, 2026-10-21):
 * it is not for today any more. It goes to the end of Soon (`soonEnd`, one
 * past the column's last position), not to the top, where its old Today
 * position put it. The board read brings it back to Today on the day (see
 * promoteDueTasks in the store). Any other task keeps its column and place.
 */
/** One past the last position in a column: its end (for dueDatePatch's `soonEnd`). */
export function columnEnd(column: Pick<TodoTask, "position">[]): number | undefined {
  if (!column.length) return undefined;
  return Math.max(...column.map((task) => task.position ?? 0)) + 1;
}

export function dueDatePatch(
  dueOn: string | null,
  current?: Pick<TodoTask, "isToday">,
  soonEnd?: number
): TodoTaskPatch {
  if (dueOn && dueOn <= todayDueOn()) return { dueOn, ...boardColumnPatch("today") };
  if (dueOn && current?.isToday) {
    return { dueOn, ...boardColumnPatch("week"), ...(soonEnd != null ? { position: soonEnd } : null) };
  }
  return { dueOn };
}

/** Normalize task flags from API / older page-cache snapshots. */
export function normalizeTaskAssignees(task: TodoTask): TodoTask {
  const legacyId = (task as TodoTask & { assigneeId?: string | null }).assigneeId;
  const assigneeIds = Array.isArray(task.assigneeIds)
    ? task.assigneeIds
    : legacyId
      ? [legacyId]
      : [];
  return {
    ...task,
    isBacklog: Boolean(task.isBacklog),
    isToday:
      typeof task.isToday === "boolean"
        ? task.isToday
        : Boolean(task.isFavourite && !task.isBacklog && !task.isSomeday),
    isSomeday: Boolean(task.isSomeday),
    assigneeIds,
  };
}

/** A task on no list: the reader's own, shown on the All tab alone. */
export function isUnlistedTask(task: Pick<TodoTask, "listId">): boolean {
  return task.listId === null;
}

/**
 * The time a done task took, in hours and minutes as a duration is said
 * ("1h 15m"), and "<1m" under a minute. The units are the language's letters (t("minutes"), t("hoursShort")).
 */
export function timeSpentLabel(
  seconds: number,
  minuteUnit = "m",
  hourUnit = "h"
): string {
  return formatSpentTime(seconds, minuteUnit, hourUnit);
}

/** One flight, keyed by the row it lands on. */
export function animTargetKey(taskId: string, completed: boolean): string {
  return `${taskId}:${completed ? 1 : 0}`;
}

export function listOriginLetters(list: TodoList | undefined): string {
  if (!list) return "?";
  const letters = list.name.replace(/[^\p{L}\p{N}]+/gu, "");
  return (letters.slice(0, 2) || list.name.slice(0, 2) || "?").toUpperCase();
}

/** The ids with `id` taken out, or put in at the end. */
export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
}
