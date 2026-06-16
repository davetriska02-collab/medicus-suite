// Medicus Suite — Practice Report profiles + renderer tests
// Run with: node test-practice-report-render.js
//
// Locks two things that matter:
//  1. SAFETY: the Staff and ICB profiles can never leak per-clinician data
//     (Goodhart's law / morale) — applyProfile strips it and the rendered HTML
//     must not contain an individual clinician's name.
//  2. Section gating per profile, and the CSV shape.

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

  const base = `file://${path.resolve(__dirname)}/`;
  const profiles = await import(new URL('side-panel/modules/condor/report/report-profiles.js', base).href);
  const render = await import(new URL('side-panel/modules/condor/report/report-render.js', base).href);

  const rawReport = () => ({
    siteId: 'a1b2c3',
    range: { preset: '7d', start: '2026-06-10', end: '2026-06-16', days: 7, label: 'Last 7 days' },
    generatedAt: '2026-06-16T11:02:00.000Z',
    demand: {
      byDay: [
        { date: '2026-06-15', medical: 5, admin: 3, investigation: 0, rxRoutine: 1, rxNonRoutine: 0, all: 9 },
        { date: '2026-06-16', medical: 7, admin: 2, investigation: 1, rxRoutine: 0, rxNonRoutine: 0, all: 10 },
      ],
      summary: {
        totals: { all: 19, medical: 12, admin: 5, investigation: 1, rxRoutine: 1, rxNonRoutine: 0 },
        dailyMean: 9.5,
        peak: { date: '2026-06-16', value: 10 },
        days: 2,
      },
    },
    capacity: {
      byDay: [
        { date: '2026-06-15', slots: 40, sessions: 5 },
        { date: '2026-06-16', slots: 50, sessions: 6 },
      ],
    },
    activity: {
      totals: { consultations: 120, all: 140 },
      users: [
        { name: 'Dr Penelope Quirke', total: 80 },
        { name: 'Dr Aldous', total: 60 },
      ],
    },
    referrals: {
      byPriority: { Routine: 20, Urgent: 5, TwoWeekWait: 3 },
      byStatus: { Completed: 18, Incomplete: 10 },
      byClinician: [{ name: 'Dr Penelope Quirke', count: 12 }],
      total: 28,
    },
    currentSnapshot: {
      date: '2026-06-16',
      ppi: 67,
      band: 'AMBER',
      demand: 151,
      slotsRemaining: 50,
      waitingArrived: 4,
      urgent: 2,
    },
    snapshotHistory: [
      { date: '2026-06-14', ppi: 30, demand: 120 },
      { date: '2026-06-15', ppi: 45, demand: 140 },
      { date: '2026-06-16', ppi: 67, demand: 151 },
    ],
    errors: [],
  });

  const UNIQUE_NAME = 'Dr Penelope Quirke'; // appears only in per-clinician collections

  // ── Management: full detail, per-clinician present ──────────────────────────
  console.log('--- management profile ---');
  let applied = profiles.applyProfile(rawReport(), profiles.getProfile('management'));
  check(profiles.containsPerClinician(applied), 'management keeps per-clinician data');
  let html = render.buildReportHtml(applied);
  check(html.includes(UNIQUE_NAME), 'management report shows the clinician name');
  check(html.includes('Current snapshot'), 'management includes current snapshot');

  // ── Staff: AGGREGATE ONLY — no individual can leak ──────────────────────────
  console.log('\n--- staff profile (aggregate-only safety) ---');
  applied = profiles.applyProfile(rawReport(), profiles.getProfile('staff'));
  check(!profiles.containsPerClinician(applied), 'staff: applyProfile strips all per-clinician data');
  html = render.buildReportHtml(applied);
  check(!html.includes(UNIQUE_NAME), 'staff report HTML contains NO clinician name (the core safety rule)');
  check(html.includes('whole practice') || html.includes('omitted'), 'staff report states figures are practice-wide');
  check(html.includes('Activity'), 'staff still shows aggregate activity totals');
  check(!html.includes('Referrals'), 'staff omits the referrals section by profile');

  // ── ICB: practice-level, no per-clinician, no current snapshot ──────────────
  console.log('\n--- icb profile ---');
  applied = profiles.applyProfile(rawReport(), profiles.getProfile('icb'));
  check(!profiles.containsPerClinician(applied), 'icb: no per-clinician data');
  html = render.buildReportHtml(applied);
  check(!html.includes(UNIQUE_NAME), 'icb report HTML contains no clinician name');
  check(!html.includes('Current snapshot'), 'icb omits the live current-snapshot section');
  check(html.includes('Urgent suspected cancer'), 'icb uses NHS-correct 2WW/FDS terminology for referrals');

  // ── Renderer details ────────────────────────────────────────────────────────
  console.log('\n--- renderer details ---');
  check(render.esc('<b>&"x</b>') === '&lt;b&gt;&amp;&quot;x&lt;/b&gt;', 'esc escapes HTML/entities');
  check(render.sparkline([1, 2, 3, 4]).startsWith('<svg'), 'sparkline renders an SVG for >=2 points');
  check(render.sparkline([1]) === '', 'sparkline empty for <2 points');
  // ── CSV export (multi-section, profile-aware) ───────────────────────────────
  console.log('\n--- CSV export ---');
  const mgmtCsv = render.buildReportCsv(profiles.applyProfile(rawReport(), profiles.getProfile('management')));
  check(Array.isArray(mgmtCsv.sections) && mgmtCsv.sections.length > 0, 'CSV returns a sections array');
  const demandSec = mgmtCsv.sections.find((s) => /demand/i.test(s.title));
  check(
    demandSec && demandSec.header[0] === 'date' && demandSec.header.includes('demand_total'),
    'CSV has a demand-by-day section with date + demand_total'
  );
  check(
    demandSec.rows.length === 2 && demandSec.rows[0][demandSec.header.length - 1] === 9,
    'demand rows mirror the per-day series'
  );
  const mgmtActivity = mgmtCsv.sections.find((s) => /clinician/i.test(s.title));
  check(!!mgmtActivity, 'management CSV includes a per-clinician activity section');
  check(
    mgmtActivity.rows.some((row) => row.includes(UNIQUE_NAME)),
    'management CSV per-clinician section names the clinician'
  );
  // privacy: staff + icb CSV must contain NO per-clinician section and no clinician name
  for (const pid of ['staff', 'icb']) {
    const c = render.buildReportCsv(profiles.applyProfile(rawReport(), profiles.getProfile(pid)));
    check(!c.sections.some((s) => /clinician/i.test(s.title)), `${pid} CSV has NO per-clinician section`);
    check(!JSON.stringify(c.sections).includes(UNIQUE_NAME), `${pid} CSV contains no clinician name`);
  }

  // unknown profile id falls back
  check(profiles.getProfile('nope').id === profiles.DEFAULT_PROFILE_ID, 'unknown profile id falls back to default');

  console.log(`\n${passed} passed, ${failed} failed`);
})();
