# Changelog style guide

How to write entries in `changelog.md` for **Digital Habits: To-Do**.

The changelog is the source for GitHub release notes, Microsoft Store and Mac
App Store “What’s New” text, and the history in the public repository. Write for
**everyday people using the app** — not developers, and not “tech people”.
Automation should format and filter these entries, not rewrite them into
polished prose.

Empty sections are omitted from each release.

---

## Approved headings

Use only these `###` headings, in this order. Prefer the most specific product
heading that fits.

| Heading | What belongs here |
| --- | --- |
| **Branding** | App name, icons, Centre for Digital Habits identity, About/EULA attribution, store listing naming. |
| **Tasks & Focus Mode** | Tasks (add/edit/complete, durations, notes, Done), lists/tabs, favourites, drag-and-drop, and Focus Mode (always-on-top window, timer/overtime, fullscreen, complete/exit/switch from focus). |
| **Calendar** | Calendar View (named Planner View before 3.0), tasks shown on the calendar, date ranges, calendar-only behaviour. Entries before 3.0 have this heading as **Planner**. |
| **Integrations** | Basecamp, Apple Reminders, Google Tasks — connect, sync, import, remote list binding, provider-specific reliability. |
| **Performance** | Speed, responsiveness, CPU, memory, battery, UI freezes, large-list/sync efficiency when resource use is the story. |
| **Fixes & Polish** | Settings layout, zoom, opening/EULA screen chrome, menu placement, copy/translations, and other polish that does not change tasks/focus/planner/integrations behaviour. |
| **Internal** | Refactors, dependencies, tests, build/CI, signing, updater plumbing, docs-only — no meaningful effect for people using the app. Same bullet format as other sections. GitHub only; exclude from store “What’s New”. |

Do **not** add headings per screen or provider (no separate Settings, Done,
Basecamp, or Reminders sections). Fold those into the table above.

Do **not** use a nested `### BY PLATFORM` tree. Group by product area; mark
platform limits on the bullet.

---

## Platform tags

Supported platforms: **macOS**, **Windows**, and **Linux**. Public store
What’s New is generated for **Windows** (Microsoft Store) and **macOS** (Mac
App Store).

Optional tags go at the start of the bullet:

| Tag | Meaning |
| --- | --- |
| `[macos]` | macOS only (e.g. Apple Reminders) |
| `[windows]` | Windows only |
| `[linux]` | Linux only |

Rules:

- Before tagging, **read the app architecture** (README, platform docs, and how
  the feature ships). Tag from where users experience the change — not from the
  PR machine, a single test OS, or where the code file lives. Example: Apple
  Reminders is macOS-only; Basecamp sync is not.
- Tags describe **where users experience the change**, not where the code lives.
- Omit the tag when the change applies on every supported platform.
- Prefer the narrowest accurate tag.
- Do not invent a combined desktop tag. If the same change ships on Mac and
  Windows but not Linux, use two bullets — one `[macos]`, one `[windows]`.
- Do not duplicate the same change under multiple sections.

```markdown
- [macos] You can connect Apple Reminders even when you do not have any lists
  yet.
- [windows] Minimise, maximise and close sit cleanly in the in-app title bar.
```

Untagged bullets apply everywhere.

---

## Writing style

Write **plain sentences** for every section — including Branding, Tasks & Focus
Mode, Calendar, Integrations, Performance, Fixes & Polish, and Internal. Do
**not** use a bold lead-in (`**Short title.** …`). Bold is only for product
names or UI labels inside the sentence when needed.

One or two short sentences per bullet. State the change actively and clearly.
Keep it specific enough that people recognise the change, but not so detailed
that store notes become repetitive or run over character limits.

The store text for a version (greeting, intro, bullets and footer) must fit
in **1500 characters** for the Microsoft Store and **4000** for the Mac App
Store. `scripts/changelog-to-store-whats-new.cjs` prints the count. A longer
text is cut at the end of a bullet. For a large release, give the main new
things and leave the small ones out.

```markdown
- Connecting and syncing Basecamp stays more stable, including when you have
  many projects or large lists.
- [macos] Connecting and syncing Reminders no longer freezes the app while
  waiting on the system.
- The design of the Settings screen has been improved.
```

For UI/layout polish on a screen, prefer **one short screen-level bullet** over
listing each control move or label tweak:

```markdown
- The design of the Settings screen has been improved.
- Danish translations have been improved.
- [windows] Onboarding text now fits properly on narrower windows.
```

Only spell out a specific detail when it is a real bug fix people need to
recognise (e.g. “Links in Settings no longer open two browser tabs”), not when
several small layout tweaks landed together.

### Voice

- Write for everyday people. If a friend who is not technical would not
  understand a word, rewrite it.
- Prefer words they already see in the app: **Digital Habits: To-Do**,
  **Centre for Digital Habits**, Focus Mode, Calendar View, Settings, Done,
  Basecamp, Apple Reminders, Google Tasks.
- Say what changed in plain language. Add why it matters only when that helps.
- Sentence case. British spelling where the product UI does.
- One meaningful change per bullet. Keep most entries to one or two short
  sentences.

### What to keep specific vs what to fold together

- Keep **behaviour** specific under product headings: Focus Mode timer,
  planner dates, Basecamp/Reminders/Google sync reliability.
- Under **Fixes & Polish**, fold related UI/copy tweaks on the **same screen**
  into one bullet that names the screen.
- Use **Performance** when the story is freezes, speed, or resource use — even
  if the work was inside Reminders or Basecamp sync.
- Never flatten a real behaviour change into vague “improvements”.

### Product terms

Use consistently: **Digital Habits: To-Do**, **Centre for Digital Habits**,
Focus Mode, Calendar View, Settings, Done, Basecamp, Apple Reminders, Google Tasks.

### Avoid

- Bold lead-ins (`**Short title.** Body…`) — they waste store character budget
  and read as repetitive once markdown is stripped.
- Developer jargon: EventKit, User-Agent, rate-limit internals, “under the hood”
  unless users need a plain explanation.
- Hype or filler: “enhancements”, “various improvements”, “polish throughout”
  with no screen or topic named.
- Putting Settings layout under **Integrations** just because a row mentions
  Basecamp.

Optional release summary: a leading `> …` blockquote under `## vX.Y.Z` is
allowed. Store automation uses the author-written update intro line instead.

---

## Classification rules

1. Classify by **what the user notices**, not by the code area touched.
2. Use a specific product heading before **Fixes & Polish**.
3. Use **Performance** only for speed, responsiveness, freezes, or resource use.
4. Use **Internal** only when there is no meaningful user-facing effect.
5. Settings / opening-screen layout → **Fixes & Polish**.
6. Connect/sync/import behaviour for Basecamp, Reminders, or Google Tasks →
   **Integrations** (unless the only story is Performance).
7. Add a platform tag only when the change is not universal.
8. Never list the same change in more than one section.

### Good vs avoid

| Change | Put it under | Notes |
| --- | --- | --- |
| Focus Mode overtime turns red | **Tasks & Focus Mode** | Behaviour people feel. |
| Planner date range fix | **Planner** | Planner-only. |
| Basecamp project dropdown loads all projects | **Integrations** | Sync/connect reliability. |
| Reminders no longer freezes the UI | **Performance** + `[macos]` | Resource/responsiveness is the story. |
| Settings full-screen sheet + feedback at top | **Fixes & Polish** | One bullet: “The design of the Settings screen has been improved.” |
| Meet Digital Habits: To-Do / icons | **Branding** | Identity. |
| CI / Partner Center / updater hosting plumbing | **Internal** | No user-facing effect. |
| ~~Various improvements~~ | Avoid | Name the screen or the behaviour. |

---

## Filtering for releases and stores

| Destination | Include |
| --- | --- |
| **GitHub Release** | Exact `## vX.Y.Z` section as markdown: update intro line, all non-empty headings, platform tags, and **Internal** |
| **Any store “What’s New”** | Update intro line + non-empty user-facing sections with headings; **exclude Internal** |
| **Microsoft Store** | Untagged + `[windows]` |
| **Mac App Store** | Untagged + `[macos]` |
| **Linux** | Script supports `--platform linux` (untagged + `[linux]`) when needed |
| **Platform-specific store text** | Platform tags removed; plain sentences (no `*` / other markdown) |

### Update intro line (required in `changelog.md`)

Directly under `## vX.Y.Z`, before any `###` heading, write one sentence and
**delete the parts that do not apply**:

```markdown
This update comes with some useful new features, design improvements, and under-the-hood improvements.
```

How to choose the parts:

| Phrase | Use when | Do **not** use when |
| --- | --- | --- |
| **useful new features** | Something genuinely new ships — a capability people did not have before. | Improving, renaming, clarifying, or fixing something that already exists. |
| **design improvements** | UI, layout, copy, translations, or screen polish. | — |
| **under-the-hood improvements** | Reliability, performance, sync plumbing users feel indirectly. | — |

Only keep **useful new features** when there is at least one real new capability
in the release. Renames, clearer Settings, and sync reliability fixes are not
new features.

Store and GitHub automation copy this line as written (after stripping
markdown). They do not invent it from section headings.

### Store body shape

```text
Hi folks,

This update comes with some design improvements and under-the-hood improvements.

Branding
- Existing users upgrading from ReDD To-Do now get a one-time announcement…

Integrations
- Connecting and syncing Basecamp stays more stable, including when you have many projects or large lists.

Fixes & Polish
- The design of the Settings screen has been improved.

Remember that the source code is public — keep your feedback and suggestions coming at https://github.com/digitalhabits/dh-to-do

Cheers,
Ulrik & all of us at Centre for Digital Habits
```

Rules for that body:

- Blank line between sections (after the last bullet, before the next heading)
- No blank line between a heading and its first bullet
- No blank line between `Cheers,` and the signature
- Empty sections omitted; **Internal** omitted
- Bullets are plain sentences (no bold lead-ins in the source changelog)

When several versions are combined into one submission:

1. Gather unpublished entries.
2. Merge bullets under the same approved headings.
3. Keep the approved heading order.
4. Keep platform tags when the destination covers more than one platform (GitHub).
5. Remove duplicates.
6. Exclude **Internal** from store text.
7. Use one update-intro line and the standard store greeting/footer only once.

---

## Example release

```markdown
## v2.10.0

This update comes with some useful new features, design improvements, and under-the-hood improvements.

### Branding

- About and Help links point to the Centre for Digital Habits site.

### Tasks & Focus Mode

- The Done list uses a chevron that shows whether it is expanded or collapsed.

### Integrations

- Syncing large Basecamp lists is less likely to fail when the service is busy.

### Performance

- [macos] Connecting and syncing Reminders no longer freezes the app.

### Fixes & Polish

- The design of the Settings screen has been improved.

### Internal

- Updated documentation and links to the current repository and product names.
```

---

## Checklist

- [ ] Update intro line under `## vX.Y.Z` — only the parts that apply; **new features** only for genuinely new capabilities
- [ ] Only approved headings; empty ones omitted
- [ ] Most specific heading used; **Internal** only when truly invisible
- [ ] Platform tags only where needed (`[macos]` / `[windows]` / `[linux]`); no `BY PLATFORM` nesting; tags checked against app architecture (README / platform docs)
- [ ] Plain sentences only — no bold lead-ins; related UI tweaks on one screen are one screen-level bullet
- [ ] Product terminology matches the app
- [ ] Entries are already fit for public release notes
