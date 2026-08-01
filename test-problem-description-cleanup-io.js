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
  problemDescriptionCleanupMergeForPublish,
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

  console.log("\n--- opts.tallyMode: 'max' takes the larger count instead of summing ---");
  reset();
  store['pdc.preferredDescriptions'] = {
    90823000: {
      tally: { 111111: { candidate: { description: 'Local' }, count: 20, lastUsed: '2026-07-28T09:00:00Z' } },
      override: null,
    },
  };
  await problemDescriptionCleanupImport(
    {
      preferredDescriptions: {
        90823000: {
          tally: { 111111: { candidate: { description: 'Incoming' }, count: 8, lastUsed: '2026-07-29T09:00:00Z' } },
          override: null,
        },
      },
    },
    { tallyMode: 'max' }
  );
  check(
    store['pdc.preferredDescriptions']['90823000'].tally['111111'].count === 20,
    "tallyMode 'max': local (20) beats incoming (8) — not summed to 28"
  );

  reset();
  store['pdc.preferredDescriptions'] = {
    90823000: {
      tally: { 111111: { candidate: { description: 'Local' }, count: 3, lastUsed: '2026-07-28T09:00:00Z' } },
      override: null,
    },
  };
  await problemDescriptionCleanupImport(
    {
      preferredDescriptions: {
        90823000: {
          tally: { 111111: { candidate: { description: 'Incoming' }, count: 30, lastUsed: '2026-07-29T09:00:00Z' } },
          override: null,
        },
      },
    },
    { tallyMode: 'max' }
  );
  check(
    store['pdc.preferredDescriptions']['90823000'].tally['111111'].count === 30,
    "tallyMode 'max': incoming (30) beats local (3) when incoming is larger"
  );

  console.log('\n--- omitting opts (or passing none) keeps the default add/local-wins behaviour ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    90823000: {
      tally: { 111111: { candidate: {}, count: 3, lastUsed: '2026-07-28T09:00:00Z' } },
      override: null,
    },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      90823000: { tally: { 111111: { candidate: {}, count: 5, lastUsed: '2026-07-29T09:00:00Z' } }, override: null },
    },
  });
  check(
    store['pdc.preferredDescriptions']['90823000'].tally['111111'].count === 8,
    'no opts passed: tallies still SUM by default (3 + 5 = 8), unchanged behaviour'
  );

  console.log("\n--- opts.overrideWins: 'incoming' makes the imported override authoritative ---");
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: { key: '111000', candidate: { description: 'Local admin decision' } } },
  };
  await problemDescriptionCleanupImport(
    {
      preferredDescriptions: {
        300: { tally: {}, override: { key: '333000', candidate: { description: 'Practice-agreed decision' } } },
      },
    },
    { overrideWins: 'incoming' }
  );
  check(
    store['pdc.preferredDescriptions']['300'].override.key === '333000',
    "overrideWins 'incoming': the imported override replaces the local one"
  );

  console.log("\n--- opts.overrideWins: 'incoming' still falls back to local when nothing incoming ---");
  // NOTE the deliberate distinction exercised by the tombstone block below:
  // an incoming entry that simply LACKS an override (this case) must never
  // clobber a local one, whereas an incoming entry carrying an explicit
  // `overrideCleared` tombstone must.
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: { key: '111000', candidate: { description: 'Local admin decision' } } },
  };
  await problemDescriptionCleanupImport(
    { preferredDescriptions: { 300: { tally: {}, override: null } } },
    { overrideWins: 'incoming' }
  );
  check(
    store['pdc.preferredDescriptions']['300'].override.key === '111000',
    "overrideWins 'incoming': local override survives when the incoming entry carries no override at all (absence is NOT a clear)"
  );

  // ── Cleared-override tombstones (a clear is a DECISION, not an absence) ─────
  console.log('\n--- tombstone: an explicit incoming clear removes the local override (no resurrection) ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: {
      tally: {},
      override: { key: '111000', candidate: { description: 'Old practice-wide decision' } },
      overrideSetAt: '2026-07-01T09:00:00Z',
    },
  };
  await problemDescriptionCleanupImport(
    {
      preferredDescriptions: {
        300: { tally: {}, override: null, overrideCleared: '2026-07-30T09:00:00Z' },
      },
    },
    { overrideWins: 'local' }
  );
  check(
    store['pdc.preferredDescriptions']['300'].override === null,
    'tombstone: an explicit clear published AFTER the override was set removes it, even in local-wins mode'
  );
  check(
    store['pdc.preferredDescriptions']['300'].overrideCleared === '2026-07-30T09:00:00Z',
    'tombstone: the clear timestamp is carried into the merged entry so it keeps propagating'
  );

  console.log('\n--- tombstone: an untimestamped legacy override loses to any explicit clear ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: { key: '111000', candidate: { description: 'Legacy pin, no timestamp' } } },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: { 300: { tally: {}, override: null, overrideCleared: '2026-07-30T09:00:00Z' } },
  });
  check(
    store['pdc.preferredDescriptions']['300'].override === null,
    'tombstone: set-without-timestamp is treated as older than any explicit clear'
  );

  console.log('\n--- tombstone: a LOCAL clear is not resurrected by the next sync of an older published override ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: null, overrideCleared: '2026-07-30T09:00:00Z' },
  };
  await problemDescriptionCleanupImport(
    {
      preferredDescriptions: {
        300: {
          tally: {},
          override: { key: '111000', candidate: { description: 'Still-published old decision' } },
          overrideSetAt: '2026-07-01T09:00:00Z',
        },
      },
    },
    { overrideWins: 'incoming' }
  );
  check(
    store['pdc.preferredDescriptions']['300'].override === null,
    'tombstone: the daily sync does NOT undo a local Clear-override made after the override was published'
  );

  console.log('\n--- tombstone: a re-pin made AFTER the clear wins again ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: null, overrideCleared: '2026-07-20T09:00:00Z' },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      300: {
        tally: {},
        override: { key: '222000', candidate: { description: 'Re-pinned later' } },
        overrideSetAt: '2026-07-30T09:00:00Z',
      },
    },
  });
  check(
    store['pdc.preferredDescriptions']['300'].override?.key === '222000',
    'tombstone: an override set after the clear timestamp is adopted (the clear is not permanent)'
  );
  check(
    store['pdc.preferredDescriptions']['300'].overrideCleared === undefined,
    'tombstone: the superseded clear marker is dropped once a newer pin wins'
  );

  console.log('\n--- tombstone: export/import round-trips the markers ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: {}, override: null, overrideCleared: '2026-07-30T09:00:00Z' },
  };
  const exportedTombstone = await problemDescriptionCleanupExport();
  check(
    exportedTombstone.preferredDescriptions['300'].overrideCleared === '2026-07-30T09:00:00Z',
    'tombstone: export carries overrideCleared (it is a decision, not derived state)'
  );
  check(
    await throws(() =>
      problemDescriptionCleanupImport({ preferredDescriptions: { 1: { tally: {}, overrideCleared: 12345 } } })
    ),
    'tombstone: a non-string overrideCleared is rejected'
  );

  console.log('\n--- tombstone: publish merge propagates an attended clear, but never an unattended one ---');
  {
    const existingShared = {
      preferredDescriptions: {
        300: {
          tally: {},
          override: { key: '111000', candidate: { description: 'Practice-wide decision' } },
          overrideSetAt: '2026-07-01T09:00:00Z',
        },
      },
      conceptRemap: {},
    };
    const localCleared = {
      preferredDescriptions: { 300: { tally: {}, override: null, overrideCleared: '2026-07-30T09:00:00Z' } },
      conceptRemap: {},
    };
    const attended = problemDescriptionCleanupMergeForPublish(existingShared, localCleared);
    check(
      attended.preferredDescriptions['300'].override === null &&
        attended.preferredDescriptions['300'].overrideCleared === '2026-07-30T09:00:00Z',
      'publish merge (attended): a local Clear-override removes the practice-wide override and publishes the tombstone'
    );
    const unattended = problemDescriptionCleanupMergeForPublish(existingShared, localCleared, {
      includeOverride: false,
    });
    check(
      unattended.preferredDescriptions['300'].override?.key === '111000',
      'publish merge (includeOverride:false): an unattended daily publish never un-enforces the practice-wide override'
    );
  }

  console.log('\n--- lastUsed: the side that HAS a value wins when the other lacks one ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: { 111111: { candidate: {}, count: 1, lastUsed: '2026-01-01T00:00:00Z' } } },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: { 300: { tally: { 111111: { candidate: {}, count: 1 } } } },
  });
  check(
    store['pdc.preferredDescriptions']['300'].tally['111111'].lastUsed === '2026-01-01T00:00:00Z',
    'lastUsed: a local timestamp is kept when the incoming row carries none (was dropped to undefined)'
  );
  reset();
  store['pdc.preferredDescriptions'] = {
    300: { tally: { 111111: { candidate: {}, count: 1 } } },
  };
  await problemDescriptionCleanupImport({
    preferredDescriptions: {
      300: { tally: { 111111: { candidate: {}, count: 1, lastUsed: '2026-02-02T00:00:00Z' } } },
    },
  });
  check(
    store['pdc.preferredDescriptions']['300'].tally['111111'].lastUsed === '2026-02-02T00:00:00Z',
    'lastUsed: the incoming timestamp is adopted when the local row carries none'
  );

  console.log('\n--- problemDescriptionCleanupMergeForPublish: tally reconciles via max(), never adds ---');
  {
    const existingShared = {
      preferredDescriptions: {
        90823000: {
          tally: { 111111: { candidate: { description: 'Shared' }, count: 20, lastUsed: '2026-07-28T09:00:00Z' } },
          override: null,
        },
      },
      conceptRemap: {},
    };
    const localSnapshot = {
      preferredDescriptions: {
        90823000: {
          tally: { 111111: { candidate: { description: 'Local' }, count: 8, lastUsed: '2026-07-29T09:00:00Z' } },
          override: null,
        },
      },
      conceptRemap: {},
    };
    const merged = problemDescriptionCleanupMergeForPublish(existingShared, localSnapshot);
    check(
      merged.preferredDescriptions['90823000'].tally['111111'].count === 20,
      'publish merge: takes the larger of shared (20) vs local (8), not the sum (28)'
    );
  }

  console.log('\n--- problemDescriptionCleanupMergeForPublish: local machine override wins over previously-shared ---');
  {
    const existingShared = {
      preferredDescriptions: {
        300: { tally: {}, override: { key: '111000', candidate: { description: 'Previously-shared decision' } } },
      },
      conceptRemap: {},
    };
    const localSnapshot = {
      preferredDescriptions: {
        300: { tally: {}, override: { key: '222000', candidate: { description: "This machine's fresh decision" } } },
      },
      conceptRemap: {},
    };
    const merged = problemDescriptionCleanupMergeForPublish(existingShared, localSnapshot);
    check(
      merged.preferredDescriptions['300'].override.key === '222000',
      "publish merge: this machine's own override supersedes the previously-published one"
    );
  }

  console.log(
    '\n--- problemDescriptionCleanupMergeForPublish: previously-shared override survives when local has none ---'
  );
  {
    const existingShared = {
      preferredDescriptions: {
        300: { tally: {}, override: { key: '111000', candidate: { description: 'Previously-shared decision' } } },
      },
      conceptRemap: {},
    };
    const localSnapshot = { preferredDescriptions: { 300: { tally: {}, override: null } }, conceptRemap: {} };
    const merged = problemDescriptionCleanupMergeForPublish(existingShared, localSnapshot);
    check(
      merged.preferredDescriptions['300'].override.key === '111000',
      'publish merge: previously-shared override is kept when this machine has none of its own'
    );
  }

  console.log(
    '\n--- problemDescriptionCleanupMergeForPublish: opts.includeOverride:false (auto-publish) never touches the override, even when local has one ---'
  );
  {
    const existingShared = {
      preferredDescriptions: {
        300: { tally: {}, override: { key: '111000', candidate: { description: 'Previously-enforced decision' } } },
      },
      conceptRemap: {},
    };
    const localSnapshot = {
      preferredDescriptions: {
        300: {
          tally: {},
          override: { key: '999999', candidate: { description: "Admin's own incidental local pick" } },
        },
      },
      conceptRemap: {},
    };
    const merged = problemDescriptionCleanupMergeForPublish(existingShared, localSnapshot, { includeOverride: false });
    check(
      merged.preferredDescriptions['300'].override.key === '111000',
      "includeOverride:false: the previously-enforced override survives even though local has a DIFFERENT one set — an unattended publish never silently changes what's enforced"
    );
  }
  {
    // Tallies still merge (via max()) even when includeOverride is false —
    // only the override field is protected, not the whole entry.
    const existingShared = {
      preferredDescriptions: {
        90823000: {
          tally: { 111111: { candidate: { description: 'Shared' }, count: 5, lastUsed: '2026-07-28T09:00:00Z' } },
          override: null,
        },
      },
      conceptRemap: {},
    };
    const localSnapshot = {
      preferredDescriptions: {
        90823000: {
          tally: { 111111: { candidate: { description: 'Local' }, count: 30, lastUsed: '2026-07-29T09:00:00Z' } },
          override: null,
        },
      },
      conceptRemap: {},
    };
    const merged = problemDescriptionCleanupMergeForPublish(existingShared, localSnapshot, { includeOverride: false });
    check(
      merged.preferredDescriptions['90823000'].tally['111111'].count === 30,
      'includeOverride:false: tallies still reconcile via max() (30) — only the override field is protected'
    );
  }

  console.log('\n--- problemDescriptionCleanupMergeForPublish: null/malformed inputs never throw ---');
  check(
    (() => {
      const r = problemDescriptionCleanupMergeForPublish(null, null);
      return r && typeof r.preferredDescriptions === 'object' && typeof r.conceptRemap === 'object';
    })(),
    'both args null -> empty-but-valid merged shape, no throw'
  );
  check(
    (() => {
      const r = problemDescriptionCleanupMergeForPublish(undefined, undefined);
      return r && typeof r.preferredDescriptions === 'object' && typeof r.conceptRemap === 'object';
    })(),
    'both args undefined -> empty-but-valid merged shape, no throw'
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
