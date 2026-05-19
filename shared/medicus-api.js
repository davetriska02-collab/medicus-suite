// Medicus Suite — shared API helper
// Used by Slot Counter and Capacity Forecast.
// Provides fetch, caching, and a concurrency-limited multi-day fetcher.

'use strict';

const _cache = new Map(); // dateISO -> { data, fetchedAt }
const CACHE_TTL_MS = 5 * 60 * 1000;

function apiBase(siteId) {
  return `https://${siteId}.api.england.medicus.health`;
}

export async function fetchSchedulingOverview(siteId, dateISO, { bypassCache = false } = {}) {
  if (!siteId) throw new Error('Practice code not set');
  const cached = _cache.get(dateISO);
  if (!bypassCache && cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${apiBase(siteId)}/scheduling/data/appointment-book/embedded-overview?date=${dateISO}&filterByUsualLocation=false`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('Not signed in to Medicus');
    throw new Error(`API error ${r.status}`);
  }
  const data = await r.json();
  _cache.set(dateISO, { data, fetchedAt: Date.now() });
  return data;
}

export function invalidateCache(dateISO) {
  if (dateISO) _cache.delete(dateISO);
  else _cache.clear();
}

// Get the latest appointmentTypeOptions for the multi-select preset editor
export async function fetchAppointmentTypes(siteId) {
  const today = todayISO();
  const data = await fetchSchedulingOverview(siteId, today).catch(() => null);
  if (!data) return [];
  return (data.appointmentTypeOptions || [])
    .map(t => ({ id: t.value, name: t.label }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Aggregate raw data into slot counts by type, filtering by an optional time cutoff and type whitelist
export function aggregateSlots(raw, { allowedTypes = null, filterPastTimes = false } = {}) {
  const byType = {};
  const byStaff = [];
  let total = 0;
  let sessionsCount = 0;
  const now = filterPastTimes ? new Date() : null;

  (raw?.staffSchedules || []).forEach(staff => {
    let staffTotal = 0;
    const staffByType = {};
    let staffHasSessions = false;

    (staff.schedule || []).forEach(session => {
      if (!session.summary?.status?.isCancelled) {
        sessionsCount++;
        staffHasSessions = true;
      }
      (session.entries || []).forEach(entry => {
        if (entry.diaryEntryType?.value !== 'slot') return;

        const type = entry.appointmentType?.name || 'Unknown';
        if (allowedTypes && !allowedTypes.includes(type)) return;

        if (now && entry.startDateTime) {
          if (new Date(entry.startDateTime) < now) return;
        }

        byType[type] = (byType[type] || 0) + 1;
        staffByType[type] = (staffByType[type] || 0) + 1;
        staffTotal++;
        total++;
      });
    });

    if (staffHasSessions) {
      byStaff.push({ name: staff.name || 'Unknown', total: staffTotal, byType: staffByType });
    }
  });

  byStaff.sort((a, b) => a.name.localeCompare(b.name));
  return { total, byType, byStaff, sessionsCount };
}

// Parallel fetch a list of dates with concurrency limit
export async function fetchManyDates(siteId, dates, { concurrency = 5, onProgress } = {}) {
  const results = {};
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < dates.length) {
      const i = cursor++;
      const date = dates[i];
      try {
        results[date] = await fetchSchedulingOverview(siteId, date);
      } catch (e) {
        results[date] = { error: e.message };
      }
      done++;
      if (onProgress) onProgress(done, dates.length, date, results[date]);
    }
  }

  await Promise.all(Array(Math.min(concurrency, dates.length)).fill(0).map(worker));
  return results;
}

// Status computation given a daily count, minimum, and threshold percentages
export function computeStatus(count, minimum, thresholds = { tight: 75, low: 50 }) {
  if (count >= minimum) return 'sufficient';
  const pct = minimum > 0 ? (count / minimum) * 100 : 100;
  if (pct >= thresholds.tight) return 'tight';
  if (pct >= thresholds.low)   return 'low';
  return 'critical';
}

// ── Date utilities ────────────────────────────────────────────────────────────

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nextWorkingDayISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n) { return String(n).padStart(2, '0'); }

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfWeek(iso) {
  const d = new Date(iso + 'T12:00:00');
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // Monday = 0
  d.setDate(d.getDate() - dow);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfMonth(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
}

export function daysInMonth(iso) {
  const d = new Date(iso + 'T12:00:00');
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function formatDateShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

export function formatDateLong(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function isWeekend(iso) {
  const dow = new Date(iso + 'T12:00:00').getDay();
  return dow === 0 || dow === 6;
}

export function isPast(iso) {
  return iso < todayISO();
}
