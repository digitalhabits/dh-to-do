/**
 * The standalone app's GitHub transport.
 *
 * Fetch goes through the Tauri HTTP plugin: GitHub's sign-in endpoints send
 * no CORS headers, so webview fetch cannot reach them. The token is the
 * person's own, from the device flow (github-device.ts), and it can use only
 * the repositories where they installed the app. The sync itself is the
 * shared code in github.ts — the planner runs the very same lines.
 */
import {
  TODO_GITHUB_CLIENT_ID,
  getGithubConnection,
  listUserRepositories,
} from "./github-device";
import { setGithubTransport } from "./github-client";

export async function nativeFetch(
  ...args: Parameters<typeof globalThis.fetch>
): Promise<Response> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  return tauriFetch(...(args as Parameters<typeof tauriFetch>));
}

let installed = false;

export function installStandaloneGithubTransport() {
  if (installed) return;
  installed = true;
  setGithubTransport({
    fetch: nativeFetch,
    // One token for every repository. It does not expire (the app is set
    // that way), so a refused one cannot be renewed: the person connects
    // again, and the error says so.
    token: async (_repo, fresh) => (fresh ? null : (await getGithubConnection())?.accessToken ?? null),
    repositories: async () => {
      const conn = await getGithubConnection();
      return conn ? listUserRepositories(nativeFetch, conn.accessToken) : [];
    },
    configured: () => Boolean(TODO_GITHUB_CLIENT_ID),
  });
}
