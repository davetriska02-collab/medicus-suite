// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Submissions: pure-logic core (no chrome APIs, no DOM)
//
// The RAG (red/amber/green) threshold evaluation is the single source of truth
// for BOTH the Submissions module charts and the global #subRagStrip in panel.js.
// It previously lived inline in two places (submissions.js getRagLevel +
// panel.js _subRagLevel); both now import from here so the alert thresholds can
// never silently drift apart — a missed amber/red is a demand-management failure.
//
// Exported:
//   DEFAULT_SUB_THRESHOLDS         — shipped defaults (disabled until user opts in)
//   ragLevel(value, threshold)     — 'red' | 'amber' | null for one merged threshold
//   getRagLevel(key, value, thresholds) — convenience: look up key, then ragLevel
//   extractTaskArray(body)         — tolerant task-array extraction from a task-list body
//   taskDateISO(createdAt)         — 'YYYY-MM-DD' from ISO or legacy "DD Mon YYYY" strings
//   windowTaskList(body, startISO, endISO) — hardened counting for the task-list endpoint

'use strict';

// Shipped defaults. `enabled:false` means the strip stays hidden until the user
// turns a category on in Submissions settings.
export const DEFAULT_SUB_THRESHOLDS = {
  medical: { amber: 30, red: 60, enabled: false },
  admin: { amber: 20, red: 40, enabled: false },
};

// Evaluate one already-resolved threshold object against a count.
// Returns null when disabled or below the amber line (so callers can treat
// null as "no alert" uniformly).
export function ragLevel(value, threshold) {
  if (!threshold || !threshold.enabled) return null;
  if (value >= (threshold.red || Infinity)) return 'red';
  if (value >= (threshold.amber || Infinity)) return 'amber';
  return null;
}

// Look up a category's threshold in a thresholds map, then evaluate it.
export function getRagLevel(key, value, thresholds) {
  return ragLevel(value, thresholds && thresholds[key]);
}

// ── Task-list response hardening ──────────────────────────────────────────────
//
// The /tasks/data/{type}/task-list endpoint SILENTLY IGNORES query params it
// doesn't recognise and falls back to its default (open-task) view — that is
// exactly how v3.35.2 happened (`startDate` vs `createdAt_startDate` inflated
// Condor's demand to the whole backlog), and if Medicus ever renames the
// `createdAt_*` filters the failure inverts: every consumer quietly shows the
// *outstanding queue* instead of *work received*, with no error anywhere.
// These helpers make that failure mode detectable and the counts honest.
// Shared by the Submissions module, the Today demand card, the panel
// #subRagStrip and Condor — so the defence cannot drift between them.

// Tolerant task-array extraction. Mirrors page-world.js's handleTaskList shape
// list (tasks | data | results | rows | bare array) so a response-envelope
// rename shows up as a wrong-looking count with a warning, not a silent zero.
export function extractTaskArray(body) {
  const items = body && (body.tasks || body.data || body.results || body.rows || (Array.isArray(body) ? body : null));
  return Array.isArray(items) ? items : [];
}

const _MONTHS = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

// 'YYYY-MM-DD' from an ISO 8601 or legacy "DD Mon YYYY" createdAt, else null.
export function taskDateISO(str) {
  if (!str || typeof str !== 'string') return null;
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const m = str.match(/^(\d{2})\s(\w{3})\s(\d{4})/);
  return m && _MONTHS[m[2]] ? `${m[3]}-${_MONTHS[m[2]]}-${m[1]}` : null;
}

function _isoAddDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function _serverTotal(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const candidates = [body.totalCount, body.total, body.meta && body.meta.totalCount, body.meta && body.meta.total];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c >= 0) return c;
  }
  return null;
}

// Harden one task-list response against silent server-side changes:
//
//   • filterIgnored — true when the response contains tasks created clearly
//     outside [startISO, endISO]. A ±1-day tolerance band absorbs timezone
//     skew (createdAt is UTC; the server's filter semantics are unknown), so
//     a genuine midnight-boundary task never trips a false alarm.
//   • When the filter WAS ignored, tasks are re-windowed client-side to the
//     requested range (tasks with unparseable dates are dropped — they would
//     be invisible to the charts anyway), so counts stay honest even though
//     they may then UNDERCOUNT (the default view omits completed work) —
//     callers must surface `filterIgnored` to the user rather than hide it.
//   • When the response looks healthy it is passed through untouched — zero
//     behaviour change on a working Medicus.
//   • truncated — true when the body carries a server-side total larger than
//     the array it sent (pagination introduced upstream).
//
// Returns { tasks, rawCount, dropped, filterIgnored, serverTotal, truncated }.
export function windowTaskList(body, startISO, endISO) {
  const raw = extractTaskArray(body);
  const serverTotal = _serverTotal(body);
  const truncated = serverTotal != null && serverTotal > raw.length;

  const loose = _isoAddDays(startISO, -1);
  const hi = _isoAddDays(endISO, 1);
  let filterIgnored = false;
  for (const t of raw) {
    const d = taskDateISO(t && t.createdAt);
    if (d && (d < loose || d > hi)) {
      filterIgnored = true;
      break;
    }
  }

  const tasks = filterIgnored
    ? raw.filter((t) => {
        const d = taskDateISO(t && t.createdAt);
        return d != null && d >= startISO && d <= endISO;
      })
    : raw;

  return {
    tasks,
    rawCount: raw.length,
    dropped: raw.length - tasks.length,
    filterIgnored,
    serverTotal,
    truncated,
  };
}
