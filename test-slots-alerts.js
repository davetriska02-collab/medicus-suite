// Medicus Suite — Slots proactive alert-threshold tests
// Run with: node test-slots-alerts.js
//
// Exercises the pure alert-evaluation core in
// side-panel/modules/slots/slots-alert-core.js — dynamic-imported (ES
// module), same technique as test-capacity-core.js / test-referrals-filters.js.

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;
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

  const corePath = new URL('side-panel/modules/slots/slots-alert-core.js', `file://${path.resolve(__dirname)}/`).href;

  const { typeAlertLevel, overallAlertLevel, buildBreaches, hasEnabledRules, validateAlertRule } = await import(
    corePath
  );

  const rules = [
    { id: '1', typeName: 'GP Routine', threshold: 3, enabled: true },
    { id: '2', typeName: 'Nurse', threshold: 0, enabled: true },
    { id: '3', typeName: 'Physio', threshold: 5, enabled: false }, // disabled — never fires
  ];

  // ── typeAlertLevel ────────────────────────────────────────────────────────
  console.log('\n--- typeAlertLevel ---');
  check(typeAlertLevel(rules, 'GP Routine', 5) === null, 'count above threshold → no alert');
  check(typeAlertLevel(rules, 'GP Routine', 3) === 'amber', 'count == threshold → amber');
  check(typeAlertLevel(rules, 'GP Routine', 1) === 'amber', 'count below threshold, non-zero → amber');
  check(typeAlertLevel(rules, 'GP Routine', 0) === 'red', 'count zero → red');
  check(typeAlertLevel(rules, 'Nurse', 0) === 'red', 'threshold 0 rule: zero remaining → red');
  check(typeAlertLevel(rules, 'Nurse', 1) === null, 'threshold 0 rule: 1 remaining → no alert (not <= 0)');
  check(typeAlertLevel(rules, 'Physio', 0) === null, 'disabled rule never fires, even at zero');
  check(typeAlertLevel(rules, 'Unknown Type', 0) === null, 'no rule for this type → no alert');
  check(typeAlertLevel([], 'GP Routine', 0) === null, 'empty rules → no alert');
  check(typeAlertLevel(null, 'GP Routine', 0) === null, 'null rules → no alert, no throw');

  // Worst-wins when multiple enabled rules target the same type
  {
    const dupRules = [
      { id: 'a', typeName: 'GP Routine', threshold: 5, enabled: true },
      { id: 'b', typeName: 'GP Routine', threshold: 0, enabled: true },
    ];
    check(typeAlertLevel(dupRules, 'GP Routine', 3) === 'amber', 'one rule fires amber (3<=5, 3>0)');
    check(typeAlertLevel(dupRules, 'GP Routine', 0) === 'red', 'both fire, red wins (worst-wins)');
  }

  // ── overallAlertLevel ─────────────────────────────────────────────────────
  console.log('\n--- overallAlertLevel ---');
  check(overallAlertLevel(rules, {}) === 'red', 'empty byType → all rule types read as 0 → red (Nurse rule)');
  check(
    overallAlertLevel(rules, { 'GP Routine': { am: 5, pm: 5 }, Nurse: { am: 1, pm: 1 } }) === null,
    'both types comfortably above threshold → null'
  );
  check(
    overallAlertLevel(rules, { 'GP Routine': { am: 1, pm: 1 }, Nurse: { am: 1, pm: 1 } }) === 'amber',
    'GP Routine breaches (2<=3) → amber overall'
  );
  check(
    overallAlertLevel(rules, { 'GP Routine': { am: 1, pm: 1 }, Nurse: { am: 0, pm: 0 } }) === 'red',
    'Nurse hits zero → red overall, even though GP Routine is only amber'
  );
  check(overallAlertLevel([], {}) === null, 'no rules → null, never alerts');

  // ── buildBreaches ─────────────────────────────────────────────────────────
  console.log('\n--- buildBreaches ---');
  {
    const byType = { 'GP Routine': { am: 1, pm: 1 }, Nurse: { am: 0, pm: 0 }, Physio: { am: 0, pm: 0 } };
    const breaches = buildBreaches(rules, byType);
    check(breaches.length === 2, `2 breaches (GP Routine amber, Nurse red) — got ${breaches.length}`);
    check(breaches[0].typeName === 'Nurse' && breaches[0].level === 'red', 'red sorts first');
    check(breaches[1].typeName === 'GP Routine' && breaches[1].level === 'amber', 'amber sorts second');
    check(
      !breaches.some((b) => b.typeName === 'Physio'),
      'disabled rule (Physio) never appears in breach list even at zero'
    );
  }
  {
    // Flat count map (Today's lean fetch shape) — a plain number instead of {am,pm}.
    const flatByType = { 'GP Routine': 2, Nurse: 0 };
    const breaches = buildBreaches(rules, flatByType);
    check(breaches.length === 2, 'flat number counts are also supported (Today card shape)');
    check(breaches.find((b) => b.typeName === 'GP Routine').count === 2, 'flat count read correctly');
  }
  {
    // Type absent from today's data — must not be treated as a phantom zero breach.
    const breaches = buildBreaches(rules, { 'GP Routine': { am: 5, pm: 5 } });
    check(
      !breaches.some((b) => b.typeName === 'Nurse'),
      'Nurse rule with no matching data today → not a breach (type absent, not zero)'
    );
  }
  check(buildBreaches([], {}).length === 0, 'no rules → no breaches');
  check(buildBreaches(null, null).length === 0, 'null inputs → empty array, no throw');

  // ── hasEnabledRules ───────────────────────────────────────────────────────
  console.log('\n--- hasEnabledRules ---');
  check(hasEnabledRules(rules) === true, 'has at least one enabled rule with a type name');
  check(hasEnabledRules([{ id: '1', typeName: 'X', threshold: 1, enabled: false }]) === false, 'only-disabled → false');
  check(hasEnabledRules([]) === false, 'empty → false');
  check(hasEnabledRules(null) === false, 'null → false, no throw');
  check(
    hasEnabledRules([{ id: '1', typeName: '', threshold: 1, enabled: true }]) === false,
    'enabled rule with blank typeName → false (nothing to key off)'
  );

  // ── validateAlertRule ─────────────────────────────────────────────────────
  console.log('\n--- validateAlertRule ---');
  {
    const r = validateAlertRule({ typeName: '  GP Routine  ', threshold: '3', enabled: true });
    check(r.valid === true, 'valid rule accepted');
    check(r.rule.typeName === 'GP Routine', 'typeName trimmed');
    check(r.rule.threshold === 3, 'string threshold coerced to number');
    check(typeof r.rule.id === 'string' && r.rule.id.length > 0, 'id generated when absent');
  }
  {
    const r = validateAlertRule({ typeName: '', threshold: 3, enabled: true });
    check(r.valid === false, 'blank typeName rejected');
    check(typeof r.error === 'string' && r.error.length > 0, 'error message provided');
  }
  {
    const r = validateAlertRule({ typeName: 'X', threshold: -5, enabled: true });
    check(r.rule.threshold === 0, 'negative threshold clamped to 0');
  }
  {
    const r = validateAlertRule({ typeName: 'X', threshold: 99999, enabled: true });
    check(r.rule.threshold === 999, 'excessive threshold clamped to max 999');
  }
  {
    const r = validateAlertRule({ typeName: 'X', threshold: 'not-a-number', enabled: true });
    check(r.rule.threshold === 0, 'non-numeric threshold falls back to 0');
  }
  {
    const r = validateAlertRule({ id: 'keep-me', typeName: 'X', threshold: 1, enabled: false });
    check(r.rule.id === 'keep-me', 'existing id preserved (edit, not create)');
    check(r.rule.enabled === false, 'enabled: false preserved');
  }
  check(validateAlertRule({}).valid === false, 'empty object rejected, no throw');
  check(validateAlertRule(null).valid === false, 'null rejected, no throw');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
