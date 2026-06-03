// Medicus Suite — drug-monitoring brand-coverage tests
// Run with: node test-drug-brand-coverage.js
//
// Guards against the SILENT under-matching failure mode in built-in
// drug-monitoring rules: a med prescribed by a brand name the rule doesn't
// list simply never fires — no error, just a missing alert. This test loads
// rules/drug-rules.json and asserts, via the real drugMatchesRule(), that
// every brand/generic we intend to monitor actually matches its rule (and
// that an unrelated drug does not). When a new monitored drug or brand is
// added, extend EXPECTED below.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const ruleset = require(path.join(__dirname, 'rules', 'drug-rules.json'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const ruleById = (id) => ruleset.rules.find(r => r.id === id);

// For each rule, the list of representative prescription strings that MUST
// fire it. Mix bare names with realistic dose/form suffixes to exercise the
// case-insensitive substring matching used in engine/rules-engine.js.
const EXPECTED = {
  'lithium-maintenance': [
    'lithium', 'Lithium carbonate 250mg tablets', 'Lithium citrate liquid',
    'Priadel 400mg modified-release tablets', 'Camcolit 250mg tablets',
    'Liskonum 450mg MR tablets', 'Li-Liquid 509mg/5ml'
  ],
  'adhd-stimulant-paediatric': [
    'Medikinet XL 20mg', 'methylphenidate', 'Tranquilyn 10mg', 'Ritalin 10mg',
    'Affenid 18mg', 'Atenza 27mg', 'Concerta XL 36mg', 'Delmosart 18mg',
    'Kixel 30mg', 'Matoride XL 18mg', 'Xaggitin XL 18mg', 'Xenidate XL 18mg',
    'Equasym XL 20mg', 'Focusim 5mg', 'Meflynate XL 10mg', 'Metyrol 10mg'
  ],
  'adhd-stimulant-adult': [
    'Medikinet XL 20mg', 'methylphenidate', 'Tranquilyn 10mg', 'Ritalin 10mg',
    'Affenid 18mg', 'Atenza 27mg', 'Concerta XL 36mg', 'Delmosart 18mg',
    'Kixel 30mg', 'Matoride XL 18mg', 'Xaggitin XL 18mg', 'Xenidate XL 18mg',
    'Equasym XL 20mg', 'Focusim 5mg', 'Meflynate XL 10mg', 'Metyrol 10mg'
  ],
  'methotrexate-maintenance': [
    'Methotrexate 2.5mg tablets', 'Metoject 15mg/0.3ml injection',
    'Jylamvo 2mg/ml oral solution', 'Nordimet 12.5mg injection',
    'Zlatal 2.5mg tablets', 'Methofill 17.5mg injection',
    // exclusions were removed — injectable/parenteral forms must now fire too
    'Methotrexate 50mg/2ml injection', 'Methotrexate injection'
  ]
};

for (const [id, meds] of Object.entries(EXPECTED)) {
  console.log(`\n--- ${id} ---`);
  const rule = ruleById(id);
  check(!!rule, `rule "${id}" exists in drug-rules.json`);
  if (!rule) continue;
  for (const med of meds) {
    check(engine.drugMatchesRule(med, rule), `fires for "${med}"`);
  }
}

console.log('\n--- negative controls (must NOT fire) ---');
check(!engine.drugMatchesRule('Amlodipine 5mg tablets', ruleById('lithium-maintenance')),
  'amlodipine does not match lithium rule');
check(!engine.drugMatchesRule('Amoxicillin 500mg capsules', ruleById('methotrexate-maintenance')),
  'amoxicillin does not match methotrexate rule');
check(!engine.drugMatchesRule('Sertraline 50mg tablets', ruleById('adhd-stimulant-adult')),
  'sertraline does not match ADHD stimulant rule');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
