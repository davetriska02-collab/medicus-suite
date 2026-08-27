// Medicus Suite — doac-core.js unit tests
// Run with: node test-doac-core.js
//
// Pins Cockcroft-Gault arithmetic, fail-closed inputs, DOAC detection,
// SPS/EHRA monitoring bands, drug-specific renal flags, and the "never
// treat a missing CrCl as a reassuring band" rule (D-001 adjacent).

'use strict';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

async function runTests() {
  const modPath = new URL('side-panel/modules/trends/doac-core.js', `file://${process.cwd().replace(/\\/g, '/')}/`)
    .href;

  let core;
  try {
    core = await import(modPath);
    check(typeof core.cockcroftGault === 'function', 'cockcroftGault imported');
  } catch (e) {
    console.error('FATAL: could not import doac-core.js:', e.message);
    process.exitCode = 1;
    return;
  }

  const {
    cockcroftGault,
    normalizeCreatinineUmol,
    identifyDoac,
    findDoacs,
    findIndication,
    findInteractingMeds,
    crclMonitorBand,
    drugRenalFlags,
    pairWeightForDate,
    buildCrclSeries,
    buildDoacModel,
    patientOnDoac,
    creatSeries,
    CG_MALE,
    CG_FEMALE,
    DOAC_TERMS,
  } = core;

  console.log('\n--- Cockcroft-Gault worked examples (UK SI) ---');
  // Male 70y 80kg creat 100 → ((140-70)×80×1.23)/100 = 68.88
  const m70 = cockcroftGault({ ageYears: 70, sex: 'male', weightKg: 80, creatUmol: 100 });
  check(Math.abs(m70.crcl - 68.88) < 0.01, `male 70/80kg/100 → 68.88 (got ${m70.crcl})`);
  check(m70.factor === CG_MALE, 'male factor 1.23');

  // Female 80y 55kg creat 120 → ((140-80)×55×1.04)/120 = 28.6
  const f80 = cockcroftGault({ ageYears: 80, sex: 'female', weightKg: 55, creatUmol: 120 });
  check(Math.abs(f80.crcl - 28.6) < 0.01, `female 80/55kg/120 → 28.6 (got ${f80.crcl})`);
  check(f80.factor === CG_FEMALE, 'female factor 1.04');

  // Sex aliases
  check(cockcroftGault({ ageYears: 70, sex: 'M', weightKg: 80, creatUmol: 100 }).crcl != null, 'sex "M" accepted');
  check(
    cockcroftGault({ ageYears: 70, sex: 'Female', weightKg: 55, creatUmol: 120 }).crcl != null,
    'sex "Female" accepted'
  );

  console.log('\n--- Fail closed ---');
  const noSex = cockcroftGault({ ageYears: 70, sex: null, weightKg: 80, creatUmol: 100 });
  check(noSex.crcl == null && noSex.missing.includes('sex'), 'unknown sex → no CrCl');
  const noAge = cockcroftGault({ ageYears: null, sex: 'male', weightKg: 80, creatUmol: 100 });
  check(noAge.crcl == null && noAge.missing.includes('age'), 'missing age → no CrCl');
  const noWt = cockcroftGault({ ageYears: 70, sex: 'male', weightKg: null, creatUmol: 100 });
  check(noWt.crcl == null && noWt.missing.includes('weight'), 'missing weight → no CrCl');
  const child = cockcroftGault({ ageYears: 16, sex: 'male', weightKg: 60, creatUmol: 70 });
  check(child.crcl == null && child.reason === 'paediatric', 'age 16 → paediatric refuse');
  const otherSex = cockcroftGault({ ageYears: 70, sex: 'other', weightKg: 80, creatUmol: 100 });
  check(otherSex.crcl == null && otherSex.missing.includes('sex'), 'sex "other" → no CrCl (cannot pick F)');

  console.log('\n--- Creatinine units ---');
  check(normalizeCreatinineUmol(88, 'µmol/L').umol === 88, 'µmol/L passthrough');
  check(normalizeCreatinineUmol(88, 'umol/l').umol === 88, 'umol/l passthrough');
  check(Math.abs(normalizeCreatinineUmol(1.0, 'mg/dL').umol - 88.4) < 0.01, 'mg/dL × 88.4');
  check(normalizeCreatinineUmol(10, '').umol == null, 'bare value ≤20 without unit → refuse');
  check(normalizeCreatinineUmol(88, '').umol === 88, 'bare value >20 assumed μmol/L');
  check(normalizeCreatinineUmol(0.088, 'mmol/L').umol === 88, 'mmol/L × 1000');

  console.log('\n--- DOAC detection (generic + UK brands) ---');
  check(identifyDoac('Apixaban 5mg tablets')?.key === 'apixaban', 'apixaban generic');
  check(identifyDoac('Eliquis 2.5mg tablets')?.key === 'apixaban', 'Eliquis brand');
  check(identifyDoac('Xarelto 20mg tablets')?.key === 'rivaroxaban', 'Xarelto brand');
  check(identifyDoac('Lixiana 60mg tablets')?.key === 'edoxaban', 'Lixiana brand');
  check(identifyDoac('Pradaxa 150mg capsules')?.key === 'dabigatran', 'Pradaxa brand');
  check(identifyDoac('Warfarin 3mg tablets') == null, 'warfarin is not a DOAC');
  check(identifyDoac('Enoxaparin 40mg') == null, 'LMWH is not a DOAC');
  const found = findDoacs([
    { name: 'Eliquis 5mg tablets', dosage: '5mg twice daily' },
    { name: 'Atorvastatin 20mg tablets' },
  ]);
  check(found.length === 1 && found[0].key === 'apixaban', 'findDoacs returns the DOAC only');
  check(found[0].dosage === '5mg twice daily', 'dosage preserved');
  check(
    DOAC_TERMS.every((d) => d.match.length >= 2),
    'each DOAC lists generic + brand'
  );

  console.log('\n--- Indication / interactions ---');
  check(findIndication([{ label: 'Atrial fibrillation' }]).includes('AF'), 'AF from atrial fibrillation');
  check(findIndication([{ label: 'Deafness' }]).length === 0, 'deafness is not AF');
  check(findIndication([{ label: 'Pulmonary embolism' }]).includes('PE'), 'PE');
  check(findIndication([{ label: 'Deep vein thrombosis' }]).includes('DVT'), 'DVT');
  const nsaid = findInteractingMeds([{ name: 'Naproxen 500mg tablets' }]);
  check(nsaid.length === 1 && nsaid[0].kind === 'NSAID', 'naproxen flagged as NSAID');
  const asp = findInteractingMeds([{ name: 'Aspirin 75mg tablets' }]);
  check(asp.length === 1 && asp[0].kind === 'antiplatelet', 'aspirin flagged as antiplatelet');
  check(findInteractingMeds([{ name: 'Atorvastatin 20mg' }]).length === 0, 'statin not an interaction here');

  console.log('\n--- Monitoring bands (SPS / EHRA) ---');
  check(crclMonitorBand(70).id === 'annual' && crclMonitorBand(70).severity === 'ok', 'CrCl 70 → annual');
  check(crclMonitorBand(45).id === 'q6' && crclMonitorBand(45).severity === 'amber', 'CrCl 45 → 6-monthly');
  check(crclMonitorBand(20).id === 'q3' && crclMonitorBand(20).severity === 'red', 'CrCl 20 → 3-monthly');
  check(crclMonitorBand(10).id === 'contra' && crclMonitorBand(10).severity === 'red', 'CrCl 10 → contraindicated');
  check(
    crclMonitorBand(80, { ageYears: 82 }).id === 'elderly' && crclMonitorBand(80, { ageYears: 82 }).months === 6,
    'age >75 with CrCl 80 → 4–6 monthly, not annual'
  );
  check(crclMonitorBand(22, { drugKey: 'dabigatran' }).id === 'contra', 'dabigatran CrCl 22 → contraindicated (<30)');
  check(crclMonitorBand(22, { drugKey: 'apixaban' }).id === 'q3', 'apixaban CrCl 22 → 3-monthly, not contra');
  check(
    crclMonitorBand(null).id === 'unknown' && crclMonitorBand(null).severity === 'unknown',
    'null CrCl → unknown (not annual)'
  );

  console.log('\n--- Drug-specific flags ---');
  const dabiContra = drugRenalFlags('dabigatran', { crcl: 25 });
  check(
    dabiContra.some((f) => f.severity === 'red' && /contraindicated/i.test(f.text)),
    'dabigatran CrCl 25 → red contraindicated'
  );
  const apiDose = drugRenalFlags('apixaban', { crcl: 70, ageYears: 82, weightKg: 55, creatUmol: 140 });
  check(
    apiDose.some((f) => /dose-reduction/i.test(f.text)),
    'apixaban 2-of-3 criteria → review 2.5 mg'
  );
  const edoHigh = drugRenalFlags('edoxaban', { crcl: 110 });
  check(
    edoHigh.some((f) => /95/.test(f.text)),
    'edoxaban CrCl >95 caution'
  );
  check(
    drugRenalFlags('apixaban', { crcl: 80, ageYears: 70, weightKg: 80, creatUmol: 90 }).length === 0,
    'apixaban with no criteria → no flag'
  );

  console.log('\n--- Weight pairing / CrCl series ---');
  const wPts = [
    { date: '2025-01-01', value: 80 },
    { date: '2026-01-01', value: 78 },
  ];
  const paired = pairWeightForDate(wPts, '2026-03-01');
  check(paired && paired.value === 78, 'pairs most recent weight on or before creat date');
  const stale = pairWeightForDate([{ date: '2024-01-01', value: 80 }], '2026-06-01');
  check(stale && stale.stalePair === true, 'weight >90 days from creat is a stale pair');

  const series = buildCrclSeries({
    creatPts: [
      { date: '2026-01-15', value: 100, unit: 'µmol/L' },
      { date: '2026-06-15', value: 140, unit: 'µmol/L' },
    ],
    weightPts: [{ date: '2026-01-01', value: 80 }],
    ageYears: 70,
    sex: 'male',
    dob: '1956-01-01',
  });
  check(series.length === 2, 'two creat + one weight → two CrCl points');
  check(series[0].value > series[1].value, 'rising creat → falling CrCl');

  const noUrine = creatSeries([
    { name: 'Urine creatinine', unit: 'mmol/L', history: [{ date: '2026-01-01', value: 8 }] },
    { name: 'Serum creatinine', unit: 'µmol/L', history: [{ date: '2026-01-01', value: 88 }] },
  ]);
  check(noUrine.pts.length === 1 && noUrine.pts[0].value === 88, 'urine creatinine excluded; serum used');

  console.log('\n--- buildDoacModel ---');
  const now = new Date('2026-08-01T12:00:00Z');
  const model = buildDoacModel(
    {
      medications: [{ name: 'Apixaban 5mg tablets', dosage: '5mg twice daily' }],
      problems: [{ label: 'Atrial fibrillation' }],
      patientContext: { ageYears: 78, sex: 'male', dob: '1948-01-01' },
      observationHistory: [
        {
          name: 'Serum creatinine',
          unit: 'µmol/L',
          history: [{ date: '2026-06-01', value: 110 }],
        },
        {
          name: 'Weight',
          unit: 'kg',
          history: [{ date: '2026-05-01', value: 82 }],
        },
        {
          name: 'Haemoglobin',
          unit: 'g/L',
          history: [{ date: '2026-04-01', value: 132 }],
        },
      ],
    },
    now
  );
  check(model.onDoac === true, 'onDoac true');
  check(model.primary.key === 'apixaban', 'primary is apixaban');
  check(model.indications.includes('AF'), 'indication AF');
  check(Number.isFinite(model.crcl) && model.crclRounded === Math.round(model.crcl), 'CrCl calculated and rounded');
  check(model.band.id !== 'unknown', 'band assigned when CrCl present');
  check(model.lastFbc === '2026-04-01', 'last FBC from haemoglobin row');
  check(model.lastUe === '2026-06-01', 'last U&E from creatinine date');
  check(patientOnDoac({ medications: [{ name: 'Xarelto 20mg' }] }), 'patientOnDoac true for Xarelto');
  check(!patientOnDoac({ medications: [{ name: 'Ramipril 5mg' }] }), 'patientOnDoac false without DOAC');

  const empty = buildDoacModel({ medications: [], observationHistory: [], patientContext: {} }, now);
  check(empty.onDoac === false && empty.crcl == null, 'no DOAC, no CrCl');
  check(empty.band.severity === 'unknown', 'no CrCl → unknown band, never annual-by-default');

  const noInputs = buildDoacModel(
    {
      medications: [{ name: 'Dabigatran 150mg capsules' }],
      patientContext: { ageYears: 80 },
      observationHistory: [],
    },
    now
  );
  check(noInputs.onDoac === true, 'DOAC detected without labs');
  check(noInputs.crcl == null, 'no labs → no CrCl');
  check(/missing/i.test(noInputs.crclMessage), 'missing-input message names the gap');
  check(noInputs.band.id === 'unknown', 'cannot band without CrCl — does not invent annual');

  console.log('\n--- Trends source contract ---');
  const fs = require('fs');
  const path = require('path');
  const trendsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8');
  const sentinelSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');
  check(/key: 'doac'/.test(trendsSrc), 'trends.js declares a DOAC view');
  check(/requiresDoac/.test(trendsSrc), 'DOAC tab is gated on a current DOAC');
  check(/buildDoacModel/.test(trendsSrc), 'trends.js consumes buildDoacModel');
  check(/data-open-doac/.test(trendsSrc), 'renal card can open the DOAC view');
  check(/Cockcroft-Gault/.test(trendsSrc), 'UI names Cockcroft-Gault');
  check(/not eGFR/.test(trendsSrc), 'UI says CrCl is not eGFR');
  check(
    !/\b(Done|Sent|Booked|Submitted|safe to prescribe|all clear)\b/.test(trendsSrc),
    'no completion / all-clear claims'
  );
  check(/medications: \(rawData\.medications/.test(sentinelSrc), 'getTrendData now carries medications');
  check(/This view never hides a due test/.test(trendsSrc), 'DOAC view states it never hides a due test');

  console.log(`\n${passed} passed, ${failed} failed`);
}

runTests();
