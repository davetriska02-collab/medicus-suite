# Medicus Suite — Feature List

**Version:** v3.78.0
**Generated:** 2026-06-14 (automated)

## What it is

Medicus Suite is a Chrome browser extension for UK GP practices that runs alongside the Medicus electronic patient record system (Medicus Health Ltd / Doctolib). It adds a side panel and optional on-page overlays that surface monitoring alerts, demand data, appointment capacity, investigation result triage, and clinical reference directly within the Medicus interface. All processing happens locally in the browser; no patient data is transmitted to any external service, no record is written to, and no clinical inference is performed — everything shown is derived from data already present in Medicus.

## At a glance

- 12 side-panel modules covering monitoring, demand, capacity, workflow, knowledge, and analytics
- 4 in-page content-script features (on-screen overlays and relays)
- 7 rule types in the alert engine
- 25 drug-monitoring rules, 61 QOF rules, 21 bundled investigation result rules, and 22 starter alerts in the prescribing-safety library

## Side-panel modules

### Today (Morning command centre)

The default tab. One glance answers "what does today look like?" before clinic starts. Each card deep-links to its own module.

- **Waiting room**: live arrived-patient count with max-wait amber/red colouring
- **Triage load**: request-monitor bucket counts when the monitor is configured
- **Demand today**: medical and admin task totals against the practice's thresholds
- **Slots remaining**: live available-slot count for today
- **Morning sweep**: last sweep summary (time and action-needed count) or a prompt to run it
- **Recent alerts**: last few operational alert events — counts and labels only, never patient identifiers

### Sentinel (Monitoring)

The core per-patient alerting module. When a patient record is open in Medicus, Sentinel evaluates the practice's monitoring rules against that patient's medications, observations, problems, and vaccination history, and displays colour-coded chips for anything overdue, due soon, or not achieved.

- Drug-monitoring chips show which specific blood tests are overdue and by how long, with monitoring interval and source citation
- QOF indicator chips flag register members whose targets are not met or approaching threshold
- Vaccine chips reflect seasonal campaign windows (flu and COVID appear only during the active season)
- A collapsible **Brief** card gives a 30-second risk summary: patient line, red/amber count, and the four highest-priority signals
- **Action Packs**: each actionable chip carries copy-ready text — blood form, recall SMS, escalation SMS, letter, and task line for admin
- **Patient Passport**: plain-English summary (reading age 9–11) for handing to the patient in the room
- Dismissed chips resurface automatically when their status escalates — an overdue chip cannot stay permanently hidden
- "Meds without a monitoring rule" audit view shows medications not matched by any enabled rule, so brand-coverage gaps are visible rather than silent

### Sweep (Pre-clinic sweep)

Runs the same monitoring rules as Sentinel across all patients booked in today's appointment book — before clinic starts — to produce a worst-first worklist so overdue recalls can be arranged before consultation.

- Manual trigger only; large practices processed in batches of 40 with a "Check next N" button
- Clinician filter: sweep one clinician's list or the whole practice
- Per-patient API failures render explicitly — a patient with partial data cannot appear clear
- **Print reception handout**: tick-box worklist with plain-English booking instructions per patient, sorted by appointment time
- Last sweep survives tab switches for up to 2 hours, with the run time shown so staleness is visible

### Slots (Appointment slot counter)

Displays appointment slot availability for today or any selected date, drawn from the Medicus scheduling API.

- Type-pill view: available slots by appointment type with per-type colour-coding (organise via drag-and-drop)
- Threshold alerts: amber/red per appointment type at configurable counts; safety-alert colours always override user custom colours
- CSV export; freshness ticker; slot alert strip in the side panel

### Capacity Forecast

Aggregates slot and session data across a configurable date range to show week-level capacity against the practice's daily minimum.

- Week and month views; green/amber/red by sufficient/tight/low/critical thresholds
- Configurable presets for appointment-type subsets (e.g. face-to-face only, one clinician)
- Weekend toggle; historic dates shown as "Past"

### Submissions Tracker

Live dashboard of patient submission task counts, split by type (Medical, Admin, Investigations, Routine Rx, Non-routine Rx) and presented as a stacked bar or area chart over a configurable date range.

- Threshold amber/red washes per type; RAG alert strip in the side panel
- CSV export; configurable date presets and freshness ticker

### Activity Report

Fetches the Medicus activity report for a configurable date range and renders period totals as a stacked horizontal bar chart broken down by staff member.

- Period totals per clinician and per metric; stacked, total, or single-metric view
- Configurable date presets; CSV export

### Referrals Tracker

Displays referral audit data drawn from Medicus, with breakdowns by specialty, clinician, priority, and status.

- Configurable priority and status filters; top-15 specialty chart
- Referrals activity overlay (submissions and referrals on the same timeline)
- Diagnostics panel for configuration troubleshooting

### Condor (Practice analytics)

A live analytics dashboard pulling from multiple Medicus data streams into eight metric cards.

- **PPI** (demand intensity), **Demand gap** (capacity minus demand), **Velocity** (task throughput), **Task age** (outstanding task age distribution)
- **Workload** (clinician-level load), **Waiting room** (arrived count and wait), **Day score** (configurable end-of-day score with manual entry), **Activity** (session activity count)

### Trends (Observation trends)

Displays sparkline charts of a patient's longitudinal observations for quick clinical context when the record is open.

- HbA1c, cholesterol, weight, blood pressure, eGFR, and albumin-creatinine ratio
- KDIGO stage grid (eGFR G-stage × ACR A-stage); BP targets derived from patient age and diabetes/CKD register status

### Reception

A reception-facing panel designed for non-clinical front-desk staff.

- **Patient status pill**: single green/amber/red indicator for the patient whose record is open; click to expand action-needed monitoring detail
- **Guided capture**: configurable question sets per presenting problem (sore throat, earache, adult cough, urinary symptoms, headache, low back pain, feverish child, rash, general) with Pharmacy First suitability hints. Red-flag questions come first; any YES shows an immediate 999 or duty-clinician escalation banner
- Output is a structured plain-text history block for copy-paste into the Medicus triage entry — the tool never triages, diagnoses, or advises beyond red-flag escalation
- All pathways ship disabled; a practice administrator must accept an explicit disclaimer before enabling any
- In-progress captures auto-save as a local draft (≤4 hours) with a timestamped Restore/Discard banner

### Knowledge

Practice-owned reference base for referral criteria, contacts, clinical pathways, and templates.

- Add, edit, search, and categorise reference entries; near-duplicate detection on save
- LLM-assisted starter-pack import (Options → Knowledge): paste structured JSON from an external LLM to pre-populate entries in bulk
- Expandable detail cards; keyword search; category filter

## In-page features (content scripts)

**Triage Lens — request queue** (all Medicus pages): overlays the patient request queue with semantic triage chips. Red = same-day or 999; amber = urgent; info = supplementary. 77+ built-in rules across chest pain, sepsis, stroke/TIA, anaphylaxis, obstetric emergencies, mental health crisis, paediatric red flags, 2WW cancer patterns, and common acute presentations. New built-in rules reach existing users automatically; rules deliberately deleted stay deleted.

**Triage Lens — investigation results queue** (Medicus Investigation Results filing queue): decorates each pending result row with per-row severity chips — Urgent (red, lab's own flag), N abnormal (amber, lab's above/below-reference flags), Under-prioritised (red, result severity exceeds assigned priority), and Unmatched patient (amber). User-authored analyte threshold rules and text-classification rules (e.g. MSU/urine culture) can escalate severity but can never lower or suppress a laboratory's own urgent or abnormal flag. 21 built-in result rules ship enabled; new custom rules arrive disabled and require clinician review before firing.

**Sentinel content script** (all Medicus pages): provides per-patient monitoring data to the Sentinel side-panel module. Also drives prescribing-safety combination chips (STOPP/START-style), QRISK3/QCancer/eFI risk-calculator signpost chips, and NHS Pharmacy First pathway hints on the patient record view.

**Pusher relay** (all Medicus pages): bridges real-time Medicus push events to the side panel so alert strips and the Today module update without polling.

**Referrals discovery** (all Medicus pages): detects the practice's Medicus referrals API endpoint and stores it for the Referrals Tracker.

## Alert engine

The rules engine evaluates patient data against seven rule types:

- **drug-monitoring**: drug X must have test Y within Z days. Fires overdue/due-soon/in-date chips with exact test names and intervals. 25 built-in rules covering lithium, methotrexate, azathioprine, ciclosporin, leflunomide, hydroxychloroquine, amiodarone, clozapine, and more
- **qof-register**: detects QOF register membership from active problems. 13 built-in registers (diabetes, CKD, hypertension, COPD, asthma, AF, CHD, heart failure, dementia, depression, mental health, palliative care, obesity)
- **qof-indicator**: evaluates a target (observation value, medication presence, or observation trend) against a QOF threshold. 48 bundled indicators covering the major QOF 2025/26 clinical domains
- **drug-combo**: flags clinically significant prescribing combinations (STOPP/START, PINCER-style). Age and sex filters; problem-list suppression. 22 starter alerts in the prescribing-safety library
- **event-count**: fires on presence or count of coded events (e.g. A&E attendances ≥3 in 12 months). Supports count/min/max operators
- **composite**: combines the results of other rules with AND/OR logic for complex multi-condition alerts
- **vaccine**: seasonal window rules; flu and COVID chips appear only during the active campaign period

Rules are practice-editable via a form-based editor in Options with a live engine preview against an editable test patient. An LLM-assisted authoring flow (copy prompt → external LLM → paste JSON → validate → import disabled) is available for custom rules.

## Settings & customisation

- **Practice Profile**: shared-folder managed deployment — a practice administrator can push config and rules to all seats from a single JSON on a shared drive
- **Backup / restore**: full suite-wide envelope export and import covering all modules and rule sets
- **Display preferences**: theme (light/dark/auto), size (compact/medium/large), and colourblind mode
- **Options**: per-module configuration including triage-lens system chips, result rule editing, reception pathway management, knowledge base starter import, and QOF submission thresholds

## Recent additions (last 4 weeks)

- **v3.78.0 (2026-06-14)** — Brand identity: first logo + visual mark (clinical pulse whose apex is the amber RAG status dot), built from the existing design tokens; regenerated extension icons; wired into the side panel, Options, About panel, and README
- **v3.77.3 (2026-06-14)** — Result rules settings: scope note, directional ↑/↓ glyphs on threshold rules, UX fixes from GP appraisal; deleting a built-in result rule now tombstones it so it is not silently re-added on config updates
- **v3.77.2 (2026-06-14)** — Four result rules enabled after Clinical Safety Officer sign-off: hypocalcaemia, hypomagnesaemia, high-TSH, suppressed-TSH; TSH rules suppress on coded thyroid diagnosis in the problem list
- **v3.77.1 (2026-06-14)** — Design-crit polish on Result rules settings: severity badges on every rule row, semantic badge colours, WCAG AA contrast, dark-mode fixes
- **v3.77.0 (2026-06-14)** — Four new built-in result rules added (shipped disabled pending CSO review): hypocalcaemia, hypomagnesaemia, high-TSH, suppressed-TSH
- **v3.76.1 (2026-06-14)** — Result-rule labels simplified to short clinical names; absent chip explicitly stated as not an all-clear; tooltips added to built-in and Unreviewed badges
- **v3.76.0 (2026-06-13)** — Six new built-in investigation result rules: high lithium, high digoxin, critical low potassium, high adjusted calcium, low eGFR (CKD G4), and blood culture text rule
- **v3.75.3 (2026-06-13)** — Shipped-config version lock enforced in CI; prevents silent config drift when defaults change without a version bump
- **v3.75.2 (2026-06-13)** — Fix: config changes from v3.75.0 never reached existing users; migration now retires stale chip labels and appends the bowel-screening result rule

## Safety posture

Medicus Suite is a passive display tool. It reads data already present in Medicus and presents it in the browser — it writes to no patient record, performs no AI inference, transmits no patient data to any external service, and makes no clinical decisions. All computation happens locally in the extension. See INTENDED-PURPOSE.md.
