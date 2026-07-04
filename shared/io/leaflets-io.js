// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — NHS Patient Leaflets IO helpers
// Exports and imports the Leaflets module storage keys.
//
// SECRET HANDLING — leaflets.config.apiKey is NEVER exported and NEVER
// overwritten by import: the NHS Website Content API key is a per-install
// secret (same doctrine as any credential), not something that should ride a
// suite backup file that might be shared, emailed or committed by mistake.
//   - leafletsExport() reports only `config.enabled`; the apiKey field is
//     simply absent from the returned object.
//   - leafletsImport() reads the CURRENT local config first and merges only
//     `enabled` onto it, so an existing apiKey on this machine survives an
//     import untouched. A crafted/foreign backup containing an `apiKey` field
//     is silently ignored (never written) rather than erroring, so a normal
//     suite-wide restore does not fail because of a field it must not use.
// See test-leaflets-io.js "API key excluded from export" / "import never
// writes apiKey" for the regression guards on both halves of this.

'use strict';

const LEAFLETS_KEYS = ['leaflets.recent', 'leaflets.config'];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECENT_MAX = 10;
const RECENT_NAME_MAX = 120;

async function leafletsExport() {
  const r = await chrome.storage.local.get(LEAFLETS_KEYS);
  const config = r['leaflets.config'] || {};
  return {
    recent: Array.isArray(r['leaflets.recent']) ? r['leaflets.recent'] : [],
    // apiKey deliberately EXCLUDED — see header note.
    config: { enabled: config.enabled === true },
  };
}

async function leafletsImport(data) {
  if (!data || typeof data !== 'object') return;
  const toSet = {};

  if (data.recent !== undefined) {
    if (!Array.isArray(data.recent)) throw new Error('leaflets.recent must be an array.');
    const cleaned = [];
    for (const item of data.recent) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('leaflets.recent entries must be objects.');
      }
      if (typeof item.slug !== 'string' || !SLUG_RE.test(item.slug)) {
        throw new Error(`leaflets.recent: invalid slug "${item.slug}".`);
      }
      if (typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error('leaflets.recent: name is required.');
      }
      cleaned.push({
        slug: item.slug,
        name: item.name.trim().slice(0, RECENT_NAME_MAX),
        kind: item.kind === 'medicine' ? 'medicine' : 'condition',
        openedAt: typeof item.openedAt === 'string' && item.openedAt ? item.openedAt : new Date().toISOString(),
      });
    }
    toSet['leaflets.recent'] = cleaned.slice(0, RECENT_MAX);
  }

  if (data.config !== undefined) {
    const c = data.config;
    if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('leaflets.config must be an object.');
    // Merge onto the CURRENT local config so an existing apiKey on this
    // machine is never touched by an import. apiKey in the incoming data (if
    // a foreign/crafted backup carries one) is intentionally never read.
    const existing = await chrome.storage.local.get('leaflets.config');
    const current = existing['leaflets.config'] || {};
    toSet['leaflets.config'] = { ...current, enabled: c.enabled === true };
  }

  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { leafletsExport, leafletsImport, LEAFLETS_KEYS };
}
