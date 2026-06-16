# CQC evidence pack — build plan (v1)

Status: **PLAN — not yet built.** Folds the Practice-panel reaction (R-A..R-D) into the
research scoping (`CQC-EVIDENCE-PACK-SCOPING.md`). Report-only until signed off. Clinical-
rule additions route through **The Keeper**; UI through the existing report engine.

## 1. What we're building (and the one-line pitch)

A **CQC Inspection Readiness** feature for the Medicus Suite that produces, from read-only
Medicus data, the *Processes* and *Outcomes* evidence CQC scores under **Safe** and
**Well-led** — framed honestly as **supporting evidence, never proof of compliance**.

Two modes (the panel's biggest steer, R-A):

- **Mode 1 — Readiness check (internal, the default).** A self-audit for the practice:
  "are we inspection-ready?" RAG-rated, gap-led, with *what to fix before CQC arrives*.
  This is what the partner (Margaret) actually wants and is the low-risk core.
- **Mode 2 — Evidence export (opt-in, gated).** A credibility-stamped PDF a manager can
  put in the wider pack, produced only **after an explicit "I have reviewed these figures"
  step**. Never the default; never auto-handed to an inspector.

Both reuse the Practice Report engine (print→PDF, section gating, credibility stamps) and
are organised **by CQC quality statement**.

## 2. Non-negotiable requirements (clinical-safety-critical — from the panel)

These are requirements, not polish:

1. **Coverage manifest, front-and-centre (R-B).** Every output opens with: which drugs and
   **brands** are covered, the **coded-drug basis** of each cohort, an explicit
   **"coded data only — results filed as scanned letters/free text are not counted"**
   caveat, and the **date the drug-matching was last reviewed against BNF/dm+d**. Plus a
   **reconciliation hook** (a reproducible cohort definition the practice can run in
   Medicus to check the count). Rationale: the silent undercount is how harm hides
   (Eileen), and it is what a pharmacist inspector probes first (Raj). Reuses the existing
   `test-drug-brand-coverage.js` discipline and `shared/rule-currency.js`.
2. **Per-figure provenance inline (R-C / Janet's gate).** Every count carries its
   **denominator definition + "as at" timestamp on the same line**, not a footnote.
   Snapshot semantics: a fixed as-at; re-running must not change unexplained.
3. **Clinical precision (R-C / Raj).** Do **NOT** bundle "anticoagulants" — warfarin (INR)
   and DOACs (renal/weight) are separate cohorts with separate monitoring. State the
   **monitoring interval applied per drug and its source** (intervals vary by
   stability/initiation). **Disclose coverage + version** of every indicator set used —
   which of the 13 PINCER indicators, which ACB scale, which STOPP/START version.
4. **The honest-bound disclaimer on every page** — "supporting evidence for the Safe and
   Well-led processes/outcomes only; not proof of compliance; does not cover patient
   experience, staff/partner feedback or observation."
5. **No clinical-alert salience reduced; no fabrication.** Omit what we can't derive
   (consistent with the suite's ethos), state limits plainly.

## 3. Architecture

- New surface `cqc-readiness.{html,css,js}` (sibling to `practice-report.*`), reusing the
  report engine's print + credibility plumbing and the `view`/section pattern.
- A data layer `engine/cqc-evidence.js` (or `side-panel/.../cqc/`) that assembles evidence
  items from existing sources — pure aggregation + a fetch orchestrator, mirroring
  `report-data.js`. Pure logic unit-tested.
- **Mode** is a top-level toggle (Readiness | Evidence export); Evidence export requires
  the review-confirm step before it will render/print.
- Organised by quality statement; each item tagged with its evidence category
  (Processes / Outcomes) and its source module.

## 4. Phased scope

- **P0 — Cohort-enumeration feasibility spike (gates the counts).** Can the extension list
  "all patients on drug X + their last monitoring date" from Medicus read-only? Same class
  as the referrals-discovery spike. Outcome decides whether P2/P3 counts are achievable or
  the pack stays processes-led. **Do this first.**
- **P1 — Readiness check, processes + currency (ships regardless of P0).** The panel's
  most-wanted, lowest-risk core:
  - Rule-currency / Keeper provenance: the monitoring rule-set in use, versions, dates last
    reviewed vs BNF/NICE/MHRA — the standout "we can't get this elsewhere" evidence.
  - The Safety-Monitoring categories (#140) and the rule inventory the practice runs.
  - Operational-governance section (reuse the Practice Report's demand/capacity/activity —
    *in the internal readiness view only*, not the inspector pack).
  - The coverage manifest (Req 1) and the per-page disclaimer.
  - RAG readiness summary + "what to fix" list + "what good looks like" standards + a
    "what changed since last run" delta (Janet).
- **P2 — High-risk drug monitoring counts (only if P0 succeeds).** Un-bundled cohorts
  (lithium / methotrexate / amiodarone / warfarin / each DOAC) with in-date vs overdue +
  overdue-by-duration, each with inline denominator + interval-applied + reconciliation.
- **P3 — Hazardous prescribing + burden counts.** PINCER (disclosed subset of the 13),
  ACB high-burden cohort (named scale) — aggregating the existing per-patient engines
  (`visualiser-core.js`, `engine/acb-scores.js`).
- **P4 — Net-new clinical features (via The Keeper).** **Valproate PPP tracker (top
  priority)** and **clozapine/CMAS monitoring**; interval-precision and brand-completeness
  work on the high-risk rules; an **MHRA/CAS/NPSA alert-response log** (received →
  disseminated → actioned, dated).

## 5. Scope placement decisions (from the panel)

- **QOF:** narrowed or dropped from the inspector pack (a read-only tool shouldn't imply it
  validates QOF the practice's own system reports). May appear in the internal readiness
  view as context only.
- **STOPP/START deprescribing candidates:** **internal readiness view only**, not the
  inspector pack (an inspector seeing a candidate list may ask "why not actioned?").
- **Demand/capacity/activity:** internal readiness view only; stays primarily in the
  Practice Report.

## 6. What it must NOT do

Claim compliance or completeness; replace the four human evidence categories; present any
count without its cohort definition + as-at + coverage caveat; auto-produce the inspector
export without the review-confirm step.

## 7. Tests + delivery

- Pure-logic unit tests for the evidence assembler (cohort definitions, RAG thresholds,
  coverage-manifest completeness, the snapshot/provenance fields).
- A privacy/safety test: the coverage manifest is always present and the disclaimer renders
  on every page; the inspector export cannot render without the confirm step.
- Brand-coverage remains guarded by `test-drug-brand-coverage.js`; clinical rules via The
  Keeper with its own regression tests.
- Version bump + CHANGELOG when built; harness-verify the surface in both modes.

## 9. Panel re-review (synthetic) — they now agree

The revised plan went back to the same four personas. **All moved up and endorsed the
direction:** Margaret **4→7**, Eileen **6→8**, Janet **7→9**, Raj **7.5→9** (mean ≈5.9 →
≈8.25). The two-mode / internal-first split and the front-and-centre coverage honesty were
singled out as the changes that turned it around ("the difference between a tool and a
trap"). A focused set of second-pass asks — fold these into the build (most are wording/
placement tightening, not new scope):

- **A1 · Provenance must be INLINE prose, not a tooltip/modal/appendix (Janet + Raj,
  convergent — the gating item for both).** For every count: the denominator, the "as at"
  time, AND the monitoring **interval applied + its source** must be readable on the same
  line/screen with **no interaction**, in human prose ("Patients on the active list with a
  coded lithium prescription in the last 6 months, as at 09:14 on 3 Jun 2026 — 14"), never
  a code string or filter expression. Strengthen Req 2/3 wording to forbid tooltip-only.
- **A2 · Show the raw matched-drug strings (Eileen).** The coverage manifest must include
  the actual coded drug-name strings the tool matched (sample or full), so a clinician can
  eyeball completeness ("I don't see the slow-release formulation"). Add to Req 1.
- **A3 · Surface The Keeper's review cadence + trigger, owner-facing (Margaret — her
  remaining gap).** The readiness view must state HOW a rule is flagged "needs review vs
  current guidance" (calendar? MHRA/NICE publication? manual cycle?) and the last review
  date, so the partner can answer "when was this last checked?" with a real *process*, not
  "the system flagged it." Frame rule-currency as the practice's maintenance process.
- **A4 · Chase-attempt history on overdue lists (Eileen).** Distinguish "overdue WITH
  documented chase" from "overdue, no contact attempt" — clinically very different. Likely
  hard (attempts may live in free text/tasks); if so the plan must **say so honestly**
  rather than imply the overdue list alone is sufficient. The suite already *generates*
  recall letters/SMS (action-packs + v3.107 letterhead) — tracking attempts is the new bit.
  P2/P3, with the honesty caveat.
- **A5 · ACB / coded-data systematic-undercount caveat (Raj).** State in-output that ACB
  (and monitoring counts generally) under-count because PRN/OTC use and secondary-care-
  initiated meds/results not coded on the GP record are invisible — treat counts as a
  floor, not a ceiling. Extends the coded-data caveat (Req 1).
- **A6 · PINCER fidelity, not just coverage (Raj).** Disclose not only WHICH PINCER
  indicators are implemented but whether each coded definition is validated against the
  original PINCER definition or is a reasonable approximation. Add to Req 3.
- **A7 · Delta vs explicitly-anchored saved runs (Janet).** The "what changed since last
  run" delta must compare two runs the user deliberately saved/anchored, not whatever a
  background run last produced.
- **A8 · Governance decisions, not just product (Raj).** (i) If the P0 cohort spike finds
  coded data too inconsistent for reliable enumeration, the drop-vs-caveated-ship call is a
  **clinician sign-off**, not a product one. (ii) **Clozapine/CMAS** must have a committed
  trigger/date in P4, not be deferred indefinitely (sentinel-event category).

None of these change the architecture or the honest framing; they tighten placement,
disclosure and governance. A1 and A3 are the two that gate the highest scorers' full
confidence.

## 8. Recommended first step

Build **P1 (readiness check, internal)** — it needs no cohort enumeration, is the mode the
panel wants first, and turns the existing rule-currency/Keeper provenance into a credible
artefact. Run the **P0 spike** in parallel to decide whether the P2/P3 counts are in reach.
