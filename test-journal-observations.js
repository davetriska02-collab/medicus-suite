// Medicus Suite — journal-observation parsing + observationHistory merge tests
// Run with: node test-journal-observations.js
//
// Guards the 2026-09-21 live-consult ingestion fixes (v3.264.3):
//   1. FLAT top-level `observation` journal items (a standalone "Journal
//      Observation" coded outside a consultation — BP "119/86", "Teetotaller",
//      "Ex-smoker") must ingest; the old parser walked only encounter items'
//      nested entries and dropped every flat observation silently.
//   2. Journal observations must reach data.observationHistory (not only
//      data.observations) so Trends/brief/passport BP readers see them —
//      mergeJournalObsIntoHistory is that one ingest path.
//
// Also pins the wiring: sentinel.js must delegate to the shared parser and
// merge into observationHistory, and the manifest must load the shared file
// BEFORE sentinel.js.

'use strict';
const fs = require('fs');
const path = require('path');
const JO = require('./shared/journal-observations.js');

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

const NOW = '2026-09-21T12:00:00Z';

// ── payload fixtures (shapes per docs/learnings-patient-journal-api.md) ──────

function nestedEncounterDay() {
  return {
    title: 'Mon 21 Sep 2026',
    items: [
      {
        type: 'encounter',
        data: {
          consultationTopics: [
            {
              headings: [
                {
                  entries: [
                    {
                      entryType: 'observation',
                      type: 'O/E - blood pressure reading',
                      value: '119/86',
                      observationDate: '21 Sep 2026',
                    },
                    { entryType: 'note', type: 'Some note', value: 'nope' },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

function flatObservationDay() {
  return {
    title: 'Mon 21 Sep 2026',
    items: [
      {
        type: 'observation',
        data: { entryType: 'observation', type: 'Blood pressure', value: '119/86', observationDate: '21 Sep 2026' },
      },
      {
        type: 'observation',
        data: { entryType: 'observation', type: 'Teetotaller', value: '', observationDate: '21 Sep 2026' },
      },
      { type: 'observation', data: { entryType: 'observation', type: 'Ex-smoker', value: '' } }, // no own date → day-group date
      { type: 'note', data: { entryType: 'note', type: 'Telephone call' } },
    ],
  };
}

console.log('--- parseJournalObservations: nested encounter entries (original path) ---');
{
  const out = JO.parseJournalObservations({ patientJournalRecords: [nestedEncounterDay()] }, { now: NOW });
  check(out.length === 1, `nested path yields only observation entries (got ${out.length})`);
  check(
    out[0] &&
      out[0].name === 'O/E - blood pressure reading' &&
      out[0].value === '119/86' &&
      out[0].date === '2026-09-21',
    'nested O/E BP entry parsed with name/value/date'
  );
  check(out[0] && out[0].source === 'journal', 'nested entry carries source: journal');
}

console.log('\n--- parseJournalObservations: FLAT top-level observation items (live-consult gap) ---');
{
  const out = JO.parseJournalObservations({ patientJournalRecords: [flatObservationDay()] }, { now: NOW });
  const names = out.map((o) => o.name);
  check(names.includes('Blood pressure'), 'flat "Blood pressure" journal observation ingests');
  check(names.includes('Teetotaller'), 'flat "Teetotaller" journal observation ingests');
  check(names.includes('Ex-smoker'), 'flat "Ex-smoker" journal observation ingests');
  check(!names.includes('Telephone call'), 'flat non-observation items are still skipped');
  const bp = out.find((o) => o.name === 'Blood pressure');
  check(bp && bp.value === '119/86' && bp.date === '2026-09-21', 'flat BP carries value + ISO date');
  const ex = out.find((o) => o.name === 'Ex-smoker');
  check(ex && ex.date === '2026-09-21', 'flat entry without its own observationDate falls back to the day-group date');
}

console.log('\n--- parseJournalObservations: generic-name promotion (v3.264.4 naming hardening) ---');
{
  // The rules engine matches observation NAMES only, so a flat item whose
  // coded term lives in `value` under a generic wrapper name ("Journal
  // observation") is invisible to every indicator (SMOK002 live NO DATA,
  // 2026-09-21). The parser promotes the value to the name in that case.
  const day = {
    title: 'Mon 21 Sep 2026',
    items: [
      {
        type: 'observation',
        title: 'Journal observation',
        data: { entryType: 'observation', value: 'Ex-smoker', observationDate: '21 Sep 2026' },
      },
      {
        type: 'observation',
        title: 'Journal observation',
        data: { entryType: 'observation', value: '119/86', observationDate: '21 Sep 2026' },
      },
      {
        type: 'observation',
        data: { entryType: 'observation', type: 'Smoking status', value: 'Ex-smoker', observationDate: '21 Sep 2026' },
      },
    ],
  };
  const out = JO.parseJournalObservations({ patientJournalRecords: [day] }, { now: NOW });
  const names = out.map((o) => o.name);
  check(names.includes('Ex-smoker'), 'generic wrapper name + coded-term value → value promoted to name');
  const promoted = out.find((o) => o.name === 'Ex-smoker');
  check(
    promoted && promoted.value === 'Ex-smoker' && promoted.date === '2026-09-21',
    'promoted entry keeps value + date'
  );
  check(
    names.includes('Journal observation'),
    'generic name + bare numeric value (BP "119/86") is NOT promoted — a reading is not a name'
  );
  check(names.includes('Smoking status'), 'a real coded name is never overridden by the value');

  // Nested path gets the same hardening.
  const nested = {
    title: 'Mon 21 Sep 2026',
    items: [
      {
        type: 'encounter',
        data: {
          consultationTopics: [
            {
              headings: [
                {
                  entries: [
                    {
                      entryType: 'observation',
                      type: 'Observation',
                      value: 'Ex-smoker',
                      observationDate: '21 Sep 2026',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };
  const nOut = JO.parseJournalObservations({ patientJournalRecords: [nested] }, { now: NOW });
  check(
    nOut.length === 1 && nOut[0].name === 'Ex-smoker',
    'nested entry with generic "Observation" type also promotes the value'
  );
}

console.log('\n--- parseJournalObservations: windowing + de-dupe ---');
{
  const stale = {
    title: 'Wed 01 Jan 2020',
    items: [
      {
        type: 'observation',
        data: { entryType: 'observation', type: 'Blood pressure', value: '150/90', observationDate: '01 Jan 2020' },
      },
    ],
  };
  const out = JO.parseJournalObservations({ patientJournalRecords: [stale] }, { now: NOW });
  check(out.length === 0, 'entries older than the 400-day window are dropped');

  const dup = JO.parseJournalObservations(
    { patientJournalRecords: [flatObservationDay()] },
    { now: NOW, existingObs: [{ name: 'Blood pressure', date: '2026-09-21' }] }
  );
  check(!dup.some((o) => o.name === 'Blood pressure'), 'same name+date already in the dashboard is de-duped');
  check(
    dup.some((o) => o.name === 'Teetotaller'),
    'de-dupe drops only the duplicate, not siblings'
  );

  const both = {
    patientJournalRecords: [
      {
        title: 'Mon 21 Sep 2026',
        items: [
          {
            type: 'observation',
            data: { entryType: 'observation', type: 'Teetotaller', value: '', observationDate: '21 Sep 2026' },
          },
          {
            type: 'observation',
            data: { entryType: 'observation', type: 'Teetotaller', value: '', observationDate: '21 Sep 2026' },
          },
        ],
      },
    ],
  };
  check(
    JO.parseJournalObservations(both, { now: NOW }).length === 1,
    'duplicate journal entries (same name+date) collapse to one'
  );

  check(Array.isArray(JO.parseJournalObservations(null, { now: NOW })), 'null payload → empty array, never throws');
  check(
    JO.parseJournalObservations({ patientJournalRecords: [{ items: [{ type: 'observation' }] }] }, { now: NOW })
      .length === 0,
    'flat item with no data is skipped, never throws'
  );
}

console.log('\n--- mergeJournalObsIntoHistory ---');
{
  const dashboardHistory = [
    {
      name: 'Blood pressure',
      code: null,
      group: 'Key observations',
      unit: 'mmHg',
      history: [
        {
          date: '2026-04-27',
          value: NaN,
          rawValue: '146/82',
          isAbove: false,
          isBelow: false,
          source: 'API:investigation-dashboard (synthesised)',
        },
      ],
    },
    {
      name: 'HbA1c',
      code: null,
      group: 'Diabetes',
      unit: 'mmol/mol',
      history: [
        {
          date: '2026-02-01',
          value: 65,
          rawValue: '65',
          isAbove: false,
          isBelow: false,
          source: 'API:investigation-dashboard',
        },
      ],
    },
  ];
  const journalObs = [
    { name: 'Blood pressure', value: '119/86', date: '2026-09-21', source: 'journal' },
    { name: 'Teetotaller', value: '', date: '2026-09-21', source: 'journal' },
  ];
  const merged = JO.mergeJournalObsIntoHistory(dashboardHistory, journalObs);

  const bpGroup = merged.find((g) => g.name === 'Blood pressure');
  check(bpGroup && bpGroup.history.length === 2, 'journal BP merges into the existing "Blood pressure" group');
  check(
    bpGroup && bpGroup.history[0].date === '2026-09-21' && bpGroup.history[0].rawValue === '119/86',
    'merged history stays newest-first with the journal reading on top'
  );
  check(bpGroup && bpGroup.history[0].source === 'journal', 'merged point carries source: journal');

  const ttGroup = merged.find((g) => g.name === 'Teetotaller');
  check(!!ttGroup && ttGroup.history.length === 1, 'unmatched journal obs creates its own group');
  check(
    merged[merged.length - 1] === ttGroup,
    'non-BP new groups append at the END (dashboard rows keep substring-match priority)'
  );

  check(dashboardHistory[0].history.length === 1, 'input observationHistory is never mutated');

  // Same-date collision: the dashboard point is authoritative.
  const collide = JO.mergeJournalObsIntoHistory(dashboardHistory, [
    { name: 'Blood pressure', value: '999/99', date: '2026-04-27', source: 'journal' },
  ]);
  const cGroup = collide.find((g) => g.name === 'Blood pressure');
  check(
    cGroup.history.length === 1 && cGroup.history[0].rawValue === '146/82',
    'same-date journal point never overwrites the dashboard point'
  );

  // No dashboard BP at all: the new BP group must be first-hit findable.
  const noBp = JO.mergeJournalObsIntoHistory(
    [{ name: 'Systolic blood pressure', history: [{ date: '2026-01-01', value: 140, rawValue: '140' }] }],
    [{ name: 'Blood pressure', value: '119/86', date: '2026-09-21', source: 'journal' }]
  );
  check(
    noBp[0].name === 'Blood pressure',
    'a NEW "Blood pressure" group is unshifted to the front (first-hit consumers land on it)'
  );

  check(
    JO.mergeJournalObsIntoHistory(dashboardHistory, []) === dashboardHistory,
    'empty journal list returns the input unchanged'
  );
}

console.log('\n--- wiring invariants (sentinel.js + manifest) ---');
{
  const sentinel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');
  check(
    /JO\.parseJournalObservations\(d,\s*\{\s*existingObs,\s*windowDays:\s*400\s*\}\)/.test(sentinel),
    'fetchJournalObservations delegates to the shared parser with the 400-day window'
  );
  check(
    /mergeJournalObsIntoHistory\(\s*\n?\s*data\.observationHistory/.test(sentinel),
    'evaluateAndPublish folds journal obs into data.observationHistory'
  );
  check(
    /throw new Error\('journal parser unavailable'\)/.test(sentinel),
    'a missing parser THROWS (journalAugmentFailed fires — audit H5 semantics kept)'
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts.flatMap((cs) => cs.js || []);
  const joIdx = scripts.indexOf('shared/journal-observations.js');
  const sentinelIdx = scripts.indexOf('content-scripts/sentinel.js');
  check(joIdx !== -1, 'manifest loads shared/journal-observations.js');
  check(
    joIdx !== -1 && sentinelIdx !== -1 && joIdx < sentinelIdx,
    'shared/journal-observations.js loads BEFORE sentinel.js'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
