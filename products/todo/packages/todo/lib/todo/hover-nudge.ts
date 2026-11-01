/**
 * A card the pointer rests on, cut off at the edge of the list it scrolls
 * in, is brought fully into view: its controls and chips come on hover,
 * and half under the add box they could not be seen.
 *
 * Only a card that is partly in view is moved, and only by the part that
 * is hidden (and a little room), so the card stays under the pointer.
 */

/** The room left between the card and the edge it was cut by. */
const ROOM = 8;

export function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/** How far to scroll so all of `card` shows: + down, - up, 0 when it shows. */
export function hiddenBy(card: DOMRect, box: DOMRect): number {
  // Wholly out of view is not a card the pointer is on.
  if (card.bottom <= box.top || card.top >= box.bottom) return 0;
  if (card.bottom > box.bottom) return Math.min(card.bottom - box.bottom + ROOM, card.top - box.top);
  if (card.top < box.top) return -Math.min(box.top - card.top + ROOM, box.bottom - card.bottom);
  return 0;
}

export function nudgeIntoView(card: HTMLElement) {
  const list = scrollParent(card);
  if (!list) return;
  const box = list.getBoundingClientRect();
  const by = hiddenBy(card.getBoundingClientRect(), box);
  if (by === 0) return;
  // Rects come back zoomed where the shell has a CSS zoom; scrolling does not.
  const scale = list.offsetHeight ? box.height / list.offsetHeight : 1;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  list.scrollBy({ top: by / scale, behavior: reduce ? "auto" : "smooth" });
}
