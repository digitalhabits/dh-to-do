/**
 * The focus window on its own: the task switcher. The panel reads the
 * board through its `api` prop, so the walk hands it a board of its own.
 *
 * Run in both flavours: mounted-focus and mounted-focus-planner. Every
 * list and task is invented.
 */

import { check } from "./harness.mjs";
import {
  $,
  $$,
  click,
  installBroadcastChannel,
  mountPage,
  settle,
  typeInto,
  until,
} from "./page-walk.mjs";

const list = (id, name, position) => ({
  id,
  name,
  position,
  colour: null,
  emoji: null,
  groupId: null,
  basecampProjectId: null,
  basecampListId: null,
  remindersListId: null,
});

const task = (id, listId, text, flags = {}) => ({
  id,
  listId,
  text,
  notesHtml: null,
  completed: false,
  completedAt: null,
  position: 1,
  isFavourite: false,
  favouritePosition: null,
  isToday: false,
  isBacklog: false,
  isSomeday: false,
  dueOn: null,
  expectedDurationMinutes: null,
  timeSpentSeconds: 0,
  assigneeIds: [],
  parentTaskId: null,
  basecampId: null,
  remindersId: null,
  ...flags,
});

export async function walkFocus() {
  const { TodoFocusPanel } = await import("@/components/todo/TodoFocusPanel");
  installBroadcastChannel();
  const lists = [list("l-house", "House", 2), list("l-garden", "Garden", 1)];
  const tasks = [
    task("t-focus", "l-house", "Sweep the path"),
    task("t-dust", "l-house", "Dust the shelves"),
    task("t-water-house", "l-house", "Water the ferns", { isToday: true }),
    task("t-done", "l-house", "Water the cactus", { completed: true }),
    task("t-seeds", "l-garden", "Buy seeds"),
    task("t-water-garden", "l-garden", "Water the beds"),
  ];
  const calls = [];
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (path === "/api/todo/state") {
      return { state: { lists, groups: [], people: [], tasks } };
    }
    return {};
  };
  localStorage.setItem("redd-plan-todo-kanban", "0");
  const view = mountPage(TodoFocusPanel, {
    initialTaskId: "t-focus",
    initialTitle: "Sweep the path",
    api,
  });
  check("the panel reads the board", await until(() => calls.some((c) => c.path === "/api/todo/state")));
  await settle(50);

  click($(".switch-focus-task-btn"));
  check("the switcher opens", await until(() => Boolean($(".focus-task-switch-menu"))));
  const tabs = () => $$(".focus-task-switch-tab-name").map((el) => el.textContent.trim()).join();
  const active = () => $(".focus-task-switch-tab.active .focus-task-switch-tab-name")?.textContent.trim();
  const items = () => $$(".focus-task-switch-item").map((el) => el.textContent.trim());
  const itemsHave = (...words) => {
    const now = items();
    return now.length === words.length && words.every((w) => now.some((text) => text.includes(w)));
  };
  check("a tab for each list, in board order", tabs() === "Garden,House", tabs());
  check("it opens on the focused task's list", active() === "House", active());
  check(
    "the list's open tasks, not the done one and not the one in focus",
    itemsHave("Dust the shelves", "Water the ferns"),
    JSON.stringify(items())
  );
  click($$(".focus-task-switch-tab").find((el) => el.textContent.includes("Garden")));
  check("a tab shows its own list", await until(() => itemsHave("Buy seeds", "Water the beds")), JSON.stringify(items()));
  check("and is the active one", active() === "Garden", active());

  typeInto($(".focus-task-switch-search-input"), "water");
  const groups = () => $$(".focus-task-switch-group-label").map((el) => el.textContent.trim()).join();
  check("a search crosses the lists, the focused task's first", await until(() => groups() === "House,Garden"), groups());
  check("the tabs go while it searches", $$(".focus-task-switch-tab").length === 0);
  check("it finds the open tasks that match", itemsHave("Water the ferns", "Water the beds"), JSON.stringify(items()));

  click($$(".focus-task-switch-item").find((el) => el.textContent.includes("Water the beds")));
  check("a task picked is the one in focus", await until(() => !$(".focus-task-switch-menu") && document.body.textContent.includes("Water the beds")));

  // With Board View on, a list reads as the board does: named columns.
  localStorage.setItem("redd-plan-todo-kanban", "1");
  click($(".switch-focus-task-btn"));
  await until(() => Boolean($(".focus-task-switch-menu")));
  click($$(".focus-task-switch-tab").find((el) => el.textContent.includes("House")));
  check(
    "with the board on, the tasks come under its columns",
    await until(() => groups() === "Today,Soon (-ish)"),
    groups()
  );

  view.unmount();
}
