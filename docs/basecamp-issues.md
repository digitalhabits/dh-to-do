# Basecamp integration — known issues

A review of the Basecamp 3 integration as it stands in v2.9.0, written after
reading the whole integration end to end: the Rust auth flow, the JavaScript
client, the settings UI, and the hosted token service.

It works, and it does more than the other two integrations — it handles rate
limits properly, it follows Basecamp's pagination correctly, it reaches todos
hidden inside sections, and it can genuinely move a todo between lists rather
than recreating it. Those are the hard parts and they are done well.

What follows is the edges. Two of them are security problems and one of them may
be undoing people's deletions.

Each item says what happens, why it happens, and what a fix would look like. The
fixes are ideas, not implementation plans.

**Where the code lives**, for reference:

- `src/app.js` — the client, sync, and UI wiring. The Basecamp section starts
  around line 8543.
- `src-tauri/src/commands/oauth.rs` — the login flow and the localhost bridge.
- `hosting/` — a separate Amplify app at `todo.digitalhabits.org` that holds the
  client secret and does the token exchange. See its own README.
- `src/index.html` — the settings rows and the project/list pickers.

> Companion documents: [google-tasks-issues.md](google-tasks-issues.md) and
> [apple-reminders-issues.md](apple-reminders-issues.md). Several problems here
> appear in all three, and are worth fixing once in a shared place.

---

## Check this one first

### 1. Deleting a task may not delete it in Basecamp — and the next sync brings it back

**What happens.** You delete a task in the app. It disappears. You press sync.
It comes back, as a new task.

**Why.** `deleteBasecampTodo` sends `DELETE` to
`/buckets/{project}/todos/{todo}.json`. As far as Basecamp's published API goes,
todos are not deleted that way — a recording is trashed with a `PUT` to
`/buckets/{project}/recordings/{todo}/status/trashed.json`. If `DELETE` is
rejected, we would never know: the response status is not checked, and the error
is swallowed into `console.error`. The todo stays alive in Basecamp, so the next
sync sees a remote todo the app does not know about and imports it as new.

The strongest evidence is our own newer code. The Planner's Basecamp client
(`redd-plan`, `lib/todo/basecamp.ts`) uses the trash endpoint, not `DELETE` —
someone already worked this out once.

The same `DELETE` appears a second time in `fallbackMoveBasecampTodo`, which is
worse: that path creates the todo in the target list first, so a failed delete
leaves **two** copies in Basecamp.

**How to check in a minute.** Delete a task in a Basecamp-linked list, then look
at the list in Basecamp in a browser. If the todo is still there, this is
confirmed.

**Recommended fix.** Switch both call sites to the trash endpoint, and check the
response status rather than discarding it. While you are there, decide what a
failed delete should do — leaving the local task deleted while the remote
survives guarantees it reappears, so it is better to keep the task locally and
tell the person the delete did not reach Basecamp.

---

## Things that can lose or duplicate someone's work

### 2. Notes fight with themselves on every single sync

**What happens.** A task with notes never settles. Every sync decides the notes
are different and writes them again, in one direction or the other, forever.

**Why.** Local notes are HTML from the rich text editor. Basecamp's `description`
field is Basecamp's own HTML. The sync compares the two raw strings with `!==`.
Two pieces of HTML that render identically almost never match character for
character, so the comparison reports a conflict every time, resolves it, writes,
and reports the same conflict on the next run.

Both other integrations already avoid this. Google Tasks and Apple Reminders both
flatten local HTML to plain text before comparing, precisely so that pushing our
own notes and reading them back does not look like a change. Basecamp is the only
one that skipped that step.

**Recommended fix.** Compare on plain text, the way the other two do. The helper
already exists in the same file. Keep sending HTML to Basecamp if you want the
formatting — it is only the comparison that needs flattening.

### 3. A failed create quietly duplicates the task on every later sync

**What happens.** Occasionally a Basecamp-linked list fills up with copies of the
same todo.

**Why.** `createBasecampTodo` calls `response.json()` without first checking
whether the request succeeded. When it fails, the parsed body has no `id`, so
`task.basecampId` is set to undefined — which reads exactly like "this task has
never been pushed". The next sync tries again, and creates another todo. And the
next one.

**Recommended fix.** Check the response before reading it. If the create failed,
leave the task unlinked but record that the attempt failed, so the retry is
deliberate rather than unbounded. Surfacing the failure once is better than
retrying it silently ten times.

### 4. Renaming a task while disconnected gets silently reverted

**What happens.** You rename a task while Basecamp is unreachable. Later you
sync. The old name comes back.

**Why.** Completion and notes both compare timestamps to decide who wins.
Titles do not: if the local text differs from the remote content, the remote
content is copied over the local one, unconditionally. That is fine when the
immediate push succeeded, and wrong whenever it did not.

This is slightly worse than the same bug in Google Tasks, which at least refuses
to overwrite a local title with an empty remote one. Basecamp has no such guard,
so an empty or missing `content` will blank the local task text.

**Recommended fix.** Track when the title last changed locally, and run the same
most-recent-wins comparison already used for completion and notes. The helper is
two functions away.

### 5. Moving a task between lists can silently drop its notes

**What happens.** You drag a task from one Basecamp-linked list to another. It
arrives, but its notes are gone.

**Why.** The main move path uses Basecamp's proper move endpoint and keeps
everything. But if that fails, `fallbackMoveBasecampTodo` runs, and it creates
the new todo with `content` only — no `description`. The notes were on the old
todo, which then gets deleted.

**Recommended fix.** Send the description in the fallback create too. One line.
Worth also logging when the fallback runs, since it silently means the primary
endpoint is failing and nobody would know.

### 6. Emptying the Basecamp list deletes local tasks, with no undo

**What happens.** Any task carrying a Basecamp id that Basecamp no longer returns
gets removed locally, silently. Usually right; occasionally catastrophic, if a
list is cleared or the wrong list was linked.

**Recommended fix.** Same as for the other two integrations: if a single sync
would delete more than a handful of tasks, stop and ask. Or route sync deletions
through the undo toast that manual deletes already use. This rule is identical in
all three integrations, so fix it once, in a shared place.

---

## Security

### 7. The tokens travel through the browser in a URL, and any app on the machine can take them

**What happens.** Nothing visible. This is about what is possible, not what has
happened.

**Why.** After you approve access, our hosted service exchanges the code for
tokens and then sends them **back through the browser as URL parameters** — to
`http://127.0.0.1:PORT/callback?access_token=...&refresh_token=...`, or, when the
local listener cannot start, to `reddtodo://oauth-callback?access_token=...`.

Two consequences. Tokens end up in browser history. And custom URL schemes like
`reddtodo://` are first-come-first-served and unauthenticated on both macOS and
Windows — any application on the machine can register that scheme and receive a
long-lived Basecamp refresh token.

**Recommended fix.** Do what the Google Tasks integration already does:
authorization code with PKCE, terminated inside the app. The **code** comes back
to the loopback listener, not the token; the app then exchanges it over TLS and
receives the tokens in a response body. No token ever appears in a URL, in
browser history, or in a deep link, and the deep-link fallback can be deleted
entirely.

`src-tauri/src/commands/google.rs` is a complete working reference for the target
shape, in this repository, written against the same Tauri APIs. This is a matter
of following it rather than designing it.

### 8. The `state` parameter is not doing the job it exists for

**What happens.** The flow has no cross-site request protection at all.

**Why.** `state` is supposed to be a random value you generate, keep, and check
on return. Here it is repurposed to carry the local port number
(`localhost:41234`), and it is never validated when the callback arrives. So the
hosted service will forward a freshly minted token pair to whatever `127.0.0.1`
port an inbound `state` names.

**Recommended fix.** Falls out of the PKCE rework in item 7 — Google's flow
already generates a random nonce, keeps it, and rejects a mismatch. If item 7 is
deferred, at minimum generate and verify a real nonce alongside the port.

### 9. The token exchange endpoint is an open oracle

**What happens.** `POST https://todo.digitalhabits.org/api/exchange` accepts
`code`, `redirect_uri` and `client_id` from anyone on the internet, picks one of
our client secrets based on the caller-supplied `client_id`, and returns the
resulting tokens to the caller. No shared secret, no origin check, no rate limit,
and the caller controls the redirect URI.

It is also redundant. `/api/auth` performs the same exchange, so there are two
copies of the logic to keep in step.

**Recommended fix.** One endpoint, with `redirect_uri` pinned on the server
rather than accepted from the body. With PKCE in place the code verifier becomes
the proof of possession, so the endpoint stops being useful to anyone who did not
start the flow.

### 10. Every backup file a user exports contains their live Basecamp refresh token

Identical to item 12 in [google-tasks-issues.md](google-tasks-issues.md), and it
was found on the Basecamp side first. `buildBackupExportPayload()` re-reads the
whole saved settings blob and returns it verbatim, and that blob holds
`basecampConfig` — access token, refresh token, client id and client secret.

Backup files get mailed to support and dropped in cloud storage. Disconnecting in
the app does not revoke anything at 37signals, so an old backup stays a working
credential.

**Recommended fix.** Strip the credential fields from a **copy** of the payload
on the way out. It must be a copy, or pressing Export would wipe the person's
live connection. This is the single cheapest high-value fix in any of these three
documents.

### 11. The manual-credentials form asks people to paste an OAuth client secret into a desktop app

**What happens.** The settings panel still contains a form with fields for
account id, access token, refresh token, client id and client secret, and it is
still wired up.

**Why it matters.** It is a leftover from before the OAuth flow existed. Nobody
should be pasting a client secret into an app, and anyone following an old
instruction to do so ends up with that secret in the saved blob and therefore in
their backups (item 10).

**Recommended fix.** Delete the form and its handlers.

### 12. Tokens are written into DOM input values on every render

**What happens.** `updateBasecampUI()` fills the hidden form inputs from item 11
with the access token, refresh token and client secret whenever the connection
state changes.

**Why it matters.** Those values are then live in the page, readable by anything
with DOM access and visible in the accessibility tree. It is a second copy of the
credentials in a place nobody would think to look for them.

**Recommended fix.** Goes away with item 11. If the form survives for some
reason, stop populating the secret fields.

---

## Behaviour that is missing or surprising

### 13. Only the first Basecamp account is ever used

`fetchBasecampIdentity()` takes `accounts[0]`. Anyone who belongs to more than one
Basecamp account — agency staff, contractors, anyone with a work and a personal
account — is silently pinned to whichever one 37signals happens to list first.
Their other projects simply never appear, with no explanation and no way to
change it.

**Recommended fix.** When the identity response contains more than one account,
ask which one. When it contains one, carry on silently as now.

### 14. Token expiry is known and then ignored

The auth response includes `expires_in`, and it is captured and stored. Nothing
ever reads it. Refresh happens only in reaction to a 401, so the first request
after a token expires is always wasted.

**Recommended fix.** Low priority — reacting to 401 does work. If you touch it,
refresh proactively when the stored expiry has passed, and keep the 401 handler as
the safety net.

### 15. The one call that runs right after connecting has no retry and no refresh

`fetchBasecampIdentity()` calls `fetch` directly instead of going through
`basecampFetch`, so it is the only Basecamp request with no 401 refresh and no
rate-limit backoff. It runs immediately after connecting, and on failure it shows
a blocking `alert()` and leaves the connection half-established — connected, but
with no account id.

**Recommended fix.** Route it through `basecampFetch` like everything else.

### 16. When the project or list picker is empty, nobody can tell why

`fetchBasecampProjects()` catches everything and returns an empty array.
`getBasecampTodoLists()` does the same, and reads `projectData.dock` without
checking whether the request succeeded — so an error body throws, gets caught, and
becomes "no lists". A network failure, an expired token and a genuinely empty
project all look identical: an empty dropdown.

**Recommended fix.** Check the response status, and let the picker say "Could not
reach Basecamp" instead of showing nothing.

### 17. A failed sync shows a blocking alert with no detail

`syncBasecampList` ends in `alert('Failed to sync with Basecamp. Check your
connection.')`. This is better than Google Tasks, which shows nothing at all, but
a modal dialog is a heavy way to say it and the message never says what actually
failed.

**Recommended fix.** Use the same non-blocking toast pattern the rest of the app
uses, and include the real reason when there is one.

---

## Code health

### 18. Debug logging is left in, including the contents of people's notes

`updateBasecampTodoDescription` logs the task text and the note body to the
console on every push. The move functions log source and target ids and a running
commentary with tick marks. It is noise, and the notes line is content nobody
expected to be written anywhere.

**Recommended fix.** Delete the content-bearing logs. Keep any that are genuinely
useful behind the existing log level.

### 19. Two client ids are duplicated across two repositories by hand

`oauth.rs` hard-codes the dev and production client ids, with a comment saying
each must match the corresponding constant in `hosting/src/basecamp.js`. Nothing
enforces it. They are in different deployment units, so they can drift silently
and the failure appears as a confusing OAuth error.

**Recommended fix.** Have the app fetch the client id from the hosted service, or
at least add a startup check that logs loudly on mismatch.

### 20. Dev builds can never refresh a token

The hosted refresh path always uses the production client secret, but dev builds
authenticate with the dev client id. So a dev token can be obtained and then never
renewed. Only developers hit this, but it makes "it stopped working after two
weeks" a genuinely confusing local symptom.

**Recommended fix.** Pick the secret by client id on the refresh path, the way
`/api/exchange` already does.

### 21. The deep-link fallback is not wired for a cold start on Windows

Startup deep-link handling is compiled in for macOS and Linux only. On Windows a
running instance is covered, but launching the app from a `reddtodo://` URL is
not. Microsoft Store builds also declare no protocol extension, so the scheme is
probably not registered at all there.

In practice the localhost bridge means this path is rarely reached — which is the
real point: it is dead weight that looks like it works. Item 7 deletes it
entirely.

### 22. Large lists are slow by design

Every section within a to-do list is fetched one at a time, and offline-created
tasks are pushed one at a time. Both are deliberate — parallel fan-out was what
tripped Basecamp's rate limit — but a list with many sections takes a noticeably
long time.

**Recommended fix.** A small bounded concurrency, two or three at a time, gets
most of the speed back while staying well inside the limit. The rate-limit handler
already there is the safety net.

### 23. Remote HTML is stored and rendered without sanitising

`remote.description` is written straight onto the task and later rendered by the
editor. Basecamp is a trusted source in practice, and anyone who can write to
your Basecamp project can already do worse things to you. Worth knowing rather
than worth panicking about.

---

## If you only fix four things

1. **Check item 1.** If deletes are not reaching Basecamp, the app is undoing
   people's deletions on every sync, and that is the worst behaviour in any of
   these three documents. It is also a one-minute test.
2. **Strip tokens from backup exports** (item 10) — a few lines, and people are
   currently mailing their refresh tokens around.
3. **Compare notes on plain text** (item 2) — stops an endless write loop, and
   the helper already exists in the same file.
4. **Timestamp titles** (item 4) — silent data loss, with the pattern to copy two
   functions away.

Then the structural one: **rework the login to PKCE and loopback** (items 7, 8, 9
together). It removes a real credential-theft path, deletes the deep-link
fallback and one of the two hosted endpoints, and `commands/google.rs` is already
a working reference for the shape. It is less work than it sounds, because it is
mostly deletion.
