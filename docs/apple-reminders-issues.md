# Apple Reminders integration — known issues

A review of the Apple Reminders integration as it stands in v2.9.0, written after
reading the whole integration end to end: the native EventKit layer, the
JavaScript client, the permission flow, and the macOS packaging.

This is the best-behaved of the three integrations in the places that usually go
wrong. The permission flow is genuinely careful — it handles denial, tells the
person what happened, and offers to open the right System Settings pane. It
correctly treats write-only access as insufficient. It flattens rich text to plain
text before comparing notes, which is the step the Basecamp integration forgot.
And it has no tokens to leak, because there is nothing to authenticate against:
EventKit is local.

What follows is the edges. One of them ships a dead 90 KB executable to every
user on every platform.

Each item says what happens, why it happens, and what a fix would look like. The
fixes are ideas, not implementation plans.

**Where the code lives**, for reference:

- `src-tauri/src/commands/reminders.rs` — the whole EventKit layer, in Rust via
  `objc2`. Compiled on macOS only; the commands return empty results elsewhere.
- `src/app.js` — the client and sync. The Reminders section starts around line
  9537.
- `src-tauri/Info.plist` — the two usage descriptions macOS requires.
- `build/entitlements.mas.plist` — the sandbox entitlements for App Store builds.

> Companion documents: [google-tasks-issues.md](google-tasks-issues.md) and
> [basecamp-issues.md](basecamp-issues.md). Several problems here appear in all
> three, and are worth fixing once in a shared place.

---

## Ship-blocking housekeeping

### 1. A dead 90 KB Mach-O binary ships inside every build, on every platform

**What happens.** `src/reminders-connector` (90.5 KB, a compiled executable),
`src/reminders-connector.swift` (8.5 KB) and
`src/reminders-connector-Info.plist` sit in the front-end source directory. None
of them is referenced anywhere in the codebase. The Rust layer talks to EventKit
directly through `objc2` and has done for some time; the Swift helper it replaced
was never removed.

**Why it matters more than dead code usually does.** `frontendDist` in
`tauri.conf.json` is `../src`, so **everything** in that directory is bundled into
the app. That means a compiled macOS executable is shipping inside the Windows
build too, where it is not merely useless but inexplicable. On macOS, an unsigned
nested executable inside the bundle is exactly the sort of thing that draws
notarisation failures and App Review questions.

**Recommended fix.** Delete all three files. If you want to keep the Swift source
as a reference, move it out of `src/` so it stops being packaged — anywhere else
in the repository is fine.

---

## Behaviour that is missing or surprising

### 2. A task you add does not appear in Reminders until you press sync

**What happens.** You add a task to a Reminders-linked list. Nothing appears in
the Reminders app. You tick it, rename it, delete it — all of those *do* reach
Reminders immediately. Only creating does not.

**Why.** The shared push helpers cover completion, title and deletion for all
three integrations, but the create helper only has branches for Basecamp and
Google Tasks. Reminders was left out. So new tasks are only created during the
sync pass, which also handles the genuine offline backlog.

**Recommended fix.** Add a Reminders branch to the create helper, matching the
other two. The function it needs already exists and is already used by the sync
path. One caveat: the native create only accepts a title, so a task created with
notes needs a follow-up call to attach them — see item 8.

This is the same class of surprise as notes-only-on-sync in Google Tasks, and the
Planner's version of this integration already pushes creates immediately, so the
fix is proven.

### 3. Renaming a task while disconnected gets silently reverted

**What happens.** You rename a task while Reminders access is unavailable. Later
you reconnect and sync. The old name comes back.

**Why.** Completion and notes both compare timestamps to decide who wins. Titles
do not: if the local text differs from the reminder's name, the reminder's name is
copied over the local one, unconditionally.

This is the same bug, in the same shape, in all three integrations.

**Recommended fix.** Track when the title last changed locally and run the same
most-recent-wins comparison already used for completion and notes.

### 4. Imported tasks all claim they were created just now

**What happens.** Import a list of fifty reminders and every task shows the same
creation time — the moment of the import.

**Why.** The native layer does read each reminder's real `creationDate` and hands
it across. The import then ignores it and writes `new Date()` instead. Completion
and last-modified dates are mapped correctly; only creation is dropped.

**Recommended fix.** Use the value that is already being passed. It is a one-line
change and the data is sitting there unused.

### 5. "Reminders group" is really the account, not a group

**What happens.** The new-list dialog offers to "Import to-do lists from reminders
group", and the groups it offers are things like *iCloud*, *On My Mac* or an
Exchange account name — not the groups a person sees in the Reminders app
sidebar.

**Why.** EventKit has no concept of the list groups the Reminders app displays.
What it exposes is the *source* each list belongs to, meaning the account. The
integration surfaces that and labels it "group".

**Recommended fix.** Relabel it. "Import all lists from this account" describes
what actually happens. Nothing about the behaviour needs to change — it is a
useful feature with a misleading name.

### 6. Emptying the Reminders list deletes local tasks, with no undo

**What happens.** Any task carrying a reminder id that Reminders no longer returns
gets removed locally, silently. Usually right — that is a deletion propagating —
but if the wrong list is linked, or a list is cleared, a lot of local tasks go at
once with no way back.

**Recommended fix.** Same as for the other two integrations: if a single sync
would delete more than a handful of tasks, stop and ask, or route sync deletions
through the undo toast that manual deletes already use. The rule is identical in
all three, so fix it once in a shared place.

### 7. When a sync fails, nothing says so

**What happens.** The spinner spins and stops, whatever happened.

**Why.** `syncRemindersList` wraps everything in a try/catch that writes to the
developer console and returns. This is the more surprising because the *connect*
flow is handled so well — it detects permission denial specifically, explains it,
and offers to open System Settings. All of that care stops at the sync boundary.

**Recommended fix.** Let the sync report a result and surface failures the way the
connect flow already does. The pattern to copy is a few hundred lines up in the
same file.

---

## Reliability

### 8. Notes cannot be set when a reminder is created

**What happens.** Nothing visibly wrong today, because the sync works around it.

**Why.** The native create command takes only a list and a title. To attach notes,
the sync creates the reminder and then issues a second call to set them. That
means two EventKit saves per imported task, and it means anyone adding an
immediate-create path (item 2) has to remember the second call or notes will
silently vanish on newly created tasks.

**Recommended fix.** Let the native create accept optional notes and set them
before the first save. It removes a whole class of future mistake and halves the
saves.

### 9. If EventKit never answers, the sync hangs forever

**What happens.** In the worst case the sync spinner spins indefinitely and never
resolves.

**Why.** Both the permission request and the task fetch hand EventKit a completion
block and then block on a channel with **no timeout**. If that block never fires —
which is unusual but not impossible, particularly around permission changes or a
stalled iCloud sync — the thread waits forever. It runs on a background thread, so
the window stays responsive, but the promise never settles and the operation
never fails either. There is nothing to retry and no error to show.

**Recommended fix.** Use a timeout on the receive and turn expiry into a normal
error. Ten or fifteen seconds is generous for a local API. Combined with item 7,
the person then sees "Could not read Apple Reminders" instead of an eternal
spinner.

### 10. The first sync of a large list is slow

Offline-created tasks are pushed one at a time, each waiting for the one before.
Unlike the Basecamp integration, where sequential requests are a deliberate
defence against rate limiting, there is no remote service here to annoy — this is
purely local.

**Recommended fix.** EventKit is genuinely fussy about parallel writes, so keep
saves serial, but there is no reason for the *round trips* to be. If this becomes
a real complaint, a single native command that creates many reminders in one
call would fix it properly.

---

## Platform and packaging

### 11. There is no Reminders story on Windows or Linux at all

The whole section is hidden off macOS. That is honest — EventKit does not exist
elsewhere — but it means that for most desktop users the Integrations panel used
to contain exactly one entry. Google Tasks has improved that considerably, since
it shows on every platform.

**Not a bug.** Noted because it is the reason the Integrations panel looks so
different depending on the machine, and worth remembering when deciding what to
build next. The platform-native counterpart on Windows is Microsoft To Do, which
is a cloud API over OAuth and so architecturally much closer to the Basecamp
integration than to this one.

### 12. The sandbox entitlements look right, but say so in the review notes

**What I checked.** App Store builds grant
`com.apple.security.personal-information.calendars` and no reminders-specific key.
That appears correct — the Calendars entitlement is what gates EventKit reminders
access in the sandbox, and Apple publishes no separate reminders entitlement. Both
usage description strings macOS requires, `NSRemindersUsageDescription` and
`NSRemindersFullAccessUsageDescription`, are present in `Info.plist`. The
network-server entitlement the OAuth loopback listener needs is also there.

**Why it is still worth a note.** Apple's own documentation is thin here, and
reviewers have historically queried apps that request the Calendars entitlement
without appearing to use calendars. A sentence in the review notes explaining that
the app syncs Reminders through EventKit, and that Calendars is the entitlement
that gates it, costs nothing and pre-empts a rejection cycle.

**Needs a device test.** This was reviewed by reading the signing configuration on
a Windows machine, not by running a sandboxed App Store build. Confirm on a real
build before release.

### 13. Disconnect is a local flag, and cannot be anything else

Disconnecting sets a stored flag to false and leaves every list still marked as
linked. Unlike the other two integrations there is no token to revoke — access is
an operating system permission, and only the person can withdraw it in System
Settings.

**Not a bug**, but the wording could say so. There is already a helper that opens
the right Settings pane; offering it next to Disconnect would make the actual
model clear.

---

## If you only fix three things

1. **Delete the dead connector files** (item 1) — three files, no behaviour
   change, and it stops shipping a stray macOS executable inside the Windows
   build.
2. **Push creates immediately** (item 2) — the one place this integration behaves
   differently from the other two for no reason, and the Planner already proves
   the fix.
3. **Timestamp titles** (item 3) — silent data loss, with the pattern to copy two
   functions away.

Item 9 is the natural next one, and it pairs with item 7: a timeout is only useful
if the resulting error is actually shown to somebody.
