// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Dispensing Margin IO helpers

'use strict';

const RXMARGIN_KEYS = ['rxmargin.products', 'rxmargin.config', 'rxmargin.history'];

async function rxmarginExport() {
  const r = await chrome.storage.local.get(RXMARGIN_KEYS);
  return {
    products: r['rxmargin.products'] ?? [],
    config: r['rxmargin.config'] ?? null,
    history: r['rxmargin.history'] ?? [],
  };
}

// Import dispensing-margin data.
// merge=false: replace the product ledger entirely.
// merge=true: append imported products, skipping those with conflicting IDs.
// Returns { conflicts: [{ existing, incoming }] } so the UI can prompt.
async function rxmarginImport(data, { merge = false } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Dispensing-margin data must be an object.');
  if (data.products !== undefined && !Array.isArray(data.products)) {
    throw new Error('rxmargin.products must be an array.');
  }
  data.products?.forEach((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`Product at index ${i} is not an object.`);
    if (!p.id || typeof p.id !== 'string') throw new Error(`Product at index ${i}: id is required.`);
    if (p.suppliers !== undefined && !Array.isArray(p.suppliers)) {
      throw new Error(`Product at index ${i}: suppliers must be an array.`);
    }
  });

  const toSet = {};
  let conflicts = [];

  if (data.products !== undefined) {
    if (merge) {
      const existing = await chrome.storage.local.get('rxmargin.products');
      const existingProducts = existing['rxmargin.products'] || [];
      const existingIds = new Map(existingProducts.map((p) => [p.id, p]));
      const merged = [...existingProducts];
      for (const incoming of data.products) {
        if (existingIds.has(incoming.id)) {
          conflicts.push({ existing: existingIds.get(incoming.id), incoming });
        } else {
          merged.push(incoming);
        }
      }
      toSet['rxmargin.products'] = merged;
    } else {
      toSet['rxmargin.products'] = data.products;
    }
  }

  if (data.config !== undefined && data.config !== null) {
    if (typeof data.config !== 'object') throw new Error('rxmargin.config must be an object.');
    toSet['rxmargin.config'] = data.config;
  }

  if (data.history !== undefined) {
    if (!Array.isArray(data.history)) throw new Error('rxmargin.history must be an array.');
    toSet['rxmargin.history'] = data.history;
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  return { conflicts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { rxmarginExport, rxmarginImport };
}
