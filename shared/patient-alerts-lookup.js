// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Patient Alerts read-only lookup (classic script, content-script safe)
//
// The Patient Alerts store ('patientAlerts.byPatient', owned by
// side-panel/modules/patient-alerts/patient-alerts-core.js) is an ES module on
// the panel side, which classic-world content scripts cannot import. This file
// re-implements ONLY the read-side helpers those scripts need (lookup, sort,
// max severity) so the on-page flag banner and the queue flag chips can render
// without touching the write path.
//
// KEEP IN SYNC with patient-alerts-core.js — test-patient-alerts-lookup.js
// imports BOTH implementations and asserts they agree on shared fixtures, so
// a drift between them fails CI rather than shipping silently.
//
// Usage (browser classic script): window.PatientAlertsLookup.<fn>(...)
// Usage (Node / test):            require('./shared/patient-alerts-lookup.js').<fn>(...)

(function (global) {
  'use strict';

  var SEVERITIES = ['red', 'amber', 'info'];
  var SEVERITY_RANK = { red: 0, amber: 1, info: 2 };

  // Normalise an NHS number to a bare 10-digit string, or null.
  function normaliseNhs(raw) {
    if (raw == null) return null;
    var digits = String(raw).replace(/\D/g, '');
    return digits.length === 10 ? digits : null;
  }

  // Structurally sound alert — corrupt entries degrade to skipped, never break render.
  function isValidAlert(a) {
    return !!(
      a &&
      typeof a === 'object' &&
      typeof a.id === 'string' &&
      a.id &&
      typeof a.label === 'string' &&
      a.label.trim() &&
      SEVERITIES.indexOf(a.severity) !== -1
    );
  }

  // Most-severe-first, then label — same ordering as the panel core.
  function sortAlerts(alerts) {
    return (alerts || []).filter(isValidAlert).sort(function (a, b) {
      var ra = SEVERITY_RANK[a.severity];
      var rb = SEVERITY_RANK[b.severity];
      var r = (ra === undefined ? 9 : ra) - (rb === undefined ? 9 : rb);
      return r !== 0 ? r : a.label.localeCompare(b.label);
    });
  }

  function maxSeverity(alerts) {
    var best = null;
    (alerts || []).forEach(function (a) {
      if (!isValidAlert(a)) return;
      if (best === null || SEVERITY_RANK[a.severity] < SEVERITY_RANK[best]) best = a.severity;
    });
    return best;
  }

  // Find the store entry for a patient identity. Primary: exact UUID key.
  // Fallback: normalised-NHS scan. NEVER matches on name alone (wrong-patient
  // safety — identical contract to patient-alerts-core.js findEntryForPatient).
  function findEntry(store, ids) {
    if (!store || typeof store !== 'object') return null;
    var uuid = ids && typeof ids.patientUuid === 'string' && ids.patientUuid.length >= 8 ? ids.patientUuid : null;
    if (uuid && store[uuid] && typeof store[uuid] === 'object') return { key: uuid, entry: store[uuid] };
    var nhs = normaliseNhs(ids && ids.nhsNumber);
    if (nhs) {
      var keys = Object.keys(store);
      for (var i = 0; i < keys.length; i++) {
        var entry = store[keys[i]];
        if (entry && entry.patient && normaliseNhs(entry.patient.nhsNumber) === nhs) {
          return { key: keys[i], entry: entry };
        }
      }
    }
    return null;
  }

  // Compact display model for one-line surfaces (queue chip, banner strip):
  // { topLabel, more, severity, count, all } or null when no valid flags.
  // `all` is most-severe-first labels for the tooltip.
  function summariseFlags(alerts) {
    var sorted = sortAlerts(alerts);
    if (sorted.length === 0) return null;
    return {
      topLabel: sorted[0].label,
      more: sorted.length - 1,
      severity: maxSeverity(sorted),
      count: sorted.length,
      all: sorted.map(function (a) {
        return a.label;
      }),
    };
  }

  var api = {
    normaliseNhs: normaliseNhs,
    isValidAlert: isValidAlert,
    sortAlerts: sortAlerts,
    maxSeverity: maxSeverity,
    findEntry: findEntry,
    summariseFlags: summariseFlags,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.PatientAlertsLookup = api;
  }
})(typeof window !== 'undefined' ? window : null);
