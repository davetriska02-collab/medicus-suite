// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Transactional API Parity Report
//
// One-click assurance evidence pack for the hybrid crossover period: turns the
// Clinical Event Ledger's (shared/event-ledger.js) 'sentinel' events into a
// human-readable Markdown summary a practice can hand to an assurance
// reviewer without ever opening the raw ledger table.
//
// Only THREE ledger event kinds are in scope (carried in the `ruleId` field,
// source 'sentinel' — see content-scripts/sentinel.js computeApiShadowStatus):
//   'txn-shadow-divergence' — hybrid mode found a difference between the
//        displayed (session) chips and the shadow API-fed chips. action
//        'shown'; label like "missing 1 added 0 changed 0"; severity
//        'regression' or 'escalation-only'.
//   'txn-shadow-unavailable' — hybrid mode could not fetch/evaluate the
//        shadow API bundle at all. action 'aborted'; label = failure reason.
//   'txn-fallback' — transactional mode asked for the API feed but fell back
//        to session data. action 'aborted'; label = fallback reason.
// Everything else in the ledger (other sources/ruleIds) is ignored.
//
// LOAD-BEARING HONESTY: a patient view in hybrid mode that found PARITY
// records NO ledger event at all (see sentinel.js: only a divergence writes
// 'txn-shadow-divergence'). So this report counts observed divergences and
// feed failures — it does NOT know how many patient views were checked, and
// cannot compute a "parity rate". An empty report over a long period is the
// strong (indirect) signal of good parity, not a directly-measured one. Both
// this module's doc comments and renderParityReportMarkdown()'s preamble say
// this explicitly — see options/options.js's ledger disclosure for the same
// doctrine ("absence of an event is not evidence nothing was shown").
//
// Both functions are PURE: buildParityReport takes events + an explicit
// nowIso (never calls Date.now/new Date() with no argument) so the module is
// clock-free and its output is deterministic for a given input. Callers
// (options/options.js) own supplying the events (via EventLedger.getEvents())
// and the clock reading.
//
// No patient identifiers are read, stored, or interpolated anywhere in this
// module — ledger events carry no patient name (see event-ledger.js
// sanitisePatientRef), and this module never touches the `patientRef` field
// at all, by design, so there is nothing patient-shaped to leak into the
// report even if a caller passed dirty events.
//
// Usage (browser classic script): window.TxnParityReport.<fn>(...)
// Usage (Node / test):             require('./shared/txn-parity-report.js').<fn>(...)
// Dual-export pattern: same as shared/event-ledger.js.

(function (global) {
  'use strict';

  const RELEVANT_RULE_IDS = ['txn-shadow-divergence', 'txn-shadow-unavailable', 'txn-fallback'];

  /** Inclusive ISO-string range check on an event's `ts`. Missing bound = unbounded. */
  function inRange(ts, sinceIso, untilIso) {
    if (typeof ts !== 'string' || !ts) return false;
    if (sinceIso && ts < sinceIso) return false;
    if (untilIso && ts > untilIso) return false;
    return true;
  }

  /** Group-and-count `reason` strings, returned most-frequent-first (ties: first-seen order). */
  function groupReasons(reasons) {
    const order = [];
    const counts = new Map();
    for (const r of reasons) {
      const key = r || '(no reason given)';
      if (!counts.has(key)) {
        counts.set(key, 0);
        order.push(key);
      }
      counts.set(key, counts.get(key) + 1);
    }
    return order
      .map((reason) => ({ reason, count: counts.get(reason) }))
      .sort((a, b) => b.count - a.count || order.indexOf(a.reason) - order.indexOf(b.reason));
  }

  /**
   * Build a structured parity report from ledger events. Pure — never reads
   * the clock; `opts.nowIso` is required and is stamped verbatim as
   * `generatedAt`.
   *
   * @param {Array} events        Ledger events (shared/event-ledger.js shape).
   * @param {object} [opts]
   * @param {string} [opts.sinceIso] Inclusive lower bound on event `ts` (ISO string).
   * @param {string} [opts.untilIso] Inclusive upper bound on event `ts` (ISO string).
   * @param {string} opts.nowIso     Required. Stamped as `generatedAt`.
   */
  function buildParityReport(events, opts) {
    const o = opts || {};
    const sinceIso = o.sinceIso || null;
    const untilIso = o.untilIso || null;

    const relevant = (Array.isArray(events) ? events : []).filter(
      (e) => e && e.source === 'sentinel' && RELEVANT_RULE_IDS.includes(e.ruleId) && inRange(e.ts, sinceIso, untilIso)
    );

    const divergences = relevant.filter((e) => e.ruleId === 'txn-shadow-divergence');
    const unavailable = relevant.filter((e) => e.ruleId === 'txn-shadow-unavailable');
    const fallback = relevant.filter((e) => e.ruleId === 'txn-fallback');

    const divergenceBySeverity = { regression: 0, 'escalation-only': 0, unknown: 0 };
    for (const e of divergences) {
      if (e.severity === 'regression') divergenceBySeverity.regression++;
      else if (e.severity === 'escalation-only') divergenceBySeverity['escalation-only']++;
      else divergenceBySeverity.unknown++;
    }

    // Chronological (oldest first) — the ledger itself is stored newest-first.
    const divergenceSummaries = divergences
      .slice()
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      .map((e) => ({ date: e.ts || null, label: e.label || null, severity: e.severity || null }));

    return {
      range: { from: sinceIso, to: untilIso },
      counts: {
        divergence: divergences.length,
        unavailable: unavailable.length,
        fallback: fallback.length,
        total: relevant.length,
      },
      divergenceBySeverity,
      divergenceSummaries,
      unavailableReasons: groupReasons(unavailable.map((e) => e.label)),
      fallbackReasons: groupReasons(fallback.map((e) => e.label)),
      generatedAt: o.nowIso || null,
    };
  }

  /** Escape the small set of Markdown-significant characters in free text (labels/reasons). */
  function mdEscape(val) {
    if (val == null) return '';
    return String(val).replace(/([|\\`*_[\]])/g, '\\$1');
  }

  function fmtDate(iso) {
    return iso || '(unknown date)';
  }

  function fmtSeverity(sev) {
    return sev || '(unspecified)';
  }

  /** Markdown table for [{reason, count}] — or a "none observed" line when empty. */
  function reasonsTable(rows, emptyLabel) {
    if (!rows || rows.length === 0) return `_${emptyLabel}_\n`;
    const lines = ['| Reason | Count |', '| --- | ---: |'];
    for (const r of rows) {
      lines.push(`| ${mdEscape(r.reason)} | ${r.count} |`);
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Render a parity report (from buildParityReport) as a clean Markdown
   * document. Pure — meta is caller-supplied text only, no clock/storage.
   *
   * @param {object} report          Output of buildParityReport.
   * @param {object} [meta]
   * @param {string} [meta.practiceLabel] Free-text practice/site label for the title.
   * @param {string} [meta.modeNote]      Free-text note on the mode in force (e.g. "Hybrid since 2026-06-01").
   */
  function renderParityReportMarkdown(report, meta) {
    const r = report || {};
    const m = meta || {};
    const counts = r.counts || { divergence: 0, unavailable: 0, fallback: 0, total: 0 };
    const bySev = r.divergenceBySeverity || { regression: 0, 'escalation-only': 0, unknown: 0 };
    const range = r.range || { from: null, to: null };

    const title = m.practiceLabel
      ? `# Medicus Transactional API — parity report — ${mdEscape(m.practiceLabel)}`
      : `# Medicus Transactional API — parity report`;

    const lines = [];
    lines.push(title);
    lines.push('');
    lines.push(`Generated: ${r.generatedAt || '(unknown)'}`);
    lines.push(`Range: ${range.from || '(no lower bound)'} to ${range.to || '(no upper bound)'}`);
    if (m.modeNote) lines.push(`Mode: ${mdEscape(m.modeNote)}`);
    lines.push('');

    lines.push('## What this report is');
    lines.push('');
    lines.push(
      'During the hybrid crossover period, Suite keeps reading the screen exactly as it does today, and ' +
        'silently re-evaluates the same clinical rules against the Medicus Transactional API feed in the ' +
        'background, purely to compare the two. **The ledger only records a divergence or a feed failure — a ' +
        'patient view where the two feeds agreed (parity) records nothing at all.** That means this report ' +
        'cannot state how many patient views were checked or compute a "parity rate": it is a list of every ' +
        'observed disagreement and failure, not a count against a known denominator. A report with zero ' +
        'entries over a long period is the strong, indirect signal that the API feed is matching the screen — ' +
        'not direct proof, because a quiet extension is also what "nothing was open" looks like.'
    );
    lines.push('');

    lines.push('## Counts');
    lines.push('');
    lines.push('| Event kind | Count |');
    lines.push('| --- | ---: |');
    lines.push(`| Divergences (shadow comparison found a difference) | ${counts.divergence} |`);
    lines.push(`| Shadow feed unavailable | ${counts.unavailable} |`);
    lines.push(`| Fallback to session data | ${counts.fallback} |`);
    lines.push(`| **Total** | **${counts.total}** |`);
    lines.push('');

    lines.push('## Divergences by severity');
    lines.push('');
    if (counts.divergence === 0) {
      lines.push('_No divergences observed in this range._');
      lines.push('');
    } else {
      lines.push('| Severity | Count |');
      lines.push('| --- | ---: |');
      lines.push(`| Regression (an alert would have been lost/downgraded) | ${bySev.regression} |`);
      lines.push(`| Escalation-only (a difference, but no safety loss) | ${bySev['escalation-only']} |`);
      if (bySev.unknown) lines.push(`| Unspecified severity | ${bySev.unknown} |`);
      lines.push('');
    }

    lines.push('## Divergence list');
    lines.push('');
    if (!r.divergenceSummaries || r.divergenceSummaries.length === 0) {
      lines.push('_No divergences observed in this range._');
      lines.push('');
    } else {
      lines.push('| Date | Severity | Detail |');
      lines.push('| --- | --- | --- |');
      for (const d of r.divergenceSummaries) {
        lines.push(`| ${fmtDate(d.date)} | ${fmtSeverity(d.severity)} | ${mdEscape(d.label || '(no detail)')} |`);
      }
      lines.push('');
    }

    lines.push('## Shadow feed unavailable — reasons');
    lines.push('');
    lines.push(reasonsTable(r.unavailableReasons, 'No shadow feed failures observed in this range.'));

    lines.push('## Fallback to session data — reasons');
    lines.push('');
    lines.push(reasonsTable(r.fallbackReasons, 'No fallbacks observed in this range.'));

    lines.push('## Raw evidence');
    lines.push('');
    lines.push(
      'This document is a summary. The underlying, unaggregated Clinical Event Ledger — including every ' +
        'field of every event in this range — can be exported as CSV from the Event Ledger section in Suite ' +
        'Options, and is the raw evidence behind the counts above. No patient identifiers appear in this report ' +
        'or in the ledger CSV export; ledger events never carry a patient name.'
    );
    lines.push('');

    return lines.join('\n');
  }

  const api = { buildParityReport, renderParityReportMarkdown };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnParityReport = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
