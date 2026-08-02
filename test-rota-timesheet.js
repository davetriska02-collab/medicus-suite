// Medicus Suite — Rota timesheet tests (ported from medicus-rota-manager)
// Run with: node test-rota-timesheet.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { buildTimesheet, timesheetCSV } = await R('engine/timesheet.js');
  const { toilBalance } = await R('engine/leave.js');
  const { newStaff } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const gp = newStaff({ id: 'g1', name: 'Smith, "Dr" A', employmentType: 'salaried', contractedSessions: 6 });
  const entries = [
    { id: 'e1', staffId: 'g1', date: '2026-06-01', period: 'am', typeId: 'surgery', status: 'planned' },
    { id: 'e2', staffId: 'g1', date: '2026-06-01', period: 'pm', typeId: 'duty', status: 'planned' },
    { id: 'e3', staffId: 'g1', date: '2026-06-02', period: 'eve', typeId: 'enhanced', status: 'covered' },
    { id: 'e4', staffId: 'g1', date: '2026-06-02', period: 'am', typeId: 'surgery', status: 'vacancy' }, // not worked
    { id: 'e5', staffId: 'g1', date: '2026-07-01', period: 'am', typeId: 'surgery', status: 'planned' }, // out of range
  ];
  const leaveList = [
    {
      id: 'l1',
      staffId: 'g1',
      type: 'annual',
      status: 'approved',
      startDate: '2026-06-10',
      endDate: '2026-06-11',
      sessions: 4,
    },
    {
      id: 'l2',
      staffId: 'g1',
      type: 'annual',
      status: 'requested',
      startDate: '2026-06-20',
      endDate: '2026-06-21',
      sessions: 4,
    }, // not approved
  ];

  const [row] = buildTimesheet({ startDate: '2026-06-01', endDate: '2026-06-30', staff: [gp], entries, leaveList });
  assert.equal(row.totalSessions, 3); // vacancy and out-of-range excluded
  assert.equal(row.byType.surgery, 1);
  assert.equal(row.byType.duty, 1);
  assert.equal(row.byType.enhanced, 1);
  assert.equal(row.coveredSessions, 1);
  assert.equal(row.totalHours, 9.8); // 250 + 250 + 90 minutes = 9.83h -> 9.8
  assert.equal(row.leaveByType.annual, 4); // approved only

  const csv = timesheetCSV({ startDate: '2026-06-01', endDate: '2026-06-30', staff: [gp], entries, leaveList });
  assert.ok(csv.startsWith('Timesheet 2026-06-01 to 2026-06-30\r\n'));
  assert.ok(csv.includes('Name,Role,Employment,Site,Contracted/wk'));
  assert.ok(csv.includes('"Smith, ""Dr"" A"')); // commas and quotes escaped
  assert.ok(csv.includes('Leave AL'));
  assert.ok(csv.endsWith('\r\n'));

  // TOIL balance: accrued minus approved spend, all time.
  const nurse = newStaff({ id: 'n1', name: 'Nurse B', toilAccrued: 5 });
  const toilLeave = [
    {
      id: 't1',
      staffId: 'n1',
      type: 'toil',
      status: 'approved',
      startDate: '2026-05-01',
      endDate: '2026-05-01',
      sessions: 2,
    },
    {
      id: 't2',
      staffId: 'n1',
      type: 'toil',
      status: 'requested',
      startDate: '2026-06-01',
      endDate: '2026-06-01',
      sessions: 2,
    },
  ];
  const bal = toilBalance(nurse, toilLeave);
  assert.equal(bal.accrued, 5);
  assert.equal(bal.spent, 2); // requested doesn't count
  assert.equal(bal.remaining, 3);

  console.log('test-timesheet: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
