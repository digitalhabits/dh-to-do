/**
 * Apple Reminders sync for a linked list. Unlike Basecamp (server-side),
 * EventKit lives on the user's Mac, so this runs in the client: the desktop
 * shell bridges to EventKit and the shared board is updated through the
 * normal to-do API. Model matches the Basecamp sync: local actions push
 * immediately (see TodoPage), so on sync the Reminders side is authoritative
 * for linked tasks, unknown reminders are pulled in, vanished ones removed,
 * and never-pushed local tasks are created in Reminders.
 */
import {
  createRemindersTask,
  fetchRemindersTasks,
  updateRemindersStatus,
} from "@/lib/native-shell";

import type { TodoList, TodoTask } from "./types";

/** The board's api: `(path, method, body)`, answering with the parsed JSON. */
export type RemindersSyncApi = (
  path: string,
  method: string,
  body?: unknown
) => Promise<Record<string, unknown>>;

/**
 * The api when the host gives none: a request to the server.
 *
 * Right for the planner, and only there. The desktop app has no server: its
 * board is a SQLite file, and the page's own api writes to it. This module
 * once always used the request below. In the desktop app every write then
 * went to a page that does not exist, so a list from Reminders came in with
 * its name and none of its tasks. The page now passes its api in `options`.
 */
async function serverApi(
  path: string,
  method: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((json.error as string) || `Request failed (${res.status})`);
  }
  return json;
}

/** Run async work over items with a fixed concurrency limit. */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export type RemindersSyncProgress = {
  phase: "reading" | "importing" | "updating" | "pushing" | "removing";
  done: number;
  total: number;
};

export type RemindersSyncOptions = {
  /** How to write to the board. The page passes its own. See `serverApi`. */
  api?: RemindersSyncApi;
  onProgress?: (progress: RemindersSyncProgress) => void;
  /** Called as soon as each pulled task is saved (for live UI). */
  onTaskPulled?: (task: TodoTask) => void;
  /** Parallel API creates when importing many reminders. */
  pullConcurrency?: number;
};

export async function syncRemindersList(
  list: TodoList,
  tasks: TodoTask[],
  options: RemindersSyncOptions = {}
): Promise<{ pulled: number; pushed: number; removed: number; updated: number }> {
  if (!list.remindersListId) {
    throw new Error("List is not linked to Apple Reminders");
  }
  const api = options.api ?? serverApi;

  options.onProgress?.({ phase: "reading", done: 0, total: 0 });
  const remote = await fetchRemindersTasks(list.remindersListId);
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const counts = { pulled: 0, pushed: 0, removed: 0, updated: 0 };
  const seen = new Set<string>();

  const toUpdate: { task: TodoTask; reminder: (typeof remote)[number] }[] = [];
  const toRemove: TodoTask[] = [];
  const toPush: TodoTask[] = [];

  for (const task of tasks) {
    if (task.remindersId && remoteById.has(task.remindersId)) {
      seen.add(task.remindersId);
      const reminder = remoteById.get(task.remindersId)!;
      if (
        reminder.completed !== task.completed ||
        reminder.name !== task.text ||
        (reminder.dueOn ?? null) !== task.dueOn
      ) {
        toUpdate.push({ task, reminder });
      }
    } else if (task.remindersId) {
      toRemove.push(task);
    } else {
      toPush.push(task);
    }
  }

  const toPull = remote.filter(
    (reminder) =>
      !seen.has(reminder.id) &&
      !tasks.some((task) => task.remindersId === reminder.id)
  );

  if (toUpdate.length) {
    options.onProgress?.({
      phase: "updating",
      done: 0,
      total: toUpdate.length,
    });
    let done = 0;
    await mapPool(toUpdate, 6, async ({ task, reminder }) => {
      await api("/api/todo/tasks", "PATCH", {
        id: task.id,
        text: reminder.name,
        completed: reminder.completed,
        dueOn: reminder.dueOn ?? null,
      });
      counts.updated += 1;
      done += 1;
      options.onProgress?.({
        phase: "updating",
        done,
        total: toUpdate.length,
      });
    });
  }

  if (toRemove.length) {
    options.onProgress?.({
      phase: "removing",
      done: 0,
      total: toRemove.length,
    });
    let done = 0;
    await mapPool(toRemove, 6, async (task) => {
      await api(`/api/todo/tasks?id=${encodeURIComponent(task.id)}`, "DELETE");
      counts.removed += 1;
      done += 1;
      options.onProgress?.({
        phase: "removing",
        done,
        total: toRemove.length,
      });
    });
  }

  if (toPush.length) {
    options.onProgress?.({
      phase: "pushing",
      done: 0,
      total: toPush.length,
    });
    let done = 0;
    // EventKit writes stay serial — Apple’s store is picky about parallel creates.
    for (const task of toPush) {
      const created = await createRemindersTask(
        list.remindersListId,
        task.text,
        task.dueOn
      );
      if (created.id) {
        if (task.completed) {
          await updateRemindersStatus(created.id, true);
        }
        await api("/api/todo/tasks", "PATCH", {
          id: task.id,
          remindersId: created.id,
        });
      }
      counts.pushed += 1;
      done += 1;
      options.onProgress?.({
        phase: "pushing",
        done,
        total: toPush.length,
      });
    }
  }

  if (toPull.length) {
    options.onProgress?.({
      phase: "importing",
      done: 0,
      total: toPull.length,
    });
    let done = 0;
    const concurrency = options.pullConcurrency ?? 8;
    await mapPool(toPull, concurrency, async (reminder) => {
      const json = await api("/api/todo/tasks", "POST", {
        listId: list.id,
        text: reminder.name,
        remindersId: reminder.id,
        dueOn: reminder.dueOn ?? null,
        ...(reminder.completed ? { completed: true } : {}),
      });
      const task = json.task as TodoTask;
      counts.pulled += 1;
      done += 1;
      options.onTaskPulled?.(task);
      options.onProgress?.({
        phase: "importing",
        done,
        total: toPull.length,
      });
    });
  }

  return counts;
}
