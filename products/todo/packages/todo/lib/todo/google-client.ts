/**
 * The Google connection: the transport, and the authorized fetch that every
 * call to Google Tasks goes through.
 *
 * Only the desktop app installs a transport (standalone-google.ts). Task
 * data from Google stays on the person's computer: that is what we told
 * Google when it approved the app. The planner installs none, so there
 * `configured()` is false and nothing here runs.
 *
 * Part of google.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/todo/plan-error";

/** The one permission Tasks sync needs. Calendar reading will be a second. */
export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

/** One signed-in Google account, and what the person allowed it to do. */
export type GoogleAccount = {
  email: string;
  /** The scopes Google granted. A person can refuse one on the consent page. */
  scopes: string[];
};

export function accountCanSyncTasks(account: GoogleAccount): boolean {
  return account.scopes.includes(GOOGLE_TASKS_SCOPE);
}

export type GoogleTransport = {
  fetch: typeof globalThis.fetch;
  /**
   * A token for this account, or null when it is not signed in. `fresh`
   * asks for a new one: Google refused the last.
   */
  token: (email: string, fresh?: boolean) => Promise<string | null>;
  /** The accounts signed in on this computer. */
  accounts: () => Promise<GoogleAccount[]>;
  /** True when this build has what it needs to sign in. */
  configured: () => boolean;
};

let transport: GoogleTransport = {
  fetch: (...args) => globalThis.fetch(...args),
  token: async () => null,
  accounts: async () => [],
  configured: () => false,
};

export function setGoogleTransport(next: GoogleTransport) {
  transport = next;
}

export function googleTransport(): GoogleTransport {
  return transport;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The longest wait for a rate limit inside one request. Longer: give up. */
const MAX_WAIT_MS = 10_000;

/** Tests set this to 0, so a back-off does not take real seconds. */
let backoffStepMs = 1000;
export function setGoogleBackoffStep(ms: number) {
  backoffStepMs = ms;
}

/**
 * How long to wait before the same request again, or null when the answer
 * is not "slow down". Google says it with 429, with 503, and with 403 and a
 * reason that names the rate limit. Any other 403 is a refusal.
 */
async function rateLimitWait(res: Response, attempt: number): Promise<number | null> {
  let limited = res.status === 429 || res.status === 503;
  if (res.status === 403) {
    const text = await res.clone().text().catch(() => "");
    limited = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(text);
  }
  if (!limited) return null;
  const retryAfter = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return backoffStepMs * 2 ** attempt;
}

/**
 * An authorized request for one account, with one new token after a 401
 * and a wait that grows when Google says to slow down.
 */
export async function googleFetch(
  email: string,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  let token = await transport.token(email);
  if (!token) throw new PlanError("Google is not connected. Connect Google in Settings.", 400);
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response = new Response(null, { status: 599 });
  let renewed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    response = await transport.fetch(url, { ...options, headers });
    if (response.status === 401 && !renewed) {
      renewed = true;
      token = await transport.token(email, true);
      if (!token) return response;
      headers.set("Authorization", `Bearer ${token}`);
      continue;
    }
    const wait = await rateLimitWait(response, attempt);
    if (wait === null) return response;
    if (wait > MAX_WAIT_MS) break;
    await sleep(wait);
  }
  if ((await rateLimitWait(response, 0)) !== null) {
    throw new PlanError("Google asks us to wait. Try again in a few minutes.", 503);
  }
  return response;
}

/** A failed answer as an error the page can show. */
export async function googleError(what: string, res: Response): Promise<PlanError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const reason = body.error?.message ? `: ${body.error.message}` : "";
  if (res.status === 401) {
    return new PlanError(
      "Google no longer accepts the sign-in. Connect Google again in Settings.",
      401
    );
  }
  if (res.status === 403) {
    return new PlanError(
      `Google did not allow this (${what}). Connect Google again in Settings and allow Google Tasks.`,
      403
    );
  }
  return new PlanError(`Google refused ${what} (${res.status})${reason}`, 502);
}
