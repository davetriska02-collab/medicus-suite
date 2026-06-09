// Medicus Suite — Hidden-rule resurfacing tests
// Run with: node test-hidden-resurfacing.js
//
// Exercises the pure chipSuppressionResult() function exported from
// side-panel/modules/sentinel/sentinel.js.
// Uses vm to extract the function without requiring chrome APIs (mirrors the
// pattern in test-sentinel-panel-state.js).

'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else       { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── Extract chipSuppressionResult and its helpers from the ES module source ──
// The module uses `export function chipSuppressionResult` — strip the `export`
// keyword so vm.runInNewContext can parse it without ES-module support.
const src = fs.readFileSync(
  path.join(__dirname, 'side-panel', 'modules', 'sentinel', 'sentinel.js'), 'utf8'
);

// Extract COLOUR_RANK map, statusSeverityRank helper, and chipSuppressionResult.
// We rely on the fact that STATUS_COLOUR, COLOUR_RANK, statusSeverityRank, and
// chipSuppressionResult are all top-level declarations in the module.

// Extract STATUS_COLOUR (needed by statusSeverityRank)
const scMatch = src.match(/const STATUS_COLOUR\s*=\s*\{[\s\S]*?\};/);
check(!!scMatch, 'STATUS_COLOUR extracted from module');

// Extract COLOUR_RANK
const crMatch = src.match(/const COLOUR_RANK\s*=\s*\{[\s\S]*?\};/);
check(!!crMatch, 'COLOUR_RANK extracted from module');

// Extract statusSeverityRank
const ssrMatch = src.match(/function statusSeverityRank\([\s\S]*?\n\}/);
check(!!ssrMatch, 'statusSeverityRank extracted from module');

// Extract chipSuppressionResult (strip the `export` keyword)
const csrMatch = src.match(/export function chipSuppressionResult\([\s\S]*?\n\}/);
check(!!csrMatch, 'chipSuppressionResult extracted from module');

let chipSuppressionResult = null;
if (scMatch && crMatch && ssrMatch && csrMatch) {
  const snippet = [
    scMatch[0],
    crMatch[0],
    ssrMatch[0],
    csrMatch[0].replace(/^export\s+/, ''),
    'this.chipSuppressionResult = chipSuppressionResult;',
  ].join('\n');
  const sandbox = {};
  vm.runInNewContext(snippet, sandbox);
  chipSuppressionResult = sandbox.chipSuppressionResult;
  check(typeof chipSuppressionResult === 'function', 'chipSuppressionResult is callable');
}

if (!chipSuppressionResult) {
  console.error('Cannot run tests — chipSuppressionResult not extracted.');
  process.exit(1);
}

const TODAY = '2026-06-09';
const FUTURE = '2026-12-31';
const PAST   = '2025-01-01';

// ── 1. Snoozed (until = future date) ────────────────────────────────────────

console.log('\n--- snoozed (future until) ---');

{
  const entry = { until: FUTURE };
  const r = chipSuppressionResult(entry, 'overdue', TODAY);
  check(r.hidden === true,    'snoozed: hidden=true regardless of current status');
  check(r.resurfaced === false, 'snoozed: resurfaced=false');
}

{
  // Snoozed with very bad current status — still hidden (snooze wins)
  const entry = { until: FUTURE, statusAtDismissal: 'in_date' };
  const r = chipSuppressionResult(entry, 'overdue', TODAY);
  check(r.hidden === true,    'snoozed with worse status: still hidden during snooze');
  check(r.resurfaced === false, 'snoozed with worse status: resurfaced=false');
}

// ── 2. Snooze expired (until = past date) ────────────────────────────────────

console.log('\n--- snooze expired (past until) ---');

{
  const entry = { until: PAST };
  const r = chipSuppressionResult(entry, 'in_date', TODAY);
  check(r.hidden === false, 'expired snooze: hidden=false (auto-resurface)');
  check(r.resurfaced === false, 'expired snooze: resurfaced=false (not a status-escalation)');
}

// ── 3. Legacy permanent (until=null, no statusAtDismissal) ───────────────────

console.log('\n--- legacy permanent (until=null, no statusAtDismissal) ---');

{
  const entry = { until: null };
  const r = chipSuppressionResult(entry, 'overdue', TODAY);
  check(r.hidden === true,    'legacy permanent: always hidden (backward compat)');
  check(r.resurfaced === false, 'legacy permanent: resurfaced=false');
}

{
  // Even with a very bad current status, legacy entries stay hidden
  const entry = { until: null };
  const r = chipSuppressionResult(entry, 'stale', TODAY);
  check(r.hidden === true, 'legacy permanent + stale status: still hidden');
}

// ── 4. New permanent: status same or less severe → hidden ────────────────────

console.log('\n--- new permanent: status not worse → hidden ---');

{
  // Dismissed as overdue (red=3), still overdue → same rank → hidden
  const entry = { until: null, statusAtDismissal: 'overdue', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'overdue', TODAY);
  check(r.hidden === true,    'same rank (overdue→overdue): hidden');
  check(r.resurfaced === false, 'same rank: resurfaced=false');
}

{
  // Dismissed as overdue (red=3), now in_date (green=0) → less severe → hidden
  const entry = { until: null, statusAtDismissal: 'overdue', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'in_date', TODAY);
  check(r.hidden === true,    'lower rank (overdue→in_date): hidden');
  check(r.resurfaced === false, 'lower rank: resurfaced=false');
}

{
  // Dismissed as due_soon (amber=2), now in_date (green=0) → lower → hidden
  const entry = { until: null, statusAtDismissal: 'due_soon', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'in_date', TODAY);
  check(r.hidden === true,    'amber→green: hidden');
}

{
  // Dismissed as achieved (green=0), now achieved → same → hidden
  const entry = { until: null, statusAtDismissal: 'achieved', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'achieved', TODAY);
  check(r.hidden === true,    'green→green: hidden');
}

// ── 5. New permanent: status worsened → resurface ────────────────────────────

console.log('\n--- new permanent: status worsened → resurface ---');

{
  // Dismissed as in_date (green=0), now overdue (red=3) → worse → resurface
  const entry = { until: null, statusAtDismissal: 'in_date', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'overdue', TODAY);
  check(r.hidden === false,   'green→red: hidden=false (resurfaced)');
  check(r.resurfaced === true, 'green→red: resurfaced=true');
}

{
  // Dismissed as achieved (green=0), now due_soon (amber=2) → worse → resurface
  const entry = { until: null, statusAtDismissal: 'achieved', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'due_soon', TODAY);
  check(r.hidden === false,   'green→amber: resurfaced');
  check(r.resurfaced === true, 'green→amber: resurfaced=true');
}

{
  // Dismissed as due_soon (amber=2), now overdue (red=3) → worse → resurface
  const entry = { until: null, statusAtDismissal: 'due_soon', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'overdue', TODAY);
  check(r.hidden === false,   'amber→red: resurfaced');
  check(r.resurfaced === true, 'amber→red: resurfaced=true');
}

{
  // Dismissed as no_data (neutral=1), now stale (amber=2) → worse → resurface
  const entry = { until: null, statusAtDismissal: 'no_data', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'stale', TODAY);
  check(r.hidden === false,   'neutral→amber: resurfaced');
  check(r.resurfaced === true, 'neutral→amber: resurfaced=true');
}

// ── 6. Unknown status resurfaces (fail-safe) ─────────────────────────────────

console.log('\n--- unknown status: fail-safe resurface ---');

{
  // Entry has a valid statusAtDismissal but current status is unknown
  // Unknown status ranks as red (3). If dismissed as in_date (green=0), red > green → resurface.
  const entry = { until: null, statusAtDismissal: 'in_date', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'totally_unknown_status', TODAY);
  check(r.hidden === false,   'unknown current status: hidden=false (fail-safe resurface)');
  check(r.resurfaced === true, 'unknown current status: resurfaced=true');
}

{
  // Unknown dismissal status also ranks as red (3). Unknown current = red (3) → same rank → hidden.
  const entry = { until: null, statusAtDismissal: 'unknown_at_dismissal', dismissedAt: '2026-01-01' };
  const r = chipSuppressionResult(entry, 'totally_unknown_status', TODAY);
  // Both rank as red (3), same rank → hidden
  check(r.hidden === true,    'unknown→unknown: both red rank, same → hidden');
}

// ── 7. Re-dismiss at new status re-hides ─────────────────────────────────────

console.log('\n--- re-dismiss at new status ---');

{
  // After resurfacing at overdue, user dismisses again at overdue.
  // New entry: statusAtDismissal='overdue'. Current status still overdue → hidden.
  const newEntry = { until: null, statusAtDismissal: 'overdue', dismissedAt: TODAY };
  const r = chipSuppressionResult(newEntry, 'overdue', TODAY);
  check(r.hidden === true,    're-dismissed at overdue: hidden=true');
  check(r.resurfaced === false, 're-dismissed at overdue: resurfaced=false');
}

// ── 8. Null / missing entry ───────────────────────────────────────────────────

console.log('\n--- null / missing entry ---');

{
  const r = chipSuppressionResult(null, 'overdue', TODAY);
  check(r.hidden === false, 'null entry: not hidden');
  check(r.resurfaced === false, 'null entry: resurfaced=false');
}

{
  const r = chipSuppressionResult(undefined, 'overdue', TODAY);
  check(r.hidden === false, 'undefined entry: not hidden');
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
