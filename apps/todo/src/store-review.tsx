import * as React from "react";

import { EULA_ACCEPTED_EVENT, eulaAccepted } from "./eula";

type Store = "mac" | "windows";
type Lang = "en" | "da";

const OPENS_KEY = "todoStoreReviewOpensCount";
const NO_THANKS_KEY = "todoStoreReviewNoThanks";
const LANG_KEY = "redd-plan-todo-lang";
const STAR = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
const COPY: Record<Lang, { body: string; leave: string; already: string; dismiss: string }> = {
  en: {
    body: "Enjoying To-Do? A review helps others find it.",
    leave: "Leave a review",
    already: "I already did",
    dismiss: "Dismiss review prompt",
  },
  da: {
    body: "Kan du lide To-Do? En anmeldelse hjælper andre med at finde appen.",
    leave: "Skriv en anmeldelse",
    already: "Det har jeg allerede",
    dismiss: "Luk anmeldelsesprompt",
  },
};

let counted = false;

function store(): Store | null {
  const built = import.meta.env.VITE_TODO_STORE;
  if (built === "mac" || built === "windows") return built;
  if (!import.meta.env.DEV) return null;
  if (/^Win/.test(navigator.platform)) return "windows";
  if (/Mac/.test(navigator.platform) && !/iPhone|iPad|iPod/.test(navigator.userAgent)) return "mac";
  return null;
}

function urlFor(channel: Store): string {
  return channel === "mac"
    ? "https://apps.apple.com/app/id6760351681?action=write-review&mt=12"
    : "ms-windows-store://review/?ProductId=9P48NJXCBBGH";
}

function lang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "da" ? "da" : "en";
  } catch {
    return "en";
  }
}

/** One visit per main-window session, after welcome. Shows on the 10th. */
function recordVisit(): boolean {
  if (counted || !eulaAccepted() || !store()) return false;
  counted = true;
  let n = 0;
  try {
    n = parseInt(localStorage.getItem(OPENS_KEY) || "", 10);
  } catch { /* ignore */ }
  n = Number.isFinite(n) && n > 0 ? n + 1 : 1;
  try {
    localStorage.setItem(OPENS_KEY, String(n));
  } catch { /* ignore */ }
  try {
    return n % 10 === 0 && localStorage.getItem(NO_THANKS_KEY) !== "true";
  } catch {
    return false;
  }
}

function optOut() {
  try {
    localStorage.setItem(NO_THANKS_KEY, "true");
  } catch { /* ignore */ }
}

export function StoreReviewPrompt() {
  const channel = store();
  const [visible, setVisible] = React.useState(false);
  const t = COPY[lang()];

  React.useEffect(() => {
    if (!channel) return;
    const tick = () => { if (recordVisit()) setVisible(true); };
    tick();
    window.addEventListener(EULA_ACCEPTED_EVENT, tick);
    if (import.meta.env.DEV) {
      (window as Window & { previewStoreReviewPrompt?: () => void }).previewStoreReviewPrompt = () => setVisible(true);
    }
    return () => window.removeEventListener(EULA_ACCEPTED_EVENT, tick);
  }, [channel]);

  if (!visible || !channel) return null;
  const url = urlFor(channel);
  const done = () => { optOut(); setVisible(false); };
  const theme = document.querySelector(".todo-shell:not(.todo-portal-root)")?.getAttribute("data-theme") || undefined;

  return (
    <div className="todo-shell todo-portal-root" data-theme={theme}>
      <div className="store-review-prompt" role="region" aria-label={t.dismiss}>
        <div className="store-review-prompt-content">
          <div className="store-review-prompt-top">
            <div className="store-review-prompt-stars" aria-hidden="true">
              {Array.from({ length: 5 }, (_, i) => (
                <svg key={i} viewBox="0 0 24 24" width="16" height="16"><path d={STAR} /></svg>
              ))}
            </div>
            <button type="button" className="store-review-prompt-dismiss" aria-label={t.dismiss} onClick={() => setVisible(false)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <p className="store-review-prompt-body">{t.body}</p>
          <div className="store-review-prompt-actions">
            <a href={url} className="store-review-leave-link" onClick={(event) => {
              event.preventDefault();
              done();
              const openUrl = (window as unknown as { __TAURI__?: { opener?: { openUrl?: (href: string) => Promise<void> } } }).__TAURI__?.opener?.openUrl;
              if (openUrl) void openUrl(url);
              else window.open(url, "_blank", "noopener,noreferrer");
            }}>{t.leave}</a>
            <button type="button" className="store-review-no-thanks" onClick={done}>{t.already}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
