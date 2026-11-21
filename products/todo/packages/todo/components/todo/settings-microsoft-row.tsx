"use client";

/*
 * Settings → Integrations → Microsoft, in the desktop app.
 *
 * The person signs in on Microsoft's page in their browser. The desktop
 * shell does the sign-in and keeps the tokens (microsoft.rs); this row
 * only ever sees who signed in and what they allowed.
 *
 * A connection does one thing, sync with Microsoft To Do. The same row as
 * Google's (settings-google-row.tsx).
 *
 * Hidden in the planner, and in a build with no Microsoft client id.
 */

import * as React from "react";
import { toast } from "sonner";

import { describeError } from "@/lib/todo/errors";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { todoHostApi } from "@/lib/todo/standalone-api";
import { listenMicrosoftSignIn } from "@/lib/todo/standalone-microsoft";

type Account = { email: string; tasks: boolean };
type Status = { canConnect: boolean; accounts: Account[] };

async function readStatus(): Promise<Status | null> {
  try {
    return (await todoHostApi("/api/todo/microsoft/status", "GET")) as unknown as Status;
  } catch {
    return null;
  }
}

export function SettingsMicrosoftRow({ t }: { t: (key: string) => string }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [waiting, setWaiting] = React.useState(false);
  const standalone = isStandaloneTodo();

  React.useEffect(() => {
    if (!standalone) return;
    void readStatus().then(setStatus);
    return listenMicrosoftSignIn({
      onSuccess: () => {
        setWaiting(false);
        toast.success(t("microsoftConnected"));
        void readStatus().then(setStatus);
      },
      onError: (message) => {
        setWaiting(false);
        toast.error(message || t("microsoftSignInFailed"));
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
      await todoHostApi("/api/todo/microsoft/connect", "POST");
    } catch (err) {
      setWaiting(false);
      toast.error(describeError(err, t("microsoftSignInFailed")));
    }
  }

  async function disconnect(email: string) {
    try {
      await todoHostApi("/api/todo/microsoft/disconnect", "POST", { email });
      setStatus(await readStatus());
    } catch {
      toast.error(t("microsoftDisconnectFailed"));
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
                <span>{t("connectedMicrosoft")}</span>
              </div>
              <div className="settings-account-info">{account.email}</div>
              {account.tasks ? null : (
                <div className="settings-row-hint">
                  {t("microsoftTasksNotAllowed")}{" "}
                  <button type="button" className="settings-text-link" onClick={() => void connect()}>
                    {t("microsoftAskAgain")}
                  </button>
                </div>
              )}
              {index === status.accounts.length - 1 && status.canConnect ? (
                <div className="settings-row-hint">
                  {waiting ? (
                    t("microsoftWaiting")
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
        <span className="settings-row-label">Microsoft</span>
        <span className="settings-row-hint">
          {waiting ? t("microsoftWaiting") : t("microsoftInfo")}
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
