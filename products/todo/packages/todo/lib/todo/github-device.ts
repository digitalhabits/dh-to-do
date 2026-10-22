/**
 * Signing a person in to GitHub with the device flow, and keeping the
 * sign-in. For the standalone app, which may hold no secret: the device
 * flow needs only the app's client id, and that is public.
 *
 * The flow: we ask GitHub for a code; the person types it on
 * github.com/login/device; we ask GitHub every few seconds whether they
 * have; then GitHub gives a token for that person. The token can use only
 * the repositories where the person has installed the app.
 *
 * The app is set to give tokens that do not expire ("Expire user
 * authorization tokens" off), so there is nothing to renew and no broker.
 * If GitHub refuses the token later, the person connects again.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

import { todoDb } from "./db-driver";
import { githubApi, githubHeaders } from "./github-client";

/**
 * The GitHub App's public ids. The client id is not a secret: every device
 * flow sends it. Left empty, the sign-in stays hidden.
 */
export const TODO_GITHUB_CLIENT_ID = "Iv23liUfTwpf0SuSdVjy";
/** The app's address name on GitHub, for its "install" page. */
export const TODO_GITHUB_APP_SLUG = "digital-habits-to-do";

export function githubInstallUrl(slug = TODO_GITHUB_APP_SLUG): string | null {
  return slug ? `https://github.com/apps/${slug}/installations/new` : null;
}

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds between two asks. GitHub can raise it with slow_down. */
  interval: number;
  /** Seconds until the code runs out. */
  expiresIn: number;
};

async function postForm(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  fields: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new PlanError(`GitHub refused the sign-in (${res.status})`, 502);
  }
  return json;
}

export async function startDeviceFlow(
  fetchImpl: typeof globalThis.fetch,
  clientId: string
): Promise<DeviceCode> {
  if (!clientId) throw new PlanError("GitHub sign-in is not set up in this app", 503);
  const json = await postForm(fetchImpl, "https://github.com/login/device/code", {
    client_id: clientId,
  });
  if (typeof json.device_code !== "string" || typeof json.user_code !== "string") {
    // Most often: device flow is not turned on in the app's settings.
    throw new PlanError(
      `GitHub gave no sign-in code${json.error ? ` (${String(json.error)})` : ""}`,
      502
    );
  }
  return {
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: String(json.verification_uri ?? "https://github.com/login/device"),
    interval: Number(json.interval ?? 5),
    expiresIn: Number(json.expires_in ?? 900),
  };
}

export type DevicePoll =
  | { status: "waiting"; interval?: number }
  | { status: "done"; token: string }
  | { status: "denied" | "expired" };

/** Has the person typed the code yet? Ask once; the caller waits between. */
export async function pollDeviceFlow(
  fetchImpl: typeof globalThis.fetch,
  clientId: string,
  deviceCode: string
): Promise<DevicePoll> {
  const json = await postForm(fetchImpl, "https://github.com/login/oauth/access_token", {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (typeof json.access_token === "string") return { status: "done", token: json.access_token };
  switch (json.error) {
    case "authorization_pending":
      return { status: "waiting" };
    case "slow_down":
      return { status: "waiting", interval: Number(json.interval ?? 10) };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
      return { status: "expired" };
    default:
      throw new PlanError(`GitHub sign-in failed (${String(json.error ?? "no answer")})`, 502);
  }
}

/** Whose token this is. */
export async function fetchGithubLogin(
  fetchImpl: typeof globalThis.fetch,
  token: string
): Promise<string> {
  const res = await fetchImpl(githubApi("/user"), { headers: githubHeaders(token) });
  if (!res.ok) throw new PlanError(`GitHub would not say who signed in (${res.status})`, 502);
  return ((await res.json()) as { login: string }).login;
}

/**
 * The repositories a person's token can reach through the app: those in
 * each of their installations.
 */
export async function listUserRepositories(
  fetchImpl: typeof globalThis.fetch,
  token: string
): Promise<string[]> {
  const res = await fetchImpl(githubApi("/user/installations?per_page=100"), {
    headers: githubHeaders(token),
  });
  if (!res.ok) throw new PlanError(`GitHub would not list the installations (${res.status})`, 502);
  const { installations } = (await res.json()) as { installations: { id: number }[] };
  const all: string[] = [];
  for (const inst of installations) {
    let next: string | null = githubApi(`/user/installations/${inst.id}/repositories?per_page=100`);
    for (let page = 0; next && page < 10; page++) {
      const list: Response = await fetchImpl(next, { headers: githubHeaders(token) });
      if (!list.ok) break;
      const body = (await list.json()) as { repositories: { full_name: string }[] };
      all.push(...body.repositories.map((r) => r.full_name));
      next = list.headers.get("Link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
  }
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// The kept sign-in: one row, as Basecamp's is.

export type GithubConnection = { accessToken: string; login: string | null };

export async function getGithubConnection(): Promise<GithubConnection | null> {
  const { rows } = await todoDb().query("SELECT * FROM todo_github_connection WHERE id = 1");
  if (!rows[0]) return null;
  return {
    accessToken: rows[0].access_token as string,
    login: (rows[0].login as string | null) ?? null,
  };
}

export async function saveGithubConnection(conn: GithubConnection): Promise<void> {
  await todoDb().query(
    `INSERT INTO todo_github_connection (id, access_token, login)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       login = EXCLUDED.login,
       updated_at = NOW()`,
    [conn.accessToken, conn.login]
  );
}

export async function deleteGithubConnection(): Promise<void> {
  await todoDb().query("DELETE FROM todo_github_connection WHERE id = 1");
}
