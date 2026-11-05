"use client";

import * as React from "react";

import { windowWidthFor } from "@/components/todo/board-window-fit";
import {
  readWindowBounds,
  setWindowBounds,
  tauriInvoke,
  type WindowBounds,
} from "@/lib/todo/native-bridge";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";

/** The session column, slim, as Blitzit's. Under 480px the session's
    narrow-pane rules apply (`@container session`), which suit it. In a
    fitted window the card fills it (`.today-session.is-window-fit`). */
const SESSION_COLUMN_WIDTH = 290;

/** Marks the session once the window has been fitted to it. The layout
    then follows the window's width (todo-shell.css), so full screen and
    back need no script. */
const FIT_CLASS = "is-window-fit";

/** Holds the column's final layout while the window glides in on it. */
const GLIDE_CLASS = "is-window-gliding";


type PhysicalRect = {
  position: { x: number; y: number };
  size: { width: number; height: number };
};

/** The part of the window's screen that is free of the menu bar and the Dock, in points. */
async function readWorkArea(): Promise<WindowBounds | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  const monitor = (await invoke("plugin:window|current_monitor")) as
    | (PhysicalRect & { scaleFactor: number; workArea?: PhysicalRect })
    | null;
  if (!monitor) return null;
  const area = monitor.workArea ?? monitor;
  const s = monitor.scaleFactor || 1;
  return {
    x: area.position.x / s,
    y: area.position.y / s,
    width: area.size.width / s,
    height: area.size.height / s,
  };
}

/**
 * The colour an element shows as 0–1 sRGB, for the window to wear while
 * it glides: its own background, or the first one behind it that is not
 * see-through.
 */
function backgroundOf(el: HTMLElement | null): [number, number, number] | null {
  for (let node = el; node; node = node.parentElement) {
    const m = getComputedStyle(node).backgroundColor.match(
      /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/
    );
    if (!m || (m[4] !== undefined && Number(m[4]) < 1)) continue;
    return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  }
  return null;
}

async function isFullScreen(): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  return Boolean(await invoke("plugin:window|is_fullscreen").catch(() => false));
}

/** Two frames: the next one drawn, not only planned. */
function afterPaint(): Promise<void> {
  return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
}

/**
 * Move and size the window, gliding there where the app can
 * (animate_window_frame, the Planner on the Mac). An older app without
 * that command moves at once.
 *
 * The page is not drawn again until the glide ends, so what the window
 * uncovers on the way shows the window's own background: `background`
 * makes that the page's colour for the glide.
 */
async function glideWindow(
  bounds: WindowBounds,
  background: [number, number, number] | null
): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  // A full-screen window keeps its screen, also on the way out of a session
  // that went full screen while it ran: a new frame there shrinks the page
  // inside the screen and leaves black around it.
  if (await isFullScreen()) return;
  try {
    await invoke("animate_window_frame", { ...bounds, background });
  } catch {
    await setWindowBounds(bounds, true);
  }
}

/** A pause after the last resize, so full screen has settled. */
const FULL_SCREEN_SETTLE_MS = 250;

/**
 * The Today session in the Planner's desktop app, as Blitzit does it: the
 * window shrinks to the session's one column and stands at the left of the
 * screen, full height, so the work it is about has the rest. On the way
 * out the window goes back to where it was, at the size it was.
 *
 * A full-screen window keeps its screen, and the card stands in the
 * middle. When the window leaves full screen into its full size, it glides
 * to the left then. Back into a slim window, the column fills it at once.
 *
 * Not in a browser, which has no window to move, and not in the To-Do
 * app, whose window is already the size of one list.
 */
export function useSessionWindowFit(sessionRef: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    if (isStandaloneTodo() || !tauriInvoke()) return;
    const session = sessionRef.current;
    if (!session) return;
    /** Where the window was before the session fitted it. */
    let before: WindowBounds | null = null;
    let fitted = false;
    let busy = false;
    let left = false;
    let wasFullScreen = false;

    const fit = async () => {
      if (fitted || busy || left) return;
      busy = true;
      try {
        if (await isFullScreen()) {
          wasFullScreen = true;
          return;
        }
        wasFullScreen = false;
        const [bounds, area] = await Promise.all([readWindowBounds(), readWorkArea()]);
        if (!bounds || !area || left) return;
        const width = Math.min(
          area.width,
          windowWidthFor(
            bounds.width,
            session.offsetWidth,
            session.getBoundingClientRect().width,
            SESSION_COLUMN_WIDTH
          )
        );
        // Already narrow, or back from full screen into the slim window.
        if (width >= bounds.width) {
          fitted = Boolean(before);
          return;
        }
        before = bounds;
        fitted = true;
        /*
          The column goes to the left at its final width first, and the
          window glides after: the page keeps its layout during the glide,
          so the window closes in on the column instead of cutting it.
        */
        session.style.setProperty("--session-fit-width", `${SESSION_COLUMN_WIDTH}px`);
        session.classList.add(FIT_CLASS, GLIDE_CLASS);
        await afterPaint();
        if (left) return;
        try {
          await glideWindow(
            // Flush with the screen's left edge, full height, as Blitzit's.
            { x: area.x, y: area.y, width, height: area.height },
            backgroundOf(session)
          );
        } finally {
          session.classList.remove(GLIDE_CLASS);
        }
        // Left while the window was moving: put it back once more, after.
        if (left) await glideWindow(bounds, null);
      } finally {
        busy = false;
      }
    };

    /*
      Full screen comes and goes with a resize. Out of it, once settled,
      the window is fitted again if it came back at its full size.
    */
    let settle: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (busy) return;
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => {
        void (async () => {
          if (left || busy) return;
          if (await isFullScreen()) {
            wasFullScreen = true;
          } else if (wasFullScreen) {
            fitted = false;
            await fit();
          }
        })().catch(() => {});
      }, FULL_SCREEN_SETTLE_MS);
    };

    void fit().catch(() => {});
    window.addEventListener("resize", onResize);

    return () => {
      left = true;
      window.removeEventListener("resize", onResize);
      if (settle) clearTimeout(settle);
      // The board comes back under the session: its colour, for the glide back.
      const board = session.parentElement ?? null;
      session.classList.remove(FIT_CLASS, GLIDE_CLASS);
      if (before) void glideWindow(before, backgroundOf(board)).catch(() => {});
    };
  }, [sessionRef]);
}
