// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Backup Envelope Helpers
//
// Single envelope format for all per-module and suite-wide backups:
//   format: "medicus-suite-backup"
//   formatVersion: 1
//   scope: "suite" | "sentinel" | "capacity" | "triage" | "triageAlerts" |
//           "slots" | "submissions" | "popout" | "referrals" | "requestMonitor" |
//           "condor"
//   modules: { [scope]: { ...module data } }
//
// A scoped export (e.g. just Capacity) includes only that module's key under
// modules and sets scope to the module name.
//
// IMPORTANT — when adding new chrome.storage.local keys to a module:
//   1. Update shared/io/<module>-io.js — add the key to *Export() and *Import()
//   2. That's all: doFullExport() in options.js delegates to those functions,
//      so the new key is captured automatically.
// When adding a brand-new module:
//   1. Create shared/io/<module>-io.js with *Export()/*Import()
//   2. Add the scope name to VALID_SCOPES below
//   3. Wire it into doFullExport/applyEnvelope in options/options.js
//   4. Add a preview line in previewEnvelope() below
//   5. Load the script in options/options.html
//   6. Add a per-module export card in options/options.html

'use strict';

const FORMAT = 'medicus-suite-backup';
const FORMAT_VERSION = 1;
const EXTENSION_VERSION = '2.5.0';

const VALID_SCOPES = ['suite', 'sentinel', 'capacity', 'triage', 'triageAlerts', 'slots', 'submissions', 'popout', 'referrals', 'requestMonitor', 'condor', 'reception'];

// Build an envelope from a scope name and a modules object.
// modules should contain only the keys relevant to scope.
function wrap(scope, modulesData, extensionVersion) {
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`Unknown scope "${scope}". Valid: ${VALID_SCOPES.join(', ')}.`);
  }
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion: extensionVersion || EXTENSION_VERSION,
    scope,
    modules: modulesData || {},
  };
}

// Validate and unwrap an envelope.
// Returns { valid, errors, warnings, envelope } where envelope is the parsed object.
function unwrap(raw, expectedScope) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Envelope is not an object.'], warnings, envelope: null };
  }

  if (raw.format !== FORMAT) {
    errors.push(`Unrecognised format "${raw.format}". Expected "${FORMAT}".`);
    return { valid: false, errors, warnings, envelope: null };
  }

  if (typeof raw.formatVersion !== 'number') {
    errors.push('Missing or invalid formatVersion.');
  } else if (raw.formatVersion > FORMAT_VERSION) {
    warnings.push(
      `Backup was created with a newer version of the suite (formatVersion ${raw.formatVersion} > ${FORMAT_VERSION}). Some fields may be ignored.`
    );
  }

  if (!VALID_SCOPES.includes(raw.scope)) {
    errors.push(`Unknown scope "${raw.scope}".`);
  }

  if (expectedScope && raw.scope !== 'suite' && raw.scope !== expectedScope) {
    errors.push(`Expected scope "${expectedScope}" or "suite", got "${raw.scope}".`);
  }

  if (!raw.modules || typeof raw.modules !== 'object' || Array.isArray(raw.modules)) {
    errors.push('modules must be a plain object.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    envelope: errors.length === 0 ? raw : null,
  };
}

// Build a human-readable preview summary of a validated envelope.
// Returns an array of description strings suitable for display before import.
//
// For a "suite" scoped backup the preview lists every known module so users can
// see at a glance which ones are present and which are missing (older backups
// often pre-date newer modules like Request Monitor or Triage Lens). Missing
// modules render as "— not in this backup".
function previewEnvelope(envelope) {
  const lines = [];
  lines.push(`Scope: ${envelope.scope}`);
  lines.push(`Exported: ${envelope.exportedAt ? new Date(envelope.exportedAt).toLocaleString() : 'unknown'}`);
  if (envelope.extensionVersion) lines.push(`Backup created with extension version: ${envelope.extensionVersion}`);

  const mods = envelope.modules || {};
  const isSuite = envelope.scope === 'suite';
  const missing = (label) => isSuite ? `${label}: — not in this backup` : null;

  if (mods.sentinel) {
    const customCount = (mods.sentinel.customRules || []).length;
    const overrideCount = Object.keys(mods.sentinel.rules || {}).length;
    lines.push(`Sentinel (Monitoring): ${overrideCount} rule override(s), ${customCount} custom rule(s)`);
    // Warn when any rule overrides explicitly disable a monitoring rule — silent
    // disablement is a patient-safety concern and must be surfaced at preview time.
    const rules = mods.sentinel.rules || {};
    const disabledIds = Object.entries(rules)
      .filter(([, ov]) => ov && ov.enabled === false)
      .map(([id]) => id);
    if (disabledIds.length > 0) {
      lines.push(`WARNING: Disables ${disabledIds.length} monitoring rule(s): ${disabledIds.join(', ')}`);
    }
    // NF1: also warn when hiddenRules will suppress chips — same patient-safety
    // concern as enabled:false but via the per-chip snooze/dismiss pathway.
    const hiddenCount = Object.keys(mods.sentinel.hiddenRules || {}).length;
    if (hiddenCount > 0) {
      const hiddenIds = Object.keys(mods.sentinel.hiddenRules).slice(0, 5).join(', ');
      const more = hiddenCount > 5 ? ` … +${hiddenCount - 5} more` : '';
      lines.push(`WARNING: Suppresses ${hiddenCount} hidden/snoozed alert chip(s): ${hiddenIds}${more}`);
    }
  } else { const m = missing('Sentinel (Monitoring)'); if (m) lines.push(m); }

  if (mods.capacity) {
    const presetCount = (mods.capacity.presets || []).length;
    lines.push(`Capacity Forecast: ${presetCount} preset(s)`);
  } else { const m = missing('Capacity Forecast'); if (m) lines.push(m); }

  if (mods.triage) {
    const cfg = mods.triage.config || {};
    const ruleCount = (cfg.rules || []).length;
    const hasPrefs = Object.keys(cfg).some(k => k !== 'rules');
    lines.push(`Triage Lens (custom rules + prefs): ${ruleCount} rule(s)${hasPrefs ? ', prefs included' : ''}`);
  } else { const m = missing('Triage Lens (custom rules + prefs)'); if (m) lines.push(m); }

  if (mods.slots) {
    const hiddenCount  = (mods.slots.hiddenTypes || []).length;
    const alertCount   = (mods.slots.alertRules  || []).length;
    lines.push(`Slot Counter: ${hiddenCount} hidden type(s), ${alertCount} alert rule(s)`);
  } else { const m = missing('Slot Counter'); if (m) lines.push(m); }

  if (mods.submissions) {
    const hasThresholds = mods.submissions.thresholds != null;
    lines.push(`Submissions Tracker: config included${hasThresholds ? ', thresholds included' : ''}`);
  } else { const m = missing('Submissions Tracker'); if (m) lines.push(m); }

  if (mods.triageAlerts) {
    const ruleCount = (mods.triageAlerts.rules || []).length;
    lines.push(`Triage capacity alerts: ${ruleCount} rule(s)`);
  } else { const m = missing('Triage capacity alerts'); if (m) lines.push(m); }

  if (mods.popout) {
    lines.push('Pop-out: window state included');
  } else { const m = missing('Pop-out'); if (m) lines.push(m); }

  if (mods.referrals) {
    const discoveryCount = Array.isArray(mods.referrals.discovery) ? mods.referrals.discovery.length : (mods.referrals.discovery != null ? 1 : 0);
    const hasConfig = mods.referrals.config != null;
    lines.push(`Referrals: ${discoveryCount} discovered, config ${hasConfig ? 'present' : 'absent'}`);
  } else { const m = missing('Referrals'); if (m) lines.push(m); }

  if (mods.requestMonitor) {
    const enabled = mods.requestMonitor.enabled;
    lines.push(`Request Monitor: ${enabled ? 'enabled' : 'disabled'}, assignee ${mods.requestMonitor.assigneeId || 'not set'}`);
  } else { const m = missing('Request Monitor'); if (m) lines.push(m); }

  if (mods.reception) {
    const customCount = (mods.reception.customPathways || []).length;
    const editCount = Object.keys(mods.reception.pathwayOverrides || {}).length;
    lines.push(`Reception: ${customCount} custom pathway(s), ${editCount} edited pathway(s)`);
    // Importing enable flags switches clinical-adjacent capture pathways on for
    // reception staff — surface it at preview time, same concern class as the
    // sentinel hiddenRules warning above.
    const enabledIds = Object.entries((mods.reception.config || {}).enabledPathways || {})
      .filter(([, v]) => v === true).map(([id]) => id);
    if (enabledIds.length > 0) {
      const shown = enabledIds.slice(0, 5).join(', ');
      const more = enabledIds.length > 5 ? ` … +${enabledIds.length - 5} more` : '';
      lines.push(`WARNING: Enables ${enabledIds.length} reception capture pathway(s): ${shown}${more}`);
    }
  } else { const m = missing('Reception'); if (m) lines.push(m); }

  if (mods.suite) {
    if (mods.suite.practiceCode) lines.push(`Practice code: ${mods.suite.practiceCode}`);
    if (mods.suite.feedbackEmail) lines.push(`Feedback email: ${mods.suite.feedbackEmail}`);
    if (mods.suite.display) lines.push('Display preferences (theme / text size / colourblind)');
  }

  return lines;
}

// Suggest a download filename.
function suggestFilename(scope) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (scope === 'suite') return `medicus-suite-backup-${stamp}.json`;
  return `medicus-${scope}-backup-${stamp}.json`;
}

// Transactional restore helper.
// Takes an array of async task functions (each writes to chrome.storage.local).
// Snapshots all storage before running; if any task throws, rolls back every key
// written during the run and re-throws an error that includes the original message
// and states that no changes were applied (surfaced verbatim by setBackupStatus).
async function applyWithRollback(taskFns) {
  // Snapshot: capture the full storage state before any write.
  const snapshot = await chrome.storage.local.get(null);

  try {
    // Run tasks SEQUENTIALLY so a failure at task N means tasks 0…N-1 have written
    // but task N and beyond have not. On success we're done.
    for (const fn of taskFns) {
      await fn();
    }
  } catch (originalErr) {
    // Determine which keys exist now that were absent in the snapshot — these were
    // written by tasks that ran before the failure and must be removed first.
    let currentKeys;
    try {
      currentKeys = Object.keys(await chrome.storage.local.get(null));
    } catch (_) {
      currentKeys = [];
    }
    const newKeys = currentKeys.filter(k => !(k in snapshot));
    if (newKeys.length > 0) {
      try { await chrome.storage.local.remove(newKeys); } catch (_) { /* best-effort */ }
    }
    // Restore the snapshot (overwrites anything tasks may have changed).
    if (Object.keys(snapshot).length > 0) {
      try { await chrome.storage.local.set(snapshot); } catch (_) { /* best-effort */ }
    }
    const msg = originalErr && originalErr.message ? originalErr.message : String(originalErr);
    throw new Error(`${msg} — no changes were applied`);
  }
}

const api = { FORMAT, FORMAT_VERSION, EXTENSION_VERSION, VALID_SCOPES, wrap, unwrap, previewEnvelope, suggestFilename, applyWithRollback };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SuiteEnvelope = api;
}
