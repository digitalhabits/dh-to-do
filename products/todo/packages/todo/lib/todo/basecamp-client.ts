/**
 * The Basecamp connection: the transport, the saved tokens, sign-in and
 * refresh, and the authorized fetch that every call goes through.
 *
 * Part of basecamp.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

import { todoDb } from "./db-driver";

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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when any `<bc-attachment>` in the HTML still has no `url`. */
export function attachmentMissingUrl(html: string | null | undefined): boolean {
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
export async function bcFetch(
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

export async function bcFetchAllPages<T>(
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

export function api(conn: BasecampConnection, path: string): string {
  return `https://3.basecampapi.com/${conn.accountId}${path}`;
}
