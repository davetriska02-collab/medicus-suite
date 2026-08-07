// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Triage Lens IO helpers

'use strict';

async function triageExport() {
  const r = await chrome.storage.local.get([
    'triagelens.config',
    'config',
    'triagelens.routineRx',
    'triagelens.quickActions',
  ]);
  // Prefer namespaced key; fall back to legacy key during transition
  const config = r['triagelens.config'] ?? r['config'] ?? {};
  const out = { config };
  // Routine-prescription button prefs (team list / last team / commit mode).
  if (r['triagelens.routineRx'] !== undefined) out.routineRx = r['triagelens.routineRx'];
  // GP → reception quick-actions composer lists (actions / who / when / fallbacks).
  if (r['triagelens.quickActions'] !== undefined) out.quickActions = r['triagelens.quickActions'];
  return out;
}

async function triageImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Triage data must be an object.');
  if (data.config === undefined) throw new Error('Triage data must have a config field.');
  if (typeof data.config !== 'object' || Array.isArray(data.config)) {
    throw new Error('triagelens.config must be an object.');
  }
  // Skip the CONFIG write when the backup carries an empty config object —
  // older suite backups always included triage even before users had
  // configured anything, so importing them used to wipe the user's current
  // triage-lens settings. Only the config write is skipped (audit M18,
  // 2026-07-18: this used to be an early `return` that ALSO silently dropped
  // the routineRx restore below).
  if (Object.keys(data.config).length > 0) {
    await chrome.storage.local.set({ 'triagelens.config': data.config });
  }
  // Restore routine-prescription button prefs when present in the backup.
  if (data.routineRx && typeof data.routineRx === 'object' && !Array.isArray(data.routineRx)) {
    await chrome.storage.local.set({ 'triagelens.routineRx': data.routineRx });
  }
  // Restore the quick-actions composer lists when present in the backup.
  if (data.quickActions && typeof data.quickActions === 'object' && !Array.isArray(data.quickActions)) {
    await chrome.storage.local.set({ 'triagelens.quickActions': data.quickActions });
  }
  // Clean up legacy bare 'config' key from pre-1.x installs, but only if it
  // actually exists — gating prevents removing a key some other module owns.
  const existing = await chrome.storage.local.get('config');
  if (existing.config !== undefined) await chrome.storage.local.remove('config');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { triageExport, triageImport };
}
