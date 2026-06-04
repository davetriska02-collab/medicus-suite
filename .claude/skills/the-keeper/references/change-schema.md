# Proposed-change schema, run metadata, and taxonomy

This is the contract every stage hands on. Scanners produce **candidate change** objects in this
shape (provenance partly empty). Verifiers complete the provenance or mark the candidate killed. The
orchestrator applies the surviving changes to the rule files and writes them to `changes.json`, which
`scripts/build_report.js` turns into the CSO change-proposal report.

A "change" here is always *a proposed delta to a rule file*, never free text. It must say what the
rule encodes now, what the source says now, and the exact edit.

## Change object

```json
{
  "id": "drug-001",
  "domain": "drugs",
  "rule_file": "rules/drug-rules.json",
  "rule_id": "lithium-maintenance",
  "change_type": "add-brand",
  "title": "Add missing UK lithium brand to match list",
  "current": "drug.match lists priadel, camcolit, liskonum, li-liquid but not <brand>.",
  "proposed": "Add \"<brand>\" to drug.match.",
  "source": "BNF lithium monograph / dm+d",
  "source_url": "https://bnf.nice.org.uk/drugs/lithium-carbonate/",
  "source_date": "2026-05",
  "rag": "Red",
  "rationale": "Substring matching means a script written as '<brand>' currently never fires the lithium monitoring alert — a silent monitoring gap.",
  "test_update": "Add '<brand> 400mg MR tablets' to EXPECTED['lithium-maintenance'] in test-drug-brand-coverage.js.",
  "weakens_safety": false,
  "needs_engine_change": false,
  "window_status": "new",
  "provenance": {
    "verified_by": "VERIFIER-A",
    "method": "fetched source page",
    "confidence": "high",
    "checked_at": "2026-06-04T02:14:00Z",
    "evidence": "Short factual paraphrase of what the source page states. Never a long quote."
  }
}
```

### Field rules

- `domain` is one of: `drugs`, `qof`, `vaccines`, `alerts`. Maps to the report sections in the order
  below.
- `rule_file` is the file edited; `rule_id` is the `id` of the rule being changed, or `"(new)"` for a
  brand-new rule.
- `change_type` is one of:
  - `add-brand` / `add-match-term` — extend a `match` / `problemMatch` list (the commonest safe win).
  - `add-rule` — a new monitoring rule, QOF register/indicator, vaccine, or alert.
  - `change-interval` — alter a monitoring `intervalDays` / `dueSoonDays`.
  - `change-tests` — add/remove a monitored test on a drug rule.
  - `change-threshold` — alter an alert or QOF threshold / age band / window.
  - `change-eligibility` — alter a vaccine cohort or `problemMatch`/`problemExclude` set.
  - `add-exclude` — add a `drug.exclude` / `problemExclude` term (sharp — see below).
  - `retire-indicator` / `disable-rule` — mark a rule `enabled: false` (QOF year diff convention).
  - `update-source` — correct only the `source`/`notes`/SNOMED provenance, no behaviour change.
- `current` / `proposed` are plain-English statements of the existing encoding and the exact edit.
- `rag` is one of `Red`, `Amber`, `Green` (taxonomy below).
- `rationale` says **why** in terms of patient impact — name the silent-failure angle where relevant.
- `test_update` names the regression-test edit that locks the change in (mandatory for any
  `match`/`exclude` change per `CLAUDE.md`), or `"none"` if no test covers it (then say so).
- `weakens_safety` is `true` for any change that could reduce alerting: lengthening an interval,
  removing a test, narrowing a match, adding an exclude, disabling/retiring a rule, raising an alert
  threshold. These need explicit CSO sign-off and are listed in their own report block. Default
  `false`.
- `needs_engine_change` is `true` when the change can't be expressed in JSON alone (e.g. multi-drug
  AND logic, multi-observation bundle) and needs a `rules-engine.js` extension — propose it but ship
  the rule disabled with a placeholder, matching the existing convention.
- `window_status` is `new` or `previously-flagged` (proposed in a prior run, still open).
- `item_url`/`source_url` must be the exact source page, not a generic landing page, where possible.

## Provenance rules — the anti-hallucination spine

Provenance is mandatory. **No provenance, no edit.** This is the whole point of the skill and Dave's
explicit requirement.

- Every change must carry a real `source_url` and a real `source_date`/version. A candidate without
  both is dropped at the scanner stage and never verified.
- Every Red and Amber change must be verified by `method: "fetched source page"` — the verifier opens
  the actual source and confirms it says what the change claims, that it is current, and that the
  edit is not overstated.
- Green changes may be `method: "corroborated"` (a reliable second source) but a fetched page is
  preferred.
- `confidence` is `high` only when the source page was fetched and matches. `medium` for
  corroborated-but-not-fetched. Anything `low` is killed, not applied.
- `evidence` is a short factual paraphrase of what the source says — never a long quote. It exists so
  Dave can sanity-check the change without opening the link.

A killed candidate is returned to the orchestrator as:

```json
{ "id": "...", "killed": true, "reason": "could not confirm against source / not current QOF year / duplicate of drug-003 / scanner overstated; real change is trivial / source merely permits, does not mandate" }
```

## RAG taxonomy

- **Red** — the rule has drifted in a way that affects patient safety *now*. Examples: a monitored
  drug has a UK brand the `match` list misses (silent monitoring gap); a BNF monitoring interval has
  shortened and the rule is now too lax; a new MHRA contraindication is unflagged; a current-season
  vaccine cohort is missing. Apply when verified; flag any that weaken safety for sign-off.
- **Amber** — the rule should be updated to stay current but no immediate patient-safety gap.
  Examples: a new QOF indicator for the year, a new clinically-indicated monitoring rule, a widened
  eligibility cohort, a new PINCER/KTT alert worth shipping.
- **Green** — housekeeping only. Examples: a `source`/`notes` wording refresh, a SNOMED code tidy, a
  retired prior-year indicator to keep disabled for diff visibility, a confirmed "still current — no
  change" note.

## Report section order

The builder renders sections in this fixed order. Each maps to one `domain` value.

1. Medicines monitoring — `drugs`
2. QOF registers and indicators — `qof`
3. Vaccine eligibility — `vaccines`
4. Prescribing-safety alerts — `alerts`

The "Changes needing CSO sign-off" box at the top is built automatically from every change with
`weakens_safety: true`, across all domains. The "Action this run" summary lists all Red changes.

## Run metadata object

Written to `run-meta.json`. Drives the report title block and appendix.

```json
{
  "practice_name": "Witley and Milford Surgery",
  "baseline": {
    "drug-rules.json": "2026-06-03",
    "qof-rules.json": "QOF 2026/27",
    "vaccine-rules.json": "2025/26 season",
    "alert-library.json": "1.0 / 2026-05-28"
  },
  "generated_at": "2026-06-04",
  "manifest_version_before": "3.28.0",
  "manifest_version_after": "3.28.1",
  "sources_checked": [
    "BNF monitoring requirements",
    "BSR shared-care guidelines",
    "MHRA Drug Safety Update",
    "NHS England QOF guidance 2026/27",
    "NICE indicator menu",
    "UKHSA Green Book",
    "JCVI advice / annual flu letter",
    "PINCER indicators",
    "NICE Key Therapeutic Topics"
  ],
  "rule_files_touched": ["rules/drug-rules.json"],
  "tests_run": ["test-drug-brand-coverage.js"],
  "tests_passed": true,
  "excluded_low_relevance": 0,
  "source_gaps": []
}
```

- `excluded_low_relevance` — count of real-but-trivial candidates deliberately left out, reported as
  a single transparency line.
- `source_gaps` — any source that could not be reached this run (moved, login wall, timeout), so a
  gap is visible rather than silent.
- `tests_passed` — must be `true` before a change is proposed; if `false`, the report says which
  test failed and the changes are not pushed.
