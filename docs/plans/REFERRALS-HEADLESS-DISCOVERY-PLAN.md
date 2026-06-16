# Referrals — remove the "open the report once" dependency (headless discovery)

Status: **PLAN — not yet built.** Converged from 3 opus investigation agents (2026-06-16).
Approach chosen by maintainer: **headless discovery + bug fix** (automatic, with fallback).
Implement as a separate, signed-off piece.

## Problem

The Referrals module and the Practice Report can't fetch referral data until the user
has opened the Medicus "Referrals → Clinical Audit Report" page once, so
`content-scripts/referrals-discovery.js` can capture the data-endpoint URL template
from the page's own network calls. Until then `referrals-api.js:93-97` throws
"No discovered URL". Every other data module (submissions, activity, slots) builds its
URL directly from the practice code and fetches it credentialed with no tab open.

## Two findings that change the picture

1. **The endpoint paths ARE known.** `docs/learnings-referrals-tracker.md` records the
   confirmed England/Medicus paths:
   - Config: `/referrals/data/outbound-nhs-referrals-audit` (returns `priorityOptions`,
     `statusOptions`, `defaultReferralStartDate`, `defaultReferralEndDate` — not data)
   - Data: `/referrals/data/clinical-audit-report/filter-outbound-nhs-referrals`
   - Date params `startDate`/`endDate`; pagination `startRow`/`endRow`; priority values
     `two-week-wait`/`urgent`/`routine`; status `incomplete`/`completed`/`cancelled`.
   So the URL is deterministically constructible for this deployment. A credentialed
   background fetch carries the Medicus session cookies with NO tab — proven by
   `shared/request-monitor.js` + `service-worker.js:563-618` and `shared/activity-api.js:59-78`.

2. **A live bug, independent of the tab dependency.** `report-data.js fetchReferralsRange`
   (`side-panel/modules/condor/report/report-data.js:271-282`) calls
   `ReferralsApi.fetchReferrals(siteId, start, end, {fetch})` with **no `templateUrl`**, so
   it always throws "No discovered URL" — the Practice Report's referrals section can never
   populate, even after the page has been opened. Must fix regardless of approach.

## Doctrine reconciliation

`learnings-referrals-tracker.md` opens with: *"Never construct Medicus API URLs from
scratch — they vary per deployment."* The design honours this by being
**deterministic-first, but validated, with two fallbacks** — it never blindly trusts a
constructed data URL:

1. Construct the **config** URL (stable; returns options, not data) and fetch it
   credentialed. If the response validates (`isConfigResponse` — has `priorityOptions`),
   we know the deployment matches the confirmed shape.
2. Derive the **data** template from the confirmed path + the config's option values,
   fetch one page, and confirm it is NOT a config response (the guard already at
   `referrals-api.js:123-127`). Only then store it.
3. If construction/validation fails → write nothing; fall back to (a) any stored
   discovered template, then (b) the existing in-page content-script discovery + its
   friendly "open the report once" prompt. **Worst case = no worse than today.**

PHI containment is preserved exactly as the content script does it: store **URL only**
in `referrals.discovery`, and only `priorityOptions`/`statusOptions` in `referrals.config`
(audit M1, `referrals-io.js:7-10`). The probe fetches rows transiently to validate but
never persists them.

## Design

### A. New shared helper `ensureReferralsDiscovery(code, { fetchImpl })`
Lives alongside the referrals API surface (`shared/referrals-api.js`, exposed on
`window.ReferralsApi` + `module.exports`). Returns the data-template URL or null.
- Resolve + validate the code (`PracticeCode.resolve()` / `isValidPracticeCode`,
  `shared/practice-code.js:86-89,126-128`) — same hardening as the request monitor.
- Construct config URL `${apiBase}/referrals/data/outbound-nhs-referrals-audit`,
  fetch credentialed, validate `isConfigResponse`. Store `referrals.config`
  `{ url, discoveredAt, data:{priorityOptions,statusOptions} }`.
- Construct data URL from the confirmed path + config options + default dates +
  `startRow=0&endRow=2000`. Fetch one page; confirm it's data, not config. Store
  `referrals.discovery` `{ url, discoveredAt }` (URL only).
- Idempotent (skip write if stored URL unchanged); fail-safe (return null on any error,
  401/403 → no retry-storm, mirror `request-monitor.js:69-74`).

### B. Wire it in (lazy, on demand — not a new background poller)
- `side-panel/modules/referrals/referrals.js init()` (`:108-147`): if `referrals.discovery`
  absent, call `ensureReferralsDiscovery()` before showing the prompt. The existing
  `chrome.storage.onChanged` reactivity (`:160-176`) re-renders automatically.
- `report-data.js fetchReferralsRange` (`:271-282`): **(bug fix)** read
  `referrals.discovery.url` and pass it as `templateUrl`; if absent, call
  `ensureReferralsDiscovery()` first. Only then call `fetchReferrals`.

### C. Stale-template self-heal (keep regardless of A/B)
In `referrals.js` fetch error branch (`:257-260`) and the report path: if
`fetchReferrals` throws `err.status === 404` or "Got config response instead of referral
data" (`referrals-api.js:124`), treat the stored `referrals.discovery` as invalid —
clear it and fall back to `renderDiscoveryPrompt` (`:365-390`) with one added line
("the referrals report location changed — open it once more"), instead of a dead error.
This is the single highest-value safeguard and is orthogonal to how the URL is obtained.

### Keep
- `content-scripts/referrals-discovery.js` stays as the self-healing in-page capture
  (belt-and-braces for non-England deployments and re-discovery).
- `referrals-io.js` unchanged (`referrals.discovery` stays out of backups; `referrals.config`
  stays in). No new storage keys, no new permissions.

## Test plan
- Unit (pure, no I/O): a `buildReferralsTemplate(code, config)` builder → asserts the
  confirmed path + param names + lowercase-hyphenated priority/status values.
- `ensureReferralsDiscovery` with a mocked `fetchImpl`: config validates → stores both
  keys; config 404 → returns null, writes nothing; data URL returns a config blob →
  rejected, returns null. Assert **no PHI persisted** (only URL + options).
- Stale-heal: a 404 / config-response from `fetchReferrals` clears `referrals.discovery`
  and routes to the prompt, not the error.
- Report: `fetchReferralsRange` populates when a template exists; degrades to the
  "Referrals — not enabled" section/footer when it doesn't.

## Risks
- **Read-only:** not violated — all GETs, no Medicus state mutated.
- **PHI at rest:** the one hard rule — persist URL + options only, never rows.
- **Biggest unknown:** whether the confirmed paths generalise beyond the practice they
  were captured from. Mitigated: deterministic-first → validate → fall back to stored
  template → fall back to in-page discovery → friendly prompt. Never worse than today.
- **Rate/limits:** happy path is 2 requests (config + 1 data page); probe capped; no new
  background poller (lazy, on-demand only).

## Effort
S–M. The plumbing (credentialed fetch, code resolution, storage keys, onChanged
reactivity, backup exclusion, the `buildUrlFromTemplate` rewriter) all already exists and
is reused. Net new: one helper (~40 lines) + two call-sites + the stale-heal branch +
tests. Bump manifest (patch/minor) + CHANGELOG on implementation.

## Files
`shared/referrals-api.js` (add builder + `ensureReferralsDiscovery`; the stale-error
classification) · `side-panel/modules/referrals/referrals.js:108-147,257-260,365-390` ·
`side-panel/modules/condor/report/report-data.js:271-282` (bug fix) ·
`side-panel/modules/condor/report/report-render.js:221-245,274-280` (inline "not enabled"
section) · reuse `shared/practice-code.js`, `shared/request-monitor.js` (precedent),
`content-scripts/referrals-discovery.js` (kept as fallback). Confirmed paths:
`docs/learnings-referrals-tracker.md`.
