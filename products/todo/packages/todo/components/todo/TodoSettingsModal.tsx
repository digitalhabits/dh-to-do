"use client";

import type { DeletedListTask, DeletedTodoList } from "@/lib/todo/store";
import * as React from "react";

import { DeletedListsRow } from "@/components/todo/settings-deleted-lists";
import { SettingsGithubRow } from "@/components/todo/settings-github-row";
import { useClearWindowButtons } from "@/components/todo/use-clear-window-buttons";
import { SECTION_TITLE, useSettingsPage } from "@/components/todo/use-settings-page";
import { Activity, Columns4, FolderTree, Map as MapIcon, SquareKanban, Timer, User } from "lucide-react";
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
  readUsagePingEnabled,
  writeUsagePingEnabled,
} from "@/lib/todo/usage-ping-setting";
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

function SettingsToggle({
  icon,
  label,
  desc,
  info,
  checked,
  onChange,
}: {
  /** A small picture of the feature, in front of its name. */
  icon?: React.ReactNode;
  label: string;
  /** One line under the name. */
  desc: string;
  /** The longer word on it, as the row's tooltip. */
  info: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={`settings-row${icon ? " has-icon" : ""}`} title={info}>
      {icon ? (
        <span className="settings-row-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="settings-row-copy">
        <span className="settings-row-label">{label}</span>
        <span className="settings-row-hint">{desc}</span>
      </div>
      <div className="settings-row-control">
        <label className="enforcement-switch">
          <input
            type="checkbox"
            className="enforcement-toggle-input"
            aria-label={label}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="enforcement-slider" />
        </label>
      </div>
    </div>
  );
}

/**
 * A card in miniature, for Settings > Task card density: Loose has its
 * details on a line of their own under the name; Compact has them beside
 * it, on the one line.
 */
function CardDensityGlyph({ compact }: { compact: boolean }) {
  return (
    <svg className="card-density-glyph" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
      <rect x="0.75" y="0.75" width="20.5" height="14.5" rx="3" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      {compact ? (
        <>
          <rect x="4" y="7" width="8" height="2" rx="1" fill="currentColor" />
          <rect x="14" y="7" width="4" height="2" rx="1" fill="currentColor" opacity="0.55" />
        </>
      ) : (
        <>
          <rect x="4" y="4.5" width="14" height="2" rx="1" fill="currentColor" />
          <rect x="10" y="9.5" width="8" height="2" rx="1" fill="currentColor" opacity="0.55" />
        </>
      )}
    </svg>
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
  compactCards,
  onCompactCardsChange,
  groupsEnabled,
  onGroupsEnabledChange,
  planEnabled,
  onPlanEnabledChange,
  loadDeletedLists,
  loadDeletedListTasks,
  onRestoreList,
  onDeleteListForever,
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
  /** Each task on one line where it fits (use-todo-page). */
  compactCards: boolean;
  onCompactCardsChange: (on: boolean) => void;
  groupsEnabled: boolean;
  onGroupsEnabledChange: (enabled: boolean) => void;
  planEnabled: boolean;
  onPlanEnabledChange: (enabled: boolean) => void;
  /** Deleted lists, kept with their tasks; and bringing one back. */
  loadDeletedLists?: () => Promise<DeletedTodoList[]>;
  /** The tasks of one deleted list, to look over before it comes back. */
  loadDeletedListTasks?: (id: string) => Promise<DeletedListTask[]>;
  onRestoreList?: (id: string) => Promise<void>;
  /** A deleted list gone for good, with its tasks. */
  onDeleteListForever?: (id: string) => Promise<void>;
}) {
  const [langOpen, setLangOpen] = React.useState(false);
  const langPickerRef = React.useRef<HTMLDivElement>(null);
  // The language list closes on a press anywhere else, and on Escape (which
  // then does not also close Settings). Before Settings was a page, a press
  // outside closed the whole dialog, and the list with it.
  React.useEffect(() => {
    if (!langOpen) return;
    const onPress = (e: PointerEvent) => {
      if (langPickerRef.current?.contains(e.target as Node)) return;
      setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setLangOpen(false);
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [langOpen]);
  const [bcStatus, setBcStatus] = React.useState<BasecampStatus | null>(null);
  const [manualOpen, setManualOpen] = React.useState(false);
  const [manualToken, setManualToken] = React.useState("");
  const [remindersConnected, setRemindersConnected] = React.useState(false);
  const [remindersBusy, setRemindersBusy] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  // The full-window sheet's bar, clear of the Mac window's buttons (16px: its own padding).
  const sheetHeaderRef = React.useRef<HTMLDivElement>(null);
  useClearWindowButtons(sheetHeaderRef, 16);
  // Standalone app only: the planner's To-Do tab sends no usage ping.
  const [usagePingEnabled, setUsagePingEnabled] = React.useState(readUsagePingEnabled);
  // Only where the count can run: a Mac or Windows store build, where
  // apps/todo/src/usage-ping.ts sets the flag. Dev sets it too, to look
  // the same, and sends nothing.
  const showUsageSwitch =
    isStandaloneTodo() &&
    Boolean((window as unknown as { __TODO_USAGE_PING__?: string }).__TODO_USAGE_PING__);
  const otherLang: TodoLang = lang === "da" ? "en" : "da";
  const page = useSettingsPage(onClose, showUsageSwitch);

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

  const feedback = (
    <div className="settings-page-foot">
      <p
        className="settings-page-feedback"
        dangerouslySetInnerHTML={{ __html: t("settingsFeedbackShort") }}
      />
      {appVersion ? (
        <div className="settings-page-version">
          {t("yourVersion")} {appVersion}
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      id="settings-modal"
      ref={page.overlayRef}
      className={`modal-overlay settings-page${page.wide ? " is-wide" : ""}`}
    >
      <div className="modal-content">
        {/* Its empty part moves the window: on Windows there is no
            system title bar above it. */}
        <div className="settings-sheet-header" ref={sheetHeaderRef} data-tauri-drag-region>
          {/* The chevron and the word are one button: a press on
              "Settings" goes back too. */}
          <button
            type="button"
            className="settings-sheet-back"
            aria-label="Back"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="settings-sheet-title">{t("settings")}</span>
          </button>
        </div>
        <div className="settings-page-panes">
          {/* The sections, beside the page when it is wide enough. A press
              goes to one; the one being read is marked. */}
          <nav className="settings-page-nav" aria-label={t("settings")}>
            <div className="settings-page-nav-items">
              {page.sections.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`settings-page-nav-item${page.current === id ? " is-current" : ""}`}
                  aria-current={page.current === id ? "true" : undefined}
                  onClick={() => page.goTo(id)}
                >
                  {t(SECTION_TITLE[id])}
                </button>
              ))}
            </div>
            {feedback}
          </nav>
          <div className="settings-sheet-body" ref={page.scrollRef}>
          <div className="settings-stack">
            <section className="settings-section" data-settings-section="general">
              <h2 className="settings-page-heading">{t("settingsGeneral")}</h2>
              <div className="settings-panel">
                <div className="settings-panel-rows">
                  <div className="settings-row">
                    <label className="settings-row-label">{t("language")}</label>
                    <div className="settings-row-control">
                      <div className="language-picker" ref={langPickerRef}>
                        <button
                          type="button"
                          className="language-picker-trigger"
                          aria-expanded={langOpen}
                          aria-haspopup="listbox"
                          onClick={() => setLangOpen((v) => !v)}
                        >
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
                    <span className="settings-row-label" id="cards-density-label">{t("cardsDensity")}</span>
                    <div className="settings-row-control">
                      {/* Loose: a task's details under its name. Compact: beside it,
                          on one line where it fits. */}
                      <div className="board-people-scope" role="radiogroup" aria-labelledby="cards-density-label">
                        {([false, true] as const).map((compact) => (
                          <button
                            key={String(compact)}
                            type="button"
                            role="radio"
                            aria-checked={compactCards === compact}
                            className={`board-people-scope-btn${compactCards === compact ? " active" : ""}`}
                            onClick={() => onCompactCardsChange(compact)}
                          >
                            <CardDensityGlyph compact={compact} />
                            {t(compact ? "cardsCompact" : "cardsLoose")}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="settings-section" data-settings-section="features">
              <h2 className="settings-page-heading">{t("settingsFeatures")}</h2>
              <p className="settings-page-intro">{t("settingsFeaturesIntro")}</p>
              <div className="settings-panel">
                <div className="settings-panel-rows">
                  <SettingsToggle
                    icon={<Timer size={16} strokeWidth={2} />}
                    label={t("alwaysShowFocusTimer")}
                    desc={t("focusTimerDesc")}
                    info={t("alwaysShowFocusTimerInfo")}
                    checked={focusTimerAlways}
                    onChange={onFocusTimerAlwaysChange}
                  />
                  <SettingsToggle
                    icon={<SquareKanban size={16} strokeWidth={2} />}
                    label={t("enableKanbanView")}
                    desc={t("kanbanViewDesc")}
                    info={t("kanbanViewInfo")}
                    checked={kanbanEnabled}
                    onChange={onKanbanEnabledChange}
                  />
                  {kanbanEnabled ? (
                    <SettingsToggle
                      icon={<Columns4 size={16} strokeWidth={2} />}
                      label={t("enableSomedayColumn")}
                    desc={t("somedayColumnDesc")}
                      info={t("somedayColumnInfo")}
                      checked={somedayEnabled}
                      onChange={onSomedayEnabledChange}
                    />
                  ) : null}
                  <SettingsToggle
                    icon={<FolderTree size={16} strokeWidth={2} />}
                    label={t("enableTabGroups")}
                    desc={t("tabGroupsDesc")}
                    info={t("tabGroupsInfo")}
                    checked={groupsEnabled}
                    onChange={onGroupsEnabledChange}
                  />
                  <SettingsToggle
                    icon={<User size={16} strokeWidth={2} />}
                    label={t("enableAssignTasks")}
                    desc={t("assignTasksDesc")}
                    info={t("assignTasksInfo")}
                    checked={assignEnabled}
                    onChange={onAssignEnabledChange}
                  />
                  <SettingsToggle
                    icon={<MapIcon size={16} strokeWidth={2} />}
                    label={t("enablePlanMode")}
                    desc={t("planModeDesc")}
                    info={t("planModeInfo")}
                    checked={planEnabled}
                    onChange={onPlanEnabledChange}
                  />
                </div>
              </div>
            </section>

            <section className="settings-section" data-settings-section="integrations">
              <h2 className="settings-page-heading">{t("integrations")}</h2>
              <div className="settings-panel">
                <div className="settings-panel-rows">
                  {/* Each integration is one row. Its info opens under the
                      name, as the hint of the backup row: it wraps before the
                      button, which stays centred on the row. */}
                  {!remindersConnected ? (
                    <div className="settings-row settings-integration-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">{t("appleReminders")}</span>
                        <span className="settings-row-hint">{t("remindersInfo")}</span>
                      </div>
                      <div className="settings-row-control">
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
                  {!bcStatus?.connected ? (
                    <div className="settings-row settings-integration-row">
                      <div className="settings-row-copy">
                        <span className="settings-row-label">{t("connectBasecamp")}</span>
                        <span className="settings-row-hint">
                          {t("basecampInfo")}{" "}
                          <button
                            type="button"
                            className="settings-text-link"
                            aria-expanded={manualOpen}
                            onClick={() => setManualOpen((v) => !v)}
                          >
                            {t("basecampManualToken")}
                          </button>
                        </span>
                      </div>
                      <div className="settings-row-control">
                        <button
                          className="settings-connect-btn settings-connect-btn--basecamp"
                          type="button"
                          onClick={() => void connectBasecamp()}
                        >
                          {t("connect")}
                        </button>
                      </div>
                      {/* Under the whole row, so the button keeps its place.
                          It opens from the info text, and closes with it. */}
                      {manualOpen ? (
                        <div className="settings-manual-auth">
                          <input
                            type="password"
                            className="settings-input"
                            placeholder={t("basecampTokenPlaceholder")}
                            value={manualToken}
                            onChange={(e) => setManualToken(e.target.value)}
                          />
                          <button
                            type="button"
                            className="modal-btn connect-btn"
                            onClick={() => void saveManualToken()}
                          >
                            {t("basecampSaveToken")}
                          </button>
                        </div>
                      ) : null}
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
                  {/* A person's own sign-in in the desktop app; the team's
                      GitHub App in the planner. */}
                  <SettingsGithubRow t={t} />
                </div>
              </div>
            </section>

            <section className="settings-section" data-settings-section="data">
              <h2 className="settings-page-heading">{t("settingsData")}</h2>
              <div className="settings-panel">
                <div className="settings-panel-rows">
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
                  {loadDeletedLists && loadDeletedListTasks && onRestoreList && onDeleteListForever ? (
                    <DeletedListsRow
                      t={t}
                      lang={lang}
                      load={loadDeletedLists}
                      loadTasks={loadDeletedListTasks}
                      restore={onRestoreList}
                      deleteForever={onDeleteListForever}
                    />
                  ) : null}
                </div>
              </div>
            </section>

            {showUsageSwitch ? (
              <section className="settings-section" data-settings-section="admin">
                <h2 className="settings-page-heading">{t("settingsAdmin")}</h2>
                <div className="settings-panel">
                  <div className="settings-panel-rows">
                    <SettingsToggle
                      icon={<Activity size={16} strokeWidth={2} />}
                      label={t("sendUsageCount")}
                      desc={t("sendUsageCountInfo")}
                      info={t("sendUsageCountInfo")}
                      checked={usagePingEnabled}
                      onChange={(enabled) => {
                        setUsagePingEnabled(enabled);
                        writeUsagePingEnabled(enabled);
                      }}
                    />
                  </div>
                </div>
              </section>
            ) : null}
            {/* Narrow: no sidebar, so its foot comes at the end. */}
            {page.wide ? null : feedback}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
