// test-defaults-config-lock.js — shipped-config version guard (see scripts/defaults-config-lock.js)
// Run with: node test-defaults-config-lock.js
//
// Fails when defaults.json's migration-propagated content (rules / thresholds / prefs /
// systemChips / resultRules) changed without bumping its integer "version" — the bug that
// stranded the v3.75.0 "Urgent:" label change and the bowel rule on existing installs.
// CI also runs the same `--check` as an early workflow step (before the doc-version step,
// which currently bails the job), so the guard is enforced there too.

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

let ok = true;
try {
  const out = execFileSync(
    'node',
    [path.join(__dirname, 'scripts', 'defaults-config-lock.js'), '--check'],
    { stdio: 'pipe' }
  );
  console.log('  OK  ' + String(out).trim());
} catch (e) {
  ok = false;
  console.error('  FAIL  ' + String(e.stderr || e.stdout || e.message).trim());
}

console.log(`\n--- Results: ${ok ? 1 : 0} passed, ${ok ? 0 : 1} failed ---\n`);
if (!ok) process.exit(1);
