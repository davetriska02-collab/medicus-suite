// Medicus Suite — QOF OB005 / OBES2_REG (PCIT TA1026 cohort) tests
// Run with: node test-qof-ob005.js
//
// Locks denominator (age, ethnicity-adjusted BMI, 4-of-5 comorbidities,
// resolved-code supersession) and numerator (three pathway codes, not drug
// brand names; 6+6 carry-over; PCAs; achievement overrides exclusions).

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const qof = require(path.join(__dirname, 'rules', 'qof-rules.json'));

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const NOW = '2026-06-15T12:00:00Z';
const obes2 = qof.rules.find((r) => r.id === 'qof-reg-obes2');
const obReg = qof.rules.find((r) => r.registerCode === 'OB' && r.type === 'qof-register');
const ob005 = qof.rules.find((r) => r.id === 'qof-ob005');
const ob004 = qof.rules.find((r) => r.id === 'qof-ob004');

function lookup() {
  return { OBES2: obes2, OB: obReg };
}

const FOUR_COMORBID = [
  { label: 'Ischaemic heart disease', codedDate: '2020-01-01' },
  { label: 'Essential hypertension', codedDate: '2019-01-01' },
  { label: 'Obstructive sleep apnoea', codedDate: '2021-01-01' },
  { label: 'Type 2 diabetes mellitus', codedDate: '2018-01-01' },
];

function patient(overrides) {
  return {
    medications: [],
    observations: [{ name: 'BMI', value: '36', date: '2026-05-10' }],
    observationHistory: [],
    problems: FOUR_COMORBID.slice(),
    pastProblems: [],
    patientContext: { ageYears: 55, sex: 'female' },
    _registerLookup: lookup(),
    ...overrides,
  };
}

function chips(data, now) {
  return engine.evaluateQofIndicatorRule(ob005, data, now || NOW);
}

function regChips(data, now) {
  return engine.evaluateQofRegisterRule(obes2, data, now || NOW);
}

function pathwayObs(date) {
  const d = date || '2026-05-20';
  return [
    { name: 'NHS obesity medication pathway started', date: d, code: '2386231000000101' },
    { name: 'Referral to NHS obesity medication wraparound support', date: d, code: '2386201000000107' },
    { name: 'Shared decision making', date: d, code: '815691000000107' },
  ];
}

console.log('\n--- shipped rule shape ---');
check(!!obes2 && obes2.enabled === true, 'qof-reg-obes2 exists and is enabled');
check(obes2.membershipKind === 'bmi-comorbidity-cohort', 'OBES2 is a BMI + comorbidity cohort, not problem-label membership');
check(obes2.registerCode === 'OBES2' && obes2.ageMin === 18, 'OBES2 registerCode + ageMin 18');
check(!!ob005 && ob005.enabled === true, 'qof-ob005 enabled');
check(ob005.requiresRegister === 'OBES2', 'OB005 requires OBES2, not OB');
check(ob005.check.kind === 'pathway-bundle', 'OB005 check.kind is pathway-bundle');
check(ob005.check.groups.length === 3, 'OB005 has three pathway groups');
check(
  ['WTMGPHARM_COD', 'WTMGBSPREF_COD', 'SHARDECMAK_COD'].every((id) => ob005.check.groups.some((g) => g.id === id)),
  'OB005 groups are the PCIT pathway clusters'
);
check(!ob005.check.medicationMatch, 'OB005 does not list drug brand names as achievement');
check(ob005.points === 13 && ob005.thresholds.lower === 50 && ob005.thresholds.upper === 80, 'OB005 13pts / 50–80%');
check(ob004 && ob004.requiresRegister === 'OB', 'OB004 still uses the general OB register');
check(obReg && obReg.membershipKind !== 'bmi-comorbidity-cohort', 'general OB register is unchanged (problem-label approximation)');

console.log('\n--- denominator: age / BMI / ethnicity ---');
check(regChips(patient({ patientContext: { ageYears: 17 } })).length === 0, 'under-18 is not on OBES2');
check(
  regChips(
    patient({
      observations: [{ name: 'BMI', value: '34', date: '2026-05-10' }],
      patientContext: { ageYears: 40 },
    })
  ).length === 0,
  'BMI 34 with unknown ethnicity is below the 35 threshold'
);
check(
  regChips(
    patient({
      observations: [{ name: 'BMI', value: '33', date: '2026-05-10' }],
      patientContext: { ageYears: 40, ethnicity: 'South Asian' },
    })
  ).length === 1,
  'BMI 33 + South Asian family background meets the 32.5 threshold (with 4 comorbidities)'
);
check(
  engine.evaluateObes2Membership(
    obes2,
    patient({
      observations: [{ name: 'BMI', value: '33', date: '2026-05-10' }],
      patientContext: { ageYears: 40, familyBackground: 'Black African' },
    }),
    NOW
  ).matched === true,
  'Black African family background uses the 32.5 threshold'
);
check(
  regChips(
    patient({
      observations: [{ name: 'BMI', value: '29', date: '2026-05-10' }],
      problems: [{ label: 'Obesity' }],
      patientContext: { ageYears: 50 },
    })
  ).length === 0,
  'general obesity problem + BMI 29 is not OBES2 membership'
);
check(
  chips(
    patient({
      observations: [{ name: 'BMI', value: '29', date: '2026-05-10' }],
      problems: [{ label: 'Obesity' }],
      patientContext: { ageYears: 50 },
    })
  ).length === 0,
  'general OB problem alone does not fire OB005'
);
check(
  engine.evaluateQofRegisterRule(
    obReg,
    { problems: [{ label: 'Obesity' }], patientContext: { ageYears: 50 } },
    NOW
  ).length === 1,
  'the same obesity problem still sits on the general OB register'
);

console.log('\n--- denominator: 4-of-5 comorbidities ---');
check(
  regChips(patient({ problems: FOUR_COMORBID.slice(0, 3) })).length === 0,
  'BMI 36 + only 3 comorbidities is not on OBES2'
);
check(regChips(patient()).length === 1, 'BMI 36 + 4 comorbidities is on OBES2');
{
  const resolvedHtn = engine.evaluateObes2Comorbidities(
    {
      problems: [
        { label: 'Ischaemic heart disease', codedDate: '2020-01-01' },
        { label: 'Essential hypertension', codedDate: '2019-01-01' },
        { label: 'Hypertension resolved', codedDate: '2024-06-01' },
        { label: 'Obstructive sleep apnoea', codedDate: '2021-01-01' },
        { label: 'Type 2 diabetes mellitus', codedDate: '2018-01-01' },
      ],
      medications: [],
      observations: [],
      patientContext: { sex: 'female' },
    },
    obes2.cohort
  );
  const htn = resolvedHtn.items.find((i) => i.id === 'HYP_COD');
  check(htn && htn.met === false, 'resolved hypertension is superseded and does not count');
  check(resolvedHtn.metCount === 3, 'superseded HTN drops the comorbidity count to 3');
}
{
  const statin = engine.evaluateObes2Comorbidities(
    {
      problems: [
        { label: 'Ischaemic heart disease' },
        { label: 'Essential hypertension' },
        { label: 'Obstructive sleep apnoea' },
      ],
      medications: [{ name: 'Atorvastatin 20mg' }],
      observations: [],
      patientContext: {},
    },
    obes2.cohort
  );
  check(
    statin.items.find((i) => i.id === 'DYSLIP_COD').met === true && statin.metCount === 4,
    'statin counts as dyslipidaemia (4th comorbidity)'
  );
}
{
  const lipids = engine.evaluateObes2Comorbidities(
    {
      problems: [
        { label: 'Ischaemic heart disease' },
        { label: 'Essential hypertension' },
        { label: 'Obstructive sleep apnoea' },
      ],
      medications: [],
      observations: [
        { name: 'LDL cholesterol', value: '4.2' },
        { name: 'Triglycerides', value: '1.2' },
        { name: 'HDL cholesterol', value: '1.5' },
      ],
      patientContext: { sex: 'male' },
    },
    obes2.cohort
  );
  check(lipids.items.find((i) => i.id === 'DYSLIP_COD').met === true, 'LDL ≥4.1 counts as dyslipidaemia');
}
{
  const hdlF = engine.evaluateObes2Comorbidities(
    {
      problems: [],
      medications: [],
      observations: [{ name: 'HDL cholesterol', value: '1.2' }],
      patientContext: { sex: 'female' },
    },
    obes2.cohort
  );
  const hdlM = engine.evaluateObes2Comorbidities(
    {
      problems: [],
      medications: [],
      observations: [{ name: 'HDL cholesterol', value: '1.2' }],
      patientContext: { sex: 'male' },
    },
    obes2.cohort
  );
  check(hdlF.items.find((i) => i.id === 'DYSLIP_COD').met === true, 'HDL <1.3 in a woman counts as dyslipidaemia');
  check(hdlM.items.find((i) => i.id === 'DYSLIP_COD').met === false, 'HDL 1.2 in a man does not meet the <1 threshold');
}

console.log('\n--- numerator: pathway codes, not drugs ---');
{
  const achieved = chips(patient({ observations: [{ name: 'BMI', value: '36', date: '2026-05-10' }].concat(pathwayObs()) }));
  check(achieved.length === 1 && achieved[0].status === 'achieved', 'three in-year pathway codes → achieved');
}
{
  for (const brand of ['Orlistat 120mg', 'Ozempic 1mg', 'Xenical', 'Victoza']) {
    const out = chips(patient({ medications: [{ name: brand }] }));
    check(
      out.length === 1 && out[0].status === 'not_met',
      `${brand.split(' ')[0]} alone is not achievement (chip stays not_met)`
    );
  }
}
{
  const tirz = chips(patient({ medications: [{ name: 'Tirzepatide 5mg' }] }));
  check(tirz.length === 0, 'tirzepatide / Mounjaro without WTMGPHARM_COD is a PCA (no chip)');
}
{
  const mounjaro = chips(patient({ medications: [{ name: 'Mounjaro KwikPen' }] }));
  check(mounjaro.length === 0, 'Mounjaro brand without the pathway code is the same PCA');
}
{
  const override = chips(
    patient({
      medications: [{ name: 'Mounjaro 5mg' }],
      observations: [{ name: 'BMI', value: '36', date: '2026-05-10' }].concat(pathwayObs()),
      problems: FOUR_COMORBID.concat([{ label: 'Roux-en-Y gastric bypass', codedDate: '2015-01-01' }]),
    })
  );
  check(override.length === 1 && override[0].status === 'achieved', 'achievement later in the year overrides bariatric + drug-without-code PCAs');
}

console.log('\n--- 6+6 carry-over ---');
{
  const carry = chips(
    patient({
      observations: [
        { name: 'BMI', value: '36', date: '2026-05-10' },
        { name: 'NHS obesity medication pathway started', date: '2025-11-02' },
        { name: 'Referral to NHS obesity medication wraparound support', date: '2025-12-10' },
        { name: 'Shared decision making', date: '2026-02-01' },
      ],
    })
  );
  check(carry.length === 1 && carry[0].status === 'achieved', 'all three codes in the Oct–Sep span, not achieved last year → carry-over achieved');
  check(/carry-over/i.test(String(carry[0].valueText || '')), 'carry-over path is labelled on the chip');
}
{
  const alreadyLastYear = chips(
    patient({
      observations: [
        { name: 'BMI', value: '36', date: '2025-06-01' },
        { name: 'BMI', value: '36', date: '2026-05-10' },
        { name: 'NHS obesity medication pathway started', date: '2025-11-02' },
        { name: 'Referral to NHS obesity medication wraparound support', date: '2025-12-10' },
        { name: 'Shared decision making', date: '2026-02-01' },
      ],
    })
  );
  check(
    alreadyLastYear.length === 1 && alreadyLastYear[0].status === 'not_met',
    'carry-over does not apply when the previous QOF year was already achieved'
  );
}

console.log('\n--- PCAs (no chip unless already achieved) ---');
check(
  chips(patient({ problems: FOUR_COMORBID.concat([{ label: 'Gastric bypass', codedDate: '2014-03-01' }]) })).length === 0,
  'ever bariatric surgery removes an unachieved patient'
);
{
  const invites = chips(
    patient({
      observations: [
        { name: 'BMI', value: '36', date: '2026-05-10' },
        { name: 'Obesity monitoring invitation', date: '2026-04-10' },
        { name: 'Obesity monitoring invitation', date: '2026-04-20' },
      ],
    })
  );
  check(invites.length === 0, 'invited twice ≥7 days apart in-year is a PCA');
}
{
  const tooClose = chips(
    patient({
      observations: [
        { name: 'BMI', value: '36', date: '2026-05-10' },
        { name: 'Obesity monitoring invitation', date: '2026-04-10' },
        { name: 'Obesity monitoring invitation', date: '2026-04-14' },
      ],
    })
  );
  check(tooClose.length === 1 && tooClose[0].status === 'not_met', 'two invites <7 days apart is not a PCA');
}
{
  const newReg = chips(patient({ patientContext: { ageYears: 55, sex: 'female', registeredDate: '2027-02-01' } }));
  check(newReg.length === 0, 'new registration in the last 3 months of the year is a PCA when registeredDate is known');
}
{
  const unknownReg = chips(patient({ patientContext: { ageYears: 55, sex: 'female' } }));
  check(unknownReg.length === 1, 'unknown registeredDate does not apply the new-registration PCA (fail-open)');
}
{
  const lateOnly = chips(
    patient({
      observations: [{ name: 'BMI', value: '36', date: '2027-02-01' }],
    })
  );
  check(lateOnly.length === 0, 'raised BMI only in the last 90 days of the year, without achievement, is a PCA');
}
{
  const earlyAndLate = chips(
    patient({
      observations: [
        { name: 'BMI', value: '36', date: '2026-05-10' },
        { name: 'BMI', value: '37', date: '2027-02-01' },
      ],
    })
  );
  check(
    earlyAndLate.length === 1 && earlyAndLate[0].status === 'not_met',
    'an earlier in-year raised BMI means they were already eligible — late-BMI PCA does not apply'
  );
}
{
  const declined = chips(
    patient({
      observations: [
        { name: 'BMI', value: '36', date: '2026-05-10' },
        { name: 'NHS obesity medication pathway declined', date: '2026-05-01', code: '2386241000000105' },
      ],
    })
  );
  check(declined.length === 0, 'in-year declined / unsuitable / unavailable PCA codes remove an unachieved patient');
}
{
  const pcaHit = engine.evaluateObes2Pcas(
    ob005,
    patient({ problems: FOUR_COMORBID.concat([{ label: 'Sleeve gastrectomy', codedDate: '2016-01-01' }]) }),
    NOW,
    { status: 'not_met', window: engine.qofYearWindow(NOW) }
  );
  check(pcaHit === 'BARISURG_COD', 'evaluateObes2Pcas names the bariatric cluster');
}

console.log('\n--- evaluatePatient wiring ---');
{
  const out = engine.evaluatePatient(
    [],
    [{ name: 'BMI', value: '36', date: '2026-05-10' }].concat(pathwayObs()),
    [obes2, ob005, obReg, ob004],
    {
      problems: FOUR_COMORBID,
      patientContext: { ageYears: 55, sex: 'female' },
      now: NOW,
    }
  );
  const ids = out.map((c) => c.ruleId);
  check(ids.includes('qof-reg-obes2'), 'evaluatePatient emits the OBES2 register chip');
  check(
    out.some((c) => c.ruleId === 'qof-ob005' && c.status === 'achieved'),
    'evaluatePatient marks OB005 achieved on the three pathway codes'
  );
  check(!ids.includes('qof-ob004'), 'OB004 does not fire from the TA1026 cohort alone (still needs the general OB register)');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
