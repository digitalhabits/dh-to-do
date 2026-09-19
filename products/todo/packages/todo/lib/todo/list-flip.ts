/**
 * Rows that slide to their new places instead of jumping there.
 *
 * When a list is reordered — a step ticked off and sorted to the pile at
 * the bottom, say — React draws the new order in one go, and every row
 * appears where it now belongs. The eye loses the row it was watching. So
 * the rows' places are measured before the change, and after it each row
 * is drawn back where it was and slid to where it is: the row that moved
 * is seen to move, and the rows it passed make way.
 *
 * Plain elements and the Web Animations API, nothing kept in React. A
 * reader who has asked for less motion gets the jump, which is what they
 * asked for.
 */

import { prefersReducedMotion } from "./task-celebration";

/** Where each row's top edge was, by the row's id. */
export type RowTops = Map<string, number>;

/** The rows' top edges now, by their `data-*` id. */
export function measureRowTops(
  container: HTMLElement | null,
  selector: string,
  idAttribute: string
): RowTops {
  const tops: RowTops = new Map();
  if (!container) return tops;
  // Against the list, not the window: a list that scrolled or shifted
  // between two orders has not moved its rows among themselves.
  const origin = container.getBoundingClientRect().top;
  for (const row of container.querySelectorAll<HTMLElement>(selector)) {
    const id = row.getAttribute(idAttribute);
    if (id) tops.set(id, row.getBoundingClientRect().top - origin);
  }
  return tops;
}

/** The glide, and the pause before it when a tick should be seen first. */
export const ROW_SLIDE_MS = 380;
export const ROW_SLIDE_HOLD_MS = 160;
export const ROW_GLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Slide every row from where it was to where it is. Answers where the
 * rows are now, to be kept for the next change.
 */
export function slideRowsIntoPlace(
  container: HTMLElement | null,
  before: RowTops,
  selector: string,
  idAttribute: string,
  options: { holdMs?: number; skipId?: string | null } = {}
): RowTops {
  const after = measureRowTops(container, selector, idAttribute);
  if (!container || prefersReducedMotion() || typeof Element === "undefined") return after;
  if (typeof Element.prototype.animate !== "function") return after;
  const hold = options.holdMs ?? 0;
  for (const row of container.querySelectorAll<HTMLElement>(selector)) {
    const id = row.getAttribute(idAttribute);
    if (!id || id === options.skipId) continue;
    const was = before.get(id);
    const now = after.get(id);
    if (was === undefined || now === undefined) continue;
    const dy = was - now;
    if (Math.abs(dy) < 0.5) continue;
    row.animate(
      [
        { transform: `translateY(${dy}px)` },
        { transform: `translateY(${dy}px)`, offset: hold > 0 ? hold / (hold + ROW_SLIDE_MS) : 0 },
        { transform: "translateY(0)" },
      ],
      { duration: hold + ROW_SLIDE_MS, easing: ROW_GLIDE_EASING, fill: "none" }
    );
  }
  return after;
}

/** Where each row was on screen, by the row's id. */
export type RowBoxes = Map<string, { x: number; y: number }>;

/**
 * The rows' places on screen now, across one or more lists.
 *
 * On screen, not against a list: a task that flies to Done leaves one list
 * and lands in another, and the rows of both move. The Done pile is a grid,
 * so a row there can move sideways as well as down.
 */
export function measureRowBoxes(
  containers: Array<HTMLElement | null>,
  selector: string,
  idAttribute: string
): RowBoxes {
  const boxes: RowBoxes = new Map();
  for (const container of containers) {
    if (!container) continue;
    for (const row of container.querySelectorAll<HTMLElement>(selector)) {
      const id = row.getAttribute(idAttribute);
      if (!id) continue;
      const rect = row.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      boxes.set(id, { x: rect.left, y: rect.top });
    }
  }
  return boxes;
}

/**
 * Keep the rows where they were, and let them go on a cue.
 *
 * Call it right after the change is drawn and before the screen paints.
 * Each row that moved is drawn back in its old place. The rows stay there
 * until `release` is called, then glide to their new places. A task that
 * flies to Done calls `release` as it sets off: the gap it leaves closes
 * behind it, and the rows where it lands make way as it comes, not before.
 *
 * `release` can be called more than once. Only the first call counts.
 */
export function holdRowsInPlace(
  containers: Array<HTMLElement | null>,
  before: RowBoxes,
  selector: string,
  idAttribute: string,
  options: { skipId?: string | null } = {}
): (glide: { durationMs: number; easing: string }) => void {
  if (prefersReducedMotion()) return () => {};
  const held: HTMLElement[] = [];
  for (const container of containers) {
    if (!container) continue;
    for (const row of container.querySelectorAll<HTMLElement>(selector)) {
      const id = row.getAttribute(idAttribute);
      if (!id || id === options.skipId) continue;
      const was = before.get(id);
      if (!was) continue;
      const rect = row.getBoundingClientRect();
      const dx = was.x - rect.left;
      const dy = was.y - rect.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      row.style.transition = "none";
      row.style.transform = `translate(${dx}px, ${dy}px)`;
      held.push(row);
    }
  }
  let released = false;
  return ({ durationMs, easing }) => {
    if (released) return;
    released = true;
    if (!held.length) return;
    // Settle the held places before the glide, or there is nothing to glide from.
    void held[0].offsetWidth;
    for (const row of held) {
      row.style.transition = `transform ${durationMs}ms ${easing}`;
      row.style.transform = "";
    }
    window.setTimeout(() => {
      for (const row of held) row.style.transition = "";
    }, durationMs + 40);
  };
}

/** The check's little pop as it fills, over the row's own tick. */
export function popCheck(check: HTMLElement | null): void {
  if (!check || prefersReducedMotion() || typeof check.animate !== "function") return;
  check.animate(
    [
      { transform: "scale(1)" },
      { transform: "scale(1.28)", offset: 0.4 },
      { transform: "scale(0.96)", offset: 0.75 },
      { transform: "scale(1)" },
    ],
    { duration: 360, easing: "ease-out" }
  );
}
