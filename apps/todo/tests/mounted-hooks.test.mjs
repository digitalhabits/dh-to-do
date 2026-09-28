/**
 * The page's hooks, each in a component of its own (see renderHook in
 * page-walk.mjs). The walks check the page; these check a hook's own
 * rules, which a walk cannot reach one at a time.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the checks are imported after installDom.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  const { hookChecks } = await import("./hook-checks.mjs");
  try {
    await hookChecks();
  } catch (err) {
    check("the checks ran to their end", false, err?.stack ?? err);
  }
});
