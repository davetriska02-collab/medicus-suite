# Bringing the Sentinel engine into Medicus — porting guide

**Audience:** Medicus engineering (Tim Gray) and their AI assistants. This document maps
what the Sentinel engine *is* in this repo onto what a Medicus-native implementation would
need: different **hooks** (coded data instead of display-text matching) and different
**endpoints** (platform services instead of browser-session APIs). It is written so you
can plan the port from this document plus the referenced source files alone.

---

## 1. What the engine actually is

Sentinel's engine is **pure, dependency-free JavaScript** with no knowledge of Chrome, the
DOM, or how its input was obtained. Each file is a UMD-style module (works under
`module.exports` for Node tests and as a browser global). The clinical core:

| File | Role |
|---|---|
| `engine/rules-engine.js` | The engine. Evaluates all rule types against a patient bundle, returns chips. Entry point: `evaluatePatient()` (~line 2131). |
| `engine/normalisers.js` | Medicus *session* API JSON → the internal patient bundle. |
| `shared/fhir-normaliser.js` | GP Connect Access Record Structured (FHIR) → the **same** bundle. Existence proof that the engine is feed-agnostic. |
| `engine/data-fetcher.js` | Orchestrator: API-first, DOM-fallback, mock. Not needed in a native port. |
| `engine/result-rules.js` + `engine/result-severity.js` | Sibling engine: lab-result triage (severity grading of incoming results). Same purity property. |
| `engine/triage-alert-engine.js` | Sibling engine: stateless threshold alerts over workload bucket counts. |
| `engine/stopp-start.js`, `engine/acb-scores.js` | Sibling rule tables: STOPP/START v3 subset, anticholinergic burden scores. |

Rule content (data, not code):

| File | Content |
|---|---|
| `rules/drug-rules.json` | Drug-monitoring rules (drug → tests at intervals), drug-combo, drug-allergy rules. Schema v2. |
| `rules/qof-rules.json` | QOF 2026/27 register definitions + indicator rules. |
| `rules/vaccine-rules.json` | Vaccination schedule rules. |
| `rules/alert-library.json` | Composite / event-count alert library. |

Every rule file carries `lastUpdated`, `specVersion`, and `sourceNotes` with a
change-review audit trail (the "Keeper" process — automated currency checks against BNF /
NICE / MHRA / QOF sources, with CSO sign-off). **The rule JSON is the clinically reviewed
artefact; the engine is just its interpreter.** A native port that re-expresses the rules
in a Medicus-native format should treat these files as the specification of record and
preserve the provenance trail.

## 2. The evaluation contract

```js
// engine/rules-engine.js
evaluatePatient(medications, observations, rules, {
  now,                 // ISO timestamp (injectable for tests/determinism)
  problems,            // active problems
  pastProblems,        // ended problems (e.g. hysterectomy — needed for HRT context)
  patientContext,      // demographics
  observationHistory,  // full multi-point history per investigation type
  allergies,           // ONLY populated on the coded/FHIR feed; [] otherwise
  trace,               // optional: emit a per-rule evaluation trace
}) → chips[]
```

### Input bundle shapes (the "hooks")

These are the exact shapes both normalisers produce (`engine/normalisers.js`,
`shared/fhir-normaliser.js`). A Medicus-native feed needs to populate the same semantic
slots — almost certainly better, because it starts from coded data:

```js
patientContext: { patientUuid, nhsNumber, ageYears, sex, dob, isDeceased, testPatient, … }

medications: [{
  name,        // display string, e.g. "Methotrexate 2.5mg tablets" — PRIMARY match key today
  code,        // SNOMED/dm+d code — populated by the FHIR feed; absent on session feed
  startDate,   // earliest issue — drives recently_initiated + post-initiation tests
  category,    // "Repeat" | "Acute" | "OTC" | …
  dosage,
}]

observations: [{
  name,        // test display name, e.g. "HbA1c" — PRIMARY match key today
  code,        // SNOMED code where available
  date, value, unit,
  isAbove, isBelow,   // vs the source system's own reference range
}]

observationHistory: [{ name, code, group, unit, history: [{ date, value, isAbove, isBelow }] }]

problems:      [{ label, code, codedDate, significance, status }]   // active
pastProblems:  [{ … same … }]                                        // ended
allergies:     [{ label, code, status }]                             // coded feed only
```

### Output: chips

Each chip is a plain object: `{ type, ruleId, status, displayName/registerName/…, notes,
source, evidence: { summary, facts[] } }`. The `evidence` block always carries the matched
value, its date, and what matched — the "show your working" property that lets the
clinician verify against the source record. **Preserve this in any native rendering**; it
is a hazard control (see §7), not decoration.

### Status vocabulary

Defined in `STATUS_RANK` (`engine/rules-engine.js:29`), worst-first:

`overdue` / `not_met` / `alert` (red, rank 0) → `stale` / `vax_due` (rank 1) →
`due_soon` / `caution` (amber) → `no_data` / `noted` / `vax_declined` →
`recently_initiated` → `achieved` / `in_date` / `vax_given` (green).

Semantics worth porting exactly: `stale` = data exists but older than **2×** the interval;
`recently_initiated` = drug started recently, monitoring not yet expected; `no_data` is
deliberately distinct from `overdue` (absence of evidence is surfaced, never upgraded to
an alarm, and never silently dropped).

## 3. Rule types

Dispatched in `evaluatePatient` (`engine/rules-engine.js:2196–2202`, composites last):

| `type` | What it does | Example |
|---|---|---|
| `drug-monitoring` | Drug X → tests at intervals, with `dueSoonDays`, optional `postInitiationDays` (e.g. U&E 1–2 weeks after starting ACE-I/ARB) | methotrexate → FBC/U&E/LFT 12-weekly |
| `drug-no-monitoring` | Drug matched, deliberately no tests — suppresses the "unmatched high-risk med" guard | |
| `qof-register` | Register membership from active problems | DM, HYP, AF, … |
| `qof-indicator` | Threshold / medication-presence / observation-in-window checks, scoped to a register, with age bands, frailty exclusion, QOF-year-floor vs rolling window semantics (`useQofYearFloor`) | HYP008: BP ≤140/90, age <80 |
| `drug-combo` | Interaction / duplication: fires on co-occurrence of drug sets | |
| `drug-allergy` | Documented ACTIVE allergy × contraindicated drug. **Fails closed** on the codeless feed (empty `allergies` → never fires) | penicillin allergy × penicillin Rx |
| `event-count` | N matching events within a window | |
| `vaccine` | Schedule evaluation → `vax_given` / `vax_due` / `vax_declined` | |
| `composite` | Boolean combination over other rules' results (evaluated last, sees `evaluatedById`) | |

Example rule (abridged from `rules/drug-rules.json`) — note it **already carries SNOMED
seed codes** alongside the text match terms:

```json
{
  "type": "drug-monitoring",
  "id": "methotrexate-maintenance",
  "drug": {
    "match": ["methotrexate", "maxtrex", "metoject", "jylamvo", "nordimet", "zlatal", "methofill"],
    "snomed": ["387381009"]
  },
  "tests": [
    { "name": "FBC", "match": ["fbc", "full blood count"], "snomed": ["26604007"],
      "intervalDays": 84, "dueSoonDays": 14 }
  ],
  "source": "BNF / 2025 BSR guideline …",
  "sharedCare": true
}
```

## 4. Matching today: text-first, codes partial — the central porting fact

Because the browser feeds only reliably expose **display text**, the engine matches by
case-insensitive normalised **substring** almost everywhere:

| Surface | Today's mechanism | Coded seeds present? |
|---|---|---|
| Drug ↔ rule | substring on med name; `drug.exclude` disqualifies (`drugMatchesRule`, `engine/rules-engine.js:55`) | **Yes** — `drug.snomed` on all 24 drug rules (~90 codes incl. tests) |
| Test ↔ observation | substring on test name; **an exact SNOMED match bypasses text excludes** (`engine/rules-engine.js:227`) — codes already outrank text where present | **Yes** — `tests[].snomed` |
| Problem ↔ register | substring on problem label via `problemMatch`/`problemExclude` — explicitly documented as a "QOF SNOMED refset approximation" | **No** — `rules/qof-rules.json` has zero SNOMED |
| Vaccines | text match | **No** |
| Allergies | term lists over the coded feed's allergy labels | partial |

The known failure modes of text matching are documented as hazards (`docs/HAZARD-LOG.md`,
`../sentinel-README.md` hazard register): register false positives (label coincidentally
contains a keyword), false negatives (synonym not in the list), silent drug
under-matching (an unlisted brand simply never fires — the reason `CLAUDE.md` mandates
brand-list completeness and `test-drug-brand-coverage.js` regression-guards it), and
sharp `exclude` terms suppressing legitimate matches.

**A Medicus-native port should make coded matching primary and demote text to a
diagnostic/fallback role.** Concretely:

1. **Drugs:** match on dm+d — VTM level for the generic concept (the rules' `snomed`
   seeds are VTM-level, e.g. methotrexate `387381009`), which automatically covers every
   AMP/brand and kills the brand-enumeration problem entirely. The `match` brand lists
   then become redundant *by construction* rather than by maintenance. `exclude` terms
   mostly disappear too (most exist to patch substring collisions, e.g. bare
   "estradiol" matching "ethinylestradiol" — impossible with concept-level matching).
2. **Tests/observations:** match on SNOMED observable-entity / battery codes
   (`tests[].snomed` seeds exist: FBC `26604007`, U&E `1019331000000106`, LFT
   `26958001`, …). One decision to make jointly: whether Medicus files panel results
   under the battery code or per-analyte codes — the engine currently handles this with
   per-investigation-group aggregate observations; a native port needs the equivalent
   grouping decision.
3. **Registers:** replace `problemMatch` substring lists with the **QOF business rules
   refsets** (DM_COD, HYP_COD, …) that the register definitions already name in their
   `source` fields as the thing they approximate. This is the single biggest
   correctness upgrade available in the port, and eliminates the top two register
   hazards outright. Exception/exemption coding (PersistentExclusion etc.), which
   Sentinel explicitly does not handle, becomes feasible on the native side.
4. **Allergies:** the `drug-allergy` cross-check rules were designed for the coded feed
   from day one and fail closed without it — on native coded data they simply work at
   full strength.

The rule files should remain the **single source of truth** during migration: extend the
schema (more `snomed`/refset fields) rather than forking a parallel rule set, so the
Keeper currency-review process keeps covering both consumers.

## 5. Endpoints: today vs native

### What Sentinel consumes today

Session feed (same-origin, clinician's own authenticated browser session — read-only):

| Endpoint | Feeds |
|---|---|
| `GET /patient/data/patient/patient-banner/{uuid}` | `patientContext` |
| `GET /clinical/data/medication/medication-regimen/{uuid}` | `medications` |
| `GET /clinical/data/problem/listing/{uuid}` | `problems` / `pastProblems` |
| `GET /care-record/data/investigation/dashboard/{uuid}` | `observations` + `observationHistory` |

Official feed (dormant-by-default, see `../TRANSACTIONAL-API-INTEGRATION.md`):
Transactional API `retrieve-care-record` (GP Connect Structured) + demographics, via a
server-side JWT-signing proxy, through `shared/fhir-normaliser.js` — which additionally
supplies `allergies` and `immunisations`.

A native implementation replaces all of this with direct platform data access; the only
contract that matters is the bundle shape in §2 (or a coded superset of it).

### Mapping Sentinel concepts onto Resource Publishing resources

See `RESOURCE-PUBLISHING-API.md` in this directory for the API itself. The plausible
correspondences, to be validated with Medicus (the `ruleDefinition` / `content` internal
schemas are not public, so this is a mapping of *concepts*, not payloads):

| Sentinel concept | Candidate Resource Publishing vehicle | Notes |
|---|---|---|
| Drug-monitoring rule (drug → tests at interval) | **Future Action Rule** (`ruleDefinition` object) | Closest native analogue to "this patient needs an FBC by date X". Key question: can a FAR trigger on *medication presence + elapsed time since last matching result*? |
| QOF register / indicator status view | **Custom Dashboard** | Chip wall → dashboard panel. Sentinel's per-chip `evidence` (value, date, matched problem) must survive the translation. |
| `problemMatch` / `drug.match` term sets | **Code Lists** | The natural home for refsets/dm+d sets once matching is coded. Endpoint schema thin in public docs — early item to confirm with Tim. |
| Cohort/recall identification | **Custom Reports / Patient Query Language** | Note: population-level queries are *explicitly out of Sentinel's current scope* (single-patient memory aid). Using them native-side is a scope extension → fresh safety review (§7). |
| Monitoring-review capture (e.g. structured annual-review entry) | **Data Entry Template** | Optional; closes the loop Sentinel can't (it can't see journal-coded reviews — a documented limitation). |
| Distribution to practices | **Content Package** | Bundle the above; `set-content-package-items` supports all the relevant types. Versioning discipline maps well: Sentinel already version-gates shipped rule config (`defaults.json` integer version — see root `CLAUDE.md`). |

### Three integration architectures, cheapest first

**A. Content-only: express the rules as published resources.** No Sentinel code runs
inside Medicus. Translate `drug-rules.json` (+ QOF subset) into Future Action Rules +
Code Lists, surface via a Custom Dashboard, distribute as a Content Package. A
build-time translator in this repo (`rules/*.json` → `ruleDefinition` payloads) keeps the
Keeper-reviewed JSON as the source of truth and republishes on rule updates.
*Feasibility gate:* the expressiveness of `ruleDefinition` — interval-since-last-result
logic, `stale` (2× interval), `recently_initiated`, post-initiation tests, frailty/age
scoping. Whatever can't be expressed stays engine-side.

**B. Engine-as-a-service.** Run `rules-engine.js` unchanged (it's pure JS, Node-ready —
the whole test suite runs it headless) server-side against Medicus's coded patient data,
behind a thin normaliser that maps native structures → the §2 bundle. Fastest route to
full semantic fidelity; `shared/fhir-normaliser.js` is a working template for the
normaliser. Chips render into whatever native UI Medicus chooses.

**C. Native re-implementation.** Medicus re-implements the rule semantics in-platform,
using `rules/*.json` as the spec and this repo's tests as the conformance suite
(`test-smoke.js`, `test-drug-brand-coverage.js`, `test-clinical-thresholds-sync.js`,
`test-txn-shadow.js` — the shadow-parity harness is directly reusable as an
old-vs-new comparison gate). Highest effort, deepest integration.

These compose: A for what `ruleDefinition` can express, B for the remainder, C as the
long-term destination. The **shadow-parity pattern** from
`../TRANSACTIONAL-API-INTEGRATION.md` (run old and new feeds on the same patients,
require identical chips, flag any divergence as a regression, never silent) is the
recommended acceptance gate for every stage.

## 6. What does NOT port

- **Everything that isn't the clinical engine.** The suite around Sentinel
  (slots/capacity, request monitor, submissions, rota, visualiser, queue-chip injection)
  is browser-extension tooling over internal session endpoints with no Transactional
  equivalent — already documented in `../TRANSACTIONAL-API-INTEGRATION.md`. Not in scope.
- **DOM extractors and the data-fetcher fallback ladder** — defensive scaffolding for
  living *outside* the platform; pointless inside it.
- **Substring brand lists and most `exclude` terms** — superseded by concept-level
  coded matching (§4), *after* parity is proven, not before.
- **`chrome.storage` config plumbing** (user overrides, custom rules, backup envelopes) —
  native equivalents (practice-level configuration, Content Package versioning) replace
  it. The *idea* of user-visible "modified" badges on locally overridden rules is worth
  keeping.

## 7. Safety invariants that must survive the port

Sentinel's regulatory position rests on a frozen intended-purpose statement
(`../sentinel-README.md`): passive, read-only, single-patient, recommendation-free
re-display of recorded values. The engineering translation of that, plus hard-won repo
rules, distilled:

1. **Show the evidence.** Every chip shows the value, its date, and what matched, so the
   clinician can verify against the record. Any native rendering keeps this.
2. **Fail closed, visibly.** Missing data → `no_data` (visible), never a guessed alarm
   and never silence. Rules needing an absent data stream (allergies on the old feed)
   must not fire at all rather than fire wrongly.
3. **Silent non-matching is the top hazard.** A monitored drug that matches no rule fires
   nothing forever. The engine ships a high-risk-unmatched guard
   (`flagHighRiskUnmatched`) and CI coverage tests; a native port needs the equivalent
   (coded matching shrinks the risk; refset/dm+d *coverage* review replaces brand-list
   review — it does not remove the review).
4. **No completion claims.** Suite-wide rule: never render "Done/Sent/Submitted" for an
   action the system didn't verifiably complete (source-grepped by test). Applies
   doubly to anything that becomes a native task/recall.
5. **Rule changes are clinical changes.** Content edits go through source-cited review
   (Keeper + CSO trail in `sourceNotes`); shipped-config changes are version-gated so
   they provably reach users. Map both onto Content Package version discipline.
6. **Annual currency is a designed-for hazard.** QOF changes every April; BNF/MHRA
   monitoring guidance changes continuously. The port must own a review cadence, not
   assume the rules are static.
7. **Scope creep is a regulatory event.** Write-back, task creation, patient messaging,
   cohort queries, risk scoring — all explicitly out of Sentinel's current scope. Any of
   them in a native version changes the DCB0129/MHRA analysis: deployed product,
   multi-user, possibly CDS. Budget for a fresh clinical-safety case (the hazard log and
   safety-case docs in `docs/` are the starting corpus, not the finished answer).

## 8. Suggested first steps / open questions for Medicus

1. **Share the `ruleDefinition` schema for Future Action Rules** (and Code Lists'
   endpoint schemas). This single artefact decides the A/B split in §5.
2. Can a Future Action Rule express: "patient on <dm+d concept> AND no <SNOMED test>
   result within N days → action due at date X", with a due-soon window?
3. Confirm how panel results (FBC/U&E/LFT) are coded natively — battery vs per-analyte —
   to settle the observation-grouping contract.
4. Confirm QOF refset availability in-platform (DM_COD etc.) for register membership,
   and whether exception/exemption coding is queryable alongside.
5. Sandbox/staging tenant + onboarding (JWKS registration, endpoint grants) for a
   proof-of-concept publish of ONE rule (suggest `methotrexate-maintenance` — it
   exercises drug matching, three tests, intervals, and shared-care flagging).
6. Agree the parity gate: same patients, Sentinel chips vs native output, zero
   unexplained divergence before anything ships to a practice.
