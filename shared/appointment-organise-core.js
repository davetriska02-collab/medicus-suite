// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — appointment organise core (cancel + cross-list reschedule).
//
// Contract: docs/learnings-appointment-organise-api.md (live capture 2026-08-19,
// dummy patient Mr Micky Mouse, Sunday 2026-08-23). Paths and payload keys are
// byte-for-byte what chBook recorded. Do not tidy them.
//
// booking-core.js stays the create/reserve/release copy used by Slots / W12.
// This file owns the mutate family only:
//   POST /scheduling/appointment/cancel-appointment
//   POST /scheduling/slot-reservation/update-slot-reservation  (rescheduledAppointmentId set)
//   POST /scheduling/appointment/create-appointment           (context=reschedule-appointment)
//   POST /scheduling/slot-reservation/reserve-slot-…          (move-capture body: 3 fields)
// Same-list move and extend are BLOCKED — no write slug was captured.
//
// Dual-mode: module.exports for Node tests, window.AppointmentOrganiseCore
// for the appointment-book content script. No ES export (classic-script safe).
// The core never self-detects a patient or a site (H-043).

(function (global) {
  'use strict';

  var PATHS = {
    overview: '/scheduling/data/appointment-book/embedded-overview',
    cancelForm: '/scheduling/data/appointment/cancel-appointment/',
    cancelWrite: '/scheduling/appointment/cancel-appointment',
    moveForm: '/scheduling/data/appointment/move-appointment/',
    reserve: '/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress',
    updateReservation: '/scheduling/slot-reservation/update-slot-reservation',
    createAppointment: '/scheduling/appointment/create-appointment',
    releaseReservation:
      '/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended',
  };

  // Captured POST /scheduling/appointment/cancel-appointment body (01-cancel.json).
  var CANCEL_PAYLOAD_KEYS = [
    'targetAppointmentId',
    'otherAppointmentIds',
    'cancellationReason',
    'cancellationConfirmationRecipients',
  ];

  // Captured POST reserve during cross-list move (03-move-cross-list.json) —
  // three fields only. Do not send booking-core's substituteSlotFilters body.
  var RESERVE_RESCHEDULE_KEYS = ['diaryId', 'intendedStartDateTime', 'intendedDuration'];

  // Captured POST update-slot-reservation during cross-list move.
  var UPDATE_RESERVATION_KEYS = [
    'slotReservationId',
    'diaryId',
    'rescheduledAppointmentId',
    'intendedStartDateTime',
    'intendedDuration',
    'allowOverlappingAppointments',
  ];

  // Captured POST create-appointment with context=reschedule-appointment.
  // Not the booking-core create-booked-appointment key list.
  var RESCHEDULE_CREATE_KEYS = [
    'context',
    'appointmentTemporalType',
    'allowOverlappingAppointments',
    'patientId',
    'rescheduledAppointmentId',
    'rescheduledAppointmentVersionId',
    'reasonForAppointment',
    'additionalInformation',
    'deliveryMode',
    'nhsNationalSlotTypeCategory',
    'isHiddenFromPatientFacingServices',
    'slotReservationId',
    'diaryId',
    'queueId',
    'intendedStartDateTime',
    'intendedDuration',
    'embargoOverrideReason',
    'bookingConfirmationRecipients',
    'followingSlotConvertToBreak',
    'followingSlotNewAppointmentTypeId',
    'followingSlotStartDateTime',
    'followingSlotEndDateTime',
  ];

  var SAME_LIST_BLOCKED =
    'Same-list move is not in the captured contract (no POST). Drop onto another diary.';
  var EXTEND_BLOCKED = 'Extend is not in the captured contract (no duration write).';
  var ARRIVED_LOCKED = 'Arrived / in-progress appointments cannot be organised from this board.';
  var CANCELLED_EXCLUDED = 'Cancelled appointments are excluded from the board.';

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function dateFromQuery(search) {
    var m = /(?:^|[?&])date=(\d{4}-\d{2}-\d{2})/.exec(String(search || ''));
    return m ? m[1] : null;
  }

  function parseBookRoute(pathname, search) {
    var path = String(pathname || '');
    var m = path.match(/\/([0-9a-f]{4,})\/scheduling\/(appointment-book|homepage)/i);
    if (!m) return null;
    var tab = /(?:^|[?&])tab=([^&]+)/.exec(String(search || ''));
    var tabVal = tab ? decodeURIComponent(tab[1]) : '';
    if (m[2] === 'homepage' && tabVal !== 'appointment-book') return null;
    return {
      siteId: m[1],
      date: dateFromQuery(search) || todayISO(),
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
    };
  }

  function statusValue(entry) {
    return String((entry && entry.displayStatus && entry.displayStatus.value) || '').toLowerCase();
  }

  function appointmentStatus(entry) {
    return (entry && entry.appointmentStatus) || {};
  }

  function isCancelled(entry) {
    if (statusValue(entry) === 'cancelled') return true;
    var st = appointmentStatus(entry);
    return !!(st.isCancelled || String(st.value || '').toLowerCase() === 'cancelled');
  }

  function isArrived(entry) {
    if (statusValue(entry) === 'arrived') return true;
    if (entry && entry.arrivalStatus) return true;
    if (entry && entry.arrivedDateTime) return true;
    var st = appointmentStatus(entry);
    return !!(st.isStarted || st.isSeen);
  }

  function isLocked(entry) {
    return isArrived(entry) || !!(appointmentStatus(entry).isDidNotAttend);
  }

  function entryType(entry) {
    return String((entry && entry.diaryEntryType && entry.diaryEntryType.value) || '');
  }

  function mapAppointment(entry, column) {
    if (!entry || entryType(entry) !== 'appointment') return null;
    if (isCancelled(entry)) return null;
    var patient = entry.patient || {};
    return {
      id: entry.id || null,
      versionId: entry.versionId || null,
      patientId: patient.id || null,
      patientName: patient.name || 'Unknown',
      diaryId: column.diaryId,
      staffName: column.staffName,
      startDateTime: entry.startDateTime || '',
      endDateTime: entry.endDateTime || '',
      duration: Number(entry.duration) || 0,
      appointmentTypeId: (entry.appointmentType && entry.appointmentType.id) || null,
      appointmentTypeName: (entry.appointmentType && entry.appointmentType.name) || '',
      deliveryMode: (entry.deliveryMode && entry.deliveryMode.value) || column.defaultDeliveryMode || 'face-to-face',
      nhsNationalSlotTypeCategory: column.nhsNationalSlotTypeCategory || '10127',
      reason: entry.compiledReasonForAppointment || '',
      additionalInformation: entry.additionalInformation || null,
      isHiddenFromPatientFacingServices: !!entry.isHiddenFromPatientFacingServices,
      displayStatus: statusValue(entry) || 'booked',
      arrived: isArrived(entry),
      locked: isLocked(entry),
    };
  }

  function mapSlot(entry, column) {
    if (!entry || entryType(entry) !== 'slot') return null;
    return {
      diaryId: column.diaryId,
      staffName: column.staffName,
      startDateTime: entry.startDateTime || '',
      endDateTime: entry.endDateTime || '',
      duration: Number(entry.duration) || column.usualDuration || 0,
    };
  }

  function sessionColumn(staffName, staffId, session) {
    var summary = (session && session.summary) || {};
    var cat = summary.nhsNationalSlotTypeCategoryDefault || {};
    var delivery = summary.defaultDeliveryMode || {};
    var column = {
      staffName: staffName || 'Unknown',
      staffId: staffId || null,
      diaryId: session && session.id,
      sessionStart: session && session.startDateTime,
      sessionEnd: session && session.endDateTime,
      usualDuration: Number(summary.usualAppointmentDuration) || 0,
      nhsNationalSlotTypeCategory: cat.value || '10127',
      defaultDeliveryMode: delivery.value || 'face-to-face',
      cancelledSession: !!(summary.status && summary.status.isCancelled),
      appointments: [],
      slots: [],
    };
    if (column.cancelledSession) return column;
    (session && session.entries ? session.entries : []).forEach(function (entry) {
      var appt = mapAppointment(entry, column);
      if (appt) {
        column.appointments.push(appt);
        return;
      }
      var slot = mapSlot(entry, column);
      if (slot) column.slots.push(slot);
    });
    // Empty diary still needs a drop target (captured cross-list pick was 11:00
    // on a Sunday dummy that had no remaining slot-entries).
    if (!column.slots.length && column.sessionStart && !column.appointments.length) {
      column.slots.push({
        diaryId: column.diaryId,
        staffName: column.staffName,
        startDateTime: column.sessionStart,
        endDateTime: column.sessionEnd,
        duration: column.usualDuration || 0,
        synthetic: true,
      });
    }
    return column;
  }

  function parseBoard(raw) {
    var columns = [];
    var date = (raw && raw.date) || null;
    (raw && raw.staffSchedules ? raw.staffSchedules : []).forEach(function (staff) {
      var name = staff && staff.name ? staff.name : 'Unknown clinician';
      (staff && staff.schedule ? staff.schedule : []).forEach(function (session) {
        if (!session || session.scheduleType === 'unavailability-period') return;
        columns.push(sessionColumn(name, staff.id || null, session));
      });
    });
    (raw && raw.unassignedDiaries ? raw.unassignedDiaries : []).forEach(function (session) {
      columns.push(sessionColumn('Unassigned', null, session));
    });
    return { date: date, columns: columns.filter(function (c) { return c.diaryId; }) };
  }

  function allAppointments(board) {
    var out = [];
    ((board && board.columns) || []).forEach(function (col) {
      (col.appointments || []).forEach(function (a) {
        out.push(a);
      });
    });
    return out;
  }

  function findAppointment(board, appointmentId) {
    var list = allAppointments(board);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === appointmentId) return list[i];
    }
    return null;
  }

  function emptyDraft() {
    return { cancelIds: [], cancels: {}, moveIds: [], moves: {} };
  }

  function cloneDraft(draft) {
    var src = draft || emptyDraft();
    return {
      cancelIds: (src.cancelIds || []).slice(),
      cancels: JSON.parse(JSON.stringify(src.cancels || {})),
      moveIds: (src.moveIds || []).slice(),
      moves: JSON.parse(JSON.stringify(src.moves || {})),
    };
  }

  function hasDraftChanges(draft) {
    return !!(draft && ((draft.cancelIds && draft.cancelIds.length) || (draft.moveIds && draft.moveIds.length)));
  }

  function canStageMove(appointment, target) {
    if (!appointment || !appointment.id) return { ok: false, reason: 'Missing appointment.' };
    if (appointment.locked || appointment.arrived) return { ok: false, reason: ARRIVED_LOCKED };
    if (!target || !target.diaryId || !target.startDateTime) {
      return { ok: false, reason: 'Drop onto a free slot on another diary.' };
    }
    if (target.diaryId === appointment.diaryId) return { ok: false, reason: SAME_LIST_BLOCKED };
    return { ok: true, reason: null };
  }

  function canStageCancel(appointment) {
    if (!appointment || !appointment.id) return { ok: false, reason: 'Missing appointment.' };
    if (appointment.locked || appointment.arrived) return { ok: false, reason: ARRIVED_LOCKED };
    return { ok: true, reason: null };
  }

  function stageCancel(draft, appointmentId) {
    var next = cloneDraft(draft);
    if (!appointmentId) return next;
    next.moveIds = (next.moveIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.moves[appointmentId];
    if (next.cancelIds.indexOf(appointmentId) === -1) next.cancelIds.push(appointmentId);
    if (!next.cancels[appointmentId]) {
      next.cancels[appointmentId] = { reason: '', included: true };
    }
    return next;
  }

  function unstageCancel(draft, appointmentId) {
    var next = cloneDraft(draft);
    next.cancelIds = next.cancelIds.filter(function (id) {
      return id !== appointmentId;
    });
    delete next.cancels[appointmentId];
    return next;
  }

  function setCancelReason(draft, appointmentId, reason) {
    var next = cloneDraft(draft);
    if (next.cancelIds.indexOf(appointmentId) === -1) return next;
    next.cancels[appointmentId] = Object.assign({}, next.cancels[appointmentId] || {}, {
      reason: String(reason || ''),
    });
    return next;
  }

  function setDraftIncluded(draft, appointmentId, included) {
    var next = cloneDraft(draft);
    if (next.cancels[appointmentId]) {
      next.cancels[appointmentId] = Object.assign({}, next.cancels[appointmentId], { included: !!included });
    }
    if (next.moves[appointmentId]) {
      next.moves[appointmentId] = Object.assign({}, next.moves[appointmentId], { included: !!included });
    }
    return next;
  }

  function stageMove(draft, appointmentId, target) {
    var next = cloneDraft(draft);
    if (!appointmentId || !target) return next;
    next.cancelIds = (next.cancelIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.cancels[appointmentId];
    if (next.moveIds.indexOf(appointmentId) === -1) next.moveIds.push(appointmentId);
    next.moves[appointmentId] = {
      diaryId: target.diaryId,
      startDateTime: target.startDateTime,
      staffName: target.staffName || '',
      reserveDuration: Number(target.duration) || 0,
      included: true,
    };
    return next;
  }

  function unstageMove(draft, appointmentId) {
    var next = cloneDraft(draft);
    next.moveIds = next.moveIds.filter(function (id) {
      return id !== appointmentId;
    });
    delete next.moves[appointmentId];
    return next;
  }

  function hhmm(dt) {
    var s = String(dt || '');
    return s.length >= 16 ? s.slice(11, 16) : s;
  }

  function summariseDraft(draft, board) {
    var items = [];
    ((draft && draft.cancelIds) || []).forEach(function (id) {
      var appt = findAppointment(board, id) || { id: id, patientName: id, startDateTime: '', staffName: '' };
      var row = (draft.cancels && draft.cancels[id]) || { reason: '', included: true };
      items.push({
        kind: 'cancel',
        id: id,
        included: row.included !== false,
        reason: row.reason || '',
        patientName: appt.patientName,
        text:
          'Cancel ' +
          appt.patientName +
          ', ' +
          hhmm(appt.startDateTime) +
          ' ' +
          (appt.staffName || '') +
          ' — Medicus will not send a cancellation message',
      });
    });
    ((draft && draft.moveIds) || []).forEach(function (id) {
      var appt = findAppointment(board, id) || { id: id, patientName: id, startDateTime: '', staffName: '' };
      var mv = (draft.moves && draft.moves[id]) || {};
      items.push({
        kind: 'move',
        id: id,
        included: mv.included !== false,
        patientName: appt.patientName,
        text:
          'Move ' +
          appt.patientName +
          ', ' +
          hhmm(appt.startDateTime) +
          ' ' +
          (appt.staffName || '') +
          ' → ' +
          hhmm(mv.startDateTime) +
          ' ' +
          (mv.staffName || '') +
          ' — Medicus will not send a booking message',
      });
    });
    var included = items.filter(function (i) {
      return i.included;
    });
    return { items: items, count: included.length };
  }

  function applyDraftToBoard(board, draft) {
    var nextCols = ((board && board.columns) || []).map(function (col) {
      return {
        staffName: col.staffName,
        staffId: col.staffId,
        diaryId: col.diaryId,
        sessionStart: col.sessionStart,
        sessionEnd: col.sessionEnd,
        usualDuration: col.usualDuration,
        nhsNationalSlotTypeCategory: col.nhsNationalSlotTypeCategory,
        defaultDeliveryMode: col.defaultDeliveryMode,
        cancelledSession: col.cancelledSession,
        appointments: (col.appointments || []).slice(),
        slots: (col.slots || []).slice(),
      };
    });
    var byId = {};
    nextCols.forEach(function (col) {
      col.appointments.forEach(function (a) {
        byId[a.id] = a;
      });
    });
    ((draft && draft.cancelIds) || []).forEach(function (id) {
      nextCols.forEach(function (col) {
        col.appointments = col.appointments.filter(function (a) {
          return a.id !== id;
        });
      });
    });
    ((draft && draft.moveIds) || []).forEach(function (id) {
      var mv = draft.moves[id];
      var appt = byId[id];
      if (!mv || !appt) return;
      nextCols.forEach(function (col) {
        col.appointments = col.appointments.filter(function (a) {
          return a.id !== id;
        });
      });
      var dest = null;
      nextCols.forEach(function (col) {
        if (col.diaryId === mv.diaryId) dest = col;
      });
      if (dest) {
        dest.appointments.push(
          Object.assign({}, appt, {
            diaryId: mv.diaryId,
            staffName: dest.staffName,
            startDateTime: mv.startDateTime,
            stagedMove: true,
          })
        );
        dest.slots = dest.slots.filter(function (s) {
          return s.startDateTime !== mv.startDateTime;
        });
      }
    });
    return { date: board && board.date, columns: nextCols };
  }

  function keysOf(obj) {
    return Object.keys(obj);
  }

  function buildCancelPayload(opts) {
    opts = opts || {};
    if (!opts.appointmentId) throw new Error('appointment-organise: targetAppointmentId required');
    var reason = String(opts.reason || '').trim();
    if (!reason) throw new Error('appointment-organise: cancellationReason required');
    return {
      targetAppointmentId: opts.appointmentId,
      otherAppointmentIds: [],
      cancellationReason: reason,
      cancellationConfirmationRecipients: [],
    };
  }

  function buildReserveReschedulePayload(opts) {
    opts = opts || {};
    if (!opts.diaryId) throw new Error('appointment-organise: diaryId required');
    if (!opts.startDateTime) throw new Error('appointment-organise: intendedStartDateTime required');
    var duration = Number(opts.intendedDuration);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('appointment-organise: intendedDuration required');
    }
    return {
      diaryId: opts.diaryId,
      intendedStartDateTime: opts.startDateTime,
      intendedDuration: duration,
    };
  }

  function buildUpdateReservationPayload(opts) {
    opts = opts || {};
    if (!opts.slotReservationId) throw new Error('appointment-organise: slotReservationId required');
    if (!opts.diaryId) throw new Error('appointment-organise: diaryId required');
    if (!opts.appointmentId) throw new Error('appointment-organise: rescheduledAppointmentId required');
    return {
      slotReservationId: opts.slotReservationId,
      diaryId: opts.diaryId,
      rescheduledAppointmentId: opts.appointmentId,
      intendedStartDateTime: opts.startDateTime,
      intendedDuration: Number(opts.intendedDuration),
      allowOverlappingAppointments: 'allow',
    };
  }

  function buildRescheduleCreatePayload(opts) {
    opts = opts || {};
    if (!opts.patientId) throw new Error('appointment-organise: explicit patientId required');
    if (!opts.appointmentId) throw new Error('appointment-organise: rescheduledAppointmentId required');
    if (!opts.versionId) throw new Error('appointment-organise: rescheduledAppointmentVersionId required');
    if (!opts.slotReservationId) throw new Error('appointment-organise: slotReservationId required');
    return {
      context: 'reschedule-appointment',
      appointmentTemporalType: 'timed',
      allowOverlappingAppointments: 'allow',
      patientId: opts.patientId,
      rescheduledAppointmentId: opts.appointmentId,
      rescheduledAppointmentVersionId: opts.versionId,
      reasonForAppointment: opts.reasonForAppointment == null ? null : opts.reasonForAppointment,
      additionalInformation: opts.additionalInformation == null ? null : opts.additionalInformation,
      deliveryMode: opts.deliveryMode || 'face-to-face',
      nhsNationalSlotTypeCategory: opts.nhsNationalSlotTypeCategory || '10127',
      isHiddenFromPatientFacingServices: !!opts.isHiddenFromPatientFacingServices,
      slotReservationId: opts.slotReservationId,
      diaryId: opts.diaryId,
      queueId: null,
      intendedStartDateTime: opts.startDateTime,
      intendedDuration: Number(opts.intendedDuration),
      embargoOverrideReason: null,
      bookingConfirmationRecipients: [],
      followingSlotConvertToBreak: null,
      followingSlotNewAppointmentTypeId: null,
      followingSlotStartDateTime: null,
      followingSlotEndDateTime: null,
    };
  }

  function driftMessage(kind) {
    return (
      'The appointment changed in Medicus before commit (' +
      kind +
      ') — that action was not written. Refresh and try again.'
    );
  }

  function verifyAgainstBoard(liveAppt, pinned) {
    pinned = pinned || {};
    if (!liveAppt) return { ok: false, reason: driftMessage('missing') };
    if (pinned.patientId && liveAppt.patientId !== pinned.patientId) {
      return { ok: false, reason: driftMessage('patient') };
    }
    if (pinned.appointmentId && liveAppt.id !== pinned.appointmentId) {
      return { ok: false, reason: driftMessage('id') };
    }
    if (pinned.versionId && liveAppt.versionId !== pinned.versionId) {
      return { ok: false, reason: driftMessage('version') };
    }
    if (liveAppt.arrived || liveAppt.locked) return { ok: false, reason: ARRIVED_LOCKED };
    if (isCancelled(liveAppt)) return { ok: false, reason: CANCELLED_EXCLUDED };
    return { ok: true, reason: null };
  }

  function verifyMoveForm(form, pinned) {
    pinned = pinned || {};
    var appt = (form && form.appointment) || {};
    if (pinned.appointmentId && appt.id !== pinned.appointmentId) {
      return { ok: false, reason: driftMessage('id') };
    }
    if (pinned.versionId && appt.versionId !== pinned.versionId) {
      return { ok: false, reason: driftMessage('version') };
    }
    var patient = appt.patient || {};
    if (pinned.patientId && patient.id !== pinned.patientId) {
      return { ok: false, reason: driftMessage('patient') };
    }
    return { ok: true, reason: null };
  }

  async function apiFetch(url, opts, fetchImpl) {
    opts = opts || {};
    var fn = fetchImpl || fetch;
    var resp = await fn(url, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
      body: opts.body,
      keepalive: !!opts.keepalive,
    });
    if (!resp.ok) {
      var err = new Error('HTTP ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Scheduling API returned an unexpected response.');
    }
  }

  function createClient(apiBase, deps) {
    deps = deps || {};
    var fetchImpl = deps.fetchImpl;
    if (!apiBase) throw new Error('appointment-organise: apiBase required');

    function url(path) {
      return String(apiBase).replace(/\/$/, '') + path;
    }

    async function fetchBoard(date) {
      var qs = new URLSearchParams({
        date: date,
        filterByUsualLocation: 'false',
      });
      var raw = await apiFetch(url(PATHS.overview + '?' + qs), {}, fetchImpl);
      return parseBoard(raw);
    }

    async function fetchCancelForm(appointmentId) {
      return apiFetch(url(PATHS.cancelForm + encodeURIComponent(appointmentId)), {}, fetchImpl);
    }

    async function fetchMoveForm(appointmentId) {
      return apiFetch(
        url(PATHS.moveForm + encodeURIComponent(appointmentId) + '?moveType=to-another-diary'),
        {},
        fetchImpl
      );
    }

    async function cancelAppointment(payload) {
      if (!payload || !payload.targetAppointmentId) {
        throw new Error('appointment-organise: targetAppointmentId required');
      }
      return apiFetch(
        url(PATHS.cancelWrite),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        fetchImpl
      );
    }

    async function reserveForReschedule(payload) {
      return apiFetch(
        url(PATHS.reserve),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        fetchImpl
      );
    }

    async function updateSlotReservation(payload) {
      return apiFetch(
        url(PATHS.updateReservation),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        fetchImpl
      );
    }

    async function createRescheduleAppointment(payload) {
      if (!payload || !payload.patientId) {
        throw new Error('appointment-organise: explicit patientId required');
      }
      return apiFetch(
        url(PATHS.createAppointment),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        fetchImpl
      );
    }

    async function releaseReservation(slotReservationId) {
      if (!slotReservationId) return;
      try {
        await apiFetch(
          url(PATHS.releaseReservation),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotReservationId: slotReservationId }),
            keepalive: true,
          },
          fetchImpl
        );
      } catch (_) {}
    }

    async function commitCancel(opts) {
      opts = opts || {};
      var pinned = opts.pinned || {};
      if (pinned.apiBase && pinned.apiBase !== apiBase) {
        throw new Error(driftMessage('site'));
      }
      if (!opts.patientId) throw new Error('appointment-organise: explicit patientId required');
      var board = await fetchBoard(opts.date);
      var live = findAppointment(board, opts.appointmentId);
      var check = verifyAgainstBoard(
        live,
        Object.assign({ patientId: opts.patientId, appointmentId: opts.appointmentId }, pinned)
      );
      if (!check.ok) throw new Error(check.reason);
      var form = await fetchCancelForm(opts.appointmentId);
      if (form && form.targetAppointmentId && form.targetAppointmentId !== opts.appointmentId) {
        throw new Error(driftMessage('id'));
      }
      var payload = buildCancelPayload({ appointmentId: opts.appointmentId, reason: opts.reason });
      return cancelAppointment(payload);
    }

    async function commitMove(opts) {
      opts = opts || {};
      var pinned = opts.pinned || {};
      var appointment = opts.appointment;
      var target = opts.target;
      if (!appointment || !appointment.patientId) {
        throw new Error('appointment-organise: explicit patientId required');
      }
      if (pinned.apiBase && pinned.apiBase !== apiBase) {
        throw new Error(driftMessage('site'));
      }
      var gate = canStageMove(appointment, target);
      if (!gate.ok) throw new Error(gate.reason);
      var board = await fetchBoard(opts.date);
      var live = findAppointment(board, appointment.id);
      var boardCheck = verifyAgainstBoard(live, {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        versionId: appointment.versionId,
      });
      if (!boardCheck.ok) throw new Error(boardCheck.reason);
      var form = await fetchMoveForm(appointment.id);
      var formCheck = verifyMoveForm(form, {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        versionId: appointment.versionId,
      });
      if (!formCheck.ok) throw new Error(formCheck.reason);
      var reserveDuration = Number(target.reserveDuration) || Number(target.duration) || appointment.duration;
      var reservationId = null;
      try {
        var reserved = await reserveForReschedule(
          buildReserveReschedulePayload({
            diaryId: target.diaryId,
            startDateTime: target.startDateTime,
            intendedDuration: reserveDuration,
          })
        );
        reservationId = reserved && reserved.slotReservationId;
        if (!reservationId) throw new Error('appointment-organise: reserve returned no slotReservationId');
        await updateSlotReservation(
          buildUpdateReservationPayload({
            slotReservationId: reservationId,
            diaryId: target.diaryId,
            appointmentId: appointment.id,
            startDateTime: target.startDateTime,
            intendedDuration: appointment.duration,
          })
        );
        return await createRescheduleAppointment(
          buildRescheduleCreatePayload({
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            versionId: appointment.versionId,
            slotReservationId: reservationId,
            diaryId: target.diaryId,
            startDateTime: target.startDateTime,
            intendedDuration: appointment.duration,
            deliveryMode: appointment.deliveryMode,
            nhsNationalSlotTypeCategory: appointment.nhsNationalSlotTypeCategory,
            reasonForAppointment: appointment.reason || null,
            additionalInformation: appointment.additionalInformation,
            isHiddenFromPatientFacingServices: appointment.isHiddenFromPatientFacingServices,
          })
        );
      } catch (err) {
        if (reservationId) await releaseReservation(reservationId);
        throw err;
      }
    }

    return {
      fetchBoard: fetchBoard,
      fetchCancelForm: fetchCancelForm,
      fetchMoveForm: fetchMoveForm,
      cancelAppointment: cancelAppointment,
      reserveForReschedule: reserveForReschedule,
      updateSlotReservation: updateSlotReservation,
      createRescheduleAppointment: createRescheduleAppointment,
      releaseReservation: releaseReservation,
      commitCancel: commitCancel,
      commitMove: commitMove,
    };
  }

  var api = {
    PATHS: PATHS,
    CANCEL_PAYLOAD_KEYS: CANCEL_PAYLOAD_KEYS,
    RESERVE_RESCHEDULE_KEYS: RESERVE_RESCHEDULE_KEYS,
    UPDATE_RESERVATION_KEYS: UPDATE_RESERVATION_KEYS,
    RESCHEDULE_CREATE_KEYS: RESCHEDULE_CREATE_KEYS,
    SAME_LIST_BLOCKED: SAME_LIST_BLOCKED,
    EXTEND_BLOCKED: EXTEND_BLOCKED,
    ARRIVED_LOCKED: ARRIVED_LOCKED,
    parseBookRoute: parseBookRoute,
    parseBoard: parseBoard,
    allAppointments: allAppointments,
    findAppointment: findAppointment,
    isCancelled: isCancelled,
    isArrived: isArrived,
    isLocked: isLocked,
    emptyDraft: emptyDraft,
    cloneDraft: cloneDraft,
    hasDraftChanges: hasDraftChanges,
    canStageMove: canStageMove,
    canStageCancel: canStageCancel,
    stageCancel: stageCancel,
    unstageCancel: unstageCancel,
    setCancelReason: setCancelReason,
    setDraftIncluded: setDraftIncluded,
    stageMove: stageMove,
    unstageMove: unstageMove,
    summariseDraft: summariseDraft,
    applyDraftToBoard: applyDraftToBoard,
    buildCancelPayload: buildCancelPayload,
    buildReserveReschedulePayload: buildReserveReschedulePayload,
    buildUpdateReservationPayload: buildUpdateReservationPayload,
    buildRescheduleCreatePayload: buildRescheduleCreatePayload,
    verifyAgainstBoard: verifyAgainstBoard,
    verifyMoveForm: verifyMoveForm,
    keysOf: keysOf,
    createClient: createClient,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AppointmentOrganiseCore = api;
  }
})(typeof self !== 'undefined' ? self : this);
