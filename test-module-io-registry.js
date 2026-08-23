// Medicus Suite — backup IO registry lock-step (architecture plan Phase 5.2)
// Run with: node test-module-io-registry.js
//
// MODULE_SCOPES in suite-envelope.js is the one ordered list.
// options/backup-orchestrator.js MODULE_IO must have the same keys.

'use strict';

const fs = require('fs');
const path = require('path');
const suiteEnv = require('./shared/io/suite-envelope.js');

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

const scopes = suiteEnv.MODULE_SCOPES;
check(Array.isArray(scopes) && scopes.length >= 10, `MODULE_SCOPES has ${scopes.length} entries`);
check(scopes[scopes.length - 1] === 'suite', 'MODULE_SCOPES ends with suite');
check(scopes.length === new Set(scopes).size, 'MODULE_SCOPES has no duplicates');

const valid = suiteEnv.VALID_SCOPES;
check(
  valid.length === scopes.length && scopes.every((s) => valid.includes(s)),
  'VALID_SCOPES is the same set as MODULE_SCOPES'
);

const optionsSrc = fs.readFileSync(path.join(__dirname, 'options', 'backup-orchestrator.js'), 'utf8');
const ioBlock = optionsSrc.match(/const MODULE_IO = \{([\s\S]*?)\n\};/);
check(!!ioBlock, 'backup-orchestrator.js declares MODULE_IO');

const ioKeys = ioBlock ? [...ioBlock[1].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1]) : [];
check(ioKeys.length === scopes.length, `MODULE_IO has ${ioKeys.length} keys (expected ${scopes.length})`);
const missing = scopes.filter((s) => !ioKeys.includes(s));
const extra = ioKeys.filter((s) => !scopes.includes(s));
check(
  missing.length === 0 && extra.length === 0,
  missing.length === 0 && extra.length === 0
    ? 'MODULE_IO keys match MODULE_SCOPES'
    : `MODULE_IO drift — missing: ${missing.join(', ') || '—'}; extra: ${extra.join(', ') || '—'}`
);

check(
  /SuiteEnvelope\.MODULE_SCOPES/.test(optionsSrc) && /async function doFullExport/.test(optionsSrc),
  'doFullExport loops SuiteEnvelope.MODULE_SCOPES'
);
const optionsPage = fs.readFileSync(path.join(__dirname, 'options', 'options.js'), 'utf8');
check(
  optionsPage.includes('window.BackupOrchestrator'),
  'options.js consumes BackupOrchestrator (does not re-declare MODULE_IO)'
);
check(!/const MODULE_IO = \{/.test(optionsPage), 'options.js no longer declares MODULE_IO');
check(
  /skipInvalidCustomRules:\s*true/.test(optionsSrc),
  'applyEnvelope keeps the sentinel skipInvalidCustomRules special case'
);
check(!/const exporters = \{/.test(optionsSrc), 'doModuleExport no longer has a parallel exporters map');

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
