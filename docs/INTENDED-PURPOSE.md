# Medicus Suite — Intended Purpose Statement

**Frozen statement in force:** v3.16.0 (signed; May 2026)  
**Frozen statement proposed:** v3.199.1 — **DRAFT, pending CSO signature** (see "Frozen intended-purpose statement — v3.199.1")  
**Date:** May 2026; draft re-freeze prepared 2026-07-28  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Status:** Limited distribution — see "Intended user"

> **Re-freeze convention.** The frozen statement is never edited in place. A change of substance produces a **new numbered version**, pinned to the product version at which it was drafted, which takes effect only when the Clinical Safety Officer signs it. Superseded versions are retained below, never deleted, so it is always answerable what the product claimed it could do on any given date. **Until the v3.199.1 draft is signed, v3.16.0 remains the statement in force — while being, in the respects marked below, factually out of date.**

---

## Software description

Medicus Suite is a browser extension for Google Chrome that runs alongside the Medicus electronic patient record system (Medicus Health Ltd / Doctolib). It adds a side panel and optional display overlays to the Medicus web interface. It does not install any software on clinical systems and does not transmit patient data outside the user's browser. It **does** have a small, enumerated set of user-initiated write paths into Medicus — appointment booking, general-task creation, inbound-document filing, normal-lab-result filing, routine-prescription re-assignment, and problem-list / duplicate-entry tidying — each triggered by a user on the record in front of them, explicitly confirmed at the point of commit, and executed under that user's own Medicus session so Medicus's validation, access control and audit trail apply. They are listed in full, with their controls, at `docs/CLINICAL-SAFETY-NOTICE.md` §6.1. (Earlier issues of this document said the software "does not write to any patient record"; that statement was false from the point the booking and task widgets shipped and is corrected here.) The suite also provides an in-app feedback channel that composes an ordinary email via the user's own mail client; it transmits no patient data and auto-attaches only the suite version, browser, and timestamp.

The extension comprises the following functional modules:

| Module | Function |
|--------|----------|
| **Monitoring (Sentinel)** | Displays, against the current patient's record, threshold checks for drug-monitoring intervals and QOF 2025/26 indicator achievement. Passive display only — no clinical recommendation produced. |
| **Custom Alert Builder** | Form-based authoring of practice custom rules across five rule types (drug-monitoring, drug-combo, qof-indicator, event-count, composite), with an engine-backed live preview against an editable test patient and schema validation on save. Passive — produces rules the Monitoring module later displays. |
| **Slots** | Displays appointment slot availability data already present in the Medicus scheduling system. |
| **Capacity Forecast** | Aggregates slot and session data to assist with practice-level capacity visibility. |
| **Triage Lens** | In-page overlay displaying structured triage information for patients in the current consultation queue, drawn from data already present in Medicus. On the patient record view it also surfaces deterministic STOPP/START-style prescribing-combination prompts, a risk-tool signpost chip (links to the QRISK3 / QCancer / eFI calculators — computes no score), and NHS Pharmacy First pathway signposting reference snippets — all supplementary prompts to review, not clinical decisions. |
| **Submissions** | Displays submission status counts for QOF and enhanced services as already recorded in Medicus. |
| **Activity** | Displays aggregated activity data for the current clinical session, drawn from Medicus. |
| **Referrals Tracker** | Displays referral audit data drawn from Medicus, including specialty, priority, status, and clinician breakdowns. |
| **Waiting Room / Request Monitor** | Displays live waiting-room patient counts and new-request demand counts with configurable amber/red thresholds. |
| **Patient Record Visualiser** | Analyses a Medicus EPR export PDF locally in the browser to produce a multi-tab clinical dashboard. Outputs include: continuity-of-care indices, investigation trends with clinical zone bands, medication monitoring compliance against NICE/BNF intervals, electronic frailty index (eFI), PINCER-style prescribing safety flags, QOF register review status, and a D3 swim-lane event timeline. No patient data leaves the browser at any stage. |

---

## Frozen intended-purpose statement — v3.16.0 (signed; in force)

> **Retained per the re-freeze convention. Two claims in the final paragraph — that the software "does not write to, modify, or submit any data to the patient record", and the "clinician"-only framing — are no longer accurate at v3.199.1. They are superseded by the v3.199.1 draft below on signature.**

> Software that operates alongside the Medicus electronic patient record to display, reorganise, and summarise data already present in the Medicus system for the patient or session the clinician is actively viewing. The software applies threshold comparisons to drug-monitoring intervals and QOF indicator criteria, and displays whether recorded values fall within those thresholds, using data already visible to the clinician in the source record.
>
> The software additionally provides a Patient Record Visualiser that processes a locally-held Medicus EPR export PDF to produce summary analytics including continuity indices, investigation trend charts, a computed electronic frailty index, PINCER-style prescribing safety prompts, and drug monitoring compliance indicators. These outputs are derived from the exported PDF and are supplementary aids to clinical review; they do not replace assessment of the live patient record.
>
> From v3.13.0–v3.14.0 the live side panel additionally surfaces, on the patient record view, deterministic prescribing-combination prompts (STOPP/START-style), a risk-tool signpost chip that hyperlinks to externally-hosted, independently-validated calculators (it computes no score), and NHS Pharmacy First pathway signposting reference snippets. These are supplementary prompts surfaced for the clinician to review and verify; the clinician makes any prescribing-review or signposting decision.
>
> The software does not generate clinical diagnoses, clinical recommendations, prescribing decisions, or triage decisions. It does not write to, modify, or submit any data to the patient record or to any external system. It does not transmit patient data outside the user's own browser session. It does not replace clinical judgement. All clinical decisions, including verification of displayed values against the source record, remain the sole responsibility of the clinician.

Any use of Medicus Suite outside this stated purpose is at the user's sole risk.

---

## Frozen intended-purpose statement — v3.199.1 (**DRAFT — pending CSO signature**)

> **STATUS: DRAFT. This statement is NOT in force. It has not been reviewed or signed by the Clinical Safety Officer. Until it is signed, v3.16.0 above remains the statement in force.**

> Software that operates alongside the Medicus electronic patient record to display, reorganise, and summarise data already present in the Medicus system for the patient, task, or session the user is actively viewing. The software applies threshold comparisons to drug-monitoring intervals and QOF indicator criteria, and displays whether recorded values fall within those thresholds, using data already visible to the user in the source record.
>
> The software additionally provides a Patient Record Visualiser that processes a locally-held Medicus EPR export PDF to produce summary analytics including continuity indices, investigation trend charts, a computed electronic frailty index, PINCER-style prescribing safety prompts, and drug monitoring compliance indicators. These outputs are derived from the exported PDF and are supplementary aids to clinical review; they do not replace assessment of the live patient record.
>
> On the patient record view the live side panel surfaces deterministic prescribing-combination prompts (STOPP/START-style), a risk-tool signpost chip that hyperlinks to externally-hosted, independently-validated calculators (it computes no score), and NHS Pharmacy First pathway signposting reference snippets. These are supplementary prompts surfaced for the clinician to review and verify; the clinician makes any prescribing-review or signposting decision.
>
> For non-clinical front-desk use, the software provides **guided structured capture**: a fixed, identical-every-time question set per presenting problem, with red-flag questions asked first, producing a plain-text complaint description that the member of staff pastes into Medicus. Where enabled by the practice it also provides **care-navigation suggestions** — a suggested destination for a contact, derived from clinician-agreed rules held in the practice's own pathway configuration and always accompanied by the offer of a clinician callback. These are administrative aids for recording and routing a contact under practice-agreed rules. The software makes no clinical decision: red flags are escalation triggers, not exclusions; a suggestion is a suggestion, a human decides, and every capture is read by a clinician.
>
> **Write capability.** The software provides a small, enumerated set of **user-initiated write actions** into Medicus: booking an appointment, creating a general task, filing an inbound document, filing a laboratory result the software has graded entirely normal, re-assigning a routine prescription request to a team, and tidying problem-list and duplicate record entries. Each is triggered by a user on the record or task in front of them, is explicitly confirmed at the point of commit, and executes either through Medicus's own endpoints under that user's own authenticated session or by driving Medicus's own on-screen controls — so Medicus's validation, access control and audit trail fire exactly as if the user had performed the action by hand. No write is automatic, scheduled, retried in the background, or performed without an explicit user action. Booking an appointment causes Medicus to send its own booking-confirmation SMS/email to the patient. The complete list of write paths and their controls is held at `docs/CLINICAL-SAFETY-NOTICE.md` §6.1. **Medicus is, and remains, the system of record**; the software is never the authoritative copy of anything it writes.
>
> The software does not generate clinical diagnoses, clinical recommendations, prescribing decisions, or triage decisions. It does not transmit patient data outside the user's own browser session. It does not replace clinical judgement. All clinical decisions, including verification of displayed values against the source record before any write, remain the responsibility of the user and, for anything clinical, of the responsible clinician.

Any use of Medicus Suite outside this stated purpose is at the user's sole risk.

**Clinical Safety Officer approval of the v3.199.1 frozen statement**

I confirm that the statement above fairly represents the intended purpose of Medicus Suite at v3.199.1, including its write capability and its intended non-clinical users, and I approve it as the frozen intended-purpose statement in force from the date below.

**Signed:**

**Name / role:**

**GMC:**

**Date:**

_(Unsigned. Do not treat this statement as in force, and do not cite it as CSO-approved, until these lines are completed by the Clinical Safety Officer.)_

---

## Frozen-statement change log

| Statement version | Date | Author | Status | Change |
|---|---|---|---|---|
| 3.16.0 | May 2026 | DT | **Signed — in force** | Original frozen statement: display/reorganise/summarise, Patient Record Visualiser, prescribing prompts and signposting; asserted no write path of any kind; intended user restricted to qualified clinicians. |
| 3.199.1 | 2026-07-28 | Claude (drafted for CSO review) | **DRAFT — pending CSO signature** | Corrects the no-write claim, which had been false since the booking and task widgets shipped, with an accurate write-capability paragraph (user-initiated, explicitly confirmed, executed under the user's own Medicus session, Medicus remains the system of record, booking causes Medicus's own patient confirmation) cross-referenced to CSN §6.1. Adds reception-facing structured capture and care-navigation suggestion to the stated purpose. Widens the intended user to include non-clinical reception and administrative staff operating under practice delegated authority for the reception-facing features (see "Intended user"). Prepared as Phase 0 of `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`. **No signature given.** |

---

## What this software is not

- It is not a medical device. The author asserts, on a good-faith reading of MHRA Software as a Medical Device guidance current at the date of this document, that Medicus Suite falls outside the scope of UK Medical Devices Regulations 2002 (as amended). No CE mark, UKCA mark, or other regulatory clearance is claimed.
- It is not clinical decision support software as defined by MHRA, NICE, or equivalent authority.
- It is not endorsed by, affiliated with, or approved by Medicus Health Ltd, NHS England, NHSX, any ICB, any PCN, or any regulatory body.
- It is not a substitute for reading the patient record.
- The Patient Record Visualiser's eFI score is not a validated clinical frailty assessment tool as used in GP clinical systems; it is an arithmetic approximation based on problem-list text matching.
- The Patient Record Visualiser's PINCER flags are a subset of the full PINCER tool and are supplementary to Medicus's own prescribing safety systems.
- The live Triage Lens STOPP/START prescribing prompts are a small, name-based subset of prescribing-combination checks, supplementary to Medicus's own prescribing-safety systems; absence of a prompt does not indicate prescribing safety.
- The risk-tool chip computes no risk score; it links to externally-hosted, independently-validated calculators.
- The Pharmacy First signposting snippets are reference text and links for the clinician's consideration; eligibility and clinical suitability are confirmed by the clinician, not by the software.

---

## Intended user

**In force (statement v3.16.0):** Qualified clinicians (GPs, nurses, allied health professionals) working within a Medicus-enabled GP practice, who are fully authorised to access the patient data they are viewing, and who understand that all clinical decisions remain their own professional responsibility.

**Proposed amendment (statement v3.199.1 — DRAFT, pending CSO signature):**

1. **Qualified clinicians** (GPs, nurses, allied health professionals) working within a Medicus-enabled GP practice, who are fully authorised to access the patient data they are viewing, and who understand that all clinical decisions remain their own professional responsibility — for all features of the suite.

2. **Non-clinical reception and administrative staff** of that practice, employed and supervised by it, authorised to access the records they are viewing, and operating under the practice's **delegated authority** — for the reception-facing features only:
   - **guided structured capture** — recording a caller's account against a fixed, clinician-reviewed question set;
   - **care-navigation suggestion** — offering a destination derived from rules the practice's clinicians have agreed, always alongside the offer of a clinician callback;
   - **appointment booking under clinician-agreed rules** — *once shipped*; not yet available at the date of this draft (planned in `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`, phase D, gated on this re-freeze being signed).

   Conditions on this delegation, all of which the deploying practice is responsible for satisfying:
   - Capture pathways ship **disabled** and are enabled only after a clinician (CSO or nominated GP) has reviewed their content and staff have been briefed (Clinical Safety Notice, limitation 27).
   - Reception staff make **no standalone clinical judgement**. Red-flag answers are escalation triggers and are not overridable by the destination a rule suggests; a full set of "no" answers is not a clinical clearance; every capture is read by a clinician.
   - Any suggested destination is a **suggestion the human decides on**, is recorded in the text pasted into Medicus, and always carries the offer of a clinician callback.
   - Staff work within their own competence, their practice's policies, and its delegation/supervision arrangements; the practice remains accountable for the clinical safety of what it delegates.

   Until this amendment is signed, the reception-facing features are used under the practice's own delegated-authority arrangements and the conditions in the Clinical Safety Notice; the frozen statement in force does not yet name non-clinical staff.

---

## Intended environment

Google Chrome browser on a workstation used by the named clinician, authenticated to the Medicus web application under that clinician's own credentials, within a practice that has lawful access to Medicus.

**Proposed amendment (statement v3.199.1 — DRAFT, pending CSO signature):** for the reception-facing features, a practice front-desk workstation which may be **shared between members of staff across a shift**, with each user authenticated to Medicus under their own credentials and the workstation locked or the session ended when a user steps away. Draft persistence on such a workstation is assessed in `docs/DPIA.md` §2 (Reception module) and §5.

---

## Contraindications

This software must not be used:
- By anyone not authorised to access the underlying patient record
- As a substitute for reading the source patient record
- As the sole basis for any clinical decision
- On any EHR system other than Medicus
- In any setting where its limitations (see HAZARD-LOG.md) are not understood and accepted
- With a Patient Record Visualiser PDF that has not been recently exported from the current live record
