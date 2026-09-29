/**
 * The left and right edges a menu may stand between.
 *
 * Menus are portaled to the page body and held inside the window. The
 * window is not always the board's: the planner can tile the board beside
 * a mail pane, which is a separate view laid over its half of the window.
 * A menu held only inside the window then opened under the mail, cut off
 * at the board's edge.
 *
 * So the edges are the board's own box — the `.todo-shell` the anchor is
 * in — where it is narrower than the window. On its own the board fills
 * the window, and nothing changes.
 */
export function menuArea(anchor: Element | null): { left: number; right: number } {
  const win = { left: 0, right: window.innerWidth };
  const shell = anchor?.closest?.(".todo-shell");
  if (!shell) return win;
  const box = shell.getBoundingClientRect();
  if (box.width <= 0) return win;
  return {
    left: Math.max(win.left, box.left),
    right: Math.min(win.right, box.right),
  };
}

/** `left`, moved so a box `width` wide stays `pad` inside the area. */
export function clampToMenuArea(
  left: number,
  width: number,
  area: { left: number; right: number },
  pad: number
): number {
  return Math.max(area.left + pad, Math.min(left, area.right - width - pad));
}
