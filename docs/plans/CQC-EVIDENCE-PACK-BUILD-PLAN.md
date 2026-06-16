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

## 8. Recommended first step

Build **P1 (readiness check, internal)** — it needs no cohort enumeration, is the mode the
panel wants first, and turns the existing rule-currency/Keeper provenance into a credible
artefact. Run the **P0 spike** in parallel to decide whether the P2/P3 counts are in reach.
