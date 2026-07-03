# What's hard or impossible to do in Medicus — the list behind the extension

**From:** Dave Triska (Witley & Milford Surgery)
**For:** Emile Axelrad — Medicus product / reporting workstream
**Date:** 3 July 2026 · derived from the Medicus Suite codebase at v3.151.0

You asked for the next level of detail down — concrete examples of "things that are
super hard or impossible to do" so you can prioritise the reporting workstream against
them. Here it is, prioritised ruthlessly, and I've been as harsh as you asked.

Context for how this list was produced: the extension I've built is, in effect, a
running audit of Medicus's gaps — every module in it exists because something wasn't
possible or was too painful in the product. So rather than opinions, each item below is
traceable to code in the repo (paths given), which means your team can drill into any
of them. One honest caveat up front: where I say "no endpoint exists", that's inferred
from everything the extension could discover on a live session — you have the actual
API inventory, so you can confirm or refute each one in minutes. I'd genuinely love to
be told some of these already exist.

**If you do only one thing from this list, do Tier 1, item 1.**

---

## Tier 1 — Impossible today (no workaround exists, even with an extension)

These are the items where I — with full DOM access, the user's authenticated session,
and no scruples about reverse-engineering — still couldn't get there. That's my working
definition of "impossible".

### 1. Ask the system "which patients…?" — there is no population/cohort query. *(This is the reporting ask.)*

There is no endpoint, report, or screen I could find that returns a criterion-filtered
patient list: "everyone on lithium", "everyone on the diabetes register with HbA1c > 58",
"everyone on a DMARD with no FBC in 3 months". Every population-shaped endpoint returns
events, tasks, referrals, or appointment rows — never a queryable register of patients.

Why it matters clinically, not just administratively: this is how you run an MHRA drug
safety recall, a QOF gap hunt, a CQC evidence search, or any proactive-care programme.
Today the only cohort I can enumerate is **patients booked into today's clinic** (via
the appointment book), which is why my pre-clinic Sweep works one clinic day at a time
— it's not a design choice, it's the only patient list reachable.

If your reporting workstream ships one thing, ship this: a supported search/report
that takes clinical criteria (drug, code, register, result value/date) and returns a
patient list you can export and act on. Everything else in reporting is downstream
of it.

*Evidence: `docs/plans/CQC-P0-COHORT-SPIKE.md` (the full spike, with VERIFIED vs
INFERENCE labelled per claim).*

### 2. Longitudinal data — the record's history is effectively unreachable

Three specific walls, each verified against the live API surface:

- **No encounter/consultation listing.** Only single-lookup
  `/clinical/data/encounter/overview/{uuid}` exists; there is no "all consultations
  since X". Continuity-of-care analysis is impossible from the API.
- **The journal/observations endpoint has a hardcoded ~400-day window.** Multi-year
  HbA1c or eGFR trends — the thing a GP actually wants at the point of care — can't be
  fetched.
- **The activity report is counts-only** — aggregate totals with no dates and no
  drill-down.

The absurd consequence: to get a patient's longitudinal record I built a **PDF
text-miner** — the user exports the record PDF and my visualiser regex-parses it back
into structured data to compute trends, continuity indices, and frailty scores. I am
un-printing your own database. That should embarrass both of us.

*Evidence: `docs/viewer-roadmap.md:41–76` (the API spike), `visualiser-core.js` (the
PDF parser).*

### 3. Allergies and immunisations have no live endpoint

The patient banner, medications, problems, and investigations are fetchable; allergies
and immunisations are not. My live record summary literally renders "not shown — verify
in Medicus" gap-markers where they should be, and every prescribing-safety score I
compute carries a permanent "excludes allergies" caveat. For a clinical system that's a
strange asymmetry — it's some of the highest-stakes data in the record.

*Evidence: `side-panel/modules/record/record.js:26–34`.*

### 4. The recall loop doesn't exist as a managed cycle

Alert → invite → book → re-test → close. No part of Medicus owns that loop end-to-end,
so overdue monitoring is handled by humans and sticky notes. I can detect the overdue
test and generate the recall SMS text and even create a task — but nothing tracks that
the loop *closed*. This is the single biggest functional gap versus the incumbent
add-on market (Ardens Diary Recall, Eclipse worklists all do it).

*Evidence: `docs/benchmark/GAUNTLET-2026-06-11.md`.*

### 5. Smaller but genuinely blocked

- **Attachment presence is invisible in task data** — I can't tell whether a
  rash/lump request has a photo attached, so "ask for a photo" prompting is impossible.
  (`docs/plans/TRIAGE-LENS-PHASE4-REVIEW.md:83–92`)
- **Filing a result is irreversible** — there's no unfile/undo, which forced my
  lab-filing feature to be far more conservative than it needs to be.
  (`docs/appraisal/GP-WISHLIST-RESPONSE-labfiling-2026-06-29.md:64`)
- **EMIS-imported warnings are opaque** — the banner shows they exist but their content
  isn't exposed anywhere I can read, so migrated safeguarding context is a black box.
  (`content-scripts/triage-lens/content.js:1599`)
- **No computed risk scores** (QRISK3, eFI, etc.) — I can only signpost out to external
  calculators.

---

## Tier 2 — Possible, but only by paying an absurd workaround tax

Everything here I *did* build — which proves it's possible — but the cost was
reverse-engineering, and the result is fragile in ways that should worry you as much
as me, because every add-on developer after me will do the same things.

### 1. There is no supported integration surface at all

- **No published API docs.** Every endpoint I use was inferred from watching the app's
  own network traffic. The four care-record endpoints, the task APIs, the scheduling
  API — all reconstructed from URL shapes.
- **API contracts vary per deployment.** Param names, pagination conventions, and enum
  values differ between practices — `startDate` vs `referralStartDate`, `startRow/endRow`
  vs nothing. My referrals module can't even construct its own URL: a content script
  watches `PerformanceObserver` for the page's own API call, captures the exact URL, and
  replays it verbatim, because guessing is unreliable. (`docs/learnings-referrals-tracker.md`)
- **No push/webhook API.** For live updates I tap the Vue app's private Pusher channel
  (`#app.__vue_app__…$pusher`) and poll the task list for new requests. When you rename
  that channel, my waiting-room strip dies silently. (`content-scripts/pusher-relay.js`)

### 2. No aggregate or bulk endpoints — everything is N+1

- **Submissions/demand counts:** no counts endpoint, so I fetch the *entire task list*
  for five task types and count rows client-side. (`side-panel/modules/submissions/submissions.js:339`)
- **Capacity over a date range:** the scheduling overview is single-day only, so a
  month view is ~30 HTTP requests through a hand-rolled concurrency pool.
  (`shared/medicus-api.js:114`)
- **Queue triage:** the task-list payload carries no severity, no result values, and —
  notably — **no patient identifier**, so I fetch every row's overview URL individually
  to know anything about it. (`docs/plans/TRIAGE-LENS-PHASE4-REVIEW.md:16`)
- **Any per-patient analysis across a clinic:** four API calls per patient, hand-throttled
  with sleeps so I don't hammer your servers. (`side-panel/modules/sweep/sweep.js:461`)

Each of these is a reporting feature you could ship as one endpoint.

### 3. Silent failure modes in the API

Two that cost real debugging days and are patient-safety-adjacent:

- The task-list date filter is `createdAt_startDate`/`createdAt_endDate`; passing plain
  `startDate`/`endDate` is **silently ignored and returns the entire open-task backlog**
  — no error, just wrong data at 100× scale. (`side-panel/modules/condor/condor-data.js:89`)
- A failed fetch and "patient genuinely has no medications" are **indistinguishable**
  (both normalise to an empty array), so a monitoring alert can silently vanish. I had
  to build DOM cross-checks purely to tell those two states apart.
  (`engine/data-fetcher.js:226`)

Errors generally surface as raw 401/403s with no body worth reading — I built a
diagnostics ring-buffer just to debug auth issues.

### 4. The frontend gives integrators nothing stable to hold on to

Three of six consecutive releases of my extension were broken by Medicus silently
changing frontend components — **each discovered by a clinician mid-clinic**, not by
CI, because for a safety overlay "broken" means "silently absent". I now maintain a
registry of all 14 DOM selector contracts I depend on, with runtime canaries and an
amber "Medicus may have changed" health strip, purely to detect your deploys.
Meanwhile the Vue/AG-Grid queue strips foreign DOM nodes on every render, so injected
UI has to be re-injected on every mutation with reverse-engineered reconciler rules.

The fix costs you almost nothing: **stable `data-testid` attributes on key controls
and cells** (queue rows, task action bars, filing controls, patient banner). That's a
day of work for your frontend team and it de-risks every integration — including your
own E2E tests.

*Evidence: `docs/plans/HORIZON1-UNBREAKABLE-2026-07-02.md`, `shared/dom-contracts.js`.*

### 5. Operational metrics have no history

Waiting-room state, task age, demand pressure — Medicus only exposes "now". There's no
time series for anything operational, so my dashboard accrues its own daily snapshots
going forward and can never backfill. A practice manager asking "how did June compare
to May?" is asking a question the system cannot answer.
(`side-panel/modules/condor/condor.js:27`)

### 6. Structure is missing where it matters

The referrals audit report's `referralService` field is a single free-text string —
service, specialty, hospital, and trust joined with em-dashes — which I split back
apart with string parsing to make it reportable. The 2WW/Faster-Diagnosis safety-net
view (open suspected-cancer referrals, aged, oldest-first — arguably the most important
report in the building) is entirely client-side assembly on my part.
(`shared/referrals-api.js:147,459`)

---

## Tier 3 — Quick wins (small, self-contained, ship-this-quarter items)

1. **`data-testid` attributes on key UI elements** — cheapest item on this page,
   biggest stability return (see Tier 2, §4).
2. **A "select all / bulk tick" on the Review Investigation Report page** — ticking
   outstanding requests one-by-one is pure toil; I inject a bulk-tick button today.
3. **An "add task" control on the prescription-request task overview** — the action
   exists on other task types; its absence here is an obvious inconsistency.
4. **Threshold alerts on slot counts and demand** — the counts are already on screen;
   there's just no "tell me when it crosses a line". Amber/red at configurable levels.
5. **CSV export on every report and list view** — activity, referrals audit, task
   lists, scheduling. Practice managers live in spreadsheets; today they retype.
6. **Date filters honoured or rejected — never silently ignored** (Tier 2, §3). Return
   a 400 for unknown params.
7. **Meaningful API error bodies** instead of bare 401/403s.
8. **Consistent field naming** — e.g. the activity report's `investigationReportTasks`
   doesn't match the product's own terminology anywhere.

---

## If I ran your reporting workstream: the order I'd build in

1. **Cohort/population query** — clinical criteria in, patient list out, exportable
   (Tier 1, §1). Everything below is worth less until this exists.
2. **Aggregate counts endpoints with date ranges** — tasks by type/day, slots by
   type/day-range, so dashboards stop being N-hundred-request scrapes (Tier 2, §2).
3. **Longitudinal read access** — an encounter listing endpoint and removal of the
   400-day journal cap (Tier 1, §2).
4. **Time-series for operational metrics** — even just daily snapshots of task counts,
   task age, and waiting-room stats, queryable historically (Tier 2, §5).
5. **Structured referrals reporting** — proper columns, plus a first-class
   2WW-still-open safety-net view (Tier 2, §6).
6. **CSV export everywhere** (Tier 3, §5).

Items 2, 4, 5 and 6 are honestly not hard — they're mostly exposing data you already
hold. Item 1 is the strategic one, and it's the one that turns Medicus from a place
where data goes in into a system a practice can actually interrogate.

---

## Standing offer

Every claim above is traceable to code and documents in the repo, and I'm happy to
walk any of your engineers through any item — including live on my instance. And where
I've said "no endpoint exists": if I'm wrong, tell me which endpoint to call and I'll
delete both the workaround and the complaint with great pleasure.

— Dave
