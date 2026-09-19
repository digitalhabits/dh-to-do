# Digital Habits: To-Do (standalone)

Client-only Tauri shell for the store app. Board data lives in SQLite under the
app data directory. The UI is the shared package in `products/todo`.

## Commands

From the monorepo root:

1. Run `pnpm todo:dev` to open the desktop shell.
2. Run `pnpm todo:build` to build the app.
3. If Apple signing env is set, the Mac build signs with Developer ID.

## Distribution

The app goes out through the Mac App Store and the Microsoft Store only
(decided 2026-09-19). The stores update it, so 3.x has no updater. Versions
2.x also had a direct download with the Tauri updater. That download stops
with 3.0.0. A Developer ID build (`pnpm todo:build`) is for tests.

The identifier is `com.redd.do`, the identifier of 2.x, so 3.x updates 2.x
in both stores. Do not change it: the store listings are tied to it, and the
2.x board is found through it. See `lib/todo/legacy-import.ts` in the product
for what comes over at the first start after an update.

## Store builds

```bash
pnpm --dir apps/todo app:build:mas         # macOS: for-distribution/Digital-Habits-To-Do.pkg
pnpm --dir apps/todo app:build:win-store   # Windows: for-distribution/*.msix
```

Neither one uploads anything.

**Mac App Store.** `scripts/build-mas-package.cjs` is the script that built
2.x. It builds a universal app with `macOSPrivateApi` off, because the App
Store does not take private API. It then signs the app with the App Store
identity, the sandbox entitlements (`src-tauri/entitlements.mas.plist`) and the
provisioning profile, and makes the installer package. It needs the two
"Reduce Digital Distraction Ltd" identities in the keychain, and an App Store
provisioning profile for `com.redd.do`. Give the path of the profile in
`APPLE_PROVISIONING_PROFILE_PATH`, or let the script find the newest one that
Xcode has. The head of the script lists every name it reads.

A first local build passed on 2026-09-19: universal, sandboxed, the company
team, profile inside. The package has not been sent to App Store Connect yet,
and the app has not been run in the sandbox yet. The focus bar is the part to
look at there, because it is drawn with private API in every other build.

**Microsoft Store.** `scripts/build-win-store.ps1` uses the packaging steps of
Mail's script. The identity is the one 2.x has, `ReduceDigitalDistraction.ReDDTodo`.
It has not run on Windows yet.

## Storage

- Mac path: `~/Library/Application Support/com.redd.do/todo.sqlite3`
- Windows: app data directory from Tauri, file name `todo.sqlite3`
- No Clerk. No Planner Postgres. No cloud board database.

## Assets

`public/` holds the files that the shared UI requests by URL. The planner
serves the same paths from its own `public/`, so an asset the UI names must
exist in both places. `public/todo/basecamp-logo.png` is one of them. A missing
file shows as a broken image, and no typecheck or build reports it.

## Integrations

- **Apple Reminders** on Mac through EventKit IPC.
- **Basecamp** via the existing Amplify OAuth broker at
  `https://todo.digitalhabits.org` (same as Digitals Habits: To-Do / redd-do).
  The client secret stays in AWS Secrets Manager. Access tokens live in local
  SQLite. Deep-link fallback scheme: `reddtodo://`.

See [products/todo/README.md](../../products/todo/README.md) for the storage
model and backup notes.
