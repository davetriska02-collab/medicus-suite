// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Phrases IO helpers
// Exports and imports the Phrases module storage keys.
//
// Import safety: blocks are rendered on the tab and their bodies end up in
// patient-facing messages, so every block in a backup is validated and
// whitelist-sanitised via PhrasesCore before it is written — a crafted backup
// cannot smuggle unknown fields, oversized content, non-https leaflet links
// or prototype-polluting usage keys into storage.
//
// Usage counts ARE imported (they are ordering preferences, not attestations
// and not patient data) — sanitiseConfig clamps them.

'use strict';

// Browser: window.PhrasesCore (script tag, loaded before this file in
// options.html). Node tests: require directly.
const _PhrasesCore =
  (typeof self !== 'undefined' && self.PhrasesCore) ||
  (typeof module !== 'undefined' && typeof require === 'function' ? require('../phrases-core.js') : null);

const PHRASES_KEYS = ['phrases.items', 'phrases.config'];

async function phrasesExport() {
  const r = await chrome.storage.local.get(PHRASES_KEYS);
  return {
    items: r['phrases.items'] ?? [],
    config: r['phrases.config'] ?? {},
  };
}

async function phrasesImport(data) {
  if (!data || typeof data !== 'object') return;
  const PC = _PhrasesCore;
  if (!PC) throw new Error('Phrases core not loaded — cannot validate import.');
  const toSet = {};

  if (data.items !== undefined) {
    if (!Array.isArray(data.items)) throw new Error('phrases.items must be an array.');
    const cleaned = [];
    // Seed the taken set from the incoming practice tier so a restored backup
    // cannot land the same id in both tiers — a cross-tier collision makes the
    // audience tag and the copied body disagree (Opus review finding 2).
    const taken = new Set(
      data.config && Array.isArray(data.config.practiceBlocks)
        ? data.config.practiceBlocks.map((b) => b && b.id).filter(Boolean)
        : []
    );
    for (const b of data.items) {
      const errs = PC.validateBlock(b);
      if (errs.length > 0) throw new Error(`phrases.items["${(b && b.title) || '?'}"]: ${errs[0]}`);
      const clean = PC.sanitiseBlock(b);
      if (!clean.id || taken.has(clean.id)) clean.id = PC.generateBlockId(clean.title, taken);
      taken.add(clean.id);
      cleaned.push(clean);
      if (cleaned.length >= PC.PH_LIMITS.blocks) break;
    }
    toSet['phrases.items'] = cleaned;
  }

  if (data.config !== undefined) {
    const c = data.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('phrases.config must be an object.');
    // sanitiseConfig never throws and whitelist-copies every field, including
    // per-block validation of practiceBlocks and tombstone/usage clamping.
    toSet['phrases.config'] = PC.sanitiseConfig(c);
  }

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { phrasesExport, phrasesImport, PHRASES_KEYS };
}
