// Medicus Suite — Rota rules tests (ported from medicus-rota-manager)
// Run with: node test-rota-rules.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { checkWeek, capacitySummary, dutyFairness, eaSummary } = await R('engine/rules.js');
  const { newStaff, DEFAULT_SETTINGS } = await R('shared/model.js');
  const { weekDates } = await R('shared/time.js');

  /* ---- original test body, unchanged ---- */
  const dates = weekDates('2026-06-08');
  const settings = { ...DEFAULT_SETTINGS, listSize: 2000, openDays: ['mon'] }; // keep the noise down: Monday only

  const partner = newStaff({ id: 'p1', name: 'Dr Partner', employmentType: 'partner', supervisor: true });
  const reg = newStaff({
    id: 'r1',
    name: 'Dr Reg',
    employmentType: 'registrar',
    registrarStage: 'ST2',
    dutyEligible: false,
  });
  const locum = newStaff({ id: 'l1', name: 'Dr Locum', employmentType: 'locum', supervisor: true }); // locums can't supervise
  const hca = newStaff({ id: 'h1', name: 'HCA Jo', role: 'hca', dutyEligible: false });

  const e = (staffId, date, period, typeId, status = 'planned') => ({
    id: `${staffId}${date}${period}`,
    staffId,
    date,
    period,
    typeId,
    status,
  });

  // No duty doctor Monday AM/PM -> two high warnings.
  let w = checkWeek({
    dates,
    entries: [e('p1', '2026-06-08', 'am', 'surgery')],
    staff: [partner],
    leaveList: [],
    settings,
  });
  assert.equal(w.filter((x) => x.kind === 'duty' && x.severity === 'high').length, 2);

  // Duty rostered AM -> only PM flagged.
  w = checkWeek({ dates, entries: [e('p1', '2026-06-08', 'am', 'duty')], staff: [partner], leaveList: [], settings });
  assert.equal(w.filter((x) => x.kind === 'duty').length, 1);
  assert.equal(w.find((x) => x.kind === 'duty').period, 'pm');

  // Duty doctor on approved leave doesn't count as cover.
  w = checkWeek({
    dates,
    entries: [e('p1', '2026-06-08', 'am', 'duty')],
    staff: [partner],
    leaveList: [{ staffId: 'p1', status: 'approved', type: 'annual', startDate: '2026-06-08', endDate: '2026-06-08' }],
    settings,
  });
  assert.equal(w.filter((x) => x.kind === 'duty').length, 2);

  // Registrar with no supervisor co-rostered -> supervision warning; locum doesn't count.
  w = checkWeek({
    dates,
    entries: [e('r1', '2026-06-08', 'am', 'surgery'), e('l1', '2026-06-08', 'am', 'duty')],
    staff: [reg, locum],
    leaveList: [],
    settings,
  });
  assert.equal(w.filter((x) => x.kind === 'supervision').length, 1);

  // Partner co-rostered -> no supervision warning.
  w = checkWeek({
    dates,
    entries: [e('r1', '2026-06-08', 'am', 'surgery'), e('p1', '2026-06-08', 'am', 'duty')],
    staff: [reg, partner],
    leaveList: [],
    settings,
  });
  assert.equal(w.filter((x) => x.kind === 'supervision').length, 0);

  // HCA alone -> warning; with a GP present -> none.
  w = checkWeek({ dates, entries: [e('h1', '2026-06-08', 'am', 'surgery')], staff: [hca], leaveList: [], settings });
  assert.equal(w.filter((x) => x.kind === 'hca').length, 1);
  w = checkWeek({
    dates,
    entries: [e('h1', '2026-06-08', 'am', 'surgery'), e('p1', '2026-06-08', 'am', 'duty')],
    staff: [hca, partner],
    leaveList: [],
    settings,
  });
  assert.equal(w.filter((x) => x.kind === 'hca').length, 0);

  // Vacancy surfaces in the worklist.
  w = checkWeek({
    dates,
    entries: [e('p1', '2026-06-08', 'am', 'surgery', 'vacancy'), e('p1', '2026-06-08', 'pm', 'duty')],
    staff: [partner],
    leaveList: [],
    settings,
  });
  assert.equal(w.filter((x) => x.kind === 'vacancy').length, 1);

  // Room clash: two active sessions in the same room/time -> one warning;
  // different rooms or a vacancy in the room -> none.
  const rooms = [
    { id: 'r1', name: 'Room 1' },
    { id: 'r2', name: 'Room 2' },
  ];
  const withRoom = (entry, roomId) => ({ ...entry, roomId });
  w = checkWeek({
    dates,
    staff: [partner, hca],
    leaveList: [],
    settings,
    rooms,
    entries: [
      withRoom(e('p1', '2026-06-08', 'am', 'duty'), 'r1'),
      withRoom(e('h1', '2026-06-08', 'am', 'surgery'), 'r1'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'room').length, 1);
  assert.ok(/Room 1 double-booked/.test(w.find((x) => x.kind === 'room').message));
  w = checkWeek({
    dates,
    staff: [partner, hca],
    leaveList: [],
    settings,
    rooms,
    entries: [
      withRoom(e('p1', '2026-06-08', 'am', 'duty'), 'r1'),
      withRoom(e('h1', '2026-06-08', 'am', 'surgery'), 'r2'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'room').length, 0);
  w = checkWeek({
    dates,
    staff: [partner, hca],
    leaveList: [],
    settings,
    rooms,
    entries: [
      withRoom(e('p1', '2026-06-08', 'am', 'duty'), 'r1'),
      withRoom(e('h1', '2026-06-08', 'am', 'surgery', 'vacancy'), 'r1'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'room').length, 0);

  // Bank holidays: no duty requirement on a closed day.
  const bhSettings = { ...settings, bankHolidays: ['2026-06-08'] };
  w = checkWeek({ dates, entries: [], staff: [partner], leaveList: [], settings: bhSettings });
  assert.equal(w.filter((x) => x.kind === 'duty').length, 0);

  // Multi-site: duty needed at each site separately.
  const siteSettings = { ...settings, sites: ['Main', 'Branch'] };
  const partnerB = newStaff({ id: 'p2', name: 'Dr Branch', employmentType: 'partner', site: 'Branch' });
  partner.site = 'Main';
  w = checkWeek({
    dates,
    staff: [partner, partnerB],
    leaveList: [],
    settings: siteSettings,
    entries: [
      e('p1', '2026-06-08', 'am', 'duty'),
      e('p2', '2026-06-08', 'am', 'surgery'),
      e('p1', '2026-06-08', 'pm', 'duty'),
      e('p2', '2026-06-08', 'pm', 'duty'),
    ],
  });
  const siteDuty = w.filter((x) => x.kind === 'duty');
  assert.equal(siteDuty.length, 1); // Branch AM uncovered
  assert.ok(/Branch/.test(siteDuty[0].message));
  partner.site = '';

  // Enhanced access without a GP on it -> warning; with a GP -> none.
  const anp = newStaff({ id: 'a1', name: 'ANP Ann', role: 'anp', dutyEligible: false });
  w = checkWeek({
    dates,
    staff: [anp, partner],
    leaveList: [],
    settings,
    entries: [
      e('a1', '2026-06-08', 'am', 'enhanced'),
      e('p1', '2026-06-08', 'am', 'duty'),
      e('p1', '2026-06-08', 'pm', 'duty'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'enhanced').length, 1);
  w = checkWeek({
    dates,
    staff: [anp, partner],
    leaveList: [],
    settings,
    entries: [
      e('a1', '2026-06-08', 'am', 'enhanced'),
      e('p1', '2026-06-08', 'am', 'enhanced'),
      e('p1', '2026-06-08', 'pm', 'duty'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'enhanced').length, 0);

  // Registrar rostered clinically on their immovable VTS half-day.
  const regVts = newStaff({
    id: 'rv',
    name: 'Dr Vts',
    employmentType: 'registrar',
    registrarStage: 'ST2',
    dutyEligible: false,
    vtsDay: 'mon-am',
  });
  w = checkWeek({
    dates,
    staff: [regVts, partner],
    leaveList: [],
    settings,
    entries: [
      e('rv', '2026-06-08', 'am', 'surgery'),
      e('p1', '2026-06-08', 'am', 'duty'),
      e('p1', '2026-06-08', 'pm', 'duty'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'vts').length, 1);

  // Registrar capacity weighting: ST2 counts 0.5, ST3 0.75.
  const capReg = capacitySummary({
    dates,
    staff: [partner, regVts],
    leaveList: [],
    settings,
    entries: [e('p1', '2026-06-08', 'am', 'surgery'), e('rv', '2026-06-08', 'am', 'surgery')],
  });
  assert.equal(capReg.gpClinicalSessions, 1.5);
  assert.equal(capReg.estimated, 23); // 1.5 × 15, rounded

  // Capacity: 1 GP clinical session × 15 appts vs 2,000-patient list target 144.
  const cap = capacitySummary({
    dates,
    entries: [e('p1', '2026-06-08', 'am', 'surgery')],
    staff: [partner],
    leaveList: [],
    settings,
  });
  assert.equal(cap.gpClinicalSessions, 1);
  assert.equal(cap.estimated, 15);
  assert.equal(cap.target, 144);

  // Fairness: a 4-session GP doing 3x the duties of an 8-session GP is
  // well above 1.5x the practice mean share and gets flagged.
  const gpBig = newStaff({ id: 'g8', name: 'Dr Eight', contractedSessions: 8 });
  const gpSmall = newStaff({ id: 'g4', name: 'Dr Four', contractedSessions: 4 });
  const hist = [
    e('g8', '2026-06-01', 'am', 'duty'),
    e('g4', '2026-06-01', 'pm', 'duty'),
    e('g4', '2026-06-02', 'pm', 'duty'),
    e('g4', '2026-06-03', 'pm', 'duty'),
  ];
  const fair = dutyFairness({ entries: hist, staff: [gpBig, gpSmall] });
  assert.equal(fair.flagged.length, 1);
  assert.equal(fair.flagged[0].staffId, 'g4');

  // Enhanced access periods: eaSummary counts EARLY (60) + EVE (90) minutes
  // vs the 60/1,000/week DES target; null when extended periods are off.
  assert.equal(eaSummary({ dates, entries: [], staff: [], leaveList: [], settings }), null);
  const eaSettings = { ...settings, listSize: 10000, extraPeriods: { early: true, eve: true } };
  const ea = eaSummary({
    dates,
    staff: [partner],
    leaveList: [],
    settings: eaSettings,
    entries: [
      e('p1', '2026-06-08', 'early', 'enhanced'),
      e('p1', '2026-06-08', 'eve', 'enhanced'),
      e('p1', '2026-06-09', 'eve', 'enhanced'),
    ],
  });
  assert.equal(ea.minutes, 60 + 90 + 90);
  assert.equal(ea.target, 600);

  // Extended-access slot running with no GP -> warning; duty never required there.
  w = checkWeek({
    dates,
    staff: [hca, partner],
    leaveList: [],
    settings: eaSettings,
    entries: [
      e('h1', '2026-06-08', 'eve', 'enhanced'),
      e('p1', '2026-06-08', 'am', 'duty'),
      e('p1', '2026-06-08', 'pm', 'duty'),
    ],
  });
  assert.equal(w.filter((x) => x.kind === 'enhanced' && x.period === 'eve').length, 1);
  assert.equal(w.filter((x) => x.kind === 'duty').length, 0);

  // WTD: a salaried GP rostered 12 core sessions (50h) gets the over-cap
  // warning; a partner with the same load does not (self-employed).
  const heavy = newStaff({ id: 'hv', name: 'Dr Heavy', employmentType: 'salaried' });
  const heavyPartner = newStaff({ id: 'hp', name: 'Dr Partner Heavy', employmentType: 'partner' });
  const heavyEntries = [];
  for (const d of ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13']) {
    for (const period of ['am', 'pm']) {
      heavyEntries.push(e('hv', d, period, 'surgery'));
      heavyEntries.push(e('hp', d, period, 'surgery'));
    }
  }
  w = checkWeek({
    dates,
    entries: heavyEntries,
    staff: [heavy, heavyPartner],
    leaveList: [],
    settings: { ...settings, dutyRequired: { am: 0, pm: 0 } },
  });
  const wtd = w.filter((x) => x.kind === 'wtd');
  assert.equal(wtd.length, 1);
  assert.equal(wtd[0].staffId, 'hv');
  assert.ok(/50\.0h/.test(wtd[0].message));

  // Seven days rostered -> no-rest-day warning even under the hours cap.
  const sevenDays = [
    '2026-06-08',
    '2026-06-09',
    '2026-06-10',
    '2026-06-11',
    '2026-06-12',
    '2026-06-13',
    '2026-06-14',
  ].map((d) => e('hv', d, 'am', 'surgery'));
  w = checkWeek({
    dates,
    entries: sevenDays,
    staff: [heavy],
    leaveList: [],
    settings: { ...settings, dutyRequired: { am: 0, pm: 0 } },
  });
  assert.ok(w.some((x) => x.kind === 'wtd' && /seven days/.test(x.message)));

  console.log('test-rules: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
