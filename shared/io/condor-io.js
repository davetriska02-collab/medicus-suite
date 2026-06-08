// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Condor IO (backup/restore support)

(function(global) {
  'use strict';

  async function condorExport() {
    const r = await chrome.storage.local.get('condor.dayScores');
    return { dayScores: r['condor.dayScores'] ?? {} };
  }

  async function condorImport(data) {
    if (!data || typeof data !== 'object') return;
    const patch = {};
    if (data.dayScores && typeof data.dayScores === 'object') {
      patch['condor.dayScores'] = data.dayScores;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  }

  global.condorExport = condorExport;
  global.condorImport = condorImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { condorExport, condorImport };
  }
})(typeof window !== 'undefined' ? window : self);
