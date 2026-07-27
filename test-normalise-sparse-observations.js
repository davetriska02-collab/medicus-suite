// Medicus Suite — normaliseObservations / normaliseProblemsAll regression tests
// Run with: node test-normalise-sparse-observations.js
//
// Two silent patient-safety defects found in the 2026-07-27 audit, both in
// engine/normalisers.js, both of the same shape: a guard written for the dense
// case discarded real clinical data in the sparse case, with no error.
//
//  1. investigation-dashboard rowData is a DATE-COLUMN MATRIX — every analyte
//     row carries a key for every column date in the dashboard and null/'' for
//     dates on which that particular test wasn't done. The old code read only
//     the newest column and returned when it was empty, throwing away every
//     earlier result on the row. A potassium of 6.9 taken in July vanished
//     entirely as soon as an unrelated lipid profile added a newer column, so
//     the hyperkalaemia alert emitted NOTHING — not even no_data.
//
//  2. normaliseProblemsAll returned early unless activeProblems was an array,
//     which skipped the inactiveProblems block below it. A patient with no
//     active problems but a coded hysterectomy (normally filed as an ENDED
//     problem) lost pastProblems, and the HRT progestogen-cover and
//     cervical-screening logic read it as "never happened".

'use strict';

const { normaliseObservations, normaliseObservationHistory, normaliseAll } = require('./engine/normalisers.js');

// normaliseProblemsAll is module-internal; exercise it through the real
// normaliseAll path, which is what the engine actually consumes.
const normaliseProblemsAll = (listing) => {
  const r = normaliseAll({ problemListing: listing });
  return { active: r.problems, past: r.pastProblems };
};

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

console.log('--- sparse date-column matrix: an analyte must not vanish ---');
{
  // The real motivating shape: U&Es done 01 Jul (K+ 6.9), lipids done 20 Jul.
  // The potassium row therefore has a NULL cell in the newest (20 Jul) column.
  const dashboard = {
    rowData: [
      {
        investigationType: 'Serum potassium',
        investigationGroup: 'U&Es',
        unit: 'mmol/L',
        data20260701: { result: '6.9', isAboveReferenceRange: true },
        data20260720: null,
      },
      {
        investigationType: 'Serum cholesterol',
        investigationGroup: 'Lipids',
        unit: 'mmol/L',
        data20260701: null,
        data20260720: { result: '5.1' },
      },
    ],
  };
  const obs = normaliseObservations(dashboard);
  const k = obs.find((o) => /potassium/i.test(o.name));
  check(!!k, 'potassium survives a newer, empty column (was dropped entirely)');
  check(k && k.rawValue === '6.9', 'the potassium VALUE is the real one (6.9), not a later blank');
  check(k && k.date === '2026-07-01', 'the potassium DATE is the date it was actually taken');
  check(k && k.isAbove === true, 'the above-range flag from that cell is preserved');
  check(
    obs.some((o) => o.name === 'U&Es'),
    'the U&Es group aggregate is emitted (panel-level monitoring rules depend on it)'
  );
  check(
    obs.some((o) => /cholesterol/i.test(o.name)),
    'the analyte that DOES have a newest-column value is unaffected'
  );
}

console.log('--- newest non-empty column wins (not merely "any" column) ---');
{
  const obs = normaliseObservations({
    rowData: [
      {
        investigationType: 'Serum creatinine',
        unit: 'umol/L',
        data20260101: { result: '88' },
        data20260401: { result: '132' },
        data20260601: { result: '' }, // empty string, not null
        data20260701: null,
      },
    ],
  });
  check(obs.length === 1 && obs[0].rawValue === '132', 'picks the most recent NON-EMPTY result (132, not 88)');
  check(obs[0].date === '2026-04-01', 'dates it to that column, not to the blank newer one');
}

console.log('--- a genuinely resultless row is still dropped ---');
{
  const obs = normaliseObservations({
    rowData: [{ investigationType: 'Serum urate', data20260101: null, data20260201: { result: '' } }],
  });
  check(obs.length === 0, 'a row with no result in ANY column produces no observation');
}

console.log('--- agrees with normaliseObservationHistory on the same payload ---');
{
  // The history normaliser always iterated every column and skipped nulls
  // individually — it was the proof that the payload is genuinely sparse and
  // only the latest-value path was wrong. They must not disagree.
  const rowData = [
    {
      investigationType: 'Serum potassium',
      unit: 'mmol/L',
      data20260701: { result: '6.9' },
      data20260720: null,
    },
  ];
  const obs = normaliseObservations({ rowData });
  const hist = normaliseObservationHistory({ rowData });
  const kHist = hist.find((h) => /potassium/i.test(h.name));
  check(obs.length === 1 && !!kHist, 'both normalisers see the potassium row');
  check(kHist && kHist.history[0].value === 6.9, 'history carries the same 6.9 value');
  check(
    obs[0].rawValue === String(kHist.history[0].rawValue),
    'the latest-value path and the history path agree on the value'
  );
}

console.log('--- degenerate input never throws ---');
{
  check(normaliseObservations(null).length === 0, 'null dashboard -> []');
  check(normaliseObservations({ rowData: 'nope' }).length === 0, 'non-array rowData -> []');
  check(normaliseObservations({ rowData: [{}] }).length === 0, 'a row with no investigationType -> []');
}

console.log('--- pastProblems survive when the patient has no ACTIVE problems ---');
{
  const listing = {
    inactiveProblems: [{ problemCodeDescription: 'Total abdominal hysterectomy', dateToDisplay: '2019-04-02' }],
  };
  const out = normaliseProblemsAll(listing);
  check(out.past.length === 1, 'an inactive problem is kept when activeProblems is ABSENT (was discarded)');
  check(out.past[0].label === 'Total abdominal hysterectomy', 'the past problem carries its label');
  check(out.past[0].status === 'past', 'it is marked as past');
  check(out.active.length === 0, 'no active problems are invented');
}

console.log('--- the ordinary dense case is unchanged ---');
{
  const out = normaliseProblemsAll({
    activeProblems: [{ problemCodeDescription: 'Type 2 diabetes mellitus', dateToDisplay: '2020-01-01' }],
    inactiveProblems: [{ problemCodeDescription: 'Total abdominal hysterectomy', dateToDisplay: '2019-04-02' }],
  });
  check(out.active.length === 1 && out.past.length === 1, 'active + inactive both normalise as before');
  check(normaliseProblemsAll(null).active.length === 0, 'null listing -> empty, no throw');
  check(normaliseProblemsAll({}).past.length === 0, 'empty listing -> empty, no throw');
  const ended = normaliseProblemsAll({
    activeProblems: [{ problemCodeDescription: 'Resolved thing', hasEnded: true }],
  });
  check(
    ended.past.length === 1 && ended.active.length === 0,
    'an activeProblems entry with hasEnded still lands in past'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
