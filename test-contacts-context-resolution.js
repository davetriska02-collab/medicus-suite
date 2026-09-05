// Medicus Suite — Contacts canvas patient-identity resolution source invariants
// Run with: node test-contacts-context-resolution.js
//
// resolveContext() is a wrong-patient guard called immediately before nearly
// every write in contacts-canvas.js — it MUST stay synchronous everywhere
// except the two cold "first open" entry points, which need an async
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

console.log('\n--- exactly two call sites use the async resolver (the cold-open ones) ---');
check(
  /await window\.ContactsApi\.resolveContextAsync\(\)/.test(linkButton),
  'contacts-link-button.js doOpen() awaits resolveContextAsync()'
);
check(
  /await window\.ContactsApi\.resolveContextAsync\(\)/.test(canvas),
  'contacts-canvas.js loadCanvas() awaits resolveContextAsync()'
);
{
  const canvasAsyncCalls = (canvas.match(/ContactsApi\.resolveContextAsync\(\)/g) || []).length;
  const linkButtonAsyncCalls = (linkButton.match(/ContactsApi\.resolveContextAsync\(\)/g) || []).length;
  check(canvasAsyncCalls === 1, `contacts-canvas.js calls resolveContextAsync() exactly once, got ${canvasAsyncCalls}`);
  check(
    linkButtonAsyncCalls === 1,
    `contacts-link-button.js calls resolveContextAsync() exactly once, got ${linkButtonAsyncCalls}`
  );
}

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
