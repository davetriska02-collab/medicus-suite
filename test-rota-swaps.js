// Medicus Suite — Rota swaps tests (ported from medicus-rota-manager)
// Run with: node test-rota-swaps.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { validateSwap, applySwap } = await R('engine/swaps.js');
  const { newStaff } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const gpA = newStaff({ id: 'a', name: 'Dr A' });
  const gpB = newStaff({ id: 'b', name: 'Dr B' });
  const nurse = newStaff({ id: 'n', name: 'Nurse', role: 'nurse' });
  const staff = [gpA, gpB, nurse];

  const eA = { id: 'e1', staffId: 'a', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned' };
  const eB = { id: 'e2', staffId: 'b', date: '2026-06-09', period: 'pm', typeId: 'surgery', status: 'planned' };
  const eN = { id: 'e3', staffId: 'n', date: '2026-06-09', period: 'am', typeId: 'surgery', status: 'planned' };

  // Valid GP↔GP swap.
  assert.deepEqual(validateSwap({ entryA: eA, entryB: eB, staff, leaveList: [] }), []);

  // Same person, role-group mismatch, and leave clashes are all caught.
  assert.ok(validateSwap({ entryA: eA, entryB: { ...eB, staffId: 'a' }, staff, leaveList: [] }).length);
  assert.ok(validateSwap({ entryA: eA, entryB: eN, staff, leaveList: [] })[0].includes('different role groups'));
  const leaveList = [
    { staffId: 'a', type: 'annual', status: 'approved', startDate: '2026-06-09', endDate: '2026-06-09' },
  ];
  assert.ok(validateSwap({ entryA: eA, entryB: eB, staff, leaveList })[0].includes('on leave'));

  // applySwap exchanges the people, not the sessions.
  const { entries, ok } = applySwap({ entryAId: 'e1', entryBId: 'e2' }, [eA, eB, eN]);
  assert.equal(ok, true);
  assert.equal(entries.find((e) => e.id === 'e1').staffId, 'b');
  assert.equal(entries.find((e) => e.id === 'e2').staffId, 'a');
  assert.equal(entries.find((e) => e.id === 'e1').date, '2026-06-08'); // session stayed put
  assert.equal(entries.find((e) => e.id === 'e3').staffId, 'n'); // bystander untouched

  // Missing entry -> no-op.
  assert.equal(applySwap({ entryAId: 'e1', entryBId: 'gone' }, [eA]).ok, false);

  console.log('test-swaps: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
