/**
 * Whose tasks the board shows: mine, or everyone's.
 *
 * The board is shared, and most of the day a reader wants their own slice
 * of it: the tasks they are on, and the tasks with nobody on them that
 * they made — a task handed to a colleague is the colleague's to do.
 * That is "My tasks". "Everyone" is the whole board, and only there
 * are the person pills offered, for looking at one colleague's work.
 *
 * The reader is matched to the roster by email, so the same person on
 * two boards is found on both. With nobody matched — a mailbox not on the
 * roster, or the desktop app, which has no login — there is no "mine" and
 * the board shows everyone.
 *
 * No React in here, so a test can read it.
 */

import type { TodoPerson, TodoTask } from "./types";

export type PeopleScope = "mine" | "everyone";

/** Kept per device, so a board opens the way it was left. */
export const PEOPLE_SCOPE_KEY = "redd-plan-todo-people-scope";

/**
 * The person the reader marked as "Me" in the People dialog. Kept per device:
 * the desktop app has no login, so nothing else says who the reader is.
 */
export const ME_PERSON_KEY = "redd-plan-todo-me-person";

/**
 * The roster rows that are the reader: the rows with one of the reader's
 * addresses, and the row the reader marked as "Me". A mark on a person who
 * is not on the roster any more counts for nothing.
 */
export function mePersonIds(
  people: TodoPerson[],
  viewerEmails: string[],
  markedId?: string | null,
): string[] {
  const mine = new Set(viewerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return people
    .filter(
      (p) =>
        (markedId != null && p.id === markedId) ||
        (p.email != null && p.email !== "" && mine.has(p.email.trim().toLowerCase())),
    )
    .map((p) => p.id);
}

/**
 * The maker the desktop app writes on the tasks it adds. The app has no
 * login, so the one reader of the device made them.
 */
export const THIS_DEVICE_MAKER = "this-device";

type ScopedTask = Pick<TodoTask, "assigneeIds" | "listId" | "createdBy" | "basecampId">;

/**
 * Whether the reader made a task. `makers` are the keys the reader's tasks
 * carry in `createdBy`. On the desktop app a task with no maker and not
 * from Basecamp was made on the device too: added before the app wrote a
 * maker, carried over from 2.x, or brought in from Reminders.
 */
function madeByReader(task: ScopedTask, makers: Set<string>): boolean {
  if (task.createdBy != null) return makers.has(task.createdBy);
  return makers.has(THIS_DEVICE_MAKER) && task.basecampId == null;
}

/**
 * Whether a task is the reader's: they are on it, or nobody is on it and
 * they made it. A task on no list is always its maker's, because the board
 * reads only the reader's own. A task with someone else on it is theirs.
 */
export function isMyTask(task: ScopedTask, me: Set<string>, makers: Set<string>): boolean {
  if (task.assigneeIds.some((id) => me.has(id))) return true;
  if (task.assigneeIds.length > 0) return false;
  return task.listId === null || madeByReader(task, makers);
}

/**
 * The tasks the board shows under a scope. On "mine", the reader's own;
 * on "everyone", all of them, or those on any of the chosen people.
 */
export function tasksInScope<T extends ScopedTask>(
  tasks: T[],
  scope: PeopleScope,
  me: string[],
  chosen: string[],
  makers: string[] = []
): T[] {
  if (scope === "mine") {
    const mine = new Set(me);
    const made = new Set(makers);
    return tasks.filter((t) => isMyTask(t, mine, made));
  }
  if (!chosen.length) return tasks;
  const selected = new Set(chosen);
  return tasks.filter((t) => t.assigneeIds.some((id) => selected.has(id)));
}
