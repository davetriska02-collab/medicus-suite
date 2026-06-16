// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Practice Report — data layer.
//
// Builds the dataset behind the Practice Report (Today / 7d / 30d / custom) from
// the Medicus endpoints that genuinely accept a historical date range:
//   - demand (submissions)  — tasks/.../task-list?createdAt_startDate&createdAt_endDate
//   - activity (per HCP)     — reporting/data/activity/report?startDate&endDate
//   - capacity (slots)       — scheduling/.../embedded-overview?date= per day
//   - referrals              — referrals/clinical-audit-report?referralStartDate&endDate
//
// Live-only signals (waiting-room depth, request-monitor task age, the PPI) have NO
// per-day history at the source, so the report shows them as a "current snapshot" and,
// for trends, reads the forward-accruing daily store (practice.reportSnapshots) that
// Condor writes once a day. We DO NOT approximate or fabricate a metric we cannot
// derive — we simply omit it (see docs/plans/PRACTICE-REPORT-PLAN.md §4).
//
// The pure helpers (resolveRange, iterateDates, bucketDemandByDay, summariseSeries,
// comparePct, pruneSnapshots) carry no I/O and are unit-tested in
// test-practice-report-data.js. The fetch orchestration calls the shared APIs.

'use strict';

import { fetchManyDates, aggregateSlots } from '../../../../shared/medicus-api.js';

export const DEMAND_KEYS = ['medical', 'admin', 'investigation', 'rxRoutine', 'rxNonRoutine'];

export const DEMAND_TASK_TYPES = [
  { key: 'medical', apiType: 'medical_patient_request_task' },
  { key: 'admin', apiType: 'admin_patient_request_task' },
  { key: 'investigation', apiType: 'review_investigation_results_task' },
  { key: 'rxRoutine', apiType: 'prescription_request_task_routine' },
  { key: 'rxNonRoutine', apiType: 'prescription_request_task_non_routine' },
];

// ── Pure helpers (no I/O — unit tested) ──────────────────────────────────────

// Local calendar date YYYY-MM-DD (NOT UTC — toISOString would roll the day in the
// early/late hours and bucket tasks into the wrong day).
export function localISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Resolve a report period to { start, end, days, label, preset }.
// presets: 'today' | '7d' | '30d' | 'custom'. `opts.today` lets tests pin "now".
export function resolveRange(preset, opts = {}) {
  const todayStr = opts.today || localISO();
  const minus = (iso, n) => {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - n);
    return localISO(dt);
  };
  switch (preset) {
    case 'today':
      return { preset, start: todayStr, end: todayStr, days: 1, label: 'Today' };
    case '7d':
      return { preset, start: minus(todayStr, 6), end: todayStr, days: 7, label: 'Last 7 days' };
    case '30d':
      return { preset, start: minus(todayStr, 29), end: todayStr, days: 30, label: 'Last 30 days' };
    case 'custom': {
      const start = opts.start || todayStr;
      const end = opts.end || todayStr;
      return { preset, start, end, days: daySpan(start, end), label: `${start} to ${end}` };
    }
    default:
      return resolveRange('today', opts);
  }
}

// Inclusive day count between two YYYY-MM-DD strings (min 1).
export function daySpan(startISO, endISO) {
  const a = new Date(`${startISO}T00:00:00`);
  const b = new Date(`${endISO}T00:00:00`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// Inclusive list of YYYY-MM-DD dates from start to end (capped to avoid runaway).
export function iterateDates(startISO, endISO, cap = 92) {
  const out = [];
  const [y, m, d] = startISO.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  const endStr = endISO;
  while (out.length < cap) {
    const iso = localISO(cur);
    out.push(iso);
    if (iso >= endStr) break;
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// The previous comparison window of equal length immediately before [start,end].
export function previousRange(startISO, endISO) {
  const days = daySpan(startISO, endISO);
  const [y, m, d] = startISO.split('-').map(Number);
  const prevEnd = new Date(y, m - 1, d);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - (days - 1));
  return { start: localISO(prevStart), end: localISO(prevEnd), days };
}

// Bucket demand tasks (each { type, createdAt }) into one row per day across the
// inclusive range. Tasks outside the range or with an unknown type are ignored.
export function bucketDemandByDay(tasks, startISO, endISO) {
  const dates = iterateDates(startISO, endISO);
  const rows = new Map(
    dates.map((date) => [date, { date, medical: 0, admin: 0, investigation: 0, rxRoutine: 0, rxNonRoutine: 0, all: 0 }])
  );
  for (const t of tasks || []) {
    if (!t || !t.createdAt) continue;
    const date = localISO(new Date(t.createdAt));
    const row = rows.get(date);
    if (!row) continue;
    const key = t.type;
    if (!DEMAND_KEYS.includes(key)) continue;
    row[key]++;
    row.all++;
  }
  return [...rows.values()];
}

// Totals + daily mean + peak day for a per-day series over the given keys.
export function summariseSeries(byDay, keys = DEMAND_KEYS) {
  const totals = { all: 0 };
  keys.forEach((k) => (totals[k] = 0));
  let peak = null;
  for (const row of byDay || []) {
    let rowAll = 0;
    keys.forEach((k) => {
      const v = Number(row[k]) || 0;
      totals[k] += v;
      rowAll += v;
    });
    totals.all += rowAll;
    if (!peak || rowAll > peak.value) peak = { date: row.date, value: rowAll };
  }
  const days = (byDay || []).length || 1;
  return { totals, dailyMean: Math.round((totals.all / days) * 10) / 10, peak, days };
}

// Percentage change current vs previous, with a safe direction label.
export function comparePct(current, previous) {
  const cur = Number(current) || 0;
  const prev = Number(previous) || 0;
  if (prev === 0) {
    if (cur === 0) return { pct: 0, direction: 'flat' };
    return { pct: null, direction: 'up' }; // up from zero — percentage undefined
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { pct, direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
}

// Keep only snapshots within the last `keepDays`, de-duplicated by date (latest wins),
// sorted ascending by date. Used both on write (prune) and read (window).
export function pruneSnapshots(snapshots, keepDays = 90, today = localISO()) {
  const byDate = new Map();
  for (const s of snapshots || []) {
    if (s && s.date) byDate.set(s.date, s);
  }
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - (keepDays - 1));
  const cutoffISO = localISO(cutoff);
  return [...byDate.values()]
    .filter((s) => s.date >= cutoffISO)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ── Snapshot store (forward-accruing history for the live-only metrics) ───────

const SNAPSHOT_KEY = 'practice.reportSnapshots';
const SNAPSHOT_KEEP_DAYS = 90;

// Build today's snapshot row from a live Condor streams object + computed PPI.
// Only includes fields we can actually read; nothing is invented.
export function buildSnapshotRow(live, ppi, today = localISO()) {
  const row = { date: today, capturedAt: new Date().toISOString() };
  if (ppi && typeof ppi.ppi === 'number') {
    row.ppi = ppi.ppi;
    row.band = ppi.band || null;
    // Capture the band-floor so the report can explain a low index showing AMBER
    // (over capacity floors GREEN→AMBER); otherwise "25/100 AMBER" reads as a bug.
    if (ppi.floored) row.bandFloored = true;
    if (ppi.overCapacity) row.overCapacity = true;
  }
  if (live?.submissions?.totals) row.demand = live.submissions.totals.all ?? null;
  if (live?.slots) row.slotsRemaining = live.slots.totalRemaining ?? null;
  if (live?.waitingRoom) row.waitingArrived = live.waitingRoom.arrivedCount ?? null;
  if (live?.requestMonitor && !live.requestMonitor.unavailable) {
    row.urgent = live.requestMonitor.urgentCount ?? null;
    row.tasksGt8h = live.requestMonitor.byAgeBucket?.gt8h ?? null;
  }
  return row;
}

export async function loadSnapshots() {
  try {
    const r = await chrome.storage.local.get(SNAPSHOT_KEY);
    return pruneSnapshots(r[SNAPSHOT_KEY] || [], SNAPSHOT_KEEP_DAYS);
  } catch {
    return [];
  }
}

// Persist today's snapshot (one per day; re-running replaces today's row).
export async function saveSnapshot(row) {
  if (!row || !row.date) return;
  const existing = await loadSnapshots();
  const merged = pruneSnapshots([...existing, row], SNAPSHOT_KEEP_DAYS, row.date);
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: merged });
}

// ── Fetch orchestration (I/O — relies on shared APIs + credentialed fetch) ────

function apiBase(siteId) {
  return `https://${siteId}.api.england.medicus.health`;
}

// Demand over a date range, bucketed per day. One ranged request per task type.
export async function fetchDemandRange(siteId, startISO, endISO, { fetchImpl = fetch } = {}) {
  const base = apiBase(siteId);
  const settled = await Promise.allSettled(
    DEMAND_TASK_TYPES.map(async (tt) => {
      const url = `${base}/tasks/data/${tt.apiType}/task-list?createdAt_startDate=${startISO}&createdAt_endDate=${endISO}`;
      const r = await fetchImpl(url, { credentials: 'include' });
      if (!r.ok) throw new Error(`${tt.key} HTTP ${r.status}`);
      const d = await r.json();
      return (d.tasks || []).map((t) => ({ type: tt.key, createdAt: t.createdAt }));
    })
  );
  const tasks = [];
  const errors = [];
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') tasks.push(...res.value);
    else errors.push(`demand ${DEMAND_TASK_TYPES[i].key}: ${res.reason?.message || res.reason}`);
  });
  return { byDay: bucketDemandByDay(tasks, startISO, endISO), errors };
}

// Capacity (scheduled slots) per day across the range. Counts ALL slots scheduled
// that day (filterPastTimes:false) — historical "remaining" is not meaningful.
export async function fetchCapacityRange(siteId, startISO, endISO, { hiddenTypes = null } = {}) {
  const dates = iterateDates(startISO, endISO);
  const raw = await fetchManyDates(siteId, dates, { concurrency: 5 });
  const allowed = hiddenTypes ? null : null; // hidden-type filtering handled by caller if needed
  const byDay = dates.map((date) => {
    const dayRaw = raw[date];
    if (!dayRaw || dayRaw.error) return { date, slots: null, sessions: null, error: dayRaw?.error || 'no data' };
    const agg = aggregateSlots(dayRaw, { allowedTypes: allowed, filterPastTimes: false });
    return { date, slots: agg.total, sessions: agg.sessionsCount, byType: agg.byType };
  });
  return { byDay };
}

// Activity (per-HCP work done) over the range — delegates to window.ActivityApi.
export async function fetchActivityRange(siteId, startISO, endISO) {
  const ActivityApi = typeof window !== 'undefined' ? window.ActivityApi : null;
  if (!ActivityApi) return null;
  const raw = await ActivityApi.fetchActivityReport(siteId, startISO, endISO, {
    fetch: (url, init) =>
      typeof window !== 'undefined' && window.ApiDiag
        ? window.ApiDiag.fetch({ module: 'practice-report', url, code: siteId, init })
        : fetch(url, init),
  });
  const rowData = Array.isArray(raw) ? raw : raw?.rowData || raw?.users || [];
  return ActivityApi.aggregate(rowData);
}

// Referrals breakdown over the range — delegates to window.ReferralsApi.
export async function fetchReferralsRange(siteId, startISO, endISO) {
  const ReferralsApi = typeof window !== 'undefined' ? window.ReferralsApi : null;
  if (!ReferralsApi) return null;

  // Step 1: read the stored template URL from previous discovery.
  const d = await chrome.storage.local.get('referrals.discovery');
  let templateUrl = d['referrals.discovery']?.url || null;

  // Step 2: if no stored template, attempt headless discovery now.
  if (!templateUrl) {
    templateUrl = await (typeof window !== 'undefined' &&
    window.ReferralsApi &&
    window.ReferralsApi.ensureReferralsDiscovery
      ? window.ReferralsApi.ensureReferralsDiscovery(siteId).catch(() => null)
      : Promise.resolve(null));
  }

  // Step 3: if still no template URL, return null (report omits/notes the section).
  if (!templateUrl) return null;

  const apiFetch = (url, init) =>
    typeof window !== 'undefined' && window.ApiDiag
      ? window.ApiDiag.fetch({ module: 'practice-report', url, code: siteId, init })
      : fetch(url, init);

  const referrals = await ReferralsApi.fetchReferrals(siteId, startISO, endISO, {
    fetch: apiFetch,
    templateUrl,
  });
  const rows = Array.isArray(referrals) ? referrals : referrals?.referrals || [];
  return ReferralsApi.aggregate ? ReferralsApi.aggregate(rows) : null;
}

// Top-level orchestrator: assemble the full report dataset for a resolved range.
// `live` is the current Condor streams object (from fetchAllStreams); `ppi` its
// computed index. Both are optional (used for the "current snapshot" block + trends).
export async function buildReport({ siteId, range, live = null, ppi = null } = {}) {
  if (!siteId) throw new Error('No practice code configured');
  const errors = [];
  const [demandRes, capacityRes, activityRes, referralsRes, snapshots] = await Promise.allSettled([
    fetchDemandRange(siteId, range.start, range.end),
    fetchCapacityRange(siteId, range.start, range.end),
    fetchActivityRange(siteId, range.start, range.end),
    fetchReferralsRange(siteId, range.start, range.end),
    loadSnapshots(),
  ]);

  const pick = (res, label) => {
    if (res.status === 'fulfilled') return res.value;
    errors.push(`${label}: ${res.reason?.message || res.reason}`);
    return null;
  };

  const demand = pick(demandRes, 'demand');
  if (demand?.errors?.length) errors.push(...demand.errors);

  const allSnapshots = snapshots.status === 'fulfilled' ? snapshots.value : [];
  const rangeSnapshots = allSnapshots.filter((s) => s.date >= range.start && s.date <= range.end);

  return {
    siteId,
    range,
    generatedAt: new Date().toISOString(),
    demand: demand ? { byDay: demand.byDay, summary: summariseSeries(demand.byDay) } : null,
    capacity: pick(capacityRes, 'capacity'),
    activity: pick(activityRes, 'activity'),
    referrals: pick(referralsRes, 'referrals'),
    currentSnapshot: live ? buildSnapshotRow(live, ppi) : null,
    snapshotHistory: rangeSnapshots,
    errors,
  };
}
