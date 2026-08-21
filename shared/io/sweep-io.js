// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep IO (backup/restore of non-PHI Sweep config)
//
// Only sweep.qofConfig (the practice's £-per-QOF-point figure) is backed up.
// Transient / PHI keys (sweep.lastRun, sweep.handout, sweep.batchPack,
// sweep.worklist) stay on the test-backup-coverage allowlist and must never
// be added here.

(function (global) {
  'use strict';

  const SWEEP_KEYS = ['sweep.qofConfig'];

  function sanitiseQofConfig(raw) {
    if (raw == null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('sweep.qofConfig must be an object or null.');
    }
    const n = Number(raw.poundsPerPoint);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error('sweep.qofConfig.poundsPerPoint must be a positive number.');
    }
    return { poundsPerPoint: n };
  }

  async function sweepExport() {
    const r = await chrome.storage.local.get(SWEEP_KEYS);
    return {
      qofConfig: r['sweep.qofConfig'] ?? null,
    };
  }

  async function sweepImport(data) {
    if (!data || typeof data !== 'object') return;
    if (data.qofConfig === undefined) return;
    const cleaned = sanitiseQofConfig(data.qofConfig);
    if (cleaned == null) {
      await chrome.storage.local.remove('sweep.qofConfig');
      return;
    }
    await chrome.storage.local.set({ 'sweep.qofConfig': cleaned });
  }

  global.sweepExport = sweepExport;
  global.sweepImport = sweepImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sweepExport, sweepImport, sanitiseQofConfig, SWEEP_KEYS };
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
