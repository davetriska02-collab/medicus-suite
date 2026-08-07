// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Results engine feed: FHIR Observation/DiagnosticReport -> the `report`
// shape SentinelResultSeverity.evaluateReportSeverity() consumes. The engine
// reads r.urgent / r.isAbove / r.isBelow / r.name / r.value — mapped here from
// FHIR `interpretation` codes (HL7 v3 ObservationInterpretation).

(function (global) {
  'use strict';

  const codings = (cc) => (cc && cc.coding) || [];
  const display = (cc) => (cc && (cc.text || (codings(cc)[0] && codings(cc)[0].display))) || null;

  // interpretation codes -> { urgent, isAbove, isBelow }
  function interpFlags(obs) {
    const codes = []
      .concat(obs.interpretation || [])
      .flatMap((cc) => codings(cc).map((c) => String(c.code || '').toUpperCase()));
    const has = (...xs) => xs.some((x) => codes.includes(x));
    return {
      urgent: has('HH', 'LL', 'AA', 'PANIC', 'CRIT'),
      isAbove: has('H', 'HH', 'HU', 'A', 'AA'),
      isBelow: has('L', 'LL', 'LU'),
    };
  }

  // fhirToReport(fhirBundle, meta) -> { results:[...], priorityDisplay, unmatched, patientUuid }
  function fhirToReport(bundle, meta) {
    const resources = ((bundle && bundle.entry) || []).map((e) => e.resource).filter(Boolean);
    const results = resources
      .filter((r) => r.resourceType === 'Observation')
      .map((o) => {
        const f = interpFlags(o);
        const q = o.valueQuantity;
        return {
          name: display(o.code),
          value: q ? q.value : o.valueString != null ? o.valueString : null,
          unit: q ? q.unit || null : null,
          date: o.effectiveDateTime || o.issued || null,
          urgent: f.urgent,
          isAbove: f.isAbove,
          isBelow: f.isBelow,
          source: 'transactional',
        };
      });
    return {
      results,
      priorityDisplay: (meta && meta.priorityDisplay) || '',
      unmatched: false,
      patientUuid: meta && meta.patientUuid,
    };
  }

  const api = { fhirToReport, interpFlags };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SentinelFhirResults = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
