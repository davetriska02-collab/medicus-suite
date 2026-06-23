// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Triage Lens IO helpers

'use strict';

async function triageExport() {
  const r = await chrome.storage.local.get([
    'triagelens.config',
    'config',
    'triagelens.routineRx',
    'triagelens.taskMacro',
  ]);
  // Prefer namespaced key; fall back to legacy key during transition
  const config = r['triagelens.config'] ?? r['config'] ?? {};
  const out = { config };
  // Routine-prescription button prefs (team list / last team / commit mode).
  if (r['triagelens.routineRx'] !== undefined) out.routineRx = r['triagelens.routineRx'];
  // Prescribing "+ Task" button captured click-path (label / steps / commit mode).
  if (r['triagelens.taskMacro'] !== undefined) out.taskMacro = r['triagelens.taskMacro'];
  return out;
}

async function triageImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Triage data must be an object.');
  if (data.config === undefined) throw new Error('Triage data must have a config field.');
  if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('triagelens.config must be an object.');
  }
  // Skip the write when the backup carries an empty config object — older suite
  // backups always included triage even before users had configured anything,
  // so importing them used to wipe the user's current triage-lens settings.
  if (Object.keys(data.config).length === 0) return;
  await chrome.storage.local.set({ 'triagelens.config': data.config });
  // Restore routine-prescription button prefs when present in the backup.
  if (data.routineRx && typeof data.routineRx === 'object' && !Array.isArray(data.routineRx)) {
    await chrome.storage.local.set({ 'triagelens.routineRx': data.routineRx });
  }
  // Restore the prescribing "+ Task" button click-path when present.
  if (data.taskMacro && typeof data.taskMacro === 'object' && !Array.isArray(data.taskMacro)) {
    await chrome.storage.local.set({ 'triagelens.taskMacro': data.taskMacro });
  }
  // Clean up legacy bare 'config' key from pre-1.x installs, but only if it
  // actually exists — gating prevents removing a key some other module owns.
  const existing = await chrome.storage.local.get('config');
  if (existing.config !== undefined) await chrome.storage.local.remove('config');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { triageExport, triageImport };
}
