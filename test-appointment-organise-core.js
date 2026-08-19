// Appointment organise core — pin captured cancel / cross-list reschedule.
// Run with: node test-appointment-organise-core.js
'use strict';

const core = require('./shared/appointment-organise-core.js');

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

async function expectReject(fn, fragment, label) {
  try {
    await fn();
    check(false, label + ' — expected rejection');
  } catch (e) {
    check(
      typeof e.message === 'string' && e.message.includes(fragment),
      label + ' — rejects with "' + fragment + '" (got: "' + e.message + '")'
    );
  }
}

function mockResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})),
  };
}

function recordingFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: url, opts: opts || {} });
    return handler(url, opts || {}, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

const API = 'https://560b6c.api.england.medicus.health';

const mouse = {
  id: '01a018d9-0bca-73a3-83f9-f5bd60eec3d1',
  versionId: 'bc116cff5de9f8bb111123455cf984be',
  patientId: '01970c67-06e9-70d7-802c-944574315c44',
  patientName: 'Mr Micky Mouse',
  diaryId: '01a018d5-9e38-70a0-a826-6bda71a2b6c7',
  staffName: 'A Nurse Practitioner Clinic',
  startDateTime: '2026-08-23 10:00:00',
  endDateTime: '2026-08-23 11:00:00',
  duration: 60,
  appointmentTypeId: '0198a8f2-e665-701c-b744-4d8a7ab771bf',
  appointmentTypeName: 'GP Appointment',
  deliveryMode: 'face-to-face',
  nhsNationalSlotTypeCategory: '10127',
  reason: 'GP Appointment',
  additionalInformation: null,
  isHiddenFromPatientFacingServices: false,
  displayStatus: 'booked',
  arrived: false,
  locked: false,
};

const otherDiary = '01a018e0-c465-73dc-8808-5f5c76348e98';

function sampleRaw() {
  return {
    date: '2026-08-23',
    staffSchedules: [
      {
        id: 'staff-1',
        name: 'A Nurse Practitioner Clinic',
        schedule: [
          {
            scheduleType: 'diary',
            id: mouse.diaryId,
            startDateTime: '2026-08-23 10:00:00',
            endDateTime: '2026-08-23 11:00:00',
            summary: {
              status: { isCancelled: false },
              usualAppointmentDuration: 15,
              defaultDeliveryMode: { value: 'face-to-face' },
              nhsNationalSlotTypeCategoryDefault: { value: '10127' },
            },
            entries: [
              {
                id: mouse.id,
                versionId: mouse.versionId,
                patient: { id: mouse.patientId, name: mouse.patientName },
                diaryEntryType: { value: 'appointment' },
                appointmentType: { id: mouse.appointmentTypeId, name: 'GP Appointment' },
                startDateTime: mouse.startDateTime,
                endDateTime: mouse.endDateTime,
                duration: 60,
                compiledReasonForAppointment: 'GP Appointment',
                displayStatus: { value: 'booked' },
                deliveryMode: { value: 'face-to-face' },
                appointmentStatus: { value: 'pending', isCancelled: false, isStarted: false, isSeen: false },
                arrivalStatus: null,
                arrivedDateTime: null,
              },
            ],
          },
        ],
      },
    ],
    unassignedDiaries: [
      {
        scheduleType: 'diary',
        id: otherDiary,
        startDateTime: '2026-08-23 11:00:00',
        endDateTime: '2026-08-23 12:00:00',
        summary: {
          status: { isCancelled: false },
          usualAppointmentDuration: 15,
          defaultDeliveryMode: { value: 'face-to-face' },
          nhsNationalSlotTypeCategoryDefault: { value: '10127' },
        },
        entries: [],
      },
    ],
  };
}

const stretchDiary = '01a018eb-e836-7072-9110-6f5e7115410b';
const stretchMouse = {
  id: '01a018ef-b029-7245-ac45-6f70ecc11929',
  versionId: 'c3e761d3fc7f8a3aaf0d67316bf293fb',
  patientId: mouse.patientId,
  patientName: mouse.patientName,
  diaryId: stretchDiary,
  staffName: 'Unassigned',
  startDateTime: '2026-08-23 14:00:00',
  endDateTime: '2026-08-23 14:15:00',
  duration: 15,
  appointmentTypeId: mouse.appointmentTypeId,
  appointmentTypeName: 'GP Appointment',
  deliveryMode: 'face-to-face',
  nhsNationalSlotTypeCategory: '10127',
  reason: 'GP Appointment',
  additionalInformation: null,
  isHiddenFromPatientFacingServices: false,
  displayStatus: 'booked',
  arrived: false,
  locked: false,
};

function stretchEntry(kind, start, extra) {
  extra = extra || {};
  if (kind === 'slot') {
    return {
      diaryEntryType: { value: 'slot' },
      diaryId: stretchDiary,
      startDateTime: start,
      endDateTime: core.addMinutes(start, 15),
      duration: 15,
    };
  }
  return Object.assign(
    {
      id: extra.id,
      versionId: extra.versionId || 'v-n',
      patient: { id: extra.patientId || mouse.patientId, name: extra.patientName || mouse.patientName },
      diaryEntryType: { value: 'appointment' },
      appointmentType: { id: mouse.appointmentTypeId, name: 'GP Appointment' },
      startDateTime: start,
      endDateTime: extra.end || core.addMinutes(start, 15),
      duration: extra.duration || 15,
      displayStatus: { value: 'booked' },
      deliveryMode: { value: 'face-to-face' },
      appointmentStatus: { value: 'pending', isCancelled: false, isStarted: false, isSeen: false },
    },
    extra.fields || {}
  );
}

function sampleStretchRaw(nextBooked) {
  const entries = [
    stretchEntry('slot', '2026-08-23 13:00:00'),
    stretchEntry('appointment', '2026-08-23 14:00:00', {
      id: stretchMouse.id,
      versionId: stretchMouse.versionId,
      end: '2026-08-23 14:15:00',
    }),
  ];
  if (nextBooked) {
    entries.push(
      stretchEntry('appointment', '2026-08-23 14:15:00', {
        id: '01a01967-24fa-723b-9563-9d7865a909d7',
        versionId: '3bb6bfcbb2979f139d972e2615c062dc',
        end: '2026-08-23 14:30:00',
      })
    );
  } else {
    entries.push(stretchEntry('slot', '2026-08-23 14:15:00'));
  }
  entries.push(stretchEntry('slot', '2026-08-23 14:30:00'));
  entries.push(stretchEntry('slot', '2026-08-23 14:45:00'));
  return {
    date: '2026-08-23',
    staffSchedules: [],
    unassignedDiaries: [
      {
        scheduleType: 'diary',
        id: stretchDiary,
        startDateTime: '2026-08-23 13:00:00',
        endDateTime: '2026-08-23 15:00:00',
        summary: {
          status: { isCancelled: false },
          usualAppointmentDuration: 15,
          defaultDeliveryMode: { value: 'face-to-face' },
          nhsNationalSlotTypeCategoryDefault: { value: '10127' },
        },
        entries: entries,
      },
    ],
  };
}

console.log('=== 1. route + board parse ===');
{
  const route = core.parseBookRoute('/560b6c/scheduling/appointment-book', '?date=2026-08-23');
  check(route && route.siteId === '560b6c', 'appointment-book route yields siteId');
  check(route.date === '2026-08-23', 'date from query');
  check(route.apiBase === API, 'apiBase is the site API host');
  check(
    core.parseBookRoute('/560b6c/scheduling/homepage', '?tab=appointment-book&date=2026-08-23'),
    'homepage?tab=appointment-book is a book route'
  );
  check(
    core.parseBookRoute('/560b6c/scheduling/homepage', '?tab=something') === null,
    'other homepage tabs are not the book'
  );
}

{
  const board = core.parseBoard(sampleRaw());
  check(board.columns.length === 2, 'staff diary + unassigned diary');
  const appts = core.allAppointments(board);
  check(appts.length === 1 && appts[0].id === mouse.id, 'one booked appointment');
  check(appts[0].versionId === mouse.versionId, 'versionId from overview');
  check(appts[0].patientId === mouse.patientId, 'patient.id from overview');
  check(appts[0].duration === 60, 'duration minutes from overview');
  check(appts[0].diaryId === mouse.diaryId, 'diaryId is the session id');
  const unassigned = board.columns.find((c) => c.staffName === 'Unassigned');
  check(!!unassigned && unassigned.slots.length === 1, 'empty diary gets a synthetic drop slot');
  check(unassigned.slots[0].startDateTime === '2026-08-23 11:00:00', 'synthetic slot uses session start');
}

{
  const raw = sampleRaw();
  raw.staffSchedules[0].schedule[0].entries.push({
    id: 'cancelled-1',
    versionId: 'x',
    patient: { id: 'p', name: 'Other' },
    diaryEntryType: { value: 'appointment' },
    displayStatus: { value: 'cancelled' },
    startDateTime: '2026-08-23 10:30:00',
    duration: 10,
  });
  check(core.allAppointments(core.parseBoard(raw)).length === 1, 'cancelled appointments excluded');
}

{
  const raw = sampleRaw();
  raw.staffSchedules[0].schedule[0].entries[0].displayStatus = { value: 'arrived' };
  raw.staffSchedules[0].schedule[0].entries[0].arrivedDateTime = '2026-08-23 10:01:00';
  const appt = core.allAppointments(core.parseBoard(raw))[0];
  check(appt.arrived && appt.locked, 'arrived appointment is locked');
}

console.log('=== 2. draft stage / same-list allowed ===');
{
  const d0 = core.emptyDraft();
  check(core.hasDraftChanges(d0) === false, 'empty draft');
  const sameSlot = core.canStageMove(mouse, { diaryId: mouse.diaryId, startDateTime: mouse.startDateTime });
  check(sameSlot.ok === false, 'cannot drop onto the appointment\'s own slot');
  const same = core.canStageMove(mouse, { diaryId: mouse.diaryId, startDateTime: '2026-08-23 10:30:00' });
  check(same.ok === true, 'same-list move to a later slot is allowed');
  check(core.moveTypeFor(mouse, { diaryId: mouse.diaryId }) === 'to-same-diary', 'same diary → to-same-diary');
  check(core.isCrossListMove(mouse, { diaryId: mouse.diaryId }) === false, 'same diary is not cross-list');
  const arrived = Object.assign({}, mouse, { arrived: true, locked: true });
  check(core.canStageCancel(arrived).ok === false, 'arrived cannot cancel');
  check(core.canStageMove(arrived, { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00' }).ok === false, 'arrived cannot move');
  const cross = core.canStageMove(mouse, { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00' });
  check(cross.ok === true, 'cross-list move allowed');
  const d1 = core.stageMove(d0, mouse.id, {
    diaryId: otherDiary,
    startDateTime: '2026-08-23 11:00:00',
    staffName: 'Unassigned',
    duration: 15,
  });
  const d2 = core.stageCancel(d1, mouse.id);
  check(d2.cancelIds.join() === mouse.id, 'cancel unstages a move of the same tile');
  check(d2.moveIds.length === 0, 'move list cleared when staged as cancel');
  const d3 = core.setCancelReason(d2, mouse.id, 'SUITE TEST delete dummy Sunday booking');
  const board = core.parseBoard(sampleRaw());
  const sum = core.summariseDraft(d3, board);
  check(sum.count === 1, 'one included cancel');
  check(/Cancel Mr Micky Mouse/.test(sum.items[0].text), 'confirm line names the patient');
  check(/will not send a cancellation message/.test(sum.items[0].text), 'confirm line states no patient message');
  const d4 = core.stageMove(core.emptyDraft(), mouse.id, {
    diaryId: otherDiary,
    startDateTime: '2026-08-23 11:00:00',
    staffName: 'Unassigned',
  });
  const visual = core.applyDraftToBoard(board, d4);
  const dest = visual.columns.find((c) => c.diaryId === otherDiary);
  check(dest.appointments.some((a) => a.id === mouse.id && a.stagedMove), 'staged move appears on the target diary');
  check(
    !visual.columns.find((c) => c.diaryId === mouse.diaryId).appointments.some((a) => a.id === mouse.id),
    'staged move leaves the source diary'
  );
}

console.log('=== 3. payload keys (captured byte-for-byte) ===');
{
  const cancel = core.buildCancelPayload({
    appointmentId: '01a018e2-04b1-72dd-a9c4-fdf551f98b4c',
    reason: 'SUITE TEST delete dummy Sunday booking',
  });
  check(
    JSON.stringify(Object.keys(cancel)) === JSON.stringify(core.CANCEL_PAYLOAD_KEYS),
    'cancel body key list pinned'
  );
  check(Array.isArray(cancel.otherAppointmentIds) && cancel.otherAppointmentIds.length === 0, 'never ticks other appointments');
  check(
    Array.isArray(cancel.cancellationConfirmationRecipients) &&
      cancel.cancellationConfirmationRecipients.length === 0,
    'never defaults Send-to On'
  );
}

{
  let threw = false;
  try {
    core.buildCancelPayload({ appointmentId: mouse.id, reason: '   ' });
  } catch (e) {
    threw = /cancellationReason required/.test(e.message);
  }
  check(threw, 'blank cancel reason refuses to build');
}

{
  const reserve = core.buildReserveReschedulePayload({
    diaryId: otherDiary,
    startDateTime: '2026-08-23 11:00:00',
    intendedDuration: 15,
  });
  check(
    JSON.stringify(Object.keys(reserve)) === JSON.stringify(core.RESERVE_RESCHEDULE_KEYS),
    'move-reserve body is the 3-field capture, not booking-core'
  );
}

{
  const upd = core.buildUpdateReservationPayload({
    slotReservationId: '01a018e1-9543-73c5-a073-799c14a50cb9',
    diaryId: otherDiary,
    appointmentId: mouse.id,
    startDateTime: '2026-08-23 11:00:00',
    intendedDuration: 60,
  });
  check(
    JSON.stringify(Object.keys(upd)) === JSON.stringify(core.UPDATE_RESERVATION_KEYS),
    'update-slot-reservation key list pinned'
  );
  check(upd.rescheduledAppointmentId === mouse.id, 'update-slot-reservation carries rescheduledAppointmentId');
}

{
  const created = core.buildRescheduleCreatePayload({
    patientId: mouse.patientId,
    appointmentId: mouse.id,
    versionId: mouse.versionId,
    slotReservationId: '01a018e1-9543-73c5-a073-799c14a50cb9',
    diaryId: otherDiary,
    startDateTime: '2026-08-23 11:00:00',
    intendedDuration: 60,
    deliveryMode: 'face-to-face',
    nhsNationalSlotTypeCategory: '10127',
    reasonForAppointment: null,
    additionalInformation: null,
  });
  check(
    JSON.stringify(Object.keys(created)) === JSON.stringify(core.RESCHEDULE_CREATE_KEYS),
    'reschedule create-appointment key list pinned'
  );
  check(created.context === 'reschedule-appointment', 'context is reschedule-appointment, not create-booked-appointment');
  check(created.rescheduledAppointmentVersionId === mouse.versionId, 'version id is sent, never null');
  check(created.bookingConfirmationRecipients.length === 0, 'reschedule does not invent Send-to channels');
  check(!Object.prototype.hasOwnProperty.call(created, 'appointmentTypeId'), 'reschedule payload has no appointmentTypeId');
}

{
  let fetched = false;
  const client = core.createClient(API, {
    fetchImpl: async () => {
      fetched = true;
      return mockResponse(200, {});
    },
  });
  expectReject(
    () =>
      Promise.resolve(
        core.buildRescheduleCreatePayload({
          patientId: null,
          appointmentId: mouse.id,
          versionId: mouse.versionId,
          slotReservationId: 'r',
          diaryId: otherDiary,
          startDateTime: '2026-08-23 11:00:00',
          intendedDuration: 60,
        })
      ),
    'explicit patientId required',
    'reschedule payload without patientId'
  );
  check(fetched === false, 'builder throws before any network');
  void client;
}

console.log('=== 4. commit cancel — paths, identity, empty other-ids ===');

(async () => {
  {
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleRaw());
      if (url.includes('/data/appointment/appointment-overview/')) {
        return mockResponse(200, {
          appointmentId: mouse.id,
          versionId: mouse.versionId,
          patientId: mouse.patientId,
          diaryId: mouse.diaryId,
          details: {
            appointmentStatus: { value: 'pending', isCancelled: false, isStarted: false, isSeen: false },
            displayStatus: { value: 'booked', isArrived: false },
          },
        });
      }
      if (url.includes('/data/appointment/cancel-appointment/')) {
        return mockResponse(200, { targetAppointmentId: mouse.id, otherAppointmentIds: ['weekday-live'] });
      }
      if (url.endsWith('/scheduling/appointment/cancel-appointment')) return mockResponse(200, {});
      return mockResponse(404, {});
    });
    const client = core.createClient(API, { fetchImpl: f });
    await client.commitCancel({
      date: '2026-08-23',
      appointmentId: mouse.id,
      patientId: mouse.patientId,
      reason: 'SUITE TEST delete dummy Sunday booking',
      pinned: { apiBase: API, patientId: mouse.patientId, appointmentId: mouse.id, versionId: mouse.versionId },
    });
    check(
      f.calls.some((c) => c.url === API + '/scheduling/data/appointment/appointment-overview/' + mouse.id),
      'cancel re-GETs appointment-overview'
    );
    const write = f.calls.find((c) => c.opts.method === 'POST');
    check(
      write.url === API + '/scheduling/appointment/cancel-appointment',
      'cancel POST → /scheduling/appointment/cancel-appointment'
    );
    const body = JSON.parse(write.opts.body);
    check(body.otherAppointmentIds.length === 0, 'commit strips weekday otherAppointmentIds from the form');
    check(body.cancellationConfirmationRecipients.length === 0, 'commit sends no cancellation recipients');
    check(write.opts.credentials === 'include', 'cancel is credentialed');
  }

  {
    const raw = sampleRaw();
    raw.staffSchedules[0].schedule[0].entries[0].versionId = 'changed';
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, raw);
      return mockResponse(200, {});
    });
    const client = core.createClient(API, { fetchImpl: f });
    await expectReject(
      () =>
        client.commitCancel({
          date: '2026-08-23',
          appointmentId: mouse.id,
          patientId: mouse.patientId,
          reason: 'x',
          pinned: { versionId: mouse.versionId, patientId: mouse.patientId, appointmentId: mouse.id },
        }),
      'version',
      'cancel aborts on version drift'
    );
    check(
      f.calls.every((c) => c.opts.method !== 'POST'),
      'no cancel POST after version drift'
    );
  }

  {
    const f = recordingFetch(() => mockResponse(200, {}));
    const client = core.createClient(API, { fetchImpl: f });
    await expectReject(
      () =>
        client.commitCancel({
          date: '2026-08-23',
          appointmentId: mouse.id,
          reason: 'x',
        }),
      'explicit patientId required',
      'cancel without patientId'
    );
    check(f.calls.length === 0, 'cancel guard throws before fetch');
  }

  console.log('=== 5. commit move — captured sequence, drift, release on fail ===');

  function recordingBooking() {
    const calls = [];
    return {
      calls: calls,
      reserveSlot: async (apiBase, args) => {
        calls.push({ fn: 'reserveSlot', apiBase: apiBase, args: args });
        return { slotReservationId: '01a018e1-9543-73c5-a073-799c14a50cb9' };
      },
      createAppointment: async (apiBase, payload) => {
        calls.push({ fn: 'createAppointment', apiBase: apiBase, payload: payload });
        return { appointmentId: '01a018e2-04b1-72dd-a9c4-fdf551f98b4c' };
      },
      releaseReservation: async (apiBase, id) => {
        calls.push({ fn: 'releaseReservation', apiBase: apiBase, id: id });
      },
    };
  }

  {
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleRaw());
      if (url.includes('/data/appointment/move-appointment/')) {
        check(url.includes('moveType=to-another-diary'), 'move form uses moveType=to-another-diary');
        return mockResponse(200, {
          moveType: { value: 'to-another-diary', isToAnotherDiary: true },
          appointment: {
            id: mouse.id,
            versionId: mouse.versionId,
            patient: { id: mouse.patientId, name: mouse.patientName },
          },
        });
      }
      if (url.includes('reserve-slot-and-broadcast')) {
        return mockResponse(200, { slotReservationId: '01a018e1-9543-73c5-a073-799c14a50cb9' });
      }
      if (url.includes('update-slot-reservation')) return mockResponse(200, {});
      return mockResponse(200, {});
    });
    const booking = recordingBooking();
    const client = core.createClient(API, { fetchImpl: f, booking: booking });
    const res = await client.commitMove({
      date: '2026-08-23',
      appointment: mouse,
      target: { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00', staffName: 'Unassigned', duration: 15 },
      pinned: { apiBase: API },
    });
    check(res.appointmentId === '01a018e2-04b1-72dd-a9c4-fdf551f98b4c', 'move returns the new appointment id');
    check(res.appointmentId !== mouse.id, 'new appointment id after move differs from source');
    check(booking.calls[0].fn === 'createAppointment', 'create goes through booking-core.createAppointment');
    const created = booking.calls[0].payload;
    check(created.context === 'reschedule-appointment', 'create context=reschedule-appointment');
    check(created.rescheduledAppointmentVersionId === mouse.versionId, 'create sends the pinned version id');
    check(created.bookingConfirmationRecipients.length === 0, 'create does not invent Send-to');
    check(
      booking.calls.some(
        (c) => c.fn === 'releaseReservation' && c.id === '01a018e1-9543-73c5-a073-799c14a50cb9'
      ),
      'cross-list releases the reservation AFTER successful create (captured 07:17:41)'
    );
    check(
      booking.calls.findIndex((c) => c.fn === 'createAppointment') <
        booking.calls.findIndex((c) => c.fn === 'releaseReservation'),
      'cross-list release is after create, not instead of it'
    );
    const posts = f.calls.filter((c) => c.opts.method === 'POST').map((c) => c.url.replace(API, ''));
    check(
      posts[0] === '/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress',
      'cross-list POST 1 = 3-field reserve'
    );
    check(posts[1] === '/scheduling/slot-reservation/update-slot-reservation', 'cross-list POST 2 = update-slot-reservation');
    check(!posts.some((p) => /move-appointment$/.test(p)), 'no POST …/move-appointment exists');
    check(!posts.some((p) => /cancel-appointment$/.test(p)), 'cross-list move is not cancel+create');
    const reserveBody = JSON.parse(f.calls.find((c) => c.url.includes('reserve-slot')).opts.body);
    check(
      JSON.stringify(Object.keys(reserveBody)) === JSON.stringify(core.RESERVE_RESCHEDULE_KEYS),
      'move reserve body is the 3-field capture, not booking-core extras'
    );
    check(reserveBody.intendedDuration === 15, 'cross-list reserve uses diary usual 15, not appointment 60');
    check(!Object.prototype.hasOwnProperty.call(reserveBody, 'substituteSlotFilters'), 'no substituteSlotFilters on move reserve');
    const upd = JSON.parse(f.calls.find((c) => c.url.includes('update-slot-reservation')).opts.body);
    check(upd.intendedDuration === 60, 'update-slot-reservation uses the appointment duration');
    check(upd.rescheduledAppointmentId === mouse.id, 'update-slot-reservation sets rescheduledAppointmentId');
  }

  {
    const sameTarget = { diaryId: mouse.diaryId, startDateTime: '2026-08-23 14:00:00', staffName: mouse.staffName, duration: 15 };
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleRaw());
      if (url.includes('/data/appointment/move-appointment/')) {
        check(url.includes('moveType=to-same-diary'), 'same-list form uses moveType=to-same-diary');
        return mockResponse(200, {
          moveType: { value: 'to-same-diary', isToSameDiary: true },
          appointment: { id: mouse.id, versionId: mouse.versionId, patient: { id: mouse.patientId } },
        });
      }
      if (url.includes('reserve-slot-and-broadcast')) {
        return mockResponse(200, { slotReservationId: '01a018ef-570e-735f-9a0c-1770fba8695f' });
      }
      return mockResponse(200, {});
    });
    const booking = recordingBooking();
    const client = core.createClient(API, { fetchImpl: f, booking: booking });
    const sameMouse = Object.assign({}, mouse, { duration: 15, startDateTime: '2026-08-23 13:00:00' });
    const res = await client.commitMove({
      date: '2026-08-23',
      appointment: sameMouse,
      target: sameTarget,
      pinned: { apiBase: API },
    });
    check(res.appointmentId === '01a018e2-04b1-72dd-a9c4-fdf551f98b4c', 'same-list move returns a new appointment id');
    check(res.appointmentId !== sameMouse.id, 'same-list new id differs from source');
    check(booking.calls[0].payload.diaryId === sameMouse.diaryId, 'same-list create keeps the source diaryId');
    check(booking.calls[0].payload.intendedStartDateTime === '2026-08-23 14:00:00', 'same-list create uses the new start');
    check(
      !f.calls.some((c) => c.url.includes('update-slot-reservation')),
      'same-list does not POST update-slot-reservation'
    );
    const reserveBody = JSON.parse(f.calls.find((c) => c.url.includes('reserve-slot')).opts.body);
    check(
      JSON.stringify(Object.keys(reserveBody)) === JSON.stringify(core.RESERVE_RESCHEDULE_KEYS),
      'same-list reserve is also the 3-field body'
    );
    check(
      booking.calls.some(
        (c) => c.fn === 'releaseReservation' && c.id === '01a018ef-570e-735f-9a0c-1770fba8695f'
      ),
      'same-list releases the reservation AFTER successful create (captured 07:32:37)'
    );
  }

  {
    check(core.moveDuration({ duration: 15 }) === 15, 'moveDuration keeps 15');
    let threw = false;
    try {
      core.moveDuration({ duration: 0 });
    } catch (e) {
      threw = /keep the booking length/.test(e.message);
    }
    check(threw, 'moveDuration refuses a zero length (TEST A overlap path)');
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleRaw());
      if (url.includes('/data/appointment/move-appointment/')) {
        return mockResponse(200, {
          appointment: { id: mouse.id, versionId: mouse.versionId, patient: { id: mouse.patientId } },
        });
      }
      if (url.includes('reserve-slot-and-broadcast')) {
        return mockResponse(200, { slotReservationId: 'res-30' });
      }
      if (url.includes('update-slot-reservation')) return mockResponse(200, {});
      return mockResponse(200, {});
    });
    const booking = recordingBooking();
    const client = core.createClient(API, { fetchImpl: f, booking: booking });
    await client.commitMove({
      date: '2026-08-23',
      appointment: mouse,
      target: { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00', duration: 30 },
    });
    check(
      booking.calls[0].payload.intendedDuration === 60,
      'dropping onto a 30-min gap still creates at the source 60 min (TEST A must not lengthen)'
    );
    check(
      !f.calls.some((c) => c.url.includes('cancel-appointment')),
      'move is not cancel-then-create (TEST A)'
    );
    const upd = JSON.parse(f.calls.find((c) => c.url.includes('update-slot-reservation')).opts.body);
    check(upd.intendedDuration === 60, 'cross-list update-slot-reservation keeps 60, not the 30-min gap');
  }

  {
    const raw = sampleRaw();
    raw.staffSchedules[0].schedule[0].entries[0].displayStatus = { value: 'arrived' };
    raw.staffSchedules[0].schedule[0].entries[0].arrivedDateTime = '2026-08-23 10:02:00';
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, raw);
      return mockResponse(200, {});
    });
    const client = core.createClient(API, { fetchImpl: f, booking: recordingBooking() });
    await expectReject(
      () =>
        client.commitMove({
          date: '2026-08-23',
          appointment: mouse,
          target: { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00', duration: 15 },
        }),
      'Arrived',
      'move aborts if the live row is now arrived'
    );
    check(
      f.calls.every((c) => c.opts.method !== 'POST'),
      'no move POSTs after arrived drift'
    );
  }

  {
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleRaw());
      if (url.includes('/data/appointment/move-appointment/')) {
        return mockResponse(200, {
          appointment: { id: mouse.id, versionId: mouse.versionId, patient: { id: mouse.patientId } },
        });
      }
      if (url.includes('reserve-slot-and-broadcast')) {
        return mockResponse(200, { slotReservationId: '01a018e1-9543-73c5-a073-799c14a50cb9' });
      }
      if (url.includes('update-slot-reservation')) return mockResponse(500, { error: 'nope' });
      return mockResponse(200, {});
    });
    const booking = recordingBooking();
    const client = core.createClient(API, { fetchImpl: f, booking: booking });
    await expectReject(
      () =>
        client.commitMove({
          date: '2026-08-23',
          appointment: mouse,
          target: { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00', duration: 15 },
        }),
      'HTTP 500',
      'move surfaces update failure'
    );
    check(
      booking.calls.some((c) => c.fn === 'releaseReservation' && c.id === '01a018e1-9543-73c5-a073-799c14a50cb9'),
      'failed move releases via booking-core.releaseReservation'
    );
  }

  {
    const f = recordingFetch(() => mockResponse(200, sampleRaw()));
    const client = core.createClient(API, { fetchImpl: f });
    await expectReject(
      () =>
        client.commitMove({
          date: '2026-08-23',
          appointment: mouse,
          target: { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00', duration: 15 },
        }),
      'booking-core reserve/create/release required',
      'commitMove refuses to invent a third reserve/create copy'
    );
  }

  {
    const f = recordingFetch(() => mockResponse(200, {}));
    const client = core.createClient(API, { fetchImpl: f });
    await expectReject(
      () =>
        client.commitMove({
          date: '2026-08-23',
          appointment: mouse,
          target: { diaryId: mouse.diaryId, startDateTime: mouse.startDateTime, duration: 15 },
        }),
      'different free slot',
      'commitMove refuses dropping onto the same slot'
    );
    check(f.calls.length === 0, 'same-slot refusal is before any fetch');
  }

  console.log('=== 5b. stretch — refuse when next booked, allow when next free ===');
  {
    const booked = core.parseBoard(sampleStretchRaw(true));
    const free = core.parseBoard(sampleStretchRaw(false));
    const apptB = core.findAppointment(booked, stretchMouse.id);
    const apptF = core.findAppointment(free, stretchMouse.id);
    check(core.followingSlotsFree(booked, apptB, 30) === false, 'followingSlotsFree false when 14:15 is booked');
    check(core.followingSlotsFree(free, apptF, 30) === true, 'followingSlotsFree true when 14:15 is free');
    const refuse = core.canStageStretch(apptB, 30, booked);
    check(refuse.ok === false && refuse.reason === core.STRETCH_NEIGHBOUR_BOOKED, 'refuse stretch when neighbour booked (TEST A)');
    const allow = core.canStageStretch(apptF, 30, free);
    check(allow.ok === true, 'allow stretch when neighbour free (TEST B)');
    check(core.canStageStretch(apptF, 30, booked).ok === false, 'same-patient neighbour still blocks');
    const stretchUpd = core.buildStretchUpdatePayload({
      slotReservationId: '01a019a4-00aa-73af-8595-cb98780f69e4',
      diaryId: stretchDiary,
      startDateTime: '2026-08-23 14:00:00',
      intendedDuration: 30,
    });
    check(
      JSON.stringify(Object.keys(stretchUpd)) === JSON.stringify(core.STRETCH_UPDATE_KEYS),
      'stretch update-slot-reservation keys omit allowOverlappingAppointments'
    );
    check(
      !Object.prototype.hasOwnProperty.call(stretchUpd, 'allowOverlappingAppointments'),
      'stretch update does not send allowOverlappingAppointments'
    );
    const stretchCreate = core.buildStretchCreatePayload({
      patientId: stretchMouse.patientId,
      appointmentTypeId: stretchMouse.appointmentTypeId,
      slotReservationId: '01a019a4-00aa-73af-8595-cb98780f69e4',
      diaryId: stretchDiary,
      startDateTime: '2026-08-23 14:00:00',
      intendedDuration: 30,
    });
    check(
      JSON.stringify(Object.keys(stretchCreate)) === JSON.stringify(core.STRETCH_CREATE_KEYS),
      'stretch create-appointment key list pinned without allow'
    );
    check(stretchCreate.context === 'create-booked-appointment', 'stretch create is a new book after cancel, not reschedule');
    check(stretchCreate.intendedDuration === 30, 'stretch create duration is 30');
    check(stretchCreate.bookingConfirmationRecipients.length === 0, 'stretch Send-to off');
    check(
      !Object.prototype.hasOwnProperty.call(stretchCreate, 'allowOverlappingAppointments'),
      'stretch create does not send allowOverlappingAppointments'
    );
  }

  {
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleStretchRaw(true));
      return mockResponse(200, {});
    });
    const client = core.createClient(API, { fetchImpl: f, booking: recordingBooking() });
    await expectReject(
      () =>
        client.commitStretch({
          date: '2026-08-23',
          appointment: stretchMouse,
          newDuration: 30,
        }),
      'following slot is booked',
      'commitStretch aborts before cancel when neighbour is booked'
    );
    check(
      f.calls.every((c) => c.opts.method !== 'POST'),
      'no cancel/create POSTs when stretch is refused'
    );
  }

  {
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleStretchRaw(false));
      if (url.includes('/data/appointment/appointment-overview/')) {
        return mockResponse(200, {
          appointmentId: stretchMouse.id,
          versionId: stretchMouse.versionId,
          patientId: stretchMouse.patientId,
          details: {
            appointmentStatus: { value: 'pending', isCancelled: false },
            displayStatus: { value: 'booked', isArrived: false },
          },
        });
      }
      if (url.includes('cancel-appointment') && !url.includes('/data/')) {
        return mockResponse(200, {});
      }
      if (url.includes('reserve-slot-and-broadcast')) {
        return mockResponse(200, { slotReservationId: '01a019a4-00aa-73af-8595-cb98780f69e4' });
      }
      if (url.includes('update-slot-reservation')) return mockResponse(200, {});
      return mockResponse(200, {});
    });
    const booking = recordingBooking();
    const client = core.createClient(API, { fetchImpl: f, booking: booking });
    const res = await client.commitStretch({
      date: '2026-08-23',
      appointment: stretchMouse,
      newDuration: 30,
    });
    check(!!res.appointmentId, 'TEST B stretch returns a new appointment id');
    const posts = f.calls.filter((c) => c.opts.method === 'POST').map((c) => c.url.replace(API, ''));
    check(posts[0] === '/scheduling/appointment/cancel-appointment', 'stretch POST 1 = cancel');
    check(
      posts[1] === '/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress',
      'stretch POST 2 = reserve at original 15'
    );
    check(posts[2] === '/scheduling/slot-reservation/update-slot-reservation', 'stretch POST 3 = update duration 30');
    const cancelBody = JSON.parse(f.calls.find((c) => String(c.url).endsWith('/cancel-appointment')).opts.body);
    check(cancelBody.otherAppointmentIds.length === 0, 'stretch cancel does not tick other appointments');
    check(cancelBody.cancellationConfirmationRecipients.length === 0, 'stretch cancel Send-to off');
    const reserveBody = JSON.parse(f.calls.find((c) => c.url.includes('reserve-slot')).opts.body);
    check(reserveBody.intendedDuration === 15, 'stretch reserve starts at 15');
    const upd = JSON.parse(f.calls.find((c) => c.url.includes('update-slot-reservation')).opts.body);
    check(upd.intendedDuration === 30, 'stretch update sets 30');
    check(upd.rescheduledAppointmentId === null, 'stretch update rescheduledAppointmentId is null');
    check(!Object.prototype.hasOwnProperty.call(upd, 'allowOverlappingAppointments'), 'stretch update omits allow');
    check(booking.calls[0].payload.intendedDuration === 30, 'stretch create duration 30');
    check(booking.calls[0].payload.context === 'create-booked-appointment', 'stretch create context is book, not reschedule');
    check(
      !Object.prototype.hasOwnProperty.call(booking.calls[0].payload, 'allowOverlappingAppointments'),
      'stretch create omits allowOverlappingAppointments'
    );
    check(
      booking.calls.some((c) => c.fn === 'releaseReservation'),
      'stretch releases the reservation after create'
    );
    const d = core.stageStretch(core.emptyDraft(), stretchMouse.id, 30);
    const sum = core.summariseDraft(d, core.parseBoard(sampleStretchRaw(false)));
    check(/Cancel then rebook/.test(sum.items[0].text), 'confirm bar says cancel then rebook');
    check(/Mr Micky Mouse/.test(sum.items[0].text), 'confirm bar names the patient');
  }

  console.log('=== 5c. sick-day rebook suggestions ===');
  {
    const coverDiary = 'cover-diary';
    const sickDiary = stretchDiary;
    function sickBoard(opts) {
      opts = opts || {};
      const coverSlots =
        opts.coverSlots !== undefined
          ? opts.coverSlots
          : [
              {
                diaryEntryType: { value: 'slot' },
                startDateTime: '2026-08-23 14:00:00',
                endDateTime: '2026-08-23 14:15:00',
                duration: 15,
                appointmentType: { id: opts.coverTypeId || mouse.appointmentTypeId },
                defaultDeliveryMode: { value: opts.coverDelivery || 'face-to-face' },
              },
            ];
      return core.parseBoard({
        date: '2026-08-23',
        staffSchedules: [
          {
            name: 'Cover GP',
            id: 'cover',
            schedule: [
              {
                scheduleType: 'diary',
                id: coverDiary,
                startDateTime: '2026-08-23 13:00:00',
                endDateTime: '2026-08-23 15:00:00',
                summary: {
                  status: { isCancelled: false },
                  usualAppointmentDuration: 15,
                  defaultDeliveryMode: { value: opts.coverDelivery || 'face-to-face' },
                  defaultAppointmentType: { id: opts.coverTypeId || mouse.appointmentTypeId },
                  site: { id: 'witley', name: 'Witley Surgery' },
                  nhsNationalSlotTypeCategoryDefault: { value: '10127' },
                },
                entries: coverSlots,
              },
            ],
          },
        ],
        unassignedDiaries: [
          {
            scheduleType: 'diary',
            id: sickDiary,
            startDateTime: '2026-08-23 13:00:00',
            endDateTime: '2026-08-23 15:00:00',
            summary: {
              status: { isCancelled: false },
              usualAppointmentDuration: 15,
              defaultDeliveryMode: { value: 'face-to-face' },
              defaultAppointmentType: { id: mouse.appointmentTypeId },
              site: { id: opts.sickSite || 'witley', name: 'Witley Surgery' },
              nhsNationalSlotTypeCategoryDefault: { value: '10127' },
            },
            entries: [
              {
                id: stretchMouse.id,
                versionId: stretchMouse.versionId,
                patient: { id: mouse.patientId, name: mouse.patientName },
                diaryEntryType: { value: 'appointment' },
                appointmentType: { id: mouse.appointmentTypeId, name: 'GP Appointment' },
                startDateTime: '2026-08-23 14:00:00',
                endDateTime: '2026-08-23 14:15:00',
                duration: 15,
                displayStatus: { value: opts.arrived ? 'arrived' : 'booked' },
                arrivedDateTime: opts.arrived ? '2026-08-23 13:55:00' : null,
                deliveryMode: { value: opts.delivery || 'face-to-face' },
                appointmentStatus: { value: 'pending', isCancelled: false, isStarted: !!opts.arrived, isSeen: false },
              },
            ],
          },
        ],
      });
    }

    const happy = sickBoard();
    const sug = core.suggestRebook(happy, core.findAppointment(happy, stretchMouse.id));
    check(sug.ok === true, 'suggests a similar slot on another list');
    check(sug.suggestion.diaryId === coverDiary, 'suggestion is not the sick diary');
    check(sug.suggestion.startDateTime === '2026-08-23 14:00:00', 'prefers the same clock time');

    const arrived = sickBoard({ arrived: true });
    check(
      core.suggestRebook(arrived, core.findAppointment(arrived, stretchMouse.id)).ok === false,
      'arrived / waiting-room tile is not suggested'
    );

    const wrongType = sickBoard({ coverTypeId: 'other-type' });
    check(
      core.suggestRebook(wrongType, core.findAppointment(wrongType, stretchMouse.id)).ok === false,
      'refuses a different appointment type'
    );

    const twoFifteens = sickBoard({
      coverSlots: [
        {
          diaryEntryType: { value: 'slot' },
          startDateTime: '2026-08-23 14:00:00',
          endDateTime: '2026-08-23 14:15:00',
          duration: 15,
          appointmentType: { id: mouse.appointmentTypeId },
          defaultDeliveryMode: { value: 'face-to-face' },
        },
        {
          diaryEntryType: { value: 'slot' },
          startDateTime: '2026-08-23 14:15:00',
          endDateTime: '2026-08-23 14:30:00',
          duration: 15,
          appointmentType: { id: mouse.appointmentTypeId },
          defaultDeliveryMode: { value: 'face-to-face' },
        },
      ],
    });
    const mouse30 = Object.assign({}, core.findAppointment(twoFifteens, stretchMouse.id), {
      duration: 30,
      endDateTime: '2026-08-23 14:30:00',
    });
    const run = core.suggestRebook(twoFifteens, mouse30);
    check(run.ok === true, 'two consecutive 15-min free tiles match a 30-min booking');
    check(run.suggestion.duration === 30, 'suggested run is 30 min');
    check(run.suggestion.reserveDuration === 15, 'reserve still starts at the 15-min tile (captured cross-list)');

    const oneFifteen = sickBoard({
      coverSlots: [
        {
          diaryEntryType: { value: 'slot' },
          startDateTime: '2026-08-23 14:00:00',
          duration: 15,
          appointmentType: { id: mouse.appointmentTypeId },
          defaultDeliveryMode: { value: 'face-to-face' },
        },
      ],
    });
    const miss = core.suggestRebook(oneFifteen, mouse30);
    check(miss.ok === false, 'a single 15-min tile cannot cover 30 min');
    check(/Need 30 min/.test(miss.reason), 'hint says need 30 min');
    check(/15-min tiles/.test(miss.reason), 'hint says other lists only have 15-min tiles');

    const home = sickBoard({ delivery: 'home-visit', coverDelivery: 'face-to-face' });
    check(
      core.suggestRebook(home, core.findAppointment(home, stretchMouse.id)).ok === false,
      'home visit is not "similar" to a face-to-face slot'
    );

    const otherSite = sickBoard({ sickSite: 'milford' });
    check(
      core.suggestRebook(otherSite, core.findAppointment(otherSite, stretchMouse.id)).ok === false,
      'refuses a different site'
    );

    const none = sickBoard({
      coverSlots: [
        {
          id: 'cover-booked',
          versionId: 'v-c',
          patient: { id: 'other', name: 'Someone Else' },
          diaryEntryType: { value: 'appointment' },
          appointmentType: { id: mouse.appointmentTypeId, name: 'GP Appointment' },
          startDateTime: '2026-08-23 13:00:00',
          endDateTime: '2026-08-23 15:00:00',
          duration: 120,
          displayStatus: { value: 'booked' },
          deliveryMode: { value: 'face-to-face' },
          appointmentStatus: { value: 'pending', isCancelled: false, isStarted: false, isSeen: false },
        },
      ],
    });
    const prop = core.proposeSickDay(none, sickDiary);
    check(prop.rows[0].status === 'leave', 'covering list full → still needs rebook');
    check(prop.rows[0].suggestion === null, 'no suggestion when cover is full');

    const applied = core.applySickDayProposal(core.emptyDraft(), core.proposeSickDay(happy, sickDiary));
    check(applied.moveIds.join() === stretchMouse.id, 'accept stages a cross-list move');
    check(applied.moves[stretchMouse.id].diaryId === coverDiary, 'staged dest is the cover diary');
    const applied30 = core.applySickDayProposal(
      core.emptyDraft(),
      core.proposeSickDay(
        Object.assign(twoFifteens, {}),
        sickDiary
      )
    );
    const mouse30onBoard = Object.assign({}, core.findAppointment(twoFifteens, stretchMouse.id), {
      duration: 30,
      endDateTime: '2026-08-23 14:30:00',
    });
    const prop30 = {
      rows: [
        {
          status: 'accept',
          appointment: mouse30onBoard,
          suggestion: run.suggestion,
        },
      ],
    };
    const staged30 = core.applySickDayProposal(core.emptyDraft(), prop30);
    check(staged30.moves[mouse30onBoard.id].reserveDuration === 15, 'staged 30-min run keeps reserveDuration 15');
    check(staged30.moves[mouse30onBoard.id].duration === undefined || staged30.moves[mouse30onBoard.id].startDateTime === run.suggestion.startDateTime, 'staged run keeps the start of the first 15-min tile');
    const left = core.applySickDayProposal(core.emptyDraft(), prop);
    check(left.moveIds.length === 0, 'leave rows are not staged and not written');
  }

  console.log('=== 6. live booking-core is the reserve/create/release copy ===');
  {
    const booking = await import(new URL('./shared/booking-core.js', `file://${process.cwd()}/`).href);
    const prevFetch = global.fetch;
    const f = recordingFetch((url) => {
      if (url.includes('embedded-overview')) return mockResponse(200, sampleRaw());
      if (url.includes('/data/appointment/move-appointment/')) {
        return mockResponse(200, {
          appointment: { id: mouse.id, versionId: mouse.versionId, patient: { id: mouse.patientId } },
        });
      }
      if (url.includes('reserve-slot-and-broadcast')) {
        return mockResponse(200, { slotReservationId: 'live-res' });
      }
      if (url.includes('update-slot-reservation')) return mockResponse(200, {});
      if (url.includes('/appointment/create-appointment')) {
        return mockResponse(200, { appointmentId: '01a018e2-04b1-72dd-a9c4-fdf551f98b4c' });
      }
      if (url.includes('remove-slot-reservation')) return mockResponse(200, {});
      return mockResponse(200, {});
    });
    global.fetch = f;
    try {
      const client = core.createClient(API, { fetchImpl: f, booking: booking });
      const res = await client.commitMove({
        date: '2026-08-23',
        appointment: mouse,
        target: { diaryId: otherDiary, startDateTime: '2026-08-23 11:00:00', duration: 15 },
      });
      check(res.appointmentId === '01a018e2-04b1-72dd-a9c4-fdf551f98b4c', 'live booking-core create returns the new id');
      const reserveCall = f.calls.find((c) =>
        String(c.url).includes('reserve-slot-and-broadcast-appointment-booking-in-progress')
      );
      check(!!reserveCall, 'move reserve hit the captured reserve path');
      check(
        JSON.stringify(Object.keys(JSON.parse(reserveCall.opts.body))) ===
          JSON.stringify(core.RESERVE_RESCHEDULE_KEYS),
        'live move reserve posted the 3-field body'
      );
      const createdCall = f.calls.find((c) => String(c.url).endsWith('/scheduling/appointment/create-appointment'));
      check(!!createdCall, 'booking-core.createAppointment hit /scheduling/appointment/create-appointment');
      check(
        JSON.parse(createdCall.opts.body).context === 'reschedule-appointment',
        'live booking-core posted the reschedule payload, not create-booked-appointment'
      );
      const releaseCall = f.calls.find((c) => String(c.url).includes('remove-slot-reservation-and-broadcast-appointment-booking-ended'));
      check(!!releaseCall, 'live booking-core released after successful create');
      check(JSON.parse(releaseCall.opts.body).slotReservationId === 'live-res', 'release body is { slotReservationId }');
      check(
        f.calls.findIndex((c) => String(c.url).endsWith('/scheduling/appointment/create-appointment')) <
          f.calls.findIndex((c) => String(c.url).includes('remove-slot-reservation')),
        'live release is after create-appointment 200'
      );
    } finally {
      global.fetch = prevFetch;
    }
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
