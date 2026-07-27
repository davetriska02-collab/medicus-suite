// Medicus Suite — problem-bulk-end ("Bulk end problems" on the Clinical
// Summary) tests
// Run with: node test-problem-bulk-end.js
//
// Live Medicus and the DOM aren't available here, so only the pure logic is
// exercised: the end-problem POST payload (same confirmed three-field
// contract as problem-junk-code-cleanup.js), which rows are selectable
// (isEndable), the double-layer submit guard (canSubmit — the thing that
// keeps an empty endDate/reason off the record), the ENDING/KEEPING
// partition behind the confirm step, and the API error-body extraction.

'use strict';

const {
  DEFAULT_REASON,
  buildEndProblemPayload,
  isEndable,
  canSubmit,
  partitionSelection,
  apiErrorMessage,
} = require('./content-scripts/problem-bulk-end.js');

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

console.log('--- buildEndProblemPayload: the confirmed clinical/problem/end-problem contract ---');
{
  const payload = buildEndProblemPayload('prob-1', '2026-07-27', 'Resolved');
  check(payload.problemId === 'prob-1', 'problemId passed through');
  check(payload.endDate === '2026-07-27', 'endDate passed through');
  check(payload.reason === 'Resolved', 'reason passed through');
  check(
    Object.keys(payload).sort().join(',') === 'endDate,problemId,reason',
    'exactly the three confirmed fields, nothing extra'
  );
}

console.log('--- isEndable: which rows are selectable ---');
{
  check(isEndable({ ended: false, activeChildCount: 0 }) === true, 'not ended, no active children -> endable');
  check(isEndable({ ended: true, activeChildCount: 0 }) === false, 'already ended this session -> not endable again');
  check(
    isEndable({ ended: false, activeChildCount: 2 }) === false,
    'has active child problems -> excluded, not just warned'
  );
  check(isEndable({ ended: false }) === true, 'missing activeChildCount treated as 0, not a crash');
  check(isEndable(null) === false, 'null entry -> not endable, never throws');
}

console.log('--- canSubmit: the double-layer guard (buttons AND the POST path both check this) ---');
{
  check(canSubmit(3, '2026-07-27', 'Resolved', false) === true, 'selection + date + reason + idle -> submittable');
  check(canSubmit(0, '2026-07-27', 'Resolved', false) === false, 'nothing selected -> blocked');
  check(canSubmit(3, '', 'Resolved', false) === false, 'empty endDate -> blocked (never POST endDate: "")');
  check(canSubmit(3, null, 'Resolved', false) === false, 'null endDate -> blocked, never throws');
  check(canSubmit(3, '2026-07-27', '', false) === false, 'empty reason -> blocked (never POST reason: "")');
  check(canSubmit(3, '2026-07-27', '   ', false) === false, 'whitespace-only reason -> blocked, not just non-empty');
  check(canSubmit(3, '2026-07-27', null, false) === false, 'null reason -> blocked, never throws');
  check(canSubmit(3, '2026-07-27', 'Resolved', true) === false, 'a batch already in flight -> blocked (no doubles)');
  check(DEFAULT_REASON.trim().length > 0, 'the shipped default reason itself passes the guard');
}

console.log('--- partitionSelection: the ENDING/KEEPING split behind the confirm step ---');
{
  const rows = [
    { id: 'a', description: 'Old sprain', checked: true, ended: false, activeChildCount: 0 },
    { id: 'b', description: 'Heart failure', checked: false, ended: false, activeChildCount: 0 },
    { id: 'c', description: 'Linked parent', checked: true, ended: false, activeChildCount: 2 },
    { id: 'd', description: 'Already ended', checked: false, ended: true, activeChildCount: 0 },
  ];
  const parts = partitionSelection(rows);
  check(parts.ending.length === 1 && parts.ending[0].id === 'a', 'only checked AND endable rows are in ENDING');
  check(
    parts.keeping.some((r) => r.id === 'b'),
    'an unchecked row is in KEEPING'
  );
  check(
    parts.keeping.some((r) => r.id === 'c'),
    'a checked row with linked problems stays in KEEPING — the checkbox alone cannot override the exclusion'
  );
  check(
    !parts.ending.concat(parts.keeping).some((r) => r.id === 'd'),
    'a row already ended this session appears in neither list'
  );
  check(partitionSelection(null).ending.length === 0, 'null rows -> empty partitions, never throws');
  check(partitionSelection([]).keeping.length === 0, 'empty rows -> empty partitions');
}

console.log('--- apiErrorMessage: same server-reason surfacing as problem-description-cleanup ---');
{
  check(apiErrorMessage(400, '') === 'API 400', 'no body -> bare status');
  check(
    apiErrorMessage(400, '{"message":"endDate must not be in the future"}') ===
      'API 400 — endDate must not be in the future',
    'a JSON body with .message surfaces the message'
  );
  check(
    apiErrorMessage(422, '{"errors":{"reason":"is required"}}') === 'API 422 — {"reason":"is required"}',
    'a JSON body with an .errors object surfaces the per-field errors'
  );
  check(apiErrorMessage(500, 'Internal Server Error') === 'API 500 — Internal Server Error', 'non-JSON body as-is');
  {
    const long = 'a'.repeat(500);
    check(apiErrorMessage(400, long).endsWith('…'), 'a long body is truncated with an ellipsis');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
