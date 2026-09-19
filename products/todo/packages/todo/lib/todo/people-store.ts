/**
 * Server-side board roster identity: who a person is, and which task they are
 * on. Keep it out of `people.ts` — that one is client-safe.
 *
 * It also lives apart from `store.ts`, because the Basecamp sync adds people
 * of its own and `store.ts` already imports the Basecamp client. Either of
 * those files would make an import cycle.
 */
import { PlanError } from "@/lib/plan/errors";

import { todoDb } from "./db-driver";

import { personNameKey } from "./people";

import type { TodoPerson } from "./types";

type Row = Record<string, unknown>;

const PERSON_SOURCE_KINDS = ["team", "crm", "manual", "basecamp"] as const;

export function isTodoPersonSourceKind(
  value: unknown
): value is NonNullable<TodoPerson["sourceKind"]> {
  return PERSON_SOURCE_KINDS.includes(
    value as (typeof PERSON_SOURCE_KINDS)[number]
  );
}

export function rowToPerson(row: Row): TodoPerson {
  const kind = row.source_kind as string | null;
  return {
    id: row.id as string,
    name: row.name as string,
    colour: (row.colour as string | null) ?? null,
    photoUrl: (row.photo_url as string | null) ?? null,
    sourceKind: PERSON_SOURCE_KINDS.includes(
      kind as (typeof PERSON_SOURCE_KINDS)[number]
    )
      ? (kind as TodoPerson["sourceKind"])
      : null,
    sourceId: (row.source_id as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    basecampPersonId: (row.basecamp_person_id as string | null) ?? null,
    position: Number(row.position),
  };
}

export function normalizePersonEmail(
  value: string | null | undefined
): string | null {
  const email = value?.trim().toLowerCase();
  return email ? email : null;
}


/**
 * Replace a task's assignees and stamp the change.
 *
 * One transaction, so a failure cannot leave the task half-assigned. It was
 * one Postgres statement once — a data-modifying CTE — but SQLite cannot put
 * DML inside a CTE, and both databases run this code now. A transaction keeps
 * the guarantee and the batch keeps it to one round trip on the pool.
 *
 * The delete and the upsert must not touch the same row: the delete takes
 * only the people who are leaving, and the insert upserts the ones who stay,
 * so nobody's row is dropped and re-made across the primary key.
 *
 * Pass `stampedAt` when adopting a remote change, so the stamp matches the
 * Basecamp `updated_at` we pulled rather than the time we wrote the row.
 */
export async function setTaskAssignees(
  taskId: string,
  assigneeIds: string[],
  stampedAt?: Date
): Promise<string[]> {
  const unique = [...new Set(assigneeIds.filter(Boolean))];
  const stamp = (stampedAt ?? new Date()).toISOString();
  const statements = [
    unique.length
      ? {
          sql: `DELETE FROM todo_task_assignees
                WHERE task_id = $1
                  AND person_id NOT IN (${unique.map((_, i) => `$${i + 2}`).join(", ")})`,
          params: [taskId, ...unique],
        }
      : {
          sql: "DELETE FROM todo_task_assignees WHERE task_id = $1",
          params: [taskId],
        },
    {
      sql: "UPDATE todo_tasks SET assignees_updated_at = $2 WHERE id = $1",
      params: [taskId, stamp],
    },
    ...unique.map((personId, index) => ({
      sql: `INSERT INTO todo_task_assignees (task_id, person_id, position)
            VALUES ($1, $2, $3)
            ON CONFLICT (task_id, person_id)
            DO UPDATE SET position = EXCLUDED.position`,
      params: [taskId, personId, index],
    })),
  ];
  await todoDb().batch(statements);
  return unique;
}

export type TodoPersonKeys = {
  basecampPersonId?: string | null;
  email?: string | null;
  sourceKind?: TodoPerson["sourceKind"];
  sourceId?: string | null;
};

export type FindTodoPersonResult = {
  row: Row | null;
  matchedByName: boolean;
  /** Several board people share the name; nothing was matched. */
  ambiguousName: boolean;
};

/**
 * Find the row that already stands for this human, strongest key first:
 * Basecamp id, then email, then where the row came from, then name.
 *
 * Only the first match of a given person has to work. After that the Basecamp
 * id is written to the row and every later sync matches on that, so name and
 * email are just ways to make the introduction.
 *
 * `matchName` is the last resort and never re-points a row that already has a
 * Basecamp link. Callers must report when it fires — a name match is a guess,
 * not a fact.
 */
export async function findTodoPerson(
  keys: TodoPersonKeys,
  matchName?: string | null
): Promise<FindTodoPersonResult | null> {
  if (keys.basecampPersonId) {
    const { rows } = await todoDb().query(
      "SELECT * FROM todo_people WHERE basecamp_person_id = $1 LIMIT 1",
      [keys.basecampPersonId]
    );
    if (rows[0])
      return { row: rows[0], matchedByName: false, ambiguousName: false };
  }
  if (keys.email) {
    const { rows } = await todoDb().query(
      "SELECT * FROM todo_people WHERE lower(email) = $1 LIMIT 1",
      [keys.email]
    );
    if (rows[0])
      return { row: rows[0], matchedByName: false, ambiguousName: false };
  }
  if (keys.sourceKind && keys.sourceId) {
    const { rows } = await todoDb().query(
      `SELECT * FROM todo_people
       WHERE source_kind = $1 AND source_id = $2
       LIMIT 1`,
      [keys.sourceKind, keys.sourceId]
    );
    if (rows[0])
      return { row: rows[0], matchedByName: false, ambiguousName: false };
  }
  const nameKey = matchName ? personNameKey(matchName) : "";
  if (nameKey) {
    /**
     * Which rows a name may match depends on whether we got an email at all.
     *
     * Basecamp redacts `email_address` unless the connected login is an admin
     * or an owner, so plenty of teams will never see one. With no email to
     * compare, name is the only signal there is, and every row without a
     * Basecamp link stays in scope.
     *
     * With an email in hand, a row carrying a *different* email is positive
     * proof of a different person, so only rows with no email of their own
     * remain candidates.
     *
     * Either way a row already tied to a Basecamp person is never re-pointed.
     */
    const { rows } = keys.email
      ? await todoDb().query(
          `SELECT * FROM todo_people
           WHERE email IS NULL AND basecamp_person_id IS NULL
           ORDER BY position, created_at`
        )
      : await todoDb().query(
          `SELECT * FROM todo_people
           WHERE basecamp_person_id IS NULL
           ORDER BY position, created_at`
        );
    const hits = rows.filter(
      (row) => personNameKey(row.name as string) === nameKey
    );
    if (hits.length === 1) {
      return { row: hits[0], matchedByName: true, ambiguousName: false };
    }
    // Two board people share this name. Guessing would put someone else's
    // work on the wrong person, so leave it for a human to settle.
    if (hits.length > 1) {
      return { row: null, matchedByName: false, ambiguousName: true };
    }
  }
  return null;
}

export type UpsertTodoPersonInput = {
  name: string;
  colour?: string | null;
  photoUrl?: string | null;
  sourceKind?: TodoPerson["sourceKind"];
  sourceId?: string | null;
  email?: string | null;
  basecampPersonId?: string | null;
  /** Allow a last-resort name match against unidentified rows. */
  matchByName?: boolean;
};

export type UpsertTodoPersonResult = {
  person: TodoPerson;
  created: boolean;
  matchedByName: boolean;
  /** Added as a new person because the name matched more than one row. */
  ambiguousName: boolean;
};

/** Add the person, or fill in what an existing row is missing. */
export async function upsertTodoPerson(
  id: string,
  input: UpsertTodoPersonInput
): Promise<UpsertTodoPersonResult> {
  const name = input.name.trim();
  if (!name) throw new PlanError("Name required", 400);
  const email = normalizePersonEmail(input.email);
  const sourceKind = input.sourceKind ?? null;
  const sourceId = input.sourceId ?? null;

  const found = await findTodoPerson(
    {
      basecampPersonId: input.basecampPersonId,
      email,
      sourceKind,
      sourceId,
    },
    input.matchByName ? name : null
  );

  if (found?.row) {
    // Fill blanks only. Adding someone from CRM who first arrived through
    // Basecamp upgrades that row rather than making a second one, and a
    // Basecamp pull never downgrades a row that came from CRM or the Team.
    const { rows } = await todoDb().query(
      `UPDATE todo_people SET
         email = COALESCE(email, $2),
         basecamp_person_id = COALESCE(basecamp_person_id, $3),
         photo_url = COALESCE(photo_url, $4),
         source_kind = CASE
           WHEN $5::text IS NOT NULL
            AND COALESCE(source_kind, 'manual') IN ('manual', 'basecamp')
           THEN $5 ELSE source_kind END,
         source_id = CASE
           WHEN $5::text IS NOT NULL
            AND COALESCE(source_kind, 'manual') IN ('manual', 'basecamp')
           THEN $6 ELSE source_id END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        found.row.id as string,
        email,
        input.basecampPersonId ?? null,
        input.photoUrl ?? null,
        sourceKind === "manual" ? null : sourceKind,
        sourceId,
      ]
    );
    return {
      person: rowToPerson(rows[0]),
      created: false,
      matchedByName: found.matchedByName,
      ambiguousName: false,
    };
  }

  const { rows } = await todoDb().query(
    `INSERT INTO todo_people
       (id, name, colour, photo_url, source_kind, source_id,
        email, basecamp_person_id, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             (SELECT COALESCE(MAX(position), 0) + 1 FROM todo_people))
     RETURNING *`,
    [
      id,
      name,
      input.colour ?? null,
      input.photoUrl ?? null,
      sourceKind ?? "manual",
      sourceId,
      email,
      input.basecampPersonId ?? null,
    ]
  );
  return {
    person: rowToPerson(rows[0]),
    created: true,
    matchedByName: false,
    ambiguousName: Boolean(found?.ambiguousName),
  };
}
