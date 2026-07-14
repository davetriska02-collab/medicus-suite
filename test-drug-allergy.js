// Medicus Suite — drug-allergy rule evaluator tests
// Run with: node --test test-drug-allergy.js
//
// The drug-allergy rule type fires when a documented ACTIVE allergy co-occurs
// with a contraindicated drug. It reads data.allergies, which only the
// Transactional (GP Connect Structured) feed provides — so it must FAIL CLOSED
// (never fire) when no allergy data is present, and must never assert "no allergy".

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const SentinelRules = require('./engine/rules-engine.js');

const PEN_RULE = {
  id: 'allergy-penicillin',
  type: 'drug-allergy',
  enabled: true,
  label: 'Penicillin allergy + penicillin',
  severity: 'red',
  allergyTerms: ['penicillin'],
  drugSets: [{ name: 'Penicillins', match: ['amoxicillin', 'penicillin', 'flucloxacillin'] }],
};

function evalRules(rules, opts) {
  const out = SentinelRules.evaluatePatient(opts.medications || [], [], rules, {
    now: '2026-07-08',
    problems: [],
    patientContext: opts.patientContext || { ageYears: 50 },
    allergies: opts.allergies, // deliberately may be undefined
  });
  const chips = out.chips || out;
  return (Array.isArray(chips) ? chips : []).filter((c) => c.type === 'drug-allergy');
}

test('fires red when active penicillin allergy co-occurs with amoxicillin', () => {
  const chips = evalRules([PEN_RULE], {
    allergies: [{ label: 'Penicillin allergy', status: 'active' }],
    medications: [{ name: 'Amoxicillin 500mg capsules' }],
  });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].status, 'alert'); // severity 'red' -> alert status
  assert.match(chips[0].matchSummary, /Penicillin allergy \+ Amoxicillin/);
});

test('FAIL CLOSED: no allergy data -> never fires (session/DOM feed)', () => {
  assert.equal(evalRules([PEN_RULE], { allergies: undefined, medications: [{ name: 'Amoxicillin 500mg' }] }).length, 0);
  assert.equal(evalRules([PEN_RULE], { allergies: [], medications: [{ name: 'Amoxicillin 500mg' }] }).length, 0);
});

test('does not fire when the drug is absent, even with the allergy present', () => {
  const chips = evalRules([PEN_RULE], {
    allergies: [{ label: 'Penicillin allergy', status: 'active' }],
    medications: [{ name: 'Atorvastatin 40mg tablets' }],
  });
  assert.equal(chips.length, 0);
});

test('ignores resolved / inactive / refuted allergies', () => {
  for (const status of ['resolved', 'inactive', 'refuted', 'entered-in-error']) {
    const chips = evalRules([PEN_RULE], {
      allergies: [{ label: 'Penicillin allergy', status }],
      medications: [{ name: 'Amoxicillin 500mg' }],
    });
    assert.equal(chips.length, 0, `${status} allergy must not fire`);
  }
});

test('real starter pack loads and its rules fire on representative data', () => {
  const drug = JSON.parse(readFileSync(path.join(__dirname, 'rules', 'drug-rules.json'), 'utf8'));
  const allergyRules = drug.rules.filter((r) => r.type === 'drug-allergy');
  assert.ok(allergyRules.length >= 4, 'starter pack present');

  // NSAID hypersensitivity + ibuprofen -> red
  const nsaid = evalRules(allergyRules, {
    allergies: [{ label: 'NSAID hypersensitivity', status: 'active' }],
    medications: [{ name: 'Ibuprofen 400mg tablets' }],
  });
  assert.ok(nsaid.some((c) => c.ruleId === 'allergy-nsaid' && c.status === 'alert'));

  // Penicillin allergy + cephalexin -> the cross-sensitivity rule (amber), not the red penicillin rule
  const xs = evalRules(allergyRules, {
    allergies: [{ label: 'Penicillin allergy', status: 'active' }],
    medications: [{ name: 'Cefalexin 500mg capsules' }],
  });
  assert.ok(xs.some((c) => c.ruleId === 'allergy-penicillin-cephalosporin-xs'));
  assert.ok(
    !xs.some((c) => c.ruleId === 'allergy-penicillin'),
    'a cephalosporin must not trip the pure-penicillin rule'
  );

  // Topical NSAID is excluded
  const topical = evalRules(allergyRules, {
    allergies: [{ label: 'NSAID hypersensitivity', status: 'active' }],
    medications: [{ name: 'Ibuprofen 5% gel' }],
  });
  assert.equal(topical.filter((c) => c.ruleId === 'allergy-nsaid').length, 0, 'topical NSAID excluded');
});
