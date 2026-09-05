// Medicus Suite — Contacts canvas patient-identity resolution source invariants
// Run with: node test-contacts-context-resolution.js
//
// resolveContext() is a wrong-patient guard called immediately before nearly
// every write in contacts-canvas.js — it MUST stay synchronous everywhere
// except the cold "first open" / resume entry points, which need an async
// task->patient fetch to work from a task-overview page (e.g. a
// document-filing task, which has no patient UUID in the URL or DOM). These
// are source-level pins because the two functions differ only by an `await`
// and a fetch call the sync path must never grow, and a future edit could
// easily blur that line without a test catching it.

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

const api = fs.readFileSync(path.join(__dirname, 'content-scripts', 'contacts-api.js'), 'utf8');
const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts', 'contacts-canvas.js'), 'utf8');
const linkButton = fs.readFileSync(path.join(__dirname, 'content-scripts', 'contacts-link-button.js'), 'utf8');

console.log('--- contacts-api.js: both resolvers exist and are exported ---');
check(/function resolveContext\(\)/.test(api), 'sync resolveContext() exists');
check(/async function resolveContextAsync\(\)/.test(api), 'async resolveContextAsync() exists');
check(/resolveContext,/.test(api) && /resolveContextAsync,/.test(api), 'both are exported on window.ContactsApi');

console.log('\n--- task->patient resolution only ever happens in the async path ---');
{
  const syncFn = api.slice(
    api.indexOf('function resolveContext()'),
    api.indexOf('async function resolveContextAsync()')
  );
  check(!/resolveTaskToPatient/.test(syncFn), 'the SYNC resolver never itself calls resolveTaskToPatient (a fetch)');
  const asyncFn = api.slice(api.indexOf('async function resolveContextAsync()'));
  check(
    /resolveTaskToPatient/.test(asyncFn.slice(0, asyncFn.indexOf('window.ContactsApi'))),
    'the ASYNC resolver does call resolveTaskToPatient'
  );
}

console.log('\n--- a shared cache lets the sync resolver see what the async one learned ---');
check(/_taskPatientCache/.test(api), 'a task->patient cache exists');
check(
  (api.match(/_taskPatientCache/g) || []).length >= 4,
  'the cache is both written (async) and read (sync) — not just declared'
);

console.log('\n--- only cold-open / resume call sites use the async resolver ---');
check(
  /await window\.ContactsApi\.resolveContextAsync\(\)/.test(linkButton),
  'contacts-link-button.js doOpen() awaits resolveContextAsync()'
);
check(
  /await window\.ContactsApi\.resolveContextAsync\(\)/.test(canvas),
  'contacts-canvas.js awaits resolveContextAsync()'
);
{
  const canvasAsyncCalls = (canvas.match(/ContactsApi\.resolveContextAsync\(\)/g) || []).length;
  const linkButtonAsyncCalls = (linkButton.match(/ContactsApi\.resolveContextAsync\(\)/g) || []).length;
  check(
    canvasAsyncCalls === 2,
    `contacts-canvas.js calls resolveContextAsync() twice (loadCanvas + resume), got ${canvasAsyncCalls}`
  );
  check(
    linkButtonAsyncCalls === 1,
    `contacts-link-button.js calls resolveContextAsync() exactly once, got ${linkButtonAsyncCalls}`
  );
  check(
    /checkResumableFamilySession[\s\S]*resolveContextAsync\(\)/.test(canvas),
    'checkResumableFamilySession uses the async resolver so resume works on document tasks'
  );
}

console.log('\n--- async resolver refuses a stale id if the SPA moves during the fetch ---');
{
  const asyncFn = api.slice(api.indexOf('async function resolveContextAsync()'));
  check(/hrefAtStart/.test(asyncFn), 'resolveContextAsync snapshots location.href before any await');
  check(
    /location\.href !== hrefAtStart/.test(asyncFn),
    'resolveContextAsync re-reads location.href after the task→patient fetch'
  );
}

console.log('\n--- family cycling from a task-overview page does not no-op-reload ---');
check(
  /patient\/patient\/care-record\//.test(canvas),
  'buildNavigationUrl falls back to the canonical care-record path when the URL has no patient UUID'
);
check(
  /if \(!dest \|\| dest === location\.href\)/.test(canvas),
  'advanceToNextFamilyMember refuses before persist when dest is missing or unchanged'
);
check(
  canvas.indexOf('const dest = buildNavigationUrl') <
    canvas.indexOf('await persistFamilySession(session, targetName)'),
  'dest is computed before persistFamilySession so a failed build cannot poison the session'
);

console.log('\n--- every other call site (the pre-write guards) stays synchronous ---');
{
  // Both files had one more sync ContactsApi.resolveContext() call than they
  // now have — the cold-open one that moved to the async sibling above.
  // Everything else (13 in the canvas: every drag/drop/delete/merge write
  // guard; 1 in the link button: doImportConfirm's re-verify-before-write)
  // must still be the plain, synchronous call.
  const canvasSyncCalls = (canvas.match(/ContactsApi\.resolveContext\(\)/g) || []).length;
  const linkButtonSyncCalls = (linkButton.match(/ContactsApi\.resolveContext\(\)/g) || []).length;
  check(canvasSyncCalls >= 10, `contacts-canvas.js still has its pre-write sync guards intact, got ${canvasSyncCalls}`);
  check(
    linkButtonSyncCalls >= 1,
    `contacts-link-button.js still has doImportConfirm's sync re-verify guard intact, got ${linkButtonSyncCalls}`
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
