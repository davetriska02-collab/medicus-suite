// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — availability wall IO.
// Tile mapping only. No slot payloads, no patient fields.

'use strict';

const AVAILABILITY_KEYS = ['availability.config'];

async function availabilityExport() {
  const r = await chrome.storage.local.get(AVAILABILITY_KEYS);
  return {
    config: r['availability.config'] ?? null,
  };
}

async function availabilityImport(data) {
  if (!data || typeof data !== 'object') throw new Error('Availability data must be an object.');
  if (data.config == null) return;
  if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('availability.config must be an object.');
  }
  await chrome.storage.local.set({ 'availability.config': data.config });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { availabilityExport, availabilityImport, AVAILABILITY_KEYS };
}
