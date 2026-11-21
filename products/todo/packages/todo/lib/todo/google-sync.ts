/**
 * The two-way sync of one list linked to a Google Tasks list.
 *
 * What goes where:
 *   - task title   ↔ title
 *   - task note    ↔ notes, as plain text (google-merge.ts)
 *   - done         ↔ status "completed"; not done ↔ "needsAction"
 *   - due day      ↔ due (Google keeps the day only)
 *   - subtask      ↔ a task with a parent (Google allows one level)
 *
 * Each field settles on its own with the three-copy rule (google-merge.ts),
 * so a title changed here and a note changed in Google both survive.
 *
 * The sync polls: the first time it reads the whole list, and after that
 * only the tasks changed since the newest change it saw. A task that did
 * not change is taken to be as its base says.
 *
 * What it does not do, on purpose:
 *   - A done task that Google (or the board) never had is not copied. A
 *     list linked late would fill the other side with old done work.
 *   - A title emptied in Google is not taken. An empty title is more often
 *     a slip than a wish, and this side cannot show a task with no words.
 *   - The order of the board is not sent to Google. New tasks from Google
 *     come in Google's order.
 *
 * A task deleted here is deleted in Google at the next sync. The link
 * table keeps the Google id of a task after the task is gone
 * (todo_google_tasks has no foreign key), and a link with no task is a
 * task the person deleted. So a delete made offline is not lost, and the
 * task does not come back from Google.
 *
 * Tasks removed in Google are removed here. More than a few in one sync
 * (GOOGLE_REMOVE_LIMIT) stops the sync before it writes anything, and the
 * answer asks the person first: an emptied or wrongly linked Google list
 * must not empty the board without a word.
 *
 * Part of google.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/todo/plan-error";

import { todoDb } from "./db-driver";
import { settle } from "./github-merge";
import { getGoogleLink } from "./google-link";
import {
  type GoogleBase,
  dueFromGoogle,
  dueToGoogle,
  htmlToPlain,
  normalizePlain,
  parseGoogleBase,
  plainToHtml,
  settleGoogleNotes,
} from "./google-merge";
import {
  type GoogleTask,
  type GoogleTaskPatch,
  deleteGoogleTask,
  fitNotes,
  fitTitle,
  insertGoogleTask,
  listGoogleTaskChanges,
  moveGoogleTask,
  patchGoogleTask,
} from "./google-tasks";
import { randomUUID } from "./uuid";

type Row = Record<string, unknown>;

/** More removals than this in one sync: ask the person first. */
export const GOOGLE_REMOVE_LIMIT = 5;

export type GoogleSyncResult = {
  pulled: number;
  pushed: number;
  updated: number;
  removed: number;
  /**
   * The sync stopped before any write: Google no longer has this many of
   * the list's tasks. Run it again with `confirmRemovals` to remove them.
   */
  needsConfirm?: { count: number; titles: string[] };
};

export type GoogleSyncOptions = {
  /** The person said yes to removing many tasks. */
  confirmRemovals?: boolean;
};

/** One side's view of a task. "" stands for no due day and for no parent. */
type Side = { title: string; notes: string; done: boolean; due: string; parent: string };

/** What one sync of a list reads once and hands to each task. */
type ListSync = {
  listId: string;
  account: string;
  glist: string;
  changed: Map<string, GoogleTask>;
  /** Local task id → Google id, for every linked task of the list. */
  googleIdOf: Map<string, string>;
  /** Google id → local task id. */
  localIdOf: Map<string, string>;
  /** Local task id → its row, to walk up to a task's top parent. */
  rows: Map<string, Row>;
  counts: { pulled: number; pushed: number; updated: number; removed: number };
};

export async function syncGoogleList(
  listId: string,
  options: GoogleSyncOptions = {}
): Promise<GoogleSyncResult> {
  const { rows: listRows } = await todoDb().query(
    "SELECT * FROM todo_lists WHERE id = $1",
    [listId]
  );
  const list = listRows[0];
  if (!list || list.deleted_at) throw new PlanError("List not found", 404);
  const link = await getGoogleLink(listId);
  if (!link) throw new PlanError("List is not linked to Google Tasks", 400);
  const { account, googleListId: glist, cursor } = link;

  const changes = await listGoogleTaskChanges(account, glist, cursor);
  // Each task with its link, under the names the rest of this file reads.
  const { rows: taskRows } = await todoDb().query(
    `SELECT t.*, g.google_id AS google_id, g.base AS google_base
     FROM todo_tasks t LEFT JOIN todo_google_tasks g ON g.task_id = t.id
     WHERE t.list_id = $1`,
    [listId]
  );
  const sync: ListSync = {
    listId,
    account,
    glist,
    changed: new Map(changes.tasks.map((task) => [task.id, task])),
    googleIdOf: new Map(),
    localIdOf: new Map(),
    rows: new Map(taskRows.map((row) => [row.id as string, row])),
    counts: { pulled: 0, pushed: 0, updated: 0, removed: 0 },
  };

  const gone = taskRows.filter((row) => isGone(sync, row, changes.full));
  if (gone.length > GOOGLE_REMOVE_LIMIT && !options.confirmRemovals) {
    return {
      ...sync.counts,
      needsConfirm: {
        count: gone.length,
        titles: gone.slice(0, GOOGLE_REMOVE_LIMIT).map((row) => row.text as string),
      },
    };
  }
  const removed = await removeGone(sync, gone);

  // Parents first: a subtask is made in Google under its parent's id.
  const live = taskRows
    .filter((row) => !removed.has(row.id as string))
    .sort((a, b) => Number(Boolean(a.parent_task_id)) - Number(Boolean(b.parent_task_id)));
  for (const row of live) {
    if (linkedHere(sync, row)) remember(sync, row.id as string, row.google_id as string);
  }
  for (const row of live) {
    if (linkedHere(sync, row)) {
      await syncLinkedTask(sync, row, parseGoogleBase(row.google_base)!);
    } else {
      // Linked to another Google list: the task was moved onto this list.
      if (row.google_id) await releaseTask(row);
      await pushNewTask(sync, row);
    }
  }

  await releaseMovedAway(sync);
  const deleted = await deleteRemoved(sync);
  // The read at the top still shows the tasks just deleted in Google.
  await pullNewTasks(
    sync,
    changes.tasks.filter((task) => !deleted.has(task.id))
  );
  await saveCursor(listId, cursor, changes);
  return sync.counts;
}

/** True when the task is linked to a task of this sync's Google list. */
function linkedHere(sync: ListSync, row: Row): boolean {
  if (!row.google_id) return false;
  const base = parseGoogleBase(row.google_base);
  return Boolean(base && base.list === sync.glist && base.account === sync.account);
}

function remember(sync: ListSync, localId: string, googleId: string) {
  sync.googleIdOf.set(localId, googleId);
  sync.localIdOf.set(googleId, localId);
}

/**
 * Google no longer has the task. In a read of changes, Google says so. In
 * a read of the whole list, the task is not in the answer.
 */
function isGone(sync: ListSync, row: Row, full: boolean): boolean {
  if (!linkedHere(sync, row)) return false;
  const task = sync.changed.get(row.google_id as string);
  return full ? !task : Boolean(task?.deleted);
}

/** Remove the gone tasks, each with its subtasks, as Google removed them. */
async function removeGone(sync: ListSync, gone: Row[]): Promise<Set<string>> {
  const removed = new Set<string>();
  for (const row of gone) {
    const id = row.id as string;
    for (const other of sync.rows.values()) {
      if (other.parent_task_id === id) removed.add(other.id as string);
    }
    removed.add(id);
    // The links first: a link with no task would read as "deleted here".
    await todoDb().query(
      `DELETE FROM todo_google_tasks WHERE task_id = $1
         OR task_id IN (SELECT id FROM todo_tasks WHERE parent_task_id = $1)`,
      [id]
    );
    await todoDb().query("DELETE FROM todo_tasks WHERE id = $1 OR parent_task_id = $1", [id]);
    sync.counts.removed += 1;
  }
  return removed;
}

/**
 * The Google id a task hangs under: that of its top parent, because
 * Google allows one level. "" for a task of the list itself, and for a
 * subtask whose parent Google does not have.
 */
function googleParentOf(sync: ListSync, row: Row): string {
  let parentId: string = (row.parent_task_id as string | null) ?? "";
  if (!parentId) return "";
  for (let hops = 0; hops < 10; hops++) {
    const above: string = (sync.rows.get(parentId)?.parent_task_id as string | null) ?? "";
    if (!above) break;
    parentId = above;
  }
  return sync.googleIdOf.get(parentId) ?? "";
}

function taskSide(task: GoogleTask): Side {
  return {
    title: task.title ?? "",
    notes: normalizePlain(task.notes),
    done: task.status === "completed",
    due: dueFromGoogle(task.due) ?? "",
    parent: task.parent ?? "",
  };
}

/** A task that did not change since the last sync is as the base says. */
function baseSide(base: GoogleBase): Side {
  return {
    title: base.title,
    notes: base.notes,
    done: base.done,
    due: base.due ?? "",
    parent: base.parent ?? "",
  };
}

/** A task linked to a Google task: each field settled, then both sides written. */
async function syncLinkedTask(sync: ListSync, row: Row, base: GoogleBase) {
  const googleId = row.google_id as string;
  const task = sync.changed.get(googleId) ?? null;
  const remote = task ? taskSide(task) : baseSide(base);
  const localIsNewer = task ? timeMs(row.updated_at) > timeMs(task.updated) : true;

  // A title emptied in Google is no edit (see the top).
  const remoteTitle = remote.title.trim() ? remote.title : base.title;
  const title = settle(fitTitle(row.text as string), remoteTitle, base.title, localIsNewer);
  const localHtml = (row.notes_html as string | null) ?? "";
  const notes = settleGoogleNotes(localHtml, remote.notes, base, localIsNewer);
  const done = settle(Boolean(row.completed), remote.done, base.done, localIsNewer);
  const due = settle((row.due_on as string | null) ?? "", remote.due, base.due ?? "", localIsNewer);
  const parent = settle(googleParentOf(sync, row), remote.parent, base.parent ?? "", localIsNewer);

  const patch: GoogleTaskPatch = {};
  if (title.value !== remoteTitle) patch.title = title.value;
  if (notes.push) patch.notes = notes.plain;
  if (done.value !== remote.done) patch.status = done.value ? "completed" : "needsAction";
  if (due.value !== remote.due) patch.due = dueToGoogle(due.value || null);

  let alive = true;
  if (Object.keys(patch).length) {
    alive = Boolean(await patchGoogleTask(sync.account, sync.glist, googleId, patch));
  }
  if (alive && parent.push) {
    alive = Boolean(await moveGoogleTask(sync.account, sync.glist, googleId, parent.value || null));
  }
  if (!alive) {
    // Google lost the task between the read and the write. The task
    // stays here, no longer linked; nothing is deleted on a guess.
    await clearLink(row.id as string);
    sync.googleIdOf.delete(row.id as string);
    sync.localIdOf.delete(googleId);
    return;
  }
  const pushed = Object.keys(patch).length > 0 || parent.push;
  if (pushed) sync.counts.pushed += 1;

  const pulled = title.pull || notes.pull || done.pull || due.pull || parent.pull;
  const nextBase: GoogleBase = {
    account: sync.account,
    list: sync.glist,
    title: title.value,
    notes: notes.plain,
    notesHtml: notes.html,
    done: done.value,
    due: due.value || null,
    parent: parent.value || null,
  };
  // Agreed and on record: most tasks on most polls. Nothing to write.
  if (!pushed && !pulled && row.google_base === JSON.stringify(nextBase)) return;
  await writeLinkedTask(sync, row, {
    text: title.pull ? title.value : (row.text as string),
    notesHtml: notes.html,
    done: done.value,
    due: due.value || null,
    parentPulled: parent.pull ? parent.value : null,
    base: nextBase,
    stamp: pulled ? new Date(task ? task.updated : Date.now()).toISOString() : null,
  });
  if (pulled) sync.counts.updated += 1;
}

/** The settled task and the new base go down together. */
async function writeLinkedTask(
  sync: ListSync,
  row: Row,
  next: {
    text: string;
    notesHtml: string;
    done: boolean;
    due: string | null;
    /** Null: the parent stays. "": no parent. Else the parent's Google id. */
    parentPulled: string | null;
    base: GoogleBase;
    /** The time of the change, when Google's side was taken. */
    stamp: string | null;
  }
) {
  let parentId = (row.parent_task_id as string | null) ?? null;
  if (next.parentPulled !== null) {
    // A parent the board does not have: the task stays where it is.
    const known = next.parentPulled ? sync.localIdOf.get(next.parentPulled) : null;
    if (!next.parentPulled || known) parentId = known ?? null;
  }
  await todoDb().query(
    `UPDATE todo_tasks SET text = $1, notes_html = $2, completed = $3,
       completed_at = CASE WHEN $3 AND NOT completed THEN NOW()
                           WHEN NOT $3 THEN NULL
                           ELSE completed_at END,
       due_on = $4, parent_task_id = $5,
       updated_at = CASE WHEN $6 THEN $7 ELSE updated_at END
     WHERE id = $8`,
    [
      next.text,
      next.notesHtml || null,
      next.done,
      next.due,
      parentId,
      Boolean(next.stamp),
      next.stamp ?? new Date().toISOString(),
      row.id,
    ]
  );
  await saveLink(sync, row.id as string, row.google_id as string, next.base);
}

/** The task's Google id and the state both sides now hold. */
async function saveLink(sync: ListSync, taskId: string, googleId: string, base: GoogleBase) {
  await todoDb().query(
    `INSERT INTO todo_google_tasks (task_id, list_id, google_id, base)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id) DO UPDATE SET
       list_id = EXCLUDED.list_id,
       google_id = EXCLUDED.google_id,
       base = EXCLUDED.base`,
    [taskId, sync.listId, googleId, JSON.stringify(base)]
  );
}

async function clearLink(taskId: string) {
  await todoDb().query("DELETE FROM todo_google_tasks WHERE task_id = $1", [taskId]);
}

/**
 * The task left its Google list: it was moved to another list of the
 * board. Its Google task is deleted there, and the link is cleared.
 */
async function releaseTask(row: Row) {
  const base = parseGoogleBase(row.google_base);
  if (base?.account && base.list) {
    await deleteGoogleTask(base.account, base.list, row.google_id as string).catch((err) => {
      console.warn("[todo] Google Tasks: an old task could not be removed:", err);
    });
  }
  await clearLink(row.id as string);
}

/**
 * Tasks linked under this list that are now on another list of the
 * board, or on none. Without this their Google tasks would stay for ever.
 */
async function releaseMovedAway(sync: ListSync) {
  const { rows } = await todoDb().query(
    `SELECT t.id AS id, g.google_id AS google_id, g.base AS google_base
     FROM todo_google_tasks g JOIN todo_tasks t ON t.id = g.task_id
     WHERE g.list_id = $1 AND (t.list_id IS NULL OR t.list_id <> $1)`,
    [sync.listId]
  );
  for (const row of rows) {
    await releaseTask(row);
    sync.counts.pushed += 1;
  }
}

/**
 * Tasks the person deleted here: a link with no task. Each is deleted in
 * Google, and then the link goes. A delete that Google refuses keeps its
 * link, so the next sync tries again and the task is not pulled back in.
 */
async function deleteRemoved(sync: ListSync): Promise<Set<string>> {
  const deleted = new Set<string>();
  const { rows } = await todoDb().query(
    `SELECT g.task_id AS task_id, g.google_id AS google_id, g.base AS base
     FROM todo_google_tasks g LEFT JOIN todo_tasks t ON t.id = g.task_id
     WHERE g.list_id = $1 AND t.id IS NULL`,
    [sync.listId]
  );
  for (const row of rows) {
    const base = parseGoogleBase(row.base);
    try {
      if (base?.account && base.list) {
        await deleteGoogleTask(base.account, base.list, row.google_id as string);
      }
    } catch (err) {
      console.warn("[todo] Google Tasks: a deleted task could not be removed:", err);
      continue;
    }
    await clearLink(row.task_id as string);
    deleted.add(row.google_id as string);
    sync.counts.pushed += 1;
  }
  return deleted;
}

/** An open task that Google never had: a new Google task. */
async function pushNewTask(sync: ListSync, row: Row) {
  if (row.completed) return;
  const notesHtml = (row.notes_html as string | null) ?? "";
  const parent = googleParentOf(sync, row);
  const due = (row.due_on as string | null) ?? null;
  const created = await insertGoogleTask(
    sync.account,
    sync.glist,
    {
      title: fitTitle(row.text as string),
      notes: fitNotes(htmlToPlain(notesHtml)),
      ...(due ? { due: dueToGoogle(due) } : {}),
    },
    parent || null
  );
  // Linked, and the two sides agree by construction: this is what we sent.
  const base: GoogleBase = {
    account: sync.account,
    list: sync.glist,
    title: created.title ?? fitTitle(row.text as string),
    notes: normalizePlain(created.notes),
    notesHtml,
    done: false,
    due,
    parent: parent || null,
  };
  await saveLink(sync, row.id as string, created.id, base);
  remember(sync, row.id as string, created.id);
  sync.counts.pushed += 1;
}

/** Open tasks of Google that the board does not have yet, in Google's order. */
async function pullNewTasks(sync: ListSync, tasks: GoogleTask[]) {
  // Every link, also one whose task is gone: that task must not come back.
  const { rows } = await todoDb().query("SELECT google_id FROM todo_google_tasks");
  const known = new Set(rows.map((row) => row.google_id as string));
  const fresh = tasks
    .filter(
      (task) =>
        !task.deleted &&
        !known.has(task.id) &&
        task.status !== "completed" &&
        Boolean((task.title ?? "").trim())
    )
    .sort(
      (a, b) =>
        Number(Boolean(a.parent)) - Number(Boolean(b.parent)) ||
        (a.position ?? "").localeCompare(b.position ?? "")
    );
  for (const task of fresh) await pullNewTask(sync, task);
}

async function pullNewTask(sync: ListSync, task: GoogleTask) {
  const side = taskSide(task);
  const notesHtml = plainToHtml(side.notes);
  const base: GoogleBase = {
    account: sync.account,
    list: sync.glist,
    title: side.title,
    notes: side.notes,
    notesHtml,
    done: false,
    due: side.due || null,
    parent: side.parent || null,
  };
  const taskId = randomUUID();
  await todoDb().query(
    `INSERT INTO todo_tasks
       (id, list_id, parent_task_id, text, notes_html, due_on, completed, position, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = $2),
             $7)`,
    [
      taskId,
      sync.listId,
      // A subtask whose parent the board does not have comes in as a task.
      (side.parent && sync.localIdOf.get(side.parent)) || null,
      side.title,
      notesHtml || null,
      side.due || null,
      new Date(task.updated).toISOString(),
    ]
  );
  await saveLink(sync, taskId, task.id, base);
  remember(sync, taskId, task.id);
  sync.counts.pulled += 1;
}

/**
 * Where the next poll starts: the newest change seen. With no change, the
 * old place; with none at all, Google's clock at the answer.
 */
async function saveCursor(
  listId: string,
  cursor: string | null,
  changes: Awaited<ReturnType<typeof listGoogleTaskChanges>>
) {
  let next = cursor;
  for (const task of changes.tasks) {
    if (!next || timeMs(task.updated) > timeMs(next)) next = task.updated;
  }
  if (!next) {
    const date = changes.serverDate ? new Date(changes.serverDate) : new Date();
    next = (Number.isNaN(date.getTime()) ? new Date() : date).toISOString();
  }
  await todoDb().query("UPDATE todo_google_lists SET cursor = $1 WHERE list_id = $2", [
    next,
    listId,
  ]);
}

/**
 * A stamp in milliseconds. SQLite's datetime('now') gives
 * "YYYY-MM-DD HH:MM:SS" in UTC with no zone, which Date would read as
 * local time.
 */
function timeMs(value: unknown): number {
  if (!value) return 0;
  const text =
    typeof value === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const ms = new Date(text as string).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}
