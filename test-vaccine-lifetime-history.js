// Medicus Suite — lifetime one-off vaccines must see the whole immunisation history
// Run with: node test-vaccine-lifetime-history.js
//
// Reported on v3.268.5. Monitoring showed Pneumococcal (PCV20) Age 65+ DUE
// and RSV Age 75+ DUE. The Immunisation History held both doses. Two
// independent causes, checked here against the shipped code:
//
//   1. parseJournalObservations drops anything older than 400 days.
//      On 2026-09-29 the RSV dose (2024-09-25) is 734 days old and the
//      pneumococcal dose (2002-01-31) is 9007 days old. Both are dropped
//      before the engine runs. Shingles (2017-02-23) is dropped the same way.
//   2. Even if the RSV row is handed to the engine, the given stems
//      "rsv vaccine" and "respiratory syncytial virus vaccin" do not sit
//      inside "Administration of RSV (respiratory syncytial virus) vaccine":
//      the parenthetical splits them. "Pneumococcal vaccination given"
//      already contains "pneumococcal vaccination", so the matcher was not
//      why that chip stayed due.
//
// Policy (pending CSO review, H-091): a single pneumococcal dose at any age
// satisfies the routine 65+ one-off. This dose was given at age 56, before
// the 65th birthday. Green Book chapter 25 is one dose for most adults.
// No shipped rule requires the dose to have been given at or after 65.
// Asplenia / splenic dysfunction / CKD 5-year revaccination stays unencoded.
//
// Seasonal flu and COVID keep their season windows. Invitation, offer and
// situation concepts stay excluded (H-090). Coded notes stay on the 400-day
// window (H-088).
//
// Texts and dates only. No patient identifiers.

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

const NOW = '2026-09-29';
const DOB = '1945-06-07';
const RSV = 'Administration of RSV (respiratory syncytial virus) vaccine';
const PNEUMO = 'Pneumococcal vaccination given';
const SHINGLES = 'Herpes zoster vaccination';
const FLU_ADMIN = 'Administration of first inactivated seasonal influenza vaccination';
const FLU_PHARM = 'Seasonal influenza vaccination given by pharmacist (situation)';
const FLU_OHP = 'Seasonal influenza vaccination given by other healthcare provider (situation)';
const FLU_PLAIN = 'Seasonal influenza vaccination';
const COVID_COURSE =
  'Immunisation course to maintain protection against SARS-CoV-2 (severe acute respiratory syndrome coronavirus 2)';
const COVID_DOSE =
  'Administration of first dose of SARS-CoV-2 (severe acute respiratory syndrome coronavirus 2) vaccine';
const RSV_INVITE = 'RSV vaccination invitation short message service text message sent (situation)';

const RSV_DATE = '2024-09-25';
const PNEUMO_DATE = '2002-01-31';
const SHINGLES_DATE = '2017-02-23';
const FLU_ADMIN_DATE = '2024-10-19';
const FLU_SIT_DATE = '2025-10-23';
const FLU_PLAIN_DATE = '2018-10-05';
const COVID_COURSE_DATE = '2026-04-29';
const COVID_DOSE_DATE = '2021-01-28';

function daysBefore(iso, nowIso) {
  const a = Date.parse(iso + 'T00:00:00Z');
  const b = Date.parse(nowIso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function ageOn(dob, on) {
  const b = new Date(dob + 'T00:00:00Z');
  const d = new Date(on + 'T00:00:00Z');
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const md = d.getUTCMonth() - b.getUTCMonth();
  if (md < 0 || (md === 0 && d.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

function ruleById(id) {
  return vaxRules.rules.find((r) => r.id === id);
}

function statusOf(id, data, now) {
  const chips = engine.evaluateVaccineRule(ruleById(id), data, now || NOW);
  if (!chips.length) return { status: null, eventDate: null, seasonLabel: null };
  return { status: chips[0].status, eventDate: chips[0].eventDate, seasonLabel: chips[0].seasonLabel };
}

function baseData(extra) {
  return Object.assign(
    {
      patientContext: { ageYears: 81, dob: DOB },
      problems: [],
      observations: [],
      medications: [],
      observationHistory: [],
      _registerLookup: {},
    },
    extra || {}
  );
}

function flatImm(title, desc, fields) {
  return {
    title,
    items: [
      {
        type: 'immunisation',
        data: Object.assign({ entryType: 'immunisation', clinicalCodeDescription: desc }, fields || {}),
      },
    ],
  };
}

function nestedImm(title, desc, fields) {
  return {
    title,
    items: [
      {
        type: 'encounter',
        data: {
          consultationTopics: [
            {
              headings: [
                {
                  entries: [Object.assign({ entryType: 'immunisation', clinicalCodeDescription: desc }, fields || {})],
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

// The history, in the two journal shapes the parser already walks.
// RSV is nested (encounter entry). Pneumococcal uses the display date only.
const history = {
  patientJournalRecords: [
    nestedImm('Wed 25 Sep 2024', RSV, { recordDate: RSV_DATE }),
    flatImm('Thu 31 Jan 2002', PNEUMO, { observationDate: '31 Jan 2002' }),
    flatImm('Thu 23 Feb 2017', SHINGLES, { recordDate: SHINGLES_DATE }),
    flatImm('Sat 19 Oct 2024', FLU_ADMIN, { recordDate: FLU_ADMIN_DATE }),
    flatImm('Thu 23 Oct 2025', FLU_PHARM, { recordDate: FLU_SIT_DATE }),
    flatImm('Thu 23 Oct 2025', FLU_OHP, { recordDate: FLU_SIT_DATE }),
    flatImm('Fri 05 Oct 2018', FLU_PLAIN, { recordDate: FLU_PLAIN_DATE }),
    flatImm('Wed 29 Apr 2026', COVID_COURSE, { recordDate: COVID_COURSE_DATE }),
    flatImm('Thu 28 Jan 2021', COVID_DOSE, { recordDate: COVID_DOSE_DATE }),
    {
      title: 'Tue 01 Jan 2019',
      items: [
        {
          type: 'note',
          data: {
            entryType: 'note',
            clinicalCodeDescription: 'Smoker',
            conceptId: '77176002',
            recordDate: '2019-01-01',
          },
        },
      ],
    },
    {
      title: 'Mon 21 Sep 2026',
      items: [
        {
          type: 'note',
          data: {
            entryType: 'note',
            clinicalCodeDescription: 'Smoker',
            conceptId: '77176002',
            recordDate: '2026-09-21',
          },
        },
        {
          type: 'encounter',
          data: {
            consultationTopics: [
              {
                headings: [
                  {
                    entries: [
                      {
                        entryType: 'note',
                        clinicalCodeDescription: RSV_INVITE,
                        note: 'Vaccination VAC_RSV — recorded via Nexus by Nexus (filed automatically with the invitation that was sent)',
                        recordDate: '2026-09-24',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
    {
      title: 'Wed 01 Jan 2020',
      items: [
        {
          type: 'observation',
          data: {
            entryType: 'observation',
            type: 'Blood pressure',
            value: '120/80',
            observationDate: '01 Jan 2020',
          },
        },
      ],
    },
  ],
};

console.log('\n--- root cause: the 400-day window, and the RSV parenthetical ---');
{
  check(
    daysBefore(RSV_DATE, NOW) === 734,
    `RSV ${RSV_DATE} is 734 days before ${NOW} (got ${daysBefore(RSV_DATE, NOW)})`
  );
  check(daysBefore(RSV_DATE, NOW) > 400, 'RSV date is outside the 400-day journal window');
  check(daysBefore(PNEUMO_DATE, NOW) > 400, 'pneumococcal date is outside the 400-day journal window');
  check(daysBefore(SHINGLES_DATE, NOW) > 400, 'shingles date is outside the 400-day journal window');
  check(daysBefore(FLU_SIT_DATE, NOW) < 400, '23 Oct 2025 flu situation rows are inside the 400-day window');
  check(daysBefore(COVID_COURSE_DATE, NOW) < 400, '29 Apr 2026 COVID course is inside the 400-day window');

  const rsv = ruleById('vax-rsv');
  const preExisting = [
    'respiratory syncytial virus vaccin',
    'rsv vaccination',
    'rsv vaccine',
    'abrysvo',
    'arexvy',
    'mresvia',
  ];
  preExisting.forEach((stem) => {
    check(
      !RSV.toLowerCase().includes(stem),
      `pre-existing RSV stem "${stem}" is not inside the administration concept`
    );
  });
  check(
    rsv.statusTerms.given.some((t) => t === 'administration of rsv'),
    'vax-rsv given list contains "administration of rsv"'
  );
  check(RSV.toLowerCase().includes('administration of rsv'), 'that stem is a prefix of the administration concept');

  const pneumo = ruleById('vax-pneumo-ppv23');
  const pneumoHits = pneumo.statusTerms.given.filter((t) => PNEUMO.toLowerCase().includes(t.toLowerCase()));
  check(
    pneumoHits.includes('pneumococcal vaccination'),
    `pneumococcal text already matches a given stem (${pneumoHits.join(', ')})`
  );

  const shinglesHits = ruleById('vax-shingles').statusTerms.given.filter((t) =>
    SHINGLES.toLowerCase().includes(t.toLowerCase())
  );
  check(shinglesHits.length > 0, `shingles text already matches a given stem (${shinglesHits.join(', ')})`);

  // Handed straight to the engine, bypassing the parser: pneumococcal is given,
  // RSV was due until the new stem. This pins which failure was the matcher.
  const directPneumo = statusOf(
    'vax-pneumo-ppv23',
    baseData({ observations: [{ name: PNEUMO, date: PNEUMO_DATE, entryKind: 'immunisation' }] })
  );
  check(
    directPneumo.status === 'vax_given' && directPneumo.eventDate === PNEUMO_DATE,
    `engine accepts "${PNEUMO}" on ${PNEUMO_DATE} when the row is present (got ${directPneumo.status})`
  );
}

console.log('\n--- parser keeps lifetime immunisations and still windows notes and observations ---');
{
  const parsed = JO.parseJournalObservations(history, { now: NOW, windowDays: 400 });
  const names = parsed.map((o) => o.name);
  const byName = (name, date) => parsed.find((o) => o.name === name && o.date === date);

  const rsv = byName(RSV, RSV_DATE);
  const pneumo = byName(PNEUMO, PNEUMO_DATE);
  const shingles = byName(SHINGLES, SHINGLES_DATE);
  check(!!rsv && rsv.entryKind === 'immunisation', `nested RSV immunisation ${RSV_DATE} is kept`);
  check(!!pneumo && pneumo.entryKind === 'immunisation', `flat pneumococcal immunisation ${PNEUMO_DATE} is kept`);
  check(!!shingles && shingles.entryKind === 'immunisation', `shingles immunisation ${SHINGLES_DATE} is kept`);
  check(!!byName(FLU_ADMIN, FLU_ADMIN_DATE), 'Oct 2024 flu administration is kept');
  check(!!byName(FLU_PLAIN, FLU_PLAIN_DATE), 'Oct 2018 seasonal influenza vaccination is kept');
  check(!!byName(COVID_DOSE, COVID_DOSE_DATE), 'Jan 2021 COVID first dose is kept');
  check(!!byName(FLU_PHARM, FLU_SIT_DATE), 'in-window pharmacist situation row is still ingested');
  check(!!byName(COVID_COURSE, COVID_COURSE_DATE), 'in-window COVID course is still ingested');

  check(
    !parsed.some((o) => o.name === 'Smoker' && o.date === '2019-01-01'),
    'a coded note from 2019 is still outside the 400-day window'
  );
  check(
    parsed.some((o) => o.name === 'Smoker' && o.date === '2026-09-21' && o.code === '77176002'),
    'a recent coded Smoker note is still ingested (#477)'
  );
  check(
    parsed.some((o) => o.name === RSV_INVITE && o.entryKind === 'note'),
    'the RSV invitation note is still ingested as a note, not dropped'
  );
  check(
    !parsed.some(
      (o) => /VAC_RSV|filed automatically/i.test(o.name) || /VAC_RSV|filed automatically/i.test(o.value || '')
    ),
    'the invitation note body is not the observation name or value'
  );
  check(!names.includes('Blood pressure'), 'a 2020 blood pressure observation is still dropped');

  const age81 = baseData({ observations: parsed });
  const rsvChip = statusOf('vax-rsv', age81);
  const pneumoChip = statusOf('vax-pneumo-ppv23', age81);
  const fluChip = statusOf('vax-flu', age81);
  const covidChip = statusOf('vax-covid', age81);
  const shinglesChip = statusOf('vax-shingles', age81);

  check(
    rsvChip.status === 'vax_given' && rsvChip.eventDate === RSV_DATE,
    `RSV → vax_given on ${RSV_DATE} (got ${rsvChip.status} ${rsvChip.eventDate})`
  );
  check(
    pneumoChip.status === 'vax_given' && pneumoChip.eventDate === PNEUMO_DATE,
    `pneumococcal → vax_given on ${PNEUMO_DATE} (got ${pneumoChip.status} ${pneumoChip.eventDate})`
  );
  check(
    fluChip.status === 'vax_due' && fluChip.seasonLabel === '2026/27',
    `flu stays due for 2026/27 (got ${fluChip.status} ${fluChip.seasonLabel})`
  );
  check(
    covidChip.status === 'vax_due' && covidChip.seasonLabel === '2026/27',
    `COVID stays due for 2026/27 (got ${covidChip.status} ${covidChip.seasonLabel})`
  );
  check(
    shinglesChip.status === null,
    `age 81 is outside the shingles cohort, so no shingles chip (got ${shinglesChip.status})`
  );
  check(
    statusOf('vax-pneumo-risk-u65', age81).status === null,
    'age 81 does not also fire the under-65 pneumococcal rule'
  );
}

console.log('\n--- pneumococcal policy: a dose given before 65 counts ---');
{
  const sixtyFifth = '2010-06-07';
  check(ageOn(DOB, PNEUMO_DATE) === 56, `age on ${PNEUMO_DATE} is 56 (got ${ageOn(DOB, PNEUMO_DATE)})`);
  check(PNEUMO_DATE < sixtyFifth, `${PNEUMO_DATE} is before the 65th birthday ${sixtyFifth}`);
  check(
    !Object.prototype.hasOwnProperty.call(ruleById('vax-pneumo-ppv23'), 'requireDoseOnOrAfterAge'),
    'vax-pneumo-ppv23 does not set a dose-given-at-or-after-65 gate'
  );
  const given = statusOf(
    'vax-pneumo-ppv23',
    baseData({ observations: [{ name: PNEUMO, date: PNEUMO_DATE, entryKind: 'immunisation' }] })
  );
  check(given.status === 'vax_given' && given.eventDate === PNEUMO_DATE, 'the age-56 dose satisfies the 65+ one-off');
  const none = statusOf('vax-pneumo-ppv23', baseData());
  check(none.status === 'vax_due', 'with no pneumococcal row the 65+ chip is still due');
}

console.log('\n--- shingles looks back over the same history when the patient is still eligible ---');
{
  const parsed = JO.parseJournalObservations(history, { now: NOW, windowDays: 400 });
  const eligible = baseData({
    patientContext: { ageYears: 75, dob: '1951-06-07' },
    observations: parsed.filter((o) => o.name === SHINGLES),
  });
  const chip = statusOf('vax-shingles', eligible);
  check(
    chip.status === 'vax_given' && chip.eventDate === SHINGLES_DATE,
    `age 75 + "${SHINGLES}" on ${SHINGLES_DATE} → vax_given (got ${chip.status} ${chip.eventDate})`
  );
}

console.log('\n--- seasonal windows, invitations and situation concepts stay as they were ---');
{
  const inSeasonFlu = statusOf(
    'vax-flu',
    baseData({ observations: [{ name: FLU_PLAIN, date: '2026-09-20', entryKind: 'immunisation' }] })
  );
  check(inSeasonFlu.status === 'vax_given', `flu given on 2026-09-20 counts for 2026/27 (got ${inSeasonFlu.status})`);

  const inSeasonCovid = statusOf(
    'vax-covid',
    baseData({ observations: [{ name: 'COVID-19 vaccination', date: '2026-09-20', entryKind: 'immunisation' }] })
  );
  check(
    inSeasonCovid.status === 'vax_given',
    `COVID-19 vaccination on 2026-09-20 counts (got ${inSeasonCovid.status})`
  );

  // The pharmacist situation concept contains flu given stems. H-090 must
  // still reject it even when the date is inside the current season.
  const situation = statusOf(
    'vax-flu',
    baseData({ observations: [{ name: FLU_PHARM, date: '2026-10-02', entryKind: 'immunisation' }] })
  );
  check(
    situation.status === 'vax_due',
    `pharmacist (situation) row inside the season stays due (got ${situation.status})`
  );
  const ohp = statusOf(
    'vax-flu',
    baseData({ observations: [{ name: FLU_OHP, date: '2026-10-02', entryKind: 'immunisation' }] })
  );
  check(ohp.status === 'vax_due', `other-provider (situation) row inside the season stays due (got ${ohp.status})`);

  const inviteOnly = statusOf(
    'vax-rsv',
    baseData({ observations: [{ name: RSV_INVITE, date: '2026-09-24', entryKind: 'note' }] })
  );
  check(inviteOnly.status === 'vax_due', `RSV invitation note alone stays due (got ${inviteOnly.status})`);

  const declined = statusOf(
    'vax-rsv',
    baseData({
      observations: [{ name: `${RSV} declined`, date: RSV_DATE, entryKind: 'immunisation' }],
    })
  );
  check(
    declined.status === 'vax_declined',
    `RSV administration concept plus declined → vax_declined (got ${declined.status})`
  );
  check(declined.status !== 'vax_given', 'that declined RSV row is not given');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
