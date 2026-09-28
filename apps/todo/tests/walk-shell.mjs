/**
 * The page in a desktop shell: the focus windows, which talk to the board
 * over a BroadcastChannel, Apple Reminders, which the board writes to as it
 * changes a linked list, and the Calendar view, whose script is a fake
 * PlanModule here.
 *
 * The shell is window.__TAURI__ over the fake board (see installShell).
 * Every command that is not SQL lands in `board.commands`.
 *
 * Run in both flavours: mounted-shell and mounted-shell-planner. Every
 * list and task is invented.
 */

import { check } from "./harness.mjs";
import {
  $,
  $$,
  cardOf,
  click,
  drag,
  installBroadcastChannel,
  installShell,
  press,
  settle,
  sleep,
  stubPointAt,
  text,
  typeInto,
  until,
} from "./page-walk.mjs";
import { settingsSwitch } from "./walk-lists.mjs";

const FOCUS_CHANNEL = "redd-plan-todo-focus";

/** A calendar script that records what the page asks of it. */
function installFakeCalendar() {
  for (const file of ["ical.js", "calendar-sync.js", "calendar-events.js", "plan.js"]) {
    const tag = document.createElement("script");
    tag.type = "text/plain";
    tag.dataset.reddDoCalendar = `/redd-do-calendar/${file}`;
    tag.dataset.loaded = "true";
    document.head.appendChild(tag);
  }
  const calls = [];
  const plan = {
    calls,
    options: null,
    init(el, options) {
      calls.push("init");
      plan.options = options;
    },
    destroy: () => calls.push("destroy"),
    setTasks: () => calls.push("setTasks"),
    setPeople: () => calls.push("setPeople"),
    setLinkableTasks: () => calls.push("setLinkableTasks"),
    setMe: () => calls.push("setMe"),
    setTaskTime: (...args) => calls.push(["setTaskTime", ...args]),
  };
  window.PlanModule = plan;
  return plan;
}

export async function walkShell(page) {
  const { makeT } = await import("@/lib/todo/i18n");
  const t = makeT("en");
  const { board, call } = page;
  const row = (words) =>
    board.query("SELECT * FROM todo_tasks WHERE text = ?", [words])[0] ?? null;
  const commands = (name) => board.commands.filter((c) => c.command === name);

  const channels = installBroadcastChannel();
  let reminderIds = 0;
  installShell({
    fetch_reminders_lists: [
      { id: "rem-errands", name: "Errands", groupName: null },
      { id: "rem-groceries", name: "Groceries", groupName: null },
    ],
    // A little time on the way, as EventKit takes: the page draws while
    // it waits.
    fetch_reminders_tasks: async ({ listId }) => {
      await sleep(20);
      return listId === "rem-errands"
        ? [
            {
              id: "rem-parcel",
              name: "Post the parcel",
              completed: false,
              notes: "",
              creationDate: 0,
              completionDate: 0,
              lastModifiedDate: 0,
              dueOn: null,
            },
          ]
        : [];
    },
    create_reminders_task: () => ({ id: `rem-new-${++reminderIds}` }),
  });
  const plan = installFakeCalendar();
  localStorage.setItem("redd-plan-todo-reminders", "1");

  const studio = (await call("/api/todo/lists", "POST", { name: "Studio" })).list;
  const made = (await call("/api/todo/lists", "POST", { name: "Errands" })).list;
  await call("/api/todo/lists", "PATCH", { id: made.id, remindersListId: "rem-errands" });
  const errands = { ...made, remindersListId: "rem-errands" };
  const add = async (listId, text) => (await call("/api/todo/tasks", "POST", { listId, text })).task;
  const tune = await add(studio.id, "Tune the piano");
  const dust = await add(studio.id, "Dust the shelves");
  const clock = await add(studio.id, "Wind the clock");
  const bell = await add(studio.id, "Polish the bell");
  await add(studio.id, "Oil the easel");
  await add(studio.id, "Sand the frame");
  const parcel = await add(errands.id, "Post the parcel");
  await call("/api/todo/tasks", "PATCH", { id: parcel.id, remindersId: "rem-parcel" });
  // A step: Reminders has no steps, so it is never sent there.
  await call("/api/todo/tasks", "POST", { listId: errands.id, text: "Weigh the parcel", parentTaskId: parcel.id });

  // A tick a focus window gave while no board was open.
  localStorage.setItem(
    "dh-todo-focus-pending-complete",
    JSON.stringify([{ taskId: clock.id, timeSpentSeconds: 120, at: Date.now() }])
  );

  const view = await page.mount({ appVersion: "9.9.9-walk" });
  check("the board paints", await until(() => Boolean(cardOf("Tune the piano"))), text().slice(0, 200));
  // The line at the foot belongs to the desktop app. The planner's tab
  // draws none.
  if (window.__TODO_PRODUCT_FLAVOR__ === "standalone") {
    check(
      "the desktop app has its footer, with the link",
      $(".footer a")?.getAttribute("href") === "https://digitalhabits.org"
    );
  } else {
    check("the planner's tab has no footer", !$(".footer"));
  }
  check(
    "a tick kept while no board was open is taken up",
    await until(() => row("Wind the clock")?.completed === 1),
    JSON.stringify({ completed: row("Wind the clock")?.completed })
  );
  check("and taken out of storage", !localStorage.getItem("dh-todo-focus-pending-complete"));

  // The focus windows.
  check("the page listens on the focus channel", await until(() => channels.openCount(FOCUS_CHANNEL) === 1));
  const focusBtn = (words) => cardOf(words)?.querySelector(".focus-btn");
  check("a card has a focus button in the shell", Boolean(focusBtn("Tune the piano")));
  click(focusBtn("Tune the piano"));
  check(
    "the focus button asks the shell for a window",
    await until(() => commands("open_focus_popout").some((c) => c.args.taskId === tune.id)),
    JSON.stringify(board.commands.map((c) => c.command))
  );
  check("and marks the task as in focus", await until(() => focusBtn("Tune the piano")?.classList.contains("active-focus")));

  const window1 = channels.channel(FOCUS_CHANNEL);
  window1.postMessage({ type: "focus-ended", taskId: tune.id });
  check("a window that ends takes the mark off", await until(() => !focusBtn("Tune the piano")?.classList.contains("active-focus")));
  window1.postMessage({ type: "focus-started", taskId: dust.id });
  check("a window that starts puts it on", await until(() => focusBtn("Dust the shelves")?.classList.contains("active-focus")));
  click(focusBtn("Dust the shelves"));
  check(
    "the button of a task in focus asks its window to close",
    await until(() =>
      channels.posts.some((p) => p.data.type === "focus-exit-request" && p.data.taskId === dust.id)
    )
  );

  await call("/api/todo/tasks", "PATCH", { id: tune.id, text: "Tune the old piano" });
  window1.postMessage({ type: "task-updated", taskId: tune.id });
  check("a window's change is read again", await until(() => Boolean(cardOf("Tune the old piano"))));

  // The window saves its time itself, then says the task is done.
  await call("/api/todo/tasks", "PATCH", { id: tune.id, timeSpentSeconds: 600 });
  window1.postMessage({ type: "task-complete", taskId: tune.id, timeSpentSeconds: 600 });
  check(
    "a window's tick completes the task",
    await until(() => row("Tune the old piano")?.completed === 1),
    JSON.stringify({ completed: row("Tune the old piano")?.completed })
  );
  check(
    "and the done row shows the window's time",
    await until(() => cardOf("Tune the old piano")?.textContent.includes("10m")),
    cardOf("Tune the old piano")?.textContent
  );
  // As the window really does it: it says the task is done first, and
  // saves its time after. The board's own write carries the time, so it
  // is kept even when the window's save comes late, or finds no task (a
  // task only the board holds).
  window1.postMessage({ type: "task-complete", taskId: bell.id, timeSpentSeconds: 900 });
  check(
    "a window's tick keeps the window's time, saved with the tick",
    await until(() => row("Polish the bell")?.completed === 1 && row("Polish the bell")?.time_spent_seconds === 900),
    JSON.stringify({ completed: row("Polish the bell")?.completed, spent: row("Polish the bell")?.time_spent_seconds })
  );
  check(
    "and the done row shows it",
    await until(() => cardOf("Polish the bell")?.textContent.includes("15m")),
    cardOf("Polish the bell")?.textContent
  );
  // The time it took, changed on the done row.
  const spent = cardOf("Tune the old piano")?.querySelector(".task-meta.actual-time");
  check("a done row's time can be clicked", Boolean(spent));
  if (spent) click(spent);
  const spentBox = await until(() => Boolean(cardOf("Tune the old piano")?.querySelector("input.task-duration-input")));
  check("and opens a box", spentBox);
  if (spentBox) {
    const box = cardOf("Tune the old piano").querySelector("input.task-duration-input");
    typeInto(box, "25");
    press(box, "Enter");
  }
  check(
    "the time it took is saved in seconds",
    await until(() => row("Tune the old piano")?.time_spent_seconds === 1500),
    JSON.stringify({ spent: row("Tune the old piano")?.time_spent_seconds })
  );

  click(cardOf("Dust the shelves").querySelector(".task-text"));
  if (await until(() => Boolean($("textarea.task-edit-input")))) {
    typeInto($("textarea.task-edit-input"), "Dust the top shelves");
    press($("textarea.task-edit-input"), "Enter");
  }
  check(
    "a change on the board is told to the windows",
    await until(() =>
      channels.posts.some(
        (p) => p.data.type === "board-task-changed" && p.data.task?.text === "Dust the top shelves"
      )
    )
  );

  click($(".title-bar-settings-btn"));
  await until(() => Boolean(settingsSwitch(t("alwaysShowFocusTimer"))));
  check("Settings says the app's version", $("#settings-modal")?.textContent.includes("9.9.9-walk"));
  settingsSwitch(t("alwaysShowFocusTimer")).click();
  check(
    "the focus timer switch is told to the windows",
    await until(() => channels.posts.some((p) => p.data.type === "focus-timer-pref" && p.data.always === false))
  );

  // The Calendar view.
  settingsSwitch(t("enablePlanMode")).click();
  click($("#settings-modal .cancel-btn"));
  await until(() => !$("#settings-modal"));
  click($('.view-btn[data-view-id="plan"]'));
  check("the Calendar view starts its script", await until(() => plan.calls.includes("init")));
  check("and gives it the tasks", plan.calls.includes("setTasks") || Array.isArray(plan.options?.tasks));
  const anchor = { left: 100, top: 100, bottom: 120 };
  // A note on the task, so its card has a notes chip.
  await call("/api/todo/tasks", "PATCH", { id: dust.id, notesHtml: "<div>top and back</div>" });
  // The page reads the board again when it comes back to the front, ten
  // seconds on: the clock is moved on by hand.
  const realNow = Date.now;
  Date.now = () => realNow() + 11_000;
  window.dispatchEvent(new window.Event("focus"));
  await settle(400);
  Date.now = realNow;
  plan.options.onTaskOpen(dust.id, anchor);
  check(
    "a task opened in the Calendar shows its card",
    await until(() => $(".calendar-task-popover")?.textContent.includes("Dust the top shelves"))
  );
  // The card stands under the task, in the zoomed shell's pixels.
  const place = () => $(".calendar-task-popover")?.style;
  // 10px under the task's bottom (120), less the 22px the popover keeps over
  // the card for its hover bubble: the card itself stands 10px under.
  check("the card stands under the task", place()?.top === "108px" && place()?.left === "100px", JSON.stringify({ top: place()?.top, left: place()?.left }));
  // While the card's note is open, Escape is not for the card.
  const notesChip = $(".calendar-task-popover .task-chip-notes, .calendar-task-popover .notes-btn");
  if (notesChip) click(notesChip);
  check("the card's note opens", await until(() => Boolean($(".calendar-task-popover .notes-container.open"))));
  press(window, "Escape");
  await settle(100);
  check("Escape leaves the card while its note is open", Boolean($(".calendar-task-popover")));
  const noteDone = $(".calendar-task-popover .notes-done-btn");
  if (noteDone) click(noteDone);
  await until(() => !$(".calendar-task-popover .notes-container.open"));
  press(window, "Escape");
  check("Escape puts the card away", await until(() => !$(".calendar-task-popover")));
  // Zoomed in, the same task's card is placed in the shell's pixels.
  click($(".title-bar-settings-btn"));
  await until(() => Boolean($(".zoom-in-btn")));
  click($(".zoom-in-btn"));
  click($("#settings-modal .cancel-btn"));
  await until(() => !$("#settings-modal"));
  await settle(600);
  plan.options.onTaskOpen(dust.id, anchor);
  await until(() => Boolean($(".calendar-task-popover")));
  check(
    "zoomed in, the card is placed in the shell's pixels",
    Math.abs(parseFloat(place()?.top) - (120 / 1.1 + 10 - 22)) < 0.01 && Math.abs(parseFloat(place()?.left) - 100 / 1.1) < 0.01,
    JSON.stringify({ top: place()?.top, left: place()?.left })
  );
  press(window, "Escape");
  await until(() => !$(".calendar-task-popover"));
  click($(".title-bar-settings-btn"));
  await until(() => Boolean($(".zoom-out-btn")));
  click($(".zoom-out-btn"));
  click($("#settings-modal .cancel-btn"));
  await until(() => !$("#settings-modal"));
  plan.options.onTaskDueChange(dust.id, "2026-10-02");
  check("a task moved in the Calendar is saved on its day", await until(() => row("Dust the top shelves")?.due_on === "2026-10-02"));
  plan.options.onTaskCreate({ dateKey: "2026-10-01", startMinutes: 600, anchor });
  const newBox = await until(() => Boolean($(".calendar-task-popover--new input.task-composer-input")));
  check("a double click on a day opens an add box", newBox);
  if (newBox) {
    const box = $(".calendar-task-popover--new input.task-composer-input");
    typeInto(box, "Frame the print");
    press(box, "Enter");
  }
  check(
    "the task is saved on that day, on the Calendar",
    await until(() => row("Frame the print")?.due_on === "2026-10-01" && row("Frame the print")?.show_on_calendar === 1),
    JSON.stringify(row("Frame the print"))
  );
  check(
    "at the hour of the click",
    await until(() => plan.calls.some((c) => Array.isArray(c) && c[0] === "setTaskTime" && c[2] === 600 && c[3] === 630)),
    JSON.stringify(plan.calls.filter(Array.isArray))
  );
  check("the new task's card takes the box's place", await until(() => $(".calendar-task-popover")?.textContent.includes("Frame the print")));
  press(window, "Escape");
  click($('.view-btn[data-view-id="lists"]'));
  check("leaving the Calendar stops its script", await until(() => plan.calls.includes("destroy")));

  // Apple Reminders: a linked list's changes go to Reminders too.
  const errandsTab = () => $(`.tabs .tab[data-list-id="${errands.id}"]`);
  click(errandsTab());
  check("the linked list opens", await until(() => Boolean(cardOf("Post the parcel"))));
  check(
    "opening a linked list reads Reminders",
    await until(() => commands("fetch_reminders_tasks").length > 0)
  );
  const composer = $("input.task-composer-input");
  typeInto(composer, "Buy stamps");
  press(composer, "Enter");
  check(
    "a task added to a linked list is made in Reminders",
    await until(() => commands("create_reminders_task").some((c) => c.args.title === "Buy stamps")),
    JSON.stringify(board.commands.map((c) => c.command))
  );
  check(
    "and keeps the reminder's id",
    await until(() => (row("Buy stamps")?.reminders_id ?? "").startsWith("rem-new-"))
  );
  cardOf("Post the parcel")?.querySelector("input.task-checkbox")?.click();
  check(
    "a tick on a linked list is sent to Reminders",
    await until(() =>
      commands("update_reminders_status").some((c) => c.args.taskId === "rem-parcel" && c.args.completed === true)
    )
  );
  click(cardOf("Buy stamps").querySelector(".task-text"));
  if (await until(() => Boolean($("textarea.task-edit-input")))) {
    typeInto($("textarea.task-edit-input"), "Buy first-class stamps");
    press($("textarea.task-edit-input"), "Enter");
  }
  check(
    "new words on a linked list are sent to Reminders",
    await until(() => commands("update_reminders_title").some((c) => c.args.title === "Buy first-class stamps"))
  );
  click(cardOf("Buy first-class stamps").querySelector(".task-menu-btn"));
  if (await until(() => Boolean($(".delete-task-item")))) click($(".delete-task-item"));
  check(
    "a delete on a linked list is sent to Reminders",
    await until(() => commands("delete_reminders_task").length === 1)
  );

  // Moved onto the linked list from the menu: the task gets its reminder.
  click($(`.tabs .tab[data-list-id="${studio.id}"]`));
  await until(() => Boolean(cardOf("Oil the easel")));
  click(cardOf("Oil the easel").querySelector(".task-menu-btn"));
  if (await until(() => Boolean($(".move-task-item")))) click($(".move-task-item"));
  const target = await until(() =>
    $$(".task-menu .task-menu-item").some((b) => b.textContent.includes("Errands"))
  );
  if (target) click($$(".task-menu .task-menu-item").find((b) => b.textContent.includes("Errands")));
  check(
    "a task moved onto a linked list is made in Reminders",
    await until(() => commands("create_reminders_task").some((c) => c.args.title === "Oil the easel")),
    JSON.stringify(commands("create_reminders_task").map((c) => c.args.title))
  );
  // Carried onto the linked list's tab: the same, by the drag.
  await until(() => Boolean(cardOf("Sand the frame")));
  const undoPoint = stubPointAt(() => errandsTab());
  await drag(cardOf("Sand the frame"), { x: 10, y: 10 }, { x: 300, y: 10 });
  undoPoint();
  check(
    "a task carried onto a linked list's tab moves there",
    await until(() => row("Sand the frame")?.list_id === errands.id)
  );
  check(
    "and is made in Reminders",
    await until(() => commands("create_reminders_task").some((c) => c.args.title === "Sand the frame")),
    JSON.stringify(commands("create_reminders_task").map((c) => c.args.title))
  );
  await settle();

  // A new list linked to a Reminders list in its dialog: its reminders
  // are read in at once.
  click($(".add-tab-btn-subtle"));
  const remindersPicker = () => $(`.todo-select-trigger[aria-label="${t("appleReminders")}"]`);
  check("the list dialog offers the Reminders lists", await until(() => Boolean(remindersPicker())));
  click(remindersPicker());
  const groceries = () => $$(".todo-select-option").find((el) => el.textContent === "Groceries");
  if (await until(() => Boolean(groceries()))) click(groceries());
  check("a Reminders list names the new list", await until(() => $("#tab-name-input")?.value === "Groceries"));
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  click($("#tab-name-modal .create-btn"));
  check(
    "the import says the list is linked",
    await until(() => toasts.some((t) => t.kind === "success" && t.message === "“Groceries” is linked to Apple Reminders")),
    JSON.stringify(toasts)
  );
  toastSink.push = null;
  const groceryReads = () => commands("fetch_reminders_tasks").filter((c) => c.args.listId === "rem-groceries").length;
  check("the new list's reminders are read", await until(() => groceryReads() > 0));
  await settle(200);
  check("once: the silent sync leaves the list to its import", groceryReads() === 1, groceryReads());

  // The Sync button, and the silent syncs on the way in and out.
  const reads = () => commands("fetch_reminders_tasks").length;
  click(errandsTab());
  await until(() => Boolean(cardOf("Post the parcel")));
  await settle();
  let before = reads();
  check("the Sync button shows where the list syncs: Reminders", Boolean($(".sync-controls .sync-source-stack .reminders-icon")) && !$(".sync-controls .basecamp-icon"));
  click($(".sync-controls"));
  check("the Sync button syncs the open list with Reminders", await until(() => reads() === before + 1), reads() - before);
  await settle();
  // Offline, the button says it needs a connection and reads nothing.
  // Only the planner knows it is offline: the desktop app's check is a
  // stand-in that says it is online.
  if (page.flavor === "planner") {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    const offlineToasts = [];
    toastSink.push = (t) => offlineToasts.push(t);
    const offlineBefore = reads();
    click($(".sync-controls"));
    check(
      "offline, the Sync button says it needs a connection",
      await until(() => offlineToasts.some((t) => t.kind === "info" && t.message === "Basecamp and Reminders sync need a connection.")),
      JSON.stringify(offlineToasts)
    );
    check("and reads nothing", reads() === offlineBefore);
    await settle(100);
    check(
      "and says nothing else: not that it syncs, not that the list is up to date",
      offlineToasts.length === 1,
      JSON.stringify(offlineToasts)
    );
    toastSink.push = null;
    delete window.navigator.onLine;
    check("(the walk is online again)", window.navigator.onLine !== false);
    await settle();
  }
  before = reads();
  click($(`.tabs .tab[data-list-id="${studio.id}"]`));
  check("leaving a linked list syncs it", await until(() => reads() === before + 1), reads() - before);
  await settle();
  click(errandsTab());
  await until(() => reads() === before + 2);
  await settle();
  before = reads();
  click($('.view-btn[data-view-id="plan"]'));
  check("going to the Calendar leaves the linked list, and syncs it", await until(() => reads() === before + 1), reads() - before);
  await settle();
  click($('.view-btn[data-view-id="lists"]'));
  check("and coming back syncs it again", await until(() => reads() === before + 2), reads() - before);
  await settle();
  before = reads();

  view.unmount();
  check("the page's end syncs the open linked list", await until(() => reads() === before + 1), reads() - before);
  await settle(100);
  check(
    "no sync sends a step to Reminders",
    !commands("create_reminders_task").some((c) => c.args.title === "Weigh the parcel"),
    JSON.stringify(commands("create_reminders_task").map((c) => c.args.title))
  );
  check("the page lets go of the focus channel", channels.openCount(FOCUS_CHANNEL) === 1);
  window1.close();
}
