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
// The `thresholds` option in opts is an intentional extension point for future
// named-analyte escalation logic (e.g. sodium < 120 → red regardless of lab flag).
// It is accepted but not acted upon in this version — do not add clinical logic here
// without clinical safety officer sign-off.

(function (global) {
  'use strict';

  /**
   * evaluateReportSeverity(report, opts)
   *
   * @param {object} report  Output of normaliseInvestigationReport().
   * @param {object} [opts]
   * @param {string} [opts.priorityDisplay]  Queue row priority text e.g. "High", "Routine".
   * @param {object} [opts.thresholds]       Reserved for future named-analyte thresholds.
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

      let urgentCount = 0;
      let abnormalCount = 0;
      let firstUrgent = null;
      let firstAbnormal = null;

      results.forEach(r => {
        if (!r || typeof r !== 'object') return;
        const isUrgent = !!r.urgent;
        const isAbnormal = !!r.isAbove || !!r.isBelow;

        if (isUrgent) {
          urgentCount++;
          if (!firstUrgent) firstUrgent = r;
        }
        if (isAbnormal) {
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
