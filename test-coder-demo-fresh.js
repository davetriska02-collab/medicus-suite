// Medicus Suite — Document Coder demo freshness guard
// Run with: node test-coder-demo-fresh.js
// The demo page inlines the REAL engines; if either engine changes without
// regenerating (node scripts/build-coder-demo.js), the demo silently tests
// stale behaviour — this guard fails CI instead.
'use strict';
const fs = require('fs');
const path = require('path');
const demo = fs.readFileSync(path.join(__dirname, 'docs', 'plans', 'document-coder-demo.html'), 'utf8');
let failed = 0;
for (const f of ['engine/letter-extract.js', 'engine/letter-delta.js']) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const ok = demo.includes(src);
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${f} inlined verbatim in demo`);
  if (!ok) failed++;
}
console.log(`\n--- Results: ${2 - failed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
