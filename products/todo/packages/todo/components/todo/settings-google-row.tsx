"use client";

/*
 * Settings → Integrations → Google, in the desktop app.
 *
 * The person signs in on Google's page in their browser. The desktop
 * shell does the sign-in and keeps the tokens (google.rs); this row only
 * ever sees who signed in and what they allowed.
 *
 * One row for all of Google. Today a connection does one thing, sync with
 * Google Tasks. A person can refuse that permission on Google's page; the
 * row then says so, and offers to ask again.
 *
 * Hidden in the planner, and in a build with no Google client id.
 */

import * as React from "react";
import { toast } from "sonner";

import { describeError } from "@/lib/todo/errors";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { todoHostApi } from "@/lib/todo/standalone-api";
import { listenGoogleSignIn } from "@/lib/todo/standalone-google";

type Account = { email: string; tasks: boolean };
type Status = { canConnect: boolean; accounts: Account[] };

async function readStatus(): Promise<Status | null> {
  try {
    return (await todoHostApi("/api/todo/google/status", "GET")) as unknown as Status;
  } catch {
    return null;
  }
}

export function SettingsGoogleRow({ t }: { t: (key: string) => string }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [waiting, setWaiting] = React.useState(false);
  const standalone = isStandaloneTodo();

  React.useEffect(() => {
    if (!standalone) return;
    void readStatus().then(setStatus);
    return listenGoogleSignIn({
      onSuccess: () => {
        setWaiting(false);
        toast.success(t("googleConnected"));
        void readStatus().then(setStatus);
      },
      onError: (message) => {
        setWaiting(false);
        toast.error(message || t("googleSignInFailed"));
      },
    });
    // `t` is a fresh function each draw; the listener is for the row's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone]);

  if (!standalone || !status) return null;
  if (!status.canConnect && !status.accounts.length) return null;

  async function connect() {
    try {
      setWaiting(true);
      await todoHostApi("/api/todo/google/connect", "POST");
    } catch (err) {
      setWaiting(false);
      toast.error(describeError(err, t("googleSignInFailed")));
    }
  }

  async function disconnect(email: string) {
    try {
      await todoHostApi("/api/todo/google/disconnect", "POST", { email });
      setStatus(await readStatus());
    } catch {
      toast.error(t("googleDisconnectFailed"));
    }
  }

  // One row for each account. The last one has the way to add another.
  if (status.accounts.length) {
    return (
      <>
        {status.accounts.map((account, index) => (
          <div className="settings-row settings-connection-row" key={account.email}>
            <div className="settings-row-copy">
              <div className="connection-status">
                <span className="status-dot" />
                <span>{t("connectedGoogle")}</span>
              </div>
              <div className="settings-account-info">{account.email}</div>
              {account.tasks ? null : (
                <div className="settings-row-hint">
                  {t("googleTasksNotAllowed")}{" "}
                  <button type="button" className="settings-text-link" onClick={() => void connect()}>
                    {t("googleAskAgain")}
                  </button>
                </div>
              )}
              {index === status.accounts.length - 1 && status.canConnect ? (
                <div className="settings-row-hint">
                  {waiting ? (
                    t("googleWaiting")
                  ) : (
                    <button type="button" className="settings-text-link" onClick={() => void connect()}>
                      {t("addAnotherAccount")}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <div className="settings-row-control">
              <button className="settings-disconnect-btn" onClick={() => void disconnect(account.email)}>
                {t("disconnect")}
              </button>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <div className="settings-row settings-integration-row">
      <div className="settings-row-copy">
        <span className="settings-row-label">Google</span>
        <span className="settings-row-hint">
          {waiting ? t("googleWaiting") : t("googleInfo")}
        </span>
      </div>
      <div className="settings-row-control">
        <button
          className="settings-connect-btn"
          type="button"
          disabled={waiting}
          onClick={() => void connect()}
        >
          {t("connect")}
        </button>
      </div>
    </div>
  );
}
