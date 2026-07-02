# Medicus Suite — Feature List

**Version:** v3.147.0
**Generated:** 2026-07-02 (automated)

## What it is

Medicus Suite is a Chrome browser extension for UK GP practices that runs alongside the Medicus electronic patient record system (Medicus Health Ltd / Doctolib). It adds a side panel and optional on-page overlays that surface monitoring alerts, demand data, appointment capacity, investigation result triage, and clinical reference directly within the Medicus interface. All processing happens locally in the browser; no patient data is transmitted to any external service and no clinical inference is performed — everything shown is derived from data already present in Medicus. The only writes are explicit, user-initiated actions carried out through Medicus's own controls/API endpoints (booking an appointment, creating a task, re-assigning a prescription request, and — newest — Lab Results Auto-Filing, the first to write to the clinical record by filing an all-normal result); Medicus remains the system of record and nothing is ever written automatically.

## At a glance

- 14 side-panel modules covering monitoring, demand, capacity, workflow, knowledge, analytics, the live patient record, and NHS patient leaflets
- 7 in-page content-script features (on-screen overlays, workflow buttons, and relays — incl. the Lab Results Auto-Filing button)
- 2 full-tab generated reports (Practice Report; CQC Inspection Readiness)
- 7 rule types in the alert engine
- 27 drug-monitoring rules, 52 QOF indicators, 13 QOF registers, 5 vaccine rules, 35 bundled investigation result rules, and 26 starter alerts in the prescribing-safety library

## Side-panel modules

### Today (Morning command centre)

The default tab. One glance answers "what does today look like?" before clinic starts. Each card deep-links to its own module.

- **Waiting room**: live arrived-patient count with max-wait amber/red colouring
- **Triage load**: request-monitor bucket counts when the monitor is configured
- **Demand today**: medical and admin task totals against the practice's thresholds
- **Slots remaining**: live available-slot count for today
- **Morning sweep**: last sweep summary (time and action-needed count) or a prompt to run it
- **Recent alerts**: last few operational alert events — counts and labels only, never patient identifiers

### Sentinel (Monitoring)

The core per-patient alerting module. When a patient record is open in Medicus, Sentinel evaluates the practice's monitoring rules against that patient's medications, observations, problems, and vaccination history, and displays colour-coded chips for anything overdue, due soon, or not achieved.

- Drug-monitoring chips show which specific blood tests are overdue and by how long, with monitoring interval and source citation
- Each drug-monitoring chip shows the matched rule term as a hover tooltip so a clinician can confirm a correct hit rather than a lucky substring match
- QOF indicator chips flag register members whose targets are not met or approaching threshold
- Vaccine chips reflect seasonal campaign windows (flu and COVID appear only during the active campaign period)
- A collapsible **Brief** card gives a 30-second risk summary: patient line, red/amber count, and the four highest-priority signals. The "+N more" overflow line annotates how many hidden chips are red, so a red signal beyond the top-4 is never silently swallowed
- **Action Packs**: each actionable chip carries copy-ready text — blood form, recall SMS, escalation SMS, letter, and task line for admin
- **Patient Passport**: plain-English summary (reading age 9–11) for handing to the patient in the room
- **Patient identity banner**: name / NHS number / DOB / age with a "Verify in Medicus" footnote and a "Monitoring for" lead-in label so the subject is unmistakable
- Dismissed chips resurface automatically when their status escalates — an overdue chip cannot stay permanently hidden
- "Meds without a monitoring rule" audit view shows medications not matched by any enabled rule, with a "Report missing brand" mailto link so brand-coverage gaps are visible rather than silent

### Sweep (Pre-clinic sweep)

Runs the same monitoring rules as Sentinel across all patients booked in today's appointment book — before clinic starts — to produce a worst-first worklist so overdue recalls can be arranged before consultation.

- **Choose the sweep day**: sweep today or any other day (past or future); the appointment book and clinician picker update for the selected day
- **Multi-clinician filter**: select any combination of the day's clinicians (or leave "All"); an empty selection always means all — it can never silently sweep zero patients. Printed handouts label the audience accordingly (single clinician, named list, or all)
- Manual trigger only; large practices processed in batches of 40 with a "Check next N" button
- Per-patient API failures render explicitly — a patient with partial data cannot appear clear
- **Print reception handout**: tick-box worklist with plain-English booking instructions per patient, sorted by appointment time. The clinic day and audience are stated on every printout
- Last sweep survives tab switches for up to 2 hours, with the run time and swept day shown so staleness is visible

### Slots (Appointment slot counter)

Displays appointment slot availability for today or any selected date, drawn from the Medicus scheduling API.

- Type-pill view: available slots by appointment type with per-type colour-coding (organise via drag-and-drop)
- Threshold alerts: amber/red per appointment type at configurable counts; safety-alert colours always override user custom colours
- **Embedded appointment booking**: a collapsible "Book appointment for patient" panel built into the Slots tab — picks up the current patient automatically, fetches available slot types and times, reserves a slot, and books through the Medicus scheduling API including server-triggered patient SMS/email confirmation
- CSV export; freshness ticker; slot alert strip in the side panel

### Capacity Forecast

Aggregates slot and session data across a configurable date range to show week-level capacity against the practice's daily minimum.

- Week and month views; green/amber/red by sufficient/tight/low/critical thresholds
- Configurable presets for appointment-type subsets (e.g. face-to-face only, one clinician)
- Per-weekday minimum configuration: set different minimum slot counts for each day of the week, with graceful fallback to the legacy flat daily minimum for existing presets
- Weekend toggle; historic dates shown as "Past"

### Submissions Tracker

Live dashboard of patient submission task counts, split by type (Medical, Admin, Investigations, Routine Rx, Non-routine Rx) and presented as a stacked bar or area chart over a configurable date range.

- Threshold amber/red washes per type; RAG alert strip in the side panel (shared threshold logic with the strip to prevent silent drift)
- CSV export; configurable date presets and freshness ticker

### Activity Report

Fetches the Medicus activity report for a configurable date range and renders period totals as a stacked horizontal bar chart broken down by staff member.

- Period totals per clinician and per metric; stacked, total, or single-metric view
- Configurable date presets; CSV export

### Referrals Tracker

Displays referral audit data drawn from Medicus, with breakdowns by specialty, clinician, priority, and status.

- Configurable priority and status filters; top-15 specialty chart
- Referrals activity overlay (submissions and referrals on the same timeline)
- Diagnostics panel for configuration troubleshooting

### Condor (Practice analytics)

A live analytics dashboard pulling from multiple Medicus data streams into eight metric cards. Jargon terms (RAG, PPI, eFI, triage load) carry click-to-explain glossary tooltips.

- **PPI** (demand intensity), **Demand gap** (capacity minus demand), **Velocity** (task throughput), **Task age** (outstanding task age distribution)
- **Workload** (clinician-level load), **Waiting room** (arrived count and wait), **Day score** (configurable end-of-day score with manual entry), **Activity** (session activity count)
- Daily snapshots captured automatically for the Practice Report trend views

### Trends (Observation trends)

Displays sparkline charts of a patient's longitudinal observations for quick clinical context when the record is open.

- HbA1c, cholesterol, weight, blood pressure, eGFR, and albumin-creatinine ratio
- KDIGO stage grid (eGFR G-stage × ACR A-stage); BP targets derived from patient age and diabetes/CKD register status

### Reception

A reception-facing panel designed for non-clinical front-desk staff.

- **Patient status pill**: single green/amber/red indicator for the patient whose record is open; click to expand action-needed monitoring detail. RAG codes and clinical jargon carry glossary tooltips so non-clinical staff are not left guessing
- **Guided capture**: configurable question sets per presenting problem (sore throat, earache, adult cough, urinary symptoms, headache, low back pain, feverish child, rash, general) with Pharmacy First suitability hints. Red-flag questions come first; any YES shows an immediate 999 or duty-clinician escalation banner
- Output is a structured plain-text history block for copy-paste into the Medicus triage entry — the tool never triages, diagnoses, or advises beyond red-flag escalation
- All pathways ship disabled; a practice administrator must accept an explicit disclaimer before enabling any
- In-progress captures auto-save as a local draft (≤4 hours) with a timestamped Restore/Discard banner
- Reception pathways are CSO-signed-off (v1.3): five red flags promoted from urgent-duty to 999 following clinical review (suspected SJS/TEN, sepsis with rigors, cauda equina, mastoiditis, acute-angle-closure glaucoma)

### Knowledge

Practice-owned reference base for referral criteria, contacts, clinical pathways, and templates.

- Add, edit, search, and categorise reference entries; near-duplicate detection on save
- LLM-assisted starter-pack import (Options → Knowledge): paste structured JSON from an external LLM to pre-populate entries in bulk
- Expandable detail cards; keyword search; category filter
- Central practice attestation: if the practice administrator has accepted the knowledge notice via a published Practice Profile, individual clinicians see it activate without a per-seat click

### Record (Live patient summary)

A live-first snapshot of the patient currently open in Medicus, sourced from the same API the suite already calls — no PDF export needed.

- Demographics, coded active problems, current medications (with doses and overdue/review flags), recent results (latest value per test, with above/below-range flags)
- Deterministic prescribing-safety prompts (anticholinergic burden, STOPP/START) plus the live drug-monitoring and QOF chips the Monitoring engine computes
- Clinical-safety framing is load-bearing: a persistent "live snapshot, not a complete record" banner; allergies, immunisations and consultation history render as explicit gap-markers (absence does not mean "none recorded"); every safety score carries an inline caveat that it excludes allergies and uses coded data only
- "Open full visualiser" footer link to the full multi-year Patient Record Visualiser (built from an exported record PDF) for the deep view
- **Prescribing Pre-flight**: type a not-yet-prescribed drug and see, before it exists on the record, the anticholinergic-burden delta and band change, any newly-triggered STOPP/START prompt, interactions with current medications, and the monitoring the drug would require (baseline satisfied vs missing). Unknown drugs are reported as unknown, never as safe; every result carries a "decision aid, not advice" caveat
- Available in both the side panel and the pop-out window

### Leaflets (NHS patient information)

Ends the "google NHS wart" detour: NHS patient advice leaflets searchable from inside the suite.

- Instant fuzzy search (aliases and near-miss typos included) over a bundled index of 221 curated NHS Health A-Z entries — 166 conditions and 55 medicines
- One click opens the leaflet on nhs.uk beside Medicus; "Copy link" puts the URL on the clipboard ready for a patient message; a recent-leaflets list keeps the last ten to hand
- An always-present "Search nhs.uk" fallback row means no search ever dead-ends
- Optional richer mode: with a free NHS Website Content API key (Options → Leaflets), leaflets render inside the panel — text-only construction, NHS attribution linking back to the source page, 24-hour cache, calm fallback to open-in-tab on any error. Without a key the tab contacts no external endpoint at all; the key itself never leaves the machine and is excluded from backups

## In-page features (content scripts)

**Triage Lens — request queue** (all Medicus pages): overlays the patient request queue with semantic triage chips. Red = same-day or 999; amber = urgent; info = supplementary. 77+ built-in rules across chest pain, sepsis, stroke/TIA, anaphylaxis, obstetric emergencies, mental health crisis, paediatric red flags, 2WW cancer patterns, and common acute presentations. New built-in rules reach existing users automatically; rules deliberately deleted stay deleted.

**Triage Lens — investigation results queue** (Medicus Investigation Results filing queue): decorates each pending result row with per-row severity chips — Urgent (red, lab's own flag), N abnormal (amber, lab's above/below-reference flags), Under-prioritised (red, result severity exceeds assigned priority), and Unmatched patient (amber). User-authored analyte threshold rules and text-classification rules (e.g. MSU/urine culture) can escalate severity but can never lower or suppress a laboratory's own urgent or abnormal flag. Result rules can be scoped to a specimen so a threshold applies only to the right sample type, with fail-open behaviour when no specimen is present. 35 built-in result rules ship enabled — biochemistry/haematology thresholds (eGFR, potassium, sodium, calcium, magnesium, haemoglobin, platelets, neutrophils, INR, HbA1c, lithium, digoxin, TSH, ferritin, B12, FIB-4) and microbiology/imaging text classifiers (blood/urine/throat/wound/ear/genital culture, stool MC&S, H. pylori, STI NAAT, EBV serology, histology, ultrasound, bowel-screening); new custom rules arrive disabled and require clinician review before firing.

**Prescribing workflow button** (prescription-request task overview): a one-click "send to routine prescriptions" button that re-assigns the task to the configured prescribing team by driving Medicus's own re-assign UI. Configurable team and commit mode (confirm/manual/auto); never makes network calls or reads patient-data field values.

**Inline appointment booking** (all Medicus task overview pages): a collapsible "Book appointment for this patient" panel injected directly below the "Codes & actions" card. Resolves the current patient from the task, fetches available slot types and times, and books through the Medicus scheduling API — including server-triggered patient notifications. Abandoned bookings release the slot reservation via a keepalive request on navigation.

**Inline task creation** (all Medicus task overview pages): a collapsible "Create task for this patient" panel that drives the Medicus task API directly. On open it resolves the patient and fetches the create form to populate Assign to (teams and staff) and Priority; Create posts to the task API with description, assignee, priority, and optional snooze date.

**Sentinel content script** (all Medicus pages): provides per-patient monitoring data to the Sentinel side-panel module. Also drives prescribing-safety combination chips (STOPP/START-style), QRISK3/QCancer/eFI risk-calculator signpost chips, and NHS Pharmacy First pathway hints on the patient record view.

**Pusher relay** (all Medicus pages): bridges real-time Medicus push events to the side panel so alert strips and the Today module update without polling.

**Referrals discovery** (all Medicus pages): detects the practice's Medicus referrals API endpoint and stores it for the Referrals Tracker.

## Alert engine

The rules engine evaluates patient data against seven rule types:

- **drug-monitoring**: drug X must have test Y within Z days. Fires overdue/due-soon/in-date chips with exact test names and intervals. Supports **value-banded intervals** (`intervalByBand`): if a result falls into an abnormal band the monitoring interval shortens automatically — the engine always applies the shortest applicable interval (escalate-only; never extends beyond the baseline). 27 built-in rules covering lithium, methotrexate, azathioprine, ciclosporin, leflunomide, hydroxychloroquine, amiodarone, clozapine, combined hormonal contraception, and more
- **qof-register**: detects QOF register membership from active problems. 13 built-in registers (diabetes, CKD, hypertension, COPD, asthma, AF, CHD, heart failure, dementia, depression, mental health, palliative care, obesity)
- **qof-indicator**: evaluates a target (observation value, medication presence, or observation trend) against a QOF threshold. 52 bundled indicators covering the major QOF 2025/26 clinical domains
- **drug-combo**: flags clinically significant prescribing combinations (STOPP/START, PINCER-style). Age and sex filters; problem-list suppression. 26 starter alerts in the prescribing-safety library, including named PINCER interactions (methotrexate + trimethoprim/co-trimoxazole; allopurinol/febuxostat + azathioprine/mercaptopurine; ACEi/ARB + potassium-sparing diuretics)
- **event-count**: fires on presence or count of coded events (e.g. A&E attendances ≥3 in 12 months). Supports count/min/max operators
- **composite**: combines the results of other rules with AND/OR logic for complex multi-condition alerts
- **vaccine**: seasonal window rules; flu and COVID chips appear only during the active campaign period (dates refreshed to 2026/27 JCVI guidance)

Rules are practice-editable via a form-based editor in Options with a live engine preview against an editable test patient. An LLM-assisted authoring flow (copy prompt → external LLM → paste JSON → validate → import disabled) is available for custom rules.

## Settings & customisation

- **Practice Profile**: shared-folder managed deployment — a practice administrator can push config and rules to all seats from a single JSON on a shared drive. Central attestation support: gates accepted by the administrator propagate to managed seats without a per-user click
- **Single "Accept this for practice" switch** (Options → Clinical Safety): one administrator control accepts all three central attestations (reception pathways, knowledge base, and managed config) together, rather than a separate click per gate
- **Choose your tabs**: pick which side-panel tabs appear and in what order — discoverable in Options, and surfaced for managed installs so a Practice Profile can ship a tailored tab set per seat
- **Backup / restore**: full suite-wide envelope export and import covering all modules and rule sets. All backups contain configuration only — no patient-identifiable data is ever included
- **Display preferences**: theme (light/dark/auto), size (compact/medium/large), and colourblind mode
- **Options**: per-module configuration including triage-lens system chips, result rule editing (with a live result inspector that loads a recent result on demand — no JSON paste needed — and specimen-scope/name suggestions drawn from the open queue), reception pathway management, knowledge base starter import, QOF submission thresholds, and **Lab Filing** (admin-only authoring of the all-normal filing profiles, with optional disabled-by-default starter profiles)
- **Glossary tooltips**: clinical codes, jargon, and pressure indices carry click-to-explain inline tooltips across the Condor, Reception, and Sentinel modules
- **Event Ledger** (Options): a machine-local, capped record (5,000 events / 90 days) of what the suite displayed or did — alerts shown and dismissed, sweep runs, recall creations, summary copies, pre-flight checks, lab filings — with patient-UUID/date filters, hardened CSV export and a typed-confirmation clear. Patients recorded by UUID only, never by name; deliberately excluded from suite backups
- **Suite health** (Options + side-panel strip): the extension self-diagnoses its Medicus integration points — a registry of every DOM contract it depends on is probed at runtime, and a calm amber strip plus an Options table say which feature is degraded when Medicus changes its interface, instead of features silently going quiet

## Recent additions (last 4 weeks)

- **v3.147.0 (2026-07-02)** — **NHS Patient Leaflets tab**: bundled 221-entry NHS Health A-Z fuzzy search with open-in-tab, copy-link, recents and an always-present nhs.uk search fallback (zero configuration, no new external endpoint); optional in-panel leaflet rendering via the free NHS Website Content API (Options-gated key, text-only DOM construction, NHS attribution, 24h cache, calm fallback; key excluded from backups)
- **v3.146.0 (2026-07-02)** — **"Unbreakable" self-diagnosis**: a DOM-contract registry documenting all 14 Medicus selector contracts the suite depends on, with sanitised fixtures + a console capture helper and CI drift tests; runtime canaries (two-strike hysteresis, counts-only, no text reads) that surface "Medicus may have changed — X degraded" in a side-panel strip and an Options Suite-health table. Motivated by three clinic-discovered selector regressions in the previous six releases
- **v3.145.0 (2026-07-01)** — **Class-leader trio**: Prescribing Pre-flight (what-if drug check on the Record tab — ACB delta, newly-triggered STOPP/START, interactions, monitoring baselines; unknown ≠ safe); Clinical Event Ledger (machine-local, UUID-only audit of what the suite displayed/did, with Options query/CSV/clear); Practice Pulse (7/30-day snapshot trends and prior-period comparison in Condor and the Practice Report, coverage disclosed, gaps never interpolated)
- **v3.144.0 (2026-07-01)** — **Top-10 user-value set**: Today "what needs you now" headline; per-tab "?" help; Trends resting state; Sentinel rule-coverage drill-down (every drug rule's matched terms and QOF indicators, counts test-locked); Referrals patient-name search + clinician filter with disclosed filtered CSV export; Condor tunable pressure-index weightings (safety floor unconditionally preserved and fuzz-tested); Slots low-slot alert thresholds surfaced on Today; patient-scoped command-palette actions
- **v3.143.0 (2026-06-30)** — **Lab Results Auto-Filing**: a one-click "File all normal" action that appears in Medicus only when the suite has confirmed every value on an investigation-report task is within normal limits. It drives Medicus's own filing controls behind a confirmation (no full-auto), with an all-normal gate that fails closed on free text/cultures, unmatched reports, significant trends vs the previous value, monitored drugs, promised-contact phrases and a per-patient never-file list; clinician-set per-analyte ranges (incl. an opt-in override of over-sensitive lab reference ranges such as eGFR); multi-panel (combined-bloods) tasks via profile union; a prepare-only patient message; per-install kill switch; and a local audit log. **The suite's first feature that drives a clinical-record write** (filing a result), so it is admin-configured in Options → Lab Filing (not a side-panel tab), every profile arrives disabled until reviewed, and optional starter profiles (FBC/U&E/Bone/LFT) load disabled. Pending CSO review of the formal safety docs
- **v3.138.0–142.1 (2026-06-29)** — GP-pressures feature set: Sentinel high-risk "blind-spot" banner for monitored drugs that match no rule (DMARDs, lithium, amiodarone, anticoagulants, etc. surfaced from the unmatched list instead of buried); Sweep QOF points-at-risk prioritiser ranking gaps by indicator points with a CVD-prevention subtotal; Referrals 2WW / Faster-Diagnosis safety-net worklist (suspected-cancer referrals still showing Incomplete, oldest-first with day-ages and watch/overdue severity); Sweep one-click "Create recall task" that writes a task via Medicus's own general-task endpoint (explicit per-patient confirm, no bulk create); and a NICE NG136 ACE-I/ARB post-initiation U&E check via a new additive engine mechanism that fires only when the drug's start date is known and no U&E has been recorded since starting (cannot cry wolf on an established patient; clinical-rule change, pending CSO sign-off)
- **v3.134.4–6 (2026-06-26)** — Outstanding investigation matching: HbA1c, TSH-only thyroid reports, and combined B12/Folate requests now correctly matched to their outstanding requests and auto-ticked on result; triage monitor UUID field now accepts the full Medicus inbox URL (UUID extracted automatically)
- **v3.134.0–2 (2026-06-23)** — New inline "Create task for this patient" widget on task overview pages (prescribing, medical, admin): drives the Medicus task API directly with assignee, priority, description and snooze; inline booking widget now also appears on prescribing overviews (universal fallback anchor); slot-reservation keepalive prevents abandoned bookings from locking slots
- **v3.131.0–133.5 (2026-06-21–23)** — One-click "send to routine prescriptions" button on prescription-request overviews (drives Medicus's own re-assign UI; configurable team/commit mode; H-035 hazard logged); inline "Book appointment for patient" widget injected into Medicus task pages; shared DOM-observer hub cuts per-feature observer count from 3 to 1 (performance); observer fast-paths eliminate reflow storms on idle SPA re-renders
- **v3.127.0–128.2 (2026-06-21)** — "Road to 10" UX pass: action buttons recast to sentence-case, amber/blue accent palette reserved for genuine clinical/capacity signals only, Today recomposed as a hero card plus quiet supporting stack, overlay entrance motion (prefers-reduced-motion guarded), reticle brand spinner introduced
- **v3.126.0 (2026-06-20)** — Value-banded monitoring intervals: drug-monitoring rules can now shorten the monitoring interval when a result falls into an abnormal band — shortest interval always wins, baseline is the fallback. CHC (combined hormonal contraception) monitoring rule enabled. Levomepromazine/methotrimeprazine added to the ACB scale at score 3
- **v3.125.0 (2026-06-20)** — Urine electrolytes false-positive fix (patient-safety): urine electrolytes can no longer wrongly clear an outstanding blood U&E request. Twelve new shipped result rules promoted to built-in defaults: ultrasound, histology, H. pylori, STI NAAT, stool MC&S, vaginal/wound/ear swab, EBV serology (text classifiers), plus FIB-4 elevated, low ferritin, and low B12 thresholds
- **v3.124.0 (2026-06-20)** — Three new drug-combination alerts: methotrexate + trimethoprim/co-trimoxazole (red, named PINCER never-event); allopurinol/febuxostat + azathioprine/mercaptopurine (red, life-threatening myelosuppression); ACEi/ARB + potassium-sparing diuretic (amber, monitoring required). ACB scale additions: carbamazepine, oxcarbazepine, amantadine, pethidine (score 2)
- **v3.114.0 (2026-06-17)** — Whole-suite clinical-matching hardening: single canonical ACB scorer across queue and panel (strong anticholinergics now score identically everywhere); STOPP NSAID term list brought to full UK generic + brand coverage; producer→consumer contract tests lock the engine↔renderer interface
- **v3.109.0–113.0 (2026-06-16)** — Record tab (live patient summary with problems, meds, results, prescribing-safety prompts); plain-language legibility lift; "All tabs" menu; keyboard tab navigation; Condor CSV export; CQC Inspection Readiness tab
- **v3.84.0–108.0 (2026-05-28–2026-06-16)** — Sweep multi-clinician filter and day-picker; Practice Report (periodised, three audience profiles, print→PDF + CSV); choose-your-tabs; result-rule live inspector; single "Accept for practice" switch; Reception guided capture (CSO-signed-off); Knowledge base; Referrals Tracker; Capacity, Condor, Activity, Submissions modules; pop-out window; Practice Profile managed deployment; full suite backup/restore

## Safety posture

Medicus Suite is primarily a passive display tool: it reads data already present in Medicus and presents it in the browser. It performs no AI inference, transmits no patient data to any external service, and makes no clinical decisions. The only writes are explicit, user-initiated actions performed through Medicus's own controls/API endpoints (booking an appointment, creating a task, re-assigning a prescription request, and Lab Results Auto-Filing) — Medicus stays the system of record and nothing is written automatically. Lab Results Auto-Filing is the most safety-significant of these (it files an investigation result) and is correspondingly gated: admin-only configuration, disabled-until-reviewed profiles, an all-normal fail-closed gate, and a per-install kill switch. All computation happens locally in the extension. See INTENDED-PURPOSE.md, HAZARD-LOG.md and CLINICAL-SAFETY-NOTICE.md.
