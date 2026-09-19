"use client";

import * as React from "react";
import { Columns4, FolderTree, Map as MapIcon, SquareKanban, Timer, User } from "lucide-react";
import { toast } from "sonner";

import {
  fetchRemindersLists,
  isNativeShell,
  openRemindersPrivacySettings,
} from "@/lib/native-shell";
import {
  LANGUAGE_FLAG_SVG,
  LANGUAGE_NATIVE_LABELS,
  type TodoLang,
} from "@/lib/todo/i18n";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { describeError } from "@/lib/todo/errors";
import {
  listenStandaloneBasecampAuth,
  startStandaloneBasecampAuth,
  todoHostApi,
} from "@/lib/todo/standalone-api";

export const REMINDERS_CONNECTED_KEY = "redd-plan-todo-reminders";

type BasecampStatus = {
  connected: boolean;
  email: string | null;
  configured: boolean;
};

export type TodoTheme = "system" | "light" | "dark";

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function SettingsToggle({
  icon,
  label,
  info,
  checked,
  onChange,
}: {
  /** A small picture of the feature, in front of its name. */
  icon?: React.ReactNode;
  label: string;
  info: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const [infoOpen, setInfoOpen] = React.useState(false);
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-label-line">
          {icon ? (
            <span className="settings-row-icon" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <span className="settings-row-label">{label}</span>
          <div className="settings-info-hover-wrap">
            <button
              type="button"
              className="info-toggle-btn settings-info-btn"
              onClick={() => setInfoOpen((v) => !v)}
            >
              <InfoIcon />
            </button>
            <div
              className="settings-info-tooltip"
              role="tooltip"
              style={infoOpen ? { opacity: 1, visibility: "visible" } : undefined}
            >
              {info}
            </div>
          </div>
        </div>
      </div>
      <div className="settings-row-control">
        <label className="enforcement-switch">
          <input
            type="checkbox"
            className="enforcement-toggle-input"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="enforcement-slider" />
        </label>
      </div>
    </div>
  );
}

export function TodoSettingsModal({
  t,
  lang,
  onLangChange,
  theme,
  onThemeChange,
  zoom,
  onZoomChange,
  onExport,
  onImport,
  onClose,
  appVersion,
  kanbanEnabled,
  onKanbanEnabledChange,
  somedayEnabled,
  onSomedayEnabledChange,
  assignEnabled,
  onAssignEnabledChange,
  focusTimerAlways,
  onFocusTimerAlwaysChange,
  groupsEnabled,
  onGroupsEnabledChange,
  planEnabled,
  onPlanEnabledChange,
}: {
  t: (key: string) => string;
  lang: TodoLang;
  onLangChange: (lang: TodoLang) => void;
  theme: TodoTheme;
  onThemeChange: (theme: TodoTheme) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onClose: () => void;
  appVersion?: string;
  kanbanEnabled: boolean;
  onKanbanEnabledChange: (enabled: boolean) => void;
  somedayEnabled: boolean;
  onSomedayEnabledChange: (enabled: boolean) => void;
  assignEnabled: boolean;
  onAssignEnabledChange: (enabled: boolean) => void;
  /** Off: Focus Mode shows a timer only for a task with a duration. */
  focusTimerAlways: boolean;
  onFocusTimerAlwaysChange: (always: boolean) => void;
  groupsEnabled: boolean;
  onGroupsEnabledChange: (enabled: boolean) => void;
  planEnabled: boolean;
  onPlanEnabledChange: (enabled: boolean) => void;
}) {
  const [langOpen, setLangOpen] = React.useState(false);
  const [remindersInfoOpen, setRemindersInfoOpen] = React.useState(false);
  const [basecampInfoOpen, setBasecampInfoOpen] = React.useState(false);
  const [bcStatus, setBcStatus] = React.useState<BasecampStatus | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualToken, setManualToken] = React.useState("");
  const [remindersConnected, setRemindersConnected] = React.useState(false);
  const [remindersBusy, setRemindersBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const otherLang: TodoLang = lang === "da" ? "en" : "da";

  React.useEffect(() => {
    try {
      setRemindersConnected(
        localStorage.getItem(REMINDERS_CONNECTED_KEY) === "1"
      );
    } catch {
      /* ignore */
    }
    void todoHostApi("/api/todo/basecamp/status", "GET")
      .then((json) => setBcStatus(json as BasecampStatus))
      .catch(() =>
        setBcStatus({ connected: false, email: null, configured: true })
      );
  }, []);

  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    return listenStandaloneBasecampAuth({
      onSuccess: (status) => {
        setBcStatus({
          connected: Boolean(status.connected),
          email: (status.email as string | null) ?? null,
          configured: true,
        });
        toast.success("Basecamp connected");
      },
      onError: (message) => toast.error(message),
    });
  }, []);

  async function connectReminders() {
    if (!isNativeShell()) {
      toast("Apple Reminders connects from the desktop app.");
      return;
    }
    setRemindersBusy(true);
    try {
      // First call triggers the macOS permission prompt.
      await fetchRemindersLists();
      setRemindersConnected(true);
      try {
        localStorage.setItem(REMINDERS_CONNECTED_KEY, "1");
      } catch {
        /* ignore */
      }
    } catch (err) {
      // EventKit names the reason — denied, restricted, or the raw error. It
      // arrives as a string, because Rust rejects the command with one.
      toast.error(describeError(err, "Could not access Reminders"));
      void openRemindersPrivacySettings().catch(() => {});
    } finally {
      setRemindersBusy(false);
    }
  }

  function disconnectReminders() {
    setRemindersConnected(false);
    try {
      localStorage.setItem(REMINDERS_CONNECTED_KEY, "0");
    } catch {
      /* ignore */
    }
  }

  async function disconnectBasecamp() {
    try {
      await todoHostApi("/api/todo/basecamp/disconnect", "POST");
      setBcStatus((s) =>
        s
          ? { ...s, connected: false, email: null }
          : { connected: false, email: null, configured: true }
      );
    } catch {
      toast.error("Could not disconnect Basecamp");
    }
  }

  async function connectBasecamp() {
    if (isStandaloneTodo()) {
      try {
        await startStandaloneBasecampAuth();
      } catch (err) {
        toast.error(describeError(err, "Could not start Basecamp login"));
      }
      return;
    }
    if (bcStatus && !bcStatus.configured) {
      setManualOpen((v) => !v);
      return;
    }
    window.location.href = "/api/todo/basecamp/connect";
  }

  async function saveManualToken() {
    const accessToken = manualToken.trim();
    if (!accessToken) return;
    try {
      const json = await todoHostApi("/api/todo/basecamp/manual", "POST", {
        accessToken,
      });
      setManualOpen(false);
      setManualToken("");
      setBcStatus({
        connected: true,
        email: (json.email as string | null) ?? null,
        configured: true,
      });
    } catch (err) {
      toast.error(describeError(err, "Invalid token"));
    }
  }

  return (
    <div
      id="settings-modal"
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <div className="settings-sheet-header">
          <button
            type="button"
            className="settings-sheet-back"
            aria-label="Back"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="settings-sheet-title">{t("settings")}</div>
        </div>
        <div className="settings-modal-header">
          <h3 id="settings-modal-title">{t("settings")}</h3>
          {appVersion ? (
            <div className="settings-current-version">
              {t("yourVersion")}: {appVersion}
            </div>
          ) : null}
        </div>
        <div className="settings-sheet-body">
          <div className="settings-stack">
            <div className="settings-feedback-footer">
              <svg className="settings-feedback-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
              </svg>
              <p
                className="settings-feedback-text"
                dangerouslySetInnerHTML={{
                  __html:
                    lang === "da"
                      ? 'Feedback eller forslag? <a href="https://github.com/digitalhabits/dh-to-do/issues" target="_blank" rel="noopener noreferrer">Opret et issue på GitHub</a> eller skriv til <a href="mailto:team@digitalhabits.org">team@digitalhabits.org</a>.'
                      : 'Feedback or suggestions? <a href="https://github.com/digitalhabits/dh-to-do/issues" target="_blank" rel="noopener noreferrer">Open an issue on GitHub</a> or email <a href="mailto:team@digitalhabits.org">team@digitalhabits.org</a>.',
                }}
              />
            </div>

            <section className="settings-section">
              <h4 className="settings-section-heading">{t("settingsGeneral")}</h4>
              <div className="settings-panel">
                <div className="settings-panel-rows">
                  <div className="settings-row">
                    <label className="settings-row-label">{t("language")}</label>
                    <div className="settings-row-control">
                      <div className="language-picker">
                        <button
                          type="button"
                          className="language-picker-trigger"
                          aria-expanded={langOpen}
                          aria-haspopup="listbox"
                          onClick={() => setLangOpen((v) => !v)}
                        >
                          <span
                            className="language-picker-flag-wrap"
                            aria-hidden="true"
                            dangerouslySetInnerHTML={{ __html: LANGUAGE_FLAG_SVG[lang] }}
                          />
                          <span className="language-picker-code">
                            {LANGUAGE_NATIVE_LABELS[lang]}
                          </span>
                          <svg className="language-picker-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M7 10l5-4.5 5 4.5" />
                            <path d="M7 14l5 4.5 5-4.5" />
                          </svg>
                        </button>
                        {langOpen ? (
                          <div className="language-picker-dropdown" role="listbox">
                            <div className="language-picker-section">
                              <div className="language-picker-section-label">
                                {t("languagePickerCurrent")}
                              </div>
                              <div className="language-picker-option language-picker-option--current" role="presentation">
                                <span
                                  className="language-picker-flag-wrap"
                                  aria-hidden="true"
                                  dangerouslySetInnerHTML={{ __html: LANGUAGE_FLAG_SVG[lang] }}
                                />
                                <span className="language-picker-name">
                                  {LANGUAGE_NATIVE_LABELS[lang]}
                                </span>
                              </div>
                            </div>
                            <div className="language-picker-divider" />
                            <div className="language-picker-section">
                              <div className="language-picker-section-label">
                                {t("languagePickerSwitch")}
                              </div>
                              <button
                                type="button"
                                className="language-picker-option language-picker-option--switch"
                                role="option"
                                aria-selected="false"
                                onClick={() => {
                                  onLangChange(otherLang);
                                  setLangOpen(false);
                                }}
                              >
                                <span
                                  className="language-picker-flag-wrap"
                                  aria-hidden="true"
                                  dangerouslySetInnerHTML={{ __html: LANGUAGE_FLAG_SVG[otherLang] }}
                                />
                                <span className="language-picker-name">
                                  {LANGUAGE_NATIVE_LABELS[otherLang]}
                                </span>
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="settings-row">
                    <label className="settings-row-label" htmlFor="theme-select">
                      {t("settingsTheme")}
                    </label>
                    <div className="settings-row-control">
                      <select
                        id="theme-select"
                        className="settings-select"
                        value={theme}
                        onChange={(e) => onThemeChange(e.target.value as TodoTheme)}
                      >
                        <option value="system">{t("themeSystem")}</option>
                        <option value="light">{t("themeLight")}</option>
                        <option value="dark">{t("themeDark")}</option>
                      </select>
                    </div>
                  </div>

                  <div className="settings-row">
                    <span className="settings-row-label">{t("zoomLevel")}</span>
                    <div className="settings-row-control">
                      <div className="settings-zoom-control" role="group">
                        <button
                          type="button"
                          className="zoom-btn zoom-out-btn"
                          aria-label="Zoom out"
                          onClick={() => onZoomChange(Math.max(50, zoom - 10))}
                        >
                          −
                        </button>
                        <span className="zoom-value">{zoom}%</span>
                        <button
                          type="button"
                          className="zoom-btn zoom-in-btn"
                          aria-label="Zoom in"
                          onClick={() => onZoomChange(Math.min(170, zoom + 10))}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">{t("dataManagement")}</span>
                      <span className="settings-row-hint">{t("settingsDataHint")}</span>
                    </div>
                    <div className="settings-row-control settings-blocklists-io-btns">
                      <button className="settings-blocklists-io-btn" type="button" onClick={onExport}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>{t("exportLabel")}</span>
                      </button>
                      <button
                        className="settings-blocklists-io-btn"
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span>{t("importLabel")}</span>
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) onImport(file);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <h4 className="settings-section-heading">{t("settingsFeatures")}</h4>
              <div className="settings-panel">
                <div className="settings-panel-rows">
                  <SettingsToggle
                    icon={<SquareKanban size={16} strokeWidth={2} />}
                    label={t("enableKanbanView")}
                    info={t("kanbanViewInfo")}
                    checked={kanbanEnabled}
                    onChange={onKanbanEnabledChange}
                  />
                  {kanbanEnabled ? (
                    <SettingsToggle
                      icon={<Columns4 size={16} strokeWidth={2} />}
                    label={t("enableSomedayColumn")}
                      info={t("somedayColumnInfo")}
                      checked={somedayEnabled}
                      onChange={onSomedayEnabledChange}
                    />
                  ) : null}
                  <SettingsToggle
                    icon={<User size={16} strokeWidth={2} />}
                    label={t("enableAssignTasks")}
                    info={t("assignTasksInfo")}
                    checked={assignEnabled}
                    onChange={onAssignEnabledChange}
                  />
                  <SettingsToggle
                    icon={<FolderTree size={16} strokeWidth={2} />}
                    label={t("enableTabGroups")}
                    info={t("tabGroupsInfo")}
                    checked={groupsEnabled}
                    onChange={onGroupsEnabledChange}
                  />
                  <SettingsToggle
                    icon={<MapIcon size={16} strokeWidth={2} />}
                    label={t("enablePlanMode")}
                    info={t("planModeInfo")}
                    checked={planEnabled}
                    onChange={onPlanEnabledChange}
                  />
                  <SettingsToggle
                    icon={<Timer size={16} strokeWidth={2} />}
                    label={t("alwaysShowFocusTimer")}
                    info={t("alwaysShowFocusTimerInfo")}
                    checked={focusTimerAlways}
                    onChange={onFocusTimerAlwaysChange}
                  />
                </div>
              </div>
            </section>

            <section className="settings-section">
              <h4 className="settings-section-heading">{t("integrations")}</h4>
              <div className="settings-panel">
                <div className="settings-panel-rows">
                  {!remindersConnected ? (
                    <div className="settings-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">{t("appleReminders")}</span>
                      </div>
                      <div className="settings-row-control settings-row-actions">
                        <button
                          className="settings-connect-btn"
                          type="button"
                          disabled={remindersBusy}
                          onClick={() => void connectReminders()}
                        >
                          {remindersBusy
                            ? t("remindersContinuing") || "Continuing..."
                            : t("remindersContinue")}
                        </button>
                        <button
                          className="info-toggle-btn settings-info-btn"
                          title={t("moreInfo")}
                          aria-expanded={remindersInfoOpen}
                          onClick={() => setRemindersInfoOpen((v) => !v)}
                        >
                          <InfoIcon />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="settings-row settings-connection-row">
                      <div className="settings-row-copy">
                        <div className="connection-status">
                          <span className="status-dot" />
                          <span>{t("connectedAppleReminders")}</span>
                        </div>
                      </div>
                      <div className="settings-row-control">
                        <button
                          className="settings-disconnect-btn"
                          onClick={disconnectReminders}
                        >
                          {t("disconnect")}
                        </button>
                      </div>
                    </div>
                  )}
                  <p
                    className={`settings-panel-info info-expandable ${remindersInfoOpen ? "" : "hidden"}`}
                  >
                    {t("remindersInfo")}
                  </p>
                  <>
                      {!bcStatus?.connected ? (
                        <div className="settings-row">
                          <div className="settings-row-copy">
                            <span className="settings-row-label">
                              {t("connectBasecamp")}
                            </span>
                          </div>
                          <div className="settings-row-control settings-row-actions">
                            <button
                              className="settings-connect-btn settings-connect-btn--basecamp"
                              type="button"
                              onClick={() => void connectBasecamp()}
                            >
                              {t("connect")}
                            </button>
                            <button
                              className="info-toggle-btn settings-info-btn"
                              title={t("moreInfo")}
                              aria-expanded={basecampInfoOpen}
                              onClick={() => setBasecampInfoOpen((v) => !v)}
                            >
                              <InfoIcon />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="settings-row settings-connection-row">
                          <div className="settings-row-copy">
                            <div className="connection-status">
                              <span className="status-dot" />
                              <span>{t("connectedBasecamp")}</span>
                            </div>
                            {bcStatus.email ? (
                              <div className="settings-account-info">
                                {bcStatus.email}
                              </div>
                            ) : null}
                          </div>
                          <div className="settings-row-control">
                            <button
                              className="settings-disconnect-btn"
                              onClick={() => void disconnectBasecamp()}
                            >
                              {t("disconnect")}
                            </button>
                          </div>
                        </div>
                      )}
                      <div
                        className={`settings-panel-info info-expandable ${basecampInfoOpen ? "" : "hidden"}`}
                      >
                        <span
                          dangerouslySetInnerHTML={{
                            __html: t("basecampInfoHtml"),
                          }}
                        />
                        {!bcStatus?.connected ? (
                          <>
                            {" "}
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                setManualOpen((v) => !v);
                              }}
                            >
                              Enter a token manually
                            </a>
                            {manualOpen ? (
                              <div className="settings-manual-auth">
                                <input
                                  type="password"
                                  className="settings-input"
                                  placeholder="Access Token (OAuth)"
                                  value={manualToken}
                                  onChange={(e) =>
                                    setManualToken(e.target.value)
                                  }
                                />
                                <button
                                  className="modal-btn connect-btn"
                                  onClick={() => void saveManualToken()}
                                >
                                  Save Manual Credentials
                                </button>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                  </>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="modal-buttons settings-modal-footer">
          <button className="modal-btn cancel-btn" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
