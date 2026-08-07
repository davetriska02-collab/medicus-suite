// Medicus Suite — FHIR feed adapter tests (Transactional API -> engine contracts)
// Run with: node --test test-txn-fhir.js
//
// Pins the mapping from GP Connect Access Record Structured (FHIR, as returned
// by the Transactional API's retrieve-care-record) into the exact shapes the
// existing engines consume:
//   shared/fhir-normaliser.js       -> the SentinelDataFetcher bundle
//   shared/fhir-results-adapter.js  -> result-severity's report.results
//   shared/fhir-triage-fields.js    -> triage-lens matchRules fieldsData
//   shared/immunisation-bridge.js   -> vaccine status from real Immunization data
//   shared/shadow-compare.js        -> the feed-swap safety gate itself
//
// Fixtures are SYNTHETIC (from Medicus's public API documentation examples);
// the NHS number 1234567890 deliberately FAILS the Modulus-11 checksum so it
// can never be a real NHS number (and never trips the patient-data guard).

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { normaliseCareRecord } = require('./shared/fhir-normaliser.js');
const { fhirToReport } = require('./shared/fhir-results-adapter.js');
const { fhirToFields } = require('./shared/fhir-triage-fields.js');
const { bridgeImmunisations } = require('./shared/immunisation-bridge.js');
const { diffChips, diffSeverity } = require('./shared/shadow-compare.js');

// ── Synthetic fixtures ────────────────────────────────────────────────────────

const DEMOGRAPHICS = {
  patientId: '019ac994-3e6d-7352-8511-b3e2978a42c7',
  officialName: { prefix: 'Mr', givenName: 'Cyril', familyName: 'Hallam' },
  dateOfBirth: '1958-04-26',
  gender: 'male',
  nhsNumber: '1234567890', // checksum-INVALID by construction (Modulus-11 check digit = 10)
};

const CARE_RECORD = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ code: 'active' }] },
        code: { coding: [{ system: 'http://snomed.info/sct', code: '44054006', display: 'Type 2 diabetes mellitus' }] },
        onsetDateTime: '2019-06-12',
      },
    },
    {
      resource: {
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ code: 'resolved' }] },
        code: { coding: [{ system: 'http://snomed.info/sct', code: '195967001', display: 'Asthma' }] },
        onsetDateTime: '2005-01-01',
      },
    },
    {
      resource: {
        resourceType: 'MedicationStatement',
        medicationCodeableConcept: {
          text: 'Methotrexate 10mg tablets',
          coding: [{ system: 'http://snomed.info/sct', code: '329351003' }],
        },
        effectiveDateTime: '2022-03-15',
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        code: { coding: [{ system: 'http://snomed.info/sct', code: '75367002', display: 'Blood pressure' }] },
        effectiveDateTime: '2026-04-27',
        component: [
          {
            code: { coding: [{ code: '271649006', display: 'Systolic' }] },
            valueQuantity: { value: 146, unit: 'mmHg' },
          },
          {
            code: { coding: [{ code: '271650006', display: 'Diastolic' }] },
            valueQuantity: { value: 82, unit: 'mmHg' },
          },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        code: { coding: [{ system: 'http://snomed.info/sct', code: '43396009', display: 'HbA1c' }] },
        effectiveDateTime: '2026-02-01',
        valueQuantity: { value: 65, unit: 'mmol/mol' },
      },
    },
    {
      resource: {
        resourceType: 'AllergyIntolerance',
        clinicalStatus: { coding: [{ code: 'active' }] },
        code: { coding: [{ system: 'http://snomed.info/sct', code: '373270004', display: 'Penicillin allergy' }] },
        recordedDate: '2010-09-01',
      },
    },
    {
      resource: {
        resourceType: 'Immunization',
        status: 'completed',
        vaccineCode: {
          coding: [
            { system: 'http://snomed.info/sct', code: '1303501000000107', display: 'Seasonal influenza vaccination' },
          ],
        },
        occurrenceDateTime: '2025-10-14',
      },
    },
  ],
};

const RESULTS_RECORD = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      resource: {
        resourceType: 'Observation',
        code: { coding: [{ system: 'http://snomed.info/sct', code: '312468003', display: 'Serum potassium' }] },
        effectiveDateTime: '2026-06-18',
        valueQuantity: { value: 6.9, unit: 'mmol/L' },
        interpretation: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                code: 'HH',
                display: 'Critical high',
              },
            ],
          },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        code: { coding: [{ system: 'http://snomed.info/sct', code: '1988001', display: 'C-reactive protein' }] },
        effectiveDateTime: '2026-06-18',
        valueQuantity: { value: 88, unit: 'mg/L' },
        interpretation: [{ coding: [{ code: 'H', display: 'High' }] }],
      },
    },
    {
      resource: {
        resourceType: 'Observation',
        code: { coding: [{ system: 'http://snomed.info/sct', code: '1022451000000103', display: 'Haemoglobin' }] },
        effectiveDateTime: '2026-06-18',
        valueQuantity: { value: 134, unit: 'g/L' },
      },
    },
  ],
};

module.exports = { DEMOGRAPHICS, CARE_RECORD, RESULTS_RECORD };

// ── fhir-normaliser -> engine bundle ─────────────────────────────────────────

const bundle = normaliseCareRecord(CARE_RECORD, DEMOGRAPHICS, { url: 'about:test', view: 'record' });

test('normaliser: patientContext matches the engine contract (ageYears, sex, nhsNumber)', () => {
  assert.equal(bundle.patientContext.sex, 'male');
  assert.equal(bundle.patientContext.nhsNumber, '1234567890');
  assert.ok(bundle.patientContext.ageYears >= 67, 'age computed from DOB');
});

test('normaliser: problems split active vs past, with native SNOMED codes', () => {
  assert.deepEqual(
    bundle.problems.map((p) => p.label),
    ['Type 2 diabetes mellitus']
  );
  assert.equal(bundle.problems[0].code, '44054006');
  assert.deepEqual(
    bundle.pastProblems.map((p) => p.label),
    ['Asthma']
  );
});

test('normaliser: BP component pairing -> "146/82" in observationHistory', () => {
  const bp = bundle.observationHistory.find((h) => /blood pressure/i.test(h.name));
  assert.equal(bp.history[0].rawValue, '146/82');
  const hba1c = bundle.observationHistory.find((h) => /hba1c/i.test(h.name));
  assert.equal(hba1c.history[0].value, 65);
});

test('normaliser: allergies + immunisations present (the fields the legacy feed cannot get)', () => {
  assert.equal(bundle.allergies[0].label, 'Penicillin allergy');
  assert.equal(bundle.immunisations[0].label, 'Seasonal influenza vaccination');
  assert.equal(bundle.immunisations[0].status, 'completed');
});

test('normaliser: bundle carries every field the rules engine reads', () => {
  for (const k of ['patientContext', 'problems', 'pastProblems', 'medications', 'observations', 'observationHistory']) {
    assert.ok(k in bundle, `missing engine field: ${k}`);
  }
});

// ── fhir-results-adapter -> result-severity report ───────────────────────────

test('results adapter: HL7 interpretation codes map to urgent/abnormal flags', () => {
  const rep = fhirToReport(RESULTS_RECORD, {});
  const k = rep.results.find((r) => /potassium/i.test(r.name));
  assert.equal(k.urgent, true); // HH -> urgent
  const crp = rep.results.find((r) => /reactive/i.test(r.name));
  assert.equal(crp.isAbove, true); // H -> abnormal, not urgent
  assert.equal(crp.urgent, false);
  const hb = rep.results.find((r) => /haemoglobin/i.test(r.name));
  assert.equal(hb.urgent || hb.isAbove || hb.isBelow, false); // no interpretation -> normal
});

// ── fhir-triage-fields -> matchRules fieldsData ──────────────────────────────

test('triage fields: record-derived text fields, and no fake `request` field', () => {
  const f = fhirToFields(CARE_RECORD, DEMOGRAPHICS);
  assert.ok(f.meds.some((m) => /methotrexate/i.test(m)));
  assert.ok(f.allergies.some((a) => /penicillin/i.test(a)));
  assert.ok(f.problems.some((p) => /diabetes/i.test(p)));
  assert.ok(!('request' in f), 'reception free-text has no care-record source and must not be fabricated');
});

// ── immunisation-bridge ──────────────────────────────────────────────────────

test('bridge: completed Immunization projects to an observation matching given-terms', () => {
  const out = bridgeImmunisations({
    observations: [{ name: 'HbA1c' }],
    immunisations: [{ label: 'Seasonal influenza vaccination', date: '2026-10-14', status: 'completed' }],
  });
  const proj = out.observations.find((o) => o.source === 'immunisation-bridge');
  assert.equal(proj.name, 'Seasonal influenza vaccination');
  assert.equal(out.observations.length, 2);
});

test('bridge: not-done Immunization projects to "<vaccine> declined"; no-op without immunisations', () => {
  const declined = bridgeImmunisations({
    immunisations: [{ label: 'Seasonal influenza vaccination', date: '2026-10-01', status: 'not-done' }],
  });
  assert.equal(declined.observations[0].name, 'Seasonal influenza vaccination declined');
  const plain = { observations: [{ name: 'x' }] };
  assert.strictEqual(bridgeImmunisations(plain), plain);
});

// ── shadow-compare (the feed-swap safety gate) ───────────────────────────────

const chip = (ruleId, status, type = 'drug') => ({ ruleId, status, type });

test('shadow-compare: identical feeds pass; dropped/weakened alerts are regressions', () => {
  const same = diffChips([chip('a', 'overdue')], [chip('a', 'overdue')]);
  assert.equal(same.safe, true);

  const dropped = diffChips([chip('a', 'overdue')], []);
  assert.equal(dropped.safe, false);
  assert.equal(dropped.regressions[0].kind, 'dropped');

  const weakened = diffChips([chip('a', 'overdue')], [chip('a', 'achieved')]);
  assert.equal(weakened.safe, false);

  const escalated = diffChips([chip('a', 'achieved')], [chip('a', 'overdue')]);
  assert.equal(escalated.safe, true); // stronger alerting is not a safety regression
});

test('shadow-compare: triage red/amber levels are ranked (dropped triage alert = regression)', () => {
  const r = diffChips([chip('allergy', 'amber', 'triage')], []);
  assert.equal(r.safe, false);
});

test('shadow-compare: diffSeverity flags downgraded level / lost urgent counts', () => {
  assert.equal(diffSeverity({ level: 'red', urgentCount: 1 }, { level: 'red', urgentCount: 1 }).safe, true);
  const reg = diffSeverity(
    { level: 'red', urgentCount: 1, abnormalCount: 2 },
    { level: 'amber', urgentCount: 0, abnormalCount: 1 }
  );
  assert.equal(reg.safe, false);
  assert.ok(reg.regressions.some((x) => x.field === 'level'));
});
