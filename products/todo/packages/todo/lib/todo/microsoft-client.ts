/**
 * The Microsoft connection: the transport, and the authorized fetch that
 * every call to Microsoft To Do goes through.
 *
 * Built as the Google connection is (google-client.ts). Only the desktop
 * app installs a transport (standalone-microsoft.ts), so task data from
 * Microsoft stays on the person's computer. The planner installs none, so
 * there `configured()` is false and nothing here runs.
 *
 * Part of microsoft.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/todo/plan-error";

/** Microsoft Graph. A request to any other place gets no token. */
export const GRAPH = "https://graph.microsoft.com/v1.0";

/** The one permission the sync needs. */
export const MICROSOFT_TASKS_SCOPE = "Tasks.ReadWrite";

/** One signed-in Microsoft account, and what it allowed. */
export type MicrosoftAccount = {
  email: string;
  /** The scopes Microsoft granted, as its token answer names them. */
  scopes: string[];
};

/**
 * Microsoft names a granted scope "Tasks.ReadWrite" or, in some answers,
 * with Graph's address in front. Capitals are not kept the same either.
 */
export function accountCanSyncTasks(account: MicrosoftAccount): boolean {
  const wanted = MICROSOFT_TASKS_SCOPE.toLowerCase();
  return account.scopes.some((scope) => scope.toLowerCase().split("/").pop() === wanted);
}

export type MicrosoftTransport = {
  fetch: typeof globalThis.fetch;
  /**
   * A token for this account, or null when it is not signed in. `fresh`
   * asks for a new one: Microsoft refused the last.
   */
  token: (email: string, fresh?: boolean) => Promise<string | null>;
  /** The accounts signed in on this computer. */
  accounts: () => Promise<MicrosoftAccount[]>;
  /** True when this build has what it needs to sign in. */
  configured: () => boolean;
};

let transport: MicrosoftTransport = {
  fetch: (...args) => globalThis.fetch(...args),
  token: async () => null,
  accounts: async () => [],
  configured: () => false,
};

export function setMicrosoftTransport(next: MicrosoftTransport) {
  transport = next;
}

export function microsoftTransport(): MicrosoftTransport {
  return transport;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The longest wait for a rate limit inside one request. Longer: give up. */
const MAX_WAIT_MS = 10_000;

/** Tests set this to 0, so a back-off does not take real seconds. */
let backoffStepMs = 1000;
export function setMicrosoftBackoffStep(ms: number) {
  backoffStepMs = ms;
}

/**
 * How long to wait before the same request again, or null when the answer
 * is not "slow down". Graph says it with 429, and with 503 or 504 when the
 * service is busy.
 */
function rateLimitWait(res: Response, attempt: number): number | null {
  if (res.status !== 429 && res.status !== 503 && res.status !== 504) return null;
  const retryAfter = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return backoffStepMs * 2 ** attempt;
}

/**
 * An authorized request for one account, with one new token after a 401
 * and a wait that grows when Microsoft says to slow down.
 */
export async function microsoftFetch(
  email: string,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // The place of the next read of changes is an address that Microsoft
  // gave and the database kept. The token goes to Graph only.
  if (!url.startsWith(`${GRAPH}/`)) {
    throw new PlanError("That is not an address of Microsoft To Do.", 400);
  }
  let token = await transport.token(email);
  if (!token) {
    throw new PlanError("Microsoft is not connected. Connect Microsoft in Settings.", 400);
  }
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
    const wait = rateLimitWait(response, attempt);
    if (wait === null) return response;
    if (wait > MAX_WAIT_MS) break;
    await sleep(wait);
  }
  if (rateLimitWait(response, 0) !== null) {
    throw new PlanError("Microsoft asks us to wait. Try again in a few minutes.", 503);
  }
  return response;
}

/** Graph's own name for what went wrong ("ErrorItemNotFound"), or "". */
export async function microsoftErrorCode(res: Response): Promise<string> {
  const body = (await res
    .clone()
    .json()
    .catch(() => ({}))) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

/** A failed answer as an error the page can show. */
export async function microsoftError(what: string, res: Response): Promise<PlanError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const reason = body.error?.message ? `: ${body.error.message}` : "";
  if (res.status === 401) {
    return new PlanError(
      "Microsoft no longer accepts the sign-in. Connect Microsoft again in Settings.",
      401
    );
  }
  if (res.status === 403) {
    return new PlanError(
      `Microsoft did not allow this (${what}). Connect Microsoft again in Settings.`,
      403
    );
  }
  return new PlanError(`Microsoft refused ${what} (${res.status})${reason}`, 502);
}
