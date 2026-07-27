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
  // COVERAGE (audit 2026-07-27, High): this table must know EVERY status the
  // engine can emit. It previously listed 9 and the engine emits at least 15 —
  // not_met, stale, vax_due, due_soon, caution, recently_initiated, noted,
  // in_date, vax_given and vax_declined were all absent, and an absent status
  // scored 0, which meant `dropped` recorded the loss while `regressions` did
  // not and the report came back safe:true. A lost vaccine-due or QOF not_met
  // alert was therefore filed as feed-swap assurance evidence saying no safety
  // was lost. Note the engine's own STATUS_RANK (engine/rules-engine.js:29) is
  // INVERTED relative to this one (there 0 = most urgent), so it is mapped
  // deliberately here rather than imported.
  const DEFAULT_RANK = {
    red: 5,
    alert: 4,
    overdue: 3,
    not_met: 3,
    amber: 3,
    due: 2,
    due_soon: 2,
    caution: 2,
    stale: 2,
    vax_due: 2,
    no_data: 1,
    noted: 1,
    recently_initiated: 1,
    // Genuinely benign outcomes — losing one of these is not a safety
    // regression, so they stay at 0 on purpose.
    achieved: 0,
    in_date: 0,
    vax_given: 0,
    vax_declined: 0,
    ok: 0,
    none: 0,
    null: 0,
  };

  // An unrecognised status must FAIL VISIBLE. A new status added to the engine
  // (or a typo in a rule) previously ranked 0 and so was silently treated as
  // benign by the safety gate; ranking it as a real signal means the worst case
  // is a false "unsafe" that a human reviews, not a true loss reported as safe.
  const UNKNOWN_STATUS_RANK = 1;

  function keyOf(c) {
    return c.ruleId || `${c.type || '?'}:${c.label || c.id || ''}`;
  }
  function rankOf(rank, status) {
    const s = String(status);
    if (rank[s] != null) return rank[s];
    // Undefined/null/empty status carries no clinical claim — treat as benign.
    if (status == null || s === '' || s === 'undefined') return 0;
    return UNKNOWN_STATUS_RANK;
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
