/**
 * Run every suite in this directory, on the desktop app's page.
 *
 * The To-Do twin of apps/mail/tests/run.mjs. The import aliases and the
 * `define` values are read from ../vite.config.ts with Vite's own loader, so
 * a suite is built the way the app is built, from one list. The desktop host
 * (src/standalone-host.ts) is installed before each suite, as main.tsx
 * installs it. The bundling and running are in suite-runner.mjs.
 *
 *   pnpm --dir apps/todo test          all suites
 *   pnpm --dir apps/todo test mounted  the ones whose names start so
 *
 * The planner runs the same walks on its To-Do tab with suite-runner.mjs
 * from its own folder.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigFromFile } from "vite";

import { appDir, runSuites } from "./suite-runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const loaded = await loadConfigFromFile(
  { command: "build", mode: "production" },
  path.join(appDir, "vite.config.ts"),
  appDir,
  "silent"
);
if (!loaded) throw new Error("vite.config.ts could not be read");
const appConfig = loaded.config;

/** The app's aliases, in the form esbuild takes. */
function appAliases() {
  const list = appConfig.resolve?.alias ?? [];
  const entries = Array.isArray(list)
    ? list.map(({ find, replacement }) => [String(find), replacement])
    : Object.entries(list);
  return Object.fromEntries(entries);
}

await runSuites({
  dir: here,
  only: process.argv.slice(2),
  flavour: {
    name: "standalone",
    alias: appAliases(),
    define: { ...(appConfig.define ?? {}) },
    inject: [path.join(appDir, "src/standalone-host.ts")],
  },
});
