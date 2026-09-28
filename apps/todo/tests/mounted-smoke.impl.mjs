/**
 * The walk itself — see mounted-smoke.test.mjs for why it is two files.
 * Every list and task is invented.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import { installFakeBoard } from "./fake-board.mjs";
import { check, suite } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(20);
  }
  return false;
}
const text = () => document.body.textContent ?? "";

/** Type into a text box the way React hears it: the native setter, then input. */
function typeInto(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function press(el, key, extra = {}) {
  el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
}

suite(async () => {
  window.__TODO_PRODUCT_FLAVOR__ = "standalone";
  const board = await installFakeBoard();

  const { todoHostApi } = await import("@/lib/todo/standalone-api");
  const { TodoPage } = await import("@/components/todo/TodoPage");

  const { list } = await todoHostApi("/api/todo/lists", "POST", { name: "Garden" });
  for (const t of ["Plant the bulbs", "Mend the fence"]) {
    await todoHostApi("/api/todo/tasks", "POST", { listId: list.id, text: t });
  }

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(React.createElement(TodoPage, { initialState: null })));

  check(
    "the board paints the list's tasks",
    await until(() => text().includes("Plant the bulbs") && text().includes("Mend the fence")),
    text().slice(0, 300)
  );
  check("the list's tab is shown", text().includes("Garden"));
  // Add a task the way a reader does: type in the composer, press Enter.
  const composer = document.querySelector("input.task-composer-input");
  check("the composer is drawn", Boolean(composer));
  if (composer) {
    composer.focus();
    typeInto(composer, "Rake the leaves");
    press(composer, "Enter");
  }
  check("the new task is on the board", await until(() => text().includes("Rake the leaves")));
  const added = await until(
    () => board.query("SELECT text FROM todo_tasks WHERE text = ?", ["Rake the leaves"]).length === 1
  );
  check("the new task is saved once", added, JSON.stringify(board.query("SELECT text FROM todo_tasks")));
  check("no command other than SQL reached the shell", board.commands.length === 0, JSON.stringify(board.commands));

  root.unmount();
});
