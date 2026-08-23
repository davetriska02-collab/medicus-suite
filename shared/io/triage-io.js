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

// Sanitise an imported triage config before it is written (2026-08-22
// clinical-safety audit): NEVER trust the backup's `version` integer. The
// shipped-defaults migration (content.js/options.js mergeShippedDefaults) only
// runs when the SHIPPED defaults version exceeds the stored one — so an import
// carrying an inflated version (crafted, or from a newer install restored onto
// an older one) would permanently strand this machine off every future shipped
// rule/threshold/chip migration, silently. Dropping the key is safe and
// self-healing: the merge treats it as version 0, re-runs (it is idempotent
// and additive — stored user values always win), and re-stamps the shipped
// version. The known list-shaped fields must also BE lists, or they are
// rejected rather than written where the rules engine will iterate them.
function sanitiseTriageConfigForImport(config) {
  const out = Object.assign({}, config);
  delete out.version;
  for (const key of ['rules', 'resultRules', 'systemChips']) {
    if (out[key] !== undefined && !Array.isArray(out[key])) {
      throw new Error(`triagelens.config.${key} must be an array.`);
    }
  }
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
    await chrome.storage.local.set({ 'triagelens.config': sanitiseTriageConfigForImport(data.config) });
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
  module.exports = { triageExport, triageImport, sanitiseTriageConfigForImport };
}
