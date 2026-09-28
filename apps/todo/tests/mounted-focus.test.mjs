/**
 * The focus window walk (walk-focus.mjs) on the desktop app's build.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the walk is imported after installDom.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  window.__TODO_PRODUCT_FLAVOR__ = "standalone";
  const { walkFocus } = await import("./walk-focus.mjs");
  try {
    await walkFocus();
  } catch (err) {
    check("the walk ran to its end", false, err?.stack ?? err);
  }
});
