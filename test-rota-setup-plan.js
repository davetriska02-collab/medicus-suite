// Medicus Suite — Rota setup-plan tests (first-run wizard import planning)
// Run with: node test-rota-setup-plan.js
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { buildImportPlan, SKIP_KNOWN, SKIP_NO_SESSIONS } = await R('engine/setup-plan.js');
  const { newStaff } = await R('shared/model.js');

  // Row shaped like engine/reconcile.js parseOverview() output.
  const row = (name, am, pm) => ({
    name,
    am: { hasSession: Boolean(am), slots: 0, booked: 0, f2f: 0 },
    pm: { hasSession: Boolean(pm), slots: 0, booked: 0, f2f: 0 },
  });

  /* ---- empty payloads ---- */
  let plan = buildImportPlan({}, []);
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.skipped, []);
  plan = buildImportPlan(undefined, undefined);
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.skipped, []);
  plan = buildImportPlan({ '2026-06-08': [] }, []);
  assert.deepEqual(plan.candidates, []);

  /* ---- new clinicians: dedupe across days, sessions and dates accumulate ---- */
  plan = buildImportPlan(
    {
      '2026-06-08': [row('Dr Sarah Crane', true, true), row('Dr Tom Whitfield', true, false)],
      '2026-06-09': [row('Dr Sarah Crane', true, false)],
      '2026-06-10': [row('Dr Sarah Crane', false, true)],
    },
    []
  );
  assert.equal(plan.candidates.length, 2);
  // Busiest first.
  assert.equal(plan.candidates[0].name, 'Dr Sarah Crane');
  assert.equal(plan.candidates[0].sessionCount, 4); // 2 + 1 + 1
  assert.deepEqual(plan.candidates[0].dates, ['2026-06-08', '2026-06-09', '2026-06-10']);
  assert.equal(plan.candidates[1].name, 'Dr Tom Whitfield');
  assert.equal(plan.candidates[1].sessionCount, 1);
  assert.deepEqual(plan.candidates[1].dates, ['2026-06-08']);
  assert.deepEqual(plan.skipped, []);

  /* ---- known staff: matched on name, case- and spacing-insensitively ---- */
  const known = [newStaff({ id: 's1', name: 'Dr Sarah Crane' })];
  plan = buildImportPlan(
    { '2026-06-08': [row('dr   SARAH crane', true, true), row('Dr New Person', true, false)] },
    known
  );
  assert.deepEqual(
    plan.candidates.map((c) => c.name),
    ['Dr New Person']
  );
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, SKIP_KNOWN);
  assert.equal(plan.skipped[0].name, 'dr SARAH crane'); // display form: spacing tidied, case kept

  /* ---- known staff: medicusName is the primary match, name the fallback ---- */
  const viaMedicusName = [newStaff({ id: 's2', name: 'Hannah Reid', medicusName: 'Hannah Reid ANP' })];
  plan = buildImportPlan({ '2026-06-08': [row('Hannah Reid ANP', true, true)] }, viaMedicusName);
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.skipped[0].reason, SKIP_KNOWN);

  plan = buildImportPlan({ '2026-06-08': [row('Hannah Reid', true, true)] }, viaMedicusName);
  assert.deepEqual(plan.candidates, [], 'the name field still matches when medicusName does not');

  // A blank medicusName must not match every blank-named row into "known".
  const blankMedicus = [newStaff({ id: 's3', name: 'Dr Real Person', medicusName: '' })];
  plan = buildImportPlan({ '2026-06-08': [row('Dr Someone Else', true, false)] }, blankMedicus);
  assert.equal(plan.candidates.length, 1);
  assert.deepEqual(plan.skipped, []);

  /* ---- no-session rows are skipped, not imported ---- */
  plan = buildImportPlan(
    {
      '2026-06-08': [row('Dr Ghost Lane', false, false), row('Dr Working', true, false)],
      '2026-06-09': [row('Dr Ghost Lane', false, false)],
    },
    []
  );
  assert.deepEqual(
    plan.candidates.map((c) => c.name),
    ['Dr Working']
  );
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].name, 'Dr Ghost Lane');
  assert.equal(plan.skipped[0].reason, SKIP_NO_SESSIONS);

  // A name seen empty on one day and working on another is still a candidate.
  plan = buildImportPlan(
    { '2026-06-08': [row('Dr Part Time', false, false)], '2026-06-09': [row('Dr Part Time', false, true)] },
    []
  );
  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0].sessionCount, 1);
  assert.deepEqual(plan.candidates[0].dates, ['2026-06-09']); // only days actually worked

  // Known beats no-sessions: a colleague already in the team reads as known.
  plan = buildImportPlan({ '2026-06-08': [row('Dr Sarah Crane', false, false)] }, known);
  assert.equal(plan.skipped[0].reason, SKIP_KNOWN);

  /* ---- name normalisation edge cases ---- */
  plan = buildImportPlan(
    {
      '2026-06-08': [row('  Dr  Jo   Bloggs  ', true, false)],
      '2026-06-09': [row('Dr Jo Bloggs', false, true)],
      '2026-06-10': [row('DR JO BLOGGS', true, false)],
    },
    []
  );
  assert.equal(plan.candidates.length, 1, 'spacing and case variants are one person');
  assert.equal(plan.candidates[0].name, 'Dr Jo Bloggs', 'first-seen display form, whitespace collapsed');
  assert.equal(plan.candidates[0].sessionCount, 3);
  assert.equal(plan.candidates[0].dates.length, 3);

  // Blank / whitespace-only / missing names are not people and are not listed.
  plan = buildImportPlan({ '2026-06-08': [row('', true, true), row('   ', true, true), { am: {}, pm: {} }] }, []);
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.skipped, []);

  // Malformed rows must not throw: missing period objects, null rows, null day.
  plan = buildImportPlan({ '2026-06-08': [{ name: 'Dr Sparse' }, null], '2026-06-09': null }, []);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].reason, SKIP_NO_SESSIONS);

  /* ---- purity: inputs are never mutated, output carries no ids ---- */
  const rowsByDate = { '2026-06-08': [row('Dr Immutable', true, true)] };
  const staffIn = [newStaff({ id: 's9', name: 'Dr Known' })];
  const snapshot = JSON.stringify({ rowsByDate, staffIn });
  plan = buildImportPlan(rowsByDate, staffIn);
  assert.equal(JSON.stringify({ rowsByDate, staffIn }), snapshot);
  assert.deepEqual(Object.keys(plan.candidates[0]).sort(), ['dates', 'name', 'sessionCount']);

  /* ---- deterministic ordering ---- */
  plan = buildImportPlan(
    { '2026-06-08': [row('Dr Zoe', true, false), row('Dr Amy', true, false), row('Dr Bob', true, true)] },
    []
  );
  assert.deepEqual(
    plan.candidates.map((c) => c.name),
    ['Dr Bob', 'Dr Amy', 'Dr Zoe'] // sessions desc, then name asc
  );

  console.log('test-setup-plan: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
