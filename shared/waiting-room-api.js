// Medicus Suite — Waiting Room API
// Fetches arrived patients from the my-appointments scheduling endpoint.
// Callable from any extension context (popup, side panel) with credentials:include
// because host_permissions covers *.api.england.medicus.health.

'use strict';

const _cache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 30 * 1000; // 30s — short TTL because status changes matter

export async function fetchArrivedPatients(siteId, { bypassCache = false } = {}) {
  if (!bypassCache && _cache.data && (Date.now() - _cache.fetchedAt) < CACHE_TTL_MS) {
    return _cache.data;
  }

  const url = `https://${siteId}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('Not signed in to Medicus');
    throw new Error(`API error ${r.status}`);
  }
  const raw = await r.json();

  // Flatten all diary entries and filter for arrived
  const entries = (raw?.schedule?.schedule ?? [])
    .flatMap(diary => diary.entries ?? [])
    .filter(e => e?.displayStatus?.isArrived === true);

  const patients = entries.map(e => ({
    name:           e.patient?.name ?? 'Unknown',
    start:          e.start ?? '',
    startDateTime:  e.startDateTime ?? null,
    reason:         e.compiledReasonForAppointment ?? '',
    deliveryMode:   e.deliveryMode?.value ?? '',
    minutesWaiting: calcMinutesWaiting(e.startDateTime),
  }));

  // Sort by appointment time (earliest first)
  patients.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  _cache.data = patients;
  _cache.fetchedAt = Date.now();
  return patients;
}

export function invalidateWaitingCache() {
  _cache.data = null;
  _cache.fetchedAt = 0;
}

function calcMinutesWaiting(startDateTime) {
  if (!startDateTime) return null;
  const apptMs = new Date(startDateTime).getTime();
  if (isNaN(apptMs)) return null;
  const mins = Math.round((Date.now() - apptMs) / 60000);
  return mins > 0 ? mins : 0;
}
