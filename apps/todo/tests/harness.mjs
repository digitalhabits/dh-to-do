/**
 * The smallest thing that can fail a build.
 *
 * A copy of apps/mail/tests/harness.mjs, for the reason in mounted-dom.mjs.
 *
 * No framework: these suites run as plain Node, bundled against the same
 * aliases the app is built with. What each check is worth is in its name, so a
 * failure in CI says what broke rather than which line number did.
 */

const results = [];

/** Record one check. `detail` is printed either way — it is often the value. */
export function check(name, ok, detail) {
  results.push({ ok: Boolean(ok), name, detail: detail === undefined ? "" : String(detail) });
}

/** Print every check and exit non-zero if any failed. */
export function report() {
  for (const { ok, name, detail } of results) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (failed) console.error(`\n${failed} of ${results.length} checks failed`);
  process.exit(failed ? 1 : 0);
}

/** Run a suite, and fail loudly rather than silently on a thrown error. */
export function suite(body) {
  body().then(report, (err) => {
    console.error("the suite threw before it finished:", err);
    process.exit(1);
  });
}
