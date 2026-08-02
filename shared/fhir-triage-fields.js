// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Triage Lens feed: FHIR record -> the `fieldsData` bag that
// content.js matchRules() feeds to TriageLensMatch (problems/meds/allergies/
// consultations/docs/banner). The matcher (compileRule/ruleMatchesText) is
// unchanged — only the source of the text moves from the DOM to the API.
//
// LIMITATION (surfaced, not hidden): the `request` field — the patient's
// free-text reason for contact captured at reception — has NO equivalent in the
// care record, so reception-pathway rules that match `request` cannot be fed
// from the Transactional API. Record-derived fields below port cleanly.

(function (global) {
  'use strict';

  const codings = (cc) => (cc && cc.coding) || [];
  const display = (cc) => (cc && (cc.text || (codings(cc)[0] && codings(cc)[0].display))) || null;

  // fhirToFields(fhirBundle, demographics) -> fieldsData
  function fhirToFields(bundle, demographics) {
    const res = ((bundle && bundle.entry) || []).map((e) => e.resource).filter(Boolean);
    const of = (t) => res.filter((r) => r.resourceType === t);
    const d = demographics || {};
    const nm = d.officialName || {};

    return {
      problems: of('Condition')
        .map((c) => display(c.code))
        .filter(Boolean),
      meds: [...of('MedicationStatement'), ...of('MedicationRequest')]
        .map((m) => display(m.medicationCodeableConcept) || (m.medicationReference && m.medicationReference.display))
        .filter(Boolean),
      allergies: of('AllergyIntolerance')
        .map((a) => display(a.code))
        .filter(Boolean),
      consultations: of('Encounter')
        .flatMap((e) => (e.reasonCode || []).map(display))
        .concat(
          of('Observation')
            .map((o) => o.note && o.note.map((n) => n.text).join(' '))
            .filter(Boolean)
        )
        .filter(Boolean),
      docs: of('DocumentReference')
        .map((x) => x.description || display(x.type))
        .filter(Boolean),
      banner: [[nm.prefix, nm.givenName, nm.familyName].filter(Boolean).join(' ')].filter(Boolean),
      // request: NOT AVAILABLE from the care record (reception free-text only).
    };
  }

  const api = { fhirToFields };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SentinelFhirTriageFields = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
