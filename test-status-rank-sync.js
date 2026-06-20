// Medicus Suite — STATUS_RANK cross-surface parity test
// Run with: node test-status-rank-sync.js
//
// Guards a SILENT drift hazard. The status-severity rank table exists in two
// places by necessity of the module split:
//   - engine/rules-engine.js  (CJS/global IIFE) EMITS chip statuses and ranks
//     them for its own sort.
//   - side-panel/modules/sentinel/sentinel-core.js (ESM) ranks/filters those
//     same statuses for the side-panel + pop-out UI (and re-exports to
//     sentinel.js / brief-core.js / passport-core.js).
//
// A key present in one table but missing from the other falls through to the
// `?? 99` default and ranks DIFFERENTLY across surfaces — e.g. a vaccine chip
// the engine ranks 1 (severe-amber) but the panel ranks 99 (sorted last,
// excluded from the action filter). That is exactly how vax_due/vax_given/
// vax_declined drifted before this test existed. We pin the two tables to
// deep-equality so any future divergence fails CI instead of silently
// mis-ranking a clinical chip.

'use strict';

const path = require('path');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

async function run() {
  const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
  const engineRank = engine.STATUS_RANK;
  check(engineRank && typeof engineRank === 'object', 'engine exports STATUS_RANK');

  const coreMod = await import('./side-panel/modules/sentinel/sentinel-core.js');
  const coreRank = coreMod.STATUS_RANK;
  check(coreRank && typeof coreRank === 'object', 'sentinel-core.js exports STATUS_RANK');

  if (!engineRank || !coreRank) {
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
    return;
  }

  const engineKeys = Object.keys(engineRank).sort();
  const coreKeys = Object.keys(coreRank).sort();

  console.log('\n--- key-set parity ---');
  const missingFromCore = engineKeys.filter((k) => !(k in coreRank));
  const missingFromEngine = coreKeys.filter((k) => !(k in engineRank));
  check(
    missingFromCore.length === 0,
    `every engine status is ranked in sentinel-core.js${
      missingFromCore.length ? ` (missing: ${missingFromCore.join(', ')})` : ''
    }`
  );
  check(
    missingFromEngine.length === 0,
    `every sentinel-core status exists in the engine${
      missingFromEngine.length ? ` (extra: ${missingFromEngine.join(', ')})` : ''
    }`
  );

  console.log('\n--- value parity ---');
  for (const k of engineKeys) {
    if (!(k in coreRank)) continue;
    check(
      engineRank[k] === coreRank[k],
      `rank for "${k}" matches across surfaces (engine=${engineRank[k]}, core=${coreRank[k]})`
    );
  }

  // Sanity floor: the worst-first contract (0 = most urgent) must hold so the
  // `<= 2` action filter and `>= 5` all-clear filter keep their meaning.
  console.log('\n--- contract sanity ---');
  check(engineRank.overdue === 0 && engineRank.alert === 0, 'red statuses rank 0 (top of action filter)');
  check(engineRank.in_date === 5 && engineRank.achieved === 5, 'in-date/achieved rank 5 (all-clear filter)');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
