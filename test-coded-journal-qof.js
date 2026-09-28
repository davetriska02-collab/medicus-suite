// Medicus Suite — coded journal notes clear SMOK002 and AST015
// Run with: node test-coded-journal-qof.js
//
// Synthetic fixture only. No patient identifiers.
// A consultation dated last week codes smoking status and the asthma-review
// components as notes and observations. An older dashboard row, Cigarette
// consumption 20 /day on 14 Nov 2022, must not stay the headline date.

'use strict';
const engine = require('./engine/rules-engine.js');
const JO = require('./shared/journal-observations.js');
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

const NOW = '2026-09-28T12:00:00Z';
const REVIEW = '2026-09-21';
const astReg = qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'ASTHMA');
const smok = qof.rules.find((r) => r.id === 'qof-smok002-asthma');
const ast015 = qof.rules.find((r) => r.id === 'qof-ast007');

check(!!astReg && !!smok && !!ast015, 'ASTHMA register, SMOK002 asthma variant and AST015 are in qof-rules.json');

function note(desc, conceptId, extra) {
  return Object.assign(
    {
      entryType: 'note',
      clinicalCodeDescription: desc,
      conceptId: conceptId,
      observationDate: '21 Sep 2026',
    },
    extra || {}
  );
}

function observation(type, value, conceptId, date) {
  return {
    entryType: 'observation',
    type: type,
    value: value,
    conceptId: conceptId,
    observationDate: date || '21 Sep 2026',
  };
}

function journal(entries) {
  return {
    patientJournalRecords: [
      {
        title: 'Mon 21 Sep 2026',
        items: [
          {
            type: 'encounter',
            data: { consultationTopics: [{ headings: [{ entries: entries }] }] },
          },
        ],
      },
    ],
  };
}

const codedEntries = [
  note('Smoker', '77176002'),
  note('Moderate cigarette smoker (10-19 cigs/day)', '160604004'),
  note('Asthma monitoring check done', '270442000'),
  note('Patient has a written asthma personal action plan', '527171000000103'),
  note('Asthma self-management plan agreed', '811921000000103'),
  observation('Asthma control test score', '7', '443117005'),
  observation('Number of asthma exacerbations in past year', '1', '366874008'),
  {
    entryType: 'note',
    note: 'Free text only: smoker, asthma review, written plan.',
    type: 'Comment',
  },
];

const oldConsumption = {
  name: 'Cigarette consumption',
  value: '20 /day',
  date: '2022-11-14',
  code: '230056004',
};

const asthmaProblem = [{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }];

function evalRule(rule, observations) {
  return engine.evaluateQofIndicatorRule(
    rule,
    {
      medications: [],
      observations: observations,
      problems: asthmaProblem,
      patientContext: {},
      _registerLookup: { ASTHMA: astReg },
    },
    NOW
  );
}

console.log('\n--- last week coded review clears both indicators; 2022 does not win ---');
{
  const parsed = JO.parseJournalObservations(journal(codedEntries), { now: NOW });
  check(
    parsed.some((o) => o.name === 'Smoker' && o.code === '77176002' && o.date === REVIEW),
    'parser indexes the Smoker note'
  );
  check(!parsed.some((o) => /Free text only/i.test(o.name)), 'uncoded free-text note is not an observation');
  const observations = parsed.concat([oldConsumption]);
  const smokChips = evalRule(smok, observations);
  const astChips = evalRule(ast015, observations);
  check(
    smokChips[0] && smokChips[0].status === 'achieved',
    `SMOK002 achieved (got ${smokChips[0] && smokChips[0].status})`
  );
  check(
    smokChips[0] && smokChips[0].dateText === REVIEW,
    `SMOK002 date is the last-week code, not 2022 (got ${smokChips[0] && smokChips[0].dateText})`
  );
  check(astChips[0] && astChips[0].status === 'achieved', `AST015 achieved (got ${astChips[0] && astChips[0].status})`);
  check(
    astChips[0] && astChips[0].dateText === REVIEW,
    `AST015 date is the review day (got ${astChips[0] && astChips[0].dateText})`
  );
  const facts = (astChips[0] && astChips[0].evidence && astChips[0].evidence.facts) || [];
  ['Asthma review', 'Asthma control', 'Exacerbation count', 'Written plan'].forEach((label) => {
    const fact = facts.find((f) => f.label === label);
    check(fact && fact.value === 'met', `${label} is met on the detail panel (got ${fact && fact.value})`);
  });
}

console.log('\n--- cessation education and referral do not clear SMOK002 ---');
{
  const cessation = [
    { name: 'Smoking cessation education', code: '225323000', value: '', date: REVIEW },
    { name: 'Referral to smoking cessation service', code: '871661000000106', value: '', date: REVIEW },
  ];
  const only = evalRule(smok, cessation);
  check(only[0] && only[0].status !== 'achieved', `cessation-only is not achieved (got ${only[0] && only[0].status})`);
  const withOld = evalRule(smok, cessation.concat([oldConsumption]));
  check(
    withOld[0] && withOld[0].status === 'overdue' && withOld[0].dateText === '2022-11-14',
    `cessation codes do not replace the 2022 consumption date (got ${withOld[0] && withOld[0].status} ${withOld[0] && withOld[0].dateText})`
  );
}

console.log('\n--- Cigarette consumption counts, because it is in SMOK_COD ---');
{
  const chips = evalRule(smok, [{ name: 'Cigarette consumption', code: '230056004', value: '10 /day', date: REVIEW }]);
  check(chips[0] && chips[0].status === 'achieved', 'a recent Cigarette consumption code clears SMOK002');
}

console.log('\n--- missing written plan names that component ---');
{
  const parsed = JO.parseJournalObservations(
    journal(codedEntries.filter((e) => !/action plan|self-management plan/i.test(e.clinicalCodeDescription || ''))),
    { now: NOW }
  );
  const chips = evalRule(ast015, parsed.concat([oldConsumption]));
  check(chips[0] && chips[0].status === 'not_met', `missing plan is not met (got ${chips[0] && chips[0].status})`);
  check(
    chips[0] && /Written plan/.test(chips[0].valueText || ''),
    `chip names the missing plan (got ${chips[0] && chips[0].valueText})`
  );
  const facts = (chips[0] && chips[0].evidence && chips[0].evidence.facts) || [];
  const plan = facts.find((f) => f.label === 'Written plan');
  const review = facts.find((f) => f.label === 'Asthma review');
  check(plan && plan.value === 'missing', 'detail panel marks Written plan missing');
  check(review && review.value === 'met', 'detail panel still marks Asthma review met');
}

console.log('\n--- plan on a different day, and an exacerbation outside the month, stay missing ---');
{
  const entries = codedEntries.map((e) => Object.assign({}, e));
  const plan = entries.find((e) => e.clinicalCodeDescription === 'Patient has a written asthma personal action plan');
  plan.observationDate = '20 Sep 2026';
  const agreed = entries.find((e) => e.clinicalCodeDescription === 'Asthma self-management plan agreed');
  agreed.observationDate = '20 Sep 2026';
  const ex = entries.find((e) => e.type === 'Number of asthma exacerbations in past year');
  ex.observationDate = '01 Jul 2026';
  const parsed = JO.parseJournalObservations(journal(entries), { now: NOW });
  const chips = evalRule(ast015, parsed);
  const facts = (chips[0] && chips[0].evidence && chips[0].evidence.facts) || [];
  const planFact = facts.find((f) => f.label === 'Written plan');
  const exFact = facts.find((f) => f.label === 'Exacerbation count');
  check(chips[0] && chips[0].status === 'not_met', 'shifted plan and exacerbation leave AST015 not met');
  check(
    planFact && planFact.value === 'missing' && /same day/.test(planFact.detail || ''),
    `plan detail says it is not the same day (got ${planFact && planFact.detail})`
  );
  check(
    exFact && exFact.value === 'missing' && /1 month/.test(exFact.detail || ''),
    `exacerbation detail says it is outside the month (got ${exFact && exFact.detail})`
  );
}

console.log('\n--- concept id matches when the display name is not the rubric ---');
{
  const parsed = JO.parseJournalObservations(
    journal([
      note('Asthma monitoring check done', '270442000'),
      observation('ACT', '7', '443117005'),
      observation('Exacerbation count', '1', '366874008'),
      note('Patient has a written asthma personal action plan', '527171000000103'),
    ]),
    { now: NOW }
  );
  const chips = evalRule(ast015, parsed);
  const facts = (chips[0] && chips[0].evidence && chips[0].evidence.facts) || [];
  const control = facts.find((f) => f.label === 'Asthma control');
  check(chips[0] && chips[0].status === 'achieved', 'concept ids satisfy the four groups');
  check(
    control && control.value === 'met' && control.detail === 'ACT',
    'control group matched the concept id, not the rubric'
  );
}

console.log('\n--- HF008 echo abbreviation does not match cigarette or written ---');
{
  const hfReg = qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'HF');
  const hf008 = qof.rules.find((r) => r.id === 'qof-hf008');
  const evalHf = (observations) =>
    engine.evaluateQofIndicatorRule(
      hf008,
      {
        medications: [],
        observations,
        problems: [{ label: 'Heart failure', codedDate: '2018-01-01', hasOnsetDate: true }],
        patientContext: {},
        _registerLookup: { HF: hfReg },
      },
      NOW
    );
  const falseGreen = evalHf([
    { name: 'Patient has a written asthma personal action plan', date: REVIEW, value: '' },
    { name: 'Moderate cigarette smoker (10-19 cigs/day)', date: REVIEW, value: '' },
    { name: 'Cigarette consumption', date: REVIEW, value: '10 /day' },
  ]);
  check(
    falseGreen[0] && falseGreen[0].status !== 'achieved',
    `written/cigarette notes do not clear HF008 (got ${falseGreen[0] && falseGreen[0].status})`
  );
  const real = evalHf([{ name: 'TTE', date: REVIEW, value: 'normal' }]);
  check(real[0] && real[0].status === 'achieved', 'a TTE token still clears HF008');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
