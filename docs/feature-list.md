# Medicus Suite — Feature List

**Version:** v3.17.2
**Generated:** 2026-05-31 (automated)

## What it is

Medicus Suite is a Chrome side-panel companion for the Medicus electronic
patient record (EPR). It sits alongside the clinical system and surfaces
practice demand, capacity, and activity at a glance, adds clinical-context
overlays on patient records and triage queues, and lets the practice track
referrals and daily submissions — all drawn from API data the clinician is
already authorised to see. It is a passive display and memory aid: it never
writes to the record, never makes clinical decisions, and keeps all data inside
the browser.

## At a glance

- **6 side-panel modules** — Slot Counter, Capacity Forecast, Submissions Tracker, Sentinel, Activity Report, Referrals Tracker
- **4 in-page features** — Triage Lens, Sentinel HUD, Referrals discovery, live Pusher updates
- **7 rule types** in the alert engine
- **22 bundled starter alerts** in the library (19 prescribing-safety, 3 clinical-review)

## Side-panel modules

### Slot Counter v2.2
Shows available appointment slots by type for any date, direct from the
scheduling API — no need to open the appointment book. Updates live via Pusher
whenever a Medicus tab is open.
- Per-type slot counts for any chosen date
- Live refresh triggered by scheduling changes
- Hide slot types you don't want counted; choices are saved
- Configurable per-type alert thresholds with a nav-strip badge

### Capacity Forecast
Turns the live slot picture into a forward view of capacity against
practice-defined daily targets, so you can see where the week is tight before
it bites.
- Reusable named presets — each bundles a set of appointment types and a daily minimum
- Colour-coded RAG status per day and per preset
- Week and month calendar views; weekend suppression option
- Multiple presets for different staff groups or session types

### Submissions Tracker v1.0
Daily inbound task counts across medical, admin, investigation, and
prescription-request categories.
- Today view, custom date range, and same-day-last-week comparison
- Stacked bar chart for week-on-week pattern recognition
- Optional RAG thresholds (amber / red) per task type; breaches shown as a persistent global strip at the top of the panel

### Sentinel
Clinical-context display for the open patient record, covering drug monitoring,
QOF 2025/26 indicators, and the practice waiting room. Chips are colour-coded
(red / amber / green / grey) and sorted worst-first; each chip links through to
the exact evidence the engine matched — the medication, test, value, date, and
threshold.
- Drug-monitoring recall: shows whether each high-risk medication's monitoring tests are in date, due soon, overdue, or absent
- QOF indicator status: checks whether targets are met for the current QOF year against the patient's registers and observations
- Register membership: identifies which QOF registers the patient's coded problems place them on
- Inline evidence panel: click any chip to see the matched value, date, reference range, and which part of the rule fired
- Waiting-room list: patients currently checked in, polled every 30 seconds in real time
- Extraction-health warning: if the page layout has drifted and no patient data can be read, shows a prominent warning rather than a misleading empty state
- Filter by action-needed vs clear; refresh on demand or automatically on tab navigation

### Activity Report v1.0
Practice activity data per staff member across a configurable date range.
- Period totals and a stacked horizontal bar chart by consultations, prescription requests, medication reviews, document tasks, and investigation results
- Configurable date presets (today, this week, custom range)
- Auto-refreshes when the configured practice code changes

### Referrals Tracker v1.0
Referral audit data across a configurable date range, sourced from the
practice's Medicus referrals endpoint.
- Total referral count with Routine / Urgent / Two-Week-Wait priority and Completed / Incomplete / Cancelled status breakdowns
- Bar charts by referring clinician, specialty, and hospital (top 15 per view)
- Referral rate per clinician (referrals ÷ consultations) when activity data is also available
- Filter by priority and status chips; staleness warning after 30 minutes

## In-page features (content scripts)

These run automatically on Medicus pages (`*.medicus.health`) when the
extension is installed:

**Triage Lens** — an overlay on the triage queue and patient records that
applies up to 20 configurable detection rules to incoming patient request text
and surfaces severity chips directly in the task row:
- 20 built-in rules covering chest pain, red-flag headache, GI bleed, sepsis, mental-health crisis, medication reviews, and more; 620+ detection patterns covering lay, clinical, and abbreviated phrasings
- NHS Pharmacy First signposting for all 7 national pathways (UTI, sore throat, otitis media, sinusitis, insect bite, impetigo, shingles): eligibility notes and safety-netting displayed per pathway
- STOPP/START-style prescribing-safety flags on individual patient records: NSAID + anticoagulant, triple whammy (NSAID + ACEi/ARB + diuretic), benzodiazepine or Z-drug in patients aged ≥80
- Risk-tool signpost chip (adults ≥25) with links to QRISK3, QCancer, and eFI calculators
- Configurable match thresholds, rule priorities, and per-rule enable/disable
- Draggable HUD overlay; position is remembered per session

**Sentinel HUD** — the same drug-monitoring and QOF chip display rendered
directly in the page, alongside the patient record, without opening the side
panel.

**Referrals discovery** — listens for referral data loaded during normal
Medicus navigation and forwards it to the Referrals Tracker.

**Live updates (Pusher relay)** — intercepts Medicus scheduling events and
forwards them so the Slot Counter and demand strips refresh without a manual
reload.

## Alert engine

The Sentinel display and the custom-alert builder are both driven by the same
rules engine, which supports seven rule types. Each type can be used standalone
or mixed in a single ruleset:

- **Drug monitoring** — a medication triggers a recall requirement; the engine checks whether the required test was recorded within the configured interval. Fires as overdue, due soon, severely overdue, recently-initiated (grace period), or no data found.
- **QOF register** — confirms whether the patient belongs to a QOF register based on their active coded problems. Supports all major QOF 2025/26 registers including Dementia (DEM).
- **QOF indicator** — checks whether an observation or medication meets the QOF target threshold within the current QOF year or a rolling window, with register-membership preconditions.
- **Drug combo** — detects combinations of two or more drug classes (optionally gated on age range, sex, or problem list). Used for prescribing-safety patterns such as PINCER, interaction risks, and STOPP/START criteria. Supports exclusion lists (e.g. topical NSAIDs, co-prescribed gastroprotection).
- **Event count** — counts occurrences of matching observations or coded events within a time window and fires above a configurable threshold (e.g. three or more UTIs in 12 months).
- **Composite** — combines any number of other rules with AND / OR logic. Each component rule's own evidence remains drillable in the evidence panel.
- **Observation trend** — evaluates the direction and magnitude of change across a series of observations within a configurable window.

The bundled **alert library** ships 22 starter alerts based on PINCER (BMJ
2012) and standard UK prescribing-safety guidelines, designed as editable
starting points for local review: 19 prescribing-safety alerts (GI bleed risk,
anticoagulation interactions, cardiac and renal drug combinations, NSAIDs in the
elderly, valproate monitoring, and others) and 3 clinical-review alerts.

Practices can extend the ruleset with the **Custom Alert Builder** in Settings,
which provides an engine-backed "would this fire?" live preview across all five
non-composite rule types, driven by an editable mock patient. An Auto-fill
button seeds a firing example from the rule under construction.

## Settings & customisation

- **Practice Profile** — shared-folder managed deployment of practice-wide settings (rules, Triage Lens config, thresholds), so the suite admin can push a consistent configuration to all staff
- **Backup / restore** — a single suite-wide backup envelope or per-module export; covers all storage keys including custom rules, capacity presets, and display preferences
- **Display preferences** — theme (light / dark / system), density, and a colourblind-friendly palette
- **Custom Alert Builder** — create and edit Sentinel alerts for all seven rule types with live engine preview and validation
- **Feedback** — an in-panel feedback and bug-report button (About tab)
- **Clinical Safety** — an in-app tab linking the full safety case documents

## Recent additions (last 4 weeks)

- **v3.17.2 (2026-05-30)** — Sentinel now shows an explicit warning when the extraction canary detects a degraded snapshot; stale previous-patient snapshots are invalidated on navigation (wrong-patient risk fix)
- **v3.17.1 (2026-05-30)** — Security: `web_accessible_resources` restricted to `*.medicus.health` only
- **v3.17.0 (2026-05-30)** — Silent-failure detection for DOM/API drift; CI now runs the full test suite and defaults drift-check on every push
- **v3.16.0 (2026-05-30)** — Custom Alert Builder: engine-backed live preview for all five rule types (drug-combo, event-count, qof-indicator, composite, drug-monitoring)
- **v3.14.0 (2026-05-30)** — STOPP/START prescribing-safety flags and risk-tool signpost chips on patient records
- **v3.13.0 (2026-05-30)** — NHS Pharmacy First signposting for all 7 clinical pathways added to Triage Lens
- **v3.12.x (2026-05-30)** — Triage Lens detection expanded 5.8× (106 → 620 patterns); applicability-filter fix (demographic-gated alerts now fail open on unknown demographics)
- **v3.11.x (2026-05-30)** — Bug fixes: capacity backup data-loss, display-popover listener leak, wrong-patient snapshot guard, submissions NaN display, Triage Lens drag handler lingering after alt-tab

## Safety posture

Medicus Suite is a passive display tool and memory aid. It does not write to
the patient record, does not order investigations, does not modify QOF claims
data, performs no AI inference, and transmits no patient data outside the
user's browser. It is not a medical device and does not constitute clinical
decision support; all clinical decisions, including verification of any
displayed value against the source record, remain the responsibility of the
clinician. See `INTENDED-PURPOSE.md` and `CLINICAL-SAFETY-NOTICE.md`.
