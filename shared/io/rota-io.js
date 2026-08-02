// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Rota IO (backup/restore support)
//
// Covers every chrome.storage.local key owned by the ported Rota Manager
// subtree (rota/). The authoritative list lives in rota/shared/store.js KEYS;
// test-rota-store.js asserts set-equality between that literal and ROTA_KEYS
// here, so a new rota.* key cannot silently escape suite backups.
//
// Deliberately does NOT wrap rota/shared/store.js: that file is an ES module
// (rota/package.json sets "type":"module") and emits its own standalone
// "medicus-rota-manager" envelope. This file is a CLASSIC script — it is loaded
// via a bare <script src> in options/options.html and require()d by tests, so
// it must not use import/export.
//
// Shapes (see rota/shared/model.js):
//   rota.staff / entries / leave / rooms / swaps / audit → arrays
//   rota.demand   → { days: {…}, pulledAt: '' }
//   rota.settings → plain object (merged over DEFAULT_SETTINGS on load)
//
// No PHI is persisted by the rota product, so nothing here is patient data.

(function (global) {
  'use strict';

  const ROTA_KEYS = [
    'rota.staff',
    'rota.entries',
    'rota.leave',
    'rota.rooms',
    'rota.swaps',
    'rota.audit',
    'rota.demand',
    'rota.settings',
  ];

  // Backup-field name → storage key. Field names mirror rota/shared/store.js.
  const ARRAY_FIELDS = ['staff', 'entries', 'leave', 'rooms', 'swaps', 'audit'];
  const OBJECT_FIELDS = ['demand', 'settings'];

  const storageKey = (field) => `rota.${field}`;

  async function rotaExport() {
    const r = await chrome.storage.local.get(ROTA_KEYS);
    return {
      staff: r['rota.staff'] ?? [],
      entries: r['rota.entries'] ?? [],
      leave: r['rota.leave'] ?? [],
      rooms: r['rota.rooms'] ?? [],
      swaps: r['rota.swaps'] ?? [],
      audit: r['rota.audit'] ?? [],
      demand: r['rota.demand'] ?? { days: {}, pulledAt: '' },
      settings: r['rota.settings'] ?? {},
    };
  }

  async function rotaImport(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Rota data must be an object.');
    }
    const toSet = {};

    for (const field of ARRAY_FIELDS) {
      if (data[field] === undefined) continue;
      if (!Array.isArray(data[field])) {
        throw new Error(`${storageKey(field)} must be an array.`);
      }
      data[field].forEach((item, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`${storageKey(field)}[${i}] is not an object.`);
        }
      });
      toSet[storageKey(field)] = data[field];
    }

    for (const field of OBJECT_FIELDS) {
      if (data[field] === undefined) continue;
      if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) {
        throw new Error(`${storageKey(field)} must be an object.`);
      }
      toSet[storageKey(field)] = data[field];
    }

    // rota.demand carries a days map keyed by ISO date — reject an array or a
    // non-object so a malformed backup cannot break the demand views on load.
    if (toSet['rota.demand'] !== undefined) {
      const d = toSet['rota.demand'];
      if (d.days !== undefined && (!d.days || typeof d.days !== 'object' || Array.isArray(d.days))) {
        throw new Error('rota.demand.days must be an object.');
      }
    }

    if (Object.keys(toSet).length > 0) {
      await chrome.storage.local.set(toSet);
    }
  }

  global.ROTA_KEYS = ROTA_KEYS;
  global.rotaExport = rotaExport;
  global.rotaImport = rotaImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { rotaExport, rotaImport, ROTA_KEYS };
  }
  // Note: unlike notifications-io.js this falls back to globalThis rather than
  // bare `self`, because test-rota-store.js require()s this file in Node, where
  // `self` is undefined.
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
