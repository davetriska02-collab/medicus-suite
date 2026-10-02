// Medicus Suite — procedure doses, latest given, structured not-given (H-096)
// Run with: node test-vaccine-procedure-status.js
//
// A dose already on the record was still due, or a decline hid a later dose:
//   - the administration was a procedure entry, which the journal parser skipped
//   - the first matching problem won, so an earlier decline hid a later given
//   - the name was an administration term and a structured not-given status
//     was ignored
//
// Rule across rows: a given dose inside the season or one-off window is the
// status, including when a decline is dated later. A later given overrides an
// earlier decline. A decline is the status only when no given dose is inside
// that window. COVID eligibility is unchanged.

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const JO = require(path.join(__dirname, 'shared', 'journal-observations.js'));
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

function day(title, items) {
  return { title: title, items: items };
}

function procedure(desc, recordDate, fields) {
  return {
    type: 'encounter',
    data: {
      consultationTopics: [
        {
          headings: [
            {
              entries: [
                Object.assign(
                  {
                    entryType: 'procedure',
                    type: 'Procedure',
                    clinicalCodeDescription: desc,
                    recordDate: recordDate,
                  },
                  fields || {}
                ),
              ],
            },
          ],
        },
      ],
    },
  };
}

console.log('\n--- procedure entries use the same given-dose matcher ---');
{
  const payload = {
    patientJournalRecords: [
      day('Fri 02 Oct 2026', [
        procedure('Seasonal influenza vaccination', '2026-10-02'),
        procedure('Seasonal influenza vaccination invitation', '2026-10-02'),
        procedure('Appendicectomy', '2026-10-02'),
        {
          type: 'procedure',
          data: {
            entryType: 'procedure',
            clinicalCodeDescription: 'COVID-19 vaccination',
            recordDate: '2026-10-02',
            conceptId: '1324681000000101',
          },
        },
      ]),
      day('Wed 15 Oct 2025', [procedure('Seasonal influenza vaccination', '2025-10-15')]),
      day('Fri 05 Oct 2018', [procedure('Seasonal influenza vaccination', '2018-10-05')]),
      day('Wed 25 Sep 2024', [
        procedure('Administration of RSV (respiratory syncytial virus) vaccine', '2024-09-25', {
          conceptId: '1303503001',
        }),
      ]),
      day('Thu 31 Jan 2002', [procedure('Pneumococcal vaccination given', '2002-01-31')]),
      day('Thu 23 Feb 2017', [procedure('Herpes zoster vaccination', '2017-02-23')]),
    ],
  };
  const parsed = JO.parseJournalObservations(payload, { now: NOW, windowDays: 400 });
  const has = (name, date) => parsed.some((o) => o.entryKind === 'procedure' && o.name === name && o.date === date);

  check(has('Seasonal influenza vaccination', '2026-10-02'), 'this-season flu procedure is ingested');
  check(has('COVID-19 vaccination', '2026-10-02'), 'flat COVID procedure is ingested');
  check(
    parsed.some((o) => o.name === 'COVID-19 vaccination' && o.code === '1324681000000101'),
    'flat COVID procedure keeps the concept id'
  );
  check(!has('Seasonal influenza vaccination invitation', '2026-10-02'), 'a procedure invitation is not ingested');
  check(!parsed.some((o) => o.name === 'Appendicectomy'), 'an operation procedure is not ingested');
  check(has('Seasonal influenza vaccination', '2025-10-15'), 'last-season flu procedure inside 400 days is ingested');
  check(!has('Seasonal influenza vaccination', '2018-10-05'), '2018 flu procedure stays outside the 400-day window');
  check(has('Administration of RSV (respiratory syncytial virus) vaccine', '2024-09-25'), '2024 RSV procedure is kept');
  check(has('Pneumococcal vaccination given', '2002-01-31'), '2002 pneumococcal procedure is kept');
  check(has('Herpes zoster vaccination', '2017-02-23'), '2017 shingles procedure is kept');

  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: parsed.filter((o) => o.date === '2026-10-02' && /influenza vaccination$/.test(o.name)),
      })
    ) === 'vax_given',
    'this-season flu procedure counts as given'
  );
  check(
    statusOf('vax-flu', patient(70, { observations: parsed.filter((o) => o.date === '2025-10-15') })) === 'vax_due',
    'last-season flu procedure stays due for 2026/27'
  );
  check(
    statusOf('vax-covid', patient(80, { observations: parsed.filter((o) => o.code === '1324681000000101') })) ===
      'vax_given',
    'COVID procedure concept id counts as given'
  );
  check(
    statusOf('vax-rsv', patient(80, { observations: parsed.filter((o) => /orthopneumovirus|RSV/.test(o.name)) })) ===
      'vax_given',
    '2024 RSV procedure counts as given'
  );
  check(
    statusOf('vax-pneumo-ppv23', patient(70, { observations: parsed.filter((o) => /Pneumococcal/.test(o.name)) })) ===
      'vax_given',
    '2002 pneumococcal procedure counts as given'
  );
  check(
    statusOf('vax-shingles', patient(75, { observations: parsed.filter((o) => /zoster/.test(o.name)) })) ===
      'vax_given',
    '2017 shingles procedure counts as given'
  );
  check(
    statusOf('vax-flu', patient(70, { observations: [] })) === 'vax_due',
    'no procedure and no other dose stays due'
  );
}

console.log('\n--- given inside the window beats a decline, whatever the order ---');
{
  const laterGiven = patient(70, {
    problems: [
      { label: 'Influenza vaccination declined', codedDate: '2026-09-02', status: 'active' },
      { label: 'Seasonal influenza vaccination', codedDate: '2026-10-01', status: 'active' },
    ],
  });
  check(statusOf('vax-flu', laterGiven) === 'vax_given', 'a later given overrides an earlier decline');

  const declineListedFirst = patient(70, {
    problems: [
      { label: 'Seasonal influenza vaccination', codedDate: '2026-10-01', status: 'active' },
      { label: 'Influenza vaccination declined', codedDate: '2026-09-02', status: 'active' },
    ],
  });
  check(
    statusOf('vax-flu', declineListedFirst) === 'vax_given',
    'array order does not let an earlier decline hide a later given'
  );

  const laterDecline = patient(70, {
    problems: [
      { label: 'Seasonal influenza vaccination', codedDate: '2026-09-15', status: 'active' },
      { label: 'Influenza vaccination declined', codedDate: '2026-10-03', status: 'active' },
    ],
  });
  check(statusOf('vax-flu', laterDecline) === 'vax_given', 'a later decline does not undo an earlier in-season given');

  const sameDay = patient(70, {
    problems: [
      { label: 'Influenza vaccination declined', codedDate: '2026-10-01', status: 'active' },
      { label: 'Seasonal influenza vaccination', codedDate: '2026-10-01', status: 'active' },
    ],
  });
  check(statusOf('vax-flu', sameDay) === 'vax_given', 'same-day given and decline → given');

  const onlyDecline = patient(70, {
    problems: [{ label: 'Influenza vaccination declined', codedDate: '2026-10-01', status: 'active' }],
  });
  check(statusOf('vax-flu', onlyDecline) === 'vax_declined', 'a decline with no in-season given stays declined');

  const oldGivenThenDecline = patient(70, {
    problems: [
      { label: 'Seasonal influenza vaccination', codedDate: '2025-10-15', status: 'active' },
      { label: 'Influenza vaccination declined', codedDate: '2026-10-01', status: 'active' },
    ],
  });
  check(
    statusOf('vax-flu', oldGivenThenDecline) === 'vax_declined',
    'a given from last season does not block this season decline'
  );

  const historyThenProblem = patient(70, {
    observationHistory: [
      {
        name: 'Influenza vaccination declined',
        history: [{ date: '2026-09-02', value: NaN, rawValue: '' }],
      },
    ],
    observations: [{ name: 'Seasonal influenza vaccination', date: '2026-10-01', entryKind: 'observation' }],
  });
  check(
    statusOf('vax-flu', historyThenProblem) === 'vax_given',
    'a later observation given overrides an earlier history decline'
  );
}

console.log('\n--- structured not-given is not a dose ---');
{
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [
          { name: 'Seasonal influenza vaccination', date: '2026-10-01', status: 'not-done', entryKind: 'immunisation' },
        ],
      })
    ) === 'vax_declined',
    'status not-done on an administration name is declined, not given'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [{ name: 'Seasonal influenza vaccination', date: '2026-10-01', notGiven: true }],
      })
    ) === 'vax_declined',
    'notGiven true on an administration name is declined, not given'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [
          {
            name: 'Seasonal influenza vaccination',
            date: '2026-10-01',
            administrationStatus: { code: 'not-given', display: 'Not given' },
          },
        ],
      })
    ) === 'vax_declined',
    'administrationStatus not-given is declined, not given'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [{ name: 'Seasonal influenza vaccination', date: '2026-10-01', status: 'completed' }],
      })
    ) === 'vax_given',
    'status completed still counts as given'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        problems: [{ label: 'Seasonal influenza vaccination', codedDate: '2026-10-01', status: 'active' }],
      })
    ) === 'vax_given',
    'problem status active is not a not-given'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [{ name: 'Seasonal influenza vaccination', date: '2026-10-01', status: 'entered-in-error' }],
      })
    ) === 'vax_due',
    'entered-in-error is not counted as given or declined'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [{ name: 'Smoker', date: '2026-09-21', notGiven: true }],
      })
    ) === 'vax_due',
    'not-given on a non-vaccine row does not decline flu'
  );
  check(
    statusOf(
      'vax-flu',
      patient(70, {
        observations: [
          { name: 'Seasonal influenza vaccination', date: '2026-09-15', entryKind: 'procedure' },
          { name: 'Seasonal influenza vaccination', date: '2026-10-03', status: 'not-done', entryKind: 'procedure' },
        ],
      })
    ) === 'vax_given',
    'a later not-given does not undo an earlier in-season procedure given'
  );

  const marked = JO.parseJournalObservations(
    {
      patientJournalRecords: [
        day('Fri 02 Oct 2026', [procedure('Seasonal influenza vaccination', '2026-10-02', { status: 'not-done' })]),
      ],
    },
    { now: NOW, windowDays: 400 }
  );
  check(
    marked.some((o) => o.entryKind === 'procedure' && o.vaccineOutcome === 'not-given'),
    'the parser copies a procedure not-done status onto the row'
  );
  check(
    statusOf('vax-flu', patient(70, { observations: marked })) === 'vax_declined',
    'a parsed procedure marked not-done is not given'
  );
}

console.log('\n--- COVID eligibility stays 75+, care home, immunosuppressed ---');
{
  const diabetic = statusOf(
    'vax-covid',
    patient(70, { problems: [{ label: 'Type 2 diabetes mellitus', status: 'active', codedDate: '2020-01-01' }] })
  );
  check(diabetic === null, `age 70 with diabetes still has no COVID chip (got ${diabetic})`);
  const old = statusOf('vax-covid', patient(80, {}));
  check(old === 'vax_due', `age 80 with no dose is still COVID due (got ${old})`);
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
