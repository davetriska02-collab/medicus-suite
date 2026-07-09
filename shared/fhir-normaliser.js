// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — FHIR normaliser : GP Connect Access Record Structured ->
// the SAME bundle SentinelDataFetcher already produces, so rules-engine.js runs
// UNCHANGED. Adds the two fields the old feed never had: allergies, immunisations.
//
// Runs client-side in the extension (the proxy stays pass-through). Mirrors the
// shape in engine/data-fetcher.js (MOCK_PATIENT) and engine/normalisers.js.
//
// Per-field enrichment (additive, matches engine/normalisers.js field names
// exactly — see side-panel/modules/record/record.js's DATA PATH note, which
// today prefers the session shape specifically because these were missing):
//   medications[].dosage             <- dosageInstruction[0].text, falling back
//                                        to .patientInstruction; null if absent
//                                        (session: m.dosageInstructions || null)
//   observations[].isAbove/isBelow   <- valueQuantity.value vs referenceRange[0]
//                                        .low/.high; false when non-numeric or no
//                                        range (session: !!cell.isAboveReferenceRange)
//   observationHistory[].history[].isAbove/isBelow <- same, per history point
//                                        (was previously hardcoded to false)
//   problems[]/pastProblems[].significance <- ProblemSignificance extension
//                                        valueCode ('major'|'minor'); null if
//                                        absent (session: p.significance || null)
// Component observations (e.g. BP systolic/diastolic) flag isAbove/isBelow true
// if ANY component breaches its OWN referenceRange. All extraction is
// defensive: a malformed extension/range/component never throws — the item
// just degrades to its un-enriched form.

(function (global) {
  'use strict';

  const text = (cc) => (cc && (cc.text || (cc.coding && cc.coding[0] && cc.coding[0].display))) || null;
  const snomed = (cc) => {
    const c = cc && cc.coding && cc.coding.find((x) => /snomed/i.test(x.system || ''));
    return (c && c.code) || (cc && cc.coding && cc.coding[0] && cc.coding[0].code) || null;
  };
  const ageFrom = (iso) => {
    if (!iso) return null;
    const d = new Date(iso),
      n = new Date();
    let a = n.getFullYear() - d.getFullYear();
    if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
    return a >= 0 ? a : null;
  };

  // dosageInstruction[0].text (falling back to .patientInstruction) -> the
  // human-readable dose line, e.g. "Take one tablet twice daily". Absent ->
  // null, matching the session normaliser's `m.dosageInstructions || null`.
  const dosageOf = (m) => {
    try {
      const di = m && Array.isArray(m.dosageInstruction) ? m.dosageInstruction[0] : null;
      return (di && (di.text || di.patientInstruction)) || null;
    } catch (_) {
      return null;
    }
  };

  // valueQuantity.value vs a FHIR referenceRange array -> { isAbove, isBelow }.
  // Non-numeric values or a missing/malformed range always resolve to
  // { false, false } — never throws, never invents a breach.
  const refRangeFlags = (value, referenceRange) => {
    try {
      if (typeof value !== 'number' || !isFinite(value)) return { isAbove: false, isBelow: false };
      if (!Array.isArray(referenceRange) || !referenceRange.length) return { isAbove: false, isBelow: false };
      let isAbove = false,
        isBelow = false;
      for (const rr of referenceRange) {
        const low = rr && rr.low && typeof rr.low.value === 'number' ? rr.low.value : null;
        const high = rr && rr.high && typeof rr.high.value === 'number' ? rr.high.value : null;
        if (high !== null && value > high) isAbove = true;
        if (low !== null && value < low) isBelow = true;
      }
      return { isAbove, isBelow };
    } catch (_) {
      return { isAbove: false, isBelow: false };
    }
  };

  // ProblemHeader Condition's problemSignificance extension -> 'major'|'minor'.
  // Absent/malformed extension -> null, matching the session normaliser's
  // `p.significance || null`.
  const problemSignificance = (c) => {
    try {
      const ext =
        c && Array.isArray(c.extension) && c.extension.find((e) => e && /ProblemSignificance/i.test(e.url || ''));
      return (ext && ext.valueCode) || null;
    } catch (_) {
      return null;
    }
  };

  // normaliseCareRecord(fhirBundle, demographics, urlContext) -> engine bundle
  function normaliseCareRecord(bundle, demographics, urlContext) {
    const resources = ((bundle && bundle.entry) || []).map((e) => e.resource).filter(Boolean);
    const ofType = (t) => resources.filter((r) => r.resourceType === t);

    // --- patientContext (from the demographics endpoint, not FHIR) ---
    const d = demographics || {};
    const nm = d.officialName || {};
    const patientContext = {
      patientName: [nm.prefix, nm.givenName, nm.familyName].filter(Boolean).join(' ') || null,
      nhsNumber: d.nhsNumber || null,
      dob: d.dateOfBirth || null,
      ageYears: ageFrom(d.dateOfBirth),
      sex: (d.gender || '').toLowerCase() || null,
      patientUuid: d.patientId || (urlContext && urlContext.patientUuid) || null,
      url: urlContext && urlContext.url,
      view: urlContext && urlContext.view,
      source: 'transactional',
    };

    // --- problems (Condition) ---
    const conditions = ofType('Condition').map((c) => ({
      label: text(c.code),
      code: snomed(c.code),
      codedDate: c.onsetDateTime || c.recordedDate || null,
      status:
        (c.clinicalStatus && (c.clinicalStatus.coding ? c.clinicalStatus.coding[0].code : c.clinicalStatus)) ||
        'active',
      significance: problemSignificance(c),
      source: 'transactional',
    }));
    const problems = conditions.filter((p) => p.status === 'active');
    const pastProblems = conditions.filter((p) => p.status !== 'active');

    // --- medications (MedicationStatement / MedicationRequest) ---
    const medOf = (m) => ({
      name: text(m.medicationCodeableConcept) || (m.medicationReference && m.medicationReference.display) || null,
      code: snomed(m.medicationCodeableConcept),
      startDate: m.effectivePeriod?.start || m.effectiveDateTime || m.authoredOn || null,
      dosage: dosageOf(m),
      source: 'transactional',
    });
    const medications = [...ofType('MedicationStatement'), ...ofType('MedicationRequest')]
      .map(medOf)
      .filter((m) => m.name);

    // --- observations (Observation) + history grouped by code/name ---
    const obsRaw = ofType('Observation').map((o) => {
      let value = null,
        rawValue = null,
        numeric = NaN,
        unit = null,
        isAbove = false,
        isBelow = false;
      if (Array.isArray(o.component) && o.component.length) {
        // e.g. BP: systolic/diastolic components -> "146/82"
        const vals = o.component.map((c) => c.valueQuantity && c.valueQuantity.value).filter((v) => v != null);
        unit = o.component[0]?.valueQuantity?.unit || null;
        rawValue = vals.join('/');
        value = unit ? `${rawValue} ${unit}` : rawValue;
        // Per-component referenceRange (BP: systolic/diastolic each carry their
        // own range) -> flag true if ANY component breaches its own range. One
        // malformed component must never affect the others or throw.
        for (const c of o.component) {
          try {
            const cv = c && c.valueQuantity && c.valueQuantity.value;
            const f = refRangeFlags(cv, c && c.referenceRange);
            if (f.isAbove) isAbove = true;
            if (f.isBelow) isBelow = true;
          } catch (_) {
            /* degrade this component only */
          }
        }
      } else if (o.valueQuantity) {
        numeric = o.valueQuantity.value;
        unit = o.valueQuantity.unit || null;
        rawValue = String(o.valueQuantity.value);
        value = unit ? `${rawValue} ${unit}` : rawValue;
        const f = refRangeFlags(numeric, o.referenceRange);
        isAbove = f.isAbove;
        isBelow = f.isBelow;
      } else if (o.valueString) {
        value = rawValue = o.valueString;
      }
      return {
        name: text(o.code),
        code: snomed(o.code),
        date: o.effectiveDateTime || o.issued || null,
        value,
        rawValue,
        numeric,
        unit,
        isAbove,
        isBelow,
        source: 'transactional',
      };
    });
    const observations = obsRaw.map(({ name, code, date, value, isAbove, isBelow, source }) => ({
      name,
      code,
      date,
      value,
      isAbove,
      isBelow,
      source,
    }));
    const historyMap = new Map();
    for (const o of obsRaw) {
      const key = o.code || o.name;
      if (!historyMap.has(key))
        historyMap.set(key, { name: o.name, code: o.code, group: o.name, unit: o.unit, history: [] });
      historyMap.get(key).history.push({
        date: o.date,
        value: o.numeric,
        rawValue: o.rawValue,
        isAbove: o.isAbove,
        isBelow: o.isBelow,
        source: 'transactional',
      });
    }
    const observationHistory = [...historyMap.values()];

    // --- NEW: allergies (AllergyIntolerance) ---
    const allergies = ofType('AllergyIntolerance').map((a) => ({
      label: text(a.code),
      code: snomed(a.code),
      status:
        (a.clinicalStatus && (a.clinicalStatus.coding ? a.clinicalStatus.coding[0].code : a.clinicalStatus)) ||
        'active',
      recordedDate: a.recordedDate || a.onsetDateTime || null,
      source: 'transactional',
    }));

    // --- NEW: immunisations (Immunization) -> reliable vaccine status ---
    const immunisations = ofType('Immunization').map((i) => ({
      label: text(i.vaccineCode),
      code: snomed(i.vaccineCode),
      date: i.occurrenceDateTime || null,
      status: i.status || 'completed', // 'completed' | 'not-done'
      source: 'transactional',
    }));

    return {
      mode: 'live',
      patientContext,
      problems,
      pastProblems,
      medications,
      observations,
      observationHistory,
      allergies,
      immunisations,
      debug: {
        dataSource: 'transactional',
        counts: {
          problems: problems.length,
          medications: medications.length,
          observations: observations.length,
          allergies: allergies.length,
          immunisations: immunisations.length,
        },
      },
    };
  }

  const api = { normaliseCareRecord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SentinelFhirNormaliser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
