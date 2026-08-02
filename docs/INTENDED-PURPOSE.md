# Medicus Suite — Intended Purpose Statement

**Frozen statement in force:** v3.202.0 (signed 2026-07-28)  
**Superseded:** v3.16.0 (signed May 2026); v3.199.1 (drafted 2026-07-28, **never signed** — superseded before signature by v3.202.0)  
**Date:** May 2026; re-freeze signed 2026-07-28  
**Author:** Dr Dave Triska, Graysbrook Ltd  
**Status:** Limited distribution — see "Intended user"

> **Re-freeze convention.** The frozen statement is never edited in place. A change of substance produces a **new numbered version**, pinned to the product version at which it was drafted, which takes effect only when the Clinical Safety Officer signs it. Superseded versions are retained below, never deleted, so it is always answerable what the product claimed it could do on any given date. **v3.202.0 is the statement in force from 2026-07-28. v3.16.0 was in force until that date and is retained below; it was, in the respects marked, factually out of date for some time before it was replaced.**

---

## Software description

Medicus Suite is a browser extension for Google Chrome that runs alongside the Medicus electronic patient record system (Medicus Health Ltd / Doctolib). It adds a side panel and optional display overlays to the Medicus web interface. It does not install any software on clinical systems. In its default configuration it transmits no patient data outside the user's browser; it has one optional, off-by-default read path (the Medicus Transactional API via a Graysbrook-operated UK proxy) which a practice must deliberately configure, described in full under "Data flow and egress" in the frozen statement below. It **does** have a small, enumerated set of user-initiated write paths into Medicus — appointment booking, general-task creation, inbound-document filing, normal-lab-result filing, routine-prescription re-assignment, and problem-list / duplicate-entry tidying — each triggered by a user on the record in front of them, explicitly confirmed at the point of commit, and executed under that user's own Medicus session so Medicus's validation, access control and audit trail apply. They are listed in full, with their controls, at `docs/CLINICAL-SAFETY-NOTICE.md` §6.1. (Earlier issues of this document said the software "does not write to any patient record"; that statement was false from the point the booking and task widgets shipped and is corrected here.) The suite also provides an in-app feedback channel that composes an ordinary email via the user's own mail client; it transmits no patient data and auto-attaches only the suite version, browser, and timestamp.

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
| **Rota (compact) and Rota manager (full application)** | Practice **staff rostering**, not clinical function: working patterns and multi-week templates, session-accounted leave on an April–March leave year, cover worklists and shift swaps, duty fairness pro-rata to contracted sessions, demand-led session planning, and safe-staffing checks (duty-doctor cover, registrar supervision, HCA supervision). Reconciles the planned rota against the Medicus appointment book **read-only**. Produces no clinical output about any patient. |

---

## Frozen intended-purpose statement — v3.16.0 (signed May 2026; **superseded 2026-07-28**)

> **Retained per the re-freeze convention. Three claims in the final paragraph — that the software "does not write to, modify, or submit any data to the patient record", that it "does not transmit patient data outside the user's own browser session", and the "clinician"-only framing — were not accurate at v3.199.1. All three are corrected by, and this statement is superseded by, v3.202.0 below.**

> Software that operates alongside the Medicus electronic patient record to display, reorganise, and summarise data already present in the Medicus system for the patient or session the clinician is actively viewing. The software applies threshold comparisons to drug-monitoring intervals and QOF indicator criteria, and displays whether recorded values fall within those thresholds, using data already visible to the clinician in the source record.
>
> The software additionally provides a Patient Record Visualiser that processes a locally-held Medicus EPR export PDF to produce summary analytics including continuity indices, investigation trend charts, a computed electronic frailty index, PINCER-style prescribing safety prompts, and drug monitoring compliance indicators. These outputs are derived from the exported PDF and are supplementary aids to clinical review; they do not replace assessment of the live patient record.
>
> From v3.13.0–v3.14.0 the live side panel additionally surfaces, on the patient record view, deterministic prescribing-combination prompts (STOPP/START-style), a risk-tool signpost chip that hyperlinks to externally-hosted, independently-validated calculators (it computes no score), and NHS Pharmacy First pathway signposting reference snippets. These are supplementary prompts surfaced for the clinician to review and verify; the clinician makes any prescribing-review or signposting decision.
>
> From v3.126.0 the suite additionally provides a **rota** surface (a compact status module in the side panel and pop-out, and a full application that opens in its own browser tab) for **practice staff rostering**: working patterns, session-accounted leave, cover and swaps, duty fairness, demand-led session planning, and safe-staffing warnings drawn from BMA/CQC/NHSE guidance. Its safe-staffing checks are **guidance, not regulation: they warn and never block**, and every threshold is a practice-configurable setting rather than a constant. It reconciles the planned rota against the Medicus appointment book **read-only** and writes nothing back. Patient names present in appointment-book payloads are counted and displayed transiently to size the work; **no patient-identifiable data is persisted** by the rota. The rota makes no statement about any patient's care and is a workforce-administration aid, not clinical decision support. Staffing decisions remain the responsibility of the practice.
>
> The software does not generate clinical diagnoses, clinical recommendations, prescribing decisions, or triage decisions. It does not write to, modify, or submit any data to the patient record or to any external system. It does not transmit patient data outside the user's own browser session. It does not replace clinical judgement. All clinical decisions, including verification of displayed values against the source record, remain the sole responsibility of the clinician.

Any use of Medicus Suite outside this stated purpose is at the user's sole risk.

---

## Frozen intended-purpose statement — v3.202.0 (**signed 2026-07-28; in force**)

> **STATUS: SIGNED and in force from 2026-07-28.** Issued as v3.202.0, not v3.199.1: the v3.199.1 text went to CSO review as a draft and was **amended at review** (a Data-flow-and-egress paragraph was added — see the change log), which is a change of substance, and the re-freeze convention pins a new statement to the product version at which it was drafted. The v3.199.1 draft was never signed and never in force; what it said is recorded in the change log below.

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
> **Data flow and egress.** In its default configuration the software transmits **no** patient data outside the user's own browser session: it reads the user's authenticated Medicus session, processes locally, and stores only configuration, aggregate counts and short-lived local working copies on that workstation. It has **one** optional, non-default path by which patient data leaves the browser, and it is stated here rather than omitted: a practice may configure the suite to source the patient record from the **official Medicus Transactional API**, which is a server-to-server interface the extension cannot call directly. When — and only when — a practice sets `txn.integrationMode` to `hybrid` or `transactional` and supplies a proxy URL and credential, patient reads are routed through a Graysbrook-operated backend proxy (a UK-hosted edge function) which signs a short-lived Medicus token and forwards the request; the GP Connect structured care record and demographics return by the same route. This path is **read-only** (no write endpoint is wired to it), is **dormant by default** (`txn.integrationMode` defaults to `session`), and requires a deliberate practice configuration act; a failure falls back to the in-browser session feed. A practice enabling it takes on the corresponding data-protection assessment for that transfer. No other component of the software transmits patient data anywhere: there is no telemetry, no analytics, no remote logging and no cloud storage, and the in-app feedback channel composes an ordinary email in the user's own mail client carrying no patient data.
>
> The software does not generate clinical diagnoses, clinical recommendations, prescribing decisions, or triage decisions. It does not replace clinical judgement. All clinical decisions, including verification of displayed values against the source record before any write, remain the responsibility of the user and, for anything clinical, of the responsible clinician.

Any use of Medicus Suite outside this stated purpose is at the user's sole risk.

**Clinical Safety Officer approval of the v3.202.0 frozen statement**

I confirm that the statement above fairly represents the intended purpose of Medicus Suite at v3.202.0, including its write capability, its one optional data-egress path, and its intended non-clinical users, and I approve it as the frozen intended-purpose statement in force from the date below.

**Signed:** Dr D. Triska (Clinical Safety Officer) — **review performed by delegated virtual-Dave agent at Dave's instruction, 2026-07-28 (chat)**. This is not a wet or electronic personal signature; it is a delegated review recorded under the same convention as the 2026-07-22 hazard-log sign-off (see `docs/cso-review-ledger.json`).

**Name / role:** Dr Dave Triska — GP Partner; Clinical Safety Officer, Medicus Suite (Graysbrook Ltd)

**GMC:** 6159481

**Date:** 2026-07-28

**Basis of approval, and what was checked.** The write-capability paragraph was verified against the code, not against the previous document: every `POST` write site in the repository (`booking-inline.js`, `task-inline.js`, `document-file-inline.js`, `problem-bulk-end.js`, `problem-description-cleanup.js`, `duplicate-checker.js`/`record-duplicate-parser.js`, `shared/booking-core.js`, `shared/task-api.js`) maps onto a row of `docs/CLINICAL-SAFETY-NOTICE.md` §6.1, and the two macro surfaces that drive Medicus's own controls rather than calling endpoints (`lab-file-button.js`, `routine-rx-button.js`) are stated there as such. No write path was found that is not described. **One correction was made at review:** the draft repeated the blanket claim that the software "does not transmit patient data outside the user's own browser session", which is not true when the optional Transactional-API integration is enabled (`shared/txn-transport.js`, `shared/data-source-transactional.js`, `service-worker.js` `txnFetchPatientBundle`, documented at `docs/TRANSACTIONAL-API-INTEGRATION.md`). That is the same class of error this whole re-freeze exists to correct — a safety case asserting a capability boundary the code had already crossed — so it was corrected here rather than signed. The consequential gap in `docs/CLINICAL-SAFETY-NOTICE.md` §6 items 1/8/9, `docs/DPIA.md` and `docs/HAZARD-LOG.md`, none of which mention that path, is **open and named** (see the change log below); it does not block this statement, which now describes the capability accurately, but a practice must not enable `hybrid`/`transactional` mode until it is closed.

---

## Frozen-statement change log

| Statement version | Date | Author | Status | Change |
|---|---|---|---|---|
| 3.16.0 | May 2026 | DT | **Signed — superseded 2026-07-28** | Original frozen statement: display/reorganise/summarise, Patient Record Visualiser, prescribing prompts and signposting; asserted no write path of any kind; intended user restricted to qualified clinicians. |
| 3.199.1 | 2026-07-28 | Claude (drafted for CSO review) | **DRAFT — pending CSO signature** | Corrects the no-write claim, which had been false since the booking and task widgets shipped, with an accurate write-capability paragraph (user-initiated, explicitly confirmed, executed under the user's own Medicus session, Medicus remains the system of record, booking causes Medicus's own patient confirmation) cross-referenced to CSN §6.1. Adds reception-facing structured capture and care-navigation suggestion to the stated purpose. Widens the intended user to include non-clinical reception and administrative staff operating under practice delegated authority for the reception-facing features (see "Intended user"). Prepared as Phase 0 of `docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`. **No signature given — this draft was never in force; superseded before signature by 3.202.0.** |
| 3.202.0 | 2026-07-28 | DT (CSO review of the 3.199.1 draft, performed by delegated virtual-Dave agent at Dave's instruction — chat) | **Signed — in force** | The 3.199.1 draft, **amended at CSO review**, and signed. Amendment: a **Data flow and egress** paragraph was added, because the draft repeated the blanket claim that the software "does not transmit patient data outside the user's own browser session". That claim is false whenever the optional Medicus **Transactional API** integration is enabled (`txn.integrationMode` = `hybrid`/`transactional`), which routes patient reads through a Graysbrook-operated UK backend proxy — read-only, dormant by default, requiring a deliberate practice configuration act, documented at `docs/TRANSACTIONAL-API-INTEGRATION.md` and shipped in `shared/txn-transport.js` / `shared/data-source-transactional.js` / `service-worker.js`. Signing the blanket claim would have repeated, in the very document written to fix it, the failure that made 3.16.0 out of date. Also promotes the two "proposed amendments" (intended user, intended environment) to in force. **OPEN ACTIONS created by this signature, and not closed by it:** (i) `docs/CLINICAL-SAFETY-NOTICE.md` §6 items 1, 8 and 9 still assert no external transmission and must be corrected at the next CSN review; (ii) `docs/DPIA.md` contains no processing/controller-processor analysis of that proxy transfer; (iii) `docs/HAZARD-LOG.md` carries no hazard for it. Until (i)–(iii) are closed, **no practice should set `txn.integrationMode` to `hybrid` or `transactional`** — the capability is now honestly stated, which is not the same as assured. |

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
- The rota's safe-staffing checks are not a compliance determination and not a safe-staffing guarantee. They encode BMA/CQC/NHSE **guidance**, warn rather than block, and use practice-set thresholds; an absent warning does not mean a session is safely staffed. The rota is not an HR or payroll system and is not a record of employment.

---

## Intended user

**Superseded (statement v3.16.0, in force until 2026-07-28):** Qualified clinicians (GPs, nurses, allied health professionals) working within a Medicus-enabled GP practice, who are fully authorised to access the patient data they are viewing, and who understand that all clinical decisions remain their own professional responsibility.

**In force (statement v3.202.0 — signed 2026-07-28; provenance as recorded at the signature block above):**

1. **Qualified clinicians** (GPs, nurses, allied health professionals) working within a Medicus-enabled GP practice, who are fully authorised to access the patient data they are viewing, and who understand that all clinical decisions remain their own professional responsibility — for all features of the suite.

2. **Non-clinical reception and administrative staff** of that practice, employed and supervised by it, authorised to access the records they are viewing, and operating under the practice's **delegated authority** — for the reception-facing features only:
   - **guided structured capture** — recording a caller's account against a fixed, clinician-reviewed question set;
   - **care-navigation suggestion** — offering a destination derived from rules the practice's clinicians have agreed, always alongside the offer of a clinician callback;
   - **appointment booking under clinician-agreed rules** — shipped at v3.202.0 (`docs/plans/RECEPTION-FEEDBACK-2026-07-28.md`, phase D3). It books a **real appointment on the record open in Medicus**, under the controls recorded at `docs/HAZARD-LOG.md` H-051: docked panel only, an open and resolvable record required, both identity sources agreeing at arm time and again immediately before the write, a name-and-DOB read-back the receptionist must tick, no booking while any red flag is positive or unanswered, and never on a sensitive pathway.

   Conditions on this delegation, all of which the deploying practice is responsible for satisfying:
   - Capture pathways ship **disabled** and are enabled only after a clinician (CSO or nominated GP) has reviewed their content and staff have been briefed (Clinical Safety Notice, limitation 27).
   - Reception staff make **no standalone clinical judgement**. Red-flag answers are escalation triggers and are not overridable by the destination a rule suggests; a full set of "no" answers is not a clinical clearance; every capture is read by a clinician.
   - Any suggested destination is a **suggestion the human decides on**, is recorded in the text pasted into Medicus, and always carries the offer of a clinician callback.
   - Staff work within their own competence, their practice's policies, and its delegation/supervision arrangements; the practice remains accountable for the clinical safety of what it delegates.

   - The named delegation covers the **content** of the shipped pathways as signed off by the CSO (`rules/reception-pathways.json` specVersion v1.8). Enabling a pathway for live use remains a separate practice act, and a practice that **edits or authors** pathway content owns the clinical safety of what it wrote — non-clinician routing destinations on such a pack stay off until a CSO or partner records the routing attestation.

The rota surface is additionally intended for **practice managers and rota administrators** at the same practice, who are authorised to see colleagues' working patterns and leave. Because the rota holds employee data — including absence and leave-type detail — access to it should follow the practice's own HR/employment-data access controls, not merely clinical-system access (see `docs/DPIA.md`).

---

## Intended environment

Google Chrome browser on a workstation used by the named clinician, authenticated to the Medicus web application under that clinician's own credentials, within a practice that has lawful access to Medicus.

**In force (statement v3.202.0 — signed 2026-07-28):** for the reception-facing features, a practice front-desk workstation which may be **shared between members of staff across a shift**, with each user authenticated to Medicus under their own credentials and the workstation locked or the session ended when a user steps away. Draft persistence on such a workstation is assessed in `docs/DPIA.md` §2 (Reception module) and §5.

---

## Contraindications

This software must not be used:
- By anyone not authorised to access the underlying patient record
- As a substitute for reading the source patient record
- As the sole basis for any clinical decision
- On any EHR system other than Medicus
- In any setting where its limitations (see HAZARD-LOG.md) are not understood and accepted
- With a Patient Record Visualiser PDF that has not been recently exported from the current live record
