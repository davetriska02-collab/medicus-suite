// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — CQC Inspection Readiness IO (backup/restore support)
//
// Practice-entered recon worksheet counts and the last saved readiness
// baseline. Built from shipped rule data + the practice's own typed figures
// — no patient-identifiable data (see H-033).

(function (global) {
  'use strict';

  const ANCHOR_KEY = 'cqc.readiness.anchor';
  const COUNTS_KEY = 'cqc.recon.counts';

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  async function cqcExport() {
    const r = await chrome.storage.local.get([ANCHOR_KEY, COUNTS_KEY]);
    return {
      readinessAnchor: r[ANCHOR_KEY] ?? null,
      reconCounts: r[COUNTS_KEY] ?? null,
    };
  }

  async function cqcImport(data) {
    if (!data || typeof data !== 'object') return;
    const patch = {};
    if (data.readinessAnchor != null) {
      if (!isPlainObject(data.readinessAnchor)) {
        throw new Error('cqc.readiness.anchor must be an object.');
      }
      patch[ANCHOR_KEY] = data.readinessAnchor;
    }
    if (data.reconCounts != null) {
      if (!isPlainObject(data.reconCounts)) {
        throw new Error('cqc.recon.counts must be an object.');
      }
      patch[COUNTS_KEY] = data.reconCounts;
    }
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  }

  global.cqcExport = cqcExport;
  global.cqcImport = cqcImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { cqcExport, cqcImport };
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
