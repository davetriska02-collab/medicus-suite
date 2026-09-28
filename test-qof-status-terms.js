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
  'a dashboard "Smoking status" row is read from its value (Ex-smoker)'
);
check(
  smokStatus([{ name: 'Smoking status', value: '', date: '2026-09-21', source: 'journal' }]) === 'no_data',
  'a bare "Smoking status" wrapper with no value does not achieve'
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
  check(!terms.includes('smoking status'), `${r.id}: "smoking status" is not a look-for`);
  check(terms.includes('cigarette consumption'), `${r.id}: Cigarette consumption rubric is kept (in SMOK_COD)`);
  check(terms.includes('date ceased smoking'), `${r.id}: Date ceased smoking rubric is a look-for`);
  check(terms.includes('cigarette pack-years'), `${r.id}: Cigarette pack-years rubric is a look-for`);
  check(terms.includes('smoking reduced'), `${r.id}: Smoking reduced rubric is a look-for`);
  check(
    !terms.includes('smoking cessation') && !terms.includes('nicotine dependence') && !terms.includes('tobacco use'),
    `${r.id}: cessation / dependence / bare tobacco-use substrings are not look-fors`
  );
  const snomed = r.check.snomed || [];
  check(snomed.length === 71, `${r.id}: SMOK_COD is 71 concept ids (got ${snomed.length})`);
  [
    '77176002',
    '8517006',
    '266919005',
    '65568007',
    '230056004',
    '266918002',
    '230057008',
    '230058003',
    '836001000000109',
    '160617001',
    '160625004',
    '134406006',
    '449868002',
    '401201003',
  ].forEach((code) => {
    check(snomed.includes(code), `${r.id}: SMOK_COD includes ${code}`);
  });
  check(
    !snomed.includes('225323000') && !snomed.includes('871661000000106') && !snomed.includes('1098881000000103'),
    `${r.id}: cessation, referral and declined-status codes are not achievement ids`
  );
  const denied = r.check.snomedExclude || [];
  [
    '1098881000000103',
    '11351000175103',
    '225323000',
    '871661000000106',
    '313396002',
    '56294008',
    '716391000000109',
    '717771000000108',
  ].forEach((code) => {
    check(denied.includes(code) && !snomed.includes(code), `${r.id}: ${code} is excluded, not an achievement id`);
  });
  const textEx = r.check.observationExclude || [];
  ['passive', 'smoking status', 'tobacco use', 'smoking cessation', 'nicotine dependence'].forEach((phrase) => {
    check(textEx.includes(phrase), `${r.id}: text exclude "${phrase}" is present`);
  });
  const pca = ((r.pca || {}).observationsInYear || []).flatMap((s) => s.snomed || []);
  check(
    pca.includes('716391000000109') && pca.includes('717771000000108'),
    `${r.id}: PCA codes suppress rather than achieve`
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

console.log('\n--- SMOK002: false-achievement codes and phrases do not clear the indicator ---');
const falseCases = [
  { name: 'Declined to give smoking status', code: '1098881000000103', label: 'declined smoking status' },
  { name: 'Tobacco use screening declined', code: '11351000175103', label: 'tobacco use screening declined' },
  { name: 'Smoking cessation advice', code: '200221000000105', label: 'smoking cessation advice' },
  { name: 'Referral to smoking cessation service', code: '871661000000106', label: 'cessation referral' },
  { name: 'Nicotine replacement therapy', code: '313396002', label: 'pharmacotherapy' },
  { name: 'Nicotine dependence', code: '56294008', label: 'nicotine dependence' },
];
falseCases.forEach((row) => {
  const coded = smokStatus([{ name: row.name, value: '', code: row.code, date: '2026-09-21' }]);
  const textOnly = smokStatus([{ name: row.name, value: '', date: '2026-09-21' }]);
  check(coded !== 'achieved', `${row.label} concept id does not achieve (got ${coded})`);
  check(textOnly !== 'achieved', `${row.label} wording does not achieve (got ${textOnly})`);
});

console.log('\n--- SMOK002: text-only SMOK_COD rubrics that a short look-for used to miss ---');
[
  'Smoking reduced',
  'Date ceased smoking',
  'Cigarette pack-years',
  'Smokes tobacco daily',
  'Waterpipe tobacco consumption',
  'Stopped smoking',
].forEach((name) => {
  check(
    smokStatus([{ name: name, value: '', date: '2026-09-21' }]) === 'achieved',
    `"${name}" with no concept id still clears SMOK002`
  );
});

console.log('\n--- SMOK002: PCA unsuitable and informed dissent suppress the chip ---');
function smokChips(observations) {
  return engine.evaluateQofIndicatorRule(
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
}
const pcaRows = [
  {
    name: 'Excepted from smoking quality indicators - patient unsuitable',
    code: '716391000000109',
    label: 'patient unsuitable',
  },
  {
    name: 'Excepted from smoking quality indicators - informed dissent',
    code: '717771000000108',
    label: 'informed dissent',
  },
];
pcaRows.forEach((row) => {
  const only = smokChips([{ name: row.name, value: '', code: row.code, date: '2026-09-21' }]);
  check(only.length === 0, `${row.label} suppresses the chip (got ${only.length} chips)`);
  const besideOld = smokChips([
    { name: row.name, value: '', code: row.code, date: '2026-09-21' },
    { name: 'Cigarette consumption', value: '20 /day', code: '230056004', date: '2022-11-14' },
  ]);
  check(besideOld.length === 0, `${row.label} suppresses an otherwise overdue chip`);
  const besideCurrent = smokChips([
    { name: row.name, value: '', code: row.code, date: '2026-09-21' },
    { name: 'Smoker', value: '', code: '77176002', date: '2026-09-21' },
  ]);
  check(
    besideCurrent[0] && besideCurrent[0].status === 'achieved',
    `a real in-year smoker code still achieves beside ${row.label}`
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
