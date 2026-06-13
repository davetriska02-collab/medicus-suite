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

  const api = {
    METRICS,
    buildApiUrl,
    fetchActivityReport,
    aggregate,
    preset,
    formatDate,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ActivityApi = api;
  }
})(typeof window !== 'undefined' ? window : global);
