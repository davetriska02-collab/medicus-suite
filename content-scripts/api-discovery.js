'use strict';

// Captures API calls made by specific Medicus pages and stores them in
// chrome.storage.local so that extension report pages can discover endpoints
// without requiring the user to open DevTools.
//
// Two independent captures, both gated on the page's current SPA route (read
// live per-event, not cached at script-injection time — Medicus is a Vue SPA
// and navigating between patient list / a patient's journal tab does not
// reload the document, so a cached location would go stale):
//   - Patient listing page (.../patient/listing*)
//   - A patient's journal tab (.../care-record/{uuid}?careRecordTab=journal)

const API_HOST_RE = /\.api\.england\.medicus\.health\//;
const PATIENT_PATH_RE = /\/patient\//i;
const STORAGE_KEY = 'suite.discoveredPatientListUrl';
const ALL_URLS_KEY = 'suite.discoveredAllPatientUrls';

const JOURNAL_KEY = 'suite.discoveredJournalUrl';
const ALL_JOURNAL_URLS_KEY = 'suite.discoveredAllJournalUrls';
const JOURNAL_TEMPLATE_KEY = 'suite.discoveredJournalUrlTemplate';
const ALL_JOURNAL_TEMPLATES_KEY = 'suite.discoveredAllJournalUrlTemplates';
const LAST_RUN_KEY = 'suite.apiDiscoveryLastRun';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PATIENT_UUID_PLACEHOLDER = '__PATIENT_UUID__';

// The real data endpoint, confirmed live 2026-07-02 (see
// docs/learnings-patient-journal-api.md) — prefer this over the loose
// "journal" substring match below, which also matches UI/component asset
// URLs (e.g. `clinical/ui/patient-journal/filters-category.vue`) that aren't
// the data call at all.
const CONFIRMED_JOURNAL_ENDPOINT_RE = /\/clinical\/data\/patient-journal\/overview\//i;
const STATIC_ASSET_RE = /\.(vue|jsx?|tsx?|css|png|jpe?g|gif|svg|woff2?|ico|map)(\?|$)/i;

// Decides whether `candidatePathname` should replace whatever is currently
// stored as the best-guess journal endpoint. A confirmed-shape match always
// wins; a static asset never wins; otherwise fall back to the original loose
// heuristic, but never let it downgrade an already-confirmed guess.
function isBetterJournalGuess(candidatePathname, currentUrl) {
  if (CONFIRMED_JOURNAL_ENDPOINT_RE.test(candidatePathname)) return true;
  if (STATIC_ASSET_RE.test(candidatePathname)) return false;
  if (!/journal/i.test(candidatePathname)) return false;
  if (!currentUrl) return true;
  try {
    return !CONFIRMED_JOURNAL_ENDPOINT_RE.test(new URL(currentUrl).pathname);
  } catch (e) {
    return true;
  }
}

function isOnJournalPage() {
  return /\/care-record\//i.test(location.pathname) && /careRecordTab=journal/i.test(location.search);
}

// The listing capture is scoped to the patient-listing route, read live
// per-event like isOnJournalPage() above. Without this gate every page whose
// API calls contain /patient/ was captured — including every care-record page,
// where the extension's OWN per-patient fetches (patient-banner, medication-
// regimen, problem listing…) each triggered storage round-trips and grew the
// ALL_URLS_KEY array by one entry per patient per endpoint, unbounded, on
// every Sentinel boot (v3.173.2 post-merge-train slowness fix). The header's
// stated scope was always "Patient listing page" — this makes the code match.
function isOnPatientListingPage() {
  return /\/patient\/listing/i.test(location.pathname);
}

// The patient UUID currently being viewed, read live from the SPA route
// (…/care-record/{uuid}?careRecordTab=journal) — used to turn a captured
// single-patient API URL into a reusable template for any patient.
function currentPatientUuid() {
  const m = location.pathname.match(UUID_RE);
  return m ? m[0] : null;
}

// Replaces every occurrence of the current patient's UUID (path or query)
// with a placeholder, so the click-through UI can substitute in any flagged
// patient's UUID later. Returns null if the current patient's UUID isn't
// found anywhere in the URL (template would be useless).
function templateUrl(cleanUrl) {
  const uuid = currentPatientUuid();
  if (!uuid || !cleanUrl.toLowerCase().includes(uuid.toLowerCase())) return null;
  const re = new RegExp(uuid.replace(/[-]/g, '\\-'), 'ig');
  return cleanUrl.replace(re, PATIENT_UUID_PLACEHOLDER);
}

// Medicus's own journal-tab UI applies year/category filters by default
// (`?year[]=2005&type[]=investigation&initialCat=year`), and the resource
// observer captures whatever request happens to fire while a clinician is
// browsing under one of those filters. Strip them before storing — the
// discovered template feeds "Analyse full record for duplicates", which
// needs the FULL unfiltered journal; keeping a filtered template would
// silently narrow every future analysis to whatever slice was last viewed,
// for every entity kind (see docs/learnings-patient-journal-api.md line 69
// for the confirmed filter params).
function stripJournalFilterParams(u) {
  // Keep in lock-step with engine/record-duplicate-parser.js
  // JOURNAL_FILTER_PARAM_KEYS / stripJournalFilterParams — that copy is
  // also applied on read in duplicate-checker.js so an already-stored
  // filtered template cannot silently narrow "Analyse full record".
  u.searchParams.delete('year[]');
  u.searchParams.delete('type[]');
  u.searchParams.delete('initialCat');
  return u;
}

function storeJournalUrl(url) {
  try {
    const clean = stripJournalFilterParams(new URL(url)).toString();
    const pathname = new URL(url).pathname;
    const template = templateUrl(clean);

    // Audit M6 (2026-07-18): the old raw-URL list embedded patient UUIDs, so
    // dedupe never converged and the array grew one entry per patient per
    // endpoint, forever, in chrome.storage.local — the same bug class fixed
    // for the listing capture in v3.173.2. Templates (UUIDs substituted out)
    // dedupe properly; a cap bounds the pathological case; and all four keys
    // are read/written in ONE batched round-trip instead of up to four
    // racing read-modify-write pairs.
    const CAP = 50;
    chrome.storage.local.get([ALL_JOURNAL_TEMPLATES_KEY, JOURNAL_TEMPLATE_KEY, JOURNAL_KEY], (r) => {
      const toSet = {};
      if (template) {
        const existing = r[ALL_JOURNAL_TEMPLATES_KEY] || [];
        if (!existing.includes(template)) {
          toSet[ALL_JOURNAL_TEMPLATES_KEY] = [...existing, template].slice(-CAP);
        }
        if (isBetterJournalGuess(pathname, r[JOURNAL_TEMPLATE_KEY])) {
          toSet[JOURNAL_TEMPLATE_KEY] = template;
        }
      }
      if (isBetterJournalGuess(pathname, r[JOURNAL_KEY])) {
        toSet[JOURNAL_KEY] = clean;
      }
      if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
    });
    // The raw-URL surface (ALL_JOURNAL_URLS_KEY) is deliberately no longer
    // accumulated; clear any legacy grow-forever value once.
    chrome.storage.local.remove(ALL_JOURNAL_URLS_KEY);
  } catch (e) {
    /* ignore */
  }
}

function storeUrl(url) {
  if (!API_HOST_RE.test(url)) return;

  if (isOnJournalPage()) {
    storeJournalUrl(url);
    return;
  }

  if (!isOnPatientListingPage()) return;
  if (!PATIENT_PATH_RE.test(url)) return;
  try {
    const u = new URL(url);
    u.searchParams.delete('limit');
    u.searchParams.delete('offset');
    u.searchParams.delete('page');
    u.searchParams.delete('pageSize');
    u.searchParams.delete('startRow');
    u.searchParams.delete('endRow');
    const clean = u.toString();

    // Store the most listing-like URL as the primary candidate
    if (/list/i.test(u.pathname)) {
      chrome.storage.local.set({ [STORAGE_KEY]: clean });
    }

    // Also accumulate all distinct patient-related URLs for inspection
    chrome.storage.local.get(ALL_URLS_KEY, (r) => {
      const existing = r[ALL_URLS_KEY] || [];
      if (!existing.includes(clean)) {
        chrome.storage.local.set({ [ALL_URLS_KEY]: [...existing, clean] });
      }
    });
  } catch (e) {
    /* ignore */
  }
}

// Recorded once per (re)injection — lets the debug panel show when this
// content script last actually ran, so a stale-script suspicion during live
// troubleshooting (e.g. "did my reload really pick up the code change?") can
// be checked directly instead of guessed at.
chrome.storage.local.set({ [LAST_RUN_KEY]: Date.now() });

// Capture resources already loaded before this script ran
performance.getEntriesByType('resource').forEach((e) => storeUrl(e.name));

// Observe future resources (Vue SPA makes API calls after initial load)
const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach((e) => storeUrl(e.name));
});
observer.observe({ entryTypes: ['resource'] });

// The Resource Timing buffer defaults to 250 entries; once full, Chrome
// silently DROPS new entries (they never reach the observer above either) —
// this is the browser's own documented gotcha, not specific to this script.
// The queue is "a Vue + AG-Grid SPA that re-renders constantly" (see
// CLAUDE.md), almost certainly generating 250+ resource entries during
// ordinary navigation before a user ever reaches a patient's Journal tab —
// plausibly why journal-URL auto-capture never fired in live testing despite
// the page route matching `isOnJournalPage()`. Enlarge the buffer up front,
// and clear it (never lose future entries) if it still fills.
if (typeof performance.setResourceTimingBufferSize === 'function') {
  performance.setResourceTimingBufferSize(2000);
}
if ('onresourcetimingbufferfull' in performance) {
  performance.onresourcetimingbufferfull = () => performance.clearResourceTimings();
}
