// Medicus Suite — drug-monitoring chip `matchedTerm` passthrough test (R2a)
// Run with: node test-drug-matched-term.js
//
// A fired drug-monitoring chip must carry `matchedTerm` = the rule's match
// term that hit, so a clinician can tell a correct hit ("matched on
// 'methotrexate'") from a lucky substring. This is a pure passthrough of the
// engine's existing drugMatchDetail() helper — no matching logic changes.

'use strict';

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const engine = require('./engine/rules-engine.js');
check(typeof engine.evaluatePatient === 'function', 'rules-engine exports evaluatePatient');

// A maintenance-style methotrexate rule (mirrors rules/drug-rules.json
// methotrexate-maintenance shape: type / drug.match / tests[]).
const mtxRule = {
  type: 'drug-monitoring',
  enabled: true,
  id: 'methotrexate-maintenance',
  drugClass: 'DMARD',
  drug: { match: ['methotrexate'] },
  tests: [{ name: 'FBC', match: ['fbc', 'full blood count'], intervalDays: 84, dueSoonDays: 14 }],
};

const meds = [{ name: 'Methotrexate 10mg tablets', startDate: '2022-01-01' }];
const NOW = '2026-05-29T00:00:00.000Z';
const obs = [{ name: 'FBC', code: '26604007', date: '2026-02-01', value: 'normal' }];

const chips = engine.evaluatePatient(meds, obs, [mtxRule], { now: NOW, problems: [] });
const mtxChip = chips.find((c) => c.type === 'drug-monitoring' && c.ruleId === 'methotrexate-maintenance');

check(!!mtxChip, 'a drug-monitoring chip is produced for methotrexate');
check(
  mtxChip && Object.prototype.hasOwnProperty.call(mtxChip, 'matchedTerm'),
  'fired chip includes a matchedTerm field'
);
check(
  mtxChip && typeof mtxChip.matchedTerm === 'string' && mtxChip.matchedTerm.toLowerCase().includes('methotrexate'),
  `matchedTerm contains "methotrexate" (got '${mtxChip && mtxChip.matchedTerm}')`
);
// It must equal the actual rule term that matched, not the med display name.
check(
  mtxChip && mtxChip.matchedTerm === 'methotrexate',
  `matchedTerm is the rule term 'methotrexate', not the med name (got '${mtxChip && mtxChip.matchedTerm}')`
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
