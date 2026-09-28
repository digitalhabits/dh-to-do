/**
 * The two-way sync of one linked list, and of each to-do's steps.
 *
 * Part of basecamp.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

import {
  type AssigneeResolver,
  type LocalAssignee,
  boardPeopleForAssignees,
  localAssigneesByTask,
  newAssigneeResolver,
  sameIdSet,
  splitAssigneesForPush,
} from "./basecamp-assignees";
import {
  type BasecampConnection,
  getBasecampConnection,
} from "./basecamp-client";
import { attachLocalMedia } from "./basecamp-push";
import {
  type BasecampStep,
  type BasecampTodo,
  createBasecampStep,
  createBasecampTodo,
  fetchAllBasecampTodos,
  listBasecampProjectPeople,
  normalizeBasecampNotes,
  setBasecampStepCompletion,
  setBasecampTodoCompletion,
  syncTimeMs,
  updateBasecampStepTitle,
  updateBasecampTodo,
} from "./basecamp-todos";
import { todoDb } from "./db-driver";
import { setTaskAssignees } from "./people-store";
import { randomUUID } from "./uuid";

type Row = Record<string, unknown>;

/**
 * Settle one linked task's subtasks against its to-do's steps.
 *
 * The same three-copy rule the task fields use, per step and per field:
 * a title changed on a side when it differs from the last state both
 * sides held. Steps are plain text and a tick, so there is no reformat
 * problem — the base is still what tells an edit from the other side's
 * echo of our own push. Order is the one thing that cannot be pushed
 * (Basecamp has no route for it), so remote order is taken only for
 * steps arriving for the first time.
 */
export async function reconcileSteps(
  conn: BasecampConnection,
  projectId: string,
  taskId: string,
  todoBcId: string,
  remoteSteps: BasecampStep[],
  /** The parent's list, which every child shares. */
  listId: string,
  /*
    The task's local rows — its child tasks — read by the caller. One sync
    reads the whole list's children in one query and hands each task its
    share; a query per task starved the small pool for nothing, since most
    tasks have no steps on either side.
  */
  localRows?: Row[]
): Promise<{ pushed: boolean; pulled: boolean }> {
  if (localRows === undefined) {
    localRows = (
      await todoDb().query(
        "SELECT * FROM todo_tasks WHERE parent_task_id = $1 ORDER BY position, created_at",
        [taskId]
      )
    ).rows;
  }
  const remoteById = new Map(remoteSteps.map((step) => [String(step.id), step]));
  let pushed = false;
  let pulled = false;
  const seen = new Set<string>();

  for (const row of localRows) {
    const bcId = row.basecamp_id as string | null;
    if (bcId && remoteById.has(bcId)) {
      seen.add(bcId);
      const remote = remoteById.get(bcId)!;
      const localText = row.text as string;
      const localDone = Boolean(row.completed);
      const remoteText = remote.title;
      const remoteDone = Boolean(remote.completed);
      const baseText = (row.basecamp_base_text as string | null) ?? null;
      const baseDone =
        row.basecamp_base_completed === null ||
        row.basecamp_base_completed === undefined
          ? null
          : Boolean(row.basecamp_base_completed);
      const localIsNewer =
        syncTimeMs(row.updated_at) > syncTimeMs(remote.updated_at);
      const settleOne = <T,>(
        local: T,
        remote_: T,
        base: T | null
      ): { value: T; push: boolean; pull: boolean } => {
        if (local === remote_) return { value: local, push: false, pull: false };
        if (base !== null) {
          if (local !== base && remote_ === base)
            return { value: local, push: true, pull: false };
          if (remote_ !== base && local === base)
            return { value: remote_, push: false, pull: true };
        }
        return localIsNewer
          ? { value: local, push: true, pull: false }
          : { value: remote_, push: false, pull: true };
      };
      const text = settleOne(localText, remoteText, baseText);
      const done = settleOne(localDone, remoteDone, baseDone);
      if (text.push) {
        await updateBasecampStepTitle(conn, projectId, bcId, text.value as string);
      }
      if (done.push) {
        await setBasecampStepCompletion(conn, projectId, bcId, Boolean(done.value));
      }
      if (text.push || done.push || text.pull || done.pull || baseText === null) {
        await todoDb().query(
          `UPDATE todo_tasks SET text = $1, completed = $2,
             completed_at = CASE WHEN $2 AND NOT completed THEN NOW()
                                 WHEN NOT $2 THEN NULL
                                 ELSE completed_at END,
             basecamp_base_text = $1, basecamp_base_completed = $2,
             updated_at = CASE WHEN $3 THEN NOW() ELSE updated_at END
           WHERE id = $4`,
          [text.value, Boolean(done.value), text.pull || done.pull, row.id]
        );
      }
      if (text.push || done.push) pushed = true;
      if (text.pull || done.pull) pulled = true;
    } else if (bcId) {
      // The step is gone remotely; the subtask follows it.
      await todoDb().query("DELETE FROM todo_tasks WHERE id = $1", [row.id]);
      pulled = true;
    } else {
      // Never pushed: make the step and remember it.
      const created = await createBasecampStep(
        conn,
        projectId,
        todoBcId,
        row.text as string
      );
      if (row.completed) {
        await setBasecampStepCompletion(conn, projectId, String(created.id), true);
      }
      await todoDb().query(
        `UPDATE todo_tasks SET basecamp_id = $1,
           basecamp_base_text = $2, basecamp_base_completed = $3
         WHERE id = $4`,
        [String(created.id), row.text, Boolean(row.completed), row.id]
      );
      pushed = true;
    }
  }

  for (const step of remoteSteps) {
    const id = String(step.id);
    if (seen.has(id)) continue;
    if (localRows.some((row) => row.basecamp_id === id)) continue;
    await todoDb().query(
      `INSERT INTO todo_tasks
         (id, list_id, parent_task_id, text, completed, completed_at,
          position, basecamp_id, basecamp_base_text, basecamp_base_completed)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END,
               $6, $7, $4, $5)
       ON CONFLICT (list_id, basecamp_id) WHERE basecamp_id IS NOT NULL
         DO NOTHING`,
      [
        randomUUID(),
        listId,
        taskId,
        step.title,
        Boolean(step.completed),
        Number(step.position ?? 0),
        id,
      ]
    );
    pulled = true;
  }

  return { pushed, pulled };
}

export type BasecampSyncResult = {
  pulled: number;
  pushed: number;
  removed: number;
  updated: number;
  /** Board people Basecamp would not take — they are not on the project. */
  unpushableAssignees: string[];
  /** People matched to Basecamp by name because no email lined up. */
  nameLinkedPeople: string[];
  /** Names shared by several board people — added new rather than guessed. */
  ambiguousPeople: string[];
};

/**
 * Two-way sync of one linked list.
 *
 * Local actions push immediately. On an explicit sync, linked tasks use
 * last-write-wins (`updated_at` vs Basecamp `updated_at`) for title, notes,
 * and completion. Unknown remote todos are pulled in, local tasks that
 * vanished remotely are removed, and local tasks never pushed are created
 * remotely.
 *
 * Assignees are compared on their own stamp (`assignees_updated_at`), because
 * `updated_at` moves on every edit: without it, changing the notes locally
 * would make our assignee list look newer and undo a reassignment made in
 * Basecamp.
 */
export async function syncBasecampList(
  listId: string
): Promise<BasecampSyncResult> {
  const conn = await getBasecampConnection();
  if (!conn) throw new PlanError("Basecamp is not connected", 400);

  const { rows: listRows } = await todoDb().query(
    "SELECT * FROM todo_lists WHERE id = $1",
    [listId]
  );
  const list = listRows[0];
  if (!list) throw new PlanError("List not found", 404);
  if (!list.basecamp_project_id || !list.basecamp_list_id) {
    throw new PlanError("List is not linked to Basecamp", 400);
  }
  const projectId = list.basecamp_project_id as string;

  const remote = await fetchAllBasecampTodos(
    conn,
    projectId,
    list.basecamp_list_id as string
  );
  const remoteById = new Map(remote.map((t) => [String(t.id), t]));

  // Parents only: a child is its parent to-do's step, and reading it here
  // would create it remotely as a to-do of its own.
  const { rows: taskRows } = await todoDb().query(
    "SELECT * FROM todo_tasks WHERE list_id = $1 AND parent_task_id IS NULL",
    [listId]
  );

  const projectPeople = await listBasecampProjectPeople(conn, projectId);
  const projectPersonIds = new Set(projectPeople.map((p) => String(p.id)));
  const localAssignees = await localAssigneesByTask(
    taskRows.map((row) => row.id as string)
  );
  const subtasksByTask = await readSubtasksByTask(taskRows);

  const counts = { pulled: 0, pushed: 0, removed: 0, updated: 0 };
  const seenRemoteIds = new Set<string>();
  const unpushable = new Set<string>();
  const resolver = newAssigneeResolver();
  const sync: ListSync = {
    conn,
    listId,
    list,
    projectId,
    projectPersonIds,
    localAssignees,
    subtasksByTask,
    counts,
    unpushable,
    resolver,
  };

  for (const task of taskRows) {
    // Pictures off Basecamp go up first, and the note then names them the
    // way Basecamp does. Nothing to do for a note without any.
    task.notes_html = await attachLocalMedia(
      conn,
      task.id as string,
      task.notes_html as string | null
    );
    const bcId = task.basecamp_id as string | null;
    if (bcId && remoteById.has(bcId)) {
      seenRemoteIds.add(bcId);
      const remoteTodo = remoteById.get(bcId)!;
      await syncLinkedTask(sync, task, bcId, remoteTodo);
    } else if (bcId) {
      // Deleted or moved away remotely.
      await todoDb().query("DELETE FROM todo_tasks WHERE id = $1", [task.id]);
      counts.removed += 1;
    } else {
      await pushNewTask(sync, task);
    }
  }

  for (const todo of remote) {
    const id = String(todo.id);
    if (seenRemoteIds.has(id)) continue;
    const known = taskRows.some((t) => t.basecamp_id === id);
    if (known) continue;
    await pullNewTodo(sync, todo, id);
  }

  return {
    ...counts,
    unpushableAssignees: [...unpushable].sort(),
    nameLinkedPeople: [...resolver.nameLinked].sort(),
    ambiguousPeople: [...resolver.ambiguous].sort(),
  };
}

/** What one sync of a list reads once and hands to each step. */
type ListSync = {
  conn: BasecampConnection;
  listId: string;
  list: Row;
  projectId: string;
  projectPersonIds: Set<string>;
  localAssignees: Map<string, LocalAssignee[]>;
  subtasksByTask: Map<string, Row[]>;
  counts: { pulled: number; pushed: number; removed: number; updated: number };
  unpushable: Set<string>;
  resolver: AssigneeResolver;
};

/**
 * Every task's children in one read; reconcileSteps takes its share.
 * An IN list, not ANY(::text[]): the standalone app runs this same SQL
 * on SQLite, which has neither arrays nor the cast.
 */
async function readSubtasksByTask(taskRows: Row[]): Promise<Map<string, Row[]>> {
  const subtasksByTask = new Map<string, Row[]>();
  if (taskRows.length) {
    const taskIds = taskRows.map((row) => row.id as string);
    const { rows: subtaskRows } = await todoDb().query(
      `SELECT * FROM todo_tasks
       WHERE parent_task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
       ORDER BY position, created_at`,
      taskIds
    );
    for (const row of subtaskRows) {
      const key = row.parent_task_id as string;
      const list = subtasksByTask.get(key);
      if (list) list.push(row);
      else subtasksByTask.set(key, [row]);
    }
  }
  return subtasksByTask;
}

/**
 * One linked task's fields, each settled on its own: which side to
 * believe for the title, the note, the tick and the due date.
 */
function settleTaskFields(task: Row, remoteTodo: BasecampTodo) {
  const remoteText = remoteTodo.content;
  const localText = task.text as string;
  const remoteNotes = normalizeBasecampNotes(remoteTodo.description);
  const localNotes = normalizeBasecampNotes(
    task.notes_html as string | null
  );
  const remoteCompleted = Boolean(remoteTodo.completed);
  const localCompleted = Boolean(task.completed);
  const remoteDue = remoteTodo.due_on ?? null;
  const localDue = (task.due_on as string | null) ?? null;

  /*
    Three copies, not two.

    Comparing the two live copies cannot tell an edit from a
    reformatting, and Basecamp reformats every push: it keeps its own
    subset of HTML and rewrites the rest. So an untouched note read as
    an edit, and the newer clock then overwrote a real edit with it.

    `basecamp_base_*` holds the last state both sides are known to have
    held. A field changed on a side when it differs from that, and only
    then. Each field is settled on its own, so a title edited here and a
    note edited there both survive.

    No base means no exchange has been recorded — a task from before the
    column, or one that has never synced. Those fall back to the old
    comparison for one pass and get a base written as they go, so
    nothing needs backfilling.
  */
  const hasBase = task.basecamp_base_text !== null
    && task.basecamp_base_text !== undefined;
  const baseText = task.basecamp_base_text as string | null;
  const baseNotes = normalizeBasecampNotes(
    task.basecamp_base_notes as string | null
  );
  const baseCompleted =
    task.basecamp_base_completed === null ||
    task.basecamp_base_completed === undefined
      ? null
      : Boolean(task.basecamp_base_completed);
  const baseDue = (task.basecamp_base_due_on as string | null) ?? null;

  /** Which side to believe for one field. */
  function settle<T>(
    local: T,
    remote: T,
    base: T | null,
    localIsNewer: boolean
  ): { value: T; push: boolean; pull: boolean; conflict: boolean } {
    if (local === remote) {
      return { value: local, push: false, pull: false, conflict: false };
    }
    if (hasBase && base !== null) {
      const localMoved = local !== base;
      const remoteMoved = remote !== base;
      if (localMoved && !remoteMoved) {
        return { value: local, push: true, pull: false, conflict: false };
      }
      if (remoteMoved && !localMoved) {
        return { value: remote, push: false, pull: true, conflict: false };
      }
    }
    // Both moved, or there is nothing to measure against. The clock is
    // the only thing left, and now it is only ever used on a real
    // disagreement.
    return localIsNewer
      ? { value: local, push: true, pull: false, conflict: true }
      : { value: remote, push: false, pull: true, conflict: true };
  }

  const localIsNewer =
    syncTimeMs(task.updated_at) > syncTimeMs(remoteTodo.updated_at);
  const textCall = settle(localText, remoteText, baseText, localIsNewer);
  const notesCall = settle(localNotes, remoteNotes, baseNotes, localIsNewer);
  const completedCall = settle(
    localCompleted,
    remoteCompleted,
    baseCompleted,
    localIsNewer
  );
  const dueCall = settle(localDue, remoteDue, baseDue, localIsNewer);

  return {
    hasBase,
    textCall,
    notesCall,
    completedCall,
    dueCall,
  };
}

/**
 * One linked task's people: who can go up, and whether the board's or
 * Basecamp's are the newer.
 */
function settleTaskPeople(sync: ListSync, task: Row, remoteTodo: BasecampTodo) {
  const { projectPersonIds, localAssignees, unpushable } = sync;
  const mine = localAssignees.get(task.id as string) ?? [];
  const push = splitAssigneesForPush(mine, projectPersonIds);
  for (const name of push.blocked) unpushable.add(name);
  const remoteAssignees = remoteTodo.assignees ?? [];
  // Compare only what we could push. A board person Basecamp will not take
  // must not read as "the remote list is missing someone" on every sync.
  const assigneesDiff = !sameIdSet(
    push.ids.map(String),
    remoteAssignees.map((p) => String(p.id))
  );
  const remoteUpdatedMs = syncTimeMs(remoteTodo.updated_at);
  const localStampMs = syncTimeMs(task.assignees_updated_at);
  /**
   * Two guards, both learned the hard way.
   *
   * An empty remote set never clears a board assignment. Basecamp bumps
   * `updated_at` for any edit at all, so "no assignees there" is never
   * evidence that somebody meant to unassign — it usually just means the
   * assigning happens on the board. To unassign, unassign on the board.
   *
   * No stamp means the assignment predates assignee sync, not that it is
   * old. Reading a missing stamp as time zero is what let Basecamp erase
   * board assignments wholesale. Unstamped with people on it counts as
   * newer and pushes; unstamped with nobody on it still yields, which is
   * how assignments made in Basecamp first arrive.
   */
  const assigneesAreNewer =
    remoteAssignees.length === 0 && mine.length > 0
      ? true
      : localStampMs
        ? localStampMs > remoteUpdatedMs
        : mine.length > 0;

  return {
    push,
    remoteAssignees,
    assigneesDiff,
    assigneesAreNewer,
  };
}

/**
 * A task linked to a to-do that is still there: the fields and the people
 * settled, written to each side as needed, then the steps.
 */
async function syncLinkedTask(
  sync: ListSync,
  task: Row,
  bcId: string,
  remoteTodo: BasecampTodo
) {
  const { conn, listId, projectId, subtasksByTask, counts, resolver } = sync;
  const { hasBase, textCall, notesCall, completedCall, dueCall } =
    settleTaskFields(task, remoteTodo);
  const { push, remoteAssignees, assigneesDiff, assigneesAreNewer } =
    settleTaskPeople(sync, task, remoteTodo);

  // The people go to Basecamp only when the board's are the newer. When
  // Basecamp's are, they come to the board below, and a PUT for them
  // alone would only send Basecamp its own to-do again.
  const wantsPush =
    textCall.push ||
    notesCall.push ||
    completedCall.push ||
    dueCall.push ||
    (assigneesDiff && assigneesAreNewer);
  const wantsLocalWrite =
    textCall.pull || notesCall.pull || completedCall.pull || dueCall.pull;
  const settledText = textCall.value;
  const settledNotes = notesCall.value;
  const settledCompleted = completedCall.value;
  const settledDue = dueCall.value;

  if (!wantsPush && !wantsLocalWrite && !assigneesDiff) {
    // Linked and agreed. Record the agreement if it is not on record
    // yet, so the first sync after the column arrived gets its base.
    if (!hasBase) {
      await todoDb().query(
        `UPDATE todo_tasks SET basecamp_base_text = $1,
           basecamp_base_notes = $2, basecamp_base_completed = $3,
           basecamp_base_due_on = $4
         WHERE id = $5`,
        [settledText, settledNotes, settledCompleted, settledDue, task.id]
      );
    }
  } else {
    /*
      Both directions in one pass.

      A title edited here and a note edited there are two settlements,
      not one winner, so this can push and write locally in the same
      turn. Assignees keep their own rule and their own stamp; they ride
      on the PUT because Basecamp clears whatever the request leaves
      out.
    */
    if (wantsPush) {
      await updateBasecampTodo(conn, projectId, bcId, {
        content: settledText,
        description: settledNotes,
        assigneeIds:
          assigneesDiff && !assigneesAreNewer
            ? remoteAssignees.map((p) => Number(p.id))
            : push.ids,
        dueOn: settledDue,
      });
    }
    if (completedCall.push) {
      await setBasecampTodoCompletion(
        conn,
        projectId,
        bcId,
        settledCompleted
      );
    }

    const remoteUpdatedAt = remoteTodo.updated_at
      ? new Date(remoteTodo.updated_at)
      : new Date();

    /*
      The settled values and the base go down together.

      A push is not the end of it: Basecamp rewrites what it takes, so
      the base written here is what we believe it holds, and the next
      sync finds the rewrite on the remote side alone and pulls it in
      once. One quiet convergence rather than two sides arguing.
    */
    await todoDb().query(
      `UPDATE todo_tasks SET text = $1, completed = $2, notes_html = $3,
         due_on = $7,
         completed_at = CASE WHEN $2 AND NOT completed THEN NOW()
                             WHEN NOT $2 THEN NULL
                             ELSE completed_at END,
         updated_at = CASE WHEN $4 THEN $5 ELSE updated_at END,
         basecamp_base_text = $1,
         basecamp_base_notes = $3,
         basecamp_base_completed = $2,
         basecamp_base_due_on = $7
       WHERE id = $6`,
      [
        settledText,
        settledCompleted,
        settledNotes,
        wantsLocalWrite,
        remoteUpdatedAt,
        task.id,
        settledDue,
      ]
    );

    // Basecamp's people are the newer: they come to the board. The
    // board's, when they are the newer, went on the PUT above.
    if (assigneesDiff && !assigneesAreNewer) {
      const ids = await boardPeopleForAssignees(remoteAssignees, resolver);
      await setTaskAssignees(task.id as string, ids, remoteUpdatedAt);
    }

    if (wantsPush) counts.pushed += 1;
    // People taken from Basecamp change the board too, so they count as
    // an update, once, with the fields.
    if (wantsLocalWrite || (assigneesDiff && !assigneesAreNewer)) {
      counts.updated += 1;
    }
  }
  // The steps settle on their own, agreed task or not: a tick on a
  // subtask moves neither side's to-do fields.
  const steps = await reconcileSteps(
    conn,
    projectId,
    task.id as string,
    bcId,
    remoteTodo.steps ?? [],
    listId,
    subtasksByTask.get(task.id as string) ?? []
  );
  if (steps.pushed) counts.pushed += 1;
  if (steps.pulled) counts.updated += 1;
}

/** A task never pushed: made in Basecamp, with its steps. */
async function pushNewTask(sync: ListSync, task: Row) {
  const {
    conn,
    listId,
    list,
    projectId,
    projectPersonIds,
    localAssignees,
    subtasksByTask,
    counts,
    unpushable,
  } = sync;
  const push = splitAssigneesForPush(
    localAssignees.get(task.id as string) ?? [],
    projectPersonIds
  );
  for (const name of push.blocked) unpushable.add(name);
  const created = await createBasecampTodo(
    conn,
    projectId,
    list.basecamp_list_id as string,
    task.text as string,
    task.notes_html as string | null,
    push.ids,
    (task.due_on as string | null) ?? null
  );
  if (task.completed) {
    await setBasecampTodoCompletion(conn, projectId, String(created.id), true);
  }
  // Linked, and the two sides agree by construction: this is what we
  // just sent. Recording it here means the next sync measures against
  // it rather than falling back to the clock.
  await todoDb().query(
    `UPDATE todo_tasks SET basecamp_id = $1, updated_at = NOW(),
       basecamp_base_text = $2, basecamp_base_notes = $3,
       basecamp_base_completed = $4, basecamp_base_due_on = $6
     WHERE id = $5`,
    [
      String(created.id),
      task.text as string,
      normalizeBasecampNotes(task.notes_html as string | null),
      Boolean(task.completed),
      task.id,
      (task.due_on as string | null) ?? null,
    ]
  );
  await reconcileSteps(
    conn,
    projectId,
    task.id as string,
    String(created.id),
    [],
    listId,
    subtasksByTask.get(task.id as string) ?? []
  );
  counts.pushed += 1;
}

/** A to-do the board does not have yet: pulled in, with its steps and people. */
async function pullNewTodo(sync: ListSync, todo: BasecampTodo, id: string) {
  const { conn, listId, projectId, counts, resolver } = sync;
  const taskId = randomUUID();
  // `taskRows` is a snapshot from before the Basecamp calls above. A sync
  // that started in parallel can insert this to-do while this one waits on
  // the network, and the snapshot cannot show it. The unique index on
  // (list_id, basecamp_id) rejects the second insert, and DO NOTHING makes
  // that a no-op instead of an error. An empty RETURNING means the other
  // sync won the race, so this pass adds no assignees and counts no pull.
  const { rows: inserted } = await todoDb().query(
    // The base goes in with it: what arrives is, by definition, what the
    // two sides agree on right now.
    `INSERT INTO todo_tasks
       (id, list_id, text, notes_html, completed, completed_at, position, basecamp_id,
        due_on, basecamp_base_text, basecamp_base_notes, basecamp_base_completed,
        basecamp_base_due_on)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = $2),
             $6, $7, $3, $4, $5, $7)
     ON CONFLICT (list_id, basecamp_id) WHERE basecamp_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      taskId,
      listId,
      todo.content,
      normalizeBasecampNotes(todo.description),
      Boolean(todo.completed),
      id,
      todo.due_on ?? null,
    ]
  );
  if (!inserted[0]) return;
  if (todo.steps?.length) {
    await reconcileSteps(conn, projectId, taskId, id, todo.steps, listId, []);
  }
  const assignees = todo.assignees ?? [];
  if (assignees.length) {
    const ids = await boardPeopleForAssignees(assignees, resolver);
    await setTaskAssignees(
      taskId,
      ids,
      todo.updated_at ? new Date(todo.updated_at) : new Date()
    );
  }
  counts.pulled += 1;
}
