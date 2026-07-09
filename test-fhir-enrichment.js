// Medicus Suite — FHIR normaliser enrichment tests (dosage / range flags / significance)
// Run with: node --test test-fhir-enrichment.js
//
// Pins the ADDITIVE fields shared/fhir-normaliser.js adds on top of the base
// mapping already pinned by test-txn-fhir.js, so the transactional (FHIR) feed
// matches the session normaliser's field names exactly (see engine/normalisers.js):
//   medications[].dosage                              <- dosageInstruction[0].text
//   observations[].isAbove / isBelow                  <- referenceRange vs valueQuantity
//   observationHistory[].history[].isAbove / isBelow  <- same, per history point
//   problems[]/pastProblems[].significance             <- ProblemSignificance extension
//
// Fixtures are SYNTHETIC. The NHS number 1234567890 deliberately FAILS the
// Modulus-11 checksum so it can never be a real NHS number.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normaliseCareRecord } = require('./shared/fhir-normaliser.js');

const DEMOGRAPHICS = {
  patientId: '019ac994-3e6d-7352-8511-b3e2978a42c8',
  officialName: { prefix: 'Mrs', givenName: 'Nadia', familyName: 'Okafor' },
  dateOfBirth: '1972-11-03',
  gender: 'female',
  nhsNumber: '1234567890', // checksum-INVALID by construction
};

const PROBLEM_SIGNIFICANCE_URL = 'https://fhir.hl7.org.uk/StructureDefinition/Extension-UKCore-ProblemSignificance';

function bundleWith(entries) {
  return { resourceType: 'Bundle', type: 'collection', entry: entries.map((resource) => ({ resource })) };
}

// ── medications[].dosage ──────────────────────────────────────────────────────

test('medications: dosage extracted from dosageInstruction[0].text', () => {
  const bundle = normaliseCareRecord(
    bundleWith([
      {
        resourceType: 'MedicationStatement',
        medicationCodeableConcept: { text: 'Amlodipine 5mg tablets' },
        effectiveDateTime: '2024-01-01',
        dosageInstruction: [{ text: 'Take one tablet once daily' }],
      },
    ]),
    DEMOGRAPHICS,
    {}
  );
  assert.equal(bundle.medications[0].dosage, 'Take one tablet once daily');
});

test('medications: dosage falls back to patientInstruction when text absent', () => {
  const bundle = normaliseCareRecord(
    bundleWith([
      {
        resourceType: 'MedicationRequest',
        medicationCodeableConcept: { text: 'Simvastatin 40mg tablets' },
        authoredOn: '2024-02-02',
        dosageInstruction: [{ patientInstruction: 'Take at night' }],
      },
    ]),
    DEMOGRAPHICS,
    {}
  );
  assert.equal(bundle.medications[0].dosage, 'Take at night');
});

test('medications: missing dosageInstruction -> dosage is null (session absent-value convention)', () => {
  const bundle = normaliseCareRecord(
    bundleWith([
      {
        resourceType: 'MedicationStatement',
        medicationCodeableConcept: { text: 'Paracetamol 500mg tablets' },
        effectiveDateTime: '2024-03-03',
      },
    ]),
    DEMOGRAPHICS,
    {}
  );
  assert.strictEqual(bundle.medications[0].dosage, null);
});

test('medications: empty dosageInstruction array -> dosage is null', () => {
  const bundle = normaliseCareRecord(
    bundleWith([
      {
        resourceType: 'MedicationStatement',
        medicationCodeableConcept: { text: 'Ibuprofen 400mg tablets' },
        effectiveDateTime: '2024-03-04',
        dosageInstruction: [],
      },
    ]),
    DEMOGRAPHICS,
    {}
  );
  assert.strictEqual(bundle.medications[0].dosage, null);
});

// ── observations[].isAbove / isBelow ─────────────────────────────────────────

function simpleObs(value, referenceRange) {
  return {
    resourceType: 'Observation',
    code: { text: 'Serum sodium' },
    effectiveDateTime: '2026-01-01',
    valueQuantity: { value, unit: 'mmol/L' },
    ...(referenceRange ? { referenceRange } : {}),
  };
}

test('observations: value above referenceRange.high -> isAbove true, isBelow false', () => {
  const bundle = normaliseCareRecord(
    bundleWith([simpleObs(150, [{ low: { value: 135 }, high: { value: 145 } }])]),
    DEMOGRAPHICS,
    {}
  );
  assert.equal(bundle.observations[0].isAbove, true);
  assert.equal(bundle.observations[0].isBelow, false);
});

test('observations: value below referenceRange.low -> isBelow true, isAbove false', () => {
  const bundle = normaliseCareRecord(
    bundleWith([simpleObs(120, [{ low: { value: 135 }, high: { value: 145 } }])]),
    DEMOGRAPHICS,
    {}
  );
  assert.equal(bundle.observations[0].isBelow, true);
  assert.equal(bundle.observations[0].isAbove, false);
});

test('observations: value within range -> both flags false', () => {
  const bundle = normaliseCareRecord(
    bundleWith([simpleObs(140, [{ low: { value: 135 }, high: { value: 145 } }])]),
    DEMOGRAPHICS,
    {}
  );
  assert.equal(bundle.observations[0].isAbove, false);
  assert.equal(bundle.observations[0].isBelow, false);
});

test('observations: non-numeric value -> both flags false even with a range present', () => {
  const bundle = normaliseCareRecord(
    bundleWith([
      {
        resourceType: 'Observation',
        code: { text: 'Urine dip' },
        effectiveDateTime: '2026-01-02',
        valueString: 'Negative',
      },
    ]),
    DEMOGRAPHICS,
    {}
  );
  assert.equal(bundle.observations[0].isAbove, false);
  assert.equal(bundle.observations[0].isBelow, false);
});

test('observations: missing referenceRange -> both flags false', () => {
  const bundle = normaliseCareRecord(bundleWith([simpleObs(150, null)]), DEMOGRAPHICS, {});
  assert.equal(bundle.observations[0].isAbove, false);
  assert.equal(bundle.observations[0].isBelow, false);
});

// ── BP component observation flags ───────────────────────────────────────────

test('observations: BP component breaching its own range flags the whole observation', () => {
  const bpObs = {
    resourceType: 'Observation',
    code: { text: 'Blood pressure' },
    effectiveDateTime: '2026-04-27',
    component: [
      {
        code: { text: 'Systolic' },
        valueQuantity: { value: 178, unit: 'mmHg' },
        referenceRange: [{ low: { value: 90 }, high: { value: 140 } }],
      },
      {
        code: { text: 'Diastolic' },
        valueQuantity: { value: 82, unit: 'mmHg' },
        referenceRange: [{ low: { value: 60 }, high: { value: 90 } }],
      },
    ],
  };
  const bundle = normaliseCareRecord(bundleWith([bpObs]), DEMOGRAPHICS, {});
  const bp = bundle.observations.find((o) => /blood pressure/i.test(o.name));
  assert.equal(bp.isAbove, true, 'systolic component breaches its high -> whole observation flagged');
  assert.equal(bp.isBelow, false);

  const bpHistory = bundle.observationHistory.find((h) => /blood pressure/i.test(h.name));
  assert.equal(bpHistory.history[0].isAbove, true);
  assert.equal(bpHistory.history[0].isBelow, false);
});

test('observations: BP components both within range -> flags false', () => {
  const bpObs = {
    resourceType: 'Observation',
    code: { text: 'Blood pressure' },
    effectiveDateTime: '2026-04-28',
    component: [
      {
        code: { text: 'Systolic' },
        valueQuantity: { value: 120, unit: 'mmHg' },
        referenceRange: [{ low: { value: 90 }, high: { value: 140 } }],
      },
      {
        code: { text: 'Diastolic' },
        valueQuantity: { value: 75, unit: 'mmHg' },
        referenceRange: [{ low: { value: 60 }, high: { value: 90 } }],
      },
    ],
  };
  const bundle = normaliseCareRecord(bundleWith([bpObs]), DEMOGRAPHICS, {});
  const bp = bundle.observations.find((o) => /blood pressure/i.test(o.name));
  assert.equal(bp.isAbove, false);
  assert.equal(bp.isBelow, false);
});

// ── observationHistory flags mirror observations ─────────────────────────────

test('observationHistory: history entries carry the same isAbove/isBelow as the source observation', () => {
  const bundle = normaliseCareRecord(
    bundleWith([simpleObs(150, [{ low: { value: 135 }, high: { value: 145 } }])]),
    DEMOGRAPHICS,
    {}
  );
  const hist = bundle.observationHistory.find((h) => /sodium/i.test(h.name));
  assert.equal(hist.history[0].isAbove, true);
  assert.equal(hist.history[0].isBelow, false);
});

// ── problems[].significance ──────────────────────────────────────────────────

function conditionWithSignificance(valueCode, status = 'active') {
  return {
    resourceType: 'Condition',
    clinicalStatus: { coding: [{ code: status }] },
    code: { text: 'Chronic kidney disease stage 3' },
    onsetDateTime: '2020-05-05',
    ...(valueCode ? { extension: [{ url: PROBLEM_SIGNIFICANCE_URL, valueCode }] } : {}),
  };
}

test('problems: significance "major" extracted for active problem', () => {
  const bundle = normaliseCareRecord(bundleWith([conditionWithSignificance('major')]), DEMOGRAPHICS, {});
  assert.equal(bundle.problems[0].significance, 'major');
});

test('problems: significance "minor" extracted for past (resolved) problem', () => {
  const bundle = normaliseCareRecord(bundleWith([conditionWithSignificance('minor', 'resolved')]), DEMOGRAPHICS, {});
  assert.equal(bundle.pastProblems[0].significance, 'minor');
});

test('problems: missing ProblemSignificance extension -> significance is null', () => {
  const bundle = normaliseCareRecord(bundleWith([conditionWithSignificance(null)]), DEMOGRAPHICS, {});
  assert.strictEqual(bundle.problems[0].significance, null);
});

// ── Defensive: malformed resources degrade, never throw ──────────────────────

test('malformed referenceRange (garbage shape) degrades to un-enriched flags, does not throw', () => {
  const garbageObs = {
    resourceType: 'Observation',
    code: { text: 'Potassium' },
    effectiveDateTime: '2026-05-01',
    valueQuantity: { value: 7.2, unit: 'mmol/L' },
    referenceRange: 'not-an-array',
  };
  assert.doesNotThrow(() => normaliseCareRecord(bundleWith([garbageObs]), DEMOGRAPHICS, {}));
  const bundle = normaliseCareRecord(bundleWith([garbageObs]), DEMOGRAPHICS, {});
  assert.equal(bundle.observations[0].isAbove, false);
  assert.equal(bundle.observations[0].isBelow, false);
  assert.equal(bundle.observations[0].value, '7.2 mmol/L', 'un-enriched fields are still populated correctly');
});

test('malformed referenceRange.low/high (non-numeric) degrades to false flags, does not throw', () => {
  const garbageObs = {
    resourceType: 'Observation',
    code: { text: 'Potassium' },
    effectiveDateTime: '2026-05-02',
    valueQuantity: { value: 7.2, unit: 'mmol/L' },
    referenceRange: [{ low: { value: 'low' }, high: { value: null } }],
  };
  assert.doesNotThrow(() => normaliseCareRecord(bundleWith([garbageObs]), DEMOGRAPHICS, {}));
  const bundle = normaliseCareRecord(bundleWith([garbageObs]), DEMOGRAPHICS, {});
  assert.equal(bundle.observations[0].isAbove, false);
  assert.equal(bundle.observations[0].isBelow, false);
});

test('malformed problemSignificance extension (non-array extension) degrades gracefully, does not throw', () => {
  const garbageCondition = {
    resourceType: 'Condition',
    clinicalStatus: { coding: [{ code: 'active' }] },
    code: { text: 'Hypertension' },
    onsetDateTime: '2021-01-01',
    extension: 'not-an-array',
  };
  assert.doesNotThrow(() => normaliseCareRecord(bundleWith([garbageCondition]), DEMOGRAPHICS, {}));
  const bundle = normaliseCareRecord(bundleWith([garbageCondition]), DEMOGRAPHICS, {});
  assert.strictEqual(bundle.problems[0].significance, null);
  assert.equal(bundle.problems[0].label, 'Hypertension', 'un-enriched fields still correct');
});

test('malformed dosageInstruction (not an array) degrades to dosage null, does not throw', () => {
  const garbageMed = {
    resourceType: 'MedicationStatement',
    medicationCodeableConcept: { text: 'Warfarin 1mg tablets' },
    effectiveDateTime: '2024-04-04',
    dosageInstruction: { text: 'not-an-array-here' },
  };
  assert.doesNotThrow(() => normaliseCareRecord(bundleWith([garbageMed]), DEMOGRAPHICS, {}));
  const bundle = normaliseCareRecord(bundleWith([garbageMed]), DEMOGRAPHICS, {});
  assert.strictEqual(bundle.medications[0].dosage, null);
  assert.equal(bundle.medications[0].name, 'Warfarin 1mg tablets');
});

test('malformed BP component (missing valueQuantity) degrades that component only, does not throw', () => {
  const bpObs = {
    resourceType: 'Observation',
    code: { text: 'Blood pressure' },
    effectiveDateTime: '2026-04-29',
    component: [
      { code: { text: 'Systolic' } }, // no valueQuantity at all
      {
        code: { text: 'Diastolic' },
        valueQuantity: { value: 95, unit: 'mmHg' },
        referenceRange: [{ low: { value: 60 }, high: { value: 90 } }],
      },
    ],
  };
  assert.doesNotThrow(() => normaliseCareRecord(bundleWith([bpObs]), DEMOGRAPHICS, {}));
  const bundle = normaliseCareRecord(bundleWith([bpObs]), DEMOGRAPHICS, {});
  const bp = bundle.observations.find((o) => /blood pressure/i.test(o.name));
  assert.equal(bp.isAbove, true, 'the well-formed diastolic component still breaches its own high');
});
