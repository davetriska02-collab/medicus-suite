'use strict';

// Regression test for scripts/check-no-patient-data.js — the patient-data CI
// guard. Exercises the two pure decision functions so a future edit that breaks
// NHS-number validation or path matching fails CI instead of silently letting
// patient data through.

const assert = require('assert');
const { isValidNhsNumber, isForbiddenPath } = require('./scripts/check-no-patient-data.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (e) {
    failures++;
    console.error('not ok - ' + name + '\n  ' + e.message);
  }
}

check('valid Modulus-11 NHS numbers are detected', () => {
  // 9434765919 is the canonical NHS example number; 9000000009 is from the
  // synthetic test range — both pass Modulus-11.
  assert.strictEqual(isValidNhsNumber('9434765919'), true);
  assert.strictEqual(isValidNhsNumber('9000000009'), true);
});

check('numbers with the wrong check digit are rejected', () => {
  assert.strictEqual(isValidNhsNumber('9434765918'), false);
  assert.strictEqual(isValidNhsNumber('9434765910'), false);
});

check('non-10-digit inputs are rejected', () => {
  assert.strictEqual(isValidNhsNumber('123456789'), false); // 9 digits
  assert.strictEqual(isValidNhsNumber('12345678901'), false); // 11 digits
  assert.strictEqual(isValidNhsNumber('94347659x9'), false); // non-digit
});

check('a check digit computing to 10 is invalid', () => {
  // 1234567890 -> weighted sum gives remainder 1 -> check 10 -> invalid.
  assert.strictEqual(isValidNhsNumber('1234567890'), false);
});

check('forbidden patient-data paths are matched', () => {
  assert.strictEqual(isForbiddenPath('uploads/scan.pdf'), true);
  assert.strictEqual(isForbiddenPath('data/sars/patient.json'), true);
  assert.strictEqual(isForbiddenPath('output/export.csv'), true);
});

check('legitimate source paths are not matched', () => {
  assert.strictEqual(isForbiddenPath('engine/rules-engine.js'), false);
  assert.strictEqual(isForbiddenPath('docs/uploads-guide.md'), false); // not under uploads/
  assert.strictEqual(isForbiddenPath('side-panel/panel.js'), false);
});

if (failures) {
  console.error(`\n${failures} assertion group(s) failed`);
  process.exit(1);
}
console.log('\nAll patient-data guard tests passed');
