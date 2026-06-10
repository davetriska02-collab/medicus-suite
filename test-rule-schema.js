// Medicus Suite — Rule-schema guard tests
// Run with: node test-rule-schema.js
//
// Validates structural integrity of all four bundled rule files:
//   rules/drug-rules.json, rules/qof-rules.json,
//   rules/vaccine-rules.json, rules/alert-library.json
//
// Only ENABLED rules (enabled !== false) are subject to hard assertions.
// Disabled rules are noted informatively but do not fail the suite.

'use strict';

const path = require('path');
const drugRules  = require(path.join(__dirname, 'rules', 'drug-rules.json'));
const qofRules   = require(path.join(__dirname, 'rules', 'qof-rules.json'));
const vaxRules   = require(path.join(__dirname, 'rules', 'vaccine-rules.json'));
const alertLib   = require(path.join(__dirname, 'rules', 'alert-library.json'));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── Implemented check.kind values ────────────────────────────────────────────
// Built from grepping `check.kind ===` in engine/rules-engine.js.
// UPDATE THIS LIST when the engine learns a new kind.
const IMPLEMENTED_KINDS = new Set([
  'observation-threshold',
  'observation-recent',
  'observation-alert',
  'observation-bundle',
  'observation-trend',
  'medication-present',
]);

// ── QOF-indicator rules ───────────────────────────────────────────────────────
console.log('\n--- qof-rules.json: check.kind ---');
const qofIndicators = qofRules.rules.filter(r => r.type === 'qof-indicator');
qofIndicators.forEach(rule => {
  if (rule.enabled === false) {
    // Informational — not a failure
    console.log(`  INFO  ${rule.id}: disabled (kind=${rule.check?.kind ?? 'none'}) — skipping kind check`);
    return;
  }
  if (!rule.check || rule.check.kind == null) {
    check(false, `${rule.id}: enabled qof-indicator must have check.kind`);
    return;
  }
  check(
    IMPLEMENTED_KINDS.has(rule.check.kind),
    `${rule.id}: check.kind "${rule.check.kind}" is in IMPLEMENTED_KINDS`
  );
});

// ── Vaccine rules ─────────────────────────────────────────────────────────────
console.log('\n--- vaccine-rules.json: statusTerms.given and season ---');
vaxRules.rules.forEach(rule => {
  if (rule.enabled === false) {
    console.log(`  INFO  ${rule.id}: disabled — skipping`);
    return;
  }
  // statusTerms.given must be a non-empty array of non-empty strings
  const given = rule.statusTerms?.given;
  check(Array.isArray(given) && given.length > 0,
    `${rule.id}: statusTerms.given is a non-empty array`);
  if (Array.isArray(given)) {
    const allStrings = given.every(s => typeof s === 'string' && s.length > 0);
    check(allStrings, `${rule.id}: all statusTerms.given entries are non-empty strings`);
  }
  // season.startMonth must be an integer 1-12
  const sm = rule.season?.startMonth;
  check(Number.isInteger(sm) && sm >= 1 && sm <= 12,
    `${rule.id}: season.startMonth is integer 1-12 (got ${JSON.stringify(sm)})`);
});

// ── Event-count rules: windowMonths ──────────────────────────────────────────
// Checked across all four files since alert-library embeds event-count rules.
console.log('\n--- event-count rules: windowMonths ---');
function checkEventCountRule(rule, source, libId) {
  if (rule.type !== 'event-count') return;
  const rid = rule.id ?? libId ?? '?';
  if (rule.enabled === false) {
    console.log(`  INFO  ${rid} (${source}): event-count disabled — skipping`);
    return;
  }
  if (rule.windowMonths != null) {
    check(Number.isFinite(rule.windowMonths) && rule.windowMonths > 0,
      `${rid} (${source}): windowMonths ${rule.windowMonths} is a positive finite number`);
  }
}
(drugRules.rules || []).forEach(r => checkEventCountRule(r, 'drug-rules.json'));
(qofRules.rules || []).forEach(r => checkEventCountRule(r, 'qof-rules.json'));
(vaxRules.rules || []).forEach(r => checkEventCountRule(r, 'vaccine-rules.json'));
(alertLib.library || []).forEach(e => checkEventCountRule(e.rule || {}, 'alert-library.json', e.libId));

// ── Observation-bundle checks: non-empty observations array ──────────────────
// An empty observations array is vacuously "achieved" — not a useful rule.
console.log('\n--- observation-bundle checks: non-empty observations ---');
function checkBundleRule(rule, source, libId) {
  if (rule.check?.kind !== 'observation-bundle') return;
  const rid = rule.id ?? libId ?? '?';
  if (rule.enabled === false) {
    console.log(`  INFO  ${rid} (${source}): observation-bundle disabled — skipping`);
    return;
  }
  check(Array.isArray(rule.check.observations) && rule.check.observations.length > 0,
    `${rid} (${source}): observation-bundle has non-empty observations array`);
}
(drugRules.rules || []).forEach(r => checkBundleRule(r, 'drug-rules.json'));
(qofRules.rules || []).forEach(r => checkBundleRule(r, 'qof-rules.json'));
(vaxRules.rules || []).forEach(r => checkBundleRule(r, 'vaccine-rules.json'));
(alertLib.library || []).forEach(e => checkBundleRule(e.rule || {}, 'alert-library.json', e.libId));

// ── Top-level metadata: lastUpdated + specVersion ────────────────────────────
// All four files must carry a valid ISO date lastUpdated and a non-empty specVersion.
// This converts rule-currency drift from a silent operational issue into a CI failure.
console.log('\n--- top-level metadata: lastUpdated and specVersion ---');
[
  { file: drugRules,  name: 'drug-rules.json' },
  { file: qofRules,   name: 'qof-rules.json' },
  { file: vaxRules,   name: 'vaccine-rules.json' },
  { file: alertLib,   name: 'alert-library.json' },
].forEach(({ file, name }) => {
  const lu = file.lastUpdated;
  check(typeof lu === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lu) && !isNaN(Date.parse(lu)),
    `${name}: lastUpdated is a valid ISO date (got ${JSON.stringify(lu)})`);
  const sv = file.specVersion;
  check(typeof sv === 'string' && sv.trim().length > 0,
    `${name}: specVersion is a non-empty string (got ${JSON.stringify(sv)})`);
});

// ── No duplicate rule IDs within or across all four files ────────────────────
console.log('\n--- no duplicate rule IDs ---');
const idMap = {}; // id -> [source, ...]
function collectId(id, source) {
  if (!id) return;
  if (!idMap[id]) idMap[id] = [];
  idMap[id].push(source);
}
(drugRules.rules || []).forEach(r => collectId(r.id, 'drug-rules.json'));
(qofRules.rules || []).forEach(r => collectId(r.id, 'qof-rules.json'));
(vaxRules.rules || []).forEach(r => collectId(r.id, 'vaccine-rules.json'));
(alertLib.library || []).forEach(e => {
  collectId(e.libId, 'alert-library.json');
  if (e.rule?.id) collectId(e.rule.id, 'alert-library.json(rule.id)');
});
let dupCount = 0;
Object.entries(idMap).forEach(([id, sources]) => {
  if (sources.length > 1) {
    dupCount++;
    check(false, `Duplicate id "${id}" appears in: ${sources.join(', ')}`);
  }
});
if (dupCount === 0) check(true, 'no duplicate IDs found across all four rule files');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
