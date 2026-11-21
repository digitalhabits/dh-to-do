/**
 * When the review banner is due, and when it is never due again.
 *
 * Due on every 10th start, until the person answers: "Leave a review",
 * "I already did", or the "Write a review" link in Settings. After that,
 * never. No store tells an app that a review was left, so the person's
 * answer is the only sign there is. Closing the banner with the X is not
 * an answer: it is due again at the next 10th start.
 *
 * The two keys are the ones that 3.x has used from the start, so a person
 * who answered in an older version is not asked again by a newer one.
 */

const STARTS_KEY = "todoStoreReviewOpensCount";
const STOPPED_KEY = "todoStoreReviewNoThanks";
const EVERY = 10;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** Count one start. True when the banner is due at this start. */
export function countStart(storage: Storage): boolean {
  let n = 0;
  try {
    n = parseInt(storage.getItem(STARTS_KEY) || "", 10);
  } catch {
    /* storage refused: count from one */
  }
  n = Number.isFinite(n) && n > 0 ? n + 1 : 1;
  try {
    storage.setItem(STARTS_KEY, String(n));
  } catch {
    /* storage refused: the count is lost, and the banner comes later */
  }
  return n % EVERY === 0 && !askingStopped(storage);
}

/** The person answered. The banner is never due again. */
export function stopAsking(storage: Storage): void {
  try {
    storage.setItem(STOPPED_KEY, "true");
  } catch {
    /* storage refused: nothing to keep it in */
  }
}

/** True also when storage cannot be read: then do not ask. */
export function askingStopped(storage: Storage): boolean {
  try {
    return storage.getItem(STOPPED_KEY) === "true";
  } catch {
    return true;
  }
}
