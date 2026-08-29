# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 28 August 2026  
**Extension version:** 3.243.9 → 3.243.9 (NOT bumped this run — held pending the user's decision to commit; substantial other uncommitted session work is batched alongside this)  
**Rule files touched:** rules/qof-rules.json  
**Tests:** ✅ passing (test-qof-indicator-filters.js, test-qof-year.js, test-chip-contract.js, test-custom-rules.js, test-custom-indicators.js, test-applicability-filters.js, test-rule-schema.js, full suite (node --test test-*.js, 398 files))

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

_None. No proposed change reduces alerting; all changes are additive or housekeeping._

## Action this run (Red)

| Rule | Domain | Change | Test lock-in |
|------|--------|--------|--------------|
| `qof-ast007` | qof | AST015: never-recorded review now shows overdue, not no_data | test-qof-indicator-filters.js: 6 new AST015 tests covering long-standing/no-review (overdue), recent/no-review (no_data, unaffected), stale/in-window review (unaffected), and opt-in scoping (a plain observation-recent rule without the flag is unaffected). |
| `qof-ckd002, qof-ckd003` | qof | CKD002/CKD003 are not real QOF 26/27 codes — relabelled to non-QOF safety-monitoring prompts | test-qof-indicator-filters.js: CKD002/CKD003 code-existence tests replaced with CKD-BP/CKD-RASI equivalents, plus explicit checks that the fake codes no longer appear anywhere in the file. |

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

_No changes this run._

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

### 🔴 Red — AST015: never-recorded review now shows overdue, not no_data

- **Rule:** `qof-ast007`  ⚙️ _needs rules-engine extension — ship disabled with placeholder_
- **Now:** A long-standing asthma-register patient with zero asthma reviews ever recorded showed neutral 'no_data' — indistinguishable from a recently-registered patient not yet due.
- **Proposed:** Added treatNeverRecordedAsOverdue:true. When no matching observation exists AND the register-coded date itself is outside the check's own window, status is now 'overdue' (red). A recently-registered patient (still inside the window) still correctly shows no_data. Mirrors the existing requiresRegisterCodedFrom mechanism built for AST014 the same session.
- **Why it matters:** A genuinely overdue asthma review rendering as neutral (rather than red/amber) is a missed-alert risk — a clinician scanning for red/amber chips would not notice it.
- **Regression lock-in:** test-qof-indicator-filters.js: 6 new AST015 tests covering long-standing/no-review (overdue), recent/no-review (no_data, unaffected), stale/in-window review (unaffected), and opt-in scoping (a plain observation-recent rule without the flag is unaffected).
- **Source:** Clinical logic fix (engine behaviour), not a guidance-sourced content change — <n/a — engine/rules-engine.js logic change, verified by direct testing not a fetched source> (2026-08-28)
- **Verified evidence:** Reported live by the practice: a genuinely overdue AST014 (then AST012) chip showed no_data instead of red for a patient with no objective test ever recorded and a diagnosis date outside the window. Same class of gap independently confirmed applies to AST015 (asthma review) on request.
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — corroborated, confidence high.

### 🔴 Red — CKD002/CKD003 are not real QOF 26/27 codes — relabelled to non-QOF safety-monitoring prompts _(previously flagged, still open)_

- **Rule:** `qof-ckd002, qof-ckd003`
- **Now:** indicatorCode CKD002 and CKD003, sourced "QOF 26/27 CKD002/CKD003 — corroborated via PRN02356 search; primary PDF 403 this run" (added 2026-07-11), never independently confirmed. Held since 2026-08-17 (qof-ckd002-003-disable) on scanner suspicion they are not in the official 26/27 tables.
- **Proposed:** Confirmed by reading the full current QOF 2026/27 guidance end to end: CKD has no clinical domain, register, or indicator chapter in the document, and neither CKD002 nor CKD003 appears anywhere in it. Relabelled indicatorCode CKD002->CKD-BP and CKD003->CKD-RASI, added category:"safety-monitoring", removed points/thresholds (nothing to claim against), and corrected source/notes to state plainly these are NICE NG203-based Sentinel prompts, not QOF indicators. The underlying checks (BP control, ACEi/ARB in proteinuric CKD) are UNCHANGED and keep firing — only the misleading QOF-indicator framing is removed. Rule ids (qof-ckd002, qof-ckd003) kept unchanged.
- **Why it matters:** A real-looking but non-existent QOF code risks a clinician or practice manager mistaking it for something that counts toward QOF payment/reporting — a compliance and reporting-accuracy risk, not just a labelling nicety. Alerting itself is unchanged (not a weakening), so this is corrective, not a monitoring reduction.
- **Regression lock-in:** test-qof-indicator-filters.js: CKD002/CKD003 code-existence tests replaced with CKD-BP/CKD-RASI equivalents, plus explicit checks that the fake codes no longer appear anywhere in the file.
- **Source:** NHS England QOF 2026/27 guidance, PRN02356 (absence confirmed by full-document search) — <https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf> (2026-07-13 (July update))
- **Verified evidence:** grep for "CKD002", "CKD003", "CKD register", and "Chronic kidney disease" against the full extracted text of the current 82-page guidance document returns zero matches. CKD appears only as one of four registers referenced by CHOL003/CHOL004 (statin/cholesterol indicators), never as its own domain.
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — fetched source page, confidence high.

### 🟠 Amber — AST012->AST014, AST007->AST015 ID rename _(previously flagged, still open)_

- **Rule:** `qof-ast012, qof-ast007`
- **Now:** indicatorCode AST012 (objective test within 3 months of new asthma diagnosis) and AST007 (asthma review, 4 components) — both stale from the pre-July-2026 QOF numbering.
- **Proposed:** Renamed indicatorCode to AST014 and AST015 respectively. Wording, points and thresholds unchanged (15pts/45-80% and 20pts/45-70%). Internal rule ids (qof-ast012, qof-ast007) kept unchanged so overrides/dismissals are undisturbed.
- **Why it matters:** A stale display code doesn't suppress the chip, but could mislead a clinician cross-checking against a QOF report or CQRS extract that already uses the new numbering.
- **Regression lock-in:** test-qof-indicator-filters.js and test-chip-contract.js — all AST012/AST007 references renamed to AST014/AST015 throughout.
- **Source:** NHS England QOF 2026/27 guidance, PRN02356 — <https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf> (2026-07-13 (July update))
- **Verified evidence:** Table of indicator changes (p.12): "AST014 Changed indicator ID due to asthma register change" / "AST015 Changed indicator ID due to asthma register change", both thresholds/points unchanged. Full indicator wording (p.42) matches the existing rule content exactly.
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — fetched source page, confidence high.

### 🟠 Amber — Add NDH register + NDH003 indicator (non-diabetic hyperglycaemia / prior GDM) _(previously flagged, still open)_

- **Rule:** `qof-reg-ndh, qof-ndh003`
- **Now:** No NDH register or indicator existed in qof-rules.json at all. Held since 2026-07-11/17 (qof-ndh) pending confirmation of the July PRN02356 amendment.
- **Proposed:** Added qof-reg-ndh (registerCode NDH, ageMin 18, problemMatch covering NDH/prediabetes/IGT/IFG/gestational diabetes, problemExclude for type 1/2 diabetes using "type 1 diabetes"/"type 2 diabetes" specifically — not bare "diabetes mellitus", which would wrongly exclude "Gestational diabetes mellitus" as a substring) and qof-ndh003 (observation-recent HbA1c/fasting glucose check, 20pts, 50-90%, withinDays 365).
- **Why it matters:** New QOF 26/27 clinical domain the practice had zero coverage for — 20pts, and NDH/GDM patients are a recognised high-risk-for-T2DM cohort per NICE PH38/NG3.
- **Regression lock-in:** test-qof-indicator-filters.js: 14 new tests — register matching (including the GDM/"diabetes mellitus" substring trap), indicator achieved/overdue/not-on-register end to end.
- **Source:** NHS England QOF 2026/27 guidance, PRN02356 — NDH003 indicator wording (p.57) and register definition (p.58, "Reporting and verification") — <https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf> (2026-07-13 (July update))
- **Verified evidence:** "NDH003. The percentage of patients with non-diabetic hyperglycaemia or a previous diagnosis of gestational diabetes who have had an HbA1c or fasting blood glucose performed in the preceding 12 months." 20pts, 50-90%. Register definition: "all patients aged 18 or over with a record of non-diabetic hyperglycaemia or pre-diabetes or GDM, which has not been superseded by a diagnosis of diabetes (excluding GDM)..."
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — fetched source page, confidence high.

### 🟠 Amber — Enable OB004/OB005 (points/thresholds now confirmed); complete OB005 brand list _(previously flagged, still open)_

- **Rule:** `qof-ob004, qof-ob005`
- **Now:** OB004/OB005 shipped enabled:false, indicatorName prefixed "[DRAFT 26/27 — PENDING CONFIRMATION]", because the primary guidance PDF 403'd when they were first drafted (2026-06-04) and only search-corroborated values were used. OB005's medicationMatch was missing ozempic, rybelsus, xenical, victoza.
- **Proposed:** Flipped enabled:true for both (values were already correct — 5pts/10-30% and 13pts/50-80%, confirmed byte-exact against the primary source). Removed the DRAFT prefix. Added the missing brands to OB005's medicationMatch (ozempic and rybelsus especially — semaglutide is very commonly prescribed by brand name only for weight management, so the bare generic term alone was missing real prescriptions).
- **Why it matters:** Two fully QOF-specified indicators (18pts combined) sat inert for months on a stale "unconfirmed" caveat that is now resolved; OB005's brand gap was a genuine silent-miss risk for GLP-1 weight-loss prescriptions issued under brand name only.
- **Regression lock-in:** test-qof-indicator-filters.js: 5 new tests — both enabled, DRAFT marker gone, brand completeness.
- **Source:** NHS England QOF 2026/27 guidance, PRN02356 — OB004/OB005 wording (pp.70-73) and Table of indicator changes (p.12) — <https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf> (2026-07-13 (July update))
- **Verified evidence:** OB004: "5 10-30%" (p.70). OB005: "13 50-80%" (p.70). Table of indicator changes (p.12): OB004 "New – 5 pts" / "10-30%"; OB005 "New – 13 pts" / "50-80%". Both exact matches to the pre-existing corroborated values.
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — fetched source page, confidence high.

### 🟠 Amber — Confirmed but NOT applied this run: BP002, CS005/CS006, SMOK004 engine support, VI001-004 _(previously flagged, still open)_

- **Rule:** `(new — not yet added)`  ⚙️ _needs rules-engine extension — ship disabled with placeholder_
- **Now:** Not encoded in qof-rules.json.
- **Proposed:** NOT applied — flagged for a deliberate follow-up decision, not silently added. BP002 (BP recorded in preceding 5 years, all patients 45+, 15pts/50-90%) and CS005/CS006 (cervical screening, 7pts/4pts) both need a register-less cohort (pure ageRange/sex gate) — an engine-support question already open (see the file's own SMOK004 note) that should be resolved once, deliberately, rather than assumed while adding these. CS005/CS006 also carry a data-path dependency (smear/HPV results may be filed as documents, not coded observations — a false "unscreened" chip is worse than none). SMOK004 (current smokers 15+ offered support, 12pts/40-90%) is already correctly drafted with confirmed values but genuinely blocked on the same register-less-cohort engine question. VI001-004 (childhood immunisations + shingles, 64pts combined) need age-at-event dose-counting logic that is not expressible in the current schema at all — a previous Keeper run (2026-08-22) already scoped this in detail (docs/keeper/gap-scan-2026-08-22/qof.md) and concluded most of VI001-003 is not implementable without a larger engine change.
- **Why it matters:** Genuine, sourced, additive opportunities (15+7+4+12+64 = 102 points of QOF coverage currently unaddressed) but each needs an explicit engineering/design decision (register-less cohort support, data-path verification) rather than a rule-file-only edit — deliberately not actioned in this pass to avoid shipping an untested engine assumption inside a QOF-numbering audit.
- **Regression lock-in:** none — not applied
- **Source:** NHS England QOF 2026/27 guidance, PRN02356 — <https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf> (2026-07-13 (July update))
- **Verified evidence:** BP002 (p.59, 15pts/50-90%), CS005/CS006 (p.74, 7pts/45-80% and 4pts/45-80%), SMOK004 (p.21, 12pts/40-90%), VI001-004 (pp.63-69, 18+18+18+10pts) all read directly from the current guidance.
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — fetched source page, confidence high.

### 🟢 Green — Full-file point/threshold cross-check against PRN02356 — no other drift found

- **Rule:** `(all enabled indicators)`
- **Now:** Every other currently-enabled QOF indicator's points and thresholds, checked against the primary source's complete indicator summary tables (sections 2.2 and 2.3).
- **Proposed:** No changes — AF006, AF008, CHD005, CD001, CD002, CHOL003, CHOL004, HF007, HF008, HF009, HYP010, HYP011, STIA007, DM006, DM014, DM020, DM021, DM034, DM035, DM036, DM037, AST014, AST015, COPD010, DEM004, MH002, MH003, MH006, MH007, MH011, MH012, SMOK002 (all 9 register clones), and SMOK004 (values only — see below) all match the current guidance exactly on points and thresholds, with frailty/diabetes exclusions already correctly implemented where the guidance requires them.
- **Why it matters:** Confirmation only — no drift found. Recorded so the next Keeper run knows this baseline was independently re-verified 2026-08-28, not just carried forward from 2026-07-11/25/08-22 assumptions.
- **Regression lock-in:** none — no rule content changed
- **Source:** NHS England QOF 2026/27 guidance, PRN02356 — full-document read plus sections 2.2/2.3 summary tables — <https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf> (2026-07-13 (July update))
- **Verified evidence:** Every value cross-checked directly against the extracted text of sections 2.1 (Table of indicator changes), 2.2 (Clinical domain summary) and 2.3 (Public health domain summary).
- **Provenance:** verified by orchestrator (this session) on 28 August 2026 — fetched source page, confidence high.

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

_No changes this run._

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

_No changes this run._

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

_No changes this run._

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

_No changes this run._

---

## Appendix: scan transparency

**Sources checked:** NHS England QOF 2026/27 guidance (PRN02356), fetched and read in full (82 pages) — https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf; PCIT QOF KPI index (secondary/tertiary corroboration only, not relied on as sole source) — https://support.primarycareit.co.uk/portal/en-gb/kb/articles/quality-outcomes-framework-qof-kpi-index.

**Rule-file baseline at start of run:**
- `qof-rules.json`: QOF 2026/27 (2026-07-25)

**Candidates excluded as low relevance:** 0.

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
