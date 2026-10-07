/**
 * Board View: the columns, each column's order, carrying a card to another
 * column, to another place in its column and to another list's tab,
 * carrying a column, the Today session, and the two layouts of a small
 * tile.
 *
 * happy-dom lays nothing out, so the walk says where things are: each row
 * a box by its place in its column, and the point under the pointer by what
 * the step aims at (see stubBoxes and stubPointAt).
 *
 * Run in both flavours: mounted-board and mounted-board-planner. Every list
 * and task is invented.
 */

import { check } from "./harness.mjs";
import {
  $,
  $$,
  cardOf,
  click,
  drag,
  press,
  settle,
  stubBoxes,
  stubPointAt,
  text,
  until,
} from "./page-walk.mjs";

const column = (name) => $(`.list-board > .board-column[data-board-column="${name}"]`);
const wordsIn = (name) =>
  $$(`.list-board > .board-column[data-board-column="${name}"] .board-column-tasks > .task-item .task-text`).map(
    (el) => el.textContent
  );

/** Each row a box by its place in its column; each tab a box in a row. */
function layOut() {
  return stubBoxes((el) => {
    if (el.classList?.contains("task-item")) {
      const rows = Array.from(el.parentElement?.children ?? []).filter((r) =>
        r.classList.contains("task-item")
      );
      return { left: 0, top: 100 + rows.indexOf(el) * 40, width: 200, height: 30 };
    }
    if (el.classList?.contains("tab")) {
      const tabs = Array.from(el.parentElement?.children ?? []);
      return { left: tabs.indexOf(el) * 100, top: 0, width: 90, height: 24 };
    }
    return null;
  });
}

async function pickSort(columnName, label) {
  click(column(columnName).querySelector(".board-sort-btn"));
  const open = await until(() => Boolean($(".board-sort-menu")));
  const item = $$(".board-sort-menu .board-sort-item").find((b) => b.textContent.includes(label));
  if (open && item) click(item);
  await until(() => !$(".board-sort-menu"));
}

export async function walkBoard(page) {
  const { makeT } = await import("@/lib/todo/i18n");
  const t = makeT("en");
  const { board, call } = page;
  const row = (words) =>
    board.query("SELECT * FROM todo_tasks WHERE text = ?", [words])[0] ?? null;

  const yard = (await call("/api/todo/lists", "POST", { name: "Yard" })).list;
  const shed = (await call("/api/todo/lists", "POST", { name: "Shed" })).list;
  const add = (text, flags = {}) => call("/api/todo/tasks", "POST", { listId: yard.id, text, ...flags });
  const zoe = (await call("/api/todo/people", "POST", { name: "Zoe Park", sourceKind: "manual" })).person;
  const abe = (await call("/api/todo/people", "POST", { name: "Abe Lin", sourceKind: "manual" })).person;
  const gate = (await add("Paint the gate", { assigneeIds: [zoe.id] })).task;
  // A step Zoe holds, for the question when she is taken off the task.
  await add("Sand the gate", { parentTaskId: gate.id, assigneeIds: [zoe.id] });
  await add("Fix the tap", { assigneeIds: [abe.id] });
  await add("Call the plumber", { isToday: true, expectedDurationMinutes: 30 });
  const pots = (await add("Water the pots", { isToday: true })).task;
  // Two steps for the Today session to tick.
  await add("Fill the can", { parentTaskId: pots.id });
  await add("Carry it out", { parentTaskId: pots.id });
  await add("Buy seeds", { isBacklog: true });
  await add("Order bricks", { isBacklog: true });

  const proto = window.HTMLElement.prototype;
  const originals = ["offsetWidth", "offsetHeight"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(proto, key),
  ]);
  const size = (width, height) => {
    Object.defineProperty(window.HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => width });
    Object.defineProperty(window.HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => height });
  };
  // happy-dom lays nothing out, so every width is 0: a tile too small for
  // anything. The shell says it is a wide window.
  size(1400, 900);
  localStorage.setItem("redd-plan-todo-kanban", "1");
  localStorage.setItem("redd-plan-todo-assign-enabled", "1");
  const undoLayout = layOut();
  let view = await page.mount();
  check("the board is drawn", await until(() => Boolean($(".list-board"))), text().slice(0, 200));
  check(
    "three columns stand",
    await until(() => ["backlog", "week", "today"].every((c) => Boolean(column(c))))
  );
  check(
    "each task is in its column",
    await until(
      () =>
        wordsIn("today").includes("Call the plumber") &&
        wordsIn("backlog").includes("Buy seeds") &&
        wordsIn("week").includes("Paint the gate")
    ),
    JSON.stringify({ today: wordsIn("today"), week: wordsIn("week"), backlog: wordsIn("backlog") })
  );
  check("a column is named", column("today").querySelector(".board-column-title")?.textContent === t("boardToday"));
  const weekAside = t("boardThisWeek").match(/\(([^)]*)\)$/);
  check(
    "an aside in brackets in a column's name is drawn apart",
    !weekAside || column("week").querySelector(".board-column-title .board-label-aside")?.textContent === weekAside[0]
  );
  check(
    "a column counts its tasks",
    column("today").querySelector(".board-column-count")?.textContent === "2"
  );

  // Each column's order, from its header.
  check(
    "a column is in due-date order at first",
    column("week").querySelector(".board-sort-label")?.textContent === t("sortDue")
  );
  await pickSort("week", t("sortAlpha"));
  check(
    "Alphabetical puts the column in A to Z",
    await until(() => wordsIn("week").join() === "Fix the tap,Paint the gate"),
    wordsIn("week").join()
  );
  await pickSort("week", t("sortAlpha"));
  check(
    "Alphabetical again turns it round",
    await until(() => wordsIn("week").join() === "Paint the gate,Fix the tap"),
    wordsIn("week").join()
  );
  await pickSort("week", t("sortAssignee"));
  check(
    "Assignee puts the column in the order of the people's names",
    await until(() => wordsIn("week").join() === "Fix the tap,Paint the gate"),
    wordsIn("week").join()
  );
  await pickSort("week", t("sortAlpha"));
  await pickSort("week", t("sortAlpha"));
  await until(() => wordsIn("week").join() === "Paint the gate,Fix the tap");
  const saved = JSON.parse(localStorage.getItem("redd-plan-todo-column-sort-2") ?? "{}");
  check(
    "the order is kept on the device",
    saved.week?.sort === "alpha" && saved.week?.desc === true,
    JSON.stringify(saved)
  );
  check("the other columns keep theirs", saved.today?.sort === "due");

  // Carry "Buy seeds" from the backlog into Today, to its foot.
  let aim = null;
  const undoPoint = stubPointAt(() => aim);
  aim = column("today").querySelector(".board-column-tasks");
  await drag(cardOf("Buy seeds"), { x: 10, y: 110 }, { x: 400, y: 900 });
  check(
    "a card carried to Today is saved there",
    await until(() => row("Buy seeds")?.is_today === 1 && row("Buy seeds")?.is_backlog === 0),
    JSON.stringify({ today: row("Buy seeds")?.is_today, backlog: row("Buy seeds")?.is_backlog })
  );
  check(
    "and drawn there, last",
    await until(() => wordsIn("today").at(-1) === "Buy seeds"),
    wordsIn("today").join()
  );
  check(
    "a card from another column leaves the column on due date",
    column("today").querySelector(".board-sort-label")?.textContent === t("sortDue"),
    column("today").querySelector(".board-sort-label")?.textContent
  );

  // Carry it to the top of Today.
  aim = column("today").querySelector(".board-column-tasks");
  const seedsTop = wordsIn("today").indexOf("Buy seeds");
  await drag(cardOf("Buy seeds"), { x: 10, y: 100 + seedsTop * 40 + 10 }, { x: 10, y: 90 });
  check(
    "a card carried up its column is saved above the others",
    await until(
      () =>
        row("Buy seeds").position < row("Call the plumber").position &&
        row("Buy seeds").position < row("Water the pots").position
    ),
    JSON.stringify(board.query("SELECT text, position FROM todo_tasks WHERE is_today = 1"))
  );
  check(
    "and drawn first",
    await until(() => wordsIn("today")[0] === "Buy seeds"),
    wordsIn("today").join()
  );
  check(
    "a card carried inside its column puts the column on Manual",
    await until(() => column("today").querySelector(".board-sort-label")?.textContent === t("sortManual")),
    column("today").querySelector(".board-sort-label")?.textContent
  );

  // Carry a card onto the tab of another list.
  aim = $(`.tabs .tab[data-list-id="${shed.id}"]`);
  await drag(cardOf("Order bricks"), { x: 10, y: 110 }, { x: 150, y: 10 });
  check(
    "a card let go on a tab moves to that list",
    await until(() => row("Order bricks")?.list_id === shed.id),
    JSON.stringify(row("Order bricks"))
  );
  check("and keeps its column", row("Order bricks")?.is_backlog === 1);

  // Carry a tab: Shed to the front of the row, before Yard.
  const tabOrder = () =>
    $$(".tabs .tab[data-list-id]").map((el) => el.querySelector(".tab-name")?.textContent).join();
  aim = null;
  const shedTab = $(`.tabs .tab[data-list-id="${shed.id}"]`);
  const shedAt = $$(".tabs > *").indexOf(shedTab) * 100 + 40;
  await drag(shedTab, { x: shedAt, y: 10 }, { x: 5, y: 10 });
  const listRow = (id) => board.query("SELECT position FROM todo_lists WHERE id = ?", [id])[0];
  check(
    "a tab carried to the front is saved before the other",
    await until(() => listRow(shed.id).position < listRow(yard.id).position),
    JSON.stringify({ shed: listRow(shed.id), yard: listRow(yard.id) })
  );
  check("and drawn there", await until(() => tabOrder().endsWith("Shed,Yard")), tabOrder());

  // Carry a column by its heading: Today to where the Backlog stands.
  aim = column("backlog");
  const heading = column("today").querySelector(".board-column-header");
  heading.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 500, clientY: 50 })
  );
  for (const x of [480, 300, 100]) {
    window.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: 50 }));
    await settle(20);
  }
  window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 100, clientY: 50 }));
  const order = () =>
    $$(".list-board > .board-column").map((el) => el.dataset.boardColumn).join();
  check("a column carried by its heading moves", await until(() => order() === "today,backlog,week"), order());
  check(
    "the column order is kept on the device",
    localStorage.getItem("redd-plan-todo-column-order") === "today,backlog,week",
    localStorage.getItem("redd-plan-todo-column-order")
  );
  undoPoint();

  // The Today session, on the column as it stands.
  click(column("today").querySelector(".board-start-btn"));
  check("Start opens the Today session", await until(() => Boolean($(".today-session"))));
  // The task in hand carries the board card's controls, in the board's places.
  const now = $(".today-session-now");
  check("the task in hand has the board's corner pill", Boolean(now?.querySelector(":scope > .task-utility-pill .task-expand-btn")));
  check("and its row of chips under Skip and the clock", Boolean(now?.querySelector(":scope > .today-session-now-actions ~ .task-meta-row .task-meta-chips")));
  check(
    "a task waiting has the same pill and chips",
    Boolean($(".today-session-queue .today-session-task.task-item > .task-utility-pill") && $(".today-session-queue .today-session-task.task-item > .task-meta-row .task-meta-chips"))
  );
  // The list chip opens its picker in the session. The board card behind
  // drew a second picker, and the two closed each other at once.
  click(now?.querySelector(".task-list-origin"));
  check("the list chip in the session opens its picker", await until(() => $$(".task-list-picker").length === 1), $$(".task-list-picker").length);
  document.body.click();
  await until(() => !$(".task-list-picker"));
  const running = () => $(".today-session-now-title")?.textContent;
  check("the first task is in hand", await until(() => running() === "Buy seeds"), running());
  click($(".today-session-skip"));
  check("Skip takes the next one", await until(() => running() === "Call the plumber"), running());
  check(
    "and puts the skipped one last in Today on the board too",
    await until(() => row("Buy seeds")?.position > row("Water the pots")?.position, 5000),
    JSON.stringify({ seeds: row("Buy seeds")?.position, pots: row("Water the pots")?.position })
  );
  click($(".today-session-now-check"));
  check(
    "the tick in the session is saved",
    await until(() => row("Call the plumber")?.completed === 1, 5000)
  );
  check("the session goes on to the next", await until(() => running() === "Water the pots", 5000), running());
  // Its steps: a tick is saved, and the freshest tick goes on top of the
  // done pile.
  const stepCheck = (words) =>
    $$(".today-session-subtasks .task-subtask-check").find((el) => el.getAttribute("aria-label") === words);
  check("the task's steps show in the session", await until(() => Boolean(stepCheck("Fill the can") && stepCheck("Carry it out"))));
  click(stepCheck("Fill the can"));
  check("a step ticked in the session is saved", await until(() => row("Fill the can")?.completed === 1, 5000));
  await until(() => !stepCheck("Fill the can"));
  click(stepCheck("Carry it out"));
  check(
    "the step ticked last goes on top of the done pile",
    await until(() => row("Carry it out")?.completed === 1 && row("Carry it out").position < row("Fill the can").position, 5000),
    JSON.stringify({ fill: row("Fill the can")?.position, carry: row("Carry it out")?.position })
  );
  click($(".today-session-esc"));
  check("Esc leaves the session", await until(() => !$(".today-session")));

  // People from the card's chip: one put on, the menu put away, and one
  // taken off who holds a step, which is asked first.
  const people = (words) =>
    board
      .query(
        "SELECT a.person_id FROM todo_task_assignees a JOIN todo_tasks t ON t.id = a.task_id WHERE t.text = ?",
        [words]
      )
      .map((row) => row.person_id)
      .sort()
      .join();
  const chip = () => cardOf("Paint the gate")?.querySelector(".task-chip-assign");
  const menuItem = (name) => $$(".assign-menu-portal .assign-menu-item").find((el) => el.textContent.includes(name));
  click(chip());
  check("the chip opens the people menu", await until(() => Boolean(menuItem("Abe"))));
  click(menuItem("Abe"));
  check("a person picked is put on the task", await until(() => people("Paint the gate") === [abe.id, zoe.id].sort().join()));
  check("and the menu stays up for another", Boolean($(".assign-menu-portal")));
  $(".assign-menu-portal").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  check("Escape puts the menu away", await until(() => !$(".assign-menu-portal")));
  check("and gives the caret back to the chip", document.activeElement?.classList.contains("task-chip-assign"));
  click(chip());
  await until(() => Boolean(menuItem("Zoe")));
  click(menuItem("Zoe"));
  check("taking off a person who holds a step asks first", await until(() => Boolean($(".delete-confirm-btn"))));
  click($(".delete-confirm-btn"));
  check("yes takes her off the task", await until(() => people("Paint the gate") === abe.id), people("Paint the gate"));
  check("and off the step", await until(() => people("Sand the gate") === ""), people("Sand the gate"));
  // The people menu leads to the people editor, which lists the board's people.
  click(chip());
  await until(() => Boolean($(".assign-menu-portal .assign-edit")));
  click($(".assign-menu-portal .assign-edit"));
  check("the people menu opens the people editor", await until(() => Boolean($(".people-editor"))));
  const editorSays = () => $(".people-editor")?.textContent ?? "";
  check("which lists the board's people", editorSays().includes("Zoe P.") && editorSays().includes("Abe L."), editorSays().slice(0, 200));
  click($(".people-editor-done"));
  check("Done puts it away", await until(() => !$(".people-editor")));

  // The length chip of a card opens the length popover.
  click(cardOf("Paint the gate").querySelector(".task-chip-duration"));
  check("the length chip opens its popover", await until(() => Boolean($(".duration-popover"))));
  press(window, "Escape");
  await until(() => !$(".duration-popover"));
  view.unmount();
  undoLayout();

  // The window is made narrow while the page is open: the shell is
  // watched, and the board stacks without a new mount.
  const OriginalObserver = globalThis.ResizeObserver;
  const watchers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      watchers.push(this);
    }
    unobserve() {}
    disconnect() {
      watchers.splice(watchers.indexOf(this), 1);
    }
  };
  view = await page.mount();
  const shellClasses = () => $(".todo-shell")?.className ?? "";
  check("a wide shell has no narrow classes", await until(() => Boolean(column("today"))) && !/todo-w-/.test(shellClasses()), shellClasses());
  check("a wide board has no folded sections", $$(".list-board .board-column.is-folded").length === 0);
  size(700, 900);
  for (const watcher of [...watchers]) watcher.callback([]);
  check(
    "made narrow, the shell takes the classes of its width",
    await until(() => /todo-w-stack/.test(shellClasses()) && /todo-w-narrow/.test(shellClasses())) &&
      !/todo-w-tight/.test(shellClasses()),
    shellClasses()
  );
  check("and the board stacks", await until(() => $$(".list-board .board-column.is-folded").length > 0));
  view.unmount();
  globalThis.ResizeObserver = OriginalObserver;

  // A small tile: short, the sections are pills; tall, an accordion.
  size(600, 400);
  view = await page.mount();
  check("a short narrow tile draws the sections as pills", await until(() => Boolean($(".board-pills"))));
  check(
    "one section is open, Today at first",
    $$(".list-board > .board-column").length === 1 && Boolean(column("today"))
  );
  const pill = (name) => $(`.board-pills [data-board-column="${name}"]`);
  click(pill("week"));
  check("a pill opens its section", await until(() => Boolean(column("week")) && !column("today")));
  check("the open section is kept", localStorage.getItem("redd-plan-todo-tile-open-column") === "week");
  view.unmount();

  size(600, 900);
  view = await page.mount();
  check("a tall narrow tile is an accordion", await until(() => $$(".list-board .board-column.is-folded").length > 0));
  check(
    "the section left open stays open",
    await until(() => column("week") && !column("week").classList.contains("is-folded"))
  );
  click(column("backlog").querySelector(".board-column-header"));
  check(
    "a folded heading opens its section",
    await until(() => !column("backlog").classList.contains("is-folded") && column("week").classList.contains("is-folded"))
  );
  view.unmount();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete proto[key];
  }
}
