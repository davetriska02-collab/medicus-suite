// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Condor IO (backup/restore support)

(function (global) {
  'use strict';

  async function condorExport() {
    const r = await chrome.storage.local.get(['condor.dayScores', 'practice.reportSnapshots', 'condor.indexConfig']);
    return {
      dayScores: r['condor.dayScores'] ?? {},
      reportSnapshots: r['practice.reportSnapshots'] ?? [],
      // Tunable pressure-index weightings/band thresholds (item 8) — { weights,
      // thresholds } or null when the user has never customised them (defaults).
      indexConfig: r['condor.indexConfig'] ?? null,
    };
  }

  async function condorImport(data) {
    if (!data || typeof data !== 'object') return;
    const patch = {};
    if (data.dayScores && typeof data.dayScores === 'object') {
      patch['condor.dayScores'] = data.dayScores;
    }
    // Practice Report daily snapshots (forward-accruing history for the live-only
    // metrics: PPI / waiting room / task age). Array of { date, ppi, band, ... }.
    if (Array.isArray(data.reportSnapshots)) {
      patch['practice.reportSnapshots'] = data.reportSnapshots;
    }
    // Custom pressure-index config (item 8). null/undefined means "use
    // defaults" — only write when the backup actually carries an object, so
    // importing an older backup (no indexConfig field) never clobbers a
    // config the user has already set up locally.
    if (data.indexConfig && typeof data.indexConfig === 'object') {
      patch['condor.indexConfig'] = data.indexConfig;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  }

  global.condorExport = condorExport;
  global.condorImport = condorImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { condorExport, condorImport };
  }
})(typeof window !== 'undefined' ? window : self);
