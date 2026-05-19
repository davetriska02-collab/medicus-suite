// Medicus Suite v1.1 — Suite IO Tests
// Run with: node test-suite-io.js
// Tests: envelope wrap/unwrap, per-module IO validation, Triage Lens migration logic.

'use strict';

// Load modules in Node-compatible way
const suiteEnv = require('./shared/io/suite-envelope.js');
const sentinelIo = require('./shared/io/sentinel-io.js');
const capacityIo = require('./shared/io/capacity-io.js');
const triageIo = require('./shared/io/triage-io.js');
const slotIo = require('./shared/io/slot-counter-io.js');
const subIo = require('./shared/io/submissions-io.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

function assertThrows(fn, pattern, msg) {
  try {
    fn();
    console.error(`  FAIL  ${msg} (expected throw, got nothing)`);
    failed++;
  } catch (e) {
    if (pattern && !e.message.includes(pattern)) {
      console.error(`  FAIL  ${msg} (threw "${e.message}", expected to contain "${pattern}")`);
      failed++;
    } else {
      console.log(`  OK  ${msg}`);
      passed++;
    }
  }
}

// ── Suite Envelope tests ──────────────────────────────────────────────────────

console.log('\n--- Suite Envelope ---');

{
  const env = suiteEnv.wrap('suite', { sentinel: { config: {}, rules: {}, orgRules: null, customRules: [] } });
  assert(env.format === 'medicus-suite-backup', 'wrap: format field is correct');
  assert(env.formatVersion === 1, 'wrap: formatVersion is 1');
  assert(env.scope === 'suite', 'wrap: scope is suite');
  assert(typeof env.exportedAt === 'string', 'wrap: exportedAt is a string');
  assert(env.modules?.sentinel?.customRules !== undefined, 'wrap: sentinel module present');
}

{
  const env = suiteEnv.wrap('capacity', { capacity: { presets: [] } });
  assert(env.scope === 'capacity', 'wrap scoped: scope is capacity');
}

{
  assertThrows(() => suiteEnv.wrap('bogus', {}), 'Unknown scope', 'wrap: rejects invalid scope');
}

{
  const raw = suiteEnv.wrap('suite', { sentinel: { customRules: [] } });
  const { valid, errors } = suiteEnv.unwrap(raw);
  assert(valid, 'unwrap: valid envelope passes');
  assert(errors.length === 0, 'unwrap: no errors on valid envelope');
}

{
  const { valid, errors } = suiteEnv.unwrap({ format: 'wrong', formatVersion: 1, scope: 'suite', modules: {} });
  assert(!valid, 'unwrap: rejects wrong format');
  assert(errors.some(e => e.includes('wrong')), 'unwrap: error mentions bad format');
}

{
  const { valid, errors } = suiteEnv.unwrap(null);
  assert(!valid, 'unwrap: rejects null');
}

{
  const { valid, errors } = suiteEnv.unwrap({ format: 'medicus-suite-backup', formatVersion: 1, scope: 'bogus', modules: {} });
  assert(!valid, 'unwrap: rejects unknown scope');
}

{
  const { valid, warnings } = suiteEnv.unwrap({ format: 'medicus-suite-backup', formatVersion: 99, scope: 'suite', modules: {} });
  assert(!valid || warnings.some(w => w.includes('newer')), 'unwrap: warns on future formatVersion');
}

{
  const raw = suiteEnv.wrap('capacity', { capacity: { presets: [{ id: 'p1', name: 'GP' }] } });
  const { valid, errors } = suiteEnv.unwrap(raw, 'sentinel');
  assert(!valid, 'unwrap: scope mismatch blocks import when expected scope differs');
}

{
  const raw = suiteEnv.wrap('suite', { capacity: { presets: [{ id: 'p1', name: 'GP' }] } });
  const { valid } = suiteEnv.unwrap(raw, 'capacity');
  assert(valid, 'unwrap: suite scope always accepted for any expectedScope');
}

{
  const lines = suiteEnv.previewEnvelope(suiteEnv.wrap('suite', {
    sentinel: { customRules: [{ id: 'c1' }, { id: 'c2' }], rules: { r1: {} } },
    capacity: { presets: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] },
    suite: { practiceCode: '560b6c' },
  }));
  assert(lines.some(l => l.includes('2 custom')), 'previewEnvelope: custom rule count');
  assert(lines.some(l => l.includes('3 preset')), 'previewEnvelope: preset count');
  assert(lines.some(l => l.includes('560b6c')), 'previewEnvelope: practice code');
}

{
  const name = suiteEnv.suggestFilename('suite');
  assert(name.startsWith('medicus-suite-backup-'), 'suggestFilename: suite');
  const nameCap = suiteEnv.suggestFilename('capacity');
  assert(nameCap.startsWith('medicus-capacity-backup-'), 'suggestFilename: capacity');
}

// ── Sentinel IO validation ────────────────────────────────────────────────────

console.log('\n--- Sentinel IO validation ---');

const { validateCustomRule, generateCustomRuleId, defaultDueSoonDays } = sentinelIo;

{
  assertThrows(() => validateCustomRule(null), 'not an object', 'validateCustomRule: rejects null');
  assertThrows(() => validateCustomRule({ type: 'drug-monitoring', drug: { match: ['x'] }, tests: [] }), 'id is required', 'validateCustomRule: rejects missing id');
  assertThrows(() => validateCustomRule({ id: 'custom-x', type: 'drug-monitoring', drug: { match: ['x'] }, tests: [] }), 'non-empty', 'validateCustomRule: rejects empty tests');
  assertThrows(() => validateCustomRule({ id: 'wrong-id', type: 'drug-monitoring', drug: { match: ['x'] }, tests: [{ name: 't', match: ['t'], intervalDays: 84 }] }), 'custom-', 'validateCustomRule: rejects non-custom- id prefix');
  assertThrows(() => validateCustomRule({ id: 'custom-x', type: 'qof-indicator', drug: { match: ['x'] }, tests: [{ name: 't', match: ['t'], intervalDays: 84 }] }), 'indicatorCode', 'validateCustomRule: qof-indicator type now dispatched to QOF validator');
  assertThrows(() => validateCustomRule({ id: 'custom-x', type: 'drug-monitoring', drug: { match: [] }, tests: [{ name: 't', match: ['t'], intervalDays: 84 }] }), 'non-empty', 'validateCustomRule: rejects empty drug.match');
  assertThrows(() => validateCustomRule({ id: 'custom-x', type: 'drug-monitoring', drug: { match: ['x'] }, tests: [{ name: 't', match: ['t'], intervalDays: -1 }] }), 'intervalDays', 'validateCustomRule: rejects negative intervalDays');
  assertThrows(() => validateCustomRule({ id: 'custom-x', type: 'drug-monitoring', drug: { match: ['x'] }, tests: [{ name: 't', match: ['t'], intervalDays: 9999 }] }), 'intervalDays', 'validateCustomRule: rejects intervalDays > 3650');
}

{
  // Valid rule should not throw
  let threw = false;
  try {
    validateCustomRule({ id: 'custom-leflunomide-123', type: 'drug-monitoring', drug: { match: ['leflunomide'] }, tests: [{ name: 'FBC', match: ['fbc'], intervalDays: 84, dueSoonDays: 28 }] });
  } catch { threw = true; }
  assert(!threw, 'validateCustomRule: accepts valid rule');
}

{
  const id = generateCustomRuleId('leflunomide');
  assert(id.startsWith('custom-leflunomide-'), 'generateCustomRuleId: prefix and slug');
  const id2 = generateCustomRuleId('');
  assert(id2.startsWith('custom-drug-') || id2.startsWith('custom-rule-'), 'generateCustomRuleId: fallback for empty name');
}

{
  assert(defaultDueSoonDays(84) === 28, 'defaultDueSoonDays: 12 weeks -> 28 days');
  assert(defaultDueSoonDays(365) === 28, 'defaultDueSoonDays: 1 year -> 28 days');
  assert(defaultDueSoonDays(42) <= 30, 'defaultDueSoonDays: shorter interval capped at 30');
  assert(defaultDueSoonDays(42) === Math.min(Math.round(42 / 6), 30), 'defaultDueSoonDays: correct formula for shorter interval');
}

// ── Capacity IO validation ────────────────────────────────────────────────────

console.log('\n--- Capacity IO validation ---');

{
  // In Node there's no chrome.storage — test the validation logic inline
  const { capacityImport } = capacityIo;

  async function tryCapImport(data) {
    try { await capacityImport(data); return null; }
    catch (e) { return e.message; }
  }

  async function run() {
    const err1 = await tryCapImport(null);
    assert(err1?.includes('object'), 'capacityImport: rejects null');

    const err2 = await tryCapImport({ presets: 'not an array' });
    assert(err2?.includes('array'), 'capacityImport: rejects non-array presets');

    const err3 = await tryCapImport({ presets: [{ name: 'P' }] });
    assert(err3?.includes('id'), 'capacityImport: rejects preset without id');

    const err4 = await tryCapImport({ viewMode: 'bogus' });
    assert(err4?.includes('viewMode'), 'capacityImport: rejects invalid viewMode');
  }

  run().catch(e => { console.error('capacity io run failed:', e.message); failed++; });
}

// ── Triage IO ─────────────────────────────────────────────────────────────────

console.log('\n--- Triage IO validation ---');

{
  const { triageImport } = triageIo;

  async function run() {
    async function tryTriageImport(data) {
      try { await triageImport(data); return null; }
      catch (e) { return e.message; }
    }

    const err1 = await tryTriageImport(null);
    assert(err1?.includes('object'), 'triageImport: rejects null');

    const err2 = await tryTriageImport({});
    assert(err2?.includes('config'), 'triageImport: rejects missing config field');

    const err3 = await tryTriageImport({ config: [] });
    assert(err3?.includes('object'), 'triageImport: rejects array as config');
  }

  run().catch(e => { console.error('triage io run failed:', e.message); failed++; });
}

// ── Triage Lens migration logic (unit test without chrome.storage) ─────────────

console.log('\n--- Triage Lens migration logic ---');

{
  // Simulate the migration logic directly
  function simulateMigration(storageState) {
    // storageState is { 'config': ..., 'triagelens.config': ... }
    const result = { ...storageState };
    const existing = result['triagelens.config'];
    if (existing) return result; // already migrated — idempotent
    const legacy = result['config'];
    if (!legacy || typeof legacy !== 'object') return result;
    if (!legacy.version && !legacy.rules && !legacy.systemChips) return result;
    result['triagelens.config'] = legacy;
    if (!legacy.practiceCode) delete result['config'];
    return result;
  }

  const state1 = simulateMigration({ 'config': { version: '0.5', rules: [] } });
  assert(state1['triagelens.config']?.version === '0.5', 'migration: copies config to triagelens.config');
  assert(state1['config'] === undefined, 'migration: removes legacy config key (no practiceCode)');

  const state2 = simulateMigration({ 'triagelens.config': { version: '0.5' }, 'config': { version: 'old' } });
  assert(state2['triagelens.config']?.version === '0.5', 'migration: idempotent — does not overwrite existing triagelens.config');

  const state3 = simulateMigration({ 'config': { practiceCode: '560b6c' } });
  assert(state3['triagelens.config'] === undefined, 'migration: does not migrate submissions config (has practiceCode, no version/rules)');
  assert(state3['config']?.practiceCode === '560b6c', 'migration: leaves submissions config untouched');

  const state4 = simulateMigration({});
  assert(state4['triagelens.config'] === undefined, 'migration: no-op when no config key exists');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
