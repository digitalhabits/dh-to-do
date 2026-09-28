/**
 * The settings walk (walk-settings.mjs) on the desktop app's page.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the walk and the page are imported after installDom.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

suite(async () => {
  const { desktopPage } = await import("./desktop-page.mjs");
  const { walkSettings } = await import("./walk-settings.mjs");
  const page = await desktopPage();
  try {
    await walkSettings(page);
  } catch (err) {
    check("the walk ran to its end", false, err?.stack ?? err);
  }
});
