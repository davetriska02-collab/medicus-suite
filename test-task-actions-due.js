// Medicus Suite — floating Patient-actions "What's due" source invariants
// Run with: node test-task-actions-due.js
//
// The due strip lives inside the task-actions IIFE and can't be imported, so
// these are source-level safety pins: identity gate, no all-clear claim, and
// the snapshot is read (never re-evaluated with a partial ruleset).

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
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

const panel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.css'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const sentinel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');

console.log('--- manifest wires due-mini before the panel ---');
{
  const tapBlock = manifest.slice(manifest.indexOf('shared/due-mini.js'));
  const dueIdx = tapBlock.indexOf('shared/due-mini.js');
  const panelIdx = tapBlock.indexOf('content-scripts/task-actions-panel.js');
  check(dueIdx !== -1 && panelIdx !== -1 && dueIdx < panelIdx, 'due-mini.js is injected before task-actions-panel.js');
}

console.log('\n--- identity gate ---');
check(
  /dueFromSnapshot/.test(panel),
  'panel calls MsDueMini.dueFromSnapshot (identity gate lives in the tested module)'
);
check(/__msReadSentinelSnapshot/.test(panel), 'panel reads the live snapshot via __msReadSentinelSnapshot');
check(/st !== s\.due/.test(panel), 'loadWhatsDue pins due sub-state across the patient-id await');
check(/stopDuePoll\(\)/.test(panel), 'SPA navigation / pagehide stops the due poll');
check(/state === 'pending' && s\.due\.mini/.test(panel), 'a pending snapshot clears any painted chips immediately');
check(!/evaluatePatient/.test(panel), 'panel does not re-evaluate rules itself (would risk a partial ruleset)');

console.log('\n--- snapshot ping ---');
check(/ms-sentinel-snapshot/.test(panel), 'panel listens for the same-page snapshot ping');
check(
  /__msReadSentinelSnapshot/.test(sentinel) && /ms-sentinel-snapshot/.test(sentinel),
  'sentinel exposes the reader and the ping'
);

console.log('\n--- no completion / all-clear claim ---');
{
  const dueChunk = panel.slice(panel.indexOf('function dueDegradedHtml'), panel.indexOf('function apptStatusLabel'));
  check(dueChunk.length > 200, 'due HTML helpers are present');
  check(!/\ball clear\b/i.test(dueChunk), 'due UI never says "all clear"');
  check(!/\bsafe to\b/i.test(dueChunk), 'due UI never says "safe to"');
  check(!/\b(Done|Sent|Booked|Submitted)\b/.test(dueChunk), 'due UI never claims completion');
  check(/Nothing due right now/.test(dueChunk), 'empty state is bounded ("nothing due right now")');
  check(/Monitoring/.test(dueChunk), 'overflow / empty points at Monitoring for the full list');
  check(/moreRed/.test(dueChunk), 'hidden reds are named in the "+N more" line');
}

console.log('\n--- CSS: hue is never the only signal ---');
check(/ms-tap-due-red \.ms-tap-due-dot/.test(css) && /background: var\(--red\)/.test(css), 'red due-dot is filled');
check(
  /ms-tap-due-amber \.ms-tap-due-dot/.test(css) && /background: transparent/.test(css),
  'amber due-dot is a hollow ring'
);
check(/ms-tap-due-tag/.test(css), 'status tag accompanies the dot');
check(/--red-dim/.test(css) && /--amber-dim/.test(css), 'due styles consume scoped status tokens');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
