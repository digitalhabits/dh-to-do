/**
 * The first suite that mounts the real To-Do page: the desktop app's
 * flavour, on the fake board of fake-board.mjs.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the walk itself is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-smoke.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
