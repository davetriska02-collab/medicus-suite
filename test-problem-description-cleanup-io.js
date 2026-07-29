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
        111111: {
          candidate: { description: 'Attention deficit disorder', descriptionId: '111111' },
          count: 2,
          lastUsed: '2026-07-28T10:00:00Z',
        },
      },
      override: null,
    },
  };
  const exported = await problemDescriptionCleanupExport();
  check(exported.preferredDescriptions['35253001'].tally['111111'].count === 2, 'export captures the tally');
  check(
    exported.conceptRemap && typeof exported.conceptRemap === 'object',
    'export always includes a conceptRemap field, even if empty'
  );

  reset();
  await problemDescriptionCleanupImport(exported);
  check(
    store['pdc.preferredDescriptions']['35253001'].tally['111111'].count === 2,
    'a fresh-install import restores the exported tally'
  );

  console.log('\n--- export -> import round-trip (conceptRemap) ---');
  reset();
  store['pdc.conceptRemap'] = {
    449705007: {
      tally: {
        '449708009|222222': {
          candidate: {
            conceptId: '449708009',
            descriptionId: '222222',
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
    exportedRemap.conceptRemap['449705007'].tally['449708009|222222'].candidate.conceptId === '449708009',
    'export captures the full remap candidate object'
  );
  reset();
  await problemDescriptionCleanupImport(exportedRemap);
  check(
    store['pdc.conceptRemap']['449705007'].tally['449708009|222222'].count === 1,
    'a fresh-install import restores the exported remap tally'
  );

  console.log('\n--- import MERGES tally counts rather than replacing, independently per key (load-bearing) ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    90823000: {
      tally: {
        111111: { candidate: { description: 'Infantile eczema' }, count: 3, lastUsed: '2026-07-28T09:00:00Z' },
      },
      override: null,
    },
  };
  store['pdc.conceptRemap'] = {
    449705007: {
      tally: {
        '449708009|222222': { candidate: { conceptId: '449708009' }, count: 2, lastUsed: '2026-07-29T08:00:00Z' },
      },
      override: null,
    },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      90823000: {
        tally: {
          111111: { candidate: { description: 'Infantile eczema' }, count: 5, lastUsed: '2026-07-28T11:00:00Z' },
        },
        override: null,
      },
    },
    conceptRemap: {
      449705007: {
        tally: {
          '449708009|222222': { candidate: { conceptId: '449708009' }, count: 4, lastUsed: '2026-07-29T10:00:00Z' },
        },
        override: null,
      },
    },
  });
  check(
    store['pdc.preferredDescriptions']['90823000'].tally['111111'].count === 8,
    'preferredDescriptions counts are SUMMED (3 + 5 = 8)'
  );
  check(
    store['pdc.conceptRemap']['449705007'].tally['449708009|222222'].count === 6,
    'conceptRemap counts are SUMMED independently (2 + 4 = 6)'
  );
  check(
    store['pdc.conceptRemap']['449705007'].tally['449708009|222222'].lastUsed === '2026-07-29T10:00:00Z',
    'lastUsed takes the more recent of the two timestamps'
  );

  console.log('\n--- import: only the field present in the backup is touched ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    1: { tally: { 111111: { candidate: {}, count: 1, lastUsed: 'x' } }, override: null },
  };
  store['pdc.conceptRemap'] = {
    2: { tally: { '333|444': { candidate: {}, count: 1, lastUsed: 'y' } }, override: null },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: { 1: { tally: { 555555: { candidate: {}, count: 1, lastUsed: 'z' } }, override: null } },
  });
  check(store['pdc.preferredDescriptions']['1'].tally['555555'].count === 1, 'preferredDescriptions updated as given');
  check(
    store['pdc.conceptRemap']['2'].tally['333|444'].count === 1,
    'conceptRemap left completely untouched when absent from the imported data'
  );

  console.log('\n--- override conflict: LOCAL override wins over an incoming one (load-bearing), both fields ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: { key: '111000', candidate: { description: 'Local admin decision' } } },
  };
  store['pdc.conceptRemap'] = {
    400: { tally: {}, override: { key: '111|222', candidate: { description: 'Local remap decision' } } },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      300: { tally: {}, override: { key: '333000', candidate: { description: 'Different backup decision' } } },
    },
    conceptRemap: {
      400: { tally: {}, override: { key: '333|444', candidate: { description: 'Different backup remap' } } },
    },
  });
  check(
    store['pdc.preferredDescriptions']['300'].override.key === '111000',
    'preferredDescriptions: local override survives a conflicting import'
  );
  check(
    store['pdc.conceptRemap']['400'].override.key === '111|222',
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
    await throws(() => problemDescriptionCleanupImport({ conceptRemap: { 1: { tally: { 999999: { count: -1 } } } } })),
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
      problemDescriptionCleanupImport({ conceptRemap: { 1: { tally: { 999999: { count: 1, candidate: [] } } } } })
    ),
    'an array candidate is rejected (structurally impossible)'
  );
  check(Object.keys(store).length === 0, 'no partial writes after any rejected import');

  console.log('\n--- key-format validation (attribute-injection guard: keys round-trip into HTML attributes) ---');
  reset();
  check(
    await throws(() =>
      problemDescriptionCleanupImport({
        preferredDescriptions: {
          ['" onmouseover="alert(1)" x="']: { tally: {}, override: null },
        },
      })
    ),
    'a top-level key containing quotes/non-digits is rejected'
  );
  check(
    await throws(() =>
      problemDescriptionCleanupImport({
        conceptRemap: {
          1: { tally: { ['"><script>alert(1)</script>']: { candidate: {}, count: 1 } }, override: null },
        },
      })
    ),
    'a hostile (non-digit) tally key is rejected'
  );
  check(
    await throws(() =>
      problemDescriptionCleanupImport({
        preferredDescriptions: { 1: { tally: {}, override: { key: '" x="y', candidate: {} } } },
      })
    ),
    'a hostile override.key is rejected'
  );
  check(Object.keys(store).length === 0, 'no partial writes after any of the key-format rejections');

  reset();
  await problemDescriptionCleanupImport({
    conceptRemap: {
      449705007: {
        tally: { '123|456': { candidate: { conceptId: '123', descriptionId: '456' }, count: 1, lastUsed: 'x' } },
        override: null,
      },
    },
  });
  check(
    store['pdc.conceptRemap']['449705007'].tally['123|456'].count === 1,
    'a legitimate axis-2 tally key (conceptId|descriptionId, digits only) still passes'
  );

  console.log('\n--- malformed / empty imports are no-ops ---');
  reset();
  await problemDescriptionCleanupImport({});
  await problemDescriptionCleanupImport(null);
  await problemDescriptionCleanupImport(undefined);
  check(Object.keys(store).length === 0, 'empty/null/undefined import is a no-op (no throw)');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
