/**
 * The pointer drag, where the other walks do not go: a press that does
 * not move far enough, a press on a button in a card, a finger that has
 * to hold before it carries, the page scrolling under a carried card, a
 * drag the browser calls off, and the click that ends a carried tab.
 *
 * happy-dom lays nothing out, so the walk says where things are (see
 * stubBoxes and stubPointAt).
 *
 * Run in both flavours: mounted-drag and mounted-drag-planner. Every list
 * and task is invented.
 */

import { check } from "./harness.mjs";
import {
  $,
  $$,
  cardOf,
  click,
  drag,
  holdWrites,
  press,
  pressCmd,
  settle,
  sleep,
  stubBoxes,
  stubPointAt,
  text,
  typeInto,
  until,
} from "./page-walk.mjs";

const pointer = (target, type, extra = {}) =>
  target.dispatchEvent(
    new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", ...extra })
  );
const carried = (words) => Boolean(cardOf(words)?.classList.contains("dragging"));
const wordsIn = (name) =>
  $$(`.list-board > .board-column[data-board-column="${name}"] .board-column-tasks > .task-item .task-text`).map(
    (el) => el.textContent
  );

export async function walkDrag(page) {
  const { board, call } = page;
  const row = (words) => board.query("SELECT * FROM todo_tasks WHERE text = ?", [words])[0] ?? null;

  const porch = (await call("/api/todo/lists", "POST", { name: "Porch" })).list;
  const deck = (await call("/api/todo/lists", "POST", { name: "Deck" })).list;
  for (const words of ["Sweep the steps", "Hang the bell", "Paint the rail", "Fix the light"]) {
    // One task in Today, so the plain list has two sections.
    await call("/api/todo/tasks", "POST", { listId: porch.id, text: words, isToday: words === "Sweep the steps" });
  }

  const proto = window.HTMLElement.prototype;
  const originals = ["offsetWidth", "offsetHeight"].map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)]);
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get: () => 1400 });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => 900 });
  localStorage.setItem("redd-plan-todo-kanban", "0");
  const undoBoxes = stubBoxes((el) => {
    if (el.classList?.contains("task-item")) {
      const rows = Array.from(el.parentElement?.children ?? []).filter((r) => r.classList.contains("task-item"));
      return { left: 0, top: 100 + rows.indexOf(el) * 40, width: 200, height: 30 };
    }
    if (el.classList?.contains("tab")) {
      const tabs = Array.from(el.parentElement?.children ?? []);
      return { left: tabs.indexOf(el) * 100, top: 0, width: 90, height: 24 };
    }
    return null;
  });
  let aim = null;
  const undoPoint = stubPointAt(() => aim);
  const view = await page.mount();
  click(await (async () => {
    await until(() => Boolean($(`.tabs .tab[data-list-id="${porch.id}"]`)));
    return $(`.tabs .tab[data-list-id="${porch.id}"]`);
  })());
  check("the list paints", await until(() => Boolean(cardOf("Fix the light"))), text().slice(0, 200));
  await settle();

  // A press that moves less than 4 pixels is a click, not a carry.
  const card = () => cardOf("Hang the bell");
  pointer(card(), "pointerdown", { clientX: 10, clientY: 150 });
  pointer(window, "pointermove", { clientX: 12, clientY: 152 });
  await settle(50);
  check("a small move does not lift the card", !carried("Hang the bell"));
  pointer(window, "pointermove", { clientX: 10, clientY: 160 });
  check("a move of 4 pixels or more does", await until(() => carried("Hang the bell")));
  pointer(window, "pointerup", { clientX: 10, clientY: 160 });
  check("letting go puts it down", await until(() => !carried("Hang the bell")));

  // A press on a button in a card is the button's.
  const button = card().querySelector("button");
  check("a card has a button", Boolean(button));
  pointer(button, "pointerdown", { clientX: 150, clientY: 150 });
  pointer(window, "pointermove", { clientX: 150, clientY: 250 });
  await settle(50);
  check("a press on a button does not lift the card", !carried("Hang the bell"));
  pointer(window, "pointerup", { clientX: 150, clientY: 250 });
  await settle();

  // A finger: moving first is a scroll, holding first is a carry.
  pointer(card(), "pointerdown", { pointerType: "touch", clientX: 10, clientY: 150 });
  pointer(window, "pointermove", { pointerType: "touch", clientX: 10, clientY: 162 });
  await sleep(450);
  check("a finger that moves before the hold scrolls the list", !carried("Hang the bell"));
  pointer(window, "pointerup", { pointerType: "touch", clientX: 10, clientY: 162 });
  pointer(card(), "pointerdown", { pointerType: "touch", clientX: 10, clientY: 150 });
  await sleep(100);
  check("a short hold is not yet a carry", !carried("Hang the bell"));
  check("a finger that holds lifts the card", await until(() => carried("Hang the bell"), 1000));
  const touch = new window.Event("touchmove", { cancelable: true });
  window.dispatchEvent(touch);
  check("while a card is carried, the finger does not scroll the page", touch.defaultPrevented);

  // The browser calls the drag off: the card is put down.
  pointer(window, "pointercancel", { pointerType: "touch", clientX: 10, clientY: 150 });
  check("a drag the browser calls off puts the card down", await until(() => !carried("Hang the bell")));
  const after = new window.Event("touchmove", { cancelable: true });
  window.dispatchEvent(after);
  check("and the finger scrolls again", !after.defaultPrevented);

  // What scrolls under a carried card scrolls when the card is near its edge.
  const list = card().parentElement;
  let scrollTop = 200;
  Object.defineProperty(list, "scrollTop", { configurable: true, get: () => scrollTop, set: (v) => (scrollTop = v) });
  Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 2000 });
  Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 400 });
  list.style.overflowY = "auto";
  const undoListBox = stubBoxes((el) => (el === list ? { left: 0, top: 100, width: 200, height: 400 } : null));
  aim = list;
  pointer(card(), "pointerdown", { clientX: 10, clientY: 150 });
  pointer(window, "pointermove", { clientX: 10, clientY: 300 });
  await sleep(80);
  check("in the middle nothing scrolls", scrollTop === 200, scrollTop);
  pointer(window, "pointermove", { clientX: 10, clientY: 495 });
  check("near the foot it scrolls down", await until(() => scrollTop > 220, 1000), scrollTop);
  pointer(window, "pointermove", { clientX: 10, clientY: 105 });
  const high = scrollTop;
  check("near the top it scrolls up", await until(() => scrollTop < high - 20, 1000), scrollTop);
  pointer(window, "pointerup", { clientX: 10, clientY: 105 });
  const stopped = scrollTop;
  await sleep(80);
  check("letting go stops the scroll", scrollTop === stopped, `${stopped} -> ${scrollTop}`);
  undoListBox();
  aim = null;
  await settle();

  // A drop in the plain list (Board View off) is saved. The rows stand
  // 40 pixels apart from 100 down, in the order the list draws them. The
  // scroll above let "Hang the bell" go at the top, over the Today task,
  // so it went into Today.
  const listWords = () => $$(".tasks-container > .task-item .task-text").map((el) => el.textContent).join("|");
  check(
    "the plain list: Today first, then the week",
    listWords() === "Hang the bell|Sweep the steps|Paint the rail|Fix the light" &&
      row("Hang the bell").is_today === 1,
    listWords()
  );
  // Within the week: "Fix the light" up, over "Paint the rail". The row
  // above is in Today, the row below in the week, as the card is.
  await drag(cardOf("Fix the light"), { x: 10, y: 220 }, { x: 10, y: 175 });
  check(
    "a card carried within its section takes the new place",
    await until(() => row("Fix the light").position < row("Paint the rail").position),
    JSON.stringify(["Fix the light", "Paint the rail"].map((w) => row(w)?.position))
  );
  check("and stays in its section", row("Fix the light").is_today === 0);
  await settle();
  // To the top: over a Today task, so into Today.
  await drag(cardOf("Paint the rail"), { x: 10, y: 220 }, { x: 10, y: 105 });
  check(
    "a card carried into another section joins it, at that place",
    await until(() => row("Paint the rail").is_today === 1 && row("Paint the rail").position < row("Hang the bell").position),
    JSON.stringify({ today: row("Paint the rail")?.is_today, pos: row("Paint the rail")?.position, hang: row("Hang the bell")?.position })
  );
  check(
    "the list draws it there",
    await until(() => listWords() === "Paint the rail|Hang the bell|Sweep the steps|Fix the light"),
    listWords()
  );
  await settle();

  // The click that ends a carried tab does not also open the tab.
  const deckTab = () => $(`.tabs .tab[data-list-id="${deck.id}"]`);
  const deckAt = $$(".tabs > *").indexOf(deckTab()) * 100 + 40;
  const tabOrder = () => $$(".tabs .tab[data-list-id]").map((el) => el.dataset.listId).filter((id) => id !== "__all__").join();
  const holdLists = holdWrites(/^\s*UPDATE todo_lists/i, 1500);
  await drag(deckTab(), { x: deckAt, y: 10 }, { x: 5, y: 10 });
  click(deckTab());
  await settle(50);
  check("the tabs stay in the new order while the save is on its way", tabOrder() === `${deck.id},${porch.id}`, tabOrder());
  holdLists();
  check("the click at the end of a carry does not open the tab", !deckTab().classList.contains("active"));
  const listRow = (id) => board.query("SELECT position FROM todo_lists WHERE id = ?", [id])[0];
  check("and the carry is saved", await until(() => listRow(deck.id).position < listRow(porch.id).position));
  await sleep(300);
  click(deckTab());
  check("a click a moment later opens it", await until(() => deckTab().classList.contains("active")));
  check("no task moved in all this", row("Hang the bell")?.list_id === porch.id);

  view.unmount();

  // On the board.
  localStorage.setItem("redd-plan-todo-kanban", "1");
  localStorage.setItem("redd-plan-todo-someday-enabled", "1");
  const yard = (await call("/api/todo/lists", "POST", { name: "Yard" })).list;
  for (const words of ["Rake the lawn", "Buy milk", "Mow the grass", "Trim the hedge"]) {
    await call("/api/todo/tasks", "POST", { listId: yard.id, text: words });
  }
  await call("/api/todo/tasks", "POST", { listId: yard.id, text: "Stack the logs", isBacklog: true });
  const onBoard = await page.mount();
  const column = (name) => $(`.list-board > .board-column[data-board-column="${name}"]`);
  await until(() => Boolean($(`.tabs .tab[data-list-id="${yard.id}"]`)));
  click($(`.tabs .tab[data-list-id="${yard.id}"]`));
  check("the board is drawn", await until(() => Boolean(column("week")) && Boolean(cardOf("Stack the logs"))), text().slice(0, 200));
  await settle();

  // Tabs under a carried card: another list's tab is a drop, the card's
  // own tab and the All tab are not.
  const tab = (id) => $(`.tabs .tab[data-list-id="${id}"]`);
  const before = wordsIn("week").join();
  aim = column("week").querySelector(".board-column-tasks");
  pointer(cardOf("Trim the hedge"), "pointerdown", { clientX: 10, clientY: 230 });
  pointer(window, "pointermove", { clientX: 10, clientY: 105 });
  check("mid-carry the card is drawn where it would go", await until(() => wordsIn("week")[0] === "Trim the hedge"), wordsIn("week").join());
  aim = tab(yard.id);
  pointer(window, "pointermove", { clientX: 10, clientY: 104 });
  await settle(50);
  check("over its own tab, no drop is offered", !cardOf("Trim the hedge").classList.contains("drag-over-tab"));
  aim = tab(deck.id);
  pointer(window, "pointermove", { clientX: 10, clientY: 103 });
  check("over another list's tab, the drop is offered", await until(() => cardOf("Trim the hedge").classList.contains("drag-over-tab")));
  check("and the list is drawn as it was", await until(() => wordsIn("week").join() === before), wordsIn("week").join());
  aim = tab("__all__");
  pointer(window, "pointermove", { clientX: 10, clientY: 102 });
  check("over the All tab, no drop is offered", await until(() => !cardOf("Trim the hedge").classList.contains("drag-over-tab")));
  pointer(window, "pointerup", { clientX: 10, clientY: 102 });
  aim = null;
  await settle();
  check("let go on the All tab, the card stays in its list", row("Trim the hedge")?.list_id === yard.id);
  // After a drop the list follows the board again: a new task shows.
  const composer = column("week").querySelector("input.task-composer-input") ?? $("input.task-composer-input");
  typeInto(composer, "Oil the gate");
  press(composer, "Enter");
  check("a task added after a drop is drawn", await until(() => text().includes("Oil the gate")), text().slice(0, 300));
  await settle();

  // Carried over no column, a card keeps its own.
  aim = null;
  await drag(cardOf("Stack the logs"), { x: 10, y: 110 }, { x: 10, y: 140 });
  await settle(100);
  check("a card let go over no column keeps its column", row("Stack the logs")?.is_backlog === 1 && row("Stack the logs")?.is_today === 0, JSON.stringify(row("Stack the logs")));

  // A search hides a row; a drop is placed in the whole column.
  pressCmd(window, "f");
  await until(() => Boolean($(".list-search-inner.open")));
  typeInto($("input.list-search-input"), "the");
  check("the search hides a row", await until(() => !cardOf("Buy milk") && Boolean(cardOf("Trim the hedge"))));
  aim = column("week").querySelector(".board-column-tasks");
  await drag(cardOf("Trim the hedge"), { x: 10, y: 190 }, { x: 10, y: 130 });
  const pos = (words) => row(words)?.position;
  check(
    "a card put between two rows goes straight after the upper one, before the hidden row",
    await until(() => pos("Rake the lawn") < pos("Trim the hedge") && pos("Trim the hedge") < pos("Buy milk")),
    JSON.stringify(board.query("SELECT text, position FROM todo_tasks WHERE list_id = ? ORDER BY position", [yard.id]))
  );
  press(window, "Escape");
  await until(() => !$(".list-search-inner.open"));
  await settle();

  // A card let go on the Someday rail goes to Someday; the rail stays a rail.
  check("Someday is a rail", await until(() => column("someday")?.classList.contains("is-rail")));
  aim = column("someday");
  await drag(cardOf("Mow the grass"), { x: 10, y: 150 }, { x: 900, y: 150 });
  // The browser ends a carry with a click where it was let go.
  click(column("someday"));
  check("the card goes to Someday", await until(() => row("Mow the grass")?.is_someday === 1));
  await settle(50);
  check("and the click at the end of the carry does not open the rail", column("someday")?.classList.contains("is-rail"));
  aim = null;
  onBoard.unmount();
  localStorage.removeItem("redd-plan-todo-someday-enabled");
  localStorage.removeItem("redd-plan-todo-someday-expanded");
  undoPoint();
  undoBoxes();
  localStorage.removeItem("redd-plan-todo-kanban");
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(proto, key, descriptor);
    else delete proto[key];
  }
}
