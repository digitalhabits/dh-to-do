/**
 * The two-way sync of one list linked to a GitHub repository.
 *
 * What goes where:
 *   - task title      ↔ issue title
 *   - task note       ↔ issue body, in markdown (github-markdown.ts)
 *   - subtasks        ↔ the task list at the end of the body
 *   - done            ↔ closed as completed; not done ↔ open
 *   - board people    ↔ assignees, by GitHub login (github-people.ts)
 *
 * Only a task ticked "Public on GitHub" goes up, because on a public
 * repository the title, the note and the subtasks are published. Every
 * open issue comes down, ticked. A closed issue that the board does not
 * have stays on GitHub.
 *
 * The sync polls (listIssueChanges): the first time it reads the open
 * issues, and after that only the issues changed since the newest one it
 * saw, with an ETag. An issue that did not change is taken to be as the
 * base says, so a task changed here is measured against that.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { PlanError } from "@/lib/plan/errors";

import { todoDb } from "./db-driver";
import {
  type BodySubtask,
  joinIssueBody,
  markdownToHtml,
  notePictures,
  splitIssueBody,
} from "./github-markdown";
import {
  type GithubIssue,
  type GithubIssuePatch,
  createIssue,
  listAssignableLogins,
  listIssueChanges,
  updateIssue,
} from "./github-issues";
import {
  GITHUB_NOTES_FORMAT,
  type GithubBase,
  loginSet,
  mergeSubtasks,
  parseGithubBase,
  sameLogins,
  sameSubtasks,
  settle,
  settleNotes,
} from "./github-merge";
import {
  type GithubLocalAssignee,
  type GithubPeople,
  localAssigneesWithLogins,
  personForLogin,
  readGithubPeople,
  splitLoginsForPush,
} from "./github-people";
import { syncReviewTasks } from "./github-reviews";
import { setTaskAssignees } from "./people-store";
import { randomUUID } from "./uuid";

type Row = Record<string, unknown>;

export type GithubSyncResult = {
  pulled: number;
  pushed: number;
  updated: number;
  /** Issues gone from GitHub: their tasks stay, no longer linked. */
  unlinked: number;
  /** Board people who could not go on an issue: no login, or no access. */
  unpushableAssignees: string[];
  /** Logins on issues that match no board person. */
  unknownLogins: string[];
  /** People matched to a login by name. */
  nameLinkedPeople: string[];
  /** Review tasks made, for pull requests somebody on the board is asked to review. */
  reviewsAdded?: number;
  /** The app may not read pull requests, so no review tasks were made. */
  reviewsNeedPermission?: boolean;
};

/** One side's view of a task, in the terms both sides share. */
type Side = {
  title: string;
  notes: string;
  closed: boolean;
  assignees: string[];
  subtasks: BodySubtask[];
};

/** What one sync of a list reads once and hands to each task. */
type ListSync = {
  listId: string;
  repo: string;
  assignable: Set<string>;
  people: GithubPeople;
  assigneesByTask: Map<string, GithubLocalAssignee[]>;
  subtasksByTask: Map<string, Row[]>;
  counts: { pulled: number; pushed: number; updated: number; unlinked: number };
  unpushable: Set<string>;
};

export async function syncGithubList(listId: string): Promise<GithubSyncResult> {
  const { rows: listRows } = await todoDb().query(
    "SELECT * FROM todo_lists WHERE id = $1",
    [listId]
  );
  const list = listRows[0];
  if (!list || list.deleted_at) throw new PlanError("List not found", 404);
  const repo = list.github_repo as string | null;
  if (!repo) throw new PlanError("List is not linked to GitHub", 400);

  const cursor = (list.github_cursor as string | null) ?? null;
  const changes = await listIssueChanges(
    repo,
    cursor,
    (list.github_etag as string | null) ?? null
  );
  const changed = new Map(changes.issues.map((issue) => [issue.number, issue]));

  // Parents only: a child is a checkbox in its parent's body.
  const { rows: taskRows } = await todoDb().query(
    "SELECT * FROM todo_tasks WHERE list_id = $1 AND parent_task_id IS NULL",
    [listId]
  );
  const taskIds = taskRows.map((row) => row.id as string);
  const sync: ListSync = {
    listId,
    repo,
    assignable: await listAssignableLogins(repo),
    people: await readGithubPeople(repo),
    assigneesByTask: await localAssigneesWithLogins(taskIds),
    subtasksByTask: await readSubtasksByTask(taskIds),
    counts: { pulled: 0, pushed: 0, updated: 0, unlinked: 0 },
    unpushable: new Set(),
  };

  for (const task of taskRows) {
    // A review task names a pull request, which the sync never writes
    // to. Its own pass is below (github-reviews.ts).
    if (task.github_kind === "review") continue;
    if (task.github_number != null) {
      // Linked to an issue of another repository: the list was linked
      // again. That issue is not this list's to change.
      if (task.github_repo !== repo) continue;
      await syncLinkedTask(sync, task, changed.get(Number(task.github_number)) ?? null);
    } else if (task.github_public) {
      await pushNewTask(sync, task);
    }
  }

  const known = await knownIssueNumbers(repo);
  for (const issue of changes.issues) {
    if (issue.state !== "open" || known.has(issue.number)) continue;
    await pullNewIssue(sync, issue);
  }

  await saveCursor(listId, cursor, changes);

  // Review tasks are extra: a failure there (before migration 101, say)
  // must not undo the issue sync above.
  const reviews = await syncReviewTasks({
    listId,
    repo,
    etag: (list.github_pulls_etag as string | null) ?? null,
    people: sync.people,
  }).catch((err) => {
    console.warn("[todo] GitHub review requests could not be synced:", err);
    return { added: 0, updated: 0, needsPermission: false };
  });
  sync.counts.pulled += reviews.added;
  sync.counts.updated += reviews.updated;

  return {
    ...sync.counts,
    reviewsAdded: reviews.added,
    reviewsNeedPermission: reviews.needsPermission,
    unpushableAssignees: [...sync.unpushable].sort(),
    unknownLogins: [...sync.people.unknown].sort(),
    nameLinkedPeople: [...sync.people.nameLinked].sort(),
  };
}

/**
 * Where the next poll starts: the newest change seen. It moves only when
 * something changed, so between changes the poll asks the same URL and
 * the ETag holds.
 */
async function saveCursor(
  listId: string,
  cursor: string | null,
  changes: Awaited<ReturnType<typeof listIssueChanges>>
) {
  let next = cursor;
  for (const issue of changes.issues) {
    if (!next || issue.updated_at > next) next = issue.updated_at;
  }
  if (!next) {
    const date = changes.serverDate ? new Date(changes.serverDate) : new Date();
    next = (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  await todoDb().query(
    "UPDATE todo_lists SET github_cursor = $1, github_etag = $2 WHERE id = $3",
    [next, changes.etag, listId]
  );
}

/** Every issue of this repository the board has, on any list. */
async function knownIssueNumbers(repo: string): Promise<Set<number>> {
  const { rows } = await todoDb().query(
    "SELECT github_number FROM todo_tasks WHERE github_repo = $1 AND github_number IS NOT NULL",
    [repo]
  );
  return new Set(rows.map((row) => Number(row.github_number)));
}

/** Every task's children in one read. An IN list, as SQLite needs. */
async function readSubtasksByTask(taskIds: string[]): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  if (!taskIds.length) return map;
  const { rows } = await todoDb().query(
    `SELECT * FROM todo_tasks
     WHERE parent_task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY position, created_at`,
    taskIds
  );
  for (const row of rows) {
    const key = row.parent_task_id as string;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

function issueSide(issue: GithubIssue): Side {
  const { notes, subtasks } = splitIssueBody(issue.body);
  return {
    title: issue.title,
    notes,
    closed: issue.state === "closed",
    assignees: loginSet((issue.assignees ?? []).map((a) => a.login)),
    subtasks,
  };
}

/** An issue that did not change since the last sync is as the base says. */
function baseSide(base: GithubBase): Side {
  return {
    title: base.title,
    notes: base.body,
    closed: base.closed,
    assignees: base.assignees,
    subtasks: base.subtasks,
  };
}

function localSubtasks(rows: Row[]): BodySubtask[] {
  return rows.map((row) => ({ text: (row.text as string).trim(), done: Boolean(row.completed) }));
}

/**
 * The task's people as GitHub can hold them: the logins that may go on
 * the issue, and the logins on it that are nobody on the board, which
 * the board cannot hold and must not take off.
 */
function localLogins(sync: ListSync, task: Row, base: GithubBase | null): string[] {
  const mine = sync.assigneesByTask.get(task.id as string) ?? [];
  const { logins, blocked } = splitLoginsForPush(mine, sync.assignable);
  for (const name of blocked) sync.unpushable.add(name);
  const strangers = (base?.assignees ?? []).filter((l) => !sync.people.byLogin.has(l));
  return loginSet([...logins, ...strangers]);
}

/** A task linked to an issue: each field settled, then both sides written. */
async function syncLinkedTask(sync: ListSync, task: Row, issue: GithubIssue | null) {
  const base = parseGithubBase(task.github_base);
  // No change on GitHub and no base to stand in for it cannot happen to
  // a task this sync linked; it would be a row written by hand.
  if (!issue && !base) return;
  const remote = issue ? issueSide(issue) : baseSide(base!);
  const children = sync.subtasksByTask.get(task.id as string) ?? [];
  const localIsNewer = issue ? timeMs(task.updated_at) > timeMs(issue.updated_at) : true;

  const title = settle(task.text as string, remote.title, base?.title ?? null, localIsNewer);
  let notes = settleNotes(
    (task.notes_html as string | null) ?? "",
    remote.notes,
    base,
    localIsNewer
  );
  // Drawn by an older converter and not edited here since: draw it again
  // from GitHub's copy, so a fix to the converter reaches notes already in.
  if (base && base.notesFormat !== GITHUB_NOTES_FORMAT && !notes.push && !notes.pull) {
    const localHtml = (task.notes_html as string | null) ?? "";
    notes = {
      html: markdownToHtml(remote.notes) + notePictures(localHtml),
      markdown: remote.notes,
      push: false,
      pull: markdownToHtml(remote.notes) + notePictures(localHtml) !== localHtml,
    };
  }
  const closed = settle(Boolean(task.completed), remote.closed, base?.closed ?? null, localIsNewer);
  const people = settle(
    localLogins(sync, task, base),
    remote.assignees,
    base?.assignees ?? null,
    localIsNewer,
    sameLogins
  );
  const mine = localSubtasks(children);
  const subtasks = mergeSubtasks(mine, remote.subtasks, base?.subtasks ?? null, localIsNewer);

  const patch = issuePatch(remote, { title, notes, closed, people, subtasks });
  if (Object.keys(patch).length) {
    const written = await updateIssue(sync.repo, Number(task.github_number), patch);
    if (!written) {
      await unlinkTask(task.id as string);
      sync.counts.unlinked += 1;
      return;
    }
    sync.counts.pushed += 1;
  }

  const pulled =
    title.pull || notes.pull || closed.pull || !sameSubtasks(subtasks, mine);
  const nextBase: GithubBase = {
    title: title.value,
    body: notes.markdown,
    notesHtml: notes.html,
    closed: closed.value,
    assignees: loginSet(people.value),
    subtasks,
    notesFormat: GITHUB_NOTES_FORMAT,
  };
  // Agreed and on record: most tasks on most polls. Nothing to write.
  const quiet =
    !Object.keys(patch).length && !pulled && !people.pull &&
    task.github_base === JSON.stringify(nextBase);
  if (quiet) return;
  await writeLinkedTask(task, issue, pulled, nextBase);
  if (!sameSubtasks(subtasks, mine)) await applySubtasks(sync, task, children, subtasks);
  if (people.pull) await applyAssignees(sync, task, people.value);
  if (pulled || people.pull) sync.counts.updated += 1;
}

/** What GitHub must be told: the settled fields that differ from its copy. */
function issuePatch(
  remote: Side,
  settled: {
    title: { value: string };
    notes: { markdown: string; push: boolean };
    closed: { value: boolean };
    people: { value: string[] };
    subtasks: BodySubtask[];
  }
): GithubIssuePatch {
  const patch: GithubIssuePatch = {};
  if (settled.title.value !== remote.title) patch.title = settled.title.value;
  // The body is written only for a real change, never to reformat
  // GitHub's own copy of a note into this side's spelling.
  if (settled.notes.push || !sameSubtasks(settled.subtasks, remote.subtasks)) {
    patch.body = joinIssueBody(
      settled.notes.push ? settled.notes.markdown : remote.notes,
      settled.subtasks
    );
  }
  if (settled.closed.value !== remote.closed) {
    patch.state = settled.closed.value ? "closed" : "open";
    patch.state_reason = settled.closed.value ? "completed" : "reopened";
  }
  if (!sameLogins(settled.people.value, remote.assignees)) {
    patch.assignees = loginSet(settled.people.value);
  }
  return patch;
}

/** The settled task and the new base go down together. */
async function writeLinkedTask(
  task: Row,
  issue: GithubIssue | null,
  pulled: boolean,
  base: GithubBase
) {
  await todoDb().query(
    `UPDATE todo_tasks SET text = $1, notes_html = $2, completed = $3,
       completed_at = CASE WHEN $3 AND NOT completed THEN NOW()
                           WHEN NOT $3 THEN NULL
                           ELSE completed_at END,
       github_base = $4,
       updated_at = CASE WHEN $5 THEN $6 ELSE updated_at END
     WHERE id = $7`,
    [
      base.title,
      base.notesHtml || null,
      base.closed,
      JSON.stringify(base),
      pulled,
      issue ? new Date(issue.updated_at).toISOString() : new Date().toISOString(),
      task.id,
    ]
  );
}

/** The issue is gone. The task stays, as a task of this board alone. */
async function unlinkTask(taskId: string) {
  await todoDb().query(
    `UPDATE todo_tasks SET github_repo = NULL, github_number = NULL,
       github_base = NULL, github_public = FALSE
     WHERE id = $1`,
    [taskId]
  );
}

/**
 * The settled subtasks onto the task's children: ticks moved, new ones
 * made, ones taken away on GitHub deleted. Matched by text, as the merge
 * matched them.
 */
async function applySubtasks(
  sync: ListSync,
  task: Row,
  children: Row[],
  settled: BodySubtask[]
) {
  const left = [...children];
  let position = children.reduce((max, row) => Math.max(max, Number(row.position ?? 0)), 0);
  for (const item of settled) {
    const at = left.findIndex((row) => (row.text as string).trim() === item.text);
    if (at >= 0) {
      const row = left.splice(at, 1)[0];
      if (Boolean(row.completed) !== item.done) {
        await todoDb().query(
          `UPDATE todo_tasks SET completed = $1,
             completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
             updated_at = NOW()
           WHERE id = $2`,
          [item.done, row.id]
        );
      }
      continue;
    }
    position += 1;
    await todoDb().query(
      `INSERT INTO todo_tasks
         (id, list_id, parent_task_id, text, completed, completed_at, position)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NOW() ELSE NULL END, $6)`,
      [randomUUID(), sync.listId, task.id, item.text, item.done, position]
    );
  }
  for (const row of left) {
    await todoDb().query("DELETE FROM todo_tasks WHERE id = $1", [row.id]);
  }
}

/**
 * The issue's people onto the task. Board people GitHub cannot hold (no
 * login, or no access to the repository) stay on: GitHub never had them,
 * so it cannot have taken them off.
 */
async function applyAssignees(sync: ListSync, task: Row, logins: string[]) {
  const mine = sync.assigneesByTask.get(task.id as string) ?? [];
  const keep = mine
    .filter((p) => !p.login || !sync.assignable.has(p.login.toLowerCase()))
    .map((p) => p.personId);
  const ids = [...keep];
  for (const login of logins) {
    const id = await personForLogin(sync.people, login);
    if (id) ids.push(id);
  }
  await setTaskAssignees(task.id as string, ids);
}

/** A task ticked "Public on GitHub" and never sent: a new issue. */
async function pushNewTask(sync: ListSync, task: Row) {
  const children = sync.subtasksByTask.get(task.id as string) ?? [];
  const subtasks = localSubtasks(children);
  const logins = localLogins(sync, task, null);
  const notesHtml = (task.notes_html as string | null) ?? "";
  const notes = settleNotes(notesHtml, "", null, true).markdown;
  let issue = await createIssue(sync.repo, {
    title: task.text as string,
    body: joinIssueBody(notes, subtasks),
    assignees: logins,
  });
  if (task.completed) {
    issue =
      (await updateIssue(sync.repo, issue.number, {
        state: "closed",
        state_reason: "completed",
      })) ?? issue;
  }
  // Linked, and the two sides agree by construction: this is what we sent.
  const base: GithubBase = {
    title: task.text as string,
    body: notes,
    notesHtml,
    closed: Boolean(task.completed),
    assignees: loginSet(logins),
    subtasks,
    notesFormat: GITHUB_NOTES_FORMAT,
  };
  await todoDb().query(
    `UPDATE todo_tasks SET github_repo = $1, github_number = $2, github_base = $3
     WHERE id = $4`,
    [sync.repo, issue.number, JSON.stringify(base), task.id]
  );
  sync.counts.pushed += 1;
}

/** An open issue the board does not have yet: pulled in, ticked public. */
async function pullNewIssue(sync: ListSync, issue: GithubIssue) {
  const side = issueSide(issue);
  const notesHtml = settleNotes("", side.notes, null, false).html;
  const taskId = randomUUID();
  const base: GithubBase = {
    title: side.title,
    body: side.notes,
    notesHtml,
    closed: false,
    assignees: side.assignees,
    subtasks: side.subtasks,
    notesFormat: GITHUB_NOTES_FORMAT,
  };
  // The unique index on (github_repo, github_number) turns a race with a
  // sync of another list on the same repository into a no-op.
  const { rows } = await todoDb().query(
    `INSERT INTO todo_tasks
       (id, list_id, text, notes_html, completed, position,
        github_public, github_repo, github_number, github_base, updated_at)
     VALUES ($1, $2, $3, $4, FALSE,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = $2),
             TRUE, $5, $6, $7, $8)
     ON CONFLICT (github_repo, github_number) WHERE github_number IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      taskId,
      sync.listId,
      side.title,
      notesHtml || null,
      sync.repo,
      issue.number,
      JSON.stringify(base),
      new Date(issue.updated_at).toISOString(),
    ]
  );
  if (!rows[0]) return;
  if (side.subtasks.length) await applySubtasks(sync, { id: taskId }, [], side.subtasks);
  if (side.assignees.length) await applyAssignees(sync, { id: taskId }, side.assignees);
  sync.counts.pulled += 1;
}

/**
 * A stamp in milliseconds. Postgres gives a Date. SQLite's datetime('now')
 * gives "YYYY-MM-DD HH:MM:SS" in UTC with no zone, which Date would read
 * as local time.
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
