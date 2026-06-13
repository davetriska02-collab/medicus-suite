// Medicus Suite — Investigation Results queue triage chip tests
// Run with: node test-result-triage-queue.js

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// ============================================================
// Layer 1 — selectResultChips() pure helper
// ============================================================
console.log('Layer 1: selectResultChips() chip-selection logic');

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// Extract the standalone function from the IIFE
const fnMatch = src.match(/function selectResultChips\(sev\) \{[\s\S]*?\n  \}/);
check(!!fnMatch, 'selectResultChips function found in content.js');

let selectResultChips = null;
if (fnMatch) {
  const sandbox = {};
  vm.runInNewContext(fnMatch[0] + '\nthis.selectResultChips = selectResultChips;', sandbox);
  selectResultChips = sandbox.selectResultChips;
  check(typeof selectResultChips === 'function', 'selectResultChips extracted and callable');
}

if (selectResultChips) {
  // red + urgentCount > 0 -> resultUrgent
  const redSev = {
    level: 'red',
    urgentCount: 2,
    abnormalCount: 2,
    top: { name: 'Potassium', value: '6.8', unit: 'mmol/L' },
    misprioritised: false,
    unmatched: false,
  };
  const redChips = selectResultChips(redSev);
  check(redChips.length === 1, `red urgent: 1 chip (got ${redChips.length})`);
  check(
    redChips[0] && redChips[0].id === 'queue.resultUrgent',
    `red urgent: chip id is queue.resultUrgent (got ${redChips[0] && redChips[0].id})`
  );
  check(
    redChips[0] && redChips[0].vars.name === 'Potassium',
    `red urgent: vars.name is 'Potassium' (got ${redChips[0] && redChips[0].vars.name})`
  );
  check(
    redChips[0] && redChips[0].vars.count === 2,
    `red urgent: vars.count is 2 (got ${redChips[0] && redChips[0].vars.count})`
  );

  // amber -> resultAbnormal
  const amberSev = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 3,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const amberChips = selectResultChips(amberSev);
  check(amberChips.length === 1, `amber: 1 chip (got ${amberChips.length})`);
  check(amberChips[0] && amberChips[0].id === 'queue.resultAbnormal', `amber: chip id is queue.resultAbnormal`);
  check(amberChips[0] && amberChips[0].vars.count === 3, `amber: vars.count is 3`);

  // misprioritised adds resultMisprioritised
  const misSev = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: { name: 'Sodium', value: '125', unit: 'mmol/L' },
    misprioritised: true,
    unmatched: false,
  };
  const misChips = selectResultChips(misSev);
  check(misChips.length === 2, `misprioritised: 2 chips (got ${misChips.length})`);
  check(
    misChips.some((c) => c.id === 'queue.resultMisprioritised'),
    'misprioritised: includes queue.resultMisprioritised'
  );
  check(
    misChips.find((c) => c.id === 'queue.resultMisprioritised')?.meta === true,
    'misprioritised: meta flag is true'
  );
  check(
    misChips.find((c) => c.id === 'queue.resultUrgent')?.meta !== true,
    'urgent (clinical): meta flag is falsy'
  );

  // unmatched adds resultUnmatched
  const unmatchSev = {
    level: 'amber',
    urgentCount: 0,
    abnormalCount: 1,
    top: null,
    misprioritised: false,
    unmatched: true,
  };
  const unmatchChips = selectResultChips(unmatchSev);
  check(unmatchChips.length === 2, `unmatched: 2 chips (got ${unmatchChips.length})`);
  check(
    unmatchChips.some((c) => c.id === 'queue.resultUnmatched'),
    'unmatched: includes queue.resultUnmatched'
  );
  check(
    unmatchChips.find((c) => c.id === 'queue.resultUnmatched')?.meta === true,
    'unmatched: meta flag is true'
  );
  check(
    unmatchChips.find((c) => c.id === 'queue.resultAbnormal')?.meta !== true,
    'abnormal (clinical): meta flag is falsy'
  );

  // none -> no chips
  const noneSev = {
    level: 'none',
    urgentCount: 0,
    abnormalCount: 0,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const noneChips = selectResultChips(noneSev);
  check(noneChips.length === 0, `none: 0 chips (got ${noneChips.length})`);

  // null input -> []
  check(selectResultChips(null).length === 0, 'null input returns []');
  check(selectResultChips(undefined).length === 0, 'undefined input returns []');

  // red with urgentCount=0 falls back to amber path (no urgentCount chips)
  const redNoUrgent = {
    level: 'red',
    urgentCount: 0,
    abnormalCount: 2,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const redNoUrgentChips = selectResultChips(redNoUrgent);
  check(!redNoUrgentChips.some((c) => c.id === 'queue.resultUrgent'), 'red urgentCount=0: no resultUrgent chip');

  // top null for urgent -> name is empty string
  const noTopSev = {
    level: 'red',
    urgentCount: 1,
    abnormalCount: 1,
    top: null,
    misprioritised: false,
    unmatched: false,
  };
  const noTopChips = selectResultChips(noTopSev);
  check(
    noTopChips[0] && noTopChips[0].vars.name === '',
    `red urgent no top: vars.name is empty string (got "${noTopChips[0] && noTopChips[0].vars.name}")`
  );
}

// ============================================================
// Layer 2 — overviewURL validation regex
// ============================================================
console.log('Layer 2: overviewURL validation regex');

// Extract the regex from content.js
const reMatch = src.match(/_OVERVIEW_URL_RE\s*=\s*(\/[^\n]+\/)/);
check(!!reMatch, '_OVERVIEW_URL_RE found in content.js');

let OVERVIEW_URL_RE = null;
if (reMatch) {
  try {
    // Extract pattern and flags from the regex literal
    const reStr = reMatch[1];
    const lastSlash = reStr.lastIndexOf('/');
    const pattern = reStr.slice(1, lastSlash);
    const flags = reStr.slice(lastSlash + 1);
    OVERVIEW_URL_RE = new RegExp(pattern, flags);
    check(true, '_OVERVIEW_URL_RE parsed from source');
  } catch (e) {
    check(false, `_OVERVIEW_URL_RE failed to parse: ${e.message}`);
  }
}

if (OVERVIEW_URL_RE) {
  // Valid paths
  check(
    OVERVIEW_URL_RE.test('/tasks/data/review-investigation-report/overview/550e8400-e29b-41d4-a716-446655440000'),
    'accepts real overview URL path'
  );
  check(
    OVERVIEW_URL_RE.test('/tasks/data/review_investigation_results_task/overview/550e8400-e29b-41d4-a716-446655440000'),
    'accepts underscore slug'
  );

  // Invalid paths — absolute URL with host
  check(
    !OVERVIEW_URL_RE.test(
      'https://example.medicus.health/tasks/data/review-investigation-report/overview/550e8400-e29b-41d4-a716-446655440000'
    ),
    'rejects https:// absolute URL'
  );
  // Path traversal
  check(!OVERVIEW_URL_RE.test('/tasks/data/../../../etc/passwd'), 'rejects path traversal with ..');
  // Absolute path with host embedded
  check(
    !OVERVIEW_URL_RE.test(
      '//evil.com/tasks/data/review-investigation-report/overview/550e8400-e29b-41d4-a716-446655440000'
    ),
    'rejects protocol-relative URL'
  );
  // Empty string
  check(!OVERVIEW_URL_RE.test(''), 'rejects empty string');
}

// ============================================================
// Layer 3 — result-chip re-injection wiring (regression guards)
// ============================================================
console.log('Layer 3: result-chip re-injection & cache-invalidation wiring');

// refreshQueueChips() must re-run result triage, not just monitoring — otherwise
// AG Grid re-renders strip the .ch-q-result chips and they never come back (the
// bug that made every result rule and lab-flagged urgent look dead on the queue).
const rqcMatch = src.match(/const refreshQueueChips = \(\) => \{[\s\S]*?\n {2}\};/);
check(!!rqcMatch, 'refreshQueueChips function found');
if (rqcMatch) {
  check(
    /scheduleQueueResultTriage\(\)/.test(rqcMatch[0]),
    'refreshQueueChips re-runs scheduleQueueResultTriage() (chips survive grid re-renders)'
  );
  check(
    /scheduleQueueMonitoring\(\)/.test(rqcMatch[0]),
    'refreshQueueChips still re-runs scheduleQueueMonitoring()'
  );
}

// A config change must invalidate the cached per-row result severities so an
// edited/enabled rule is recomputed rather than re-shown stale.
const watchMatch = src.match(/watchConfig\(\(\) => \{[\s\S]*?\n {4}\}\);/);
check(!!watchMatch, 'watchConfig(onChange) callback found');
if (watchMatch) {
  check(
    /_queueResultCache\.values\(\)[\s\S]*?\.sev = undefined/.test(watchMatch[0]),
    'config change invalidates cached _queueResultCache severities (recompute, not stale)'
  );
}

// scheduleQueueResultTriage must release its run latch in a finally so a thrown
// worker cannot permanently block every future result-triage pass.
const sqrtMatch = src.match(/const scheduleQueueResultTriage = async \(\) => \{[\s\S]*?\n {2}\};/);
check(!!sqrtMatch, 'scheduleQueueResultTriage function found');
if (sqrtMatch) {
  check(
    /finally\s*\{[\s\S]*?_queueResultRunning = false/.test(sqrtMatch[0]),
    'scheduleQueueResultTriage resets _queueResultRunning in a finally block'
  );
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
