# Learnings: Referrals Tracker (v1.4.9–v1.4.13)

## The Core Pattern: URL Template Replay

**Never construct Medicus API URLs from scratch.** The endpoint paths, param naming conventions, and pagination structure vary per deployment and can't be guessed reliably.

Instead:
1. A content script (`referrals-discovery.js`) uses `PerformanceObserver` to intercept the page's own API calls and stores the exact URL in `chrome.storage.local`.
2. The side-panel module reads that stored URL and replays it verbatim — only rewriting the date params and pagination params.
3. Everything else (filters, sort params, auth tokens baked into the URL) is preserved exactly.

This pattern should be used for any new module that needs to call a Medicus API endpoint.

---

## Medicus Referrals API — Confirmed Facts

- **Data endpoint path:** `/referrals/data/clinical-audit-report/filter-outbound-nhs-referrals`
- **Config/filter-options endpoint:** `/referrals/data/outbound-nhs-referrals-audit` (returns `priorityOptions`, `statusOptions`, `defaultReferralStartDate`, `defaultReferralEndDate` — **NOT** a data endpoint)
- **Date params:** `startDate` / `endDate` (NOT `referralStartDate` / `referralEndDate`)
- **Pagination params:** `startRow` / `endRow` (NOT `offset` / `limit`)
- **Default page size on the page:** 100 rows — but we use 2000 per fetch to minimise round trips
- **Priority values (from config):** `two-week-wait`, `urgent`, `routine` (lowercase/hyphenated — NOT `TwoWeekWait`, `Urgent`, `Routine`)
- **Status values (from config):** `incomplete`, `completed`, `cancelled`
- **A practice with ~3,600 referrals** needs ~2 paginated fetches at PAGE_SIZE=2000

---

## `buildUrlFromTemplate` — The Key Function

```javascript
function buildUrlFromTemplate(templateUrl, startDate, endDate, startRow, endRow) {
  const u = new URL(templateUrl);
  // Detect which date-param naming convention this endpoint uses
  if (u.searchParams.has('referralStartDate')) {
    u.searchParams.set('referralStartDate', startDate);
    u.searchParams.set('referralEndDate',   endDate);
  } else if (u.searchParams.has('startDate')) {
    u.searchParams.set('startDate', startDate);
    u.searchParams.set('endDate',   endDate);
  }
  if (typeof startRow === 'number' && u.searchParams.has('startRow'))
    u.searchParams.set('startRow', String(startRow));
  if (typeof endRow === 'number' && u.searchParams.has('endRow'))
    u.searchParams.set('endRow', String(endRow));
  return u.toString();
}
```

**Critical:** Use `URLSearchParams.set()` not `append()` — appending creates duplicate params which causes HTTP 400.

---

## Discovery Storage Keys

| Key | Contents |
|-----|----------|
| `referrals.discovery` | `{ url, discoveredAt, sample }` — `url` is the full working data URL |
| `referrals.config`    | `{ url, discoveredAt, data: { priorityOptions, statusOptions, defaultReferralStartDate, defaultReferralEndDate } }` |

`referrals.discovery.url` is the **only** URL used for data fetching. `referrals.config.url` is never passed to `fetchReferrals()`.

---

## Debugging HTTP 400s

When you get a 400 from a Medicus API:
1. **Show the user the actual attempted URL** in the error panel — the URL itself usually reveals the bug immediately.
2. Check for **duplicate params** (both `startDate` and `referralStartDate` present, appended rather than set).
3. Check that **filter values came from config** not hardcoded — the API rejects unknown enum values.
4. Check that **no extra params** were added (e.g. `limit=2000` was rejected; the API uses `endRow` instead).

Build a diagnostic panel early — it saved multiple debug cycles here. The panel should expose:
- `referrals.discovery.url`
- `referrals.config.url`
- Config priority/status values
- Last attempted URL

---

## Side Panel Module Pattern

Each module exports `async function init(el)` returning a cleanup function:

```javascript
export async function init(el) {
  el.innerHTML = `...`;
  // attach listeners, start fetching
  return function cleanup() {
    // remove listeners, cancel requests
  };
}
```

The module reads discovery data via:
```javascript
const stored = await chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]);
```

Then uses `resolveStored(stored)` to extract the URL and filter values in one place.

---

## Error Classification for User Messages

| HTTP status | Likely cause | User message |
|-------------|-------------|-------------|
| 404 | URL path wrong / endpoint doesn't exist | "Endpoint not found" |
| 400 | Wrong/duplicate/missing query params | "Bad request — check params" |
| 401/403 | Session expired / not on Medicus page | "Not authorised — navigate to Medicus first" |
| Config-response-as-data | Hit the config endpoint instead of data endpoint | "Got config response — check API URL" |

Always show the attempted URL alongside the error message.

---

## What Breaks If You Skip Discovery

If the user hasn't navigated to the Referrals → Clinical Audit Report page since installing the extension, `referrals.discovery` will be empty. The module must show a clear prompt: **"Navigate to Referrals → Clinical Audit Report on Medicus first"** — attempting to construct the URL from practice code alone is not reliable and wastes debug cycles.

---

## Release / Version Bumping

Releases are auto-published via GitHub Actions on push to `main`. Bump `manifest.json` version before pushing a fix — each version should be a shippable state. In this project: 1.4.9 (initial build), 1.4.10 (fix 404), 1.4.11 (fix 400 attempt 1), 1.4.12 (add diagnostic + template replay), 1.4.13 (fix date param detection + pagination).
