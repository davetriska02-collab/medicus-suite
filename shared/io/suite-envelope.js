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

// ── Payload integrity digest ──────────────────────────────────────────────────
//
// IMPORTANT: this is an INTEGRITY CHECK, not a cryptographic signature.
// It proves the file was not truncated or accidentally corrupted in transit
// (e.g. by a partial download, a text-editor re-encoding, or filesystem
// truncation). It does NOT prove the file came from a trusted author — a
// malicious actor who can modify the file can trivially recompute the hash.
// For authenticity / tamper-proof provenance you would need an asymmetric
// signature; that is deliberately out of scope here.
//
// Algorithm: a synchronous 53-bit hash (cyrb53) over the deterministic JSON
// serialisation of { scope, modules }. Synchronous so wrap() stays sync and
// callers don't need to be async. Output is a zero-padded 14-character hex
// string (e.g. "002a3f1e8b7c04").
//
// cyrb53 by bryc (CC0 / public domain):
//   https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.mjs
function _cyrb53(str, seed) {
  seed = seed === undefined ? 0 : seed;
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // Combine into a 53-bit value represented as two 32-bit halves, then hex.
  const lo = (h1 >>> 0).toString(16).padStart(8, '0');
  const hi = ((h2 >>> 0) & 0x1fffff).toString(16).padStart(6, '0');
  return hi + lo; // 14 hex chars
}

// The string that is hashed is a deterministic JSON serialisation of the
// payload fields that matter: scope + modules (sorted by key).  exportedAt
// and extensionVersion are intentionally excluded so that re-stamping the
// export date on an otherwise identical backup does not invalidate the hash.
function _payloadCanonical(scope, modulesData) {
  // Sort module keys for determinism (Object.keys order is insertion-order,
  // which can differ between JS engines / import paths).
  const sortedModules = {};
  Object.keys(modulesData || {})
    .sort()
    .forEach((k) => {
      sortedModules[k] = (modulesData || {})[k];
    });
  return JSON.stringify({ scope, modules: sortedModules });
}

function _computePayloadHash(scope, modulesData) {
  return _cyrb53(_payloadCanonical(scope, modulesData));
}

const VALID_SCOPES = [
  'suite',
  'sentinel',
  'capacity',
  'triage',
  'triageAlerts',
  'slots',
  'submissions',
  'popout',
  'referrals',
  'requestMonitor',
  'condor',
  'reception',
  'knowledge',
  'labfiling',
  'notifications',
];

// Build an envelope from a scope name and a modules object.
// modules should contain only the keys relevant to scope.
// Stamps a payloadIntegrity field: a deterministic content digest that lets
// unwrap() detect accidental truncation or corruption. See the note above —
// this is an integrity check, not a cryptographic signature.
function wrap(scope, modulesData, extensionVersion) {
  if (!VALID_SCOPES.includes(scope)) {
    throw new Error(`Unknown scope "${scope}". Valid: ${VALID_SCOPES.join(', ')}.`);
  }
  const mods = modulesData || {};
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion: extensionVersion || EXTENSION_VERSION,
    scope,
    modules: mods,
    // Integrity check — detects accidental corruption / truncation.
    // NOT a cryptographic signature; does not prove authorship.
    payloadIntegrity: _computePayloadHash(scope, mods),
  };
}

// Integrity check result codes surfaced in the return value.
const INTEGRITY_OK = 'ok'; // hash present and matches
const INTEGRITY_LEGACY = 'legacy'; // no hash in envelope (old backup) — not checked
const INTEGRITY_FAILED = 'failed'; // hash present but does not match payload

// Validate and unwrap an envelope.
// Returns { valid, errors, warnings, envelope, integrity } where:
//   integrity is one of INTEGRITY_OK | INTEGRITY_LEGACY | INTEGRITY_FAILED.
// An INTEGRITY_FAILED result is surfaced as an error (blocks import).
// An INTEGRITY_LEGACY result is surfaced as a warning (imports with notice).
function unwrap(raw, expectedScope) {
  const errors = [];
  const warnings = [];
  let integrity = INTEGRITY_LEGACY;

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Envelope is not an object.'], warnings, envelope: null, integrity };
  }

  if (raw.format !== FORMAT) {
    errors.push(`Unrecognised format "${raw.format}". Expected "${FORMAT}".`);
    return { valid: false, errors, warnings, envelope: null, integrity };
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

  // ── Integrity check ───────────────────────────────────────────────────────
  // payloadIntegrity is a deterministic content digest introduced in formatVersion 1
  // (backfilled). Old backups without the field are treated as legacy — not an error,
  // just a warning. New backups with a mismatched hash are rejected.
  if (raw.payloadIntegrity == null) {
    // Legacy backup — no hash was written. Warn but do not block.
    integrity = INTEGRITY_LEGACY;
    warnings.push(
      'Integrity: NOT CHECKED — this backup predates integrity checks (legacy backup). ' +
        'Import will proceed but file authenticity cannot be verified.'
    );
  } else {
    // Hash present — verify it (only if scope and modules are structurally valid).
    const scopeOk = VALID_SCOPES.includes(raw.scope);
    const modsOk = raw.modules && typeof raw.modules === 'object' && !Array.isArray(raw.modules);
    if (scopeOk && modsOk) {
      const expected = _computePayloadHash(raw.scope, raw.modules);
      if (raw.payloadIntegrity === expected) {
        integrity = INTEGRITY_OK;
      } else {
        integrity = INTEGRITY_FAILED;
        errors.push(
          'Integrity: FAILED — the file appears to have been corrupted or modified after export. ' +
            'Do not import this backup.'
        );
      }
    }
    // If scope/modules are invalid, errors are already pushed above; integrity stays LEGACY.
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    envelope: errors.length === 0 ? raw : null,
    integrity,
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

  // Surface the integrity status prominently so the user sees it before deciding
  // whether to import. Note: "integrity" means corruption/truncation detection,
  // NOT cryptographic authorship proof.
  if (envelope.payloadIntegrity == null) {
    lines.push('Integrity: NOT CHECKED (legacy backup — no hash present)');
  } else {
    // Re-verify here so the preview always reflects the live envelope state.
    const scopeOk = VALID_SCOPES.includes(envelope.scope);
    const modsOk = envelope.modules && typeof envelope.modules === 'object' && !Array.isArray(envelope.modules);
    if (scopeOk && modsOk && _computePayloadHash(envelope.scope, envelope.modules) === envelope.payloadIntegrity) {
      const dateStr = envelope.exportedAt ? new Date(envelope.exportedAt).toLocaleString() : 'unknown';
      lines.push(`Integrity: OK (v${envelope.extensionVersion || '?'}, ${dateStr})`);
    } else {
      lines.push('Integrity: FAILED — file may be corrupted, do not import');
    }
  }

  const mods = envelope.modules || {};
  const isSuite = envelope.scope === 'suite';
  const missing = (label) => (isSuite ? `${label}: — not in this backup` : null);

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
  } else {
    const m = missing('Sentinel (Monitoring)');
    if (m) lines.push(m);
  }

  if (mods.capacity) {
    const presetCount = (mods.capacity.presets || []).length;
    lines.push(`Capacity Forecast: ${presetCount} preset(s)`);
  } else {
    const m = missing('Capacity Forecast');
    if (m) lines.push(m);
  }

  if (mods.triage) {
    const cfg = mods.triage.config || {};
    const ruleCount = (cfg.rules || []).length;
    const hasPrefs = Object.keys(cfg).some((k) => k !== 'rules');
    lines.push(`Triage Lens (custom rules + prefs): ${ruleCount} rule(s)${hasPrefs ? ', prefs included' : ''}`);
  } else {
    const m = missing('Triage Lens (custom rules + prefs)');
    if (m) lines.push(m);
  }

  if (mods.slots) {
    const hiddenCount = (mods.slots.hiddenTypes || []).length;
    const alertCount = (mods.slots.alertRules || []).length;
    lines.push(`Slot Counter: ${hiddenCount} hidden type(s), ${alertCount} alert rule(s)`);
  } else {
    const m = missing('Slot Counter');
    if (m) lines.push(m);
  }

  if (mods.submissions) {
    const hasThresholds = mods.submissions.thresholds != null;
    lines.push(`Submissions Tracker: config included${hasThresholds ? ', thresholds included' : ''}`);
  } else {
    const m = missing('Submissions Tracker');
    if (m) lines.push(m);
  }

  if (mods.triageAlerts) {
    const ruleCount = (mods.triageAlerts.rules || []).length;
    lines.push(`Triage capacity alerts: ${ruleCount} rule(s)`);
  } else {
    const m = missing('Triage capacity alerts');
    if (m) lines.push(m);
  }

  if (mods.popout) {
    lines.push('Pop-out: window state included');
  } else {
    const m = missing('Pop-out');
    if (m) lines.push(m);
  }

  if (mods.referrals) {
    // Audit M1: discovery is never exported, so only config presence is reported.
    const hasConfig = mods.referrals.config != null;
    lines.push(`Referrals: config ${hasConfig ? 'present' : 'absent'}`);
  } else {
    const m = missing('Referrals');
    if (m) lines.push(m);
  }

  if (mods.requestMonitor) {
    const enabled = mods.requestMonitor.enabled;
    lines.push(
      `Request Monitor: ${enabled ? 'enabled' : 'disabled'}, assignee ${mods.requestMonitor.assigneeId || 'not set'}`
    );
  } else {
    const m = missing('Request Monitor');
    if (m) lines.push(m);
  }

  if (mods.condor) {
    const dayScoreCount = (mods.condor.dayScores || []).length;
    const snapshotCount = (mods.condor.reportSnapshots || []).length;
    lines.push(`Condor: ${dayScoreCount} day score(s), ${snapshotCount} report snapshot(s)`);
  } else {
    const m = missing('Condor');
    if (m) lines.push(m);
  }

  if (mods.reception) {
    const customCount = (mods.reception.customPathways || []).length;
    const editCount = Object.keys(mods.reception.pathwayOverrides || {}).length;
    lines.push(`Reception: ${customCount} custom pathway(s), ${editCount} edited pathway(s)`);
    // Importing enable flags switches clinical-adjacent capture pathways on for
    // reception staff — surface it at preview time, same concern class as the
    // sentinel hiddenRules warning above.
    const enabledIds = Object.entries((mods.reception.config || {}).enabledPathways || {})
      .filter(([, v]) => v === true)
      .map(([id]) => id);
    if (enabledIds.length > 0) {
      const shown = enabledIds.slice(0, 5).join(', ');
      const more = enabledIds.length > 5 ? ` … +${enabledIds.length - 5} more` : '';
      lines.push(`WARNING: Enables ${enabledIds.length} reception capture pathway(s): ${shown}${more}`);
    }
  } else {
    const m = missing('Reception');
    if (m) lines.push(m);
  }

  if (mods.knowledge) {
    const items = mods.knowledge.items || [];
    const catCount = (mods.knowledge.categories || []).length;
    lines.push(
      `Knowledge: ${items.length} entr${items.length === 1 ? 'y' : 'ies'}, ${catCount} categor${catCount === 1 ? 'y' : 'ies'}`
    );
    const unreviewed = items.filter((e) => e && e.source === 'llm' && e.reviewed !== true).length;
    if (unreviewed > 0) {
      lines.push(
        `NOTE: ${unreviewed} AI-generated entr${unreviewed === 1 ? 'y is' : 'ies are'} not yet marked reviewed`
      );
    }
  } else {
    const m = missing('Knowledge');
    if (m) lines.push(m);
  }

  if (mods.labfiling) {
    const profiles = mods.labfiling.profiles || [];
    lines.push(`Lab filing: ${profiles.length} filing profile${profiles.length === 1 ? '' : 's'}`);
    // Profiles always arrive disabled on import, but surface their backed-up state
    // so a reviewer sees what was armed on the source machine.
    const armed = profiles.filter((p) => p && p.enabled === true).length;
    const withMsg = profiles.filter((p) => p && p.patientMessage && p.patientMessage.enabled === true).length;
    lines.push(`NOTE: all imported filing profiles arrive DISABLED — review and enable each before it can file.`);
    if (armed > 0 || withMsg > 0) {
      lines.push(
        `(On the source machine: ${armed} enabled, ${withMsg} with a patient message — both reset to off here.)`
      );
    }
  } else {
    const m = missing('Lab filing');
    if (m) lines.push(m);
  }

  if (mods.notifications) {
    const badgeEnabled = mods.notifications.notifications?.badgeEnabled;
    lines.push(`Notifications: badge ${badgeEnabled === false ? 'disabled' : 'enabled'}`);
  } else {
    const m = missing('Notifications');
    if (m) lines.push(m);
  }

  if (mods.suite) {
    if (mods.suite.practiceCode) lines.push(`Practice code: ${mods.suite.practiceCode}`);
    if (mods.suite.feedbackEmail) lines.push(`Feedback email: ${mods.suite.feedbackEmail}`);
    if (mods.suite.display) lines.push('Display preferences (theme / text size / colourblind)');
    if (Array.isArray(mods.suite.tabOrder) && mods.suite.tabOrder.length) {
      lines.push(`Tab order: ${mods.suite.tabOrder.length} tabs`);
    }
    // Unlike the per-install attestations, the practice acceptance travels — flag it
    // loudly because importing it switches clinical capture + monitoring ON here.
    if (mods.suite.practiceAcceptedAt) {
      lines.push(
        'WARNING: Carries practice acceptance — importing switches ON reception capture pathways and the Sentinel alert library on THIS install.'
      );
    }
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
    const newKeys = currentKeys.filter((k) => !(k in snapshot));
    if (newKeys.length > 0) {
      try {
        await chrome.storage.local.remove(newKeys);
      } catch (_) {
        /* best-effort */
      }
    }
    // Restore the snapshot (overwrites anything tasks may have changed).
    if (Object.keys(snapshot).length > 0) {
      try {
        await chrome.storage.local.set(snapshot);
      } catch (_) {
        /* best-effort */
      }
    }
    const msg = originalErr && originalErr.message ? originalErr.message : String(originalErr);
    throw new Error(`${msg} — no changes were applied`);
  }
}

const api = {
  FORMAT,
  FORMAT_VERSION,
  EXTENSION_VERSION,
  VALID_SCOPES,
  INTEGRITY_OK,
  INTEGRITY_LEGACY,
  INTEGRITY_FAILED,
  wrap,
  unwrap,
  previewEnvelope,
  suggestFilename,
  applyWithRollback,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  window.SuiteEnvelope = api;
}
