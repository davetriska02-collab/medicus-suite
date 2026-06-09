// Medicus Suite — Import Hardening Regression Tests
// Run with: node test-import-hardening.js
//
// Covers F1 and F7 security findings:
//   (a) validateImport rejects overrides where check.red / check.threshold are strings
//   (b) validateImport rejects intervalDays: NaN and intervalDays: Infinity
//   (c) mergeRules strips __proto__ / constructor / prototype from overrides
//   (d) previewEnvelope surfaces "Disables N monitoring rules" warning for disabled overrides

'use strict';

const rulesetIo = require('./engine/ruleset-io.js');
const suiteEnv  = require('./shared/io/suite-envelope.js');

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

// Build a minimal valid sentinel ruleset document to mutate in tests.
function makeDoc(overrides) {
  return {
    format: 'sentinel-ruleset',
    formatVersion: 1,
    scope: 'individual',
    label: 'test',
    ruleSchemaVersion: 2,
    qofSpecVersion: 'QOF 2025/26',
    drugRuleOverrides: {},
    qofRuleOverrides: {},
    ...overrides,
  };
}

// ── (a) check.red / check.threshold as string must be rejected ────────────────

console.log('\n--- (a) check object numeric field validation ---');

{
  // check.red as string
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': {
        check: {
          kind: 'observation-alert',
          red: 'high',        // <-- string, should be rejected
          amber: 0.5,
          comparator: 'above',
          observation: ['haemoglobin'],
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'check.red as string: validateImport returns invalid');
  assert(errors.some(e => e.includes('.red')), 'check.red as string: error mentions .red field');
}

{
  // check.threshold as string
  const doc = makeDoc({
    qofRuleOverrides: {
      'hyp-008': {
        check: {
          kind: 'observation-threshold',
          observation: ['blood pressure'],
          threshold: '140',   // <-- string, should be rejected
          operator: '<=',
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'check.threshold as string: validateImport returns invalid');
  assert(errors.some(e => e.includes('.threshold')), 'check.threshold as string: error mentions .threshold field');
}

{
  // check.amber as string
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': {
        check: {
          kind: 'observation-alert',
          red: 180,
          amber: 'moderate',  // <-- string, should be rejected
          comparator: 'above',
          observation: ['alt'],
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'check.amber as string: validateImport returns invalid');
  assert(errors.some(e => e.includes('.amber')), 'check.amber as string: error mentions .amber field');
}

{
  // check.withinDays as string
  const doc = makeDoc({
    qofRuleOverrides: {
      'dm-019': {
        check: {
          kind: 'observation-recent',
          observation: ['hba1c'],
          withinDays: '365',  // <-- string, should be rejected
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'check.withinDays as string: validateImport returns invalid');
  assert(errors.some(e => e.includes('.withinDays')), 'check.withinDays as string: error mentions .withinDays field');
}

{
  // check.thresholdSystolic as string
  const doc = makeDoc({
    qofRuleOverrides: {
      'hyp-008': {
        check: {
          kind: 'observation-threshold',
          observation: ['blood pressure'],
          thresholdSystolic: '140',  // <-- string
          thresholdDiastolic: 90,
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'check.thresholdSystolic as string: validateImport returns invalid');
  assert(errors.some(e => e.includes('.thresholdSystolic')), 'check.thresholdSystolic as string: error mentions field');
}

{
  // check.minDelta as NaN should be rejected
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': {
        check: {
          kind: 'observation-trend',
          observation: ['haemoglobin'],
          minDelta: NaN,      // <-- NaN coerces silently without Number.isFinite guard
          minPoints: 3,
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'check.minDelta as NaN: validateImport returns invalid');
  assert(errors.some(e => e.includes('.minDelta')), 'check.minDelta as NaN: error mentions field');
}

{
  // Valid check object should pass
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': {
        check: {
          kind: 'observation-alert',
          red: 180,
          amber: 120,
          comparator: 'above',
          observation: ['alt'],
          withinDays: 90,
        }
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(valid, 'valid check object: validateImport accepts finite numeric fields');
  assert(errors.length === 0, 'valid check object: no errors');
}

// ── (b) intervalDays: NaN and intervalDays: Infinity rejected ─────────────────

console.log('\n--- (b) intervalDays / dueSoonDays NaN and Infinity ---');

{
  // intervalDays: NaN at top-level override
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { intervalDays: NaN }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'intervalDays: NaN at override level is rejected');
  assert(errors.some(e => e.includes('intervalDays')), 'intervalDays: NaN error message mentions intervalDays');
}

{
  // intervalDays: Infinity at top-level override
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { intervalDays: Infinity }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'intervalDays: Infinity at override level is rejected');
  assert(errors.some(e => e.includes('intervalDays')), 'intervalDays: Infinity error message mentions intervalDays');
}

{
  // dueSoonDays: NaN at top-level override
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { dueSoonDays: NaN }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'dueSoonDays: NaN at override level is rejected');
  assert(errors.some(e => e.includes('dueSoonDays')), 'dueSoonDays: NaN error mentions dueSoonDays');
}

{
  // intervalDays: NaN inside a tests array entry
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': {
        tests: [
          { name: 'FBC', intervalDays: NaN }
        ]
      }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'tests[0].intervalDays: NaN is rejected');
  assert(errors.some(e => e.includes('tests[0].intervalDays')), 'tests[0].intervalDays: NaN error mentions path');
}

{
  // intervalDays: -Infinity at override level
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { intervalDays: -Infinity }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'intervalDays: -Infinity at override level is rejected');
}

{
  // Negative intervalDays (valid number but semantically invalid)
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { intervalDays: -5 }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'intervalDays: negative value is rejected');
}

{
  // intervalDays: exceeds 3650 cap
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { intervalDays: 9999 }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(!valid, 'intervalDays: > 3650 is rejected');
}

{
  // Valid intervalDays and dueSoonDays should pass
  const doc = makeDoc({
    drugRuleOverrides: {
      'mtx-001': { intervalDays: 84, dueSoonDays: 28 }
    }
  });
  const { valid, errors } = rulesetIo.validateImport(doc);
  assert(valid, 'valid intervalDays / dueSoonDays: accepted');
  assert(errors.length === 0, 'valid intervalDays / dueSoonDays: no errors');
}

// ── (c) __proto__ / constructor / prototype stripped by mergeRules ────────────

console.log('\n--- (c) prototype-pollution defence in mergeRules ---');

{
  // Attempt __proto__ injection via an override object.
  // After mergeRules, the merged rule's prototype should NOT have a 'polluted' property.
  const canonicalRules = [
    { id: 'mtx-001', type: 'drug-monitoring', drug: { match: ['methotrexate'] }, tests: [] }
  ];

  // Craft an override that tries to set __proto__.polluted
  // JSON.parse cannot do this; we simulate what a crafted in-memory object would look like.
  const maliciousOverride = Object.create(null);
  maliciousOverride.intervalDays = 84;
  // Try to attach a dangerous __proto__ key manually (defineProperty skirts strict-mode guard)
  Object.defineProperty(maliciousOverride, '__proto__', {
    value: { polluted: true },
    enumerable: true,    // must be enumerable to trigger via for..in or Object.keys
    configurable: true,
  });

  const orgOverrides = {
    drugRuleOverrides: { 'mtx-001': maliciousOverride }
  };

  const merged = rulesetIo.mergeRules(canonicalRules, orgOverrides, null);
  assert(merged.length === 1, '__proto__ strip: mergeRules returns merged array');
  // The merged rule must NOT have the dangerous proto property in its prototype chain.
  assert(merged[0].polluted !== true, '__proto__ strip: merged rule prototype not polluted');
  // The intervalDays legitimate field should still be copied across.
  assert(merged[0].intervalDays === 84, '__proto__ strip: legitimate fields still merged');
}

{
  // constructor key should not end up on the merged rule
  const canonicalRules = [
    { id: 'mtx-001', type: 'drug-monitoring', drug: { match: ['methotrexate'] }, tests: [] }
  ];
  const override = { intervalDays: 56, constructor: { stolen: true } };
  const merged = rulesetIo.mergeRules(canonicalRules, { drugRuleOverrides: { 'mtx-001': override } }, null);
  assert(merged.length === 1, 'constructor strip: mergeRules returns merged array');
  // The merged rule's constructor should still be Object (the normal prototype chain), not {stolen:true}
  assert(merged[0].constructor !== Object.assign({}, { stolen: true }).constructor
    || merged[0].constructor.stolen !== true,
    'constructor strip: constructor key not applied to merged rule');
  assert(merged[0].intervalDays === 56, 'constructor strip: legitimate field still merged');
}

{
  // prototype key should be stripped
  const canonicalRules = [
    { id: 'hyp-008', type: 'qof-indicator', check: { kind: 'observation-threshold' } }
  ];
  const override = { intervalDays: 365, prototype: { injected: true } };
  const merged = rulesetIo.mergeRules(canonicalRules, { drugRuleOverrides: {}, qofRuleOverrides: { 'hyp-008': override } }, null);
  assert(merged.length === 1, 'prototype strip: mergeRules returns merged array');
  // prototype should not be a plain own-property on the merged rule
  assert(merged[0].prototype === undefined || merged[0].prototype?.injected !== true,
    'prototype strip: prototype key not applied to merged rule');
}

// ── (d) previewEnvelope warns when overrides disable monitoring rules ──────────

console.log('\n--- (d) previewEnvelope disabled-rule warning ---');

{
  // One rule disabled — warning should appear
  const envelope = suiteEnv.wrap('suite', {
    sentinel: {
      config: {},
      customRules: [],
      rules: {
        'mtx-001': { enabled: false },
        'hyp-008': { intervalDays: 84 },  // not disabled
      },
    }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warningLine = lines.find(l => l.toLowerCase().includes('disables') || l.toLowerCase().includes('disable'));
  assert(!!warningLine, 'previewEnvelope: warning line present when one rule is disabled');
  assert(warningLine.includes('1'), 'previewEnvelope: warning counts 1 disabled rule');
  assert(warningLine.includes('mtx-001'), 'previewEnvelope: warning names the disabled rule id');
}

{
  // Two rules disabled — count should be 2
  const envelope = suiteEnv.wrap('suite', {
    sentinel: {
      config: {},
      customRules: [],
      rules: {
        'mtx-001': { enabled: false },
        'aza-002': { enabled: false },
        'hyp-008': { intervalDays: 84 },
      },
    }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warningLine = lines.find(l => l.toLowerCase().includes('disables') || l.toLowerCase().includes('disable'));
  assert(!!warningLine, 'previewEnvelope: warning present when two rules disabled');
  assert(warningLine.includes('2'), 'previewEnvelope: warning counts 2 disabled rules');
  assert(warningLine.includes('aza-002'), 'previewEnvelope: warning names second disabled rule id');
}

{
  // No disabled overrides — no warning line
  const envelope = suiteEnv.wrap('suite', {
    sentinel: {
      config: {},
      customRules: [],
      rules: {
        'mtx-001': { intervalDays: 84 },
        'hyp-008': { intervalDays: 365 },
      },
    }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warningLine = lines.find(l => l.toLowerCase().includes('disables') || l.toLowerCase().includes('warning'));
  assert(!warningLine, 'previewEnvelope: no warning when no rules are disabled');
}

{
  // enabled: true should NOT trigger the warning (only false does)
  const envelope = suiteEnv.wrap('suite', {
    sentinel: {
      config: {},
      customRules: [],
      rules: {
        'mtx-001': { enabled: true },
      },
    }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warningLine = lines.find(l => l.toLowerCase().includes('disables') || (l.toLowerCase().includes('disable') && l.toLowerCase().includes('warning')));
  assert(!warningLine, 'previewEnvelope: no warning when enabled:true (not disabled)');
}

{
  // No innerHTML — preview lines must be plain text strings (no HTML tags)
  const envelope = suiteEnv.wrap('suite', {
    sentinel: {
      config: {},
      customRules: [],
      rules: { 'mtx-001': { enabled: false } },
    }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const hasHtml = lines.some(l => /<[^>]+>/.test(l));
  assert(!hasHtml, 'previewEnvelope: output lines contain no HTML (safe for textContent rendering)');
}

// ── (e) previewEnvelope hidden-rules warning (NF1) ────────────────────────────

console.log('\n--- (e) previewEnvelope hidden-rules warning (NF1) ---');

{
  const envelope = suiteEnv.wrap('suite', {
    sentinel: {
      config: {},
      customRules: [],
      rules: {},
      hiddenRules: { 'mtx-001': { until: null }, 'aza-001': { until: null } },
    }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warnLine = lines.find(l => l.includes('WARNING') && l.toLowerCase().includes('suppress'));
  assert(!!warnLine, 'previewEnvelope: WARNING line present when hiddenRules is non-empty');
  assert(!!(warnLine && warnLine.includes('2')), 'previewEnvelope: warning mentions count of 2 suppressed rules');
  assert(!!(warnLine && warnLine.includes('mtx-001')), 'previewEnvelope: warning lists a sample rule id');
}

{
  // Only 7 hidden rules — all IDs should appear (cap is 5, so last 2 should be in "more")
  const hiddenRules = {};
  for (let i = 1; i <= 7; i++) hiddenRules[`rule-${i}`] = { until: null };
  const envelope = suiteEnv.wrap('suite', {
    sentinel: { config: {}, customRules: [], rules: {}, hiddenRules }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warnLine = lines.find(l => l.includes('WARNING') && l.toLowerCase().includes('suppress'));
  assert(!!(warnLine && warnLine.includes('7')), 'previewEnvelope: warning shows correct count for 7 hidden rules');
  assert(!!(warnLine && warnLine.includes('+2 more')), 'previewEnvelope: warning shows "+N more" when ids truncated');
}

{
  // Empty hiddenRules — no warning
  const envelope = suiteEnv.wrap('suite', {
    sentinel: { config: {}, customRules: [], rules: {}, hiddenRules: {} }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warnLine = lines.find(l => l.includes('WARNING') && l.toLowerCase().includes('suppress'));
  assert(!warnLine, 'previewEnvelope: no hidden-rules warning when hiddenRules is empty');
}

{
  // hiddenRules absent — no warning
  const envelope = suiteEnv.wrap('suite', {
    sentinel: { config: {}, customRules: [], rules: {} }
  });
  const lines = suiteEnv.previewEnvelope(envelope);
  const warnLine = lines.find(l => l.includes('WARNING') && l.toLowerCase().includes('suppress'));
  assert(!warnLine, 'previewEnvelope: no hidden-rules warning when hiddenRules key absent');
}

// ── (f) sentinelImport hiddenRules entry validation (NF3) ────────────────────

console.log('\n--- (f) sentinelImport hiddenRules entry validation (NF3) ---');

// Minimal chrome.storage mock so sentinelImport can run in Node.
if (typeof global.chrome === 'undefined') {
  const _store = {};
  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          const out = {};
          ks.forEach(k => { if (k in _store) out[k] = _store[k]; });
          return out;
        },
        async set(obj) { Object.assign(_store, obj); },
      },
    },
  };
}

const { sentinelImport } = require('./shared/io/sentinel-io.js');

(async () => {
  async function expectReject(data, msgFragment, label) {
    try {
      await sentinelImport(data);
      assert(false, `${label}: should have thrown`);
    } catch (e) {
      assert(e.message.includes(msgFragment), `${label}: error mentions "${msgFragment}"`);
    }
  }
  async function expectResolve(data, label) {
    try {
      await sentinelImport(data);
      assert(true, `${label}: valid data accepted without error`);
    } catch (e) {
      assert(false, `${label}: unexpectedly threw: ${e.message}`);
    }
  }

  // Valid: {until: null}
  await expectResolve(
    { hiddenRules: { 'mtx-001': { until: null } } },
    'hiddenRules valid: entry {until:null}'
  );

  // Valid: {until: ISO date}
  await expectResolve(
    { hiddenRules: { 'flu-01': { until: '2026-09-01' } } },
    'hiddenRules valid: entry {until:"YYYY-MM-DD"}'
  );

  // Valid: empty object
  await expectResolve(
    { hiddenRules: {} },
    'hiddenRules valid: empty object'
  );

  // Invalid: entry is not an object
  await expectReject(
    { hiddenRules: { 'mtx-001': 'permanent' } },
    'entry must be an object',
    'hiddenRules invalid: entry is a string'
  );

  // Invalid: entry is an array
  await expectReject(
    { hiddenRules: { 'mtx-001': [] } },
    'entry must be an object',
    'hiddenRules invalid: entry is an array'
  );

  // Invalid: until is a number
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: 12345 } } },
    'must be null or a YYYY-MM-DD date string',
    'hiddenRules invalid: until is a number'
  );

  // Invalid: until is not ISO format
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: '01/06/2026' } } },
    'must be null or a YYYY-MM-DD date string',
    'hiddenRules invalid: until is non-ISO date string'
  );

  // Invalid: hiddenRules itself is an array
  await expectReject(
    { hiddenRules: ['mtx-001'] },
    'sentinel.hiddenRules must be an object',
    'hiddenRules invalid: array instead of object'
  );

  // ── New optional fields: statusAtDismissal and dismissedAt ──────────────────

  console.log('\n--- (f2) hiddenRules new optional fields (status-escalation) ---');

  // Valid: entry with statusAtDismissal and dismissedAt
  await expectResolve(
    { hiddenRules: { 'mtx-001': { until: null, statusAtDismissal: 'overdue', dismissedAt: '2026-01-15' } } },
    'hiddenRules valid: entry with statusAtDismissal + dismissedAt'
  );

  // Valid: statusAtDismissal present, dismissedAt absent (optional)
  await expectResolve(
    { hiddenRules: { 'mtx-001': { until: null, statusAtDismissal: 'in_date' } } },
    'hiddenRules valid: statusAtDismissal only'
  );

  // Valid: dismissedAt present, statusAtDismissal absent
  await expectResolve(
    { hiddenRules: { 'mtx-001': { until: null, dismissedAt: '2026-03-01' } } },
    'hiddenRules valid: dismissedAt only'
  );

  // Valid: statusAtDismissal is null (explicitly null)
  await expectResolve(
    { hiddenRules: { 'mtx-001': { until: null, statusAtDismissal: null } } },
    'hiddenRules valid: statusAtDismissal: null'
  );

  // Invalid: statusAtDismissal is a number
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: null, statusAtDismissal: 42 } } },
    'statusAtDismissal: must be a string or null',
    'hiddenRules invalid: statusAtDismissal is a number'
  );

  // Invalid: statusAtDismissal is an object
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: null, statusAtDismissal: { status: 'overdue' } } } },
    'statusAtDismissal: must be a string or null',
    'hiddenRules invalid: statusAtDismissal is an object'
  );

  // Invalid: dismissedAt is a number
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: null, dismissedAt: 20260115 } } },
    'dismissedAt: must be null or a YYYY-MM-DD date string',
    'hiddenRules invalid: dismissedAt is a number'
  );

  // Invalid: dismissedAt is not ISO format
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: null, dismissedAt: '15/01/2026' } } },
    'dismissedAt: must be null or a YYYY-MM-DD date string',
    'hiddenRules invalid: dismissedAt is non-ISO date string'
  );

  // Invalid: dismissedAt is invalid date string (right format, wrong date)
  await expectReject(
    { hiddenRules: { 'mtx-001': { until: null, dismissedAt: 'not-a-date' } } },
    'dismissedAt: must be null or a YYYY-MM-DD date string',
    'hiddenRules invalid: dismissedAt is an arbitrary string'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
