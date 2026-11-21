import * as React from "react";

import { setStoreReviewLink } from "@/lib/todo/store-review-link";

import { EULA_ACCEPTED_EVENT, eulaAccepted } from "./eula";
import { countStart, stopAsking } from "./store-review-rule";

type Lang = "en" | "da";

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

/**
 * The app's page in the store's own app.
 *
 * On a Mac this is the `macappstore:` address and not the `https:` one. A
 * browser other than Safari shows the `https:` address as a web page of
 * the app, where nobody can write a review. It is the plain page of the
 * app: with `?action=write-review` the App Store app says "Cannot
 * Connect" (seen on macOS 26). The page has the stars and "Write a Review".
 */
function urlFor(channel: Store): string {
  return channel === "mac"
    ? "macappstore://apps.apple.com/app/id6760351681"
    : "ms-windows-store://review/?ProductId=9P48NJXCBBGH";
}

export type Store = "mac" | "windows";

type Shell = {
  opener?: { openUrl?: (href: string) => Promise<void> };
  core?: { invoke?: (command: string) => Promise<unknown> };
};

function shell(): Shell | undefined {
  return (window as unknown as { __TAURI__?: Shell }).__TAURI__;
}

function openStorePage(channel: Store) {
  const url = urlFor(channel);
  const openUrl = shell()?.opener?.openUrl;
  if (openUrl) void openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The Mac's own rating sheet: five stars over the window, with no trip
 * to the store. macOS decides if it shows, and the shell says if it did
 * (review.rs). When it did not, the store page opens: the click always
 * does something.
 */
function askForRating() {
  const toStore = () => openStorePage("mac");
  const invoke = shell()?.core?.invoke;
  if (!invoke) return toStore();
  invoke("request_store_review").then((shown) => {
    if (shown !== true) toStore();
  }, toStore);
}

/** What the "Write a review" link in Settings does. */
export function reviewLinkFor(channel: Store): () => void {
  return () => {
    // The person goes to review: the banner has no more to ask.
    optOut();
    openStorePage(channel);
  };
}

/** Settings gets its "Write a review" link. Call once, when the app starts. */
export function installStoreReviewLink() {
  const channel = store();
  setStoreReviewLink(channel ? reviewLinkFor(channel) : null);
}

function lang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "da" ? "da" : "en";
  } catch {
    return "en";
  }
}

/** One start per main-window session, after welcome. True when the banner is due. */
function recordVisit(): boolean {
  if (counted || !eulaAccepted() || !store()) return false;
  counted = true;
  return countStart(localStorage);
}

function optOut() {
  stopAsking(localStorage);
}

/**
 * The banner, on every 10th start, until the person answers it.
 *
 * A person who left a review is never asked again. The app cannot know
 * that a review was left (neither store says so), so it goes by what the
 * person does here: "Leave a review", "I already did", and the "Write a
 * review" link in Settings each end the asking for good. The X only
 * closes the banner until the next 10th start.
 *
 * So the app never asks macOS for its sheet by itself: only the person's
 * click on "Leave a review" does, once. The same as the Focus extension.
 */
export function StoreReviewPrompt() {
  const channel = store();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!channel) return;
    const tick = () => { if (recordVisit()) setVisible(true); };
    tick();
    window.addEventListener(EULA_ACCEPTED_EVENT, tick);
    // To see the banner without ten starts: in a dev app, call
    // `previewStoreReviewPrompt()` in the console; or build with
    // VITE_TODO_PREVIEW_REVIEW=1, which shows it soon after each start. No
    // store build sets that. The Mac's sheet, which the banner's link
    // asks for, shows only in an app bundle, not in a dev app (review.rs).
    const preview = () => setVisible(true);
    if (import.meta.env.DEV) {
      (window as Window & { previewStoreReviewPrompt?: () => void }).previewStoreReviewPrompt = preview;
    }
    let previewTimer = 0;
    if (import.meta.env.VITE_TODO_PREVIEW_REVIEW === "1") previewTimer = window.setTimeout(preview, 2500);
    return () => {
      window.clearTimeout(previewTimer);
      window.removeEventListener(EULA_ACCEPTED_EVENT, tick);
    };
  }, [channel]);

  if (!visible || !channel) return null;
  return <ReviewBanner channel={channel} onClose={() => setVisible(false)} />;
}

/** The banner itself, and what each of its three controls does. */
export function ReviewBanner({ channel, onClose }: { channel: Store; onClose: () => void }) {
  const t = COPY[lang()];
  const done = () => { optOut(); onClose(); };
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
            <button type="button" className="store-review-prompt-dismiss" aria-label={t.dismiss} onClick={onClose}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <p className="store-review-prompt-body">{t.body}</p>
          <div className="store-review-prompt-actions">
            <a href={urlFor(channel)} className="store-review-leave-link" onClick={(event) => {
              event.preventDefault();
              done();
              // A Mac: the system's sheet, five stars with no trip to the
              // store, or the store page when no sheet comes. Windows: the
              // Store's own review box.
              if (channel === "mac") askForRating();
              else openStorePage(channel);
            }}>{t.leave}</a>
            <button type="button" className="store-review-no-thanks" onClick={done}>{t.already}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
