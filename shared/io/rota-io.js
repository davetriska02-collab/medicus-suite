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
//   rota.access   → passcode-gate config, or null when none was ever set
//
// rota.access holds a PBKDF2 salt + hash, never the passcode itself — but note
// that it does travel in the backup, so restoring a backup restores whatever
// lock it was taken with. The Rota settings page says so in as many words.
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
    'rota.access',
  ];

  // Backup-field name → storage key. Field names mirror rota/shared/store.js.
  const ARRAY_FIELDS = ['staff', 'entries', 'leave', 'rooms', 'swaps', 'audit'];
  const OBJECT_FIELDS = ['demand', 'settings'];

  // Members of rota.settings that the pure engine indexes into without
  // guarding (rules.js does settings.openDays.includes(...) directly). Because
  // settings are loaded as { ...DEFAULT_SETTINGS, ...stored }, a stored null
  // BEATS the default and reaches the engine — so the shapes are checked here.
  // Kept in lock-step with rota/engine/validate.js (the sync-path validator);
  // test-rota-validate.js feeds identical fixtures to both and asserts they
  // agree, so the two copies cannot drift. rota-io.js deliberately keeps its
  // own checks rather than importing the ESM validator — this is a classic
  // script loaded by a bare <script src> and cannot import.
  // rota.access members — kept in the same lock-step with validate.js. salt,
  // hash and iterations are required on a non-null record; a config missing its
  // salt is one no correct passcode can ever unlock.
  const ACCESS_BOOLEAN_FIELDS = ['enabled', 'strict'];
  const ACCESS_STRING_FIELDS = ['kdf', 'hint', 'updatedAt'];

  const SETTINGS_ARRAY_FIELDS = ['openDays', 'bankHolidays', 'sites', 'peakPeriods'];
  const SETTINGS_OBJECT_FIELDS = [
    'dutyRequired',
    'maxSimultaneousLeave',
    'bradfordThresholds',
    'registrarWeights',
    'extraPeriods',
    'demand',
  ];

  const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

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
      access: r['rota.access'] ?? null,
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
        if (!isPlainObject(item)) {
          throw new Error(`${storageKey(field)}[${i}] is not an object.`);
        }
      });
      toSet[storageKey(field)] = data[field];
    }

    for (const field of OBJECT_FIELDS) {
      if (data[field] === undefined) continue;
      if (!isPlainObject(data[field])) {
        throw new Error(`${storageKey(field)} must be an object.`);
      }
      toSet[storageKey(field)] = data[field];
    }

    // rota.access is object-OR-null: null is the real value for "no passcode
    // has ever been set", so it is written through rather than skipped. Mirrors
    // rota/engine/validate.js.
    if (data.access !== undefined) {
      if (data.access === null) {
        toSet['rota.access'] = null;
      } else if (!isPlainObject(data.access)) {
        throw new Error('rota.access must be an object or null.');
      } else {
        const a = data.access;
        if (typeof a.salt !== 'string') throw new Error('rota.access.salt must be a string.');
        if (typeof a.hash !== 'string') throw new Error('rota.access.hash must be a string.');
        if (typeof a.iterations !== 'number' || !Number.isFinite(a.iterations)) {
          throw new Error('rota.access.iterations must be a number.');
        }
        for (const field of ACCESS_BOOLEAN_FIELDS) {
          if (a[field] !== undefined && typeof a[field] !== 'boolean') {
            throw new Error(`rota.access.${field} must be a boolean.`);
          }
        }
        for (const field of ACCESS_STRING_FIELDS) {
          if (a[field] !== undefined && typeof a[field] !== 'string') {
            throw new Error(`rota.access.${field} must be a string.`);
          }
        }
        toSet['rota.access'] = a;
      }
    }

    // rota.demand carries a days map keyed by ISO date — reject an array or a
    // non-object so a malformed backup cannot break the demand views on load.
    if (toSet['rota.demand'] !== undefined) {
      const d = toSet['rota.demand'];
      if (d.days !== undefined && !isPlainObject(d.days)) {
        throw new Error('rota.demand.days must be an object.');
      }
    }

    // rota.settings members the engine dereferences — a null openDays here is
    // a TypeError on every rota render, so it never reaches storage.
    if (toSet['rota.settings'] !== undefined) {
      const s = toSet['rota.settings'];
      for (const field of SETTINGS_ARRAY_FIELDS) {
        if (s[field] !== undefined && !Array.isArray(s[field])) {
          throw new Error(`rota.settings.${field} must be an array.`);
        }
      }
      for (const field of SETTINGS_OBJECT_FIELDS) {
        if (s[field] !== undefined && !isPlainObject(s[field])) {
          throw new Error(`rota.settings.${field} must be an object.`);
        }
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
