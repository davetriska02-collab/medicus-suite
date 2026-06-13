// engine/result-severity.js — Investigation result severity scorer
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Consumes the output of normaliseInvestigationReport (engine/normalisers.js)
// and returns a severity level for chip display in the investigation results queue.
//
// Severity rules (lab-flag-led; no custom clinical thresholds):
//   red   — any result has urgent === true (requiresUrgentReview from API)
//   amber — any result is above or below reference range (but none urgent)
//   none  — all results within range, or no results
//
// opts.resultRules (optional array of analyte-threshold rules) can ESCALATE severity
// on top of the lab's own flags — they never lower lab-flagged severity.
// Rules are matched case-insensitively by substring against result.name.
//
// The `thresholds` option in opts is an intentional extension point for future
// named-analyte escalation logic (e.g. sodium < 120 → red regardless of lab flag).
// It is accepted but not acted upon in this version — do not add clinical logic here
// without clinical safety officer sign-off.

(function (global) {
  'use strict';

  // ── Severity ordering helpers ─────────────────────────────────────────────────
  // Internal severity levels: 'none' < 'abnormal' < 'urgent'
  const SEV_ORDER = { none: 0, abnormal: 1, urgent: 2 };

  function maxSev(a, b) {
    return SEV_ORDER[a] >= SEV_ORDER[b] ? a : b;
  }

  // ── Compute rule-derived severity for a single result ─────────────────────────
  // Deliberately does NOT import result-rules.js to avoid a content-world dep.
  // Uses minimal inline guards only.
  function computeRuleSev(result, rules) {
    if (!Array.isArray(rules) || rules.length === 0) return 'none';
    if (!result || typeof result !== 'object') return 'none';

    const name = typeof result.name === 'string' ? result.name.toLowerCase() : '';
    const value = result.value;
    if (!Number.isFinite(value)) return 'none';

    let best = 'none';

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule || typeof rule !== 'object') continue;
      // Guard: skip disabled rules (caller should pass only enabled ones, but be safe)
      if (rule.enabled === false) continue;
      // Guard: analyte.match must be a non-empty array
      const analyte = rule.analyte;
      if (!analyte || !Array.isArray(analyte.match) || analyte.match.length === 0) continue;
      // Guard: comparator must be 'above' or 'below'
      if (rule.comparator !== 'above' && rule.comparator !== 'below') continue;

      // Check if any match substring hits the result name
      const hits = analyte.match.some(
        m => typeof m === 'string' && m.length > 0 && name.includes(m.toLowerCase())
      );
      if (!hits) continue;

      // Evaluate threshold
      let ruleSev = 'none';
      const amber = rule.amber;
      const red = rule.red;

      if (rule.comparator === 'above') {
        if (Number.isFinite(red) && value >= red) {
          ruleSev = 'urgent';
        } else if (Number.isFinite(amber) && value >= amber) {
          ruleSev = 'abnormal';
        }
      } else {
        // 'below'
        if (Number.isFinite(red) && value <= red) {
          ruleSev = 'urgent';
        } else if (Number.isFinite(amber) && value <= amber) {
          ruleSev = 'abnormal';
        }
      }

      best = maxSev(best, ruleSev);
      if (best === 'urgent') break; // can't go higher
    }

    return best;
  }

  /**
   * evaluateReportSeverity(report, opts)
   *
   * @param {object} report  Output of normaliseInvestigationReport().
   * @param {object} [opts]
   * @param {string} [opts.priorityDisplay]  Queue row priority text e.g. "High", "Routine".
   * @param {object} [opts.thresholds]       Reserved for future named-analyte thresholds.
   * @param {Array}  [opts.resultRules]      Analyte-threshold escalation rules (see result-rules.js).
   *                                         Rules ESCALATE severity; they never lower lab flags.
   * @returns {{ level, urgentCount, abnormalCount, top, misprioritised, unmatched }}
   */
  function evaluateReportSeverity(report, opts) {
    const none = {
      level: 'none',
      urgentCount: 0,
      abnormalCount: 0,
      top: null,
      misprioritised: false,
      unmatched: false
    };

    try {
      if (!report || !Array.isArray(report.results)) return none;

      const results = report.results;
      const priorityDisplay = (opts && opts.priorityDisplay) ? String(opts.priorityDisplay) : '';
      const resultRules = (opts && Array.isArray(opts.resultRules)) ? opts.resultRules : [];

      let urgentCount = 0;
      let abnormalCount = 0;
      let firstUrgent = null;
      let firstAbnormal = null;

      results.forEach(r => {
        if (!r || typeof r !== 'object') return;

        // Lab-derived severity
        const labSev = r.urgent ? 'urgent' : (r.isAbove || r.isBelow ? 'abnormal' : 'none');

        // Rule-derived severity (escalation only)
        const ruleSev = computeRuleSev(r, resultRules);

        // Effective severity: never below lab severity
        const effSev = maxSev(labSev, ruleSev);

        if (effSev === 'urgent') {
          urgentCount++;
          if (!firstUrgent) firstUrgent = r;
        }
        if (effSev === 'abnormal' || effSev === 'urgent') {
          abnormalCount++;
          if (!firstAbnormal) firstAbnormal = r;
        }
      });

      let level;
      if (urgentCount > 0) {
        level = 'red';
      } else if (abnormalCount > 0) {
        level = 'amber';
      } else {
        level = 'none';
      }

      // The single most salient analyte for chip display:
      // an urgent result if any; otherwise the first abnormal result.
      const salient = firstUrgent || firstAbnormal || null;
      const top = salient
        ? { name: salient.name, value: salient.value, unit: salient.unit }
        : null;

      // misprioritised: red severity but the queue row priority is NOT high/urgent/immediate
      const misprioritised =
        level === 'red' && !/high|urgent|immediate/i.test(priorityDisplay);

      return {
        level,
        urgentCount,
        abnormalCount,
        top,
        misprioritised,
        unmatched: !!report.unmatched
      };
    } catch (_) {
      return none;
    }
  }

  // ── Module export (dual-mode: Node require OR browser global) ───────────────
  const api = { evaluateReportSeverity };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.SentinelResultSeverity = api;
  }
})(typeof window !== 'undefined' ? window : global);
