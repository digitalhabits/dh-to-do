"use client";

import * as React from "react";
import { toast } from "sonner";

import { isStandaloneTodo } from "@/lib/todo/product-flavor";
import { ZOOM_KEY, persistPref } from "@/lib/todo/saved-prefs";

/**
 * The zoom keys of the desktop app. `setZoom` is the page's setter: a
 * React setter never changes, so the listener is bound once.
 */
export function useZoomKeys(
  zoom: number,
  setZoom: React.Dispatch<React.SetStateAction<number>>
) {
  /** The zoom as the key handler below reads it: the newest, with no wait for a paint. */
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;

  // Cmd/Ctrl + and − zoom, and Cmd/Ctrl 0 goes back to 100%, as in a
  // browser. The same steps and limits as the buttons in Settings. The
  // desktop app only: in the planner these keys stay the browser's own.
  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      // By the character, not the key's place, so it works on any layout:
      // on a Danish keyboard + has a key of its own.
      let step: number | "reset" | null = null;
      if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") step = 10;
      else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") step = -10;
      else if (e.key === "0" || e.code === "Numpad0") step = "reset";
      if (step === null) return;
      e.preventDefault();
      const current = zoomRef.current;
      const next =
        step === "reset" ? 100 : Math.min(170, Math.max(50, current + step));
      if (next !== current) {
        zoomRef.current = next;
        setZoom(next);
        persistPref(ZOOM_KEY, String(next));
      }
      // Says the zoom in the top right corner, as a browser does. One toast
      // that changes its number, and it shows at a limit too, so a press
      // that can go no further still gets an answer.
      toast(`${next}%`, {
        id: "todo-zoom",
        position: "top-right",
        duration: 1400,
        closeButton: false,
        className: "todo-zoom-toast",
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setZoom]);
}
