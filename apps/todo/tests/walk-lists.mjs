/**
 * The lists and the people on the board: My tasks and Everyone, the person
 * pills, the search (Cmd+F), and the dialogs that make, rename and delete a
 * list and a group.
 *
 * Run in both flavours: mounted-lists and mounted-lists-planner. Every
 * list, task and person is invented, and the addresses are at example.org.
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
  text,
  typeInto,
  until,
} from "./page-walk.mjs";

/** The switch of the settings row with this label. */
export function settingsSwitch(label) {
  const row = $$(".settings-row").find(
    (r) => r.querySelector(".settings-row-label")?.textContent === label
  );
  return row?.querySelector("input.enforcement-toggle-input") ?? null;
}

const tabNamed = (name) =>
  $$(".tabs .tab").find((tab) => tab.querySelector(".tab-name")?.textContent === name) ?? null;
const shown = (words) => Boolean(cardOf(words));

export async function walkLists(page) {
  const { makeT } = await import("@/lib/todo/i18n");
  const t = makeT("en");
  const { board, call } = page;
  const lists = () => board.query("SELECT id, name, group_id FROM todo_lists ORDER BY name");
  const listNamed = (name) => lists().find((l) => l.name === name) ?? null;

  const kitchen = (await call("/api/todo/lists", "POST", { name: "Kitchen" })).list;
  const garage = (await call("/api/todo/lists", "POST", { name: "Garage" })).list;
  const ada = (await call("/api/todo/people", "POST", { name: "Ada Quill", email: "ada@example.org", sourceKind: "manual" })).person;
  const ben = (await call("/api/todo/people", "POST", { name: "Ben Rook", email: "ben@example.org", sourceKind: "manual" })).person;
  await call("/api/todo/tasks", "POST", { listId: kitchen.id, text: "Descale the kettle", assigneeIds: [ada.id] });
  await call("/api/todo/tasks", "POST", { listId: kitchen.id, text: "Wipe the hob", assigneeIds: [ben.id] });
  await call("/api/todo/tasks", "POST", { listId: garage.id, text: "Pump the tyres" });

  // Assigning is on, and the reader is Ada: by the address the planner's
  // login gives, or by the "Me" mark the desktop app keeps. Board View is
  // off, so the Favourites view is there to search in.
  localStorage.setItem("redd-plan-todo-assign-enabled", "1");
  localStorage.setItem("redd-plan-todo-kanban", "0");
  let view;
  if (page.flavor === "desktop") {
    localStorage.setItem("redd-plan-todo-me-person", ada.id);
    view = await page.mount();
  } else {
    view = await page.mount({ viewerEmails: ["ada@example.org"], viewerKeys: ["this-device"] });
  }
  check("the board paints", await until(() => shown("Descale the kettle")), text().slice(0, 200));
  check("two lists have an All tab", Boolean($(".tab.tab-all")));

  // My tasks: Ada's task and the one nobody is on that the reader made.
  const scopeBtn = (label) =>
    $$(".board-people-scope-btn").find((b) => b.textContent.startsWith(label)) ?? null;
  check("My tasks is offered", await until(() => Boolean(scopeBtn(t("myTasks")))));
  check("My tasks is on at first", scopeBtn(t("myTasks"))?.classList.contains("active"));
  check(
    "My tasks shows the reader's tasks only",
    await until(() => shown("Descale the kettle") && shown("Pump the tyres") && !shown("Wipe the hob")),
    $$(".task-item .task-text").map((e) => e.textContent).join(" | ")
  );
  check(
    "My tasks counts them",
    scopeBtn(t("myTasks"))?.querySelector(".board-people-scope-count")?.textContent === "2"
  );
  // A task added under My tasks has nobody on it; the reader made it, so it
  // shows at once.
  const holdMine = holdWrites(/^\s*INSERT INTO todo_tasks/i, 600);
  const mineComposer = $("input.task-composer-input");
  typeInto(mineComposer, "Oil the hinges");
  press(mineComposer, "Enter");
  check("a task added under My tasks shows before the server answers", await until(() => shown("Oil the hinges"), 300));
  holdMine();
  await until(() => board.query("SELECT id FROM todo_tasks WHERE text = ?", ["Oil the hinges"]).length === 1);
  await settle();
  click(scopeBtn(t("filterEveryone")));
  check("Everyone shows every task", await until(() => shown("Wipe the hob") && shown("Descale the kettle")));
  check("the choice is kept on the device", localStorage.getItem("redd-plan-todo-people-scope") === "everyone");
  const pill = (person) => $(`.board-assignee-filter [data-person-id="${person.id}"]`);
  check("Everyone offers a pill per person with a task", Boolean(pill(ada)) && Boolean(pill(ben)));
  click(pill(ben));
  check(
    "a person pill shows that person's tasks",
    await until(() => shown("Wipe the hob") && !shown("Descale the kettle") && !shown("Pump the tyres"))
  );
  // A task added while a pill is on gets that person, so it shows at once.
  const letGo = holdWrites(/^\s*INSERT INTO todo_tasks/i, 600);
  const pillComposer = $("input.task-composer-input");
  typeInto(pillComposer, "Clean the grill");
  press(pillComposer, "Enter");
  check(
    "a task added under a pill shows before the server answers",
    await until(() => shown("Clean the grill"), 300)
  );
  letGo();
  check(
    "and is saved with that person",
    await until(
      () =>
        board.query(
          "SELECT a.person_id FROM todo_task_assignees a JOIN todo_tasks t ON t.id = a.task_id WHERE t.text = ?",
          ["Clean the grill"]
        )[0]?.person_id === ben.id
    )
  );
  click(pill(ben));
  check("the pill again shows everyone", await until(() => shown("Descale the kettle") && shown("Pump the tyres")));
  // Carry Ben's pill in front of Ada's: the order is the roster's.
  const undoBoxes = stubBoxes((el) => {
    if (!el.dataset?.personId) return null;
    const chips = $$(".board-assignee-filter [data-person-id]");
    return { left: chips.indexOf(el) * 100, top: 0, width: 90, height: 24 };
  });
  const chipOrder = () => $$(".board-assignee-filter [data-person-id]").map((el) => el.title).join();
  const benAt = $$(".board-assignee-filter [data-person-id]").indexOf(pill(ben)) * 100 + 40;
  const benPill = pill(ben);
  benPill.dispatchEvent(
    new window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: benAt, clientY: 10 })
  );
  for (const x of [benAt - 20, 60, 5]) {
    window.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: 10 }));
    await settle(20);
  }
  check("mid-carry the pills follow the pointer", await until(() => chipOrder() === "Ben Rook,Ada Quill"), chipOrder());
  const holdPeople = holdWrites(/^\s*UPDATE todo_people/i, 1500);
  window.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 5, clientY: 10 }));
  // The browser ends a carry with a click on the pill let go of.
  click(pill(ben));
  undoBoxes();
  await settle(100);
  check("the pills stay in the new order while the save is on its way", chipOrder() === "Ben Rook,Ada Quill", chipOrder());
  holdPeople();
  const personRow = (id) => board.query("SELECT position FROM todo_people WHERE id = ?", [id])[0];
  check(
    "a person pill carried to the front is saved there",
    await until(() => personRow(ben.id).position < personRow(ada.id).position),
    JSON.stringify({ ben: personRow(ben.id), ada: personRow(ada.id) })
  );
  check("and drawn there", await until(() => chipOrder() === "Ben Rook,Ada Quill"), chipOrder());
  check("a carry does not turn the pill on", !pill(ben).classList.contains("active"));
  await settle();

  click(pill(ada));
  await until(() => !shown("Wipe the hob"));
  click(scopeBtn(t("myTasks")));
  check("My tasks lets the pills go", await until(() => !pill(ada)));
  click(scopeBtn(t("filterEveryone")));
  check(
    "a pill does not stay on through My tasks",
    await until(() => shown("Wipe the hob") && shown("Descale the kettle"))
  );

  // Search. Cmd+F opens the field, the words filter, Escape clears it.
  pressCmd(window, "f");
  check("Cmd+F opens the search", await until(() => Boolean($(".list-search-inner.open"))));
  typeInto($("input.list-search-input"), "tyres");
  check(
    "the search keeps the matching tasks",
    await until(() => shown("Pump the tyres") && !shown("Wipe the hob") && !shown("Descale the kettle"))
  );
  press(window, "Escape");
  check("Escape closes the search", await until(() => !$(".list-search-inner.open")));
  check("and clears it", $("input.list-search-input")?.value === "");
  check("every task is back", await until(() => shown("Wipe the hob") && shown("Pump the tyres")));

  // On one list, a hit on another list is a chip that goes there.
  click(tabNamed("Kitchen"));
  await until(() => tabNamed("Kitchen")?.classList.contains("active"));
  pressCmd(window, "f");
  await until(() => Boolean($(".list-search-inner.open")));
  typeInto($("input.list-search-input"), "tyres");
  const chip = await until(() => $$(".list-search-tab").some((b) => b.textContent.includes("Garage")));
  check("a hit on another list is offered as a chip", chip, $("#list-search")?.textContent);
  if (chip) click($$(".list-search-tab").find((b) => b.textContent.includes("Garage")));
  check("the chip opens that list", await until(() => tabNamed("Garage")?.classList.contains("active")));
  press(window, "Escape");
  await until(() => !$(".list-search-inner.open"));

  // On Favourites the hits of each list are a chip, and the picked list's
  // chip comes first.
  click($('.view-btn[data-view-id="favourites"]'));
  await until(() => $('.view-btn[data-view-id="favourites"]')?.classList.contains("active"));
  pressCmd(window, "f");
  await until(() => Boolean($(".list-search-inner.open")));
  typeInto($("input.list-search-input"), "the");
  const chips = () => $$(".list-search-tabs .list-search-tab .list-search-tab-name").map((c) => c.textContent);
  check(
    "a Favourites search has a chip per list with hits",
    await until(() => chips().join() === "Kitchen,Garage"),
    chips().join()
  );
  click($$(".list-search-tab").find((c) => c.textContent.includes("Garage")));
  check("the picked list's chip comes first", await until(() => chips()[0] === "Garage"), chips().join());
  check("and its hits show", await until(() => shown("Pump the tyres") && !shown("Wipe the hob")));
  // On Favourites a task's words are not edited: they open its list.
  click(cardOf("Pump the tyres").querySelector(".task-text"));
  check(
    "on Favourites, a task's words open its list",
    await until(() => $('.view-btn[data-view-id="lists"]')?.classList.contains("active") && tabNamed("Garage")?.classList.contains("active"))
  );
  check("and are not edited", !$("textarea.task-edit-input"));
  press(window, "Escape");
  await until(() => !$(".list-search-inner.open"));
  click($('.view-btn[data-view-id="lists"]'));
  await until(() => $('.view-btn[data-view-id="lists"]')?.classList.contains("active"));

  // A new list, by its dialog.
  click($(".add-tab-btn-subtle"));
  check("+ opens the list dialog", await until(() => Boolean($("#tab-name-modal"))));
  typeInto($("#tab-name-input"), "Shed");
  click($("#tab-name-modal .create-btn"));
  check("the new list is saved", await until(() => Boolean(listNamed("Shed"))), JSON.stringify(lists()));
  check("the dialog closes", await until(() => !$("#tab-name-modal")));
  check("the new list's tab is open", await until(() => tabNamed("Shed")?.classList.contains("active")));

  // A click on the open tab renames it.
  click(tabNamed("Shed"));
  check("the open tab opens its dialog", await until(() => $("#tab-name-input")?.value === "Shed"));
  typeInto($("#tab-name-input"), "Garden shed");
  press($("#tab-name-input"), "Enter");
  check("a new name is saved", await until(() => Boolean(listNamed("Garden shed"))), JSON.stringify(lists()));
  check("the tab says the new name", await until(() => Boolean(tabNamed("Garden shed"))));

  // Delete the list, and undo.
  // A task on it, added the way a reader adds one.
  const composer = $("input.task-composer-input");
  typeInto(composer, "Hang the rake");
  press(composer, "Enter");
  await until(() => shown("Hang the rake"));
  click($(".tab.active .tab-close"));
  check("× asks first", await until(() => Boolean($(".delete-confirm-btn"))));
  click($(".delete-confirm-btn"));
  check("the list is deleted", await until(() => !listNamed("Garden shed")));
  check("its tab goes", await until(() => !tabNamed("Garden shed")));
  check(
    "the open list gone, the All tab opens and is kept",
    await until(() => $(".tab.tab-all")?.classList.contains("active")) &&
      localStorage.getItem("redd-plan-todo-current-list") === "__all__"
  );
  if (await until(() => Boolean($(".undo-toast .undo-btn")))) click($(".undo-toast .undo-btn"));
  check("Undo makes the list again", await until(() => Boolean(listNamed("Garden shed"))));
  check(
    "with its task",
    await until(
      () =>
        board.query(
          "SELECT t.text FROM todo_tasks t JOIN todo_lists l ON l.id = t.list_id WHERE l.name = ?",
          ["Garden shed"]
        ).length === 1
    )
  );

  check("and its tab comes back", await until(() => Boolean(tabNamed("Garden shed"))));

  // Groups: on in Settings, then one made by its dialog, then deleted.
  click($(".title-bar-settings-btn"));
  await until(() => Boolean(settingsSwitch(t("enableTabGroups"))));
  settingsSwitch(t("enableTabGroups"))?.click();
  const groups = () => board.query("SELECT id, name FROM todo_groups ORDER BY name");
  check("groups on makes a first group", await until(() => groups().length === 1), JSON.stringify(groups()));
  check(
    "and puts every list in it",
    await until(() => lists().every((l) => l.group_id === groups()[0]?.id)),
    JSON.stringify(lists())
  );
  click($("#settings-modal .cancel-btn") ?? $(".settings-sheet-back"));
  await until(() => !$("#settings-modal"));
  check("the group row is drawn", await until(() => Boolean($(".groups-container .group-tab"))));
  click($(".add-group-btn"));
  check("+ opens the group dialog", await until(() => $("#tab-name-modal h3")?.textContent === t("enterGroupName")));
  typeInto($("#tab-name-input"), "Holiday");
  click($("#tab-name-modal .create-btn"));
  check("the new group is saved", await until(() => groups().some((g) => g.name === "Holiday")));
  const holidayTab = () => $$(".group-tab").find((g) => g.textContent.startsWith("Holiday"));
  check("the new group is open", await until(() => holidayTab()?.classList.contains("active")));
  check("its lists are its own: none yet", await until(() => $$(".tabs .tab[data-list-id]").length === 0));
  click($(".add-tab-btn-subtle"));
  await until(() => Boolean($("#tab-name-modal")));
  typeInto($("#tab-name-input"), "Suitcase");
  click($("#tab-name-modal .create-btn"));
  const holidayId = () => groups().find((g) => g.name === "Holiday")?.id;
  check(
    "a list made in a group is that group's",
    await until(() => lists().some((l) => l.name === "Suitcase" && l.group_id === holidayId())),
    JSON.stringify(lists())
  );
  await settle();
  // Carry the new group in front of the first.
  const groupOrder = () => $$(".groups .group-tab").map((el) => el.firstChild?.textContent).join();
  const undoGroupBoxes = stubBoxes((el) => {
    if (!el.classList?.contains("group-tab")) return null;
    return { left: $$(".groups .group-tab").indexOf(el) * 100, top: 0, width: 90, height: 24 };
  });
  const holidayAt = $$(".groups .group-tab").indexOf(holidayTab()) * 100 + 40;
  const holdGroups = holdWrites(/^\s*UPDATE todo_groups/i, 1500);
  await drag(holidayTab(), { x: holidayAt, y: 10 }, { x: 5, y: 10 });
  undoGroupBoxes();
  // The browser ends a carry with a click on the tab let go of. On the
  // open group a click opens its name to edit; this one must not.
  click(holidayTab());
  await settle(100);
  check("the click at the end of a carry does not open the group's name", !$("#tab-name-modal"));
  check("the groups stay in the new order while the save is on its way", groupOrder() === "Holiday,General", groupOrder());
  holdGroups();
  const groupRow = (name) => board.query("SELECT position FROM todo_groups WHERE name = ?", [name])[0];
  check(
    "a group carried to the front is saved there",
    await until(() => groupRow("Holiday").position < groupRow("General").position),
    JSON.stringify(groups())
  );
  check("and drawn there", await until(() => groupOrder() === "Holiday,General"), groupOrder());
  click(holidayTab().querySelector(".group-delete-btn"));
  if (await until(() => Boolean($(".delete-confirm-btn")))) click($(".delete-confirm-btn"));
  check("the group is deleted", await until(() => !groups().some((g) => g.name === "Holiday")));
  await settle();

  // Basecamp: a list linked in the dialog. A small Basecamp answers the
  // projects and to-do lists; the sync after it finds nothing and fails.
  const { setBasecampTransport } = await import("@/lib/todo/basecamp");
  board.query(
    "INSERT INTO todo_basecamp_connection (id, account_id, access_token, refresh_token) VALUES (1, 'acc', 'token-1', 'refresh-1')"
  );
  const bcAsks = [];
  const project = {
    id: 1,
    name: "Garden Works",
    dock: [{ name: "todoset", url: "https://3.basecampapi.com/acc/buckets/1/todosets/9.json" }],
  };
  const answers = {
    "/projects.json": [project],
    "/projects/1.json": project,
    "/buckets/1/todosets/9/todolists.json": [{ id: 21, name: "Beds" }],
  };
  setBasecampTransport({
    // A little time on the way, as a network takes: the page draws while
    // it waits.
    fetch: async (url) => {
      await sleep(120);
      const full = String(url).replace("https://3.basecampapi.com/acc", "");
      bcAsks.push(full);
      const body = answers[full.split("?")[0]];
      return body
        ? new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response("{}", { status: 404 });
    },
    refresh: async () => null,
  });
  // Settings closing reads the connections again.
  click($(".title-bar-settings-btn"));
  await until(() => Boolean($("#settings-modal")));
  click($("#settings-modal .cancel-btn"));
  await until(() => !$("#settings-modal"));
  click($(".add-tab-btn-subtle"));
  const pick = async (label, option) => {
    const trigger = $(`.todo-select-trigger[aria-label="${label}"]`);
    if (!trigger) return false;
    click(trigger);
    const ok = await until(() => $$(".todo-select-option").some((el) => el.textContent === option));
    if (ok) click($$(".todo-select-option").find((el) => el.textContent === option));
    return ok;
  };
  check("the dialog offers the Basecamp projects", await until(() => Boolean($(`.todo-select-trigger[aria-label="${t("basecampProject")}"]`))) && (await pick(t("basecampProject"), "Garden Works")));
  check("and the project's to-do lists", await pick("Basecamp List", "Beds"));
  check("a to-do list names the new list", await until(() => $("#tab-name-input")?.value === "Garden: Beds"), $("#tab-name-input")?.value);
  bcAsks.length = 0;
  click($("#tab-name-modal .create-btn"));
  const linked = () => board.query("SELECT * FROM todo_lists WHERE name = ?", ["Garden: Beds"])[0];
  check("the list is saved with its link", await until(() => linked()?.basecamp_list_id === "21"), JSON.stringify(linked()));
  await settle(300);
  const syncs = bcAsks.filter((path) => path.startsWith("/buckets/1/todolists/21")).length;
  check("the new list is synced once, by its import", syncs === 1, JSON.stringify(bcAsks));

  // The chips of a card on the All tab: the heart, the due date, and the
  // list the task is on, which moves it.
  click($(".tab.tab-all"));
  const tyres = () => cardOf("Pump the tyres");
  await until(() => Boolean(tyres()));
  const tyresRow = () => board.query("SELECT * FROM todo_tasks WHERE text = ?", ["Pump the tyres"])[0];
  click(tyres().querySelector(".fav-btn"));
  check("the heart makes a task a favourite", await until(() => tyresRow()?.is_favourite === 1));
  click(tyres().querySelector(".task-chip-due"));
  check("the due chip opens its popover", await until(() => Boolean($(".due-popover"))));
  press(window, "Escape");
  await until(() => !$(".due-popover"));
  click(tyres().querySelector(".task-list-origin"));
  const toKitchen = () => $$(".task-list-picker .task-list-picker-item").find((el) => el.textContent.includes("Kitchen"));
  check("the list chip opens the list picker", await until(() => Boolean(toKitchen())));
  click(toKitchen());
  check("a list picked there moves the task", await until(() => tyresRow()?.list_id === kitchen.id));

  // A long list, and a task added to it: the note offers Board View.
  for (let i = 1; i <= 9; i += 1) {
    await call("/api/todo/tasks", "POST", { listId: kitchen.id, text: `Chore ${i}` });
  }
  const realNow = Date.now;
  Date.now = () => realNow() + 11_000;
  window.dispatchEvent(new window.Event("focus"));
  await settle(400);
  Date.now = realNow;
  click(tabNamed("Kitchen"));
  await until(() => shown("Chore 9"));
  const addChore = async (words) => {
    const box = $("input.task-composer-input");
    typeInto(box, words);
    press(box, "Enter");
    await until(() => shown(words));
  };
  await addChore("Chore 10");
  check("a task added to a long list brings the Board View note", await until(() => Boolean($(".board-nudge"))));
  click($(".board-nudge-no"));
  check("not now puts it away for good", await until(() => !$(".board-nudge")) && localStorage.getItem("redd-plan-todo-board-nudge-seen") === "1");
  await addChore("Chore 11");
  await settle(100);
  check("and it does not come back", !$(".board-nudge"));
  localStorage.removeItem("redd-plan-todo-board-nudge-seen");
  await addChore("Chore 12");
  await until(() => Boolean($(".board-nudge")));
  click($(".board-nudge-try"));
  check("try turns Board View on", await until(() => Boolean($(".list-board"))) && localStorage.getItem("redd-plan-todo-kanban") === "1");
  localStorage.setItem("redd-plan-todo-kanban", "0");

  view.unmount();
}
