# Top-10 User-Value Improvement Plan — 2026-07-01

Derived from the practice-panel appraisals (`docs/appraisal/ROAD-TO-10-2026-06-21.md`,
`PRACTICE-whole-suite-2026-06-21.md`, `PRACTICE-whole-suite-gap-to-9-2026-06-16.md`),
the Dave-council roadmap (`docs/plans/ROADMAP-DAVE-COUNCIL-2026-06-16.md`) and a
codebase gap sweep. Cross-checked against CHANGELOG through v3.143.2 so nothing
already shipped is re-proposed. Excludes items Dave explicitly rejected (unflooring
the Condor safety floor, removing the Reception admin gate, full-auto lab filing),
items pending CSO review, and items needing live-Medicus DOM discovery (bulk lab
filing, requester-field capture).

Target release: **v3.144.0** (minor — new features). All items are read-only
(no clinical-record writes). Every new storage key follows the backup convention
in CLAUDE.md (`shared/io/<module>-io.js`).

## The ten improvements

### 1. Today — plain-English "What needs you now" headline (M)
Source: G1 blocker in both whole-suite appraisals.
One sentence at the top of Today, derived from data the module already polls:
e.g. "3 patients waiting (longest 22 min) · 14 medical requests unread · sweep
not run today." Red states lead; when all quiet: "Nothing needs you right now —
last checked HH:MM" using the shared provenance canon (`shared/provenance.js`).
Pure-function headline builder + tests. No new storage keys.

### 2. Per-tab "?" help (M)
Source: G2 in gap-to-9 appraisal.
"?" affordance in the panel header (panel **and** pop-out) showing, for the
active tab, two lines: *what this is* / *what to do first*. Static map in a
shared file so both shells consume one source. Keyboard/aria accessible.
Test asserts every tab in the tab catalog has an entry.

### 3. Sentinel — rule-coverage drill-down (L)
Source: R4, whole-suite appraisal. Patient-safety transparency: the silent
false negative (monitored drug with no rule) is the panel's named failure mode.
The "N drug rules · updated …" line becomes expandable: rule names, matched
drug terms (from `rules/drug-rules.json` via existing ruleset IO), QOF
indicators covered. Read-only; renders without a patient loaded; counts must
equal the rule files (tested).

### 4. Sentinel — loaded-panel headline audit count (S/M)
Source: gap-to-9 appraisal; partially landed in v3.138.0 (unmatched section).
When a patient panel is loaded, one headline line: "N meds checked · M matched
· K overdue · P unmatched", stamped with evaluatedAt. Data already computed;
this surfaces it.

### 5. Referrals — patient-name search + clinician filter (M/L)
Source: R3, whole-suite appraisal (medical-secretary persona).
Search input filtering the referral list and 2WW worklist by patient name;
clinician dropdown wired into the chart and list (today it exists only as a
name-search on the worklist). Filters combine; CSV export respects active
filters and says so in the filename/header.

### 6. Record — "Copy patient summary" (S/M)
Source: Dave-council roadmap step 4.
Button on the Record tab producing a deterministic plain-text block of what is
on screen (demographics, coded problems, meds + doses, recent results, ACB /
STOPP-START flags, monitoring/QOF chips), ending with the caveat line
"Snapshot from Medicus Suite at HH:MM — verify in the record before acting."
Formatter is a pure function with tests (extend `test-record-summary.js` if it
already covers part of this — check first).

### 7. Trends — self-describing resting state (M)
Source: whole-suite appraisal ("black box").
Resting state shows a worked example (static sample chart or annotated
description), clarifies naming, and states the first step: "Open a patient in
Medicus, then pick a metric."

### 8. Condor — tunable pressure-index weightings & band thresholds (M/L)
Source: P1, whole-suite appraisal (power-user ask: "you've shown me the lever
and hidden it").
Cog on the index meter → editor for component weightings and AMBER/RED band
thresholds, with visible defaults and one-click reset. COPY FIGURES discloses
"custom weightings" when active. **Hard rule: the safety floor (never GREEN
while capacity is over limit, `condor.js` floor) is NOT configurable — add a
regression test proving no config can produce GREEN over-capacity.** New
storage key goes into the Condor/practice-report IO backup path.

### 9. Slots — proactive alert thresholds (M)
Source: codebase gap (`alertRules: []` loaded but no UI).
Per-appointment-type "alert if fewer than N left" with amber/red highlight in
the Slots view and breach surfaced on Today's Slots card. Threshold evaluation
is a pure function with tests. Storage key added to slots IO backup.

### 10. Command palette — patient-scoped actions (S)
Source: Dave-council roadmap step 4 (sibling of #6).
When patient context exists: "Copy patient summary" (reuses #6 formatter),
"Open visualiser", "Jump to Record / Trends / Sentinel". Actions hidden when
no patient context. Extend the existing palette core (see
`test-palette-core.js` for the registry shape).

## Deliberately not in this ten
- Lab Filing follow-ons (bulk filing P4, record-note P6, profile sync P7) — CSO
  review of v3.143.0 pending; P4/P6 need live DOM/transport scoping.
- Visualiser live-first tab — L, and its blocker (in-place gap-markers) is
  already partially served by the Record module; needs its own scoped plan.
- Alert snooze — temporal suppression of clinical alerts needs a safety
  argument (hidden-resurfacing semantics) before build.
- Clinical Event Ledger — high governance value, but infrastructure-shaped;
  next release candidate.
- Keeper Q1 (DM036 age band) — blocked on primary-source confirmation; must
  not be edited from secondary sources.

## Execution order & batching
Batched to avoid file conflicts; each batch commits separately.
- **Batch A (shell + calm tabs):** #1 Today headline, #2 per-tab help, #7 Trends
  resting state.
- **Batch B (patient context):** #3 + #4 Sentinel, #6 Record copy-summary,
  #10 palette actions.
- **Batch C (ops modules):** #5 Referrals, #8 Condor tunables, #9 Slots alerts.
- **Finish:** tour anchor check (bump TOUR_VERSION if shell UI changed), version
  bump to 3.144.0, CHANGELOG entry, full `npm test` + `npm run lint`, push.

## Ground rules for implementers
- Read-only: no new clinical-record writes anywhere in this set.
- Do not touch `content-scripts/triage-lens/content.js` or either
  `defaults.json` copy unless unavoidable (tests match exact content; the
  defaults version-lock applies).
- Module changes must work in pop-out as well as panel (same module files; new
  nav/header affordances go in BOTH shells).
- New storage keys → both `*Export()` and `*Import()` in the module's
  `shared/io/*-io.js` (backup-coverage tests enforce this).
- Match house style (`design-system/`, Atelier tokens); no Prettier reformat of
  whole files.
