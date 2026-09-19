/**
 * The tasks a browser kept on its own, handed to the server.
 *
 * Before a task could be on no list, a task added on the All tab stayed in
 * the browser that made it, under one localStorage key, until it was put
 * on a list. It was in no database and in no backup. Now such a task is a
 * row like any other, with no list, personal to whoever made it. This
 * moves what a browser still holds: each task goes to the server as the
 * reader's own, and leaves the browser once it is there.
 *
 * The tasks are taken out of the store before any is sent, and only the
 * ones that would not go are put back at the end. Two runs at once — a
 * page reloaded while the first was still sending, a second tab — used
 * to read the same list and send it twice, and the board showed each
 * task twice. Now the second run finds the store already empty.
 */

import { DUE_ON_RE, type TodoTask } from "./types";
import { randomUUID } from "./uuid";

/** Where the old page kept them. The name is the old one on purpose. */
export const BROWSER_TASKS_KEY = "redd-plan-todo-local-tasks";

type Api = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What the old page wrote: whole tasks, with ids of its own making. */
function readBrowserTasks(store: Store): Partial<TodoTask>[] {
  try {
    const raw = store.getItem(BROWSER_TASKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is Partial<TodoTask> =>
        Boolean(row) &&
        typeof row === "object" &&
        typeof (row as TodoTask).text === "string" &&
        (row as TodoTask).text.trim().length > 0,
    );
  } catch {
    return [];
  }
}

function writeBrowserTasks(store: Store, tasks: Partial<TodoTask>[]) {
  try {
    if (tasks.length) store.setItem(BROWSER_TASKS_KEY, JSON.stringify(tasks));
    else store.removeItem(BROWSER_TASKS_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Send the browser's tasks to the server, oldest first. Returns how many
 * went. Stops at the first task the server would not take, and keeps that
 * one and the rest for the next try.
 */
export async function rescueBrowserTasks(
  api: Api,
  store: Store | null = typeof localStorage === "undefined"
    ? null
    : localStorage,
  newId: () => string = randomUUID,
): Promise<number> {
  if (!store) return 0;
  let waiting = readBrowserTasks(store);
  // Claimed: from here the tasks are this run's, and another run that
  // starts now has nothing to send.
  writeBrowserTasks(store, []);
  if (!waiting.length) return 0;
  let rescued = 0;
  try {
    while (waiting.length) {
      const task = waiting[0];
      let created: { id: string } | undefined;
      try {
        const json = await api("/api/todo/tasks", "POST", {
          id: newId(),
          listId: null,
          text: task.text,
          notesHtml: task.notesHtml ?? null,
          dueOn:
            typeof task.dueOn === "string" && DUE_ON_RE.test(task.dueOn)
              ? task.dueOn
              : null,
          expectedDurationMinutes: task.expectedDurationMinutes ?? null,
          isFavourite: Boolean(task.isFavourite),
          isBacklog: Boolean(task.isBacklog),
          isToday: Boolean(task.isToday),
          isSomeday: Boolean(task.isSomeday),
          completed: Boolean(task.completed),
          assigneeIds: Array.isArray(task.assigneeIds) ? task.assigneeIds : [],
        });
        created = json.task as { id: string } | undefined;
      } catch {
        break;
      }
      // The rest of what the browser knew. The task is on the server whether
      // or not this lands, so a failure here does not hold the others up.
      const follow: Record<string, unknown> = {};
      if (task.colour) follow.colour = task.colour;
      if (task.timeSpentSeconds)
        follow.timeSpentSeconds = task.timeSpentSeconds;
      if (task.favouritePosition != null) {
        follow.favouritePosition = task.favouritePosition;
      }
      if (created && Object.keys(follow).length) {
        try {
          await api("/api/todo/tasks", "PATCH", { id: created.id, ...follow });
        } catch {
          /* reported nowhere: the task itself is safe */
        }
      }
      waiting = waiting.slice(1);
      rescued += 1;
    }
  } finally {
    // What would not go waits for the next load, behind whatever another
    // run may have put there meanwhile.
    if (waiting.length)
      writeBrowserTasks(store, [...readBrowserTasks(store), ...waiting]);
  }
  return rescued;
}
