/**
 * The add-task row walk (walk-composer.mjs) on the desktop app's build.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  window.__TODO_PRODUCT_FLAVOR__ = "standalone";
  const { walkComposer } = await import("./walk-composer.mjs");
  try {
    await walkComposer();
  } catch (err) {
    check("the walk ran to its end", false, err?.stack ?? err);
  }
});
