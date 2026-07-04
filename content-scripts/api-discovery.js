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
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const PATIENT_UUID_PLACEHOLDER = '__PATIENT_UUID__';

function isOnJournalPage() {
  return /\/care-record\//i.test(location.pathname) && /careRecordTab=journal/i.test(location.search);
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

function storeJournalUrl(url) {
  try {
    const clean = new URL(url).toString();
    // No path-name heuristic here (unlike the listing capture below) — the
    // real journal endpoint path is unknown until observed, so surface every
    // distinct API call made while on the journal tab for manual inspection.
    chrome.storage.local.get(ALL_JOURNAL_URLS_KEY, (r) => {
      const existing = r[ALL_JOURNAL_URLS_KEY] || [];
      if (!existing.includes(clean)) {
        chrome.storage.local.set({ [ALL_JOURNAL_URLS_KEY]: [...existing, clean] });
      }
    });

    const template = templateUrl(clean);
    if (template) {
      chrome.storage.local.get(ALL_JOURNAL_TEMPLATES_KEY, (r) => {
        const existing = r[ALL_JOURNAL_TEMPLATES_KEY] || [];
        if (!existing.includes(template)) {
          chrome.storage.local.set({ [ALL_JOURNAL_TEMPLATES_KEY]: [...existing, template] });
        }
      });
      // Best-guess primary: a UUID-bearing URL whose path also mentions
      // "journal" (or, failing that, the endpoint returning the largest
      // response is left to manual pick via the debug panel).
      if (/journal/i.test(new URL(url).pathname)) {
        chrome.storage.local.set({ [JOURNAL_TEMPLATE_KEY]: template });
      }
    }

    if (/journal/i.test(new URL(url).pathname)) {
      chrome.storage.local.set({ [JOURNAL_KEY]: clean });
    }
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

// Capture resources already loaded before this script ran
performance.getEntriesByType('resource').forEach((e) => storeUrl(e.name));

// Observe future resources (Vue SPA makes API calls after initial load)
const observer = new PerformanceObserver((list) => {
  list.getEntries().forEach((e) => storeUrl(e.name));
});
observer.observe({ entryTypes: ['resource'] });
