# Changelog

All notable changes to Medicus Suite are documented here.

## [v3.4.1] — 2026-05-29
### Changed — Configurable feedback recipient
- The feedback button's recipient email is now configurable in **Options › Suite** (`suite.feedbackEmail`), saved alongside the practice code. The About-tab button reads it at send time and falls back to the default (`davetriska02@gmail.com`) when unset. (`options/options.html`, `options/options.js`, `side-panel/panel.js`)
- The setting is included in suite backup/restore (export, import, and preview). (`options/options.js`, `shared/io/suite-envelope.js`)

## [v3.4.0] — 2026-05-29
### Added — Feedback / feature request / bug report
- New **Feedback** section in the side-panel About tab. A type selector (Feedback / Feature request / Bug report), subject, and details compose a pre-filled email to the developer via `mailto:` — no GitHub account, login, or backend required. Suite version, browser, and timestamp are appended automatically as diagnostics. (`side-panel/panel.js`, `side-panel/panel.css`)
- The form carries an explicit warning not to include patient-identifiable information, and opens the email client via a transient anchor click so the panel is never navigated away.

## [v3.3.1] — 2026-05-29
### Removed — Triage Lens read-time chips
- Removed the "2m read" / "5m read" / "10m+ read" queue chips and the detail-page read-time chip. A word-count-bucketed reading estimate added no triage value and cluttered the queue. Dropped the chips, the `estimateReadTime` helper, and its callers. (`content-scripts/triage-lens/content.js`, `defaults.json`, `options.js`)

### Changed — Triage Lens defaults de-duplicated
- The system-chip defaults were maintained as a hand-written `SYS_CHIP_DEFAULTS` object that had to be kept in sync with `EMBEDDED_DEFAULTS` (and with `defaults.json`) by hand — the source of past green/amber drift. `SYS_CHIP_DEFAULTS` is now derived from the parsed `EMBEDDED_DEFAULTS`, so there is a single source of truth inside `content.js`.
- Added `test-triage-defaults.js`, which parses both `defaults.json` and the embedded copy and asserts they are identical, so the remaining file↔string duplication can't silently drift again.

## [v3.3.0] — 2026-05-29
### Added — Clinical Safety settings tab
- New **Clinical Safety** tab in suite settings. Sets out, in plain terms, that the software is built and released by a single GP developer on a best-effort basis, with a maintained clinical safety case but no warranty — a supplementary aid, not a medical device, and not a substitute for clinical judgement or the live record.
- Direct links to the full clinical safety case documents (Intended Purpose, Clinical Safety Notice, Hazard Log, Full Disclaimer & Terms). Links point to the public repository, which is regenerated weekly from the current codebase, so they always reflect the latest release and render as formatted markdown. (`options/options.html`)
- Drive-by fix: `button.ghost:hover` and the new doc-link hover referenced an undefined `--bg-hover` variable on the options page; switched to the defined `--bg-mid`.

## [v3.2.5] — 2026-05-29
### Fixed — time-based wording on non-time-based custom alerts
- Drug-combo, event-count, and composite alerts fire on presence / count / threshold, not on a recall interval, but `severityToStatus` mapped their severity onto the recall vocabulary — so a QTc-prolonging drug combination or a ">3 UTIs" count showed **"DUE SOON"** (amber) or **"OVERDUE"** (red), which is meaningless for a non-time-based flag.
- Introduced dedicated statuses for these alert types: `red → ALERT`, `amber → CAUTION`, `info → NOTED`. They keep the same red / amber / neutral colour and the same sort/filter ranking as their time-based peers, so nothing else changes — only the wording now reads correctly. (`engine/rules-engine.js`, `shared/chip-renderer.js`, `side-panel/modules/sentinel/sentinel.js`, `content-scripts/sentinel.js`)
- Added regression tests for the severity→status mapping and the new labels/colours/ranks. (`test-custom-rules.js`)

## [v3.2.4] — 2026-05-29
### Fixed — "Test connection" and "Check for updates" button styling
- Both buttons used a `.ghost` class that had no base CSS definition in `options/options.html`, causing the browser to render them as unstyled system buttons that clashed with the rest of the UI. Added a proper `button.ghost` rule matching the same font, weight, letter-spacing, border-radius, and padding family as `button.primary`. (`options/options.html`)

## [v3.2.3] — 2026-05-29
### Fixed / improved — alert library UX
- Added **"+ Add all"** button at the top of the alert library body. Shows a count of unadded entries; hides itself once everything has been added. (`sentinel-options/options.html`, `sentinel-options/options.js`)
- Fixed annoying auto-scroll when adding an individual library entry. The view now stays on the library list so the next entry can be clicked immediately — the newly added card still flashes in the rules section below, but the page no longer jumps to it. (`sentinel-options/options.js`)

## [v3.2.2] — 2026-05-29
### Changed — clearer wording for the "stale" recall status
- Clinicians found the "STALE" chip label confusing. Renamed the user-facing label for this status (data older than 2× the recall interval — a tier worse than overdue) to **"SEVERELY OVERDUE"** across the sentinel chips, in-page summary counts, evidence phrasing, and the rule-preview status dropdown.
- The internal status key (`stale`) is unchanged, so saved rules, filters, and backups are unaffected. (`shared/chip-renderer.js`, `side-panel/modules/sentinel/sentinel.js`, `content-scripts/sentinel.js`, `engine/rules-engine.js`, `sentinel-options/options.html`)

## [v3.2.1] — 2026-05-29
### Fixed — illegible sentinel evidence panels
- The sentinel chip evidence panel referenced CSS variables (`--surface-1/2/3`) that are not defined by the suite theme, so its background always fell back to a hard-coded dark colour. Under the default light theme this rendered dark `--text-*` colours on a dark background, making the evidence text unreadable when a chip was clicked.
- Remapped the panel, sparkline, and hover backgrounds to the real theme tokens (`--bg-elev`, `--bg-deep`, `--bg-hover`) so the panel is theme-aware and legible in both light and dark themes. (`side-panel/modules/sentinel/sentinel.css`)

## [v3.2.0] — 2026-05-28
### Added — chip provenance (click-to-see-evidence)
Side-panel sentinel chips are now clickable and surface the exact data the rules
engine matched to fire each alert. Clinicians can validate an alert before
acting on it — "this fired because <X happened on <date>>".

**Engine — `evidence` field on every chip:**
- Each evaluator now attaches `chip.evidence = { summary, facts[], refs?, series? }` built from the variables already in scope (no new data fetches). Shape is flat so one renderer handles all rule types.
- Drug-monitoring evidence: matched medication + start date; per-test name, last result + date + days-ago, interval threshold, status; "we looked for: …" rows for tests with no data; HRT context note when present.
- Drug-combo evidence: per-set matched drugs; patient age/sex; required problems matched (with coded date); excluded problems and `mustNotBePresent` list confirming none matched.
- QOF-indicator evidence: matched observation + value + date + days-ago, or "not found" with the search-terms list; threshold + operator + unit; QOF year / rolling window context; register precondition (which problem made the patient eligible); medication-present details.
- QOF-register evidence: register name + matched problem label + coded date.
- Event-count evidence: count vs threshold; window cutoff date; match/exclude terms; up to 15 matched items with date and raw value.
- Composite evidence: operator, "N of M sub-rules fired", per-sub-rule label + fired/not-fired status. Sub-rule refs are **clickable** in the panel — clicking drills into that sub-chip's own evidence (scroll + open).
- Observation-trend evidence: full point series (date + value, oldest → newest), delta, direction, span months, threshold.

**Renderer — `ChipRenderer.renderEvidencePanel(evidence)`:**
- New flat-list renderer in `shared/chip-renderer.js` used by all chip types.
- Inline SVG sparkline for observation-trend evidence — coloured by trigger direction (rising = red if rule is "rising"; falling = blue; steady = grey), tooltips on each point with date + value.
- Every clickable chip now carries `data-rule-id` + `data-evidence-key` + a small ⓘ affordance + `role="button"` / `aria-expanded`. Chips without evidence render exactly as before (backwards-compat).

**Side-panel sentinel module:**
- Inline panel appears directly under the clicked chip — no modal, no floating popover. Click to toggle, Esc to close, Enter / Space to activate from keyboard.
- Open state survives the 10-second poll re-render: the panel restores itself after each refresh as long as the chip is still in the snapshot.
- Composite sub-rule drill-through: click a fired sub-rule ref → previous panel closes, target chip opens, scrolls into view.
- One delegated click handler at the container level (idempotent across re-renders).
- Cleanup on module unmount removes document-level Esc handler and resets state.

**Scope of v1:**
- Side-panel + pop-out only. In-page sentinel HUD and full-tab visualiser unchanged (chip data carries `evidence` and they can adopt the renderer later without engine changes).
- No-data chips still render evidence ("we looked for X, found nothing").
- Inapplicable-chip leaks were closed in v3.1.8 first so the evidence panel lands on a clean baseline.

## [v3.1.8] — 2026-05-28
### Fixed — applicability filter audit (engine + bundled rules)
Pre-evidence-feature audit by adversarial agent. Closes silent filter holes
where rules could fire for clinically inappropriate patients.

**Engine — filter enforcement gaps closed:**
- `evaluateDrugRule` now applies `rule.sex`, `rule.ageRange`, `rule.requiresProblem`, `rule.excludesProblem`. Previously these schema fields were silently ignored — any user-added drug-monitoring rule with sex/age/problem filters fired universally.
- `evaluateQofIndicatorRule` now applies `rule.sex` (previously only `ageRange` was checked).
- `evaluateQofRegisterRule` now applies `rule.sex` and `rule.ageRange` (registers like cervical-screening-eligible / AAA-screen-eligible inherit applicability from the patient).

**Engine — `passesProblemFilters` helper with negation awareness:**
- New shared helper extracted from `evaluateDrugComboRule` and used by all evaluators. Substring matches on problem labels now reject negation/history prefixes: a problem labelled `"no heart failure"`, `"family history of heart failure"`, `"history of heart failure"`, `"resolved heart failure"`, `"at risk of HF"`, `"?heart failure"` no longer satisfies `requiresProblem: ["heart failure"]`.

**Engine — drug-combo distinct-meds guard:**
- When `drugSets` overlap (e.g. QTc-prolonging drug A and B share the same list), a single matched medication previously satisfied every set. Engine now requires the matched meds across sets to resolve to distinct medications (greedy assignment). Fixes `prescribing-qtc-combination` firing on monotherapy.

**Bundled alert library — applicability tightening:**
- `trend-1` Rising PSA trend: added `sex: "M"` and `ageRange: { min: 40 }`. Previously could fire on any patient with a PSA value recorded.
- `event-count-1` Recurrent UTI: added `"symptoms"`, `"luts"`, `"outflow"` to exclude so LUTS codes are not counted as UTI episodes.
- `pincer-9` Metformin renal: added combo brand names (`glucophage`, `janumet`, `komboglyze`, `eucreas`, `xigduo`, `synjardy`, `vipdomet`, `jentadueto`) — patients on combo products now get the annual eGFR monitoring alert.
- `pincer-12` Lithium + NSAID: added `["shampoo","topical","gel","cream"]` to Lithium drugSet exclude (guards against the rare lithium succinate shampoo formulation).
- `mhra-isotretinoin-ppg`: removed dead `"tretinoin oral"` match token (never appeared in formulary strings — `"isotretinoin"` / `"roaccutane"` cover oral retinoid prescribing).

## [v3.1.7] — 2026-05-28
### Fixed — final brand-name scrub + custom-rule card display
- `rules/alert-library.json`: renamed five `libId` values that still embedded vendor brand names (`ardens-1..4`, `pcit-1`) to neutral guideline-source slugs (`mhra-valproate-ppg`, `nice-lithium-monitoring`, `mhra-sglt2-dka`, `mhra-isotretinoin-ppg`, `prescribing-qtc-combination`). New adds from the library now generate clean rule IDs.
- `sentinel-options/options.js` `renderCrList` (drug-monitoring) and `ciRenderList` (qof-indicator): card titles now prefer `rule.label` / `rule.indicatorName` over `rule.id`. Already-stored rules with legacy brand-name IDs in user storage now show their human-readable label (e.g. "Lithium — monitoring overdue") instead of `custom-ardens-2-…`.

## [v3.1.6] — 2026-05-28
### Added — feature-list hotlink in About tab + weekly auto-generator
- New card at the top of the side-panel **About** tab linking to the latest `docs/feature-list.docx` on GitHub (raw download) and the Markdown source.
- `.claude/scheduled-tasks/weekly-feature-list.md` — prompt for a scheduled Claude Code on the web trigger that regenerates `docs/feature-list.md` and `docs/feature-list.docx` once a week. No-op commit when the feature surface hasn't changed (avoids weekly noise commits).
- Placeholder `docs/feature-list.md` shipped so the About link works immediately before the first scheduled run lands.

## [v3.1.5] — 2026-05-28
### Added — Alert Library alpha-feature acknowledgement gate
- Library cards are dimmed and `+ ADD` buttons inert until the user clicks "I understand — enable the library" on a warning banner.
- The banner explains that the bundled alerts are starter templates from published guidelines (PINCER / NICE / MHRA), have not been clinically validated, may match incorrectly, and that the user is responsible for reviewing each rule before clinical use.
- Acknowledgement is stored in `chrome.storage.local` under `sentinel.alertLibrary.acknowledged` — one-time, persists across sessions and re-renders.
- `storage.onChanged` listener picks up the flag from any window (so acknowledging in the side panel popout or one tab unlocks every open instance).
- Defensive: `addLibraryEntry` short-circuits and shows a toast if called before acknowledgement (e.g. via DevTools); the click is already blocked by `pointer-events:none` on the locked cards.

## [v3.1.4] — 2026-05-28
### Fixed — 6-agent code review of v3.1.2 (real bugs only)

**Alert library "+ ADD" silent failure (Nick's report):**
- `sentinel-options/options.js` `isAlreadyAdded`: now checks `entry.rule.label` and `entry.rule.indicatorName` in addition to `entry.title`. For composite-1 those strings differ, so the button never greyed out and the user got no visible confirmation that the rule had been added.
- Composite library entries with placeholder `ruleIds` (`custom-replace-with-…`) now show a follow-up toast warning that the composite must be edited to select the actual rules to combine.

**Drug-combo evaluator crash + false-positive:**
- `engine/rules-engine.js`: `set.match.some(...)` threw `TypeError` if any drugSet had no `match` array. Added `Array.isArray` guard.
- Empty/missing `drugSets` caused `[].some()` to return false, so the rule fired for every patient. Added early-return guard.

**Triage Lens (`content-scripts/triage-lens/content.js`):**
- `requestPanel`: read `rs.categories.length` but `computeRequestSignals` never returns `categories`. TypeError crashed HUD rendering on every detail page.
- `buildFieldsData`: `safe(data.meds.*, 'name')` looked for a `.name` property on raw strings — meds field was always empty, so methotrexate/lithium/anticoag rules never fired from the meds field.
- `refreshQueueChips`: disconnected the queue MutationObserver then re-attached only if it already existed, leaving it dead after any config change. Now delegates to `setupQueueObserver()` which handles both the initial-create and re-bind paths.
- Care-plan ACP check hardcoded `frailtyHits.length >= 3`; now uses configurable `TH('frailtyHitsRed')` for consistency with the amber arm.

**Referrals discovery (`content-scripts/referrals-discovery.js`):**
- `isDataResponse`: accepted empty arrays (`length >= 0`); first config-variant empty response was cached as the data endpoint, so the real one was never captured. Now requires at least one element.
- `captureUrl`: bare `fetch` with no abort signal; a slow server held the function indefinitely and racing scans could fire duplicate fetches for the same URL. Added 8s `AbortController` timeout and in-flight URL set.

**Sentinel content script (`content-scripts/sentinel.js`):**
- `setupNavWatcher`: patched `history.pushState`/`replaceState` without idempotency guard. On cached-page re-injection the wrapped function was wrapped again, firing `locationchange` twice per nav. Added `window.__sentinelNavWatcherInstalled` flag.
- `bootDataOnly`: `MutationObserver` on `document.body` was never stored, so re-injection stacked observers indefinitely. Now stored on window and gated.

**Capacity module (`side-panel/modules/capacity/capacity.js`):**
- `selfWriteInProgress` flag was set true before `await chrome.storage.local.set()`; a storage rejection left it stuck true forever, silencing all cross-window preset sync. Wrapped in `try/finally`.

**Submissions chart (`side-panel/modules/submissions/submissions.js`):**
- `parseTime` regex assumed `"HH:MM"` at end of string; ISO 8601 timestamps (Z-suffixed) bucketed every task to midnight or returned null entirely. Now handles ISO 8601 first.
- `parseDate` regex assumed `"DD Mon YYYY"` format; ISO dates returned null and every bucket stayed at zero. Now parses ISO `YYYY-MM-DD` prefix first.

**Side-panel XSS hardening (`side-panel/panel.js`):**
- `releaseUrl` from the GitHub releases API was interpolated unescaped into `innerHTML`; a spoofed `html_url` could deliver `javascript:` or markup. Now validates against `^https://github.com/` and escapes before injection. Added `rel="noopener noreferrer"`.
- Module-load error path: `err.message` was injected raw — escaped with existing `escStrip()` helper.

**Referrals stale-timestamp button (`side-panel/modules/referrals/referrals.js`):**
- The "Refresh?" button injected via `innerHTML` on staleness transition was never wired to a click handler. Clicking did nothing. Added `addEventListener` after the innerHTML write.

**Triage backup (`shared/io/triage-io.js`):**
- `chrome.storage.local.remove('config')` ran unconditionally on every import; the bare `'config'` key is a generic name that any future module might own. Gated on the key actually existing first.

**Chip renderer XSS (`shared/chip-renderer.js`):**
- `chip.points` was interpolated raw into the badge span. Custom rules validate it as a number, but `orgRules` skip validation. Now escaped.

**Service worker (`service-worker.js`):**
- Alarm handler called `pollRequestMonitor()` without `await` or `.catch()`; unhandled rejections silently dropped. Now logs failures.
- `chrome.notifications.create()` called without callback; notification-permission and runtime errors silently dropped. Added `chrome.runtime.lastError` check.

**Options page capacity preset (`options/options.js`):**
- `parseInt(value, 10) || 75` substituted the default if the user typed `0`. Replaced with `Number.isFinite` check so 0 is preserved (and rejected as invalid further down).

**Sentinel options composite-reference safety (`sentinel-options/options.js`):**
- Deleting any non-composite rule (drug-monitoring, qof-indicator, drug-combo, event-count) didn't check whether composites referenced it. Composites silently stopped firing and showed the raw deleted-rule id in the card meta. New `confirmDeleteWithRefs()` helper warns the user and lists every composite that would break before deletion proceeds.

**Custom-rules import (`sentinel-options/options.js`):**
- `crImportFile` appended every incoming rule without running `validateCustomRule()`; malformed input corrupted storage and the next backup/restore cycle threw. Now validates each rule individually, reports rejected entries to the user, and only persists valid ones.

**Event-count edge cases (`engine/rules-engine.js`):**
- `(rule.windowMonths || 12)` accepted 0 → window collapsed and rule silently never fired. Now requires positive finite value.
- Unknown `operator` value (typo like `==`) silently left `fires=false`. Now logs a warning so misconfigured rules are visible in DevTools.

**Source attribution (rules/alert-library.json + sentinel-options):**
- All `source` fields and library subtitle now reference upstream guidelines (PINCER, NICE, MHRA, crediblemeds.org) directly. Ardens and Primary Care IT references removed across alert library, options.js `sourceBadgeClass`, and options.html CSS.

## [v3.1.2] — 2026-05-28
### Maintenance — remaining nits from the 4-agent code review
- `engine/normalisers.js`: extracted `keyToIsoDate(key)` helper to eliminate duplicated `dataYYYYMMDD` slice offsets between `normaliseObservations` and `normaliseObservationHistory`. One place owns the format assumption now.
- `engine/normalisers.js`: documented that `observationHistory[].history[].value` is numeric (parseObservationValue output), unlike `observations[].value` which is a display string with unit. Future maintainers won't trip on the type difference.
- `engine/normalisers.js`: replaced `localeCompare` date sort with plain string comparison — ISO YYYY-MM-DD sorts lexicographically identical to chronologically, without any risk of locale-collation surprises.
- `engine/rules-engine.js`: documented the 30.4375-days-per-month window arithmetic in `evaluateEventCountRule` — explains why event-count windows are approximate (not calendar-aligned) and consistent with observation-trend, but different from drug-monitoring's `daysBetween`.
- `engine/rules-engine.js`: documented inclusive boundary semantics on the event-count window.
- `engine/rules-engine.js`: documented `minDelta: 0` default semantics on observation-trend (means "any movement in named direction fires"; flat lines blocked by the strict-inequality direction check).

### Functional changes
None — pure code clarity and maintainability pass.

## [v3.1.1] — 2026-05-28
### Fixed
Four-agent code review of v3.0/v3.1 turned up real bugs. All fixed in this patch.

**Trend evaluator (v3.1.0 bugs):**
- `observation-trend` rule used `.find()` to pick a history series — would silently pick the first match if multiple existed (e.g. "PSA" and "PSA free/total ratio"). Now uses `.filter()` and picks the series with the most data points.
- Flat-line readings (delta = 0) used to fire as a "rising" trend because `0 >= 0` was true. Now requires strict directional movement: rising needs `delta > 0`, falling needs `delta < 0`. Combined with the existing `minDelta` check.
- `!isNaN(pt.value)` let `Infinity` through. Now `isFinite()` — matches author's stated intent.

**Side-panel rendering (v3.0 carryover):**
- `event-count`, `drug-combo`, and `composite` chips were computed correctly but **never rendered** in the side panel — they weren't in `typeOrder`, so any GP using the v3.0 alert library was seeing nothing for those types. Added them under labels "Recurrent Events", "Drug Combinations", "Composite Alerts".
- `shared/chip-renderer.js`: added `renderDrugComboChip`, `renderEventCountChip`, `renderCompositeChip`. Surfaces drug-set summary, count vs threshold, fired-rules count.
- `content-scripts/sentinel.js` `chipHtml`: new branches for the three chip types, delegating to the shared renderer.
- `manifest.json`: added `shared/chip-renderer.js` to content_scripts so the delegation actually resolves.

**Value parsing edge cases:**
- `parseObservationValue` now strips Unicode `≤` and `≥` operators (not just ASCII `<` / `>`). A PSA recorded as "≥10" was silently NaN before.
- European comma-decimal `"3,5"` → 3.5 instead of silently truncating to 3.

**Mock / error paths:**
- `MOCK_PATIENT` now includes a 4-point HbA1c history so trend/event-count rules are actually testable in mock mode.
- `fetchPatientData` error fallback now includes `observationHistory: []` for consistency with all other return paths.

### Backward compatibility
Four-agent review confirmed zero regressions. All v3.0 and earlier rule types (drug-monitoring, qof-register, qof-indicator with the three pre-existing check kinds, drug-combo with `sourceKind: "problems"`) evaluate through unmodified code paths.

## [v3.1.0] — 2026-05-28
### Added — Multi-point observation history
The observation-history extractor that v3.0 alerts depended on. Two alert types that previously always returned "no data" now actually fire:

- **`observation-trend` rules** (Rising PSA, falling eGFR, etc.) — now evaluates the last N observations within a configurable window and fires when the direction matches with optional minimum delta.
- **`event-count` rules with `sourceKind: "observations"`** (e.g. "≥4 abnormal LFTs in 12 months") — now counts real historical observations instead of just the latest.

### Under the hood
- `engine/normalisers.js`: new `parseObservationValue()` helper handles `<5`, `120/80` (takes systolic), text values, etc. New `data.observationHistory` array surfaces every recorded date for every investigation type, newest-first. `data.observations` (latest-only) unchanged for backward compat.
- `engine/data-fetcher.js`: wires `observationHistory` through to the engine's evaluation context.
- `engine/rules-engine.js`: `evaluateEventCountRule` (observations branch) now uses real history; `evaluateQofIndicatorRule` `observation-trend` branch implements first-vs-last comparison (last-in-window vs newest), checks `minPoints`, `minDelta`, and `direction`. BP-style values use systolic for trend calc.
- `content-scripts/sentinel.js`: passes `observationHistory` to the engine in both evaluation paths.

### Still coming — consultation-diagnoses extractor
The feasibility scout found that the existing patient-journal endpoint already returns consultation-level coded entries — `fetchJournalObservations` in `content-scripts/sentinel.js` just filters them out at the `entryType === 'observation'` check. To enable "≥3 UTIs coded in consultations in 12 months" we need to know the exact `entryType` value Medicus uses for a coded diagnosis (likely `'problem'`, `'diagnosis'`, or `'coded-entry'` — needs one real network capture to confirm). Tracking as v3.1.1 / v3.2.

## [v3.0.0] — 2026-05-28
### Added — Alert Builder UI (v3.0 headline feature)
The user-facing half of the alert builder. Combined with the v2.6.0 backend, GPs can now browse a curated library of 22 starter alerts (PINCER + Ardens + MHRA + PCIT) and one-click add them, or build their own alerts from scratch via dedicated form sections — no JSON editing.

- **Alert Library panel** at the top of Settings → Monitoring → Custom Rules. Collapsed by default. Cards grouped by category (Prescribing safety, Drug monitoring, Recurrent events, etc.) with colour-coded source badges. Click [+ Add to my alerts] to copy a starter alert into your custom rules — editable afterwards. Already-added alerts show "✓ Added" and the button greys out.
- **Drug-Combo Alerts** section — build rules like "Warfarin + NSAID concurrent" using repeating drug-set cards. Patient filters (age min/max, sex, requires/excludes problem) collapsed behind a chevron to keep the common case clean.
- **Event-Count Alerts** section — build rules like ">3 UTIs in 12 months for female <65". Source-kind toggle (Problems / Observations) with inline warning explaining the observation-history caveat.
- **Composite Alerts** section — combine other custom rules via AND/OR. Multi-select listbox of all your non-composite rules; blocks selecting a composite (no recursion).
- **Observation-trend** check kind added to the QOF Indicator form (4th radio: Rising/Falling, min data points, within months, optional min delta).
- **Smart routing** — clicking [+ Add] from the library scrolls to the right section's list and briefly flashes the new entry so users find it.

### Coming in v3.1
- Consultation-diagnoses extractor (needed for accurate recurrent-acute-condition alerts like recurrent UTI from coded encounter diagnoses, not just problem list)
- Multi-point observation history (needed to make observation-trend and event-count-on-observations fire meaningfully)

## [v2.6.0] — 2026-05-28
### Added — Alert builder backend (rules engine + library)
Backend foundation for the v3.0 user-configurable alert builder. UI to follow.
- **Three new rule types** in `engine/rules-engine.js` and `shared/io/sentinel-io.js`:
  - `drug-combo` — fires when patient is concurrently on drugs from N sets you define, with optional age/sex/problem filters. Covers PINCER prescribing-safety patterns (warfarin + NSAID, beta-blocker in asthma, etc.). Optional `mustNotBePresent` field for "drug X present AND drug Y absent" patterns (e.g. NSAID without PPI).
  - `event-count` — fires when N matching items in problems (or observations) within a time window meet a threshold. Covers ">3 UTIs in 12 months" style alerts. (Observation history limited to latest per test until v3.1 adds history endpoint — chips note the caveat.)
  - `composite` — fires when other rules combine via AND/OR. Composite rules cannot reference other composites (recursion guard). Missing referenced rules are skipped silently.
- **New check kind `observation-trend`** under `qof-indicator` for rising/falling trends across N observations. Emits `no_data` until observation history endpoint lands.
- **`rules/alert-library.json`** — 22 curated starter alerts:
  - All 13 PINCER prescribing-safety indicators
  - 5 Ardens / MHRA entries: valproate pregnancy prevention, lithium monitoring, SGLT2 + DKA awareness, isotretinoin PPP, dual antiplatelet
  - 1 Primary Care IT QTc-prolonging combination
  - 2 event-count examples: recurrent UTI (≥3 in 12mo, female <65), recurrent falls (≥2 in 12mo, age ≥65)
  - 1 composite template, 1 observation-trend (rising PSA)
- Engine helpers added: `severityToStatus()`, `passesAgeFilter()`, `passesSexFilter()`. New module-level constants for valid severities, sexes, operators, and source kinds.

## [v2.5.1] — 2026-05-28
### Added
- **Manual "Check for updates" button** in Settings → Suite. Previously the extension only checked GitHub for new releases once every 24h on its own schedule; now you can force a fresh check on demand. Button shows current state (up to date / update available / last check failed) and how long ago the last check ran. Bypasses the 23h cooldown when clicked.

## [v2.5.0] — 2026-05-28
### Added — Practice Profile (shared-folder managed deployment)
- New **Practice Profile** system for practices running the extension from a shared network folder. Drop a `practice-profile.json` file into the extension folder alongside the other files and it propagates default settings automatically to every PC that loads the extension — no manual steps for users after initial install.
- **Service worker** reads the profile on every browser start (`onInstalled` + `onStartup`). If `profileVersion` has changed since it was last applied, new settings are merged/applied automatically.
- **Three apply modes** controlled by the practice admin in the JSON file:
  - `mergeMissing` (default) — only writes settings the user hasn't already configured; safe, never overwrites user customisation
  - `forceOverride` — always replaces — use to push a mandatory rule change to all users
  - `firstRunOnly` — seeds new installs only; ignores version bumps after first apply
- **Settings → Backup & Restore** now shows a Practice Profile card: file status, version last applied, timestamp, and whether an update is available. Buttons: *Check for update*, *Apply now* (manual force), and **Generate profile from current settings** — configure one PC exactly how you want then generate a ready-to-use `practice-profile.json` in one click.
- **Full setup guide** embedded in a collapsible panel in the Settings page: step-by-step instructions for creating the file, editing the header, choosing a mode, pushing updates, and first-time install on each PC.
- Desktop notification (silent, one per version) when a new profile version is applied, if the admin enables `notifyUserOnApply`.
- Application history stored in `suite.practiceProfile` (last 10 applies) for auditability.
- New file `shared/io/practice-profile.js` — self-contained, loads in both service worker and options page contexts.

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
