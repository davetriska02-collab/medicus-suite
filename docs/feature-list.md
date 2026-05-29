# Medicus Suite — Feature List

**Version:** v3.4.1
**Generated:** 2026-05-29 (automated)

## What it is

Medicus Suite is a Chrome extension for GPs and practice staff using the Medicus (Doctolib) electronic patient record. It adds a persistent side panel alongside the Medicus web interface, surfacing live appointment data, per-patient clinical monitoring alerts, referrals analytics, workload figures, and a capacity calendar — all drawn from data already in Medicus. The extension reads; it never writes to the record. No AI inference, no external data transmission, no installation on clinical systems.

## At a glance

- 6 side-panel modules: Slots, Monitoring, Capacity, Submissions, Referrals, Activity
- Full-tab Patient Record Visualiser (opens from the About tab)
- 4 in-page overlay features (Triage Lens, Sentinel engine, Referrals Discovery, Pusher relay)
- 7 rule types in the patient alert engine
- 22 bundled starter alerts in the library (prescribing safety + clinical review)

## Side-panel modules

### Slot Counter

Shows today's available appointments broken down by appointment type and clinician. An AM/PM chip splits the daily total so it is immediately clear whether morning or afternoon capacity remains. Individual appointment types (e.g. internal admin slots) can be suppressed. Configurable per-type thresholds fire an amber or red alert ribbon when a slot count reaches or falls below the threshold — useful for monitoring GP urgent or same-day capacity without opening the full schedule.

- Live available-slot count from the Medicus scheduling API
- Breakdown by appointment type and clinician, expandable rows
- AM / PM split on every total and breakdown row
- Per-type amber/red threshold alert ribbon
- Hidden-types preference persisted across sessions
- Pusher-triggered instant refresh when bookings change

### Monitoring (Sentinel)

Evaluates the currently open patient against a configurable set of clinical rules and displays the results as colour-coded chips. Covers drug-monitoring intervals, QOF 2025/26 indicators, and prescribing-safety combinations. Every chip is clickable and opens an evidence panel inline, showing exactly which data triggered the alert — the matched medication, the specific test result, value, date, and threshold. A waiting-room section at the top shows patients currently waiting and flags when new medical or admin requests arrive.

- Drug-monitoring chips: in-date / due-soon / overdue / severely overdue status per medication
- QOF indicator chips: met / not-met with recorded value and date
- Prescribing safety chips: drug-combo, event-count, and composite rule types
- Observation-trend chips (rising or falling series)
- Click-to-expand evidence panel per chip, in-line (no modal)
- Composite sub-rule drill-through in evidence view
- Live waiting-room count and demand flags (amber/red)
- 10-second poll; refreshes instantly on patient navigation
- Custom rules via the Monitoring options page — all seven rule types supported

### Capacity Forecast

A calendar view of appointment capacity across days, weeks, or months. User-defined presets set per-weekday minimum targets; each calendar cell is colour-coded (sufficient / tight / low / critical / closed) based on the live slot count against the minimum. Multiple named presets support different clinic configurations. Useful for scanning whether the coming week has sufficient slots before responding to patient requests or booking sessions.

- Week and month calendar views, navigate forward and backward
- Per-weekday minimum targets with multiple named presets
- Traffic-light colouring: sufficient / tight / low / critical / closed
- Historical dates shown as "Past"
- Presets included in suite backup and restore

### Submissions Tracker

Displays the practice's medical and admin submission queue volumes by task type, with a comparison chart across a selected date range. Configurable RAG thresholds turn each task-type tile amber or red when the day's count reaches a threshold. A global demand strip at the top of the panel mirrors the amber/red state on every tab so the submissions load is always visible regardless of which module is open.

- Today's totals: medical, admin, investigation, routine Rx, non-routine Rx
- Per-type RAG thresholds, independently enable/disable
- Date-range trend chart
- Global demand strip on all panel tabs
- Auto-refresh polling; manual refresh button

### Referrals Tracker

Shows outbound referrals with breakdowns by clinician, specialty, and receiving hospital. Stacked bar charts and summary tiles cover the selected date range. Real-time filter chips for priority (Routine / Urgent / 2WW) and status (Completed / Incomplete / Cancelled) re-aggregate the charts without a re-fetch. A referral rate chart shows referrals as a proportion of consultations per clinician for workload benchmarking.

- Summary card: total referrals with priority tile breakdown
- Charts by clinician, specialty, hospital — expandable beyond top 15
- Real-time priority/status filter chips
- Rate chart: referrals ÷ consultations per clinician
- Date range with period presets
- CSV export of all raw referral rows
- Clinician name search filter; staleness indicator with inline Refresh

### Activity Report

Shows aggregated staff activity for a selected date range, broken down by task type and clinician. Stacked horizontal bar charts show where workload is concentrated by role. Date range configurable with presets; refreshes automatically when the practice code changes.

- Activity totals by task type and clinician
- Stacked bar chart, switchable to a single task type
- Configurable date range (today, this week, custom)

## Patient Record Visualiser (full tab)

Opens as a separate browser tab. Accepts a Medicus EPR export PDF and builds a six-tab clinical dashboard entirely within the browser — no data is uploaded or transmitted.

- **Snapshot**: demographics, active and past problems, what's new since last consultation, eFI (Electronic Frailty Index) gauge, PINCER-style prescribing safety flags, open recalls
- **Continuity**: UPC and Bice-Boxerman indices, practitioner bar chart, colour-coded ribbon showing care fragmentation or continuity over time
- **Timeline**: D3 swim-lane with one lane per entry type, click-to-spotlight by problem, hover tooltips per event
- **Investigations**: sortable/filterable analyte table, inline sparklines, RCV delta flags, clinical zone bands (eGFR KDIGO stages, HbA1c targets, BP staging), full trend chart per analyte
- **Medications & Monitoring**: 14 high-risk drug families detected by text scan; per-drug last monitoring date and overdue badge against NICE/BNF intervals; PINCER flags
- **Registers & Recalls**: QOF register auto-detection from problem list, last-review date and overdue badge per register, open/completed/cancelled recall summary

## In-page features (content scripts)

All content scripts activate on Medicus pages only and do not operate on any other website.

### Triage Lens

Overlays a colour-coded HUD on the Medicus consultation queue. Each patient row is scored by clinical complexity signals: high-risk medications (methotrexate, lithium, anticoagulants), active care plans, ACP documentation, frailty deficit count, and coded problem flags. Queue items receive a triage chip so clinicians can visually assess complexity before opening each request. Chip thresholds, which signals to include, and colour mappings are all configurable in Triage Lens settings.

### Sentinel engine

Runs the alert engine in the background of each Medicus patient page. Extracts medications, latest observations, observation history, and the active problem list; evaluates all configured rules; and pushes the resulting chip snapshot to the side panel. Triggered by patient navigation (SPA route changes), not page reloads. No patient data is stored beyond the current browser session and none leaves the browser.

### Referrals Discovery

Passively captures the referrals API endpoint URL as the clinician browses Medicus. The URL is stored locally and used by the Referrals Tracker module to fetch referral data without requiring manual API URL configuration. Operates silently with no visible UI.

### Pusher relay

Listens for real-time Pusher events on the Medicus page (appointment bookings, waiting-room updates) and relays them to the extension service worker, which forwards them to the Slot Counter and Monitoring modules. This is what makes the Slot Counter refresh instantly when a booking is made, rather than waiting for the next scheduled poll.

## Alert engine

The alert engine evaluates the current patient's extracted record against a configured rule set and produces a chip for each rule that fires. Seven rule types are supported:

**Drug monitoring** — fires when a patient is on a named medication and the most recent monitoring test is overdue by a configurable interval. Supports sex, age, and problem-list filters. Used for methotrexate (FBC/LFT/U&E every 3 months), lithium (U&E/TFT/Li level), warfarin (INR), levothyroxine (TSH), and any custom drug. Statuses: in-date, due-soon, overdue, severely overdue (> 2× interval).

**QOF register** — fires when the patient's problem list contains a code matching a QOF disease register (diabetes, COPD, CKD, AF, and others), confirming register inclusion. Used by QOF indicator rules as a precondition check.

**QOF indicator** — checks whether a clinical target for a register patient has been achieved. Four check kinds: observation recent (e.g. BP recorded within 12 months), observation threshold (e.g. HbA1c ≤ 58 mmol/mol), medication present (e.g. on a statin), and observation trend (e.g. HbA1c rising). Evaluates within the current QOF year (1 April – 31 March) or a configurable rolling window.

**Drug combination** — fires when a patient is concurrently on drugs from two or more named sets, with optional age, sex, and problem filters. Covers PINCER prescribing-safety patterns: NSAID + anticoagulant, beta-blocker in asthma, ACEi/ARB without monitoring, QTc-prolonging combinations, and others. A `mustNotBePresent` field supports "drug X without drug Y" patterns (e.g. NSAID without a PPI). Chip label reads ALERT / CAUTION rather than time-based OVERDUE wording.

**Event count** — fires when the number of matching coded events (problems or historical observations) within a configurable time window exceeds a threshold. Covers patterns like "≥3 UTIs coded in 12 months" (female, age < 65) or "≥2 falls in 12 months" (age ≥65).

**Observation trend** — fires when successive observations move in a named direction (rising or falling) by at least a configurable delta within a lookback window. Used for rising PSA, falling eGFR, and similar longitudinal flags. Requires at least a configurable minimum number of data points.

**Composite** — combines two or more other custom rules via AND or OR logic and fires when the combination is satisfied. Sub-rule results are displayed individually in the evidence panel with clickable drill-through to each sub-chip's own evidence.

### Bundled alert library

22 ready-to-use starter alerts sourced from published guidelines (PINCER, NICE, MHRA). Categories: Prescribing safety (19 alerts), Clinical review (3 alerts). Alert types covered: drug-combo (13), drug-monitoring (5), event-count (2), composite (1), QOF indicator (1). The library is gated behind a one-time acknowledgement screen that explains these are templates to be reviewed, not clinically validated rules, before use.

## Settings & customisation

- **Practice Profile**: drop a `practice-profile.json` file into the extension folder to push default settings to every PC at a practice — three apply modes (merge-missing, force-override, first-run-only). Settings → Backup includes a profile generator and manual apply/check controls.
- **Backup / restore**: full suite backup and restore via a JSON envelope covering all modules, custom rules, presets, and thresholds. Per-module export also available.
- **Display preferences**: light/dark theme, small/medium/large text, and colour-blind mode (replaces red/green with orange/blue throughout). Applied live across the side panel, pop-out, visualiser, and settings pages.
- **Pop-out window**: any module can be opened in a free-floating browser window, useful on a second monitor. Position and size are persisted.
- **Feedback**: the About tab includes a form to send feedback, feature requests, or bug reports by email — no account or backend required. Suite version, browser, and timestamp are appended automatically.

## Recent additions (last 4 weeks)

- **v3.4.0–3.4.1 (2026-05-29)** — Feedback / feature request / bug report form in the About tab; configurable recipient email per practice.
- **v3.3.0 (2026-05-29)** — Clinical Safety settings tab with direct links to the safety case documents (Intended Purpose, Safety Notice, Hazard Log, Disclaimer & Terms).
- **v3.2.0–3.2.5 (2026-05-28–29)** — Clickable chip evidence panels showing the exact data that fired each alert; alert wording for non-time-based rules corrected to ALERT / CAUTION; "STALE" label renamed to "SEVERELY OVERDUE"; evidence panel theme-awareness fixed.
- **v3.1.4–3.1.8 (2026-05-28)** — Applicability filters (sex, age, problem-list) now enforced for all rule types; bundled library rules tightened; alert library acknowledgement gate added; multiple reliability and XSS fixes from a 6-agent code review.
- **v3.0.0–3.1.0 (2026-05-28)** — Alert Builder: three new rule types (drug-combo, event-count, composite), observation-trend check kind, multi-point observation history extractor, 22-alert starter library, and full Alert Builder UI.
- **v2.5.0 (2026-05-28)** — Practice Profile: shared-folder managed deployment for practices with multiple PCs.
- **v1.8.0 (2026-05-22)** — Patient Record Visualiser rebuilt: D3 swim-lane timeline, eFI gauge, PINCER flags, RCV delta columns, clinical zone bands, sortable/filterable investigation tables, global date-range filter brush.

## Safety posture

Medicus Suite is passive display software. It reads data already present in the Medicus interface; it does not write to the patient record, does not transmit patient data to any external server, and uses no AI or machine learning to generate clinical recommendations. All patient data is processed locally within the browser and discarded when the tab closes. The extension is built and maintained by a single GP developer on a best-effort basis. It is a supplementary display aid, not a regulated medical device, and not a substitute for clinical judgement or the live record. A clinical safety case is maintained — see `docs/INTENDED-PURPOSE.md`, `docs/CLINICAL-SAFETY-NOTICE.md`, `docs/HAZARD-LOG.md`, and `docs/sentinel-DISCLAIMER.txt` for the full documentation.
