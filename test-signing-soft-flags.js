// Medicus Suite — Signing Queue soft-flag pack wiring
// Run with: node test-signing-soft-flags.js
//
// v3.261.10 shipped suite.signing.softFlags behind Options only. Dave turned
// that checkbox on and the Signing Queue chips stayed dead: the module reads
// the key at init/Refresh and never listens for storage changes, and the
// Signing page itself has no control. This file fails closed on that wiring
// and pins the engine path that must fire once the pack is actually on.

'use strict';

const fs = require('fs');
const path = require('path');
const engine = require('./engine/rules-engine.js');
const qof = require('./rules/qof-rules.json');

(async () => {
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

  const corePath = new URL('side-panel/modules/signing/signing-core.js', `file://${path.resolve(__dirname)}/`).href;
  const { qofReviewVerdict, monitoringVerdict } = await import(corePath);

  const signingSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/signing/signing.js'), 'utf8');
  const optionsJs = fs.readFileSync(path.join(__dirname, 'options/options.js'), 'utf8');
  const optionsHtml = fs.readFileSync(path.join(__dirname, 'options/options.html'), 'utf8');

  console.log('--- on-page control writes the same storage key ---');
  check(/id="sgSoftFlags"/.test(signingSrc), 'Signing Queue shell has #sgSoftFlags (on-page pack control)');
  check(
    /Show monitoring &(?:amp;)? QOF review flags/.test(signingSrc),
    'on-page label is the GP-facing "Show monitoring & QOF review flags"'
  );
  check(
    /chrome\.storage\.local\.set\(/.test(signingSrc) && /suite\.signing\.softFlags/.test(signingSrc),
    'on-page control writes suite.signing.softFlags'
  );

  console.log('\n--- live sync: Options write must wake an open Signing tab ---');
  check(
    /onChanged\.addListener\(onSoftFlagsStorageChange\)/.test(signingSrc) &&
      /SOFT_FLAGS_KEY = 'suite\.signing\.softFlags'/.test(signingSrc) &&
      /function onSoftFlagsStorageChange/.test(signingSrc) &&
      /changes\[SOFT_FLAGS_KEY\]/.test(signingSrc),
    'Signing Queue onChanged handler reads suite.signing.softFlags'
  );
  check(/onChanged\.removeListener/.test(signingSrc), 'Signing Queue removes the storage listener on cleanup');
  const optionsOnChanged =
    optionsJs.includes("changes['suite.signing.softFlags']") ||
    optionsJs.includes('changes["suite.signing.softFlags"]');
  check(optionsOnChanged, 'Options checkbox re-reads suite.signing.softFlags on storage change');
  check(/id="signingSoftFlags"/.test(optionsHtml), 'Options Suite checkbox is still present (same key)');

  console.log('\n--- monitoring chips stay always-on ---');
  check(/verdict:\s*monitoringVerdict\(chips\)/.test(signingSrc), 'monitoringVerdict runs on every evaluated row');
  check(!/softFlags\s*\?\s*monitoringVerdict/.test(signingSrc), 'monitoringVerdict is not gated on softFlags');

  console.log('\n--- engine path: allow-listed QOF review badges when rules are loaded ---');
  const NOW = '2026-06-01T12:00:00Z';
  const chips = engine.evaluatePatient([], [], qof.rules, {
    now: NOW,
    problems: [{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }],
    patientContext: {},
  });
  const ast015 = (chips || []).find((c) => c && c.type === 'qof-indicator' && c.indicatorCode === 'AST015');
  check(
    !!ast015 && ast015.status === 'overdue',
    'evaluatePatient + qof-rules: AST015 overdue for long-standing asthma, no review'
  );
  const qvOn = qofReviewVerdict(chips);
  check(
    qvOn.label === 'QOF review overdue — asthma',
    `qofReviewVerdict badges that chip (got ${JSON.stringify(qvOn.label)})`
  );
  check(monitoringVerdict(chips).level === null, 'AST015 chip does not leak into always-on monitoring chips');

  const dmChips = engine.evaluatePatient([], [{ name: 'HbA1c', value: '75', date: '2024-01-01' }], qof.rules, {
    now: NOW,
    problems: [{ label: 'Type 2 diabetes', codedDate: '2018-01-01', hasOnsetDate: true }],
    patientContext: {},
  });
  check(qofReviewVerdict(dmChips).label === '', 'DM020-style target miss still does not badge');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
