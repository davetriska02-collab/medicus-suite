# Class-Leader Features Plan — 2026-07-01

Three features chosen for best-of-type differentiation, buildable entirely from
knowledge already in the repo (local rules engines, existing snapshot data, the
lab-filing audit precedent). All read-only against the clinical record; none
requires live-Medicus DOM discovery or advances the CSO-review ledger. Sources:
`docs/plans/ROADMAP-DAVE-COUNCIL-2026-06-16.md` (steps 2 and 5), the v3.143.0
lab-filing audit-log precedent, and the engine inventory (acb-scores,
stopp-start, drug rules, interaction alerts, Condor daily snapshots).

Target release: **v3.145.0** (minor). No new nav tabs — each feature lives in
an existing surface, so no pop-out/nav/tab-help churn (tab-help coverage test
stays green by construction).

## F1 — Prescribing Pre-flight (what-if safety preview)

**Why class-leading:** no GP-side tool offers an in-context, pre-prescribing
preview. The suite already computes ACB, STOPP/START, interactions and
monitoring requirements for *current* meds; Pre-flight runs the same engines
over "current meds + one proposed drug" and shows the delta before the
prescription exists.

- **Engine:** new pure module `engine/preflight.js` — input: patient context
  (age, problems, current meds, recent results) + a proposed drug name (free
  text, matched case-insensitively the same way `drugMatchesRule` does).
  Output object: { acb: {current, projected, delta, band}, stoppStart: [flags
  the addition would trigger], interactions: [alerts vs current meds],
  monitoring: [rules that would apply, each with required tests and whether a
  recent in-range result already satisfies the baseline] }.
- **Reuse, don't fork:** call the existing exported functions from
  `engine/acb-scores.js`, `engine/stopp-start.js`, `engine/rules-engine.js`
  and the interaction/alert rules. If a needed function isn't exported,
  export it — do not duplicate logic.
- **UI:** collapsible "Pre-flight — check a drug before prescribing" section
  in the Record module (patient loaded only): one text input + Check. Calm
  card output; red/amber only where the engines say so. Mandatory caveat
  line: "Decision aid, not advice — confirm against the BNF and the full
  record." Unknown drug (no engine has anything to say) states that honestly
  rather than implying safety.
- **Tests:** `test-preflight.js` — fixture patients covering: ACB delta into
  a higher band, a STOPP trigger, a known interaction pair (e.g.
  methotrexate + trimethoprim), monitoring baseline satisfied vs missing,
  unknown drug, empty input.
- **Safety framing:** read-only; no dosing advice; wording mirrors the
  existing prescribing-safety caveats in the SMR/Record surfaces.

## F2 — Clinical Event Ledger

**Why class-leading:** answers "did the tool flag this?" with evidence.
Roadmap-council step 2 verbatim; the honest answer today is "we can't say".

- **Core:** `shared/event-ledger.js` — append-only ring buffer in
  `chrome.storage.local` (`ledger.events`): cap ~5000 events AND ~90-day
  retention (prune on append). Event shape: ts, source
  (sentinel|sweep|labfiling|palette), patientRef (the UUID Medicus already
  uses — no names), severity, ruleId/label, action
  (shown|dismissed|recall-created|summary-copied|filed). Writes are
  fire-and-forget and must never block or break the calling surface (wrap in
  try/catch; ledger failure is silent for the user, logged to console).
- **Instrument (dedupe per patient+rule+day so it's evidence, not noise):**
  Sentinel panel evaluations that produce red/amber chips + dismissals;
  Sweep run summaries (counts, clinician scope) + each "Create recall task";
  Record "Copy patient summary"; bridge the existing lab-filing audit events
  into the same ledger (keep the lab-filing log itself untouched — mirror,
  don't migrate).
- **UI:** Options page card "Event ledger": filter by patient UUID and date
  range, table of events, CSV export (same pattern as lab-filing audit CSV),
  "Clear ledger" behind a typed confirm, and a plain-English disclosure:
  machine-local, capped, what it is and is not (not a clinical record).
- **Backup:** machine-local like the lab-filing audit — EXCLUDED from suite
  backup export. Document that choice in the disclosure and the plan.
- **Tests:** `test-event-ledger.js` — append/cap/retention-prune/query/dedupe
  as pure logic; a smoke test that instrumented call sites tolerate a
  throwing storage layer.

## F3 — Practice Pulse (snapshot trends + prior-period comparison)

**Why class-leading:** turns Condor's existing once-daily snapshots into
week-on-week operational intelligence with honest provenance — the practice
manager's "is this week actually worse?" answered from their own data.

- **Core:** pure builders in `side-panel/modules/condor/pulse-core.js`:
  given the stored snapshot series, produce per-metric trend rows (pressure
  index, demand, PPI, task-age, waiting-room) for last 7/30 days: current,
  prior-period mean, delta, direction, and a coverage statement ("based on N
  of 30 possible snapshots" — gaps happen when the extension wasn't open;
  never interpolate silently).
- **UI (Condor):** a "Pulse" section — compact trend rows with inline
  sparklines (tokens only, no new chart lib beyond what Condor already
  uses), as-at stamp, coverage line.
- **Practice Report:** prior-period comparison block using the same core;
  disclose coverage identically. Respect the existing audience profiles.
- **Reconciliation fix (roadmap step 5 / A11):** live Condor honours
  `hiddenTypes` for capacity; verify whether the printed Practice Report
  still counts all slot types (the historical dead-branch). If the mismatch
  still exists, fix the report to use the same filter and state the filter
  in the report ("excludes hidden slot types: …"). If it was already fixed,
  say so and add the regression test anyway.
- **Snapshot retention:** check current snapshot cap; if unbounded, cap
  sensibly (e.g. 400 days) with prune-on-write.
- **Tests:** `test-pulse-core.js` — deltas, direction, sparse-coverage
  honesty, empty series; regression test for the capacity reconciliation.

## Execution order
Sequential Sonnet batches, one commit+push each, then a finisher:
1. F1 Pre-flight (engine + Record UI)
2. F2 Event Ledger (shared core + instrumentation + Options UI)
3. F3 Practice Pulse (Condor + Practice Report)
4. Finisher: tour check (Pre-flight is the strongest new-step candidate),
   manifest 3.144.0 → 3.145.0, CHANGELOG, full `npm test` + lint, push.

## Ground rules (as batch A–C, plus)
- Read-only against the clinical record; no new record writes.
- Do not touch `content-scripts/triage-lens/content.js` or either
  `defaults.json` copy.
- New storage keys → backup convention (`shared/io/*-io.js` both directions),
  EXCEPT `ledger.events`, which is deliberately machine-local (mirror the
  lab-filing audit precedent and document it).
- Engines: export, reuse, never duplicate rule logic (the silent-missing-alert
  disease lives in duplication).
- Caveat/disclosure wording must match the suite's existing honest-provenance
  voice; nothing may imply a drug is "safe".
- Full `npm test`, `npx eslint`, `npx prettier --check` green before each
  commit.
