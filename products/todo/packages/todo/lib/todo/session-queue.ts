/**
 * The Today session's queue: the ids it works through, in its own order.
 *
 * The page holds it, and null when no session runs. Each change below
 * leaves a null as it is: a late answer to a session that has closed does
 * not open it again. The task in hand is the first of the queue that is
 * not done.
 *
 * No React in here, so a test can read it.
 */

import type { TodoTask } from "./types";

export type SessionQueue = string[] | null;

/** A new session's queue: the open tasks of the Today column, as it stands. */
export function sessionQueueOf(today: Pick<TodoTask, "id" | "completed">[]): string[] {
  return today.filter((task) => !task.completed).map((task) => task.id);
}

/**
 * Take a finished task back up in the session.
 *
 * The task in hand is nothing more than the first of the queue that is not
 * done, so bringing one back is two things and not one: clear the tick, and
 * move it to the front. Clearing the tick alone would leave the task where
 * it happened to sit, which for one finished early is behind everything
 * still to do — and the session would look unchanged.
 */
export function queueWithFirst(ids: SessionQueue, id: string): SessionQueue {
  return ids ? [id, ...ids.filter((other) => other !== id)] : ids;
}

/** Skip: the task goes to the end of the queue, and the next one runs. */
export function queueWithLast(ids: SessionQueue, id: string): SessionQueue {
  return ids ? [...ids.filter((other) => other !== id), id] : ids;
}

/** A task added inside the session joins the end of its queue. */
export function queueWithAdded(ids: SessionQueue, id: string): SessionQueue {
  return ids ? [...ids, id] : ids;
}

/** The order the session's list was dragged into, and the rest after it. */
export function queueReordered(ids: SessionQueue, order: string[]): SessionQueue {
  return ids ? [...order, ...ids.filter((id) => !order.includes(id))] : ids;
}

/** The queue's tasks, in its order. A task that is gone is left out. */
export function sessionTasks<T extends Pick<TodoTask, "id">>(ids: string[], tasks: T[]): T[] {
  return ids
    .map((id) => tasks.find((task) => task.id === id))
    .filter((task): task is T => Boolean(task));
}
