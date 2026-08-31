// Medicus Suite — clinical threshold drift-guard test
// Run with:  node test-clinical-thresholds-sync.js
//
// PURPOSE: Pin the clinical boundary values in trends.js (eGFR/ACR stage
// functions + band arrays) and trend-chart.js (bpTarget). If those
// thresholds change, this test fails and forces a deliberate edit.
//
// This is a CHARACTERISATION test — it pins the REAL current values found
// in the source. Do not edit the expected values here without first verifying
// the change in the source files.
//
// TECHNIQUE: vm-extraction (see test-viewer-phase1.js / test-sentinel-panel-state.js
// for the established pattern). trend-chart.js is imported dynamically since
// it is a clean ESM with no browser globals.

'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else       { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
}

// ── 1. trends.js — gStage() / aStage() ─────────────────────────────────────

const trendsSrc = fs.readFileSync(
  path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8'
);

// Extract function gStage (ends at the closing brace on its own line)
const gStageM = trendsSrc.match(/function gStage\([\s\S]*?\n\}/);
check(!!gStageM, 'gStage extracted from trends.js');

// Extract function aStage
const aStageM = trendsSrc.match(/function aStage\([\s\S]*?\n\}/);
check(!!aStageM, 'aStage extracted from trends.js');

let gStage = null, aStage = null;
if (gStageM && aStageM) {
  const sandbox = {};
  vm.runInNewContext(
    gStageM[0] + '\n' + aStageM[0] +
    '\nthis.gStage = gStage; this.aStage = aStage;',
    sandbox
  );
  gStage = sandbox.gStage;
  aStage = sandbox.aStage;
}

console.log('\n--- gStage() KDIGO eGFR boundaries ---');
check(gStage && gStage(90)    === 'G1',  'gStage(90)    === G1   (≥90 → G1)');
check(gStage && gStage(89.9)  === 'G2',  'gStage(89.9)  === G2   (89.9 is G2)');
check(gStage && gStage(60)    === 'G2',  'gStage(60)    === G2   (60 is G2)');
check(gStage && gStage(59.9)  === 'G3a', 'gStage(59.9)  === G3a  (59.9 is G3a)');
check(gStage && gStage(45)    === 'G3a', 'gStage(45)    === G3a  (45 is G3a)');
check(gStage && gStage(44.9)  === 'G3b', 'gStage(44.9)  === G3b  (44.9 is G3b)');
check(gStage && gStage(30)    === 'G3b', 'gStage(30)    === G3b  (30 is G3b)');
check(gStage && gStage(29.9)  === 'G4',  'gStage(29.9)  === G4   (29.9 is G4)');
check(gStage && gStage(15)    === 'G4',  'gStage(15)    === G4   (15 is G4)');
check(gStage && gStage(14.9)  === 'G5',  'gStage(14.9)  === G5   (<15 → G5)');

console.log('\n--- aStage() KDIGO ACR boundaries ---');
check(aStage && aStage(2.9)  === 'A1', 'aStage(2.9)  === A1  (<3 → A1)');
check(aStage && aStage(3)    === 'A2', 'aStage(3)    === A2  (3 is A2)');
check(aStage && aStage(30)   === 'A2', 'aStage(30)   === A2  (≤30 → A2)');
check(aStage && aStage(30.1) === 'A3', 'aStage(30.1) === A3  (>30 → A3)');

// ── 2. trends.js — egfrBands / acrBands ──────────────────────────────────────

// egfrBands is declared inside renderRenal() — extract it as a literal
const egfrBandsM = trendsSrc.match(/const egfrBands = \[[\s\S]*?\];/);
check(!!egfrBandsM, 'egfrBands extracted from trends.js');

// acrBands is inside buildRenalModel()
const acrBandsM = trendsSrc.match(/const acrBands = \[[\s\S]*?\];/);
check(!!acrBandsM, 'acrBands extracted from trends.js');

let egfrBands = null, acrBands = null;
if (egfrBandsM) {
  const sb = {};
  vm.runInNewContext(egfrBandsM[0] + '\nthis.egfrBands = egfrBands;', sb);
  egfrBands = sb.egfrBands;
}
if (acrBandsM) {
  const sb = {};
  vm.runInNewContext(acrBandsM[0] + '\nthis.acrBands = acrBands;', sb);
  acrBands = sb.acrBands;
}

console.log('\n--- egfrBands boundary set ---');
if (egfrBands) {
  const boundaries = new Set([...egfrBands.map(b => b.lo), ...egfrBands.map(b => b.hi)]);
  const expected = new Set([0, 15, 30, 45, 60, 90, 200]);
  check(
    [...expected].every(v => boundaries.has(v)) && [...boundaries].every(v => expected.has(v)),
    'egfrBands boundary set === {0,15,30,45,60,90,200}'
  );
}

console.log('\n--- acrBands boundary set ---');
if (acrBands) {
  const boundaries = new Set([...acrBands.map(b => b.lo), ...acrBands.map(b => b.hi)]);
  const expected = new Set([0, 3, 30, 100]);
  check(
    [...expected].every(v => boundaries.has(v)) && [...boundaries].every(v => expected.has(v)),
    'acrBands boundary set === {0,3,30,100}'
  );
}

// ── 3. trend-chart.js — bpTarget() ───────────────────────────────────────────
//
// trend-chart.js is a pure ESM with no browser globals — import it dynamically.

console.log('\n--- bpTarget() NICE NG136 targets ---');
async function testBpTarget() {
  const { bpTarget } = await import('./side-panel/modules/shared/trend-chart.js');
  check(typeof bpTarget === 'function', 'bpTarget imported from trend-chart.js');

  // CKD + acrOver70 → 130/80 (most intensive CKD + proteinuria target)
  const ckd = bpTarget([{ code: 'CKD' }], 65, true);
  check(ckd && ckd.sys === 130 && ckd.dia === 80, 'CKD + acrOver70 → sys:130 dia:80');

  // HYP aged ≥80 → 150/90 (NICE NG136 §1.4 — relaxed elderly target)
  const hyp80 = bpTarget([{ code: 'HYP' }], 80, false);
  check(hyp80 && hyp80.sys === 150 && hyp80.dia === 90, 'HYP age≥80 → sys:150 dia:90');

  // HYP younger → 140/90
  const hyp60 = bpTarget([{ code: 'HYP' }], 60, false);
  check(hyp60 && hyp60.sys === 140 && hyp60.dia === 90, 'HYP age<80 → sys:140 dia:90');

  // DM (no HYP, no CKD) → 140/90
  const dm = bpTarget([{ code: 'DM' }], 55, false);
  check(dm && dm.sys === 140 && dm.dia === 90, 'DM → sys:140 dia:90');

  // CHD → 140/90
  const chd = bpTarget([{ code: 'CHD' }], 55, false);
  check(chd && chd.sys === 140 && chd.dia === 90, 'CHD → sys:140 dia:90');

  // STIA → 140/90
  const stia = bpTarget([{ code: 'STIA' }], 55, false);
  check(stia && stia.sys === 140 && stia.dia === 90, 'STIA → sys:140 dia:90');

  // No register → null
  const none = bpTarget([], 55, false);
  check(none === null, 'no relevant register → null');
}

// ── Run async then report ────────────────────────────────────────────────────

testBpTarget().then(() => {
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}).catch(err => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
