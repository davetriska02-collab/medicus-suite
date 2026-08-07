// Medicus Suite — rota scope-validation parity guard
// Run with: node test-rota-validate.js
//
// Two validators guard the eight rota.* scopes, and they must agree:
//
//   rota/engine/validate.js  validateRotaScopes()  — the HOT path. The
//     shared-drive sync file (rota/shared/sync.js) is re-read every 15s, is
//     writable by anyone with practice-share access and is last-writer-wins.
//     rota/app/app.js validates it before saving anything.
//   shared/io/rota-io.js     rotaImport()          — the COLD path (suite
//     backup restore). A CLASSIC script loaded by a bare <script src>, so it
//     cannot import the ESM validator; it keeps its own copy of the checks.
//
// Two copies drift. This file pins them together by fixture: every malformed
// shape below must be rejected by BOTH, and the healthy fixture accepted by
// BOTH. If you add a check to one, add it to the other or this test fails.
//
// Module loading: rota/ is ESM (its own package.json "type":"module"), this
// root file is CJS — same dynamic-import idiom as the other test-rota-*.js.

'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

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

// A minimally healthy set of scopes — every key present, every shape correct.
function healthyScopes() {
  return {
    staff: [{ id: 's1', name: 'Dr Partner', role: 'gp', contractedSessions: 8 }],
    entries: [{ id: 'e1', staffId: 's1', date: '2026-06-08', period: 'am', typeId: 'duty', status: 'planned' }],
    leave: [{ id: 'l1', staffId: 's1', type: 'annual', start: '2026-07-01', end: '2026-07-03', status: 'approved' }],
    rooms: [{ id: 'r1', name: 'Room 1' }],
    swaps: [{ id: 'w1', status: 'requested' }],
    audit: [{ at: '2026-06-08T09:00:00.000Z', by: 'Jo Bloggs', summary: 'Rota published' }],
    demand: { days: { '2026-06-08': { appts: 120 } }, pulledAt: '2026-06-08T09:00:00.000Z' },
    settings: {
      schemaVersion: 1,
      openDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      bankHolidays: ['2026-12-25'],
      sites: [],
      peakPeriods: [],
      dutyRequired: { am: 1, pm: 1 },
      extraPeriods: { early: false, eve: false },
    },
  };
}

// Every one of these must be rejected by BOTH validators.
// `mutate` is applied to a fresh healthy fixture.
const MALFORMED = [
  {
    name: 'settings.openDays is null (the crash that motivated this — rules.js does openDays.includes())',
    mutate: (s) => {
      s.settings.openDays = null;
    },
  },
  {
    name: 'settings.openDays is a string',
    mutate: (s) => {
      s.settings.openDays = 'mon,tue';
    },
  },
  {
    name: 'settings.bankHolidays is an object',
    mutate: (s) => {
      s.settings.bankHolidays = { '2026-12-25': true };
    },
  },
  {
    name: 'settings.sites is null',
    mutate: (s) => {
      s.settings.sites = null;
    },
  },
  {
    name: 'settings.peakPeriods is a number',
    mutate: (s) => {
      s.settings.peakPeriods = 3;
    },
  },
  {
    name: 'settings.dutyRequired is an array',
    mutate: (s) => {
      s.settings.dutyRequired = [1, 1];
    },
  },
  {
    name: 'settings.extraPeriods is null',
    mutate: (s) => {
      s.settings.extraPeriods = null;
    },
  },
  {
    name: 'settings itself is an array',
    mutate: (s) => {
      s.settings = [];
    },
  },
  {
    name: 'settings itself is null',
    mutate: (s) => {
      s.settings = null;
    },
  },
  {
    name: 'entries is a string',
    mutate: (s) => {
      s.entries = 'not-a-list';
    },
  },
  {
    name: 'entries is an object',
    mutate: (s) => {
      s.entries = { e1: {} };
    },
  },
  {
    name: 'entries contains a string element',
    mutate: (s) => {
      s.entries.push('2026-06-08 am duty');
    },
  },
  {
    name: 'entries contains a null element',
    mutate: (s) => {
      s.entries.push(null);
    },
  },
  {
    name: 'staff is an object, not an array',
    mutate: (s) => {
      s.staff = { s1: { name: 'Dr Partner' } };
    },
  },
  {
    name: 'staff contains a nested array element',
    mutate: (s) => {
      s.staff.push(['Dr Locum']);
    },
  },
  {
    name: 'leave is null',
    mutate: (s) => {
      s.leave = null;
    },
  },
  {
    name: 'rooms is a number',
    mutate: (s) => {
      s.rooms = 4;
    },
  },
  {
    name: 'swaps contains a number element',
    mutate: (s) => {
      s.swaps.push(7);
    },
  },
  {
    name: 'audit is a string',
    mutate: (s) => {
      s.audit = 'Rota published';
    },
  },
  {
    name: 'demand is an array',
    mutate: (s) => {
      s.demand = [];
    },
  },
  {
    name: 'demand is null',
    mutate: (s) => {
      s.demand = null;
    },
  },
  {
    name: 'demand.days is an array',
    mutate: (s) => {
      s.demand.days = [];
    },
  },
  {
    name: 'demand.days is null',
    mutate: (s) => {
      s.demand.days = null;
    },
  },
];

// rotaImport() writes through chrome.storage.local on success. Stub it so the
// happy-path fixture can run in node; the stub records what would be written.
function withChromeStub(fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'chrome');
  const prev = globalThis.chrome;
  const written = [];
  globalThis.chrome = {
    storage: {
      local: {
        async set(obj) {
          written.push(obj);
        },
        async get() {
          return {};
        },
      },
    },
  };
  try {
    return { result: fn(), written };
  } finally {
    if (had) globalThis.chrome = prev;
    else delete globalThis.chrome;
  }
}

// Did rotaImport reject this fixture? It signals by throwing.
async function rotaImportRejects(rotaImport, scopes) {
  let threw = false;
  const { result } = withChromeStub(() =>
    rotaImport(scopes).then(
      () => {},
      () => {
        threw = true;
      }
    )
  );
  await result;
  return threw;
}

(async () => {
  const { validateRotaScopes, ROTA_SCOPES } = await R('engine/validate.js');
  const { rotaImport, ROTA_KEYS } = require('./shared/io/rota-io.js');

  console.log('\n--- Rota scope validation: healthy fixture ---');

  const healthyRejects = validateRotaScopes(healthyScopes());
  check(
    healthyRejects.length === 0,
    `validateRotaScopes accepts the healthy fixture (rejects: ${JSON.stringify(healthyRejects)})`
  );

  const healthyRejected = await rotaImportRejects(rotaImport, healthyScopes());
  check(healthyRejected === false, 'rotaImport accepts the healthy fixture');

  // …and actually writes all eight keys, so the fixture is not vacuously valid.
  const { result, written } = withChromeStub(() => rotaImport(healthyScopes()));
  await result;
  const keysWritten = written.length ? Object.keys(written[0]) : [];
  check(
    ROTA_KEYS.every((k) => keysWritten.includes(k)),
    `the healthy fixture exercises all ${ROTA_KEYS.length} rota.* keys (wrote ${keysWritten.length})`
  );

  check(
    ROTA_SCOPES.length === ROTA_KEYS.length && ROTA_SCOPES.every((s) => ROTA_KEYS.includes(`rota.${s}`)),
    'validate.js ROTA_SCOPES and rota-io.js ROTA_KEYS describe the same eight scopes'
  );

  console.log('\n--- Rota scope validation: both validators must reject each malformed fixture ---');

  for (const { name, mutate } of MALFORMED) {
    const forValidator = healthyScopes();
    mutate(forValidator);
    const rejects = validateRotaScopes(forValidator);

    const forImport = healthyScopes();
    mutate(forImport);
    const importRejected = await rotaImportRejects(rotaImport, forImport);

    check(rejects.length > 0, `validateRotaScopes rejects: ${name}`);
    check(importRejected, `rotaImport rejects: ${name}`);
  }

  console.log('\n--- Rota scope validation: contract details ---');

  // Contract: a rejects LIST (empty = valid), never a throw.
  assert.ok(Array.isArray(validateRotaScopes({})), 'validateRotaScopes returns an array');
  check(validateRotaScopes({}).length === 0, 'an empty scopes object is valid (every scope is optional)');
  check(validateRotaScopes(null).length === 1, 'a non-object scopes value is rejected with one reason');
  check(validateRotaScopes([]).length === 1, 'an array scopes value is rejected');
  check(
    validateRotaScopes({ staff: [], unknownFutureScope: 42 }).length === 0,
    'unknown extra keys are ignored (forward-compatible)'
  );
  check(
    validateRotaScopes(healthyScopes()).length === 0 &&
      validateRotaScopes({ settings: { openDays: null, sites: null } }).length === 2,
    'every problem is reported, not just the first'
  );
  check(
    validateRotaScopes({ entries: [null, 'x'] }).every((r) => typeof r === 'string' && r.includes('rota.entries')),
    'rejection strings name the offending storage key'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
