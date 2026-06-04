// Medicus Suite — Practice Code Resolver
//
// Resolves the practice's Medicus site ID (e.g. "a3f2b1") needed to build
// API endpoint URLs. Resolution order:
//
//   1. Auto-detect from the URL of any open Medicus tab (most reliable — no
//      user input required; can't be wrong unless Medicus changes their URL
//      structure, which we'd notice immediately).
//
//   2. Fall back to the value in chrome.storage.local['suite.practiceCode']
//      (used when no Medicus tab is open — popup, background state, etc.).
//
// Callers MUST handle a null return value gracefully. A null return means no
// Medicus tab is open AND no code has been saved to Options.

(function(global) {
  'use strict';

  const STORAGE_KEY = 'suite.practiceCode';
  // Matches the short hex site ID in Medicus URLs:
  // https://england.medicus.health/a3f2b1/patient/...
  const SITE_CODE_RE = /england\.medicus\.health\/([a-f0-9]{4,8})\//i;

  let _cachedFromStorage = null;   // last value read from storage
  let _lastSource = null;          // 'tab' | 'storage' | null  — for diagnostics
  let _watchersBound = false;
  const _listeners = [];

  // ── Auto-detect from open Medicus tab ───────────────────────────────────────

  async function detectFromTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs) return null;
    try {
      // Find any Medicus tab in any window (not just the current window, so
      // the side panel can detect it even when opened in a different window).
      const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
      for (const tab of tabs) {
        const m = tab.url && tab.url.match(SITE_CODE_RE);
        if (m && m[1]) {
          return m[1].toLowerCase();
        }
      }
    } catch (e) {
      // Tabs API not available in this context (e.g. content script) — ignore.
    }
    return null;
  }

  // ── Storage fallback ────────────────────────────────────────────────────────

  async function getFromStorage() {
    if (_cachedFromStorage !== null) return _cachedFromStorage;
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      _cachedFromStorage = r[STORAGE_KEY] || null;
      _bindWatcher();
      return _cachedFromStorage;
    } catch (e) {
      return null;
    }
  }

  // ── Main resolver ────────────────────────────────────────────────────────────

  async function getPracticeCode() {
    const fromTab = await detectFromTab();
    if (fromTab) {
      if (fromTab !== _cachedFromStorage) {
        _cachedFromStorage = fromTab;
        chrome.storage.local.set({ [STORAGE_KEY]: fromTab }).catch(() => {});
      }
      _lastSource = 'tab';
      return fromTab;
    }
    const fromStorage = await getFromStorage();
    _lastSource = fromStorage ? 'storage' : null;
    return fromStorage;
  }

  // Returns the source of the most recently resolved code: 'tab' | 'storage' | null
  function getLastSource() { return _lastSource; }

  // Resolve + return both code and source in one call.
  // { code: string|null, source: 'tab'|'storage'|null }
  async function resolve() {
    const code = await getPracticeCode();
    return { code, source: _lastSource };
  }

  // Synchronous accessor — only valid AFTER at least one getPracticeCode() call.
  function getPracticeCodeSync() {
    return _cachedFromStorage;
  }

  // Compute the API base URL for a given practice code.
  function apiBaseFor(code) {
    if (!code) return null;
    return `https://${code}.api.england.medicus.health`;
  }

  // Register a callback fired when the stored code changes.
  function onPracticeCodeChange(cb) {
    _listeners.push(cb);
    _bindWatcher();
  }

  function _bindWatcher() {
    if (_watchersBound) return;
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    _watchersBound = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      _cachedFromStorage = changes[STORAGE_KEY].newValue || null;
      _listeners.forEach(cb => { try { cb(_cachedFromStorage); } catch (e) {} });
    });
  }

  // ── Practice code format validator (F8) ─────────────────────────────────────
  // Exported so other modules can reuse the same pattern without duplicating it.
  // Matches the 4–8 hex-char site ID extracted from Medicus URLs.
  // Use this instead of hand-rolling a local regex — a single definition here
  // prevents the pattern from drifting across files over time.
  const SITE_CODE_RE_EXPORT = /^[a-f0-9]{4,8}$/i;

  function isValidPracticeCode(code) {
    return typeof code === 'string' && SITE_CODE_RE_EXPORT.test(code);
  }

  const api = {
    getPracticeCode, getPracticeCodeSync, getLastSource, resolve, apiBaseFor,
    onPracticeCodeChange, detectFromTab,
    // F8: exported for use by fetch-URL-building modules
    SITE_CODE_RE: SITE_CODE_RE_EXPORT,
    isValidPracticeCode,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.PracticeCode = api;
  }
})(typeof window !== 'undefined' ? window : global);
