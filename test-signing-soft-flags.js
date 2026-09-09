// Medicus Suite — Signing Queue soft-flag pack wiring
// Run with: node test-signing-soft-flags.js

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
  check(/QOF review flags/.test(signingSrc), 'on-page label stays the GP-facing QOF review flags');
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
    optionsJs.includes('changes["suite.signing.softFlags"]') ||
    (/PRACTICE_PACK_TOGGLES/.test(optionsJs) && /changes\[spec\.key\]/.test(optionsJs));
  check(optionsOnChanged, 'Options checkbox re-reads suite.signing.softFlags on storage change');
  check(/id="signingSoftFlags"/.test(optionsHtml), 'Options Suite toggle is still present (same key)');
  check(/suite-toggle/.test(optionsHtml) && /id="signingSoftFlags"/.test(optionsHtml),
    'Options Suite softFlags uses the Suite CSS switch');

  console.log('\n--- third view: Options → Practice features, same key + onChanged ---');
  check(/id="pfSoftFlags"/.test(optionsHtml), 'Practice features card has #pfSoftFlags (third view of the same pack)');
  check(/data-section="practice-features"/.test(optionsHtml), 'Options nav has Practice features');
  check(/id="sect-practice-features"/.test(optionsHtml), 'Options has #sect-practice-features');
  check(
    /Signing Queue flags/.test(optionsHtml) &&
      (optionsHtml.match(/Signing Queue flags/g) || []).length >= 2,
    'Practice features uses the same Signing soft-flags label as Suite'
  );
  check(
    /bindPracticePackToggle/.test(optionsJs) &&
      /suite\.signing\.softFlags/.test(optionsJs) &&
      /pfSoftFlags/.test(optionsJs) &&
      /PRACTICE_PACK_TOGGLES/.test(optionsJs),
    'Practice features writes and re-reads suite.signing.softFlags on storage change'
  );
  check(/id="sgSoftFlags"/.test(signingSrc) && /suite-toggle/.test(signingSrc),
    'Signing Queue softFlags uses the Suite CSS switch');
  check(
    /Never write false just because a checkbox is missing/.test(optionsJs) &&
      !/signingSoftFlagsInput \? signingSoftFlagsInput\.checked : false/.test(optionsJs),
    'saveSuite must not write false because a box is missing'
  );
  const paletteSrc = fs.readFileSync(path.join(__dirname, 'side-panel/palette/palette.js'), 'utf8');
  check(
    /'suite',\s*'Suite',\s*'[^']*signing soft flags QOF review/.test(paletteSrc) &&
      /'practice-features',\s*'Practice features',\s*'[^']*signing soft flags QOF review/.test(paletteSrc),
    'palette Suite / Practice features keywords include signing, soft flags, QOF review'
  );

  console.log('\n--- two-door lock: Accept stays separate from the pack ---');
  const acceptFn = optionsJs.match(/async function acceptForPractice\(\)[\s\S]*?\nasync function withdrawPracticeAcceptance/);
  check(
    !!acceptFn && !/signing\.softFlags/.test(acceptFn[0]) && !/pfSoftFlags/.test(acceptFn[0]),
    'tick Accept does not write suite.signing.softFlags'
  );
  check(
    /practiceAcceptedAt/.test(optionsJs) &&
      !/chrome\.storage\.local\.set\(\{[^}]*practiceAcceptedAt[^}]*softFlags/.test(optionsJs) &&
      !/chrome\.storage\.local\.set\(\{[^}]*softFlags[^}]*practiceAcceptedAt/.test(optionsJs),
    'pack toggle / saveSuite does not set practiceAcceptedAt'
  );
  const ppSrc = fs.readFileSync(path.join(__dirname, 'shared/io/practice-profile.js'), 'utf8');
  const ppCode = ppSrc.replace(/\/\/.*$/gm, '');
  check(!/suiteImport\s*\(/.test(ppCode), 'applyProfile does not call suiteImport()');
  const allowList = (ppSrc.match(/const ALLOWED_SUITE_KEYS = \[([^\]]+)\]/) || [])[1] || '';
  check(
    /'signing\.softFlags'/.test(allowList),
    'allow-list is the literal signing.softFlags (suite.${key} → suite.signing.softFlags)'
  );
  check(
    !/practiceAcceptedAt/.test(allowList),
    'practiceAcceptedAt is not on the pack allow-list'
  );

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
