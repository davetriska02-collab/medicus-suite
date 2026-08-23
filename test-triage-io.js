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

  let threw = false;
  try {
    await IO.triageImport({ config: { systemChips: 'not-a-list' } });
  } catch (e) {
    threw = /must be an array/.test(e.message);
  }
  check(threw, 'import with a non-array systemChips throws before any write');

  if (failed) {
    console.error(`\n${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\nAll ${passed} checks passed`);
})();
