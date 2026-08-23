// Medicus Suite — shared/*-core.js purity (architecture plan Phase 3.2)
// Run with: node test-shared-core-purity.js
//
// Files named *-core.js under shared/ are the documented pure-logic layer.
// A new chrome.*/document./fetch( in one of them is a layering leak.
// Named exceptions live in CORE_EXCEPTIONS with a reason.

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
  }
}

const ROOT = path.join(__dirname, 'shared');
const CORE_EXCEPTIONS = {
  'booking-core.js': 'session fetch for reserve/create/release (W1/W2/W12/W15) — dual-mode, not a chrome/DOM helper',
};

const FORBIDDEN = [
  { re: /\bdocument\s*\./, name: 'document.' },
  { re: /\bchrome\s*\./, name: 'chrome.' },
  { re: /\bfetch\s*\(/, name: 'fetch(' },
];

const cores = fs.readdirSync(ROOT).filter((n) => n.endsWith('-core.js'));
check(cores.length >= 4, `found ${cores.length} shared/*-core.js files`);

for (const name of cores) {
  if (CORE_EXCEPTIONS[name]) {
    check(true, `${name} excepted — ${CORE_EXCEPTIONS[name]}`);
    continue;
  }
  const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
  for (const { re, name: what } of FORBIDDEN) {
    const hits = [];
    src.split(/\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (re.test(line)) hits.push(i + 1);
    });
    check(hits.length === 0, `${name} has no ${what}${hits.length ? ` (lines ${hits.join(', ')})` : ''}`);
  }
}

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
