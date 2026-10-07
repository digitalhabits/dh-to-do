#!/usr/bin/env node
/**
 * Print latest.json, the manifest the Linux updater reads
 * (src-tauri/src/linux_update.rs), for the AppImages in a directory.
 *
 *   node scripts/write-linux-update-manifest.cjs 3.1.2 \
 *     https://github.com/digitalhabits/dh-to-do/releases/download/v3.1.2 files > files/latest.json
 *
 * The build workflow runs it in the release job. Each AppImage must have its
 * .sig beside it, named Digital-Habits-To-Do_linux_<arch>.AppImage(.sig).
 * The architecture comes from the file name, so a build for one
 * architecture gives a manifest for that one only.
 */

const fs = require("node:fs");
const path = require("node:path");

const [version, baseUrl, dir] = process.argv.slice(2);
if (!version || !baseUrl || !dir) {
  console.error("usage: write-linux-update-manifest.cjs <version> <download-base-url> <directory>");
  process.exit(1);
}

const NAME = /^Digital-Habits-To-Do_linux_(x86_64|aarch64)\.AppImage\.sig$/;
const platforms = {};
for (const file of fs.readdirSync(dir).sort()) {
  const match = NAME.exec(file);
  if (!match) continue;
  const appImage = file.slice(0, -".sig".length);
  if (!fs.existsSync(path.join(dir, appImage))) {
    console.error(`${file} has no ${appImage} beside it`);
    process.exit(1);
  }
  const entry = {
    signature: fs.readFileSync(path.join(dir, file), "utf8").trim(),
    url: `${baseUrl.replace(/\/$/, "")}/${appImage}`,
  };
  // The installer-specific key comes first for the updater; the plain key
  // is the fallback.
  platforms[`linux-${match[1]}-appimage`] = entry;
  platforms[`linux-${match[1]}`] = entry;
}

if (Object.keys(platforms).length === 0) {
  console.error(`no signed AppImage in ${dir}`);
  process.exit(1);
}

const manifest = {
  version,
  notes: `Digital Habits: To-Do ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
