/**
 * The standalone app's driver: the store's SQL, run against local SQLite
 * through a two-command Tauri bridge (todo_sql_query / todo_sql_batch).
 *
 * The store writes Postgres-shaped SQL. The dialect gap is three marks, and
 * this driver translates all of them:
 *
 *   $1 → ?1                 positional placeholders, same numbering
 *   NOW() → datetime('now') so new rows match the format existing rows carry
 *   ::text casts → removed  Postgres needs them for parameter typing; SQLite
 *                           is untyped and chokes on the syntax
 *
 * Booleans become 0/1 (the schema stores integers) and Dates become ISO
 * strings before they cross the bridge. Anything beyond these — array
 * parameters, data-modifying CTEs — must not appear in shared SQL; the store
 * keeps to the portable subset instead.
 */

import { setTodoDriver, type SqlStatement } from "./db-driver";

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

function invoke(): TauriInvoke {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  const fn = w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke;
  if (!fn) throw new Error("The SQLite driver needs the desktop app.");
  return fn;
}

/** Exported for the bridge test in db.rs, which runs real translated SQL. */
export function toSqlite(sql: string): string {
  return sql
    .replace(/\$(\d+)/g, "?$1")
    .replace(/\bNOW\(\)/g, "datetime('now')")
    .replace(/::\w+(\[\])?/g, "");
}

/** Exported with toSqlite: a test drives the store over real SQLite. */
export function toParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function translate(statement: SqlStatement): SqlStatement {
  return {
    sql: toSqlite(statement.sql),
    params: (statement.params ?? []).map(toParam),
  };
}

export function installSqliteTodoDriver() {
  setTodoDriver({
    async query(sql, params) {
      return (await invoke()("todo_sql_query", {
        statement: translate({ sql, params }),
      })) as { rows: Record<string, unknown>[]; rowCount: number };
    },
    async batch(statements) {
      await invoke()("todo_sql_batch", {
        statements: statements.map(translate),
      });
    },
  });
}
