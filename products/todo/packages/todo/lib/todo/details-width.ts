/**
 * How wide task details are when they stand beside the list.
 *
 * The reader can drag the line between the two (DetailsResizer). The width
 * they pick is kept per device. It is held between a smallest details panel
 * and a smallest list, so neither can be dragged away.
 */

/** Where the picked width is kept: a device setting, like the view. Board
    View and the list keep a width each, as their natural widths differ. */
export const DETAILS_WIDTH_KEY = "redd-plan-todo-details-width";
export const DETAILS_WIDTH_LIST_KEY = "redd-plan-todo-details-width-list";

/** Which layout details stand beside: Board View's columns, or a list. */
export type DetailsBeside = "board" | "list";

const keyFor = (beside: DetailsBeside) => (beside === "board" ? DETAILS_WIDTH_KEY : DETAILS_WIDTH_LIST_KEY);

/** The narrowest details panel. */
export const DETAILS_MIN = 340;

/** The narrowest list beside details. */
export const LIST_MIN = 420;

/** One arrow key press moves the line this far. */
export const DETAILS_STEP = 24;

/** The width before the reader picks one. Beside Board View: 44% of the
    app, at most 520px, so the columns keep their room. Beside a list: half,
    as a list is one column and does not need more. */
export function defaultDetailsWidth(shellWidth: number, beside: DetailsBeside = "board"): number {
  return beside === "list" ? shellWidth / 2 : Math.min(520, shellWidth * 0.44);
}

/** A width held between the smallest details panel and the smallest list. */
export function clampDetailsWidth(width: number, shellWidth: number): number {
  const max = Math.max(DETAILS_MIN, shellWidth - LIST_MIN);
  return Math.round(Math.min(max, Math.max(DETAILS_MIN, width)));
}

/** The width details take: the picked one, or the default, held in bounds. */
export function detailsWidthFor(shellWidth: number, picked: number | null, beside: DetailsBeside = "board"): number {
  return clampDetailsWidth(picked ?? defaultDetailsWidth(shellWidth, beside), shellWidth);
}

/** The picked width, or null when there is none or storage cannot be read. */
export function readStoredDetailsWidth(beside: DetailsBeside = "board"): number | null {
  try {
    const raw = localStorage.getItem(keyFor(beside));
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Keep the picked width, or forget it (null). Storage that fails is let be. */
export function storeDetailsWidth(width: number | null, beside: DetailsBeside = "board"): void {
  try {
    if (width == null) localStorage.removeItem(keyFor(beside));
    else localStorage.setItem(keyFor(beside), String(Math.round(width)));
  } catch {
    /* a private window, or storage turned off: the width lasts this visit */
  }
}
