// Medicus Suite — clinical threshold consumption + value-pin test
// Run with:  node test-clinical-thresholds-sync.js
//
// PURPOSE: Pin the clinical boundary values that used to be duplicated between
// trends.js and visualiser-core.js. They now live in shared/clinical-thresholds.js.
// This test:
//   1. consumes the shared module (require)
//   2. pins the REAL current values (characterisation — do not edit without
//      verifying the clinical source)
//   3. asserts the former copy-sites consume the shared module rather than
//      re-defining the literals
//
// No-value-change extract (architecture plan Phase 2.2) — flagged to CSO as a
// location refactor only.

'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0,
  failed = 0;
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

const CT = require('./shared/clinical-thresholds.js');
const { gStage, aStage, EGFR_BANDS, ACR_BANDS, CLINICAL_ZONES, RCV_TABLE } = CT;

console.log('\n--- shared module exports ---');
check(typeof gStage === 'function' && typeof aStage === 'function', 'gStage/aStage exported');
check(Array.isArray(EGFR_BANDS) && Array.isArray(ACR_BANDS), 'band arrays exported');
check(CLINICAL_ZONES && RCV_TABLE, 'CLINICAL_ZONES + RCV_TABLE exported');

console.log('\n--- gStage() KDIGO eGFR boundaries ---');
check(gStage(90) === 'G1', 'gStage(90)    === G1   (≥90 → G1)');
check(gStage(89.9) === 'G2', 'gStage(89.9)  === G2   (89.9 is G2)');
check(gStage(60) === 'G2', 'gStage(60)    === G2   (60 is G2)');
check(gStage(59.9) === 'G3a', 'gStage(59.9) === G3a  (59.9 is G3a)');
check(gStage(45) === 'G3a', 'gStage(45)    === G3a  (45 is G3a)');
check(gStage(44.9) === 'G3b', 'gStage(44.9) === G3b  (44.9 is G3b)');
check(gStage(30) === 'G3b', 'gStage(30)    === G3b  (30 is G3b)');
check(gStage(29.9) === 'G4', 'gStage(29.9)  === G4   (29.9 is G4)');
check(gStage(15) === 'G4', 'gStage(15)    === G4   (15 is G4)');
check(gStage(14.9) === 'G5', 'gStage(14.9)  === G5   (<15 → G5)');

console.log('\n--- aStage() KDIGO ACR boundaries ---');
check(aStage(2.9) === 'A1', 'aStage(2.9)  === A1  (<3 → A1)');
check(aStage(3) === 'A2', 'aStage(3)    === A2  (3 is A2)');
check(aStage(30) === 'A2', 'aStage(30)   === A2  (≤30 → A2)');
check(aStage(30.1) === 'A3', 'aStage(30.1) === A3  (>30 → A3)');

console.log('\n--- egfrBands / acrBands boundary set ---');
{
  const boundaries = new Set([...EGFR_BANDS.map((b) => b.lo), ...EGFR_BANDS.map((b) => b.hi)]);
  const expected = new Set([0, 15, 30, 45, 60, 90, 200]);
  check(
    [...expected].every((v) => boundaries.has(v)) && [...boundaries].every((v) => expected.has(v)),
    'EGFR_BANDS boundary set === {0,15,30,45,60,90,200}'
  );
}
{
  const boundaries = new Set([...ACR_BANDS.map((b) => b.lo), ...ACR_BANDS.map((b) => b.hi)]);
  const expected = new Set([0, 3, 30, 100]);
  check(
    [...expected].every((v) => boundaries.has(v)) && [...boundaries].every((v) => expected.has(v)),
    'ACR_BANDS boundary set === {0,3,30,100}'
  );
}

console.log('\n--- CLINICAL_ZONES boundary sets ---');
{
  const egfr = CLINICAL_ZONES.egfr;
  const boundaries = new Set([...egfr.map((z) => z.from), ...egfr.map((z) => z.to)]);
  const expected = new Set([0, 15, 30, 45, 60, 90, 250]);
  check(
    [...expected].every((v) => boundaries.has(v)) && [...boundaries].every((v) => expected.has(v)),
    'CLINICAL_ZONES.egfr boundary set === {0,15,30,45,60,90,250}'
  );
}
{
  const hba1c = CLINICAL_ZONES.hba1c;
  const boundaries = new Set([...hba1c.map((z) => z.from), ...hba1c.map((z) => z.to)]);
  const expected = new Set([0, 42, 48, 58, 75, 250]);
  check(
    [...expected].every((v) => boundaries.has(v)) && [...boundaries].every((v) => expected.has(v)),
    'CLINICAL_ZONES.hba1c boundary set === {0,42,48,58,75,250}'
  );
}
{
  const sbp = CLINICAL_ZONES['systolic blood pressure'];
  const boundaries = new Set([...sbp.map((z) => z.from), ...sbp.map((z) => z.to)]);
  const expected = new Set([0, 120, 140, 160, 300]);
  check(
    [...expected].every((v) => boundaries.has(v)) && [...boundaries].every((v) => expected.has(v)),
    'CLINICAL_ZONES[systolic] boundary set === {0,120,140,160,300}'
  );
}

console.log('\n--- RCV_TABLE spot-check ---');
check(RCV_TABLE['sodium'] === 0.013, 'sodium    RCV = 0.013');
check(RCV_TABLE['potassium'] === 0.05, 'potassium RCV = 0.05');
check(RCV_TABLE['egfr'] === 0.14, 'egfr      RCV = 0.14');
check(RCV_TABLE['hba1c'] === 0.12, 'hba1c     RCV = 0.12');

console.log('\n--- consumers do not redefine the literals ---');
const trendsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8');
const vcSrc = fs.readFileSync(path.join(__dirname, 'visualiser-core.js'), 'utf8');
const tcSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'shared', 'trend-chart.js'), 'utf8');
check(trendsSrc.includes('globalThis.ClinicalThresholds'), 'trends.js consumes ClinicalThresholds');
check(!/function gStage\(/.test(trendsSrc), 'trends.js no longer defines gStage');
check(vcSrc.includes('globalThis.ClinicalThresholds'), 'visualiser-core.js consumes ClinicalThresholds');
check(!/const CLINICAL_ZONES = \{/.test(vcSrc), 'visualiser-core.js no longer defines CLINICAL_ZONES');
check(!/const RCV_TABLE = \{/.test(vcSrc), 'visualiser-core.js no longer defines RCV_TABLE');
check(tcSrc.includes('ClinicalThresholds'), 'trend-chart.js consumes ClinicalThresholds');
check(!/codes\.has\('CKD'\) && acrOver70/.test(tcSrc), 'trend-chart.js no longer inlines bpTarget logic');

console.log('\n--- bpTarget() NICE NG136 targets ---');
async function testBpTarget() {
  const { bpTarget } = await import('./side-panel/modules/shared/trend-chart.js');
  check(typeof bpTarget === 'function', 'bpTarget imported from trend-chart.js');

  const ckd = bpTarget([{ code: 'CKD' }], 65, true);
  check(ckd && ckd.sys === 130 && ckd.dia === 80, 'CKD + acrOver70 → sys:130 dia:80');

  const hyp80 = bpTarget([{ code: 'HYP' }], 80, false);
  check(hyp80 && hyp80.sys === 150 && hyp80.dia === 90, 'HYP age≥80 → sys:150 dia:90');

  const hyp60 = bpTarget([{ code: 'HYP' }], 60, false);
  check(hyp60 && hyp60.sys === 140 && hyp60.dia === 90, 'HYP age<80 → sys:140 dia:90');

  const dm = bpTarget([{ code: 'DM' }], 55, false);
  check(dm && dm.sys === 140 && dm.dia === 90, 'DM → sys:140 dia:90');

  const chd = bpTarget([{ code: 'CHD' }], 55, false);
  check(chd && chd.sys === 140 && chd.dia === 90, 'CHD → sys:140 dia:90');

  const stia = bpTarget([{ code: 'STIA' }], 55, false);
  check(stia && stia.sys === 140 && stia.dia === 90, 'STIA → sys:140 dia:90');

  const none = bpTarget([], 55, false);
  check(none === null, 'no relevant register → null');
}

testBpTarget()
  .then(() => {
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((err) => {
    console.error('FATAL:', err);
    process.exitCode = 1;
  });
