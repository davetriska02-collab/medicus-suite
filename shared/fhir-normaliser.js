// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — FHIR normaliser : GP Connect Access Record Structured ->
// the SAME bundle SentinelDataFetcher already produces, so rules-engine.js runs
// UNCHANGED. Adds the two fields the old feed never had: allergies, immunisations.
//
// Runs client-side in the extension (the proxy stays pass-through). Mirrors the
// shape in engine/data-fetcher.js (MOCK_PATIENT) and engine/normalisers.js.

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
      source: 'transactional',
    }));
    const problems = conditions.filter((p) => p.status === 'active');
    const pastProblems = conditions.filter((p) => p.status !== 'active');

    // --- medications (MedicationStatement / MedicationRequest) ---
    const medOf = (m) => ({
      name: text(m.medicationCodeableConcept) || (m.medicationReference && m.medicationReference.display) || null,
      code: snomed(m.medicationCodeableConcept),
      startDate: m.effectivePeriod?.start || m.effectiveDateTime || m.authoredOn || null,
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
        unit = null;
      if (Array.isArray(o.component) && o.component.length) {
        // e.g. BP: systolic/diastolic components -> "146/82"
        const vals = o.component.map((c) => c.valueQuantity && c.valueQuantity.value).filter((v) => v != null);
        unit = o.component[0]?.valueQuantity?.unit || null;
        rawValue = vals.join('/');
        value = unit ? `${rawValue} ${unit}` : rawValue;
      } else if (o.valueQuantity) {
        numeric = o.valueQuantity.value;
        unit = o.valueQuantity.unit || null;
        rawValue = String(o.valueQuantity.value);
        value = unit ? `${rawValue} ${unit}` : rawValue;
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
        source: 'transactional',
      };
    });
    const observations = obsRaw.map(({ name, code, date, value, source }) => ({ name, code, date, value, source }));
    const historyMap = new Map();
    for (const o of obsRaw) {
      const key = o.code || o.name;
      if (!historyMap.has(key))
        historyMap.set(key, { name: o.name, code: o.code, group: o.name, unit: o.unit, history: [] });
      historyMap.get(key).history.push({
        date: o.date,
        value: o.numeric,
        rawValue: o.rawValue,
        isAbove: false,
        isBelow: false,
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
