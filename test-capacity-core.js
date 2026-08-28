// Medicus Suite — Capacity core logic tests
// Run with: node test-capacity-core.js

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;
  function check(cond, msg) {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  }

  const corePath = new URL('side-panel/modules/capacity/capacity-core.js', `file://${path.resolve(__dirname)}/`).href;

  const {
    DOW_KEYS,
    WEEKDAYS,
    minimumForDate,
    defaultMinimumByDay,
    presetSummary,
    validatePreset,
    normaliseLookahead,
    validateLookahead,
    effectiveMinimumForDate,
    upliftKindForBlock,
    scanHorizon,
    scanTone,
    filterAtRisk,
    lookAheadSentence,
    riskStatusesFor,
    addDaysISO,
    DEFAULT_LOOKAHEAD,
  } = await import(corePath);

  console.log('--- constants ---');
  check(DOW_KEYS[0] === 'sun' && DOW_KEYS[6] === 'sat', 'DOW_KEYS is Sunday-indexed');
  check(WEEKDAYS.length === 7 && WEEKDAYS[0].key === 'mon', 'WEEKDAYS is Monday-first, 7 days');

  console.log('\n--- minimumForDate ---');
  const presetByDay = { minimumByDay: { mon: 25, tue: 20, wed: 20, thu: 20, fri: 18, sat: 5, sun: 0 } };
  check(minimumForDate(presetByDay, '2026-06-15') === 25, 'minimumByDay: Monday → 25');
  check(minimumForDate(presetByDay, '2026-06-13') === 5, 'minimumByDay: Saturday → 5');
  check(minimumForDate(presetByDay, '2026-06-14') === 0, 'minimumByDay: Sunday → 0');
  check(minimumForDate(null, '2026-06-15') === 0, 'null preset → 0');

  const presetZeroFri = {
    minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 0, sat: 0, sun: 0 },
    minimumPerDay: 30,
  };
  check(minimumForDate(presetZeroFri, '2026-06-19') === 0, 'explicit 0 on a weekday is honoured');

  const legacy = { minimumPerDay: 30 };
  check(minimumForDate(legacy, '2026-06-15') === 30, 'legacy: weekday → minimumPerDay');
  check(minimumForDate(legacy, '2026-06-13') === 0, 'legacy: Saturday → 0');

  console.log('\n--- defaultMinimumByDay / presetSummary / validatePreset ---');
  const d = defaultMinimumByDay(20);
  check(d.mon === 20 && d.sat === 0, 'defaultMinimumByDay weekdays/weekend');
  check(
    presetSummary({ minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 20, sat: 0, sun: 0 } }) ===
      'min 20/weekday',
    'uniform weekdays summary'
  );
  check(validatePreset({ name: 'Std', slotTypes: ['GP'], tight: 75, low: 50 }).valid, 'valid preset');
  check(!validatePreset({ name: ' ', slotTypes: ['GP'], tight: 75, low: 50 }).valid, 'blank name rejected');

  console.log('\n--- lookahead config ---');
  const la = normaliseLookahead({});
  check(la.horizonDays === DEFAULT_LOOKAHEAD.horizonDays, 'default horizon 28');
  check(la.singleBhUplift === 1.25 && la.xmasBlockUplift === 1.4, 'default uplifts');
  check(riskStatusesFor(la).join(',') === 'critical,low', 'default risk statuses exclude tight');
  check(riskStatusesFor({ includeTight: true }).includes('tight'), 'includeTight adds tight');
  check(validateLookahead({ horizonDays: 3 }).valid === false, 'horizon < 7 rejected');
  check(validateLookahead({ horizonDays: 28, singleBhUplift: 1.2 }).valid === true, 'valid lookahead');

  console.log('\n--- post-BH uplift ---');
  const preset = {
    name: 'GP',
    slotTypes: ['GP'],
    minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 20, sat: 0, sun: 0 },
    thresholds: { tight: 75, low: 50 },
  };
  const postSpring = effectiveMinimumForDate(preset, '2026-05-26', la);
  check(postSpring.upliftKind === 'single', 'Tue after Spring BH → single uplift kind');
  check(postSpring.effective === 25, '20 × 1.25 → 25');
  check(postSpring.upliftApplied === true, 'upliftApplied true');

  const normalWed = effectiveMinimumForDate(preset, '2026-05-27', la);
  check(normalWed.effective === 20 && !normalWed.upliftApplied, 'normal Wed no uplift');

  const postXmas = effectiveMinimumForDate(preset, '2026-12-29', la);
  check(postXmas.upliftKind === 'xmas' && postXmas.effective === 28, 'post-Xmas ×1.4 → 28');

  const postEaster = effectiveMinimumForDate(preset, '2026-04-07', la);
  check(postEaster.upliftKind === 'easter', 'Tue after Easter block → easter');
  check(Math.round(20 * 1.35) === postEaster.effective, 'easter uplift applied');

  const bhDay = effectiveMinimumForDate(preset, '2026-05-25', la);
  check(bhDay.isBankHoliday === true, 'BH Monday flagged');

  const off = effectiveMinimumForDate(preset, '2026-05-26', { ...la, upliftEnabled: false });
  check(off.effective === 20 && !off.upliftApplied, 'uplift can be disabled');

  check(
    upliftKindForBlock({
      bankHolidays: ['2026-12-25', '2026-12-28'],
      closedDays: 4,
    }) === 'xmas',
    'upliftKindForBlock xmas'
  );

  console.log('\n--- scanHorizon / at-risk ---');
  // Scan runs from the Monday BH; the Tuesday carries the post-BH uplift.
  const dataByDate = {
    '2026-05-25': { total: 0, sessionsCount: 0, byType: {}, byStaff: [] }, // BH — closed
    '2026-05-26': { total: 10, sessionsCount: 4, byType: {}, byStaff: [] }, // 10/25 = 40% → critical
    '2026-05-27': { total: 25, sessionsCount: 4, byType: {}, byStaff: [] }, // sufficient
    '2026-05-28': { total: 14, sessionsCount: 4, byType: {}, byStaff: [] }, // 14/20 = 70% → low
    '2026-05-29': { total: 25, sessionsCount: 4, byType: {}, byStaff: [] }, // sufficient
  };
  const scan = scanHorizon({
    preset,
    dataByDate,
    fromISO: '2026-05-25',
    today: '2026-05-25',
    lookahead: { ...la, horizonDays: 5 },
  });
  check(scan.atRisk.length === 2, `at-risk includes depleted days (got ${scan.atRisk.length})`);
  check(scan.atRisk[0].status === 'critical', 'worst day sorts first (critical)');
  check(scan.summary.critical === 1 && scan.summary.low === 1, 'summary counts critical + low');
  check(
    scan.atRisk.some((d) => d.minInfo.upliftApplied),
    'post-BH day appears in at-risk with uplift'
  );

  const sentence = lookAheadSentence(scan.summary, 'GP Routine');
  check(sentence.includes('at risk') && sentence.includes('GP Routine'), 'lookAheadSentence names preset');
  check(sentence.includes('Critical'), 'worst status is sentence-case in prose');

  // Today is remaining-slots-only against a whole-day target, so it must never
  // be counted as at risk — otherwise every afternoon reads as critical.
  const todayScan = scanHorizon({
    preset,
    dataByDate: { '2026-05-26': { total: 2, sessionsCount: 5, byType: {}, byStaff: [] } },
    fromISO: '2026-05-26',
    today: '2026-05-26',
    lookahead: { ...la, horizonDays: 1 },
  });
  check(todayScan.atRisk.length === 0, 'today is excluded from at-risk (remaining vs whole-day target)');

  // Saturday enhanced-access clinics are not "working days" by the bank-holiday
  // calendar but still carry a minimum, so they must be scannable.
  const satPreset = {
    ...preset,
    minimumByDay: { ...preset.minimumByDay, sat: 15 },
  };
  const satScan = scanHorizon({
    preset: satPreset,
    dataByDate: { '2026-09-05': { total: 1, sessionsCount: 3, byType: {}, byStaff: [] } },
    fromISO: '2026-09-01',
    today: '2026-09-01',
    lookahead: { ...la, horizonDays: 7 },
  });
  check(
    satScan.atRisk.some((d) => d.dateISO === '2026-09-05'),
    'Saturday with a minimum can be at risk'
  );

  console.log('\n--- coverage honesty (never a false all-clear) ---');
  const blind = scanHorizon({
    preset,
    dataByDate: {},
    fromISO: '2026-09-01',
    today: '2026-09-01',
    lookahead: { ...la, horizonDays: 28 },
  });
  check(blind.summary.atRiskCount === 0, 'no data → nothing flagged');
  check(blind.summary.complete === false, 'no data → scan is not complete');
  check(scanTone(blind.summary) === 'unknown', 'no data → tone is unknown, NOT green');
  check(
    !/No days at risk/.test(lookAheadSentence(blind.summary, 'GP')),
    'no data → sentence does not claim "no days at risk"'
  );
  check(/Couldn’t check/.test(lookAheadSentence(blind.summary, 'GP')), 'no data → sentence says it could not check');

  const partialData = {};
  for (let i = 1; i <= 3; i++) {
    partialData[addDaysISO('2026-09-01', i)] = { total: 99, sessionsCount: 5, byType: {}, byStaff: [] };
  }
  const partial = scanHorizon({
    preset,
    dataByDate: partialData,
    fromISO: '2026-09-01',
    today: '2026-09-01',
    lookahead: { ...la, horizonDays: 28 },
  });
  check(partial.summary.complete === false, 'partial data → not complete');
  check(partial.summary.uncheckedDays > 0, 'partial data → uncheckedDays reported');
  check(scanTone(partial.summary) === 'unknown', 'partial healthy data → still unknown, not green');
  check(/still unchecked/.test(lookAheadSentence(partial.summary, 'GP')), 'partial data → sentence names the gap');

  const fullData = {};
  for (let i = 1; i < 8; i++) {
    fullData[addDaysISO('2026-09-01', i)] = { total: 99, sessionsCount: 5, byType: {}, byStaff: [] };
  }
  const full = scanHorizon({
    preset,
    dataByDate: fullData,
    fromISO: '2026-09-01',
    today: '2026-09-01',
    lookahead: { ...la, horizonDays: 8 },
  });
  check(full.summary.complete === true, 'every day read → complete');
  check(scanTone(full.summary) === 'green', 'complete + clear → green');
  check(/No days at risk/.test(lookAheadSentence(full.summary, 'GP')), 'complete + clear → all-clear sentence');

  console.log('\n--- holiday classification ---');
  check(
    effectiveMinimumForDate(preset, '2027-03-26', la).effective === 0,
    'a bank holiday carries no target (does not inflate the week)'
  );
  check(
    effectiveMinimumForDate(preset, '2028-01-04', la).upliftKind === 'xmas',
    'New Year substitute block classifies as Christmas, not a single BH'
  );
  check(
    effectiveMinimumForDate(preset, '2025-03-18', { ...la, division: 'northern-ireland' }).upliftKind !== 'easter',
    'St Patrick’s Day is not mistaken for Easter'
  );
  check(
    effectiveMinimumForDate(preset, '2026-05-26', la).upliftKind === 'single',
    'an ordinary May bank holiday stays a single'
  );

  console.log('\n--- hostile config ---');
  check(
    normaliseLookahead({ division: 'wales' }).division === 'england-and-wales',
    'unknown division falls back rather than throwing'
  );
  let threw = false;
  try {
    effectiveMinimumForDate(preset, '2026-09-02', { ...la, division: 'wales' });
  } catch (_) {
    threw = true;
  }
  check(!threw, 'a bad stored division cannot take down the tab');
  check(validateLookahead({ division: 'wales' }).valid === false, 'settings reject an unknown division');

  const clear = filterAtRisk(
    [{ dateISO: '2026-05-27', status: 'sufficient', minInfo: { countsForRisk: true } }],
    la,
    '2026-05-26'
  );
  check(clear.length === 0, 'sufficient days are not at risk');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
