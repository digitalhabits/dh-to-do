# Google Tasks integration — known issues

A review of the Google Tasks integration as it stands in v2.9.0, written after
reading the whole integration end to end.

Nothing here stops the feature working. It does work, and it works well for the
main path: connect, link a list, add and tick things, press sync. These are the
edges — the places where behaviour is surprising, where data can quietly go
missing, or where Google offers something we throw away.

Each item says what happens, why it happens, and what a fix would look like. The
fixes are ideas, not implementation plans.

> **Start with item 12.** It is the only item here that is a security problem
> rather than a behaviour problem, and it is the only one that gets worse over
> time rather than staying still. Everything else can wait for a normal release.

**Where the code lives**, for reference:

- `src/app.js` — everything except the login. The Google section starts at
  "Google Tasks" around line 9224. The shared push helpers are around line 3487.
- `src-tauri/src/commands/google.rs` — the login handshake only.
- `src/index.html` — the Settings row and the list picker.

> Companion documents: [basecamp-issues.md](basecamp-issues.md) and
> [apple-reminders-issues.md](apple-reminders-issues.md). Several problems here
> appear in all three, and are worth fixing once in a shared place. Items 1, 2, 3,
> 4 and 13 below all have a twin in at least one of the other two.
>
> For the Planner and the standalone React app, see
> `planner-todo-integration-issues.md` in the `redd-plan` repository, which sorts
> every item in these three documents into "applies there" and "does not".

---

## Things that can lose someone's work

### 1. Notes only reach Google when you press sync

**What happens.** You type a note on a task. The note saves locally. Google
never hears about it until you press the sync button. If you never press sync,
Google never gets it.

**Why.** Every other edit has an immediate push — ticking, renaming, adding,
deleting all send to Google straight away. Notes are the one edit that doesn't.
The function that pushes notes to Google is only ever called from inside the
sync routine. The notes editor itself just saves to disk.

**Recommended fix.** Give notes the same treatment as titles: push on edit, with
a debounce so we're not firing a request on every keystroke. The notes editor
already debounces its local save by a second — the push can ride along with
that. This is a small change and it removes the biggest single surprise in the
feature.

---

### 2. Renaming a task while disconnected gets silently reverted

**What happens.** You rename a task while Google is unreachable or
disconnected. Later you reconnect and sync. Your new name disappears and the old
one comes back.

**Why.** Ticking and notes both compare timestamps to decide who wins — we track
when the local change happened, Google tells us when its change happened, most
recent wins. Titles skip that check entirely: if the local title and the Google
title differ, Google's title is simply copied over the local one. That's fine
when the immediate push succeeded, because Google is then genuinely up to date.
It's wrong whenever the push didn't happen.

**Recommended fix.** Track a "title last changed" timestamp on the task, the way
we already do for status and notes, and run the same most-recent-wins comparison.
We already have both the helper that does the comparison and the pattern to copy
from — this is mostly plumbing.

---

### 3. Emptying the Google list deletes your local tasks, with no undo

**What happens.** If tasks vanish from the Google side, they vanish locally too,
silently. If the Google list is cleared or the wrong list gets linked, a sync
can wipe a lot of local tasks at once. There's no undo toast, unlike a normal
delete.

**Why.** The sync rule is "any task carrying a Google id that Google no longer
returns has been deleted, so remove it locally." That's the correct rule for one
task deleted in the Google app. It's also the rule that fires when fifty tasks
disappear at once, and it can't tell those cases apart.

**Recommended fix.** Two cheap guard rails, either of which would help:

- If a sync would delete more than a handful of tasks in one pass, stop and ask
  first. Show what's about to go.
- Route bulk sync deletions through the same undo toast that manual deletes use,
  so there's a way back.

Worth noting the same rule exists in the Basecamp and Reminders syncs, so a fix
here is worth applying to all three.

---

### 4. When a sync fails, it looks exactly like a sync that worked

**What happens.** The spinner spins and stops. That's all you ever see. If the
network dropped, if Google rejected the request, if the token could not be
refreshed — same spinner, same stop, no message.

**Why.** Errors are caught and written to the developer console, then swallowed.
That's a reasonable choice for the individual small pushes, where a failure is
recoverable at the next sync. It's not reasonable for the sync button, which is
the one moment the person is actively waiting for an answer.

**Recommended fix.** Let the sync routine report a result, and surface failures
in the UI the way the reconnect prompt already does. The person doesn't need the
technical detail — "Could not reach Google Tasks. Your changes are saved and
will sync later." is enough.

---

## Behaviour that is missing or confusing

### 5. Nothing syncs on its own

**What happens.** Syncing happens when you press the button, and once when you
first link a list. That's it. No sync when you open a list, none at startup, no
background refresh. Change something in the Google app and the desktop app will
not know until you ask it to look.

**Why.** It was built as an explicit, user-driven action.

**Recommended fix.** Sync when a linked list is opened, at minimum. That single
change makes the feature feel live rather than manual. It also raises the stakes
on items 1 and 2 above — more frequent syncing means more chances for those two
bugs to bite — so fix those first, or ship them together.

---

### 6. You can only link a list at the moment you create it

**What happens.** The Google list picker appears in the new-list dialog. It does
not appear when you edit an existing list. So an existing list can never be
connected to Google, and a connected list can never be disconnected. The only
route is to make a brand new list.

**Why.** The picker is explicitly hidden in the edit dialog. Basecamp and
Reminders are both shown there, so Google is the odd one out. It reads like an
oversight rather than a decision.

**Recommended fix.** Show the picker in the edit dialog too, matching the other
two. Unlinking needs one extra thought: decide whether clearing the link also
clears the stored Google ids on the tasks. It should, otherwise re-linking later
will try to match against ids from a different list.

---

### 7. Disconnecting leaves things half-connected

**What happens.** Disconnect clears the stored keys locally. Two things it does
not do: it does not tell Google to forget us, so the app stays listed in the
person's Google account permissions until they remove it by hand; and it leaves
every list still marked as linked to Google.

**Why.** Disconnect is a local-only reset. The half-linked state is actually
handled deliberately elsewhere — there's a whole "this list is synced with
Google Tasks, but the connection is not active" prompt built for exactly this —
so it is at least a known state, not an accident.

**Recommended fix.** Call Google's revoke endpoint on disconnect, so the
permission actually goes away. That is the honest behaviour and it is a single
request. Leaving the list links in place is defensible — it means reconnecting
restores everything — but the wording around disconnect could say so.

---

### 8. Clearing a title in Google does nothing

**What happens.** Delete the text of a task in the Google app, leaving it empty.
Sync. The desktop app keeps the old title.

**Why.** The sync only accepts a remote title if it is non-empty. That guard
exists to stop a blank or missing field wiping a good local title, which is
sensible, but it also blocks a genuine clear.

**Recommended fix.** Low priority. An empty task title is a strange thing to
want. Leave the guard unless it comes up.

---

## Things Google offers that we throw away

### 9. Due dates are ignored

Google Tasks has a due date on every task. We never read it and never write it.
Set a due date in the Google app and the desktop app will not show it; the app
has no due-date concept of its own to map it onto, which is the real reason.

**Recommended fix.** Nothing to do until the app itself has due dates. Worth
noting on the roadmap that the data is already there for free when it does.

### 10. Sub-tasks come across flattened

Google Tasks supports nesting one level. We ignore the parent field, so a
sub-task arrives as an ordinary top-level task and its relationship is lost.
Sync back and the nesting is gone on the Google side too.

**Recommended fix.** At minimum, stop destroying it: read the parent field, keep
it on the task even though nothing displays it, and send it back unchanged. That
way a round trip through our app doesn't flatten someone's Google list.

### 11. Task order is not synced

Google tracks the position of each task in its list. We ignore it in both
directions, so the two lists can be in completely different orders and neither
side is wrong.

**Recommended fix.** Pull order on the way in, so an imported list arrives
looking like it does in Google. Pushing our order back up is harder and less
valuable — Google's reordering only works within a list and needs a "put this
after that" call per task.

---

## Under the hood

### 12. Every backup file a user exports contains their live Google refresh token

This is the one item here that is a security problem, and it is the reason to read
this document today rather than next month.

**What happens.** The tokens are stored unencrypted inside the same saved blob as
everything else. That much matches the Basecamp integration and is hard to avoid
in a desktop app. The real problem is what happens next: **Export** writes that
blob to a file verbatim.

`buildBackupExportPayload()` calls `saveData()`, reads the whole saved blob back
out, attaches the planner and interface preferences, and returns it as the export
payload. `saveData()` writes `googleTasksConfig` — access token, refresh token and
account email — straight into that blob. So a file called something like
`Digital-Habits-To-Do-backup-2026-08-10.json` contains a working credential for
the person's Google Tasks account, in plain text, near the top.

**Why it is worse than it sounds.** Backup files are meant to be moved around.
People mail them to support, drop them in Dropbox, and keep them for years. And a
Google refresh token **does not expire on its own** once the Cloud project is
verified and published — it stays valid until the person explicitly revokes the
app at `myaccount.google.com/permissions`. Disconnecting inside the app does not
revoke it either (see item 7). So a backup taken today can still grant access to
someone's tasks long after they think they have disconnected.

The same is already true of the Basecamp token, which is how this was found. Google
makes it more pressing because the token is longer-lived.

**Recommended fix, in two parts.**

The urgent part is small: strip the credential fields from the export payload.
`buildBackupExportPayload()` should delete the token and secret fields from every
`*Config` object on the copy it returns. It must be a copy, not the live object,
or you will wipe the person's actual connection when they press Export. This is a
handful of lines and it stops the leak.

Two follow-ups worth doing after that. Import should tolerate old backups that
still carry the fields, and ignore them rather than restoring a stale token. And
longer term, move both tokens out of the app's own storage into the operating
system credential store, which also fixes the plaintext-at-rest problem and
applies to Basecamp at the same time.

This is recorded as item W2 in the integrations audit on the
`claude/habits-integrations-audit-3570e7` branch, which notes the fix is
provider-independent and worth doing before Google verification completes. That
window has probably closed, which raises the priority rather than lowering it.

### 13. No back-off when Google says slow down

If Google throttles us, we do not notice. We handle an expired token — one
retry after refreshing, which is the common case and works well — but a
rate-limit response is treated as a plain failure and dropped.

Notably, our own Basecamp integration does handle this properly, with retries
and respecting the wait-time header Basecamp sends back. Google gets the thinner
treatment.

**Recommended fix.** Copy the Basecamp approach onto the Google client. Same
shape, already proven in this codebase.

### 14. The first sync of a big list is slow

When a linked list has many tasks that have never been pushed, they are created
one at a time, each waiting for the one before. A hundred tasks means a hundred
round trips in sequence.

**Recommended fix.** Send a handful in parallel rather than strictly one after
another. Keep the limit small so we don't trip item 13.

### 15. A list can be tied to two services at once, and the app assumes it can't

The new-list dialog lets you pick a Basecamp list and a Google list in the same
breath, and both links get saved. But elsewhere the app asks "what kind of
synced list is this?" and expects a single answer, picking by priority. A
list linked to both reports as Basecamp only, and drag-and-drop compatibility
between lists is decided on that single answer.

Nothing visibly breaks in normal use, because nobody links two services to one
list on purpose. It is a latent trap rather than a live bug.

**Recommended fix.** Pick one and enforce it. Either stop the dialog offering a
second service once one is chosen, or replace the single-answer question with one
that handles a list having several links. The first is much less work.

---

## If you only fix four things

1. **Strip tokens from backup exports** (item 12) — the only security issue here,
   a handful of lines, and the only one that keeps getting worse while you wait.
2. **Push notes on edit** (item 1) — the biggest surprise, the smallest change.
3. **Timestamp titles** (item 2) — silent data loss, and the pattern to copy
   already exists two functions away.
4. **Surface sync failures** (item 4) — cheap, and it turns every other problem
   in this list from invisible into reportable.

Items 5, 3 and 13 are the natural next tier, and they belong together: if syncing
becomes automatic, it needs to be safe and it needs to back off politely.

## A note on where this document lives

The setup runbook for this integration — how the Google Cloud project was created,
which scopes were verified, and what the verification submission said — is at
`docs/google-tasks-setup.md` on the `claude/habits-integrations-audit-3570e7`
branch. It is **not** on `main`. Neither is the integrations audit it references.

Both are the only written record of how this was set up, and they are one branch
deletion away from being gone. Worth cherry-picking onto `main` regardless of what
happens to the rest of that branch.
