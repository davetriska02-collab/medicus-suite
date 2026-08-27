# Medicus Suite — Feature List

**Version:** v3.245.0
**Generated:** 2026-08-26 (automated)

## What it is

Medicus Suite is a Chrome extension that sits alongside the Medicus electronic patient record. It adds a side panel with 19 tabs, a handful of full-tab tools, and a set of small additions layered onto Medicus's own screens (queue chips, monitoring context, inline booking, and similar). Everything it shows is drawn from data already in Medicus — it displays, checks and reminds, never diagnoses, never recommends treatment, and runs no AI-based interpretation of patient data. A short, explicitly listed set of actions can write back to Medicus (booking, task creation, document filing, problem-list tidying and a few others), and each one requires the user to review and confirm before anything happens.

## At a glance

- 19 side-panel modules covering morning workflow, monitoring, capacity/demand, reception, referrals, reminders, staff rota and reference material
- 5 full-tab tools reached from the panel or from Medicus's own pages (Patient Record Visualiser, Duplicate Problem Checker, Rota Manager, Contacts Management, Practice Report / CQC Inspection Readiness)
- around 14 in-page feature groups layered onto live Medicus screens (queue chips, inline booking/task/document widgets, problem and allergy tidying tools)
- 8 rule types in the clinical alert engine
- 32 built-in drug-monitoring rules (31 enabled), 74 QOF rules (14 register + 60 indicator), 5 vaccine rules, 44 investigation-result threshold rules, and 37 starter alerts in the practice alert library (34 prescribing safety, 3 clinical review)

## Side-panel modules

### Today — v1.0
One morning screen: a headline sentence plus waiting-room count, triage queue load, today's demand, today's available slots, and the last pre-clinic sweep status.
- Headline sentence rolled up from the cards below
- Waiting-room count with amber/red wait thresholds
- Triage load and demand counts, both threshold-coloured
- Link into today's slot count and the last sweep run

### Slot Counter — v2.2
Available appointment slots by type for any date, read directly from Medicus's scheduling data, with live updates while a Medicus tab is open.
- Slot counts by type with configurable alert thresholds
- CSV export
- "First available appointment" lookup with a one-click booking handoff
- Typable appointment-type filter on the booking picker

### Monitoring (Sentinel) — v0.5.1
The clinical context sidebar for whichever patient record is open. Checks active medications, problems and recent results against drug-monitoring intervals and this year's QOF indicators, showing a plain green/amber/red chip for each. Passive display only — never writes to the record, never orders anything, never tells the clinician what to do.
- Drug-monitoring interval chips (overdue / due soon / in date)
- QOF register and indicator achievement chips
- Prescribing-safety scores (ACB, STOPP/START-style)
- Practice-editable custom alert rules
- Coverage view showing meds/problems with no matching rule
- One-click "create task" / "add to Follow-ups" from a chip

### Trends
Charts a patient's blood pressure, renal function, DOAC creatinine clearance, HbA1c, cholesterol and weight over time, from the same live data Monitoring uses.
- Line charts with clinical zone bands
- DOAC-only view (gated on a current DOAC) with Cockcroft-Gault CrCl, not eGFR
- CSV export of the underlying series

### Capacity Forecast
A calendar comparing available appointment capacity against the practice's own configured daily minimums, so a slot gap is visible days or weeks ahead.
- Day/week/month views with per-day red/amber/green status
- Per-weekday minimum presets and a per-session-type breakdown

### Submissions Tracker — v1.0
Counts inbound requests (medical, admin, investigation, prescription) arriving each day against a rolling baseline, so an unusual day stands out.
- Daily counts by category, date-range and day-vs-day comparison
- RAG-threshold alert strip; CSV export

### Activity Report — v1.0
Practice activity per staff member over a configurable date range, as a stacked bar chart and period totals.
- Per-staff-member breakdown, configurable date range
- Optional "per session" adjustment; CSV export

### Referrals Tracker — v1.0
Referral audit data over a configurable date range: totals, priority mix (Routine/Urgent/2WW) and status.
- Bar charts by clinician, specialty, hospital
- Configurable date presets and letterhead-aware export

### Condor
A single live "practice pressure" gauge combining waiting-room load, queue backlog, urgent-task count and remaining capacity into one score — a busy morning as one number.
- Composite pressure index with configurable weightings/thresholds
- A capacity safety floor: never shows green while demand already exceeds capacity
- Daily snapshot history feeding the Practice Report tool

### Reception
A reception-facing view of whichever patient's record is open, plus optional guided-capture question sets for common presenting problems and an inline appointment-booking panel. Guided pathways ship switched off until a practice administrator accepts the disclaimer.
- Single-glance, practice-configurable patient status pill
- Guided capture pathways with a signed-off call script (red flags, then a short history set)
- Structured plain-text output to paste into the triage entry
- Inline booking panel, gated to an open record with no unresolved red flag
- "First available appointment" card for phone answers with no patient record needed

### Signing Queue — v1.0
Every open repeat-prescription request, alongside that patient's recorded drug-monitoring currency, so the pile can be worked riskiest-first.
- Monitoring-currency verdict and renal context per request
- Location/collection filter pills
- Never implies a request is safe to sign — only that no flag was found

### Follow-ups — v1.0
A personal safety-net reminder list — "chase Friday" logged in seconds, resurfacing when the due date passes. Explicitly a personal reminder, not the clinical safety-netting record.
- Quick-add reminders, optionally linked to the open patient
- Due/overdue sorting; entries stay device-local, not part of suite backups

### Pre-clinic Sweep
Runs the Monitoring rules across every patient booked in today's clinic (or one clinician's list), producing a morning-huddle worklist before the consultation.
- Practice-wide or per-clinician run, in batches
- Printable reception handout
- Ignores per-workstation dismissed-rule settings by design

### Practice Knowledge
A practice-owned reference base — referral criteria, contacts, pathways, template text — searchable from the panel, with near-duplicate detection.
- Add/edit/search, categorised browsing, optional starter-pack import

### NHS Patient Leaflets
Search of the NHS conditions/medicines leaflet index, with an "Open on nhs.uk" link for every result and, if a practice has configured an API key, leaflet text rendered in-panel.
- Fuzzy search over the bundled NHS A-Z index
- Optional in-panel leaflet rendering (text only) and a recent-searches list

### Patient Record (live)
A live snapshot of the patient currently open — demographics, coded problems, current medications, recent results, and the same safety scores and monitoring/QOF chips Monitoring computes. Explicitly incomplete (no allergies or immunisations live) and says so on screen.
- Demographics, problems, medications, recent results in one screen
- Gap-markers, not silent blanks, where data isn't available live
- Copy-to-clipboard summary, watermarked as a live snapshot

### Patient Alerts
Per-patient custom flags a practice defines itself (interpreter required, safeguarding concern, etc.) that surface whenever that patient's record is open — in the panel, an on-page banner, and queue chips.
- Add/edit/remove flags, browse every flagged patient
- Flags follow confirmed patient identity, not a name

### Phrases
A personal library of reusable message text blocks that combine into one message the clinician copies into Medicus's own message/comment box. Copy-only — nothing is sent or written by the extension itself.
- Compose mode: quick slot-chip rows build one message fast
- Library mode: full search, categories, edit
- Placeholder text must be manually filled before the Copy button allows a copy

### Rota
The compact, glanceable half of the Rota Manager, available in the panel and pop-out; the full application opens in its own browser tab.
- Today's duty cover, who's on leave, sessions still needing cover
- This week's high-priority safe-staffing warnings
- Live drift card: reconciles today's rota against the real Medicus appointment book each minute (read-only, never persisted)
- Optional passcode protection can lock the module to a read-only card

The full **Rota Manager** (separate browser tab) additionally covers working-pattern templates, session-accounted leave, Bradford-factor/fit-note flags, a cover worklist and shift swaps, duty fairness, demand-led planning, and a drag-and-drop scheduling grid with an annealing solver. Its safe-staffing rules encode BMA/CQC/NHSE guidance, not law — they warn, never block, and every threshold is a practice setting.

## In-page features (content scripts)

These run directly on live Medicus pages, on top of Medicus's own UI:

- **Triage queue overlay** — age/status decoration chips, drug-monitoring and result-triage chips, and keyword-based red-flag detection with linked actions, on both the main triage queue and the investigation-results queue; compresses into a compact "pulse" display on busy queues.
- **Lab allocation canvas** — on the investigation-results queue, an unallocated inbox pile grouped by who requested them, with clinician fields on the right (In today first; click to expand) and practice teams as extra drop targets. Click a report or a clinician heading; Ctrl-click (or Select all) adds more; drag onto a field. Staging is local; confirming writes Medicus's own bulk-reassign (who the task sits with — it does not file the result).
- **Inline booking and task creation** — appointment-booking and create-task panels injected directly on patient and task pages, using Medicus's own scheduling and task-creation controls. The same floating **Companion** box (Clinic / Reception / Triage / Nursing) carries a read-only pocket Sentinel **What’s due** strip (drug monitoring, QOF, vaccines) identity-gated to this page’s patient — reception in booking voice, nursing in treatment-room voice — plus honest desk / slots / pulse glances by role. Opt-in on every Medicus screen; resize, minimise, or pop in to an edge tab.
- **Document handling** — one-click filing of a patient-submitted attachment as a clinical document; a checklist that turns a document's coded journal entries into new Problems.
- **Reception quick-actions composer** — three chip rows (Action / With whom / Timeframe) above a task's comment box that insert plain-English text only; the clinician still presses Medicus's own Submit.
- **Clean up code** — flags outdated or retired SNOMED problem-list codes, suggests a cleaner code or description, and can sync a cleaned-up code or text into a matching consultation-note entry, with one-click undo.
- **Organise problems** — a drag-and-drop canvas for ending, re-grading, nesting and linking problems, with SNOMED- and text-based suggested links; tick several tiles (or Ctrl/⌘-click) and drag the set together; every change staged, then confirmed together.
- **Allergy cleanup** — a canvas for removing low-relevance allergy entries, merging duplicates, clearing stale dual-coding, and converting pre-defined allergies to a coded substance; tick several tiles and drag the set onto End or Dual-coded.
- **Clean up alerts** — pill on the patient banner; batch-clears Flag on patient banner only (W24).
- **Appointment-book organise** — cancel, move or rebook appointments directly from the diary view.
- **Bulk task actions** — checklist-based acknowledge/discard for the Privacy Officer Alerts and EPS Cancellation Failures queues, reviewed and confirmed as one batch.
- **Task presence** — shows a colleague's name on a queue row they already have open, backed by the practice's own shared folder; advisory only, never a lock.
- **Background data feeds** — the pipeline behind Monitoring/Trends, a live-update relay so the panel refreshes without polling, and referral-data discovery for the Referrals Tracker.

**Full-tab tools:**
- **Patient Record Visualiser** — analyses an exported Medicus PDF locally into a multi-tab clinical dashboard (continuity, investigation trends, medication compliance, frailty, prescribing-safety flags, QOF status, event timeline). Nothing leaves the browser.
- **Duplicate Problem Checker** — finds likely duplicate problems, notes, documents and investigation reports and offers a guided compare/merge/remove workflow. Same-size/type document groups can be verified by content hash before removal.
- **Contacts Management** — a drag-and-drop family-tree canvas for a patient's next-of-kin and other contacts, opened from Medicus's own contacts page.
- **Practice Report** — a printable snapshot built from Condor's pressure-index history.
- **CQC Inspection Readiness** — a printable inspection-preparation summary.

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

The shipped alert library carries 37 starter alerts a practice can enable (34 prescribing-safety, largely drawn from the PINCER indicator set, plus 3 clinical-review alerts), alongside 32 built-in drug-monitoring rules (31 enabled), 74 QOF rules, 5 vaccine rules, and 44 investigation-result threshold rules. Practices can also author their own rules of any type, which arrive disabled until a clinician reviews and switches them on.

## Settings & customisation

- **Practice Profile** — shared-folder managed deployment so rules, thresholds and pathways can be published once and picked up across every machine in the practice
- **Choose your tabs** — show/hide/reorder which side-panel tabs appear
- **Backup / restore** — a suite-wide export/import covering every module's settings in one file
- **Display preferences** — theme, density, and a colour-blind mode
- **Event Ledger** — a machine-local record of what the suite has flagged, for audit and troubleshooting
- **Suite health** — self-diagnosis of the extension's own data pipeline, surfaced as an amber-only strip when something is degraded

## Recent additions (last 4 weeks)

- **Companion HUD** — the floating booking/task panel is now one role-toggled box (Clinic / Reception / Triage / Nursing) on task pages, the care-record and the queue, and on every other Medicus screen if you opt in. Resize, minimise, or pop it in to an edge tab so it does not cover the page. What’s due stays a four-line pocket of Sentinel’s action-needed chips (reception uses booking voice; nursing uses treatment-room voice). Desk / slots / pulse are operational glances and stay unknown on failure. Identity-gated; no second clinical fetch. v3.240.2: red-severity wins the visible four; overflow expands in-widget; Monitoring / Slot Counter open from the box; reception gets a book-type hint and this-patient future appointments.
- **Clinical-safety audit remediation** — an adversarial audit of the write paths, the fail-closed rules and the safety documentation was acted on in full: the automated lab-filing gate now refuses anything it cannot judge (unreadable rows, unconfirmable units, ambiguous or cross-matched analyte ranges), the outstanding-investigation tick-off became opt-in and is now listed in the public write inventory, the transactional feed refuses writes in code rather than only in prose, and two hazard entries that had never reached the register were recovered.
- **Organise-canvas fail-safe write paths** — the appointment-organise canvas's failure modes were closed after an adversarial review: moves now prove the destination window is still free on the fresh board before writing, a failed stretch re-creates the original booking (with an urgent named-patient error if even that fails), the confirmation overlay freezes while a batch is being written, and the "Tell the patient" opt-in is described honestly everywhere it appears (and never offered on a stretch).
- **Ten new clinical rules (The Keeper gap analysis)** — an expanded rule-currency sweep filled the ten highest-impact gaps: an adult fever call-script pathway including neutropenic-sepsis screening (plus a chemotherapy flag on the child fever pathway, both pending clinical safety sign-off before enabling); thiazide and denosumab monitoring chips; opioid-with-sedative and valproate-in-men prescribing-safety alerts (and a fix so brand-only lithium prescriptions fire the existing lithium alerts); the five remaining SMI physical-health QOF indicators; pneumococcal and shingles vaccine chips for at-risk under-65s and immunosuppressed adults; and three STOPP/START medication-review checks for bone protection and opioid-without-laxative.
- **Write-path governance** — every action that can write back to Medicus is now named in a public inventory, cross-checked by an automated test, with the public docs rewritten to describe the real (enumerated-writes) safety posture rather than a blanket "read-only" claim.
- **Record-tidying tools matured into canvases** — Organise problems, Allergy cleanup and Appointment organise moved from one-at-a-time popups to full drag-and-drop canvases where several changes are staged and then committed together; Clean up code gained the ability to sync a cleaned SNOMED code or description into a matching consultation-note entry, with one-click undo.
- **Reception call script signed off** — the guided-capture red-flag script was reworked to two same-tier safety-check lists plus a short history set, and formally signed off by the practice's clinical safety officer.
- **Rota Manager upgrade** — optional passcode protection, a guided first-run setup assistant, drag-and-drop grid improvements (multi-select, copy/paste, undo/redo), a stronger automatic-scheduling solver, and a live check of today's rota against the real appointment book.
- **Task and queue polish** — bulk acknowledge/discard on routine task queues, and a round of fixes keeping queue chips positioned correctly and readable on busy task and investigation-results lists.
- **Contacts Management** — a new drag-and-drop family-tree tool for a patient's next-of-kin and contacts, opened directly from Medicus's own contacts page.
- **Clinical rule-set refresh** — the periodic rule-currency review added and expanded several drug-monitoring rules, closed brand-name gaps, and corrected a vaccine-eligibility date window.
- **Task presence** — a new indicator showing when a colleague already has a triage request open, to reduce duplicated work on the same request.

## Safety posture

Medicus Suite is a passive display layer by default: everything it shows is read from data already recorded in Medicus, it makes no clinical recommendation, orders nothing, and runs no AI-based inference on patient data. A small, deliberately enumerated set of actions can write back to Medicus — appointment booking, task creation, document filing, routine-prescription reassignment, problem-list tidying, and bulk acknowledge/discard of two routine task types — and every one is user-initiated, explicitly confirmed before it commits, and executed through Medicus's own controls under the clinician's own session, so Medicus's own validation, access control and audit trail apply as normal. No patient data leaves the browser except through one optional, off-by-default read-only feed a practice must deliberately configure. Full detail on scope, hazards and residual risk is maintained in the suite's Intended Purpose statement, Hazard Log and Clinical Safety Notice.
