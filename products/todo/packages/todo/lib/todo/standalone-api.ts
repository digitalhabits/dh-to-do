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
import { describeError } from "./errors";
import { installSqliteTodoDriver } from "./sqlite-driver";
import { installTauriMediaStore } from "./tauri-media";
import { installStandaloneBasecampTransport } from "./standalone-basecamp";
import { isStandaloneTodo } from "./product-flavor";
import { THIS_DEVICE_MAKER } from "./people-scope";
import * as store from "./store";

let driverReady = false;

function ensureDriver() {
  if (driverReady) return;
  installSqliteTodoDriver();
  installStandaloneBasecampTransport();
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

  ensureDriver();

  if (pathname === "/api/todo/state" && upper === "GET") {
    const today =
      new URL(path, "http://local.invalid").searchParams.get("today") ??
      undefined;
    return { state: await store.getTodoState({ today }) };
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

  if (pathname === "/api/todo/lists") {
    if (upper === "POST") {
      const list = await store.createTodoList(
        payload as Parameters<typeof store.createTodoList>[0]
      );
      return { list };
    }
    if (upper === "PATCH") {
      const { id: listId, ...patch } = payload;
      return { list: await store.updateTodoList(String(listId), patch) };
    }
    if (upper === "DELETE" && id) {
      await store.deleteTodoList(id);
      return { ok: true };
    }
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
        handlers.onError(describeError(err, "Could not save Basecamp login"));
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
