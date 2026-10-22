/**
 * The board's people and GitHub's logins, matched: who a task's assignees
 * are on each side, and who can go on an issue.
 *
 * A board person is on GitHub when their row has a login. The login is
 * written in the person's settings, or found once by name: an issue
 * assignee whose GitHub name is the name of exactly one board person
 * without a login. Nobody is added to the board for a login: GitHub
 * people are often not the team, and a person made from a login could
 * not be told apart from the real one later.
 *
 * Part of github.ts, which re-exports what the rest of the app uses.
 */

import { todoDb } from "./db-driver";
import { getUserName } from "./github-issues";
import { personNameKey } from "./people";

type Row = Record<string, unknown>;

/** One board assignee of a task, with their login if they have one. */
export type GithubLocalAssignee = {
  personId: string;
  name: string;
  login: string | null;
};

export async function localAssigneesWithLogins(
  taskIds: string[]
): Promise<Map<string, GithubLocalAssignee[]>> {
  const map = new Map<string, GithubLocalAssignee[]>();
  if (!taskIds.length) return map;
  // A placeholder per id, not ANY(): the same SQL runs on SQLite.
  const { rows } = await todoDb().query(
    `SELECT a.task_id, a.person_id, p.name, p.github_login
     FROM todo_task_assignees a
     JOIN todo_people p ON p.id = a.person_id
     WHERE a.task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY a.position, a.created_at`,
    taskIds
  );
  for (const row of rows) {
    const entry: GithubLocalAssignee = {
      personId: row.person_id as string,
      name: row.name as string,
      login: (row.github_login as string | null) ?? null,
    };
    const list = map.get(row.task_id as string);
    if (list) list.push(entry);
    else map.set(row.task_id as string, [entry]);
  }
  return map;
}

/**
 * Per-sync state for logins: the board's people read once, and what the
 * sync has to tell the reader.
 */
export type GithubPeople = {
  repo: string;
  /** Lower-cased login → board person id. */
  byLogin: Map<string, string>;
  /** Board people with no login yet, for the one-time match by name. */
  unlinked: Row[];
  /** Logins tried by name already in this sync, found or not. */
  tried: Set<string>;
  nameLinked: Set<string>;
  /** Logins on issues that match no board person. */
  unknown: Set<string>;
};

export async function readGithubPeople(repo: string): Promise<GithubPeople> {
  const { rows } = await todoDb().query(
    "SELECT id, name, github_login FROM todo_people ORDER BY position, created_at"
  );
  const byLogin = new Map<string, string>();
  const unlinked: Row[] = [];
  for (const row of rows) {
    const login = row.github_login as string | null;
    if (login) byLogin.set(login.toLowerCase(), row.id as string);
    else unlinked.push(row);
  }
  return {
    repo,
    byLogin,
    unlinked,
    tried: new Set(),
    nameLinked: new Set(),
    unknown: new Set(),
  };
}

/**
 * The board person for a login, if there is one. A login seen for the
 * first time is matched by name once, and the match is written to the row,
 * so it is a fact from then on. The caller reports the name match.
 */
export async function personForLogin(
  people: GithubPeople,
  login: string
): Promise<string | null> {
  const key = login.toLowerCase();
  const known = people.byLogin.get(key);
  if (known) return known;
  if (people.tried.has(key)) return null;
  people.tried.add(key);
  const name = await getUserName(people.repo, login);
  const nameKey = name ? personNameKey(name) : "";
  const hits = nameKey
    ? people.unlinked.filter((row) => personNameKey(row.name as string) === nameKey)
    : [];
  // Two board people with this name: a guess could give one person's
  // work to the other, so it is left for a person to set.
  if (hits.length !== 1) {
    people.unknown.add(login);
    return null;
  }
  const row = hits[0];
  await todoDb().query(
    "UPDATE todo_people SET github_login = $1, updated_at = NOW() WHERE id = $2 AND github_login IS NULL",
    [key, row.id]
  );
  people.byLogin.set(key, row.id as string);
  people.unlinked = people.unlinked.filter((r) => r !== row);
  people.nameLinked.add(row.name as string);
  return row.id as string;
}

/**
 * A task's board assignees as GitHub sees them: the logins that may go on
 * an issue in this repository, and the names of those who cannot.
 */
export function splitLoginsForPush(
  assignees: GithubLocalAssignee[],
  assignable: Set<string>
): { logins: string[]; blocked: string[] } {
  const logins: string[] = [];
  const blocked: string[] = [];
  for (const person of assignees) {
    if (person.login && assignable.has(person.login.toLowerCase())) {
      logins.push(person.login.toLowerCase());
    } else {
      blocked.push(person.name);
    }
  }
  return { logins, blocked };
}
