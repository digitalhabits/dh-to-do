/**
 * The GitHub connection: the transport, and the authorized fetch that every
 * call goes through.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

const GITHUB_API = "https://api.github.com";
const GITHUB_USER_AGENT = "Digital Habits: To-Do (team@digitalhabits.org)";

/**
 * What differs per app, as with Basecamp (basecamp-client.ts).
 *
 * The planner signs in as a GitHub App on the server: a token per
 * installation, made from the app's private key (github-app-auth.ts). The
 * standalone app will sign in as its user and fetch through the Tauri HTTP
 * plugin. The sync itself is the same code either way.
 */
export type GithubTransport = {
  fetch: typeof globalThis.fetch;
  /**
   * A token that may act on this repository ("owner/name"), or null when
   * there is no connection. `fresh` asks for a new one: GitHub refused the
   * last.
   */
  token: (repo: string, fresh?: boolean) => Promise<string | null>;
  /** The repositories this connection can reach, as "owner/name". */
  repositories: () => Promise<string[]>;
  /** True when this app has what it needs to connect. */
  configured: () => boolean;
};

let transport: GithubTransport = {
  fetch: (...args) => globalThis.fetch(...args),
  token: async () => null,
  repositories: async () => [],
  configured: () => false,
};

export function setGithubTransport(next: GithubTransport) {
  transport = next;
}

export function githubTransport(): GithubTransport {
  return transport;
}

export function githubApi(path: string): string {
  return `${GITHUB_API}${path}`;
}

export function githubHeaders(token: string | null): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": GITHUB_USER_AGENT,
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The longest wait for a rate limit inside one request. Longer: give up. */
const MAX_WAIT_MS = 10_000;

/**
 * How long GitHub asks us to wait, or null when this is not a rate limit.
 * A 403 is a rate limit only when GitHub says so; otherwise it is a
 * refusal, and waiting would not change it.
 */
function rateLimitWait(res: Response): number | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const retryAfter = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  if (res.headers.get("X-RateLimit-Remaining") === "0") {
    const reset = Number(res.headers.get("X-RateLimit-Reset"));
    return Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) : 60_000;
  }
  return res.status === 429 ? 2000 : null;
}

/**
 * An authorized request for one repository, with one new token after a
 * 401 and a short wait on a rate limit.
 */
export async function ghFetch(
  repo: string,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let token = await transport.token(repo);
  if (!token) throw new PlanError("GitHub is not connected", 400);
  const headers = githubHeaders(token);
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response = new Response(null, { status: 599 });
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await transport.fetch(url, { ...options, headers });
    if (response.status === 401 && attempt === 0) {
      token = await transport.token(repo, true);
      if (!token) return response;
      headers.set("Authorization", `Bearer ${token}`);
      continue;
    }
    const wait = rateLimitWait(response);
    if (wait === null) return response;
    if (wait > MAX_WAIT_MS) {
      throw new PlanError("GitHub asks us to wait. Try again in a few minutes.", 503);
    }
    await sleep(wait);
  }
  return response;
}

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    if (/rel="?next"?/.test(part)) {
      const match = part.match(/<([^>]+)>/);
      if (match) return match[1];
    }
  }
  return null;
}

/** A failed answer as an error the routes can show. */
export async function githubError(what: string, res: Response): Promise<PlanError> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  const reason = body.message ? `: ${body.message}` : "";
  if (res.status === 401) {
    return new PlanError(
      "GitHub no longer accepts the sign-in. Connect GitHub again in Settings.",
      401
    );
  }
  if (res.status === 404) {
    return new PlanError(
      `GitHub cannot find this, or the app may not use it (${what}, 404)`,
      502
    );
  }
  return new PlanError(`GitHub refused ${what} (${res.status})${reason}`, 502);
}
