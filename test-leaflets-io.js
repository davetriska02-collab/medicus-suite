// Medicus Suite — Leaflets IO round-trip tests
// Run with: node test-leaflets-io.js
//
// Uses the same in-memory chrome.storage.local mock as test-backup-keys.js /
// test-knowledge-io.js. Guards: export -> import round-trip for the recent
// list and the `enabled` flag, and — the load-bearing property of this
// module — that the API key is EXCLUDED from export and is NEVER written by
// import, even when a crafted/foreign backup carries one.

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

const { leafletsExport, leafletsImport } = require('./shared/io/leaflets-io.js');

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
  console.log('\n--- export -> import round-trip ---');
  reset();
  const recentEntry = {
    slug: 'atopic-eczema',
    name: 'Atopic eczema',
    kind: 'condition',
    openedAt: '2026-06-10T10:00:00Z',
  };
  store['leaflets.recent'] = [recentEntry];
  store['leaflets.config'] = { enabled: true, apiKey: 'super-secret-key-12345' };

  const exported = await leafletsExport();
  check(exported.recent.length === 1 && exported.recent[0].slug === 'atopic-eczema', 'recent list captured in export');
  check(exported.config.enabled === true, 'config.enabled captured in export');

  console.log('\n--- API key EXCLUDED from export (load-bearing) ---');
  check(!('apiKey' in exported.config), 'exported config object has no apiKey property at all');
  check(
    !JSON.stringify(exported).includes('super-secret-key-12345'),
    'the secret string does not appear anywhere in the exported payload'
  );

  reset(); // fresh install — no local apiKey
  await leafletsImport(exported);
  check(
    store['leaflets.recent'].length === 1 && store['leaflets.recent'][0].name === 'Atopic eczema',
    'recent list restored on import'
  );
  check(store['leaflets.config'].enabled === true, 'config.enabled restored on import');
  check(
    store['leaflets.config'].apiKey === undefined,
    'fresh install has no apiKey after import (none was ever supplied)'
  );

  console.log('\n--- import NEVER writes apiKey, even from a crafted backup ---');
  reset();
  // A hand-crafted/foreign backup that smuggles an apiKey field must be ignored.
  await leafletsImport({ recent: [], config: { enabled: true, apiKey: 'attacker-supplied-key' } });
  check(
    store['leaflets.config'].apiKey === undefined,
    'a foreign backup carrying apiKey never gets it written to storage'
  );
  check(
    !JSON.stringify(store).includes('attacker-supplied-key'),
    'the crafted key string never reaches storage at all'
  );

  console.log('\n--- import preserves an EXISTING local apiKey (merge, not replace) ---');
  reset();
  store['leaflets.config'] = { enabled: false, apiKey: 'my-real-local-key' };
  await leafletsImport({ config: { enabled: true } }); // a normal suite backup — no apiKey field at all
  check(store['leaflets.config'].enabled === true, 'enabled flag updated by import');
  check(
    store['leaflets.config'].apiKey === 'my-real-local-key',
    'existing local apiKey survives the import untouched (merge semantics)'
  );

  console.log('\n--- recent list validation ---');
  reset();
  check(await throws(() => leafletsImport({ recent: 'not-an-array' })), 'non-array recent rejected');
  check(
    await throws(() => leafletsImport({ recent: [{ name: 'No slug' }] })),
    'recent entry without a valid slug rejected'
  );
  check(
    await throws(() => leafletsImport({ recent: [{ slug: 'Bad_Slug', name: 'X' }] })),
    'recent entry with malformed slug rejected'
  );
  check(await throws(() => leafletsImport({ recent: [{ slug: 'ok-slug' }] })), 'recent entry without a name rejected');
  check(Object.keys(store).length === 0, 'no partial writes after rejected imports');

  reset();
  await leafletsImport({ recent: [{ slug: 'ok-slug', name: 'OK', kind: 'bogus-kind' }] });
  check(store['leaflets.recent'][0].kind === 'condition', 'unknown kind normalised to "condition" default');

  reset();
  const fifteen = Array.from({ length: 15 }, (_, i) => ({ slug: `s${i}`, name: `S${i}` }));
  await leafletsImport({ recent: fifteen });
  check(store['leaflets.recent'].length === 10, 'imported recent list capped at 10');

  console.log('\n--- config validation ---');
  reset();
  check(await throws(() => leafletsImport({ config: [] })), 'array config rejected');
  check(await throws(() => leafletsImport({ config: 'nope' })), 'non-object config rejected');

  reset();
  await leafletsImport({ config: { enabled: 'yes' } }); // truthy non-boolean
  check(
    store['leaflets.config'].enabled === false,
    'non-boolean enabled coerces to false (fail closed, not fail open)'
  );

  console.log('\n--- malformed / empty imports are no-ops ---');
  reset();
  await leafletsImport({});
  await leafletsImport(null);
  await leafletsImport(undefined);
  check(Object.keys(store).length === 0, 'empty/null/undefined import is a no-op (no throw)');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
