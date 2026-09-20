// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Patient Alerts IO helpers
// Exports and imports the Patient Alerts storage keys as a plain object.
// Used by suite-wide backup and the per-module export card in Options.
//
// PRIVACY NOTE: from v3.264.1 the suite backup exports ONLY the practice
// palette (`patientAlerts.types`). Per-patient flags (`patientAlerts.byPatient`)
// are PHI and stay on the workstation — they are stripped from export and
// skipped on import. Older backups that still carry byPatient are accepted
// but that map is not written. The key remains in PATIENT_ALERTS_KEYS so the
// backup-coverage scanner still sees it as an IO-owned key.
//
// IMPORT SEMANTICS for types: MERGE (union), not replace. A shared file from
// a colleague adds its types to the local palette; same-id items are
// overwritten by the incoming copy.

'use strict';

const PATIENT_ALERTS_KEYS = ['patientAlerts.byPatient', 'patientAlerts.types'];

const _PA_SEVERITIES = ['red', 'amber', 'info'];
const _PA_DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

function _paStripDangerous(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (!_PA_DANGEROUS_KEYS.includes(k)) out[k] = obj[k];
  });
  return out;
}

function _paIsValidAlert(a) {
  return !!(
    a &&
    typeof a === 'object' &&
    !Array.isArray(a) &&
    typeof a.id === 'string' &&
    a.id &&
    typeof a.label === 'string' &&
    a.label.trim() &&
    _PA_SEVERITIES.includes(a.severity)
  );
}

function _paIsValidType(t) {
  return !!(
    t &&
    typeof t === 'object' &&
    !Array.isArray(t) &&
    typeof t.id === 'string' &&
    t.id &&
    typeof t.label === 'string' &&
    t.label.trim() &&
    _PA_SEVERITIES.includes(t.severity)
  );
}

// Validate an imported byPatient store. Throws with a descriptive message on a
// malformed shape (rollback in applyWithRollback depends on throwing).
function _paValidateStore(byPatient) {
  if (typeof byPatient !== 'object' || byPatient === null || Array.isArray(byPatient)) {
    throw new Error('patientAlerts.byPatient must be an object keyed by patient UUID.');
  }
  for (const [key, entry] of Object.entries(byPatient)) {
    if (_PA_DANGEROUS_KEYS.includes(key)) continue; // stripped later
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`patientAlerts.byPatient["${key}"]: entry must be an object.`);
    }
    if (!Array.isArray(entry.alerts)) {
      throw new Error(`patientAlerts.byPatient["${key}"].alerts must be an array.`);
    }
    entry.alerts.forEach((a, i) => {
      if (!_paIsValidAlert(a)) {
        throw new Error(
          `patientAlerts.byPatient["${key}"].alerts[${i}]: each alert needs a string id, a non-empty label, and severity red/amber/info.`
        );
      }
    });
    if (entry.patient !== undefined && (typeof entry.patient !== 'object' || Array.isArray(entry.patient))) {
      throw new Error(`patientAlerts.byPatient["${key}"].patient must be an object.`);
    }
  }
}

// Export the Patient Alerts storage keys into a plain data object.
async function patientAlertsExport() {
  const r = await chrome.storage.local.get(PATIENT_ALERTS_KEYS);
  return {
    // PHI — never leave the workstation via a suite backup.
    byPatient: {},
    // types: null = "user never customised the palette" — import leaves the
    // receiving install on its own defaults instead of freezing today's
    // shipped list into their storage.
    types: r['patientAlerts.types'] ?? null,
  };
}

// Import a Patient Alerts data object back into storage (merge semantics — see
// header note). Throws on a malformed shape; valid parts are only written after
// full validation so a throw leaves storage untouched.
async function patientAlertsImport(data) {
  if (!data || typeof data !== 'object') throw new Error('Patient Alerts data must be an object.');

  const toSet = {};
  const incomingByPatient =
    data.byPatient && typeof data.byPatient === 'object' && !Array.isArray(data.byPatient) ? data.byPatient : null;
  const skippedByPatient = !!(incomingByPatient && Object.keys(incomingByPatient).length);

  // Per-patient flags are PHI and are never restored from a backup. An old
  // envelope may still carry byPatient — ignore it, do not throw, do not write.

  if (data.types !== undefined && data.types !== null) {
    if (!Array.isArray(data.types)) {
      throw new Error('patientAlerts.types must be an array of alert types.');
    }
    data.types.forEach((t, i) => {
      if (!_paIsValidType(t)) {
        throw new Error(
          `patientAlerts.types[${i}]: each type needs a string id, a non-empty label, and severity red/amber/info.`
        );
      }
    });
    const existingR = await chrome.storage.local.get('patientAlerts.types');
    const existing = Array.isArray(existingR['patientAlerts.types'])
      ? existingR['patientAlerts.types'].filter(_paIsValidType)
      : [];
    const incIds = new Set(data.types.map((t) => t.id));
    toSet['patientAlerts.types'] = [...existing.filter((t) => !incIds.has(t.id)), ...data.types];
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  return { skippedByPatient };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { patientAlertsExport, patientAlertsImport, PATIENT_ALERTS_KEYS };
} else if (typeof window !== 'undefined') {
  window.PatientAlertsIo = { patientAlertsExport, patientAlertsImport, PATIENT_ALERTS_KEYS };
}
