// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Slot Counter IO helpers

'use strict';

async function slotCounterExport() {
  const r = await chrome.storage.local.get(['slots.hiddenTypes', 'slots.alertRules', 'slots.pillPrefs']);
  return {
    hiddenTypes: r['slots.hiddenTypes'] ?? [],
    alertRules: r['slots.alertRules'] ?? [],
    pillPrefs: r['slots.pillPrefs'] ?? { order: [], colours: {} },
  };
}

async function slotCounterImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Slot Counter data must be an object.');
  if (data.hiddenTypes !== undefined) {
    if (!Array.isArray(data.hiddenTypes)) throw new Error('slots.hiddenTypes must be an array.');
    await chrome.storage.local.set({ 'slots.hiddenTypes': data.hiddenTypes });
  }
  if (data.alertRules !== undefined) {
    if (!Array.isArray(data.alertRules)) throw new Error('slots.alertRules must be an array.');
    await chrome.storage.local.set({ 'slots.alertRules': data.alertRules });
  }
  if (data.pillPrefs !== undefined) {
    if (!data.pillPrefs || typeof data.pillPrefs !== 'object' || Array.isArray(data.pillPrefs))
      throw new Error('slots.pillPrefs must be an object.');
    await chrome.storage.local.set({ 'slots.pillPrefs': data.pillPrefs });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { slotCounterExport, slotCounterImport };
}
