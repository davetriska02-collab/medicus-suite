# Changelog

All notable changes to Medicus Suite are documented here.

## [v1.8.1] — 2026-05-22
### Changed
- Monitoring tab moved to second position in nav (immediately after Slots) in both side panel and pop-out

## [v1.8.0] — 2026-05-22
### Added — Visualiser Tier 2 & Tier 3 (filters, swim-lane, eFI, drugs, PINCER, QOF review)
Substantial follow-up to v1.7.0. Continuity view scroll/filter problem fixed by giving every tab a single shared filter model; Timeline replaced with a true D3 swim-lane; engine-layer features added for frailty, polypharmacy, prescribing safety and review compliance.

#### Global filter bar (every tab)
- **Date-range brush** above the tab content — D3 brush over the full record's date extent, plus `All / 5y / 3y / 1y` preset buttons. The brush *is* the filter — all tabs re-render against the selected window. Solves the "ribbon is rainbow noise with 1029 consults squashed in 900px" problem from v1.7.0.
- **Clinician filter** — single-select dropdown listing every practitioner with their entry count. Hard-filters the entry stream; bars, ribbon, swim-lane all collapse to just that clinician.
- **Problem spotlight** — single-select dropdown listing every active and past problem. Does NOT hard-filter; instead highlights matching entries in the swim-lane (others dimmed), and the "what's new" / Active Problems list.
- Active problems on the Snapshot tab are now clickable — click to spotlight that problem across all views (toggles).
- Clinician bars on the Continuity tab are clickable; click any practitioner row, bar, or ribbon-legend swatch to set the clinician filter. Click again to clear.
- Register cards on the Registers tab are clickable — click a register to spotlight that condition across the swim-lane, snapshot etc.
- `Clear` button resets everything; `Showing N of M entries` summary stays live.

#### Timeline tab — D3 swim-lane
- Replaced stacked-bar + monthly heatmap with a horizontal swim-lane: one lane per bucket (consultation, communication, investigation, document, note, recall, referral), one dot per event, scaled to the filtered date range.
- Hover any dot for a tooltip showing date / type / practitioner / code / linked problems. Click a dot to spotlight its first linked problem across all tabs.
- Problem spotlight: matching events get a 2px orange stroke; others fade to 0.18 opacity, so the story of "everything that happened for diabetes" is immediately legible.
- Lanes with zero events in the current selection are auto-hidden. Volume-by-year bar chart preserved underneath for quick "which years were busy".

#### Investigations tab — sortable, filterable Latest values
- Text filter ("Filter analyte name…") — debounced live filter without re-rendering the whole tab; preserves input focus.
- "Only abnormal" toggle — filter to high/low rows only.
- Click any column header to sort by analyte / value / flag / Δ / date; click again to flip direction. Sort glyphs show current state.
- Click any row to open that analyte in the trend chart above (auto-scrolls to it).

#### Medications & Monitoring (new tab)
- 14-drug high-risk panel (methotrexate, azathioprine, lithium, amiodarone, warfarin, DOACs, ACEi/ARB, loop / thiazide diuretics, long-term NSAIDs, statins, digoxin, levothyroxine, metformin, strong opioids).
- Per drug: last-seen date, occurrences in record, last monitoring test date, days since monitoring, overdue badge based on NICE / BNF recommended intervals (e.g. methotrexate FBC/U&E/LFT every 3 months).
- Stats row: total drug families seen / active in last 18m / monitoring overdue / PINCER flags.
- Detection: regex scan of each entry's body + code text — caveat banner explains this is a screen, not a definitive medication review.

#### Snapshot — eFI gauge + PINCER red flags
- **Electronic Frailty Index (eFI)**: 36-deficit Clegg index computed from the problem list, with polypharmacy taken from the drug detector. Semicircle gauge coloured by category (Fit / Mild / Moderate / Severe). Shows count, score (0.00–1.00) and first 4 ticked deficits.
- **PINCER-style flags card**: applies drug-disease and monitoring-overdue rules (NSAID + CKD, NSAID + heart failure, NSAID + oral anticoag, beta-blocker + asthma, ACEi/ARB + CKD with overdue U&E, every overdue high-risk drug monitor). Shown with red border when flags present; green border + "no flags detected" otherwise. Full list also on the Medications tab.

#### Registers & Recalls — last-review enrichment
- Every QOF register card now shows "Last review: 17 Mar 2026 · 6m ago" with green / amber / red badge based on the recommended review interval (12m for most, 6m for cancer, 3m for palliative care).
- Cards sort overdue-first; overdue registers get an orange left border.
- Click a register card to spotlight its condition across the rest of the visualiser.

#### Internals
- `_s.filter` shared state — `dateFrom`, `dateTo`, `preset`, `clinician`, `problem`. Hard filter for date+clinician; spotlight for problem.
- `filteredEntries()` helper; `rebuildAll()` recomputes analytics under filter and re-renders every tab. Called from buildApp on load and from every filter change.
- `computeEFI`, `computeDrugMonitoring`, `computePINCER`, `enrichRegistersWithReview` engine functions.
- Tab switch + window resize re-render the swim-lane so it picks up the correct width when the tab becomes visible.

## [v1.7.0] — 2026-05-22
### Added — Visualiser Tier 1 clinical-UX upgrades
Five evidence-led upgrades drawn from a multi-agent research pass (Plaisant Lifelines2, Epic Results Review, KDIGO 2024, NICE NG28/NG136, RCV literature PMC10197470, JAMIA four-techniques study). Each chosen for high clinical value at low build cost.

- **"What's new since last consultation" card** on the Snapshot tab. Identifies the most recent face-to-face consultation, lists every event dated after it, groups by bucket, and flags any investigation with abnormal results. The first thing a GP wants to see before consulting.
- **Practitioner ribbon** on the Continuity tab. Thin band of cells (one per consultation, left = older → right = newer) coloured by practitioner; a second strip below shows days since previous contact (height-encoded, capped 90d). Long gaps surface as wide bars; fragmented care shows as a rainbow run; continuity shows as a monochrome run.
- **Reference Change Value (RCV) delta flags** on the Latest values table. New "Δ vs prior" column; arrow doubles and turns red when the inter-result change exceeds the analyte's literature RCV (creatinine 14%, eGFR 14%, HbA1c 12%, Hb 8%, Na 1.3%, K 5%, TSH 45%, etc.).
- **Inline sparklines** on the Latest values table. 70×20 SVG polyline per analyte, with the reference band shaded in green and the last-point dot coloured red when out of range. Trend direction now scannable without expanding a chart.
- **Clinical zone bands on the analyte trend chart**. Replaces the flat reference lines with KDIGO-staged eGFR zones (G1→G5), NICE/QOF HbA1c thresholds (normal / pre-diabetes / target / suboptimal / poor control), and NICE BP staging. Falls back to a translucent reference-range band for other analytes. Y-axis padded to include the reference range so abnormals visually escape it (lab-UX anti-pattern fix). Out-of-range data points rendered in red.

## [v1.6.4] — 2026-05-22
### Fixed
- **pdf.worker.min.js was corrupted**: in v1.6.3 the worker source was extracted with `awk` from a JS template literal (`` var _workerSrc = `...` ``), so the file ended up containing literal `` \` ``, `\${`, and `\\` escape sequences instead of the real `` ` ``, `${`, `\` characters. Browser threw `Uncaught SyntaxError: Invalid or unexpected token`, pdf.js fell back to fake-worker mode, `WorkerMessageHandler` never materialised, and text extraction died with "Cannot read properties of undefined". Re-extracted the worker by evaluating the template literal in Node so all escape sequences collapse correctly. All four vendor files now parse cleanly under `new Function(...)`.
- Use `chrome.runtime.getURL('vendor/pdf.worker.min.js')` for `GlobalWorkerOptions.workerSrc` so pdf.js loads a real Worker (fast) instead of the "fake worker" fallback. Falls back to a relative URL if `chrome.runtime` isn't present.

## [v1.6.3] — 2026-05-22
### Fixed
- **Visualiser actually runs now**: extracted all inline `<script>` blocks (pdf.js, Chart.js, D3.js, worker setup, app code) to external files under `vendor/` and `visualiser-core.js`. Under MV3 the default extension-page CSP is `script-src 'self'` — inline scripts were silently blocked, so no JS ran at all and the file picker had no `change` handler attached. The pdf.js worker is now shipped as `vendor/pdf.worker.min.js` and loaded by relative URL, so no `blob:` URLs and no `eval`.
- Cleaned up the embedded-as-string worker bootstrap (the old `Blob` + `URL.createObjectURL` dance) — no longer needed.

## [v1.6.2] — 2026-05-22
### Fixed
- **Visualiser file selection now works**: removed the obsolete `visualiser.html` iframe wrapper. The wrapper was a leftover from when `visualiser-core.html` lived under `manifest.sandbox.pages` (v1.5.4 fixed that); its `sandbox="..."` attribute on the iframe was still in force and was silently blocking the file input's `change` event from doing anything useful. Callers in `popup.js` and `side-panel/panel.js` now open `visualiser-core.html` directly; the wrapper file has been deleted.
- Added stage-by-stage `console.log('[Visualiser] ...')` diagnostics through the PDF load pipeline so future silent failures can be diagnosed without source diving.

## [v1.6.1] — 2026-05-22
### Fixed
- **Visualiser "Choose PDF file" button**: replaced `<button>` + programmatic `fi.click()` with a native `<label for="file-input">` element — the programmatic click was silently blocked inside the sandboxed iframe; the label→input binding uses the browser's native activation and is not subject to the same restriction

## [v1.6.0] — 2026-05-22
### Added
- **Patient Record Visualiser — complete rewrite**: new pop-health dashboard built around real Medicus EPR export PDF structure; 6 tabs — Snapshot (demographics, active/past problems, open recalls), Continuity (UPC index, Bice-Boxerman index, clinician bar chart + detail table), Timeline (year stacked bar + 5-year monthly heatmap), Investigations (analyte trend selector with Chart.js line + reference bands, latest values table), Registers & Recalls (QOF register auto-detection from problem list, open/cancelled/completed recalls with overdue badges), Letters (specialty bar chart + searchable document list); replaces the previous 3,600-line kitchen-sink implementation
- **Suite backup refresh**: `doFullExport`/`applyEnvelope` in `options.js` now delegates entirely to per-module IO files — eliminates drift between backup and storage. Previously missing keys now captured: `slots.alertRules`, `submissions.thresholds`, `suite.triageAlert.rules`, `popout.windowState`
- `submissions-io.js`: now exports/imports `submissions.thresholds`
- `suite-envelope.js`: added `triageAlerts` and `popout` scopes; richer preview lines for slots, submissions, triage alerts, popout; version bumped to 1.6.0; added inline convention comment
- `options/options.html`: all per-module IO scripts now loaded
- `CLAUDE.md`: new developer guide documenting module structure, storage-key backup convention, alert strip pattern, version bumping, git workflow

## [v1.5.4] — 2026-05-22
### Fixed
- Patient Record Viewer: removed `visualiser-core.html` from `manifest.json` `sandbox.pages` — the manifest sandbox gave the page an opaque (null) origin, causing `URL.createObjectURL` to produce `blob:null/…` URLs that Chrome refuses to load as Web Worker scripts; removing the sandbox restores extension origin so the pdf.js worker initialises correctly

## [v1.5.3] — 2026-05-21
### Changed
- Nav: removed redundant "Alerts" tab (`data-module="triage"`) from side panel and pop-out — triage capacity alerts remain active via the rm-strip; triage lens overlay unaffected
### Fixed
- Patient Record Viewer: PDFs with text items missing `transform` (type 3 fonts, some Medicus print layouts) no longer throw an uncaught TypeError in `reconstructLines` — items without a transform matrix are now skipped
- Patient Record Viewer: null guard added on the investigations yearly chart canvas element in `buildInvestigationsView`
- Patient Record Viewer: error dialog now reports which processing stage failed (loading PDF / extracting text / parsing entries / building views) for easier diagnosis

## [v1.5.2] — 2026-05-21
### Added
- Submissions: configurable RAG thresholds for medical and admin request tiles — amber/red tint + coloured dot on tile when today's total reaches threshold; Options → Submissions → Workload thresholds
- Global demand strip (visible on every panel tab, polls every 60s) — shows amber/red pill for medical/admin when threshold crossed; "Submissions →" button navigates to the module

## [v1.5.1] — 2026-05-21
### Added
- Referrals: "Rate" chart tab — referrals as a proportion of consultations per clinician (referrals ÷ consultations, shown as %) sorted by rate descending; cyan bar colour, tooltip shows raw ref/consult counts; clinician search applies; show-all toggle works
- Referrals: parallel-fetches `window.ActivityApi.fetchActivityReport` alongside referral data; activity fetch failure is isolated (amber notice in Rate tab only, other tabs unaffected)

## [v1.5.0] — 2026-05-21
### Added
- Slots: alert ribbon — configurable per-type thresholds; amber/red ribbon when count ≤ threshold; Options → Slot Counter to manage rules
- Slots: alert rules included in backup/restore export
- Pop-out window — ⊞ button in panel nav opens a free-floating popup window; position/size persisted; `chrome.windows` permission added
- Triage alerts — `engine/triage-alert-engine.js` evaluates request monitor bucket counts against user-defined thresholds; rm-strip highlights amber/red; desktop notification on threshold crossing (once per session per bucket); Options → Suite → Triage capacity alerts
- `shared/io/triage-alert-io.js`, `shared/popout-manager.js`, `shared/io/popout-io.js`

## [v1.4.16] — 2026-05-20
### Added
- Referrals: "Show all N clinicians/specialties/hospitals" toggle below each chart (expands past top-15 cap)
- Referrals: real-time clinician name search filter above the By Clinician chart
- Referrals: CSV export button — downloads all raw referrals with date, patient, clinician, specialty, hospital, priority, status, e-referral/manual flags
- Referrals: Priority (Routine/Urgent/2WW) and Status (Completed/Incomplete/Cancelled) chip filters — re-aggregates instantly, no re-fetch
- Referrals: live "Updated Xm ago" staleness label; turns amber with inline Refresh link after 30 min

## [v1.4.15] — 2026-05-20
### Fixed
- Nav bar: add left scroll arrow (‹) with `has-overflow-left` class and nudge-left animation
- Nav bar: both arrows now have border + `--text-2` colour for improved visibility
- Nav bar: left fade gradient via `::before` pseudoelement
- `normalisePriority`: use `startsWith('twoweek')` to correctly handle `'Two Week Wait (2WW)'` response values

## [v1.4.14] — 2026-05-20
### Fixed
- Referrals: 2WW priority count showing as 0 — API returns `'Two Week Wait (2WW)'` (spaced/parenthetical); added `normalisePriority()` to strip non-alpha chars and map all variants to canonical key

## [v1.4.13] — 2026-05-20
### Fixed
- Referrals: HTTP 400 — `buildUrlFromTemplate` was appending `referralStartDate`/`referralEndDate` on top of existing `startDate`/`endDate` params; now detects which date-param convention the URL uses and sets only those
- Referrals: full pagination loop (PAGE_SIZE=2000, MAX_PAGES=10) — was only fetching first 100 rows

## [v1.4.12] — 2026-05-20
### Changed
- Referrals: switch to URL template replay — captures exact discovery URL verbatim, only rewrites date/pagination params
- Referrals: add diagnostic panel (collapsed) showing discovery URL, config URL, priority/status values, last attempted URL

## [v1.4.11] — 2026-05-20
### Fixed
- Referrals: HTTP 400 — use actual priority/status values from stored config (`priorityOptions[*].value`) instead of hardcoded strings; removed spurious `limit=2000` param

## [v1.4.10] — 2026-05-20
### Fixed
- Referrals: HTTP 404 — read base URL from `referrals.discovery` / `referrals.config` storage (captured by discovery content script) instead of constructing from practice code; show discovery prompt when no URL available

## [v1.4.9] — 2026-05-20
### Added
- Referrals Tracker v1.0 — full visualisation module: summary card (total, priority tiles), status breakdown, stacked bar charts by clinician/specialty/hospital, date range controls with presets, progress indicator during paginated fetch

## [v1.4.6] — 2026-05-20
### Fixed
- Various code review bug fixes

## [v1.4.5] — 2026-05-20
### Fixed
- Visualiser CSP issue resolved via sandbox page

## [v1.4.3] — 2026-05-20
### Added
- Visualiser as labelled nav tab
- Check for Updates button in About panel

## [v1.4.2] — 2026-05-19
### Added
- Activity module with date range controls and stacked bar charts by task type
- `qofYearStart` UTC fix in rules engine
- `shared/activity-api.js`
