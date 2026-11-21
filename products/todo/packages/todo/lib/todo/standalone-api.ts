/**
 * Maps TodoPage's fetch-style api(path, method, body) onto the shared store,
 * run in the webview against local SQLite through the todo_sql_* bridge.
 * Basecamp routes still map onto Tauri commands: the sync runs in Rust, and
 * OAuth needs the deep-link broker.
 *
 * The store here is the same module the planner's routes run against
 * Postgres. Only the driver differs, and no push hook is installed — the
 * standalone app reconciles with Basecamp on explicit sync, as it always has.
 */

import * as basecamp from "./basecamp";
import * as github from "./github";
import * as google from "./google";
import * as microsoft from "./microsoft";
import { describeError } from "./errors";
import { installSqliteTodoDriver } from "./sqlite-driver";
import { installTauriMediaStore } from "./tauri-media";
import { installStandaloneBasecampTransport } from "./standalone-basecamp";
import { installStandaloneGithubTransport, nativeFetch } from "./standalone-github";
import {
  disconnectGoogle,
  installStandaloneGoogleTransport,
  readGoogleStatus,
  startGoogleSignIn,
} from "./standalone-google";
import {
  disconnectMicrosoft,
  installStandaloneMicrosoftTransport,
  readMicrosoftStatus,
  startMicrosoftSignIn,
} from "./standalone-microsoft";
import { isStandaloneTodo } from "./product-flavor";
import { savedLangT } from "./saved-prefs";
import { THIS_DEVICE_MAKER } from "./people-scope";
import * as store from "./store";

let driverReady = false;

function ensureDriver() {
  if (driverReady) return;
  installSqliteTodoDriver();
  installStandaloneBasecampTransport();
  installStandaloneGithubTransport();
  // A deleted task closes its issue at once (github-push.ts); every other
  // change waits for the sync, as Basecamp's does here.
  store.addTodoRemoteListener("github", github.pushGithubAction);
  installStandaloneGoogleTransport();
  // Each task write asks the page for a sync of its list soon
  // (google-push.ts). Nothing goes to Google from the write itself.
  store.addTodoRemoteListener("google", google.noteGoogleBoardWrite);
  // Microsoft To Do hears the same word: it names lists, not a service.
  installStandaloneMicrosoftTransport();
  installTauriMediaStore();
  driverReady = true;
}

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

export function tauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

function parsePath(path: string): {
  pathname: string;
  id: string | null;
  projectId: string | null;
} {
  const url = new URL(path, "http://local.invalid");
  return {
    pathname: url.pathname,
    id: url.searchParams.get("id"),
    projectId: url.searchParams.get("projectId"),
  };
}

async function handleBasecamp(
  invoke: TauriInvoke,
  pathname: string,
  upper: string,
  payload: Record<string, unknown>,
  projectId: string | null
): Promise<Record<string, unknown>> {
  ensureDriver();
  if (pathname === "/api/todo/basecamp/status" && upper === "GET") {
    const conn = await basecamp.getBasecampConnection();
    return {
      connected: Boolean(conn),
      email: conn?.email ?? null,
      accountId: conn?.accountId ?? null,
      // The broker holds the secret, so being connected is being configured.
      configured: true,
    };
  }
  if (pathname === "/api/todo/basecamp/disconnect" && upper === "POST") {
    await basecamp.deleteBasecampConnection();
    return { ok: true };
  }
  if (pathname === "/api/todo/basecamp/manual" && upper === "POST") {
    const identity = await basecamp.connectBasecampWithTokens({
      accessToken: String(payload.accessToken ?? ""),
      refreshToken: (payload.refreshToken as string | null) ?? null,
    });
    return { connected: true, email: identity.email };
  }
  if (pathname === "/api/todo/basecamp/projects" && upper === "GET") {
    const conn = await basecamp.getBasecampConnection();
    if (!conn) return { projects: [] };
    const projects = await basecamp.listBasecampProjects(conn);
    return {
      projects: projects.map((p) => ({ id: String(p.id), name: p.name })),
    };
  }
  if (pathname === "/api/todo/basecamp/todolists" && upper === "GET") {
    if (!projectId) throw new Error("Missing projectId");
    const conn = await basecamp.getBasecampConnection();
    if (!conn) return { todolists: [] };
    const todolists = await basecamp.listBasecampTodolists(conn, projectId);
    return {
      todolists: todolists.map((l) => ({ id: String(l.id), name: l.name })),
    };
  }
  if (pathname === "/api/todo/basecamp/sync" && upper === "POST") {
    return { result: await basecamp.syncBasecampList(String(payload.listId)) };
  }
  if (pathname === "/api/todo/basecamp/connect" && upper === "GET") {
    await invoke("start_basecamp_auth");
    return { ok: true, started: true };
  }
  throw new Error(`Unsupported Basecamp route: ${upper} ${pathname}`);
}

/**
 * GitHub, the person's own sign-in. The planner has the same status,
 * repos and sync routes on its server (signed in as the GitHub App); the
 * device routes and disconnect are this app's alone.
 */
async function handleGithub(
  pathname: string,
  upper: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  ensureDriver();
  const route = `${upper} ${pathname.replace("/api/todo/github", "")}`;
  switch (route) {
    case "GET /status": {
      const conn = await github.getGithubConnection();
      return {
        // "configured" is what the list dialog asks: can a list be linked?
        configured: Boolean(conn),
        connected: Boolean(conn),
        login: conn?.login ?? null,
        canConnect: Boolean(github.TODO_GITHUB_CLIENT_ID),
        installUrl: github.githubInstallUrl(),
      };
    }
    case "GET /repos":
      return { repos: await github.githubTransport().repositories() };
    case "POST /sync":
      return { result: await github.syncGithubList(String(payload.listId)) };
    case "POST /device/start":
      return { ...(await github.startDeviceFlow(nativeFetch, github.TODO_GITHUB_CLIENT_ID)) };
    case "POST /device/poll": {
      const poll = await github.pollDeviceFlow(
        nativeFetch,
        github.TODO_GITHUB_CLIENT_ID,
        String(payload.deviceCode ?? "")
      );
      if (poll.status !== "done") return poll;
      const login = await github.fetchGithubLogin(nativeFetch, poll.token);
      await github.saveGithubConnection({ accessToken: poll.token, login });
      // The token never leaves this module: the page gets who, not how.
      return { status: "done", login };
    }
    case "POST /disconnect":
      await github.deleteGithubConnection();
      return { ok: true };
    default:
      throw new Error(`Unsupported GitHub route: ${route}`);
  }
}

/**
 * Google Tasks, the person's own sign-in. This app alone has these routes:
 * the planner must not sync Google Tasks on its server (google.ts).
 */
async function handleGoogle(
  pathname: string,
  upper: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  ensureDriver();
  const route = `${upper} ${pathname.replace("/api/todo/google", "")}`;
  switch (route) {
    case "GET /status": {
      const status = await readGoogleStatus();
      return {
        canConnect: status.configured,
        accounts: status.accounts.map((account) => ({
          email: account.email,
          tasks: google.accountCanSyncTasks(account),
        })),
      };
    }
    case "POST /lists":
      return { lists: await google.listGoogleTaskLists(String(payload.account ?? "")) };
    case "POST /sync":
      return {
        result: await google.syncGoogleList(String(payload.listId), {
          confirmRemovals: Boolean(payload.confirmRemovals),
        }),
      };
    case "POST /connect":
      await startGoogleSignIn();
      return { ok: true, started: true };
    case "POST /disconnect":
      await disconnectGoogle(String(payload.email ?? ""));
      return { ok: true };
    default:
      throw new Error(`Unsupported Google route: ${route}`);
  }
}

/**
 * Microsoft To Do, the person's own sign-in. As Google Tasks, this app
 * alone has these routes (microsoft.ts).
 */
async function handleMicrosoft(
  pathname: string,
  upper: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  ensureDriver();
  const route = `${upper} ${pathname.replace("/api/todo/microsoft", "")}`;
  switch (route) {
    case "GET /status": {
      const status = await readMicrosoftStatus();
      return {
        canConnect: status.configured,
        accounts: status.accounts.map((account) => ({
          email: account.email,
          tasks: microsoft.accountCanSyncTasks(account),
        })),
      };
    }
    case "POST /lists":
      return { lists: await microsoft.listMicrosoftTaskLists(String(payload.account ?? "")) };
    case "POST /sync":
      return {
        result: await microsoft.syncMicrosoftList(String(payload.listId), {
          confirmRemovals: Boolean(payload.confirmRemovals),
        }),
      };
    case "POST /connect":
      await startMicrosoftSignIn();
      return { ok: true, started: true };
    case "POST /disconnect":
      await disconnectMicrosoft(String(payload.email ?? ""));
      return { ok: true };
    default:
      throw new Error(`Unsupported Microsoft route: ${route}`);
  }
}

/** A list as the page gets it: with its Google or Microsoft link. */
async function withLinks<T extends Parameters<typeof google.withGoogleLinks>[0][number]>(
  lists: T[]
): Promise<T[]> {
  return microsoft.withMicrosoftLinks(await google.withGoogleLinks(lists));
}

/**
 * The lists. The Google link and the Microsoft link are this app's own
 * (google-link.ts, microsoft-link.ts): they are taken out of what the
 * store gets, and added to the list that goes back. A list has one of the
 * two at most: a new link of one kind ends the link of the other.
 * Null for a method this route does not have.
 */
async function handleLists(
  upper: string,
  payload: Record<string, unknown>,
  id: string | null
): Promise<Record<string, unknown> | null> {
  if (upper === "POST") {
    const { googleAccount, googleListId, microsoftAccount, microsoftListId, ...input } = payload;
    const list = await store.createTodoList(
      input as Parameters<typeof store.createTodoList>[0]
    );
    if (googleListId) {
      await google.setGoogleLink(list.id, String(googleAccount ?? ""), String(googleListId));
    } else if (microsoftListId) {
      await microsoft.setMicrosoftLink(
        list.id,
        String(microsoftAccount ?? ""),
        String(microsoftListId)
      );
    }
    return { list: (await withLinks([list]))[0] };
  }
  if (upper === "PATCH") {
    const {
      id: listId,
      googleAccount,
      googleListId,
      microsoftAccount,
      microsoftListId,
      ...patch
    } = payload;
    if (googleListId !== undefined) {
      await google.setGoogleLink(
        String(listId),
        googleListId ? String(googleAccount ?? "") : null,
        googleListId ? String(googleListId) : null
      );
      if (googleListId) await microsoft.setMicrosoftLink(String(listId), null, null);
    }
    // After Google's: when both come, Google's wins and this is none.
    if (microsoftListId !== undefined && !googleListId) {
      await microsoft.setMicrosoftLink(
        String(listId),
        microsoftListId ? String(microsoftAccount ?? "") : null,
        microsoftListId ? String(microsoftListId) : null
      );
      if (microsoftListId) await google.setGoogleLink(String(listId), null, null);
    }
    const list = await store.updateTodoList(String(listId), patch);
    return { list: (await withLinks([list]))[0] };
  }
  if (upper === "DELETE" && id) {
    await store.deleteTodoList(id);
    return { ok: true };
  }
  return null;
}

/**
 * Standalone transport. Throws if invoke is unavailable or the route is not
 * supported locally.
 */
export async function standaloneTodoApi(
  path: string,
  method: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  const invoke = tauriInvoke();
  if (!invoke) {
    throw new Error("Standalone To-Do requires the desktop app.");
  }

  const upper = method.toUpperCase();
  const { pathname, id, projectId } = parsePath(path);
  const payload =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  if (pathname.startsWith("/api/todo/basecamp")) {
    return handleBasecamp(invoke, pathname, upper, payload, projectId);
  }
  if (pathname.startsWith("/api/todo/github")) {
    return handleGithub(pathname, upper, payload);
  }
  if (pathname.startsWith("/api/todo/google")) {
    return handleGoogle(pathname, upper, payload);
  }
  if (pathname.startsWith("/api/todo/microsoft")) {
    return handleMicrosoft(pathname, upper, payload);
  }

  ensureDriver();

  if (pathname === "/api/todo/state" && upper === "GET") {
    const today =
      new URL(path, "http://local.invalid").searchParams.get("today") ??
      undefined;
    const state = await store.getTodoState({ today });
    return { state: { ...state, lists: await withLinks(state.lists) } };
  }

  if (pathname === "/api/todo/tasks") {
    if (upper === "POST") {
      // The app has no login: its one reader made every task it adds.
      const task = await store.createTodoTask({
        ...(payload as Parameters<typeof store.createTodoTask>[0]),
        createdBy: THIS_DEVICE_MAKER,
      });
      return { task };
    }
    if (upper === "PATCH") {
      const { id: taskId, ...patch } = payload;
      return { task: await store.updateTodoTask(String(taskId), patch) };
    }
    if (upper === "DELETE" && id) {
      await store.deleteTodoTask(id);
      return { ok: true };
    }
  }

  if (pathname === "/api/todo/subtasks") {
    if (upper === "POST") {
      const subtask = await store.createTodoSubtask(
        payload as Parameters<typeof store.createTodoSubtask>[0]
      );
      return { subtask };
    }
    if (upper === "PATCH") {
      const { id: subtaskId, ...patch } = payload;
      return { subtask: await store.updateTodoSubtask(String(subtaskId), patch) };
    }
    if (upper === "DELETE" && id) {
      await store.deleteTodoSubtask(id);
      return { ok: true };
    }
  }

  // Deleted lists, kept with their tasks (store.deleteTodoList).
  if (pathname === "/api/todo/lists/deleted") {
    if (upper === "GET" && id) return { tasks: await store.listDeletedTodoListTasks(id) };
    if (upper === "GET") return { lists: await store.listDeletedTodoLists() };
    if (upper === "POST") {
      await store.restoreTodoList(String(payload.id));
      return { ok: true };
    }
    if (upper === "DELETE" && id) {
      await store.deleteTodoListForever(id);
      return { ok: true };
    }
  }

  if (pathname === "/api/todo/lists") {
    const answer = await handleLists(upper, payload, id);
    if (answer) return answer;
  }

  if (pathname === "/api/todo/groups") {
    if (upper === "POST") {
      const group = await store.createTodoGroup(
        payload as Parameters<typeof store.createTodoGroup>[0]
      );
      return { group };
    }
    if (upper === "PATCH") {
      const { id: groupId, ...patch } = payload;
      return { group: await store.updateTodoGroup(String(groupId), patch) };
    }
    if (upper === "DELETE" && id) {
      await store.deleteTodoGroup(id);
      return { ok: true };
    }
  }

  if (pathname === "/api/todo/people") {
    if (upper === "POST") {
      const person = await store.createTodoPerson(
        payload as Parameters<typeof store.createTodoPerson>[0]
      );
      return { person };
    }
    if (upper === "PATCH") {
      const { id: personId, ...patch } = payload;
      return { person: await store.updateTodoPerson(String(personId), patch) };
    }
    if (upper === "DELETE" && id) {
      await store.deleteTodoPerson(id);
      return { ok: true };
    }
  }

  if (pathname === "/api/todo/import" && upper === "POST") {
    // `imported`, as app/api/todo/import/route.ts answers: the page reads
    // the counts from that key.
    return { imported: await store.importTodoBackup(payload) };
  }

  if (pathname === "/api/todo/people/search") {
    return { people: [] };
  }

  throw new Error(`Unsupported standalone route: ${upper} ${pathname}`);
}

export async function todoHostApi(
  path: string,
  method: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  if (isStandaloneTodo()) {
    return standaloneTodoApi(path, method, body);
  }
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

/** Start Amplify/Launchpad OAuth in the store app shell. */
export async function startStandaloneBasecampAuth(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Standalone To-Do requires the desktop app.");
  await invoke("start_basecamp_auth");
}

type TauriListen = (
  event: string,
  handler: (event: { payload: unknown }) => void
) => Promise<() => void>;

function tauriListen(): TauriListen | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { event?: { listen?: TauriListen } };
  };
  return w.__TAURI__?.event?.listen ?? null;
}

/**
 * Persist tokens after Amplify/localhost OAuth success.
 *
 * `listen` resolves after the caller can already be gone: the settings modal
 * mounts this, and the caller unmounts it. A cleanup that reads the handles
 * before they exist removes nothing, and the dead handler stays subscribed for
 * the life of the page. Each open of the modal then added one more, and one
 * connection raised one toast per open. So the cleanup records that it ran, and
 * a handle that arrives after it goes straight back.
 */
export function listenStandaloneBasecampAuth(handlers: {
  onSuccess: (status: Record<string, unknown>) => void;
  onError: (message: string) => void;
}): () => void {
  const listen = tauriListen();
  const invoke = tauriInvoke();
  if (!listen || !invoke) return () => {};

  const unsubs: Array<() => void> = [];
  let stopped = false;
  const keep = (off: () => void) => {
    if (stopped) off();
    else unsubs.push(off);
  };

  void (async () => {
    const offOk = await listen("basecamp-auth-success", async (event) => {
      try {
        const payload = event.payload as {
          access_token?: string;
          refresh_token?: string | null;
        };
        if (!payload.access_token) {
          handlers.onError("No access token received");
          return;
        }
        ensureDriver();
        const identity = await basecamp.fetchBasecampIdentity(
          payload.access_token
        );
        await basecamp.saveBasecampConnection({
          accountId: identity.accountId,
          accessToken: payload.access_token,
          refreshToken: payload.refresh_token ?? null,
          email: identity.email,
        });
        handlers.onSuccess({
          connected: true,
          email: identity.email,
          accountId: identity.accountId,
          configured: true,
        });
      } catch (err) {
        handlers.onError(describeError(err, savedLangT()("basecampLoginSaveFailed")));
      }
    });
    keep(offOk);
    const offErr = await listen("basecamp-auth-error", (event) => {
      handlers.onError(
        typeof event.payload === "string"
          ? event.payload
          : "Basecamp authentication failed"
      );
    });
    keep(offErr);
  })();

  return () => {
    stopped = true;
    for (const off of unsubs.splice(0)) off();
  };
}
