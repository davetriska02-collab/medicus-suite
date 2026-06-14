// Medicus Suite — Submissions core logic tests
// Run with: node test-submissions-core.js
// Dynamic-imports submissions-core.js (ES module).

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;
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

  const corePath = new URL('side-panel/modules/submissions/submissions-core.js', `file://${path.resolve(__dirname)}/`)
    .href;

  const { DEFAULT_SUB_THRESHOLDS, ragLevel, getRagLevel } = await import(corePath);

  // ── defaults ─────────────────────────────────────────────────────────────────
  console.log('--- DEFAULT_SUB_THRESHOLDS ---');
  check(DEFAULT_SUB_THRESHOLDS.medical.enabled === false, 'medical disabled by default');
  check(DEFAULT_SUB_THRESHOLDS.admin.enabled === false, 'admin disabled by default');
  check(DEFAULT_SUB_THRESHOLDS.medical.amber === 30 && DEFAULT_SUB_THRESHOLDS.medical.red === 60, 'medical 30/60');

  // ── ragLevel ─────────────────────────────────────────────────────────────────
  console.log('\n--- ragLevel ---');
  const t = { amber: 30, red: 60, enabled: true };
  check(ragLevel(0, t) === null, 'below amber → null');
  check(ragLevel(29, t) === null, 'just below amber → null');
  check(ragLevel(30, t) === 'amber', 'at amber threshold → amber');
  check(ragLevel(59, t) === 'amber', 'between amber and red → amber');
  check(ragLevel(60, t) === 'red', 'at red threshold → red');
  check(ragLevel(1000, t) === 'red', 'far above red → red');

  // disabled / missing
  check(ragLevel(100, { amber: 30, red: 60, enabled: false }) === null, 'disabled threshold → null even when high');
  check(ragLevel(100, null) === null, 'null threshold → null');
  check(ragLevel(100, undefined) === null, 'undefined threshold → null');

  // missing red/amber bounds default to Infinity (never trips)
  check(ragLevel(1000, { enabled: true }) === null, 'no amber/red bounds → never trips');
  check(ragLevel(1000, { amber: 30, enabled: true }) === 'amber', 'amber only (no red) → amber, never red');

  // ── getRagLevel (key lookup) ─────────────────────────────────────────────────
  console.log('\n--- getRagLevel ---');
  const thresholds = {
    medical: { amber: 30, red: 60, enabled: true },
    admin: { amber: 20, red: 40, enabled: false },
  };
  check(getRagLevel('medical', 65, thresholds) === 'red', 'medical 65 → red');
  check(getRagLevel('admin', 65, thresholds) === null, 'admin disabled → null regardless of count');
  check(getRagLevel('investigation', 999, thresholds) === null, 'unknown key → null (no threshold)');
  check(getRagLevel('medical', 10, null) === null, 'null thresholds map → null');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
