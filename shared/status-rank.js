// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — STATUS_RANK (single source)
//
// Worst-first chip-status rank. The engine emits these statuses; the
// side-panel ranks/filters the same strings. One table so a new status
// cannot rank 1 in the engine and 99 in the panel (the vax_due class of bug).
//
// Dual-mode (same doctrine as shared/write-core.js):
//   Browser (classic script, load BEFORE rules-engine.js): window.StatusRank
//   Node / test: require('./shared/status-rank.js').STATUS_RANK
//   ESM consumers (sentinel-core): read globalThis.StatusRank after the
//   classic script has loaded (panel.html / pop-out.html).

'use strict';

(function (global) {
  // overdue/not_met/alert: 0 (red, top of the action filter)
  // stale / vax_due: 1
  // due_soon / caution: 2 (action-needed ceiling)
  // no_data / noted / vax_declined: 3
  // recently_initiated: 4
  // achieved / in_date / vax_given: 5 (all-clear)
  const STATUS_RANK = {
    overdue: 0,
    not_met: 0,
    alert: 0,
    stale: 1,
    due_soon: 2,
    caution: 2,
    no_data: 3,
    noted: 3,
    recently_initiated: 4,
    achieved: 5,
    in_date: 5,
    vax_given: 5,
    vax_declined: 3,
    vax_due: 1,
  };

  const api = { STATUS_RANK };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.StatusRank = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
