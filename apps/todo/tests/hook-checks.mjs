/**
 * The checks of mounted-hooks.test.mjs, one block per hook.
 */

import { makeT } from "@/lib/todo/i18n";

import { check } from "./harness.mjs";
import { flushSync } from "react-dom";

import { installBroadcastChannel, renderHook, settle, sleep, stubBoxes, stubPointAt, until } from "./page-walk.mjs";

/** Run `fn`, and let React draw what it set before going on. */
const flushed = (fn) => flushSync(fn);
/** The English words, for the hooks that say things. */
const EN_T = makeT("en");

async function writeTracking() {
  const { useWriteTracking } = await import("@/components/todo/use-write-tracking");
  const calls = [];
  const gates = [];
  const offlineApi = (path, method) => {
    calls.push(`${method} ${path}`);
    return new Promise((resolve, reject) => gates.push({ resolve, reject }));
  };
  const hook = renderHook(useWriteTracking, offlineApi);
  const { api, mutationSeqRef, inFlightWritesRef } = hook.result();
  void api("/api/todo/state", "GET");
  check("a read goes straight through", calls.length === 1 && mutationSeqRef.current === 0);
  check("and is not a write in flight", inFlightWritesRef.current.size === 0);
  const first = api("/api/todo/tasks", "PATCH", { id: "a" });
  const second = api("/api/todo/tasks", "delete", {});
  check("each write is counted", mutationSeqRef.current === 2, mutationSeqRef.current);
  check("and held while it is in flight", inFlightWritesRef.current.size === 2);
  // gates[0] is the read's.
  gates[1].resolve({ ok: true });
  gates[2].reject(new Error("offline"));
  await Promise.allSettled([first, second]);
  await sleep(0);
  check("a write that is answered, or fails, lets go", inFlightWritesRef.current.size === 0);
  check("the count stays", mutationSeqRef.current === 2);
  hook.rerender(offlineApi);
  check("the api is the same while its source is", hook.result().api === api);
  hook.rerender(async () => ({}));
  check("and new when its source is", hook.result().api !== api);
  hook.unmount();
}

async function zoomKeys() {
  const { useZoomKeys } = await import("@/components/todo/use-zoom-keys");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  let zoom = 160;
  const setZoom = (next) => {
    zoom = typeof next === "function" ? next(zoom) : next;
  };
  const hook = renderHook(({ z }) => useZoomKeys(z, setZoom), { z: zoom });
  const key = (k, extra = {}) =>
    window.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: k, metaKey: true, bubbles: true, cancelable: true, ...extra })
    );
  key("=");
  check("Cmd and = zoom in by ten", zoom === 170, zoom);
  key("+");
  check("no further than 170", zoom === 170, zoom);
  check("and each press says the zoom", toasts.length === 2 && toasts[1].message === "170%", JSON.stringify(toasts.map((t) => t.message)));
  key("0");
  check("Cmd and 0 go back to 100", zoom === 100, zoom);
  check("the zoom is kept", localStorage.getItem("redd-plan-todo-zoom") === "100");
  hook.rerender({ z: 60 });
  key("-");
  key("_");
  check("the newest zoom is the one stepped from, and 50 is the floor", zoom === 50, zoom);
  key("=", { altKey: true });
  key("=", { metaKey: false });
  key("x");
  check("other keys, and Alt, leave it", zoom === 50, zoom);
  const ctrl = new window.KeyboardEvent("keydown", { key: "=", ctrlKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(ctrl);
  check("Ctrl works as Cmd", zoom === 60, zoom);
  check("and the browser's own zoom is held back", ctrl.defaultPrevented);
  hook.unmount();
  key("=");
  check("unmounted, the keys are let go", zoom === 60, zoom);
  toastSink.push = null;
  localStorage.removeItem("redd-plan-todo-zoom");
}

async function undo() {
  const { useUndoKey, useUndoState } = await import("@/components/todo/use-undo");
  const hook = renderHook(() => {
    const state = useUndoState();
    useUndoKey(state);
    return state;
  });
  const cmdZ = (extra = {}) => {
    const e = new window.KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true, ...extra });
    window.dispatchEvent(e);
    return e;
  };
  let taken = 0;
  hook.result().registerUndo(() => (taken += 1));
  check("a registered change shows no toast", hook.result().undoState === null);
  const box = document.createElement("input");
  document.body.appendChild(box);
  box.focus();
  cmdZ();
  check("Cmd+Z in a box is the box's own", taken === 0);
  box.blur();
  box.remove();
  cmdZ({ shiftKey: true });
  check("Shift+Cmd+Z is not undo", taken === 0);
  const pressed = cmdZ();
  check("Cmd+Z takes the change back", taken === 1);
  check("and holds the browser's own back", pressed.defaultPrevented);
  cmdZ();
  check("once", taken === 1);
  let restored = 0;
  flushed(() => hook.result().showUndo("Task deleted", () => (restored += 1)));
  check("a delete shows its toast", hook.result().undoState?.message === "Task deleted");
  check("with a timer to put it away", hook.result().undoTimer.current !== null);
  flushed(() => cmdZ({ metaKey: false, ctrlKey: true, key: "Z" }));
  check("Ctrl+Z takes the delete back", restored === 1);
  check("and the toast goes with it", hook.result().undoState === null);
  hook.unmount();
}

async function focusWindows() {
  const { useFocusChannel, useFocusWindowState } = await import("@/components/todo/use-focus-windows");
  const { toastSink } = await import("sonner");
  const channels = installBroadcastChannel();
  const opened = [];
  let refuse = false;
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        if (command !== "open_focus_popout") return null;
        if (refuse) throw new Error("no panel");
        opened.push(args.taskId);
        return null;
      },
    },
  };
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const ticks = [];
  let refreshes = 0;
  const hook = renderHook(({ render }) => {
    const state = useFocusWindowState({
      completeFromFocus: (id, seconds) => ticks.push([render, id, seconds]),
      tasksLoaded: true,
    });
    const actions = useFocusChannel({
      t: EN_T,
      ...state,
      refresh: async () => {
        refreshes += 1;
      },
      standalone: true,
    });
    return { ...state, ...actions };
  }, { render: "first" });
  await until(() => hook.result().nativeShell);
  check("in the shell, the board has focus windows", hook.result().nativeShell);
  const task = (id) => ({ id, text: id, expectedDurationMinutes: null });
  const active = () => [...hook.result().activeFocusTaskIds].join();
  flushed(() => hook.result().toggleTaskFocusPopout(task("a")));
  flushed(() => hook.result().toggleTaskFocusPopout(task("b")));
  check("each press opens a window", await until(() => opened.join() === "a,b"), opened.join());
  check("and marks its task", active() === "a,b");
  // A window of our own, as a focus window holds.
  const panel = channels.channel("redd-plan-todo-focus");
  const asked = () => channels.posts.filter((p) => p.data.type === "focus-exit-request").map((p) => p.data.taskId);
  flushed(() => hook.result().toggleTaskFocusPopout(task("c")));
  check("a third asks the newest window to give way", await until(() => asked().join() === "b"), asked().join());
  check("and waits for it", opened.join() === "a,b");
  panel.postMessage({ type: "focus-ended", taskId: "b" });
  check(
    "the new one opens once the old one says it closed, before the wait runs out",
    await until(() => opened.join() === "a,b,c", 600),
    opened.join()
  );
  check("two marks, as before", await until(() => active() === "a,c"), active());
  flushed(() => hook.result().toggleTaskFocusPopout(task("d")));
  await until(() => asked().join() === "b,c");
  check(
    "a window that never answers is not waited for past its time",
    await until(() => opened.join() === "a,b,c,d", 2500),
    opened.join()
  );
  flushed(() => hook.result().toggleTaskFocusPopout(task("a")));
  check("the button of a task in focus asks it to close", await until(() => asked().at(-1) === "a"));
  check("and takes its mark at once", await until(() => !hook.result().activeFocusTaskIds.has("a")));
  refuse = true;
  flushed(() => hook.result().toggleTaskFocusPopout(task("e")));
  check("a window the shell refuses loses its mark", await until(() => !hook.result().activeFocusTaskIds.has("e") && toasts.length === 1));
  check("and says so", toasts[0]?.kind === "error", JSON.stringify(toasts));
  panel.postMessage({ type: "focus-started", taskId: "z" });
  check("a window that starts marks its task", await until(() => hook.result().activeFocusTaskIds.has("z")));
  panel.postMessage({ type: "task-updated", taskId: "z" });
  check("a window's change reads the board again", await until(() => refreshes === 1));
  hook.rerender({ render: "newest" });
  panel.postMessage({ type: "task-complete", taskId: "z", timeSpentSeconds: 90 });
  check(
    "a window's tick is the newest page's tick",
    await until(() => ticks.some(([render, id, s]) => render === "newest" && id === "z" && s === 90)),
    JSON.stringify(ticks)
  );
  hook.unmount();
  check("unmounted, the channel is closed", channels.openCount("redd-plan-todo-focus") === 1);
  panel.close();
  delete window.__TAURI__;
  toastSink.push = null;
}

async function pendingFocusTicks() {
  const { useFocusWindowState } = await import("@/components/todo/use-focus-windows");
  localStorage.setItem(
    "dh-todo-focus-pending-complete",
    JSON.stringify([{ taskId: "kept", timeSpentSeconds: 30, at: Date.now() }])
  );
  const ticks = [];
  const hook = renderHook(({ loaded }) => useFocusWindowState({ completeFromFocus: (id) => ticks.push(id), tasksLoaded: loaded }), {
    loaded: false,
  });
  await sleep(50);
  check("a kept tick waits for the tasks", ticks.length === 0 && localStorage.getItem("dh-todo-focus-pending-complete") !== null);
  hook.rerender({ loaded: true });
  check("and is taken up once they are there", await until(() => ticks.join() === "kept"));
  check("and out of storage", localStorage.getItem("dh-todo-focus-pending-complete") === null);
  check("with no shell, no focus windows", !hook.result().nativeShell);
  hook.unmount();
}

async function searchField() {
  const { useSearchField, useSearchState } = await import("@/components/todo/use-search");
  const live = { current: { searchRevealed: false, searchQuery: "", modalOpen: false } };
  const field = document.createElement("div");
  const input = document.createElement("input");
  field.appendChild(input);
  const card = document.createElement("div");
  card.className = "task-item";
  const elsewhere = document.createElement("div");
  document.body.append(field, card, elsewhere);
  const hook = renderHook(() => {
    const state = useSearchState();
    state.searchInputRef.current = input;
    state.listSearchRef.current = field;
    live.current = { searchRevealed: state.searchRevealed, searchQuery: state.searchQuery, modalOpen: live.current.modalOpen };
    return { ...state, ...useSearchField({ ...state, liveRef: live }) };
  });
  const key = (k, extra = {}) =>
    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
  const pressDown = (el) => el.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
  flushed(() => key("f", { metaKey: true }));
  check("Cmd+F opens the field", hook.result().searchRevealed);
  await sleep(40);
  check("and puts the caret in it", document.activeElement === input);
  flushed(() => hook.result().setSearchQuery("gate"));
  flushed(() => pressDown(elsewhere));
  check("a click outside keeps a field with words", hook.result().searchRevealed);
  live.current.modalOpen = true;
  flushed(() => key("Escape"));
  check("Escape is a dialog's own while one is open", hook.result().searchRevealed);
  live.current.modalOpen = false;
  flushed(() => key("Escape"));
  check("otherwise Escape puts the field away", !hook.result().searchRevealed);
  check("and clears it", hook.result().searchQuery === "");
  flushed(() => hook.result().revealSearch());
  flushed(() => pressDown(input));
  flushed(() => pressDown(card));
  check("a click in the field or on a card keeps it", hook.result().searchRevealed);
  flushed(() => pressDown(elsewhere));
  check("a click elsewhere puts an empty field away", !hook.result().searchRevealed);
  hook.unmount();
  field.remove();
  card.remove();
  elsewhere.remove();
}

async function columnSorts() {
  const { useColumnSorts } = await import("@/components/todo/use-column-sorts");
  localStorage.removeItem("redd-plan-todo-column-sort-2");
  const people = [{ id: "p1", name: "Zed" }, { id: "p2", name: "Amy" }];
  const hook = renderHook((args) => useColumnSorts(args), { assignEnabled: true, people, taskPreviewIds: null });
  const tasks = [
    { id: "a", text: "b task", position: 1, dueOn: null, createdAt: "2026-09-01T10:00:00.000Z", expectedDurationMinutes: null, assigneeIds: ["p1"] },
    { id: "b", text: "a task", position: 2, dueOn: null, createdAt: "2026-09-01T10:00:00.000Z", expectedDurationMinutes: null, assigneeIds: ["p2"] },
  ];
  const order = (column) => hook.result().sortColumn(column, tasks).map((t) => t.id).join();
  check("a column starts on due date: undated tasks by position", order("week") === "a,b");
  flushed(() => hook.result().pickColumnSort("week", "assignee"));
  check("a picked order is put on the column", order("week") === "b,a", order("week"));
  check("and kept", JSON.parse(localStorage.getItem("redd-plan-todo-column-sort-2")).week.sort === "assignee");
  hook.rerender({ assignEnabled: false, people, taskPreviewIds: null });
  check("with assigning off, 'assignee' reads as due date", order("week") === "a,b" && hook.result().columnSorts.week.sort === "due");
  hook.rerender({ assignEnabled: true, people, taskPreviewIds: ["x"] });
  check("during a drag the column is as the drag draws it", order("week") === "a,b");
  hook.rerender({ assignEnabled: true, people, taskPreviewIds: null });
  const glyph = document.createElement("button");
  flushed(() => {
    hook.result().setColumnSortAnchor(glyph);
    hook.result().setColumnSortMenu("week");
  });
  flushed(() => window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  check("Escape puts the menu away", hook.result().columnSortMenu === null && hook.result().columnSortAnchor === null);
  flushed(() => hook.result().setColumnSortMenu("today"));
  flushed(() => document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true })));
  check("so does a press anywhere", hook.result().columnSortMenu === null);
  hook.unmount();
  localStorage.removeItem("redd-plan-todo-column-sort-2");
}

async function peopleScope() {
  const { usePeopleFilter, usePeopleScopeState } = await import("@/components/todo/use-people-scope");
  localStorage.removeItem("redd-plan-todo-people-scope");
  localStorage.removeItem("redd-plan-todo-me-person");
  let hook = renderHook(() => usePeopleScopeState());
  await sleep(10);
  check("the scope is 'mine' until one is kept", hook.result().peopleScope === "mine");
  flushed(() => hook.result().markMe("p1"));
  check("a first 'Me' keeps the board on everyone", hook.result().peopleScope === "everyone");
  check("and keeps both", localStorage.getItem("redd-plan-todo-me-person") === "p1" && localStorage.getItem("redd-plan-todo-people-scope") === "everyone");
  flushed(() => hook.result().setAssigneeFilterIds(["p2"]));
  flushed(() => hook.result().choosePeopleScope("mine"));
  check("'mine' lets the pills go", hook.result().assigneeFilterIds.length === 0 && hook.result().peopleScope === "mine");
  flushed(() => hook.result().markMe("p3"));
  check("a later 'Me' leaves the scope chosen", hook.result().peopleScope === "mine");
  flushed(() => hook.result().markMe(null));
  check("no 'Me' is kept as none", localStorage.getItem("redd-plan-todo-me-person") === null);
  hook.unmount();
  localStorage.setItem("redd-plan-todo-people-scope", "everyone");
  localStorage.setItem("redd-plan-todo-me-person", "p9");
  hook = renderHook(() => usePeopleScopeState());
  check("a kept scope and 'Me' come back", await until(() => hook.result().peopleScope === "everyone" && hook.result().markedMeId === "p9"));
  hook.unmount();
  localStorage.removeItem("redd-plan-todo-people-scope");
  localStorage.removeItem("redd-plan-todo-me-person");

  const people = [
    { id: "p1", name: "Ann", position: 1, email: "ann@example.org" },
    { id: "p2", name: "Bo", position: 2, email: null },
  ];
  const task = (id, assigneeIds, extra = {}) => ({ id, assigneeIds, listId: "l", createdBy: null, basecampId: null, ...extra });
  const tasks = [task("t1", ["p1"]), task("t2", ["p2"]), task("t3", [], { createdBy: "this-device" })];
  let filter = ["p2", "gone"];
  const base = {
    assignEnabled: true,
    view: "lists",
    tasksForView: tasks,
    peopleSorted: people,
    personPreviewIds: null,
    setAssigneeFilterIds: (next) => {
      filter = typeof next === "function" ? next(filter) : next;
    },
    people,
    viewerEmails: ["ANN@example.org"],
    markedMeId: null,
    peopleScope: "mine",
    viewerKeys: ["me-key"],
    openTasks: tasks,
    doneTasks: [],
    assigneeFilterIds: filter,
  };
  const f = renderHook((args) => usePeopleFilter(args), base);
  check("the pills are the people with a task here", f.result().assigneeFilterPeople.map((p) => p.id).join() === "p1,p2");
  check("a pill whose person is not offered goes", await until(() => filter.join() === "p2"), filter.join());
  check("the reader is found by address", f.result().mePersonIds.join() === "p1" && f.result().hasMe);
  const ids = (list) => list.map((t) => t.id).join();
  // This suite is the desktop app: a task this device made is the reader's.
  check("'mine' is the reader's tasks and their own", ids(f.result().boardTasks) === "t1,t3" && f.result().myOpenCount === 2);
  f.rerender({ ...base, doneTasks: tasks });
  check("the done pile keeps to the scope too", ids(f.result().filteredDoneTasks) === "t1,t3");
  f.rerender({ ...base, peopleScope: "everyone", assigneeFilterIds: ["p2"] });
  check("everyone, with a pill on, is that person's", ids(f.result().boardTasks) === "t2");
  f.rerender({ ...base, assignEnabled: false, assigneeFilterIds: [] });
  check("with assigning off there is no 'mine'", !f.result().hasMe && f.result().scope === "everyone" && ids(f.result().boardTasks) === "t1,t2,t3");
  check("and no pills", f.result().assigneeFilterPeople.length === 0);
  f.rerender({ ...base, personPreviewIds: ["p2", "p1"] });
  check("during a pill's drag the pills follow it", f.result().assigneeFilterPeople.map((p) => p.id).join() === "p2,p1");
  f.unmount();
}

async function boardLayout() {
  const React = await import("react");
  const { useBoardLayout } = await import("@/components/todo/use-board-layout");
  localStorage.removeItem("redd-plan-todo-tile-open-column");
  localStorage.setItem("redd-plan-todo-tile-open-column", "week");
  const suppressRailClickRef = { current: false };
  const hook = renderHook((args) => {
    const [columnOrder, setColumnOrder] = React.useState(["backlog", "week", "today"]);
    const [somedayExpanded, setSomedayExpanded] = React.useState(false);
    const layout = useBoardLayout({
      columnOrder,
      setColumnOrder,
      somedayExpanded,
      setSomedayExpanded,
      suppressRailClickRef,
      ...args,
    });
    return { ...layout, columnOrder, somedayExpanded };
  }, { boardStacked: false, somedayEnabled: true, shellWidth: 1400, shellHeight: 900 });
  const r = () => hook.result();
  check("wide, the columns are in the order kept", r().visibleColumnOrder.join() === "backlog,week,today");
  check("wide, no pills and no accordion", !r().boardPills && !r().boardAccordion && !r().foldPillActions);
  check("the open section kept comes back", r().openStackColumn === "week");
  flushed(() => r().storeColumnOrder(["today", "backlog", "week"]));
  check("a new order is kept as seen", r().columnOrder.join() === "today,backlog,week" && localStorage.getItem("redd-plan-todo-column-order") === "today,backlog,week");
  check("Today stands while Someday is a rail", !r().showTodayRail && r().boardOpenColumns.includes("today"));
  flushed(() => r().onRailActivate("someday"));
  check("a click on the Someday rail opens it", r().somedayExpanded && localStorage.getItem("redd-plan-todo-someday-expanded") === "1");
  check("and Today folds to a rail", r().showTodayRail && !r().boardOpenColumns.includes("today"));
  suppressRailClickRef.current = true;
  flushed(() => r().onRailActivate("today"));
  check("the click that ends a carry does not open a rail", r().somedayExpanded && !suppressRailClickRef.current);
  flushed(() => r().onRailActivate("today"));
  check("a click on the Today rail opens it", !r().somedayExpanded && localStorage.getItem("redd-plan-todo-someday-expanded") === "0");

  hook.rerender({ boardStacked: true, somedayEnabled: true, shellWidth: 600, shellHeight: 900 });
  check("stacked, the order turns over", r().visibleColumnOrder.join() === "week,backlog,today", r().visibleColumnOrder.join());
  check("stacked and tall, an accordion", r().boardAccordion && !r().boardPills);
  flushed(() => r().storeColumnOrder(["week", "today", "backlog"]));
  check("stacked, a new order is kept the right way up", r().columnOrder.join() === "backlog,today,week", r().columnOrder.join());
  flushed(() => r().onRailActivate("someday"));
  check("stacked, no Today rail", !r().showTodayRail);
  hook.rerender({ boardStacked: true, somedayEnabled: false, shellWidth: 340, shellHeight: 500 });
  check("stacked and short, pills", r().boardPills && !r().boardAccordion);
  check("a slim tile folds the pill's offers", r().foldPillActions);
  hook.rerender({ boardStacked: true, somedayEnabled: false, shellWidth: 341, shellHeight: 501 });
  check("just over the heights, an accordion again", r().boardAccordion && !r().foldPillActions);
  flushed(() => r().openStackSection("backlog"));
  check("a section opened is kept", r().openStackColumn === "backlog" && localStorage.getItem("redd-plan-todo-tile-open-column") === "backlog");
  flushed(() => r().setPillMenuOpen(true));
  flushed(() => window.dispatchEvent(new window.MouseEvent("click")));
  check("a click anywhere puts the pill menu away", await until(() => r().pillMenuOpen === false));
  hook.unmount();
  for (const key of ["tile-open-column", "column-order", "someday-expanded"]) {
    localStorage.removeItem(`redd-plan-todo-${key}`);
  }
}

async function integrationStatus() {
  const { useIntegrationStatus } = await import("@/components/todo/use-sync");
  const React = await import("react");
  const calls = [];
  let connected = true;
  let answer = { connected: true };
  const api = async (path, method) => {
    calls.push(`${method} ${path}`);
    if (!connected) throw new Error("offline");
    return answer;
  };
  localStorage.setItem("redd-plan-todo-reminders", "1");
  const hook = renderHook((args) => {
    const [bc, setBcConnected] = React.useState(false);
    const [rem, setRemindersConnected] = React.useState(false);
    useIntegrationStatus({ api, setBcConnected, setRemindersConnected, ...args });
    return { bc, rem };
  }, { settingsOpen: false });
  check("the connections are read at first", await until(() => hook.result().bc && hook.result().rem));
  check("Basecamp's from the server", calls.join() === "GET /api/todo/basecamp/status");
  hook.rerender({ settingsOpen: true });
  await sleep(10);
  check("not while Settings is open", calls.length === 1);
  localStorage.removeItem("redd-plan-todo-reminders");
  connected = false;
  hook.rerender({ settingsOpen: false });
  check("and again when it closes", await until(() => !hook.result().bc && !hook.result().rem) && calls.length === 2);
  connected = true;
  answer = { connected: false };
  hook.rerender({ settingsOpen: true });
  hook.rerender({ settingsOpen: false });
  await until(() => calls.length === 3);
  await sleep(10);
  check("Basecamp is as the server says", !hook.result().bc);
  hook.unmount();
}

async function sync() {
  const { useSync, useSyncState } = await import("@/components/todo/use-sync");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const calls = [];
  let answer = () => ({ result: { pulled: 0, pushed: 0, removed: 0, updated: 0 } });
  const gates = [];
  let hold = false;
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (hold) await new Promise((resolve) => gates.push(resolve));
    return answer(path, body);
  };
  let refreshes = 0;
  const refresh = async () => {
    refreshes += 1;
  };
  const linked = { id: "a", name: "Attic", basecampListId: "bl-a", remindersListId: null };
  const other = { id: "b", name: "Barn", basecampListId: "bl-b", remindersListId: null };
  const plain = { id: "c", name: "Cellar", basecampListId: null, remindersListId: null };
  const lists = [linked, other, plain];
  const listsRef = { current: lists };
  const tasksRef = { current: [] };
  const hook = renderHook((args) => {
    const st = useSyncState();
    const out = useSync({
      t: EN_T,
      api,
      refresh,
      lists,
      listsRef,
      tasksRef,
      remindersConnected: st.remindersConnected,
      remindersConnectedRef: st.remindersConnectedRef,
      setSyncing: st.setSyncing,
      syncChainRef: st.syncChainRef,
      suppressAutoSyncListIdsRef: st.suppressAutoSyncListIdsRef,
      autoSyncKeyRef: st.autoSyncKeyRef,
      ...args,
    });
    return { ...out, st };
  }, { view: "lists", currentListId: null, isAllListsView: true, activeList: null });
  const r = () => hook.result();
  const synced = () => calls.filter((c) => c.path === "/api/todo/basecamp/sync").map((c) => c.body.listId).join();

  // The Sync button.
  hold = true;
  const running = r().doSync();
  await until(() => gates.length === 1);
  check("the button shows the sync while it runs", await until(() => r().st.syncing));
  hold = false;
  while (gates.length) gates.shift()();
  await running;
  check("on All, the linked lists sync, one after the other", synced() === "a,b", synced());
  const done = toasts.at(-1);
  check("a quiet sync says the lists are up to date", done?.kind === "success" && done.message === "“2 lists” is up to date", JSON.stringify(done));
  check("the toast first said what it syncs with", toasts.some((t) => t.kind === "loading" && t.message === "Syncing “2 lists” with Basecamp…"));
  check("the board is read again after the sync", refreshes === 1);
  check("and not after", await until(() => !r().st.syncing));
  calls.length = 0;
  answer = () => ({
    result: {
      pulled: 1,
      pushed: 0,
      removed: 0,
      updated: 0,
      unpushableAssignees: ["Ivy"],
      nameLinkedPeople: ["Jo"],
      ambiguousPeople: ["Kit"],
    },
  });
  hook.rerender({ view: "lists", currentListId: "a", isAllListsView: false, activeList: linked });
  await until(() => synced() === "a");
  calls.length = 0;
  toasts.length = 0;
  await r().doSync();
  check("on a list, that list syncs", synced() === "a", synced());
  check("a sync that changed things says so", toasts.some((t) => t.kind === "success" && t.message === "Synced “Attic”"));
  check("a person Basecamp would not take is named", toasts.some((t) => t.kind === "warning" && t.data?.description?.startsWith("Ivy")));
  check("a person matched by name is named", toasts.some((t) => t.kind === "message" && t.data?.description?.startsWith("Jo")));
  check("a second person of the same name is named", toasts.some((t) => t.kind === "warning" && t.data?.description?.startsWith("Kit")));
  answer = () => {
    throw new Error("Basecamp said no");
  };
  toasts.length = 0;
  await r().doSync();
  check("a failed sync says why", toasts.some((t) => t.kind === "error" && t.message.includes("Basecamp said no")), JSON.stringify(toasts));
  answer = () => ({ result: { pulled: 0, pushed: 0, removed: 0, updated: 0 } });
  hook.rerender({ view: "lists", currentListId: "c", isAllListsView: false, activeList: plain });
  toasts.length = 0;
  calls.length = 0;
  await r().doSync();
  check("a list with no link has nothing to sync", toasts.at(-1)?.message === "Nothing to sync");
  check("on leaving a linked list it syncs", synced() === "a", synced());

  // Silent syncs: into a linked list and out of it, one at a time.
  calls.length = 0;
  hold = true;
  hook.rerender({ view: "lists", currentListId: "b", isAllListsView: false, activeList: other });
  hook.rerender({ view: "lists", currentListId: "a", isAllListsView: false, activeList: linked });
  await until(() => calls.length === 1);
  await sleep(20);
  check("syncs wait for the one before", synced() === "b", synced());
  for (let turn = 0; turn < 200 && (gates.length || calls.length < 3); turn += 1) {
    gates.shift()?.();
    await sleep(5);
  }
  check("into Barn, out of it, and into Attic", synced() === "b,b,a", synced());
  while (gates.length) gates.shift()();
  hold = false;
  await sleep(10);
  calls.length = 0;
  r().st.suppressAutoSyncListIdsRef.current.add("b");
  hook.rerender({ view: "lists", currentListId: "b", isAllListsView: false, activeList: other });
  await sleep(20);
  check("a list an import covers is not synced again", synced() === "a", synced());
  r().st.suppressAutoSyncListIdsRef.current.delete("b");
  calls.length = 0;
  hook.rerender({ view: "favourites", currentListId: "b", isAllListsView: false, activeList: other });
  await until(() => calls.length === 1);
  check("another view is a leave", synced() === "b", synced());
  hook.rerender({ view: "lists", currentListId: "a", isAllListsView: false, activeList: linked });
  await until(() => calls.length === 2);
  calls.length = 0;
  hook.unmount();
  check("the page's end syncs the open list", await until(() => synced() === "a"), synced());
  toastSink.push = null;
}

async function remindersSync() {
  const { useSync, useSyncState } = await import("@/components/todo/use-sync");
  const commands = [];
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        commands.push({ command, args });
        return command === "fetch_reminders_tasks" ? [] : null;
      },
    },
    event: { listen: async () => () => {} },
  };
  const api = async () => ({ result: {} });
  const list = { id: "r", name: "Errands", basecampListId: null, remindersListId: "rem-r" };
  const hook = renderHook((args) => {
    const st = useSyncState();
    st.remindersConnectedRef.current = args.remindersConnected;
    const out = useSync({
      t: EN_T,
      api,
      refresh: async () => {},
      lists: [list],
      listsRef: { current: [list] },
      tasksRef: { current: [] },
      view: "lists",
      currentListId: "r",
      isAllListsView: false,
      activeList: list,
      remindersConnectedRef: st.remindersConnectedRef,
      setSyncing: st.setSyncing,
      syncChainRef: st.syncChainRef,
      suppressAutoSyncListIdsRef: st.suppressAutoSyncListIdsRef,
      autoSyncKeyRef: st.autoSyncKeyRef,
      ...args,
    });
    return out;
  }, { remindersConnected: false });
  const reads = () => commands.filter((c) => c.command === "fetch_reminders_tasks").length;
  await sleep(20);
  check("a Reminders list is not read before Reminders is on", reads() === 0);
  hook.rerender({ remindersConnected: true });
  check("when Reminders comes on, the open list syncs once", await until(() => reads() === 1), reads());
  commands.length = 0;
  hook.result().pushReminders(async () => commands.push({ command: "pushed" }));
  check("with Reminders on, a change is pushed", commands.some((c) => c.command === "pushed"));
  hook.rerender({ remindersConnected: false });
  commands.length = 0;
  hook.result().pushReminders(async () => commands.push({ command: "pushed" }));
  check("with it off, nothing is pushed", commands.length === 0);
  hook.unmount();
  delete window.__TAURI__;
}

/** A fake API for the list dialog: records each call, answers by path. */
function dialogApi() {
  const calls = [];
  let lists = 0;
  const gate = { hold: false, open: null };
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (gate.hold && path.startsWith("/api/todo/basecamp/todolists")) {
      await new Promise((resolve) => (gate.open = resolve));
    }
    if (path === "/api/todo/basecamp/projects") return { projects: [{ id: "p1", name: "Garden Works" }, { id: "p2", name: "Shed" }] };
    if (path.startsWith("/api/todo/basecamp/todolists")) {
      return { todolists: [{ id: "bl1", name: "Beds" }, { id: "bl2", name: "Paths" }] };
    }
    if (path === "/api/todo/groups" && method === "POST") return { group: { id: "g-new", name: body.name, colour: body.colour, position: 9 } };
    if (path === "/api/todo/lists" && method === "POST") return { list: { id: body.id ?? `l${++lists}`, name: body.name, position: 1 } };
    if (path === "/api/todo/lists" && method === "PATCH") return { list: { id: body.id, name: "x", ...body } };
    if (path === "/api/todo/basecamp/sync") return { result: { pulled: 2, pushed: 0, removed: 0, updated: 0 } };
    return {};
  };
  return { api, calls, gate };
}

async function listDialog() {
  const React = await import("react");
  const { useListDialogActions, useListDialogLinks, useListDialogState } = await import("@/components/todo/use-list-dialog");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const commands = [];
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        commands.push({ command, args });
        if (command === "fetch_reminders_lists") return [{ id: "rem-1", name: "Errands", groupName: null }];
        if (command === "fetch_reminders_tasks") return [];
        return null;
      },
    },
    event: { listen: async () => () => {} },
  };
  const { api, calls, gate } = dialogApi();
  const suppressAutoSyncListIdsRef = { current: new Set() };
  const seenSuppressed = [];
  const origAdd = suppressAutoSyncListIdsRef.current.add.bind(suppressAutoSyncListIdsRef.current);
  suppressAutoSyncListIdsRef.current.add = (id) => {
    seenSuppressed.push(id);
    return origAdd(id);
  };
  let refreshes = 0;
  const hook = renderHook((args) => {
    const [state, setState] = React.useState({ lists: [], groups: [], tasks: [], people: [] });
    const [currentListId, setCurrentListId] = React.useState(null);
    const [currentGroupId, setCurrentGroupId] = React.useState(null);
    const listDialog = useListDialogState();
    const links = useListDialogLinks({ listDialog, api, bcConnected: args.bcConnected, remindersConnected: args.remindersConnected });
    const actions = useListDialogActions({
      listDialog,
      api,
      refresh: async () => {
        refreshes += 1;
      },
      setState,
      t: (key) => key,
      bcConnected: args.bcConnected,
      remindersConnected: args.remindersConnected,
      suppressAutoSyncListIdsRef,
      groupsEnabled: args.groupsEnabled,
      activeGroup: args.activeGroup,
      setCurrentGroupId,
      setCurrentListId,
    });
    return { ...listDialog, ...links, ...actions, state, currentListId, currentGroupId };
  }, { bcConnected: true, remindersConnected: true, groupsEnabled: true, activeGroup: { id: "g1", name: "Home" } });
  const r = () => hook.result();

  // A new list: the dialog opens empty and offers what can be linked.
  flushed(() => r().setModalName("left over"));
  flushed(() => r().openCreateListModal());
  check("a new list's dialog opens empty", r().modalName === "" && r().listModal?.kind === "list" && r().listModal.mode === "create");
  check("it offers the Basecamp projects", await until(() => r().bcProjects.length === 2));
  check("and the Reminders lists", await until(() => r().remindersLists.length === 1));
  await r().selectBcProject("p1");
  check("a project offers its to-do lists", await until(() => r().bcTodolists.length === 2));
  flushed(() => r().selectBcList("bl1"));
  check("a to-do list names an empty name, after the project's first word", r().modalName === "Garden: Beds", r().modalName);
  flushed(() => r().setModalName("Beds here"));
  flushed(() => r().selectBcList("bl2"));
  check("a name typed stays", r().modalName === "Beds here");
  flushed(() => r().setModalName(""));
  flushed(() => r().selectRemindersList("rem-1"));
  check("a Reminders list names an empty name", r().modalName === "Errands");
  flushed(() => r().setModalColour("#aabbcc"));
  flushed(() => r().setModalEmoji("star"));
  calls.length = 0;
  await r().submitListModal();
  const made = calls.find((c) => c.path === "/api/todo/lists" && c.method === "POST");
  check(
    "saving writes the list with its look, links and group",
    made?.body.name === "Errands" && made.body.colour === "#aabbcc" && made.body.emoji === "star" &&
      made.body.basecampListId === "bl2" && made.body.basecampProjectId === "p1" &&
      made.body.remindersListId === "rem-1" && made.body.groupId === "g1",
    JSON.stringify(made?.body)
  );
  check("the dialog closes", await until(() => r().listModal === null));
  check("the new list is on the board and open", await until(() => r().state.lists.length === 1 && r().currentListId === made?.body.id));
  check("its tasks are read from Reminders first", await until(() => commands.some((c) => c.command === "fetch_reminders_tasks")));
  check("then from Basecamp", await until(() => calls.some((c) => c.path === "/api/todo/basecamp/sync")));
  check("and the silent sync leaves it to them", seenSuppressed.filter((id) => id === made?.body.id).length === 2 && suppressAutoSyncListIdsRef.current.size === 0);
  check("Basecamp's counts are said", toasts.some((t) => t.kind === "success" && String(t.data?.description ?? "").startsWith("syncLine")), JSON.stringify(toasts));
  check("the board is read again after each", refreshes === 2, refreshes);

  // Rename: the dialog holds the list as it is.
  const list = { id: "l9", name: "Deck", colour: "#123456", emoji: "star", basecampProjectId: "p2", basecampListId: "bl2", remindersListId: null };
  calls.length = 0;
  flushed(() => r().openRenameListModal(list));
  check("a list's dialog holds its name and look", r().modalName === "Deck" && r().modalColour === "#123456" && r().modalEmoji === "star");
  check("and its links", r().modalBcProjectId === "p2" && r().modalBcListId === "bl2" && r().modalRemindersListId === "");
  check("and reads its project's to-do lists", await until(() => calls.some((c) => c.path.includes("projectId=p2")) && r().bcTodolists.length === 2));
  flushed(() => r().setModalName("Back deck"));
  calls.length = 0;
  await r().submitListModal();
  const patch = calls.find((c) => c.path === "/api/todo/lists" && c.method === "PATCH");
  check("saving a rename writes it", patch?.body.id === "l9" && patch.body.name === "Back deck", JSON.stringify(patch?.body));
  flushed(() => r().openRenameListModal({ ...list, colour: "red", emoji: null, basecampProjectId: null }));
  check("an old colour name is read as its hex", r().modalColour === "#FF9E9E", r().modalColour);

  // A group made from a Basecamp project: one list per to-do list.
  flushed(() => r().openCreateGroupModal());
  check("a new group's dialog opens empty", r().modalName === "" && r().listModal?.kind === "group" && !r().importingGroup);
  await r().selectBcProject("p1");
  check("a project names an empty group", await until(() => r().modalName === "Garden Works"), r().modalName);
  calls.length = 0;
  await settle(20);
  gate.hold = true;
  const importing = r().submitListModal();
  check("the dialog stays open while it imports", await until(() => r().importingGroup) && r().listModal !== null);
  gate.hold = false;
  await until(() => Boolean(gate.open));
  gate.open();
  await importing;
  check("each to-do list is a list of the new group", calls.filter((c) => c.path === "/api/todo/lists" && c.method === "POST" && c.body.groupId === "g-new").length === 2);
  check("linked to its to-do list", calls.filter((c) => c.method === "PATCH" && c.body.basecampProjectId === "p1").map((c) => c.body.basecampListId).join() === "bl1,bl2");
  check("and synced", calls.filter((c) => c.path === "/api/todo/basecamp/sync").length === 2);
  check("then the dialog closes", await until(() => r().listModal === null && !r().importingGroup));
  check("the group is open, on its first list", await until(() => r().currentGroupId === "g-new") && r().currentGroupId === "g-new" && r().state.groups.some((g) => g.id === "g-new") &&
      r().currentListId === calls.find((c) => c.path === "/api/todo/lists" && c.method === "POST")?.body.id, r().currentListId);

  // Rename a group.
  flushed(() => r().openRenameGroupModal({ id: "g-new", name: "Garden Works", colour: "#010203" }));
  check("a group's dialog holds its name and colour", r().modalName === "Garden Works" && r().modalColour === "#010203");
  flushed(() => r().setModalName("Garden"));
  calls.length = 0;
  await r().submitListModal();
  check("saving a group's rename writes it", calls.some((c) => c.path === "/api/todo/groups" && c.method === "PATCH" && c.body.name === "Garden"));
  check("and draws it", await until(() => r().state.groups.find((g) => g.id === "g-new")?.name === "Garden") && r().state.groups.find((g) => g.id === "g-new")?.name === "Garden");

  // A plain group, with Basecamp off.
  hook.rerender({ bcConnected: false, remindersConnected: false, groupsEnabled: true, activeGroup: null });
  flushed(() => r().openCreateGroupModal());
  flushed(() => r().setModalName("Kitchen"));
  calls.length = 0;
  await r().submitListModal();
  check("a plain group is made and the All tab opens", calls.some((c) => c.path === "/api/todo/groups" && c.body.name === "Kitchen") && (await until(() => r().currentListId === "__all__")));
  flushed(() => r().openCreateListModal());
  calls.length = 0;
  await r().submitListModal();
  check("no name and no link: nothing is saved", calls.length === 0);

  // A name cleared after a link was picked: the link's name is saved.
  hook.rerender({ bcConnected: true, remindersConnected: true, groupsEnabled: true, activeGroup: null });
  const savedName = (path) => calls.find((c) => c.path === path && c.method === "POST")?.body.name;
  flushed(() => r().openCreateListModal());
  await r().selectBcProject("p1");
  await until(() => r().bcTodolists.length === 2);
  flushed(() => r().selectBcList("bl1"));
  flushed(() => r().setModalName(""));
  calls.length = 0;
  await r().submitListModal();
  const bl1 = r().bcTodolists.find((l) => l.id === "bl1")?.name;
  check("empty, a list takes its Basecamp list's name", Boolean(bl1) && savedName("/api/todo/lists") === bl1, savedName("/api/todo/lists"));
  flushed(() => r().openCreateListModal());
  await until(() => r().remindersLists.length === 1);
  flushed(() => r().selectRemindersList("rem-1"));
  flushed(() => r().setModalName(""));
  calls.length = 0;
  await r().submitListModal();
  check("or its Reminders list's name", savedName("/api/todo/lists") === "Errands", savedName("/api/todo/lists"));
  flushed(() => r().openCreateGroupModal());
  await r().selectBcProject("p1");
  await until(() => r().modalName === "Garden Works");
  flushed(() => r().setModalName(""));
  calls.length = 0;
  await r().submitListModal();
  check("empty, a group from a project takes the project's name", savedName("/api/todo/groups") === "Garden Works", savedName("/api/todo/groups"));
  await until(() => r().listModal === null && !r().importingGroup);
  delete window.__TAURI__;
  toastSink.push = null;
  hook.unmount();
  localStorage.removeItem("redd-plan-todo-current-group");
  localStorage.removeItem("redd-plan-todo-current-list");
}

/** A fake task API: tasks by id, each write recorded; `fail` makes a path throw. */
function taskApi(seed) {
  const rows = new Map(seed.map((t) => [t.id, { ...t }]));
  const calls = [];
  const gate = { hold: null, fail: null };
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (gate.hold?.(path, method, body)) await new Promise((resolve) => (gate.open = resolve));
    if (gate.fail?.(path, method, body)) throw new Error("the server said no");
    if (path === "/api/todo/tasks" && method === "PATCH") {
      const row = { ...rows.get(body.id), ...body };
      if (body.completed === true) row.completedAt = "2026-01-02T03:04:05.000Z";
      rows.set(body.id, row);
      return { task: row };
    }
    if (path === "/api/todo/tasks" && method === "POST") {
      const row = { completed: false, position: 1, assigneeIds: [], remindersId: null, ...body };
      rows.set(body.id, row);
      return { task: row };
    }
    return {};
  };
  return { api, calls, gate, rows };
}

const baseTask = (id, extra = {}) => ({
  id,
  listId: "L1",
  text: id,
  completed: false,
  completedAt: null,
  isFavourite: false,
  favouritePosition: null,
  isBacklog: false,
  isToday: false,
  isSomeday: false,
  position: 1,
  parentTaskId: null,
  assigneeIds: [],
  remindersId: null,
  notesHtml: null,
  dueOn: null,
  ...extra,
});

async function taskActions() {
  const React = await import("react");
  const { useTaskActions } = await import("@/components/todo/use-task-actions");
  const { EMPTY_TASK_DRAFT } = await import("@/lib/todo/task-draft");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const commands = [];
  window.__TAURI__ = {
    core: {
      invoke: async (command, args) => {
        commands.push({ command, args });
        return command === "create_reminders_task" ? { id: "rem-9" } : null;
      },
    },
    event: { listen: async () => () => {} },
  };
  const lists = [
    { id: "L1", name: "Home", remindersListId: "rem-list" },
    { id: "L2", name: "Work", remindersListId: null },
  ];
  const seed = [
    baseTask("a", { isToday: true, position: 1 }),
    baseTask("b", { isToday: true, position: 2 }),
    baseTask("c", { listId: "L2", position: 3 }),
    baseTask("r", { remindersId: "rem-r", position: 4 }),
    baseTask("f", { isFavourite: true, favouritePosition: 2, listId: "L2" }),
    baseTask("g", { isFavourite: true, favouritePosition: 5, listId: "L2" }),
    baseTask("d", { completed: true, listId: "L2", notesHtml: "<p>n</p>", position: 7 }),
    baseTask("s", { parentTaskId: "a", listId: "L1", position: 1 }),
  ];
  const { api, calls, gate } = taskApi(seed);
  let refreshes = 0;
  const undos = [];
  let confirm = null;
  const dropped = [];
  const listsRef = { current: lists };
  const tasksRef = { current: [] };
  const hook = renderHook((args) => {
    const [state, setState] = React.useState({ lists, groups: [], people: [], tasks: seed });
    const [sessionIds, setSessionIds] = React.useState(null);
    const [justAdded, setJustAddedTaskId] = React.useState(null);
    const [hidden, setAnimHiddenTargets] = React.useState(new Set());
    tasksRef.current = state.tasks;
    const open = state.tasks.filter((t) => !t.completed && !t.parentTaskId);
    const actions = useTaskActions({
      api,
      refresh: async () => {
        refreshes += 1;
      },
      state,
      setState,
      t: (key) => key,
      lists,
      listOfTask: (task) => lists.find((l) => l.id === task.listId),
      listsRef,
      tasksRef,
      openTasks: open,
      doneTasks: state.tasks.filter((t) => t.completed && !t.parentTaskId),
      boardColumns: { today: open.filter((t) => t.isToday), week: [], backlog: [], someday: [] },
      showBoard: true,
      isSearching: false,
      somedayEnabled: false,
      doneCollapsed: false,
      assigneeFilterIds: [],
      assigneeFilterPeople: [],
      makerKeys: ["maker-1"],
      pushReminders: (fn) => void fn(),
      focusChannelRef: { current: null },
      registerUndo: (restore) => undos.push({ label: null, restore }),
      showUndo: (label, restore) => undos.push({ label, restore }),
      setConfirmModal: (next) => (confirm = next),
      setSessionIds,
      setJustAddedTaskId,
      justAddedTimer: { current: null },
      setAnimHiddenTargets,
      dropAnimTarget: (key) => dropped.push(key),
      tasksContainerRef: { current: null },
      doneTasksRef: { current: null },
      doneHeadingRowRef: { current: null },
      // Every column in the order the cards were put in.
      columnSorts: new Proxy({}, { get: () => ({ sort: "manual", desc: false }) }),
      sortColumn: (_column, tasks) => tasks,
      pickColumnSort: () => {},
      ...args,
    });
    return { ...actions, state, sessionIds, justAdded, hidden };
  }, { view: "lists", addTargetList: lists[0] });
  const r = () => hook.result();
  const task = (id) => r().state.tasks.find((t) => t.id === id);
  const writes = (method) => calls.filter((c) => c.method === method && c.path.startsWith("/api/todo/tasks"));

  // A change is drawn at once, before the server answers.
  gate.hold = (path, method) => method === "PATCH";
  const pending = r().mutateTask("a", { text: "Air the rooms" });
  check("a change is drawn before the server answers", await until(() => task("a")?.text === "Air the rooms"));
  gate.hold = null;
  gate.open();
  await pending;

  // Reminders hears of a tick, new words and a new due date.
  commands.length = 0;
  await r().mutateTask("r", { completed: true });
  await r().mutateTask("r", { dueOn: "2026-10-01" });
  await until(() => commands.length >= 2);
  const sent = commands.map((c) => c.command).join();
  check("a tick on a linked task goes to Reminders", sent.includes("update_reminders_status"), sent);
  check("so does a due date", sent.includes("update_reminders_due"), sent);
  // Moved onto a linked list, a task gets its reminder.
  commands.length = 0;
  await r().mutateTask("c", { listId: "L1" });
  check("a task moved onto a linked list gets a reminder", await until(() => task("c")?.remindersId === "rem-9"), JSON.stringify(task("c")));
  check("and the reminder's id is saved", writes("PATCH").some((c) => c.body.id === "c" && c.body.remindersId === "rem-9"));
  // A write that fails reads the board again.
  gate.fail = (path, method) => method === "PATCH";
  toasts.length = 0;
  await r().mutateTask("b", { text: "Bake" });
  check("a failed change says so and reads the board again", toasts.some((t) => t.kind === "error") && refreshes === 1, refreshes);
  gate.fail = null;

  // The Today session.
  flushed(() => r().startTodaySession());
  check("the session is Today's column", r().sessionIds?.join() === "a,b", r().sessionIds?.join());
  flushed(() => r().skipSessionTask(task("a")));
  check("a skip goes to the end", r().sessionIds.join() === "b,a");
  // The board's order is the session's, so a skip is a move on the board.
  check(
    "and to the end of Today on the board",
    await until(() => task("a")?.position > task("b")?.position),
    JSON.stringify({ a: task("a")?.position, b: task("b")?.position })
  );
  flushed(() => r().uncompleteSessionTask(task("a")));
  check("a task taken back up is first again", r().sessionIds.join() === "a,b");
  check("and not done", writes("PATCH").some((c) => c.body.id === "a" && c.body.completed === false));
  check("and first in Today on the board", await until(() => task("a")?.position < task("b")?.position));
  await r().addSessionTask("Brew tea", 15);
  const brewed = writes("POST").find((c) => c.body.text === "Brew tea")?.body;
  check("a task added in the session joins its end", await until(() => Boolean(brewed) && r().sessionIds?.at(-1) === brewed.id), r().sessionIds?.join());
  check("and is a Today task of its length", brewed?.isToday === true && brewed.expectedDurationMinutes === 15, JSON.stringify(brewed));

  // To one end of its run.
  flushed(() => r().moveTaskToEdge(task("b"), "top"));
  check("to the top: before every other", await until(() => writes("PATCH").at(-1)?.body.position < 0), JSON.stringify(writes("PATCH").at(-1)?.body));
  flushed(() => r().moveTaskToEdge(task("a"), "bottom"));
  check("to the foot: after every other in its column", await until(() => writes("PATCH").at(-1)?.body.id === "a" && writes("PATCH").at(-1).body.position > task("b").position), JSON.stringify(writes("PATCH").at(-1)?.body));
  hook.rerender({ view: "favourites", addTargetList: lists[0] });
  flushed(() => r().moveTaskToEdge(task("f"), "bottom"));
  check("in Favourites, their own order", await until(() => writes("PATCH").at(-1)?.body.favouritePosition === 6), JSON.stringify(writes("PATCH").at(-1)?.body));
  hook.rerender({ view: "lists", addTargetList: lists[0] });
  flushed(() => r().toggleFavourite(task("c")));
  check("a star turns on", await until(() => writes("PATCH").at(-1)?.body.isFavourite === true));
  flushed(() => r().toggleFavourite(task("f")));
  check("and off", await until(() => writes("PATCH").at(-1)?.body.isFavourite === false));

  // Adding a task.
  commands.length = 0;
  gate.hold = (path, method, body) => method === "POST" && body.text === "Dust shelves";
  const adding = r().addTask("week", {
    ...EMPTY_TASK_DRAFT,
    text: "  Dust shelves ",
    listId: "L2",
    notes: "<p>high ones</p>",
    subtasks: [{ text: "Get a ladder" }],
  });
  check("a new task is drawn before the server answers", await until(() => r().state.tasks.some((t) => t.text === "Dust shelves")));
  const dust = () => r().state.tasks.find((t) => t.text === "Dust shelves");
  check("with its steps", r().state.tasks.some((t) => t.parentTaskId === dust()?.id));
  check("and is marked as just added", r().justAdded === dust()?.id);
  gate.hold = null;
  gate.open();
  const dustId = await adding;
  const made = writes("POST").find((c) => c.body.text === "Dust shelves")?.body;
  check(
    "it is saved on the list picked, with its notes and maker",
    made?.listId === "L2" && made.notesHtml === "<p>high ones</p>" && dust()?.createdBy === "maker-1",
    JSON.stringify(made)
  );
  check("its step is saved under it", writes("POST").some((c) => c.body.parentTaskId === dustId && c.body.text === "Get a ladder"));
  check("on a list with no link, no reminder", !commands.some((c) => c.command === "create_reminders_task"));
  check("the mark goes after a while", await until(() => r().justAdded === null, 3000));
  await r().addTask("week", { ...EMPTY_TASK_DRAFT, text: "Mop", dueOn: "2000-01-01" });
  const mop = writes("POST").find((c) => c.body.text === "Mop")?.body;
  check("a task due today or before lands in Today", mop?.isToday === true, JSON.stringify(mop));
  check("on the open list", mop?.listId === "L1");
  check(
    "on a linked list, it gets a reminder in its Reminders list",
    await until(() => commands.some((c) => c.command === "create_reminders_task" && c.args.listId === "rem-list"))
  );
  hook.rerender({ view: "lists", addTargetList: lists[0], assigneeFilterIds: ["p1", "p9"], assigneeFilterPeople: [{ id: "p1" }] });
  await r().addTask("week", { ...EMPTY_TASK_DRAFT, text: "Wax" });
  check("with a person pill on, the task is theirs", writes("POST").find((c) => c.body.text === "Wax")?.body.assigneeIds.join() === "p1");
  hook.rerender({ view: "lists", addTargetList: lists[0] });
  gate.fail = (path, method, body) => method === "POST" && body.parentTaskId;
  toasts.length = 0;
  const kept = await r().addTask("week", { ...EMPTY_TASK_DRAFT, text: "Fold", subtasks: [{ text: "Sheets" }] });
  check(
    "a step that fails is taken away, the task stays",
    await until(() => !r().state.tasks.some((t) => t.text === "Sheets") && r().state.tasks.some((t) => t.id === kept))
  );
  gate.fail = (path, method) => method === "POST";
  const lost = await r().addTask("week", { ...EMPTY_TASK_DRAFT, text: "Iron", subtasks: [{ text: "Shirts" }] });
  await settle(20);
  check(
    "a task that fails is taken away, with its steps",
    lost === null && !r().state.tasks.some((t) => t.text === "Iron" || t.text === "Shirts"),
    JSON.stringify(r().state.tasks.map((t) => t.text))
  );
  gate.fail = null;

  // Delete, and its undo.
  commands.length = 0;
  undos.length = 0;
  await r().removeTask("r");
  check("a delete takes the task away", (await until(() => !task("r"))) && writes("DELETE").some((c) => c.path.includes("id=r")));
  check("and its reminder", await until(() => commands.some((c) => c.command === "delete_reminders_task")));
  check("with an undo", undos.at(-1)?.label === "taskDeleted");
  await r().removeTask("s");
  check("a step's undo says so", undos.at(-1)?.label === "subtaskDeleted");
  calls.length = 0;
  undos.at(-1).restore();
  check("undo makes the step again, under its task", await until(() => writes("POST").some((c) => c.body.text === "s" && c.body.parentTaskId === "a")));
  check("and reads the board", await until(() => refreshes === 2), refreshes);
  calls.length = 0;
  await r().recreateTask(seed.find((t) => t.id === "d"));
  const back = writes("PATCH").at(-1)?.body;
  check("a done task made again is done, with its notes and place", back?.completed === true && back.notesHtml === "<p>n</p>" && back.position === 7, JSON.stringify(back));

  // Clear the Done pile.
  flushed(() => r().clearDone());
  check("Clear asks first", confirm?.danger === true);
  calls.length = 0;
  flushed(() => confirm.onConfirm());
  check("then takes the done tasks away", !task("d") && (await until(() => writes("DELETE").some((c) => c.path.includes("id=d")))));
  check("with an undo that makes them again", await until(() => undos.at(-1)?.label === "taskDeleted"));
  calls.length = 0;
  undos.at(-1).restore();
  check("undo makes the done tasks again", await until(() => writes("POST").some((c) => c.body.text === "d")));

  hook.unmount();
  delete window.__TAURI__;
  toastSink.push = null;
}

/** The tick's flight to the Done pile, in a small DOM of its own. */
async function taskFlight() {
  const React = await import("react");
  const { useTaskActions } = await import("@/components/todo/use-task-actions");
  const { EMPTY_TASK_DRAFT } = await import("@/lib/todo/task-draft");
  const shell = document.createElement("div");
  shell.className = "todo-shell";
  shell.innerHTML = `
    <div class="open"><div class="task-item" data-task-id="t"><input type="checkbox"><span class="task-text">Tidy</span></div></div>
    <div class="done-heading-row"><div class="done-heading">Done</div></div>
    <div class="done"></div>`;
  document.body.appendChild(shell);
  const undoBoxes = stubBoxes((el) => (el.classList?.contains("task-item") ? { left: 0, top: 100, width: 200, height: 30 } : el.classList?.contains("done-heading-row") ? { left: 0, top: 400, width: 200, height: 20 } : null));
  const openRows = shell.querySelector(".open");
  const doneRows = shell.querySelector(".done");
  const headingRow = shell.querySelector(".done-heading-row");
  const dropped = [];
  const seed = [baseTask("t", { text: "Tidy" })];
  const { api } = taskApi(seed);
  const hook = renderHook((args) => {
    const [state, setState] = React.useState({ lists: [], groups: [], people: [], tasks: seed });
    const [hidden, setAnimHiddenTargets] = React.useState(new Set());
    const actions = useTaskActions({
      api,
      refresh: async () => {},
      state,
      setState,
      t: (key) => key,
      view: "lists",
      lists: [],
      addTargetList: null,
      listOfTask: () => undefined,
      listsRef: { current: [] },
      tasksRef: { current: state.tasks },
      openTasks: [],
      doneTasks: [],
      boardColumns: { today: [], week: [], backlog: [], someday: [] },
      showBoard: false,
      isSearching: false,
      somedayEnabled: false,
      assigneeFilterIds: [],
      assigneeFilterPeople: [],
      makerKeys: [],
      pushReminders: () => {},
      focusChannelRef: { current: null },
      registerUndo: () => {},
      showUndo: () => {},
      setConfirmModal: () => {},
      setSessionIds: () => {},
      setJustAddedTaskId: () => {},
      justAddedTimer: { current: null },
      setAnimHiddenTargets,
      dropAnimTarget: (key) => dropped.push(key),
      tasksContainerRef: { current: openRows },
      doneTasksRef: { current: doneRows },
      doneHeadingRowRef: { current: headingRow },
      // Every column in the order the cards were put in.
      columnSorts: new Proxy({}, { get: () => ({ sort: "manual", desc: false }) }),
      sortColumn: (_column, tasks) => tasks,
      pickColumnSort: () => {},
      ...args,
    });
    return { ...actions, state, hidden };
  }, { doneCollapsed: false });
  const r = () => hook.result();
  const source = openRows.querySelector(".task-item");
  // The done row the page would draw.
  const landed = document.createElement("div");
  landed.className = "task-item";
  landed.dataset.taskId = "t";
  doneRows.appendChild(landed);
  const heading = shell.querySelector(".done-heading");
  let received = false;
  const watch = new window.MutationObserver(() => {
    if (heading.classList.contains("receiving-task")) received = true;
  });
  watch.observe(heading, { attributes: true });
  let hiddenSeen = false;
  const watchLanded = new window.MutationObserver(() => {
    if (landed.style.visibility === "hidden") hiddenSeen = true;
  });
  watchLanded.observe(landed, { attributes: true });
  r().completeTaskWithFlight(seed[0], true, source.querySelector("input"), source);
  check("a tick hides the task's place in Done while it flies", await until(() => r().hidden.has("t:1")));
  check("the card flies as a ghost", Boolean(document.querySelector(".task-flight-layer")));
  check("with a little party", Boolean(document.querySelector(".task-completion-party")));
  check("the landing card is hidden until the ghost is there", await until(() => hiddenSeen, 2000));
  check("the Done heading shows it receiving", await until(() => received, 2000));
  check("at the end the card shows again", await until(() => landed.style.visibility === "" && dropped.length === 1, 3000), landed.style.visibility);
  check("and its place is let go", dropped[0] === "t:1", dropped.join());
  const ghosts = () => document.querySelectorAll(".task-flight-layer").length;
  check("and the ghost is gone", ghosts() === 0, ghosts());
  check("the server's answer is kept", await until(() => r().state.tasks[0].completedAt === "2026-01-02T03:04:05.000Z"), r().state.tasks[0].completedAt);

  // Done folded: no done rows are drawn, and the card flies to the heading.
  landed.remove();
  hook.rerender({ doneCollapsed: true });
  hiddenSeen = false;
  received = false;
  dropped.length = 0;
  r().completeTaskWithFlight(seed[0], true, source.querySelector("input"), source);
  check("with Done folded the flight still ends", await until(() => dropped.length === 1, 3000));
  check("on the heading, not on a card", !hiddenSeen && dropped[0] === "t:1");
  check("which shows it receiving", received);
  check("and the ghost is gone", ghosts() === 0, ghosts());

  // Nowhere to land: the flight lets go.
  hook.rerender({ doneCollapsed: false });
  dropped.length = 0;
  r().completeTaskWithFlight(seed[0], true, source.querySelector("input"), source);
  check("with nowhere to land, the flight lets go", await until(() => dropped.length === 1, 3000) && ghosts() === 0);
  // A new task is scrolled into view once it is drawn.
  const scrolled = [];
  const originalScroll = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function () {
    scrolled.push(this.dataset?.taskId);
  };
  // The page draws the new row; here it is there the moment it is looked for.
  const findRow = openRows.querySelector.bind(openRows);
  openRows.querySelector = (selector) => {
    const found = findRow(selector);
    // The page escapes the id with CSS.escape: a first digit becomes a hex escape.
    const id = /data-task-id="([^"]+)"/
      .exec(selector)?.[1]
      ?.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/\\(.)/g, "$1");
    if (found || !id || id === "t") return found;
    const row = document.createElement("div");
    row.className = "task-item";
    row.dataset.taskId = id;
    openRows.appendChild(row);
    return row;
  };
  await r().addTask("week", { ...EMPTY_TASK_DRAFT, text: "Sweep" });
  const newId = () => r().state.tasks.find((t) => t.text === "Sweep")?.id;
  check("a new task is scrolled into view", await until(() => Boolean(newId()) && scrolled.includes(newId())), scrolled.join());
  window.Element.prototype.scrollIntoView = originalScroll;
  openRows.querySelector = findRow;

  // While a search is on, a tick is a plain write, with no flight.
  hook.rerender({ doneCollapsed: false, isSearching: true });
  dropped.length = 0;
  r().completeTaskWithFlight(seed[0], false, source.querySelector("input"), source);
  await settle(50);
  check("while searching, a tick does not fly", ghosts() === 0 && dropped.length === 0);
  watch.disconnect();
  watchLanded.disconnect();
  hook.unmount();
  undoBoxes();
  shell.remove();
}

async function notesCard() {
  const { useNotesCard, useNotesCardState } = await import("@/components/todo/use-notes-card");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const writes = [];
  const mutateTask = async (id, patch) => writes.push({ id, ...patch });
  const hook = renderHook(() => {
    const notesCard = useNotesCardState();
    return { ...notesCard, ...useNotesCard({ notesCard, mutateTask, t: EN_T }) };
  });
  const r = () => hook.result();
  const task = { id: "n1", notesHtml: "<div>old words</div>" };

  // The small note under a row.
  flushed(() => r().toggleNotes(task));
  check("a note opens with the task's words", r().openNotesTaskId === "n1" && r().notesDraft === "<div>old words</div>" && !r().notesExpanded);
  // The editor on screen is what a save reads, in Basecamp's form.
  const box = document.createElement("div");
  box.className = "notes-container open";
  const editor = document.createElement("trix-editor");
  editor.value = "<div>new <del>old</del></div>";
  box.appendChild(editor);
  document.body.appendChild(box);
  flushed(() => r().toggleNotes(task));
  check("the notes button again saves and closes", r().openNotesTaskId === null && writes.at(-1)?.id === "n1");
  check("what is saved is the editor's, as Basecamp writes it", /<strike>old<\/strike>/.test(writes.at(-1)?.notesHtml ?? ""), writes.at(-1)?.notesHtml);
  // With the big card open, its editor is the one on screen.
  const overlay = document.createElement("div");
  overlay.className = "notes-overlay-body";
  const big = document.createElement("trix-editor");
  big.value = "<div>from the big card</div>";
  overlay.appendChild(big);
  document.body.appendChild(overlay);
  flushed(() => r().toggleNotes(task));
  flushed(() => r().saveNotes("n1"));
  check("with the big card open, its words are saved", writes.at(-1)?.notesHtml?.includes("from the big card"), writes.at(-1)?.notesHtml);
  overlay.remove();
  editor.value = "";
  flushed(() => r().toggleNotes(task));
  flushed(() => r().saveNotes("n1"));
  check("an empty note is saved as none", writes.at(-1)?.notesHtml === null);
  box.remove();

  // A picture still on its way up holds the save.
  flushed(() => r().toggleNotes(task));
  r().notesUploading.current = 1;
  const before = writes.length;
  flushed(() => r().saveNotes("n1"));
  check("a note with a picture still uploading is not saved", writes.length === before && r().openNotesTaskId === "n1");
  check("and says why", toasts.some((t) => t.kind === "error" && t.message === "A picture is still uploading"));
  flushed(() => r().openTaskOverlay(task));
  check("nor is it taken into the big card", !r().notesExpanded);
  r().notesUploading.current = 0;

  // The big card carries what the small box holds.
  flushed(() => r().setNotesDraft("<div>typed</div>"));
  r().notesReadCurrent.current = () => "<div>typed and more</div>";
  flushed(() => r().openTaskOverlay(task));
  check("the big card opens on the live words", r().notesExpanded && r().notesDraft === "<div>typed and more</div>");
  // Escape on the big card saves it, and goes no further.
  let reachedPage = false;
  const onPage = () => (reachedPage = true);
  window.addEventListener("keydown", onPage);
  const count = writes.length;
  flushed(() => document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  check("Escape on the big card saves it", writes.length === count + 1 && r().openNotesTaskId === null && !r().notesExpanded);
  check("and the page does not see the Escape", !reachedPage);
  window.removeEventListener("keydown", onPage);
  r().notesReadCurrent.current = null;

  // A task with no note open goes straight to the big card, on its words.
  flushed(() => r().openTaskOverlay({ id: "n2", notesHtml: "<div>two</div>" }));
  check("the big card of another task opens on its words", r().openNotesTaskId === "n2" && r().notesDraft === "<div>two</div>" && r().notesExpanded);

  // The big card's own pickers go away on a click anywhere.
  flushed(() => r().setOverlayListOpen(true));
  flushed(() => r().setOverlayAssignAnchor(document.body));
  flushed(() => window.dispatchEvent(new window.MouseEvent("click")));
  check("a click anywhere puts the card's pickers away", await until(() => !r().overlayListOpen && r().overlayAssignAnchor === null));

  // The fade at the foot of the big card: shown while there is more below.
  const fields = document.createElement("div");
  const child = document.createElement("div");
  fields.appendChild(child);
  let scrollTop = 0;
  Object.defineProperty(fields, "scrollHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(fields, "clientHeight", { configurable: true, get: () => 300 });
  Object.defineProperty(fields, "scrollTop", { configurable: true, get: () => scrollTop });
  const observed = [];
  const OriginalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(el) {
      observed.push(el);
    }
    disconnect() {}
  };
  flushed(() => r().setOverlayFieldsNode(fields));
  check("more below: the fade shows", await until(() => r().overlayMoreBelow));
  check("the card and each part of it are watched", observed.includes(fields) && observed.includes(child));
  scrollTop = 300;
  flushed(() => r().updateOverlayFade());
  check("at the foot: the fade goes", await until(() => !r().overlayMoreBelow));
  globalThis.ResizeObserver = OriginalObserver;

  hook.unmount();
  toastSink.push = null;
}

async function subtasks() {
  const React = await import("react");
  const { useSubtasks } = await import("@/components/todo/use-subtasks");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const step = (id, position, extra = {}) => ({
    id, listId: "L", text: id, completed: false, position, parentTaskId: "p", assigneeIds: [], notesHtml: null, ...extra,
  });
  const seed = [
    { id: "p", listId: "L", text: "Parent", completed: false, position: 1, parentTaskId: null, assigneeIds: [] },
    step("s2", 0, { completed: true }),
    step("s3", 3),
    step("s1", 1),
  ];
  const calls = [];
  let fail = false;
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (fail) throw new Error("no");
    return { task: { ...body, completed: false, position: body.position ?? 9 } };
  };
  const writes = [];
  const hook = renderHook((args) => {
    const [state, setState] = React.useState({ lists: [], groups: [], people: [], tasks: seed });
    const mutateTask = async (id, patch) => {
      writes.push({ id, ...patch });
      setState((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    };
    return { state, mutateTask, ...useSubtasks({ state, setState, api, makerKeys: ["me"], mutateTask, t: EN_T, ...args }) };
  }, { openNotesTaskId: "p", notesExpanded: true });
  const r = () => hook.result();
  const order = () => (r().subtasksByTask.get("p") ?? []).map((t) => t.id).join();
  check("a task's steps: the work in order, then the done pile", order() === "s1,s3,s2", order());

  // Writing a step in the big card.
  const input = document.createElement("input");
  document.body.appendChild(input);
  r().newSubtaskInputRef.current = input;
  flushed(() => {
    r().setNewSubtaskText("  Sand it ");
    r().setNewSubtaskAssigneeIds(["x1"]);
    r().setNewSubtaskNotes("<div>fine grit</div>");
    r().setNewSubtaskDuration(20);
    r().setNewSubtaskNotesOpen(true);
    r().setNewSubtaskDurEditing(true);
  });
  flushed(() => r().submitNewSubtask(seed[0]));
  const made = calls.find((c) => c.method === "POST")?.body;
  check(
    "a step is saved under its task, with what it carries",
    made?.parentTaskId === "p" && made.text === "Sand it" && made.assigneeIds?.join() === "x1" &&
      made.notesHtml === "<div>fine grit</div>" && made.expectedDurationMinutes === 20,
    JSON.stringify(made)
  );
  const sand = () => r().state.tasks.find((t) => t.text === "Sand it");
  check("it is drawn at once, after the other open steps", await until(() => Boolean(sand())) && sand().position > 3 && sand().createdBy === "me", JSON.stringify(sand()));
  check("the row is empty again, and ready for the next", r().newSubtaskText === "" && r().newSubtaskAssigneeIds.length === 0 && r().newSubtaskNotes === "" && !r().newSubtaskNotesOpen && r().newSubtaskDuration === null && !r().newSubtaskDurEditing);
  check("with the caret in it", document.activeElement === input);
  calls.length = 0;
  flushed(() => r().setNewSubtaskText("   "));
  flushed(() => r().setNewSubtaskNotes("<div>kept</div>"));
  flushed(() => r().submitNewSubtask(seed[0]));
  check("an empty step is not saved", calls.length === 0);
  check("and the row keeps what it holds", r().newSubtaskNotes === "<div>kept</div>");
  flushed(() => r().setNewSubtaskText("Paint it"));
  flushed(() => r().setNewSubtaskNotes("<p><br></p>"));
  flushed(() => r().submitNewSubtask(seed[0]));
  check("a step with an empty note has none", calls.at(-1)?.body.notesHtml === undefined && calls.at(-1)?.body.assigneeIds === undefined);
  fail = true;
  flushed(() => r().setNewSubtaskText("Buff it"));
  flushed(() => r().submitNewSubtask(seed[0]));
  check("a step the server will not take is taken away", await until(() => !r().state.tasks.some((t) => t.text === "Buff it")) && toasts.some((t) => t.kind === "error"));
  fail = false;
  flushed(() => r().setNewSubtaskText("left over"));
  hook.rerender({ openNotesTaskId: "q", notesExpanded: true });
  check("a draft belongs to its card", await until(() => r().newSubtaskText === ""));
  hook.rerender({ openNotesTaskId: "p", notesExpanded: true });

  // A step's note.
  const s1 = () => r().state.tasks.find((t) => t.id === "s1");
  flushed(() => {
    r().setSubtaskNotesId("s1");
    r().setSubtaskNotesDraft("<div>two coats</div>");
  });
  flushed(() => r().saveSubtaskNotes(s1()));
  check("a step's note is saved", writes.at(-1)?.id === "s1" && writes.at(-1).notesHtml === "<div>two coats</div>");
  check("and closed", r().subtaskNotesId === null && r().subtaskNotesDraft === "");
  const count = writes.length;
  flushed(() => r().setSubtaskNotesDraft("<div>two coats</div>"));
  flushed(() => r().saveSubtaskNotes(s1()));
  check("an unchanged note is not written", writes.length === count);
  flushed(() => r().setSubtaskNotesDraft("<p><br></p>"));
  flushed(() => r().saveSubtaskNotes(s1()));
  check("an emptied note is none", writes.at(-1)?.notesHtml === null);

  // Carrying a step by its grip; the rows slide as the order changes.
  const animated = [];
  const originalAnimate = window.Element.prototype.animate;
  window.Element.prototype.animate = function (frames, options) {
    animated.push({ id: this.dataset?.subtaskId, frames, options });
    return { cancel() {}, finished: Promise.resolve() };
  };
  const list = document.createElement("div");
  const draw = () => {
    list.replaceChildren(
      ...(r().subtaskPreview ?? (r().subtasksByTask.get("p") ?? []).map((t) => t.id)).map((id) => {
        const row = document.createElement("div");
        row.className = "task-subtask-row";
        row.dataset.subtaskId = id;
        return row;
      })
    );
  };
  document.body.appendChild(list);
  r().subtaskListRef.current = list;
  draw();
  const undoBoxes = stubBoxes((el) => {
    if (!el.dataset?.subtaskId) return null;
    return { left: 0, top: Array.from(el.parentElement?.children ?? []).indexOf(el) * 30, width: 200, height: 24 };
  });
  const last = (r().subtasksByTask.get("p") ?? []).filter((t) => !t.completed).at(-1).id;
  animated.length = 0;
  flushed(() => r().startSubtaskDrag({ button: 0, clientX: 5, clientY: 100, preventDefault() {} }, "p", last));
  flushed(() => window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 5, clientY: 2 })));
  check("mid-carry the step is the one carried", r().subtaskDragId === last);
  check("and the order follows the pointer", r().subtaskPreview?.[0] === last, r().subtaskPreview?.join());
  draw();
  flushed(() => window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 5, clientY: 200 })));
  draw();
  flushed(() => window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: 5, clientY: 2 })));
  draw();
  check("no row slides while the pointer draws the order", animated.length === 0, animated.length);
  flushed(() => window.dispatchEvent(new window.PointerEvent("pointerup", {})));
  check("let go, the step is saved first", await until(() => writes.some((w) => w.id === last && w.position < 1)));
  check("and the carry ends", r().subtaskDragId === null && r().subtaskPreview === null);
  // A tick: the step sorts to the pile, and the rows slide there after a
  // beat. The rows are drawn in the new order first, as React draws them
  // before the slide measures.
  const openIds = (r().subtasksByTask.get("p") ?? []).filter((t) => !t.completed).map((t) => t.id);
  const ticked = openIds[0];
  list.replaceChildren(
    ...[...openIds.slice(1), ticked, "s2"].map((id) => {
      const row = document.createElement("div");
      row.className = "task-subtask-row";
      row.dataset.subtaskId = id;
      return row;
    })
  );
  animated.length = 0;
  r().subtaskHoldRef.current = true;
  flushed(() => void r().mutateTask(ticked, { completed: true }));
  const slid = animated.find((a) => a.id === ticked);
  check("a ticked step slides to the pile", Boolean(slid), JSON.stringify(animated.map((a) => a.id)));
  check("after a beat", (slid?.frames?.[1]?.offset ?? 0) > 0, JSON.stringify(slid?.frames));
  check("and the beat is for that tick only", r().subtaskHoldRef.current === false);
  window.Element.prototype.animate = originalAnimate;
  undoBoxes();
  list.remove();
  input.remove();
  hook.unmount();

  // A tick from the big card or the Today session: the step goes to the
  // top of its task's done pile, so the freshest tick reads first.
  const pile = [
    { id: "q", listId: "L", text: "q", completed: false, position: 1, parentTaskId: null, assigneeIds: [] },
    step("d1", 2, { completed: true, parentTaskId: "q" }),
    step("d2", 5, { completed: true, parentTaskId: "q" }),
    step("o1", 4, { parentTaskId: "q" }),
    step("o0", 0, { parentTaskId: "q" }),
    step("lone", 3, { parentTaskId: "r" }),
  ];
  const ticks = [];
  const tickHook = renderHook(() =>
    useSubtasks({
      t: EN_T,
      state: { lists: [], groups: [], people: [], tasks: pile },
      setState: () => {},
      api,
      makerKeys: [],
      mutateTask: async (id, patch) => ticks.push({ id, ...patch }),
      openNotesTaskId: null,
      notesExpanded: false,
    })
  );
  const tick = (id) => {
    tickHook.result().toggleSubtaskDone(pile.find((t) => t.id === id));
    return JSON.stringify(ticks.at(-1));
  };
  check("a tick puts the step on top of the pile", tick("o1") === '{"id":"o1","completed":true,"position":1}', tick("o1"));
  check("a step already above the pile stays where it is", tick("o0") === '{"id":"o0","completed":true}', tick("o0"));
  check("an untick moves nothing", tick("d2") === '{"id":"d2","completed":false}', tick("d2"));
  check("a step with no pile yet stays where it is", tick("lone") === '{"id":"lone","completed":true}', tick("lone"));
  check("a task that is not a step moves nothing", tick("q") === '{"id":"q","completed":true}', tick("q"));
  tickHook.unmount();
  toastSink.push = null;
}

async function boardPeople() {
  const React = await import("react");
  const { useBoardPeople } = await import("@/components/todo/use-board-people");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const people = [
    { id: "p1", name: "Ann Lee", photoUrl: null, email: null, position: 1 },
    { id: "p2", name: "Bo Kim", photoUrl: "/old.png", email: null, position: 2 },
  ];
  const tasks = [
    { id: "t", parentTaskId: null, assigneeIds: ["p1", "p2"] },
    { id: "s", parentTaskId: "t", assigneeIds: ["p1"] },
    { id: "u", parentTaskId: null, assigneeIds: [] },
    { id: "v", parentTaskId: "u", assigneeIds: [] },
  ];
  const calls = [];
  const fail = { on: null, hold: null };
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (fail.hold?.(path, method)) await new Promise((resolve) => (fail.open = resolve));
    if (fail.on?.(path, method)) throw new Error("no");
    if (path.startsWith("/api/todo/people/search")) return { results: [{ key: "k1", name: "Cy Moss", sourceKind: "contact", sourceId: "c1", email: "cy@example.org", photoUrl: null }] };
    if (path === "/api/todo/people" && method === "POST") {
      return { person: body.name === "Ann Lee" ? { ...people[0], email: "ann@example.org" } : { id: "p9", position: 9, photoUrl: null, email: null, ...body } };
    }
    return {};
  };
  let refreshes = 0;
  let confirm = null;
  const writes = [];
  const focused = [];
  const anchor = { focus: () => focused.push("anchor") };
  const liveRef = { current: null };
  const hook = renderHook(() => {
    const [state, setState] = React.useState({ lists: [], groups: [], people, tasks });
    const [openAssign, setOpenAssignTaskId] = React.useState("t");
    const [anchorEl, setAssignAnchorEl] = React.useState(anchor);
    liveRef.current = { state };
    const subtasksByTask = new Map([["t", state.tasks.filter((x) => x.parentTaskId === "t")], ["u", state.tasks.filter((x) => x.parentTaskId === "u")]]);
    const mutateTask = async (id, patch) => {
      writes.push({ id, ...patch });
      setState((s) => ({ ...s, tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    };
    return {
      state,
      openAssign,
      anchorEl,
      ...useBoardPeople({
        state,
        setState,
        api,
        refresh: async () => {
          refreshes += 1;
        },
        t: (key) => key,
        liveRef,
        subtasksByTask,
        mutateTask,
        setConfirmModal: (next) => (confirm = next),
        assignAnchorEl: anchorEl,
        setOpenAssignTaskId,
        setAssignAnchorEl,
      }),
    };
  });
  const r = () => hook.result();
  const task = (id) => r().state.tasks.find((x) => x.id === id);
  check("people are found by id", r().peopleById.get("p2")?.name === "Bo Kim");
  const found = await r().searchPeopleCandidates("cy");
  check("a search answers the candidates", found[0]?.name === "Cy Moss" && calls.at(-1).path.includes("q=cy"));

  // Adding.
  await r().addBoardPerson(found[0]);
  const added = calls.find((c) => c.method === "POST")?.body;
  check("a candidate is added with where it came from", added?.sourceKind === "contact" && added.sourceId === "c1" && added.email === "cy@example.org", JSON.stringify(added));
  check("and is on the board", await until(() => r().state.people.some((p) => p.id === "p9")));
  await r().addBoardPerson({ name: "Dee" });
  check("a name alone is a person made by hand", calls.at(-1).body.sourceKind === "manual" && !("sourceId" in calls.at(-1).body));
  await r().addBoardPerson({ name: "Ann Lee" });
  check("an add that matched a person fills them in, once", await until(() => r().state.people.filter((p) => p.id === "p1").length === 1 && r().state.people.find((p) => p.id === "p1").email === "ann@example.org"));
  fail.on = (path, method) => method === "POST";
  const none = await r().addBoardPerson({ name: "Eve" });
  check("a failed add says so", none === null && toasts.some((t) => t.kind === "error"));
  fail.on = null;

  // A photo.
  fail.hold = (path, method) => method === "PATCH";
  const clearing = r().setPersonPhoto("p2", null);
  check("no photo: drawn at once, before the save", await until(() => r().state.people.find((p) => p.id === "p2")?.photoUrl === null));
  fail.hold = null;
  fail.open();
  await clearing;
  check("and saved as none", calls.at(-1).method === "PATCH" && calls.at(-1).body.photoUrl === null);
  fail.on = (path, method) => method === "PATCH";
  await r().setPersonPhoto("p2", null);
  check("a photo that is not saved reads the board again", refreshes === 1);
  fail.on = null;

  // A photo is cut square and made small before it is kept.
  const media = [];
  const hadBridge = window.__TAURI_INTERNALS__;
  window.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      media.push({ command, args });
      return command === "todo_media_write" ? { id: "m-face" } : null;
    },
  };
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 800, close() {} });
  const canvasProto = window.HTMLCanvasElement.prototype;
  const originalContext = canvasProto.getContext;
  const originalToBlob = canvasProto.toBlob;
  const drawn = [];
  canvasProto.getContext = () => ({ drawImage: (...args) => drawn.push(args.slice(1)) });
  canvasProto.toBlob = function (done) {
    done(new Blob([`jpeg ${this.width}x${this.height}`], { type: "image/jpeg" }));
  };
  await r().setPersonPhoto("p1", new window.File(["raw"], "face.png", { type: "image/png" }));
  const written = media.find((m) => m.command === "todo_media_write")?.args;
  check("the photo is cut from the middle, square", JSON.stringify(drawn[0]) === JSON.stringify([200, 0, 800, 800, 0, 0, 256, 256]), JSON.stringify(drawn[0]));
  check("and kept as a small JPEG", written?.contentType === "image/jpeg" && written.filename === "face.jpg", JSON.stringify(written)?.slice(0, 200));
  check("the person gets its address", calls.at(-1)?.body.id === "p1" && /m-face/.test(calls.at(-1)?.body.photoUrl ?? ""), JSON.stringify(calls.at(-1)?.body));
  canvasProto.getContext = originalContext;
  canvasProto.toBlob = originalToBlob;
  delete globalThis.createImageBitmap;
  if (hadBridge) window.__TAURI_INTERNALS__ = hadBridge;
  else delete window.__TAURI_INTERNALS__;

  // On and off a task.
  flushed(() => r().toggleTaskAssignee("u", "p2"));
  check("a person put on a task", writes.at(-1)?.id === "u" && writes.at(-1).assigneeIds.join() === "p2");
  flushed(() => r().toggleTaskAssignee("v", "p1"));
  check("a person put on a step is put on its task too", await until(() => task("u")?.assigneeIds.includes("p1")));
  check("and the menu stays open for more", r().openAssign === "t");
  flushed(() => r().toggleTaskAssignee("t", "p2"));
  check("taking off one who holds no step: no question", confirm === null && writes.at(-1)?.assigneeIds.join() === "p1");
  flushed(() => r().toggleTaskAssignee("t", "p1"));
  check("taking off one who holds a step asks first", confirm?.danger === true && confirm.title === "unassignCascadeTitle", JSON.stringify(confirm));
  check("and closes the menu, with the caret back on its button", r().openAssign === null && r().anchorEl === null && focused.length === 1);
  const before = writes.length;
  flushed(() => confirm.onConfirm());
  check("yes takes them off the task", writes.length === before + 1 && writes.at(-1).assigneeIds.length === 0);
  check("and off its steps, at once", await until(() => task("s")?.assigneeIds.length === 0));

  // Removing a person.
  await r().removeBoardPerson("p2");
  check(
    "a person removed leaves the board and every task",
    await until(() => !r().state.people.some((p) => p.id === "p2") && !r().state.tasks.some((x) => x.assigneeIds.includes("p2")))
  );
  fail.on = (path, method) => method === "DELETE";
  fail.hold = (path, method) => method === "DELETE";
  const removing = r().removeBoardPerson("p1");
  check("a remove is drawn before the server answers", await until(() => !r().state.people.some((p) => p.id === "p1")));
  fail.hold = null;
  fail.open();
  await removing;
  check("a failed remove puts the people back", await until(() => r().state.people.some((p) => p.id === "p1")));
  fail.on = null;
  hook.unmount();
  toastSink.push = null;
}

async function boardReads() {
  const React = await import("react");
  const { EMPTY_STATE, useBoardReads } = await import("@/components/todo/use-board-reads");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const reads = [];
  const answers = [];
  const api = async (path) => {
    reads.push(path);
    const next = answers.shift();
    if (typeof next === "function") return next();
    if (next instanceof Error) throw next;
    return next ?? { state: { groups: [], lists: [], tasks: [], people: [] } };
  };
  const board = (text) => ({
    state: { groups: [], lists: [], tasks: [{ id: text, text, assigneeIds: undefined, listId: null }] },
  });
  const inFlightWritesRef = { current: new Set() };
  const mutationSeqRef = { current: 0 };
  const boardLoadedRef = { current: false };
  const refreshRef = { current: async () => {} };
  const hook = renderHook((args) => {
    const [state, setState] = React.useState(EMPTY_STATE);
    const out = useBoardReads({ state, setState, api, inFlightWritesRef, mutationSeqRef, boardLoadedRef, refreshRef, t: EN_T, ...args });
    return { ...out, state };
  }, { editingTaskId: null, editingDurationTaskId: null });
  const r = () => hook.result();
  const texts = () => r().state.tasks.map((t) => t.text).join();

  answers.push(board("First"));
  check("the board is read on mount", await until(() => texts() === "First"));
  check("with the reader's day", /^\/api\/todo\/state\?today=\d{4}-\d{2}-\d{2}$/.test(reads[0]), reads[0]);
  check("and marked as read", boardLoadedRef.current === true);
  check("people and assignees are filled in", Array.isArray(r().state.people) && Array.isArray(r().state.tasks[0].assigneeIds));
  check("the refresh is handed to the page's ref", refreshRef.current === r().refresh);

  // A burst of asks is one read.
  reads.length = 0;
  answers.push(board("Second"));
  void r().refresh();
  void r().refresh();
  await r().refresh();
  check("three asks at once are one read", reads.length === 1 && (await until(() => texts() === "Second")), reads.length);

  // An ask while a read is running: one more read after it.
  reads.length = 0;
  answers.push(() => {
    void r().refresh();
    return board("While asked");
  });
  answers.push(board("Asked again"));
  await r().refresh();
  check("an ask during a read gets one more read", (await until(() => texts() === "Asked again")) && reads.length === 2, reads.length);

  // A write in the air: its read waits for it.
  reads.length = 0;
  let finishWrite;
  const write = new Promise((resolve) => (finishWrite = resolve));
  inFlightWritesRef.current.add(write);
  answers.push(board("After the write"));
  const waiting = r().refresh();
  await sleep(200);
  check("a read waits for a write in the air", reads.length === 0);
  inFlightWritesRef.current.clear();
  finishWrite();
  await waiting;
  check("and then reads", await until(() => texts() === "After the write"));

  // A write during the read makes its answer old: it is read again.
  reads.length = 0;
  answers.push(() => {
    mutationSeqRef.current += 1;
    return board("Too old");
  });
  answers.push(board("Fresh"));
  await r().refresh();
  check("an answer older than a write is not shown, and the board is read again", (await until(() => texts() === "Fresh")) && reads.length === 2, texts());
  reads.length = 0;
  for (let i = 0; i < 4; i += 1) {
    answers.push(() => {
      mutationSeqRef.current += 1;
      return board(`Old ${i}`);
    });
  }
  await r().refresh();
  check("three reads is the ceiling", reads.length === 3, reads.length);
  answers.length = 0;

  // A read that fails.
  toasts.length = 0;
  answers.push(new TypeError("Load failed"), board("After a blip"));
  await r().refresh();
  check("a network blip is read again once, quietly", (await until(() => texts() === "After a blip")) && toasts.length === 0);
  answers.push(new TypeError("Load failed"), new TypeError("Load failed"));
  await r().refresh();
  check("a second blip is said", toasts.some((t) => t.kind === "error" && t.message === "Failed to load tasks. Check the connection."));
  answers.push(new Error("the board is gone"));
  await r().refresh();
  check("another failure is said with its reason", toasts.some((t) => t.kind === "error" && t.message.includes("the board is gone")));

  // Back to the front: read again, not more than once in ten seconds, and
  // not while a task's words are being written.
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  reads.length = 0;
  answers.push(board("Back"), board("Back again"));
  document.dispatchEvent(new window.Event("visibilitychange"));
  await sleep(250);
  check("back to the front within ten seconds: no read", reads.length === 0);
  clock += 11_000;
  window.dispatchEvent(new window.Event("focus"));
  check("after ten seconds: a read", await until(() => texts() === "Back"));
  clock += 11_000;
  hook.rerender({ editingTaskId: "t1", editingDurationTaskId: null });
  window.dispatchEvent(new window.Event("focus"));
  await sleep(250);
  check("not while a task's words are being written", texts() === "Back");
  hook.rerender({ editingTaskId: null, editingDurationTaskId: "t2" });
  window.dispatchEvent(new window.Event("focus"));
  await sleep(250);
  check("nor its length", texts() === "Back");
  Date.now = realNow;

  // The note editor is fetched a moment after the board is up.
  check("the note editor is fetched early", Boolean(document.querySelector("script[data-trix]")));
  hook.unmount();
  toastSink.push = null;
}

async function groupsAndLists() {
  const React = await import("react");
  const { useGroupsAndLists } = await import("@/components/todo/use-groups");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const calls = [];
  const fail = { on: null };
  let made = 0;
  const api = async (path, method, body) => {
    calls.push({ path, method, body });
    if (fail.on?.(path, method)) throw new Error("no");
    if (path === "/api/todo/groups" && method === "POST") return { group: { id: `g-new${++made}`, name: body.name, colour: body.colour ?? null, position: 9 } };
    if (path === "/api/todo/lists" && method === "POST") return { list: { id: body.id, name: body.name, groupId: body.groupId } };
    if (path === "/api/todo/lists" && method === "PATCH") return { list: { ...body } };
    return {};
  };
  let refreshes = 0;
  let confirm = null;
  const undos = [];
  const remade = [];
  const seedLists = [
    { id: "l1", name: "Attic", groupId: null, colour: "#111111", emoji: "star", basecampProjectId: "p", basecampListId: "b", remindersListId: null },
    { id: "l2", name: "Barn", groupId: null },
  ];
  const seedTasks = [
    { id: "t1", listId: "l1", completed: false },
    { id: "t2", listId: "l1", completed: true },
    { id: "t3", listId: "l2", completed: false },
  ];
  localStorage.removeItem("redd-plan-todo-groups");
  const hook = renderHook((args) => {
    const [state, setState] = React.useState({ groups: args.groups, lists: seedLists, tasks: seedTasks, people: [] });
    const [groupsEnabled, setGroupsEnabled] = React.useState(false);
    const [currentGroupId, setCurrentGroupId] = React.useState(null);
    const [currentListId, setCurrentListId] = React.useState(args.currentListId);
    const out = useGroupsAndLists({
      state,
      setState,
      api,
      refresh: async () => {
        refreshes += 1;
      },
      t: (key) => key,
      lists: state.lists.filter((l) => !groupsEnabled || l.groupId === currentGroupId),
      currentListId,
      currentGroupId,
      setGroupsEnabled,
      setCurrentGroupId,
      setCurrentListId,
      setConfirmModal: (next) => (confirm = next),
      showUndo: (label, restore) => undos.push({ label, restore }),
      recreateTask: async (task) => remade.push(task),
    });
    return { ...out, state, groupsEnabled, currentGroupId, currentListId };
  }, { groups: [], currentListId: "l1" });
  const r = () => hook.result();

  // Groups on for the first time: a group, and every list in it.
  flushed(() => r().handleGroupsEnabledChange(true));
  check("groups on is kept", r().groupsEnabled && localStorage.getItem("redd-plan-todo-groups") === "1");
  check("the first time makes a group", await until(() => r().state.groups.length === 1) && calls.some((c) => c.path === "/api/todo/groups" && c.body.name === "General"));
  check("and puts every list in it", await until(() => r().state.lists.every((l) => l.groupId === "g-new1")) && calls.filter((c) => c.method === "PATCH" && c.body.groupId === "g-new1").length === 2);
  check("and opens it", r().currentGroupId === "g-new1" && localStorage.getItem("redd-plan-todo-current-group") === "g-new1");
  flushed(() => r().handleGroupsEnabledChange(false));
  check("groups off is kept", !r().groupsEnabled && localStorage.getItem("redd-plan-todo-groups") === "0");
  hook.unmount();

  // On again, with groups made: lists made meanwhile join the first group.
  let h2 = renderHook((args) => {
    const [state, setState] = React.useState({
      groups: [{ id: "gB", name: "B", position: 2 }, { id: "gA", name: "A", position: 1 }],
      lists: [{ id: "l1", name: "Attic", groupId: "gB" }, { id: "l2", name: "Barn", groupId: null }],
      tasks: [],
      people: [],
    });
    const [currentListId, setCurrentListId] = React.useState(null);
    const [currentGroupId, setCurrentGroupId] = React.useState("gB");
    const out = useGroupsAndLists({
      state,
      setState,
      api,
      refresh: async () => {
        refreshes += 1;
      },
      t: (key) => key,
      lists: state.lists,
      currentListId,
      currentGroupId,
      setGroupsEnabled: () => {},
      setCurrentGroupId,
      setCurrentListId,
      setConfirmModal: (next) => (confirm = next),
      showUndo: (label, restore) => undos.push({ label, restore }),
      recreateTask: async (task) => remade.push(task),
      ...args,
    });
    return { ...out, state, currentListId, currentGroupId };
  }, {});
  calls.length = 0;
  flushed(() => h2.result().handleGroupsEnabledChange(true));
  check("lists without a group join the first group", await until(() => h2.result().state.lists.find((l) => l.id === "l2")?.groupId === "gA"));
  check("and no group is made", !calls.some((c) => c.path === "/api/todo/groups"));
  // A list made while groups were off, and the adoption fails.
  toasts.length = 0;
  const adoptFailures = refreshes;
  h2.unmount();
  h2 = renderHook(() => {
    const [state, setState] = React.useState({
      groups: [{ id: "gA", name: "A", position: 1 }],
      lists: [{ id: "l9", name: "Loose", groupId: null }],
      tasks: [],
      people: [],
    });
    return useGroupsAndLists({
      state, setState, api, refresh: async () => {
        refreshes += 1;
      },
      t: (key) => key, lists: state.lists, currentListId: null, currentGroupId: "gA",
      setGroupsEnabled: () => {}, setCurrentGroupId: () => {}, setCurrentListId: () => {},
      setConfirmModal: () => {}, showUndo: () => {}, recreateTask: async () => {},
    });
  });
  fail.on = (path, method) => method === "PATCH";
  flushed(() => h2.result().handleGroupsEnabledChange(true));
  check("a failed adoption is said, and the board read again", await until(() => toasts.some((t) => t.kind === "error") && refreshes === adoptFailures + 1));
  fail.on = null;
  h2.unmount();
  h2 = renderHook(() => {
    const [state, setState] = React.useState({
      groups: [],
      lists: [{ id: "l1", name: "Attic", groupId: "gB" }, { id: "l2", name: "Barn", groupId: "gB" }],
      tasks: [],
      people: [],
    });
    const [currentListId, setCurrentListId] = React.useState(null);
    const [currentGroupId, setCurrentGroupId] = React.useState(null);
    const out = useGroupsAndLists({
      state, setState, api, refresh: async () => {}, t: (key) => key, lists: state.lists, currentListId, currentGroupId,
      setGroupsEnabled: () => {}, setCurrentGroupId, setCurrentListId,
      setConfirmModal: () => {}, showUndo: () => {}, recreateTask: async () => {},
    });
    return { ...out, state, currentListId, currentGroupId };
  });
  flushed(() => h2.result().switchToGroup("gB"));
  check("a group with more lists opens on its All tab", h2.result().currentListId === "__all__" && localStorage.getItem("redd-plan-todo-current-list") === "__all__");
  h2.unmount();
  h2 = renderHook(() => {
    const [state, setState] = React.useState({
      groups: [],
      lists: [{ id: "l1", name: "Attic", groupId: "gB" }],
      tasks: [],
      people: [],
    });
    const [currentListId, setCurrentListId] = React.useState(null);
    const [currentGroupId, setCurrentGroupId] = React.useState(null);
    const out = useGroupsAndLists({
      state, setState, api, refresh: async () => {}, t: (key) => key, lists: state.lists, currentListId, currentGroupId,
      setGroupsEnabled: () => {}, setCurrentGroupId, setCurrentListId,
      setConfirmModal: () => {}, showUndo: () => {}, recreateTask: async () => {},
    });
    return { ...out, state, currentListId, currentGroupId };
  });

  // Groups off does nothing more than that.
  const offHook = renderHook(() => {
    const [state, setState] = React.useState({ groups: [{ id: "gA", name: "A", position: 1 }], lists: [{ id: "l9", name: "Loose", groupId: null }], tasks: [], people: [] });
    return useGroupsAndLists({
      state, setState, api, refresh: async () => {}, t: (key) => key, lists: state.lists, currentListId: null, currentGroupId: "gA",
      setGroupsEnabled: () => {}, setCurrentGroupId: () => {}, setCurrentListId: () => {},
      setConfirmModal: () => {}, showUndo: () => {}, recreateTask: async () => {},
    });
  });
  calls.length = 0;
  flushed(() => offHook.result().handleGroupsEnabledChange(false));
  await sleep(30);
  check("groups off writes nothing to the lists", calls.length === 0, JSON.stringify(calls));
  offHook.unmount();

  // Opening a group: its one list, its All tab, or nothing.
  flushed(() => h2.result().switchToGroup("gB"));
  check("a group with one list opens on it", h2.result().currentGroupId === "gB" && h2.result().currentListId === "l1" && localStorage.getItem("redd-plan-todo-current-list") === "l1");
  flushed(() => h2.result().switchToGroup("gZ"));
  check("a group with none opens on nothing", h2.result().currentListId === null && localStorage.getItem("redd-plan-todo-current-list") === "");
  h2.unmount();

  // Deleting a group: asked, then gone with its lists and tasks, and undone.
  const h3 = renderHook(() => {
    const [state, setState] = React.useState({
      groups: [{ id: "gA", name: "A", colour: "#abcdef", position: 1 }, { id: "gB", name: "B", position: 2 }],
      lists: [{ id: "l1", name: "Attic", groupId: "gA", colour: "#222222", emoji: "star", basecampProjectId: "p1", basecampListId: "bl1", remindersListId: "rem-1" }, { id: "l2", name: "Barn", groupId: "gA" }, { id: "l3", name: "Cave", groupId: "gB" }],
      tasks: [{ id: "t1", listId: "l1", completed: false }, { id: "t2", listId: "l2", completed: true }, { id: "t3", listId: "l3", completed: false }, { id: "t4", listId: null, completed: false }],
      people: [],
    });
    const [currentListId, setCurrentListId] = React.useState("__all__");
    const [currentGroupId, setCurrentGroupId] = React.useState("gA");
    const out = useGroupsAndLists({
      state,
      setState,
      api,
      refresh: async () => {
        refreshes += 1;
      },
      t: (key) => (key === "deleteGroupMessage" ? "{name}|{lists}|{open}|{done}" : key),
      lists: state.lists.filter((l) => l.groupId === currentGroupId),
      currentListId,
      currentGroupId,
      setGroupsEnabled: () => {},
      setCurrentGroupId,
      setCurrentListId,
      setConfirmModal: (next) => (confirm = next),
      showUndo: (label, restore) => undos.push({ label, restore }),
      recreateTask: async (task) => remade.push(task),
    });
    return { ...out, state, currentListId, currentGroupId };
  });
  const g = () => h3.result();
  confirm = null;
  flushed(() => g().removeGroup(g().state.groups[0]));
  check(
    "a group's delete asks first, in the user's language",
    confirm?.danger === true && confirm.title === "deleteGroupTitle" && confirm.message === "A|2|1|1",
    JSON.stringify(confirm)
  );
  calls.length = 0;
  flushed(() => confirm.onConfirm());
  check(
    "then the group goes, with its lists and their tasks",
    !g().state.groups.some((x) => x.id === "gA") && g().state.lists.map((l) => l.id).join() === "l3" && g().state.tasks.map((x) => x.id).join() === "t3,t4"
  );
  check("and the open group is none", g().currentGroupId === null);
  check("it is deleted, with an undo", await until(() => undos.at(-1)?.label === "groupDeleted") && calls.some((c) => c.method === "DELETE" && c.path.includes("id=gA")));
  calls.length = 0;
  remade.length = 0;
  undos.at(-1).restore();
  check("undo makes the group again", await until(() => calls.some((c) => c.path === "/api/todo/groups" && c.body.name === "A" && c.body.colour === "#abcdef")));
  check("with its lists", await until(() => calls.filter((c) => c.path === "/api/todo/lists" && c.method === "POST" && c.body.groupId?.startsWith("g-new")).length === 2));
  check("and their tasks, on the new lists", await until(() => remade.length === 2 && remade.every((x) => x.listId !== "l1" && x.listId !== "l2")));
  const attic = calls.find((c) => c.path === "/api/todo/lists" && c.method === "POST" && c.body.name === "Attic")?.body;
  check("each list comes back with its colour and emoji", attic?.colour === "#222222" && attic.emoji === "star", JSON.stringify(attic));
  check(
    "and its Basecamp and Reminders links",
    await until(() =>
      calls.some((c) => c.path === "/api/todo/lists" && c.method === "PATCH" && c.body.basecampProjectId === "p1" && c.body.basecampListId === "bl1" && c.body.remindersListId === "rem-1")
    )
  );
  const lastOne = renderHook(() => {
    const [state, setState] = React.useState({ groups: [{ id: "gA", name: "A", position: 1 }], lists: [], tasks: [], people: [] });
    return useGroupsAndLists({
      state, setState, api, refresh: async () => {}, t: (key) => key, lists: [], currentListId: null, currentGroupId: "gA",
      setGroupsEnabled: () => {}, setCurrentGroupId: () => {}, setCurrentListId: () => {},
      setConfirmModal: (next) => (confirm = next), showUndo: () => {}, recreateTask: async () => {},
    });
  });
  confirm = null;
  toasts.length = 0;
  flushed(() => lastOne.result().removeGroup({ id: "gA", name: "A" }));
  check("the last group cannot go", confirm === null && toasts.some((t) => t.message === "keepOneGroup"), JSON.stringify(toasts));
  lastOne.unmount();

  // Deleting a list.
  confirm = null;
  flushed(() => g().removeList(g().state.lists[0]));
  check("a list's delete asks first", confirm?.danger === true && confirm.title === "deleteList");
  calls.length = 0;
  flushed(() => confirm.onConfirm());
  check("then the list goes, with its tasks", !g().state.lists.some((l) => l.id === "l3") && !g().state.tasks.some((x) => x.listId === "l3"));
  check("it is deleted, with an undo", await until(() => undos.at(-1)?.label === "listDeleted") && calls.some((c) => c.method === "DELETE" && c.path.includes("id=l3")));
  h3.unmount();

  // A list removed while it is open: the page goes to what is left.
  const h4 = renderHook((args) => {
    const [state, setState] = React.useState({ groups: [], lists: args.lists, tasks: [{ id: "t1", listId: "l1", completed: false }], people: [] });
    const [currentListId, setCurrentListId] = React.useState(args.open);
    const out = useGroupsAndLists({
      state, setState, api, refresh: async () => {
        refreshes += 1;
      },
      t: (key) => key, lists: state.lists, currentListId, currentGroupId: null,
      setGroupsEnabled: () => {}, setCurrentGroupId: () => {}, setCurrentListId,
      setConfirmModal: (next) => (confirm = next), showUndo: (label, restore) => undos.push({ label, restore }),
      recreateTask: async (task) => remade.push(task),
    });
    return { ...out, state, currentListId };
  }, {
    lists: [
      { id: "l1", name: "Attic", colour: "#111111", emoji: "star", groupId: null, basecampProjectId: "p", basecampListId: "b", remindersListId: null },
      { id: "l2", name: "Barn" },
      { id: "l3", name: "Cave" },
    ],
    open: "l1",
  });
  flushed(() => h4.result().removeList(h4.result().state.lists[0]));
  flushed(() => confirm.onConfirm());
  check("the open list removed: two left, the All tab", h4.result().currentListId === "__all__" && localStorage.getItem("redd-plan-todo-current-list") === "__all__");
  await until(() => undos.at(-1)?.label === "listDeleted");
  calls.length = 0;
  remade.length = 0;
  // A host without the restore route: Undo makes the list again.
  fail.on = (path) => path === "/api/todo/lists/deleted";
  undos.at(-1).restore();
  const back = () => calls.find((c) => c.path === "/api/todo/lists" && c.method === "POST")?.body;
  check("without the route, undo makes the list again, with its look", await until(() => back()?.name === "Attic" && back().colour === "#111111" && back().emoji === "star"));
  check("and its links", await until(() => calls.some((c) => c.method === "PATCH" && c.body.basecampListId === "b" && c.body.basecampProjectId === "p")));
  check("and its tasks", await until(() => remade.length === 1 && remade[0].listId === back()?.id));
  fail.on = null;
  // A deleted list is kept with its tasks: Undo brings that one back.
  flushed(() => h4.result().removeList(h4.result().state.lists[0]));
  flushed(() => confirm.onConfirm());
  await until(() => undos.at(-1)?.label === "listDeleted" && calls.some((c) => c.method === "DELETE" && c.path.includes("id=l2")));
  calls.length = 0;
  remade.length = 0;
  undos.at(-1).restore();
  check(
    "undo brings the same list back",
    await until(() => calls.some((c) => c.path === "/api/todo/lists/deleted" && c.method === "POST" && c.body?.id === "l2"))
  );
  check(
    "and makes no copy of it",
    !calls.some((c) => c.path === "/api/todo/lists" && c.method === "POST") && remade.length === 0
  );
  h4.unmount();
  const h5 = renderHook(() => {
    const [state, setState] = React.useState({ groups: [], lists: [{ id: "l1", name: "Attic" }, { id: "l2", name: "Barn" }], tasks: [], people: [] });
    const [currentListId, setCurrentListId] = React.useState("l1");
    const out = useGroupsAndLists({
      state, setState, api, refresh: async () => {
        refreshes += 1;
      },
      t: (key) => key, lists: state.lists, currentListId, currentGroupId: null,
      setGroupsEnabled: () => {}, setCurrentGroupId: () => {}, setCurrentListId,
      setConfirmModal: (next) => (confirm = next), showUndo: () => {}, recreateTask: async () => {},
    });
    return { ...out, state, currentListId };
  });
  flushed(() => h5.result().removeList(h5.result().state.lists[0]));
  fail.on = (path, method) => method === "DELETE";
  toasts.length = 0;
  const before = refreshes;
  flushed(() => confirm.onConfirm());
  check("the open list removed: one left, it opens", h5.result().currentListId === "l2");
  check("a failed delete is said and the board read again", await until(() => toasts.some((t) => t.kind === "error") && refreshes === before + 1));
  fail.on = null;
  h5.unmount();
  toastSink.push = null;
  localStorage.removeItem("redd-plan-todo-groups");
  localStorage.removeItem("redd-plan-todo-current-group");
  localStorage.removeItem("redd-plan-todo-current-list");
}

async function titleEdit() {
  const React = await import("react");
  const { useTitleEdit } = await import("@/components/todo/use-title-edit");
  const writes = [];
  const went = [];
  const editingTextRef = { current: "" };
  const hook = renderHook((args) => {
    const [editingTaskId, setEditingTaskId] = React.useState(null);
    const [editingDuration, setEditingDuration] = React.useState("");
    const [editingDurationTaskId, setEditingDurationTaskId] = React.useState("d");
    const out = useTitleEdit({
      navigateToList: (id) => went.push(id),
      editingTextRef,
      editingTaskId,
      setEditingTaskId,
      editingDuration,
      setEditingDurationTaskId,
      mutateTask: async (id, patch) => writes.push({ id, ...patch }),
      ...args,
    });
    return { ...out, editingTaskId, setEditingTaskId, setEditingDuration, editingDurationTaskId };
  }, { view: "lists" });
  const r = () => hook.result();
  const box = document.createElement("textarea");
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 57 });
  r().editInputRef.current = box;
  flushed(() => r().startEditTask({ id: "a", text: "Old words", listId: "L" }));
  check("a click on the words edits them", r().editingTaskId === "a" && editingTextRef.current === "Old words");
  check("and the box is as tall as the words", box.style.height === "57px", box.style.height);
  Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => 80 });
  r().resizeEditTextarea(box);
  check("the box grows with them", box.style.height === "80px");
  editingTextRef.current = "  New words ";
  flushed(() => r().commitEditTask());
  check("closing saves the words, trimmed", writes.at(-1)?.id === "a" && writes.at(-1).text === "New words" && r().editingTaskId === null);
  flushed(() => r().startEditTask({ id: "b", text: "Keep", listId: "L" }));
  editingTextRef.current = "   ";
  const count = writes.length;
  flushed(() => r().commitEditTask());
  check("empty words are not saved", writes.length === count && r().editingTaskId === null);

  // The length box.
  flushed(() => r().setEditingDuration("45"));
  flushed(() => r().commitEditDuration({ id: "c", completed: false }));
  check("a length is saved in minutes", writes.at(-1)?.expectedDurationMinutes === 45 && r().editingDurationTaskId === null);
  flushed(() => r().commitEditDuration({ id: "c", completed: true }));
  check("on a done task it is the time spent", writes.at(-1)?.timeSpentSeconds === 2700);
  flushed(() => r().setEditingDuration(""));
  flushed(() => r().commitEditDuration({ id: "c", completed: true }));
  check("an empty box on a done task is no time", writes.at(-1)?.timeSpentSeconds === 0);

  // Where the caret goes when the words close.
  const card = document.createElement("div");
  card.className = "task-item";
  card.dataset.taskId = "e";
  card.innerHTML = `<button class="before">b</button><span class="task-text" tabindex="0">Words</span><button class="after">a</button>`;
  document.body.appendChild(card);
  const rects = window.Element.prototype.getClientRects;
  window.Element.prototype.getClientRects = () => [{ width: 10, height: 10 }];
  flushed(() => r().startEditTask({ id: "e", text: "Words", listId: "L" }));
  r().caretAfterEditRef.current = { taskId: "e", step: 1 };
  flushed(() => r().setEditingTaskId(null));
  check("Tab from the words goes on to the next control", document.activeElement === card.querySelector(".after"));
  check("and the step is used once", r().caretAfterEditRef.current === null);
  flushed(() => r().startEditTask({ id: "e", text: "Words", listId: "L" }));
  r().caretAfterEditRef.current = { taskId: "e", step: -1 };
  flushed(() => r().setEditingTaskId(null));
  check("Shift+Tab goes back to the one before", document.activeElement === card.querySelector(".before"));
  flushed(() => r().startEditTask({ id: "e", text: "Words", listId: "L" }));
  r().caretAfterEditRef.current = { taskId: "e", step: 0 };
  flushed(() => r().setEditingTaskId(null));
  check("Enter leaves the caret on the words", document.activeElement === card.querySelector(".task-text"));
  card.querySelector(".after").focus();
  flushed(() => r().startEditTask({ id: "e", text: "Words", listId: "L" }));
  flushed(() => r().setEditingTaskId(null));
  check("a click elsewhere leaves the caret where it is", document.activeElement === card.querySelector(".after"));
  window.Element.prototype.getClientRects = rects;
  card.remove();

  // In Favourites, the words take the reader to the task's list.
  hook.rerender({ view: "favourites" });
  flushed(() => r().startEditTask({ id: "f", text: "Fav", listId: "L7" }));
  check("in Favourites, the words open the task's list", went.join() === "L7" && r().editingTaskId === null);
  hook.unmount();
}

async function calendarCard() {
  const React = await import("react");
  const { useCalendarCard, useCalendarCardState } = await import("@/components/todo/use-calendar-card");
  const tasks = [{ id: "a", completed: false }, { id: "b", completed: false }];
  const hook = renderHook((args) => {
    const [state, setState] = React.useState({ groups: [], lists: [], people: [], tasks });
    const calendarCardState = useCalendarCardState({ view: args.view });
    const out = useCalendarCard({
      calendarCardState,
      state,
      zoom: args.zoom,
      duePopoverTaskId: null,
      openMenuTaskId: null,
      openListPickerTaskId: null,
      openAssignTaskId: null,
      editingTaskId: args.editingTaskId ?? null,
      openNotesTaskId: null,
    });
    return { ...out, ...calendarCardState, setState };
  }, { view: "plan", zoom: 100 });
  const r = () => hook.result();
  const anchor = { left: 100, top: 200, bottom: 220 };
  flushed(() => r().openCalendarNewTask({ date: "2026-10-01" }));
  check("a double-click on a day opens the add-task box", r().calendarNew?.date === "2026-10-01");
  flushed(() => r().openCalendarTask("a", anchor));
  check("a click on a task opens its card, and the box goes", r().calendarCard?.taskId === "a" && r().calendarNew === null);
  flushed(() => r().openCalendarNewTask({ date: "2026-10-02" }));
  check("the box in turn puts the card away", r().calendarCard === null && r().calendarNew?.date === "2026-10-02");
  flushed(() => r().openCalendarTask("a", anchor));

  // Put away: a press on the Calendar or the top bar, not on the card.
  const plan = document.createElement("div");
  plan.id = "plan-mode";
  const card = document.createElement("div");
  card.className = "calendar-task-popover";
  plan.appendChild(card);
  document.body.appendChild(plan);
  flushed(() => card.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true })));
  check("a press on the card keeps it", r().calendarCard?.taskId === "a");
  flushed(() => plan.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true })));
  check("a press on the Calendar puts it away", r().calendarCard === null);
  flushed(() => r().openCalendarTask("a", anchor));
  check("the click of that press does not bring it back", r().calendarCard === null);
  await sleep(520);
  flushed(() => r().openCalendarTask("a", anchor));
  check("a click a moment later does", r().calendarCard?.taskId === "a");
  flushed(() => r().openCalendarTask("b", anchor));

  // Escape: not while the card is busy, nor while one of its menus is up.
  hook.rerender({ view: "plan", zoom: 100, editingTaskId: "b" });
  flushed(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  check("Escape leaves a card whose words are being written", r().calendarCard?.taskId === "b");
  hook.rerender({ view: "plan", zoom: 100 });
  const menu = document.createElement("div");
  menu.className = "todo-menu-portal-root";
  document.body.appendChild(menu);
  flushed(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  check("Escape is for a menu of the card first", r().calendarCard?.taskId === "b");
  menu.remove();
  flushed(() => window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" })));
  check("then puts the card away", r().calendarCard === null);

  // A task ticked or deleted: its card goes after a moment.
  flushed(() => r().openCalendarTask("a", anchor));
  flushed(() => r().setState((st) => ({ ...st, tasks: st.tasks.map((x) => (x.id === "a" ? { ...x, completed: true } : x)) })));
  await sleep(300);
  check("a ticked task's card stays a moment", r().calendarCard?.taskId === "a");
  check("then goes", await until(() => r().calendarCard === null, 1500));

  // Leaving the Calendar puts both away.
  flushed(() => r().openCalendarTask("b", anchor));
  hook.rerender({ view: "lists", zoom: 100 });
  check("leaving the Calendar puts the card away", await until(() => r().calendarCard === null));
  flushed(() => r().openCalendarNewTask({ date: "2026-10-03" }));
  hook.rerender({ view: "plan", zoom: 100 });
  hook.rerender({ view: "lists", zoom: 100 });
  check("and the box", await until(() => r().calendarNew === null));

  // Where the card stands: under the task, or over it low in the window,
  // in the zoomed shell's pixels.
  const w = window.innerWidth;
  const h = window.innerHeight;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  const under = r().calendarPopoverPlace({ left: 100, top: 200, bottom: 220 });
  check("under the task, 420 wide", under.top === 230 && under.left === 100 && under.width === 420, JSON.stringify(under));
  const over = r().calendarPopoverPlace({ left: 900, top: 700, bottom: 720 });
  check("over it when it is low, and inside the window", over.bottom === 110 && over.left === 1000 - 420 - 12, JSON.stringify(over));
  hook.rerender({ view: "lists", zoom: 200 });
  const zoomed = r().calendarPopoverPlace({ left: 100, top: 200, bottom: 220 });
  check("in the zoomed shell's pixels", zoomed.left === 50 && zoomed.top === 120, JSON.stringify(zoomed));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
  hook.rerender({ view: "lists", zoom: 100 });
  check("a narrow window: the card is its width less a margin", r().calendarPopoverPlace({ left: 0, top: 0, bottom: 10 }).width === 276);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
  plan.remove();
  hook.unmount();
}

async function cardMenus() {
  const { useCardMenusClose, useCardMenusState } = await import("@/components/todo/use-card-menus");
  const hook = renderHook(() => {
    const cardMenus = useCardMenusState();
    useCardMenusClose(cardMenus);
    return cardMenus;
  });
  const r = () => hook.result();
  const click = () => flushed(() => window.dispatchEvent(new window.MouseEvent("click")));
  flushed(() => {
    r().setOpenMenuTaskId("a");
    r().setMenuShowsMoveTargets(true);
    r().setMenuAnchorEl(document.body);
  });
  click();
  check("a click anywhere puts the card's menu away", r().openMenuTaskId === null && r().menuAnchorEl === null);
  check("and it opens next time on its first page", r().menuShowsMoveTargets === false);
  flushed(() => r().setOpenListPickerTaskId("a"));
  click();
  check("and the list picker", r().openListPickerTaskId === null);
  flushed(() => {
    r().setOpenAssignTaskId("a");
    r().setAssignAnchorEl(document.body);
  });
  click();
  check("and the people menu", r().openAssignTaskId === null && r().assignAnchorEl === null);
  hook.unmount();
}

async function boardNudge() {
  const React = await import("react");
  const { useBoardNudge } = await import("@/components/todo/use-board-nudge");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  localStorage.removeItem("redd-plan-todo-board-nudge-seen");
  localStorage.removeItem("redd-plan-todo-kanban");
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
  const hook = renderHook((args) => {
    const [kanbanEnabled, setKanbanEnabled] = React.useState(false);
    return { ...useBoardNudge({ kanbanEnabled, setKanbanEnabled, t: (key) => key, ...args }), kanbanEnabled };
  }, { flatListTasks: many(9) });
  const r = () => hook.result();
  hook.rerender({ flatListTasks: many(10) });
  await sleep(30);
  check("a long list alone does not bring the note", !r().boardNudgeOpen);
  r().addedInListViewRef.current = true;
  hook.rerender({ flatListTasks: many(11) });
  check("a task added to a long list brings it", await until(() => r().boardNudgeOpen));
  check("and the add is used once", r().addedInListViewRef.current === false);
  flushed(() => r().answerBoardNudge(false));
  check("not now: the note goes, and is not shown again", !r().boardNudgeOpen && localStorage.getItem("redd-plan-todo-board-nudge-seen") === "1");
  check("and says where Board View is", toasts.some((t) => t.message === "boardNudgeLater"));
  r().addedInListViewRef.current = true;
  hook.rerender({ flatListTasks: many(12) });
  await sleep(30);
  check("seen once, it does not come back", !r().boardNudgeOpen);
  localStorage.removeItem("redd-plan-todo-board-nudge-seen");
  r().addedInListViewRef.current = true;
  hook.rerender({ flatListTasks: many(5) });
  await sleep(30);
  check("a short list does not bring it", !r().boardNudgeOpen);
  r().addedInListViewRef.current = true;
  hook.rerender({ flatListTasks: many(13) });
  await until(() => r().boardNudgeOpen);
  flushed(() => r().answerBoardNudge(true));
  check("try: Board View comes on, and is kept", r().kanbanEnabled && localStorage.getItem("redd-plan-todo-kanban") === "1" && !r().boardNudgeOpen);
  hook.unmount();
  toastSink.push = null;
  localStorage.removeItem("redd-plan-todo-board-nudge-seen");
  localStorage.removeItem("redd-plan-todo-kanban");
}

async function columnDrag() {
  const React = await import("react");
  const { useColumnDrag } = await import("@/components/todo/use-board-layout");
  const stored = [];
  const hook = renderHook((args) => {
    const [columnOrder, setColumnOrder] = React.useState(["backlog", "week", "today"]);
    const [draggingColumn, setDraggingColumn] = React.useState(null);
    const out = useColumnDrag({
      columnOrder,
      setColumnOrder,
      setDraggingColumn,
      storeColumnOrder: (seen) => stored.push(seen.join()),
      ...args,
    });
    return { ...out, columnOrder, draggingColumn, setColumnOrder };
  }, { boardStacked: false });
  const r = () => hook.result();
  const columns = {};
  for (const name of ["backlog", "week", "today", "someday"]) {
    const el = document.createElement("div");
    el.dataset.boardColumn = name;
    document.body.appendChild(el);
    columns[name] = el;
  }
  let aim = null;
  const undoPoint = stubPointAt(() => aim);
  const heading = document.createElement("div");
  const press = (column, target = heading) =>
    flushed(() => r().startColumnDrag({ button: 0, clientX: 10, clientY: 10, target, preventDefault() {} }, column));
  const move = (over, x = 100) => {
    aim = columns[over] ?? null;
    flushed(() => window.dispatchEvent(new window.PointerEvent("pointermove", { clientX: x, clientY: 10 })));
  };
  const up = (type = "pointerup") => flushed(() => window.dispatchEvent(new window.PointerEvent(type, {})));

  press("today");
  move("today", 12);
  check("a small move does not carry the column", r().draggingColumn === null);
  move("backlog");
  check("carried, it is the one drawn as carried", r().draggingColumn === "today");
  check("and the order follows the pointer", r().columnOrder.join() === "today,backlog,week", r().columnOrder.join());
  move("someday");
  check("Someday is no place to put it", r().columnOrder.join() === "today,backlog,week");
  up();
  check("let go, the carry ends and the order is kept", r().draggingColumn === null && stored.at(-1) === "today,backlog,week", stored.join("|"));
  move("week");
  check("after, the pointer moves nothing", r().columnOrder.join() === "today,backlog,week");

  // Stacked, the board reads the order the other way up.
  flushed(() => r().setColumnOrder(["backlog", "week", "today"]));
  hook.rerender({ boardStacked: true });
  press("today");
  move("backlog");
  check("stacked, the order is turned over for the carry", r().columnOrder.join() === "today,backlog,week", r().columnOrder.join());
  up("pointercancel");
  check("a carry the browser calls off ends it too", r().draggingColumn === null && stored.at(-1) === "week,backlog,today", stored.join("|"));

  // Not carried: Someday's heading, and a press on a button in a heading.
  const count = stored.length;
  press("someday");
  move("week");
  up();
  check("Someday's heading does not carry", r().draggingColumn === null && stored.length === count);
  const button = document.createElement("button");
  heading.appendChild(button);
  press("week", button);
  move("today");
  up();
  check("a press on a button in the heading does not carry", stored.length === count);
  undoPoint();
  for (const el of Object.values(columns)) el.remove();
  hook.unmount();
}

async function settings() {
  const { settingsActions } = await import("@/components/todo/settings-actions");
  const set = {};
  const setter = (name) => (value) => (set[name] = value);
  const writes = [];
  const posted = [];
  let menuClosed = 0;
  const tasks = [
    { id: "a", completed: false, isSomeday: true },
    { id: "b", completed: true, isSomeday: true },
    { id: "c", completed: false, isSomeday: false },
  ];
  const a = settingsActions({
    setLang: setter("lang"),
    setTheme: setter("theme"),
    setZoom: setter("zoom"),
    setKanbanEnabled: setter("kanban"),
    setSomedayEnabled: setter("someday"),
    setAssignEnabled: setter("assign"),
    setFocusTimerAlways: setter("timer"),
    setPlanEnabled: setter("plan"),
    setAssigneeFilterIds: setter("filter"),
    setPeopleEditorOpen: setter("editor"),
    closeAssignMenu: () => (menuClosed += 1),
    tasksRef: { current: tasks },
    focusChannelRef: { current: { postMessage: (m) => posted.push(m) } },
    mutateTask: async (id, patch) => writes.push({ id, ...patch }),
  });
  const kept = (key) => localStorage.getItem(`redd-plan-todo-${key}`);

  a.changeLang("da");
  check("a language is set and kept", set.lang === "da" && kept("lang") === "da");
  a.changeTheme("dark");
  check("a theme is set and kept", set.theme === "dark" && kept("theme") === "dark");
  a.changeZoom(120);
  check("a zoom is set and kept", set.zoom === 120 && kept("zoom") === "120");
  a.changeKanbanEnabled(true);
  check("Board View is set and kept", set.kanban === true && kept("kanban") === "1");
  a.changePlanEnabled(true);
  check("the Planner View is set and kept", set.plan === true && kept("plan") === "1", kept("plan"));

  a.changeSomedayEnabled(true);
  check("Someday on is set and kept, and moves nothing", set.someday === true && kept("someday-enabled") === "1" && writes.length === 0);
  a.changeSomedayEnabled(false);
  check("Someday off is kept", set.someday === false && kept("someday-enabled") === "0");
  check(
    "and its open tasks go to the Backlog; a done one stays",
    writes.length === 1 && writes[0].id === "a" && writes[0].isBacklog === true && writes[0].isSomeday === false,
    JSON.stringify(writes)
  );

  set.filter = ["p1"];
  set.editor = true;
  a.changeAssignEnabled(true);
  check("assigning on is set and kept, and puts nothing away", set.assign === true && kept("assign-enabled") === "1" && set.filter.length === 1 && set.editor === true && menuClosed === 0);
  a.changeAssignEnabled(false);
  check("assigning off is kept", set.assign === false && kept("assign-enabled") === "0");
  check("and the filter, the menu and the people editor go", set.filter.length === 0 && menuClosed === 1 && set.editor === false);

  a.changeFocusTimerAlways(false);
  check("the timer choice is set and kept", set.timer === false && kept("focus-timer-always") === "0", kept("focus-timer-always"));
  check("and the focus windows are told", posted.length === 1 && posted[0].always === false && typeof posted[0].type === "string");
}

async function plainListDrop() {
  const { plainListColumn } = await import("@/components/todo/use-pointer-drag");
  const task = (id, flags = {}) => ({ id, completed: false, isToday: false, isBacklog: false, isSomeday: false, ...flags });
  const tasks = [task("t1", { isToday: true }), task("t2", { isToday: true }), task("w1"), task("w2"), task("b1", { isBacklog: true })];
  const live = { state: { tasks }, somedayEnabled: false };
  const at = (id, order) => plainListColumn(tasks.find((t) => t.id === id), order, live);
  check("the plain list: next to a row of its own section, a card stays in it", at("w2", ["t1", "t2", "w2", "w1"]) === "week");
  check("between rows of other sections, it takes the one above", at("w1", ["t1", "t2", "w1", "b1"]) === "today");
  check("at the top, the one below", at("w2", ["w2", "t1", "t2", "w1"]) === "today");
  check("alone, it stays where it is", at("b1", ["b1"]) === "backlog");
}

async function viewTasks() {
  const { useViewTasks } = await import("@/components/todo/use-view-tasks");
  const tasks = [
    { id: "a", listId: "L1", completed: false, position: 2 },
    { id: "b", listId: "L1", completed: true, position: 1, completedAt: "2026-01-02T00:00:00.000Z" },
    { id: "c", listId: "L2", completed: false, position: 1 },
  ];
  const scoped = new Set(["L1", "L2"]);
  const hook = renderHook((args) => useViewTasks(args), {
    parentTasks: tasks, view: "lists", isAllListsView: false, scopedListIds: scoped, activeListId: "L1",
  });
  const first = hook.result();
  check("the open list's tasks, open and done", first.tasksForView.map((t) => t.id).join() === "a,b" && first.openTasksSorted.map((t) => t.id).join() === "a" && first.doneTasks.map((t) => t.id).join() === "b");
  flushed(() => hook.rerender({ parentTasks: tasks, view: "lists", isAllListsView: false, scopedListIds: scoped, activeListId: "L1" }));
  const again = hook.result();
  check(
    "a render with the same inputs keeps the same arrays",
    again.tasksForView === first.tasksForView && again.openTasksSorted === first.openTasksSorted && again.doneTasks === first.doneTasks
  );
  flushed(() => hook.rerender({ parentTasks: tasks, view: "lists", isAllListsView: true, scopedListIds: scoped, activeListId: null }));
  check("a change makes them again", hook.result().tasksForView !== first.tasksForView && hook.result().openTasksSorted.map((t) => t.id).join() === "c,a");
  hook.unmount();
}

async function danishToasts() {
  const { useNotesCard, useNotesCardState } = await import("@/components/todo/use-notes-card");
  const { toastSink } = await import("sonner");
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  const hook = renderHook(() => {
    const notesCard = useNotesCardState();
    return { ...notesCard, ...useNotesCard({ notesCard, mutateTask: async () => {}, t: makeT("da") }) };
  });
  flushed(() => hook.result().toggleNotes({ id: "n1", notesHtml: "<div>ord</div>" }));
  hook.result().notesUploading.current = 1;
  flushed(() => hook.result().saveNotes("n1"));
  check(
    "in Danish, a toast says it in Danish",
    toasts.some((t) => t.kind === "error" && t.message === "Et billede bliver stadig uploadet"),
    JSON.stringify(toasts)
  );
  hook.unmount();
  toastSink.push = null;
}

export async function hookChecks() {
  await writeTracking();
  await zoomKeys();
  await undo();
  await focusWindows();
  await pendingFocusTicks();
  await searchField();
  await columnSorts();
  await peopleScope();
  await boardLayout();
  await integrationStatus();
  await sync();
  await remindersSync();
  await listDialog();
  await taskActions();
  await taskFlight();
  await notesCard();
  await subtasks();
  await boardPeople();
  await boardReads();
  await groupsAndLists();
  await titleEdit();
  await calendarCard();
  await cardMenus();
  await boardNudge();
  await columnDrag();
  await settings();
  await plainListDrop();
  await viewTasks();
  await danishToasts();
}
