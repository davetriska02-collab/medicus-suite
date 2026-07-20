// Medicus Suite — Patient Alerts IO round-trip tests
// Run with: node test-patient-alerts-io.js
//
// Guards the backup surface of the suite's first persisted per-patient store:
// export → import round-trips, MERGE (union) import semantics (a shared file
// can never silently delete local alerts), validation failures throw (so
// applyWithRollback can roll back), and prototype-pollution keys are stripped.
//
// Uses the same in-memory chrome.storage.local mock as test-backup-keys.js.

'use strict';

// ── in-memory chrome.storage.local mock ──────────────────────────────────────
const store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
        const out = {};
        ks.forEach((k) => {
          if (k in store) out[k] = store[k];
        });
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
      },
    },
  },
};

const { patientAlertsExport, patientAlertsImport, PATIENT_ALERTS_KEYS } = require('./shared/io/patient-alerts-io.js');

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
function reset() {
  for (const k of Object.keys(store)) delete store[k];
}

const UUID_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const UUID_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const alertA = {
  id: 'pa-1',
  typeId: 'interpreter',
  label: 'Interpreter required — Polish',
  severity: 'amber',
  note: '',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};
const alertB = {
  id: 'pa-2',
  typeId: null,
  label: 'Safeguarding concern',
  severity: 'red',
  note: 'See record',
  createdAt: '2026-07-02T00:00:00Z',
  updatedAt: '2026-07-02T00:00:00Z',
};
const entryA = {
  // NHS number is deliberately Modulus-11 INVALID — synthetic by construction,
  // so scripts/check-no-patient-data.js ignores it (see test-patient-alerts-core.js).
  patient: { name: 'Ann Test', nhsNumber: '9434765911', dob: '01 Jan 1980' },
  alerts: [alertA],
  updatedAt: '2026-07-01T00:00:00Z',
};
const entryB = {
  patient: { name: 'Bob Test', nhsNumber: null, dob: '' },
  alerts: [alertB],
  updatedAt: '2026-07-02T00:00:00Z',
};

(async () => {
  console.log('\n--- keys manifest ---');
  check(
    PATIENT_ALERTS_KEYS.includes('patientAlerts.byPatient') && PATIENT_ALERTS_KEYS.includes('patientAlerts.types'),
    'both storage keys are declared (backup-coverage guard reads these)'
  );

  console.log('\n--- export → import round-trip ---');
  reset();
  store['patientAlerts.byPatient'] = { [UUID_A]: entryA };
  store['patientAlerts.types'] = [{ id: 'custom-1', label: 'Ward round', severity: 'info', description: '' }];
  const exported = await patientAlertsExport();
  check(exported.byPatient[UUID_A].alerts[0].label === alertA.label, 'export captures the store');
  check(exported.types.length === 1, 'export captures the customised palette');

  reset(); // simulate a fresh profile
  await patientAlertsImport(exported);
  check(store['patientAlerts.byPatient'][UUID_A].alerts[0].id === 'pa-1', 'import restores alerts');
  check(store['patientAlerts.types'][0].id === 'custom-1', 'import restores the palette');

  console.log('\n--- default (uncustomised) palette round-trip ---');
  reset();
  store['patientAlerts.byPatient'] = {};
  const exp2 = await patientAlertsExport();
  check(exp2.types === null, 'uncustomised palette exports as null (stays on shipped defaults)');
  reset();
  await patientAlertsImport(exp2);
  check(!('patientAlerts.types' in store), 'null palette import writes nothing (defaults stay live)');

  console.log('\n--- merge semantics: import can never silently delete ---');
  reset();
  store['patientAlerts.byPatient'] = { [UUID_A]: entryA };
  await patientAlertsImport({ byPatient: { [UUID_B]: entryB } });
  const merged = store['patientAlerts.byPatient'];
  check(merged[UUID_A] && merged[UUID_B], 'incoming patients merge alongside local ones');
  check(merged[UUID_A].alerts[0].id === 'pa-1', 'local alerts survive an import');

  // Same patient in both: union by alert id, incoming wins on the same id.
  await patientAlertsImport({
    byPatient: {
      [UUID_A]: { ...entryA, alerts: [{ ...alertA, label: 'Interpreter required — Ukrainian' }, alertB] },
    },
  });
  const after = store['patientAlerts.byPatient'][UUID_A];
  check(after.alerts.length === 2, 'same-patient import unions alerts by id');
  check(
    after.alerts.find((a) => a.id === 'pa-1').label === 'Interpreter required — Ukrainian',
    'incoming copy wins on the same alert id'
  );

  console.log('\n--- palette merge ---');
  reset();
  store['patientAlerts.types'] = [{ id: 't1', label: 'Local', severity: 'info', description: '' }];
  await patientAlertsImport({ types: [{ id: 't2', label: 'Shared', severity: 'red' }] });
  check(store['patientAlerts.types'].length === 2, 'palette import unions with local types');

  console.log('\n--- validation: malformed input throws, storage untouched ---');
  reset();
  store['patientAlerts.byPatient'] = { [UUID_A]: entryA };
  const before = JSON.stringify(store['patientAlerts.byPatient']);
  async function expectThrow(data, msg) {
    let threw = false;
    try {
      await patientAlertsImport(data);
    } catch (_) {
      threw = true;
    }
    check(threw, msg);
  }
  await expectThrow(null, 'null data throws');
  await expectThrow({ byPatient: [] }, 'array byPatient throws');
  await expectThrow({ byPatient: { x: { alerts: 'nope' } } }, 'non-array alerts throws');
  await expectThrow(
    { byPatient: { x: { alerts: [{ id: 'a', label: '', severity: 'amber' }] } } },
    'blank alert label throws'
  );
  await expectThrow(
    { byPatient: { x: { alerts: [{ id: 'a', label: 'ok', severity: 'purple' }] } } },
    'bad severity throws'
  );
  await expectThrow({ types: [{ id: '', label: 'x', severity: 'red' }] }, 'typeless palette entry throws');
  check(JSON.stringify(store['patientAlerts.byPatient']) === before, 'failed imports leave storage untouched');

  console.log('\n--- prototype-pollution defence ---');
  reset();
  const evil = JSON.parse('{"byPatient": {"__proto__": {"alerts": [{"id":"e","label":"evil","severity":"red"}]}}}');
  await patientAlertsImport(evil);
  const written = store['patientAlerts.byPatient'] || {};
  check(!Object.prototype.hasOwnProperty.call(written, '__proto__'), '__proto__ key is stripped, not persisted');
  check(!Array.isArray({}.alerts), 'Object.prototype was not polluted');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
