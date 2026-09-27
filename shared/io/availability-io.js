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

async function loadAvailabilityCore() {
  const scripts = typeof document !== 'undefined' ? document.getElementsByTagName('script') : [];
  for (const script of scripts) {
    if (script.src && script.src.includes('availability-io.js')) {
      return import(new URL('../availability-board-core.js', script.src).href);
    }
  }
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
    return import(chrome.runtime.getURL('shared/availability-board-core.js'));
  }
  return import(new URL('../availability-board-core.js', `file://${__dirname}/`).href);
}

async function availabilityImport(data) {
  if (!data || typeof data !== 'object') throw new Error('Availability data must be an object.');
  if (data.config == null) return;
  if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('availability.config must be an object.');
  }
  const core = await loadAvailabilityCore();
  const config = core.normaliseConfig(data.config);
  await chrome.storage.local.set({ 'availability.config': config });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { availabilityExport, availabilityImport, AVAILABILITY_KEYS };
}
