// Medicus Suite — Backup key round-trip tests
// Run with: node test-backup-keys.js
//
// Guards the v3.21.x backup-wiring fixes (C1/C2/C3): the keys that were silently
// dropped from suite backups (suite.display, sentinel.alertLibrary.acknowledged)
// now survive an export → import round-trip, and the suite.* keys are owned by a
// proper IO module instead of raw reads/writes in doFullExport/applyEnvelope.
//
// Uses a tiny in-memory chrome.storage.local mock so the IO modules run in Node.

'use strict';

// ── in-memory chrome.storage.local mock ──────────────────────────────────────
const store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const out = {};
        ks.forEach(k => { if (k in store) out[k] = store[k]; });
        return out;
      },
      async set(obj) { Object.assign(store, obj); },
    },
  },
};

const { suiteExport, suiteImport } = require('./shared/io/suite-io.js');
const { sentinelExport, sentinelImport } = require('./shared/io/sentinel-io.js');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}
function reset() { for (const k of Object.keys(store)) delete store[k]; }

// ── C1 + C3: suite-io owns display / practiceCode / feedbackEmail ─────────────
(async () => {
  console.log('\n--- suite-io round-trip (C1/C3) ---');
  reset();
  const display = { theme: 'dark', textSize: 'large', colourblind: true };
  store['suite.display'] = display;
  store['suite.practiceCode'] = 'ABC12';
  store['suite.feedbackEmail'] = 'gp@example.nhs.uk';

  const exported = await suiteExport();
  check(JSON.stringify(exported.display) === JSON.stringify(display), 'suite.display is captured in export (was dropped before)');
  check(exported.practiceCode === 'ABC12' && exported.feedbackEmail === 'gp@example.nhs.uk', 'practiceCode + feedbackEmail captured');

  reset(); // simulate a fresh profile
  await suiteImport(exported);
  check(JSON.stringify(store['suite.display']) === JSON.stringify(display), 'suite.display restored on import');
  check(store['suite.practiceCode'] === 'ABC12' && store['suite.feedbackEmail'] === 'gp@example.nhs.uk', 'practiceCode + feedbackEmail restored');

  console.log('\n--- suite-io validation ---');
  await suiteImport({}); // no-op, must not throw
  check(true, 'empty import is a no-op (no throw)');
  let threw = false;
  try { await suiteImport({ practiceCode: 12345 }); } catch (_) { threw = true; }
  check(threw, 'rejects non-string practiceCode');
  threw = false;
  try { await suiteImport({ display: [1, 2] }); } catch (_) { threw = true; }
  check(threw, 'rejects non-object display');

  // ── C2: sentinel.alertLibrary.acknowledged survives round-trip ──────────────
  console.log('\n--- sentinel alert-library ack round-trip (C2) ---');
  reset();
  store['sentinel.config'] = { density: 'compact' };
  store['sentinel.alertLibrary.acknowledged'] = true;
  const sExp = await sentinelExport();
  check(sExp.alertLibraryAcknowledged === true, 'alertLibraryAcknowledged captured in export (was dropped before)');

  reset();
  await sentinelImport(sExp);
  check(store['sentinel.alertLibrary.acknowledged'] === true, 'alertLibraryAcknowledged restored on import (no re-prompt after restore)');

  let aThrew = false;
  try { await sentinelImport({ alertLibraryAcknowledged: 'yes' }); } catch (_) { aThrew = true; }
  check(aThrew, 'rejects non-boolean alertLibraryAcknowledged');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
