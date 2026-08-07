// Medicus Suite — Rota template tests (ported from medicus-rota-manager)
// Run with: node test-rota-template.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { generateEntries } = await R('engine/template.js');
  const { newStaff, blankPattern, DEFAULT_SETTINGS } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const settings = { ...DEFAULT_SETTINGS, templateAnchorMonday: '2026-06-08' };

  const gp = newStaff({ id: 'gp1', name: 'Dr A', pattern: blankPattern(1) });
  gp.pattern[0].mon = { am: 'surgery', pm: 'admin' };
  gp.pattern[0].tue = { am: 'triage', pm: null };

  // One week roll-forward.
  let created = generateEntries({
    staff: [gp],
    startDate: '2026-06-08',
    endDate: '2026-06-14',
    existingEntries: [],
    leaveList: [],
    settings,
  });
  assert.equal(created.length, 3);
  assert.deepEqual(created.map((e) => `${e.date}|${e.period}|${e.typeId}|${e.status}`).sort(), [
    '2026-06-08|am|surgery|planned',
    '2026-06-08|pm|admin|planned',
    '2026-06-09|am|triage|planned',
  ]);

  // Existing entries are never overwritten.
  created = generateEntries({
    staff: [gp],
    startDate: '2026-06-08',
    endDate: '2026-06-14',
    existingEntries: [{ staffId: 'gp1', date: '2026-06-08', period: 'am', typeId: 'duty', status: 'planned' }],
    leaveList: [],
    settings,
  });
  assert.equal(created.length, 2);
  assert.ok(!created.some((e) => e.date === '2026-06-08' && e.period === 'am'));

  // Approved leave: clinical sessions generate as vacancies, non-clinical skipped.
  created = generateEntries({
    staff: [gp],
    startDate: '2026-06-08',
    endDate: '2026-06-14',
    existingEntries: [],
    leaveList: [{ staffId: 'gp1', status: 'approved', type: 'annual', startDate: '2026-06-08', endDate: '2026-06-08' }],
    settings,
  });
  const monAm = created.find((e) => e.date === '2026-06-08' && e.period === 'am');
  assert.equal(monAm.status, 'vacancy');
  assert.ok(!created.some((e) => e.date === '2026-06-08' && e.period === 'pm')); // admin skipped on leave
  assert.equal(created.find((e) => e.date === '2026-06-09').status, 'planned');

  // Bank holidays generate nothing.
  created = generateEntries({
    staff: [gp],
    startDate: '2026-06-08',
    endDate: '2026-06-14',
    existingEntries: [],
    leaveList: [],
    settings: { ...settings, bankHolidays: ['2026-06-08'] },
  });
  assert.ok(!created.some((e) => e.date === '2026-06-08'));
  assert.ok(created.some((e) => e.date === '2026-06-09')); // rest of week unaffected

  // Registrar debrief is noted on the supervisor's co-generated session.
  const sup = newStaff({
    id: 's1',
    name: 'Dr Super',
    employmentType: 'partner',
    supervisor: true,
    pattern: blankPattern(1),
  });
  sup.pattern[0].mon = { am: 'surgery', pm: null };
  const reg = newStaff({
    id: 'r1',
    name: 'Dr Reg',
    employmentType: 'registrar',
    registrarStage: 'ST2',
    pattern: blankPattern(1),
  });
  reg.pattern[0].mon = { am: 'surgery', pm: null };
  created = generateEntries({
    staff: [sup, reg],
    startDate: '2026-06-08',
    endDate: '2026-06-08',
    existingEntries: [],
    leaveList: [],
    settings,
  });
  const supEntry = created.find((e) => e.staffId === 's1');
  assert.ok(supEntry.note.includes('Debrief — Dr Reg'));
  assert.equal(created.find((e) => e.staffId === 'r1').note, '');

  // 2-week pattern places week-1 sessions in the second week.
  const nurse = newStaff({ id: 'n1', name: 'Nurse B', role: 'nurse', pattern: blankPattern(2) });
  nurse.pattern[1].wed = { am: 'surgery', pm: null };
  created = generateEntries({
    staff: [nurse],
    startDate: '2026-06-08',
    endDate: '2026-06-21',
    existingEntries: [],
    leaveList: [],
    settings,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].date, '2026-06-17'); // Wednesday of week index 1

  console.log('test-template: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
