# Medicus Suite — Feature List

**Version:** v3.233.0
**Generated:** 2026-08-14 (automated)

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
- "First available appointment" lookup: starred favourite types as one-click tiles, plus a typable type filter — earliest slot in the next 4 weeks, with a "Book →" handoff into the booking section (type + day pre-filled; patient checks unchanged); the same section appears as a card on the Reception tab
- Typable appointment-type filter on the booking section's picker (type "acute" to narrow the list; a single match auto-selects)

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
- "First available appointment" card (shared with the Slot Counter tab): one-click "when is the next FCP?" answers for the phone — no patient record needed, with a "Book →" handoff into the Slots booking section
- Typable appointment-type filter on the booking panel's picker (type "acute" to narrow the list; a single match auto-selects)

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
- Placeholder text (\*\*\*) must be manually filled before copying — the Copy button blocks a careless copy

### Rota (Practice rota)

The compact, glanceable half of the Rota Manager — available in both the side panel and the pop-out window. The full application opens in its own browser tab from the **Rota manager** tab (side panel) or Ctrl+K → "Open Rota manager".

- Duty cover for today, AM and PM, with an OK/Gap state and the named duty doctors
- Who is on approved leave today; upcoming sessions still flagged as vacancies needing cover
- This week's high-priority safe-staffing warnings (duty cover, registrar supervision, HCA supervision)
- Estimated GP appointments this week against the ~72-per-1,000-patients access benchmark
- **Live drift card**: reconciles today's rota against the live Medicus appointment book each minute (read-only fetch, counted transiently, never persisted); green only after a completed zero-finding check, red for missing/ghost clinics, amber for minor drift or an unavailable check — with an opt-in notification on new red drift
- Reads local extension storage plus the read-only appointment-book check above; persists no patient-identifiable data
- When the rota's passcode protection is set to strict, the module stops fetching and shows a locked card instead

The **full Rota Manager** (its own browser tab) covers working patterns and multi-week templates, session-accounted leave on an April–March leave year, Bradford-factor and fit-note flags, the cover worklist and shift swaps, duty fairness pro-rata to contracted sessions, demand-led planning, and read-only reconciliation against the Medicus appointment book. Its safe-staffing rules encode BMA/CQC/NHSE guidance, not law — they warn, they never block, and every threshold is a practice setting. A first-run setup assistant goes from install to a working rota in about three minutes (connect to Medicus with a review-before-import step, load a sample practice, or set up by hand), and an optional passcode gate keeps editing to partners and managers — staff view stays read-only with self-service leave requests and swap proposals, or a strict mode locks the app entirely. The grid supports drag-and-drop with live validity feedback, Excel-style rectangle selection, copy/paste, undo/redo, an interactive rooms view, and a discoverable shortcuts strip; the annealing solver additionally allocates enhanced-access sessions, respects avoid-duty preferences, and resolves room clashes, explaining its score dimension by dimension.

## In-page features (content scripts)

- **Triage Lens** — decoration chips on the request queue (age, flags) plus keyword-based red-flag detection with linked actions (Samaritans, risk-assessment snippets)
- **Triage Lens investigation-results queue** — the same overlay applied to the lab-results queue, flagging results against configured thresholds
- **Lab Results Auto-Filing button** — files a lab result as normal (driving Medicus's own filing controls) only when every parameter is confirmed within normal limits
- **Prescribing workflow button** — one-click re-assignment of a routine prescription request to the practice's configured team, driving Medicus's own UI
- **Inline appointment booking / task creation** — booking and create-task panels injected on task/patient pages, using Medicus's own scheduling and task-creation endpoints
- **Save attachment as document** — one-click filing of a patient-submitted photo/attachment as a clinical document, via Medicus's own upload endpoint
- **Sentinel content script** — the data pipeline feeding Monitoring's drug/QOF chips and Trends' charts
- **Reception quick-actions composer** — three chip rows (Action / With whom / Timeframe) above a task's Internal Comment box; inserts plain-English text only, the clinician still presses Medicus's own Submit
- **Clean up code** — flags outdated/retired SNOMED problem-list codes and suggests a cleaner description or replacement code. Also detects journal (consultation) entries that duplicate the problem's clinical event — matched by Medicus's own linked-problems references, date and wording across nine confidence tiers, with the true per-note record date fetched to disambiguate several identically-worded candidates — and can sync the problem's cleaned-up code (and separately its cleaned "additional info" text) into the matching journal entry, via a per-match button or an automatic prompt right after a fix; every journal write is individually confirmed, names the exact before/after, and carries a one-click Undo that restores the entry's previous code or text
- **Bulk end problems** — inline checkboxes next to every active problem on the Clinical Summary (wherever the summary panel renders: care-record page, task view, appointment view, consultation view), for ending several entries in one batch
- **Organise problems** — an "Organise problems?" trigger on the Clinical Summary (wherever the summary panel renders): a "Merge duplicate copies" flow (keeper chosen, others retired via the Duplicate Checker's confirmed removal write), a "Change significance" batch re-grader riding Medicus's own edit form, and an "Organise on canvas…" full-screen drag-and-drop canvas replacing the former suggestion/manual-link accordion sections — problem list as a date-sorted parent/child tree, a SNOMED/practice-override suggestion tray with connector lines, drag (or keyboard pick-up/drop) any tile onto any other to propose a link (a drop offers both nesting and a flat "related problems" link), per-tile "Remove link" / "Edit problem…" actions, read-only linked-problems visualisation; cycle-guarded, every write individually confirmed (with an explicit "will move" disclosure when a nest replaces an existing link). The tray also surfaces "(Grouped with X)" GP2GP import-text references resolved against the patient's own problem list (exact/word-overlap matching only, ties never guessed) as link/nest offers with automatic import-text cleanup after commit, and flags Unknown-significance problems for an explicit Major/Minor choice; the same "(Grouped with X)" offer appears inline in the Clean-up-code panel with its own two-step confirm
- **Allergy cleanup suite** — one "Clean up allergies?" trigger on the Clinical Summary (care-record page and the task view's embedded summary panel alike) covering junk/import-artefact code removal, duplicate-entry merge (with per-card exclude and an explicit clinical-decision review step), clearing a stale legacy code alongside an already-correct one, and converting a legacy pre-defined-allergy code to a proper coded substance — every action requires explicit confirmation, nothing is auto-applied
- **Bulk task actions** — "Bulk acknowledge?" / "Bulk discard?" checklists on two routine, low-risk task queues (Privacy Officer Alerts and EPS Cancellation Failures), where Medicus's own UI is one dialog per row; tasks are ticked from a standalone checklist keyed by each task's stable identifier (never grid-row position), reviewed on an explicit confirm step listing exactly what will be acted on and what is kept, then committed through Medicus's own task endpoints
- **Task presence** — stops two clinicians unknowingly working the same triage request: a "👁 name" chip on any queue row a colleague currently has open, and an advisory banner when you open a request they're already in. The store is the practice's own shared folder — presence files on your own network, nothing sent anywhere else; setup is one click per machine (Options → Task Presence → Choose folder, docs/task-presence-setup.md). Advisory only, never a lock; absence of a chip never means nobody is there. (Hosted-store alternative remains for practices without a shared folder.)
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

- **Practice Profile** — shared-folder managed deployment so config (rules, thresholds, pathways) can be published once and picked up across every machine in the practice; machines can also contribute their own "Clean up code" preference tallies back to the shared pool (one-time "Connect shared file" grant per machine, then silent on side-panel open) without becoming a publisher of anything else
- **Choose your tabs** — show/hide/reorder which side-panel tabs appear
- **Backup / restore** — a suite-wide export/import covering every module's settings in one file
- **Display preferences** — theme, density, and a colour-blind mode
- **Event Ledger** — a machine-local record of what the suite has flagged, for audit and troubleshooting
- **Suite health** — self-diagnosis of the extension's own data pipeline, surfaced as an amber-only strip when something is degraded

## Recent additions (last 4 weeks)

- **v3.233.0 (2026-08-15)** — Weekly safety-review fix pack, parts 1–2 (at CSO direction). Journal-sync confirm dialogs and match rows now always name the journal entry's date, honestly labelled by source ("dated … (the note's own recorded date)" for a verified date vs "listed under … (journal day heading, not the note's own date)" for a day-group heading, and an explicit "date unknown" when absent) — the field most implicated in a wrong-entry match (hazard H-061) — and the auto-prompt narrowing plus all four journal write/undo paths gain direct regression coverage. Bulk task-queue batches (Privacy Officer acknowledge, EPS discard) are now auditable in Options → Event ledger via a "Bulk actions only" filter with explicit commit timestamps and widget identity — including batches recorded under the pre-v3.233.0 event shape — with an honestly-bounded machine-local empty state (hazard H-063).
- **v3.232.0 (2026-08-14)** — Rota Manager major upgrade: optional passcode protection (staff read-only view with self-service leave/swap requests, or strict full lock; hashed config, synced and backed up with the practice data); a first-run setup assistant (connect to Medicus with review-before-import, sample practice, or by-hand — install to working rota in about three minutes) plus a "Finish setting up" dashboard checklist; grid drag-and-drop upgrades (live validity greying, Excel-style rectangle selection, copy/paste, redo, undo toasts, right-click menu, shortcuts strip, interactive rooms view); Solver v2 (enhanced-access allocation, avoid-duty preference repair, room-clash-aware proposals with per-dimension score explanation); and a live drift card in the compact Rota module reconciling today's rota against the Medicus appointment book each minute with an opt-in alert on serious drift.
- **v3.230.0–v3.231.0 (2026-08-12–14)** — Journal–code sync: the Clean-up-code panel now finds journal entries duplicating the problem's clinical event (nine confidence tiers: structural linked-problems references, verified true record dates, day-group date + wording, and two fuzzy fallbacks), warns when several match (GP2GP can duplicate whole records) and flags the one whose own record date exactly confirms against the problem, and can write the problem's current code — and separately its cleaned "additional info" text — into the matching entry, per-match or auto-prompted right after a fix. v3.231.0 adds the post-review fixes (one row per journal entry even when two detection passes find the same note; unknown confidence tiers rank last) and a one-click Undo for both journal writes, restoring the entry's previous code or text via the same confirmed contract. Also new: the `{Episodicity…}` / `Problem Info: Problem Notes:` GP2GP wrapper patterns join the generic-import-text rules, and "Date records held from" joins the Bulk-remove admin-code roots.
- **v3.227.0–.1 (2026-08-09)** — "(Grouped with X)" GP2GP import text now resolves to a real relationship offer (flat link or nest in either direction) in both the Clean-up-code panel and the Organise-problems canvas tray, with existing-relationship detection, automatic import-text cleanup on commit, canvas locator lines, drag-and-drop flat links, and Unknown-significance flagging. v3.227.1 adds the review fixes: an authoritative fail-closed cycle guard on the no-scan surface, a two-step confirm on the inline relationship buttons, ambiguous-match refusal, truthful strip feedback, per-choice confirm copy, and scan-race/card-lifecycle corrections.
- **v3.226.0 (2026-08-08)** — Cleanup Code Preferences gain automatic practice-pool contribution (a machine's own tallies merge back to the shared profile without a full publish; additive-only, never touches the practice-wide enforced choice), and "Bulk acknowledge?" / "Bulk discard?" checklists arrive on the Privacy Officer Alerts and EPS Cancellation Failures task queues, each batch explicitly confirmed.
- **v3.225.0–.1 (2026-08-08)** — "Organise problems" canvas: the suggestion/manual-link accordion sections replaced by a full-screen drag-and-drop canvas (date-sorted parent/child tree, SNOMED + practice-override suggestion tray with connector lines, per-tile Remove link / Edit problem… actions embedding the Clean-up-code panel, read-only linked-problems visualisation with per-set lanes/colours). v3.225.1 adds the review fixes: patient-change guard on the open canvas, post-save Edit-problem state reset, re-parent "will move" disclosure, rescan after a code edit, full keyboard operability, parent-map cycle rescue, and lazy linked-problem prefill.
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

Medicus Suite is a passive display layer by default: everything it shows is read from data already recorded in Medicus, and it makes no clinical recommendation, orders nothing, and runs no AI-based inference on patient data. A small, deliberately enumerated set of actions can write back to Medicus — appointment booking, general-task creation, inbound-document filing, normal-lab-result filing, routine-prescription re-assignment, problem-list tidying, and bulk acknowledge/discard of two routine task types (Privacy Officer Alerts, EPS cancellation failures) — and every one of them is user-initiated, explicitly confirmed at the point of commit, and executed through Medicus's own controls under the clinician's own session, so Medicus's own validation, access control and audit trail apply as normal. No patient data leaves the browser except through the one optional, off-by-default Transactional API read path a practice must deliberately configure. Full detail on scope, hazards, and residual risk is maintained in `docs/INTENDED-PURPOSE.md`, `docs/HAZARD-LOG.md`, and `docs/CLINICAL-SAFETY-NOTICE.md`.
