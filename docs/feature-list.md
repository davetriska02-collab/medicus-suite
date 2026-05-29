# Medicus Suite — Feature List

**Version:** v3.4.1
**Generated:** 2026-05-29 (automated)

## What it is

Medicus Suite is a Chrome side-panel companion for the Medicus electronic
patient record. It sits alongside the clinical system and surfaces practice
demand, capacity, and activity at a glance, adds clinical-context overlays on
patient records and triage queues, and lets the practice track referrals and
daily submissions — all from API data the clinician is already entitled to
see. It is a passive display and memory aid: it never writes to the record,
never makes clinical recommendations, and keeps all data inside the browser.

## At a glance

- **6 side-panel modules** — Slots, Capacity Forecast, Submissions, Monitoring, Activity, Referrals
- **4 in-page (content-script) features** — Triage Lens, Sentinel HUD, Referrals discovery, live Pusher updates
- **7 rule types** in the alert engine
- **22 bundled starter alerts** in the library (19 prescribing-safety, 3 clinical-review)

## Side-panel modules

### Slot Counter — v2.2
Shows available appointment slots by type for any date, straight from the
scheduling API — no need to open the appointment book. Updates live via Pusher
whenever a Medicus tab is open.
- Per-type slot counts for any chosen date
- Live refresh on scheduling changes
- Hide slot types you don't want counted; choices are saved
- Configurable per-type alert thresholds with a nav badge

### Capacity Forecast
Turns the live slot picture into a forward view of capacity against
practice-defined targets, so you can see where the week is tight before it
bites.
- Reusable presets (a named bundle of slot types + targets)
- Minimum-per-day target with "tight" and "low" warning thresholds
- RAG-style readout per preset

### Submissions Tracker — v1.0
Daily inbound task counts across medical, admin, investigation and prescription
categories.
- Today view, custom date range, and day-vs-day comparison
- Optional RAG threshold alerts surfaced as a global strip

### Monitoring (Sentinel) — v0.4.2
A clinical-context sidebar on patient records covering drug monitoring and QOF
2025/26 indicators. It displays, against the patient's own active medications,
problems, and recent observations, the most recent recorded values relevant to
published drug-monitoring guidance and QOF criteria, and whether each is in or
out of the recommended interval.
- Chips coloured by status (in-range, due soon, overdue, severely overdue)
- Click any chip to see the exact evidence the engine matched — the medication,
  the test, the value, the date, and the threshold that fired it
- Inline sparkline for observation trends
- Passive only: no actions ordered, nothing written to the record

### Activity Report — v1.0
Practice activity per staff member across a configurable date range.
- Period totals plus a stacked bar chart by consultations, prescription
  requests, medication reviews, document tasks, and investigation results

### Referrals Tracker — v1.0
Referral audit data across a configurable date range.
- Total referral count with priority (Routine / Urgent / 2WW) and status
  breakdowns
- Bar charts by referring clinician, specialty, and hospital

## In-page features (content scripts)

These activate automatically on Medicus pages (`*.medicus.health`):

- **Triage Lens (v0.5.0)** — an overlay on patient records and triage queues
  that highlights user-defined keywords with severity chips.
- **Sentinel HUD** — the drug-monitoring / QOF context display rendered
  directly on the patient record page.
- **Referrals discovery** — collects the referral data the Referrals Tracker
  reports on.
- **Live updates (Pusher relay)** — pushes scheduling changes through so the
  Slots and demand strips refresh in real time.

## Alert engine

The Monitoring module is driven by a rules engine supporting seven rule types,
so alerts can be tailored to local protocols:

- **Drug monitoring** — a medication requires a test at an interval; flags
  when the latest result is missing or out of date.
- **QOF register** — patient belongs to a register based on a coded problem.
- **QOF indicator** — an observation meets (or misses) a threshold within the
  QOF year / rolling window, with register preconditions.
- **Drug combo** — combinations of drugs (optionally gated on age, sex, or
  problems) that warrant caution, e.g. interaction risks.
- **Event count** — counts matching events in a window, e.g. ">3 UTIs".
- **Composite** — combines several sub-rules with AND/OR logic; sub-rules are
  drillable from the evidence panel.
- **Observation trend** — direction and magnitude of change across a series.

Out of the box, the bundled **alert library** ships 22 starter alerts (19
prescribing-safety, 3 clinical-review) that can be added individually or all
at once.

## Settings & customisation

- **Practice Profile** — shared-folder managed deployment of practice settings
- **Backup / restore** — a single suite-wide backup envelope, or per-module
- **Display preferences** — theme, density, and colourblind-friendly palette
- **Feedback** — a built-in Feedback / feature request / bug report button
  (About tab) that emails the developer; recipient configurable in settings
- **Clinical Safety** — an in-app tab linking the full safety case

## Recent additions (last 4 weeks)

- **v3.4.1 (2026-05-29)** — configurable feedback recipient email, included in backup/restore
- **v3.4.0 (2026-05-29)** — Feedback / feature request / bug report button in the About tab
- **v3.3.1 (2026-05-29)** — removed low-value Triage Lens read-time chips; de-duplicated chip defaults
- **v3.3.0 (2026-05-29)** — new Clinical Safety settings tab linking the safety case documents
- **v3.2.x (2026-05-29)** — clearer non-time-based alert wording (ALERT / CAUTION / NOTED), "Severely overdue" relabel, alert-library "Add all", and several theme/legibility fixes
- **v3.2.0 (2026-05-28)** — chip provenance: click any monitoring chip to see the exact evidence the engine matched

## Safety posture

Medicus Suite is a passive display tool and memory aid. It does not write to
the patient record, does not order investigations, does not modify QOF claims
data, performs no AI inference, and transmits no patient data outside the
user's browser. It is not a medical device and does not constitute clinical
decision support; all clinical decisions, including verification of any
displayed value against the source record, remain the responsibility of the
clinician. See `INTENDED-PURPOSE.md` and `CLINICAL-SAFETY-NOTICE.md`.
