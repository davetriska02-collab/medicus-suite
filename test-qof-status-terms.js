// Medicus Suite — QOF alcohol/smoking status-term regression tests
// Run with: node test-qof-status-terms.js
//
// Guards the 2026-09-21 live-consult fixes (v3.264.3):
//
//   MH007 (alcohol consumption in SMI): a journal-coded "Teetotaller" status
//   IS a valid alcohol-consumption record, but matched none of the rule's
//   observation terms — so the chip stayed OVERDUE on a stale "5 / day" entry
//   from the previous QOF year even though the status had just been recoded.
//   The rule now carries teetotal/non-drinker status terms.
//
//   SMOK002 (smoking status): "Ex-smoker" was already in the term list — the
//   live NO DATA came from the journal-ingestion gap (flat observation items,
//   see test-journal-observations.js). Pinned here end-to-end: a
//   journal-sourced Ex-smoker observation satisfies the indicator.

'use strict';
const engine = require('./engine/rules-engine.js');
const qof = require('./rules/qof-rules.json');

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

// Live-consult date: QOF year floor is 1 Apr 2026, so the stale 20 Jan 2026
// entry is in the PREVIOUS QOF year (overdue) despite being <365 days old.
const NOW = '2026-09-21T12:00:00Z';

console.log('--- MH007: teetotaller/non-drinker status satisfies the alcohol indicator ---');
const mh007 = qof.rules.find((r) => r.id === 'qof-mh007');
const smiReg = qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'SMI');
check(!!mh007, 'MH007 rule exists in qof-rules.json');
check(!!smiReg, 'SMI register rule exists in qof-rules.json');
check(mh007.check.observation.includes('teetotal'), 'MH007 term list carries "teetotal"');
check(mh007.check.observation.includes('non-drinker'), 'MH007 term list carries "non-drinker"');

const mh007Status = (observations) => {
  const chips = engine.evaluateQofIndicatorRule(
    mh007,
    {
      medications: [],
      observations,
      problems: [{ label: 'Schizophrenia' }],
      patientContext: {},
      _registerLookup: { SMI: smiReg },
    },
    NOW
  );
  return chips.length ? chips[0].status : null;
};

const staleUnitsPerDay = { name: 'Alcohol consumption', value: '5 / day', date: '2026-01-20' };

check(
  mh007Status([staleUnitsPerDay]) === 'overdue',
  'stale "5 / day" from the previous QOF year alone → overdue (the live bug state)'
);
check(
  mh007Status([staleUnitsPerDay, { name: 'Teetotaller', value: '', date: '2026-09-21', source: 'journal' }]) ===
    'achieved',
  'a journal-coded Teetotaller this QOF year clears the overdue → achieved'
);
check(
  mh007Status([{ name: 'Teetotal', value: '', date: '2026-09-21', source: 'journal' }]) === 'achieved',
  '"Teetotal" (no -ler suffix) also matches'
);
check(
  mh007Status([staleUnitsPerDay, { name: 'Current non-drinker', value: '', date: '2026-09-21', source: 'journal' }]) ===
    'achieved',
  'a "Current non-drinker" status also satisfies MH007'
);
check(
  mh007Status([staleUnitsPerDay, { name: 'Teetotaller', value: '', date: '2026-03-01', source: 'journal' }]) ===
    'overdue',
  'a teetotaller entry from BEFORE the QOF year floor does not satisfy — window semantics unchanged'
);
check(
  mh007Status([{ name: 'Alcohol consumption', value: '2 units/week', date: '2026-09-01' }]) === 'achieved',
  'existing consumption terms still work (no regression)'
);

console.log('\n--- SMOK002: a journal-sourced Ex-smoker satisfies the smoking indicator ---');
const smok002 = qof.rules.find((r) => r.id === 'qof-smok002-chd');
const chdReg = qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'CHD');
check(!!smok002, 'SMOK002 (CHD) rule exists in qof-rules.json');
check(!!chdReg, 'CHD register rule exists in qof-rules.json');

const smokStatus = (observations) => {
  const chips = engine.evaluateQofIndicatorRule(
    smok002,
    {
      medications: [],
      observations,
      problems: [{ label: chdReg.problemMatch[0] }],
      patientContext: {},
      _registerLookup: { CHD: chdReg },
    },
    NOW
  );
  return chips.length ? chips[0].status : null;
};

check(smokStatus([]) === 'no_data', 'no smoking observation at all → no_data (the live bug state)');
check(
  smokStatus([{ name: 'Ex-smoker', value: '', date: '2026-09-21', source: 'journal' }]) === 'achieved',
  'a journal-coded Ex-smoker this QOF year → achieved (ingestion fix delivers the evidence)'
);
check(
  smokStatus([{ name: 'Smoking status', value: 'Ex-smoker', date: '2026-09-21', source: 'journal' }]) === 'achieved',
  'a "Smoking status" observation also satisfies (name-based matching unchanged)'
);

console.log('\n--- SMOK002: widened, status-first term list (2026-09-21 live report, v3.264.4) ---');
// Clinicians code STATUS terms (SNOMED/EMIS display names: Ex-smoker, Never
// smoked, Current smoker…), not process terms — so the status terms must lead
// the list. They also lead the evidence panel's "we looked for" preview
// (first four terms), which is what the live report called "bang wrong".
const allSmok002 = qof.rules.filter((r) => /^qof-smok002-/.test(r.id));
check(allSmok002.length === 9, `all 9 SMOK002 register variants present (got ${allSmok002.length})`);
allSmok002.forEach((r) => {
  const terms = r.check.observation;
  const firstFour = terms.slice(0, 4);
  check(
    firstFour.includes('ex-smoker') && firstFour.includes('never smoked') && firstFour.includes('current smoker'),
    `${r.id}: status terms lead the list (first four: ${firstFour.join(', ')})`
  );
  check(
    ['smoking status', 'tobacco use', 'smoking cessation', 'nicotine dependence'].every((t) => terms.includes(t)),
    `${r.id}: process terms are kept`
  );
  check(
    (r.check.observationExclude || []).includes('passive'),
    `${r.id}: "passive" exclude guards the bare "smoker" term (Passive smoker ≠ patient status)`
  );
});

check(
  smokStatus([{ name: 'Ex smoker', value: '', date: '2026-09-21', source: 'journal' }]) === 'achieved',
  'unhyphenated "Ex smoker" matches (bare "smoker" term covers display-name variants)'
);
check(
  smokStatus([{ name: 'Never smoked tobacco', value: '', date: '2026-09-21' }]) === 'achieved',
  '"Never smoked tobacco" matches'
);
check(smokStatus([{ name: 'Non-smoker', value: '', date: '2026-09-21' }]) === 'achieved', '"Non-smoker" matches');
check(
  smokStatus([{ name: 'Passive smoker', value: '', date: '2026-09-21' }]) === 'no_data',
  'a lone "Passive smoker" entry does NOT satisfy — exposure is not the patient\'s own status'
);

console.log('\n--- SMOK002: evidence panel does not lie by omission ---');
// The no-data evidence shows the first four terms; with 13 terms the
// truncation must be VISIBLE (ellipsis) and the visible terms must be the
// status terms clinicians expect — not only the four process terms.
{
  const chips = engine.evaluateQofIndicatorRule(
    smok002,
    {
      medications: [],
      observations: [],
      problems: [{ label: chdReg.problemMatch[0] }],
      patientContext: {},
      _registerLookup: { CHD: chdReg },
    },
    NOW
  );
  const obsFact = ((chips[0] && chips[0].evidence && chips[0].evidence.facts) || []).find(
    (f) => f.label === 'Observation'
  );
  check(!!obsFact, 'no-data chip carries an Observation evidence fact');
  const detail = (obsFact && obsFact.detail) || '';
  check(detail.includes('ex-smoker'), `evidence "we looked for" includes ex-smoker (got: ${detail})`);
  check(detail.includes('never smoked'), 'evidence "we looked for" includes never smoked');
  check(detail.includes('…'), 'evidence shows an ellipsis when the term list is truncated');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
