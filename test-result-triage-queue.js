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

  // rule-driven red (top.ruleLabel set) → attributable queue.resultRuleUrgent
  const ruleRed = {
    level: 'red', urgentCount: 1, abnormalCount: 1,
    top: { name: 'Potassium', value: '6.7', unit: 'mmol/L', ruleLabel: 'Critical high potassium' },
    misprioritised: false, unmatched: false,
  };
  const ruleRedChips = selectResultChips(ruleRed);
  check(ruleRedChips.some((c) => c.id === 'queue.resultRuleUrgent'), 'rule-driven red → queue.resultRuleUrgent');
  check(!ruleRedChips.some((c) => c.id === 'queue.resultUrgent'), 'rule-driven red → NOT the generic resultUrgent');
  const rru = ruleRedChips.find((c) => c.id === 'queue.resultRuleUrgent');
  check(
    rru && rru.vars.rule === 'Critical high potassium' && rru.vars.name === 'Potassium',
    'resultRuleUrgent carries {name} and {rule}'
  );

  // rule-driven amber → attributable queue.resultRuleAbnormal
  const ruleAmber = {
    level: 'amber', urgentCount: 0, abnormalCount: 1,
    top: { name: 'HbA1c', value: '44', unit: 'mmol/mol', ruleLabel: 'Prediabetes range' },
    misprioritised: false, unmatched: false,
  };
  const ruleAmberChips = selectResultChips(ruleAmber);
  check(ruleAmberChips.some((c) => c.id === 'queue.resultRuleAbnormal'), 'rule-driven amber → queue.resultRuleAbnormal');
  check(!ruleAmberChips.some((c) => c.id === 'queue.resultAbnormal'), 'rule-driven amber → NOT the generic resultAbnormal');

  // lab-driven (no ruleLabel) → generic chips unchanged
  const labRed = {
    level: 'red', urgentCount: 1, abnormalCount: 1,
    top: { name: 'RDW', value: '16.7', unit: '%', ruleLabel: null },
    misprioritised: false, unmatched: false,
  };
  check(
    selectResultChips(labRed).some((c) => c.id === 'queue.resultUrgent'),
    'lab-driven red (null ruleLabel) → generic resultUrgent'
  );

  // text-review with a SPECIFIC rule label (e.g. bowel non-responder) → attributable chip
  const reviewLabelled = {
    level: 'amber', urgentCount: 0, abnormalCount: 0,
    top: null, misprioritised: false, unmatched: false,
    reviewCount: 1, reviewTop: { name: 'BCS:FOB result', label: 'Bowel screening: no response' },
  };
  const reviewLabelledChips = selectResultChips(reviewLabelled);
  check(
    reviewLabelledChips.some((c) => c.id === 'queue.resultReviewRule'),
    'labelled text review → queue.resultReviewRule'
  );
  check(
    !reviewLabelledChips.some((c) => c.id === 'queue.resultReview'),
    'labelled text review → NOT the generic resultReview'
  );
  const rrr = reviewLabelledChips.find((c) => c.id === 'queue.resultReviewRule');
  check(
    rrr && rrr.vars.rule === 'Bowel screening: no response',
    'resultReviewRule carries the rule label in {rule}'
  );

  // text-review with the GENERIC "Needs review" label (e.g. a culture) → generic chip
  const reviewGeneric = {
    level: 'amber', urgentCount: 0, abnormalCount: 0,
    top: null, misprioritised: false, unmatched: false,
    reviewCount: 2, reviewTop: { name: 'MSU', label: 'Needs review' },
  };
  const reviewGenericChips = selectResultChips(reviewGeneric);
  check(
    reviewGenericChips.some((c) => c.id === 'queue.resultReview'),
    'generic "Needs review" text review → generic queue.resultReview (cultures unchanged)'
  );
  check(
    !reviewGenericChips.some((c) => c.id === 'queue.resultReviewRule'),
    'generic "Needs review" text review → NOT the attributable chip'
  );

  // text-noGrowth with a CUSTOM normal label (e.g. "Negative" H. pylori) → attributable
  // chip carrying that label, NOT the generic "No growth". This is the reported bug: the
  // chip must read the matched rule's normalLabel (sev.noGrowthTop.label), not the
  // hard-coded generic system-chip text.
  const noGrowthLabelled = {
    level: 'none', urgentCount: 0, abnormalCount: 0,
    top: null, misprioritised: false, unmatched: false,
    noGrowthCount: 1, noGrowthTop: { name: 'Helicobacter pylori stool antigen', label: 'Negative' },
  };
  const noGrowthLabelledChips = selectResultChips(noGrowthLabelled);
  check(
    noGrowthLabelledChips.some((c) => c.id === 'queue.resultNoGrowthRule'),
    'custom normal label → queue.resultNoGrowthRule'
  );
  check(
    !noGrowthLabelledChips.some((c) => c.id === 'queue.resultNoGrowth'),
    'custom normal label → NOT the generic resultNoGrowth'
  );
  const ngr = noGrowthLabelledChips.find((c) => c.id === 'queue.resultNoGrowthRule');
  check(
    ngr && ngr.vars.label === 'Negative',
    'resultNoGrowthRule carries the rule normalLabel in {label}'
  );

  // text-noGrowth with the DEFAULT "No growth" label (e.g. an MSU culture) → generic chip
  const noGrowthGeneric = {
    level: 'none', urgentCount: 0, abnormalCount: 0,
    top: null, misprioritised: false, unmatched: false,
    noGrowthCount: 2, noGrowthTop: { name: 'MSU', label: 'No growth' },
  };
  const noGrowthGenericChips = selectResultChips(noGrowthGeneric);
  check(
    noGrowthGenericChips.some((c) => c.id === 'queue.resultNoGrowth'),
    'default "No growth" normal label → generic queue.resultNoGrowth (cultures unchanged)'
  );
  check(
    !noGrowthGenericChips.some((c) => c.id === 'queue.resultNoGrowthRule'),
    'default "No growth" normal label → NOT the attributable chip'
  );

  // text-noGrowth with NO noGrowthTop (defensive) → falls back to the generic chip
  const noGrowthNoTop = {
    level: 'none', urgentCount: 0, abnormalCount: 0,
    top: null, misprioritised: false, unmatched: false,
    noGrowthCount: 1,
  };
  const noGrowthNoTopChips = selectResultChips(noGrowthNoTop);
  check(
    noGrowthNoTopChips.some((c) => c.id === 'queue.resultNoGrowth'),
    'noGrowth with no noGrowthTop → generic queue.resultNoGrowth (defensive fallback)'
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

// refreshQueueChips() must re-DISPLAY result chips on every grid re-render — otherwise
// AG Grid strips the .ch-q-result chips and they never come back. It does this via
// reinjectCachedResultChips (durable, from the per-task cache), NOT by kicking a fetch
// pass (that re-started/aborted the worker and starved it — only the first few rows got
// tagged). Guard both: re-injection present, fetch-trigger absent.
const rqcMatch = src.match(/const refreshQueueChips = \(\) => \{[\s\S]*?\n {2}\};/);
check(!!rqcMatch, 'refreshQueueChips function found');
if (rqcMatch) {
  check(
    /reinjectCachedResultChips\(\)/.test(rqcMatch[0]),
    'refreshQueueChips re-displays result chips via reinjectCachedResultChips() (durable)'
  );
  check(
    !/scheduleQueueResultTriage\(\)/.test(rqcMatch[0]),
    'refreshQueueChips does NOT kick a fetch pass (would starve the worker)'
  );
  check(
    /scheduleQueueMonitoring\(\)/.test(rqcMatch[0]),
    'refreshQueueChips still re-runs scheduleQueueMonitoring()'
  );
  // v3.72.0 — observer reuse: refreshQueueChips must NOT null the container then call
  // setupQueueObserver() (that forced a needless full rebuild on every grid mutation);
  // it re-arms the SAME observer instead.
  check(
    !/queueObservedContainer = null;\s*\n\s*setupQueueObserver\(\)/.test(rqcMatch[0]),
    'refreshQueueChips no longer nulls the container then rebuilds the observer (reuses it)'
  );
  // v3.72.0 — grid-scoped sweeps: the wipe/re-decorate sweeps must run over queueScope(),
  // not the whole document (so the per-frame cost scales with the grid, not the page).
  check(
    !/document\.querySelectorAll\('\.ch-queue-chips/.test(rqcMatch[0]),
    'refreshQueueChips wipe sweep is grid-scoped (queueScope), not document-wide'
  );
}

// ============================================================
// Layer 3b — v3.72.0 performance plan: visible-first ordering, concurrency,
// budget-aware backoff, memoised chip HTML, on-screen re-injection.
// ============================================================
console.log('Layer 3b: v3.72.0 result-triage performance wiring');

// (a) scheduleQueueResultTriage: on-screen partition first, concurrency 5, soft budget.
check(/onScreen/.test(src), 'scheduleQueueResultTriage builds an on-screen partition (visible-first ordering)');
check(/CONCURRENCY = 5/.test(src), 'result-triage concurrency is 5');
check(/_RESULT_FETCH_SOFT/.test(src), '_RESULT_FETCH_SOFT (budget-aware backoff threshold) is present');

// (b) Memoised chip HTML + cache invalidation on config change.
check(/_chipHtmlMemo/.test(src), '_chipHtmlMemo (rendered chip HTML memo) is present');
const watchForMemo = src.match(/watchConfig\(\(\) => \{[\s\S]*?\n {4}\}\);/);
check(
  !!watchForMemo && /_chipHtmlMemo\.clear\(\)/.test(watchForMemo[0]),
  'config change clears _chipHtmlMemo (edited labels/kinds re-render, not stale)'
);

// (c) reinjectCachedResultChips iterates on-screen rows, still keyed via _durableRowMap,
//     still TTL-gated.
const ricMatch = src.match(/const reinjectCachedResultChips = \(\) => \{[\s\S]*?\n {2}\};/);
check(!!ricMatch, 'reinjectCachedResultChips function found');
if (ricMatch) {
  check(
    /\.ag-row\[row-index\]/.test(ricMatch[0]),
    'reinjectCachedResultChips iterates on-screen .ag-row[row-index] rows'
  );
  check(
    /_durableRowMap\.get\(/.test(ricMatch[0]),
    'reinjectCachedResultChips still keyed via _durableRowMap.get(rowIndex) → taskUuid'
  );
  check(
    /_RESULT_CACHE_TTL/.test(ricMatch[0]),
    'reinjectCachedResultChips still honours _RESULT_CACHE_TTL'
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
// Layer 3c — v3.73.0 performance plan: visible burst un-throttled, leading-edge
// first fetch pass, MutationObserver own-chip self-trigger suppression.
// ============================================================
console.log('Layer 3c: v3.73.0 result-triage scheduler/observer wiring');

// (a) The worker applies a ZERO inter-fetch delay for on-screen rows (the off-screen
//     tail keeps the computed 100ms→1000ms backoff).
if (sqrtMatch) {
  check(
    /onScreen\.has\(rowIndex\)\s*\n?\s*\?\s*0/.test(sqrtMatch[0]),
    'worker applies a zero inter-fetch delay for on-screen rows (visible burst un-throttled)'
  );
}

// (b) Leading-edge FIRST fetch pass per queue entry (skips the 150ms debounce once).
check(/_firstResultPassPending/.test(src), 'leading-edge first fetch pass flag (_firstResultPassPending) present');

// (c) The queue MutationObserver ignores batches that are entirely our own chip injections.
check(/_isOwnChipMutation/.test(src), 'MutationObserver self-trigger suppression (_isOwnChipMutation) present');

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
