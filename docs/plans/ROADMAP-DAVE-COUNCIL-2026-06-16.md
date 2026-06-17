# Roadmap — the Dave council, 2026-06-16

Five opus "Virtual Dave" seats reviewed **this repo** (each spawning sonnet/haiku
deep-divers) through five lenses — clinical safety, operational/compliance,
in-consultation UX, architecture/safety-by-design, and trust/evidence/audit — to set the
next iterations. Constraints honoured: **no expansion to other EHRs** (the suite stays
read-only on top of Medicus), and the house ethos throughout (read-only, zero PHI
exfiltration, deterministic floor, explicit clinician review gates, audit everything,
on-device over cloud-AI; safety **by architecture**, not by review).

**The through-line all five seats hit independently:** the product's risk isn't
vapourware — the features are real. It's **silent failure**: gaps that look exactly like
"all clear" and keep CI green and screenshots clean. Every step below attacks that.

> **Chair's verification.** The seats are persona-confident; each load-bearing claim below
> was checked against source. **Verified** and **Needs-verification** are tagged honestly —
> two seat claims were downgraded on inspection (noted inline).

## The 5 steps (value-ranked)

### 1. Producer→consumer contract-test layer + one renderer per chip
*Converges: architecture #1/#2, safety (CQC render), in-consult (ACB), and the CQC
contract-drift that already shipped four bugs.*

Pipe **real engine output through the real renderers** for every chip type **and the
result-triage path** (`evaluateReportSeverity` → `selectResultChips`), and add a
**CSS-class-coverage assertion** so a renderer can't emit a class the stylesheet lacks.
Then collapse the duplicated render/scoring paths onto single canonical sources.

- **Why:** this is the wound that's already bled. The CQC engine↔renderer field-name drift
  shipped four content-dropping bugs caught only by a post-hoc sanity check (CHANGELOG
  v3.108.2). The pattern recurs and the tests don't catch it because producer and consumer
  are each tested against their *own* hand-built shape.
- **Verified bugs this would have caught / should fix as the quick win:**
  - **CQC RAG badges render unstyled** — `cqc-render.js:36` emits `cqc-badge cqc-badge-*`;
    `cqc-readiness.css` has **zero** `.cqc-badge-*` rules (only `.cqc-rag*`). The "colour +
    word, never colour alone" doctrine is defeated when the colour's gone. (Verified.)
  - **Second sentinel renderer** — `content-scripts/sentinel.js:788/818/851` hand-rolls
    `drugChipHtml`/`qofIndicatorChipHtml`/`qofRegisterChipHtml`, a divergent copy of what
    the panel gets from `shared/chip-renderer.js`. The *in-record overlay* (most
    safety-critical surface) is the untested one. (Verified.)
  - **Two ACB scorers** — `content-scripts/triage-lens/content.js` (~1176) hardcodes its
    own anticholinergic table and imports `engine/acb-scores.js` **zero** times; the two
    lists differ. Same patient, same screen, two possible scores. (Verified.)
- **Ethos fit:** the suite's whole safety claim is "the chip you see is what the engine
  decided" — this proves it in CI. **Effort:** S/M. **Risk if not done:** a renamed field
  silently drops a clinical chip; all lights stay green.

### 2. Clinical Event Ledger — durable, PII-free, exportable "prove it watched"
*Converges: trust #1, architecture #4, ops #1 (MHRA/CAS log folded in).*

Promote `suite.alertLog` (today a 50-entry, counts-only, backup-excluded *demand-strip*
breadcrumb — `panel.js:1147`) into an append-only **on-device ledger** of every clinically
meaningful event the suite surfaces: a monitoring chip firing (rule id + severity, hashed/
initialled patient token like `reception.js:87`, **never a name**), a triage red-flag, a
**reception 999/duty escalation** (verified: today only a form *draft* is kept — the
escalation itself leaves no trace), a lab-flag escalation, a rule/threshold change, a
backup import. Ride a **practice-authored MHRA/CAS alert-response log** (received →
disseminated → actioned, dated) on the same substrate — the one Well-led evidence artefact
CQC asks for first and the suite genuinely lacks (verified: no MHRA/CAS feature exists).

- **Why:** when a clinician asks "did the tool flag this?", the honest answer today is "we
  can't say" — there is **no persistent audit log** anywhere (verified: no `auditLog`/
  `logEvent`/ledger in the codebase). `VISION`/`INTENDED-PURPOSE` lean on "audit everything";
  this is the one promise the code doesn't keep outside the demand strips.
- **Ethos fit:** PII-free by construction, local-only, manual export — adds the trust
  without spending a drop of the safety case. **Effort:** M. **Risk:** storage growth (prune
  by age like `condor.dayScores`); log *events*, never patient state.

### 3. Kill the silent-missing-alert disease: coverage-completeness CI + canonical term lists + a real CSO-review ledger
*Converges: safety #2/#4, architecture #3, and the duplication smell every seat hit.*

Three strands of the same disease — a missing alert that looks like "all clear":
- **Brand/term completeness detector in CI** against a pinned offline dm+d/BNF snapshot:
  fail the build if a `drug.match` list (or the JS term tables) misses a live UK brand. The
  current defence is a human typing brands into `EXPECTED` + a regression test that only
  re-checks brands a human already thought of. (The last Keeper run's WebFetch 403'd, so
  verification silently degraded to WebSearch — worth confirming, but the structural gap is
  real.)
- **Canonicalise the drifted class-term lists.** Verified: anticholinergic/NSAID/aspirin
  term lists are hand-duplicated across `content.js`, `engine/stopp-start.js`,
  `engine/acb-scores.js`, `rules/alert-library.json` and `visualiser-core.js` and **have
  already drifted**. `ASPIRIN_TERMS = ['aspirin 75','aspirin 300','aspirin tablet',
  'aspirin dispersible']` (`stopp-start.js:85`) silently misses "aspirin 75mg
  gastro-resistant tablets" *today*. One canonical class-term source.
- **Replace the doc-gate `KNOWN_STALE` theatre.** Verified: `CLINICAL-SAFETY-NOTICE.md` and
  `HAZARD-LOG.md` are pinned at **3.64.0** while the manifest is **3.113.x** — ~49 minor
  releases of clinical-safety-doc delta laundered into a green WARN. Replace the hand-edited
  pin list with a machine-readable **"releases since last CSO hazard review"** ledger that
  climbs and goes red past a threshold — make staleness loud and quantified.
- *Needs-verification (do this first, don't fix blind):* the clinical-safety seat flagged a
  **dismissed-chip resurfacing inversion** (a worsening chip that never returns). On
  inspection `STATUS_RANK` has `overdue:0` above `stale:1`, so the seat may have read the
  severity direction backwards — **audit the resurfacing path before touching it.**
- **Effort:** M. **Ethos fit:** turns "a clinician notices a missing alert months later"
  into "CI fails on the PR"; CSO-gated clinical changes route via The Keeper as today.

### 4. In-consultation "Copy patient summary" on the Record tab
*From the in-consult seat — the biggest second-saver in clinic.*

One button on the live Record tab: a **deterministic plain-text block of exactly what's on
screen** (demographics, problems, meds, results, ACB, STOPP/START — already rendered in
`record.js`), with the "snapshot, not the full record — verify before acting" caveat baked
**into the copied text**. Clipboard, never the record.

- **Why:** the suite shows the GP the whole picture and then makes them retype it into the
  note. Seconds × 40 patients × every clinic — that's where the 8-minute appointment bleeds.
  Verified: there is no copy-ready output on the Record tab or the in-record HUD today.
- **Ethos fit:** display-copy only — **no inference, no scribe, no summarising the
  consultation**; provenance-stamped; deterministic. Kill scope-creep toward "impression"
  text on sight. **Effort:** S/M. (Sibling quick win: a **patient-scoped command palette**
  — when a record is open, Ctrl+K offers read-only "copy summary / jump to Trends / open
  visualiser for *this* patient".)

### 5. Honest figures across the operational reports + a provenance canon
*Converges: ops #2/#3, trust #2/#3, and the P0 cohort spike's honest answer.*

- **Fix the capacity dead-branch** (verified: `report-data.js:246`
  `const allowed = hiddenTypes ? null : null;` — both branches null, so the Practice Report
  counts *all* slot types while live Condor honours `hiddenTypes`; the printed report can't
  reconcile to the screen it summarises). Add a **prior-period comparison** row and label the
  unlabelled `slots * 0.8` verdict threshold.
- **Ship the cohort reconciliation hook** as the grown-up answer to the P0 ceiling
  (`CQC-P0-COHORT-SPIKE.md`): the suite states the **reproducible cohort definition + coverage
  caveat** per high-risk drug; the practice's own validated search supplies the count. Do
  **not** build a register-wide fan-out — the spike proved it's not reachable read-only, and
  reaching for it is how the suite drifts outside its frozen intended purpose.
- **Start a `shared/provenance.js` canon** (one `as-at` formatter, one "coded data only —
  floor not ceiling" caveat, a helper that *requires* a denominator) so every figure across
  Slots/Capacity/Submissions/Activity/Referrals/Condor carries the furniture the CQC engine
  already nails — and add a **backup-envelope integrity hash** (`suite-envelope.js` stamps
  provenance but no checksum; label it "integrity check, not a signature").
  *A systematic sub-agent sweep mapped the exact gaps (verified): today only `freshness.js`
  (fetch-time, no denominator) is shared and the rich `provenanceLine` is CQC-only; bare,
  un-stamped figures live in Capacity (`capacity.js:322/342/526`), Today
  (`today.js:339/460/487`), the Condor waiting-room card, Referrals/Activity (no
  population/denominator note), and the Visualiser (no "record exported as at" date). The
  "no alert ≠ all-clear" caveat is itself triplicated across `sweep.js:1048`,
  `sentinel.js:1012`, `reception.js:367` — fold it into the canon too.*
- **Effort:** S (capacity fix + threshold label) → M (prior-period, reconciliation hook,
  provenance canon). **Ethos fit:** this is mostly *removing over-claim* — make the figures
  reconcile and carry consistent provenance.

## Continuous track (not one of the 5; via The Keeper)

Net-new clinical depth, all through The Keeper's verifier-confirmed, CSO-gated,
never-auto-merged flow: **Valproate Pregnancy-Prevention** prompt (highest-profile MHRA
programme; `drug-combo`/`composite`, scoped as a *supporting prompt*, never "confirms PPP
compliance") and **clozapine/CMAS**; and deepening **ACB / STOPP-START** from token coverage
(~10% of v3, with a hole in the score-2 anticholinergic tier that breaks two instruments at
once) toward usable, structured-data-computable coverage.

## How the council ran (reproduce)

5 opus Virtual-Dave seats (`.claude/agents/virtual-dave.md`), each grounded in the code and
free to spawn sonnet deep-divers → haiku searchers. Chair (orchestrator) verified every
load-bearing claim against source before adoption; 6 confirmed, 2 downgraded. Report-only —
no code changed in producing this roadmap.
