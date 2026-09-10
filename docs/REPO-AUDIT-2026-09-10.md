# Medicus Suite — Repo Audit

**Date:** 2026-09-10  
**Product:** v3.261.20 (`main` @ `603053d`, after PR #387 tally + PR #388 polish)  
**Type:** principal-engineer audit (analysis only). Four Grok 4.6 explore agents + orchestrator verification against source.  
**Not a CSO review.** Frozen safety documents are cited as debt, not rewritten here.

---

## Executive summary

**Health grade: B−**

This is a mature, heavily gated clinical Chrome extension: ~230 Node tests, write-path inventory CI, patient-data commit guard, vendor checksums, dual-mode cores with real unit tests. The product still ships. The grade is not A because (1) the next **minor** bump trips the CSO-gap HARD_FAIL, (2) two god files mix irreversible writes with UI, (3) Options diagnostics will XSS from a crafted practice code, and (4) every Medicus page still loads every canvas plus a pile of private `MutationObserver`s.

**Top 3 risks**

1. **CSO lag.** Hazard-log last signed review is v3.202.0 — **59 minors** behind; HARD_FAIL is 60. Frozen docs still describe Visualiser / Condor tab / CQC pack / Practice Report as current. SOUP still claims PDF.js ships.
2. **Privileged XSS.** `suite-io.js` imports any string as `suite.practiceCode`; Options diagnostics interpolates it into `innerHTML` (`options.js:2506–2530`).
3. **W22 inside an 8k HUD file.** `content-scripts/triage-lens/content.js` (~8060 lines) owns queue chips **and** OIR auto-tick. A chip fix can regress an irreversible Medicus write.

**Top 3 opportunities**

1. Cap `suite.discoveredAllPatientUrls` and route-gate book observers (S, same afternoon).
2. Validate practice code on import + escape diagnostic HTML (S).
3. CSO re-freeze: retire Visualiser hazards, rewrite SOUP to JetBrains Mono only, reset the 60-minor clock.

---

## Repo map

| | |
|---|---|
| **Purpose** | Chrome MV3 augmentation layer on Medicus (UK GP EPR). Side panel + in-page overlays. Bounded user-initiated writes (CSN W1–W24). |
| **Users** | Clinicians and reception at Witley & Milford and named practices. Owner: Dr Dave Triska. |
| **Stack** | Unbundled MV3. Classic IIFE content scripts + ESM side-panel/pop-out/rota. Node `--test` only (no runtime bundler). |
| **Maturity** | v3.261.20, 900+ source files, ~230 tests, GitHub Actions test+lint, tag/main release zip. |

**Architecture sketch.** Service worker (`importScripts` hub) owns alarms, txn proxy, practice-profile IO. Side panel / pop-out are ESM shells with lazy `MODULES`. On-page work is four `content_scripts` batches on every `https://*.medicus.health/*` page: MAIN-world `page-world.js`, engine+Sentinel, HUD, write canvases, contacts. Dual-mode IIFE (`module.exports` + `window`) is the content-script module system; ESM cannot cross that boundary, so clinical tables (`STATUS_RANK`, chip labels) are cloned and CI-locked.

**Key directories:** `engine/` rules + fetch; `shared/` cores + IO; `content-scripts/` injectors; `side-panel/modules/` tabs; `rota/` separate ESM app; `board/` TV kiosk; `rules/` JSON; `docs/` safety + living product list.

**Surprise:** `engine/` is not chrome-free (`data-fetcher.js` talks `chrome.storage` and the txn proxy). Only `rota/engine/` and `board/board-core.js` are documented pure. Note’s live feeds still live under `side-panel/modules/condor/` after the Condor **tab** was deleted.

**God files (KB):** `content.js` 536, `contacts-canvas.js` 293, `problem-description-cleanup.js` 258, `options.js` 245, `rules-engine.js` 167, `lab-allocate-core.js` 105, `panel.js` 95.

---

## Audit report

Facts vs judgements are marked. Severity: Critical / High / Medium / Low.

### Architecture

| Sev | Finding | Where | Why it matters |
|---|---|---|---|
| High | HUD, queue chips, and W22 OIR tick share one 8k IIFE | `content-scripts/triage-lens/content.js:8`, `:3252`, inventory `test-write-path-inventory.js:181` | Chip persistence work can regress an irreversible tick. W22 was already missed once. |
| High | W9 (never recode) and W19 (note SNOMED may change) colocated | `problem-description-cleanup.js:18`, `:1160`, `:1168` | A shared POST helper can recode a problem when only a label tidy was intended. Inventory will not catch a crossed invariant. |
| High | No shared write kernel; `WriteCore` has one consumer | `shared/write-core.js:8`; only `allergy-cleanup-canvas.js:52` | Allocate canvases still trust `result.written > 0`. False “done” / H-043 class. |
| High | Dual runtimes clone clinical tables | `rules-engine.js:29`, `sentinel-core.js:29`, `due-mini.js:32`, `content.js` vs `triage-lens/options.js` `RETIRED_CHIP_LABELS` | A missing rank key hides a vaccine chip on one surface. CI holds it; every status is a three-file edit. **Fact.** |
| High | SW swallows `importScripts` failures | `service-worker.js:18–30` | Toolbar still opens; practice-profile / txn stack can be absent. Silent. |
| Medium | Every Medicus page loads every canvas | `manifest.json:32–174` | Script-order is the module graph. Extra observers compete with Vue (chip-wipe / crushed-textarea class). |
| Medium | `engine/` uses `chrome.*` | `engine/data-fetcher.js:434–470` | CLAUDE.md “business logic” is not a pure layer. |
| Medium | Note still imports deleted-tab Condor modules | `board/board.js:416–422` | PPI on a public TV is H-067-adjacent if that leftover feed drifts. |

**Not a finding:** no content-script → panel ESM cycle. Write inventory (verbs + DOM macros + W1–W24) is a real control.

**Would not refactor:** queue-chip prepend/durable-map contract; classic IIFE as on-page modules without a full injection redesign; booking identity split (H-043); W7/W8 DOM macros; `REQUEST_WRITE_CAPTURED = false`; HAR-locked canvas state machines.

### Security

Verified against source this session.

| Sev | Finding | Where | Class |
|---|---|---|---|
| High | Backup import accepts any string as practice code; Options diagnostics `innerHTML +=` the URL built from it | `shared/io/suite-io.js:82–84`; `options/options.js:2506–2530` | Privileged XSS → full `chrome.storage` (PPI). F8 was only closed in request-monitor/activity-api. **Fact.** |
| Medium | `patientAlerts.byPatient` is names + NHS + DOB + free text, no TTL, in suite backups | `shared/io/patient-alerts-io.js:6–10, 121–126` | PHI at rest. The file already admits this. **Fact.** |
| Medium | Duplicate-checker scan state (name, NHS, DOB, uuid) in `chrome.storage.local`, no TTL | `duplicate-checker.js:64–72, 3159–3168` | Practice-list PHI until next scan. |
| Medium | SOUP + SECURITY-AUDIT NF6 still claim PDF.js ships | `docs/SOUP.md:4–45`; `SECURITY-AUDIT.md:42`; `vendor-versions.json:3` says removed v3.255 | Doc lie. Zip is font-only. |
| Low–Med | XSS grep only covers four files | `test-xss-attribute-escaping.js:90–97` | `slots.js` `escHtml` *does* quote-escape today; dropping it would not fail CI. Tally DOM is type names + counts only (no patient names). |
| Low–Med | Journal discovery still stores a live UUID URL | `api-discovery.js:131–133` | Persistent patient id. Listing URL array is **uncapped** (`:170–174`). |
| Low | WAR includes `booking-core.js` + `passport.html` | `manifest.json:177–197` | Residual F3. Passport still 60s TTL. |
| Low | `*.supabase.co` is any project Options accepts | `manifest.json:13`; `options.js:799–810` | Wrong project gets staff presence. |

**Confirmed safe this pass:** no product POST outside W1–W24; tally and repeat-prescribing pills are GET-only; no hardcoded API keys; referrals discovery no longer persists rows (TF1 still holding).

### Testing

CI: patient-data guard, defaults lock, vendor checksums, `node --test test-*.js`, eslint. ~230 test files.

| Sev | Finding | Where |
|---|---|---|
| High | Tally `load()` race is `includes('_inFlightKey')` only | `test-appointment-tally-core.js` vs `appointment-tally.js:303–352` |
| High | Organise `commitFinalise` (W14–W16 batch) never executed in Node | `appointment-organise-canvas.js:702–805`; core tests mock fetch only |
| High | Companion widget (W2/W5) is grep, not runtime | `test-task-actions-due.js:27–83` vs `task-actions-panel.js` |
| Medium | Write inventory does not execute a staged batch | `test-write-path-inventory.js:215–236` |
| Medium | Most injected IIFEs have no Node export; allergy/nesting canvases that *do* export are the bar the book/companion miss | — |

**Strength:** engine, rota, `*-core.js`, booking-core, organise-core, tally-core, write-core are actually imported and asserted.

### Performance

| Sev | Finding | Where |
|---|---|---|
| High | Organise 1.5s + tally 1.5s + two `documentElement` observers + `querySelectorAll('button')` every tick, on **every** Medicus page until route-gated | `appointment-organise-canvas.js:1236–1254`; `appointment-tally.js:58–64, 408–416` |
| High | More always-on timers: Sentinel 400ms, Companion 800ms, document-codes/task-bulk 2s, allergy/nesting/presence 5s | cited in agent pass; hub exists (`dom-observer-hub.js:8–12`) and these still roll their own |
| Medium | Booking window search still per-day N+1 (TODO D2) | `shared/booking-core.js:204–205, 243–309` |
| Medium | Organise Finalise refetches the whole book after **every** item | `appointment-organise-canvas.js:767` |
| Medium | Uncapped `suite.discoveredAllPatientUrls` | `api-discovery.js:170–174` (journal templates already `slice(-50)`) |
| Medium | Panel pollers stack (WR 30s + Today WR 30s + Sentinel WR 30s); WR GETs are 15s-memoised, timer wakeups are not | `panel.js:920`; `today.js:44`; `appointments-feed.js:33` |

### Docs / DevEx / deps

Living docs were corrected in v3.261.20 (VISION, README, Onboarding, Trends help, brand). **Frozen CSO set is still a lie about pruned surfaces** (INTENDED-PURPOSE, CSN, HAZARD-LOG, SOUP, ACCESSIBILITY-STATEMENT). Hazard-log **59 minors** behind; next minor is CI red unless you stay on 3.261.x patches.

DevEx: unbundled MV3 is a feature (no ship of `node_modules`). ESLint is intentionally lenient. Prettier only on **new** files. Release zip on main/tag from `release.yml`.

Deps: runtime is almost vendor-free (JetBrains Mono). DevDeps eslint/prettier only. NF6 PDF.js is **gone from the zip**; SECURITY-AUDIT still tracks it.

### Strengths (do not lose)

- CSN §6.1 machine-enforced including DOM macros.
- Canvas/core splits where they exist (contacts view vs API; allocate canvases; `board-core`; `rota/engine`).
- Txn proxy throws on `isWrite`; credential stays in the worker.
- CI lock-step tests (status rank, chip labels, defaults triple-copy, write inventory, `return cleanup`).
- No telemetry; practice-code format guards on most fetch builders (not on suite import).

---

## Improvement strategy

Five themes that explain most findings:

1. **Safety docs are a clock, not a diary.** Target: last CSO review within ~12 minors; SOUP matches `vendor-versions.json`. Principle: a clinician reading the notice must not hunt for a deleted Visualiser. **Done when:** `check-doc-versions.js` prints OK for HAZARD-LOG/SOUP after a signed re-freeze, not because HARD_FAIL is 60.

2. **Writes need a kernel, not only an inventory.** Target: identity re-check + landed-id + confirm copy are shared; W22 is not inside `content.js`; W9/W19 cannot share a “just POST” helper. Principle: the inventory answers “is this a write?”; the kernel answers “did the right write land on the right patient?” **Done when:** `WriteCore` (or successor) is used by allocate + organise + allergy; OIR tick lives in its own file mapped to W22.

3. **Injected runtime is under-tested and over-polled.** Target: book observers only on the book route; `load()` / `commitFinalise` executable in Node; listing URLs capped. Principle: grep is a lock, not a test. **Done when:** a date-A-in-flight / date-B assertion exists; organise N cancels ⇒ 1 overview GET; `discoveredAllPatientUrls.length <= 50`.

4. **Privileged HTML is still a sink.** Target: every Options `innerHTML` uses `escHtml`/`escAttr`; practice code validated on import (same regex as Options detect). **Done when:** `test-xss-attribute-escaping.js` includes `options.js` + `suite-io.js` rejects `practiceCode` with `<>"`.

5. **PHI at rest is an exception that grew.** Target: patient-alerts and duplicate-checker scan state have TTL or are excluded from kiosk-shared profiles; journal UUID URL not stored raw. Principle: “never persist patient context” was the original claim. **Done when:** SECURITY-AUDIT §5 matches the keys that actually hold names/NHS.

**Not in this strategy (effort vs payoff):** rewriting classic IIFE as ESM; unifying booking-core with slots/booking-api (H-043); restyling Companion/organise-canvas interiors (needs Dave-on-panel); expanding HARD_FAIL without a real CSO session.

---

## Task plan

### Milestone 0 — Safety net (do first)

| Task | Files | Acceptance | Effort | Risk |
|---|---|---|---|---|
| Cap listing discovery at 50 | `content-scripts/api-discovery.js`, `test-backup-coverage.js` | `discoveredAllPatientUrls.length <= 50` in test | S | Low |
| Route-gate tally + organise observers | `appointment-tally.js`, `appointment-organise-canvas.js` | Off-book: no 1.5s interval, observer disconnected | S | Low |
| Validate practice code on suite import | `shared/io/suite-io.js`, `test-backup-keys.js` | Non-hex / XSS string rejected | S | Low |
| Escape Options diagnostic HTML | `options/options.js`, expand `test-xss-attribute-escaping.js` | `practiceCode` with `"` cannot break out of the probe line | S | Low |

### Milestone 1 — Critical / High correctness

| Task | Files | Acceptance | Effort | Risk |
|---|---|---|---|---|
| Executable tally `load()` test | export `load` or extract fetcher; `test-appointment-tally-core.js` | Date A in-flight + date B must not apply A | M | Low |
| Stop clobbering `slots.hiddenTypes` — **done in 3.261.20** | — | — | — | — |
| CSO re-freeze | INTENDED-PURPOSE, CSN, HAZARD-LOG, SOUP, ledger | Visualiser/Condor/CQC/Practice Report retired or retargeted; SOUP = JetBrains Mono; `last_cso_review_version` moves | L | Process (needs Dave as CSO) |
| Extract W22 from `content.js` | new `oir-auto-tick.js` + inventory map | `content.js` has no POST/click-macro; W22 file named in inventory | L | High (queue chips) |

### Milestone 2 — High-leverage

| Task | Files | Acceptance | Effort | Risk |
|---|---|---|---|---|
| Subscribe book/allocate launchers to `__chObserverHub`; drop 1.5s polls | tally, organise, lab/rx/request/workflow canvases | Hub is the only observer; launchers still survive Vue | M | Medium |
| Organise Finalise: one board GET after the batch | `appointment-organise-canvas.js` + test | N items ⇒ 1 overview GET | M | Medium (safety of mid-batch board) |
| Roll `WriteCore` to allocate canvases | lab/rx/workflow/request | False-success path covered by test | L | Medium |
| TTL or exclude PPI keys | patient-alerts-io, duplicate-checker | Documented TTL or backup omit | M | Product (alerts are meant to persist) |

### Milestone 3 — Quality

Companion token pass; organise-canvas interior off Tailwind; dark-theme `color: var(--bg-deep)` on accent fills; `g` chords for Signing/Phrases/Pt Alerts/Rota; palette jumps to Lab filing / API / Tabs.

### Quick wins (do without a design review)

1. Cap listing URLs (api-discovery).  
2. Practice-code regex on import.  
3. Escape diagnostic `innerHTML`.  
4. Route-gate book observers.  
5. Expand XSS grep to `options.js` + `slots.js`.

### Implementation sketches (top 3)

**1. Practice code + diagnostic HTML.** In `suiteImport`, run the same `[a-f0-9]{4,8}` check Options uses; reject otherwise. In the probe loop, `escHtml(p.url)` and `escHtml(e.message)` before `innerHTML +=`. Test: import `practiceCode: 'x"><img>'` throws; render of a fake probe line contains `&quot;` not a raw `"`.

**2. Route-gate observers.** `startBookChrome()` / `stopBookChrome()`: if `parseBookRoute` is null, `clearInterval` + `observer.disconnect` + remove host. Call from the existing 1.5s tick (cheap) or from `popstate` + hub. Test: source lock that `stopBookChrome` exists and is called when `!route`.

**3. Cap discovery.** Copy the journal `slice(-50)` onto `ALL_URLS_KEY`. Test: push 60 URLs, stored length is 50.

---

## Open questions

1. Are patient-alerts **supposed** to persist names/NHS across machines (practice-shared flags)? If yes, the SECURITY-AUDIT “never persist patient context” sentence is the bug, not the key.
2. Should the next release be **3.261.21** (stay under HARD_FAIL) or a CSO session that unlocks 3.262?
3. Is extracting W22 from `content.js` worth the queue-chip regression risk this quarter, or is a file-level comment + inventory split enough?
4. Organise mid-batch refetch was added as a safety control — can a single end-of-batch GET replace it without lying about “the rest are still staged”?

---

## What this audit did not do

- Re-run the executable pen-test harness (`pen-test-simulator`). Last run: v3.77.11 / 2026-06-14, 17 BLOCKED.
- Restyle Companion / organise interiors (needs Dave looking at the live panel).
- Edit frozen CSO documents.
- Full `npm test` wall-clock in this session (CI on #388 was green).
