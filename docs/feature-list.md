# Medicus Suite — Feature List

**Version:** v3.265.7
**Generated:** 2026-09-24

## What it is

Medicus Suite is a Chrome extension that sits alongside the Medicus electronic patient record. It adds a side panel with 20 tabs, a handful of full-tab tools, and a set of small additions layered onto Medicus's own screens (queue chips, monitoring context, inline booking, and similar). Everything it shows is drawn from data already in Medicus — it displays, checks and reminds, never diagnoses, never recommends treatment, and runs no AI-based interpretation of patient data. A short, explicitly listed set of actions can write back to Medicus (booking, task creation, document filing, problem-list tidying and a few others), and each one requires the user to review and confirm before anything happens.

## At a glance

- 20 side-panel tabs covering morning workflow, monitoring, capacity/demand, reception, referrals, staff rota, the Note display board and reference material (two of those tabs open a full-tab tool)
- 4 full-tab tools reached from the panel or from Medicus's own pages (Duplicate Problem Checker, Rota Manager, Note display board, Contacts Management)
- around 16 in-page feature groups layered onto live Medicus screens (queue chips, inline booking/task/document widgets, problem and allergy tidying tools, appointment-book tally, repeat-authorisation pills)
- 8 rule types in the clinical alert engine
- 39 built-in drug-monitoring rules (38 enabled), 82 QOF rules (16 register + 66 indicator), 7 vaccine rules, 44 investigation-result threshold rules, and 39 starter alerts in the practice alert library (36 prescribing safety, 3 clinical review)

## Side-panel modules

### Today — v1.0
One morning screen: a headline sentence plus waiting-room count, triage queue load, today's demand, today's available slots, and the last pre-clinic sweep status.

### Slot Counter — v2.3
Taken and free appointment counts by type for any date, read live from Medicus's scheduling data. The appointment book itself also carries an injected booked/free tally with the same type toggles.
- Free remaining (with AM/PM) plus taken on this day's book; configurable alert thresholds; CSV export
- Auto-refresh every 60s while the tab is open (paused when hidden; no skeleton flicker)
- "First available appointment" lookup with one-click booking handoff
- Typable appointment-type filter on the booking picker
- "Next working day" skips weekends and bank holidays for the practice's chosen nation (bundled GOV.UK calendar, England & Wales / Scotland / Northern Ireland)

### Monitoring (Sentinel) — v0.5.1
The clinical context sidebar for whichever patient record is open. Checks active medications, problems and recent results against drug-monitoring intervals and this year's QOF indicators, showing a plain green/amber/red chip for each. Passive display only — never writes to the record, never orders anything, never tells the clinician what to do.
- Drug-monitoring and QOF register/indicator chips; prescribing-safety scores (ACB, STOPP/START-style)
- Practice-editable custom alert rules; a coverage view for meds/problems with no matching rule
- One-click "create task" from a chip

### Trends
Charts a patient's blood pressure, renal function, DOAC creatinine clearance, HbA1c, cholesterol and weight over time, from the same live data Monitoring uses. Includes a DOAC-only view (Cockcroft-Gault CrCl, not eGFR) and CSV export.

### Capacity Forecast
A calendar comparing available appointment capacity against the practice's own configured daily minimums, with day/week/month views, per-day red/amber/green status and per-weekday minimum presets — plus a practice-manager look-ahead for days at risk.
- Bank holidays (bundled GOV.UK calendar, nation selectable) carry no target; the day after a bank-holiday closure gets an editable post-holiday uplift estimate, labelled as an estimate
- Configurable look-ahead (7–84 days, default 28): banner of days at risk with chips that jump to the day; Print pack (A4, greyscale-safe) and CSV for the ops meeting
- Today tab "Days at Risk" card rolls up the same scan; chips open that day in Forecast
- Incomplete scans never claim "no days at risk": unreachable Medicus, a date past the bundled calendar, or a weekday with no sessions in the book yet all show as unchecked

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
A practice-owned reference base — referral criteria, contacts, pathways, template text — searchable from the panel, with near-duplicate detection and an optional starter-pack import. The live set is shared via the practice `practice-profile.json` (same channel as published rules) when the shared folder is connected; **Save backup** downloads the whole current set as JSON.

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
- **Lab allocation canvas** — on the investigation-results queue, an unallocated inbox pile grouped by who ordered them (Outstanding Investigation Request labels on the result, not the list Requested By column), with clinician fields to drag reports onto; Split equally / Top up / Distribute equally among In today (nurses included) or a saved allocation group; staging is local, confirming writes Medicus's own bulk-reassign (who the task sits with — it does not file the result)
- **Workflow allocation canvas** — the same workbench on inbound-document queues and any task-list with a workflow view, grouped by registered GP; confirming writes the same bulk-reassign (it does not file the document)
- **Prescription-request canvas** — the same workbench on the routine and non-routine prescription-request queues, with Split equally / Top up (unallocated only), Distribute equally (rebalances sitting plus new work), and **Send N to usual GP** (unallocated rows whose named GP is a unique in-day staff member; not-in is an opt-in on that action only) among In today, a saved allocation group, or people encircled on the canvas; confirming writes the same bulk-reassign (it does not issue, sign, or file the prescription)
- **Patient-request canvas** — the same workbench on homepage medical and admin patient-request inboxes. Staging and even-split work; Write stays blocked until a dummy-patient capture of bulk-reassign on those slugs. Does not complete, file, or reply.
- **Companion (inline booking, tasks, and monitoring)** — a floating role-toggled box (Clinic / Reception / Triage / Nursing) on patient and task pages carrying appointment-booking and create-task panels plus a read-only "What's due" pocket of Sentinel chips for the page's patient. For Clinic, an "Open appts, links, tasks & investigations" section (also on care-record pages, not just triage tasks) lists future appointments, unused booking links, the patient's other open tasks (incomplete or scheduled for later; the task currently being viewed is excluded), and outstanding investigation requests (no result back yet — not confirmation the request reached the lab); each list collapses independently. Opt-in on every Medicus screen; resize, minimise, or pop in to an edge tab
- **Document handling** — one-click filing of a patient-submitted attachment as a clinical document, and a checklist that turns a document's coded journal entries into new Problems
- **Reception quick-actions composer** — chip rows above a task's comment box that insert plain-English text only; the clinician still presses Medicus's own Submit
- **Clean up code** — flags outdated or retired SNOMED problem-list codes, suggests a cleaner code or description, and can sync it into a matching consultation-note entry, with one-click undo
- **Organise problems** — a drag-and-drop canvas for ending, re-grading, nesting and linking problems, with suggested links; several tiles can be staged and confirmed together
- **Allergy cleanup** — a canvas for removing low-relevance allergy entries, merging duplicates, clearing stale dual-coding, and converting pre-defined allergies to a coded substance
- **Clean up alerts** — pill on the patient banner; batch-clears Flag on patient banner only (W24)
- **Appointment-book tally** — a single button on the appointment book showing booked and free counts for that day, with the same appointment-type checkboxes as Slot Counter (shared `slots.hiddenTypes`). Optional flu / COVID / RSV eligibility toggles count unique booked patients on those types (inferred — double-check before offering a vaccine). Read-only
- **Appointment-book organise** — cancel, move or rebook appointments directly from the diary view, with a fail-safe write path (destination re-checked before writing, failed moves auto-restored)
- **Bulk task actions** — checklist-based acknowledge/discard for the Privacy Officer Alerts and EPS Cancellation Failures queues, reviewed and confirmed as one batch
- **Task presence** — when a colleague is on the same request, a one-line notice (initials + “X has this open. You can still work it.”) on the open request, from Medicus's own Pusher presence channel; queue chips still show a name on a row they already have open (shared-folder fallback). Advisory only, never a lock. Absence of the strip is not evidence nobody is on it.
- **StackChan desk robot** — optional LAN HTTP bridge (default off) so an M5Stack StackChan can show idle/calm/alert/wait faces from Sentinel chip colour, Request Monitor new work, or a Companion role change. Severity enum + event code only — never a patient name. Camera and mics stay off in the shipped firmware. See `docs/STACKCHAN.md`.
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

The shipped alert library carries 39 starter alerts a practice can enable (36 prescribing-safety, largely drawn from the PINCER indicator set, plus 3 clinical-review alerts), alongside 39 built-in drug-monitoring rules (38 enabled), 82 QOF rules, 7 vaccine rules, and 44 investigation-result threshold rules. Practices can also author their own rules of any type, which arrive disabled until a clinician reviews and switches them on.

## Settings & customisation

- **Practice Profile** — shared-folder managed deployment so rules, thresholds and pathways can be published once and picked up across every machine in the practice
- **Choose your tabs** — show/hide/reorder which side-panel tabs appear
- **Practice features** — a practice board of optional chrome packs (allocate canvases, contacts canvas, Routine-Rx button, quick-actions widget, signing soft flags)
- **Investigations (Lab Result Catalogue)** — a single, coded, per-practice catalogue of investigations, results and labs with its own settings page (practice context, browse/search, per-test edit and gated per-test review; entries arriving by backup, shared profile or import stay inert until approved on that machine). Outstanding Requests can opt into it (matching engine setting, default off). Lab Filing can opt into it (filing engine setting, default off, union-only with the legacy gate — can only add a blocker, never remove one) and works even with zero legacy Lab Filing profiles configured, driven entirely by the catalogue's own practice ranges, safety guards and lab-comment whitelists. H-080 and H-081 accepted 2026-09-24; shipped defaults stay legacy, so this is not a practice-wide enablement. If the catalogue cannot be checked, filing is blocked.
- **Backup / restore** — a suite-wide export/import covering every module's settings in one file
- **Display preferences** — theme, density, and a colour-blind mode
- **Diagnostics** — Event Ledger (machine-local record of what the suite has flagged), Suite health (self-diagnosis of the extension's own data pipeline), and Debug, collapsed into one Settings page

## Recent additions (last 4 weeks)

- **v3.265.7 (24 Sep)** — Document and Template Organiser is on unless a practice switches it off. Opening a document continues past Medicus’s New Document chooser (From a template, then the chosen row). The button sits clear of More and Complete consultation. Layout is a practice default plus each person’s own folders.
- **v3.265.6 (24 Sep)** — Documents fill when the template list already can: the heading id is taken from `draft-consultation-topic` when overview headings omit it, and a tabbed document response is read when `items` is empty. The organiser button sits beside Complete consultation in the main pane, not at the bottom-right of the window.
- **v3.265.5 (24 Sep)** — Document catalogue: History, Examination, Impression, and Plan pass patient id, heading context id, and `consultation-topic-heading` into document search. The heading uuid may sit on an ancestor or on `consultationTopics[].headings[]`. A missing context stays a footer gap. Catalogue reads stay on the practice API host. The pack stays opt-in.
- **v3.265.4 (24 Sep)** — Document and Template Organiser: Open on a card in a group uses the same Medicus Use template / Create path as a card that is not in a group. The suite does not POST a create body. Still off until a practice turns it on.
- **v3.265.3 (24 Sep)** — Document and Template Organiser: a search field on Templates and on Documents filters cards by title, preview, or category as you type. Groups stay on the board; clearing the field shows every card again. Still off until a practice turns it on.
- **v3.265.2 (24 Sep)** — Document and Template Organiser catalogue: opening it from History, Examination, Impression, or Plan reads the template list even when that list URL is no longer in the performance buffer. The topic comes from encounter overview `consultationTopics[]` (the topic that owns the focused heading). Patient and heading context come from the clinical-summary URL and the heading id. Catalogue reads stay on the practice API host.
- **v3.265.1 (24 Sep)** — Document and Template Organiser (still off until a practice turns it on). The button shows when the cursor is in History, Examination, Impression, or Plan. Open uses Medicus’s own template form; the suite does not POST the record. Catalogue reads use the practice API host (`{site}.api.{page hostname}`), not the page that serves the SPA shell.
- **v3.265.0 (24 Sep)** — Template and document organiser (off until a practice turns it on): groups Medicus template and document lists on a canvas. Groups stay on this install. Superseded the same day by v3.265.1 (name, clinical-field launcher, Medicus’s own open, no suite insert POST).
- **v3.264.35 (24 Sep)** — Lab Filing can opt into filing on the Lab Result Catalogue (setting, default off, union-only with the legacy gate, practice-published): works even with zero legacy profiles, driven by the catalogue's own practice ranges/guards/comment whitelists. Fail closed: a pending catalogue that does not load blocks filing (no lab-range fallback); catalogue `ok: false` with no legacy profile blocks filing (no generic baseline, including the practice-wide comment whitelist); the one-click confirm shows the practice range that cleared the file and the lab-flag override warning when that path applied. The lab-flag override is one switch per test at a lab. Catalogue-only filing completes in one click. H-080 and H-081 accepted; H-073 re-signed. Shipped `filingEngine` and `oirEngine` stay `legacy`.
- **v3.264.35 (24 Sep)** — Investigations page: a hint when a scan or a test's own results table is about to treat two results as separate when they're likely the same analyte, with one-click merge (staged and reviewable — nothing merges until the test is saved) and "it's not X" to permanently dismiss a wrong suggestion; a duplicate-lab-entry bug fixed at its source plus a merge tool for existing duplicates; the results list filters reworked into independent Yes/No/Any toggles (awaiting review, assisted filing, matched to a lab report, matched to a Medicus request) with quick-jump presets, and re-sorted to surface items needing attention first; a gate + shadow log for filing on the Lab Result Catalogue
- **v3.264.35 (22 Sep)** — Investigations page: "autofiling" renamed to "assisted filing" throughout (nothing acts automatically); a "What does this do?" explainer and "Match requests to lab reports" are now collapsible; empty practice-range boxes are pre-filled from the lab's own reference range seen on a recent report (highlighted, never saved without a click); fixed a page-wide CSS specificity bug that was silently stretching several narrow inputs to full width
- **v3.264.35 (22 Sep)** — Investigations page: safety guards (with trend direction), lab-comment settings per report group, and one assisted-filing switch + approval per test at a lab; Medicus filing-screen wording is one practice-wide setting
- **v3.264.35 (22 Sep)** — Investigations results table tidied: no description or lab columns, click a code or an "also called" name to edit, plainer role words (core to the lab group / enough on its own)
- **v3.264.35 (22 Sep)** — Investigations page: Lab Filing setup on the results table — practice normal range (per result, lab and SNOMED code), assisted-filing enable and its own approval, list filters and card badge
- **v3.264.35 (22 Sep)** — Investigations page: each test card is now two columns over a full-width "Never counts as this test" strip and one full-width results table (name, code, SNOMED description, unit, core/optional, wordings, lab), with Codes & wordings under the name
- **v3.264.35 (22 Sep)** — Lab Filing: a whitelisted lab comment must now explain the whole comment (no more partial / containing matches), entries need at least 6 words, and are refused rather than truncated (limit 2 000 characters)
- **v3.264.35 (22 Sep)** — Outstanding Requests can now use the Lab Result Catalogue (opt-in Triage option "Matching engine", default off, practice-published, falls back to the current engine on any problem): recognises requests and reports by SNOMED code and the lab's own headings, same clearing rules and auto-tick opt-in. Investigations page: Edit and Details merged (codes and wordings editable in place), labs can be renamed, deleted imported tests stay deleted, matching-tool fixes
- **v3.264.0 (20 Sep)** — Lab Result Catalogue + Options → Investigations page: coded per-practice catalogue of investigations/results/labs, inert-until-approved practice overlay, gated per-test review, "Match requests to lab reports" scan (names/headings/codes/units only — never values or patient/staff data). No existing feature acts on it yet
- **v3.263.10 (19 Sep)** — StackChan desk-robot presence: LAN HTTP face commands from Sentinel / Request Monitor / Companion; firmware camera+mic off; Options Test face
- **v3.263.9 (19 Sep)** — Restored ACE-I/ARB and thiazide post-initiation U&E, gated on a true medication-history start (batch dates cannot fire)
- **v3.263.7 (19 Sep)** — Flu chip: UK synonym "Is a carer" (SNOMED 224484003 / description 1222761019)
- **v3.263.1 (18 Sep)** — Task presence: occupied banner no longer oscillates on request overviews that re-render the message chrome
- **v3.263.0 (18 Sep)** — Appointment-book tally: optional flu / COVID / RSV eligibility counts on the booked/free button
- **v3.262.1 (18 Sep)** — Reception match: topic terms for earache `rf-under3m-fever` and feverish-child `rf-rigors`
- **v3.262.0 (18 Sep)** — The Keeper: ciclosporin / tacrolimus / mercaptopurine / cenobamate monitoring rules; missing UK brands (Elozar, Arpoya, Bilprevda, Zvogra, Drovelis)
- **v3.261.62 (17 Sep)** — Lab filing: block unrecognised analytes before offering File (H-074); Next-Step radio click now files the task (H-075)
- **v3.261.50 (14 Sep)** — Prescription-request canvas: usual-GP send stays in the allocate action cluster
- **v3.261.49 (14 Sep)** — Prescription-request canvas: Send N to usual GP is a peer of Distribute equally, not a featured CTA
- **v3.261.48 (14 Sep)** — Prescription-request canvas: Send N to usual GP if they are working that day; not-in is an opt-in on that action only
- **v3.261.45 (12 Sep)** — Lab allocation canvas: who-ordered uses current OIR dates, not completed requests from another GP
- **v3.261.44 (12 Sep)** — Lab allocation canvas: who-ordered overview only for unallocated results
- **v3.261.43 (12 Sep)** — Lab allocation canvas: keep majority OIR requester; parse hyphen/date labels
- **v3.261.42 (12 Sep)** — Lab allocation canvas: send to who ordered if they are working that day; not-in is an opt-in toggle
- **v3.261.41 (12 Sep)** — Lab allocation canvas: Next working day (skip weekend/BH) and share-equally onto people working that day
- **v3.261.40 (12 Sep)** — Lab allocation canvas: full-width “finding who ordered / reorganising the pile” banner while overviews load
- **v3.261.39 (12 Sep)** — Lab allocation canvas groups by OIR requester (Dr on the request tags), not the list Requested By / lab practitionerName
- **v3.261.38 (11 Sep)** — Dropped ACE-I/ARB and thiazide "U&E 2 weeks after starting" (false alerts on long-term patients)
- **v3.261.37 (11 Sep)** — Slots auto-refreshes every 60s while open (paused when hidden)
- **v3.261.36 (11 Sep)** — Prescription list Share out / overdue-monitoring buttons sit left of Sign
- **v3.261.35 (11 Sep)** — Prescription lists: Check for overdue monitoring next to Share out; Monitoring/QOF buttons on flagged requests
- **v3.261.34 (11 Sep)** — Prescriptions canvas: per-request item counts vs regimen totals, overdue reauthorising line, 1–5 complexity score
- **v3.263.0 (18 Sep)** — Appointment-book tally: optional flu / COVID / RSV eligibility counts on the booked/free button
- **v3.261.33 (11 Sep)** — Practice features: Focus alerts toggle for the queue status bar
- **v3.261.32 (11 Sep)** — Companion: investigation-result review tasks get the appts/links/tasks section
- **v3.261.29 (10 Sep)** — Tidy widgets route-gated; allocate harvest aborts on close; injector runtime loads before every consumer
- **v3.261.28 (10 Sep)** — Retired Bulk remove not injected; lab/request staff harvest cap 12
- **v3.261.27 (10 Sep)** — Injector runtime: start once, throttled place; allergy/nesting 5s timers only on care-record/task-overview; tally listeners tear down off-book
- **v3.261.26 (10 Sep)** — Organise Finalise counts a write only when the post-write book shows cancel-gone, the patient on the dest slot, or the new duration
- **v3.261.25 (10 Sep)** — Allocate write confirm: fail closed without WriteCore, retry stale GET, unstage landed (including team dests), pin Rx/request confirm route; Organise stop tears down the overlay mid-write
- **v3.261.24 (10 Sep)** — Injector runtime (route → start/stop) for book/allocate canvases; allocate writes confirm landed assignee via WriteCore
- **v3.261.23 (10 Sep)** — Maintenance: no raw journal UUID in storage; allocate canvases hub/route-gated; SECURITY-AUDIT NF6 closed; Visualiser dropped from accessibility + CSN DOES list; Windows CRLF test regex
- **v3.261.22 (10 Sep)** — Flu chip recognises coded carers (SNOMED 224484003 / Egton 4928511000006113 Patient themselves providing care)
- **v3.261.21 (10 Sep)** — CSO re-freeze + audit quick wins: listing-URL cap, book observers route-gated, practice-code import guard, Options probe HTML escaped; frozen safety docs match the pruned surface
- **v3.261.20 (10 Sep)** — QA polish: Slots shows taken as well as free; diary pills match; Trends/Forecast/Monitoring icons distinct; living docs drop Visualiser/Condor claims
- **v3.261.19 (10 Sep)** — Appointment-book tally: injected booked/free button on the diary, same type toggles as Slot Counter
- **v3.261.8 (8 Sep)** — Occupied/list strip hides you (Pusher myID / email / display name, not only staff UUID); occupancy look is a Suite table (colour, size, highlight) with click-the-alert on-the-fly changes; default fluoro yellow
- **v3.261.7 (8 Sep)** — Occupied/list heading starts Note:; note wash not peach; queue shows 47 in this inbox from the task-list bridge
- **v3.261.6 (8 Sep)** — Occupied/list heading starts Note:; request launcher shows the task-list count; dest-set footer names Morning triage when that set is on
- **v3.261.60 (17 Sep)** — Task Presence token (icon + display name) on list rows, request/Rx message chrome, and Clinical Summary RHS — same occupants as the masthead
- **v3.261.5 (8 Sep)** — Queue title strip: named list occupancy from Medicus `presence-{site}-task-list-{slug}` replaces the host "GP is also working this list" widget (advisory, never a per-request occupant)
- **v3.261.4 (8 Sep)** — Occupied strip and allocation groups review pass: wipe/idle/socket fail-closed; one-sentence occupancy copy; Working today chips, gated Write hidden, dest cards no longer overlap (see CHANGELOG)
- **v3.261.3 (7 Sep)** — Allocation groups: named sets of people to even-split onto (encircle/drag on the canvas, optional days/times); same dest-set on labs and Rx; new homepage medical/admin request canvas (Write blocked until capture)
- **v3.261.2 (7 Sep)** — Occupied strip: do not restyle the whole Medicus page while someone else is on a request
- **v3.261.1 (7 Sep)** — Occupied request strip: Live heartbeat from Medicus Pusher presence when a colleague is on the same request (advisory, never a lock; fail-closed against self/stale/wrong-task)
- **v3.261.0 (6 Sep)** — Lab allocation canvas: Working day (Today / Tomorrow) so night-before allocation uses tomorrow’s appointment book; in-day people sort to the top and appear as drop fields even with no labs sitting yet
- **v3.260.0 (6 Sep)** — Knowledge live set is practice-shared via `practice-profile.json` (import/edit no longer stay on one computer); Save backup / Import JSON on the tab and in Options. Push is version-gated (never clobber a newer shared file; never roll back to an older one); Share writes `practice-profile.json` next to `manifest.json` only.
- **v3.259.0 (5 Sep)** — QOF OB005 rewritten to the PCIT TA1026 / OBES2_REG cohort (ethnicity-adjusted BMI + 4-of-5 comorbidities) with three pathway codes as achievement; drug brand names no longer count
- **v3.258.0 (4 Sep)** — Forecast days-at-risk look-ahead: bundled UK bank-holiday calendar behind Forecast and Slots "Next working day", post-holiday uplift estimates, printable/CSV at-risk pack, Today "Days at Risk" card; incomplete scans never claim all clear
- **v3.257.0 (3 Sep)** — Companion: appointments/booking-links/investigations section extended to care-record pages (not just triage tasks), plus a new open-tasks list and collapsible sub-lists
- **v3.256.0 (31 Aug)** — Prescription-request canvas on routine and non-routine queues, with Split equally / Top up / Distribute equally among doctors working today
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
