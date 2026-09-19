import type * as React from "react";

/**
 * Tab and the arrows, walked by hand.
 *
 * WebKit — the web view the Mac apps run in — gives Tab to text boxes
 * alone unless Full Keyboard Access is on in System Settings. A row of
 * buttons is then unreachable, and Tab from a text box jumps to the next
 * text box on the page, wherever in the app that is: from the add row of
 * one column it landed in the add row of the next.
 *
 * So a surface with a keyboard path of its own walks its controls itself.
 * `.focus()` works whatever the setting, in every web view, and the order
 * is the order the surface reads. Left and Right walk the same stops, for
 * a row of chips where they read as one thing to step through.
 */

/** Everything that can hold the caret, before the filtering below. */
const CONTROLS = "button, input, select, textarea, trix-editor, [tabindex]";

export type WalkOptions = {
  /**
   * The caret wraps at the ends. For a menu, a card or a window of its
   * own, where the walk is a ring; an add row in a page lets go instead.
   */
  wrap?: boolean;
  /**
   * Surfaces that keep their own keys: the caret inside one is left
   * alone, and the surface counts as one stop, not as all it holds. The
   * note's editor by default — Trix and its toolbar own them.
   */
  ownsTab?: string;
};

const DEFAULT_OWNS_TAB = "trix-editor";

/** Drawn on the screen: a hidden chip or a folded section is no stop. */
function isShown(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  return window.getComputedStyle(el).visibility !== "hidden";
}

/** A box the arrows belong to: there they move the caret through words. */
function holdsCaret(el: HTMLElement): boolean {
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT" || tag === "TRIX-EDITOR") {
    return true;
  }
  if (el.isContentEditable) return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
}

/** The controls of one surface, in the order the surface reads. */
export function focusStops(
  container: HTMLElement,
  options: WalkOptions = {}
): HTMLElement[] {
  const ownsTab = options.ownsTab ?? DEFAULT_OWNS_TAB;
  const found = container.querySelectorAll<HTMLElement>(CONTROLS);
  return Array.from(found).filter((el) => {
    if (el.matches(ownsTab)) return isShown(el);
    if (el.closest(ownsTab)) return false;
    if ((el as HTMLButtonElement).disabled) return false;
    if (el.tabIndex < 0) return false;
    return isShown(el);
  });
}

/** One step through the surface's stops. True when the caret moved. */
function step(
  container: HTMLElement | null,
  by: number,
  options: WalkOptions
): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!container || !active) return false;
  if (active.closest(options.ownsTab ?? DEFAULT_OWNS_TAB)) return false;
  const stops = focusStops(container, options);
  const at = stops.indexOf(active);
  if (at === -1) return false;
  const next =
    stops[at + by] ??
    (options.wrap ? (by > 0 ? stops[0] : stops[stops.length - 1]) : null);
  if (!next || next === active) return false;
  next.focus();
  return true;
}

/**
 * Move the caret to the next control of `container`, or the one before it
 * on Shift+Tab. True when the caret was moved and the key is spent.
 *
 * At either end, with no wrapping, the caret is left to the browser: Tab
 * then leaves the surface as it always did.
 */
export function walkTabStops(
  event: React.KeyboardEvent | KeyboardEvent,
  container: HTMLElement | null,
  options: WalkOptions = {}
): boolean {
  if (event.key !== "Tab") return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (!step(container, event.shiftKey ? -1 : 1, options)) return false;
  event.preventDefault();
  return true;
}

/**
 * Left and Right walk the same stops, so a row of chips can be stepped
 * through without leaving the row. In a text box the arrows stay the
 * text's own.
 */
export function walkArrowStops(
  event: React.KeyboardEvent | KeyboardEvent,
  container: HTMLElement | null,
  options: WalkOptions = {}
): boolean {
  const back = event.key === "ArrowLeft";
  if (!back && event.key !== "ArrowRight") return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return false;
  }
  const active = document.activeElement as HTMLElement | null;
  if (active && holdsCaret(active)) return false;
  if (!step(container, back ? -1 : 1, options)) return false;
  event.preventDefault();
  return true;
}
