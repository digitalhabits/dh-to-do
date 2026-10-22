/**
 * Review requests as tasks.
 *
 * An open pull request with a review request for somebody on the board is
 * a task "Review #n: <title>", assigned to the people asked. It goes one
 * way only, from GitHub to the board: nothing here ever writes to a pull
 * request.
 *
 *   - A person who has reviewed comes off the task: GitHub drops them from
 *     the requested reviewers. With nobody left, the task is done.
 *   - Merged or closed, the task is done.
 *   - Ticked done on the board, it stays done, until somebody new is asked
 *     to review (a request made again after changes counts): then it
 *     opens again.
 *   - Drafts and pull requests nobody on the board is asked to review
 *     (Dependabot's, most outside ones) make no task.
 *
 * The task's github_base holds who was asked at the last sync, which is
 * how a new request is told from an old one.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { todoDb } from "./db-driver";
import { type GithubPull, listOpenPulls } from "./github-issues";
import { loginSet } from "./github-merge";
import { type GithubPeople, personForLogin } from "./github-people";
import { setTaskAssignees } from "./people-store";
import { randomUUID } from "./uuid";

type Row = Record<string, unknown>;

/** What a review task's github_base holds. */
type ReviewBase = { kind: "review"; title: string; asked: string[] };

function parseReviewBase(value: unknown): ReviewBase | null {
  if (typeof value !== "string") return null;
  try {
    const base = JSON.parse(value) as Partial<ReviewBase>;
    return base.kind === "review"
      ? { kind: "review", title: String(base.title ?? ""), asked: base.asked ?? [] }
      : null;
  } catch {
    return null;
  }
}

export type ReviewSyncResult = {
  added: number;
  updated: number;
  /** The app may not read pull requests: give it that permission. */
  needsPermission: boolean;
};

function reviewTitle(pull: GithubPull): string {
  return `Review #${pull.number}: ${pull.title}`;
}

function reviewNote(repo: string, pull: GithubPull): string {
  const url = pull.html_url ?? `https://github.com/${repo}/pull/${pull.number}`;
  const by = pull.user?.login ? ` by @${pull.user.login}` : "";
  return `<div><a href="${url}">Pull request #${pull.number}</a>${by}</div>`;
}

/** The board people asked to review this pull request. */
async function askedPeople(people: GithubPeople, pull: GithubPull) {
  const logins = loginSet((pull.requested_reviewers ?? []).map((r) => r.login));
  const ids: string[] = [];
  const onBoard: string[] = [];
  for (const login of logins) {
    const id = await personForLogin(people, login);
    if (id) {
      ids.push(id);
      onBoard.push(login);
    }
  }
  return { ids, logins: onBoard };
}

export async function syncReviewTasks(input: {
  listId: string;
  repo: string;
  etag: string | null;
  people: GithubPeople;
}): Promise<ReviewSyncResult> {
  const result: ReviewSyncResult = { added: 0, updated: 0, needsPermission: false };
  const changes = await listOpenPulls(input.repo, input.etag);
  if (changes.forbidden) return { ...result, needsPermission: true };
  if (changes.notModified) return result;

  const { rows } = await todoDb().query(
    `SELECT * FROM todo_tasks
     WHERE github_repo = $1 AND github_kind = 'review' AND parent_task_id IS NULL`,
    [input.repo]
  );
  const existing = new Map(rows.map((row) => [Number(row.github_number), row]));
  const open = new Set<number>();

  for (const pull of changes.pulls) {
    open.add(pull.number);
    const task = existing.get(pull.number);
    if (pull.draft && !task) continue;
    const asked = await askedPeople(input.people, pull);
    if (!task) {
      if (asked.ids.length) {
        await addReviewTask(input, pull, asked);
        result.added += 1;
      }
      continue;
    }
    if (await settleReviewTask(task, pull, asked)) result.updated += 1;
  }

  // Merged or closed: no longer in the open list.
  for (const [number, task] of existing) {
    if (open.has(number) || task.completed) continue;
    await setDone(task.id as string, true);
    result.updated += 1;
  }

  await todoDb().query("UPDATE todo_lists SET github_pulls_etag = $1 WHERE id = $2", [
    changes.etag,
    input.listId,
  ]);
  return result;
}

async function addReviewTask(
  input: { listId: string; repo: string },
  pull: GithubPull,
  asked: { ids: string[]; logins: string[] }
) {
  const taskId = randomUUID();
  const base: ReviewBase = { kind: "review", title: pull.title, asked: asked.logins };
  const { rows } = await todoDb().query(
    `INSERT INTO todo_tasks
       (id, list_id, text, notes_html, completed, position,
        github_public, github_repo, github_number, github_kind, github_base)
     VALUES ($1, $2, $3, $4, FALSE,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_tasks WHERE list_id = $2),
             FALSE, $5, $6, 'review', $7)
     ON CONFLICT (github_repo, github_number) WHERE github_number IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      taskId,
      input.listId,
      reviewTitle(pull),
      reviewNote(input.repo, pull),
      input.repo,
      pull.number,
      JSON.stringify(base),
    ]
  );
  if (rows[0]) await setTaskAssignees(taskId, asked.ids);
}

/**
 * A review task that is there already: its title, its people, and whether
 * it is done, from who is asked now and who was asked at the last sync.
 * Answers whether anything changed.
 */
async function settleReviewTask(
  task: Row,
  pull: GithubPull,
  asked: { ids: string[]; logins: string[] }
): Promise<boolean> {
  const base = parseReviewBase(task.github_base) ?? { kind: "review", title: "", asked: [] };
  const newlyAsked = asked.logins.some((login) => !base.asked.includes(login));
  const done = Boolean(task.completed);
  // Nobody on the board left to review: done. Somebody new asked: open
  // again, even if it was ticked on the board. Else as the board has it.
  const nextDone = asked.ids.length === 0 ? true : newlyAsked ? false : done;
  const titleChanged = pull.title !== base.title;
  const askedChanged = asked.logins.join(",") !== base.asked.join(",");
  if (!titleChanged && !askedChanged && nextDone === done) return false;

  const nextBase: ReviewBase = { kind: "review", title: pull.title, asked: asked.logins };
  await todoDb().query(
    `UPDATE todo_tasks SET
       text = CASE WHEN $1 THEN $2 ELSE text END,
       github_base = $3,
       updated_at = NOW()
     WHERE id = $4`,
    [titleChanged, reviewTitle(pull), JSON.stringify(nextBase), task.id]
  );
  if (nextDone !== done) await setDone(task.id as string, nextDone);
  // Somebody who reviewed comes off; a reviewer asked later comes on.
  if (askedChanged && asked.ids.length) await setTaskAssignees(task.id as string, asked.ids);
  return true;
}

async function setDone(taskId: string, done: boolean) {
  await todoDb().query(
    `UPDATE todo_tasks SET completed = $1,
       completed_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
       updated_at = NOW()
     WHERE id = $2`,
    [done, taskId]
  );
}
