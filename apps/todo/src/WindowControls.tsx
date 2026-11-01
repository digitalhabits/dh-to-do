/**
 * The window buttons on Windows.
 *
 * On a Mac the window buttons float over the page at the top left. On
 * Windows the system title bar was a second bar above the app, with only
 * the app's name in it. So on Windows the window has no system title bar
 * (see src-tauri/tauri.windows.conf.json). As on a Mac, the buttons share
 * the app's top row: they are drawn here, at the top right, where Windows
 * keeps them. The app's own bars move the window. The buttons are as in
 * the Mail app (apps/mail/src/WindowControls.tsx).
 *
 * Nothing renders on any other system. `main.tsx` puts `platform-windows`
 * on <html>; standalone.css draws the buttons and keeps the bars under
 * them clear.
 */

import * as React from "react";

type TauriWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: () => void) => Promise<() => void>;
};

function currentWindow(): TauriWindow | null {
  const w = window as unknown as {
    __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } };
  };
  return w.__TAURI__?.window?.getCurrentWindow?.() ?? null;
}

function isWindowsShell(): boolean {
  return document.documentElement.classList.contains("platform-windows");
}

export function WindowControls() {
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    const win = currentWindow();
    if (!win || !isWindowsShell()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const read = () => {
      void win.isMaximized().then((v) => {
        if (!cancelled) setMaximized(v);
      });
    };
    read();
    void win.onResized(read).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!isWindowsShell() || !currentWindow()) return null;

  return (
    <div className="dh-window-controls">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void currentWindow()?.minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void currentWindow()?.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M2.5 0.5h7v7M0.5 2.5h7v7h-7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="is-close"
        aria-label="Close"
        title="Close"
        onClick={() => void currentWindow()?.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  );
}
