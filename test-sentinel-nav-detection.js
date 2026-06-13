// Medicus Suite — Sentinel patient-change detection regression tests
// Run with: node test-sentinel-nav-detection.js
//
// Guards the fix for "the monitoring pane is slow to reload when switching
// patients via a heavy documents view (a large PNG/PDF rendered inline)".
//
// Root cause was twofold:
//   1. Patient-change detection relied SOLELY on a MutationObserver on <body>.
//      A heavy documents render floods that observer and pins the main thread,
//      delaying detection — the pane appeared "not to reload" until a manual F5,
//      while lightweight task views (labs / med requests) detected instantly.
//   2. Every genuine navigation paid a fixed 800ms coalescing window before
//      re-evaluating, even when the new URL unambiguously identified a DIFFERENT
//      patient (a confirmed switch needs no coalescing — that window only exists
//      to absorb same-patient journal-search keystroke churn).
//
// The fix: drive detection from three independent signals (observer + Navigation
// API `currententrychange` + a backstop poll), and branch the re-eval delay on
// whether the switch is confirmed.
//
// Like test-snapshot-bridge.js these are source-level invariants — the detector
// lives inside an IIFE in a content script and can't be imported, so we assert the
// intended patterns are present (and the wrong-patient guards stay intact) rather
// than re-introduce a regression that only shows up in the browser.

'use strict';
const fs = require('fs');
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
  }
}

const sentinel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');

console.log('--- adaptive re-eval delay (confirmed switch must not pay the coalescing window) ---');

check(/REEVAL_DELAY_CONFIRMED_MS\s*=\s*(\d+)/.test(sentinel), 'a confirmed-switch re-eval delay constant exists');
check(/REEVAL_DELAY_AMBIGUOUS_MS\s*=\s*800/.test(sentinel), 'the ambiguous/churn coalescing window is still 800ms');

const confirmedMs = Number((sentinel.match(/REEVAL_DELAY_CONFIRMED_MS\s*=\s*(\d+)/) || [])[1]);
check(
  Number.isFinite(confirmedMs) && confirmedMs < 800,
  `a confirmed switch re-evaluates faster than the 800ms churn window (found ${confirmedMs}ms)`
);

check(
  /confirmedSwitch\s*=\s*!!\(\s*urlPatient\s*&&\s*_lastPatientUuid\s*&&\s*urlPatient\s*!==\s*_lastPatientUuid\s*\)/.test(
    sentinel
  ),
  'a confirmed switch is a resolvable URL patient that DIFFERS from the last evaluated patient'
);
check(
  /const delay = confirmedSwitch \? REEVAL_DELAY_CONFIRMED_MS : REEVAL_DELAY_AMBIGUOUS_MS/.test(sentinel),
  're-eval delay branches on confirmedSwitch (fast when confirmed, coalesced when ambiguous)'
);

console.log('\n--- detection must not depend on the MutationObserver alone ---');

check(/new MutationObserver\(onUrlMaybeChanged\)/.test(sentinel), 'signal 1: the body MutationObserver is retained');
check(
  /window\.navigation\.addEventListener\(\s*['"]currententrychange['"]\s*,\s*onUrlMaybeChanged\s*\)/.test(sentinel),
  'signal 2: the Navigation API currententrychange event drives detection (render-storm-proof)'
);
check(
  /window\.navigation\s*&&\s*typeof window\.navigation\.addEventListener === ['"]function['"]/.test(sentinel),
  'the Navigation API is feature-detected (older Chromium falls back to the other signals)'
);
check(
  /addEventListener\(\s*['"]popstate['"]\s*,\s*onUrlMaybeChanged\s*\)/.test(sentinel),
  'popstate (back/forward) also drives detection'
);
check(
  /setInterval\(onUrlMaybeChanged,\s*URL_POLL_MS\)/.test(sentinel),
  'signal 3: a backstop location poll bounds detection latency under a render storm'
);

console.log('\n--- a single idempotent handler feeds every signal ---');

check(/function onUrlMaybeChanged\(\)/.test(sentinel), 'all signals call one shared handler, onUrlMaybeChanged');
check(
  /function onUrlMaybeChanged\(\)\s*\{\s*if \(location\.href === lastUrl\) return;/.test(sentinel),
  'the handler no-ops when the URL is unchanged (idempotent — safe for three callers + a poll)'
);

console.log('\n--- wrong-patient and journal-churn guards stay intact ---');

check(
  /if \(urlPatient && _lastPatientUuid && urlPatient === _lastPatientUuid\) \{[\s\S]*?return;/.test(sentinel),
  'same-patient sub-navigation still returns early (journal search does not wipe valid chips)'
);
check(
  /invalidateSnapshot\(\);\s*\n\s*const confirmedSwitch/.test(sentinel),
  'a genuine navigation still invalidates the snapshot BEFORE the re-eval (no stale wrong-patient chips during the fetch window)'
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
