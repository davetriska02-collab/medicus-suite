# Medicus Suite — Feature List

**Version:** v3.26.4
**Generated:** 2026-06-03 (automated)

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

- **8 side-panel modules** — Slot Counter, Capacity Forecast, Submissions Tracker, Sentinel, Activity Report, Referrals Tracker, BP Trend, ACR Trend
- **4 in-page features** — Triage Lens, Sentinel engine, Referrals discovery, live Pusher updates
- **7 rule types** in the alert engine
- **84 bundled rules** (24 drug-monitoring, 58 QOF registers and indicators, 2 vaccination eligibility) plus **22 opt-in starter alerts** in the library

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
- Colour-coded RAG status (Sufficient / Tight / Low / Critical / Closed) per day
- Week and month calendar views; optional weekend display
- Multiple presets for different staff groups or session types

### Submissions Tracker v1.0

Daily inbound task counts across medical, admin, investigation, and
prescription-request categories.

- Today view, custom date range, and same-day comparison mode
- Stacked bar chart for week-on-week pattern recognition
- Optional RAG thresholds (amber / red) per task type; breaches shown as a persistent global strip at the top of the panel

### Sentinel

Clinical-context display for the open patient record, covering drug monitoring,
QOF 2025/26 indicators, vaccination eligibility, and the practice waiting room.
Chips are colour-coded (red / amber / green / grey) and sorted worst-first; each
chip links through to the exact evidence the engine matched — the medication,
test, value, date, and threshold.

- **Drug-monitoring recall** — shows whether each high-risk medication's monitoring tests are in date, due soon, overdue, or absent; covers 24 drugs including DMARDs, lithium, amiodarone, ADHD stimulants (methylphenidate, lisdexamfetamine, dexamfetamine), atomoxetine, and guanfacine
- **QOF indicator status** — checks whether targets are met for the current QOF year against the patient's registers and observations across 46 indicators
- **Register membership** — identifies which of 12 QOF disease registers the patient's coded problems place them on (including Dementia)
- **Vaccination eligibility** — flu and COVID chips derived from JCVI/UKHSA 2025/26 criteria (age, QOF registers, active problems, medications, and BMI); status DUE / GIVEN / DECLINED per season
- **Trend monitors** — falling eGFR (NICE NG203, ≥15 mL/min over 3 readings in 24 months), rising HbA1c (diabetics only, ≥10 mmol/mol over 3 readings), rising PSA
- **Observation-safety alerts** — hyperkalaemia (amber 5.5–5.9 mmol/L; red ≥6.0 mmol/L)
- **Per-rule hide / snooze** — dismiss any chip permanently or snooze to a future date (vaccine chips snooze to the next season start); managed in Sentinel settings
- **Inline evidence panel** — click any chip to see matched value, date, reference range, and which part of the rule fired
- **Waiting-room list** — patients currently checked in, polled every 30 seconds
- **Extraction-health warning** — if the page layout has drifted and no patient data can be read, shows a prominent warning rather than a misleading empty state
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
- Referral rate per clinician (referrals ÷ consultations) when activity data is available
- Filter by priority and status chips; staleness warning after 30 minutes

### BP Trend

Blood pressure history for the active patient as a dual-line SVG chart
(systolic and diastolic), with condition-specific target lines.

- Target lines auto-set from achieved QOF register chips: 150/90 for hypertension aged ≥80, 130/80 for CKD with high ACR, 140/90 otherwise
- AT TARGET / ABOVE TARGET summary pill
- Paediatric caveat shown for under-18s (adult thresholds displayed; centile charts needed for accurate paediatric assessment)
- Updates each time the Sentinel engine publishes a new snapshot

### ACR Trend

Albumin:creatinine ratio and eGFR history for the active patient with KDIGO
staging overlays.

- ACR history chart with A1 / A2 / A3 threshold band shading; eGFR co-plotted with G-stage colour bands
- KDIGO G×A monitoring-frequency cell showing recommended checks per year for the patient's current stage combination
- Action banners for ACR ≥70 (consider nephrology referral), ACR doubling, and KDIGO category crossing
- Updates each time the Sentinel engine publishes a new snapshot

## In-page features (content scripts)

These run automatically on Medicus pages (`*.medicus.health`) when the
extension is installed:

**Triage Lens** — an overlay on the triage queue and patient records that
applies configurable detection rules to request text and surfaces severity chips
directly in the task row or patient record view:

- 20 built-in rules covering chest pain, red-flag headache, GI bleed, sepsis, mental-health crisis, anticoagulants, and more; 620+ detection patterns covering lay, clinical, and abbreviated phrasings
- On individual patient records: STOPP/START-style prescribing-safety prompts (NSAID + anticoagulant GI bleed risk; triple whammy AKI risk; benzodiazepine/Z-drug in age ≥80) and an NHS Pharmacy First signpost for all 7 national pathways (UTI, sore throat, otitis media, sinusitis, insect bite, impetigo, shingles)
- Risk-tool signpost chip (adults ≥25) with links to QRISK3, QCancer, and eFI calculators
- Configurable per-chip enable/disable, match thresholds, and user-defined rules
- Draggable HUD overlay; position is remembered per session

**Sentinel engine** — the drug-monitoring and QOF evaluation engine running as a
content script on patient-record pages. Evaluates the full merged rule set and
publishes the chip snapshot to the side-panel Sentinel module on each navigation.

**Referrals discovery** — detects the practice-specific referrals API endpoint
from the Medicus page and stores it for the Referrals Tracker.

**Live updates (Pusher relay)** — intercepts Medicus scheduling events and
forwards them so the Slot Counter and demand strips refresh without a manual
reload.

## Alert engine

The Sentinel display and the Custom Alert Builder are driven by the same rules
engine, which supports seven rule types:

- **Drug monitoring** — a prescribed medication triggers a monitoring recall; the engine checks whether each required test was recorded within the configured interval. Fires as overdue, due soon, severely overdue, recently-initiated (grace period), or no data found.
- **QOF register** — confirms whether the patient belongs to a QOF disease register based on active coded problems, with word-boundary matching and negation handling.
- **QOF indicator** — checks whether an observation, medication, or care-process bundle meets the QOF target threshold within the current QOF year or a rolling window, with register-membership preconditions and age/sex filters.
- **Drug combo** — detects two or more drug classes co-prescribed (optionally gated on age, sex, or problem list). Used for PINCER/STOPP-style prescribing-safety combinations. Supports exclusion lists (e.g. topical NSAIDs, co-prescribed gastroprotection).
- **Event count** — counts occurrences of matching observations or coded events within a time window and fires above a configurable threshold.
- **Composite** — combines any number of other rules with AND / OR logic; each component rule's own evidence remains drillable.
- **Vaccination eligibility** — checks whether flu or COVID vaccination is due for the current season based on JCVI/UKHSA eligibility criteria derived from age, register membership, active problems, medications, and observation values.

The bundled **alert library** ships 22 opt-in starter alerts (19 prescribing-safety
based on PINCER and UK guidelines; 3 clinical-review) as editable starting points for
local review.

Practices can extend the rule set with the **Custom Alert Builder** in Sentinel settings,
which provides a form for all five non-vaccine rule types with an engine-backed live
"would this fire?" preview against an editable mock patient and schema validation on save.

## Settings & customisation

- **Practice Profile** — stores the practice site ID, enabling the API-based modules without a Medicus page open; supports shared-folder managed deployment for practice-wide configuration push
- **Backup / restore** — suite-wide envelope or per-module export covering custom rules, capacity presets, display preferences, and hidden-alert state
- **Display preferences** — light / dark / system theme, text density, and a colourblind-friendly palette
- **Custom Alert Builder** — create and edit Sentinel alerts for all rule types with live engine preview and validation
- **Sentinel settings** — alert library (import individually or in bulk), hidden/snoozed alerts management, vaccine rule on/off toggle

## Recent additions (last 4 weeks)

- **v3.26.3–v3.26.4 (2026-06-02)** — Per-rule hide and snooze on monitoring chips; vaccine chips snooze to next season start; HRT progestogen-coverage check now detects hysterectomy coded as a past/ended problem
- **v3.26.0–v3.26.2 (2026-06-02)** — Vaccination eligibility chips added (flu and COVID, JCVI/UKHSA 2025/26); eligibility derived from age, QOF registers, problems, medications, and BMI; status DUE / GIVEN / DECLINED; bug fixes for QOF chips on care-record view and vaccine chip false positive
- **v3.25.0–v3.25.3 (2026-06-02)** — Two new trend modules: BP Trend (dual-line chart with condition-specific targets) and ACR Trend (KDIGO G×A staging, eGFR co-display, referral action banners)
- **v3.24.0 (2026-06-02)** — ADHD stimulant monitoring rules (paediatric and adult) added; atomoxetine (6-monthly bloods + annual LFT) and guanfacine (3-monthly BP/HR/weight) monitoring rules added
- **v3.23.0 (2026-06-02)** — Smoking status due chips across all relevant QOF registers; carbamazepine monitoring rule; new `observation-bundle` engine support for care-process-set indicators; DM037 (8 diabetes care processes) enabled
- **v3.22.0 (2026-06-01)** — Custom Alert Builder brought to full parity with the engine: `medicationExclude`, `requiresProblem`/`requiresAnyProblem`, `ageRange`, `sex`, and per-test SNOMED codes now reachable from the form
- **v3.21.0–v3.21.3 (2026-06-01)** — Journal-coded QOF indicators now fire in the side panel; backup/restore coverage completed (display preferences, sentinel acknowledgements, per-module export cards); clinical-correctness fixes for QOF age/sex filters, STIA register TIA abbreviation matching, and HRT chip over-trigger on contraceptive progestogen
- **v3.18.0–v3.20.0 (2026-05-31)** — Falling eGFR trend monitor (NICE NG203) and hyperkalaemia safety alert added as defaults; new `observation-alert` rule type; rising HbA1c trend monitor for diabetics; toolbar icon reliability fixed across Chrome service-worker edge cases

## Safety posture

Medicus Suite is a passive display tool and memory aid. It does not write to
the patient record, does not order investigations, does not modify QOF claims
data, performs no AI inference, and transmits no patient data outside the
user's browser. All chip outputs are deterministic rule evaluations against data
the clinician already holds. It is not a medical device and does not constitute
clinical decision support; all clinical decisions, including verification of any
displayed value against the source record, remain the responsibility of the
clinician. See `INTENDED-PURPOSE.md` and `CLINICAL-SAFETY-NOTICE.md`.
