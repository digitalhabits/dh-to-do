"use client";

import * as React from "react";
import { fitMainWindowWidth } from "@/lib/native-shell";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";

/** The desktop window's width for one list, and for the board (points). */
const LIST_WINDOW_WIDTH = 680;
const BOARD_WINDOW_WIDTH = 1100;

/**
 * The desktop window fits the view. One list is at most 600 points wide
 * (--content-max-width), so the window opens list-sized (tauri.conf.json)
 * and grows for the board. When the reader switches the board off, the
 * window narrows again; a window the reader made smaller stays as it is.
 */
export function useWindowFitsView(boardOn: boolean) {
  const sizedForRef = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (!isStandaloneTodo()) return;
    const first = sizedForRef.current === null;
    if (sizedForRef.current === boardOn) return;
    sizedForRef.current = boardOn;
    const fit = boardOn
      ? fitMainWindowWidth(BOARD_WINDOW_WIDTH, { grow: true, shrink: false })
      : first
        ? Promise.resolve()
        : fitMainWindowWidth(LIST_WINDOW_WIDTH, { grow: false, shrink: true });
    fit.catch(() => {});
  }, [boardOn]);
}
