/**
 * Basecamp's projects, to-do lists, to-dos, steps and project people: one
 * call each.
 *
 * Part of basecamp.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

import {
  type BasecampConnection,
  api,
  bcFetch,
  bcFetchAllPages,
} from "./basecamp-client";

export type BasecampProject = { id: number; name: string };
export type BasecampTodolist = { id: number; name: string };
export type BasecampPerson = {
  id: number;
  name?: string | null;
  /** Basecamp redacts this for non-admin / non-owner connections. */
  email_address?: string | null;
  avatar_url?: string | null;
};
export type BasecampTodo = {
  id: number;
  content: string;
  description?: string;
  /** "YYYY-MM-DD", or null. The board keeps the same string. */
  due_on?: string | null;
  completed: boolean;
  updated_at?: string;
  assignees?: BasecampPerson[];
  /** Basecamp's subtasks, embedded in every to-do it returns. */
  steps?: BasecampStep[];
};

/**
 * One subtask, which Basecamp calls a step.

 * The routes are the card-table ones even on a plain to-do — measured, not
 * read: POST /buckets/:b/card_tables/cards/:todoId/steps.json creates one
 * on a Todo (201) while /todos/:id/steps.json answers 404, the title moves
 * with PUT .../card_tables/steps/:id.json, the tick with
 * .../completions.json {completion: "on"|"off"}, and there is no route at
 * all for position — order cannot be pushed.
 */
export type BasecampStep = {
  id: number;
  title: string;
  completed: boolean;
  position?: number;
  updated_at?: string;
};

export async function createBasecampStep(
  conn: BasecampConnection,
  projectId: string,
  todoId: string,
  title: string
): Promise<BasecampStep> {
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/card_tables/cards/${todoId}/steps.json`),
    { method: "POST", body: JSON.stringify({ title }) }
  );
  if (!res.ok) throw new PlanError(`Basecamp step create failed (${res.status})`, 502);
  return (await res.json()) as BasecampStep;
}

export async function updateBasecampStepTitle(
  conn: BasecampConnection,
  projectId: string,
  stepId: string,
  title: string
): Promise<void> {
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/card_tables/steps/${stepId}.json`),
    { method: "PUT", body: JSON.stringify({ title }) }
  );
  if (!res.ok && res.status !== 404) {
    throw new PlanError(`Basecamp step update failed (${res.status})`, 502);
  }
}

export async function setBasecampStepCompletion(
  conn: BasecampConnection,
  projectId: string,
  stepId: string,
  completed: boolean
): Promise<void> {
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/card_tables/steps/${stepId}/completions.json`),
    { method: "PUT", body: JSON.stringify({ completion: completed ? "on" : "off" }) }
  );
  if (!res.ok && res.status !== 404) {
    throw new PlanError(`Basecamp step completion failed (${res.status})`, 502);
  }
}

/** A step is a recording like any other: trashing is how it is deleted. */
export async function trashBasecampStep(
  conn: BasecampConnection,
  projectId: string,
  stepId: string
): Promise<void> {
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/recordings/${stepId}/status/trashed.json`),
    { method: "PUT" }
  );
  if (!res.ok && res.status !== 404) {
    throw new PlanError(`Basecamp step trash failed (${res.status})`, 502);
  }
}

const PROJECT_PEOPLE_TTL_MS = 5 * 60_000;
const projectPeopleCache = new Map<
  string,
  { at: number; people: BasecampPerson[] }
>();

/**
 * People on a Basecamp project, cached briefly.
 *
 * Every push has to send `assignee_ids`, so this would otherwise cost an extra
 * request per keystroke-sized edit. Basecamp only accepts ids of people on the
 * project, so the list is also what tells us an assignee cannot be pushed.
 */
export async function listBasecampProjectPeople(
  conn: BasecampConnection,
  projectId: string
): Promise<BasecampPerson[]> {
  const hit = projectPeopleCache.get(projectId);
  if (hit && Date.now() - hit.at < PROJECT_PEOPLE_TTL_MS) return hit.people;
  const people = await bcFetchAllPages<BasecampPerson>(
    conn,
    api(conn, `/projects/${projectId}/people.json`)
  );
  projectPeopleCache.set(projectId, { at: Date.now(), people });
  return people;
}

/** Milliseconds since epoch, or 0 when the stamp is missing / unreadable. */
export function syncTimeMs(value: unknown): number {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "string" || typeof value === "number") {
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

export async function listBasecampProjects(
  conn: BasecampConnection
): Promise<BasecampProject[]> {
  return bcFetchAllPages<BasecampProject>(conn, api(conn, "/projects.json"));
}

export async function listBasecampTodolists(
  conn: BasecampConnection,
  projectId: string
): Promise<BasecampTodolist[]> {
  const res = await bcFetch(conn, api(conn, `/projects/${projectId}.json`));
  if (!res.ok) throw new PlanError(`Basecamp project fetch failed (${res.status})`, 502);
  const project = (await res.json()) as {
    dock?: { name: string; url: string }[];
  };
  const todoset = project.dock?.find((d) => d.name === "todoset");
  if (!todoset) return [];
  return bcFetchAllPages<BasecampTodolist>(
    conn,
    todoset.url.replace(".json", "/todolists.json")
  );
}

/** Parent-list todos plus todos inside groups/sections, active and completed
 *  (Basecamp omits grouped todos from the parent endpoint). */
export async function fetchAllBasecampTodos(
  conn: BasecampConnection,
  projectId: string,
  listId: string
): Promise<BasecampTodo[]> {
  const base = api(conn, `/buckets/${projectId}/todolists/${listId}/todos.json`);
  const todos = [
    ...(await bcFetchAllPages<BasecampTodo>(conn, base)),
    ...(await bcFetchAllPages<BasecampTodo>(conn, `${base}?completed=true`)),
  ];
  const groups = await bcFetchAllPages<{ id: number }>(
    conn,
    api(conn, `/buckets/${projectId}/todolists/${listId}/groups.json`)
  );
  for (const group of groups) {
    const groupBase = api(
      conn,
      `/buckets/${projectId}/todolists/${group.id}/todos.json`
    );
    todos.push(...(await bcFetchAllPages<BasecampTodo>(conn, groupBase)));
    todos.push(
      ...(await bcFetchAllPages<BasecampTodo>(conn, `${groupBase}?completed=true`))
    );
  }
  return todos;
}

/** Basecamp stores notes as HTML `description`. Empty string means none. */
export function normalizeBasecampNotes(
  html: string | null | undefined
): string | null {
  if (html == null) return null;
  const trimmed = html.trim();
  return trimmed.length ? trimmed : null;
}

export async function createBasecampTodo(
  conn: BasecampConnection,
  projectId: string,
  listId: string,
  content: string,
  description?: string | null,
  assigneeIds?: number[],
  dueOn?: string | null
): Promise<BasecampTodo> {
  const body: {
    content: string;
    description?: string;
    assignee_ids?: number[];
    due_on?: string;
  } = { content };
  const notes = normalizeBasecampNotes(description);
  if (notes) body.description = notes;
  if (assigneeIds?.length) body.assignee_ids = assigneeIds;
  if (dueOn) body.due_on = dueOn;
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/todolists/${listId}/todos.json`),
    { method: "POST", body: JSON.stringify(body) }
  );
  if (!res.ok) throw new PlanError(`Basecamp create failed (${res.status})`, 502);
  return (await res.json()) as BasecampTodo;
}

export async function setBasecampTodoCompletion(
  conn: BasecampConnection,
  projectId: string,
  todoId: string,
  completed: boolean
): Promise<void> {
  const url = api(conn, `/buckets/${projectId}/todos/${todoId}/completion.json`);
  const res = await bcFetch(conn, url, {
    method: completed ? "POST" : "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new PlanError(`Basecamp completion update failed (${res.status})`, 502);
  }
}

/**
 * Update title, notes and assignees together.
 *
 * Basecamp replaces omitted fields: "empty/missing `assignee_ids` clears
 * existing assignees". A content-only PUT therefore cleared the remote
 * description — which is why notes looked like they never synced — and also
 * silently unassigned everyone. Every caller must send all three fields.
 */
export async function getBasecampTodo(
  conn: BasecampConnection,
  projectId: string,
  todoId: string
): Promise<BasecampTodo | null> {
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/todos/${todoId}.json`)
  );
  if (!res.ok) return null;
  return (await res.json()) as BasecampTodo;
}

export async function updateBasecampTodo(
  conn: BasecampConnection,
  projectId: string,
  todoId: string,
  fields: {
    content: string;
    description?: string | null;
    assigneeIds: number[];
    /** Always sent: a PUT that leaves it out is read as clearing it. */
    dueOn: string | null;
  }
): Promise<void> {
  const res = await bcFetch(conn, api(conn, `/buckets/${projectId}/todos/${todoId}.json`), {
    method: "PUT",
    body: JSON.stringify({
      content: fields.content,
      description: normalizeBasecampNotes(fields.description) ?? "",
      assignee_ids: fields.assigneeIds,
      due_on: fields.dueOn,
    }),
  });
  if (!res.ok && res.status !== 404) {
    throw new PlanError(`Basecamp update failed (${res.status})`, 502);
  }
}

export async function trashBasecampTodo(
  conn: BasecampConnection,
  projectId: string,
  todoId: string
): Promise<void> {
  const res = await bcFetch(
    conn,
    api(conn, `/buckets/${projectId}/recordings/${todoId}/status/trashed.json`),
    { method: "PUT" }
  );
  if (!res.ok && res.status !== 404) {
    throw new PlanError(`Basecamp trash failed (${res.status})`, 502);
  }
}
