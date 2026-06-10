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

'use strict';

// Browser: window.ReceptionPathwayUtils (script tag, loaded before this file).
// Node tests: require directly.
const _ReceptionPathUtils =
  (typeof window !== 'undefined' && window.ReceptionPathwayUtils) ||
  (typeof module !== 'undefined' && typeof require === 'function'
    ? require('../reception-pathway-utils.js')
    : null);

const RECEPTION_KEYS = [
  'reception.config',
  'reception.customPathways',
  'reception.pathwayOverrides',
];

async function receptionExport() {
  const r = await chrome.storage.local.get(RECEPTION_KEYS);
  return {
    config:           r['reception.config']           ?? {},
    customPathways:   r['reception.customPathways']   ?? [],
    pathwayOverrides: r['reception.pathwayOverrides'] ?? {},
  };
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function _isFlagMap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.values(v).every(x => typeof x === 'boolean');
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
      clean.enabledPathways = c.enabledPathways;
    }
    if (c.hiddenChipRules !== undefined) {
      if (!_isFlagMap(c.hiddenChipRules)) throw new Error('reception.config.hiddenChipRules must map rule ids to booleans.');
      clean.hiddenChipRules = c.hiddenChipRules;
    }
    if (c.disclaimerAcceptedAt !== undefined && c.disclaimerAcceptedAt !== null) {
      if (typeof c.disclaimerAcceptedAt !== 'string' || !ISO_DATETIME_RE.test(c.disclaimerAcceptedAt)) {
        throw new Error('reception.config.disclaimerAcceptedAt must be null or an ISO datetime string.');
      }
      clean.disclaimerAcceptedAt = c.disclaimerAcceptedAt;
    } else if (c.disclaimerAcceptedAt === null) {
      clean.disclaimerAcceptedAt = null;
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

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { receptionExport, receptionImport, RECEPTION_KEYS };
}
