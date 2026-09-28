// Medicus Suite — QOF cluster gaps (synthetic)
// Run with: node test-qof-cluster-gaps.js
//
// No patient identifiers. Each case is a made-up code and a made-up date.

'use strict';

const engine = require('./engine/rules-engine.js');
const qof = require('./rules/qof-rules.json');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const NOW = '2026-09-28T12:00:00Z';
const DAY = '2026-09-21';

function rule(id) {
  return qof.rules.find((r) => r.id === id);
}
function reg(code) {
  return qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === code);
}

function evalRule(r, registerCode, problemLabel, observations, extra) {
  const data = Object.assign(
    {
      medications: [],
      observations: observations,
      problems: [{ label: problemLabel, status: 'active', codedDate: '2020-01-01' }],
      patientContext: { ageYears: 60 },
      _registerLookup: {},
    },
    extra || {}
  );
  data._registerLookup[registerCode] = reg(registerCode);
  return engine.evaluateQofIndicatorRule(r, data, NOW);
}

function obs(name, code, value) {
  return { name: name, code: code || null, value: value == null ? '1' : value, date: DAY };
}

const SEVEN = [
  obs('Body mass index', '60621009'),
  obs('Blood pressure'),
  obs('HbA1c'),
  obs('Cholesterol'),
  obs('Diabetic foot examination'),
  obs('ACR'),
  obs('eGFR'),
];

console.log('\n--- COPD010 is three components ---');
const copd = rule('qof-copd010');
check(copd.check.kind === 'observation-bundle' && copd.check.requireAll === true, 'COPD010 is a require-all bundle');
{
  const reviewOnly = evalRule(copd, 'COPD', 'Chronic obstructive pulmonary disease', [
    obs('Chronic obstructive pulmonary disease annual review', '394703002'),
  ]);
  check(
    reviewOnly[0] &&
      reviewOnly[0].status === 'not_met' &&
      /Exacerbation count/.test(reviewOnly[0].valueText) &&
      /MRC dyspnoea/.test(reviewOnly[0].valueText),
    'COPD010: the annual-review preferred term alone is not met (got ' +
      (reviewOnly[0] && reviewOnly[0].status) +
      ' ' +
      (reviewOnly[0] && reviewOnly[0].valueText) +
      ')'
  );
}
{
  const mrcOnly = evalRule(copd, 'COPD', 'Chronic obstructive pulmonary disease', [
    obs('Medical Research Council Dyspnoea scale grade 2', '391123006', '2'),
  ]);
  check(mrcOnly[0] && mrcOnly[0].status === 'not_met', 'COPD010: an MRC grade alone does not clear the review');
}
{
  const all = evalRule(copd, 'COPD', 'Chronic obstructive pulmonary disease', [
    obs('Chronic obstructive pulmonary disease 6 monthly review', '760621000000103'),
    obs('Number of chronic obstructive pulmonary disease exacerbations in past year', '723245007', '2'),
    obs('Medical Research Council Dyspnoea scale grade 3', '391124000', '3'),
  ]);
  check(all[0] && all[0].status === 'achieved', 'COPD010: review + exacerbation count + MRC grade is achieved');
}

console.log('\n--- DM037 smoking, foot, eGFR, ACR ---');
const dm = rule('qof-dm037');
{
  const smoker = evalRule(dm, 'DM', 'Type 2 diabetes mellitus', SEVEN.concat([obs('Smoker', '77176002')]));
  check(smoker[0] && smoker[0].status === 'achieved', 'DM037: a Smoker note completes the smoking slot');
}
{
  const tobacco = evalRule(dm, 'DM', 'Type 2 diabetes mellitus', SEVEN.concat([obs('Tobacco use')]));
  check(
    tobacco[0] && tobacco[0].status === 'not_met' && /Smoking/.test(tobacco[0].valueText),
    'DM037: tobacco use on its own does not complete smoking'
  );
}
{
  const withoutAcr = SEVEN.filter((o) => o.name !== 'ACR');
  const acro = evalRule(
    dm,
    'DM',
    'Type 2 diabetes mellitus',
    withoutAcr.concat([obs('Smoker', '77176002'), obs('Acrocyanosis')])
  );
  check(
    acro[0] && acro[0].status === 'not_met' && /ACR/.test(acro[0].valueText),
    'DM037: acrocyanosis does not complete ACR'
  );
}
{
  const withoutFoot = SEVEN.filter((o) => o.name !== 'Diabetic foot examination').concat([
    obs('Smoker', '77176002'),
    obs('Assessment using Ipswich Touch Test', '1433601000000104'),
  ]);
  const foot = evalRule(dm, 'DM', 'Type 2 diabetes mellitus', withoutFoot);
  check(foot[0] && foot[0].status === 'achieved', 'DM037: Ipswich Touch Test completes the foot slot');
}
{
  const withoutEgfr = SEVEN.filter((o) => o.name !== 'eGFR').concat([
    obs('Smoker', '77176002'),
    obs('CKD-EPI result', '80274001', '62'),
  ]);
  const egfr = evalRule(dm, 'DM', 'Type 2 diabetes mellitus', withoutEgfr);
  check(egfr[0] && egfr[0].status === 'achieved', 'DM037: glomerular filtration rate concept 80274001 completes eGFR');
}

console.log('\n--- CHOL004, HF007, AST014, MH007, DEM004, DM014, NDH003 ---');
{
  const chol = rule('qof-chol004');
  const chips = evalRule(chol, 'CHD', 'Coronary heart disease', [
    obs('Low density lipoprotein cholesterol', null, '1.8'),
  ]);
  check(
    chips[0] && chips[0].status === 'achieved',
    'CHOL004: low density lipoprotein cholesterol (no ldl abbreviation) counts'
  );
}
{
  const hf = rule('qof-hf007');
  const chips = evalRule(hf, 'HF', 'Heart failure', [obs('Heart failure 6 month review', '247361000000100')]);
  check(chips[0] && chips[0].status === 'achieved', 'HF007: heart failure 6 month review counts');
}
{
  const ast = rule('qof-ast012');
  const chips = evalRule(ast, 'ASTHMA', 'Asthma', [obs('Airways obstruction reversible', '170627008')], {
    problems: [{ label: 'Asthma', status: 'active', codedDate: '2025-06-01' }],
  });
  check(chips[0] && chips[0].status === 'achieved', 'AST014: airways obstruction reversible counts');
}
{
  const mh = rule('qof-mh007');
  const chips = evalRule(mh, 'SMI', 'Schizophrenia', [obs('Light drinker', '160575005')]);
  check(chips[0] && chips[0].status === 'achieved', 'MH007: light drinker (ALC_COD 160575005) counts');
}
{
  const dem = rule('qof-dem004');
  const chips = evalRule(dem, 'DEM', "Alzheimer's disease", [obs('Advance plan', '1095121000000102')]);
  check(chips[0] && chips[0].status === 'achieved', 'DEM004: dementia advance care plan agreed counts by concept id');
}
{
  const edu = rule('qof-dm014');
  const chips = evalRule(edu, 'DM', 'Type 2 diabetes mellitus', [obs('Programme referral', '415270003')]);
  check(chips[0] && chips[0].status === 'achieved', 'DM014: DSEP referral 415270003 counts by concept id');
}
{
  const ndh = rule('qof-ndh003');
  const chips = evalRule(ndh, 'NDH', 'Non-diabetic hyperglycaemia', [obs('IFCC monitoring', '999791000000106', '42')]);
  check(chips[0] && chips[0].status === 'achieved', 'NDH003: IFCC HbA1c concept 999791000000106 counts');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
