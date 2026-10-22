/**
 * Fill the demo app with the invented board (board.ts) each time it starts,
 * so every take of a video starts from the same place, dated from today.
 *
 * Only in the demo app. Rust says whether this is it (demo.rs), from the
 * identifier, which also gives the demo its own SQLite file and its own web
 * view store. A build flag is not asked: a flag set by mistake on the real
 * app would put this board over a real one.
 */

import { tauriInvoke } from "@/lib/todo/native-bridge";

import { CALENDARS, demoEvents, demoNotes, demoTasks, demoTaskTimes, LISTS, ME, PEOPLE } from "./board";

type Statement = { sql: string; params: unknown[] };

/** Marks the web view store as the demo's own, so a reseed may clear it. */
const DEMO_MARK_KEY = "dh-todo-demo";

/** Whether this is the demo app. False outside the desktop app. */
export async function isDemoApp(): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  try {
    return (await invoke("todo_is_demo")) === true;
  } catch {
    return false;
  }
}

/** The board as SQL: the old rows out, the invented ones in. */
export function boardStatements(): Statement[] {
  const s: Statement[] = [];
  const add = (sql: string, ...params: unknown[]) => s.push({ sql, params });
  // Children first, for the foreign keys.
  for (const table of ["todo_task_assignees", "todo_tasks", "todo_people", "todo_lists", "todo_groups"]) {
    add(`DELETE FROM ${table}`);
  }
  PEOPLE.forEach((p, i) =>
    add("INSERT INTO todo_people (id, name, colour, source_kind, position) VALUES (?,?,?,?,?)", p.id, p.name, p.colour, "manual", i));
  LISTS.forEach((l, i) => add("INSERT INTO todo_lists (id, name, emoji, position) VALUES (?,?,?,?)", l.id, l.name, l.emoji, i + 1));
  demoTasks().forEach((t, i) => {
    // Done on its own day, at the end of it.
    const doneAt = t.done ? new Date(`${t.due ?? new Date().toISOString().slice(0, 10)}T16:00:00`).toISOString() : null;
    add(
      `INSERT INTO todo_tasks (id, list_id, text, notes_html, completed, completed_at, is_backlog, is_today,
         expected_duration_minutes, time_spent_seconds, position, due_on, due_promoted_on, show_on_calendar)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.id, t.list, t.text, t.notes ?? null, t.done ? 1 : 0, doneAt,
      t.column === "backlog" ? 1 : 0, t.column === "today" ? 1 : 0,
      t.minutes ?? null, t.spent ?? 0, i,
      // Promoted already, so the board keeps each task in its column.
      t.due ?? null, t.due ?? null, t.calendar ? 1 : 0,
    );
    (t.who ?? []).forEach((p, n) => add("INSERT INTO todo_task_assignees (task_id, person_id, position) VALUES (?,?,?)", t.id, p, n));
    (t.steps ?? []).forEach(([text, done], n) =>
      add(
        `INSERT INTO todo_tasks (id, list_id, parent_task_id, text, completed, completed_at, is_backlog, is_today, position)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        `${t.id}-s${n}`, t.list, t.id, text, done ? 1 : 0, done ? new Date().toISOString() : null, 0, 0, n,
      ));
  });
  return s;
}

/** The settings and the calendar's own data, as the page keeps them. */
function storageValues(): Record<string, string> {
  const tasks = demoTasks();
  const calendarPrefix = "redd-todo-plan-";
  return {
    [DEMO_MARK_KEY]: "1",
    "redd-plan-todo-lang": "en",
    "redd-plan-todo-theme": "light",
    "redd-plan-todo-kanban": "1",
    "redd-plan-todo-plan": "1",
    "redd-plan-todo-assign-enabled": "1",
    "redd-plan-todo-had-task": "1",
    "redd-plan-todo-board-nudge-seen": "1",
    "redd-plan-todo-me-person": ME,
    // The 2.x import looks for an old board; there is none.
    "dh-todo-legacy-import": "{}",
    // The welcome screen, accepted.
    todo_eula: JSON.stringify({ acceptedRevision: 1, acceptedAt: Date.now() }),
    [`${calendarPrefix}calendar-view-mode`]: "week",
    [`${calendarPrefix}freeform-notes`]: JSON.stringify(demoNotes()),
    [`${calendarPrefix}calendars`]: JSON.stringify(CALENDARS),
    [`${calendarPrefix}calendar-events`]: JSON.stringify(demoEvents()),
    [`${calendarPrefix}calendar-last-sync`]: new Date().toISOString(),
    [`${calendarPrefix}task-times`]: JSON.stringify(demoTaskTimes(tasks)),
  };
}

/**
 * Put the invented board in place. The web view store is cleared only when
 * it is the demo's: empty, or marked by an earlier seed. Anything else is
 * some other build's storage — the demo's own store did not take — and is
 * left alone, board settings and all.
 */
export async function seedDemoBoard(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("todo_sql_batch", { statements: boardStatements() });

  if (localStorage.length > 0 && localStorage.getItem(DEMO_MARK_KEY) !== "1") {
    console.error("[demo] This web view store is not the demo's. The board is filled; the calendar and settings are not.");
    return;
  }
  localStorage.clear();
  for (const [k, v] of Object.entries(storageValues())) localStorage.setItem(k, v);
}
