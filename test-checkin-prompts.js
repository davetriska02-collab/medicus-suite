// Medicus Suite — checkin-prompts (composite feature B, "while you're here") tests
// Run with: node --test test-checkin-prompts.js
//
// shared/checkin-prompts.js is a DORMANT pure prompt-builder — nothing calls it
// yet (see its header for the Friday wiring point). These tests construct
// synthetic chips matching the REAL shapes engine/rules-engine.js produces
// (verified against evaluateDrugRule / evaluateDrugAllergyRule /
// evaluateDrugComboRule / evaluateVaccineRule / evaluateQofIndicatorRule) and
// drive buildCheckinPrompts() directly — no engine call, no patient/NHS data
// beyond fixture chip fields.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildCheckinPrompts, listSupportedChipTypes } = require('./shared/checkin-prompts.js');

// ── Synthetic chip fixtures (real engine shapes) ────────────────────────────
// NHS numbers, where present anywhere in this repo's fixtures, must be
// checksum-invalid; these chip fixtures carry no NHS number at all, but any
// patient-identifying value here (names, drug names) is fully synthetic.

const drugAllergyAlert = {
  type: 'drug-allergy',
  ruleId: 'allergy-penicillin',
  status: 'alert',
  label: 'Penicillin allergy + Amoxicillin',
  matchSummary: 'Penicillin allergy + Amoxicillin',
};

const drugComboAlert = {
  type: 'drug-combo',
  ruleId: 'combo-triple-whammy',
  status: 'alert',
  label: 'Triple Whammy (NSAID + ACEi/ARB + diuretic)',
  matchSummary: [
    { setName: 'NSAID', drugs: ['Ibuprofen 400mg tablets'] },
    { setName: 'ACEi/ARB', drugs: ['Ramipril 5mg capsules'] },
    { setName: 'Diuretic', drugs: ['Furosemide 40mg tablets'] },
  ],
};

function drugMonitoringChip(status) {
  return {
    type: 'drug-monitoring',
    ruleId: 'lithium-monitoring',
    drugName: 'Lithium carbonate 400mg tablets',
    drugClass: 'Lithium',
    status,
    tests: [],
  };
}

function vaccineChip(status) {
  return {
    type: 'vaccine',
    ruleId: 'flu-vaccine',
    vaccine: 'flu',
    displayName: 'Flu vaccine',
    status,
    eligibilityReason: 'Age 65+',
    seasonLabel: '2025/26',
  };
}

function qofIndicatorChip(status) {
  return {
    type: 'qof-indicator',
    ruleId: 'bp-control',
    indicatorCode: 'HYP007',
    indicatorName: 'Blood pressure control (last 12mo)',
    status,
  };
}

// ── Safety (drug-allergy / drug-combo alert) ────────────────────────────────

test('drug-allergy alert produces an URGENT-prefixed safety prompt, sorted first', () => {
  const prompts = buildCheckinPrompts([qofIndicatorChip('not_met'), drugAllergyAlert]);
  assert.equal(prompts[0].kind, 'safety');
  assert.equal(prompts[0].label, 'URGENT: Penicillin allergy + Amoxicillin');
  assert.strictEqual(prompts[0].sourceChip, drugAllergyAlert);
  assert.ok(prompts[0].priority < prompts[1].priority, 'safety must outrank the qof prompt');
});

test('drug-combo alert also produces an URGENT-prefixed safety prompt', () => {
  const prompts = buildCheckinPrompts([drugComboAlert]);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].kind, 'safety');
  assert.equal(prompts[0].label, 'URGENT: Triple Whammy (NSAID + ACEi/ARB + diuretic)');
});

test('safety prompts are NEVER capped out, even with maxPrompts=1 and many other prompts', () => {
  const chips = [
    drugAllergyAlert,
    drugComboAlert,
    qofIndicatorChip('not_met'),
    vaccineChip('vax_due'),
    drugMonitoringChip('overdue'),
    drugMonitoringChip('stale'),
  ];
  const prompts = buildCheckinPrompts(chips, { maxPrompts: 1 });
  const safety = prompts.filter((p) => p.kind === 'safety');
  const rest = prompts.filter((p) => p.kind !== 'safety');
  assert.equal(safety.length, 2, 'both safety chips survive the cap');
  assert.equal(rest.length, 1, 'the cap of 1 still applies to everything else');
  // Safety prompts lead the array.
  assert.equal(prompts[0].kind, 'safety');
  assert.equal(prompts[1].kind, 'safety');
});

// ── drug-monitoring ──────────────────────────────────────────────────────────

test('drug-monitoring overdue -> a monitoring prompt naming the drug', () => {
  const prompts = buildCheckinPrompts([drugMonitoringChip('overdue')]);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].kind, 'monitoring');
  assert.equal(prompts[0].label, 'Bloods overdue for Lithium carbonate 400mg tablets');
});

test('drug-monitoring stale (severely overdue) also -> a monitoring prompt', () => {
  const prompts = buildCheckinPrompts([drugMonitoringChip('stale')]);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].kind, 'monitoring');
});

test('drug-monitoring in_date (ok) -> no prompt', () => {
  assert.deepEqual(buildCheckinPrompts([drugMonitoringChip('in_date')]), []);
});

test('drug-monitoring due_soon / no_data / recently_initiated -> no prompt (only overdue/stale are actionable at check-in)', () => {
  for (const status of ['due_soon', 'no_data', 'recently_initiated']) {
    assert.deepEqual(buildCheckinPrompts([drugMonitoringChip(status)]), [], `status=${status}`);
  }
});

// ── vaccine ──────────────────────────────────────────────────────────────────

test('vaccine vax_due -> a vaccine prompt naming the vaccine', () => {
  const prompts = buildCheckinPrompts([vaccineChip('vax_due')]);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].kind, 'vaccine');
  assert.equal(prompts[0].label, 'Flu vaccine due');
});

test('vaccine vax_given (complete) -> no prompt', () => {
  assert.deepEqual(buildCheckinPrompts([vaccineChip('vax_given')]), []);
});

test('vaccine vax_declined -> no prompt (declined is not actionable)', () => {
  assert.deepEqual(buildCheckinPrompts([vaccineChip('vax_declined')]), []);
});

// ── qof-indicator ────────────────────────────────────────────────────────────

test('qof-indicator not_met -> a qof prompt naming the indicator', () => {
  const prompts = buildCheckinPrompts([qofIndicatorChip('not_met')]);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].kind, 'qof');
  assert.equal(prompts[0].label, 'Blood pressure control (last 12mo) owed');
});

test('qof-indicator achieved (met) -> no prompt', () => {
  assert.deepEqual(buildCheckinPrompts([qofIndicatorChip('achieved')]), []);
});

test('qof-indicator no_data / overdue -> no prompt (policy only maps not_met)', () => {
  for (const status of ['no_data', 'overdue']) {
    assert.deepEqual(buildCheckinPrompts([qofIndicatorChip(status)]), [], `status=${status}`);
  }
});

// ── sort order / stability ──────────────────────────────────────────────────

test('sort order is priority-respecting: monitoring > vaccine > qof, with safety always first', () => {
  const chips = [qofIndicatorChip('not_met'), vaccineChip('vax_due'), drugMonitoringChip('overdue'), drugAllergyAlert];
  const prompts = buildCheckinPrompts(chips);
  assert.deepEqual(
    prompts.map((p) => p.kind),
    ['safety', 'monitoring', 'vaccine', 'qof']
  );
});

test('sort is stable: equal-priority prompts keep their input order', () => {
  const qofA = { ...qofIndicatorChip('not_met'), ruleId: 'qof-a', indicatorName: 'Indicator A' };
  const qofB = { ...qofIndicatorChip('not_met'), ruleId: 'qof-b', indicatorName: 'Indicator B' };
  const prompts = buildCheckinPrompts([qofB, qofA]);
  assert.deepEqual(
    prompts.map((p) => p.label),
    ['Indicator B owed', 'Indicator A owed']
  );
});

// ── empty input / cap ───────────────────────────────────────────────────────

test('empty/None chips input -> []', () => {
  assert.deepEqual(buildCheckinPrompts([]), []);
  assert.deepEqual(buildCheckinPrompts(undefined), []);
  assert.deepEqual(buildCheckinPrompts(null), []);
});

test('maxPrompts caps the non-safety prompts, default is 5', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    ...qofIndicatorChip('not_met'),
    ruleId: `qof-${i}`,
    indicatorName: `Indicator ${i}`,
  }));
  const defaultCapped = buildCheckinPrompts(many);
  assert.equal(defaultCapped.length, 5, 'default maxPrompts is 5');
  assert.deepEqual(
    defaultCapped.map((p) => p.label),
    ['Indicator 0 owed', 'Indicator 1 owed', 'Indicator 2 owed', 'Indicator 3 owed', 'Indicator 4 owed']
  );

  const capped2 = buildCheckinPrompts(many, { maxPrompts: 2 });
  assert.equal(capped2.length, 2);
});

test('an unrecognised chip type/status is silently ignored, not thrown', () => {
  assert.deepEqual(buildCheckinPrompts([{ type: 'something-new', status: 'weird' }]), []);
  assert.deepEqual(buildCheckinPrompts([null, undefined, {}]), []);
});

// ── listSupportedChipTypes ───────────────────────────────────────────────────

test('listSupportedChipTypes reports exactly the types the mapping table covers', () => {
  const types = listSupportedChipTypes();
  assert.deepEqual(
    [...types].sort(),
    ['drug-allergy', 'drug-combo', 'drug-monitoring', 'qof-indicator', 'vaccine'].sort()
  );
});
