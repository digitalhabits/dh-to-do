"use client";

import * as React from "react";

import { windowWidthFor } from "@/components/todo/board-window-fit";
import {
  readWindowBounds,
  setWindowBounds,
  tauriInvoke,
  type WindowBounds,
} from "@/lib/todo/native-bridge";
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

/** The column stands at the screen's right edge, not its left. */
const RIGHT_CLASS = "is-window-right";

/**
 * Which edge of the screen the slim window goes to: a choice in Settings.
 * Missing key = left, as it was before the choice.
 */
export const SESSION_SIDE_KEY = "redd-plan-todo-session-side";

export type SessionSide = "left" | "right";

export function readSessionSide(): SessionSide {
  try {
    return localStorage.getItem(SESSION_SIDE_KEY) === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

export function writeSessionSide(side: SessionSide) {
  try {
    if (side === "right") localStorage.setItem(SESSION_SIDE_KEY, "right");
    else localStorage.removeItem(SESSION_SIDE_KEY);
  } catch {
    // No storage: the session goes left.
  }
}

/** Whether the side choice does anything here: a desktop app. */
export function sessionSideApplies(): boolean {
  return Boolean(tauriInvoke());
}


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

async function isMaximized(): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  return Boolean(await invoke("plugin:window|is_maximized").catch(() => false));
}

async function setMaximized(on: boolean): Promise<void> {
  await tauriInvoke()?.(on ? "plugin:window|maximize" : "plugin:window|unmaximize");
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
 * The Today session in a desktop app, as Blitzit does it: the
 * window shrinks to the session's one column and stands at the left (or,
 * by the choice in Settings, the right) of the screen, full height, so the work it is about has the rest. On the way
 * out the window goes back to where it was, at the size it was.
 *
 * A full-screen window keeps its screen, and the card stands in the
 * middle. When the window leaves full screen into its full size, it glides
 * to the left then. Back into a slim window, the column fills it at once.
 *
 * Not in a browser, which has no window to move.
 */
export function useSessionWindowFit(
  sessionRef: React.RefObject<HTMLElement | null>,
  /** The slim window's width; the Planner's CRM boards pass their column's. */
  columnWidth: number = SESSION_COLUMN_WIDTH
): {
  /** The window was fitted, so it can grow to fill the screen and back. */
  canExpand: boolean;
  /** The window fills the screen now. */
  expanded: boolean;
  toggleExpanded: () => void;
} {
  const [canExpand, setCanExpand] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  /** Set by the effect: grows the window to the screen, or back to the column. */
  const toggleRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    if (!tauriInvoke()) return;
    const session = sessionRef.current;
    if (!session) return;
    /** Where the window was before the session fitted it. */
    let before: WindowBounds | null = null;
    let fitted = false;
    let busy = false;
    let left = false;
    let wasFullScreen = false;
    /** The window fills the screen's free area, by the expand button. */
    let grown = false;
    /** The window is maximised, by either button. */
    let maximized = false;
    /** It was maximised before the session, and goes back so. */
    let beforeMaximized = false;
    /** The slim window's width, as fitted. */
    let fitWidth = columnWidth;
    const side = readSessionSide();
    session.classList.toggle(RIGHT_CLASS, side === "right");

    /** The slim column's frame: flush with the chosen edge, full height. */
    const columnFrame = (area: WindowBounds, width: number): WindowBounds => ({
      x: side === "right" ? area.x + area.width - width : area.x,
      y: area.y,
      width,
      height: area.height,
    });

    const fit = async () => {
      if (fitted || busy || left) return;
      busy = true;
      try {
        if (await isFullScreen()) {
          wasFullScreen = true;
          return;
        }
        wasFullScreen = false;
        // A maximised window's frame is not one to come back to: restore it
        // first, and keep that frame.
        const wasMaximized = await isMaximized();
        if (wasMaximized) {
          await setMaximized(false);
          await afterPaint();
        }
        maximized = false;
        const [bounds, area] = await Promise.all([readWindowBounds(), readWorkArea()]);
        if (!bounds || !area || left) return;
        const width = Math.min(
          area.width,
          windowWidthFor(
            bounds.width,
            session.offsetWidth,
            session.getBoundingClientRect().width,
            columnWidth
          )
        );
        // Already narrow, or back from full screen into the slim window.
        if (width >= bounds.width) {
          fitted = Boolean(before);
          setCanExpand(fitted);
          return;
        }
        // Keep the first frame: back from full screen, the window may be
        // the grown one, and the way out goes to where it was before that.
        if (!before) beforeMaximized = wasMaximized;
        before = before ?? bounds;
        fitted = true;
        fitWidth = width;
        grown = false;
        setCanExpand(true);
        setExpanded(false);
        /*
          The column goes to its side at its final width first, and the
          window glides after: the page keeps its layout during the glide,
          so the window closes in on the column instead of cutting it.
        */
        session.style.setProperty("--session-fit-width", `${columnWidth}px`);
        session.classList.add(FIT_CLASS, GLIDE_CLASS);
        await afterPaint();
        if (left) return;
        try {
          await glideWindow(columnFrame(area, width), backgroundOf(session));
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
          } else if (fitted && (await isMaximized()) !== maximized) {
            // Maximised or restored by the window's own button.
            maximized = grown = !maximized;
            setExpanded(maximized);
          }
        })().catch(() => {});
      }, FULL_SCREEN_SETTLE_MS);
    };

    /*
      The button beside "esc to exit": the window grows to fill the
      screen's free area, and the card stands in the middle as in full
      screen. Again, and it glides back to the slim column.
    */
    toggleRef.current = () => {
      if (!fitted || busy || left) return;
      busy = true;
      void (async () => {
        // Full screen already fills the screen; the window keeps it.
        if (await isFullScreen()) return;
        const grow = !grown;
        // Maximised by the window's own button: restoring goes straight back
        // to the slim column, the frame it was maximised from.
        if (maximized) {
          maximized = grown = false;
          await setMaximized(false);
          setExpanded(false);
          return;
        }
        const area = await readWorkArea();
        if (!area || left) return;
        if (!grow) session.classList.add(GLIDE_CLASS);
        try {
          await glideWindow(
            grow ? area : columnFrame(area, Math.min(area.width, fitWidth)),
            backgroundOf(session)
          );
        } finally {
          session.classList.remove(GLIDE_CLASS);
        }
        grown = grow;
        setExpanded(grow);
      })()
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };

    void fit().catch(() => {});
    window.addEventListener("resize", onResize);

    return () => {
      left = true;
      window.removeEventListener("resize", onResize);
      if (settle) clearTimeout(settle);
      // The board comes back under the session: its colour, for the glide back.
      const board = session.parentElement ?? null;
      toggleRef.current = () => {};
      session.classList.remove(FIT_CLASS, GLIDE_CLASS, RIGHT_CLASS);
      setCanExpand(false);
      setExpanded(false);
      const back = before;
      if (!back) return;
      void (async () => {
        // One move, straight to where it was. Maximised then: maximise, or
        // stay put if it still is. A move also takes a maximised window out
        // of being maximised, so no restore step first.
        if (beforeMaximized) {
          if (!(await isMaximized())) await setMaximized(true);
          return;
        }
        await glideWindow(back, backgroundOf(board));
      })().catch(() => {});
    };
  }, [sessionRef, columnWidth]);

  const toggleExpanded = React.useCallback(() => toggleRef.current(), []);
  return { canExpand, expanded, toggleExpanded };
}
