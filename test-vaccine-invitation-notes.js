// Medicus Suite — vaccination invitation notes must not read as a dose given
// Run with: node test-vaccine-invitation-notes.js
//
// v3.268.3 (PR #477) started reading coded journal notes. The COVID given
// stem "sars-cov-2 vaccin" is a substring of the SNOMED situation concept
// "SARS-CoV-2 vaccination invitation short message service text message sent
// (situation)", so a Nexus recall SMS turned the COVID tile green. Flu's
// given stems do not sit inside "Influenza vaccination invitation …", which
// is why that tile stayed due. The same prefix hits pneumococcal, shingles
// and RSV invitation concepts, and would hit VI001–VI004 if those numerators
// were ever filled in.
//
// Synthetic fixture only. No patient identifiers.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const JO = require(path.join(__dirname, 'shared', 'journal-observations.js'));
const vaxRules = require(path.join(__dirname, 'rules', 'vaccine-rules.json'));
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

// In campaign for flu and COVID (season opens 1 Sep). The journal day is
// Thu 24 Sep 2026, inside the 2026/27 season.
const NOW = '2026-09-29';
const NOTE_DATE = '2026-09-24';

const FLU_DESC = 'Influenza vaccination invitation short message service text message sent (situation)';
const COVID_DESC = 'SARS-CoV-2 vaccination invitation short message service text message sent (situation)';
const FLU_BODY =
  'Invitation sent by the flu, COVID and RSV recall automation (Nexus) ' +
  'Vaccination VAC_FLU — recorded via Nexus by Nexus (filed automatically with the invitation that was sent)';
const COVID_BODY =
  'Invitation sent by the flu, COVID and RSV recall automation (Nexus) ' +
  'Vaccination VAC_COVID — recorded via Nexus by Nexus (filed automatically with the invitation that was sent)';

// Age 78: flu 65+, COVID 75+, PCV20 65+, shingles 70–79, RSV 75+.
function baseData(extra) {
  return Object.assign(
    {
      patientContext: { ageYears: 78, dob: '1948-03-01' },
      problems: [],
      observations: [],
      medications: [],
      observationHistory: [],
      _registerLookup: {},
    },
    extra || {}
  );
}

function statusOf(rule, data) {
  const chips = engine.evaluateVaccineRule(rule, data, NOW);
  return chips.length ? chips[0].status : null;
}

function ruleById(id) {
  return vaxRules.rules.find((r) => r.id === id);
}

function noteEntry(desc, body) {
  return {
    entryType: 'note',
    clinicalCodeDescription: desc,
    note: body,
    recordDate: '2026-09-24',
    recordedBy: 'Primary Care IT Nexus',
  };
}

function journal(entries) {
  return {
    patientJournalRecords: [
      {
        title: 'Thu 24 Sep 2026',
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

console.log('\n--- root cause: COVID given stem is inside the invitation concept; flu stem is not ---');
{
  const covid = ruleById('vax-covid');
  const flu = ruleById('vax-flu');
  const covidStem = covid.statusTerms.given.find((t) => t === 'sars-cov-2 vaccin');
  check(!!covidStem, 'vax-covid given list contains "sars-cov-2 vaccin"');
  check(
    COVID_DESC.toLowerCase().includes(covidStem),
    'that stem is a substring of the SARS-CoV-2 invitation situation concept'
  );
  check(
    flu.statusTerms.given.includes('influenza vaccination'),
    'vax-flu given list contains the bare procedure "influenza vaccination"'
  );
  check(
    FLU_DESC.toLowerCase().includes('influenza vaccination'),
    'that bare stem sits inside the influenza invitation concept, so the invitation filter has to reject it before the stem match'
  );
  // The same prefix bug on the other programmes' invitation concepts.
  const analogues = [
    ['vax-flu', 'Flu vaccination invitation short message service text message sent (situation)'],
    ['vax-flu', 'Seasonal influenza vaccination invitation short message service text message sent (situation)'],
    ['vax-covid', 'COVID-19 vaccination invitation short message service text message sent (situation)'],
    ['vax-covid', 'COVID vaccination offered'],
    ['vax-pneumo-ppv23', 'Pneumococcal vaccination invitation short message service text message sent (situation)'],
    ['vax-pneumo-risk-u65', 'Pneumococcal vaccination invitation short message service text message sent (situation)'],
    ['vax-shingles', 'Shingles vaccination invitation short message service text message sent (situation)'],
    ['vax-shingles-immuno', 'Shingles vaccination invitation short message service text message sent (situation)'],
    ['vax-rsv', 'RSV vaccination invitation short message service text message sent (situation)'],
    [
      'vax-rsv',
      'Respiratory syncytial virus vaccination invitation short message service text message sent (situation)',
    ],
  ];
  analogues.forEach(([id, label]) => {
    const rule = ruleById(id);
    const hits = rule.statusTerms.given.filter((t) => label.toLowerCase().includes(t.toLowerCase()));
    check(hits.length > 0, `${id} given stem "${hits[0]}" is inside "${label}"`);
  });
}

console.log('\n--- parser: Nexus note body is not the observation; immunisation code is ---');
{
  const parsed = JO.parseJournalObservations(
    journal([
      noteEntry(FLU_DESC, FLU_BODY),
      noteEntry(COVID_DESC, COVID_BODY),
      {
        entryType: 'immunisation',
        clinicalCodeDescription: 'COVID-19 vaccination',
        note: COVID_BODY,
        recordDate: '2026-09-20',
      },
      {
        entryType: 'note',
        clinicalCodeDescription: 'Smoker',
        conceptId: '77176002',
        note: 'Still smoking. Vaccination VAC_COVID recorded.',
        recordDate: '2026-09-21',
      },
    ]),
    { now: NOW }
  );
  const flu = parsed.find((o) => o.name === FLU_DESC);
  const covid = parsed.find((o) => o.name === COVID_DESC);
  const dose = parsed.find((o) => o.name === 'COVID-19 vaccination');
  const smoker = parsed.find((o) => o.name === 'Smoker');
  check(!!flu && flu.date === NOTE_DATE && flu.entryKind === 'note', 'flu invitation note is ingested as a coded note');
  check(!!covid && covid.date === NOTE_DATE, 'COVID invitation note is ingested as a coded note');
  check(
    !parsed.some((o) => /VAC_FLU|VAC_COVID|filed automatically/i.test(o.name)),
    'VAC_* and the invitation sentence are not observation names'
  );
  check(flu && !/VAC_FLU|filed automatically/i.test(flu.value || ''), 'flu note body is not stored as the value');
  check(
    covid && !/VAC_COVID|filed automatically/i.test(covid.value || ''),
    'COVID note body is not stored as the value'
  );
  check(
    !!dose && dose.entryKind === 'immunisation' && dose.date === '2026-09-20' && !/VAC_COVID/.test(dose.value || ''),
    'immunisation coded description is kept and the note body is not'
  );
  check(!!smoker && smoker.code === '77176002', 'SMOK002-style coded note is still ingested beside the invitations');
}

console.log('\n--- the reported journal does not turn COVID, flu or RSV green ---');
{
  const parsed = JO.parseJournalObservations(
    journal([noteEntry(FLU_DESC, FLU_BODY), noteEntry(COVID_DESC, COVID_BODY)]),
    { now: NOW }
  );
  const data = baseData({ observations: parsed });
  ['vax-covid', 'vax-flu', 'vax-rsv', 'vax-pneumo-ppv23', 'vax-shingles'].forEach((id) => {
    const status = statusOf(ruleById(id), data);
    check(status === 'vax_due', `${id} stays due on the Nexus invitation notes (got ${status})`);
  });
  // The body alone, if it were ever used as the coded name, is still not a dose.
  const bodyOnly = baseData({
    observations: [
      { name: COVID_BODY, value: '', date: NOTE_DATE, source: 'journal', entryKind: 'note' },
      { name: 'Vaccination VAC_COVID — recorded via Nexus by Nexus', value: '', date: NOTE_DATE },
      { name: 'Vaccination VAC_FLU — recorded via Nexus by Nexus', value: '', date: NOTE_DATE },
      { name: 'Vaccination VAC_RSV — recorded via Nexus by Nexus', value: '', date: NOTE_DATE },
    ],
  });
  ['vax-covid', 'vax-flu', 'vax-rsv'].forEach((id) => {
    const status = statusOf(ruleById(id), bodyOnly);
    check(status === 'vax_due', `${id} stays due when the only text is a VAC_* invitation sentence (got ${status})`);
  });
}

console.log('\n--- invitation, offer, SMS-sent and situation concepts are not a dose on any rule ---');
{
  const labels = [
    FLU_DESC,
    COVID_DESC,
    'Flu vaccination invitation short message service text message sent (situation)',
    'Seasonal influenza vaccination invitation short message service text message sent (situation)',
    'COVID-19 vaccination invitation short message service text message sent (situation)',
    'COVID-19 booster invitation',
    'COVID vaccination offered',
    'SARS-CoV-2 vaccination offered',
    'Pneumococcal vaccination invitation short message service text message sent (situation)',
    'PCV20 invitation sent',
    'Shingles vaccination invitation short message service text message sent (situation)',
    'Herpes zoster vaccination invitation',
    'Shingrix offered',
    'RSV vaccination invitation short message service text message sent (situation)',
    'Respiratory syncytial virus vaccination invitation short message service text message sent (situation)',
    'Abrysvo invitation sent',
  ];
  const ELIGIBILITY = {
    'vax-pneumo-risk-u65': {
      patientContext: { ageYears: 45, dob: '1981-05-01' },
      problems: [{ label: 'Splenectomy', status: 'active', codedDate: '2020-01-01' }],
    },
    'vax-shingles-immuno': {
      patientContext: { ageYears: 45, dob: '1981-05-01' },
      problems: [{ label: 'Non-Hodgkin lymphoma', status: 'active', codedDate: '2020-01-01' }],
    },
  };
  vaxRules.rules.forEach((rule) => {
    labels.forEach((label) => {
      const fx = ELIGIBILITY[rule.id] || {};
      const data = baseData({
        patientContext: fx.patientContext || baseData().patientContext,
        problems: (fx.problems || []).concat([{ label: label, codedDate: NOTE_DATE, status: 'active' }]),
      });
      const status = statusOf(rule, data);
      check(status !== 'vax_given', `${rule.id}: "${label}" is not vax_given (got ${status})`);
    });
  });
}

console.log('\n--- declined and contraindicated stay declined, not given ---');
{
  const cases = [
    ['vax-covid', 'COVID-19 vaccination declined'],
    ['vax-covid', 'COVID-19 vaccination contraindicated'],
    ['vax-covid', 'SARS-CoV-2 vaccination declined'],
    ['vax-flu', 'Influenza vaccination declined'],
    ['vax-flu', 'Influenza vaccination contraindicated'],
    ['vax-pneumo-ppv23', 'Pneumococcal vaccination declined'],
    ['vax-shingles', 'Shingles vaccination declined'],
    ['vax-rsv', 'RSV vaccination declined'],
    ['vax-rsv', 'mresvia contraindicated'],
  ];
  cases.forEach(([id, label]) => {
    const status = statusOf(ruleById(id), baseData({ problems: [{ label: label, codedDate: NOTE_DATE }] }));
    check(status === 'vax_declined', `${id}: "${label}" → vax_declined (got ${status})`);
    check(status !== 'vax_given', `${id}: "${label}" is not given`);
  });
}

console.log('\n--- a real dose still counts, including beside the invitation note ---');
{
  const parsed = JO.parseJournalObservations(
    journal([
      noteEntry(FLU_DESC, FLU_BODY),
      noteEntry(COVID_DESC, COVID_BODY),
      {
        entryType: 'immunisation',
        clinicalCodeDescription: 'Administration of SARS-CoV-2 vaccine',
        note: COVID_BODY,
        recordDate: '2026-09-20',
      },
      {
        entryType: 'immunisation',
        clinicalCodeDescription: 'Seasonal influenza vaccination',
        note: FLU_BODY,
        recordDate: '2026-09-20',
      },
    ]),
    { now: NOW }
  );
  const data = baseData({ observations: parsed });
  check(statusOf(ruleById('vax-covid'), data) === 'vax_given', 'COVID immunisation administration concept → vax_given');
  check(
    statusOf(ruleById('vax-flu'), data) === 'vax_given',
    'flu immunisation "Seasonal influenza vaccination" → vax_given'
  );
  check(
    statusOf(ruleById('vax-rsv'), data) === 'vax_due',
    'RSV stays due: the flu invitation body mentions RSV, and no RSV dose is recorded'
  );

  const doses = [
    ['vax-covid', 'COVID-19 vaccination'],
    ['vax-flu', 'Seasonal influenza vaccination'],
    ['vax-pneumo-ppv23', 'Pneumococcal vaccination'],
    ['vax-shingles', 'Shingrix'],
    ['vax-rsv', 'RSV vaccination'],
  ];
  doses.forEach(([id, label]) => {
    const status = statusOf(ruleById(id), baseData({ problems: [{ label: label, codedDate: '2026-09-20' }] }));
    check(status === 'vax_given', `${id}: administration "${label}" → vax_given (got ${status})`);
  });

  // "consent" contains the letters sent. It is not the word "sent".
  const consent = statusOf(
    ruleById('vax-covid'),
    baseData({ problems: [{ label: 'COVID-19 vaccination consent', codedDate: '2026-09-20' }] })
  );
  check(consent === 'vax_given', `COVID-19 vaccination consent still matches the administration stem (got ${consent})`);
}

console.log('\n--- coded smoking note still clears SMOK002 beside the invitation notes ---');
{
  const astReg = qof.rules.find((r) => r.type === 'qof-register' && r.registerCode === 'ASTHMA');
  const smok = qof.rules.find((r) => r.id === 'qof-smok002-asthma');
  const parsed = JO.parseJournalObservations(
    journal([
      noteEntry(FLU_DESC, FLU_BODY),
      noteEntry(COVID_DESC, COVID_BODY),
      {
        entryType: 'note',
        clinicalCodeDescription: 'Smoker',
        conceptId: '77176002',
        recordDate: '2026-09-21',
      },
    ]),
    { now: '2026-09-29T12:00:00Z' }
  );
  const chips = engine.evaluateQofIndicatorRule(
    smok,
    {
      medications: [],
      observations: parsed,
      problems: [{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }],
      patientContext: {},
      _registerLookup: { ASTHMA: astReg },
    },
    '2026-09-29T12:00:00Z'
  );
  check(
    chips[0] && chips[0].status === 'achieved',
    `SMOK002 still achieved from the coded Smoker note (got ${chips[0] && chips[0].status})`
  );
  check(
    statusOf(ruleById('vax-covid'), baseData({ observations: parsed })) === 'vax_due',
    'the same parsed notes do not give COVID'
  );
}

console.log('\n--- VI001–VI004 cannot be achieved by an invitation note ---');
{
  const vi = qof.rules.filter((r) => /^VI00[1-4]$/.test(r.indicatorCode || ''));
  check(vi.length === 4, `four VI rules present (got ${vi.length})`);
  vi.forEach((rule) => {
    check(rule.enabled === false, `${rule.indicatorCode} stays disabled`);
    const obsList = (rule.check && rule.check.observation) || [];
    check(Array.isArray(obsList) && obsList.length === 0, `${rule.indicatorCode} observation list is empty`);
    const patient = {
      medications: [],
      observations: [
        { name: COVID_DESC, value: '', date: NOTE_DATE, source: 'journal', entryKind: 'note' },
        { name: FLU_DESC, value: '', date: NOTE_DATE, source: 'journal', entryKind: 'note' },
        {
          name: 'Shingles vaccination invitation short message service text message sent (situation)',
          date: NOTE_DATE,
        },
        { name: COVID_BODY, date: NOTE_DATE },
      ],
      problems: [],
      patientContext: { ageYears: 1, dob: '2025-09-01' },
    };
    const live = engine.evaluatePatient([], patient.observations, [rule], {
      now: NOW,
      problems: patient.problems,
      patientContext: patient.patientContext,
    });
    check(
      !live.some((c) => c.indicatorCode === rule.indicatorCode),
      `${rule.indicatorCode} disabled rule emits no chip`
    );
    // If a stem is added later, the invitation still must not achieve.
    const armed = Object.assign({}, rule, {
      enabled: true,
      check: Object.assign({}, rule.check, {
        observation: [
          'shingles vaccination',
          'sars-cov-2 vaccin',
          'influenza vaccination',
          'rsv vaccination',
          'pneumococcal vaccination',
        ],
      }),
    });
    const armedChips = engine.evaluateQofIndicatorRule(armed, patient, NOW);
    check(
      !armedChips[0] || armedChips[0].status !== 'achieved',
      `${rule.indicatorCode} invitation notes do not achieve even with vaccine stems added (got ${armedChips[0] && armedChips[0].status})`
    );
    const given = engine.evaluateQofIndicatorRule(
      armed,
      {
        medications: [],
        observations: [{ name: 'Shingles vaccination', value: '', date: '2026-09-20' }],
        problems: [],
        patientContext: { ageYears: 80 },
      },
      NOW
    );
    check(
      given[0] && given[0].status === 'achieved',
      `${rule.indicatorCode} a real "Shingles vaccination" observation still achieves the armed numerator (got ${given[0] && given[0].status})`
    );
  });
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
