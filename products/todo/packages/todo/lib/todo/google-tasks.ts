/**
 * The calls to the Google Tasks API that the sync makes.
 *
 * Part of google.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/todo/plan-error";

import { googleError, googleFetch } from "./google-client";

const API = "https://tasks.googleapis.com/tasks/v1";

/** A task as Google gives it. Google leaves out an empty field. */
export type GoogleTask = {
  id: string;
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  /** RFC 3339. Google keeps the day only; the time is always midnight UTC. */
  due?: string;
  /** RFC 3339: the last change. */
  updated: string;
  deleted?: boolean;
  hidden?: boolean;
  /** The id of the task this one is a subtask of. One level only. */
  parent?: string;
  /** Sorts the tasks of one parent, as text. */
  position?: string;
};

export type GoogleTaskList = { id: string; name: string };

/** What a task is told to become. Null clears a field. */
export type GoogleTaskPatch = {
  title?: string;
  notes?: string;
  status?: "needsAction" | "completed";
  due?: string | null;
};

/** Google's limits. A longer value is cut, never refused. */
const MAX_TITLE = 1024;
const MAX_NOTES = 8192;

export function fitTitle(title: string): string {
  return title.slice(0, MAX_TITLE);
}

export function fitNotes(notes: string): string {
  return notes.slice(0, MAX_NOTES);
}

function listUrl(listId: string, rest = ""): string {
  return `${API}/lists/${encodeURIComponent(listId)}/tasks${rest}`;
}

/** The person's task lists, for the picker in the list dialog. */
export async function listGoogleTaskLists(email: string): Promise<GoogleTaskList[]> {
  const all: GoogleTaskList[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ maxResults: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const res = await googleFetch(email, `${API}/users/@me/lists?${query}`);
    if (!res.ok) throw await googleError("the task lists", res);
    const body = (await res.json()) as {
      items?: { id: string; title?: string }[];
      nextPageToken?: string;
    };
    for (const item of body.items ?? []) all.push({ id: item.id, name: item.title ?? "" });
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return all;
}

export type GoogleTaskChanges = {
  tasks: GoogleTask[];
  /** True for a read of the whole list (no `since`): a task not in it is gone. */
  full: boolean;
  /** Google's clock at the answer, for the next `since` when nothing came. */
  serverDate: string | null;
};

/**
 * The tasks of a list changed since `since`, deleted ones too. With no
 * `since`, every task that is not deleted.
 */
export async function listGoogleTaskChanges(
  email: string,
  listId: string,
  since: string | null
): Promise<GoogleTaskChanges> {
  const tasks: GoogleTask[] = [];
  let serverDate: string | null = null;
  let pageToken = "";
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "true",
    });
    if (since) {
      query.set("updatedMin", since);
      query.set("showDeleted", "true");
    }
    if (pageToken) query.set("pageToken", pageToken);
    const res = await googleFetch(email, listUrl(listId, `?${query}`));
    if (res.status === 404) {
      throw new PlanError(
        "The Google Tasks list is no longer there. Link this list again, or remove the link.",
        404
      );
    }
    if (!res.ok) throw await googleError("the tasks", res);
    serverDate = res.headers.get("Date") ?? serverDate;
    const body = (await res.json()) as { items?: GoogleTask[]; nextPageToken?: string };
    tasks.push(...(body.items ?? []));
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return { tasks, full: !since, serverDate };
}

/** A new task. It goes to the top of the list, or of its parent's subtasks. */
export async function insertGoogleTask(
  email: string,
  listId: string,
  task: GoogleTaskPatch,
  parent: string | null
): Promise<GoogleTask> {
  const query = parent ? `?parent=${encodeURIComponent(parent)}` : "";
  const res = await googleFetch(email, listUrl(listId, query), {
    method: "POST",
    body: JSON.stringify(task),
  });
  if (!res.ok) throw await googleError("the new task", res);
  return (await res.json()) as GoogleTask;
}

/** Change a task. Null when Google no longer has it. */
export async function patchGoogleTask(
  email: string,
  listId: string,
  taskId: string,
  patch: GoogleTaskPatch
): Promise<GoogleTask | null> {
  const body: Record<string, unknown> = { ...patch };
  // An open task has no completion time. Google keeps the old one unless told.
  if (patch.status === "needsAction") body.completed = null;
  const res = await googleFetch(email, listUrl(listId, `/${encodeURIComponent(taskId)}`), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw await googleError("the change to a task", res);
  return (await res.json()) as GoogleTask;
}

/** Put a task under another parent, or under none. Null when it is gone. */
export async function moveGoogleTask(
  email: string,
  listId: string,
  taskId: string,
  parent: string | null
): Promise<GoogleTask | null> {
  const query = parent ? `?parent=${encodeURIComponent(parent)}` : "";
  const res = await googleFetch(
    email,
    listUrl(listId, `/${encodeURIComponent(taskId)}/move${query}`),
    { method: "POST" }
  );
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw await googleError("the move of a task", res);
  return (await res.json()) as GoogleTask;
}

/** Delete a task. Already gone is success. */
export async function deleteGoogleTask(
  email: string,
  listId: string,
  taskId: string
): Promise<void> {
  const res = await googleFetch(email, listUrl(listId, `/${encodeURIComponent(taskId)}`), {
    method: "DELETE",
  });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw await googleError("the delete of a task", res);
}
