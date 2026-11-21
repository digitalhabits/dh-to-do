/**
 * Google Tasks on the desktop app's page: the Settings row, the picker in
 * the list dialog, and the first sync of a list made linked.
 *
 * The page, the store and the sync are the real ones. Two things are
 * stood in for: the desktop shell's Google commands (who is signed in, a
 * token), and Google itself, a list of two tasks. The account, the list
 * and the tasks are invented.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

const ACCOUNT = "ana@example.com";
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

/** Google, as much of it as this walk asks for. */
function fakeGoogleFetch(sent) {
  const answer = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    sent.push(`${method} ${url.pathname}`);
    if (url.pathname === "/tasks/v1/users/@me/lists") {
      return answer({ items: [{ id: "glist-1", title: "Errands" }] });
    }
    if (url.pathname === "/tasks/v1/lists/glist-1/tasks" && method === "GET") {
      return answer({
        items: [
          {
            id: "g1",
            title: "Buy stamps",
            status: "needsAction",
            updated: "2026-07-01T09:00:01.000Z",
            position: "1",
          },
          {
            id: "g2",
            title: "Post the parcel",
            status: "needsAction",
            updated: "2026-07-01T09:00:02.000Z",
            position: "2",
          },
        ],
      });
    }
    return answer({ error: { message: "The walk asked for nothing else" } });
  };
}

suite(async () => {
  const { desktopPage } = await import("./desktop-page.mjs");
  const { $, $$, click, text, until } = await import("./page-walk.mjs");
  const { makeT } = await import("@/lib/todo/i18n");
  const google = await import("@/lib/todo/google");
  const t = makeT("en");
  const page = await desktopPage();

  // The shell's Google commands. Everything else goes to the fake board.
  let accounts = [];
  const board = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === "google_status") return { configured: true, accounts };
    if (command === "google_access_token") return "token-1";
    return board(command, args);
  };

  // One call first, so the app installs its own transport; then Google's
  // side of it is replaced.
  await page.call("/api/todo/state", "GET");
  const sent = [];
  google.setGoogleTransport({ ...google.googleTransport(), fetch: fakeGoogleFetch(sent) });

  await page.mount();
  await until(() => Boolean($(".title-bar-settings-btn")));

  // --- Settings: nobody signed in --------------------------------------
  click($(".title-bar-settings-btn"));
  check("Settings offers to connect Google", await until(() => text().includes(t("googleInfo"))));
  check("and says nothing of a connection", !text().includes(t("connectedGoogle")));
  click($("#settings-modal .settings-sheet-back"));
  await until(() => !$("#settings-modal"));

  // --- The list dialog: no account, no picker --------------------------
  click($(".add-tab-btn-subtle"));
  await until(() => Boolean($("#tab-name-modal")));
  check(
    "with no account, the list dialog has no Google picker",
    !text().includes(t("googleTasksList"))
  );
  click($("#tab-name-modal .cancel-btn"));
  await until(() => !$("#tab-name-modal"));

  // --- Signed in --------------------------------------------------------
  accounts = [{ email: ACCOUNT, scopes: [TASKS_SCOPE] }];
  click($(".title-bar-settings-btn"));
  check(
    "signed in, Settings names the account",
    await until(() => text().includes(t("connectedGoogle")) && text().includes(ACCOUNT))
  );
  click($("#settings-modal .settings-sheet-back"));
  await until(() => !$("#settings-modal"));

  // --- A list made linked takes in Google's tasks -----------------------
  click($(".add-tab-btn-subtle"));
  await until(() => Boolean($("#tab-name-modal")));
  const trigger = () => $(`#tab-name-modal [aria-label="${t("googleTasksList")}"]`);
  check("the list dialog has the Google picker", await until(() => Boolean(trigger())));
  click(trigger());
  const option = () => $$(".todo-select-option").find((o) => o.textContent === "Errands");
  check("with the account's task lists", await until(() => Boolean(option())));
  click(option());
  check(
    "a pick names the list after the Google list",
    await until(() => $("#tab-name-modal input")?.value === "Errands")
  );
  check("and says what will sync", text().includes(t("googleTasksListHint")));
  click($("#tab-name-modal .create-btn"));
  check(
    "the new list shows Google's tasks",
    await until(() => text().includes("Buy stamps") && text().includes("Post the parcel"), 5000)
  );
  const links = page.board.query("SELECT * FROM todo_google_lists");
  check(
    "the link is kept, with the account",
    links.length === 1 && links[0].google_list_id === "glist-1" && links[0].account === ACCOUNT,
    JSON.stringify(links)
  );
  check(
    "each task is linked to its Google task",
    page.board
      .query("SELECT google_id FROM todo_google_tasks ORDER BY google_id")
      .map((r) => r.google_id)
      .join() === "g1,g2"
  );
  check(
    "nothing was sent to Google but reads",
    sent.every((line) => line.startsWith("GET ")),
    sent.join(" | ")
  );
});
