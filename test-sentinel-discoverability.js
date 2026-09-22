// Medicus Suite — Monitoring / Sentinel discoverability copy
// Run with: node test-sentinel-discoverability.js
//
// Pins the words a clinician uses to tell drug monitoring from QOF, to find
// the evidence behind a chip, and to turn the (default-off) queue chips on.
// Source-grep plus a render of the shared chip renderer. No patient data.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const root = __dirname;
function src(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const sentinel = src('side-panel/modules/sentinel/sentinel.js');
const sweep = src('side-panel/modules/sweep/sweep.js');
const worklist = src('side-panel/modules/sweep/worklist.js');
const handout = src('side-panel/modules/sweep/handout.js');
const passport = src('side-panel/modules/sentinel/passport.js');
const renderer = src('shared/chip-renderer.js');

console.log('\n--- Monitoring tab: drug monitoring vs QOF, evidence, queue switch ---');

check(sentinel.includes('Drug monitoring and QOF'), 'eyebrow names both checks');
check(!sentinel.includes('Clinical Monitoring'), 'eyebrow no longer says Clinical Monitoring');
check(
  sentinel.includes('Open Evidence on a chip for the result and the date'),
  'orientation tells the clinician to open Evidence'
);
check(
  sentinel.includes('A QOF row that is in date still leaves the drug-monitoring line to read on its own'),
  'orientation keeps QOF and drug monitoring as separate reads'
);
check(sentinel.includes('QUEUE_MONITORING_SWITCH'), 'queue-chip switch path is a single constant');
check(
  sentinel.includes('Baseline chips → Queue, the rows named High-risk drug monitoring'),
  'empty states name how to turn queue chips on'
);
check(
  sentinel.includes('Bloods and checks for the medicine. Listed apart from QOF.'),
  'drug-monitoring section caption'
);
check(
  sentinel.includes('Contract indicators for this QOF year. Listed apart from drug-monitoring bloods.'),
  'QOF section caption'
);
check(sentinel.includes('Drug monitoring'), 'brief group is labelled Drug monitoring');
check(sentinel.includes('QOF indicators'), 'brief group is labelled QOF indicators');
check(
  sentinel.includes('Nothing due in drug monitoring, QOF or vaccines'),
  'brief all-clear names the separate checks'
);
check(
  sentinel.includes('Monitoring due is the drug-monitoring chip only'),
  'patient-page chip is named as drug monitoring'
);

console.log('\n--- Evidence affordance on the chip ---');

check(renderer.includes('function evidenceMark'), 'renderer has one evidence label');
check((renderer.match(/evidenceMark\(!!chip\.evidence\)/g) || []).length === 6, 'every chip family uses it');
const CR = require('./shared/chip-renderer.js');
const drugWith = CR.renderDrugChip({
  type: 'drug-monitoring',
  ruleId: 'example-mtx',
  drugName: 'Methotrexate',
  status: 'overdue',
  tests: [],
  evidence: { summary: 'example', facts: [] },
});
const drugWithout = CR.renderDrugChip({
  type: 'drug-monitoring',
  ruleId: 'example-mtx',
  drugName: 'Methotrexate',
  status: 'in_date',
  tests: [],
});
const qofWith = CR.renderQofIndicatorChip({
  type: 'qof-indicator',
  ruleId: 'example-hyp',
  indicatorCode: 'HYP008',
  indicatorName: 'Blood pressure',
  status: 'not_met',
  evidence: { facts: [] },
});
check(drugWith.includes('sent-chip-evidence">Evidence'), 'drug chip with evidence shows Evidence');
check(drugWith.includes('sent-chip-chevron'), 'chevron stays beside the Evidence label');
check(!drugWithout.includes('sent-chip-evidence'), 'drug chip without evidence has no Evidence label');
check(qofWith.includes('sent-chip-evidence">Evidence'), 'QOF chip with evidence shows Evidence');

console.log('\n--- Sweep and print: QOF is not labelled as a review ---');

check(sweep.includes('>QOF (${worklist.reviews.length})'), 'prep column is labelled QOF');
check(!sweep.includes('>Reviews ('), 'prep column is no longer labelled Reviews');
check(sweep.includes("? 'QOF '"), 'action-needed QOF chips are prefixed QOF');
check(sweep.includes("? 'Safety '"), 'safety-surveillance chips are not prefixed QOF');
check(sweep.includes('Open the Monitoring tab on that patient'), 'sweep points at Monitoring for evidence');
check(worklist.includes("sectionHtml('QOF indicators'"), 'printed prep list says QOF indicators');
check(!worklist.includes("sectionHtml('Reviews'"), 'printed prep list no longer says Reviews');
check(worklist.includes('Bloods and checks are drug monitoring'), 'print caveat separates bloods from QOF');
check(handout.includes('Monitoring tab'), 'hidden-alert note names the Monitoring tab');
check(!handout.includes('Sentinel panel'), 'handout no longer says Sentinel panel');
check(passport.includes('Monitoring tab'), 'summary empty state names the Monitoring tab');
check(passport.includes('Print summary'), 'summary empty state names the real button');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
