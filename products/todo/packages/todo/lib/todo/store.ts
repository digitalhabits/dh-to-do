import { PlanError } from "@/lib/plan/errors";

import { todoDb, type SqlStatement } from "./db-driver";
import { randomUUID } from "./uuid";
import {
  isTodoPersonSourceKind,
  rowToPerson,
  setTaskAssignees,
  upsertTodoPerson,
} from "./people-store";

import { DUE_ON_RE, boardColumnPatch } from "./types";
import type {
  TodoGroup,
  TodoGroupPatch,
  TodoList,
  TodoListPatch,
  TodoPerson,
  TodoPersonPatch,
  TodoState,
  TodoTask,
  TodoTaskPatch,
} from "./types";

type Row = Record<string, unknown>;

/**
 * What the store tells a remote about a local write. The planner installs the
 * Basecamp push here (see server-store.ts); the standalone app installs
 * nothing and reconciles on explicit sync, as it always has. The store calls
 * the hook and does not know what listens.
 */
export type TodoRemoteAction = {
  type:
    | "create"
    | "complete"
    | "update-text"
    | "assign"
    | "delete"
    | "move"
    /* One step inside a linked to-do. `taskId` and `basecampId` name the
       parent task; the subtask names itself. */
    | "subtask-create"
    | "subtask-update"
    | "subtask-delete";
  /** For a move, the list the task is on now. Null: on no list. */
  listId: string | null;
  /** For a move, the list it was on before. */
  fromListId?: string | null;
  taskId?: string;
  basecampId?: string | null;
  text?: string;
  notesHtml?: string | null;
  dueOn?: string | null;
  completed?: boolean;
  /** Subtask actions: the local row, its Basecamp step when it has one. */
  subtaskId?: string;
  subtaskBasecampId?: string | null;
};

let pushRemote: (action: TodoRemoteAction) => Promise<void> = async () => {};

export function setTodoRemotePush(fn: typeof pushRemote) {
  pushRemote = fn;
}

function rowToGroup(row: Row): TodoGroup {
  return {
    id: row.id as string,
    name: row.name as string,
    colour: (row.colour as string | null) ?? null,
    position: Number(row.position),
  };
}

function rowToList(row: Row): TodoList {
  return {
    id: row.id as string,
    name: row.name as string,
    groupId: (row.group_id as string | null) ?? null,
    colour: (row.colour as string | null) ?? null,
    emoji: (row.emoji as string | null) ?? null,
    position: Number(row.position),
    basecampProjectId: (row.basecamp_project_id as string | null) ?? null,
    basecampListId: (row.basecamp_list_id as string | null) ?? null,
    remindersListId: (row.reminders_list_id as string | null) ?? null,
  };
}

function rowToTask(row: Row, assigneeIds: string[] = []): TodoTask {
  return {
    id: row.id as string,
    listId: (row.list_id as string | null) ?? null,
    text: row.text as string,
    notesHtml: (row.notes_html as string | null) ?? null,
    dueOn: (row.due_on as string | null) ?? null,
    completed: Boolean(row.completed),
    completedAt: row.completed_at
      ? new Date(row.completed_at as string).toISOString()
      : null,
    isFavourite: Boolean(row.is_favourite),
    favouritePosition:
      row.favourite_position == null ? null : Number(row.favourite_position),
    isBacklog: Boolean(row.is_backlog),
    isToday: Boolean(row.is_today),
    isSomeday: Boolean(row.is_someday),
    // A board read before its migration has no such column: not shown.
    showOnCalendar: Boolean(row.show_on_calendar),
    assigneeIds,
    colour: (row.colour as string | null) ?? null,
    expectedDurationMinutes:
      row.expected_duration_minutes == null
        ? null
        : Number(row.expected_duration_minutes),
    timeSpentSeconds: Number(row.time_spent_seconds ?? 0),
    position: Number(row.position),
    basecampId: (row.basecamp_id as string | null) ?? null,
    remindersId: (row.reminders_id as string | null) ?? null,
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

async function assigneesByTaskId(
  taskIds?: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (taskIds && taskIds.length === 0) return map;
  const { rows } = taskIds
    ? await todoDb().query(
        `SELECT task_id, person_id FROM todo_task_assignees
         WHERE task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
         ORDER BY position, created_at`,
        taskIds
      )
    : await todoDb().query(
        `SELECT task_id, person_id FROM todo_task_assignees
         ORDER BY position, created_at`
      );
  for (const row of rows) {
    const taskId = row.task_id as string;
    const list = map.get(taskId);
    if (list) list.push(row.person_id as string);
    else map.set(taskId, [row.person_id as string]);
  }
  return map;
}

async function loadTodoTask(id: string): Promise<TodoTask> {
  const { rows } = await todoDb().query("SELECT * FROM todo_tasks WHERE id = $1", [
    id,
  ]);
  if (!rows[0]) throw new PlanError("Task not found", 404);
  const assignees = await assigneesByTaskId([id]);
  return rowToTask(rows[0], assignees.get(id) ?? []);
}

/**
 * Put the tasks that are due on Today.
 *
 * `today` is the reader's day, "YYYY-MM-DD", because the server's clock
 * may be in another zone. A task due that day or earlier goes to the
 * Today column, once per due date: `due_promoted_on` records the date
 * that did it, so a task the reader dragged out again stays out until
 * its due date changes. Board flags only; Basecamp has no Today.
 */
export async function promoteDueTasks(today: string): Promise<void> {
  if (!DUE_ON_RE.test(today)) return;
  await todoDb().query(
    `UPDATE todo_tasks
        SET is_today = TRUE, is_backlog = FALSE, is_someday = FALSE,
            due_promoted_on = due_on, updated_at = NOW()
      WHERE parent_task_id IS NULL
        AND NOT completed
        AND due_on IS NOT NULL
        AND due_on <= $1
        AND (due_promoted_on IS NULL OR due_promoted_on <> due_on)`,
    [today]
  );
}

export async function getTodoState(options: {
  /** The reader's day. Given, the tasks due by then go to Today first. */
  today?: string;
  /**
   * Who is reading. A task on no list is personal to whoever made it, so
   * a reader sees the team's listed tasks and their own unlisted ones —
   * and the unlisted ones they are on, so a personal task handed to a
   * colleague reaches them. Null means a reader with no identity: listed
   * tasks only. Left out, everything: the standalone app has one user,
   * and a server caller that acts for nobody in particular reads the
   * whole board.
   */
  viewer?: string | readonly string[] | null;
  /** The reader's addresses, to find them on the roster for the above. */
  viewerEmails?: readonly string[];
} = {}): Promise<TodoState> {
  if (options.today) await promoteDueTasks(options.today);
  // Serial on purpose: the planner pool defaults to one connection (see
  // lib/db.ts), and parallel queries there queue up and time out. SQLite is
  // one connection by nature, so serial costs the standalone app nothing.
  const groups = await todoDb().query(
    "SELECT * FROM todo_groups ORDER BY position, created_at"
  );
  const lists = await todoDb().query(
    "SELECT * FROM todo_lists ORDER BY position, created_at"
  );
  // The reader may be known by several keys — the address they sign in
  // with, the mailboxes they connected, the sign-in's own id — and a task
  // is theirs under any of them. Placeholders one by one: SQLite has no
  // ANY(array), and the standalone app reads this too.
  const viewerKeys =
    options.viewer === undefined
      ? undefined
      : options.viewer === null
        ? []
        : [...new Set((Array.isArray(options.viewer) ? options.viewer : [options.viewer]).map(String))];
  const people = await todoDb().query(
    "SELECT * FROM todo_people ORDER BY position, created_at"
  );
  // The reader on the roster, by address: an unlisted task they are on is
  // theirs to see, whoever made it.
  const viewerAddresses = new Set(
    (options.viewerEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)
  );
  const viewerPersonIds =
    viewerKeys === undefined || !viewerAddresses.size
      ? []
      : people.rows
          .filter((p) => typeof p.email === "string" && viewerAddresses.has(p.email.trim().toLowerCase()))
          .map((p) => String(p.id));
  const params = [...viewerKeys ?? [], ...viewerPersonIds];
  const own = viewerKeys?.length
    ? `created_by IN (${viewerKeys.map((_, i) => `$${i + 1}`).join(", ")})`
    : null;
  const onIt = viewerPersonIds.length
    ? `id IN (SELECT task_id FROM todo_task_assignees WHERE person_id IN (${viewerPersonIds
        .map((_, i) => `$${(viewerKeys?.length ?? 0) + i + 1}`)
        .join(", ")}))`
    : null;
  const mine = [own, onIt].filter(Boolean).join(" OR ");
  const tasks =
    viewerKeys === undefined
      ? await todoDb().query(
          "SELECT * FROM todo_tasks ORDER BY completed, position, created_at"
        )
      : await todoDb().query(
          `SELECT * FROM todo_tasks
            WHERE list_id IS NOT NULL${mine ? ` OR ${mine}` : ""}
            ORDER BY completed, position, created_at`,
          params
        );
  const assignees = await assigneesByTaskId();
  return {
    groups: groups.rows.map(rowToGroup),
    lists: lists.rows.map(rowToList),
    tasks: tasks.rows.map((row) =>
      rowToTask(row, assignees.get(row.id as string) ?? [])
    ),
    people: people.rows.map(rowToPerson),
  };
}

/**
 * The board's people, in board order, with nothing else.
 *
 * For a reader that needs the people and not the board. The planner's
 * Calendar tab is one: a week goal is for a person from this same list, so a
 * person added there can be given a task here, and the other way round.
 */
export async function listTodoPeople(): Promise<TodoPerson[]> {
  const people = await todoDb().query(
    "SELECT * FROM todo_people ORDER BY position, created_at"
  );
  return people.rows.map(rowToPerson);
}

export async function createTodoPerson(input: {
  name: string;
  colour?: string | null;
  photoUrl?: string | null;
  sourceKind?: TodoPerson["sourceKind"];
  sourceId?: string | null;
  email?: string | null;
  basecampPersonId?: string | null;
}): Promise<TodoPerson> {
  const { person } = await upsertTodoPerson(randomUUID(), input);
  return person;
}

export async function updateTodoPerson(
  id: string,
  patch: TodoPersonPatch
): Promise<TodoPerson> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) set("name", patch.name.trim());
  if (patch.colour !== undefined) set("colour", patch.colour);
  if (patch.photoUrl !== undefined) set("photo_url", patch.photoUrl);
  if (patch.position !== undefined) set("position", patch.position);
  if (!sets.length) throw new PlanError("Empty person update", 400);
  values.push(id);
  const { rows } = await todoDb().query(
    `UPDATE todo_people SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) throw new PlanError("Person not found", 404);
  return rowToPerson(rows[0]);
}

export async function deleteTodoPerson(id: string): Promise<void> {
  await todoDb().query("DELETE FROM todo_people WHERE id = $1", [id]);
}

export async function createTodoGroup(input: {
  name: string;
  colour?: string | null;
}): Promise<TodoGroup> {
  const { rows } = await todoDb().query(
    `INSERT INTO todo_groups (id, name, colour, position)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_groups))
     RETURNING *`,
    [randomUUID(), input.name, input.colour ?? null]
  );
  return rowToGroup(rows[0]);
}

export async function updateTodoGroup(
  id: string,
  patch: TodoGroupPatch
): Promise<TodoGroup> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.colour !== undefined) set("colour", patch.colour);
  if (patch.position !== undefined) set("position", patch.position);
  if (!sets.length) throw new PlanError("Empty group update", 400);
  values.push(id);
  const { rows } = await todoDb().query(
    `UPDATE todo_groups SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) throw new PlanError("Group not found", 404);
  return rowToGroup(rows[0]);
}

/** Deletes the group AND its lists (with their tasks), matching redd-do. */
export async function deleteTodoGroup(id: string): Promise<void> {
  await todoDb().query("DELETE FROM todo_lists WHERE group_id = $1", [id]);
  const { rowCount } = await todoDb().query(
    "DELETE FROM todo_groups WHERE id = $1",
    [id]
  );
  if (!rowCount) throw new PlanError("Group not found", 404);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createTodoList(input: {
  /** Optional client-generated uuid (offline creates keep their id). */
  id?: string;
  name: string;
  groupId?: string | null;
  colour?: string | null;
  emoji?: string | null;
  basecampProjectId?: string | null;
  basecampListId?: string | null;
  remindersListId?: string | null;
}): Promise<TodoList> {
  if (input.id && !UUID_RE.test(input.id)) {
    throw new PlanError("id must be a uuid", 400);
  }
  const id = input.id ?? randomUUID();
  const { rows } = await todoDb().query(
    `INSERT INTO todo_lists (
       id, name, group_id, colour, emoji, position,
       basecamp_project_id, basecamp_list_id, reminders_list_id
     )
     VALUES ($1, $2, $3, $4, $5,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_lists),
             $6, $7, $8)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [
      id,
      input.name,
      input.groupId ?? null,
      input.colour ?? null,
      input.emoji ?? null,
      input.basecampProjectId ?? null,
      input.basecampListId ?? null,
      input.remindersListId ?? null,
    ]
  );
  if (rows[0]) return rowToList(rows[0]);
  const existing = await todoDb().query("SELECT * FROM todo_lists WHERE id = $1", [
    id,
  ]);
  if (!existing.rows[0]) throw new PlanError("List not found", 404);
  return rowToList(existing.rows[0]);
}

export async function updateTodoList(
  id: string,
  patch: TodoListPatch
): Promise<TodoList> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.groupId !== undefined) set("group_id", patch.groupId);
  if (patch.colour !== undefined) set("colour", patch.colour);
  if (patch.emoji !== undefined) set("emoji", patch.emoji);
  if (patch.position !== undefined) set("position", patch.position);
  if (patch.basecampProjectId !== undefined)
    set("basecamp_project_id", patch.basecampProjectId);
  if (patch.basecampListId !== undefined)
    set("basecamp_list_id", patch.basecampListId);
  if (patch.remindersListId !== undefined)
    set("reminders_list_id", patch.remindersListId);
  if (!sets.length) throw new PlanError("Empty list update", 400);
  values.push(id);
  const { rows } = await todoDb().query(
    `UPDATE todo_lists SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) throw new PlanError("List not found", 404);
  return rowToList(rows[0]);
}

export async function deleteTodoList(id: string): Promise<void> {
  await todoDb().query("DELETE FROM todo_lists WHERE id = $1", [id]);
}

export async function createTodoTask(input: {
  /** Optional client-generated uuid (offline creates keep their id). */
  id?: string;
  /** Null makes a task on no list: personal to `createdBy`. */
  listId: string | null;
  text: string;
  /** The task's note, in Basecamp's HTML. A task can be born with one: the
      morning review writes the note beside the title, before the task
      exists. The create push carries it, so Basecamp gets it too. */
  notesHtml?: string | null;
  /** "YYYY-MM-DD", or null. See TodoTask.dueOn. */
  dueOn?: string | null;
  expectedDurationMinutes?: number | null;
  isFavourite?: boolean;
  isBacklog?: boolean;
  isToday?: boolean;
  isSomeday?: boolean;
  completed?: boolean;
  /** People the board assigns straight away, so a filtered board keeps the
      new task in view. The SQLite store accepts them on create too. */
  assigneeIds?: string[];
  remindersId?: string | null;
  createdBy?: string | null;
  /** Makes this a subtask of that task. It never sits in a board column. */
  parentTaskId?: string | null;
}): Promise<TodoTask> {
  if (input.id && !UUID_RE.test(input.id)) {
    throw new PlanError("id must be a uuid", 400);
  }
  const id = input.id ?? randomUUID();
  const completed = Boolean(input.completed);
  const parentTaskId = input.parentTaskId ?? null;
  // A child carries no board flags: the board never shows it.
  const isSomeday = parentTaskId ? false : Boolean(input.isSomeday);
  const isBacklog = isSomeday ? false : parentTaskId ? false : Boolean(input.isBacklog);
  const isToday =
    isSomeday || isBacklog || parentTaskId ? false : Boolean(input.isToday);
  // New open tasks go to the bottom of their list, or of the unlisted
  // tasks; a subtask to the end of its siblings. COALESCE, because NULL
  // equals nothing, not even NULL, in either database.
  const { rows } = await todoDb().query(
    `INSERT INTO todo_tasks
       (id, list_id, text, expected_duration_minutes, is_favourite, is_backlog,
        is_today, is_someday, completed, completed_at, reminders_id, position,
        created_by, parent_task_id, notes_html, due_on, due_promoted_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             CASE WHEN $9 THEN NOW() ELSE NULL END,
             $10,
             CASE WHEN $12::text IS NULL THEN
               (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks
                 WHERE COALESCE(list_id, '') = COALESCE($2, '')
                   AND NOT completed AND parent_task_id IS NULL)
             ELSE
               (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks
                 WHERE parent_task_id = $12)
             END,
             $11, $12, $13, $14, $15)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [
      id,
      input.listId ?? null,
      input.text,
      input.expectedDurationMinutes ?? null,
      Boolean(input.isFavourite),
      isBacklog,
      isToday,
      isSomeday,
      completed,
      input.remindersId ?? null,
      input.createdBy ?? null,
      parentTaskId,
      input.notesHtml ?? null,
      input.dueOn ?? null,
      // Born in Today for its date: that date has done its work.
      isToday && input.dueOn ? input.dueOn : null,
    ]
  );
  if (!rows[0]) {
    // Idempotent offline replay — task already exists.
    return loadTodoTask(id);
  }
  const assigneeIds = input.assigneeIds?.length
    ? await setTaskAssignees(id, input.assigneeIds)
    : [];
  const task = rowToTask(rows[0], assigneeIds);
  // Born with people on a step: they are on the task too, same subset rule
  // as an assignment made later.
  if (task.parentTaskId && task.assigneeIds.length) {
    const parentIds =
      (await assigneesByTaskId([task.parentTaskId])).get(task.parentTaskId) ?? [];
    const missing = task.assigneeIds.filter((pid) => !parentIds.includes(pid));
    if (missing.length) {
      await updateTodoTask(task.parentTaskId, {
        assigneeIds: [...parentIds, ...missing],
      });
    }
  }
  // Reminders imports already have a remote id — do not also push to Basecamp.
  if (!input.remindersId) {
    if (task.parentTaskId) {
      // A child is its parent to-do's step, not a to-do of its own.
      const parent = await subtaskParent(task.parentTaskId);
      await pushRemote({
        type: "subtask-create",
        listId: task.listId,
        taskId: task.parentTaskId,
        basecampId: parent?.basecampId ?? null,
        subtaskId: task.id,
        text: task.text,
      });
    } else {
      await pushRemote({
        type: "create",
        listId: task.listId,
        taskId: task.id,
        text: task.text,
        notesHtml: task.notesHtml,
        dueOn: task.dueOn,
      });
    }
  }
  return task;
}

export async function updateTodoTask(
  id: string,
  patch: TodoTaskPatch
): Promise<TodoTask> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  /*
    Which list a task is on is a Basecamp fact, not only a local one: the
    to-do sits in that list's Basecamp list. Moving it locally and telling
    Basecamp nothing is what made a dragged task come back a few seconds
    later. The new list's sync found a task whose to-do was not in its
    remote list and deleted it, the old list's sync found a to-do no local
    task claimed and pulled it in again, and the task was back where it
    started with a new id and none of its board state.

    So read where it was before the write, for the push below.
  */
  let movedFrom: { listId: string | null; basecampId: string | null } | null =
    null;
  if (patch.listId !== undefined) {
    const { rows } = await todoDb().query(
      "SELECT list_id, basecamp_id FROM todo_tasks WHERE id = $1",
      [id]
    );
    const before = rows[0];
    const wasOn = (before?.list_id as string | null) ?? null;
    if (before && wasOn !== patch.listId) {
      movedFrom = {
        listId: wasOn,
        basecampId: (before.basecamp_id as string | null) ?? null,
      };
      // The children live on the same list as their parent, always: a
      // subtask left behind would sit invisible on a list its parent is
      // no longer on.
      await todoDb().query(
        "UPDATE todo_tasks SET list_id = $1, updated_at = NOW() WHERE parent_task_id = $2",
        [patch.listId, id]
      );
    }
  }
  if (patch.listId !== undefined) set("list_id", patch.listId);
  if (patch.text !== undefined) set("text", patch.text);
  if (patch.notesHtml !== undefined) set("notes_html", patch.notesHtml);
  if (patch.dueOn !== undefined) {
    set("due_on", patch.dueOn);
    // A new date has not had its day yet — unless this same write puts
    // the task in Today for it.
    set("due_promoted_on", patch.isToday === true ? patch.dueOn : null);
  }
  if (patch.completed !== undefined) {
    set("completed", patch.completed);
    sets.push(`completed_at = ${patch.completed ? "NOW()" : "NULL"}`);
  }
  if (patch.isFavourite !== undefined) set("is_favourite", patch.isFavourite);
  if (patch.favouritePosition !== undefined)
    set("favourite_position", patch.favouritePosition);
  if (
    patch.isSomeday === true ||
    patch.isBacklog === true ||
    patch.isToday === true
  ) {
    const column =
      patch.isSomeday === true
        ? "someday"
        : patch.isBacklog === true
          ? "backlog"
          : "today";
    const flags = boardColumnPatch(column);
    set("is_someday", flags.isSomeday);
    set("is_backlog", flags.isBacklog);
    set("is_today", flags.isToday);
  } else {
    if (patch.isBacklog !== undefined) set("is_backlog", patch.isBacklog);
    if (patch.isToday !== undefined) set("is_today", patch.isToday);
    if (patch.isSomeday !== undefined) set("is_someday", patch.isSomeday);
  }
  if (patch.showOnCalendar !== undefined)
    set("show_on_calendar", patch.showOnCalendar);
  if (patch.colour !== undefined) set("colour", patch.colour);
  if (patch.expectedDurationMinutes !== undefined)
    set("expected_duration_minutes", patch.expectedDurationMinutes);
  if (patch.timeSpentSeconds !== undefined)
    set("time_spent_seconds", patch.timeSpentSeconds);
  if (patch.position !== undefined) set("position", patch.position);
  if (patch.remindersId !== undefined) set("reminders_id", patch.remindersId);
  if (!sets.length && patch.assigneeIds === undefined) {
    throw new PlanError("Empty task update", 400);
  }
  /*
    The write answers with the row it wrote.

    This used to write, and then read the task back to return it — three
    round trips for a flag nobody was waiting to see again, over a pool
    that holds one connection. `RETURNING` is the same row for the price of
    the write.

    The assignees are the one part not in that row. When they were just
    written we already know them, because setting them answers with them;
    only an edit that leaves them alone has to ask.
  */
  let row: Row | undefined;
  if (sets.length) {
    values.push(id);
    const { rows } = await todoDb().query(
      `UPDATE todo_tasks SET ${sets.join(", ")}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    row = rows[0];
  } else {
    const { rows } = await todoDb().query(
      "SELECT * FROM todo_tasks WHERE id = $1",
      [id]
    );
    row = rows[0];
  }
  if (!row) throw new PlanError("Task not found", 404);
  const assigneeIds =
    patch.assigneeIds !== undefined
      ? await setTaskAssignees(id, patch.assigneeIds)
      : ((await assigneesByTaskId([id])).get(id) ?? []);
  let task = rowToTask(row, assigneeIds);
  /*
    The people on a step are on the task. Assigning somebody to a subtask
    puts them on the parent too — one union, through this same function,
    so the parent's Basecamp PUT carries them. Only additions flow up;
    taking somebody off a step says nothing about the task.
  */
  if (task.parentTaskId && patch.assigneeIds !== undefined) {
    const parentIds =
      (await assigneesByTaskId([task.parentTaskId])).get(task.parentTaskId) ?? [];
    const missing = task.assigneeIds.filter((pid) => !parentIds.includes(pid));
    if (missing.length) {
      await updateTodoTask(task.parentTaskId, {
        assigneeIds: [...parentIds, ...missing],
      });
    }
  }
  /*
    And taken off the task, they are off its steps. The invariant is the
    subset, held here rather than asked of every caller: after a parent's
    people change, no child keeps somebody the parent no longer has. The
    reverse write above only ever adds, so the two cannot chase each other.
  */
  if (!task.parentTaskId && patch.assigneeIds !== undefined) {
    if (task.assigneeIds.length) {
      await todoDb().query(
        `DELETE FROM todo_task_assignees
          WHERE task_id IN (SELECT id FROM todo_tasks WHERE parent_task_id = $1)
            AND person_id NOT IN (${task.assigneeIds
              .map((_, i) => `$${i + 2}`)
              .join(", ")})`,
        [task.id, ...task.assigneeIds]
      );
    } else {
      await todoDb().query(
        `DELETE FROM todo_task_assignees
          WHERE task_id IN (SELECT id FROM todo_tasks WHERE parent_task_id = $1)`,
        [task.id]
      );
    }
  }
  /*
    A child is not a to-do; it is a step of one. None of the to-do pushes
    below fit it — a move, a completion, the three-field PUT would each
    address a to-do that does not exist. Its title and tick go through the
    step push, and only when the patch touched them: a position change or
    a note stays local (Basecamp steps hold neither order nor notes).
  */
  if (task.parentTaskId) {
    if (patch.text !== undefined || patch.completed !== undefined) {
      const parent = await subtaskParent(task.parentTaskId);
      await pushRemote({
        type: "subtask-update",
        listId: task.listId,
        taskId: task.parentTaskId,
        basecampId: parent?.basecampId ?? null,
        subtaskId: task.id,
        subtaskBasecampId: task.basecampId,
        text: task.text,
        completed: task.completed,
      });
    }
    return task;
  }
  // Before the pushes below, which address the to-do by the id it had.
  if (movedFrom) {
    await pushRemote({
      type: "move",
      listId: task.listId,
      fromListId: movedFrom.listId,
      taskId: task.id,
      basecampId: movedFrom.basecampId,
      text: task.text,
      notesHtml: task.notesHtml,
      dueOn: task.dueOn,
      completed: task.completed,
    });
    // The move makes the to-do again in the other list, so the id it
    // answers to has changed.
    task = await loadTodoTask(id);
  }
  if (patch.completed !== undefined) {
    await pushRemote({
      type: "complete",
      listId: task.listId,
      basecampId: task.basecampId,
      completed: task.completed,
    });
  }
  // Title, notes, due date and assignees travel together: Basecamp clears
  // every field the request leaves out, so one PUT carries all four.
  if (
    patch.text !== undefined ||
    patch.notesHtml !== undefined ||
    patch.dueOn !== undefined ||
    patch.assigneeIds !== undefined
  ) {
    await pushRemote({
      type: patch.assigneeIds !== undefined ? "assign" : "update-text",
      listId: task.listId,
      taskId: task.id,
      basecampId: task.basecampId,
      text: task.text,
      notesHtml: task.notesHtml,
      dueOn: task.dueOn,
    });
  }
  return task;
}

/**
 * Put many tasks in the Today column, or take them out of it, in one write.
 *
 * For the morning briefing, which moves a handful of tasks at once and
 * reads none of them back. `updateTodoTask` costs three round trips a task
 * — the write, then the read that returns it — and the planner's pool holds
 * one connection, so a plan of seven tasks spent a second on answers
 * nobody looked at.
 *
 * Board flags only, and deliberately so: Basecamp has no Today, so this
 * needs none of the pushes `updateTodoTask` makes. Anything beyond these
 * three columns belongs there, not here.
 *
 * Ids that name no task are skipped, as a `WHERE id IN` does.
 */
export async function setTasksToday(
  ids: string[],
  isToday: boolean
): Promise<void> {
  if (!ids.length) return;
  const flags = boardColumnPatch(isToday ? "today" : "week");
  await todoDb().query(
    `UPDATE todo_tasks
        SET is_today = $1, is_backlog = $2, is_someday = $3, updated_at = NOW()
      WHERE id IN (${ids.map((_, i) => `$${i + 4}`).join(", ")})`,
    [flags.isToday, flags.isBacklog, flags.isSomeday, ...ids]
  );
}

/** The parent facts a subtask push needs: which list, which to-do. */
async function subtaskParent(
  taskId: string
): Promise<{ listId: string; basecampId: string | null } | null> {
  const { rows } = await todoDb().query(
    "SELECT list_id, basecamp_id FROM todo_tasks WHERE id = $1",
    [taskId]
  );
  return rows[0]
    ? {
        listId: rows[0].list_id as string,
        basecampId: (rows[0].basecamp_id as string | null) ?? null,
      }
    : null;
}

/**
 * The old subtask doors, kept for queued offline writes and the standalone
 * bridge: each is the task call it always secretly was. A subtask has been
 * a full task row since migration 066; new code calls the task functions
 * with `parentTaskId` and never comes through here.
 */
export async function createTodoSubtask(input: {
  id?: string;
  taskId: string;
  text: string;
}): Promise<TodoTask> {
  const parent = await subtaskParent(input.taskId);
  if (!parent) throw new PlanError("Task not found", 404);
  return createTodoTask({
    id: input.id,
    listId: parent.listId,
    parentTaskId: input.taskId,
    text: input.text,
  });
}

export async function updateTodoSubtask(
  id: string,
  patch: { text?: string; completed?: boolean; position?: number }
): Promise<TodoTask> {
  return updateTodoTask(id, patch);
}

export async function deleteTodoSubtask(id: string): Promise<void> {
  await deleteTodoTask(id);
}

export async function deleteTodoTask(id: string): Promise<void> {
  const { rows } = await todoDb().query(
    "DELETE FROM todo_tasks WHERE id = $1 RETURNING list_id, basecamp_id",
    [id]
  );
  // Idempotent for offline replay — already gone is success.
  if (!rows[0]) return;
  await pushRemote({
    type: "delete",
    listId: rows[0].list_id as string,
    basecampId: (rows[0].basecamp_id as string | null) ?? null,
  });
}

/**
 * Additive import of a backup file.
 *
 * Two shapes are read: this app's own export (`{groups, lists, tasks,
 * people}`, see backup.ts) and a Digital Habits: To-Do 2.x backup (the
 * localStorage blob: tabs keyed by id, with each tab's tasks inside it).
 *
 * Every group, list and task gets a fresh id, so an import can never
 * collide with a row the board already has, and one file can go in twice.
 * People are the exception: a person the board already knows, by Basecamp
 * id, email, source or name, is reused. The tasks then land on the roster
 * the board has, not on a second copy of each person.
 *
 * The groups, the lists and the tasks go in as one transaction. A file that
 * fails half-way leaves the board as it was. The people go in first, on
 * their own, because matching them is a read: a failure after that leaves
 * at most some people rows, which the next try matches again.
 */
export async function importTodoBackup(
  payload: Record<string, unknown>,
  options: {
    /**
     * Who is importing. Every task goes in as theirs, and a task on no
     * list is then personal to them, as it was to whoever exported it.
     */
    owner?: string | null;
  } = {}
): Promise<{ lists: number; tasks: number; groups: number; people: number }> {
  const counts = { lists: 0, tasks: 0, groups: 0, people: 0 };
  const owner = options.owner ?? null;

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v);
  /** The objects of an array, or of an object keyed by id. Junk is skipped. */
  const records = (v: unknown): Record<string, unknown>[] => {
    if (Array.isArray(v)) return v.filter(isRecord);
    if (isRecord(v)) return Object.values(v).filter(isRecord);
    return [];
  };
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  /**
   * An id from outside, as text. 2.x kept a Basecamp id as the number that
   * Basecamp sent, and a Reminders id as text. `str` alone let the text
   * through and dropped the number, so a 2.x board came in with its
   * Reminders links and without its Basecamp links: four lists and 234
   * tasks, on the first real board this read.
   */
  const idStr = (v: unknown): string | null =>
    typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);
  const asIso = (v: unknown): string | null => {
    if (typeof v === "number" && Number.isFinite(v)) {
      return new Date(v).toISOString();
    }
    if (typeof v === "string" && v && !Number.isNaN(Date.parse(v))) {
      return new Date(v).toISOString();
    }
    return null;
  };

  type RawTask = Record<string, unknown>;
  type RawList = Record<string, unknown>;

  let rawGroups: Record<string, unknown>[] = [];
  let rawLists: RawList[] = [];
  let rawPeople: Record<string, unknown>[] = [];
  let looseTasks: RawTask[] = [];

  if (isRecord(payload.tabs) || Array.isArray(payload.tabs)) {
    // A 2.x backup. Tasks sit inside their tab; there are no people.
    rawLists = records(payload.tabs);
    rawGroups = records(payload.groups);
  } else if (Array.isArray(payload.lists)) {
    // Our own export. Tasks are one flat array, each naming its list.
    rawLists = records(payload.lists);
    rawGroups = records(payload.groups);
    rawPeople = records(payload.people);
    looseTasks = records(payload.tasks);
  } else {
    throw new PlanError("Unrecognized backup format", 400);
  }

  // The day the file was written, from its own stamp. See due dates below.
  const exportedAt = asIso(payload.exportedAt);
  const exportDay = exportedAt ? exportedAt.slice(0, 10) : null;

  const { rows: posRows } = await todoDb().query(
    `SELECT COALESCE(MAX(position), 0) AS lists,
            (SELECT COALESCE(MAX(position), 0) FROM todo_groups) AS groups
       FROM todo_lists`
  );
  let listPos = Number(posRows[0].lists);
  let groupPos = Number(posRows[0].groups);

  // The file's person id -> the board's row for that human.
  const personIdMap = new Map<string, string>();
  for (const p of rawPeople) {
    const name = str(p.name)?.trim();
    if (!name) continue;
    const { person, created } = await upsertTodoPerson(randomUUID(), {
      name,
      colour: str(p.colour),
      photoUrl: str(p.photoUrl),
      sourceKind: isTodoPersonSourceKind(p.sourceKind) ? p.sourceKind : null,
      sourceId: idStr(p.sourceId),
      email: str(p.email),
      basecampPersonId: idStr(p.basecampPersonId),
      matchByName: true,
    });
    if (p.id != null) personIdMap.set(String(p.id), person.id);
    if (created) counts.people += 1;
  }

  const statements: SqlStatement[] = [];

  const groupIdMap = new Map<string, string>();
  for (const g of rawGroups) {
    const newId = randomUUID();
    if (g.id != null) groupIdMap.set(String(g.id), newId);
    groupPos += 1;
    statements.push({
      sql: `INSERT INTO todo_groups (id, name, colour, position)
            VALUES ($1, $2, $3, $4)`,
      params: [
        newId,
        str(g.name) ?? "Group",
        str(g.color) ?? str(g.colour),
        num(g.order) ?? groupPos,
      ],
    });
    counts.groups += 1;
  }

  const listIdMap = new Map<string, string>();
  // Old task id -> new, so a file's children can find their parent again;
  // new task id -> its list, so a legacy subtask lands on its task's list.
  const taskIdMap = new Map<string, string>();
  const taskListMap = new Map<string, string | null>();
  // A child can precede its parent in the file, and a task can name a
  // person the file lists later. Both links are written after every row.
  const childLinks: { newId: string; oldParentId: string }[] = [];
  const assigneeLinks: { newId: string; oldPersonIds: string[] }[] = [];

  const insertTask = (
    task: RawTask,
    listId: string | null,
    fallbackPos: number
  ) => {
    const newId = randomUUID();
    if (task.id != null) taskIdMap.set(String(task.id), newId);
    taskListMap.set(newId, listId);
    if (task.parentTaskId != null) {
      childLinks.push({ newId, oldParentId: String(task.parentTaskId) });
    }
    if (Array.isArray(task.assigneeIds) && task.assigneeIds.length) {
      assigneeLinks.push({ newId, oldPersonIds: task.assigneeIds.map(String) });
    }

    const expected = num(task.expectedDurationMinutes) ?? num(task.expectedDuration);
    // 2.x kept the time spent in milliseconds, under two names over time.
    const spentMs = num(task.actualDuration) ?? num(task.timeSpent);
    const spentSec =
      num(task.timeSpentSeconds) ?? (spentMs != null ? Math.round(spentMs / 1000) : 0);
    const completed = Boolean(task.completed);
    const isBacklog = Boolean(task.isBacklog);
    const isSomeday = Boolean(task.isSomeday);
    const isFavourite = Boolean(task.isFavourite);
    // 2.x had no Today column: the heart stood for it.
    const isToday =
      typeof task.isToday === "boolean"
        ? task.isToday
        : isFavourite && !isBacklog && !isSomeday;
    const dueOn =
      typeof task.dueOn === "string" && DUE_ON_RE.test(task.dueOn)
        ? task.dueOn
        : null;
    // Which due date has already put this task in Today. In Today now: this
    // one. Out of Today although its day had come before the file was
    // written: the reader moved it out, and the next board read must not
    // move it back. Otherwise null, so the date does its work when it comes.
    const duePromotedOn =
      dueOn && (isToday || (exportDay != null && dueOn < exportDay))
        ? dueOn
        : null;

    statements.push({
      sql: `INSERT INTO todo_tasks
         (id, list_id, text, notes_html, due_on, due_promoted_on,
          completed, completed_at, is_favourite, favourite_position,
          is_backlog, is_today, is_someday, colour, expected_duration_minutes,
          time_spent_seconds, position, basecamp_id, reminders_id, created_at,
          created_by, show_on_calendar)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               CASE WHEN $7 THEN COALESCE($8, NOW()) ELSE NULL END,
               $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
               COALESCE($20, NOW()), $21, $22)`,
      params: [
        newId,
        listId,
        typeof task.text === "string" ? task.text : "",
        str(task.notes) ?? str(task.notesHtml),
        dueOn,
        duePromotedOn,
        completed,
        asIso(task.completedAt),
        isFavourite,
        num(task.favouritePosition),
        isBacklog,
        isToday,
        isSomeday,
        str(task.color) ?? str(task.colour),
        expected,
        spentSec,
        num(task.position) ?? fallbackPos,
        idStr(task.basecampId),
        idStr(task.remindersId),
        asIso(task.createdAt),
        owner,
        // Only a dated task can be on the Calendar.
        Boolean(task.showOnCalendar) && dueOn != null,
      ],
    });
    counts.tasks += 1;
  };

  for (const list of rawLists) {
    const newId = randomUUID();
    if (list.id != null) listIdMap.set(String(list.id), newId);
    listPos += 1;
    statements.push({
      sql: `INSERT INTO todo_lists (id, name, group_id, colour, emoji, position,
              basecamp_project_id, basecamp_list_id, reminders_list_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      params: [
        newId,
        str(list.name) ?? "List",
        groupIdMap.get(String(list.groupId ?? "")) ?? null,
        str(list.color) ?? str(list.colour),
        str(list.emoji),
        listPos,
        idStr(list.basecampProjectId),
        idStr(list.basecampListId),
        idStr(list.remindersListId),
      ],
    });
    counts.lists += 1;
    records(list.tasks).forEach((task, i) => insertTask(task, newId, i));
  }

  // A task on no list stays on none. A task whose list is not in the file
  // has nowhere to go and is left out.
  looseTasks.forEach((task, i) => {
    if (task.listId == null) {
      insertTask(task, null, i);
      return;
    }
    const target = listIdMap.get(String(task.listId));
    if (target) insertTask(task, target, i);
  });

  // Children point at their parents once every task exists. A link whose
  // parent is not in the file is dropped: the child stays, as a task of
  // its own, rather than guessed onto some other parent.
  for (const link of childLinks) {
    const parentId = taskIdMap.get(link.oldParentId);
    if (!parentId) continue;
    statements.push({
      sql: "UPDATE todo_tasks SET parent_task_id = $1 WHERE id = $2",
      params: [parentId, link.newId],
    });
  }

  // Assignments, in the file's order, on the board's people. A person the
  // file does not list is skipped. The stamp is this import: the board's
  // assignment is the newest word on it, as with any local assignment.
  const assignedAt = new Date().toISOString();
  for (const link of assigneeLinks) {
    const ids = [
      ...new Set(
        link.oldPersonIds
          .map((oldId) => personIdMap.get(oldId))
          .filter((id): id is string => Boolean(id))
      ),
    ];
    if (!ids.length) continue;
    statements.push({
      sql: "UPDATE todo_tasks SET assignees_updated_at = $2 WHERE id = $1",
      params: [link.newId, assignedAt],
    });
    ids.forEach((personId, index) => {
      statements.push({
        sql: `INSERT INTO todo_task_assignees (task_id, person_id, position)
              VALUES ($1, $2, $3)`,
        params: [link.newId, personId, index],
      });
    });
  }

  // Subtasks from the one export shape that carried them as their own list
  // (before migration 066 made them tasks). Restored as child tasks.
  for (const subtask of records(payload.subtasks)) {
    const taskId = taskIdMap.get(String(subtask.taskId ?? ""));
    const listId = taskId ? taskListMap.get(taskId) : undefined;
    if (!taskId || listId === undefined) continue;
    statements.push({
      sql: `INSERT INTO todo_tasks
         (id, list_id, parent_task_id, text, completed, completed_at, position, basecamp_id)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, $6, $7)`,
      params: [
        randomUUID(),
        listId,
        taskId,
        typeof subtask.text === "string" ? subtask.text : "",
        Boolean(subtask.completed),
        num(subtask.position) ?? 0,
        idStr(subtask.basecampId),
      ],
    });
    counts.tasks += 1;
  }

  await todoDb().batch(statements);
  return counts;
}
