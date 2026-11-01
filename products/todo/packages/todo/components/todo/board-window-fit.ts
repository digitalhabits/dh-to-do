"use client";

import * as React from "react";

import { BOARD_STACK_MAX } from "@/components/todo/use-board-layout";
import { readWindowBounds, setWindowBounds } from "@/lib/todo/native-bridge";
import { isStandaloneTodo } from "@/lib/todo/product-flavor";

/**
 * A little past the width where the columns stand side by side, so the
 * board does not fall back to one column on a rounding.
 */
export const BOARD_FIT_WIDTH = BOARD_STACK_MAX + 20;

/**
 * The window width, in points, that gives the shell `shellTarget` of its
 * own pixels. The shell carries the reader's zoom, so its pixels and the
 * window's are not the same size.
 */
export function windowWidthFor(
  windowWidth: number,
  shellWidth: number,
  shellScreenWidth: number,
  shellTarget: number
): number {
  const zoom = shellWidth > 0 ? shellScreenWidth / shellWidth || 1 : 1;
  return Math.ceil(windowWidth + (shellTarget - shellWidth) * zoom);
}

/**
 * Board View turned on in Settings: the window grows once Settings is
 * closed, not while it is open. A window that changed size under the
 * switch was confusing. Turned on and off again before closing, nothing
 * happens.
 */
export function useWidenForBoardAfterSettings({
  settingsOpen,
  kanbanEnabled,
  shellRef,
}: {
  settingsOpen: boolean;
  kanbanEnabled: boolean;
  shellRef: React.RefObject<HTMLElement | null>;
}) {
  /** Board View as it was when Settings opened; null while it is closed. */
  const atOpen = React.useRef<boolean | null>(null);
  React.useEffect(() => {
    if (settingsOpen) {
      if (atOpen.current === null) atOpen.current = kanbanEnabled;
      return;
    }
    const wasOn = atOpen.current;
    atOpen.current = null;
    if (wasOn === false && kanbanEnabled) void widenWindowForBoard(shellRef.current).catch(() => {});
  }, [settingsOpen, kanbanEnabled, shellRef]);
}

/**
 * Board View turned on in the To-Do app: a window too narrow for the
 * columns grows until they stand side by side. A wider window stays as
 * it is. The planner's window holds more than this page, so it is left
 * alone, and so is a browser, which has no window to size.
 */
export async function widenWindowForBoard(shell: HTMLElement | null): Promise<void> {
  if (!shell || !isStandaloneTodo()) return;
  const shellWidth = shell.offsetWidth;
  if (shellWidth > BOARD_STACK_MAX) return;
  const bounds = await readWindowBounds();
  if (!bounds) return;
  const width = windowWidthFor(bounds.width, shellWidth, shell.getBoundingClientRect().width, BOARD_FIT_WIDTH);
  if (width <= bounds.width) return;
  // Grown to the right, the window could pass the screen's edge: then it
  // moves left by as much, but not past the screen's left edge.
  const screenRight = window.screen.availWidth;
  const overflow = bounds.x + width - screenRight;
  const x = overflow > 0 ? Math.max(0, bounds.x - overflow) : bounds.x;
  await setWindowBounds({ ...bounds, x, width }, x !== bounds.x);
}
