// Medicus Suite — Rota fairness tests (ported from medicus-rota-manager)
// Run with: node test-rota-fairness.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { autoAssignDuty, applyDutyChanges } = await R('engine/fairness.js');
  const { newStaff, DEFAULT_SETTINGS } = await R('shared/model.js');
  const { weekDates } = await R('shared/time.js');

  /* ---- original test body, unchanged ---- */
  const dates = weekDates('2026-06-08');
  const settings = { ...DEFAULT_SETTINGS, openDays: ['mon'] };

  const gpA = newStaff({ id: 'a', name: 'Dr A', contractedSessions: 8 });
  const gpB = newStaff({ id: 'b', name: 'Dr B', contractedSessions: 8 });
  const nurse = newStaff({ id: 'n', name: 'Nurse', role: 'nurse', dutyEligible: false });

  const e = (id, staffId, period, typeId, status = 'planned') => ({
    id,
    staffId,
    date: '2026-06-08',
    period,
    typeId,
    status,
  });

  // A carries duty history, so B (lower debt) gets Monday AM duty.
  let result = autoAssignDuty({
    dates,
    settings,
    leaveList: [],
    staff: [gpA, gpB, nurse],
    entries: [
      e('e1', 'a', 'am', 'surgery'),
      e('e2', 'b', 'am', 'surgery'),
      e('e3', 'n', 'am', 'surgery'),
      e('e4', 'a', 'pm', 'surgery'),
      e('e5', 'b', 'pm', 'surgery'),
    ],
    historyEntries: [
      { staffId: 'a', typeId: 'duty', status: 'planned' }, // A has 1 past duty
    ],
  });
  assert.equal(result.unfilled.length, 0);
  assert.equal(result.changes.length, 2);
  const amChange = result.changes.find((c) => c.period === 'am');
  assert.equal(amChange.staffId, 'b');
  // PM goes to A: B's debt rose after taking AM.
  const pmChange = result.changes.find((c) => c.period === 'pm');
  assert.equal(pmChange.staffId, 'a');

  // Existing duty cover means no changes.
  result = autoAssignDuty({
    dates,
    settings,
    leaveList: [],
    staff: [gpA, gpB],
    entries: [e('e1', 'a', 'am', 'duty'), e('e2', 'b', 'pm', 'duty')],
    historyEntries: [],
  });
  assert.equal(result.changes.length, 0);
  assert.equal(result.unfilled.length, 0);

  // Nobody eligible rostered -> unfilled, never assigns a nurse.
  result = autoAssignDuty({
    dates,
    settings,
    leaveList: [],
    staff: [nurse],
    entries: [e('e1', 'n', 'am', 'surgery')],
    historyEntries: [],
  });
  assert.deepEqual(result.unfilled, [
    { date: '2026-06-08', period: 'am' },
    { date: '2026-06-08', period: 'pm' },
  ]);

  // GP on approved leave is skipped.
  result = autoAssignDuty({
    dates,
    settings,
    staff: [gpA, gpB],
    leaveList: [{ staffId: 'a', status: 'approved', type: 'annual', startDate: '2026-06-08', endDate: '2026-06-08' }],
    entries: [e('e1', 'a', 'am', 'surgery'), e('e2', 'b', 'am', 'surgery')],
    historyEntries: [],
  });
  assert.equal(result.changes.find((c) => c.period === 'am').staffId, 'b');

  // applyDutyChanges rewrites the entry type and source.
  const entries = [e('e1', 'a', 'am', 'surgery')];
  const applied = applyDutyChanges(entries, [{ entryId: 'e1', to: 'duty' }]);
  assert.equal(applied[0].typeId, 'duty');
  assert.equal(applied[0].source, 'auto-duty');

  console.log('test-fairness: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
