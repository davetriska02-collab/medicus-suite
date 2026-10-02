// Medicus Suite — vaccine doses by concept id and normalised wording (H-095)
// Run with: node test-vaccine-given-codes.js
//
// A dose already on the record was staying due when:
//   - the only evidence was the stored SNOMED concept id
//   - the preferred term carried a (situation) tag or another parenthetical
//   - the term was a bare procedure name or a brand
//   - an RSV, pneumococcal or shingles dose was a coded note older than 400 days
//
// Invitations stay due. Declined stays declined. Season windows are unchanged.
// COVID eligibility cohorts are unchanged. Texts and codes only.

'use strict';

const fs = require('fs');
const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const JO = require(path.join(__dirname, 'shared', 'journal-observations.js'));
const VG = require(path.join(__dirname, 'shared', 'vaccine-given.js'));
const vaxRules = require(path.join(__dirname, 'rules', 'vaccine-rules.json'));

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

const NOW = '2026-10-04';
const IN = '2026-10-01';
const SEASON_START = '2026-09-01';
const LAST_SEASON = '2025-10-15';
const BEFORE_SEASON = '2026-08-31';
const SEASON_END_EDGE = '2026-03-31';

function ruleById(id) {
  return vaxRules.rules.find((r) => r.id === id);
}

function statusOf(id, data) {
  const chips = engine.evaluateVaccineRule(ruleById(id), data, NOW);
  if (!chips.length) return null;
  return chips[0].status;
}

function patient(ageYears, extra) {
  return Object.assign(
    {
      patientContext: { ageYears: ageYears, dob: '1946-01-01' },
      problems: [],
      observations: [],
      medications: [],
      observationHistory: [],
      _registerLookup: {},
    },
    extra || {}
  );
}

function withObs(ageYears, name, date, extra, problems) {
  const row = Object.assign({ name: name, date: date, entryKind: 'observation' }, extra || {});
  return patient(ageYears, { observations: [row], problems: problems || [] });
}

function expectStatus(id, age, name, date, want, extra, problems) {
  const got = statusOf(id, withObs(age, name, date, extra, problems));
  check(got === want, `${id}: "${name}" ${date || '(no date)'} → ${want} (got ${got})`);
}

console.log('\n--- curated codes stay on the right rule ---');
{
  const flu = VG.codesForRule('vax-flu');
  [
    '1037311000000106',
    '1037331000000103',
    '1037351000000105',
    '1037371000000101',
    '1066171000000108',
    '1066181000000105',
    '1066191000000107',
    '1239861000000100',
    '884861000000100',
    '884881000000109',
    '945831000000105',
    '955651000000100',
    '955661000000102',
    '955671000000109',
    '955681000000106',
    '955691000000108',
    '955701000000108',
    '985151000000100',
    '985171000000109',
  ].forEach((id) => check(flu.includes(id), `FLU_COD ${id} is a flu given code`));
  check(!flu.includes('185903001'), '185903001 needs-influenza flag is not a flu given code');
  check(!flu.includes('90640007'), '90640007 is not a flu given code');

  const covid = VG.codesForRule('vax-covid');
  ['1324681000000101', '1324691000000104', '840534001', '1324671000000103', '1324851000000106'].forEach((id) =>
    check(covid.includes(id), `COVID given code ${id}`)
  );
  check(!covid.includes('90640007'), '90640007 is not a COVID given code');

  const rsv = VG.codesForRule('vax-rsv');
  check(rsv.includes('1303503001') && rsv.includes('1853491000000104'), 'RSVADMIN_COD both orthopneumovirus codes');

  const over65 = VG.codesForRule('vax-pneumo-ppv23');
  const under65 = VG.codesForRule('vax-pneumo-risk-u65');
  [
    '1119367000',
    '1344704001',
    '170337005',
    '310578008',
    '571631000119106',
    '871833000',
    '12866006',
    '1296904008',
  ].forEach((id) => check(over65.includes(id), `PNEUVAC1 ${id} counts for age 65+`));
  check(!under65.includes('1296904008'), 'PCV13 1296904008 does not satisfy the under-65 rule');
  check(!under65.includes('12866006'), 'generic 12866006 does not satisfy the under-65 rule');
  check(
    under65.includes('571631000119106') && under65.includes('1119367000'),
    'PPV23 product codes do satisfy under-65'
  );

  const routine = VG.codesForRule('vax-shingles');
  const immuno = VG.codesForRule('vax-shingles-immuno');
  ['1326101000000105', '1326111000000107', '859641000000109', '868511000000106'].forEach((id) => {
    check(routine.includes(id) && immuno.includes(id), `shingles code ${id} is on both rules`);
  });
  ['871898007', '871899004', '722215002'].forEach((id) => {
    check(routine.includes(id), `routine shingles includes ${id}`);
    check(!immuno.includes(id), `immunosuppressed shingles does not include ${id}`);
  });
  check(
    !routine.includes('1730561000000103') && !immuno.includes('1730561000000103'),
    'requires-shingles is not a dose code'
  );

  const fluRule = ruleById('vax-flu');
  const covidRule = ruleById('vax-covid');
  check(
    fluRule.season.startMonth === 9 &&
      fluRule.season.startDay === 1 &&
      fluRule.season.endMonth === 3 &&
      fluRule.season.endDay === 31,
    'flu season window is unchanged (1 Sep–31 Mar)'
  );
  check(
    covidRule.season.startMonth === 9 &&
      covidRule.season.startDay === 1 &&
      covidRule.season.endMonth === 3 &&
      covidRule.season.endDay === 31,
    'COVID season window is unchanged (1 Sep–31 Mar)'
  );
  const covidKinds = (covidRule.eligibility.anyOf || []).map((c) => c.kind + ':' + (c.label || ''));
  check(
    covidKinds.length === 4 && covidKinds.every((k) => /age|care home|immunosuppressed/i.test(k)),
    `COVID eligibility clauses unchanged (${covidKinds.join(' | ')})`
  );
}

console.log('\n--- flu: wording, situation tag, brands, concept id, season ---');
{
  const GIVEN = [
    'Seasonal influenza vaccination',
    'Administration of first inactivated seasonal influenza vaccination',
    'Administration of second inactivated seasonal influenza vaccination',
    'Administration of first intranasal seasonal influenza vaccination',
    'Seasonal influenza vaccination given by pharmacist',
    'Seasonal influenza vaccination given by other healthcare provider',
    'Influenza vaccination given',
    'Seasonal influenza vaccination given by pharmacist (situation)',
    'Seasonal influenza vaccination given by other healthcare provider (situation)',
    'Seasonal influenza vaccination given by midwife (situation)',
    'Seasonal influenza vaccination given in school (situation)',
    'Seasonal influenza vaccination given while hospital inpatient (situation)',
    'Influenza vaccination',
    'Administration of influenza vaccine',
    'Administration of live attenuated influenza vaccine',
    'Fluenz',
    'Fluenz Tetra',
    'Fluenz Tetra vaccine nasal suspension',
    'Influvac Tetra',
    'Adjuvanted influenza vaccine',
  ];
  GIVEN.forEach((name) => expectStatus('vax-flu', 70, name, IN, 'vax_given'));
  expectStatus('vax-flu', 70, 'Immunisation', IN, 'vax_given', { code: '955691000000108' });
  expectStatus('vax-flu', 70, 'Immunisation', IN, 'vax_given', { code: '985151000000100' });
  expectStatus('vax-flu', 70, 'Immunisation', IN, 'vax_given', { code: '1239861000000100' });

  expectStatus(
    'vax-flu',
    70,
    'Influenza vaccination invitation short message service text message sent (situation)',
    IN,
    'vax_due'
  );
  expectStatus(
    'vax-flu',
    70,
    'Seasonal influenza vaccination invitation short message service text message sent (situation)',
    IN,
    'vax_due'
  );
  expectStatus('vax-flu', 70, 'Influenza vaccination declined', IN, 'vax_declined');
  expectStatus('vax-flu', 70, 'Seasonal influenza vaccination', LAST_SEASON, 'vax_due');
  expectStatus('vax-flu', 70, 'Seasonal influenza vaccination', BEFORE_SEASON, 'vax_due');
  expectStatus('vax-flu', 70, 'Seasonal influenza vaccination', SEASON_END_EDGE, 'vax_due');
  expectStatus('vax-flu', 70, 'Seasonal influenza vaccination', SEASON_START, 'vax_given');
  expectStatus('vax-flu', 70, 'Seasonal influenza vaccination', NOW, 'vax_given');
  expectStatus('vax-flu', 70, 'Seasonal influenza vaccination', '', 'vax_due');
  expectStatus('vax-flu', 50, 'Needs influenza immunization (situation)', IN, 'vax_due', { code: '185903001' });
  expectStatus('vax-flu', 70, 'Needs influenza immunization (situation)', IN, 'vax_due', { code: '185903001' });
}

console.log('\n--- COVID: wording, brands, concept id, season; cohorts unchanged ---');
{
  const GIVEN = [
    'COVID-19 vaccination',
    'Administration of SARS-CoV-2 vaccine',
    'COVID-19 vaccination given by pharmacist',
    'COVID-19 vaccination given by other healthcare provider',
    'COVID-19 vaccination given by pharmacist (situation)',
    'COVID-19 vaccination given by other healthcare provider (situation)',
    'Administration of first dose of SARS-CoV-2 (severe acute respiratory syndrome coronavirus 2) vaccine',
    'Administration of first dose of severe acute respiratory syndrome coronavirus 2 vaccine',
    'Administration of second dose of severe acute respiratory syndrome coronavirus 2 vaccine',
    'Administration of vaccine product containing only Severe acute respiratory syndrome coronavirus 2 antigen',
    'Immunisation course to achieve immunity against severe acute respiratory syndrome coronavirus 2',
    'Severe acute respiratory syndrome coronavirus 2 immunisation course started',
    'Comirnaty',
    'Comirnaty JN.1',
    'Comirnaty (JN.1)',
    'Spikevax',
    'Nuvaxovid',
  ];
  GIVEN.forEach((name) => expectStatus('vax-covid', 80, name, IN, 'vax_given'));
  expectStatus('vax-covid', 80, 'Immunisation', IN, 'vax_given', { code: '1324681000000101' });
  expectStatus('vax-covid', 80, 'Immunisation', IN, 'vax_given', { code: '1324691000000104' });
  expectStatus('vax-covid', 80, 'Immunisation', IN, 'vax_given', { code: '840534001' });
  expectStatus('vax-covid', 80, 'Immunisation', IN, 'vax_given', { code: '1324671000000103' });
  expectStatus('vax-covid', 80, 'Immunisation', IN, 'vax_given', { code: '1324851000000106' });
  expectStatus('vax-covid', 80, 'Immunisation', IN, 'vax_due', { code: '90640007' });

  expectStatus(
    'vax-covid',
    80,
    'SARS-CoV-2 vaccination invitation short message service text message sent (situation)',
    IN,
    'vax_due'
  );
  expectStatus('vax-covid', 80, 'COVID-19 vaccination declined', IN, 'vax_declined');
  expectStatus('vax-covid', 80, 'Comirnaty declined', IN, 'vax_declined');
  expectStatus('vax-covid', 80, 'COVID-19 vaccination', LAST_SEASON, 'vax_due');
  expectStatus('vax-covid', 80, 'COVID-19 vaccination', '2025-11-01', 'vax_due');
  expectStatus('vax-covid', 80, 'COVID-19 vaccination', BEFORE_SEASON, 'vax_due');
  expectStatus('vax-covid', 80, 'COVID-19 vaccination', SEASON_START, 'vax_given');
  expectStatus('vax-covid', 80, 'COVID-19 vaccination', NOW, 'vax_given');

  const diabetic = statusOf(
    'vax-covid',
    patient(70, { problems: [{ label: 'Type 2 diabetes mellitus', status: 'active', codedDate: '2020-01-01' }] })
  );
  check(diabetic === null, `age 70 with diabetes has no COVID chip (got ${diabetic})`);
}

console.log('\n--- RSV: orthopneumovirus, situation tag, lifetime, declined, eligibility ---');
{
  const GIVEN = [
    'Administration of RSV (respiratory syncytial virus) vaccine',
    'Abrysvo',
    'Arexvy',
    'mRESVIA',
    'Respiratory syncytial virus vaccination',
    'RSV vaccination',
    'RSV vaccination given by pharmacist',
    'Respiratory syncytial virus vaccination given by other healthcare provider',
    'Administration of Abrysvo vaccine',
    'Administration of vaccine product containing only Human orthopneumovirus antigen',
    'RSV vaccination given by pharmacist (situation)',
    'Respiratory syncytial virus vaccination given by other healthcare provider (situation)',
  ];
  GIVEN.forEach((name) => expectStatus('vax-rsv', 80, name, '2024-09-25', 'vax_given'));
  expectStatus('vax-rsv', 80, 'Abrysvo', '', 'vax_given');
  expectStatus('vax-rsv', 80, 'Immunisation', '2024-09-25', 'vax_given', { code: '1303503001' });
  expectStatus('vax-rsv', 80, 'Immunisation', '2024-09-25', 'vax_given', { code: '1853491000000104' });
  expectStatus(
    'vax-rsv',
    80,
    'RSV vaccination invitation short message service text message sent (situation)',
    IN,
    'vax_due'
  );
  expectStatus('vax-rsv', 80, 'RSV vaccine declined', '2024-09-25', 'vax_declined');

  check(statusOf('vax-rsv', patient(70)) === null, 'age 70 with no respiratory disease has no RSV chip');
  const copdDue = statusOf(
    'vax-rsv',
    patient(70, { problems: [{ label: 'COPD', status: 'active', codedDate: '2018-01-01' }] })
  );
  check(copdDue === 'vax_due', `age 70 with COPD and no dose → vax_due (got ${copdDue})`);
  const copdGiven = statusOf(
    'vax-rsv',
    patient(70, {
      problems: [{ label: 'COPD', status: 'active', codedDate: '2018-01-01' }],
      observations: [{ name: 'Abrysvo', date: '2024-09-25', entryKind: 'immunisation' }],
    })
  );
  check(copdGiven === 'vax_given', `age 70 with COPD and Abrysvo → vax_given (got ${copdGiven})`);
  check(statusOf('vax-rsv', patient(80)) === 'vax_due', 'age 80 with no dose → vax_due');
}

console.log('\n--- pneumococcal: 23 valent, brands, PCV13 only at 65+ ---');
{
  expectStatus('vax-pneumo-ppv23', 70, 'Pneumococcal vaccination given', '2002-01-31', 'vax_given');
  expectStatus(
    'vax-pneumo-ppv23',
    70,
    'Administration of pneumococcal polysaccharide 23 valent vaccine',
    '2002-01-31',
    'vax_given'
  );
  expectStatus(
    'vax-pneumo-ppv23',
    70,
    'Pneumococcal vaccination given by other healthcare provider (situation)',
    '2002-01-31',
    'vax_given'
  );
  expectStatus('vax-pneumo-ppv23', 70, 'Prevenar 20', '2024-01-01', 'vax_given');
  expectStatus('vax-pneumo-ppv23', 70, 'Apexxnar', '2024-01-01', 'vax_given');
  expectStatus('vax-pneumo-ppv23', 70, 'Pneumovax', '2002-01-31', 'vax_given');
  expectStatus('vax-pneumo-ppv23', 70, 'Prevenar 13', '2010-01-01', 'vax_given');
  expectStatus('vax-pneumo-ppv23', 70, 'Vaxneuvance', '2024-01-01', 'vax_given');
  const PCV13 =
    'Administration of vaccine product containing only Streptococcus pneumoniae Danish serotype 1, 3, 4, 5, 6A, 6B, 7F, 9V, 14, 18C, 19A, 19F, and 23F capsular polysaccharide antigens conjugated';
  const PPV23_PRODUCT =
    'Administration of vaccine product containing only Streptococcus pneumoniae Danish serotype 1, 2, 3, 4, 5, 6B, 7F, 8, 9N, 9V, 10A, 11A, 12F, 14, 15B, 17F, 18C, 19A, 19F, 20, 22F, 23F, and 33F capsular polysaccharide antigens';
  const GENERIC = 'Administration of vaccine product containing only Streptococcus pneumoniae antigen';
  const PCV20 =
    'Administration of vaccine product containing only Streptococcus pneumoniae Danish serotype 1, 3, 4, 5, 6A, 6B, 7F, 8, 9V, 10A, 11A, 12F, 14, 15B, 18C, 19A, 19F, 22F, 23F, 33F capsular polysaccharide antigens';
  expectStatus('vax-pneumo-ppv23', 70, PCV13, '2010-01-01', 'vax_given', { code: '1296904008' });
  expectStatus('vax-pneumo-ppv23', 70, GENERIC, '2010-01-01', 'vax_given', { code: '12866006' });
  expectStatus('vax-pneumo-ppv23', 70, PPV23_PRODUCT, '2002-01-31', 'vax_given', { code: '1119367000' });
  expectStatus('vax-pneumo-ppv23', 70, 'Immunisation', '2002-01-31', 'vax_given', { code: '571631000119106' });
  expectStatus('vax-pneumo-ppv23', 70, PCV20, '2024-01-01', 'vax_given', { code: '1344704001' });
  expectStatus('vax-pneumo-ppv23', 70, 'Subcutaneous injection of pneumococcal vaccine', '2002-01-31', 'vax_given', {
    code: '871833000',
  });

  const spleen = [{ label: 'Splenectomy', status: 'active', codedDate: '2015-01-01' }];
  expectStatus('vax-pneumo-risk-u65', 45, 'Prevenar 13', '2010-01-01', 'vax_due', null, spleen);
  expectStatus('vax-pneumo-risk-u65', 45, 'Vaxneuvance', '2024-01-01', 'vax_due', null, spleen);
  expectStatus('vax-pneumo-risk-u65', 45, PCV13, '2010-01-01', 'vax_due', { code: '1296904008' }, spleen);
  expectStatus('vax-pneumo-risk-u65', 45, GENERIC, '2010-01-01', 'vax_due', { code: '12866006' }, spleen);
  expectStatus('vax-pneumo-risk-u65', 45, PPV23_PRODUCT, '2010-01-01', 'vax_given', { code: '1119367000' }, spleen);
  expectStatus(
    'vax-pneumo-risk-u65',
    45,
    'Administration of pneumococcal polysaccharide 23 valent vaccine',
    '2010-01-01',
    'vax_given',
    null,
    spleen
  );
  expectStatus('vax-pneumo-ppv23', 70, 'Pneumococcal vaccination declined', '2002-01-31', 'vax_declined');
}

console.log('\n--- shingles: recombinant stem, situation tag, Zostavax not on the immuno rule ---');
{
  const GIVEN = [
    'Herpes zoster vaccination',
    'Administration of herpes zoster vaccine',
    'Shingrix',
    'Zostavax',
    'Zoster vaccine recombinant',
    'Zoster vaccine live',
    'Herpes zoster vaccination given by other healthcare provider (situation)',
    'Shingles vaccination given by pharmacist (situation)',
    'Administration of first dose of vaccine product containing only Human alphaherpesvirus 3 antigen for shingles',
    'Administration of vaccine product containing only live attenuated Human alphaherpesvirus 3 antigen',
  ];
  GIVEN.forEach((name) => expectStatus('vax-shingles', 75, name, '2017-02-23', 'vax_given'));
  expectStatus('vax-shingles', 75, 'Immunisation', '2024-11-01', 'vax_given', { code: '1326101000000105' });
  expectStatus('vax-shingles', 75, 'Immunisation', '2018-06-01', 'vax_given', { code: '871898007' });
  expectStatus('vax-shingles', 75, 'Requires vaccination against herpes zoster', IN, 'vax_due', {
    code: '1730561000000103',
  });
  expectStatus(
    'vax-shingles',
    75,
    'Shingles vaccination invitation short message service text message sent (situation)',
    IN,
    'vax_due'
  );
  expectStatus('vax-shingles', 75, 'Shingles vaccination declined', '2017-02-23', 'vax_declined');

  const lymphoma = [{ label: 'Non-Hodgkin lymphoma', status: 'active', codedDate: '2020-01-01' }];
  expectStatus('vax-shingles-immuno', 45, 'Zostavax', '2018-06-01', 'vax_due', null, lymphoma);
  expectStatus('vax-shingles-immuno', 45, 'Zoster vaccine live', '2018-06-01', 'vax_due', null, lymphoma);
  expectStatus(
    'vax-shingles-immuno',
    45,
    'Administration of vaccine product containing only live attenuated Human alphaherpesvirus 3 antigen',
    '2018-06-01',
    'vax_due',
    { code: '871898007' },
    lymphoma
  );
  expectStatus('vax-shingles-immuno', 45, 'Shingrix', '2025-11-01', 'vax_given', null, lymphoma);
  expectStatus('vax-shingles-immuno', 45, 'Zoster vaccine recombinant', '2025-11-01', 'vax_given', null, lymphoma);
  expectStatus(
    'vax-shingles-immuno',
    45,
    'Administration of first dose of vaccine product containing only Human alphaherpesvirus 3 antigen for shingles',
    '2025-11-01',
    'vax_given',
    { code: '1326101000000105' },
    lymphoma
  );
  expectStatus(
    'vax-shingles-immuno',
    45,
    'Administration of vaccine product containing only Human alphaherpesvirus 3 antigen for shingles',
    '2018-06-01',
    'vax_due',
    { code: '722215002' },
    lymphoma
  );
}

console.log('\n--- coded notes: one-off lifetime, flu still windowed, procedure still dropped ---');
{
  function day(title, items) {
    return { title: title, items: items };
  }
  function note(desc, recordDate, code) {
    return {
      type: 'note',
      data: {
        entryType: 'note',
        clinicalCodeDescription: desc,
        recordDate: recordDate,
        conceptId: code || undefined,
      },
    };
  }
  const payload = {
    patientJournalRecords: [
      day('Wed 01 Oct 2026', [
        note('Seasonal influenza vaccination', '2026-10-01'),
        note('Seasonal influenza vaccination given by pharmacist (situation)', '2026-10-01', '955691000000108'),
        note('COVID-19 vaccination', '2026-10-01'),
        note('Comirnaty', '2026-10-01'),
        note(
          'Administration of first dose of severe acute respiratory syndrome coronavirus 2 vaccine',
          '2026-10-01',
          '1324681000000101'
        ),
        note('Smoker', '2026-09-21', '77176002'),
      ]),
      day('Wed 15 Oct 2025', [
        note('Seasonal influenza vaccination', '2025-10-15'),
        {
          type: 'immunisation',
          data: {
            entryType: 'immunisation',
            clinicalCodeDescription: 'Seasonal influenza vaccination',
            recordDate: '2025-10-15',
          },
        },
      ]),
      day('Wed 25 Sep 2024', [
        note('Administration of RSV (respiratory syncytial virus) vaccine', '2024-09-25'),
        note('Abrysvo', '2024-09-25'),
        note(
          'Administration of vaccine product containing only Human orthopneumovirus antigen',
          '2024-09-25',
          '1303503001'
        ),
        {
          type: 'immunisation',
          data: {
            entryType: 'immunisation',
            clinicalCodeDescription: 'Administration of vaccine product containing only Human orthopneumovirus antigen',
            recordDate: '2024-09-25',
            conceptId: '1303503001',
          },
        },
        note('RSV vaccine declined', '2024-09-25'),
        note('RSV vaccination invitation short message service text message sent (situation)', '2024-09-25'),
      ]),
      day('Fri 05 Oct 2018', [note('Seasonal influenza vaccination', '2018-10-05')]),
      day('Tue 01 Jan 2019', [note('Smoker', '2019-01-01', '77176002')]),
      day('Thu 31 Jan 2002', [
        note('Pneumococcal vaccination given', '2002-01-31', '170337005'),
        note('Administration of pneumococcal polysaccharide 23 valent vaccine', '2002-01-31', '571631000119106'),
      ]),
      day('Thu 23 Feb 2017', [note('Herpes zoster vaccination', '2017-02-23')]),
      day('Wed 01 Oct 2026', [
        {
          type: 'encounter',
          data: {
            consultationTopics: [
              {
                headings: [
                  {
                    entries: [
                      {
                        entryType: 'procedure',
                        type: 'Procedure',
                        clinicalCodeDescription: 'Seasonal influenza vaccination',
                        recordDate: '2026-10-01',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ]),
    ],
  };
  const parsed = JO.parseJournalObservations(payload, { now: NOW, windowDays: 400 });
  const has = (name, date) => parsed.some((o) => o.name === name && o.date === date);

  check(has('Seasonal influenza vaccination', '2026-10-01'), 'this-season flu note is ingested');
  check(
    has('Seasonal influenza vaccination given by pharmacist (situation)', '2026-10-01'),
    'pharmacist situation note is ingested with the tag still on the name'
  );
  check(
    parsed.some(
      (o) => o.name === 'Seasonal influenza vaccination given by pharmacist (situation)' && o.code === '955691000000108'
    ),
    'pharmacist situation note keeps the concept id'
  );
  check(has('COVID-19 vaccination', '2026-10-01'), 'this-season COVID note is ingested');
  check(has('Comirnaty', '2026-10-01'), 'Comirnaty note is ingested');
  check(has('Seasonal influenza vaccination', '2025-10-15'), 'last-season flu note inside 400 days is ingested');
  check(!has('Seasonal influenza vaccination', '2018-10-05'), '2018 flu note is still outside the 400-day window');
  check(!has('Smoker', '2019-01-01'), '2019 Smoker note is still outside the 400-day window');
  check(has('Smoker', '2026-09-21'), 'recent Smoker note is still ingested');
  check(
    has('Administration of RSV (respiratory syncytial virus) vaccine', '2024-09-25'),
    '2024 RSV administration note is kept'
  );
  check(has('Abrysvo', '2024-09-25'), '2024 Abrysvo note is kept');
  check(
    has('Administration of vaccine product containing only Human orthopneumovirus antigen', '2024-09-25'),
    '2024 orthopneumovirus note is kept'
  );
  check(has('RSV vaccine declined', '2024-09-25'), '2024 RSV declined note is kept');
  check(
    !has('RSV vaccination invitation short message service text message sent (situation)', '2024-09-25'),
    '2024 RSV invitation note is still outside the 400-day window'
  );
  check(has('Pneumococcal vaccination given', '2002-01-31'), '2002 pneumococcal note is kept');
  check(
    has('Administration of pneumococcal polysaccharide 23 valent vaccine', '2002-01-31'),
    '2002 PPV23 note is kept'
  );
  check(has('Herpes zoster vaccination', '2017-02-23'), '2017 shingles note is kept');
  check(
    !parsed.some((o) => o.entryKind === 'procedure' || o.name === 'Procedure'),
    'a procedure entry is still not ingested'
  );

  const fluNow = statusOf(
    'vax-flu',
    patient(70, { observations: parsed.filter((o) => o.date === '2026-10-01' && /influenza|pharmacist/i.test(o.name)) })
  );
  check(fluNow === 'vax_given', `this-season flu notes count as given (got ${fluNow})`);
  const fluLast = statusOf(
    'vax-flu',
    patient(70, {
      observations: parsed.filter((o) => o.name === 'Seasonal influenza vaccination' && o.date === '2025-10-15'),
    })
  );
  check(fluLast === 'vax_due', `last-season flu note and immunisation stay due for 2026/27 (got ${fluLast})`);
  const rsv = statusOf(
    'vax-rsv',
    patient(80, {
      observations: parsed.filter((o) => o.name === 'Administration of RSV (respiratory syncytial virus) vaccine'),
    })
  );
  check(rsv === 'vax_given', `2024 RSV coded note counts as given (got ${rsv})`);
  const rsvCode = statusOf(
    'vax-rsv',
    patient(80, {
      observations: parsed.filter((o) => o.code === '1303503001'),
    })
  );
  check(rsvCode === 'vax_given', `2024 orthopneumovirus note and immunisation count as given (got ${rsvCode})`);
  const declined = statusOf(
    'vax-rsv',
    patient(80, { observations: parsed.filter((o) => o.name === 'RSV vaccine declined') })
  );
  check(declined === 'vax_declined', `2024 RSV declined note stays declined (got ${declined})`);
  const pneumo = statusOf(
    'vax-pneumo-ppv23',
    patient(70, { observations: parsed.filter((o) => /pneumococcal|23 valent/i.test(o.name)) })
  );
  check(pneumo === 'vax_given', `2002 pneumococcal notes count as given (got ${pneumo})`);
  const shingles = statusOf(
    'vax-shingles',
    patient(75, { observations: parsed.filter((o) => o.name === 'Herpes zoster vaccination') })
  );
  check(shingles === 'vax_given', `2017 shingles note counts as given (got ${shingles})`);
}

console.log('\n--- load order: helper before the engine and the journal parser ---');
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts.flatMap((cs) => cs.js || []);
  const vg = scripts.indexOf('shared/vaccine-given.js');
  const engineIdx = scripts.indexOf('engine/rules-engine.js');
  const jo = scripts.indexOf('shared/journal-observations.js');
  check(vg !== -1 && engineIdx !== -1 && vg < engineIdx, 'manifest loads vaccine-given.js before rules-engine.js');
  check(vg !== -1 && jo !== -1 && vg < jo, 'manifest loads vaccine-given.js before journal-observations.js');
  ['side-panel/panel.html', 'pop-out/pop-out.html', 'sentinel-options/options.html'].forEach((file) => {
    const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const a = html.indexOf('vaccine-given.js');
    const b = html.indexOf('rules-engine.js');
    check(a !== -1 && b !== -1 && a < b, `${file} loads vaccine-given.js before rules-engine.js`);
  });
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
