// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Slots proactive alert-threshold evaluation (pure ES module, no chrome/DOM)
//
// Per-appointment-type "alert if fewer than N remaining" rules. The storage
// shape and evaluation semantics already existed inline in slots.js
// (typeAlertLevel/overallAlertLevel) — this module extracts that logic into a
// pure, Node-testable core so it can be shared with the Today module's
// "Slots Today" card (item 9) without duplicating the threshold comparison,
// and regression-tested directly (test-slots-alerts.js).
//
// Rule shape (chrome.storage.local['slots.alertRules'], array):
//   { id, typeName, threshold, enabled }
// A rule fires when the type's total (AM+PM) count is <= threshold:
//   count === 0        → 'red'   (completely gone)
//   0 < count <= thresh → 'amber' (running low)
//   count > threshold   → not firing
// Disabled rules and rules for a type not present in the day's data are
// simply skipped — never treated as "0 remaining".

'use strict';

// Alert level for ONE appointment type given its AM+PM total count, checked
// against every enabled rule for that type name. If more than one enabled
// rule targets the same type, the WORST (most severe) level wins — a
// practice should never see a calmer reading than its strictest rule.
export function typeAlertLevel(rules, typeName, count) {
  let level = null;
  for (const rule of rules || []) {
    if (!rule || !rule.enabled || rule.typeName !== typeName) continue;
    const threshold = Number(rule.threshold);
    if (!Number.isFinite(threshold) || threshold < 0) continue;
    if (count <= threshold) {
      const ruleLevel = count === 0 ? 'red' : 'amber';
      if (ruleLevel === 'red') return 'red'; // red is already the worst — short-circuit
      level = 'amber';
    }
  }
  return level;
}

// Highest triggered level across ALL enabled rules for a byType map
// ({ [typeName]: { am, pm } }), or null when nothing breaches. Mirrors the
// alert ribbon's "worst wins" convention.
export function overallAlertLevel(rules, byType) {
  let level = null;
  for (const rule of rules || []) {
    if (!rule || !rule.enabled) continue;
    const n = byType?.[rule.typeName];
    const count = (n?.am || 0) + (n?.pm || 0);
    const l = typeAlertLevel(rules, rule.typeName, count);
    if (l === 'red') return 'red';
    if (l === 'amber') level = 'amber';
  }
  return level;
}

// Full breach list — every ENABLED rule currently at/below its threshold,
// with the live count and computed level attached. Sorted red-first, then by
// ascending count (the most depleted type leads). Used by both the Slots
// ribbon (already inline in slots.js — could migrate to this in a follow-up)
// and, per item 9, the Today "Slots Today" card / headline clause, which have
// no access to slots.js's in-module byType shape and need a self-contained
// evaluator to run against whatever slot count data they've already fetched.
//
// `byType` — { [typeName]: { am, pm } } (slots.js's aggregate() shape) OR a
// flat { [typeName]: count } map (Today's lean fetch only tracks a running
// total, not per-type — see buildBreaches's flatCount support below).
export function buildBreaches(rules, byType) {
  const enabled = (rules || []).filter((r) => r && r.enabled && r.typeName);
  const breaches = [];
  for (const rule of enabled) {
    const n = byType?.[rule.typeName];
    const count = typeof n === 'number' ? n : (n?.am || 0) + (n?.pm || 0);
    if (n == null) continue; // type not present in today's data — nothing to alert on
    const threshold = Number(rule.threshold);
    if (!Number.isFinite(threshold) || threshold < 0) continue;
    if (count > threshold) continue;
    breaches.push({
      typeName: rule.typeName,
      threshold,
      count,
      level: count === 0 ? 'red' : 'amber',
    });
  }
  breaches.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'red' ? -1 : 1;
    return a.count - b.count;
  });
  return breaches;
}

// True when at least one enabled rule is defined — used to decide whether it
// is worth fetching per-type breakdowns at all in a lean consumer like Today.
export function hasEnabledRules(rules) {
  return Array.isArray(rules) && rules.some((r) => r && r.enabled && r.typeName);
}

// Validate + normalise a single rule row for the editor UI (item 9's
// in-module editor). Returns { valid, error, rule } — never throws. threshold
// is clamped to a sane 0–999 range (a slot count alert past that is not a
// realistic use case and more likely a fat-fingered entry).
const THRESHOLD_MIN = 0;
const THRESHOLD_MAX = 999;

export function validateAlertRule(raw) {
  const typeName = typeof raw?.typeName === 'string' ? raw.typeName.trim() : '';
  if (!typeName) return { valid: false, error: 'Pick an appointment type.', rule: null };
  let threshold = Number(raw?.threshold);
  if (!Number.isFinite(threshold)) threshold = 0;
  threshold = Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(threshold)));
  return {
    valid: true,
    error: null,
    rule: {
      id: raw?.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      typeName,
      threshold,
      enabled: raw?.enabled !== false,
    },
  };
}
