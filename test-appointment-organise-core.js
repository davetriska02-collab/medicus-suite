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

console.log('=== 2. draft stage / same-list blocked ===');
{
  const d0 = core.emptyDraft();
  check(core.hasDraftChanges(d0) === false, 'empty draft');
  const same = core.canStageMove(mouse, { diaryId: mouse.diaryId, startDateTime: '2026-08-23 10:30:00' });
  check(same.ok === false && same.reason === core.SAME_LIST_BLOCKED, 'same-list move blocked');
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
    check(booking.calls[0].fn === 'reserveSlot', 'move reserve goes through booking-core.reserveSlot');
    check(booking.calls[0].args.diaryId === otherDiary, 'reserveSlot diaryId is the target diary');
    check(booking.calls[0].args.duration === 15, 'reserveSlot duration is the target diary usual');
    check(booking.calls[1].fn === 'createAppointment', 'create goes through booking-core.createAppointment');
    const created = booking.calls[1].payload;
    check(created.context === 'reschedule-appointment', 'create context=reschedule-appointment');
    check(created.rescheduledAppointmentVersionId === mouse.versionId, 'create sends the pinned version id');
    check(created.bookingConfirmationRecipients.length === 0, 'create does not invent Send-to');
    const posts = f.calls.filter((c) => c.opts.method === 'POST').map((c) => c.url.replace(API, ''));
    check(posts.length === 1 && posts[0] === '/scheduling/slot-reservation/update-slot-reservation', 'organise-core POSTs only update-slot-reservation');
    check(!posts.some((p) => /move-appointment$/.test(p)), 'no POST …/move-appointment exists');
    check(!posts.some((p) => /cancel-appointment$/.test(p)), 'cross-list move is not cancel+create');
    const upd = JSON.parse(f.calls.find((c) => c.url.includes('update-slot-reservation')).opts.body);
    check(upd.intendedDuration === 60, 'update-slot-reservation uses the appointment duration');
    check(upd.rescheduledAppointmentId === mouse.id, 'update-slot-reservation sets rescheduledAppointmentId');
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
          target: { diaryId: mouse.diaryId, startDateTime: '2026-08-23 10:30:00', duration: 15 },
        }),
      'Same-list',
      'commitMove refuses same-list even if the UI asked'
    );
    check(f.calls.length === 0, 'same-list refusal is before any fetch');
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
      check(
        f.calls.some((c) => String(c.url).includes('reserve-slot-and-broadcast-appointment-booking-in-progress')),
        'booking-core.reserveSlot hit the captured reserve path'
      );
      const createdCall = f.calls.find((c) => String(c.url).endsWith('/scheduling/appointment/create-appointment'));
      check(!!createdCall, 'booking-core.createAppointment hit /scheduling/appointment/create-appointment');
      check(
        JSON.parse(createdCall.opts.body).context === 'reschedule-appointment',
        'live booking-core posted the reschedule payload, not create-booked-appointment'
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
