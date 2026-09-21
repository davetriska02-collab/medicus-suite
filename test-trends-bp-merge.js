// Medicus Suite — Trends buildBpModel multi-row merge regression tests
// Run with: node test-trends-bp-merge.js
//
// Guards the 2026-09-21 live-consult fix (v3.264.3): buildBpModel used
// history.find() — FIRST BP-matching observationHistory row only — so a
// reading recorded under a second display name ("O/E - blood pressure
// reading" vs the synthesised "Blood pressure" row, or a journal-coded row)
// silently never rendered. It must now merge readings from ALL BP-matching
// rows, de-duplicated by date with the first row (the synthesised dashboard
// row) authoritative.
//
// buildBpModel lives inside an ES module that imports browser-context
// dependencies, so — like test-clinical-thresholds-sync.js — the function is
// extracted from source and evaluated with stubs, rather than imported.

'use strict';
const fs = require('fs');
const path = require('path');
const JO = require('./shared/journal-observations.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── extract buildBpModel + name constants from trends.js source ──────────────
const trendsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8');

const bpNamesM = trendsSrc.match(/const BP_NAMES = \[[^\]]*\];/);
const acrNamesM = trendsSrc.match(/const ACR_NAMES = \[[^\]]*\];/);
const fnM = trendsSrc.match(/function buildBpModel\([\s\S]*?\n\}/);
check(!!bpNamesM, 'BP_NAMES extracted from trends.js');
check(!!acrNamesM, 'ACR_NAMES extracted from trends.js');
check(!!fnM, 'buildBpModel extracted from trends.js');
if (!bpNamesM || !acrNamesM || !fnM) {
  console.error('FATAL: source extraction failed — cannot continue');
  process.exitCode = 1;
  return;
}

// Same parseBp as side-panel/modules/shared/trend-chart.js.
function parseBp(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  return m ? { systolic: +m[1], diastolic: +m[2] } : null;
}

const buildBpModel = new Function(
  'parseBp',
  'bpTarget',
  'computeAge',
  `'use strict';\n${bpNamesM[0]}\n${acrNamesM[0]}\n${fnM[0]}\nreturn buildBpModel;`
)(
  parseBp,
  () => null, // bpTarget stub — target logic is out of scope here
  () => null // computeAge stub
);

function hist(name, points) {
  return { name, code: null, group: null, unit: 'mmHg', history: points };
}
const pt = (date, rawValue) => ({ date, value: NaN, rawValue, isAbove: false, isBelow: false, source: 'test' });

console.log('\n--- readings merge across ALL BP-matching rows ---');
{
  const data = {
    observationHistory: [
      hist('Blood pressure', [pt('2026-04-27', '146/82'), pt('2026-01-10', '150/90')]),
      hist('O/E - blood pressure reading', [pt('2026-09-21', '119/86')]),
    ],
  };
  const m = buildBpModel(data);
  check(m.pairs.length === 3, `all three readings render (got ${m.pairs.length}) — the live consult missed the third`);
  const latest = m.pairs[m.pairs.length - 1];
  check(
    latest.date === '2026-09-21' && latest.bp.systolic === 119 && latest.bp.diastolic === 86,
    'the same-day 119/86 under the second display name is now the LATEST reading'
  );
  check(
    m.pairs.every((p, i) => i === 0 || m.pairs[i - 1].date <= p.date),
    'pairs stay oldest-first (chart contract unchanged)'
  );
}

console.log('\n--- de-dupe + non-pair rows ---');
{
  const data = {
    observationHistory: [
      hist('Blood pressure', [pt('2026-04-27', '146/82')]),
      hist('O/E - blood pressure reading', [pt('2026-04-27', '999/99'), pt('2026-09-21', '119/86')]),
      hist('Systolic blood pressure', [pt('2026-04-27', '146')]), // substring-matches BP_NAMES but is not a pair
    ],
  };
  const m = buildBpModel(data);
  check(m.pairs.length === 2, 'same-date readings de-dupe to one');
  check(
    m.pairs[0].bp.systolic === 146 && m.pairs[0].bp.diastolic === 82,
    'on a date collision the FIRST row (synthesised dashboard row) wins'
  );
  check(
    m.pairs.map((p) => p.date).join(',') === '2026-04-27,2026-09-21',
    'bare systolic-only rows contribute nothing (parseBp rejects non-pairs)'
  );
}

console.log('\n--- single-row behaviour unchanged (regression) ---');
{
  const m = buildBpModel({
    observationHistory: [hist('Blood pressure', [pt('2026-04-27', '146/82'), pt('2026-01-10', '150/90')])],
  });
  check(m.pairs.length === 2, 'single synthesised row still yields all its readings');
  check(m.pairs[0].date === '2026-01-10' && m.pairs[1].date === '2026-04-27', 'oldest-first order preserved');
}

console.log('\n--- sys/dia fallback still works when no combined row parses ---');
{
  const m = buildBpModel({
    observationHistory: [
      hist('Systolic blood pressure', [pt('2026-04-27', '146')]),
      hist('Diastolic blood pressure', [pt('2026-04-27', '82')]),
    ],
  });
  check(
    m.pairs.length === 1 && m.pairs[0].bp.systolic === 146 && m.pairs[0].bp.diastolic === 82,
    'separate sys/dia rows still pair via the fallback path'
  );
}

console.log('\n--- end-to-end: journal BP merged into history renders in Trends ---');
{
  const dashboardHistory = [hist('Blood pressure', [pt('2026-04-27', '146/82')])];
  const journalObs = [{ name: 'Blood pressure', value: '119/86', date: '2026-09-21', source: 'journal' }];
  const merged = JO.mergeJournalObsIntoHistory(dashboardHistory, journalObs);
  const m = buildBpModel({ observationHistory: merged });
  check(m.pairs.length === 2, 'journal-coded BP reaches the BP chart via mergeJournalObsIntoHistory');
  const latest = m.pairs[m.pairs.length - 1];
  check(
    latest.date === '2026-09-21' && latest.bp.systolic === 119,
    'the live-consult 119/86 is the latest rendered reading'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
