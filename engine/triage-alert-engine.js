// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Triage Alert Engine
// Stateless evaluator: compares bucket counts against user-defined rules.

'use strict';

(function (global) {

  function evaluate(buckets, rules) {
    if (!Array.isArray(rules) || !buckets) {
      return { triggered: [], maxLevel: null };
    }

    const triggered = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;
      // Guard against a non-numeric / missing threshold (e.g. an imported or
      // hand-edited rule with "" or null): without this, `count < ""` coerces
      // to 0 and the rule fires never, or `< null` and it always fires — both
      // silent. Skip the rule and say so rather than mis-fire.
      const threshold = Number(rule.threshold);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        if (typeof console !== 'undefined') {
          console.warn(`[Sentinel] threshold rule "${rule.label || rule.key}" has invalid threshold ${JSON.stringify(rule.threshold)} — skipped`);
        }
        continue;
      }
      const count = buckets[rule.key]?.count ?? 0;
      if (count < threshold) continue;

      const level = count >= threshold * 2 ? 'red' : 'amber';
      triggered.push({ key: rule.key, label: rule.label, count, threshold, level });
    }

    let maxLevel = null;
    if (triggered.some(t => t.level === 'red'))   maxLevel = 'red';
    else if (triggered.length > 0)                maxLevel = 'amber';

    return { triggered, maxLevel };
  }

  const TriageAlertEngine = { evaluate };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TriageAlertEngine;
  } else {
    global.TriageAlertEngine = TriageAlertEngine;
  }

})(typeof self !== 'undefined' ? self : this);
