/**
 * The board's people and Basecamp's, matched: who a task's assignees are
 * on each side, and who can go up.
 *
 * Part of basecamp.ts, which re-exports what the rest of the app uses.
 */

import { type BasecampPerson } from "./basecamp-todos";
import { todoDb } from "./db-driver";
import { upsertTodoPerson } from "./people-store";
import { randomUUID } from "./uuid";

/** Board assignees of a task, in board order. */
export type LocalAssignee = {
  personId: string;
  name: string;
  basecampPersonId: string | null;
};

export async function localAssigneesByTask(
  taskIds: string[]
): Promise<Map<string, LocalAssignee[]>> {
  const map = new Map<string, LocalAssignee[]>();
  if (!taskIds.length) return map;
  // A placeholder per id, not `= ANY($1::text[])`: the push runs on SQLite
  // too now, where the sync already did, and SQLite has no ANY.
  const { rows } = await todoDb().query(
    `SELECT a.task_id, a.person_id, p.name, p.basecamp_person_id
     FROM todo_task_assignees a
     JOIN todo_people p ON p.id = a.person_id
     WHERE a.task_id IN (${taskIds.map((_, i) => `$${i + 1}`).join(", ")})
     ORDER BY a.position, a.created_at`,
    taskIds
  );
  for (const row of rows) {
    const taskId = row.task_id as string;
    const entry: LocalAssignee = {
      personId: row.person_id as string,
      name: row.name as string,
      basecampPersonId: (row.basecamp_person_id as string | null) ?? null,
    };
    const list = map.get(taskId);
    if (list) list.push(entry);
    else map.set(taskId, [entry]);
  }
  return map;
}

/**
 * Split board assignees into the ones Basecamp will accept and the ones it
 * will not. Basecamp only takes ids of people on the project, so anyone else
 * has to be reported — dropping them without a word looks like data loss.
 */
export function splitAssigneesForPush(
  assignees: LocalAssignee[],
  projectPersonIds: Set<string>
): { ids: number[]; blocked: string[] } {
  const ids: number[] = [];
  const blocked: string[] = [];
  for (const assignee of assignees) {
    if (
      assignee.basecampPersonId &&
      projectPersonIds.has(assignee.basecampPersonId)
    ) {
      ids.push(Number(assignee.basecampPersonId));
    } else {
      blocked.push(assignee.name);
    }
  }
  return { ids, blocked };
}

/**
 * Per-sync state for turning Basecamp people into board people.
 *
 * The cache matters: a list hits the same two or three people across dozens of
 * to-dos, and each uncached lookup costs several queries on a pool that holds
 * very few connections. Without it one sync starves every other request.
 */
export type AssigneeResolver = {
  /** Basecamp person id → board person id. */
  cache: Map<string, string>;
  nameLinked: Set<string>;
  ambiguous: Set<string>;
};

export function newAssigneeResolver(): AssigneeResolver {
  return { cache: new Map(), nameLinked: new Set(), ambiguous: new Set() };
}

/**
 * Board people for a Basecamp to-do's assignees, adding anyone the board does
 * not have yet so a pulled assignment is never dropped on the floor.
 */
export async function boardPeopleForAssignees(
  assignees: BasecampPerson[],
  resolver: AssigneeResolver
): Promise<string[]> {
  const ids: string[] = [];
  for (const person of assignees) {
    const basecampPersonId = String(person.id);
    const cached = resolver.cache.get(basecampPersonId);
    if (cached) {
      ids.push(cached);
      continue;
    }
    const name =
      person.name?.trim() || person.email_address?.trim() || `Basecamp ${person.id}`;
    const result = await upsertTodoPerson(randomUUID(), {
      name,
      photoUrl: person.avatar_url ?? null,
      email: person.email_address ?? null,
      basecampPersonId,
      sourceKind: "basecamp",
      sourceId: basecampPersonId,
      // Rows added before emails were recorded have nothing else to match on.
      matchByName: true,
    });
    if (result.matchedByName) resolver.nameLinked.add(result.person.name);
    if (result.ambiguousName) resolver.ambiguous.add(result.person.name);
    resolver.cache.set(basecampPersonId, result.person.id);
    ids.push(result.person.id);
  }
  return ids;
}

export function sameIdSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}
