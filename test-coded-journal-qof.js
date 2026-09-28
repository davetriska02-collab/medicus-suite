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
  ['Asthma review', 'Exacerbation count', 'Written plan'].forEach((label) => {
    const fact = facts.find((f) => f.label === label);
    check(fact && fact.value === 'met', `${label} is met on the detail panel (got ${fact && fact.value})`);
  });
  const control = facts.find((f) => f.label === 'Asthma control');
  check(
    control && control.value === 'advisory',
    `Asthma control is advisory and does not gate achievement (got ${control && control.value})`
  );
  check(
    astChips[0] && astChips[0].valueText === '3/3 components',
    `chip counts the three required facts (got ${astChips[0] && astChips[0].valueText})`
  );
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
  check(chips[0] && chips[0].status === 'achieved', 'review, exacerbation and plan concept ids achieve AST015');
  check(
    control && control.value === 'advisory' && /ACT/.test(control.detail || ''),
    `control stays advisory when its concept id matches (got ${control && control.value} ${control && control.detail})`
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

console.log('\n--- exception rubrics do not achieve ---');
{
  const exceptions = [
    'Asthma review declined',
    'Smoking status not recorded',
    'CHA2DS2-VASc score not appropriate',
    'Asthma review unsuitable',
    'Asthma review refused',
    'Informed dissent to asthma review',
    'Asthma review not indicated',
  ];
  exceptions.forEach((name) => {
    const chips = evalRule(ast015, [
      { name: name, date: REVIEW, value: '', code: '394700004' },
      { name: 'Asthma control test score', date: REVIEW, value: '7', code: '443117005' },
      { name: 'Number of asthma exacerbations in past year', date: REVIEW, value: '1', code: '366874008' },
      { name: 'Patient has a written asthma personal action plan', date: REVIEW, value: '', code: '527171000000103' },
    ]);
    check(
      chips[0] && chips[0].status !== 'achieved' && /Asthma review/.test(chips[0].valueText || ''),
      `${name} does not clear the review (got ${chips[0] && chips[0].status} ${chips[0] && chips[0].valueText})`
    );
  });
  const smokOnly = evalRule(smok, [{ name: 'Smoking status not recorded', date: REVIEW, value: '', code: '77176002' }]);
  check(smokOnly[0] && smokOnly[0].status !== 'achieved', 'Smoking status not recorded does not clear SMOK002');
  const afReg = qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'AF');
  const af006 = qof.rules.find((r) => r.id === 'qof-af006');
  const afChips = engine.evaluateQofIndicatorRule(
    af006,
    {
      medications: [],
      observations: [{ name: 'CHA2DS2-VASc score not appropriate', date: REVIEW, value: '', code: '763008007' }],
      problems: [{ label: 'Atrial fibrillation', codedDate: '2018-01-01', hasOnsetDate: true }],
      patientContext: {},
      _registerLookup: { AF: afReg },
    },
    NOW
  );
  check(afChips[0] && afChips[0].status !== 'achieved', 'CHA2DS2-VASc score not appropriate does not clear AF006');
  const alongside = evalRule(ast015, [
    { name: 'Asthma review declined', date: REVIEW, value: '', code: '394700004' },
    { name: 'Asthma monitoring check done', date: REVIEW, value: '', code: '270442000' },
    { name: 'Asthma control test score', date: REVIEW, value: '7', code: '443117005' },
    { name: 'Number of asthma exacerbations in past year', date: REVIEW, value: '1', code: '366874008' },
    { name: 'Patient has a written asthma personal action plan', date: REVIEW, value: '', code: '527171000000103' },
  ]);
  check(alongside[0] && alongside[0].status === 'achieved', 'a real review still counts beside a declined rubric');
}

console.log('\n--- AST015 is three coded facts; a review alone does not achieve ---');
{
  const review = { name: 'Asthma annual review', date: REVIEW, value: '', code: '394700004' };
  const plan = { name: 'Patient has a written asthma personal action plan', date: REVIEW, value: '', code: '527171000000103' };
  const count = { name: 'Number of asthma exacerbations in past year', date: REVIEW, value: '1', code: '366874008' };
  const sameDay = evalRule(ast015, [review, plan, count]);
  check(sameDay[0] && sameDay[0].status === 'achieved', 'review, same-day plan and in-window exacerbation achieve without a control score');
  const otherDay = evalRule(ast015, [review, Object.assign({}, plan, { date: '2026-09-20' }), count]);
  check(
    otherDay[0] && otherDay[0].status === 'not_met' && /Written plan/.test(otherDay[0].valueText || ''),
    `a plan on a different day fails (got ${otherDay[0] && otherDay[0].status} ${otherDay[0] && otherDay[0].valueText})`
  );
  const outside = evalRule(ast015, [review, plan, Object.assign({}, count, { date: '2026-07-01' })]);
  check(
    outside[0] && outside[0].status === 'not_met' && /Exacerbation count/.test(outside[0].valueText || ''),
    `an exacerbation outside the month fails (got ${outside[0] && outside[0].status} ${outside[0] && outside[0].valueText})`
  );
  const alone = evalRule(ast015, [review]);
  check(
    alone[0] && alone[0].status === 'not_met' && /Written plan/.test(alone[0].valueText || ''),
    `a review alone does not turn the chip green (got ${alone[0] && alone[0].status} ${alone[0] && alone[0].valueText})`
  );
  const invite = evalRule(ast015, [
    { name: 'Asthma monitoring call first letter', date: REVIEW, value: '', code: '185731000' },
  ]);
  check(invite[0] && invite[0].status !== 'achieved', 'an asthma monitoring invitation is not a review');
  const monitoring = evalRule(ast015, [
    { name: 'Asthma monitoring', date: REVIEW, value: '', code: '275908000' },
    plan,
    count,
  ]);
  check(monitoring[0] && monitoring[0].status === 'achieved', 'Asthma monitoring (275908000) is a REV_COD review');
}

console.log('\n--- AST015 PCA suppresses the chip; achievement overrides it ---');
{
  const review = { name: 'Asthma annual review', date: REVIEW, value: '', code: '394700004' };
  const plan = { name: 'Patient has a written asthma personal action plan', date: REVIEW, value: '', code: '527171000000103' };
  const count = { name: 'Number of asthma exacerbations in past year', date: REVIEW, value: '1', code: '366874008' };
  const complete = [review, plan, count];
  const pcas = [
    { name: 'Excepted from asthma quality indicators - patient unsuitable', code: '717291000000103', label: 'patient unsuitable' },
    { name: 'Asthma monitoring declined', code: '763221007', label: 'monitoring declined' },
    { name: 'Excepted from asthma quality indicators - informed dissent', code: '716491000000100', label: 'informed dissent' },
  ];
  pcas.forEach((row) => {
    const only = evalRule(ast015, [{ name: row.name, date: REVIEW, value: '', code: row.code }]);
    check(only.length === 0, `${row.label} suppresses the chip (got ${only.length})`);
    const met = evalRule(ast015, complete.concat([{ name: row.name, date: REVIEW, value: '', code: row.code }]));
    check(met[0] && met[0].status === 'achieved', `a met review still achieves beside ${row.label}`);
  });
  const oneInvite = evalRule(ast015, [
    { name: 'Asthma monitoring call first letter', date: '2026-09-01', value: '', code: '185731000' },
  ]);
  check(oneInvite.length === 1, 'one invitation does not suppress the chip');
  const closeInvites = evalRule(ast015, [
    { name: 'Asthma monitoring call first letter', date: '2026-09-01', value: '', code: '185731000' },
    { name: 'Asthma monitoring call second letter', date: '2026-09-05', value: '', code: '185732007' },
  ]);
  check(closeInvites.length === 1, 'two invitations fewer than 7 days apart do not suppress the chip');
  const twoInvites = evalRule(ast015, [
    { name: 'Asthma monitoring call first letter', date: '2026-09-01', value: '', code: '185731000' },
    { name: 'Asthma monitoring call second letter', date: '2026-09-14', value: '', code: '185732007' },
  ]);
  check(twoInvites.length === 0, 'two invitations at least 7 days apart suppress the chip');
  const invitesAndReview = evalRule(
    ast015,
    complete.concat([
      { name: 'Asthma monitoring call first letter', date: '2026-09-01', value: '', code: '185731000' },
      { name: 'Asthma monitoring call second letter', date: '2026-09-14', value: '', code: '185732007' },
    ])
  );
  check(invitesAndReview[0] && invitesAndReview[0].status === 'achieved', 'a met review overrides the invitation PCA');
}

console.log('\n--- asthma resolved and age under 5 are outside AST015 ---');
{
  const resolved = engine.evaluateQofIndicatorRule(
    ast015,
    {
      medications: [],
      observations: [],
      problems: [{ label: 'Asthma resolved', codedDate: '2018-01-01', hasOnsetDate: true }],
      patientContext: { ageYears: 40 },
      _registerLookup: { ASTHMA: astReg },
    },
    NOW
  );
  check(resolved.length === 0, 'Asthma resolved does not put the patient on the register');
  const child = engine.evaluateQofIndicatorRule(
    ast015,
    {
      medications: [],
      observations: [
        { name: 'Asthma annual review', date: REVIEW, value: '', code: '394700004' },
        { name: 'Patient has a written asthma personal action plan', date: REVIEW, value: '', code: '527171000000103' },
        { name: 'Number of asthma exacerbations in past year', date: REVIEW, value: '1', code: '366874008' },
      ],
      problems: asthmaProblem,
      patientContext: { ageYears: 4 },
      _registerLookup: { ASTHMA: astReg },
    },
    NOW
  );
  check(child.length === 0, 'a child under 5 is excluded from AST015');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
