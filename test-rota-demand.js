// Medicus Suite — Rota demand tests (ported from medicus-rota-manager)
// Run with: node test-rota-demand.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { mergePull, effective, weekdayProfile, demandToSessions, compareWeek, windowDates } =
    await R('engine/demand.js');
  const { newStaff, DEFAULT_SETTINGS } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const settings = { ...DEFAULT_SETTINGS, demand: { ...DEFAULT_SETTINGS.demand } };
  const row = (amBooked, pmBooked) => ({ am: { booked: amBooked }, pm: { booked: pmBooked } });

  // --- mergePull: pulled values refresh, corrections survive ---
  const existing = {
    days: {
      '2026-06-01': { am: 40, pm: 30, tasks: 70, manualAm: 55, excluded: false },
      '2026-06-02': { am: 10, pm: 10, tasks: 20, excluded: true, note: 'flu clinic' },
    },
  };
  const merged = mergePull({
    existing,
    rowsByDate: { '2026-06-01': [row(48, 31), row(2, 1)] }, // two clinicians sum
    taskCounts: { '2026-06-01': 75 },
    pulledAt: '2026-06-11T10:00:00Z',
  });
  assert.equal(merged.days['2026-06-01'].am, 50); // pulled refreshed (48+2)
  assert.equal(merged.days['2026-06-01'].manualAm, 55); // correction preserved
  assert.equal(merged.days['2026-06-01'].tasks, 75);
  assert.equal(merged.days['2026-06-02'].excluded, true); // untouched day intact
  assert.equal(merged.days['2026-06-02'].note, 'flu clinic');

  // Manual override wins in effective().
  assert.equal(effective(merged.days['2026-06-01']).am, 55);
  assert.equal(effective(merged.days['2026-06-01']).pm, 32);

  // --- weekdayProfile ---
  // Mondays 2026-04-13 (8wk before asOf 2026-06-08) value 50, 2026-06-01 (1wk) value 100.
  const demand = {
    days: {
      '2026-04-13': { am: 50, pm: 20, tasks: 40 },
      '2026-06-01': { am: 100, pm: 40, tasks: 80 },
      '2026-06-02': { am: 60, pm: 60, tasks: 60, excluded: true }, // excluded Tuesday
      '2026-06-06': { am: 30, pm: 30, tasks: 30 }, // Saturday: not an open day
    },
  };
  // Equal weighting (halfLife 0): Monday avg = 75.
  let profile = weekdayProfile({
    demand,
    asOf: '2026-06-08',
    settings: { ...settings, demand: { ...settings.demand, halfLifeWeeks: 0 } },
  });
  assert.equal(profile.mon.am, 75);
  assert.equal(profile.mon.samples, 2);
  assert.equal(profile.tue, undefined); // only sample was excluded
  assert.equal(profile.sat, undefined); // closed day ignored
  // Sharp decay (halfLife 1): the recent Monday dominates (>95).
  profile = weekdayProfile({
    demand,
    asOf: '2026-06-08',
    settings: { ...settings, demand: { ...settings.demand, halfLifeWeeks: 1 } },
  });
  assert.ok(profile.mon.am > 95, `expected >95, got ${profile.mon.am}`);
  // Manual override feeds the profile.
  profile = weekdayProfile({
    demand: { days: { '2026-06-01': { am: 100, manualAm: 10, pm: 0, tasks: 0 } } },
    asOf: '2026-06-08',
    settings,
  });
  assert.equal(profile.mon.am, 10);
  // Bank holidays drop out.
  profile = weekdayProfile({
    demand: { days: { '2026-06-01': { am: 100, pm: 0, tasks: 0 } } },
    asOf: '2026-06-08',
    settings: { ...settings, bankHolidays: ['2026-06-01'] },
  });
  assert.equal(profile.mon, undefined);

  // --- demandToSessions: buffer + ceil against session capacity ---
  let required = demandToSessions(
    { mon: { am: 50, pm: 50 } },
    { ...settings, apptsPerSurgerySession: 15, demand: { ...settings.demand, bufferPct: 20 } }
  );
  assert.equal(required.mon.am, 4); // 60/15 exact
  required = demandToSessions(
    { mon: { am: 51, pm: 0 } },
    { ...settings, apptsPerSurgerySession: 15, demand: { ...settings.demand, bufferPct: 20 } }
  );
  assert.equal(required.mon.am, 5); // 61.2/15 -> ceil

  // --- compareWeek ---
  const gp = newStaff({ id: 'g1', name: 'Dr A' });
  const nurse = newStaff({ id: 'n1', name: 'Nurse B', role: 'nurse' });
  const rows2 = compareWeek({
    dates: ['2026-06-08'],
    entries: [
      { id: 'e1', staffId: 'g1', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned' },
      { id: 'e2', staffId: 'n1', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned' }, // nurses count
      { id: 'e3', staffId: 'g1', date: '2026-06-08', period: 'pm', typeId: 'admin', status: 'planned' }, // non-clinical doesn't
      { id: 'e4', staffId: 'g1', date: '2026-06-08', period: 'pm', typeId: 'surgery', status: 'vacancy' }, // vacancy doesn't
    ],
    staff: [gp, nurse],
    leaveList: [],
    settings,
    required: { mon: { am: 4, pm: 2 } },
  });
  const am = rows2.find((r) => r.period === 'am');
  const pm = rows2.find((r) => r.period === 'pm');
  assert.equal(am.rostered, 2);
  assert.equal(am.delta, -2); // short two sessions
  assert.equal(pm.rostered, 0);
  assert.equal(pm.delta, -2);

  // windowDates: open weekdays only, correct span.
  const wd = windowDates('2026-06-08', { ...settings, demand: { ...settings.demand, weeksWindow: 2 } });
  assert.equal(wd.length, 10); // 2 weeks of Mon-Fri
  assert.equal(wd[0], '2026-05-25');
  assert.equal(wd[wd.length - 1], '2026-06-05');

  console.log('test-demand: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
