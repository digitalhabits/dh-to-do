/**
 * Run every suite in this directory.
 *
 * The To-Do twin of apps/mail/tests/run.mjs. Each `*.test.mjs` is bundled
 * against the real source and run as plain Node. A suite named `mounted-`
 * renders the real page against happy-dom (see mounted-dom.mjs), so React
 * rides inside its bundle.
 *
 * Two flavours of the page, because two hosts ship it:
 *
 * - The desktop app (the default). The import aliases and the `define`
 *   values are read from ../vite.config.ts with Vite's own loader, so a
 *   suite is built the way the app is built, from one list.
 * - The planner's To-Do tab, for a suite with `-planner` in its name. The
 *   aliases are the planner's (tsconfig.json at the monorepo root), so the
 *   planner's own offline hook and page cache run. Those files are not in
 *   the public mirror, and the export leaves these suites out.
 *
 *   pnpm --dir apps/todo test          all suites
 *   pnpm --dir apps/todo test mounted  the ones whose names start so
 *
 * The suites run side by side, one per core less one (TEST_JOBS sets
 * another number). Each runs in its own process with its own fakes, and
 * none opens a port.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";
import { loadConfigFromFile } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const root = path.resolve(appDir, "../..");

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

/** The app's `define` values, with the ones only the build needs. */
function appDefines() {
  return { ...(appConfig.define ?? {}) };
}

/**
 * The planner's `@/…` paths: each root in turn, as tsconfig.json lists
 * them. esbuild's alias takes one target per name, so this is a resolver.
 */
const PLANNER_ROOTS = [
  root,
  path.join(root, "packages/shared"),
  path.join(root, "products/mail/packages/mail"),
  path.join(root, "packages/mail-crm"),
  path.join(root, "products/todo/packages/todo"),
];
const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

function plannerPaths() {
  return {
    name: "planner-paths",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const rest = args.path.slice(2);
        for (const base of PLANNER_ROOTS) {
          for (const ext of EXTENSIONS) {
            const file = path.join(base, rest + ext);
            if (fs.existsSync(file) && fs.statSync(file).isFile()) return { path: file };
          }
        }
        return undefined;
      });
    },
  };
}

const only = process.argv.slice(2);
const suites = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !only.length || only.some((n) => f.startsWith(n)))
  .sort();

if (!suites.length) {
  console.error(only.length ? `No suite matches ${only.join(", ")}` : "No suites found");
  process.exit(1);
}

const out = fs.mkdtempSync(path.join(os.tmpdir(), "dh-todo-tests-"));
const jobs = Math.max(1, Number(process.env.TEST_JOBS) || os.availableParallelism() - 1);

async function runSuite(suite) {
  const bundle = path.join(out, suite.replace(".mjs", ".cjs"));
  const mounted = suite.startsWith("mounted-");
  const planner = suite.includes("-planner");
  const flavor = planner ? "planner" : "standalone";
  await esbuild.build({
    entryPoints: [path.join(here, suite)],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "error",
    plugins: planner ? [plannerPaths()] : [],
    alias: {
      ...(planner
        ? { "next/dynamic": path.join(appDir, "src/seams/next-dynamic.tsx") }
        : appAliases()),
      // A toast is not what any of these is checking.
      sonner: path.join(here, "shims/sonner.mjs"),
    },
    define: {
      ...(planner ? {} : appDefines()),
      "process.env.NEXT_PUBLIC_TODO_PRODUCT_FLAVOR": JSON.stringify(flavor),
      "process.env.VITE_TODO_PRODUCT_FLAVOR": JSON.stringify(flavor),
      // Where the app is. A bundle is CommonJS in a temp directory, where
      // import.meta.url is empty; fake-board.mjs reads db.rs from here.
      "process.env.TODO_APP_DIR": JSON.stringify(appDir),
      // React's CJS entry branches on this at require time.
      ...(mounted ? { "process.env.NODE_ENV": '"production"' } : {}),
    },
    // sql.js finds its .wasm beside its own file, so it is loaded from
    // node_modules, not from the bundle. pg must never enter this graph.
    external: mounted ? ["sql.js", "pg"] : ["react", "react-dom", "sql.js", "pg"],
    jsx: "automatic",
    // Vite's list, which has .mjs: lucide-react ships
    // `dynamicIconImports.mjs` alone, with no exports map to name it.
    resolveExtensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    loader: Object.fromEntries(
      [".svg", ".css", ".png", ".gif", ".webp", ".jpg", ".woff", ".woff2", ".mp3"].map(
        (ext) => [ext, "empty"]
      )
    ),
  });

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bundle], {
      stdio: ["ignore", "pipe", "pipe"],
      // The bundle sits in a temp directory; this is where its externals are.
      env: { ...process.env, NODE_PATH: path.join(appDir, "node_modules") },
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    child.on("close", (code) =>
      resolve({ ok: code === 0, output: Buffer.concat(chunks).toString("utf8") })
    );
  });
}

/*
  A few workers take the next suite from the list until it is empty. The
  results are printed in name order as soon as every suite before them has
  finished, so the output does not interleave.
*/
const results = new Array(suites.length);
let printed = 0;
let failed = 0;
const printReady = () => {
  while (printed < suites.length && results[printed]) {
    const { ok, output } = results[printed];
    console.log(`\n── ${suites[printed].replace(".test.mjs", "")}`);
    if (output) process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
    if (!ok) failed += 1;
    printed += 1;
  }
};
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(jobs, suites.length) }, async () => {
    while (next < suites.length) {
      const i = next++;
      try {
        results[i] = await runSuite(suites[i]);
      } catch (err) {
        results[i] = { ok: false, output: `the suite could not be built or run: ${err?.stack || err}` };
      }
      printReady();
    }
  })
);

fs.rmSync(out, { recursive: true, force: true });
if (failed) {
  console.error(`\n${failed} of ${suites.length} suites failed`);
  process.exit(1);
}
console.log(`\n${suites.length} suites passed`);
