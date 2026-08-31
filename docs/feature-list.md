# Medicus Suite — Feature List

**Version:** v3.256.0
**Generated:** 2026-08-31

## What it is

Medicus Suite is a Chrome extension that sits alongside the Medicus electronic patient record. It adds a side panel with 20 tabs, a handful of full-tab tools, and a set of small additions layered onto Medicus's own screens (queue chips, monitoring context, inline booking, and similar). Everything it shows is drawn from data already in Medicus — it displays, checks and reminds, never diagnoses, never recommends treatment, and runs no AI-based interpretation of patient data. A short, explicitly listed set of actions can write back to Medicus (booking, task creation, document filing, problem-list tidying and a few others), and each one requires the user to review and confirm before anything happens.

## At a glance

- 20 side-panel tabs covering morning workflow, monitoring, capacity/demand, reception, referrals, staff rota, the Note display board and reference material (two of those tabs open a full-tab tool)
- 3 full-tab tools reached from the panel or from Medicus's own pages (Duplicate Problem Checker, Rota Manager, Note display board)
- around 14 in-page feature groups layered onto live Medicus screens (queue chips, inline booking/task/document widgets, problem and allergy tidying tools)
- 8 rule types in the clinical alert engine
- 39 built-in drug-monitoring rules (38 enabled), 81 QOF rules (15 register + 66 indicator), 7 vaccine rules, 44 investigation-result threshold rules, and 39 starter alerts in the practice alert library (36 prescribing safety, 3 clinical review)

## Side-panel modules

### Today — v1.0
One morning screen: a headline sentence plus waiting-room count, triage queue load, today's demand, today's available slots, and the last pre-clinic sweep status.

### Slot Counter — v2.2
Available appointment slots by type for any date, read live from Medicus's scheduling data.
- Slot counts by type with configurable alert thresholds; CSV export
- "First available appointment" lookup with one-click booking handoff
- Typable appointment-type filter on the booking picker

### Monitoring (Sentinel) — v0.5.1
The clinical context sidebar for whichever patient record is open. Checks active medications, problems and recent results against drug-monitoring intervals and this year's QOF indicators, showing a plain green/amber/red chip for each. Passive display only — never writes to the record, never orders anything, never tells the clinician what to do.
- Drug-monitoring and QOF register/indicator chips; prescribing-safety scores (ACB, STOPP/START-style)
- Practice-editable custom alert rules; a coverage view for meds/problems with no matching rule
- One-click "create task" from a chip

### Trends
Charts a patient's blood pressure, renal function, DOAC creatinine clearance, HbA1c, cholesterol and weight over time, from the same live data Monitoring uses. Includes a DOAC-only view (Cockcroft-Gault CrCl, not eGFR) and CSV export.

### Capacity Forecast
A calendar comparing available appointment capacity against the practice's own configured daily minimums, with day/week/month views, per-day red/amber/green status and per-weekday minimum presets.

### Submissions Tracker — v1.0
Counts inbound requests (medical, admin, investigation, prescription) arriving each day against a rolling baseline, with a RAG-threshold alert strip and CSV export.

### Activity Report — v1.0
Practice activity per staff member over a configurable date range, as a stacked bar chart with an optional per-session adjustment and CSV export.

### Referrals Tracker — v1.0
Referral audit data over a configurable date range: totals, priority mix (Routine/Urgent/2WW) and status, as bar charts by clinician, specialty and hospital.

### Reception
A reception-facing view of whichever patient's record is open, plus optional guided-capture question sets for common presenting problems and an inline appointment-booking panel. Guided pathways ship switched off until a practice administrator accepts the disclaimer.
- Guided capture with a signed-off call script (red flags, then a short history set), output as plain text to paste into triage
- Inline booking panel, gated to an open record with no unresolved red flag
- "First available appointment" card for phone answers with no patient record needed

### Signing Queue — v1.0
Every open repeat-prescription request, alongside that patient's recorded drug-monitoring currency, so the pile can be worked riskiest-first. Never implies a request is safe to sign — only that no flag was found.

### Pre-clinic Sweep
Runs the Monitoring rules across every patient booked in today's clinic (or one clinician's list), producing a morning-huddle worklist and printable reception handout before the consultation. Ignores per-workstation dismissed-rule settings by design.

### Practice Knowledge
A practice-owned reference base — referral criteria, contacts, pathways, template text — searchable from the panel, with near-duplicate detection and an optional starter-pack import.

### NHS Patient Leaflets
Fuzzy search of the NHS conditions/medicines leaflet index, with an "Open on nhs.uk" link for every result and, if a practice has configured an API key, leaflet text rendered in-panel.

### Patient Record (live)
A live snapshot of the patient currently open — demographics, coded problems, current medications, recent results, and the same safety scores and monitoring/QOF chips Monitoring computes. Explicitly incomplete (no allergies or immunisations live) and says so on screen, with a copy-to-clipboard summary watermarked as a live snapshot.

### Patient Alerts
Per-patient custom flags a practice defines itself (interpreter required, safeguarding concern, etc.) that surface whenever that patient's record is open — in the panel, an on-page banner, and queue chips. Flags follow confirmed patient identity, not a name.

### Phrases
A personal library of reusable message text blocks that combine into one message the clinician copies into Medicus's own message/comment box. Copy-only — nothing is sent or written by the extension itself. Placeholder text must be manually filled before the Copy button allows a copy.

### Rota
The compact, glanceable half of the Rota Manager, available in the panel and pop-out; the full application opens in its own browser tab.
- Today's duty cover, who's on leave, sessions still needing cover, and this week's high-priority safe-staffing warnings
- Live drift card reconciling today's rota against the real Medicus appointment book each minute (read-only, never persisted)
- Optional passcode protection to lock the module to a read-only card

The full **Rota Manager** (separate browser tab) additionally covers working-pattern templates, session-accounted leave, Bradford-factor/fit-note flags, a cover worklist and shift swaps, duty fairness, demand-led planning, and a drag-and-drop scheduling grid with an annealing solver. Its safe-staffing rules encode BMA/CQC/NHSE guidance, not law — they warn, never block, and every threshold is a practice setting.

### Note
Companion tab for the full-tab **Note** display board (waiting-room TV or staff-room monitor). Pick a style, add or rename boards, edit the flap message, toggle widgets, set the words and when the room looks busy, optionally paste a practice YouTube playlist, and open the kiosk.
- **Waiting room** (public TV) — flap message, people-waiting count, wait-time band (not a named wait in minutes), how-busy from occupancy only by default; optional YouTube playlist (off by default); a dead feed fails loud rather than painting a quiet empty room
- **Ops overview** (staff) — the same aggregates plus Practice Pressure Index, triage inbox and slots remaining; **Message** (public) — flap text and clock
- Up to six extra public or staff boards with their own names, tiles and flap text
- Ten styles (Standard, Clear, Plain, Service, Notice, Sign, Timetable, Console, Lobby, Plaque); Standard also has ten colour options. Paint only — the public-TV lock does not change
- Public profiles, including custom ones, never show patient names, initials or request wording

## In-page features (content scripts)

These run directly on live Medicus pages, on top of Medicus's own UI:

- **Triage queue overlay** — age/status decoration chips, drug-monitoring and result-triage chips, and keyword-based red-flag detection with linked actions, on both the main triage queue and the investigation-results queue
- **Lab allocation canvas** — on the investigation-results queue, an unallocated inbox pile grouped by who requested them, with clinician fields to drag reports onto; staging is local, confirming writes Medicus's own bulk-reassign (who the task sits with — it does not file the result)
- **Workflow allocation canvas** — the same workbench on inbound-document queues and any task-list with a workflow view, grouped by registered GP; confirming writes the same bulk-reassign (it does not file the document)
- **Non-routine prescription allocation canvas** — the same workbench on the non-routine prescription-request queue, with an even-split preview among doctors working today; confirming writes the same bulk-reassign (it does not issue, sign, or file the prescription)
- **Companion (inline booking, tasks, and monitoring)** — a floating role-toggled box (Clinic / Reception / Triage / Nursing) on patient and task pages carrying appointment-booking and create-task panels plus a read-only "What's due" pocket of Sentinel chips for the page's patient. Opt-in on every Medicus screen; resize, minimise, or pop in to an edge tab
- **Document handling** — one-click filing of a patient-submitted attachment as a clinical document, and a checklist that turns a document's coded journal entries into new Problems
- **Reception quick-actions composer** — chip rows above a task's comment box that insert plain-English text only; the clinician still presses Medicus's own Submit
- **Clean up code** — flags outdated or retired SNOMED problem-list codes, suggests a cleaner code or description, and can sync it into a matching consultation-note entry, with one-click undo
- **Organise problems** — a drag-and-drop canvas for ending, re-grading, nesting and linking problems, with suggested links; several tiles can be staged and confirmed together
- **Allergy cleanup** — a canvas for removing low-relevance allergy entries, merging duplicates, clearing stale dual-coding, and converting pre-defined allergies to a coded substance
- **Clean up alerts** — pill on the patient banner; batch-clears Flag on patient banner only (W24)
- **Appointment-book organise** — cancel, move or rebook appointments directly from the diary view, with a fail-safe write path (destination re-checked before writing, failed moves auto-restored)
- **Bulk task actions** — checklist-based acknowledge/discard for the Privacy Officer Alerts and EPS Cancellation Failures queues, reviewed and confirmed as one batch
- **Task presence** — shows a colleague's name on a queue row they already have open, backed by the practice's own shared folder; advisory only, never a lock
- **Background data feeds** — the pipeline behind Monitoring/Trends, a live-update relay so the panel refreshes without polling, and referral-data discovery for the Referrals Tracker

**Full-tab tools:**
- **Duplicate Problem Checker** — finds likely duplicate problems, notes, documents and investigation reports and offers a guided compare/merge/remove workflow, with content-hash verification for documents.
- **Contacts Management** — a drag-and-drop family-tree canvas for a patient's next-of-kin and other contacts, opened from Medicus's own contacts page.
- **Note** — a TV/monitor kiosk (waiting room, staff ops, message, or a practice-made board). Public profiles show aggregates and practice-authored words only — never patient names. An optional YouTube playlist is off by default.

## Alert engine

The Monitoring tab and Sweep both run patient data through the same rules engine. Every rule type is a passive check — none recommend treatment or write to the record.

- **Drug-monitoring** — a medication requires a test within an interval; flags overdue/due-soon/stale
- **Drug-combination** — a set of co-prescribed drugs (optionally requiring or excluding a problem or another drug) triggers a review flag
- **Drug/allergy conflict** — an active medication matched against a recorded active allergy
- **QOF register** — problem-list membership of a QOF register
- **QOF indicator** — threshold or trend check against an observation or medication for a 2025/26 QOF indicator
- **Event count** — counts qualifying events within a rolling window against a threshold
- **Vaccine** — eligibility and due/given/declined status against seasonal or one-off schedules
- **Composite** — combines the results of several other rules into one higher-level flag

The shipped alert library carries 39 starter alerts a practice can enable (36 prescribing-safety, largely drawn from the PINCER indicator set, plus 3 clinical-review alerts), alongside 39 built-in drug-monitoring rules (38 enabled), 81 QOF rules, 7 vaccine rules, and 44 investigation-result threshold rules. Practices can also author their own rules of any type, which arrive disabled until a clinician reviews and switches them on.

## Settings & customisation

- **Practice Profile** — shared-folder managed deployment so rules, thresholds and pathways can be published once and picked up across every machine in the practice
- **Choose your tabs** — show/hide/reorder which side-panel tabs appear
- **Backup / restore** — a suite-wide export/import covering every module's settings in one file
- **Display preferences** — theme, density, and a colour-blind mode
- **Diagnostics** — Event Ledger (machine-local record of what the suite has flagged), Suite health (self-diagnosis of the extension's own data pipeline), and Debug, collapsed into one Settings page

## Recent additions (last 4 weeks)

- **v3.256.0 (31 Aug)** — Non-routine prescription allocation canvas, with even-split among doctors working today
- **v3.255.0 (31 Aug)** — Pruned Follow-ups, Visualiser, About, Condor, CQC Inspection Readiness and Practice Report; Settings collapsed into Queue rules and Diagnostics
- **v3.254.0 (30 Aug)** — Note: optional YouTube playlist on a public TV (off by default; sanitised id only; fail-loud hides the player)
- **v3.248.0–v3.253.1 (29–30 Aug)** — Note: a new full-tab TV/monitor display board (waiting room, ops overview, message and up to six custom boards), now with ten visual styles and ten colour options on the default style
- **v3.249.0–v3.250.0 (29 Aug)** — QOF monitoring rework: disease-register-driven matching, a July 2026 rule refresh, fewer false positives
- **v3.247.0 (27 Aug)** — "Send to routine list": one-click routine-prescription reassignment from the task page
- **v3.246.0 (27 Aug)** — Workflow allocation canvas extended to inbound-document queues and team inboxes
- **v3.242.0–v3.243.9 (25–26 Aug)** — Lab allocation canvas: a drag-and-drop workbench for staging unallocated investigation results by clinician
- **v3.239.0–v3.241.0 (24 Aug)** — Companion HUD: booking, task-creation and a "What's due" monitoring pocket merged into one role-toggled floating box
- **v3.225.0–v3.241.0 (8–24 Aug)** — Organise problems, Allergy cleanup and Appointment-book organise matured into drag-and-drop, multi-select canvases with staged, fail-safe writes
- **v3.236.16–v3.237.2 (22–23 Aug)** — Clinical-safety audit remediation across write paths, plus a formally signed-off reception call script
- **v3.232.0 (14 Aug)** — Rota Manager: optional passcode protection, guided setup assistant, a stronger scheduling solver, and a live check against the real appointment book
- **v3.219.0–v3.222.0 (3–4 Aug)** — Task presence: shows when a colleague already has a triage request open, to reduce duplicated work

## Safety posture

Medicus Suite is a passive display layer by default: everything it shows is read from data already recorded in Medicus, it makes no clinical recommendation, orders nothing, and runs no AI-based inference on patient data. A small, deliberately enumerated set of actions can write back to Medicus — appointment booking, task creation, document filing, routine-prescription reassignment, problem-list tidying, and bulk acknowledge/discard of two routine task types — and every one is user-initiated, explicitly confirmed before it commits, and executed through Medicus's own controls under the clinician's own session, so Medicus's own validation, access control and audit trail apply as normal. No patient data leaves the browser except through one optional, off-by-default read-only feed a practice must deliberately configure. Full detail on scope, hazards and residual risk is maintained in the suite's Intended Purpose statement, Hazard Log and Clinical Safety Notice.
