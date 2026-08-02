// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Sentinel — Shadow comparator
//
// Safety gate for the data-feed port: run the SAME rule engine on the legacy
// bundle (scraped/internal API) and the new Transactional bundle, then diff the
// emitted chips. A safety tool must never SILENTLY drop or weaken an alert when
// the data source changes — this catches exactly that.
//
// The dangerous direction is "regression": an alert that disappears, or whose
// status becomes less urgent, under the new feed. Escalations (new/stronger
// alerts) are reported but not failures.

(function (global) {
  'use strict';

  // Higher = more clinically urgent. Covers Sentinel statuses AND triage levels
  // (red/amber) so a dropped triage alert is treated as a regression too.
  // Override via opts.rank.
  const DEFAULT_RANK = {
    red: 5,
    alert: 4,
    overdue: 3,
    amber: 3,
    due: 2,
    no_data: 1,
    achieved: 0,
    ok: 0,
    none: 0,
    null: 0,
  };

  function keyOf(c) {
    return c.ruleId || `${c.type || '?'}:${c.label || c.id || ''}`;
  }
  function rankOf(rank, status) {
    return rank[String(status)] != null ? rank[String(status)] : 0;
  }

  // diffChips(legacyChips, txnChips, opts) -> report
  function diffChips(legacy, txn, opts) {
    const rank = (opts && opts.rank) || DEFAULT_RANK;
    const L = new Map((legacy || []).map((c) => [keyOf(c), c]));
    const T = new Map((txn || []).map((c) => [keyOf(c), c]));

    const dropped = []; // present in legacy, missing under new feed
    const added = []; // new under the new feed
    const flips = []; // same rule, different status
    const regressions = []; // the unsafe subset

    for (const [k, c] of L) {
      if (!T.has(k)) {
        dropped.push({ key: k, status: c.status });
        if (rankOf(rank, c.status) > 0) regressions.push({ key: k, kind: 'dropped', from: c.status, to: null });
      } else {
        const t = T.get(k);
        if (String(t.status) !== String(c.status)) {
          const dir =
            rankOf(rank, t.status) < rankOf(rank, c.status)
              ? 'regression'
              : rankOf(rank, t.status) > rankOf(rank, c.status)
                ? 'escalation'
                : 'lateral';
          flips.push({ key: k, from: c.status, to: t.status, direction: dir });
          if (dir === 'regression') regressions.push({ key: k, kind: 'weakened', from: c.status, to: t.status });
        }
      }
    }
    for (const [k, c] of T) if (!L.has(k)) added.push({ key: k, status: c.status });

    return {
      counts: { legacy: L.size, txn: T.size, dropped: dropped.length, added: added.length, flips: flips.length },
      dropped,
      added,
      flips,
      regressions,
      safe: regressions.length === 0,
      verdict:
        regressions.length === 0
          ? 'PASS — no safety regressions (no dropped/weakened alerts)'
          : `REVIEW — ${regressions.length} regression(s): alerts dropped or weakened under the new feed`,
    };
  }

  // Compare two evaluateReportSeverity() outputs. A regression is the results
  // engine reporting LESS urgency under the new feed (level downgraded, or fewer
  // urgent/abnormal/review results) — i.e. an abnormal result going unflagged.
  const LEVEL_RANK = { red: 2, amber: 1, none: 0 };
  function diffSeverity(legacy, txn) {
    const L = legacy || {},
      T = txn || {};
    const regressions = [];
    if ((LEVEL_RANK[T.level] || 0) < (LEVEL_RANK[L.level] || 0))
      regressions.push({ field: 'level', from: L.level, to: T.level });
    for (const f of ['urgentCount', 'abnormalCount', 'reviewCount']) {
      if ((T[f] || 0) < (L[f] || 0)) regressions.push({ field: f, from: L[f] || 0, to: T[f] || 0 });
    }
    return {
      legacy: { level: L.level, urgentCount: L.urgentCount, abnormalCount: L.abnormalCount },
      txn: { level: T.level, urgentCount: T.urgentCount, abnormalCount: T.abnormalCount },
      regressions,
      safe: regressions.length === 0,
      verdict:
        regressions.length === 0
          ? 'PASS — results severity preserved under the new feed'
          : `REVIEW — ${regressions.length} severity regression(s): abnormal result(s) under-flagged`,
    };
  }

  const api = { diffChips, diffSeverity, DEFAULT_RANK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SentinelShadowCompare = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
