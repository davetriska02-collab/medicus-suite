# Medicus Suite — Feature List

**Version:** v3.64.0
**Generated:** 2026-06-13 (microbiology text-classification result rules)

## What it is

Medicus Suite is a Chrome browser extension for UK GP practices that runs alongside the Medicus electronic patient record system. It adds a side panel and optional on-page overlays to surface monitoring alerts, demand data, appointment capacity, and clinical decision prompts directly within the Medicus interface. All processing happens locally in the browser; no patient data is transmitted to any external service, no record is written to, and no clinical inference is performed — everything shown is derived from data already present in Medicus.

## At a glance

- 12 side-panel modules covering monitoring, demand, capacity, workflow, and reference
- First-run onboarding: guided tour, setup checklist, and a Ctrl+K command palette
- 4 in-page content-script features (on-screen overlays and relays)
- 6 rule types in the alert engine
- 22 bundled starter alerts in the prescribing-safety library (PINCER/NICE-based)

## Side-panel modules

### Today (Morning command centre)

The default tab. One glance answers "what does today look like?" — each card deep-links to its module:

- **Waiting room**: live arrived-patient count with max-wait colouring (amber ≥10 min, red ≥20)
- **Triage load**: the four request-monitor bucket counts (when the triage monitor is configured)
- **Demand today**: medical and admin task counts against the practice's thresholds
- **Slots remaining**: live available-slot count for today
- **Morning sweep**: last sweep summary (time, action-needed count) or a prompt to run it
- **Recent alerts**: the last few operational alert events (counts and labels only — never patient identifiers), so a clinic-mode-muted hour stays reviewable

### Sentinel (Monitoring)

Sentinel is the core per-patient alerting module. When a patient record is open in Medicus, it evaluates the practice's monitoring rules against that patient's medications, observations, problems, and vaccination history, and displays colour-coded chips for anything overdue, due soon, or not achieved.

- Drug-monitoring chips show which specific blood tests are overdue and by how long, with the monitoring interval and source citation
- QOF indicator chips flag register members whose targets are not met or approaching the threshold
- Vaccine chips reflect seasonal campaign windows — flu and COVID chips only appear during the active season
- A collapsible **Brief** card at the top gives a 30-second risk summary: patient line, red/amber counts, and the four highest-priority signals
- **Action Packs**: each actionable chip carries copy-ready text — blood form with only overdue tests listed, recall SMS (≤320 characters), escalation SMS, letter, and task line for admin
- **Appointments needed** button generates a plain-text booking instruction for admin, for pasting into a Medicus internal message without narrating each item verbally. Patient actions (Appointments, Copy actions, Print summary, More) sit in a labelled bar directly under the Brief
- **Print patient summary** opens a Patient Passport: a plain-English (reading age 9–11) summary of what monitoring is due and what key numbers mean, for handing to the patient in the room
- Dismissed chips resurface automatically if their status escalates (an overdue chip cannot stay permanently hidden when it becomes severely overdue)
- A "Meds without a monitoring rule" audit view shows medications not matched by any enabled rule, so brand-coverage gaps are visible rather than silent

### Sweep (Pre-clinic sweep)

Sweep runs the same monitoring rules as Sentinel across all patients booked in today's appointment book — before clinic starts. It produces a worst-first worklist so overdue bloods and recalls can be arranged before the GP sees the patient.

- Manual trigger only; large practices are processed in batches of 40 with a "Check next N" button
- Clinician filter: sweep one clinician's list or the whole practice
- Per-patient API failures render explicitly — a patient with partial data cannot appear as clear
- **Print reception handout** produces a tick-box worklist for the receptionist with plain-English booking instructions per patient (blood tests, check-ups, reviews, or flag to duty clinician), deduplicated and sorted by appointment time
- **Resume last sweep**: the last run (including batch selections) survives tab switches for up to 2 hours, with the run time shown so staleness is visible; re-run rather than resume when currency matters

### Reception

A reception-facing panel designed for non-clinical front-desk staff:

- **Patient status pill**: single green/amber/red indicator for the patient whose record is open; click to expand action-needed monitoring detail
- **Guided capture**: configurable question sets per presenting problem (sore throat, earache, adult cough, urinary symptoms, headache, low back pain, feverish child, rash, general) with Pharmacy First suitability hints. Red-flag questions come first; any YES immediately shows a 999 or duty-clinician escalation banner. Output is a plain-text structured history block for copy-paste into the Medicus triage entry. All pathways ship disabled — a practice administrator must accept an explicit disclaimer before enabling any
- Practices can edit bundled pathways and author custom ones in Options
- Tile grid is organise-able: colour-code, drag-and-drop reorder, or A–Z sort
- In-progress captures auto-save as a local draft (≤4 hours, cleared on generate/discard) with an explicit time-stamped Restore/Discard banner — a mid-call tab switch no longer wipes the form

### Triage Lens

The Triage Lens overlays the Medicus request queue with semantic triage chips. Chips are red (same-day or 999), amber (urgent or soon), or info-level. The engine applies pattern-matching rules against the request text.

- 77+ built-in rules across clinical domains including chest pain, sepsis, stroke/TIA, anaphylaxis, obstetric emergencies, mental health crisis, paediatric red flags, 2WW cancer patterns, and common acute presentations
- Chips are severity-ordered: red chips always appear before amber, amber before info
- New rules added since the last stored config are merged in automatically — existing users receive new builtins without a destructive reset, and rules they deliberately deleted stay deleted
- An LLM-assisted authoring flow (copy prompt → external LLM → paste JSON → validate → import) is available for authoring custom rules
- **Investigation Results queue triage (v3.62.0):** on the Medicus Investigation Results filing queue each pending row is decorated with per-row severity chips — **Urgent** (red, lab's own `requiresUrgentReview` flag), **{n} abnormal** (amber, lab's own above/below-reference-range flags), **Under-prioritised** (red, result severity exceeds the row's assigned priority), and **Unmatched patient** (amber). Chips are a prioritisation aid only: there is deliberately no "all normal / safe to file" chip, the extension applies no clinical thresholds of its own, and no result is ever filed or changed automatically. Fail-silent on fetch error.
- **Per-chip enable and colour (kind) configuration:** each result-queue chip can be individually enabled or disabled and its colour (severity kind: red/amber/info) adjusted via the systemChips editor in Options, so practices can tune salience to local workflow.
- **User analyte-threshold rules (v3.63.0):** clinicians can author rules that escalate result severity for specific analytes (e.g. "Potassium ≥6.0 → red"). Rules are escalate-only — they can raise a chip to amber or red but can never lower or suppress the laboratory's own urgent or abnormal flags; the engine always takes the more-severe of lab-flag vs user-rule. Rules are validated on save/import. Imported rules (including LLM-generated rules) and manually-authored rules ship **disabled** and must be reviewed and enabled by a clinician before they fire. An **LLM single-rule build** tool is provided (copy prompt → paste JSON into external LLM → paste reply back → validate → import disabled), mirroring the Sentinel/Triage Lens custom-rule authoring flow. A manual rule editor is also available in the Triage Lens settings.
- **Microbiology text-classification rules (v3.64.0):** for culture results (e.g. MSU / urine culture) that carry no numeric high/low lab flag, a new **"text" rule kind** matches on result text rather than analyte values. A built-in MSU/urine-culture rule ships **enabled**: it flags any matched culture **"Needs review"** (amber chip) unless the combined result text (result value + interpretation + lab comments) contains a configured normal phrase such as "No growth", in which case it shows a calm **"No growth" info chip** instead. The info chip asserts a negative culture from the actual result text — it is not a safe-to-file verdict; clinicians should remain alert to sterile pyuria and "no significant growth — repeat if symptomatic" edge cases. The built-in normal-phrase list is conservative and clinician-editable. User-authored text rules (manual or LLM-imported) arrive **disabled** and require clinician review before firing. Matching is case-insensitive substring against the result name (to identify cultures) and the combined result text (to find the normal phrase). Escalate-only: text rules can only raise severity or add an info chip; they cannot lower or suppress any lab urgent or abnormal flag.

### Trends

Displays sparkline charts of a patient's longitudinal observations for quick clinical context: HbA1c, cholesterol, weight, blood pressure, eGFR, and albumin-creatinine ratio (ACR/KDIGO stage grid).

- Charts pull from the extracted observation history for the current patient
- eGFR chart shows the KDIGO risk grid and monitoring frequency recommendation
- BP chart shows target bands and whether the most recent reading meets target

### Condor (Live operations dashboard)

A live operational dashboard for the practice, updating automatically:

- **PPI score** (Practice Pressure Index): a composite daily demand score
- **Demand gap**: task backlog vs available capacity; **Velocity**: task clearance rate
- **Task age**: inbox age distribution (integrates with the Request Monitor)
- **Workload**: per-clinician task counts; **Waiting room**: current patient count
- **Day score**: end-of-day performance rating, saveable for trend analysis

### Slots (Slot Counter)

Displays live appointment slot availability from the Medicus scheduling API for any selected date. Slots are grouped by type; types can be hidden. Configurable amber/red alert rules trigger when slot counts fall below practice-defined thresholds.

### Capacity (Capacity Forecast)

A calendar view showing daily available appointment capacity against user-defined minimum thresholds, coloured green/amber/red/critical. Supports daily, weekly, and monthly views.

### Submissions (Submissions Tracker)

Tracks task and submission counts by type (medical requests, admin, investigations, prescriptions) for a configurable date or range, with configurable amber/red thresholds and a stacked bar chart. Useful for monitoring request volumes at a glance.

### Activity

Fetches and displays the Medicus activity report for a configurable period, broken down by staff member. Rendered as period totals and a stacked horizontal bar chart.

### Referrals

Fetches and displays referral audit data from Medicus: total count, specialty breakdown, clinician breakdown, priority (routine/urgent/2WW) and status (completed/incomplete/cancelled) filters, and a chart view.

### Knowledge

A practice-owned searchable reference base for referral criteria, key contacts, local pathways, and templates. Reference material only — not clinical decision support.

- Add/edit/search cards directly on the tab
- Near-duplicate detection surfaces similar existing entries as you type a title, to avoid bloat
- LLM starter-pack in Options: copy a prompt, paste the JSON reply back, validate, and import. AI-generated entries are badged "Unreviewed" until a human marks each one reviewed
- Cards carry an optional review-by date; expired ones show a "Review due" badge
- Backup/restore via the suite-wide envelope

## In-page features (content scripts)

These run in every Medicus tab at page load and do not require the side panel to be open.

**Triage Lens** (`content.js` + `page-world.js`) — Active on all `*.medicus.health` pages. Overlays the triage queue with colour-coded semantic chips based on pattern matching against request text. On the patient record view it also surfaces STOPP/START-style prescribing combination prompts, a risk-tool signpost chip (links to QRISK3/QCancer/eFI calculators — computes no score), and Pharmacy First signposting.

**Sentinel** (`sentinel.js`) — Runs the monitoring rules engine on every patient record page and publishes the chip snapshot to the side panel. Shows an amber drift-detection banner if extraction quality degrades, so "no alerts" is distinguishable from "extraction may have missed data."

**Referrals Discovery** (`referrals-discovery.js`) — Passively discovers the referral data endpoint from the current Medicus page and caches it for the Referrals module.

**Pusher Relay** (`pusher-relay.js`) — Relays real-time demand events (waiting-room counts, new-request notifications) to the side panel, powering the three global demand strips and the Condor waiting-room card.

## Alert engine

The rules engine evaluates patient data against six rule types:

- **drug-monitoring** — Flag when a drug's required blood test or clinical check is overdue (configurable interval, overdue window, due-soon window, recent-initiation grace period). Supports test-name matching and SNOMED code lookup
- **qof-register** — Confirm whether the patient's active problems place them on a QOF register (e.g. diabetes, hypertension, CKD). Register membership gates indicator evaluation
- **qof-indicator** — Threshold check against a recent observation or medication record. Sub-kinds: observation-threshold (numeric value vs target), observation-recent (done in the QOF year?), medication-present (drug prescribed?), medication-all-of (all drug classes present — used for HFrEF four-pillar therapy), observation-bundle (a set of care processes all must be done — used for DM037)
- **drug-combo** — Detect concurrent medications matching two or more drug sets (PINCER/STOPP pattern). Supports age and sex gates, mustNotBePresent (gastroprotection detection), and problem-based requires/excludes
- **event-count** — Count coded events over a rolling window and alert when the count crosses a threshold
- **composite** — Combine any of the above rules with AND or OR logic, enabling complex multi-condition alerts

## Settings and customisation

- **Practice Profile** — A `practice-profile.json` file in a shared folder is applied to every PC on a 15-minute cycle. Practice managers can push module configuration (merge to fill gaps, or enforce practice-wide) without touching individual installs. Also handles self-updating: new extension files dropped in the shared folder cause each PC to reload when next idle
- **Backup / restore** — A suite-wide envelope captures all module configuration into a single signed JSON file for export and restore
- **Display preferences** — Light/dark theme, three text sizes, and a colour-blind mode (from the side-panel toolbar)
- **Custom monitoring rules** — Five rule types in the Sentinel custom-rule builder, with a live test-patient preview
- **Tab order** — Drag-and-drop reordering of side-panel nav tabs; order persists and is shared with the pop-out window
- **Command palette** — Ctrl+K anywhere in the panel or pop-out: jump to any tab, switch theme/text size, open a specific settings section, replay the tour, or start clinic mode
- **Guided tour & setup checklist** — versioned first-run walkthrough (returning users see only what's new) plus a setup card that detects the practice code, tests connectivity, and requests the notification permission
- **Notifications & clinic mode** — one settings section for every alert channel; clinic mode temporarily mutes desktop pop-ups and sounds only (strips, badges and clinical alerts are never muted), with a visible 🔕 pill and automatic expiry
- **View-state continuity** — the panel reopens on your last tab, and modules remember filters, date ranges and searches for 24 hours per workstation

## Recent additions (last 4 weeks)

**User experience and onboarding (v3.57.0–v3.60.0, 2026-06-12)**

- **v3.60.0** — Five-workstream UX release: view-state continuity, reception drafts + resumable sweep, first-run setup checklist, Today tab, consolidated notifications + clinic mode
- **v3.59.0** — Command palette (Ctrl+K) with options deep-linking
- **v3.58.x** — Suite-wide first-run walkthrough; Monitoring action bar moved under the Brief; CI guard keeping the tour in lock-step with the UI
- **v3.57.0** — Monitoring header/action toolbar, panel re-render flicker fix, guided tour v1

**Clinical safety and rules**

- **v3.54.0 / v3.51.3 (2026-06-11)** — The Keeper clinical-currency passes: completed the UK systemic NSAID, VKA (acenocoumarol, phenindione), ACEi/ARB, and diuretic drug sets across both the active triage engine and the patient record visualiser; 28 of 36 documented parity divergences resolved
- **v3.52.0 (2026-06-11)** — DKA/HHS now fires a red chip (same-day/999) separately from routine diabetes amber chips; clinical-letter curly-quote normalisation so patterns match regardless of source punctuation; threshold rules now fail closed on non-numeric inputs
- **v3.51.0 (2026-06-10)** — New SMR tab in the patient record visualiser: ACB anticholinergic burden scoring (Boustani scale), STOPP/START v3 (2023) flags for 13 criteria, and a printable NHS DES-aligned SMR documentation skeleton
- **v3.47.0 (2026-06-10)** — Vaccine schedule expanded (pneumococcal PPV23, shingles/Shingrix, RSV); QOF HF009 enabled (HFrEF four-pillar therapy); HRT IUS cover now only counted within the device's 5-year licensed life

**New features**

- **v3.50.0 (2026-06-10)** — Patient Passport: one-click printable plain-English health summary for the patient
- **v3.49.0 (2026-06-10)** — Pre-Consultation Brief: collapsible risk-summary card at the top of the Sentinel panel
- **v3.48.0 (2026-06-10)** — Action Packs: copy-ready blood forms, recall SMS/letters, escalation SMS, and task lines per chip
- **v3.47.0 (2026-06-10)** — Per-patient evaluation audit trail with exportable JSON log for DCB0129/0160 assurance
- **v3.42.0 (2026-06-10)** — Knowledge tab: new practice-owned reference base with near-duplicate detection and LLM starter-pack import

**Practice operations**

- **v3.46.0 (2026-06-10)** — Triage Lens expanded by 52 new rules: 17 red (stroke/TIA, sepsis, anaphylaxis, obstetric emergencies, paediatric red flags), 27 amber (2WW cancer patterns, DKA/HHS, perinatal mental health, contraception), 8 info
- **v3.44.0 (2026-06-10)** — Sweep printable reception handout: appointment-time-ordered tick-box worklist with plain-English booking instructions for non-clinical staff
- **v3.43.0 (2026-06-10)** — Practice Profile v2: push configuration from a shared folder to every practice PC, with self-updating extension deployment and a one-click publish UI

## Safety posture

Medicus Suite is passive display software. It reads data already present in Medicus, processes it locally in the browser, and shows the result to a clinician. It does not write to any patient record, does not transmit patient data to any server, performs no AI inference, and makes no clinical decisions. All alerts are prompts to review, not recommendations to act. See `docs/INTENDED-PURPOSE.md` for the full intended-purpose statement and `docs/CLINICAL-SAFETY-NOTICE.md` for documented limitations.
