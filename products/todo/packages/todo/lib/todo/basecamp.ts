/**
 * Server-side Basecamp 3 client for the To-Do board, ported from redd-do's
 * app.js client (auth refresh, 429 backoff, RFC5988 pagination, grouped
 * todos). redd-do ran this in the webview against localStorage tokens; here
 * it runs on the server against the team-shared connection row, so it works
 * from every browser with no CORS shims or client secrets in the client.
 */
import { PlanError } from "@/lib/plan/errors";

type Row = Record<string, unknown>;

import { todoDb } from "./db-driver";
import { randomUUID } from "./uuid";

import { setTaskAssignees, upsertTodoPerson } from "./people-store";
import {
  noteMediaWithoutSgid,
  noteWithSgid,
  todoMediaStore,
} from "./media-store";

const BASECAMP_USER_AGENT = "Digital Habits: To-Do (team@digitalhabits.org)";
const LAUNCHPAD = "https://launchpad.37signals.com";

/**
 * What differs per app. The planner uses global fetch and refreshes at
 * launchpad with its client secret. The standalone app fetches through the
 * Tauri HTTP plugin — webview fetch answers to CORS, and Basecamp does not —
 * and refreshes through the Amplify broker, because a desktop app holds no
 * client secret. Everything else in this file is the same sync either way.
 */
export type BasecampTransport = {
  fetch: typeof globalThis.fetch;
  /** Returns the refreshed connection, or null when refresh is impossible. */
  refresh: (conn: BasecampConnection) => Promise<BasecampConnection | null>;
};

let transport: BasecampTransport = {
  fetch: (...args) => globalThis.fetch(...args),
  refresh: (conn) => refreshAtLaunchpad(conn),
};

export function setBasecampTransport(next: BasecampTransport) {
  transport = next;
}

export type BasecampConnection = {
  accountId: string;
  accessToken: string;
  refreshToken: string | null;
  email: string | null;
};

export async function getBasecampConnection(): Promise<BasecampConnection | null> {
  const { rows } = await todoDb().query(
    "SELECT * FROM todo_basecamp_connection WHERE id = 1"
  );
  if (!rows[0]) return null;
  return {
    accountId: rows[0].account_id as string,
    accessToken: rows[0].access_token as string,
    refreshToken: (rows[0].refresh_token as string | null) ?? null,
    email: (rows[0].email as string | null) ?? null,
  };
}

export async function saveBasecampConnection(
  conn: BasecampConnection
): Promise<void> {
  await todoDb().query(
    `INSERT INTO todo_basecamp_connection (id, account_id, access_token, refresh_token, email)
     VALUES (1, $1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       email = EXCLUDED.email,
       updated_at = NOW()`,
    [conn.accountId, conn.accessToken, conn.refreshToken, conn.email]
  );
}

export async function deleteBasecampConnection(): Promise<void> {
  await todoDb().query("DELETE FROM todo_basecamp_connection WHERE id = 1");
}

/**
 * Connect with tokens that were made somewhere else: pasted by hand, or taken
 * over from To-Do 2.x at the first start of 3.x.
 *
 * An access token lasts two weeks. A person who updates from 2.x has most
 * often not used Basecamp in the last two weeks of 2.x, so the token they
 * bring is dead, and their refresh token is good. So a refused access token
 * is tried once more after a refresh, through the host's own way to refresh.
 * The first real 2.9 board showed this: every list came over, and the app
 * still asked for a new sign-in.
 *
 * The refresh saves a row before the account is known. If the new token is
 * refused too, that row is taken away again, unless a connection was there
 * before.
 */
export async function connectBasecampWithTokens(input: {
  accessToken: string;
  refreshToken: string | null;
}): Promise<{ accountId: string; email: string | null }> {
  let accessToken = input.accessToken;
  let refreshToken = input.refreshToken;
  let identity: { accountId: string; email: string | null };
  try {
    identity = await fetchBasecampIdentity(accessToken);
  } catch (err) {
    if (!refreshToken) throw err;
    const before = await getBasecampConnection();
    const refreshed = await transport
      .refresh({
        accountId: before?.accountId ?? "",
        accessToken,
        refreshToken,
        email: before?.email ?? null,
      })
      .catch(() => null);
    try {
      if (!refreshed) throw err;
      identity = await fetchBasecampIdentity(refreshed.accessToken);
    } catch (again) {
      if (before) await saveBasecampConnection(before);
      else await deleteBasecampConnection();
      throw again;
    }
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken;
  }
  await saveBasecampConnection({
    accountId: identity.accountId,
    accessToken,
    refreshToken,
    email: identity.email,
  });
  return identity;
}

function clientCredentials(): { id: string; secret: string } {
  const id = process.env.BASECAMP_CLIENT_ID?.trim();
  const secret = process.env.BASECAMP_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new PlanError(
      "Basecamp is not configured (BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET)",
      503
    );
  }
  return { id, secret };
}

export function basecampAuthorizeUrl(redirectUri: string): string {
  const { id } = clientCredentials();
  const params = new URLSearchParams({
    type: "web_server",
    client_id: id,
    redirect_uri: redirectUri,
  });
  return `${LAUNCHPAD}/authorization/new?${params.toString()}`;
}

export async function exchangeBasecampCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const { id, secret } = clientCredentials();
  const params = new URLSearchParams({
    type: "web_server",
    client_id: id,
    redirect_uri: redirectUri,
    client_secret: secret,
    code,
  });
  const res = await transport.fetch(`${LAUNCHPAD}/authorization/token?${params.toString()}`, {
    method: "POST",
    headers: { "User-Agent": BASECAMP_USER_AGENT },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !json.access_token) {
    throw new PlanError(
      `Basecamp token exchange failed (${res.status}): ${JSON.stringify(json)}`,
      502
    );
  }
  return {
    accessToken: json.access_token as string,
    refreshToken: (json.refresh_token as string | undefined) ?? null,
  };
}

async function refreshAtLaunchpad(
  conn: BasecampConnection
): Promise<BasecampConnection | null> {
  if (!conn.refreshToken) return null;
  let id: string, secret: string;
  try {
    ({ id, secret } = clientCredentials());
  } catch {
    return null;
  }
  const params = new URLSearchParams({
    type: "refresh",
    refresh_token: conn.refreshToken,
    client_id: id,
    client_secret: secret,
  });
  const res = await transport.fetch(`${LAUNCHPAD}/authorization/token?${params.toString()}`, {
    method: "POST",
    headers: { "User-Agent": BASECAMP_USER_AGENT },
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!json.access_token) return null;
  const updated: BasecampConnection = {
    ...conn,
    accessToken: json.access_token as string,
  };
  await saveBasecampConnection(updated);
  return updated;
}

/** Fetch the launchpad identity to resolve the bc3 account id + email. */
export async function fetchBasecampIdentity(accessToken: string): Promise<{
  accountId: string;
  email: string | null;
}> {
  const res = await transport.fetch(`${LAUNCHPAD}/authorization.json`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": BASECAMP_USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new PlanError(`Basecamp identity fetch failed (${res.status})`, 502);
  }
  const json = (await res.json()) as {
    identity?: { email_address?: string };
    accounts?: { id: number; product: string }[];
  };
  const account = (json.accounts ?? []).find((a) => a.product === "bc3");
  if (!account) {
    throw new PlanError("No Basecamp 3 account on this login", 400);
  }
  return {
    accountId: String(account.id),
    email: json.identity?.email_address ?? null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when any `<bc-attachment>` in the HTML still has no `url`. */
function attachmentMissingUrl(html: string | null | undefined): boolean {
  if (!html) return false;
  const tags = html.match(/<bc-attachment\b[^>]*>/gi) ?? [];
  return tags.some((tag) => !/\burl=/i.test(tag));
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    if (part.includes('rel="next"') || part.includes("rel='next'")) {
      const match = part.match(/<([^>]+)>/);
      if (match) return match[1];
    }
  }
  return null;
}

/** Authorized fetch with one 401-refresh and 429 backoff, as in redd-do. */
async function bcFetch(
  conn: BasecampConnection,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${conn.accessToken}`);
  headers.set("User-Agent", BASECAMP_USER_AGENT);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const maxAttempts = 5;
  let response: Response = new Response(null, { status: 599 });
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    response = await transport.fetch(url, { ...options, headers });

    if (response.status === 401) {
      const refreshed = await transport.refresh(conn);
      if (!refreshed) return response;
      conn.accessToken = refreshed.accessToken;
      headers.set("Authorization", `Bearer ${conn.accessToken}`);
      response = await transport.fetch(url, { ...options, headers });
    }

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000
      );
      continue;
    }
    return response;
  }
  return response;
}

async function bcFetchAllPages<T>(
  conn: BasecampConnection,
  url: string
): Promise<T[]> {
  const all: T[] = [];
  let next: string | null = url;
  const seen = new Set<string>();
  while (next && !seen.has(next)) {
    seen.add(next);
    const res = await bcFetch(conn, next);
    if (!res.ok) {
      throw new PlanError(`Basecamp request failed (${res.status})`, 502);
    }
    const page = (await res.json()) as T[];
    if (Array.isArray(page)) all.push(...page);
    next = parseNextLink(res.headers.get("Link"));
  }
  return all;
}

function api(conn: BasecampConnection, path: string): string {
  return `https://3.basecampapi.com/${conn.accountId}${path}`;
}

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
function syncTimeMs(value: unknown): number {
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

/** Board assignees of a task, in board order. */
type LocalAssignee = {
  personId: string;
  name: string;
  basecampPersonId: string | null;
};

async function localAssigneesByTask(
  taskIds: string[]
): Promise<Map<string, LocalAssignee[]>> {
  const map = new Map<string, LocalAssignee[]>();
  if (!taskIds.length) return map;
  // A placeholder per id, not `= ANY($1::text[])`: the push runs on SQLite
  // too now, where the sync already did, and SQLite has no ANY.
  const { rows } = await todoDb().query(
    `SELECT a.task_id, a.person_id, p.name, p.basecamp_person_id
     FROM todo_task_assignees a
     JOIN todo_people p ON p.id = a.person_id
     WHERE a.task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY a.position, a.created_at`,
    taskIds
  );
  for (const row of rows) {
    const taskId = row.task_id as string;
    const entry: LocalAssignee = {
      personId: row.person_id as string,
      name: row.name as string,
      basecampPersonId: (row.basecamp_person_id as string | null) ?? null,
    };
    const list = map.get(taskId);
    if (list) list.push(entry);
    else map.set(taskId, [entry]);
  }
  return map;
}

/**
 * Split board assignees into the ones Basecamp will accept and the ones it
 * will not. Basecamp only takes ids of people on the project, so anyone else
 * has to be reported — dropping them without a word looks like data loss.
 */
function splitAssigneesForPush(
  assignees: LocalAssignee[],
  projectPersonIds: Set<string>
): { ids: number[]; blocked: string[] } {
  const ids: number[] = [];
  const blocked: string[] = [];
  for (const assignee of assignees) {
    if (
      assignee.basecampPersonId &&
      projectPersonIds.has(assignee.basecampPersonId)
    ) {
      ids.push(Number(assignee.basecampPersonId));
    } else {
      blocked.push(assignee.name);
    }
  }
  return { ids, blocked };
}

/**
 * Per-sync state for turning Basecamp people into board people.
 *
 * The cache matters: a list hits the same two or three people across dozens of
 * to-dos, and each uncached lookup costs several queries on a pool that holds
 * very few connections. Without it one sync starves every other request.
 */
type AssigneeResolver = {
  /** Basecamp person id → board person id. */
  cache: Map<string, string>;
  nameLinked: Set<string>;
  ambiguous: Set<string>;
};

function newAssigneeResolver(): AssigneeResolver {
  return { cache: new Map(), nameLinked: new Set(), ambiguous: new Set() };
}

/**
 * Board people for a Basecamp to-do's assignees, adding anyone the board does
 * not have yet so a pulled assignment is never dropped on the floor.
 */
async function boardPeopleForAssignees(
  assignees: BasecampPerson[],
  resolver: AssigneeResolver
): Promise<string[]> {
  const ids: string[] = [];
  for (const person of assignees) {
    const basecampPersonId = String(person.id);
    const cached = resolver.cache.get(basecampPersonId);
    if (cached) {
      ids.push(cached);
      continue;
    }
    const name =
      person.name?.trim() || person.email_address?.trim() || `Basecamp ${person.id}`;
    const result = await upsertTodoPerson(randomUUID(), {
      name,
      photoUrl: person.avatar_url ?? null,
      email: person.email_address ?? null,
      basecampPersonId,
      sourceKind: "basecamp",
      sourceId: basecampPersonId,
      // Rows added before emails were recorded have nothing else to match on.
      matchByName: true,
    });
    if (result.matchedByName) resolver.nameLinked.add(result.person.name);
    if (result.ambiguousName) resolver.ambiguous.add(result.person.name);
    resolver.cache.set(basecampPersonId, result.person.id);
    ids.push(result.person.id);
  }
  return ids;
}

function sameIdSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

/**
 * Settle one linked task's subtasks against its to-do's steps.
 *
 * The same three-copy rule the task fields use, per step and per field:
 * a title changed on a side when it differs from the last state both
 * sides held. Steps are plain text and a tick, so there is no reformat
 * problem — the base is still what tells an edit from the other side's
 * echo of our own push. Order is the one thing that cannot be pushed
 * (Basecamp has no route for it), so remote order is taken only for
 * steps arriving for the first time.
 */
export async function reconcileSteps(
  conn: BasecampConnection,
  projectId: string,
  taskId: string,
  todoBcId: string,
  remoteSteps: BasecampStep[],
  /** The parent's list, which every child shares. */
  listId: string,
  /*
    The task's local rows — its child tasks — read by the caller. One sync
    reads the whole list's children in one query and hands each task its
    share; a query per task starved the small pool for nothing, since most
    tasks have no steps on either side.
  */
  localRows?: Row[]
): Promise<{ pushed: boolean; pulled: boolean }> {
  if (localRows === undefined) {
    localRows = (
      await todoDb().query(
        "SELECT * FROM todo_tasks WHERE parent_task_id = $1 ORDER BY position, created_at",
        [taskId]
      )
    ).rows;
  }
  const remoteById = new Map(remoteSteps.map((step) => [String(step.id), step]));
  let pushed = false;
  let pulled = false;
  const seen = new Set<string>();

  for (const row of localRows) {
    const bcId = row.basecamp_id as string | null;
    if (bcId && remoteById.has(bcId)) {
      seen.add(bcId);
      const remote = remoteById.get(bcId)!;
      const localText = row.text as string;
      const localDone = Boolean(row.completed);
      const remoteText = remote.title;
      const remoteDone = Boolean(remote.completed);
      const baseText = (row.basecamp_base_text as string | null) ?? null;
      const baseDone =
        row.basecamp_base_completed === null ||
        row.basecamp_base_completed === undefined
          ? null
          : Boolean(row.basecamp_base_completed);
      const localIsNewer =
        syncTimeMs(row.updated_at) > syncTimeMs(remote.updated_at);
      const settleOne = <T,>(
        local: T,
        remote_: T,
        base: T | null
      ): { value: T; push: boolean; pull: boolean } => {
        if (local === remote_) return { value: local, push: false, pull: false };
        if (base !== null) {
          if (local !== base && remote_ === base)
            return { value: local, push: true, pull: false };
          if (remote_ !== base && local === base)
            return { value: remote_, push: false, pull: true };
        }
        return localIsNewer
          ? { value: local, push: true, pull: false }
          : { value: remote_, push: false, pull: true };
      };
      const text = settleOne(localText, remoteText, baseText);
      const done = settleOne(localDone, remoteDone, baseDone);
      if (text.push) {
        await updateBasecampStepTitle(conn, projectId, bcId, text.value as string);
      }
      if (done.push) {
        await setBasecampStepCompletion(conn, projectId, bcId, Boolean(done.value));
      }
      if (text.push || done.push || text.pull || done.pull || baseText === null) {
        await todoDb().query(
          `UPDATE todo_tasks SET text = $1, completed = $2,
             completed_at = CASE WHEN $2 AND NOT completed THEN NOW()
                                 WHEN NOT $2 THEN NULL
                                 ELSE completed_at END,
             basecamp_base_text = $1, basecamp_base_completed = $2,
             updated_at = CASE WHEN $3 THEN NOW() ELSE updated_at END
           WHERE id = $4`,
          [text.value, Boolean(done.value), text.pull || done.pull, row.id]
        );
      }
      if (text.push || done.push) pushed = true;
      if (text.pull || done.pull) pulled = true;
    } else if (bcId) {
      // The step is gone remotely; the subtask follows it.
      await todoDb().query("DELETE FROM todo_tasks WHERE id = $1", [row.id]);
      pulled = true;
    } else {
      // Never pushed: make the step and remember it.
      const created = await createBasecampStep(
        conn,
        projectId,
        todoBcId,
        row.text as string
      );
      if (row.completed) {
        await setBasecampStepCompletion(conn, projectId, String(created.id), true);
      }
      await todoDb().query(
        `UPDATE todo_tasks SET basecamp_id = $1,
           basecamp_base_text = $2, basecamp_base_completed = $3
         WHERE id = $4`,
        [String(created.id), row.text, Boolean(row.completed), row.id]
      );
      pushed = true;
    }
  }

  for (const step of remoteSteps) {
    const id = String(step.id);
    if (seen.has(id)) continue;
    if (localRows.some((row) => row.basecamp_id === id)) continue;
    await todoDb().query(
      `INSERT INTO todo_tasks
         (id, list_id, parent_task_id, text, completed, completed_at,
          position, basecamp_id, basecamp_base_text, basecamp_base_completed)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END,
               $6, $7, $4, $5)
       ON CONFLICT (list_id, basecamp_id) WHERE basecamp_id IS NOT NULL
         DO NOTHING`,
      [
        randomUUID(),
        listId,
        taskId,
        step.title,
        Boolean(step.completed),
        Number(step.position ?? 0),
        id,
      ]
    );
    pulled = true;
  }

  return { pushed, pulled };
}

export type BasecampSyncResult = {
  pulled: number;
  pushed: number;
  removed: number;
  updated: number;
  /** Board people Basecamp would not take — they are not on the project. */
  unpushableAssignees: string[];
  /** People matched to Basecamp by name because no email lined up. */
  nameLinkedPeople: string[];
  /** Names shared by several board people — added new rather than guessed. */
  ambiguousPeople: string[];
};

/**
 * Two-way sync of one linked list.
 *
 * Local actions push immediately. On an explicit sync, linked tasks use
 * last-write-wins (`updated_at` vs Basecamp `updated_at`) for title, notes,
 * and completion. Unknown remote todos are pulled in, local tasks that
 * vanished remotely are removed, and local tasks never pushed are created
 * remotely.
 *
 * Assignees are compared on their own stamp (`assignees_updated_at`), because
 * `updated_at` moves on every edit: without it, changing the notes locally
 * would make our assignee list look newer and undo a reassignment made in
 * Basecamp.
 */
export async function syncBasecampList(
  listId: string
): Promise<BasecampSyncResult> {
  const conn = await getBasecampConnection();
  if (!conn) throw new PlanError("Basecamp is not connected", 400);

  const { rows: listRows } = await todoDb().query(
    "SELECT * FROM todo_lists WHERE id = $1",
    [listId]
  );
  const list = listRows[0];
  if (!list) throw new PlanError("List not found", 404);
  if (!list.basecamp_project_id || !list.basecamp_list_id) {
    throw new PlanError("List is not linked to Basecamp", 400);
  }
  const projectId = list.basecamp_project_id as string;

  const remote = await fetchAllBasecampTodos(
    conn,
    projectId,
    list.basecamp_list_id as string
  );
  const remoteById = new Map(remote.map((t) => [String(t.id), t]));

  // Parents only: a child is its parent to-do's step, and reading it here
  // would create it remotely as a to-do of its own.
  const { rows: taskRows } = await todoDb().query(
    "SELECT * FROM todo_tasks WHERE list_id = $1 AND parent_task_id IS NULL",
    [listId]
  );

  const projectPeople = await listBasecampProjectPeople(conn, projectId);
  const projectPersonIds = new Set(projectPeople.map((p) => String(p.id)));
  const localAssignees = await localAssigneesByTask(
    taskRows.map((row) => row.id as string)
  );
  // Every task's children in one read; reconcileSteps takes its share.
  // An IN list, not ANY(::text[]): the standalone app runs this same SQL
  // on SQLite, which has neither arrays nor the cast.
  const subtasksByTask = new Map<string, Row[]>();
  if (taskRows.length) {
    const taskIds = taskRows.map((row) => row.id as string);
    const { rows: subtaskRows } = await todoDb().query(
      `SELECT * FROM todo_tasks
       WHERE parent_task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
       ORDER BY position, created_at`,
      taskIds
    );
    for (const row of subtaskRows) {
      const key = row.parent_task_id as string;
      const list = subtasksByTask.get(key);
      if (list) list.push(row);
      else subtasksByTask.set(key, [row]);
    }
  }

  const counts = { pulled: 0, pushed: 0, removed: 0, updated: 0 };
  const seenRemoteIds = new Set<string>();
  const unpushable = new Set<string>();
  const resolver = newAssigneeResolver();

  for (const task of taskRows) {
    // Pictures off Basecamp go up first, and the note then names them the
    // way Basecamp does. Nothing to do for a note without any.
    task.notes_html = await attachLocalMedia(
      conn,
      task.id as string,
      task.notes_html as string | null
    );
    const bcId = task.basecamp_id as string | null;
    if (bcId && remoteById.has(bcId)) {
      seenRemoteIds.add(bcId);
      const remoteTodo = remoteById.get(bcId)!;
      const remoteText = remoteTodo.content;
      const localText = task.text as string;
      const remoteNotes = normalizeBasecampNotes(remoteTodo.description);
      const localNotes = normalizeBasecampNotes(
        task.notes_html as string | null
      );
      const remoteCompleted = Boolean(remoteTodo.completed);
      const localCompleted = Boolean(task.completed);
      const remoteDue = remoteTodo.due_on ?? null;
      const localDue = (task.due_on as string | null) ?? null;

      /*
        Three copies, not two.

        Comparing the two live copies cannot tell an edit from a
        reformatting, and Basecamp reformats every push: it keeps its own
        subset of HTML and rewrites the rest. So an untouched note read as
        an edit, and the newer clock then overwrote a real edit with it.

        `basecamp_base_*` holds the last state both sides are known to have
        held. A field changed on a side when it differs from that, and only
        then. Each field is settled on its own, so a title edited here and a
        note edited there both survive.

        No base means no exchange has been recorded — a task from before the
        column, or one that has never synced. Those fall back to the old
        comparison for one pass and get a base written as they go, so
        nothing needs backfilling.
      */
      const hasBase = task.basecamp_base_text !== null
        && task.basecamp_base_text !== undefined;
      const baseText = task.basecamp_base_text as string | null;
      const baseNotes = normalizeBasecampNotes(
        task.basecamp_base_notes as string | null
      );
      const baseCompleted =
        task.basecamp_base_completed === null ||
        task.basecamp_base_completed === undefined
          ? null
          : Boolean(task.basecamp_base_completed);
      const baseDue = (task.basecamp_base_due_on as string | null) ?? null;

      /** Which side to believe for one field. */
      function settle<T>(
        local: T,
        remote: T,
        base: T | null,
        localIsNewer: boolean
      ): { value: T; push: boolean; pull: boolean; conflict: boolean } {
        if (local === remote) {
          return { value: local, push: false, pull: false, conflict: false };
        }
        if (hasBase && base !== null) {
          const localMoved = local !== base;
          const remoteMoved = remote !== base;
          if (localMoved && !remoteMoved) {
            return { value: local, push: true, pull: false, conflict: false };
          }
          if (remoteMoved && !localMoved) {
            return { value: remote, push: false, pull: true, conflict: false };
          }
        }
        // Both moved, or there is nothing to measure against. The clock is
        // the only thing left, and now it is only ever used on a real
        // disagreement.
        return localIsNewer
          ? { value: local, push: true, pull: false, conflict: true }
          : { value: remote, push: false, pull: true, conflict: true };
      }

      const localIsNewer =
        syncTimeMs(task.updated_at) > syncTimeMs(remoteTodo.updated_at);
      const textCall = settle(localText, remoteText, baseText, localIsNewer);
      const notesCall = settle(localNotes, remoteNotes, baseNotes, localIsNewer);
      const completedCall = settle(
        localCompleted,
        remoteCompleted,
        baseCompleted,
        localIsNewer
      );
      const dueCall = settle(localDue, remoteDue, baseDue, localIsNewer);


      const mine = localAssignees.get(task.id as string) ?? [];
      const push = splitAssigneesForPush(mine, projectPersonIds);
      for (const name of push.blocked) unpushable.add(name);
      const remoteAssignees = remoteTodo.assignees ?? [];
      // Compare only what we could push. A board person Basecamp will not take
      // must not read as "the remote list is missing someone" on every sync.
      const assigneesDiff = !sameIdSet(
        push.ids.map(String),
        remoteAssignees.map((p) => String(p.id))
      );
      const remoteUpdatedMs = syncTimeMs(remoteTodo.updated_at);
      const localStampMs = syncTimeMs(task.assignees_updated_at);
      /**
       * Two guards, both learned the hard way.
       *
       * An empty remote set never clears a board assignment. Basecamp bumps
       * `updated_at` for any edit at all, so "no assignees there" is never
       * evidence that somebody meant to unassign — it usually just means the
       * assigning happens on the board. To unassign, unassign on the board.
       *
       * No stamp means the assignment predates assignee sync, not that it is
       * old. Reading a missing stamp as time zero is what let Basecamp erase
       * board assignments wholesale. Unstamped with people on it counts as
       * newer and pushes; unstamped with nobody on it still yields, which is
       * how assignments made in Basecamp first arrive.
       */
      const assigneesAreNewer =
        remoteAssignees.length === 0 && mine.length > 0
          ? true
          : localStampMs
            ? localStampMs > remoteUpdatedMs
            : mine.length > 0;

      const wantsPush =
        textCall.push ||
        notesCall.push ||
        completedCall.push ||
        dueCall.push ||
        assigneesDiff;
      const wantsLocalWrite =
        textCall.pull || notesCall.pull || completedCall.pull || dueCall.pull;
      const settledText = textCall.value;
      const settledNotes = notesCall.value;
      const settledCompleted = completedCall.value;
      const settledDue = dueCall.value;

      if (!wantsPush && !wantsLocalWrite && !assigneesDiff) {
        // Linked and agreed. Record the agreement if it is not on record
        // yet, so the first sync after the column arrived gets its base.
        if (!hasBase) {
          await todoDb().query(
            `UPDATE todo_tasks SET basecamp_base_text = $1,
               basecamp_base_notes = $2, basecamp_base_completed = $3,
               basecamp_base_due_on = $4
             WHERE id = $5`,
            [settledText, settledNotes, settledCompleted, settledDue, task.id]
          );
        }
      } else {
        /*
          Both directions in one pass.

          A title edited here and a note edited there are two settlements,
          not one winner, so this can push and write locally in the same
          turn. Assignees keep their own rule and their own stamp; they ride
          on the PUT because Basecamp clears whatever the request leaves
          out.
        */
        if (wantsPush) {
          await updateBasecampTodo(conn, projectId, bcId, {
            content: settledText,
            description: settledNotes,
            assigneeIds:
              assigneesDiff && !assigneesAreNewer
                ? remoteAssignees.map((p) => Number(p.id))
                : push.ids,
            dueOn: settledDue,
          });
        }
        if (completedCall.push) {
          await setBasecampTodoCompletion(
            conn,
            projectId,
            bcId,
            settledCompleted
          );
        }

        const remoteUpdatedAt = remoteTodo.updated_at
          ? new Date(remoteTodo.updated_at)
          : new Date();

        /*
          The settled values and the base go down together.

          A push is not the end of it: Basecamp rewrites what it takes, so
          the base written here is what we believe it holds, and the next
          sync finds the rewrite on the remote side alone and pulls it in
          once. One quiet convergence rather than two sides arguing.
        */
        await todoDb().query(
          `UPDATE todo_tasks SET text = $1, completed = $2, notes_html = $3,
             due_on = $7,
             completed_at = CASE WHEN $2 AND NOT completed THEN NOW()
                                 WHEN NOT $2 THEN NULL
                                 ELSE completed_at END,
             updated_at = CASE WHEN $4 THEN $5 ELSE updated_at END,
             basecamp_base_text = $1,
             basecamp_base_notes = $3,
             basecamp_base_completed = $2,
             basecamp_base_due_on = $7
           WHERE id = $6`,
          [
            settledText,
            settledCompleted,
            settledNotes,
            wantsLocalWrite,
            remoteUpdatedAt,
            task.id,
            settledDue,
          ]
        );

        if (assigneesDiff) {
          if (assigneesAreNewer) {
            // Our assignment is the newer edit even though the to-do is not.
            // The PUT above already carried it.
            if (!wantsPush) {
              await updateBasecampTodo(conn, projectId, bcId, {
                content: settledText,
                description: settledNotes,
                assigneeIds: push.ids,
                dueOn: settledDue,
              });
            }
          } else {
            const ids = await boardPeopleForAssignees(remoteAssignees, resolver);
            await setTaskAssignees(task.id as string, ids, remoteUpdatedAt);
          }
        }

        if (wantsPush) counts.pushed += 1;
        if (wantsLocalWrite) counts.updated += 1;
      }
      // The steps settle on their own, agreed task or not: a tick on a
      // subtask moves neither side's to-do fields.
      const steps = await reconcileSteps(
        conn,
        projectId,
        task.id as string,
        bcId,
        remoteTodo.steps ?? [],
        listId,
        subtasksByTask.get(task.id as string) ?? []
      );
      if (steps.pushed) counts.pushed += 1;
      if (steps.pulled) counts.updated += 1;
    } else if (bcId) {
      // Deleted or moved away remotely.
      await todoDb().query("DELETE FROM todo_tasks WHERE id = $1", [task.id]);
      counts.removed += 1;
    } else {
      // Never pushed: create remotely and remember the id.
      const push = splitAssigneesForPush(
        localAssignees.get(task.id as string) ?? [],
        projectPersonIds
      );
      for (const name of push.blocked) unpushable.add(name);
      const created = await createBasecampTodo(
        conn,
        projectId,
        list.basecamp_list_id as string,
        task.text as string,
        task.notes_html as string | null,
        push.ids,
        (task.due_on as string | null) ?? null
      );
      if (task.completed) {
        await setBasecampTodoCompletion(conn, projectId, String(created.id), true);
      }
      // Linked, and the two sides agree by construction: this is what we
      // just sent. Recording it here means the next sync measures against
      // it rather than falling back to the clock.
      await todoDb().query(
        `UPDATE todo_tasks SET basecamp_id = $1, updated_at = NOW(),
           basecamp_base_text = $2, basecamp_base_notes = $3,
           basecamp_base_completed = $4, basecamp_base_due_on = $6
         WHERE id = $5`,
        [
          String(created.id),
          task.text as string,
          normalizeBasecampNotes(task.notes_html as string | null),
          Boolean(task.completed),
          task.id,
          (task.due_on as string | null) ?? null,
        ]
      );
      await reconcileSteps(
        conn,
        projectId,
        task.id as string,
        String(created.id),
        [],
        listId,
        subtasksByTask.get(task.id as string) ?? []
      );
      counts.pushed += 1;
    }
  }

  for (const todo of remote) {
    const id = String(todo.id);
    if (seenRemoteIds.has(id)) continue;
    const known = taskRows.some((t) => t.basecamp_id === id);
    if (known) continue;
    const taskId = randomUUID();
    // `taskRows` is a snapshot from before the Basecamp calls above. A sync
    // that started in parallel can insert this to-do while this one waits on
    // the network, and the snapshot cannot show it. The unique index on
    // (list_id, basecamp_id) rejects the second insert, and DO NOTHING makes
    // that a no-op instead of an error. An empty RETURNING means the other
    // sync won the race, so this pass adds no assignees and counts no pull.
    const { rows: inserted } = await todoDb().query(
      // The base goes in with it: what arrives is, by definition, what the
      // two sides agree on right now.
      `INSERT INTO todo_tasks
         (id, list_id, text, notes_html, completed, completed_at, position, basecamp_id,
          due_on, basecamp_base_text, basecamp_base_notes, basecamp_base_completed,
          basecamp_base_due_on)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END,
               (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = $2),
               $6, $7, $3, $4, $5, $7)
       ON CONFLICT (list_id, basecamp_id) WHERE basecamp_id IS NOT NULL
         DO NOTHING
       RETURNING id`,
      [
        taskId,
        listId,
        todo.content,
        normalizeBasecampNotes(todo.description),
        Boolean(todo.completed),
        id,
        todo.due_on ?? null,
      ]
    );
    if (!inserted[0]) continue;
    if (todo.steps?.length) {
      await reconcileSteps(conn, projectId, taskId, id, todo.steps, listId, []);
    }
    const assignees = todo.assignees ?? [];
    if (assignees.length) {
      const ids = await boardPeopleForAssignees(assignees, resolver);
      await setTaskAssignees(
        taskId,
        ids,
        todo.updated_at ? new Date(todo.updated_at) : new Date()
      );
    }
    counts.pulled += 1;
  }

  return {
    ...counts,
    unpushableAssignees: [...unpushable].sort(),
    nameLinkedPeople: [...resolver.nameLinked].sort(),
    ambiguousPeople: [...resolver.ambiguous].sort(),
  };
}

/**
 * The pictures in a note that Basecamp has not been given yet, given.
 *
 * A picture added to a task off Basecamp lives in the app's own store,
 * named on its tag by id (see media-store.ts). Basecamp strips that tag,
 * so before such a note goes up each picture is uploaded and its sgid
 * written onto the tag. The row is rewritten too, so the local copy and
 * the base the sync records both carry the sgid.
 *
 * A picture that cannot be uploaded stops the note: sent without it, the
 * next pull would read Basecamp's copy as the newer one and take the
 * picture out of the local note as well.
 */
export async function attachLocalMedia(
  conn: BasecampConnection,
  taskId: string,
  notesHtml: string | null | undefined
): Promise<string | null> {
  if (!notesHtml) return notesHtml ?? null;
  const pending = noteMediaWithoutSgid(notesHtml);
  if (!pending.length) return notesHtml;
  let html = notesHtml;
  for (const mediaId of pending) {
    const file = await todoMediaStore().read(mediaId);
    if (!file) {
      throw new PlanError("A picture in the note is missing from the store", 502);
    }
    const res = await bcFetch(
      conn,
      api(
        conn,
        `/attachments.json?name=${encodeURIComponent(file.filename || "image")}`
      ),
      {
        method: "POST",
        headers: { "Content-Type": file.contentType },
        // A plain buffer: both fetches take one, and the typing of a
        // Uint8Array over an unknown buffer does not pass as a body.
        body: file.bytes.slice().buffer,
      }
    );
    if (!res.ok) {
      throw new PlanError(
        `Basecamp would not take a picture from the note (${res.status})`,
        502
      );
    }
    const body = (await res.json()) as { attachable_sgid?: string };
    if (!body.attachable_sgid) {
      throw new PlanError("Basecamp did not sign a picture from the note", 502);
    }
    html = noteWithSgid(html, mediaId, body.attachable_sgid);
  }
  await todoDb().query(
    "UPDATE todo_tasks SET notes_html = $1 WHERE id = $2",
    [html, taskId]
  );
  return html;
}

/** Best-effort push of a local action to Basecamp; never blocks the caller's
 *  local write (failures surface at the next explicit sync). */
export async function pushBasecampAction(action: {
  type:
    | "create"
    | "complete"
    | "update-text"
    | "assign"
    | "delete"
    | "move"
    | "subtask-create"
    | "subtask-update"
    | "subtask-delete";
  /** Null for a task on no list, which Basecamp never sees. */
  listId: string | null;
  fromListId?: string | null;
  taskId?: string;
  basecampId?: string | null;
  text?: string;
  notesHtml?: string | null;
  dueOn?: string | null;
  completed?: boolean;
  subtaskId?: string;
  subtaskBasecampId?: string | null;
}): Promise<void> {
  try {
    const conn = await getBasecampConnection();
    if (!conn) return;
    const { rows } = await todoDb().query(
      "SELECT basecamp_project_id, basecamp_list_id FROM todo_lists WHERE id = $1",
      [action.listId]
    );
    const list = rows[0];
    const linked = Boolean(
      list?.basecamp_project_id && list?.basecamp_list_id
    );
    // A move onto a list Basecamp does not know still has work to do on the
    // old list. Every other action needs a linked list to talk to.
    if (!linked && action.type !== "move") return;
    const projectId = list?.basecamp_project_id as string;
    // A note on its way to a linked list: its local pictures go up first.
    if (linked && action.taskId && action.notesHtml) {
      action.notesHtml = await attachLocalMedia(
        conn,
        action.taskId,
        action.notesHtml
      );
    }

    /*
      Steps live under their to-do. A subtask of a task Basecamp has never
      seen has nothing to hang from, and stays local until the next full
      sync creates the to-do and its steps together.
    */
    if (action.type === "subtask-create") {
      if (!action.basecampId || !action.subtaskId || !action.text) return;
      const step = await createBasecampStep(
        conn,
        projectId,
        action.basecampId,
        action.text
      );
      // The base goes down with the id: what Basecamp holds is what we sent.
      await todoDb().query(
        `UPDATE todo_tasks SET basecamp_id = $1,
           basecamp_base_text = $2, basecamp_base_completed = FALSE
         WHERE id = $3`,
        [String(step.id), action.text, action.subtaskId]
      );
      return;
    }
    if (action.type === "subtask-update") {
      if (!action.subtaskBasecampId || !action.subtaskId) return;
      if (action.text !== undefined) {
        await updateBasecampStepTitle(
          conn,
          projectId,
          action.subtaskBasecampId,
          action.text
        );
      }
      if (action.completed !== undefined) {
        await setBasecampStepCompletion(
          conn,
          projectId,
          action.subtaskBasecampId,
          action.completed
        );
      }
      await todoDb().query(
        `UPDATE todo_tasks SET basecamp_base_text = $1,
           basecamp_base_completed = $2
         WHERE id = $3`,
        [action.text ?? null, action.completed ?? null, action.subtaskId]
      );
      return;
    }
    if (action.type === "subtask-delete") {
      if (!action.subtaskBasecampId) return;
      await trashBasecampStep(conn, projectId, action.subtaskBasecampId);
      return;
    }

    if (action.type === "move") {
      /*
        Basecamp cannot move a to-do from one list to another. Its own
        interface makes the to-do again in the target list and trashes the
        first, and so does this.
      */
      if (!action.basecampId || !action.fromListId || !action.taskId) return;
      const { rows: fromRows } = await todoDb().query(
        "SELECT basecamp_project_id FROM todo_lists WHERE id = $1",
        [action.fromListId]
      );
      const fromProjectId = fromRows[0]?.basecamp_project_id as
        | string
        | undefined;

      if (!linked) {
        // The task left Basecamp. Trash the to-do and forget its id: left
        // alone, the old list's next sync reads that to-do as new work and
        // pulls the task back onto it.
        if (fromProjectId) {
          await trashBasecampTodo(conn, fromProjectId, action.basecampId);
        }
        await todoDb().query(
          "UPDATE todo_tasks SET basecamp_id = NULL WHERE id = $1",
          [action.taskId]
        );
        // And the steps went down with the to-do. Ids kept here would read
        // as remote deletions on the next link, and the rows would follow
        // them. Forgotten, they are local rows a re-link creates afresh.
        await todoDb().query(
          `UPDATE todo_tasks SET basecamp_id = NULL,
             basecamp_base_text = NULL, basecamp_base_completed = NULL
           WHERE parent_task_id = $1`,
          [action.taskId]
        );
        return;
      }

      const assignees =
        (await localAssigneesByTask([action.taskId])).get(action.taskId) ?? [];
      let assigneeIds: number[] = [];
      if (assignees.length) {
        const projectPeople = await listBasecampProjectPeople(conn, projectId);
        assigneeIds = splitAssigneesForPush(
          assignees,
          new Set(projectPeople.map((person) => String(person.id)))
        ).ids;
      }
      const created = await createBasecampTodo(
        conn,
        projectId,
        list.basecamp_list_id as string,
        action.text ?? "",
        action.notesHtml ?? null,
        assigneeIds,
        action.dueOn ?? null
      );
      if (action.completed) {
        await setBasecampTodoCompletion(
          conn,
          projectId,
          String(created.id),
          true
        );
      }
      /*
        The new id is written before the old to-do is trashed, and not
        after.

        Either order can fail in the middle. This one leaves the task
        pointing at the to-do it now owns, and at worst one stray to-do on
        the old list, which the next sync pulls in as a task somebody can
        delete. The other order leaves the task pointing at a to-do that is
        gone, and the next sync of its own list deletes the task.
      */
      await todoDb().query(
        "UPDATE todo_tasks SET basecamp_id = $1 WHERE id = $2",
        [String(created.id), action.taskId]
      );
      /*
        The steps do not survive the move on their own: they belong to the
        to-do that is about to be trashed. Each is made again on the new
        to-do — before the old one goes, for the same reason the id is
        written before the trash — and the local row follows its new step.
      */
      const { rows: stepRows } = await todoDb().query(
        `SELECT id, text, completed FROM todo_tasks
         WHERE parent_task_id = $1 ORDER BY position, created_at`,
        [action.taskId]
      );
      for (const row of stepRows) {
        const step = await createBasecampStep(
          conn,
          projectId,
          String(created.id),
          row.text as string
        );
        if (row.completed) {
          await setBasecampStepCompletion(conn, projectId, String(step.id), true);
        }
        await todoDb().query(
          `UPDATE todo_tasks SET basecamp_id = $1,
             basecamp_base_text = $2, basecamp_base_completed = $3
           WHERE id = $4`,
          [String(step.id), row.text, Boolean(row.completed), row.id]
        );
      }
      if (fromProjectId) {
        await trashBasecampTodo(conn, fromProjectId, action.basecampId);
      }
      return;
    }

    if (action.type === "create" && action.taskId && action.text) {
      // The row already carries its assignees, because createTodoTask writes
      // them before it pushes. Read them the same way the assign branch does.
      // Without this the to-do reaches Basecamp with nobody on it, and stays
      // that way until the next full sync repairs it.
      const assignees =
        (await localAssigneesByTask([action.taskId])).get(action.taskId) ?? [];
      let assigneeIds: number[] = [];
      if (assignees.length) {
        const projectPeople = await listBasecampProjectPeople(conn, projectId);
        assigneeIds = splitAssigneesForPush(
          assignees,
          new Set(projectPeople.map((person) => String(person.id)))
        ).ids;
      }
      const created = await createBasecampTodo(
        conn,
        projectId,
        list.basecamp_list_id as string,
        action.text,
        action.notesHtml,
        assigneeIds,
        action.dueOn ?? null
      );
      await todoDb().query(
        "UPDATE todo_tasks SET basecamp_id = $1 WHERE id = $2",
        [String(created.id), action.taskId]
      );
      return;
    }
    if (!action.basecampId) return;
    if (action.type === "complete") {
      await setBasecampTodoCompletion(
        conn,
        projectId,
        action.basecampId,
        Boolean(action.completed)
      );
    } else if (
      (action.type === "update-text" || action.type === "assign") &&
      action.taskId &&
      action.text
    ) {
      // Title, notes and assignees all travel on the one PUT, because
      // Basecamp clears whatever the request leaves out. That is why an
      // assignment change and a text edit share this branch.
      const projectPeople = await listBasecampProjectPeople(conn, projectId);
      const assignees =
        (await localAssigneesByTask([action.taskId])).get(action.taskId) ?? [];
      const push = splitAssigneesForPush(
        assignees,
        new Set(projectPeople.map((person) => String(person.id)))
      );
      await updateBasecampTodo(conn, projectId, action.basecampId, {
        content: action.text,
        description: action.notesHtml,
        assigneeIds: push.ids,
        dueOn: action.dueOn ?? null,
      });
      /*
        Basecamp expands each `<bc-attachment>` on the way in: the tag
        that comes back carries url, href and a blob id. The skinny tag
        we sent cannot be drawn after a reopen — Trix treats it as an
        image with no src, and the browser asks for `/undefined`.

        Read the to-do back and keep what they wrote, so the next open
        has an address this app can proxy.
      */
      if (action.taskId && /<bc-attachment/i.test(action.notesHtml ?? "")) {
        let remote = await getBasecampTodo(
          conn,
          projectId,
          action.basecampId
        );
        /*
          Basecamp expands one tag at a time. A note with two pictures
          can come back with a url on the first and none on the second.
          Waiting for any url then writes that half-done HTML, and the
          second picture keeps a local id this process no longer has.
        */
        for (let i = 0; i < 5; i++) {
          if (!attachmentMissingUrl(remote?.description)) break;
          await sleep(400);
          remote =
            (await getBasecampTodo(conn, projectId, action.basecampId)) ??
            remote;
        }
        const expanded = normalizeBasecampNotes(remote?.description);
        if (expanded && !attachmentMissingUrl(expanded)) {
          await todoDb().query(
            `UPDATE todo_tasks
             SET notes_html = $1, basecamp_base_notes = $1, updated_at = NOW()
             WHERE id = $2`,
            [expanded, action.taskId]
          );
        }
      }
    } else if (action.type === "delete") {
      await trashBasecampTodo(conn, projectId, action.basecampId);
    }
  } catch (err) {
    console.warn("[todo] Basecamp push failed:", err);
  }
}
