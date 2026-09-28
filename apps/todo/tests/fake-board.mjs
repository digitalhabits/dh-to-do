/**
 * The desktop app's SQLite, in memory, behind the same Tauri bridge.
 *
 * The app's store sends every statement through two commands,
 * `todo_sql_query` and `todo_sql_batch` (lib/todo/sqlite-driver.ts), to
 * Rust, which runs them on SQLite. Here sql.js runs them instead, on the
 * schema from the app's own src-tauri/src/db.rs. So the real store, the
 * real standalone API and the real page all run, and only Rust is left
 * out.
 *
 * `installFakeBoard()` puts the bridge on `window.__TAURI_INTERNALS__`
 * only. The native bridge looks for `window.__TAURI__`, so the page takes
 * itself for a web view with no shell: no Reminders, no focus windows.
 * A walk of those installs `__TAURI__` as well.
 *
 * Every other command is recorded in `commands` and answered with null.
 */

import fs from "node:fs";
import path from "node:path";

import initSqlJs from "sql.js";

// run.mjs defines this: the suite runs from a bundle in a temp directory.
const DB_RS = path.join(process.env.TODO_APP_DIR, "src-tauri/src/db.rs");

/** The migration blocks of db.rs, in the order a fresh install runs them. */
function schemaBlocks() {
  const source = fs.readFileSync(DB_RS, "utf8");
  const blocks = [...source.matchAll(/execute_batch\(\s*r#"([\s\S]*?)"#/g)].map((m) => m[1]);
  if (blocks.length < 10) throw new Error("db.rs migration blocks not found");
  return blocks;
}

export async function installFakeBoard() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.exec("PRAGMA foreign_keys = ON;");
  for (const block of schemaBlocks()) db.exec(block);

  const run = (sql, params = []) => {
    const write = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return { rows, rowCount: write ? db.getRowsModified() : rows.length };
    } finally {
      stmt.free();
    }
  };

  const commands = [];
  const invoke = async (command, args = {}) => {
    if (command === "todo_sql_query") {
      return run(args.statement.sql, args.statement.params ?? []);
    }
    if (command === "todo_sql_batch") {
      db.exec("BEGIN");
      try {
        for (const s of args.statements) run(s.sql, s.params ?? []);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return null;
    }
    commands.push({ command, args });
    return null;
  };
  window.__TAURI_INTERNALS__ = { invoke };

  return {
    commands,
    /** Rows, for a check that reads the board directly. */
    query: (sql, params = []) => run(sql, params).rows,
  };
}
