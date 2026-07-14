// Medicus Suite — drug-allergy chip RENDERING tests
// Run with: node --test test-drug-allergy-render.js
//
// evaluateDrugAllergyRule() (engine/rules-engine.js) fires a { type:'drug-allergy',
// ... } chip correctly (see test-drug-allergy.js) but it was never rendered to the
// clinician: content-scripts/sentinel.js's chipHtml() had no case for it and fell
// through to '<div>Unknown chip type</div>', and the default grouped view never
// drew a drug-allergy section at all. This test pins the fix at the renderer
// layer: ChipRenderer.renderDrugAllergyChip() (shared/chip-renderer.js) must turn
// a REAL engine-produced drug-allergy chip into HTML that actually surfaces the
// allergy + drug match — not the generic "unknown chip type" fallback.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const CR = require(path.join(__dirname, 'shared', 'chip-renderer.js'));

const PEN_RULE = {
  id: 'allergy-penicillin',
  type: 'drug-allergy',
  enabled: true,
  label: 'Penicillin allergy + penicillin',
  severity: 'red',
  source: 'BNF allergy cross-check',
  notes: 'Confirm allergy status before dispensing',
  allergyTerms: ['penicillin'],
  drugSets: [{ name: 'Penicillins', match: ['amoxicillin', 'penicillin', 'flucloxacillin'] }],
};

function fireAllergyChip() {
  const out = engine.evaluatePatient([{ name: 'Amoxicillin 500mg capsules' }], [], [PEN_RULE], {
    now: '2026-07-08',
    problems: [],
    patientContext: { ageYears: 50 },
    allergies: [{ label: 'Penicillin allergy', status: 'active' }],
  });
  const chips = out.chips || out;
  return (Array.isArray(chips) ? chips : []).find((c) => c.type === 'drug-allergy');
}

test('engine produces a real drug-allergy chip to render', () => {
  const chip = fireAllergyChip();
  assert.ok(chip, 'evaluatePatient produced a drug-allergy chip');
  assert.equal(chip.status, 'alert');
  assert.match(chip.matchSummary, /Penicillin allergy \+ Amoxicillin/);
});

test('renderDrugAllergyChip renders the label and match summary (not "Unknown chip type")', () => {
  const chip = fireAllergyChip();
  assert.ok(chip);
  const html = CR.renderDrugAllergyChip(chip);
  assert.equal(typeof html, 'string');
  assert.doesNotMatch(html, /Unknown chip type/i);
  assert.match(html, /Penicillin allergy \+ penicillin/); // chip.label
  assert.match(html, /Penicillin allergy \+ Amoxicillin/); // chip.matchSummary
});

test('renderDrugAllergyChip surfaces status colour/badge and evidence affordance', () => {
  const chip = fireAllergyChip();
  const html = CR.renderDrugAllergyChip(chip);
  assert.match(html, new RegExp(`sent-chip-${CR.STATUS_COLOUR[chip.status]}`));
  assert.match(html, new RegExp(CR.STATUS_LABEL[chip.status]));
  assert.ok(chip.evidence, 'engine emitted chip.evidence');
  assert.match(html, /data-evidence-key/);
  assert.match(html, /class="sent-chip /, 'top-level class is .sent-chip (token-scope invariant)');
});

test('renderDrugAllergyChip surfaces the evidence facts (Allergy / matched drug set)', () => {
  const chip = fireAllergyChip();
  const html = CR.renderDrugAllergyChip(chip);
  for (const fact of chip.evidence.facts) {
    assert.ok(html.includes(fact.label), `renders evidence fact label '${fact.label}'`);
    assert.ok(html.includes(fact.value), `renders evidence fact value '${fact.value}'`);
  }
});

test('renderDrugAllergyChip does not throw when notes/source are absent', () => {
  const chip = fireAllergyChip();
  const bare = { ...chip, notes: null, source: null, evidence: null };
  assert.doesNotThrow(() => CR.renderDrugAllergyChip(bare));
});

test('ChipRenderer exports renderDrugAllergyChip on its public api', () => {
  assert.equal(typeof CR.renderDrugAllergyChip, 'function');
});
