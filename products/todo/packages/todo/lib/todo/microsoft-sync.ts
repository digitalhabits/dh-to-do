/**
 * The two-way sync of one list linked to a Microsoft To Do list.
 *
 * What goes where:
 *   - task title   ↔ title
 *   - task note    ↔ body, as plain text (google-merge.ts has the rule)
 *   - done         ↔ status "completed"; not done ↔ any other status
 *   - due day      ↔ dueDateTime (microsoft-merge.ts)
 *
 * Each field settles on its own with the three-copy rule (github-merge.ts),
 * so a title changed here and a note changed in Microsoft both survive.
 *
 * The sync polls: the first time it reads the whole list, and after that
 * only what changed, from the place Microsoft gave at the last read (a
 * delta link). A task that did not change is taken to be as its base says.
 *
 * Where Microsoft To Do is not as this board:
 *   - It has no subtasks. A subtask here is a task of the list there, and
 *     a task from there comes in as a task of the list. Which task is
 *     under which is known on this side only.
 *   - Its "steps" are a title and a tick with no place for a note or a
 *     day. They do not sync.
 *   - It gives no order. New tasks from Microsoft come in oldest first,
 *     and the order of the board is not sent.
 *   - A task that repeats is left in Microsoft. Whether a repeat made
 *     through Graph makes the next task is not written down anywhere, and
 *     a repeat that stops without a word is worse than a task not shown.
 *
 * What it does not do, on purpose (as the Google sync):
 *   - A done task that Microsoft (or the board) never had is not copied.
 *   - A title emptied in Microsoft is not taken.
 *
 * A task deleted here is deleted in Microsoft at the next sync. The link
 * table keeps the Microsoft id of a task after the task is gone
 * (todo_microsoft_tasks has no foreign key), and a link with no task is a
 * task the person deleted.
 *
 * Tasks removed in Microsoft are removed here. More than a few in one
 * sync (MICROSOFT_REMOVE_LIMIT) stops the sync before it writes anything,
 * and the answer asks the person first.
 *
 * A read of the whole list that does not hold a linked task is not proof
 * that the task is gone: Microsoft does not say what such a read leaves
 * out. Each such task is asked for by itself before it counts as removed.
 *
 * Part of microsoft.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/todo/plan-error";

import { todoDb } from "./db-driver";
import { settle } from "./github-merge";
import { htmlToPlain, plainToHtml, settleGoogleNotes } from "./google-merge";
import { getMicrosoftLink } from "./microsoft-link";
import {
  type MicrosoftBase,
  dueFromMicrosoft,
  dueToMicrosoft,
  notesFromMicrosoft,
  parseMicrosoftBase,
} from "./microsoft-merge";
import {
  type MicrosoftTask,
  type MicrosoftTaskPatch,
  deleteMicrosoftTask,
  fitMicrosoftTitle,
  getMicrosoftTask,
  insertMicrosoftTask,
  listMicrosoftTaskChanges,
  patchMicrosoftTask,
} from "./microsoft-tasks";
import { randomUUID } from "./uuid";

type Row = Record<string, unknown>;

/** More removals than this in one sync: ask the person first. */
export const MICROSOFT_REMOVE_LIMIT = 5;

export type MicrosoftSyncResult = {
  pulled: number;
  pushed: number;
  updated: number;
  removed: number;
  /**
   * The sync stopped before any write: Microsoft no longer has this many
   * of the list's tasks. Run it again with `confirmRemovals` to remove them.
   */
  needsConfirm?: { count: number; titles: string[] };
};

export type MicrosoftSyncOptions = {
  /** The person said yes to removing many tasks. */
  confirmRemovals?: boolean;
};

/** One side's view of a task. "" stands for no due day. */
type Side = { title: string; notes: string; done: boolean; due: string };

/** What one sync of a list reads once and hands to each task. */
type ListSync = {
  listId: string;
  account: string;
  mlist: string;
  changed: Map<string, MicrosoftTask>;
  counts: { pulled: number; pushed: number; updated: number; removed: number };
};

/** Microsoft has no size limit for a note that it names: nothing is cut. */
const wholeNote = (notes: string) => notes;

export async function syncMicrosoftList(
  listId: string,
  options: MicrosoftSyncOptions = {}
): Promise<MicrosoftSyncResult> {
  const { rows: listRows } = await todoDb().query("SELECT * FROM todo_lists WHERE id = $1", [
    listId,
  ]);
  const list = listRows[0];
  if (!list || list.deleted_at) throw new PlanError("List not found", 404);
  const link = await getMicrosoftLink(listId);
  if (!link) throw new PlanError("List is not linked to Microsoft To Do", 400);
  const { account, microsoftListId: mlist, cursor } = link;

  const changes = await listMicrosoftTaskChanges(account, mlist, cursor);
  // Each task with its link, under the names the rest of this file reads.
  const { rows: taskRows } = await todoDb().query(
    `SELECT t.*, m.microsoft_id AS microsoft_id, m.base AS microsoft_base
     FROM todo_tasks t LEFT JOIN todo_microsoft_tasks m ON m.task_id = t.id
     WHERE t.list_id = $1`,
    [listId]
  );
  const sync: ListSync = {
    listId,
    account,
    mlist,
    changed: new Map(changes.tasks.map((task) => [task.id, task])),
    counts: { pulled: 0, pushed: 0, updated: 0, removed: 0 },
  };

  const gone = await goneTasks(sync, taskRows, changes.full);
  if (gone.length > MICROSOFT_REMOVE_LIMIT && !options.confirmRemovals) {
    return {
      ...sync.counts,
      needsConfirm: {
        count: gone.length,
        titles: gone.slice(0, MICROSOFT_REMOVE_LIMIT).map((row) => row.text as string),
      },
    };
  }
  const removed = await removeGone(sync, gone);

  for (const row of taskRows) {
    if (removed.has(row.id as string)) continue;
    if (linkedHere(sync, row)) {
      await syncLinkedTask(sync, row, parseMicrosoftBase(row.microsoft_base)!);
    } else {
      // Linked to another Microsoft list: the task was moved onto this list.
      if (row.microsoft_id) await releaseTask(row);
      await pushNewTask(sync, row);
    }
  }

  await releaseMovedAway(sync);
  const deleted = await deleteRemoved(sync);
  // The read at the top still shows the tasks just deleted in Microsoft.
  await pullNewTasks(
    sync,
    changes.tasks.filter((task) => !deleted.has(task.id))
  );
  if (changes.next) {
    await todoDb().query("UPDATE todo_microsoft_lists SET cursor = $1 WHERE list_id = $2", [
      changes.next,
      listId,
    ]);
  }
  return sync.counts;
}

/** True when the task is linked to a task of this sync's Microsoft list. */
function linkedHere(sync: ListSync, row: Row): boolean {
  if (!row.microsoft_id) return false;
  const base = parseMicrosoftBase(row.microsoft_base);
  return Boolean(base && base.list === sync.mlist && base.account === sync.account);
}

/**
 * The linked tasks that Microsoft no longer has. In a read of changes,
 * Microsoft says so. In a read of the whole list, a task not in the
 * answer is asked for by itself (see the top); one that is still there
 * joins the answer.
 */
async function goneTasks(sync: ListSync, rows: Row[], full: boolean): Promise<Row[]> {
  const gone: Row[] = [];
  for (const row of rows) {
    if (!linkedHere(sync, row)) continue;
    const id = row.microsoft_id as string;
    const task = sync.changed.get(id);
    if (task) {
      if (task["@removed"]) gone.push(row);
      continue;
    }
    if (!full) continue;
    const still = await getMicrosoftTask(sync.account, sync.mlist, id);
    if (still) sync.changed.set(id, still);
    else gone.push(row);
  }
  return gone;
}

/**
 * Remove the gone tasks. Microsoft has no subtasks, so it removed that one
 * task only: the subtasks of a removed task stay, as tasks of the list.
 */
async function removeGone(sync: ListSync, gone: Row[]): Promise<Set<string>> {
  const removed = new Set<string>();
  for (const row of gone) {
    const id = row.id as string;
    removed.add(id);
    await todoDb().query("UPDATE todo_tasks SET parent_task_id = NULL WHERE parent_task_id = $1", [
      id,
    ]);
    // The link first: a link with no task would read as "deleted here".
    await clearLink(id);
    await todoDb().query("DELETE FROM todo_tasks WHERE id = $1", [id]);
    sync.counts.removed += 1;
  }
  return removed;
}

/**
 * Microsoft's view of a task. A field that the answer leaves out is as
 * the base says; a due day left out is no due day (Graph leaves out an
 * empty one).
 */
function taskSide(task: MicrosoftTask, base: MicrosoftBase | null): Side {
  return {
    title: task.title ?? base?.title ?? "",
    notes: task.body ? notesFromMicrosoft(task.body) : (base?.notes ?? ""),
    done: task.status ? task.status === "completed" : Boolean(base?.done),
    due: dueFromMicrosoft(task.dueDateTime) ?? "",
  };
}

/** A task that did not change since the last sync is as the base says. */
function baseSide(base: MicrosoftBase): Side {
  return { title: base.title, notes: base.notes, done: base.done, due: base.due ?? "" };
}

/** A task linked to a Microsoft task: each field settled, then both sides written. */
async function syncLinkedTask(sync: ListSync, row: Row, base: MicrosoftBase) {
  const microsoftId = row.microsoft_id as string;
  const task = sync.changed.get(microsoftId) ?? null;
  const remote = task ? taskSide(task, base) : baseSide(base);
  const remoteTime = task?.lastModifiedDateTime ?? "";
  const localIsNewer = remoteTime ? timeMs(row.updated_at) > timeMs(remoteTime) : true;

  // A title emptied in Microsoft is no edit (see the top).
  const remoteTitle = remote.title.trim() ? remote.title : base.title;
  const title = settle(
    fitMicrosoftTitle(row.text as string),
    remoteTitle,
    base.title,
    localIsNewer
  );
  const localHtml = (row.notes_html as string | null) ?? "";
  const notes = settleGoogleNotes(localHtml, remote.notes, base, localIsNewer, wholeNote);
  const done = settle(Boolean(row.completed), remote.done, base.done, localIsNewer);
  const due = settle((row.due_on as string | null) ?? "", remote.due, base.due ?? "", localIsNewer);

  const patch: MicrosoftTaskPatch = {};
  if (title.value !== remoteTitle) patch.title = title.value;
  if (notes.push) patch.notes = notes.plain;
  if (done.value !== remote.done) patch.done = done.value;
  if (due.value !== remote.due) patch.due = dueToMicrosoft(due.value || null);

  const pushed = Object.keys(patch).length > 0;
  if (pushed) {
    const alive = await patchMicrosoftTask(sync.account, sync.mlist, microsoftId, patch);
    if (!alive) {
      // Microsoft lost the task between the read and the write. The task
      // stays here, no longer linked; nothing is deleted on a guess.
      await clearLink(row.id as string);
      return;
    }
    sync.counts.pushed += 1;
  }

  const pulled = title.pull || notes.pull || done.pull || due.pull;
  const nextBase: MicrosoftBase = {
    account: sync.account,
    list: sync.mlist,
    title: title.value,
    notes: notes.plain,
    notesHtml: notes.html,
    done: done.value,
    due: due.value || null,
  };
  // Agreed and on record: most tasks on most polls. Nothing to write.
  if (!pushed && !pulled && row.microsoft_base === JSON.stringify(nextBase)) return;
  await todoDb().query(
    `UPDATE todo_tasks SET text = $1, notes_html = $2, completed = $3,
       completed_at = CASE WHEN $3 AND NOT completed THEN NOW()
                           WHEN NOT $3 THEN NULL
                           ELSE completed_at END,
       due_on = $4,
       updated_at = CASE WHEN $5 THEN $6 ELSE updated_at END
     WHERE id = $7`,
    [
      title.pull ? title.value : (row.text as string),
      notes.html || null,
      done.value,
      due.value || null,
      pulled,
      new Date(timeMs(remoteTime) || Date.now()).toISOString(),
      row.id,
    ]
  );
  await saveLink(sync, row.id as string, microsoftId, nextBase);
  if (pulled) sync.counts.updated += 1;
}

/** The task's Microsoft id and the state both sides now hold. */
async function saveLink(sync: ListSync, taskId: string, microsoftId: string, base: MicrosoftBase) {
  await todoDb().query(
    `INSERT INTO todo_microsoft_tasks (task_id, list_id, microsoft_id, base)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id) DO UPDATE SET
       list_id = EXCLUDED.list_id,
       microsoft_id = EXCLUDED.microsoft_id,
       base = EXCLUDED.base`,
    [taskId, sync.listId, microsoftId, JSON.stringify(base)]
  );
}

async function clearLink(taskId: string) {
  await todoDb().query("DELETE FROM todo_microsoft_tasks WHERE task_id = $1", [taskId]);
}

/**
 * The task left its Microsoft list: it was moved to another list of the
 * board. Its Microsoft task is deleted there, and the link is cleared.
 */
async function releaseTask(row: Row) {
  const base = parseMicrosoftBase(row.microsoft_base);
  if (base?.account && base.list) {
    await deleteMicrosoftTask(base.account, base.list, row.microsoft_id as string).catch((err) => {
      console.warn("[todo] Microsoft To Do: an old task could not be removed:", err);
    });
  }
  await clearLink(row.id as string);
}

/**
 * Tasks linked under this list that are now on another list of the
 * board, or on none. Without this their Microsoft tasks would stay for ever.
 */
async function releaseMovedAway(sync: ListSync) {
  const { rows } = await todoDb().query(
    `SELECT t.id AS id, m.microsoft_id AS microsoft_id, m.base AS microsoft_base
     FROM todo_microsoft_tasks m JOIN todo_tasks t ON t.id = m.task_id
     WHERE m.list_id = $1 AND (t.list_id IS NULL OR t.list_id <> $1)`,
    [sync.listId]
  );
  for (const row of rows) {
    await releaseTask(row);
    sync.counts.pushed += 1;
  }
}

/**
 * Tasks the person deleted here: a link with no task. Each is deleted in
 * Microsoft, and then the link goes. A delete that Microsoft refuses keeps
 * its link, so the next sync tries again and the task is not pulled back in.
 */
async function deleteRemoved(sync: ListSync): Promise<Set<string>> {
  const deleted = new Set<string>();
  const { rows } = await todoDb().query(
    `SELECT m.task_id AS task_id, m.microsoft_id AS microsoft_id, m.base AS base
     FROM todo_microsoft_tasks m LEFT JOIN todo_tasks t ON t.id = m.task_id
     WHERE m.list_id = $1 AND t.id IS NULL`,
    [sync.listId]
  );
  for (const row of rows) {
    const base = parseMicrosoftBase(row.base);
    try {
      if (base?.account && base.list) {
        await deleteMicrosoftTask(base.account, base.list, row.microsoft_id as string);
      }
    } catch (err) {
      console.warn("[todo] Microsoft To Do: a deleted task could not be removed:", err);
      continue;
    }
    await clearLink(row.task_id as string);
    deleted.add(row.microsoft_id as string);
    sync.counts.pushed += 1;
  }
  return deleted;
}

/** An open task that Microsoft never had: a new Microsoft task. */
async function pushNewTask(sync: ListSync, row: Row) {
  if (row.completed) return;
  const notesHtml = (row.notes_html as string | null) ?? "";
  const notes = htmlToPlain(notesHtml);
  const due = (row.due_on as string | null) ?? null;
  const title = fitMicrosoftTitle(row.text as string);
  const created = await insertMicrosoftTask(sync.account, sync.mlist, {
    title,
    ...(notes ? { notes } : {}),
    ...(due ? { due: dueToMicrosoft(due) } : {}),
  });
  // Linked, and the two sides agree by construction: this is what we sent.
  const base: MicrosoftBase = {
    account: sync.account,
    list: sync.mlist,
    title: created.title ?? title,
    notes: created.body ? notesFromMicrosoft(created.body) : notes,
    notesHtml,
    done: false,
    due,
  };
  await saveLink(sync, row.id as string, created.id, base);
  sync.counts.pushed += 1;
}

/** Open tasks of Microsoft that the board does not have yet, oldest first. */
async function pullNewTasks(sync: ListSync, tasks: MicrosoftTask[]) {
  // Every link, also one whose task is gone: that task must not come back.
  const { rows } = await todoDb().query("SELECT microsoft_id FROM todo_microsoft_tasks");
  const known = new Set(rows.map((row) => row.microsoft_id as string));
  const fresh = tasks
    .filter(
      (task) =>
        !task["@removed"] &&
        !known.has(task.id) &&
        task.status !== "completed" &&
        !task.recurrence &&
        Boolean((task.title ?? "").trim())
    )
    .sort((a, b) => timeMs(a.createdDateTime) - timeMs(b.createdDateTime));
  for (const task of fresh) await pullNewTask(sync, task);
}

async function pullNewTask(sync: ListSync, task: MicrosoftTask) {
  const side = taskSide(task, null);
  const notesHtml = plainToHtml(side.notes);
  const base: MicrosoftBase = {
    account: sync.account,
    list: sync.mlist,
    title: side.title,
    notes: side.notes,
    notesHtml,
    done: false,
    due: side.due || null,
  };
  const taskId = randomUUID();
  await todoDb().query(
    `INSERT INTO todo_tasks
       (id, list_id, text, notes_html, due_on, completed, position, updated_at)
     VALUES ($1, $2, $3, $4, $5, FALSE,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = $2),
             $6)`,
    [
      taskId,
      sync.listId,
      side.title,
      notesHtml || null,
      side.due || null,
      new Date(timeMs(task.lastModifiedDateTime) || Date.now()).toISOString(),
    ]
  );
  await saveLink(sync, taskId, task.id, base);
  sync.counts.pulled += 1;
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
