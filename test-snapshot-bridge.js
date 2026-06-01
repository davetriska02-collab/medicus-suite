// Medicus Suite — Sentinel snapshot-bridge regression tests
// Run with: node test-snapshot-bridge.js
//
// Guards the fix for the "QOF rules flash up then vanish on journal search" bug.
//
// Root cause: content-scripts/sentinel.js used to monkeypatch the shared global
// window.SentinelRules.evaluatePatient so that *any* call stored _lastSnapshot as
// a side effect. The triage-lens HUD (content-scripts/triage-lens/content.js)
// calls that SAME global with a drug-rules-only ruleset on every record/route
// tick (e.g. when searching the journal), so it overwrote the side-panel snapshot
// with QOF-less chips. The fix decouples the bridge: only publishSnapshot (called
// from evaluateAndPublish with the full merged ruleset) may write _lastSnapshot.
//
// These are source-level invariants — the bridge lives inside an IIFE in a
// content script and can't be imported, so we assert the dangerous patterns stay
// gone rather than re-introduce a regression that only shows up in the browser.

'use strict';
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const sentinel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');
const triage   = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

console.log('--- snapshot bridge must not be driven by the shared engine global ---');

// The monkeypatch that caused the bug: reassigning the shared evaluatePatient.
check(!/SentinelRules\.evaluatePatient\s*=/.test(sentinel),
  'sentinel.js does NOT reassign window.SentinelRules.evaluatePatient (no global monkeypatch)');

// Only the two intended writers may assign _lastSnapshot: publishSnapshot (good
// data) and invalidateSnapshot (cleared/unavailable). Anything else risks a
// partial-ruleset or stale caller clobbering the QOF chips.
// Exclude the `let _lastSnapshot = null` declaration; count only re-assignments.
const lastSnapshotAssignments = (sentinel.match(/(?<!let\s)_lastSnapshot\s*=(?!=)/g) || []).length;
check(lastSnapshotAssignments === 2,
  `_lastSnapshot is re-assigned in exactly 2 places (found ${lastSnapshotAssignments}: publishSnapshot + invalidateSnapshot)`);

check(/function publishSnapshot\(/.test(sentinel),
  'publishSnapshot() exists as the single good-data writer');

check(/publishSnapshot\(\s*chips\s*,\s*data\.patientContext/.test(sentinel),
  'evaluateAndPublish publishes via publishSnapshot with the chips it evaluated');

console.log('\n--- triage-lens still uses the shared global (confirms the hazard is real) ---');

// Sanity: the triage-lens HUD really does call the shared engine with a
// drug-rules-only set. If this ever stops being true the decoupling is moot, but
// while it holds, the bridge must stay decoupled.
check(/engine\s*=\s*window\.SentinelRules/.test(triage),
  'triage-lens content.js uses window.SentinelRules (shared engine global)');
check(/rules\/drug-rules\.json/.test(triage) && !/qof-rules\.json/.test(triage),
  'triage-lens loads drug-rules only (no qof-rules) — would clobber QOF chips if it could write the snapshot');

console.log('\n--- stale-evaluation guard (race during journal-search churn) ---');

check(/_evalGen/.test(sentinel),
  'evaluation generation counter (_evalGen) present');
check(/const gen = \+\+_evalGen/.test(sentinel),
  'evaluateAndPublish captures a fresh generation before fetching');
check(/if \(gen !== _evalGen\) return/.test(sentinel),
  'stale async results are dropped instead of clobbering a newer snapshot');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
