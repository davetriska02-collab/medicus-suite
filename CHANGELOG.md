# Changelog

All notable changes to Medicus Suite are documented here.

## [v3.224.1] — 2026-08-07

### First available: design polish from a multi-critic review

A three-critic design review (art director / token surveyor / fresh-eyes GP persona, per
`/design-crit`) of the v3.224.0 surface, rendered against fixture data in twelve states. The
convergent findings, all applied:

- **One card per favourite.** The tile and its Book action were separate grid cells, tearing
  holes in the grid and leaving Book's ownership ambiguous. Each favourite is now a single card:
  type name (sans 11px, demoted), the **datetime as the primary read** (mono 13px `--text-1`),
  and an always-rendered footer button — "Check" when unchecked, "Checking…" in flight, **"Book"**
  on a found slot, "Retry" on error — so rows stay flush and the action is bound to its data.
- **Status palette reclaimed.** Found times lose their green; "None in 4 weeks" loses its amber.
  In this component amber now means exactly one thing — *the tool couldn't complete* (the
  stopped-early caveat, per-type fetch errors, and the arm failure, now an amber banner with an
  alert-triangle instead of bare red text). Red is used nowhere; the alert palette stays spent on
  clinical states only.
- **Freshness told once.** The per-tile "as at HH:MM" (which collided with slot times — "09:15 as
  at 09:19") is hoisted to a single stamp in the section header; the snapshot caveat becomes its
  own line above the picker instead of buried fineprint. "(2 that day)" — genuinely ambiguous in
  the fresh-eyes read — is now "+1 later that day".
- **One container model.** The whole component is a single `--r-lg` shell card on both hosts
  (the Reception card-in-card nesting removed); the uppercase "FIND ANY OTHER TYPE" eyebrow —
  the exact pattern the 2026-06-21 recast retired — is sentence-cased; the empty state follows
  the canon recipe (centered, star glyph, breathing room); the collapsed badge reads "4 saved".
- **Accessibility:** `aria-live="polite"` on async results in all three pickers (first-available,
  Slots browse, Reception booking panel), `aria-label` on all three type selects, per-type
  "Book <type>" labels, aria-busy while checking, a double-fire guard on the Book handoff, and
  disabled/active states aligned to the canon.

No behaviour changes to search, favourites, or the booking handoff; all H-043 controls untouched.

## [v3.224.0] — 2026-08-07

### Typable appointment-type search everywhere + book straight from First available

Field feedback on v3.223.0, addressed in three parts:

**Type to filter, on every booking picker.** All three appointment-type pickers — the Slots
tab's booking section, the Reception guided-capture booking panel, and First available — now
carry a filter box above the select: type "acute" and the list collapses to the types containing
it (case-insensitive, multi-word queries AND together, one shared
`filterAppointmentTypes` in `booking-panel-core.js` so all three behave identically). A single
remaining match auto-selects, so "acute → Find slots" is two actions. Only the select's options
rebuild per keystroke — focus never leaves the input mid-word.

**Book from a First available result.** A found slot now carries an accent **Book →** button.
The component still never books: the button is a *handoff* — it dispatches
`suite:first-avail:book` with the type + day; a mounted Slots module claims it and opens its own
booking section pre-filled and pre-searched (patient detection, commit-time re-verification and
every other H-043 control untouched). From the Reception card the handoff travels via a one-shot
`slots.pendingBooking` key (2-minute freshness, allowlisted from backups — the
`leaflets.pendingQuery` idiom) and jumps to the Slots tab. `test-first-available.js` pins the
component write-free and the handoff wiring on both sides.

**Obvious buttons, not text lines.** Favourites redesigned from text rows into a grid of large
tiles — type name bold, status/result beneath, tap to check, ✕ to unfavourite, Book → underneath
a result. The section opener and the Slots "Book appointment for patient" opener are now
button-shaped bars (background, border, hover) instead of underlined text lines, and the picker's
star is a labelled "☆ Favourite" button.

`test-first-available.js` grows to 45 checks (filter semantics + handoff/filter source pins).

## [v3.223.0] — 2026-08-07

### First available appointment — "when's the next FCP?" answered in one click

New collapsible **First available appointment** section on the Slots tab, and the same as a
card on the Reception tab (one shared component, `side-panel/modules/shared/first-available.js`
— shared favourites, both shells). Star the appointment types the desk is asked about all day
(FCP, GP urgent, bloods, …) and each favourite becomes a one-click check: the earliest slot of
that type in the next 4 weeks, worded for reading out ("Today 14:30", "Tomorrow 09:15",
"Tue 11 Aug 2026, 10:00 — in 4 days"), with how many more that day and an "as at HH:MM"
timestamp. Any other type is reachable through a full selector list, starrable from there.

Deliberately **read-only** — no reserve, no create, no patient identity; booking stays in the
existing panels with their H-043/H-051 controls (and the fine print says exactly that). Rate-safe
by construction: lazy-armed (no fetches until the section is opened), every search goes through
`findSlotsInWindow`'s caps (≤28 days, ≤4 concurrent, abort on 429/5xx) and stops fetching further
days once a slot is found; "Check all favourites" runs sequentially; favourites are capped at 12.
"None in the next 4 weeks" and "search stopped early — scheduler busy" stay distinguishable, so
the desk never tells a patient there's nothing for a month when the search simply got cut short.

Favourites persist at `slots.firstAvailFavs`, sync live across panel/pop-out/reception, and are
included in suite backups (`shared/io/slot-counter-io.js`). New `test-first-available.js`
(32 checks) covers the pure core (earliest-slot selection across unordered day results,
Today/Tomorrow wording, favourites sanitisation/cap) and pins the component read-only.

## [v3.222.0] — 2026-08-04

### Task presence: the practice's shared folder IS the store

Field verdict on v3.221.0: still too complicated — and the data shouldn't leave the practice.
Both fixed at once. The presence store is now **the shared folder the extension already loads
from**: while a clinician has a request open (tab visible), the service worker writes one tiny
self-expiring file — `ms-presence/<site>-<staffId>.json` — into the folder, and every machine
reads the folder to draw the 👁 chips and the banner. One file per staff member, written only by
its owner, so there are no write conflicts by construction. **Nothing leaves the practice
network. No accounts, no cloud, no credentials, no config files.**

Setup collapses to the irreducible minimum Chrome allows — one click per machine, once: Options →
Task Presence → Choose folder → pick the Medicus Suite folder ("Allow on every visit" when Chrome
asks). The File System Access directory handle persists in extension IndexedDB; all file IO runs
in the service worker (`shared/presence-folder.js` + `presence:folder*` handlers); the Options
page owns the picker and any re-allow prompt (both need a user gesture a worker doesn't have),
with a live status line and one-click re-allow if Chrome ever drops the grant.

Share contents are treated as untrusted on read (anything on the practice network can write to a
share): the filename is the authorisation unit, rows are re-validated against it, oversize and
junk files are skipped, and day-dead files are swept opportunistically. Transport dispatch in
task-presence.js prefers the folder whenever it's connected and granted; the v3.221.0 hosted
(Supabase) store survives as the documented fallback for practices without a shared folder.
New `test-presence-folder.js` (31 checks) on the filename/row round-trip.

## [v3.221.0] — 2026-08-04

### Task presence: fire-and-forget rollout via the shared extension folder

v3.220.0's presence store needed URL + key typed into Options on every machine. Practices load
the unpacked extension from a shared folder, so now ONE file does the whole rollout: copy
`presence-config.example.json` to `presence-config.json` in that folder, fill in the practice's
store URL + anon key, and every machine configures itself — the service worker syncs the packaged
file into `presence.fileCache` (on install, browser start, and first Medicus page), and
task-presence.js resolves config as manual-Options-override → shared-file → dormant. Enabled
semantics are now "on unless this machine explicitly opted out", so a machine that has never
opened Options runs the moment the file exists. The synced credentials are cached per machine, so
presence survives a folder update that forgets to carry the file over. `presence-config.json` is
git-ignored and never in release zips; Options gains a shared-folder status line and the fields
become a per-machine override. (16 new checks on `resolvePresenceConfig`.)

### Live-check corrections (v3.220.0 field test, same day)

- **"Last actioned by" chip demoted to latent.** On the live queue, Medicus sends
  `actionedBy`/`actionedDateTime` as empty strings on every row — including `Reply received` ones
  — so the chip correctly renders nothing and v3.220.0's "works from install" claim was wrong.
  The wiring stays (it lights up if Medicus ever populates the fields); feature-list and setup
  doc now say so plainly. The presence store is the real signal.
- **Queue monitoring resolves against the ROW's task type, not the queue's.** The same live check
  caught every monitoring resolve on the requests queue 404ing: a `medical_patient_request_task`
  queue serves `communication-thread` rows, and `_queueMonCache` stored the queue's slug for
  every row. It now derives each row's true slug from its own validated `overviewURL` (queue slug
  only as fallback), so `/tasks/data/{slug}/overview/{uuid}` resolves stop dying silently on
  mixed-type queues.

## [v3.220.0] — 2026-08-04

### Task presence: "is someone already on this request?"

Field request: two clinicians can open the same triage request without either knowing the other
is in it. The v3.219.2 capture proved Medicus offers nothing to build on — opening a request
writes nothing, the status enum has no in-progress, and every Pusher channel is public — so the
signal is now the Suite's own (`content-scripts/task-presence.js`), in two layers:

**Layer 1 — zero setup, on from install.** The queue payload already carries
`actionedBy`/`actionedDateTime` on every row; Medicus just never displays them. page-world.js now
forwards both over the existing `ch-task-list-data` bridge (validated as untrusted, same rules as
content.js's listener) and a "✎ name · time" chip renders in the patient cell — who last touched
the task, straight off the wire.

**Layer 2 — shared presence, dormant until configured.** While a clinician has a task overview
open AND visible, an advisory presence row (site, task UUID, staff UUID, display label,
timestamps — no patient data of any kind) heartbeats every 25s to a practice-configured Supabase
table (the manifest already carried the host permission). Colleagues then see a "👁 name" chip on
that queue row, and opening a request someone else has open injects an amber advisory banner
("opened this N min ago — they may be working on it"). Identity is never typed: page-world.js
reads the logged-in staff UUID + email from the page's own Pusher channel names and stamps
`data-ch-staff`, so a shared terminal attributes presence to whoever is actually in Medicus.

Safety posture, stated everywhere it surfaces: advisory, never a lock — and **no chip never means
no one** (unconfigured machine, colleague without the Suite, offline store). Heartbeats stop when
the tab is hidden and rows stale out at 90s, so a request left open over lunch releases itself
rather than warning colleagues off it; store failures are silent to the clinician (debug-logged)
because a broken advisory layer must not add noise to a clinical queue. New Options → Task
Presence section (store URL/key/display name; the key is machine-local and excluded from backups,
same stance as the Transactional API caller key). Practice setup: `docs/task-presence-setup.md`.
91-check test file (`test-task-presence.js`) covers the bridge-row sanitiser, identity parse,
config gate, heartbeat payload (opened_at only on the first beat), the active-others filter
(self/stale/future-dated excluded, store rows treated as untrusted) and the chip/banner text.

## [v3.219.2] — 2026-08-04

### Answered: Medicus does not tag a request as "being worked on"

Capture run on a live triage request (`docs/learnings-task-presence.md`), and the answer is
no — from three independent directions:

- **Opening a request writes nothing.** The request was opened, left, and opened again:
  20 network calls, every one a `GET`, zero writes. A claim or lock has to write on open,
  so Medicus has nothing to show anyone else.
- **No status for it.** The queue's Status filter offers New / Awaiting recipient response /
  Reply received / Scheduled for later; the task page's own `taskStatusOptions` offers
  `new-request` / `reply-received` / `awaiting-recipient-response` / `resolved` (+ `rejected`).
  There is no `in-progress`.
- **No presence channel.** 17 Pusher channels on a task page, none of them presence, and all
  public — so client events are impossible and we cannot publish our own presence onto them.

Useful by-catch: the queue row already carries `actionedBy` / `actionedById` /
`actionedDateTime`, `assignedTo` / `assignedId` and `status` / `statusValue` / `statusText`,
none of which `shared/request-monitor.js` reads. That makes "last actioned by X at HH:MM"
available with no new endpoint — though it is a *last-actioned* signal, empty on an untouched
task, so it misses the collision case that matters most (opened but not yet actioned).
Medicus also runs a per-task broadcast channel `{site}-task-{uuid}` → `updated`, which fires
on change, not on view.

Two fixes to the capture tool itself, both exposed by the run: `apiBaseUrl()` stripped the
first host label before prefixing `api`, building `{code}.api.medicus.health` (does not
resolve) instead of `{code}.api.england.medicus.health` — both active probe GETs failed, and
every finding above came from the passive fetch/XHR wrap catching the app's own traffic. And
`BODY_KEEP_CAP` was raised 20k → 80k, because a task overview truncated mid-`taskStatusOptions`.

## [v3.219.1] — 2026-08-04

### Discovery tool: is a request tagged as "being worked on"?

Dev tooling only — no runtime change, nothing added to the manifest's content scripts.

Open question from the floor: when you open a triage request, does Medicus record or broadcast
that anywhere, so a colleague can see someone is already on it? The repo could not answer it.
What it knew: task-list rows carry only `id`/`patientName`/`summary`/`priority`/`createdAt`
(`shared/request-monitor.js`); the list API filters on `statuses[]` with just two values ever
observed (`new-request`, `reply-received`) plus `masterAssignee`; tasks can be re-assigned to a
team (`routine-rx-button.js`) — but an assignee is who *should* do it, not who *is* doing it; and
the page runs Pusher (`pusher-relay.js`), which is exactly the transport a presence signal would
use, never enumerated.

New `scripts/task-presence-capture.js` (`chWork`) answers it from the live page instead of by
inference, per the capture-first rule. It looks in the four places such a tag could live — the
task overview payload, the task-LIST row payload (what a queue chip could actually draw from),
Pusher channels/events, and the page's own status controls — and adds the decisive behavioural
test: whether merely OPENING a request produces a write. A claim or lock must POST on open; a
silent open means nothing is being recorded and any indicator has to be ours.

Read-only and reversible, same posture as the existing capture scripts: wraps `fetch`/XHR/
`WebSocket`/`history` to observe, never blocks, rewrites, replays or POSTs; its own probe GETs
are endpoints the shipped code already calls; `chWork.stop()` unwraps everything. Bodies go
through the same key-based redactor (patient name, DOB, NHS number, address, postcode, phone,
email), with staff names deliberately kept — "which colleague is shown against an open request"
is the thing being studied. Output stays local and is never committed.

## [v3.219.0] — 2026-08-03

### Organise problems: "Change significance" section (and a trigger rename)

Field request: Major/Minor/Unknown grading is often wrong at import ("Asthma" and "Essential
hypertension" sitting under Minor), and Medicus's own UI re-grades one problem at a time. New
"Change significance" section in the problems widget: tick problems (each row shows its current
grade and onset date), pick the target grade, one explicit confirm listing every move
("Essential hypertension · Mar 2016 — Minor → Major"), then sequential commits.

No new endpoint knowledge needed: each commit rides the CONFIRMED `edit-problem` full-replace
contract that "Clean up code" already drives in production — GET the problem's own prefill,
resolve the target grade from the prefill's OWN `significances` options (a form that doesn't offer
the grade is a per-row refusal, never an invented enum — only `'major'` has ever been captured on
the wire), rebuild the full body with only `significance` changed (same option-object and
recordedByOrganisation unwraps that fixed the two live 400s in the description-cleanup history),
POST. Rows already at the target grade disable; per-row errors keep their tick for retry; one
event-ledger record per batch; refresh note as ever.

With four sections (suggested links, duplicate merge, significance, manual linking) the trigger
label "Nest problems?" was no longer honest — renamed to **"Organise problems?"**. Same widget,
same position, same everything else.

## [v3.218.0] — 2026-08-03

### Record-tidy widgets now work wherever the Clinical Summary panel renders

Field report (2026-08-03, same day): the tidy widgets were missing from the appointment view and
the consultation view — both render the embedded Clinical Summary panel, but neither URL carries a
patientId, and per-shape URL parsing was never going to keep up with Medicus's page inventory.

New approach: the page itself always announces the patient. Whenever any Medicus page fetches
`/clinical/data/clinical-summary/summary/{patientId}` to render its summary panel, the MAIN-world
bridge (`triage-lens/page-world.js`) stamps that patientId onto a `documentElement` attribute
(`data-ch-summary-patient` — the DOM is shared between worlds, so late-loading widgets read it with
no event-timing races; only the URL is read, never the response body). The three tidy widgets
(`problem-bulk-end`, `problem-nesting`, `allergy-cleanup`) use it as their third context source
after the care-record URL and the task-overview resolution — covering appointment views,
consultation views, and any page shape Medicus adds later, with zero new endpoint knowledge.

Wrong-patient guard: a bridge-derived context must ALSO match at least one on-screen row (problem
description / allergy row) before a widget injects — a stale attribute after SPA navigation
produces rows that match nothing, so nothing renders and nothing can act on the wrong patient's
record. The allergy widget already had this property structurally (it only ever anchors to an
exact-matched row in the scoped Allergies card); the two problem widgets gained an explicit gate.

## [v3.217.1] — 2026-08-03

### Design-crit polish: Nest problems widget

A three-critic design review (hostile art-direction pass against the suite doctrine, a token/code
survey, and a fresh-eyes GP persona judging screenshots only) converged on the same defects; all
settled rulings landed in one pass:

- **Every problem reference now carries its onset date** (mono suffix, from the overview the scan
  already fetches) — suggestion cards, dropdown options, merge keeper radios, manual checklist rows
  and confirm lists. Three identical "Anorexia nervosa" rows are no longer indistinguishable, which
  the fresh-eyes reviewer correctly called a safety defect, not polish.
- **Accordion layout**: the three sections (Suggested links / Merge duplicate copies / Link
  manually) open one at a time under compact headers with mono counts, and the body is capped at
  60vh — an open widget no longer displaces ~700px of the problem list it exists to serve.
- **Amber now means danger only**: routine nest confirms went neutral; the destructive merge
  confirm is the sole amber block, gains a warning glyph, and its copy tightened to "this cannot
  be undone from this tool". (The old identical-amber-for-everything rendering was itself a
  degraded hazard control — a destructive action styled like a reversible one.)
- **Scoped canon token block** per the injected-surfaces rule (the stylesheet was raw Tailwind
  greys); ghost/primary button hierarchy (one filled button per view — the commit action); full
  hover/active/disabled/focus-visible states incl. radios and checkboxes; focus restored across
  re-renders; a polite live region announces scan results, links, removals and errors; checklist
  gains a count line and scroll shadows; copy cut from ~120 words of preamble to one line per
  section; quiet centred empty states.

Sibling widget stylesheets (bulk-remove, retired-codes) still carry the old raw-hex palette —
deferred to their own pass so this one stays reviewable.

## [v3.217.0] — 2026-08-03

### Nest problems: in-panel "Merge duplicate copies"

Same-code duplicate problems (the case the nesting suggestion engine deliberately refuses to pair)
get their own section in the "Nest problems?" panel: each group of 2+ active problems sharing one
conceptId is offered as a merge — pick the copy to KEEP (default: the earliest, by UUIDv7 id — the
Duplicate Problem Checker's own convention), review an explicit KEEPING / REMOVING confirm with an
editable per-group reason, and the other copies are retired through the checker's confirmed
`mark-incorrect-and-hidden` contract (`{problemId, reason, isConfirmedRemoval: true}`).

Guardrails: a copy with nested children is never removable here (its children would dangle — the
full Duplicate Checker or Medicus itself is pointed at instead); a copy carrying additional info is
cautioned (removal loses it; compare in the checker first); a blank reason never reaches the record
(button state AND payload builder both refuse); removals are sequential with per-copy errors and
retry; one ledger record per batch (fixed label, batch-local count). The confirm states the real
consequence plainly: copies are hidden as recorded-in-error, not end-dated, and no undo endpoint is
known. Merged-away copies retire live from the suggestion cards, the manual builder, and the link
map. Same-code-only by design — anything fuzzier stays in the full Duplicate Problem Checker.

## [v3.216.0] — 2026-08-03

### Nest problems: manual builder goes parent-first and multi-child

Feedback on v3.215.0 within the hour: several problems usually belong under one "title" problem,
and one-pair-at-a-time was too slow. The "Link manually" section is now parent-first — choose the
parent, tick every problem to nest under it (a scrollable checklist replaces the child dropdown),
and confirm the whole batch once, with every child listed by name and a count of any that will be
MOVED from an existing parent.

The write path is unchanged and deliberately so: one confirmed `update-parent-problem` POST per
child, committed sequentially — never `update-child-problems` (the full-replace trap). Each child
re-passes the commit-time cycle guard individually; a failed link records its error against its own
row and stays ticked for retry while the rest of the batch carries on. Per-child annotations in the
checklist ("currently under X — will move", "same code as the parent — duplicate?") replace the old
confirm-step notes.

## [v3.215.0] — 2026-08-03

### Nest problems: manual "Link manually" builder

First-use feedback on v3.214.0 (a real record with several Anorexia nervosa / Eating disorder /
Bradycardia entries): the SNOMED-ancestry suggestions only catch strict terminology descendants,
but the clinician often knows the clinical hierarchy the terminology doesn't state — e.g. anorexia
nervosa as the parent of its bradycardia and safeguarding entries. New "Link manually" section in
the same widget: pick any problem to nest, pick its parent, same per-link explicit confirm, same
confirmed `update-parent-problem` write path and event-ledger audit.

Deliberately looser than the suggestion engine — no SNOMED gate, same-code pairs allowed (with a
confirm-step pointer to the Duplicate Problem Checker, since nesting keeps both entries active),
and re-parenting allowed (the confirm calls out that it MOVES the problem from its current parent).
The cycle guard is the one rule that stays hard, at render and commit time, because it protects
the record's structure rather than second-guessing a clinical judgement. A suggestion card whose
child gets manually linked retires itself.

## [v3.214.0] — 2026-08-03

### New: "Nest problems?" — suggested parent/child links on the Clinical Summary

Related problems often sit flat next to each other ("Insertion of coronary artery stent" beside
"Percutaneous balloon coronary angioplasty") when Medicus can nest one under the other as a child
problem — but Medicus's own UI is one manual slideover per link. New "Nest problems?" trigger on
the problem list (`content-scripts/problem-nesting.js`, sharing the Major-heading row with "Bulk
remove?" and the retired-codes check) scans the active problems and suggests child→parent pairs,
each confirmed individually. Works on both the care-record page and the task ("split") page.

Built on the contract captured live 2026-08-03 (`scripts/problem-nesting-capture.js` run on a test
record — full write-up in `docs/learnings-problem-nesting-api.md`):

- **Write path**: `POST /clinical/problem/update-parent-problem` `{patientId, problemId,
  parentProblemId}` — exactly three fields, confirmed 200. The parent-side sibling
  (`update-child-problems`) is deliberately NOT used: its `childProblemsToAdd` array is a **full
  replace** of the child set despite the name (the captured Vue form seeds it with the existing
  children), so posting one id to a parent that already has children would silently unlink the
  others.
- **Suggestion model**: a pair is offered only when the child's conceptId is a genuine SNOMED
  descendant of another on-record problem's conceptId (the same confirmed constrained-search
  mechanism as the bulk-remove badge scan). Identical concepts never pair (that's a duplicate, not
  a hierarchy), and a problem that already has a parent is never re-parented by suggestion. The
  widget never invents codes and never links anything automatically.
- **Safety posture**: per-pair explicit confirm with both problems echoed back by name (nesting
  visually demotes a problem on the list — a wrong link is a visibility change on the live record);
  cycle guard at render time AND re-checked at commit time against the live link map; failed POSTs
  surface the server's message per card; every committed link recorded in the Clinical Event Ledger
  (patient UUID + fixed label only); no auto-reload — "Refresh page" offered instead. Unlink is not
  offered (the null-parent shape is inferred from the Vue form but has never been captured live).

## [v3.213.1] — 2026-08-03

### Dev tooling: problem parent/child ("nesting") contract capture script

`scripts/problem-nesting-capture.js` — paste-into-page-console instrumentation (adapted from
`booking-flow-capture.js`: same fetch/XHR wrap, PII redaction, dialog inventory) for capturing how
Medicus creates/changes a problem parent-child link, which the repo has never captured (the
confirmed `edit-problem` POST carries no parent field; only `end-problem`'s `activeChildProblems[]`
read side is known). Adds an active read probe (`chNest.probe()`) that maps the record's existing
parent→child links and reports every hierarchy-smelling field across `end-problem`,
`slideover/overview` and `edit-problem` per problem, working on both the care-record and task
("split") page shapes. Groundwork for a future "nest related problems" widget — no shipped
behaviour changes.

## [v3.213.0] — 2026-08-03

### Problem "Bulk remove?" + "Clean up allergies?" now work on the task ("split") page

Both record-tidy widgets previously only activated on the full care-record Clinical Summary page —
their URL detection required the patientId in the path. The task-overview page (e.g. a Patient
Request with the embedded Clinical Summary panel on the right) renders the same problem list and
Allergies card, so both widgets now run there too:

- **URL detection** recognises the task-overview shape
  (`/{siteId}/tasks/data/{typeSlug}/overview/{taskUuid}`) alongside the care-record shape. Both
  parsers are pure helpers with unit tests (`parseCareRecordPath` / `parseTaskOverviewPath`).
- **Patient resolution**: the task URL carries no patientId, so it's resolved once per task via the
  same `/tasks/data/{slug}/overview/{uuid}` endpoint task-inline.js/booking-inline.js already drive,
  with the same field-fallback chain. Cached per taskUuid: a resolved task (including a genuinely
  patientless one) is never refetched, while a transient fetch failure stays uncached so the
  throttled rescan retries. The uuid keying + a post-await URL re-check mean a resolve that lands
  after navigating to a different task is always discarded — the cross-patient-async discipline from
  the v3.212.1 epoch fixes carries over unchanged.
- **Everything downstream is untouched**: the same clinical-summary fetch, scan, checklists, modals,
  two-step confirms and fail-closed DOM anchoring run against the resolved patient. If the split
  page's embedded panel ever renders rows differently, the widgets simply don't inject (allergies)
  or fall back to the panel checklist (problems) — no wrong-row action is possible.
- The problems widget's Clinical Event Ledger entry now records the resolved patient on both page
  shapes (it previously re-read the URL, which would have been empty on the split page).

Not included (same pattern available if wanted): the "Check for retired/legacy codes?" widget
(problem-description-cleanup.js) is still care-record-only.

## [v3.212.1] — 2026-08-02

### Allergy cleanup suite: pre-merge review fixes (PR #253)

Fixes from the pre-merge review of v3.212.0 (code review + Virtual Dave CSO pass), all landed on the same
PR before the feature ever shipped:

- **Cross-patient async state (critical).** A scan or allergy-list fetch started on patient A could
  resolve after SPA-navigation to patient B and repopulate B's freshly-reset widget state with A's
  allergy IDs — every destructive action would then target A's records from B's screen. All async flows
  now capture a per-patient epoch (bumped on every patient change) and discard their results if it moved;
  an open review modal is closed on patient change too.
- **Dual-coded clearing could delete the substance it promised never to touch (major).** The checklist
  flags entries from the OVERVIEW's `allergyCodeType` but built its payload from the EDIT-FORM prefill's —
  and for a prefill showing `pre-defined-allergies` (or nothing), the old "symmetric" branch cleared the
  dm+d SUBSTANCE and kept the legacy code, the exact opposite of the section's own promise. Now: only
  substances-authoritative entries are flagged at all (pre-defined-authoritative dual-coded entries fall
  through to the conversion flow, which handles them with a per-entry modal), and the payload builder
  throws (no write, surfaced as a per-row error) unless the prefill itself confirms the substance is
  authoritative.
- **Merge keeper race (major).** The keeper radios stayed clickable while a merge save was in flight, and
  `confirmMerge` re-read `st.keeperId` after each await — a mid-save click could POST the old keeper's
  prefill onto the NEW keeper's record and then end the old keeper. All merge inputs (keeper, field
  choices, end date, free text) are now snapshotted before the first await.
- **Background regrouping vs open reviews (major).** Concept-ancestry enrichment replaces the duplicate
  groups array after the scan is done, but per-group review state (and the open modal) were keyed by
  index — groups could shift/merge underneath them, wedging the modal or silently showing one group's
  cards over another's index. Review state is now remapped by group identity (entry-id set); an open
  modal follows its group to the new index or closes if the group was merged away. Covered by new
  `remapReviewsByGroupIdentity` tests.
- **"No known allergies" is a positive clinical assertion, not junk** (Virtual Dave must-fix). A coded NKA
  entry records "asked, answer nil" — clinically different from an empty list ("never asked"), and it's
  what goes out on GP2GP. It now carries a per-code caution (excluded from "Select all", every removal an
  individual decision) steering to de-duplication — remove surplus copies, keep one, never delete to zero.
- **"H/O: non-drug allergy" recategorised import-artefact → too-generic** (Virtual Dave must-fix). Its
  SNOMED semantics are a positive "has a history of non-drug allergy" finding — possibly the only trace of
  a real latex/bee-sting allergy — so it now gets the too-generic per-instance caution protection instead
  of the bulk-safe import-artefact class.
- **Five salt-ambiguous conversion suggestions demoted to not-convertible** (Virtual Dave must-fix — the
  suggestion is PRE-selected in the conversion modal, one Convert click from committing). dm+d keeps
  depot esters as their own VTMs distinct from oral salts, and perindopril as two salt VTMs with no
  neutral parent: flupentixol decanoate (was → dihydrochloride), fluphenazine decanoate and enanthate
  (were → hydrochloride), and both perindopril codes (were → erbumine; an ACE-inhibitor pseudoallergy is a
  class effect, so an erbumine-only record would not alert on a perindopril-arginine prescription). Each
  now falls to manual live search with an explanatory note shown in the modal, and a test pins all five.
- **Count-naming confirmations on both bulk actions** ("End N selected allergies…?" / "Remove the stale
  legacy code from N…?", Cancel default) — the irreversible bulk-end previously fired on a single click
  while the lower-risk OIR select-all already had a confirm.
- **Safety documentation** (Virtual Dave must-fix): `docs/CLINICAL-SAFETY-NOTICE.md` §6.1 gains row
  **W13** (the suite's first allergy-list write surface, with its controls) and `docs/HAZARD-LOG.md` gains
  **H-060** (allergy record ended/merged/re-coded in error; initial 4×3=12, residual 4×1=4, proposed —
  pending CSO sign-off on the PR). A data-invariant test now pins every low-prescribing-relevance junk
  entry to carrying a per-code caution (the "Select all" exclusion keys on the caution's presence).

Known limitation carried forward (deliberate, safe-failure): a duplicate merge whose chosen onset date is
a partial date (e.g. "Jul 2012") is rejected by Medicus with a 400 before anything is ended — the keeper
is untouched and the error is shown; partial-date normalisation is left until the accepted payload shape
has been confirmed live.

## [v3.212.0] — 2026-08-02

### Allergy cleanup suite: junk removal, duplicate merge, dual-coded cleanup, and pre-defined-allergy → substance conversion

New "Clean up allergies?" trigger, one shared `overview-allergy` fetch per active allergy feeding four
independent review sections in one summary panel, each with its own safety model:

- **Junk / low-relevance codes** — bulk checklist (no clinical judgement needed to remove confirmed
  import noise), reusing `rules/allergy-junk-codes.json`'s three categories: `import-artefact`,
  `too-generic`, and a new `low-prescribing-relevance` category (e.g. 300910009 "Allergy to pollen" —
  a genuine, correctly-coded allergy that's simply near-zero relevance to prescribing safety; carries a
  static per-code caution, "This code indicates hay fever, so may be more appropriate as a problem code
  rather than an allergy", shown instead of — never concatenated with — the generic per-instance caution
  message).
- **Possible duplicates** — mandatory per-group review modal (a merge always "warrants a conscious
  clinical decision"); the button shows a free duplicate count from a zero-cost text-only pass before any
  click, with the expensive part (junk-code matching, SNOMED concept-ancestry duplicate enrichment)
  staying click-triggered. Every card in the review modal has a "Remove from merge" checkbox that
  excludes it from the current review immediately — untouched, never ended or modified — with an undo
  affordance ("N removed from this merge: ... (Restore)"); the keeper and any chosen field values are
  re-derived from whatever remains. Removing the card backing the free-text "additional info" box
  re-seeds it from the new default source, same as a manual radio click, but only while the box still
  shows exactly what it was last loaded from — genuine typed edits are never overwritten.
- **Legacy code alongside substance** — bulk checklist for dual-coded entries: a real GP2GP-imported
  entry can carry BOTH `allergyCode` (a legacy pre-defined-allergy code) AND `substance` (an
  already-authoritative dm+d code) simultaneously, with `allergyCodeType` saying which is actually
  current (confirmed via a live HAR capture, not hypothetical). Clearing the non-authoritative field
  never touches any clinical fact or the already-correct code, so it's the same safety class as junk
  removal. This also exposed and fixed a latent bug in `resolveAllergyConceptId`, which always preferred
  `allergyCode` whenever populated — silently returning the stale legacy code for a dual-coded entry
  instead of its real current substance, which would have broken junk-matching and duplicate-grouping
  against it.
- **Pre-defined-allergy codes** ("Convert?") — the third stage of the suite: converting legacy
  "pre-defined-allergies"-coded entries (e.g. "Amoxicillin allergy") to proper dm+d substance-coded
  entries, the format genuine drug allergies need for reliable prescribing-safety checks. Each entry gets
  a substance search (dm+d refset scope) pre-seeded with a suggestion from a new
  `rules/allergy-substance-conversion.json` (314 reviewed legacy conceptIds: straight substance
  conversions, substance-plus-reaction decompositions e.g. "Chloroquine retinopathy" → substance
  Chloroquine + reaction hint "retinopathy", entries with no dm+d code available, and miscoded
  non-allergies flagged for removal instead) when one exists, or from a pattern-recognition fallback
  (`X-induced Y`, `Allergy/Hypersensitivity/Adverse reaction to X`, `X allergy/reaction/hypersensitivity`)
  applied to the code's own description when it doesn't — search-seed only, never auto-selects a
  concept. Live search results are reordered (never discarded) toward VTM-level, non-dose/brand-specific
  candidates, since a live "iodine" search returns the correct candidate but not first, buried among
  salt/dose-specific siblings. Reaction picking is multi-select (each pick its own removable chip),
  seeded in priority order from a curated rule hint, a pattern-extracted hint, or the entry's own
  `additionalInformation` as a last resort. Severity/certainty/additional info/existing reactions/onset/
  record date are always carried through unchanged and shown in full before the search boxes — conversion
  changes only code identity, never clinical fields, the deliberate opposite invariant to the merge
  stage's own payload builder (which never changes code identity). Every conversion is an explicit
  confirm, never apply-on-click.

`rules/non-problem-root-codes.json` (now 27 roots): 6 new administrative/import-artefact roots —
261665006 "Unknown", 33879002 "Vaccination", 127785005 "Imported immunisations", 171302002 "Adult
screening", 268481000 "Child health checks", 416608005 "Previously active medications imported via
GP2GP" — read by the existing `problem-bulk-end.js`, no code change needed.

## [v3.211.0] — 2026-08-02

### Rota Manager is now part of the suite

The **Medicus Rota Manager** — until now a separate Chrome extension
(`davetriska02-collab/medicus-rota-manager`, last released standalone at v1.10.0)
— is subsumed into Medicus Suite. Practices no longer install and update two
extensions, and the rota shares the suite's backup, settings and navigation.

**The standalone repository is deprecated.** It receives no further releases; all
rota development happens here, under `rota/`.

#### The code (landed previously in the port commit)

`rota/` is a self-contained ESM subtree with its own `package.json`
(`"type": "module"`): `rota/engine/` (pure rules — `rules.js`, `leave.js`,
`cover.js`, `solver.js`, `fairness.js`, `bradford.js`, `demand.js`, `swaps.js`
and the rest; no DOM, no `chrome.*`, no `fetch`), `rota/shared/`
(`store.js`, `time.js`, `model.js`, `esc.js`, `medicus-api.js`) and `rota/app/`
(the full application shell and its views). Its 17 `test-rota-*.js` suites run
in the suite's CI on every push.

#### Two ways in

- **Rota manager** (`rota-app`) — a **panel-only** nav tab that opens the full
  application in a new browser tab, exactly like Visualiser. `side-panel/panel.js`
  special-cases it in the nav click handler and excludes it from the
  Ctrl/Cmd+Alt+Arrow tab cycle; it is deliberately absent from `MODULES`, so the
  boot guard will never try to restore the panel into it. Opening is
  focus-or-create — `side-panel/modules/rota/rota-open.js` raises an existing
  rota tab (and its window) instead of stacking duplicates. The same helper backs
  the command palette's *Open Rota manager* command, which is how the pop-out —
  which has no `rota-app` tab — reaches the full app.
- **Rota** (`rota`) — a compact module in **both** shells
  (`side-panel/modules/rota/rota.js` + `.css`, registered in `panel.js` and
  `pop-out/pop-out.js`). It reads the eight `rota.*` keys straight from
  `chrome.storage.local`, runs the pure engine (`checkWeek`, `capacitySummary`,
  `approvedLeaveFor`) over them and shows: duty cover for today AM/PM with an
  OK/Gap state, who is on approved leave today, upcoming sessions still needing
  cover, this week's high-severity safe-staffing warnings, and estimated GP
  appointments against the ~72-per-1,000 benchmark — plus an *Open full rota*
  button. Before any staff exist it shows a short pitch and a single button into
  the full app. It refreshes on `chrome.storage.onChanged` for `rota.*` and polls
  once a minute so the date rolls over on a panel left open overnight. No network
  I/O, and no patient-identifiable data is read or persisted.

Both entries are described in `side-panel/tab-catalog.js` (and added to the
practice-manager preset), carry `TAB_HELP` copy in `panel.js`/`pop-out.js`, and
are recorded in `test-tour-steps.js`'s `NAV_COVERED_BY_OVERVIEW` — the guided
tour teaches them via the nav overview rather than dedicated steps.

#### Backups

All eight rota keys — `rota.staff`, `rota.entries`, `rota.leave`, `rota.rooms`,
`rota.swaps`, `rota.audit`, `rota.demand`, `rota.settings` — are covered by
`shared/io/rota-io.js` and the suite envelope, so a suite backup now carries the
whole rota. `test-rota-store.js` asserts set-equality between that key list and
`rota/shared/store.js`'s own `KEYS`, so a new rota key cannot silently escape.

#### An unavailable check now says so

The compact module used to swallow any rules-engine exception, leaving the
warnings list empty — which rendered as a green *"High-priority warnings this
week — None."* A crash was being shown as a clean bill of health. (It was
reachable: a `rota.settings` with a null `openDays` survives backup validation,
beats the shipped default in the `{ ...DEFAULT_SETTINGS, ...stored }` merge, and
then makes `rules.js` throw.)

It now tracks the failure and shows an **amber** *"Safe-staffing checks
unavailable — open the full rota to investigate"* card instead. Nothing else on
the panel asserts a positive state off that failed computation either: the duty
pills degrade from green **OK** to a neutral **Unchecked**, and *"Sessions
needing cover — None outstanding"* becomes *"Not verified — check the full
rota"*. A **Gap** is still shown in red — withdrawing reassurance must never
hide a problem. `rota/shared/store.js` additionally coerces the settings members
the engine dereferences (`openDays`, `bankHolidays`, `sites`, `peakPeriods`)
back to their defaults when a stored value is not an array.

#### Shared-folder sync is now validated before it is saved

The shared-drive sync file lives in a folder anyone with practice-share access
can write, is re-read every 15 seconds and is last-writer-wins — yet it was
being saved to storage **verbatim**, while the cold backup-restore path
type-checked everything. New pure module `rota/engine/validate.js`
(`validateRotaScopes`, returns a rejects list) type-checks all eight `rota.*`
scopes, and `rota/app/app.js` calls it **before writing anything**. A malformed
document is **refused whole** — no half-applied rota — the local copy is left
untouched, and the rejection is surfaced both as the usual sync toast and as a
sticky banner in Settings naming the version, the author and the reasons (a
pulled version is only ever returned once, so a 3-second toast could otherwise
be the only notice).

`shared/io/rota-io.js` keeps its own checks (it is a classic script and cannot
import an ES module) and gains the matching `rota.settings` shape checks. New
`test-rota-validate.js` feeds identical malformed fixtures to **both**
validators and asserts they agree, so the two copies cannot drift apart.
`test-rota-store.js` now also parses `SYNC_SCOPES` out of `rota/app/app.js` —
the third parallel copy of the eight keys — and asserts set-equality with the
other two.

#### Clearer names for the two rota tabs

Two adjacent tabs called *Rota* and *Rota status*, both with near-identical
calendar icons, were a daily misclick — and one of them silently opens a new
browser tab. The compact in-panel module is now simply **Rota**; the full-app
opener is **Rota manager** and carries an arrow-out-of-box glyph instead of a
second calendar, with an "opens in a new tab" aria-label. The compact module's
*Open full rota →* button gained a muted *"Opens in a new tab"* hint underneath.
Tab ids (`rota`, `rota-app`) are unchanged, so stored tab order and visibility
preferences carry over.

#### Safety documentation

`docs/HAZARD-LOG.md` gains a §2 scope bullet for the rota surface and two
hazards — **H-058** (staffing decision taken on a stale or degraded rota status
panel) and **H-059** (malformed shared-drive sync data corrupts rota state) —
recorded as a v3.22 addendum, not a re-baseline. `docs/DPIA.md` (v1.2) records
the rota's employee data as a distinct processing purpose, including UK GDPR
**Article 9 special-category staff health data** (sickness, fit-note flags,
Bradford Factor scores, parental leave) and the optional shared-drive
replication of it, with the lawful basis, mitigations and the practice's
responsibilities as employer. `docs/INTENDED-PURPOSE.md` adds the rota to the
module table, the frozen statement, the "what this is not" list and the intended
user.

> **Scope note:** the rota's safe-staffing rules encode BMA/CQC/NHSE *guidance*,
> not law. They warn; they never block. Thresholds are practice settings, not
> constants.

## [v3.210.0] — 2026-08-01

### Contacts Management follow-ups: NOK/CC drag-flagging, name derivations, remove-from-tree (PR #250)

Merges Nick's follow-up branch (developed as internal v3.208.2–v3.208.7; renumbered — that
range was passed on main). All live-tested against real data. Original per-session entries
below, followed by the pre-merge review fixes applied on merge.

Review fixes applied on merge (two independent pre-merge reviews, engine findings
verified by execution; 111 new red-first regression assertions — `test-name-derivations.js`
48→110, `test-contact-match.js` 62→111):

- **Wrong-record flag write via event bubbling** — the NOK/copy-correspondence drop
  handlers now stop propagation and the slot-zone fallback yields to cards, so a token
  dropped on a grandparent card no longer *also* writes the flag to the enclosing
  parent's relationship (a different patient's record, silently). Nearest zone wins.
- **Remove-from-tree is now confirmed and repairable** — the drag no longer silently
  overwrites both relationship records to "Family member": an explicit confirm states
  the two-record consequence first, and the re-drop repair path actually reaches the
  reciprocal for pre-existing links (downgrade marker + placeholder-text detection
  drive `reciprocalUpdateId`, with a bounded id re-resolve and an honest summary when
  the reverse half can't be repaired). The partial-failure message now says which side
  landed.
- **Resumable-retry regression fixed** — after a successful reciprocal *update* plus a
  failed cleanup step, retry re-entered the reverse-*create* branch (duplicate
  relationship on the off-screen record, or a wedged retry). Branching now follows the
  operation's shape (`reciprocalUpdateId` presence).
- **Stale drag payload** — a cancelled token drag no longer leaves a live payload that
  a later foreign drop could turn into a flag write (`dragend` reset + drops validate
  the event's own `dataTransfer` payload).
- **Cross-write interleave guard** (`anyWriteInFlight()`) — a flag write and a confirm
  on the same record can no longer interleave their read-modify-write sequences; the
  refresh control now honours the unfinished-merge guard; a no-op flag drop no longer
  dismisses an unrelated success panel.
- **Name-derivation false positives closed** — the gendered-surname prefix fallback
  requires a recognised counterpart ending per language family (disabled for
  Polish/East-Slavic where both forms always carry a suffix), `-in`/`-ina` needs a
  5+ character stem, and derivations apply only to the surname-position token:
  Martin/Martina Brown drops from 85 "strong" to 38 "weak", Colin/Collins,
  Griffin/Griffiths, George/Georgina etc. all abstain, while Kowalski/Kowalska,
  Nováková/Novák, Ivanov/Ivanova and the Lithuanian forms still match.
- **Patronymic father bonus hardened** — capped at 0.9 (never above an exact match),
  clamped below "strong" without corroboration (address/phone/email/textual name),
  never fires for a recorded-female candidate, 3-character stems only when
  consonant-final (Crosson/Classon abstain; Jónsson/Persson/Ivanovich still derive),
  and the signal carries `derivation`/`corroborated` labels for the UI.
- **Accent handling actually works now** — fold-equality in token comparison
  (Nováková vs Novakova and Müller vs Muller score 1.0 instead of 0.33 — the module's
  own headline GP2GP case) and `normaliseName` normalises to NFC first (decomposed
  input was still being shredded).

### (internal v3.208.7) — 2026-08-01

#### Contacts Management — a write error could go completely invisible

Live-test report: after v3.208.6's fix, a removed relative still showed the old relationship text
("Brother") with no visible sign anything had gone wrong. Root cause, found by tracing
`renderConfirmPanel`'s own render order rather than guessing: that function checks `cs.doneSummary`
FIRST, unconditionally, before ever looking at `cs.workingError` — so if an earlier confirm this
session left `doneSummary` set (the normal "done" success panel), a completely unrelated LATER
action's error would be set correctly in `workingError` but never actually rendered, silently
masked behind the stale success panel. `tryAssign` (drag-to-a-slot) already knew to clear
`doneSummary`/`reverseManualMatch`/`reverseManualMatchError` at its own start for exactly this
reason — `setContactFlag` and `removeCardFromTree` never got the same treatment, so any Medicus
write failure in either was invisible whenever a prior confirm this session had left a done panel
showing. Both now clear the same three fields at their own start, matching `tryAssign`'s
established pattern.

### (internal v3.208.6) — 2026-08-01

#### Contacts Management — remove-from-tree downgrade wasn't actually firing

Live-test bug report: v3.208.5's "downgrade the reciprocal to Family member on removal" didn't
change either the hub patient's or the relative's own record. Root cause: the previous build only
downgraded the RECIPROCAL side, and only when `reciprocalRelationshipId` had already been cached
from a same-session fresh link creation — the far more common real case (an already-linked contact
dropped in the wrong slot) never created a fresh reverse link this session at all, so nothing was
ever cached and the whole block was skipped silently.

- `removeCardFromTree` now downgrades BOTH sides. Forward (`lc.relationshipId`, known for
  essentially any placed card — set at page-load for a pre-existing link, or resolved by a bounded
  follow-up fetch for one created this session) and reciprocal (resolved ON DEMAND at removal time
  if not already cached, rather than only ever being learned from a same-session write) both get
  their relationship text overwritten to "Family member" via the same full-replace
  `changePatientContact` pattern used everywhere else in this canvas.
- New shared `updateRelationshipText(apiBase, relationshipId, targetLink, relationshipText)` —
  extracted rather than tripling the GET-then-full-replace-POST body construction inline a third
  time (setContactFlag's own copy is left alone — different semantics, changes NOK/CC not text).
- The forward downgrade also updates the card's own local `baseId`/`modifierId`/`relationshipText`/
  `colour` in place — since "Family member" doesn't parse to any recognised relationship,
  `relationshipKnown` correctly becomes false afterward, so a later re-drop shows the picker again
  rather than silently reapplying the old (removed) classification.

### (internal v3.208.5) — 2026-08-01

#### Contacts Management — remove-from-tree follow-up: styling, reciprocal cleanup, refresh

Live-test follow-up to v3.208.4's remove-from-tree feature, three asks.

- **Styling**: `.ms-cv-remove-zone` restyled to match the tree's own "Drop here" boxes — sized like
  a single tree-branch-item (150-240px) rather than a full-width bar, dashed border, centred
  italic text — kept red-tinted as agreed. Label shortened to fit the smaller box ("Drop here to
  remove from tree"), fuller reassurance ("their link isn't deleted...") moved to a hover tooltip.
- **Reciprocal relationship handling on removal**: clarified with the user that "remove the
  reciprocal relationship we just wrote back" meant overwriting its relationship TEXT with a
  generic placeholder ("Family member") — NOT deleting the relationship record, and NOT
  unmerging back to a manual contact. `removeCardFromTree` is now async: when a reverse link was
  created THIS session as part of confirming the card into its (wrong) slot, dragging it to the
  remove zone also does a real Medicus write, overwriting the reciprocal's relationship text via
  `changePatientContact` (same full-replace discipline as every other write here — every
  manual-contact-only field null, `isNextOfKin`/`notes`/`copyCorrespondence` preserved from a fresh
  GET). Deliberately scoped to only a reciprocal written THIS session
  (`linkedCards[].reciprocalRelationshipId`, resolved via a bounded follow-up fetch of the
  candidate's own record after `performLinkAndCleanup` reports a fresh reverse link) — an older,
  pre-existing reciprocal that predates this canvas session is never touched by a plain removal.
  New busy-state `cs.reciprocalDowngrading` (Set, same pattern as `phoneDeleting`/`flagUpdating`);
  a failure here surfaces a clear error but still completes the local unplace.
- **Redrop correction now also fixes the reciprocal, not just the forward relationship**: without
  this, a corrected re-drop after a removal would have tried a fresh `linkPatient` create for the
  reverse direction — which Medicus rejects as a duplicate, since the relationship record still
  exists (just retitled), not deleted. New `reciprocalUpdateId` param on
  `performLinkAndCleanup`/`changePatientContact`, mirroring the existing forward-side
  `relationshipUpdateId` mechanism exactly: when this canvas already knows the reciprocal's own id,
  route the correction through an update-in-place instead of a doomed-to-collide create.
  `describeLinkProgress`'s resumable-retry step list updated to match (also fixes a smaller,
  separately-introduced bug: its `relationshipUpdate` step's `applies` condition had gone stale
  after v3.208.4's `relationshipUpdateId` fix and no longer matched the real trigger condition).
- **Explicit "Refresh page" header button**, next to Close — every write this canvas makes only
  ever updates local state; Close already reloads too, but only once you're done and have gone
  through the unfinished-merge check, so this gives an always-reachable way to check Medicus's own
  contacts card reflects a change without leaving the canvas.

### (internal v3.208.4) — 2026-08-01

#### Contacts Management — remove a card dropped in the wrong slot

Asked for, live: no way to undo a card dragged into the wrong tree slot by mistake. Confirmed with
the user first that the common case is "wrong slot, right person" (re-classify, keep the link),
not "wrong person entirely" (undo the link) — scoped accordingly.

- New dedicated "drag here to remove" drop zone (`renderRemoveZone`) above the tree. Dragging any
  locked/tree-placed card onto it calls `removeCardFromTree`, which reuses `engine/contact-tree.js`'s
  existing `removeFromSlot` primitive (already built, already tested, just never wired to any UI) —
  LOCAL ONLY, no Medicus write, no confirmation dialog needed for the same reason. The card
  disappears from its slot and reappears in "Not yet placed in the family tree", draggable again
  through the normal path.
- `cardHtml`: a locked card is now draggable again, but only for this purpose — a NEW payload
  shape (`{removeCardId}`), distinct from the existing card-to-card merge (`{id, kind}`) and
  flag-token (`{flagKind}`) shapes, gated specifically on `kind === 'linked'` so a merged/blank
  manual card (nothing to "remove from the tree" — it was never placed there) never becomes a
  spurious drag source. Every existing merge/slot/flag drop handler now explicitly ignores this
  new shape rather than falling through to `tryMerge`/`tryAssign` with undefined arguments.
- **Two real correctness bugs found and fixed while making this actually work**, both specifically
  about re-classifying an ALREADY-recognised relationship (as opposed to setting one for the first
  time), which this remove-and-redrop flow is the first thing to ever exercise live:
  - `doCanvasConfirm`'s `relationshipUpdateId` (the flag that tells `performLinkAndCleanup` to
    write a corrected relationship label back to Medicus) only ever fired when the ORIGINAL text
    was unrecognised. A slot-drop correcting an already-recognised-but-wrong classification (e.g.
    dropped on Siblings by mistake, corrected to Children) silently updated the local tree display
    only — Medicus's own record kept the wrong label indefinitely. Fixed: `buildConfirmForCard` now
    also returns `originalBaseId`/`originalModifierId` (what's actually on record, captured before
    any slot-override), and the write fires whenever the final baseId/modifierId differs from
    those, not just when nothing was known to begin with.
  - Separately, the locked tree label was being re-derived from `existingForwardLink`'s own
    `patientContactRelationship` text — a load-time snapshot, never refreshed after a write made
    THIS session — which would silently revert a just-written correction back to the stale
    pre-write text on screen. Removed; the locked label now always trusts `st.confirm.baseId`/
    `modifierId` directly, which already reflects whatever was correct and whatever was just
    written.
  - Also: an already-linked card being re-classified previously never updated its own
    `cs.linkedCards` entry at all (only a brand-new link got pushed) — badges and future
    `isPlacedInTree`/`bestManualMatchFor` checks would have kept showing the stale relationship.
    Now updates `baseId`/`modifierId`/`relationshipText`/`colour` in place.
  - `buildConfirmForCard`'s `existingForwardLink` lookup also only ever checked the load-time
    snapshot — missing a card linked earlier THIS session (the exact card most likely to get
    removed-and-redropped moments after the original mis-drop). Now falls back to constructing an
    equivalent object from `cs.linkedCards`' own resolved `relationshipId` when the snapshot
    doesn't have it, so the correction write-back works for a same-session mistake too, not only a
    pre-existing one.
- New CSS `.ms-cv-remove-zone`, red-tinted to read as distinct from the purple flag-tokens strip
  immediately above it.

### (internal v3.208.3) — 2026-08-01

#### Contacts Management — non-British name-derivation matching

`engine/contact-match.js`'s candidate scoring assumed a British same-surname family model
throughout — this adds two things it was getting wrong for non-British naming systems, plus a
prerequisite bug fix those systems exposed.

- **Prerequisite fix**: `normaliseName`'s token regex was ASCII-only (`[^a-z0-9\s-]`), silently
  treating every accented character as a token separator — "Björn Nováková" became "bj rn nov
  kov" before any comparison ever ran. Widened to Unicode-letter-aware (`\p{L}\p{N}`, `u` flag);
  `.toLowerCase()` was already Unicode-correct. No change for plain-ASCII names or existing
  punctuation-folding behaviour (apostrophes, etc.).
- **New `engine/name-derivations.js`** (dual Node/browser, own test file
  `test-name-derivations.js`, 48 checks):
  - **Gendered Balto-Slavic surnames** — `isGenderedSurnameMatch` recognises Polish Kowalski/
    Kowalska, Czech/Slovak Novák/Nováková and Novotný/Novotná, Russian/Bulgarian Ivanov/Ivanova,
    and Lithuanian's genuinely three-way system (a married woman always takes -ienė regardless of
    her own name's ending; an unmarried daughter's suffix depends on her father's own ending) as
    the same family surname, not a mismatch. Wired into `contact-match.js`'s `nameSimilarity`
    (both the Jaccard token-overlap and whole-token-containment paths) via a `tokensMatch` helper
    used everywhere two name tokens are compared.
  - **Patronymic extraction** — `extractPatronymicFather` derives a father's own first name
    directly from a name that structurally encodes it: Icelandic surnames (Björnsson/
    Björnsdóttir — "Björn's son/daughter") and Russian-style patronymic middle names (Ivanovich/
    Ivanovna — "son/daughter of Ivan"). Wired into `scoreCandidate` as a new opt
    `indexPatientName`: when the relationship being guessed is specifically `'father'` (patronymics
    encode the father's name, never the mother's, in either system), the index patient's own name
    is checked for a patronymic pattern and, if found, the derived first name is compared against
    the candidate's own first name — a positive-only bonus folded into the existing `nameSignal`
    via `Math.max`, never lowering a score. Threaded through from `contacts-canvas.js`'s main
    `rankCandidates` call site as `st.indexPatientDetails.displayName`.
  - **Collision safety was the dominant design constraint throughout**, since this UK GP tool
    matches overwhelmingly-British names by default: bare single-s Nordic "-son" is deliberately
    NEVER stripped (Wilson/Johnson/Jackson/Robinson/Anderson are ordinary inherited English
    surnames, not fresh per-generation patronymics) — only the doubled-s "-sson" genitive form,
    which is the REGULAR Icelandic pattern and essentially never occurs in English surnames. Bare
    Lithuanian male endings (-as/-is/-ys) are never stripped as standalone suffixes for the same
    reason (Lewis, Douglas, Curtis, Rhys...) — only reached as the unstripped remainder in a
    prefix-fallback check against an already-stripped female form. The two single-character Czech
    adjectival markers (ý/á) are accent-strict — folded to ASCII they'd become the extremely common
    English letters "y"/"a" — while every other suffix folds diacritics before matching, since
    GP2GP imports and hand-typed manual contacts routinely drop them.
  - Extended `test-contact-match.js` (new section 8) with integration coverage: a gendered pair
    scoring as a match, a patronymic bonus raising a father candidate's score, confirmation the
    bonus never fires for `'mother'`, and the key negative case — an ordinary English family's
    inherited "-son" surname never triggering a spurious bonus even when a first name would
    coincidentally line up.
- Registered `engine/name-derivations.js` in `manifest.json`'s contacts `content_scripts` block,
  before `contact-match.js` (browser-global load order, same pattern as
  `contact-relationships.js`).

### (internal v3.208.2) — 2026-08-01

#### Contacts Management — drag-and-drop NOK / copy-correspondence flagging

Rebuilt on `contacts-followups-2026-08-01` (branched from current `main`) after discovering this
feature had been built in an earlier session on the old `worktree-contacts-management` branch but
never committed — that branch's committed work (through v3.191.0) had already merged into `main`
as v3.208.0 via a separate review PR (#246) in the meantime, without this feature, so it needed
rebuilding against the current, substantially-evolved `contacts-canvas.js` rather than a simple
reapply.

- Asked for, live: (1) drag an "NOK" or "Copy correspondence" token onto an already-linked
  contact's card to set that flag directly, without going through the confirm panel (which only
  ever applies at the moment a NEW link is created); (2) show which contacts already have these
  flags, labelled "NOK"/"cc"; (3) keep the existing gap warnings ("No next of kin is set for this
  patient", the under-13 copy-correspondence one) in sync with the new capability.
- No new endpoint needed — `changePatientContact`/`getEditPatientContact` (already confirmed,
  already used for the existing relationship-label write-back) already accept
  `patientContactRelationshipIsNextOfKin`/`patientContactRelationshipCopyCorrespondence` directly.
  New `setContactFlag(cardId, flagKind, value)`: fetches the current full relationship record,
  sends it back full-replace with only the one flag changed (every manual-contact-only field sent
  `null`, confirmed live to have no effect on a real link), and updates the card locally on
  success. Wrong-patient guard re-verified immediately before the write, same discipline as every
  other write in this canvas.
- Interaction: dropping a token always SETS the flag (never toggles) — unsetting is a separate
  gesture, clicking the badge the flag produces on the card. Multiple contacts can be flagged NOK
  simultaneously with no side effects on others — deliberately not a single-NOK-at-a-time model
  (most children genuinely have both parents as NOK, older adults often have several children as
  NOK; Medicus itself doesn't enforce a single NOK either).
- New always-visible "Drag onto a contact to flag them (click the flag on a contact card to remove
  it):" tokens above the tree (`renderFlagTokens`) — not gated behind a gap being detected, so a GP
  can flag any contact at any time. `cardHtml` now always emits `data-card-id`/`data-card-kind`
  (previously only when draggable, which a locked/already-placed card never is) so any card —
  draggable or not — is a valid drop target; the existing card-to-card merge drop and the new
  flag-token drop share one unified handler, branching on the drag payload's shape. Every occupied
  tree-branch `<li>` wrapper (grandparents, parents, siblings, partner, children) also carries
  `data-card-id`, so a flag token can be dropped on a card actually placed in the tree, not only on
  one in the "below the line" manual/suggested columns — the shared slot/tree-item drop handler
  routes a flag-shaped payload via that attribute as a fallback, regardless of which of the two
  nested elements (inner card vs. outer wrapper) the browser's drop event resolves onto.
- `cardHtml`'s NOK/cc badges are clickable `<button>`s wired to `setContactFlag(..., false)` once a
  card has a `relationshipId` (needed to write to it). A freshly-created link now resolves its
  `relationshipId` immediately rather than waiting for a reload: right after a brand-new forward
  link is created (`doCanvasConfirm`), one bounded follow-up `getPatientDetails` call finds the
  matching `patientContactsSection` entry (reusing `findExistingForwardLink`'s already-confirmed
  `patientContactPatientId`/`patientContactId` fields, no new endpoint) and fills it in on the card
  object in place. Best-effort — if that fetch fails, the card just stays a non-interactive pill
  until reload, same as the fallback behaviour always was.
- Step 1.10's copy-correspondence fetch (`viewPatientContact`, one per linked card) now runs
  unconditionally for every linked card, not only when the patient is under 13 — the per-card
  badges need `copyCorrespondence` regardless of age, not just the U13 gap check. Also now the
  single source of truth for BOTH `isNextOfKin`/`copyCorrespondence` per card once it succeeds
  (overwriting the bulk-list `isNextOfKin` default), rather than reading NOK from one endpoint and
  CC from another.
- Gap flags recompute as a cheap local clear/set the moment a flag is set or unset via drag or
  click — same pattern already used for the confirm-panel-driven case, no re-fetch needed since the
  write result is already known.
- **Found live, immediately after the rebuild**: clicking a flag badge to unset it always failed —
  briefly appeared to work then reverted on a just-matched card, and threw "Refusing to update this
  contact: it is not a confirmed patient-linked contact…" outright on a fresh canvas reload, even
  against a genuinely linked contact. Root cause: `changePatientContact` gained a fourth `targetLink`
  parameter on `main` (v3.208.0's own review pass) — a defensive guard requiring proof the id
  belongs to a real link before a full-replace write, since the same write against a manual
  contact's id would wipe its name/phone/email/address. `setContactFlag`'s call predated that
  guard and never passed it, so the assertion fired unconditionally on every call, regardless of
  whether the link was real. Fixed by passing `{ patientContactPatientId: lc.id }` — constructed
  rather than re-fetched, since `lc.relationshipId` is only ever set from a genuine
  `patientContactPatientId`-bearing entry in the first place (loadCanvas' `findExistingForwardLink`
  fetch, or the new relationshipId-resolution follow-up above), so `lc.id` already IS that same
  `patientContactPatientId`. The "briefly appears to work" symptom was the flagUpdating "…" state
  showing then reverting once the write threw, not an actual optimistic-UI bug.

#### Contacts Management — duplicate-address merge didn't visibly save

`mergeDuplicateAddressGroup` deleted the surplus address(es) then immediately re-fetched via
`getPatientDetails` to refresh the list — but Medicus's own read-after-write isn't instant, so that
immediate re-fetch could still show the just-deleted address as present, making the merge look like
it silently did nothing until some later, unrelated action's own re-fetch happened to catch up.
Fixed by dropping the re-fetch for this purpose entirely: the delete loop now tracks which address
IDs it actually deleted, and `st.indexAddresses` is filtered locally against that set instead of
trusting a fresh GET to already reflect writes that just happened. Applied on top of v3.208.0's own
separate address-merge fix (correspondence-flag transfer before delete, fail-closed verification),
which addressed a different failure mode and is unaffected by this change.

## [v3.209.0] — 2026-08-01

### OIR sync fixes + Cleanup Code Preferences shared-folder sync (PR #241)

Merges Nick's `fix/oir-native-checkbox` branch (developed as internal v3.204.0–v3.204.1;
renumbered here because that range was released on main by other work). Two commits,
both live-tested on two work PCs against the real shared-folder deployment.

Review fixes applied on merge (two independent pre-merge reviews, every code fix landed
with red-first regression tests — 86 new assertions across `test-oir-key-rotation.js`
(new), `test-practice-profile.js` and `test-problem-description-cleanup-io.js`):

- **Auto-publish scope** — the daily unattended publish no longer writes a full
  `doFullExport()` profile (which wholesale-overwrote all 16 other modules with one
  machine's local state); it now publishes only the union-merged Cleanup Code
  Preferences section, carries every other section — including `practiceAttestation` —
  forward verbatim from the fetched shared copy, and **aborts** (no write, retry next
  day) if the shared profile can't be read, instead of falling back to a raw local
  snapshot. Manual attended publish keeps full-profile semantics.
- **Content-aware OIR retirement** (`shared/io/oir-key-rotation.js`, new) — the profile
  now carries the superseded published content (`retiredOirTests`), and the apply side
  removes a local test only when it content-matches that superseded copy: a clinician's
  local edit under a retired key is preserved (both versions surface for human
  reconciliation) instead of being silently deleted. A legacy bare `retiredOirKeys`
  list deletes nothing (fail-safe: a lingering duplicate beats a destroyed edit).
- **Builtin-key overrides never rotate** — disable/extend entries keyed to a builtin
  test (where the key IS the semantics) are exempt from rotation; rotating them
  silently re-enabled the builtin on every machine and landed a bogus standalone test.
  They update in place only when the local copy matches the previously published copy.
- **Cumulative retirement ledger** — `retiredOirTests`/`retiredOirKeys` union across
  publishes (FIFO-capped at 200) instead of being replaced each publish, so a machine
  that misses a version still retires the stale original; and a rotating publish now
  updates the publisher's own local keys immediately, closing the double-edit
  self-race that shipped un-rotated duplicates.
- **No unattended rotation** — key rotation of clinical config requires an attended
  publish (`attended: true`, double-guarded).
- **Ordering-aware version gate** — an older profile version (rolled-back/restored
  shared file) is now skipped with a logged reason instead of applied, which
  retirement had made destructive.
- **Override-clear tombstones** — clearing a Cleanup Code override now writes
  `overrideCleared`; the merge resolves set-vs-clear by timestamp, so a cleared
  practice-wide override no longer resurrects on the next daily sync.
- Minor: `lastUsed` no longer dropped when one side lacks it; the blob-download
  fallback no longer stamps `lastAutoPublishAt` (the file may never reach the shared
  folder); the last-writer-wins concurrent-publish limitation is documented at the
  write site.

### OIR practice-profile sync: fresh-install init race + stale edited-test merge

#### Two OIR practice-profile sync bugs fixed: fresh-install race, stale edited-test merge

Both diagnosed live on two work PCs against the real shared-folder deployment (a
completely fresh install, and an existing install missing recently-edited OIR test
content), and both confirmed fixed live afterwards.

- **Fresh-install startup race** (`service-worker.js`). `initialiseTriage()` and
  `applyPracticeProfile()` both fired unawaited from the same `onInstalled` listener.
  On a truly fresh install, `initialiseTriage()`'s unconditional seed-from-
  `defaults.json` write could land *after* `applyPracticeProfile()`'s correct
  practice-profile merge, silently stomping a freshly-applied `oirTests` list back
  to the shipped-empty default. Fixed by awaiting `migrateTriageLensConfig()` +
  `initialiseTriage()` to full completion before `applyPracticeProfile()` runs.
- **Stale edited OIR test never propagating** (`shared/io/practice-profile.js`,
  `options/options.js`). The practice-profile merge only ever appends an `oirTests`
  entry whose key isn't already known locally — so editing an existing published
  test and republishing was a silent no-op everywhere that key already existed.
  Fixed with publish-time key rotation: `doPublish()` now diffs local tests against
  what's currently shared, rotates the key of anything whose content changed, and
  lists the superseded key in a new `retiredOirKeys` field; the apply-side merge
  explicitly drops retired keys before appending. Deliberately does NOT do an
  update-in-place merge — OIR tests are editable per-machine via the same
  options-page test editor, so blindly overwriting an existing key on republish
  could silently clobber a clinician's own local edit.

### Cleanup Code Preferences shared-folder sync (multi-PC publish-merge, daily auto-publish)

#### Cleanup Code Preferences joins the shared-folder practice-profile sync, with a daily auto-publish

Previously `problemDescriptionCleanup` (the "Clean up code" preference-learning module —
`pdc.preferredDescriptions` / `pdc.conceptRemap`) had no path into the shared-folder
practice-profile sync at all: no case in `applyProfile()`, not selectable in the publish
module picker. Getting a practice-wide collective view of replacement-code choices required
manual per-PC file hand-offs via the existing per-module export/import card. This release
wires it into the live sync properly, with correctness properties specific to a module that
(unlike every other module here) accumulates from multiple machines' independent local usage
rather than being curated by one admin from one machine.

- **New `applyProfile()` case for `problemDescriptionCleanup`** (`shared/io/practice-profile.js`).
  Tally counts reconcile via `max()`, never `add()` — the shared-folder sync re-checks and
  potentially re-applies on every published version bump, and naive addition would
  double/triple-count the same published snapshot on every cycle. `max()` adopts the larger
  of "what this machine already has" vs "what's published," never inflating and never
  discarding local growth made since the last sync. Override resolution follows the module's
  merge/replace picker mode (added to `MODULE_DEFS` in `options.js`, unchecked by default):
  merge preserves "local pin always wins"; replace treats a published override as the
  practice's authoritative decision, same trust model as Knowledge's replace mode.
- **Publish no longer blindly overwrites the shared file.** `doPublish()` previously wrote
  the publishing machine's raw local snapshot straight to `practice-profile.json`, which for
  a multi-machine-accumulated module risked one machine's publish regressing another
  machine's not-yet-pulled-back contribution. New `problemDescriptionCleanupMergeForPublish()`
  (`shared/io/problem-description-cleanup-io.js`) reads what's currently shared and merges
  this machine's local data into it before writing (same `max()` tally reconciliation).
- **Daily auto-publish.** `maybeAutoPublish()` fires when the Options page happens to be open
  and a day has passed since this machine last published. Never activates on a machine that
  hasn't manually published at least once before (no established `MODULE_DEFS` picker config
  = no-op). Can never prompt for file-system permission — `showSaveFilePicker()` and
  `FileSystemFileHandle.requestPermission()` both require a genuine user gesture a background
  trigger doesn't have — so it only writes via an already-remembered handle with
  already-granted permission (`queryPermission()` only), silently doing nothing otherwise and
  retrying next time Options is open. New local-only bookkeeping key
  `suite.practiceProfile.lastAutoPublishAt` (allowlisted in `test-backup-coverage.js`, not
  part of user backups).
- **The enforced override can only ever change via a conscious, attended publish.** The
  publish-side merge takes an `includeOverride` option (default true); the daily auto-publish
  passes `includeOverride: false`, so an unattended run only ever refreshes tallies — the
  practice-wide "preferred" choice is never silently changed by a machine's own incidental
  local pick riding along on a background sync. Declaring what's enforced for the whole
  practice stays a deliberate action, gated by the same shared-folder write permissions that
  already restrict who can publish at all.

New tests in `test-problem-description-cleanup-io.js` and `test-practice-profile.js` cover
the `max()` reconciliation (including a same-snapshot-applied-twice non-inflation regression
test), merge-vs-replace override resolution, the publish-merge helper, and the
`includeOverride:false` protection.

## [v3.208.1] — 2026-08-01

### Hazard log: CSO sign-off of H-055–H-057 (Contacts Management)

Dr Dave Triska (CSO) reviewed and signed off the three Contacts Management hazards
added at v3.208.0 ("Read and signed", recorded 2026-08-01). H-055 (wrong-person link,
residual 5), H-056 (demographic data loss via hygiene writes, residual 4) and H-057
(confidentiality, residual 3) move from Proposed to **Accepted (ALARP)** at their
proposed scores; the per-hazard review questions recorded at proposal are carried
forward as open review items, not conditions. `docs/HAZARD-LOG.md` document version
3.21. No code changes.

## [v3.208.0] — 2026-08-01

### Contacts Management: visual family tree, family cycling, address/contact hygiene (PR #243)

Merges Nick's Contacts Management feature branch (developed 2026-07-23 – 2026-08-01 under
internal version numbers v3.178.0–v3.191.0, renumbered here because that range was
released on main by other work). Full development history is in the commits of PR #243.
All live-tested against real Medicus data; every write path was built against a
HAR-confirmed endpoint.

- **Visual family tree** (`content-scripts/contacts-canvas.js` + `engine/contact-tree.js`):
  drag-and-drop canvas converting a patient's manual (free-text) contacts into real
  patient-to-patient links — parents/partner/siblings/children plus grandparents,
  aunts/uncles and other branches, transitive suggestion pooling via related patients'
  own records, grandparent composition, wrong-type-phone detection, deceased badge,
  step-parent hints. Retires the old single-contact convert flow.
- **Family-member cycling** — a "Next family member" control that navigates to the next
  linked contact's own record, persisting session state (`contactsCanvas.familySession`,
  4h TTL, documented backup exclusion) across the navigation; first slice of relationship
  composition (grandparent/in-law) restricted to structurally-unambiguous cases
  (`engine/contact-relationships.js` + `rules/contact-relationships.json`).
- **Duplicate-address detection and merge** on the hub patient (PDS re-sends the same
  address differently formatted), including correspondence-address handling confirmed via HAR.
- **Name-search expansion** (`engine/contact-match.js`) so a manual contact with a middle
  name or compound surname still matches a real Medicus patient.
- **Shared-contact-info flagging** — warns when a patient shares a non-Home phone/email
  with a linked contact (confidentiality risk, often a child's record carrying a parent's
  own number).
- **NOK / copy-correspondence gaps and reciprocal flags** — flags missing
  next-of-kin/copy-correspondence and lets the confirm panel set these on the reciprocal
  relationship too.
- **Manifest description updated** — no longer claims "read-only"; the suite has shipped
  user-confirmed record-editing tools (problem cleanup, bulk-end, and now contacts writes).

Review fixes applied on merge (pre-merge code review; every code fix landed with
red-first regression tests):

- **Address merge ordering** — the correspondence-address flag is now transferred to the
  kept address *before* any duplicate is deleted, so a mid-merge failure can no longer
  leave the patient with no correspondence address; and when an address's correspondence
  status can't be verified (`getEditAddress` failure) the group's merge is disabled
  (fail closed) instead of silently treated as not-correspondence.
- **Write concurrency guards** — in-flight busy guards on "Confirm link", blank-contact
  delete, reverse-manual "Remove it", merge finalise and address merge; a double-click
  can no longer fire the non-idempotent reverse `link-patient` twice (duplicate
  relationship on the other patient's record).
- **Resumable multi-step link writes** — `performLinkAndCleanup` tracks per-step
  progress (forward link → re-categorise → reverse link → manual-contact cleanup);
  after a partial failure, retry skips completed steps instead of being permanently
  blocked by the server's duplicate rejection, a 400 "already exists" on the forward
  link is treated as done, and the reciprocal is re-read live before the reverse write.
- **Family cycling no longer drops members** — new `peekNext`/`commitAdvance` engine API
  (`engine/contact-tree.js`); a member is consumed from the pool only when the user
  actually navigates, so Cancel or a transient probe error keeps them queued.
- **`removeFromSlot` reference-identity bug** — edges are removed by (slotPath, cardId)
  value identity; a removed relationship's edge no longer lingers in `tree.edges`
  feeding placement checks and composed suggestions.
- **Stale resume banner** — the Resume handler re-verifies the live patient before
  reopening, and the banner removes itself when the SPA navigates to a different patient.
- **Name matching** — token-granular containment (Ann/Annette and surname-only contacts
  no longer reach the 0.9 tier / "strong" badge; middle-name and hyphenated-surname
  matches now do), plus `tied`/`margin` ambiguity signals on the top-ranked candidate.
- **Address dedup guards** — digit-bearing tokens ("1a"/"1b"), transposed numbers and
  lone-letter unit designators ("Flat A"/"Flat B") now compare as ordered exact
  sequences instead of falling into the fuzzy word Jaccard.
- **Free-text relationships fail closed** — possessive constructions ("Son's wife",
  "Mother's carer", "Foster mother") drop to needs-review instead of a confident wrong
  category; the "Other half" partner alias is now reachable.
- **Write-surface hygiene** — dead `createManualContact` wrapper removed; defensive
  assertion in `changePatientContact` (refuses a manual contact whose nulled fields
  would be wiped); wrong-patient guard scope documented and aligned.
- **Clinical safety** — hazard log gains H-055 (wrong-person link), H-056 (demographic
  data loss via hygiene writes) and H-057 (confidentiality: cross-patient contact info
  + persisted family graph), all Proposed pending CSO sign-off (doc v3.20).
## [v3.207.0] — 2026-08-01

### The Keeper: vaccine eligibility engine fix + mRESVIA false-GIVEN guard + digoxin monitoring scaffold

Automated safety rule maintenance run (The Keeper, 2026-08-01). All changes sourced from
internal code inspection (external clinical reference hosts returned HTTP 403 this run).
Three Red findings applied; one Red finding (vax-001 RSV 65-74 expansion) requires an engine
sprint before it can be encoded.

**vax-002 🔴 (C2-class false-GIVEN risk — applied):** `rules/vaccine-rules.json` — 5 mRESVIA
declined terms added to vax-rsv statusTerms.declined (`mresvia refused`, `mresvia
contraindicated`, `mresvia not given`, `mresvia not indicated`, `mresvia declined`). Without
these, a patient with a "mresvia refused" problem code was classified as `vax_given` because
the given term `mresvia` substring-matched the negative phrasing. Regression guard extended in
`test-vaccine-status-terms.js`.

**vax-003 🔴 (eligibility engine bug — applied):** `engine/rules-engine.js` —
`matchVaccineEligibility()` now enforces `ageMin`/`ageMax` on `problem` and `medication` kind
eligibility clauses, mirroring the existing check on `age` kind clauses. Previously, the
`ageMin: 16` on the flu and pneumococcal homelessness cohort clauses was silently ignored —
a patient under 16 with a homelessness code could be incorrectly flagged as vaccine-eligible.

**alert-C005 🔴 (monitoring gap — applied, disabled pending CSO activation):** `rules/drug-rules.json`
— disabled digoxin monitoring rule added (`enabled: false`, id `digoxin-renal-monitoring`).
Digoxin is a high-risk narrow-therapeutic-index drug; annual U&E/eGFR monitoring is required
but no Sentinel chip existed. Lanoxin is the only UK-licensed brand (dm+d confirmed). Rule
ships disabled for the CSO to review the interval and activate. Regression guard added in
`test-drug-brand-coverage.js`. Sources: BNF Digoxin monograph (corroborated; primary 403
this run) + STOPP v3 B1.

**vax-001 🔴 (open — engine change required):** RSV 65-74 clinical-risk expansion effective
1 Sept 2026 (NHSE operational letter 2 July 2026). Engine cannot encode combined age-band +
clinical-risk eligibility. Notes field in vax-rsv documents the gap and instructs manual
assessment for 65-74 clinical-risk patients from 1 Sept 2026. Engine sprint needed before
this clause can fire automatically.

**Source gap noted:** All UK clinical reference hosts (gov.uk, nice.org.uk, england.nhs.uk,
bnf.nice.org.uk, medicines.org.uk, sps.nhs.uk) returned HTTP 403 from the outbound proxy for
the second consecutive run. Only code-review findings were verifiable this run.

## [v3.206.1] — 2026-07-31

### Phrases: compose-first redesign (multi-critic design review + simulated practice panel)

Full design-crit pass on the day-old Phrases tab, driven by Dave's feedback that the
59-block list was "VERY long" and his ask to restructure toward the reception-composer
pattern (labelled rows of clickable chips). Reviewed by four design critics (art director,
token surveyor, fresh-eyes persona, product/adoption lens) plus a six-clinician simulated
practice panel (senior partner, salaried duty doctor, registrar, portfolio GP, locum, ANP);
convergent findings ruled on by the orchestrator and implemented in one pass.

- **Two modes.** *Compose* (default): six labelled slot rows in message order — Opener /
  Complete message / Message / Safety-net / Next step / Sign-off — each showing the
  clinician's most-used chips (usage data already collected) with a dashed "+N more"
  expanding in place; chip labels strip their slot prefix at render (`chipLabel()` in
  phrases-core, unit-tested) so "Opener — worried about a result" becomes a chip reading
  "worried about a result". The whole library now fits one panel screen with no scrolling.
  *Library*: the previous card surface, intact — search, category filters, add/edit,
  promote, LLM import, remove — re-homed one tap away; nothing deleted.
- **The compose tray pins** (sticky, preview clamped with "Show all") so the message being
  built and the rows stay on screen together — previously the composer scrolled away by
  the third pick.
- **The preview is now editable** (the panel's most-converged user demand): fill `***`
  placeholders and tweak wording in-panel before Copy; the amber confirm gate now fires
  only if `***` genuinely remains in the live text. Manual edits are transient and never
  persisted; changing the selection recomposes.
- **Confirm-gate hierarchy fixed:** while the gate shows, "Copy message" is removed from
  the DOM entirely — the safe exit (Back) carries the primary weight inside the gate;
  "Copy anyway" stays the amber ghost. Gate salience raised, not reduced.
- **Colour discipline restored:** red leaves the resting list (Remove/Delete are neutral
  ghosts that arm red on hover/focus); the constant green PRACTICE badge is replaced by a
  violet "yours" badge on the minority (personal blocks) plus a "Practice pack vN" mono
  provenance line on practice cards; audience badges are now differential — 'patient' (the
  constant default) unbadged, 'note' neutral, 'task' amber — while the tray's For:/mixed-
  audience control keeps full strength (H-052 control (b) note updated; flagged for the
  pending CSO review).
- **Accessibility floor met:** chips and cards are real buttons (the primary pick action
  previously had no keyboard path at all), `aria-pressed` everywhere, live-regions on the
  copy status and the `***` gate (which also takes focus), 20px close targets, `:active`
  states, green status text contrast fixed (✓ glyph carries the colour).
- **Voice recast per doctrine:** mono-caps leave all human phrases (category pills,
  slot/category tags) for sans sentence case; mono stays on data (triggers, counts,
  char/SMS, order indices). Dark theme mapped, not inherited (card borders, preview well,
  the previously-white LLM details block).
- **Pack v3:** the four sign-off bodies no longer hard-code "Dr ***" — an ANP or other
  non-doctor pasting that would mislead patients about who is treating them (practice-
  panel finding); placeholder now takes the clinician's own name/role. CI pins the ban.
- Empty states to canon (centred, actionable "Clear search"); one-line safety subtitle;
  6px/16px spacing rhythm. Full run: 346 tests green.

## [v3.206.0] — 2026-07-31

### Reception: the Patient card now follows the record open in Medicus

Field report: the Reception tab's Patient card (name + NHS number + status pill) kept
showing the previous patient after switching records in Medicus, "only updating when you
start typing". Root cause: the card was a one-shot render — its only triggers were module
entry, a browser-tab switch, a config change and the manual Refresh link. Nothing listened
for the SPA patient change, so sitting on the Reception tab across a record switch left
the old identity on screen (H-001 field evidence — hazard log doc v3.19, pending CSO
review). The "typing fixed it" observation was a red herring: leaving and re-entering the
tab is what refreshed it, and typing just tends to happen right after.

- **`side-panel/modules/reception/reception.js`** — subscribes to the content script's
  `sentinel:snapshot-updated` broadcast (the same signal the Monitoring, Record, Trends
  and Patient Alerts surfaces already use), debounced 400 ms, with a 10 s
  visibility-gated backstop poll. All listeners/timers torn down in `cleanup()`.
- **Mid-switch state** — while Sentinel re-evaluates a navigation the card now shows
  "Record changing in Medicus — refreshing…" instead of flashing the idle "open a
  record" copy; the previous patient's name is blanked immediately, never held. The
  transient deliberately does NOT re-gate the booking card, so a same-patient
  sub-navigation blip can no longer release a held slot reservation (H-051 review q4);
  a genuinely dead content script still fails the mount check and re-gates.
- **Pinned capture identity** — with the card now live, the generated summary's
  name/DOB/NHS header is pinned to the patient open when the capture form OPENED, not
  whoever is open when Generate is pressed. If the open record changes mid-capture, the
  output view says so: "if you paste it into the record now open, it goes in the wrong
  patient's notes."
- **No-op renders skipped** — the card body only re-renders when its markup actually
  changed, so the auto-refresh can't drop focus or shift the red-flag questions under a
  click; the expanded status-pill detail collapses on a genuine patient change instead of
  silently swapping its rows.
- **Pop-out** — the Patient card there was permanently blank (the active-tab query can
  only see the pop-out's own window); it now falls back to any open Medicus tab for
  display only. Booking identity is untouched: it stays active-tab sourced, and booking
  remains hard-gated off in the pop-out.
- **Tests** — new `test-reception-patient-card.js` pins the wiring (listener + sender
  guard, cleanup symmetry, debounce, visibility gate), the transient-invalidate
  discipline, the display-only pop-out fallback and the pinned capture identity.

## [v3.205.0] — 2026-07-31

### New tab: Phrases — reusable message blocks (copy-only)

A personal/practice snippet library for the text GPs type twenty times a day: openers,
results wording, safety-netting, next steps and sign-offs, composed into one message and
**copied** — pasting into the right Medicus box and pressing send remain the clinician's
own acts, in Medicus. v1 deliberately performs **no DOM insertion** into Medicus (that is
a later phase under the reception-quick-actions doctrine); the module's only output is
the clipboard, on an explicit click. New hazard **H-052** (docs/HAZARD-LOG.md) records
the canned-text failure modes and controls; the H-049 no-completion-claim doctrine is
inherited verbatim and CI-pinned.

- **Blocks, not templates** — the atom is a small reusable block with a fixed schema
  (`id, title, body, trigger, keywords, category, audience, leafletUrl, slot`); blocks
  compose in fixed slot order (opener → whole → substance → safety-net → next-step →
  sign-off) regardless of click order, joined with blank lines.
- **Audience on everything** (H-052 wrong-context-paste control) — every block carries
  `patient` / `note` / `task`, shown as a word+colour tag on every card and in the
  compose preview; a mixed-audience selection warns before you paste; an unknown
  audience fails closed to `note`.
- **`***` manual-fill placeholders, never auto-filled** — Epic-style wildcards the GP
  types over every time (hard rule in `shared/phrases-core.js`; Accurx refuses
  auto-merge for the same reason). They render highlighted, and **Copy refuses a casual
  copy while `***` remains**: an explicit second click states the consequence ("the
  patient will see \*\*\* where their details should be").
- **Two tiers** — personal blocks (freely editable) and practice blocks (shipped pack +
  promoted personal blocks, removable with tombstones so pack updates never resurrect a
  deleted block). Shipped pack lives in `shared/phrases-presets.js` with its own integer
  version gating `mergeShippedPack` (the quick-actions-core migration pattern); the
  curated content pack is authored separately and drops into that one file — CI
  (`test-phrases-core.js`) validates the whole pack, so a malformed drop-in fails the
  build.
- **Search** — palette-grade ranking plus a `/trigger` fast path (exact trigger beats
  prefix beats fuzzy); empty search sorts most-used-by-me. Live character count and an
  approximate SMS-segment figure at compose time.
- **LLM-assisted authoring on the tab** — a copyable prompt (exact JSON schema, NHS
  reading-age 9–11 rules for patient-audience blocks, no patient details) and a
  paste-JSON import with strict per-block validation and visible rejection reasons;
  imports land personal-tier until deliberately promoted.
- **Backup wired day one** — `phrases.items` / `phrases.config` ride the suite envelope
  via `shared/io/phrases-io.js` (whitelist-sanitised on import), with a preview summary
  line and a per-module export card in Options.
- Plumbing: nav tab in both shells, `MODULES` entries in panel + pop-out, tab-catalog,
  tab-help, tour-coverage and backup-coverage guards all updated.

## [v3.204.2] — 2026-07-31

### Reception-instruction composer: crush fix round 3 — the container is a grid, not a flex row

Third field screenshot, same day: still crushed. The evidence now points at a **CSS grid**
field container — which explains why both prior fixes missed: a sibling inserted into a
grid shifts every auto-placed item over by one cell (the textarea lands in a narrow
track), a flex-wrap walk sees nothing to fix, and `min-width` on a grid item overflows a
fixed track instead of widening it. Strategy change — stop competing in the container's
layout algorithm at all:

- **Insertion anchor** — `insertionAnchor()` climbs out of pure single-child wrapper
  shells (≤3 hops) before inserting, so the widget lands where the page's own block flow
  stacks it above the field (like its label) instead of inside a flex/grid track fight.
- **Grid-agnostic CSS** — `#ms-qa-widget { grid-column: 1 / -1 }` keeps the widget on a
  full row of its own in any grid parent, leaving auto-placed siblings in their original
  tracks. Harmless elsewhere.
- **Grid escalation step** in `fixCrushedLayout()` — if the box still measures crushed,
  collapse the fighting grid's `grid-template-columns` (recorded + restored like every
  host patch) so its children stack full-width.
- **Inline `min-width` on the textarea** — the stylesheet's sibling rule stops matching
  once the widget is anchored higher or hoisted; the inline patch travels with the box.
- **`ch-debug` capture** — if every step is exhausted and the box is *still* crushed,
  `localStorage.setItem('ch-debug','1')` + reload now logs `[MSQA]` with the textarea's
  full ancestor chain (tag, class, computed display/flex/grid, widths) so the next fix is
  evidence-driven, per the repo's capture-first debugging doctrine.

## [v3.204.1] — 2026-07-31

### Reception-instruction composer: comment-box crush fix made continuous (v3.204.0's didn't hold)

Field evidence (screenshot, same day): the v3.204.0 layout fix did **not** hold on the live
Medicus task page — the Internal-comment textarea was still crushed into a vertical
one-character-per-line sliver beside the widget. Root-cause assumptions that failed: the
crushing flex container is not always the textarea's **direct** parent (the v3.204.0 fix
only wrapped that one level), and the one-shot measure at inject time is stale by the time
Vue re-applies its layout. Replaced with three layers, none of them one-shot:

- **CSS backstop** — `#ms-qa-widget ~ textarea { min-width: 220px !important; flex: 1 1
  100% !important; }`. `min-width` beats `flex-shrink` regardless of *which* ancestor is
  doing the crushing, and `!important` holds across Vue re-renders that rewrite the
  textarea's inline style between JS re-checks. This rule alone makes the
  one-character-per-line failure impossible.
- **Escalating JS self-heal** — `fixCrushedLayout()` runs measured, idempotent steps only
  while the textarea still measures crushed: un-`nowrap` every flex-row ancestor within 5
  levels (not just the parent), patch the textarea itself to claim a full row, then hoist
  the widget out of the fighting container one level at a time (max 3), re-measuring after
  each lift.
- **Continuous re-check** — `runInject`'s connected-widget path no longer early-returns:
  every observed DOM churn now ends in `ensureReadableLayout()` (one
  `getBoundingClientRect` when healthy), so a host re-render that restores the crush is
  re-fixed within one 350ms throttle tick rather than never.

All styles set on Medicus's own nodes go through a recorded patch registry and are
restored on widget removal — no permanent host-DOM mutations. `test-reception-quick-actions-ui.js`
gains a section pinning all three layers (the CSS min-width rule, the continuous re-check
in `runInject`, and the patch-restore in `removeWidget`).

## [v3.204.0] — 2026-07-31

### Reception-instruction composer: comment-box crush fix + two-step flow made unmissable (practice feedback)

Practice feedback on the GP → reception quick-actions composer
(`content-scripts/reception-quick-actions.js`): the "Insert into comment" button was being
missed, users didn't realise the insert had worked, it wasn't obvious Medicus's own Submit
still had to be pressed — and on some task layouts the inserted text rendered vertically,
one character per line, completely illegible.

- **Layout fix (the illegible vertical text) — this was a safety-control failure, not
  cosmetics.** Medicus renders some field containers as flex-row with no wrap; injected as
  a plain sibling there, the widget and the Internal-comment textarea fought over the row
  and the textarea lost — crushed to a few px wide. With the comment box unreadable,
  hazard **H-049's controls (b)/(e)** ("the clinician still reads the comment before
  submitting") were materially degraded in live use. `injectWidget` now detects a flex-row
  parent, sets `flex-wrap: wrap` on it (previous value remembered and restored by
  `removeWidget`) and claims the full row so the textarea drops to a full-width line below;
  a self-heal re-hoists the widget above the whole field container if the textarea still
  measures crushed after injection. The DOM-contract fixture
  (`fixtures/medicus/quick-actions-internal-comment.html`) now carries the flex-row layout
  so the fix stays regression-guarded against the real DOM shape.
- **Pressing Insert no longer looks like an abort.** The insert clears the chip picks for
  the next instruction — which meant the visible response to pressing the button was the
  form emptying itself. The preview block now does double duty: "WILL ADD: <sentence>"
  while composing, and after the insert it holds "ADDED TO THE COMMENT BELOW: <the exact
  sentence>" in green until the next chip pick. Echoing the sentence back is the primary
  "it worked" signal.
- **The two-step flow is now numbered and taught in place.** The insert button is large,
  full-row and labelled "1. Insert into comment ↓" (with a finite 3-cycle attention pulse
  when armed, box-shadow only, disabled under `prefers-reduced-motion`); a persistent line
  beneath reads "2. Then press “Submit as new” below." — the submit label read live off
  the card's own control (escaped, clamped, `/^submit\b/i`-guarded, falling back to
  "Submit"). While disabled the button now says why ("Pick an action first").
- **The un-submitted state no longer times out.** The old single 11.5px notice faded after
  4s — exactly wrong for the interruption case H-049(i) describes. Now split: a transient
  green flash banner confirms the write ("Text added to the internal comment below. Read
  it, then press “Submit as new”."), while a persistent amber reminder — "Not yet
  submitted — press “Submit as new” below. Until you do, reception sees nothing." — plus a
  "not yet submitted" pill in the always-visible header strip stay up with **no timer**,
  clearing only when the clinician clicks the card's own Submit control (observed
  capture-phase, never prevented, never synthesised — pressing Submit remains entirely the
  clinician's act, and a click is deliberately not treated as a success claim), the SPA
  navigates away, or the comment box is emptied by hand.
- **No more scroll tug-of-war after insert.** `ta.focus()` no longer scrolls
  (`preventScroll: true`), a brief green ring marks the comment box where the text landed,
  and the amber ring on Medicus's Submit only scrolls to it when it is off-screen.
- **New CI guard for the H-049 wording controls.** `test-reception-quick-actions-ui.js`
  source-greps the widget (nothing in CI loaded this file before) and pins the safety
  strings ("Insert into comment" contiguous, "writes text only — books nothing", "not yet
  submitted", "reception sees nothing"), that no UI string literal claims completion
  (Done/Sent/Booked/Submitted), that no `.click()` ever reaches a submit control, the
  append-only write path, the `preventScroll` focus, and that no timer clears the pending
  reminder.
- Hazard log: H-049 updated — field evidence of the layout defect degrading controls
  (b)/(e) recorded with this remediation; wording controls updated to the new strings;
  mechanism otherwise unchanged (text-only append, gated Insert, Submit highlighted never
  clicked, task UUID re-verified).

## [v3.203.0] — 2026-07-29

### PR #228 remediation: merged main, escAttr + import key validation, deterministic REPLACED BY, scan patient-change guard

Merged `origin/main` into PR #228 (`fix/oir-native-checkbox`) and applied review-remediation
fixes ahead of merge.

- **Security fix — attribute-position escaping for Clean-up-code preference keys
  (confirmed exploitable pre-fix).** `options/options.js`'s PDC (preferred-descriptions)
  tally-row rendering interpolated `topKey`/`row.key` into `data-pdc-clear` /
  `data-pdc-setoverride` / `data-pdc-row-key` attributes using `escHtml()`, which does not
  escape quotes — a key containing `"` could break out of the attribute and inject markup
  into the options page. Switched to `escAttr()` (already defined, escapes quotes on top of
  `escHtml`). Paired with a source-side fix: `shared/io/problem-description-cleanup-io.js`'s
  import validator now rejects any top-level key not shaped like a SNOMED conceptId
  (`/^\d+$/`) and any tally key / `override.key` not shaped like a descriptionId or
  `conceptId|descriptionId` (`/^\d+(\|\d+)?$/`) — so an imported backup can no longer carry
  a crafted key through to the attribute sink at all. New cases in
  `test-problem-description-cleanup-io.js` pin both the rejection and that legitimate
  axis-2 keys (`123|456`) still pass.
- **REPLACED BY now deterministically preferred over SAME AS.** `shared/snomed-retirement.js`
  could carry both associations on one retired concept; which one ended up in `replacement`
  used to depend on the termbrowser API's `memberships[]` array order. `REPLACEMENT_REFSET_IDS`'
  own array order is now used as an explicit priority list (REPLACED BY beats SAME AS
  regardless of which membership the API lists first), while "first wins" is preserved within
  a single refset. Two new fixtures in `test-snomed-retirement.js` (both associations present,
  opposite array order) pin that REPLACED BY wins either way.
- **Clinical-summary scan discards a wrong-patient response.** `content-scripts/
  problem-description-cleanup.js`'s `scan()` could cache patient A's in-flight
  `fetchClinicalSummaryProblems` response after the clinician had already switched to
  patient B — `_scanInFlight` gating meant B's own scan skipped fetching, so A's response
  landed and got matched against B's DOM. `scan()` now captures the requested patient ID
  before the `await` and only assigns `_problemsCache` if the current patient still matches
  when the response lands, discarding silently otherwise (same stale-response discipline as
  the PR #227 audit fixes' `_evalGen`/`_runToken`). DOM-bound, not exported — no unit test;
  this entry plus the code comment are the record.
- **CI patient-data guard allowlist.** `test-snomed-retirement.js` added to
  `NHS_ADD_ALLOWLIST` in `scripts/check-no-patient-data.js` — it carries SNOMED
  conceptId/descriptionId values, some of which coincidentally pass the NHS Modulus-11
  check, same rationale as the existing `test-problem-description-cleanup.js` entry.

## [v3.202.1] — 2026-07-28

### CSO review pass (delegated virtual-Dave review at Dave's instruction) — sign-offs + clinical corrections

- **Intended Purpose re-frozen and SIGNED as v3.202.0** (provenance-honest
  delegated signature) — after correcting a false blanket no-egress claim:
  the optional transactional-API integration routes reads via a
  Graysbrook-operated proxy (dormant by default); a Data flow and egress
  paragraph now states it. CSN gains the W12 row + egress note (CSN full
  review deliberately left unsigned — see pending list).
- **Pathways signed as v1.8 with corrections**: `gyn-female` gains the
  missing sepsis red flag (999) and the early-pregnancy flag is split
  (999 heavy bleeding / duty tissue passed, per NG126 and the
  no-conditional-escalations rule); `gu-male` gains priapism (999) and
  paraphimosis (duty); retention deliberately stays 999 (reasoning in
  sources). MH byte-identical duplication with `general` now pinned.
- **Live matcher bug fixed**: the normaliser stripped apostrophes but not
  hyphens, so "self-harm", "post-coital bleeding", "shoulder-tip pain"
  silently matched nothing; fixed + pinned, plus balls/testes/thrush terms.
- **Disposition**: `rash` loses its automatic Pharmacy First rule (one age
  gate stood in for three PF conditions and its terms include cellulitis,
  which PF doesn't cover — receptionist can still choose PF manually).
- **H-050 + H-051 SIGNED (ALARP)**; H-051 question 4 resolved by code:
  positive red flags still hide the booking card; *unanswered* flags now
  show "answer the red flags to unlock" instead of nothing.
- Plan: jobs-list task-write **parked** (needs a named team queue + a
  named daily checker first); appointment-type names confirmed as a
  two-minute live-Medicus lookup, blocking nothing.
- **Left unsigned, honestly**: CSN full document review, DPIA (no
  assessment of the proxy transfer exists), transactional-proxy hazard
  entry (raised, not written). Do not enable txn hybrid/transactional
  mode until they exist.

## [v3.202.0] — 2026-07-28

### Reception: in-panel appointment search + booking — DRAFT, hazard H-051 PENDING CSO (reception feedback, Phase D2/D3)

- **New booking card** in the reception capture view: appointment-type
  select (no pre-selection), date modes `Specific day · 1wk · 2wks ·
  3wks · 4wks` (window search via booking-core's capped
  `findSlotsInWindow`), slot list grouped by day earliest-first (empty
  day distinguishable from not-searched), confirm step with **name+DOB
  read-back gated by an explicit right-patient tick**, reason pre-filled
  from the pathway title, **visible/editable booking-confirmation
  channels** (payload = exactly the ticked subset; TODO recorded to
  capture Medicus's own default), booked line written into the capture
  text.
- **Gates (fail-closed truth table, 32 combinations tested):** pop-out →
  note only (booking is panel-only, recorded ruling); sensitive pathways
  (mental health) → never shown; no open record with resolvable patient
  uuid → disabled with instruction; any positive or unanswered red flag
  → hidden (same single evaluateRedFlags gate as the disposition card).
- **Identity (H-051):** active-tab snapshot is the single documented
  identity source; the panel arms only when both resolvers agree; at
  commit the patient AND site are re-detected fresh and must match the
  pin and the current context (three-source agreement) or the booking
  aborts, releases the reservation, and says "nothing was booked".
- Reservation released on five exit paths + pagehide keepalive; nothing
  persisted to chrome.storage; no third copy of the booking flow.
- New shared `booking-panel(-core).js` component (reusable by future
  surfaces), `test-reception-booking.js` (113 checks); suite total 341.
- Hazard **H-051** (initial 5×3 → residual 5×1), PENDING CSO REVIEW with
  four named review questions; Phase 0 governance resync is a stated
  prerequisite to enabling any of this for live reception use.

## [v3.201.0] — 2026-07-28

### Reception: if-this-then-that disposition engine — DRAFT, suggestion-only (reception feedback, Phase E, hazard H-050)

- **`evaluateDisposition`** (pure, truth-table-tested): after a fully
  answered, red-flag-clear capture, suggests a route (Pharmacy First /
  ANP / paramedic / GP routine) from the pathway's `disposition` block.
  Suggestion-only — a human confirms or overrides, and every suggestion
  carries "Or a clinician callback if the patient prefers — always offer
  it." on screen and in the pasted capture text.
- **Guardrails frozen in engine code, applied after override resolution**
  (a practice fork cannot edit them away — adversarial fixture tested):
  mental-health/sensitive pathways render no disposition output at all;
  gu-male, gyn-female and general are clinician-only; positive OR
  unanswered red flags withhold; hard age floor (<1 clinician-only, <5
  strips ANP/paramedic incl. from the override control); age must be
  explicitly confirmed on the call (never the open record's) and fails
  closed to GP routine; Pharmacy First suggestions re-use the existing
  age gates, failing closed. Downgrading overrides are rejected as
  invalid at resolve time.
- **Custom routing sign-off: CSO or partner only.** Custom/edited
  pathways stay clinician-only until a `reception.routingAttestation`
  (name + role + timestamp, revocable) is recorded in options; backups
  import it validate-or-drop and the restore preview warns when one is
  present.
- **Audit trail in the capture text**: suggested/confirmed/overridden
  routes AND withheld dispositions (with reason) are recorded, so an SEA
  can reconstruct what the tool did and didn't say.
- Nine conservative shipped disposition blocks (DRAFT pending CSO;
  pathways remain disabled by default); pathway editor gains a
  Disposition section with clinician-only greying; hazard entry
  **H-050** (initial 4×2 → residual 4×1, ALARP, PENDING CSO REVIEW).
- New `test-reception-disposition.js` (214 checks); suite total 340.

## [v3.200.0] — 2026-07-28

### Reception: three new capture pathways — DRAFT, disabled pending CSO sign-off (reception feedback, Phase B)

- **New pathways** (ship OFF; enable in options after CSO review):
  `gu-male` (torsion/retention/sepsis 999s; loin pain, visible haematuria,
  testicular lump duty; no Pharmacy First — male UTI excluded by the
  service spec), `gyn-female` (ectopic cluster + early-pregnancy bleeding
  + pelvic torsion 999s; PMB, persistent PCB, ovarian symptom cluster
  duty), `mental-health` (NG225-conformant minimal capture — binary
  triggers, no scoring; the two `general` MH flags stay in `general` too).
- **Schema**: red flags may carry `safeguarding: true` (banner + capture
  text render the practice safeguarding contact; bypasses routing);
  pathways may carry `sensitive: true` — **drafts are never autosaved,
  any stored draft is deleted, taker initials become mandatory**, and a
  practice-editable crisis-route line (default NHS 111 option 2) renders
  on the form and in the capture text. LLM authoring prompt documents
  both plus the no-conditional-escalations rule.
- **New closing question** (all pathways, asked first): am I speaking to
  the patient or someone on their behalf.
- **Queue-chip wiring**: synonym + red-flag topic terms for all three
  pathways (DRAFT-marked for CSO), with the deliberate `urinary`/`gu-male`
  tie-break (generic UTI wording offers both, never auto-picks).
- **New regression guard** `test-reception-pathway-coverage.js`: every
  pathway id must have synonym + topic terms (the silent-no-chip failure
  mode is now a CI failure), tie-break pinned.
- Options: NEW badge on unseen bundled pathways, SENSITIVE badge,
  safeguarding-contact + crisis-line settings, editor checkboxes for the
  new flags; backup import sanitises the new config fields.

## [v3.199.1] — 2026-07-28

### Governance resync: safety case corrected to describe the real write paths (reception feedback, Phase 0)

- **CLINICAL-SAFETY-NOTICE** (doc v3.14, PENDING CSO REVIEW): §6.2/6.3 no
  longer claim "no write path to Medicus" — new §6.1 enumerates all eleven
  write surfaces (W1–W11: both booking flows incl. patient booking-
  confirmation SMS/email, task creation ×2, inbound-document filing, lab
  filing, routine-rx commit assist, problem edit/end, duplicate
  hide/merge) with endpoints, triggers and controls, plus two honestly
  stated gaps. §2/§5 "passive, read-only" claims corrected.
- **INTENDED-PURPOSE**: new frozen statement v3.199.1 drafted — **DRAFT,
  unsigned, not in force** (signature lines empty; v3.16.0 remains the
  statement in force, now carrying a marked-inaccurate caveat). Adds
  non-clinical reception/admin staff under practice delegated authority as
  proposed intended users. A re-freeze convention is now written into the
  doc.
- **DPIA** (v1.1 draft): new reception-module section (special-category
  phone-triage capture, draft persistence, shared-workstation processing,
  paste-into-Medicus flow), six new risk rows, "writes nothing back"
  corrected.
- **cso-review-ledger**: CSN correction recorded as pending;
  INTENDED-PURPOSE and DPIA added with `last_cso_review_version: null`
  (never formally reviewed — no review fabricated).

## [v3.199.0] — 2026-07-28

### Booking core extracted to shared/ + slots commit-time patient re-verify (reception feedback, Phase D1)

- **New `shared/booking-core.js`**: the six booking endpoints move out of
  `slots/booking-api.js` (now a re-export shim keeping tab/patient
  detection). Dual-mode export (ES + `window.BookingCore`), zero
  `chrome.tabs` in the core, `createAppointment` throws without an explicit
  `patientId` — the core can never self-detect the patient.
- **`findSlotsInWindow`**: pooled multi-day slot search (cap 28 days,
  concurrency ≤4, weekend skip, abort on 429/5xx, early stop at limit,
  results sorted + grouped by day). Foundation for the reception 1–4-week
  window search (D2). TODO recorded to spike the endpoint's native range
  support.
- **`releaseReservation` now `keepalive: true`** — panel-close releases
  were silently dropped before (live bug, fixed for slots too).
- **slots.js hardening (H-043)**: `doConfirmBooking` now re-resolves the
  patient (and site) immediately before `createAppointment` and aborts +
  releases the reservation on any mismatch — the commit-time re-verify the
  inline widget already had, retrofitted to the panel.
- First CI coverage for the booking write path: `test-booking-core.js`
  (86 assertions incl. shim identity and no-tab-detection guarantees).

## [v3.198.0] — 2026-07-28

### Quick actions: new shipped presets + version-gated merge (reception feedback, Phase A)

- **New shipped presets**: actions `Book medication review`, `Book DOAC
  review`, `Book CVD review`, `Add to jobs list`; roles `Registrar`,
  `First-contact physio`, `Mental health practitioner` (with mid-sentence
  `WHO_RENDER` renderings).
- **Version-gated preset merge** (`DEFAULT_CONFIG.version` 2 +
  `mergeShippedPresets`): existing installs now receive new shipped presets
  without losing their own entries. Runs lock-step in both consumers of
  `triagelens.quickActions` (widget + options editor).
- **Deletions stick**: removing a shipped preset records a `removedShipped`
  tombstone so migrations never resurrect it; re-adding the entry clears
  the tombstone. Options page documents the behaviour.
- **Fixed a silently-clamped shipped label**: `No appt needed — inform
  patient` (31 chars, clamped mid-word since ship) is now `No appt —
  inform patient`. Existing installs keep their stored clamped copy — a
  one-click delete (which now tombstones) removes it.
- Tests: label-length/cap assertions over every shipped list + full merge
  suite (175 checks in `test-quick-actions-core.js`).

## [v3.197.3] — 2026-07-28

### Docs: reception-feedback plan — Dave's decisions folded in

- **Patient messaging (item C) dropped** — replaced by a decision stub
  recording why (no captured send endpoint; wrong-patient send hazard class)
  and what survives (D3's booking-confirmation recipient control; inbound
  photo filing already shipped). Sequencing is now 0 → A → D1 → B → E →
  D2/D3.
- **Quick-action presets: user add/remove is a first-class requirement** —
  one-click per-entry removal in the options editor, and the version-gated
  merge gains a `removedShipped` tombstone list so deliberately deleted
  shipped presets are not resurrected on migration.
- **Custom-routing attestation: CSO or partner signs off** (name + role +
  timestamp recorded) — resolves the plan's open question 4.

## [v3.197.2] — 2026-07-28

### Docs: reception-feedback plan — virtual-Dave review pass applied

- Reworked `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md` after the review
  pass. Load-bearing corrections: added **Phase 0 governance resync** (the
  Clinical Safety Notice / Intended Purpose statement currently assert "no
  write path" and clinician-only users — both must be re-frozen before
  reception booking ships); corrected the patient-messaging claim (the
  booking payload's `bookingConfirmationRecipients` already fires patient
  SMS/email today — D gains a recipient-channel control); moved E's
  guardrails out of editable pathway data into **frozen engine constants
  applied after override resolution**, with an adversarial-fork test, a
  hard age floor (<1 clinician-only), confirmed-age-only routing, and
  clinician attestation for custom-pack routing; D gained
  no-self-detection booking-core identity rules, open-record gating,
  red-flag suppression, name+DOB read-back, and a panel-only pop-out
  ruling; B gained `safeguarding`/`sensitive` schema flags (MH drafts skip
  autosave), split conditional escalations, a caller-vs-patient closing
  question, and no disposition card at all for mental health;
  A's preset merge now runs in both storage-key consumers. Sequencing
  re-ordered: 0 → A → D1 (booking-core refactor) → B → E → D2/D3 → C-spike.

## [v3.197.1] — 2026-07-28

### Docs: reception-feedback build plan

- Added `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md` — the build plan for the
  reception team's feedback session: GP→Reception preset additions (registrar /
  first-contact physio / mental health practitioner, medication / DOAC / CVD
  review, jobs list) with a version-gated preset merge; three new capture
  pathways (male GU, female GU/gynae, mental health — NG225 no-stratification
  posture); the honest status of patient messaging (no send primitive exists —
  spike first, prepare-only v1); embedded slot search/booking in reception on
  an extracted shared booking-core with 1–4-week window search and H-043
  commit-time re-verification; and an editable if-this-then-that disposition
  engine with hard-coded clinician-only guardrails. Docs only — no code change.

## [v3.197.0] — 2026-07-28

### GP → Reception quick-actions composer on the task Internal comment

User request: "What I specifically want as an insert around that internal
comment box is a quick actions type menu for communication from GP to reception
team. Specifically, this is about what needs to happen with them, ie do they
need an appointment or similar. Second, with whom? Third, within what time
frame? … It needs to be configurable by the GP surgery … probably needs a free
text thing because we won't add all the members of staff."

- **A collapsed strip now sits directly above the Internal comment box** on task
  overviews ("▸ Reception instruction — *writes text only — books nothing*").
  Expanded, it is three chip rows — **Action** ("Book F2F appt", "Phone
  patient", "Book bloods (HCA/phlebotomy)", …), **With whom** ("Any GP", "Duty
  doctor", "Practice nurse", … plus a **+ name** chip that saves a name for the
  whole practice), **Timeframe** ("Today", "Within 48h", "Routine (next
  available)", …) — plus one free-text "If not / other:" box with tap-to-fill
  suggestions. Single-select per row, tap again to deselect; only Action is
  required.
- **It composes one plain-English sentence, shown live before you insert it.**
  Verb first, one sentence, full stop, no prefixes, pipes, CAPS or emoji — e.g.
  picking *Book F2F appt* / *Any GP* / *Within 2 weeks* writes `Book F2F appt
  with any GP, within 2 weeks.` Shipped role and timeframe labels are rendered
  so they read mid-sentence ("Usual GP" → "their usual GP", "Routine (next
  available)" → "routine"); a name a practice adds is used verbatim, so "Nat"
  stays "Nat". An "FYI" action collapses to `FYI — no action needed.`
- **It writes text only — it books nothing and submits nothing.** Insert is an
  explicit button, disabled until an Action is picked; it *appends* to the
  comment box and never clears or rewrites what you already typed; afterwards it
  **highlights** the card's own Submit / "Submit as new" control rather than
  clicking it, and says "Text added to internal comment — **not yet
  submitted**". The task UUID is pinned when the composer opens and re-verified
  synchronously at insert, so a mid-flight SPA navigation aborts with "Task
  changed — reopen and re-pick." instead of writing into the wrong task. The
  free-text note is transient — it never reaches storage.
- **All four lists are practice-configurable** in Options → **Quick Actions**
  (add / edit / reorder / delete, restore shipped defaults, and a live example
  sentence so wording is checked at edit time). The lists ride
  `triagelens.quickActions` and are captured in suite backups via the triage
  scope; the composer's ⚙ button opens that section directly.
- **New DOM contract `quick-actions.internal-comment`** plus a synthesised
  fixture (`fixtures/medicus/quick-actions-internal-comment.html`) so a Medicus
  markup change that hides the comment box shows up as contract drift rather
  than a widget that silently stops appearing.
- **New hazard H-049** — "quick-action composer text mistaken for an executed
  action or a safety net" (initial 9, residual 3, Accepted ALARP pending CSO
  review), with `test-quick-actions-core.js` pinning every canonical sentence
  verbatim.

## [v3.196.0] — 2026-07-29

### Fixed: practice-profile push of custom Outstanding Investigation Requests (OIR) test entries never actually reached ANY install

Real bug, confirmed live: a practice published custom OIR test-dictionary entries via the
shared practice profile, confirmed the publish itself worked, but none of them ever reached
any install — including a genuinely fresh one. Root cause in `shared/io/practice-profile.js`'s
Triage Lens section: the "merge" path only ever applied the whole `triagelens.config` blob
when the local copy was **completely empty** — but it never actually is, on any machine.
`service-worker.js`'s `initialiseTriage()` seeds `triagelens.config` from the bundled
`defaults.json` on every `chrome.runtime.onInstalled`, and that local write always wins the
race against this profile check's own network fetch of `practice-profile.json` — so the
whole-config "only if empty" gate could never actually fire for practice-authored profile
content, on any install, fresh or not.

`oirTests` is now merged at the field level — appending only entries whose `key` isn't
already present locally, the same by-id merge discipline already used elsewhere in this file
for `sentinel.customRules`/`knowledge.items`/`triageAlerts.rules` — instead of gating the
whole config on an empty-check that could never be true. `rules`/`thresholds`/`systemChips`/
`resultRules` are deliberately NOT merged (those are the suite's own shipped clinical logic,
not practice-authored) — pushing those wholesale even once local config exists would risk
silently clobbering a clinician's own local rule tweaks; left exactly as before until there's
a real reported need. `"replace"` mode is unchanged (still applies unconditionally). 10 new
tests in `test-practice-profile.js` — this module had no existing coverage at all, which is
presumably why the bug went unnoticed.

### Hardened: SNOMED retirement check's termbrowser.nhs.uk fetch now goes through the service worker, not the content script

A live browser console capture showed a plain `fetch()` from
`content-scripts/problem-description-cleanup.js` (injected into the Medicus page) to the
public termbrowser.nhs.uk API blocked by the browser's own CORS check — `Access to fetch at
'https://termbrowser.nhs.uk/...' from origin 'https://england.medicus.health' has been
blocked by CORS policy` — despite termbrowser.nhs.uk being correctly declared in
`manifest.json`'s `host_permissions`. **Not confirmed as a persistent bug** — the same check
was seen working again shortly after, without the extension even being reloaded, so the
original block may have been transient (a one-off preflight/network blip) rather than
content scripts categorically being unable to get the host_permissions CORS bypass. Since
`fetchRetirementStatus` already fails closed on any error (by design, never guesses
active/inactive), this was never a crash either way — at worst a silent "skip" on whichever
requests happened to hit it.

Hardened regardless, since there's no downside: the fetch now relays through the background
service worker, which has no page/extension origin ambiguity at all — a new
`termbrowser:fetchConcept` message handler in `service-worker.js` performs the actual
`fetch()`, restricted to the `termbrowser.nhs.uk` host specifically via a parsed-URL hostname
check (deliberately NOT a general-purpose cross-origin proxy, even though only
intra-extension senders can reach it at all — same `sender.id !== chrome.runtime.id` guard as
every other handler in this file). `fetchRetirementStatus` now calls
`chrome.runtime.sendMessage(...)` instead of `fetch()` directly. Unit-tested in
`test-service-worker.js` (the relay itself, host/protocol restriction, malformed-input
handling, and a check that `fetchRetirementStatus` no longer calls `fetch()` directly at
all).

### Fixed: "Clean up code" buttons vanished for good after navigating away from Clinical Summary and back

Real bug, reported after running "Check for retired/legacy codes?" then navigating to
another care-record tab and back to Clinical Summary (same patient): the retirement-scan
trigger widget reappeared correctly, but any "Clean up code" button it had flagged did not
— only a hard page refresh restored it. Diagnosed via a timed peak/final DOM-count capture
spanning the navigate-away-and-back action (not guessed): the widget recovers because
`scan()`'s recurring rescan loop calls `injectRetiredWidgetTrigger()` unconditionally on
every tick, but that same loop only re-injects per-row buttons for problems matched by the
cheap text heuristic (`findOutdatedProblems`) — it never looked at `_rows[problemId]` state
already set by the opt-in retirement scan (`retiredInfo`/`legacyReadCode`/
`genericAdditionalInfo`), so a problem flagged ONLY by that scan lost its button for good
the moment Vue's re-render wiped it. `scan()` now unions the text-heuristic list with every
problem already flagged by the retirement scan before re-injecting — `injectFixButton`
itself was already idempotent/de-duping, so this closes the gap.

### Added: "Cleanup code preferences" — per-practice learning for "Clean up code", two axes

Every "Clean up code" apply path (same-concept relabel, descendant, cross-concept,
hint-expanded, confirmed-replacement, possibly/partially-equivalent, manual search — anywhere
a clinician confirms a description via `applyCode`) now feeds two local, per-practice learning
signals, both reviewable and manually overridable on a new **Cleanup code preferences** page
in Options:

- **Preferred wording** (`pdc.preferredDescriptions`, keyed by conceptId): which WORDING this
  practice picks among several synonyms Medicus offers for the SAME code. Closes a gap
  `confirmedReplacementAlternatives`' own comment already flagged (v3.195.0): there is no
  preferred-term signal in Medicus's own search response to rank synonyms by, so the
  practice's own actual usage becomes that signal instead of a guess. When none of the
  automated categories find anything for a concept (a clinician would otherwise have to fall
  back to manual search every time), this practice's own prior choice is now offered directly
  — a pure local lookup, no re-search dependency.
- **Code remapping** (`pdc.conceptRemap`, keyed by the SOURCE conceptId) — new, added after
  live feedback: which OTHER SNOMED code this practice has actually replaced a given code
  with (a genuine recode, not a wording tweak). Real motivating case: "Injection into
  varicose vein of leg" (449705007) manually replaced with "Injection of varicose vein of
  lower limb" (449708009) — the wording tally above couldn't help here (different concept
  entirely), and the existing `crossConceptAlternatives` text-match couldn't catch it either
  (the wordings don't match). This is a materially higher-confidence signal than that
  text-match category — a real precedent this practice has already applied, not a
  coincidence — so it renders in its own clearly-labelled, high-confidence green section in
  the panel, distinct from the cautious orange cross-concept/hint-expanded ones. Still only
  ever offered as a one-click suggestion; never auto-applied, same discipline as every other
  category in this file.

Both axes share one generalised mechanism, `shared/preferred-descriptions.js` (pure
tally/resolve/override logic over an arbitrary key+candidate shape, unit-tested in
`test-preferred-descriptions.js`) and one IO file,
`shared/io/problem-description-cleanup-io.js` (both storage keys, wired into the suite
backup/export system — `test-problem-description-cleanup-io.js`). Deliberately different from
most IO files in this repo: import **merges** tally counts onto the existing local ones rather
than replacing them (this data is meant to accumulate across a practice's machines via the
existing manual export/import mechanism, not be overwritten by whichever backup was imported
last), and a local manual override always survives an import carrying a conflicting one — both
rules apply independently to each axis.

A manual override can be set/cleared per concept on the Options page for either axis — the
override always wins over the tally when both exist, but tallying continues underneath it
regardless, so a practice can check whether the pinned choice is actually the one being used.
The page also caps its default view to the 20 most-recently-used entries per axis (with a
"Show all" toggle and a filter box, both sorted alphabetically) rather than rendering
everything unconditionally, since a practice's tally can grow large over time.

No change yet to which description is *pre-selected* in the wording pulldowns themselves —
that remains a deliberately deferred follow-up now that there's a live-verified data-collection
and review/override layer to build it on.

### Added: "Clean up code" flags GP2GP severity-defaulting contradictions, offers a one-click correction

Real bug found via a HAR capture (SCTID 433144002, "Chronic kidney disease stage 3"):
Medicus's edit-problem UI only has a plain Major/Minor significance dropdown, so when a
GP2GP-transferred source record carries no machine-readable significance value, the importer
defaults the structured field to Minor and writes what it did, plus what the source record's
own free text actually said, into `additionalInformation` as plain text — e.g. "Unspecified
Significance: Defaulted to Minor\nProblem severity: Major". The structured field is never
corrected afterwards even when the source-supplied value disagrees with the default, right
there in the same field — the motivating patient was stored as `significance:"minor"` when
their own import text said Major.

"Clean up code"'s opt-in scan now parses this two-fragment template and compares the stated
value against the problem's own current significance. **ALL known GP2GP-import boilerplate
now lives in one place**, `rules/generic-additional-info-text.json` — consolidated the
same day from a second file, `rules/severity-defaulting-pattern.json`, that briefly existed
alongside it. Each entry carries a `kind`: plain `"literal"` strings (the original schema,
matched per line) for pure noise with nothing further to check, or `"pattern"` (a regex
source, matched against the WHOLE field rather than per line) for boilerplate that also
encodes a captured value — an `action` flag on the entry says what further step to offer
when that value disagrees with the record. `Problem severity: Major` was also added as a
literal entry now that it's been observed standalone on a real patient.

Also fixed the same day: a second real layout of the boilerplate turned up —
"Unspecified Significance: Defaulted to Minor Problem severity: Minor", the two fragments
run together on **one line, joined by a space, no newline at all** (values agreeing this
time, so no correction needed, just plain noise) — where the original implementation,
which required each fragment to be its own whole line, would have missed it entirely and
left it untouched. The pattern-matching regex now spans whitespace generically (`\s+`
between the two fragments), so it recognises the boilerplate whichever way GP2GP happens to
have joined it, without needing a separate literal entry per layout.

`findPatternMatch`/`removeMatchedSpan`/`severityCorrectionNeeded`/`computeAdditionalInfoFindings`
(the last now the single source of truth used by both the opt-in scan and the panel's own
re-fetch, so the two can never disagree) are unit-tested in `test-problem-description-cleanup.js`.

### Fixed: "Clean up code" missed a retired concept's SNOMED-confirmed replacement when the association was "SAME AS" rather than "REPLACED BY"

Real gap, reported after a clinician found no suggestion at all for a "Check cystoscopy using
flexible instrument" problem (176187002). It never reached the automatic text scan
(`looksOutdated()` has no bracket/NOS/NEC/H-O marker to match here), so it depended entirely
on the opt-in "Check for retired/legacy codes?" scan — which correctly found the concept
retired (inactivation reason "Duplicate component") but landed on "no automatic replacement
is recorded", even though SNOMED does name one: a genuine `ASSOCIATION` membership on refset
`900000000000527005` ("SAME AS association reference set"), pointing to `301301002` "Flexible
cystoscopy" — confirmed live via the public NHS termbrowser API. `shared/snomed-retirement.js`
only ever checked `REPLACEMENT_REFSET_IDS` against the single `900000000000526001` ("REPLACED
BY") refset; SAME AS was a documented-but-unconfirmed gap in that file's own header comment
since 2026-07-26, now closed with a real example. Folded into the SAME `replacement` field
REPLACED BY already populates (not a new hedge-style multi-candidate list like
possiblyEquivalentTo/partiallyEquivalentTo) — "duplicate component" + "SAME AS" together
assert these are literally the same clinical concept filed twice, the same one-confirmed-
successor confidence tier REPLACED BY already has. `REPLACEMENT_REFSET_IDS` was deliberately
kept as an array from the start for exactly this kind of extension — closing this gap needed
one line, `test-snomed-retirement.js` gets a new fixture (176187002).

### Fixed: descendant/laterality search on a retired problem targeted the wrong (dead) concept

Real gap, found while investigating why 179304004 "Primary uncemented total hip replacement"
(retired, additionalInformation containing "right") offered no laterality-specific
suggestion. The investigation concluded no suggestion SHOULD have been offered for that
specific case — the candidate a clinician proposed, 430694001 "Prosthetic arthroplasty of
right hip", genuinely carries no "uncemented"/"total" facet on any of its relationships, and
no SNOMED concept combines all three (confirmed via two text searches against the public
terminology API) — so keeping the correct procedure-type code with "right" as free text is
the clinically correct SNOMED modelling, not a gap.

But a real, separate bug surfaced during that investigation: the descendant/laterality search
in `openPanel` narrowed under `code.conceptId` — the problem's OWN current conceptId — which
for a retired problem is the old, retired concept. SNOMED stops growing a retired concept's
subtree once it's retired (179304004 itself has zero descendants, confirmed live), so this
search was structurally guaranteed to find nothing for ANY retired-with-replacement problem,
regardless of whether the live replacement concept actually has laterality-specific children.
New `descendantSearchTargetConceptId` (`content-scripts/problem-description-cleanup.js`)
prefers the confirmed replacement's conceptId (`st.retiredInfo.replacement`, already resolved
by the opt-in retirement scan — no extra fetch) when one exists, falling back to the
problem's own conceptId otherwise (an active concept, or a retired one with no confirmed
replacement) — unit-tested in `test-problem-description-cleanup.js`.

### Added: "Clean up code" flags source-system "PRIORITY=n" import text, prompts a manual severity check

Some GP source systems export a problem's severity as a raw `PRIORITY=n` field (n observed
1-9, exact bounds unconfirmed) instead of anything Medicus can map onto Major/Minor.
Unlike the severity-defaulting contradiction above, there's **no confirmed, consistent
mapping** from this scale to Medicus's significance field — different source systems
plausibly use different scales, and none has been reverse-engineered — so this is
deliberately **not** an auto-correction. New `sourceSystemPriorityValue` pattern entry in
`rules/generic-additional-info-text.json` (a new `reviewSeverity` action type, alongside
the existing `severityCorrection` one) flags the raw `PRIORITY=n` text as junk and shows an
informational note — *"Import text included a source-system priority value ('PRIORITY=n')
with no confirmed mapping to Major/Minor — this problem is currently recorded as X; please
check that's clinically correct"* — with no button attached, since there's nothing safe to
guess. The raw text is still offered for removal via the ordinary "Remove generic import
text" strip, coexisting with the note rather than being superseded by it (unlike a genuine
contradiction, which supersedes the plain strip with the correction action instead).
`computeAdditionalInfoFindings` now returns a third field, `severityReviewNote`, alongside
`genericAdditionalInfo`/`severityContradiction` — unit-tested in
`test-problem-description-cleanup.js`.

**Same day, follow-up:** one value on this scale turned out to be confidently mappable
after all — `PRIORITY=1` reliably means Major, per this practice's own direct experience of
the source system this convention came from, holding across every example seen in imported
data since. Added `valueSeverityMap: {"1": "major"}` to the `reviewSeverity` action (the
mechanism now supports either style: a plain informational prompt for most values, or a
confident correction for specific mapped ones) — `PRIORITY=1` now drives the SAME "Correct
severity + remove junk text" one-click action as the GP2GP defaulting contradiction, with
its own explanation text (`severityContradictionExplanation`) making clear the value comes
from a locally-confirmed convention, not the source record spelling out "Major" in plain
English. Every other value keeps the informational-only behaviour exactly as before.

### Fixed: another severity-defaulting boilerplate layout wasn't being flagged at all

Real gap, reported live: "Defaulted to Minor\nProblem severity: Minor" — the SAME GP2GP
template as severityDefaultingContradiction above, but missing the leading "Unspecified
Significance: " prefix — wasn't recognised at all. The pattern's leading fragment is now
`(?:Unspecified Significance: )?Defaulted to (Major|Minor)` (the prefix is optional), so
all three confirmed real-world layouts — full prefix + newline, full prefix + single space,
and no prefix at all — are handled by the one regex, no code change needed, just the data
file. Added a standalone `"Defaulted to Minor"` literal entry too, mirroring its longer
sibling, so a solo/unpaired occurrence with no "Problem severity:" line is still recognised.

### Added: "Active Problem, Not Significant (Minor)" boilerplate — and confirmed the span-based strip handles boilerplate mixed with genuine text on one line

Real example (per the user, plausibly a record that's passed through more than one GP
EPR/GP2GP transfer, each layering its own boilerplate onto the same field): "Defaulted to
Minor\nProblem severity: Minor grade 1 with small erosion at GOJ\nActive Problem, Not
Significant (Minor)". Two distinct pieces of noise here — the already-handled
severityDefaultingContradiction fragment, and a NEW sibling to "Active Problem, Significant":
`"Active Problem, Not Significant (Minor)"`, the same boilerplate template for the opposite
significance value, added as its own literal entry.

Worth noting explicitly since it wasn't obvious it would just work: the middle line mixes the
"Problem severity: Minor" boilerplate prefix with genuine clinical free text ("grade 1 with
small erosion at GOJ") on the SAME line. Because pattern-entry removal is span-based
(`removeMatchedSpan`) rather than whole-line, it strips only the exact matched boilerplate
substring and correctly leaves the genuine clinical text as its own surviving line — no new
code needed for this case, confirmed via `test-problem-description-cleanup.js` against the
exact real string.

### Added: "Clean up code" reassures when a problem's SNOMED code itself is fine, flagged only for import-text housekeeping

Real user concern, raised from a screenshot: a problem flagged ONLY because of junk import
text (or a severity contradiction/review note) — with the code itself perfectly current, not
retired, not Read-code-derived — still surfaced the SAME wall of alternative-code suggestion
buttons as a genuinely outdated code, purely because `additionalInformation` happened to
contain wording (e.g. "grade 1 with small erosion at GOJ") that matched a hint word for the
unrelated descendant search. Visually indistinguishable from "this code is wrong, pick a
replacement" — misleading when the code was never actually in question.

The panel now shows a green reassurance note — *"This problem's own SNOMED code hasn't been
flagged as outdated or retired — it was only flagged here for import-text housekeeping. Any
suggestions below come from wording in 'Additional info' and are optional, not a sign the
current code is wrong."* — whenever there's at least one suggestion to show but no genuine
code-quality signal. New `codeQualityConcernExists` (pure logic, unit-tested) reuses
`looksOutdated()` (the same cheap check the automatic per-load scan already runs) plus the
two opt-in-scan-only signals (`retiredInfo`/`legacyReadCode`) already in state — never a new
heuristic, just surfacing what the tool already knows but wasn't saying out loud.

## [v3.195.0] — 2026-07-28

### Added: "PARTIALLY EQUIVALENT TO" retirement association support

Real case: 199317008 "Twin pregnancy - delivered" is retired ("Classification derived
component") with a `PARTIALLY EQUIVALENT TO` association (refset `1186924009`) to TWO
concepts — 65147003 "Twin pregnancy" and 289256000 "Mother delivered" — but
`shared/snomed-retirement.js` only recognised `REPLACED BY` and `POSSIBLY EQUIVALENT TO`,
so this association was silently skipped and no replacement was ever offered.

`parseConceptRetirement` now also parses `partiallyEquivalentTo` (same multi-candidate,
deduped shape as `possiblyEquivalentTo`, kept as its own field — SNOMED's own semantics
differ: "partially equivalent" means the retired concept's meaning is SPLIT across the
candidates, not a hedge between alternatives). The "Clean up code" panel renders it as its
own violet-styled banner with distinct copy ("this record may need reviewing as more than
one problem"), resolved against Medicus's own search index the same way as
`possiblyEquivalentTo`.

### Fixed: same-concept alternatives search invisible to codes on the Body structure axis

Real case: "[M]Tubulovillous adenoma" (conceptId 61722000, an ACTIVE concept — not a
retirement case) never got a same-concept relabel suggestion. `61722000` is a
`(morphologic abnormality)` concept, and the ordinary same-concept-alternatives search
scopes to Clinical finding/Procedure/Situation/Social context/Event only — the same root
cause as v3.193.0's retirement-replacement fix, this time hit on the everyday "Clean up
code" path that every `[M]`/`[X]`/NOS-flagged problem goes through. `openPanel` now retries
the current concept's own bare-SCTID search against the Body structure hierarchy when the
broad-scope search comes back empty, same two-step fallback already proven for retirement
replacements.

### Fixed: a SNOMED code's own eponymous/technical synonym could silently win over its plain-English one

Real case: 402222007 "Pompholyx of hand" also carries the synonym "Chiropompholyx", and
201201000 "Pompholyx of foot" also carries "Podopompholyx". `confirmedReplacementAlternative`
picked whichever synonym happened to sort first in Medicus's own bare-SCTID search response
— an accident of array order, not a deliberate choice (Medicus's search response carries no
preferred-term/acceptability flag to rank by). `confirmedReplacementAlternatives` (plural)
now returns every synonym for a candidate concept instead of just the first, used by
`resolveSnomedNamedCandidate` for the confirmed-replacement / possibly-equivalent /
partially-equivalent categories.

### Changed: one lozenge per SNOMED code, not one per synonym

Follow-up to the fix above: showing every synonym as its own button made one real SNOMED
code look like several different codes when it had multiple wordings. `groupCandidatesByConcept`
now groups every candidate-list category (same-concept alternatives, descendants,
cross-concept, hint-expanded, confirmed replacement, possibly/partially equivalent) by
`conceptId`: a code with one offered synonym keeps its existing single-button lozenge
unchanged; a code with several renders a `<select>` of the wordings plus one shared "Use"
button, routed through `applyGroupedCandidate` to whichever category's own apply function
owns that state.

276/276 tests passing across `test-snomed-retirement.js` (59) and
`test-problem-description-cleanup.js` (217), lint/format clean.

## [v3.194.0] — 2026-07-26

### Renamed "Fix description" to "Clean up code"

The widget grew well beyond same-concept relabelling — it now also suggests better/more
specific codes, detects retired and Read-code-derived codes, and removes generic GP2GP
import noise from `additionalInformation`. Button text and the retirement-scan status
message updated to match; internal identifiers (`ms-pdc-*` CSS classes, file names) are
unchanged — display text only.

### Fixed: duplicate-description problems could get the wrong row's "Clean up code" button

Real case: two "Infantile eczema" (90823000) problems on one patient, one Major
significance, one Minor. `clinical-summary/summary`'s `problems` array groups by
significance (all Minor entries, then all Major), but the page renders a Major `<ul
aria-labelledby="problems-major-label">` BEFORE the Minor list — so a flat, whole-document
duplicate-text row search claimed the wrong list's row for whichever problem was flagged.

Confirmed live (within one significance group, the API's relative order DOES match that
group's own `<ul>`'s DOM order — the invariant just needed the narrower scope). Fixed:
`buildAnchorMap` now partitions problems by `significance.value` and resolves each
partition's own `problems-<value>-label` list before claiming rows, instead of one flat
whole-page search. (A first attempt — computing one shared anchor map from the full problem
list regardless of flag status — fixed a related but different collision and was necessary,
but insufficient on its own for this cross-section case.)

### Fixed: a Read-v2-derived problem flagged for cleanup when there was nothing to fix

A GP2GP import origin (`originalCodes` showing a `read-v2` code) only means the record is
old — it says nothing about whether the CURRENT description is already the best available
wording. A patient can have two problems on the same concept, one genuinely needing a
relabel, one already correctly worded; flagging both read as broken when the already-correct
one offered no alternatives on click.

Fixed: before flagging the Read-v2 signal, the scan now runs the same same-concept SNOMED
search "Clean up code" already runs on open (once per distinct conceptId among Read-v2-
flagged problems, not per problem) and suppresses the flag if there's genuinely no better
wording to offer. Retirement and generic-import-text flags are independent and unaffected.

### Fixed: removing generic import text 400'd on a GP2GP-imported problem recorded with no defined author

`edit-problem`'s GET can return `recordedByOrganisation` wrapped in a UI-select shape
(`{label, value:{organisationName, ...}}`) instead of the plain `{organisationName, ...}`
object the POST validates against — confirmed via a real author-less import, where
round-tripping the wrapper verbatim 400'd (`recordedByOrganisation.organisationName`
missing, `.label`/`.value` not expected). `buildEditProblemPayload` now unwraps this shape
when detected, passing the original already-unwrapped shape through unchanged otherwise
(both are confirmed real). The generic-text-removal apply path also now rebuilds
`problemCode` from the same narrow `{description, conceptId, descriptionId}` shape every
other apply path already uses, instead of round-tripping the raw GET value. `apiFetch`
now surfaces the API's actual error body (truncated) instead of a bare status code, so a
future rejection is self-diagnosing without a separate Network-tab capture.

### `rules/generic-additional-info-text.json`: two more confirmed GP2GP boilerplate lines

"Unspecified Significance: Defaulted to Minor" and "Problem severity: Minor" — real example,
a Read-v2-derived "Infantile eczema" problem whose `additionalInformation` carried both as
pure import boilerplate restating the `significance` field already captured structurally.

### `rules/non-problem-root-codes.json`: the 18 roots added in v3.191.0 re-confirmed against Medicus's own live API

Previously researched via the public NHS termbrowser API only. Every cited descendant for
all 18 roots — including the two broad ones, `3457005` Patient referral and `307824009`
Administrative statuses — now additionally confirmed live against Medicus's own
`constrainingParentConcepts` search, matching the confidence level of the original 3 roots.
No code change; end-to-end behaviour on a real patient's coded problem is still unobserved.

193/193 tests passing (7 new), lint/format clean.
## [v3.196.0] — 2026-07-28

### Monitoring Brief: per-group RAG (Meds / QOF / General) + loud green all-clear

User request: "I want the brief summary box at the top very obviously green if
there's nothing to do for this person. Can it be split into meds monitoring
(i.e. bloods, height weight etc), QOF and general things like vaccines so the
person can at a glance see if the person is safe to prescribe for — i.e. green
monitoring box but amber QOF and general means I could glance and prescribe
safely."

- **The Brief card no longer disappears when nothing is due** — it now renders
  an explicitly green all-clear card ("✓ Nothing to do — meds monitoring, QOF
  and vaccines all clear"), same green treatment as the "Waiting room clear"
  strip. An absent card was ambiguous ("did it even check?"); the green card is
  a positive finding. It only renders in the `data` state — loading/degraded/
  unreadable-record states still clear the slot, so a half-loaded record can
  never show a false green.
- **Chips are split into three RAG groups**, each with its own state:
  - *Meds monitoring* — everything bearing on prescribing safety: drug-
    monitoring bloods/checks, interaction combos, allergy flags, composites.
  - *QOF* — indicators and registers (recall/payment work).
  - *General* — vaccines, event-count clinical reviews (falls, recurrent UTI),
    and any unknown/future chip type (deliberate fall-through: a new chip type
    must never silently inflate the safe-to-prescribe meds group).
- **Header pills `Meds ✓ / QOF n / Gen n`** (green tick or red/amber count)
  replace the old aggregate red/amber badges and survive collapsing the card —
  the "meds green → prescribing checks clear, even though QOF is amber" glance
  works from the collapsed header alone. Tooltips carry the full breakdown
  (never colour alone, colour-blind safe).
- **Expanded body is sectioned** Meds monitoring → QOF → General, each with a
  state line ("2 red · 1 amber" or green "none due ✓"); signal lines render
  under their own section. The max-4 signal cap, red-first ordering and
  "+N more (n red) below" line are unchanged.
- `buildBrief()` now returns `groups` (per-group red/amber/status), `allClear`,
  and a `group` on each signal; it returns a brief for an all-green record
  instead of null. `test-brief-core.js` re-pinned accordingly (95 checks).

## [v3.195.0] — 2026-07-27

### "Bulk remove?" reworked: ungated, boxes inline next to every problem

User feedback on the v3.194.0 pair of triggers, same day it shipped: "I'd
envisage Bulk remove as click on it, boxes appear next to ALL problems, you
can tick and retire them. not gated." The two sibling widgets — the SNOMED-
gated "Bulk remove?" (`problem-junk-code-cleanup.js`) and the panel-checklist
"Bulk end problems" (`problem-bulk-end.js`) — are now ONE widget, under the
"Bulk remove?" label, in `problem-bulk-end.js`:

- **Ungated**: clicking "Bulk remove?" puts a checkbox next to **every**
  active problem — no admin-code scan decides who gets a box any more.
- **Inline**: the boxes are injected into Medicus's own problem rows (Major /
  Unknown Significance / Minor alike), not a duplicate list in a panel. The
  queue-chip injection discipline applies (prepend, re-inject on every
  mutation tick, all state in JS keyed by problem id, idempotent); any row
  that can't be matched to the on-screen list falls back to a panel checkbox
  so it stays reachable.
- **The SNOMED junk-code detection survives as a badge, not a gate**: after
  the checklist is already usable, the old scan (combined
  constrainingParentConcepts query per distinct conceptId, caution
  attribution, fail-closed on caution-check errors) runs in the background
  and badges matching rows "admin?" (+ ⚠ with the caution text where
  applicable). A new **"Select flagged"** button ticks only badged, endable,
  non-⚠ rows — the successor of the old widget's "Select all", still never a
  blanket select-all (CSO posture unchanged: nothing pre-ticked, linked
  problems excluded, two-step ENDING/KEEPING confirm, double-layer
  date/reason guard, no auto-reload, ledger entry per batch, server error
  bodies surfaced per row).
- `problem-junk-code-cleanup.js`/`.css` retired; pure helpers and their tests
  (including the 21-root rules-file regression locks) moved into
  `problem-bulk-end.js`/`test-problem-bulk-end.js`. `rules/non-problem-root-
  codes.json` is unchanged and still the place to add new junk categories.

## [v3.194.0] — 2026-07-27

### New: "Bulk end problems" on the Clinical Summary

User request: busy problem lists carry many problems that plainly need ending,
and Medicus's own UI is one dialog per problem. New trigger button next to the
"Major" heading (sharing the row with "Bulk remove?" and the retired-codes
check) opens a checklist of **every** active problem — the general-purpose
sibling of the SNOMED-scoped "Bulk remove?" widget, using the identical
confirmed contract (`GET …/end-problem/{id}` for `activeChildProblems`,
`POST /clinical/problem/end-problem` `{problemId, endDate, reason}`). No
SNOMED resolution at all, so the opt-in scan is one cheap form fetch per
problem.

Because every row here is potentially a REAL clinical problem, the CSO
guardrails from the 2026-07-26 review of the sibling widget apply from day
one, several deliberately stricter:

- Nothing pre-ticked and **no "Select all" of any kind** — each problem is
  individually reviewed and ticked.
- Problems with active child problems are excluded (disabled), not warned.
- **Two-step confirm**: "Review N selected…" renders an explicit ENDING /
  KEEPING summary (the duplicate-checker's house pattern for "about to change
  the live record") with the end date and batch reason echoed back and a
  no-bulk-undo warning; only that summary's Confirm button POSTs.
- End date AND reason (free text, default "Resolved", batch-wide) guarded at
  both layers — buttons disable without them and `endSelected()` refuses to
  POST regardless of button state (`canSubmit` is the single guard both
  consult).
- **No auto-reload** after success — a "Refresh page" button instead (the
  CSO-preferred pattern; a reload the clinician didn't ask for can bin a
  half-typed consultation).
- Every successful batch writes a machine-local Clinical Event Ledger entry
  (source `record`, action `committed`, patient UUID + count only — never the
  free-typed reason, per the ledger's no-free-text rule).
- Failed POSTs surface the server's response body per row (the v3.193.2
  lesson) and return to the checklist for retry; successes strike through the
  live row optimistically.

New `content-scripts/problem-bulk-end.js`/`.css` (registered in
`manifest.json`), 29 assertions in new `test-problem-bulk-end.js` covering the
payload contract, selectability, the double-layer `canSubmit` guard, the
ENDING/KEEPING partition (a ticked-but-linked row can never reach ENDING),
and error-body extraction. Shared-row CSS exclusion lists in
`problem-junk-code-cleanup.css` / `problem-description-cleanup.css` extended
for the third trigger (kept in lock-step). `defaults.json` untouched.

Not yet live-confirmed on a real record — the POST contract is the same
already-proven one the junk widget ships, but the reason string has only ever
been live-captured as "not a problem"; if the server rejects another value,
the per-row error now names the constraint.

## [v3.193.3] — 2026-07-27

### "Fix description": flatten option-object fields in the edit-problem POST (the actual API 400 root cause)

The live capture behind v3.193.2's diagnosability work landed and named the
culprit: the failing record was the **first ever seen with a non-null
`episode`**, and the edit-problem GET returns select-backed fields as the
selected **option object** (`episode: {value:"subsequent",label:"Subsequent"}`)
while the POST contract takes the bare value (compare `significance` — a plain
`"major"` string in both directions of the original §3 capture). Every
previously-confirmed apply happened to be on an `episode: null` problem, so
round-tripping the whole object never surfaced until now.

- New pure helper `unwrapOptionValue()` flattens a value shaped exactly like a
  select option (an object with BOTH `value` and `label` keys) to its `value`;
  everything else passes through untouched — deliberately strict so a real
  object field (`recordedByOrganisation`'s `{organisationName, …}`) can never
  be mangled by it.
- Applied to `significance`, `episode`, `reasonEnded` and `recordedByStaff` in
  `buildEditProblemPayload`. `problemCode` (replaced wholesale) and the
  organisation/practitioner fields (round-tripped verbatim) are unchanged.
- 12 new assertions in `test-problem-description-cleanup.js`, including the
  full pseudonymised failing prefill as a fixture.
- `docs/learnings-problem-description-cleanup.md` §3b records the trap, the
  capture, and the legitimate `recordedByOrganisation: null` +
  `recordedAtAnotherOrganisation: true` combination seen on the same record.

Pending live confirmation on the motivating record — if the flatten isn't the
whole story, v3.193.2's error surfacing will name whatever remains.

## [v3.193.2] — 2026-07-27

### "Fix description": API errors now say WHY the server refused

Live report (2026-07-27): applying a suggestion on a Clinical Summary problem
failed with a bare **"API 400"** — the widget discarded the server's response
body, which is the one thing that says which field the validation rejected.
Diagnosing the actual 400 needs a live capture (this release ships the
diagnosability; the root cause gets fixed once the server's reason is visible).

- `apiFetch` in `content-scripts/problem-description-cleanup.js` now reads the
  error response body on any non-2xx and surfaces it through a new pure helper
  `apiErrorMessage(status, bodyText)`: prefers a JSON body's
  `message`/`error`/`errors` fields, falls back to the raw text, collapses
  whitespace and truncates to fit the inline panel, and never throws. No body →
  the old bare `API <status>`, unchanged.
- The message flows through the existing `st.error` / `esc()` render path, so
  it appears in the same place the bare "API 400" did — just with the reason.
- 11 new assertions in `test-problem-description-cleanup.js` pin the extraction
  rules (message/error/errors preference, non-JSON fallback, truncation,
  whitespace collapse, null-safety).

The same discard-the-body pattern exists in `problem-junk-code-cleanup.js` and
`document-file-inline.js` — deliberately not touched here (one focused change);
worth the same treatment in a follow-up.
## [v3.193.1] — 2026-07-26

### PR #223 review fixes (CSO review): bulk-remove safety gates + housekeeping

Remediation of the four items from the pre-merge review of PR #223.

- **"Bulk remove?" caution roots (`rules/non-problem-root-codes.json` v2).** Three
  configured roots are usually GP2GP import noise but can be LIVE clinical flags:
  `3457005` Patient referral (an in-flight 2WW/urgent referral is a safety-net),
  `161714006` Estimated date of delivery (an active EDD often flags a current
  pregnancy — a prescribing-safety cue), and `307824009` Administrative statuses
  (descendants include "Follow-up arranged"). Each now carries a per-root
  `caution`; the widget renders it as a ⚠ warning on every flagged row attributed
  to that root (attribution via a per-caution-root constrained search, since the
  scan's one combined query can't say which root matched; attribution failure
  fails CLOSED to cautioned), and **"Select all" never ticks a ⚠ row** — those
  must be reviewed and ticked individually. Summary copy no longer calls every
  flagged row "likely import noise". Caution set regression-locked in
  `test-problem-junk-code-cleanup.js` (new `cautionRootsOf` helper + 7 checks).
- **Empty end-date guard.** Clearing the end-date field could POST `endDate: ""`
  to the live record. The "End N selected" button is now disabled with no date,
  and `endSelected()` refuses to POST without one regardless of button state.
- **CHANGELOG version collision actually resolved.** The 2026-07-25 merge from
  `main` left two v3.177.0 and two v3.178.0 entries (each side had assigned the
  numbers independently). This branch's two entries are renumbered into the free
  v3.176.12 / v3.176.13 slots with renumber notes; main's already-released
  entries are untouched. Their follow-ups keep their original v3.177.1–.7 /
  v3.178.1 numbers.
- **CI patient-data guard false positives.** `rules/document-types.json` and
  `test-problem-description-cleanup.js` carry SNOMED descriptionIds — 10-digit
  terminology identifiers, some of which coincidentally pass the NHS Modulus-11
  check. Both files added to `NHS_ADD_ALLOWLIST` in
  `scripts/check-no-patient-data.js` with the reason documented in place.

## [v3.193.0] — 2026-07-26

### Retirement scan's confirmed-replacement search now reaches Body structure / morphologic-abnormality-axis replacements too

Follow-up to v3.192.1's copy fix (which hinted at this without claiming a fix). Real case:
443897009 "[M]Tubular adenoma NOS" is `REPLACED BY` 1156654007 "Benign tubular adenoma
(morphologic abnormality)" — SNOMED genuinely records this replacement, but the panel showed
"could not be matched in Medicus's own search index — search manually" instead of the usual
one-click confirmed-replacement button.

Root cause: `st.confirmedReplacement` is found via `searchDescriptions(replacementConceptId)`
— `SEARCH_PATH`'s `constrainingParentConcepts` scopes to Clinical finding/Procedure/
Situation/Social context/Event. 1156654007 is on an entirely different SNOMED hierarchy
(Body structure / morphologic abnormality), invisible to that search regardless of query
text — not a Medicus indexing gap, a scope exclusion by the caller itself.

**Live-verified via the public NHS termbrowser API before building** (six concept lookups,
no patient data): 1156654007 → 1187375007 → 1187227004 → … → 49755003 "Morphologically
abnormal structure" → 118956008 → **123037004 "Body structure"** — a genuine, traced IS-A
descendant chain. `123037004` is the same constraining root already confirmed live for the
unrelated Rotator Cuff body-structure case (2026-07-17) — though that fix never actually
needed to *query* body-structure scope (it searched for the disorder-axis target text
instead), so there was no existing code to reuse the pattern from, only the diagnostic
precedent.

**Fixed**: when the primary broad-scoped replacement search comes up empty,
`openPanel()` now falls back to `searchDescendantsNarrowed('123037004', replacementConceptId)`
— reusing the existing, already-shipped descendant-search fetch verbatim (already used
elsewhere in this same function for hierarchy-descendant search), just with the replacement's
bare conceptId as the query instead of a hint word. One extra fetch, only when the primary
search fails — the common case (most replacements ARE disorder/procedure-axis) is unchanged.

No new unit test (this is orchestration/fetch wiring, not pure logic — `confirmedReplacementAlternative`,
the pure filter it feeds into, is already covered; consistent with how this file tests
everything else touching `apiFetch`). 186/186 existing tests still pass. **Not yet
live-confirmed** — next step if resumed is checking whether the confirmed-replacement button
now appears for this real patient's tubular-adenoma problem via the retirement-scan-first
path.

## [v3.192.1] — 2026-07-26

### Fixed v3.192.0 before it ever went live: detectAnatomicalSiteHint was silently picking the wrong word

Live-tested by the user immediately after v3.192.0 landed, on the real motivating patient —
result: still no anatomy match offered, on either entry path (direct "Fix description" click,
or via "Check for retired/legacy codes?" first).

Root cause: `detectAnatomicalSiteHint` copied `detectPathologyHint`'s "return only the first
match" contract, scanning `ANATOMICAL_SITE_HINT_WORDS` in **list order**, not text order. For
"Descending colon and sigmoid colon - removed", `descending` precedes `colon` in the list, so
it was picked and returned — but 444898006's actual SNOMED wording is "...of **colon**",
which never contains "descending" at all. The one search that would have worked (`colon`)
never ran, because a single-match design is at the mercy of curated-list order, not which
word the real target concept's own description happens to use — a real risk that doesn't
apply to `PATHOLOGY_HINT_WORDS` the same way, since pathology words tend to be mutually
exclusive per real case (a "tear" case doesn't usually also mention "rupture").

**Fixed**: `detectAnatomicalSiteHint` now returns an ARRAY of every matched site word (not
just the first) — `detectPathologyHint` is untouched, still single-word, since this
list-order risk doesn't apply there. `openPanel()` now combines the (still-singular)
pathology hint with every detected site hint into one `expandHints` list, each still getting
its own separate search (the word-mismatch-avoidance discipline from v3.192.0 is unchanged,
just now covers more candidate words).

**Also fixed, same session (sidenote from the user)**: the "search manually via Edit Problem"
copy in `retiredInfoHtml`'s two informational branches was stale — this panel has carried a
built-in manual search section since 2026-07-25 (v3.189.0), so telling a clinician to leave
the tool was misleading. Both messages now point at "the manual search below/further down
this panel" instead. The "could not be matched" message also now hints at the likely real
cause (a SNOMED hierarchy-scope mismatch) without over-claiming a fix — see the diagnosis in
the session notes for the separate, not-yet-fixed morphology-axis search gap this points at.

Tests updated for the array-return contract, including a direct regression test pinning the
real "descending before colon" list-order bug so it can't silently return. 186/186 still
passing (no new count — existing tests updated in place, not added to, since the site-hint
test coverage from v3.192.0 was rewritten rather than supplemented).

## [v3.192.0] — 2026-07-26

### "Fix description" hint-expanded suggestions gain anatomical-site words + run alongside cross-concept matches

Real example: a patient's "[M]Tubular adenoma NOS" problem, `additionalInformation`
"Descending colon and sigmoid colon - removed." User suspected SNOMED 444898006
("Tubular adenomatous polyp of colon") would be a better code, inferable from the site
text. Live-verified via the public NHS SNOMED CT termbrowser API (no patient data
involved) before writing anything: the currently-coded concept, 443897009, is a **retired**
morphologic-abnormality-axis concept (`REPLACED BY` 1156654007, also morphology-axis) with
**no IS-A path** to the disorder-axis "Tubular adenoma of colon" family that 444898006
belongs to — confirmed by walking the ancestor chain (444898006 → 1197339007 → 444408007)
and finding no intersection with 443897009's own lineage. So `descendantAlternatives`'
hierarchy-proof mechanism can never reach 444898006 from what's actually coded, and
correctly doesn't try to.

Two real, separate gaps found in `hintExpandedAlternatives` (the one category that doesn't
require hierarchy proof) instead:

1. **No site vocabulary.** `PATHOLOGY_HINT_WORDS` (tear, rupture, sprain, stenosis, …) has
   zero anatomical-site words — "colon"/"sigmoid"/"descending" would never match. New
   `ANATOMICAL_SITE_HINT_WORDS` in `shared/coding-specificity.js` (caecum/cecum, ascending,
   transverse, descending, sigmoid, rectosigmoid, rectum, colon) and `detectAnatomicalSiteHint`
   — same first-clause-scoped, curated-list, "a miss just means no suggestion" safety
   profile as the existing pathology list, deliberately scoped to the GI segments that
   motivated it rather than whole-body coverage.
2. **Wrong trigger gate.** `hintExpandedAlternatives` only ran when same-concept, descendant,
   AND cross-concept-exact were ALL empty — but this case already has a cross-concept match
   (444408007, the real "Tubular adenoma (disorder)" replacement), so the fallback never
   even attempted a site search. **Changed the trigger** (explicit user decision, weighing
   the tradeoff first): now runs whenever same-concept AND descendant are empty, regardless
   of cross-concept — mirrors how `descendantAlternatives` already runs alongside
   same-concept rather than as a last resort. Still the riskiest category (no hierarchy
   proof, no exact-text guarantee) and still never eligible for future bulk auto-correction.

**`hintExpandedAlternatives` generalised** (`shared/coding-specificity.js`) to accept an
array of hint words, not just one string — fully backward compatible with every existing
single-string caller. Pathology and site hints are detected independently and each gets its
**own** supplementary search rather than one combined query: Medicus's search requires every
query word to be present in a result, so "Tubular adenoma descending sigmoid colon" as one
query would silently zero-result against a real match worded just "...of colon" — the same
word-mismatch failure class already fixed once for the knee-replacement case (v3.179.0). One
word per query sidesteps that; the filtering pass then accepts a candidate matching ANY of
the words.

15 new tests in `test-problem-description-cleanup.js` (186 total, up from 171), including the
real tubular-adenoma/colon case and array-form backward-compatibility checks.

**Not yet confirmed live** — built and unit-tested only; next step if resumed is checking
whether 444898006 now actually appears in the hint-expanded section for this real patient.

## [v3.191.2] — 2026-07-26

### "Bulk remove?" + "Check for retired/legacy codes?" triggers sit alongside "Major", plus keyboard focus rings

Two cosmetic fixes on the same Active Problems card triggers, live-confirmed.

**Placement.** `#ms-pjc-widget`'s ("Bulk remove?") own `.m-card-v2__content:has(...)` flex
placement (landed 2026-07-25) forced every OTHER direct child of that card — including
`#ms-pdc-retired-widget` ("Check for retired/legacy codes?"), a separate widget injected by a
different content script into the same spot — onto its own full-width row, so only one of the
two triggers ever actually sat next to "Major" despite looking like a matched pair.
`problem-description-cleanup.css` gained the mirror-image `:has()` rule, and both files'
catch-all exclusion lists now name both widget ids, so the container becomes flex and both
triggers share the top row regardless of which one(s) are present. Each still drops to its own
full-width row once opened/clicked, same as before.

**Focus rings.** Consulted Atelier on trigger-button colour first (see below) — verdict: keep
both neutral, don't risk-colour a disclosure trigger for what's behind it. While in these
files, found neither had a single `:focus-visible` rule on ANY control (Medicus's page never
loads `panel.css`, so the suite's global ring never reached here — not a regression, just
never built). One wildcard `button[class*='ms-pjc-']`/`input[class*='ms-pjc-']` rule per file
(and the `ms-pdc-` equivalent) rather than enumerating every class, `outline: 2px solid
#2563eb` matching the suite's `--accent` light value (can't consume the token itself here).

**Design consult (Atelier, no code from this part):** should the two trigger buttons be
colour-differentiated — one gates a destructive bulk-end action, the other a purely cosmetic
scan? Verdict: no. A trigger isn't the risky moment (the actual destructive action, "End N
selected problems", is already correctly red); colouring the trigger too would dilute what red
means at the point that actually matters. Mirrors the same philosophy this feature already
applies one level deeper — `problem-description-cleanup.js`'s safest fix category is
deliberately left uncoloured rather than forced into the amber/blue/orange/red/green ramp.

## [v3.191.1] — 2026-07-26

### "Bulk remove?" auto-refreshes the page after a fully-successful end-batch

User-reported: after clicking "End N selected problems," Medicus's own native problem-list
UI (outside this widget) kept showing the ended problem(s) as still active until a manual
page refresh — the widget's own checklist correctly showed "Ended," but that's a separate
DOM tree from Medicus's own Vue-rendered list, which never re-fetches on its own after this
widget's `POST /clinical/problem/end-problem` call.

- `endSelected()` (`content-scripts/problem-junk-code-cleanup.js`) now calls
  `location.reload()` automatically, but **only when every targeted end in the batch
  succeeded** — a 900ms pause first, so the "Ended" tags are actually visible before the
  reload fires. If any end in the batch failed, no reload happens at all: a failed row must
  stay on screen with its error message so the clinician can see and retry it, not get wiped
  by a reload they didn't ask for.

## [v3.191.0] — 2026-07-25

### "Bulk remove?" gains 18 more non-problem roots — beyond pure admin/claim artefacts

Extends `rules/non-problem-root-codes.json` (used by `content-scripts/problem-junk-code-cleanup.js`)
with a new class of candidate, beyond the original administrative/claim-artefact roots
(14734007/12821000000103/184063008): genuine clinical DATA or ACTIVITIES that clinicians agreed
should never sit in the problem list itself, even though they belong in the record.

User's own reasoning, per category:
- **LMP / EDD** (`21840007`, `161714006`) — real clinical markers, but treating them as
  "problems" would generate ~12 fake problem entries a year for LMP alone; self-evidently not
  what the problem list is for.
- **B12 deficiency monitoring** (`170818005` finding + `243863004` status) — the deficiency
  itself is a real problem; the ongoing monitoring of it is admin, not the problem.
- **Wound care** (`225358003`) and **B12 administration** (`709544008`) — treatment FOR a
  problem, not the problem itself (explicitly NOT a hard rule — clinically significant
  treatment like chemotherapy would still belong on the problem list; these are minor by
  comparison).
- **Influenza vaccination** (`86198006`) — same over-counting logic as LMP (many adults get 2 a
  year); deliberately scoped to flu only, not all vaccines.
- **Patient referral** (`3457005`) — a broad root by design: referral status/type entries are
  admin for a problem, not the problem itself, whichever specialty or urgency.
- **Medication review** (`182836005` + due/done statuses `314529007`/`314530002`) and **Adult
  health examination** (`268565007`) — genuine clinical activities that GP2GP source systems
  sometimes file as problems, even though the activity isn't a diagnosis.
- **NHS Health Check family** (`523221000000100` completed, `523201000000109` indicated,
  `763661000000101` annual review, `519961000000106` programme) — administrative
  programme-status markers; SNOMED models these as separate branches with no shared ancestor
  narrow enough to use as one root, hence four leaf entries (the "invitation" variant was
  already covered by the existing 14734007 root).
- **Administrative statuses** (`307824009`) — a broad, well-precedented "Clinical finding"
  subtree (not the whole hierarchy) already explicitly excluded elsewhere in this codebase's own
  SNOMED search scope as "not a real clinical finding"; covers follow-up status/arranged, notes
  summary on computer, and letter sent to patient in one root.
- **Diary event recall** (`1239671000000106`) — a system-generated administrative record
  artefact.

All 18 roots were researched via the PUBLIC no-auth NHS termbrowser API (ancestor-chain lookups
confirming ROOT-of coverage — e.g. that LMP's two other wordings and EDD's two other wordings
are genuine descendants of a single concept each), not yet re-confirmed against Medicus's own
live search on a real patient — same provisional caveat as any rules-file entry added without a
live capture.

Several candidates raised in the same discussion were deliberately EXCLUDED: "Student"
(parked — could go either way), and several terms with no confident SNOMED match found via
public search (Routine Child Health Exam, Elderly Health Assessment, Flu immunisation protocol,
Health Clinic) — left for a future session with a real patient example.

18 new coverage checks in `test-problem-junk-code-cleanup.js` (58 total, up from 40).

## [v3.190.0] — 2026-07-25

### "Fix description" scan gains two more independent checks: Read-code-derived text, generic import noise

Two more requests from the same live-testing session as v3.188.0/v3.189.0's retirement
scan and manual search box.

**Legacy Read-code-derived descriptions.** Real example: `359609001` "Acute nonsupp.
otitis media R" — `problemCode.originalCodes: [{codeSystem:"read-v2", code:"F510.00",
description:"Acute non suppurative otitis media"}]`. A DIFFERENT, structural signal from
everything else this tool checks: not a text pattern (no `[X]`/NOS/NEC/H-O marker, so
`looksOutdated()` never catches it) and not retirement (the concept can be entirely
current) — the description text still carries the OLD Read code's own abbreviated wording
verbatim. Per the user: these "almost always need cleaned up even where they've been
forward-mapped to a valid SNOMED code," so this flags independently of retirement status.
Only available from `slideover/overview` (confirmed live — NOT confirmed present on
`edit-problem`'s own shape, so this fetches that endpoint separately rather than assuming),
so — like retirement — only ever checked by the opt-in scan, one more fetch per active
problem. Only `codeSystem: "read-v2"` is recognised (confirmed on two real examples now);
other Read-derived codeSystem values would need their own live confirmation first.

**Generic GP2GP-import "Additional info" text.** Real example: `additionalInformation:
"ear\nActive Problem, Significant"` — "ear" is a genuine free-text note, the second line
is pure boilerplate restating `problemStatus`/`significance` metadata already captured
structurally elsewhere on the problem. New `rules/generic-additional-info-text.json`
(starting with `"Active Problem, Significant"`) and `stripGenericAdditionalInfoLines()` —
matching is PER LINE (split, trimmed, case-insensitive), never against the whole field, so
a genuine note sharing the field with a generic line is always preserved. Offered on
**every** open panel regardless of trigger (the field is already fetched for any flagged
row) — new "Remove generic import text" button submits `additionalInformation` with just
the matched line(s) stripped, `problemCode` completely unchanged (`buildEditProblemPayload`
gained an optional `overrideAdditionalInformation` third parameter for this, backward
compatible with every existing 2-argument caller). The safest apply path in this file —
surgical removal of an exact-matched known-boilerplate string, no coding decision at all —
styled plainly rather than with any risk-graded colour.

Both checks are folded into the SAME opt-in "Check for retired/legacy codes?" scan as the
retirement check (button/status text updated to reflect all three), since all three reuse
data already being fetched per active problem — the generic-text check in particular costs
nothing extra at all, reusing the SAME edit-problem fetch every row already needed.

24 new tests across `test-problem-description-cleanup.js` (171 total, up from 147).

## [v3.189.0] — 2026-07-25

### "Fix description" gains a manual search box

v3.188.0's retirement scan shipped and was confirmed live the same day — flagging real
retired codes (`30989003`) and correctly suggesting confirmed replacements (`1003722009`).
This adds one more panel section, motivated by a real problem on the same patient: "H/O:
urinary disease-UTI's" is better coded via "UTIs", but that's neither a same-concept
synonym, a hierarchy descendant, nor an exact text match of the current description — none
of the four automated categories could ever find it.

New manual search box (`content-scripts/problem-description-cleanup.js`), shown at the
bottom of every open panel regardless of whether the automated categories found anything.
Reuses the same broad `SEARCH_PATH` query the automated categories already call, but
**deliberately unfiltered** — `normalizedSearchResults` returns every result across every
concept the search finds, not narrowed to one conceptId or one exact text match like every
other function in this file. This is the ONE category with no automated safety constraint
at all, functionally identical to typing into Medicus's own Edit Problem search box —
styled in neutral grey, explicitly separated from the amber/blue/orange/red/green
risk-graded categories above it, with copy stating plainly there's no automated check.

6 new tests in `test-problem-description-cleanup.js`.

## [v3.188.0] — 2026-07-25

### "Fix description" gains a "Check for retired codes?" scan

Extends `content-scripts/problem-description-cleanup.js` with an opt-in scan that checks
every ACTIVE problem's own SNOMED conceptId against the public, no-auth NHS SNOMED CT
UK-edition termbrowser API (`termbrowser.nhs.uk` — a SEPARATE service from the official
NHS England Terminology Server FHIR API, which requires a system-to-system account that
can't be safely embedded in a distributed browser extension; new host permission
`https://termbrowser.nhs.uk/*`). A confirmed-retired problem gets its "Fix description"
button injected the same way a text-flagged one does — reusing all of that flow's existing
apply/safety machinery — with a new retirement banner rendered above the usual suggestion
categories.

**Deliberately routes to "Fix description", never "Bulk remove?"** — an explicit user
correction during design: retirement of a SNOMED code doesn't by itself mean the clinical
data entered is invalid or that the problem isn't real; it only means the CODE needs
attention. Two real examples confirmed live: `184063008` ("Patient signed registration
form") is retired with NO replacement recorded (`memberships[]` has an inactivation-reason
entry, "Nonconformance to editorial policy component", but no historical-association
pointing anywhere); `398307005` (the LSCS code already documented in this repo) is retired
WITH a confirmed `REPLACED BY` replacement, `788180009`. Both cases feed into the SAME
existing description-search flow (same-concept/descendant/cross-concept/hint-expanded), so
even the no-replacement case still gets the clinician a route to an active code via text
search — plus, when a `REPLACED BY` association exists, a new highest-trust "SNOMED
confirms the replacement code" suggestion appears above everything else (green, distinct
from the amber/blue/orange/red risk-ordered categories already there — this one isn't a
risk category, it's the closest thing to a verified answer this tool offers). That
suggestion is only offered as a clickable button once Medicus's OWN search index is
confirmed to recognise the replacement concept (`confirmedReplacementAlternative` in
`content-scripts/problem-description-cleanup.js`) — a `descriptionId` invented from
termbrowser's raw SNOMED data wouldn't necessarily match what Medicus's own index expects
on save, so an unmatched replacement is shown as text only, never a button.

**Only the confirmed `REPLACED BY` association type (refset `900000000000526001`) is
implemented** — SNOMED's historical-association family also includes SAME AS, POSSIBLY
EQUIVALENT TO, MOVED TO and others, none of which have a live-confirmed example yet, so
their refset IDs are deliberately NOT hardcoded (this codebase's standing rule: never
hardcode a SNOMED metadata ID without live confirmation). Both real captures also carry an
unrelated `ASSOCIATION`-type membership (`1322291000000109`, "NHS Care Record Element
association") that is explicitly excluded from replacement detection — confirmed as a
confusable case, not a replacement pointer.

**Opt-in, not automatic** — checking every active problem costs one Medicus fetch per
problem (reusing the same edit-problem endpoint "Fix description" already calls) plus one
external termbrowser fetch per distinct conceptId; real per-patient cost, so this is its
own "Check for retired codes?" trigger, same class as `problem-junk-code-cleanup.js`'s
"Bulk remove?" scan, never run automatically on page load. The release-string config
(`rules/snomed-terminology-server.json`, currently `v20260603`) fails closed to
"unknown, skip" on any error or the literal `false` this API returns for an unrecognised
release/edition path (confirmed live) — never guesses active or inactive when the check
itself didn't cleanly succeed.

New `shared/snomed-retirement.js` (entity-agnostic parsing, mirrors the
`shared/legacy-coded-description.js` split), new `rules/snomed-terminology-server.json`.
30 new tests in `test-snomed-retirement.js`, 10 new tests in
`test-problem-description-cleanup.js`.

## [v3.187.0] — 2026-07-25

### "Bulk remove?" widget: third root added — "Patient signed reg. form"

Added `184063008` ("Patient signed reg. form") as a third root in
`rules/non-problem-root-codes.json` — a Read-v2-migrated concept (original code `9122.00`)
recording that a patient signed a registration form, pure administrative record-keeping,
never a real clinical problem. Found live on a real patient while investigating whether
Medicus's API exposes SNOMED concept retirement status (see below) — added as its own root
regardless of the retirement question, since it's unambiguously the same category of
administrative noise the widget already targets.

**Investigated, not built: automated retired-SNOMED-code detection.** Captured the full
`slideover/overview`, `edit-problem` prefill, and SNOMED search responses for a real
`184063008`-coded problem, looking for any `active`/`retired`/`status` field to reuse this
widget's mechanism for a different purpose. None of the three responses expose one. The
closest candidate signal, `descriptionId: null` on the problem's own code, is already used
elsewhere (`problem-description-cleanup.js`'s outdated-description detection) but is NOT
exclusive to retired concepts — `test-problem-description-cleanup.js`'s own test fixture
has a `descriptionId: null` example for a presumably normal, current concept ("Adult
attention deficit hyperactivity disorder"). Building a detector on this would risk flagging
genuinely active, correctly-coded problems — a patient-safety-relevant false positive, not
a cosmetic one — so this was deliberately not built. Would need a real API-exposed
active/inactive field to revisit safely.

2 new tests in `test-problem-junk-code-cleanup.js` covering the new root entry.

## [v3.186.0] — 2026-07-25

### "Bulk remove?" widget: second root added — item-of-service claim-status codes

Added `12821000000103` ("Item of service claim statuses") as a second root in
`rules/non-problem-root-codes.json` — no code change needed, per the data-file convention
this widget was built around (v3.183.0). Same rationale as the first root (14734007
"Administrative procedure"): GP2GP source systems sometimes file item-of-service
claim-status codes as problems even though they're pure claim-processing artefacts, never
a real clinical problem. Real example found live 2026-07-25: `"FP/RF - new reg.check to
FPC"` (a new-registration check submitted to the old Family Practitioner Committee).

2 new tests in `test-problem-junk-code-cleanup.js` covering the new root entry.

## [v3.185.0] — 2026-07-25

### "Fix description" now also catches "H/O" (history of) legacy-prefixed problems

Extends the existing legacy-description detection (`shared/legacy-coded-description.js`,
used by `content-scripts/problem-description-cleanup.js`'s "Fix description" button) to
also flag a leading "H/O" ("history of") free-text prefix — either "H/O " (space) or
"H/O:" (colon, the variant actually found live once the first version of this shipped) —
alongside the existing ICD-bracket ("[X]"/"[D]"/"[M]") and trailing NOS/NEC patterns.

**Deliberately NOT added to the "Bulk remove?" junk-problem-code widget** (v3.183.0-
v3.184.0) — that widget ENDS a problem with reason "not a problem", which is only correct
for genuine non-clinical administrative artefacts. A "H/O stroke" entry is real clinical
history, not noise, and ending it would delete a genuine past-medical-history fact.

Instead this reuses the SAME-CONCEPT-ONLY safety rule "Fix description" already relies on:
`sameConceptAlternatives` only ever offers a different synonym of the CURRENT conceptId,
never a re-code to a different concept — so whatever the flagged problem's concept
actually means, every offered alternative means the same thing, only the wording changes.
Per explicit user correction during build (their own real-data experience, not a generic
assumption): these "H/O"-prefixed problems are USUALLY coded to the plain disease concept
itself, picked for convenience at the time of writing rather than accuracy — not to a
dedicated SNOMED "history of X" concept — so the suggested alternatives should almost
never carry "history of" wording, and that's the intended outcome, not an edge case.

New `LEGACY_HO_PREFIX_RE` in `shared/legacy-coded-description.js`, folded into
`looksOutdated`/`stripLegacyMarkers`. 13 new tests plus an updated `findOutdatedProblems`
case, all in `test-problem-description-cleanup.js`.

## [v3.184.0] — 2026-07-25

### "Bulk remove?" widget: moved next to the "Major" heading

Follow-up to v3.183.0's "Bulk remove?" widget. Live DOM capture of the Active Problems
card confirmed its actual shape: `.m-card-v2__content > h3#problems-major-label ("Major"),
ul[aria-labelledby="problems-major-label"], …` — "Major" is a section heading for the whole
major-problems list, not a per-problem badge. The widget already landed in the right DOM
position (right after that heading, right before the list) but rendered as its own stacked
block below it.

Two changes: `injectTrigger()` now anchors explicitly on `ul[aria-labelledby=
"problems-major-label"]` rather than "whichever list holds the first cached problem", so
it lands next to "Major" specifically even when clinical-summary's own problem order
starts with a minor one (falls back to the old anchor if no Major section exists on the
page at all). And new CSS makes the collapsed toggle sit on the same row as the heading —
scoped via `.m-card-v2__content:has(> #ms-pjc-widget)` so the layout change can't leak
onto Medicus's other cards that reuse the same generic `.m-card-v2__content` class —
dropping to its own full-width row only once expanded.

`problems-minor-label` is assumed by naming symmetry, not confirmed live (the capture
patient had no minor problems) — documented as an assumption in the code, not relied on.

A **text-based visibility pre-check** (only show the trigger button when a problem's free
text looked like a likely match) was also tried during this same round of follow-up work,
then reverted before ever shipping: live testing showed it could hide a GENUINE code-based
match whose free text didn't happen to contain a configured hint (the "FP/RF - new
reg.check to FPC" case above needed a hint added after the fact just to make the button
appear). The trigger button always renders whenever a patient has any active problems, same
as the original v3.183.0 behaviour — the code is the sole source of truth for what this
widget flags, and it must always be reachable regardless of how unrelated a problem's free
text looks.

## [v3.183.0] — 2026-07-24

### "Bulk remove?" widget: flag and end administrative-noise problem-list codes

GP2GP-imported records can carry entries in the problem list that were never real clinical
problems — administrative/claim-processing artefacts some source systems file as problems
(the motivating real example: FP10 temporary-resident-claim codes, filed under SNOMED
14734007 "Administrative procedure"). New `content-scripts/problem-junk-code-cleanup.js`
(+`.css`) adds a small "Bulk remove?" toggle above the Active Problems list on the Clinical
Summary page.

Clicking it fetches each active problem's own conceptId (one fetch per problem — the cheap
`clinical-summary/summary` list never carries a conceptId, text only) and checks each
distinct code against `rules/non-problem-root-codes.json`'s configured root list via
`clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=<all roots,
comma-joined>&query=<conceptId>` — flagged if the code exactly matches a root or is a
DESCENDANT of one at any depth (confirmed live reaching 5 hierarchy levels below 14734007
for the real FP10 codes that motivated this). Flagged problems render as a checklist,
unchecked by default, each also checked for active child problems (excluded from bulk
selection, not just warned, if ending it would affect dependents) via the confirmed
`clinical/data/problem/end-problem/{problemId}` prefill. A shared, editable end-date field
(defaulting to today) and the fixed reason `"not a problem"` are submitted per selected
problem via `POST clinical/problem/end-problem` — confirmed contract, from a real captured
HAR of a manual "end problem" action, `{problemId, endDate, reason} → 200 {}`.

**Root list is data, not code**: 14734007 is the first entry in
`rules/non-problem-root-codes.json`, not a hardcoded special case — adding another root
there (a different import-noise category from a different source system) extends the
check with no code change and no extra fetch cost per candidate, since every configured
root is checked in ONE combined `constrainingParentConcepts` query rather than one query
per root. A blank-query fetch to enumerate a root's full descendant set up front was
deliberately avoided: 14734007 alone has 103 direct children per the SNOMED CT browser,
and that endpoint caps at ~20 results with no pagination, so it would have silently missed
most of the hierarchy — checking each patient's own problem conceptId individually never
hits that cap.

**Scope decision**: the scan is opt-in only, triggered by the "Bulk remove?" click — never
proactive on page load, since the per-problem conceptId fetches would add real cost to
every Clinical Summary view for what's a comparatively rare artefact. The cheap
clinical-summary fetch (used only to place the trigger button) still runs on page load,
matching `problem-description-cleanup.js`'s existing precedent.

`test-problem-junk-code-cleanup.js` — 36 tests covering the roots-CSV builder, the
flagged/descendant check, bulk-selectability rules, per-problem conceptId resolution, and
the end-problem payload shape.

## [v3.182.0] — 2026-07-23

### "Save attachment as document": per-attachment chip replaces the single anchored widget

Live-tested v3.181.0's priority-chip picker on a real 3-attachment task and found a
placement regression: the widget anchored near a task-level landmark ("Codes & actions"
card / task widget / bottom action row) in that priority order, with the attachment's
own card only a last resort. On a task that DOES have a "Codes & actions" card, that
landmark sits well below the message thread — so the widget (and the task widget it
paired side-by-side with) ended up far from the attachment it was actually for. With
several attachments in one request, that also meant only ONE collapsed widget with an
attachment dropdown, easy to miss (confirmed live: a user with 3 attachments didn't
notice the dropdown existed at all).

Replaced the whole anchor-priority chain with a small "Save as document" chip injected
immediately after EACH eligible attachment's own link/button — every attachment gets its
own unambiguous entry point right next to the file it's for, no dropdown needed. Clicking
a chip opens a single shared form (there is only ever one on the page) and relocates it
to sit right after that chip; clicking a different attachment's chip moves the same form
there and re-populates it, rather than opening a second form (a design choice — an
independent form per attachment was considered and deferred as a bigger change for little
benefit). A chip already saved this page visit shows "✓ Saved as document" and disables
itself, so progress across several attachments is visible at a glance. The old collapsed
toggle bar, its "Attachment" dropdown, and the "Save another attachment" flow are gone —
superseded by the per-attachment chips. (`content-scripts/document-file-inline.js`,
`.css`; `content-scripts/task-inline.css` — removed a now-dead `.ms-inline-widget-row`
rule that only ever existed to pair with the removed widget.)

Two more fixes from the same live-test pass, on the chips themselves:

- **Layout**: a chip inserted as a plain next sibling of the attachment's own button
  dropped onto its own line below it (Medicus's attachment button is block-level), not
  alongside it as intended. Fixed by wrapping the attachment element and the chip
  together in a small `inline-flex` span (`.ms-df-chip-wrap`) instead of a plain sibling
  insert, so they render on one line.
- **Real bug, confirmed live**: clicking a chip was opening Medicus's own "view care
  related communication" pane — an unrelated side effect. Root cause: the chip is a DOM
  sibling inside whatever container Medicus wraps each attachment/message in, and that
  container has its own click handler; the chip's click was bubbling into it. Fixed with
  `stopPropagation()` on the chip's click handler, and (defensively, since the form can
  also end up inside that same container once relocated) one `stopPropagation()` listener
  on the form's own root rather than on every individual control inside it.

### Document type picker: dropped the priority-tier chip shortlist for a ranked, colour-coded search

Both fixes above confirmed live in the same session, then a bigger rethink: the
docPriority 1-6 scoring behind v3.181.0's priority-chip shortlist was built with INBOUND
documents in mind (scanned letters, referrals, discharge summaries), not task
attachments — the author flagged that the resulting shortlist "isn't right for this
environment" once seen live. Rather than trust it as a hard shortlist, it's now used as a
SOFT ranking + colour signal instead:

- The priority/priorityMore chip tiers and the "Show more document types" toggle are
  gone. The search box (which already shows the current best-guess by default, unlocking
  into search on typing — unchanged) is now the only thing in the Document type row, no
  chips above it.
- `filterDocumentTypes` now ranks matches by docPriority (1 first), alphabetically
  tiebroken, instead of original list order — typing e.g. "care plan" surfaces the
  highest-priority matches first rather than whatever order they happen to sit in the
  1768-entry list.
- Each search result gets a coloured left border on a fixed 6-step green(1)→red(6) scale
  (new `priorityColor()`); an entry with no/invalid score gets its own neutral grey
  rather than being lumped in with a real tier-6 ("junk") score.
- `rules/document-types.json` now carries `docPriority` directly on every entry (all
  1768, sourced from the full practice-scored priorities spreadsheet) instead of the two
  `priority`/`priorityMore` conceptId-array tiers, which are removed.
- `buildPriorityEntries` (the now-unused shortlist-resolver) is removed along with its
  tests; `test-document-file-inline.js` gained coverage for the new ranking and colour
  function instead.

## [v3.181.0] — 2026-07-23

### Document-type quick-pick shortlist: tiered "Show more" chips

`rules/document-types.json`'s `priority` array (the quick-pick chip shortlist in the
"save attachment as document" widget) had shipped empty since v3.177.4 — the picker only
ever had full search, no shortlist. Populated from a full docPriority 1-6 usefulness scan
of all 1768 SNOMED document-type codes in the refset, scored against real practice usage.

`priority` now holds the 22 docPriority-1 ("most useful/commonly selected") codes, shown
as chips by default. A second `priorityMore` array holds the 84 docPriority-2/3 codes
("high priority anchor" / "genuinely selected, narrower"), revealed only via a new "Show
more document types" toggle in `content-scripts/document-file-inline.js` — keeps the
default chip row short and scannable while still making the wider shortlist reachable in
one click, without ever falling back to a 106-chip wall or the full 1768-entry search.
Both tiers sorted alphabetically by description. `buildPriorityEntries` (unchanged) now
resolves either array; new regression tests confirm every conceptId in both tiers
resolves to a real entry and that the two tiers don't overlap.

## [v3.180.0] — 2026-07-23

### "Fix description" widget: fourth suggestion category — hint-expanded matches

Follow-up to the "[SO]" codes deferred at the end of v3.179.0. Live-captured a real
"[SO]Rotator cuff" problem (additional info "-tear") that got NO suggestion of any kind.
Root cause — a DIFFERENT bug class from the word-mismatch fix in v3.179.0: `7885001` is a
SNOMED **body structure** concept ("Rotator cuff (structure)"), not a disorder, so it can
never appear in the disorder/procedure-hierarchy search that same-concept and
cross-concept-exact matching both depend on. Confirmed live: searching "rotator cuff
tear" in that hierarchy finds `926335004` "Rotator cuff tear" — exactly what the "-tear"
free-text note was pointing at.

New fallback category, tried only when same-concept, descendant, and cross-concept-exact
all come back empty (one extra search in that case, zero extra fetches otherwise):
combines the base description with a recognised pathology word (tear, sprain, rupture,
valvular, …) found in the first sentence of `additionalInformation`, and offers the
result as a cross-concept suggestion. This is the riskiest of the four categories now
offered — no hierarchy proof, and two combined text fragments rather than one exact
match — so it renders in its own most-cautious red section, one step past the existing
warning-orange cross-concept styling.

Explicit scope decision, discussed and agreed: an anatomical-structure concept should
never really be coded as a "problem" in its own right, which is what makes this safe to
offer per-problem now. But when/if a whole-record bulk-correction feature is built later,
this category must NEVER be bulk-auto-applied — unlike same-concept and cross-concept-
exact matches, which could eventually be "easy" bulk cases, this one must always prompt a
clinician.

21 new unit tests using the real captured rotator-cuff data. Not yet confirmed live.

### "Fix description" widget: descendant suggestions generalised beyond laterality, ranked by match %

Real example: a patient's "Hysteroscopy NEC" (`233545006`) problem — already correctly
offered a same-concept relabel — had `additionalInformation` "resection of uterine
fibroid", and a genuine SNOMED descendant exists: `84064003` "Hysteroscopy with removal of
uterine fibroid" (confirmed via live capture — its `parentConceptIds` contains
`233545006`, exactly the same ancestry proof already used for laterality descendants).
`descendantAlternatives` previously only ever tried a single laterality word (rt/lt/
bilateral); it now accepts an arbitrary list of hint words (still fully backward
compatible with a single string), sourced from the laterality word (if any) plus every
significant word found anywhere in `additionalInformation`.

Two rounds of live-testing feedback refined this further:

- **Retrieval**: rather than guessing individual words to search for (which can silently
  miss a real descendant worded differently, e.g. "Hysteroscopic myomectomy" never
  contains "fibroid"/"resection"), a single BLANK-QUERY fetch (`query=` empty, confirmed
  live) returns the full descendant set of the current concept directly, bypassing text
  matching at the retrieval stage entirely. One fetch, not one per word. Not provably
  complete (no total/pagination field in the response), but far more complete than
  per-word guessing.
- **Hint scope**: `additionalInformation` is now scanned in FULL, not just its first
  sentence. A real case — "& laparoscopy. resection of fibroid." — put the clinically
  relevant detail in the SECOND sentence, past the original first-clause cutoff, so it was
  silently missed. (The narrower first-clause scope remains correct and unchanged for the
  separate `hintExpandedAlternatives`/pathology-word category, which has no structural
  safety net and so stays conservative about how much free text it trusts.)
- **Ranking, not just filtering**: each candidate now gets a `matchScore` (0-100%, the
  proportion of hint words found in its own wording), shown next to the button (e.g.
  "removal of uterine fibroid (67% match)" vs. "removal of uterine myoma (33% match)"), and
  results are sorted best-match-first. Still literal word-boundary matching, not clinical
  synonym-awareness — deliberately: catching "myomectomy" as a fibroid-removal synonym
  would need either a curated synonym dictionary or an actual semantic-similarity call
  (sending patient free text to an LLM), and the user explicitly chose to keep this pass to
  keyword overlap rather than open that architecture/data-handling discussion now.

Deliberately offered ALONGSIDE same-concept alternatives, not gated behind "nothing else
matched" — the same-concept relabel and the more-specific descendant are both valid,
independent choices for the clinician to pick from.

19 new unit tests (`significantWords`, the generalised + scored `descendantAlternatives`)
using the real captured Hysteroscopy/fibroid data. Not yet confirmed live.

## [v3.180.1] — 2026-07-23

### "Fix description" widget: fixed cross-concept matching for a retired legacy concept

Investigated why "Lower uterine segment caesarean section (LSCS) NEC" (`398307005`) got
NO suggestions at all. A different root cause from both the word-mismatch and
body-structure bugs already fixed: `398307005` is a RETIRED/inactive SNOMED concept
(confirmed via the SNOMED CT browser — no parents or children), invisible to every search
regardless of wording. Its real active replacement, `788180009`, has a synonym worded
exactly like the current description — but only once the trailing "(LSCS)" abbreviation
is ALSO stripped, alongside the existing "NEC" suffix strip.

`stripLegacyMarkers` now also strips a trailing bracketed abbreviation (2-6 letters)
exposed once the NOS/NEC suffix is removed, letting `crossConceptAlternatives` find the
exact match. Accepted, explicitly-flagged risk: this is a simplification that could
mis-fire if a bracketed suffix is ever integral to a description's meaning rather than a
legacy artefact — mitigated by `crossConceptAlternatives` already requiring explicit
clinician confirmation before applying, and by this only ever running on descriptions
already confirmed outdated. 3 new unit tests using the real captured LSCS/caesarean-section
data.

## [v3.179.0] — 2026-07-23

### "Fix description" widget: surfaces the raw additional-info text

The panel now shows the problem's raw `additionalInformation` free text (when present),
regardless of whether the tool found any suggestion — supports the clinician's own
judgement call even in cases the tool can't yet match (e.g. the "[SO]" codes flagged for
follow-up). Neutral grey styling, deliberately distinct from the three suggestion
categories' colours so it doesn't read as an actionable option itself.

### "Fix description" widget: fixed a silent word-mismatch search failure

Found live-testing on a patient with "Primary total knee replacement NEC" (a legacy
Read-code-migration label): the search returned ZERO results for the whole widget, not
just the new descendant suggestion. Root cause — Medicus's description search requires
EVERY word in the query to appear in a result; the real modern descendants ("Total
replacement of left/right knee joint") don't contain the word "Primary" anywhere, so the
entire query silently failed. This affected the SAME-CONCEPT alternatives too (the
original, already-shipped v3.176.13 flow, formerly numbered v3.178.0), not just today's new work — any legacy
description with a word not echoed in its concept's modern phrasing could silently
return nothing, with no error, just an empty "no alternative found" panel.

Two supplementary searches fix this, both confirmed live, both additive (never replace
the existing broad query, only add candidates to it):

- Same-concept alternatives now also query by a bare SCTID (`query=<conceptId>`), which
  reliably returns that concept's own synonyms regardless of text phrasing.
- Descendant/laterality suggestions now also run a narrowed search
  (`constrainingParentConcepts=<current conceptId>` instead of the six broad top-level
  hierarchies, `query=<just the laterality word>`) — scoped to true descendants only, so
  a bare "left"/"right" is enough to find them without depending on the parent's own
  wording at all.
- 2 new regression tests using the real captured knee-replacement data.

### "Fix description" widget: fixed duplicate-description row collision

Found live-testing the additions below: if a patient has TWO problem entries with the
IDENTICAL description text, `findProblemRow`'s exact-text DOM match always returned the
FIRST matching row — so both problems' buttons stacked on the first row, none appeared
on the second, and (more seriously) the optimistic post-save text update for either
problem also hit that same shared first anchor. The underlying SAVE was never affected
(`postEditProblem` always targets the real, correct `problemId`, independent of DOM
matching) — only button placement and the on-screen update were wrong. Fixed: `scan()`
now tracks anchors already claimed within a pass (`claimedAnchors`), so the Nth problem
with matching text claims the Nth matching row in document order — each problemId gets
its own distinct anchor.

### "Fix description" widget: now also suggests a more specific code (laterality)

Real example that prompted this: a patient's "Fracture of radius NOS" problem had
free-text additional info "rt distal end" — implying a more specific SNOMED concept
("Fracture of right radius") than the one currently coded. Unlike the existing
description-cleanup flow (which only ever offers a different DESCRIPTION of the SAME
code — a cosmetic relabel), this can suggest a genuinely different, more specific
concept — a real coding decision. Scoped deliberately narrow for this pass:

- **Laterality only** (right/rt, left/lt, bilateral/bilat) — not full free-text-to-code
  NLP, which is large and risky (abbreviation ambiguity means a wrong-but-confident
  suggestion is worse than none).
- **Descendants only, never a lateral recode** — confirmed via Medicus's own
  `outputParentConceptIds=1` search param (added to the existing `SEARCH_PATH`, additive
  and harmless for the existing same-concept search), which returns each result's full
  SNOMED IS-A ancestor closure. The safety test: does the CURRENT concept's ID appear in
  a candidate's `parentConceptIds`? If yes, it's a strict specialisation, safe to offer.
- **Only runs for problems already flagged as outdated** — same trigger population as
  the existing "Fix description" button, same one click, same edit-form fetch that click
  already makes. No new proactive per-patient scanning and no new opt-in affordance,
  because `additionalInformation` (where the laterality hint lives) isn't available
  without a per-problem fetch, and this reuses the one the clinician already triggered
  rather than adding new API cost. Running this across the whole record (every problem,
  other entity types, or hooking into Medicus's own native "Edit Problem" UI) was
  discussed and explicitly deferred, not built here.

- New `shared/coding-specificity.js`: `detectLateralityHint`,
  `descriptionAlreadySpecifiesLaterality`, `descendantAlternatives` — entity-agnostic,
  mirrors the existing `shared/legacy-coded-description.js` split.
- `content-scripts/problem-description-cleanup.js`: same click that opens the panel now
  also computes descendant/laterality suggestions from the same search response; the
  apply path is refactored into a shared `applyCode()` core used by both same-concept
  and descendant candidates.
- `content-scripts/problem-description-cleanup.css`: descendant suggestions render in a
  visually distinct (blue, not amber) section, so a clinician can tell "cosmetic
  relabel" and "different, more specific code" apart at a glance.

### "Fix description" widget: also flags a same-text match under a DIFFERENT code

Second gap found in testing: "[X]Heroin addiction" (`75544000`) has NO same-concept
alternative to offer — the modern term lives under a genuinely different concept,
`231477003` "Heroin addiction". `sameConceptAlternatives` can never surface this by
design (it's a different `conceptId`), so nothing was offered even though a clean fix
exists.

- New `crossConceptAlternatives` in `shared/coding-specificity.js`: finds a DIFFERENT
  concept whose description is textually IDENTICAL to the current one once legacy
  markers are stripped, reusing the exact same search response — zero new API calls.
  This is the riskiest of the three categories now offered (no hierarchy proof, unlike
  descendants — only a text match), so it renders in its own warning-orange section with
  explicit "⚠ Different SNOMED code, same description — verify before applying" copy,
  visually distinct from both the amber same-concept and blue descendant sections.
  **Scope note**: this only catches an EXACT text match — it will not catch a
  differently-worded modern replacement (e.g. "Opioid dependence" for the same old
  code), which would need real terminology-mapping data, not a text match.
- `shared/legacy-coded-description.js`: the outdated-description detector now also
  treats a trailing **" NEC"** (Not Elsewhere Classified) as a legacy marker, alongside
  the existing "[X]"/NOS handling.
- 12 more new tests in `test-problem-description-cleanup.js` (37 new in total for this
  release, 73 overall), including a fixture built around the real "[X]Heroin addiction"
  example.

## [v3.178.1] — 2026-07-22

### "Fix description" widget: cleanup from first live test

- **Button now removes itself once the fix is saved**, instead of leaving a
  lingering "✓ Saved" chip — the corrected on-screen text is confirmation
  enough. The panel is removed at the same time.
- **Tightened the button's padding/line-height** — it was taller than
  Medicus's own tightly-packed problem-list rows, stretching the whole list
  out. Smaller font, explicit `line-height`, less padding.

## [v3.176.13] — 2026-07-22

> Renumbered from v3.178.0 on 2026-07-26: the 2026-07-25 merge from `main` brought in
> main's own v3.178.0 (The Keeper rule-set update), which had been assigned the same
> number independently. This entry keeps its original date and content; its follow-up
> below retains its original v3.178.1 number.

### New: "Fix description" for outdated SNOMED problem codes

Many older problem/diagnosis entries carry a historic Read-code-migration
display string (a `[X]`/`[D]`/`[M]`-style ICD cross-map prefix, or a trailing
`NOS`) even though the underlying SNOMED concept has a perfectly good modern
plain synonym. New inline widget flags these on a patient's Active Problems
list (Clinical Summary tab) and offers a one-click fix — same code, cleaner
description — confirmed end-to-end via a real live capture (see
`docs/learnings-problem-description-cleanup.md`).

- `content-scripts/problem-description-cleanup.js` + `.css`: detects
  candidates via `clinical-summary/summary/{patientId}`'s
  `problemCodeDescription` text, injects a small "Fix description" button
  next to each flagged row (`li.item > a.item__link`, confirmed live), and on
  click searches Medicus's own SNOMED description-search endpoint, filtered
  to alternatives sharing the SAME `conceptId` — this is the safety rule: the
  tool can only ever offer a different synonym of the current code, never a
  re-code to a different clinical concept. Saves via the confirmed
  `clinical/problem/edit-problem/{problemId}` endpoint, resending the FULL
  edit-form prefill with only `problemCode` swapped (a full replace, not a
  partial patch).
- New `shared/legacy-coded-description.js`: the detection heuristic
  (bracket-prefix/NOS-suffix) and the same-concept safety filter are split
  out as entity-agnostic, since problems are the test bed for this feature,
  not the only entity type intended — procedures/referrals/journal entries
  are expected to follow, each needing its own confirmed edit-endpoint
  capture before being wired up.
- 36 new unit tests (`test-problem-description-cleanup.js`) covering
  detection, marker-stripping, the same-concept safety filter, and the
  full-payload builder (including the `recordedAtAnotherOrganisation`
  branch, read straight from the captured `.vue` source, not guessed).
- Not yet verified live end-to-end as a widget (the underlying API calls were
  individually confirmed via capture, but the injected button/panel itself
  hasn't been exercised in the real browser yet).

## [v3.177.7] — 2026-07-22

### Inline task/document widgets: anchor next to the actual attachment, not always the opening message

On a communication-thread task with neither a "Codes & actions" card nor a
"More actions" button, both `task-inline.js` ("Create task for this patient")
and `document-file-inline.js` ("Save attachment as document") fell back to
anchoring right after the "Initial Request" card — even when the real
attachment was on a LATER reply further down the thread, which put both
buttons under a message that had no attachment at all.

- New `findAttachmentCard()` (identical copy in both files — both widgets
  need the same anchor decision): matches a real attachment's filename
  (`window.__msTriageAttachments`, content.js's accessor) against the page's
  `<a>`/`<button>` elements and returns the enclosing message card. Tried
  BEFORE the `findInitialRequestCard()` fallback — when there's no attachment,
  or its card can't be found, behaviour is unchanged.
- When the attachment IS on the opening message, this resolves to the same
  card as before (no behaviour change for the common case).

## [v3.177.6] — 2026-07-22

### "Save attachment as document": missed attachments on later replies in a communication thread

Fixes a real live-test miss: a patient photo attached to a "Reply from
Requester" message further down a communication thread (not the opening
message) was invisible to the "save as document" widget. Root cause: `content.js`'s
attachment scan was scoped to the "Initial Request" card only
(`findCardByTitle('Initial Request')`) — and confirmed live, a reply card has
no `h2`/`h3`/`h4` heading at all, so it could never be found that way even in
principle.

- `extractInitialRequest()`'s attachment detection is now a page-wide scan
  (new `extractAllAttachments()`) instead of being scoped to one specific
  card — any `<a>`/`<button>` anywhere on the task page whose text/href ends
  in a known attachment extension is picked up, deduped by filename. Verified
  safe against false positives via a full-page link/button text dump on the
  task that surfaced this bug: exactly one match, the real attachment: nothing
  in Medicus's own nav/page chrome collided.
- The "Initial Request" card is still used for the request-text snippet
  (`ir.text`) — only the attachment scan was widened.

## [v3.177.5] — 2026-07-22

### "Save attachment as document": fixes from first live test of the picker

- **Selection now shows in the search box.** Picking a document type (via a
  priority chip, a search result, or the extension-based pre-select) used to
  clear the search box back to empty, so the picker looked unselected even
  though a type was in fact active — the box now displays the selected type's
  name, and the results dropdown stays hidden until the clinician actually
  starts typing again.
- **Document date now defaults to when the triage request was received**,
  not the date the clinician happens to action the task. `content.js` now
  exposes the task's own "Created" date (`window.__msTaskCreatedDate`, reusing
  the same parse already done for the "days open" chip) and
  `document-file-inline.js` prefers it over the create-form's own
  `recordDate` default (today).
- **Layout: "Create task for this patient" and "Save attachment as document"
  now sit side by side** instead of stacked, when both are present on the
  same task — `document-file-inline.js` wraps the two widgets in a shared
  flex row (`.ms-inline-widget-row`) the first time either is injected; each
  widget's own body still opens full-width in its own column when expanded.

## [v3.177.4] — 2026-07-20

### "Save attachment as document": full SNOMED document-type picklist (priority shortlist + search)

Replaces the previous 2-code-only assignment (image → "Medical photograph",
pdf/doc → "Patient/Carer Correspondence") with the full active picklist
behind Medicus's own "Document type" refset, plus a proper picker.

- New `rules/document-types.json` — 1768 active entries imported from the
  user's June 2026 SNOMED CT UK Clinical Extension export of the "Record
  composition type" simple reference set (`1127551000000109`), 140 inactive
  members excluded. Both previously hard-coded codes were found in it at the
  expected rows, byte-identical — strong corroboration the import is correct.
  Carries an editable `priority` array of conceptIds (empty for now) driving
  a quick-pick shortlist — add ids there to change it, no code change needed.
- `content-scripts/document-file-inline.js`: the extension-based guess still
  PRE-SELECTS a default document type (least friction for the common case),
  but the clinician can now override it via priority-shortlist chips or a
  live search box (case-insensitive substring match over all 1768 entries,
  capped at 40 results) before saving — nothing is filed without an explicit
  documentType set. The full picklist is loaded once per page load from the
  bundled JSON (a local extension resource, not a Medicus call) and cached.
- **Ancestor/parent-concept filtering investigated and ruled out**: Medicus
  does not store a `parentConceptIds`-style hierarchy for Document entities
  (confirmed via the live "Document type" search endpoint's own response
  shape, and separately via two HAR-file captures) — there is no SNOMED
  hierarchy available to prune or group the picklist by. Recorded in
  `docs/learnings-triage-attachment-to-document.md` §9 so this isn't
  re-investigated without new evidence.
- `manifest.json`: `rules/document-types.json` added to
  `web_accessible_resources` alongside the other bundled rule files.
- 88/88 tests passing in `test-document-file-inline.js` (34 new, covering the
  imported data itself, the search/priority-resolution functions, and the
  updated eligibility rule).

## [v3.177.3] — 2026-07-20

### Inline widgets: fixed the missing anchor point on communication-thread tasks

Follow-up to v3.177.2's attachment-detection fix. That task type has neither
a "Codes & actions" card nor a "More actions" button — the two anchors
`task-inline.js` and `document-file-inline.js` rely on — so both widgets had
nowhere to inject themselves there even after attachment detection was fixed.

- Both files gained a further fallback: anchor after the "Initial Request"
  card itself, matched by its EXACT heading text (not content.js's own
  looser starts-with match, so this can never mis-anchor on an unrelated
  section). Confirmed live: every request/communication task type seen so
  far has this card, including a task with no attachment at all.
- `task-inline.js` gets the same fix since it has the identical gap on this
  task type — one root cause, one fix, applied to both consumers.
- `docs/learnings-triage-attachment-to-document.md` §8 updated to record the
  fix (was previously flagged as a known open gap).

## [v3.177.2] — 2026-07-20

### "Save attachment as document": fixed invisible widget — attachments aren't always an `<a>`

Live debugging (page-console DOM/network capture) found the widget never
appeared on a real communication-thread task with a genuine attachment. Root
cause: that task type renders the attachment as a plain `<button>` labelled
with the filename and no href at all — `extractInitialRequest()` only ever
scanned `<a>` tags, so a real attachment was silently invisible to it.

- `content-scripts/triage-lens/content.js`'s `extractInitialRequest()` now
  also detects this button pattern, recording `{ href: '', filename }` for it
  instead of dropping it.
- `content-scripts/document-file-inline.js` accepts these as eligible (same
  filename-extension rule as before) and resolves the real download URL
  lazily — via the SAME `/tasks/data/{slug}/overview/{taskUuid}` fetch already
  made for patient resolution (one fetch now serves both needs), matched by
  filename against a live-confirmed `{id, fileName, fileSize, contentType,
  fileURI}` attachment shape found in that response
  (`findAttachmentsInOverview` walks the whole response tree rather than a
  hardcoded path, so it isn't tied to one task type's JSON nesting). The
  download itself replays the confirmed
  `GET /communication/data/online-message/download-attachment/{id}` contract
  — one GET, raw file bytes, no signed-URL indirection. No new eager network
  call: the fetch already happened when the widget opened, it just also
  returns attachment metadata now.
- `docs/learnings-triage-attachment-to-document.md` §8 records the full
  capture (button markup, download contract, task-overview JSON shape).
- **Known remaining gap, not fixed here:** this same task type has neither a
  "Codes & actions" card nor a "More actions" button — the two anchor points
  every inline widget on this page relies on — so the widget still has
  nowhere to inject itself there even with attachment detection fixed. Left
  for a follow-up.
- `test-document-file-inline.js` extended with coverage for the new
  resolution functions and the updated eligibility rule (62/62 passing).

## [v3.177.1] — 2026-07-20

### "Save attachment as document" — extended to PDF/Word attachments

A follow-up live capture confirmed a second real SNOMED `documentType` code —
"Patient/Carer Correspondence" (`163181000000107`) — for non-image
attachments, obtained by searching Medicus's own "Document type" field
independently of the attached file (the search-select is unrelated to the
`file` field, so this didn't need a real submitted PDF). Combined with the
already-confirmed "Medical photograph" code, every attachment extension
`content.js`'s `extractInitialRequest()` recognises (pdf/doc/docx and
jpg/png/gif/tiff/heic) now has a confirmed type, so the widget's previous
"images only" restriction is lifted — it picks the correct type automatically
by file extension, still with no live search and no guessed codes.

- `content-scripts/document-file-inline.js`: `documentTypeForFilename()`
  replaces the old image-only eligibility check; `DOCUMENT_TYPES` holds both
  confirmed codes.
- `docs/learnings-triage-attachment-to-document.md` updated with the new
  capture.
- `test-document-file-inline.js` now covers both document types (40 tests).

## [v3.176.12] — 2026-07-20

> Renumbered from v3.177.0 on 2026-07-26: the 2026-07-25 merge from `main` brought in
> main's own v3.177.0 (Triage North Star wave 1), which had been assigned the same
> number independently. This entry keeps its original date and content; its follow-ups
> above retain their original v3.177.1–.7 numbers.

### Triage-lens: "Save attachment as document" — one-click filing for patient photos submitted via triage

The suite's first write-capable feature that creates a brand-new Medicus
record type it has never created before: a clinical **document**. Previously
the only confirmed writes to a document were edit-existing
(`clinical/document/edit-details`) and remove-existing
(`clinical/document/mark-incorrect-and-hidden`) — see
`engine/record-duplicate-parser.js`. Filing a patient-submitted triage photo
onto the record required a clinician to manually download it and use
Medicus's own "Add document" upload feature.

- New inline widget, `content-scripts/document-file-inline.js` +
  `document-file-inline.css`, injected into triage task-overview pages
  alongside `task-inline.js`/`booking-inline.js` (same anchor discipline, same
  credentialed same-origin fetch pattern). Appears only when the task has at
  least one image attachment (jpg/png/gif/tiff/heic) — see below for why.
- Drives Medicus's own `POST clinical/document/create` directly (a single
  multipart request: file bytes + a JSON `formPayload` field) — confirmed via
  a live capture (`scripts/document-create-capture.js`,
  `docs/learnings-triage-attachment-to-document.md`), not guessed. A human
  always presses the explicit "Save as document" button — never auto-submits.
- **Deliberately scoped to image attachments only.** The create call's
  `documentType` is a SNOMED-coded picklist populated by a live search-as-
  you-type endpoint this suite has never captured — the only confirmed real
  value is "Medical photograph" (`820241000000102`). Rather than guess the
  search contract for other types (a wrong SNOMED code would silently miscode
  the record), the widget stays hidden for tasks whose only attachment is a
  PDF/Word file until a follow-up capture confirms that contract.
- `content-scripts/triage-lens/content.js`'s `extractInitialRequest()` (see
  v3.176.11 below) now feeds this widget via `window.__msTriageAttachments`.
- New `test-document-file-inline.js` (28 tests) covers the pure logic:
  attachment eligibility filtering, title defaulting, and the create-payload
  shape against the confirmed contract.

## [v3.176.11] — 2026-07-20

### Triage-lens: capture attachment href/filename, not just a count (groundwork for "save as document")

`extractInitialRequest()` previously only counted `<a>` tags in the Initial
Request card matching a file-extension regex, discarding the actual href and
filename. It now returns `{ text, attachmentCount, attachments }` where
`attachments` is `[{ href, filename }]` per matched anchor — `attachmentCount`
stays `attachments.length` so the existing `detail.attachments` chip is
unaffected. The array is also exposed via `window.__msTriageAttachments` on
every detail render, so a future widget (a one-click "save this attachment as
a document" action, still pending a live API-discovery pass against Medicus's
own create-document endpoint) can read it without a second, divergent DOM
scrape. No user-visible change in this release — the chip and its label are
unchanged.

## [v3.176.10] — 2026-07-17

### Duplicate-checker: fixed the "Remove 0 duplicate copies" / unresponsive-cards bug for linked-problem groups

A targeted live probe (docs/learnings-vaccination-note-duplicates.md, part
2) traced the actual root cause of a reported bug — a group's "Remove N
duplicate copies" button reading "Remove 0" with no entry card individually
selectable. The group in question was `kind=problem`, not `note` as first
suspected: 6 entries, all sharing the exact same real problem-list `id`.

- A `problem`-kind journal entry's `id` is the canonical problem-list
  record's id, not a per-occurrence journal-entry id — and the same real
  problem can legitimately be linked from more than one
  encounter/prescription on the same day (confirmed: a real "Immunisations"
  problem linked from 6 different encounters in one day). Those 6
  occurrences aren't 6 candidate duplicate records, they're 6 references to
  one real record — but `groupAndTier` was treating them as a 6-member
  "duplicate" group. The keeper tie-breaker then picked that one shared id
  as `keeperEntryId`, so every entry matched it and "N duplicate copies"
  computed to `0` with nothing left to toggle.
- `groupAndTier` now dedupes `problem`-kind members by `id` before deciding
  whether a (date, code) bucket is even a duplicate-record candidate — a
  bucket is only a real candidate if at least 2 *distinct* problem ids
  appear in it. Same-record linkage is tracked in a new
  `suppressedProblemLinkage` diagnostic (surfaced in the analysis summary
  line) rather than silently dropped.
- **Fixed a pre-existing test that was asserting the buggy behaviour**: the
  linked-problems test fixture used the identical problem id across two
  encounters and asserted the resulting group had 2 entries — that was
  pinning the exact bug this release fixes. Corrected to assert no group
  forms for same-record linkage, plus a new control case (two genuinely
  distinct problem-list records sharing a code/date) confirming real
  reimport-duplicate detection is unaffected.
- 6 new/corrected parser tests (336/336 passing).

## [v3.176.9] — 2026-07-17

### Duplicate-checker: note-kind false positives from the generic GP2GP problem-review wrapper

Live-reported by the clinical user: three different vaccinations given the
same day were tiering "HIGH - identical text" and offered as one-click
bulk-removable, when they're genuinely different clinical content. Live
investigation (docs/learnings-vaccination-note-duplicates.md) found the
`"{Episodicity : code=..., displayName=..., originalText=...}"` wrapper this
matches on isn't vaccine-specific at all — it's the generic "Problem title"
review stub GP2GP attaches to essentially every problem across a patient's
entire history, and it collapses to the same empty string after
`normText()` regardless of the real underlying content. A real example (Tue
19 Jun 2007) showed three "Immunisations"-coded entries, three different
recorders, sharing this same content-free text — and confirmed that
`consultationTopic.title` (the one plausible disambiguating field) is also
identical across genuinely different concurrent vaccines, ruling out an
automatic content-based fix.

- `buildGroupRecord` now caps a `note`-kind group at REVIEW (down from HIGH)
  when its entire matched text is the content-free wrapper AND its members'
  `recordedBy` differ — deliberately narrow: the EXACT-tier combination
  (empty wrapper + SAME author) is left untouched, since that's a
  live-confirmed genuine GP2GP dual-render duplicate (2026-07-08 "Perianal
  abscess" pair). New `emptyWrapperOnly` flag on the group record.
- `duplicate-checker.js` surfaces a warning on any group flagged this way,
  explaining the match is on a content-free wrapper and to verify
  independently before removing — same treatment as the existing
  `attachmentMismatch`/`fileMatched` warnings.
- 5 new parser tests (333/333 passing), including a regression test pinning
  the 2026-07-08 EXACT-tier case that a broader first draft of this fix
  accidentally broke.
- **Known limitation, not yet fixed**: the REVIEW-tier "These are
  equivalent — remove duplicates" button still routes into the same
  removal-button code path as EXACT/HIGH, which has a separate, not-yet-
  diagnosed bug (reported "Remove 0 duplicate copies", unresponsive entry
  cards) for at least one real group. A targeted live probe for that
  specific bug is prepared in docs/learnings-vaccination-note-duplicates.md,
  pending results.

## [v3.176.8] — 2026-07-17

### Duplicate-checker: accurx URL-attachment false positives in the cross-record file-match pass

Live-reported by the clinical user: accurx delivers a patient message plus
several photo links as separate `.txt`/"Record Attachment" documents, each
one just a `"URL: <link>"` wrapper. The previous GP system's export
templating means these frequently share both `fileType` AND `fileSize` even
though the actual link — and therefore the real attachment — differs, so
`findFileMatchedDuplicates` (the opt-in cross-record file-size/type pass)
was incorrectly clustering genuinely different photo attachments as
duplicates.

- New `accurxAttachmentUrl(code, title)` in `engine/record-duplicate-parser.js`:
  extracts the URL from a title matching the exact reported signature (Type
  "Record Attachment" + title starting "URL:"), case-insensitive, returns
  `null` for anything else — deliberately narrow so no other document kind
  is affected.
- `findFileMatchedDuplicates` now folds the extracted URL into its bucket
  key for entries carrying this signature: same fileType/fileSize/URL still
  clusters as a genuine duplicate, a differing URL never does. Zero extra
  fetch — `title`/`code` are already in memory. New
  `accurxUrlMismatchAvoided` count returned and surfaced in the analysis
  summary line.
- 11 new parser tests (326/326 passing) covering the extraction function,
  the differing-URL exclusion, the same-URL control case (still a genuine
  duplicate), and that an unrelated non-accurx same-fileType/fileSize pair
  is unaffected.

## [v3.176.7] — 2026-07-17

### Duplicate-checker: live-verified prescription/investigation-request journal field names

Continuing the per-patient record-cleansing project
(`docs/learnings-patient-journal-api.md`), prompted by an observation that
prescriptions seem to duplicate via GP2GP reimport on some patients where
lab results don't.

- A PHI-safe field-shape probe (structure only, reuses
  `duplicate-checker.js`'s `describeShape()` no-values convention) was run
  live against a real patient's journal. `productName`/`dosageText`/
  `issueQuantity` (prescription) and `investigationRequestItems`/
  `requestedBy` (investigation-request) were all confirmed correct as
  previously guessed.
- **Fixed:** a prescription entry (flat and nested) has no
  `recordedBy`/`recordedByOrganisation` field at all — `flattenJournal` was
  reading two fields that never exist on this entry kind (harmless, always
  `undefined` → `null`, but wrong). Now passes `null` explicitly, documented
  as confirmed-absent rather than guessed.
- **Fixed:** investigation-request entries (flat and nested) carry a real
  `requestingOrganisation` field that `flattenJournal` was discarding as a
  hardcoded `null` — now read properly, feeding `recordedByOrganisationVaries`
  the same way note/document entries already do.
- Live-evidence hypothesis (not yet a code change): a lab-result
  (`investigation`) entry carries a `reportIdentifier` and per-comment
  `createdInOriginalSystemDateTime`/`recordAuthorIsLocal` fields with no
  prescription equivalent — a plausible mechanism for why results don't
  reimport-duplicate while prescriptions do, consistent with the existing
  n=1 finding that lab results carry their own ingestion-time dedup key.
- 6 new parser tests covering the previously-untested nested prescription/
  investigation-request branches and the `requestingOrganisation` fix
  (315/315 passing in `test-record-duplicate-parser.js`).

## [v3.176.6] — 2026-07-13

### Duplicate-checker: catches a note/consultation EXACT match whose attached documents actually differ

Live example: two "Seen in pain clinic" consultations, same date, both
authored "Mr Docman PCTI", tiered EXACT with a one-click "Remove 1 duplicate
copy" button — but each consultation had a genuinely different attached
document, confirmed by the user, even though the attachment's title/label
rendered identically in the journal UI (so a title-based check alone
wouldn't have caught this).

- A `note`-kind comparable entry in this tool is often not a freestanding
  note at all — it's one heading entry inside
  `consultationTopics[].headings[].entries[]`, and that same heading can
  also carry a sibling `document`/`fit-note` attachment. `flattenJournal`
  now captures any sibling attachment id(s) in the same heading onto the
  note entry as `attachedDocumentIds` (zero-cost — the data was already
  being walked, just discarded for the note branch before now).
- New `hasAttachedDocumentMismatch(group, fileTypeByEntryId,
  fileSizeByEntryId)` in `engine/record-duplicate-parser.js`, alongside the
  existing `hasQuestionnaireTemplateMismatch`/`hasPrescriptionTimingMismatch`
  cross-checks: flags a `note`-kind group when >=2 members carry a KNOWN,
  differing (fileType, fileSize) signature for their attached document(s) —
  same composite-key shape and "never guess off incomplete data" rule
  `splitDocumentGroupsByFileType` already uses for top-level documents, just
  keyed by the attached document's id instead of the note's own id.
- `duplicate-checker.js`'s `applyOnDemandCrossChecks` now fetches attached-
  document previews for `note`-kind candidate groups that carry an
  attachment (sharing the same preview cache the `document`-kind branch
  already populates — no duplicate fetch if a document happens to be both a
  top-level entry and an attachment), and downgrades a mismatched group's
  tier to REVIEW with a new `attachmentMismatch` flag — REVIEW already
  routes to the manual-review flow instead of the one-click bulk-remove
  control, so this actually blocks the unsafe removal rather than just
  relabelling it. New warning line on the group card, and a
  `noteAttachmentMismatchTotal` summary count.
- Downgrade, not split: unlike `splitDocumentGroupsByFileType`, a mismatched
  note group stays together as one candidate (both consultations visible
  side-by-side) rather than one member silently vanishing from the list.
- Every note-kind card (in `reviewEntriesHtml`, the side-by-side compare view
  every note group already uses) now shows a "Download attached document ↗"
  link per attachment, mirroring the existing "Download original ↗" link
  already offered on document-kind field comparison — the same closest-thing-
  to-"click to compare" pattern, now available for a note's attachment too,
  not just top-level documents. Zero extra fetch: the previews were already
  pulled by the mismatch check above regardless of its verdict.
- `fileId` (also present on the document preview payload) was considered and
  rejected as the disambiguator — a genuine reimport-duplicate legitimately
  gets a new `fileId` for the same bytes, so it proves nothing about
  content. fileType+fileSize is the established signal already proven for
  top-level document matching.

9 new parser tests (310/310 passing).

## [v3.176.5] — 2026-07-13

### Duplicate-checker: cross-document file-match check no longer replays already-removed entries, and is always offered

- **Fixed:** `markEntryRemoved` only ever patched the DOM in place (deliberate,
  per its own header comment, to avoid a slow full re-analysis after every
  removal) — it never touched `out.__analysis.entries`/`groups`. Running the
  cross-record file-match second pass (`runFileMatchSecondPass`) straight off
  that in-memory analysis after removing some first-pass duplicates meant
  already-removed documents were still present in `analysis.entries`, so they
  could resurface as "duplicates" a second time with undefined behaviour if
  acted on again. The second pass is now always launched via a new
  `runFreshFileMatchSecondPass`, which forces a genuine live re-fetch/re-analyse
  of the journal (the same fetch "Re-analyse" performs) before ever running the
  file-match check, guaranteeing it only ever sees what's actually still in the
  record.
- **Changed:** the "Run full cross-document file-match check…" banner was
  previously gated on `findSuspiciousDocuments` flagging something (a raw
  filename/GUID title or a same-minute id cluster). Per user feedback that
  this was too narrow, it's now offered whenever the patient has any document
  entries at all — the suspicious-document count, when present, is still
  shown as extra context.

## [v3.178.0] — 2026-07-25

### The Keeper — 2026-07-25 rule-set update (CSO review required before merge)

Automated horizon scan against MHRA DSUs, NICE NG12, QOF PRN02356, NHSE RSV/pneumococcal
letters, BNF, BSR, NICE TA877, and ACBcalc. All verified by VERIFIER-A and VERIFIER-B subagents.
Full sourced change-proposal report at `/tmp/the-keeper/the-keeper-report.md`.

#### Medicines monitoring (`rules/drug-rules.json`)

- **Sodium valproate (RED):** Added 4 new UK brands to `drug.match` — Belvo, Dyzantil, Epival,
  Syonell — per MHRA Drug Safety Update February 2025. Without these, patients dispensed a new
  brand receive no monitoring chip (silent safety gap). Source: MHRA DSU Feb 2025.
- **Amiodarone (AMBER / CSO FLAG):** Added U&E/Creatinine as a 6-monthly monitoring test.
  BNF and SmPC both specify renal monitoring; interval varies (BNF annual, SmPC 6-monthly) — change
  adopts 6-monthly as the safer default. **CSO to confirm preferred interval before merge.**
  Source: BNF / MHRA amiodarone SmPC.
- **GLP-1 (Green):** Added note that lixisenatide (Lyxumia, Sanofi) has been withdrawn from the
  UK market; terms retained in match[] for legacy records.

#### QOF (`rules/qof-rules.json`)

- **DEM004 CORRECTION (RED):** Previous Keeper run (2026-07-11) encoded DEM004 with wrong values
  (30 points, 60–90%) because the primary PRN02356 PDF returned 403. Correct QOF 2026/27 values
  per PRN02356: **14 points, 35–70% payment range**. Source: NHS England PRN02356.
- **OB register (AMBER):** Re-enabled (was `enabled:false`); `ageMin:18` added per QOF 2026/27
  business rules. Source: NHS England PRN02356.
- **LD register (Green):** Notes corrected — annual health check is a DES (£140/patient, CQRS),
  not a core QOF indicator.

#### Vaccines (`rules/vaccine-rules.json`)

- **RSV 65–74 expansion (AMBER):** Notes updated confirming NHSE operational letter (2 July 2026)
  — respiratory disease + immunosuppression groups eligible from 1 Sept 2026 (Abrysvo® only).
  Engine change pending (conditional-age eligibility not yet supported); manual assessment required.
- **mRESVIA (AMBER):** Added `mresvia` to RSV `statusTerms.given` — MHRA-licensed Feb 2025 for
  private use; prevents false "unvaccinated" flag for privately vaccinated patients.
- **PPV23 homelessness cohort (AMBER):** Added eligibility clause for people experiencing
  homelessness (rough sleeper / no fixed abode / hostel resident, 16+) effective 1 October 2026.
  Source: GOV.UK letter June 2026; JCVI June 2024 advice.
- **RSV care home label (Green):** Corrected to "Care-home resident (adult, all ages)" — NHSE
  policy covers all adult residents, no minimum age.

#### Prescribing-safety alerts (`rules/alert-library.json`) — version 1.5

- **NEW RED alert — domperidone + phaeochromocytoma/paraganglioma:** Absolute contraindication per
  MHRA DSU July 2026; risk of hypertensive crisis. `alert-domperidone-phaeo`.
- **NEW RED alert — ACEi + history of angioedema:** Absolute contraindication per MHRA DSU 17 June
  2026. Full UK ACEi drug set with brands; excludes hereditary angioedema. `alert-acei-angioedema`.
- **NEW AMBER alert — antipsychotic + dementia:** NICE NG97 / MHRA 2009 / STOPP v3 B11.
  Ships AMBER with prominent LBD escalation note (engine cannot auto-escalate on secondary problem
  coding — clinician to treat as RED when Lewy body dementia coded). `alert-antipsychotic-dementia`.
- **GLP-1 alert notes (AMBER):** Added NAION warning from MHRA DSU 5 Feb 2026 (semaglutide and
  sudden painless vision loss).
- **HELD — digoxin + CKD alert:** Citation errors (STOPP B5 vs correct E1) and CKD stage 3
  RED threshold over-fires. Not shipped — CSO review required.

#### Medication review (`engine/acb-scores.js`, `engine/stopp-start.js`, `visualiser-core.js`)

- **ACB_TABLE (AMBER):** Added alimemazine (score 3), trimeprazine (score 3), brompheniramine
  (score 3) to first-gen AH section. ACB total was silently under-counted for patients on these.
  Source: ACBcalc / Boustani scale.
- **STOPP-START (AMBER):** Added `celebrex` to NSAID_TERMS (brand not substring of celecoxib);
  `torasemide` to LOOP_DIURETIC_TERMS (BNF 2.2.2 loop diuretic, brand Torem); `brompheniramine`
  to FIRSTGEN_AH_TERMS. Three silent STOPP misses resolved.
- **HIGH_RISK_DRUGS (AMBER):** Added 4 new visualiser monitoring entries:
  - leflunomide (84d, FBC/LFT/U&E) — BNF/BSR
  - carbamazepine (182d, FBC/LFT/U&E/sodium/drug level) — BNF
  - sodium valproate (365d, FBC/LFT/U&E, with all MHRA Feb 2025 brands) — BNF/MHRA PPP
  - finerenone (120d, U&E/potassium/eGFR) — NICE TA877

#### Reception pathways (`rules/reception-pathways.json`) — version 1.5

- **rf-morning-vomit (999):** Added to headache pathway — progressive morning headache waking from
  sleep with vomiting = raised ICP. Source: NICE CKS Headache assessment.
- **rf-nasal-unilateral (duty):** Added to sinusitis pathway — unilateral nasal symptoms = NG12
  ENT 2WW sinonasal cancer referral.
- **rf-skin-lesion (duty):** Added to rash pathway — new or changing mole = NG12 melanoma 2WW.
- **rf-haematuria (duty):** Added to general pathway — visible haematuria 45+ without UTI = NG12
  urology 2WW.
- **rf-hoarseness (duty):** Added to general pathway — persistent hoarseness ≥3 weeks = NG12 ENT
  2WW.

#### Test suite

All 16 test files pass. Updated: `test-drug-brand-coverage.js`, `test-qof-indicator-filters.js`,
`test-acb-scores.js`, `test-stopp-start.js`, `test-visualiser-pincer.js`,
`test-reception-pathways.js`.

#### Killed candidates

- **qof-002 (AF006 upper):** KILLED — current encoding of 95% is correct for QOF 2026/27 (raised
  from 90%). Scanner proposal to revert to 90% would have introduced an error.
- **qof-004/005 (OB003/OB004):** KILLED — wrong descriptions; correct OB004 params noted for next
  Keeper run.

## [v3.177.0] — 2026-07-22

### Triage North Star — wave 1: the record next to the request

First implementation wave of `docs/plans/TRIAGE-NORTHSTAR-2026-07-22.md`
(the market-informed successor to TRIAGE-LENS, also added this release):
the top clinician-impact items from two independent Practice-board review
panels. Hazard log v3.15 adds H-045–H-048, all **pending CSO review**.
Defaults config 24→25.

- **Urgent breach-risk strip (A2, H-045).** New `#slaBreachStrip` global
  panel strip: counts open requests Medicus itself flags urgent and alerts
  on the oldest one's age — amber ≥2h, red ≥4h (configurable,
  `suite.requestMonitor.urgentAgeAmberHours/RedHours`, included in suite
  backups). Reads the Request Monitor's cached bucket state — no new API
  polling. Fail-visible: items with no readable priority field render
  "urgency unknown — check queue", never a silent zero. Additive-only, no
  all-clear state, hidden when nothing is at risk. Pure computation in
  `shared/sla-breach-core.js` (47-assertion test).
- **Pending-abnormal-result cross-link chips (B2, H-046).** When this tab
  session graded a red/amber investigation report for a patient, that
  patient's rows on *request* queues now chip "⚠ pending urgent result ·
  graded 12m ago" / "pending abnormal result · 12m" (top analyte in the
  tooltip when cached) — the request about tiredness now carries the unfiled
  K⁺ 6.2 with it. Patient-keyed index (`shared/pending-result-index.js`,
  39-assertion test) is pointer-only: entries die with their source
  `_queueResultCache` severity on every teardown path, and placement rides
  the durable row map so the sort canary suppresses rather than misplaces.
  Escalate-only; every chip carries its data age; request queues only.
- **Repeat-contact chips (B3, H-047).** The v3.151.0 deferral unblocked by
  the new shared task→patient resolve substrate (one resolve per task,
  shared by the monitoring / patient-flag / pending passes under the
  existing per-pass cap). Tier 2: "3rd contact in 14d" from a rolling
  28-day local ledger — patientUuid + date only, no names, no free text,
  bounded and pruned, deliberately never backed up. Tier 1: "2 open
  requests · this patient" from identities resolved this session. Amber,
  factual-observational wording, no "1st contact" state ever.
- **Carry-over chips (B5, H-048).** "carried over 4d" from a task-keyed
  first-seen ledger — catches the request bounced between holders whose
  displayed date reset. Complementary by construction: fires only when the
  extension's first-seen predates the row's displayed date, and defers to
  the taskAge red chip when the row's own date already tells the stronger
  story. Reuses `thresholds.taskAgeAmber/Red` (3/7 days).
- **Verified, not rebuilt:** E-1.1 fail-visible "not assessed" states were
  already shipped (v3.148.0, H-005 controls) and monitoring chips already
  run on request queues (the pipeline is queue-agnostic; the global
  default-off toggle is the only gate) — both plan claims corrected in the
  plan's status note rather than re-implemented.
- **Plan additions from the same-day review panels:** C4 next-green-day
  disposition assist (capacity-preset-linked slot lookahead + prepare-only
  reception snippet, v2 one-click reception task via the audited
  `createGeneralTask` path) and C5 curated resource actions pass
  (twice-a-year lookups on existing chip popovers, leaflet/knowledge action
  kinds, CI link checking); role-based chip visibility recorded as an
  unresolved governance item gating B1.

## [v3.176.4] — 2026-07-19

### Audit final tranche — the four deferred refactors + CSO sign-off

Closes out the 2026-07-18 whole-suite audit. Hazard log v3.14 records the
CSO's sign-off of the audit remediation and promotes the two open questions
to numbered hazards (H-043 inline booking/task wrong-patient write, H-044
vaccine false-GIVEN classes), both mitigated in v3.176.1.

- **Queue sort canary (H6).** The rowIndex→taskUuid maps that place every
  fetch-driven queue chip (result / monitoring / patient-flag) are built from
  the bridge's task-list payload — a client-side AG-Grid sort reorders rows
  without a new fetch, which would land chips on the WRONG patient's row.
  The canary watches the grid's sorted-header state and drops both maps the
  moment it changes: a server-side sort re-fetches and rebuilds them
  correctly within a tick; a client-side sort leaves the chips safely absent
  (no chip is safe; a wrong-row chip is not). The bridge re-baselines the
  canary on every fresh payload so the fetch-first race cannot eat correct
  maps. 24 regression tests (test-queue-sort-canary.js).
- **Event-ledger day-sharding (H12).** `record()` used to re-read and
  re-write the entire ≤5000-event array on every append — a
  multi-hundred-KB storage churn per chip render on a busy day. The ledger
  is now day-sharded (`ledger.events.<date>` + a `ledger.shardIndex`
  directory): an append touches only today's shard plus the small index.
  Public API, caps (5000 events / 90 days), dedupe and CSV export are
  unchanged; the legacy monolithic key migrates into shards on first use
  (merging, never clobbering, and retrying after a failed attempt). The
  never-backed-up doctrine carries over to all ledger keys.
- **Shared my-appointments fetcher (M10).** The panel WR strip, Sentinel
  module and Today module each polled
  `/scheduling/data/homepage/my-appointments` independently — two or three
  identical authenticated GETs per poll window with those tabs open. A
  shared 15s-TTL memo (`shared/appointments-feed.js`) with in-flight
  coalescing now serves all three; each keeps its own mapping/rendering and
  diag label. 30 tests (test-appointments-feed.js).
- **Dead Sentinel sidebar removed (M5).** ~760 lines of unreachable
  floating-sidebar UI (mount/render*/chipHtml/nav-watcher and friends)
  deleted from `content-scripts/sentinel.js` (1594 → 833 lines); the file is
  now the data pipeline + snapshot bridge only, which is all suite mode ever
  used. Config keys owned by the old UI are kept for stored-config shape
  compatibility. The deleted code lives in git history (pre-v3.176.4).

## [v3.176.3] — 2026-07-19

### Audit close-out: attestation preservation, hazard-log sync, vendored font

- **Restores no longer wipe local attestations** (audit M18): reception's
  `disclaimerAcceptedAt` and knowledge/lab-filing's `noticeAcknowledgedAt`
  are preserved across an import (incoming values still never written) —
  previously a restore re-locked features the local admin had accepted.
- **Hazard log v3.13** incremental sync documenting the full audit
  remediation (v3.176.1–.2), pending CSO review — including the open
  question of numbered hazards for the booking write race and vaccine
  false-GIVEN classes.
- **Panel font vendored** (audit M16): JetBrains Mono v24 latin variable
  woff2 ships in `vendor/fonts/` (OFL-1.1, SHA-256-catalogued in
  vendor-versions.json; verify-vendor now walks subdirectories) — the
  runtime Google Fonts `@import` is gone, and the extension-pages CSP is
  tightened with `style-src 'self' 'unsafe-inline'; font-src 'self'` so
  remote styles/fonts now fail closed.

**Remaining from the audit, deliberately future work** (each needs its own
reviewed PR): event-ledger day-sharding (H12), dead Sentinel sidebar removal
(M5), queue rowIndex fingerprint canary (H6), shared my-appointments fetcher
(M10).

## [v3.176.2] — 2026-07-18

### Audit remediation, second tranche — engine integrity + day-scale efficiency

Completes the small-to-medium remainder of the 2026-07-18 audit (Milestones
2–3). All fixes verified by the 327-test suite.

**Engine / data integrity:**

- eval-cache input hash now folds in `observationHistory` and `allergies`
  digests — a backfiled result or new same-day journal point no longer serves
  stale trend/event-count chips until midnight (M19); the ruleset signature
  is memoised per rules-array identity (was a deep stringify of every rule on
  every render tick).
- `mergeRules` only merges the ALLOWED override fields — an imported org
  ruleset can no longer silently rewrite safety-critical fields (e.g.
  `drug.match`) that the validator claimed were "ignored" (M20).
- Numeric parsing unified: "1,234" no longer parses as 1.234 (thousands
  separators recognised), comma-decimals limited to 1–2 trailing digits, and
  the engine's `parseNumeric` now agrees with the normaliser (M21).
- `evaluatePatient` accepts and propagates `pastProblems`; the HRT
  hysterectomy context (progestogen-cover check) sees ended problems for the
  first time — wired through all three sentinel call sites (M22).
- `triage-io` empty-config early-return no longer drops the routineRx
  restore; backups are stamped with the REAL manifest version (was a
  hard-coded "2.5.0"); backup-coverage guard extended with the four missing
  key prefixes — immediately catching (and allowlisting, per the documented
  machine-local decision) `labfiling.suppress` (M18).

**Content scripts:**

- pusher-relay retries when `$pusher` attaches late instead of giving up for
  the tab's lifetime (M3); referrals-discovery now gates per-event, so it
  works under SPA navigation instead of only on a hard reload (M4).
- routine-rx macro aborts every waitFor step (and the final commit) the
  instant the SPA path changes — no step can drive a different task's
  controls (M7).
- api-discovery journal capture stores UUID-substituted templates only,
  capped at 50, in one batched write; the grow-forever raw-URL key is
  removed (M6). Stale row-id comment corrected (documents the durable-map
  design, not the v3.69.0 bug it replaced).

**Panel / day-scale efficiency:**

- Request-Monitor single-poller (H10): the strip renders from the service
  worker's persisted state when fresh (≤2 poll periods) and only falls back
  to a direct poll when the SW state is stale — halves RM network traffic
  and removes the racing dual state writes.
- `submissions.ledger` writes are dirty-checked (five 15–60s pollers were
  rewriting byte-identical KB every tick) (M9).
- Sentinel (10s) and Trends (15s) module polls are visibility-gated — each
  tick carried executeScript + a full observationHistory IPC payload (M13).
- WR strip and Follow-ups list gain changed-guards (identical innerHTML no
  longer rebuilt every poll, preserving hover state); roll-up "Hide" works
  while the always-expanded preference is on; pa-strip labels "OTHER TAB"
  when its fallback picked a background Medicus tab (M11); "all four strips"
  comment drift fixed.

**Deferred to a dedicated follow-up PR (larger blast radius):** event-ledger
day-sharding (H12), dead Sentinel sidebar removal (M5), queue rowIndex
fingerprint canary (H6), shared my-appointments fetcher (M10), panel font
vendoring + CSP tightening (M16), and the restore attestation-preservation
question (M18, needs a design decision).

## [v3.176.1] — 2026-07-18

### Audit remediation — whole-suite bug bash fixes (Milestones 0–2)

Fixes from the 2026-07-18 whole-suite audit (5 parallel specialist reviews;
every Critical/High verified against source, clinical-logic bugs reproduced
under Node before fixing). Failing-first regression tests were written for
each correctness fix.

**Critical:**

- **C1 — wrong-patient booking/task-creation race closed.** `booking-inline`
  and `task-inline` now pin their per-task state instance across every await
  (a resolution still in flight when the SPA navigates is discarded, never
  written into the next task's state) and HARD re-verify task→patient at
  commit time before creating an appointment/task — the same click-time
  re-check lab filing already used. An orphaned slot reservation made during
  a navigation is released, not attached.
- **C2 — false "vaccination GIVEN" chips.** Every vaccine rule's `declined`
  list now covers refused/contraindicated/not given/not indicated phrasings
  (covid lacked even "not given"), and an UNDATED "given" record no longer
  satisfies a seasonal window (fail-closed; one-off vaccines still accept
  undated records — their window is all-time). New
  `test-vaccine-status-terms.js` (28 assertions, red-first).
- **C3 — Record tab cleanup never ran.** `record.js` init now returns its
  cleanup (the loader only honours the RETURNED function); every visit had
  permanently leaked 4 listeners, each firing a background full-record fetch
  on every tab switch. New `test-module-lifecycle.js` statically enforces the
  init-returns-cleanup contract for all 17 modules.

**High:**

- **H1** — "Non-smoker" no longer displays as "Current smoker": new 'non'
  bucket (deliberately not 'never' — SNOMED Non-smoker leaves ex-vs-never
  unspecified); "Passive smoker" now reads unclear, never current.
- **H2** — nystatin/sandostatin/cilastatin/pentostatin excluded from the four
  QOF lipid-lowering `"statin"` matches (false MET off Nystatin).
- **H3** — problem-negation is now clause-bounded with a 30-char reach:
  "History of MI; heart failure" no longer kills a heart-failure-gated alert;
  "No/Query/History of heart failure" still negate.
- **H4** — `findLatestObservation` gains exclude-term support;
  alert-hyperkalaemia excludes urine/faecal/etc. specimens (a newer urine
  potassium fired a red serum alert). New `test-matching-false-signals.js`
  (16 assertions) covers H2–H4.
- **H5** — journal-fetch failures now THROW instead of returning [] — the
  panel's journalAugmentFailed warning was unreachable dead wiring, so a
  500/timeout silently degraded journal-coded QOF indicators to a false
  all-clear no_data.
- **H7** — the detail verdict banner's attempted-set is cleared on leaving
  the detail page: a task's red "N urgent" banner could previously never
  recompute after its 5-min cache expired, for the whole session.
- **H8** — Condor's four delegated click handlers (and Today's card handler)
  are named and removed in cleanup — they stacked one copy per visit (N
  visits → one click opened N report tabs).
- **H9** — module switches are now SERIALISED in the loader (at most one init
  in flight; a superseded init's cleanup can no longer tear down the live
  instance's timers — the "Sentinel frozen on the last patient's chips"
  race), and an init that throws part-way gets a best-effort module cleanup.
- **H11** — queue result-chip cache TTL 5→30 min with a real invalidation
  signal (cached severity dropped the moment a row's priorityDisplay changes
  on the bridge) — removes ~19k/day redundant overview GETs on long queues.

**Medium/low quick wins:** own-mutation filter recognises `.ch-q-pa` (each
flag-chip injection triggered a full queue refresh cycle); queue/OIR caches
bounded (ts-less bridge entries now prunable via createdAt; FIFO caps on the
outstanding-investigation caches that retained every patient's full history
all day); `event-ledger.js` no longer double-loaded by the manifest (+
re-entry guard); pa-strip poll visibility-gated, demoted to a 60s backstop,
and its store cached via onChanged; quote-safe escaping in `escStrip` and the
condor/tabs-section/setup/module-loader esc helpers (staff-typed free text in
title attributes could break out of the attribute); `alert-library.json`
`composite-1` template now ships disabled (placeholder ruleIds silently never
fired).

Full audit (findings, strategy, remaining Milestone 2–3 tasks) delivered as
a separate document; hazard-log entries for C1/C2 pending CSO review.

## [v3.176.0] — 2026-07-18

### Patient Alerts everywhere it matters: on-page banner, queue chips, attribution

Three follow-ups to v3.175.0's Patient Alerts, extending the same store
(`patientAlerts.byPatient`) to the surfaces where flags earn their keep. All
three are read-only over the store; the Pt Alerts tab remains the only writer.

- **On-page flag banner** (`content-scripts/patient-alerts-banner.js` + CSS):
  the patient's flags now render as a slim red/amber banner PREPENDED inside
  Medicus's own patient header — visible to anyone who opens the record,
  side panel open or not. Identity is re-resolved from the live page on every
  render (URL patient UUID first, on-screen NHS number as lookup fallback; a
  name never matches); no identity or no flags → banner removed, never stale.
  Survives the SPA's re-renders via the shared rAF observer hub + prepend
  rule; self-contained CSS (no token dependency to go missing).
- **Queue flag chips** (`.ch-q-pa`, triage-lens content script): flags appear
  on task-queue rows — "⚑ Interpreter required +1" — so the flag is seen
  BEFORE the task is opened or the patient phoned. Task→patient resolution
  reuses the TTL-cached `resolveTaskToPatient`; chips follow all the queue
  chip rules (prepend, durable rowIndex→taskUuid re-injection on every
  refresh, de-dupe, hud.css token-scope registration). Matching is by
  resolved patient UUID only. Chip colour: red if any red flag, else amber.
  A store edit in the panel updates the queue on the next churn.
- **Attribution + audit trail** (H-042): every flag now records
  `createdBy`/`updatedBy` (from the practice letterhead's clinician name;
  null when unset — never guessed). Edits preserve the original author and
  date as immutable provenance; the Pt Alerts chip tooltips show
  "Added <date> by <name> — Updated <date> by <name>". Every add/edit/remove
  (including whole-patient removal, one event per flag) is recorded in the
  machine-local Event Ledger under new source `patient-alerts` (actions
  `flag-added`/`flag-edited`/`flag-removed`) — patient referenced by UUID
  only, label carries the preset id + severity, never the free-typed text.
- New `shared/patient-alerts-lookup.js` (classic, dual-mode) provides the
  read-side lookup to both content-script surfaces;
  `test-patient-alerts-lookup.js` asserts parity with the panel's ES core on
  shared fixtures so the two matching implementations cannot drift (27
  assertions). Core attribution tests added (56 total).

## [v3.175.0] — 2026-07-18

### Patient Alerts — per-patient customisable flags (user-requested)

Requested by a practice user: per-patient alerts (interpreter required,
medication-seeking behaviour, safeguarding, …) that load with the patient in
Medicus, fully customisable, persisted locally and shareable practice-wide.
This is the suite's **first deliberately persisted per-patient store**
(`patientAlerts.byPatient`, keyed by Medicus patient UUID with NHS-number
display fallback), so every render path resolves identity from the live
Sentinel snapshot at render time — a navigation can never leave a previous
patient's flags on screen, and a bare name is never a match key.

- **New "Pt Alerts" tab** (panel + pop-out): add/edit/remove alerts for the
  patient currently open (auto-followed via the Sentinel snapshot bridge),
  search every flagged patient, and edit the quick-add preset palette
  (`patientAlerts.types`, seeded with interpreter/safeguarding/behaviour/carer
  defaults — add anything, three severities: RED / AMBER / INFO).
- **Global patient-alert strip** (`#paStrip`, panel-only like the other
  strips): the flags appear the moment the flagged patient's record loads,
  whatever tab the panel is on. Red band if any red alert, else amber.
  Deliberately NOT folded into the demand roll-up — a safeguarding flag must
  not collapse into a demand summary. Absence of the strip means "no flags
  recorded or patient not identified", never a verified all-clear.
- **Monitoring banner chips**: the same flags render read-only inside the
  Sentinel "Monitoring for" patient card, beside the clinical context.
- **Backup + practice-wide sharing**: new `shared/io/patient-alerts-io.js`,
  scope `patientAlerts` in the suite envelope, Options export/import card.
  Import is a MERGE (union by patient + alert id; incoming wins on the same
  id) so a colleague's shared file can never silently delete local alerts.
  The envelope preview and the Options card both warn loudly that this export
  contains PATIENT-IDENTIFIABLE DATA. An uncustomised palette exports as
  null so receiving installs keep tracking shipped defaults.
- Not written to the clinical record (footer says so in-module); wording
  guidance surfaced in-UI: flags are visible to all practice users and
  disclosable to the patient.
- Tests: `test-patient-alerts-core.js` (50 assertions — identity, lookup
  fallback, pure transforms, merge), `test-patient-alerts-io.js` (21 —
  round-trip, merge-not-delete, validation throws, prototype-pollution
  defence).

## [v3.174.0] — 2026-07-16

### Smoking-status flag in the Sentinel patient banner (user-requested, panel-placed)

Requested by a real GP user ("can we get a smoking status flag?"); placement,
form and content settled by a scoped Practice-panel run
(docs/appraisal/PRACTICE-smoking-flag-2026-07-16.md — synthetic panel,
labelled as such). Before this, smoking status surfaced ONLY as QOF SMOK002
recording-currency cards: the actual value sat in small caption text three
screens down, tripled for multimorbid patients, and the absent state was a
quiet grey "NO DATA" every persona misread.

- **One authoritative line in the "Monitoring for" patient card** (panel +
  pop-out): `Smoking: Ex-smoker · Nov 2025 (8 mo ago)`. Neutral colour in ALL
  states — the fact is context, not an alert; red/amber stay reserved for
  needs-action signals. The word carries the state (colourblind-safe); hard
  single-line ellipsis at 420px.
- **Honest absence**: `Smoking: no entry in the last 13 months — check
  record` — bounded to the extension's real data window (the ~400-day journal
  augment), never "not recorded" (which reads as never-in-her-life) and never
  "NO DATA". Tooltip explicitly rejects that misread.
- **Conservative derivation** (`shared/smoking-status.js`, dual-mode):
  current/ex/never only on unambiguous terms; "smoking cessation advice",
  "nicotine dependence", bare "tobacco use" render as "unclear — see record"
  with the verbatim coded term — never a confident guess. Most-recent entry
  wins the headline; disagreeing entries append a visible "multiple entries"
  marker. Verbatim source term + exact date + window caveat in the tooltip.
- Derived content-script-side from the SAME observations the chips are
  evaluated on (`snapshot.smoking`), so line and chips can never disagree.
- Hazard log **H-041** (stale/miscoded/out-of-window over-trust) with controls
  as above; **pending CSO review of the bucketing term lists**.
- Tests: `test-smoking-status.js` (44 assertions). QOF SMOK002 cards
  unchanged. Panel follow-ups recorded in the appraisal doc (SMOK002
  triplication, Brief no-data inversion, Record/SMR echoes).

## [v3.173.2] — 2026-07-14

### Fix: post-merge-train slowness + frozen Capacity refresh (four coordinated fixes)

Root-caused by four parallel investigations against the v3.160.2 baseline after
user reports of Sentinel loading slowly, slots not auto-refreshing, the
routine-rx button being very slow, and queue chips disappearing.

- **Capacity tab frozen ("slots no longer auto refresh")** — the
  `slots:refresh` runtime→DOM relay in `side-panel/panel.js` and
  `pop-out/pop-out.js` was gated on `activeModule === 'slots'`, but the
  Capacity tab listens for the same `suite:slots:refresh` DOM event as its
  ONLY live-update path — so Capacity never received a single refresh while
  it was the active tab. Now dispatched unconditionally (module `cleanup()`
  removes the outgoing module's listener, so it cannot double-fire). This
  defect pre-dates the merge train; the train's capacity-surface changes put
  fresh eyes on it.
- **`content-scripts/api-discovery.js` captured far beyond its stated scope**
  (a per-page cost on every Medicus page, v3.152.1+): its header scopes it to
  the patient-listing page and journal tab, but the listing capture ran on
  EVERY page whose API calls contain `/patient/` — including every care-record
  page, where the extension's own per-patient fetches (patient-banner,
  medication-regimen, problems…) each triggered storage round-trips and grew
  `suite.discoveredAllPatientUrls` unbounded (one entry per patient per
  endpoint) on every Sentinel boot. Capture is now gated to the
  patient-listing route, read live per-event (SPA-safe, same pattern as the
  journal gate). The journal capture is unchanged.
- **`engine/data-fetcher.js` read `txn.integrationMode` from storage before
  every patient fetch** (v3.166.0+) — a storage round-trip serialized ahead of
  `fetchLive()` on every boot and re-eval, even in the default session mode.
  The mode is now cached module-level; the cache is only trusted when a
  `chrome.storage.onChanged` listener could be attached to invalidate it
  (Node tests and contexts without `onChanged` keep per-call reads).
- **Routine-rx button: leading-token search miss burned a dead 6s**
  (v3.160.1+): the step-3 query ladder gave every query the full 6s option
  wait, so when the safe leading token missed, the user sat through 6s of
  nothing before the full-name query succeeded. Non-final queries now get a
  1.5s budget; only the final query keeps the full 6s (worst case ~8s, down
  from ~13.5s; the happy path is unchanged). Pinned in
  `test-routine-rx-macro.js` (per-query budget assertions).

**Queue chips:** no code defect found — the entire injection chain is
byte-identical to v3.160.2 and all pinned regression tests pass. All three
chip families vanishing together is the signature of the content script not
executing at all, most consistent with orphaned content scripts after the
extension updated (Chrome does not re-inject into already-open tabs).
**Reload the Medicus tab after updating the extension.** If chips are still
missing after a tab reload: `localStorage.setItem('ch-debug','1')` + reload
and check for `[ClinHUD]` logs per CLAUDE.md's capture-first procedure.

## [v3.173.1] — 2026-07-14

### Fix: restore #208's manifest entries dropped in the PR #209 merge

The PR #209 merge resolved its `manifest.json` conflict by taking the branch's
copy wholesale, silently dropping three entries PR #208 (v3.166.0) had added:

- `shared/shadow-compare.js`, `shared/event-ledger.js` and
  `shared/txn-shadow-summary.js` restored to the sentinel content-script block
  (in #208's original order, before `content-scripts/sentinel.js`) — without
  them the transactional shadow-comparison path was silently absent
  (`sentinel.js` null-guards `window.TxnShadowSummary`, so it degraded rather
  than crashed).
- `https://*.supabase.co/*` restored to `host_permissions`.

`shared/event-ledger.js` also loads in the triage-lens block; double-loading is
safe (the script reassigns the same `window.EventLedger` API).

First of a set of post-merge-train regression fixes; further fixes on this
branch address the reported Sentinel slowness, slots auto-refresh and queue-chip
regressions as root causes are confirmed.

## [v3.173.0] — 2026-07-08

### Cross-record file-match detection moved to an opt-in second pass

Live timing from the user, always-on v3.172.0 vs the pre-feature baseline
on the same 63-document test-patient record: **54.5s → 79.3s** — a ~25s
(~46%) slowdown, confirmed too slow to run unconditionally. The matching
itself was confirmed accurate (correctly found real duplicates filed years
apart), so the fix is gating, not the algorithm.

- New `findSuspiciousDocuments(documentEntries)` — the free half of the
  design: flags a document if its title carries a raw filename/GUID prefix
  (`hasJunkTitlePrefix`, unchanged from v3.172.0) OR its id-timestamp falls
  in the same MINUTE as another document's (new — buckets by
  `Math.floor(idTime / 60000)`, reusing the id-timestamp every entry
  already carries, the same signal the keeper tie-breaker uses). Wired
  into `analyzeJournal` itself so it's computed on every analysis at zero
  cost — `analysis.suspiciousDocuments` / `summary.suspiciousDocumentsTotal`
  are always populated, whether or not the primary pass found anything.
- `applyOnDemandCrossChecks` no longer fetches previews for un-grouped
  documents or calls `findFileMatchedDuplicates` — that expensive half
  moved to a new, user-triggered `runFileMatchSecondPass(out)`.
- New opt-in banner, shown whenever `findSuspiciousDocuments` flagged
  anything and the second pass hasn't run yet — including in the
  **empty-state** case (zero groups found by the normal pass): "N
  document(s) show signs of reimport corruption … Run full cross-document
  file-match check…". This is exactly the scenario that motivated the
  whole feature — a patient flagged as suspicious with no hits in the
  normal search.
- `document` entries now carry their own raw `title` field (added in
  v3.172.0, unchanged) — still needed for the junk-prefix check regardless
  of pass timing.
- No change to `findFileMatchedDuplicates`, `hasJunkTitlePrefix`, or
  `hasCreatedAfterFiled` themselves — only when they run.

11 new parser tests (301/301 passing).

## [v3.172.0] — 2026-07-08

### Added: cross-record file-match duplicate detection for documents, built into the first pass

Real motivating case (test patient 5, live): documents duplicated across
DIFFERENT journal dates, which the primary `(kind, date, code)` key can
never catch no matter how the code/date resolve, because the two copies
genuinely disagree on date. Built at the user's explicit request as an
**always-on** part of "Analyse current patient" (not opt-in) for a first,
honest timing test on a document-heavy record (63 documents) — the user's
plan is to break it out into an opt-in second pass only if it measurably
slows the analysis down.

- `engine/record-duplicate-parser.js`: `findFileMatchedDuplicates(documentEntries,
  existingGroups, fileTypeByEntryId, fileSizeByEntryId, createdDateByEntryId,
  filedDateTimeByEntryId)` — matches document-kind entries ACROSS THE WHOLE
  RECORD by `(fileType, fileSize)` (the one signal a reimport relabelling
  pass can't corrupt), the same composite key `splitDocumentGroupsByFileType`
  already uses, applied the opposite way (forms new groups instead of
  splitting one apart). Entries with unknown fileType/fileSize are excluded
  from matching entirely — never guessed. A cluster whose member set is
  already exactly one existing group is skipped (no duplicate reporting);
  a cluster only partially covered by existing grouping IS still surfaced
  — that's the whole point, catching links the primary pass structurally
  cannot see. Tier is always REVIEW (strong evidence, not proof), tagged
  `fileMatched: true`.
- Two zero-fetch diagnostic markers carried per matched entry: `hasJunkTitlePrefix`
  (a raw filename/GUID fragment before a genericised title's `Type:`/
  `Author Org:` segments — live example: `"tiff: 1C60D211-...tiff - Type:
  Admin Letter Author Org: …"` — reuses `parseGenericDocumentTitle`'s own
  label regex) and `hasCreatedAfterFiled` (a document's creation time
  postdating its own filing time — a logical-ordering anomaly, not a
  timing-proximity heuristic).
- `duplicate-checker.js`: `applyOnDemandCrossChecks` now fetches
  `clinical/data/document/modals/preview/{id}` for every document-kind
  entry that never formed a candidate group under the primary pass (reusing
  previews already fetched for grouped documents — piggybacked on the
  existing per-document `document/entries` loop, so no extra pass over the
  document list). Cost is proportional to how many documents the journal
  grouping missed, not the whole document population twice over. New
  summary line: "N/M cross-record file-size/type cluster(s) surfaced as new
  group(s)". Matched groups get an explicit warning banner and per-card
  badges (own date, junk-title-prefix, created-after-filed) since a
  file-matched group can span different journal dates and codes.
- Document entries now retain their own `title` field (previously only the
  concatenated `rawText` blob was kept) — needed for the junk-prefix check.

29 new parser tests (290/290 passing).

## [v3.171.0] — 2026-07-08

### Added: links out to Medicus for direct comparison (duplicate-checker)

Two navigation links, both confirmed live via DevTools capture:

- **"Open this patient's record in Medicus ↗"** at the top of every
  patient's analysis, opening the confirmed care-record journal page in a
  new tab. Its URL only differs from the API host by moving the site code
  from subdomain to the first path segment
  (`https://e38a9f.api.england.medicus.health` →
  `https://england.medicus.health/e38a9f/patient/patient/care-record/{id}?careRecordTab=journal`)
  — `buildCareRecordJournalUrl` refuses (returns null, no link rendered)
  rather than guessing if `apiBase` doesn't match the exact confirmed
  shape.
- **"Download original ↗"** on each copy's column header in the document
  Compare-fields table, via the confirmed
  `GET clinical/document/download-file/{fileId}?convertToPDF=0` endpoint —
  the same original bytes this tool's fileType/fileSize matching already
  compares, not a converted copy. Takes the document's own `fileId`
  (confirmed distinct from `documentId` in the real capture), read from
  the preview already fetched for the comparison table — no new fetch.
  `convertToPDF=1` (PDF export) is a plausible but unconfirmed inference
  from the parameter name and is deliberately not wired without its own
  capture.
- Investigation-only: clicking a document in Medicus's own UI opens an
  in-page modal (every related call sits under `.../modals/...` and
  returns JSON) — there is no document-specific browser URL to link to,
  which is why these two links are the practical ceiling for "click to
  compare" rather than a direct jump into the document viewer.

8 new parser tests (261/261 passing).

## [v3.170.0] — 2026-07-08

### Duplicate-checker: GP2GP wrapper shown as a guide; single keep cue

Two presentation refinements from live use:

- **GP2GP wrapper text is now shown in place, highlighted amber** (badge
  "GP2GP wrapper detected"), instead of being silently stripped with a grey
  "wrapper stripped" note. It's a visual guide to which copy is the reimport
  artifact to reject. The added/removed diff is still computed on the
  cleaned content, so the wrapper frames the comparison without polluting
  it; merge suggestions and grouping still strip it as before (display-only
  change).
- **Removal/merge confirm: one keep cue, not three.** The per-card
  "✓ KEEP / ✗ DISCARD" banners that appeared on button-click are gone —
  they duplicated the form's KEEPING/REMOVING panels with different wording
  and misaligned with the columns. The kept copy now carries a single green
  outline (matching the Compare & merge view); the form's KEEPING/REMOVING
  panels remain the labelled statement. Clicking a card to switch the
  keeper still works.

No logic changes; 253/253 parser tests pass.

## [v3.169.1] — 2026-07-08

### Fix: document removal now truly removes (was only striking through)

v3.169.0 wired document removal to the wrong endpoint. Live test showed the
document was marked incorrect (struck through) but stayed VISIBLE. The user
captured both Medicus actions and they are near-identical but distinct:

- "mark as incorrect only" (struck through, still visible) →
  `POST clinical/document/mark-incorrect` with `{reason, inboundDocumentId}`
  — this is what v3.169.0 wired by mistake.
- **"remove from record" (removed completely)** →
  `POST clinical/document/mark-incorrect-and-hidden` with
  `{reason, isConfirmedRemoval: true, inboundDocumentId}` — the correct
  target, now wired.

So `document` is the same contract family as problem/note/prescription
after all (the `-and-hidden` suffix + `isConfirmedRemoval: true` is what
hides/removes across all four); it differs only in the id field name
(`inboundDocumentId`). The `noConfirmFlag` special-case added in v3.169.0
is removed — all four contracts carry `isConfirmedRemoval: true`. Exact-body
test updated to the captured "remove from record" POST. 253/253 tests.

## [v3.169.0] — 2026-07-08

### Added: duplicate documents can now be removed (duplicate-checker)

The user captured the document removal contract live (2026-07-08). Findings:

- **`POST clinical/document/mark-incorrect`** with body
  `{reason, inboundDocumentId}` — a DIFFERENT shape from the other three
  removal contracts: the id field is `inboundDocumentId` (not
  `documentId`) and there is NO `isConfirmedRemoval` flag. This is the
  "Remove from record" action (document removed completely). Medicus's
  separate "mark as incorrect only" (struck-through but still visible)
  path is a different, uncaptured endpoint and is deliberately not wired —
  a visible struck-through duplicate doesn't reduce visible duplication.
- `document` added to `WRITE_CONTRACTS`; `buildRemovalRequest` extended to
  omit `isConfirmedRemoval` for it (exact-body test pins the request to the
  captured POST). `isRemovableKind('document')` is now true.
- `duplicate-checker.js`: document REVIEW groups gain a "Remove a duplicate
  copy…" button that drops into the existing keeper-choice/removal flow
  (the standalone-removal gap the user hit when "Compare fields" had
  nothing to apply). After a successful field-apply, the success state now
  offers removal of the duplicate copy directly instead of saying it can't.
  Removal-form wording is document-accurate ("permanently remove N
  document(s) from this patient's record" vs "hide" for the hidden-contract
  kinds).
- 2 new parser tests (253/253 passing).

## [v3.168.0] — 2026-07-08

### Previous-practice notes can now auto-merge (duplicate-checker)

The user captured the missing evidence live (2026-07-08): the GET
edit-note model AND a successful change-note POST for a real
previous-practice note ("Patient de-registration",
`recordedAtAnotherOrganisation: true`, manually-typed org). Findings:

- **The POST body is identical in shape to the local-note capture from
  2026-07-06** — the same 13 keys. `recordedAtAnotherOrganisation`,
  `recordedByOrganisationManual` and `organisationEntry` are GET-only and
  never posted; the organisation posts as the structured
  `{organisationName, organisationIdentifierType,
  organisationIdentifierValue}` object (null identifiers for a
  manually-typed name — same shape as the document contract). The old
  blanket refusals on those two flags are lifted; a new exact-body test
  pins the builder to the captured POST byte-for-byte.
- New `resolveNoteOrganisation` evidence chain (structured object →
  manual text → caller-supplied name). A previous-practice note with NO
  org name anywhere still refuses — **Medicus's own form refuses to save
  that state** (user-confirmed live: the form demands a "previous
  organisation" value) — and the merge flow now shows the same
  organisation prompt the document flow has (default "Previous GP")
  instead of a dead end.
- **Named refusal reasons** replace the generic "an unconfirmed field was
  present": linked clinical case (still never live-tested — manual path),
  empty merged text (junk-only copies — points at the Remove button), and
  the org prompt above.

4 new/updated parser tests (251/251 passing).

## [v3.167.0] — 2026-07-08

### One consistent compare/merge surface for notes; created-date evidence on every card (duplicate-checker)

Three consistency items from the user's v3.166.0 live test:

- **EXACT note/problem pairs get the side-by-side cards too** (previously
  stacked snippets that made two "identical" entries look pointlessly
  identical). Every copy card now shows a `created` timestamp recovered
  from its UUIDv7 record id — zero fetches, the same signal the keeper
  tie-breaker already uses — highlighted amber across the group when the
  copies' creation times differ (the user's real EXACT pair was created
  years apart: original at registration, duplicate by a later reimport;
  that evidence was previously invisible). Cards also show the
  "kept (earliest copy)" badge.
- **"Compare details…" + "Suggest a merge…" unified into one
  "Compare & merge…"** for note groups (REVIEW + HIGH): the full-record
  field table (note/overview — linked problems, created timestamps,
  differs-highlighting) and the merge editor in ONE view, matching the
  document Compare-fields pattern. The kept column is headed "✓ KEEP" in
  green with the cards' fate banners live; clicking a card switches the
  keeper and re-renders (overviews cached, so instant). Only **Note text**
  is mergeable (the change-note contract is a text replace; all other
  fields round-trip unchanged), so only that row carries radios — picking
  a copy loads its junk-stripped text into the editable merge box. Apply
  drops into the existing confirm-then-remove flow. Problem-kind groups
  keep "Suggest a merge…" (no problem overview/edit endpoint captured
  yet).
- **KEEPING / REMOVING side by side** in the removal and merge confirm
  forms (green and red bordered panels in one row) instead of stacked —
  per the user's request to make the keep/discard pattern the consistent
  default across every merge/removal operation here.

## [v3.166.0] — 2026-07-08

### Fixed + added: junk-only note pairs, note detail comparison, unmistakable KEEP/DISCARD (duplicate-checker)

Three user-driven items from live testing (2026-07-08):

**Fix: null-note vs junk-only-note pairs mis-tiered REVIEW.** Real pair
(GP2GP original with `note: null` vs reimport copy whose whole body is
`{Episodicity : code=255217005, displayName=First}`) showed as "same code,
different content". The episodicity-suffix regex already stripped the
block correctly — the actual bug was `normText(null)` returning a bare
string while every other path returns `{text, wrapped}`;
`buildGroupRecord` SPREADS the result, and spreading a string contributes
nothing, so the null-text member got `text: undefined` vs the junk-only
member's `text: ''`. Fixed the null path's shape; the pair now tiers
EXACT (identical after junk-strip, same author) with the direct remove
button.

**Added: "Compare details…" for note groups** (REVIEW + HIGH, not
documentLinked — those ids were never confirmed against this endpoint).
Read-only side-by-side of each copy's full note record via
`GET clinical/data/note/overview/{noteId}` (confirmed 2026-07-08 from two
real payloads): code, note text, record date, recorded by, created,
created-in-original-system, linked problems, marked-incorrect. Fetched
on demand, cached per panel. **Linked-problems keeper safety** rides the
same data: the reimport copy routinely LOSES the problem linkage the
original keeps, so the removal form now warns (non-blocking, after the
form renders) when the copy being removed carries linked problems the
kept copy lacks.

**Added: unmistakable KEEP/DISCARD (user mockup).** While a removal or
merge confirm is open, every copy card gets a fate banner — "✓ KEEP"
(green outline) / "✗ DISCARD" (red, faded) — and **clicking a card makes
it the kept copy**, re-rendering the form to match. The confirm form's
text is restructured into explicit KEEPING / REMOVING sections (the old
"Keeping: (unknown author)" + list-on-next-line read as one flowing
sentence). Text labels are the primary cue, colour reinforcement only,
per the suite's colourblind doctrine. Card clicks are ignored while a
removal is in flight.

13 new parser tests (247/247 passing).

## [v3.165.0] — 2026-07-08

### Added: HIGH-tier note/problem groups get side-by-side comparison + remove + merge (duplicate-checker)

User request. Plain HIGH-tier groups ("identical text, different
author/org" — the classic GP2GP reimport signature) previously rendered as
stacked truncated snippets with NO action buttons at all (only EXACT and
documentLinked-HIGH had the removal gate), despite the tool's own help
copy promising HIGH bulk removal. For `note` and `problem` HIGH groups:

- **Side-by-side cards** — the same diff-card layout REVIEW and
  documentLinked groups use. The text is identical by definition, so the
  cards' real value is putting the differing author/org (what HIGH tier is
  actually about) directly next to each other.
- **Remove** — the direct EXACT-style removal flow (keeper pre-picked by
  the UUIDv7 tie-breaker where decodable, else the choose-keeper step). No
  "are these equivalent?" judgment gate: HIGH means the text already
  matched exactly.
- **Suggest a merge…** — the same merge path REVIEW groups get: automated
  apply-and-remove for note-kind (existing confirmed change-note
  contract), copy-paste guidance for problem-kind (no confirmed problem
  edit endpoint yet). Merge-form guidance now names the right removal
  button per tier.

Deliberately excluded: documentLinked HIGH groups keep their existing
forced-keeper removal-only flow (merging would edit a document-linked
pseudo-entry via the note contract — never live-tested), and prescription
HIGH groups stay action-less (duplicates there are governed by the
quantity/timing cross-checks; "merging" two prescription issues has no
meaning).

**On hold at user request (Medicus bug)**: the uncoded-document-type save
blocker (v3.164.5) — Medicus has been notified that documents imported
with an uncoded type are un-editable in their own UI; no further tool
changes for it until their fix lands, then retest.

## [v3.164.5] — 2026-07-08

### Diagnosed + made actionable: uncoded document type blocks ALL saves (duplicate-checker)

Third live refusal, diagnosed definitively from the user's captured keeper
edit model + Medicus's own error response. The kept copy's type ("Patient
Letter") was imported with `code.value.conceptId: null` /
`descriptionId: null` — a degraded/uncoded type. **Such documents are
un-editable even in Medicus's own UI**: the user's manual save in Medicus
failed server-side with
`{"errors":{"code.conceptId":["This value should not be blank."]}}` (the
UI surfaces it as a generic "This value should not be blank", pointing at
the wrong field — raised with Medicus as a bug by the user). Our builder's
refusal was therefore CORRECT — the POST cannot succeed — but its message
blamed the wrong fields (linked problems/staff/case/specialty).

- `prepareDocumentFieldApply()` now detects the uncoded-keeper-type state
  specifically, and in order: uses the keeper's own preview `typeCode` if
  it carries the full code (with an explicit confirmation-card caveat);
  otherwise names the real problem and the way out — "the other copy's
  Type ('X') IS properly coded — select its Type radio and re-apply", or
  "neither copy carries a coded Type; set a proper type in Medicus first".
  Never silently substitutes a type the user didn't approve.
- No parser change — the request builder's refusal on an incomplete code
  is exactly right (server-confirmed); this is a diagnosis/UX layer over
  it. 234/234 parser tests still passing.

## [v3.164.4] — 2026-07-08

### Fix: Author/organisation no longer blocks document field apply (duplicate-checker)

Second live refusal from the user, now specifically on the Author pick —
and a product decision to go with it: GP2GP-imported entries routinely
arrive with the (form-required) organisation entirely blank, so at the
scale involved (≥0.7% of records, hundreds of duplicated items each)
"correct it manually" is the wrong default. Writing an organisation NAME
with null identifiers is a CONFIRMED-valid stored shape (the first real
edit model captured stored exactly that for a manually-entered org) and is
precisely what typing into Medicus's own free-text Organisation field
produces — data improvement, not identifier fabrication.

- New `resolveDocumentOrganisation(editModel, preview)` evidence chain,
  used everywhere an org is needed: structured `authoredByOrganisation.value`
  → `manualAuthoredByOrganisation` text → the preview's displayed
  `authoredByText` → the "Author Org:" segment GP2GP flattens into the
  genericised title (user observation: the org data isn't lost on import,
  just demoted from structured data to freetext inside `title`;
  `parseGenericDocumentTitle`'s segment is label-bounded, so it's clean of
  the trailing custodian/date text).
- A picked Author now applies via that chain; `buildDocumentEditRequest`
  resolves the KEPT copy's own org through the same chain, so a blank
  keeper org no longer refuses an edit to unrelated fields.
- **Organisation prompt** when no name exists anywhere on the record: the
  user is asked for one — default **"Previous GP"** (what the user types
  when Medicus blocks a save on imported data) — instead of being told to
  fix it by hand. The confirmation card states explicitly when a
  previously-blank org is being filled and with what.
- 9 new/updated parser tests (234/234 passing).

## [v3.164.3] — 2026-07-08

### Fix: "None of the picked values could be read safely" on document field apply (duplicate-checker)

Live failure from the user: every picked field refused with the blanket
message. Root cause analysis: the comparison table shows the PREVIEW's
display encodings, but the write needs the structured identifiers behind
them from each copy's edit-details model ({conceptId, descriptionId} for
the code, organisation identifier fields for the author) — and on a
reimport copy those can genuinely be null (unresolved/degraded code,
manually-typed organisation) even though the preview displays fine.
Writing the on-screen string alone would mean FABRICATING clinical-code/
organisation identifiers, so refusal was correct — but it was both
undiagnosable (no per-field reason) and stricter than the evidence
requires for two fields:

- **Two confirmed-shape preview fallbacks** in
  `buildDocumentEditOverrides` (new optional `previewByEntryId` param,
  fully backward compatible): a null edit-model `code.value` falls back to
  the preview's `document.typeCode` — the exact {conceptId, description,
  descriptionId} posted shape, confirmed on every real payload seen — and
  a null `recordDate` falls back to the preview's `document.recordDate`
  (already ISO; the request builder's ISO check still guards a surprise
  format). documentDate (display-formatted in the preview) and author (no
  identifiers in the preview) get NO fallback — refused, never fabricated.
- **Per-field failure reasons**: the status message now names each refused
  field and why ("Type — the other copy's edit form holds no usable
  structured value behind the displayed text…") instead of the blanket
  sentence, and the confirmation card's "not applied" caveat carries the
  same detail.
- Confirmation card fix: an applied preview-fallback value now displays
  correctly in the old → new list (previously re-read from the source edit
  model, which would have shown "→ (none)" for exactly the fallback case).

4 new parser tests (225/225 passing).

## [v3.164.2] — 2026-07-08

### documentLinked groups: side-by-side layout + chronological placement (duplicate-checker)

documentLinked matching confirmed working live by the user (2026-07-08 —
codes duplicated out of document tasks now correctly flagged). Two follow-up
requests from that session:

- **Side-by-side cards** — documentLinked groups (HIGH tier, so they
  previously got the stacked truncated-snippet layout) now always render
  via the same side-by-side diff-card layout REVIEW groups use. The copy
  still linked to its source document is always the diff REFERENCE (it's
  the genuine original/forced keeper), badged
  "still linked to source document — kept" (green); the other copy is
  badged "freestanding copy" (amber).
- **Chronological placement** — documentLinked groups are produced by a
  separate pass and were concatenated after the main group list, so they
  all landed at the very bottom instead of adjacent to the document tasks
  they relate to. New pure `sortGroupsByJournalOrder(groups, entries)`
  orders every group by its earliest member's position in the journal
  itself — a documentLinked pseudo-entry (absent from the journal list)
  falls back to its source document's position via `linkedDocumentId`,
  which is exactly what places the group next to its document task. No
  date-string parsing: the sort inherits the journal payload's own order,
  so it can't mis-parse a date format; unlocatable groups sort last,
  stable. 6 new parser tests (221/221 passing).

## [v3.164.1] — 2026-07-08

### Fix: Compare-fields polish after first live test (duplicate-checker)

Three user findings from live-testing v3.164.0's comparison table:

- **"[object Object]" for Clinical specialty** — the preview's
  `document.clinicalSpecialty` is a plain string on some payloads but an
  OBJECT on others (the tested document's visible "Dermatology" arrived as
  an object). New `specialtyText()` unwrap in
  `engine/record-duplicate-parser.js` — known text keys only
  (description/label/name, incl. nested `.value`); an unrecognised object
  shape renders "(present — format not recognised; check in Medicus)"
  rather than guessing or masquerading as "(none)". NOTE: the write-side
  refusal on non-null clinicalSpecialty still stands — a document WITH a
  specialty set will decline auto-apply until a Save capture on such a
  document confirms the posted encoding.
- **Misaligned radios/values** — each copy now gets two physical table
  columns (fixed 24px radio column + left-aligned value column, radios
  label-linked by id) instead of radio+text sharing one auto-width cell.
- **Created/Filed/File type/File size are now display-only audit rows**
  (user product decision): they're read-only even in Medicus's own edit
  pane (absent from the edit-details model), and the kept copy should
  retain its own creation date, filing date/user and file type/size for
  audit purposes. Marked 🔒, no radios, dimmed, excluded from the "your
  chosen record" summary — shown purely as evidence of which copy is
  which. `buildDocumentFieldComparison` rows expose `systemManaged` so the
  distinction lives in the tested parser, not the UI.

6 new parser tests (215/215 passing).

## [v3.164.0] — 2026-07-08

### Added: document edit write contract — "Apply chosen ✎ values to kept copy" (duplicate-checker)

The document write path was discovered live by the user (2026-07-08, DevTools
capture of a real Save on a test-patient document): `GET
clinical/data/document/edit-details/{documentId}` returns the edit form's
prefill model, and **`POST clinical/document/edit-details`** (documentId in
the BODY, not the URL — the one write contract shaped that way) is the
full-replace save. Confirmed body: `code` and `authoredByOrganisation` post
their GET-model `.value` objects, `linkedProblems` posts as
`linkedProblemIds`, `linkedClinicalCase.defaultClinicalCaseId` posts as
`clinicalCaseId`, `modelVersionHash` echoes back verbatim (concurrency
guard), and `manualAuthoredByOrganisation`/
`shouldEnterAuthoredByOrganisationManually`/`documentType`/`patientId`/
`versionId` are GET-only, never posted. The same capture settled the earlier
open question: **Created/Filed/File type/File size are absent from the edit
model entirely** — system-derived, read-only even in Medicus's own UI — so
Title/Type/Document date/Author/Record date are the writable set.

- `engine/record-duplicate-parser.js`: new `buildDocumentEditDetailsUrl`,
  `getDocumentEditValue`, `buildDocumentEditOverrides`,
  `buildDocumentEditRequest` — same refuse-don't-guess discipline as the
  note contract: refuses (null, never guesses) on non-null
  authoredByDepartment/Practitioner/clinicalSpecialty, non-empty
  selectedStaff/linkedProblems, a real clinical case, drafts,
  marked-incorrect documents, a missing modelVersionHash, any override key
  outside the confirmed set, and non-ISO dates.
  `buildDocumentFieldComparison` rows now expose `editKey` for the five
  writable fields. 42 new tests (209/209 passing), including an exact
  17-key body match against the real captured POST.
- `duplicate-checker.js`: the Compare-fields table now marks writable rows
  ✎ and gains "Apply chosen ✎ values to kept copy…" — collects every row
  where a non-keeper copy's value was picked, fetches each copy's
  edit-details model, reads picked values in posted shape from the SOURCE
  copy's model (never the display-formatted preview), and shows an
  old → new confirmation before POSTing. Manual-only picks (Created/Filed/
  etc.) are listed for hand-correction, never silently dropped.
- **Still open**: removing the duplicate document afterwards. `document`
  remains outside WRITE_CONTRACTS — no mark-incorrect capture for documents
  yet — so the success message says so explicitly. That's the remaining
  half of the user's fuller ask, needing its own DevTools capture (the
  "Mark incorrect" flow on a test-patient document).
- Comment correction (v3.162.1): the `attachment` wrapper on document
  previews is NOT questionnaire-specific — the same capture showed it on an
  ordinary inbound XML document, alongside the top-level `fileType`/
  `fileSize` siblings this tool reads (so the root-level read stays
  correct).

## [v3.163.0] — 2026-07-08

### Added: field-by-field comparison for document-kind REVIEW groups (duplicate-checker)

User's live observation on the existing merge-suggestion UI: for document-kind
groups it word-diffs one concatenated blob (`documentTypeLabel + title +
documentDate + organisationName + additionalInformation`) — since
`documentDate`/`organisationName` usually already match between copies, the diff
is dominated by `Title`/`Type` and never surfaces `Record date`/`Created`/`Filed`
at all, because those fields aren't part of the compared text.

- `engine/record-duplicate-parser.js`: new pure `buildDocumentFieldComparison(group, previewByEntryId)`
  compares 10 fields independently (Title, Type, Document date, Author, Clinical
  specialty, Record date, Created, Filed, File type, File size), each flagged
  `differs` or not. Field paths confirmed live 2026-07-08 against real test-patient-1
  payloads (`clinical/data/document/modals/preview/{id}`, the same endpoint already
  fetched for the fileType/fileSize checks — no new endpoint). Values shown are the
  raw API strings, not reformatted to match Medicus's own display style. 13 new
  tests (167/167 passing).
- `duplicate-checker.js`: document-kind REVIEW groups now get a "Compare fields…"
  button (in place of "Suggest a merge…", which stays unchanged for note/
  prescription/problem — free text genuinely benefits from word-diff, structured
  document metadata doesn't). Renders a table (one row per field, one radio per
  copy, defaulting to the group's computed keeper), with a live-updating "your
  chosen record" summary and a copy-to-clipboard button. `applyOnDemandCrossChecks()`
  now retains the full document preview objects on `analysis.documentPreviewsByEntryId`
  (previously fetched-then-discarded, only fileType/fileSize extracted) so this can
  read them on demand when the button is clicked.
- **Scope, explicit**: this is comparison/reference-building only — there is still
  no confirmed write endpoint for editing a document's own metadata in Medicus
  (`document` isn't in `WRITE_CONTRACTS`), so there is no "Apply" button. The
  summary is meant to be actioned manually in Medicus, same scope the document
  merge-suggestion already had.
- **User's fuller ask, not yet built**: (1) apply the chosen per-field values to
  the kept document, (2) then remove the duplicate document via the same
  mark-incorrect-and-hidden pattern already confirmed for note/problem/
  prescription. Both need their own live DevTools-network-capture discovery
  first — neither has ever been confirmed for `document` in this project
  (explicitly parked earlier for "referral/document type-conversion complexity").
  It's also not yet known whether Medicus's own UI even exposes an edit action for
  fields like Record date/Created/Filed, or whether those are system-derived and
  effectively read-only — worth checking directly before assuming a write path
  exists at all.

## [v3.162.2] — 2026-07-08

### Fix: document-linked-entry matching (v3.162.0) was built against the wrong endpoint — corrected against real payloads

The user supplied real (anonymised) DevTools payloads for a confirmed test-patient
duplicate pair (test patient 1, filed/recorded `careRecordEntryDate` "Wed 07 May
2025" per the payloads — the user referred to it as "12 May 2025", which matches
the files' own embedded creation timestamps instead; see note below) — an NHS 111
letter and a skin-lesion letter, each with SNOMED-coded entries, each duplicated.
They show v3.162.0's
`careRecordElements`-on-the-document-preview approach was simply wrong — that field
exists but was empty on every real document checked, and isn't where a document's
linked entries actually live.

- **Real source confirmed**: `GET clinical/document/entries/{documentId}` — returns
  `{entries: [{id, type, code, text, onClickUrl, isMarkedIncorrect, ...}]}`. On the
  duplicate copy of a document, this call returns `{"entries":[]}` — direct evidence
  the reimport process drops the document-to-entry link on the copy while the
  original keeps it, exactly matching the "broken out into freestanding entries"
  theory.
- No date field exists on these entries at all. `flattenDocumentEntries()` now reuses
  the CALLER's already-known journal `.date` for the document itself (no extra
  fetch, no format-mismatch risk — resolves the open question flagged in v3.162.1).
- `text` is `"{code}: {freetext}"` for note-type entries (confirmed against 3 real
  examples); the code prefix is stripped to recover what a real freestanding note's
  `.note` field would contain.
- Only `type === 'note'` entries are usable — `observation`-type entries (e.g.
  "Alcohol units consumed per week") have no `code` field and `observation` isn't in
  this tool's comparable-entries pool at all. Explicitly skipped, a known scope gap.
- **Keeper asymmetry, fixed**: the two "copies" here are NOT interchangeable like
  everywhere else in this tool — the document-linked entry is the genuine original,
  still correctly attached to its source document, and must never be offered for
  removal. `findDocumentLinkedDuplicates()` now FORCES the document-linked entry as
  keeper, overriding the generic UUIDv7-timestamp tie-breaker. This also means
  removal here only ever targets an ordinary freestanding note — the same
  already-confirmed `patient/note/mark-incorrect-and-hidden` contract used
  everywhere else, not an untested id path — meaningfully safer than v3.162.0's
  design.
- `engine/record-duplicate-parser.js`: `flattenCareRecordElements` replaced with
  `flattenDocumentEntries(documentId, documentDate, entries)`; `findDocumentLinkedDuplicates`
  rewritten for the new data shape and the forced-keeper behaviour.
  `duplicate-checker.js`: `applyOnDemandCrossChecks()` now fetches
  `clinical/document/entries/{id}` for every document-kind entry (dropped the dead
  `careRecordElements`-from-preview extraction it replaces). UI warning banner
  reworded to reflect the safer design.
- 154/154 parser tests passing (test fixtures rewritten for the real shape).
- **Still not fully proven**: the `text` prefix-stripping is inferred from 3
  consistent real examples, not exhaustively verified across every possible note
  shape.
- **Next step**: live-test against test patient 1's 07 May 2025 entry (the pair
  this correction is built from — the user's "12 May 2025" refers to the same
  documents, see the date-mismatch note below) and confirm a `documentLinked`
  group actually appears
  for both the NHS 111 letter and the skin-lesion letter.

## [v3.162.1] — 2026-07-07

### Fix: same-fileType document batches (e.g. multiple NHS 111 letters) wrongly merged

Real-world finding from the user: after a 111 contact, a patient's record can gain
several genuinely separate referral/discharge letters, all uploaded in one batch —
same received/record date, often the same generic resolved type and the same
`fileType` (e.g. all PDFs) — which `splitDocumentGroupsByFileType()` (v3.161.1)
couldn't tell apart, since it only split on `fileType`, requiring >=2 distinct
types to even attempt a split.

- `engine/record-duplicate-parser.js`: `splitDocumentGroupsByFileType()` now takes
  an additional `fileSizeByEntryId` param and buckets document-kind members on the
  composite `(fileType, fileSize)` pair, not fileType alone. A member with a known
  fileType but unknown fileSize buckets under `${fileType}::unknown-size` — i.e.
  when size can't be confirmed, this degrades to the old fileType-only behaviour
  for that member rather than guessing a size match. Fully backward compatible:
  callers that don't pass the new third argument get identical behaviour to
  before. 151/151 parser tests passing (11 new).
- **`fileSize`'s field name and position CONFIRMED live 2026-07-07**, from a
  real anonymised payload the user supplied
  (`clinical/data/document/modals/preview/{id}`): `fileType`/`fileSize`/
  `fileCanExport`/`fileId`/`fileName` all sit as direct top-level siblings on
  the response root, exactly where the fix already reads them — no code
  change needed, this just upgrades the earlier "inferred guess" caveat to
  confirmed. Same payload also confirms `fileType`/`fileSize` are NOT nested
  under an `attachment` object on ordinary documents — that wrapper shape
  (`attachment.fileRoute`/`attachment.fileId`, used by
  `hasQuestionnaireTemplateMismatch`) is specific to questionnaire-response
  documents, not a general document shape.
  `duplicate-checker.js` still surfaces "N/M document preview(s) had a
  usable file-size field" in the summary line — useful general coverage
  visibility (not every document type may expose it) even though the field
  name itself is no longer in doubt.
- **New open question from the same payload**: this document's own
  `recordDate` is ISO-formatted (`"2025-03-06"`), distinct from
  `careRecordEntryDate` (`"Thu 06 Mar 2025"`, matching the journal's
  `day.title` format). Since `flattenCareRecordElements()` (v3.162.0) reads
  a `recordDate` field OFF EACH `careRecordElements[]` ITEM and compares it
  by exact string equality against journal `day.title` strings, if the
  per-element `recordDate` uses the same ISO convention as this document's
  own top-level `recordDate` (same field name, same API family — plausible
  but NOT yet directly evidenced, since this particular document's
  `careRecordElements` array was empty), the document-linked-entry matching
  feature would systematically fail to match anything live, exactly the
  failure mode its own code comment already flagged as a risk. Needs one
  real example of a document with a NON-empty `careRecordElements` array to
  confirm the actual per-element date format before deciding whether to
  normalise it.
- **Next step**: live-test against a patient with a known same-day,
  same-fileType, different-document batch (a 111 referral bundle is the
  concrete example given) to confirm the fix behaves as expected; separately,
  find a document with populated `careRecordElements` to settle the
  date-format question above.

## [v3.166.0] — 2026-07-09

### Assurance pack, Record-tab allergy alerts, read-retry, Trends on the API feed

**API parity report (options page).** One click turns the hybrid-mode shadow
ledger into a Markdown evidence pack: divergence counts and timeline, feed
failure reasons, honestly worded (parity views record nothing, so a quiet
report over a long period is the strong signal). Downloads like the ledger's
CSV export; contains no patient identifiers (asserted by test); clock-free
and byte-deterministic (`shared/txn-parity-report.js`).

**Record tab: drug-allergy safety prompts.** When the API feed supplies
allergies, the Prescribing-safety card now evaluates the drug-allergy rule
pack (same engine, same rules as sentinel/sweep — no re-implemented matching)
and lists conflicts first. Session-only renders are pixel-identical to
before; every layer fails soft. Per-section merge re-audited against the
v3.165.0 enrichment: `problems` now feed-first (all rendered fields covered,
including significance); medications/observations stay session-fed with the
exact missing fields documented in-code (bundle `observations` still strip
`rawValue` — noted for a future normaliser pass).

**Transport read-retry.** One backed-off retry (capped, jittered) for
transient READ failures only (timeout, network, 502/503/504/429). Writes are
never retried — asserted by test (exactly one fetch, ever). 500/501 and other
4xx are deliberately non-retryable. First-try successes are unchanged.

**Trends tab on the API feed.** In transactional mode the BP/renal/HbA1c/
cholesterol/weight charts can source from the enriched feed — guarded by a
runtime per-patient coverage check: the feed only takes over if it yields a
non-empty series for every metric the session feed found, otherwise the whole
tab stays on session ("never render worse", enforced live). Subtle
provenance line matches the Record tab.

Tests: 317 passing (was 277) — new `test-txn-parity-report.js` (18),
`test-record-allergy-prompts.js` (12), `test-txn-transport-retry.js` (10).

## [v3.165.0] — 2026-07-09

### The API feed becomes the richer source + production guardrails

**FHIR normaliser enrichment.** The transactional bundle previously carried
LESS than the session feed in places — no medication dosage, no
abnormal-result flags, no problem significance — which is why v3.164.0's
Record tab deliberately kept those sections session-fed. The normaliser now
extracts what GP Connect was carrying all along: `dosage` (from
dosageInstruction/patientInstruction), `isAbove`/`isBelow` (computed from
referenceRange, including per-component handling for BP-style observations —
any component breaching its own range flags the observation), the same flags
through `observationHistory`, and problem `significance` (major/minor from
the ProblemSignificance extension). All additive; field names verified
against the session normaliser and Record-tab reads so consumers adopt them
without translation; every extraction fails soft per-item. This unlocks
flipping Record sections and the Trends tab to the API feed in a later
release.

**Production interlock.** Saving API settings with environment `prod` and a
non-Session mode now requires a deliberate second Save within 10 seconds,
behind an explicit live-patient-data warning. Every other combination saves
exactly as before.

**Service-worker request gate.** All transactional network calls (bundle
fetches, connection tests) now pass through a shared FIFO concurrency gate
(max 3 in flight) — Sweep batches, the Record tab, sentinel and shadow
comparisons across multiple tabs can no longer stampede the proxy or
Medicus's staging environment. Cache hits bypass the gate entirely.

Tests: 277 passing (was 250) — new `test-fhir-enrichment.js` (20) and
`test-txn-request-gate.js` (7).

## [v3.164.0] — 2026-07-09

### The API feed reaches the panel: Sweep worklist + pre-consultation brief

**Shared feed selector.** `shared/panel-txn-feed.js`: panel modules source the
same normalised engine bundle from the Transactional API feed when — and only
when — the practice has switched to `transactional` mode (via the service
worker + its 60s cache). Session and hybrid modes return null so the panel is
byte-for-byte unchanged; every failure falls back to the session path.

**Sweep tab.** Each booked patient's bundle can now come from the API feed,
per-patient fallback to session, with a subtle `API`/`session` provenance
badge on every row and a run summary ("via API feed: N · via session: M",
shown only when the feed served anyone). Persisted/resumed runs keep their
provenance. Also fixes a pre-existing gap: Sweep now threads `allergies` into
the rules engine (mirroring sentinel.js), so drug-allergy alerts can fire in
the pre-clinic sweep — previously they never could.

**Record tab → pre-consultation brief.** New "Since last visit" section at the
top: on each view the record is fingerprinted (hashed keys only — no clinical
text is ever stored; `brief.fp.*`, pruned beyond 200 patients) and diffed
against the previous view — "+ allergy: penicillin", "+ medication: apixaban",
"N item(s) no longer present — review", or "No changes since DATE".
Medication identity is dose-insensitive (a dose change is not a stop+start).
Ported from the population-sweep delta engine (`shared/record-delta.js`), with
a browser-safe hash substitution documented in the file. The tab can also
draw on the API feed: per-field audit keeps richer session fields
(dosage/flags/raw values/significance) session-fed so no section ever renders
worse; `allergies`/`immunisations` — which the session path never had — come
from the feed. One provenance line ("Data: API feed"/"Data: session").
A delta failure can never break the tab (section simply omitted).

Tests: 250 passing (was 241) — new `test-panel-txn-feed.js` (3) and ported
`test-record-delta.js` (6).

## [v3.163.0] — 2026-07-09

### Staging-friendly caching + dormant check-in prompt builder

**Patient-bundle cache (service worker).** Transactional bundles are now
cached for 60s per `tenant|environment|patientUuid` (`shared/
txn-bundle-cache.js`, max 50 entries, oldest evicted). The cache is checked
only after the integration-enabled/config guards, only successful bundles are
stored, and ANY change to `txn.*` settings or `suite.practiceCode` flushes it.
Repeat views within a minute stop re-fetching through the proxy — kinder to
Medicus's staging environment during live testing, and faster for the
clinician. Cached responses are marked `cached: true`.

**"While you're here" prompt builder (dormant).** `shared/checkin-prompts.js`
is the pure core of composite feature B (opportunistic case-finding at
check-in): it turns engine chips into a short, prioritised, reception-safe
prompt list. Safety prompts (drug-allergy / drug-combo alerts, prefixed
"URGENT:") always survive the display cap; monitoring (`overdue`/`stale`),
vaccines due and unmet QOF indicators follow in clinical-priority order.
Labels are built only from fields already on the chip — nothing invents
clinical text. NOTHING calls it yet: it ships dormant, ready to wire the
moment the Medicus appointments spec lands.

Tests: 241 passing (was 216) — new `test-txn-bundle-cache.js` (6) and
`test-checkin-prompts.js` (19).

## [v3.162.0] — 2026-07-09

### Live-testing readiness: settings UI, true hybrid shadow mode, failure visibility

Everything a practice needs to trial the Transactional API feed safely,
without touching devtools — and everything the crossover period needs to
prove parity between the session feed and the API feed.

**API Integration settings (options page).** New "API Integration" section:
mode (Session / Hybrid / Transactional, with plain-English explanations and a
soft warning when selecting Transactional), environment (staging/prod), proxy
URL, caller key (password field; stored locally, read only by the service
worker, never included in Suite backups), optional clinician email for
user-restricted attribution, and a read-only view of the tenant
(`suite.practiceCode`). A **Test connection** button runs a ping through the
proxy and reports stage-aware, plain-English results — config missing vs
"Proxy rejected the caller key" vs "Could not reach the proxy" vs "Proxy timed
out" vs an upstream Medicus error (new `txn:testConnection` SW message; runs
even in Session mode so config can be validated before switching).

**True hybrid (shadow) mode.** `hybrid` previously behaved identically to
`transactional`. Now it is a genuine shadow: the session bundle is ALWAYS what
renders (identical clinical behaviour to Session mode); the API bundle is
fetched concurrently, the same rules are evaluated against it, and
`shared/txn-shadow-summary.js` + `shared/shadow-compare.js` diff the two chip
sets. The status line shows ` · API shadow: parity` or
` · API shadow: N difference(s)`, and divergences are recorded in the Event
Ledger (`txn-shadow-divergence`, with severity regression/escalation-only) —
the ledger's CSV export is the parity evidence pack for assurance. A hard
shadow budget (6s) guarantees a slow/hung proxy can never delay the
clinician's render; budget breaches are recorded as `txn-shadow-unavailable`.

**Failure visibility.** In Transactional mode, falling back to session data is
now visible (` · API feed unavailable — using session data` + `txn-fallback`
ledger event) instead of silent. All shadow/status logic is wrapped so a
telemetry bug can never break clinical rendering.

**Proxy transport timeout.** `shared/txn-transport.js` now aborts proxy calls
after 10s (configurable `timeoutMs`) with `err.isTimeout`; writes keep their
never-silently-retried semantics. Previously a hung proxy call could stall a
fetch for the browser default (30s+).

Tests: 216 passing (was 194) — new `test-txn-transport-timeout.js`,
`test-txn-hybrid-fetch.js` (incl. shadow-budget render-delay proof),
`test-txn-shadow-status.js`.

## [v3.161.1] — 2026-07-08

### Fix: drug-allergy chips fired but were never shown to the clinician

The new `drug-allergy` rule type (v3.161.0) evaluated correctly and produced a
`{ type: 'drug-allergy', ... }` chip (see `test-drug-allergy.js`), but the
rendering side of the pipeline had no idea the type existed:

- `content-scripts/sentinel.js`'s `chipHtml()` dispatch had no case for
  `drug-allergy`, so it fell through to the generic `<div>Unknown chip
  type</div>` fallback.
- The default grouped view (`chipGrouping: 'by-type'`, `renderGroupedChips()`)
  only ever built sections for `drug-monitoring` and `qof-indicator` — a fired
  drug-allergy chip was grouped into `groups['drug-allergy']` but that group
  was never drawn, so the chip stayed invisible even in the flat view fallback.

A patient could have a live drug-allergy contraindication and the panel would
show nothing.

- Added `ChipRenderer.renderDrugAllergyChip()` (`shared/chip-renderer.js`) —
  distinct from `renderDrugComboChip` because `chip.matchSummary` is a plain
  string here (`"Penicillin allergy + Amoxicillin"`), not an array of
  `{setName, drugs[]}` sets, so reusing the combo renderer would throw.
  Surfaces the label, match summary, status badge, source/notes tooltip, and
  the evidence facts (allergy + matched drug set + cross-sensitivity note)
  inline, plus the click-to-expand evidence panel affordance shared with the
  other alert-style chips.
- Wired `chip.type === 'drug-allergy'` into `chipHtml()`.
- Added a `drug-allergy` section (label "Drug Allergy") to the default grouped
  view, listed **first** — ahead of Drug Monitoring and QOF Indicators — since
  it is a red patient-safety contraindication alert and needs top visual
  priority.
- No engine or rule changes — rendering only. `test-drug-allergy-render.js`
  (6 tests) drives the real `evaluateDrugAllergyRule` → `evaluatePatient`
  output through the real renderer and pins that it no longer returns
  "Unknown chip type".

## [v3.161.0] — 2026-07-08

### Drug-allergy safety rules (enabled by the Transactional care record)

A new `drug-allergy` rule type fires when a documented **active** allergy
co-occurs with a contraindicated drug — the first rule to read the allergies
bundle, which only the Transactional (GP Connect Structured) feed provides.

- **Fail-closed by design:** with no allergy data the rule never fires and never
  asserts "no allergy", so it is dormant and zero-risk on the legacy session/DOM
  feed (which has no allergies) and lights up only when a real allergy record is
  present. Shipped enabled for that reason; term lists marked PENDING CSO REVIEW.
- **Starter pack (4 rules)** in `rules/drug-rules.json`: penicillin/beta-lactam
  (red), penicillin→cephalosporin cross-sensitivity (amber caution, not absolute),
  NSAID/aspirin hypersensitivity (red, topical excluded), sulfonamide-antibiotic
  (red). Only ACTIVE allergies count; resolved/inactive/refuted are ignored.
- Engine reads `data.allergies` (threaded through `evaluatePatient` options and
  both Sentinel call sites). `test-drug-allergy.js` (5 tests): fires, fails
  closed, drug-absent, status-filtering, and the real pack on representative data.

## [v3.160.0] — 2026-07-08

### Transactional API integration (dormant by default) + feed-swap safety gate

The official Medicus Transactional API (JWT/JWKS, server-to-server) can now
source the patient bundle, behind `txn.integrationMode` — default `'session'`,
so nothing changes until a practice opts in. See
docs/TRANSACTIONAL-API-INTEGRATION.md for the architecture and settings.

- **New shared modules:** `txn-config` / `txn-transport` / `txn-api` (proxy
  client — the extension never holds the signing key; our backend signs a ≤60s
  JWT and forwards), `fhir-normaliser` (GP Connect Structured → the exact
  engine bundle, now including **allergies and immunisations**, which the
  session feed cannot provide), `fhir-results-adapter`, `fhir-triage-fields`,
  `immunisation-bridge`, `record-provider`, `shadow-compare`.
- **Service worker** owns the proxy credential (`txn.callerKey`, read nowhere
  else, excluded from backups) and serves `txn:fetchPatientBundle` messages;
  `engine/data-fetcher.js` tries the transactional feed first when enabled and
  falls back to `fetchLive()` on ANY failure — the new feed can never make the
  extension show less than today. Reads only; no write endpoint is wired.
- **Vaccine status upgrade:** structured `Immunization` resources drive
  given/declined via `immunisation-bridge` (a false "flu due" resolves to
  "given") — previously inferred from coded text only.
- **Safety gate in CI:** `test-txn-shadow.js` runs the REAL rules engine,
  result-severity and triage matcher on the FHIR feed — parity must hold, and
  a narrower API record (GP Connect exclusion rules) must be FLAGGED as a
  regression, never silent. 38 new tests across `test-txn-*.js`.
- `host_permissions` gains the backend-proxy origin (`https://*.supabase.co/*`).
- Scheduling/capacity/task/reporting modules are untouched: the Transactional
  API has no equivalent endpoints, so they stay on the session feed.

## [v3.162.0] — 2026-07-07

### Baselines: "is today busy, or does it just feel busy?"

Gauntlet exceed-plan item B3 / dream-panel D3 (third consecutive panel run
asking for history): today's demand now reads against the same weekday's own
ledger history, in plain English.

- **Today demand card + Submissions today view** carry a baseline line —
  "Busier than usual for a Tuesday — ahead of 7 of the last 9 by this time"
  (amber ink only when genuinely ahead of most of its history; quieter and
  typical days stay muted).
- **Compared honestly**: cumulative to the same hour of day (a half-day is
  never compared against past full days); a viewed past day compares as a
  complete day. Counts, not percentiles — checkable by hand from the
  compare view.
- **Watched days only, minimum 4 samples**: unwatched ledger days are known
  undercounts and are excluded (they would bias every ordinary day toward
  "busier than usual"); until four watched same-weekdays exist, the line
  simply doesn't render — no baseline invented from two points.
- Pure logic in `submissions-core.js` (`demandBaseline`, regression-tested:
  weekday isolation, watched-only sampling, half-day honesty, band edges,
  minimum-history gate).

## [v3.161.0] — 2026-07-07

### Signing Queue: prescribing-safety combinations at the decision moment

Gauntlet exceed-plan item B1, slice 1 (docs/benchmark/GAUNTLET-2026-07-07.md):
the engine already evaluates the practice's drug-combination rules (the
CSO-reviewed alert library + practice-authored combos) on every signing
check — their chips were simply filtered out. They now render on the row:

- **Combination chips** (dashed border, red/amber tiers) alongside the
  monitoring chips — e.g. "ACEi/ARB + NSAID concurrent" — with the matched
  drugs verbatim in the tooltip. No new clinical rule content: this
  re-displays an already-evaluated fact at the point of authorisation.
- **"In request" flag** when a drug in the request itself is one leg of a
  flagged combination — the acute-NSAID-completes-the-AKI-cluster case —
  additive salience only, same doctrine as the requested-drug tag.
- Red combinations join the riskiest-first sort banding and the hidden-red
  filter note; the no-eGFR call-out now also fires on combination-flagged
  rows. The 'noted' awareness tier deliberately stays in Monitoring so
  signing-time salience is reserved for act-on-it-now combinations.
- Hazard log: **H-038 controls (j)–(l)** recorded (re-display-only scope,
  additive salience, awareness-tier exclusion).

## [v3.160.0] — 2026-07-07

### New Follow-ups tab: the personal safety-net ledger

The strongest convergence of the 2026-07-07 Practice dream-feature panel
(docs/appraisal/PRACTICE-dream-features-2026-07-07.md, item D1 — 7 of 10
personas independently asked for loop-closure memory): the things a clinician
is waiting on — "MSU pending, chase Friday" — held locally and resurfaced when
the due date passes, instead of living in their head all week.

- **Follow-ups tab** (`side-panel/modules/followups/`): add what you're
  waiting for with a due date; entries band as waiting → due soon → due today
  → **overdue** (lapsed is the loudest state — the broken chain IS the
  product), sorted most-lapsed first. Done entries keep a struck-through
  30-day trail, then auto-prune.
- **Add from Monitoring**: an "Add follow-up reminder" action on the open
  patient (overflow menu) creates a patient-linked entry — UUID captured from
  the record context with the same open/submit wrong-patient re-check as the
  create-task form. Entries added on the tab itself are explicitly labelled
  "unlinked note"; a typed name is never treated as identity.
- **Today line**: "Follow-ups: 2 overdue · 1 due today" under the headline —
  red when anything has lapsed, hidden entirely when the ledger is empty.
- **Honest state, fixed**: the ledger is a personal reminder list on this
  machine only — not the clinical record, never a safety-netting system of
  record, and nothing in it acts by itself. Stated permanently on the tab and
  at the point of capture. Patient-identifiable by nature, so the store is
  **excluded from suite backups** (machine-local by design, enforced by the
  backup-coverage test) and open entries are **never silently pruned**
  (regression-tested). Ledger writes are audited to the event ledger by
  patient UUID. Hazard log: **H-040**.

## [v3.161.0] — 2026-07-14

### Practice-panel wishlist wave 2 (the 1–2-day roadmap items)

Second build wave from `docs/appraisal/PRACTICE-wishlist-whole-suite-2026-07-03.md`.

**Sweep — nurse clinic-prep worklist + QOF £**
- New collapsible prep view grouping the day's action-needed findings by what
  the nurse physically preps: bloods to draw, non-blood checks (BP/weight/ECG),
  vaccines to fetch, reviews to book — a drug needing both bloods and a check
  appears in both buckets. Printable prep list follows the handout pattern
  (transient `sweep.worklist`, consume-on-read, never backed up). Absence never
  reads as all-clear.
- QOF points-at-risk can now show pounds: enter your practice's own £/point
  figure once (inline cog, `sweep.qofConfig`, no shipped default — the tool
  asserts no national price); total and CVD subtotal render in £ alongside
  points. Non-clinical arithmetic only.

**Manager pack — months and sessions**
- Submissions: This month / Last month range presets, and a Compare sub-mode
  "This month vs last month" — always month-to-date vs same-day-of-prior-month,
  never a partial month against a full one, with the spans shown on-screen.
- Activity: "Compare vs previous period" toggle (same same-span convention)
  with per-clinician deltas in the list and CSV; "Per session" toggle divides
  each clinician's totals by their non-cancelled session count (from the
  scheduling overview, ≤31-day ranges via the capacity module's fan-out
  pattern) — session count always shown next to the derived figure; "0
  sessions — check rota" instead of Infinity; no session data = raw + marker.
- Condor Pulse: calendar "Month view" line (PPI + demand, month-to-date vs
  same span last month) over the existing snapshot store, with the honest
  "N of M possible snapshots" coverage disclosure — gaps are never
  interpolated.
- `aggregateSlots` now reports per-clinician non-cancelled `sessions`
  (additive).

**Referrals — 2WW chase-letter draft**
- Each safety-net row gains a "Chase draft" button: a prepared, letterheaded
  chase letter (patient, referral date, days outstanding, specialty/hospital,
  referral ID) in a readonly textarea with copy-to-clipboard. Prepared draft
  only — review and edit before sending; never auto-sent; right-patient
  fineprint included.

**Record — SMR prep pack**
- "SMR prep pack" button prints a clinician-facing sheet composing problems,
  dosed medications with overdue/review flags, per-rule monitoring status, ACB
  and STOPP/START prompts, QOF gaps and latest observations — with the
  mandatory allergies/immunisations/history gap block and verify-before-
  prescribing framing top and bottom. Forked from the passport print pattern
  (transient `record.smrPack`, consume-on-read, never backed up). Empty
  sections say "none recorded in live view", never implying reviewed-and-clear.

**Panel — keyboard-first navigation**
- 1–9 jumps to the Nth visible tab; `g` + letter chords (g t today, g m
  monitoring, …); `/` focuses the active module's search; `?` opens the help
  popover with a new shortcuts cheat-sheet. Single shared typing guard with
  the existing Ctrl/Cmd+Alt+←/→ cycler; palette/tour/popovers always win.

## [v3.160.2] — 2026-07-14

### Fix: Suite-health strip false-alarming "Patient UUID resolution … degraded" on the Appointment Book

The amber Suite-health strip (self-diagnosis, `shared/contract-canary.js`) was
promoting the `api-client.patient-uuid-dom-fallback` contract to **degraded** on
the **Appointment Book** — and other patient-less screens — while nothing was
broken. An amber strip that cries wolf trains users to ignore it, which is worse
than no strip at all.

Root cause: the v3.75.x-era applicability gate treated the probe as meaningful
whenever *any* anchor on the page carried a bare UUID. A diary row links to an
**appointment** UUID (satisfying that gate) but carries no `/care-record/` or
`/patient/` link (the probe's target), so the probe FAILed and two spaced visits
promoted a false "degraded".

- **Replaced the `anchorHrefRe` gate with a patient-banner-presence gate**
  (`applicableWhenPresent` in `shared/dom-contracts.js`). The probe now only runs
  where a patient is actually in context — mirroring the extension's own
  patient-context detectors (`content.js`, `patient-context.js`). The appointment
  book, dashboards and the multi-patient queue (no banner) read
  **not_applicable**, never FAIL.
- **Genuine drift detection is preserved**: on a real patient page where Medicus
  renames the `/care-record/` URL shape, the banner is still present but the
  care-record links vanish → the probe still FAILs (the banner selector doesn't
  depend on the care-record URL, so it survives the rename). Per this strip's
  doctrine ("false-positive discipline beats coverage"), an over-strict banner
  selector under-alarms — the safe direction.
- **`stateEpoch` bumped 2 → 3** so the canary discards any currently-stuck
  'degraded' verdict issued under the old gate; the strip clears itself on the
  next probe round (e.g. the next Appointment Book visit) with no user action.
- No change to `engine/api-client.js` (`findPatientUuidFromDom` still scans all
  `a[href]` — `anchor` is unchanged); tests updated in `test-dom-contracts.js`.

## [v3.160.1] — 2026-07-14

### Fix: "Send to Prescribing / Meds Management" button failing with "isn't in the assignee list"

The routine-prescription re-assign button (`routine-rx-button.js`) aborted at
step 3 — *"Team 'Prescribing / Meds Management' isn't in the assignee list.
Open the picker to check the exact name…"* — even though the team exists. Same
symptom as v3.143.2, different trigger.

Root cause: step 3 typed the **entire configured team name** into Medicus's
debounced, server-driven "Assign to" search and required a matching option to
render. A name like `Prescribing / Meds Management` carries a `/` and several
words; that class of query frequently returns **zero rows** from the live
search even though a shorter query (`Prescribing`) returns the team. Coupling
*what we type to filter* with *the full name* is exactly what keeps breaking
when Medicus tweaks the picker's search.

- **Decoupled the search query from the match.** Step 3 now types a **safe
  leading token** (the team name up to the first character that isn't a
  letter/digit/space — e.g. `Prescribing`) to surface the team, then matches
  the option by its **full team text** (exact, else contains) as before. It
  falls back to typing the full name for any picker where that string genuinely
  did work, so no practice that worked before regresses. What we *type* and
  what we *select* are now independent — a broad token still selects the exact
  team, never the wrong one.
- **Diagnostic breadcrumb on failure.** When no option matches after every
  query, a single `console.warn('[ClinHUD:rx] …')` lists the queries tried and
  the option texts the picker actually rendered — so a page-console capture
  (CLAUDE.md "capture first") tells apart *search returned nothing / not a
  search picker* (empty) from *returned options but the configured name doesn't
  match* (a team-name mismatch, fixable via the ▾ menu).
- No selector change (the `[id^="select-item-"]` / `[role="option"]` markup is
  unchanged), no change to the fail-closed safety guards — the macro still
  matches every control by visible text, aborts rather than clicking the wrong
  one, and commits only per `commitMode`.
- Tests: `test-routine-rx-macro.js` updated for the query ladder and a new
  full-name-fallback scenario (54/54); `test-routine-rx-audit.js` unaffected
  (23/23).

### Also: unblocked two CI checks left red by the v3.160.0 merge

v3.160.0 shipped with two CI checks already failing on `main`; this branch
rebased onto it and inherited both. Neither is related to the routine-rx fix;
both are cleared here so the PR can go green. **The clinical content added
below still requires CSO review** — CI green attests only that the coverage
guards pass, not that a Clinical Safety Officer has signed off the new terms.

- **`engine/reception-match.js`** — v3.160.0 added the `sinusitis` pathway and
  new red-flag ids (`rf-weightloss`, `rf-new50-visual`, `rf-orbital`,
  `rf-frontal-swelling`, `rf-severe-unwell`, `rf-fontanelle`) to
  `rules/reception-pathways.json` without the matching `SYNONYM_TERMS` /
  `RED_FLAG_TOPIC_TERMS`, failing `test-reception-match.js`'s coverage guard.
  Added conservative topic terms for each, derived directly from each item's
  `ask` text and following the module's fail-safe direction (a missing term
  makes a red flag read as a GAP that is re-asked, never a silent suppression).
  Marked CSO-reviewable inline, per the file's existing clinical-content note.
- **Safety-doc version pins** — v3.160.0 updated the manifest to 3.160.0 but
  left `docs/CLINICAL-SAFETY-NOTICE.md`, `docs/HAZARD-LOG.md` and
  `docs/feature-list.md` pinned at `3.159.0`, failing `check-doc-versions.js`.
  Synced those three pins to `3.160.1` (the established incremental-sync
  pattern). The `docs/cso-review-ledger.json` record of the last *full* CSO
  review (3.115.0 / 3.126.0) is deliberately left unchanged — no CSO review is
  claimed by this sync; `docs/SOUP.md` stays at its ledger pin (STALE, within
  threshold).

## [v3.160.0] — 2026-07-11

### The Keeper: clinical rule currency update (2026-07-11)

Automated horizon-scan of all Sentinel rule files against authoritative UK sources.
All changes are additive or corrective; no monitoring intervals lengthened, no alerts
removed. Full test suite passes (0 failures). CSO review required before merge.

**Medicines monitoring (`rules/drug-rules.json`)**
- `ace-arb`: added cilazapril (Vascace), imidapril (Tanatril) — both UK-licensed ACEi brands absent from match list (silent miss; BNF July 2026)
- `antipsychotic`: added sulpiride (Dolmatil/Sulpitil/Sulpor), zuclopenthixol (Clopixol), flupentixol (Depixol/Fluanxol), fluphenazine (Modecate) — UK-licensed FGA antipsychotics with distinct brands absent from match list
- `chc-combined-hormonal`: added Logynon, Synphase to match; added Slinda to exclude (POP, false-positive risk)
- `sodium-valproate`: new monitoring rule (annual FBC/LFT/U&E); match includes "valproic acid" as explicit term (does not substring-match "valproate"); MHRA PPP obligation noted in alert text
- `finerenone`: new monitoring rule (Kerendia; 4-monthly U&E/K+/eGFR; licensed for CKD+T2DM)

**QOF indicators (`rules/qof-rules.json`)**
- Added LD register (QOF 2025/26 LD001 reintroduced)
- Added DEM004 (dementia carer review)
- Added CKD002 (urine ACR testing) and CKD003 (BP <130/80 in CKD with proteinuria)
- CHOL003 and CHOL004 cloned to multi-register populations (PAD, STIA; CHOL003 also CKD; CHOL004 excludes CKD per QOF spec)

**Vaccine eligibility (`rules/vaccine-rules.json`)**
- Flu homelessness cohort: ageMin 16 added
- Shingles notes: corrected immunosuppressed pathway to 18+

**Alert library (`rules/alert-library.json`)**
- `pincer-7`: INR interval corrected 90d → 84d (= 12 exact weeks, NPSA/NICE NG196)
- `prescribing-qtc-combination`: pimozide regression-locked in test
- `alert-001`: new — NSAID without PPI in GI-risk patient (PINCER 2024; 22 NSAID terms)
- `alert-002`: new — dual beta-blocker (PINCER 2024; 15 beta-blocker terms)
- `alert-004`: new — acitretin/alitretinoin PPP in women 12–55 (MHRA)
- `alert-005`: new — 5-alpha-reductase inhibitor teratogenicity flag (MHRA 2023)
- `alert-008`: new — dual antiplatelet review (aspirin_ap 8 terms + P2Y12; PINCER 2024)
- `alert-009`: new — NSAID + anticoagulant (PINCER 2024; 22 NSAID terms)

**Medication review instruments (`engine/acb-scores.js`, `engine/stopp-start.js`, `visualiser-core.js`)**
- ACB: added trimipramine (Surmontil, score 3), darifenacin (Emselex, score 3), trifluoperazine (score 3)
- STOPP: added loprazolam, lormetazepam to BENZO_TERMS (criterion 4); alimemazine/trimeprazine to FIRSTGEN_AH_TERMS (criterion 3)
- START: added pitavastatin to STATIN_TERMS; acebutolol/celiprolol/nadolol/oxprenolol to BETA_BLOCKER_TERMS
- visualiser-core: aspirin_ap expanded (8 terms); antipsych adds amisulpride/paliperidone; benzo_z adds loprazolam/lormetazepam

**Reception pathways (`rules/reception-pathways.json`)**
- `backpain` rf-bladder: added "difficulty starting to pass urine" (NICE CKS cauda equina signs)
- `feverish-child`: added rf-fontanelle (bulging fontanelle → 999; NICE NG143 immediate emergency)
- `cough`: promoted unexplained weight loss from history question to red flag (duty; NICE NG12)
- `headache`: split GCA flag into rf-new50-visual (visual symptoms → 999, sight-threatening) and rf-new50 (no visual → duty; NICE CKS GCA / BSR guidelines)
- `sinusitis`: new pathway, Pharmacy First eligible age 12+, 6 red flags, 6 history questions

**Tests extended:** test-drug-brand-coverage.js, test-qof-indicator-filters.js, test-acb-scores.js, test-stopp-start.js, test-visualiser-pincer.js, test-reception-pathways.js, test-alert-library-coverage.js

**Sources:** BNF (July 2026, corroborated — primary PDFs returned 403); NHS England QOF 2025/26 (PRN02356); NHSE Annual flu letter 2025/26; PHE Green Book ch.19/28a; MHRA DSUs (valproate PPP, pimozide QTc, acitretin/alitretinoin PPP, finasteride/dutasteride); PINCER v2024; NPSA/NICE NG196; STOPP/START v3 (O'Mahony 2023); Boustani ACB/ACBcalc; NICE CKS (backpain, GCA, sinusitis, cough); NICE NG12, NG143; NHSE Pharmacy First spec 2024.

## [v3.159.0] — 2026-07-07

### Signing Queue: one warm line on the genuinely finished pile

The maintainer asked for "a smiley face or something" on clear states; a
scoped Practice-panel run (docs/appraisal/PRACTICE-clear-state-2026-07-07.md)
unanimously rejected the smiley — including the consumer-savvy persona — and
converged on one fixed line of warm, static text instead. Shipped as ruled:

- Signing Queue's empty state now reads **"✓ Pile's clear — nothing waiting
  on you."** (muted-green tick, sentence case) — acknowledgement and
  permission to stop, not celebration. No emoji, no animation, no rotating
  copy, no sound; identical every day so it fades into competence.
- **Only when genuinely finished** (`emptyStateKind` in signing-core.js,
  tested): every task type ticked and no location filter active. A narrowed
  view keeps the neutral "No open repeat requests for the selected types." —
  warmth on a false all-clear is worse than no warmth at all.
- Doctrine recorded in the appraisal doc: delight attaches to finished WORK,
  never to absence of clinical alerts, and never near a caveat.

## [v3.158.0] — 2026-07-07

### Signing Queue: location filter pills + glance glyphs (panel-appraised, user-placed)

The v3.157.0 collection chip, matured through a scoped Practice-panel run
(docs/appraisal/PRACTICE-signing-chip-2026-07-07.md) and then real-user
feedback from the practice's own dispensary side:

- **Location filter pills with counts** above the pile ("Dispensary 6 ·
  Boots Pharmacy, Godalming 1 · No location 3") — derived from the values
  present, clickable to filter, invisible at practices that never record
  locations. "No location" is an explicit, countable bucket: a blank can no
  longer silently read as "not ours" (the panel's sharpest finding).
- **A narrowed view is never silent**: an active filter shows "N requests
  hidden by the location filter", and any hidden RED-flagged rows are called
  out by count in red (H-038 control (j)). The monitoring pass always checks
  every row regardless of the filter. Filter is session-only, never
  persisted — a remembered filter could hide rows from a user who forgot it.
- **Chip placement settled by the real user**, overriding the synthetic
  panel's meta-line ruling: it stays in the row head after the name, and the
  SYMBOL now carries the glance category — house glyph (tinted) = practice
  dispensary, Rx glyph (outline) = community pharmacy — answering the
  phone-call question ("with our dispenser or your usual chemist?") without
  reading. Category is a /dispens/i heuristic on the recorded name; the
  verbatim text always rides alongside so a mis-coded location stays visible.

### Monitoring: "Create task" for the open patient (Sweep's close-the-loop)

Sweep's per-patient "Create recall task" — requested for the Monitoring tab —
added to the Sentinel action bar. Same machinery (`shared/task-api.js`
driving Medicus's OWN general-task endpoints; Medicus's validation, access
control and audit fire as normal), description prefilled from the patient's
action-needed chips via the shared instruction grouping ("Recall (from
Monitoring): …"), assignee/priority from the live Medicus form, one explicit
confirm, EventLedger record on success. **Wrong-patient guards (H-023
extended):** the form permanently names the patient it was opened for, and
submit re-checks the currently-followed patient UUID against the one captured
at form-open — auto-follow moving on mid-form invalidates the submit instead
of creating a task against the wrong record.

## [v3.157.0] — 2026-07-07

### Signing Queue: collection-location flag (dispensing patients)

Each signing row now carries the request's recorded **collection location**
verbatim from the task row (`collectionLocationName` — zero extra fetches),
rendered as a neutral chip beside the patient name. For a dispensing
practice this is the dispensing-patient flag at signing time: it says where
the script goes after signing ("Dispensary"), so the dispensing pile is
scannable at a glance. Routing information, not clinical risk — styled in
the accent tokens, never red/amber, and absent when Medicus records no
location. No new storage, no sort changes.

## [v3.156.2] — 2026-07-07

### Fix: Backup & Restore — "Export entire suite", "Import from file", and "Publish to shared folder" all failing

`shared/leaflets-utils.js` and `shared/io/leaflets-io.js` are both loaded as
classic `<script>` tags on the options page and so share one global scope.
Both declared top-level `const SLUG_RE` and `const RECENT_MAX` — the second
declaration threw `SyntaxError: Identifier 'SLUG_RE' has already been
declared`, which silently aborted all of `leaflets-io.js`. That left
`leafletsExport`/`leafletsImport` undefined. `require()` in
`test-leaflets-io.js` never caught it, since CommonJS gives each file its own
module scope.

This one root cause broke three separate-looking symptoms, because all three
go through the whole-suite export/import path rather than a single module:

- **"Publish to shared folder"** and **"Export entire suite"** — both call
  `doFullExport()`, which unconditionally includes `leafletsExport()` while
  building its `Promise.all` array. Referencing the undefined function threw
  immediately, aborting the whole export before any file was produced.
- **"Import from file"** (and "paste JSON") — both call `applyEnvelope()`,
  which includes a `leafletsImport` task whenever the backup has a `leaflets`
  section (true for any full-suite backup). `applyWithRollback` rolls back
  every task if any one throws, so the undefined function aborted and
  rolled back the entire import, not just the leaflets portion.
- Per-module (single-scope) export/import was unaffected, since those only
  call the one requested module's function.

- Renamed `leaflets-io.js`'s internal constants to `LEAFLETS_IO_SLUG_RE` /
  `LEAFLETS_IO_RECENT_MAX` so they can't collide with `leaflets-utils.js` (or
  anything else) loaded on the same page
- No behaviour change to the export/import contract; `test-leaflets-io.js`
  unaffected

## [v3.156.1] — 2026-07-07

### Fixed: Signing Queue "patient not resolvable" on every live task

First live run showed every row erroring at patient resolution: the module
constructed the overview path from the TASK-LIST slug
(`/tasks/data/prescription_request_task_routine/overview/{id}`), but live
Medicus serves the overview under a different slug than the list. Fix: the
task row's own `overviewURL` (validated with the same `_OVERVIEW_URL_RE` the
queue bridge uses — it is the pointer Medicus itself links and the queue
chips already fetch) is now the authoritative resolution path, with the
constructed path kept only as a fallback. Verified on a live-mimic fixture
where the constructed path fails and only the row's overviewURL succeeds.

## [v3.156.0] — 2026-07-07

### Signing Queue: renal context on every checked row (display-only)

The wishlist's "highest patient-safety value" renal join, delivered in the
conservative display-only slice that fits the intended-purpose statement:
before signing a renally-cleared repeat (DOAC, metformin, lithium…) the eye
asks "what's the kidney function, and how old is that number?" — the record
fetch already returns it, so every checked signing row now shows the
patient's **latest recorded eGFR verbatim with its age permanently attached**
("eGFR 38 mL/min/1.73m2 · 11mo ago").

- Value is NEVER rendered without its date/age (out-of-context guard, H-010);
  unparseable dates fall back to showing the raw recorded date.
- **Stale (> 12 months) or unparseable-age renal data gets amber salience**;
  "no eGFR on record" is remarked ONLY on rows already carrying a monitoring
  flag — a quiet row's missing eGFR would be noise on young healthy patients.
- No threshold, band, or dose logic is computed — verbatim recorded fact
  adjacency only. H-038 gains control (i) documenting this.
- Zero extra network cost: the eGFR comes from the investigation dashboard
  the monitoring pass already fetches per patient.

Pure logic (`renalContext`, `formatObsAge`) in signing-core.js with tests
(39 checks total in test-signing-core.js).

## [v3.155.0] — 2026-07-07

### New: Signing Queue — the repeat-prescription pile with monitoring context

The wishlist's top remaining GP minutes-saver (Tom's "safe to sign", 2026-07-03
appraisal §3b), built to fit the frozen intended-purpose statement: the module
DISPLAYS recorded monitoring next to each open request and deliberately never
renders a verdict — no "safe", no ticks, no green. Hazard log: **H-038**.

**What it does.** New Signing tab (panel + pop-out; in the GP role preset)
lists every open prescription-request task (routine by default; non-routine
toggleable — the endpoint's open-task view is exactly the outstanding pile),
resolves each to its patient via the task-overview endpoint
(`SentinelApiClient.resolveTaskToPatient` — the same panel-proven path
booking-api uses), runs the patient through the identical monitoring pipeline
Sweep uses (`fetchAll → normaliseAll → evaluatePatient`, drug rules +
practice org/custom overlays, sequential with 250ms pacing, 30-patient
batches with "Check next"), and shows the verdict chips on each request:

- **red** — any monitored drug overdue / stale / no data;
- **amber** — due soon;
- **"requested" tag** — the loudest signal: the flagged drug appears in the
  request text itself (a lithium request while the lithium level is overdue);
- rows sort riskiest-first, with **unknown above quiet**: a record that could
  not be read is an amber "check manually" row ranked above "no monitoring
  flags recorded" — an incomplete read can never masquerade as an all-clear;
- "no monitoring flags recorded" carries a permanent "≠ all clear" caveat and
  the header's fixed honest-state line; multiple requests from one patient
  share a single record fetch.

**Safety framing.** Read-only (no write path exists in the module);
authorisation happens only in Medicus. Nothing persisted — verdicts are
in-memory; the only storage is the type-toggle UI pref via shared ui-state.
New hazard H-038 (automation bias on this surface) with controls documented.

Files: `side-panel/modules/signing/{signing.js,signing-core.js,signing.css}`
(new), nav/registry entries in `panel.html`, `pop-out/pop-out.html`,
`panel.js`, `pop-out.js`, `tab-catalog.js` (+ GP preset), tab-help entry.
Tests: `test-signing-core.js` (30 checks: verdict reduction, requested-drug
matching, risk-band sorting, patient grouping, request age).

## [v3.154.3] — 2026-07-07

### Fixed: record sections empty on slow loads ("card not found: Observations & Results")

Reported via console warning on a live care-record page where the card list
showed 'Observations & Results' clearly present. Root cause is a one-shot
extraction race, not a Medicus rename: pageReady() passes as soon as the
patient banner or FIRST record card renders, extractAll() runs once, and
Medicus lazy-renders the lower cards afterwards — the route watcher's
250ms/1200ms reruns can both land too early on a slow load, leaving those
sections empty for the whole page visit.

New late-card settle-watch in `content-scripts/triage-lens/content.js`: when
an extraction pass reports expected-but-absent cards (`_missingCards`), the
lens polls cheaply (500ms) for up to 12s and re-extracts as soon as any of
them appears. Applies to record AND detail pages; self-terminates on deadline
or completion; disarmed on SPA route change. The once-per-load
"card not found" warning still fires if a card genuinely never renders.

## [v3.154.2] — 2026-07-07

### Fixed: health-strip false positive — patient-UUID fallback probe fired on patient-less pages

Root cause of the "Medicus may have changed — Patient UUID resolution" strip
found via live-DOM capture: the contract is only probed on pages whose URL
resolves no id, which includes patient-LESS screens like the appointment book
and dashboards. A diary grid has no patient links, so the probe FAILed there
and two spaced visits promoted to a 'degraded' banner while nothing was
broken. (The capture also confirmed the data-attribute strategy matches
nothing on current Medicus — the link strategies `/care-record/{uuid}` /
`/patient/{uuid}` still work and carry the feature.)

- **Applicability gate** (`anchorHrefRe` on the contract, honoured by
  `DomContracts.probeContract`): if no anchor href on the page carries a bare
  UUID, there is no patient-resolution evidence to test — the round reads
  `not_applicable`, never FAIL. UUID-bearing links that match neither shape
  still FAIL (genuine URL-shape drift stays detectable).
- **State epochs** (`stateEpoch` on the contract; `applyStateEpochs` /
  `stampStateEpochs` in contract-canary.js): stored verdicts issued under the
  old probe semantics are discarded on the next probe round, so the existing
  false-positive 'degraded' clears itself on the next Medicus visit — no
  manual dismiss needed.
- Tour: 'header-controls' step extended to lead with the v3.154.0
  quick-leaflet button and retagged (TOUR_VERSION 9 → 10) so returning users
  get a "What's new" pass showing where it lives — shipped and immediately
  missed by its own requester, so it earns the spotlight.

Tests: probe-gate semantics (patient-less page → not_applicable; UUID links +
selector miss → FAIL) and epoch discard/stamp covered in
test-dom-contracts.js / test-contract-canary.js.

## [v3.154.1] — 2026-07-07

### Suite-health strip: acknowledge/dismiss (7-day snooze per degradation set)

The amber "Medicus may have changed — … degraded" strip had no acknowledge
action, so a known, unchanged degradation nagged on every panel open. The
strip now carries a ✕ dismiss: hides that EXACT set of degraded contracts for
7 days, and reappears immediately if the degraded set changes (anything new
breaks, or a different contract degrades) — new problems always surface.
Options → Suite health keeps full detail regardless of the snooze. New
machine-local key `health.stripSnooze` (transient acknowledgement, not backed
up — a restored backup should re-surface the warning).

Context: the strip was correctly reporting a real Medicus change (the
patient-UUID DOM fallback probe degraded — the same change that takes out the
cross-tab monitoring badge on pages where URL detection can't resolve the
patient). The fix for the underlying selector drift needs a live-DOM capture
and ships separately; this release just makes the warning politely
acknowledgeable while it's known-about.

## [v3.154.0] — 2026-07-06

### New: Quick Leaflet popover — NHS leaflet search from any tab

Requested for mid-triage use: leaflets were needed while working the Slots
screen (and the queue, and Sentinel), and switching to the Leaflets tab loses
the module you're in. Rather than embed leaflets into Slots specifically, the
panel header gains a leaflet button (open-book icon, next to the command
palette) that opens a compact popover on top of whatever tab is active:

- Fuzzy search over the bundled NHS A–Z index (same tier-1 engine as the
  Leaflets tab, via `shared/leaflets-utils.js`) with keyboard-first flow —
  type, ↑/↓, Enter opens the leaflet on nhs.uk in a new tab; per-row
  copy-link; a guaranteed "Search nhs.uk for …" fallback row covers index
  misses; recents shown when the query is empty.
- Shares the Leaflets tab's `leaflets.recent` list (both surfaces stay in
  sync) and hands the current query into the full tab via the existing
  `leaflets.pendingQuery` mechanism ("Open Leaflets tab →" in the footer).
  Tier-1 only — no API key use, no in-panel rendering, no new storage keys.
- Also reachable from the command palette ("NHS leaflet quick search…").
- Panel-only by the same convention as the global strips; the pop-out window
  reaches the full Leaflets tab from its own nav.

Files: `side-panel/quick-leaflet/quick-leaflet.js` (new), `panel.html`
(header button + host), `panel.css` (`.ql-*` styles), `panel.js` (init),
`palette/palette.js` (command).

## [v3.153.0] — 2026-07-06

### Fixed: Submissions "work received" counts no longer erode as the team completes work (day ledger)

Root cause of the v3.152.1 report, confirmed by live-API probe (2026-07-06):
the `/tasks/data/{type}/task-list` endpoint **only ever contains open tasks**.
Its status filter offers `New / Awaiting recipient response / Reply received /
Snoozed` — there is **no completed state**; completed requests leave the table
entirely (a probe of the previous Monday returned 2 residual tasks). So a
`createdAt`-filtered count is "received AND still open", and the number falls
as the team clears work. The Submissions Tracker, Today demand card, panel
demand strip and Condor demand/velocity/PPI have therefore all systematically
**undercounted received work since inception** — worst on busy mornings, when
27 could show against a true intake 3–4× higher. A demand undercount reads as
"quiet day" and misinforms capacity decisions.

The API cannot return completed tasks, so the suite now **remembers** them:

- **New received-work day ledger** (`submissions.ledger`,
  `side-panel/modules/submissions/submissions-ledger.js`, pure logic in
  `submissions-core.js`). Every poller that already hits the endpoint
  (Submissions module, Today demand card, panel `#subRagStrip`, Condor — each
  every 60s while visible) merges the task IDs it sees into per-day, per-
  category entries. Once seen, a task stays counted after completion.
- **PHI/data-minimisation**: the ledger stores task UUIDs + creation hour for
  the current day only; past days are compacted to bare counts + a 24-bucket
  hourly histogram at the first poll of the next day. No patient identifiers,
  92-day retention. Backed up via `shared/io/submissions-io.js` (with
  structural sanitisation on import) so demand history survives reinstalls.
- **All four consumers now count from the ledger** (falling back to the live
  open-only count if storage fails): Submissions tiles/charts in all three
  modes, Today demand card, demand-strip RAG thresholds, Condor
  demand/velocity/PPI. RAG thresholds in particular no longer un-trip
  mid-morning because the team is clearing the queue while intake keeps
  climbing.
- **Honest history**: days the suite wasn't live-watching can only show
  residual open tasks. The Submissions module now flags such days in the
  amber data-health notice instead of presenting undercounts as history —
  received counts build up from the day the suite starts watching.
- Known limitation (documented, unfixable client-side): work received and
  completed while the panel was closed (e.g. before first open of the day) is
  invisible to the ledger and still undercounts that window.

## [v3.152.1] — 2026-07-06

### Fixed/hardened: Submissions & Today demand counts against silent task-list API changes

Reported: Submissions Tracker (and the Today demand card, which shares the
endpoint) showing implausibly low "work received" counts on a Monday morning,
with the same numbers regardless of date — alongside a health-strip warning
that Medicus may have changed.

The `/tasks/data/{type}/task-list` endpoint **silently ignores query params it
doesn't recognise** (the v3.35.2 postmortem: `startDate` vs
`createdAt_startDate` returned the whole backlog). If Medicus renames the
`createdAt_*` filters, the failure inverts and every consumer quietly counts
the *default open-task view* — the outstanding queue, not work received.
Completed work vanishes from the count, every date shows the same numbers, and
nothing errors. Previously that showed as confidently wrong tiles; a demand
undercount reads as "quiet Monday" and misinforms capacity decisions.

New `windowTaskList` / `extractTaskArray` / `taskDateISO` in
`submissions-core.js` (pure, tested), now used by **all four same-day
consumers** — Submissions module, Today demand card, panel `#subRagStrip`,
Condor demand/velocity/PPI:

- **Detects an ignored date filter**: tasks created clearly outside the
  requested window (±1-day tolerance absorbs UTC/BST boundary skew — no false
  alarms on midnight tasks) trip a `filterIgnored` flag; counts are then
  re-windowed client-side to the requested dates so they stay honest.
- **Surfaces it, never hides it**: the Submissions module shows an amber
  data-health notice ("Counts unreliable — Medicus ignored the date filter…
  likely an undercount, completed items may be missing"); the Today demand
  card shows an inline warning. Healthy responses pass through untouched.
- **Detects truncation**: a body carrying `totalCount`/`total`/`meta.total`
  larger than the returned array (pagination introduced upstream) flags
  "partial page — counts may be low".
- **Tolerates envelope renames**: task arrays are now extracted from
  `tasks | data | results | rows | bare array` (same shape list page-world.js
  already tolerates) instead of only `d.tasks` — a renamed envelope becomes a
  flagged count, not a silent zero.
- Panel `#subRagStrip` also now uses the **local** calendar date instead of
  `toISOString()` (which queried yesterday during the first BST hour — same
  fix condor got in v3.35.2).
- The Condor report's ranged demand fetch already windows client-side via
  `bucketDemandByDay` and needed no change.

Note: when the filter is being ignored upstream, client-side windowing cannot
recover work the API no longer returns (completed tasks). The warning is the
point — the follow-up fix needs the new filter param names captured from a live
Medicus page (Debug → API diagnostics, or a page-console capture).

Tests: `test-submissions-core.js` extended to cover envelope tolerance, date
parsing, boundary tolerance, ignored-filter re-windowing and truncation
detection.

## [v3.152.0] — 2026-07-03

### Practice-panel wishlist wave 1 (quick wins + half-day items)

First build wave from the whole-suite feature-wishlist appraisal
(`docs/appraisal/PRACTICE-wishlist-whole-suite-2026-07-03.md`).

**Sweep / Today**
- QOF points-at-risk patient rows now show each indicator's name next to its
  code ("DM037 — …"), not bare codes.
- Skipped appointment entries (no patient UUID) are now *named*: a collapsible
  amber list shows time · clinician · raw name for every entry the sweep could
  not check, with an explicit "never checked, not an all-clear" caveat. New
  `sweep.lastRun.skippedEntries` field (PHI-bearing, same 2h TTL, never backed
  up); `missingUuidCount` kept for back-compat.
- Today's Morning Sweep card adds a plain-English line: "N of M booked
  patients have checks due — open the sweep for names" (neutral zero state;
  not-run state untouched — never implies all-clear).

**Monitoring visibility from any tab**
- The open patient's red/amber monitoring count now shows on the header strip's
  "Monitoring →" button (amber, red if any red chip), falling back to a badge
  on the Monitoring nav tab when the waiting-room strip is hidden. Panel-only;
  reuses the content script's already-computed chips via `getSentinelSnapshot`
  (no rules-engine run in the panel). Unavailable snapshot renders as no badge,
  never as 0 or an implied all-clear.

**Referrals**
- 2WW safety-net rows no longer truncate patient names (name wraps on its own
  line; service/clinician move to a sub-line) and the card carries a threshold
  legend ("watch ≥ 14d · overdue ≥ 21d", values from the API, not hardcoded).

**Reception → Leaflets**
- Each pathway tile gains a "Leaflet →" link that jumps to the Leaflets tab
  with the matching NHS A–Z search pre-run (one-shot `leaflets.pendingQuery`
  handoff key; transient, never exported).

**Knowledge**
- Reserved "Locum brief" pinned category: sorts first after "All", styled
  distinctly, with an empty-state hint and a suggested option in the Add form
  — the locum's day-one who's-who/escalation card, practice-authored.

**Setup / help**
- Triage-monitor setup step now uses the canonical "Team / assignee UUID"
  wording and explains where to find it in plain English.
- Tab help + tour now surface four features users kept asking for because they
  couldn't find them: Sentinel auto-follow, the clickable "N unmatched" audit
  count, and the Practice Pressure cog (weightings/thresholds). TOUR_VERSION
  8 → 9 so returning users get the "What's new" pass.

## [v3.151.0] — 2026-07-02

### Triage Lens — Workload off the GP (Phase 4)

Phase 4 of `docs/plans/TRIAGE-LENS-2026-07-02.md`: turning the evidence and
honesty of the earlier phases into consultations that never reach the GP. The
clinical items (pathway matching, green routine rules) were CSO-reviewed —
`docs/plans/TRIAGE-LENS-PHASE4-REVIEW.md`.

**Queue workflow (client-side):**
- **Keyboard triage** — j/k (or arrows) move a cursor through the results
  queue, Enter opens the cursor row, n jumps to the next red/amber. Ignores
  keys while typing. Pref `queueKeyboardNav` (default on).
- **Seen-dimming** (opt-in, default off) — rows whose task was opened this
  session dim so unworked rows stand out. Visual-only, session-local,
  suppresses nothing: it **never dims a red/amber row** (gate reads the result
  cache, so it holds even with row-tint off) and auto-undims the moment a row
  re-grades to an alert. Hazard log H-037.
- **"All-normal, fileable" marker** — a green ✓ on rows whose report is
  confidently all-normal with no filing blockers, so the GP works reds first
  and batches the easy filings. Reuses the lab-file gate; fail-closed; marks
  nothing it can't confirm, and files nothing itself.

**Request-queue decision support (CSO-reviewed):**
- **Pharmacy First divert chip** — a request matching a Pharmacy First pathway
  (from the CSO-signed `reception-pathways.json`) shows a green chip when the
  patient is age-eligible (fails closed on unknown age). Clicking offers a
  prepare-only redirect draft — copy-to-clipboard, never auto-sent.
- **Missing-info ask-back** — for a matched pathway, the chip menu lists the
  red-flag questions the request hasn't answered and a prepare-only ask-back
  draft; a red flag the patient *volunteered* (999/duty) surfaces as a
  prominent escalation note. Decision support only — offers info and drafts,
  never triages or auto-advises.
- **Green routine rules** — requests that are confidently non-clinical
  (practice-admin details, pharmacy/prescription process queries) now show a
  green chip so the safe tail can be swept in one pass. Green ranks *below*
  red/amber/info, so a symptom co-occurring with an admin phrase always keeps
  its clinical chip on top — green can never mask a signal. defaults config
  23→24.
- **`engine/reception-match.js`** — new pure matching engine (Pharmacy First
  eligibility, red-flag gap detection) over the pathways file, fail-closed on
  unknown age, conservative gap detection (over-asks rather than assumes).

**Deferred** (in the review doc): repeat-contact (the queue payload carries no
patient identifier — awaiting a decision on the name+DOB fallback); the
photo-missing prompt (no attachment field is visible in the data the extension
reads — needs live-Medicus discovery); and the Phase 3 FIB-4 age-split /
Hb-K⁺ delta follow-ups.

## [v3.150.0] — 2026-07-02

### Triage Lens — Smarter grading (Phase 3)

Phase 3 of `docs/plans/TRIAGE-LENS-2026-07-02.md`: the first phase to change
what fires red and amber. Every new/changed shipped threshold was independently
verified against a named UK source and **CSO-signed-off** before release — see
`docs/plans/TRIAGE-LENS-PHASE3-REVIEW.md`.

**Engine capabilities** (grading was byte-identical until this release shipped
content that uses them):

- **Unit-mismatch guard** — a result rule no longer grades a value reported in a
  unit incompatible with the rule's own (`unitsCompatible()` normalises µ/u,
  superscript and cell-count notations, `micrograms/L`↔`µg/L`). On a genuine
  mismatch the rule is skipped and surfaced as a grey "unit?" chip with a
  plain-language popover line; absent units stay fail-open (Medicus often omits
  them). IU vs U kept distinct.
- **Text rules can reach red** — optional `abnormalLevel:'red'` lets a designated
  positive text finding escalate past the historic amber cap (escalate-only).
- **Unclassified-positive safety net** — an unmatched non-numeric positive result
  ("Positive"/"Detected"/…) no longer scores nothing; it surfaces an amber "?"
  chip. Heavily negation-guarded (incl. a `non-reactive` glued-prefix guard),
  amber-max, and only when no rule already classified the result.
- **Negation / past-reference demotion** — request-queue chips visually demote
  (never suppress) when the trigger phrase is negated ("no chest pain") or
  historic ("UTI last year"): outline style, "(negated?)"/"(past?)" suffix,
  ranked below undemoted matches.
- **Patient-context gates** — result rules accept `context:{minAge,maxAge,sex}`;
  request rules accept `require:{ageMin,ageMax,sex,medsAny,problemsAny}`. Both
  AND-gate and **fail closed** — a gate whose data isn't available on the current
  surface simply doesn't fire, never suppressing a base match.
- **Delta / trend rule kind** — `kind:'delta'` grades on change over time
  (direction, absolute or percent, unit-guarded, optional `maxDays`), rendered
  with the change summary in the chip popover.

**New shipped result-rule coverage** (config version 21→23; each cited to a UK
source, thresholds in the review doc):

- Hypernatraemia (Na high, amber ≥150 / red ≥160), absolute creatinine/AKI
  (red ≥354 µmol/L, KDIGO stage 3) plus a creatinine-rise delta (≥26.5 µmol/L in
  48h, KDIGO stage 1), glucose (high ≥11.1 / ≥30; low ≤4.0 / ≤3.0), ALT & AST
  transaminitis (≥120 / ≥320 U/L), CRP (≥20 / ≥100, NICE CG191), WCC high (≥12),
  and a **potassium 6.0–6.4 amber band** below the existing red ≥6.5 (UK Kidney
  Association).
- **HbA1c ≥48 demoted red → amber** — 48 is the diagnostic threshold, not an
  acute-danger value; demotion cuts red alert-fatigue (with a `RETIRED_*`
  un-stick so it reaches existing installs). New diabetes still flags, at amber.

**Held back after clinical review** (in the review doc, pursued as follow-up):
the FIB-4 age-adjustment was reverted to status quo (the drafted ≥65 cutoff used
a hepatitis-C value and the correct age-adjustment needs an engine change the
escalate-only model can't do yet); the neutrophil-high rule was dropped (a
lab-range boundary, not a validated action threshold); and Hb-fall / K⁺-rise
delta rules await a defensible sourced magnitude.

## [v3.149.0] — 2026-07-02

### Triage Lens — Evidence at the chip (Phase 2)

Phase 2 of `docs/plans/TRIAGE-LENS-2026-07-02.md`: every chip can now explain
itself and carry its next step — all client-side, on data already fetched, with
no change to clinical grading.

- **Request chips show their evidence.** Clicking a queue rule chip opens a
  menu showing the exact sentence from the patient's request that triggered
  the rule (matched term highlighted) plus the rule's attached actions —
  guidance links, copy-ready snippets, notes — via the scheme-guarded action
  executor. When several rules match one request, chips rank red < amber <
  info and collapse to the top chip + "+N" (the overflow menu lists all
  matched rules, each with its own evidence and actions). Evidence is built
  with `textContent` only — request text is never rendered as HTML, and
  Medicus's own DOM is never mutated for highlighting. New matcher API
  `ruleMatchEvidence()` is built on the same compiled patterns as the boolean
  matcher and parity-swept across the full 78-rule corpus.
- **Result chips answer "how bad?" in place.** Red/amber chips gain a trend
  arrow (↑/↓) when a prior value exists in the report's own history —
  suppressed on any unit mismatch, never a cross-unit comparison. Clicking a
  chip opens a detail popover: value, unit, reference range, lab flag, sample
  date, which rule fired (with its threshold, e.g. "red ≥6.5"), and the prior
  value with date. The grey "couldn't check" chip explains itself and notes
  the automatic retry. Engine change is purely additive attribution
  (`flagged`, `ruleId`, `extractPrior`) — grading behaviour byte-identical,
  all pre-existing severity tests unchanged.
- **The verdict follows you into the task.** Opening a task from the queue
  shows a slim severity-edged banner echoing the evaluation ("2 abnormal:
  K⁺ 6.2 ↑ · eGFR 38 ↓ — rule: …") from cache with zero extra fetches;
  directly-opened tasks compute once via the queue's own path. The banner is
  keyed to the task ID (a slow fetch can never paint the wrong patient's
  verdict), shows an honest grey variant when the check failed, and stays
  silent on non-result tasks. Pref `detailVerdictBanner` (default on).
- **Result rules can carry guidance actions.** The same link/snippet/note
  actions request rules have — validated (http/https only), editable in the
  result-rule editor (shared action-editor component), documented in the LLM
  authoring prompt, and rendered in the chip popover for the rule that fired.
  Actions resolve from live config at render time, so edits apply instantly.
  No shipped rule gains actions in this release (user-authored only).

## [v3.148.0] — 2026-07-02

### Triage Lens — Trust: the screen never lies (Phase 1)

Phase 1 of `docs/plans/TRIAGE-LENS-2026-07-02.md`: the queue and HUD now
distinguish "assessed and clear" from "not assessed" everywhere, alert rows are
visible at a glance, and every machine-initiated write leaves an audit trail.

- **"Not assessed" never looks like "normal".** The HUD headline says **"Not
  fully assessed"** (never "No flags") when a clinical card could not be read,
  with a grey footer naming the missing cards, and a tile whose entire source
  is unreadable renders a grey not-assessed state instead of implying clear.
  Card lookup itself is hardened (count-suffix and whitespace/case tolerant,
  ambiguity-safe) and warns once per page load when an expected card is
  missing. On the results queue, a row whose check **failed** now shows a grey
  outline "?" chip and is retried within a minute — previously indistinguishable
  from an unassessed or normal row. The monitoring-due chip is now conservative:
  a transient fetch/evaluation failure preserves the last known chip instead of
  clearing it (only a successful evaluation can clear), while patient/page
  changes still reset it so a chip can never leak across patients.
- **Live triage status bar** replaces the passive queue legend: live counts
  ("3 red · 7 amber · 22 clear · 2 ? · checking 8…"), a **jump-to-next-red**
  button (amber fallback) that scrolls and flashes the row, and a
  **Focus alerts** toggle that dims non-alert rows (never hides them). "Clear"
  counts only results that were actually assessed; tasks with no gradeable
  report are not claimed as clear. Pref-gated (`queueStatusBar`, default on).
- **Severity row tint**: alert rows carry a 2–3px red/amber left-edge tint
  (master and preview rows), wiped and re-derived in the same cycle as the
  chips so a recycled grid row can never wear a previous patient's colour.
  Pref-gated (`queueRowTint`, default on).
- **Machine writes are audited and surfaced.** OIR auto-ticks now write
  `kind:'auto'` entries to the existing audit log and show a toast listing
  exactly what was ticked, with a **Review** action (scroll + flash — labelled
  honestly: ticking writes to Medicus immediately and cannot be reversed from
  the toast) recorded as `kind:'auto-review'`; a new `oirAutoTick` pref
  (default on) can disable auto-ticking entirely. The routine-prescriptions
  button now records every outcome (committed / highlighted / aborted,
  including the previously-untracked `auto` mode) in a machine-local ring
  buffer mirrored to the Clinical Event Ledger. Audit logs stay machine-local
  by design (excluded from backups, matching the lab-filing precedent). Hazard
  log: new **H-036** (auto-tick wrong-match hazard), H-035 updated.
- **Fixed in passing:** meta chips (`Under-prioritised`, `Unmatched patient`)
  rendered filled instead of outline on the live page — the `.ch-chip-meta`
  rule existed only in the stale PiP CSS copy, now restored to `hud.css`.

## [v3.147.1] — 2026-07-02

### Triage Lens — Phase 0 hardening (guardrails before the improvement plan)

Groundwork from `docs/plans/TRIAGE-LENS-2026-07-02.md` (Phase 0): the tests and
one-line safety fixes that protect every later phase. No user-visible feature
change beyond one false-alert fix; the value is regression insurance on the
suite's most-regressed surface.

- **Blood-culture chip no longer false-ambers negative reports.** Bare
  substrings `gram positive` / `gram negative` / `candida` in the
  `base-blood-culture` result rule tripped a "needs review" amber on explicitly
  *negative* reports ("No gram negative organisms isolated", "Candida species
  not isolated"). Replaced with morphology-qualified gram-stain terms
  (`gram negative bacilli`, `gram-positive cocci`, …) and named candida species
  + `candidaemia`, which keep detecting genuine positives — including interim
  gram-film-only reports — without colliding with negation phrasing.
  `defaults.json` config version 20 → 21. The migration un-stick
  (`revertRetiredResultRuleFields`) was extended to deep-compare **array**
  fields (it previously handled only scalar labels/thresholds), so existing
  installs whose stored rule still matches the old shipped array pick up the fix
  while practice-customised rules are left untouched — mirrored in
  `content.js` + `options.js` per the lock-step convention. Phrasing set flagged
  for Keeper source-review in the Phase 3 calibration pass.
- **Action URLs are scheme-checked.** `executeAction` in
  `content-scripts/triage-lens/content.js` now permits only `http:` / `https:`
  before `window.open`; a `javascript:` / `data:` URL from an imported or edited
  config is rejected and logged, not executed. The same allowlist is enforced in
  `options.js` at rule-edit / LLM-import time (defence in depth).
- **Backup imports are validated before they persist.** The file-import and
  raw-JSON save paths in `options.js` previously accepted anything with a
  `rules` array. They now run every rule through `validateTriageRule` /
  `validateResultRule`, shape-check `thresholds` / `prefs` / `systemChips`, and
  normalise `version` — rejecting the whole import (naming the first offender)
  rather than half-persisting a malformed or hostile config.
- **New regression tests.** A live-grid injection smoke harness
  (`test-queue-injection-smoke.js`, 57 checks) drives the real chip injectors
  through prepend / de-dupe / SPA-churn-survival / durable-map keying — closing
  the "needs a live-grid smoke test" gap the changelog has flagged repeatedly.
  `test-triage-alert-engine.js` (45 checks) covers the previously untested
  `triage-alert-engine.evaluate()`; `test-routine-rx-macro.js` (49 checks) gives
  the routine-Rx macro the behavioural coverage lab-file already had;
  `test-triage-import-validation.js` (68 checks) guards the new import/URL
  validation. `test-triage-rule-patterns.js` now imports the real
  `rule-match.js` instead of a re-implementation (no drift was found).
- **Internal:** the analyte match/exclude/specimen matcher, previously copied
  three times inside `engine/result-severity.js`, is now one shared
  `analyteMatches` helper with direct unit tests (`test-analyte-match.js`) —
  behaviour verified identical before unifying.
## [v3.147.1] — 2026-07-02

### Suite health — fix two false "degraded" alarms on the health strip

The `#healthStrip` amber banner could read "Queue chips — master/detail row
linkage (findQueuePreviewRow) degraded" and "Patient UUID resolution … DOM
fallback degraded" while the queue chips were visibly rendering fine — a
DOM-contract canary false alarm, not a real break.

- **`queue.preview-row-link`**: the canary tested only whether AG-Grid's
  master/detail preview row was present, not whether chips actually landed.
  `queueChipHost()`'s own further fallback (the `patientName` cell) is
  covered by the separate `queue.chip-host` contract — when that contract
  reads OK, the narrower preview-row contract is now treated as OK too
  (`dom-contracts.js`'s new `suppressedByOk` field, applied in
  `contract-canary.js`'s `runProbeRound`), instead of alarming on a
  transient/legitimately-absent preview row that a working fallback already
  covers.
- **`api-client.patient-uuid-dom-fallback`**: probed on every page
  (`pageMatch: null`) even though the DOM fallback it backs is only ever
  consulted when URL-based patient/encounter/task-id resolution
  (`detectMedicusContext`) fails — on a queue/task-list page (a genuinely
  multi-patient screen) it FAILed constantly for a fallback that was never
  going to run. `runProbeRound` now skips this contract for any round where
  the URL already resolved an id.
- Both fixes are hysteresis-neutral: an already-degraded contract now
  auto-recovers the moment its covering signal reads OK, same as any other
  recovery.

## [v3.147.0] — 2026-07-02

### NHS Patient Leaflets — a new tab, not a Google search

Dave: "I end up sticking it in Google — NHS wart — and it feels disjointed."
A new side-panel tab puts the right NHS patient leaflet one search away,
without ever sending patient data anywhere. Plan:
`docs/plans/NHS-LEAFLETS-2026-07-02.md`.

- **Tier 1 — bundled A-Z, works with zero configuration.** A curated index
  of 221 entries (166 conditions + 55 medicines) ships in
  `rules/nhs-az-index.json`, matched by fuzzy search with alias and
  typo-tolerant prefix matching. Every search also offers a guaranteed
  "Search nhs.uk for '\<term\>'" fallback row, so the tab never dead-ends on
  an index miss. Results **open in a new tab** (a normal user-initiated
  navigation, not an extension fetch) or **copy a link** for the
  patient-SMS workflow; a Recent list keeps the last 10 for quick reuse.
  This tier contacts no new endpoint at all.
- **Tier 2 — optional in-panel rendering via the NHS Website Content API.**
  Options-gated: a subscription key, entered in Options → Leaflets, lets a
  search result render the leaflet text right in the panel — headings and
  paragraphs built from text nodes only (no `innerHTML` of remote content),
  with a visible "From the NHS website" attribution link back to the
  source page. Responses are cached for 24h to respect syndication
  freshness terms and avoid re-fetching on every click. Any fetch failure
  (401/403/429/network/unexpected shape) fails calmly back to tier-1
  open-in-tab behaviour with a one-line notice — the module is
  indistinguishable from tier-1-only when no key is set. The API key is
  deliberately excluded from suite backups (secrets stay machine-local);
  everything else (recent list, enabled flag) travels normally.
- **`scripts/verify-nhs-index.js`** HEAD-checks every bundled slug against
  the live site from a machine with normal egress (this sandbox couldn't
  reach nhs.uk to verify the seed index directly) and reports failures —
  documented in `rules/`.
- **Honest disclosure.** README and `docs/DPIA.md` now say plainly that
  `api.github.com` is no longer the *only* external endpoint the extension
  can contact: with a key configured, selecting a search result sends
  `api.nhs.uk` the condition or medicine term the user selected — never
  patient data. Without a key, nothing changes.
- **Event Ledger.** Every leaflet open is recorded (source `leaflets`,
  action `opened`, label = slug, `patientRef` always null) — evidence of
  what was opened, never who for.
- New module: `side-panel/modules/leaflets/`; backup wiring
  (`shared/io/leaflets-io.js`, `VALID_SCOPES`, `doFullExport`/
  `applyEnvelope`/`previewEnvelope`, Options export card); tab help in
  `shared/tab-help.js`; tour step (`TOUR_VERSION` 7 → 8).

## [v3.146.0] — 2026-07-02

### Unbreakable — the suite knows when Medicus changes

Three of the last six mainline fixes (v3.143.1 OIR checkboxes, v3.143.2
assignee picker) were regressions caused by Medicus silently changing
frontend components, discovered by a clinician in clinic — for a safety
tool that means periods where features silently didn't fire and nobody
knew. This release makes the next one self-announcing. Landed as two
batches (`8a5a06f`, `230fc1d`); plan: `docs/plans/HORIZON1-UNBREAKABLE-2026-07-02.md`.

- **DOM-contract registry (`shared/dom-contracts.js`).** All 14 Medicus
  selector contracts the suite depends on, declared once with
  anchor/target/legacy-fallback semantics. Consumers outside content.js
  (routine-rx button, lab-file button, booking/task inline widgets,
  api-client's UUID fallback) now read their selectors FROM the registry
  instead of hard-coding them. `content-scripts/triage-lens/content.js`
  is untouched (tests pin its exact content) — its own contracts (OIR
  checkboxes, queue-chip hosts) are mirrored in the registry, and a
  grep-based sync test fails CI if a future content.js selector change
  drifts from the mirror.
- **Recorded-fixture tests.** 21 sanitised fixtures covering current
  `m-*` and legacy `q-*` Medicus markup variants, synthesised from the
  selector expectations the code demonstrably handles today (fixtures
  carry provenance headers saying so, not real patient DOM). A 310-check
  contract test verifies every contract against its fixtures (anchor
  match, target match, legacy fallback, and FAIL/NOT_APPLICABLE probe
  semantics never false-alarming), plus a 31-check sync test for the
  content.js mirror. `scripts/capture-fixture.js` is a paste-into-the-
  Medicus-console helper that captures and PHI-sanitises real DOM
  subtrees, to replace synthesised fixtures with real ones over time.
- **Runtime canaries (`shared/contract-canary.js`).** Probes the 7 of 14
  contracts that are safe to check at runtime (the rest are fixture-only,
  with documented reasons) via the existing DOM-observer hub — no new
  MutationObservers — debounced ≥5s, counts/booleans only, never text
  content. Two-strike hysteresis (≥2 FAILs at least 30s apart) so SPA
  churn can't false-alarm; a single OK recovers the contract.
- **Suite health surfaces.** An amber `#healthStrip` in the side panel
  (panel-only, following the existing wr/rm/subRag strip convention)
  appears only when a contract is degraded, pointing to Options. Options
  gains a "Suite health" table of all 14 contracts — status, plain-English
  "what degrades", and why fixture-only contracts aren't probed live.
  ok↔degraded transitions are logged to the Clinical Event Ledger (source
  `health`, deduped per contract per day). `health.contracts` is
  machine-local and excluded from suite backups.

No new tour steps — the health strip is exceptional-state UI (only visible
when something is degraded) and the Suite-health card lives in Options,
out of tour scope. `TOUR_VERSION` stays at 7.

## [v3.145.0] — 2026-07-01

### Class-leader features — Prescribing Pre-flight, Clinical Event Ledger, Practice Pulse

Three features chosen for best-of-type differentiation
(`docs/plans/CLASS-LEADERS-2026-07-01.md`), landed as three batches (`fab7081`,
`158e30a`, `3395739`). Read-only against the clinical record throughout — no new
record writes.

- **Prescribing Pre-flight (Record tab).** A collapsible "Pre-flight" section lets you
  type a drug you're considering and see, before it exists in the record: the ACB
  delta and any band change, STOPP/START prompts newly triggered by the addition (not
  ones already true of the current regimen), interactions against current meds, and
  required monitoring — distinguishing a baseline already satisfied by a recent result
  from one that's missing. The full alert library (interaction/awareness rules,
  PINCER combos, etc.) is treated as always-on background knowledge for this what-if
  check, not just the rules a clinician has opted into live — a deliberate design
  decision, documented in `engine/preflight.js`. An unknown drug is reported as
  unknown, never implied safe. Every result carries the caveat "Decision aid, not
  advice — confirm against the BNF and the full record." New pure module
  `engine/preflight.js` composes the existing ACB, STOPP/START and drug-monitoring/
  combo engines — no new drug term lists or interaction pairs were added. Also fixes a
  real latent bug: `alert-library.json`'s library rules carried no `id` of their own,
  so de-duplication (used to tell "already firing on current meds" apart from "newly
  introduced by the proposed drug") collided on `ruleId undefined` and silently
  dropped interaction alerts; rules are now stamped with their library `libId` as
  `id`. Tests: `test-preflight.js`.
- **Clinical Event Ledger.** A machine-local, capped record (5000 events, 90-day
  retention, pruned on every append) of what the suite displayed or did — answering
  "did the tool flag this?" with evidence instead of a shrug. Instruments: Sentinel
  red/amber chips shown (deduped per patient+rule+day so it's evidence, not noise) and
  dismissals; Sweep run summaries and each "Create recall task"; Record "Copy patient
  summary" and Pre-flight runs; Lab Filing filings mirrored alongside the existing
  audit log (mirror, not migrate — the lab-filing log itself is untouched). Writes are
  fire-and-forget and never break the calling surface on a throwing storage layer.
  Patient references are the Medicus UUID only — never a name — and shape-validated at
  write time (`sanitisePatientRef`), rejecting anything that doesn't look like a
  UUID/hex identifier. Options → Event Ledger adds a card with patient-UUID and
  date-range filters, CSV export (RFC-4180 quoting plus a spreadsheet
  formula-injection guard), a typed-CLEAR confirmation to wipe the ledger, and a
  plain-English disclosure of what it is and isn't (not a clinical record; absence of
  an event is not evidence nothing was shown). Deliberately **excluded from suite
  backup**, same doctrine as the lab-filing audit log — restoring an event ledger onto
  another machine would fabricate a misleading "what was shown here" record. New
  `shared/event-ledger.js`. Tests: `test-event-ledger.js`.
- **Practice Pulse (Condor).** Condor's daily snapshots become week-on-week
  operational intelligence. A new Pulse card shows trend rows — pressure index,
  demand, slots free, waiting room, urgent tasks, task age — over 7d/30d with inline
  sparklines and a "based on N of 30 possible snapshots" coverage line; gaps (days the
  extension wasn't open) are disclosed, never interpolated. Historical pressure-index
  values are shown exactly as recorded on the day, not recomputed under today's custom
  weightings — restating history under current settings could silently disagree with
  what a partner actually saw at the time. The Practice Report's Trends section is
  rebuilt on the same pure core (`pulse-core.js`) with a prior-period comparison per
  audience profile, so the panel and the printed report can never quietly diverge.
  Verified-already-fixed rather than newly fixed: live Condor's capacity figures
  already honoured the `slots.hiddenTypes` filter, and the Practice Report already
  used the same filter — both now covered by a regression test
  (`test-pulse-core.js`) rather than left to silently drift back apart. The snapshot
  store (`practice.reportSnapshots`) was already capped at 90 days
  (`pruneSnapshots`/`SNAPSHOT_KEEP_DAYS`) — verified, not newly capped — and is now
  regression-tested too. Tests: `test-pulse-core.js`.
- Reference: `docs/plans/CLASS-LEADERS-2026-07-01.md`.

Tour: one new step — Record Pre-flight (`#recPreflight`), `TOUR_VERSION` bumped 6 → 7.
Condor Pulse and Options → Event Ledger were deliberately not added as dedicated
steps: the tour's 20-step sanity cap was reached, Condor stays taught by the existing
nav-tabs overview step (as before), and the guided tour only covers the side panel,
not the Options page. All existing anchor selectors re-verified against current
markup (`test-tour-steps.js`). `defaults.json` (both copies) intentionally
untouched — no migration-propagated content changed this release.

## [v3.144.0] — 2026-07-01

### Top-10 user-value set — answer-first Today, discoverability, coverage transparency, filters and tunables

Ten improvements drawn from the practice-panel appraisals and the Dave-council roadmap
(`docs/plans/TOP10-USER-VALUE-2026-07-01.md`), landed as three batches
(`b2d9c81`, `d05ec6a`, `c75b304`). Read-only throughout — no new clinical-record writes.

- **Today: "what needs you now" headline.** A plain-English sentence at the top of
  Today, rolled up from data the module already polls — red states lead, amber next,
  and a quiet "nothing needs you right now" state carries a "last checked HH:MM"
  provenance line when all clear. Pure builder (`today-headline.js`) with a 55-case
  test. Also fixed a bug in `triageClause` where it read wall-clock `Date.now()`
  instead of the threaded `now` parameter, which could misjudge triage age against
  the caller's reference time.
- **Per-tab "?" help.** The two copies of `TAB_HELP` that had drifted apart between
  `panel.js` and `pop-out.js` are now one shared source, `shared/tab-help.js`; missing
  entries for Submissions, Visualiser and About were added. A coverage test fails CI
  if a new tab ships without help copy.
- **Trends: self-describing resting state.** The empty/no-patient state now explains
  its own purpose, shows an inline SVG worked example, and states the first step
  ("open a patient in Medicus, then pick a metric") instead of showing a blank chart.
- **Sentinel: rule-coverage drill-down.** The rule-currency footer line is now a
  toggle that expands into every drug-monitoring rule (with its matched terms) and
  every QOF indicator covered — read-only, renders without a patient loaded so it can
  be checked ahead of a clinic. Rule/indicator counts are test-locked against
  `rules/drug-rules.json` and `rules/qof-rules.json`. (The "N meds checked · M matched
  · K overdue · P unmatched" audit headline was already shipped in the v3.138.0-era
  work — verified present, not rebuilt.)
- **Record: "Copy patient summary".** Verified pre-existing with its own tests
  (`test-record-summary.js`); not rebuilt.
- **Command palette: patient-scoped actions.** A new "Patient" command group — copy
  patient summary (via the Record tab's single formatter path), open visualiser, jump
  to Record/Trends/Sentinel — appears only when patient context exists, hidden
  otherwise.
- **Referrals: search and clinician filter.** Patient-name search plus a clinician
  dropdown, AND-combined with the existing priority/status chips, filtering the list,
  chart and the 2WW safety-net worklist together. CSV export respects the active
  filters and discloses them; CSV-injection hardened so CR/LF characters typed into
  the search box can no longer forge extra rows in the export.
- **Condor: tunable pressure-index weightings and thresholds.** Practice Pressure
  Index maths extracted into one shared pure core (`condor-index-core.js`) used by
  `condor.js`, `ppi.js` and `practice-report.js`. A new cog editor lets a power user
  adjust component weightings and the AMBER/RED band thresholds, with visible
  defaults and one-click reset (`condor.indexConfig`, included in the Condor backup
  scope). The capacity safety floor is applied unconditionally *after* any custom
  config — proven by an adversarial fuzz test that no combination of weightings can
  produce a GREEN result while capacity is over limit. "Custom weightings" is
  disclosed in Copy Figures, CSV export, the headline and the Practice Report.
- **Slots: proactive alert thresholds.** Alert-rule evaluation extracted into a pure
  core (`slots-alert-core.js`); a new in-module cog editor replaces the Options-only
  configuration; breaches now surface on Today's Slots card and in the Today headline.
  (Evaluation and storage already existed; this delivers the in-module editor, the
  pure core, and the Today integration.)
- Reference: `docs/plans/TOP10-USER-VALUE-2026-07-01.md` is the source plan for all ten
  items, including what was deliberately excluded from this set.

Tour: two new steps (Today headline, Sentinel rule-coverage drill-down),
`TOUR_VERSION` bumped 5 → 6 so returning users see a short "what's new" pass. All
other tour anchors re-verified against the current markup (`test-tour-steps.js`).
## [v3.143.3] — 2026-07-02

### Bug bash — 22 fixes across data-fetch, queue chips, drug rules, backup and modules

A full-repo bug bash surfaced 22 verified defects, ranging from a silent drug-monitoring
gap to several async races and backup/restore coverage gaps. All 22 are fixed in this
release.

- **`engine/data-fetcher.js`** — `fetchLive()` now falls back to DOM extraction per
  data type (medications/problems/observations individually), not only when the
  patient-banner endpoint fails, and surfaces a `debug.dataFetchFailed` flag when a
  field's API call and its DOM fallback both come up empty
- **`content-scripts/triage-lens/content.js`** — `computeMonitoringChip` now treats a
  `dataFetchFailed` medications signal as a genuine failure (leaves any existing chip
  in place) instead of silently rendering an all-clear; queue monitoring chips
  (`.ch-q-mon`) gained a durable `_durableRowMap`-driven re-injector matching the
  result-chip pattern, so they no longer flash-and-vanish on SPA churn
- **`content-scripts/triage-lens/hud.css`** — added the missing `.ch-q-legend` rule
  (and token-block scope entry) so the queue safety-disclaimer banner is actually
  styled on the live page, not just in the PiP window
- **`rules/alert-library.json`** — PINCER aspirin combo alerts (pincer-3/8/13) now
  match real UK aspirin brand names (Nu-Seals, Caprin, Micropirin) and dm+d wording,
  at parity with `engine/stopp-start.js`'s `ASPIRIN_TERMS`; aligned
  `mhra-isotretinoin-ppg` severity to red to match the comparable valproate PPP alert
- **`visualiser-core.js`** — fixed the aspirin-antiplatelet detector regex so it
  matches real "NNmg" dose labels (was silently never matching); `computeEFI`'s
  polypharmacy deficit now counts only active drugs, not historic/stopped ones
- **`engine/stopp-start.js`** — a problem coded literally as bare "MI" now matches
  the post-MI beta-blocker START check and the aspirin primary-prevention CV check,
  via a narrowly-scoped exact-match helper (not a change to the generic `hasProblem`
  matcher, which is shared with unrelated term lists)
- **`scripts/regen-defaults.js`** — `buildEmbeddedLiteral()` now escapes backticks
  and template-literal interpolation starts, so a stray backtick in `defaults.json`
  can no longer corrupt the generated `content.js` into a syntax error
- **`side-panel/panel.js`** — Request Monitor strip fetch now guarded against
  concurrent invocation, closing a race that could double-fire desktop triage
  notifications and duplicate alert-log entries
- **`pop-out/pop-out.html`** — loads `shared/request-monitor.js` (dropped in v3.21.3
  before the Today tab existed), fixing the pop-out's Triage Load card
- **`side-panel/modules/reception/reception.js`** — `refreshPatientCard` now guards
  against out-of-order async responses with a generation counter, so rapid tab
  switching can no longer show the wrong patient's status
- **`side-panel/modules/record/record.js`** — "needing attention" chip count now
  checks `chip.status` via the canonical helper instead of regex-matching the whole
  chip object's text (was miscounting achieved indicators whose label contained
  "due")
- **`side-panel/modules/sweep/sweep.js`** — switching tabs mid-run no longer
  persists an emptied result set over `sweep.lastRun`
- **`side-panel/modules/today/today.js`** — Morning Sweep "all clear" check now
  includes amber action-needed statuses, matching the real Sweep tab
- **`side-panel/modules/capacity/capacity.js`** — appointment-type cache now
  invalidates when the practice code changes
- **`shared/io/condor-io.js`** — `dayScores` now defaults to (and is validated as)
  an array, not an object, fixing a backup/restore path that could silently break
  day-score persistence
- **`shared/io/suite-envelope.js`** — `previewEnvelope()` now summarises Condor
  content, closing the one module scope that showed no preview before a restore
- **`shared/io/suite-io.js`** — `suite.practiceProfile.attestations` now round-trips
  through suite-wide backup/restore
- **`side-panel/modules/condor/report/report-data.js`** — `saveSnapshot()` now
  upserts by date, making concurrent panel+pop-out writes safe
- **`engine/eval-cache.js`** — `rulesSignature()` now hashes each rule's full
  content, not just id/enabled, so an in-place rule edit correctly busts the cache

## [v3.143.2] — 2026-07-01

### Fix: "Send to Prescribing" team picker restored after Medicus dropdown component change

Medicus replaced their Quasar `q-select` team/assignee picker with a native
`m-simple-select` component whose option list is a debounced, server-driven search —
it only narrows down as you type real keystrokes. The routine-prescription re-assign
macro (`routine-rx-button.js`) was setting the whole team name in one shot and firing a
single synthetic keydown, which never triggered that search: the full unfiltered
Teams/Staff list stayed on screen, the configured team never appeared in it, and the
button failed with "isn't in the assignee list" even though the team exists.

- `runMacro` now simulates real character-by-character typing (`typeText`) into the
  "Assign to" field — a `keydown`/native-value-set/`keyup` cycle per character with a
  short pause between keystrokes — so the live search fires the same way it does for a
  human typing.
- The subsequent option-match wait was extended from 4s to 6s to give the debounce +
  server round trip room, now that it's a live search rather than a local list filter.
- The `[id^="select-item-"]` / `[role="option"]` selectors themselves were unaffected —
  Medicus's new component still uses that markup, so no selector fallback was needed
  here (unlike the OIR checkbox fix in v3.143.1).

## [v3.143.1] — 2026-06-30

### Fix: OIR matching restored after Medicus checkbox component change

Medicus replaced their Quasar checkboxes (`.q-checkbox` / `aria-labelledby`) with
native HTML checkboxes (`label.m-checkbox` > `input.m-checkbox__native` +
`span.checkbox-label`). This silently broke the entire Outstanding Investigation
Requests matching pipeline — auto-tick and the "Tick off results found in record"
button both disappeared.

- `readOutstandingRows` now detects the new `label.m-checkbox` markup first and
  falls back to legacy `.q-checkbox`, keeping compatibility with older Medicus
  instances
- `tickRows` and `updateBulkBar` updated to check `input.checked` for native
  checkboxes (rather than `aria-checked`); the don't-untick safety guard is
  preserved in both paths
- Badge anchor fallback in `annotateOutstandingRow` extended to cover both
  component types

## [v3.143.0] — 2026-06-30

### Lab Results Auto-Filing — one-click filing of all-normal results

A confirm-gated, fail-closed "File all normal" action that appears in Medicus only
when the suite has confirmed every value on an investigation-report task is within
normal limits. It drives Medicus's own filing controls (marks each panel "Normal
result, no action required", selects the no-further-action Next Step, files) — never
full-auto, with Medicus performing its own validation and audit. **This is the suite's
first feature that drives a clinical-record write**, so it is gated accordingly.

(Developed across the branch as 3.138–3.146; consolidated here as one entry landing
above the v3.138–v3.142.1 GP-pressures set that merged to main in parallel.)

- **All-normal gate, fail-closed.** Offers only when severity is `none` and nothing the
  gate can't judge is present (free text/cultures, unmatched report, missing result
  rules). Clinician-set **per-analyte parameters** cover analytes the lab leaves
  un-ranged (HbA1c, Calcium); an opt-in **"my range wins"** override accepts a value
  inside your set range even when the lab over-flags it (e.g. eGFR 89 vs a 90–120 lab
  range), shown loudly in the confirm dialog and never overriding an urgent flag.
- **Trend / drug / text / patient guards.** Blocks on a significant move vs the previous
  value, a monitored drug (meds fetched only when configured, fail-closed on error), a
  promised-contact phrase, or a per-patient "never auto-file" list.
- **Multi-panel (combined bloods).** A task carrying Bone + U&E + LFT under one report
  with one shared File button is handled by merging every matching profile into one
  effective profile (union of parameters/guards, strictest trend, confirm-wins).
- **Admin-only configuration.** The authoring/management UI lives in **Options → Lab
  Filing** (not a side-panel tab — practice-level config, not a per-user tweak), with
  optional **starter profiles** (FBC/U&E/Bone/LFT) that load **disabled** for review.
  Every profile arrives disabled until reviewed and the safety notice acknowledged.
- **In-Medicus card** — one calm card titled to the matched profile, positioned by the
  filing controls; reasons shown inline when filing is not offered.
- **Prepare-only patient message**, external-LLM profile builder, per-install **kill
  switch**, machine-local **audit log** + CSV export, and full backup/restore.
- Fixes a pre-existing global-scope collision (`_DANGEROUS_KEYS` in `labfiling-io.js`
  vs `sentinel-io.js`) that was silently breaking lab-filing backup in Options.
- Tests: `test-lab-filing-utils.js`, `test-labfiling-io.js`, `test-lab-file-macro.js`
  (fake-DOM harness). Full suite green.

> **Pending CSO review:** as the suite's first record-writing feature, the formal
> safety docs (INTENDED-PURPOSE, HAZARD-LOG, CLINICAL-SAFETY-NOTICE) warrant a CSO
> review for Lab Filing. The CSO-review ledger was deliberately not advanced here.

## [v3.142.1] — 2026-06-29

### Verification fixes for the v3.138–v3.142 feature set

Found while headless-rendering the four new surfaces (light + dark) and running the
real ESLint gate:

- **`sweep.css`:** the QOF panel body referenced an undefined token `var(--bg-1)`
  (would have rendered as an unstyled surface — the "white rectangle" failure
  mode); switched to the defined `var(--bg-elev)`. Also simplified
  `var(--border-dim, …)` to the defined `var(--border)`.
- **`eslint.config.mjs`:** registered the new `shared/task-api.js` as an ES module
  (alongside `shared/medicus-api.js`) so `eslint .` parses it; the project lint now
  passes clean across the whole tree.

Headless Chromium render confirmed all four surfaces (Sentinel high-risk banner,
Sweep QOF prioritiser, Sweep recall form, Referrals 2WW safety-net) style correctly
in both themes with every design token resolving.

## [v3.142.0] — 2026-06-29

### Sentinel: ACE-I/ARB post-initiation U&E check (NICE NG136) — PENDING CSO REVIEW

NICE NG136 requires a U&E within ~1–2 weeks of **starting** (or uptitrating) an
ACE-I/ARB. The `ace-arb` rule documented this in its notes but only enforced the
*annual* U&E — so a newly-started patient who had a baseline U&E but no
post-initiation recheck raised no alert (the annual interval reads "in date" off
the baseline). This closes that gap.

- **New additive engine mechanism** (`engine/rules-engine.js`): a drug-monitoring
  test may carry `postInitiationDays` / `postInitiationDueSoonDays`. Unlike the
  rolling-interval check (where a *missing* test is neutral `no_data`), a
  post-initiation requirement that is unmet after the grace window is
  **actionable** — `recently_initiated` (≤14d) → `due_soon` amber (≤21d) →
  `overdue` red. It is satisfied by any qualifying test recorded **on or after**
  the drug's start date.
- **Fail-safe against crying wolf:** it fires ONLY when the drug's start date is
  known (`med.startDate`, derived from issue history) AND no U&E exists since
  starting. An established patient whose start date isn't visible never trips it.
  No change to the existing annual U&E/BP intervals or any other rule.
- **Rule change** (`rules/drug-rules.json`): added the post-initiation U&E test to
  `ace-arb`; bumped `lastUpdated` and documented the change in `sourceNotes`.
- New regression test `test-ace-arb-postinit.js` (14 checks), including the exact
  NG136 gap (baseline-before-start → overdue while the annual reads in-date) and
  the no-false-alarm case (unknown start date → neutral).
- **This is a clinical-rule change and is flagged PENDING CSO (Dr Triska) review**
  before merge, per the suite's clinical-safety governance.

## [v3.141.0] — 2026-06-29

### Sweep: one-click "Create recall task" — close the detection→action loop

Sweep already found tomorrow's patients with overdue monitoring and QOF gaps, but
the only output was a printable reception handout — the actual recall task still
had to be made by hand. This closes the loop: a per-row "Create recall task"
button writes a real task into Medicus.

- **New shared client** `shared/task-api.js` drives Medicus's OWN general-task
  endpoints (`GET /patient/data/workflow/general-task/create`,
  `POST /patient/workflow/general-task/create`) with credentialed fetches — the
  identical, already-shipping pattern `slots/booking-api.js` uses to create
  appointments from the side panel (the extension holds `host_permissions` for
  `*.api.england.medicus.health`). Medicus stays the system of record; its
  validation, access control and audit fire as normal.
- **Per-row inline confirm form** (assignee + an editable description prefilled
  from that patient's gaps via the new pure `buildRecallDescription()` in
  `sweep-core.js`, reusing the same instruction grouping as the handout). One
  explicit task per click — there is deliberately **no bulk "create all"**, the
  Create button is disabled until an assignee is chosen, and it disables after
  success so a double-click can't double-create.
- Only offered on action-needed rows when a practice code is set and there is a
  bookable instruction to recall; the assignee/priority options are fetched once
  per run and reused.
- **No `defaults.json`, clinical-rule or storage-key change.** New checks added to
  `test-sweep-core.js` for `buildRecallDescription`.

## [v3.140.0] — 2026-06-29

### Referrals: 2WW / Faster-Diagnosis safety-net worklist

NHS Resolution repeatedly cites absent safety-netting/follow-up as the root cause
of cancer-delay negligence claims, and the Faster Diagnosis Standard rises to 80%
(March 2026). The Referrals module already pulled outbound NHS referrals with
priority and status, but only as aggregate charts — there was no worklist of the
suspected-cancer referrals that have gone quiet.

- **New pure helpers** `buildSafetyNet()` and `referralAgeDays()`
  (`shared/referrals-api.js`) classify the already-fetched referrals: an "open
  loop" is a `TwoWeekWait` referral still showing `displayStatus: Incomplete`
  (no confirmed outcome). Returns the open rows oldest-first with calendar-day
  ages and a severity (watch ≥ 14d, overdue ≥ 21d — heuristic, configurable).
- **New worklist card** at the top of the Referrals view: open 2WW loops with
  age, patient, service and clinician, plus overdue/watch badges. Reads the RAW
  referrals, so the priority/status filter chips can never hide an open loop.
- **No new endpoint** — reuses the outbound-referrals data the module already
  fetches; no patient-identifiable data leaves the page. Thresholds are labelled
  as a guide, not a clinical standard.
- New regression test `test-referrals-safety-net.js` (19 checks).

## [v3.139.0] — 2026-06-29

### Sweep: QOF points-at-risk prioritiser (CVD-prevention income lens)

QOF 25/26 → 26/27 redirected 141 points into a high-stakes CVD-prevention cluster
(BP control, lipid lowering, antithrombotics) at 85–90% upper thresholds, where a
small case-finding shortfall directly loses income. Sweep already evaluated every
booked patient's QOF gaps but surfaced them one patient at a time, severity-sorted,
with no sense of which gaps are worth the most.

- **New pure helper** `summariseQofPointsAtRisk()` (`sweep-core.js`) re-reads the
  SAME action-needed `qof-indicator` chips Sweep already produced and weights each
  by the indicator's own `points` (from the chip, with a `pointsByCode` override
  built from the loaded QOF rules as a backstop). Returns cohort totals, a
  CVD-prevention subtotal, patients ranked by points-at-risk, and a per-indicator
  breakdown.
- **New `isCvdQofIndicator()`** classifies the CVD-prevention domain by explicit
  indicator code (HYP/CHD/STIA/CD/CHOL/AF/PAD + DM006/DM034/DM035/DM036) — not a
  blunt prefix, so DM036 (BP) counts as CVD but DM020 (HbA1c) does not.
- **New panel** at the top of the Sweep results: "QOF points at risk: Σ N
  (CVD-prevention M)", patients ranked highest-value-first, and an indicator
  breakdown — so a practice works the gaps worth the most money first.
- **No clinical-rule, threshold or `defaults.json` change** — pure aggregation of
  chips already evaluated. Income is described in points only (national weights);
  the panel notes actual £ depends on list size and prevalence.
- New regression test `test-sweep-qof-points.js` (37 checks).

## [v3.138.0] — 2026-06-29

### Sentinel: high-risk "blind-spot" guard for unmonitored drugs

Closes the silent-failure mode the developer guide warns about — a high-risk drug
under an odd brand, an `exclude`d form, or a disabled rule matches NO monitoring
rule, so no overdue-blood chip ever fires and nobody notices for months. Sentinel
already listed every unmatched medicine, but buried in a collapsible "N unmatched"
list that treated an unmonitored paracetamol the same as an unmonitored amiodarone.

- **New engine helper** `flagHighRiskUnmatched()` (`engine/rules-engine.js`) re-reads
  the existing `listUnmatchedMedicationsDetailed()` output and elevates the subset
  whose name matches a monitored high-risk class (DMARDs/immunosuppressants, lithium,
  amiodarone/digoxin, oral anticoagulants, antithyroids, aldosterone antagonists,
  level-monitored antiepileptics, clozapine, hydroxychloroquine). Class stems are
  matched case-insensitively as substrings — the SAME contract as `drugMatchesRule`,
  so "lithium" covers all salts and "valproate" covers "sodium valproate".
- **Surfaced** as a red banner near the top of the Sentinel panel (with the other
  warnings), not hidden in the collapsed list: each drug, its risk class, why it was
  missed (no rule vs excluded), and "verify monitoring is in place in Medicus".
- **No new noise:** the flagged set is a strict subset of meds that already passed
  every enabled rule unmatched. The common drugs here all already carry rules, so on
  a complete rule set this fires on nothing; it only catches genuine slips.
- **No clinical-rule, threshold or `defaults.json` change** — pure read of data
  already in the snapshot. Backstop only, not a monitoring rule.
- New regression test `test-high-risk-unmatched.js` (18 checks).

## [v3.137.0] — 2026-06-29

### CQC Inspection Readiness: answer-first redesign, honest disclosure, clinician view

A full practice-panel-driven overhaul of the CQC Inspection Readiness surface
(`cqc-readiness.{html,js,css}`, `cqc-render.js`, `engine/cqc-evidence.js`). Wording,
layout and disclosure only — no clinical-rule or threshold changes, and the
read-only / no-cohort-enumeration honesty boundary is unchanged (the suite never
fabricates a patient count). Consolidates the iterative work previously numbered
v3.135.0–v3.136.2 on the development branch, renumbered to avoid collision with the
OIR changes that shipped on main as v3.135.0/v3.136.0.

- **Answer-first layout.** A plain-English headline verdict ("Monitoring-system
  readiness: GREEN — all rule sets current") leads the page; the multi-screen
  alphabetical matched-term wall is collapsed behind a counted toggle; the
  Safe/Well-led evidence and the reconciliation worksheet follow in a sensible
  hierarchy.
- **Honesty hardening.** "Verified {date} against BNF/NICE/MHRA via The Keeper"
  wording; the coded-data "floor not a ceiling" caveat is prominent and de-duplicated;
  vaccines labelled "surveillance"; developer/spec noise removed from the
  inspector-facing document.
- **Fixed the dead CSV export** (the button silently produced nothing — object-vs-string
  return mismatch), now serialises the `{suffix, sections}` shape correctly.
- **Per-exclude clinical reasons.** Each disclosed `drug.exclude` term shows why it is
  dropped (grouped by family), so a pharmacist/nurse can sense-check a silent
  false-negative line-by-line.
- **Clinical methods & sources block.** Names the published version of each clinical
  set — PINCER (Avery et al., BMJ 2012), Boustani ACB scale (ACBcalc.com), STOPP/START
  v3 (2023) — read from drift-safe `SPEC` constants newly exported by
  `engine/acb-scores.js` and `engine/stopp-start.js`; engine-method sets flagged as NOT
  part of the rule-currency check.
- **Clinician view (new third mode).** Verdict + coverage + collapsed methods only,
  for a fast clinical glance; the amber coded-data safety caveat stays visible.
- **Fillable reconciliation worksheet.** The "your count" cells are editable inputs the
  practice types its own Medicus count into (persisted to `cqc.recon.counts`, printed
  with the pack), with a live total and a "counts entered by / date / source" provenance
  line. The suite still supplies no patient number.

Tests: new coverage in `test-cqc-evidence.js` and `test-cqc-render.js`; full suite
114/114. Method validated by a synthetic practice panel (six personas), recorded in
`docs/appraisal/PRACTICE-cqc-readiness-2026-06-29.md`.

## [v3.136.0] — 2026-06-29

### Feature: nine new built-in OIR test definitions

Expanded `TEST_DEFS` in `engine/outstanding-match.js` with nine new entries,
promoted from practice-level custom tests after clinical review. All are
`singleAnalyte: true` (one result completes the test). Terms are kept to generic
forms; lab-specific display strings belong in the planned lab database.

New tests: **rheumatoid factor**, **HIV** (combined Ag/Ab screen), **vitamin D**
(25-hydroxy), **urate** (+ uric acid synonym), **CRP** (+ c reactive protein),
**hepatitis C**, **hepatitis B surface antigen** (surface-antigen-specific;
core-antibody requests intentionally uncovered), **syphilis** (+ treponema),
**faecal calprotectin**.

Safety notes:
- `"RF"` deliberately not a req synonym (too short; anti-CCP is a different marker
  and intentionally stays unrecognised so an RF result can never clear it).
- Hep B def is narrow by design — `"Hepatitis B"` alone does not resolve to it,
  preventing an HBsAg result from clearing a co-requested core-antibody request.
- HIV bare `"hiv"` req term added for card-name resolution only, not in analytes
  (avoids an HIV viral-load analyte row wrongly auto-ticking an Ab-screen request).
- Cervical screening and histology deliberately excluded (see CHANGELOG v3.136.0
  notes); HSL Analytics-specific vitamin D string deferred to lab database.

`test-outstanding-match.js` — new sections 15–23 (resolve + auto-tick + negative
for each); test 10a rewritten to use coeliac screen as the custom-test example
(vitamin D is now a built-in; the baseline assertion would otherwise fail). Total:
132 assertions, all passing.

## [v3.135.0] — 2026-06-29

### Feature: OIR test-dictionary merge prompt + alphabetical list

**Merge prompt on overlapping request terms.** When saving a custom test entry
in the **Outstanding Requests** test dictionary, the editor now detects whether
any existing custom entry shares a `req` term (case-insensitive). On conflict, a
merge dialog is shown rather than silently creating a duplicate:

- Displays the proposed merged entry — unioned `req` / `rep` / `analyte` terms
  from all conflicting entries, deduplicated (first-occurrence order preserved).
- The merged label is editable; combined terms are shown read-only.
- `singleAnalyte` is derived conservatively (only set if **all** merged entries
  agree) and shown as a disabled checkbox — display only, not user-overridable.
- The merged entry's key defaults to whichever conflicting entry matches a
  built-in panel; otherwise the first existing (older) entry's key is kept.
- Three choices: **Merge** (replace all conflicting entries with one merged
  entry), **Save separately** (proceed despite the overlap), **Cancel**.

Safety: the engine's `mergeTestDefs` floor (`engine/outstanding-match.js:381`)
never copies `singleAnalyte` onto a built-in regardless of what the editor
sends — the auto-tick threshold on multi-analyte panels cannot be lowered via
config.

**Alphabetical sort.** The custom test list is now sorted by label for display
(stored order is unchanged, so the matcher is unaffected).

`content-scripts/triage-lens/options.js`, `options.html`, `options.css`.

## [v3.134.7] — 2026-06-29

### Fix: newly-issued LNG-IUS under its generic name not recognised as HRT endometrial cover

An HRT (estradiol) chip showed *"IUS expired (>5y) — endometrial cover not
confirmed"* on a patient who had just had a new Mirena issued — the freshly
fitted device was not picked up, so the chip fell through to a stale,
out-of-window coil problem code still on the record.

Root cause: `buildHrtContext` matched `iusTerms` by bare lowercase substring.
Medicus lists a freshly-issued LNG-IUS under its generic VTM name
**"Levonorgestrel (Intrauterine device)"**, and the `(` defeated the
`"levonorgestrel intrauterine"` term (the string stayed
`levonorgestrel (intrauterine device)`), while `"mirena"` appears only on the
product sub-line. No `iusTerm` matched → `iusMed` was null → the expired
problem-coded coil won.

- `engine/rules-engine.js` — the context matcher now collapses any run of
  non-alphanumerics to a single space before substring matching, so bracketed
  and hyphenated generic name forms match their space-separated terms. Durable
  against `(Intrauterine device)`, `-releasing`, etc. without loosening which
  drugs are recognised.
- `test-qof-indicator-filters.js` — F11 now covers the reported case: a new
  "Levonorgestrel (Intrauterine device)" on the medication list counts as cover
  even with a stale 2017 coil problem still present.

## [v3.134.6] — 2026-06-26

### Fix: "B12 / Folate" not matched to its outstanding request

A combined "B12 / Folate" haematinics request was never matched to its report:
it resolved to no canonical test (`key: null`) → *"request test not recognised"*
→ stayed outstanding even with both B12 and folate results on screen.
`TEST_DEFS` had no B12/folate entry.

- `engine/outstanding-match.js` — added a `b12folate` def. Deliberately a
  two-analyte panel (NOT single-analyte): a report carrying **both** B12 and
  folate is a confident auto-tick; a report with only one of them stays tentative
  (the other half of the combined request may still be pending, so it must not
  auto-clear). `req`/`rep`/`analytes` cover `b12`, `cobalamin`, `folate`.
- `test-outstanding-match.js` — new section 14: the request now resolves, a
  B12 + folate report auto-ticks it, a B12-only report is tentative (never
  auto-ticked), and the def does not cross-feed the ferritin panel.

## [v3.134.5] — 2026-06-26

### Fix: TSH-only thyroid report not confidently matched to its request

On the **Outstanding Investigation Requests** card, a "Thyroid Testing" request
was recognised but a TSH-only report only matched it *tentatively*
("✓? resulted? (this report)"), so it was never auto-ticked. UK labs reflex-test
thyroid (TSH first; FT4/FT3 only if TSH is abnormal), so a TSH-only report **is**
the complete thyroid result and should confidently clear the request.

Root cause: `tft` is a multi-analyte panel, and the matcher's analyte signature
needs ≥2 distinct analytes to be confident — a lone TSH scored only 1.

- `engine/outstanding-match.js` — added an optional **`anchors`** concept to a
  test definition: an analyte that, on its own, confidently identifies a complete
  result for the panel (below the usual 2-analyte threshold). Set
  `anchors: ['tsh', 'thyroid stimulating hormone']` on the `tft` def. A TSH-only
  report now auto-ticks a predating thyroid request; a lone FT4/FT3 (no TSH) stays
  tentative.
- Scoped to **this-report** coverage (`reportCoverage`) only — NOT to
  resulted-elsewhere history enrichment, where a single analyte from a different
  past report is weaker evidence and remains tentative (a TSH in this report is
  direct evidence the request just resulted; a TSH in the record is circumstantial).
- Strict confidence floor still demotes a TSH-only report (an anchor is an
  inferred-analyte signal, not a lab-assigned specimen-group title).
- `test-outstanding-match.js` — new section 13 guards it: TSH-only is confident +
  auto-ticks, lone FT4 stays tentative, the anchor touches no other panel, strict
  floor still demotes, and a lone TSH in history is unchanged (still tentative).

## [v3.134.4] — 2026-06-26

### Fix: HbA1c not matched to its outstanding investigation request

On a "Review Investigation Report" task, the **Outstanding Investigation
Requests** card matches the incoming report to the requests awaiting a result.
An HbA1c report was never matched to its own request: the request
"Haemoglobin A1C (HbA1C)" resolved to no canonical test (`key: null`), so it was
classed as *"request test not recognised — left for manual review"* and stayed
outstanding even though the very result that satisfied it was on screen.

Root cause: `engine/outstanding-match.js` `TEST_DEFS` had entries for lipids,
U&E, FBC, LFT, PSA, TFT, FIT, ferritin, bone and the sex-hormone family, but
**none for HbA1c** — the same unrecognised-request gap previously fixed for
FSH/LH.

- `engine/outstanding-match.js` — added an `hba1c` test definition (single-analyte;
  `req`/`rep`/`analytes` mirror the HbA1c result rules in `defaults.json`:
  `hba1c`, `haemoglobin a1c`, `glycated haemoglobin`, `glycosylated haemoglobin`).
  One HbA1c result is now a confident match and auto-ticks its predating request.
- `engine/outstanding-match.js` — hardened the `fbc` def with
  `exclude: ['a1c', 'glycated', 'glycosylated']` so a lab spelling like
  "Haemoglobin A1c" (which shares the `haemoglobin` token) cannot feed the FBC
  analyte signature and tentatively flag a genuinely-outstanding FBC. Mirrors the
  same exclude on the `base-low-haemoglobin` result rule. Fail-safe: it only
  narrows FBC, never widens it, and a real FBC report still matches.
- `test-outstanding-match.js` — new section 12 guards the fix: the request now
  resolves to `key=hba1c`, an HbA1c report auto-ticks it, an HbA1c report leaves
  FBC/U&E outstanding, "Haemoglobin A1c" does not feed the FBC signature, and a
  genuine FBC report still matches.

## [v3.134.3] — 2026-06-25

### Fix: Triage monitor "Invalid UUID" when pasting the inbox URL

The Request Monitor's **Team / assignee UUID** field only accepted a bare 36-char
UUID, so pasting the whole Medicus task-list URL — or a `masterAssignee=…`
fragment — was rejected with `Invalid UUID — check format`, even though the URL
contains a perfectly valid UUID. Copying the full URL is the natural thing to do
(the help text even points you at the URL), so this read as the feature being
broken.

- `options/options.js` — new `extractAssigneeId()` normalises the field on save:
  a bare UUID, a full inbox URL, or a `masterAssignee=…` fragment all resolve to
  the bare assignee UUID (preferring the `masterAssignee` param, falling back to
  the first UUID-shaped substring). The cleaned UUID is written back into the
  field so the user sees what was saved. The "Invalid UUID" error now only fires
  when the paste contains **no** recoverable UUID at all.
- `options/options.html` — help text updated: paste the whole task-list URL (the
  UUID is extracted automatically); the bare UUID still works too.

## [v3.134.2] — 2026-06-23

### Fix: create-task widget missing on prescribing overviews (no "Codes & actions" card)

The inline "Create task for this patient" widget anchored only to the booking
widget or the "Codes & actions" card. Prescribing task overviews (Routine /
Non-Routine Repeat Request, Medications for Re-authorisation) have **neither**, so
`injectWidget` found no anchor and the panel never appeared there.

- Added a universal fallback in `task-inline.js`: when there's no booking widget
  and no "Codes & actions" card, anchor the panel **above the bottom "More
  actions" action row** (excluding any inside a dialog/drawer) — every task
  overview has that row. Anchor preference is now booking widget → Codes &
  actions card → action row.

## [v3.134.1] — 2026-06-23

### Performance: injected-widget optimisations (task / booking / routine-rx)

Three-agent optimisation pass over the injected surfaces. All three were already
sound on the SPA hot path (path-gate, own-mutation filter, placed fast-path,
hidden guard, rAF-deferred heavy scan); these are the targeted wins on top.

- **routine-rx-button.js** — `findByText` / `collectByText` now test the
  control's TEXT first and call `visible()` (which forces a layout reflow via
  `offsetParent`/`getClientRects`) **only** on text-matching candidates. The slow
  path's wide `div/span` fallback sweep can no longer trigger a per-node reflow
  storm.
- **booking-inline.js** —
  - Fixed a **slot-reservation leak**: a held reservation is now released on
    `pagehide` via a `keepalive` POST, so closing/navigating mid-booking no longer
    leaves the slot locked for other bookers until the backend TTL expires.
  - `doOpen` resolves the patient and fetches the appointment finder **in
    parallel** (independent calls) instead of sequentially — one round-trip of
    open latency, not two.
  - Re-opening the panel for the same task **reuses** the already-loaded
    patient / provider / appointment types instead of re-fetching.
- **task-inline.js** — re-opening reuses the already-loaded assignee/priority
  lists instead of re-resolving the patient and re-fetching the form; the
  per-keystroke handler caches the Create-button reference instead of querying
  the document on every character.

## [v3.134.0] — 2026-06-23

### New: inline "Create task for this patient" widget (real API wiring)

Replaces the earlier click-path "+ Task" button — which tried to puppet an
on-page "Create task" control that doesn't exist on the prescribing screen — with
a proper inline panel built the same way as the booking widget: it drives
Medicus's own task API directly.

- New `content-scripts/task-inline.js` + `task-inline.css`: a collapsible
  **"Create task for this patient"** panel injected below the "Codes & actions"
  card on task overviews (stacks beneath the booking widget when present).
- On open it resolves the patient from the task UUID and `GET`s
  `/patient/data/workflow/general-task/create?patientId=…` to populate **Assign
  to** (teams + staff option-groups) and **Priority**; **Create** `POST`s to
  `/patient/workflow/general-task/create` with
  `{ patientId, assigneeId, assigneeType, description, priority, snoozeUntil }`.
- Same injection discipline as booking-inline (shared observer hub with private
  fallback, own-mutation filter, throttle + rAF, and remove-on-leave so it can't
  strand on a non-task page). Credentialed same-origin fetch; no patient-data
  field values are read.
- Removed the abandoned `content-scripts/triage-lens/task-button.js` and its
  `triagelens.taskMacro` backup wiring (the click-path approach is gone).

## [v3.133.5] — 2026-06-23

### "+ Task" button: tidy leftover menu CSS (interim)

Removed the now-unused `.chtk-caret`/`.chtk-menu*`/`.chtk-step` rules left behind
by the config-menu deletion and squared off the single button's border-radius.
Cosmetic only; the API-driven task-creation rebuild is still in progress.

## [v3.133.4] — 2026-06-23

### "+ Task" button: removed the config menu (interim)

Stripped the ▾ caret dropdown (captured-steps list, "Edit steps (paste JSON)",
reset, commit-mode options) — it exposed developer-facing JSON config that has no
place in the clinical UI. The button is now a single "+ Task" control. Also
removed a dangling `closeMenu()` reference left by the menu deletion.

This is an interim step: the click-path-replay model is the wrong approach for
this button (there is no on-page "Create task" control to drive on the prescribing
screen). It will be rebuilt as direct task-API wiring — an inline create-task
panel modelled on `booking-inline.js` — once the task-creation API contract is
captured.

## [v3.133.3] — 2026-06-23

### Fix: "+ Task" button now appears on all prescription overviews

The button was copied from `routine-rx-button.js`, which gates injection on the
"Save & send to routine requests task list" radio being present. That radio does
not exist on **Routine Repeat Request** overviews (their Next Steps are "Issue 1
approved item / Save & re-assign / Save & come back later"), so the anchor scan
bailed and the button never showed. The task macro clicks the global "Create
task" control, not that radio, so the dependency was wrong.

- Dropped the routing-control requirement. `findActionAnchor` now anchors to the
  bottom-most visible **"More actions"** button in the main action row (with the
  **"Issue"** button as a fallback), excluding any inside a dialog/drawer.
- Fast-path re-validation keyed on the anchor button's `isConnected` instead of
  the (now-removed) routing control; dead `sharesPanel`/`findRoutingControl`
  helpers removed.

## [v3.133.2] — 2026-06-23

### "+ Task" button default click-path matched to live Medicus

Captured the real task-creation flow on live Medicus: a top-level **"Create task"**
button opens a modal of task-type choices ("Appointment request", "Other", …) from
which the clinician picks the type. Replaced the placeholder default
("More actions" → "Add task") with the single durable step that opens that picker:

- Default `steps` is now `[{ kind:'click', text:['Create task'] }]` — opens the
  task-type modal and stops; the clinician chooses the type. No type is
  hard-wired and nothing is created automatically (`commitMode: 'open'`).
- To always jump straight to one type, append e.g.
  `{ kind:'click', text:['Other'] }` via the button's ▾ → "Edit steps…".

## [v3.133.1] — 2026-06-23

### Fix: booking widget stranded at the bottom of task-LIST pages

The inline "Book appointment for this patient" widget only ever **injected** on a
task-overview page; it had no removal path. On SPA navigation from an overview
back to a task-LIST page, `runInject` reset its state and returned early
**without removing the widget node**, so Vue left the panel parented to a card
that survived the transition — stranding it at the bottom of the list page, where
(with no single patient) it re-showed "Could not determine patient ID — try
navigating away and back".

- Added `removeWidget()` (releases any held slot reservation, then removes
  `#ms-bk-widget` with the observer paused).
- `runInject` now calls it on the `!getTaskInfo()` branch — leaving a task
  overview tears the widget down instead of orphaning it.

## [v3.133.0] — 2026-06-23

### New: "+ Task" button on the prescribing screen (captured click-path replay)

The prescription-request task overview has no "add task" control of its own, even
though that action exists elsewhere in the record. Added
`content-scripts/triage-lens/task-button.js`: a floating **"+ Task"** button that
injects beside the existing routine-prescription button (same H-035 gating —
prescription overview only, anchored to the "More actions" row that shares a panel
with the routing control, never inside a dialog/drawer) and, on click, **replays a
captured click-path by driving the real Medicus UI** to open the new-task workflow.

- **Configurable, not hard-coded.** Task-creation controls differ between Medicus
  builds, so the replay sequence is captured per install. `scripts/ui-clickpath-recorder.js`
  gains `chRec.macro()`, which emits the compact replay JSON; paste it into the
  button's ▾ menu → "Edit steps…". A sensible default ("More actions" → "Add task")
  ships so it works out of the box on builds using those labels.
- **Safe by default.** Controls are matched by **visible text** (never per-session
  ids); any missing step **aborts** and clicks nothing further. The default
  `commitMode: 'open'` replays only the navigation steps and **stops with the form
  open** for the clinician to complete — it never creates a record on its own. A
  step explicitly marked `submit` is gated by mode (`open` / `manual` / `auto`).
- Makes **no network calls** and reads **no patient-data field values**.
- Subscribes to the shared `__chObserverHub` (falls back to a private observer),
  PREPENDs its host and re-validates placement on the fast path — same injection
  discipline as `routine-rx-button.js`.
- The captured click-path (`triagelens.taskMacro`) is included in suite backups via
  `shared/io/triage-io.js`, alongside the routine-prescription prefs.

## [v3.132.6] — 2026-06-22

### Performance: one shared DOM-observer hub for all page-injection features

Follow-up to v3.132.5. The injected features each still ran their **own**
`MutationObserver` over the whole `document.body` subtree, so every Medicus
(Vue + AG-Grid) re-render woke three separate observers — three callbacks, three
rAF gates, three visibility checks, every frame. Introduced
`content-scripts/dom-observer-hub.js`: a single body-subtree observer (loaded first
in the manifest, shared via `window.__chObserverHub`) that fans one rAF-coalesced
mutation batch out to all subscribers and is paused while the tab is backgrounded.

- `routine-rx-button.js`, `booking-inline.js` and `pusher-relay.js` now **subscribe**
  to the hub instead of each constructing a body observer (3 observers → 1).
- Each keeps its own self-mutation filter and placement fast-path; under the hub
  the per-feature disconnect-around-write is unnecessary (the own-mutation filter
  already ignores our own writes) and is retained only on the fallback path.
- **Fallback:** if the hub is absent each feature stands up its own private
  observer exactly as before, so nothing depends on the hub for correctness — only
  for efficiency.

Covered by `test-dom-observer-hub.js` (one observer for N subscribers, coalesced
fan-out, hidden-pause, unsubscribe, error isolation, idempotent load). `content.js`
(scoped queue observer, already optimal) and `sentinel.js` (nav-detection
semantics) keep their own observers and are untouched.

## [v3.132.5] — 2026-06-22

### Performance: page-injection observers no longer scan on idle SPA re-renders

The injected page features (the "send to routine" button, the inline "Book
appointment" widget, and the Pusher relay) each ran a `MutationObserver` over the
whole `document.body` subtree, which fires on every Medicus (Vue + AG-Grid) render.
On each fired tick they re-ran whole-page DOM scans — and the worst offenders read
`offsetParent` / `getClientRects` (forced synchronous layout/reflow) on thousands
of nodes **even when nothing relevant had changed and the control was already
placed**. That is the UI slowdown. Reworked all three to the same hardened pattern
that the queue-chip observer in `content.js` already uses:

- **`content-scripts/triage-lens/routine-rx-button.js`** — added a reflow-free
  fast path: once the button is placed, idle re-renders are dismissed with cheap
  connectivity checks (`isConnected` / `contains`) and the cached routing-control's
  `isConnected` (keeps H-035 gate 2 enforced between scans), doing **zero** layout
  flushes. The expensive `findActionAnchor` scan now runs only on a real placement
  change, and even then tries the narrow `label`/`[role=radio]` carriers before any
  `div`/`span` sweep. Added a self-mutation filter + disconnect-around-write so our
  own inject can't self-trigger a rescan, an rAF hop off the mutation-callback path,
  and a `document.hidden` pause. PREPEND, re-inject durability, the H-035 visibility
  gates and text-only control matching are all unchanged.
- **`content-scripts/booking-inline.js`** — the widget's own `rerender()` (an
  `innerHTML` swap on every keystroke / slot pick) no longer wakes the observer
  (own-mutation filter), the `findCard` heading scan searches the realistic
  `h1`–`h6`/`strong`/`b`/`legend` carriers first and skips reading `.textContent` of
  large subtrees, and the scan is gated behind a cheap path check, a fast-path skip
  when already placed, an rAF, and a `document.hidden` pause. Networking/booking
  flow, HTML-escaping and below-card placement unchanged.
- **`content-scripts/pusher-relay.js`** — its channel-rebind observer now coalesces
  bursts to one rAF-aligned check and pauses while backgrounded (the channel check
  is idempotent, so this changes only *when* it runs, never whether a recreation is
  detected).

Pure performance pass — no behavioural change. `content.js`'s queue observer was
already optimal and was left untouched; `sentinel.js`'s nav-detection observer was
deliberately left as-is (already cheap, and a naive change would risk patient-switch
detection). Consolidating the remaining body observers into one shared dispatcher is
noted as a follow-up.

## [v3.132.4] — 2026-06-22

### Bug fix: "send to routine" button restricted to the prescription-routing workflow

The routine-rx button was leaking onto screens that merely share a "More actions"
button — the "View Prescription" detail modal and, most recently, the
appointment-booked drawer that overlays the prescription page (same URL, so a URL
guard alone can't exclude it). Reworked the visibility gate to implement H-035
control (e) properly — the button now appears only where the routing workflow
genuinely exists:

1. **URL pre-filter** — slug must contain `prescription`
   (`/tasks/data/…prescription…/overview/`), confirmed `prescription-requests` in
   `engine/extractors/patient-context.js`. (Replaces the looser `(?:prescri|medic)`
   from v3.132.2, which also matched `medical_patient_request_task` etc.)
2. **Control present** — the "Save & send to routine requests task list" option
   (the very control the macro clicks first) must be present and visible on screen.
3. **Same-panel anchor** — the button only mounts beside a "More actions" button
   that shares a panel with that routing control, and never inside a
   `role="dialog"`/`aria-modal` overlay. This is what keeps it off an appointment
   drawer overlaying the prescription page.

Also debounced the mutation-observer re-check (200 ms) since the gate now scans
for the routing control.

## [v3.132.3] — 2026-06-22

### Bug fix: booking API now targets the correct host (root cause of JSON errors)

The `/scheduling/*` booking endpoints live on the **API subdomain**
(`{siteId}.api.england.medicus.health`) — the same host the slots-overview call
already uses — **not** the page host. The page host serves the SPA HTML shell
for `/scheduling/*`, which is what produced every `Unexpected token '<',
"<!doctype ..."` error. (The earlier "root-relative path" reading was an artefact
of `scripts/booking-flow-capture.js`, whose `safeUrl()` strips the host and
records only the path — so the capture never revealed which host the calls used.)

- **Inline widget** (`booking-inline.js`): `apiFetch` now builds URLs against
  `{siteId}.api.<host>` instead of `location.origin`. CORS from the page origin
  is already allowed (Medicus's own SPA calls the API subdomain the same way).
- **Side panel** (`booking-api.js`): rewritten to fetch the API subdomain
  directly with credentials — the side panel is an extension page with
  `host_permissions` for `*.api.england.medicus.health`, so this works exactly
  like the existing overview call. Dropped the `executeScript`/`booking-bridge.js`
  relay (no longer needed); `booking-bridge.js` deleted.

### Inline widget: now inserts BELOW the "Codes & actions" card

`findCard()` walks up from the "Codes & actions" heading to the lowest common
ancestor that also contains the form's "Submit" button — i.e. the whole card —
and inserts the widget immediately *after* it, so it sits below the section
rather than inside it.

## [v3.132.2] — 2026-06-22

### Bug fix: "Prescribing / Meds Management" button scoped to prescription tasks only

The routine-rx button was appearing on the "View Prescription" detail panel
(a modal overlay) because `findActionAnchor()` matched any "More actions" button
on the page. Fixed with two guards: (1) URL must match a prescription/medication
task overview path; (2) the matched button must not be inside a `role="dialog"`
or `aria-modal` overlay.

### Booking: inline widget injected into Medicus page below "Codes & actions"

New `content-scripts/booking-inline.js` injects a collapsible "Book appointment
for this patient" panel directly into the Medicus task page, below the "Codes &
actions" section. Unlike the side-panel widget, the inline widget makes direct
same-origin fetches to `/scheduling/*` (the content script runs on
`england.medicus.health`, so no bridge is needed). Patient ID is resolved from
the task UUID via the API subdomain as before.

### Bug fix: side-panel booking connection error

Replaced `chrome.tabs.sendMessage` with `chrome.scripting.executeScript` in
`bridgeFetch`. The previous approach required `booking-bridge.js` to be
pre-loaded in the tab (failing with "Receiving end does not exist" on tabs opened
before the extension reload). `executeScript` injects and runs the fetch inline
on demand — no pre-loaded content script required. `booking-bridge.js` removed
from the manifest.

## [v3.132.1] — 2026-06-22

### Bug fix: booking panel now works from any Medicus screen

Two fixes for the v3.132.0 booking panel:

**Fix 1 — JSON error on all booking API calls.** The `/scheduling/*` endpoints
on `england.medicus.health` return the SPA HTML shell to cross-origin callers
(the extension side panel), causing `Unexpected token '<'` JSON parse errors.
Added `content-scripts/booking-bridge.js` — a new content script that runs in
the isolated world of every Medicus tab and listens for `CH_BOOKING_FETCH`
messages from the extension. It relays the fetch from inside the tab (same-origin
context, full session cookies) and returns the response text. SSRF guard: the
bridge only relays to `/scheduling/` paths on the tab's own hostname; any other
URL is rejected. Rewrote `booking-api.js` to route all six booking API calls
through this bridge via `chrome.tabs.sendMessage`.

**Fix 2 — no patient detected on the triage / patient-request screen.** The
original `detectPatientId()` only matched `/patient/{uuid}` and
`/care-record/{uuid}` URL patterns. Task screens use
`/tasks/data/{typeSlug}/overview/{taskUuid}` where the UUID is the *task* ID,
not the patient ID. The updated `detectPatientId(tab)` now detects this pattern
and resolves the patient by fetching
`https://{siteId}.api.england.medicus.health/tasks/data/{typeSlug}/overview/{taskUuid}`
directly from the extension (the API subdomain is not origin-gated), extracting
`data.data.patient.id` from the response.

## [v3.132.0] — 2026-06-22

### Slots tab: embedded appointment booking

New collapsible "Book appointment for patient" panel at the bottom of the Slots
tab. Clicking it auto-detects the current patient record and Medicus origin from
the open Medicus tab, fetches appointment types from the practice's
`available-appointment-finder` endpoint, then lets the receptionist pick a type,
date, and available slot — all without leaving the side panel.

**Flow:** type + date picker → Find slots (calls
`available-appointment-places-between-range`) → click a slot to reserve it
(server-side `reserve-slot-and-broadcast-...`) → confirm step with optional
reason field → POST to `create-appointment` which triggers patient SMS/email
notifications via the `bookingConfirmationRecipients` the server pre-populates →
success state with "Book another" reset.

**Safety:** the slot reservation is released via `remove-slot-reservation-...`
on Back/cancel, on panel close while in the confirm step, and on module teardown
— so an abandoned booking never locks a slot for other receptionists. The server
also releases it automatically on a successful create.

Implementation: new `side-panel/modules/slots/booking-api.js` (pure async
functions, no DOM), all booking state isolated in `state.bk`, no changes to the
slots overview data path or alert rules.

## [v3.131.5] — 2026-06-22

### Dev tool: fix booking-flow capture console flood; widen default filter

First live run of `scripts/booking-flow-capture.js` flooded the console with
`Refused to get unsafe header "location"` + a stack trace on every XHR. Cause:
the XHR handler read the `location` response header, which is CORS-forbidden on
cross-origin responses — `getResponseHeader` doesn't throw for it (so the
`try/catch` couldn't suppress it), it logs an uncatchable warning. Removed that
read; only the CORS-safelisted `content-type` is read now.

Also widened the default capture filter using what the first run's call-stacks
revealed: booking is a **server-driven-UI drawer** with a **slot-reservation
lifecycle** (drawer.open → permission check → loadComponent/getUI → search →
reserve slot → confirm; reservation released on close, coordinated over Pusher).
The filter now also matches `permission`, `component`, `drawer`, `get-ui`,
`/ui/`, `reserv` and `search` so those steps aren't missed. Dev-only;
`scripts/` is excluded from the release zip.

## [v3.131.4] — 2026-06-22

### Dev tool: booking-flow network+DOM capture (recon for embedded booking)

New `scripts/booking-flow-capture.js` — a console-pasteable recorder that maps
what Medicus does when you click **Actions → Appointment**, so the booking flow
can be replicated and embedded into the Slots page. It is the network+DOM
sibling of `scripts/ui-clickpath-recorder.js` (which captures click structure but
deliberately never touches the network).

Runs in the page's MAIN world (the same axios/XHR-wrap technique as
`page-world.js`, since Medicus is a Vue + AG-Grid SPA on axios under a strict
CSP). It records, on one ordered timeline: every scheduling/appointment request
(and all writes) with method, path, request payload, request headers, response
shape and timing; booking modal/drawer appearance (control names/labels/types —
never field values); and SPA route changes. Output via `chBook.summary()`
(deduped endpoint list), `.dump()`, `.copy()`, `.save()`.

Observation only — never blocks, rewrites, replays or sends anything; nothing
leaves the browser except the local copy/save you trigger. Bodies are
PII-redacted by default (names, DOB, NHS number, address, postcode, phone, email
masked by key; NHS-number/postcode value-detection as a backstop), keeping
booking-relevant structure (slot / appointment-type / clinician / date ids and
UUIDs). Dev-only: `scripts/` is excluded from the release zip, so nothing ships
to users. Use a TEST patient.

## [v3.131.3] — 2026-06-21

### Routine-Rx button: target the dedicated "send to routine requests" option

Medicus now has a dedicated **"Save & send to routine requests task list"**
radio (distinct from "Save & re-assign to someone else"), with a **"Send to
routine list"** commit button. The macro now drives those controls instead of
the generic re-assign path — it still selects the configured team in "Assign
to" and waits for the commit button to enable. Confirm prompt and hazard H-035
control names updated to match.

## [v3.131.2] — 2026-06-21

### Routine-Rx button: sit inline with the task actions, not the viewport corner

The button now injects **inline beside the task's action buttons** (anchored to
the "More actions" button's row, prepended) instead of floating fixed at the
bottom-right of the window. Follows the queue-chip reconciler rules — PREPEND +
re-inject on every mutation + idempotent — so Vue doesn't strip it. The ▾ menu
now opens upward above the button.

## [v3.131.1] — 2026-06-21

### Routine-Rx button: wait for "Re-assign task" to enable before committing

Hardened against the real UI confirmed by on-screen capture: Medicus keeps the
`Re-assign task` button **disabled until a valid assignee is registered**, so
the macro now **waits until the button is enabled** before clicking (rather than
clicking immediately and silently no-op-ing), and reports clearly if it stays
disabled. Also fires keyboard events alongside the typed team-name filter for
comboboxes that only open/filter on keydown.

## [v3.131.0] — 2026-06-21

### One-click "send to routine prescriptions" button (prescribing window)

A floating action button on the prescription-request task overview that
re-assigns the task to a configured team (default "Prescribing / Meds
Management") in one click. It **drives the real Medicus UI** — clicking the
same `Save & re-assign to someone else` → `Assign to` → team → `Re-assign task`
controls a clinician would — so Medicus's own validation, access control and
audit trail fire exactly as for a manual re-assignment. It makes **no network
calls** and reads **no patient-data values**.

- **Configurable + remembers last choice:** an inline ▾ menu switches team,
  adds a team, and sets the commit behaviour; the last team and mode are
  remembered. Stored under `triagelens.routineRx` (included in suite backups
  via `triage-io.js`).
- **Commit gate (default safe):** `confirm` (default) names the destination
  team and asks before committing; `manual` pre-fills and highlights
  `Re-assign task` for the clinician to click; `auto` is opt-in.
- **Safety:** matches controls **only by visible text** (every id on this
  screen is generated per session) and **aborts, clicking nothing further, if
  any step's control is not found**. New hazard **H-035** logged.

This is the suite's first control that can *commit* a workflow action rather
than only display or pre-tick; see `docs/HAZARD-LOG.md` H-035.

## [v3.128.2] — 2026-06-21

### Road to 10 — Phase 2 cont: pill convergence (Vogue 8.3 -> )

Vogue re-scored the Phase 1 + Today recomposition build at 8.3/10 — past the
flagship threshold. Continuing Phase 2: the triage demand strip pills now adopt
the canonical capsule grammar (sans label + mono count) so the same counts no
longer read in two different languages between the top strip and the Triage Load
card. Held by design: the strip threshold wash (red/amber when the waiting room/
demand crosses its limit) is the clinical/demand alert and is NOT dimmed; the
Condor workload mini-charts use the doctrine-sanctioned --cat-* data-viz ramp and
are left on-doctrine.

## [v3.128.1] — 2026-06-21

### Road to 10 — Phase 2 (Vogue map): Today is a composition

The marquee structural move: Today was six near-identical bordered cards of equal
weight (an arrangement). Now only the Waiting Room hero is a distinct elevated
card; Triage Load / Demand / Slots / Morning Sweep / Recent Alerts shed their
border, shadow and header fill and read as quiet hairline-separated sections
beneath it. One hero plus a calm supporting stack, light and dark. Verified the
clinical red on the hero holds full salience.

## [v3.128.0] — 2026-06-21

### Road to 10 — Phase 1 (Vogue map): "stop shouting"

Pure subtraction, the highest-leverage cheap wins toward the 10/10 target
(docs/appraisal/VOGUE-MAP-TO-10-2026-06-21.md). Both panels flagged buttons as the
#1 remaining tell.

- **Action buttons recast to sentence-case sans** (21 classes: Choose tabs,
  Expand, Dismiss, Copy figures, Open full report, Run the pre-clinic sweep, the
  date/period presets, sentinel/capacity/slots/submissions buttons). Mono stays on
  data, nav and status. The last shouting register is gone.
- **Accent palette culled.** The triage pills (Today card + top strip) dropped
  their decorative amber/blue tint — new-vs-reply is already in the label — so
  amber/blue stay reserved for real clinical/capacity signals. Today now carries
  clinical red + neutral only.
- **"Open to" demoted to a single quiet chevron** on the six Today cards (was six
  repeated standing labels).
- **Truncated setup banner fixed** — reads "Practice code set" cleanly.

Suite 113/113; lint and format clean.

## [v3.127.3] — 2026-06-21

### Craft tail — spinner rollout + reticle empty-state glyph

- Rolled the reticle-geometry spinner into the Condor loading state (joins
  Today).
- Added a monochrome reticle glyph (the brand mark's geometry — ring, cardinal
  ticks, centre dot — faint, no brand cyan) to the Record state cards, seeding
  the reticle motif in the empty-state chrome. Suite 113/113.

## [v3.127.2] — 2026-06-21

### Signature motion + brand-motif seed

- **Overlay entrance motion.** The display, all-tabs and help popovers and the
  command palette now ease in on open (a 130ms fade + rise, `prefers-reduced-
  motion` guarded). Motion is deliberately **interaction-driven only** — never on
  a data poll, since modules re-render on poll and animating their content would
  twitch every few seconds. With the Condor index-meter fill (v3.127.1), the
  suite now has one consistent, restrained motion language.
- **Reticle-geometry spinner.** Added a shared `.ch-spinner` — a ring with one
  accent arc, echoing the brand mark's rangefinder ring — and wired it into the
  Today loading state via `::before` (no markup change). The first step of
  propagating the reticle motif into the chrome.

Remaining craft tail: roll the spinner out to the other modules' loading states
and add a reticle-derived empty-state glyph. Suite 113/113; lint and format clean.

## [v3.127.1] — 2026-06-21

### Craft pass — owned gauge, pill convergence, type-recast tail

Three road-to-10 craft items, done in parallel:

- **Condor Practice Pressure — owned data-viz (replaces the stock half-doughnut).**
  Vogue flagged the gauge as the one component that "looks bought, not made". It
  is now a horizontal 0–100 **index meter** with the GREEN/AMBER/RED band
  thresholds marked at 40 and 70, so a low index that is floored to AMBER by
  capacity reads truthfully — you see the fill sit left of the amber tick. Also
  resolves the daily-driver confusion (a bare "23" on a doughnut). The fill eases
  in with a single motion beat (`prefers-reduced-motion` guarded) — the suite's
  first signature motion.
- **Pill convergence — the two triage styles unified.** The "Triage:" strip and
  the "Triage Load" card showed the same counts in two different pill styles
  (sentence-case vs mono-caps). The card pill label is now the same sentence-case
  sans + mono-count as the strip. One representation, not two.
- **Type-recast residual tail.** Converted the chart titles (`submissions
  .chart-hdr`), the record card headers (`record .rec-card-h`) and the options-
  page section/field labels to sentence-case sans, finishing the v3.127.0 recast.
  Buttons, tags, badges, status tokens, axis labels and empty/loading states
  correctly stay mono.

Suite 113/113; lint and format clean. Remaining road-to-10 craft: broader motion
(number settles, strip easing) and propagating the reticle motif into the chrome.

## [v3.127.0] — 2026-06-21

### Type-system recast — headers in sans, data in mono (hybrid, doctrine #4 revised)

Acting on the Vogue design-house critique ("all-caps monospace doing all the
work reads as terminal cosplay, not authored") via the hybrid option: the dual
voice stays, but what each voice owns has moved. **Section headers and card
labels are now sentence-case sans** (hierarchy by size/weight, not uppercase
letter-spacing); **mono is pulled back to data** (counts, times, indices, dates,
codes, version, freshness), the **nav rail**, and **status micro-tokens** (the
`AMBER` band, kbd hints). This is the deepest "premium/authored" lever from the
road-to-10 review.

- Canon updated: `DOCTRINE.md` principle #4 and `TOKENS.md` typography +
  Section-header recipe rewritten to the recast.
- Converted the shared `.mod-eyebrow` (flips every module eyebrow at once) plus
  the section-header / card-label classes across Today, Condor, Slots, Sentinel,
  Submissions, Activity, Referrals, Reception, Trends, Capacity, Knowledge and
  Sweep. Buttons, tags, counts, the status bands and the nav stay mono.
- Verified on the hero surfaces (light + dark) and the data-bearing modules.
- Known residual (next polish pass): a few module-specific chart titles and axis
  labels still render mono-caps; options pages not yet recast.

Suite 113/113; lint and format clean.

## [v3.126.7] — 2026-06-21

### Road-to-10 review fixes (Practice + Vogue panels)

Ran two panels on the v3.126.6 renders — The Practice (usability, mean ≈7.1/10,
up from 5.7) and Vogue (design house, ~6.5/10 craft, "not yet a £200m look").
Both named the same two free wins, fixed here:

- **Clipped "TODA" nav label** — the in-nav wordmark crowded the tab rail in the
  400px panel, truncating the active tab. Dropped the redundant in-chrome
  wordmark (the new reticle mark carries the brand; the full wordmark still
  appears in About / Options / the visualiser); the active tab now reads "TODAY"
  in full with "SLOTS" beside it. Also tightened the tab-rail overflow fade from
  8% to 3% so it can never eat a label character.
- **"v0.5.1" on the Monitoring header** — a literal "pre-release" signal on a
  clinical tab. Removed.

The full road-to-10 synthesis (both ladders, and the pivotal type-system call
for Dave) is in `docs/appraisal/ROAD-TO-10-2026-06-21.md`.

## [v3.126.6] — 2026-06-21

### Design-house G5 (legibility floor) + G4 (component convergence)

**G5 — contrast floor, not a size bump.** The doctrine permits mono labels at
9–11px, so the real floor issue is faint greys carrying load-bearing text. Fixed
the four sub-floor 8px labels (submissions metric-delta / legend-note, setup
recommended badge) up to the 9px floor, and lifted the faintest tier `--text-5`
in both themes (light `#6c7c91`→`#5f6f85`, dark `#5d7a9d`→`#6c89ac`) — only ever
raising contrast. Synced the stale `TOKENS.md` text-4/5 row to the live values.

**G4 — pills were already substantially converged.** Audit found the canonical
`.pill` migration has largely happened: `slot-pill` matches the recipe exactly,
and `condor-pill` / `today-name-chip` already use `--r-pill`. Aligned the two
real outliers — the AM/PM chips took the pill radius (was squared `--r-sm`), and
the suite's tightest pill (`condor-pill`) was nudged to the family vertical
rhythm. No class renames (per TOKENS.md "do not mass-rename in one pass").

This closes the in-house design-house items; G1/G2/G3 shipped in v3.126.3–.5.
The remaining gap, G1's brand mini-guide aside, is none — the appraisal's
foundations were already strong.

## [v3.126.5] — 2026-06-21

### Design-house G1 — brand identity refresh (precision-instrument mark)

The placeholder identity (a generic gold guardian shield) was the design-house
appraisal's headline gap for the £200m bar (G1). New mark: a gold **precision
reticle** — rangefinder/avionics sight (outer ring, four cardinal index ticks,
inner ring) — on the deep-navy instrument bezel, with the cyan **live-lock
beacon** kept at the crosshair centre as the recurring focal element. It reads as
the clinical instrument the suite actually is (the doctrine's flight-deck /
rangefinder register, and the "Sentinel" that watches), and recomposes the
existing navy/gold/cyan equity rather than discarding it.

- Vector is now the source of truth: `brand/app-icon-master.svg` (512) +
  `brand/app-icon-16.svg` (simplified favicon). `generate-icons.mjs` renders
  `brand/app-icon.png` and `icons/icon-16/48/128.png` from the SVGs (via sharp).
- The mark updates everywhere it appears automatically (nav, pop-out, options,
  about, visualiser drop, README, extension icons). The 16px nav logos point to
  the crisp simplified favicon rather than downscaling the detailed master.
- Signature element: the cyan live-lock dot recurs across brand surfaces but is
  deliberately kept **out of the clinical chrome** — the UI reserves colour for
  clinical status, so the brand cyan is never mistaken for a signal. Brand guide
  refreshed (`brand/BRAND.md`).

Remaining design-house items: G4 component convergence, G5 legibility floor.

## [v3.126.4] — 2026-06-21

### Design-house Phase 2 (G3 — one hero per tab: Today)

Today was a flat stack of six equal cards with no focal point (design-house gap
G3). The live Waiting Room card now floats forward as the page's hero — stronger
elevation and border, a louder header label, and a larger headline count — while
the Triage Load / Demand / Slots / Sweep / Alerts cards rest as a calm supporting
stack. Hierarchy is carried by weight and space, not colour: the hero is
deliberately neutral so it never reads as an alert (the urgency tint on the
waiting count remains a separate, real wait-time signal and is untouched).
Verified in light and dark. Remaining design-house items: G1 identity sprint
(needs a brand brief), G4 component convergence, G5 legibility floor.

## [v3.126.3] — 2026-06-21

### Design-house Phase 2 (chrome economy) + Sentinel rule refresh

**Design (G2 — "calm field, sharp signal" restored).** The two permanent demand
strips no longer wear an always-on wash: the waiting-room strip's
below-threshold state and the triage strip's base now rest on neutral chrome
(`--bg-mid` / `--border`) instead of a standing green / accent tint. The
amber/red threshold states are untouched, so a crossed threshold now stands out
against a calm field rather than competing with a permanent colour wash. This is
the highest-leverage item from the design-house appraisal
(`docs/appraisal/DESIGN-HOUSE-2026-06-21.md`, gap G2); the larger items (one
hero per tab G3, component convergence G4, legibility floor G5, and the identity
sprint G1) remain queued.

**Sentinel rules (The Keeper — additive only, no interval/match change).** Acted
on the safe, additive findings from `docs/appraisal/KEEPER-sentinel-2026-06-21.md`:
- `glp1-receptor-agonist`: added the MHRA DSU 29 Jan 2026 strengthened
  acute-pancreatitis warning (necrotising/fatal) to notes + source.
- DMARDs (methotrexate, leflunomide, azathioprine, sulfasalazine,
  hydroxychloroquine): refreshed the source citation to the 2025 BSR csDMARD
  guideline (Rheumatology, Nov 2025). No monitoring interval changed.
- `chc-combined-hormonal`: noted the MHRA tirzepatide → reduced
  oral-contraceptive absorption interaction.

All corroborated across secondary summaries; primary PDFs were unreachable (403)
this run, so each is annotated "pending primary-source confirmation". **Held, not
changed:** the QOF DM036 age-band discrepancy (file ≤70 vs one secondary source
≤79) — a clinical threshold that could cause a silent chip change either way, so
it waits for the primary QOF PDF. Coverage guard 314/314, full suite 113/113.

## [v3.126.2] — 2026-06-21

### Slots + Sentinel re-appraisal follow-through (panel, 2026-06-21)

Re-ran the Practice panel on Slots and Sentinel after v3.126.1. Two convergent
findings acted on; UX only, no clinical-rule or alert-salience change.

- **Sentinel waiting-room minutes no longer mimic an overdue alert (G2, root
  cause).** v3.126.1 reframed the block's container bar to the informational
  accent, but four domain personas (nurse, pharmacist, partner, GP) reported the
  per-row wait-time minutes were still clinical red/amber and read as
  "overdue/act now" — risking a tired clinician mistaking the idle waiting list
  for a fired monitoring alert. The minutes now carry their emphasis by weight
  and a muted neutral tone; within the Monitoring tab, red is reserved for a
  genuine overdue monitoring check. The wait-time ordering and the "not a
  monitoring result" caption are unchanged.
- **Slots headline says what the number is, and as-at when (R1/R2 parity).** The
  hero label now reads "free slots remaining today" (was "slots remaining
  today") so the count is unambiguously bookable capacity, and a muted
  "practice-wide · as at HH:MM" line was added so a manager can quote a
  defensible point-in-time figure — matching the as-at clock added to Condor in
  v3.126.1.

## [v3.126.1] — 2026-06-21

### Practice appraisal quick wins (whole-suite panel, 2026-06-21)

Acted on the verified, low-risk findings from the whole-suite Practice appraisal
(`docs/appraisal/PRACTICE-whole-suite-2026-06-21.md`). UX/accessibility only; no
clinical-rule or alert-salience changes.

- **Setup banner no longer reads as a warning (U1).** The collapsed setup strip
  said `Setup: practice code ready · …` which truncated to "…code re…" in the
  400px panel and read like "re-check / required" — the opposite of its meaning.
  It now leads with `Practice code set · …` (unambiguous even when truncated) and
  carries the full text as a `title`.
- **Header icons named for assistive tech (U2).** Added `aria-label`s to the
  command-palette, display, pop-out and settings buttons (previously `title`
  only), and named the palette's tab-count badge so the bare "15" can't be
  mistaken for an unread count. Mirrored in the pop-out shell.
- **Condor demand figure now reconciles (R1).** The headline strip labels the
  figure `Demand N (med + admin)` so it no longer reads as a contradiction
  against the all-task-types velocity total. Confirmed against `condor.js`
  (`demandCount = medical + admin`).
- **Condor shows a defensible cut-off clock (R2).** Added an explicit
  `as at HH:MM` next to the live-freshness label, for a figure a manager quotes
  to partners.
- **Sentinel waiting-room block no longer mimics a clinical alert (G2).** The
  block is the waiting room, not a monitoring result, yet still wore an amber
  alert left-bar that three domain personas read as "overdue". Reframed to the
  informational accent; the per-row wait-time escalation (a duration signal) is
  unchanged, as is the disambiguating caption.

The capacity safety floor (band raised to AMBER when over capacity, never GREEN)
and the gauge arc colour were left unchanged — verified already correct, and the
floor is an alert signal that must not be recommended down.

## [v3.126.0] — 2026-06-20

### Keeper follow-ups — four parallel work items (scoped by virtual-dave)

Consolidated batch of the four open follow-ups from the Phase-1/Phase-2 rules-engine work,
developed in parallel on isolated branches and integration-tested together (full suite
112/112).

- **`intervalByBand` engine capability** (`engine/rules-engine.js`, new
  `resolveEffectiveInterval`) — optional, value-banded monitoring intervals with a hard
  **escalate-only / shortest-wins / monotonic** invariant asserted in code
  (`effectiveInterval <= baseline` always) and a 5000-iteration property test. Missing /
  unparseable / unit-conflicting / stale band-input falls back to the baseline, never longer,
  never suppressed. **DOAC is deliberately NOT wired** — it must band on CrCl (Cockcroft-Gault),
  not eGFR, and the inputs (structured dated weight; numeric serum creatinine) aren't reliably
  available; deferral recorded in `docs/HAZARD-LOG.md`.
- **CHC monitoring rule enabled** (`rules/drug-rules.json`) — `chc-combined-hormonal` flipped to
  enabled after disambiguating the `hrt-systemic` overlap by excluding `ethinylestradiol`/
  `qlaira`/`zoely` from the HRT rule (HRT never uses ethinylestradiol). New
  `test-contraception-hrt-disambiguation.js` pins the no-double-fire invariant; HRT brand
  coverage confirmed intact.
- **levomepromazine / methotrimeprazine / Nozinan added to the ACB scale at score 3**
  (`engine/acb-scores.js`) — the score-3 gap the Keeper verification surfaced (it had been
  mis-proposed at score 2 and killed).
- **Primary-source reconfirmation status** recorded in
  `the-keeper-source-reconfirmation-2026-06-20.md` for the Phase-2 clinical changes.

## [v3.125.0] — 2026-06-20

### Fix: urine electrolytes no longer matches a blood U&E request

Reported false positive: a **urine electrolytes** report (urine
sodium/potassium/urea/creatinine, or a "Urine electrolytes" specimen group) was
matching outstanding **blood U&E** requests on the Outstanding Investigation
Requests card — because it shares every U&E analyte name and the word
"electrolyte". With auto-tick on, that could wrongly clear a genuinely-outstanding
blood U&E (a patient-safety risk this feature exists to prevent).

`engine/outstanding-match.js` gains a generic, fail-safe `exclude` mechanism on a
test definition: an exclude-term hit disqualifies that panel for the text in hand
(it only ever makes the matcher *more* cautious — a disqualified request stays
outstanding, never cleared). The built-in U&E def now carries
`exclude: ['urine', 'urinary']`; a blood U&E never contains those words, so the
legitimate match is untouched. Applied across `resolveDef`, the report
analyte-signature, and the patient-history enrichment. New regression tests in
`test-outstanding-match.js` cover both the urine-vs-blood false positive and the
genuine blood-U&E happy path.

### New shipped result rules (from Dr Grundy's result-matching set)

Twelve practice-authored result-interpretation rules are promoted to shipped
built-ins so every install gets them (defaults `version` 19 → 20):

- **Text (review-unless-normal):** Ultrasound, Histology, H. pylori, STI NAAT
  (chlamydia/gonorrhoea), Stool MC&S, Vaginal thrush (genital swab), Wound swab,
  Ear swab, EBV serology.
- **Threshold:** FIB-4 elevated (amber ≥1.3, red ≥2.67), Low ferritin
  (amber <60, red <15 µg/L), Low B12 (amber <180, red <110 ng/L).

Each was validated against `engine/result-rules.js` and given a stable `base-*`
id + `builtin: true` so the resultRules migration actually propagates it. Derived
defaults copies regenerated and the config-lock refreshed.

> **Not shipped (left for clinical review):** the contributor's *LDL ≥2 → red*
> rule (cohort/secondary-prevention specific — too noisy as a global default), the
> *DEXA* rule (uses inverted normalText/label semantics), and the *Throat – strep*
> and *sterile pyuria* rules (already covered by existing built-ins
> `base-throat-swab` / `base-urine-sterile-pyuria`).

## [v3.124.0] — 2026-06-20

### Sentinel clinical-content expansion via The Keeper (Phase 2 — CSO change-proposal)

Phase-2 of the multi-agent rules-engine review, run through The Keeper (scan → verify →
conservative apply). Every change is sourced and was independently verified; clinical content
is a **CSO change-proposal**, not auto-merged. Full report:
`the-keeper-report-2026-06-20.md`. Source note: BNF/SPS/MHRA/emc/FSRH/ACBcalc primary pages
returned HTTP 403 this run, so changes are corroborated across multiple NHS ICB / regulatory
secondary sources and flagged "pending primary-source confirmation".

- **Three drug–drug-interaction alerts** added to `rules/alert-library.json` (alert-library
  `version` 1.2 → 1.3):
  - `pincer-mtx-trimethoprim` (🔴 red) — methotrexate + trimethoprim/co-trimoxazole, severe/fatal
    bone-marrow suppression (a named never-event). Relies on the Phase-1 combo-normaliser fix so
    the hyphenated `co-trimoxazole` matches.
  - `alert-xoi-thiopurine-myelosuppression` (🔴 red) — allopurinol/febuxostat +
    azathioprine/mercaptopurine, life-threatening myelosuppression. Brand terms
    (`zyloric`/`adenuric`/`xaluprine`) listed explicitly so brand-only records still fire.
  - `mhra-acei-arb-ksparing-hyperkalaemia` (🟠 amber) — ACEi/ARB + potassium-sparing diuretic.
    Deliberately amber, not red: spironolactone + ACEi is guideline-endorsed four-pillar heart-
    failure therapy, so a red would misfire across the HF register.
- **ACB scale** (`engine/acb-scores.js`): four verified score-2 additions — carbamazepine,
  oxcarbazepine, amantadine, pethidine (these also feed STOPP anticholinergic-elderly). Five
  candidates were **killed in verification**: cyclobenzaprine/loxapine (not UK primary-care),
  cimetidine/baclofen (score conflict 1-vs-2), and levomepromazine (actually score 3, not 2 —
  adding it at 2 would have *under*-scored it). `amantadine` removed from the term-coverage
  snapshot's "deliberately dropped (scores 0)" audit list, as it is now genuinely on the scale.
- **DOAC monitoring notes** corrected in `rules/drug-rules.json` to specify **CrCl
  (Cockcroft-Gault), not eGFR** (eGFR overestimates clearance and raises bleeding risk), with the
  renal/age-banded cadence documented. The 365-day default is unchanged — value-banded intervals
  need an engine extension (flagged).
- **Contraception monitoring** added to `rules/drug-rules.json`: `dmpa-injectable` (enabled —
  Depo-Provera/Sayana Press, 2-yearly BP+weight, FSRH). `chc-combined-hormonal` is shipped
  **disabled** pending engine work: the `hrt-systemic` rule matches the bare term `estradiol`,
  a substring of `ethinylestradiol`, so an enabled CHC rule would double-fire the HRT rule —
  enabling needs engine-level drug-class disambiguation.
- Regression tests extended: `test-alert-library-coverage.js` (3 new combos + firing checks),
  `test-acb-scores.js` (4 drugs + collision guards), `test-drug-brand-coverage.js` (DMPA).

## [v3.123.0] — 2026-06-20

### Sentinel rules engine — safety, provenance & efficiency hardening (Phase 1)

Outcome of a multi-agent review of the investigations & safety-monitoring rules engine.
Six low-risk, no-clinical-sign-off-needed changes; clinical-content expansion (drug–drug
interaction checks, ACB score-2 tier, renal-adjusted DOAC intervals, contraception) is
deliberately deferred to a Keeper run with primary-source verification + CSO review.

- **Drug-combo matching silent-miss fixed.** `evaluateDrugComboRule` used a bare
  `.toLowerCase()` while single-drug matching folds `-`/`_` to spaces via
  `normaliseDrugString`. The two paths disagreed on any hyphen-vs-space mismatch, so a
  hyphenated interaction drug (`co-trimoxazole`, `co-amilofruse`, …) could match its
  single-drug monitoring rule but **silently never fire a drug-combo interaction alert**.
  Both paths now share one normaliser. New `test-drug-combo-agreement.js` pins single ≡
  combo matching (incl. the hyphen↔space cases that fail pre-fix). This is the hard gate
  for any future interaction rules.
- **alert-library.json clinical content is now content-tested.** New
  `test-alert-library-coverage.js` pins type, severity, monitoring intervals, drug-set
  membership and the safety-critical demographic gates for all 23 entries (13 PINCER, MHRA
  valproate/isotretinoin PPP, NICE lithium, QTc, recurrent-UTI/falls, rising-PSA), and
  fires the highest-stakes combos through the real engine. Previously these had schema +
  currency-date checks only — a severity downgrade or interval change would have passed
  every test.
- **Unit-safety guard on threshold/alert assertions.** Before asserting a "high"/"low"
  fact, the observation's unit is checked against the rule's expected unit; a recognised,
  genuinely-different unit (e.g. potassium mmol/L vs an eGFR mL/min value) now abstains
  instead of asserting a wrong-direction alert. Fail-open: an absent/unknown unit still
  fires, so a real alert is never suppressed by a unit we don't recognise.
- **STATUS_RANK drift fixed and pinned.** `sentinel-core.js` was missing the `vax_*`
  keys the engine emits, so a due vaccine ranked 99 (un-prioritised) on the panel and its
  "Offer to book" instruction was dead code. Added the keys (parity with the sweep surface)
  and added `test-status-rank-sync.js` pinning the engine and sentinel-core rank tables to
  deep-equality so future drift fails CI.
- **Sentinel now consumes the shared provenance caveat canon.** The primary monitoring
  surface previously re-hand-wrote its caveats; it now uses `shared/provenance.js`. The
  green "checked & clear" audit headline carries the canonical *live-snapshot, verify
  before acting* caveat, and the empty/all-clear states carry *no alert ≠ monitoring
  complete* — closing the over-claim on the highest-confidence (in-date) surfaces.
- **Record-pipeline evaluation memo (`engine/eval-cache.js`).** The record HUD re-ran the
  full `evaluatePatient` (O(rules × observations)) on every render. It now memoises the
  evaluation keyed on a content hash of the **freshly-fetched** data — so the redundant
  re-evaluation is skipped when nothing changed, but the fetch stays fresh and the hash is
  self-invalidating (any changed med/observation/problem/rule/day busts it). The memo can
  never serve a stale all-clear; `test-eval-cache.js` proves the invalidation, not just the
  hit-rate.
## [v3.122.2] — 2026-06-20

### Fix: long OIR test names pushed the Edit/× buttons off the panel

Reported by a user: in the **Outstanding Requests** test-dictionary editor, an
auto-generated custom-test row with a long, unbreakable key (e.g.
`hum_papill_vir_dna_dtctn_assay`) or a long term summary stretched the row's text
column past the panel edge, shoving the **Edit** and **×** action buttons out of
view and out of reach.

Two layout fixes in `content-scripts/triage-lens/options.css` /
`content-scripts/triage-lens/options.js`:

- `.tl-rule-row > *` now gets `min-width: 0` and the label/meta wrap with
  `overflow-wrap: anywhere`, so an unbreakable token wraps instead of forcing the
  flexible text track wider than the panel (the default grid `min-width: auto` was
  the root cause).
- OIR rows now use a dedicated compact 4-column grid (`.tl-rule-row-oir`) instead of
  the shared 6-column rules grid, dropping the two empty "patterns/actions count"
  columns whose reserved width compounded the overflow on a narrow panel.

## [v3.122.1] — 2026-06-19

### Surface the Outstanding Requests settings in Suite Settings

v3.122.0 added the **Outstanding requests** editor as a tab in the Triage Lens options page,
but the suite's main Settings page never embedded it — so the test dictionary editor, the
behaviour toggles and the audit trail were unreachable for anyone who only opens Settings
(i.e. everyone). This adds a dedicated **Outstanding Requests** section to Suite Settings
that deep-links into that editor (`#oir`), mirroring the existing **Result Rules** section:
the embedded view opens straight onto the OIR tab with the sibling tab bar hidden so it reads
as its own page. To avoid two editing surfaces for the same `CONFIG`, the OIR tab is hidden
from the embedded **Triage Lens** view (same treatment Result rules already had).

## [v3.122.0] — 2026-06-19

### Outstanding Investigation Requests — make it yours (customisation pass)

The resulted-elsewhere matcher was zero-config. This pass opens it up, behind a new
**Outstanding requests** tab in Triage Lens settings, while keeping every clinical-safety
invariant load-bearing (results found elsewhere are still NEVER auto-ticked; the bulk
tick-off keeps its irreversible-write confirm gate). Settings live in `triagelens.config`,
so they back up and ride the practice-profile "triage" module automatically — a practice
admin can publish a baseline and individual clinicians keep their personal overrides.

**User-editable test dictionary.** The matcher's panel definitions (`TEST_DEFS`) used to be
hard-coded — the exact reason FSH/LH were missed (v3.121.1). A practice can now, without a
code change:
- **add a new custom test** (e.g. Vitamin D, HbA1c) with its own request/report/analyte terms;
- **extend a built-in** with a local lab's synonym (e.g. "Renal Screen" → U&E) — append-only,
  so a built-in's coverage can only grow;
- **disable a built-in** (fail-safe: its requests simply stay outstanding, never wrongly cleared).
Safety is enforced in the engine merge, not the editor: user terms are only ever appended,
and a user entry can never flip a built-in panel to `singleAnalyte` (which would lower the
auto-tick threshold).

**Safety/comfort knobs.**
- **Advisory-only mode** — turn off the one-click bulk tick-off entirely; keep the inline
  flags but let the suite never initiate a write to Medicus.
- **Confidence floor: strict** — only a lab-assigned panel/group name counts as confident;
  nothing auto-ticks on an inferred analyte signature.
- **Look-back ceiling** — only treat a record result as satisfying a request if it was filed
  within N months of it (a result years later is a different episode).

**Display.**
- **Show value on flag** — surface the matched result inline (e.g. `↩ completed 16 Jun 2026 · 18 ug/L LOW · in record`).
- **Relative dates** — "3 months ago" instead of an absolute date, if preferred.

**Governance.** A local **audit trail** records every bulk tick-off (timestamp, count, the
matched results) for review in the settings tab; it is machine-local and deliberately not
backed up (`triagelens.oir.auditLog`, allowlisted).

Engine: `matchOutstanding` / `enrichWithHistory` / `reportCoverage` now accept
`opts.testDefs` / `confidenceFloor` / `lookbackMonths`; new exported `mergeTestDefs`,
`validateTestDef`, `addMonths`. `defaults.json` v18 → v19 (new flat `oir*` prefs + empty
`oirTests`). Matcher tests 49 → 76 assertions; full suite green.

## [v3.121.1] — 2026-06-19

### OIR matcher — recognise the reproductive / sex-hormone profile

Live feedback: on a real card, **Follicle Stimulating Hormone** stayed `⏳ outstanding`
while every other request was correctly flagged "in record". Root cause was the
matcher's test dictionary (`TEST_DEFS` in `engine/outstanding-match.js`): FSH and LH
were not listed, so the request name resolved to no key, was treated as "not
recognised", and was therefore invisible to both report-matching and
resulted-elsewhere detection. (A missing test is fail-safe — it stays outstanding,
never wrongly cleared — but it also never gets the helpful flag.)

Added the common reproductive / sex-hormone tests as single-analyte definitions, with
both UK and US spellings since labs vary:

- **FSH** (Follicle Stimulating Hormone)
- **LH** (Luteinising / Luteinizing Hormone)
- **Oestradiol** (Estradiol)
- **Prolactin**
- **Testosterone**

Added as a family rather than just the two Nick flagged, since these are co-requested
on a fertility / amenorrhoea / menopause work-up and would otherwise be the next gap.
`test-outstanding-match.js` gains section 9 (11 new assertions): every request resolves
to a key, US spellings resolve, an FSH report ticks only the FSH request, and an
FSH result found in observation history surfaces as `resulted_elsewhere` (never
auto-ticked). 60 matcher assertions, 106 suite tests pass.

> This is exactly the hard-coded-dictionary gap the planned **user-editable test
> dictionary** removes — a practice could add its local lab's panel names without a
> code change. Shipping FSH/LH in the built-in set now; the editor is the durable fix.

## [v3.121.0] — 2026-06-19

### Outstanding Investigation Requests — per-row flags + one gated bulk tick-off

Reworks the v3.119.0/v3.120.0 "resulted elsewhere" surface after live feedback on
the real Medicus card. Two problems were visible on the page:

- **Placement bug (now fixed):** every row's badge was appended to the *shared*
  list container and de-duped card-wide, so only one badge element ever existed.
  Each row overwrote it in turn, leaving a single mystery badge collapsed at the
  bottom of the card (showing the last row's verdict) instead of one flag per row.
  Badges are now anchored to **each row's own label element** and de-duped by row
  index, so every applicable row is flagged in place.

- **Per-row "Tick off" replaced by one bulk action.** Instead of a per-row button,
  the card now shows a single **"Tick off N results found in record"** bar under
  the list. Its confirm dialog **enumerates every result** (test, completion date,
  value, and any shared-request note) so the clinician reviews the full list once,
  then confirms. Only **confident** finds are eligible for the one-click action;
  tentative finds are flagged inline and ticked manually if verified. The hard
  "writes to Medicus server-side, cannot be undone from here" gate is retained.

- **Clearer wording** to match the clinician's framing: results found in the record
  but not in this report read **"↩ completed DD Mon YYYY · in record"** (confident)
  or **"↩? possible result DD Mon YYYY · in record"** (tentative); report-covered
  rows keep **"✓ resulted (this report)"**.

- **Removed the per-row "Mark reviewed" affordance** (and its
  `triagelens.oir.reviewed` storage) introduced in v3.120.0, to keep the card
  clean. To restore it, revert the v3.120.0 item-9 block in `content.js` and
  re-add the storage allowlist entry.

## [v3.120.0] — 2026-06-19

### Outstanding Investigation Requests — "resulted elsewhere" UX pass

Acts on a synthetic in-practice appraisal of the v3.119.0 feature (panel of six
roles, technophobe through pharmacist; report in
`docs/appraisal/PRACTICE-oir-elsewhere-2026-06-19.md`). The appraisal is a
heuristic, not real user testing. It surfaced one universal complaint —
"*elsewhere* invites trust it hasn't earned": the badge showed neither the
result date (tooltip-only), the source, nor the actual value, so a clinician was
asked to clear a request on one word. This pass closes that gap.

- **Date is now on the badge, not just the tooltip.** `↩ elsewhere · Result:
  02 Apr 2026` (confident) / `↩? elsewhere? · 02 Apr 2026` (tentative). The
  report-covered green badge now reads `✓ resulted (this report)` so it can't be
  misread as work done by a previous user.

- **Confirm dialog now grounds the decision.** It states the **source** ("the
  patient's observation history / Medicus lab record"), the **actual most-recent
  result** where available (`ALT 28 U/L (HIGH) on 02 Apr 2026`), and — when two
  or more outstanding requests resolve to the same observation — a note that the
  result also satisfies *N* other requests. The write-through is now explicit:
  ticking off **writes to Medicus server-side and cannot be undone from here.**

- **Engine surfaces the matched observation.** `enrichWithHistory` now returns
  `matchedAnalytes`, `matchedValue`, `matchedUnit`, `matchedObsName` and
  `matchedAbnormal` on each `resulted_elsewhere` verdict, and the **tentative
  reason** now names the matched analyte(s) and panel instead of a generic
  phrase. Classification and the `autoTick: false` invariant are unchanged.

- **Clickable badge → patient record.** A `resulted_elsewhere` badge opens the
  patient's care record (`/care-record/{uuid}`) in a new tab so the clinician can
  read the underlying result. (No per-observation deep link exists in the API,
  so the care record is the closest achievable target.)

- **"Mark reviewed" for genuinely-outstanding rows.** Rows that stay
  `⏳ outstanding` gain a local **Mark reviewed** affordance (`⏳ outstanding ·
  reviewed ✓`), persisted per task in `chrome.storage.local`
  (`triagelens.oir.reviewed`) so a clinician can record "seen, chasing" without
  ticking anything off in Medicus. It writes nothing to Medicus and is not part
  of suite backup (a live-task workflow flag, mirroring the `triagelens.config`
  precedent).

- **Fixes** carried in the same pass: the `.ch-oir-tickoff` / `.ch-oir-reviewed-btn`
  buttons are added to the `hud.css` design-token scope (they are siblings of
  `.ch-oir-flag`, so without this they rendered unstyled — the rule-5
  white-rectangle trap).

## [v3.119.0] — 2026-06-19

### Outstanding Investigation Requests — detect requests resulted *elsewhere*

Builds on v3.118.0's smart matching. The current report only ever covers one
test/panel, so everything else on the Outstanding Investigation Requests card
stayed flagged `⏳ outstanding` — even when that test had *already been resulted*
elsewhere in the patient's record (a previous episode, a different report that
was never matched to the request). This surfaces those, so the clinician can
clear them deliberately rather than chasing tests that are already back.

- **New engine pass `enrichWithHistory(verdicts, observationHistory)`** (pure,
  unit-tested): for each request still `outstanding` after report matching, it
  checks the patient's full observation history (`normaliseObservationHistory`)
  for a matching result dated **on or after the request date**. A hit reclassifies
  the row to a new status `resulted_elsewhere`. Confidence reuses the same
  signature rules — a lab **group-name** match (e.g. obs group "Liver function")
  or an analyte **signature** (≥2 distinctive analytes, or 1 for single-analyte
  tests like ferritin/PSA/FIT) is `confident`; a lone analyte of a multi-analyte
  panel is `tentative`. A history result that **predates** the request is ignored
  (it can't be the answer to a later request).

- **Never auto-ticked.** Unlike the current report's confident matches,
  `resulted_elsewhere` rows are surfaced only — `autoTick` is always `false`.
  The card renders an **↩ resulted elsewhere** badge (blue) and a **"Tick off"**
  button.

- **Safety gate on the manual tick.** Clicking "Tick off" opens a confirmation
  dialog naming the test and the most-recent result date, making clear that
  clearing the request is the clinician's decision and removes it from the
  outstanding list. Nothing is cleared without that explicit confirm — the
  button only ticks after **OK**, and removes itself once actioned.

- **Card adapter (`content.js`)**: fetches the patient's observation history
  (`resolveTaskToPatient` → `fetchAll` → `normaliseAll`) alongside the report,
  caches it per task, and re-applies on every Quasar re-render. History fetch is
  best-effort — failure leaves the v3.118.0 report-only behaviour intact.

## [v3.118.0] — 2026-06-19

### Smart matching for Outstanding Investigation Requests (advisory + auto-tick)

On a Review Investigation Report task, Medicus's native "Match all" button is
blunt — it matches the report to **every** outstanding request, clearing them
all, so a coeliac screen / HFE gene / CCP antibody buried in the list is silently
cleared even when this report says nothing about it (Dr Grundy's longstanding
ask). This adds a smarter, per-request decision instead.

- **New engine `engine/outstanding-match.js`** (pure, unit-tested): for each
  outstanding request it decides `resulted` vs `outstanding` — a request is only
  `resulted` when this report covers the **same test/panel** AND the request was
  made **on or before the sample-taken date** ("find all requests for that test
  where the request predates the sample taken time/date"). Matching is
  high-precision and fail-safe: a panel title/specimen-group match, or a
  distinctive-analyte **signature** (≥2 analytes of one panel, or 1 for
  single-analyte tests like ferritin/PSA/FIT) → **confident**; a lone distinctive
  analyte → **tentative**; anything unrecognised, post-dating, or missing a date
  stays `outstanding`. A false "resulted" would auto-clear a genuinely
  outstanding test, so the matcher errs toward leaving things outstanding.

- **Card adapter (`content.js` `runOutstandingMatch`)**: reads each request row
  (via `aria-labelledby`), fetches + normalises the report for the task, then
  annotates every row inline — **✓ resulted** / **✓? resulted?** (tentative) /
  **⏳ outstanding** — so what's genuinely still outstanding is visible at a
  glance. It then **auto-ticks only the confident, predating rows, once per task**
  (a manual untick is never re-ticked). Tentative/unrecognised/post-dating rows
  are never auto-ticked. Annotations are re-applied by a scoped observer across
  the card's Quasar re-renders.

- Verdict-badge styles added to `hud.css`; `engine/outstanding-match.js`
  registered in `manifest.json` content scripts. Regression-guarded by
  `test-outstanding-match.js` (21 assertions over the real captured card +
  report data).

## [v3.117.2] — 2026-06-19

### Results queue stacked chips — bare-flag "High"/"Low" suppression + label width fix

Two polish fixes for the stacked chip view in the investigation results queue:

- **Bare-flag review chip suppression.** When a more informative severity chip is already
  present (rule-named analyte or count), a `queue.resultReviewRule` chip whose label is
  just a bare flag word ("High", "Low", "H", "L") is suppressed. This covers the case
  where a custom text rule matches Medicus's internal result flag — the flag word adds no
  signal when the severity chip already names the analyte or rule. The chip is kept when
  it's the only signal (some information > none).

- **Chip label truncation fix.** In the stacked view (chips stacked under the patient
  name), the per-chip `max-width: 18ch` inline cap was still active, truncating long
  Triage Lens rule labels. Added a context-scoped CSS override so chips on their own
  stacked line use `max-width: 100%`. Also changed `justify-content: center` to
  `justify-content: flex-start` in the stacked column layout so the patient name always
  aligns to the top.

## [v3.117.1] — 2026-06-19

### Removed "Select All" button from Outstanding Investigation Requests

Removed the injected "Select All" button and confirm dialog from the Review Investigation Report detail page. Also removes the associated scoped MutationObserver and all related CSS.

## [v3.117.0] — 2026-06-18

### Results queue chips — de-duplicated rule labels + (new) stack under the name

Two changes to the investigation-results queue chips, both addressing the same
clinician feedback (the chip reads `{analyte} — {rule}`, which crowds the patient
name and double-prints the analyte).

- **Label de-duplication.** A result-rule chip used to always render
  `{analyte name} — {rule label}`. Since the Medicus queue already shows the
  analyte first, a rule the clinician named "B12 low" became **"B12 — B12 low"**.
  Now the chip de-duplicates: if the rule label already names the analyte (as a
  whole token, at the start or end), the chip shows the **rule label alone**
  ("B12 low", "Critical high potassium"); a bare label still gets the prefix
  ("Ferritin — low"). This lets a clinician name rules naturally without
  duplication and without resorting to globally-unique bare labels ("low1",
  "low2") — result-rule labels are free-form (rules are keyed by id, never label).
  Implemented as render-time logic in `selectResultChips`; the two shipped
  templates (`queue.resultRuleUrgent`, `queue.resultRuleAbnormal`) become `{label}`,
  with the old `{name} — {rule}` value added to `RETIRED_CHIP_LABELS` (content.js +
  options.js, lock-step) and `defaults.json` version bumped 17→18 so the change
  reaches existing installs.
- **Chips under the name (flat-queue).** When chips land in the patient-name cell
  (the cramped flat-queue case), they now stack on their **own line under the
  name** instead of sitting before it and eating horizontal width — done by making
  the cell a CSS column and ordering the (still-prepended) chip line after the
  name, scoped via `:has()` so the cell is only restyled when our chip is present.
  **Note:** this restyles a Medicus-owned AG-Grid cell and needs a live-grid smoke
  test (row-height clipping); the CSS block is self-contained and reversible.

## [v3.116.0] — 2026-06-17

### Added — Built-in result-chip flags are now obviously editable (and the rename sticks)

Clinicians can already rename **any** result-rule chip label in the Result Rules editor —
including built-in rules — and the rename persists across suite updates. That capability
was undiscoverable, so this surfaces it: when you open a **built-in** result rule for
editing, a hint under the Label field now states explicitly that you can rename/shorten
the flag (e.g. strip a redundant *"high"*) and that your edit is kept and will not be
reverted by a suite update.

- The persistence guarantee is structural, not new: `mergeShippedDefaults` appends
  built-in result rules **by id only**, so once a user holds an edited built-in it is never
  re-pushed; and `revertRetiredResultRuleFields` only un-sticks a built-in label while it
  still **exactly** equals a retired shipped default (the atomic-per-id guard). The moment a
  clinician types their own label, the whole rule is left untouched — user override wins.
- Added a regression test (`test-chip-label-migration.js`) pinning that an arbitrary
  clinician-renamed built-in label survives the shipped-defaults merge, not just the
  specific strings already in the retired table.

**Scope note — deliberately bounded.** This covers **result-rule** chip labels, which is
what the request was about. Age/decoration (`.ch-queue-chips`) and drug-monitoring
(`.ch-q-mon`) chip labels are **not** user-editable yet — those are generated, not
rule-label-driven, so making them editable is a larger change recommended as a separate
scoped follow-up rather than bundled here.

### Not done (intentionally, on clinical-safety grounds) — bulk-trimming "high" from shipped labels

The request also asked to consider removing a redundant *"high"* from shipped built-in
labels. After investigation this was **held**, not done, because:

- There is **no standalone `/ high` direction token** in our chip output. The visible
  "high"/"low" lives **inside a built-in rule's clinical name** (e.g. *"Critical high
  potassium"*), and that name only renders when our rule **escalated severity above the
  lab's own flag** — so it is our attributable escalation signal, not a duplicate of
  Medicus's H/L flag.
- Many candidate analytes are **bidirectional** — potassium, sodium, calcium can be
  critically high *or* low (we ship both rules). Trimming to *"Critical potassium"* would
  lose hyper/hypo and is clinically ambiguous.
- For the unidirectional ones (eGFR, Hb, INR, platelets, neutrophils, magnesium), the
  direction word is part of the **canonical clinical phrase**, not redundant decoration;
  shaving it yields no safety benefit and risks looking like a value was dropped.

The editable-flags feature above is the correct lever: a clinician who wants "high" gone
renames that one label themselves, and it sticks. No `defaults.json` content was changed,
so there is no config-version bump for this release.

## [v3.115.2] — 2026-06-17

### Fixed — Result-triage queue chips no longer push the patient name out of view

On the Investigation Results queue, the injected result-triage chips (`.ch-q-result`)
are **prepended** into the narrow patient-name cell (prepend is mandatory — appended
nodes get reconciled away by Medicus's Vue/AG-Grid renderer). Because they sit *before*
the name, a stack of chips (a result chip plus age/decoration and text-rule chips, or a
single long builtin-rule label such as *"…(red ≥6.5 mmol/L)"*) could consume the cell and
leave the patient name unreadable. The inline container was only soft-capped at 60% of the
cell and could wrap, so several chips stacked vertically into the name row.

- **Hard-bound the inline chip container** (`.ch-q-result-inline` / `.ch-q-mon-inline`) to
  a fixed fraction of the cell and forced it to a **single line** (`flex-wrap: nowrap`), so
  no combination of chips can crowd or wrap over the patient name.
- **Per-chip ellipsis + width cap** so a single long label truncates instead of running the
  row wide. The **full label remains on hover** (each chip already carries a `title`), and
  the severity **colour is never hidden** — only surplus label text is clipped. A shortened
  chip therefore never implies an all-clear; it only takes less width.

**Deliberately NOT changed (safety):** the direction word ("high"/"low") was *not* stripped
from any chip. The generic abnormal chip already carries no direction word; where a
direction word does appear it is inside a builtin **rule** label, and a rule chip only
renders when *our* rule **raised** severity above the lab's own flag — so that "high" is our
escalation signal, not a duplicate of Medicus's H/L flag, and removing it would hide which
party flagged the result. Chip labels remain fully user-editable in the Result Rules editor
(the "Label (shown on the chip)" field) for anyone who wants them shorter still.

## [v3.115.1] — 2026-06-17

### Fixed — Result rules shown in two settings views no longer drift out of sync

The Suite Settings page embeds the Triage Lens options page **twice**: once as the
"Triage Lens" section and once as the dedicated "Result Rules" section. Both rendered the
same `CONFIG.resultRules` from one storage key, but each iframe loaded the config into
memory **once** and wrote the whole object back on save, with nothing watching
`triagelens.config` for changes from the sibling view. Result: a result rule edited (or a
rule's Enabled checkbox toggled) in one view stayed stale in the other, and the next save
in the stale view silently overwrote the first edit — so an "enabled" rule could revert to
disabled/unreviewed and never fire.

- **Removed the duplicate editing surface:** the embedded "Triage Lens" section now hides
  its Result rules tab (via a new `#triageLens` deep-link hash), so result rules are edited
  in exactly one place — the dedicated "Result Rules" section. Opening the Triage Lens
  options page standalone is unchanged and still shows every tab.
- **Added cross-view sync:** every open instance of the options page now re-reads
  `triagelens.config` on `chrome.storage.onChanged` and refreshes its rule lists, so saves
  merge instead of clobber. In-progress, not-yet-saved typing in threshold/preference forms
  and the open rule editor is deliberately left untouched.

## [v3.115.0] — 2026-06-17

### Keeper rule updates (CSO-approved) + full clinical-safety re-baseline

**Rule updates** (held from the 2026-06-17 Keeper run, now CSO-approved and embedded;
sources to be confirmed against the official letters — applied without page-verification
as external sources were unreachable that run):

- **RSV vaccine** (`vax-rsv`): eligibility expanded to **age 75+** (upper bound removed)
  and **adult care-home residents**, reflecting the 1 April 2026 programme expansion. The
  rule previously stopped at 79 and silently missed all eligible 80+ patients.
- **Flu vaccine** (`vax-flu`): added a **people-experiencing-homelessness** cohort
  (problem-coded; flags only patients with an explicit code — operational outreach remains
  the primary route).
- **Pneumococcal** (`vax-pneumo-ppv23`): relabelled to **PCV20** (Apexxnar) for the routine
  65+ programme (changed early 2026); a recorded PPV23 dose still counts as given. Rule id
  retained so existing user snoozes/overrides are preserved.
- **QOF HF009** four-pillar RAAS class: added **fosinopril, olmesartan and azilsartan**
  (parity with the file's existing ACE/ARB list) so a HFrEF patient whose sole RAAS agent
  is one of those no longer silently fails the RAAS pillar. Regression-locked in
  `test-hf009-four-pillar.js`; RSV/care-home coverage added to `test-vaccine-rules.js`.

**Full clinical-safety re-baseline (v3.64.0 → v3.115.0):** `HAZARD-LOG.md` and
`CLINICAL-SAFETY-NOTICE.md` were re-baselined to cover everything added since the last full
review — the Record tab live summary, Practice Report, CQC Inspection Readiness, the result-
rule/combo expansions, Focus mode, alert roll-up, editable operational thresholds, letterhead
auto-fill and the Select-all helper. New hazards **H-032** (Record snapshot misread as a
complete record), **H-033** (CQC evidence pack misread as compliance proof / population
coverage) and **H-034** (Select-all bulk-selects the wrong outstanding investigations);
controls updated on H-002/H-016 (contract + completeness CI), H-030 (the v3.100.0 critical-
low-Hb 100→80 g/L threshold change), H-009 (the v3.91.2 attribute-injection-XSS remediation),
and others. `SOUP.md` records the PDF.js 3.11.174 → 4.2.67 upgrade (CVE-2024-4367). The
CSO-review ledger is re-pinned to 3.115.0, clearing the doc-version-gate backlog.

## [v3.114.0] — 2026-06-17

### Council-of-Daves roadmap (steps 1, 3, 4, 5) — clinical-matching integrity, contract tests, honest figures, provenance canon

A whole-suite hardening pass converging the five-Dave council's roadmap (step 2,
the Clinical Event Ledger, was deliberately deferred).

**Step 3 — kill the silent missing alert (canonical clinical-term lists):**

- **Single ACB scorer.** The in-queue Anticholinergic Cognitive Burden score is
  now computed by the one canonical scorer (`engine/acb-scores.js`,
  `window.ACBScores.computeACB`) instead of a separate hardcoded table in the
  content script that had drifted. Strong anticholinergics — olanzapine,
  quetiapine, clozapine, chlorpromazine, clomipramine, doxepin, diphenhydramine,
  procyclidine, trihexyphenidyl — previously scored **0 in the queue HUD but 3 in
  the record/engine view**; they now score identically everywhere. The queue also
  switches to per-drug additive ACB (the correct clinical model; the old table
  summed once per class). Added dosulepin/dothiepin (score-3 TCA) to the engine.
- **STOPP term parity.** `engine/stopp-start.js` NSAID list brought up to the full
  UK generic set + major brands (piroxicam, tenoxicam, indometacin/indomethacin,
  sulindac, ketoprofen, dexketoprofen, tiaprofenic, mefenamic, tolfenamic,
  fenoprofen, aceclofenac, nabumetone, etodolac, flurbiprofen, plus Feldene/
  Ponstan/Froben/Relifex/Surgam/Lodine). Low-dose aspirin now also matches the
  gastro-resistant word-order variant and the UK 75mg brands (Nu-seals, Caprin,
  Micropirin). Each was a previously **silent** STOPP miss.
- **Completeness CI.** `test-term-coverage.js` + `rules/term-coverage-snapshot.json`
  guard these hand-maintained class-term lists; the formerly-stranded terms are now
  locked into `mustMatchAll`, and the resolved ACB divergences are kept as
  regression sentinels. New silent drift fails CI.

**Step 1 — producer→consumer contract-test layer:**

- `test-chip-contract.js` drives the real engine producers into the real renderers
  for every chip type (drug-monitoring, QOF indicator, drug-combo, event-count,
  composite, vaccine, evidence panel) plus the result-triage path against the
  shipped chip labels, asserting each renderer reads exactly the fields the engine
  emits. The CQC engine↔renderer field-drift class of bug now fails CI.

**Step 4 — Record "Copy summary":**

- The Record tab can copy a plain-text summary of the on-screen snapshot, with a
  provenance header and an explicit "live snapshot, not a complete record — verify
  before acting" caveat and gap-markers. No fabrication: fields that can't be
  derived are omitted, never invented.

**Step 5 — honest operational figures + provenance canon:**

- **CQC reconciliation.** The CQC evidence pack now lists the monitoring cohorts to
  run in Medicus with a blank "your count: ____" column rather than implying the
  extension can enumerate the whole population (which, read-only, it cannot).
- **Provenance canon.** New `shared/provenance.js` centralises the safety caveats
  ("no alert ≠ monitoring complete", "live snapshot, not a complete record",
  "supporting evidence, not proof") and a no-fabrication provenance/as-at
  formatter; the triplicated "no alert ≠ all clear" literal is replaced by the
  shared constant in the Reception and Sweep tabs (with a fallback so a safety
  caveat can never silently drop).

**Clinical-safety governance (Keeper + CSO pass, 2026-06-17):** a combined Keeper
currency sweep of all six rule domains plus a CSO hazard review of the clinical-matching
changes. No rule file changed (external source pages were unreachable this run — WebFetch
403 — so per the verification discipline nothing unverified was applied; four candidates
are held for CSO verification, incl. a possible RSV 80+ expansion). Hazard log gains H-031
(cross-surface clinical-score divergence, closed by the single ACB scorer) with updated
H-006/H-016 controls; CLINICAL-SAFETY-NOTICE and the CSO-review ledger record the
incremental v3.114.0 review. The full hazard re-baseline for v3.65–v3.113 remains
outstanding and is still surfaced by the doc-version gate. See
`docs/keeper/KEEPER-CSO-pass-2026-06-17.md`.

**Supporting hardening (Wave A):** CQC badge CSS coverage + render assertions;
Practice-report data fixes (honoured hidden-types filter, labelled capacity
threshold, prior-period comparison); doc-version gate now reads a CSO-review ledger
and reports how many minor releases each safety doc is behind; suite backup
envelopes carry a synchronous integrity hash (legacy backups still import).

## [v3.113.1] — 2026-06-16

### Repo tooling: Virtual Dave agent + CI doc-gate resync

- Added `.claude/agents/virtual-dave.md` — a project Claude Code agent, a digital twin of
  Dr Dave Triska (GP partner / CSO / indie builder) for in-repo architecture, safety and
  clinician-UX critique ("what would Dave think"). It reads the actual code before any
  verdict. **Dev tooling only** — `.claude/` is excluded from the release zip, so no
  product/code change ships.
- Resynced the doc-version gate after the manifest advanced onto the 3.113 line:
  **SOUP.md → product 3.113.0 (doc v1.8)** with vendored libraries re-verified unchanged,
  and **feature-list.md → v3.113.0**. CLINICAL-SAFETY-NOTICE / HAZARD-LOG remain
  KNOWN_STALE by design (pending CSO review).

## [v3.113.0] — 2026-06-16

### Power-user features (appraisal R4): keyboard tab nav + Condor CSV

For the power-user persona who keeps the panel open all day and wants data out
without the mouse.

- **Keyboard tab navigation.** Ctrl/Cmd+Alt+← / → cycle the visible in-panel
  tabs without reaching for the mouse. Ignored while typing in a field, and
  skips the Visualiser tab (which opens a full browser tab rather than switching
  in-panel). The shortcut is advertised at the foot of the new "All tabs" menu.
- **Condor CSV export.** Condor previously offered only "Copy figures" (a
  clipboard dump that can't be scripted or archived). It now has a "↓ CSV"
  button beside it that downloads the same snapshot figures (PPI, demand,
  capacity, waiting room, urgent, submissions, with an "as at" time) as a real
  file, reusing the shared export helper. No data leaves the browser.

## [v3.112.0] — 2026-06-16

### "All tabs" menu — every tab reachable by name in one click (G1)

At the 360-420px panel width the nav tab strip can only show the active tab;
the other tabs scroll off, and the appraisal found even savvy users could not
name them from icons alone. Added an **"All tabs" button** to the nav actions
that opens a menu listing every visible tab by its full name (icon + label),
with the active tab highlighted — one click jumps to any tab, no horizontal
scrolling, no need to learn the Ctrl+K palette.

- Built live from the nav DOM on each open, so it always reflects the user's
  current tab visibility and order.
- Mirrors the existing help-popover pattern: outside-click and Esc dismiss,
  `:focus-visible`, tokenised throughout, verified in light and dark.
- Chosen over a 2-3 row wrapping nav (which would have permanently eaten
  vertical space) to protect the panel's clinical-data real estate.

## [v3.111.1] — 2026-06-16

### Legibility pass (Atelier): load-bearing labels lifted off the faint tier

Acting on finding G3 of the whole-suite appraisal — letter-spaced small-caps
labels in the faintest slate tier strain tired eyes, and the technophobe floor
misread them. The dual-voice mono small-caps "machine voice" is retained (it is
the suite's brand); only the *contrast tier* moved, per the design doctrine's
own floor that a muted tier must never be the only carrier of meaning. Token
values are unchanged — these are class-level tier choices.

- Module eyebrows (`.mod-eyebrow`), inactive nav-tab labels, and the Today card
  section labels ("WAITING ROOM", "DEMAND TODAY", …) move from `--text-4` to
  `--text-3` — a clear contrast lift while staying a muted label tier. (G3)
- The Trends "Default NICE/QOF thresholds — verify any personalised target in
  Medicus" caveat is now a tinted note box (accent wash + left accent border)
  instead of faint grey text floating under the chart, so it is not missed. (G3)
- The waiting-room strip "Monitoring →" link is lifted to `--text-3` and gains an
  accent hover border so it reads as navigation, not an alert. (G1, partial)

Verified rendered in light and dark themes. CSS only; no clinical-rule,
threshold, token-canon or alert-salience changes.

## [v3.111.0] — 2026-06-16

### Usability: legibility and plain-language fixes from The Practice appraisal

Acting on the synthetic whole-suite usability appraisal
(`docs/appraisal/PRACTICE-whole-suite-ui-theming-2026-06-16.md`). These are
display/copy changes only — no clinical-rule, threshold or scope changes.

- **Triage strip now reads in plain words.** The persistent top strip showed
  only the two-letter bucket codes (`NM / MR / NA / AR`), which four personas
  across the tech-literacy gradient could not decode on sight. It now shows the
  full labels (New med / Med reply / New admin / Admin reply) — the data was
  already present, the strip just chose the short form. (U1)
- **"N unmatched" in the Sentinel audit headline is now a link**, not a dead-end
  number. Clicking it opens and scrolls to the existing "Meds without a
  monitoring rule" section. That section's note now states plainly that the
  medicines **were read from the record successfully** and simply did not map to
  a rule — closing the nurse/pharmacist worry that "unmatched" might mean a
  silent extraction failure. (U2)
- **Demand meter now shows its scale.** The headroom bars on Today carried their
  threshold only in an invisible aria-label; they now print a small caption
  ("busy at N · limit N") so the bar has a visible denominator. (U3)
- **Submissions subtitle disambiguated.** "Live count of inbound work" read to a
  practice manager as outbound QOF submissions; it now says "Inbound request
  volume — counts work received, not items submitted". (R1)
- **Reception intro copy in plainer language.** "Capture a structured history" →
  "Ask the caller a set of standard questions"; the red-flag note now explains
  that a YES means stop and follow the on-screen action "which tells you exactly
  who to contact", rather than the unexplained "escalate straight away". The
  per-pathway escalation action text itself is unchanged (clinical content). (G2)

## [v3.110.2] — 2026-06-16

### CQC Inspection Readiness: discoverable from Settings

The readiness page was only reachable via the Ctrl+K palette, which was easy to miss. Added
a **"CQC Readiness" tab in Options** (after Clinical Safety) with a short explanation of
what it is (and the honest "supporting evidence, not proof" framing) and an **Open CQC
Inspection Readiness** button that launches the full page in its own tab (so Print/PDF and
CSV stay clean). Also registered as an Options deep-link so Ctrl+K → "Settings: CQC
Readiness" works. No behaviour change to the readiness page itself.

## [v3.110.1] — 2026-06-16

### CI: fix the doc-version gate (SOUP + feature-list)

The `check-doc-versions.js` CI gate had been red since the manifest passed 3.98 — two
docs were stamped behind the product version. Resynced both (the clinical
CLINICAL-SAFETY-NOTICE / HAZARD-LOG stay KNOWN_STALE pending a CSO review, by design):

- **SOUP.md → product v3.110.0 (doc v1.7).** Verified no vendored library changed since
  the last sync (PDF.js 4.2.67 + worker, Chart.js 4.4.1, D3.js 7.8.5 still match
  `vendor-versions.json`); added a "no SOUP changes" version-history row covering the
  v3.92→v3.110 first-party releases.
- **feature-list.md → v3.110.0.** Added the new Record module (live patient summary), the
  two full-tab reports (Practice Report, CQC Inspection Readiness), bumped the module
  count, and refreshed "Recent additions" through v3.110.

Docs-only; no code change. The Tests workflow's doc-version step now passes
(`check-doc-versions.js` exit 0).

## [v3.110.0] — 2026-06-16

### CQC Inspection Readiness (P1): internal readiness check + gated evidence export

A new page (Ctrl+K -> "CQC inspection readiness...", opens as a tab) that turns the suite's
monitoring rule-set and its dated currency into CQC evidence for the Safe and Well-led key
questions — built from shipped rule data only, no patient data and no cohort enumeration.
Planned and twice panel-reviewed (docs/plans/CQC-EVIDENCE-PACK-BUILD-PLAN.md).

- **Two modes.** Readiness check (internal: RAG + "what to fix") and Evidence export
  (inspector-facing, gated behind an "I have reviewed these figures" confirm — never
  produced automatically).
- **Coverage manifest front-and-centre.** Rule-set versions/dates, the raw matched-drug
  terms (eyeball for brand completeness), a coded-data-only "floor not ceiling" caveat, the
  prominent "Safety rules last reviewed against BNF/NICE/MHRA: {date} — via The Keeper", and
  a per-file rule-currency table as the standout evidence.
- **Honest by construction.** Inline prose provenance (never tooltips); a persistent
  "supporting evidence, not proof of compliance" disclaimer; counts labelled as rules and
  indicators, not patient numbers.
- Includes the P1.1 panel polish (reviewed-not-updated wording, dated verdict, role-labelled
  sign-off, vaccine-as-surveillance) and fixes for four engine-to-renderer field-name
  mismatches caught in a sanity check (statement title, statement bodies/provenance/currency
  table, string toFix, matched-terms location), locked by test-cqc-render.js.

New files: cqc-readiness.{html,css,js}, cqc-render.js, engine/cqc-evidence.js. Tests:
test-cqc-evidence.js (42), test-cqc-render.js (14). Full suite 77/77. Cohort-count phases
(P2+) remain gated on the feasibility spike (docs/plans/CQC-P0-COHORT-SPIKE.md): a true
read-only population query is not reachable; the enumerate-then-fan-out path needs a live
discovery capture.

## [v3.109.0] — 2026-06-16

### New "Record" tab — a live-first patient summary (PDF deep-dive nested within)

The Patient Record Visualiser is powerful but under-used because it requires
exporting and loading a record PDF before it shows anything. The new **Record**
tab removes that wall: open a patient in Medicus and it shows a **live snapshot**
sourced from the same API the suite already calls — no PDF, no file, no
drag-and-drop.

- **Live snapshot** of the patient open in Medicus: demographics, coded active
  problems, current medications (with doses + overdue/review flags), recent
  results (latest value per test, with above/below-range flags), and
  deterministic prescribing-safety prompts (anticholinergic burden, STOPP/START)
  plus the live drug-monitoring and QOF chips the Monitoring engine computes.
- **Clinical-safety framing is load-bearing, not decoration.** A persistent
  banner states it is a live snapshot, not a complete record. Allergies,
  immunisations and consultation history render as explicit **gap-markers**
  where the data would be — because absence here does NOT mean "none recorded".
  Every safety score carries an inline caveat that it excludes allergies and uses
  coded data only. Per-section data-window notes state what each section covers.
- **The deep view is tiered, not removed.** The full multi-year visualiser
  (consultation timeline, continuity indices, frailty/comorbidity, letters) opens
  from the footer button "Open full visualiser", built from an exported record
  PDF as before.
- Data path reuses the existing live API client (`engine/api-client.js`
  `fetchAll`) panel-side; no content-script changes, no new permissions.
- Available in both the side panel and the pop-out window.

## [v3.108.0] — 2026-06-16

### "Select all" for Outstanding Investigation Requests (with safety check)

On the Review Investigation Report task overview page, the **Outstanding
Investigation Requests** card lists every prior request still awaiting a result
as a Quasar checkbox — ticking each by hand is slow and error-prone.

- **New "Select all" button** injected into the card's pre-existing (empty)
  `.card-button` header slot, styled to the suite's injected-surface tokens so it
  sits naturally beside the Medicus chrome.
- **Safety check:** because ticking every request is a bulk, hard-to-undo
  clinical action, the button always routes through an "Are you sure?" confirm
  dialog ("This selects all *n* previous outstanding investigations and will
  clear them") — it never selects silently. The dialog defaults focus to
  *Cancel*, and Esc / backdrop-click both dismiss without selecting.
- **Mechanics:** drives each `.q-checkbox` via a native `.click()` with a 30 ms
  stagger (Vue reactivity is async — a synchronous loop drops most updates).
  Injection is idempotent and re-attempted by a detail-page-scoped
  `MutationObserver` so the button survives the Vue 3 + Quasar SPA's re-renders;
  the observer is torn down on navigation away.

## [v3.107.0] — 2026-06-16

### Practice letterhead: recall letters and SMS auto-fill the sign-off

Recall letters and SMS (Sentinel per-chip and "Copy all actions", and the Sweep
batch handout) previously always emitted `[Practice name]` / `[Clinician name]` /
`[practice name]` placeholders, which had to be hand-edited every time and risked
going out un-filled.

- **New setting** under Settings → Suite: "Practice letterhead" (practice name +
  optional clinician sign-off), stored as `suite.letterhead`.
- The pure `action-packs.js` builders now take an optional `{ letterhead }` and
  substitute it into every letter/SMS sign-off; Sentinel and Sweep load
  `suite.letterhead` (Sentinel caches it and refreshes on change) and pass it in.
- **Safe fallback preserved:** when a field is blank — including whitespace-only —
  the bracketed placeholder is kept, so a letter never goes out with a real-looking
  but empty sign-off.
- Captured in suite backup via `shared/io/suite-io.js` (round-trip + validation).

Tests: extended `test-action-packs.js` (substitution, fallback, blank-guard,
aggregate + batch threading) and `test-suite-io.js` (letterhead round-trip + validation).

## [v3.106.0] — 2026-06-16

### Practice Report: power-user roadmap items

Lands the three deferred power-user items from the Practice Report appraisals.

- **Sortable per-clinician table.** Click (or keyboard-activate) any column header in
  the management Activity table to sort by that metric, clinician name, or total; click
  again to flip direction. A view-only aid — it never changes what data was fetched, and
  the aggregate-only rule for Staff/ICB is unaffected (those profiles have no per-clinician
  table to sort).
- **Demand as a percentage.** The demand by-type breakdown now carries a "% of total"
  column alongside the count.
- **Section show/hide toggles.** A "Sections" row in the controls lets you show or hide
  any section for the current view, overriding the audience profile's defaults (e.g. add
  the live snapshot to an ICB view). Display-only and cannot expose per-clinician data —
  `applyProfile` has already stripped it upstream; toggles only change visibility.

All three are threaded through an optional `view` argument to `buildReportHtml`
(`{ sort, sections }`), so the print/CSV paths and existing callers are unchanged.
Regression-tested (sort order, section override, the privacy invariant still holds).
Full suite 75/75; eslint + prettier clean; verified via the harness.

## [v3.105.0] — 2026-06-16

### Monitoring: vaccine invitation letter, cleaner admin tasks, Safety Monitoring section

Three fixes to the Sentinel monitoring action packs and chip grouping:

- **Vaccine chips now generate a direct-to-patient invitation letter.** Previously
  vaccine action packs offered only an SMS and an admin task — they lacked the
  formal invite letter that drug-monitoring and QOF chips already provide. The new
  `letter` uses invitation wording and renders in the existing "Letter" section of
  the action-pack modal.
- **Removed the "Recall SMS template available in Sentinel → Actions." line** from
  every admin task (drug-monitoring, QOF and vaccine). It was redundant noise on
  the task copy.
- **New "Safety Monitoring" section** in the monitoring view. The eGFR/HbA1c trend
  monitors and the hyperkalaemia alert are *not* QOF claim indicators but reused the
  `qof-indicator` chip shape, so they were rendering under "QOF Indicators". These
  rules are now tagged `category: "safety-monitoring"` in `rules/qof-rules.json`;
  the engine passes the category through and the panel groups them in their own
  section. Evaluation, scoring and chip content are unchanged — display grouping only.
- **Safety-monitoring chips no longer emit patient-facing recall copy.** Because the
  trend/alert flags reused the `qof-indicator` shape, an action-needed one (e.g. a
  raised potassium) could previously generate a patient SMS/letter reading "your
  review is due — book at your convenience", which is wrong for a same-day clinical
  signal. These chips now produce a clinician-review task only (no SMS, no letter),
  via both `buildChipActions` and the aggregate `buildPatientActions` path.
- **Safety Monitoring section: clearer placement and caption.** The section now sits
  directly below the alert clusters and above routine drug monitoring (ordered by
  urgency of action), and carries a one-line caption "Clinical safety flags — not QOF
  payment items" so moving these out of "QOF Indicators" cannot read as QOF chasing
  having stopped.

Tests: extended `test-action-packs.js` (vaccine letter, recall-line removal,
safety-monitoring no-patient-copy) and `test-qof-indicator-filters.js` (category
passthrough). Full suite green.

## [v3.104.0] — 2026-06-16

### Practice Report: the gap-to-8/9 fixes (Practice appraisal)

Lands the convergent Practice-panel findings
(`docs/appraisal/PRACTICE-REPORT-gap-to-8-9-2026-06-16.md`).

- **Pressure Index no longer reads as a contradiction.** The current-snapshot tile now
  shows the band word ("AMBER") as the headline with "index 25/100" as the sub-line, so
  the eye reads the status first, not a number that looks green. When the band was floored
  by over-capacity, a prominent amber explanation ("Showing AMBER: the practice is over
  capacity — the weighted index alone is 25") replaces the old small-grey note. All four
  personas snagged on the old presentation; this was the single biggest lever.
- **A plain-English summary now leads the report** — e.g. "Last 7 days: 151 requests
  against 350 scheduled slots — demand was above capacity" — so the team shares a frame
  before any number, and it bridges the demand-vs-activity question.
- **Plain language:** "Routine Rx" / "Non-routine Rx" → "Routine prescriptions" /
  "Non-routine prescriptions"; the demand breakdown is labelled "Of which, by type" so it
  reads as a breakdown of the headline total.
- **Live figures carry their timestamp** — "Slots free now" / "In waiting room" now show
  "as at HH:MM" on the tile, so a figure read later in the day isn't mistaken for live.
- **Richer, profile-aware CSV.** Export now includes the per-clinician activity table and
  the referrals breakdowns, not just demand-by-day — as separate titled sections in one
  file. The Staff and ICB CSVs emit **no per-clinician section** (the aggregate-only
  privacy rule now holds in the CSV as well as the HTML, regression-tested).

Roadmap (power-user): sortable per-clinician columns, demand as a percentage.

## [v3.103.0] — 2026-06-16

### Referrals: no longer need to "open the report once" (headless discovery)

Referral data is now fetched without first opening the Medicus Clinical Audit Report
page (plan: `docs/plans/REFERRALS-HEADLESS-DISCOVERY-PLAN.md`).

- **Headless discovery.** A new `ReferralsApi.ensureReferralsDiscovery()` constructs the
  referrals **config** endpoint from the practice code, fetches it credentialed to
  validate the deployment, derives and validates the **data** template, and stores it —
  exactly the URLs the in-page content script used to capture, but with no tab open. URL
  only is persisted; never patient rows. On any failure it returns null and falls back to
  the existing in-page discovery + the friendly prompt, so the worst case is no worse than
  before. The Referrals tab now runs this automatically on load when no template is stored.
- **Bug fix:** the Practice Report's referrals section never populated — `fetchReferralsRange`
  called the API without the captured template URL and always threw "No discovered URL".
  It now uses the stored template (or runs headless discovery), so referrals appear in the
  report.
- **Stale-template self-heal.** If a captured URL goes stale (404, or it starts returning
  the config response), the Referrals module now clears it, attempts one re-discovery, and
  otherwise shows a calm "reconnect — open the report once" prompt instead of a dead error.
- The Practice Report's referrals section, when not yet available, now shows a visible
  "not enabled yet" line rather than vanishing silently.

Honours the repo's "never construct URLs blindly" doctrine by validating every constructed
URL against the live response before storing it. Tests: `test-referrals-discovery.js` (37,
incl. PHI-not-persisted guards); full suite 75/75; verified end-to-end via the harness.

## [v3.102.0] — 2026-06-16

### Practice Report — design-crit + Practice review fixes

Lands the converged design-crit + The Practice findings on the new Practice Report
(`docs/appraisal/PRACTICE-REPORT-crit+practice-2026-06-16.md`).

- **Dark mode fixed (blocker).** The dark theme now re-states the brand + RAG tokens, so
  section headings, the cover title, the controls title and sparklines no longer render
  at ~1.35:1 (they inherited the light navy). Headings are legible in dark again.
- **Pressure Index explains itself.** The current-snapshot block now shows the scale
  ("GREEN under 40 · AMBER 40–70 · RED 70 or over") and, when the band was floored by
  over-capacity, says so — a low index reading AMBER no longer looks like a bug. (The
  four-persona convergent ask.)
- **Live snapshot set apart from the period.** It now renders as a dashed, tinted panel
  with a LIVE tag and an "as at HH:MM" stamp, and states it is not part of the period
  figures — so the live "today" count is no longer mistaken for a period total.
- **By-clinician table labelled and reconcilable.** Activity now shows a per-clinician
  drill-down split by activity type with an "All clinicians" total row that reconciles to
  the totals above. A note explains demand (inbound) and activity (done) need not match.
- **Data notes, not a standing error.** Skipped-section reasons (e.g. referrals needing
  its report opened once) now read in plain English inside a neutral "Data notes" panel,
  not amber alert text on every run; the double full-stop is gone.
- **Designed empty state.** The no-code / first-run state is now a framed card with an
  "Open options" action instead of bare grey text.
- **Polish:** uniform stat-tile widths across sections; sparkline wrapper styled; cover
  meta fields separated; `print-color-adjust: exact` so RAG fills survive PDF export.

Remaining roadmap (power-user): report section toggles, per-day series tables, and a
multi-section CSV export.

## [v3.101.0] — 2026-06-16

### Practice Report (Condor) — periodised, audience-tuned operational report

A new Practice Report built on Condor's operational data, for a selectable period
(Today / 7 days / 30 days / custom), rendered as a printable page (Print → PDF) plus
CSV — modelled on the Patient Record Visualiser's print pattern. Planned in
`docs/plans/PRACTICE-REPORT-PLAN.md` from 5 codebase + 5 web research agents.

- **Three audience profiles.** *Practice Management* (full detail incl. per-clinician
  breakdown), *Staff Briefing* (aggregate-only — per-clinician figures are stripped at
  the data layer so individual productivity can never leak, per Goodhart's-law / morale
  guidance), and *ICB / System* (practice-level, NHS-correct terminology — e.g. "Urgent
  suspected cancer (2WW / FDS)"; no live snapshot).
- **Sections:** cover (period + practice + "as at"), current snapshot (live PPI /
  waiting / urgent), demand (per-day series + by-type + sparkline), capacity (scheduled
  slots / sessions), activity (totals; per-clinician for management), referrals
  (priority/status), and trends from the snapshot store.
- **Honest by construction.** Only metrics derivable from Medicus are shown; anything
  that cannot be derived is omitted rather than estimated, with a short limitations
  footer. Multi-day demand/activity/capacity/referrals come from real date-range
  endpoints.
- **Forward-accruing snapshot store.** Condor now writes one `practice.reportSnapshots`
  row per day (PPI / waiting room / task age — the live-only signals with no source
  history), pruned to 90 days and backed up via the existing `condor` scope, so trends
  build over time.
- **Launchers:** a "Practice report" strip in Condor (Today / 7d / 30d / full) and a
  Ctrl+K command "Generate practice report…". Opens as a browser tab like the visualiser.

New files: `practice-report.{html,css,js}`, `side-panel/modules/condor/report/{report-data,
report-profiles,report-render}.js`. Tests: `test-practice-report-data.js` (30),
`test-practice-report-render.js` (18, incl. the staff aggregate-only safety invariant).

## [v3.100.0] — 2026-06-16

### Critical-result chips now show their trigger value on the chip (community item — Nick)

Adopts a community-contributed convention (submitted by Nick via a Triage Lens
config export, reviewed by The Keeper): every numeric **result-rule** chip now
carries its trigger threshold in the label, so a clinician reading the alert sees
the cut-off at a glance and can sanity-check it against the actual value. This was
already true for the two HbA1c chips; it is now consistent across the whole base
set. Symbols use the engine's true (inclusive) firing semantics — `≥` for `above`
rules, `≤` for `below` rules (correcting the strict `<` used in a few of the
submitted labels).

- **16 base result-rule labels** gained their threshold, e.g. *Critical high
  potassium → "Critical high potassium (red ≥6.5 mmol/L)"*, *Critical low
  neutrophils → "(red ≤0.5 ×10⁹/L)"*, *High INR → "(red ≥8)"*. Where a rule has
  both tiers the **red (critical) trigger** is shown for brevity (≤60-char chip cap).
- **Critical low haemoglobin red threshold lowered 100 → 80 g/L (CSO-approved).**
  The previous 100 g/L fired "critical" on mild anaemia; 80 g/L matches the
  severe-anaemia critical band. Surfacing the number on the chip is what prompted
  the review. *This is a threshold change requiring CSO sign-off — flagged here.*
- **New migration: `revertRetiredResultRuleFields`** (content.js + options.js, in
  lock-step). The result-rules merge is append-by-id only, so changed shipped
  labels/thresholds never reached existing users (the result-rules analogue of the
  `RETIRED_CHIP_LABELS` systemChips trap). The new revert un-sticks a held builtin
  **atomically per id** — only when *every* listed field still equals the retired
  shipped value (i.e. the user hasn't customised it) does it bring the rule fully
  up to date, so it never clobbers a user edit and never leaves a label that
  disagrees with the live threshold. Pinned by `test-chip-label-migration.js`.
- Bumped `defaults.json` schema `version` 16 → 17 so the migration runs for
  existing installs; refreshed the defaults-config lock; updated
  `test-result-severity.js` for the new Hb threshold.


## [v3.99.0] — 2026-06-16

### Whole-suite Practice appraisal: the gap-to-9 fixes

Lands the convergent findings from the whole-suite Practice appraisal
(`docs/appraisal/PRACTICE-whole-suite-gap-to-9-2026-06-16.md`). The theme:
composite and "all-clear" states must explain their own provenance and never
contradict themselves, and the eyesight/discoverability floor must hold.

- **Condor: the headline no longer contradicts itself (the #1 fix).** The
  Practice Pressure gauge could show "GREEN · 25/100" on the same screen as
  "Over capacity (115 requests vs 50 slots)" because capacity is only 20% of the
  weighted index. Now, whenever demand is over the slot limit, the displayed band
  is **floored to at least AMBER** — on the gauge dial, its label, the new
  lead-with-the-numbers headline strip ("Demand 115 · Capacity 50 · Over
  capacity"), and the COPY FIGURES output. The numeric index is unchanged; this
  only ever raises a signal, never lowers one. (`condor.js` `computeIndex`,
  `cards/ppi.js`.)
- **Condor: defensible figures.** COPY FIGURES now carries a hard "as at HH:MM"
  stamp and explicit Demand / Capacity lines; the unconfigured Task-Inbox and
  Day-Score cards are demoted to quiet strips; the clinician-workload zero state
  reads "No consults logged yet today" instead of a bare "0".
- **Today: sweep provenance is unambiguous.** A sweep that has run shows "Last
  sweep HH:MM · N patients checked · 0 alerts"; when none has run, the card reads
  a distinct "Not run yet today" and Recent Alerts no longer shows a green
  all-clear without a sweep behind it. The "Triage Load" unconfigured card is
  demoted to a thin optional strip.
- **Sentinel: explicit all-clear audit.** A loaded patient panel now shows a
  headline count — "N meds checked · M matched a monitoring rule · K overdue · P
  unmatched · checked HH:MM" — derived from the same arrays the sections below
  render, so a clean screen reads as "verified clear", not "nothing fired". No
  drug rules or matching logic changed.
- **Referrals: clearer cold state + sensible default.** The waiting-for-report
  empty state is reworded as reassuring and self-populating with a working
  deep-link; the default window is now month-to-date.
- **Cold-state framing for non-power roles.** Reception (pathways disabled) and
  Capacity (no preset) now carry a calm "this is a one-time practice setup —
  nothing for you to do" banner above the existing gate, which is unchanged.
- **Legibility + discoverability floor.** Lifted the two faintest text tokens a
  step and reduced letter-spacing on small uppercase micro-labels (fixes the
  "DEMAND" misread). Added a persistent keyboard-reachable "?" per-tab help
  popover (two lines: what this tab is / what to do first) to the panel and
  pop-out, and expanded "QOF" inline in the Monitoring help.

Report-only appraisal items deferred to roadmap: user-editable composite
weightings and a Condor history CSV (both need new daily-snapshot storage).

## [v3.98.1] — 2026-06-16

### Threshold editor: clearer, safer, and reachable without the palette

Closes the Practice appraisal of the threshold editor:

- **Visible entry point.** The waiting-room threshold is now editable in
  **Options › Notifications** too, not only behind Ctrl+K — so a clinician who
  doesn't use the command palette can still reach it.
- **Honest scope.** The editor states "Saved on this device, applied straight
  away" and the misleading "your choice is yours alone" line (a copy-paste
  artefact) is gone — so the setting isn't mistaken for a practice-wide policy.
- **A disabled strip can't hide.** Turning an alert off greys its row and shows
  "Off — no alerts for this strip", so a muted strip is never silent and
  invisible at once.
- **Clearer model.** The close button now reads "Close" (edits already apply
  live) with a "Saved" confirmation on each change; the subtitle explains the
  strips change colour (no pop-up); units carry tooltips ("resets at midnight").
- **Defaults + reset.** Each row shows its shipped default and a one-click Reset.
  A gentle nudge appears if a waiting threshold is set so high it would rarely
  fire. The waiting row is marked "always on" (it has no enable toggle by design).

These are operational (workload) strips, never clinical — so user-tunable
thresholds and an alert-off toggle are appropriate here.

## [v3.98.0] — 2026-06-16

### Editable alert thresholds from the command palette

The roll-up's amber/red lines are now tunable without hunting through Options. A
new palette command, "Edit alert thresholds…", opens an inline editor for the
numeric thresholds:

- **Waiting room** — the minutes a patient has waited before the strip goes amber,
  then red, are now **user-configurable** (previously fixed at 10 / 20). Stored in
  `suite.waitingRoom.thresholds`, backed up, and applied live.
- **Demand** — the per-day medical/admin request counts (and their on/off toggle),
  the same values as Options › Submissions, editable here too.
- **Triage** uses a rules engine rather than a numeric pair, so the editor links
  out to its existing Options editor instead of half-reimplementing it.

Edits apply immediately (the strips re-render on the storage change); the editor
refuses an inverted pair (red must be at least amber). Panel-only, since the
strips it tunes live in the docked panel.

## [v3.97.1] — 2026-06-15

### Gap-to-9 quick wins on the alert roll-up

The third Practice pass asked each persona what they'd need for a 9/10; this
lands the convergent "make the numbers explain themselves" set plus legibility:

- **Timestamp (manager).** The roll-up bar now carries an "as at HH:MM" stamp so
  every figure is anchored to a moment that can be quoted.
- **Threshold context (power user / pharmacist / manager).** The pill hover now
  names the line each figure crossed — "Demand: 115 … (Medical 70 ≥60, Admin 45
  ≥40)", "…longest waiting 55 min (red ≥20 min)" — so a number isn't blind trust
  in a shipped default. (Demand/triage thresholds remain editable in Options.)
- **Legibility (technophobe partner).** The roll-up counts are a touch larger so
  they clear the eyesight floor.
- **Names reconcile (manager / pharmacist).** Waiting-room name chips now wrap to
  full lines instead of clipping into the "Monitoring" button — if the count says
  3, all 3 names show.
- **Clearer toggle (pharmacist).** The expand control reads "Hide" with a tooltip
  "collapse the detail — the alert stays", so collapsing never reads as silencing
  the alert.

## [v3.97.0] — 2026-06-15

### Roll-up + Focus polish from the re-appraisal (R1/R2/R5/R6)

The second Practice panel cleared the prior blockers; this closes the remaining asks:

- **Plain-language tooltips on the roll-up pills (R1).** Hovering a pill now
  explains it in words with units — e.g. "Demand: 115 new requests awaiting review
  (Medical 70, Admin 45)", "Waiting room: 3 patients arrived, longest waiting
  55 min" — so the front desk knows what a count means, not just its value.
- **Severity reads as a word, not only colour (R6).** The roll-up headline now
  says "2 URGENT" when red and "2 ALERTS" when amber, so the escalation survives
  colourblind mode at the bar level (the pills already carried a shape cue).
- **Keep the roll-up expanded (R5).** A new command-palette toggle, "Alerts: keep
  roll-up expanded", pins the roll-up open and persists across alert-set changes
  (stored in suite.rollup.alwaysExpanded, included in backups). For power users who
  want the amber detail on screen permanently rather than clicking Details.
- **Focus pill contrast (R2).** The on-state "Focus · Esc" pill gained a full
  accent border and brighter text so it reads clearly on the dark nav.

Demand/triage alert thresholds remain configurable in Options (Submissions /
Triage); only the waiting-room minutes are fixed.

## [v3.96.5] — 2026-06-15

### Palette drift-guard across Slots, Reception and the tokens

Completes the colour-palette unification. The user-colour swatch list is
referenced from three places that cannot import one another — the ESM
`pill-prefs.js` (`SWATCH_KEYS`), the classic `reception-pathway-utils.js`
(`TILE_COLOUR_KEYS`), and the `--swatch-*` design tokens in `panel.css`. A new
`test-pill-palette-sync.js` pins all three together so they can't drift, the same
convert-drift-into-CI-failure approach used for clinical thresholds. Reception's
organise logic is intentionally left as-is (it is richer than the shared helper —
alpha sort, id validation, prototype-pollution guard — so merging it would
regress it); only the shared palette is unified and guarded.

## [v3.96.4] — 2026-06-15

### Shared pill organise-mode helper (extraction)

The Slots pill organise mode (drag-reorder + per-item colour) had its data layer
inline. Extracted the reusable parts — the colour-key list, prefs validation, and
the ordering rule — into a shared `pill-prefs.js` module (`SWATCH_KEYS`,
`sanitisePillPrefs`, `applyPillOrder`) so any categorical-pill surface can adopt
the same configurable behaviour without re-implementing it. Slots now consumes
the shared module; behaviour is unchanged (verified: saved order and custom
colours render identically). Note: Condor and Capacity pills are RAG *status*,
not categorical, so colour config does not apply there; Reception (which already
has its own copy) converges onto this helper in a later pass.

## [v3.96.3] — 2026-06-15

### Config foundation: one canonical user-colour palette

Groundwork for carrying the Slots organise mode (drag-reorder + per-item colour)
across the suite. The user-colour swatches were duplicated as raw hex in two
places (Slots pills and Reception pathway tiles) and didn't adapt to dark theme.
They are now canonical `--swatch-*` tokens (slate/red/orange/amber/green/teal/
blue/purple/pink), defined once with dark-theme legibility lifts, and both
surfaces consume them. Light is unchanged; dark-mode user colours are now
legible. Non-clinical by definition — an actual amber/red alert always overrides
a user swatch, and a red pill's fill stays locked. No behaviour change; this is
the shared palette the forthcoming inline organise-mode rollout builds on.

## [v3.96.2] — 2026-06-15

### Focus mode is now legible and escapable (design-crit pass)

A three-critic review (art director, code surveyor, fresh-eyes GP) converged on
one problem: Focus mode's ON state was invisible and its exit unknowable — a
non-technical user reads the vanished brand and labels as "the panel broke",
with only a faint accent tint on one ambiguous icon to explain it. Fixed:

- **On-state exit pill.** While Focus mode is on, a "Focus · Esc" pill (the
  canonical `.pill` in the accent, non-clinical colour — never amber/red, so it
  can't compete with alert strips) appears where the brand was. It names the
  mode, shows the shortcut, and is itself clickable to leave.
- **Clearer toggle.** The button glyph changed from corner-brackets (which read
  as "fullscreen") to a crosshair that reads as "focus", and is now distinct
  from the pop-out and settings icons beside it.
- **Accessibility.** The toggle gains an `aria-label`; its active state keeps the
  accent tint on hover; and Esc no longer flips Focus mode while you are typing
  in a field. Panel and pop-out kept in lock-step.

## [v3.96.1] — 2026-06-15

### Roll-up polish: worst wait-time on the pill, separated setup card

Two more Practice-appraisal fixes:

- **Worst wait surfaced (F4).** The collapsed waiting pill now shows the longest
  single wait alongside the count ("Waiting 3 · 55m"), so a patient creeping
  toward a breach is visible without expanding — a 12-minute and a 55-minute
  wait no longer look identical. Added as an optional `.pill-meta` slot on the
  canonical pill (muted mono secondary datum).
- **Setup card separated (F7).** The first-run setup card now has breathing room
  above it, so its EXPAND/DISMISS controls are no longer flush under the alert
  roll-up's DETAILS toggle (a mis-click hazard the panel flagged).

## [v3.96.0] — 2026-06-15

### Canonical pill, and the alert roll-up adopts it (Atelier foundation pass)

The appointment-type pills on the Slots page — a coloured dot, a name, and a
count — are the suite's best small component, so they are now the **canonical
`.pill`** in the design canon (TOKENS.md): a dot (category/severity carrier), a
name in the human/sans voice, and a count in the machine/mono voice. Colour
rides on two custom properties (`--pill-line`, `--pill-fill`) so a forthcoming
organise mode can set them per pill.

The alert roll-up is the first surface to adopt it, which lands two appraisal
fixes at once:

- **Reconcilable counts (F1).** The collapsed pills now show the actual flagged
  total — "Demand 115" sums to the expanded "Medical 70 / Admin 45" — instead of
  a category count that read as "2". The manager can tie the number to the
  detail.
- **Colourblind-safe severity (F3).** Severity no longer rides on hue alone: a
  **red** pill has a filled dot, an **amber** pill a hollow ring dot, so the two
  tiers are distinguishable by shape under colourblind mode.

Safety: a red pill's fill is locked to the red wash — the planned colour config
will be able to change a red pill's border only, never neutralise its red fill.
Other per-surface pills (Slots, Condor, the strips) converge on the canonical
pill in a later pass; nothing else was restyled here.

## [v3.95.0] — 2026-06-15

### Alert roll-up — one severity bar when alerts pile up

The three demand strips (waiting room, triage, submissions demand) used to stack
independently below the nav, competing for the same scarce vertical space when more
than one fired at once. They now collapse into a single **roll-up bar** at the highest
severity:

- **Appears only when 2+ strips are elevated** (amber/red). One or zero elevated alerts
  behaves exactly as before — no change in the common case. Green/calm states never count
  as elevated, so the bar only shows when there's genuinely more than one signal.
- **Severity-ordered summary:** an icon at max severity, an "N alerts" count, and a pill
  per elevated channel (Waiting / Triage / Demand) with its own amber/red colour.
- **Expandable for detail:** click the bar (chevron) to reveal the full original strips
  — patient names, triage buckets, demand counts. **Red auto-expands**; amber starts
  collapsed. Your expand/collapse choice sticks until the alert set changes.
- Each strip's poller is untouched — it still renders its own DOM and simply reports its
  resulting level to the shared roll-up. Backoff, caching and click-through all unchanged.
- Plays with **Focus mode**: the roll-up is a signal, so Zen never hides it.

## [v3.94.0] — 2026-06-15

### Focus (Zen) mode — declutter the chrome, keep the signal

A new **focus mode** strips the panel back to the active module for heads-down work
in the narrow side panel. Toggle it from the new focus button in the nav, with
**Ctrl/Cmd + .**, or via the command palette ("Focus mode: toggle"). **Esc** exits.

- **What it hides:** the brand, the nav tab labels (tabs collapse to icons, so more
  fit without scrolling), the overflow fade/arrows, and any *calm/green* demand strips.
- **What it never hides:** amber and red waiting-room, triage and demand strips. Zen
  touches chrome and calm decoration only — a clinical signal can never be suppressed
  by it. This mirrors the Quiet-mode safety boundary (presentation, never signal).
- **Persistent + synced.** State rides on `suite.display.zen`, so it survives reopen
  and stays in lock-step between the docked panel and the floating pop-out, applied as
  `html[data-zen]` by the shared display-prefs applicator.
- Distinct from **Quiet/clinic mode**, which mutes notifications: Zen is purely visual.

## [v3.93.1] — 2026-06-15

### Combo result rules: full authoring parity across all three builders

Combo rules can now be authored from **every** result-rule surface, not just the
inspector:

- **Manual rule editor.** "Combo (multi-condition)" is now a first-class option in the
  rule-type dropdown. Choosing it reveals the inline condition builder (escalate-to
  level + per-condition cards, each numeric or text) and hides the single-analyte fields
  that don't apply. The footer **Save rule** builds, validates and persists the combo via
  the same path as every other rule, honouring the **Enabled** checkbox. Editing an
  existing combo repopulates its level and conditions.
- **Result inspector.** With the editor in combo mode, clicking a parsed result
  name/specimen still seeds the **active** condition. The old standalone combo
  `<details>` panel was folded into the unified builder — one save path, no duplicate
  controls.
- **LLM-assisted paste import.** The import **preview** now summarises a combo rule
  correctly (e.g. _"Sterile pyuria — Combo (amber): 2 conditions, all must match — will
  import DISABLED · pus cells ≥ 40 AND culture ∋ 'no growth'"_) instead of the previous
  garbled numeric-style line. Combo rules already validated and imported; only the
  preview was wrong.

No engine, shipped-rule, chip or `defaults.json` change — UI-only follow-up to v3.93.0.

## [v3.93.0] — 2026-06-15

### Investigation Results queue: combo (multi-condition) result rules + sterile-pyuria flagship

The Triage Lens result-triage queue can now raise severity from **combo rules** — result
rules that fire only when **several analyte conditions are all satisfied on the same
report**, capturing clinically significant patterns that no single per-analyte chip can
see.

**Flagship rule (`base-urine-sterile-pyuria`).** Fires **amber** when a urine/MSU/CSU
report shows raised pus/white cells on microscopy (numeric, above threshold) **AND** a
negative urine culture ("no growth" / "no significant growth" / "sterile" / etc.) — the
classic **sterile-pyuria** pattern. Previously this slipped through: the microscopy chip
and the "No growth" culture info-chip each looked individually unremarkable, so the
combination went unflagged. Ships **enabled**, **escalate-only/amber**.

**Generic combo capability.** The new `combo` rule kind in `resultRules` takes a
`conditions` array (numeric `comparator`/`value` and/or text `contains` conditions, each
scoped by analyte `match` + `specimen`); a fired combo contributes `comboCount` /
`comboTop` to the report severity and raises level to amber (or red if the combo's `level`
is red). Combo evaluation is **fail-safe**: if a numeric condition has no parseable value
the combo simply does not fire (a possible false-negative, never a false-positive), and
the report's own lab reference-range flags are unaffected.

**New queue chip.** A fired combo renders an attributable `queue.resultCombo` chip
(amber/review styling) carrying the combo's label (e.g. "Sterile pyuria — pus cells
raised, culture negative"). The chip is additive attention only — it never files,
actions, or asserts "safe to file", and chip absence remains no assurance.

Shipped-config (`defaults.json`) integer version bumped 15 → 16 so the new `combo` rule
and `queue.resultCombo` systemChip migrate to existing installs. Hazard log H-030 updated
to cover combo rules (escalate-only; fail-safe on missing microscopy data; lab flags
unaffected).

## [v3.92.2] — 2026-06-15

### Hotfix: patient-record visualiser button dead after the PDF.js 4.x upgrade (CSP regression)

The v3.91.5/v3.92.1 PDF.js 4.2.67 upgrade loaded the library via an **inline**
`<script type="module">` in `visualiser-core.html`. But the visualiser is an MV3
extension page, and the default extension-page CSP (`script-src 'self'`) **blocks all
inline scripts** — so `window.pdfjsLib` was never created, and `visualiser-core.js`'s
top-level `pdfjsLib.GlobalWorkerOptions.workerSrc = …` threw immediately, aborting the
whole file *before* the drop-zone/file-input was wired. Result: the visualiser's
open-PDF button did nothing. (This is the manual render smoke-test gap flagged in
v3.91.5 — now caught and fixed.)

**Fix.** PDF.js is now loaded **lazily on first file-open** via a same-origin dynamic
`import(chrome.runtime.getURL('vendor/pdf.min.js'))` (CSP-clean — no inline script, no
global, no script-ordering dependency), with the worker configured at that point. The
UI/drop-zone wiring no longer depends on PDF.js being ready, so the button works
regardless. An explicit `content_security_policy.extension_pages` is now declared in
`manifest.json` (matches the prior implicit default; makes the policy visible).

**Verification.** A new headless harness (`scripts/verify-visualiser.mjs`, Playwright +
Chromium) loads the page through a server that stamps the real MV3 CSP
(`script-src 'self'`) on every response, and asserts: no CSP violations/exceptions on
load, PDF.js resolves under the CSP, the drop-zone + file input are wired, and a minimal
PDF parses end-to-end (drop screen → app view). The harness self-validates faithfulness
(it confirms Chromium *does* refuse an inline module under the same CSP), so it would have
caught this regression. Still PDF.js 4.2.67 (CVE-2024-4367 fix retained).

## [v3.92.1] — 2026-06-15

### Integrate repo-audit follow-ups onto v3.92.0

Merges the audit follow-up work (security, clinical-safety, test, performance,
devex and doc fixes — staged on the branch as v3.91.2–v3.91.6) on top of the
v3.92.0 result-inspector release. The two lines did not conflict in code (the
PDF.js upgrade, attribute-escaping XSS fix, and shared triage matcher are
independent of the v3.92.0 click-to-build inspector work); only the manifest
version and CHANGELOG were reconciled, and the version advanced to 3.92.1. See
the v3.91.2–v3.91.6 entries below for detail.

> ⚠️ Still carries the **PDF.js 4.2.67 render smoke-test** action from v3.91.5 —
> open the visualiser and load a real PDF before relying on this release.

## [v3.92.0] — 2026-06-15

### Build a result rule by clicking what the inspector parsed + clearer "Load" guidance

**Click-to-add from the parsed table.** In the result-rule inspector, each parsed
line's **name** and **specimen** cells are now clickable. Clicking a name adds it to the
rule's **Analyte match**; clicking a specimen header adds it to **Specimen scope** —
which is exactly what stops a "Culture" rule firing on urine/blood as well as throat
swabs (the original MC&S overlap problem). Cells are keyboard-accessible (Enter/Space)
and flash green on add; adds are deduped case-insensitively. The existing "Seen this
session" suggestion pills now share the same append helper (`appendUniqueLine`, unit-tested).

So the full build-a-rule flow is now: open the queue → Load a recent result → click the
analyte and its specimen straight out of the parsed table into the rule.

**Clearer "Load a recent result" guidance.** "Load" reads a *live* Medicus tab whose
results queue has loaded; if you open Settings *over* your Medicus tab it closes that
session and there's nothing to read. The empty-states now say so explicitly, and a
permanent hint under the button tells you up-front to keep the Medicus results queue open
in a **separate window** — and that you can click a name/specimen to build the rule. (This
was the confusion behind "the button does nothing": it works, but needs the Medicus tab
alive alongside Settings.)

## [v3.91.6] — 2026-06-15

### Clinical safety: Triage Lens rule preview now uses the live matcher (no divergence)

The Options-page rule **preview** re-implemented rule matching with its own
`compileRule` — a different object shape from the runtime, and a silent `catch(e){}`
that dropped invalid regexes with no feedback. So the preview could tell a clinician a
rule fires (or not) differently from what actually fires on the live queue — and a
malformed pattern showed simply "no match" rather than an error.

Matching is now a single source of truth: a shared `content-scripts/triage-lens/rule-match.js`
(`window.TriageLensMatch.compileRule` / `ruleMatchesText`) lifted verbatim from the content
script. Both the live content script and the preview delegate to it, so they cannot drift.
Invalid patterns are now **surfaced** in the preview ("N patterns failed to compile and were
skipped: …") instead of silently dropped. `EMBEDDED_DEFAULTS` is untouched (the 3-copy
defaults guard still passes). New `test-triage-preview-parity.js` exercises the shared matcher
(stem vs regex mode, null/empty cases, invalid-regex surfacing) and asserts by source that
both files route through it with no private copy remaining.

## [v3.91.5] — 2026-06-15

### Security: upgrade vendored PDF.js 3.11.174 → 4.2.67 (CVE-2024-4367)

The visualiser vendored PDF.js 3.11.174, which is affected by **CVE-2024-4367** (a crafted
PDF can execute arbitrary JS via the font path). It was already mitigated by calling
`getDocument({ isEvalSupported: false })`, but the library itself was unpatched. This
upgrades to **4.2.67**, the exact patch release that fixes the CVE.

PDF.js 4.x ships **ESM-only** (there is no UMD/classic-script build), so `visualiser-core.html`
now loads it via a small inline `<script type="module">` that imports the namespace and
re-exposes it as `window.pdfjsLib`, with the subsequent scripts deferred so they still run
in document order after the module evaluates. Every PDF.js API the visualiser uses
(`GlobalWorkerOptions.workerSrc`, `getDocument` + `isEvalSupported`, `getPage`,
`getTextContent`, the `TextItem` shape) was verified to exist unchanged in 4.2.67;
`visualiser-core.js` itself needed no changes. `vendor-versions.json` updated (versions,
upstream URLs, SHA-256) and `verify-vendor.js` passes.

> ⚠️ **Manual render smoke-test required before this ships in a release.** This change was
> verified statically (API presence, checksums, full test suite) but PDFs cannot be rendered
> in CI. Before tagging a release, open the visualiser, load a real EPR export PDF, and
> confirm text extraction + all tabs render with no `pdfjsLib`/worker console errors.

## [v3.91.4] — 2026-06-15

### Audit follow-up: end-to-end pipeline integration test

Adds `test-pipeline-e2e.js`, closing the audit's top test-coverage gap. The existing
suite tested each clinical stage in isolation but nothing chained the real stages
together — `test-alert-builder.js` calls `evaluatePatient` with hand-built mocks that
bypass the normaliser, so a contract mismatch between the normaliser's output shape and
what the rules engine reads (e.g. a med-name field rename) would pass every unit test yet
silently drop a real monitoring alert. The new test runs raw API-shaped data through the
**real** `engine/normalisers.js` → `engine/rules-engine.js` `evaluatePatient` →
`shared/chip-renderer.js`, asserting an overdue methotrexate patient produces an overdue
drug-monitoring chip (with the FBC/U&E/LFT test names threaded all the way to the rendered
HTML), plus two negative controls (wrong drug → no chip; bloods in-date → in_date not
overdue). It pins the specific seam fields (`med.name`, `obs.name`, `obs.date`) so a future
rename fails the test. Writing it immediately caught one such detail — the engine spreads
`rule.tests[]` unchanged, so the chip field is `t.name`, not `t.testName`.

## [v3.91.3] — 2026-06-15

### Audit follow-up: cache eviction + test hardening

Picking up low-risk items from the repo audit:

- **Queue result-cache eviction.** `_queueResultCache` in the Triage Lens content script
  had a TTL used only to *skip* stale entries on read but was never *evicted*, so on a
  long-lived Medicus tab it grew one entry per task UUID seen for the page's lifetime. It
  now prunes entries older than 2× its TTL on each queue (re)entry — mirroring the sibling
  `_queueMonCache` prune exactly.
- **Stronger tests.** Fixed an always-true assertion in `test-import-hardening.js` that was
  meant to prove the `constructor` own-key is stripped during a prototype-pollution-hardening
  merge (it now genuinely fails if the strip is removed), and replaced a tautological
  analyte-selection check in `test-viewer-phase1.js` (which asserted a hand-copied expression
  against itself) with one that vm-extracts and exercises the real `computeConditionSummaries`
  longest-match logic from `visualiser-core.js`.

## [v3.91.2] — 2026-06-15

### Security: close attribute-injection XSS in side-panel chip / rule renderers

A repo audit found that several `escHtml` helpers escape only `&`, `<` and `>` — **not**
the double-quote `"` — yet were being used to interpolate untrusted data into
double-quoted HTML attributes. Because angle brackets were escaped, raw `<script>`
injection was already blocked, but a value containing a `"` could break out of the
attribute and inject an event-handler attribute (`x" onmouseover="…`), i.e. a DOM-based
XSS in the privileged side-panel context. The reachable vectors:

- **`shared/chip-renderer.js`** — patient medication names (`chip.drugName`, straight from
  the Medicus API) and rule ids flowed into `data-evidence-key` / `data-rule-id` / `title`
  attributes via the quote-unsafe `escHtml`.
- **`side-panel/modules/sentinel/sentinel.js`** — the brief patient line, copy-action key
  and rule-currency / journal-error tooltips, into `title=` / `data-act-key=` attributes.
- **`sentinel-options/options.js`** — imported custom-rule ids into `data-rule-id=` /
  `data-id=` across all five custom-rule list renderers.

**Fix.** Every attribute-context interpolation now uses the quote-safe `escAttr`
(which additionally escapes `"`); an `escAttr` helper was added to the two files that
lacked one. As defence-in-depth, `validateCustomRule` (`shared/io/sentinel-io.js`) now
constrains an imported rule `id` to `/^custom-[a-z0-9-]{1,60}$/` rather than only
requiring the `custom-` prefix, and the knowledge-base link renderer
(`side-panel/modules/knowledge/knowledge.js`) scheme-checks the `href` (`http(s)`/
`mailto`/`tel` only) at the sink in addition to the existing data-layer sanitisation.
The sentinel side-panel `chrome.runtime.onMessage` listener also gained the `sender.id`
guard its eight siblings already have.

A new `test-xss-attribute-escaping.js` renders a chip with a hostile `"`-bearing drug
name / rule id and asserts the full payload stays contained and quote-escaped inside the
attribute, plus a source guard that fails closed if any fixed file reintroduces the
quote-unsafe `="${escHtml(…)}"` attribute pattern.

## [v3.91.1] — 2026-06-15

### Fix: "Load a recent result" now fetches on demand instead of showing an empty picker

The result-rule inspector's **"Load a recent result"** button (v3.90.0) usually showed
"No recent results captured yet" and appeared to do nothing. The button was firing
correctly — the in-memory store it read was simply empty. That store was only ever
populated as a **side-effect of the queue result-triage chip pipeline**: it required the
user to be sitting on the live queue list, with result-triage chips **enabled**, in the
same tab session (the store is in-memory and clears on reload). Opening an individual
result never populated it, and with result chips off it was never populated at all.

**On-demand fetch.** Clicking the button now makes the Triage Lens content script
**actively fetch and parse** the open queue's results then and there, independent of
whether result-triage chips are enabled or whether the background pass ran. It reuses the
overview URLs the page-world bridge already caches for every queue row it sees, so it
works as long as a Medicus **queue** tab is open. The `getRecentInvestigationResults`
message handler is now async (awaits the collector, returns `true` to keep the channel
open). A new pure `selectOnDemandFetchTargets` helper (caps the fetch fan-out, skips rows
already held, drops malformed/empty entries) is unit-tested in `test-result-inspect-recent.js`.

**Still in-memory only (IG).** The on-demand path persists nothing — same contract as the
passive capture. The empty-state wording now points at opening the result queue (the task
list) rather than the misleading "open a result".

## [v3.91.0] — 2026-06-15

### Choose your tabs — now discoverable in Options, and surfaced for managed installs

The "Choose your tabs" chooser (which writes the user-owned `suite.hiddenTabs` key)
previously had only two entry points, both inside the side panel: the first-run setup
checklist step and the `Ctrl+K` palette command. In a **practice-deployed shared-folder
install** the pushed practice code collapses the setup checklist before a new user ever
reaches the tabs step, and there was **no entry point in the options page at all** — so
new staff effectively never got the chance to pick their tabs.

**New "Tabs" section in Options.** A dedicated section (second in the nav, after Suite)
renders role presets (GP / Reception / Practice manager / Everything) plus a per-tab
toggle grid with a one-line explainer for each tab. It reuses the single source of truth
in `side-panel/tab-catalog.js` and writes the same `suite.hiddenTabs` key, so the side
panel and pop-out live-apply the change immediately via their existing storage listeners.
Loaded as `<script type="module">` (`options/tabs-section.js`) so it can import the
catalog data; the rest of the options page remains classic script.

**Surfaced on the collapsed setup strip.** When the practice code is pre-set (the managed
deployment case), the setup checklist's thin collapsed strip now shows a direct **"Choose
tabs"** button when the tabs step isn't yet done — one click, no need to Expand the full
card — so the recommended tab choice isn't buried for new users.

**Still user-owned.** Tab visibility remains a personal, per-machine preference: a
practice profile never pushes `suite.hiddenTabs` (`shared/io/practice-profile.js`), and
the Options section says so explicitly. Hiding a tab only de-clutters the nav — everything
stays reachable via `Ctrl+K`. A new pure `toggleTabVisibility` helper (tested in
`test-tab-catalog.js`) enforces the never-hide-the-last-tab guarantee on both surfaces.

## [v3.90.0] — 2026-06-15

### Result inspector: load a recent result live (no JSON paste needed)

The result-rule inspector (Triage Lens settings, added in v3.89.0) no longer requires
the user to copy-paste a raw investigation-report API payload. A new
**"Load a recent result"** button queries the open Medicus tab(s) and pulls the most
recently parsed investigation reports straight from the live overlay, presenting them
as a clickable picker (specimen-derived label, line count, relative capture time).
Selecting one renders the same parsed `name` / `specimen` / `text` table the paste
path produces.

**Message channel.** The options page calls
`chrome.tabs.sendMessage(tab.id, { action: 'getRecentInvestigationResults' })` against
each `*.medicus.health` tab; the Triage Lens content script answers synchronously with
`{ ok: true, results: [{ id, label, capturedAt, lines: [{ name, specimen, text }] }] }`.
The content-script listener accepts only messages from this extension's own contexts
(sender-id checked) and is wrapped so a thrown handler can never break the host page.

**No persistence (IG).** Captured results live **in memory only**, in a page-scoped,
newest-first store hard-capped at 20 entries, deduped by task UUID. Nothing is ever
written to `chrome.storage` or anywhere at rest, on either side of the channel; the
options-page copy is likewise session-only. Labels are derived purely from specimen
names plus a line count and carry no patient identifiers.

**Paste box retained as a fallback.** The raw-JSON paste path is preserved, demoted to a
collapsed "Or paste a raw response manually" section for offline / saved-payload use.
The inspector render path now also tolerates a malformed payload whose `lines` array
contains `null` / non-object entries — they are dropped before any field access so a
hostile or buggy response degrades gracefully instead of throwing.

## [v3.89.0] — 2026-06-15

### Result-rule authoring: inspector + specimen-scope UI + in-session suggestions

Three user-discoverable additions to the result-rule editor in Triage Lens settings,
building on the `analyte.specimen` engine foundation landed in v3.88.0:

**`analyte.specimen` field** — the specimen-scope array now has a proper UI field
("Specimen scope") in the editor left column. Previously the field could only be set
via LLM import or raw JSON; it now round-trips through the editor's save/load path.

**Result inspector** — a collapsible panel in the editor right column. The user pastes
a raw investigation-report API JSON payload (no live patient data is fetched — this is
user-initiated copy-paste). The panel runs the payload through the real
`normaliseInvestigationReport` normaliser and displays a table of every result line
with the three fields the engine uses: `name` (what analyte-match tests against),
`specimen` (what specimen-scope tests against), and `text` (what the normal-phrase
search scans). No parsed values are written to `chrome.storage` or any persistent
store — they are shown in the panel and discarded when the page closes.

**In-session suggestion pills** — after an inspect run, unique `name` and `specimen`
strings observed are added to in-session (closure-only, never persisted) lists. Pill
buttons appear below the "Test match" and "Specimen scope" fields; clicking a pill
appends its value to the relevant textarea so the user picks the real lab string
without guessing. Lists accumulate across multiple inspect runs in the same page
session and are cleared when the options page is closed.

**Privacy decision (hard constraint):** deliverable 2 (suggestion lists) is fully
implemented because the source data is never persisted. Suggestions come exclusively
from values the user pastes into the inspector textarea in the current session. If the
user never runs the inspector the suggestion UI stays hidden.

## [v3.88.0] — 2026-06-15

### Specimen-header capture and `analyte.specimen` scoping for result rules

Adds a new feature that lets text result rules be scoped to a specific specimen
type (e.g. throat swab vs urine culture), preventing a "Culture" analyte row from
being matched by rules intended for a different specimen.

**Normaliser — specimen header capture (fail-open):**
`normaliseInvestigationReport` now reads the group's human-readable title from an
ordered candidate-key list (`groupName`, `name`, `title`, `heading`, `description`)
and attaches it to each result as a new `specimen` field (trimmed string, or `null`
if not discoverable). This is strictly fail-open: results with no discoverable
header get `specimen: null` and behave exactly as before.

**Rule schema — optional `analyte.specimen`:**
The result rule schema now accepts an optional `analyte.specimen` array (same shape
as `analyte.exclude`) for both `text` and `threshold` rules. Validation is in
`engine/result-rules.js`; the authoring prompt (`resultRuleSchemaPrompt`) documents
the field in both schema sections.

**Matching — fail-open AND-filter:**
Both `computeTextOutcome` and `computeRuleSev` in `engine/result-severity.js` now
apply a `specimenAllows(analyte, result)` gate after the existing name-hit and
exclude checks:
- No `analyte.specimen` (absent or empty) → pass (no behaviour change).
- `analyte.specimen` present AND `result.specimen` is non-empty → at least one term
  must be a case-insensitive substring of `result.specimen`; otherwise the rule is
  skipped for this result.
- `analyte.specimen` present but `result.specimen` is absent/null/empty → **pass
  (fail-open)**. A rule is never dropped because the specimen header was not captured.

**New starter rule — `base-throat-swab` (conservative; verify against real lab output):**
A new builtin text rule scoped to throat-swab specimen headers (`analyte.specimen:
["throat swab", "throat"]`). Conservative `normalText` covers only clearly-negative
whole phrases (Beta haemolytic Streptococcus not isolated, no anaerobes isolated).
`abnormalText` covers specific positive phrases (beta haemolytic streptococcus
isolated, group A streptococcus isolated). "Culture to follow" is deliberately
excluded from `normalText` (pending result — calming it would be a false-negative
hazard). **Clinical teams should verify this rule against real lab output before
relying on it.** Defaults.json `"version"` bumped 14→15.

## [v3.87.2] — 2026-06-15

### Accept right inside the Central attestations box

Previously the "Accept for practice" control lived only in Clinical Safety, so a
greyed-out central-attestation gate meant navigating away to unlock it. The
Central attestations box (Backup & Restore → Publish to shared folder) now has its
own inline **Accept all for this practice** control (same safety-gated tick +
action), so all three gates can be accepted and unlocked in place. The accept
logic is now shared between the two controls.

## [v3.87.1] — 2026-06-15

### "Accept for practice" now unlocks all three central attestations

The practice-profile "Central attestations" box (Backup & Restore → Publish to
shared folder) greyed out the alert-library and knowledge gates until each was
accepted locally. The single "Accept this for practice" switch
(`suite.practiceAcceptedAt`) now satisfies all three gates at once, so ticking it
makes all three central attestations tickable in one go. The box also explains
this, so a greyed gate is no longer a dead end.

## [v3.87.0] — 2026-06-15

### Single "Accept this for practice" switch (Options → Clinical Safety)

Replaces the scattered per-feature acceptance with one clearly safety-gated tick
that switches on the features that ship off by default, and that propagates across
the practice via backup/restore.

- **One control** in Options → Clinical Safety: a confirmation tick ("a clinician /
  CSO / nominated GP has read the Clinical Safety Notice and accepts these features
  for the whole practice") plus an **Accept for this practice** button, with a
  **Withdraw** action. It sets a single suite-level flag `suite.practiceAcceptedAt`
  and fans out to enable all reception pathways + acknowledge the Sentinel alert
  library.
- **Honoured by the gates:** the reception capture gate and the knowledge notice
  now unlock from `suite.practiceAcceptedAt` as well as their own per-install
  attestation — so the single switch turns them on.
- **Propagates via backup (the fix for the "central override"):** unlike the
  per-install attestations (reception disclaimer, knowledge notice), this flag is
  carried in a suite backup (`suite-io.js`), so restoring a backup on another
  machine enables the accepted features there. The restore preview now warns
  loudly when a backup carries practice acceptance.
- The existing per-install reception disclaimer and the practice-profile
  attestation gates are unchanged and still work.

## [v3.86.3] — 2026-06-15

### Removed: Reception "Referrals on file" card

The reception referrals card did not work reliably against live Medicus and has
been removed. The reception module (`reception.js`/`reception-core.js`/CSS) and the
Referrals module + API (`referrals-api.js`, `referrals.js`) are restored to their
pre-feature (v3.84.3) state, so the Referrals tab is back to its known-good
behaviour. The appraisal notes are retained in `docs/appraisal/` as a record.

## [v3.86.2] — 2026-06-15

### Reception referrals — wording tweaks from the re-poll

- Populated card now states explicitly that referrals **older than 12 months are
  not shown** (so an outstanding older referral isn't assumed absent).
- Empty result now reads as a *completed* search ("Referral lookup ran — no
  referrals found under this name …") so it is clearly distinct from the
  load-error state.

(See `docs/appraisal/PRACTICE-referrals-on-file-2026-06-15.md` §7–8 for the
re-poll scores and the parked "Most seen clinician" feature verdict.)

## [v3.86.1] — 2026-06-15

### Reception referrals — red-team hardening

- **Practice-code host injection (SSRF) fixed.** `suite.practiceCode` is importable
  via backup and was read back unvalidated, then interpolated straight into the
  referral request host. `referrals-api.js` now validates the code
  (`/^[a-f0-9]{4,8}$/i`, mirroring activity-api's F8 guard) before building the
  canonical URL, AND refuses to fetch any URL whose host is not
  `*.api.england.medicus.health` — covering both the canonical build and any
  discovered/captured template URL. A poisoned code/discovery URL now fails closed
  instead of sending a credentialed fetch to an attacker host.
- **Capture-note integrity.** Referral display fields (service/hospital/clinician)
  are sanitised (control chars and newlines collapsed) before they reach the
  plain-text reception capture note, so a malformed API value can't forge a
  separate line such as a fake "*** RED FLAG" in the pasted record. The on-card
  rendering was already `esc()`-safe against XSS.

## [v3.86.0] — 2026-06-15

### Reception "Referrals on file" — no setup step, faster, safer wording

Follow-up to v3.85.0 after a performance pass and a synthetic in-practice
appraisal (`docs/appraisal/PRACTICE-referrals-on-file-2026-06-15.md`).

- **Works without opening the Referrals tab first.** The card no longer requires
  the Clinical Audit Report to have been visited. When no discovered URL is
  present it builds the canonical `clinical-audit-report` endpoint from the
  practice code (`ReferralsApi.buildCanonicalUrl`). The "open the report once"
  message is now only a graceful fallback shown if the auto-fetch fails.
- **Shared in-memory cache.** Reception and the Referrals tab now share one
  in-memory referral cache (`ReferralsApi.cacheGet/cachePut/cacheClear`), so the
  card reuses a fetch the tab already made when the window is covered (cached
  range must *fully contain* the request, so a 30-day cache never silently
  satisfies a 12-month one). Still RAM-only, never persisted, dropped on unmount.
- **Concurrent-fetch guard** in the reception card so tab switches don't launch
  duplicate practice-wide pulls.
- **Referrals tab faster:** the activity report is now fetched only for the Rate
  view (loaded lazily on switch) instead of on every load, and the per-page
  progress update no longer triggers a full module re-render mid-load.
- **Safety wording (from the appraisal):** the "matched by name" caveat is now a
  prominent note **above** the list (not a grey footer); the populated card states
  the 12-month window and what Incomplete means; the empty state is reworded so it
  cannot read as "this patient has no referrals" (it now says "no referrals found
  *under this name* … check the record if referred under another name").
- **Readability:** priority shows as **2WW** not `TWOWEEKWAIT`; the clinician is
  labelled "Referred by"; a "last updated" time is shown.
- The 12-month window was **deliberately kept** (not shortened) because the same
  appraisal flagged a shorter window as a clinical-completeness risk; the speed
  comes from caching, not from dropping older referrals.

## [v3.85.0] — 2026-06-15

### Reception: "Referrals on file" — who referred what, to where, and when

The Reception tab now surfaces the open patient's existing referrals — answering
"who referred them, to which service/hospital, and when" at a glance while the
caller is on the phone.

- **New "Referrals on file" card** between the Patient pill and Guided capture.
  Shows up to five recent referrals (last 12 months): the service/specialty and
  hospital (*what / where*), the referring clinician (*who*), the referral date
  (*when*), plus priority (Routine / Urgent / 2WW) and status badges.
- **Source** — reuses the practice-wide Referrals → Clinical Audit Report feed
  (`referrals.discovery`). If that report hasn't been opened in Medicus yet, the
  card prompts to do so once to switch the lookup on.
- **Matched by name, flagged as such** — the referral report carries no NHS
  number, so rows are matched to the open record by full name (every given- and
  family-name token must match) and the card/output both say *"matched by name —
  confirm it's the right patient"*. Never asserts a confirmed identity.
- **Folded into the capture text** — the most recent matched referrals are added
  to the generated copy-paste summary under a clearly-captioned heading.
- **Privacy** — the fetched report (which includes other patients' names) is held
  in memory only, never persisted, and dropped on unmount (mirrors the referrals
  module's Audit-M1 discovery-URL-only rule).
- New pure helper `referralMatchesPatient` with regression tests.

## [v3.84.3] — 2026-06-15

### Brand identity + app icon

Gave the suite a visual identity of its own (it previously had only a placeholder
lozenge). Developed iteratively against a synthetic in-practice appraisal panel.

- **App icon** — a brushed-gold guardian **shield** with a cyan ECG/pulse line
  and beacon on a deep navy tile (`brand/app-icon.png`, 512px master). The pulse
  makes the clinical purpose explicit; the shield signals protective vigilance.
  48px and 128px icons derive from the master; the 16px favicon renders from a
  dedicated simplified vector (`brand/app-icon-16.svg`) so it stays legible.
  `brand/generate-icons.mjs` produces `icons/icon-16/48/128.png`.
- **Wired into the surfaces** — side-panel nav, pop-out titlebar, Options sidebar,
  About panel (brand header + tagline), visualiser drop screen, and the README
  banner all show the mark.
- **Tagline / store description** — "The clinical intelligence layer for Medicus"
  added to the About panel and Options; `manifest.json` description rewritten from
  the version stamp to a descriptive one-liner.
- **`brand/BRAND.md`** — one-page brand guide (mark, colours, regeneration, where
  it appears). `eslint.config.mjs` gains a `brand/**/*.mjs` Node block; the release
  zip excludes the dev icon generator.

## [v3.84.2] — 2026-06-14

### DTAC assessment — governance drafts + CSO GMC correction

Documentation-only step toward NHS Digital Technology Assessment Criteria (DTAC)
readiness. No code, rules, `defaults.json`, or clinical-threshold changes.

First, corrected an incorrect General Medical Council registration number for the
Clinical Safety Officer (Dr Dave Triska) — now the correct **GMC 6159481** in all
six places it appeared (`CLINICAL-SAFETY-NOTICE.md`, `HAZARD-LOG.md`, `SOUP.md`).

Then added seven DRAFT governance documents mapping existing artefacts onto the
DTAC domains (they assemble and reference the hazard log, safety notice, intended
purpose, SOUP, and security audit):

- `docs/CLINICAL-SAFETY-CASE-REPORT.md` (MS-CSO-CSCR-001) — DCB0129-style safety
  case summarising the hazard log and controls (Section A).
- `docs/DPIA.md` (MS-DPO-DPIA-001) — Data Protection Impact Assessment for the
  local-only, zero-egress processing model (Section B).
- `docs/INTEROPERABILITY-STATEMENT.md` (MS-DOC-INTEROP-001) — reasoned N/A
  statement (Section D).
- `docs/CSO-DECLARATION.md` (MS-CSO-DECL-001 + MS-CSO-DCB0160-001) — CSO
  declaration plus a deploying-organisation (DCB0160-style) hand-off note.
- `docs/ACCESSIBILITY-STATEMENT.md` (MS-DOC-A11Y-001) — heuristic WCAG 2.1 AA
  self-assessment with disclosed known gaps (Section E).
- `docs/DTAC-STATUS.md` (MS-DOC-DTAC-001) — readiness tracker across all DTAC
  domains.
- `docs/CLINICAL-SAFETY-RESYNC-v3.84.2-DRAFT.md` (MS-CSO-RESYNC-001) — DRAFT CSO
  change-proposal preparing audit task T4: classifies every release v3.65.0 →
  v3.84.2, concludes no new hazard arises and no residual increases, and proposes
  the specific edits to bring the three signed safety docs onto current.

All are marked DRAFT pending sign-off and carry placeholders for facts held
outside the repo (ICO registration number, sign-off dates, signature).

## [v3.84.1] — 2026-06-14

### Repo-audit follow-up: testable logic cores + RAG single-source-of-truth + regenerated feature list

Acting on the principal-engineer repo audit (HIGH finding: side-panel modules had
logic branches reachable only through the DOM, so form-validation and threshold
edge cases were untested). Pure-logic cores extracted from two of the largest
modules, with no behaviour change. Feature list regenerated to v3.84.1.

- **`side-panel/modules/capacity/capacity-core.js`** — extracted `minimumForDate`
  (per-weekday minimum with legacy `minimumPerDay` fallback), `defaultMinimumByDay`,
  `presetSummary`, and a new pure `validatePreset` (replacing the inline save-path
  validation in `capacity.js`). 23 assertions in `test-capacity-core.js`, including
  the "explicit 0 on a weekday is honoured, not treated as missing" edge case.
- **`side-panel/modules/submissions/submissions-core.js`** — extracted the RAG
  (red/amber/green) threshold logic as the **single source of truth** for both the
  Submissions charts and the global `#subRagStrip` in `panel.js`. The two had
  duplicate inline copies (`getRagLevel` / `_subRagLevel`) that could silently
  drift — a missed amber/red is a demand-management failure. Both now import
  `ragLevel` / `getRagLevel` / `DEFAULT_SUB_THRESHOLDS` from the core. 18
  assertions in `test-submissions-core.js`.
- **`SECURITY.md`** — added a "Backup data minimisation" section documenting the
  config-only export policy, the two enforced PHI exclusions (`referrals.discovery`,
  `sentinel.extractionBaseline`), and the convention for new IO modules.
- **`docs/feature-list.md`** — regenerated to v3.84.1, reflecting all changes since
  v3.77.3: investigation result rules (v3.76–3.77), glossary tooltips (v3.79), clinical
  corrections (v3.80), whole-suite Keeper sweep (v3.81), CSO 999 promotions (v3.81.1),
  central practice attestation (v3.82), Sweep day-picker (v3.83) and multi-clinician
  filter (v3.84).

No clinical-rule or `defaults.json` changes. Pure refactor + tests + docs; all
existing tests pass.

## [v3.84.0] — 2026-06-14

### Pre-clinic Sweep — select several clinicians

The Sweep clinician filter is now multi-select: pick any combination of the day's
clinicians (or leave "All"), for same-day and in-advance sweeps alike.

- The single clinician dropdown is replaced by an "All clinicians" checkbox plus a
  per-clinician checkbox for each clinician booked that day. Ticking any individual
  drops "All"; an empty selection always means all (it can never silently sweep zero).
- Changing the day re-renders the picker and intersect-preserves the selection
  (clinicians not booked the new day are dropped).
- The printable + batch handouts label the audience accordingly: 0 → "All clinicians",
  1 → "&lt;name&gt;'s patients", 2+ → "&lt;name&gt;, &lt;name&gt;… (N clinicians)". The selection is
  persisted and restored on resume (old single-clinician saves still load).
- `extractBookedPatients` gains an `opts.clinicians` array filter; the single
  `opts.clinician` string remains supported. Core dedupe/sort/UUID logic unchanged.

`side-panel/modules/sweep/` (sweep.js, sweep.css, sweep-core.js, handout.js,
batch-handout.js); `test-sweep-core.js` extended (114 assertions). No clinical-rule or
`defaults.json` changes.

## [v3.83.0] — 2026-06-14

### Pre-clinic Sweep — choose the day

The Pre-clinic Sweep was hardwired to today; you can now sweep any day, including
days in advance, and the clinician picker + printed handout follow the chosen day.

- Added a day picker to the Sweep controls (past and future allowed). Both
  appointment-book fetches use the selected day instead of today.
- Changing the day clears stale results, re-fetches that day's book, and repopulates
  the clinician dropdown for that day (resetting a clinician filter that has no clinic
  then). The existing per-clinician filter is unchanged.
- The clinic day is carried into the printable handout and batch handout headers
  ("Pre-clinic sweep for &lt;day&gt;"), distinct from the "generated &lt;timestamp&gt;" line, and
  into the persisted last-run so re-opening restores the swept day. Empty/zero-result
  copy is now day-agnostic. Default behaviour (today) is unchanged.

`side-panel/modules/sweep/` (sweep.js, sweep.css, sweep-core.js handout model,
handout.js, batch-handout.js). Core extraction/sort logic unchanged; `test-sweep-core.js`
covers the new `clinicDate` passthrough. No clinical-rule or `defaults.json` changes.

## [v3.82.0] — 2026-06-14

### Practice profile — central attestation + request-monitor practice-code coupling

Managed deployments can now propagate the practice's clinical config to end users
without each clinician re-confirming, and the Request Monitor works from a published
profile without the user re-entering the practice code.

- **Central practice attestation.** A published profile can carry a signed
  `practiceAttestation { attestedBy, attestedAt, gates }`, built at publish time from
  the gates the practice admin has themselves accepted (reception disclaimer, alert-library
  acknowledgement, knowledge notice). On a managed install, an explicitly-signed gate
  satisfies that per-install attestation, so pushed reception pathways / alert library /
  knowledge activate without a per-user click. Recorded locally under
  `suite.practiceProfile.attestations` and surfaced as "Accepted centrally by &lt;CSO&gt; via
  practice profile". **Fail-safe:** with no attestation block (or a gate not explicitly
  true) behaviour is unchanged — the per-install attestation is never written, and a
  genuine local acceptance is never overwritten or downgraded.
- **Request Monitor practice-code coupling.** Publishing a profile that includes the
  Request Monitor now auto-includes the `suite` module (carrying `suite.practiceCode`) so
  the monitor can poll for managed users, and blocks publishing with a clear warning if the
  admin's own practice code is unset. The code stays in one place (the suite module) — not
  duplicated into the request-monitor section.

`shared/io/practice-profile.js` apply path, `options/options.js` + `options/options.html`
publish flow and reception provenance, `side-panel/modules/knowledge/knowledge.js` central
notice hint. Tests extended in `test-practice-profile.js` (80 assertions). No clinical-rule
or `defaults.json` changes.

## [v3.81.1] — 2026-06-14

### Reception pathways — CSO 999-promotion pass

Following the v3.81.0 CSO sign-off, the practice Clinical Safety Officer promoted five
reception red flags from urgent-duty to **999** on clinical review (`rules/reception-pathways.json`,
v1.3). No wording changed; only the escalation tier:

- Suspected **SJS/TEN** — widespread blistering / mucosal involvement, unwell (rash).
- **Sepsis with rigors** — fever with uncontrollable shivering (UTI pathway).
- Possible **cauda equina** — weakness or numbness in both legs (back pain).
- **Mastoiditis** — redness/swelling behind the ear (earache).
- Suspected **acute angle-closure glaucoma** — red painful eye / halos with headache.

Feverish-child under-3-months remains urgent-duty (CSO decision). No other tiers changed.

## [v3.81.0] — 2026-06-14

### Clinical rule currency — The Keeper sweep, CSO-signed-off

A full six-domain Keeper sweep (report in `docs/keeper/KEEPER-whole-suite-2026-06-14.md`),
applied after practice Clinical Safety Officer sign-off. All additive; no monitoring
weakened. Findings were WebSearch-corroborated (WebFetch was blocked this run) and
confirmed by the CSO before applying; the two highest-value items were verified directly
against the repository.

- **Medication-review instruments (`engine/stopp-start.js`, `engine/acb-scores.js`,
  `visualiser-core.js`):**
  - Synced the STOPP/START ACEi/ARB term lists up to parity with the rest of the suite —
    added `trandolapril, fosinopril, quinapril, imidapril, cilazapril` (ACEi) and
    `telmisartan, azilsartan, eprosartan` (ARB), which were silently unmatched.
  - Added the missing UK beta-blockers `acebutolol, celiprolol, nadolol, oxprenolol` to the
    PINCER high-risk-drug table so the beta-blocker-in-asthma hazard cannot silently miss
    them; added `pitavastatin` to the statin term list.
  - New live STOPP criterion `stopp-anticholinergic-elderly` (amber, age ≥65), reusing the
    shared ACB table at score ≥2; fail-closed on unknown age. Added `amoxapine` (score 2)
    to the ACB table.
- **Medicines monitoring (`rules/drug-rules.json`):** added the brand `jayempi` (licensed UK
  azathioprine oral suspension) to the azathioprine monitoring rule.
- **Prescribing-safety alerts (`rules/alert-library.json`):** added a GLP-1/GIP
  acute-pancreatitis awareness alert (MHRA Drug Safety Update — strengthened warnings,
  including necrotising and fatal cases).
- **QOF (`rules/qof-rules.json`):** added `HF003`/`HF006` as `enabled:false` (retired into
  HF009) for year-on-year diff visibility. The new obesity (OB) register remains disabled
  pending a separate CSO go-live decision.
- **Vaccines (`rules/vaccine-rules.json`):** refreshed `specVersion` and source citations to
  2026/27 (JCVI confirmed no cohort changes) — metadata only, eligibility unchanged.
- **Reception pathways (`rules/reception-pathways.json`):** CSO-signed-off (DRAFT status
  lifted to v1.2); feverish-child under-3-months confirmed as urgent-duty-immediately;
  sepsis citation updated NG51 → NG253/NG254/NG255; headache source NG150 → NG228.
  No red-flag or escalation-tier values changed.

Regression tests extended across `test-drug-brand-coverage.js`, `test-stopp-start.js`,
`test-acb-scores.js`, `test-visualiser-pincer.js`, and `test-custom-rules.js`.

## [v3.80.0] — 2026-06-14

### Three clinical-safety / UX corrections from the Practice appraisal (R2a / R6 / R1)

Targeted follow-ups to the rules engine and the Sentinel monitoring view. No
matching/threshold logic changed — these surface and harden what already fires.

For context, two earlier asks were already satisfied and are NOT rebuilt here: the
silent-false-negative audit (the "Meds without a monitoring rule (N)" disclosure with
exclude annotations + report-missing-brand mailto, `renderUnmatchedMedsSection()`, shown
even in the all-clear state) and the patient identity banner (name / NHS / DOB / age +
"Verify in Medicus", `.sent-patient-banner`). This pass instead surfaces the matched rule
term, guarantees a RED item is never hidden in the digest, and strengthens the identity
label.

- **R2(a) — matched rule term per fired drug alert:** `engine/rules-engine.js` now carries
  `matchedTerm` on each drug-monitoring chip (pure passthrough of the existing
  `drugMatchDetail()` helper). `shared/chip-renderer.js` decorates the drug name span with a
  `data-tip`/`title` tooltip ("Matched monitoring rule on '<term>'") when the term is present
  and not a trivial echo of the displayed name, so a clinician can tell a correct hit from a
  lucky substring. Attribute-only; falls back to native hover.
- **R6 — brief digest must not hide a RED item:** `brief-core.js` `buildBrief()` now also
  returns `moreRed` (how many of the hidden "+N more" chips are red, rank 0). The Sentinel
  brief card annotates the line as `+N more (M red) below` when any hidden chip is red, so a
  red signal beyond the top-4 is never silently swallowed.
- **R1 — identity banner reads as the SUBJECT:** the patient banner gains a muted, uppercase
  `Monitoring for` lead-in label (`.sent-patient-lead`) so it is unmistakable WHO the
  monitoring is about when the waiting-room pinned list sits above it. Prominence/labelling
  only — no cross-system "mismatch" detection (the data to do that reliably is not present).
- **Test:** new `test-drug-matched-term.js` asserts a fired methotrexate chip from the engine
  carries `matchedTerm === 'methotrexate'` (the rule term, not the med display name).

## [v3.79.0] — 2026-06-14

### Glossary tooltips — explain clinical codes & jargon in place (U1/G1/R3)

The whole-suite Practice appraisal flagged that unexplained clinical codes and jargon
have no explanation anywhere (U1), non-clinical reception staff see raw codes (G1), and
the Condor pressure index is a black box (R3). This adds a small click-to-explain tooltip
backbone and wires it into the highest-value spots. No clinical-rule or data changes.

- **New shared backbone:** `shared/glossary.js` (`window.Glossary`) — a small static map
  of jargon with no source text elsewhere (RAG, DMARD, triple-whammy, PPI, eFI, triage
  load). `shared/tooltip.js` (`window.Tip`) — a self-initialising, document-level popover:
  any element carrying `data-tip="…"` or `data-tip-key="<glossary key>"` gets a `cursor:help`
  dotted-underline affordance and opens a `role="tooltip"` popover on click or Enter/Space;
  Esc / outside-click / re-activation closes it, one open at a time. Both are CLASSIC
  scripts loaded in `side-panel/panel.html` and `pop-out/pop-out.html` (glossary before
  tooltip). Everything degrades gracefully — every `data-tip` also sets a matching `title=`
  for native-hover fallback if the scripts never load.
- **Sentinel chips (U1):** the QOF code label (e.g. `AST007`) now explains itself via the
  chip's `indicatorName`; the drug-class label routes `DMARD` to the glossary (other
  classes show their own name); drug-combo labels explain via their `notes`, with the
  classic "triple whammy" routed to the glossary. Attributes only — no `window.*` calls
  from `chip-renderer.js`.
- **Reception friendly names (G1):** `summariseActionChips()` now prefers a human-readable
  label (`indicatorName` / `drugName` / `displayName` …) ahead of the raw code, so the
  receptionist view no longer leads with opaque QOF codes.
- **Condor PPI transparency (R3):** added a visible info button by the gauge whose tooltip
  spells out the weighting (waiting room 30%, request queue 25%, urgent 25%, capacity 20%),
  the live component scores and the band thresholds; the `Cap:` chip now explains
  "slots remaining / your daily minimum".
- **Today:** the "Triage Load" tile label carries a `triage-load` glossary tip.

## [v3.78.0] — 2026-06-14

### Usability fixes from the whole-suite Practice appraisal

Five low-risk UX corrections raised by the synthetic GP-practice usability appraisal,
spanning four modules plus the setup card. No clinical-rule or data changes.

- **Trends — CSV export (R5):** the Trends module had no way to get numbers out. Added a
  `↓ CSV` button to the picker row that exports the *active* view — BP (date/systolic/
  diastolic), Renal (ACR + eGFR rows), or the observation views (HbA1c / Cholesterol /
  Weight). Uses the shared `downloadCsv` helper; no-ops when there is no data.
- **Referrals — filter chips lifted up (R4):** the priority/status filter chips now render
  in the controls block beside the date/preset rows instead of below the fold, so the
  secretary persona can see and reach them without scrolling. Chips enlarged modestly for
  legibility. Wiring unchanged (handlers re-bind to the container on every render).
- **Today — "not configured" tiles demoted (U3):** the optional "Triage monitor not set up"
  tile now carries a calm `Optional` tag and neutral styling so it no longer reads like the
  red `today-card-error` failure state.
- **Setup card — auto-collapse once the practice code is detected (U2):** once the mandatory
  practice code is confirmed, the multi-step "Get set up" card collapses to a thin one-line
  strip ("Setup: practice code ready · N optional steps") with Expand / Dismiss, so it stops
  dominating whichever module is open. Collapse happens live via the existing
  `chrome.storage.onChanged` path when the code is detected.
- **Cold-start practice-code copy unified (G3):** Today's no-practice-code message now matches
  Capacity's guidance — "No practice code — open a Medicus tab or set it up." (Slots already
  used the unified wording.)

## [v3.77.11] — 2026-06-14

### Result rules: word-boundary matching on the normalText (calm) path

Implements the engine hardening assessed (and deferred) in v3.77.10, after CSO go-ahead —
refined to the safe asymmetric design.

- **`computeTextOutcome` (`engine/result-severity.js`)** — `normalText` (calm) phrases are
  now matched word-boundary-aware (the proven `problemLabelMatches` pattern: `\b…\b` for
  plain-alphanumeric phrases, substring fallback for punctuated ones). A short normal token
  can no longer false-calm inside a larger word — `"normal"` no longer matches inside
  `"abnormal"`, `"negative"` no longer matches inside `"seronegative"`. This only ever makes
  calming *stricter* (→ more review), so it cannot hide a positive. Multi-word phrases such
  as `"no growth"` are unaffected.
- **Deliberate asymmetry:** `abnormalText` (the positive-flag path) is **left substring**,
  not word-bounded. Word-bounding it would *weaken* it — `"candida"` would stop catching
  `"candidaemia"` — so the flag path stays broad (every shipped term is already
  collision-verified against negative text). Both paths therefore bias the same safe way:
  toward review. Regression tests added (`test-result-severity.js`).

## [v3.77.10] — 2026-06-14

### The Keeper (CSO change-proposal): culture result-rule false-calm hardening

Clinical-safety hardening of the result-triage text classifier, produced by The Keeper
(scan → independent verify → conservative apply). Addresses a substring false-calm: the
shipped `msu-culture` and `base-blood-culture` rules carried only `normalText` ("no growth"
phrases), so a **positive** culture whose free-text also contained a "no growth" substring
(e.g. a blood culture positive in one bottle — *"…; no growth in anaerobic bottle"*) was
silently classified as a calm "no growth" result instead of flagged for review.

- **`base-blood-culture` (Red)** and **`msu-culture` (Amber)** — added `abnormalText`
  positive-flag sets (`engine` checks these FIRST and they override `normalText`). Every
  term was independently collision-verified **not** to appear in realistic UK negative /
  contaminant report text (e.g. "significant growth of" was dropped because negatives read
  *"no significant growth of a pathogen"*; "organism grown"/"growth detected in" dropped
  because negatives read *"No organism grown"* / *"No growth detected in either bottle"*).
  Source corroboration: UKHSA SMI B 41 (urine) / B 37 (blood culture) reporting vocabulary
  via PMC-indexed UK lab literature (the primary SMI PDFs were access-walled — logged as a
  source gap). Purely additive: `abnormalText` only ever **adds** a review, never calms, so
  `weakens_safety: false`.
- **Migration reach** — the `resultRules` migration is append-only by id, so existing
  installs holding the old builtins would never receive the new flags. Added
  `backfillBuiltinAbnormalText` (content.js + options.js, lock-step) to backfill the shipped
  `abnormalText` onto a held builtin that lacks one (add-but-never-clobber). `defaults.json`
  migration `version` 13 → 14.
- **Options edit-preservation fix** — `saveCurrentResultRule` rebuilt a text rule omitting
  `abnormalText`, so editing any text rule silently stripped its positive flags (this also
  affected the shipped bowel-screening rule). The value is now preserved across edits.
- **Regression guards** — `test-result-severity.js` (positives → review, negatives &
  contaminants → still calm, for both shipped rules) and `test-chip-label-migration.js`
  (backfill lock-step + add-but-never-clobber).
- **Assessed but NOT applied:** hardening `computeTextOutcome` to word-boundary matching.
  It only fixes the single-token class ("normal" ⊂ "abnormal") — which no shipped rule has —
  and not the multi-word phrase-in-mixed-report class (the actual hazard, fixed above by the
  positive flags). Left as a documented recommendation for separate CSO decision.

## [v3.77.9] — 2026-06-14

### Fix: culture-only result-chip configs now actually fetch and show

- **Queue result-triage fetch gate** — `computeQueueRowResult`'s `anyEnabled` short-circuit
  (`content-scripts/triage-lens/content.js`) only checked the six numeric/meta result chips
  and omitted the four text-outcome chips (`queue.resultReview`, `queue.resultReviewRule`,
  `queue.resultNoGrowth`, `queue.resultNoGrowthRule`). A user who disabled the numeric chips
  but kept the culture/normal chips enabled therefore fetched nothing per row and saw no
  chips at all. The gate now includes all four text-outcome chips. No change in the default
  (all-enabled) configuration. Regression guard added (`test-result-triage-queue.js` Layer 4).

## [v3.77.8] — 2026-06-14

### Fix: no stray "0 abnormal" chip on text-review queue results

- **Queue result-triage chips** — a result flagged for review by a text rule (e.g. an
  H. pylori positive, a microbiology culture needing review) raises the row severity to
  amber while its numeric `abnormalCount` is still 0. `selectResultChips`
  (`content-scripts/triage-lens/content.js`) was then emitting the generic clinical
  `queue.resultAbnormal` chip with `{count}` = 0, rendering a meaningless **"0 abnormal"**
  beside the review chip. The amber clinical-chip emission is now guarded on
  `abnormalCount > 0`, so a pure text-review shows only its review chip; a result with a
  genuine numeric abnormal *and* a review still shows both. Regression tests added.

## [v3.77.7] — 2026-06-14

### Fix: custom result rules now show their own "normal" label on queue chips

- **Queue result-triage chips** — a custom text/culture result rule with a custom
  `normalLabel` (e.g. *Negative*, *Not detected*) now renders that label on the calm
  queue chip instead of the hard-coded generic *No growth*. The noGrowth path in
  `selectResultChips` (`content-scripts/triage-lens/content.js`) was emitting the
  generic `queue.resultNoGrowth` system chip and ignoring the matched rule's
  `normalLabel` (already carried on `sev.noGrowthTop.label`) — so a rule's configured
  normal label never reached the chip. It now mirrors the review path: a custom normal
  label routes to a new attributable chip `queue.resultNoGrowthRule` (`{label}`), while
  the default *No growth* (cultures such as MSU) keeps the generic chip unchanged.
- New customisable/disable-able system chip `queue.resultNoGrowthRule` (registered in
  the Result-rules settings system-chip list). `defaults.json` migration `version`
  bumped 12 → 13 so the new chip reaches existing installs.

## [v3.77.6] — 2026-06-14

### docs: VISION.md positioning statement

- Added `docs/VISION.md` — a grounded "first-of-type augmentation layer" positioning
  statement: why the suite exists, the read-only on-top-of-Medicus delivery model, a
  Medicus-native vs Suite capability table, and an honest statement of the bounded
  "first-of-type" claim (white-space capabilities plus the documented gaps — recall
  loop, coded-refset precision, compliance stack). Every capability claim is traceable
  to shipped code; no impact metrics are asserted. Cross-links `INTENDED-PURPOSE.md`,
  `feature-list.md`, and the Gauntlet benchmark. Docs-only; no behaviour change.

## [v3.77.5] — 2026-06-14

### Security audit follow-up: import hardening parity

Low-severity defense-in-depth fixes from the v3.77.4 red-team pass (no
Critical/High/Medium found):

- **`shared/io/request-monitor-io.js`** — validate types on import (parity with
  `submissions-io` / `triage-alert-io` M2): reject a non-finite/non-positive
  `pollSeconds` and non-boolean toggles at the import boundary rather than relying
  on runtime `Math.max` coercion. New regression case `(k)` in
  `test-import-hardening.js` (111 assertions pass).
- **Backup import size cap** — apply the existing 10 MB guard (already on the
  full-suite import) to the per-module import in `options/options.js`, the Sentinel
  custom-rules import (`sentinel-options/options.js`), and the Triage Lens config
  import (`content-scripts/triage-lens/options.js`), so an oversized JSON cannot
  hang the settings tab.
- **`scripts/check-doc-versions.js`** — re-pin the three CSO-signed safety docs
  (`CLINICAL-SAFETY-NOTICE`, `HAZARD-LOG`, `SOUP`) as `KNOWN_STALE` at their
  current `3.64.0` while a CSO refresh onto the 3.77 line is outstanding. The
  guard now WARNs instead of failing CI; pins to be removed when each doc is
  reissued.

## [v3.77.4] — 2026-06-14

### Add SECURITY.md vulnerability-reporting policy

- New root `SECURITY.md` documenting private vulnerability reporting (email),
  supported-version policy, audit scope, and links to the existing
  `SECURITY-AUDIT.md`, `docs/SOUP.md`, and clinical-safety docs. Fills the one
  standard security artifact the repo was missing; no code change.

## [v3.77.3] — 2026-06-14

### Result rules settings: fixes from The Practice re-run

UX/copy fixes from the second appraisal (`docs/appraisal/PRACTICE-result-rules-rerun-2026-06-14.md`):

- **Scope note** on the Result rules list — states what the built-in rules cover
  and, explicitly, what they do not (e.g. ferritin, B12/folate, LFTs), so an
  un-flagged analyte is clearly "out of scope" rather than "checked and clear".
  Resolves the nurse band's residual trust gap; also reassures that the screen is
  informational until a rule is ticked on.
- **Directional ↑/↓ glyph** on each threshold rule so a high/low pair (e.g. high
  vs low calcium, high vs suppressed TSH) is distinguishable at a glance.
- **"Enabled" moved to the top** of the rule editor (under the label) so the
  live/not-live state is visible before reading the rest of the form.
- **"Unit (display only)" warning promoted** to amber with a rule, since a
  units mismatch is a silent-misfire risk, not an ordinary hint.
- **LLM import copy** clarified ("you run the LLM; no patient data is involved")
  and "Import rule(s)" reworded to "Import rules" (it was misread as "rulesy").
- **built-in tooltip** now states the rules use UK-standard values (verify
  against your own lab) and that unticking silences a rule while delete is
  permanent.

### Fix: deleting a built-in result rule is now honoured

Deleting a built-in result rule now records a `removedBuiltins` tombstone (as the
alert-rule delete already did), so `mergeShippedDefaults` does not silently
re-add it on the next update — the delete confirmation no longer over-promises.
To keep a rule but silence it, untick Enabled instead.

## [v3.77.2] — 2026-06-14

### Enable the four Keeper result rules (CSO sign-off)

The hypocalcaemia, hypomagnesaemia, high-TSH and suppressed-TSH rules added
disabled in v3.77.0 are now **enabled** following Clinical-Safety-Officer
sign-off. `suppressIfProblem` on the TSH rules is effective in the live queue:
the content script lazily fetches the patient problem list whenever a
suppressing rule's analyte is present and passes it to the severity engine
(`content.js` ~L2515-2540), so a coded hypothyroid / thyrotoxicosis patient is
suppressed rather than re-flagged. Residual TSH false-positives are bounded to
patients on levothyroxine without a coded thyroid diagnosis, and to pregnancy;
each rule remains individually toggleable per practice. Guard test updated to
assert the enabled state and live firing.

## [v3.77.1] — 2026-06-14

### Polish: Result rules settings page (design-crit pass)

Multi-critic design crit-and-improve pass on the Triage Lens *Result rules*
settings page (art-director, token/markup surveyor, fresh-eyes GP lenses);
CSS/markup only, no behaviour change.

- **Severity badge on every rule row** — each row now shows a RED / AMBER / INFO
  chip derived from its thresholds, so the list's severity ceiling is scannable at
  a glance instead of 21 identical grey rows (the appraisal's density finding).
- **"Unreviewed" recoloured amber → blue** — amber is reserved for clinical alert
  state; a workflow state should not borrow clinical temperature.
- **"built-in" is now a proper mono badge** (kept its explanatory tooltip), and the
  threshold-summary and analyte-match columns render in the mono "machine-voice"
  face.
- **Editor:** the Amber/Red threshold field labels now carry status-ink colour cues.
- **Accessibility:** aria-labels on the per-row toggle / Edit / Delete; primary
  button contrast raised to WCAG AA on the dark accent with a visible focus ring;
  dark-mode meta-text contrast fixed; token/radius tidy-ups and dead dark-theme CSS
  removed.

## [v3.77.0] — 2026-06-14

### Feature: four more result rules from a Keeper currency-check (shipped disabled)

Ran The Keeper (clinical-rule currency check) on the result-triage rules for the
items raised by The Practice appraisal. Full Clinical-Safety-Officer change
proposal: `docs/appraisal/KEEPER-result-rules-2026-06-14.md`. Four new built-in
result rules added to `defaults.json`, all **disabled-by-default ("Unreviewed")**:

- **Hypocalcaemia** (`base-low-calcium`) — amber ≤2.1, red ≤1.9 mmol/L. Matches
  **adjusted/corrected calcium only** (not bare "Calcium"): the deliberate guard
  against hypoalbuminaemia false-positives, where total calcium reads low but the
  albumin-adjusted value is normal. Excludes ionised calcium.
- **Hypomagnesaemia** (`base-low-magnesium`) — amber ≤0.6, red ≤0.5 mmol/L
  (arrhythmia / refractory-hypokalaemia risk; PPIs a recognised cause, MHRA 2011).
- **High TSH** (`base-high-tsh`) — amber ≥10, red ≥20 mU/L (NICE NG145 treatment
  threshold). Excludes TSH-receptor-antibody results; `suppressIfProblem` for known
  hypothyroidism/levothyroxine.
- **Suppressed TSH** (`base-low-tsh`) — amber ≤0.1, red ≤0.01 mU/L (thyrotoxicosis /
  over-replacement). `suppressIfProblem` for known thyrotoxicosis/antithyroid drugs.

These ship **disabled** because WebFetch egress to NICE/NHS/BNF was blocked this run
(HTTP 403), so thresholds were corroborated via multi-source search rather than
confirmed against the primary page — the CSO verifies and enables. The TSH rules
also have a high treated-patient false-positive rate (and `suppressIfProblem` fails
open in the live queue when the problem list is absent), so disabled-by-default is
the right shipping state regardless.

**Rejected:** narrowing the existing high-calcium match from bare `"calcium"` to
adjusted-only — that would silently miss UK labs reporting hypercalcaemia under an
un-prefixed "Calcium" name (a high total calcium is not raised by hypoalbuminaemia,
so the false-positive concern there is cosmetic). The high-calcium rule is unchanged.

Bumped `defaults.json` `"version"` (11 → 12) so the new disabled builtins reach
existing users (inert until enabled). Guarded by new `test-result-severity.js`
assertions (present, disabled-as-shipped, and correct firing/exclude/suppress once
enabled). No behaviour change to any existing rule.

## [v3.76.1] — 2026-06-14

### Polish: result-rule labels and settings copy (from The Practice appraisal)

Acting on the synthetic-panel appraisal of the new result rules
(`docs/appraisal/PRACTICE-result-rules-2026-06-13.md`):

- **Result-rule labels no longer embed thresholds.** The label was doing double
  duty as both the queue-chip text and the settings description, which made the
  chip verbose (`Lithium — Lithium level high — toxicity risk (amber >1.0, red
  ≥1.5)`) and, on three rules, misstated the firing boundary with a strict `>`/`<`
  where the engine fires inclusively (`≥`/`≤`). Labels are now short clinical names
  (e.g. `High lithium level — toxicity risk`, `Critical low potassium`); the
  settings row still shows the exact threshold via its auto-generated summary, which
  already renders the correct `≥`/`≤`. Applied to all built-in threshold rules (the
  six new ones and the eight pre-existing ones that shared the pattern). The two
  HbA1c labels keep their iconic 42 / ≥48 values, which are correct and clinically
  load-bearing.
- **"Absent chip is not an all-clear" stated explicitly.** Added to the Result
  rules pane intro and the editor help panel: a result that no rule matches shows
  only the lab's own flag, so an absent rule chip does not mean a result was
  checked and cleared.
- **"built-in" and "Unreviewed" now carry tooltips** in the rule list explaining
  what each state means.

No threshold, comparator, match or exclude values changed — behaviour is identical;
this is label and copy only.

## [v3.76.0] — 2026-06-13

### Feature: six new built-in Investigation Results rules

Added six built-in result-triage rules to `defaults.json`, escalate-only (they never
lower a lab-flagged result). Authored via a two-agent clinical-safety deliberation
(acute/cancer-safety-netting lens + biochemistry/drug-monitoring lens) and converged on
the highest-value, lowest-false-positive additions with clean analyte match strings:

- **Lithium level high** — amber > 1.0, red ≥ 1.5 mmol/L (BNF target 0.4–1.0; toxicity
  risk). Drug-level monitoring miss-prevention.
- **Digoxin level high** — amber ≥ 1.5, red ≥ 2.0 micrograms/L (UK therapeutic 0.5–2.0).
- **Critical low potassium** — amber < 3.0, red ≤ 2.5 mmol/L. Fills the hypokalaemia gap
  (only high potassium was covered); excludes urine potassium.
- **High adjusted calcium (hypercalcaemia)** — amber ≥ 2.6, red ≥ 3.0 mmol/L
  (malignancy / hyperparathyroidism); excludes urine and ionised calcium.
- **Low eGFR amber band** — amber < 30 mL/min/1.73m² (CKD G4). Additive to the existing
  red < 15 (G5) rule.
- **Blood culture — needs review** (text): a known-negative phrase ("no growth" family)
  calms the row; anything else escalates to amber review, so a positive culture can never
  be hidden. Deliberately omits bare "negative"/"sterile" so a "Gram negative … isolated"
  report is not falsely calmed; excludes urine/wound/sputum/CSF/swab/stool cultures.

Bumped `defaults.json` `"version"` (10 → 11) so `mergeShippedDefaults` appends these
builtins to existing users' stored config (by id; user-deleted builtins are not
resurrected). Guarded by new assertions in `test-result-severity.js` that validate every
shipped rule against the schema and confirm each new rule fires (and excludes) as labelled.

## [v3.75.3] — 2026-06-13

### Internal: guard against shipped-config changes that don't bump the schema version

Process fix for the class of bug behind v3.75.2: a change to `defaults.json`'s
migration-propagated content (`rules` / `thresholds` / `prefs` / `systemChips` /
`resultRules`) that doesn't also bump its integer `"version"` silently never reaches
existing installs. New `scripts/defaults-config-lock.js` fingerprints that content against
the version and **refuses to bless a content change that wasn't version-bumped**; CI runs
its `--check` as an early step (and via `test-defaults-config-lock.js`) and fails closed on
drift. The rule is now documented in CLAUDE.md. No runtime/extension behaviour change.

manifest 3.75.2→3.75.3.

## [v3.75.2] — 2026-06-13

### Fix: v3.75.0 config changes never reached existing users

The shipped-config version (`defaults.json` `"version"`) was **not bumped** in v3.75.0,
so `mergeShippedDefaults` — which only runs when the shipped config is newer than the
user's stored copy — never fired for anyone who already had a saved config. Two visible
consequences:

- The **"Urgent:" result-chip prefix kept rendering** even though the default label had
  changed to `{name}`. (Made worse by a latent bug: that migration *bakes the whole
  shipped chip map into the saved config*, so once a default label changes, the stored
  old label shadows the new default forever.)
- The new **bowel-screening non-responder rule was never appended** to existing users'
  `resultRules`, so it couldn't fire for them.

Fixes: `defaults.json` `"version"` 9 → 10 so the migration runs and the bowel rule is
appended; and `mergeShippedDefaults` now reverts any chip label still frozen at a
since-changed shipped default (tracked in a new `RETIRED_CHIP_LABELS` table, in lock-step
across the content script and options page) back to the current shipped label — so the
`Urgent:` prefix finally drops for existing installs on next load. The whitespace fix in
v3.75.1 was code, not config, so it already reached users.

manifest 3.75.1→3.75.2; defaults schema 9→10.

## [v3.75.1] — 2026-06-13

### Result text rules: match phrases across lab line-breaks

A text result-rule that worked on one report would flag the next as abnormal purely
because the lab **hard-wrapped the text across a line break**. The phrase match was a
literal substring test against the result text, which keeps the lab's raw newlines — so
`"no evidence of dysplasia or malignancy"` failed to match `"…no evidence\nof dysplasia
or malignancy"`, and a benign histology report was wrongly flagged for review.

The matcher now collapses every run of whitespace (newlines, tabs, multiple spaces) to a
single space on **both** the result text and the rule phrases before comparing. This
fixes the false amber on wrapped `normalText` matches and — more importantly — closes a
**false-negative** on `abnormalText`: a flag phrase such as the bowel-screening
non-responder finding split across a line break would previously have silently failed to
fire. Whitespace-collapsing can never create a spurious match (the words are adjacent in
the sentence regardless of wrapping). Guarded by new line-break regression tests for both
`normalText` and `abnormalText`.

manifest 3.75.0→3.75.1.

## [v3.75.0] — 2026-06-13

### Queue result triage: leaner urgent chips + bowel screening non-responders

Two changes from clinical feedback on the Investigation Results queue.

**Dropped the "Urgent:" prefix on result chips.** A red chip already reads as urgent
(and the row priority is shown alongside), so the word just ate horizontal space in the
fixed-width patient-name cell. The urgent chips now show the analyte alone — `{name}`
(e.g. "BCS:FOB result") and `{name} — {rule}` — instead of "Urgent: …". Colour still
carries the severity; nothing about *which* results flag has changed.

**New built-in rule: bowel cancer screening non-responders.** A BCS:FOB result whose
value is the "No response to bowel cancer screening programme invitation" coded finding
now raises an amber **"Bowel screening: no response"** chip, so non-responders surface
for chasing instead of being filed silently.

To do this safely, text result-rules gained an optional **`abnormalText`** list — a
*flag-if-present* positive match — alongside the existing *calm-if-present* `normalText`.
A normalText approach would have been unsafe here: guessing the "normal" phrase set risks
a false-negative (the substring "normal" is contained in "abnormal"), which could hide a
positive screening result. `abnormalText` only ever ADDS a review flag on an exact phrase,
so it cannot hide or calm anything — a normal or positive screening result is left
untouched by the rule. A new attributable `queue.resultReviewRule` chip shows the rule's
own label, so the non-responder chip names itself rather than reading a generic "Needs
review"; cultures (whose rule label is "Needs review") are unchanged.

manifest 3.74.1→3.75.0.

## [v3.74.1] — 2026-06-13

### Monitoring pane: faster, render-storm-proof reload on patient switch

Switching patients **via a heavy documents view** (a large PNG/PDF rendered inline)
made the monitoring (Sentinel) pane look like it "didn't reload until F5", while the
same switch via lightweight task views (labs / med requests) felt instant. It was
latency, not a hang — and two things caused it:

- **Patient-change detection relied solely on a `MutationObserver` on `<body>`.** A
  heavy documents render floods that observer and pins the main thread, delaying
  detection of the new patient. Detection is now driven by **three independent
  signals** — the observer (kept), the **Navigation API `currententrychange` event**
  (the direct SPA-navigation signal, independent of DOM-mutation volume), and a
  low-frequency **`location.href` backstop poll** — so a render storm can no longer
  starve it. All three feed one idempotent handler (it no-ops when the URL is
  unchanged), so whichever fires first wins.
- **Every navigation paid a fixed 800 ms coalescing window before re-evaluating**,
  even when the new URL unambiguously identified a *different* patient. That window
  only exists to absorb same-patient journal-search keystroke churn; a **confirmed
  switch** now re-evaluates after ~150 ms.

No change to the wrong-patient guards: a genuine navigation still invalidates the
snapshot *before* the re-eval (the panel can never show the previous patient's chips
during the fetch window), the stale-evaluation generation counter is unchanged, and
same-patient sub-navigation (journal search) still keeps its chips. Guarded by a new
`test-sentinel-nav-detection.js`.

manifest 3.74.0→3.74.1.

## [v3.74.0] — 2026-06-13

### Result Rules gets its own settings tab

The Investigation Results rule editor was buried as a sub-tab inside Triage Lens
settings and was hard to find. Suite Settings now has a dedicated **Result Rules**
nav item (between Triage Lens and Reception) that opens straight onto the result-rules
editor — the embedded Triage Lens page deep-links to its `#resultRules` tab and hides
its sibling tab bar so it reads as a dedicated page. No change to the rules engine or
the rules themselves; this is purely settings navigation.

manifest 3.73.0→3.74.0.

## [v3.73.0] — 2026-06-13

### Queue result triage: cut cold time-to-tag and CPU contention during the tag burst

The per-row fetch is unavoidable (the task-list carries no severity flag), so this pass is
pure scheduler/observer wins — no clinical-logic change:

- **Visible burst un-throttled.** The fetch worker now applies a ZERO inter-fetch delay to
  on-screen rows; the ~12 visible rows are well under the 90/60s budget and the browser's
  ~6-connection-per-host ceiling, so firing them with no inter-fetch sleep is safe and
  removes ~300ms of pure sleep from the perceived path. The off-screen tail keeps the
  computed 100ms→1000ms backoff, and the budget cap + 60s rolling reset remain the
  rate-limit protection. Concurrency stays at 5.
- **Leading-edge first fetch pass.** The first result-triage pass per queue entry now fires
  immediately from the bridge task-list handler (after `_queueRowUuids`/`_durableRowMap` are
  populated) instead of waiting on the 150ms debounce — ~150ms off time-to-first-chip, and
  the fetch overlaps the grid's first paint. Subsequent events still use the debounce; the
  run latch + post-`Promise.all` generation re-run coalesce the leading + trailing calls so
  it cannot double-fetch.
- **MutationObserver no longer self-triggers on our own chip injections.** The async
  injectors run while the observer is live during the fetch pass, so each injected chip was
  a childList mutation that scheduled another refresh — tagging ~12 visible rows spawned
  ~12 spurious refresh cycles. The observer callback now ignores batches whose added/removed
  element nodes are all our own chips, eliminating roughly one refresh cycle per visible
  chip during the burst. Genuine grid mutations still schedule the coalesced rAF refresh.

No change to clinical severity logic, PREPEND injection, CSS token-scope, the durable
`_durableRowMap` (v3.70), the whole-snapshot worker (v3.71), or the on-screen-only
re-display (v3.72).

## [v3.72.0] — 2026-06-13

### Queue result triage: tag the visible rows in ~2s, not the whole list in ~10s

With the whole list now tagged reliably (v3.71.0), the remaining problem was latency:
~9–14s to tag 58 rows, because the fetch worker chewed through them in arbitrary order
at a fixed 200ms-per-fetch pace while the per-frame re-injection swept the whole document.
The age chips are instant (pure DOM reads); the result chips needed the same feel for the
rows you can actually see. Performance pass (no clinical-logic change):

- **Visible-first ordering.** `scheduleQueueResultTriage` now partitions the row set by
  on-screen first (AG-Grid virtualises, so that's the ~dozen rows in the DOM), with
  High/Urgent/Immediate priority as the within-partition tiebreak. The visible rows tag in
  ~2s; off-screen rows fill in behind them.
- **Faster, budget-aware fetching.** Concurrency 3→5 and the inter-fetch delay 200→100ms
  base. Once we cross 80% of the rolling budget the delay eases linearly from 100ms up to
  1000ms across the last 20%, so we back off as we approach the hard cap instead of
  slamming into it. The hard 90-fetch / 60s cap and the rolling-window reset are unchanged.
- **On-screen re-injection.** `reinjectCachedResultChips` now iterates only the rendered
  rows (still keyed via the durable `_durableRowMap` → taskUuid → cached sev, still
  TTL-gated, still idempotent) rather than the whole snapshot, so the per-frame restore
  cost scales with what's visible.
- **Observer reuse.** After `refreshQueueChips` self-disconnects to write, it re-arms the
  SAME observer instead of nulling the container and rebuilding from scratch every grid
  mutation.
- **Grid-scoped sweeps.** The per-frame wipe/re-decorate sweeps run over the live AG-Grid
  container (`queueScope()`, with a `document` fallback) instead of the whole page.
- **Memoised chip HTML.** Rendered result-chip HTML is memoised per (id, vars) so the hot
  re-injection path skips repeated string-building; the memo is dropped on config change.

No change to clinical severity logic (`evaluateReportSeverity` / rules), to PREPEND
injection, to the hud.css CSS token-scope, to the durable `_durableRowMap` (v3.70.0), or
to the whole-snapshot fetch worker with no gen-abort (v3.71.0).

manifest 3.71.0→3.72.0.

## [v3.71.0] — 2026-06-13

### Queue result triage: tag the whole list, retry flaky fetches

With persistence solved (v3.70.0), only the first few of a long list (e.g. 8 of 58)
were getting tagged, and the occasional HIGH result (ALP etc.) surfaced intermittently.
Two causes, both fixed:

- **Pass starvation.** The fetch worker aborted on every generation change, and the SPA
  churn bumps the generation constantly — so each pass tagged a handful of rows and
  restarted. The worker now runs the whole row snapshot (it only stops if you leave the
  queue); a genuinely new generation re-runs after it finishes. And `refreshQueueChips`
  no longer kicks a fetch pass on every grid mutation — display is handled durably by
  `reinjectCachedResultChips`, so grid churn can't restart/starve the fetch worker.
- **Flaky HIGH results.** A failed (null) fetch was cached for the full 5-minute TTL, so
  a one-off network error blanked that row's chip for 5 minutes. Failed fetches now get a
  short (20s) retry window so they re-surface on a later pass.

manifest 3.70.0→3.71.0.

## [v3.70.0] — 2026-06-13

### Fix: result-chip re-injection now uses a durable row map (v3.69.0 was a no-op)

v3.69.0 keyed `reinjectCachedResultChips()` off each row's `row-id` attribute on the
assumption it equalled the task UUID. Live `[ClinHUD]` tracing showed it never matched
(no `re-injected …` line ever logged) — on real Medicus the AG-Grid `row-id` is **not**
the task UUID, so re-injection was a no-op and chips still vanished.

Root cause confirmed from the logs: `_queueRowUuids` (rowIndex→taskUuid) is cleared by
`runQueue` on every queue re-entry, which the SPA churn triggers constantly, so
`refreshQueueChips` kept running with `rows=0` and wiped chips it couldn't replace.

Fix: a **durable `_durableRowMap` (rowIndex→taskUuid) written only by the bridge
task-list event and never cleared by `runQueue`**. `reinjectCachedResultChips()` now
iterates it, looks up the cached severity by taskUuid, and re-injects via the proven
row-index path on every refresh — so chips survive the re-render churn the way the age
chips do. manifest 3.69.0→3.70.0.

## [v3.69.0] — 2026-06-13

### Fix: queue result chips injected then wiped (now durable like the age chips)

Live `[ClinHUD]` tracing showed the pipeline was working — `triage start rows=58` →
`sev = red` → `chip injected` — but `refreshQueueChips` then ran with `rows=0` (the
Medicus SPA's constant re-render churn keeps clearing the bridge-provided row→task
map) and wiped the freshly-injected chips without re-injecting, because re-injection
was gated on that map being populated. Net: chips flashed and vanished.

Fix borrows how the **age/Elder/High chips stay durable** — they're rebuilt from the
row DOM every pass. New `reinjectCachedResultChips()` restores result chips
**synchronously from the per-task severity cache, keyed by each row's own `row-id`
(the task UUID) read from the DOM** — so it no longer depends on the `_queueRowUuids`
map the SPA keeps clearing. `refreshQueueChips` calls it right after the wipe (no
visible gap); the bridge map is now only needed to *fetch* not-yet-cached rows.

manifest 3.68.0→3.69.0.

## [v3.68.0] — 2026-06-13

### Fix: queue result chips stopped injecting (regression from v3.67.0)

v3.67.0 switched the flat-queue chip injection to `appendChild` (to keep the
patient name visible). On the live Medicus grid the appended node is reconciled
away by the page's Vue renderer on its next re-render, so result chips vanished
the instant they were injected (a live capture showed *peak* result-chips = 0).

- **Reverted to prepend (`insertBefore`)** for both result and monitoring chips —
  the original, durable behaviour. The patient name stays visible via the
  `.ch-q-result-inline` CSS width-cap (added in v3.67.0), not by chip position.
- **Runtime debug switch.** `localStorage.setItem('ch-debug','1')` + reload now
  turns on the content script's `[ClinHUD]` logging (content script and page share
  origin localStorage), so the queue result-triage pipeline (row count, computed
  severity, inject calls, refreshes) can be traced live without a special build.

## [v3.67.0] — 2026-06-13

### Queue result chips: render correctly + stop hiding the patient name

Live testing surfaced two rendering bugs in the queue result chips:

- **"White rectangles" fixed.** Result/monitoring chips (`.ch-q-result` / `.ch-q-mon`)
  were injected outside the design-token CSS scope, so `.ch-chip-red`/`-amber`
  resolved to undefined variables and rendered as unstyled boxes. Both classes are
  now in the token scope and render as proper red/amber pills (the age/queue chips
  were already in scope, which is why only result chips looked broken).
- **Patient name no longer hidden.** On flat single-line queues (no Medicus
  master/detail row) chips fell back into the narrow patient-name cell and were
  *prepended*, pushing the name out of view. They're now *appended* after the name
  (and Medicus badges) and width-capped with an ellipsis — full text on hover — so
  the patient is always identifiable. Detail-row layouts are unchanged.

### Clinical-safety: HbA1c "possible diabetes" suppression (from the red-team audit)

- **H1 (patient-safety):** a patient whose only diabetes-related code was a *family
  history* entry ("Family history of diabetes mellitus") had the new-diabetes red
  flag wrongly suppressed. `"family history"` is now in the suppression exclude list,
  so a diagnostic HbA1c in an FH-coded patient is flagged.
- **M1 (alert fatigue):** known diabetics coded without "mellitus"/"type N"
  ("Steroid-induced diabetes", "Pancreatic diabetes", "Type-2 diabetes", "T2DM")
  were not matched and got nagged on every HbA1c. The diabetes match now includes a
  guarded bare `"diabetes"`/`"diabetic"` plus `t1dm`/`t2dm`; the broad excludes
  (non-diabetic, pre-diabetic, family history, gestational, diabetes insipidus) keep
  it from over-suppressing. Progression (pre-diabetic → diagnostic HbA1c) still flags.

defaults version 8→9 so existing installs receive the rule change; manifest
3.66.0→3.67.0.

## [v3.66.0] — 2026-06-13

### Base rules are red-only + attributable chips + conditional HbA1c flags

Refines the v3.65.0 base result rules after live testing showed the amber tiers were
invisible — every amber threshold sat inside the lab's own reference range, so the lab
already flagged the row amber and the rule's amber added nothing.

- **Base rules are now red-only (escalate-to-urgent).** Each promotes a result the suite
  would otherwise show as a lab "abnormal" amber up to **urgent/red** when critically
  deranged — the only visible, non-redundant signal. Thresholds: Hb **<100 g/L**,
  K **≥6.5**, Na **≤120**, eGFR **<15**, platelets **<30**, neutrophils **<0.5**, INR **≥8**.
- **Attributable rule chips.** When a user/base threshold rule (not the lab flag) raises a
  result's severity, the queue chip now names the rule — e.g. *"Urgent: Potassium —
  Critical high potassium"* — via two new system chips `queue.resultRuleUrgent` /
  `queue.resultRuleAbnormal`. A rule fire is now answerable at a glance instead of blending
  into the generic lab chip.
- **Conditional HbA1c flags (`suppressIfProblem`).** Result rules gain an optional
  `suppressIfProblem` clause that suppresses a rule when the patient already has a matching
  problem on record. Two built-ins use it:
  - **Possible diabetes — not on register (HbA1c ≥48):** red, unless the patient is already
    a known diabetic.
  - **Prediabetes range — not on record (HbA1c 42–47):** amber, unless already prediabetic
    or diabetic.

  Matching mirrors the engine's register logic — word-boundary match terms with broad
  substring excludes (so "non-diabetic"/"pre-diabetic" never trip the diabetes suppression).
  Suppression **fails open**: if the patient's problem list can't be fetched, the rule still
  fires (flag rather than silently hide a possible new diagnosis). The problem list is only
  fetched for reports that actually contain the targeted analyte.

## [v3.65.0] — 2026-06-13

### Investigation Results queue — result chips now persist + a pack of built-in threshold rules

**Fix: queue result chips were stripped and never re-injected.** On every AG Grid
re-render (which fires constantly on the queue), `refreshQueueChips()` wiped the
`.ch-q-result` chips but only re-ran the *monitoring* pass — never the result-triage
pass. So result chips vanished a frame after they appeared and never came back, even
after a hard refresh, making every result rule (and lab-flagged urgent) look dead.
`refreshQueueChips()` now also re-runs result triage (cheap — served from the per-row
cache, no re-fetch unless stale).

- **Config edits take effect live:** changing or enabling a result rule now invalidates
  the cached per-row severities, so the queue recomputes instead of re-showing stale
  chips. Previously an edited/enabled rule did nothing until the 5-minute cache expired.
- **Robustness:** the result-triage pass now releases its run latch in a `finally`, so a
  thrown worker can no longer permanently block all future passes.

### `analyte.exclude` for result rules

Result rules gain an optional `analyte.exclude` (case-insensitive substrings). A result
whose name contains an exclude term is skipped even if it matched — dropping shared-token
false positives. This is editable in the rule editor and honoured by the in-editor tester.

### Seven built-in base result rules (enabled, escalate-only)

A starter pack of common UK critical-result thresholds, shipped enabled. Each escalates
severity only (never lowers a lab flag) and can be disabled per-rule in settings:

- **Low haemoglobin** — amber <100, red <70 g/L (excludes HbA1c).
- **High potassium** — amber ≥6.0, red ≥6.5 mmol/L (excludes urine).
- **Low sodium** — amber ≤128, red ≤120 mmol/L (excludes urine).
- **Low eGFR** — amber <30, red <15 mL/min/1.73m².
- **Low platelets** — amber <100, red <30 ×10⁹/L (excludes "Mean platelet volume").
- **Low neutrophils** — amber <1.0, red <0.5 ×10⁹/L.
- **High INR** — amber ≥5, red ≥8.

> Thresholds compare the raw number the lab reports — verify the units listed match your
> laboratory before relying on a rule (the engine does not convert units).

## [v3.64.0] — 2026-06-13

### Investigation Results queue — microbiology (MSU / culture) text rules

Microbiology results carry no numeric high/low flag, so the lab-flag-led chips
never surfaced them. This adds text-classification result rules.

- **Built-in MSU/urine-culture rule:** a culture is flagged amber **"Needs
  review"** unless its result text contains a normal phrase (e.g. "No growth"),
  in which case a calm blue **"No growth"** info chip is shown instead. The info
  chip asserts a negative culture from the actual result text — it is not a
  "safe to file" verdict (sterile pyuria and "no significant growth — repeat"
  remain the clinician's call).
- **User-tunable:** the rule type is now Numeric threshold OR Text/culture; users
  can edit the normal phrases, add other culture types (wound swabs, sputum,
  stool, blood cultures), manually or via the LLM single-rule build. Escalate-only
  and, for user-authored/imported rules, ship-disabled until reviewed.
- The result text is read from the Medicus `resultText` field (where cultures put
  "No growth" / the organism), combining interpretation and lab comments.
- New chips `queue.resultReview` (amber) and `queue.resultNoGrowth` (info), both
  enable/colour-configurable. HAZARD-LOG H-030 and CSN limitation 35 updated.

## [v3.63.1] — 2026-06-13

### Investigation Results queue — usability pass (The Practice synthetic panel)

Fixes from a five-persona synthetic usability appraisal (technophobe partner ->
power user). No change to severity logic or which chips appear.

- **"A blank row is not 'normal'":** a quiet persistent legend on the queue
  states that chips are additive and an unflagged row has not been assessed as
  normal — the universal fear across the panel that absence read as safe.
- **Clinical chips carry a glyph:** the filled Urgent / abnormal chips gain a
  leading marker so they are distinguishable from the outline process chips by
  shape and fill, not colour alone (also colour-blind safe).
- **Result-rule editor (clinical-pharmacist findings):** comparator relabelled
  "at or above (>=)" / "at or below (<=)" to match the engine's inclusive
  evaluation; a display-only-unit warning; a live "test match" box to check a
  rule's analyte-match strings against a real lab result name before saving;
  and an LLM import now shows a plain-English preview and requires confirmation
  before adding (still disabled) rules.
- **Baseline chips:** clearer group separators so the result chips are not
  misread as the existing priority chip.

## [v3.63.0] — 2026-06-13

### Investigation Results queue — user customisation

- **Per-chip enable + colour:** the four result chips are configurable in the
  Triage Lens "Baseline chips" editor (enable/disable and severity-kind colour).
- **User analyte-threshold rules:** a new "Result rules" pane lets a clinician
  author rules (e.g. "Potassium >= 6.0 -> red") that escalate chip severity.
  Escalate-only — a rule can never lower or hide a lab's own urgent/abnormal flag.
- **LLM single-rule build + manual editor:** copy a prompt, paste the model's
  JSON back, validate and import; or author by hand. Imported rules arrive
  disabled and must be clinician-reviewed before they fire.
- Engine: new `engine/result-rules.js` (validation + LLM prompt);
  `evaluateReportSeverity` consumes user rules. Safety docs (HAZARD-LOG H-030,
  Clinical Safety Notice limitation 35) updated to record the first
  self-computed clinical threshold, gated by the escalate-only + review model.

## [v3.62.1] — 2026-06-13

### Investigation Results queue chips — design-crit polish

Visual-only pass from a three-critic design review (art director, token/CSS
surveyor, fresh-eyes GP). No change to severity logic, chip wording, or which
chips appear.

- **Clinical vs process hierarchy:** the filled red/amber treatment is now
  reserved for the clinical result chips (Urgent / abnormal). The process/meta
  flags ("Under-prioritised", "Unmatched patient") render as outline chips so a
  genuine abnormal result is never out-shouted by a queue/data-quality caveat.
- **Long-analyte chips no longer overflow:** chips truncate with an ellipsis
  (`max-width`) and carry the full text in a `title` tooltip.
- **Amber contrast fix:** amber chip ink darkened to `#b45309` to clear the
  4.5:1 accessibility floor at 10px (was 3.10:1).
- **A11y/tidy:** result-chip strip marked `role="note"`; de-duplicated the
  identical queue/result chip CSS.

## [v3.62.0] — 2026-06-13

### Investigation Results queue — per-row severity triage chips

- **Urgent/abnormal result chips:** Each queued Investigation Results task now shows
  a severity chip derived from the actual lab report data. Urgent (red) results show
  the abnormal analyte name and count; abnormal (amber) results show the abnormal count.
- **Under-prioritised safety flag:** A red "Under-prioritised" chip fires when the
  task's `priorityDisplay` is `Routine` but the result contains urgent findings.
- **Unmatched-patient flag:** An amber "Unmatched patient" chip fires when the report
  could not be matched to a patient record.
- **Whole-queue throttled sweep:** All queue rows are swept with 3 concurrent workers,
  priority-ordered (High/Urgent/Immediate first), with a 90-fetch / 60s rolling budget.
  Results are cached for 5 minutes. The sweep runs on queue entry and on new task-list
  data arrival.

## [v3.61.2] — 2026-06-13

### Guided tour — patient-data steps now shown, not skipped

- **The four Sentinel patient-data steps (brief, actions, verify, unmatched
  meds) no longer silently skip.** When a tour runs with no actionable record
  open, their anchor elements (`.sent-brief-card`, `#sentVerifyBannerBtn`,
  `.sent-unmatched-section`) are absent, so the engine skipped them — the tour
  jumped straight from "Waiting room" (7) to "Command palette" (12). Each step
  now sets `centerFallback: true`, so it shows as a centred card describing the
  feature instead of vanishing. This matches the existing alert-strips step.
- **Fixed a syntax error that broke `tour-steps.js` entirely.** The
  unmatched-meds step had smart-quote characters as its string delimiters,
  which is invalid JavaScript — the whole tour module failed to import.
  Restored straight-quote delimiters.

## [v3.61.1] — 2026-06-13

### Guided tour bug fixes

- **The setup checklist no longer paints over the running tour.** The checklist
  hides on `suite:tour-started`, but `initSetup()` registered that listener only
  after its async boot (`PracticeCode.resolve()` etc.), so a tour auto-starting
  on its 900ms timer could fire the event before anyone was listening — leaving
  the wizard covering the very content the tour was describing. The listener is
  now registered before any await, so the event can never be missed.
- **"Next" no longer hangs around the Sentinel steps.** The patient-data steps
  (brief, actions, verify, unmatched meds) are absent on a first-run tour with no
  record open and are skipped — but each waited the full 2.5s module render-grace
  before skipping, so a run of them made "Next" look completely dead for several
  seconds. The long grace now applies only when the tour actually switches tabs;
  steps on the already-active module resolve or skip within 400ms.

## [v3.61.0] — 2026-06-13

### Whole-suite usability pass — synthetic GP-practice panel ("The Practice")

A new appraisal skill convened a panel of ten synthetic practice-staff personas
(partner/salaried/trainee/locum GPs, practice manager, reception, nurse,
pharmacist, secretary) spanning the full technophobe-to-power-user spectrum,
reacting to real rendered screenshots of every module. The full appraisal is in
`docs/appraisal/PRACTICE-whole-suite-2026-06-13.md`. Its convergent findings drove
the following changes. No clinical alert salience was reduced anywhere.

**Clinical-safety UX**

- **Monitoring (Sentinel): "no alert" can no longer be misread as "all clear".**
  The pinned waiting-room list now carries a caption stating it is the waiting
  room only (and that the minutes are wait time, not overdue time), and the
  no-record state reads "Monitoring idle" and explicitly says the list above is
  not a monitoring result. The nurse and pharmacist personas independently
  rated this their top concern.
- **Monitoring rules footer now discloses scope** ("N drug rules · N QOF
  indicators") alongside the existing currency dates, so the safety net's
  coverage is legible at a glance.

**Trust & reconciliation**

- **Data freshness is now legible everywhere.** Slots, Submissions, Activity and
  Condor show a shared relative "Updated · 12s ago" stamp with an explicit stale
  state (amber, past a per-surface threshold) instead of an absolute clock that
  read like wall time. New shared helper `side-panel/modules/shared/freshness.js`.
- **Condor velocity** no longer claims "No submissions recorded today" while
  showing a non-zero total; it states when submissions fell outside clinic hours.
- **Condor pressure index** is relabelled "Pressure index" (was "Condor PPI",
  misread as proton-pump inhibitor) and gains a caveat when capacity is stretched
  but the band stays green, reconciling it with the Demand/Capacity card; the
  index weighting is exposed on hover.

**Get data out**

- **CSV export** added to Slots (by clinician and type), Submissions (category
  totals) and Activity (per staff), and a "Copy figures" snapshot to Condor.
  New shared helper `side-panel/modules/shared/export-util.js`.

**Ease of use**

- Empty states in Referrals, Reception, Trends and Monitoring reframed as the
  "mirror whatever you have open in Medicus" model rather than imperatives that
  read as errors.
- Referrals default range changed from 12 months to 30 days.
- Command-palette button persistently advertises all tabs with a count, so the
  narrow rail's off-screen tabs are discoverable.
- Setup checklist wording softened ("key steps" not "essentials", plus a
  "nothing is broken" reassurance) for the cautious/technophobe user.
- Condor tab tooltip/aria now gloss the name as the practice-pressure dashboard.

## [v3.60.15] — 2026-06-13

### Suite-wide design polish — Atelier pass, verified on real-data renders

An orchestrated suite-wide refinement pass (token canon + all module/options/
injected/visualiser stylesheets), audited by four surveyors and implemented by
seven stylists, then verified by rendering every surface in both themes with
realistic clinical data (waiting rooms, slot grids, RAG-tripped submissions,
overdue monitoring) and eyeballing each. Design intent — heal the gap between
90% and 100% craft without changing the visual language or any layout:

- **Red and amber stop blurring together on dark.** The options, Triage-Lens
  and Sentinel-options surfaces still carried pre-update dark wash alphas, so
  an overdue (red) and a stale (amber) state read as nearly the same colour on
  a dark background. All three now match the canon's raised dark dims — the
  clinical RAG hierarchy survives dark mode everywhere.
- **On-accent text is now legible on the dark accent.** Primary buttons, the
  nav slot-count badge, copy buttons and the tour/tabs CTAs used pure white,
  which sits at ~3.4:1 on the pastel dark accent. They now use the
  theme-adaptive `--bg-deep` (near-white on light, dark ink on dark) and clear
  contrast in both themes. Canon recipe updated to match.
- **The dual voice is cast correctly.** Numeric readouts, chart axes, units and
  legends that had slipped into the human (sans) voice are back in the machine
  (mono, tabular) voice; the Reception module, which was falling through to the
  browser default serif for its prose, now declares the sans stack.
- **Overlays actually dim on dark.** The modal/tour/tab-chooser scrim was using
  its light-tuned value on dark, barely veiling an already-dark page; the dark
  scrim is re-picked deeper. Documented `--scrim` in the token canon.
- **Every pressable element answers a press.** Missing `:active` (and a few
  `:disabled`) states were completed across shell strips, menus, toggles and
  module buttons; keyboard focus rings restored where `outline:none` had
  suppressed them (Visualiser toolbar, HUD tiles).
- **Contrast lifts on load-bearing copy.** Empty states, monitoring-status
  badges, KDIGO frequencies, card previews and strip labels moved off the
  faint text tiers that failed on dark. The Visualiser's dark NHS-blue is
  remapped for legibility while its light/print palette is left exactly as-is.
- **Drift healed quietly.** Raw radii, transitions and overlay colours folded
  onto the `--r-*` / `--ease` / `--scrim` tokens; spacing nudged onto the 4px
  grid; a dead `--border-acc` token removed. Sanctioned decorative palettes
  (Reception/Slots) and the intentional Capacity RAG tier were left untouched.
  Clinical alert salience was never reduced.

## [v3.60.14] — 2026-06-13

### Guided setup & onboarding tour — multi-critic design crit

A single-surface design crit (art director on the pixels, a token/code
surveyor on the CSS+JS, a fresh-eyes GP persona on screenshots only) was run
across both onboarding surfaces. The three lenses converged on one broken
state-signal, a misleading progress count, and a first-run collision between
the two surfaces. Changes:

- **The setup checklist's step icons now actually colour.** The done tick and
  pending circle were emitted with BEM class names (`setup-step-icon--done`)
  that no CSS rule matched, so both rendered in primary-text ink — "done" and
  "to-do" looked identical bar the background wash. The tick is now `--green`,
  the pending circle muted `--text-4`; status no longer rides on a single
  fragile channel.
- **Completion recedes instead of celebrating.** Done steps were filled with a
  full `--green-dim` wash, spending the clinical green as chrome on a
  housekeeping card that sits *above* the live "couldn't reach Medicus" /
  waiting-room signals. The wash is dropped to a quiet `--green-line` hairline;
  the green tick carries the signal. The card's resting border is calmed from
  `--accent-line` to `--border`.
- **The progress counter is honest.** It read "N/3 done" beside five rows and
  multiple green ticks — fresh-eyes GPs could not tell whether setup was
  complete. It now reads "N of 3 essentials", and the two non-essential steps
  are both badged (`recommended` on Choose-your-tabs, the existing `optional`
  on Triage) so the count reconciles with the rows.
- **Onboarding no longer talks like a developer.** "Verify the extension can
  reach your Medicus API" → "Check the extension can reach Medicus", with a
  muted "add a practice code first" hint when the connection step is gated.
  The tab-count line is recast as neutral metadata rather than clinical green.
- **The tour is keyboard- and screen-reader-operable.** The `role=dialog`
  overlay had no focus management: focus is now moved into the dialog on open,
  trapped within its controls (Tab/Shift-Tab), and restored on close; step
  content is announced via an `aria-live` region; the setup card gains
  `aria-live` and async buttons set `aria-busy`.
- **Skip reads differently from Back.** "Skip tour" (exits the whole
  walkthrough) was a bordered button identical to "Back" (one step). It is now
  a quiet text-link pulled left, clearly separated from the Back/Next nav pair,
  with a bounded progress track so a 16-step tour no longer feels open-ended.
- **The setup card and tour no longer collide.** On a true first run both
  appeared at once; the checklist now hides while the tour is on screen and
  re-evaluates when it ends.
- Token hygiene: the shared overlay scrim is now a `--scrim` token; `:active`
  press states added to ghost and tour buttons; dead `.setup-manual-link` CSS
  removed.

## [v3.60.13] — 2026-06-13

### Suite — unify the chart palette onto one canonical ramp

The Activity and Submissions design crits independently solved the same sin
(spending the alert palette on benign categories) and each introduced its own
data-series colours. This collapses them to a single source of truth:

- The Submissions Tracker charts/tiles/legends now consume the canonical
  `--cat-1`…`--cat-6` ramp (defined once in `panel.css`, documented in
  TOKENS.md) instead of a module-local hex palette — Medical→`--cat-1`,
  Admin→`--cat-2`, Invest→`--cat-6`, Routine Rx→`--cat-3`, Non-routine
  Rx→`--cat-4`. One ramp now serves every chart in the suite.
- The Submissions SVG series colours moved from `fill=`/`stroke=` presentation
  attributes (which cannot resolve CSS variables) to inline `style="fill:…"`,
  matching the axis/grid pattern already in that module. Side benefit: the
  Submissions charts are now **theme-aware**, picking up the tuned dark
  `--cat-*` values on `#0b1424` instead of reusing one fixed palette.
- TOKENS.md documents `--cat-*` as the suite-wide qualitative chart ramp and
  records the inline-`style` consumption rule for SVG.

No change to alert semantics: `--red`/`--amber` remain reserved for clinical
status. No visual change to the resting/alert RAG states.

## [v3.60.12] — 2026-06-13

### Activity — design-crit pass (three-critic review via /design-crit)

- **The chart no longer spends the clinical alert palette on workload (the
  convergent finding across all three critics)**: "Routine Rx" was painted
  alert-amber and "Non-routine Rx" alert-red, so the "Non-routine only" view
  turned the whole panel blood-red over benign prescription counts — the
  fresh-eyes GP read it as "that doctor is doing something risky". Workload is
  not a clinical status, so the six series now draw from a new **non-clinical
  categorical data-viz ramp** (`--cat-1`…`--cat-6`, light + dark columns,
  documented in TOKENS.md) that deliberately avoids the `--red`/`--amber`
  alert hues. The metric tiles and legend inherit the same ramp. Red/amber are
  now reserved for genuine clinical signals — alert salience was only
  protected, never reduced.
- **States are designed, not inherited**: the empty state is now a centered
  bar-chart glyph over a mono machine-voice label (was a bare italic string);
  the "no practice code" error is recoloured off the clinical-red triad to a
  neutral informational treatment (a config gap is not a clinical alarm); the
  legend now reflects the active mode (all six stacked, a single key for a
  single metric, hidden entirely for total-only).
- **Controls match the instrument**: the metric `<select>` and date inputs
  adopt the tokenised Input recipe (custom chevron, `:hover`,
  `:focus-visible`); the active date preset now carries an accent
  selected-state and **Refresh** is demoted to a ghost button so the live
  range — not a utility action — owns the accent.
- **Accessibility**: the staff chart gains `role="list"`/`listitem` with
  per-row `aria-label` breakdowns (data was previously hover-only `title`
  text), an `aria-live` region announces async data swaps, and the load-bearing
  metric labels move off the muted `--text-4` tier to `--text-3` for contrast.
- **Fix**: a stale `VALID_MODES` whitelist meant any single-metric chart view
  silently reset to "stacked" on reload — the list is now derived from the real
  metric keys, so the chosen view persists.
- Token/radius hygiene: cards corrected to the card radius, swatch radii
  tokenised, 4px-grid spacing, and dashed dividers replaced with hairlines.

## [v3.60.11] — 2026-06-13

### Submissions Tracker — multi-critic design crit

A single-surface design crit (art director on the pixels, a token/code
surveyor on the CSS+JS, a fresh-eyes GP persona on screenshots) converged on
one core sin and several token defects. Changes:

- **The category palette no longer spends the alert pigments.** Medical was
  permanently drawn in alert-red and routine-Rx in status-green, so the
  resting screen looked alarmed and a tripped RAG threshold had no un-spent
  red left to claim. The five categories now use a non-status data-series
  palette (indigo / blue / teal / pink / violet) declared in one place;
  `--red` / `--amber` are reserved exclusively for tripped thresholds. Alert
  salience is **increased**, not reduced.
- **Resting metric tiles are now neutral** — the category is shown by a small
  swatch beside the label, so a RAG wash is the only thing that ever paints a
  tile. Calm field, sharp signal.
- **Charts are theme-aware.** SVG axis labels and gridlines were baked to a
  dark-theme hex (failing contrast in light, heavy in light); they now consume
  `--text-4` / `--border` and adapt to both themes. Axis labels are mono
  (machine voice) and category labels are unified across tiles, legend and bars.
- **Designed empty state** ("No submissions in this period") replaces the
  flat-line / blank-card look that read as broken.
- **Accessibility**: legend series are now keyboard-operable checkboxes with a
  focus ring and a greyscale-surviving muted state; the alert strip is an
  `aria-live` region; charts carry `<title>`/`role="img"`; date inputs get
  real `<label>`s; the settings button gets an `aria-label`; `↻`/`⚠` glyphs
  are replaced with Feather icons.
- **Compare deltas** are neutral (an inbound-work count going up is neither
  clinically good nor bad) with tabular-nums and a decorative direction arrow.
- Token cleanups: card shadows, tokenised date-input well, mode-tab hover/active
  states, radius/grid normalisation, reduced-motion kill switch.

## [v3.60.10] — 2026-06-13

### Reception — design-crit pass (three-critic review via /design-crit)

- **Colour economy restored (the convergent finding across all three
  critics)**: the per-tile colour labels no longer paint a clinical-severity
  edge-bar down the side of a tile — a red/amber left-rule read exactly like
  the escalation banner and overdue rows, training the eye to distrust the
  suite's sharpest signal. The user colour-label now shows as a small corner
  **dot** (a personal tag), in both browse and organise modes. All ten colour
  choices are kept; this is purely a treatment change.
- **Escalation banner now owns the moment**: a tripped red-flag banner gains a
  solid status left-rule and a shadow lift so it reads as the apex alarm, and
  it now carries `role="alert"` so screen-reader users in keyboard-only
  workflows actually hear the 999/duty escalation (previously announced
  silently — a patient-safety a11y gap). Alert salience was only ever raised,
  never reduced.
- **Expanded patient detail rows are proper status chips**: OVERDUE / DUE-SOON
  / CAUTION render as the canon status-chip (dim wash + line border + ink),
  red grouped above amber, tabular-aligned, with long drug names truncating
  cleanly instead of bare coloured text leaning on hue alone.
- **State & a11y hardening**: added missing `:active`/`:hover` states to the
  status pill, sort toggle, pathway tiles, link buttons and colour
  swatches/dots; switched form inputs from `:focus` to `:focus-visible` (no
  more mouse-click ring flash); the draft banner is now an `aria-live` region;
  the pill exposes `aria-controls`; decorative arrows/carets are
  `aria-hidden`; colour dots gained real `aria-label`s.
- **Casting & token fixes**: the NHS number now speaks in the machine voice
  (mono, tabular-nums); the sort toggle uses the calm selected-state recipe
  instead of a primary-accent fill (one less accent over-spend); swatch/dot
  borders use theme tokens instead of raw `rgba(0,0,0,…)` that vanished in
  dark; the "Copied." confirmation is green, not red; input radii follow the
  `--r-md` semantic; and a block of dead per-opportunity chip/count CSS
  (zero JS references) was removed.

## [v3.60.9] — 2026-06-12

### Crit follow-ups (the two deferred items from the v3.60.6–v3.60.8 passes)

- **Monitoring modals now trap Tab**: keyboard focus cycles inside an open
  modal instead of escaping into the panel behind the scrim (completes the
  modal a11y work started in v3.60.6 — role/aria and focus-restore were
  already in).
- **Today cards gain altitude over the global strips** (the art director's
  "single biggest move"): instead of re-printing the strips' numbers, Triage
  Load now shows how long the **oldest unanswered request** has waited
  (computed from data already in the monitor state — no new API calls), and
  Demand Today shows a **headroom meter** placing today's count against your
  amber/red thresholds (only when alerting is enabled for that stream).

## [v3.60.8] — 2026-06-12

### Today — design-crit pass (three-critic review via /design-crit)

- **Three dead "Open →" buttons fixed**: Waiting Room, Triage Load and
  Demand Today navigated nowhere (the handler read the card's own id instead
  of its nav target) — they now open Monitoring, Reception and Submissions.
  The Morning Sweep button also fired its navigation twice per click
  (duplicate direct + delegated handlers); now once.
- **Jargon pills decoded**: triage bucket pills read "New med 14 / Med reply
  3 / New admin 9 / Admin reply 2" instead of NM/MR/NA/AR — the fresh-eyes
  GP critic's top confusion. Zero-count pills are now always muted (the
  reply accent used to fire at 0 — backwards for a load indicator).
- **Alert log label stutter fixed**: "Demand: Demand: Medical 34" → the
  channel prefix is no longer doubled onto labels that already carry it.
- **Designed error states**: raw fetch exceptions ("Failed to execute
  'json'…") replaced with a status glyph + "Couldn't reach Medicus —
  retrying automatically" (truthful — the cards poll), raw detail kept in a
  tooltip for debugging.
- **Demand card**: counts lead (matching the Waiting Room/Slots hero
  pattern) and a threshold breach now adds an "over threshold" amber/red
  chip — the breach no longer rides on digit colour alone.
- **Accessibility**: aria-live on all six polled card bodies, per-card
  accessible names on the six identical "Open →" buttons, labelled alert
  dots and triage pills, hero-count label, and
  :focus-visible/:active/:disabled coverage on the card-open, ghost-button
  and setup-link controls.

## [v3.60.7] — 2026-06-12

### Sweep + Trends — design-crit pass (three-critic review via /design-crit)

- **Resume selection bug fixed**: after resuming a stored sweep, the batch
  bar showed "0 selected" and Generate batch stayed disabled even though the
  restored checkboxes were ticked — the bar state is now initialised at
  wire-up, so a resumed selection is immediately actionable.
- **Disclaimer tells the truth**: the in-results disclaimer claimed "Results
  are not stored; re-run to refresh", contradicting the 2-hour
  persistence/resume feature. Sweep now carries ONE authoritative disclaimer
  (header), with all safety phrases intact and the storage copy corrected
  ("kept for 2 hours so you can resume; re-run to refresh").
- **Row anatomy**: action rows are two lines — name + red/amber count badges
  lead, clinician + Open record sit on a meta line — so names no longer wrap
  through the controls at panel width. Error rows use the proper badge class
  (was an undefined class name). Patient names stay verbatim from the
  appointment book (no case transforms).
- **Chart calming (Trends)**: KDIGO/ACR reference bands are dim washes with
  1px dashed boundary edges instead of saturated fills, data lines thickened,
  and the eGFR series moved from grey (failed non-text contrast) to the
  violet ink. Red alert dots and full-ink stage pills unchanged.
- **Plain English**: "clamped at 100" → "values above 100 plotted at 100";
  "No BP target register" → "No BP target (no qualifying register)" with a
  register-list tooltip; KDIGO cell gets an explainer tooltip; BP view gains
  a "Default NICE/QOF thresholds — verify any personalised target in
  Medicus" footnote when a target line is drawn.
- **Accessibility**: every chart gets a descriptive aria-label (was six
  identical "Trend chart"s); sweep progress is an aria-live region; renal
  banners announce via role=alert; the Trends tab picker is a proper ARIA
  tabs pattern (aria-controls + tabpanel); row checkboxes are labelled per
  patient with a hover wash; :active/:focus-visible/:disabled states filled
  in across sweep buttons; on-accent button ink uses var(--bg-deep).

### Fixed

- **Infinite Triage-strip poll loop**: the side panel re-polled the request
  monitor on any `suite.requestMonitor.*` storage change — including the
  state write each poll itself makes — so an enabled triage monitor polled
  the Medicus task-list API continuously instead of every 60s. The listener
  now reacts to the five config keys only (mirrors the service worker's
  existing guard).

## [v3.60.6] — 2026-06-12

### Monitoring — design-crit pass (three-critic review via /design-crit)

- **Hierarchy under alert fixed**: the pre-consultation BRIEF (red/amber
  summary) now leads the stack; the waiting-room block is demoted below the
  action bar and de-amberised (neutral card + amber left bar — per-row
  red/amber minute counts unchanged), so operational throughput no longer
  out-shouts clinical risk and amber is reserved for signal.
- **Canon**: dark-theme `--red-dim`/`--amber-dim` raised to .17/.16 so the
  red-vs-amber tier survives on dark; new `--violet` triad promotes the
  custom-rule accent into the token canon (TOKENS.md updated).
- **Chip anatomy**: test rows are a three-column grid with a right-aligned
  mono days rail (122d/43d… scan as a column); the invisible ⓘ evidence
  affordance is now a rotating chevron on every evidence-bearing chip; the
  floating ACTIONS pill is a docked "Copy actions" card footer.
- **Designed idle states** (no-Medicus / not-mounted) with icon + mono label;
  raw "Failed to fetch" replaced with human copy; the degraded H-005 warning
  copy and salience untouched, with dead action-bar chrome hidden in
  no-patient states; version pill de-emphasised to metadata.
- **Accessibility sweep**: focus-visible/active states on every interactive
  (chip dismiss ×, drift dismiss, modal close, evidence buttons); modals get
  role=dialog/aria-modal/labelled titles + focus restore to opener;
  aria-live on the auto-refreshing chip region; filter bar aria-pressed
  group; emoji replaced with Feather strokes in the waiting-room block;
  contrast and mono-voice corrections; seven previously unstyled classes
  (journal warning, RESURFACED banner, unmatched-meds section) given
  token-recipe styling.

## [v3.60.6] — 2026-06-12

### Monitoring (Sentinel) — design-crit fixes

- **A** Scaffold slot order: brief above waiting room (brief → action bar → WR block).
- **B** WR block de-amberised: calm `--bg-elev` surface, left `3px solid var(--amber)` bar only. Feather SVG icons replace emoji. WR fetch error humanised.
- **C** Action bar hidden (`.sent-actionbar-empty`) when no data context.
- **D** Version pill de-emphasised: transparent bg, no border.
- **E** Test-row three-slot grid: name / status+value+date / days (`38px` rail, `sent-test-days` inherits status colour).
- **F** Evidence affordance: chevron (`▸`) replaces ⓘ on all clickable chip-heads. Vaccine summary ⓘ left intact.
- **G** ACTIONS row docked footer; button label → "Copy actions"; `:focus-visible` ring.
- **H** Brief dot 7→8px; `title` attribute on patientLine span.
- **I** Filter bar active state uses accent triad; `aria-pressed` + `role="group"` added.
- **J** Idle states render canon empty-state (monitor icon, mono heading, sans body). Error/degraded blocks moved from inline `style=` to CSS classes.
- **K** A11y sweep: focus-visible + active on dismiss, vax-summary, modal-close, drift-dismiss, ev-close, ev-verify, act-copy; `aria-live="polite"` on `#sentDynamic`; letter-spacing/mono on ev-label/refs-head/ref-state; `--text-2` on patient-meta; violet triad tokens on custom-tag; verify-button voice unification; badge shared selector.
- **L** Seven previously unstyled classes styled: `sent-journal-warn`, `sent-chip-resurfaced`, `sent-unmatched-section/*`, `sent-chip-more`.

## [v3.60.5] — 2026-06-12

### New repo skill: design-crit

- `.claude/skills/design-crit/` captures the end-to-end single-surface
  crit-and-improve pipeline used for the v3.60.4 Slots pass: render the real
  surface in all states via a reusable mocked-API screenshot harness
  (`harness.mjs`), fan out three critics (art director / token surveyor /
  fresh-eyes GP persona), orchestrator rulings with documented overrules,
  one settled stylist brief, before/after verification. Documents the known
  agent-race and re-render-during-bubble failure modes and their checks.

## [v3.60.4] — 2026-06-12

### Slots — design-crit pass (three-critic review, orchestrated)

Findings from an art-director crit, a token/code survey and a fresh-eyes GP
persona pass, applied in one sweep:

- **Alert hierarchy restored**: the ribbon now renders above the hero, the
  hero card itself wears the amber/red wash when a rule trips, and the
  decorative AM|PM split bar is gone. Clinician-row AM|PM strips desaturated
  to neutral slate/blue — amber no longer appears in resting chrome, so when
  it does appear, it means something.
- **One data home**: the BY TYPE list (checkboxes + am/pm detail) collapses
  into an on-demand panel — pills are the glance layer, the list is the
  control layer; its open state persists per workstation.
- **One date zone**: Today / Next working day / date picker / refresh
  consolidated into a single row; refresh and alert icons now Feather strokes
  (emoji removed from chrome); alert ribbon gains an "Edit thresholds" link.
- **Designed empty state** (calendar icon + label, hero suppressed) replacing
  the bare string with a shouting zero.
- **Organise-mode accessibility**: pills are keyboard-operable (tab, Enter to
  colour, arrow keys to reorder), aria-live announcements, focus rings on
  swatches, ghost-styled Done button, contained swatch styling.
- Canon clean-up: am/pm unit labels raised from 8px to legible 9px, hints
  de-italicised to AA contrast, focus-visible corrections, reduced-motion
  kill switch on the skeleton, dead CSS removed.

## [v3.60.3] — 2026-06-12

### Slots pill configuration + "Choose your tabs"

- **Slots pills are now fully user-configurable**: an organise mode (✎ on the
  pill row) gives drag-to-reorder and a per-type colour palette (the same
  10-colour set as Reception's tiles). Alert amber/red ALWAYS overrides a
  custom colour — safety salience is not configurable away. Preferences are
  user config (`slots.pillPrefs`), included in suite backups.
- **Per-clinician bars**: each BY CLINICIAN row gains a share-of-total wash
  and a proportional AM|PM strip along its bottom edge.
- **Choose your tabs** — new setup-checklist step and Ctrl+K command ("Choose
  tabs…"): role presets (GP/clinician, Reception, Practice manager,
  Everything) plus per-tab toggle cards, each with a one-line explainer of
  what the tab does (new users don't know what "Condor" is). Changes apply
  live; hidden tabs stay reachable from the palette; at least one tab always
  stays visible. The choice is **user-owned**: stored in `suite.hiddenTabs`,
  carried in the user's own backup, and architecturally unreachable by
  practice-profile central deployment (profiles never push `suite.*`
  preference keys). Tab metadata lives in `side-panel/tab-catalog.js` with a
  new CI guard (`test-tab-catalog.js`) keeping it in lock-step with the real
  nav, mirroring the tour guard.

## [v3.60.2] — 2026-06-12

### Slots — glanceable redesign (hero card, type pills, share bars)

- **Hero card**: headline total, AM/PM chips and a proportional AM|PM split
  bar in one card; the "available slots" label now inherits the alert state
  (green when calm, amber/red when any slot-alert rule has tripped).
- **Type pills**: one pill per included type under the hero — dot + name +
  bold count, biggest first. The dot is slate normally and turns amber/red
  when that type is at/below its configured alert threshold, so colour
  carries signal rather than decoration (cf. the Medicus internal mock's
  categorical dots).
- **BY TYPE rows de-noised**: bold totals form a scannable right-hand column,
  AM/PM demoted to muted detail, the always-on percentage replaced by a
  subtle share-of-total micro-bar behind each row (exact % in the tooltip).

## [v3.60.1] — 2026-06-12

### Safety-doc reissue for the 3.57–3.60 releases (CSO-directed)

- **CLINICAL-SAFETY-NOTICE v3.5** — intended purpose, regulatory assertions and
  limitations updated for the UX/onboarding releases: limitation 26 corrected
  ("Results are not stored" → sweep results persist ≤2h for resume, with
  staleness caution), limitation 27 updated for capture drafts, and new
  limitations 32 (clinic mode — desktop pop-ups/sounds only, never clinical
  surfaces), 33 (Today tab — administrative glance; alert log is a convenience
  record, not an audit trail) and 34 (drafts/resumed sweeps are point-in-time
  working copies). DOES-NOT item 8 now honestly enumerates the short-lived
  local working copies that contain patient data and their TTLs.
- **HAZARD-LOG v3.6** — new hazards H-027 (resumed sweep staleness), H-028
  (clinic mode awareness delay; fail-open, code-bounded scope) and H-029
  (reception draft restored against the wrong contact — monitor); H-012 gains
  clinic mode as a bounded interruption-management control.
- **SOUP v1.2** — no SOUP changes in v3.57–v3.60 (all new code first-party);
  vendored set re-verified unchanged.
- **feature-list** regenerated at v3.60.0 (Today tab, palette, tour/setup,
  notifications/clinic mode, continuity, drafts/resume).
- `scripts/check-doc-versions.js` known-stale pins removed — the guard is
  fully strict again.

## [v3.60.0] — 2026-06-12

### Five-workstream UX release

- **The suite remembers where you were.** The side panel restores your last
  active tab on reopen (the pop-out already did), and seven modules persist
  their view state for 24h via a shared helper (`suite.uiState`, per-machine,
  not backed up): Trends metric, Activity date range + mode, Referrals
  filters/chart/search, Capacity focus date, Knowledge search/category/expanded
  entry, Slots filters + expanded clinicians, Submissions mode + muted series.
- **Never lose typed work.** Reception guided-capture auto-saves a draft as you
  type (4h TTL, "Restore / Discard" banner, draft pill on the pathway tile,
  cleared on generate). Sweep runs and batch selections persist (2h TTL) with a
  "Resume last sweep" card — a tab switch no longer wipes the morning huddle.
  Both keys are transient, PHI-bearing and excluded from backups.
- **First-run setup checklist.** A dismissible "Get set up" card walks a new
  user through practice-code detection/confirmation, a live connection test and
  the desktop-notification permission, with the triage monitor as an optional
  step. Reopenable via Ctrl+K → "Suite setup checklist". Every module's
  "No practice code" error now carries the same "Set up now" CTA.
- **Today tab — the morning command centre.** New default tab (in panel and
  pop-out): waiting room, triage load, demand vs thresholds, slots remaining,
  last sweep summary and recent alerts, each card deep-linking to its module.
  Tour version 4 adds a Today step.
- **One attention model.** New Options → Notifications section listing every
  channel with toggles for desktop pop-ups, sound and the toolbar badge, plus
  **clinic mode** (mute 30 min / 1 h / until 18:00) with a 🔕 pill in the nav
  and Ctrl+K commands. Safety boundary, stated in the UI and enforced in code:
  clinic mode silences desktop pop-ups and sounds only — on-screen strips,
  badges and clinical alerts in the patient record are never muted. A capped
  alert log keeps a muted hour reviewable on the Today tab.
- Release was bug-bashed (three reviewers + verification pass): no red
  findings; four minor (amber) fixes applied — pop-out boot validates the
  saved module, setup notification-permission failure is reflected in the
  checklist, "Until 18:00" clicked after 18:00 rolls to tomorrow, disabling
  the toolbar badge clears it immediately.

## [v3.59.0] — 2026-06-12

### Command palette (Ctrl+K)

- **One keystroke to anywhere.** Ctrl+K (or the search button in the nav)
  opens a command palette in both the side panel and the pop-out window:
  jump to any tab (commands are built from the live nav, so they respect
  custom tab order and each window's tab set), switch theme / text size /
  colour-blind palette (applied live on every page), open a **specific
  Options section** directly, open the visualiser or pop-out, or replay the
  guided tour. Fuzzy matching with keyword aliases; your five most recent
  commands float to the top of an empty query. Keyboard-first: type, ↑↓, ↵,
  esc.
- **Options deep-linking.** `options.html#sect-<name>` now opens straight
  onto that section (and reacts to hash changes). Used by the palette's
  Settings commands, and the Monitoring panel's "Monitoring settings" item
  now lands on the Monitoring section instead of the generic Suite tab.
- Tour version 3: a new "One keystroke to anywhere" step — returning users
  see it as a single-step What's-new pass; the palette core logic
  (scoring/ranking/recents) is unit-tested in `test-palette-core.js`.

## [v3.58.1] — 2026-06-12

### Tour staleness guard (CI) + practice-push deployment guidance

- **New regression test `test-tour-steps.js`** keeps the guided walkthrough in
  lock-step with the UI: it fails CI when a tour step's anchor selector is no
  longer rendered by any source, when a new side-panel tab ships that is
  neither taught by a step nor consciously recorded as overview-only
  (`NAV_COVERED_BY_OVERVIEW`), or when step structure / `addedIn` version tags
  are malformed. Adding a module now forces a tour decision on the same PR.
- **`update-tour` skill** updated to reference the guard, and gained a
  "Practice-pushed deployments" section: the tour's new-user/returning-user
  split is profile-based (full tour for untouched profiles, "What's new" pass
  only when `TOUR_VERSION` is deliberately bumped), so shared-folder overwrites
  need no install hooks — plus the same-folder-path caveat (a path change
  resets the unpacked extension's ID and all its state) and the
  shared-Chrome-profile note for rollout comms.

## [v3.58.0] — 2026-06-12

### Suite-wide first-run walkthrough + Monitoring action bar relocation (Sentinel v0.5.1)

- **The guided tour now covers the whole suite and greets first-run users on
  install.** The engine moved from the Monitoring module to the shell
  (`side-panel/tour/`), auto-starts when the side panel first opens (whatever
  tab is active), and can switch tabs as it walks: nav + drag-to-reorder,
  global alert strips, Slots, the Monitoring deep-dive (waiting room, brief,
  action bar, Verify in Medicus, unmatched meds), then display settings,
  pop-out and Settings. Tour version bumped to 2 — users who completed the v1
  Monitoring tour get a short "What's new" pass of only the new steps.
  Replayable from the Monitoring More menu or Options → Suite (replay works in
  the pop-out window too).
- **Monitoring actions re-anchored under the pre-consultation brief.** The
  header icon row read as disassociated chrome (user feedback). The actions
  are now a clearly labelled bar — icon + text: Appointments, Copy actions,
  Print summary, More — sitting directly beneath the brief card they act on.
  The header keeps just the title, version and refresh. The bar stays in the
  persistent scaffold, so the no-flicker guarantees from v3.57.0 hold.

## [v3.57.0] — 2026-06-12

### Monitoring panel — header toolbar, flicker fix, guided tour (Sentinel v0.5.0)

- **Actions moved into a sticky header toolbar.** The footer buttons (Settings,
  Appts Summary, Copy All Actions, Print Patient Summary, Export Evaluation Log)
  were below the fold. They are now compact icon buttons with tooltips in a
  toolbar that sticks to the top of the panel; rarely-used actions (Monitoring
  settings, Export evaluation log, Replay the guided tour) live behind a single
  ⋯ overflow menu. The footer keeps only passive metadata ("Data at HH:MM" and
  the rules-currency line).
- **Popup flicker fixed at the root.** Modals opened from the action buttons
  were being destroyed by the 10-second snapshot re-render, which replaced the
  module's entire DOM (including any open modal) on every poll tick. The module
  now renders a persistent scaffold once and re-renders only the data section —
  and skips even that when the generated content is unchanged. Modals live in a
  host node outside the re-rendered region, so they survive refreshes; they are
  also now viewport-fixed (always fully visible regardless of scroll) and close
  on Escape.
- **Actions renamed for clarity** (sentence case, one-line tooltips on
  everything): "Appts summary" → **Appointments needed** (it builds a copyable
  list of the appointments this patient is due, for admin to book); footer
  "Settings →" → **Monitoring settings** in the overflow menu (it duplicated
  the nav-bar gear, so it no longer takes prime toolbar space).
- **First-run guided tour.** A spotlight step-through of the waiting-room
  block, pre-consultation brief, Verify in Medicus, meds-without-a-monitoring-
  rule and the new toolbar. Versioned — steps added later show as a short
  "What's new" pass; restartable from the ⋯ menu or Options → Suite. Steps are
  pure data in `side-panel/modules/sentinel/tour-steps.js`; a new
  `update-tour` skill documents the maintenance procedure.

## [v3.56.2] — 2026-06-11

### Bug fixes — Sentinel panel

- **Meds without a monitoring rule — auto-close fixed.** The `<details>` panel was
  collapsing on every snapshot re-render (≈10–15 s). The open state is now preserved
  across renders.
- **Meds without a monitoring rule — noise reduced.** A new `drug-no-monitoring` rule
  type in `drug-rules.json` marks common drugs that have no BNF/NICE-mandated routine
  blood monitoring protocol (aspirin, clopidogrel, tamsulosin, fluticasone/azelastine,
  beta-blockers, CCBs, PPIs, LABAs/LAMAs, antihistamines, etc.). These are now excluded
  from the unmatched list so it focuses on genuine brand-name mismatches rather than
  every drug without a monitoring rule.
- **Custom Drug Monitoring section no longer shows custom QOF indicators.** The
  `renderCrList()` function in `sentinel-options/options.js` was showing all custom
  rules regardless of type, causing custom clinical indicators (CHOL004, ferritin
  alerts, etc.) to appear as "0 tests" entries in the drug monitoring section.
  Fixed by filtering to `type === 'drug-monitoring'` only.

## [v3.56.1] — 2026-06-11

### Security audit remediation (third pass — branch `claude/security-audit-li13eq`)

Findings from the 2026-06-11 authorised red-team audit. This pass remediates the
four in-scope code findings; the PDF.js upgrade (NF6) remains tracked separately
as it requires re-vendoring.

- **M1 (Medium) — Referrals discovery no longer persists or backs up patient
  data.** `content-scripts/referrals-discovery.js` captured the full referrals
  clinical-audit-report API payload (patient-identifiable rows) into
  `referrals.discovery` (plaintext on disk, not consume-on-read), and
  `shared/io/referrals-io.js` exported it into suite backups. The discovery key
  now stores only `{ url, discoveredAt }`; the stored config copy is trimmed to
  `priorityOptions`/`statusOptions` only; the side panel re-fetches live data
  and never read the persisted rows. `referrals.discovery` is removed from the
  backup export (kept live-only and allowlisted in `test-backup-coverage.js`);
  `referrals.config` (non-PHI) is retained. `suite-envelope.js` preview updated.
- **M2 (Medium) — Operational alert thresholds validated on import.**
  `shared/io/submissions-io.js` and `shared/io/triage-alert-io.js` now reject
  non-finite / non-positive thresholds (and non-boolean `enabled`) on import,
  mirroring `engine/ruleset-io.js`. Previously a crafted backup with a string
  threshold survived import and made `value >= (t.red || Infinity)` evaluate
  `value >= NaN` (always false), silently disabling the submissions RAG strip /
  triage demand notifications. Regression tests in `test-import-hardening.js`.
- **L1 (Low) — `sentinel-io.js` non-merge import path now strips dangerous
  keys.** The replace path wrote `data.rules` raw while the merge path already
  stripped `__proto__`/`constructor`/`prototype`; both paths now call
  `_stripDangerousKeys()`. Regression test added.
- **L2 (Low) — Transient print/passport keys gain a best-effort TTL backstop.**
  `sweep.handout`, `sweep.batchPack` and `sentinel.passport` already self-clear
  on print-tab render; a 60s `setTimeout` backstop at each write site now also
  clears them if the tab never renders.

## [v3.56.0] — 2026-06-11

### CSO review decisions (recorded 2026-06-11, PR #78)

- **Epiglottitis promoted to red**: new dedicated `epiglottitis` triage rule
  (drooling / cannot swallow saliva / muffled "hot potato" voice / explicit
  mention) with an airway-emergency note (999, do not examine the throat,
  sit upright). The two phrasings are removed from the amber `sore-throat`
  rule. Shipped defaults config version bumped 2 → 3 so existing stored
  configs receive the new builtin rules (`dka-hhs`, `epiglottitis`) via the
  non-destructive merge.
- **LMWH/heparin**: confirmed excluded from the visualiser oral-anticoagulant
  set; KD-18..21 remain deliberately pinned in `test-pincer-parity.js`.
- **Hazard log v3.5 signed off** by the CSO (H-022..H-026 accepted).

### Gauntlet follow-up batch (B1 / B3 / M2-T4, CSO-approved)

1. **PINCER rule-shape parity (B1).** All four pinned divergences KD-30..33
   closed with additive alerts: the visualiser's `computePINCER` gains the
   triple-whammy rule (PINCER#4/STOPP), NSAID+antiplatelet with the same
   anticoagulant-precedence as the triage HUD (PINCER#3/STOPP), and
   benzodiazepine/Z-drug in age ≥80 (STOPP; new `benzo_z` table entry,
   fail-closed on unknown age); the triage HUD gains PINCER#1 — NSAID in
   age ≥65 without gastroprotection (new PPI/H2 `GASTRO` regex, fail-closed,
   topical-excluded). `test-pincer-parity.js` now pins only the deliberate
   LMWH/heparin divergences (KD-18..21).

2. **Sweep batch Action Packs (B3).** Multi-select on the Sweep action
   worklist with a one-click batch generator: a print-first tab with
   per-patient blood-form / recall-SMS / task sections plus a consolidated
   copyable SMS list for Medicus batch messaging. Uses the established
   consume-on-read transient print-key pattern; generates artefacts only,
   never sends; selection is in-memory and cleared on re-render/cleanup.

3. **Clinical-safety documentation refresh (M2 / audit T4).**
   CLINICAL-SAFETY-NOTICE v3.4, HAZARD-LOG v3.5 and SOUP v1.1 brought
   current to product 3.56.0: intended-purpose and scope updated for all
   modules shipped since 3.26.4/3.33.0; five new hazards recorded
   (H-022 Condor metrics, H-023 Sweep batch wrong-patient, H-024 Reception
   over-reliance, H-025 Trends sparse-data misread, H-026 triage red-flag
   false-negative reliance); H-005/H-016 controls updated for the
   extraction-health and PINCER-parity work; SOUP reconciled against
   vendor-versions.json with a new dev-dependencies section. The
   `KNOWN_STALE` pins in `scripts/check-doc-versions.js` are removed —
   the CI doc-version guard now fully enforces.

4. **Triage red-flag phrasing extensions (L1).** Additive lay-phrasing
   coverage from the 2026-06-11 red-team, applied to defaults.json and
   regenerated into the derived copies: stroke-tia (can't get words out /
   both arms weak), sepsis (fever + feeling dreadful, uncontrollable
   shivering), meningitis (non-blanching rash phrasings incl. the glass
   test), chest-pain (22 atypical-MI literals: jaw/neck/arm + sweat,
   indigestion + arm), thunderclap (+ stiff-neck combinations),
   cauda-equina (lost sensation down below), uti (retention phrasings,
   deduplicated against cauda-equina), insect-bite (tick / bull's-eye
   rash / Lyme), shingles (unilateral burning prodrome). One pattern
   REJECTED as over-match-prone ("trouble speaking" — benign collisions);
   epiglottitis signs (drooling, hot-potato voice) added to sore-throat
   at AMBER pending a CSO decision on a dedicated adult red rule.
   +36 pattern assertions with negative controls (675 green).

## [v3.55.0] — 2026-06-11

### Suite-wide UI overhaul — "Atelier" design pass

A full design-system pass over every surface of the suite, executed by the new
`ui-design` skill (`.claude/skills/ui-design/` — doctrine, token canon, stylist
subagent briefs, and a headless Playwright screenshot harness, all added in
this release and used to verify the pass in light *and* dark themes).

**Token canon (`side-panel/panel.css`).** The `:root` system gains status
*triads* (ink/wash/line: `--red`/`--red-dim`/`--red-line` etc., incl. accent),
`--accent-hover`, a radius scale (`--r-sm/md/lg/pill`), a three-step shadow
scale, motion tokens (`--ease`/`--fast`/`--med`), and `--t1..--t5` aliases that
heal old strip rules which referenced tokens that never existed. The colorblind
mode now swaps the *whole* red/green triads, so any component built from triads
inherits the swap for free. A global `:focus-visible` ring and a
`prefers-reduced-motion` kill-switch ship suite-wide.

**Bug-class fixes the pass surfaced and removed everywhere:**
- *Dark-only literals in theme-neutral rules* — `#fbbf24`/`#f87171`/`#4ade80`
  text and `rgba(255,255,255,…)` surfaces that washed out in light theme
  (strips, pills, referrals/activity card surfaces) — all tokenised.
- *Phantom tokens* — `reception.css`/`sweep.css` referenced `--text-primary`,
  `--bg-card`, `--border-muted` & co. (never defined; everything silently fell
  to fallbacks), plus `rem` font sizing that ignored the suite's zoom-based
  size setting; both rebuilt on the canon, and sweep's hand-rolled (and wrong)
  dark-theme block deleted in favour of automatic token theming.
- *Unstyled form controls* — the options page only styled `input[type=text]`,
  so the feedback-email and number inputs rendered as white UA-default boxes in
  dark mode; inputs/selects/textareas across options pages now styled, with
  `outline: none` suppressions removed in favour of visible focus rings.
- *Clinical-signal drift* — the injected Triage Lens HUD and Sentinel sidebar
  used *different reds/ambers/greens* for the same severities (and `#1f3a5f` vs
  `#1e3a5f` navy). Both injected stylesheets now carry self-contained token
  blocks mirroring the suite canon, so a chip means the same thing everywhere.
  Full-ink fills on clinical RAG pills/banners are deliberately retained
  (salience is a safety property); their text now uses `var(--bg-deep)` so the
  pastel dark-theme inks keep contrast.
- *Layout-shift actives* — nav tabs, filter buttons, mode tabs and the options
  side-nav reserved transparent borders so activation no longer nudges layout.
- *Accessibility* — `:focus-visible` rings on every interactive element
  (including the visualiser, which had none), `:disabled` states added
  throughout, tabular numerals on counts, machine-voice labels cast to mono.

The visualiser keeps its intentional NHS palette; its pass was states,
dark-theme gaps (badges/table hairlines now legible on dark) and print
(`thead` repeats, rows no longer split across pages).

No JS or rule-engine changes; CSS and embedded-style/HTML-attribute edits only.
Tests: full suite green (50 suites).

## [v3.54.0] — 2026-06-11

> Note: originally drafted as v3.53.0/v3.53.1 on the review branch; renumbered to
> v3.54.0 because main released unrelated v3.53.x versions in parallel.

### Clinical rules — The Keeper: visualiser drug-table completion

Closes 28 of the 36 divergences documented by `test-pincer-parity.js` between
the visualiser's `HIGH_RISK_DRUGS` tables and the active triage-lens
prescribing flags. Data-table edits only; provenance reused from the
2026-06-11 emc-corroborated Keeper run. Same patient, same record — the
visualiser and the triage HUD now flag the same drug sets.

- **`nsaid_long`**: completed to the full UK systemic NSAID set (16 terms
  added, incl. both `indometacin`/`indomethacin` spellings and the dex-
  derivatives — the visualiser matches with `\b` word boundaries, so
  substring coverage from `ibuprofen`/`ketoprofen` did not apply).
- **`warfarin` → `Warfarin / VKA`**: added `acenocoumarol` and `phenindione`
  (all UK oral VKAs share INR/42-day monitoring, BNF 2.8.2).
- **`acei`**: added trandolapril, fosinopril, quinapril, imidapril,
  cilazapril, telmisartan, azilsartan, eprosartan.
- **`diuretic`**: added torasemide, hydrochlorothiazide, chlorthalidone,
  metolazone; and `frusemide` (old UK spelling) added to the triage-lens
  `DIURETIC` regex in the other direction.
- **Deliberately NOT changed** (pinned in `test-pincer-parity.js` for CSO):
  LMWH/heparin stay out of the visualiser anticoag set (KD-18..21 — would
  need a logic change and the verifier advised against LMWH in oral-
  anticoagulant PINCER lists); the four rule-shape gaps (KD-30..33: no
  triple-whammy / NSAID+antiplatelet / benzo≥80 rule in the visualiser, no
  PINCER#1 age-gate in the HUD) need logic, not data.

Tests: parity test rewritten — divergences 36 → 8, resolved sets converted to
positive both-sides coverage (189 assertions); drug-table completeness locks
added to `test-visualiser-pincer.js`; frusemide triple-whammy added to
`test-prescribing-flags.js`. Full suite green (50 suites).

### Repo-audit fix batch (quick wins + Milestones 0–2)

Implements the actionable findings of the 2026-06-11 repo audit. Six commits
(`0b5ff1f`..this), all verified against the full test suite (50 suites green).

**Safety net / CI**
- New `scripts/check-doc-versions.js` CI gate: safety-doc Product versions must
  track the manifest. The four currently-stale docs (CLINICAL-SAFETY-NOTICE
  3.26.4, HAZARD-LOG/SOUP 3.33.0, feature-list 3.31.2) are pinned KNOWN_STALE
  with a loud warning pending CSO review (audit T4); any NEW drift fails CI.
- New `test-service-worker.js` (76 assertions): vm-extracted behaviour tests for
  alarm scheduling, update-notification dedup, RM notification formatting and
  caps, plus source-invariant locks (importScripts try/catch coverage, onMessage
  sender guard, alarm↔handler pairing, F2 data-minimisation).
- New `test-api-clients.js` (109 assertions): pins 401/403/500, network-failure
  and malformed-JSON contracts for medicus-api, referrals-api, activity-api.
- New `test-pincer-parity.js` (138 assertions): pins parity between the
  visualiser's `computePINCER` and the triage-lens prescribing flags; documents
  36 KNOWN_DIVERGENCES for CSO review (headline: the visualiser's drug tables
  are missing 32 agents the active HUD covers, incl. the 2026-06-11 Keeper
  additions). Fails only on NEW divergence.

**Hygiene**
- Deleted `push-initial.sh` (force-pushed a stale v1.3.1 tag — landmine).
- Archived completed plan docs into `docs/archive/`; README module list brought
  current.

**Refactors / behaviour**
- `shared/display-prefs.js`: single implementation of the display-preferences
  applicator, replacing five inline copies (panel, pop-out, options ×2,
  visualiser). One copy remains in `content-scripts/triage-lens/options.js`
  (follow-up).
- `side-panel/module-loader.js`: shared `ensureModuleCss` + parameterised
  module switcher used by panel and pop-out (net −52 lines).
- Polling resilience: the three panel strips (WR/RM/sub-RAG) and the worker's
  request-monitor alarm now back off on consecutive failures (delay doubles per
  failure, capped at 8×, resets on success) instead of hammering the API at a
  fixed rate during outages.
- Best-effort failures surfaced: journal-augmentation failure now flags the
  sentinel snapshot and renders a muted warning (so `no_data` from a failed
  fetch is distinguishable from absent data); update-check failures persist to
  `suite.updateCheck.status` and show in Options.
- `shared/extraction-health.js`: hard 50-bucket cap on the stored extraction
  baseline (oldest evicted).

**Deferred (tracked in the audit report):** T4 safety-doc content refresh (CSO),
T10 per-section extraction canaries, T11 pdf.js ≥4.2.67 upgrade, T12
practice-profile refactor.
## [v3.53.3] — 2026-06-11

### Fixed: resilient Sentinel custom-rule import in suite restore

Whole-suite backup restore now imports custom Sentinel monitoring rules resiliently — a single invalid/legacy custom rule no longer rolls back the entire restore. Valid rules are imported and skipped rules are surfaced in the status message instead of being silently dropped. The dedicated Sentinel-options import was already resilient; this fix brings suite restore into line with it.

## [v3.53.2] — 2026-06-11

### Removed: Dispensing Margin (`rxmargin`) module

The Dispensing Margin module (added in 3.53.0/3.53.1) has been removed from Medicus
Suite — it is being developed as a standalone product in its own repository rather
than as a suite module. This reverts the module files, the side-panel/pop-out nav
entries and registries, the `rxmargin` backup scope and envelope preview, the
options export card and IO script, and `test-rxmargin-core.js`. No other module is
affected. (The richer release pipeline added in 3.53.1 — CHANGELOG-derived notes and
SHA-256 checksums — is retained, as it is independent of the module.)

## [v3.53.1] — 2026-06-11

### Release pipeline — fully-decorated GitHub Releases

The `Release` workflow now publishes a proper release rather than a one-line stub:

- **Real release notes** — the body is generated from this version's `CHANGELOG.md`
  section, so each GitHub Release shows exactly what changed.
- **Checksums** — a `SHA256SUMS.txt` is built and attached next to the extension
  zip, with copy-paste `sha256sum -c` verification instructions.
- **Inline install steps** — load-unpacked instructions are included in the release
  body so users don't have to leave the page.

#### Headline of this build — Dispensing Margin (`rxmargin`)

The flagship addition shipping in the 3.53 line: an offline dispensing-margin tool
for UK dispensing GP practices. It computes net margin after the Drug Tariff
clawback, finds the cheapest supplier on file, flags loss-making lines, and totals
the cash freed by switching — with a category breakdown, RAG margin-health bands,
cost-per-unit comparison, a margin trend sparkline, a one-click "switch all to
cheapest supplier" action, and a printable board report. All prices are entered or
CSV-imported by the practice; no licensed price feeds are bundled.

## [v3.53.0] — 2026-06-11

### New module: Dispensing Margin (`rxmargin`) — offline RxMargin alternative

A working, offline alternative to RxMargin (rxmargin.co.uk) for UK dispensing GP
practices. Dispensing practices buy medicines from wholesalers but are reimbursed
at Drug Tariff prices minus the NHS discount-deduction "clawback", so a line's
profit is `tariff x (1 - clawback) - purchase cost`. The module turns each
practice's own prices into the money decisions that save cash. All prices are
entered or CSV-imported by the practice; no licensed Drug Tariff / wholesaler
feeds are bundled, and data stays on the device.

**Core ledger**
- Per-product margin: net reimbursement after clawback, margin per pack and margin
  %, monthly/annual profit at the supplier currently used.
- Best-buy detection and supplier-switch savings, ranked biggest-first; loss-maker
  flagging where the clawed-back tariff no longer covers purchase cost.
- Configurable clawback model — dispensing-doctor flat rate (default 11.18%, the
  SFE reference) or pharmacy group rates (generics 20%, branded 5%, appliances
  9.85%, DND 0%); all figures user-editable to track the Drug Tariff.

**Market-feature set** (from a competitive scan of UK dispensing/pharmacy margin
tools — RxMargin, Dispex/DispensingRx, Drug Tariff Pro/PharmData,
OpenPrescribing/ePACT2, PMR analytics, wholesaler ordering platforms)
- Cost-per-unit normalisation to compare pack sizes like-for-like.
- Margin-by-category breakdown (generic / branded / appliance / DND).
- Configurable RAG margin-health thresholds with per-line badges.
- "Switch all to cheapest supplier" one-click scenario (fully reversible).
- Margin trend sparkline backed by a capped monthly history (`rxmargin.history`).
- Loss -> recovery hint (price concession / out-of-pocket / broken-bulk, or
  prescribe rather than dispense).
- Printable board report (KPIs, category breakdown, top switches, loss-makers)
  via the browser's print-to-PDF.

**UI**: glass design — theme-derived translucent panels with `backdrop-filter`,
gradient accents, frosted cards/buttons/modals, sticky table header, and a
`prefers-reduced-motion` fallback; adapts to light/dark/colourblind themes.

**Correctness / security (red-team)**: blank/non-numeric supplier prices are
treated as unpriced rather than coerced to GBP0 (they had masqueraded as the
cheapest buy and produced bogus margins/savings); CSV export neutralises
spreadsheet formula-injection, lossless on re-import; removed a stray NUL byte
from the product-grouping key.

Wired into the side-panel and pop-out nav, the suite backup envelope (`rxmargin`
scope, `shared/io/rxmargin-io.js`) and the per-module export cards in Settings.
Pure margin math is regression-tested in `test-rxmargin-core.js` (70 assertions).

## [v3.52.0] — 2026-06-11

### Triage Lens — engine hardening (red-team follow-up) + DKA/HHS red flag

Engine-level fixes from the triage-lens red-team, plus the CSO-approved diabetes
re-tiering.

1. **Dropped patterns are no longer silent** (`content-scripts/triage-lens/content.js`,
   `compileRule`): a pattern that fails to compile now logs a `console.warn` naming
   the rule and pattern, and a rule left with no usable patterns logs that it will
   never fire. The options editor already blocked invalid regex at author time
   (`validateTriageRule`); this covers anything reaching runtime (legacy imports,
   regressions) so a clinical gap is visible rather than invisible.

2. **Curly quotes/apostrophes normalised before matching** (`content.js`, `getText`):
   pasted clinical-letter punctuation (’ “ ”) is folded to ASCII on both the
   `innerText` and DOM-walk paths, so patterns written with a straight apostrophe
   (e.g. `can't cope`) match regardless of the source punctuation.

3. **Threshold rules reject non-numeric thresholds** (`engine/triage-alert-engine.js`
   and the event-count path in `engine/rules-engine.js`): a `""`/`null`/missing
   threshold from an imported or hand-edited rule previously coerced silently
   (`count < ""` → never fires; `< null` → always fires). Both now coerce with
   `Number()` and skip the rule with a warning instead of mis-firing.

4. **New red flag `dka-hhs` (CSO-approved)** (`defaults.json`): explicit
   diabetic-emergency phrasing (diabetic ketoacidosis, DKA, HHS, hyperosmolar,
   raised ketones, fruity/acetone breath, diabetes + vomiting/can't-keep-fluids/
   confusion) now fires a **red** chip with a same-day/999 clinical note. The
   `diabetes` rule keeps routine glycaemic-control phrasing as **amber**. This
   resolves the prior amber-chip-vs-999-note mismatch. Derived defaults copies
   regenerated; rule pattern/schema tests green (77 rules).

## [v3.51.3] — 2026-06-11

### Clinical rules — The Keeper pass (triage-lens ruleset review follow-up)

Source-verified, additive drug-set completions arising from the triage-lens red-team. All
changes extend match lists only (no interval lengthened, no rule weakened); regression tests
added. Sources corroborated against emc SmPC product IDs and multiple NHS ICB formularies —
bnf.nice.org.uk / OpenPrescribing / MHRA register were unreachable (HTTP 403) this run, so
confidence is medium-high rather than direct-BNF; flagged for CSO awareness.

1. **NSAID drug-set — added `etodolac` and `flurbiprofen`** to the built-in prescribing-flag
   regex (`content-scripts/triage-lens/content.js`) and to every NSAID-combo rule in
   `rules/alert-library.json`. Both are currently UK-marketed oral systemic NSAIDs (Lodine SR,
   emc 3857; Froben, emc 327/326) that were absent from every list — a patient on either
   silently fired no NSAID PINCER/STOPP alert. Also added the UK dm+d/BNF spelling
   `indometacin` to the library (the existing `indomethacin` does not substring-match it;
   `content.js` already handled this via `indometh?acin`). Note: `dexibuprofen`/`dexketoprofen`
   are already covered under substring matching by `ibuprofen`/`ketoprofen` — the earlier
   red-team "missing dexibuprofen" flag did not hold; explicit entries kept for readability only.

2. **Anticoagulant set (alert-library `pincer-2`, `pincer-13`) — added `acenocoumarol`
   (Sinthrome) and `phenindione` (Dindevan)**, both active UK oral vitamin-K antagonists in
   BNF 2.8.2. These were already present in the active `content.js` anticoagulant regex; this
   removes the inconsistency in the importable PINCER library.

3. **ACEi/ARB set (alert-library `pincer-4`) — added `quinapril`, `imidapril`, `eprosartan`
   and `cilazapril`** (the last discontinued for new patients but persisting on legacy
   repeats). `moexipril` deliberately NOT added (UK-discontinued March 2016). `cilazapril`
   also added to the `content.js` ACEi/ARB regex for the triple-whammy flag.

Bumped `alert-library.json` to v1.2. Tests: extended `test-prescribing-flags.js` (NSAID
coverage loop + cilazapril triple-whammy); full rule suite green.

### Proposed, NOT applied — awaiting CSO decision

- **Diabetes triage chip tiering.** The `diabetes` rule (`defaults.json`) renders an **amber**
  chip even when the request text is explicit DKA/HHS ("diabetic ketoacidosis", "ketones in my
  blood", "fruity breath" + vomiting), while its own action note escalates those to "→ 999".
  Escalating the DKA/HHS-specific subset to a **red** chip is recommended but is a behaviour
  change left for CSO sign-off rather than applied silently.
## [v3.51.2] — 2026-06-10

### Security / bug fixes (2026-06-10 authorised audit)

Four fixes from the 2026-06-10 authorised security and correctness audit:

1. **Transient print keys consumed on read** (`side-panel/modules/sentinel/passport.js`,
   `side-panel/modules/sweep/handout.js`): `sentinel.passport` and `sweep.handout` are now
   removed from `chrome.storage.local` immediately after the DOM is rendered. Patient-
   identifiable data (name, DOB, NHS number, observations) no longer lingers on shared GP
   workstations. A manual page refresh after printing will show the empty state — this is
   intentional.

2. **Prototype-pollution defence on clinical-rules import/merge path**
   (`shared/io/sentinel-io.js`, `shared/io/practice-profile.js`): `Object.assign` merges of
   untrusted backup data into clinical rules and reception config now strip `__proto__`,
   `constructor`, and `prototype` keys from the untrusted operand before merging. Mirrors the
   `safeCopy` pattern already in `engine/ruleset-io.js`.

3. **Trends `onMessage` sender-identity guard** (`side-panel/modules/trends/trends.js`):
   The `onRuntimeMsg` handler now checks `sender.id === chrome.runtime.id` before processing,
   matching the guard pattern used by every other `onMessage` handler in the suite.

4. **passport-core.js eGFR / HbA1c trend delta uses raw values**
   (`side-panel/modules/sentinel/passport-core.js`): Trend-sentence functions now receive
   raw (unrounded) observation values so threshold checks operate on full precision. The
   displayed value is still the rounded integer. This corrects cases where rounding caused a
   real ≥15% eGFR decline to go unreported, or a sub-threshold HbA1c delta to fire spuriously.

## [v3.51.1] — 2026-06-10

### Maintenance: The Keeper re-aimed at every clinical rule set in the repo

The Keeper skill (periodic rule-currency check) previously targeted only the four original
JSON rule files. The repo now carries clinical content in more places, so the whole pipeline
(skill, scanner/verifier briefs, source register, change schema, report builder, scheduled
task) is retargeted. No extension code changes.

- Two new scanner domains (4 → 6):
  - **MEDREVIEW** — owns `engine/acb-scores.js`, `engine/stopp-start.js`, and the
    PINCER/high-risk-drug tables in `visualiser-core.js`. Sources: Boustani ACB scale via
    ACBcalc, STOPP/START v3 (2023), PRIMIS PINCER, BNF/dm+d/emc, MHRA DSU. Carries the
    standing CSO-verification duty for the v3.51.0 starter sets. Data tables only, never logic.
  - **PATHWAYS** — owns `rules/reception-pathways.json` (whose own sourceNotes already
    requested Keeper coverage) and the guideline threshold constants pinned by
    `test-clinical-thresholds-sync.js`. Sources: NICE CKS red-flag lists, NG12, NG51, NG143,
    NHS Pharmacy First pathways, NG136, NG28, KDIGO.
- Verifier split updated: VERIFIER-A takes DRUGS+ALERTS+MEDREVIEW (medicines safety),
  VERIFIER-B takes QOF+VACCINES+PATHWAYS. Escalation-tier demotions in reception pathways now
  count as safety-weakening changes requiring CSO sign-off.
- Change schema: new domains `medreview`/`pathways`; new change types `change-score`,
  `change-criterion`, `change-redflag`; report gains two sections.
- Stage-3 regression-guard and test-suite lists extended (ACB, STOPP/START, visualiser PINCER,
  reception pathways, clinical-thresholds sync, passport/brief cores). Threshold edits must land
  in all pinning files plus the sync test together.
- ALERTS scanner no longer proposes STOPP/START items (routes to MEDREVIEW — no duplicates).
  eFI/Charlson explicitly documented as out of scope (fixed published instruments).
- `monthly-rule-currency` scheduled task updated to match.

## [v3.51.0] — 2026-06-10

### Feature: SMR workstation lens in the visualiser — ACB burden, STOPP/START v3 flags, printable SMR skeleton

Adds a Structured Medication Review (SMR) tab to the patient record visualiser, providing
anticholinergic cognitive burden scoring, STOPP/START v3 prescribing flags, and a
printable NHS Network Contract DES-aligned SMR documentation skeleton.

ACB scores and STOPP/START criteria are a starter set requiring Clinical Safety Officer
verification before clinical release.

- New `engine/acb-scores.js`: dual-mode (browser global `ACBScores` / Node `module.exports`)
  anticholinergic burden scorer. Curated Boustani ACB scale starter set with score-3 TCAs,
  urological antimuscarinics (with UK brands: Ditropan, Lyrinel, Kentera, Detrusitol, Vesicare,
  Toviaz), hyoscine, sedating antihistamines, selected antipsychotics, antiparkinson
  antimuscarinics; score-1 mild-ACB entries. Longest-match-wins prevents double-counting.
  Exports `computeACB(drugs)` → `{ total, perDrug, alert: total >= 3 }`.
  Trospium assigned ACBcalc score 1 (quaternary, limited CNS penetration) with comment.

- New `engine/stopp-start.js`: dual-mode STOPP/START v3 (2023) implementable subset.
  13 criteria: STOPP 1–10 (NSAID+eGFR<50 red; NSAID+loop diuretic; first-gen AH in ≥65;
  benzo ≥65; Z-drug ≥65; digoxin+eGFR<30 red; metformin+eGFR<30 red; PPI review;
  aspirin primary prevention; long-acting sulfonylurea ≥65) and START 11–13 (statin in IHD;
  ACEi/ARB in diabetes+CKD; beta-blocker post-MI). Age-gated and eGFR-gated criteria
  fail-closed when values are absent. Duration-unknowable criteria (benzo/Z-drug) carry
  explicit snapshot caveats in the detail text.

- Visualiser UI (`visualiser-core.js` + `visualiser-core.html`):
  - New "Medication review (SMR)" tab with ACB score tile (big number, alert colouring at ≥3),
    per-drug ACB badges (score 1/2/3 colour-coded), STOPP flag list (red then amber, ⛔/⚠
    icons), START suggestion list (✚ icon), PINCER cross-link to Medications tab, and
    context info (age, latest eGFR, active drug count).
  - "Print SMR summary" button: renders a dedicated `#smr-print-block` element with patient
    identifiers, ACB table, STOPP/START table, PINCER table, and NHS DES documentation
    skeleton (changes agreed, patient decision, follow-up date, pharmacy/counselling fields).
    Print triggered via body class `.smr-printing` + `@media print` stylesheet that hides
    the app shell and shows only the print block.
  - Engine files loaded as plain `<script>` tags before `visualiser-core.js`; globals
    `ACBScores` and `StoppStart` guarded with `typeof` checks for graceful fallback.
  - eGFR derived from `invData.analytes` (same pattern as condition summaries); age derived
    from `_s.demographics.age` string (same pattern as PINCER).
  - Prominent caveat on the card and on all printouts.

- `test-acb-scores.js`: 32 assertions covering individual scores, case-insensitivity,
  total summation, ≥3 alert boundary, longest-match-wins, unknown drug, object/label input,
  UK brand names (Vesicare, Detrusitol, Ditropan).

- `test-stopp-start.js`: 74 assertions — positive and negative fixture for each of the 13
  criteria; age-gate and eGFR-gate fail-closed tests; flag structure validation.

- `manifest.json` → 3.51.0.

## [v3.50.0] — 2026-06-10

### Feature: Patient Passport — printable plain-English health summary for patients

Adds a one-click printable summary the GP hands to the patient in the room: what
monitoring or reviews are due and why, key numbers with plain-English meaning, and
whether those numbers are on track — all at reading age 9–11 with no jargon.

- New `side-panel/modules/sentinel/passport-core.js` (pure ES module, no chrome/DOM):
  exports `buildPassport(snapshot, trendData)` → `null | PassportObject`. Builds
  patient identity block (name, DOB, NHS number), `due` list from action-needed
  chips (drug-monitoring with due tests only; QOF indicators via patient-voiced map;
  vaccines; generic fallback for unmapped types), and `numbers` list (BP, HbA1c,
  eGFR, cholesterol, weight) with plain-English meaning sentences and evidence-based
  status bands. Trend sentences appended when delta exceeds documented clinical
  thresholds (≥10 mmHg systolic BP, ≥5 mmol/mol HbA1c, ≥15% eGFR change).
  Status values ∈ {good, soon, action, none}; no colour decisions in core.
- New `side-panel/modules/sentinel/passport.html` + `passport.js`: reads
  `'sentinel.passport'` transient key on load; renders header (name/DOB/NHS),
  confidentiality banner, "What's due for you" list, "Your numbers" table
  (label, big value, status chip with text label, meaning sentence), footer with
  bring-to-appointment note. Print CSS enforces 16pt body, 1.5 line spacing,
  sans-serif, black on white, colour-coded status chips with text labels, high
  contrast. Print button calls `window.print()`.
- UI in `sentinel.js`: "Print patient summary" button added to the footer
  alongside the existing action buttons (CSS class prefix `sent-pass-`). On click:
  calls `buildPassport(_currentSnapshot, _lastTrendData)`, writes `sentinel.passport`
  to `chrome.storage.local`, opens `passport.html` via `chrome.tabs.create` —
  mirroring the sweep handout pattern exactly. Button disabled when no patient
  context.
- `manifest.json` → 3.50.0; `passport.html` added to `web_accessible_resources`.
- `test-backup-coverage.js`: `sentinel.passport` added to ALLOWLIST with a comment
  noting it follows the same transient-key convention as `sweep.handout`.
- New `test-passport-core.js`: 62 pins covering all status bands, trend sentences,
  no-abbreviation requirement, nothingDue flag, null guard, and all chip types.

## [v3.49.0] — 2026-06-10

### Feature: Pre-Consultation Brief — 30-second risk-ranked patient summary card

Adds a collapsible "Brief" card at the top of the Sentinel side-panel that gives
the GP a risk-ranked glance at the current patient before the full chip list:
patient line, red/amber counts, up to 4 top action signals, and notable
observation trends.

- New `side-panel/modules/sentinel/brief-core.js` (pure ES module, no chrome/DOM):
  exports `buildBrief(snapshot, trendData)` → `null | BriefObject`. Builds
  `patientLine`, `counts` (red/amber), `signals` (max 4, STATUS_RANK then
  drug-monitoring-first type ordering), `moreCount`, and `trendNotes` (0–3
  clinically notable observation movements). Returns `null` when there are no
  signals and no trend notes (suppresses empty card). Defensive against every
  missing field.
- Clinical trend thresholds (with documented rationale as constants):
  - Systolic BP: ≥10 mmHg delta (ESH/ESC 2018 measurement variability).
  - HbA1c: ≥5 mmol/mol delta (NICE NG28 / inter-assay CV).
  - eGFR: ≥15% decline (NICE CG182 / KDIGO 2022 actionable progression).
  - eGFR improvement suppressed (only declining eGFR is flagged).
  - Matching constants are local copies of the trend.js constants with a comment
    pointing to the authoritative source — no import to avoid module side-effects.
- UI: brief card renders above the patient banner in the `data` state. Header row
  shows "Brief" label + patient name + red/amber count badges (text labels for
  colour-blind safety). Body shows severity-dotted signal lines (red dot = rank 0,
  amber dot = rank 1–2) and ↑/↓ trend notes. "+N more below" plain text when
  moreCount > 0. No link — keeps it simple.
- Collapsible: clicking/Enter/Space on the header toggles collapsed state; new
  `sentinel.briefCollapsed` key persisted in `chrome.storage.local`.
- `sentinel.briefCollapsed` added to both `sentinelExport()` and `sentinelImport()`
  in `shared/io/sentinel-io.js` per the CLAUDE.md backup convention.
- Trend data fetched in `refresh()` after the snapshot fetch (catch → null, never
  blocks Sentinel render).
- New CSS prefix `sent-brief-` in `sentinel.css`.
- 66-assertion test suite in `test-brief-core.js` covering: signal ordering
  (red before amber, drug before QOF), max-4 cap + moreCount arithmetic, drug
  signal lists only due tests, BP delta 12 → note / delta 6 → no note, HbA1c
  and eGFR thresholds (including exact boundary cases), eGFR improvement → no
  note, null snapshot → null, missing trendData → empty trendNotes, missing
  patient fields → no crash.

## [v3.48.0] — 2026-06-10

### Feature: Action Packs — copy-ready blood forms, recall SMS/letters and tasks per chip

Sentinel chips now carry copy-ready action text so clinicians can act on alerts
without hand-writing every communication.

- New `side-panel/modules/shared/action-packs.js` (pure ES module, no chrome/DOM):
  exports `buildChipActions(chip, patient)` and `buildPatientActions(chips, patient)`.
  Generates per-chip packs with `bloodForm` (only due tests, drug, status, source
  citation), `sms` (first recall ≤320 chars, NHS Behavioural Insights pattern),
  `smsEscalation` (consequence-transparent, CQC-aligned: prescriber informed /
  prescription may be paused), `letter` (~120 word behaviourally-informed body),
  and `task` (pharmacist/admin line with NHS number and order set). QOF indicator
  chips produce review SMS/letter/task. Vaccine chips produce offer SMS + task.
  Non-action chips return `null`.
- `buildPatientActions` aggregates across all action-needed chips: deduplicates
  blood-form lines, combines a single recall SMS listing all items, and produces a
  combined task block.
- UI: each action-needed chip in the Sentinel side-panel now has an "Actions"
  button below it. Clicking opens a modal titled with the chip name, showing
  labelled sections (Blood form, Recall SMS, Escalation SMS, Letter, Task) each
  with a per-section "Copy" / "Copied ✓" clipboard button.
- "Copy all actions" button added to the Sentinel footer (next to "Appts summary")
  — opens a combined modal with deduplicated blood forms, combined SMS, and
  combined task block.
- New CSS prefix `sent-act-` in `sentinel.css` for all action-pack UI elements.
- 61-assertion test suite in `test-action-packs.js` covering: overdue
  methotrexate chip (FBC+LFT overdue, U&E in-date → bloodForm lists only FBC+LFT),
  SMS ≤400 chars, escalation SMS mentions prescriber, QOF DM review SMS, vaccine
  offer SMS, non-action chip → null, `buildPatientActions` deduplication.
## [v3.47.1] — 2026-06-10

### Fix: HRT progestogen context no longer trusts an expired/historical IUS

A 52mg LNG-IUS only provides endometrial protection for its licensed life
(5 years). The HRT chip previously treated *any* problem-coded coil insertion —
including one from years ago whose device had since been removed but left
"active" on the record — as current cover, and that stale IUS could trump the
patient's actual progestogen. That is false reassurance in the patient-safety
direction (a clinician sees "cover present" when there is none).

- `buildHrtContext` (`engine/rules-engine.js`) now only counts a *problem-coded*
  IUS as cover when it was coded within `hrtContext.iusValidityYears` (new
  config, default 5y in `rules/drug-rules.json`). An older — or undated, since
  currency cannot then be confirmed — coil code is flagged `iusExpired` instead
  of asserting cover. A live LNG-IUS on the *medication* list still counts
  regardless of date.
- When an IUS is expired but the patient is on a recognised progestogen (e.g.
  micronised progesterone / Utrogestan), the chip now reports that progestogen
  rather than the stale coil.
- `shared/chip-renderer.js`: an expired-only IUS renders an amber
  "IUS expired (>5y) — endometrial cover not confirmed" prompt.
- New F11 regression tests in `test-qof-indicator-filters.js` cover the
  in-window, out-of-window, undated, medication-list, and
  expired-IUS-vs-progestogen cases.

## [v3.47.0] — 2026-06-10

Four workstreams landed together: extraction-drift detection, clinical-coverage
expansion, a per-patient evaluation audit trail, and engineering hygiene.

### Feature: Live extraction-health drift detection

The extension now self-detects when Medicus UI changes silently degrade DOM
extraction — previously a missing-chip failure mode with no warning.

- New `shared/extraction-health.js`: pure drift-detection module. Keeps a
  rolling per-view baseline (40 samples) of medication/observation/problem/
  demographic **counts** in `chrome.storage.local` (`sentinel.extractionBaseline`
  — zero PII by schema, enforced by test; deliberately excluded from backups
  as machine-local telemetry).
- Drift fires only on a sustained signature (≥4 of last 5 samples zero on a
  metric whose historical median ≥3, after a 10-sample cold-start gate) — a
  single sparse patient never alarms.
- Amber dismissible banner ("Alerts may be incomplete — this is NOT an
  all-clear") in both the in-page Sentinel HUD and the side-panel Sentinel
  module; dismissal mutes both surfaces for 24h. Drift detection can never
  break chip publication (fail-safe wrapped).

### Feature: Per-patient evaluation audit trail ("Why?" + exportable log)

- `engine/rules-engine.js` gains an opt-in trace sink (`options.trace`): for
  every rule considered it records fired/skipped, the skip reason
  (age/sex/problem filter, no drug match, register precondition, disabled…),
  the exact matched med/problem string and match term, the interval arithmetic
  (last test date + interval → due date), and the rule's source citation.
  Hot path is byte-identical when tracing is off.
- New `drugMatchDetail` and `listUnmatchedMedicationsDetailed`: unmatched meds
  now distinguish "no rule covers this" from "suppressed by an exclude term",
  shown with an amber annotation in the panel — exclude-term suppression is
  no longer silent.
- Evidence panel gains a plain-language "Why?" block per chip (e.g. matched
  term, last test date, interval, due date) plus the rule's source.
- New "Export evaluation log" button produces a per-patient JSON trace for
  audit/assurance (DCB0129/0160-style). The trace lives in memory per
  snapshot only — patient-identifiable data is never written to storage;
  export is an explicit user action.

### Clinical: QOF HF009 enabled (four-pillar HFrEF therapy)

- New `medication-all-of` indicator kind in the rules engine; `qof-hf009`
  flipped to enabled. Empty med list → `no_data` (extraction failure is not
  "not on therapy"); populated list missing a pillar → `not_met` with the
  missing class named.
- First engine-level regression tests for `observation-bundle` (DM037 8/8
  care processes) included.

### Clinical: Vaccine rules — bug fix + Green Book adult schedule expansion

- **Bug fix (safety):** vaccine status terms are now checked
  declined-before-given per record — previously a coded "Influenza
  vaccination declined" matched the given-stem "flu vaccin" and showed as
  GIVEN. Regression-tested.
- New `schedule: "once"` support for one-off (non-seasonal) vaccines, and a
  fail-closed `bornOnOrAfter` eligibility gate.
- New rules: pneumococcal PPV23 (65+, one-off), shingles/Shingrix (70–79 plus
  the phased born-on/after-1-Sept-1958 cohort; cannot verify 2-dose
  completion — noted), RSV (75–79, one-off). Pertussis-in-pregnancy
  deliberately omitted (engine has no per-pregnancy/gestation gate; omission
  documented in the rule file so it isn't "helpfully" added later).

### Clinical: Visualiser PINCER expansion

- `computePINCER` extended toward the classic PINCER indicator set: NSAID or
  antiplatelet with peptic-ulcer/GI-bleed history without gastroprotection,
  NSAID ≥65 without gastroprotection (PINCER #1), anticoagulant+antiplatelet
  without gastroprotection (PINCER #13), dual antiplatelet without PPI
  (PINCER #8), and ACEi/ARB or loop diuretic at ≥75 without recent U&E.
  Age-gated flags fail closed when age is unknown. Every flag now carries a
  `source` citation. LABA-without-ICS and COCP+VTE deferred pending complete
  UK brand lists; oestrogen-HRT/intact-uterus permanently omitted
  (undetectable from the record).

### Feature: Rule-currency automation

- `shared/rule-currency.js` gains a **red** level (QOF-year mismatch, ended
  vaccine season, >540 days old) alongside amber; Options card and Sentinel
  footer show it.
- New `scripts/check-rule-currency.js` + weekly GitHub Actions workflow
  (`rule-currency.yml`, Mondays 06:00 UTC + manual dispatch): 120-day early
  warning that opens/updates a single `rule-currency` tracking issue and
  closes it when rules are current again.

### Engineering hygiene

- **Vendor integrity:** `scripts/verify-vendor.js` verifies sha256 of every
  `vendor/` lib against `vendor-versions.json` in CI (plus uncatalogued-file
  and pdf.js/worker version-pairing checks).
- **Test runner:** CI migrated to `node --test` (fail-closed, zero test-file
  rewrites; `node test-foo.js` still works). `npm test` added.
- **Lint/format:** ESLint flat config + Prettier, tuned so existing code
  passes (no reformatting); pre-commit hook on staged files; lint CI job.
- **Drift-guards for duplicated logic:** characterisation tests pin the
  KDIGO/NICE thresholds duplicated between Trends and the visualiser, and
  the deliberately-divergent sweep/sentinel instruction wording.
- **Dedup:** identical chip-instruction helpers extracted to
  `side-panel/modules/shared/chip-instructions.js`; sentinel summary logic
  moved to a pure, Node-testable `sentinel-core.js`.

Test suite: 42 files, all passing (7 new test files; ~460 new assertions).

## [v3.46.0] — 2026-06-10

### Feature: Triage Lens — major baseline-rule expansion (52 new rules) + defaults migration

A clinically verified expansion of the shipped Triage Lens rule set, covering
the highest-value silent-miss presentations in UK GP total triage. Researched
across 8 clinical domains, then adversarially verified (dedupe, severity
calibration, over-broad pattern pruning, NICE-anchor checking) before
implementation. `defaults.json` schema version bumped to 2.

**New red rules (17):** stroke/TIA (FAST), sepsis (fever+deterioration combos),
anaphylaxis, meningitis/non-blanching rash, AAA/dissection, testicular torsion,
PE/DVT/acute limb ischaemia, acute surgical abdomen, fever in infant <3m
(NG143), paediatric respiratory distress, seizure (first/febrile/ongoing),
pregnancy bleeding/pain (?ectopic/miscarriage), reduced fetal movements
(GTG57 → maternity triage), pre-eclampsia symptoms, sudden visual loss
(detachment/GCA), septic arthritis, psychosis (first-episode).

**New amber rules (27):** NG12 2WW flags (visible haematuria, post-menopausal
bleeding, breast lump/change, dysphagia + persistent hoarseness, testicular
lump, adult jaundice), diabetes problems (DKA/HHS/hypo red flags + sick-day
rules), child dehydration, infant bilious/projectile vomiting, head injury
(NG232 incl. anticoagulant→CT), limping child, neonatal jaundice (NG98),
chickenpox/shingles in pregnancy, emergency contraception (time windows +
Pharmacy First), mastitis (feeding-context only — de-conflicted from breast
2WW), heavy menstrual bleeding (NG88), postpartum bleeding/infection, painful
red eye (gated on pain/photophobia/vision), sudden hearing loss (SSNHL),
significant epistaxis, gout (NG219), cellulitis, medication side effects,
acute confusion/delirium, alcohol misuse, eating disorders (MEED), perinatal
mental health.

**New info rules (8):** dental signposting, blood-result queries, referral
chasing, letter/report requests, travel health, weight-loss-injection requests
(GLP-1, current NICE TA status), DNACPR/ACP/LPA admin, memory concerns.

**Modified existing rules:** `sore-throat` no longer owns persistent dysphagia
(moved to the 2WW rule); `cough-resp` gains reliever-overuse/poor-control
patterns + an RCP-3-Questions / acute-severity action note; `mh-crisis` gains
postpartum-psychosis and thoughts-of-harming-baby patterns.

**Engine improvements:**
- **Defaults migration (the big one):** a stored config previously shadowed
  shipped defaults forever, so existing users would never have received new
  builtin rules without a destructive reset. `loadConfig` (content script and
  options page) now performs a version-gated, non-destructive merge: appends
  shipped builtin rules the user doesn't have, plus missing
  threshold/pref/systemChip keys; never overwrites user customisations.
  Builtins the user deliberately deleted are tombstoned (`removedBuiltins`)
  and stay deleted.
- **Severity-ordered chips:** rule chips now render red → amber → info instead
  of config order, so a red can never trail an info chip.

**New regression test:** `test-triage-rule-patterns.js` compiles every shipped
pattern under the engine's exact wrapping semantics (the engine silently skips
invalid regexes — a silent clinical miss), pins schema invariants, and asserts
~90 positive/negative match examples for the high-risk rules (including
guards against over-broad stems: "confused about my medication", "hangover",
"my eye is red", "fell out with my sister" must not fire).

## [v3.45.1] — 2026-06-10

### UX: Triage Lens — LLM rule generator moves inside the "New rule" form

The "Generate a rule with an LLM" section is now hidden until the user clicks
**New rule** (or **Edit** on an existing rule). It appears as a collapsible
"Or generate with an LLM" block below the manual builder form, and collapses
automatically when the form is cancelled, saved, or navigated away from.
Previously the block was always visible below the rule list.

## [v3.45.0] — 2026-06-10

### Feature: Sentinel — "Appts summary" button for admin handoff

Adds an **Appts summary** button to the Sentinel footer. Clicking it opens a
small overlay showing a plain-text summary of all action-needed monitoring items
for the current patient, formatted for copy-paste directly into a Medicus
internal message so admin can arrange the bookings without the clinician
narrating each item verbally.

Format mirrors the Sweep reception handout logic:

- Drug-monitoring gaps → "Book a blood test: FBC, U&E (methotrexate monitoring overdue)"
- Physical checks (BP, weight, ECG…) → "Book a check-up: …"
- Mixed → "Book a blood test and check: …"
- QOF gaps → "Book a [condition] review"
- Vaccines → "Offer to book: [vaccine]"
- Alerts/combos/composites → "Flag to duty clinician"

Duplicate booking types are merged into a single line (e.g. two QOF diabetes
gaps → one "Book a diabetes review"). The textarea auto-focuses on open; a
"Copy to clipboard" button completes the workflow. If all monitoring is in date,
the message says so — safe to send either way.

## [v3.44.2] — 2026-06-10

### Fix: Triage Lens LLM rule authoring was hidden in the wrong tab

Triage Lens has had the suite-standard LLM flow (copy prompt → paste JSON →
validate → import disabled) since v0.5 — but the block lived collapsed at the
bottom of **Backup & restore**, after the raw-JSON editor, where nobody
authoring a rule would find it. Moved to the **Rules** tab beneath the rule
list, retitled "Generate a rule with an LLM" to match the other modules. No
logic changes — the prompt, validation and force-disabled import are untouched.

## [v3.44.1] — 2026-06-10

### Fix: Sweep reception handout — broken date, wrong "blood test" wording, redundant lines

Three issues spotted in the first printed handout:

- **`[object Object]` title / "Invalid Date"** — the sweep stored `runAt` as a
  `Date` object, but `chrome.storage.local` serialises `Date` to `{}`, so the
  handout (which reads `runAt` back from storage) had no usable timestamp. Now
  stored as an ISO string; `fmtTs` tolerates either.
- **"Book a blood test appointment: BP, Weight"** — blood pressure, weight and
  pulse are HCA checks, not blood tests, so reception was told to book the
  wrong slot. `chipInstruction` now classifies each due test and says
  "Book a check-up appointment" (checks only), "Book a blood test appointment"
  (bloods only), or "Book a blood test and check appointment" (mixed).
- **Redundant booking lines** — a patient with several QOF gaps that resolve to
  the same booking (e.g. three indicators → "Book a review appointment" ×3)
  printed one line each. `buildHandout` now groups by booking action and merges
  the reasons into a single line, so reception books once.

5 new regression checks in `test-sweep-core.js`.

## [v3.44.0] — 2026-06-10

### Feature: Sweep — printable reception handout

The Sweep results header gains a **"Print reception handout"** button: it opens
a print-first page (`handout.html`, full tab) listing every action-needed
patient in **appointment-time order** with tick-boxes and a literal,
non-clinical instruction per alert:

- Drug monitoring → "Book a blood test appointment: FBC, U&E — methotrexate
  monitoring overdue" (named tests, in-date tests excluded).
- QOF indicators → mapped to plain bookings ("Book a blood pressure check",
  "Book a diabetes review", …) with the indicator code in the detail line;
  unmapped codes fall back to "Book a review appointment".
- Vaccines → "Offer to book: Flu vaccine".
- Everything that needs clinical judgement (alerts, event counts, registers,
  combos) → "Flag to the duty clinician" — reception books and flags, never
  decides.

The page prints (or saves as PDF) via the browser print dialog, carries a
patient-identifiable confidentiality banner that also prints, and a footer
making clear it is a booking/flagging worklist, not a clinical instruction.
Duplicate instructions are deduplicated per patient; the "hidden Sentinel
alerts" note is carried through. Handover to the tab uses a transient
`sweep.handout` key (overwritten each print; allowlisted). Pure logic
(`chipInstruction`/`buildHandout` in sweep-core.js) is covered by 18 new
checks in `test-sweep-core.js`.

### Fix: flu/COVID "VAX DUE" chips showing out of season (patient-safety noise)

Eligible-but-unvaccinated patients were showing **VAX DUE all year round** —
the season config had a start (1 Sep / 1 Oct) but no end, so from April to
August every eligible patient carried a stale amber chip (as seen in Sweep,
Sentinel and Reception). A jab that cannot be given is not actionable, and a
chip that is wrong for five months trains staff to ignore it in October.

- `rules/vaccine-rules.json`: both seasons now carry a campaign end
  (`endMonth: 3, endDay: 31` — flu 1 Sep–31 Mar, COVID autumn 1 Oct–31 Mar).
- `engine/rules-engine.js`: new `seasonEnd()`; outside the campaign window no
  vaccine chips fire at all (DUE, GIVEN and DECLINED — there is nothing to do
  out of season). Rules without `endMonth` keep the old year-round behaviour.
- Fixes the chips everywhere the engine runs: Sentinel panel, Reception
  quick-wins, Sweep, content scripts.
- 8 new regression checks in `test-qof-year.js` (campaign boundaries, GIVEN
  unaffected in season, back-compat without endMonth, shipped rules carry the
  end dates).

## [v3.43.0] — 2026-06-10

### Feature: Practice Profile v2 — central practice management from the shared folder

The shared-folder Practice Profile system (drop `practice-profile.json` next to
the extension files; every PC applies it) has been finished and modernised so a
practice manager can push settings — and extension updates — to the whole
practice with one click.

**Engine (`shared/io/practice-profile.js`, rewritten):**
- Per-module apply modes: `"merge"` (fill gaps — never touches anything a user
  set; arrays merge by id, Knowledge also skips near-duplicate titles) or
  `"replace"` (enforce practice-wide). v1 profiles (`mode` +
  array `modules`) still work unchanged.
- Coverage extended from 5 to 11 modules: now includes **Knowledge**,
  **Reception**, Triage Capacity Alerts, Referrals (config only),
  Request Monitor, and practice code/feedback email. Validation delegates to
  the same `*-io.js` import functions as backups, so a crafted profile can't
  smuggle malformed data.
- Per-install attestations are never pushable in any mode:
  `disclaimerAcceptedAt`, `noticeAcknowledgedAt`, `alertLibraryAcknowledged`.
  Personal display prefs, tab order, pop-out state and locally discovered
  referral data are never pushed either.
- Per-module errors are isolated (one bad section can't block the rest) and
  recorded in the apply history.

**Propagation (service-worker.js):**
- New `pp-check` alarm: every 15 minutes (configurable 5–1440 via
  `apply.checkEveryMinutes`) each PC re-reads the profile from the shared
  folder with `cache: 'no-store'` — changes land while browsers stay open, not
  just on restart.
- **Self-updating code**: the same check compares the on-disk `manifest.json`
  version with the running version; when the admin drops new extension files
  in the shared folder, each PC reloads itself the next time it's been idle
  for 2 minutes (never mid-use; notification after repeated deferrals; new
  `idle` permission). This replaces the previous (incorrect) assumption that
  Edge reloads unpacked extensions on file changes.

**Publishing UX (Options → Backup & Restore):**
- "Generate profile" replaced by **Publish to shared folder**: per-module
  tick-list with plain-English "Fill gaps only / Enforce for everyone" choice,
  auto-bumped `profileVersion` (date + counter — no hand-editing), label and
  publisher pre-filled, and the file saved directly over
  `practice-profile.json` via the file picker — which is remembered, so
  subsequent publishes are one click. Picker state persists per publisher PC
  (`suite.practiceProfile.publisher`, allowlisted — not user config).
- Status card now shows when this PC last checked for profile updates.
- The shared-folder setup guide rewritten end-to-end for non-technical users:
  exact click-paths for Edge and Chrome, one-time shared-drive setup, 2-minute
  per-PC install, 1-minute publish walkthrough, what staff see, and a
  troubleshooting checklist. No JSON editing anywhere.

**Tests:** new `test-practice-profile.js` (65 checks: v1 back-compat, version
gating, merge/replace semantics per module, attestation stripping, error
isolation, bookkeeping). Several shared utils/io files gained
service-worker-compatible export guards (`self` instead of `window`).

## [v3.42.3] — 2026-06-10

### Knowledge: starter-pack prompt refocused on the local and the quirky

Feedback on v3.42.2: clinicians don't need cards for things they already know
(standard 2WW routes, national guidance). `kbSchemaPrompt()` now explicitly
excludes those and targets what a knowledge base is actually for:

- **Discovery is research-led, not a questionnaire**: the LLM asks only for
  practice name/town/postcode, then (where it can browse) works out the local
  landscape itself — finds the acute trusts' "information for GPs" / GP-zone
  referral repositories, identifies the community services provider and its
  single point of access, the mental health trust / Talking Therapies provider
  / crisis line, ICB referral-support pages, self-referral routes, and the
  odd-but-vital services (SDEC/hot clinics, DVT pathway, community ultrasound,
  ear care, wheelchair services). It asks the practice only what it genuinely
  cannot find.
- **Coverage**: community landscape contacts, funny local pathways and
  unusual referral routes (SPAs, not-in-e-RS services, per-trust form quirks)
  — explicitly NOT standard 2WW or routine specialty referrals. Each trust's
  GP-information repository gets its own entry so staff can find source pages
  later.

## [v3.42.2] — 2026-06-10

### Knowledge: starter-pack prompt rewritten — discovery-first, comprehensive, localised

The Options → Knowledge starter-pack prompt (`kbSchemaPrompt()`) now works in
two phases instead of generating generic content blind:

- **Phase 1 — discovery**: the LLM must first ask the practice about its ICB,
  usual acute trust(s), community providers (DN, MSK, Talking Therapies,
  mental health crisis, palliative), local self-referral routes, in-house/PCN
  services, and the things the team looks up most — and, where the LLM has web
  browsing, verify routes/numbers on the named provider sites (citing the page
  in each entry's `url`).
- **Phase 2 — generation**: an explicit coverage checklist (2WW per major
  suspected-cancer pathway, urgent and routine referral routes, A&G, full
  contacts set including safeguarding adults+children and crisis lines, every
  discovered self-referral route, Pharmacy First, admin pathways), aiming for
  40–60 entries rather than the previous 10–20 sampler.
- Localisation rule hardened: real numbers/names only when confirmed from the
  practice's answers, pasted documents, or a checked source — everything else
  stays a `[placeholder]`.

The single-card prompt (`kbSingleEntryPrompt()`) is unchanged. New regression
checks pin the two-phase structure, discovery questions, browsing instruction
and coverage checklist.

## [v3.42.1] — 2026-06-10

### Knowledge: create a single card from pasted text via LLM (on the tab)

The **+ Add** form now has a collapsible **"Create from text with an LLM…"**
block: copy a single-card prompt (`kbSingleEntryPrompt()` in
`shared/knowledge-utils.js`), paste it into any external LLM followed by your
copied text / screenshot transcript, then paste the JSON reply back — it
**pre-fills the add form** rather than importing directly, so:

- the near-duplicate title check fires before anything is saved (anti-bloat),
- the user sees and can correct every field, and
- on Save the entry keeps AI provenance (`source: llm, reviewed: false`) and
  is badged **Unreviewed — AI-generated** until marked reviewed — the same
  rule as the Options starter-pack import.

A PHI heuristic warns at fill time if the JSON contains NHS-number/DOB-shaped
content. Arrays / `{ entries: [...] }` replies are tolerated by taking the
first entry (packs belong in Options → Knowledge).

## [v3.42.0] — 2026-06-10

### Feature: Knowledge tab — practice-owned reference base

New **Knowledge** module (side panel + pop-out): a small practice-owned
reference base for referral criteria, key contacts and phone numbers, internal
pathways/protocols and templates. Reference material only — explicitly not
clinical decision support, with a first-open notice saying so.

- **On-tab add/edit/search** — a permanent **+ Add** button on the tab opens an
  inline form (title, category, plain-text content, phone, link, tags,
  review-by date); cards are searchable and filterable by category, with
  copy buttons for phone numbers and content.
- **Anti-bloat near-duplicate guard** — as you type a title, existing entries
  with similar titles are surfaced ("edit that instead") via token-normalised
  matching in `shared/knowledge-utils.js` (`findSimilar`): boilerplate words
  (referral/criteria/pathway/…) ignored, so "Cardiology chest pain referral"
  matches "Referral criteria — chest pain (cardiology)". Warns, doesn't block.
- **LLM starter pack** (Options → Knowledge) — same external copy-paste flow
  as Reception pathways: copy a self-contained prompt (optionally appending
  local documents), paste the JSON back, validate & import. Imported entries
  are forced to `source: llm, reviewed: false` and badged
  **Unreviewed — AI-generated** until a human marks each one reviewed;
  near-duplicate titles are skipped on import; a PHI heuristic (NHS-number /
  DOB patterns) warns if patient-looking data was pasted in.
- **Review-due chip** — entries carry an optional review-by date and show a
  "Review due" badge once it passes.
- Storage keys `knowledge.items` / `knowledge.categories` / `knowledge.config`
  ride the suite backup via new `shared/io/knowledge-io.js` (scope `knowledge`
  in the envelope, per-module export card, preview summary line). Imports are
  validated and whitelist-sanitised; `noticeAcknowledgedAt` is per-install and
  never imported (same rule as Reception's disclaimer).
- Tests: `test-knowledge-utils.js` (schema, dedupe matcher, PHI heuristics,
  prompt example round-trip), `test-knowledge-io.js` (backup round-trip,
  crafted-backup rejection).

## [v3.41.0] — 2026-06-10

### Feature: organise Reception capture tiles — colour, A–Z sort, drag-and-drop

As practices author more capture pathways, the picker grid grows. Reception now
has an **"Organise tiles"** mode (toggle in the capture card toolbar) so staff
can lay the tiles out the way they work:

- **Colour-code** — each tile carries an optional colour label (a palette of 9
  hues plus "none"), shown as a coloured left edge on the tile. Tap the dot in
  organise mode to set it.
- **Sort A–Z** — a Manual / A–Z toggle. A–Z sorts by title (case-insensitive);
  Manual restores the saved hand-ordered layout.
- **Drag-and-drop reorder** — in Manual order, drag tiles into any order. The
  reconcile logic mirrors `tab-order.js`: a newly-added pathway appends at the
  end and a removed one drops out — a tile is never duplicated or lost.

Design / safety notes:
- Colours and order are **organising only and explicitly not a clinical flag**
  (the UI says so); they never change which pathways are enabled and never gate
  clinical content. Launching a capture is disabled while organising so a tile
  click can't start a call flow by accident.
- New `reception.tilePrefs` storage key `{ sortMode, order, colours }`, edited
  from the panel itself and synced live between the panel and pop-out. It rides
  the existing suite backup via `shared/io/reception-io.js`
  (`receptionExport`/`receptionImport`), validated/sanitised through
  `sanitiseTilePrefs` (unknown sort modes, non-id-shaped keys → dropped;
  prototype-pollution-safe).
- Pure logic (`orderTiles`, `tileColourFor`, `sanitiseTilePrefs`,
  `TILE_COLOUR_KEYS`) lives in `shared/reception-pathway-utils.js` with new
  regression tests in `test-reception-pathway-utils.js`.

## [v3.40.3] — 2026-06-10

### Fix: Sweep clinician dropdown empty before first run; clinician column never shown

Two bugs in the v3.40.2 clinician filter:

1. The dropdown was only populated inside `runSweep()`, so it showed only
   "All clinicians" until a full sweep was completed — the user couldn't
   pre-select a clinician before running. Fixed: `preloadClinicians()` now
   fires non-blocking in `init()`, fetching the appointment book in the
   background and populating the dropdown immediately on module load.

2. `patient.clinician` was pushed to the per-patient result objects but
   `summariseSweep` (sweep-core.js) never forwarded it to the output SweepRow,
   so `patientRowHtml` always received `row.clinician = undefined` and the
   clinician column was invisible. Fixed: `clinician` is now propagated through
   both error rows and normal rows in `summariseSweep`.

### Feature: Sequential sweep past 40-patient cap

Previously, large practices (>40 booked patients) had the first 40 silently
checked with a warning notice about the cap. Now:

- `extractBookedPatients` accepts `{ limit: null }` to return all patients
  without capping. Callers that do not pass `limit` retain the existing
  `MAX_SWEEP_PATIENTS` (40) default — no behaviour change for other consumers.
- `sweep.js` fetches the full patient list upfront and processes it in batches
  of `BATCH_SIZE` (40). After each batch, results show "Checked X of Y booked
  patients — N remaining" and a **"Check next N patients"** button.
- Clicking Continue processes the next batch from cached state (no re-fetch of
  the appointment book). Cumulative results (all batches combined, sorted
  worst-first) are shown after each batch.
- The Run sweep button always starts a fresh sweep (new fetch, reset offset).
  Cancel mid-batch shows how many patients were not checked and prompts restart.

## [v3.40.2] — 2026-06-10

### Fix: Sweep found zero patients — wrong appointment feed (per-clinician, not practice)

Sweep fetched `/scheduling/data/homepage/my-appointments`, which only covers
the logged-in user's OWN booked diary — anyone without a personally-booked
clinic that day got an empty schedule, and the empty case fell through
silently to "No action-needed alerts found across 0 patients". This is the
same root cause as the Condor waiting-room fix in v3.36.2 ("my-appointments
is per-clinician only").

- Sweep now reads the practice-wide appointment book
  (`/scheduling/data/appointment-book/embedded-overview` via the shared
  `fetchSchedulingOverview`, fresh fetch per run), parsing
  `staffSchedules[].schedule[].entries[]`. Cancelled appointments excluded.
- New clinician filter: "All clinicians" by default, or sweep a single
  clinician's list (dropdown populates from the appointment book; patient
  rows now show the clinician).
- Fail-visible zero states (H-005): an empty appointment book, an empty
  clinician filter, or an unreadable feed each render an explicit message —
  a bare "0 patients, nothing to action" can no longer appear.
- Limitation 26 updated; test-sweep-core.js migrated to the appointment-book
  shape with regression guards for the silent-zero path, cancelled exclusion,
  and the clinician filter.

Diagnosed by three parallel investigation agents; root cause corroborated by
the v3.36.2 changelog entry.

## [v3.40.1] — 2026-06-10

### Fix: Condor "Task inbox not configured" shown for a configured Request Monitor

Condor's data layer fetched a non-existent endpoint
(`/admin/data/request-monitor/{assigneeId}` — invented during the Condor
build), so the request always 404'd and the Task Age card claimed the inbox
was "not configured" even when Request Monitor was fully set up. Condor now
reads the cached poll state the service worker already maintains
(`suite.requestMonitor.state` — the SW alarm stays the single owner of task
polling, and the cached items are already initials-only per F2 data
minimisation). The card also now distinguishes the three states: not
configured ("enable in Settings"), configured-but-unavailable ("Task inbox
unavailable: <reason> — check Medicus sign-in"), and data. Day Score treats
"unavailable" like "unknown" (never penalised), and the PPI urgent count
already degrades to 0 with the error recorded in fetchErrors. New regression
test `test-condor-rm-state.js`.

## [v3.40.0] — 2026-06-10

### Feature: drag-and-drop reorderable suite tabs

Suite nav tabs can be dragged left/right to reorder, like browser tabs, so
favourites sit on the left. Order persists in a new `suite.tabOrder` key (one
global preference shared by the side panel and pop-out; each shell reconciles
against its own tab set, so the pop-out simply ignores tabs it doesn't have)
and rides the existing suite backup/export. New modules added later append in
their default position; unknown/removed ids are ignored — never dropped or
duplicated (`side-panel/tab-order.js` `reconcileTabOrder`, unit-tested in
`test-tab-order.js`). A drag never triggers a tab switch. Keyboard-driven
reordering is not yet implemented (tabs remain keyboard-activatable for
switching); mouse/pointer drag only.

### Feature: author rules with an LLM (Reception, Sentinel, Triage Lens)

Each of the three rule-authoring surfaces gains a "Copy LLM prompt" button and
a paste-JSON import box, so a user can ask an external LLM ("make me a
cellulitis pathway") and import the result directly:

- **Reception** — `pathwaySchemaPrompt()` in `shared/reception-pathway-utils.js`;
  import validates via the existing `validatePathway`/`sanitisePathway` and adds
  the pathway **disabled** (never auto-enabled — the off-by-default + disclaimer
  gate still applies).
- **Sentinel monitoring** — `customRuleSchemaPrompt()` in `shared/io/sentinel-io.js`
  (covers all five custom-rule types); import validates via the existing
  `validateCustomRule`, forces `enabled:false`, prefixes `custom-`, de-dupes ids.
- **Triage Lens** — `triageRuleSchemaPrompt()` plus a refactor of the inline rule
  checks into a reusable `validateTriageRule()` (now used by both the rule
  builder and the importer); imported rules get a fresh id, `builtin:false`,
  `enabled:false`.

Each schema prompt embeds a worked example between stable markers, and a unit
test extracts that example and runs it through the real validator — so a
documented schema can never drift from what the validator accepts. All imports
accept a single object, an array, or a `{rules:[…]}`/`{pathways:[…]}` wrapper;
validate every candidate and import nothing from a failing one; and escape all
status text (LLM output is untrusted). Imported clinical content always arrives
inactive, pending human review.

All 30 test files pass.

## [v3.39.1] — 2026-06-10

### Reception: security hardening + clinical escalation re-tiering (post-audit)

Follows the red-team audit of the Reception module. Two code findings fixed,
plus a clinical re-tiering pass on the DRAFT capture pathways.

**Security (verified findings):**
- **Disclaimer gate is now defence-in-depth, not UI-only.**
  `resolveEffectivePathways()` gates its `enabled` set on `disclaimerAccepted`
  (strict `true`); absent/falsy ⇒ empty enabled set (fail-safe). The panel and
  all three options call sites pass it, so a direct storage write or imported
  backup can no longer surface capture pathways the practice never accepted.
- **Acceptance timestamp is no longer importable.** `receptionImport()`
  validates `disclaimerAcceptedAt`'s shape but never writes it — acceptance is
  a per-install attestation set only by an in-browser admin click, so a backup
  cannot forge a review-accepted state on another install.
- **Flag-map key whitelist (prototype-pollution defence-in-depth).** Import now
  rejects `enabledPathways`/`hiddenChipRules` keys that don't match the pathway/
  rule id shape (e.g. `__proto__`).
- **Clipboard escalation fallback never hides the level** — if an escalation
  text lookup misses, the generated block now states `ACTION (level 999/duty)`.
- **Asked/denied summary line disambiguates colliding short labels** with a
  `(#n)` suffix (the loud positive block was already unambiguous).

The two headline audit claims — a "critical" panel XSS and a backup
preview-warning "evasion" — were verified as false positives (output is escaped;
overrides don't enable pathways) and not actioned.

**Clinical (DRAFT pathways — `rules/reception-pathways.json`, still pre-CSO):**
Escalation re-tiering — several time-critical presentations were promoted from
duty to 999 (erring toward more escalation, the safe direction):
- **urinary** — new urosepsis 999 flag (fever/chills + confusion / can't keep
  fluids, NICE NG51); confusion promoted to 999.
- **backpain** — cauda equina (saddle anaesthesia, bladder/bowel) → 999 ("A&E
  now"); spinal-infection wording (IVDU/immunosuppression) added.
- **cough** — haemoptysis split (large/with breathlessness → 999, minor streak
  → duty); new PE 999 flag.
- **general** — new lay sepsis 999 flag; self-harm split (attempt/means → 999,
  ideation → duty).
- **earache** — facial droop flag added. **rash** — necrotising-fasciitis → 999;
  SJS/TEN mucosal wording. **headache** — anticoagulant + head injury → 999.
  **feverish-child** — NICE NG143 <3-month high-risk caveat note added.

`specVersion` → v1.1; DRAFT marker retained. Backup/restore wiring re-verified
end to end. All 29 test files pass (451 reception assertions).

## [v3.39.0] — 2026-06-10

### Reception module: full configurability, disclaimer-gated pathways, RAG status pill

Follow-up hardening and configurability pass on the v3.38.0 Reception module:

- **All capture pathways now ship DISABLED.** A practice administrator must
  click through an explicit disclaimer in Options → Reception (confirming
  CSO/GP review of the content and staff briefing) before anything can be
  enabled; pathways can then be toggled individually or all at once. The
  Reception tab tells staff to ask an administrator when everything is off.
- **Pathway editor in Options.** Practices can edit the questions and red
  flags of bundled pathways (stored as overrides — one click restores the
  bundled original) and author new custom pathways. Validation is enforced by
  shared code (`shared/reception-pathway-utils.js`): a pathway cannot be saved
  without red flags, every red flag needs a 999/duty escalation level, and
  invalid edits are flagged with the bundled original kept active — never
  silently dropped. Saving never auto-enables.
- **Quick-wins box replaced with a single green/amber/red status pill** that
  expands on click to the detailed list. Practices choose which
  monitoring/QOF/vaccine rules are counted there (Options → Reception); when
  active alerts are filtered out the expanded view says so — filtering is
  never silent. Custom chips are managed in Sentinel as before.
- **Removed the "Recent appointments" card** (and its day-by-day appointment
  book scan) introduced in v3.38.0.
- **New storage keys with full backup ceremony:** `reception.config`,
  `reception.customPathways`, `reception.pathwayOverrides` via
  `shared/io/reception-io.js`; scope registered in suite-envelope; import is
  validated + whitelist-sanitised through the same shared validator as the
  editor, and the import preview WARNS when a backup would enable pathways
  (same concern class as the hidden-chips warning). Limitation 27 updated.
- New tests: `test-reception-pathway-utils.js` (41), `test-reception-io.js`
  (19); reception core/pathway tests updated. Backup key coverage holds.

## [v3.38.0] — 2026-06-10

### Feature: Reception module — guided capture + recent appointments + opportunity summary

New "Reception" side-panel tab (panel + pop-out) designed for non-clinical
front-desk staff:

- **Guided capture.** Fixed question sets per presenting problem
  (`rules/reception-pathways.json`: sore throat, earache, adult cough, urinary
  symptoms in women 16–64, adult headache, low back pain, feverish child,
  rash/skin, plus a general catch-all — NICE CKS / NG143-derived, lay-phrased).
  Red-flag questions come first and every one must be explicitly answered
  (unanswered ≠ "no"); any YES shows an immediate 999-level or duty-clinician
  escalation banner and stamps the flag + instruction into the output. The
  result is a same-every-time plain-text history block with a copy-to-clipboard
  button for pasting into the Medicus triage entry, ending with a "not a
  clinical assessment — clinician to review" footer. When a patient record is
  open, the patient's name/DOB is embedded in the header so a wrong-record
  paste is detectable. Unanswered questions render as "not recorded", never
  blank. Pharmacy First suitability hints are age-gated against the open
  record and fail towards "clinician to confirm" when age is unknown.
  **The pathway set ships marked DRAFT and requires CSO sign-off before live
  use** (limitation 27 added to docs/CLINICAL-SAFETY-NOTICE.md); structure is
  CI-guarded by `test-reception-pathways.js` (433 assertions).
- **Recent appointments.** "Who did you last see" support: manual-trigger scan
  of the practice appointment book backwards (up to 6 weeks, 7-day batches,
  early-stop at 3 hits), matched strictly by patient UUID — never by name
  (wrong-patient hazard H-001). Days that fail to load are explicitly counted
  as unread; the card states it shows booked practice appointments only.
- **Opportunity summary.** Compact red/amber counts of the open patient's
  Sentinel chips ("while they're on the phone: 1 overdue, 2 due soon") with a
  jump to the Monitoring tab, so reception can offer to book overdue checks.
- Nothing is stored: answers, output text, and taker initials are in-memory
  only — no new chrome.storage keys, so no backup/IO changes.
- The Rules status card in Options now also tracks the reception pathway
  file's age/version. New `test-reception-core.js` covers the text builder,
  red-flag evaluation, UUID-only appointment matching, and chip summarising.

## [v3.37.0] — 2026-06-10

Five user-aiding features from the high-impact development review.

### Feature: Pre-clinic Monitoring Sweep — new "Sweep" side-panel tab

Runs the Sentinel rules engine across the logged-in user's booked patients for
today (same `/scheduling/data/homepage/my-appointments` feed as the waiting-room
strip; same `fetchAll → normaliseAll → evaluatePatient` path as the live Sentinel
module) and renders a worst-first worklist of patients with action-needed
monitoring/QOF/vaccine chips, so recalls and bloods can be arranged before
clinic. Manual trigger only; sequential per-patient fetches with a 250 ms gap
and a 40-patient cap; results are ephemeral (no new storage keys). Fail-visible
by design: any per-patient endpoint failure renders an explicit "could not read
record" row — a patient with partial data can never appear as "clear".
`sentinel.hiddenRules` suppressions are intentionally NOT applied (a
per-workstation dismissal must not drop a patient from a recall list); rows
including hidden alerts are flagged. New limitation 26 added to
docs/CLINICAL-SAFETY-NOTICE.md. New module registered in both panel and pop-out;
pure logic in `sweep-core.js` covered by `test-sweep-core.js`.
**Note for CSO review:** the sweep is a new clinical surface and should receive
hazard-log review before deployment; HAZARD-LOG.md deliberately not edited here.

### Safety: dismissed Sentinel chips resurface on status escalation (H-021 / limitation 22)

Permanent chip dismissals now record `statusAtDismissal` and `dismissedAt` in
`sentinel.hiddenRules`. A permanently hidden chip automatically resurfaces (with
a visible RESURFACED badge) when its current status becomes more severe than it
was at dismissal (colour rank: red > amber > neutral > green; unknown statuses
rank red — fail-safe). Legacy entries without a recorded status keep the old
always-hidden behaviour to avoid flooding existing users; they are labelled in
the review screen. The hidden-alerts list in Sentinel options now shows
dismissal date, age and status-at-dismissal. Backup import validation accepts
(and validates) the new optional fields. New `test-hidden-resurfacing.js`;
import-hardening tests extended.

### Safety: "Meds without a monitoring rule" audit view

New `listUnmatchedMedications()` in the rules engine surfaces medications not
matched by any enabled drug-monitoring rule — making the documented
silent-failure mode (an unlisted brand never alerts) visible instead of silent.
Rendered as a collapsed informational section in both the in-page Sentinel HUD
and the side-panel tab, with a "report a possible missing brand" mailto link
when a feedback address is configured. New `test-unmatched-meds.js`.

### Feature: rule-currency status (options card + Sentinel footer)

New `shared/rule-currency.js` assesses the four bundled rule files:
amber when a file is >365 days old, when the QOF year has rolled over
(file year vs 1 April boundary), or when the vaccine season file predates the
current season (1 September boundary). Rendered as a "Rules status" card in
Options and a one-line footer in the Sentinel tab. `vaccine-rules.json` and
`alert-library.json` gain top-level `lastUpdated`/`specVersion` metadata
(rule content untouched); `test-rule-schema.js` now asserts metadata on all
four files. New `test-rule-currency.js` includes a live check against the
bundled files, so CI starts failing when the shipped rules genuinely go stale.

### Feature: one-click "Verify in Medicus" (H-007 automation-bias mitigation)

The Sentinel side-panel patient banner and every chip's evidence panel gain a
"Verify in Medicus ↗" button that focuses the source Medicus tab (never
navigates it), making verify-before-acting a one-click action. Shows a brief
"Medicus tab not found" note if the tab has closed.

## [v3.36.4] — 2026-06-09

### Fix: seasonStart() UTC safety (engine/rules-engine.js)

Rewritten to compare date-part strings instead of constructing `new Date(year,
month-1, day)` in local time — under BST (or any non-UTC host timezone) the
vaccine season start could drift a day early. Season-start dates are now exactly
the configured month/day regardless of timezone. Regression tests added to
`test-qof-year.js`.

### Fix: BP pairing ±1-day tolerance (engine/normalisers.js)

Split systolic/diastolic readings recorded a day apart (common when a practice
workflow records results on different days) now synthesise a "Blood pressure"
observation, taking the systolic reading's date. Same-date pairs are still
preferred (pass 1); ±1-day fallback only used for unpaired systolic readings;
each diastolic may pair at most once. Regression tests added to
`test-extraction-health.js`.

### Fix: Dash folding in normaliseDrugString (engine/rules-engine.js)

Dashes and underscores in drug names and match/exclude terms are now normalised
to spaces before whitespace collapse, so "Neo-Mercazole" matches the exclude
term "neo mercazole" and vice versa. No MUST_NOT collision detected. Two new
test cases added to `test-drug-brand-coverage.js`.

### Test: test-rule-schema.js — rule-file structural integrity guard

New test validates all four bundled rule files: check.kind against the
implemented set, vaccine statusTerms.given and season.startMonth, event-count
windowMonths positivity, observation-bundle non-empty observations, and no
duplicate IDs across files. All 47 assertions pass against current rules.

### Safety: custom-rule validation extended (shared/io/sentinel-io.js)

`observation-bundle` added to `ALLOWED_CHECK_KINDS` for custom QOF indicator
rules; validation rejects an empty `check.observations` array (vacuously
"achieved"). Unknown check.kind and empty-bundle cases covered by new tests in
`test-custom-rules.js`.

### Security: update-checker downloadUrl host validation (shared/update-checker.js)

`allowGithubUrl()` helper added; both `downloadUrl` and `releaseUrl` from GitHub
releases are now rejected unless the URL parses as https with hostname
`github.com`, `api.github.com`, or `*.githubusercontent.com`. New tests in
`test-update-checker.js`.

### Chore: submissions-io practiceCode single ownership

`suite.practiceCode` is now exported only by `shared/io/suite-io.js`.
`submissions-io.js` no longer exports it; legacy standalone submissions backups
that carry `practiceCode` are still imported (with a one-line comment). Tests
updated in `test-suite-io.js`. Backup coverage still passes.

### Chore: vaccine-rules.json — remove dead DM1 register token

No `DM1` QOF register exists; diabetics are covered by `DM`. The dead token was
removed from the flu-vaccine eligibility registers array.

### Chore: qof-rules.json — stale DM037 cross-reference note

The smoking-status indicator's notes claimed DM037 was "currently disabled
pending observation-bundle engine support"; DM037 is enabled and the engine
supports observation-bundle. Note updated.

### Chore: cross-reference comments for site-code regex

One-line `// keep in sync with ...` comments added at the `PRACTICE_CODE_RE`
definition in `shared/request-monitor.js` and `_SITE_CODE_RE` in
`shared/medicus-api.js` to make the two independent definitions visible to
future editors.

## [v3.36.3] — 2026-06-09

### Safety: null-date fail-safe in Sentinel rules engine

`daysBetween()` returns `null` for unparseable dates. Downstream comparisons
(`null > x`) are always false, so a malformed observation date would silently
fall through to the safest-looking status (`in_date` / no chip) — masking a
missing-monitoring situation as "all good". Guards added:

- Drug-monitoring test evaluation: garbage `obs.date` now returns `status:
  'no_data'` (same as a missing observation), never `in_date`.
- `observation-alert` QOF indicator: unparseable date now returns `[]` (consistent
  with the existing stale-gate and the "do not alert on bad data" design).

Regression tests added to `test-monitoring-chip.js` and `test-alert-builder.js`.

### Test: inverse brand-coverage check in test-drug-brand-coverage.js

The existing test only iterated the `EXPECTED` map forward, so a new
drug-monitoring rule with no `EXPECTED` entry would pass silently. Added an
inverse check: every enabled `drug-monitoring` rule in `drug-rules.json` must
have at least one entry in `EXPECTED`. All 24 current rules are covered.

### Safety: transactional backup restore with rollback

`applyEnvelope()` previously used `Promise.all`, so a failure in one module
import left partially-written storage. Rewritten to use `applyWithRollback()`
(added to `shared/io/suite-envelope.js`): tasks run sequentially; on any throw,
keys written during the run are removed and the pre-import snapshot is restored.
The error message includes the original cause and states "no changes were applied"
(surfaced verbatim by the options-page status banner).

Rollback scenario regression test added to `test-suite-io.js`.

### Test: test-backup-coverage.js — storage key-coverage guard

New static analysis test: scans app source for `chrome.storage.local` string
literals and verifies every key is captured by a `shared/io/*-io.js` file or an
explicit allowlist. Guards against keys silently disappearing from backups when a
module is added or a key renamed. Prints audited key counts on each run.

### Fix: Condor request-monitor stream was silently dead

`condor-data.js` read `suite.requestMonitor.config` as a single object key, but
request-monitor settings are stored as individual keys
(`suite.requestMonitor.enabled` / `.assigneeId` / …), so the config was always
`undefined` and the Condor dashboard never fetched the request-monitor stream.
Found by the new backup key-coverage audit. Now reads the real keys.

### Chore: remove orphaned acrtrend / bptrend modules

`side-panel/modules/acrtrend` and `side-panel/modules/bptrend` were not
registered in any `MODULES` map or nav tab in `panel.js` or `pop-out.js`.
Dead code removed (`git rm -r`).

## [v3.36.2] — 2026-06-09

### Condor: practice-wide waiting room via appointment-book endpoint

Condor's waiting room now sources its data from the `appointment-book/embedded-overview`
endpoint (already fetched for slot counts) rather than `my-appointments`.
`my-appointments` is per-clinician only, so arrived counts were always 0 for
users with no personally-booked clinic.

`fetchSlots` and `fetchWaitingRoom` are merged into a single `fetchSlotsAndWaitingRoom`
function — one fetch, two data extractions, no extra API call. The waiting room
card now shows the responsible clinician's surname alongside each patient row.

## [v3.36.1] — 2026-06-09

### Fix: waiting-room arrived detection was always returning zero

`displayStatus.isArrived` does not exist on the Medicus API response. The actual
field is `displayStatus.value`, which equals `"arrived"` when a patient has
checked in. The old check (`displayStatus?.isArrived === true`) was silently
false for every entry, so arrived counts were always 0 across Condor, the panel
WR strip, and the Sentinel waiting-room block.

Additionally, the entry list was not filtered by `diaryEntryType`, so slot entries
(which carry no patient or displayStatus) were included in the appointment set,
making the pending count wrong.

Fixed in `condor-data.js`, `panel.js`, and `sentinel.js`:
- Filter entries to `diaryEntryType.value === 'appointment'` before mapping
- Check `displayStatus.value === 'arrived'` instead of `displayStatus.isArrived`
- Also corrected `deliveryMode` extraction in condor to unwrap `.value` consistently

Note: `my-appointments` is per-clinician. Condor's waiting room card shows the
logged-in user's patients only — a practice-wide view requires a different
endpoint (under investigation).

## [v3.36.0] — 2026-06-09

### Condor UX: clearer Demand/Capacity card, live WR appointments, refresh timestamp

**Demand / Capacity card** — replaced the confusing `26.2×` ratio (requests ÷
remaining slots) with a plain-English status: "Over capacity", "At capacity",
"Capacity sufficient", or "No slots left". The request and slot counts are shown
in a sub-line; the Medical/Admin/AM/PM breakdown is preserved below a divider.

**Waiting Room card** — when no patients have arrived yet the card was a dead
`0 arrived` number with no context. It now falls through to a "Booked today"
list showing the next booked appointments (name, mode, scheduled time) so the
card is useful at the start of a session before anyone has checked in.

**Practice Pressure freshness** — added a `Live · updated HH:MM:SS` timestamp
below the PPI gauge so it is obvious the data is actively refreshing even when
the PPI score itself is stable.

## [v3.35.3] — 2026-06-09

### Fix: Condor slots-remaining ignored the Slots tab's hidden types

Condor's Demand/Capacity card counted *every* future slot type, so triage and
holding slots inflated "slots remaining" (e.g. 123) well above the bookable
count the user actually tracks in the Slots tab (e.g. 36).

`fetchSlots` now reads `slots.hiddenTypes` (the same key the Slots tab writes
when you untick a type) and excludes those appointment types from the AM/PM
remaining counts, so the figure — and the Demand/Capacity ratio derived from
it — matches the ticked slots in the Slots counter.

## [v3.35.2] — 2026-06-09

### Fix: Condor demand/velocity/PPI showed the entire task backlog

`fetchSubmissions` in `condor-data.js` queried the task-list endpoint with
`startDate`/`endDate`, but that endpoint filters on `createdAt_startDate`/
`createdAt_endDate`. The wrong parameter names were silently ignored, so the
API returned the **entire open-task backlog** instead of today's submissions.
This single bug inflated three places at once:

- **Demand / Capacity** — "open requests" showed tens of thousands (e.g. 42495)
  and an absurd ratio (354.1×).
- **Submission Velocity** — "Total today" showed the whole backlog (e.g. 83019),
  with the histogram smeared across every hour of the day regardless of date.
- **Practice Pressure Index** — the queue component saturated, so the PPI value
  was driven almost entirely by the bogus backlog count.

Fixes:
- Use `createdAt_startDate` / `createdAt_endDate` (matching the working
  Submissions module) so only today's submissions are counted.
- `todayISO()` now uses the **local** calendar date instead of UTC
  (`toISOString()` would query the wrong day in the early/late hours).
- Relabelled the Demand/Capacity figure from "open requests" to "requests today"
  to reflect what it actually measures.

### Removed: Condor referral-rate card

Removed the per-clinician referral-rate card and its data plumbing from the
Condor dashboard (low signal). The standalone Referrals tab is unchanged.

## [v3.35.1] — 2026-06-09

### Fix: restore unified Trends tab

The v3.35.0 Condor merge was branched from a base predating the v3.34.0
trends unification, so merging it reverted the side-panel/pop-out nav back to
the pre-unification layout — the amalgamated **Trends** tab disappeared and the
old separate **BP Trend** and **ACR Trend** tabs reappeared, dropping the
HbA1c, Cholesterol and Weight toggle views in the process.

- Re-registered the unified `trends` module and removed the orphaned
  `bptrend` / `acrtrend` nav entries in `side-panel/panel.html`,
  `side-panel/panel.js`, `pop-out/pop-out.html` and `pop-out/pop-out.js`.
- The `trends` module itself was untouched by the regression — all five views
  (BP, Renal, HbA1c, Cholesterol, Weight) are restored by re-wiring the nav.

## [v3.35.0] — 2026-06-08

### Condor: core shell, data layer, CSS, nav registration

Introduces the Condor tab — a new practice operational intelligence module.

- `side-panel/modules/condor/condor-data.js` — parallel data fetch layer (slots, waiting room, submissions, request monitor, activity, capacity preset)
- `side-panel/modules/condor/condor.js` — orchestrator: init/cleanup pattern, 15-second poll, dynamic card loading via Promise.allSettled imports
- `side-panel/modules/condor/condor.css` — full layout and component styles (card, pill, bar, SVG helpers)
- `side-panel/panel.html` / `pop-out/pop-out.html` — Condor nav tab added
- `side-panel/panel.js` / `pop-out/pop-out.js` — MODULES registry entries added


## [v3.34.0] — 2026-06-08

### Merge Renal and BP Trend tabs into unified Trends tab

The three separate navigation tabs (Renal, BP Trend, Trends) have been consolidated into a single **Trends** tab with an in-module picker: **BP | Renal | HbA1c | Cholesterol | Weight**.

- `side-panel/modules/trends/trends.js` — merged BP and Renal logic in; picker now offers all five views. BP and Renal logic is identical to the removed modules — no behavioural change. `selectedView` state is in-memory only (no storage key).
- `side-panel/modules/trends/trends.css` — merged in all CSS from `bptrend.css` and `acrtrend.css`, including the shared `tc-*` chart primitives.
- `side-panel/panel.html` / `pop-out/pop-out.html` — removed `acrtrend` and `bptrend` nav tab buttons.
- `side-panel/panel.js` / `pop-out/pop-out.js` — removed `acrtrend` and `bptrend` from MODULES registry.
- `side-panel/modules/bptrend/` and `side-panel/modules/acrtrend/` — source files retained on disk but no longer registered or loaded.

## [v3.33.0] — 2026-06-07

### Per-module extraction breakdown + SOUP register

Two transparency/robustness improvements; no change to clinical rule logic, data flow, permissions, or network behaviour.

**Per-module extraction health (H-005 detection improvement).** The Sentinel side panel now shows what the extension actually read from the current record — `Extracted: N meds · N obs · N problems` — with any zero count amber-flagged for verification.

- `content-scripts/sentinel.js` — `assessExtractionHealth()` now returns a `modules: { medications, observations, problems, demographics }` breakdown alongside the existing `degraded`/`reason` signal. The hard `degraded` semantics are unchanged byte-for-byte (the across-the-board blank that means our scrapers stopped matching the page); the breakdown is published on the snapshot via `publishSnapshot()`.
- `side-panel/modules/sentinel/sentinel.js` — renders the breakdown in the `data` state only (the `degraded`/`unavailable` warning paths and `classifySnapshot` are untouched). This is **informational only**: a per-module zero is amber-tinted to prompt a manual check but is *never* treated as an alarm, since a record can legitimately have no observations or no problems. It narrows the gap between the whole-record `degraded` banner and a *partial* scraper failure (e.g. meds populated but observations silently empty after a Medicus change) without adding false-reassurance or alert-fatigue risk.
- Tests: `test-extraction-health.js` gains six checks for the `modules` shape/counts and the "per-module zero never alarms" contract; `test-sentinel-panel-state.js` gains two checks confirming the new field does not perturb snapshot classification. Full `node test-*.js` suite green.
- `docs/HAZARD-LOG.md` — H-005 updated with control (j); document synchronised to v3.33.0 (doc v3.4).

**SOUP register (`docs/SOUP.md`).** New IEC 62304-style Software of Unknown Provenance register for the vendored visualiser libraries (PDF.js 3.11.174 + worker, Chart.js 4.4.1, D3.js 7.8.5). Records each item's function in the product, known anomalies (incl. CVE-2024-4367 and its `isEvalSupported:false` mitigation, and the deferred NF6 PDF.js upgrade), and risk disposition. References `vendor-versions.json` as the checksum-of-record so the two cannot drift, and is cross-linked from `docs/HAZARD-LOG.md`.

## [v3.32.1] — 2026-06-07

### Fix six bugs found in weekly bug bash

**`engine/rules-engine.js`** — two fixes:
- Vaccine history filter: changed `!pt.date || pt.date >= seasonStartIso` to `pt.date && pt.date >= seasonStartIso` in both the `given` and `declined` branches of `matchVaccineHistory`. Undated history entries (data-quality gaps) were previously treated as in-season, potentially suppressing a current-season vaccine alert for patients whose old undated record was found first.
- Vaccine sex-eligibility check: added a `sex &&` guard before `clause.sex !== sex[0]` so patients with an empty-string sex field are no longer silently excluded from female-specific eligibility clauses (e.g. cervical-cancer-screening, HPV).

**`content-scripts/referrals-discovery.js`** — changed `if (dataCaptured)` to `if (dataCaptured && configCaptured)` in `scanEntries`. If a data URL resolved before the config URL appeared in a later PerformanceObserver callback, the config was permanently skipped, silently breaking referrals discovery on cache-ordered page loads.

**`visualiser-core.js`** — analyte trend reference band now uses the most-recent data point's `low`/`high` values (`pts[pts.length-1]`) instead of the oldest (`pts[0]`), so age-adjusted or lab-updated reference intervals are reflected correctly.

**`sentinel-options/options.js`** — two fixes:
- `addAllLibraryEntries`: tracks the count of rules dropped by `validateCustomRule` and appends `, N skipped (invalid)` to the completion toast so the user knows if any library entries were rejected.
- `dcOpenForm`: converted the `chrome.storage.local.get` callback to `async/await` so form fields are fully populated before control returns to the user, eliminating a narrow race where typing could begin before stored rule values were loaded.

## [v3.32.0] — 2026-06-07

### Security hardening — second pass (NF1–NF5 from the 2026-06-07 red-team audit)

Full write-up in `SECURITY-AUDIT.md`. No evidence of active exploitation; these
changes close latent weaknesses found in the second scheduled audit pass. The most
important fix closes a patient-safety gap where a crafted backup file could silently
suppress all drug-monitoring chips without any preview warning.

- **NF1 + NF3 (High / Medium) — `sentinel.hiddenRules` backup import hardened.**
  The per-chip hide/snooze feature (v3.26.3) stores suppressions in
  `sentinel.hiddenRules`. The import path previously accepted any object for this
  key without validating entry structure, and `previewEnvelope()` had no logic to
  warn about suppressed chips — so a crafted backup could silently hide all
  drug-monitoring alerts with no visible indication before or after import.
  Two fixes:
  1. `shared/io/sentinel-io.js` — `sentinelImport()` now validates each entry is
     `{ until: null | "YYYY-MM-DD" }` and rejects malformed values.
  2. `shared/io/suite-envelope.js` — `previewEnvelope()` now emits a `WARNING`
     line listing the count and a sample of hidden rule IDs when a backup contains
     suppressed alerts, mirroring the existing `enabled:false` rule warning.

- **NF2 (Medium) — OB register disabled pending engine support.**
  The QOF Obesity register (`qof-reg-ob`, v3.29.0) was enabled by default but
  documented in its own rule comment as a BMI-problem-label approximation that
  "will miss obese patients who have a recorded BMI but no obesity problem label".
  An enabled-by-default register that silently under-counts is a false-confidence
  baseline. Set `enabled: false` until the engine supports observation-based
  register membership (BMI observation lookup). The two dependent indicators
  (OB004, OB005) remain disabled pending CSO confirmation regardless.

- **NF4 (Low) — `popout:closed` message handler gains `sender.id` guard.**
  `side-panel/panel.js` — the one `chrome.runtime.onMessage` listener without a
  `sender.id !== chrome.runtime.id` check now has it, consistent with the two
  other listeners in the same file and the service-worker/sentinel handlers.

- **NF5 (Low) — `activeTab` permission removed.**
  `manifest.json` — `activeTab` was declared but never exercised: all tab queries
  use `chrome.tabs.query()`, which requires only the `tabs` permission (already
  present). Removing `activeTab` reduces the declared permission surface.

- **NF6 (tracked follow-up) — PDF.js 3.11.174 upgrade deferred.**
  CVE-2024-4367 (arbitrary JS via PDF FontMatrix) affects PDF.js < 4.2.67;
  the exploit is mitigated by the existing `isEvalSupported: false` setting
  (`visualiser-core.js:640`). Upgrading the vendored binary is tracked as a
  follow-up (requires downloading and verifying the new build).

## [v3.31.2] — 2026-06-06

### Add proprietary copyright header to source files

Prepended a one-line `© 2026 Graysbrook Ltd. Proprietary — all rights reserved.
See LICENSE.` notice to the shipping first-party source (67 JS/CSS files across
side-panel, pop-out, shared, engine, content-scripts, options, sentinel-options,
sidebar, plus `service-worker.js` and `visualiser-core.js`). Vendored third-party
files, JSON/rule files, test harnesses, and build scripts were deliberately left
untouched. Comment-only change — no functional effect; full test suite green.

## [v3.31.1] — 2026-06-06

### Add explicit proprietary LICENCE

Added a root `LICENSE` file: strict proprietary, all-rights-reserved. No grant of
any right to use, copy, modify, redistribute, fork, or make commercial use of the
code; explicit clauses that public GitHub visibility is not a waiver or a release
to the public domain, that no commercial entity (including any EPR provider) may
use it, and that the code may not be used to train machine-learning models.
Third-party components (e.g. PDF.js, Apache-2.0, per `vendor-versions.json`)
retain their own upstream licences. The README licence section now points to it.
Previously the repository had only informal licence statements in the README and
disclaimer and no top-level LICENSE file.

## [v3.31.0] — 2026-06-06

### New module: Observation Trends (HbA1c / cholesterol / weight)

Adds a single **Trends** tab (side panel + pop-out) with a metric picker for
HbA1c, total cholesterol and weight. Reuses the shared `lineChart` and the
existing `getTrendData` bridge — the same `observationHistory` already powering
the BP and Renal trend tabs — so no new data path or storage key is introduced.

Strictly **display only**, consistent with the suite's passive intended purpose:
it plots recorded values with the latest reading, a neutral (non-RAG) change
arrow, and the reading count/date range. It renders **no clinical thresholds,
target zones, or interpretation text**. Metric selection is in-memory (no
storage key → no backup/IO changes). Each metric isolates its observation row by
name substring with look-alike exclusions (e.g. cholesterol excludes HDL/LDL/
ratio/non-HDL).

## [v3.30.0] — 2026-06-06

### Reliability: global "Medicus UI changed?" canary banner

The Sentinel extraction-health signal (`assessExtractionHealth` → the `degraded`
flag on the snapshot) is now surfaced as a **global amber banner across every
side-panel module**, not just the Monitoring tab. When a patient record is on
screen but the extension can extract no medications, problems, observations or
demographics — the signature of a Medicus layout change — the banner appears and
warns that this is **not** an "all clear" and that the patient must be verified
directly in Medicus. It includes a one-click **Check for update** button (reuses
the existing `UpdateChecker`, with the same `https://github.com/` release-URL
validation used on the About tab).

This converts a silent failure mode (an empty Monitoring panel read as "nothing
to flag") into a visible prompt no matter which tab the clinician is on. The
banner polls every 30 s, refreshes immediately on `sentinel:snapshot-updated`,
and clears automatically once extraction recovers. No new storage keys; no change
to the underlying clinical signal (already regression-tested by
`test-extraction-health.js`).

## [v3.29.3] — 2026-06-05

### Fix: options page now reloads after import so restored settings are visible

After confirming a backup restore (suite-wide or per-module), the options page now reloads itself after 1.5 s. Previously the form kept displaying pre-import values even though the data was correctly written to storage — causing the triage monitor UUID, slot alert rules, and all other restored settings to appear missing until the page was manually reloaded.

## [v3.29.2] — 2026-06-05

### Tab order and rename

Renamed "ACR Trend" tab to "Renal Monitoring" (module key `acrtrend` unchanged). Reordered nav tabs in both panel and pop-out to: Slots → Monitoring → Renal → BP Trend → Forecast → Submissions → Activity → Referrals.

## [v3.29.1] — 2026-06-04

### Prescribing safety — completed the UK oral NSAID set (The Keeper)

The Keeper run found the NSAID drug lists were missing several UK-marketed oral NSAIDs, so a patient
on one of them **silently never fired any NSAID prescribing flag** (gastroprotection, NSAID +
anticoagulant/antiplatelet, triple-whammy/AKI). Completed the set in **both** places that matter:

- **`content-scripts/triage-lens/content.js`** — the `NSAIDS` regex in `evaluatePrescribingFlags`,
  which fires the *built-in* prescribing-flag chips. Added tenoxicam, sulindac, dexketoprofen,
  tiaprofenic acid, tolfenamic acid and fenoprofen (nabumetone was already present).
- **`rules/alert-library.json`** — the shared NSAID `drugSet` used by all NSAID-combo starter rules
  (PINCER #1–#4, #6, #12). All six sets are now the complete, uniform UK oral NSAID list (also adding
  dexibuprofen where it was missing).

Regression-locked with seven new assertions in `test-prescribing-flags.js` (22 pass). NSAID list
corroborated via search; pending primary-source confirmation. Verification note: the *shipping* gap
was in `content.js`, not just the JSON library the scan first flagged — both are now fixed.

## [v3.29.0] — 2026-06-04

### QOF — new 2026/27 Obesity clinical area (The Keeper, DRAFT pending confirmation)

The Keeper rule-currency run found that `rules/qof-rules.json` was missing the **new Obesity
clinical area introduced in QOF 2026/27** (NHS England PRN02356), despite the file claiming full
26/27 coverage. Added:

- **OB register** (`qof-reg-ob`, enabled) — Obesity register, approximated by substring
  problem-matching. The true QOF register is BMI-driven (BMI ≥30, or ≥27.5 for listed ethnic
  backgrounds, recorded in the last 12 months), so this approximation will miss obese patients who
  have a recorded BMI but no `obesity` problem label; proper membership needs a BMI-observation
  register (engine extension). Excludes family-history / negated labels.
- **OB004 and OB005 indicators** — shipped **disabled** as drafts, mirroring the existing
  placeholder convention (DM037/HF009). OB004 (offer of weight-management referral) and OB005
  (weight-management pharmacotherapy / shared decision-making) carry corroborated points/thresholds
  (5 pts @ 10–30%; 13 pts @ 50–80%) that are **pending confirmation against PRN02356** before being
  enabled. OB005 is relevant to this dispensing practice's GLP-1 weight-loss prescribing.

OB register membership is regression-tested in `test-qof-indicator-filters.js`. Values were
corroborated via search only (primary NHS England guidance was not fetchable in the run environment)
— the Clinical Safety Officer should confirm OB004/OB005 points and thresholds against PRN02356 and
flip them enabled.

## [v3.28.1] — 2026-06-04

### Drug-monitoring rules — brand-completeness pass (The Keeper)

First run of the new **The Keeper** rule-currency skill (`.claude/skills/the-keeper/`). A
brand-completeness sweep of `rules/drug-rules.json` against dm+d/emc found monitored drugs whose
`drug.match` lists were missing currently- or recently-marketed UK brands. Because matching is
case-insensitive substring (`engine/rules-engine.js`), a prescription written under a missing brand
**silently never fires its monitoring alert** — a patient-safety gap, not a cosmetic one. Added:

- **amiodarone** — `cordarone` (the rule previously listed *no* brand, so "Cordarone X" never fired
  TFT/LFT/CXR monitoring for a drug with thyroid/hepatic/pulmonary toxicity).
- **allopurinol** — `caplenal`, `uricto` (previously only `zyloric`). `hamarin` was investigated but
  held out pending confirmation of current UK marketing.
- **azathioprine** — `azapress` (Ennogen).
- **sulfasalazine** — `sulazine` (Sulazine EC, Teva).
- **methotrexate** — `maxtrex` (discontinued Pfizer oral brand that persists on repeats).

All additions are regression-locked in `test-drug-brand-coverage.js` (264 assertions pass). Brands
were corroborated via dm+d/emc search; the source citations in the rule file note they are pending
primary-source (BNF/dm+d) confirmation by the Clinical Safety Officer.

## [v3.28.0] — 2026-06-04

### Security

Hardening pass from an adversarial code review (red-team audit). Full write-up in
`SECURITY-AUDIT.md`. No evidence of any active compromise or data exfiltration was found;
these changes close latent weaknesses, the most important being a patient-safety one.

- **Ruleset import can no longer silently weaken clinical safety alerts (F1, High).**
  `engine/ruleset-io.js` now hard-validates imported override objects: every numeric `check.*`
  threshold (`red`/`amber`/`threshold`/`thresholdSystolic`/`thresholdDiastolic`/`minDelta`/
  `minPoints`/`withinDays`/`withinMonths`) must be a finite number (`Number.isFinite`), array
  fields must be arrays, and `kind`/`operator`/`comparator`/`direction` must be in their known
  enum sets. `intervalDays`/`dueSoonDays` now reject `NaN`/`Infinity`. Previously a malformed or
  malicious backup could set a string threshold, causing `NaN` comparisons that silently
  suppressed an alert. `mergeRules` also strips `__proto__`/`constructor`/`prototype` keys before
  merging (defence-in-depth). The import **preview now warns** when a file disables monitoring
  rules ("Disables N monitoring rule(s): …"). New regression suite `test-import-hardening.js`.
- **Patient data minimised at rest (F2, Medium).** `shared/request-monitor.js` no longer
  persists full patient names to `chrome.storage.local` (plaintext on disk) — only initials are
  stored. Desktop notifications (`service-worker.js`) now show counts/initials rather than full
  names.
- **Tightened extension resource exposure (F3, Medium).** `web_accessible_resources` trimmed from
  17 broad globs to the 5 files content scripts actually load (`sidebar/*`, the three
  `rules/*.json`), so the engine code and shared utilities are no longer readable by Medicus-page
  scripts. (The rule JSON must remain accessible because content scripts fetch it; moving rule
  loading to the service worker is a tracked follow-up.)
- **Untrusted MAIN-world bridge hardened (F4/F5, Low–Med).** The `ch-task-list-data` bridge in
  `content-scripts/triage-lens/content.js` now bounds row counts, validates row/UUID shape, and
  rate-limits (sliding window + debounce) so a compromised page can't fan forged events out into
  unbounded API calls. `chrome.runtime.onMessage` handlers in `service-worker.js`, `sentinel.js`,
  `panel.js` and `pop-out.js` now reject messages where `sender.id !== chrome.runtime.id`.
- **Supply-chain & permission hygiene (F6/F7/F8, Low).** Added `vendor-versions.json` (library
  versions + SHA-256 for the vendored PDF.js/Chart.js/D3 bundles); import now rejects files
  >10 MB before parsing; the GitHub host permission narrowed from `api.github.com/*` to the
  single repo path used by the update checker; practice-code/site-ID values are format-validated
  before being interpolated into fetch URLs.

## [v3.27.0] — 2026-06-03

### Changed
- **Suite-wide UK brand-name coverage for built-in drug-monitoring rules.** Following the lithium/methylphenidate/methotrexate fixes, every remaining monitored drug class was researched against the BNF / dm+d / emc and its current UK proprietary brands added to `drug.match`, so brand-prescribed items fire the same monitoring as their generics. Only UK-marketed brands were added (legacy/discontinued ones retained, since repeat prescriptions persist); non-UK names were deliberately excluded. Highlights:
  - **DMARDs**: leflunomide (`arava`); hydroxychloroquine (`quinoric`, `plaquenil`) / chloroquine (`avloclor`); azathioprine (`imuran`); sulfasalazine (`salazopyrin`).
  - **Carbamazepine**: `carbagen`. **Carbimazole**: `neo-mercazole` / `neomercazole`.
  - **ACE inhibitors / ARBs**: full set incl. `tritace`, `zestril`, `carace`, `coversyl`, `innovace`, `capoten`, `noyada`, `gopten`, `staril`, `cozaar`, `hyzaar`, `arbli`, `amias`, `diovan`, `exforge`, `aprovel`, `karvea`, `micardis`, `pritor`, `tolura`, `olmetec`, `sevikar`, `edarbi`, plus thiazide-combination brands (`zestoretic`, `innozide`, `triapin`).
  - **SGLT2 inhibitors** incl. metformin/DPP-4 combinations: `forxiga`, `xigduo`, `qtern`, `jardiance`, `synjardy`, `glyxambi`, `invokana`, `vokanamet`, `steglatro`, `segluromet`, `steglujan`.
  - **DOACs**: `eliquis`, `xarelto`, `lixiana`, `pradaxa`.
  - **Statins**: `lipitor`, `atozet`, `inegy`, `crestor`, `enebium`, `lipostat`, `lescol`, `livazo`.
  - **Antipsychotics** incl. long-acting depots: `zyprexa`, `zalasta`, `zypadhera`, `risperdal`, `okedi`, `seroquel`, `atrolak`, `biquelle`, `zaluron`, `abilify`, `serenace`, `dozic`, `haldol`, `largactil`, `solian`, `invega`, `xeplion`, `trevicta`, `byannli`, `latuda`, `sycrest`, `reagila`. (Clozapine remains excluded — national CPMS protocol.)
  - **Others**: spironolactone/eplerenone (`aldactone`, `inspra`); allopurinol/febuxostat (`zyloric`, `adenuric`); mirabegron (`betmiga`); levothyroxine/liothyronine (`eltroxin`, `euthyrox`, `tertroxin`); GLP-1 legacy brands (`xultophy`, `lyxumia`, `byetta`, `bydureon`); systemic HRT (`progynova`, `zumenon`, `climaval`, `estraderm`, `nuvelle`) — local vaginal oestrogens still excluded.

### Added
- **`test-drug-brand-coverage.js` extended to every drug-monitoring rule** (258 assertions): each monitored generic/brand must fire its rule, plus negative controls (clozapine must not match the antipsychotic rule, vaginal oestrogens must not match systemic HRT, unrelated drugs must not match). A cross-rule collision check confirms no added brand token fires an unrelated rule.

## [v3.26.7] — 2026-06-03

### Added
- **Brand-coverage regression test** (`test-drug-brand-coverage.js`) asserting, via the real `drugMatchesRule`, that every monitored generic/brand fires its rule (and unrelated drugs don't). Guards against the *silent* under-matching failure mode where a brand-prescribed med never triggers its alert.
- **CLAUDE.md SOP** — new "Editing drug-monitoring rules" section: substring-match semantics, list-all-UK-brands expectation, `exclude` caution, and the requirement to extend the coverage test when adding drugs/brands.

## [v3.26.6] — 2026-06-03

### Changed
- **Methotrexate monitoring now also covers injectable forms.** Removed the `methotrexate 50mg/2ml` / `methotrexate injection` exclusions from the `methotrexate-maintenance` rule so that any patient on parenteral methotrexate (uncommon in primary care, but possible) still gets FBC/U&E/LFT monitoring rather than being silently skipped.

## [v3.26.5] — 2026-06-03

### Changed
- **Expanded brand-name coverage for built-in drug-monitoring rules** so that proprietary/brand prescriptions trigger the same monitoring as their generic names:
  - **Lithium**: added `priadel`, `camcolit`, `liskonum`, `li-liquid`. (`lithium carbonate` / `lithium citrate` were already matched via the `lithium` substring.)
  - **Methylphenidate (ADHD stimulant, paediatric + adult rules)**: added `tranquilyn`, `affenid`, `atenza`, `kixel`, `matoride`, `xaggitin`, `focusim`, `meflynate`, `metyrol` (joining the existing `ritalin`, `concerta`, `equasym`, `medikinet`, `xenidate`, `delmosart`).
  - **Methotrexate**: added `metoject`, `jylamvo`, `nordimet`, `zlatal`, `methofill` (oral and shared-care brands). Injectable high-dose exclusions (`methotrexate 50mg/2ml`, `methotrexate injection`) are unchanged.

## [v3.26.4] — 2026-06-02

### Fixed
- **HRT hysterectomy detection**: "Vaginal hysterectomy" (and other procedure-coded hysterectomies stored as ended/past problems) was not detected by the HRT progestogen-coverage check. The normaliser now captures ended problems separately as `pastProblems`; the HRT context builder checks both active and past problems for hysterectomy terms, so the chip correctly shows "Hysterectomy — progestogen not required" instead of the false "No progestogen or hysterectomy recorded" warning.

## [v3.26.3] — 2026-06-02
### Added
- **Per-rule hide / snooze for monitoring chips** — each chip in the monitoring panel now carries an unobtrusive dismiss (×) button, visible on hover at the top-right, that does not interfere with click-to-expand evidence.
  - **Vaccine chips** snooze until the season start (`seasonStartIso`) and auto-resurface once that date passes.
  - **Drug-monitoring and QOF indicator chips** hide permanently (until cleared).
  - Suppressions are stored in `chrome.storage.local` under `sentinel.hiddenRules` (`{ ruleId: { until: ISODate|null } }`); a rule is hidden while the key exists and `until` is null or a future date.
  - Sentinel settings (Display tab) gains a **Hidden / Snoozed Alerts** section listing every suppressed rule with an Enable button, plus a **Manage Alerts** section that hard-toggles the bundled vaccine rules on/off.
  - The panel re-renders live on `sentinel.hiddenRules` changes, and `sentinel.hiddenRules` is now included in suite backups (`sentinel-io.js`).

## [v3.26.2] — 2026-06-02
### Fixed
- **QOF chips missing on care record view** — `detectMedicusContext` had a negative lookahead `(?!.*care-record)` on the `/patient/{uuid}` URL regex that explicitly excluded URLs of the form `/patient/{uuid}/care-record/...`. This meant the care record URL never yielded a `patientUuid` directly, falling through to the DOM banner scraper; if that failed, `dom-fallback` was used with empty `observationHistory`, causing all QOF indicators to resolve as `no_data` and disappear. Document task views worked because they use a separate `resolveTaskToPatient()` path. Fix: removed the negative lookahead — one character change in `engine/api-client.js:45`.

## [v3.26.1] — 2026-06-02
### Fixed
- **Flu chip false positive on all patients** — `matchVaccineEligibility` register clause was calling `patientOnRegister()` which returns `{matched: false}` (a truthy object), not a boolean. The old `.some()` check treated this truthy object as a hit, causing the flu chip to fire for every patient via the "Clinical risk group (QOF register)" clause. Fixed by converting to an explicit loop with `if (res && res.matched)` check. Same fix applied to `conditional-register` clause.
- **Chip too wordy** — "DOUBLE-CHECK ELIGIBILITY" disclaimer and source text moved into a native `<details>` block collapsed by default. Compact view shows only displayName + status badge + eligibility reason + season. Disclaimer visible on expand (ⓘ Details).
- **No provenance shown** — `matchVaccineEligibility` now captures and returns the specific matched evidence: which problem, which register + problem, which medication, or which observation value triggered eligibility. Shown in the expanded chip detail.

## [v3.26.0] — 2026-06-02
### Added
- **Vaccination eligibility alerts** (flu + COVID) — new `vaccine` rule type and `rules/vaccine-rules.json`. The monitoring panel now surfaces a "Vaccinations" group with DUE / GIVEN / DECLINED chips. Eligibility is derived from age, QOF registers, active problems, current medications, and BMI observation using JCVI/UKHSA 2025/26 criteria.
  - **Flu**: age 65+, all 2–17yo, pregnancy, clinical risk registers (DM/CKD/COPD/CHD/HF/Stroke-TIA/AF/PAD), asthma on inhaled/systemic steroids, chronic liver/neurological disease, immunosuppression, asplenia, BMI ≥40 (Green Book Chapter 19).
  - **COVID**: age 75+, care home residents, and immunosuppressed only — clinical risk groups are no longer eligible as of 2025/26.
  - Status (DUE/GIVEN/DECLINED) is inferred from coded problems, observations, and journal entries within the current season window (flu from 1 Sep, COVID autumn from 1 Oct). All chips carry a prominent "DOUBLE-CHECK ELIGIBILITY" note as status may be incomplete if vaccination was given outside the practice.

## [v3.25.3] — 2026-06-02
### Fixed
- **BP Trend tab still blank after v3.25.2** — added a fallback path in `bptrend.js` that merges separate "Systolic blood pressure" / "Diastolic blood pressure" entries from `observationHistory` by date when no parseable combined "Blood pressure" entry is found. This handles all API shapes: combined row (primary path), synthesised combined entry from v3.25.2 (primary path), and raw split rows that reach bptrend without synthesis (fallback path). Also added `Blood pressure` history entries to mock data (`engine/data-fetcher.js`) so the trend tab can be verified in mock mode.

## [v3.25.2] — 2026-06-02
### Fixed
- **BP Trend tab showing "No blood pressure readings found"** — `normaliseObservationHistory` was emitting separate "Systolic blood pressure" / "Diastolic blood pressure" entries with scalar `rawValue` ("120", "80"). The bptrend module matched the systolic row first, `parseBp("120")` failed the slash regex, and all history points filtered to empty. Fix: added same systolic/diastolic date-pairing synthesis to `normaliseObservationHistory`, producing a `"Blood pressure"` entry prepended to `observationHistory` with `rawValue: "120/80"` per date. `unshift` ensures it is found before the raw split rows on substring match.

## [v3.25.1] — 2026-06-02
### Fixed
- **BP chips not surfacing** — Medicus API emits blood pressure as separate "Systolic blood pressure" and "Diastolic blood pressure" investigation rows. `parseBp()` in the rules engine requires combined "NNN/NN" slash format, so it previously returned null for every BP reading and all enabled BP indicators (CD001, CD002, HYP010, HYP011) resolved to `no_data`. Fix: `normaliseObservations` now runs a post-processing pass after the per-row loop that pairs same-date systolic + diastolic rows and injects a synthetic `{ name: "Blood pressure", value: "NNN/NN mmHg", ... }` observation, making existing chip evaluation work with no rules changes.

## [v3.25.0] — 2026-06-02
### Added
- **BP Trend tab** (`bptrend`) — shows systolic/diastolic history as a dual-line SVG chart with condition-specific target lines (130/80 for CKD+ACR>70, 150/90 for HYP≥80, 140/90 standard). Target derived from achieved QOF register chips. AT TARGET / ABOVE TARGET pill. Paediatric caveat note for under-18s (adult thresholds shown; centile charts required for accurate paediatric assessment).
- **ACR Trend tab** (`acrtrend`) — shows ACR history with A1/A2/A3 KDIGO threshold band shading, eGFR co-display with G-stage bands, KDIGO G×A monitoring frequency cell, and action banners for ACR ≥70 (referral), ACR doubling, and category crossing.
- **`getTrendData` content-script bridge** — new message action in `sentinel.js` exposes `observationHistory`, `problems`, `patientContext`, and achieved register chips to panel modules. `_lastTrendData` is written in lockstep with `_lastSnapshot` and cleared in `invalidateSnapshot` to prevent cross-patient data render.
- **`shared/trend-chart.js`** — shared SVG line chart utility (`lineChart`, `parseBp`, `bpTarget`, `fmtDate`, `esc`) used by both trend modules. Hand-coded SVG — no Chart.js dependency in panel shells.

### Notes
- BP `value` in observationHistory is NaN for "120/80" strings; bptrend parses `rawValue` via `parseBp`.
- Trend data only available after the Medicus investigation dashboard has loaded for the patient.
- No chrome.storage keys added — no IO backup wiring needed.

## [v3.24.0] — 2026-06-02
### Added
- **ADHD stimulant monitoring (paediatric)** (`adhd-stimulant-paediatric`, age ≤17) — 6-monthly BP, pulse/HR, weight, height. Covers methylphenidate (Ritalin/Concerta/Equasym/Medikinet/Xenidate/Delmosart), lisdexamfetamine (Elvanse), dexamfetamine (Dexedrine/Amfexa). First rule to exercise `ageRange` on drug-monitoring rules.
- **ADHD stimulant monitoring (adult)** (`adhd-stimulant-adult`, age ≥18) — 6-monthly BP, pulse/HR, weight. Same drug match, no height (not clinically indicated in adults).
- **Atomoxetine monitoring** (`atomoxetine-maintenance`) — 6-monthly BP, pulse/HR, weight; annual LFT (hepatotoxicity). Notes cover MHRA suicidality warning (first month) and paediatric growth.
- **Guanfacine monitoring** (`guanfacine-maintenance`) — 3-monthly BP, pulse/HR, weight (stricter CV interval vs stimulants; hypotension/bradycardia risk). Notes cover tapering requirement and CYP3A4 interaction.
- **New test match patterns**: pulse/HR (`["pulse", "heart rate", "hr", "resting heart rate"]`, SNOMED 78564009) and height (`["height", "body height"]`, SNOMED 248335003) — both new to the rule suite.

## [v3.23.0] — 2026-06-02
### Added
- **Smoking status due chips** — new `observation-recent` QOF indicators for all relevant disease registers: SMI (MH011), Asthma, COPD, Diabetes, CHD, Stroke/TIA, CKD, Heart Failure, PAD (all SMOK001). New SMI register added (`qof-reg-smi`) covering schizophrenia, bipolar disorder, and other psychoses.
- **Carbamazepine drug monitoring** (`carbamazepine-maintenance`) — 6-monthly FBC, LFT, U&E/Sodium, carbamazepine level; annual lipid profile. Match terms include `tegretol`. Notes cover SIADH/hyponatraemia, enzyme-induction effects on lipids, and contraceptive/teratogenicity considerations.
- **`observation-bundle` engine support** — new check kind in `rules-engine.js`; evaluates each observation group against the QOF year window and returns `achieved` (all met) / `not_met` (partial) / `no_data` (none found), with a `X/N care processes` value label. `evidenceCtx.bundleResults` carries per-group detail for the chip renderer.
- **DM037 enabled** — all 8 diabetes care processes indicator now live (was disabled pending engine support).

## [v3.22.1] — 2026-06-02
### Fixed
- **HRT progestogen context**: added `"hormone releasing intrauterine"` and `"insertion of hormone releasing"` to `iusProblemTerms` so that a problem entry of "Insertion of hormone releasing intrauterine contraceptive device" is now recognised as an IUS for endometrial-protection context on HRT chips.

## [v3.22.0] — 2026-06-01
### Fixed (custom rule creator ↔ engine parity — from the two-agent review)

The custom rule builder was wired correctly end-to-end (all five types save, merge, evaluate, render, back up) but several builder forms had drifted behind the engine, so some saved rules silently behaved differently than configured. Closed the gaps:

- **qof-indicator cohort fields now reachable**: the builder exposes free-text **`requiresProblem`** (all-of), **`requiresAnyProblem`** (any-of), free-text **`excludeIfProblem`** (alongside the frailty preset), and **`sex`**. Previously a clinician could not build a DM021/DM035-style stratified indicator — any attempt fired for the whole register with the wrong denominator (the over-trigger the engine work had just fixed for canonical rules). `validateQofIndicatorRule` now type-checks all four. (`sentinel-options/options.html`, `sentinel-options/options.js`, `shared/io/sentinel-io.js`)
- **`medicationExclude` no longer a no-op**: the qof `medication-present` check ignored `medicationExclude` even though the builder saved it. The engine now applies it (an excluded med can't satisfy the indicator). (`engine/rules-engine.js`)
- **drug-monitoring patient filters + SNOMED**: the builder now exposes `ageRange`, `sex`, `requiresProblem`/`excludesProblem`, and per-test SNOMED codes — the gating/coding the engine already applied but the form couldn't set. Validated in `validateDrugMonitoringRule`. (`sentinel-options/*`, `shared/io/sentinel-io.js`)
- **drug-combo `mustNotBePresent`**: the "must NOT be co-prescribed" drug-absence gate (engine-supported, validator-allowed) is now a form field. (`sentinel-options/*`)
- **Rule-builder live preview now matches runtime for trend / event-count(observations)**: the mock patient built a flat `observationHistory`, but the engine reads entries grouped per investigation type with a nested newest-first `history[]`. The preview now mirrors the normaliser shape, so "would this fire?" matches production. (`sentinel-options/options.js`)
- Extended `test-qof-indicator-filters.js` (now 39 assertions) covering `medicationExclude` and the new validator fields.

## [v3.21.3] — 2026-06-01
### Fixed (cosmetic / dead-code / consistency — from the codebase audit)

- **CHOL004 LDL priority (F9)**: `findLatestObservation` now uses a same-date tiebreak that prefers earlier-listed `match`/`observation` terms, and CHOL004 lists LDL before non-HDL — so when both are recorded on the same date, LDL takes priority (as the rule note specifies) instead of depending on dashboard row order. (`engine/rules-engine.js`, `rules/qof-rules.json`)
- **Dead message handlers removed (E4)**: deleted the `openTriageLensOptions` service-worker case (no sender) and the `toggleSidebar` SW→tab round-trip plus its no-op listener in `sentinel.js` (suite mode has no floating sidebar to toggle). (`service-worker.js`, `content-scripts/sentinel.js`)
- **Triage-lens options fallback path (D1)**: the `openOptionsPage`-unavailable fallback opened `getURL('options.html')`; the file is at `options/options.html`. (`content-scripts/triage-lens/content.js`)
- **Dead script load removed from pop-out (B5)**: `pop-out.html` loaded `shared/request-monitor.js` but the pop-out never uses `RequestMonitor`. (`pop-out/pop-out.html`)
- **Submissions date-picker race (B6)**: date-change callbacks are now registered synchronously in a map keyed by input id instead of via `setTimeout(0)`, so a change fired immediately after render can't be dropped. (`side-panel/modules/submissions/submissions.js`)
- **SubRag strip diagnostics (E5)**: the submissions-RAG strip now fetches via `ApiDiag.fetch`, so its errors/latency appear in the Debug panel like the other strips. (`side-panel/panel.js`)
- **Docs**: documented that `visualiser`/`about` are intentionally panel-only tabs (not mirrored in the pop-out) and clarified the pop-out message-relay (B4). (`CLAUDE.md`, `pop-out/pop-out.js`)

## [v3.21.2] — 2026-06-01
### Fixed (robustness / lifecycle — from the codebase audit)

- **Triage-lens route watcher no longer stacks uncancellable re-evaluations (A1)**: the 1200ms "slow rerender" timer in `onRoute` was fire-and-forget, so rapid SPA navigation (journal-search churn, queue scrolling) queued a `run(true)` — and a full 4-endpoint fetch cascade — per change. It's now stored and cleared alongside the 250ms timer. (`content-scripts/triage-lens/content.js`)
- **Rule edits now take effect immediately in the side panel (A4)**: the `storage.onChanged` handler only watched `sentinel.config` and called the suite-mode no-op `refresh()`, so editing a rule in Options didn't change the panel until the next navigation. It now also watches `sentinel.rules`/`orgRules`/`customRules`, invalidates the rules cache, and re-publishes. (`content-scripts/sentinel.js`)
- **`loadRules()` is cached (A6)**: it previously did 2× `fetch` + 1× `storage.get` on every evaluation (including the 800ms journal-search re-eval). The canonical ruleset is fetched once and the merged result cached, invalidated on rule-key changes. (`content-scripts/sentinel.js`)
- **Same-patient nav guard works on DOM-fallback views (A5)**: `patientContext.patientUuid` is now resolved (URL, then single-patient DOM banner) on the DOM-fallback path, so journal searches / tab switches on those views no longer invalidate + re-fetch the snapshot on every URL change. (`engine/data-fetcher.js`)
- **Pop-out tab switching has a sequence guard (B1)**: `pop-out.js switchModule` now mirrors `panel.js`'s `switchSeq` guard, so a fast tab switch can't leak the previous module's timers/listeners or lose its cleanup. (`pop-out/pop-out.js`)
- **Sentinel side-panel `refresh()` coalesces concurrent calls (B2)**: it had no in-flight guard despite being driven by the 10s poll, tab events, the snapshot-updated message and the refresh button — concurrent calls raced their round-trips and clobbered each other's DOM. Also removed a duplicate per-render refresh-button listener (the delegated handler already covers it). (`side-panel/modules/sentinel/sentinel.js`)
- **"No practice code" message now shows (B3)**: `fetchWaitingRoom` called `render({state:'loaded'})` — an unhandled state that threw (swallowed) — instead of updating the pinned waiting-room block. (`side-panel/modules/sentinel/sentinel.js`)
- **Toolbar badge has a single owner (E1)**: the waiting-room count was written independently by both `panel.js` and the Sentinel module, racing/clobbering each other when the Sentinel tab was active. The badge is now owned solely by `panel.js`'s strip. (`side-panel/modules/sentinel/sentinel.js`)
- **Strip poll timers are torn down on `pagehide` (E2)**: `wrPollTimer`/`subRagPollTimer` were never cleared, risking duplicate timers if the panel document is recreated. (`side-panel/panel.js`)
- **Pusher relay releases the old channel handler before rebinding and resets its wait budget (E3)**: prevents a stale closure firing on a dead channel and the relay going permanently silent after a late reconnect. (`content-scripts/pusher-relay.js`)

## [v3.21.1] — 2026-06-01
### Fixed (backup/restore data loss — from the codebase audit)

- **`suite.display` now survives backup/restore (C3)** and **`suite.*` keys are no longer handled raw in `doFullExport`/`applyEnvelope` (C1)**: added `shared/io/suite-io.js` (`suiteExport`/`suiteImport`) owning `suite.display` (theme / text size / colourblind), `suite.practiceCode` and `suite.feedbackEmail`, per the CLAUDE.md convention. `doFullExport`/`applyEnvelope` now delegate to it instead of reading/writing those keys inline; `suite.display` (previously captured nowhere) is now backed up, and the envelope preview lists it. (`shared/io/suite-io.js`, `options/options.js`, `options/options.html`, `shared/io/suite-envelope.js`)
- **Sentinel alert-library acknowledgement now backed up (C2)**: `sentinel.alertLibrary.acknowledged` was written by the Sentinel options page but absent from `sentinel-io.js`, so a restore re-locked the alert library and re-prompted the user. Added it to `SENTINEL_KEYS` and the export/import shape. (`shared/io/sentinel-io.js`)
- **Per-module export cards for Triage Capacity Alerts and Pop-out (C4/C5)**: both scopes were fully wired in the IO/envelope layer but had no card in Options, so their standalone export/import was unreachable. Added the cards. (`options/options.html`)
- Added `test-backup-keys.js` (round-trip tests with an in-memory `chrome.storage` mock).

## [v3.21.0] — 2026-06-01
### Fixed

- **Journal-coded QOF indicators now fire in the side panel (F1)**: the suite-mode publish path (`evaluateAndPublish`) never augmented observations with consultation/journal-coded entries — that augmentation lived only in the floating HUD's `refresh()`, which is dead in suite mode. So indicators whose evidence lives only in the journal (AST007 asthma review, COPD010, HF007, DM014 structured education, AF006 CHA2DS2-VASc) always read `no_data` in the panel even when done. `evaluateAndPublish` now calls `fetchJournalObservations` (best-effort, generation-guarded so a journal fetch can't publish stale chips after a navigation). Also fixed the patient-id resolution in the HUD path to use the canonical `patientContext.patientUuid` field (it previously looked for `patientId`/`id`/`uuid`, none of which the normaliser sets, so journal augmentation silently skipped on care-record URLs). (`content-scripts/sentinel.js`)

## [v3.20.0] — 2026-06-01
### Fixed (clinical correctness — from the multi-agent codebase audit)

- **QOF indicator age filter now fails OPEN (F2)**: `evaluateQofIndicatorRule` previously returned no chip when a patient's age couldn't be extracted *and* the indicator had an `ageRange` — silently hiding age-gated indicators (HYP010/011, CD001/002, DM034/036, trend rules) whenever DOB scraping failed. It now uses the shared fail-open `passesAgeFilter` (suppress only when the patient is *positively* out of range), consistent with drug-monitoring and register evaluators. (`engine/rules-engine.js`)
- **`requiresProblem` / `requiresAnyProblem` now honoured by QOF indicators (F3)**: the QOF indicator evaluator ignored both, so **DM021** (frailty-stratified HbA1c) and **DM035** (CVD secondary-prevention statin) fired for *every* diabetic, showing the wrong target. The engine now supports `requiresProblem` (all-of) and a new `requiresAnyProblem` (any-of), both negation-aware. **DM021** migrated from `requiresProblem` → `requiresAnyProblem` (moderate **or** severe frailty); **HF009** (disabled) likewise migrated for its HFrEF synonyms. (`engine/rules-engine.js`, `rules/qof-rules.json`)
- **Problem matching is negation-aware (F6)**: `excludeIfProblem` used naive `.includes()`, so "no evidence of moderate frailty" wrongly excluded a patient. It now uses `problemLabelMatchesTerm`. (`engine/rules-engine.js`)
- **STIA register matches "TIA" abbreviations (F4)**: the register used space-padded `" tia "`, missing "TIA", "post TIA", "TIA 2024", "history of TIA" → no STIA/CD001/CD002 chips. Register match terms now use word-boundary matching (`registerTermInLabel`), which matches "TIA" without false-matching "iniTIAte". (`engine/rules-engine.js`, `rules/qof-rules.json`)
- **DM register no longer false-positives on "pre-diabetic" (F5)**: added hyphenated `"pre-diabetic"` to the DM register `problemExclude`. (`rules/qof-rules.json`)
- **HRT review chip gated on co-prescribed oestrogen (F10)**: a standalone progestogen or LNG-IUS (Mirena, Levosert, etc.) used for **contraception** triggered a false "HRT BP+weight review" chip (e.g. a 25-year-old with a Mirena). The chip now fires only when a systemic oestrogen / HRT agent (estradiol, conjugated oestrogens, tibolone…) is prescribed; a co-prescribed LNG-IUS/progestogen is reported as the progestogen-coverage component instead, and duplicate HRT chips are avoided. (`engine/rules-engine.js`, `rules/drug-rules.json`)
- Added `test-qof-indicator-filters.js` (30 assertions) covering all of the above.

## [v3.19.15] — 2026-06-01
### Fixed

- **QOF chips no longer vanish on journal search — the real cause (supersedes v3.19.14)**: the side-panel snapshot was published as a *side effect* of a global monkeypatch on `window.SentinelRules.evaluatePatient`. That engine global is shared with the triage-lens HUD (`content-scripts/triage-lens/content.js:1448`, `:2092`), which re-evaluates with a **drug-rules-only** ruleset on every care-record route tick — including journal searches. Each HUD evaluation overwrote `_lastSnapshot` with QOF-less chips, so the QOF rules flashed up (from the suite's full-ruleset evaluation) then got overwritten (by the HUD's drug-only one). The v3.19.14 `_lastPatientUuid` URL guard couldn't help because triage-lens wrote the snapshot entirely outside that observer. Fix: removed the monkeypatch and made `evaluateAndPublish` capture the chips and publish them directly via a new `publishSnapshot()`, so **only** the suite's full merged drug+QOF evaluation can write the side-panel snapshot. Also added a monotonic evaluation-generation guard (`_evalGen`) so a slow/stale fetch during journal-search churn can't publish chips over a newer evaluation. (`content-scripts/sentinel.js`, `test-snapshot-bridge.js`)

## [v3.19.14] — 2026-06-01
### Fixed

- **QOF chips no longer wiped when searching the patient journal**: in suite mode the side-panel snapshot is published by the `bootDataOnly` nav watcher in `content-scripts/sentinel.js`, which invalidated the snapshot on *every* SPA URL change. A patient-journal search (and care-record tab switches / filters) updates the URL while staying on the same patient, so the watcher kept calling `invalidateSnapshot()` — blanking the panel to "Loading…" then re-evaluating — making the QOF rules "flash up briefly then get overwritten" on each keystroke. The watcher now resolves the patient UUID from the new URL (`resolveUrlPatientUuid`, mirroring `detectMedicusContext`) and, when it matches the patient last evaluated (`_lastPatientUuid`), leaves the existing chips untouched. Genuine patient changes (different or unresolvable UUID) still invalidate immediately, preserving the wrong-patient safety guard. (`content-scripts/sentinel.js`)

## [v3.19.13] — 2026-06-01
### Fixed

- **HRT progestogen context now recognises Mirena/IUS on the problem list**: `buildHrtContext` previously only searched the medications list for IUS coverage, so problem-list entries like "Introduction of Mirena coil" or "Replacement of intrauterine system" were ignored, causing the "No progestogen or hysterectomy recorded" warning to fire incorrectly. The engine now also checks the problems list using `iusProblemTerms` (new field in `hrtContext`) plus the existing `iusTerms`. (`engine/rules-engine.js`, `rules/drug-rules.json`)

## [v3.19.12] — 2026-06-01
### Fixed

- **Prediabetes / non-diabetic hyperglycaemia no longer triggers QOF diabetes monitoring**: the `qof-reg-dm` register matched the term `"diabetic"` as a substring, which caused "non-diabetic hyperglycaemia" and similar problem-list entries to be treated as diabetes register members. Added `"non-diabetic"`, `"prediabetes"`, and `"prediabetic"` to `problemExclude` in `rules/qof-rules.json`.
- **Oestrogen pessaries no longer flagged for overdue BP/weight**: the `hrt-systemic` drug rule's exclude list only matched `"vaginal pessary"` as a compound phrase. Prescriptions written as "estradiol 10mcg pessary" (no "vaginal" prefix) bypassed the exclusion. Added standalone `"pessary"` to the drug exclude list in `rules/drug-rules.json`.

## [v3.19.11] — 2026-05-31
### Removed

- **Deleted the orphaned toolbar popup**: removed `popup.html` and `popup.js` and their `web_accessible_resources` entries. The icon now opens the side panel directly via `openPanelOnActionClick` (no `default_popup`), so the popup waiting-room page was dead code. (`popup.html`, `popup.js`, `manifest.json`)

## [v3.19.10] — 2026-05-31
### Fixed

- **Restored try/catch around `importScripts` (registration safety)**: the v3.19.9 simplification dropped the try/catch that the last-known-working v3.17.2 had. Without it, an error in any imported module propagates uncaught and fails the whole service-worker registration ("status code: 2"), discarding the worker — and with it the `setPanelBehavior` line. Restored the try/catch and added the documented `onInstalled` re-assertion of `openPanelOnActionClick: true` (belt-and-braces; fires on every reload). The worker now matches the proven-working v3.17.2 structure, minus the popup. (`service-worker.js`)

## [v3.19.9] — 2026-05-31
### Changed

- **Side-panel-on-icon-click rewritten from first principles — simple and robust**: the feature is now exactly what Chrome documents and nothing more — `"side_panel": { "default_path": ... }` in the manifest (no `default_popup`) plus a single declarative line as the **first statement** of the service worker: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. Chrome opens the panel on icon click natively (same path as the right-click "Open side panel" menu). Removed all the accumulated complexity: the manual `action.onClicked` handler, `setPopup`, per-tab `setOptions`, the guarded wrapper function, lifecycle re-assertions, and diagnostic badges. Module `importScripts` calls remain string literals. (`service-worker.js`, `manifest.json`)

## [v3.19.8] — 2026-05-31
### Fixed

- **THE service-worker registration failure (status code 2) — dynamic `importScripts`**: v3.19.5 refactored the module loads into `[...].forEach(src => importScripts(src))`. In an MV3 service worker, `importScripts()` must be called with **string literals** — Chrome statically analyses the worker to determine its script resources, and a variable argument can't be resolved, failing the entire registration with "status code: 2" (uncatchable by the surrounding try/catch). This had been masking every other fix since v3.19.5: the worker never registered, so `openPanelOnActionClick` never took effect and the icon did nothing. Reverted to four literal `importScripts('…')` calls, each in its own try/catch. (`service-worker.js`)

## [v3.19.7] — 2026-05-31
### Changed

- **Removed the toolbar popup — clicking the icon opens the side panel directly, no popup**: now that the service worker registers correctly again (v3.19.5 fixed the status-2 crash) and asserts `openPanelOnActionClick: true` at top-level, `onInstalled`, and `onStartup` (so the persisted flag can't get stuck), the declarative icon-click → side-panel behaviour finally works. Removed `default_popup` from the manifest. One click on the icon opens the suite side panel; no popup, no chooser. (`manifest.json`)

## [v3.19.6] — 2026-05-31
### Changed

- **Restored the toolbar popup so the icon reliably does something — independent of the service worker**: re-added `default_popup: popup.html` to the manifest. The popup runs in its own page context and does not depend on the service worker registering, so clicking the icon always works. The popup now **auto-opens the side panel on load** (the icon click is a user gesture) and closes itself, so there's no chooser — it goes straight to the suite. If a Chrome build won't allow the programmatic open, the popup falls back to showing the waiting-room view with an "Open Suite" button (a fresh click gesture, which always works). (`manifest.json`, `popup.js`)

## [v3.19.5] — 2026-05-31
### Fixed

- **THE actual cause of "Service worker registration failed. Status code: 2"**: the v3.19.4 service worker called `chrome.action.setPopup({ popup: '' }).then(...)` at the top level. `chrome.action.setPopup()` does not reliably return a Promise across Chrome builds — when it returns `undefined`, `.then()` throws `TypeError` synchronously during the worker's initial evaluation, outside any try/catch. An uncaught top-level throw aborts the entire service-worker registration (status code 2), so no listeners ever registered and the icon did nothing. Rewrote the side-panel setup to: (1) sit **before** `importScripts` so a module-load failure can't affect it; (2) never assume an API returns a Promise (guard with `typeof r.catch === 'function'`); (3) never throw at the top level (wrapped in try/catch); (4) use the simple declarative `openPanelOnActionClick: true` that worked in v3.17.2, removing the `setPopup`/`setOptions`/`onClicked` surface area entirely. Also isolated each `importScripts` in its own try/catch. Verified by simulation that the worker now evaluates without throwing even when every sidePanel/action API returns `undefined`. (`service-worker.js`)

## [v3.19.4] — 2026-05-31
### Fixed

- **Root cause of "service worker registration failed (status 2)"**: `shared/request-monitor.js` and `shared/update-checker.js` both ended their IIFE with `})(typeof window !== 'undefined' ? window : global)`. In a Chrome service worker, `window` is undefined AND `global` does not exist — evaluating `global` throws `ReferenceError: global is not defined`, aborting the import and causing Chrome to mark the service worker registration as failed. Fixed both files to use `globalThis` (universally available in Chrome 71+, service workers, popup pages, and content scripts). This is why clicking the toolbar icon did nothing: the service worker never successfully registered, so no event listeners were ever active. (`shared/request-monitor.js`, `shared/update-checker.js`)
- **Also**: call `chrome.action.setPopup({ popup: '' })` explicitly on each SW start to clear any cached popup association from older builds. (`service-worker.js`)

## [v3.19.3] — 2026-05-31
### Fixed

- **Toolbar icon click: add `setOptions(enabled:true)` before `open()`** — some Chrome builds require the panel to be explicitly enabled per-tab even when `default_path` is set in the manifest. If `open()` still fails, a red `ERR` badge appears on the icon so the failure is visible without opening the service-worker inspector. (`service-worker.js`)

## [v3.19.2] — 2026-05-31
### Changed

- **Side-panel icon click switched to an explicit, observable handler**: after the declarative `openPanelOnActionClick` approach kept failing on a real install, the toolbar-icon click now uses an explicit `chrome.action.onClicked` → `chrome.sidePanel.open({ windowId })` handler, with `openPanelOnActionClick` asserted `false` at top-level and in `onInstalled`/`onStartup` so the persisted flag can't desync from the handler. Added service-worker console logging on click and open so the behaviour can be diagnosed via chrome://extensions → "Inspect views: service worker". (`service-worker.js`)

## [v3.19.1] — 2026-05-31
### Fixed

- **Toolbar icon now reliably opens the side panel (root cause fixed)**: `openPanelOnActionClick` is a flag Chrome **persists** across reloads. v3.18.3 had set it to `false`; v3.18.4 set it back to `true` but only via a single top-level call whose rejection was swallowed, so on some installs the stale `false` survived and — with no `onClicked` handler — the icon did nothing (while the native right-click "Open side panel" still worked, since that ignores the flag). The behaviour is now asserted to `true` in `onInstalled` (fires on every update/reload) and `onStartup` as well as at top-level, and errors are logged rather than swallowed, so the stale value is reliably overwritten. Reload the extension once to apply. (`service-worker.js`)

## [v3.19.0] — 2026-05-31
### Added

- **Rising HbA1c trend monitor (Sentinel, enabled by default, diabetics only)**: mirrors the eGFR/PSA trend mechanism — fires when HbA1c rises ≥10 mmol/mol across ≥3 readings within 24 months, but only for patients on the diabetes (DM) register, so it never fires for non-diabetics. Flags deteriorating glycaemic control for clinical review (adherence, lifestyle, intercurrent illness, treatment intensification per NICE NG28/NG17). The ≥10 mmol/mol rise is a pragmatic, locally-adjustable review threshold; shows `no_data` until multi-point HbA1c history exists. (`rules/qof-rules.json`)

## [v3.18.5] — 2026-05-31
### Fixed

- **Trend evidence panel now shows the underlying readings even when a trend can't fire**: previously, when fewer than `minPoints` observations fell inside the trend window (e.g. a falling-eGFR chip with only 2 readings in 24 months), expanding the chip showed a bare "insufficient data" line with no values. The evaluator now populates `trendSeries` with the readings it found — in-window if available, otherwise the most recent few from history — so the evidence panel always shows the dated values (provenance). Direction/Span are shown only when ≥2 points are available; the builder is guarded against null delta/span. Affects all `observation-trend` rules (eGFR, PSA, and any custom trend). (`engine/rules-engine.js`)

## [v3.18.4] — 2026-05-31
### Fixed

- **Toolbar icon opens side panel with a single click**: replaced the manual `action.onClicked` + `sidePanel.open()` approach (which was silently failing) with `openPanelOnActionClick: true` — Chrome's own built-in mechanism, identical to the right-click "Open side panel" menu item and the most reliable option available. (`service-worker.js`)

## [v3.18.3] — 2026-05-31
### Fixed

- **Toolbar icon now reliably opens the side panel**: after removing `default_popup` in v3.18.2 the declarative `openPanelOnActionClick` did not always open the panel (the icon appeared to do nothing). Added an explicit `chrome.action.onClicked` handler that calls `chrome.sidePanel.open({ windowId })` and set `openPanelOnActionClick: false` (required for `onClicked` to fire), so a single click opens the suite even after a service-worker restart. (`service-worker.js`)

## [v3.18.2] — 2026-05-31
### Fixed

- **Icon click no longer shows popup chooser**: removed `default_popup` from the manifest `action` object so clicking the toolbar icon directly opens the side panel via `chrome.sidePanel.setPanelBehavior`. (`manifest.json`)
- **Alert Library unlock button**: made the handler synchronous — `applyLockState()` now fires immediately on click so the disclaimer overlay and `lib-locked` CSS class are removed at once, unblocking the Add and Add All buttons without waiting for the storage write to return. (`sentinel-options/options.js`)
- **eGFR trend window extended to 24 months**: the previous 12-month window typically captured only 1-2 annual GP eGFR readings, preventing the required `minPoints: 3` from being met. Extended to 24 months so three readings are reliably available; the NICE NG203 12-month clinical criterion is unchanged — only the data-search window has been widened. (`rules/qof-rules.json`)

## [v3.18.1] — 2026-05-31
### Added

- **Custom-rule UI for `observation-alert`**: the Sentinel custom-indicator form can now author RAG-banded observation safety alerts (match terms, dangerous direction, amber/red thresholds, unit, recency window), with live engine preview and edit support — mirrors the observation-trend form. (`sentinel-options/options.html`, `sentinel-options/options.js`)

## [v3.18.0] — 2026-05-31
### Added

- **Falling eGFR trend monitor (Sentinel, enabled by default)**: fires when eGFR falls >=15 mL/min/1.73m2 across >=3 readings within 12 months for any adult (NICE NG203 accelerated CKD progression). Mirrors the Rising PSA trend mechanism; shows `no_data` until multi-point eGFR history is available. Promoted from the opt-in alert library to a shipped default. (`rules/qof-rules.json`)
- **Raised potassium / hyperkalaemia alert (Sentinel, enabled by default)**: RAG-banded alert on the latest serum potassium — amber 5.5-5.9 mmol/L (mild; exclude pseudohyperkalaemia, review contributing drugs), red >=6.0 mmol/L (moderate/severe; urgent same-day assessment + ECG, >=6.5 = emergency). NICE CKS / UK Kidney Association advice surfaced in the chip notes. (`rules/qof-rules.json`)
- **New `observation-alert` check kind** in the rules engine: a clinical-safety threshold that reads the latest matching observation and fires amber/red bands (via `caution`/`alert` statuses), returning no chip when the value is in the safe range, stale, or absent — so safety thresholds don't add green-"MET" noise like QOF achievement indicators. (`engine/rules-engine.js`, `shared/io/sentinel-io.js`)

## [v3.17.3] — 2026-05-31
### Added — Falling eGFR trend sentinel library rule (NICE NG203)

- **Falling eGFR trend (Sentinel alert library)**: new `trend-2` library rule mirroring the Rising PSA trend — fires when eGFR falls ≥15 mL/min/1.73m² across ≥3 readings within 12 months (NICE NG203 accelerated CKD progression). Importable from the Sentinel options Alert Library; uses the existing `observation-trend` engine, so no code changes. Shows `no_data` until multi-point eGFR history is available. (`rules/alert-library.json`)

## [v3.17.2] — 2026-05-30
### Fixed — Wire the extraction-health canary to the side panel + invalidate stale snapshots (H-005, clinical safety)

The v3.17.0 silent-failure canary (`assessExtractionHealth`) was only consulted
by the **in-page HUD** renderer (`renderGroupedChips`), which suite mode never
mounts — the side panel boots via `bootDataOnly()`. So on the surface clinicians
actually use, a Medicus DOM/API drift that extracted nothing still rendered the
benign **"No chips for this patient"** — exactly the false "all clear" H-005 was
written to prevent. Two fixes:

- **Canary now reaches the side panel.** `evaluateAndPublish` computes
  `assessExtractionHealth` and the snapshot bridge stamps a `degraded`/`reason`
  flag onto the snapshot the side panel reads. The Sentinel side-panel module
  now renders a prominent **"⚠ Couldn't read this record"** warning for a
  degraded snapshot instead of a benign empty state.
- **Stale snapshots are invalidated.** `_lastSnapshot` previously updated *only*
  on a successful evaluation, so a thrown fetch/rules-load (the swallowed
  `catch` paths) left the **previous patient's** chips in place — and the panel
  rendered them with no patient-identity guard (wrong-patient risk on
  navigation). The snapshot is now invalidated the instant the SPA navigates and
  whenever an extraction fails; the panel treats an invalidated snapshot as
  "refreshing", never as data.

New pure helper `classifySnapshot` in the side-panel module with
`test-sentinel-panel-state.js` (10 assertions) guarding that a degraded or
invalidated snapshot can never be classified as renderable data. `docs/HAZARD-LOG.md`
H-005 updated with mitigations (g)/(h) recording that the canary now reaches the
side panel and the wrong-patient/stale-snapshot guard.

## [v3.17.1] — 2026-05-30
### Changed — Tighten `web_accessible_resources` exposure (security hardening)

Removed `<all_urls>` from the `web_accessible_resources` `matches` array in
`manifest.json`, leaving only `https://*.medicus.health/*`. The extension's
content scripts only run on `medicus.health`, and the suite's own pages
(options, side panel, pop-out, visualiser) load these resources from the
extension origin — which is not subject to `web_accessible_resources` matching
— so the `<all_urls>` entry granted no needed access. Dropping it stops any
arbitrary web origin from probing for these bundled resources (a fingerprinting
surface), without changing behaviour on Medicus pages.

## [v3.17.0] — 2026-05-30
### Added — Silent-failure detection + defaults-integrity tooling (continuous improvement)

**Extraction health check (turns silent failure into a visible warning — H-005).**
When the Sentinel panel renders zero results on a *live patient view* where a
patient was identified but nothing at all could be extracted (no medications,
problems, observations, or demographics — the signature of a Medicus DOM/API
change), it now shows a prominent **"⚠ Couldn't read this record"** warning
instead of the benign "No active alerts" — explicitly stating this is *not* an
"all clear" and to verify in Medicus. The decision is a pure, unit-tested helper
`assessExtractionHealth` (`content-scripts/sentinel.js`); a genuinely sparse
record (which still has demographics) is not flagged. New `test-extraction-health.js`
(10 assertions). A companion weekly **extraction-drift canary** scheduled task
was added (`.claude/scheduled-tasks/weekly-extraction-canary.md`).

**Triage Lens defaults — 3-copy integrity (removes a recurring footgun).**
- New `scripts/regen-defaults.js` regenerates the two *derived* copies
  (`content-scripts/triage-lens/defaults.json` and the `EMBEDDED_DEFAULTS`
  literal) from the source-of-truth root `defaults.json`, with a `--check` mode.
  This ends hand-editing of the embedded literal (the backslash-doubling that
  has caused regen bugs).
- `test-triage-defaults.js` now also pins the **root `defaults.json`** (previously
  untested despite being the copy loaded at runtime) and runs the regen `--check`.
- New CI **`.github/workflows/test.yml`** runs the full suite + the defaults
  `--check` + syntax checks on every push/PR and fails closed — making the
  "release gating runs the test suite" control in the safety case actually true
  (the release workflow previously built/released without running tests).
- The release build now excludes `scripts/` and `.claude/` from the shipped zip.

## [v3.16.0] — 2026-05-30
### Added — Custom Alert Builder live preview: all five rule types (Phases 2–5)
Completes the engine-backed live preview started in v3.15.0. The editable
mock-patient + real-engine preview (and validate-on-save via `validateCustomRule`)
now cover **every** Sentinel rule type:
- **drug-combo** and **event-count** — new preview wired via a shared
  `wireFormPreview` helper (mock panel + delegated, debounced re-evaluation).
- **qof-indicator** — replaced the cosmetic preview with the real engine across
  all four `check.kind` branches; a new `ciGetFormRuleFull` assembles the
  observation-trend check (previously only built at save time) so trend rules
  preview correctly.
- **composite** — preview resolves the **referenced child rules** (cached when
  the rule selector builds) and passes them to the engine, so an AND/OR
  composite shows whether it fires given its children.

The **"Auto-fill from rule"** seeder now understands every type — including
event-count (seeds N+1 events in the window), qof thresholds/recency/trend
(seeds crossing values / a trending series), and composites (seeds from the
child rules) — so one click produces a firing example.

All five save handlers now route through the shared `validateCustomRule`
(replacing hand-rolled checks), and the removed cosmetic status dropdowns are
gone. `test-alert-builder.js` now covers the full form-object → validate →
engine-fires round-trip for all five types (18 assertions, incl. composite
AND-firing); full suite passes.

### Docs — Clinical safety case synchronised to v3.16.0
Updated the safety case (`docs/HAZARD-LOG.md` → v3.2, `docs/CLINICAL-SAFETY-NOTICE.md`
→ v3.2, `docs/INTENDED-PURPOSE.md` → v3.16.0) to cover this session's
safety-relevant changes: new hazard **H-019** (Triage Lens record-panel STOPP/START
prescribing prompts, Pharmacy First signposting, risk-tool signpost links); H-002
updated for the v3.12.1 applicability-filter fail-open fix (prevents silent
suppression of demographic-gated safety alerts) + sturdier patient-context
extraction + the added Dementia register; H-003/H-004 updated for the five rule
types and the engine-backed live-preview / validate-on-save controls; H-007
extended to the new prompt surfaces; test count refreshed.

## [v3.15.0] — 2026-05-30
### Added — Custom Alert Builder: engine-backed live preview (Phase 1 of 5)
The Sentinel custom-rule builder (`sentinel-options/`) gains a **real
"would this fire?" preview** driven by the actual exported engine
(`SentinelRules.evaluatePatient`) — the same function the runtime uses — instead
of the previous cosmetic chip render. New shared infrastructure (reused by the
remaining rule-type forms in later phases):
- An **editable mock patient** panel (medications / observations / problems /
  age / sex / "as of" date) with an **"Auto-fill from rule"** button that seeds a
  firing example from the rule under construction.
- `runEnginePreview` / `renderEnginePreview` show **fire / no-fire + the engine's
  own evidence** (status, summary, facts), so parity with production is guaranteed.
- **Live validation**: the preview and Save now both route through the shared
  `validateCustomRule`, surfacing schema errors inline instead of the old
  hand-rolled checks.

This phase wires it into the **drug-monitoring** form (the engine `<script>` is
now loaded in the builder page). The other four rule types reuse the identical
infrastructure in subsequent phases. New `test-alert-builder.js` (7 assertions)
pins the form-object → validate → engine-fires round-trip and the documented
mock-patient parse shape.

## [v3.14.0] — 2026-05-30
### Added — STOPP/START prescribing flags + risk-tool signposting
Two competitor-gap "quick wins" from the EMIS/SystmOne market review.

**STOPP/START-style prescribing-safety flags** (record MEDS tile). A new
deterministic, pure `evaluatePrescribingFlags(meds, age)` helper adds review
prompts for well-established, low-false-positive medication combinations:
- **NSAID + anticoagulant** (or antiplatelet) — GI bleed risk
- **Triple whammy** — NSAID + ACEi/ARB + diuretic — AKI risk (PINCER/STOPP)
- **Benzodiazepine / Z-drug in age ≥80** — falls & sedation (STOPP)

Detection is medication-name based (topical NSAIDs are excluded), age-gated only
where the threshold is known, and surfaced via a new amber `record.stoppStart`
header chip. Worded as review prompts — decision support, verify against record.

**Risk-tool signpost chip** (`record.riskScores`, info). On adult records
(age ≥25) a "Risk tools" chip offers one-click links to the official **QRISK3**,
**QCancer**, and **eFI** calculators plus a note listing the inputs each needs.
Deliberately **signpost-only** — Medicus does not compute the scores (the
extractors can't supply cholesterol ratio / smoking / ethnicity, and an
unvalidated reimplementation would be a medical-device concern).

Added `test-prescribing-flags.js` (15 assertions, vm-extracted pure helper):
fires on the real combinations, ignores topical NSAIDs, respects the anticoag>
antiplatelet precedence, the age-≥80 gate (incl. unknown age), and clean lists.
Updated all three synced defaults copies; drift guard + full suite pass.
SNOMED code-suggestion actions were dropped from the roadmap.

## [v3.13.0] — 2026-05-30
### Added — Pharmacy First signposting across all 7 clinical pathways
Triage Lens now signposts to NHS Pharmacy First (England) for every one of the
seven national clinical pathways, addressing a competitor gap (PATCHS/Klinik
signpost lower-acuity demand away from GP slots).

- Added a **NHS Pharmacy First link + an eligibility/safety-net referral
  snippet** to the three existing matching rules: `uti`, `sore-throat`,
  `otitis`. Snippets state the pathway's age/sex gateway ("if eligible") and
  red-flag safety-netting — they assert *consideration*, not eligibility, since
  the patient's age/sex can't always be read.
- Added **four new amber detection rules** for the previously-uncovered
  pathways, each with the same Pharmacy First actions:
  - `sinusitis` — acute sinusitis (age 12+)
  - `insect-bite` — infected insect bite (age 1+)
  - `impetigo` — impetigo (age 1+)
  - `shingles` — shingles / herpes zoster (age 18+)

All four ship with lay + clinical detection patterns, verified against a
match/no-match spot-check (e.g. does not fire on "sinus rhythm", "my dog bit
me", or "crusty cough"). Updated all three synced defaults copies
(`defaults.json`, `content-scripts/triage-lens/defaults.json`,
`EMBEDDED_DEFAULTS`); drift guard and full suite pass.

(SNOMED code-suggestion actions were scoped out of this release.)

## [v3.12.1] — 2026-05-30
### Fixed — Applicability filters silently suppressed alerts on unknown demographics
A user reported the MHRA valproate alert never firing (even after pasting the
exact drug string into the rule's match list) and QOF rules "not firing at all."

**Root cause:** v3.1.8 ("applicability filter audit") made the engine start
*enforcing* `sex`/`ageRange` filters that were previously ignored — but
`passesAgeFilter`/`passesSexFilter` failed **closed** when the patient's age or
sex couldn't be determined. Patient sex/age are scraped from the page
(`patient-context.js`) and are frequently `null` depending on the record
layout, so any rule with a sex/age gate (e.g. valproate = female 12–55, and the
age-gated QOF indicators) silently never fired. For a red teratogenicity alert,
failing closed on *unknown* sex is the dangerous direction.

**Fixes:**
- `engine/rules-engine.js` — `passesAgeFilter`/`passesSexFilter` now **fail
  open** on unknown demographics: they exclude only when the patient is
  *positively known* to be out of scope. A known male still won't get the
  valproate alert; a patient whose sex/age can't be read now will (clinician
  verifies applicability).
- `engine/extractors/patient-context.js` — sturdier extraction: sex is now read
  from a labelled "Sex/Gender: …" field (dedicated element → patient-info text →
  whole-page fallback), and age falls back to an explicit "Age: 35"/"(35y)"/
  "35 yrs old" token and a page-wide DOB scan when the info container has none.
- `rules/qof-rules.json` — added the **Dementia (DEM) QOF register** (it was
  never shipped; the user's dementia example couldn't fire for that reason).

Added `test-applicability-filters.js` (16 assertions) covering fail-open on
unknown sex/age, correct suppression for *known* out-of-scope patients, the new
dementia register, and the patient-context extraction fallbacks. Full suite
passes.

## [v3.12.0] — 2026-05-30
### Improved — Triage Lens base rule detection (much higher recall)
Substantially expanded the detection phrases for all 20 built-in Triage Lens
rules so the baseline capture is far stronger on real, lay, patient-written
request text. Total shipped patterns grew from **106 → 620** (~5.8×).

For each rule we added: lay/patient phrasings ("water infection", "my back
hurts", "worst headache of my life"), clinical synonyms, common abbreviations
(SOB, COPD, MTX, DOAC, AOM), British **and** American spellings
(melaena/melena, haematemesis/hematemesis, oestrogen/estrogen,
anaesthesia/anesthesia), medication brand names (Eliquis, Xarelto, Pradaxa,
Priadel, Metoject, Evorel, Oestrogel…), common misspellings, and
hyphen/space variants.

Precision was preserved alongside recall:
- Rules that needed safe abbreviations or word-boundary control were switched
  from plain-text to `regex` mode, with every existing pattern rewritten to
  keep its original stem behaviour (e.g. `cough` → `cough\w*`,
  `depress` → `depress\w*`) — so the trailing word boundary can't silently
  drop suffix matches.
- Fixed the long-standing `fit-note` "med ?3" pattern that, in plain-text
  mode, never actually matched "med3"/"med 3" (the `?` was treated literally);
  it now uses `med[- ]?3`.
- `UTI` is now `\bUTI\b` (regex) so it no longer mis-fires on "utility";
  `repeat-meds` "out of my" now uses a negative lookahead so it captures
  "out of my amlodipine" but not "out of my mind"; `post-discharge` drops the
  bare noun "discharge" (kept "discharged" + "discharge summary") so it no
  longer fires on "vaginal/ear discharge"; assorted over-broad stems removed
  (`my back`, `irritab\w*`, accidental-injury phrasings in mh-crisis).

Every rule's new patterns were generated with per-rule expansion and then
gated by an automated harness (compiling patterns exactly as `content.js`
does) against `shouldMatch`/`shouldNotMatch` controls — **0 compile errors,
0 control failures** across ~90 assertions. All three synced copies
(`defaults.json`, `content-scripts/triage-lens/defaults.json`, and the
`EMBEDDED_DEFAULTS` fallback) were regenerated together; the drift guard
(`test-triage-defaults.js`) and full test suite pass.

## [v3.11.1] — 2026-05-30
### Fixed — Bug-bash findings (verified)
A parallel code audit (8 fast-model sweeps, verified by review) surfaced a
handful of real bugs; the rest were false positives. Fixes:

- **Capacity backup — merge import dropped settings (data loss).** A
  `merge: true` import early-returned after writing presets, silently discarding
  `activePresetId`, `viewMode`, and `showWeekends`. The merge path now falls
  through and persists all scalar settings. (`shared/io/capacity-io.js`)
- **Side panel — display popover leaked document listeners.** Each
  re-render of the display popover (including every in-popover click) added a new
  `document` click handler that was only removed on an outside click. Now tracked
  in a single module-level ref and removed before re-adding. (`side-panel/panel.js`)
- **Service worker — unhandled startup rejections.** `onInstalled` /
  `onStartup` fired async init tasks (`runMigration`, `initialiseRequestMonitor`,
  `initialiseUpdateChecker`) without `.catch()`, so storage failures were
  silently swallowed. Wrapped each in a `runStartupTask` guard that logs
  failures. (`service-worker.js`)
- **Submissions — "NaNd" subtitle.** `daysBetween()` returned `NaN` when a
  date `<input>` was cleared; now guarded. (`side-panel/modules/submissions/submissions.js`)
- **Capacity — null deref on "copy Mon".** `querySelector('input[data-day="mon"]').value`
  had no null check; now optional-chained with an early bail.
  (`side-panel/modules/capacity/capacity.js`)
- **Triage Lens — drag handler lingered on lost mouseup.** If a HUD drag was
  interrupted by an alt-tab (no `mouseup`), the `mousemove` listener stayed live
  and the HUD jittered on later mouse moves. Drag now also ends on window `blur`
  and tears down all transient listeners. (`content-scripts/triage-lens/content.js`)
- **Triage Lens — removed dead `injectTaskListInterceptor` no-op** and its two
  call sites (left over from the MAIN-world `page-world.js` refactor).
  (`content-scripts/triage-lens/content.js`)
- **Referrals — removed dead no-op line** in the `last3m` date preset
  (`end.setMonth(end.getMonth())`); range was already correct.
  (`shared/referrals-api.js`)

Notable **false positives** dismissed during verification: a hallucinated
16-site Visualiser XSS class (the `esc()` helper is applied everywhere), an
"inverted" QOF trend status (correct by design), and a request-monitor backup
"asymmetry" (symmetric in practice).

## [v3.11.0] — 2026-05-30
### Removed — Document-context lens (dead feature)
Removed the Triage Lens **document-context lens** in full — the v3.8.0 lens
(`detail.docEntries` / `detail.docUrgent` / `detail.docAction` chips fed by the
`/clinical/document/entries/` + `/document/modals/version/preview/`
interceptor) **and** the v3.9.0 PDF body-extraction pipeline built on top of it.
The whole feature is gone. The separate, DOM-sourced document **metadata** chips
(`detail.docType`, `detail.docSpecialty` — read from the document task card in
`extractDocumentTaskInfo`, not via any interceptor) and the queue monitoring
chips are unaffected.

- **Chips removed:** `detail.docEntries` (info, "Filed notes ×N"),
  `detail.docUrgent` (red), `detail.docAction` (amber) — from `defaults.json`,
  `content-scripts/triage-lens/defaults.json`, the embedded defaults and the
  settings catalogue. (`content-scripts/triage-lens/content.js`,
  `content-scripts/triage-lens/options.js`)
- **Content-script logic removed:** `_docCtx` state, the `ch-doc-entries`
  listener, `runDocContextChips`, the `injectDocContextInterceptor` stub and its
  init call, plus the v3.9.0 body machinery (`requestDocPdfText`, the
  covering-message text matching, `DOC_URGENT_RE` / `DOC_ACTION_RE` and the
  negation guard). (`content-scripts/triage-lens/content.js`)
- **PDF pipeline removed:** the offscreen document (`offscreen.html` /
  `offscreen.js`), the service-worker `sentinelDocPdfText` handler and its
  offscreen helpers, the `offscreen` manifest permission, and the offscreen
  web-accessible resources. (`service-worker.js`, `manifest.json`)
- **Interceptor narrowed:** `page-world.js` now intercepts **only** the queue
  `/tasks/data/{slug}/task-list` endpoint (`ch-task-list-data`); all
  document-context interception (`ch-doc-entries` / `ch-doc-preview`,
  `handleDoc`, the entries/preview regexes) is removed.
  (`content-scripts/triage-lens/page-world.js`)
- **Scratch files removed:** `doc-body-plan.md`, `doc-body-probe2.js`,
  `doc-body-discovery.js`.
- No `chrome.storage` keys, `shared/io/*` files, or backup envelopes were
  involved (the feature was deliberately ephemeral), so suite backups are
  unaffected. `vendor/pdf.min.js` / `pdf.worker.min.js` are retained — still
  used by the Patient Record Visualiser.

## [v3.10.0] — 2026-05-30
### Fixed — Network interceptors blocked by Medicus CSP (the real root cause)
- **This is why the queue monitoring chips and document-context lens never
  worked.** Both relied on wrapping `window.fetch`/`XMLHttpRequest` by injecting
  an inline `<script>` element from the isolated content script — but Medicus
  ships a strict Content-Security-Policy (`script-src 'self'`, no
  `'unsafe-inline'`), so the browser **blocked every inline-script injection**.
  The interceptors never installed; no task-list or document data was ever
  captured (the side-panel Monitoring module was unaffected — it uses a
  different data path). The earlier fetch-vs-XHR fixes (v3.9.3 / v3.9.4) were
  correct but moot because nothing was injecting at all.
- **Fix:** the interceptors now live in a dedicated `page-world.js` registered as
  a **`"world": "MAIN"` content script** (run_at `document_start`). The browser
  injects MAIN-world content scripts itself, so they run in the page's JS context
  **exempt from the page CSP**, and communicate back to the isolated content
  script via the same `ch-task-list-data` / `ch-doc-entries` / `ch-doc-preview`
  `CustomEvent`s. One file now wraps both fetch and XHR for both the queue
  task-list and the document-context endpoints. (`content-scripts/triage-lens/page-world.js`, `manifest.json`)
- The old `injectTaskListInterceptor` / `injectDocContextInterceptor` inline
  injectors in `content.js` are now no-ops (kept as named functions so existing
  call sites are harmless), which also removes the CSP-violation console spam.

## [v3.9.4] — 2026-05-30
### Fixed — Queue task-list interceptor now wraps XHR (superseded by v3.10.0)
- Rewrote `injectTaskListInterceptor` to wrap both `window.fetch` and
  `XMLHttpRequest` (Medicus loads the task list via Axios/XHR), read rows from
  `body.tasks`, and extract the task UUID robustly. Note: this was still injected
  inline and so remained CSP-blocked until v3.10.0 moved it to a MAIN-world
  content script. (`content-scripts/triage-lens/content.js`)

## [v3.9.3] — 2026-05-30
### Fixed — Queue monitoring chips never appeared (task-list never captured)
- The queue monitoring overlay captured task-row UUIDs by wrapping `window.fetch`
  only — but Medicus loads the task list via **Axios (XMLHttpRequest)**, so the
  task-list response was never seen, `ch-task-list-data` never fired, and no
  queue chips were ever injected (the side-panel Monitoring module worked because
  it uses a different data path). The interceptor now wraps **both** `window.fetch`
  AND `XMLHttpRequest`, mirroring the document-context interceptor. (`content-scripts/triage-lens/content.js`)
- It also now reads the rows from `body.tasks` (the actual Medicus task-list
  array key) in addition to `data`/`results`/`rows`/bare-array, and extracts the
  task UUID robustly (known `taskUuid`/`taskId`/`uuid`/`id` keys first, then a
  guarded scan of task/id-ish keys, never a patient id). Diagnostic `console`
  logging is emitted if the array or a row UUID can't be found, so any remaining
  shape mismatch is visible.
- The interceptor is now installed **early at content-script init** (not only in
  `runQueue`), because the task-list XHR fires during SPA navigation into the
  queue before `runQueue` runs — same fix already applied to the document-context
  interceptor. Idempotent via the `window.__chIntercepted` page-world guard.

## [v3.9.2] — 2026-05-30
### Changed — Monitoring overlays now flag "no monitoring on record" (red)
- A high-risk drug with **no recognised monitoring tests on record at all**
  (engine status `no_data`) is now surfaced as a **red** monitoring chip, across
  the queue, detail, and record overlays. Previously `selectMonitoringDue` only
  counted substantiated `overdue`/`stale`/`due_soon` and silently dropped
  `no_data`, so e.g. a patient on leflunomide with no FBC/U&E/LFT we could find
  produced no chip — arguably the most concerning case. (`content-scripts/triage-lens/content.js`)
- **Honest wording (no false "overdue"):** the per-drug detail names the
  *specific* tests with no value on record — e.g. *"Leflunomide — no recent BP,
  Weight"* — rather than a blanket "no bloods". This matters because some rules
  (leflunomide wants BP + weight, lithium wants TFT/calcium) include tests a
  practice may simply not code, so a patient with perfect FBC/U&E/LFT but no
  coded weight is described accurately instead of being mislabelled. Bare chips
  with no per-test breakdown fall back to "no monitoring on record".
- DMARDs covered by the monitoring ruleset: methotrexate, leflunomide,
  hydroxychloroquine, azathioprine, sulfasalazine (plus lithium, amiodarone,
  carbimazole/PTU, and others — 19 rules total in `rules/drug-rules.json`).
- Tests updated to lock the new behaviour: `no_data` now counts toward the chip,
  is always red, and its detail names only the missing tests. (`test-monitoring-chip.js`, 20 passing)

## [v3.9.1] — 2026-05-30
### Fixed — Triage Lens settings showed no options for newer chips
- Both the Triage Lens settings page and the content script fetch their chip
  defaults via `chrome.runtime.getURL('defaults.json')`, which resolves to the
  **extension-root** `defaults.json` — not `content-scripts/triage-lens/defaults.json`.
  The root copy had silently drifted (28 chips vs 35) across several releases
  because the drift test only guarded the triage-lens copy. As a result the
  settings page read stale defaults missing the document-context chips
  (`detail.docEntries/docUrgent/docAction`), the queue monitoring chips
  (`queue.monitoringDue*`), and `detail.docType/docSpecialty`. Synced the root
  copy to the canonical version and extended `test-triage-defaults.js` to assert
  the two stay identical (now 8 checks).
- **Document-body PDF request never fired:** `requestDocPdfText` referenced a
  bare `API` symbol that wasn't in scope (it is `window.SentinelApiClient`), so
  `detectMedicusContext` was never called and the request silently bailed. Now
  resolves `API` from `window.SentinelApiClient`, matching the queue path.

## [v3.9.0] — 2026-05-30

### Added
- **Triage Lens — document-body PDF text extraction (Phase 2).** Completes the
    body-extraction phase begun in v3.8.0 (Phase 1, phased rollout): the document
    body is downloaded as a server-converted PDF and parsed with PDF.js to extract
    its prose, which is fed into the EXISTING `detail.docUrgent` (red) and
    `detail.docAction` (amber) chips. No new chips were added — this is purely a
    new text source for the existing two.
  - **Architecture:** PDF.js runs in an MV3 **offscreen document**
    (`offscreen.html` / `offscreen.js`, reason `WORKERS`) because the service
    worker cannot run PDF.js reliably. The service worker resolves the file UUID
    via the document overview endpoint, downloads the PDF from the same Medicus
    api host the page already uses, forwards the bytes to the offscreen document
    for extraction, then closes the offscreen document.
  - **Default OFF / opt-in:** the PDF is fetched and parsed only when at least
    one of `detail.docUrgent` / `detail.docAction` is enabled (both default off).
  - **Ephemeral & private:** PDF bytes and extracted text live only transiently in
    the service worker / offscreen document / content-script `_docCtx`; they are
    never written to `chrome.storage` or any backup, and never leave the browser.
    Staleness-token guarded and bound to the current document (cleared on
    navigation) so prose from one document can never match on another.
  - **Graceful degradation:** scanned / image-only PDFs with no text layer, or
    documents whose server-side conversion is still pending/failed, yield no text
    and therefore no chip (never a false "all clear").

## [v3.8.0] — 2026-05-30
### Added — Document-context lens (Phase 1 of a phased rollout)
Triage Lens now surfaces the cheap JSON text already loaded when a GP opens a
document task (`/tasks/data/document/overview/{taskUuid}`), as HUD chips. This
is **Phase 1**: it uses only the data the Medicus SPA already fetches — the
filed care-record entries (`/clinical/document/entries/`) and the electronic
covering message (`inboundMessage` from `/document/modals/version/preview/`).
Extracting the document *body* PDF (`download-file`) needs PDF.js and is a
deliberate later phase — not touched here.

- New page-world interceptor `injectDocContextInterceptor()` passively wraps
  both `window.fetch` AND `XMLHttpRequest` (the document calls come through
  Axios/XHR, so a fetch-only wrapper would miss them) and re-dispatches the JSON
  text back to the content script as `ch-doc-entries` / `ch-doc-preview`
  CustomEvents. Guarded by `window.__chDocIntercepted`; installed once, early at
  init (the XHRs fire during SPA navigation into the document, before
  `runDetail`). No new network calls; nothing leaves the browser; the combined
  text is held only in an ephemeral in-memory variable and is never persisted to
  chrome.storage or any suite backup.
- Three new system chips (`detail.docEntries`, `detail.docUrgent`,
  `detail.docAction`), configurable in Triage Lens settings:
  - **Filed notes ×N** (info) — defaults **on**; purely descriptive, reflects
    coding already filed by the GP.
  - **Urgent: …** (red) and **Action: …** (amber) — both default **OFF**
    (opt-in), keyword-matched with a negation guard ("no", "not", "denies",
    "ruled out", etc.) to reduce false positives against the GP's own coding.
- Staleness token guard applied before any chip is injected to prevent
  wrong-document / wrong-patient display. If no text is available, no chip is
  shown (never a false "all clear").

## [v3.7.2] — 2026-05-29
### Fixed — Code-review fixes: document task lens + queue monitoring chips
**Document task lens (7 fixes):**
- `extractDocumentTaskInfo.getCardText` now delegates to the shared `findCardByTitle` helper (handles both `.m-card-v2` and legacy `.m-card`); previously the private selector returned empty strings on newer card markup
- `field()` now uses a line-anchored regex instead of `indexOf` — prevents `'Type'` matching `'Document Type'` or `'Author'` matching `'Authorisation'` mid-string
- `codes` extraction replaced lazy `[\s\S]*?suggestions` glob (could over-strip real coded items) with line-by-line `^…` replacements using the `m` flag
- Author-strip regex in `comments` now uses `^…` (multiline) anchoring and allows hyphens/apostrophes (`O'Brien`, `Al-Hassan`); also prevents false-positive matches on capitalised clinical terms followed by `•`
- `pageReady` now includes `findCardByTitle('Document Details')` — the most document-task-specific card and the most reliable render-complete signal
- Chip ordering when `detail.docType` is disabled: replaced `splice(1,0,...)` with a batch `unshift(...newChips)` so specialty chip always lands at position 0 when docType chip is suppressed

**Queue monitoring chips (8 fixes):**
- **Critical:** `refreshQueueChips` now calls `scheduleQueueMonitoring()` after each redecoration — previously AG Grid row recycling on scroll permanently destroyed monitoring chips
- **Critical:** `scheduleQueueMonitoring` now uses a generation counter (`_queueMonGeneration`) — when new task-list data arrives while a run is in progress, the running loop detects the stale generation and a fresh run starts on completion (previously new-data events were silently dropped)
- **Critical:** `runQueue` now clears `_queueRowUuids` before setting up the new queue, and prunes cache entries older than 2×TTL — prevents stale UUIDs from a previous queue injecting chips onto wrong rows
- `injectTaskListInterceptor` guard now relies entirely on `window.__chIntercepted` (the DOM `data-ch-interceptor` attribute was never matchable after immediate `s.remove()`); adds `{once:true}` `beforeunload` handler to clear the flag on SPA navigation that resets `window.fetch`
- UUID extraction now prefers `item.uuid` and `item.taskId` before `item.id` to avoid numeric surrogate-key false-positives; UUID regex anchored with `^…$`
- `_queueMonCache` entries now carry a `ts` timestamp; `scheduleQueueMonitoring` treats results older than 5 minutes as stale (forces recompute); `runQueue` prunes entries older than 10 minutes
- `computeQueueRowMonitoring` now logs each silent-failure path via the existing `log()` helper, making debugging possible when chips don't appear
- `clone.json().catch()` now logs a warning instead of swallowing parse errors silently

## [v3.7.1] — 2026-05-29
### Added — Triage Lens queue monitoring chips via fetch intercept
- Per-row **monitoring chips** on the AG Grid task queue, surfacing high-risk drug monitoring that is overdue (red) or due soon (amber) directly on each queue row. (`content-scripts/triage-lens/content.js`)
- Because AG Grid's JavaScript data model is opaque across the isolated-world boundary, row UUIDs are captured by injecting a page-world `<script>` element that intercepts `window.fetch` and watches for `/tasks/data/{slug}/task-list` responses; it fires a `CustomEvent('ch-task-list-data')` with the row UUIDs and task-type slug back to the content script.
- `runQueue` now calls `injectTaskListInterceptor()` (installs once per page load) and `scheduleQueueMonitoring()` (processes up to 8 rows per load with 200ms spacing). Results are session-cached per patient UUID so re-renders don't re-fetch.
- Two new system chips — `queue.monitoringDueRed` and `queue.monitoringDueAmber` — default **off** (these trigger a network request per row; users opt in via Options › System chips). (`content-scripts/triage-lens/defaults.json`, `content-scripts/triage-lens/options.js`)
- `refreshQueueChips` now also removes `.ch-q-mon` elements when AG Grid recycles rows, preventing stale chips on recycled row nodes.

## [v3.7.0] — 2026-05-29
### Added — Triage Lens document task lens
- The Triage Lens HUD now correctly extracts context from document task pages (`/tasks/data/document/overview/{UUID}`), which have a different card layout to regular tasks. (`content-scripts/triage-lens/content.js`)
- Introduced `isDocumentTask()` (URL test) and `extractDocumentTaskInfo()` which reads the four relevant `.m-card` elements: "Task Overview" (status/priority/created), "Document Details" (type/date/author/specialty), "Codes & Actions" (GP-coded items), and "Internal Comments" (admin routing notes).
- `runDetail` now branches on `isDocumentTask()`: document tasks use the new extractor to build `taskDetails` and `initialReq` from document metadata + internal comments + coded items; regular tasks continue to use the existing `extractTaskDetails` / `extractInitialRequest` path.
- Two new system chips — `detail.docType` (document type, e.g. "Clinical letter") and `detail.docSpecialty` (clinical specialty or sender) — are surfaced on document task HUDs, configurable in Options › System chips. (`content-scripts/triage-lens/defaults.json`, `content-scripts/triage-lens/options.js`)
- `pageReady` now also waits for the "Task Overview" card so document task pages are not polled prematurely.

## [v3.6.0] — 2026-05-29
### Added — Triage Lens "Monitoring due" overlay chip
- The Triage Lens HUD now surfaces a configurable **"Monitoring due"** chip on single-patient views (record / detail only — never the queue), flagging high-risk-drug monitoring that is overdue, severely overdue, or due soon, with what tests and how overdue. Click the chip for a per-drug breakdown. (`content-scripts/triage-lens/content.js`)
- The chip reuses the **Sentinel drug-monitoring engine** end to end: it calls `window.SentinelDataFetcher.fetchPatientData` and `window.SentinelRules.evaluatePatient` against the canonical `rules/drug-rules.json` and computes nothing clinical itself — it only filters the engine's `drug-monitoring` chips (status `overdue`/`stale`/`due_soon`) and formats them. Red when anything is overdue/severely overdue, amber when only due-soon.
- Toggleable per page/severity via four new system chips (`record`/`detail` × Red/Amber) that appear in **Options › System chips** with enable toggles; disabling a chip stops it fetching. (`content-scripts/triage-lens/defaults.json`, `content-scripts/triage-lens/options.js`)
- **Safety:** the chip is decision-support only — it reflects the rules engine's computed statuses from real observation data, ends every detail listing with "Decision support — verify against the record.", and emits NO chip if Sentinel is unavailable, the fetch fails, or there is no usable data (never a false "all clear", never a false "overdue"). An async staleness guard discards any result whose patient/page changed during the fetch, so a chip is never shown against the wrong patient.
## [v3.5.0] — 2026-05-29
### Added — Patient-record viewer LTC features
- **Monitoring-due card (Snapshot)**: surfaces high-risk drugs whose monitoring is overdue, with the required tests and the last monitoring date — showing "No record" in red where none is held (never invented) — or a green "all up to date" when nothing is due. (`visualiser-core.js`, `visualiser-core.html`)
- **Contacts calendar heatmap (Timeline)**: a year × month grid of dated consultation contacts using a colour-blind-safe single-hue Blues ramp, native cell tooltips, a legend, and an empty state; reuses the existing `computeTimeline` aggregation. (`visualiser-core.js`, `visualiser-core.html`)
- **Multimorbidity + Charlson Comorbidity Index (Snapshot)**: a Comorbidity card showing the LTC-register count and a flat-weight Charlson index (with the standard decade age banding and a negation guard against family-history / "no evidence" mentions); flags "age unknown" rather than assuming an age. (`visualiser-core.js`, `visualiser-core.html`)
- **Condition summary cards (Recalls)**: per-register cards for analyte-bearing conditions (diabetes/HbA1c, hypertension/systolic BP, CKD/eGFR) showing the latest tracked value, a mini-trend sparkline, the target, an on/off-target chip, and a shared review-due badge — or "no recent value" when no dated result exists. (`visualiser-core.js`, `visualiser-core.html`)
- Safety: all four features are deterministic and keyword-derived display-only decision-support; they flag missing inputs ("No record" / "no recent value" / "age unknown") instead of inventing clinical values, and the Charlson index carries no mortality-percentage mapping.

## [v3.4.2] — 2026-05-29
### Changed — Slots page number polish
- Aligned the Slots module's numeric styling with the rest of the suite: `font-variant-numeric: tabular-nums` is now set on every numeric class (hero total, AM/PM chips, per-type and per-clinician breakdowns), so digits sit in fixed-width columns. (`side-panel/modules/slots/slots.css`)
- Widened numeric column `min-width`s so 3-digit counts no longer break row alignment (`.slot-count-ampm` 18→24px, `.slot-count-total` 20→28px), and gave the expanded clinician detail total (`.staff-type-total`) a mono font, fixed width, and right alignment. (`side-panel/modules/slots/slots.css`)
- Normalised AM/PM count font-size to 12px across the hero chips, per-type rows, and per-clinician rows (previously 15/11/10px). (`side-panel/modules/slots/slots.css`)
- Hero total and header AM/PM counts now render via `toLocaleString('en-GB')` for thousands separators, matching the referrals and activity modules. (`side-panel/modules/slots/slots.js`)
- Each "By type" row now shows its share of the visible day total as a muted `%` annotation. (`side-panel/modules/slots/slots.js`, `side-panel/modules/slots/slots.css`)
- The slot alert ribbon now emphasises the count and pluralises ("3 slots remaining" / "1 slot remaining"). (`side-panel/modules/slots/slots.js`, `side-panel/modules/slots/slots.css`)

## [v3.4.1] — 2026-05-29
### Changed — Configurable feedback recipient
- The feedback button's recipient email is now configurable in **Options › Suite** (`suite.feedbackEmail`), saved alongside the practice code. The About-tab button reads it at send time and falls back to the default (`davetriska02@gmail.com`) when unset. (`options/options.html`, `options/options.js`, `side-panel/panel.js`)
- The setting is included in suite backup/restore (export, import, and preview). (`options/options.js`, `shared/io/suite-envelope.js`)

## [v3.4.0] — 2026-05-29
### Added — Feedback / feature request / bug report
- New **Feedback** section in the side-panel About tab. A type selector (Feedback / Feature request / Bug report), subject, and details compose a pre-filled email to the developer via `mailto:` — no GitHub account, login, or backend required. Suite version, browser, and timestamp are appended automatically as diagnostics. (`side-panel/panel.js`, `side-panel/panel.css`)
- The form carries an explicit warning not to include patient-identifiable information, and opens the email client via a transient anchor click so the panel is never navigated away.

## [v3.3.1] — 2026-05-29
### Removed — Triage Lens read-time chips
- Removed the "2m read" / "5m read" / "10m+ read" queue chips and the detail-page read-time chip. A word-count-bucketed reading estimate added no triage value and cluttered the queue. Dropped the chips, the `estimateReadTime` helper, and its callers. (`content-scripts/triage-lens/content.js`, `defaults.json`, `options.js`)

### Changed — Triage Lens defaults de-duplicated
- The system-chip defaults were maintained as a hand-written `SYS_CHIP_DEFAULTS` object that had to be kept in sync with `EMBEDDED_DEFAULTS` (and with `defaults.json`) by hand — the source of past green/amber drift. `SYS_CHIP_DEFAULTS` is now derived from the parsed `EMBEDDED_DEFAULTS`, so there is a single source of truth inside `content.js`.
- Added `test-triage-defaults.js`, which parses both `defaults.json` and the embedded copy and asserts they are identical, so the remaining file↔string duplication can't silently drift again.

## [v3.3.0] — 2026-05-29
### Added — Clinical Safety settings tab
- New **Clinical Safety** tab in suite settings. Sets out, in plain terms, that the software is built and released by a single GP developer on a best-effort basis, with a maintained clinical safety case but no warranty — a supplementary aid, not a medical device, and not a substitute for clinical judgement or the live record.
- Direct links to the full clinical safety case documents (Intended Purpose, Clinical Safety Notice, Hazard Log, Full Disclaimer & Terms). Links point to the public repository, which is regenerated weekly from the current codebase, so they always reflect the latest release and render as formatted markdown. (`options/options.html`)
- Drive-by fix: `button.ghost:hover` and the new doc-link hover referenced an undefined `--bg-hover` variable on the options page; switched to the defined `--bg-mid`.

## [v3.2.5] — 2026-05-29
### Fixed — time-based wording on non-time-based custom alerts
- Drug-combo, event-count, and composite alerts fire on presence / count / threshold, not on a recall interval, but `severityToStatus` mapped their severity onto the recall vocabulary — so a QTc-prolonging drug combination or a ">3 UTIs" count showed **"DUE SOON"** (amber) or **"OVERDUE"** (red), which is meaningless for a non-time-based flag.
- Introduced dedicated statuses for these alert types: `red → ALERT`, `amber → CAUTION`, `info → NOTED`. They keep the same red / amber / neutral colour and the same sort/filter ranking as their time-based peers, so nothing else changes — only the wording now reads correctly. (`engine/rules-engine.js`, `shared/chip-renderer.js`, `side-panel/modules/sentinel/sentinel.js`, `content-scripts/sentinel.js`)
- Added regression tests for the severity→status mapping and the new labels/colours/ranks. (`test-custom-rules.js`)

## [v3.2.4] — 2026-05-29
### Fixed — "Test connection" and "Check for updates" button styling
- Both buttons used a `.ghost` class that had no base CSS definition in `options/options.html`, causing the browser to render them as unstyled system buttons that clashed with the rest of the UI. Added a proper `button.ghost` rule matching the same font, weight, letter-spacing, border-radius, and padding family as `button.primary`. (`options/options.html`)

## [v3.2.3] — 2026-05-29
### Fixed / improved — alert library UX
- Added **"+ Add all"** button at the top of the alert library body. Shows a count of unadded entries; hides itself once everything has been added. (`sentinel-options/options.html`, `sentinel-options/options.js`)
- Fixed annoying auto-scroll when adding an individual library entry. The view now stays on the library list so the next entry can be clicked immediately — the newly added card still flashes in the rules section below, but the page no longer jumps to it. (`sentinel-options/options.js`)

## [v3.2.2] — 2026-05-29
### Changed — clearer wording for the "stale" recall status
- Clinicians found the "STALE" chip label confusing. Renamed the user-facing label for this status (data older than 2× the recall interval — a tier worse than overdue) to **"SEVERELY OVERDUE"** across the sentinel chips, in-page summary counts, evidence phrasing, and the rule-preview status dropdown.
- The internal status key (`stale`) is unchanged, so saved rules, filters, and backups are unaffected. (`shared/chip-renderer.js`, `side-panel/modules/sentinel/sentinel.js`, `content-scripts/sentinel.js`, `engine/rules-engine.js`, `sentinel-options/options.html`)

## [v3.2.1] — 2026-05-29
### Fixed — illegible sentinel evidence panels
- The sentinel chip evidence panel referenced CSS variables (`--surface-1/2/3`) that are not defined by the suite theme, so its background always fell back to a hard-coded dark colour. Under the default light theme this rendered dark `--text-*` colours on a dark background, making the evidence text unreadable when a chip was clicked.
- Remapped the panel, sparkline, and hover backgrounds to the real theme tokens (`--bg-elev`, `--bg-deep`, `--bg-hover`) so the panel is theme-aware and legible in both light and dark themes. (`side-panel/modules/sentinel/sentinel.css`)

## [v3.2.0] — 2026-05-28
### Added — chip provenance (click-to-see-evidence)
Side-panel sentinel chips are now clickable and surface the exact data the rules
engine matched to fire each alert. Clinicians can validate an alert before
acting on it — "this fired because <X happened on <date>>".

**Engine — `evidence` field on every chip:**
- Each evaluator now attaches `chip.evidence = { summary, facts[], refs?, series? }` built from the variables already in scope (no new data fetches). Shape is flat so one renderer handles all rule types.
- Drug-monitoring evidence: matched medication + start date; per-test name, last result + date + days-ago, interval threshold, status; "we looked for: …" rows for tests with no data; HRT context note when present.
- Drug-combo evidence: per-set matched drugs; patient age/sex; required problems matched (with coded date); excluded problems and `mustNotBePresent` list confirming none matched.
- QOF-indicator evidence: matched observation + value + date + days-ago, or "not found" with the search-terms list; threshold + operator + unit; QOF year / rolling window context; register precondition (which problem made the patient eligible); medication-present details.
- QOF-register evidence: register name + matched problem label + coded date.
- Event-count evidence: count vs threshold; window cutoff date; match/exclude terms; up to 15 matched items with date and raw value.
- Composite evidence: operator, "N of M sub-rules fired", per-sub-rule label + fired/not-fired status. Sub-rule refs are **clickable** in the panel — clicking drills into that sub-chip's own evidence (scroll + open).
- Observation-trend evidence: full point series (date + value, oldest → newest), delta, direction, span months, threshold.

**Renderer — `ChipRenderer.renderEvidencePanel(evidence)`:**
- New flat-list renderer in `shared/chip-renderer.js` used by all chip types.
- Inline SVG sparkline for observation-trend evidence — coloured by trigger direction (rising = red if rule is "rising"; falling = blue; steady = grey), tooltips on each point with date + value.
- Every clickable chip now carries `data-rule-id` + `data-evidence-key` + a small ⓘ affordance + `role="button"` / `aria-expanded`. Chips without evidence render exactly as before (backwards-compat).

**Side-panel sentinel module:**
- Inline panel appears directly under the clicked chip — no modal, no floating popover. Click to toggle, Esc to close, Enter / Space to activate from keyboard.
- Open state survives the 10-second poll re-render: the panel restores itself after each refresh as long as the chip is still in the snapshot.
- Composite sub-rule drill-through: click a fired sub-rule ref → previous panel closes, target chip opens, scrolls into view.
- One delegated click handler at the container level (idempotent across re-renders).
- Cleanup on module unmount removes document-level Esc handler and resets state.

**Scope of v1:**
- Side-panel + pop-out only. In-page sentinel HUD and full-tab visualiser unchanged (chip data carries `evidence` and they can adopt the renderer later without engine changes).
- No-data chips still render evidence ("we looked for X, found nothing").
- Inapplicable-chip leaks were closed in v3.1.8 first so the evidence panel lands on a clean baseline.

## [v3.1.8] — 2026-05-28
### Fixed — applicability filter audit (engine + bundled rules)
Pre-evidence-feature audit by adversarial agent. Closes silent filter holes
where rules could fire for clinically inappropriate patients.

**Engine — filter enforcement gaps closed:**
- `evaluateDrugRule` now applies `rule.sex`, `rule.ageRange`, `rule.requiresProblem`, `rule.excludesProblem`. Previously these schema fields were silently ignored — any user-added drug-monitoring rule with sex/age/problem filters fired universally.
- `evaluateQofIndicatorRule` now applies `rule.sex` (previously only `ageRange` was checked).
- `evaluateQofRegisterRule` now applies `rule.sex` and `rule.ageRange` (registers like cervical-screening-eligible / AAA-screen-eligible inherit applicability from the patient).

**Engine — `passesProblemFilters` helper with negation awareness:**
- New shared helper extracted from `evaluateDrugComboRule` and used by all evaluators. Substring matches on problem labels now reject negation/history prefixes: a problem labelled `"no heart failure"`, `"family history of heart failure"`, `"history of heart failure"`, `"resolved heart failure"`, `"at risk of HF"`, `"?heart failure"` no longer satisfies `requiresProblem: ["heart failure"]`.

**Engine — drug-combo distinct-meds guard:**
- When `drugSets` overlap (e.g. QTc-prolonging drug A and B share the same list), a single matched medication previously satisfied every set. Engine now requires the matched meds across sets to resolve to distinct medications (greedy assignment). Fixes `prescribing-qtc-combination` firing on monotherapy.

**Bundled alert library — applicability tightening:**
- `trend-1` Rising PSA trend: added `sex: "M"` and `ageRange: { min: 40 }`. Previously could fire on any patient with a PSA value recorded.
- `event-count-1` Recurrent UTI: added `"symptoms"`, `"luts"`, `"outflow"` to exclude so LUTS codes are not counted as UTI episodes.
- `pincer-9` Metformin renal: added combo brand names (`glucophage`, `janumet`, `komboglyze`, `eucreas`, `xigduo`, `synjardy`, `vipdomet`, `jentadueto`) — patients on combo products now get the annual eGFR monitoring alert.
- `pincer-12` Lithium + NSAID: added `["shampoo","topical","gel","cream"]` to Lithium drugSet exclude (guards against the rare lithium succinate shampoo formulation).
- `mhra-isotretinoin-ppg`: removed dead `"tretinoin oral"` match token (never appeared in formulary strings — `"isotretinoin"` / `"roaccutane"` cover oral retinoid prescribing).

## [v3.1.7] — 2026-05-28
### Fixed — final brand-name scrub + custom-rule card display
- `rules/alert-library.json`: renamed five `libId` values that still embedded vendor brand names (`ardens-1..4`, `pcit-1`) to neutral guideline-source slugs (`mhra-valproate-ppg`, `nice-lithium-monitoring`, `mhra-sglt2-dka`, `mhra-isotretinoin-ppg`, `prescribing-qtc-combination`). New adds from the library now generate clean rule IDs.
- `sentinel-options/options.js` `renderCrList` (drug-monitoring) and `ciRenderList` (qof-indicator): card titles now prefer `rule.label` / `rule.indicatorName` over `rule.id`. Already-stored rules with legacy brand-name IDs in user storage now show their human-readable label (e.g. "Lithium — monitoring overdue") instead of `custom-ardens-2-…`.

## [v3.1.6] — 2026-05-28
### Added — feature-list hotlink in About tab + weekly auto-generator
- New card at the top of the side-panel **About** tab linking to the latest `docs/feature-list.docx` on GitHub (raw download) and the Markdown source.
- `.claude/scheduled-tasks/weekly-feature-list.md` — prompt for a scheduled Claude Code on the web trigger that regenerates `docs/feature-list.md` and `docs/feature-list.docx` once a week. No-op commit when the feature surface hasn't changed (avoids weekly noise commits).
- Placeholder `docs/feature-list.md` shipped so the About link works immediately before the first scheduled run lands.

## [v3.1.5] — 2026-05-28
### Added — Alert Library alpha-feature acknowledgement gate
- Library cards are dimmed and `+ ADD` buttons inert until the user clicks "I understand — enable the library" on a warning banner.
- The banner explains that the bundled alerts are starter templates from published guidelines (PINCER / NICE / MHRA), have not been clinically validated, may match incorrectly, and that the user is responsible for reviewing each rule before clinical use.
- Acknowledgement is stored in `chrome.storage.local` under `sentinel.alertLibrary.acknowledged` — one-time, persists across sessions and re-renders.
- `storage.onChanged` listener picks up the flag from any window (so acknowledging in the side panel popout or one tab unlocks every open instance).
- Defensive: `addLibraryEntry` short-circuits and shows a toast if called before acknowledgement (e.g. via DevTools); the click is already blocked by `pointer-events:none` on the locked cards.

## [v3.1.4] — 2026-05-28
### Fixed — 6-agent code review of v3.1.2 (real bugs only)

**Alert library "+ ADD" silent failure (Nick's report):**
- `sentinel-options/options.js` `isAlreadyAdded`: now checks `entry.rule.label` and `entry.rule.indicatorName` in addition to `entry.title`. For composite-1 those strings differ, so the button never greyed out and the user got no visible confirmation that the rule had been added.
- Composite library entries with placeholder `ruleIds` (`custom-replace-with-…`) now show a follow-up toast warning that the composite must be edited to select the actual rules to combine.

**Drug-combo evaluator crash + false-positive:**
- `engine/rules-engine.js`: `set.match.some(...)` threw `TypeError` if any drugSet had no `match` array. Added `Array.isArray` guard.
- Empty/missing `drugSets` caused `[].some()` to return false, so the rule fired for every patient. Added early-return guard.

**Triage Lens (`content-scripts/triage-lens/content.js`):**
- `requestPanel`: read `rs.categories.length` but `computeRequestSignals` never returns `categories`. TypeError crashed HUD rendering on every detail page.
- `buildFieldsData`: `safe(data.meds.*, 'name')` looked for a `.name` property on raw strings — meds field was always empty, so methotrexate/lithium/anticoag rules never fired from the meds field.
- `refreshQueueChips`: disconnected the queue MutationObserver then re-attached only if it already existed, leaving it dead after any config change. Now delegates to `setupQueueObserver()` which handles both the initial-create and re-bind paths.
- Care-plan ACP check hardcoded `frailtyHits.length >= 3`; now uses configurable `TH('frailtyHitsRed')` for consistency with the amber arm.

**Referrals discovery (`content-scripts/referrals-discovery.js`):**
- `isDataResponse`: accepted empty arrays (`length >= 0`); first config-variant empty response was cached as the data endpoint, so the real one was never captured. Now requires at least one element.
- `captureUrl`: bare `fetch` with no abort signal; a slow server held the function indefinitely and racing scans could fire duplicate fetches for the same URL. Added 8s `AbortController` timeout and in-flight URL set.

**Sentinel content script (`content-scripts/sentinel.js`):**
- `setupNavWatcher`: patched `history.pushState`/`replaceState` without idempotency guard. On cached-page re-injection the wrapped function was wrapped again, firing `locationchange` twice per nav. Added `window.__sentinelNavWatcherInstalled` flag.
- `bootDataOnly`: `MutationObserver` on `document.body` was never stored, so re-injection stacked observers indefinitely. Now stored on window and gated.

**Capacity module (`side-panel/modules/capacity/capacity.js`):**
- `selfWriteInProgress` flag was set true before `await chrome.storage.local.set()`; a storage rejection left it stuck true forever, silencing all cross-window preset sync. Wrapped in `try/finally`.

**Submissions chart (`side-panel/modules/submissions/submissions.js`):**
- `parseTime` regex assumed `"HH:MM"` at end of string; ISO 8601 timestamps (Z-suffixed) bucketed every task to midnight or returned null entirely. Now handles ISO 8601 first.
- `parseDate` regex assumed `"DD Mon YYYY"` format; ISO dates returned null and every bucket stayed at zero. Now parses ISO `YYYY-MM-DD` prefix first.

**Side-panel XSS hardening (`side-panel/panel.js`):**
- `releaseUrl` from the GitHub releases API was interpolated unescaped into `innerHTML`; a spoofed `html_url` could deliver `javascript:` or markup. Now validates against `^https://github.com/` and escapes before injection. Added `rel="noopener noreferrer"`.
- Module-load error path: `err.message` was injected raw — escaped with existing `escStrip()` helper.

**Referrals stale-timestamp button (`side-panel/modules/referrals/referrals.js`):**
- The "Refresh?" button injected via `innerHTML` on staleness transition was never wired to a click handler. Clicking did nothing. Added `addEventListener` after the innerHTML write.

**Triage backup (`shared/io/triage-io.js`):**
- `chrome.storage.local.remove('config')` ran unconditionally on every import; the bare `'config'` key is a generic name that any future module might own. Gated on the key actually existing first.

**Chip renderer XSS (`shared/chip-renderer.js`):**
- `chip.points` was interpolated raw into the badge span. Custom rules validate it as a number, but `orgRules` skip validation. Now escaped.

**Service worker (`service-worker.js`):**
- Alarm handler called `pollRequestMonitor()` without `await` or `.catch()`; unhandled rejections silently dropped. Now logs failures.
- `chrome.notifications.create()` called without callback; notification-permission and runtime errors silently dropped. Added `chrome.runtime.lastError` check.

**Options page capacity preset (`options/options.js`):**
- `parseInt(value, 10) || 75` substituted the default if the user typed `0`. Replaced with `Number.isFinite` check so 0 is preserved (and rejected as invalid further down).

**Sentinel options composite-reference safety (`sentinel-options/options.js`):**
- Deleting any non-composite rule (drug-monitoring, qof-indicator, drug-combo, event-count) didn't check whether composites referenced it. Composites silently stopped firing and showed the raw deleted-rule id in the card meta. New `confirmDeleteWithRefs()` helper warns the user and lists every composite that would break before deletion proceeds.

**Custom-rules import (`sentinel-options/options.js`):**
- `crImportFile` appended every incoming rule without running `validateCustomRule()`; malformed input corrupted storage and the next backup/restore cycle threw. Now validates each rule individually, reports rejected entries to the user, and only persists valid ones.

**Event-count edge cases (`engine/rules-engine.js`):**
- `(rule.windowMonths || 12)` accepted 0 → window collapsed and rule silently never fired. Now requires positive finite value.
- Unknown `operator` value (typo like `==`) silently left `fires=false`. Now logs a warning so misconfigured rules are visible in DevTools.

**Source attribution (rules/alert-library.json + sentinel-options):**
- All `source` fields and library subtitle now reference upstream guidelines (PINCER, NICE, MHRA, crediblemeds.org) directly. Ardens and Primary Care IT references removed across alert library, options.js `sourceBadgeClass`, and options.html CSS.

## [v3.1.2] — 2026-05-28
### Maintenance — remaining nits from the 4-agent code review
- `engine/normalisers.js`: extracted `keyToIsoDate(key)` helper to eliminate duplicated `dataYYYYMMDD` slice offsets between `normaliseObservations` and `normaliseObservationHistory`. One place owns the format assumption now.
- `engine/normalisers.js`: documented that `observationHistory[].history[].value` is numeric (parseObservationValue output), unlike `observations[].value` which is a display string with unit. Future maintainers won't trip on the type difference.
- `engine/normalisers.js`: replaced `localeCompare` date sort with plain string comparison — ISO YYYY-MM-DD sorts lexicographically identical to chronologically, without any risk of locale-collation surprises.
- `engine/rules-engine.js`: documented the 30.4375-days-per-month window arithmetic in `evaluateEventCountRule` — explains why event-count windows are approximate (not calendar-aligned) and consistent with observation-trend, but different from drug-monitoring's `daysBetween`.
- `engine/rules-engine.js`: documented inclusive boundary semantics on the event-count window.
- `engine/rules-engine.js`: documented `minDelta: 0` default semantics on observation-trend (means "any movement in named direction fires"; flat lines blocked by the strict-inequality direction check).

### Functional changes
None — pure code clarity and maintainability pass.

## [v3.1.1] — 2026-05-28
### Fixed
Four-agent code review of v3.0/v3.1 turned up real bugs. All fixed in this patch.

**Trend evaluator (v3.1.0 bugs):**
- `observation-trend` rule used `.find()` to pick a history series — would silently pick the first match if multiple existed (e.g. "PSA" and "PSA free/total ratio"). Now uses `.filter()` and picks the series with the most data points.
- Flat-line readings (delta = 0) used to fire as a "rising" trend because `0 >= 0` was true. Now requires strict directional movement: rising needs `delta > 0`, falling needs `delta < 0`. Combined with the existing `minDelta` check.
- `!isNaN(pt.value)` let `Infinity` through. Now `isFinite()` — matches author's stated intent.

**Side-panel rendering (v3.0 carryover):**
- `event-count`, `drug-combo`, and `composite` chips were computed correctly but **never rendered** in the side panel — they weren't in `typeOrder`, so any GP using the v3.0 alert library was seeing nothing for those types. Added them under labels "Recurrent Events", "Drug Combinations", "Composite Alerts".
- `shared/chip-renderer.js`: added `renderDrugComboChip`, `renderEventCountChip`, `renderCompositeChip`. Surfaces drug-set summary, count vs threshold, fired-rules count.
- `content-scripts/sentinel.js` `chipHtml`: new branches for the three chip types, delegating to the shared renderer.
- `manifest.json`: added `shared/chip-renderer.js` to content_scripts so the delegation actually resolves.

**Value parsing edge cases:**
- `parseObservationValue` now strips Unicode `≤` and `≥` operators (not just ASCII `<` / `>`). A PSA recorded as "≥10" was silently NaN before.
- European comma-decimal `"3,5"` → 3.5 instead of silently truncating to 3.

**Mock / error paths:**
- `MOCK_PATIENT` now includes a 4-point HbA1c history so trend/event-count rules are actually testable in mock mode.
- `fetchPatientData` error fallback now includes `observationHistory: []` for consistency with all other return paths.

### Backward compatibility
Four-agent review confirmed zero regressions. All v3.0 and earlier rule types (drug-monitoring, qof-register, qof-indicator with the three pre-existing check kinds, drug-combo with `sourceKind: "problems"`) evaluate through unmodified code paths.

## [v3.1.0] — 2026-05-28
### Added — Multi-point observation history
The observation-history extractor that v3.0 alerts depended on. Two alert types that previously always returned "no data" now actually fire:

- **`observation-trend` rules** (Rising PSA, falling eGFR, etc.) — now evaluates the last N observations within a configurable window and fires when the direction matches with optional minimum delta.
- **`event-count` rules with `sourceKind: "observations"`** (e.g. "≥4 abnormal LFTs in 12 months") — now counts real historical observations instead of just the latest.

### Under the hood
- `engine/normalisers.js`: new `parseObservationValue()` helper handles `<5`, `120/80` (takes systolic), text values, etc. New `data.observationHistory` array surfaces every recorded date for every investigation type, newest-first. `data.observations` (latest-only) unchanged for backward compat.
- `engine/data-fetcher.js`: wires `observationHistory` through to the engine's evaluation context.
- `engine/rules-engine.js`: `evaluateEventCountRule` (observations branch) now uses real history; `evaluateQofIndicatorRule` `observation-trend` branch implements first-vs-last comparison (last-in-window vs newest), checks `minPoints`, `minDelta`, and `direction`. BP-style values use systolic for trend calc.
- `content-scripts/sentinel.js`: passes `observationHistory` to the engine in both evaluation paths.

### Still coming — consultation-diagnoses extractor
The feasibility scout found that the existing patient-journal endpoint already returns consultation-level coded entries — `fetchJournalObservations` in `content-scripts/sentinel.js` just filters them out at the `entryType === 'observation'` check. To enable "≥3 UTIs coded in consultations in 12 months" we need to know the exact `entryType` value Medicus uses for a coded diagnosis (likely `'problem'`, `'diagnosis'`, or `'coded-entry'` — needs one real network capture to confirm). Tracking as v3.1.1 / v3.2.

## [v3.0.0] — 2026-05-28
### Added — Alert Builder UI (v3.0 headline feature)
The user-facing half of the alert builder. Combined with the v2.6.0 backend, GPs can now browse a curated library of 22 starter alerts (PINCER + Ardens + MHRA + PCIT) and one-click add them, or build their own alerts from scratch via dedicated form sections — no JSON editing.

- **Alert Library panel** at the top of Settings → Monitoring → Custom Rules. Collapsed by default. Cards grouped by category (Prescribing safety, Drug monitoring, Recurrent events, etc.) with colour-coded source badges. Click [+ Add to my alerts] to copy a starter alert into your custom rules — editable afterwards. Already-added alerts show "✓ Added" and the button greys out.
- **Drug-Combo Alerts** section — build rules like "Warfarin + NSAID concurrent" using repeating drug-set cards. Patient filters (age min/max, sex, requires/excludes problem) collapsed behind a chevron to keep the common case clean.
- **Event-Count Alerts** section — build rules like ">3 UTIs in 12 months for female <65". Source-kind toggle (Problems / Observations) with inline warning explaining the observation-history caveat.
- **Composite Alerts** section — combine other custom rules via AND/OR. Multi-select listbox of all your non-composite rules; blocks selecting a composite (no recursion).
- **Observation-trend** check kind added to the QOF Indicator form (4th radio: Rising/Falling, min data points, within months, optional min delta).
- **Smart routing** — clicking [+ Add] from the library scrolls to the right section's list and briefly flashes the new entry so users find it.

### Coming in v3.1
- Consultation-diagnoses extractor (needed for accurate recurrent-acute-condition alerts like recurrent UTI from coded encounter diagnoses, not just problem list)
- Multi-point observation history (needed to make observation-trend and event-count-on-observations fire meaningfully)

## [v2.6.0] — 2026-05-28
### Added — Alert builder backend (rules engine + library)
Backend foundation for the v3.0 user-configurable alert builder. UI to follow.
- **Three new rule types** in `engine/rules-engine.js` and `shared/io/sentinel-io.js`:
  - `drug-combo` — fires when patient is concurrently on drugs from N sets you define, with optional age/sex/problem filters. Covers PINCER prescribing-safety patterns (warfarin + NSAID, beta-blocker in asthma, etc.). Optional `mustNotBePresent` field for "drug X present AND drug Y absent" patterns (e.g. NSAID without PPI).
  - `event-count` — fires when N matching items in problems (or observations) within a time window meet a threshold. Covers ">3 UTIs in 12 months" style alerts. (Observation history limited to latest per test until v3.1 adds history endpoint — chips note the caveat.)
  - `composite` — fires when other rules combine via AND/OR. Composite rules cannot reference other composites (recursion guard). Missing referenced rules are skipped silently.
- **New check kind `observation-trend`** under `qof-indicator` for rising/falling trends across N observations. Emits `no_data` until observation history endpoint lands.
- **`rules/alert-library.json`** — 22 curated starter alerts:
  - All 13 PINCER prescribing-safety indicators
  - 5 Ardens / MHRA entries: valproate pregnancy prevention, lithium monitoring, SGLT2 + DKA awareness, isotretinoin PPP, dual antiplatelet
  - 1 Primary Care IT QTc-prolonging combination
  - 2 event-count examples: recurrent UTI (≥3 in 12mo, female <65), recurrent falls (≥2 in 12mo, age ≥65)
  - 1 composite template, 1 observation-trend (rising PSA)
- Engine helpers added: `severityToStatus()`, `passesAgeFilter()`, `passesSexFilter()`. New module-level constants for valid severities, sexes, operators, and source kinds.

## [v2.5.1] — 2026-05-28
### Added
- **Manual "Check for updates" button** in Settings → Suite. Previously the extension only checked GitHub for new releases once every 24h on its own schedule; now you can force a fresh check on demand. Button shows current state (up to date / update available / last check failed) and how long ago the last check ran. Bypasses the 23h cooldown when clicked.

## [v2.5.0] — 2026-05-28
### Added — Practice Profile (shared-folder managed deployment)
- New **Practice Profile** system for practices running the extension from a shared network folder. Drop a `practice-profile.json` file into the extension folder alongside the other files and it propagates default settings automatically to every PC that loads the extension — no manual steps for users after initial install.
- **Service worker** reads the profile on every browser start (`onInstalled` + `onStartup`). If `profileVersion` has changed since it was last applied, new settings are merged/applied automatically.
- **Three apply modes** controlled by the practice admin in the JSON file:
  - `mergeMissing` (default) — only writes settings the user hasn't already configured; safe, never overwrites user customisation
  - `forceOverride` — always replaces — use to push a mandatory rule change to all users
  - `firstRunOnly` — seeds new installs only; ignores version bumps after first apply
- **Settings → Backup & Restore** now shows a Practice Profile card: file status, version last applied, timestamp, and whether an update is available. Buttons: *Check for update*, *Apply now* (manual force), and **Generate profile from current settings** — configure one PC exactly how you want then generate a ready-to-use `practice-profile.json` in one click.
- **Full setup guide** embedded in a collapsible panel in the Settings page: step-by-step instructions for creating the file, editing the header, choosing a mode, pushing updates, and first-time install on each PC.
- Desktop notification (silent, one per version) when a new profile version is applied, if the admin enables `notifyUserOnApply`.
- Application history stored in `suite.practiceProfile` (last 10 applies) for auditability.
- New file `shared/io/practice-profile.js` — self-contained, loads in both service worker and options page contexts.

## [v2.0.5] — 2026-05-28
### Added
- Settings → Suite tab now includes a "Support development" card with a Buy Me a Coffee link (`buymeacoffee.com/davetriska`). Short note explaining the suite is built in spare time and given away free, AI tokens cost money out of pocket, and 100% of donations go straight back into development. Card sits at the bottom of the Suite section so it's visible from the default landing tab but never gets in the way.

## [v2.0.4] — 2026-05-28
### Changed
- Thematic alignment: Sentinel/Monitoring options (`sentinel-options/`), Triage Lens options (`content-scripts/triage-lens/options.*`), and Patient Record Visualiser (`visualiser-core.*`) all now follow the global `suite.display` theme/size/colour-blind preference, matching the light-default main panel. Each page reads `suite.display` on load and listens for live storage changes so toggling in the main panel takes effect immediately without a reload.

## [v2.0.3] — 2026-05-28
### Fixed
- Settings page and pop-out window now follow the theme/size/colour-blind preference set in the main panel. Both were still hard-coded to dark. Settings page `:root` changed to light palette with `[data-theme="dark"]` override; pop-out boot now reads `suite.display` from storage before loading the first module. Both also react live if you toggle the preference while they are open.

## [v2.0.2] — 2026-05-28
### Fixed
- Levothyroxine monitoring chip now correctly labels the test as **TSH** rather than **TFT**. The recorded value Medicus surfaces is the TSH number alone (full TFTs aren't routinely run for stable replacement), so the previous "TFT · 3.2" was misleading. Match terms still cover TSH/TFT/thyroid function so existing observations continue to be detected. Notes updated to reflect TSH-only monitoring per NICE NG145.

## [v2.0.1] — 2026-05-28
### Added
- HRT monitoring chip now surfaces progestogen coverage context for oestrogen-triggered chips:
  - **Hysterectomy recorded** → green line "Hysterectomy — progestogen not required"
  - **IUS in situ** (Mirena, Levosert, etc.) → green line "IUS in situ — Mirena 52mg"
  - **Oral/patch progestogen** (Utrogestan, norethisterone, etc.) → green line "Progestogen: Utrogestan"
  - **None of the above** → amber warning "No progestogen or hysterectomy recorded" — flags potential unopposed oestrogen
  - Context only shows on oestrogen-triggered chips; IUS/progestogen-only chips (standalone prescriptions) are unaffected.

## [v2.0.0] — 2026-05-28
### Changed
- **Light mode is now the default theme.** Dark mode remains available as an option. The CSS variable baseline (`:root`) is now the light palette; dark mode is applied via `[data-theme="dark"]` override.
- Display settings (theme, text size, colour-blind mode) moved from the Monitoring module into the main suite nav bar — a sun ☀ icon appears in the top-right, visible on all tabs. This was previously only accessible while on the Monitoring tab.

### Added
- v1.11.0 features are carried forward unchanged (HRT IUS recognition, display prefs).

## [v1.11.0] — 2026-05-28
### Added
- Display preferences for the entire panel, accessible via the ⚙ button in the Monitoring header. Settings persist to `suite.display` storage and apply immediately:
  - **Light / Dark theme** — full light-mode palette with appropriate contrast ratios for clinical use in bright rooms.
  - **Text size S / M / L** — scales the whole panel via CSS zoom; S = 85%, M = 100% (default), L = 125%. Resolves legibility issues on high-DPI screens or for users who need larger text.
  - **Colour-blind mode** — replaces red (→ orange #ea580c) and green (→ blue #2563eb) globally across all chips, badges, and test rows. Designed for the most common deuteranopia/protanopia profiles.
- HRT monitoring rule now recognises Mirena coil / LNG-IUS (Mirena, Levosert, Jaydess, Kyleena, levonorgestrel intrauterine system). Patients with an IUS documented as a medication will now show the annual HRT review chip, correctly reflecting its role as the progestogen component of HRT in perimenopausal women using systemic oestrogen.

## [v1.10.0] — 2026-05-28
### Added
- Slot Counter now visually distinguishes AM from PM appointments. Under the day-total hero are two chips — `AM 14` and `PM 9` — and every "By type" and "By clinician" row shows the same breakdown inline (`8 am · 4 pm · 12`). Lets a clinician see at a glance whether the day still has morning capacity, afternoon capacity, or both, instead of just a single combined number. AM is `startDateTime` hour < 12; PM is 12:00 onward.

## [v1.9.0] — 2026-05-28
### Fixed
- Settings page version badges now read the live extension version instead of a hard-coded `v1.4.2` that had not been updated since the first release.
- Triage Lens custom settings are no longer wiped on suite restore when the backup file pre-dates the user's customisations. Previously, importing a suite backup containing `triage: {config: {}}` would overwrite `triagelens.config` with `{}`, deleting the user's rules. `triageImport` now skips writes for empty config objects.

### Changed
- Suite-scope import preview now lists every known module — present ones show their content, absent ones explicitly say `— not in this backup`. This clears up the confusion where Request Monitor and Triage Lens looked "missing" from a restored backup just because they pre-dated those modules being wired into suite-level export (the data was simply not in that backup file). Per-module scope previews are unchanged.
- Preview line for envelope's extension version now reads `Backup created with extension version: v1.6.0` rather than the bare `Extension version: v1.6.0`, to distinguish it from the currently-installed version.

## [v1.8.9] — 2026-05-28
### Added
- HbA1c chips now show the value with unit: e.g. `NOT MET · 62 mmol/mol · 12 Mar 2025`. Applies to DM020 (≤58, non-frail), DM021 (≤75, frail), and the retired DM007/DM008 rules. Previously the number appeared without unit, making it ambiguous to the clinician.
- Non-HDL / LDL cholesterol chip (CHOL004) now shows the value with unit: e.g. `MET · 2.4 mmol/L · 12 Mar 2025`.
- Engine: `observation-threshold` rules can now declare a `"unit"` field in their check definition; the engine appends it to `valueText` automatically. Custom rules created in the Options page can use this field too.

## [v1.8.8] — 2026-05-28
### Added
- Monitoring chips now show the recorded value, not just the date. For drug-monitoring tests (U&E, LFTs, etc.) the latest result appears between the status badge and the date: e.g. `IN DATE · 4.5 · 12 Mar 2025 · 89d`. For QOF `observation-recent` indicators (HRT review, BMI, smoking status, etc.) the value appears beside the date too — closing the gap where in-date chips showed _when_ but never _what_. Values are trimmed and capped at 30 characters to stay on one row.

## [v1.8.7] — 2026-05-28
### Fixed
- Monitoring (Sentinel) panel now auto-refreshes the instant the patient changes. Content script broadcasts `sentinel:snapshot-updated` after every re-evaluation; side panel re-renders on receipt instead of waiting up to 10 s for its poll.
- Removed the `document.visibilityState` guard on the sentinel refresh path — Chrome was marking the side panel hidden while the user clicked in the main tab, silently skipping auto-refreshes. The refresh is just IPC (no API call), so the guard wasn't saving anything.

## [v1.8.6] — 2026-05-27
### Fixed
- Request-monitor infinite loop: `chrome.storage.onChanged` listener no longer reacts to writes the poller itself makes (`state`, `notifMap`). Only true user-config changes trigger re-initialisation.
- Request-monitor double-poll on every re-init: removed the synchronous `pollRequestMonitor()` that fired alongside the alarm's immediate-trigger.
- Request-monitor concurrent-write race: `shared/request-monitor.js` now deduplicates in-flight Promises so the service-worker alarm path and the side-panel UI path share a single poll.
- Sign-in (401/403) no longer burns API calls indefinitely: poller pauses for 5 minutes on auth failure and clears when the user changes config.
- `engine/api-client.js` patient-data fetch: concurrent calls for the same patient now share a single in-flight Promise, eliminating redundant network requests on rapid SPA navigation.
- `content-scripts/sentinel.js` `fetchJournalObservations`: added 8-second `AbortController` timeout (other endpoints already had this via `safeFetch`).
- `shared/medicus-api.js` scheduling cache: keyed by practice code, so switching practices no longer serves stale data from the previous practice.
- `content-scripts/referrals-discovery.js`: diff before write — no longer writes storage on every page load when discovered data is unchanged.
- Submissions module: anonymous `chrome.storage.onChanged` listener was never removed in cleanup, accumulating one listener per tab switch. Now uses a named reference removed in `cleanup()`.
- Side-panel `switchModule` tab-switch race: previous module's in-flight fetch could overwrite the new module's DOM. Added a monotonic `switchSeq` guard and explicit cleanup before clearing `content`.
- Capacity module double-fetch on preset save: `savePreset` and `onStorageChange` both triggered `loadVisibleDates`; guarded with a `selfWriteInProgress` flag.
- SubRag strip `setInterval` return value was discarded; timer ID is now stored.
- Update-checker now sends `If-None-Match` ETag header and writes `checkedAt` on 403 (rate-limit) so the 23-hour cooldown engages correctly.
- Request-monitor notification map: clicked notifications are now removed from `suite.requestMonitor.notifMap`, preventing the map drifting toward its 50-entry cap with dead entries.
### Changed
- Sentinel module: poll interval slowed from 3 s to 10 s; skips polling when `document.hidden`.
- Side-panel demand strips (WR / RM / SubRag): skip polling when the panel is not visible (`document.visibilityState !== 'visible'`); refresh immediately on visibility return.
- Slots / activity / referrals / submissions refresh buttons: disabled during in-flight fetches to prevent rapid-click concurrent fetches racing on shared module state.

## [v1.8.5] — 2026-05-27
### Fixed
- Backup gaps: `referrals.*`, `popout.activeModule`, `suite.requestMonitor.*` now captured in full-suite export/restore.
- `submissions.config` no longer overwritten with a partial object when saving practice code.
- Pusher `waiting:refresh` no longer fires twice per appointment update.
- Referrals discovery messages now properly handled; live updates work.
- Sentinel module: module-level `document.addEventListener('click', …)` moved into `init()` and removed in `cleanup()` — eliminates listener accumulation on module reload.
### Removed
- `side-panel/modules/triage/` directory deleted (module decommissioned in v1.5.3; files were left behind).
- `shared/waiting-room-api.js` deleted (logic duplicated inline; no consumers).
- Legacy `config` storage key removed during triage migration.

## [v1.8.4] — 2026-05-26
### Changed
- Side-panel demand banner (`#rmStrip` — medical/admin request alerts): increased size by ~25% (padding, font-size, pill dimensions) for improved legibility.

## [v1.8.3] — 2026-05-26
### Fixed
- Activity tab: relabelled "Urgent Rx" to "Non-routine" in legend and column headers to match the field's actual meaning (non-routine prescription requests).

## [v1.8.2] — 2026-05-26
### Fixed
- Capacity Forecast: Options page preset editor now exposes per-weekday minimums (Mon–Sun) instead of the legacy single "Daily minimum" field, matching the side-panel editor. Editing a preset from Options previously collapsed all weekdays to one number, silently overwriting any per-day settings.
- Options page preset cards now summarise minimums the same way the side-panel does (`Min N/weekday` when uniform, otherwise `Min N/week`).
- Saving a preset from Options now stores `minimumByDay` and drops the legacy `minimumPerDay` field; existing presets are migrated on edit by spreading their old `minimumPerDay` across Mon–Fri.

## [v1.8.1] — 2026-05-22
### Changed
- Monitoring tab moved to second position in nav (immediately after Slots) in both side panel and pop-out

## [v1.8.0] — 2026-05-22
### Added — Visualiser Tier 2 & Tier 3 (filters, swim-lane, eFI, drugs, PINCER, QOF review)
Substantial follow-up to v1.7.0. Continuity view scroll/filter problem fixed by giving every tab a single shared filter model; Timeline replaced with a true D3 swim-lane; engine-layer features added for frailty, polypharmacy, prescribing safety and review compliance.

#### Global filter bar (every tab)
- **Date-range brush** above the tab content — D3 brush over the full record's date extent, plus `All / 5y / 3y / 1y` preset buttons. The brush *is* the filter — all tabs re-render against the selected window. Solves the "ribbon is rainbow noise with 1029 consults squashed in 900px" problem from v1.7.0.
- **Clinician filter** — single-select dropdown listing every practitioner with their entry count. Hard-filters the entry stream; bars, ribbon, swim-lane all collapse to just that clinician.
- **Problem spotlight** — single-select dropdown listing every active and past problem. Does NOT hard-filter; instead highlights matching entries in the swim-lane (others dimmed), and the "what's new" / Active Problems list.
- Active problems on the Snapshot tab are now clickable — click to spotlight that problem across all views (toggles).
- Clinician bars on the Continuity tab are clickable; click any practitioner row, bar, or ribbon-legend swatch to set the clinician filter. Click again to clear.
- Register cards on the Registers tab are clickable — click a register to spotlight that condition across the swim-lane, snapshot etc.
- `Clear` button resets everything; `Showing N of M entries` summary stays live.

#### Timeline tab — D3 swim-lane
- Replaced stacked-bar + monthly heatmap with a horizontal swim-lane: one lane per bucket (consultation, communication, investigation, document, note, recall, referral), one dot per event, scaled to the filtered date range.
- Hover any dot for a tooltip showing date / type / practitioner / code / linked problems. Click a dot to spotlight its first linked problem across all tabs.
- Problem spotlight: matching events get a 2px orange stroke; others fade to 0.18 opacity, so the story of "everything that happened for diabetes" is immediately legible.
- Lanes with zero events in the current selection are auto-hidden. Volume-by-year bar chart preserved underneath for quick "which years were busy".

#### Investigations tab — sortable, filterable Latest values
- Text filter ("Filter analyte name…") — debounced live filter without re-rendering the whole tab; preserves input focus.
- "Only abnormal" toggle — filter to high/low rows only.
- Click any column header to sort by analyte / value / flag / Δ / date; click again to flip direction. Sort glyphs show current state.
- Click any row to open that analyte in the trend chart above (auto-scrolls to it).

#### Medications & Monitoring (new tab)
- 14-drug high-risk panel (methotrexate, azathioprine, lithium, amiodarone, warfarin, DOACs, ACEi/ARB, loop / thiazide diuretics, long-term NSAIDs, statins, digoxin, levothyroxine, metformin, strong opioids).
- Per drug: last-seen date, occurrences in record, last monitoring test date, days since monitoring, overdue badge based on NICE / BNF recommended intervals (e.g. methotrexate FBC/U&E/LFT every 3 months).
- Stats row: total drug families seen / active in last 18m / monitoring overdue / PINCER flags.
- Detection: regex scan of each entry's body + code text — caveat banner explains this is a screen, not a definitive medication review.

#### Snapshot — eFI gauge + PINCER red flags
- **Electronic Frailty Index (eFI)**: 36-deficit Clegg index computed from the problem list, with polypharmacy taken from the drug detector. Semicircle gauge coloured by category (Fit / Mild / Moderate / Severe). Shows count, score (0.00–1.00) and first 4 ticked deficits.
- **PINCER-style flags card**: applies drug-disease and monitoring-overdue rules (NSAID + CKD, NSAID + heart failure, NSAID + oral anticoag, beta-blocker + asthma, ACEi/ARB + CKD with overdue U&E, every overdue high-risk drug monitor). Shown with red border when flags present; green border + "no flags detected" otherwise. Full list also on the Medications tab.

#### Registers & Recalls — last-review enrichment
- Every QOF register card now shows "Last review: 17 Mar 2026 · 6m ago" with green / amber / red badge based on the recommended review interval (12m for most, 6m for cancer, 3m for palliative care).
- Cards sort overdue-first; overdue registers get an orange left border.
- Click a register card to spotlight its condition across the rest of the visualiser.

#### Internals
- `_s.filter` shared state — `dateFrom`, `dateTo`, `preset`, `clinician`, `problem`. Hard filter for date+clinician; spotlight for problem.
- `filteredEntries()` helper; `rebuildAll()` recomputes analytics under filter and re-renders every tab. Called from buildApp on load and from every filter change.
- `computeEFI`, `computeDrugMonitoring`, `computePINCER`, `enrichRegistersWithReview` engine functions.
- Tab switch + window resize re-render the swim-lane so it picks up the correct width when the tab becomes visible.

## [v1.7.0] — 2026-05-22
### Added — Visualiser Tier 1 clinical-UX upgrades
Five evidence-led upgrades drawn from a multi-agent research pass (Plaisant Lifelines2, Epic Results Review, KDIGO 2024, NICE NG28/NG136, RCV literature PMC10197470, JAMIA four-techniques study). Each chosen for high clinical value at low build cost.

- **"What's new since last consultation" card** on the Snapshot tab. Identifies the most recent face-to-face consultation, lists every event dated after it, groups by bucket, and flags any investigation with abnormal results. The first thing a GP wants to see before consulting.
- **Practitioner ribbon** on the Continuity tab. Thin band of cells (one per consultation, left = older → right = newer) coloured by practitioner; a second strip below shows days since previous contact (height-encoded, capped 90d). Long gaps surface as wide bars; fragmented care shows as a rainbow run; continuity shows as a monochrome run.
- **Reference Change Value (RCV) delta flags** on the Latest values table. New "Δ vs prior" column; arrow doubles and turns red when the inter-result change exceeds the analyte's literature RCV (creatinine 14%, eGFR 14%, HbA1c 12%, Hb 8%, Na 1.3%, K 5%, TSH 45%, etc.).
- **Inline sparklines** on the Latest values table. 70×20 SVG polyline per analyte, with the reference band shaded in green and the last-point dot coloured red when out of range. Trend direction now scannable without expanding a chart.
- **Clinical zone bands on the analyte trend chart**. Replaces the flat reference lines with KDIGO-staged eGFR zones (G1→G5), NICE/QOF HbA1c thresholds (normal / pre-diabetes / target / suboptimal / poor control), and NICE BP staging. Falls back to a translucent reference-range band for other analytes. Y-axis padded to include the reference range so abnormals visually escape it (lab-UX anti-pattern fix). Out-of-range data points rendered in red.

## [v1.6.4] — 2026-05-22
### Fixed
- **pdf.worker.min.js was corrupted**: in v1.6.3 the worker source was extracted with `awk` from a JS template literal (`` var _workerSrc = `...` ``), so the file ended up containing literal `` \` ``, `\${`, and `\\` escape sequences instead of the real `` ` ``, `${`, `\` characters. Browser threw `Uncaught SyntaxError: Invalid or unexpected token`, pdf.js fell back to fake-worker mode, `WorkerMessageHandler` never materialised, and text extraction died with "Cannot read properties of undefined". Re-extracted the worker by evaluating the template literal in Node so all escape sequences collapse correctly. All four vendor files now parse cleanly under `new Function(...)`.
- Use `chrome.runtime.getURL('vendor/pdf.worker.min.js')` for `GlobalWorkerOptions.workerSrc` so pdf.js loads a real Worker (fast) instead of the "fake worker" fallback. Falls back to a relative URL if `chrome.runtime` isn't present.

## [v1.6.3] — 2026-05-22
### Fixed
- **Visualiser actually runs now**: extracted all inline `<script>` blocks (pdf.js, Chart.js, D3.js, worker setup, app code) to external files under `vendor/` and `visualiser-core.js`. Under MV3 the default extension-page CSP is `script-src 'self'` — inline scripts were silently blocked, so no JS ran at all and the file picker had no `change` handler attached. The pdf.js worker is now shipped as `vendor/pdf.worker.min.js` and loaded by relative URL, so no `blob:` URLs and no `eval`.
- Cleaned up the embedded-as-string worker bootstrap (the old `Blob` + `URL.createObjectURL` dance) — no longer needed.

## [v1.6.2] — 2026-05-22
### Fixed
- **Visualiser file selection now works**: removed the obsolete `visualiser.html` iframe wrapper. The wrapper was a leftover from when `visualiser-core.html` lived under `manifest.sandbox.pages` (v1.5.4 fixed that); its `sandbox="..."` attribute on the iframe was still in force and was silently blocking the file input's `change` event from doing anything useful. Callers in `popup.js` and `side-panel/panel.js` now open `visualiser-core.html` directly; the wrapper file has been deleted.
- Added stage-by-stage `console.log('[Visualiser] ...')` diagnostics through the PDF load pipeline so future silent failures can be diagnosed without source diving.

## [v1.6.1] — 2026-05-22
### Fixed
- **Visualiser "Choose PDF file" button**: replaced `<button>` + programmatic `fi.click()` with a native `<label for="file-input">` element — the programmatic click was silently blocked inside the sandboxed iframe; the label→input binding uses the browser's native activation and is not subject to the same restriction

## [v1.6.0] — 2026-05-22
### Added
- **Patient Record Visualiser — complete rewrite**: new pop-health dashboard built around real Medicus EPR export PDF structure; 6 tabs — Snapshot (demographics, active/past problems, open recalls), Continuity (UPC index, Bice-Boxerman index, clinician bar chart + detail table), Timeline (year stacked bar + 5-year monthly heatmap), Investigations (analyte trend selector with Chart.js line + reference bands, latest values table), Registers & Recalls (QOF register auto-detection from problem list, open/cancelled/completed recalls with overdue badges), Letters (specialty bar chart + searchable document list); replaces the previous 3,600-line kitchen-sink implementation
- **Suite backup refresh**: `doFullExport`/`applyEnvelope` in `options.js` now delegates entirely to per-module IO files — eliminates drift between backup and storage. Previously missing keys now captured: `slots.alertRules`, `submissions.thresholds`, `suite.triageAlert.rules`, `popout.windowState`
- `submissions-io.js`: now exports/imports `submissions.thresholds`
- `suite-envelope.js`: added `triageAlerts` and `popout` scopes; richer preview lines for slots, submissions, triage alerts, popout; version bumped to 1.6.0; added inline convention comment
- `options/options.html`: all per-module IO scripts now loaded
- `CLAUDE.md`: new developer guide documenting module structure, storage-key backup convention, alert strip pattern, version bumping, git workflow

## [v1.5.4] — 2026-05-22
### Fixed
- Patient Record Viewer: removed `visualiser-core.html` from `manifest.json` `sandbox.pages` — the manifest sandbox gave the page an opaque (null) origin, causing `URL.createObjectURL` to produce `blob:null/…` URLs that Chrome refuses to load as Web Worker scripts; removing the sandbox restores extension origin so the pdf.js worker initialises correctly

## [v1.5.3] — 2026-05-21
### Changed
- Nav: removed redundant "Alerts" tab (`data-module="triage"`) from side panel and pop-out — triage capacity alerts remain active via the rm-strip; triage lens overlay unaffected
### Fixed
- Patient Record Viewer: PDFs with text items missing `transform` (type 3 fonts, some Medicus print layouts) no longer throw an uncaught TypeError in `reconstructLines` — items without a transform matrix are now skipped
- Patient Record Viewer: null guard added on the investigations yearly chart canvas element in `buildInvestigationsView`
- Patient Record Viewer: error dialog now reports which processing stage failed (loading PDF / extracting text / parsing entries / building views) for easier diagnosis

## [v1.5.2] — 2026-05-21
### Added
- Submissions: configurable RAG thresholds for medical and admin request tiles — amber/red tint + coloured dot on tile when today's total reaches threshold; Options → Submissions → Workload thresholds
- Global demand strip (visible on every panel tab, polls every 60s) — shows amber/red pill for medical/admin when threshold crossed; "Submissions →" button navigates to the module

## [v1.5.1] — 2026-05-21
### Added
- Referrals: "Rate" chart tab — referrals as a proportion of consultations per clinician (referrals ÷ consultations, shown as %) sorted by rate descending; cyan bar colour, tooltip shows raw ref/consult counts; clinician search applies; show-all toggle works
- Referrals: parallel-fetches `window.ActivityApi.fetchActivityReport` alongside referral data; activity fetch failure is isolated (amber notice in Rate tab only, other tabs unaffected)

## [v1.5.0] — 2026-05-21
### Added
- Slots: alert ribbon — configurable per-type thresholds; amber/red ribbon when count ≤ threshold; Options → Slot Counter to manage rules
- Slots: alert rules included in backup/restore export
- Pop-out window — ⊞ button in panel nav opens a free-floating popup window; position/size persisted; `chrome.windows` permission added
- Triage alerts — `engine/triage-alert-engine.js` evaluates request monitor bucket counts against user-defined thresholds; rm-strip highlights amber/red; desktop notification on threshold crossing (once per session per bucket); Options → Suite → Triage capacity alerts
- `shared/io/triage-alert-io.js`, `shared/popout-manager.js`, `shared/io/popout-io.js`

## [v1.4.16] — 2026-05-20
### Added
- Referrals: "Show all N clinicians/specialties/hospitals" toggle below each chart (expands past top-15 cap)
- Referrals: real-time clinician name search filter above the By Clinician chart
- Referrals: CSV export button — downloads all raw referrals with date, patient, clinician, specialty, hospital, priority, status, e-referral/manual flags
- Referrals: Priority (Routine/Urgent/2WW) and Status (Completed/Incomplete/Cancelled) chip filters — re-aggregates instantly, no re-fetch
- Referrals: live "Updated Xm ago" staleness label; turns amber with inline Refresh link after 30 min

## [v1.4.15] — 2026-05-20
### Fixed
- Nav bar: add left scroll arrow (‹) with `has-overflow-left` class and nudge-left animation
- Nav bar: both arrows now have border + `--text-2` colour for improved visibility
- Nav bar: left fade gradient via `::before` pseudoelement
- `normalisePriority`: use `startsWith('twoweek')` to correctly handle `'Two Week Wait (2WW)'` response values

## [v1.4.14] — 2026-05-20
### Fixed
- Referrals: 2WW priority count showing as 0 — API returns `'Two Week Wait (2WW)'` (spaced/parenthetical); added `normalisePriority()` to strip non-alpha chars and map all variants to canonical key

## [v1.4.13] — 2026-05-20
### Fixed
- Referrals: HTTP 400 — `buildUrlFromTemplate` was appending `referralStartDate`/`referralEndDate` on top of existing `startDate`/`endDate` params; now detects which date-param convention the URL uses and sets only those
- Referrals: full pagination loop (PAGE_SIZE=2000, MAX_PAGES=10) — was only fetching first 100 rows

## [v1.4.12] — 2026-05-20
### Changed
- Referrals: switch to URL template replay — captures exact discovery URL verbatim, only rewrites date/pagination params
- Referrals: add diagnostic panel (collapsed) showing discovery URL, config URL, priority/status values, last attempted URL

## [v1.4.11] — 2026-05-20
### Fixed
- Referrals: HTTP 400 — use actual priority/status values from stored config (`priorityOptions[*].value`) instead of hardcoded strings; removed spurious `limit=2000` param

## [v1.4.10] — 2026-05-20
### Fixed
- Referrals: HTTP 404 — read base URL from `referrals.discovery` / `referrals.config` storage (captured by discovery content script) instead of constructing from practice code; show discovery prompt when no URL available

## [v1.4.9] — 2026-05-20
### Added
- Referrals Tracker v1.0 — full visualisation module: summary card (total, priority tiles), status breakdown, stacked bar charts by clinician/specialty/hospital, date range controls with presets, progress indicator during paginated fetch

## [v1.4.6] — 2026-05-20
### Fixed
- Various code review bug fixes

## [v1.4.5] — 2026-05-20
### Fixed
- Visualiser CSP issue resolved via sandbox page

## [v1.4.3] — 2026-05-20
### Added
- Visualiser as labelled nav tab
- Check for Updates button in About panel

## [v1.4.2] — 2026-05-19
### Added
- Activity module with date range controls and stacked bar charts by task type
- `qofYearStart` UTC fix in rules engine
- `shared/activity-api.js`
