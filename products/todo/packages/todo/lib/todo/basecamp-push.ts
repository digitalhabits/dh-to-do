/**
 * The push of one action to Basecamp as it happens on the board, and the
 * note pictures that go up first.
 *
 * Part of basecamp.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

import {
  localAssigneesByTask,
  splitAssigneesForPush,
} from "./basecamp-assignees";
import {
  type BasecampConnection,
  api,
  attachmentMissingUrl,
  bcFetch,
  getBasecampConnection,
  sleep,
} from "./basecamp-client";
import {
  createBasecampStep,
  createBasecampTodo,
  getBasecampTodo,
  listBasecampProjectPeople,
  normalizeBasecampNotes,
  setBasecampStepCompletion,
  setBasecampTodoCompletion,
  trashBasecampStep,
  trashBasecampTodo,
  updateBasecampStepTitle,
  updateBasecampTodo,
} from "./basecamp-todos";
import { todoDb } from "./db-driver";
import {
  noteMediaWithoutSgid,
  noteWithSgid,
  todoMediaStore,
} from "./media-store";

/**
 * The pictures in a note that Basecamp has not been given yet, given.
 *
 * A picture added to a task off Basecamp lives in the app's own store,
 * named on its tag by id (see media-store.ts). Basecamp strips that tag,
 * so before such a note goes up each picture is uploaded and its sgid
 * written onto the tag. The row is rewritten too, so the local copy and
 * the base the sync records both carry the sgid.
 *
 * A picture that cannot be uploaded stops the note: sent without it, the
 * next pull would read Basecamp's copy as the newer one and take the
 * picture out of the local note as well.
 */
export async function attachLocalMedia(
  conn: BasecampConnection,
  taskId: string,
  notesHtml: string | null | undefined
): Promise<string | null> {
  if (!notesHtml) return notesHtml ?? null;
  const pending = noteMediaWithoutSgid(notesHtml);
  if (!pending.length) return notesHtml;
  let html = notesHtml;
  for (const mediaId of pending) {
    const file = await todoMediaStore().read(mediaId);
    if (!file) {
      throw new PlanError("A picture in the note is missing from the store", 502);
    }
    const res = await bcFetch(
      conn,
      api(
        conn,
        `/attachments.json?name=${encodeURIComponent(file.filename || "image")}`
      ),
      {
        method: "POST",
        headers: { "Content-Type": file.contentType },
        // A plain buffer: both fetches take one, and the typing of a
        // Uint8Array over an unknown buffer does not pass as a body.
        body: file.bytes.slice().buffer,
      }
    );
    if (!res.ok) {
      throw new PlanError(
        `Basecamp would not take a picture from the note (${res.status})`,
        502
      );
    }
    const body = (await res.json()) as { attachable_sgid?: string };
    if (!body.attachable_sgid) {
      throw new PlanError("Basecamp did not sign a picture from the note", 502);
    }
    html = noteWithSgid(html, mediaId, body.attachable_sgid);
  }
  await todoDb().query(
    "UPDATE todo_tasks SET notes_html = $1 WHERE id = $2",
    [html, taskId]
  );
  return html;
}

type Row = Record<string, unknown>;

/** One action on the board, as it goes to Basecamp. */
type PushAction = {
  type:
    | "create"
    | "complete"
    | "update-text"
    | "assign"
    | "delete"
    | "move"
    | "subtask-create"
    | "subtask-update"
    | "subtask-delete";
  /** Null for a task on no list, which Basecamp never sees. */
  listId: string | null;
  fromListId?: string | null;
  taskId?: string;
  basecampId?: string | null;
  text?: string;
  notesHtml?: string | null;
  dueOn?: string | null;
  completed?: boolean;
  subtaskId?: string;
  subtaskBasecampId?: string | null;
};

/** What each handler needs: the connection and the list's link. */
type PushContext = {
  conn: BasecampConnection;
  list: Row;
  linked: boolean;
  projectId: string;
};

/**
 * A new step. Steps live under their to-do. A subtask of a task Basecamp
 * has never seen has nothing to hang from, and stays local until the next
 * full sync creates the to-do and its steps together.
 */
async function pushSubtaskCreate(ctx: PushContext, action: PushAction) {
  const { conn, projectId } = ctx;
  if (!action.basecampId || !action.subtaskId || !action.text) return;
  const step = await createBasecampStep(
    conn,
    projectId,
    action.basecampId,
    action.text
  );
  // The base goes down with the id: what Basecamp holds is what we sent.
  await todoDb().query(
    `UPDATE todo_tasks SET basecamp_id = $1,
       basecamp_base_text = $2, basecamp_base_completed = FALSE
     WHERE id = $3`,
    [String(step.id), action.text, action.subtaskId]
  );
}

/** A step's title or tick changed. */
async function pushSubtaskUpdate(ctx: PushContext, action: PushAction) {
  const { conn, projectId } = ctx;
  if (!action.subtaskBasecampId || !action.subtaskId) return;
  if (action.text !== undefined) {
    await updateBasecampStepTitle(
      conn,
      projectId,
      action.subtaskBasecampId,
      action.text
    );
  }
  if (action.completed !== undefined) {
    await setBasecampStepCompletion(
      conn,
      projectId,
      action.subtaskBasecampId,
      action.completed
    );
  }
  await todoDb().query(
    `UPDATE todo_tasks SET basecamp_base_text = $1,
       basecamp_base_completed = $2
     WHERE id = $3`,
    [action.text ?? null, action.completed ?? null, action.subtaskId]
  );
}

/** A step deleted. */
async function pushSubtaskDelete(ctx: PushContext, action: PushAction) {
  const { conn, projectId } = ctx;
  if (!action.subtaskBasecampId) return;
  await trashBasecampStep(conn, projectId, action.subtaskBasecampId);
}

/** A task moved to another list. */
async function pushMove(ctx: PushContext, action: PushAction) {
  const { conn, list, linked, projectId } = ctx;
  /*
    Basecamp cannot move a to-do from one list to another. Its own
    interface makes the to-do again in the target list and trashes the
    first, and so does this.
  */
  if (!action.basecampId || !action.fromListId || !action.taskId) return;
  const { rows: fromRows } = await todoDb().query(
    "SELECT basecamp_project_id FROM todo_lists WHERE id = $1",
    [action.fromListId]
  );
  const fromProjectId = fromRows[0]?.basecamp_project_id as
    | string
    | undefined;

  if (!linked) {
    // The task left Basecamp. Trash the to-do and forget its id: left
    // alone, the old list's next sync reads that to-do as new work and
    // pulls the task back onto it.
    if (fromProjectId) {
      await trashBasecampTodo(conn, fromProjectId, action.basecampId);
    }
    await todoDb().query(
      "UPDATE todo_tasks SET basecamp_id = NULL WHERE id = $1",
      [action.taskId]
    );
    // And the steps went down with the to-do. Ids kept here would read
    // as remote deletions on the next link, and the rows would follow
    // them. Forgotten, they are local rows a re-link creates afresh.
    await todoDb().query(
      `UPDATE todo_tasks SET basecamp_id = NULL,
         basecamp_base_text = NULL, basecamp_base_completed = NULL
       WHERE parent_task_id = $1`,
      [action.taskId]
    );
    return;
  }

  const assignees =
    (await localAssigneesByTask([action.taskId])).get(action.taskId) ?? [];
  let assigneeIds: number[] = [];
  if (assignees.length) {
    const projectPeople = await listBasecampProjectPeople(conn, projectId);
    assigneeIds = splitAssigneesForPush(
      assignees,
      new Set(projectPeople.map((person) => String(person.id)))
    ).ids;
  }
  const created = await createBasecampTodo(
    conn,
    projectId,
    list.basecamp_list_id as string,
    action.text ?? "",
    action.notesHtml ?? null,
    assigneeIds,
    action.dueOn ?? null
  );
  if (action.completed) {
    await setBasecampTodoCompletion(
      conn,
      projectId,
      String(created.id),
      true
    );
  }
  /*
    The new id is written before the old to-do is trashed, and not
    after.

    Either order can fail in the middle. This one leaves the task
    pointing at the to-do it now owns, and at worst one stray to-do on
    the old list, which the next sync pulls in as a task somebody can
    delete. The other order leaves the task pointing at a to-do that is
    gone, and the next sync of its own list deletes the task.
  */
  await todoDb().query(
    "UPDATE todo_tasks SET basecamp_id = $1 WHERE id = $2",
    [String(created.id), action.taskId]
  );
  /*
    The steps do not survive the move on their own: they belong to the
    to-do that is about to be trashed. Each is made again on the new
    to-do — before the old one goes, for the same reason the id is
    written before the trash — and the local row follows its new step.
  */
  const { rows: stepRows } = await todoDb().query(
    `SELECT id, text, completed FROM todo_tasks
     WHERE parent_task_id = $1 ORDER BY position, created_at`,
    [action.taskId]
  );
  for (const row of stepRows) {
    const step = await createBasecampStep(
      conn,
      projectId,
      String(created.id),
      row.text as string
    );
    if (row.completed) {
      await setBasecampStepCompletion(conn, projectId, String(step.id), true);
    }
    await todoDb().query(
      `UPDATE todo_tasks SET basecamp_id = $1,
         basecamp_base_text = $2, basecamp_base_completed = $3
       WHERE id = $4`,
      [String(step.id), row.text, Boolean(row.completed), row.id]
    );
  }
  if (fromProjectId) {
    await trashBasecampTodo(conn, fromProjectId, action.basecampId);
  }
}

/** A new task. */
async function pushCreate(ctx: PushContext, action: PushAction) {
  const { conn, list, projectId } = ctx;
  if (!action.taskId || !action.text) return;
  // The row already carries its assignees, because createTodoTask writes
  // them before it pushes. Read them the same way the assign branch does.
  // Without this the to-do reaches Basecamp with nobody on it, and stays
  // that way until the next full sync repairs it.
  const assignees =
    (await localAssigneesByTask([action.taskId])).get(action.taskId) ?? [];
  let assigneeIds: number[] = [];
  if (assignees.length) {
    const projectPeople = await listBasecampProjectPeople(conn, projectId);
    assigneeIds = splitAssigneesForPush(
      assignees,
      new Set(projectPeople.map((person) => String(person.id)))
    ).ids;
  }
  const created = await createBasecampTodo(
    conn,
    projectId,
    list.basecamp_list_id as string,
    action.text,
    action.notesHtml,
    assigneeIds,
    action.dueOn ?? null
  );
  await todoDb().query(
    "UPDATE todo_tasks SET basecamp_id = $1 WHERE id = $2",
    [String(created.id), action.taskId]
  );
}

/** A task ticked or unticked. */
async function pushComplete(ctx: PushContext, action: PushAction) {
  const { conn, projectId } = ctx;
  if (!action.basecampId) return;
  await setBasecampTodoCompletion(
    conn,
    projectId,
    action.basecampId,
    Boolean(action.completed)
  );
}

/** A task's title, note, due date or people changed. */
async function pushTextAndPeople(ctx: PushContext, action: PushAction) {
  const { conn, projectId } = ctx;
  if (!action.basecampId) return;
  if (!action.taskId || !action.text) return;
  // Title, notes and assignees all travel on the one PUT, because
  // Basecamp clears whatever the request leaves out. That is why an
  // assignment change and a text edit share this branch.
  const projectPeople = await listBasecampProjectPeople(conn, projectId);
  const assignees =
    (await localAssigneesByTask([action.taskId])).get(action.taskId) ?? [];
  const push = splitAssigneesForPush(
    assignees,
    new Set(projectPeople.map((person) => String(person.id)))
  );
  await updateBasecampTodo(conn, projectId, action.basecampId, {
    content: action.text,
    description: action.notesHtml,
    assigneeIds: push.ids,
    dueOn: action.dueOn ?? null,
  });
  /*
    Basecamp expands each `<bc-attachment>` on the way in: the tag
    that comes back carries url, href and a blob id. The skinny tag
    we sent cannot be drawn after a reopen — Trix treats it as an
    image with no src, and the browser asks for `/undefined`.

    Read the to-do back and keep what they wrote, so the next open
    has an address this app can proxy.
  */
  if (action.taskId && /<bc-attachment/i.test(action.notesHtml ?? "")) {
    let remote = await getBasecampTodo(
      conn,
      projectId,
      action.basecampId
    );
    /*
      Basecamp expands one tag at a time. A note with two pictures
      can come back with a url on the first and none on the second.
      Waiting for any url then writes that half-done HTML, and the
      second picture keeps a local id this process no longer has.
    */
    for (let i = 0; i < 5; i++) {
      if (!attachmentMissingUrl(remote?.description)) break;
      await sleep(400);
      remote =
        (await getBasecampTodo(conn, projectId, action.basecampId)) ??
        remote;
    }
    const expanded = normalizeBasecampNotes(remote?.description);
    if (expanded && !attachmentMissingUrl(expanded)) {
      await todoDb().query(
        `UPDATE todo_tasks
         SET notes_html = $1, basecamp_base_notes = $1, updated_at = NOW()
         WHERE id = $2`,
        [expanded, action.taskId]
      );
    }
  }
}

/** A task deleted. */
async function pushDelete(ctx: PushContext, action: PushAction) {
  const { conn, projectId } = ctx;
  if (!action.basecampId) return;
  await trashBasecampTodo(conn, projectId, action.basecampId);
}

/** The handler for each kind of action. */
const PUSH_HANDLERS: Record<
  PushAction["type"],
  (ctx: PushContext, action: PushAction) => Promise<void>
> = {
  "subtask-create": pushSubtaskCreate,
  "subtask-update": pushSubtaskUpdate,
  "subtask-delete": pushSubtaskDelete,
  move: pushMove,
  create: pushCreate,
  complete: pushComplete,
  "update-text": pushTextAndPeople,
  assign: pushTextAndPeople,
  delete: pushDelete,
};

/** Best-effort push of a local action to Basecamp; never blocks the caller's
 *  local write (failures surface at the next explicit sync). */
export async function pushBasecampAction(action: PushAction): Promise<void> {
  try {
    const conn = await getBasecampConnection();
    if (!conn) return;
    const { rows } = await todoDb().query(
      "SELECT basecamp_project_id, basecamp_list_id FROM todo_lists WHERE id = $1",
      [action.listId]
    );
    const list = rows[0];
    const linked = Boolean(
      list?.basecamp_project_id && list?.basecamp_list_id
    );
    // A move onto a list Basecamp does not know still has work to do on the
    // old list. Every other action needs a linked list to talk to.
    if (!linked && action.type !== "move") return;
    const projectId = list?.basecamp_project_id as string;
    // A note on its way to a linked list: its local pictures go up first.
    if (linked && action.taskId && action.notesHtml) {
      action.notesHtml = await attachLocalMedia(
        conn,
        action.taskId,
        action.notesHtml
      );
    }

    await PUSH_HANDLERS[action.type]({ conn, list, linked, projectId }, action);
  } catch (err) {
    console.warn("[todo] Basecamp push failed:", err);
  }
}
