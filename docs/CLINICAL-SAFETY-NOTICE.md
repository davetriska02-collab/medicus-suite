# Medicus Suite — Clinical Safety Notice

**Document reference:** MS-CSO-CSN-001  
**Software product:** Medicus Suite (Chrome extension)  
**Product version:** 3.26.4  
**Document version:** 3.3  
**Date issued:** 2026-06-03  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Clinical Safety Officer:** Dr Dave Triska (GMC 7534932)  
**Status:** Live — must be read before installation or use  
**Applicable standards:** Drafted in the style of DCB0129 (Manufacturer responsibilities) with notes for deploying organisations consistent with DCB0160 expectations.

---

## 1. Purpose of this notice

This Clinical Safety Notice summarises the clinical safety information that every user, and every deploying GP practice, must read and accept before installing or using Medicus Suite. It is binding and constitutes a condition of use, alongside:

- `docs/HAZARD-LOG.md` — the full hazard register and residual risk assessment
- `docs/sentinel-DISCLAIMER.txt` — the full disclaimer and legal terms
- `docs/INTENDED-PURPOSE.md` — the frozen intended-purpose statement

In the event of any conflict between this notice and the disclaimer, the disclaimer prevails.

## 2. Intended purpose

Medicus Suite is a passive, read-only Google Chrome extension that operates alongside the Medicus electronic patient record (EPR). It reads data already present in the clinician's authenticated Medicus session and re-displays a reorganised, summarised view in a side panel and on configurable on-page overlays. It applies arithmetic threshold checks (for example: "the most recent HbA1c was recorded 114 days ago; the configured monitoring interval is 90 days; the indicator is therefore overdue") and surfaces the result as a colour-coded indicator.

From v1.6 onwards, the extension additionally includes the **Patient Record Visualiser** — a full-page dashboard that processes a locally-held Medicus EPR export PDF to produce summary analytics. These include continuity-of-care indices, investigation trend charts with clinical zone bands, high-risk drug monitoring compliance, a computed Electronic Frailty Index (eFI), PINCER-style prescribing safety prompts, and QOF register review status. All Visualiser processing occurs locally in the user's browser; no patient data is transmitted externally at any stage.

From v3.13.0–v3.14.0 the live Triage Lens side panel additionally surfaces, on the record/medications view, **deterministic prescribing-combination prompts** (STOPP/START-style: NSAID + anticoagulant/antiplatelet, "triple whammy" NSAID + ACEi/ARB + diuretic, benzodiazepine/Z-drug in age ≥80), a **risk-tool signpost chip** that links to the official QRISK3 / QCancer / eFI calculators (it computes no score), and **NHS Pharmacy First pathway signposting** snippets. These are supplementary prompts to *review and verify*, framed in the same way as the Visualiser's PINCER prompts — they are not clinical recommendations, diagnoses, or triage decisions. The practice-facing **Custom Alert Builder** also gained (v3.15.0–v3.16.0) an engine-backed live preview and save-time schema validation, so an author can see whether a rule they are building would fire against a test patient before saving it; from v3.22.0 the builder exposes full engine parity including `requiresProblem`/`requiresAnyProblem`, `excludeIfProblem`, sex, age range, `mustNotBePresent` drug-absence gate, and per-test SNOMED aliases.

Since v3.16.0 the Monitoring (Sentinel) module has been extended with: **falling eGFR trend** (≥15 mL/min/1.73m² fall across ≥3 readings within 12 months, NICE NG203) and **hyperkalaemia (K⁺) RAG-banded alerts** (amber 5.5–5.9 mmol/L, red ≥6.0 mmol/L, NICE/UK Kidney Association) using a new `observation-alert` check kind (v3.18.0); a **rising HbA1c trend** rule scoped to the DM register (v3.19.0); **ADHD medication monitoring** rules (stimulants paediatric/adult, atomoxetine, guanfacine — NICE NG87/BNF), **smoking status indicators** across 9 QOF registers, **carbamazepine monitoring**, and an `observation-bundle` check kind enabling DM037 (v3.26.x); and **flu and COVID-19 vaccination eligibility alerts** (v3.26.0), which infer eligibility from demographic data, QOF register membership, problem-list entries, medications, and BMI using JCVI/UKHSA 2025/26 criteria, and infer vaccination status (DUE / GIVEN / DECLINED) from coded data — see limitation 23. A **per-rule hide/snooze** control (v3.26.3) allows vaccine chips to be snoozed until the season end and drug-monitoring/QOF chips to be permanently suppressed on a user's workstation — see limitation 22. Two new graphical trend modules were added: **BP Trend** (dual-line systolic/diastolic chart with condition-specific target lines and AT TARGET / ABOVE TARGET status) and **ACR Trend** (KDIGO A1/A2/A3 band shading, eGFR co-display, monitoring frequency cell, and threshold-based action banners including an ACR ≥70 referral prompt per NICE NG203) (v3.25.0) — see limitations 24–25.

## 3. Intended users

Medicus Suite is intended for use by trained personnel working within a GP practice that uses the Medicus clinical system, namely:

- **General Practitioners (GPs)** — for clinical memory-aid use during patient consultations
- **Practice Nurses and Advanced Practitioners** — for clinical memory-aid use within their scope of practice
- **Practice Managers and Administrators** — for capacity, slot, submissions, activity, and referrals views (non-clinical workflows)
- **QOF leads / clinical coding leads** — for QOF status review (verified against Medicus)
- **Referral coordinators** — for the Referrals Tracker (verified against Medicus)

All users must:

1. Be authorised by the practice to access the patient data they are viewing
2. Hold an active and valid login to the Medicus EPR
3. Have read and accepted this notice, the hazard log, and the full disclaimer
4. Operate within their own professional scope and the policies of their practice

The extension must **not** be used by patients, by personnel not authorised to access the underlying records, or on any system other than Google Chrome stable channel on a workstation logged in as the named user.

## 4. Regulatory status

**Medicus Suite is not a medical device.**

The author asserts, on a good-faith reading of MHRA guidance on Software as a Medical Device current at the date of this notice, that Medicus Suite falls outside the scope of the UK Medical Devices Regulations 2002 (as amended). This assertion rests on the following facts:

- The software does not produce any output that constitutes a diagnosis, treatment recommendation, prognosis, triage decision, or clinical interpretation of patient data.
- The software re-displays values already visible to the clinician in the source record. It does not transform those values into new clinical information.
- The software does not perform any calculation whose output is intended to drive a clinical decision. Threshold comparisons are arithmetic, not clinical interpretation.
- The software does not automate any step of clinical care.
- The clinical rules executed by the software are authored either by the manufacturer (a curated subset of QOF and drug-monitoring rules, configurable by the practice) or by the practice itself — the software is a rules runner and display layer, not a clinical knowledge base.
- The Patient Record Visualiser's eFI score is an arithmetic count of matched problem-list terms against a published 36-deficit reference list — it is not a validated clinical assessment instrument as implemented in GP clinical systems.
- The Patient Record Visualiser's PINCER flags are a subset of the published PINCER prescribing safety criteria, surfaced as prompts to verify against the source record — they are supplementary to Medicus's own prescribing safety systems and do not replace them.
- The live Triage Lens prescribing-combination prompts (STOPP/START-style) are deterministic, name-based detections of co-prescribed drug classes, surfaced as prompts to review against the source record. They recommend no drug, dose, or change and are supplementary to Medicus's own prescribing-safety systems.
- The risk-tool chip provides hyperlinks to externally-hosted, independently-validated calculators (QRISK3, QCancer, eFI) together with a list of the inputs each requires; the software computes no risk score itself.
- The Pharmacy First signposting snippets are pre-written reference text and hyperlinks surfaced for the clinician's consideration. The clinician makes any signposting decision; the snippets state the pathway's eligibility gateway and red-flag safety-netting. They do not constitute a triage decision made by the software.
- The hyperkalaemia and falling eGFR trend alerts (v3.18.0) are arithmetic threshold and trend comparisons against NICE/KDIGO criteria — they surface a coded observation value against a published threshold; they do not diagnose acute kidney injury or hyperkalaemia, and they do not replace the clinician's direct review of the result in the Medicus record.
- The ACR Trend action banners, including the ACR ≥70 referral-trigger banner (v3.25.0), are threshold-based prompts to *consider* a referral per NICE NG203; the software makes no referral and does not assess whether a referral has already been made or is appropriate for the individual patient.
- The vaccination eligibility chips (v3.26.0) infer eligibility and status from coded data as a prompt to check — they do not interact with the National Immunisation Management Service (NIMS) or any external vaccination record.

Consistent with this position:

- **No CE mark, UKCA mark, MDR conformity, FDA clearance or other regulatory clearance is claimed.**
- **No endorsement is claimed from Medicus Health Ltd, NHS England, NHSX, the MHRA, the GMC, any Integrated Care Board (ICB), any Primary Care Network (PCN), or any other body.**
- **The software is not Clinical Decision Support (CDS) as defined by MHRA, NICE, FDA or IMDRF guidance.** It must not be represented as CDS to any third party.

If at any time UK regulatory guidance changes such that this assertion is no longer defensible, distribution of Medicus Suite will be suspended pending regulatory reassessment.

## 5. What the software DOES

In summary, Medicus Suite:

1. **Reads** data from the Medicus EPR via:
   - DOM scraping of the rendered Medicus web pages
   - Interception of page-level API responses using the browser's `PerformanceObserver` API (read-only observation)
   - Authenticated fetch calls to `*.api.england.medicus.health` endpoints, using the user's existing browser session cookies
2. **Reorganises and summarises** that data in a side panel and on configurable HUD overlays
3. **Applies arithmetic threshold checks** to monitoring intervals and QOF indicator criteria
4. **Displays** the result as colour-coded indicators (chips), aggregate counts, and tabular summaries
5. **Analyses a locally-held EPR export PDF** (Patient Record Visualiser only) to produce a multi-tab clinical dashboard including: continuity indices, investigation trends, drug monitoring compliance, eFI score, PINCER-style prescribing prompts, and QOF register review status — all computed locally in the browser, with no external transmission
6. **Checks the GitHub releases API** once a day for new versions of itself (no patient data is transmitted in this check)

That is the entirety of the software's behaviour.

## 6. What the software DOES NOT do

Medicus Suite does **not**:

1. **Transmit patient data to any external server.** All processing is local in the user's browser. No telemetry, no analytics, no remote logging, no cloud storage.
2. **Modify clinical records.** The software has no write path to Medicus or to any other system. It cannot create, update, or delete any clinical or administrative record.
3. **Write back to Medicus.** It does not submit any data to Medicus. It does not modify QOF claims data. It does not assign tasks. It does not respond to referrals.
4. **Make prescribing recommendations.** It does not recommend any drug, dose, route, or duration.
5. **Make clinical decisions.** It does not diagnose, triage, prioritise, rank, or interpret patient data.
6. **Replace reading the source record.** Every value it displays must be verified against the Medicus record before any clinical action.
7. **Provide clinical decision support.** It is not CDS. It must not be represented as CDS.
8. **Store patient data persistently.** `chrome.storage.local` is used only for configuration, discovered API URLs, aggregate counts, and the user's own rule definitions. The in-memory cache is volatile and keyed by patient UUID; it is discarded when the tab closes or the patient changes. The Visualiser's PDF analysis is entirely in-memory and is discarded when the tab closes.
9. **Store credentials.** It uses the user's existing Medicus session cookies; it does not request, store, or transmit a separate username or password.
10. **Operate outside Medicus.** It produces no useful output on any other EPR or non-Medicus web page.
11. **Act as a regulated medical device** of any class.
12. **Guarantee completeness of PDF parsing.** The Visualiser processes text-based PDF exports; entries rendered as images, tables, or using non-standard fonts may not be extracted.
13. **Reflect the live record in the Visualiser.** The Patient Record Visualiser operates on a point-in-time PDF export; it does not reflect changes made to the patient record after the export was generated.

## 7. Known limitations

The user and the deploying practice must understand and accept the following known limitations. A fuller account is in `docs/sentinel-DISCLAIMER.txt` and in `docs/HAZARD-LOG.md`.

### Side panel and Monitoring module

1. **QOF register membership is approximated.** Register matching is by substring of problem labels, not by SNOMED refset. Both false positives and false negatives occur.
2. **QOF coverage is a curated subset.** Not all QOF 2025/26 indicators are implemented. A blank panel does not mean all indicators are achieved — it may mean the indicator is not in the implemented set.
3. **Encounter-coded entries may be missed.** Certain coded entries (annual review codes, smoking status, mental health questionnaires) live on endpoints that the extension does not consume; indicators relying on them may report "no data".
4. **Annual QOF specification changes are not auto-detected.** The practice must review rule files at each QOF contract refresh.
5. **User-edited thresholds override the defaults.** If the practice edits a threshold, the practice is responsible for confirming it against current published guidance.
6. **Medicus API changes are not auto-detected.** If Medicus changes the shape of its API, the extension may show incomplete or no data until updated.
7. **The extension does not validate the correctness of the Medicus record.** If the source data is wrong, the displayed evaluation will be wrong.
8. **Practice-authored rules are the practice's responsibility.** Custom rules built via the form builder span five rule types (drug-monitoring, drug-combo, qof-indicator, event-count, composite). From v3.15.0–v3.16.0 the builder offers an engine-backed live preview (it evaluates the rule against an editable test patient using the real engine) and validates each rule against the engine schema on save — but the *clinical* validity of the rule itself remains the responsibility of the practice author.
9. **Custom indicators are not QOF indicators** and do not contribute to any QOF income claim. They are visually labelled "Custom".

### Patient Record Visualiser

10. **The Visualiser operates on a PDF snapshot, not the live record.** Clinical information may have changed since the PDF was exported. The export date is displayed; users must ensure they are working from a current export.
11. **PDF parsing completeness is not guaranteed.** Entries rendered as images, in certain font types, or in non-standard Medicus export layouts may not be extracted. Entry counts are displayed so users can detect implausibly low figures.
12. **The eFI score is an approximation.** It is computed by matching problem-list text against a 36-deficit reference list using substring matching. It is not equivalent to the eFI as calculated by GP clinical systems from SNOMED-coded data. Both under- and over-estimation of frailty are possible. It is a screening aid only.
13. **PINCER flags are a partial implementation.** Only a defined subset of PINCER criteria are implemented (NSAID + CKD, NSAID + heart failure, NSAID + anticoagulant, beta-blocker + asthma, ACEi/ARB + CKD with overdue U&E, as at v3.16.0). Absence of a flag does not guarantee prescribing safety. Medicus's own prescribing safety systems remain the primary control.
14. **Drug detection is regex-based.** High-risk drug and PINCER drug detection works by text-matching PDF content. Brand names or abbreviated entries not in the implemented regex may be missed.
15. **High-risk drug monitoring intervals are defaults from NICE/BNF guidance.** They do not account for patient-specific monitoring plans, clinician-directed variation, or local protocol modifications.
16. **RCV delta flags are based on published reference change values.** They indicate statistically significant analytical change, not clinical significance in any individual patient's context.
17. **Clinical zone bands (eGFR, HbA1c, BP) are based on current published guidance.** They reflect KDIGO, NICE QOF, and NICE hypertension thresholds at the time of release; they do not account for patient-specific targets.

### Live Triage Lens prescribing prompts and signposting (v3.13.0–v3.14.0)

18. **STOPP/START prompts are a small, name-based subset.** The record-panel prescribing-combination prompts cover only a few well-established, low-false-positive combinations (NSAID + anticoagulant/antiplatelet; NSAID + ACEi/ARB + diuretic; benzodiazepine/Z-drug in age ≥80). They are not the full STOPP/START v2 criteria, detect drugs by name (brand, abbreviation, or coding variants may be missed), cannot account for the individual patient's indication, gastroprotection, monitoring, or specialist plan, and are supplementary to Medicus's own prescribing-safety systems. Absence of a prompt does not indicate prescribing safety.
19. **Pharmacy First signposting is conditional on eligibility the clinician must confirm.** The snippets surface "consider Pharmacy First if eligible" for the relevant pathways; each pathway is age/sex/clinically gated, the patient's age/sex may be unknown to the software, and the request text may be ambiguous. The clinician is responsible for confirming pathway eligibility and clinical suitability before signposting, and for acting on the red-flag safety-netting stated in the snippet.
20. **The risk-tool chip computes nothing.** It links to the official QRISK3 / QCancer / eFI calculators and lists the inputs each requires. The software calculates no risk score; the clinician enters the inputs into the external calculator and interprets the result.

### Applicability filters (all rule types)

21. **Demographic-gated rules fire when age or sex is unknown (fail-open, v3.12.1).** A rule restricted to a sex or age band will still fire when the patient's age/sex cannot be read from the page. This is deliberate, so that safety-critical alerts (for example the MHRA valproate alert) are not silently suppressed when the banner cannot be scraped; the consequence is that such a rule may occasionally appear for a patient who is in fact outside its intended scope. A rule is suppressed only when the patient is positively known to be out of scope. As always, verify against the source record.

### Per-rule hide/snooze (v3.26.3)

22. **Permanently hidden chips do not resurface if the clinical picture changes.** A drug-monitoring or QOF indicator chip that has been permanently suppressed on a user's workstation (via the × dismiss button) will not re-appear when monitoring later becomes overdue or the indicator becomes unachieved. The "no chip ≠ all clear" principle applies with equal force to suppressed chips: their absence is not evidence that the monitoring has been done. Users must be briefed that hiding a chip does not mean the monitoring has been completed. The rules owner should review the suppression list periodically via the "Hidden / Snoozed Alerts" section in sentinel settings. Vaccine chip snoozes auto-expire at the season end and are not covered by this limitation.

### Vaccination eligibility alerts (v3.26.0)

23. **Vaccination eligibility and status are inferred from coded data.** Flu and COVID-19 eligibility chips are derived from QOF register membership, problem-list entries, medications, BMI, and age using JCVI/UKHSA 2025/26 criteria. DUE / GIVEN / DECLINED status is inferred from coded problems, observations, and journal entries within the current season window. Vaccinations administered outside the practice (pharmacy, community hub, hospital, other practice) may not be recorded locally, so a DUE chip may appear for a patient who is already vaccinated. Every vaccine chip carries a "DOUBLE-CHECK ELIGIBILITY" note and matched evidence; vaccination status must be verified against the Medicus record and, where relevant, national vaccination records (NIMS/PCSE) before any clinical action.

### Pre-clinic Monitoring Sweep module

26. **The Sweep module is a supplementary morning-huddle aid, not an audited monitoring record.** The Sweep module runs the same Sentinel rules engine against the logged-in user's booked patients for today, using the same `/scheduling/data/homepage/my-appointments` appointment feed and the same per-patient API reads (banner, medication regimen, problem listing, investigation dashboard) as the live Sentinel module. It is subject to all the limitations of those data sources (limitations 1–9 above). The following additional constraints apply:
    - **Point-in-time snapshot only.** Results reflect the record at the moment the sweep ran. Changes made to the record after the sweep (new bloods added, medications stopped, problems coded) are not reflected until the sweep is re-run.
    - **A patient that fails to load is never silently skipped.** If any patient's record cannot be fetched, a visible "could not read record" error is shown for that patient alongside the reason. An absent row is not a clean result.
    - **No alert ≠ monitoring complete.** Absence of an action-needed chip for a patient means no matched rule fired against the data returned at the time of the sweep; it is not confirmation that all monitoring is up to date. Limitations 1–9 (incomplete rule set, encounter-coded entries missed, API drift, etc.) apply equally here.
    - **Per-workstation hidden alerts are intentionally included.** The Sweep does not apply `sentinel.hiddenRules` suppressions. A chip permanently suppressed on a workstation (for example because the clinician has hidden it in the Sentinel panel) still contributes to the sweep worklist — hiding a rule in the live panel must not silently omit a patient from the morning recall list. When a patient's sweep result includes chips that are hidden in the Sentinel panel, this is flagged to the clinician.
    - **Results are not stored.** Sweep results exist only in memory for the duration of the browser session and are discarded when the tab closes or the module is re-loaded. No patient data is written to `chrome.storage.local`.
    - **Manual trigger only.** The sweep runs only when the clinician presses "Run sweep". There is no automatic or scheduled run.

### Reception module (guided capture, recent appointments, opportunity summary)

27. **The Reception module's guided capture is a structured history-taking aid for non-clinical staff — it is NOT a triage tool and makes no clinical decisions.** The capture pathways (`rules/reception-pathways.json`) present a fixed, identical-every-time question set per presenting problem, with red-flag questions asked first. The following constraints apply:
    - **Red-flag prompts are escalation triggers, not exclusions.** A "yes" to any red-flag question displays an immediate escalation instruction (999-level or duty-clinician-level) and stamps the generated text with the flag and the instruction. A full set of "no" answers does NOT mean the contact is safe to handle routinely — the red-flag lists are deliberately short, lay-phrased subsets of NICE CKS / NICE guideline red flags and cannot be exhaustive. The receiving clinician reviews every capture.
    - **The output is unverified caller-reported information** recorded by non-clinical staff. It must be treated as a structured complaint description, not as clinical findings.
    - **Wrong-patient paste risk.** The generated text is copied to the clipboard and manually pasted into Medicus. When a patient record is open, the patient's name/DOB is embedded in the text header specifically so a wrong-record paste is detectable on reading — staff must still verify the destination record before pasting.
    - **Pathway content requires CSO sign-off and periodic review.** The bundled pathway set is marked DRAFT until reviewed by the practice's clinical safety officer, and is included in The Keeper's periodic rule-currency review alongside the other rule files. Structural integrity is CI-guarded (`test-reception-pathways.js`), but clinical correctness of the question wording is a human review responsibility.
    - **"Recent appointments" shows booked practice appointments only**, found by scanning the appointment book backwards (up to 6 weeks) and matching strictly by patient UUID — never by name. Telephone encounters, ad-hoc contacts, and external care are not shown; days that fail to load are explicitly counted as unread. The list is an aid to the "who did you last see" conversation, not a complete contact history.
    - **The monitoring/QOF opportunity summary** on the Reception tab is the same Sentinel snapshot shown to clinicians, compressed to counts. It exists so reception can offer to book overdue checks; it is not a recall system, and "no alerts" does not mean nothing is due (limitation 22 and the "no chip ≠ all clear" rule apply).
    - **Nothing is stored.** Captured answers, generated text, and taker initials are in-memory only and are discarded when the panel closes. No new `chrome.storage.local` keys are written.

### BP Trend and ACR Trend modules (v3.25.0)

24. **Trend data is available only after the Medicus investigation dashboard has loaded.** The BP Trend and ACR Trend modules source data from the Medicus investigation dashboard endpoint; if the investigation dashboard has not yet loaded in the current session, the tab will show no data. Trends require multiple historical readings — a patient with only one recorded value will show no trend. Trend data is cleared on every patient navigation (cross-patient guard) and therefore requires re-loading when switching between patients.

25. **ACR Trend action banners are threshold comparisons, not individualised clinical assessments.** The ACR ≥70 referral-trigger banner ("consider nephrology referral — NICE NG203"), the ACR doubling banner, and the KDIGO category-crossing banner are arithmetic comparisons against published NICE NG203 and KDIGO criteria. They do not account for individual patient context — existing specialist involvement, dialysis, recent biopsy, patient preference, or whether a referral has already been made. They are prompts to *consider and verify*, not referral recommendations. Verify against the full Medicus record and any active correspondence before acting.

## 8. The single most important safety rule

> **Do not take a clinical action — ordering a test, making a referral, adjusting a medication, coding a QOF indicator, modifying a treatment plan — on the basis of what the extension shows without first checking the underlying Medicus record.**

This is a binding condition of use, and it is the primary patient safety control for this software. It is not optional. It applies to every user, in every session, on every patient, and to all outputs of the Patient Record Visualiser as well as the live side panel.

The source of clinical truth is the live Medicus record. The extension is a memory aid and analytical tool that sits next to it.

## 9. Responsibilities of the deploying GP practice

In the spirit of DCB0160, the deploying organisation (the practice) accepts the following clinical safety responsibilities. These should be discharged by the practice's nominated Clinical Safety Officer or, if none, by the senior partner.

### 9.1 Before deployment

1. **Read and accept** this notice, the hazard log, and the full disclaimer.
2. **Confirm regulatory and contractual fit.** Confirm that use of a third-party browser extension that reads from Medicus is consistent with the practice's contract with Medicus Health Ltd and with the practice's information governance policy. The author asserts but does not warrant such fit.
3. **Brief users.** Every user must be briefed on:
   - the intended purpose of the extension
   - the "single most important safety rule" in section 8 above
   - the known limitations in section 7
   - the additional limitations of the Patient Record Visualiser (sections 7.10–7.17)
   - the practice's incident-reporting route (see 9.3)
4. **Nominate a rules owner.** A named clinician should own the practice's Monitoring rule set, including any custom rules, and review it at every QOF contract refresh and after any significant change to clinical guidance affecting bundled rules.
5. **Review browser environment.** Confirm Google Chrome stable channel is the practice's standard browser, that the Chrome side panel API is not blocked by group policy, and that workstations are managed under the practice's normal IT security policy.

### 9.2 During use

1. **Curate the rule set.** Avoid enabling rules that are not clinically reviewed for the practice's case mix; over-broad rule sets contribute to alert fatigue (H-012).
2. **Verify source records.** Reinforce in induction and ongoing training that every value must be verified against Medicus before any clinical action.
3. **Monitor for anomalies.** Encourage users to report unexpected chips, missing chips, or wrong-patient display promptly.
4. **Keep the extension up to date.** When a new version banner appears, the rules owner should review the changelog before updating, then update at a quiet time.
5. **Ensure fresh PDFs for the Visualiser.** When using the Patient Record Visualiser, confirm that the PDF being analysed is a current export. Reuse of old PDFs is a documented clinical hazard (H-013).

### 9.3 If an incident occurs

1. **Stop using the affected module** and verify the source record.
2. **Manage any patient-safety implications** through the practice's significant event analysis (SEA) process.
3. **Report the technical anomaly to the manufacturer** at **dave@graysbrook.co.uk** with the date, time, extension version, module, observed output and expected output. **Do not transmit patient-identifiable data by email.**
4. **Cooperate with any subsequent investigation** including any need to temporarily disable a module pending fix.

## 10. Incident reporting and escalation

The author maintains a single point of contact for clinical safety matters:

> **Clinical Safety Officer**  
> Dr Dave Triska  
> **Email:** dave@graysbrook.co.uk  
> **GMC:** 7534932

The following classes of report should be escalated to the CSO:

| Class | Examples | Response time target |
|-------|----------|----------------------|
| **Critical** | Suspected wrong-patient display; suspected data egress; suspected malicious code | Same working day |
| **High** | Reproducible false-positive or false-negative clinical indicator that may have led to a clinical action; missed PINCER flag that was clinically significant | Within 3 working days |
| **Medium** | Reproducible display, layout or rule-engine bug not directly affecting clinical safety | Within 10 working days |
| **Low** | Cosmetic, feature request, documentation correction | Best effort |

Where a report meets the definition of a patient safety incident in NHS England guidance, the practice must also manage it under its own SEA process and, where applicable, report it via Learn from Patient Safety Events (LFPSE) and to the practice's ICB.

The CSO will:

- Acknowledge each report
- Investigate and reproduce where possible
- Issue a hot-fix release where appropriate
- Update the hazard log if a new hazard is identified or a control proves inadequate
- Notify all known users of any safety-relevant change

## 11. Version and change control

| Item | Mechanism |
|------|-----------|
| **Versioning** | Semantic versioning (`MAJOR.MINOR.PATCH`) recorded in `manifest.json` and surfaced in the Options page, popup and side panel. |
| **Release gating** | GitHub Actions release workflow runs the full automated test suite (440+ automated checks at v3.26.4 across 17 test files, including applicability-filter, STOPP/START prescribing-flag, QOF indicator filters, extraction-health, sentinel panel-state, and custom-rule-builder round-trip tests) and fails closed on any test failure. A dedicated `test.yml` CI workflow also runs the full suite on every push and pull request (v3.17.0). A release is cut only by pushing a signed tag. |
| **Changelog** | Every release is documented in `CHANGELOG.md` including any safety-relevant change. |
| **Auto-update notification** | The extension checks `api.github.com` once a day and surfaces a banner in the Options page when a newer version exists. The user controls when to install the update. |
| **Hazard log review** | Reviewed at every minor or major release; recorded in `docs/HAZARD-LOG.md` section 8. |
| **CSO sign-off** | Recorded in `docs/HAZARD-LOG.md` section 9 at every release. |

The practice should keep a local record of:

- The version of the extension installed on each workstation
- The date of installation or last update
- Any local customisations to the rule set
- Any safety incidents reported to the CSO

## 12. Acknowledgement and sign-off

### User acknowledgement

By installing or using Medicus Suite the user confirms that:

1. They have read this Clinical Safety Notice in full.
2. They have read `docs/HAZARD-LOG.md` and `docs/sentinel-DISCLAIMER.txt` in full and accept both as binding conditions of use.
3. They understand and accept the known limitations in section 7.
4. They will verify every value the extension displays against the Medicus record before taking any clinical action that depends on the value.
5. They retain full and undivided clinical responsibility for every decision they make about every patient.
6. They will cease use and report promptly under section 10 in the event of any suspected anomaly.
7. **Never include patient-identifiable information in feedback.** The in-app feedback / bug-report channel composes an ordinary email to the developer; it must never contain patient names, NHS numbers, dates of birth, or any clinical detail that could identify a patient. The extension itself transmits no record data — only the suite version, browser, and timestamp are attached automatically.

If the user does not accept these terms, **they must not install the extension**.

### Deploying organisation acknowledgement

The deploying practice's nominated officer should record acceptance of section 9 responsibilities. A suggested form is:

> I, _________________________ (name and role), confirm on behalf of _________________________ (practice) that:
>
> - I have read this Clinical Safety Notice, the Hazard Log, and the full disclaimer.
> - I accept the deploying-organisation responsibilities at section 9.
> - The practice has nominated a rules owner: _________________________.
> - The practice's incident reporting route is: _________________________.
>
> Signed: _________________________ Date: _________________________

This form should be retained in the practice's clinical safety records.

### Clinical Safety Officer sign-off

I confirm that this notice fairly represents the clinical safety position of Medicus Suite v3.26.4; that the residual risks recorded in `docs/HAZARD-LOG.md` are acceptable for limited distribution to named GP users under the conditions set out in section 9; and that the controls described are in place at this release.

**Dr Dave Triska, GMC 7534932**  
**Clinical Safety Officer, Medicus Suite**  
**Graysbrook Ltd**  
**Date:** 2026-06-03

---

## 13. Version history

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-05 | 1.0 | DT | Initial Clinical Safety Notice — limited distribution |
| 2026-05-20 | 2.0 | DT | Reformatted to DCB0129/0160-style structure; added intended user roles; added explicit DOES / DOES NOT sections; added deploying-organisation responsibilities; added incident classification table; added sign-off forms; aligned with `HAZARD-LOG.md` v2.0 |
| 2026-05-22 | 3.0 | DT | Updated to v1.8.1; added Patient Record Visualiser to intended purpose, DOES, DOES NOT, and known limitations; added Visualiser-specific safety conditions; expanded known limitations to 17 items; updated test count; aligned with `HAZARD-LOG.md` v3.0 |
| 2026-05-29 | 3.1 | DT | Synchronised to v3.4.1; added user instruction on the feedback channel (no patient data in feedback) |
| 2026-05-30 | 3.2 | DT | Synchronised to v3.16.0. Added the live Triage Lens prescribing prompts and signposting to intended purpose, regulatory status, and known limitations (items 18–20: STOPP/START subset, Pharmacy First eligibility, risk-tool signpost-only). Added limitation 21 (applicability filters fail open on unknown demographics, v3.12.1). Updated the custom-rules limitation for the five rule types and the v3.15.0–v3.16.0 engine-backed live preview / validate-on-save. Updated test count. Aligned with `HAZARD-LOG.md` v3.2 (incl. new H-019) and `INTENDED-PURPOSE.md` v3.16.0. |
| 2026-06-03 | 3.3 | DT | Synchronised to v3.26.4. Updated intended purpose (section 2) to describe new features since v3.16.0: falling eGFR trend and hyperkalaemia alerts (v3.18.0); rising HbA1c trend (v3.19.0); ADHD monitoring, smoking status, carbamazepine, observation-bundle (v3.26.x); vaccination eligibility alerts (v3.26.0); per-rule hide/snooze (v3.26.3); BP Trend and ACR Trend modules (v3.25.0); Custom Alert Builder full engine parity (v3.22.0). Updated regulatory status (section 4) to confirm new features remain outside medical-device scope. Added known limitations 22 (hidden chips — false reassurance), 23 (vaccination eligibility — inferred status), 24 (BP/ACR Trend data availability), 25 (ACR Trend referral-trigger banner — threshold only). Updated test count to 440+ (17 files, continuous CI). Updated sign-off. Aligned with `HAZARD-LOG.md` v3.3 (new H-020, H-021; updated H-001 to H-007, H-012). |

---

*Medicus Suite is developed and distributed by Dr Dave Triska, Graysbrook Ltd. It is shared with named GP colleagues on the basis that they and their practices have read and accepted this notice, the hazard log and the full disclaimer before use. It is not a commercial product, is not endorsed by Medicus Health Ltd, NHS England or any other body, and is not a medical device.*
