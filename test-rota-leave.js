// Medicus Suite — Rota leave tests (ported from medicus-rota-manager)
// Run with: node test-rota-leave.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { sessionsInRange, leaveBalance, checkLeaveRequest, applyApprovedLeave, sfeReimbursementFlags, fitNoteFlags } =
    await R('engine/leave.js');
  const { newStaff, blankPattern, DEFAULT_SETTINGS } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const settings = { ...DEFAULT_SETTINGS, templateAnchorMonday: '2026-06-08' };

  const gp = newStaff({ id: 'gp1', name: 'Dr A', entitlement: { annual: 10, study: 2 }, pattern: blankPattern(1) });
  gp.pattern[0].mon = { am: 'surgery', pm: 'surgery' };
  gp.pattern[0].tue = { am: 'surgery', pm: null };

  // Session cost from pattern when no entries exist: Mon (2) + Tue (1) = 3.
  assert.equal(sessionsInRange(gp, '2026-06-08', '2026-06-12', [], settings), 3);

  // Rostered entries take precedence over the pattern.
  const entries = [
    { id: 'e1', staffId: 'gp1', date: '2026-06-08', period: 'am', typeId: 'duty', status: 'planned' },
    { id: 'e2', staffId: 'gp1', date: '2026-06-08', period: 'pm', typeId: 'surgery', status: 'planned' },
    { id: 'e3', staffId: 'gp1', date: '2026-06-09', period: 'am', typeId: 'admin', status: 'planned' },
  ];
  assert.equal(sessionsInRange(gp, '2026-06-08', '2026-06-12', entries, settings), 3);

  // Balance subtracts approved leave in the same leave year only.
  const leaveList = [
    {
      id: 'l1',
      staffId: 'gp1',
      type: 'annual',
      status: 'approved',
      startDate: '2026-05-04',
      endDate: '2026-05-05',
      sessions: 3,
    },
    {
      id: 'l2',
      staffId: 'gp1',
      type: 'annual',
      status: 'approved',
      startDate: '2026-02-02',
      endDate: '2026-02-03',
      sessions: 3,
    }, // previous leave year
    {
      id: 'l3',
      staffId: 'gp1',
      type: 'annual',
      status: 'requested',
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      sessions: 3,
    }, // not approved
  ];
  const bal = leaveBalance(gp, leaveList, 'annual', '2026-06-10');
  assert.equal(bal.used, 3);
  assert.equal(bal.remaining, 7);

  // Over-entitlement request triggers a high warning.
  const bigReq = { id: 'r1', staffId: 'gp1', type: 'annual', startDate: '2026-06-08', endDate: '2026-07-03' }; // 4 weeks × 3 = 12 > 7
  let res = checkLeaveRequest(bigReq, { staff: [gp], leaveList, entries: [], settings });
  assert.equal(res.sessions, 12);
  assert.ok(res.warnings.some((w) => w.severity === 'high' && /remain/.test(w.message)));

  // Simultaneous-cap warning when too many of the same group are off.
  const gp2 = newStaff({ id: 'gp2', name: 'Dr B' });
  const gp3 = newStaff({ id: 'gp3', name: 'Dr C' });
  const capSettings = { ...settings, maxSimultaneousLeave: { ...settings.maxSimultaneousLeave, gp: 1 } };
  const clashLeave = [
    {
      id: 'lx',
      staffId: 'gp2',
      type: 'annual',
      status: 'approved',
      startDate: '2026-06-08',
      endDate: '2026-06-12',
      sessions: 5,
    },
  ];
  res = checkLeaveRequest(
    { id: 'r2', staffId: 'gp3', type: 'annual', startDate: '2026-06-10', endDate: '2026-06-11' },
    { staff: [gp, gp2, gp3], leaveList: clashLeave, entries: [], settings: capSettings }
  );
  assert.ok(res.warnings.some((w) => /cap is 1/.test(w.message)));

  // Duty impact warning.
  res = checkLeaveRequest(
    { id: 'r3', staffId: 'gp1', type: 'annual', startDate: '2026-06-08', endDate: '2026-06-08' },
    { staff: [gp], leaveList: [], entries, settings }
  );
  assert.ok(res.warnings.some((w) => /duty doctor/.test(w.message)));

  // Bank holidays cost no leave sessions (pattern fallback).
  const bhSettings = { ...settings, bankHolidays: ['2026-06-08'] };
  assert.equal(sessionsInRange(gp, '2026-06-08', '2026-06-12', [], bhSettings), 1); // Mon (2) skipped, Tue AM remains

  // Peak-period cap: existing approved leave + this request exceeds the cap.
  const peakSettings = {
    ...settings,
    peakPeriods: [{ name: 'Summer', start: '2026-06-01', end: '2026-06-30', maxSessions: 3 }],
  };
  const peakLeave = [
    {
      id: 'pk1',
      staffId: 'gp1',
      type: 'annual',
      status: 'approved',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      sessions: 3,
    }, // Mon+Tue = 3 pattern sessions
  ];
  res = checkLeaveRequest(
    { id: 'pk2', staffId: 'gp1', type: 'annual', startDate: '2026-06-08', endDate: '2026-06-09' },
    { staff: [gp], leaveList: peakLeave, entries: [], settings: peakSettings }
  );
  assert.ok(res.warnings.some((w) => /Summer/.test(w.message) && /cap is 3/.test(w.message)));
  // Sickness (uncounted) is exempt from peak caps.
  res = checkLeaveRequest(
    { id: 'pk3', staffId: 'gp1', type: 'sick', startDate: '2026-06-08', endDate: '2026-06-09' },
    { staff: [gp], leaveList: peakLeave, entries: [], settings: peakSettings }
  );
  assert.ok(!res.warnings.some((w) => /Summer/.test(w.message)));

  // Approval punches out: clinical -> vacancy, admin removed.
  const applied = applyApprovedLeave(
    { staffId: 'gp1', type: 'annual', startDate: '2026-06-08', endDate: '2026-06-09' },
    entries
  );
  assert.equal(applied.vacancies, 2);
  assert.equal(applied.removed, 1);
  assert.equal(applied.entries.find((e) => e.id === 'e1').status, 'vacancy');
  assert.ok(!applied.entries.some((e) => e.id === 'e3'));

  // SFE: sickness over 14 days flags as reimbursement-eligible.
  const flags = sfeReimbursementFlags(
    [{ id: 's1', staffId: 'gp1', type: 'sick', status: 'approved', startDate: '2026-05-20', endDate: '2026-06-20' }],
    [gp],
    '2026-06-10'
  );
  assert.equal(flags.length, 1);
  assert.equal(flags[0].eligible, true);

  // Fit-note / return-to-work flags.
  const asOf = '2026-06-10';
  const sickRec = (over) => ({ id: 's1', staffId: 'gp1', type: 'sick', status: 'approved', ...over });

  // Ongoing >7 days, no fit note -> high.
  let ff = fitNoteFlags([sickRec({ startDate: '2026-06-01', endDate: '2026-06-20' })], [gp], asOf);
  assert.equal(ff.length, 1);
  assert.equal(ff[0].severity, 'high');
  assert.ok(/no fit note/.test(ff[0].message));

  // Within self-certification window -> no flag.
  ff = fitNoteFlags([sickRec({ startDate: '2026-06-08', endDate: '2026-06-20' })], [gp], asOf);
  assert.equal(ff.length, 0);

  // Fit note expired while still off -> high; expiring within 7 days -> medium.
  ff = fitNoteFlags(
    [sickRec({ startDate: '2026-05-20', endDate: '2026-06-20', fitNoteUntil: '2026-06-08' })],
    [gp],
    asOf
  );
  assert.equal(ff[0].severity, 'high');
  ff = fitNoteFlags(
    [sickRec({ startDate: '2026-05-20', endDate: '2026-06-20', fitNoteUntil: '2026-06-15' })],
    [gp],
    asOf
  );
  assert.equal(ff[0].severity, 'medium');

  // Valid fit note covering ahead -> no flag.
  ff = fitNoteFlags(
    [sickRec({ startDate: '2026-05-20', endDate: '2026-06-20', fitNoteUntil: '2026-07-01' })],
    [gp],
    asOf
  );
  assert.equal(ff.length, 0);

  // Ended episode without RTW -> medium; with RTW or older than 30 days -> none.
  ff = fitNoteFlags([sickRec({ startDate: '2026-06-01', endDate: '2026-06-03' })], [gp], asOf);
  assert.ok(/return-to-work/.test(ff[0].message));
  ff = fitNoteFlags([sickRec({ startDate: '2026-06-01', endDate: '2026-06-03', rtwDone: true })], [gp], asOf);
  assert.equal(ff.length, 0);
  ff = fitNoteFlags([sickRec({ startDate: '2026-04-01', endDate: '2026-04-03' })], [gp], asOf);
  assert.equal(ff.length, 0);

  console.log('test-leave: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
