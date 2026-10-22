"use client";

/*
 * Settings → Integrations → GitHub, in the standalone app.
 *
 * The person signs in with GitHub's device flow (lib/todo/github-device.ts):
 * the app shows a short code, the person types it on github.com, and the
 * app asks GitHub every few seconds whether they have. The token stays in
 * the app's own store; this row only ever sees who signed in.
 *
 * The planner has the same row and the same sign-in, one per team member
 * (lib/todo/github-person-auth.ts). Until a person signs in, the planner
 * acts on GitHub as the team's GitHub App, and the row says so. Hidden
 * when there is neither an app key nor a client id.
 */

import * as React from "react";
import { toast } from "sonner";

import { SettingsInfoLabel } from "@/components/todo/settings-info-label";
import { describeError } from "@/lib/todo/errors";
import { fillText } from "@/lib/todo/i18n";
import { todoHostApi } from "@/lib/todo/standalone-api";

type Status = {
  /** This person's own sign-in. */
  connected: boolean;
  /** The planner: the team's GitHub App works for whoever has not signed in. */
  asApp?: boolean;
  appConfigured?: boolean;
  login: string | null;
  canConnect: boolean;
  installUrl: string | null;
};

type Pending = { deviceCode: string; userCode: string; verificationUri: string };

/** Ask GitHub, wait, ask again, until the person is done or the code ends. */
function usePollWhile(
  pending: Pending | null,
  interval: number,
  onAnswer: (json: Record<string, unknown>) => boolean
) {
  React.useEffect(() => {
    if (!pending) return;
    let stop = false;
    let wait = interval;
    let timer = 0;
    const ask = async () => {
      if (stop) return;
      try {
        const json = await todoHostApi("/api/todo/github/device/poll", "POST", {
          deviceCode: pending.deviceCode,
        });
        if (typeof json.interval === "number") wait = json.interval;
        if (onAnswer(json)) return;
      } catch (err) {
        if (onAnswer({ status: "error", message: describeError(err, "") })) return;
      }
      timer = window.setTimeout(() => void ask(), wait * 1000);
    };
    timer = window.setTimeout(() => void ask(), wait * 1000);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // onAnswer is a fresh closure each draw; the poll is for one code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, interval]);
}

export function SettingsGithubRow({ t }: { t: (key: string) => string }) {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [interval, setPollInterval] = React.useState(5);
  const [infoOpen, setInfoOpen] = React.useState(false);

  React.useEffect(() => {
    void todoHostApi("/api/todo/github/status", "GET")
      .then((json) => setStatus(json as unknown as Status))
      .catch(() => setStatus(null));
  }, []);

  usePollWhile(pending, interval, (json) => {
    if (json.status === "waiting") return false;
    setPending(null);
    if (json.status === "done") {
      setStatus((s) => (s ? { ...s, connected: true, login: (json.login as string) ?? null } : s));
      toast.success(t("githubConnected"));
    } else if (json.status === "denied") {
      toast.error(t("githubSignInDenied"));
    } else if (json.status === "expired") {
      toast.error(t("githubSignInExpired"));
    } else {
      toast.error(String(json.message || t("githubSignInFailed")));
    }
    return true;
  });

  if (!status) return null;
  const teamApp = Boolean(status.asApp && status.appConfigured);
  if (!status.connected && !status.canConnect && !teamApp) return null;

  async function start() {
    try {
      const json = await todoHostApi("/api/todo/github/device/start", "POST");
      setPollInterval(Number(json.interval) || 5);
      setPending({
        deviceCode: String(json.deviceCode),
        userCode: String(json.userCode),
        verificationUri: String(json.verificationUri),
      });
      void navigator.clipboard?.writeText(String(json.userCode)).catch(() => {});
    } catch (err) {
      toast.error(describeError(err, t("githubSignInFailed")));
    }
  }

  async function disconnect() {
    try {
      await todoHostApi("/api/todo/github/disconnect", "POST");
      setStatus((s) => (s ? { ...s, connected: false, login: null } : s));
    } catch {
      toast.error(t("githubDisconnectFailed"));
    }
  }

  if (status.connected) {
    return (
      <div className="settings-row settings-connection-row">
        <div className="settings-row-copy">
          <div className="connection-status">
            <span className="status-dot" />
            <span>{t("connectedGithub")}</span>
          </div>
          <div className="settings-account-info">
            {status.login ? `@${status.login}` : ""}
            {status.installUrl ? (
              <>
                {" · "}
                <a className="settings-text-link" href={status.installUrl} target="_blank" rel="noopener noreferrer">
                  {t("githubChooseRepositories")}
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="settings-row-control">
          <button className="settings-disconnect-btn" onClick={() => void disconnect()}>
            {t("disconnect")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-row settings-integration-row">
      <div className="settings-row-copy">
        <SettingsInfoLabel label="GitHub" open={infoOpen} onToggle={() => setInfoOpen((v) => !v)} t={t}>
          {teamApp ? t("githubTeamAppInfo") : t("githubInfo")}
        </SettingsInfoLabel>
        {teamApp ? (
          <div className="settings-account-info">
            {t("githubAsTeamApp")}
            {status.installUrl ? (
              <>
                {" · "}
                <a className="settings-text-link" href={status.installUrl} target="_blank" rel="noopener noreferrer">
                  {t("githubChooseRepositories")}
                </a>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {status.canConnect ? (
        <div className="settings-row-control">
          <button
            className="settings-connect-btn"
            type="button"
            disabled={Boolean(pending)}
            onClick={() => void start()}
          >
            {t("connect")}
          </button>
        </div>
      ) : null}
      {pending ? (
        <div className="settings-manual-auth settings-github-code">
          <div>{t("githubTypeCode")}</div>
          <code className="settings-github-user-code">{pending.userCode}</code>
          <div className="settings-github-code-actions">
            <a
              className="modal-btn connect-btn"
              href={pending.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("githubOpenSignIn")}
            </a>
            <button type="button" className="settings-text-link" onClick={() => setPending(null)}>
              {t("cancel")}
            </button>
          </div>
          <div className="settings-row-hint">
            {fillText(t("githubWaiting"), { code: pending.userCode })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
