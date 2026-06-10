// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Knowledge IO helpers
// Exports and imports the Knowledge module storage keys.
//
// Import safety: entries are rendered to all practice staff, so every entry in
// a backup is validated and whitelist-sanitised via KnowledgeUtils before it is
// written — a crafted backup cannot smuggle unknown fields, oversized content
// or non-http(s) links into storage.
//
// config.noticeAcknowledgedAt is intentionally NOT imported: acknowledging the
// "verify before clinical use" notice is a per-install attestation, same rule
// as reception's disclaimerAcceptedAt.

'use strict';

// Browser/service worker: self.KnowledgeUtils (script tag or importScripts, loaded before this file).
// Node tests: require directly.
const _KnowledgeUtils =
  (typeof self !== 'undefined' && self.KnowledgeUtils) ||
  (typeof module !== 'undefined' && typeof require === 'function'
    ? require('../knowledge-utils.js')
    : null);

const KNOWLEDGE_KEYS = [
  'knowledge.items',
  'knowledge.categories',
  'knowledge.config',
];

async function knowledgeExport() {
  const r = await chrome.storage.local.get(KNOWLEDGE_KEYS);
  return {
    items:      r['knowledge.items']      ?? [],
    categories: r['knowledge.categories'] ?? [],
    config:     r['knowledge.config']     ?? {},
  };
}

async function knowledgeImport(data) {
  if (!data || typeof data !== 'object') return;
  const KU = _KnowledgeUtils;
  if (!KU) throw new Error('Knowledge utilities not loaded — cannot validate import.');
  const toSet = {};

  if (data.items !== undefined) {
    if (!Array.isArray(data.items)) throw new Error('knowledge.items must be an array.');
    const cleaned = [];
    const taken = new Set();
    for (const e of data.items) {
      const errs = KU.validateEntry(e);
      if (errs.length > 0) throw new Error(`knowledge.items["${(e && e.title) || '?'}"]: ${errs[0]}`);
      const clean = KU.sanitiseEntry(e);
      if (!clean.id || taken.has(clean.id)) clean.id = KU.generateEntryId(clean.title, taken);
      taken.add(clean.id);
      cleaned.push(clean);
    }
    toSet['knowledge.items'] = cleaned;
  }

  if (data.categories !== undefined) {
    if (!Array.isArray(data.categories)) throw new Error('knowledge.categories must be an array.');
    toSet['knowledge.categories'] = KU.sanitiseCategories(data.categories);
  }

  if (data.config !== undefined) {
    const c = data.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('knowledge.config must be an object.');
    // noticeAcknowledgedAt is intentionally NOT imported (per-install attestation —
    // see header). Nothing else lives in config yet, so we write an empty object
    // rather than dropping the key from the backup round-trip.
    toSet['knowledge.config'] = {};
  }

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { knowledgeExport, knowledgeImport, KNOWLEDGE_KEYS };
}
