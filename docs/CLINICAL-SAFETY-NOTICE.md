# Medicus Suite — Clinical Safety Notice

**Document reference:** MS-CSO-CSN-001  
**Software product:** Medicus Suite (Chrome extension)  
**Product version:** 3.4.1  
**Document version:** 3.1  
**Date issued:** 2026-05-29  
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
8. **Practice-authored rules are the practice's responsibility.** Custom rules built via the form builder are passive threshold checks; the clinical validity of the rule itself is the responsibility of the practice author.
9. **Custom indicators are not QOF indicators** and do not contribute to any QOF income claim. They are visually labelled "Custom".

### Patient Record Visualiser

10. **The Visualiser operates on a PDF snapshot, not the live record.** Clinical information may have changed since the PDF was exported. The export date is displayed; users must ensure they are working from a current export.
11. **PDF parsing completeness is not guaranteed.** Entries rendered as images, in certain font types, or in non-standard Medicus export layouts may not be extracted. Entry counts are displayed so users can detect implausibly low figures.
12. **The eFI score is an approximation.** It is computed by matching problem-list text against a 36-deficit reference list using substring matching. It is not equivalent to the eFI as calculated by GP clinical systems from SNOMED-coded data. Both under- and over-estimation of frailty are possible. It is a screening aid only.
13. **PINCER flags are a partial implementation.** Only a defined subset of PINCER criteria are implemented (NSAID + CKD, NSAID + heart failure, NSAID + anticoagulant, beta-blocker + asthma, ACEi/ARB + CKD with overdue U&E at v3.4.1). Absence of a flag does not guarantee prescribing safety. Medicus's own prescribing safety systems remain the primary control.
14. **Drug detection is regex-based.** High-risk drug and PINCER drug detection works by text-matching PDF content. Brand names or abbreviated entries not in the implemented regex may be missed.
15. **High-risk drug monitoring intervals are defaults from NICE/BNF guidance.** They do not account for patient-specific monitoring plans, clinician-directed variation, or local protocol modifications.
16. **RCV delta flags are based on published reference change values.** They indicate statistically significant analytical change, not clinical significance in any individual patient's context.
17. **Clinical zone bands (eGFR, HbA1c, BP) are based on current published guidance.** They reflect KDIGO, NICE QOF, and NICE hypertension thresholds at the time of release; they do not account for patient-specific targets.

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
| **Release gating** | GitHub Actions release workflow runs the full automated test suite (230+ tests at v3.4.1) and fails closed on any test failure. A release is cut only by pushing a signed tag. |
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

I confirm that this notice fairly represents the clinical safety position of Medicus Suite v3.4.1; that the residual risks recorded in `docs/HAZARD-LOG.md` are acceptable for limited distribution to named GP users under the conditions set out in section 9; and that the controls described are in place at this release.

**Dr Dave Triska, GMC 7534932**  
**Clinical Safety Officer, Medicus Suite**  
**Graysbrook Ltd**  
**Date:** 2026-05-29

---

## 13. Version history

| Date | Version | Author | Change |
|------|---------|--------|--------|
| 2026-05 | 1.0 | DT | Initial Clinical Safety Notice — limited distribution |
| 2026-05-20 | 2.0 | DT | Reformatted to DCB0129/0160-style structure; added intended user roles; added explicit DOES / DOES NOT sections; added deploying-organisation responsibilities; added incident classification table; added sign-off forms; aligned with `HAZARD-LOG.md` v2.0 |
| 2026-05-22 | 3.0 | DT | Updated to v1.8.1; added Patient Record Visualiser to intended purpose, DOES, DOES NOT, and known limitations; added Visualiser-specific safety conditions; expanded known limitations to 17 items; updated test count; aligned with `HAZARD-LOG.md` v3.0 |
| 2026-05-29 | 3.1 | DT | Synchronised to v3.4.1; added user instruction on the feedback channel (no patient data in feedback) |

---

*Medicus Suite is developed and distributed by Dr Dave Triska, Graysbrook Ltd. It is shared with named GP colleagues on the basis that they and their practices have read and accepted this notice, the hazard log and the full disclaimer before use. It is not a commercial product, is not endorsed by Medicus Health Ltd, NHS England or any other body, and is not a medical device.*
