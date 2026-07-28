// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — booking core (shared appointment-booking endpoints).
//
// Phase D1 of docs/plans/RECEPTION-FEEDBACK-2026-07-28.md ("no third copy"):
// the six /scheduling/* endpoint functions used to live in
// side-panel/modules/slots/booking-api.js, and a divergent hand-copy of the
// same flow lives in content-scripts/booking-inline.js. This file is the ONE
// copy; booking-api.js is now a thin re-export shim (plus the slots-only tab /
// patient detection), and booking-inline.js adopts it in a later phase.
//
// Endpoint paths and payload field names in here are byte-for-byte what the
// live Medicus API expects — do not "tidy" them. Tests pin them.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//
//   1. THE CORE NEVER SELF-DETECTS THE PATIENT (plan D1.2). Two identity
//      sources exist in the suite today and can legitimately disagree —
//      reception resolves the *active* tab, booking-api resolves the *first
//      matching* Medicus tab, active or not. A core that resolved identity
//      itself would let a caller book the patient from tab 2 while showing
//      the patient from tab 1, and a commit-time re-verify against that same
//      wrong source would happily pass. So: no tab detection is exported from
//      here, and `createAppointment` REFUSES to fire without an explicit,
//      truthy `patientId` supplied by the caller (H-043).
//
//   2. WINDOW-SEARCH CAPS LIVE HERE, NOT IN THE UI (plan D1.4) — the UI is the
//      thing that gets copy-pasted. `findSlotsInWindow` hard-caps the window at
//      28 days and the fan-out at 4 concurrent requests, and aborts the rest of
//      the queue on the first 429/5xx. Eight front desks × 28 credentialed
//      calls each is a self-inflicted DoS on the practice scheduler.
//
// The /scheduling/* endpoints live on the API subdomain
// ({siteId}.api.england.medicus.health) — NOT the page host, which serves the
// SPA HTML shell for /scheduling/* (the original source of the "Unexpected
// token '<'" JSON errors). Callers pass that host in as `apiBase`.
//
// Dual-mode export (same doctrine as shared/appointments-feed.js): ES exports
// for the side-panel modules, plus `window.BookingCore` for classic-script
// contexts, guarded so Node/worker imports don't throw.

// ── Date helpers ──────────────────────────────────────────────────────────────
// Deliberately local copies of shared/medicus-api.js's `pad`/`addDays`/
// `isWeekend` (identical semantics — midday anchor, so DST never shifts a date)
// rather than an import: this file must stay dependency-free so a classic
// content script can pick it up verbatim when booking-inline.js adopts it.

function pad(n) {
  return String(n).padStart(2, '0');
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isWeekend(iso) {
  const dow = new Date(iso + 'T12:00:00').getDay();
  return dow === 0 || dow === 6;
}

// ── Caps (plan D1.4 — frozen here, never in a UI) ─────────────────────────────

export const MAX_WINDOW_DAYS = 28; // 4 weeks, the widest date-mode chip
export const MAX_CONCURRENCY = 4; // parallel credentialed calls per search

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// ── Transport ─────────────────────────────────────────────────────────────────

// Direct credentialed fetch against the scheduling API subdomain. Reads the
// body as text first so a stray HTML response yields a clear message rather
// than a cryptic JSON-parse error.
//
// `opts.keepalive` lets a fire-and-forget POST survive page/panel teardown —
// used by the reservation-release path (see releaseReservation).
async function apiFetch(url, opts) {
  opts = opts || {};
  const resp = await fetch(url, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
    body: opts.body,
    keepalive: !!opts.keepalive,
  });
  if (!resp.ok) {
    // Message text is unchanged from the pre-extraction booking-api.js (call
    // sites surface `err.message` verbatim); `.status` is added so callers can
    // branch on 429/5xx without regex-scraping the message.
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Scheduling API returned an unexpected response.');
  }
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

export async function fetchAppointmentFinder(apiBase) {
  return apiFetch(`${apiBase}/scheduling/data/appointment-service/available-appointment-finder`);
}

export async function fetchAvailableSlots(apiBase, { providerId, appointmentTypeId, date }) {
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const minDateTime =
    date === todayYmd ? `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:00` : `${date} 00:00:00`;
  const qs = new URLSearchParams({
    providerId,
    providerIsLocalOrganisation: 'true',
    minDateTime,
    'localOrganisationFilters[appointmentTypeId]': appointmentTypeId,
  });
  const data = await apiFetch(
    `${apiBase}/scheduling/data/appointment-service/available-appointment-places-between-range?${qs}`
  );
  const slots = [];
  for (const diary of data.availablePlaces?.[date]?.diaries || []) {
    for (const entry of diary.entries || []) {
      if (entry.diaryEntryType?.isSlot) slots.push(entry);
    }
  }
  return slots;
}

export async function reserveSlot(apiBase, { diaryId, startDateTime, duration, appointmentTypeId }) {
  return apiFetch(`${apiBase}/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      diaryId,
      intendedStartDateTime: startDateTime,
      intendedDuration: duration,
      allowMatchingSlotsFromOtherDiaries: true,
      substituteSlotFilters: {
        staffIds: [],
        siteIds: [],
        appointmentTypeId,
        preferredStaffGenders: null,
        jobRoleIds: [],
        preferredLanguages: [],
      },
    }),
  });
}

export async function fetchCreateForm(apiBase, { slotReservationId, patientId }) {
  const qs = new URLSearchParams({
    context: 'create-booked-appointment',
    appointmentTemporalType: 'timed',
    slotReservationId,
    patientId,
  });
  return apiFetch(`${apiBase}/scheduling/data/appointment/create-appointment?${qs}`);
}

// The suite's clinical WRITE. `payload.patientId` must be supplied EXPLICITLY
// by the caller — the core will not resolve, infer or default it (plan D1.2,
// H-043). A falsy patientId throws BEFORE any network call, so a caller whose
// identity resolution silently returned null cannot book against an ambient
// record.
export async function createAppointment(apiBase, payload) {
  if (!payload || !payload.patientId) {
    throw new Error('booking-core: explicit patientId required');
  }
  return apiFetch(`${apiBase}/scheduling/appointment/create-appointment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Fire-and-forget: a failed release is not worth surfacing (the backend TTL
// eventually frees the slot), but a DROPPED release is — hence `keepalive`,
// which lets the POST complete past panel close / page teardown. Without it the
// slots module's cleanup() release was being cancelled on panel close, leaving
// slots locked for other bookers (plan D1.3).
export async function releaseReservation(apiBase, slotReservationId) {
  if (!apiBase || !slotReservationId) return;
  try {
    await apiFetch(
      `${apiBase}/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotReservationId }),
        keepalive: true,
      }
    );
  } catch (_) {}
}

// ── Window search (plan D1.4 / D2) ────────────────────────────────────────────

// TODO(D2 spike): confirm whether available-appointment-places-between-range
// accepts an end-date param — if so this collapses to one call.

function backoffStatusOf(err) {
  if (!err) return 0;
  if (Number.isFinite(err.status)) return err.status;
  const m = /HTTP (\d{3})/.exec(String(err.message || ''));
  return m ? Number(m[1]) : 0;
}

function isBackoffStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Fan `fetchAvailableSlots` out across a date window.
 *
 * Caps are NOT negotiable by the caller: the window is clamped to
 * MAX_WINDOW_DAYS consecutive calendar dates and the fan-out to
 * MAX_CONCURRENCY in-flight requests.
 *
 * @param {string} apiBase
 * @param {object} opts
 * @param {string} opts.appointmentTypeId
 * @param {string} opts.providerId
 * @param {string} opts.fromDate            first date of the window, YYYY-MM-DD
 * @param {number} [opts.days=7]            consecutive CALENDAR days to span (clamped 1…28)
 * @param {boolean} [opts.skipWeekends=true] drop Sat/Sun from the window (they are still counted in `days`)
 * @param {number} [opts.limit=30]          stop fetching once this many slots are collected
 * @param {number} [opts.concurrency=4]     in-flight requests (clamped 1…4)
 * @param {Function} [opts.fetchImpl]       slot fetcher (apiBase, {providerId, appointmentTypeId, date}) → slots[]
 * @returns {Promise<{slots: object[], byDay: Object<string, object[]>, aborted: boolean, error: (Error|null)}>}
 *   `slots` — every collected slot, sorted by startDateTime ascending, capped at `limit`.
 *   `byDay` — raw per-day grouping of everything actually fetched (uncapped; a
 *             fetched date with no slots is present as an empty array), so a UI
 *             can distinguish "no slots that day" from "never looked".
 *   `aborted` — true when the queue was cut short by a 429/5xx.
 *   `error` — the first error encountered, or null.
 */
export async function findSlotsInWindow(apiBase, opts = {}) {
  const {
    appointmentTypeId,
    providerId,
    fromDate,
    days = 7,
    skipWeekends = true,
    limit = 30,
    concurrency = MAX_CONCURRENCY,
    fetchImpl,
  } = opts;

  if (typeof fromDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new Error('booking-core: findSlotsInWindow requires fromDate as YYYY-MM-DD');
  }

  const span = clampInt(days, 1, MAX_WINDOW_DAYS, MAX_WINDOW_DAYS);
  const pool = clampInt(concurrency, 1, MAX_CONCURRENCY, MAX_CONCURRENCY);
  const cap = clampInt(limit, 1, Number.MAX_SAFE_INTEGER, 30);
  const fetcher = typeof fetchImpl === 'function' ? fetchImpl : fetchAvailableSlots;

  // `days` spans consecutive CALENDAR days; weekends are removed from that span
  // rather than extending it, so "4 weeks" is always 4 weeks of wall-clock.
  const dates = [];
  for (let i = 0; i < span; i++) {
    const d = i === 0 ? fromDate : addDays(fromDate, i);
    if (skipWeekends && isWeekend(d)) continue;
    dates.push(d);
  }

  const byDay = {};
  let aborted = false;
  let error = null;
  let cursor = 0;
  let collected = 0;

  async function worker() {
    for (;;) {
      if (aborted || collected >= cap) return;
      const i = cursor++;
      if (i >= dates.length) return;
      const date = dates[i];
      try {
        const daySlots = (await fetcher(apiBase, { providerId, appointmentTypeId, date })) || [];
        byDay[date] = daySlots;
        collected += daySlots.length;
      } catch (err) {
        if (!error) error = err;
        // Rate limiting / server trouble: stop hammering the practice's
        // scheduler immediately and hand back whatever we already have.
        if (isBackoffStatus(backoffStatusOf(err))) {
          aborted = true;
          return;
        }
        // Any other single-day failure (404, malformed payload, …) is not a
        // reason to abandon the other 27 days — skip the day and carry on.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(pool, dates.length) }, () => worker()));

  const slots = [];
  for (const date of Object.keys(byDay).sort()) slots.push(...byDay[date]);
  slots.sort((a, b) => String(a?.startDateTime || '').localeCompare(String(b?.startDateTime || '')));

  return { slots: slots.slice(0, cap), byDay, aborted, error };
}

// ── Dual-mode export ──────────────────────────────────────────────────────────
// ES exports above for the side-panel modules; the same surface on
// `window.BookingCore` so a classic script (booking-inline.js, later phase) can
// use it without a bundler. Guarded — Node imports this file in the test suite,
// where there is no `window`.

const BookingCore = {
  MAX_WINDOW_DAYS,
  MAX_CONCURRENCY,
  fetchAppointmentFinder,
  fetchAvailableSlots,
  reserveSlot,
  fetchCreateForm,
  createAppointment,
  releaseReservation,
  findSlotsInWindow,
};

export default BookingCore;

if (typeof window !== 'undefined') {
  window.BookingCore = BookingCore;
}
