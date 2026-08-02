// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Transactional-feed shadow summary
//
// Thin, pure wrapper around shared/shadow-compare.js's diffChips(), purpose-
// built for the hybrid-mode "shadow" comparison: the SAME rule engine run
// against the currently-DISPLAYED (session) bundle and the shadow
// Transactional-API bundle fetched concurrently (see engine/data-fetcher.js
// fetchHybrid / debug.txnShadow). Exists so content-scripts/sentinel.js's own
// change can stay thin — "is this parity, and what does the status line say"
// lives here, unit-tested directly (test-txn-shadow-status.js).
//
// This module never touches chrome.* or the DOM — pure functions only.

(function (global) {
  'use strict';

  function getShadowCompare() {
    if (typeof module !== 'undefined' && module.exports) {
      return require('./shadow-compare.js');
    }
    return global.SentinelShadowCompare;
  }

  /**
   * Diff the chips computed for the displayed (session) bundle against the
   * chips computed for the shadow Transactional-API bundle, using the SAME
   * rules/options for both evaluations (caller's responsibility).
   *
   * Returns:
   *   { parity: true }
   *   { parity: false, added, missing, severityChange, regressions, counts, safe, count }
   *
   * `missing`        — shown on screen now, but absent from the API shadow
   *                     (would be silently dropped if the API feed went live).
   * `added`          — would appear under the API feed but isn't shown now.
   * `severityChange` — the same alert, but a different status under the two
   *                     feeds (shadow-compare's "flips").
   * `count`          — total differing rule keys (missing + added + severityChange),
   *                     the number the status-line suffix reports.
   */
  function summariseShadow(input) {
    const opts = input || {};
    const SC = getShadowCompare();
    if (!SC || typeof SC.diffChips !== 'function') return { parity: true };
    const r = SC.diffChips(opts.displayedChips || [], opts.shadowChips || []);
    const count = (r.counts.dropped || 0) + (r.counts.added || 0) + (r.counts.flips || 0);
    if (count === 0) return { parity: true };
    return {
      parity: false,
      added: r.added,
      missing: r.dropped,
      severityChange: r.flips,
      regressions: r.regressions,
      counts: r.counts,
      safe: r.safe,
      count,
    };
  }

  /**
   * Build the exact status-line suffix for a given shadow/fallback state.
   *   { kind: 'parity' }               -> ' · API shadow: parity'
   *   { kind: 'divergence', count: N } -> ' · API shadow: N difference(s)'
   *   { kind: 'unavailable' }          -> ' · API shadow: unavailable'
   *   { kind: 'error' }                -> ' · API shadow: error'
   *   { kind: 'fallback' }             -> ' · API feed unavailable — using session data'
   * Anything else (missing/unknown kind) -> '' (append nothing).
   */
  function buildStatusSuffix(state) {
    const s = state || {};
    switch (s.kind) {
      case 'parity':
        return ' · API shadow: parity';
      case 'divergence':
        return ` · API shadow: ${s.count} difference(s)`;
      case 'unavailable':
        return ' · API shadow: unavailable';
      case 'error':
        return ' · API shadow: error';
      case 'fallback':
        return ' · API feed unavailable — using session data';
      default:
        return '';
    }
  }

  const api = { summariseShadow, buildStatusSuffix };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnShadowSummary = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
