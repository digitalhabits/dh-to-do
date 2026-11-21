/**
 * The review banner's three controls and the Settings link, for each
 * store (src/store-review.tsx).
 *
 * The banner is the real one. The shell is a fake that keeps what the
 * page asked of it: an address to open, or the Mac's rating sheet. When
 * the banner is due is another suite's (store-review-rule.test.mjs).
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

const STOPPED = "todoStoreReviewNoThanks";
const MAC_PAGE = "macappstore://apps.apple.com/app/id6760351681";
const WINDOWS_BOX = "ms-windows-store://review/?ProductId=9P48NJXCBBGH";

suite(async () => {
  const { $, click, mountPage, sleep, until } = await import("./page-walk.mjs");
  const { ReviewBanner, reviewLinkFor } = await import("../src/store-review");

  /** A fake shell. `sheet` is what the Mac says of its rating sheet. */
  function fakeShell(sheet) {
    const asked = [];
    window.__TAURI__ = {
      opener: { openUrl: async (href) => void asked.push(`open ${href}`) },
      core: {
        invoke: async (command) => {
          asked.push(`invoke ${command}`);
          if (sheet === "fails") throw new Error("no such command");
          return sheet;
        },
      },
    };
    return asked;
  }

  /** A new banner on a clean device. Answers what the page asked and if it closed. */
  async function banner(channel, sheet) {
    localStorage.clear();
    const asked = fakeShell(sheet);
    const state = { closed: false };
    const mounted = await mountPage(ReviewBanner, { channel, onClose: () => (state.closed = true) });
    await until(() => Boolean($(".store-review-prompt")));
    return { asked, state, mounted };
  }
  const stopped = () => localStorage.getItem(STOPPED) === "true";
  const end = (b) => b.mounted?.unmount?.();

  // --- Windows: the Store's review box ----------------------------------
  let b = await banner("windows", true);
  click($(".store-review-leave-link"));
  await sleep(50);
  check("Windows: Leave a review opens the Store's review box", b.asked.join() === `open ${WINDOWS_BOX}`, b.asked.join());
  check("Windows: and the banner closes, and never comes again", b.state.closed && stopped());
  end(b);

  // --- Mac: the sheet came -----------------------------------------------
  b = await banner("mac", true);
  click($(".store-review-leave-link"));
  await sleep(50);
  check("Mac: Leave a review asks for the rating sheet, and no more", b.asked.join() === "invoke request_store_review", b.asked.join());
  check("Mac: and the banner closes, and never comes again", b.state.closed && stopped());
  end(b);

  // --- Mac: no sheet came -------------------------------------------------
  b = await banner("mac", false);
  click($(".store-review-leave-link"));
  await sleep(50);
  check(
    "Mac: with no sheet, the App Store page opens",
    b.asked.join() === `invoke request_store_review,open ${MAC_PAGE}`,
    b.asked.join()
  );
  end(b);

  b = await banner("mac", "fails");
  click($(".store-review-leave-link"));
  await sleep(50);
  check(
    "Mac: when the shell cannot ask, the App Store page opens",
    b.asked.join() === `invoke request_store_review,open ${MAC_PAGE}`,
    b.asked.join()
  );
  end(b);

  // --- The other two controls, the same on both --------------------------
  for (const channel of ["mac", "windows"]) {
    b = await banner(channel, true);
    click($(".store-review-no-thanks"));
    check(`${channel}: I already did closes the banner for good, and opens nothing`, b.state.closed && stopped() && b.asked.length === 0);
    end(b);

    b = await banner(channel, true);
    click($(".store-review-prompt-dismiss"));
    check(`${channel}: the X closes the banner, and it can come again`, b.state.closed && !stopped() && b.asked.length === 0);
    end(b);
  }

  // --- The link in Settings ----------------------------------------------
  for (const [channel, address] of [["mac", MAC_PAGE], ["windows", WINDOWS_BOX]]) {
    localStorage.clear();
    const asked = fakeShell(true);
    reviewLinkFor(channel)();
    check(`${channel}: Write a review in Settings opens the store`, asked.join() === `open ${address}`, asked.join());
    check(`${channel}: and ends the banner`, stopped());
  }
});
