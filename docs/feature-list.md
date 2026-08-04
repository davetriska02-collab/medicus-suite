# Medicus Suite — Feature List

**Version:** v3.221.0
**Generated:** 2026-08-03 (automated)

## What it is

Medicus Suite is a Chrome extension that sits alongside the Medicus electronic patient record. It adds a side panel with 19 tabs plus a small number of full-tab tools, and a handful of in-page additions on top of Medicus's own screens (queue chips, monitoring context, inline booking, and similar). Everything it shows is drawn from data already in Medicus — it displays, checks, and reminds; it does not diagnose, does not recommend treatment, and does not use AI to interpret anything. A short, explicitly listed set of actions (appointment booking, task creation, document filing, and a few others) can write back to Medicus, and every one of those requires the user to review and confirm before anything happens.

## At a glance

- 19 side-panel modules covering morning workflow, monitoring, capacity/demand, reception, referrals, reminders, staff rota and reference material
- 6 full-tab-style tools: three opened from the panel (Patient Record Visualiser, Duplicate Problem Checker, Rota manager), one triggered from Medicus's own contacts page (Contacts Management), and two reached from Options/Condor (Practice Report, CQC Inspection Readiness)
- roughly 16 in-page content-script features layered onto live Medicus screens (queue chips, inline booking/task/document widgets, code-cleanup tools)
- 8 rule types in the clinical alert engine (drug-monitoring, drug-combo, drug/allergy conflict, qof-register, qof-indicator, event-count, vaccine, composite)
- 34 drug-monitoring rules, 74 QOF rules (14 register + 60 indicator), 5 vaccine rules, 44 investigation-result rules, and 35 starter alerts in the practice alert library (32 prescribing-safety, 3 clinical-review)

## Side-panel modules

### Today
One morning screen: a headline sentence plus waiting-room count, triage queue load, today's medical/admin demand, today's available slots, and the last pre-clinic Sweep status — answering "what needs me right now?" without opening five other tabs.
- Headline sentence rolled up from the cards below
- Waiting-room count with amber/red wait thresholds
- Triage load and today's demand, both with threshold colouring
- Today's available slot count and a link into the last Sweep

### Slot Counter
Available appointment slots by type for any date, read directly from the Medicus scheduling API. Updates live while a Medicus tab is open.
- Slot counts by appointment type, with configurable alert thresholds
- CSV export
- Live updates via the practice's Pusher feed, without the scheduling page open

### Monitoring (Sentinel)
The clinical context sidebar for whichever patient record is open. Checks active medications, problems, and recent results against drug-monitoring intervals and this year's QOF indicators, showing a plain green/amber/red chip for each. Passive display only — never writes to the record, never orders anything, never tells the clinician what to do.
- Drug-monitoring interval chips (overdue / due soon / in date)
- QOF register and indicator achievement chips
- Prescribing-safety scores (ACB, STOPP/START-style)
- Practice custom alert rules, editable from Options
- Coverage view showing meds/problems with no matching rule
- One-click "create task" / "add to Follow-ups" from an action chip

### Trends
Charts a patient's blood pressure, renal function, HbA1c, cholesterol and weight over time, from the same live data Monitoring uses.
- Line charts for BP, eGFR/ACR, HbA1c, cholesterol, weight, with clinical zone bands
- CSV export of the underlying series

### Capacity Forecast
A calendar comparing available appointment capacity against the practice's own configured daily minimums, so a slot gap is visible days or weeks ahead rather than discovered on the day.
- Day/week/month calendar views with per-day red/amber/green status
- Per-day minimum presets, editable per weekday, and a per-session-type breakdown

### Submissions Tracker
Counts inbound requests (medical, admin, investigation, prescription) arriving each day, compared against a rolling baseline so a genuinely unusual day stands out.
- Daily counts by task category, date-range and day-vs-day comparison
- RAG-threshold alert strip when a category runs hot; CSV export

### Activity Report
Practice activity per staff member over a configurable date range — consultations, prescription requests, medication reviews, document tasks, investigation results — as a stacked bar chart and period totals.
- Per-staff-member breakdown, configurable date range
- Optional "per session" adjustment for fair comparison; CSV export

### Referrals Tracker
Referral audit data over a configurable date range: totals, priority mix (Routine/Urgent/2WW), and status, broken down by clinician, specialty, and receiving hospital.
- Bar charts by clinician, specialty, hospital
- Configurable date presets and letterhead-aware export

### Condor
A single live "practice pressure" gauge combining waiting-room load, queue backlog, urgent-task count, and remaining capacity into one score with an amber/red threshold — a busy morning as one number, not four tabs.
- Composite Practice Pressure Index with configurable weightings/thresholds
- A capacity safety floor: never shows green while demand already exceeds capacity
- Daily snapshot history feeding the Practice Report tool; 7-/30-day pulse view

### Reception
A reception-facing view of whichever patient's record is open, plus optional guided-capture question sets for common presenting problems and an inline appointment-booking panel. Guided pathways ship switched off until a practice administrator accepts the disclaimer; booking is only offered when no red flag has been raised.
- Single-glance patient status pill (practice-configurable which chips show)
- Guided capture pathways per presenting problem, red flags surfaced first
- Structured plain-text output to paste into the triage entry — capture only, never a diagnosis
- Inline "book an appointment" panel, gated to an open record with no unresolved red flag

### Signing Queue
Every open repeat-prescription request, alongside that patient's recorded drug-monitoring currency, so the end-of-day signing pile can be worked riskiest-first instead of opening each record blind.
- Monitoring-currency verdict and renal context per queued request
- Location/collection filter pills
- A closing "nothing outstanding" line that never implies a request is safe to sign, only that no flag was found

### Follow-ups
A personal safety-net reminder list — "chase Friday" logged in seconds, resurfacing when the due date passes. Explicitly a personal reminder, not the clinical safety-netting record; the header says so every time it's open.
- Quick-add reminders, optionally linked to the patient open in Monitoring
- Due/overdue sorting and counts; entries stay device-local, not part of suite backups, by design

### Pre-clinic Sweep
Runs the Monitoring rules across every patient booked in today's clinic (or one clinician's list), producing a morning-huddle worklist of overdue monitoring before, not during, the consultation.
- Practice-wide or per-clinician run, in batches to avoid hammering the API
- Printable reception handout of the day's action list
- Deliberately ignores per-workstation dismissed-rule settings — a recall list must not inherit one user's suppressions

### Practice Knowledge
A practice-owned reference base — referral criteria, contacts, pathways, template text — searchable from the panel, with near-duplicate detection when adding new entries.
- Add/edit/search, categorised browsing, optional starter-pack import

### NHS Patient Leaflets
Search of the NHS conditions/medicines leaflet index, with an "Open on nhs.uk" link for every result and, if a practice has configured an API key, the leaflet text rendered in-panel.
- Fuzzy search over the bundled NHS A-Z index, "Open"/"Copy link" per result
- Optional in-panel leaflet rendering (text only, practice opt-in) and a recent-searches list

### Patient Record (live)
A live snapshot of the patient currently open — demographics, coded problems, current medications, recent results, and the same prescribing-safety scores and monitoring/QOF chips Monitoring computes — sourced from the API rather than an exported PDF. Explicitly incomplete (no allergies or immunisations live) and says so on screen; the deep multi-year view stays in the full PDF visualiser.
- Demographics, problems, medications, recent results in one screen
- Gap-markers (not silent blanks) where data isn't available live
- Copy-to-clipboard summary, watermarked as a live snapshot to verify against the record

### Patient Alerts
Per-patient custom flags a practice defines itself (interpreter required, safeguarding concern, etc.) that surface automatically whenever that patient's record is open — in the panel, an on-page banner, and queue chips.
- Add/edit/remove flags, browse every flagged patient, customisable quick-add palette
- Flags follow patient identity, not a name — nothing shows if identity can't be confirmed

### Phrases
A personal library of reusable message text blocks (opener, substance, safety-net, next step, sign-off) that combine into one message the clinician copies into Medicus's own message/comment box. Copy-only: nothing is sent or written by the extension itself.
- Compose mode: quick slot-chip rows build one message fast; Library mode: full search/categories/edit
- Placeholder text (***) must be manually filled before copying — the Copy button blocks a careless copy

### Rota (Practice rota)

The compact, glanceable half of the Rota Manager — available in both the side panel and the pop-out window. The full application opens in its own browser tab from the **Rota manager** tab (side panel) or Ctrl+K → "Open Rota manager".

- Duty cover for today, AM and PM, with an OK/Gap state and the named duty doctors
- Who is on approved leave today; upcoming sessions still flagged as vacancies needing cover
- This week's high-priority safe-staffing warnings (duty cover, registrar supervision, HCA supervision)
- Estimated GP appointments this week against the ~72-per-1,000-patients access benchmark
- Reads only local extension storage; performs no network calls and persists no patient-identifiable data

The **full Rota Manager** (its own browser tab) covers working patterns and multi-week templates, session-accounted leave on an April–March leave year, Bradford-factor and fit-note flags, the cover worklist and shift swaps, duty fairness pro-rata to contracted sessions, demand-led planning, and read-only reconciliation against the Medicus appointment book. Its safe-staffing rules encode BMA/CQC/NHSE guidance, not law — they warn, they never block, and every threshold is a practice setting.

## In-page features (content scripts)

- **Triage Lens** — decoration chips on the request queue (age, flags) plus keyword-based red-flag detection with linked actions (Samaritans, risk-assessment snippets)
- **Triage Lens investigation-results queue** — the same overlay applied to the lab-results queue, flagging results against configured thresholds
- **Lab Results Auto-Filing button** — files a lab result as normal (driving Medicus's own filing controls) only when every parameter is confirmed within normal limits
- **Prescribing workflow button** — one-click re-assignment of a routine prescription request to the practice's configured team, driving Medicus's own UI
- **Inline appointment booking / task creation** — booking and create-task panels injected on task/patient pages, using Medicus's own scheduling and task-creation endpoints
- **Save attachment as document** — one-click filing of a patient-submitted photo/attachment as a clinical document, via Medicus's own upload endpoint
- **Sentinel content script** — the data pipeline feeding Monitoring's drug/QOF chips and Trends' charts
- **Reception quick-actions composer** — three chip rows (Action / With whom / Timeframe) above a task's Internal Comment box; inserts plain-English text only, the clinician still presses Medicus's own Submit
- **Clean up code** — flags outdated/retired SNOMED problem-list codes and suggests a cleaner description or replacement code
- **Bulk end problems** — inline checkboxes next to every active problem on the Clinical Summary (wherever the summary panel renders: care-record page, task view, appointment view, consultation view), for ending several entries in one batch
- **Organise problems** — an "Organise problems?" trigger on the Clinical Summary (wherever the summary panel renders) with four confirmed-write sections: SNOMED-ancestry nesting suggestions, a "Merge duplicate copies" flow (keeper chosen, others retired via the Duplicate Checker's confirmed removal write), a "Change significance" batch re-grader riding Medicus's own edit form, and a manual parent-first link builder; every batch explicitly confirmed with each problem listed
- **Allergy cleanup suite** — one "Clean up allergies?" trigger on the Clinical Summary (care-record page and the task view's embedded summary panel alike) covering junk/import-artefact code removal, duplicate-entry merge (with per-card exclude and an explicit clinical-decision review step), clearing a stale legacy code alongside an already-correct one, and converting a legacy pre-defined-allergy code to a proper coded substance — every action requires explicit confirmation, nothing is auto-applied
- **Task presence** — stops two clinicians unknowingly working the same triage request: a "👁 name" chip on any queue row a colleague currently has open, and an advisory banner when you open a request they're already in. Fire-and-forget rollout: one `presence-config.json` dropped into the shared extension folder configures every machine (docs/task-presence-setup.md). Advisory only, never a lock; absence of a chip never means nobody is there. (A "last actioned by" chip is wired but latent — Medicus currently sends those fields empty.)
- **Pusher relay** — keeps the panel's live data current via the practice's real-time feed
- **Referrals discovery** — watches the referrals audit-report page and feeds discovered data to the Referrals Tracker tab

**Full-tab tools:**
- **Patient Record Visualiser** — analyses an exported Medicus PDF locally to build a multi-tab clinical dashboard: continuity indices, investigation trends, medication-monitoring compliance, frailty index, prescribing-safety flags, QOF register status, and an event timeline. Nothing leaves the browser.
- **Duplicate Problem Checker** — finds likely duplicate problems, notes, and documents (including ones carried over via GP2GP) and offers a guided compare/merge/remove workflow, always requiring explicit confirmation before anything is removed.
- **Contacts Management** — a drag-and-drop family-tree canvas for a patient's next-of-kin and other contacts, opened from a button on Medicus's own contacts page: places candidate contacts visually, flags next-of-kin/copy-correspondence status, matches contacts across GP2GP-merged records by name (including non-English naming patterns), and lets a wrongly-placed contact be removed from the tree.
- **Practice Report** — a printable snapshot report built from Condor's daily pressure-index history.
- **CQC Inspection Readiness** — a printable summary for inspection preparation, reached from Options or the command palette.

## Alert engine

The Monitoring tab and Sweep both run patient data through the same rules engine. Every rule type is a passive check — none of them recommend treatment or write to the record.

- **Drug-monitoring** — drug X requires test Y within an interval; flags overdue/due-soon/stale
- **Drug-combination** — a set of co-prescribed drugs (optionally requiring or excluding a problem, or requiring/forbidding another drug) triggers a review flag, e.g. NSAID without gastroprotection
- **Drug/allergy conflict** — an active medication matched against a recorded active allergy
- **QOF register** — problem-list membership of a QOF register
- **QOF indicator** — threshold check against an observation or medication for a 2025/26 QOF indicator
- **Event count** — counts qualifying events (e.g. exacerbations) within a rolling window against a threshold
- **Vaccine** — eligibility and due/given/declined status against seasonal or one-off vaccination schedules
- **Composite** — combines the results of several other rules into one higher-level flag

The shipped alert library carries 35 starter alerts a practice can enable (32 prescribing-safety, largely sourced from the PINCER prescribing-safety indicator set, plus 3 clinical-review alerts), alongside 34 built-in drug-monitoring rules, 74 QOF rules (14 register, 60 indicator), 5 vaccine rules, and 44 investigation-result threshold rules for the results queue. Practices can also author their own rules of any type from Options, which arrive disabled by default and must be reviewed and switched on by a clinician before they fire.

## Settings & customisation

- **Practice Profile** — shared-folder managed deployment so config (rules, thresholds, pathways) can be published once and picked up across every machine in the practice
- **Choose your tabs** — show/hide/reorder which side-panel tabs appear
- **Backup / restore** — a suite-wide export/import covering every module's settings in one file
- **Display preferences** — theme, density, and a colour-blind mode
- **Event Ledger** — a machine-local record of what the suite has flagged, for audit and troubleshooting
- **Suite health** — self-diagnosis of the extension's own data pipeline, surfaced as an amber-only strip when something is degraded

## Recent additions (last 4 weeks)

- **v3.219.0 (2026-08-03)** — "Change significance": batch re-grade problems between Major/Minor/Unknown via Medicus's own edit form, with per-row current-grade display and explicit move-by-move confirm; the problems widget trigger renamed to "Organise problems?".
- **v3.218.0 (2026-08-03)** — The record-tidy widgets (bulk end, nesting, allergy cleanup) now work on any page that renders the Clinical Summary panel — appointment and consultation views included — via a page-world bridge that reads the patient from the page's own summary fetch, with a wrong-patient row-match guard.
- **v3.217.0 (2026-08-03)** — Nest problems gains an in-panel "Merge duplicate copies" section: same-code duplicate problems merged down to a chosen keeper using the Duplicate Checker's confirmed removal contract, with children-protected copies excluded and additional-info copies cautioned.
- **v3.216.0 (2026-08-03)** — Nest problems' manual builder goes parent-first and multi-child: tick several problems and nest them under one parent in a single confirmed batch.
- **v3.215.0 (2026-08-03)** — Nest problems gains a manual "Link manually" builder: nest any problem under any other (re-parenting and same-code pairs included, cycle-guarded), alongside the SNOMED-ancestry suggestions.
- **v3.214.0 (2026-08-03)** — "Nest problems?": suggested parent/child problem links on the Clinical Summary, driven by SNOMED ancestry between the problems already on the record, each link individually reviewed and confirmed; works on both the care-record and task ("split") pages.
- **v3.213.0 (2026-08-03)** — "Bulk remove?" and "Clean up allergies?" now also run on the task ("split") page's embedded Clinical Summary panel, not just the full care-record page — same scans, review steps and confirmations, with the patient resolved from the task itself.
- **v3.212.0 (2026-08-02)** — Allergy cleanup suite: a single "Clean up allergies?" trigger folding in junk/low-relevance-code removal, duplicate-entry merge, dual-coded (legacy code alongside an already-correct substance) cleanup, and pre-defined-allergy-to-substance conversion, each with its own review step appropriate to how much clinical judgement it needs.
- **v3.211.0 (2026-08-02)** — Rota Manager subsumed into the suite: a full rota application in its own browser tab (**Rota manager**) plus a compact **Rota** module in the panel and pop-out; all eight `rota.*` storage keys covered by the suite backup. The standalone Medicus Rota Manager extension is deprecated.
- **v3.192.0–v3.210.0 (26 Jul – 1 Aug)** — Contacts Management: a new tool for managing a patient's next-of-kin and family contacts as a drag-and-drop family tree, with review-driven fixes for wrong-record flagging safety, a confirmable and repairable "remove from tree" action, and better name-matching for contacts carried over from a previous practice.
- **v3.176.13–v3.196.0 (22–28 Jul)** — Clean up code (renamed from "Fix description"): flags outdated/retired SNOMED problem-list codes and suggests a cleaner replacement, extended to catch more patterns, plus a "bulk end problems" companion tool and per-practice learning of preferred replacements.
- **v3.197.0–v3.206.0 (28–31 Jul)** — Reception's quick-actions composer went through three rounds of layout hardening after feedback that the comment box was being visually crushed, plus clearer two-step "insert, then submit" wording.
- **Duplicate-checker enhancements (through 8–17 Jul)** — cross-record file-matching, document removal, and side-by-side note/consultation comparison added, continuing its build-out for GP2GP-merged records.
- **New tabs (7–31 Jul)** — Follow-ups (personal safety-net reminders), Signing Queue (monitoring context on the repeat-prescription pile), and Phrases (copy-only message blocks) all launched.
- **Patient Alerts (16–18 Jul)** — a new per-patient custom-flag feature (interpreter required, safeguarding concern), surfaced across the panel, an on-page banner, and queue chips.
- **The Keeper rule-set updates (25 Jul, 1 Aug)** — clinical rule-content refreshes, including a vaccine-eligibility fix, a guard against a vaccine wrongly marked as given, and groundwork for digoxin monitoring.
- **Transactional feed groundwork (7–9 Jul)** — an alternative, off-by-default data source for Monitoring/Trends behind a practice-level switch, bringing a new drug/allergy conflict rule type; dormant unless explicitly turned on.
- **Suite reliability fixes (throughout)** — fixes to demand-count accuracy, a false-alarming health strip, backup/restore failures, and cross-machine profile sync — none changing what a tab displays, only making it more trustworthy.

## Safety posture

Medicus Suite is a passive display layer by default: everything it shows is read from data already recorded in Medicus, and it makes no clinical recommendation, orders nothing, and runs no AI-based inference on patient data. A small, deliberately enumerated set of actions can write back to Medicus — appointment booking, general-task creation, inbound-document filing, normal-lab-result filing, routine-prescription re-assignment, and problem-list tidying — and every one of them is user-initiated, explicitly confirmed at the point of commit, and executed through Medicus's own controls under the clinician's own session, so Medicus's own validation, access control and audit trail apply as normal. No patient data leaves the browser except through the one optional, off-by-default Transactional API read path a practice must deliberately configure. Full detail on scope, hazards, and residual risk is maintained in `docs/INTENDED-PURPOSE.md`, `docs/HAZARD-LOG.md`, and `docs/CLINICAL-SAFETY-NOTICE.md`.
