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
const suiteIo = require('./shared/io/suite-io.js');
const referralsIo = require('./shared/io/referrals-io.js');

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

// ── applyWithRollback ────────────────────────────────────────────────────────
// Tests the transactional restore helper: a failing task must not leave partial
// writes. Requires chrome.storage.local mock with get/set/remove.

console.log('\n--- applyWithRollback rollback ---');

(async () => {
  // Minimal chrome.storage.local mock (get/set/remove) if not already defined.
  if (typeof global.chrome === 'undefined') {
    const _store = {};
    global.chrome = {
      storage: {
        local: {
          async get(keys) {
            if (keys === null || keys === undefined) {
              return { ..._store };
            }
            const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
            const out = {};
            ks.forEach(k => { if (k in _store) out[k] = _store[k]; });
            return out;
          },
          async set(obj) { Object.assign(_store, obj); },
          async remove(keys) {
            const ks = Array.isArray(keys) ? keys : [keys];
            ks.forEach(k => { delete _store[k]; });
          },
        },
      },
    };
  } else {
    // Extend the existing mock with remove() if it doesn't have it.
    const loc = global.chrome.storage.local;
    if (!loc.remove) {
      const _store = loc._store || {};
      loc._store = _store;
      const origGet = loc.get.bind(loc);
      const origSet = loc.set.bind(loc);
      loc.get = async (keys) => {
        if (keys === null || keys === undefined) return { ..._store };
        return origGet(keys);
      };
      loc.set = async (obj) => { Object.assign(_store, obj); return origSet(obj); };
      loc.remove = async (keys) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach(k => { delete _store[k]; });
      };
    }
  }

  // Seed storage with a known value.
  await chrome.storage.local.set({ 'test.existing': 'seed-value' });
  const seed = await chrome.storage.local.get(null);

  // Task 1: writes a new key. Task 2: throws. After rollback, storage must equal seed.
  let threw = false;
  let errorMsg = '';
  try {
    await suiteEnv.applyWithRollback([
      async () => { await chrome.storage.local.set({ 'test.written-by-task1': 'temporary' }); },
      async () => { throw new Error('deliberate-failure'); },
    ]);
  } catch (e) {
    threw = true;
    errorMsg = e.message || '';
  }

  assert(threw, 'applyWithRollback: throws when a task fails');
  assert(errorMsg.includes('deliberate-failure'), `applyWithRollback: error includes original message (got: "${errorMsg}")`);
  assert(errorMsg.includes('no changes were applied'), `applyWithRollback: error states no changes were applied (got: "${errorMsg}")`);

  const after = await chrome.storage.local.get(null);
  assert(!('test.written-by-task1' in after), 'applyWithRollback: new key written by task1 is removed after rollback');
  assert(after['test.existing'] === 'seed-value', 'applyWithRollback: pre-existing key restored to seed value');

  // Verify that a successful run does NOT roll back.
  let successWrote = false;
  await suiteEnv.applyWithRollback([
    async () => { await chrome.storage.local.set({ 'test.success-key': 'written' }); successWrote = true; },
  ]);
  const afterSuccess = await chrome.storage.local.get(null);
  assert(successWrote && afterSuccess['test.success-key'] === 'written',
    'applyWithRollback: successful tasks are NOT rolled back');

  // Tidy up test keys.
  await chrome.storage.local.remove(['test.existing', 'test.success-key']);

  // ── Task 6: submissions-io practiceCode ownership ─────────────────────────
  // suite.practiceCode is owned by suite-io.js; submissions-io must NOT export
  // it (removing the dual-ownership). Legacy import still tolerates it.

  console.log('\n--- submissions-io: practiceCode ownership ---');

  const _resetStore = () => { for (const k of Object.keys(chrome.storage.local._store || {})) delete (chrome.storage.local._store || {})[k]; };

  // Use a simple in-memory store for this section
  const subStore = {};
  const origGet = chrome.storage.local.get.bind(chrome.storage.local);
  const origSet = chrome.storage.local.set.bind(chrome.storage.local);
  // Temporarily redirect storage to subStore for clean isolation
  const subChrome = {
    storage: {
      local: {
        async get(keys) {
          const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          const out = {};
          ks.forEach(k => { if (k in subStore) out[k] = subStore[k]; });
          return out;
        },
        async set(obj) { Object.assign(subStore, obj); },
      },
    },
  };

  // Temporarily override global chrome for the submissions IO calls
  const origChrome = global.chrome;
  global.chrome = subChrome;

  subStore['submissions.config'] = { teamId: 'abc' };
  subStore['submissions.thresholds'] = { red: 5 };
  subStore['suite.practiceCode'] = 'a1b2c3';

  const subExp = await subIo.submissionsExport();
  assert(!Object.prototype.hasOwnProperty.call(subExp, 'practiceCode'),
    'submissions export does NOT contain practiceCode (owned by suite-io)');
  assert(Object.prototype.hasOwnProperty.call(subExp, 'config'),
    'submissions export still contains config');
  assert(Object.prototype.hasOwnProperty.call(subExp, 'thresholds'),
    'submissions export still contains thresholds');

  // Legacy import: a payload WITH practiceCode (e.g. old standalone backup) is still applied
  const subStoreLegacy = {};
  global.chrome = {
    storage: { local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const out = {};
        ks.forEach(k => { if (k in subStoreLegacy) out[k] = subStoreLegacy[k]; });
        return out;
      },
      async set(obj) { Object.assign(subStoreLegacy, obj); },
    }},
  };
  await subIo.submissionsImport({ practiceCode: 'legacy1' });
  assert(subStoreLegacy['suite.practiceCode'] === 'legacy1',
    'submissionsImport: legacy payload with practiceCode still applied');

  global.chrome = origChrome;

  // ── suite-io: tabOrder round-trip + validation ────────────────────────────────
  // suite.tabOrder must survive export→import and reject malformed values, in the
  // same validation style as the other suite.* keys.

  console.log('\n--- suite-io: tabOrder ---');

  const suiteStore = {};
  const savedChrome = global.chrome;
  global.chrome = {
    storage: { local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const out = {};
        ks.forEach(k => { if (k in suiteStore) out[k] = suiteStore[k]; });
        return out;
      },
      async set(obj) { Object.assign(suiteStore, obj); },
    }},
  };

  // Round-trip: import a tab order, then export it back unchanged.
  const order = ['referrals', 'sweep', 'slots'];
  await suiteIo.suiteImport({ tabOrder: order });
  assert(JSON.stringify(suiteStore['suite.tabOrder']) === JSON.stringify(order),
    'suiteImport: writes suite.tabOrder');
  const exp = await suiteIo.suiteExport();
  assert(JSON.stringify(exp.tabOrder) === JSON.stringify(order),
    'suiteExport: round-trips suite.tabOrder');

  // Reject: non-array tabOrder.
  let rejErr1 = null;
  try { await suiteIo.suiteImport({ tabOrder: 'slots' }); } catch (e) { rejErr1 = e.message; }
  assert(rejErr1 && rejErr1.includes('array'), 'suiteImport: rejects non-array tabOrder');

  // Reject: array containing a non-string / bad-shaped id.
  let rejErr2 = null;
  try { await suiteIo.suiteImport({ tabOrder: ['slots', 42] }); } catch (e) { rejErr2 = e.message; }
  assert(rejErr2 && rejErr2.includes('tab-id'), 'suiteImport: rejects array with non-string id');

  let rejErr3 = null;
  try { await suiteIo.suiteImport({ tabOrder: ['slots', 'has space'] }); } catch (e) { rejErr3 = e.message; }
  assert(rejErr3 && rejErr3.includes('tab-id'), 'suiteImport: rejects malformed id string');

  // A rejected import must not have mutated the stored value.
  assert(JSON.stringify(suiteStore['suite.tabOrder']) === JSON.stringify(order),
    'suiteImport: rejected payload leaves prior tabOrder untouched');

  // Unset tabOrder exports as null (round-trip omission is tolerated).
  delete suiteStore['suite.tabOrder'];
  const expUnset = await suiteIo.suiteExport();
  assert(expUnset.tabOrder === null, 'suiteExport: unset tabOrder exports as null');

  // ── suite.practiceAcceptedAt round-trip + validation ──────────────────────
  // The single "Accept for practice" flag DOES travel (unlike per-install
  // attestations), so it must round-trip and reject non-ISO values.
  const acceptedAt = '2026-06-15T09:30:00.000Z';
  await suiteIo.suiteImport({ practiceAcceptedAt: acceptedAt });
  assert(suiteStore['suite.practiceAcceptedAt'] === acceptedAt, 'suiteImport: writes suite.practiceAcceptedAt');
  const expAcc = await suiteIo.suiteExport();
  assert(expAcc.practiceAcceptedAt === acceptedAt, 'suiteExport: round-trips suite.practiceAcceptedAt (travels in backup)');
  let accErr = null;
  try { await suiteIo.suiteImport({ practiceAcceptedAt: 'not-a-date' }); } catch (e) { accErr = e.message; }
  assert(accErr && accErr.includes('ISO datetime'), 'suiteImport: rejects non-ISO practiceAcceptedAt');
  assert(suiteStore['suite.practiceAcceptedAt'] === acceptedAt, 'suiteImport: rejected practiceAcceptedAt leaves prior value untouched');
  // Preview warns loudly when a backup carries the acceptance.
  const accLines = suiteEnv.previewEnvelope(suiteEnv.wrap('suite', { suite: { practiceAcceptedAt: acceptedAt } }));
  assert(accLines.some((l) => l.includes('practice acceptance') || l.includes('switches ON')), 'previewEnvelope: warns when practice acceptance is carried');

  global.chrome = savedChrome;

  // ── sentinel-io: resilient custom-rule import (suite restore) ──────────────
  // A single invalid/legacy custom rule must NOT abort the whole import when
  // skipInvalidCustomRules is set — the valid rules still import and the rejects
  // are reported. Default (strict) still throws. Regression for the suite-backup
  // bug where one bad rule rolled back the entire restore.
  console.log('\n--- sentinel-io: resilient custom-rule import ---');
  {
    const sentImport = sentinelIo.sentinelImport;
    const validRule = {
      id: 'custom-b12-ferritin-1', type: 'qof-indicator', enabled: true, label: 'B12/ferritin',
      indicatorCode: 'LOCAL-B12', indicatorName: 'B12/ferritin',
      check: { kind: 'observation-alert', observation: ['b12', 'ferritin'], comparator: 'below', amber: 200, red: 100 },
    };
    const invalidRule = { id: 'custom-legacy-1', type: 'drug-monitoring', enabled: true, drug: { match: ['x'] }, tests: [] };

    // Strict (default): the bad rule rejects the whole import.
    let strictThrew = false;
    try { await sentImport({ customRules: [invalidRule, validRule] }); } catch (e) { strictThrew = true; }
    assert(strictThrew, 'sentinelImport: strict mode throws on an invalid custom rule (default)');

    // Resilient: valid rule imports, invalid rule reported, restore not aborted.
    // Clear any prior write first.
    await chrome.storage.local.remove('sentinel.customRules');
    const res = await sentImport({ customRules: [invalidRule, validRule] }, { skipInvalidCustomRules: true });
    const stored = (await chrome.storage.local.get('sentinel.customRules'))['sentinel.customRules'] || [];
    assert(stored.length === 1 && stored[0].id === 'custom-b12-ferritin-1',
      'sentinelImport: resilient mode imports the valid custom rule despite an invalid sibling');
    assert(res && Array.isArray(res.rejectedCustomRules) && res.rejectedCustomRules.length === 1
      && res.rejectedCustomRules[0].id === 'custom-legacy-1',
      'sentinelImport: resilient mode reports the rejected custom rule');

    // Round-trip: export → wrap → unwrap → resilient import keeps the valid rule.
    await chrome.storage.local.set({ 'sentinel.customRules': [invalidRule, validRule] });
    const exp = await sentinelIo.sentinelExport();
    const env = suiteEnv.wrap('suite', { sentinel: exp });
    const parsed = JSON.parse(JSON.stringify(env));
    await chrome.storage.local.remove('sentinel.customRules');
    const res2 = await sentImport(parsed.modules.sentinel, { skipInvalidCustomRules: true });
    const stored2 = (await chrome.storage.local.get('sentinel.customRules'))['sentinel.customRules'] || [];
    assert(stored2.some((r) => r.id === 'custom-b12-ferritin-1'),
      'suite round-trip: valid custom rule survives export/import even with an invalid sibling');
    assert(res2.rejectedCustomRules.length === 1, 'suite round-trip: invalid sibling is reported, not silently dropped');

    await chrome.storage.local.remove('sentinel.customRules');
  }

  // ── referrals-io: audit M1 — discovery never exported or imported ──────────
  // (a) referralsExport returns config but NOT discovery.
  // (b) referralsImport({ discovery, config }) writes config but NOT discovery.

  console.log('\n--- referrals-io: audit M1 PHI containment ---');

  {
    const refStore = {};
    const savedChrome2 = global.chrome;
    global.chrome = {
      storage: { local: {
        async get(keys) {
          const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          const out = {};
          ks.forEach(k => { if (k in refStore) out[k] = refStore[k]; });
          return out;
        },
        async set(obj) { Object.assign(refStore, obj); },
      }},
    };

    // Seed both keys.
    refStore['referrals.discovery'] = { url: 'https://api.example.com/referrals', discoveredAt: '2026-01-01T00:00:00.000Z' };
    refStore['referrals.config']    = { url: 'https://api.example.com/config', discoveredAt: '2026-01-01T00:00:00.000Z', data: { priorityOptions: [], statusOptions: [] } };

    // (a) Export must not include discovery.
    const exported = await referralsIo.referralsExport();
    assert(!Object.prototype.hasOwnProperty.call(exported, 'discovery') || exported.discovery == null,
      'referralsExport: does NOT include discovery key (audit M1)');
    assert(Object.prototype.hasOwnProperty.call(exported, 'config'),
      'referralsExport: DOES include config key');

    // (b) Import with both keys must only write config; discovery must not be touched.
    delete refStore['referrals.discovery'];
    delete refStore['referrals.config'];
    await referralsIo.referralsImport({
      discovery: { url: 'https://api.example.com/referrals', discoveredAt: '2026-01-01T00:00:00.000Z' },
      config:    { url: 'https://api.example.com/config', data: { priorityOptions: [], statusOptions: [] } },
    });
    assert(!Object.prototype.hasOwnProperty.call(refStore, 'referrals.discovery'),
      'referralsImport: does NOT write referrals.discovery (audit M1)');
    assert(Object.prototype.hasOwnProperty.call(refStore, 'referrals.config'),
      'referralsImport: DOES write referrals.config');

    global.chrome = savedChrome2;
  }

  // ── Summary ───────────────────────────────────────────────────────────────────

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
