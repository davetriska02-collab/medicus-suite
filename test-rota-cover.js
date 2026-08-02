// Medicus Suite — Rota cover tests (ported from medicus-rota-manager)
// Run with: node test-rota-cover.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { rankCover, applyCover } = await R('engine/cover.js');
  const { newStaff } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  // Monday 2026-06-08. Dr Sick (GP) is off; their surgery AM is a vacancy.
  const sick = newStaff({ id: 'sick', name: 'Dr Sick' });
  const spareGp = newStaff({ id: 'spare', name: 'Dr Spare', contractedSessions: 8 }); // nothing rostered -> 8 spare
  const busyGp = newStaff({ id: 'busy', name: 'Dr Busy', contractedSessions: 8 }); // rostered that period
  const fullGp = newStaff({ id: 'full', name: 'Dr Full', contractedSessions: 2 }); // at contract, extra session
  const locum = newStaff({ id: 'loc', name: 'Dr Locum', employmentType: 'locum', contractedSessions: 0 });
  const nurse = newStaff({ id: 'n1', name: 'Nurse', role: 'nurse' }); // wrong role group
  const away = newStaff({ id: 'away', name: 'Dr Away', contractedSessions: 8 }); // on leave

  const vacancy = {
    id: 'v1',
    staffId: 'sick',
    date: '2026-06-08',
    period: 'am',
    typeId: 'surgery',
    status: 'vacancy',
    roomId: 'r9',
  };
  const entries = [
    vacancy,
    { id: 'b1', staffId: 'busy', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned' },
    { id: 'f1', staffId: 'full', date: '2026-06-09', period: 'am', typeId: 'surgery', status: 'planned' },
    { id: 'f2', staffId: 'full', date: '2026-06-09', period: 'pm', typeId: 'surgery', status: 'planned' },
  ];
  const leaveList = [
    { staffId: 'away', type: 'annual', status: 'approved', startDate: '2026-06-08', endDate: '2026-06-08' },
  ];

  const ranked = rankCover({ vacancy, staff: [sick, spareGp, busyGp, fullGp, locum, nurse, away], entries, leaveList });

  // Busy (same period), nurse (role group), away (leave) and the absent person excluded.
  assert.deepEqual(
    ranked.map((c) => c.staffId),
    ['spare', 'full', 'loc']
  );
  assert.equal(ranked[0].spare, 8);
  assert.ok(/unrostered/.test(ranked[0].reason));
  assert.ok(/extra session/.test(ranked[1].reason));
  assert.equal(ranked[2].isLocum, true);

  // Directory lanes are never cover candidates.
  const lane = newStaff({ id: 'lane', name: 'Nhs 111', notAPerson: true, contractedSessions: 10 });
  const laneRanked = rankCover({ vacancy, staff: [sick, lane], entries, leaveList: [] });
  assert.equal(laneRanked.length, 0);

  // Duty vacancies only rank duty-eligible GPs.
  const dutyVacancy = { ...vacancy, typeId: 'duty' };
  const noDuty = newStaff({ id: 'nd', name: 'Dr NoDuty', dutyEligible: false });
  const dutyRanked = rankCover({ vacancy: dutyVacancy, staff: [sick, spareGp, noDuty], entries, leaveList: [] });
  assert.deepEqual(
    dutyRanked.map((c) => c.staffId),
    ['spare']
  );

  // applyCover: vacancy marked covered, the candidate gets a real session in the freed room.
  const { entries: applied, newEntry } = applyCover({ vacancy, candidate: ranked[0], entries });
  const v = applied.find((e) => e.id === 'v1');
  assert.equal(v.status, 'covered');
  assert.ok(/Dr Spare/.test(v.note));
  assert.equal(newEntry.staffId, 'spare');
  assert.equal(newEntry.typeId, 'surgery');
  assert.equal(newEntry.roomId, 'r9');
  assert.equal(newEntry.source, 'cover');
  assert.equal(applied.length, entries.length + 1);

  console.log('test-cover: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
