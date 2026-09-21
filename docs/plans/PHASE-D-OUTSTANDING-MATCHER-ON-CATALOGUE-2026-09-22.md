# Phase D — Outstanding Requests matcher reads the Lab Result Catalogue

**Status:** Decisions taken by Nick 2026-09-22 (recorded in §0). Building on branch `feat/oir-matcher-on-catalogue` (branched from PR #435's branch; rebase if #435 changes). Nothing committed yet.
**Author:** Claude (drafted 2026-09-22) for Dr Dave Triska / Nick Grundy
**Hazard entries:** proposed H-078 and H-079 — full text in Appendix A (not yet added to `docs/HAZARD-LOG.md`, which is a controlled document)
**Related:** `docs/plans/LAB-RESULT-CATALOGUE-DATA-MODEL-2026-09-19.md` (§5.1, §11), hazard H-036 (existing auto-tick), H-069 (Companion list), CSN row W22

---

## 0. Decisions (Nick, 2026-09-22)

1. **No shadow stage for OIR matching.** Testing is safe locally: the matcher runs when a result is opened and ticks the outstanding-request boxes, but *nothing is saved until the result is filed*, so a rule can be re-tested repeatedly against the same result without touching the record. Straight to opt-in (`oirEngine`, default `legacy`). Parity/differential tests are still built (they are the safety net; the shadow log is not).
2. **`sample-problem` lab messages DO auto-tick** (with a "may need repeating" flag). The tick only completes the *old* outstanding request; a lab error needs a repeat and therefore a new request anyway. This is distinct from calling a result "normal" and auto-filing it, which the suite does not do.
3. **No second approver.**
4. **Practice-wide approval comes later**, maintained and enforced at practice level and polled out with the existing code-cleanup mechanics. Not in Phase D.
5. **The engine-selection pref is published through the practice profile**; Nick is warning users of the work as it lands.

## 1. What Phase D is — and is not

**Is:** replace the *recognition* step of the Outstanding Investigation Requests (OIR) card matcher. Today recognition is free-text: request wording → `TEST_DEFS`/`oirTests` `req` terms; report → group title against `rep` terms, or a signature of analyte-name substrings. Phase D lets the matcher instead ask the catalogue: *which investigation is this request?* and *which investigations does this report cover, and how confidently?* — by SNOMED code first, lab-scoped headings second, wording last.

**Is not:** any change to what *clearing* means or how it is applied. Explicitly unchanged (they are H-036's controls):

| Unchanged | Where it lives today |
|---|---|
| A request is only cleared when the report covers it **and the request predates the sample** | `predatesOrSame`, `matchOutstanding` |
| Only `confident` verdicts can auto-tick; `tentative` is flagged only | `autoTick = isConfident` |
| Auto-tick is a practice opt-in, default **OFF** (`oirAutoTick`); once per task; never re-ticks a manual untick | `performOirAutoTick`, `_oirAutoTicked` |
| Audit trail, review toast, confidence floor (`oirConfidenceFloor`), look-back (`oirLookbackMonths`) | `recordOirAudit`, `oirMatchOpts` |
| "Resulted elsewhere" (record history) is **never** auto-ticked | `enrichWithHistory` |
| Partial group clears its request; shared results are optional; all requests predating the sample clear together | agreed decisions v0.4–0.5 of the data model |
| The suite never writes anything except ticking the card's own checkboxes | CSN W22 |

Out of scope (later phases, each with its own hazard work): lab filing (E), result-triage rules scoping (F), monitoring / QOF / future-action rules (G), the Companion app list.

## 2. Current behaviour (what we must not regress)

Single call site: `content-scripts/triage-lens/content.js` `applyOutstandingMatch` → `OutstandingMatch.matchOutstanding(requests, report, opts)` (+ `enrichWithHistory`). Engine: `engine/outstanding-match.js` (820 lines).

- **Requests** come from the card's rows (`parseRequestLabel` → `{name, requestedDate}`); resolved by `resolveDef(name, ['req'], defs)` where `defs = mergeTestDefs(TEST_DEFS, practice oirTests)`.
- **Report** is `normaliseInvestigationReport` output: `results[{name, specimen(group title), date, …}]` — **no performer/lab and no SNOMED code is carried today.**
- **Coverage** (`reportCoverage`): *confident* if a group title matches a def's `rep` terms, or ≥2 distinct analyte terms (1 if `singleAnalyte`, or an `anchors` term) match; *tentative* if 1 of a multi-analyte signature; `strict` floor demotes signature-only to tentative. `exclude` terms suppress false matches (e.g. urine vs blood U&E).
- **Verdict shape** (downstream code and the audit log depend on it): `{id, name, requestedDate, key, status:'resulted'|'outstanding'|'resulted_elsewhere', confidence, autoTick, reason}`.

Known weaknesses this phase addresses: substring matching across unrelated results (the ALP/calprotectin class), no lab scoping, unrecognised newer tests (magnesium, urine ACR, vitamin D 25-OH, CA 12-5, HFE, ESR, coeliac…), tests defined twice, and per-practice wording drift.

## 3. Design

### 3.1 Staged rollout (revised — no shadow stage)

| Stage | Behaviour | Risk to patients |
|---|---|---|
| **D0 — adapter + differential tests** | Pure module `engine/outstanding-match-catalogue.js` producing the *same verdict shape* from the catalogue; parity corpus (§4). | none |
| **D2 — opt-in** | Pref `oirEngine: 'legacy' | 'catalogue'` (default `legacy`; in `defaults.json`, whose integer `version` is bumped; published via the practice profile). Catalogue engine drives inline flags/tentative/auto-tick when selected. Legacy remains the fallback (§3.5). Audit entries record the engine. | per practice, opt-in |
| **D3 — default flip** | Only on evidence from live use; CSO decision. | — |
| **D4 — retire legacy** | Remove free-text `TEST_DEFS` path; keep `oirTests` as an import source. | — |

The former D1 shadow mode is dropped (decision 1). An optional disagreement line behind the `ch-debug` flag (console only, no storage) may be added so local testing can see what the legacy engine would have done.

### 3.2 Inputs

- **Report:** use the raw overview payload the card code already fetches → `LabCatalogue.fromInvestigationReportPayload(raw)` (exists; carries performer, groups with heading + specimen + results with `code`, unit, resultType, degraded flag; requests come from `data.outstandingInvestigationRequestOptions`). `normaliseInvestigationReport` is left untouched (other consumers: result triage, lab filing).
- **Requests:** the card rows as today; `LabCatalogue.parseRequestName` strips the requester suffix; `resolveRequest(index, label, {system})`.
- **Catalogue:** the **acting** catalogue only — `labcatalogueLoadEffective()` with default `includeUnreviewed:false`. Unreviewed/imported/shared entries are never used. Cached per catalogue version; rebuilt on `chrome.storage` change of `labcatalogue.practice`.
- **Practice context:** labs the practice named; ordering system (`tquest`/`ice`) passed to `resolveRequest`.

### 3.3 Mapping to today's verdicts

| Today | Catalogue engine |
|---|---|
| `key` (def key) | `legacyKey` if the investigation has one, else its id — keeps audit-log keys and `shared/io/oir-key-rotation.js` stable |
| request recognised | `resolveRequest` → top hit; **a tie on specificity = unrecognised** ("left for manual review"), never a guess |
| `confident` | `resolveReport(...).coverage[id].confidence === 'confident'` (lab heading identifies it, or ≥ threshold distinct **core** results — 1 for single-result/anchor tests, else 2) |
| `tentative` | coverage `tentative` |
| `strict` floor | only a lab-scoped **heading** match is confident; signature-only demoted to tentative (as today) |
| predating gate | unchanged function reused |
| reason strings | same wording where the meaning is the same; new reasons name the route ("matched by SNOMED code", "by the lab's heading", "by result names") |
| extra fields (additive) | `investigationId`, `via` (`heading`/`signature`), `labMessageOnly`, `labMessageKind` |

Attribution differences that are *intended improvements* (each must appear in the differential-test allow-list, §4): results are attributed to an investigation by **membership** within the heading's candidate set, not by substring; a group under an unmapped heading is inferred only from ≥ threshold core results; ungrouped lone results give tentative evidence only; `exclude` terms apply to requests and headings, never block a result matched by SNOMED code.

### 3.4 Lab messages with no value
A group that carries only a lab message ("already performed recently", "sample dropped", "wrong bottle") clears the request (today's behaviour). `labMessageKind` is `sample-problem | already-done | not-applicable | other`. **Decision (Nick):** `sample-problem` verdicts **do auto-tick** like the others, because ticking only completes the *old* request — a lab error is repeated via a new request regardless. They carry a "sample problem — may need repeating" flag in the reason/toast so it is visible. This is not "normal, autofile".

### 3.5 Fail-safes
1. Catalogue missing, empty, invalid, or the engine throws → **fall back to the legacy engine for that card** and record a diagnostic; never "no matcher" and never a partial catalogue result.
2. `disabled` catalogue tests stop being recognised → requests stay outstanding (safe direction).
3. Any ambiguity (two tests tie for a request; two results tie for a name; a code claimed twice) → unresolved, not chosen.
4. Approval state is read at match time; a test edited after approval is unreviewed and therefore dropped from the acting catalogue until re-approved (already enforced by the overlay).
5. No new writes: same ticking code path, same audit entries (`kind: 'auto'`), plus the engine name in the entry.

## 4. Test strategy

1. **Golden parity:** every `EXPECTED` case in `test-outstanding-match.js` re-expressed as catalogue fixtures (the seed catalogue + Nick's imported tests); catalogue engine must reproduce each verdict or the case is listed in a reviewed **allow-list of intended differences** with the reason.
2. **Differential property tests:** over all fixture reports (`fixtures/lab-catalogue/`, + new scrubbed captures) × all shipped and imported request wordings, assert: *catalogue autoTick ⊆ legacy autoTick ∪ allow-list*; *no autoTick without predating*; *no autoTick when tentative*; *no result attributed across specimen (urine ACR must not select Bone/U&E)*.
3. **Regression fixtures** for the bugs that started this: faecal calprotectin vs ALP; urine ACR vs bone/U&E; HbA1c code family (IFCC vs DCCT); FBC vs "haemoglobin"; requests that previously resolved to `null` now resolving.
4. **Fail-safe tests:** invalid overlay, throwing index build, empty catalogue, unreviewed-only catalogue → legacy engine result returned unchanged.
5. **Source-guard tests:** engine module has no DOM/`chrome.*`.
6. **Live plan (Nick):** local re-testing against already-open results (nothing saves until filing) with the opt-in on his machine, then practice-profile publication with users warned.

## 5. Criteria before the default flips (D3 — proposed, for CSO)
- Used live by Nick for a period across normal queue volume without a judged-wrong tick.
- Every request wording in the practice's card history resolves or is knowingly excluded.
- H-078/H-079 residual risks signed off; CSN row W22 text names the second engine.

## 6. Work breakdown

| Step | Deliverable | Size | Safety touchpoint |
|---|---|---|---|
| D0a | `engine/outstanding-match-catalogue.js` + unit tests | M | none — unwired |
| D0b | Golden-parity + differential suites, allow-list | M | CSO reviews the allow-list |
| D2 | Wiring in `content.js`, `oirEngine` pref (practice-profile published), `defaults.json` version bump, fallback path, audit `engine` field, options control | M | H-078 controls go live |
| D3 | Default flip | XS | CSO decision |
| D4 | Remove free-text path | M | regression sweep |

Each step ships as its own PR with version bump + CHANGELOG. D0–D1 change no live behaviour.

## 7. Remaining open points
1. **Catalogue drift between machines** — approvals do not sync until practice-wide approval (decision 4) exists; show catalogue version / approved-entry count in the card diagnostics meanwhile.
2. **Pref publication blast radius** — a wrong publish flips every PC (same class as H-073); fallback + default-legacy limit it.
3. **Ordering-system tagging** — untagged (`any`) requests are used unless a system is set.
4. **Legacy keys** (`b12folate` etc.) must keep working through `oir-key-rotation.js`.
5. **Load** — index build cached per catalogue version; measure on a 100-row queue.

## 8. Not decided here (recorded for later)
Patient-level match-back of results to the original request; raw-XML/"view original message"; microbiology modelling (needs real captures); central pack store; seen-results counts in the shared folder (B4).

---

## Appendix A — proposed hazard-log entries (paste-ready, in the log's own table format)

> Two new entries; numbering assumes H-077 (Transactional API proxy) is the last in `docs/HAZARD-LOG.md`. Adding them also needs the §6 summary rows, the version-history line and a document-version bump — left for the CSO to do at sign-off.

### H-078 — OIR matcher driven by the Lab Result Catalogue clears (or fails to clear) a chase-up on a wrong recognition

| Field | Value |
| --- | --- |
| **Hazard ID** | H-078 |
| **Description** | Phase D lets the Outstanding Investigation Requests matcher (`engine/outstanding-match-catalogue.js`, called from `content-scripts/triage-lens/content.js` `applyOutstandingMatch`) recognise a request and a report through the practice's Lab Result Catalogue (SNOMED code → lab-scoped heading → wording) instead of the free-text `TEST_DEFS`/`oirTests` rules. It does **not** change what clearing means, the predating gate, the confident-only auto-tick rule, the default-OFF `oirAutoTick` preference or the audit trail (H-036). The new hazard is that a wrong catalogue entry, or a mis-resolution, causes (a) a genuinely outstanding chase-up to be flagged/ticked as resulted (false clear — cannot be reversed from the extension), or (b) a covered request to stay outstanding (false outstanding — safe direction but adds noise and may erode trust in the card). Also: a lab message with no value that means "sample dropped / wrong bottle" clears the request although the test was not done. |
| **Potential causes** | An approved catalogue entry with a wrong or over-broad request wording, report heading, result name or SNOMED code (including a heading that identifies two tests, or a code family that includes a non-equivalent measure, e.g. DCCT % vs IFCC HbA1c); a practice-authored **override** of a shipped test that removes a safeguard (an `exclude` term, a core result); results shared by two tests attributing to the wrong one; an ambiguous request wording resolving to the wrong test; an unrecognised new lab heading mis-inferred from result names alone; catalogue differences between PCs in the same practice (today approvals are per machine — the target design shares one practice-set version); a stale or corrupt overlay silently changing recognition; a lab message classified `other` that in fact means the sample was unusable. |
| **Affected users / components** | Clinicians relying on the OIR card to track chase-ups, and — when `oirAutoTick` is on — every task view. Components: `engine/outstanding-match-catalogue.js` (new), `shared/lab-catalogue-core.js` (resolver), `shared/lab-catalogue-overlay.js` (approved-only merge), `content-scripts/triage-lens/content.js` (engine selection, fallback, audit `engine` field), Options → Investigations (authoring/approval). |
| **Initial severity** | 3 (Moderate — a wrongly cleared chase-up delays follow-up of an outstanding investigation; request and report data are unaffected; same consequence class as H-036) |
| **Initial likelihood** | 3 (Possible — catalogue content is practice-authored and grows; recognition now depends on many entries rather than one hard-coded list) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) **Engine choice is a per-practice opt-in, default legacy** (`oirEngine`, published through the practice profile; legacy engine is the fallback). There is **no shadow stage**: the matcher only ticks boxes on the open result and nothing saves until the result is filed, so behaviour can be re-tested repeatedly without touching the record. (b) **Same clearing rules as H-036, unchanged and re-tested**: confident-only auto-tick, predating gate, default-OFF auto-tick, once per task, audit trail (now naming the engine), review toast, confidence floor. (c) **Approved-only**: only reviewed entries are in the acting catalogue; an edit withdraws approval. **One version of the truth, set by the practice, approved by each clinician** *(target design — Nick, 2026-09-22; NOT yet implemented)*: the lab and test rules are set centrally by administrator roles after appropriate practice discussion and distributed by restore / sync so every machine in the practice works from the same rules; each clinician then approves their own use of that single version, and changes to accepted ranges and results are taken by the practice, not by an individual. **Until that mechanism exists** imported, restored and shared entries arrive inert on each machine and approvals do not travel. (d) **Review screen for every entry** shows the request wordings, report headings, results and SNOMED codes, and — for an edited built-in — exactly what differs from the shipped test; Approve is only available there, with the consequence stated beside the button; no bulk approve. (e) **Fail-closed resolution**: a tie between tests or results, a code claimed twice, or an unrecognised request leaves the request outstanding for manual review — never a guess. (f) **Coded, lab-scoped, membership-based attribution** replaces substring matching (the ALP/calprotectin and urine-ACR classes are regression-tested); an unmapped heading is inferred only from ≥ threshold *core* results and is never fileable. (g) **Sample must fit**: results are only attributed to tests of a compatible sample. (h) **Fallback to the legacy engine** if the catalogue is missing, invalid or throws; disabling a test only ever makes the matcher recognise less. (i) **Sample-problem lab messages** clear the *old* request like any other lab message (decision: a lab error needs a new request anyway) but are **flagged "sample problem — may need repeating"**; this is not "normal, autofile". (j) **Differential tests** assert the catalogue engine never auto-ticks where the legacy engine would not, except a reviewed allow-list of intended improvements. (k) Optional console-only comparison with the legacy engine behind the `ch-debug` flag (nothing stored). (l) **Generic evidence is never confident**: a lab heading or result shared by several result-less tests (e.g. one generic "Ultrasonography" group for groin / abdomen / neck) makes each of them "possibly resulted — confirm", never auto-ticked, whenever more than one of them is requested on the card; a result that is core to several tests (e.g. a generic "Culture") can never make a match more than tentative on its own. (m) **Scan/authoring safeguards**: a result is only reused by name when the name means the same (a urine culture is never merged into the generic Culture result); deleted imported tests are remembered and not re-created. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 (recognition errors remain possible in practice-authored content, but they cannot act until reviewed, and the clearing gate is unchanged; the opt-in and local re-testing let a practice see behaviour before relying on it) |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | **Proposed — pending CSO sign-off**, and **not live** until Phase D2. Sign-off is requested for (1) the opt-in rollout without a shadow stage, (2) the sample-problem rule, and (3) the criteria for flipping the default. Auto-tick stays a separate opt-in (`oirAutoTick`) from selecting the engine. Open review items: catalogue drift between machines until the practice-level mechanism exists (target: rules set centrally by administrator roles, each clinician approving their use of one version); how an administrator role is established and how a clinician is identified for approval. |

### H-079 — A wrong or over-broad Lab Result Catalogue entry is approved (authoring, import, sync and approval of catalogue content)

| Field | Value |
| --- | --- |
| **Hazard ID** | H-079 |
| **Description** | The catalogue (v3.264.0, `labcatalogue.practice`, Options → Investigations) is authored by practice staff and populated by an import of the practice's Outstanding Requests tests and by a read-only scan of the pending investigation-results queue that proposes lab headings, results and SNOMED codes. Today nothing acts on it; from Phase D it will decide whether a request is treated as resulted (H-078) and later how results are filed/triaged (Phases E–G). The hazard is that wrong content is approved — through a hurried review, a scan proposal linked to the wrong test, a drag-and-drop mis-match, or an approved override — and then relied on. |
| **Potential causes** | Reviewer approves without reading; a scan links a lab group to the wrong request because the card lists several outstanding requests (candidates intersected across cards, but a thin sample can still mislead); a similarity hint pre-selects a wrong test and is ticked; two tests share a result; an imported entry mis-merges look-alike tests (e.g. hepatitis B antibody vs antigen); a shipped built-in edited to a different lab's headings loses a safeguard; entries restored from another PC or published to the practice are approved in bulk without reading. |
| **Affected users / components** | Any user of Options → Investigations; downstream, every feature that later reads the catalogue. Components: `options/investigations-section.js`, `shared/lab-catalogue-overlay.js` (`forceInert`, `approveInvestigation`, `saveInvestigation`, `mergeInvestigation`, `applyFills`), `shared/lab-catalogue-import.js`, `shared/lab-catalogue-scan.js`, `shared/io/labcatalogue-io.js`, `shared/io/practice-profile.js` (`labcatalogue` module), `shared/io/suite-envelope.js`. |
| **Initial severity** | 3 (no direct patient effect until a consumer acts on the entry — then the H-078 consequence class) |
| **Initial likelihood** | 3 |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) **Inert until approved before it acts.** *Today:* every entry arriving by backup restore, practice-profile sync or import is forced `reviewed:false` and excluded from the acting catalogue on that machine; approvals do not travel. *Target design (Nick, 2026-09-22; not yet implemented):* the catalogue is authored centrally by administrator roles after practice discussion and shared so every machine uses the same rules; each clinician then approves their own use of that single version, and changes to accepted ranges and results are practice decisions — an individual's local edit does not survive one. (b) **Approval only from the per-test review screen**; the screen shows the full test, the differences from the shipped version for edited built-ins, and states what Approve means; no bulk approve; an edit (or a change to a result the test uses) withdraws the approval. (c) **Scan proposals are evidence-graded and never applied silently**: only test names, headings, codes and units are read (no values, patient or staff data); a group is offered only to selected tests on the same card whose sample fits; candidates are intersected across cards; an ambiguity, a look-alike or an unrecognised request on the card is shown for the person to choose; hints are pre-selected but never ticked; applying is one item at a time, additive, reports what was and was not added, and lands awaiting review. (d) **Built-ins are shipped, reviewed data**: a practice edit is a complete override that is itself inert until approved and revertible; the shipped version keeps applying until then. (e) **Validation** rejects a code owned by two results, a heading pointing at nothing (now healed), a specimen test with no identifying result, and over-long or mistyped values (import is rejected, not truncated); prototype-pollution keys are dropped. (f) **Duplicate/merge tooling** (move a test into another) and delete with confirmation; excluded entries are listed under "catalogue problems". (g) Shipped SNOMED text and QOF flags come from the NHS PCD files by script (not hand-typed). |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | **Proposed — pending CSO sign-off.** Open review items: second-person approval was considered and declined; practice-wide rules (set centrally by administrator roles after practice discussion, distributed via the code-cleanup poll mechanics, each clinician approving their use of the single version) are the target design and are not yet implemented; whether a scan-created link should require the reviewer to view the source group name; whether approvals should be recorded in an audit ring buffer like `triagelens.oir.auditLog`. |
