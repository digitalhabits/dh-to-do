#!/usr/bin/env node
/**
 * Copy the Calendar tab assets into the standalone To-Do app.
 *
 * The To-Do Planner View mounts the same plan.js that the planner's
 * Calendar tab serves from public/redd-do-calendar. The standalone app
 * serves its own public directory, so the files are copied there at dev
 * and build time. Copied rather than committed: a second checked-in copy
 * goes stale against the planner's without anybody noticing.
 */
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "redd-do-calendar");
const target = join(root, "apps", "todo", "public", "redd-do-calendar");

mkdirSync(target, { recursive: true });
const files = readdirSync(source);
for (const file of files) {
  copyFileSync(join(source, file), join(target, file));
}

console.log(`[todo-calendar] copied ${files.length} files to apps/todo/public`);
