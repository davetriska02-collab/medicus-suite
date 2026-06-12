// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Quiet Mode helper
//
// Manages suite.quietUntil (epoch ms, absent/0 = off).
// Exposes window.QuietMode = { isQuiet(), set(untilMs), clear() }
// Used by panel.js and service-worker.js to guard intrusive notification channels.
//
// CLINICAL-SAFETY BOUNDARY: Quiet mode silences desktop pop-ups and sounds only.
// It NEVER suppresses on-panel strips, toolbar badge, nav badges, in-module banners,
// or any in-page clinical surfaces (Sentinel chips, Triage Lens HUD).

(function (global) {
  'use strict';

  const KEY = 'suite.quietUntil';

  async function isQuiet() {
    try {
      const r = await chrome.storage.local.get(KEY);
      const until = r[KEY];
      if (!until || typeof until !== 'number' || until <= 0) return false;
      return Date.now() < until;
    } catch (_) {
      return false;
    }
  }

  async function set(untilMs) {
    if (typeof untilMs !== 'number' || untilMs <= 0) {
      await clear();
      return;
    }
    await chrome.storage.local.set({ [KEY]: untilMs });
  }

  async function clear() {
    await chrome.storage.local.remove(KEY);
  }

  const api = { isQuiet, set, clear };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.QuietMode = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
