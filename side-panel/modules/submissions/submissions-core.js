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

// ── Received-work day ledger ──────────────────────────────────────────────────
//
// CONFIRMED against the live API (2026-07-06 probe, see CHANGELOG v3.153.0):
// the /tasks/data/{type}/task-list endpoint only ever contains OPEN tasks —
// its status filter has no "completed" option; completed requests leave the
// table entirely (a full Monday's intake showed 2 residual tasks a week
// later). So a date-filtered count is "received AND still open", and the
// number erodes as the team works: the tracker systematically undercounted
// "work received", worst on busy mornings.
//
// The API cannot return completed tasks, so the suite REMEMBERS them instead:
// every poller that hits the endpoint (Submissions module, Today demand card,
// panel #subRagStrip, Condor — all every 60s while visible) merges the task
// IDs it sees into a persistent per-day ledger. Once seen, a task stays
// counted after completion. Days the suite watched live are accurate; days it
// didn't are flagged as undercounts by the callers.
//
// Ledger shape (storage key 'submissions.ledger', wrapped by
// submissions-ledger.js):
//   { v: 1, days: { 'YYYY-MM-DD': {
//       watched?: true,                      // suite polled during that day
//       [category]: { ids: { uuid: hour } }  // live form (today)
//                  | { n: 12, hourly: [24] } // compacted form (past days)
//   } } }
//
// PHI: task UUIDs + creation hour only — no patient identifiers — and the
// UUIDs are compacted away to bare counts at the first poll of the next day.

export const SUB_LEDGER_RETAIN_DAYS = 92;

// Local calendar date (NOT toISOString(), which rolls the day over in UTC).
export function localDateISO(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Hour-of-day from an ISO 8601 or legacy "DD Mon YYYY HH:MM" createdAt, else null.
export function taskHour(str) {
  if (!str || typeof str !== 'string') return null;
  const iso = str.match(/T(\d{2}):\d{2}/);
  if (iso) return parseInt(iso[1], 10);
  const m = str.match(/(\d{2}):(\d{2})(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}

export function emptyLedger() {
  return { v: 1, days: {} };
}

// Structural guard for ledgers read from storage or a backup: returns a valid
// ledger, dropping anything malformed (never throws).
export function normaliseLedger(raw) {
  const out = emptyLedger();
  if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') return out;
  for (const [date, day] of Object.entries(raw.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !day || typeof day !== 'object') continue;
    const cleanDay = {};
    if (day.watched === true) cleanDay.watched = true;
    for (const [key, entry] of Object.entries(day)) {
      if (key === 'watched' || !entry || typeof entry !== 'object') continue;
      if (entry.ids && typeof entry.ids === 'object' && !Array.isArray(entry.ids)) {
        const ids = {};
        for (const [id, h] of Object.entries(entry.ids)) {
          if (typeof id === 'string' && id) ids[id] = typeof h === 'number' && h >= 0 && h <= 23 ? h : 0;
        }
        cleanDay[key] = { ids };
      } else if (typeof entry.n === 'number' && Number.isFinite(entry.n) && entry.n >= 0) {
        const hourly = new Array(24).fill(0);
        if (Array.isArray(entry.hourly)) {
          for (let i = 0; i < 24; i++) {
            const v = entry.hourly[i];
            if (typeof v === 'number' && Number.isFinite(v) && v >= 0) hourly[i] = v;
          }
        }
        cleanDay[key] = { n: Math.floor(entry.n), hourly };
      }
    }
    out.days[date] = cleanDay;
  }
  return out;
}

// Mark today as live-watched (the suite was polling during this calendar day),
// even if the poll returned zero tasks.
export function touchLedgerDay(ledger, dateISO) {
  const day = (ledger.days[dateISO] = ledger.days[dateISO] || {});
  day.watched = true;
  return ledger;
}

function _hourlyFromRows(rows) {
  const hourly = new Array(24).fill(0);
  for (const r of rows) hourly[r.hour]++;
  return hourly;
}

// Merge one category's fetched tasks into the ledger (mutates + returns it).
// Idempotent per task ID. Past-day tasks (from a range fetch or the residual
// open tasks of an old day) merge into that day's entry — they can only ever
// ADD to what is remembered, never remove.
export function mergeTasksIntoLedger(ledger, key, tasks, todayISO) {
  const cutoff = _isoAddDays(todayISO, -SUB_LEDGER_RETAIN_DAYS);
  const byDate = new Map();
  for (const t of tasks || []) {
    const id = t && t.id != null ? String(t.id) : '';
    const date = taskDateISO(t && t.createdAt);
    if (!id || !date || date < cutoff) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    const h = taskHour(t.createdAt);
    byDate.get(date).push({ id, hour: h != null && h >= 0 && h <= 23 ? h : 0 });
  }
  for (const [date, rows] of byDate) {
    const day = (ledger.days[date] = ledger.days[date] || {});
    const cur = day[key];
    if (cur && typeof cur.n === 'number') {
      // Already compacted (IDs discarded) — can only correct upward if the live
      // view somehow shows more than was remembered.
      if (rows.length > cur.n) {
        cur.n = rows.length;
        cur.hourly = _hourlyFromRows(rows);
      }
    } else {
      const entry = cur && cur.ids ? cur : (day[key] = { ids: {} });
      for (const r of rows) {
        if (!(r.id in entry.ids)) entry.ids[r.id] = r.hour;
      }
    }
  }
  return ledger;
}

// Compact past days (IDs → counts, discarding the UUIDs) and drop days beyond
// retention. Mutates + returns the ledger. Call on every write.
export function compactLedger(ledger, todayISO) {
  const cutoff = _isoAddDays(todayISO, -SUB_LEDGER_RETAIN_DAYS);
  for (const [date, day] of Object.entries(ledger.days)) {
    if (date < cutoff) {
      delete ledger.days[date];
      continue;
    }
    if (date >= todayISO) continue;
    for (const [key, entry] of Object.entries(day)) {
      if (key === 'watched' || !entry || !entry.ids) continue;
      const rows = Object.entries(entry.ids).map(([id, hour]) => ({ id, hour }));
      day[key] = { n: rows.length, hourly: _hourlyFromRows(rows) };
    }
  }
  return ledger;
}

// Chart-ready series for one day: { [key]: { total, hourly[24], cumulative[24] } }.
// Missing categories/days come back zero-filled.
export function ledgerSeriesForDay(ledger, dateISO, keys) {
  const day = (ledger && ledger.days && ledger.days[dateISO]) || {};
  const out = {};
  for (const key of keys) {
    const entry = day[key];
    let hourly = new Array(24).fill(0);
    let total = 0;
    if (entry && entry.ids) {
      for (const h of Object.values(entry.ids)) hourly[h >= 0 && h <= 23 ? h : 0]++;
      total = Object.keys(entry.ids).length;
    } else if (entry && typeof entry.n === 'number') {
      hourly = entry.hourly && entry.hourly.length === 24 ? entry.hourly.slice() : hourly;
      total = entry.n;
    }
    let acc = 0;
    const cumulative = hourly.map((v) => (acc += v));
    out[key] = { total, hourly, cumulative };
  }
  return out;
}

// Per-day totals for a list of days: { [dateISO]: { [key]: n } }.
export function ledgerCountsForDays(ledger, days, keys) {
  const out = {};
  for (const date of days) {
    const series = ledgerSeriesForDay(ledger, date, keys);
    out[date] = {};
    for (const key of keys) out[date][key] = series[key].total;
  }
  return out;
}

// True when the suite was live-polling during that calendar day — counts for
// unwatched days are the residual open tasks only (an undercount).
export function ledgerDayWatched(ledger, dateISO) {
  return !!(ledger && ledger.days && ledger.days[dateISO] && ledger.days[dateISO].watched);
}

// ── Same-weekday baselines (Gauntlet B3 / dream-panel D3) ─────────────────────
// "Is today busy, or does it just feel busy?" — today's demand compared with
// the same weekday's history from the day ledger, cumulative TO THE SAME HOUR
// (a half-day today must never be compared against past full days).
//
// Honesty rules, in order of importance:
//   1. Watched days only — unwatched days are known undercounts (residual
//      open tasks), and using them would bias the baseline low, making every
//      ordinary day read "busier than usual".
//   2. No baseline under BASELINE_MIN_SAMPLES watched same-weekdays — the
//      renderer shows nothing (or an explicit building state), never a
//      comparison invented from two points.
//   3. Plain-English counts, not percentiles — "ahead of 7 of the last 9
//      Tuesdays", which a reader can check by hand from the compare view.

export const BASELINE_MIN_SAMPLES = 4;

export function weekdayName(dateISO) {
  const t = Date.parse(`${dateISO}T12:00:00`);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'long' });
}

// Demand total across `keys` cumulative to `hour` (0–23) for one ledger day.
function _cumToHour(ledger, dateISO, hour, keys) {
  const h = Math.max(0, Math.min(23, hour));
  const s = ledgerSeriesForDay(ledger, dateISO, keys);
  let sum = 0;
  for (const k of keys) sum += s[k].cumulative[h];
  return sum;
}

// Historical samples: every WATCHED prior same-weekday within retention.
export function sameWeekdayCumulativeSamples(ledger, todayISO, hour, keys) {
  const out = [];
  for (let back = 7; back <= SUB_LEDGER_RETAIN_DAYS; back += 7) {
    const date = _isoAddDays(todayISO, -back);
    if (!ledgerDayWatched(ledger, date)) continue;
    out.push({ date, value: _cumToHour(ledger, date, hour, keys) });
  }
  return out;
}

// Baseline read for `todayISO`'s demand at `hour`, against its own weekday.
// Returns null when history is insufficient; else
// { todayValue, n, higher, lower, band: 'high'|'typical'|'low', weekday }.
export function demandBaseline(ledger, todayISO, hour, keys) {
  if (!ledger) return null;
  const samples = sameWeekdayCumulativeSamples(ledger, todayISO, hour, keys);
  if (samples.length < BASELINE_MIN_SAMPLES) return null;
  const todayValue = _cumToHour(ledger, todayISO, hour, keys);
  let higher = 0;
  let lower = 0;
  for (const s of samples) {
    if (todayValue > s.value) higher++;
    else if (todayValue < s.value) lower++;
  }
  const n = samples.length;
  const band = higher >= n * 0.75 ? 'high' : lower >= n * 0.75 ? 'low' : 'typical';
  return { todayValue, n, higher, lower, band, weekday: weekdayName(todayISO) };
}

// Plain-English one-liner for a baseline read. `live` = the day is still in
// progress ("by this time"); false = comparing complete days.
export function baselineLine(b, live = true) {
  if (!b) return '';
  const tail = live ? ' by this time' : '';
  if (b.band === 'high') return `Busier than usual for a ${b.weekday} — ahead of ${b.higher} of the last ${b.n}${tail}`;
  if (b.band === 'low') return `Quieter than usual for a ${b.weekday} — behind ${b.lower} of the last ${b.n}${tail}`;
  return `Typical for a ${b.weekday} (mid-range of the last ${b.n})`;
}
