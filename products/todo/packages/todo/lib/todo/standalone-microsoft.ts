/**
 * The desktop app's Microsoft transport.
 *
 * The sign-in is in Rust (apps/todo/src-tauri/src/microsoft.rs). Rust keeps
 * the refresh token in the system's credential store and hands this page
 * a short-lived access token when it asks. The page never sees the
 * refresh token, so it cannot reach a backup file or the board's
 * database.
 *
 * Fetch goes through the Tauri HTTP plugin, as GitHub's does.
 */
import { type MicrosoftAccount, setMicrosoftTransport } from "./microsoft-client";
import { nativeFetch } from "./standalone-github";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function invoke(): Invoke | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke } };
    __TAURI_INTERNALS__?: { invoke?: Invoke };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

export type MicrosoftStatus = {
  /** This build has a Microsoft client id: a person can sign in. */
  configured: boolean;
  accounts: MicrosoftAccount[];
};

/** What Rust knows: whether the build can sign in, and who is signed in. */
export async function readMicrosoftStatus(): Promise<MicrosoftStatus> {
  const call = invoke();
  if (!call) return { configured: false, accounts: [] };
  const status = ((await call("microsoft_status")) ?? {}) as Partial<MicrosoftStatus>;
  configured = Boolean(status.configured);
  return { configured, accounts: status.accounts ?? [] };
}

/** Opens the browser on Microsoft's sign-in page. The answer comes as an event. */
export async function startMicrosoftSignIn(): Promise<void> {
  const call = invoke();
  if (!call) throw new Error("Microsoft sign-in needs the desktop app.");
  await call("start_microsoft_auth");
}

/** Forget an account. Microsoft has no call that ends the permission. */
export async function disconnectMicrosoft(email: string): Promise<void> {
  const call = invoke();
  if (!call) return;
  await call("microsoft_disconnect", { email });
}

let configured = false;
let installed = false;

export function installStandaloneMicrosoftTransport() {
  if (installed) return;
  installed = true;
  setMicrosoftTransport({
    fetch: nativeFetch,
    token: async (email, fresh) => {
      const call = invoke();
      if (!call) return null;
      try {
        return (await call("microsoft_access_token", { email, fresh: Boolean(fresh) })) as string;
      } catch {
        // Not signed in, or Microsoft ended the sign-in: the caller says so.
        return null;
      }
    },
    accounts: async () => (await readMicrosoftStatus()).accounts,
    // Known once the status was read: Settings and the list dialog read it.
    configured: () => configured,
  });
}

type Listen = (
  event: string,
  handler: (event: { payload: unknown }) => void
) => Promise<() => void>;

/**
 * Hear the end of a sign-in that `startMicrosoftSignIn` began: who signed in,
 * or why it failed.
 *
 * `listen` answers after the caller can already be gone (the Settings
 * window closed). So the cleanup records that it ran, and a handle that
 * arrives after it goes straight back. See listenStandaloneBasecampAuth.
 */
export function listenMicrosoftSignIn(handlers: {
  onSuccess: (account: MicrosoftAccount) => void;
  onError: (message: string) => void;
}): () => void {
  const listen =
    typeof window === "undefined"
      ? null
      : ((window as unknown as { __TAURI__?: { event?: { listen?: Listen } } }).__TAURI__?.event
          ?.listen ?? null);
  if (!listen) return () => {};
  const unsubs: Array<() => void> = [];
  let stopped = false;
  const keep = (off: () => void) => {
    if (stopped) off();
    else unsubs.push(off);
  };
  void (async () => {
    keep(
      await listen("microsoft-auth-success", (event) => {
        const payload = event.payload as Partial<MicrosoftAccount>;
        handlers.onSuccess({ email: payload.email ?? "", scopes: payload.scopes ?? [] });
      })
    );
    keep(
      await listen("microsoft-auth-error", (event) => {
        handlers.onError(typeof event.payload === "string" ? event.payload : "");
      })
    );
  })();
  return () => {
    stopped = true;
    for (const off of unsubs.splice(0)) off();
  };
}
