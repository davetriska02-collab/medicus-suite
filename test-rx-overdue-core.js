// Medicus Suite — Rx list overdue-monitoring selectors
'use strict';

const O = require('./shared/rx-overdue-core.js');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

console.log('--- selectMonitoringOverdue ---');
{
  check(O.selectMonitoringOverdue(null) === null, 'null chips -> null');
  check(O.selectMonitoringOverdue([]) === null, 'empty chips -> null');
  check(
    O.selectMonitoringOverdue([{ type: 'drug-monitoring', status: 'in_date', drugName: 'MTX' }]) === null,
    'in_date monitoring is not overdue'
  );
  check(
    O.selectMonitoringOverdue([{ type: 'drug-monitoring', status: 'due_soon', drugName: 'MTX' }]) === null,
    'due_soon is not overdue'
  );
  const overdue = O.selectMonitoringOverdue([
    { type: 'drug-monitoring', status: 'overdue', drugName: 'Methotrexate', tests: [] },
    { type: 'drug-monitoring', status: 'no_data', drugName: 'Lithium', tests: [{ name: 'Li', status: 'no_data' }] },
  ]);
  check(overdue && overdue.count === 2 && overdue.level === 'red', 'overdue + no_data count as monitoring overdue');
  check(overdue.items[1].detail.indexOf('Li') !== -1, 'no_data names the missing test');
}

console.log('--- selectQofOverdue ---');
{
  check(
    O.selectQofOverdue([{ type: 'qof-indicator', status: 'achieved', indicatorName: 'DM007' }]) === null,
    'achieved QOF is not overdue'
  );
  check(
    O.selectQofOverdue([{ type: 'qof-indicator', status: 'no_data', indicatorName: 'DM007' }]) === null,
    'QOF no_data is not treated as overdue'
  );
  const qof = O.selectQofOverdue([
    { type: 'qof-indicator', status: 'not_met', indicatorName: 'HbA1c control', indicatorCode: 'DM007' },
  ]);
  check(qof && qof.count === 1 && qof.items[0].name === 'HbA1c control', 'not_met QOF is overdue');
}

console.log('--- selectOverdue / labels ---');
{
  const mixed = O.selectOverdue([
    { type: 'drug-monitoring', status: 'stale', drugName: 'Warfarin' },
    { type: 'qof-indicator', status: 'not_met', indicatorName: 'BP' },
    { type: 'vaccine', status: 'overdue', label: 'flu' },
  ]);
  check(O.hasOverdue(mixed) === true, 'mixed findings are overdue');
  check(mixed.monitoring && mixed.monitoring.count === 1, 'monitoring group isolated');
  check(mixed.qof && mixed.qof.count === 1, 'QOF group isolated');
  check(O.buttonLabel('monitoring', 1) === 'Monitoring', 'single monitoring label');
  check(O.buttonLabel('monitoring', 3) === 'Monitoring ×3', 'counted monitoring label');
  check(O.buttonLabel('qof', 1) === 'QOF', 'single QOF label');
  check(O.scanIdleLabel() === 'Check for overdue monitoring', 'idle copy');
  check(O.scanDoneLabel(4, 80) === '4 with overdue', 'done with flags');
  check(O.scanDoneLabel(0, 80) === 'Scan finished', 'zero flags is not an all-clear');
  check(!/all clear|none overdue|nothing overdue/i.test(O.scanDoneLabel(0, 10)), 'done copy never claims all-clear');
}

console.log('--- canvas / scan source locks ---');
{
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/rx-allocate-canvas.js'), 'utf8');
  const scan = fs.readFileSync(path.join(__dirname, 'content-scripts/rx-overdue-scan.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(/ms-rxac-launch-wrap/.test(canvas), 'share-out launcher lives in a wrap next to the overdue button');
  check(/register\('rx-overdue-scan'/.test(scan), 'overdue scan registers with InjectorRuntime');
  check(/parseRxQueueRoute/.test(scan), 'overdue scan is gated to Rx task-lists');
  check(/Check for overdue monitoring/.test(scan), 'button copy matches the idle label');
  check(/SentinelRules/.test(scan) && /evaluatePatient/.test(scan), 'scan uses the Sentinel engine');
  check(/qof-rules\.json/.test(scan) && /drug-rules\.json/.test(scan), 'scan loads drug + QOF rules');
  check(/_scanGen/.test(scan), 'leaving the list aborts an in-flight scan');
  check(!/method:\s*['"]POST['"]/.test(scan), 'scan never POSTs');
  check(
    manifest.indexOf('shared/rx-overdue-core.js') < manifest.indexOf('content-scripts/rx-overdue-scan.js'),
    'core loads before the scan'
  );
  check(
    manifest.indexOf('content-scripts/rx-allocate-canvas.js') < manifest.indexOf('content-scripts/rx-overdue-scan.js'),
    'share-out canvas registers before the overdue button'
  );
  const hud = fs.readFileSync(path.join(__dirname, 'content-scripts/triage-lens/content.js'), 'utf8');
  check(/ms-rx-od/.test(hud), 'queue observer treats overdue buttons as own writes');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
