// Medicus Suite — problem-description-cleanup IO (pdc.preferredDescriptions +
// pdc.conceptRemap) round-trip and MERGE-semantics tests
// Run with: node test-problem-description-cleanup-io.js
//
// Uses the same in-memory chrome.storage.local mock as test-leaflets-io.js.
// The load-bearing property of this module (unlike most IO files, which
// replace on import) is that import MERGES tally counts rather than
// overwriting them, and that a LOCAL manual override always survives an
// import that carries a conflicting one — see the io file's own header for
// why. Both storage keys (preferredDescriptions and conceptRemap) share the
// identical merge algorithm, exercised independently below.

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

const {
  problemDescriptionCleanupExport,
  problemDescriptionCleanupImport,
} = require('./shared/io/problem-description-cleanup-io.js');

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
  console.log('\n--- export -> import round-trip (preferredDescriptions) ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    35253001: {
      tally: {
        d1: {
          candidate: { description: 'Attention deficit disorder', descriptionId: 'd1' },
          count: 2,
          lastUsed: '2026-07-28T10:00:00Z',
        },
      },
      override: null,
    },
  };
  const exported = await problemDescriptionCleanupExport();
  check(exported.preferredDescriptions['35253001'].tally.d1.count === 2, 'export captures the tally');
  check(
    exported.conceptRemap && typeof exported.conceptRemap === 'object',
    'export always includes a conceptRemap field, even if empty'
  );

  reset();
  await problemDescriptionCleanupImport(exported);
  check(
    store['pdc.preferredDescriptions']['35253001'].tally.d1.count === 2,
    'a fresh-install import restores the exported tally'
  );

  console.log('\n--- export -> import round-trip (conceptRemap) ---');
  reset();
  store['pdc.conceptRemap'] = {
    449705007: {
      tally: {
        '449708009|td1': {
          candidate: {
            conceptId: '449708009',
            descriptionId: 'td1',
            description: 'Injection of varicose vein of lower limb',
          },
          count: 1,
          lastUsed: '2026-07-29T09:00:00Z',
        },
      },
      override: null,
    },
  };
  const exportedRemap = await problemDescriptionCleanupExport();
  check(
    exportedRemap.conceptRemap['449705007'].tally['449708009|td1'].candidate.conceptId === '449708009',
    'export captures the full remap candidate object'
  );
  reset();
  await problemDescriptionCleanupImport(exportedRemap);
  check(
    store['pdc.conceptRemap']['449705007'].tally['449708009|td1'].count === 1,
    'a fresh-install import restores the exported remap tally'
  );

  console.log('\n--- import MERGES tally counts rather than replacing, independently per key (load-bearing) ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    90823000: {
      tally: { d1: { candidate: { description: 'Infantile eczema' }, count: 3, lastUsed: '2026-07-28T09:00:00Z' } },
      override: null,
    },
  };
  store['pdc.conceptRemap'] = {
    449705007: {
      tally: { '449708009|td1': { candidate: { conceptId: '449708009' }, count: 2, lastUsed: '2026-07-29T08:00:00Z' } },
      override: null,
    },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      90823000: {
        tally: { d1: { candidate: { description: 'Infantile eczema' }, count: 5, lastUsed: '2026-07-28T11:00:00Z' } },
        override: null,
      },
    },
    conceptRemap: {
      449705007: {
        tally: {
          '449708009|td1': { candidate: { conceptId: '449708009' }, count: 4, lastUsed: '2026-07-29T10:00:00Z' },
        },
        override: null,
      },
    },
  });
  check(
    store['pdc.preferredDescriptions']['90823000'].tally.d1.count === 8,
    'preferredDescriptions counts are SUMMED (3 + 5 = 8)'
  );
  check(
    store['pdc.conceptRemap']['449705007'].tally['449708009|td1'].count === 6,
    'conceptRemap counts are SUMMED independently (2 + 4 = 6)'
  );
  check(
    store['pdc.conceptRemap']['449705007'].tally['449708009|td1'].lastUsed === '2026-07-29T10:00:00Z',
    'lastUsed takes the more recent of the two timestamps'
  );

  console.log('\n--- import: only the field present in the backup is touched ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    1: { tally: { d1: { candidate: {}, count: 1, lastUsed: 'x' } }, override: null },
  };
  store['pdc.conceptRemap'] = { 2: { tally: { 'c|d': { candidate: {}, count: 1, lastUsed: 'y' } }, override: null } };
  await problemDescriptionCleanupImport({
    preferredDescriptions: { 1: { tally: { d2: { candidate: {}, count: 1, lastUsed: 'z' } }, override: null } },
  });
  check(store['pdc.preferredDescriptions']['1'].tally.d2.count === 1, 'preferredDescriptions updated as given');
  check(
    store['pdc.conceptRemap']['2'].tally['c|d'].count === 1,
    'conceptRemap left completely untouched when absent from the imported data'
  );

  console.log('\n--- override conflict: LOCAL override wins over an incoming one (load-bearing), both fields ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: { key: 'local-choice', candidate: { description: 'Local admin decision' } } },
  };
  store['pdc.conceptRemap'] = {
    400: { tally: {}, override: { key: 'local|remap', candidate: { description: 'Local remap decision' } } },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      300: { tally: {}, override: { key: 'backup-choice', candidate: { description: 'Different backup decision' } } },
    },
    conceptRemap: {
      400: { tally: {}, override: { key: 'backup|remap', candidate: { description: 'Different backup remap' } } },
    },
  });
  check(
    store['pdc.preferredDescriptions']['300'].override.key === 'local-choice',
    'preferredDescriptions: local override survives a conflicting import'
  );
  check(
    store['pdc.conceptRemap']['400'].override.key === 'local|remap',
    'conceptRemap: local override survives a conflicting import'
  );

  console.log('\n--- validation ---');
  reset();
  check(
    await throws(() => problemDescriptionCleanupImport({ preferredDescriptions: 'not-an-object' })),
    'non-object preferredDescriptions rejected'
  );
  check(await throws(() => problemDescriptionCleanupImport({ conceptRemap: [] })), 'array conceptRemap rejected');
  check(
    await throws(() => problemDescriptionCleanupImport({ conceptRemap: { 1: { tally: { k: { count: -1 } } } } })),
    'a negative count in conceptRemap is rejected'
  );
  check(
    await throws(() =>
      problemDescriptionCleanupImport({ preferredDescriptions: { 1: { override: { candidate: {} } } } })
    ),
    'an override missing key is rejected'
  );
  check(
    await throws(() =>
      problemDescriptionCleanupImport({ conceptRemap: { 1: { tally: { k: { count: 1, candidate: [] } } } } })
    ),
    'an array candidate is rejected (structurally impossible)'
  );
  check(Object.keys(store).length === 0, 'no partial writes after any rejected import');

  console.log('\n--- malformed / empty imports are no-ops ---');
  reset();
  await problemDescriptionCleanupImport({});
  await problemDescriptionCleanupImport(null);
  await problemDescriptionCleanupImport(undefined);
  check(Object.keys(store).length === 0, 'empty/null/undefined import is a no-op (no throw)');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
