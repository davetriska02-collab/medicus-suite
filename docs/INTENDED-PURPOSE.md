# Medicus Suite — Intended Purpose Statement

**Version:** 3.77.5  
**Date:** June 2026  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Status:** Limited distribution — named clinical users only

---

## Software description

Medicus Suite is a browser extension for Google Chrome that runs alongside the Medicus electronic patient record system (Medicus Health Ltd / Doctolib). It adds a side panel and optional display overlays to the Medicus web interface. It does not install any software on clinical systems, does not write to any patient record, and does not transmit patient data outside the user's browser. The suite also provides an in-app feedback channel that composes an ordinary email via the user's own mail client; it transmits no patient data and auto-attaches only the suite version, browser, and timestamp.

The extension comprises the following functional modules:

| Module | Function |
|--------|----------|
| **Monitoring (Sentinel)** | Displays, against the current patient's record, threshold checks for drug-monitoring intervals and QOF 2025/26 indicator achievement. Passive display only — no clinical recommendation produced. |
| **Custom Alert Builder** | Form-based authoring of practice custom rules across five rule types (drug-monitoring, drug-combo, qof-indicator, event-count, composite), with an engine-backed live preview against an editable test patient and schema validation on save. Passive — produces rules the Monitoring module later displays. |
| **Slots** | Displays appointment slot availability data already present in the Medicus scheduling system. |
| **Capacity Forecast** | Aggregates slot and session data to assist with practice-level capacity visibility. |
| **Triage Lens** | In-page overlay displaying structured triage information for patients in the current consultation queue, drawn from data already present in Medicus. On the patient record view it also surfaces deterministic STOPP/START-style prescribing-combination prompts, a risk-tool signpost chip (links to the QRISK3 / QCancer / eFI calculators — computes no score), and NHS Pharmacy First pathway signposting reference snippets — all supplementary prompts to review, not clinical decisions. From v3.62.0 the Triage Lens additionally annotates rows in the Medicus Investigation Results filing queue with severity chips (urgent, abnormal, under-prioritised, unmatched-patient) derived from the laboratory's own flags and, from v3.63.0, user-authored and built-in result-triage rules (threshold and text-classification). All are escalate-only; the Triage Lens never files a result or changes its status. |
| **Submissions** | Displays submission status counts for QOF and enhanced services as already recorded in Medicus. |
| **Activity** | Displays aggregated activity data for the current clinical session, drawn from Medicus. |
| **Referrals Tracker** | Displays referral audit data drawn from Medicus, including specialty, priority, status, and clinician breakdowns. |
| **Waiting Room / Request Monitor** | Displays live waiting-room patient counts and new-request demand counts with configurable amber/red thresholds. |
| **Patient Record Visualiser** | Analyses a Medicus EPR export PDF locally in the browser to produce a multi-tab clinical dashboard. Outputs include: continuity-of-care indices, investigation trends with clinical zone bands, medication monitoring compliance against NICE/BNF intervals, electronic frailty index (eFI), PINCER-style prescribing safety flags, QOF register review status, and a D3 swim-lane event timeline. From v3.51.0 a Structured Medication Review (SMR) tab adds ACB scoring (Boustani scale) and a starter set of STOPP/START v3 prescribing flags as supplementary aids. No patient data leaves the browser at any stage. |
| **Trends** | Graphical trend charts for blood pressure, albumin-creatinine ratio (ACR), HbA1c, cholesterol, and weight, drawn from the Medicus investigation dashboard. BP and ACR charts include condition-specific target lines and NICE/KDIGO threshold-based action banners as prompts to consider and verify — not clinical decisions. Display only; no data transmitted externally. |
| **Condor** | Operational intelligence dashboard displaying practice-level administrative metrics: live waiting-room arrivals, appointment-book demand/capacity, submission velocity, Practice Pressure Index, and task-inbox age. Administrative and situational-awareness tool only; no clinical decisions. |
| **Pre-clinic Monitoring Sweep** | Runs the Sentinel rules engine against today's booked patients before clinic to produce a priority-ordered action worklist. Generates printable reception handouts, per-chip Action Packs (copy-ready booking and recall instructions), and batch artefacts for the full worklist. A morning-huddle aid only; not an audited monitoring record. Results persist locally for up to two hours; excluded from backups. |
| **Reception** | Guided, fixed-question structured history capture for non-clinical front-desk staff. Produces a plain-text complaint description for manual pasting into Medicus. Not a triage tool; all pathways ship disabled and require clinician review before enablement. Also displays a configurable RAG status pill summarising the current patient's Sentinel chips for reception use. |
| **Knowledge** | Practice-owned reference base for referral criteria, local contacts, internal pathways, and protocols. Explicitly non-clinical-decision-support reference material; presented with a first-open acknowledgement to that effect. |
| **Today** | Aggregated morning-overview tab combining waiting-room counts, triage load, demand counts, slot availability, last Sweep summary, and a recent-alerts log. Administrative glance view only; all data drawn from existing module feeds. The recent-alerts log records the extension's own operational alert events (counts and labels, never patient identifiers) and is not an audit trail. |

---

## Frozen intended-purpose statement

> Software that operates alongside the Medicus electronic patient record to display, reorganise, and summarise data already present in the Medicus system for the patient or session the clinician is actively viewing. The software applies threshold comparisons to drug-monitoring intervals and QOF indicator criteria, and displays whether recorded values fall within those thresholds, using data already visible to the clinician in the source record.
>
> The software additionally provides a Patient Record Visualiser that processes a locally-held Medicus EPR export PDF to produce summary analytics including continuity indices, investigation trend charts, a computed electronic frailty index, PINCER-style prescribing safety prompts, and drug monitoring compliance indicators. These outputs are derived from the exported PDF and are supplementary aids to clinical review; they do not replace assessment of the live patient record.
>
> From v3.13.0–v3.14.0 the live side panel additionally surfaces, on the patient record view, deterministic prescribing-combination prompts (STOPP/START-style), a risk-tool signpost chip that hyperlinks to externally-hosted, independently-validated calculators (it computes no score), and NHS Pharmacy First pathway signposting reference snippets. These are supplementary prompts surfaced for the clinician to review and verify; the clinician makes any prescribing-review or signposting decision.
>
> The software does not generate clinical diagnoses, clinical recommendations, prescribing decisions, or triage decisions. It does not write to, modify, or submit any data to the patient record or to any external system. It does not transmit patient data outside the user's own browser session. It does not replace clinical judgement. All clinical decisions, including verification of displayed values against the source record, remain the sole responsibility of the clinician.

Any use of Medicus Suite outside this stated purpose is at the user's sole risk.

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

Qualified clinicians (GPs, nurses, allied health professionals) working within a Medicus-enabled GP practice, who are fully authorised to access the patient data they are viewing, and who understand that all clinical decisions remain their own professional responsibility.

---

## Intended environment

Google Chrome browser on a workstation used by the named clinician, authenticated to the Medicus web application under that clinician's own credentials, within a practice that has lawful access to Medicus.

---

## Contraindications

This software must not be used:
- By anyone not authorised to access the underlying patient record
- As a substitute for reading the source patient record
- As the sole basis for any clinical decision
- On any EHR system other than Medicus
- In any setting where its limitations (see HAZARD-LOG.md) are not understood and accepted
- With a Patient Record Visualiser PDF that has not been recently exported from the current live record
