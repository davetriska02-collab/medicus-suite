// Medicus Suite — booking core tests (plan D1, RECEPTION-FEEDBACK-2026-07-28)
// Run with: node test-booking-core.js
//
// shared/booking-core.js is the ONE copy of the suite's appointment-booking
// write path (previously inlined in side-panel/modules/slots/booking-api.js,
// with a divergent hand-copy still living in content-scripts/booking-inline.js).
// This is that path's first CI coverage. What is pinned here, and why:
//
//   • Endpoint paths and the create payload's field names — the live Medicus
//     API depends on them byte-for-byte; a "tidy-up" that renames one is a
//     silent booking failure, or worse a booking with a dropped field.
//   • createAppointment refuses to fire without an explicit patientId
//     (plan D1.2 / hazard H-043) — the core must never book against an
//     identity it inferred for itself.
//   • releaseReservation sends keepalive:true (plan D1.3) — without it the
//     panel-close release is cancelled by teardown and the slot stays locked
//     for every other booker until the backend TTL expires.
//   • findSlotsInWindow's caps (plan D1.4): ≤28 days, ≤4 concurrent requests,
//     abort the queue on the first 429/5xx, stop early at `limit`. Eight front
//     desks × 28 credentialed calls is a self-inflicted DoS on the practice
//     scheduler, so the caps live in the core and are asserted here rather
//     than trusted to whichever UI copies the flow next.
//   • booking-api.js really is a re-export shim — same function identities, so
//     slots.js cannot be silently talking to a second implementation.
//
// ES modules, loaded via dynamic import() from this CommonJS script (the
// test-api-clients.js pattern).

'use strict';

// A fixture day that is ALWAYS in the future — the original hard-coded
// '2026-08-03' rotted the day the calendar reached it (booking-core clamps
// today's minDateTime to now, not midnight), turning CI red on 2026-08-03.
const FUTURE_DAY = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

async function expectReject(fn, msgFragment, label) {
  try {
    await fn();
    check(false, `${label} — expected rejection but resolved`);
  } catch (e) {
    check(
      typeof e.message === 'string' && e.message.includes(msgFragment),
      `${label} — rejects with "${msgFragment}" (got: "${e.message}")`
    );
  }
}

const modUrl = (rel) => new URL(rel, `file://${process.cwd()}/`).href;

// Minimal Response stand-in — the core reads .ok/.status then .text().
function mockResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})),
  };
}

// Records every fetch call; returns `payload` for all of them.
function recordingFetch(payload, status = 200) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return mockResponse(status, payload);
  };
  fn.calls = calls;
  return fn;
}

const API = 'https://ab12cd.api.england.medicus.health';

(async () => {
  const core = await import(modUrl('shared/booking-core.js'));
  check(typeof core.createAppointment === 'function', 'shared/booking-core.js imports as an ES module');

  const origFetch = globalThis.fetch;
  const setFetch = (fn) => {
    globalThis.fetch = fn;
  };
  const restoreFetch = () => {
    globalThis.fetch = origFetch;
  };

  // ==========================================================================
  // 1 — endpoint paths (byte-preserved from the pre-extraction booking-api.js)
  // ==========================================================================
  console.log('\n=== 1. Endpoint paths ===');

  {
    const f = recordingFetch({ localOrganisationDetails: { id: 'prov-1', services: [] } });
    setFetch(f);
    await core.fetchAppointmentFinder(API);
    check(
      f.calls[0].url === `${API}/scheduling/data/appointment-service/available-appointment-finder`,
      'fetchAppointmentFinder → /scheduling/data/appointment-service/available-appointment-finder'
    );
    restoreFetch();
  }

  {
    const f = recordingFetch({
      availablePlaces: {
        [FUTURE_DAY]: {
          diaries: [
            {
              entries: [
                { diaryEntryType: { isSlot: true }, startDateTime: `${FUTURE_DAY} 09:00:00` },
                { diaryEntryType: { isSlot: false }, startDateTime: `${FUTURE_DAY} 09:30:00` },
              ],
            },
          ],
        },
      },
    });
    setFetch(f);
    const slots = await core.fetchAvailableSlots(API, {
      providerId: 'prov-1',
      appointmentTypeId: 'type-1',
      date: `${FUTURE_DAY}`,
    });
    const url = f.calls[0].url;
    check(
      url.startsWith(`${API}/scheduling/data/appointment-service/available-appointment-places-between-range?`),
      'fetchAvailableSlots → /scheduling/data/appointment-service/available-appointment-places-between-range'
    );
    const qs = new URLSearchParams(url.split('?')[1]);
    check(qs.get('providerId') === 'prov-1', 'fetchAvailableSlots query pins providerId');
    check(
      qs.get('providerIsLocalOrganisation') === 'true',
      'fetchAvailableSlots query pins providerIsLocalOrganisation'
    );
    check(
      qs.get('minDateTime') === `${FUTURE_DAY} 00:00:00`,
      'fetchAvailableSlots query pins minDateTime (future date → midnight)'
    );
    check(
      qs.get('localOrganisationFilters[appointmentTypeId]') === 'type-1',
      'fetchAvailableSlots query pins localOrganisationFilters[appointmentTypeId]'
    );
    check(slots.length === 1, 'fetchAvailableSlots keeps only diaryEntryType.isSlot entries');
    restoreFetch();
  }

  {
    const f = recordingFetch({ slotReservationId: 'res-1' });
    setFetch(f);
    await core.reserveSlot(API, {
      diaryId: 'diary-1',
      startDateTime: `${FUTURE_DAY} 09:00:00`,
      duration: 10,
      appointmentTypeId: 'type-1',
    });
    check(
      f.calls[0].url ===
        `${API}/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress`,
      'reserveSlot → /scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress'
    );
    const body = JSON.parse(f.calls[0].opts.body);
    check(
      JSON.stringify(Object.keys(body)) ===
        JSON.stringify([
          'diaryId',
          'intendedStartDateTime',
          'intendedDuration',
          'allowMatchingSlotsFromOtherDiaries',
          'substituteSlotFilters',
        ]),
      'reserveSlot body field names pinned'
    );
    check(
      JSON.stringify(Object.keys(body.substituteSlotFilters)) ===
        JSON.stringify([
          'staffIds',
          'siteIds',
          'appointmentTypeId',
          'preferredStaffGenders',
          'jobRoleIds',
          'preferredLanguages',
        ]),
      'reserveSlot substituteSlotFilters field names pinned'
    );
    check(
      body.intendedStartDateTime === `${FUTURE_DAY} 09:00:00`,
      'reserveSlot maps startDateTime → intendedStartDateTime'
    );
    check(body.intendedDuration === 10, 'reserveSlot maps duration → intendedDuration');
    restoreFetch();
  }

  {
    const f = recordingFetch({ deliveryMode: 'face-to-face' });
    setFetch(f);
    await core.fetchCreateForm(API, { slotReservationId: 'res-1', patientId: 'pat-1' });
    const url = f.calls[0].url;
    check(
      url.startsWith(`${API}/scheduling/data/appointment/create-appointment?`),
      'fetchCreateForm → /scheduling/data/appointment/create-appointment'
    );
    const qs = new URLSearchParams(url.split('?')[1]);
    check(qs.get('context') === 'create-booked-appointment', 'fetchCreateForm query pins context');
    check(qs.get('appointmentTemporalType') === 'timed', 'fetchCreateForm query pins appointmentTemporalType');
    check(
      qs.get('slotReservationId') === 'res-1' && qs.get('patientId') === 'pat-1',
      'fetchCreateForm query pins slotReservationId + patientId'
    );
    restoreFetch();
  }

  // ==========================================================================
  // 2 — createAppointment: explicit-patientId guard + payload passthrough
  // ==========================================================================
  console.log('\n=== 2. createAppointment identity guard (H-043 / plan D1.2) ===');

  // The exact payload slots.js and booking-inline.js build. Field names are the
  // live API contract — this list changing is a deliberate act, not a refactor.
  const CREATE_PAYLOAD_KEYS = [
    'context',
    'appointmentTemporalType',
    'appointmentTypeId',
    'patientId',
    'deliveryMode',
    'intendedDuration',
    'diaryId',
    'isHighPriority',
    'isHiddenFromPatientFacingServices',
    'intendedStartDateTime',
    'reasonForAppointment',
    'additionalInformation',
    'embargoOverrideReason',
    'slotReservationId',
    'nhsNationalSlotTypeCategory',
    'allowOverlappingAppointments',
    'gpadReportingExceptionReasons',
    'clinicalCaseId',
    'bookingConfirmationRecipients',
    'rescheduledAppointmentVersionId',
  ];
  const samplePayload = {
    context: 'create-booked-appointment',
    appointmentTemporalType: 'timed',
    appointmentTypeId: 'type-1',
    patientId: 'pat-1',
    deliveryMode: 'face-to-face',
    intendedDuration: 10,
    diaryId: 'diary-1',
    isHighPriority: false,
    isHiddenFromPatientFacingServices: false,
    intendedStartDateTime: `${FUTURE_DAY} 09:00:00`,
    reasonForAppointment: null,
    additionalInformation: null,
    embargoOverrideReason: null,
    slotReservationId: 'res-1',
    nhsNationalSlotTypeCategory: '10127',
    allowOverlappingAppointments: 'allow',
    gpadReportingExceptionReasons: [],
    clinicalCaseId: null,
    bookingConfirmationRecipients: ['sms'],
    rescheduledAppointmentVersionId: null,
  };

  {
    // No network mock at all: if the guard leaks, the real fetch is attempted
    // and the test fails loudly rather than passing by accident.
    let fetched = false;
    setFetch(async () => {
      fetched = true;
      return mockResponse(200, { appointmentId: 'appt-1' });
    });

    await expectReject(
      () => core.createAppointment(API, { ...samplePayload, patientId: null }),
      'booking-core: explicit patientId required',
      'createAppointment with patientId: null'
    );
    await expectReject(
      () => core.createAppointment(API, { ...samplePayload, patientId: '' }),
      'booking-core: explicit patientId required',
      'createAppointment with patientId: ""'
    );
    await expectReject(
      () => core.createAppointment(API, { ...samplePayload, patientId: undefined }),
      'booking-core: explicit patientId required',
      'createAppointment with patientId missing'
    );
    await expectReject(
      () => core.createAppointment(API, undefined),
      'booking-core: explicit patientId required',
      'createAppointment with no payload'
    );
    check(fetched === false, 'createAppointment guard throws BEFORE any network call');
    restoreFetch();
  }

  {
    const f = recordingFetch({ appointmentId: 'appt-1' });
    setFetch(f);
    const res = await core.createAppointment(API, samplePayload);
    check(res.appointmentId === 'appt-1', 'createAppointment returns the parsed API response');
    check(
      f.calls[0].url === `${API}/scheduling/appointment/create-appointment`,
      'createAppointment → /scheduling/appointment/create-appointment'
    );
    check(f.calls[0].opts.method === 'POST', 'createAppointment POSTs');
    check(f.calls[0].opts.credentials === 'include', 'createAppointment sends credentials');
    const sent = JSON.parse(f.calls[0].opts.body);
    check(
      JSON.stringify(Object.keys(sent)) === JSON.stringify(CREATE_PAYLOAD_KEYS),
      'createAppointment body field names pinned (exact key list, in order)'
    );
    check(sent.patientId === 'pat-1', 'createAppointment sends the caller-supplied patientId verbatim');
    restoreFetch();
  }

  // ==========================================================================
  // 3 — releaseReservation: keepalive (plan D1.3)
  // ==========================================================================
  console.log('\n=== 3. releaseReservation keepalive ===');

  {
    const f = recordingFetch({});
    setFetch(f);
    await core.releaseReservation(API, 'res-1');
    check(
      f.calls[0].url ===
        `${API}/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended`,
      'releaseReservation → /scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended'
    );
    check(f.calls[0].opts.keepalive === true, 'releaseReservation passes keepalive: true (survives panel close)');
    check(
      JSON.stringify(JSON.parse(f.calls[0].opts.body)) === JSON.stringify({ slotReservationId: 'res-1' }),
      'releaseReservation body pins slotReservationId'
    );
    restoreFetch();
  }

  {
    // Other calls must NOT be keepalive (keepalive has a small body budget and
    // is only appropriate for the fire-and-forget release).
    const f = recordingFetch({ appointmentId: 'appt-1' });
    setFetch(f);
    await core.createAppointment(API, samplePayload);
    check(f.calls[0].opts.keepalive === false, 'createAppointment is not keepalive');
    restoreFetch();
  }

  {
    const f = recordingFetch({}, 500);
    setFetch(f);
    let threw = false;
    try {
      await core.releaseReservation(API, 'res-1');
    } catch (_) {
      threw = true;
    }
    check(threw === false, 'releaseReservation still swallows errors (fire-and-forget)');
    restoreFetch();
  }

  {
    setFetch(recordingFetch({}));
    const f = globalThis.fetch;
    await core.releaseReservation(null, 'res-1');
    await core.releaseReservation(API, null);
    check(f.calls.length === 0, 'releaseReservation no-ops without apiBase / reservation id');
    restoreFetch();
  }

  // ==========================================================================
  // 4 — findSlotsInWindow (plan D1.4)
  // ==========================================================================
  console.log('\n=== 4. findSlotsInWindow caps ===');

  // 2026-07-27 is a Monday; 2026-08-01/02 are Sat/Sun.
  const MONDAY = '2026-07-27';

  // Fetcher that records the dates asked for and tracks peak in-flight calls.
  function makeFetcher({ slotsPerDay = 0, fail = {}, delay = 0 } = {}) {
    const state = { dates: [], inFlight: 0, peak: 0 };
    state.fetch = async (apiBase, { date }) => {
      state.dates.push(date);
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      try {
        await new Promise((r) => setTimeout(r, delay));
        if (fail[date]) throw Object.assign(new Error(`HTTP ${fail[date]}`), { status: fail[date] });
        const n = typeof slotsPerDay === 'function' ? slotsPerDay(date) : slotsPerDay;
        return Array.from({ length: n }, (_, i) => ({
          startDateTime: `${date} ${String(9 + i).padStart(2, '0')}:00:00`,
          diaryId: `d-${date}-${i}`,
        }));
      } finally {
        state.inFlight--;
      }
    };
    return state;
  }

  check(core.MAX_WINDOW_DAYS === 28, 'MAX_WINDOW_DAYS is 28 (4 weeks)');
  check(core.MAX_CONCURRENCY === 4, 'MAX_CONCURRENCY is 4');

  await expectReject(
    () => core.findSlotsInWindow(API, { fromDate: 'next tuesday' }),
    'fromDate as YYYY-MM-DD',
    'findSlotsInWindow with a malformed fromDate'
  );

  {
    // days cap: ask for 90, get at most 28 calendar days' worth of dates.
    const h = makeFetcher({ slotsPerDay: 0 });
    const res = await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 90,
      skipWeekends: false,
      fetchImpl: h.fetch,
    });
    check(h.dates.length === 28, `days is hard-capped at 28 (asked 90, fetched ${h.dates.length})`);
    check(h.dates[0] === MONDAY, 'window starts at fromDate');
    check(h.dates[h.dates.length - 1] === '2026-08-23', 'window ends 27 days after fromDate');
    check(res.aborted === false && res.error === null, 'clean run reports aborted:false, error:null');
    check(Object.keys(res.byDay).length === 28, 'byDay has an entry per fetched date, even when empty');
  }

  {
    // Weekend skip removes Sat/Sun from the span (it does not extend it).
    const h = makeFetcher({ slotsPerDay: 0 });
    await core.findSlotsInWindow(API, { fromDate: MONDAY, days: 14, skipWeekends: true, fetchImpl: h.fetch });
    check(h.dates.length === 10, `skipWeekends drops Sat/Sun from a 14-day span (10 weekdays, got ${h.dates.length})`);
    check(!h.dates.includes('2026-08-01') && !h.dates.includes('2026-08-02'), 'no weekend dates fetched');

    const h2 = makeFetcher({ slotsPerDay: 0 });
    await core.findSlotsInWindow(API, { fromDate: MONDAY, days: 14, skipWeekends: false, fetchImpl: h2.fetch });
    check(h2.dates.length === 14, 'skipWeekends:false fetches every calendar day');
    check(h2.dates.includes('2026-08-01'), 'weekend dates fetched when skipWeekends is off');
  }

  {
    // Concurrency: never more than 4 in flight, and never more than asked for.
    const h = makeFetcher({ slotsPerDay: 0, delay: 5 });
    await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 28,
      skipWeekends: false,
      concurrency: 99,
      fetchImpl: h.fetch,
    });
    check(h.peak <= 4, `concurrency clamped to 4 even when 99 is requested (peak in-flight ${h.peak})`);

    const h2 = makeFetcher({ slotsPerDay: 0, delay: 5 });
    await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 28,
      skipWeekends: false,
      concurrency: 2,
      fetchImpl: h2.fetch,
    });
    check(h2.peak <= 2, `a lower caller concurrency is respected (peak in-flight ${h2.peak})`);
  }

  {
    // 429 aborts the remaining queue and hands back partial results.
    const h = makeFetcher({ slotsPerDay: 1, fail: { '2026-07-29': 429 }, delay: 1 });
    const res = await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 28,
      skipWeekends: false,
      concurrency: 1,
      limit: 1000,
      fetchImpl: h.fetch,
    });
    check(res.aborted === true, '429 sets aborted:true');
    check(res.error && /429/.test(res.error.message), '429 returns the error');
    check(h.dates.length < 28, `429 stops the remaining queue (fetched ${h.dates.length} of 28)`);
    check(res.slots.length > 0, '429 still returns the slots collected before the abort (partial results)');

    const h5 = makeFetcher({ slotsPerDay: 1, fail: { '2026-07-29': 503 }, delay: 1 });
    const res5 = await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 28,
      skipWeekends: false,
      concurrency: 1,
      limit: 1000,
      fetchImpl: h5.fetch,
    });
    check(res5.aborted === true && h5.dates.length < 28, '5xx aborts the remaining queue too');

    // A one-off non-backoff failure is recorded but does not abandon the window.
    const h4 = makeFetcher({ slotsPerDay: 1, fail: { '2026-07-29': 404 }, delay: 1 });
    const res4 = await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 5,
      skipWeekends: false,
      concurrency: 1,
      limit: 1000,
      fetchImpl: h4.fetch,
    });
    check(res4.aborted === false, 'a 404 on one day does not abort the window');
    check(h4.dates.length === 5, 'every other day in the window is still fetched after a 404');
    check(res4.error && /404/.test(res4.error.message), 'the non-fatal error is still reported');
    check(res4.byDay['2026-07-29'] === undefined, 'the failed day is absent from byDay');
  }

  {
    // limit stops the fan-out early.
    const h = makeFetcher({ slotsPerDay: 3, delay: 1 });
    const res = await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 28,
      skipWeekends: false,
      concurrency: 1,
      limit: 5,
      fetchImpl: h.fetch,
    });
    check(h.dates.length < 28, `limit stops the fan-out early (fetched ${h.dates.length} of 28 days)`);
    check(res.slots.length === 5, 'slots are capped at limit');
    check(res.aborted === false, 'stopping at limit is not an abort');
  }

  {
    // Results are sorted ascending by startDateTime regardless of the order the
    // pooled workers completed in.
    const h = makeFetcher({
      slotsPerDay: 2,
      delay: 0,
      // Reverse the natural completion order: later dates resolve first.
    });
    const shuffling = async (apiBase, args) => {
      await new Promise((r) => setTimeout(r, args.date === MONDAY ? 8 : 1));
      return h.fetch(apiBase, args);
    };
    const res = await core.findSlotsInWindow(API, {
      fromDate: MONDAY,
      days: 4,
      skipWeekends: false,
      concurrency: 4,
      limit: 1000,
      fetchImpl: shuffling,
    });
    const times = res.slots.map((s) => s.startDateTime);
    const sorted = [...times].sort();
    check(JSON.stringify(times) === JSON.stringify(sorted), 'slots are sorted by startDateTime ascending');
    check(times.length === 8, 'all collected slots are returned (4 days × 2)');
    check(Object.keys(res.byDay).length === 4, 'byDay groups per date');
  }

  {
    // Default fetcher is the real one: with a mocked global fetch, no fetchImpl.
    const f = recordingFetch({ availablePlaces: {} });
    setFetch(f);
    const res = await core.findSlotsInWindow(API, { fromDate: MONDAY, days: 2, skipWeekends: false });
    check(f.calls.length === 2, 'findSlotsInWindow defaults to the real fetchAvailableSlots');
    check(
      f.calls.every((c) =>
        c.url.startsWith(`${API}/scheduling/data/appointment-service/available-appointment-places-between-range?`)
      ),
      'default fetcher hits the available-appointment-places-between-range endpoint'
    );
    check(res.slots.length === 0, 'no slots when the API returns no availablePlaces');
    restoreFetch();
  }

  // ==========================================================================
  // 5 — booking-api.js is a re-export shim, not a second implementation
  // ==========================================================================
  console.log('\n=== 5. booking-api.js shim identity ===');

  {
    const shim = await import(modUrl('side-panel/modules/slots/booking-api.js'));
    const reexported = [
      'fetchAppointmentFinder',
      'fetchAvailableSlots',
      'reserveSlot',
      'fetchCreateForm',
      'createAppointment',
      'releaseReservation',
      'findSlotsInWindow',
    ];
    for (const name of reexported) {
      check(shim[name] === core[name], `booking-api.js re-exports the SAME ${name} (identity, not a copy)`);
    }
    check(shim.MAX_WINDOW_DAYS === core.MAX_WINDOW_DAYS, 'booking-api.js re-exports MAX_WINDOW_DAYS');
    check(shim.MAX_CONCURRENCY === core.MAX_CONCURRENCY, 'booking-api.js re-exports MAX_CONCURRENCY');

    // Identity resolution stays in the shim and NEVER in the core (plan D1.2).
    check(typeof shim.detectMedicusTab === 'function', 'booking-api.js keeps detectMedicusTab');
    check(typeof shim.detectPatientId === 'function', 'booking-api.js keeps detectPatientId');
    check(core.detectMedicusTab === undefined, 'booking-core.js exports NO detectMedicusTab');
    check(core.detectPatientId === undefined, 'booking-core.js exports NO detectPatientId');
  }

  {
    // Source-level guards: the core must stay free of tab detection, and
    // slots.js must re-verify the patient at commit time (plan D1.5, H-043).
    const fs = require('fs');
    const path = require('path');
    const coreSrc = fs.readFileSync(path.join(__dirname, 'shared/booking-core.js'), 'utf8');
    check(!/chrome\.tabs/.test(coreSrc), 'booking-core.js never touches chrome.tabs');
    check(
      coreSrc.includes('TODO(D2 spike): confirm whether available-appointment-places-between-range'),
      'booking-core.js records the D2 range-param spike TODO'
    );

    const slotsSrc = fs.readFileSync(path.join(__dirname, 'side-panel/modules/slots/slots.js'), 'utf8');
    const confirm = slotsSrc.slice(slotsSrc.indexOf('async function doConfirmBooking'));
    const verifyAt = confirm.indexOf('detectPatientId(');
    const createAt = confirm.indexOf('await createAppointment(');
    check(verifyAt !== -1, 'slots.js doConfirmBooking re-resolves the patient (detectPatientId)');
    check(confirm.indexOf('await detectMedicusTab()') !== -1, 'slots.js doConfirmBooking re-detects the Medicus tab');
    check(verifyAt !== -1 && createAt !== -1 && verifyAt < createAt, 'slots.js re-verifies BEFORE createAppointment');
    check(confirm.includes('abortBookingOnIdentityMismatch'), 'slots.js aborts the booking on an identity mismatch');
    check(
      /function abortBookingOnIdentityMismatch[\s\S]{0,600}releaseReservation\(/.test(slotsSrc),
      'the mismatch abort releases the held reservation'
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
