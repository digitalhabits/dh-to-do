/**
 * The calls to Microsoft Graph that the To Do sync makes.
 *
 * Part of microsoft.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/todo/plan-error";

import { GRAPH, microsoftError, microsoftErrorCode, microsoftFetch } from "./microsoft-client";

/** A day and time as Graph gives one: the time with no zone, and the zone. */
export type MicrosoftDateTime = { dateTime: string; timeZone: string };

/** A task as Graph gives it. */
export type MicrosoftTask = {
  id: string;
  title?: string;
  /** The note. `html` for a task made in Outlook, else `text`. */
  body?: { content?: string; contentType?: string };
  /** Only "completed" is done. The other four are kinds of not done. */
  status?: string;
  /** Left out, or null, for a task with no due day. */
  dueDateTime?: MicrosoftDateTime | null;
  /** RFC 3339, in UTC: the first and the last change. */
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  /** There when the task repeats. The sync leaves such a task alone. */
  recurrence?: unknown;
  /** In a read of changes: Microsoft no longer has the task. */
  "@removed"?: { reason?: string };
};

export type MicrosoftTaskList = { id: string; name: string };

/** What a task is told to become. A null due day clears it. */
export type MicrosoftTaskPatch = {
  title?: string;
  notes?: string;
  done?: boolean;
  due?: MicrosoftDateTime | null;
};

/**
 * Graph gives no limit for a title. Outlook, which keeps the tasks, holds
 * 255 characters in a subject; a longer one is cut, never refused.
 */
const MAX_TITLE = 255;

export function fitMicrosoftTitle(title: string): string {
  return title.slice(0, MAX_TITLE);
}

function listUrl(listId: string, rest = ""): string {
  return `${GRAPH}/me/todo/lists/${encodeURIComponent(listId)}/tasks${rest}`;
}

/** The body of a POST or PATCH, in Graph's own field names. */
function taskBody(patch: MicrosoftTaskPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.body = { content: patch.notes, contentType: "text" };
  if (patch.done !== undefined) body.status = patch.done ? "completed" : "notStarted";
  if (patch.due !== undefined) body.dueDateTime = patch.due;
  return body;
}

/**
 * The person's task lists, for the picker in the list dialog. The list of
 * flagged mail is left out: its tasks belong to mails.
 */
export async function listMicrosoftTaskLists(email: string): Promise<MicrosoftTaskList[]> {
  const all: MicrosoftTaskList[] = [];
  let url = `${GRAPH}/me/todo/lists?$top=100`;
  for (let page = 0; page < 20 && url; page++) {
    const res = await microsoftFetch(email, url);
    if (!res.ok) throw await microsoftError("the task lists", res);
    const body = (await res.json()) as {
      value?: { id: string; displayName?: string; wellknownListName?: string }[];
      "@odata.nextLink"?: string;
    };
    for (const item of body.value ?? []) {
      if (item.wellknownListName === "flaggedEmails") continue;
      all.push({ id: item.id, name: item.displayName ?? "" });
    }
    url = body["@odata.nextLink"] ?? "";
  }
  return all;
}

export type MicrosoftTaskChanges = {
  tasks: MicrosoftTask[];
  /** True for a read of the whole list: a task not in it may be gone. */
  full: boolean;
  /** Where the next read of changes starts. */
  next: string | null;
};

/** Graph's names for "that place in the changes is no longer kept". */
const STALE_CURSOR = /syncStateNotFound|syncStateInvalid|resyncRequired|badDeltaToken/i;

/**
 * The tasks of a list changed since `cursor` (a delta link from the last
 * read), removed ones too. With no cursor, every task of the list.
 *
 * Microsoft keeps a place in the changes for a time it does not name.
 * When the place is gone, the whole list is read again.
 */
export async function listMicrosoftTaskChanges(
  email: string,
  listId: string,
  cursor: string | null
): Promise<MicrosoftTaskChanges> {
  const first = listUrl(listId, "/delta");
  // A cursor of another list, or of no list: start again.
  const from = cursor && cursor.startsWith(first) ? cursor : null;
  const tasks = new Map<string, MicrosoftTask>();
  let url = from ?? first;
  let next: string | null = null;
  for (let page = 0; page < 200 && url; page++) {
    const res = await microsoftFetch(email, url, {
      headers: { Prefer: "odata.maxpagesize=100" },
    });
    if (!res.ok) {
      const code = await microsoftErrorCode(res);
      if (from && (res.status === 410 || STALE_CURSOR.test(code))) {
        return listMicrosoftTaskChanges(email, listId, null);
      }
      if (res.status === 404) {
        throw new PlanError(
          "The Microsoft To Do list is no longer there. Link this list again, or remove the link.",
          404
        );
      }
      throw await microsoftError("the tasks", res);
    }
    const body = (await res.json()) as {
      value?: MicrosoftTask[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    // Microsoft can give a task two times in one read. The later one is true.
    for (const task of body.value ?? []) tasks.set(task.id, task);
    next = body["@odata.deltaLink"] ?? next;
    url = body["@odata.nextLink"] ?? "";
  }
  return { tasks: [...tasks.values()], full: !from, next };
}

/** One task, or null when Microsoft no longer has it. */
export async function getMicrosoftTask(
  email: string,
  listId: string,
  taskId: string
): Promise<MicrosoftTask | null> {
  const res = await microsoftFetch(email, listUrl(listId, `/${encodeURIComponent(taskId)}`));
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw await microsoftError("a task", res);
  return (await res.json()) as MicrosoftTask;
}

export async function insertMicrosoftTask(
  email: string,
  listId: string,
  task: MicrosoftTaskPatch
): Promise<MicrosoftTask> {
  const res = await microsoftFetch(email, listUrl(listId), {
    method: "POST",
    body: JSON.stringify(taskBody(task)),
  });
  if (!res.ok) throw await microsoftError("the new task", res);
  return (await res.json()) as MicrosoftTask;
}

/** Change a task. Null when Microsoft no longer has it. */
export async function patchMicrosoftTask(
  email: string,
  listId: string,
  taskId: string,
  patch: MicrosoftTaskPatch
): Promise<MicrosoftTask | null> {
  const res = await microsoftFetch(email, listUrl(listId, `/${encodeURIComponent(taskId)}`), {
    method: "PATCH",
    body: JSON.stringify(taskBody(patch)),
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw await microsoftError("the change to a task", res);
  return (await res.json()) as MicrosoftTask;
}

/** Delete a task. Already gone is success. */
export async function deleteMicrosoftTask(
  email: string,
  listId: string,
  taskId: string
): Promise<void> {
  const res = await microsoftFetch(email, listUrl(listId, `/${encodeURIComponent(taskId)}`), {
    method: "DELETE",
  });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw await microsoftError("the delete of a task", res);
}
