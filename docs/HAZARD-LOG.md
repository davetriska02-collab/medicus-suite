# Medicus Suite — Clinical Safety Hazard Log

**Document reference:** MS-CSO-HL-001  
**Software product:** Medicus Suite (Chrome extension)  
**Product version:** 3.54.0  
**Document version:** 3.5  
**Date issued:** 2026-06-11  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Clinical Safety Officer:** Dr Dave Triska (GMC 7534932), registered GP  
**Status:** Live — reviewed at each minor or major release  
**Applicable standards:** Drafted in the style of DCB0129 (Manufacturer) with consideration of DCB0160 (Deploying Organisation) responsibilities, noting that Medicus Suite is not a Health IT system under the formal scope of those standards but is voluntarily managed against them by the author.

---

## 1. Purpose

This hazard log records the clinical safety hazards identified for Medicus Suite, the controls in place to mitigate them, and the residual risk borne by users of the software. It is maintained by the Clinical Safety Officer (CSO) and reviewed at every release.

The log is intended to be read alongside:

- `docs/CLINICAL-SAFETY-NOTICE.md` — the user-facing safety notice
- `docs/sentinel-DISCLAIMER.txt` — the binding terms of use
- `docs/INTENDED-PURPOSE.md` — the frozen intended-purpose statement
- `docs/SOUP.md` — the Software of Unknown Provenance register (vendored third-party libraries)

## 2. Scope

This hazard log applies to all functional modules of Medicus Suite v3.54.0, namely:

- **Monitoring (Sentinel)** — HUD display of practice-authored clinical rules, QOF indicators, drug-monitoring intervals, waiting-room list. Since v3.16.0 this includes: **falling eGFR trend** (NICE NG203: ≥15 mL/min/1.73m² fall across ≥3 readings within 12 months) and **hyperkalaemia (K⁺) RAG-banded alerts** (amber 5.5–5.9 mmol/L, red ≥6.0 mmol/L per NICE/UK Kidney Association) using a new `observation-alert` check kind (v3.18.0); a **rising HbA1c trend** rule scoped to the DM register (≥10 mmol/mol rise across ≥3 readings within 24 months, NICE NG28/NG17) (v3.19.0); **journal-coded observations** now evaluated in the side-panel path (v3.21.0); **ADHD medication monitoring** (stimulants paediatric/adult, atomoxetine, guanfacine — NICE NG87/BNF), **smoking status indicators** across 9 QOF registers, **carbamazepine monitoring** (FBC/LFT/U&E/sodium/drug level/lipids), and the `observation-bundle` check kind enabling DM037 (v3.26.x); **flu and COVID-19 vaccination eligibility alerts** using JCVI/UKHSA 2025/26 criteria, with inferred DUE/GIVEN/DECLINED status (v3.26.0); and **per-rule hide/snooze** controls (permanent hide for drug-monitoring and QOF rules; snooze-until-season for vaccine rules) (v3.26.3); **PPV23, shingles, and RSV one-off vaccination rules** using JCVI/Green Book criteria with a new `schedule:once` mode (v3.46.0); fix to `vaccineEventInWindow` correcting misclassification of declined-vaccination coded records as vaccination-given (v3.46.0); **extraction-drift detection** (`shared/extraction-health.js`, v3.47.0) that fires a side-panel warning banner when ≥4 of the last 5 records show zero on a metric whose historical median ≥3, distinguishing gradual API regression from single-patient scraper failures; **Action Packs** (v3.48.0): copy-ready blood-form requests, recall SMS/letters, and pharmacist-task templates generated per chip from the current Sentinel snapshot (templates include patient name, DOB, NHS number — see H-022); **Pre-consultation Brief** (v3.49.0): collapsible risk-ranked summary card at the top of the Sentinel panel showing up to 4 top-ranked action signals (see H-007); **Patient Passport** (v3.50.0): printable plain-English health summary for handing to patients, generated from the current snapshot, with consume-on-read PII handling (see H-025); journal-augmentation-failure surfacing — the snapshot now carries `journalAugmentFailed` metadata and the panel renders a muted warning so 'no_data' from a failed journal fetch is distinguishable from genuinely absent data (v3.53.0)
- **Custom Alert Builder (Sentinel options)** — form-based authoring of practice custom rules across six check kinds (drug-monitoring, drug-combo, qof-indicator, event-count, observation-alert, composite), with an engine-backed live "would this fire?" preview against an editable test patient and schema validation on save (v3.15.0–v3.16.0); from v3.22.0 the builder exposes full engine parity: `requiresProblem`/`requiresAnyProblem`/`excludeIfProblem`, sex, age range, `mustNotBePresent` drug-absence gate, per-test SNOMED aliases, and the `medicationExclude` field now correctly applied by the engine (previously saved but silently unevaluated)
- **Slot Counter** — display of appointment slot availability
- **Capacity Forecast** — display of historical session/slot usage
- **Submissions Tracker** — display of daily task volume counts
- **Triage Lens** — overlay HUD on Medicus triage/record pages. Surfaces: red/amber/info text-pattern chips on patient requests; computed record chips (frailty, polypharmacy, anticholinergic burden, drug-monitoring due); **STOPP/START-style prescribing-combination prompts** on the record medications tile (NSAID + anticoagulant/antiplatelet, "triple whammy" NSAID + ACEi/ARB + diuretic, benzodiazepine/Z-drug in age ≥80) (v3.14.0); a **risk-tool signpost chip** linking to the QRISK3 / QCancer / eFI calculators (signpost only — no score computed) (v3.14.0); and **NHS Pharmacy First pathway signposting** snippets across all seven England pathways (v3.13.0); **baseline rule set expanded** to 77 rules (schema v2) including 17 explicit red emergency-presentation rules (stroke/TIA (FAST criteria), sepsis, anaphylaxis, meningitis/non-blanching rash, DKA/HHS, AAA/dissection, testicular torsion, PE/DVT/limb ischaemia, acute surgical abdomen, fever in infant <3m, paediatric respiratory distress, seizure, pregnancy bleeding/pain, reduced fetal movements, pre-eclampsia, sudden visual loss/GCA, septic arthritis, psychosis), 27 amber rules (NG12 2WW flags, diabetes red flags, head injury per NG232, neonatal jaundice, emergency contraception, eating disorders per MEED guidance, perinatal mental health, and others), 8 info rules (v3.44.x); non-destructive version-gated merge ensures newly shipped bundled rules reach existing users without overwriting customisations; **DKA/HHS explicit red rule** (v3.52.0); **engine hardening** (v3.52.0): invalid patterns are now logged to the console rather than silently dropped, curly-quote normalisation ensures straight-apostrophe patterns match pasted clinical-letter text, non-numeric thresholds coerced with warning rather than causing silent always-/never-fire (see H-024)
- **Activity Report** — display of staff activity counts
- **Referrals Tracker** — display of referral audit data drawn from Medicus
- **Waiting Room / Request Monitor** — live demand display with configurable thresholds
- **BP Trend** — dual-line systolic/diastolic trend chart drawn from the Medicus investigation dashboard, with condition-specific target lines derived from achieved QOF register chips, AT TARGET / ABOVE TARGET status pill, and a paediatric caveat (v3.25.0)
- **ACR Trend** — ACR trend chart with KDIGO A1/A2/A3 band shading, co-displayed eGFR with G-stage bands, a KDIGO G×A monitoring-frequency cell, and action banners for ACR ≥70 referral trigger, ACR doubling since prior reading, and KDIGO category crossing — all based on NICE NG203 (v3.25.0)
- **Patient Record Visualiser** — offline PDF-based multi-tab clinical dashboard, including: continuity-of-care indices, investigation trends with clinical zone bands, high-risk drug monitoring compliance, Electronic Frailty Index (eFI), PINCER-style prescribing safety flags, QOF register review status, swim-lane event timeline; from v3.51.0 a **Structured Medication Review (SMR) Workstation** tab: ACB burden score (Boustani scale, `engine/acb-scores.js`, per-drug badges), STOPP/START v3 (2023) flags (10 STOPP + 3 START criteria, age- and eGFR-gated criteria fail-closed, `engine/stopp-start.js`), and a 'Print SMR summary' button rendering patient identifiers and ACB/STOPP/START/PINCER tables plus an NHS DES documentation skeleton; all SMR Workstation data inherits H-013 (PDF staleness) and H-014 (silent data omission) limitations; ACB scores and STOPP/START criteria are a starter set pending CSO verification before broad clinical use (see H-023)
- **Pre-Monitoring Sweep** — pre-clinic module that runs the Sentinel rules engine as a read-only batch against today's booked patients from the Medicus appointment book; results are in-memory only, never written to storage; a patient that fails to load is never silently skipped (see `CLINICAL-SAFETY-NOTICE.md` limitation 26)
- **Reception** — guided non-clinical capture pathways (`rules/reception-pathways.json`) presenting a fixed question set per presenting problem; red-flag questions fire an escalation instruction; generated text is copied to clipboard for manual paste into Medicus; all pathways ship disabled, requiring CSO-reviewed disclaimer acceptance before enabling (see `CLINICAL-SAFETY-NOTICE.md` limitation 27)

It covers hazards arising from the technical operation of the extension, from the human factors of its use by trained GP practice staff, and from foreseeable failure modes of the surrounding environment (browser, network, Medicus platform).

It does **not** cover:

- Hazards arising from the underlying Medicus EPR itself — the responsibility of Medicus Health Ltd
- Hazards arising from the practice's own clinical processes — the responsibility of the deploying GP practice
- Hazards arising from use of the extension outside its frozen intended-purpose statement — explicitly out of scope per the disclaimer

## 3. Hazard identification methodology

Hazards were identified using the following techniques, applied iteratively across development sprints:

1. **Functional decomposition** — each module was decomposed into its data sources, transformations, and display outputs; each step was examined for foreseeable failure.
2. **HAZOP-style "what if" prompts** — applied to each data flow ("what if the patient changes mid-fetch?", "what if the API returns an empty array?", "what if a rule is misconfigured?", "what if the PDF is six months old?", "what if a drug appears under a brand name?").
3. **Human factors review** — consideration of automation bias, alert fatigue, misinterpretation, out-of-context display, and point-in-time data reuse.
4. **Code review and security review** — examination of network calls, storage, permissions, and supply chain.
5. **Incident learning** — any reported anomaly or near-miss is reviewed and the log updated.

Hazards are recorded against the frozen intended-purpose statement. Hazards arising from out-of-purpose use are noted but not assigned residual scores, as such use is excluded by the disclaimer.

## 4. Risk scoring matrix

Risk is scored as **Severity × Likelihood** on the matrices below.

### Severity (1–5)

| Score | Label | Definition (patient safety) |
|-------|-------|------------------------------|
| 1 | Negligible | No clinical impact; user inconvenience only |
| 2 | Minor | Brief delay or unnecessary effort; no harm to patient |
| 3 | Moderate | Possible unnecessary investigation, missed administrative deadline, or short-lived clinical inconvenience; no lasting harm |
| 4 | Major | Plausible delayed diagnosis, missed monitoring, or wrong-patient action that would normally be intercepted by other controls |
| 5 | Catastrophic | Severe or permanent harm to a patient, or major information governance breach |

### Likelihood (1–5)

| Score | Label | Definition |
|-------|-------|------------|
| 1 | Rare | Not expected during the lifetime of the product |
| 2 | Unlikely | Could occur but would be unusual |
| 3 | Possible | Could occur from time to time |
| 4 | Likely | Will probably occur in normal use |
| 5 | Almost certain | Will occur frequently |

### Risk acceptability

| Risk score | Acceptability |
|------------|---------------|
| 1–4 | Broadly acceptable |
| 5–9 | Acceptable with documented controls (ALARP) |
| 10–14 | Tolerable only with additional controls; CSO sign-off required |
| 15–25 | Unacceptable — distribution must be suspended until mitigated |

A residual score of 12 or above blocks release. A residual score of 10 or 11 requires explicit written CSO acceptance recorded against the hazard.

---

## 5. Hazard register

### H-001 — Stale or wrong-patient data displayed

| Field | Value |
|-------|-------|
| **Hazard ID** | H-001 |
| **Description** | Monitoring (Sentinel), Triage Lens, or Referrals Tracker displays clinical data belonging to a previously-viewed patient while the clinician has navigated to a different patient's record. |
| **Potential causes** | Patient-change navigation event not detected (Medicus uses client-side routing); race condition between URL change and asynchronous API fetch; in-memory cache not invalidated; Medicus URL pattern changes after a release; tab restored from browser session with prior state. |
| **Affected users / components** | Clinicians and any user viewing patient-specific data. Components: `content-scripts/sentinel.js`, `engine/data-fetcher.js`, `engine/extractors/patient-context.js`. |
| **Initial severity** | 4 (Major — wrong-patient clinical action) |
| **Initial likelihood** | 3 (Possible without controls) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) Cache keyed by patient UUID extracted from URL — a UUID change clears prior state. (b) URL-change watcher triggers re-fetch and clears prior chips. (c) Patient name remains visible in the native Medicus header at all times; clinician can cross-check. (d) Side panel is visually distinct from the Medicus record and not mistakable for it. (e) Disclaimer mandates verification of every displayed value against the source record before any clinical action. (f) Loading state is rendered before chips appear so a clinician cannot see stale chips superimposed on a new patient. (g) v3.17.2: `_lastSnapshot` is invalidated on SPA navigation and on any failed extraction, so a previous patient's chips can never render as current; `test-sentinel-panel-state.js` regression-guards both behaviours. (h) v3.21.2 (A5): the DOM-fallback patient-context code path now resolves `patientContext.patientUuid`, so the same-patient navigation guard operates on that path too. (i) v3.25.0: `_lastTrendData` is invalidated in lockstep with `_lastSnapshot` inside `invalidateSnapshot`, extending the wrong-patient guard to the BP Trend and ACR Trend modules. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any report of wrong-patient display is treated as a significant safety event and triggers immediate CSO review and a hot-fix release. |

---

### H-002 — False-negative clinical indicator (missing alert)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-002 |
| **Description** | A drug-monitoring interval that is overdue, or a QOF indicator that is unachieved, is not surfaced by Monitoring when it should be. |
| **Potential causes** | QOF register membership not matched (substring miss); rule omitted from curated rule set; Medicus API response shape change breaks normaliser; encounter-coded entry not present on the investigation dashboard endpoint; rule disabled by practice configuration; user-edited threshold diverges from current guidance. |
| **Affected users / components** | Clinicians using Monitoring for monitoring or QOF review. Components: `engine/rules-engine.js`, `engine/normalisers.js`, `rules/*`. The Triage Lens "Monitoring due" overlay chip (v3.6.0, `content-scripts/triage-lens/content.js`) is an additional surface for the same drug-monitoring signal — it reuses this engine and `rules/drug-rules.json` unchanged (so the same controls apply) and shows NO chip on fetch failure / no data rather than a false "clear". |
| **Initial severity** | 3 (Moderate — missed monitoring, eventually caught by Medicus's own workflows) |
| **Initial likelihood** | 3 (Possible — curated rule set is intentionally a subset) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) Monitoring is positioned as a memory aid, not the system of record — see `CLINICAL-SAFETY-NOTICE.md`. (b) Absence of a chip is documented as "no data retrieved or no rule defined", not "clear". (c) The disclaimer explicitly discloses incomplete coverage. (d) Medicus itself surfaces overdue monitoring and QOF items independently of the extension. (e) 440+ automated checks cover threshold, date and rule-firing logic. (f) Annual QOF specification review is a documented release checklist item. (g) **Applicability filters fail OPEN on unknown demographics (v3.12.1):** a rule gated to a sex or age band still fires when the patient's age/sex cannot be scraped from the page — so a demographic-gated safety alert (e.g. the MHRA valproate "female of childbearing potential" alert, or age-gated QOF indicators) is no longer silently suppressed when the banner can't be read. A rule is excluded only when the patient is *positively known* to be out of scope. Patient-context age/sex extraction was also made more robust, and a regression test (`test-applicability-filters.js`) pins this behaviour. (h) A Dementia (DEM) QOF register was added to the bundled set (it was previously absent). (i) **QOF indicator age filter now fails OPEN (v3.20.0, F2):** age-gated QOF indicators now use the shared `passesAgeFilter` helper, which allows the rule to fire when the patient's age cannot be extracted — matching the drug-rule fail-open convention and preventing age-gated indicators from silently vanishing on records where the age banner cannot be scraped. (j) **Register and indicator logic corrections (v3.20.0, F3–F6):** the engine now honours `requiresProblem` (all-of) and `requiresAnyProblem` (any-of), both negation-aware; `excludeIfProblem` is negation-aware; TIA register matching uses word-boundary detection; DM register excludes 'pre-diabetic' / 'prediabetes' variants. DM021, DM035, and HF009 were previously firing for all diabetics/HF patients regardless of frailty stratification — this has been corrected. `test-qof-indicator-filters.js` pins 39 assertions covering these cases. (k) **Journal-coded observations evaluated in side panel (v3.21.0):** the side-panel evaluation path now augments observations with `fetchJournalObservations`, so QOF indicators whose evidence lives only in consultation or journal coding (AST007, COPD010, HF007, DM014, AF006) now fire correctly rather than always returning `no_data`. This was the most common class of false negative in the bundled QOF indicator set. (l) **Care-record-view UUID regex (v3.26.2):** removed a negative lookahead from the patient UUID regex that prevented QOF chips from displaying on the Medicus care record view. (m) **HRT chip false-negative fixes (v3.20.0 / #21 / #23 / v3.26.4):** IUS detection extended to problem-list phrasings (Mirena/IUS recorded as a problem rather than a medication); oestrogen pessaries correctly excluded; hysterectomy coded as a past/ended problem (not an active problem) now detected by checking `allProblems = [...activeProblems, ...pastProblems]`. (n) **Vaccine declined-before-given fix (v3.46.0):** `vaccineEventInWindow` now checks DECLINED terms before GIVEN terms for each evidence source (problems, observations, observationHistory). This corrects a clinical-safety bug in which a record coded as "Influenza vaccination declined" was classified as vaccination-given because the stem "flu vaccin" appeared in the given-terms list first; the corrected logic is regression-guarded by `test-vaccine-rules.js`. (o) **HRT IUS expiry date guard (#70, v3.54.0):** `buildHrtContext` now only counts a problem-coded LNG-IUS as providing endometrial cover when the insertion was coded within `hrtContext.iusValidityYears` (default 5 years, matching the licensed 5-year life of a 52 mg LNG-IUS). A coil insertion older than 5 years raises an amber "IUS expired — endometrial cover not confirmed" prompt rather than asserting cover, removing a patient-safety-direction false reassurance. A live LNG-IUS on the medication list still counts regardless of date. Regression-guarded by `test-qof-indicator-filters.js` (F11 cases). |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. The clinician remains responsible for reviewing the Medicus record. |

---

### H-003 — False-positive clinical indicator (spurious alert)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-003 |
| **Description** | A drug-monitoring interval or QOF indicator is shown as overdue or unachieved when it has in fact been completed or is not applicable to the patient. |
| **Potential causes** | Substring register match catches an unintended problem label; date arithmetic error around year boundaries; user-misconfigured rule; threshold edited locally and not reverted; coded entry present but on a different endpoint than the rule queries. |
| **Affected users / components** | Clinicians and QOF leads. Components: `engine/rules-engine.js`, `rules/*`, `sentinel-options/*`. |
| **Initial severity** | 2 (Minor — repeat test or unnecessary clinical attention) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Substring matching limitation explicitly disclosed. (b) Verification against source record required by disclaimer before any action. (c) Register match logic is intentionally conservative (label must contain the expected substring). (d) Test suite includes false-positive regression cases (`test-custom-rules.js`, `test-qof-year.js`, `test-applicability-filters.js`). (e) Practice-authored custom rules are constrained to the engine's supported rule types via the form builder — drug-monitoring, drug-combo, qof-indicator (observation-threshold / medication-present / observation-recent / observation-trend / observation-alert), event-count, and composite — and to those fields the schema validator accepts; arbitrary logic is not exposed. (f) **Deliberate fail-open trade-off (v3.12.1):** because age/sex filters now fail open on *unknown* demographics (see H-002), a gated rule can fire for a patient who is in fact out of scope when the banner can't be read — a small, accepted increase in out-of-scope prompts, chosen so safety-critical alerts are not missed, and intercepted by mandatory source-record verification. A rule still does **not** fire for a patient *known* to be out of scope. (g) **Engine-backed live preview (v3.15.0–v3.16.0):** the builder evaluates the rule-under-construction against an editable test patient using the real engine, so an author can see false-positive (and false-negative) firing behaviour before saving. (h) **Register and indicator false-positive corrections (v3.20.0):** DM021/DM035 no longer fire for all diabetics (stratified by frailty via `requiresAnyProblem`); DM register excludes 'pre-diabetic'/'prediabetes' variants; HRT review chip now gated on co-prescribed systemic oestrogen — standalone Mirena/POP for contraception no longer raises it. (i) **Hysterectomy detection fix (v3.26.4):** hysterectomy coded as a past/ended problem now correctly detected, removing a false HRT "no progestogen or hysterectomy recorded" chip for patients who do not need progestogen cover. (j) **Vaccine eligibility critical false positive (v3.26.1):** the initial v3.26.0 release contained a type error causing all patients to show as flu-eligible (`patientOnRegister()` returns a truthy object, not a boolean); this was identified and corrected in v3.26.1 before broad clinical use, and the register-matching path is now tested against non-eligible cases. (k) **HRT IUS expiry date guard (#70, v3.54.0):** an expired problem-coded LNG-IUS (>5 years since insertion) no longer suppresses the "no progestogen or hysterectomy recorded" chip for patients on oestrogen-only HRT. The chip now correctly fires, and the chip-renderer surfaces an amber "IUS expired (>5y) — endometrial cover not confirmed" prompt when an expired coil is the only finding, prompting the clinician to verify current contraception and endometrial protection status. Regression-guarded by `test-qof-indicator-filters.js` (F11 cases). |
| **Residual severity** | 2 |
| **Residual likelihood** | 3 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Over-investigation risk exists but is intercepted by clinician verification of the source record. The fail-open trade-off was reviewed by the CSO and accepted as net safety-positive (missed safety alerts are the more serious failure mode). |

---

### H-004 — Practice-authored rule is clinically incorrect

| Field | Value |
|-------|-------|
| **Hazard ID** | H-004 |
| **Description** | A rule authored by the practice (in the Monitoring form builder or via custom-indicator import) produces clinically incorrect output because the rule itself is wrong, not because the extension malfunctioned. |
| **Potential causes** | Author misreads current guidance; threshold value mis-typed; register substring is too broad or too narrow; rule not reviewed when guidance changes; rule copied from another practice without review; multiple rule revisions cause stale rule to be active. |
| **Affected users / components** | Clinicians relying on practice-authored rules. Components: `sentinel-options/*`, `shared/io/*`, rule import/export. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 3 (Possible — depends on practice rule-authoring discipline) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The deploying practice is responsible for clinical validity of its own rules — stated in `CLINICAL-SAFETY-NOTICE.md` and in the disclaimer. (b) The form builder constrains rule logic to the engine-supported rule types (drug-monitoring, drug-combo, qof-indicator, event-count, observation-alert, composite) and their defined check shapes — arbitrary decision logic is not exposed. (c) Custom rules are visually labelled "Custom" in the UI. (d) Custom rules are explicitly not QOF rules; their points field is metadata only. (e) Backup/restore of rule sets allows the practice to review historical configurations. (f) The CSO recommends practices nominate a rules owner who reviews custom rules at each guidance update. (g) **Engine-backed live preview (v3.15.0–v3.16.0):** before saving, the author can run the rule against an editable test patient (medications / observations / problems / age / sex / date) and see whether — and why — it would fire, using the same engine the runtime uses, with an "auto-fill from rule" helper that seeds a firing example. This lets an author catch a mis-scoped or non-firing rule at authoring time rather than in production. (h) **Validate-on-save (v3.15.0–v3.16.0):** every rule type now saves only after passing the shared `validateCustomRule` schema validator (the same one used on import), so the form can no longer persist an object the engine would reject or silently mis-evaluate; covered by `test-alert-builder.js`. (i) **Form builder engine-parity gaps closed (v3.22.0):** the builder now exposes `requiresProblem`, `requiresAnyProblem`, `excludeIfProblem`, sex, age range, `mustNotBePresent` drug-absence gate, and per-test SNOMED aliases for drug-monitoring rules. Critically, `medicationExclude` — which the form previously saved but the engine silently did not apply — is now correctly evaluated; rules relying on medication exclusions now behave as authored. `test-qof-indicator-filters.js` extended to 39 assertions covers the parity cases. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP), with explicit deploying-organisation duty |
| **Acceptability** | Accepted, subject to the practice fulfilling its DCB0160-style duties as described in `CLINICAL-SAFETY-NOTICE.md`. The v3.15.0–v3.16.0 live preview and validate-on-save materially reduce the likelihood of a malformed or mis-scoped rule reaching production, but do not relieve the practice of responsibility for the *clinical* correctness of the rule. |

---

### H-005 — Silent failure of the extension

| Field | Value |
|-------|-------|
| **Hazard ID** | H-005 |
| **Description** | The extension fails to load, or one of its modules stops functioning, without producing a visible error — leading users to assume the absence of chips or alerts means an "all clear" result. |
| **Potential causes** | Chrome update breaks the extension; manifest permission revoked; content script failed to inject; Medicus DOM changes such that selectors no longer match; uncaught exception in the rules engine; service worker terminated and not revived; user disabled the extension in `chrome://extensions` without realising. |
| **Affected users / components** | All users. Components: `service-worker.js`, `manifest.json`, all content scripts. |
| **Initial severity** | 3 (Moderate — false reassurance leads to missed action) |
| **Initial likelihood** | 3 (Possible — browser and Medicus both evolve) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The user-facing safety notice states explicitly that absence of a chip is not equivalent to "all clear". (b) The extension icon in the toolbar is the primary "alive" indicator; the popup shows version and status. (c) The Options page version banner identifies the running version and the latest available version. (d) Logging of fetch failures and rule-engine exceptions is available via the developer console. (e) Medicus surfaces overdue items independently of the extension — Monitoring is not the only line of defence. (f) Users are instructed to stop relying on the extension and verify the source record if a module appears blank or behaves unexpectedly. (g) The extraction-health canary (`assessExtractionHealth`, v3.17.0) is wired through to the **Sentinel side panel** as of v3.17.2: when a patient is identified on a live view but nothing can be extracted (the signature of a Medicus DOM/API change), the panel shows a prominent **"⚠ Couldn't read this record — this is NOT an all clear"** warning rather than a benign empty state. Prior to v3.17.2 this canary only guarded the in-page HUD renderer, which suite mode does not mount. (h) The side-panel snapshot is invalidated the instant the SPA navigates and whenever an extraction fails, so a previous patient's chips can never be displayed against the record now on screen (wrong-patient guard); `test-sentinel-panel-state.js` regression-guards both behaviours. (i) **CI pipeline established (v3.17.0):** a new `test.yml` GitHub Actions workflow runs the full automated test suite, the triage-defaults consistency check, and syntax checks on every push and pull request — previously the release workflow cut releases without running tests. The "release gating runs tests" control is now enforced by CI at both commit and release stages, not merely stated. (j) **Per-module extraction breakdown (v3.33.0):** the Sentinel side panel now displays what the extension actually read from each record — `Extracted: N meds · N obs · N problems` — with any zero count amber-flagged for verification. This narrows the H-005 detection gap between the across-the-board blank that trips the `degraded` banner (control g) and a *partial* scraper failure (e.g. medications populated but observations silently empty after a Medicus change), which a clinician can now spot directly. It is deliberately **informational only** — a per-module zero is never treated as an alarm, since a record can legitimately have none — so it adds detection sensitivity without introducing false-reassurance or alert-fatigue risk. Regression-guarded by `test-extraction-health.js` and `test-sentinel-panel-state.js`. (k) **Extraction-drift detection (v3.47.0):** `shared/extraction-health.js` builds a rolling per-view extraction baseline (integer counts only, no PII; MAX_SAMPLES=40 with oldest evicted at MAX_BUCKETS=50 cap) and fires a `degraded` side-panel banner when ≥4 of the last 5 records show zero on a metric whose historical median ≥3 (minimum 10 samples cold-start gate; 24h dismissal snooze via `isMuted`). This extends existing control (j) to catch gradual regression patterns across patients rather than single-patient fetch failures. The baseline is excluded from suite backups (a stale baseline would mask or fake drift); regression-guarded by `test-extraction-baseline.js` (254 assertions). (l) **Journal-augmentation failure surfaced (v3.53.0):** the Sentinel snapshot now carries `journalAugmentFailed/journalAugmentError` metadata (no patient data) and the side panel renders a muted warning line when journal augmentation fails — making 'no_data' from a failed journal fetch distinguishable from genuinely absent coded data (previously this failure was silent). |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Independent Medicus workflows remain the primary safety net. |

---

### H-006 — Update introduces a regression in clinical logic

| Field | Value |
|-------|-------|
| **Hazard ID** | H-006 |
| **Description** | A new release of Medicus Suite changes the behaviour of a clinical rule or data extractor in a way that produces incorrect output that was not present in the prior release. |
| **Potential causes** | Bug introduced in rule engine; default threshold inadvertently changed; date logic regressed at year boundary; normaliser broken by refactor; supply-chain change in a dependency. |
| **Affected users / components** | All users on the affected version. Components: any code path under `engine/`, `content-scripts/`, `rules/`. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 2 (Unlikely — CI gates) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) The full automated test suite (440+ automated checks at v3.26.4, across 17 test files) must pass before a release tag is pushed; the CI release workflow fails closed on any failure. (b) Test files cover the rule engine, QOF year logic, QOF indicator filters, custom indicators, IO, update checker, request monitor, applicability filters, STOPP/START prescribing flags, extraction health, sentinel panel state, snapshot bridge, suite IO, and the custom-rule-builder round-trip. (c) **A dedicated CI test workflow (`test.yml`, v3.17.0)** runs the full suite plus defaults-consistency and syntax checks on every push and pull request — making regression detection continuous, not just at release; previously the release workflow cut releases without running the test suite. (d) `CHANGELOG.md` documents every change. (e) Version number is surfaced in the Options page and popup. (f) The auto-update mechanism alerts users to new versions but does not auto-install. (g) A CSO-approved hot-fix release can be cut within hours. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-007 — Clinician automation bias (over-trust of displayed values)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-007 |
| **Description** | A clinician treats a Monitoring chip, a Triage Lens summary, a Referrals Tracker row, or a Patient Record Visualiser output as the definitive clinical record and takes clinical action without verifying the underlying Medicus record. |
| **Potential causes** | Time pressure; complacency after repeated correct outputs; visual prominence of chips; pattern of "green = done"; alert fatigue causing inverse trust ("if it's not red I won't check"); junior staff assuming the extension is authoritative; Visualiser eFI or PINCER output treated as a clinical assessment rather than a prompt to review. |
| **Affected users / components** | All clinical users. Components: any display module. |
| **Initial severity** | 3 (Moderate — clinical action based on incorrect display) |
| **Initial likelihood** | 4 (Likely — automation bias is a well-documented human factors phenomenon) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) The "single most important rule" in `CLINICAL-SAFETY-NOTICE.md` explicitly requires verification of every value against the source record before any clinical action. (b) The disclaimer makes verification a binding condition of use. (c) The side panel is visually positioned as an overlay — not styled to imitate the Medicus record. (d) No chip uses language that asserts clinical truth. (e) The Clinical Safety Notice is required reading before installation. (f) The deploying practice is asked to brief users at induction on the "not the record" principle. (g) Custom indicators are visually labelled "Custom". (h) Visualiser eFI and PINCER outputs are explicitly labelled as supplementary screening aids with disclosed limitations. (i) The Triage Lens record-panel STOPP/START prescribing prompts, the risk-tool signpost chip, and the Pharmacy First signposting snippets (v3.13.0–v3.14.0) are likewise deterministic, name-based prompts to *review and verify* — they carry no assertion of clinical truth, the risk-tool chip explicitly states the suite does not compute the score, and the Pharmacy First snippets are worded "consider … if eligible" with red-flag safety-netting (see H-019). (j) The **BP Trend and ACR Trend tabs** (v3.25.0) display graphical trend data drawn from the Medicus investigation dashboard. The ACR Trend module shows threshold-based action banners ("⚠ ACR ≥70 mg/mmol — consider nephrology referral (NICE NG203)"; "ACR has doubled — review and repeat"; "ACR category has increased — escalate monitoring frequency"). These are threshold comparisons against published NICE NG203 criteria, worded as prompts to *consider* or *review* — they do not recommend a specific clinical action, they do not account for patient-specific context (existing specialist involvement, dialysis, biopsy, patient preference), and they require verification against the live Medicus record before any action is taken. (k) **Vaccination eligibility chips** (v3.26.0) are worded as "DUE / GIVEN / DECLINED (inferred)" and carry a "DOUBLE-CHECK ELIGIBILITY" disclaimer — see H-020. (l) **Hyperkalaemia (K⁺) and falling eGFR alerts** (v3.18.0) are arithmetic threshold comparisons against NICE/KDIGO criteria; a red K⁺ ≥6.0 alert is a prompt to verify the result in the Medicus record, not a confirmed clinical emergency — the result may be old, haemolysed, or already acted on. (m) **Pre-consultation Brief (v3.49.0):** the collapsible brief card surfaces only the top 4 risk-ranked action signals plus a "+N more below" overflow count; a clinician who reads only the brief without expanding the full chip list may miss chips outside the top 4. The brief is presented as a 30-second orientation aid, not a complete safety summary, and the overflow count is always visible when chips are truncated. (n) **Patient Passport (v3.50.0):** the plain-English health summary for patients is generated from the current Sentinel snapshot and reviewed by the GP before handing to the patient. Automation bias risk: a GP who has generated and reviewed the passport may regard the consultation as complete without re-verifying the source record. The passport is subject to all Sentinel snapshot limitations (limitations 1–9 in `CLINICAL-SAFETY-NOTICE.md`). (o) **SMR Workstation print output (Visualiser, v3.51.0):** the 'Print SMR summary' renders a document containing patient identifiers, ACB scores, STOPP/START flags, and PINCER flags derived from the PDF export. The printed summary is a point-in-time output that inherits H-013 PDF staleness risk; it must not be treated as the live clinical record. |
| **Residual severity** | 3 |
| **Residual likelihood** | 3 |
| **Residual risk** | 9 — Acceptable (ALARP); identified as the **primary residual risk** in the system |
| **Acceptability** | Accepted. This is the most important residual risk and is the focus of safety messaging. Any future safety review must revisit this hazard. |

---

### H-008 — Patient identification error in the Referrals Tracker

| Field | Value |
|-------|-------|
| **Hazard ID** | H-008 |
| **Description** | The Referrals Tracker displays a row attributing a referral to the wrong patient, clinician, specialty, or hospital, leading a user to investigate the wrong record or act on the wrong information. |
| **Potential causes** | Column mis-mapping after a Medicus clinical-audit-report API change; sort/filter applied to one column but rendered against another; pagination boundary error; identically-named patients confused on display. |
| **Affected users / components** | Practice managers, QOF/referral leads, clinicians reviewing referrals. Components: `side-panel/modules/referrals/*`, `content-scripts/referrals-discovery.js`. |
| **Initial severity** | 3 (Moderate — admin re-work, very low probability of clinical action without further verification) |
| **Initial likelihood** | 2 (Unlikely) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Referral records are not stored persistently — each refresh re-fetches from Medicus. (b) The tracker is positioned as an admin/audit tool; clicking into a record returns the user to Medicus. (c) Patient name is shown alongside referral metadata so the user can cross-check. (d) Column mappings are derived from the Medicus API response keys, not from positional indexing. (e) Any reported mis-attribution triggers immediate CSO review. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-009 — Patient data egress (data leaves the browser)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-009 |
| **Description** | Patient-identifiable data is transmitted to a server outside the user's authenticated Medicus session, contrary to the intended-purpose statement. |
| **Potential causes** | Code defect creates an unintended outbound request; supply-chain compromise; hostile extension update; user installs a forked or modified copy from an unofficial source; copy-paste error placing patient data in an outbound update-check request. |
| **Affected users / components** | All users and their patients. Information governance impact for the deploying practice. Components: `service-worker.js`, `shared/update-checker.js`, `engine/api-client.js`. |
| **Initial severity** | 5 (Catastrophic from an IG perspective; reportable to ICO) |
| **Initial likelihood** | 2 (Unlikely) |
| **Initial risk** | 10 |
| **Controls / mitigations** | (a) The manifest's `host_permissions` are restricted to `*.medicus.health/*`, `*.api.england.medicus.health/*`, and `api.github.com/*` — outbound calls to any other host require a manifest change and a new release. (b) The update checker transmits only the version string to the GitHub releases API — no patient or practice identifiers. (c) Update checks can be disabled entirely via the Options page. (d) All Medicus API calls reuse the user's existing session cookies — no separate credentials are stored. (e) Code review and CI inspect `manifest.json` and outbound fetch calls at every release. (f) The repository is private; releases are built via the GitHub Actions release workflow. (g) Users are instructed never to install from an unofficial source. (h) The Visualiser processes PDFs entirely in-memory; no PDF content is transmitted externally. (i) **Consume-on-read for print-key pages (v3.53.0):** `passport.js` (Patient Passport) and `handout.js` (Sweep print handout) now call `chrome.storage.local.remove()` immediately after rendering, so patient-identifiable data (name, DOB, NHS number, observations) is not left on disk beyond the render cycle; a page refresh after printing shows the empty state. This closes the window in which PII stored transiently for cross-tab rendering could be accessed by another user or tab. Regression-guarded by `test-passport-core.js`. (j) **Prototype-pollution hardening on backup import (v3.53.0):** `sentinel-io.js` and `practice-profile.js` now strip `__proto__`, `constructor`, and `prototype` keys from untrusted backup data before any `Object.assign` merge into clinical rules or reception config, mirroring the `safeCopy` pattern already used in `engine/ruleset-io.js`. This prevents a crafted backup file from injecting properties into JavaScript built-in prototypes and silently altering rule evaluation behaviour. Regression-guarded by `test-import-hardening.js`. |
| **Residual severity** | 5 |
| **Residual likelihood** | 1 |
| **Residual risk** | 5 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any suspicion of egress triggers immediate suspension of distribution and CSO investigation. |

---

### H-010 — Data displayed out of context (misinterpretation)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-010 |
| **Description** | A correctly-extracted value is displayed without the contextual qualifiers that change its clinical meaning (e.g. an HbA1c result from before a diagnostic change of treatment; a BP recorded under unusual conditions; a referral whose "open" status reflects an administrative backlog rather than clinical reality). |
| **Potential causes** | Monitoring chips show single most-recent values without surrounding history; the API response does not include qualifiers; referrals appear "open" when actually awaiting administrative closure; waiting-room times reflect login state, not clinical urgency. |
| **Affected users / components** | All users. Components: all display modules. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) Monitoring chips link back to the Medicus record where full context is visible. (b) The Clinical Safety Notice states explicitly that the extension reorganises data already in Medicus — it does not interpret it. (c) Threshold checks are described in the disclaimer as arithmetic, not clinical. (d) No chip applies clinical language that asserts meaning beyond the threshold check. (e) The deploying practice's induction is asked to cover the "in-context vs out-of-context" distinction. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-011 — Browser or platform compatibility failure

| Field | Value |
|-------|-------|
| **Hazard ID** | H-011 |
| **Description** | The extension behaves incorrectly on an unsupported browser, browser version, operating system, or screen configuration — for example silently dropping a module, mis-rendering a chip, or producing layout overlap with Medicus. |
| **Potential causes** | User installs on a Chromium-derivative (Edge, Brave) rather than supported Chrome; Manifest V3 API behaviour differs between Chrome channels; high-DPI scaling; very small viewport; OS-level accessibility settings; corporate group policy disables side panel API. |
| **Affected users / components** | Users on non-standard browsers or screen configurations. Components: all UI surfaces, `manifest.json`. |
| **Initial severity** | 2 (Minor — usability impact) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Supported browser stated as Google Chrome stable channel (README). (b) Manifest V3 conformant; side panel API used in the recommended way. (c) Shadow DOM isolates extension CSS from Medicus CSS. (d) If a layout overlap is reported, user can close the side panel without losing Medicus state. (e) Practice IT is asked to confirm Chrome is the standard browser before deployment. |
| **Residual severity** | 2 |
| **Residual likelihood** | 2 |
| **Residual risk** | 4 — Broadly acceptable |
| **Acceptability** | Accepted. |

---

### H-012 — Alert fatigue and inhibition of independent verification

| Field | Value |
|-------|-------|
| **Hazard ID** | H-012 |
| **Description** | Repeated low-value or false-positive alerts cause users to dismiss Monitoring or Triage Lens chips without due attention, including dismissing alerts that on a given occasion are genuinely meaningful — or cause users to bypass their normal verification step because "the extension would have flagged it". |
| **Potential causes** | Practice-authored rule set is too broad; bundled rule set produces excessive chips for some patient cohorts; chips persist across sessions; visual prominence too aggressive; no way to dismiss-with-reason. |
| **Affected users / components** | All clinical users. Components: Monitoring display logic, Triage Lens HUD, `sentinel-options/*`. |
| **Initial severity** | 3 (Moderate) |
| **Initial likelihood** | 3 (Possible) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The deploying practice is asked to curate its rule set rather than enabling everything by default. (b) Custom rules can be disabled individually via the Options page. (c) Chips are colour-coded so that the user's eye is drawn to the most clinically relevant. (d) The Clinical Safety Notice frames the extension as a memory aid, not a workflow gate. (e) The CSO recommends that practices monitor for "alert fatigue" anecdotally and adjust rule sets accordingly. (f) **Per-rule hide/snooze (v3.26.3):** individual chips can be dismissed with an unobtrusive ×; vaccine chips snooze until the season end (auto-resurface), drug-monitoring and QOF indicator chips can be permanently hidden from a user's panel. This provides a targeted mechanism to suppress persistent false positives without disabling an entire rule. **Caution:** permanently hidden chips introduce the risk described in H-021; the practice must brief users and the rules owner must review suppressions periodically. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted, with deploying-organisation duty to curate rule sets. |

---

### H-013 — Patient Record Visualiser — PDF snapshot staleness

| Field | Value |
|-------|-------|
| **Hazard ID** | H-013 |
| **Description** | The Patient Record Visualiser is loaded with an EPR export PDF that was generated at some point in the past. Clinical information displayed — including medications, investigations, problems, frailty score, prescribing flags, and monitoring compliance — may not reflect the patient's current clinical status if the PDF is outdated. |
| **Potential causes** | User re-uses a PDF exported at a prior consultation; PDF generated days or weeks before the current session; multiple clinical events have occurred since export (medications changed, investigations resulted, problems resolved or added); user shares a PDF with a colleague who analyses it later. |
| **Affected users / components** | Any user of the Patient Record Visualiser. Components: `visualiser-core.html`, `visualiser-core.js`. |
| **Initial severity** | 4 (Major — clinical decision based on stale data) |
| **Initial likelihood** | 3 (Possible — PDF workflow naturally introduces a lag between export and analysis) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) PDF export date is extracted from the document and displayed prominently in the patient banner at the top of the Visualiser. (b) User instructions state that the most recently exported PDF should be used. (c) The Visualiser is positioned as an audit and analytical tool, not a substitute for the live record. (d) Verification against the current live Medicus record is required by the disclaimer before any clinical action. (e) The Visualiser opens in a separate browser tab, visually distinct from the live Medicus session — the two cannot be confused. (f) Clinical Safety Notice section 7 explicitly lists PDF staleness as a known limitation. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any clinical action informed by the Visualiser must be verified against the current Medicus record before it is taken. |

---

### H-014 — Patient Record Visualiser — silent partial data omission during PDF parsing

| Field | Value |
|-------|-------|
| **Hazard ID** | H-014 |
| **Description** | The PDF text extraction layer fails to parse some entries from the record — for example entries on pages with unusual layout, items rendered as images, or sections using non-standard fonts — and the Visualiser displays a dashboard that silently omits those entries. |
| **Potential causes** | pdf.js returning text items without `transform` data (certain font types or print drivers); non-text PDF elements (images, form fields, scanned pages); encrypted or DRM-protected PDFs; Medicus changing its PDF export layout after a Visualiser release; very large PDFs; page-level parse errors in the `reconstructLines` function. |
| **Affected users / components** | All Visualiser users. Components: `visualiser-core.js` `parsePDF()`, `reconstructLines()`. |
| **Initial severity** | 3 (Moderate — analytical conclusions may be based on an incomplete record) |
| **Initial likelihood** | 2 (Unlikely — item-level `transform` guard prevents crash; standard Medicus PDF exports are text-based) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) `reconstructLines()` includes a guard (`!item.transform`) that skips malformed text items rather than crashing, preventing silent partial display from becoming a complete failure. (b) Stage-aware error messages in the catch block identify which parsing stage failed (v1.8.0). (c) `[Visualiser]` prefixed warnings are logged to the browser console for any parse anomaly. (d) Entry counts are displayed throughout the Visualiser (e.g. filter bar "Showing N of M entries") so a user can detect implausibly low counts. (e) Verification against the live Medicus record is required before any clinical action. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-015 — eFI score inaccuracy (frailty under- or over-estimated)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-015 |
| **Description** | The Electronic Frailty Index (eFI) score computed by the Visualiser is inaccurate — either overstating frailty (leading to unnecessary frailty-pathway intervention or labelling) or understating it (leading to frailty being overlooked in clinical planning). The Charlson Comorbidity Index and the condition-summary cards (v3.5.0) share this same keyword-matching limitation and are likewise display-only indicators, not diagnostic outputs. |
| **Potential causes** | Deficit detection relies on substring matching of problem-list text against a 36-deficit reference list; non-standard or abbreviated problem coding may miss deficits; historical problems (inactive but still listed) may over-count; the 36-deficit set is based on the Clegg 2016 academic index and may not exactly replicate the eFI as calculated from SNOMED refsets in GP clinical systems; very sparse problem lists (new patients, recently registered patients) will produce artifactually low scores. |
| **Affected users / components** | Clinicians using the Snapshot tab. Components: `visualiser-core.js` `computeEFI()`, `EFI_DEFICITS` constant. |
| **Initial severity** | 3 (Moderate — frailty status is a screening indicator used to inform care planning; it is not a diagnostic label and clinical frailty assessment requires clinical synthesis) |
| **Initial likelihood** | 3 (Possible — problem-list coding variability is common in GP records) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) eFI is displayed alongside the detected deficit count (e.g. "8/36 deficits detected") so the user can see the basis for the score. (b) The gauge category labels (Fit / Mild / Moderate / Severe) are from the published Clegg index and are standard frailty categories, not novel clinical labels. (c) The Visualiser is an analytical aid, not a diagnostic system; the eFI is one data point in the Snapshot tab alongside the full problem list. (d) Clinical frailty classification must be validated by the clinician against the full clinical picture and direct patient assessment. (e) The disclaimer and Clinical Safety Notice (section 7, limitation 12) explicitly state that the eFI is an arithmetic approximation. (f) No clinical workflow or referral pathway is triggered by the eFI score in the software — it is display only; the v3.5.0 Charlson index and condition-summary cards are likewise display-only, show the contributing coded problems, flag missing inputs (e.g. "age unknown", "no recent value"), and carry no mortality-percentage mapping. |
| **Residual severity** | 3 |
| **Residual likelihood** | 3 |
| **Residual risk** | 9 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Clinician retains full responsibility for frailty classification and any frailty-pathway decisions. |

---

### H-016 — PINCER / drug-monitoring false-negative (prescribing safety hazard missed)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-016 |
| **Description** | The Visualiser fails to surface a PINCER prescribing safety flag or a high-risk drug monitoring overdue indicator when one should be present — for example, a patient is taking an NSAID and has heart failure, or is on methotrexate with monitoring now overdue, but no flag appears in the Medications tab or Snapshot. |
| **Potential causes** | Drug name in the PDF text is a brand name, abbreviation, or coding variant not matched by the drug-family regex; disease label does not contain the expected substring; the drug-disease combination is not in the implemented PINCER rule set (5 combinations as at v3.16.0); monitoring investigation uses a local or abbreviated name not matched to the expected panel name; the PDF section containing the drug or problem was not extracted (see H-014); historical prescribing not visible in the export window. |
| **Affected users / components** | Clinicians using the Medications tab or Snapshot PINCER card. Components: `visualiser-core.js` `computePINCER()`, `computeDrugMonitoring()`, `HIGH_RISK_DRUGS` constant, `PINCER_RULES` constant. |
| **Initial severity** | 4 (Major — a clinically significant prescribing safety hazard is not surfaced) |
| **Initial likelihood** | 3 (Possible — regex-based detection; PINCER set expanded to 11 flags as at v3.47.0 but remains a subset of the full PINCER tool) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) The PINCER implementation is explicitly documented as a subset of the full PINCER tool — it is supplementary to Medicus's own prescribing safety systems, which remain the primary clinical safety gate. (b) The implemented PINCER rules and drug families are listed in `INTENDED-PURPOSE.md` and the known limitations section of the Clinical Safety Notice. (c) Absence of a PINCER flag is explicitly documented as not a guarantee of prescribing safety (Clinical Safety Notice section 7, limitation 13). (d) Drug-family regex is designed to capture common brand names and generic variants for each family, but cannot cover all possible nomenclature variants. (e) Medicus's own drug interaction and contraindication checking system operates independently of this extension. (f) Verification against the live Medicus record is required by the disclaimer before any clinical action. (g) **PINCER visualiser expansion (v3.47.0):** the PINCER rule set was expanded from 5 to 11 flags: P-A (NSAID + peptic ulcer/GI bleed history, no gastroprotection); P-B (antiplatelet + peptic ulcer/GI bleed history, no gastroprotection); P-C (NSAID without gastroprotection, age ≥65); P-D (oral anticoagulant + antiplatelet, no gastroprotection); P-E (aspirin + P2Y12 antiplatelet, no PPI); P-F (ACEi/ARB or thiazide/loop diuretic, age ≥75, U&E overdue >15 months); plus the original 5 flags. Three new drug-family entries added: H2-blockers, antiplatelets, and aspirin-as-antiplatelet. Age-gated flags (P-C, P-F) fail-closed: when age cannot be parsed, the flag does NOT fire (conservative false-negative over false-positive for the Visualiser context — see H-017). LMWH/heparin and COCP+VTE are documented as deferred. `test-visualiser-pincer.js` (23 assertions) and `test-pincer-parity.js` (189+ assertions parity-testing Visualiser vs live Triage Lens flags) regression-guard the expanded set. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP) |
| **Acceptability** | Accepted, with the express condition that PINCER flags in the Visualiser are supplementary prompts only and that Medicus's own prescribing safety systems remain the primary clinical control. |

---

### H-017 — PINCER / drug-monitoring false-positive (spurious prescribing safety flag)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-017 |
| **Description** | A PINCER prescribing safety flag or drug monitoring overdue badge is shown when no clinical hazard exists — for example, a drug is no longer prescribed but appears in the historical medication list in the PDF, or a disease label matches the substring but the condition is resolved, or a monitoring test was performed recently but was not detected in the PDF text. |
| **Potential causes** | PDF export includes historical medications that are no longer active and are not clearly labelled as discontinued; problem list contains historically-coded problems now resolved; monitoring test uses a locally-abbreviated name not matched to the expected investigation name; date parsing error causes a recent test to appear older than it is. |
| **Affected users / components** | All Visualiser users. Components: `visualiser-core.js` `computePINCER()`, `computeDrugMonitoring()`. |
| **Initial severity** | 2 (Minor — unnecessary clinical review; no harm to patient) |
| **Initial likelihood** | 3 (Possible — PDF-based extraction cannot reliably distinguish active from historical medications in all Medicus export formats) |
| **Initial risk** | 6 |
| **Controls / mitigations** | (a) Verification against the live Medicus record is required before any clinical action — a false-positive flag leads to a brief unnecessary check, not patient harm. (b) The Medications tab displays the source context (drug name as detected in the PDF) alongside the flag, allowing the clinician to judge its currency. (c) The disclaimer and Clinical Safety Notice frame flags as prompts to check, not clinical decisions. (d) False-positive flags are a minor inconvenience, not a safety hazard in themselves — they prompt verification rather than preventing it. (e) **Age-gated PINCER flags fail-closed (v3.47.0):** P-C (NSAID, age ≥65) and P-F (ACEi/ARB/diuretic, age ≥75) do NOT fire when age cannot be parsed from the PDF. This is a deliberate, accepted trade-off for the Visualiser context (PDF-derived age is generally reliable) that reduces age-dependent false-positive risk at the cost of a small false-negative risk when age is absent — the reverse of the fail-open convention used in the live Sentinel applicability filters. |
| **Residual severity** | 2 |
| **Residual likelihood** | 3 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. |

---

### H-018 — Patient-identifiable data entered into the feedback email

| Field | Value |
|-------|-------|
| **Hazard ID** | H-018 |
| **Description** | The in-app Feedback / feature request / bug report control composes an email to the developer via the user's own mail client. A user could type or paste patient-identifiable information (name, NHS number, date of birth, clinical detail) into the subject or body, causing it to be transmitted outside the authenticated Medicus session to the configured recipient inbox. |
| **Potential causes** | User pastes record content to illustrate a bug; user describes a specific patient rather than the behaviour; misunderstanding that the channel is internal/anonymised. |
| **Affected users / components** | The reporting user and any patient they reference; information-governance impact for the deploying practice. Components: `side-panel/panel.js` (feedback composer), Options › Suite (`suite.feedbackEmail` recipient). |
| **Initial severity** | 4 (Major — confidentiality breach, but bounded: single known recipient, user-initiated, requires deliberate text entry) |
| **Initial likelihood** | 2 (Unlikely) |
| **Initial risk** | 8 |
| **Controls / mitigations** | (a) The feedback form displays an explicit warning not to include patient-identifiable information (names, NHS numbers, dates of birth). (b) The extension auto-attaches only non-clinical diagnostics — suite version, browser user-agent, and timestamp; it never auto-includes any record data. (c) The email opens pre-filled in the user's own mail client and must be reviewed and sent manually — the extension transmits nothing itself and has no server endpoint (`mailto:` only). (d) The recipient address is configurable (Options › Suite), so a practice may direct feedback to an internal, IG-approved mailbox rather than an external one. (e) The Clinical Safety Notice instructs users that feedback must never contain patient data. |
| **Residual severity** | 4 |
| **Residual likelihood** | 1 |
| **Residual risk** | 4 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Any report received containing patient-identifiable data is to be deleted and the sender reminded of the rule. |

---

### H-019 — Triage Lens record-panel prescribing prompts and signposting (STOPP/START, Pharmacy First, risk-tool links)

| Field | Value |
|-------|-------|
| **Hazard ID** | H-019 |
| **Description** | The Triage Lens record / medications panel surfaces deterministic prescribing-combination prompts (STOPP/START-style: NSAID + anticoagulant/antiplatelet; "triple whammy" NSAID + ACEi/ARB + diuretic; benzodiazepine/Z-drug in age ≥80), a risk-tool signpost chip (links to the QRISK3 / QCancer / eFI calculators), and NHS Pharmacy First pathway signposting snippets. These may (a) fail to surface a relevant prescribing combination (false-negative), (b) surface a combination that is not in fact a hazard for this patient (false-positive), or (c) prompt signposting of a patient to community pharmacy whose presentation is not actually suitable for a Pharmacy First pathway. |
| **Potential causes** | Drug detection is name-based regex and will miss brand/abbreviation/coding variants and topical-vs-systemic nuances beyond those excluded; the implemented STOPP/START set is a small, intentionally low-false-positive subset, not the full STOPP/START v2 criteria; combination "hazard" cannot account for the individual's indication, existing gastroprotection, monitoring, or specialist plan; Pharmacy First eligibility is age/sex/clinically gated and the patient's age/sex may be unknown or the request text ambiguous; the risk-tool chip computes no score. |
| **Affected users / components** | Clinicians using the Triage Lens record panel. Components: `content-scripts/triage-lens/content.js` (`evaluatePrescribingFlags`, `computeSignals` MEDS tile, `record.stoppStart` / `record.riskScores` chips), `content-scripts/triage-lens/defaults.json` (Pharmacy First actions and the four added pathway rules). |
| **Initial severity** | 3 (Moderate — a missed prompt is backed by Medicus's own prescribing safety; a spurious prompt or mis-signpost prompts a check, not harm) |
| **Initial likelihood** | 3 (Possible — name-based detection; subset rule set) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The prompts are explicitly supplementary to Medicus's own prescribing-safety systems, which remain the primary control. (b) STOPP/START detection is deterministic, name-based, and worded as a *review* prompt ("review need / gastroprotection", "consider deprescribing") — never a recommendation of a specific drug, dose, or change. (c) Topical NSAIDs are excluded from the combination logic; the age-gated benzodiazepine check fires only when age is *known* ≥80. (d) The risk-tool chip is signpost-only — it links to the official calculators and lists the inputs they need; the suite computes no score, deliberately avoiding the medical-device exposure of an unvalidated reimplementation (the extractors cannot supply cholesterol ratio / smoking / ethnicity). (e) Pharmacy First snippets state each pathway's age/sex gateway, are worded "consider … if eligible", carry red-flag safety-netting, and instruct the clinician to confirm eligibility — the signposting decision remains the clinician's. (f) Verification against the source record is required by the disclaimer before any action. (g) The deterministic logic is unit-tested (`test-prescribing-flags.js`) and the Pharmacy First detection rules were checked against firing / non-firing examples. (h) **Triage Lens engine hardening (v3.52.0):** `compileRule` now logs dropped/invalid patterns and no-pattern rules to the browser console instead of silently skipping them, so a practice rules owner can identify misconfigured rules via developer tools; `getText` normalises curly quotes and apostrophes to ASCII on both extraction paths, so straight-apostrophe patterns match pasted clinical-letter punctuation; non-numeric thresholds are now coerced with `Number()` and skipped with a warning rather than causing silent always-/never-fire. This hardening applies to both the request-queue pattern rules (covered by H-024) and the record-panel prescribing logic covered by this hazard. Note: **H-019 covers the Triage Lens record/medications panel only; the request-queue red-flag emergency-presentation rules are covered by H-024.** |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted, with the express condition that these prompts are supplementary and that Medicus's own prescribing-safety systems and the clinician's own assessment of Pharmacy First suitability remain the primary controls. This hazard extends the H-016 / H-017 (Visualiser PINCER) framing to the live record panel. |

---

### H-020 — Vaccination eligibility alerts: inferred status and eligibility

| Field | Value |
|-------|-------|
| **Hazard ID** | H-020 |
| **Description** | The flu and COVID-19 vaccination eligibility module (v3.26.0) infers eligibility from demographic data, QOF register membership, problem-list entries, active medications, and BMI observations using JCVI/UKHSA 2025/26 criteria. Vaccination status (DUE / GIVEN / DECLINED) is inferred from coded problems, observations, and journal entries within the current season window. Inferred eligibility or status may not reflect the patient's actual vaccination state — leading to an unnecessary patient contact (false DUE) or to an eligible patient being missed (false GIVEN). |
| **Potential causes** | Vaccination administered outside the practice (pharmacy, community hub, hospital, PCN site) and not recorded in the local Medicus record — patient is already vaccinated but the chip shows DUE; JCVI/UKHSA eligibility criteria updated mid-season after a release; BMI observation used for BMI ≥40 eligibility is outdated or absent; age eligibility computed from date of birth at evaluation time may differ from the seasonal eligibility round boundary; GIVEN/DECLINED status coded late or under a non-standard term not matched by detection logic; season window boundary not updated in a future release; initial v3.26.0 release contained a critical false-positive: all patients showed as flu-eligible due to a JavaScript type error (`patientOnRegister()` returns a truthy object, not a boolean); corrected in v3.26.1. |
| **Affected users / components** | Clinicians and vaccinators using Monitoring for vaccination recall or audit. Components: `engine/rules-engine.js` (`matchVaccineEligibility`, `evaluateVaccineRule`), `rules/vaccine-rules.json`, `shared/chip-renderer.js`. |
| **Initial severity** | 3 (Moderate — a false DUE may prompt an unnecessary patient contact; a false GIVEN may mask an eligible patient not yet vaccinated) |
| **Initial likelihood** | 3 (Possible — external vaccination events are routine; coding lag is common in primary care) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) Every vaccine chip carries a prominent "DOUBLE-CHECK ELIGIBILITY" disclaimer in the chip detail, explicitly acknowledging that vaccination status may be incomplete if given outside the practice. (b) DUE/GIVEN/DECLINED status is labelled as inferred from coded data — not authoritative. (c) Matched evidence (which register, problem, or observation drove eligibility) is visible in the expanded chip panel (v3.26.1), so the clinician can judge its currency. (d) Absence of a chip does not confirm ineligibility — the "no chip ≠ all clear" principle applies. (e) The v3.26.0 false-positive affecting all patients (truthy-object type error) was identified before broad clinical use, corrected in v3.26.1, and the register-matching path is now tested against non-eligible cases. (f) Vaccine chips can be snoozed until the season end (v3.26.3) if a chip is a persistent false positive for a particular patient group. (g) Verification against the Medicus record and, where relevant, national vaccination records (NIMS/PCSE) is required by the disclaimer before any clinical action. (h) **PPV23, shingles, and RSV one-off vaccine rules (v3.46.0):** three lifetime vaccination rules were added using JCVI/Green Book criteria: pneumococcal (PPV23, age ≥65, single dose, Green Book ch 25); shingles (Shingrix, born ≥1958-09-01 phased cohort for ages 65-69, plus 70-79, Green Book ch 28a); RSV (age 75-79, single dose, Green Book ch 27a). A `schedule:once` mode skips season-window suppression for these lifetime rules and displays the status as "No record ever held (one-off vaccine)" when no evidence is found. These vaccines are commonly administered outside the practice (pharmacy, PCN, hospital) without a local Medicus record; the "DOUBLE-CHECK ELIGIBILITY" note and verification against NIMS/PCSE are especially important for one-off vaccines where historical records may be incomplete. Regression-guarded by `test-vaccine-rules.js` (40 assertions). |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted. Vaccination eligibility is an inferential memory-aid feature. The chip is a prompt to check, not an authoritative eligibility determination. |

---

### H-021 — Permanent chip suppression creating false reassurance

| Field | Value |
|-------|-------|
| **Hazard ID** | H-021 |
| **Description** | The per-rule hide/snooze feature (v3.26.3) allows a user to permanently suppress individual drug-monitoring or QOF indicator chips on their workstation. A permanently hidden chip does not resurface if the clinical situation changes and the chip would later fire correctly — for example, a methotrexate monitoring chip hidden while monitoring was current will remain hidden when monitoring next becomes overdue. |
| **Potential causes** | User hides a chip to declutter the panel while monitoring is temporarily up to date, not understanding the suppression is permanent; user hides a chip because it was previously a false positive, but the clinical picture later makes it a true positive; the "Hidden / Snoozed Alerts" management panel in sentinel settings is not reviewed regularly; a suite backup carrying suppressions is restored to a new workstation, propagating outdated suppressions. |
| **Affected users / components** | Clinicians and rules owners. Suppression is per-workstation (stored in `chrome.storage.local`). Components: `sentinel.hiddenRules`, `side-panel/modules/sentinel/sentinel.js`, `sentinel-options/options.js`, `shared/io/sentinel-io.js`. |
| **Initial severity** | 4 (Major — for the affected user, a permanently suppressed drug-monitoring chip is functionally equivalent to that monitoring rule being deleted on their workstation) |
| **Initial likelihood** | 2 (Unlikely — suppression is a deliberate, rule-specific action; the management UI makes all suppressions visible) |
| **Initial risk** | 8 |
| **Controls / mitigations** | (a) Suppression is per-workstation and does not affect other users; other workstations continue to display the chip normally. (b) The sentinel options page shows a "Hidden / Snoozed Alerts" section listing all suppressed rules with a reinstate control — suppressions are never invisible to a user reviewing their settings. (c) Vaccine chip snoozes are time-limited and auto-resurface when the season date passes; permanent suppression applies only to drug-monitoring and QOF indicator rules. (d) The "no chip ≠ all clear" principle stated in the Clinical Safety Notice applies equally to hidden chips as to chips that never fired; users must be briefed that a missing chip may be hidden. (e) Suppressions are included in suite backup exports, allowing a rules owner reviewing the backup to audit the suppression configuration. (f) Medicus's own overdue-monitoring workflows remain the primary clinical control and are not affected by chip suppression. (g) The deploying practice's rules owner is asked to review the suppression list periodically via sentinel options, and to brief users that hiding a chip does not mean monitoring has been done. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP), with explicit deploying-organisation duty to brief users and review the suppression list periodically |
| **Acceptability** | Accepted, subject to the practice briefing users on the permanence of suppression and the rules owner reviewing the suppression list. Any report of a monitoring gap where a chip was hidden is treated as a significant safety event and triggers immediate CSO review. |

---

### H-022 — Action Packs: patient-identifiable data in clipboard and communication templates

| Field | Value |
|-------|-------|
| **Hazard ID** | H-022 |
| **Description** | The Action Packs feature (v3.48.0) generates copy-ready blood-form requests, recall SMS/letters, and pharmacist-task templates from the current Sentinel chip set. Templates include the patient's name, date of birth, NHS number, and clinical detail (drug names, overdue test names, observation values). Template text is copied to the system clipboard by the user's deliberate action. Clipboard content persists beyond the extension session and is accessible to other applications on the workstation; template text pasted into the wrong Medicus record or dispatched to an unintended recipient constitutes a patient data disclosure. |
| **Potential causes** | User copies a template and pastes into the wrong Medicus record, clinical system, or messaging platform; another application on the workstation reads clipboard content; a colleague sharing the workstation is able to read the clipboard; template dispatched via a non-IG-approved channel (personal email, WhatsApp, unencrypted SMS); user generates templates for the current panel patient while another clinician views a different patient on the same workstation. |
| **Affected users / components** | The patient named in the template; the clinician generating the pack; the deploying practice's information governance. Components: `side-panel/modules/shared/action-packs.js`, `side-panel/modules/sentinel/sentinel.js` (chip Action Pack modal). |
| **Initial severity** | 4 (Major — potential PII disclosure; potential wrong-patient clinical action if template dispatched to wrong recipient) |
| **Initial likelihood** | 2 (Unlikely — templates are manually copied and dispatched; require deliberate user action at each step) |
| **Initial risk** | 8 |
| **Controls / mitigations** | (a) Templates are generated only from the patient currently active in the Sentinel side panel; patient name and date of birth are embedded in the template specifically to make a wrong-record paste detectable on reading. (b) All templates are manually copied and manually dispatched — the extension places nothing in the clipboard automatically and has no capability to send any message. (c) Blood-form templates list only monitoring tests currently overdue; already-in-date tests are excluded, reducing the clinical-detail footprint per template. (d) The user must review template content before dispatching; no automated dispatch pathway exists. (e) The deploying practice must brief users that Action Pack content constitutes patient data and must be dispatched only through information-governance-approved channels. (f) Clipboard content management is the responsibility of the deploying practice's IT security and information-governance policy. |
| **Residual severity** | 4 |
| **Residual likelihood** | 1 |
| **Residual risk** | 4 — Acceptable (ALARP), with deploying-organisation duty to brief users |
| **Acceptability** | Accepted. Action Packs generates drafts only; all transmission is manual and user-initiated. Any report of a misdirected Action Pack template is treated as a potential information governance incident and reported to the CSO. |

---

### H-023 — SMR Workstation (Visualiser): ACB score and STOPP/START v3 prescribing-flag inaccuracy

| Field | Value |
|-------|-------|
| **Hazard ID** | H-023 |
| **Description** | The SMR Workstation tab in the Patient Record Visualiser (v3.51.0) displays an ACB burden score (Boustani scale), STOPP/START v3 (2023) criteria flags, and a printable SMR skeleton. The ACB score or STOPP/START flags may be absent when a clinically significant prescribing concern exists (false-negative), or may fire when the criterion does not apply (false-positive), potentially contributing to a prescribing safety concern being overlooked or an unnecessary medication review. |
| **Potential causes** | ACB scoring is drug-name string matching — brand names, non-standard spellings, abbreviated entries, or drugs not in the Boustani reference set receive a score of 0, under-estimating ACB burden; age-gated and eGFR-gated STOPP/START criteria fail-closed (if age or eGFR cannot be parsed from the PDF, the criterion does not fire — conservative false-negative); STOPP criteria requiring clinical-indication reasoning (e.g. "PPI without clinical indication") cannot assess indication from PDF text alone; the SMR Workstation inherits all PDF staleness (H-013) and silent parsing-omission (H-014) limitations; the implemented subset (10 STOPP + 3 START) does not cover all STOPP/START v3 (2023) criteria; the commit introducing this tab explicitly notes the ACB scores and STOPP/START criteria as a starter set requiring CSO verification before broad clinical use. |
| **Affected users / components** | Clinicians using the SMR Workstation tab in the Visualiser. Components: `engine/acb-scores.js`, `engine/stopp-start.js`, `visualiser-core.js` (SMR tab). |
| **Initial severity** | 4 (Major — a missed ACB burden or STOPP/START flag could contribute to a prescribing safety hazard going unreviewed) |
| **Initial likelihood** | 3 (Possible — drug-name matching has known coverage gaps; implemented subset is a starter set with documented limitations) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) The SMR Workstation is explicitly supplementary to the clinician's own prescribing review and to Medicus's live prescribing safety systems. (b) STOPP criterion notes display the detection basis alongside each flag (e.g. age found/not found, eGFR value used), so the clinician can see why a criterion fired or was skipped. (c) Age-gated and eGFR-gated criteria fail-closed: when age or eGFR cannot be parsed, the criterion does not fire, avoiding spurious age/eGFR-dependent alarms while accepting a small conservative false-negative risk. (d) ACB per-drug badges display the matched drug name alongside its score, making any unmatched drug visible by its absence from the badge list. (e) The SMR tab cross-links to the PINCER flags panel. (f) Verification against the current live Medicus prescribing record is required before any medication change. (g) `test-acb-scores.js` (32 assertions) and `test-stopp-start.js` (74 assertions) cover all implemented criteria and are enforced at CI. (h) All H-013 (PDF staleness) and H-014 (silent data omission) limitations apply. (i) Medicus's own prescribing safety systems remain the primary clinical control. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP), conditional on CSO verification of the ACB and STOPP/START criteria before broad clinical deployment |
| **Acceptability** | Accepted provisionally. **CSO action required:** the ACB reference set and the 13 implemented STOPP/START criteria must be verified against current Boustani guidance and STOPP/START v3 (2023) before this tab is promoted beyond limited evaluation use. Until that verification is recorded, the SMR Workstation must be treated as a reference aid only. Medicus's own prescribing safety systems remain the primary control. |

---

### H-024 — Triage Lens request-queue red-flag rules: false-negative for emergency presentations

| Field | Value |
|-------|-------|
| **Hazard ID** | H-024 |
| **Description** | The Triage Lens request-queue text-pattern rules (expanded to 77 rules in v3.44.x, including 17 explicit red emergency-presentation rules) fail to surface a red-chip emergency flag for a patient whose request text contains language warranting emergency escalation, leading reception or triage staff to classify the request at a lower urgency than warranted. **This hazard covers the request-queue text-pattern rules; the record/medications-panel prescribing prompts are covered by H-019.** |
| **Potential causes** | Patient or caller uses colloquial or indirect phrasing not matched by any red rule (e.g. "vomiting, high sugar, unwell" vs an explicit DKA/HHS pattern); the practice has customised or deleted the relevant bundled rule; a pattern was silently dropped due to a malformed regex (partially mitigated by v3.52.0 engine hardening); request text is submitted as an image or via a channel that bypasses the content script; the Triage Lens is not visible because the extension is not loaded or the staff member is not viewing the relevant Medicus page; the staff member dismisses a chip without acting on it. |
| **Affected users / components** | Non-clinical reception and triage staff using the Triage Lens to prioritise incoming requests; patients with potentially life-threatening presentations whose request text does not trigger an expected pattern. Components: `content-scripts/triage-lens/content.js`, `content-scripts/triage-lens/defaults.json` (77 rules, schema v2). |
| **Initial severity** | 4 (Major — under-triage of an emergency presentation can delay life-saving clinical response; harm requires a second failure of the practice's own triage protocol) |
| **Initial likelihood** | 3 (Possible — text-pattern matching cannot cover all clinical phrasings; primary care requests are not standardised) |
| **Initial risk** | 12 |
| **Controls / mitigations** | (a) The Triage Lens is explicitly an aide to trained triage staff, not a triage decision system; no chip triggers any automatic escalation. (b) Absence of a red chip does not mean the presentation is safe to manage routinely — triage staff must apply their own professional training to every request and not rely solely on the extension. (c) The v3.52.0 engine hardening ensures rules with invalid regex patterns or non-numeric thresholds are now logged to the browser console rather than silently dropped. (d) Non-destructive version-gated merge (v3.44.0) ensures newly shipped bundled rules reach existing users on update without overwriting customisations; removed builtins are tombstoned in `removedBuiltins`. (e) The practice's own clinical triage protocol remains the primary safety gate; the Triage Lens does not replace and must not substitute for that protocol. (f) Practice staff must be briefed at induction that the Triage Lens flags patterns it recognises, not patterns it does not recognise, and that a clear Triage Lens does not indicate a request is low-urgency. (g) Text submitted through non-content-script channels (images, telephone scripts, EMIS imports) is not evaluated and must be handled by direct clinical triage. (h) `test-triage-defaults.js` and `test-triage-rule-patterns.js` regression-guard rule structural integrity at CI. |
| **Residual severity** | 4 |
| **Residual likelihood** | 2 |
| **Residual risk** | 8 — Acceptable (ALARP); the practice's clinical triage protocol is the primary safety gate |
| **Acceptability** | Accepted. Text-pattern matching cannot cover all clinical phrasings of emergency presentations; this limitation is inherent to the approach. The practice's triage protocol is the primary control. Any report of a missed emergency chip that contributed to delayed escalation is treated as a significant safety event and triggers immediate CSO review and rule-set update. |

---

### H-025 — Patient Passport: patient misinterpretation of plain-English health summary

| Field | Value |
|-------|-------|
| **Hazard ID** | H-025 |
| **Description** | The Patient Passport (v3.50.0) generates a printable plain-English health summary for handing to the patient. The patient may misinterpret the summary as a complete or authoritative account of their health — either being falsely reassured by a summary that omits conditions not in the Sentinel rule set, or misunderstanding a prompt (e.g. treating "monitoring is due" as less urgent than intended), or sharing it with a third party who lacks the clinical context to interpret it correctly. |
| **Potential causes** | Plain-English status descriptions may reassure a patient who has clinical issues outside the Sentinel rule set; health literacy varies and patients may not understand the summary is a memory aid; the summary omits QOF indicators or clinical areas without a matching rule; a patient shares the passport with a carer, another practice, or an online health resource; the GP does not accompany the summary with an oral explanation; the passport is generated from an outdated Sentinel snapshot. |
| **Affected users / components** | Patients who receive a printed passport; GPs using the passport feature. Components: `side-panel/modules/sentinel/passport-core.js`, `passport.html`, `passport.js`. |
| **Initial severity** | 3 (Moderate — patient misinterpretation; clinical harm requires both misinterpretation and an unsafe patient action as a result) |
| **Initial likelihood** | 3 (Possible — health literacy variation is common; plain-English clinical summaries are frequently misinterpreted) |
| **Initial risk** | 9 |
| **Controls / mitigations** | (a) The passport header carries an explicit disclaimer stating the summary is a memory aid and that the patient should follow their GP's advice and contact the practice if concerned. (b) The due-list describes items the Sentinel rules engine found due at the time of generation; it does not claim to be a complete health assessment. (c) A "nothing currently due" state is displayed when no action-needed chips are present — it does not assert "all is well". (d) The GP generates and reviews the passport before handing it to the patient and should accompany it with an oral explanation appropriate to the patient's health literacy. (e) The passport timestamp is visible in the header. (f) All Sentinel snapshot limitations (items 1–9 in `CLINICAL-SAFETY-NOTICE.md`) apply to passport content. (g) The GP retains full clinical responsibility for how the summary is communicated and for any clinical decisions the patient makes as a result. |
| **Residual severity** | 3 |
| **Residual likelihood** | 2 |
| **Residual risk** | 6 — Acceptable (ALARP) |
| **Acceptability** | Accepted, with deploying-organisation duty to brief GPs that the passport must be accompanied by an oral explanation, must not be handed to a patient without the GP's review, and is not a substitute for clinical communication. |

---

## 6. Hazard summary

| ID | Hazard | Initial S×L | Initial risk | Residual S×L | Residual risk | Status |
|----|--------|-------------|-------------|--------------|---------------|--------|
| H-001 | Wrong-patient data (live panel) | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-002 | False-negative indicator | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-003 | False-positive indicator | 2×3 | 6 | 2×3 | 6 | Accepted (ALARP) |
| H-004 | Practice-authored rule incorrect | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-005 | Silent failure | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-006 | Update regression | 3×2 | 6 | 3×2 | 6 | Accepted (ALARP) |
| H-007 | Automation bias | 3×4 | 12 | 3×3 | 9 | Accepted (ALARP) — **primary residual risk** |
| H-008 | Referral mis-attribution | 3×2 | 6 | 3×2 | 6 | Accepted (ALARP) |
| H-009 | Patient data egress | 5×2 | 10 | 5×1 | 5 | Accepted (ALARP) |
| H-010 | Out-of-context display | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-011 | Browser/platform compatibility | 2×3 | 6 | 2×2 | 4 | Broadly acceptable |
| H-012 | Alert fatigue | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-013 | Visualiser PDF staleness | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-014 | Visualiser silent data omission | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-015 | eFI score inaccuracy | 3×3 | 9 | 3×3 | 9 | Accepted (ALARP) |
| H-016 | PINCER/drug-monitoring false-negative | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-017 | PINCER/drug-monitoring false-positive | 2×3 | 6 | 2×3 | 6 | Accepted (ALARP) |
| H-018 | PID in feedback email | 4×2 | 8 | 4×1 | 4 | Accepted (ALARP) |
| H-019 | Triage Lens record-panel prescribing prompts & signposting | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-020 | Vaccination eligibility inferred status | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |
| H-021 | Permanent chip suppression — false reassurance | 4×2 | 8 | 4×2 | 8 | Accepted (ALARP) — monitor |
| H-022 | Action Packs — PII in clipboard / templates | 4×2 | 8 | 4×1 | 4 | Accepted (ALARP) |
| H-023 | SMR Workstation — ACB / STOPP/START inaccuracy | 4×3 | 12 | 4×2 | 8 | Accepted provisionally — CSO verification required |
| H-024 | Triage Lens emergency red-flag false-negative | 4×3 | 12 | 4×2 | 8 | Accepted (ALARP) |
| H-025 | Patient Passport — patient misinterpretation | 3×3 | 9 | 3×2 | 6 | Accepted (ALARP) |

No hazard has a residual risk score exceeding 9. No hazard at residual score 10 or above is open. The release of v3.54.0 is approved by the Clinical Safety Officer on the basis of this hazard log, subject to the CSO-verification action noted against H-023 (SMR Workstation ACB/STOPP/START criteria).

## 7. Review and reporting

This log is reviewed:

- At every minor or major release of Medicus Suite
- On any reported safety incident, near-miss or anomalous output
- On any annual QOF specification refresh
- On any change to Medicus's APIs that affects data extraction
- On any change to UK regulatory guidance on software as a medical device
- On any change to NICE, BNF, or KDIGO guidance affecting implemented clinical thresholds or monitoring intervals

Reports of suspected hazardous behaviour must be sent to the CSO at **dave@graysbrook.co.uk** with sufficient detail to investigate (date, time, version, module, observed output, expected output). Patient-identifiable data must not be sent by email — use the practice's own information governance channels.

If an incident meeting the threshold of a patient safety incident is identified, it must be managed under the practice's own significant event analysis (SEA) process and reported to the CSO in parallel.

## 8. Version history

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-05 | 1.0 | DT | Initial hazard log — limited distribution to named GP users |
| 2026-05-20 | 2.0 | DT | Reformatted to DCB0129 style; expanded to 12 hazards; added severity/likelihood matrix; added explicit acceptability thresholds; aligned with `CLINICAL-SAFETY-NOTICE.md` v2.0 |
| 2026-05-22 | 3.0 | DT | Updated to v1.8.1; expanded scope to include Patient Record Visualiser; added H-013 (PDF staleness), H-014 (silent data omission), H-015 (eFI inaccuracy), H-016 (PINCER false-negative), H-017 (PINCER false-positive); updated H-007 to include Visualiser automation bias; updated test count to 213+; aligned with `CLINICAL-SAFETY-NOTICE.md` v3.0 |
| 2026-05-29 | 3.1 | DT | Synchronised to v3.4.1; added H-018 (patient-identifiable data in feedback email) following the new in-app feedback channel; updated test count to 230+; aligned with `CLINICAL-SAFETY-NOTICE.md` v3.1 |
| 2026-05-30 | 3.2 | DT | Synchronised to v3.16.0. Added H-019 (Triage Lens record-panel STOPP/START prescribing prompts, Pharmacy First signposting, and risk-tool signpost links, v3.13.0–v3.14.0). Updated H-002 to record the v3.12.1 applicability-filter "fail-open on unknown demographics" fix and sturdier patient-context extraction (prevents silent suppression of demographic-gated safety alerts such as the MHRA valproate alert and age-gated QOF indicators) plus the added Dementia register. Updated H-003 to record the deliberate fail-open trade-off and the new engine-backed live preview, and corrected the rule-type description (five rule types, not "three check shapes"). Updated H-004 to record the v3.15.0–v3.16.0 engine-backed live preview and validate-on-save controls. Updated H-007 to include the new live-panel prompt surfaces. Updated test count to 320+ automated checks. Aligned with `CLINICAL-SAFETY-NOTICE.md` v3.2 and `INTENDED-PURPOSE.md` v3.16.0. |
| 2026-06-03 | 3.3 | DT | Synchronised to v3.26.4. **New hazards:** H-020 (vaccination eligibility inferred status and DUE/GIVEN/DECLINED — includes record of v3.26.0 critical false-positive affecting all patients, corrected in v3.26.1); H-021 (permanent chip suppression via hide/snooze, v3.26.3 — permanent suppression could mask a future true-positive drug-monitoring alert). **Scope updated** to reflect new modules since v3.16.0: falling eGFR trend and hyperkalaemia alerts (v3.18.0, new `observation-alert` check kind); rising HbA1c trend (v3.19.0); journal-coded observations in side-panel evaluation (v3.21.0); full Custom Alert Builder engine parity (v3.22.0); BP Trend and ACR Trend side-panel tabs (v3.25.0); ADHD monitoring rules, smoking status indicators, carbamazepine, `observation-bundle` check kind (v3.26.x); flu/COVID vaccination eligibility alerts (v3.26.0); per-rule hide/snooze (v3.26.3). **Updated hazards:** H-001 (added v3.17.2 snapshot invalidation, v3.21.2 DOM-fallback UUID fix, v3.25.0 `_lastTrendData` guard); H-002 (added v3.20.0 age-filter fail-open, register/indicator logic corrections, v3.21.0 journal observations, v3.26.2 UUID regex, HRT false-negative fixes); H-003 (added v3.20.0 DM021/DM035/HF009 false-positive fixes, v3.26.4 hysterectomy detection, v3.26.1 vaccine false positive); H-004 (added v3.22.0 form-builder parity, medicationExclude now applied); H-005 (added v3.17.0 CI pipeline); H-006 (updated test count to 440+, 17 test files; added CI pipeline note); H-007 (added BP/ACR Trend, vaccination, eGFR/K⁺ alert surface notes, ACR referral-trigger banner wording); H-012 (added v3.26.3 hide/snooze as positive control). Aligned with `CLINICAL-SAFETY-NOTICE.md` v3.3. |
| 2026-06-07 | 3.4 | DT | Synchronised to v3.33.0. Added new supporting document `docs/SOUP.md` (Software of Unknown Provenance register for the vendored visualiser libraries) to the §1 document set. Updated H-005 with control (j): the per-module extraction breakdown now surfaced in the Sentinel side panel (`Extracted: N meds · N obs · N problems`, zero counts amber-flagged), which narrows the detection gap between the whole-record `degraded` banner and a partial scraper failure — informational only, so no new false-reassurance or alert-fatigue risk; regression-guarded by `test-extraction-health.js` and `test-sentinel-panel-state.js`. |
| 2026-06-11 | 3.5 | DT | Synchronised to v3.54.0. **Scope updated** to reflect modules added since v3.26.4: Pre-Monitoring Sweep, Reception (guided-capture pathways); Triage Lens entry updated with 77-rule expansion including 17 emergency red-flag rules (v3.44.x) and DKA/HHS red rule plus engine hardening (v3.52.0); Visualiser entry updated with SMR Workstation tab (v3.51.0); Monitoring entry updated with PPV23/shingles/RSV vaccine rules and declined-before-given fix (v3.46.0), extraction-drift detection (v3.47.0), Action Packs (v3.48.0), Pre-consultation Brief (v3.49.0), Patient Passport (v3.50.0), journal-augment-failure surfacing (v3.53.0). **Updated hazards:** H-002 — added (n) vaccine declined-before-given correction (v3.46.0) and (o) HRT IUS expiry date guard (#70); H-003 — added (k) HRT IUS expiry date guard; H-005 — added (k) extraction-drift detection (v3.47.0) and (l) journal-augment-failure surfacing (v3.53.0); H-007 — added (m) pre-consultation brief, (n) patient passport, (o) SMR workstation print automation-bias notes; H-009 — added (i) consume-on-read passport/handout fix and (j) prototype-pollution hardening on backup import (v3.53.0); H-016 — updated likelihood description; added (g) PINCER expansion P-A to P-F (v3.47.0); H-017 — added (e) age-gated PINCER fail-closed trade-off; H-019 — added (h) engine hardening (v3.52.0), and noted that H-019 covers record/medications panel only; H-020 — added (h) PPV23/shingles/RSV one-off vaccine rules (v3.46.0). **New hazards:** H-022 (Action Packs — PII in clipboard, residual 4×1=4); H-023 (SMR Workstation ACB/STOPP/START inaccuracy, residual 4×2=8, CSO verification action); H-024 (Triage Lens emergency red-flag false-negative, residual 4×2=8); H-025 (Patient Passport patient misinterpretation, residual 3×2=6). Test suite: 50 test files. Aligned with `CLINICAL-SAFETY-NOTICE.md` v3.4. |

## 9. Clinical Safety Officer sign-off

I confirm that I have reviewed each hazard recorded in this log, that the controls described are in place at v3.54.0, and that the residual risks are acceptable for limited distribution to named GP users who have read and accepted the Clinical Safety Notice and the full disclaimer. The CSO-verification action against H-023 (SMR Workstation ACB/STOPP/START criteria) must be completed and recorded before that tab is promoted beyond limited evaluation use.

**Dr Dave Triska, GMC 7534932**  
**Clinical Safety Officer, Medicus Suite**  
**Graysbrook Ltd**  
**Date:** 2026-06-11
