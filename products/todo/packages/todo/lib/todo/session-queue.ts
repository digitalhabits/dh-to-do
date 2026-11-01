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

/**
 * A new session's queue: the open tasks of the Today column, as it stands,
 * after the steps due today that the board shows above it.
 */
export function sessionQueueOf(
  today: Pick<TodoTask, "id" | "completed">[],
  steps: Pick<TodoTask, "id" | "completed">[] = []
): string[] {
  return [...steps, ...today].filter((task) => !task.completed).map((task) => task.id);
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

/**
 * The session's tasks, from the board: the open ones are the Today column's,
 * in the board's order, and the finished ones are the ones of this session's
 * queue that are done. So a task whose date moves off today leaves the
 * session, a task added to Today joins it, and an order changed on either
 * side is the one order both show.
 *
 * The steps the board shows above Today (due today or before, see
 * stepsDueToday) are in the session too. A step has no place in the
 * column's order, so the queue places it: before the first column task
 * that comes after it in the queue. A step that is not in the queue (it
 * came due during the session) goes first, as on the board.
 */
export function sessionTasksFromBoard<T extends Pick<TodoTask, "id" | "completed">>(
  ids: string[],
  todayColumn: T[],
  tasks: T[],
  steps: T[] = []
): T[] {
  const open = withStepsPlaced(
    ids,
    todayColumn.filter((task) => !task.completed),
    steps.filter((step) => !step.completed)
  );
  const done = ids
    .map((id) => tasks.find((task) => task.id === id))
    .filter((task): task is T => Boolean(task?.completed));
  return [...open, ...done];
}

function withStepsPlaced<T extends Pick<TodoTask, "id">>(
  ids: string[],
  open: T[],
  steps: T[]
): T[] {
  if (steps.length === 0) return open;
  const at = new Map(ids.map((id, index) => [id, index]));
  const queued = steps
    .filter((step) => at.has(step.id))
    .sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  const out = steps.filter((step) => !at.has(step.id));
  let next = 0;
  for (const task of open) {
    const place = at.get(task.id);
    if (place !== undefined) {
      while (next < queued.length && at.get(queued[next].id)! < place) out.push(queued[next++]);
    }
    out.push(task);
  }
  return [...out, ...queued.slice(next)];
}
