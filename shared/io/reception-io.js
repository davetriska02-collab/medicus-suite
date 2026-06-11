// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception IO helpers
// Exports and imports the Reception module storage keys.
//
// Import safety: pathway content is rendered to reception staff and the
// enable flags switch clinical-adjacent capture pathways on — a crafted
// backup must not be able to smuggle malformed pathways or silently enable
// anything. Every pathway is validated and whitelist-sanitised via
// ReceptionPathwayUtils, and previewEnvelope() in suite-envelope.js warns
// when a backup enables pathways.
//
// disclaimerAcceptedAt is intentionally NOT imported: acceptance is a
// per-install attestation set only when a local admin clicks "Accept" in the
// Options UI. A backup carrying a foreign acceptance timestamp must never
// unlock pathways on a different install automatically. Export may still
// include it to reflect local state, but import silently ignores it.

'use strict';

// Browser/service worker: self.ReceptionPathwayUtils (script tag or importScripts, loaded before this file).
// Node tests: require directly.
const _ReceptionPathUtils =
  (typeof self !== 'undefined' && self.ReceptionPathwayUtils) ||
  (typeof module !== 'undefined' && typeof require === 'function'
    ? require('../reception-pathway-utils.js')
    : null);

// Pathway and rule IDs must match this shape (same as ID_RE in reception-pathway-utils.js).
// Defined locally so reception-io.js can be used without importing pathway-utils in contexts
// where it hasn't been loaded yet (defence-in-depth: the flag-map check runs before
// validatePathway so the regex must be available independently).
const _FLAG_KEY_RE = /^[a-z0-9][a-z0-9-]{0,49}$/i;

const RECEPTION_KEYS = [
  'reception.config',
  'reception.customPathways',
  'reception.pathwayOverrides',
  'reception.tilePrefs',
];

async function receptionExport() {
  const r = await chrome.storage.local.get(RECEPTION_KEYS);
  return {
    config:           r['reception.config']           ?? {},
    customPathways:   r['reception.customPathways']   ?? [],
    pathwayOverrides: r['reception.pathwayOverrides'] ?? {},
    tilePrefs:        r['reception.tilePrefs']        ?? {},
  };
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function _isFlagMap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every(x => typeof x === 'boolean');
}

// Reject a flag map whose keys don't all conform to the pathway/rule id shape.
// Defence-in-depth: prevents prototype-pollution via __proto__ or similar keys.
// Throws a descriptive error consistent with the other import validators.
function _assertFlagMapKeys(v, label) {
  for (const k of Object.keys(v)) {
    if (!_FLAG_KEY_RE.test(k)) {
      throw new Error(`${label} contains an invalid key "${k}" (keys must match [a-z0-9][a-z0-9-]{0,49}).`);
    }
  }
}

async function receptionImport(data) {
  if (!data || typeof data !== 'object') return;
  const PU = _ReceptionPathUtils;
  if (!PU) throw new Error('Reception pathway utilities not loaded — cannot validate import.');
  const toSet = {};

  if (data.config !== undefined) {
    const c = data.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new Error('reception.config must be an object.');
    }
    const clean = {};
    if (c.enabledPathways !== undefined) {
      if (!_isFlagMap(c.enabledPathways)) throw new Error('reception.config.enabledPathways must map pathway ids to booleans.');
      _assertFlagMapKeys(c.enabledPathways, 'reception.config.enabledPathways');
      clean.enabledPathways = c.enabledPathways;
    }
    if (c.hiddenChipRules !== undefined) {
      if (!_isFlagMap(c.hiddenChipRules)) throw new Error('reception.config.hiddenChipRules must map rule ids to booleans.');
      _assertFlagMapKeys(c.hiddenChipRules, 'reception.config.hiddenChipRules');
      clean.hiddenChipRules = c.hiddenChipRules;
    }
    // disclaimerAcceptedAt is intentionally NOT imported: acceptance is a per-install
    // attestation that must only be set when a local admin explicitly clicks "Accept"
    // in the Options UI. A backup carrying a foreign timestamp must not unlock pathways
    // on a different install. Any value present in the backup is silently ignored here.
    // Validation errors for clearly-malformed values are still raised to surface crafted
    // backups early, but the field is never written to storage by this function.
    if (c.disclaimerAcceptedAt !== undefined && c.disclaimerAcceptedAt !== null) {
      if (typeof c.disclaimerAcceptedAt !== 'string' || !ISO_DATETIME_RE.test(c.disclaimerAcceptedAt)) {
        throw new Error('reception.config.disclaimerAcceptedAt must be null or an ISO datetime string.');
      }
      // Intentionally not written: clean.disclaimerAcceptedAt is omitted.
    }
    toSet['reception.config'] = clean;
  }

  if (data.customPathways !== undefined) {
    if (!Array.isArray(data.customPathways)) throw new Error('reception.customPathways must be an array.');
    const cleaned = [];
    for (const p of data.customPathways) {
      const errs = PU.validatePathway(p);
      if (errs.length > 0) {
        throw new Error(`reception.customPathways["${(p && p.id) || '?'}"]: ${errs[0]}`);
      }
      cleaned.push(PU.sanitisePathway(p));
    }
    toSet['reception.customPathways'] = cleaned;
  }

  if (data.pathwayOverrides !== undefined) {
    const ov = data.pathwayOverrides;
    if (!ov || typeof ov !== 'object' || Array.isArray(ov)) {
      throw new Error('reception.pathwayOverrides must be an object keyed by pathway id.');
    }
    const cleaned = {};
    for (const [id, p] of Object.entries(ov)) {
      const errs = PU.validatePathway(p);
      if (errs.length > 0) throw new Error(`reception.pathwayOverrides["${id}"]: ${errs[0]}`);
      if (p.id !== id) throw new Error(`reception.pathwayOverrides["${id}"]: pathway id mismatch ("${p.id}").`);
      cleaned[id] = PU.sanitisePathway(p);
    }
    toSet['reception.pathwayOverrides'] = cleaned;
  }

  if (data.tilePrefs !== undefined) {
    const tp = data.tilePrefs;
    if (tp !== null && (typeof tp !== 'object' || Array.isArray(tp))) {
      throw new Error('reception.tilePrefs must be an object.');
    }
    // Organising-only display prefs (tile colour / order / sort). sanitiseTilePrefs
    // builds a fresh object — dropping unknown sort modes, non-id-shaped keys
    // (prototype-pollution defence), and invalid colour keys.
    toSet['reception.tilePrefs'] = PU.sanitiseTilePrefs(tp || {});
  }

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { receptionExport, receptionImport, RECEPTION_KEYS };
}
