// Medicus Suite — reception Patient-card freshness guards (v3.206.0)
// Run with: node test-reception-patient-card.js
//
// The Reception module's Patient card (name + NHS number) mirrors the record
// open in Medicus. Until v3.206.0 it was a one-shot render: nothing listened
// for the SPA patient change, so switching records left the PREVIOUS patient's
// name and NHS number on screen (H-001 field evidence — the exact wrong-patient
// display H-001 exists to prevent, on a surface its controls were assumed to
// cover but which never subscribed to the URL-watcher's broadcast).
//
// These are source guards in the test-reception-quick-actions-ui.js style: they
// pin the WIRING (listener registered, torn down, debounced, visibility-gated)
// and the two safety consequences of making the card live:
//   • the capture summary's identity header is PINNED at capture start, never
//     read live at generate time (a colleague switching records mid-call must
//     not swap the name/DOB/NHS under the caller's answers), and
//   • a transient mid-navigation invalidate must not tear down the booking
//     card's held reservation (H-051 review q4).

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

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const src = read('side-panel/modules/reception/reception.js');

function fnBody(marker, len = 2600) {
  const at = src.indexOf(marker);
  return at === -1 ? '' : src.slice(at, at + len);
}

// ── 1. The auto-refresh triggers exist ──────────────────────────────────────
{
  console.log('— auto-refresh wiring —');
  const initBody = fnBody('export async function init', 4000);
  check(
    /msg\?\.type === 'sentinel:snapshot-updated'/.test(src),
    'reception listens for the sentinel:snapshot-updated broadcast (the SPA patient-change signal)'
  );
  check(
    /sender\.id !== chrome\.runtime\.id/.test(src),
    'the snapshot listener carries the sender-id guard (only our own extension can trigger a refresh)'
  );
  check(
    initBody.includes('chrome.runtime.onMessage.addListener(_snapshotListener)'),
    'the snapshot listener is registered in init()'
  );
  check(
    /if \(document\.visibilityState === 'visible'\) refreshPatientCard\(\)/.test(initBody),
    'the backstop poll is visibility-gated (no IPC while the panel is hidden)'
  );
  check(/SNAPSHOT_POLL_MS/.test(initBody), 'the backstop poll interval is a named constant');
}

// ── 2. Teardown symmetry (the leak class test-module-lifecycle.js cannot see) ─
{
  console.log('\n— cleanup symmetry —');
  const cleanupBody = fnBody('function cleanup()', 1400);
  check(
    cleanupBody.includes('chrome.runtime.onMessage.removeListener(_snapshotListener)'),
    'cleanup() removes the snapshot listener'
  );
  check(cleanupBody.includes('clearInterval(_pollTimer)'), 'cleanup() clears the backstop poll');
  check(cleanupBody.includes('clearTimeout(_snapshotDebounce)'), 'cleanup() clears the pending debounce');
  const adds = (src.match(/chrome\.runtime\.onMessage\.addListener/g) || []).length;
  const removes = (src.match(/chrome\.runtime\.onMessage\.removeListener/g) || []).length;
  check(adds === removes && adds > 0, `runtime.onMessage add/remove are symmetric (${adds}/${removes})`);
  const intervals = (src.match(/setInterval\(/g) || []).length;
  const clears = (src.match(/clearInterval\(/g) || []).length;
  check(intervals === clears && intervals > 0, `setInterval/clearInterval are symmetric (${intervals}/${clears})`);
}

// ── 3. Refresh discipline ───────────────────────────────────────────────────
{
  console.log('\n— refresh discipline —');
  check(
    /function schedulePatientCardRefresh\(\)[\s\S]{0,220}400/.test(src),
    'ping-driven refreshes are debounced (~400 ms — a patient switch fires at least two pings)'
  );
  const refreshBody = fnBody('async function refreshPatientCard()', 3200);
  check(
    refreshBody.includes('SNAPSHOT_UNAVAILABLE') && /_snapshotRefreshing = true;[\s\S]{0,200}return;/.test(refreshBody),
    'a mid-navigation invalidate renders the refreshing state and returns early'
  );
  // The early return above must come BEFORE the booking re-gate: a transient
  // invalidate must never release a held slot reservation (H-051 review q4).
  const unavailableAt = refreshBody.indexOf('_snapshotRefreshing = true');
  const bookingAt = refreshBody.indexOf('updateBookingCard(_bookingCtx.form');
  check(
    unavailableAt !== -1 && bookingAt !== -1 && unavailableAt < bookingAt,
    'the transient-invalidate path returns before the booking gate is touched'
  );
  check(
    !fnBody('async function refreshPatientCard()', 3200).includes('destroyBookingCard'),
    'the auto-refresh path never destroys the booking card (only re-gates it)'
  );
  check(
    /if \(html === _patientCardHtml\) return;/.test(src),
    'renderPatientCard skips no-op re-renders (focus and layout stability above the red-flag form)'
  );
  check(
    /Record changing in Medicus/.test(src),
    'the mid-navigation transient renders as "refreshing", not as "no record open"'
  );
}

// ── 4. Pop-out fallback stays display-only ──────────────────────────────────
{
  console.log('\n— pop-out fallback —');
  const findTab = fnBody('async function findMedicusTab()', 1300);
  check(
    /if \(isPopOutContext\(\)\) \{[\s\S]{0,200}url: 'https:\/\/\*\.medicus\.health\/\*'/.test(findTab),
    'the any-Medicus-tab fallback runs ONLY in the pop-out (docked booking identity stays active-tab, H-051)'
  );
  check(/\{ active: true, currentWindow: true \}/.test(findTab), 'the active tab is still tried first everywhere');
}

// ── 5. The capture summary identity is pinned, not live ─────────────────────
{
  console.log('\n— pinned capture identity —');
  check(
    fnBody('async function renderCaptureForm', 3400).includes('_capturePatient ='),
    'renderCaptureForm pins the patient identity when the capture opens'
  );
  const genBody = fnBody('function generateSummary', 4200);
  check(
    /const pc = _capturePatient;/.test(genBody),
    'generateSummary builds the patient line from the PIN, not the live snapshot'
  );
  check(
    !/const pc = _snapshot\?\.patientContext/.test(genBody),
    'generateSummary no longer reads the live snapshot for the identity header'
  );
  check(/identityChanged/.test(genBody), 'generateSummary detects pin/live divergence');
  check(
    /has changed since this capture started/.test(src),
    'the output view warns when the open record changed mid-capture (consequence stated, not mechanism)'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
