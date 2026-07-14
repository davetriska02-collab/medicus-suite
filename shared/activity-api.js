// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Activity Report API
//
// Endpoint:
//   GET /reporting/data/activity/report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//
// Response shape:
//   {
//     startDate, endDate,
//     rowData: [{
//       name,
//       consultations,
//       routinePrescriptionRequestTasks,
//       nonRoutinePrescriptionRequestTasks,
//       medicationReviews,
//       documentTasks,
//       investigationReportTasks  // UI label: "Results Tasks"
//     }]
//   }

(function (global) {
  'use strict';

  // Metric definitions in display order. The chart colours each segment in
  // this sequence. Short labels are used in the legend and column headers.
  const METRICS = [
    { key: 'consultations', short: 'Consults', long: 'Consultations', colour: 'var(--cat-1)' }, // blue
    {
      key: 'routinePrescriptionRequestTasks',
      short: 'Routine Rx',
      long: 'Routine prescription requests',
      colour: 'var(--cat-2)',
    }, // teal
    {
      key: 'nonRoutinePrescriptionRequestTasks',
      short: 'Non-routine',
      long: 'Non-routine prescription requests',
      colour: 'var(--cat-3)',
    }, // purple-magenta
    { key: 'medicationReviews', short: 'Med reviews', long: 'Medication reviews', colour: 'var(--cat-4)' }, // violet
    { key: 'documentTasks', short: 'Documents', long: 'Document tasks', colour: 'var(--cat-5)' }, // slate
    {
      key: 'investigationReportTasks',
      short: 'Results',
      long: 'Investigation report tasks (Results)',
      colour: 'var(--cat-6)',
    }, // cyan
  ];

  // F8: Practice code format guard — same 4–8 hex-char pattern as practice-code.js.
  // Centralised definition lives in practice-code.js (SITE_CODE_RE / isValidPracticeCode);
  // this local copy exists because activity-api.js is an IIFE that may run before
  // PracticeCode is available (e.g. during unit tests). Keep in sync with practice-code.js.
  const _SITE_CODE_RE = /^[a-f0-9]{4,8}$/i;
  function _isValidPracticeCode(code) {
    return typeof code === 'string' && _SITE_CODE_RE.test(code);
  }

  function buildApiUrl(practiceCode, startDate, endDate) {
    const base = `https://${practiceCode}.api.england.medicus.health/reporting/data/activity/report`;
    const params = new URLSearchParams();
    params.append('startDate', startDate);
    params.append('endDate', endDate);
    return `${base}?${params.toString()}`;
  }

  async function fetchActivityReport(practiceCode, startDate, endDate, opts) {
    opts = opts || {};
    const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) throw new Error('No fetch impl');
    if (!practiceCode) throw new Error('No practice code');
    // F8: Abort if practiceCode doesn't match expected format — prevents fetch to
    // an unexpected host if an injected or malformed value reaches this function.
    if (!_isValidPracticeCode(practiceCode)) throw new Error(`Invalid practice code format: ${practiceCode}`);
    if (!startDate || !endDate) throw new Error('Date range required');

    const url = buildApiUrl(practiceCode, startDate, endDate);
    const r = await fetchImpl(url, { credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return data;
  }

  // Aggregate raw API rowData into useful shapes for rendering.
  //
  // Returns:
  //   {
  //     users: [{ name, metrics: { key→count }, total }]  // sorted by total desc
  //     totals: { metric_key → sum across users, plus 'all' for grand total }
  //     maxUserTotal: number  // for scaling user bars
  //   }
  function aggregate(rowData) {
    const rows = Array.isArray(rowData) ? rowData : [];

    const totals = { all: 0 };
    METRICS.forEach((m) => {
      totals[m.key] = 0;
    });

    const users = rows.map((row) => {
      const metrics = {};
      let userTotal = 0;
      METRICS.forEach((m) => {
        const v = Number(row[m.key]) || 0;
        metrics[m.key] = v;
        totals[m.key] += v;
        userTotal += v;
      });
      totals.all += userTotal;
      return { name: row.name || '(unnamed)', metrics, total: userTotal };
    });

    users.sort((a, b) => b.total - a.total);

    const maxUserTotal = users.reduce((m, u) => Math.max(m, u.total), 0);

    return { users, totals, maxUserTotal };
  }

  // Date preset helpers — return [startDate, endDate] in YYYY-MM-DD format
  // using local time (so "today" matches what the user sees on the clock).

  function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function preset(name, now) {
    const today = now ? new Date(now) : new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    const end = new Date(today);

    switch (name) {
      case 'today':
        break;
      case 'yesterday':
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        break;
      case 'last7':
        start.setDate(start.getDate() - 6); // 7 days inclusive of today
        break;
      case 'last30':
        start.setDate(start.getDate() - 29);
        break;
      case 'thisMonth':
        start.setDate(1);
        break;
      case 'lastMonth':
        start.setMonth(start.getMonth() - 1);
        start.setDate(1);
        end.setDate(0); // last day of previous month
        break;
      default:
        return null;
    }
    return [formatDate(start), formatDate(end)];
  }

  // Inclusive day-count between two ISO dates. Pure date maths — no timezone surprises
  // because we parse the Y/M/D components ourselves rather than trusting `new Date(iso)`
  // (which treats a bare YYYY-MM-DD as UTC midnight and can shift a day under some TZs).
  function daysBetweenInclusive(startISO, endISO) {
    if (!startISO || !endISO) return 0;
    const [sy, sm, sd] = startISO.split('-').map(Number);
    const [ey, em, ed] = endISO.split('-').map(Number);
    const s = new Date(sy, sm - 1, sd);
    const e = new Date(ey, em - 1, ed);
    const days = Math.round((e - s) / 86400000) + 1;
    return Number.isFinite(days) ? days : 0;
  }

  function daysInMonth(y, m0) {
    // m0 is zero-based (Date convention); day 0 of the next month = last day of m0.
    return new Date(y, m0 + 1, 0).getDate();
  }

  // The comparison span for the "vs previous period" toggle (Decision: FEATURE 1b).
  //
  // Two cases:
  //  - `[start,end]` is a MONTH-TO-DATE or FULL-CALENDAR-MONTH span (start is the 1st
  //    of its month) → the previous span is the same calendar span one month earlier:
  //    1st of the prior month through either the same day-of-month (month-to-date,
  //    clamped to the prior month's length) or the prior month's own last day (when
  //    `[start,end]` is itself a complete calendar month, e.g. the "Last month" preset).
  //    This mirrors the "month to date vs same span last month" convention used by
  //    Submissions and Condor's Pulse — a partial current month is never compared
  //    against a full prior month, which would overstate the delta.
  //  - Any other range (a plain N-day span, e.g. "Last 7d"/"Last 30d" or a custom
  //    from/to pick) → the immediately preceding span of equal length, mirroring
  //    condor/report/report-data.js's previousRange() for the day-range case.
  //
  // A single DAY pick (start === end) always takes the general branch, even when that
  // day happens to be the 1st of a month — otherwise "Today" landing on the 1st would
  // arbitrarily compare against the 1st of last month while every other single-day pick
  // compares against its immediately preceding day, which would be an inconsistent,
  // date-dependent surprise rather than a deliberate month view.
  //
  // Returns `[prevStartISO, prevEndISO]`.
  function previousRange(startISO, endISO) {
    const [sy, sm, sd] = startISO.split('-').map(Number);
    const [ey, em, ed] = endISO.split('-').map(Number);
    const sameMonth = sy === ey && sm === em;
    const isMonthBased = sd === 1 && sameMonth && startISO !== endISO;

    if (isMonthBased) {
      const prevMonthDate = new Date(sy, sm - 2, 1); // JS Date rolls Jan back into prior Dec
      const py = prevMonthDate.getFullYear();
      const pm = prevMonthDate.getMonth();
      const lastDayPrevMonth = daysInMonth(py, pm);
      const isFullCurrentMonth = ed === daysInMonth(sy, sm - 1);
      const prevEndDay = isFullCurrentMonth ? lastDayPrevMonth : Math.min(ed, lastDayPrevMonth);
      const prevStart = new Date(py, pm, 1);
      const prevEnd = new Date(py, pm, prevEndDay);
      return [formatDate(prevStart), formatDate(prevEnd)];
    }

    // General case: the equal-length span immediately preceding [start,end].
    const days = daysBetweenInclusive(startISO, endISO);
    const prevEnd = new Date(sy, sm - 1, sd - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));
    return [formatDate(prevStart), formatDate(prevEnd)];
  }

  // Percentage change current vs previous, with a safe direction label. Same semantics
  // as condor/report/report-data.js's comparePct (kept as a local mirror, not an import,
  // to avoid coupling the activity module to condor's report internals — see CLAUDE.md's
  // per-module IO convention).
  function comparePct(current, previous) {
    const cur = Number(current) || 0;
    const prev = Number(previous) || 0;
    if (prev === 0) {
      if (cur === 0) return { pct: 0, direction: 'flat' };
      return { pct: null, direction: 'up' }; // up from zero — percentage undefined
    }
    const pct = Math.round(((cur - prev) / prev) * 100);
    return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
  }

  const api = {
    METRICS,
    buildApiUrl,
    fetchActivityReport,
    aggregate,
    preset,
    formatDate,
    daysBetweenInclusive,
    previousRange,
    comparePct,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ActivityApi = api;
  }
})(typeof window !== 'undefined' ? window : global);
