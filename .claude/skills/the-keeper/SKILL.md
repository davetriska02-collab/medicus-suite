---
name: the-keeper
description: >
  Periodic currency-check for the Sentinel clinical rules engine. Scanner subagents sweep the
  authoritative UK sources that the rule files are derived from (BNF monitoring requirements,
  BSR/specialty shared-care protocols, MHRA Drug Safety Update, NICE guidance and CKS, the NHS
  England QOF guidance and NICE indicator menu, the QOF business rules, UKHSA Green Book and JCVI
  advice, PINCER and NICE Key Therapeutic Topics) and compare them against what
  rules/drug-rules.json, rules/qof-rules.json, rules/vaccine-rules.json and rules/alert-library.json
  currently encode. Two verifier subagents confirm every proposed change against its own source
  page. The orchestrator then applies only the verified, conservative changes to the rule files,
  updates the regression tests, and produces a Clinical-Safety-Officer change-proposal report on a
  review branch — it never auto-merges a clinical rule change. Use whenever Dave says run The
  Keeper, the keeper, rule watch, check the rules, are the Sentinel rules current, refresh the
  drug/QOF/vaccine/alert rules, is QOF up to date, or check our monitoring intervals, or when a
  scheduled rule-currency task fires. Do NOT trigger for ordinary feature work on the engine, a
  one-off "add this single drug" request (just edit the rule directly), or The Watch / Grand Round /
  The Regulator (those are different skills).
---

# The Keeper — keeping the Sentinel rules current

You are running The Keeper for Dr Dave Triska's practice (Witley and Milford Surgery). The Keeper is
a periodic horizon scan whose subject is **our own rule files**, not the news. It asks one question
of each rule the Sentinel engine ships: *does this still match what the authoritative UK source says
today?* It finds where a rule has drifted from its source, verifies every proposed change against
that source, applies the safe ones, and hands the practice's Clinical Safety Officer (Dave) a
sourced change-proposal to review.

The product is a **trustworthy, reviewable diff**, not volume. A rule file that silently invents a
monitoring interval, a drug brand, or a QOF threshold is worse than one that is honestly out of
date — because in this engine the failure is **silent** (see "Why this matters" below). The Keeper
exists to convert "a clinician notices a missing alert months later" into "a sourced change lands on
a PR this week."

## Why this matters (read before you touch a rule)

The project's own `CLAUDE.md` is explicit and you must internalise it:

- Drug matching is **case-insensitive substring** against `drug.match`. A med prescribed under a
  brand the rule doesn't list **never fires its alert** — no error, just a missing chip. That is a
  patient-safety risk, not a cosmetic one. So **brand-list completeness is the default expectation**:
  when you touch a `drug.match` list you enumerate the *complete current UK brand set* (BNF / dm+d /
  emc), not the generic plus a couple of brands.
- `drug.exclude` is sharp: an exclude string silently drops **every** med whose name contains it.
  Only ever add one to kill a genuine false positive, and always ask "could a real patient who
  *needs* this monitoring match this string?"
- The same silent-failure logic applies to QOF (`problemMatch`/`problemExclude`), vaccine
  eligibility, and alert-library combos. A too-narrow match misses patients; a too-broad exclude
  drops them.

This is why The Keeper's spine is **verification**, exactly as The Watch's is. Dave is the practice
Clinical Safety Officer. A change that misremembers a BNF interval or invents a NICE indicator is a
safety risk in its own right.

## Before you start

Read the context files in the Cowork folder if present, so relevance judgements fit this practice:
- `about-me.md` — practice profile, priorities, roles
- `voice-and-style.md` — tone and output rules

If absent, use these defaults: Witley and Milford Surgery, 11,500-patient rural **dispensing**
practice in Surrey, total triage on Medicus, West of Waverley PCN. Audience for the report is Dave
(CSO/partner), the PM (Bev Howard) and business manager (Martin Cripps). Because it dispenses,
medicines rules carry extra weight.

Then read these skill files and the current rule files before dispatching anything:
- `references/sources.md` — the canonical source register, one block per scanner domain
- `references/change-schema.md` — the exact proposed-change JSON every stage hands on, the
  provenance rules, and the RAG taxonomy
- `agents/SCANNER.md` — the scanner subagent brief
- `agents/VERIFIER.md` — the verifier subagent brief
- The four rule files under `rules/` — you are checking *these* for drift, so know their current
  contents and their `lastUpdated` / `specVersion` fields.

## The pipeline

Three stages: fast broad collection, then verification, then conservative application.

| Stage | Who | Model tier | Job |
|-------|-----|-----------|-----|
| 1 Scan | 4 scanner subagents, one per rule domain | Haiku (cheap fast tier) | For each rule in their domain, sweep the source register and report where the rule has drifted from source. Return structured candidate changes. Discard anything with no verifiable source URL. |
| 2 Verify | 2 verifier subagents | Sonnet | Re-fetch and confirm each candidate change against its source page. Kill the unsourced, stale or overstated. Right-size the RAG. Complete provenance. |
| 3 Apply | You, the orchestrator | Opus (this session) | Apply only the verified, conservative changes to the rule files. Update regression tests. Run the full test suite. Bump manifest + CHANGELOG. Write the change-proposal report. Push to a review branch. |

Model tiers are the intent; request Haiku for scanners and Sonnet for verifiers if your environment
supports per-subagent selection. If not, the discipline is what matters, not the literal tier.

## Stage 1 — Scan

Fire all four scanners in parallel in a single message with multiple subagent calls. Each scanner
gets: its domain block from `references/sources.md`, the **current contents of its rule file**, and
the `agents/SCANNER.md` brief.

| Scanner | Rule file it owns | Looks for |
|---------|-------------------|-----------|
| DRUGS | `rules/drug-rules.json` | New/withdrawn UK brands for a monitored drug; changed monitoring tests or intervals (BNF / BSR / specialty shared care); new drugs that warrant a monitoring rule; MHRA DSU changes to monitoring; SNOMED drift. |
| QOF | `rules/qof-rules.json` | New, retired or changed registers and indicators for the current QOF year; changed thresholds, age bands or indicator windows; NICE indicator-menu (`NM###`/`IND###`) changes; business-rules cluster changes. |
| VACCINES | `rules/vaccine-rules.json` | Eligibility-cohort changes (age bands, clinical risk groups, pregnancy); season-start changes; schedule changes; status-term coding changes. JCVI / annual flu letter / Green Book. |
| ALERTS | `rules/alert-library.json` | New or changed PINCER indicators; NICE Key Therapeutic Topics; new MHRA contraindication/interaction alerts; threshold or age-band changes; STOPP/START items worth shipping. |

Each scanner returns a JSON array of **candidate change** objects in the schema in
`references/change-schema.md`. A candidate with no real source URL and no statement of *what the
source says now vs what the rule encodes* is dropped at source and never passed on. Scanners
**propose**; they do not edit the rule files.

## Stage 2 — Verify

This is the spine of the skill. A tidy diff that invents a BNF interval, misdates a QOF year, or
overstates a JCVI change is a safety risk. Verification is not a polish pass.

Fire two verifier subagents in parallel:
- VERIFIER-A takes the DRUGS and ALERTS candidates — the dangerous-to-get-wrong, medicines-safety
  half. Verify with care, brand by brand, interval by interval.
- VERIFIER-B takes the QOF and VACCINES candidates.

Each verifier follows `agents/VERIFIER.md`. For every Red and Amber candidate it must fetch the
actual source page and confirm: the source genuinely says what the candidate claims; the change is
current (right QOF year / current Green Book chapter / in-date DSU); and the proposed edit is not
overstated. It spot-checks Green items, deduplicates, and returns verified candidates with
provenance completed, or a kill record with a reason.

Mandatory provenance on every surviving candidate: source name, exact source URL, the date or
version of the source, verification method (fetched source page, or corroborated), confidence, who
verified it, and the timestamp. **No provenance, no edit.** This is Dave's explicit requirement and
the whole point of the skill.

## Stage 3 — Apply, test, and propose

You assemble and apply. Be conservative and additive. You are editing live clinical-safety rules;
treat the existing rule as correct-until-sourced-otherwise.

### Conservative-application discipline (hard rules — mirror the safety-case sync)

- **Additive first.** Adding a missing UK brand to `drug.match`, adding a new clinically-indicated
  drug rule, adding a new QOF register/indicator, widening an eligibility cohort the source widened
  — these are the safe, high-value changes. Do these when verified.
- **Never silently weaken monitoring.** Do **not** lengthen a monitoring `intervalDays`, delete a
  test, narrow a `drug.match`, add a `drug.exclude`, disable a rule, raise an alert threshold, or
  retire a QOF indicator **unless** the verified source explicitly directs it *and* you flag the
  weakening prominently in the report as a change requiring CSO sign-off. When the source merely
  *permits* a longer interval (e.g. BSR's 6-monthly DMARD option after 12 stable months), keep
  Sentinel's safer default and describe the option in `notes`, exactly as the current file does for
  methotrexate.
- **`drug.exclude` stays sharp.** Only add one to suppress a genuine, named false positive, and
  record in the report which real patients it could affect.
- **Preserve structure and identity.** Don't restructure neighbouring rules, don't change rule
  `id`s (downstream overrides key on them), don't drop `source`/`notes` provenance already in the
  file. Retired QOF indicators are kept `enabled: false` to make the year-on-year diff visible —
  follow that convention, don't delete them.
- **Every edit carries its source.** Update or add the rule's `source` and `notes` so the file
  stays self-documenting, and bump the file's own `lastUpdated` / `specVersion`.

### Steps

1. **Apply** each verified candidate to its rule file by editing the JSON in place, honouring the
   discipline above. Group Red (safety-relevant drift) first.
2. **Update the regression guard.** Per `CLAUDE.md`: after changing any `match`/`exclude` you MUST
   extend the `EXPECTED` (and where relevant the must-NOT-fire) maps in `test-drug-brand-coverage.js`
   so the new brands/drugs are regression-locked. For QOF/vaccine/alert changes, extend the
   matching test (`test-qof-*.js`, `test-monitoring-chip.js`, `test-custom-*.js`,
   `test-applicability-filters.js`) where one covers the changed behaviour.
3. **Run the full rule test suite and do not proceed on a failure:**
   ```bash
   node test-drug-brand-coverage.js
   node test-qof-indicator-filters.js && node test-qof-year.js
   node test-monitoring-chip.js && node test-prescribing-flags.js
   node test-applicability-filters.js && node test-custom-rules.js && node test-custom-indicators.js
   ```
   A red test means a rule edit broke matching — fix the rule, not the test, unless the test
   genuinely encoded the old behaviour you are intentionally changing (then update it and say so in
   the report).
4. **Write the change-proposal artefacts** for the report builder:
   - `/tmp/the-keeper/changes.json` — the verified, applied changes in the schema in
     `references/change-schema.md`.
   - `/tmp/the-keeper/run-meta.json` — run metadata (scan window/version baseline, generated date,
     practice name, sources checked, rule files touched, candidates excluded, source gaps).
5. **Generate the report:**
   ```bash
   cd <skill-path>/scripts
   node build_report.js /tmp/the-keeper/changes.json /tmp/the-keeper/run-meta.json /tmp/the-keeper/the-keeper-report.md
   ```
6. **Version + changelog.** Bump `manifest.json` `version` (patch for a brand/interval correction,
   minor for new rules or a QOF-year refresh — per `CLAUDE.md`'s semver rules) and add a
   `CHANGELOG.md` entry on the same commit describing the rule changes and citing the sources.
7. **Push to a review branch and propose — never auto-merge.** Clinical rule changes are for the CSO
   to approve. Commit the rule files + updated tests + manifest + CHANGELOG to the session's dev
   branch, push with `git push -u origin <branch>` (retry on network error with 2s/4s/8s/16s
   backoff), and open a PR **only if Dave asked for one**. Present the report and the diff for review.
8. **Record state.** After a successful run, write the run date, the rule-file `lastUpdated` values,
   and the list of source URLs checked to `references/state/last-run.json`, so the next run can show
   "checked since last run" and mark items already proposed in a prior run as "previously flagged,
   still open".

## Scope and honest limitations

- **National authoritative sources only.** Local ICB formularies and shared-care boundaries vary;
  the report states this so absence of a local nuance is never mistaken for "nothing to change". If
  Dave pastes a local formulary line into a run, fold it in and tag it as locally supplied.
- **Coverage is only as good as the source register.** URLs drift; keep `references/sources.md`
  current. A source that moved or sits behind a login produces a gap, which the report surfaces, not
  hides.
- **Verification reduces but does not eliminate error.** Every proposed change carries its source
  link precisely so Dave can check anything before it merges. The Keeper proposes; the CSO decides.
- **This is a memory aid, not a QOF claim tool or a prescribing system.** It keeps Sentinel's
  approximations of the refsets/guidance current; it does not replace the official business rules or
  the BNF.

## File structure

```
the-keeper/
├── SKILL.md                  ← this file (the engine)
├── agents/
│   ├── SCANNER.md            ← scanner subagent brief (Haiku tier)
│   └── VERIFIER.md           ← verifier subagent brief (Sonnet tier)
├── references/
│   ├── sources.md            ← canonical source register, one block per rule domain
│   ├── change-schema.md      ← proposed-change + run-meta JSON schema, RAG taxonomy, provenance rules
│   └── state/                ← created/used at run time; holds last-run.json
└── scripts/
    └── build_report.js       ← change-proposal report builder (Markdown)
```
