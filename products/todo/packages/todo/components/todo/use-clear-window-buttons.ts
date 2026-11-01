"use client";

import * as React from "react";

import { isNativeShell } from "@/lib/todo/native-bridge";

/*
 * Keep a bar at the top of the page clear of the Mac window's buttons.
 *
 * In the desktop apps the red, yellow and green buttons float over the
 * page's top left corner. Whether a bar is under them depends on where the
 * To-Do is drawn: the To-Do app keeps a strip for them, the Planner's tab
 * has its own bars above the To-Do, but a popped-out window (a frame that
 * fills the window) has nothing. So the bar measures where it is in the
 * window, through any frames, and only when it is in the buttons' corner
 * moves its contents right past them.
 */

/** The window's buttons, in window points from the top left. */
const BUTTONS_RIGHT = 80;
const BUTTONS_BOTTOM = 30;

function isMacWindow(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /^Mac/i.test(navigator.platform) &&
    isNativeShell()
  );
}

/** Where `el` starts in the top window, through same-site frames. */
function placeInWindow(el: HTMLElement): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  let x = rect.left;
  let y = rect.top;
  let view: Window | null = el.ownerDocument.defaultView;
  try {
    while (view && view.frameElement) {
      const frame = view.frameElement.getBoundingClientRect();
      x += frame.left;
      y += frame.top;
      view = view.parent;
    }
  } catch {
    /* a frame of another site: as far as it can be read */
  }
  return { x, y };
}

/**
 * Give `ref`'s bar left padding past the window's buttons when it sits under
 * them; `basePadding` is its own left padding (CSS pixels) otherwise.
 */
export function useClearWindowButtons(
  ref: React.RefObject<HTMLElement | null>,
  basePadding: number
): void {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !isMacWindow()) return;
    const place = () => {
      el.style.paddingLeft = "";
      // A bar not shown (the wide dialog has none) has no box to place.
      if (!el.offsetWidth) return;
      const { x, y } = placeInWindow(el);
      if (y >= BUTTONS_BOTTOM || x >= BUTTONS_RIGHT) return;
      // The page can be zoomed: the box on screen against its own size.
      const zoom = el.getBoundingClientRect().width / el.offsetWidth || 1;
      const needed = (BUTTONS_RIGHT - x) / zoom;
      el.style.paddingLeft = `${Math.max(basePadding, Math.ceil(needed))}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      el.style.paddingLeft = "";
    };
  }, [ref, basePadding]);
}
