// Medicus Suite — QOF 2026/27 red-team gap regression
// Run with: node test-qof-redteam-2026.js
//
// Synthetic fixtures only. Concept ids are the ones already stored on the
// shipped rules (NHSD Primary Care Domain refsets / OpenCodelists 20260630).
// A decline, refusal, dissent, or unsuitable code must not come back achieved.

'use strict';

const engine = require('./engine/rules-engine.js');
const normalisers = require('./engine/normalisers.js');
const journal = require('./shared/journal-observations.js');
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

const NOW = '2026-06-01T12:00:00Z';
const IN_YEAR = '2026-05-01';

function rule(id) {
  return qof.rules.find((r) => r.id === id);
}
function reg(code) {
  return qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === code);
}

function evalRule(r, extra) {
  const x = extra || {};
  return engine.evaluateQofIndicatorRule(
    r,
    {
      medications: x.medications || [],
      observations: x.observations || [],
      problems: x.problems || [],
      patientContext: x.patientContext || { ageYears: 60 },
      _registerLookup: x.lookup || {},
    },
    x.now || NOW
  );
}

function onReg(registerRule, problems) {
  return engine.patientOnRegister(problems, registerRule).matched === true;
}

const hyp = reg('HYP');
const chd = reg('CHD');
const stia = reg('STIA');
const pad = reg('PAD');
const hf = reg('HF');
const dm = reg('DM');
const smi = reg('SMI');
const af = reg('AF');
const dem = reg('DEM');
const asthma = reg('ASTHMA');
const ob = reg('OB');

const hypProblem = [{ label: 'Essential hypertension', codedDate: '2020-01-01' }];
const chdProblem = [{ label: 'Coronary heart disease', codedDate: '2020-01-01' }];

console.log('\n--- windows: 365 stays on the QOF-year floor; other withinDays roll ---');
{
  const floor = {
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'WIN365',
    check: { kind: 'observation-recent', observation: ['spirometry'], withinDays: 365 },
  };
  const beforeApril = evalRule(floor, {
    observations: [{ name: 'Spirometry', date: '2026-03-01', value: 'done' }],
  });
  check(
    beforeApril[0] && beforeApril[0].status === 'overdue',
    'withinDays 365 still treats a pre-April date as overdue'
  );
  const inYear = evalRule(floor, {
    observations: [{ name: 'Spirometry', date: IN_YEAR, value: 'done' }],
  });
  check(inYear[0] && inYear[0].status === 'achieved', 'withinDays 365 achieves a date inside the QOF year');

  const rolling = {
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'WIN1826',
    check: { kind: 'observation-recent', observation: ['blood pressure'], withinDays: 1826, window: 'rolling' },
  };
  const fourYears = evalRule(rolling, {
    observations: [{ name: 'Blood pressure', date: '2022-06-01', value: '120/80' }],
  });
  check(fourYears[0] && fourYears[0].status === 'achieved', 'withinDays 1826 keeps a four-year-old reading');
  const sevenYears = evalRule(rolling, {
    observations: [{ name: 'Blood pressure', date: '2019-01-01', value: '120/80' }],
  });
  check(sevenYears[0] && sevenYears[0].status === 'overdue', 'withinDays 1826 does not keep a seven-year-old reading');
}

console.log('\n--- registers: concept id, history-of, resolution, organic psychosis ---');
{
  check(onReg(stia, [{ label: 'History of stroke', codedDate: '2019-01-01' }]), 'history of stroke stays on the STIA register');
  check(
    !onReg(stia, [{ label: 'Family history of stroke', codedDate: '2019-01-01' }]),
    'family history of stroke is not the STIA register'
  );
  check(
    !onReg(stia, [{ label: 'No history of stroke', codedDate: '2019-01-01' }]),
    'no history of stroke is not the STIA register'
  );
  check(!onReg(stia, [{ label: 'Suspected stroke', codedDate: '2019-01-01' }]), 'suspected stroke is not the STIA register');
  check((stia.problemConceptIds || []).length >= 40, 'STIA register carries the stroke/TIA cluster ids');

  const padId = String(pad.problemConceptIds[0]);
  check(
    onReg(pad, [{ label: 'coded cluster member', conceptId: padId, codedDate: '2019-01-01' }]),
    'PAD matches a cluster concept id when the label is not the rubric'
  );
  check(!onReg(pad, [{ label: 'leg cramp', codedDate: '2019-01-01' }]), 'an unrelated PAD label stays off the register');
  check((pad.problemConceptIds || []).length >= 40, 'PAD register is wider than the old five-term list');

  const chdId = String(chd.problemConceptIds[0]);
  check(
    onReg(chd, [{ label: 'coded cluster member', conceptId: chdId, codedDate: '2019-01-01' }]),
    'CHD matches a cluster concept id before the label'
  );
  check(
    !onReg(chd, [{ label: 'Family history of myocardial infarction', codedDate: '2019-01-01' }]),
    'family history of MI is not the CHD register'
  );

  check(
    (hf.problemConceptIds || []).map(String).includes('85232009'),
    'HF register includes 85232009 left ventricular failure'
  );
  check(
    onReg(hf, [{ label: 'coded cluster member', conceptId: '85232009', codedDate: '2019-01-01' }]),
    '85232009 puts the patient on the HF register without a matching label'
  );
  check(!onReg(hf, [{ label: 'Cardiomyopathy', codedDate: '2019-01-01' }]), 'cardiomyopathy alone is not the HF register');
  check(
    !onReg(hf, [{ label: 'Left ventricular systolic dysfunction', codedDate: '2019-01-01' }]),
    'LVSD wording alone is not the HF register'
  );

  check(onReg(smi, [{ label: 'Non-organic psychosis', codedDate: '2018-01-01' }]), 'non-organic psychosis stays on the MH register');
  check(!onReg(smi, [{ label: 'Organic psychosis', codedDate: '2018-01-01' }]), 'organic psychosis stays off the MH register');
  check(
    onReg(smi, [{ label: 'Bipolar II disorder', codedDate: '2018-01-01' }]),
    'bipolar II wording is on the MH register'
  );
  check((smi.problemConceptIds || []).length >= 190, 'MH register carries the MH_COD cluster');
  const remissionId = String(smi.problemExcludeConceptIds[0]);
  check(
    !onReg(smi, [
      { label: 'Schizophrenia', codedDate: '2015-01-01' },
      { label: 'remission code', conceptId: remissionId, codedDate: '2024-01-01' },
    ]),
    'a later MHREM concept takes the patient off the MH register'
  );
  check(
    onReg(smi, [
      { label: 'Schizophrenia', codedDate: '2015-01-01' },
      { label: 'remission code', conceptId: remissionId },
    ]),
    'an undated remission code does not outrank a dated diagnosis'
  );

  check(
    onReg(dm, [{ label: 'Maturity onset diabetes of the young', codedDate: '2020-01-01' }]),
    'MODY wording is on the diabetes register'
  );
  check(
    !onReg(dm, [
      { label: 'Type 2 diabetes mellitus', codedDate: '2018-01-01' },
      { label: 'Diabetes resolved', conceptId: '315051004', codedDate: '2024-06-01' },
    ]),
    'a later diabetes-resolved concept takes the patient off the DM register'
  );
  check(
    !onReg(asthma, [
      { label: 'Asthma', codedDate: '2024-01-01' },
      { label: 'Asthma resolved', conceptId: '162660004', codedDate: '2025-01-01' },
    ]),
    'a later asthma-resolved concept takes the patient off the asthma register'
  );
}

console.log('\n--- dashboard concept id and split blood pressure ---');
{
  const dash = {
    rowData: [
      {
        investigationType: 'Serum low density lipoprotein cholesterol level',
        investigationTypeCode: { conceptId: '1022191000000100' },
        unit: 'mmol/L',
        data20260501: { result: '1.8' },
      },
      {
        investigationType: 'Sodium',
        unit: 'mmol/L',
        data20260501: { result: '140' },
      },
      {
        investigationType: 'Systolic arterial pressure',
        unit: 'mmHg',
        data20260501: { result: '138' },
      },
      {
        investigationType: 'Diastolic arterial pressure',
        unit: 'mmHg',
        data20260501: { result: '88' },
      },
      {
        investigationType: 'Average home systolic blood pressure',
        unit: 'mmHg',
        data20260502: { result: '130' },
      },
      {
        investigationType: 'Minimum home systolic blood pressure',
        unit: 'mmHg',
        data20260502: { result: '100' },
      },
      {
        investigationType: 'Home diastolic blood pressure',
        unit: 'mmHg',
        data20260502: { result: '80' },
      },
    ],
  };
  const obs = normalisers.normaliseObservations(dash);
  const ldl = obs.find((o) => /low density lipoprotein/i.test(o.name));
  const sodium = obs.find((o) => o.name === 'Sodium');
  check(ldl && ldl.code === '1022191000000100', 'dashboard concept id is kept when the row has one');
  check(sodium && sodium.code === null, 'a dashboard row with no concept field stays code null');
  const clinic = obs.find((o) => o.name === 'Blood pressure' && o.date === '2026-05-01');
  check(clinic && String(clinic.rawValue) === '138/88', 'split arterial-pressure rows become one blood-pressure reading');
  const home = obs.find((o) => o.name === 'Home blood pressure');
  check(home && home.bpModality === 'home' && String(home.rawValue) === '130/80', 'same-day average home pressure beats the minimum');

  const hist = journal.mergeJournalObsIntoHistory(
    [],
    [{ name: 'Asthma control test', code: '443117005', date: IN_YEAR, value: '20' }],
    (v) => v
  );
  check(hist[0] && hist[0].code === '443117005', 'a new journal history group keeps the concept id');
}

console.log('\n--- HYP010 / HYP011 blood pressure, frailty, PCA ---');
{
  const hyp010 = rule('qof-hyp010');
  const hyp011 = rule('qof-hyp011');
  const lookup = { HYP: hyp };
  const bp = (name, value, date) => [{ name, value, date: date || IN_YEAR }];
  const h10 = (observations, problems, age) =>
    evalRule(hyp010, {
      lookup,
      problems: problems || hypProblem,
      observations,
      patientContext: { ageYears: age == null ? 60 : age },
    });

  check(h10(bp('Blood pressure', '138/88'))[0].status === 'achieved', 'HYP010 clinic 138/88 is achieved at 140/90');
  check(
    h10(bp('Home blood pressure', '136/82', IN_YEAR).map((o) => Object.assign({ bpModality: 'home' }, o)))[0].status ===
      'not_met',
    'HYP010 home 136/82 is not achieved at 135/85'
  );
  check(
    h10([{ name: 'Home blood pressure', value: '134/80', date: IN_YEAR, bpModality: 'home' }])[0].status === 'achieved',
    'HYP010 home 134/80 is achieved at 135/85'
  );
  check(
    h10(bp('Blood pressure declined', '120/70'))[0].status !== 'achieved',
    'HYP010 a declined blood pressure does not achieve'
  );
  check(
    h10([{ name: 'BP', code: '413123006', value: '120/70', date: IN_YEAR }]).length === 0 ||
      h10([{ name: 'BP', code: '413123006', value: '120/70', date: IN_YEAR }])[0].status !== 'achieved',
    'HYP010 BPDEC concept 413123006 does not achieve'
  );

  const pair = h10([
    { name: 'Blood pressure', value: '138/88', date: IN_YEAR },
    { name: 'Systolic blood pressure', value: '180', date: IN_YEAR },
  ]);
  check(pair[0] && pair[0].status === 'achieved', 'HYP010 a same-day slash pair beats a bare systolic row');
  const laterBare = h10([
    { name: 'Blood pressure', value: '138/88', date: '2026-04-02' },
    { name: 'Systolic blood pressure', value: '120', date: IN_YEAR },
  ]);
  check(
    laterBare[0] && laterBare[0].status === 'no_data',
    'HYP010 a later unparseable systolic does not fall through to an older pair'
  );

  check(
    h10(bp('Blood pressure', '160/90'), hypProblem.concat([{ label: 'Moderately frail' }])).length === 0,
    'HYP010 moderately frail text excludes the patient'
  );
  check(
    h10(bp('Blood pressure', '160/90'), hypProblem.concat([{ label: 'Clinical frailty scale', conceptId: '1129381000000102' }]))
      .length === 0,
    'HYP010 CFS 6 concept 1129381000000102 excludes the patient'
  );
  check(
    h10(bp('Blood pressure', '160/90'), hypProblem.concat([{ label: 'Mild frailty' }])).length === 1,
    'HYP010 mild frailty does not exclude'
  );

  const dissent = { name: 'excepted from hypertension quality indicators - informed dissent', code: '716771000000106', date: IN_YEAR, value: '' };
  check(h10([dissent]).length === 0, 'HYP010 informed dissent suppresses the chip when BP is not achieved');
  const achievedAndPca = h10(bp('Blood pressure', '130/80').concat([dissent]));
  check(achievedAndPca[0] && achievedAndPca[0].status === 'achieved', 'HYP010 an in-target BP overrides the PCA');
  const invite = (date) => ({
    name: 'hypertension quality indicator-related care invitation',
    code: '185719002',
    date,
    value: '',
  });
  check(
    h10([invite('2026-04-10'), invite('2026-04-20')]).length === 0,
    'HYP010 two invitations at least 7 days apart suppress the chip'
  );
  check(h10([invite('2026-04-10')]).length === 1, 'HYP010 a single invitation does not suppress the chip');

  const h11 = (observations) =>
    evalRule(hyp011, {
      lookup,
      problems: hypProblem,
      observations,
      patientContext: { ageYears: 82 },
    });
  check(
    h11([{ name: 'Home blood pressure', value: '146/84', date: IN_YEAR, bpModality: 'home' }])[0].status === 'not_met',
    'HYP011 home 146/84 is not achieved at 145/85'
  );
  check(h11(bp('Blood pressure', '148/88'))[0].status === 'achieved', 'HYP011 clinic 148/88 is achieved at 150/90');
  check(h11(bp('Blood pressure declined', '120/70'))[0].status !== 'achieved', 'HYP011 a declined reading does not achieve');
}

console.log('\n--- CHOL003 / CHOL004 ---');
{
  const chol003 = rule('qof-chol003');
  const chol004 = rule('qof-chol004');
  const lookup = { CHD: chd };
  const c3 = (medications, observations) =>
    evalRule(chol003, { lookup, problems: chdProblem, medications, observations });
  check(c3([{ name: 'atorvastatin 20mg' }])[0].status === 'achieved', 'CHOL003 a statin achieves');
  check(c3([{ name: 'ezetimibe 10mg' }])[0].status === 'not_met', 'CHOL003 ezetimibe alone does not achieve');
  check(
    c3([{ name: 'ezetimibe 10mg' }], [{ name: 'Statin declined', code: '134396000', date: '2024-01-01', value: '' }])[0]
      .status === 'achieved',
    'CHOL003 ezetimibe plus a statin-declined code achieves'
  );

  const ldl = (value, date) => ({
    name: 'Serum low density lipoprotein cholesterol level',
    code: '1010591000000104',
    date: date || IN_YEAR,
    value: String(value),
    unit: 'mmol/L',
  });
  const nonHdl = (value, date) => ({
    name: 'Serum non high density lipoprotein cholesterol level',
    code: '1006191000000106',
    date: date || IN_YEAR,
    value: String(value),
    unit: 'mmol/L',
  });
  const c4 = (observations) => evalRule(chol004, { lookup, problems: chdProblem, observations });
  check(c4([ldl(1.8)])[0].status === 'achieved', 'CHOL004 LDL 1.8 is achieved at 2.0');
  check(c4([ldl(2.1)])[0].status === 'not_met', 'CHOL004 LDL 2.1 is not achieved');
  check(c4([nonHdl(2.4)])[0].status === 'achieved', 'CHOL004 non-HDL 2.4 is achieved when no same-date LDL exists');
  check(c4([ldl(2.1), nonHdl(2.4)])[0].status === 'not_met', 'CHOL004 LDL wins on the same date');
  check(
    c4([{ name: 'LDL cholesterol declined', code: '141851000119107', date: IN_YEAR, value: '1.0', unit: 'mmol/L' }])[0]
      .status !== 'achieved',
    'CHOL004 a declined cholesterol does not achieve'
  );
}

console.log('\n--- AF008 ---');
{
  const af008 = rule('qof-af008');
  const lookup = { AF: af };
  const problems = [{ label: 'Atrial fibrillation', codedDate: '2020-01-01' }];
  const score = (value) => ({ name: 'CHA2DS2-VASc', code: '735259005', date: IN_YEAR, value: String(value) });
  const run = (medications, observations) => evalRule(af008, { lookup, problems, medications, observations });
  check(run([{ name: 'Eliquis 5mg' }], [score(3)])[0].status === 'achieved', 'AF008 Eliquis with score 3 achieves');
  check(run([{ name: 'Eliquis 5mg' }], [score(1)]).length === 0, 'AF008 score under 2 raises no chip');
  check(
    run([{ name: 'Eliquis 5mg' }], []).length === 1 && run([{ name: 'Eliquis 5mg' }], [])[0].status === 'not_met',
    'AF008 a missing score is not achieved'
  );
  check(run([{ name: 'warfarin 3mg' }], [score(3)])[0].status === 'not_met', 'AF008 warfarin alone does not achieve');
  check(
    run([{ name: 'warfarin 3mg' }], [score(3), { name: 'DOAC declined', code: '912661000000103', date: '2024-01-01', value: '' }])[0]
      .status === 'achieved',
    'AF008 warfarin plus a DOAC-declined code achieves'
  );
  check(
    run([{ name: 'apixaban 5mg', lastIssueDate: '2024-01-01' }], [score(3)])[0].status === 'not_met',
    'AF008 an issue older than 183 days does not count'
  );
  check(
    run([{ name: 'apixaban 5mg' }], [score(3)])[0].status === 'achieved',
    'AF008 a current DOAC with no issue date still counts'
  );
}

console.log('\n--- HF008 / HF009 ---');
{
  const hf008 = rule('qof-hf008');
  const hf009 = rule('qof-hf009');
  const lookup = { HF: hf };
  const hf008run = (codedDate, observations) =>
    evalRule(hf008, {
      lookup,
      problems: [{ label: 'Heart failure', codedDate, hasOnsetDate: true }],
      observations,
    });
  check(
    hf008run('2026-01-01', [
      { name: 'TTE', date: '2026-02-01', value: 'normal' },
      { name: 'TTE', date: '2026-09-01', value: 'normal' },
    ])[0].status === 'achieved',
    'HF008 an in-window echo still achieves when a later echo is outside 183 days'
  );
  check(
    hf008run('2018-01-01', [{ name: 'TTE', date: IN_YEAR, value: 'normal' }])[0].status !== 'achieved',
    'HF008 an echo years after diagnosis does not achieve'
  );
  check(
    hf008run('2026-01-01', [{ name: 'Echocardiogram declined', date: '2026-02-01', value: '' }])[0].status !== 'achieved',
    'HF008 a declined echo does not achieve'
  );

  const pillars = (names) =>
    evalRule(hf009, {
      lookup,
      problems: [
        { label: 'Heart failure', codedDate: '2020-01-01' },
        { label: 'Heart failure with reduced ejection fraction', codedDate: '2020-01-01' },
      ],
      medications: names.map((name) => ({ name })),
    });
  const four = ['ramipril', 'bisoprolol', 'spironolactone', 'dapagliflozin'];
  check(pillars(four)[0].status === 'achieved', 'HF009 the four licensed pillars achieve');
  check(
    pillars(['ramipril', 'metoprolol', 'spironolactone', 'dapagliflozin'])[0].status === 'not_met',
    'HF009 metoprolol does not complete the beta-blocker pillar'
  );
  check(
    pillars(['ramipril', 'bisoprolol', 'spironolactone', 'canagliflozin'])[0].status === 'not_met',
    'HF009 canagliflozin does not complete the SGLT2 pillar'
  );
  check(
    pillars(['ramipril', 'bisoprolol', 'spironolactone', 'ertugliflozin'])[0].status === 'not_met',
    'HF009 ertugliflozin does not complete the SGLT2 pillar'
  );
}

console.log('\n--- DM014 / DM020 / DM036 / OB004 / AST014 ---');
{
  const dm014 = rule('qof-dm014');
  const dm020 = rule('qof-dm020');
  const dm036 = rule('qof-dm036');
  const ob004 = rule('qof-ob004');
  const ast014 = rule('qof-ast012');
  check(dm036.ageRange && dm036.ageRange.max === 70, 'DM036 age max stays 70 while 79 is unverified');

  const dmProblems = (date) => [{ label: 'Type 2 diabetes mellitus', codedDate: date }];
  const edu = (date, name) => [{ name: name || 'DESMOND', date, value: 'attended' }];
  check(
    evalRule(dm014, { lookup: { DM: dm }, problems: dmProblems('2026-04-15'), observations: edu('2026-05-01') })[0]
      .status === 'achieved',
    'DM014 education within 279 days of an in-year diagnosis achieves'
  );
  check(
    evalRule(dm014, { lookup: { DM: dm }, problems: dmProblems('2026-05-20'), observations: edu('2026-04-01') })[0]
      .status === 'overdue',
    'DM014 education dated before the diagnosis does not achieve'
  );
  check(
    evalRule(dm014, { lookup: { DM: dm }, problems: dmProblems('2025-06-01'), observations: edu(IN_YEAR) }).length === 0,
    'DM014 stays silent when the diagnosis is before this QOF year'
  );
  check(
    evalRule(dm014, {
      lookup: { DM: dm },
      problems: dmProblems('2026-04-15'),
      observations: edu(IN_YEAR, 'Diabetes education declined'),
    })[0].status !== 'achieved',
    'DM014 a declined education code does not achieve'
  );
  check(
    evalRule(dm014, {
      lookup: { DM: dm },
      problems: dmProblems('2026-04-01'),
      observations: [],
      now: '2027-02-01T12:00:00Z',
    })[0].status === 'overdue',
    'DM014 is overdue once 279 days have passed with no education code'
  );

  const hba = (value, unit, code) => [
    { name: 'HbA1c', date: IN_YEAR, value: String(value), unit: unit, code: code || null },
  ];
  const d20 = (observations, problems) =>
    evalRule(dm020, { lookup: { DM: dm }, problems: problems || dmProblems('2019-01-01'), observations });
  check(d20(hba('58', 'mmol/mol'))[0].status === 'achieved', 'DM020 58 mmol/mol achieves');
  check(d20(hba('70', 'mmol/mol'))[0].status === 'not_met', 'DM020 70 mmol/mol does not achieve');
  check(d20(hba('7.5%', '%'))[0].status === 'no_data', 'DM020 a DCCT percent value is no_data');
  check(d20(hba('7.5', ''))[0].status === 'no_data', 'DM020 a blank unit with 7.5 is no_data');
  check(d20(hba('58', ''))[0].status === 'achieved', 'DM020 a blank unit with 58 still compares as mmol/mol');
  check(
    d20(hba('58', 'mmol/mol', '1019431000000105'))[0].status === 'no_data',
    'DM020 a DCCT concept id is no_data even when the number looks like IFCC'
  );
  check(
    d20(hba('80', 'mmol/mol'), dmProblems('2019-01-01').concat([{ label: 'Clinical frailty scale', conceptId: '1129401000000102' }]))
      .length === 0,
    'DM020 CFS 8 excludes the non-frail target'
  );

  const d36 = (observations, age) =>
    evalRule(dm036, {
      lookup: { DM: dm },
      problems: dmProblems('2019-01-01'),
      observations,
      patientContext: { ageYears: age },
    });
  check(d36([{ name: 'Blood pressure', value: '130/80', date: IN_YEAR }], 68)[0].status === 'achieved', 'DM036 age 68 with 130/80 achieves');
  check(d36([{ name: 'Blood pressure', value: '130/80', date: IN_YEAR }], 75).length === 0, 'DM036 age 75 is outside the age max of 70');
  check(
    d36([{ name: 'Blood pressure declined', value: '120/70', date: IN_YEAR }], 68)[0].status !== 'achieved',
    'DM036 a declined blood pressure does not achieve'
  );

  const obRun = (observations) =>
    evalRule(ob004, {
      lookup: { OB: ob },
      problems: [{ label: 'Obesity', codedDate: '2020-01-01' }],
      observations,
      patientContext: { ageYears: 40 },
    });
  check(
    obRun([
      { name: 'Body mass index', date: '2026-04-01', value: '32' },
      { name: 'Weight management referral', date: '2026-05-01', value: 'offered' },
    ])[0].status === 'achieved',
    'OB004 a referral within 90 days of the BMI achieves'
  );
  check(
    obRun([
      { name: 'Body mass index', date: '2026-01-01', value: '32' },
      { name: 'Weight management referral', date: IN_YEAR, value: 'offered' },
    ])[0].status === 'overdue',
    'OB004 a referral more than 90 days after the BMI does not achieve'
  );
  check(
    obRun([{ name: 'Weight management referral declined', date: IN_YEAR, value: '' }])[0].status !== 'achieved',
    'OB004 a declined referral does not achieve'
  );

  const ast = (codedDate, observations) =>
    evalRule(ast014, {
      lookup: { ASTHMA: asthma },
      problems: [{ label: 'Asthma', codedDate, hasOnsetDate: true }],
      observations: observations || [],
    });
  check(
    ast('2026-01-01', [{ name: 'Spirometry', date: '2026-02-01', value: 'obstructive' }])[0].status === 'achieved',
    'AST014 spirometry within 93 days achieves'
  );
  check(
    ast('2026-01-01', [{ name: 'Spirometry', date: '2026-05-01', value: 'obstructive' }])[0].status === 'overdue',
    'AST014 spirometry outside 93 days stays overdue'
  );
  check(
    ast('2026-01-01', [{ name: 'Spirometry declined', date: '2026-02-01', value: '' }])[0].status !== 'achieved',
    'AST014 a declined spirometry does not achieve'
  );
}

console.log('\n--- MH002 / MH007 / DEM004 ---');
{
  const mh002 = rule('qof-mh002');
  const mh007 = rule('qof-mh007');
  const dem004 = rule('qof-dem004');
  const smiProblems = [{ label: 'Schizophrenia', codedDate: '2016-01-01' }];
  const m2 = (observations) => evalRule(mh002, { lookup: { SMI: smi }, problems: smiProblems, observations });
  check(
    m2([{ name: 'coded care plan', code: '1092211000000107', date: IN_YEAR, value: 'agreed' }])[0].status === 'achieved',
    'MH002 an MHP concept id achieves'
  );
  check(
    m2([{ name: 'Mental health review', date: IN_YEAR, value: 'done' }])[0].status !== 'achieved',
    'MH002 a mental health review does not clear the care plan'
  );
  const mhPca = { name: 'excepted from mental health quality indicators - informed dissent', code: '717051000000101', date: IN_YEAR, value: '' };
  check(m2([mhPca]).length === 0, 'MH002 informed dissent suppresses the chip');
  check(
    m2([
      { name: 'coded care plan', code: '1092211000000107', date: IN_YEAR, value: 'agreed' },
      mhPca,
    ])[0].status === 'achieved',
    'MH002 an achieved care plan overrides the PCA'
  );

  const m7 = (observations) => evalRule(mh007, { lookup: { SMI: smi }, problems: smiProblems, observations });
  check(
    m7([{ name: 'Current drinker of alcohol', date: IN_YEAR, value: 'yes' }])[0].status === 'achieved',
    'MH007 current drinker of alcohol achieves'
  );
  check(
    m7([{ name: 'status code', code: '105542008', date: IN_YEAR, value: '1' }])[0].status === 'achieved',
    'MH007 an ALC concept id achieves when the label is not the rubric'
  );
  check(
    m7([{ name: 'Current drinker of alcohol', date: '2025-01-01', value: 'yes' }])[0].status === 'overdue',
    'MH007 a status from before this QOF year is overdue'
  );
  check(
    m7([{ name: 'Alcohol consumption declined', date: IN_YEAR, value: '' }])[0].status !== 'achieved',
    'MH007 a declined alcohol code does not achieve'
  );

  const d4 = (observations) =>
    evalRule(dem004, {
      lookup: { DEM: dem },
      problems: [{ label: 'Dementia', codedDate: '2018-01-01' }],
      observations,
    });
  check(
    d4([{ name: 'review code', code: '956861000000107', date: IN_YEAR, value: 'done' }])[0].status === 'achieved',
    'DEM004 a review concept id achieves'
  );
  check(
    d4([{ name: 'Dementia care plan agreed', date: IN_YEAR, value: 'agreed' }])[0].status !== 'achieved',
    'DEM004 a plan agreed does not achieve'
  );
  check(
    d4([{ name: 'Dementia review declined', code: '956901000000100', date: IN_YEAR, value: '' }])[0].status !== 'achieved',
    'DEM004 a declined review does not achieve'
  );
  const demPca = { name: 'excepted from dementia quality indicators - informed dissent', code: '716131000000105', date: IN_YEAR, value: '' };
  check(d4([demPca]).length === 0, 'DEM004 informed dissent suppresses the chip');
}

console.log('\n--- BP002 on; CS005/CS006 and VI001–VI004 off ---');
{
  const bp002 = rule('qof-bp002');
  const cs005 = rule('qof-cs005');
  const cs006 = rule('qof-cs006');
  check(bp002 && bp002.enabled === true, 'BP002 is enabled');
  check(cs005 && cs005.enabled === false && cs006 && cs006.enabled === false, 'CS005 and CS006 stay disabled');
  ['qof-vi001', 'qof-vi002', 'qof-vi003', 'qof-vi004'].forEach((id) => {
    const r = rule(id);
    check(r && r.enabled === false && (r.check.observation || []).length === 0, id + ' is disabled with an empty numerator');
  });

  const bp = (date, name) =>
    evalRule(bp002, {
      observations: [{ name: name || 'Blood pressure', date, value: '128/76', code: name ? '413123006' : null }],
      patientContext: { ageYears: 50 },
    });
  check(bp('2022-06-01')[0].status === 'achieved', 'BP002 a four-year-old blood pressure achieves');
  check(bp('2019-01-01')[0].status === 'overdue', 'BP002 a reading older than five years is overdue');
  check(bp(IN_YEAR, 'Blood pressure declined')[0].status !== 'achieved', 'BP002 a declined reading does not achieve');
  check(
    evalRule(bp002, {
      observations: [{ name: 'Blood pressure', date: IN_YEAR, value: '128/76' }],
      patientContext: { ageYears: 44 },
    }).length === 0,
    'BP002 age 44 raises no chip'
  );

  const csDirect = (observations, id) =>
    evalRule(rule(id), {
      observations,
      patientContext: { ageYears: 40, sex: 'female' },
    });
  check(
    csDirect([{ name: 'Cervical screening test declined', code: '315013004', date: IN_YEAR, value: '' }], 'qof-cs005')[0]
      .status !== 'achieved',
    'CS005 a declined screening does not achieve'
  );
  check(
    csDirect([{ name: 'Cervical smear', date: IN_YEAR, value: 'candida' }], 'qof-cs005')[0].status !== 'achieved',
    'CS005 a candida smear label does not achieve'
  );
  const cs006chips = evalRule(rule('qof-cs006'), {
    observations: [{ name: 'Cervical screening test declined', code: '315013004', date: '2022-01-01', value: '' }],
    patientContext: { ageYears: 55, sex: 'female' },
  });
  check(
    cs006chips.length === 0 || cs006chips[0].status !== 'achieved',
    'CS006 a declined screening does not achieve'
  );

  const batch = engine.evaluatePatient(
    [],
    [
      { name: 'Cervical screening test', date: IN_YEAR, value: 'done' },
      { name: 'Shingles vaccination', date: IN_YEAR, value: 'given' },
      { name: 'Blood pressure', date: IN_YEAR, value: '128/76' },
    ],
    qof.rules,
    { now: NOW, patientContext: { ageYears: 50, sex: 'female' }, problems: [] }
  );
  check(
    !batch.some((c) => c.indicatorCode === 'CS005' || c.indicatorCode === 'CS006'),
    'disabled CS005/CS006 do not fire from the patient evaluation'
  );
  check(
    !batch.some((c) => /^VI00/.test(c.indicatorCode || '')),
    'disabled VI001–VI004 do not fire from the patient evaluation'
  );
  check(
    batch.some((c) => c.indicatorCode === 'BP002' && c.status === 'achieved'),
    'BP002 fires from the patient evaluation'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
