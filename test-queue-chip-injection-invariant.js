// Medicus Suite — queue-chip injection-invariant guard
// Run with: node test-queue-chip-injection-invariant.js
//
// The Medicus queue is a Vue + AG-Grid SPA that reconciles away TRAILING
// foreign DOM nodes on every re-render. Chips injected with appendChild flash
// and vanish; chips PREPENDED with insertBefore(node, host.firstChild) survive.
// This exact invariant has regressed before (v3.67.0 shipped appendChild →
// chips disappeared instantly; fixed v3.68.0). CLAUDE.md documents the rule in
// prose ("PREPEND, never append"), but prose is not a gate — this test is.
//
// It is a SOURCE guard, not a DOM test: the three chip families
// (.ch-queue-chips, .ch-q-result span, .ch-q-mon span) are injected into the
// live Medicus DOM, which cannot be faithfully reproduced in Node. So we assert
// the durable property of the source: every host insertion uses the prepend
// idiom, and no chip node is appended onto its host.
//
// If you add a new chip family injected into the queue, inject it with
// host.target.insertBefore(node, host.target.firstChild) and bump
// MIN_PREPEND_SITES below.

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

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// ── 1. The three chip families are still injected ──────────────────────────
console.log('\n--- chip families present ---');
for (const cls of ['ch-queue-chips', 'ch-q-result', 'ch-q-mon']) {
  check(src.includes(cls), `content.js still injects the '${cls}' family`);
}

// ── 2. Host insertions use the prepend idiom ───────────────────────────────
// Count insertBefore(..., ...firstChild) calls — the survive-the-reconciler
// pattern. There are three host-insertion sites today (mon, result, age strip).
console.log('\n--- prepend idiom (insertBefore … firstChild) ---');
const MIN_PREPEND_SITES = 3;
const prependSites = (src.match(/\.insertBefore\([^;]*\.firstChild\s*\)/g) || []).length;
check(
  prependSites >= MIN_PREPEND_SITES,
  `found ${prependSites} insertBefore(…, …firstChild) host-prepend site(s) (expected >= ${MIN_PREPEND_SITES})`
);

// ── 3. No chip node is appended onto its host ──────────────────────────────
// The regression vector: a host insertion rewritten as appendChild. Appending
// children INTO a chip (menu.appendChild(item) etc.) is fine and expected; what
// must never happen is appending the chip strip/span ONTO the Medicus row/cell.
console.log('\n--- no host-level appendChild of a chip node ---');
const forbidden = [
  /host\.target\.appendChild\s*\(/, // host.target.appendChild(...)
  /\btarget\.appendChild\s*\(\s*strip\s*\)/, // target.appendChild(strip)
  /\btarget\.appendChild\s*\(\s*span\s*\)/, // target.appendChild(span)
];
for (const re of forbidden) {
  check(!re.test(src), `content.js does NOT append a chip onto its host via ${re}`);
}

console.log(`\nQueue-chip injection invariant: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
