/**
 * The standalone app's Basecamp transport.
 *
 * Fetch goes through the Tauri HTTP plugin: webview fetch answers to CORS,
 * and Basecamp's API sends no CORS headers. Refresh goes through the Amplify
 * broker at todo.digitalhabits.org, which holds the client secret a desktop
 * app cannot carry. The sync itself is the shared code in basecamp.ts — the
 * planner runs the very same lines against Postgres.
 */
import {
  saveBasecampConnection,
  setBasecampTransport,
  type BasecampConnection,
} from "./basecamp";

const AMPLIFY_AUTH = "https://todo.digitalhabits.org/api/auth";

async function refreshViaAmplify(
  conn: BasecampConnection
): Promise<BasecampConnection | null> {
  if (!conn.refreshToken) return null;
  const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
  const res = await nativeFetch(AMPLIFY_AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: conn.refreshToken }),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof json.access_token !== "string") return null;
  const updated: BasecampConnection = {
    ...conn,
    accessToken: json.access_token,
    refreshToken:
      typeof json.refresh_token === "string"
        ? json.refresh_token
        : conn.refreshToken,
  };
  await saveBasecampConnection(updated);
  return updated;
}

let installed = false;

export function installStandaloneBasecampTransport() {
  if (installed) return;
  installed = true;
  setBasecampTransport({
    fetch: async (...args) => {
      const { fetch: nativeFetch } = await import("@tauri-apps/plugin-http");
      return nativeFetch(...(args as Parameters<typeof nativeFetch>));
    },
    refresh: refreshViaAmplify,
  });
}
