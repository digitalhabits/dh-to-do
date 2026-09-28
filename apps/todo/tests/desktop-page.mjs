/**
 * The page as the desktop app mounts it, for a walk: the fake board of
 * fake-board.mjs behind the Tauri SQL bridge, and no first state, so the
 * page reads its board itself.
 *
 * A walk takes what this answers and does not care which flavour it has.
 * The planner's twin is page-host-planner.mjs.
 */

import { installFakeBoard } from "./fake-board.mjs";
import { mountPage } from "./page-walk.mjs";

export async function desktopPage() {
  window.__TODO_PRODUCT_FLAVOR__ = "standalone";
  const board = await installFakeBoard();
  const { todoHostApi } = await import("@/lib/todo/standalone-api");
  const { TodoPage } = await import("@/components/todo/TodoPage");
  return {
    flavor: "desktop",
    board,
    /** The store's API, to make a board before the page is up. */
    call: todoHostApi,
    /** Mount the page. `props` go over the app's own. */
    async mount(props = {}) {
      return mountPage(TodoPage, { initialState: null, ...props });
    },
  };
}
