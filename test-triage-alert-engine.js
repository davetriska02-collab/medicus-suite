// Medicus Suite — Triage Alert Engine unit tests
// Run with: node test-triage-alert-engine.js
//
// engine/triage-alert-engine.js `evaluate(buckets, rules)` had ZERO direct
// tests before this file — only its IO layer (shared/io/triage-alert-io.js) is
// covered, in test-import-hardening.js. `evaluate` is the actual grading logic
// (amber at threshold, red at threshold*2), so a regression here would be a
// silent patient-safety miss: a rule that should escalate to red staying
// amber, or a broken threshold guard letting `count < ""` / `count < null`
// mis-fire. This file drives `evaluate` directly.

'use strict';

const TriageAlertEngine = require('./engine/triage-alert-engine.js');

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

function rule(over) {
  return { key: 'medNew', label: 'New medical', threshold: 5, enabled: true, ...over };
}

// ── 1. Basic thresholds: below / amber / red boundary ─────────────────────
console.log('--- basic threshold boundaries ---');
{
  // count below threshold → no trigger
  const r = TriageAlertEngine.evaluate({ medNew: { count: 4 } }, [rule({ threshold: 5 })]);
  check(r.triggered.length === 0, 'count 4 < threshold 5: not triggered');
  check(r.maxLevel === null, 'count 4 < threshold 5: maxLevel null');
}
{
  // count === threshold → amber (exact boundary)
  const r = TriageAlertEngine.evaluate({ medNew: { count: 5 } }, [rule({ threshold: 5 })]);
  check(r.triggered.length === 1, 'count 5 === threshold 5: triggered');
  check(r.triggered[0].level === 'amber', 'count 5 === threshold 5: level is amber');
  check(r.maxLevel === 'amber', 'count 5 === threshold 5: maxLevel amber');
}
{
  // count between threshold and threshold*2 → still amber
  const r = TriageAlertEngine.evaluate({ medNew: { count: 9 } }, [rule({ threshold: 5 })]);
  check(r.triggered[0].level === 'amber', 'count 9 (threshold 5, *2=10): still amber');
}
{
  // count === threshold*2 → red (exact boundary)
  const r = TriageAlertEngine.evaluate({ medNew: { count: 10 } }, [rule({ threshold: 5 })]);
  check(r.triggered[0].level === 'red', 'count 10 === threshold*2 (5*2): level is red');
  check(r.maxLevel === 'red', 'count 10 === threshold*2: maxLevel red');
}
{
  // count just below threshold*2 → amber, not red
  const r = TriageAlertEngine.evaluate({ medNew: { count: 9 } }, [rule({ threshold: 5 })]);
  check(r.triggered[0].level === 'amber', 'count 9 < threshold*2 10: amber, not red');
}
{
  // count well above threshold*2 → red
  const r = TriageAlertEngine.evaluate({ medNew: { count: 50 } }, [rule({ threshold: 5 })]);
  check(r.triggered[0].level === 'red', 'count 50 >> threshold*2: red');
}

// ── 2. Disabled rules are skipped ──────────────────────────────────────────
console.log('\n--- disabled rules ---');
{
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ enabled: false })]);
  check(r.triggered.length === 0, 'disabled rule: never triggers regardless of count');
  check(r.maxLevel === null, 'disabled rule: maxLevel null');
}
{
  // enabled: undefined / falsy also skipped (rule.enabled is truthiness-checked)
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ enabled: undefined })]);
  check(r.triggered.length === 0, 'rule.enabled undefined: skipped (falsy)');
}

// ── 3. Invalid threshold skipped, not crashed ──────────────────────────────
console.log('\n--- invalid threshold guard ---');
{
  // string threshold that Number()s to a finite value ('5') is actually valid —
  // Number('5') = 5, finite, > 0, so this rule SHOULD fire. Confirms the guard is
  // about non-numeric/non-finite/non-positive values, not "typeof string".
  const r = TriageAlertEngine.evaluate({ medNew: { count: 5 } }, [rule({ threshold: '5' })]);
  check(r.triggered.length === 1, 'numeric string threshold "5": Number() coerces and rule fires');
}
{
  // non-numeric string ('high') → Number('high') is NaN → skipped, no crash
  let warned = false;
  const origWarn = console.warn;
  console.warn = () => {
    warned = true;
  };
  let threw = false;
  let r;
  try {
    r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: 'high' })]);
  } catch (e) {
    threw = true;
  } finally {
    console.warn = origWarn;
  }
  check(!threw, 'non-numeric threshold "high": does not throw');
  check(r.triggered.length === 0, 'non-numeric threshold "high": rule skipped, not triggered');
  check(warned, 'non-numeric threshold "high": logs a console.warn');
}
{
  // NaN threshold → skipped
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: NaN })]);
  console.warn = origWarn;
  check(r.triggered.length === 0, 'NaN threshold: skipped');
}
{
  // threshold: 0 → skipped (must be > 0, not just finite)
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: 0 })]);
  console.warn = origWarn;
  check(r.triggered.length === 0, 'threshold 0: skipped (not > 0)');
}
{
  // negative threshold → skipped
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: -5 })]);
  console.warn = origWarn;
  check(r.triggered.length === 0, 'threshold -5: skipped (negative)');
}
{
  // Infinity threshold → skipped (Number.isFinite(Infinity) === false)
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: Infinity })]);
  console.warn = origWarn;
  check(r.triggered.length === 0, 'threshold Infinity: skipped (not finite)');
}
{
  // null threshold → skipped (Number(null) === 0, which is <= 0)
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: null })]);
  console.warn = origWarn;
  check(r.triggered.length === 0, 'threshold null: skipped (Number(null)=0 <= 0)');
}
{
  // empty-string threshold → skipped (Number('') === 0, which is <= 0 — the
  // exact silent-mis-fire risk called out in the engine's own comment)
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 100 } }, [rule({ threshold: '' })]);
  console.warn = origWarn;
  check(r.triggered.length === 0, 'threshold "": skipped (Number("")=0 <= 0)');
}
{
  // one invalid rule alongside one valid rule: invalid is skipped, valid still fires
  const origWarn = console.warn;
  console.warn = () => {};
  const r = TriageAlertEngine.evaluate({ medNew: { count: 20 }, rmAdmin: { count: 20 } }, [
    rule({ key: 'medNew', threshold: 'bad' }),
    rule({ key: 'rmAdmin', threshold: 5 }),
  ]);
  console.warn = origWarn;
  check(r.triggered.length === 1, 'mixed valid/invalid rules: only the valid one triggers');
  check(r.triggered[0].key === 'rmAdmin', 'mixed valid/invalid rules: the surviving trigger is the valid rule');
}

// ── 4. Missing bucket key defaults to count 0 ──────────────────────────────
console.log('\n--- missing bucket key ---');
{
  const r = TriageAlertEngine.evaluate({}, [rule({ threshold: 1 })]);
  check(r.triggered.length === 0, 'bucket key entirely absent: treated as count 0, does not trigger');
}
{
  // bucket present but no .count field
  const r = TriageAlertEngine.evaluate({ medNew: {} }, [rule({ threshold: 1 })]);
  check(r.triggered.length === 0, 'bucket present without .count: treated as count 0');
}
{
  // bucket key maps to null
  const r = TriageAlertEngine.evaluate({ medNew: null }, [rule({ threshold: 1 })]);
  check(r.triggered.length === 0, 'bucket value null: treated as count 0 (optional chaining), no crash');
}

// ── 5. maxLevel computation across multiple rules ──────────────────────────
console.log('\n--- maxLevel across multiple rules ---');
{
  // one amber, one red → maxLevel red
  const r = TriageAlertEngine.evaluate({ a: { count: 5 }, b: { count: 20 } }, [
    rule({ key: 'a', threshold: 5 }), // amber (5 === threshold, < threshold*2)
    rule({ key: 'b', threshold: 5 }), // red (20 >= threshold*2)
  ]);
  check(r.triggered.length === 2, 'two rules both trigger');
  check(r.maxLevel === 'red', 'one amber + one red: maxLevel is red');
}
{
  // two ambers, no red → maxLevel amber
  const r = TriageAlertEngine.evaluate({ a: { count: 5 }, b: { count: 6 } }, [
    rule({ key: 'a', threshold: 5 }),
    rule({ key: 'b', threshold: 5 }),
  ]);
  check(r.maxLevel === 'amber', 'two ambers, no red: maxLevel amber');
}
{
  // no rules trigger → maxLevel null
  const r = TriageAlertEngine.evaluate({ a: { count: 1 } }, [rule({ key: 'a', threshold: 5 })]);
  check(r.maxLevel === null, 'nothing triggers: maxLevel null');
}
{
  // red rule ordered BEFORE an amber rule in the array — maxLevel must still
  // resolve correctly regardless of array order (guards against an
  // implementation that only checks triggered[0]).
  const r = TriageAlertEngine.evaluate({ a: { count: 20 }, b: { count: 5 } }, [
    rule({ key: 'a', threshold: 5 }), // red, first in array
    rule({ key: 'b', threshold: 5 }), // amber, second in array
  ]);
  check(r.maxLevel === 'red', 'red-first ordering: maxLevel still red');
}

// ── 6. Empty rules / empty buckets ─────────────────────────────────────────
console.log('\n--- empty inputs ---');
{
  const r = TriageAlertEngine.evaluate({}, []);
  check(Array.isArray(r.triggered) && r.triggered.length === 0, 'empty rules + empty buckets: empty triggered array');
  check(r.maxLevel === null, 'empty rules + empty buckets: maxLevel null');
}
{
  const r = TriageAlertEngine.evaluate({ a: { count: 5 } }, []);
  check(r.triggered.length === 0, 'empty rules with non-empty buckets: nothing triggers');
}
{
  // rules is not an array → returns the empty default rather than throwing
  const r = TriageAlertEngine.evaluate({ a: { count: 5 } }, null);
  check(r.triggered.length === 0 && r.maxLevel === null, 'rules is null: returns empty default, no crash');
}
{
  const r = TriageAlertEngine.evaluate({ a: { count: 5 } }, undefined);
  check(r.triggered.length === 0 && r.maxLevel === null, 'rules is undefined: returns empty default, no crash');
}
{
  // buckets falsy (null / undefined) → returns the empty default
  const r = TriageAlertEngine.evaluate(null, [rule()]);
  check(r.triggered.length === 0 && r.maxLevel === null, 'buckets is null: returns empty default, no crash');
}
{
  const r = TriageAlertEngine.evaluate(undefined, [rule()]);
  check(r.triggered.length === 0 && r.maxLevel === null, 'buckets is undefined: returns empty default, no crash');
}

// ── 7. Triggered entry shape ───────────────────────────────────────────────
console.log('\n--- triggered entry shape ---');
{
  const r = TriageAlertEngine.evaluate({ medNew: { count: 12 } }, [rule({ threshold: 5, label: 'New medical' })]);
  const t = r.triggered[0];
  check(t.key === 'medNew', 'triggered entry: carries the rule key');
  check(t.label === 'New medical', 'triggered entry: carries the rule label');
  check(t.count === 12, 'triggered entry: carries the actual count');
  check(t.threshold === 5, 'triggered entry: carries the numeric threshold (coerced)');
  check(t.level === 'red', 'triggered entry: carries the computed level');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
