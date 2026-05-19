// Medicus Suite — Slot Counter IO helpers

'use strict';

async function slotCounterExport() {
  const r = await chrome.storage.local.get(['slots.hiddenTypes']);
  return { hiddenTypes: r['slots.hiddenTypes'] ?? [] };
}

async function slotCounterImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Slot Counter data must be an object.');
  if (data.hiddenTypes !== undefined) {
    if (!Array.isArray(data.hiddenTypes)) throw new Error('slots.hiddenTypes must be an array.');
    await chrome.storage.local.set({ 'slots.hiddenTypes': data.hiddenTypes });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { slotCounterExport, slotCounterImport };
}
