// Medicus Suite — Backup Envelope Helpers
//
// Single envelope format for all per-module and suite-wide backups:
//   format: "medicus-suite-backup"
//   formatVersion: 1
//   scope: "suite" | "sentinel" | "capacity" | "triage" | "triageAlerts" |
//           "slots" | "submissions" | "popout"
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
const EXTENSION_VERSION = '1.6.0';

const VALID_SCOPES = ['suite', 'sentinel', 'capacity', 'triage', 'triageAlerts', 'slots', 'submissions', 'popout'];

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
function previewEnvelope(envelope) {
  const lines = [];
  lines.push(`Scope: ${envelope.scope}`);
  lines.push(`Exported: ${envelope.exportedAt ? new Date(envelope.exportedAt).toLocaleString() : 'unknown'}`);
  if (envelope.extensionVersion) lines.push(`Extension version: ${envelope.extensionVersion}`);

  const mods = envelope.modules || {};

  if (mods.sentinel) {
    const customCount = (mods.sentinel.customRules || []).length;
    const overrideCount = Object.keys(mods.sentinel.rules || {}).length;
    lines.push(`Sentinel: ${overrideCount} rule override(s), ${customCount} custom rule(s)`);
  }
  if (mods.capacity) {
    const presetCount = (mods.capacity.presets || []).length;
    lines.push(`Capacity: ${presetCount} preset(s)`);
  }
  if (mods.triage) {
    const ruleCount = (mods.triage.config?.rules || []).length;
    lines.push(`Triage Lens: ${ruleCount} rule(s)`);
  }
  if (mods.slots) {
    const hiddenCount  = (mods.slots.hiddenTypes || []).length;
    const alertCount   = (mods.slots.alertRules  || []).length;
    lines.push(`Slot Counter: ${hiddenCount} hidden type(s), ${alertCount} alert rule(s)`);
  }
  if (mods.submissions) {
    const hasThresholds = mods.submissions.thresholds != null;
    lines.push(`Submissions Tracker: config included${hasThresholds ? ', thresholds included' : ''}`);
  }
  if (mods.triageAlerts) {
    const ruleCount = (mods.triageAlerts.rules || []).length;
    lines.push(`Triage capacity alerts: ${ruleCount} rule(s)`);
  }
  if (mods.popout) {
    lines.push('Pop-out: window state included');
  }
  if (mods.suite) {
    if (mods.suite.practiceCode) lines.push(`Practice code: ${mods.suite.practiceCode}`);
  }

  return lines;
}

// Suggest a download filename.
function suggestFilename(scope) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (scope === 'suite') return `medicus-suite-backup-${stamp}.json`;
  return `medicus-${scope}-backup-${stamp}.json`;
}

const api = { FORMAT, FORMAT_VERSION, EXTENSION_VERSION, VALID_SCOPES, wrap, unwrap, previewEnvelope, suggestFilename };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SuiteEnvelope = api;
}
