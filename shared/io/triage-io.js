// Medicus Suite — Triage Lens IO helpers

'use strict';

async function triageExport() {
  const r = await chrome.storage.local.get(['triagelens.config', 'config']);
  // Prefer namespaced key; fall back to legacy key during transition
  const config = r['triagelens.config'] ?? r['config'] ?? {};
  return { config };
}

async function triageImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Triage data must be an object.');
  if (data.config === undefined) throw new Error('Triage data must have a config field.');
  if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('triagelens.config must be an object.');
  }
  await chrome.storage.local.set({ 'triagelens.config': data.config });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { triageExport, triageImport };
}
