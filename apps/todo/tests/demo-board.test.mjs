/**
 * The demo app's invented board (src/demo) goes into the app's real schema:
 * every statement runs against the tables db.rs makes, with the foreign
 * keys on, and the board comes out as the video needs it.
 */

import fs from "node:fs";
import path from "node:path";

import { boardStatements } from "../src/demo/seed.ts";
import {
  day,
  demoEvents,
  demoTasks,
  demoTaskTimes,
} from "../src/demo/board.ts";
import { check, report } from "./harness.mjs";

// sql.js is CommonJS, and the suite is built as CommonJS too.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const initSqlJs = require("sql.js");

async function main() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  const rs = fs.readFileSync(
    path.resolve(process.cwd(), "src-tauri/src/db.rs"),
    "utf8",
  );
  for (const m of rs.matchAll(/execute_batch\(\s*r#"([\s\S]*?)"#/g)) {
    try {
      db.exec(m[1]);
    } catch {
      // A migration that only changes rows a fresh file does not have.
    }
  }

  let failed = null;
  for (const s of boardStatements()) {
    try {
      db.run(s.sql, s.params);
    } catch (e) {
      failed = `${e}: ${s.sql.slice(0, 60)}`;
      break;
    }
  }
  check(
    `every statement runs in the real schema${failed ? ` (${failed})` : ""}`,
    failed === null,
  );

  const one = (sql) => db.exec(sql)[0]?.values[0][0];
  const tasks = demoTasks();
  check(
    "the tasks are all there, steps besides",
    one("SELECT count(*) FROM todo_tasks WHERE parent_task_id IS NULL") ===
      tasks.length,
  );
  check(
    "the steps hang under their tasks",
    one("SELECT count(*) FROM todo_tasks WHERE parent_task_id IS NOT NULL") > 0,
  );
  check(
    "a second seed puts the same board back",
    (() => {
      for (const s of boardStatements()) db.run(s.sql, s.params);
      return (
        one("SELECT count(*) FROM todo_tasks WHERE parent_task_id IS NULL") ===
        tasks.length
      );
    })(),
  );
  check(
    "no task before today is open",
    tasks.every((t) => !t.due || t.due >= day(0) || t.done),
  );
  check(
    "the week has open tasks from today on",
    tasks.some((t) => t.due && t.due >= day(0) && !t.done),
  );
  check(
    "some tasks are in the months too",
    tasks.filter((t) => t.calendar).length >= 4,
  );
  check(
    "the week has task blocks and timed events",
    Object.keys(demoTaskTimes(tasks)).length >= 3 &&
      demoEvents().notes.some((e) => e.startMinutes !== null),
  );

  report();
}

void main();
