# Medicus Suite — Feature List

**Version:** v3.31.2  
**Generated:** 2026-06-07 (automated)

## What it is

Medicus Suite is a Chrome side-panel companion for the Medicus electronic patient record system, built for UK GP practices. It works alongside Medicus in the browser, surfacing appointment demand, capacity, QOF and drug-monitoring status, clinical trends, referral audits, and activity reports without interrupting the clinical workflow. When a patient record is open it surfaces monitoring alerts, prescribing-safety prompts, and observation trend charts drawn from data the clinician already has access to. It is a passive display tool: it never writes to the record, never makes clinical decisions, and processes all patient data locally in the browser.

## At a glance

- **9 side-panel modules** — Slots, Capacity Forecast, Submissions, Monitoring (Sentinel), Activity, Referrals, BP Trend, Renal Monitoring, Observation Trends
- **4 in-page features** — Triage Lens queue overlay, Sentinel monitoring, Referrals discovery, live Pusher demand updates
- **7 rule types** in the alert engine
- **22 bundled starter alerts** in the importable library (prescribing safety and clinical review)

## Side-panel modules

### Slot Counter
Fetches live appointment slot availability from the Medicus scheduling API for any date. Displays available slots broken down by appointment type, with configurable threshold alerts.

- Live slot count per appointment type for any selected date
- Configurable amber/red threshold alerts by appointment type
- Type filter to hide irrelevant session types
- Polls on load; manual refresh available

### Capacity Forecast
A calendar view of appointment capacity against user-defined daily minimums. Shows each date as Sufficient / Tight / Low / Critical / Closed at a glance.

- Day, week, or month calendar modes
- Per-weekday minimum slot thresholds
- RAG status (Sufficient to Critical) against configurable minimums
- Appointment-type presets; weekends toggleable
- Named presets for quick switching

### Submissions Tracker
Displays QOF and enhanced service submission task counts, drawn from the Medicus task API. Compare today against a previous date, or view a date range.

- Task counts by type: Medical, Admin, Investigation, Routine Rx, Non-routine Rx
- Today view, date comparison, and date-range modes
- Configurable amber/red thresholds for Medical and Admin queues
- Global demand strip in the panel header warns when thresholds are crossed

### Monitoring (Sentinel)
The clinical heart of the suite. When a patient record is open in Medicus, this tab shows a set of chips — colour-coded cards — representing drug-monitoring recall status, QOF indicator achievement, vaccination eligibility, and prescribing-safety alerts for that patient. Evaluation runs in real time against data extracted from the current record.

- Drug-monitoring chips for lithium, methotrexate, DMARDs, antipsychotics, anticonvulsants, ACE inhibitors, statins, ADHD medications, carbamazepine, and more, with overdue/due-soon/in-date/stale status and last-checked evidence
- QOF indicator chips (HbA1c, BP, lipids, eGFR, smoking status, diabetes care processes) for patients on relevant disease registers
- Vaccination eligibility chips (flu, COVID) derived from age, QOF registers, current medications, and recorded problems per JCVI/UKHSA 2025/26 seasonal criteria
- Prescribing-safety chips: NSAID+anticoagulant (GI bleed risk), triple whammy (NSAID+ACEi/ARB+diuretic, AKI risk), benzodiazepine/Z-drug in patients aged 80 or over (falls risk)
- Observation safety alerts: hyperkalaemia (amber 5.5–5.9, red 6.0+ mmol/L), rising HbA1c trend, falling eGFR trend (NICE NG203)
- Per-chip expand view showing evidence (observation values, dates, sources)
- Per-chip dismiss (permanent) or snooze (vaccine chips snooze until season start and auto-resurface)
- Global amber banner if the record cannot be read, prompting the clinician to check directly in Medicus
- Custom alert builder (five rule types) with live engine-backed preview; importable starter library of 22 PINCER/clinical rules
- Filter chips by status: All / Action needed / Clear

### Activity Report
Shows practice activity data for a configurable date range, drawn from the Medicus reporting API.

- Period totals for consultations, home visits, calls, and other activity types
- Stacked horizontal bar chart broken down by clinician
- Presets: today, yesterday, last 7 days, last 30 days, custom range
- Toggle between stacked overview and single-metric drill-down

### Referrals Tracker
Displays referral audit data for a configurable date window, aggregated by specialty, clinician, priority, and status.

- Referral counts by priority (Routine, Urgent, 2WW) and status (Completed, Incomplete, Cancelled)
- Charts switchable between by-clinician and by-specialty views
- Top-N specialty and clinician breakdowns
- Date presets: last 3 months, 6 months, 12 months, custom range
- Priority and status filters

### BP Trend
Shows a patient's blood pressure history as a dual-line chart (systolic and diastolic), with a target line derived from the patient's QOF register membership.

- Systolic and diastolic lines over the full available history
- Condition-specific target lines (CKD+ACR above 70: 130/80; HYP aged 80 or over: 150/90; standard: 140/90)
- AT TARGET / ABOVE TARGET status pill
- Paediatric caveat: adult targets shown; centile charts required for accurate under-18 assessment

### Renal Monitoring
Shows ACR and eGFR history with KDIGO staging.

- ACR history with A1/A2/A3 KDIGO threshold band shading
- eGFR co-display with G-stage bands
- KDIGO G x A monitoring frequency cell (recommended checks per year)
- Action banners for ACR 70 or above (referral threshold), ACR doubling, and category crossing

### Observation Trends
Plots serial readings for HbA1c, total cholesterol, and weight. Display only — no clinical thresholds or target zones.

- Selectable metrics: HbA1c (mmol/mol), Total Cholesterol (mmol/L), Weight (kg)
- Latest reading, change arrow, reading count and date range
- Look-alike exclusions (e.g. cholesterol excludes HDL/LDL/ratio/non-HDL)
- Passive display only: no thresholds, interpretation text, or advice rendered

## In-page features (content scripts)

These activate automatically on Medicus pages.

**Triage Lens** — activates on any Medicus page. In the task/appointment queue it adds a structured overlay alongside each patient row with triage flags. On the patient record view it additionally surfaces:

- Prescribing-safety review prompts: NSAID+anticoagulant, triple whammy, benzodiazepine/Z-drug in patients aged 80 or over
- NHS Pharmacy First pathway signposting for all 7 clinical pathways (UTI, sore throat, otitis, sinusitis, impetigo, insect bite, shingles) with eligibility notes and red-flag safety-netting
- Risk-tool signpost chip: one-click links to QRISK3, QCancer, and eFI calculators (no score is computed by the extension)
- 20 built-in triage detection rules with 620+ lay and clinical match patterns

**Sentinel** — activates on any Medicus patient record page. Extracts medications, observations, problems, and demographics from the record and evaluates the configured rules; results appear in the Monitoring tab.

**Referrals Discovery** — detects the practice-specific API endpoint required by the Referrals Tracker.

**Pusher Relay** — relays live Pusher demand-update events to the side panel, keeping waiting-room and new-request counts current without polling.

## Alert engine

The Sentinel engine evaluates seven rule types against the patient's extracted data:

### drug-monitoring
Matches prescribed medications by generic name or UK brand name, then checks whether required monitoring tests have been done within the configured interval. Returns overdue / due-soon / in-date / stale / recently-initiated status. Supports age and sex gating and SNOMED test codes.

### qof-register
Derives register membership from the problem list using configurable match and exclude terms. The resulting on-register status gates which indicator chips fire.

### qof-indicator
Checks QOF achievement for register members. Four check modes: threshold (latest observation vs target), recency (last observation within QOF year), observation bundle (sets of care processes, e.g. all 8 diabetes care processes), and observation trend (rising or falling threshold across a minimum number of readings).

### drug-combo
Fires when two or more specified drug groups are co-prescribed, with optional age gating and a must-not-be-present exclusion list. Used for PINCER prescribing-safety rules.

### event-count
Counts matching events (observations or journal entries) in a configurable time window and fires when the count meets a threshold.

### composite
Combines other rules with AND or OR logic. Fires when its child rules meet the configured condition.

### vaccine
Evaluates eligibility for flu and COVID vaccination against JCVI/UKHSA 2025/26 seasonal criteria (age, QOF registers, medications, BMI), then checks for GIVEN/DECLINED coding in the current season window.

The **Alert Library** contains 22 importable starter rules in two categories:

- **Prescribing safety** (19 rules): PINCER indicators 1–12, NSAID combinations, DOAC interactions, valproate teratogenicity, and others
- **Clinical review** (3 rules): eGFR trend, PSA trend, and additional observation monitors

## Settings & customisation

- **Practice Profile** — one-time practice API code setup; shared-folder managed deployment supported
- **Custom Alert Builder** — form-based builder for all five rule types with live engine preview and validate-on-save
- **Backup / restore** — suite-wide JSON backup envelope covering all module settings, custom rules, thresholds, and display preferences; per-module export/import also available
- **Display preferences** — light/dark theme, small/medium/large text size, colour-blind mode
- **Hidden/snoozed alerts** — management panel to re-enable dismissed chips or cancel an active vaccine snooze

## Recent additions (last 4 weeks)

- **v3.31.0 (2026-06-06)** — New Observation Trends tab: HbA1c, cholesterol, and weight chart viewer
- **v3.30.0 (2026-06-06)** — Global extraction-health banner: surfaces Medicus layout changes across every tab, with one-click update check
- **v3.29.x (2026-06-04–05)** — QOF 2026/27 Obesity clinical area (draft, pending confirmation); NSAID drug set completed; Renal Monitoring tab renamed; options page auto-reloads after backup import
- **v3.28.x (2026-06-04)** — Security hardening (ruleset import validation, patient data minimisation, tightened extension resource exposure, message-sender validation); drug-monitoring brand-completeness pass for amiodarone, allopurinol, azathioprine, sulfasalazine, and methotrexate brands
- **v3.27.0 (2026-06-03)** — Comprehensive UK brand coverage for all monitored drug classes (DMARDs, antihypertensives, statins, antipsychotics, DOACs, SGLT2 inhibitors, GLP-1 agents, systemic HRT)
- **v3.26.x (2026-06-02)** — Vaccination eligibility alerts (flu/COVID per JCVI 2025/26); per-chip dismiss and vaccine snooze; QOF chip fixes on care-record views
- **v3.25.x (2026-06-02)** — BP Trend and Renal Monitoring tabs added
- **v3.24.0 (2026-06-02)** — ADHD stimulant monitoring rules for methylphenidate, lisdexamfetamine, dexamfetamine, atomoxetine, and guanfacine (paediatric and adult)
- **v3.23.0 (2026-06-02)** — Smoking status recall chips for disease registers; carbamazepine drug monitoring added
- **v3.22.0 (2026-06-01)** — Custom Alert Builder: cohort fields exposed, medication-exclude fix, drug-monitoring patient filters, live preview for all five rule types
- **v3.20–v3.21.x (2026-06-01)** — QOF clinical-correctness fixes (age filter fail-open, negation-aware problem matching, STIA register, DM register false-positive fix); backup/restore data-loss fixes; lifecycle and race-condition reliability fixes
- **v3.18–v3.19.x (2026-05-31)** — Service worker fixed (icon reliably opens side panel); falling eGFR and hyperkalaemia alerts shipped as defaults; extraction-health canary wired to side panel
- **v3.13–v3.17.x (2026-05-30)** — Triage Lens pattern expansion (106 to 620 patterns); Pharmacy First signposting for all 7 pathways; STOPP/START prescribing-safety flags; CI test suite added; eGFR trend and PSA trend monitors

## Safety posture

Medicus Suite is a passive display tool. It reads data the clinician is already authorised to see in Medicus, processes everything locally in the browser, and writes nothing to any patient record or external system. No patient data is transmitted outside the browser. It does not produce clinical diagnoses or recommendations; all displayed values are drawn from the source record and all clinical decisions remain solely with the clinician.

For a full statement, see INTENDED-PURPOSE.md and HAZARD-LOG.md.
