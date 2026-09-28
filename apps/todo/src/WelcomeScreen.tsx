/**
 * The one-time welcome screen, "Private by design", after Blocker's
 * #eula-onboarding. Shown until accepted (and, like Blocker, on every launch
 * of a dev build), in the main window only: the focus windows (?focus=1)
 * never show it. Accepting is saved by eula.ts, which also lets the usage
 * count start; raising EULA_REVISION there shows it to everyone again.
 */
import * as React from "react";

import type { TodoLang } from "@/lib/todo/i18n";

import logoUrl from "./todo-logo.svg";
import { acceptEula, eulaAccepted } from "./eula";
import "./welcome-screen.css";

// TodoPage's keys for the language and the theme (not exported there).
const LANG_KEY = "redd-plan-todo-lang";
const THEME_KEY = "redd-plan-todo-theme";

const PRIVACY_URL = "https://digitalhabits.org/privacy-policy#usage-count";
const EULA_URL = "https://digitalhabits.org/eula";
const SOURCE_URL = "https://github.com/digitalhabits/dh-to-do";

const COPY: Record<TodoLang, Record<string, string>> = {
  en: {
    title: "Welcome to Digital Habits: To-Do",
    subtitle:
      "Stay on track with floating task reminders, simple task lists, and easy time tracking.",
    privacyTitle: "Private by design",
    privacyLead: "We collect no personal data. We only count how many people use To-Do.",
    howWeCount: "How we count",
    howWeCountBody:
      "At most once a day, on a day you use To-Do, it sends one anonymous count with an ID that changes every month. You can turn it off in Settings.",
    privacyPolicy: "Privacy Policy",
    agree: "I agree to Centre for Digital Habits'",
    eula: "End User License Agreement",
    continue: "Continue",
    org: "Centre for Digital Habits",
    orgUrl: "https://digitalhabits.org",
    footer:
      "is a not-for-profit creating digital focus tools in collaboration with researchers at the universities of Oxford, Copenhagen and Maastricht.",
    source: "View the source code on GitHub",
  },
  da: {
    title: "Velkommen til Digital Habits: To-Do",
    subtitle:
      "Hold fokus med svævende opgavepåmindelser, enkle opgavelister og nem tidsregistrering.",
    privacyTitle: "Privatliv som udgangspunkt",
    privacyLead: "Vi indsamler ingen persondata. Vi tæller kun, hvor mange der bruger To-Do.",
    howWeCount: "Sådan tæller vi",
    howWeCountBody:
      "Højst én gang om dagen, på en dag hvor du bruger To-Do, sender appen én anonym optælling med et ID, der skifter hver måned. Du kan slå det fra under Indstillinger.",
    privacyPolicy: "Privatlivspolitik",
    agree: "Jeg accepterer Center for Digitale Vaners",
    eula: "brugerbetingelser",
    continue: "Fortsæt",
    org: "Center for Digitale Vaner",
    orgUrl: "https://digitalevaner.dk",
    footer:
      "er en non-profit, der bygger digitale fokusværktøjer i samarbejde med forskere ved universiteterne i Oxford, København og Maastricht.",
    source: "Se kildekoden på GitHub",
  },
};

function isFocusWindow(): boolean {
  return new URLSearchParams(window.location.search).get("focus") === "1";
}

/** The board's language and light/dark choice, read the way TodoPage reads them. */
function readPrefs(): { lang: TodoLang; dark: boolean } {
  let lang: TodoLang = "en";
  let theme: string | null = null;
  try {
    if (localStorage.getItem(LANG_KEY) === "da") lang = "da";
    theme = localStorage.getItem(THEME_KEY);
  } catch {
    /* private mode */
  }
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return { lang, dark: theme === "dark" || (theme !== "light" && systemDark) };
}

export function WelcomeScreen({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const [open, setOpen] = React.useState(() => !isFocusWindow() && (alwaysShow || !eulaAccepted()));
  const [agreed, setAgreed] = React.useState(false);
  const [prefs, setPrefs] = React.useState(readPrefs);

  React.useEffect(() => {
    if (!open) return;
    // Again after TodoPage's first effects, which may copy over a version 2 language.
    setPrefs(readPrefs());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefs(readPrefs());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    // Lifts the board's footer above the screen (welcome-screen.css).
    document.documentElement.classList.add("todo-welcome-open");
    return () => document.documentElement.classList.remove("todo-welcome-open");
  }, [open]);

  if (!open) return null;
  const t = COPY[prefs.lang];

  return (
    // The wrapper only lends .todo-shell's tokens and theme; it draws no box.
    <div className="todo-shell todo-welcome" data-theme={prefs.dark ? "dark" : undefined}>
      <div
        id="eula-onboarding"
        className="onboarding-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="eula-welcome-title"
      >
        <div className="eula-title-bar" data-tauri-drag-region="" />
        <div className="eula-onboarding-scroll">
          <div className="eula-onboarding-inner">
            <header className="welcome-onboarding-header">
              <img className="welcome-app-logo" src={logoUrl} alt="" aria-hidden="true" />
              <div className="welcome-onboarding-title-text">
                <h1 id="eula-welcome-title">{t.title}</h1>
                <p className="welcome-onboarding-subtitle">{t.subtitle}</p>
              </div>
            </header>

            <div className="onboarding-focus-card legal-onboarding-card welcome-onboarding-card">
              <h2 className="eula-privacy-title">{t.privacyTitle}</h2>
              <p className="eula-privacy-lead">{t.privacyLead}</p>
              <details className="eula-how-we-count">
                <summary>{t.howWeCount}</summary>
                <p>
                  {t.howWeCountBody}{" "}
                  <a
                    href={PRIVACY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="legal-onboarding-link"
                  >
                    {t.privacyPolicy}
                  </a>
                </p>
              </details>
              <hr className="eula-privacy-divider" />
              <label className="legal-onboarding-checkbox-row">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className="legal-onboarding-checkbox-text">
                  {t.agree}{" "}
                  <a
                    href={EULA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="legal-onboarding-link"
                  >
                    {t.eula}
                  </a>
                </span>
              </label>
              <button
                type="button"
                className="modal-btn primary-btn onboarding-primary-btn"
                disabled={!agreed}
                onClick={() => {
                  acceptEula();
                  setOpen(false);
                }}
              >
                {t.continue}
              </button>
            </div>

            <footer className="welcome-onboarding-footer">
              <p className="welcome-footer-line">
                <a
                  href={t.orgUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="legal-onboarding-link"
                >
                  {t.org}
                </a>{" "}
                {t.footer}{" "}
                <a
                  href={SOURCE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="legal-onboarding-link"
                >
                  {t.source}
                </a>
                .
              </p>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
