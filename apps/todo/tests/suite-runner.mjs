/**
 * Bundle each walk suite against the real source and run it as plain Node.
 *
 * The part of the test runner that does not depend on which app shows the
 * page. run.mjs gives it the desktop app's aliases and host. The planner
 * runs its own walks of its To-Do tab with this file too, from its own
 * folder, with its own paths and host.
 *
 * A suite named `mounted-` renders the real page against happy-dom (see
 * mounted-dom.mjs), so React rides inside its bundle. The suites run side by
 * side, one per core less one (TEST_JOBS sets another number). Each runs in
 * its own process with its own fakes, and none opens a port.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/todo: its node_modules hold the suites' externals. */
export const appDir = path.resolve(here, "..");

/**
 * Run every `*.test.mjs` in `dir` whose name starts with one of `only`
 * (all of them when `only` is empty), and exit with 1 if one fails.
 *
 * `flavour` is what differs per app: `name` ("standalone" or "planner"),
 * and the esbuild `plugins`, `alias`, `define` and `inject` for its build.
 */
export async function runSuites({ dir, only = [], flavour }) {
  const suites = fs
    .readdirSync(dir)
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
    await esbuild.build({
      entryPoints: [path.join(dir, suite)],
      // To-Do's host for this flavour, installed before the suite runs, as
      // each app installs it at start (lib/todo/host.ts).
      inject: flavour.inject ?? [],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      logLevel: "error",
      plugins: flavour.plugins ?? [],
      alias: {
        ...(flavour.alias ?? {}),
        // A toast is not what any of these is checking.
        sonner: path.join(here, "shims/sonner.mjs"),
      },
      define: {
        ...(flavour.define ?? {}),
        "process.env.NEXT_PUBLIC_TODO_PRODUCT_FLAVOR": JSON.stringify(flavour.name),
        "process.env.VITE_TODO_PRODUCT_FLAVOR": JSON.stringify(flavour.name),
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
}
