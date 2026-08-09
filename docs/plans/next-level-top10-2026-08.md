# Medicus Suite — Top 10 Next Best Developments (August 2026)

**Produced by the Next-Level Swarm** (`docs/AGENT-SWARM.md`) on 2026-08-09, against
v3.226.x. Four Sonnet research analysts (market scan, tech-trends scan, hands-on
engineering review, hands-on product/UX review) fed six Opus expert personas (platform
architect, clinical UX designer, AI engineer, clinical safety engineer, data engineer,
product strategist), who produced 36 proposals. A two-judge challenge panel — a ruthless
skeptic and a time-poor working GP — graded every proposal; heavily-duplicated ideas
(five independent experts converged on items 1, 2, 5 and 8 below) were merged, and the
judges' corrections are folded into each item. Orchestration and synthesis by Fable.

**Research headlines that shaped the ranking:**

- The market has bifurcated into AI scribes (TORTUS/Surgery Intellect, 3,500+ practices)
  and total-triage front doors (Accurx in 98% of practices) — neither is where the suite
  competes, but the **recall-loop gap** flagged in GAUNTLET-2026-06-11 has _widened_:
  Abtrace and Suvera are now live in exactly the drug-monitoring/recall space Sentinel
  occupies, alongside Ardens Diary Recall, PCIT OneRecall and Eclipse Radar.
- The suite's delivery model (zero-procurement, practice-owned extension over a live EPR
  session) and its feature _combination_ remain unreplicated by any vendor found.
- 2026 AI-scribe safety literature (omission, hallucination, review erosion) makes the
  suite's read-only/no-runtime-inference architecture an evidence-backed differentiator.
- The codebase's own docs name its two sharpest debts: **substring drug matching** vs
  incumbents' SNOMED refsets (VISION.md), and **safety-doc drift** — a signed
  CLINICAL-SAFETY-NOTICE asserting "no external transmission" while `*.supabase.co` sits
  in `host_permissions` (cso-review-ledger.json's own notes).

---

## The Top 10

### 1. Coded drug matching — dm+d/SNOMED tiers on top of substring, never instead of it

**Both judges' top-ranked clinical item (skeptic: strong; GP: "Do this one").**
The engine is already half-coded and throwing the data away: `rules/drug-rules.json`
carries `drug.snomed` per rule (used only for observations at `engine/rules-engine.js:227`),
and `normaliseMedications()` captures `vtm` and `id` off the medicationRegimen payload
then drops them. Change `drugMatchesRule` (line 55; call sites ~850, 1352, 2547) to take
the med object and match in tiers — coded concept, VTM name, then today's substring — as
a **union that can only widen coverage**, with `drug.exclude` still applied **after every
tier**. Pair with a build-time generated, version-locked `rules/dmd-brand-index.json`
(maintainer-run script through the existing termbrowser client doctrine; generated ∪
hand-authored, reviewed as a diff, never auto-merged), and record which tier fired in
`drugMatchDetail` so coverage is auditable.
_Judges' corrections baked in:_ the session path carries no SNOMED code, so the VTM-name
tier is what pays off today; keep `test-drug-brand-coverage.js`'s hand-maintained
EXPECTED map independent of the generator (CI fails when the index knows a brand the
rule doesn't — never generate the guard from the thing it guards).
**Why:** CLAUDE.md names the silent brand-miss as a patient-safety risk; this closes it
with zero AI, zero egress, zero intended-purpose change. **Impact: transformative ·
Effort: medium.**

### 2. Recall Loop v1 — a stateful worklist behind Sweep and Sentinel

**The most-repeated competitive gap in both internal benchmark and external scan; five
experts proposed it independently.** Sweep/Sentinel already create recall tasks and
Action Pack artefacts (blood form, SMS, letter, Medicus task) and then forget they ever
did. Add a per-(patientUuid, ruleId) state machine — detected → invited → booked →
resolved/lapsed — where `invited` is stamped at the existing action-pack and
`createGeneralTask` handlers (no new UI), and **every downstream transition is derived
from server-side truth the suite already fetches** (`shared/task-api.js` task status,
`shared/appointments-feed.js` bookings, `shared/pending-result-index.js` results; a test
coming back in-date closes the entry via the rules engine re-evaluating green). The event
ledger is the audit trail, never the state store. Sweep rows/Sentinel chips gain one
line: _"invited 12 days ago, still overdue."_
_Non-negotiables from the safety judge:_ no manual tick may ever close an entry; `lapsed`
is the default on ambiguity; fail visible on fetch errors; the store is a reporting layer
over the rules engine, never an input to it; new HAZARD-LOG entry + CLINICAL-SAFETY-NOTICE
section before it ships (which is why item 5 lands first). Start machine-local with the
Follow-ups honest-state header doctrine; add cross-machine sharing (presence-folder
pattern) only once the state machine is proven. **Impact: transformative · Effort: large.**

### 3. Pre-merge injection canary — replay real Medicus fixtures against the actual inject path

**Both judges: strong.** Three shipped regressions (v3.67.0 append, v3.69.0 row-id no-op,
v3.143.1/.2 selectors) were each found by a clinician mid-clinic; `contract-canary.js` is
good but reactive by construction. `fixtures/medicus/` already holds 24 DOM snapshots and
CI already runs a Playwright job (`scripts/verify-visualiser.mjs`). Assemble them: load
`queue-chip-host-current.html` in a real page, drive the real inject path, simulate a
Vue-style reconcile of the host subtree, and assert chips survive — making CLAUDE.md's
two hard-won rules (prepend-not-append; re-inject from `_durableRowMap`) executable
instead of tribal. Bolt on the nearly-free plain-node check that every injected top-level
chip class appears in the `hud.css` token-block selector list (kills the entire
"unstyled white rectangle" bug class), and take the load-order graph check the judges
salvaged from the static-guard proposal: parse the regular `(function(global){…})(this)`
IIFE pattern and assert every global a file reads is provided by an earlier file in its
`manifest.json` block — 62 ordered files currently have no such check, and a mis-ordered
line is a silent clinic-time failure. **Impact: high · Effort: medium.**

### 4. Coverage Observatory — make "what this tool is NOT watching" a first-class surface

**Both judges: strong; the GP called its example row "the most clinically useful thing
the suite could put in front of me."** The suite's dangerous failure mode is silence, and
the evidence of silence is scattered across five places, three of which only run in CI.
Pull into the existing Options → Suite Health section (no 24th tab): unmatched meds with
reasons (`listUnmatchedMedicationsDetailed`), high-risk unmatched
(`HIGH_RISK_UNMATCHED_CLASSES`), rule currency/spec-version age, contract-canary
degraded/recovered transitions from the event ledger, and a counter for triage requests
matching no rule. Each row states the clinical consequence in plain words ("amiodarone on
repeat, no monitoring rule matched — no overdue-bloods chip will ever fire") and links to
the authoring surface that fixes it. Default view = high-risk gaps only; dismissible with
recorded reason; feed `engine/cqc-evidence.js` so it doubles as inspection evidence. Also
answers Nick's real question: does a quiet Monitoring tab mean "nothing due" or "nothing
matched"? **Impact: high · Effort: medium.**

### 5. Safety-claim conformance gate — and delete the Supabase host permission

**Skeptic: strong — "the only variant that proposes the actual fix."** The project's own
review ledger records that CLINICAL-SAFETY-NOTICE §6 asserts unqualified "no external
transmission" while `https://*.supabase.co/*` ships in `host_permissions` and
`shared/txn-transport.js` exists (dormant, no DPIA, no hazard entry). Three moves, in
order: (a) **drop the Supabase host permission** — the transactional path defaults to
'session' and no practice is meant to enable hybrid, so the permission buys nothing and
makes the signed notice false today; make `shared/txn-config.js` hard-refuse
hybrid/transactional until a shipped allowlist names the covering HAZARD-LOG id.
(b) Ship `scripts/check-safety-claims.js` in CI: every host permission must appear in the
CSN §6 egress table, every shipped write-path content script must have a W-row, derived
from a grep over real call sites rather than a hand-maintained list. (c) Clear the CSN
backlog in one review, then lower `HARD_FAIL_MINORS_BEHIND` from its deliberately-inert
60 to a number that bites (~15). Sequence report-only → fail-closed so CI never trains
people to ignore red. This gate is also the encoded answer to what _not_ to build:
GP Connect, MESH, and any on-device LLM chip each fail closed until someone does the
safety-case work. **Impact: high · Effort: small-medium.**

### 6. Post-deployment safety surveillance — alert-burden and dismissal analytics

**GP judge: strong, "highest value-per-hour item on the list."** The event ledger already
records, PHI-free and day-sharded, every chip shown, dismissed, and actioned — and
nothing reads it back. Build a Safety Surveillance drill-down computing per-rule fire
rate, dismissal rate, shown-but-never-actioned rate, and never-fired rules over a rolling
window, with two threshold flags: a rule dismissed at ~100% (a de facto false positive
training alert fatigue) and a runaway fire rate after a rules/defaults change (a
bad-release tripwire). Export a signed PHI-free summary for `docs/cso-review-ledger.json`
— the DCB0160 post-market-surveillance obligation producing its own evidence. Scope per
the skeptic: the two flags and the never-fired list, not a metrics dashboard; show window

- shard coverage beside every number; refuse rates below a minimum denominator; advisory
  to a human CSO, never auto-disabling rules. **Impact: high · Effort: small.**

### 7. Human-only sign-off gate for clinical-content diffs

**GP judge: strong — "an unreviewed agent edit to rules/\*.json is the scariest thing in
the codebase. I'd sleep better."** The review ledger records CSO sign-offs "performed by
delegated virtual-Dave agent," and The Keeper authors drug-rule content. Require a
`Clinical-Reviewed-By:` commit trailer matched against an allowlist of named human
clinicians on any diff touching `rules/*.json`, `engine/rules-engine.js`,
`engine/result-severity.js`, `engine/stopp-start.js`, `engine/acb-scores.js`, or the
clinical blocks of `defaults.json` — enforced in `scripts/defaults-config-lock.js` (the
muscle that already refuses unbumped clinical changes) plus a CODEOWNERS entry with
branch protection requiring a human reviewer, so the trailer is the audit artefact and
the platform is the enforcement. Teach `cso-review-ledger.json` a structured
human-vs-agent signature field and surface agent-only sign-offs as open actions. Scope
narrowly to genuine clinical content or a 2-release/day team will route around it.
**Impact: high · Effort: small.**

### 8. Storage integrity — quota headroom, `unlimitedStorage`, and a storage-key contract

**Skeptic: strong on the quota half ("highest value-per-hour"); merged with the data
contract the judges kept.** The manifest requests `storage` but not `unlimitedStorage`,
so 64+ keys and 714 call sites live under a 10 MB cap with zero `getBytesInUse` and zero
quota handling anywhere — the failure mode is a Follow-up that looks saved and isn't,
silently, during clinic. (a) Add `unlimitedStorage` (no prompt, no host access); (b) add
`shared/storage-budget.js` — a `set()` wrapper surfacing QUOTA failures plus a per-bucket
byte roll-up in Suite Health, amber past 80%; (c) add `docs/storage-keys.json` — one row
per key: owning module, PHI class (none / UUID-only / free-text), retention, backup scope
— with `scripts/check-storage-keys.js` failing CI on unregistered keys and verifying
declared retention against each module's actual prune constant. That PHI register is half
a DPIA and must exist _before_ items 2 and 9 add new UUID-keyed stores. Seed v1
mechanically so the gate starts green. **Impact: high · Effort: small.**

### 9. Practice metrics warehouse — alarm-driven daily capture with honest provenance

**Both judges: keep, "a real bug dressed as a feature request."** The suite's only
longitudinal series (`practice.reportSnapshots`, `condor.dayScores`) is written only on
days someone opens the Condor tab, so every trend chart quietly lies. Move capture to a
fourth `chrome.alarms` job in `service-worker.js` (alongside SLOTS/RM/UPDATE), stamp
every row `captured: 'alarm'|'panel'|'missing'` so absent days render as gaps rather than
zeros — and **an unauthenticated fetch must write `missing`, never a zero row**. Widen
the row incrementally (per-type demand, slots offered vs remaining, waiting-room depth,
request-age buckets, submissions RAG, sweep gap counts), aggregate-only, with
`shared/io/metrics-io.js` + VALID_SCOPES per the backup convention. **Why now:** the
2026/27 GP contract adds improvement-against-your-own-2-year-baseline scoring — a
baseline that can never be back-filled; the clock starts when this ships. Follow-on
(judge-trimmed): extract rota's demand projector (`rota/engine/demand.js`, the good one
of the suite's four disagreeing demand numbers) into a shared `engine/forecast-core.js`
consumed by Capacity/Condor/Practice Report — ship the extraction, leave the scenario
levers. **Impact: high · Effort: medium.**

### 10. Information-architecture pass — grouped nav, sectioned Options, one "Tidy this record" menu

**Judges: keep parts 1, 3, 4; micro-tours optional.** The side panel has 23 tabs with
scroll-fade compensations; Options is 24 flat unlabelled buttons with zero tour coverage;
and Medicus's Clinical Summary page now carries four separate suite-injected buttons
("Clean up code", "Bulk remove?", "Organise problems?", "Clean up allergies?"). (1) Add a
`group` field to `side-panel/tab-catalog.js` (already the CI-guarded source of truth) and
render clustered, labelled nav sections in panel + pop-out — keep Ctrl+K and role presets
as the fast paths, ship a "flat list" escape hatch. (3) Group Options into Clinical rules
& safety / Reception & workflow / Data & integration / Admin & backup, with a filter box.
(4) Collapse the four Clinical Summary buttons behind one "Tidy this record ▾" menu —
the part the GP judge "would notice most," and it shrinks four injection surfaces to one.
Per-tab micro-tours can follow for user three; don't gate this on them. **Impact: high ·
Effort: medium.**

---

## Fix-now bugs the swarm surfaced (not roadmap items — just do them)

- **`V1_DEFAULT_MODULES` in `shared/io/practice-profile.js` covers 5 scopes while
  `VALID_SCOPES` has grown past 20** — applying a practice profile silently skips most
  modules. Both judges: fix today, independent of any roadmap decision.
- **QOF 2026/27 content fast-follow** — the published contract changes (two
  obesity/weight-loss-injection referral indicators, the 8-process diabetes composite,
  MMRV alignment) are a `rules/qof-rules.json` + `defaults.json`-version-bump content
  chore the shipped-config migration machinery was built for. Not a "development"; a
  currency obligation.

## Judged and deliberately not in the Top 10

- **On-device LLM features (Chrome Prompt API / Gemini Nano)** — technically viable now
  and the only LLM path compatible with the no-egress posture, but the skeptic killed the
  concrete proposal: any AI feature reopens the intended-purpose statement and DCB0129
  hazard case for a two-user tool that wins _because_ it does no inference. Revisit only
  as a maintainer-side rule-authoring aid, after item 5's gate exists to fail it closed.
- **Panel index / population cohort scanner** — killed: background-scanning the whole
  list from an extension is a different product with a different risk profile.
- **Estate view / verified update channel** — the SHA256SUMS-verified self-reload and
  `apply.pinnedVersion` are worth doing when convenient; the two-workstation dashboard is
  ceremony ("when Nick's build is stale, Dave can ask him").
- **MESH / GP Connect integration** — the research is clear: HSCN-only, CSO-registration,
  second-NHS-facing-system territory. The safety-claim gate encodes "not until the
  paperwork exists."

## Suggested sequencing

**Wave 1 (small, this month):** 5 (gate + Supabase permission removal) → 8 (storage) →
7 (sign-off gate) → fix-now bugs. These are days each and everything else builds on them.
**Wave 2 (the two big safety builds):** 1 (coded matching) and 3 (injection canary) in
parallel lanes; 6 (surveillance) alongside as a small win; 9 starts its baseline clock.
**Wave 3 (the strategic build):** 2 (Recall Loop v1) once 5's hazard-log discipline is in
place — it's the largest item and the one that answers the competitive scan. 4 and 10
slot in as the UX lanes between waves.

---

_Full swarm outputs: 4 research reports, 36 expert proposals and 72 challenge verdicts —
run journals under the session's workflow transcript directories; re-run with
`Workflow({scriptPath: ".claude/workflows/medicus-research-swarm.js"})` then feed the
digest to `medicus-expert-swarm`._
