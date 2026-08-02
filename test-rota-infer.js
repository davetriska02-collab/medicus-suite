// Medicus Suite — Rota infer tests (ported from medicus-rota-manager)
// Run with: node test-rota-infer.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { inferPatterns } = await R('engine/infer.js');
  const { newStaff } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const row = (name, am, pm) => ({
    name,
    am: { hasSession: am, slots: 0, booked: 0 },
    pm: { hasSession: pm, slots: 0, booked: 0 },
  });

  // Four observed Mondays + four Tuesdays. Alice consults 4/4 Mon AM,
  // 3/4 Mon PM, 1/4 Tue AM. Threshold 0.6 -> Mon AM + Mon PM only.
  const mondays = ['2026-05-11', '2026-05-18', '2026-05-25', '2026-06-01'];
  const tuesdays = ['2026-05-12', '2026-05-19', '2026-05-26', '2026-06-02'];
  const rowsByDate = {};
  mondays.forEach((d, i) => {
    rowsByDate[d] = [row('Dr Alice Smith', true, i < 3), row('Dr Ghost', true, false)];
  });
  tuesdays.forEach((d, i) => {
    rowsByDate[d] = [row('Dr Alice Smith', i === 0, false)];
  });

  const alice = newStaff({ id: 'a1', name: 'Alice', medicusName: 'DR ALICE SMITH' }); // case-insensitive match
  const bob = newStaff({ id: 'b1', name: 'Dr Bob' }); // never seen

  const result = inferPatterns({ rowsByDate, staff: [alice, bob] });
  assert.equal(result.datesObserved, 8);
  assert.equal(result.proposals.length, 1);
  const p = result.proposals[0];
  assert.equal(p.staffId, 'a1');
  assert.equal(p.cells, 2);
  assert.equal(p.pattern[0].mon.am, 'surgery');
  assert.equal(p.pattern[0].mon.pm, 'surgery');
  assert.equal(p.pattern[0].tue.am, null); // 1/4 below threshold
  assert.ok(p.summary.some((x) => /MON AM \(4\/4\)/.test(x)));

  // Clinicians seen in Medicus but not registered are reported.
  assert.deepEqual(result.unmatched, ['Dr Ghost']);

  // A weekday observed only once is never proposed (needs >= 2 observations).
  const single = inferPatterns({ rowsByDate: { '2026-06-01': [row('Dr Alice Smith', true, true)] }, staff: [alice] });
  assert.equal(single.proposals.length, 0);

  // Threshold is honoured: at 0.5, Tue AM (1/4) still out, Mon PM (3/4) in.
  const loose = inferPatterns({ rowsByDate, staff: [alice], threshold: 0.25 });
  assert.equal(loose.proposals[0].pattern[0].tue.am, 'surgery');

  // Directory lanes (notAPerson): matched so they never show as unknown,
  // but no pattern is ever proposed for them.
  const lane = newStaff({ id: 'lane', name: 'Nhs 111', medicusName: 'Dr Ghost', notAPerson: true });
  const flagged = inferPatterns({ rowsByDate, staff: [alice, lane] });
  assert.equal(flagged.proposals.length, 1); // Alice only
  assert.equal(flagged.proposals[0].staffId, 'a1');
  assert.deepEqual(flagged.unmatched, []); // the lane no longer reported as unmatched

  console.log('test-infer: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
