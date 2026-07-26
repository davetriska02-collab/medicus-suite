// Medicus Suite — Patient Alerts core logic tests
// Run with: node test-patient-alerts-core.js
// Dynamic-imports patient-alerts-core.js (ES module).

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

  const corePath = new URL(
    'side-panel/modules/patient-alerts/patient-alerts-core.js',
    `file://${path.resolve(__dirname)}/`
  ).href;
  const {
    DEFAULT_ALERT_TYPES,
    SEVERITIES,
    countStore,
    findEntryForPatient,
    isValidAlert,
    makeAlert,
    maxSeverity,
    mergeStores,
    mergeTypes,
    normaliseNhs,
    patientKey,
    patientMeta,
    removeAlert,
    removePatient,
    sanitiseTypes,
    searchStore,
    sortAlerts,
    upsertAlert,
  } = await import(corePath);

  const NOW = '2026-07-18T10:00:00.000Z';
  const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
  const UUID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
  // 943 476 5911 is deliberately Modulus-11 INVALID (real check digit would be
  // 9): synthetic by construction, so scripts/check-no-patient-data.js ignores
  // it. normaliseNhs only checks length, so the tests are unaffected.
  const pcA = { patientUuid: UUID_A, patientName: 'Ann Test', nhsNumber: '943 476 5911', dobRaw: '01 Jan 1980' };

  console.log('\n--- normaliseNhs ---');
  check(normaliseNhs('943 476 5911') === '9434765911', 'strips spaces from a 10-digit NHS number');
  check(normaliseNhs('943-476-5911') === '9434765911', 'strips punctuation');
  check(normaliseNhs('12345') === null, 'rejects wrong-length numbers');
  check(normaliseNhs(null) === null, 'null in, null out');

  console.log('\n--- patientKey / patientMeta ---');
  check(patientKey(pcA) === UUID_A, 'patientUuid is the canonical key');
  check(patientKey({ patientName: 'No Id' }) === null, 'a name alone is never a key');
  check(patientKey(null) === null, 'null context has no key');
  const meta = patientMeta(pcA);
  check(meta.name === 'Ann Test' && meta.nhsNumber === '9434765911', 'meta denormalises name + normalised NHS');

  console.log('\n--- makeAlert / isValidAlert ---');
  const alert1 = makeAlert(
    { label: '  Interpreter required — Polish  ', severity: 'amber', note: 'Prefers written material too' },
    NOW
  );
  check(alert1.label === 'Interpreter required — Polish', 'label is trimmed');
  check(alert1.id && alert1.createdAt === NOW, 'alert gets an id and timestamps');
  check(isValidAlert(alert1), 'constructed alert validates');
  let threw = false;
  try {
    makeAlert({ label: '   ', severity: 'amber' }, NOW);
  } catch (_) {
    threw = true;
  }
  check(threw, 'blank label throws');
  threw = false;
  try {
    makeAlert({ label: 'x', severity: 'purple' }, NOW);
  } catch (_) {
    threw = true;
  }
  check(threw, 'invalid severity throws');
  threw = false;
  try {
    makeAlert({ label: 'No severity given' }, NOW);
  } catch (_) {
    threw = true;
  }
  check(threw, 'missing severity throws (no silent default)');

  console.log('\n--- attribution (H-042 audit trail) ---');
  const authored = makeAlert({ label: 'Interpreter required', severity: 'amber', author: '  Dr Dave Triska  ' }, NOW);
  check(
    authored.createdBy === 'Dr Dave Triska' && authored.updatedBy === 'Dr Dave Triska',
    'author is trimmed and stamped on createdBy/updatedBy'
  );
  const anon = makeAlert({ label: 'No author configured', severity: 'info' }, NOW);
  check(anon.createdBy === null && anon.updatedBy === null, 'no author → null, never a guessed identity');
  check(isValidAlert(anon), 'alerts without attribution remain valid (pre-attribution data)');
  let attrStore = upsertAlert({}, pcA, authored, NOW);
  const editedByOther = makeAlert(
    { label: 'Interpreter required — Ukrainian', severity: 'amber', author: 'Dr B Smith' },
    '2026-07-19T09:00:00.000Z',
    authored.id
  );
  attrStore = upsertAlert(attrStore, pcA, editedByOther, '2026-07-19T09:00:00.000Z');
  const afterEdit = attrStore[UUID_A].alerts.find((a) => a.id === authored.id);
  check(afterEdit.createdBy === 'Dr Dave Triska', 'edit preserves the ORIGINAL author (immutable provenance)');
  check(afterEdit.updatedBy === 'Dr B Smith', 'edit stamps the editing author on updatedBy');
  check(afterEdit.createdAt === NOW, 'edit preserves the original createdAt alongside createdBy');

  console.log('\n--- upsert / remove ---');
  let store = {};
  store = upsertAlert(store, pcA, alert1, NOW);
  check(store[UUID_A] && store[UUID_A].alerts.length === 1, 'upsert creates the patient entry');
  check(store[UUID_A].patient.nhsNumber === '9434765911', 'entry carries normalised patient meta');
  const alertRed = makeAlert({ label: 'Safeguarding concern', severity: 'red' }, NOW);
  store = upsertAlert(store, pcA, alertRed, NOW);
  check(store[UUID_A].alerts.length === 2, 'second alert appends');
  const edited = { ...alert1, label: 'Interpreter required — Ukrainian', updatedAt: NOW };
  store = upsertAlert(store, pcA, edited, '2026-07-18T11:00:00.000Z');
  check(store[UUID_A].alerts.length === 2, 'same-id upsert edits in place (no duplicate)');
  check(
    store[UUID_A].alerts.find((a) => a.id === alert1.id).label === 'Interpreter required — Ukrainian',
    'edited label persisted'
  );
  check(store[UUID_A].alerts.find((a) => a.id === alert1.id).createdAt === NOW, 'edit preserves original createdAt');
  threw = false;
  try {
    upsertAlert(store, { patientName: 'No Id' }, alertRed, NOW);
  } catch (_) {
    threw = true;
  }
  check(threw, 'upsert without a patient key throws');

  let store2 = removeAlert(store, UUID_A, alertRed.id, NOW);
  check(store2[UUID_A].alerts.length === 1, 'removeAlert drops one alert');
  store2 = removeAlert(store2, UUID_A, alert1.id, NOW);
  check(!(UUID_A in store2), 'removing the last alert drops the whole patient entry');
  check(store[UUID_A].alerts.length === 2, 'transforms are pure — original store untouched');
  check(!(UUID_A in removePatient(store, UUID_A)), 'removePatient drops the entry');

  console.log('\n--- lookup (wrong-patient safety) ---');
  const byUuid = findEntryForPatient(store, { patientUuid: UUID_A });
  check(byUuid && byUuid.key === UUID_A, 'lookup by UUID');
  const byNhs = findEntryForPatient(store, { nhsNumber: '9434765911' });
  check(byNhs && byNhs.key === UUID_A, 'NHS-number fallback lookup (no UUID on this view)');
  check(findEntryForPatient(store, { patientUuid: UUID_B }) === null, 'a different UUID never matches');
  check(findEntryForPatient(store, { patientName: 'Ann Test' }) === null, 'a name alone NEVER matches');
  check(findEntryForPatient(store, null) === null, 'null context matches nothing');

  console.log('\n--- sort / severity / counts / search ---');
  const mixed = [
    makeAlert({ label: 'B info', severity: 'info' }, NOW),
    makeAlert({ label: 'A red', severity: 'red' }, NOW),
    makeAlert({ label: 'C amber', severity: 'amber' }, NOW),
  ];
  const sorted = sortAlerts(mixed);
  check(sorted[0].severity === 'red' && sorted[2].severity === 'info', 'sortAlerts is most-severe-first');
  check(maxSeverity(mixed) === 'red', 'maxSeverity finds red');
  check(maxSeverity([mixed[0]]) === 'info', 'maxSeverity of info-only is info');
  check(maxSeverity([]) === null, 'maxSeverity of empty is null');
  const counts = countStore(store);
  check(counts.patients === 1 && counts.alerts === 2, 'countStore totals patients and alerts');
  check(searchStore(store, 'ukrainian').length === 1, 'search matches alert label');
  check(searchStore(store, '9434765911').length === 1, 'search matches NHS number');
  check(searchStore(store, 'zzz-nomatch').length === 0, 'search misses cleanly');
  check(searchStore(store, '').length === 1, 'empty query returns everything');

  console.log('\n--- palette ---');
  check(DEFAULT_ALERT_TYPES.length >= 5, 'ships a useful default palette');
  check(
    DEFAULT_ALERT_TYPES.every((t) => t.id && t.label && SEVERITIES.includes(t.severity)),
    'every default type is valid'
  );
  check(sanitiseTypes(null).length === DEFAULT_ALERT_TYPES.length, 'corrupt palette falls back to defaults');
  check(sanitiseTypes([]).length === DEFAULT_ALERT_TYPES.length, 'empty palette falls back to defaults');
  const custom = [{ id: 'x', label: 'Custom', severity: 'info' }];
  check(sanitiseTypes(custom).length === 1, 'a valid stored palette is kept as-is');
  const mergedTypes = mergeTypes(custom, [
    { id: 'x', label: 'Custom v2', severity: 'red' },
    { id: 'y', label: 'New', severity: 'amber' },
  ]);
  check(mergedTypes.length === 2, 'mergeTypes unions by id');
  check(mergedTypes.find((t) => t.id === 'x').label === 'Custom v2', 'incoming wins on same id');

  console.log('\n--- mergeStores (import semantics) ---');
  const local = upsertAlert({}, pcA, makeAlert({ label: 'Local only', severity: 'info' }, NOW), NOW);
  const incomingAlert = makeAlert({ label: 'From colleague', severity: 'red' }, NOW);
  const incoming = upsertAlert({}, { patientUuid: UUID_B, patientName: 'Bob Test' }, incomingAlert, NOW);
  const merged = mergeStores(local, incoming);
  check(merged[UUID_A] && merged[UUID_B], 'merge unions patients from both sides');
  check(merged[UUID_A].alerts[0].label === 'Local only', 'local alerts survive a merge');
  const bothSame = mergeStores(
    local,
    upsertAlert({}, pcA, makeAlert({ label: 'Added remotely', severity: 'amber' }, NOW), NOW)
  );
  check(bothSame[UUID_A].alerts.length === 2, 'same patient in both: alerts union by id');
  check(mergeStores(null, null) && Object.keys(mergeStores(null, null)).length === 0, 'null inputs merge to empty');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
