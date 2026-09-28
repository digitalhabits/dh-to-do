/**
 * Settings: each switch and what it changes on the board, the language,
 * the theme and the zoom (the buttons, and the keys the desktop app
 * answers), and the backup out to a file and in again.
 *
 * Run in both flavours: mounted-settings and mounted-settings-planner.
 * Every list and task is invented.
 */

import { check } from "./harness.mjs";
import {
  $,
  $$,
  cardOf,
  click,
  pressCmd,
  settle,
  text,
  until,
} from "./page-walk.mjs";
import { installUploads } from "./page-walk.mjs";
import { settingsSwitch } from "./walk-lists.mjs";

const column = (name) => $(`.list-board > .board-column[data-board-column="${name}"]`);

async function openSettings() {
  if (!$("#settings-modal")) click($(".title-bar-settings-btn"));
  await until(() => Boolean($("#settings-modal")));
}
async function closeSettings() {
  if ($("#settings-modal")) click($("#settings-modal .cancel-btn"));
  await until(() => !$("#settings-modal"));
}
async function flip(label) {
  await openSettings();
  const box = settingsSwitch(label);
  box?.click();
  await settle(150);
  return box;
}

export async function walkSettings(page) {
  const { makeT } = await import("@/lib/todo/i18n");
  const t = makeT("en");
  const { board, call } = page;
  const row = (words) =>
    board.query("SELECT * FROM todo_tasks WHERE text = ?", [words])[0] ?? null;

  const list = (await call("/api/todo/lists", "POST", { name: "Loft" })).list;
  const pip = (await call("/api/todo/people", "POST", { name: "Pip Moss", sourceKind: "manual" })).person;
  await call("/api/todo/tasks", "POST", { listId: list.id, text: "Box the books", assigneeIds: [pip.id] });
  // Pictures for the backup: Pip's photo is in the app's store; Rue's is
  // gone from it. The desktop app keeps pictures behind Tauri, the planner
  // behind /api/media.
  const src = (id) => (page.flavor === "desktop" ? `todo-media://localhost/${id}` : `/api/media/${id}`);
  await call("/api/todo/people", "PATCH", { id: pip.id, photoUrl: src("m-walk") });
  const rue = (await call("/api/todo/people", "POST", { name: "Rue Hart", sourceKind: "manual" })).person;
  await call("/api/todo/people", "PATCH", { id: rue.id, photoUrl: src("m-gone") });
  const PICTURE = btoa("PIC");
  if (page.flavor === "desktop") {
    const bridge = window.__TAURI_INTERNALS__;
    const inner = bridge.invoke;
    bridge.invoke = async (command, args = {}) => {
      if (command === "todo_media_read") {
        return args.id === "m-walk" ? { bytesBase64: PICTURE, contentType: "image/png", filename: "pip.png" } : null;
      }
      return inner(command, args);
    };
  } else {
    const inner = globalThis.fetch;
    globalThis.fetch = window.fetch = async (input, init) =>
      String(input) === "/api/media/m-walk"
        ? new Response("PIC", { status: 200, headers: { "Content-Type": "image/png" } })
        : String(input) === "/api/media/m-gone"
          ? new Response("", { status: 404 })
          : inner(input, init);
  }
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (toast) => toasts.push(toast);
  await call("/api/todo/tasks", "POST", { listId: list.id, text: "Mend the lamp", isToday: true });
  await call("/api/todo/tasks", "POST", { listId: list.id, text: "Wrap the frames", isSomeday: true });

  // A wide window: see walk-board.mjs.
  const proto = window.HTMLElement.prototype;
  const originals = ["offsetWidth", "offsetHeight"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(proto, key),
  ]);
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 1400 });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 900 });
  localStorage.setItem("redd-plan-todo-kanban", "0");
  const view = await page.mount();
  check("the list paints", await until(() => Boolean(cardOf("Box the books"))), text().slice(0, 200));
  check("Board View off is one list", await until(() => !$(".list-board")));

  // Board View.
  await flip(t("enableKanbanView"));
  await closeSettings();
  check("Board View on draws the columns", await until(() => Boolean(column("today"))));
  check("and is kept", localStorage.getItem("redd-plan-todo-kanban") === "1");

  // Someday.
  check("no Someday column at first", !column("someday"));
  await flip(t("enableSomedayColumn"));
  await closeSettings();
  check("Someday on adds its column", await until(() => Boolean(column("someday"))));
  check("folded to a rail", column("someday")?.classList.contains("is-rail"));
  click(column("someday"));
  check("a click on the rail opens it", await until(() => !column("someday").classList.contains("is-rail")));
  check("and Today folds to a rail", column("today")?.classList.contains("is-rail"));
  check(
    "a Someday task is in its column",
    Boolean(column("someday")?.querySelector(".task-item")) &&
      column("someday").textContent.includes("Wrap the frames")
  );
  await flip(t("enableSomedayColumn"));
  check(
    "Someday off puts its tasks in the Backlog",
    await until(() => row("Wrap the frames")?.is_someday === 0 && row("Wrap the frames")?.is_backlog === 1),
    JSON.stringify({ someday: row("Wrap the frames")?.is_someday, backlog: row("Wrap the frames")?.is_backlog })
  );
  await closeSettings();
  check("and the column goes", await until(() => !column("someday")));

  // Assigning.
  const assignOn = page.flavor === "planner";
  await openSettings();
  check(
    `assigning is ${assignOn ? "on" : "off"} at first in this app`,
    settingsSwitchState(t("enableAssignTasks"), assignOn)
  );
  if (!assignOn) {
    await flip(t("enableAssignTasks"));
    await closeSettings();
  }
  check(
    "assigning on shows the people on a card",
    await until(() => Boolean(cardOf("Box the books")?.querySelector(".task-chip-assign.is-set")))
  );
  await flip(t("enableAssignTasks"));
  await closeSettings();
  check(
    "assigning off takes them away",
    await until(() => !cardOf("Box the books")?.querySelector(".task-chip-assign"))
  );
  check("the people stay on the task", board.query("SELECT * FROM todo_task_assignees").length === 1);

  // The Calendar view's switch.
  check("no Calendar view at first", !$('.view-btn[data-view-id="plan"]'));
  await flip(t("enablePlanMode"));
  await closeSettings();
  check("the Calendar switch adds its view button", await until(() => Boolean($('.view-btn[data-view-id="plan"]'))));
  await flip(t("enablePlanMode"));
  await closeSettings();
  check("and takes it away", await until(() => !$('.view-btn[data-view-id="plan"]')));

  // Language and theme.
  await openSettings();
  click($(".language-picker-trigger"));
  if (await until(() => Boolean($(".language-picker-option--switch")))) {
    click($(".language-picker-option--switch"));
  }
  check("the language changes the page", await until(() => $("#settings-modal-title")?.textContent === makeT("da")("settings")));
  check("and is kept", localStorage.getItem("redd-plan-todo-lang") === "da");
  click($(".language-picker-trigger"));
  if (await until(() => Boolean($(".language-picker-option--switch")))) {
    click($(".language-picker-option--switch"));
  }
  await until(() => localStorage.getItem("redd-plan-todo-lang") === "en");
  const theme = $("#theme-select");
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(theme, "dark");
  theme.dispatchEvent(new window.Event("change", { bubbles: true }));
  check("the dark theme is drawn", await until(() => $(".todo-shell")?.dataset.theme === "dark"));
  check("and kept", localStorage.getItem("redd-plan-todo-theme") === "dark");

  // Zoom: the buttons in Settings.
  click($(".zoom-in-btn"));
  const zoom = () => $(".todo-shell")?.style.getPropertyValue("--todo-zoom");
  check("Zoom in makes the page bigger", await until(() => zoom() === "1.1"), zoom());
  check("and is kept", localStorage.getItem("redd-plan-todo-zoom") === "110");
  click($(".zoom-out-btn"));
  await until(() => zoom() === "1");
  await closeSettings();

  // Zoom keys: the desktop app's, as a browser has them. The planner
  // leaves the keys to the browser.
  pressCmd(window, "=");
  if (page.flavor === "desktop") {
    check("Cmd and + zoom in", await until(() => zoom() === "1.1"), zoom());
    pressCmd(window, "-");
    pressCmd(window, "-");
    check("Cmd and − zoom out", await until(() => zoom() === "0.9"), zoom());
    pressCmd(window, "0");
    check("Cmd and 0 go back to 100%", await until(() => zoom() === "1"), zoom());
    check("the key's zoom is kept", localStorage.getItem("redd-plan-todo-zoom") === "100");
  } else {
    await settle();
    check("the planner leaves Cmd and + to the browser", zoom() === "1", zoom());
  }

  // The backup: out to a file.
  const downloads = [];
  const originalClick = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, href: this.href });
  };
  const blobs = new Map();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    const url = `blob:walk/${blobs.size + 1}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => {};
  await openSettings();
  click($$(".settings-blocklists-io-btn")[0]);
  check("Export writes a file", await until(() => downloads.length === 1));
  const file = downloads[0];
  check("named as a backup", /\.json$/.test(file?.name ?? ""), file?.name);
  const backup = file ? JSON.parse(await blobs.get(file.href).text()) : {};
  const backupTasks = JSON.stringify(backup).includes("Mend the lamp");
  check("the file holds the board", backupTasks, JSON.stringify(backup).slice(0, 200));
  const pictures = backup.media ?? [];
  check(
    "and the pictures the store still has",
    pictures.length === 1 && pictures[0].id === "m-walk" && pictures[0].data === PICTURE && pictures[0].contentType === "image/png",
    JSON.stringify(pictures).slice(0, 200)
  );
  check("a picture the store lost is said", toasts.some((toast) => toast.kind === "warning" && toast.message === t("exportMissingPictures")));
  window.HTMLAnchorElement.prototype.click = originalClick;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;

  // And in again, from a file with a list of its own.
  const incoming = JSON.parse(JSON.stringify(backup));
  const imported = JSON.stringify(incoming)
    .replaceAll("Loft", "Cellar")
    .replaceAll("Mend the lamp", "Stack the wine")
    .replaceAll("Pip Moss", "Ivy Pike");
  // A file that is not JSON is said, and nothing is asked.
  const input = $('#settings-modal input[type="file"]');
  check("Settings has a file box for the import", Boolean(input));
  if (input) {
    const junk = new window.File(["not json"], "board.json", { type: "application/json" });
    Object.defineProperty(input, "files", { configurable: true, value: [junk] });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  check("a file that is not a backup is said", await until(() => toasts.some((toast) => toast.kind === "error" && toast.message === "Not a valid JSON backup file")));
  check("and nothing is asked", !$(".modal-overlay .create-btn"));
  // The file's pictures go into the store anew, before the board.
  const writes = [];
  if (page.flavor === "desktop") {
    const bridge = window.__TAURI_INTERNALS__;
    const inner = bridge.invoke;
    bridge.invoke = async (command, args = {}) => {
      if (command === "todo_media_write") {
        writes.push(args);
        return { id: "m-new", ...args };
      }
      return inner(command, args);
    };
  } else {
    installUploads({ mediaId: "m-new" });
  }
  if (input) {
    const upload = new window.File([imported], "board.json", { type: "application/json" });
    Object.defineProperty(input, "files", { configurable: true, value: [upload] });
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  check("Import asks first", await until(() => Boolean($(".modal-overlay .create-btn"))));
  check("with Settings put away", !$("#settings-modal"));
  click($(".modal-overlay .create-btn"));
  check(
    "the file's tasks are on the board",
    await until(() => row("Stack the wine") !== null, 5000),
    JSON.stringify(board.query("SELECT text FROM todo_tasks"))
  );
  check("and on the page", await until(() => Boolean(cardOf("Stack the wine")) || text().includes("Cellar")));
  const newPhotos = board.query("SELECT photo_url FROM todo_people WHERE name = ? AND photo_url LIKE ?", ["Ivy Pike", "%m-new%"]);
  check("the file's picture is kept anew, and the person names it", newPhotos.length > 0, JSON.stringify(board.query("SELECT name, photo_url FROM todo_people")));
  toastSink.push = null;

  view.unmount();

  // What was kept comes back on the next mount.
  localStorage.setItem("redd-plan-todo-lang", "da");
  localStorage.setItem("redd-plan-todo-theme", "dark");
  localStorage.setItem("redd-plan-todo-zoom", "120");
  localStorage.setItem("redd-plan-todo-kanban", "1");
  localStorage.setItem("redd-plan-todo-column-order", "today,week,backlog");
  localStorage.setItem("redd-plan-todo-focus-mode", "1");
  const again = await page.mount();
  const da = makeT("da");
  check(
    "the language kept comes back",
    await until(() => $(".title-bar-settings-btn")?.title === da("settingsTooltip")),
    $(".title-bar-settings-btn")?.title
  );
  check("the theme kept comes back", await until(() => $(".todo-shell")?.dataset.theme === "dark"));
  check("the zoom kept comes back", await until(() => zoom() === "1.2"), zoom());
  const order = () => $$(".list-board > .board-column").map((el) => el.dataset.boardColumn).join();
  check("the column order kept comes back", await until(() => order() === "today,week,backlog"), order());
  check("focus mode kept comes back", await until(() => $(".todo-shell")?.classList.contains("focus-mode")));
  again.unmount();
  localStorage.setItem("redd-plan-todo-plan", "1");
  localStorage.setItem("redd-plan-todo-view", "plan");
  const third = await page.mount();
  check(
    "the view kept comes back",
    await until(() => $('.view-btn[data-view-id="plan"]')?.classList.contains("active"))
  );
  click($('.view-btn[data-view-id="lists"]'));
  check("a view chosen after the read-back is kept", await until(() => localStorage.getItem("redd-plan-todo-view") === "lists"));
  third.unmount();

  // More that the device keeps: the open list, the Someday column open,
  // the focus timer's switch, and the system's dark mode.
  const keep = (key, value) => localStorage.setItem(`redd-plan-todo-${key}`, value);
  keep("lang", "en");
  keep("focus-mode", "0");
  keep("kanban", "1");
  keep("someday-enabled", "1");
  keep("someday-expanded", "1");
  keep("focus-timer-always", "0");
  keep("current-list", list.id);
  keep("theme", "system");
  keep("view", "lists");
  const dark = { matches: true, listeners: [] };
  const originalMatch = window.matchMedia;
  window.matchMedia = () => ({
    get matches() {
      return dark.matches;
    },
    addEventListener: (_, fn) => dark.listeners.push(fn),
    removeEventListener: () => {},
  });
  const fourth = await page.mount();
  const open = () => $(`.tabs .tab[data-list-id="${list.id}"]`);
  check("the open list kept comes back", await until(() => open()?.classList.contains("active")));
  check("Someday kept open comes back open", await until(() => column("someday") && !column("someday").classList.contains("is-rail")));
  check("and Today a rail", column("today")?.classList.contains("is-rail"));
  check("the system's dark mode is followed", await until(() => $(".todo-shell")?.dataset.theme === "dark"));
  dark.matches = false;
  for (const fn of dark.listeners) fn({ matches: false });
  check("and its change", await until(() => $(".todo-shell")?.dataset.theme === undefined));
  await openSettings();
  check("the focus timer's switch kept comes back", settingsSwitchState(t("alwaysShowFocusTimer"), false));
  await closeSettings();
  fourth.unmount();
  window.matchMedia = originalMatch;

  // Groups: the switch and the open group; and a first mount decides
  // Board View once, and keeps it.
  const home = (await call("/api/todo/groups", "POST", { name: "Home" })).group;
  const away = (await call("/api/todo/groups", "POST", { name: "Away" })).group;
  void home;
  keep("groups", "1");
  keep("current-group", away.id);
  localStorage.removeItem("redd-plan-todo-kanban");
  const fifth = await page.mount();
  const groupTab = (name) => $$(".group-tab").find((el) => el.textContent.startsWith(name));
  check("groups kept on come back", await until(() => Boolean(groupTab("Away"))));
  check("with the open group", await until(() => groupTab("Away")?.classList.contains("active")));
  check("Board View is decided on the first mount, and kept", await until(() => localStorage.getItem("redd-plan-todo-kanban") !== null));
  fifth.unmount();
  for (const key of [
    "lang",
    "theme",
    "zoom",
    "column-order",
    "focus-mode",
    "plan",
    "view",
    "kanban",
    "someday-enabled",
    "someday-expanded",
    "focus-timer-always",
    "current-list",
    "groups",
    "current-group",
  ]) {
    localStorage.removeItem(`redd-plan-todo-${key}`);
  }
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete proto[key];
  }
}

/** Whether the switch of this settings row is as said. Settings is open. */
function settingsSwitchState(label, on) {
  const box = settingsSwitch(label);
  return box ? box.checked === on : false;
}
