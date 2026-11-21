/**
 * When the review banner is due (src/store-review-rule.ts).
 *
 * The promise to keep: a person who answered the banner is never asked
 * again, in this version or a later one. The storage is a fake.
 */

import { askingStopped, countStart, stopAsking } from "../src/store-review-rule";

import { check, suite } from "./harness.mjs";

function fakeStorage() {
  const kept = new Map();
  return {
    kept,
    getItem: (k) => (kept.has(k) ? kept.get(k) : null),
    setItem: (k, v) => kept.set(k, String(v)),
  };
}

/** Count `n` starts; give the numbers of the starts at which the banner was due. */
function dueStarts(storage, n, from = 1) {
  const due = [];
  for (let i = from; i < from + n; i++) if (countStart(storage)) due.push(i);
  return due;
}

suite(async () => {
  // --- Nobody answered --------------------------------------------------
  let storage = fakeStorage();
  check(
    "the banner is due on the 10th start, and on each 10th after",
    dueStarts(storage, 30).join() === "10,20,30"
  );

  // --- Closed with the X: that is no answer -----------------------------
  storage = fakeStorage();
  dueStarts(storage, 10);
  check("closed and not answered, it is due again 10 starts later", dueStarts(storage, 10, 11).join() === "20");

  // --- Answered: never again --------------------------------------------
  storage = fakeStorage();
  dueStarts(storage, 10);
  stopAsking(storage);
  check("after an answer, asking is stopped", askingStopped(storage));
  check("and the banner is never due again", dueStarts(storage, 500, 11).length === 0);

  // --- An answer given in an older version of the app -------------------
  storage = fakeStorage();
  storage.kept.set("todoStoreReviewNoThanks", "true");
  storage.kept.set("todoStoreReviewOpensCount", "9");
  check("an answer kept by an older version holds: the 10th start is quiet", !countStart(storage));

  // --- An answer before the first banner (the link in Settings) ---------
  storage = fakeStorage();
  stopAsking(storage);
  check("an answer before any banner: no banner comes", dueStarts(storage, 100).length === 0);

  // --- Storage that cannot be read ---------------------------------------
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  check("storage that refuses: nobody is asked", dueStarts(broken, 30).length === 0);
});
