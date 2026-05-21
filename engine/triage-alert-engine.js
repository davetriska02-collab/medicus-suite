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
      const count = buckets[rule.key]?.count ?? 0;
      if (count < rule.threshold) continue;

      const level = count >= rule.threshold * 2 ? 'red' : 'amber';
      triggered.push({ key: rule.key, label: rule.label, count, threshold: rule.threshold, level });
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
