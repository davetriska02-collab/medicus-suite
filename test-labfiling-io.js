// Medicus Suite — Lab Filing IO round-trip tests
// Run with: node test-labfiling-io.js
//
// Uses the same in-memory chrome.storage.local mock as test-knowledge-io.js.
// Guards: export → import round-trip, that imported profiles arrive INERT
// (disabled, unreviewed, message off), commitMode clamping, that the audit log
// and per-install attestation never survive an import, and malformed-backup
// rejection with no partial writes.

'use strict';

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

const { labfilingExport, labfilingImport } = require('./shared/io/labfiling-io.js');

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
async function throws(fn) {
  try {
    await fn();
    return false;
  } catch (_) {
    return true;
  }
}

(async () => {
  console.log('--- export → import round-trip ---');
  reset();
  const profile = {
    id: 'city-bloods',
    name: 'City Hospital — routine bloods',
    match: ['full blood count', 'u&e'],
    analytes: ['haemoglobin', 'sodium'],
    filing: { normalOptionText: 'No action required', fileButtonText: 'File', completeButtonText: 'Complete' },
    patientMessage: { enabled: true, template: 'Dear {firstName}, all normal.' },
    commitMode: 'confirm',
    source: 'manual',
    reviewed: true,
    enabled: true,
    updatedAt: '2026-06-10T10:00:00Z',
  };
  store['labfiling.profiles'] = [profile];
  store['labfiling.config'] = { commitMode: 'confirm', noticeAcknowledgedAt: '2026-06-01T09:00:00Z' };
  store['labfiling.auditLog'] = [{ ts: '2026-06-10T10:00:00Z', count: 3 }];

  const exported = await labfilingExport();
  check(exported.profiles.length === 1 && exported.profiles[0].id === 'city-bloods', 'profiles captured in export');
  check(exported.config.commitMode === 'confirm', 'config captured in export');
  check(!('auditLog' in exported), 'auditLog NOT included in export (machine-local governance record)');

  reset(); // fresh install
  await labfilingImport(exported);
  const restored = store['labfiling.profiles'][0];
  check(restored.name === 'City Hospital — routine bloods', 'profile restored on import');
  check(restored.match.join(',') === 'full blood count,u&e', 'match list survives round-trip');
  check(restored.enabled === false, 'imported profile arrives DISABLED (was enabled on source)');
  check(restored.reviewed === false, 'imported profile arrives UNREVIEWED');
  check(restored.patientMessage.enabled === false, 'imported patient message arrives OFF (was on at source)');
  check(restored.source === 'import', 'imported profile tagged source:import');
  check(
    store['labfiling.config'].noticeAcknowledgedAt === undefined,
    'noticeAcknowledgedAt NOT imported (per-install attestation)'
  );

  console.log('\n--- import sanitisation & clamping ---');
  reset();
  await labfilingImport({
    profiles: [
      {
        name: 'Crafted',
        filing: { normalOptionText: 'X', fileButtonText: 'File' },
        commitMode: 'auto',
        smuggled: 'field',
        enabled: true,
      },
    ],
    config: { commitMode: 'auto' },
  });
  const imp = store['labfiling.profiles'][0];
  check(!('smuggled' in imp), 'unknown fields stripped on import (whitelist rebuild)');
  check(imp.commitMode === 'manual', "commitMode 'auto' clamped to 'manual' on import");
  check(imp.enabled === false, 'enabled forced false even when backup says true');
  check(store['labfiling.config'].commitMode === 'manual', "config commitMode 'auto' clamped to 'manual'");
  check(typeof imp.id === 'string' && imp.id.length > 0, 'missing id generated on import');

  reset();
  await labfilingImport({
    profiles: [
      { id: 'same', name: 'One', filing: { normalOptionText: 'X', fileButtonText: 'File' } },
      { id: 'same', name: 'Two', filing: { normalOptionText: 'X', fileButtonText: 'File' } },
    ],
  });
  const ids = store['labfiling.profiles'].map((p) => p.id);
  check(new Set(ids).size === 2, 'duplicate ids in a backup are de-collided');

  console.log('\n--- malformed backups rejected ---');
  reset();
  check(await throws(() => labfilingImport({ profiles: 'not-an-array' })), 'non-array profiles rejected');
  check(
    await throws(() => labfilingImport({ profiles: [{ name: 'no filing block' }] })),
    'profile without filing block rejected'
  );
  check(
    await throws(() => labfilingImport({ profiles: [{ filing: { normalOptionText: 'X', fileButtonText: 'File' } }] })),
    'profile without name rejected'
  );
  check(await throws(() => labfilingImport({ config: [] })), 'non-object config rejected');
  check(Object.keys(store).length === 0, 'no partial writes after rejected imports');

  await labfilingImport({}); // no-op
  await labfilingImport(null); // no-op
  check(Object.keys(store).length === 0, 'empty/null import is a no-op (no throw)');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
