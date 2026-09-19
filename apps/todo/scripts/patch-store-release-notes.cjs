#!/usr/bin/env node
/**
 * Stamp What's new (+ optional listing description) into a Microsoft Store
 * submission JSON from `msstore submission get`, for `msstore submission update`.
 *
 * Usage:
 *   node scripts/patch-store-release-notes.cjs submission.json whats_new.txt patched.json [keepPackageFileName] [--description path]
 *
 * When keepPackageFileName is set, every ApplicationPackages entry whose
 * FileName is not that package is marked FileStatus=PendingDelete.
 *
 * When --description is set, stamps the same text onto every listing's
 * description (source of truth: store-listing/description.txt).
 */

const fs = require('fs');
const { keyOf, extractJson } = require('./store-submission-json.cjs');

function eachBaseListing(submission, fn) {
  const listingsKey = keyOf(submission, 'listings');
  if (!listingsKey || typeof submission[listingsKey] !== 'object') return 0;

  let count = 0;
  for (const listing of Object.values(submission[listingsKey])) {
    if (!listing || typeof listing !== 'object') continue;
    const baseKey = keyOf(listing, 'baseListing');
    const target =
      baseKey && listing[baseKey] && typeof listing[baseKey] === 'object'
        ? listing[baseKey]
        : listing;
    fn(target);
    count += 1;
  }
  return count;
}

function patchReleaseNotes(submission, notes) {
  return eachBaseListing(submission, (target) => {
    const notesKey = keyOf(target, 'releaseNotes') || 'releaseNotes';
    target[notesKey] = notes;
  });
}

function patchDescription(submission, description) {
  return eachBaseListing(submission, (target) => {
    const descKey = keyOf(target, 'description') || 'description';
    target[descKey] = description;
  });
}

function markSupersededPackagesPendingDelete(submission, keepFileName) {
  const packagesKey = keyOf(submission, 'applicationPackages');
  if (!packagesKey || !Array.isArray(submission[packagesKey])) {
    return { marked: 0, kept: 0, names: [] };
  }

  const keepLower = keepFileName.toLowerCase();
  const markedNames = [];
  let kept = 0;

  for (const pkg of submission[packagesKey]) {
    if (!pkg || typeof pkg !== 'object') continue;
    const nameKey = keyOf(pkg, 'fileName');
    const name = nameKey ? String(pkg[nameKey] || '') : '';
    const statusKey = keyOf(pkg, 'fileStatus') || 'FileStatus';

    if (name && name.toLowerCase() === keepLower) {
      kept += 1;
      continue;
    }

    pkg[statusKey] = 'PendingDelete';
    markedNames.push(name || '(unnamed)');
  }

  return { marked: markedNames.length, kept, names: markedNames };
}

function parseArgs(argv) {
  let descriptionPath = null;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--description') {
      descriptionPath = argv[++i];
      if (!descriptionPath) {
        console.error('error: --description requires a path');
        process.exit(1);
      }
      continue;
    }
    positional.push(argv[i]);
  }
  return { positional, descriptionPath };
}

function main() {
  const { positional, descriptionPath } = parseArgs(process.argv.slice(2));
  const [subPath, notesPath, outPath, keepPackageFileName] = positional;
  if (!subPath || !notesPath || !outPath) {
    console.error(
      'usage: node scripts/patch-store-release-notes.cjs submission.json whats_new.txt patched.json [keepPackageFileName] [--description path]',
    );
    process.exit(1);
  }

  const submission = extractJson(fs.readFileSync(subPath, 'utf8'));
  const notes = fs.readFileSync(notesPath, 'utf8').trim();
  if (!notes) {
    console.error('error: empty what\'s-new text');
    process.exit(1);
  }

  const stamped = patchReleaseNotes(submission, notes);
  if (!stamped) {
    console.error(
      'error: no listings structure in the submission JSON — dump it and adjust this script.',
    );
    process.exit(1);
  }
  console.log(`stamped releaseNotes on ${stamped} listing(s)`);

  if (descriptionPath) {
    const description = fs.readFileSync(descriptionPath, 'utf8').trim();
    if (!description) {
      console.error(`error: empty description file: ${descriptionPath}`);
      process.exit(1);
    }
    const descStamped = patchDescription(submission, description);
    console.log(`stamped description on ${descStamped} listing(s)`);
  }

  if (keepPackageFileName) {
    const result = markSupersededPackagesPendingDelete(
      submission,
      keepPackageFileName,
    );
    console.log(
      `marked ${result.marked} package(s) PendingDelete; kept ${result.kept} matching ${keepPackageFileName}`,
    );
    for (const name of result.names) {
      console.log(`  PendingDelete: ${name}`);
    }
    if (result.kept === 0) {
      console.warn(
        `warning: keep package "${keepPackageFileName}" not found in ApplicationPackages — all existing packages marked PendingDelete (expected right after upload if names differ; verify after update).`,
      );
    }
  }

  fs.writeFileSync(outPath, `${JSON.stringify(submission, null, 2)}\n`, 'utf8');
}

main();
