// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Patient Alerts IO helpers
// Exports and imports the Patient Alerts storage keys as a plain object.
// Used by suite-wide backup and the per-module export card in Options.
//
// PRIVACY NOTE: unlike every other module's backup, this export contains
// PATIENT-IDENTIFIABLE DATA (names, NHS numbers, and the alert text itself).
// The envelope preview (shared/io/suite-envelope.js) surfaces this loudly
// before import, and the Options card carries the same warning before export.
// Treat exported files like any other patient-identifiable document.
//
// IMPORT SEMANTICS: MERGE (union), not replace. A shared file from a colleague
// adds its patients/alerts/types to the local store; same-id items are
// overwritten by the incoming copy. Import can therefore never silently delete
// a locally-recorded alert — removing an alert is always an explicit in-module
// action. (Suite-restore uses the same merge path: acceptable, since restoring
// onto a fresh profile is a plain union with an empty store.)

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
    byPatient: r['patientAlerts.byPatient'] ?? {},
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

  if (data.byPatient !== undefined) {
    _paValidateStore(data.byPatient);
    const incoming = _paStripDangerous(data.byPatient);
    const existingR = await chrome.storage.local.get('patientAlerts.byPatient');
    const existing = _paStripDangerous(existingR['patientAlerts.byPatient'] || {});
    const merged = { ...existing };
    for (const [key, entry] of Object.entries(incoming)) {
      const incAlerts = entry.alerts.filter(_paIsValidAlert);
      if (incAlerts.length === 0) continue;
      const cur = merged[key];
      const curAlerts = cur && Array.isArray(cur.alerts) ? cur.alerts.filter(_paIsValidAlert) : [];
      const incIds = new Set(incAlerts.map((a) => a.id));
      merged[key] = {
        patient: entry.patient || (cur && cur.patient) || { name: '', nhsNumber: null, dob: '' },
        alerts: [...curAlerts.filter((a) => !incIds.has(a.id)), ...incAlerts],
        updatedAt: entry.updatedAt || (cur && cur.updatedAt) || null,
      };
    }
    toSet['patientAlerts.byPatient'] = merged;
  }

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
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { patientAlertsExport, patientAlertsImport, PATIENT_ALERTS_KEYS };
} else if (typeof window !== 'undefined') {
  window.PatientAlertsIo = { patientAlertsExport, patientAlertsImport, PATIENT_ALERTS_KEYS };
}
