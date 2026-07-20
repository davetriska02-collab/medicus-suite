// Medicus Suite — Patient Alerts shared-lookup tests + core-parity guard
// Run with: node test-patient-alerts-lookup.js
//
// shared/patient-alerts-lookup.js re-implements the READ side of
// side-panel/modules/patient-alerts/patient-alerts-core.js for classic-world
// content scripts (the on-page banner + queue flag chips), which cannot import
// ES modules. This file tests the shared lookup directly AND asserts parity
// with the core on shared fixtures, so the two implementations cannot drift
// silently (wrong-patient safety depends on identical matching rules).

'use strict';

const path = require('path');
const LK = require('./shared/patient-alerts-lookup.js');

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

  const corePath = new URL(
    'side-panel/modules/patient-alerts/patient-alerts-core.js',
    `file://${path.resolve(__dirname)}/`
  ).href;
  const core = await import(corePath);

  const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
  // Modulus-11 INVALID by construction (real check digit is 9) — synthetic,
  // ignored by scripts/check-no-patient-data.js.
  const NHS = '9434765911';
  const mk = (id, label, severity) => ({
    id,
    typeId: null,
    label,
    severity,
    note: '',
    createdAt: '2026-07-18T10:00:00Z',
    updatedAt: '2026-07-18T10:00:00Z',
  });
  const store = {
    [UUID_A]: {
      patient: { name: 'Ann Test', nhsNumber: NHS, dob: '01 Jan 1980' },
      alerts: [mk('pa-1', 'B interpreter', 'amber'), mk('pa-2', 'A safeguarding', 'red'), { id: '', label: 'corrupt' }],
      updatedAt: '2026-07-18T10:00:00Z',
    },
  };

  console.log('\n--- shared lookup behaviour ---');
  const byUuid = LK.findEntry(store, { patientUuid: UUID_A });
  check(byUuid && byUuid.key === UUID_A, 'findEntry matches by UUID');
  const byNhs = LK.findEntry(store, { nhsNumber: '943 476 5911' });
  check(byNhs && byNhs.key === UUID_A, 'findEntry falls back to normalised NHS');
  check(LK.findEntry(store, { patientUuid: 'bbbbbbbb-0000' }) === null, 'wrong UUID never matches');
  check(LK.findEntry(store, {}) === null, 'no identity matches nothing');
  check(LK.findEntry(null, { patientUuid: UUID_A }) === null, 'null store matches nothing');

  const summary = LK.summariseFlags(store[UUID_A].alerts);
  check(summary && summary.topLabel === 'A safeguarding', 'summariseFlags leads with the most severe flag');
  check(summary.severity === 'red' && summary.count === 2 && summary.more === 1, 'summary counts skip corrupt entries');
  check(LK.summariseFlags([]) === null, 'no flags → null (renders nothing, never an empty chip)');
  check(LK.summariseFlags([{ id: 'x', label: '  ', severity: 'red' }]) === null, 'corrupt-only list → null');

  console.log('\n--- parity with patient-alerts-core.js (drift guard) ---');
  check(LK.normaliseNhs('943-476-5911') === core.normaliseNhs('943-476-5911'), 'normaliseNhs agrees (valid shape)');
  check(LK.normaliseNhs('12345') === core.normaliseNhs('12345'), 'normaliseNhs agrees (reject)');
  check(LK.normaliseNhs(null) === core.normaliseNhs(null), 'normaliseNhs agrees (null)');

  const idSets = [
    { patientUuid: UUID_A },
    { nhsNumber: NHS },
    { nhsNumber: '943 476 5911' },
    { patientUuid: 'bbbbbbbb-1111-2222-3333-444444444444' },
    { patientName: 'Ann Test' }, // name alone must match in NEITHER implementation
    {},
    null,
  ];
  for (const ids of idSets) {
    const a = LK.findEntry(store, ids);
    const b = core.findEntryForPatient(store, ids);
    check((a === null && b === null) || (a && b && a.key === b.key), `findEntry parity for ${JSON.stringify(ids)}`);
  }

  const alertSets = [store[UUID_A].alerts, [], [mk('x', 'Only info', 'info')], [{ bad: true }]];
  for (const alerts of alertSets) {
    const a = LK.sortAlerts(alerts).map((x) => x.id);
    const b = core.sortAlerts(alerts).map((x) => x.id);
    check(JSON.stringify(a) === JSON.stringify(b), `sortAlerts parity (${alerts.length} in)`);
    check(LK.maxSeverity(alerts) === core.maxSeverity(alerts), `maxSeverity parity (${alerts.length} in)`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
