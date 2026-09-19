/**
 * The seam between the To-Do domain logic and a database.
 *
 * The store used to exist twice: once in TypeScript over Postgres for the
 * planner, once in Rust over SQLite for the standalone app. The two drifted —
 * the same sync bug shipped in both, and a fix on one side reached the other
 * only when somebody remembered to port it. Now there is one store, written
 * against this interface, and only the driver differs per app.
 *
 * The shape mirrors pg's `pool.query`, because the store was written against
 * that. The SQL the store writes is the portable subset both databases run;
 * the SQLite driver translates the few dialect marks (see sqlite-driver.ts).
 */

export type SqlResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
};

export type SqlStatement = {
  sql: string;
  params?: unknown[];
};

export interface TodoDriver {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  /** Run statements inside one transaction, so a failure changes nothing. */
  batch(statements: SqlStatement[]): Promise<void>;
}

let driver: TodoDriver | null = null;

export function setTodoDriver(next: TodoDriver) {
  driver = next;
}

export function todoDb(): TodoDriver {
  if (!driver) {
    throw new Error(
      "No To-Do database driver installed. Server code imports " +
        "server-store (Postgres); the standalone app installs the SQLite " +
        "bridge in standalone-api."
    );
  }
  return driver;
}
