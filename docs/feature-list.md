# Medicus Suite — Feature List

**Version:** v3.4.1
**Generated:** 2026-05-29 (automated)

## What it is

Medicus Suite is a Chrome extension built for GPs and practice staff using the Medicus clinical system. It adds a persistent side panel alongside the Medicus web interface, surfacing practice workload figures, appointment capacity, patient-level clinical alerts, referral patterns, and task inbox counts — all drawn from the same Medicus APIs you already use, displayed without leaving the page. Nothing is written back to the patient record, and no data leaves your browser.

## At a glance

- 6 side-panel modules
- 4 in-page features (content-script overlays)
- 7 rule types in the alert engine
- 22 bundled starter alerts in the library

## Side-panel modules

### Slot Counter

Shows today's available appointment slots broken down by appointment type. Refreshes automatically when Medicus reports a booking change, so the count stays current without reloading.

- Separate counts per appointment type (e.g. GP routine, telephone, nurse)
- Types can be hidden to focus on what matters to your workflow
- Configurable threshold rules: set an amber or red alert when any type drops below a defined count
- Date navigation to check capacity on adjacent days
- Live refresh driven by Medicus real-time events

### Capacity Forecast

A calendar view of appointment capacity across the week or month, compared against minimum thresholds you define. Designed to give a quick read on upcoming pressures without drilling into the booking screen.

- Week and month view modes
- Each day shows a status: Sufficient, Tight, Low, Critical, Closed, or Past
- Named presets let you save different threshold profiles (e.g. "Normal week" vs "Bank holiday week")
- Weekend display optional
- Automatic refresh when bookings change

### Activity Report

Pulls the practice's activity report for a date range you choose and shows totals plus a breakdown by staff member. Useful for a quick end-of-week or end-of-month read on consultation volumes.

- Configurable date range with common presets (today, this week, last month, custom)
- Stacked bar chart shows each staff member's contribution to the total
- Switch between the stacked view and individual metrics
- Reacts to practice code changes without requiring a manual refresh

### Referrals Tracker

Shows referral volume and patterns for the practice over a chosen period. Designed to help identify outliers and track 2-week-wait referral rates alongside routine and urgent activity.

- Configurable date range (default: last 12 months)
- Breakdowns by referring clinician, priority (Routine, Urgent, 2-Week Wait), and referral status
- Referral rate view: referrals per consultation, per clinician — normalises for varying session loads
- Filter chips to include or exclude priorities and statuses
- Clinician search for large practices
- Discovery-based configuration: reads your practice's referral API URL automatically from the Medicus page; no manual setup

### Sentinel — Clinical Alerts

Shows per-patient clinical alert chips for the patient currently open in the Medicus tab. Each chip represents a rule that has fired against the patient's record — drugs requiring monitoring, QOF indicators not met, concerning prescribing combinations, or recurrent clinical events. Also shows the practice waiting room at the bottom of the panel for at-a-glance queue awareness.

- Chips update within 10 seconds of switching to a different patient
- Colour-coded severity: red (Alert / Overdue / Severely Overdue), amber (Caution / Due Soon), neutral (Noted / No Data), green (Met / In Date)
- Click any chip to see the evidence: the exact data the rules engine matched — drug name and last test date, observation value and threshold, number of matching events — so you can validate the alert before acting
- Filter bar: show All, Action-needed only, or Clear chips
- Waiting room panel shows patient name, check-in time, and reason; refreshes every 30 seconds
- Rules are fully configurable in Settings → Monitoring

### Submissions Tracker

Shows the current count of patient request tasks in your inbox: medical, admin, investigation results, and prescription requests (routine and non-routine). Polls every minute while the panel is open and the tab is visible.

- Counts for five task types: Medical, Admin, Investigation, Routine Rx, Non-routine Rx
- Today mode vs date-range chart mode
- Optional RAG thresholds: configure amber and red levels for medical and admin queues; a warning strip in the panel header fires when a threshold is crossed
- Comparison view: today vs a chosen comparison date
- Auto-poll every minute (today mode only)

## In-page features (content scripts)

These run directly inside the Medicus tab. No action is required to activate them — they load automatically when you open a Medicus page.

### Triage Lens

Overlays priority and alert information on the Medicus task queue. Each queue entry gets a chip showing its clinical priority level (based on the Sentinel rules engine) so you can triage at a glance before opening each task.

- Chips appear inline in the queue, colour-coded by alert severity
- Configurable chip types and display thresholds in Settings → Triage Lens
- Activates on all Medicus pages

### Sentinel (in-page chips)

Injects clinical alert chips directly onto the patient record page — the same chips shown in the side-panel Sentinel module, but embedded in context alongside the clinical record. Fires and re-evaluates each time you open a patient.

- Activates on all Medicus pages
- Chips match the side-panel display in colour and wording
- Evidence on click (same as the side-panel version)

### Referrals Discovery

Reads the practice's referral API URL from the page when you visit the Medicus referrals section. Stores it automatically so the Referrals Tracker module can fetch data without manual configuration.

- Runs once per referrals page visit; no ongoing overhead
- Activates on all Medicus pages

### Pusher Relay

Connects to the real-time event stream that Medicus uses internally and relays relevant events (new bookings, booking changes) to the extension. This is what allows the Slot Counter and Capacity Forecast to refresh without polling.

- No user interaction required
- Activates on all Medicus pages

## Alert engine

The Sentinel module evaluates a set of rules against each patient's record. Rules are defined in Settings → Monitoring. Seven rule types are available:

**Drug monitoring** — patient is prescribed a drug that requires periodic blood tests or clinical review. Fires when the last relevant test is overdue or severely overdue relative to a configured recall interval. Examples: lithium, methotrexate, warfarin, SGLT2 inhibitors.

**QOF register** — checks whether the patient is on a QOF disease register based on their active problem list. Useful as a building block inside composite rules (e.g. "on the diabetes register AND HbA1c not met").

**QOF indicator** — checks whether a clinical indicator is met. Supports observation threshold checks (e.g. HbA1c ≤ 58 mmol/mol), medication checks (e.g. statin prescribed), and observation trend checks (e.g. rising PSA, falling eGFR). Can require multiple checks to all be met simultaneously.

**Observation trend** — fires when a series of recorded observation values shows a consistent rising or falling direction over a configurable number of data points and minimum delta. Examples: progressive eGFR decline, steadily rising PSA.

**Drug combination** — fires when the patient is concurrently prescribed drugs from two or more configured groups, with optional age, sex, and active-problem filters. Covers PINCER-style prescribing safety patterns such as NSAID without gastroprotection, anticoagulant with antiplatelet, or beta-blocker in asthma.

**Event count** — fires when the number of matching coded problems or observations within a time window exceeds a threshold. Examples: three or more UTI diagnoses in 12 months, four or more abnormal LFTs in a year.

**Composite** — combines other rules with AND or OR logic. Allows compound conditions such as "on the CKD register AND last eGFR declining AND no nephrology referral in 2 years."

### Bundled alert library

Settings → Monitoring → Alert Library contains 22 starter alerts grouped by category:

- **Prescribing safety (19):** PINCER prescribing indicators, MHRA drug-safety guidelines, and NICE monitoring recommendations — covering NSAIDs, anticoagulants, lithium, valproate, isotretinoin, SGLT2 inhibitors, QTc-prolonging combinations, and more.
- **Clinical review (3):** Recurrent-event patterns flagging patients who may warrant a structured review.

These are starter templates based on published guidelines and have not been individually validated for your practice population. An acknowledgement step is required before adding library entries to make clear that each rule should be reviewed before clinical use.

## Settings & customisation

- **Practice Profile** — practices running the extension across multiple PCs can drop a `practice-profile.json` file into the extension folder to push default settings to all users automatically. Three apply modes: merge-missing (default, never overwrites user preferences), force-override (for mandatory changes), and reset (full reset to profile defaults).
- **Backup / restore** — a single export from Settings → Backup produces a versioned JSON envelope containing all module settings, custom alert rules, thresholds, and preferences. Restore from any previous backup in one step.
- **Display preferences** — light and dark themes, density options, and colourblind-friendly mode.
- **Suite settings** — practice code, feedback recipient email, update check.
- **Clinical Safety tab** — plain-language explanation of the software's status, limitations, and links to the full clinical safety case documents (Intended Purpose, Clinical Safety Notice, Hazard Log, Disclaimer).

## Recent additions (last 4 weeks)

**Feedback & communication**
- **v3.4.1 (2026-05-29)** — Feedback recipient email is now configurable in Settings › Suite, included in backup/restore.
- **v3.4.0 (2026-05-29)** — Feedback / Feature request / Bug report form in the About tab; pre-fills an email with type, subject, details, version, and browser — no GitHub account required.

**Clinical safety & governance**
- **v3.3.0 (2026-05-29)** — New Clinical Safety tab in Settings, with links to all safety case documents.
- **v3.1.8 (2026-05-28)** — Applicability filter audit: closed cases where rules could fire for patients outside their configured age, sex, or problem-list criteria.

**Alert clarity & wording**
- **v3.2.5 (2026-05-29)** — Non-time-based alerts (drug combos, event counts, composites) now show ALERT / CAUTION / NOTED instead of OVERDUE / DUE SOON, which had no meaning for presence-based rules.
- **v3.2.2 (2026-05-29)** — "STALE" status renamed "SEVERELY OVERDUE" throughout chips and summaries.
- **v3.3.1 (2026-05-29)** — Read-time estimates removed from Triage Lens queue chips.

**Alert evidence**
- **v3.2.0 (2026-05-28)** — Sentinel chips are now clickable: shows the exact data the engine matched to fire each alert (drug name, last test date, observation values, event counts).
- **v3.1.0–3.1.1 (2026-05-28)** — Multi-point observation history: observation-trend and event-count rules now evaluate full recorded history rather than the most recent reading only.

**Alert builder & library**
- **v3.2.3 (2026-05-29)** — "Add all" button in the alert library; fixed auto-scroll when adding individual entries.
- **v3.1.5 (2026-05-28)** — Acknowledgement gate before the alert library can be used.
- **v3.0.0 (2026-05-28)** — Alert Builder UI: full form-based rule creation for drug-combo, event-count, and composite rules; browsable library of 22 starter alerts.

## Safety posture

Medicus Suite is a passive display tool. It reads data from Medicus APIs and displays it in the browser. It does not write to the patient record, does not send data to any external server, and does not make clinical decisions. No patient data leaves the browser. There is no AI inference on patient data.

The software is built and maintained by a single GP developer on a best-effort basis. A clinical safety case is maintained, but the extension carries no warranty and is not a regulated medical device. It is a supplementary aid, not a substitute for clinical judgement or the information in the live record. Full details are in `docs/INTENDED-PURPOSE.md`, `docs/CLINICAL-SAFETY-NOTICE.md`, and `docs/HAZARD-LOG.md`.
