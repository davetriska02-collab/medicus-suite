// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Document Lens IO helpers
// Exports and imports the Document Lens module storage key (documentLensConfig).
//
// The config is two practice-level booleans. `enabled` round-trips as-is.
// `sensitiveGate` (hazard H-F: withhold the card on documents Medicus marks
// hidden-from-patient-facing-services) defaults ON: only an explicit `false`
// in the backup turns it off — a missing/garbled field restores to gated.

'use strict';

const DOCUMENT_LENS_KEYS = ['documentLensConfig'];

async function documentLensExport() {
  const r = await chrome.storage.local.get(DOCUMENT_LENS_KEYS);
  const cfg = r['documentLensConfig'] || {};
  return {
    config: {
      enabled: cfg.enabled === true,
      sensitiveGate: cfg.sensitiveGate !== false,
    },
  };
}

async function documentLensImport(data) {
  if (!data || typeof data !== 'object') return;
  if (data.config === undefined) return;
  const c = data.config;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('documentLens.config must be an object.');
  await chrome.storage.local.set({
    documentLensConfig: {
      enabled: c.enabled === true,
      sensitiveGate: c.sensitiveGate !== false,
    },
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { documentLensExport, documentLensImport, DOCUMENT_LENS_KEYS };
}
