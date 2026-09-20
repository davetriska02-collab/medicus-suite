// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — duplicate-checker scan-state TTL helpers.
// Practice identity lists must not sit in chrome.storage indefinitely.
// Dual-mode: module.exports for Node; window.DupCheckerState in the page.

'use strict';

(function () {
  var STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function stateIsFresh(state, nowMs, ttlMs) {
    if (!state || !state.scanDate) return false;
    var t = Date.parse(state.scanDate);
    if (!t) return false;
    var ttl = typeof ttlMs === 'number' ? ttlMs : STATE_TTL_MS;
    return (typeof nowMs === 'number' ? nowMs : Date.now()) - t < ttl;
  }

  var api = { STATE_TTL_MS: STATE_TTL_MS, stateIsFresh: stateIsFresh };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.DupCheckerState = api;
  }
})();
