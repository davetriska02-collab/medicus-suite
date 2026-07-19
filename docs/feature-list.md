# Medicus Suite — Feature List

**Version:** v3.175.0
**Generated:** 2026-07-19 (automated)

## What it is

Medicus Suite is a Chrome browser extension for UK GP practices that runs alongside the Medicus electronic patient record system. It adds a side panel and a handful of on-page overlays that surface monitoring alerts, demand data, appointment capacity, investigation-result triage, and clinical reference material directly inside Medicus. Everything shown is derived from data already present in Medicus; all processing happens locally in the browser, and no patient data is sent anywhere else. The only writes back to Medicus are explicit, user-initiated actions carried out through Medicus's own controls (booking an appointment, creating a task, re-assigning a prescription request, and filing a lab result confirmed all-normal). Medicus remains the system of record throughout.

## At a glance

- 17 side-panel modules covering monitoring, demand, capacity, workflow, knowledge, per-patient practice flags and the live patient record
- 8 in-page content-script features (queue overlays, workflow buttons and relays) plus 3 full-tab tools (two generated reports and a record-cleanup tool)
- 8 rule types in the alert engine
- 33 drug-monitoring rules, 74 QOF register/indicator rules, 5 vaccine rules, 44 investigation-result rules, and 32 starter alerts in the prescribing-safety library

## Side-panel modules

### Today

The default tab — a morning command centre. A one-line "what needs you now" summary sits above cards for waiting-room load, triage volume, today's medical/admin demand, remaining slots and the pre-clinic sweep, so nothing needs checking screen by screen before clinic starts.

### Sentinel (Monitoring)

The core per-patient alerting module. With a record open, Sentinel checks medications, problems, results and (where the feed carries it) recorded allergies against drug-monitoring guidance, QOF indicators, prescribing-safety combinations and seasonal vaccination status, and shows colour-coded chips for anything overdue, due, not achieved, or clinically conflicting. A "Brief" gives a 30-second worst-first summary; a "Patient Passport" turns it into a plain-English handout; "Action Packs" attach copy-ready recall/booking text to each chip. Passive display only — no advice, no record writes; every value must be checked against the source.

### Slot Counter

Live appointment-slot counts by type for any date, pulled from the scheduling API rather than requiring the scheduling page to be open. Configurable colour thresholds, CSV export, and an embedded mini-booking flow that reserves and confirms a slot without leaving the panel.

### Capacity Forecast

A calendar view of upcoming appointment capacity against a practice-set minimum, with separate targets per weekday. Week/month views are colour-coded Sufficient/Tight/Low/Critical, and multiple named presets let different services or teams be checked side by side.

### Submissions Tracker

Daily inbound task counts — medical, admin, investigations, prescriptions — with a today view, a custom date range, and day-vs-day comparison. Amber/red thresholds flag unusual volume before it becomes a backlog. Because Medicus only reports still-open tasks, the suite keeps its own day ledger of every request it has seen, so counts reflect true received volume and don't fall as the team completes work; days the suite wasn't watching are flagged as undercounts rather than shown as history.

### Signing Queue

Every open repeat-prescription request shown with the patient's recorded drug-monitoring currency alongside — the same engine checks as Monitoring and Sweep — sorted riskiest first, with the loudest flag when the requested drug is itself overdue, any conflicting prescribing-safety combination called out at signing, the latest eGFR (with its age) on every row, and each request's collection route at a glance (house = dispensary, Rx = pharmacy) with location filter pills. Display only: "no flag" is not an all-clear, unreadable records sort above quiet rows, and authorisation happens only in Medicus.

### Follow-ups

A personal safety-net reminder list — "MSU pending, chase Friday" logged in seconds and resurfaced once the due date passes. Entries can be typed directly on the tab (free text) or added from the Monitoring tab against the patient currently open, carrying that patient's identity across so the reminder never drifts onto the wrong person. A fixed line makes clear this is a personal chase list, not the clinical record — safety-netting must still be documented in Medicus as usual. Stored on this machine only and excluded from suite backups, since entries can carry patient-identifiable free text; capped and automatically pruned once marked done.

### Activity Report

Shows how much work each staff member has processed over a chosen date range — consultations, prescriptions, reviews, documents, results — as period totals and a per-person stacked bar chart, useful for workload reviews and rota planning.

### Referrals Tracker

Audits referrals sent over a date range by priority and status, with charts by clinician, specialty and hospital. A standing safety-net worklist surfaces open Two-Week-Wait suspected-cancer referrals with no confirmed outcome yet.

### Condor (Practice Pressure)

A live whole-practice dashboard distilling waiting-room load, task queue, urgent workload and capacity into one Green/Amber/Red Practice Pressure Index — with a built-in safety floor that will never show "all clear" while demand has outstripped capacity. Supporting cards cover workload balance, task-backlog age, demand velocity and a day-on-day trend view (Pulse). Generates a one-click Practice Report for management, staff or ICB audiences (the staff version stays whole-practice, never per-clinician).

### Trends

Line-chart history of a patient's key readings — blood pressure, kidney function, HbA1c, cholesterol, weight — for quick context alongside the record, with blood pressure shown against target and kidney readings mapped to standard staging. Read-only; adds no commentary.

### Reception

A front-desk companion: a single red/amber/green status for the open patient (expandable to what's overdue), plus guided call-handling question sets for common presenting problems with immediate escalation on any red-flag answer. Produces a copy-ready note for the record — it never triages. Pathways are practice-editable and need explicit manager sign-off before use.

### Pre-clinic Sweep

Checks a day's booked list (one clinician or the whole practice) against the monitoring rules before clinic starts, so gaps can be arranged in advance rather than found mid-consultation. Ranks QOF points at risk, works through large lists in batches, and can raise a recall task or print a reception handout directly from the results. Results are a temporary snapshot, cleared after a couple of hours.

### Knowledge

A practice-owned reference library — referral criteria, contacts, local pathways, templates — searchable and editable from the tab, with near-duplicate detection and a bulk starter-pack import in Settings.

### Leaflets (NHS Patient Leaflets)

Finds and shares official NHS patient information without leaving the panel. Tier 1 is always-on: instant local search over a curated NHS index with a guaranteed "search nhs.uk" fallback. Tier 2 is optional: with a configured key, selected leaflets render in-panel with NHS attribution, falling back cleanly to open-in-tab if the live lookup fails. A quick-leaflet popover in the panel header offers the same search from any tab.

### Patient Record (live)

A live, on-screen snapshot of the patient open in Medicus — problems, medications, recent results and standard prescribing-safety scores — sourced from the same data Medicus already shows, not from an export. Display-copy only: it transcribes what's on screen with a provenance note baked into any copy, and marks gaps (allergies, immunisations, full history) explicitly rather than hiding them.

### Patient Alerts

Practice-defined per-patient flags — interpreter required, safeguarding concern, medication-seeking behaviour, or anything custom — that appear on a global alert strip and the Monitoring banner the moment that patient's record is opened. Managed from the Pt Alerts tab (add/edit/remove, browse all flagged patients, customisable quick-add presets, three severities). Stored locally per browser profile and shareable practice-wide via backup files; not written to the clinical record, and an absent flag is never an all-clear.

## In-page features (content scripts)

- **Triage Lens — request queue**: overlays the patient request queue with severity chips (red/amber/info/routine) from ~80 built-in rules covering chest pain, sepsis, stroke, anaphylaxis, paediatric red flags and more, plus Pharmacy First signposting and keyboard-driven triage — decision support only, never auto-triage.
- **Triage Lens — investigation results queue**: per-row severity chips on the lab-results filing queue (Urgent, N abnormal, Under-prioritised, Unmatched), a live red/amber/clear status bar, trend arrows and a detail popover per chip, and an honest "not yet assessed" state rather than a false "clear".
- **Lab Results Auto-Filing button**: a one-click "File all normal" action that appears only when every value on a result task is confirmed within normal limits — the suite's first feature that writes to the clinical record, gated behind an all-normal fail-closed check, admin-configured profiles that ship disabled, and a per-install kill switch.
- **Prescribing workflow button**: one-click "send to routine prescriptions," driving Medicus's own re-assign control with a configurable team, fully audited.
- **Inline appointment booking**: a "Book appointment for this patient" panel on task pages, booking through the Medicus scheduling API.
- **Inline task creation**: a "Create task for this patient" panel on task pages, posting directly to the Medicus task API.
- **Sentinel content script**: feeds per-patient monitoring data to the Sentinel module and drives prescribing-safety and risk-calculator signpost chips on the record view.
- **Pusher relay** and **Referrals discovery**: background plumbing — real-time updates without polling, and automatic detection of the practice's referrals endpoint.

**Full-tab tools:**

- **Practice Report**: a periodised report with three audience profiles — management, staff, ICB — the staff version always whole-practice, never per-clinician.
- **CQC Inspection Readiness**: a plain "ready or not" verdict against inspection criteria, plus an evidence export.
- **Record duplicate cleanup tool** *(new)*: scans the active patient list for records likely duplicated by a GP2GP transfer, then lets a user work through one patient's problems, notes, prescriptions and documents entry by entry. Matches are graded EXACT, HIGH or REVIEW by confidence — only EXACT/HIGH are offered for one-click bulk removal, documents are never bulk-removed (manual review only), and anything ambiguous is left for a human decision. Direct links out to Medicus support a final check before removal, which isn't easily reversible.

## Alert engine

Sentinel's rules engine scans a patient's medications, problems, results and allergies and raises a flag whenever a configured clinical condition is met, via eight rule types:

- **Drug monitoring** — flags an overdue blood test or review for a specific medication, at guidance-defined intervals (which can shorten automatically if a related result has worsened).
- **QOF register** — detects membership of a long-term-condition register from coded diagnoses.
- **QOF indicator** — flags a register member who hasn't yet met a specific care target within its time window.
- **Drug combination** — flags clinically significant prescribing combinations (interaction or missing-safeguard checks), with age/sex filters.
- **Drug/allergy conflict** — flags a prescribed drug that co-occurs with a documented allergy to it or a related substance, where the practice's feed carries structured allergy data.
- **Event count** — flags something happening too often in a time window (e.g. repeated falls or infections).
- **Vaccine** — flags a patient eligible for a seasonal vaccination who hasn't yet had it recorded as given, checking for a recorded decline first so it's never mistaken for one still due.
- **Composite** — combines other rules with AND/OR logic, including a result trending in a concerning direction over time, for escalated warnings.

The bundled library ships **32 starter alerts** — 29 prescribing-safety combinations (drug interactions, teratogenicity safeguards, monitoring recalls for drugs like warfarin, lithium and amiodarone) and 3 clinical-review alerts (recurrent UTIs, recurrent falls, rising PSA), drawn from recognised UK sources (PINCER, MHRA, NICE) and periodically re-checked for currency. Every bundled rule is an editable starting point — practices can adjust thresholds, author their own rules, and export/import rule sets at whole-practice or per-clinician level.

## Settings & customisation

- **Practice Profile**: shared-folder managed deployment — an administrator can push config and rules to every seat from one file, with central attestation so accepted gates propagate without a per-user click
- **Choose your tabs**: pick which side-panel tabs appear and in what order
- **Backup / restore**: a full suite-wide export/import covering every module and rule set — configuration only, with one deliberate exception: the Patient Alerts scope carries the practice's own per-patient flags (names, NHS numbers, alert text), and both the export card and the import preview warn loudly that such a file is a patient-identifiable document
- **Display preferences**: theme (light/dark/auto), density, and colourblind mode
- **Event Ledger**: a capped, machine-local record of what the suite displayed or did, filterable by patient UUID and date, with CSV export — patients recorded by UUID only, excluded from backups
- **Suite health**: the extension self-diagnoses its Medicus integration points and shows a calm amber warning (never red) if a Medicus interface change has degraded a feature, with a per-warning acknowledge/snooze

## Recent additions (last 4 weeks)

- **v3.175.0 (2026-07-18)** — New Pt Alerts tab: per-patient flags (interpreter needed, safeguarding, behaviour, anything custom) on a global strip and the Monitoring banner whenever that patient is open.
- **v3.174.0 (2026-07-16)** — One authoritative smoking-status line added to the Sentinel patient banner, replacing scattered recording-currency cards.
- **v3.160.0–v3.173.0 (2026-07-07 to 07-14)** — New Record duplicate cleanup tool: detects GP2GP-related record duplication across the patient list and, within a record, grades likely duplicates by confidence, with safe bulk removal for the clearest matches and manual review for the rest.
- **v3.161.0 (2026-07-11)** — Scheduled clinical-rule currency check refreshed the drug-monitoring, QOF and starter-alert libraries against their UK source guidance (now 33 drug rules, 74 QOF rules, 32 starter alerts).
- **v3.160.0–v3.161.0 (2026-07-07 to 07-08)** — New Follow-ups tab (personal safety-net reminders); new Signing Queue tab (repeat-prescription pile with monitoring context, later gaining renal context, collection-location flags and prescribing-safety warnings); new drug/allergy conflict alerts where the feed carries structured allergy data; new seasonal vaccine-due alerts.
- **v3.154.0 (2026-07-06)** — Quick-leaflet popover in the panel header for searching NHS patient leaflets from any tab.
- **v3.153.0 (2026-07-06)** — Demand counts fixed to reflect true received volume via a day ledger, correcting a systematic undercount across Submissions, Today and Condor.
- **v3.151.0 (2026-07-02)** — Triage Lens queue reworked: keyboard-driven triage, prepared Pharmacy First replies, and safer grading of borderline results.
- **v3.147.0 (2026-07-02)** — New Leaflets tab; the suite began noticing when Medicus changes its own screens and warns instead of a feature silently breaking.
- **v3.143.0–v3.145.0 (2026-06-30 to 07-01)** — New "File all normal" lab-results auto-filing button; a pre-prescribing risk check, a safety-alert log, and a week-on-week practice workload trend.
- **v3.138.0–v3.142.0 (2026-06-29)** — Sweep and Sentinel gained a blind-spot guard for unmonitored high-risk drugs and a QOF points-at-risk prioritiser; Referrals gained a Two-Week-Wait safety-net worklist; Sweep can now book a recall in one click.

## Safety posture

Medicus Suite is primarily a passive display tool: it reads data already present in Medicus and presents it in the browser. It performs no AI inference, transmits no patient data to any external service, and makes no clinical decisions. The only writes are explicit, user-initiated actions carried out through Medicus's own controls (booking an appointment, creating a task, re-assigning a prescription request, and Lab Results Auto-Filing) — Medicus stays the system of record and nothing is written automatically. Lab Results Auto-Filing is the most safety-significant of these and is correspondingly gated: admin-only configuration, disabled-until-reviewed profiles, an all-normal fail-closed gate, and a per-install kill switch. The Record duplicate cleanup tool is display-and-flag only for anything ambiguous; its bulk removals are limited to the highest-confidence matches and are not easily reversible, so it says so plainly first. All computation happens locally in the extension. See `INTENDED-PURPOSE.md`, `HAZARD-LOG.md` and `CLINICAL-SAFETY-NOTICE.md`.
