/**
 * Microsoft To Do on the desktop app's page: the Settings row, the picker
 * in the list dialog, and the first sync of a list made linked.
 *
 * The page, the store and the sync are the real ones. Two things are
 * stood in for: the desktop shell's Microsoft commands (who is signed in,
 * a token), and Microsoft Graph itself, a list of two tasks. The account,
 * the list and the tasks are invented.
 */

import { installDom } from "./mounted-dom.mjs";
import { check, suite } from "./harness.mjs";

installDom();

const ACCOUNT = "ana@example.com";
const SECOND = "bo@example.com";
const TASKS = "/v1.0/me/todo/lists/mlist-1/tasks";

/** Microsoft Graph, as much of it as this walk asks for. */
function fakeGraphFetch(sent) {
  const answer = (value) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const task = (id, title, second) => ({
    id,
    title,
    body: { content: "", contentType: "text" },
    status: "notStarted",
    createdDateTime: `2026-07-01T09:00:0${second}.0000000Z`,
    lastModifiedDateTime: `2026-07-01T09:00:0${second}.0000000Z`,
  });
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? "GET").toUpperCase();
    sent.push(`${method} ${url.pathname}`);
    if (url.pathname === "/v1.0/me/todo/lists") {
      // The token says whose lists these are.
      if (new Headers(init.headers).get("Authorization") === `Bearer token-${SECOND}`) {
        return answer({ value: [{ id: "mlist-9", displayName: "Work", wellknownListName: "none" }] });
      }
      return answer({
        value: [
          { id: "mlist-1", displayName: "Errands", wellknownListName: "none" },
          { id: "flagged", displayName: "Flagged Emails", wellknownListName: "flaggedEmails" },
        ],
      });
    }
    if (url.pathname === `${TASKS}/delta` && method === "GET") {
      return answer({
        value: [task("m1", "Buy stamps", 1), task("m2", "Post the parcel", 2)],
        "@odata.deltaLink": `https://graph.microsoft.com${TASKS}/delta?$deltatoken=2`,
      });
    }
    return answer({ error: { message: "The walk asked for nothing else" } });
  };
}

suite(async () => {
  const { desktopPage } = await import("./desktop-page.mjs");
  const { $, $$, click, text, until } = await import("./page-walk.mjs");
  const { makeT } = await import("@/lib/todo/i18n");
  const microsoft = await import("@/lib/todo/microsoft");
  const t = makeT("en");
  const page = await desktopPage();

  // The shell's Microsoft commands. Everything else goes to the fake board.
  let accounts = [];
  const board = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (command, args) => {
    if (command === "microsoft_status") return { configured: true, accounts };
    if (command === "microsoft_access_token") return `token-${args.email}`;
    return board(command, args);
  };

  // One call first, so the app installs its own transport; then
  // Microsoft's side of it is replaced.
  await page.call("/api/todo/state", "GET");
  const sent = [];
  microsoft.setMicrosoftTransport({
    ...microsoft.microsoftTransport(),
    fetch: fakeGraphFetch(sent),
  });

  await page.mount();
  await until(() => Boolean($(".title-bar-settings-btn")));

  // --- Settings: nobody signed in --------------------------------------
  click($(".title-bar-settings-btn"));
  check(
    "Settings offers to connect Microsoft",
    await until(() => text().includes(t("microsoftInfo")))
  );
  check("and says nothing of a connection", !text().includes(t("connectedMicrosoft")));
  click($("#settings-modal .settings-sheet-back"));
  await until(() => !$("#settings-modal"));

  // --- The list dialog: no account, no picker --------------------------
  click($(".add-tab-btn-subtle"));
  await until(() => Boolean($("#tab-name-modal")));
  check(
    "with no account, the list dialog has no Microsoft picker",
    !text().includes(t("microsoftTasksList"))
  );
  click($("#tab-name-modal .cancel-btn"));
  await until(() => !$("#tab-name-modal"));

  // --- Signed in --------------------------------------------------------
  accounts = [{ email: ACCOUNT, scopes: ["Tasks.ReadWrite", "openid", "profile", "email"] }];
  click($(".title-bar-settings-btn"));
  check(
    "signed in, Settings names the account",
    await until(() => text().includes(t("connectedMicrosoft")) && text().includes(ACCOUNT))
  );
  click($("#settings-modal .settings-sheet-back"));
  await until(() => !$("#settings-modal"));

  // --- A list made linked takes in Microsoft's tasks --------------------
  click($(".add-tab-btn-subtle"));
  await until(() => Boolean($("#tab-name-modal")));
  const trigger = () => $(`#tab-name-modal [aria-label="${t("microsoftTasksList")}"]`);
  check("the list dialog has the Microsoft picker", await until(() => Boolean(trigger())));
  click(trigger());
  const option = () => $$(".todo-select-option").find((o) => o.textContent === "Errands");
  check("with the account's task lists", await until(() => Boolean(option())));
  check(
    "but not the list of flagged mail",
    !$$(".todo-select-option").some((o) => o.textContent === "Flagged Emails")
  );
  click(option());
  check(
    "a pick names the list after the Microsoft list",
    await until(() => $("#tab-name-modal input")?.value === "Errands")
  );
  check("and says what will sync", text().includes(t("microsoftTasksListHint")));
  click($("#tab-name-modal .create-btn"));
  check(
    "the new list shows Microsoft's tasks",
    await until(() => text().includes("Buy stamps") && text().includes("Post the parcel"), 5000)
  );
  const links = page.board.query("SELECT * FROM todo_microsoft_lists");
  check(
    "the link is kept, with the account and the place of the next read",
    links.length === 1 &&
      links[0].microsoft_list_id === "mlist-1" &&
      links[0].account === ACCOUNT &&
      String(links[0].cursor).includes("$deltatoken=2"),
    JSON.stringify(links)
  );
  check(
    "each task is linked to its Microsoft task",
    page.board
      .query("SELECT microsoft_id FROM todo_microsoft_tasks ORDER BY microsoft_id")
      .map((r) => r.microsoft_id)
      .join() === "m1,m2"
  );
  check(
    "the list is not linked to Google Tasks too",
    page.board.query("SELECT * FROM todo_google_lists").length === 0
  );
  // --- A second account ---------------------------------------------------
  accounts = [...accounts, { email: SECOND, scopes: ["Tasks.ReadWrite"] }];
  click($(".title-bar-settings-btn"));
  check(
    "with two accounts, Settings names both",
    await until(() => text().includes(ACCOUNT) && text().includes(SECOND))
  );
  check(
    "each with its own Disconnect, and one way to add another",
    $$("#settings-modal .settings-disconnect-btn").length >= 2 &&
      $$("#settings-modal .settings-text-link").filter(
        (b) => b.textContent === t("addAnotherAccount")
      ).length >= 1
  );
  click($("#settings-modal .settings-sheet-back"));
  await until(() => !$("#settings-modal"));

  click($(".add-tab-btn-subtle"));
  await until(() => Boolean(trigger()));
  click(trigger());
  const second = () =>
    $$(".todo-select-option").find((o) => o.textContent === `Work (${SECOND})`);
  check("the picker has the second account's list, with its account", await until(() => Boolean(second())));
  check(
    "and the first account's list says its account too",
    $$(".todo-select-option").some((o) => o.textContent === `Errands (${ACCOUNT})`)
  );
  click(second());
  await until(() => $("#tab-name-modal input")?.value === "Work");
  click($("#tab-name-modal .create-btn"));
  check(
    "a list linked from the second account keeps that account",
    await until(
      () =>
        page.board
          .query("SELECT account FROM todo_microsoft_lists WHERE microsoft_list_id = 'mlist-9'")
          .map((r) => r.account)
          .join() === SECOND,
      5000
    ),
    JSON.stringify(page.board.query("SELECT * FROM todo_microsoft_lists"))
  );

  check(
    "nothing was sent to Microsoft but reads",
    sent.every((line) => line.startsWith("GET ")),
    sent.join(" | ")
  );
});
