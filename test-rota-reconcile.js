// Medicus Suite — Rota reconcile tests (ported from medicus-rota-manager)
// Run with: node test-rota-reconcile.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { parseOverview, diffDay, summariseFindings } = await R('engine/reconcile.js');
  const { newStaff } = await R('shared/model.js');
  const { demoData, demoOverviewPayload } = await R('shared/demo.js');

  /* ---- original test body, unchanged ---- */
  // --- parseOverview ---
  const payload = {
    staffSchedules: [
      {
        name: 'Dr Alice Smith',
        schedule: [
          {
            summary: { status: { isCancelled: false } },
            entries: [
              {
                diaryEntryType: { value: 'appointment' },
                startDateTime: '2026-06-10T09:00:00',
                displayStatus: { value: 'booked' },
              },
              {
                diaryEntryType: { value: 'appointment' },
                startDateTime: '2026-06-10T09:10:00',
                displayStatus: { value: 'cancelled' },
              },
              { diaryEntryType: { value: 'slot' }, startDateTime: '2026-06-10T09:20:00' },
              {
                diaryEntryType: { value: 'appointment' },
                startDateTime: '2026-06-10T14:00:00',
                displayStatus: { value: 'arrived' },
              },
            ],
          },
          {
            summary: { status: { isCancelled: true } }, // cancelled block ignored entirely
            entries: [{ diaryEntryType: { value: 'slot' }, startDateTime: '2026-06-10T16:00:00' }],
          },
        ],
      },
    ],
  };
  const rows = parseOverview(payload);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].am.booked, 1); // cancelled appointment not counted
  assert.equal(rows[0].am.slots, 1);
  assert.equal(rows[0].pm.booked, 1); // 14:00 is PM (13:00 cutoff)
  assert.equal(rows[0].pm.hasSession, true);
  assert.equal(parseOverview({}).length, 0); // defensive on empty payload

  // --- diffDay ---
  const gp = newStaff({ id: 'g1', name: 'Dr Alice Smith', medicusName: 'Dr Alice Smith' });
  const gp2 = newStaff({ id: 'g2', name: 'Dr Bob Jones', medicusName: '' });

  // missing-clinic: rota says PM surgery for Bob, Medicus has nothing for him.
  let findings = diffDay({
    date: '2026-06-10',
    medicusRows: rows,
    staff: [gp, gp2],
    leaveList: [],
    rotaEntries: [
      { staffId: 'g1', date: '2026-06-10', period: 'am', typeId: 'surgery', status: 'planned' },
      { staffId: 'g2', date: '2026-06-10', period: 'pm', typeId: 'surgery', status: 'planned' },
    ],
  });
  assert.equal(findings.filter((f) => f.kind === 'missing-clinic').length, 1);
  assert.equal(findings.find((f) => f.kind === 'missing-clinic').staffName, 'Dr Bob Jones');
  assert.equal(findings.filter((f) => f.kind === 'ok').length, 1);
  // Alice's PM clinic exists in Medicus but rota has nothing -> unplanned.
  assert.equal(findings.filter((f) => f.kind === 'unplanned-clinic').length, 1);

  // ghost-clinic: clinic built for someone on approved leave.
  findings = diffDay({
    date: '2026-06-10',
    medicusRows: rows,
    staff: [gp],
    leaveList: [{ staffId: 'g1', status: 'approved', type: 'annual', startDate: '2026-06-10', endDate: '2026-06-10' }],
    rotaEntries: [{ staffId: 'g1', date: '2026-06-10', period: 'am', typeId: 'surgery', status: 'vacancy' }],
  });
  const ghosts = findings.filter((f) => f.kind === 'ghost-clinic');
  assert.equal(ghosts.length, 2); // AM and PM both built
  assert.equal(ghosts[0].booked, 1);

  // unknown-clinician: consulting in Medicus, absent from the registry.
  findings = diffDay({ date: '2026-06-10', medicusRows: rows, staff: [gp2], leaveList: [], rotaEntries: [] });
  assert.ok(findings.some((f) => f.kind === 'unknown-clinician' && f.staffName === 'Dr Alice Smith'));

  // Name matching falls back from medicusName to display name, case-insensitive.
  const gpCase = newStaff({ id: 'g3', name: 'DR ALICE SMITH', medicusName: '' });
  findings = diffDay({
    date: '2026-06-10',
    medicusRows: rows,
    staff: [gpCase],
    leaveList: [],
    rotaEntries: [{ staffId: 'g3', date: '2026-06-10', period: 'am', typeId: 'surgery', status: 'planned' }],
  });
  assert.equal(findings.filter((f) => f.kind === 'missing-clinic').length, 0);
  assert.equal(findings.filter((f) => f.kind === 'unknown-clinician').length, 0);

  // Directory lanes (notAPerson): clinics in Medicus for a flagged record
  // raise nothing — no unplanned, no ghost, no unknown.
  const lane = newStaff({ id: 'lane1', name: 'Nhs 111', medicusName: 'Dr Alice Smith', notAPerson: true });
  findings = diffDay({
    date: '2026-06-10',
    medicusRows: rows,
    staff: [lane],
    leaveList: [
      { staffId: 'lane1', status: 'approved', type: 'annual', startDate: '2026-06-10', endDate: '2026-06-10' },
    ],
    rotaEntries: [],
  });
  assert.equal(findings.length, 0);

  // --- demo fixture round-trip: the synthetic payload must parse and diff ---
  const demo = demoData();
  const demoRows = parseOverview(demoOverviewPayload(demo.staff, '2026-06-10'));
  assert.ok(demoRows.length >= 4);
  const demoFindings = diffDay({
    date: '2026-06-10',
    medicusRows: demoRows,
    staff: demo.staff,
    leaveList: [],
    rotaEntries: [],
  });
  const summary = summariseFindings(demoFindings);
  assert.ok(summary['unknown-clinician'] >= 1); // Dr Aisha Begum planted in the fixture

  console.log('test-reconcile: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
