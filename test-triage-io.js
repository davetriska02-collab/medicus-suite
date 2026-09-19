// Medicus Suite — triage-io import sanitisation tests
// Run with: node test-triage-io.js
//
// Pins the 2026-08-22 clinical-safety-audit fix: an imported triage config must
// never carry its own `version` integer into storage (an inflated version
// permanently strands the machine off every future mergeShippedDefaults
// migration of shipped rules/thresholds/chips), and the list-shaped fields the
// rules engine iterates must actually be lists.

'use strict';

const IO = require('./shared/io/triage-io.js');

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

// chrome.storage.local stub so triageImport is exercised end-to-end.
const STORE = {};
global.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (k in STORE) out[k] = STORE[k];
        });
        return out;
      },
      set: async (obj) => Object.assign(STORE, obj),
      remove: async (k) => {
        delete STORE[k];
      },
    },
  },
};

console.log('--- sanitiseTriageConfigForImport ---');
{
  const clean = IO.sanitiseTriageConfigForImport({ version: 999999, prefs: { a: 1 }, rules: [] });
  check(!('version' in clean), 'imported config version is DROPPED (migration-stranding guard)');
  check(clean.prefs && clean.prefs.a === 1, 'other fields pass through untouched');
}
{
  let threw = false;
  try {
    IO.sanitiseTriageConfigForImport({ resultRules: { evil: true } });
  } catch (e) {
    threw = /must be an array/.test(e.message);
  }
  check(threw, 'non-array resultRules is rejected, not written');
}

(async () => {
  console.log('\n--- triageImport end-to-end ---');
  await IO.triageImport({ config: { version: 424242, prefs: { oirAutoTick: false }, rules: [{ id: 'r1' }] } });
  const stored = STORE['triagelens.config'];
  check(!!stored, 'config written to triagelens.config');
  check(!('version' in stored), 'stored config carries NO version — next mergeShippedDefaults re-runs');
  check(Array.isArray(stored.rules) && stored.rules[0].id === 'r1', 'rules array restored');

  // systemChips is a MAP keyed by chip id, not a list (defaults.json, content.js
  // mergeShippedDefaults and the options validator all agree). The 2026-08-23
  // sanitiser demanded an array, so every real backup failed to restore
  // (reported 2026-09-19: "systemChips must be an array — no changes were applied").
  for (const bad of ['not-a-map', ['queue.child'], null]) {
    let threw = false;
    delete STORE['triagelens.config'];
    try {
      await IO.triageImport({ config: { systemChips: bad } });
    } catch (e) {
      threw = /systemChips must be an object/.test(e.message);
    }
    check(threw, `import with systemChips = ${JSON.stringify(bad)} throws before any write`);
    check(!('triagelens.config' in STORE), `  …and nothing was written (${JSON.stringify(bad)})`);
  }

  // The real shipped shape must restore — this is the regression.
  const shipped = require('./defaults.json');
  check(
    shipped.systemChips && typeof shipped.systemChips === 'object' && !Array.isArray(shipped.systemChips),
    'sanity: defaults.json ships systemChips as an object map'
  );
  delete STORE['triagelens.config'];
  await IO.triageImport({
    config: {
      version: shipped.version,
      rules: shipped.rules,
      resultRules: shipped.resultRules,
      systemChips: {
        ...shipped.systemChips,
        'queue.child': { enabled: false, label: 'Custom child', kind: 'amber', actions: [] },
      },
    },
  });
  const restored = STORE['triagelens.config'];
  check(!!restored, 'a config carrying the real systemChips map restores');
  check(
    Object.keys(restored.systemChips).length === Object.keys(shipped.systemChips).length,
    'every system chip survives the restore'
  );
  check(restored.systemChips['queue.child'].label === 'Custom child', 'a user-customised chip is preserved verbatim');
  check(!('version' in restored), 'version is still dropped (migration-stranding guard unchanged)');

  // Full backup round-trip through the same sanitiser: export shape in, same shape out.
  const roundTrip = IO.sanitiseTriageConfigForImport(JSON.parse(JSON.stringify(shipped)));
  check(
    Array.isArray(roundTrip.rules) && Array.isArray(roundTrip.resultRules) && !Array.isArray(roundTrip.systemChips),
    'the entire shipped defaults.json passes the sanitiser with its shapes intact'
  );
  check(
    (() => {
      try {
        IO.sanitiseTriageConfigForImport({ rules: {} });
        return false;
      } catch (e) {
        return /rules must be an array/.test(e.message);
      }
    })(),
    'rules / resultRules are still required to be arrays'
  );

  if (failed) {
    console.error(`\n${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\nAll ${passed} checks passed`);
})();
