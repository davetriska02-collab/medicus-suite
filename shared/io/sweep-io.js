// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep IO (backup/restore support)
//
// Sweep's other storage keys (lastRun, worklist, handout, batchPack) are
// transient / PHI-bearing session state and stay excluded from backups.
// Only the practice's £-per-QOF-point figure is user config.

(function (global) {
  'use strict';

  const QOF_KEY = 'sweep.qofConfig';

  function cleanQofConfig(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rate = Number(raw.poundsPerPoint);
    return { poundsPerPoint: Number.isFinite(rate) && rate > 0 ? rate : null };
  }

  async function sweepExport() {
    const r = await chrome.storage.local.get([QOF_KEY]);
    return {
      qofConfig: cleanQofConfig(r[QOF_KEY]),
    };
  }

  async function sweepImport(data) {
    if (!data || typeof data !== 'object') return;
    if (data.qofConfig === undefined) return;
    const cleaned = cleanQofConfig(data.qofConfig);
    if (cleaned && cleaned.poundsPerPoint != null) {
      await chrome.storage.local.set({ [QOF_KEY]: cleaned });
    } else {
      await chrome.storage.local.remove(QOF_KEY);
    }
  }

  global.sweepExport = sweepExport;
  global.sweepImport = sweepImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sweepExport, sweepImport };
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
