#!/usr/bin/env node
/**
 * Put Trix where the browser can fetch it, and keep it out of the bundler.
 *
 * Trix in the module graph stops `next build`: the compile succeeds, then
 * "Collecting page data" spins one core at 100% and never finishes, and
 * Amplify fails at its thirty-minute cap. Measured by bisect — the build
 * completes the moment nothing imports it, and hangs again with any one
 * import back. Neither the minified nor the plain dist file, neither
 * `transpilePackages` nor a server-side external, made any difference.
 *
 * So the editor is loaded at runtime from a plain script tag instead —
 * which is how Trix is meant to be used outside a bundler anyway. This
 * copies the file both apps serve it from.
 *
 * Copied rather than committed: a checked-in copy goes stale against
 * package.json without anybody noticing. This reads whatever version is
 * installed, so the file and the lockfile can never disagree.
 */
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What the browser loads, and the map it then asks for.
 *
 * The file ends in a `sourceMappingURL`, so a browser with its dev tools
 * open fetches the map straight after — and a missing one is a 404 in the
 * console of anybody debugging something else. Its CSS still goes through
 * the bundler.
 */
const SOURCES = [
  require.resolve("trix/dist/trix.esm.min.js"),
  require.resolve("trix/dist/trix.esm.min.js.map"),
];

/** Every public directory that serves `/vendor/trix.esm.min.js`. */
const TARGETS = [
  join(root, "public", "vendor"),
  join(root, "apps", "todo", "public", "vendor"),
];

for (const dir of TARGETS) {
  mkdirSync(dir, { recursive: true });
  for (const source of SOURCES) {
    // `basename`, not a split on "/": on Windows the path has backslashes,
    // and the whole path came back as the file name.
    copyFileSync(source, join(dir, basename(source)));
  }
}

console.log(
  `[trix] copied ${require("trix/package.json").version} to ${TARGETS.length} public directories`
);
