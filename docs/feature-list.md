# Medicus Suite — Feature List

**Version:** v3.166.0
**Generated:** 2026-07-12 (automated)

## What it is

Medicus Suite is a Chrome browser extension for UK GP practices that runs alongside the Medicus electronic patient record system. It adds a side panel and a handful of on-page overlays that surface monitoring alerts, demand data, appointment capacity, investigation-result triage, and clinical reference material directly inside Medicus. Everything shown is derived from data already present in Medicus; all processing happens locally in the browser, and no patient data is sent anywhere else. The only writes back to Medicus are explicit, user-initiated actions carried out through Medicus's own controls (booking an appointment, creating a task, re-assigning a prescription request, and — the newest — filing a lab result confirmed all-normal). Medicus remains the system of record throughout.

## At a glance

- 15 side-panel modules covering monitoring, demand, capacity, workflow, knowledge and the live patient record
- 8 in-page content-script features (queue overlays, workflow buttons and relays) plus 2 full-tab generated reports
- 7 rule types in the alert engine
- 27 drug-monitoring rules, 65 QOF register/indicator rules, 5 vaccine rules, 44 investigation-result rules, and 26 starter alerts in the prescribing-safety library

## Side-panel modules

### Today

The default tab — a morning command centre. A one-line "what needs you now" summary sits above cards for waiting-room load, triage volume, today's medical/admin demand, remaining slots and the pre-clinic sweep, so nothing needs checking screen by screen before clinic starts.

### Sentinel (Monitoring)

The core per-patient alerting module. With a record open, Sentinel checks the patient's medications, problems and results against drug-monitoring guidance and QOF indicators and shows colour-coded chips for anything overdue, due, or not achieved. A "Brief" gives a 30-second worst-first summary; a "Patient Passport" turns it into a plain-English handout; "Action Packs" attach copy-ready recall/booking text to each chip. Passive display only — no advice, no record writes; every value must be checked against the source.

### Slot Counter

Live appointment-slot counts by type for any date, pulled from the scheduling API rather than requiring the scheduling page to be open. Configurable colour thresholds, CSV export, and an embedded mini-booking flow that reserves and confirms a slot without leaving the panel.

### Capacity Forecast

A calendar view of upcoming appointment capacity against a practice-set minimum, with separate targets per weekday. Week/month views are colour-coded Sufficient/Tight/Low/Critical, and multiple named presets let different services or teams be checked side by side.

### Submissions Tracker

Daily inbound task counts — medical, admin, investigations, prescriptions — with a today view, a custom date range, and day-vs-day comparison. Amber/red thresholds flag unusual volume before it becomes a backlog. Because Medicus only reports still-open tasks, the suite keeps its own day ledger of every request it has seen, so counts reflect true received volume and no longer fall as the team completes work; days the suite wasn't watching are flagged as undercounts rather than shown as history.

### Signing Queue

Every open repeat-prescription request shown with the requesting patient's recorded drug-monitoring currency alongside — the same engine checks as Monitoring and Sweep — sorted riskiest first, with the loudest flag when the requested drug is itself the one overdue, the latest recorded eGFR (with its age) on every checked row, and each request's collection route at a glance (house glyph = practice dispensary, Rx glyph = community pharmacy) with location filter pills and counts — hidden red flags always called out. Display only: "no flag" is explicitly not an all-clear, records that could not be read sort above quiet rows, and authorisation happens only in Medicus.

### Activity Report

Shows how much work each staff member has processed over a chosen date range — consultations, prescriptions, reviews, documents, results — as period totals and a per-person stacked bar chart, useful for workload reviews and rota planning.

### Referrals Tracker

Audits referrals sent over a date range by priority and status, with charts by clinician, specialty and hospital. A standing safety-net worklist surfaces open Two-Week-Wait suspected-cancer referrals that haven't yet reached a confirmed outcome.

### Condor (Practice Pressure)

A live whole-practice dashboard distilling waiting-room load, task queue, urgent workload and capacity into one Green/Amber/Red Practice Pressure Index — with a built-in safety floor that will never show "all clear" while demand has outstripped capacity. Supporting cards cover workload balance, task-backlog age, demand velocity and a day-on-day trend view (Pulse). Generates a one-click Practice Report for management, staff or ICB audiences (the staff version stays whole-practice, never per-clinician).

### Trends

Line-chart history of a patient's key readings — blood pressure, kidney function, HbA1c, cholesterol, weight — for quick context alongside the record, with blood pressure shown against target and kidney readings mapped to standard staging. Read-only; adds no commentary.

### Reception

A front-desk companion: a single red/amber/green status for the open patient (expandable to what's overdue), plus guided call-handling question sets for common presenting problems with immediate escalation on any red-flag answer. Produces a copy-ready note for the record — it never triages. Pathways are practice-editable and need explicit manager sign-off before use.

### Pre-clinic Sweep

Checks a day's booked list (one clinician or the whole practice) against the monitoring rules before clinic starts, so gaps can be arranged in advance rather than found mid-consultation. Ranks QOF points at risk, works through large lists in batches, and can raise a recall task or print a reception handout directly from the results. Results are a temporary snapshot, cleared after a couple of hours.

### Knowledge

A practice-owned reference library — referral criteria, contacts, local pathways, templates — searchable and editable directly from the tab, with near-duplicate detection and a bulk starter-pack import handled in Settings.

### Leaflets (NHS Patient Leaflets)

Finds and shares official NHS patient information without leaving the panel. Tier 1 is always-on: instant local search over a curated NHS index with a guaranteed "search nhs.uk" fallback. Tier 2 is optional: with a configured key, selected leaflets render in-panel with NHS attribution, falling back cleanly to open-in-tab if the live lookup fails.

### Patient Record (live)

A live, on-screen snapshot of the patient open in Medicus — problems, medications, recent results and standard prescribing-safety scores — sourced from the same data Medicus already shows, not from an export. Display-copy only: it transcribes what's on screen with a provenance note baked into any copy, and marks gaps (allergies, immunisations, full history) explicitly rather than hiding them.

## In-page features (content scripts)

- **Triage Lens — request queue**: overlays the patient request queue with severity chips (red/amber/info/routine) from ~80 built-in rules covering chest pain, sepsis, stroke, anaphylaxis, paediatric red flags and more, plus Pharmacy First signposting — decision support only, never auto-triage.
- **Triage Lens — investigation results queue**: per-row severity chips on the lab-results filing queue (Urgent, N abnormal, Under-prioritised, Unmatched), a live red/amber/clear status bar, trend arrows and a detail popover per chip, keyboard triage (j/k/Enter/n), and an honest "not yet assessed" state rather than a false "clear."
- **Lab Results Auto-Filing button**: a one-click "File all normal" action that appears only when every value on a result task is confirmed within normal limits — the suite's first feature that writes to the clinical record, gated behind an all-normal fail-closed check, admin-configured profiles that ship disabled, and a per-install kill switch.
- **Prescribing workflow button**: one-click "send to routine prescriptions," driving Medicus's own re-assign control with a configurable team and commit mode, fully audited.
- **Inline appointment booking**: a "Book appointment for this patient" panel on task pages, booking through the Medicus scheduling API.
- **Inline task creation**: a "Create task for this patient" panel on task pages, posting directly to the Medicus task API.
- **Sentinel content script**: feeds per-patient monitoring data to the Sentinel module and drives prescribing-safety and risk-calculator signpost chips on the record view.
- **Pusher relay** and **Referrals discovery**: background plumbing — real-time updates without polling, and automatic detection of the practice's referrals endpoint.

**Full-tab reports:** a periodised **Practice Report** (three audience profiles — management, staff, ICB — the staff version always whole-practice, never per-clinician) and a **CQC Inspection Readiness** page giving a plain "ready or not" verdict plus an evidence export.

## Alert engine

Sentinel's rules engine scans a patient's medications, problems and results and raises a flag whenever a configured clinical condition is met, via seven rule types:

- **Drug monitoring** — flags an overdue blood test or review for a specific medication, at guidance-defined intervals (which can shorten automatically if a related result has worsened).
- **QOF register** — detects membership of a long-term-condition register from coded diagnoses.
- **QOF indicator** — flags a register member who hasn't yet met a specific care target within its time window.
- **Drug combination** — flags clinically significant prescribing combinations (interaction or missing-safeguard checks), with age/sex filters.
- **Event count** — flags something happening too often in a time window (e.g. repeated falls or infections).
- **Composite** — combines other rules with AND/OR logic for escalated multi-factor warnings.
- **Observation trend** — flags a series of results moving in a concerning direction over time.

The bundled library ships **26 starter alerts** — 23 prescribing-safety combinations (drug interactions, teratogenicity safeguards, monitoring recalls for drugs like warfarin, lithium and amiodarone) and 3 clinical-review alerts (recurrent UTIs, recurrent falls, rising PSA), all drawn from recognised UK sources (PINCER, MHRA, NICE). Every bundled rule is an editable starting point — practices can adjust thresholds, author their own rules from the same seven patterns, and export/import rule sets at whole-practice or per-clinician level.

## Settings & customisation

- **Practice Profile**: shared-folder managed deployment — an administrator can push config and rules to every seat from one file, with central attestation so accepted gates propagate without a per-user click
- **Choose your tabs**: pick which side-panel tabs appear and in what order
- **Backup / restore**: a full suite-wide export/import covering every module and rule set — configuration only, never patient-identifiable data
- **Display preferences**: theme (light/dark/auto), density, and colourblind mode
- **Event Ledger**: a capped, machine-local record of what the suite displayed or did, filterable by patient UUID and date, with CSV export — patients recorded by UUID only, excluded from backups
- **Suite health**: the extension self-diagnoses its Medicus integration points and shows a calm amber warning (never red) if a Medicus interface change has degraded a feature, instead of the feature silently going quiet

## Recent additions (last 4 weeks)

- **v3.159.0 (2026-07-07)** — One warm line on the genuinely finished signing pile (“✓ Pile’s clear — nothing waiting on you.”) — panel-vetted: static text, no emoji, no animation, and never shown when filters merely hide requests.

- **v3.158.0 (2026-07-07)** — Signing gains location filter pills with counts (“Dispensary 6 · No location 3”, hidden red flags always called out) and glanceable collection glyphs after the name; Monitoring gains Sweep’s “Create task” button for the open patient — one explicit confirm, Medicus’s own task workflow.

- **v3.157.0 (2026-07-07)** — Signing rows show each request’s recorded collection location (e.g. “Dispensary”) — the dispensing-patient flag for dispensing practices. Verbatim from the task row, zero extra fetches.

- **v3.156.0 (2026-07-07)** — Signing rows now carry the patient’s latest recorded eGFR with its age; stale or absent renal data gets amber salience on flagged rows. Verbatim recorded fact only — no bands, no dose logic.

- **v3.155.0 (2026-07-07)** — New Signing tab: the repeat-prescription pile with each patient’s recorded monitoring alongside, riskiest first — built for the 6pm signing session. Display only; never says "safe".
- **v3.154.0 (2026-07-06)** — Quick-leaflet button in the panel header: search NHS patient leaflets from any tab (built for mid-triage use), with open/copy-link and a hand-off into the full Leaflets tab.
- **v3.153.0 (2026-07-06)** — Demand counts fixed to reflect true received volume: a new day ledger remembers requests after the team completes them (Medicus itself only reports still-open tasks), correcting a systematic undercount across Submissions, Today, the demand strip and Condor.
- **v3.152.0 (2026-07-03)** — Sweep and Today gained plain-English "checks due" summaries and named skipped appointments; the open patient's monitoring status now shows from any tab; Reception pathways link straight to matching NHS leaflets.
- **v3.151.0 (2026-07-02)** — Triage Lens queue reworked to keep more routine requests off the GP's desk: keyboard-driven triage, prepared Pharmacy First replies, and safer grading of borderline results.
- **v3.147.0 (2026-07-02)** — New Leaflets tab: find and share the right NHS patient information from inside the panel instead of a web search.
- **v3.146.0 (2026-07-02)** — The suite now notices when Medicus changes its own screens and shows a clear warning instead of a feature silently breaking.
- **v3.145.0 (2026-07-01)** — Three new tools: a pre-prescribing risk check, a log of every safety alert shown, and a week-on-week practice workload trend.
- **v3.144.0 (2026-07-01)** — Today opens with a "what needs you now" summary; Slots, Condor and Referrals gained adjustable thresholds and filters.
- **v3.143.0 (2026-06-30)** — New "File all normal" button auto-files confirmed-clear lab results — the suite's first feature that can act on the patient record, with strict safety checks and full audit.
- **v3.141.0 (2026-06-29)** — Pre-clinic Sweep can now book the recall itself and rank QOF gaps by points at risk; Referrals flags suspected-cancer referrals that have gone quiet.
- **v3.109.0 (2026-06-16)** — New "Record" tab: a live one-screen patient summary, no PDF export needed, alongside a new printable Practice Report for meetings and ICB returns.

## Safety posture

Medicus Suite is primarily a passive display tool: it reads data already present in Medicus and presents it in the browser. It performs no AI inference, transmits no patient data to any external service, and makes no clinical decisions. The only writes are explicit, user-initiated actions carried out through Medicus's own controls (booking an appointment, creating a task, re-assigning a prescription request, and Lab Results Auto-Filing) — Medicus stays the system of record and nothing is written automatically. Lab Results Auto-Filing is the most safety-significant of these and is correspondingly gated: admin-only configuration, disabled-until-reviewed profiles, an all-normal fail-closed gate, and a per-install kill switch. All computation happens locally in the extension. See `INTENDED-PURPOSE.md`, `HAZARD-LOG.md` and `CLINICAL-SAFETY-NOTICE.md`.
