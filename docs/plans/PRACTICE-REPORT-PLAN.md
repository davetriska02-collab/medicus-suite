# Practice Report — feature plan (Condor) — 2026-06-16

Status: **PLAN — not yet built.** Research complete (5 codebase + 5 web agents).
Build to be done by Opus after sign-off. Report-only until approved.

## 1. What it is

A **Practice Report** built on Condor's operational data, for a selectable period
(**Today / 7d / 30d / custom range**), rendered in a printable + exportable format
modelled on the Patient Record Visualiser's SMR print, with **audience-tuned output
profiles**: Practice Management, Staff Briefing, and ICB/System.

## 2. Hard constraints learned from the codebase

- **Print format is HTML, not a PDF library.** The visualiser and three other
  modules (sentinel/passport.js, sweep/handout.js, sweep/batch-handout.js) all
  export via a hidden print block + `@media print` CSS + `window.print()` (user
  "Save as PDF"). Reuse: the NHS-token CSS, `.card/.grid-2/3/4/.stat-tile/
  .data-table/.badge-*` classes, `esc()`, and the print-trigger pattern
  (visualiser-core.js ~3441). No jsPDF unless we deliberately add it.
- **Condor is live/poll-only; only Day Score is persisted** (`condor.dayScores`,
  30 days, `{date,score}`) — the model to copy for any new history store.
- **Historical data availability (the key constraint):**
  - Derivable for past days via real Medicus date-range endpoints:
    - **Demand/submissions** — `tasks/.../task-list?createdAt_startDate&createdAt_endDate` (5 task types)
    - **Activity (per-clinician, work done)** — `reporting/data/activity/report?startDate&endDate`
    - **Slots/capacity** — `scheduling/.../embedded-overview?date=` per day via `fetchManyDates` (concurrency 5, 5-min cache)
    - **Referrals** — `referrals/clinical-audit-report?referralStartDate&referralEndDate` (paginated)
  - **Live-only, NO history:** waiting-room queue depth, request-monitor task-age
    buckets, "remaining slots as of a past time", and the PPI (a composite of live
    signals). In multi-day reports these are a **"current snapshot"**, never a trend,
    unless we start accruing daily snapshots going forward.
- **Export/storage:** `shared/modules/.../export-util.js` → `downloadCsv`,
  `copyTsv`, `copyText`. Storage ~10 MB; reuse the `dayScores` prune-on-write
  pattern. Backup convention per CLAUDE.md: `shared/io/<module>-io.js` +
  `VALID_SCOPES` + options wiring + per-module export card.
- **Config patterns:** `capacity.presets` is the named-preset model (Options
  editor + storage + onChanged sync). Palette commands register in
  `palette.js buildCommands()`. Section on/off via a stored visibility map
  (`slots.hiddenTypes` pattern).

## 3. What the reports should contain (domain research, UK/NHS)

Correct NHS terminology (use verbatim; sources in the research transcripts):
- **Appointment modes** (GPAD): face-to-face, telephone, video/online, home visit.
- **DNA** = booked but not attended ÷ booked. **Utilisation** = booked ÷ available
  (NOT the same as attendance — commonly conflated).
- **Same-day** = appointment date == booking date (calendar date). **Clinically-urgent
  same-day** and **next-day non-urgent response** are 2026/27 contract measures.
- **Capacity benchmark:** ~**72 appts / 1,000 patients / week** (GP/AHP), **35** (nurse).
- **2WW is superseded by the 28-day Faster Diagnosis Standard (FDS).**
- Demand drivers: total triage volume, online-consult submissions, the 8am surge.
- Backlog: ageing tasks, referral queue age, prescription turnaround (3–5 working days).

Report-design conventions seen across Apex / Ardens / X-on / GPAD:
- Period comparison (this vs last vs **4-week rolling average** vs **same period last
  year** for seasonality), **sparklines**, **RAG** status, a hard **"as at" /
  data-freshness** label, per-clinician **drill-down AND aggregate**, **PDF + CSV**.

### Audience profiles (the framing differs sharply)

| Profile | Includes | Critical rule |
|---|---|---|
| **Practice Management** | Full demand/capacity/activity/backlog detail, per-clinician drill-down, RAG, trends, defensible figures for partners | Every figure carries "as at" + source so it reconciles to Medicus |
| **Staff Briefing** | Aggregate workload by hour/day, "what we got through", pressure points, wins | **No per-clinician league tables / productivity counts** (Goodhart's law, morale, surveillance). Aggregate + context only. "We got busy together." |
| **ICB / System** | GPAD-aligned access metrics (modes, same-day %, FDS), capacity per 1,000/week, exact NHS metric names, benchmark context, "actions taken" | **Honesty:** label any GPAD-grade metric we cannot derive from Medicus as "not available from this source" — never fabricate an ICB figure |

## 4. Honesty / safety boundary (non-negotiable)

The suite is read-only and sees only what Medicus exposes. Several headline NHS
metrics (call-waiting times, true DNA, booking-to-appointment interval, online-consult
submissions, registered list size) may **not** be reliably derivable. **Decision: we
simply do not include a metric we cannot derive** — no "N/A" placeholders, no
approximations presented as GPAD-grade figures. Every figure shown is computed from
real Medicus data and carries its "as at" provenance. This mirrors the suite's existing
clinical-safety honesty ("no alert ≠ all clear", the eFI "arithmetic approximation"
caveat). A short "what this report does not cover (and why)" footnote keeps it honest
without cluttering the body.

## 5. Where it lives (DECISION: both)

- **In-panel summary** inside Condor — a compact "report" view / button giving the
  headline figures and a "Generate full report" action.
- **Full printable report page** — own HTML+JS, opened as a browser tab like the
  visualiser, reusing its print CSS/tokens wholesale. `window.print()` → PDF + CSV.
- Triggered by the Condor button **and** a **Ctrl+K palette command**.
- **Profiles configured in Options** (named-preset pattern).

## 6. Phased build (decisions folded in)

- **P1 — Data layer** (`practice-report-data.js`): fetch the historical windows
  (reuse `fetchManyDates`, activity range, submissions range, referrals range),
  build per-day series, compute metrics with correct NHS definitions **only where
  derivable** (omit the rest). Respect concurrency 5 + cache.
- **P2 — Forward daily-snapshot store** (`practice.reportSnapshots`, prune-on-write
  like `dayScores`, backup-IO wired per CLAUDE.md): capture PPI / waiting-room /
  task-age daily so the live-only metrics accrue trends from go-live. **In v1.**
- **P3 — Renderer** (`practice-report.html` + `.js`): reuse visualiser print
  CSS/tokens; sections = cover (practice code, period, "as at"), Demand, Capacity,
  Activity, Backlog, Referrals; period comparison (vs last / 4-week avg / same period
  last year) + sparklines + RAG; `window.print()` → PDF and `downloadCsv`. Plus the
  in-panel Condor summary view.
- **P4 — Audience profiles (all three in v1):** Management / Staff / ICB control
  section visibility + framing. **Staff = aggregate-only, enforced** (no per-clinician
  counts). **ICB = GPAD terminology, derivable metrics only.** Options editor (named
  presets) + palette command.
- **P5 — Tests + release:** data-aggregation tests, snapshot prune/backup-coverage
  test, profile section-gating tests (esp. Staff aggregate-only enforcement),
  NHS-definition calc tests; version bump (minor); CHANGELOG; docs.

## 7. Decisions (LOCKED 2026-06-16)

1. **Output:** both — in-panel Condor summary **and** full printable page (print→PDF + CSV).
2. **History:** build the forward daily-snapshot store **in v1** (live-only metrics accrue from go-live; multi-day historical demand/activity/capacity/referrals from real endpoints).
3. **ICB honesty:** **omit** any metric we cannot derive (no N/A, no approximation).
4. **Profiles:** ship **all three** (Management, Staff, ICB) in v1.
