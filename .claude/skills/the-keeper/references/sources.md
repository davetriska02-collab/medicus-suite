# Source register

The canonical list of authoritative UK sources the Sentinel rule files are derived from, grouped by
scanner domain. URLs drift, so this file is the single place to maintain them. When a scanner reports
a `source_gap`, check and update the relevant entry here in the same run, so the register self-heals.

Each scanner searches and fetches **within its block only**. Its job is to compare what the source
says *today* against what its rule file currently encodes, and report the drift as candidate changes
(schema in `change-schema.md`). Where a source lists a dated item or a versioned document, prefer the
exact dated/versioned page as the `source_url`.

---

## DRUGS scanner — owns `rules/drug-rules.json` (and the coverage test `test-drug-brand-coverage.js`)

The currently-monitored drug families are DMARDs (methotrexate, leflunomide, hydroxychloroquine,
azathioprine, sulfasalazine), carbamazepine, lithium, amiodarone, carbimazole/PTU, ACE/ARB,
spironolactone, SGLT2 inhibitors, GLP-1 agonists, DOACs, statins, allopurinol, antipsychotics,
mirabegron, levothyroxine, systemic HRT, ADHD stimulants (paediatric + adult), atomoxetine,
guanfacine. Check each rule's brand set, tests and intervals against:

- **BNF (monitoring requirements)** — the primary source for blood-test monitoring and intervals:
  https://bnf.nice.org.uk/ (drug monograph → "Monitoring requirements"; and the summary of changes:
  https://bnf.nice.org.uk/about/changes/)
- **BNF / dm+d / emc for the complete UK brand set** — brand-list completeness is mandatory (a
  missing brand silently fails to fire). Cross-check current UK-marketed brands (including
  discontinued ones, since repeat prescriptions persist) against:
  https://bnf.nice.org.uk/ , the dm+d browser, and https://www.medicines.org.uk/emc
- **BSR / specialty shared-care guidelines** — DMARD monitoring intervals and initiation schedules:
  British Society for Rheumatology guidelines https://www.rheumatology.org.uk/practice-quality/guidelines
- **MHRA Drug Safety Update** — new contraindications, monitoring requirements, dose changes:
  https://www.gov.uk/drug-safety-update
- **Specialist Pharmacy Service (SPS)** — shared-care and monitoring summaries for primary care:
  https://www.sps.nhs.uk/
- **NICE guidance / CKS** — where a guideline sets monitoring (e.g. lithium, amiodarone,
  antipsychotics, allopurinol): https://www.nice.org.uk/guidance/published and
  https://cks.nice.org.uk/
- **SNOMED CT (drug/test codes)** — where `drug.snomed` or test `snomed` codes need confirming: the
  NHS SNOMED CT browser https://termbrowser.nhs.uk/

Domain-specific failure mode to watch: a generic term auto-covers its qualified generic forms
(`"lithium"` already matches `"lithium carbonate"`), so do **not** add those; but **every distinct
brand must be listed explicitly** or it never matches. Enumerate the complete current UK brand set.

---

## QOF scanner — owns `rules/qof-rules.json`

The file currently encodes QOF 2026/27 registers (DM, DEM, HYP, AF, CHD, …) and 46 indicators, with
retired prior-year indicators kept `enabled: false` for diff visibility. Check the register and
indicator set, thresholds, age bands and indicator windows against the current QOF year:

- **NHS England QOF guidance** (the definitive per-year specification, currently PRN02356 for
  2026/27): https://www.england.nhs.uk/publication/quality-and-outcomes-framework-guidance/ and the
  GP contract / QOF pages https://www.england.nhs.uk/gp/investment/gp-contract/
- **NICE indicator menu** (`NM###` / `IND###` IDs referenced in indicator notes):
  https://www.nice.org.uk/standards-and-indicators/qofindicators
- **QOF business rules** (the cluster/refset logic Sentinel approximates) — NHS England /
  NHS Digital business rules: https://digital.nhs.uk/data-and-information/data-collections-and-data-sets/data-collections/quality-and-outcomes-framework-qof
- **NICE guidance** underpinning a pathway when an indicator changes:
  https://www.nice.org.uk/guidance/published

Domain-specific note: Sentinel approximates SNOMED refsets with substring `problemMatch` /
`problemExclude`. When the guidance adds/retires an indicator or moves a threshold, age band or
window, propose the change *and* check whether the register's match/exclude terms still capture the
right cohort. Some indicators (multi-observation bundles, multi-drug AND logic) ship disabled with
placeholder definitions pending rules-engine extensions — note when a change needs an engine
extension rather than just a JSON edit.

---

## VACCINES scanner — owns `rules/vaccine-rules.json`

Currently encodes flu and COVID eligibility. Check cohorts, season-start dates, schedules and
status-coding terms against:

- **UKHSA Green Book** (Immunisation against infectious disease) — the per-disease chapters:
  https://www.gov.uk/government/collections/immunisation-against-infectious-disease-the-green-book
  (flu = Chapter 19, COVID-19 = Chapter 14a)
- **JCVI advice** — eligibility/cohort decisions, especially the seasonal COVID and flu cohorts:
  https://www.gov.uk/government/groups/joint-committee-on-vaccination-and-immunisation
- **Annual national flu immunisation programme letter** (the operational "flu letter" setting that
  season's eligible cohorts): search "national flu immunisation programme letter" + the season year,
  on https://www.gov.uk/
- **UKHSA vaccine update bulletin**: https://www.gov.uk/government/collections/vaccine-update
- **NHS England seasonal vaccination guidance** (operational eligibility):
  https://www.england.nhs.uk/

Domain-specific note: eligibility is the safety-critical part — a dropped cohort means eligible
patients are not flagged; an over-broad cohort flags the ineligible. The file already carries strong
"DOUBLE-CHECK ELIGIBILITY" caveats; preserve them. COVID eligibility has narrowed year-on-year
(clinical risk groups removed) — confirm the *current* season before widening or narrowing.

---

## ALERTS scanner — owns `rules/alert-library.json`

Currently a PINCER-based starter library of prescribing-safety alerts (drug-combo, composite,
event-count, observation checks). Check against:

- **PINCER indicators** — the prescribing-safety indicator set (PRIMIS / University of Nottingham):
  https://www.nottingham.ac.uk/primis/ and the PINCER indicator specifications
- **NICE Key Therapeutic Topics (KTTs)** — medicines-optimisation priorities:
  https://www.nice.org.uk/guidance/published?type=ktt
- **MHRA Drug Safety Update** — new contraindications and dangerous combinations worth an alert:
  https://www.gov.uk/drug-safety-update
- **STOPP/START** (potentially inappropriate prescribing in older people) — current published
  version, for candidate additions: search "STOPP START criteria version 3" on a primary source.
- **NICE CKS / guidance** — where a pathway implies a safety check:
  https://cks.nice.org.uk/ and https://www.nice.org.uk/guidance/published

Domain-specific note: alert-library rules are explicitly *editable starting points*. Favour adding
well-evidenced PINCER/KTT items and correcting drug-set completeness over re-tuning thresholds. The
`mustNotBePresent` "absence" logic and age bands are the parts most likely to drift — verify the
indicator's exact age/threshold against PINCER before changing it.

---

## Maintenance notes

- **Highest-value Red checks**, never let these slip if quota is tight: BNF monitoring-interval
  changes and brand-set completeness for the DMARDs and lithium (silent under-matching is the worst
  failure); the current-year QOF register/indicator add/retire list; and the current-season vaccine
  cohort definitions.
- **Cadence reality.** QOF changes annually (effective 1 April); the flu letter and COVID JCVI
  advice are seasonal (spring/summer for the coming autumn); BNF and MHRA DSU update continuously.
  On a run where a source has not changed since `state/last-run.json`, that is a legitimate "nothing
  to change", not a gap. Only log a `source_gap` when a source could not be reached at all.
- **If a URL 404s or moves, record the new URL here in the same run.**
