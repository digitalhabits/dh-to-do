/**
 * The way to the app's page in its store, where a person can write a
 * review. Only a store build of the desktop app has one: it sets it when
 * it starts (apps/todo/src/store-review.tsx). Settings shows a link when
 * there is one. The planner has none.
 */

let open: (() => void) | null = null;

export function setStoreReviewLink(next: (() => void) | null): void {
  open = next;
}

/** Opens the store page, or null when this build is not from a store. */
export function storeReviewLink(): (() => void) | null {
  return open;
}
