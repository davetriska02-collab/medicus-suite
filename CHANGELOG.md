# Changelog

All notable changes to Medicus Suite are documented here.

## [v2.0.5] — 2026-05-28
### Added
- Settings → Suite tab now includes a "Support development" card with a Buy Me a Coffee link (`buymeacoffee.com/davetriska`). Short note explaining the suite is built in spare time and given away free, AI tokens cost money out of pocket, and 100% of donations go straight back into development. Card sits at the bottom of the Suite section so it's visible from the default landing tab but never gets in the way.

## [v2.0.4] — 2026-05-28
### Changed
- Thematic alignment: Sentinel/Monitoring options (`sentinel-options/`), Triage Lens options (`content-scripts/triage-lens/options.*`), and Patient Record Visualiser (`visualiser-core.*`) all now follow the global `suite.display` theme/size/colour-blind preference, matching the light-default main panel. Each page reads `suite.display` on load and listens for live storage changes so toggling in the main panel takes effect immediately without a reload.

## [v2.0.3] — 2026-05-28
### Fixed
- Settings page and pop-out window now follow the theme/size/colour-blind preference set in the main panel. Both were still hard-coded to dark. Settings page `:root` changed to light palette with `[data-theme="dark"]` override; pop-out boot now reads `suite.display` from storage before loading the first module. Both also react live if you toggle the preference while they are open.

## [v2.0.2] — 2026-05-28
### Fixed
- Levothyroxine monitoring chip now correctly labels the test as **TSH** rather than **TFT**. The recorded value Medicus surfaces is the TSH number alone (full TFTs aren't routinely run for stable replacement), so the previous "TFT · 3.2" was misleading. Match terms still cover TSH/TFT/thyroid function so existing observations continue to be detected. Notes updated to reflect TSH-only monitoring per NICE NG145.

## [v2.0.1] — 2026-05-28
### Added
- HRT monitoring chip now surfaces progestogen coverage context for oestrogen-triggered chips:
  - **Hysterectomy recorded** → green line "Hysterectomy — progestogen not required"
  - **IUS in situ** (Mirena, Levosert, etc.) → green line "IUS in situ — Mirena 52mg"
  - **Oral/patch progestogen** (Utrogestan, norethisterone, etc.) → green line "Progestogen: Utrogestan"
  - **None of the above** → amber warning "No progestogen or hysterectomy recorded" — flags potential unopposed oestrogen
  - Context only shows on oestrogen-triggered chips; IUS/progestogen-only chips (standalone prescriptions) are unaffected.

## [v2.0.0] — 2026-05-28
### Changed
- **Light mode is now the default theme.** Dark mode remains available as an option. The CSS variable baseline (`:root`) is now the light palette; dark mode is applied via `[data-theme="dark"]` override.
- Display settings (theme, text size, colour-blind mode) moved from the Monitoring module into the main suite nav bar — a sun ☀ icon appears in the top-right, visible on all tabs. This was previously only accessible while on the Monitoring tab.

### Added
- v1.11.0 features are carried forward unchanged (HRT IUS recognition, display prefs).

## [v1.11.0] — 2026-05-28
### Added
- Display preferences for the entire panel, accessible via the ⚙ button in the Monitoring header. Settings persist to `suite.display` storage and apply immediately:
  - **Light / Dark theme** — full light-mode palette with appropriate contrast ratios for clinical use in bright rooms.
  - **Text size S / M / L** — scales the whole panel via CSS zoom; S = 85%, M = 100% (default), L = 125%. Resolves legibility issues on high-DPI screens or for users who need larger text.
  - **Colour-blind mode** — replaces red (→ orange #ea580c) and green (→ blue #2563eb) globally across all chips, badges, and test rows. Designed for the most common deuteranopia/protanopia profiles.
- HRT monitoring rule now recognises Mirena coil / LNG-IUS (Mirena, Levosert, Jaydess, Kyleena, levonorgestrel intrauterine system). Patients with an IUS documented as a medication will now show the annual HRT review chip, correctly reflecting its role as the progestogen component of HRT in perimenopausal women using systemic oestrogen.

## [v1.10.0] — 2026-05-28
### Added
- Slot Counter now visually distinguishes AM from PM appointments. Under the day-total hero are two chips — `AM 14` and `PM 9` — and every "By type" and "By clinician" row shows the same breakdown inline (`8 am · 4 pm · 12`). Lets a clinician see at a glance whether the day still has morning capacity, afternoon capacity, or both, instead of just a single combined number. AM is `startDateTime` hour < 12; PM is 12:00 onward.

## [v1.9.0] — 2026-05-28
### Fixed
- Settings page version badges now read the live extension version instead of a hard-coded `v1.4.2` that had not been updated since the first release.
- Triage Lens custom settings are no longer wiped on suite restore when the backup file pre-dates the user's customisations. Previously, importing a suite backup containing `triage: {config: {}}` would overwrite `triagelens.config` with `{}`, deleting the user's rules. `triageImport` now skips writes for empty config objects.

### Changed
- Suite-scope import preview now lists every known module — present ones show their content, absent ones explicitly say `— not in this backup`. This clears up the confusion where Request Monitor and Triage Lens looked "missing" from a restored backup just because they pre-dated those modules being wired into suite-level export (the data was simply not in that backup file). Per-module scope previews are unchanged.
- Preview line for envelope's extension version now reads `Backup created with extension version: v1.6.0` rather than the bare `Extension version: v1.6.0`, to distinguish it from the currently-installed version.

## [v1.8.9] — 2026-05-28
### Added
- HbA1c chips now show the value with unit: e.g. `NOT MET · 62 mmol/mol · 12 Mar 2025`. Applies to DM020 (≤58, non-frail), DM021 (≤75, frail), and the retired DM007/DM008 rules. Previously the number appeared without unit, making it ambiguous to the clinician.
- Non-HDL / LDL cholesterol chip (CHOL004) now shows the value with unit: e.g. `MET · 2.4 mmol/L · 12 Mar 2025`.
- Engine: `observation-threshold` rules can now declare a `"unit"` field in their check definition; the engine appends it to `valueText` automatically. Custom rules created in the Options page can use this field too.

## [v1.8.8] — 2026-05-28
### Added
- Monitoring chips now show the recorded value, not just the date. For drug-monitoring tests (U&E, LFTs, etc.) the latest result appears between the status badge and the date: e.g. `IN DATE · 4.5 · 12 Mar 2025 · 89d`. For QOF `observation-recent` indicators (HRT review, BMI, smoking status, etc.) the value appears beside the date too — closing the gap where in-date chips showed _when_ but never _what_. Values are trimmed and capped at 30 characters to stay on one row.

## [v1.8.7] — 2026-05-28
### Fixed
- Monitoring (Sentinel) panel now auto-refreshes the instant the patient changes. Content script broadcasts `sentinel:snapshot-updated` after every re-evaluation; side panel re-renders on receipt instead of waiting up to 10 s for its poll.
- Removed the `document.visibilityState` guard on the sentinel refresh path — Chrome was marking the side panel hidden while the user clicked in the main tab, silently skipping auto-refreshes. The refresh is just IPC (no API call), so the guard wasn't saving anything.

## [v1.8.6] — 2026-05-27
### Fixed
- Request-monitor infinite loop: `chrome.storage.onChanged` listener no longer reacts to writes the poller itself makes (`state`, `notifMap`). Only true user-config changes trigger re-initialisation.
- Request-monitor double-poll on every re-init: removed the synchronous `pollRequestMonitor()` that fired alongside the alarm's immediate-trigger.
- Request-monitor concurrent-write race: `shared/request-monitor.js` now deduplicates in-flight Promises so the service-worker alarm path and the side-panel UI path share a single poll.
- Sign-in (401/403) no longer burns API calls indefinitely: poller pauses for 5 minutes on auth failure and clears when the user changes config.
- `engine/api-client.js` patient-data fetch: concurrent calls for the same patient now share a single in-flight Promise, eliminating redundant network requests on rapid SPA navigation.
- `content-scripts/sentinel.js` `fetchJournalObservations`: added 8-second `AbortController` timeout (other endpoints already had this via `safeFetch`).
- `shared/medicus-api.js` scheduling cache: keyed by practice code, so switching practices no longer serves stale data from the previous practice.
- `content-scripts/referrals-discovery.js`: diff before write — no longer writes storage on every page load when discovered data is unchanged.
- Submissions module: anonymous `chrome.storage.onChanged` listener was never removed in cleanup, accumulating one listener per tab switch. Now uses a named reference removed in `cleanup()`.
- Side-panel `switchModule` tab-switch race: previous module's in-flight fetch could overwrite the new module's DOM. Added a monotonic `switchSeq` guard and explicit cleanup before clearing `content`.
- Capacity module double-fetch on preset save: `savePreset` and `onStorageChange` both triggered `loadVisibleDates`; guarded with a `selfWriteInProgress` flag.
- SubRag strip `setInterval` return value was discarded; timer ID is now stored.
- Update-checker now sends `If-None-Match` ETag header and writes `checkedAt` on 403 (rate-limit) so the 23-hour cooldown engages correctly.
- Request-monitor notification map: clicked notifications are now removed from `suite.requestMonitor.notifMap`, preventing the map drifting toward its 50-entry cap with dead entries.
### Changed
- Sentinel module: poll interval slowed from 3 s to 10 s; skips polling when `document.hidden`.
- Side-panel demand strips (WR / RM / SubRag): skip polling when the panel is not visible (`document.visibilityState !== 'visible'`); refresh immediately on visibility return.
- Slots / activity / referrals / submissions refresh buttons: disabled during in-flight fetches to prevent rapid-click concurrent fetches racing on shared module state.

## [v1.8.5] — 2026-05-27
### Fixed
- Backup gaps: `referrals.*`, `popout.activeModule`, `suite.requestMonitor.*` now captured in full-suite export/restore.
- `submissions.config` no longer overwritten with a partial object when saving practice code.
- Pusher `waiting:refresh` no longer fires twice per appointment update.
- Referrals discovery messages now properly handled; live updates work.
- Sentinel module: module-level `document.addEventListener('click', …)` moved into `init()` and removed in `cleanup()` — eliminates listener accumulation on module reload.
### Removed
- `side-panel/modules/triage/` directory deleted (module decommissioned in v1.5.3; files were left behind).
- `shared/waiting-room-api.js` deleted (logic duplicated inline; no consumers).
- Legacy `config` storage key removed during triage migration.

## [v1.8.4] — 2026-05-26
### Changed
- Side-panel demand banner (`#rmStrip` — medical/admin request alerts): increased size by ~25% (padding, font-size, pill dimensions) for improved legibility.

## [v1.8.3] — 2026-05-26
### Fixed
- Activity tab: relabelled "Urgent Rx" to "Non-routine" in legend and column headers to match the field's actual meaning (non-routine prescription requests).

## [v1.8.2] — 2026-05-26
### Fixed
- Capacity Forecast: Options page preset editor now exposes per-weekday minimums (Mon–Sun) instead of the legacy single "Daily minimum" field, matching the side-panel editor. Editing a preset from Options previously collapsed all weekdays to one number, silently overwriting any per-day settings.
- Options page preset cards now summarise minimums the same way the side-panel does (`Min N/weekday` when uniform, otherwise `Min N/week`).
- Saving a preset from Options now stores `minimumByDay` and drops the legacy `minimumPerDay` field; existing presets are migrated on edit by spreading their old `minimumPerDay` across Mon–Fri.

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
