// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Lab Results Auto-Filing IO helpers
// Exports and imports the Lab Filing module storage keys.
//
// Import safety: a filing profile drives an IRREVERSIBLE write to the patient
// record, so every profile in a backup is validated and whitelist-sanitised via
// LabFilingUtils, and FORCED INERT on import — enabled:false, reviewed:false,
// patientMessage off — exactly like Sentinel's custom-rule import. A crafted
// backup can neither smuggle unknown fields nor arrive already armed. The
// commitMode is clamped to manual|confirm (never 'auto').
//
// labfiling.auditLog is intentionally NOT imported: it is a machine-local
// governance record of what was filed on this device (same rule as the OIR audit
// log). config.noticeAcknowledgedAt is also NOT imported: acknowledging the
// "verify before clinical use" notice is a per-install attestation.

'use strict';

// Browser/service worker: self.LabFilingUtils (script tag, loaded before this file).
// Node tests: require directly.
const _LabFilingUtils =
  (typeof self !== 'undefined' && self.LabFilingUtils) ||
  (typeof module !== 'undefined' && typeof require === 'function' ? require('../lab-filing-utils.js') : null);

const LABFILING_KEYS = ['labfiling.profiles', 'labfiling.config', 'labfiling.auditLog'];

const _DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Shallow clone of own enumerable keys only, skipping prototype-pollution keys.
// Never assigns to "__proto__", so the JS engine's prototype setter is never
// triggered (which is what taints a {...p}/Object.assign clone of a JSON-parsed
// object carrying an own "__proto__" key). Nested objects are kept by reference —
// safe here because validateProfile/sanitiseProfile read nested fields by name and
// never copy a nested object wholesale.
function _safeClone(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  const out = {};
  for (const k of Object.keys(o)) {
    if (_DANGEROUS_KEYS.has(k)) continue;
    out[k] = o[k];
  }
  return out;
}

async function labfilingExport() {
  const r = await chrome.storage.local.get(LABFILING_KEYS);
  return {
    profiles: r['labfiling.profiles'] ?? [],
    config: r['labfiling.config'] ?? {},
    // auditLog deliberately omitted — machine-local governance record.
  };
}

async function labfilingImport(data) {
  if (!data || typeof data !== 'object') return;
  const LF = _LabFilingUtils;
  if (!LF) throw new Error('Lab Filing utilities not loaded — cannot validate import.');
  const toSet = {};

  if (data.profiles !== undefined) {
    if (!Array.isArray(data.profiles)) throw new Error('labfiling.profiles must be an array.');
    const cleaned = [];
    const taken = new Set();
    for (const p of data.profiles) {
      // Work on an OWN-KEYS-ONLY clone so we never mutate the caller's backup and
      // never carry attacker-controlled prototype pollution. A JSON-parsed backup
      // can have an own "__proto__" key; Object.assign/{...p} would invoke its
      // setter and taint the clone's prototype, so enabled/reviewed could read true
      // via inheritance. _safeClone copies only own enumerable keys, skipping
      // __proto__/constructor/prototype, and never triggers the prototype setter.
      const pre = _safeClone(p);
      // Clamp an out-of-range commitMode rather than failing the whole restore — a
      // backup must never arm full-auto, but one stray value shouldn't abort a
      // suite-wide restore (sanitise defaults the dropped field to 'manual'). After
      // _safeClone, commitMode (if present) is an OWN key, so delete is effective.
      if (
        pre &&
        typeof pre === 'object' &&
        Object.prototype.hasOwnProperty.call(pre, 'commitMode') &&
        !LF.LF_COMMIT_MODES.includes(pre.commitMode)
      ) {
        delete pre.commitMode;
      }
      const errs = LF.validateProfile(pre);
      if (errs.length > 0) throw new Error(`labfiling.profiles["${(pre && pre.name) || '?'}"]: ${errs[0]}`);
      // Force inert: imported profiles arrive disabled, unreviewed, message off.
      const clean = LF.lockForReview(pre, 'import');
      if (!clean.id || taken.has(clean.id)) clean.id = LF.generateProfileId(clean.name, taken);
      taken.add(clean.id);
      cleaned.push(clean);
    }
    toSet['labfiling.profiles'] = cleaned;
  }

  if (data.config !== undefined) {
    const c = data.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('labfiling.config must be an object.');
    // Only commitMode round-trips; noticeAcknowledgedAt is a per-install attestation.
    const commitMode = LF.LF_COMMIT_MODES.includes(c.commitMode) ? c.commitMode : 'manual';
    toSet['labfiling.config'] = { commitMode };
  }

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { labfilingExport, labfilingImport, LABFILING_KEYS };
}
