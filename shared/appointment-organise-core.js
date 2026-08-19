// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — appointment organise core (cancel + same-list + cross-list).
//
// Contract: docs/learnings-appointment-organise-api.md (live capture 2026-08-19,
// dummy patient Mr Micky Mouse, Sunday 2026-08-23). Paths and payload keys are
// byte-for-byte what chBook recorded. Do not tidy them.
//
// booking-core.js is the ONE create-appointment / release copy.
// Move reserve is the captured 3-field POST (no substituteSlotFilters).
// This file owns cancel + move orchestration:
//   GET  /scheduling/data/appointment/appointment-overview/{id}
//   GET  /scheduling/data/appointment/cancel-appointment/{id}
//   POST /scheduling/appointment/cancel-appointment
//   GET  /scheduling/data/appointment/move-appointment/{id}?moveType=to-same-diary|to-another-diary
//   POST reserve (3 fields) → optional update-slot-reservation (cross-list only)
//     → booking-core.createAppointment(context=reschedule-appointment) → release
// Extend is BLOCKED — change-appointment was only seen in a Vue template.
//
// Dual-mode: module.exports for Node tests, window.AppointmentOrganiseCore
// for the appointment-book content script. No ES export (classic-script safe).
// The core never self-detects a patient or a site (H-043).

(function (global) {
  'use strict';

  var PATHS = {
    overview: '/scheduling/data/appointment-book/embedded-overview',
    appointmentOverview: '/scheduling/data/appointment/appointment-overview/',
    cancelForm: '/scheduling/data/appointment/cancel-appointment/',
    cancelWrite: '/scheduling/appointment/cancel-appointment',
    moveForm: '/scheduling/data/appointment/move-appointment/',
    updateReservation: '/scheduling/slot-reservation/update-slot-reservation',
    reserve: '/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress',
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

  // Stretch update-slot-reservation (Test B) minus allowOverlappingAppointments.
  var STRETCH_UPDATE_KEYS = [
    'slotReservationId',
    'diaryId',
    'rescheduledAppointmentId',
    'intendedStartDateTime',
    'intendedDuration',
  ];

  // Stretch create-appointment (Test B) is create-booked-appointment, not reschedule.
  // allowOverlappingAppointments is omitted — Test A overlapped the neighbour when it was "allow".
  var STRETCH_CREATE_KEYS = [
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
    'gpadReportingExceptionReasons',
    'clinicalCaseId',
    'bookingConfirmationRecipients',
    'followingSlotConvertToBreak',
    'followingSlotNewAppointmentTypeId',
    'followingSlotStartDateTime',
    'followingSlotEndDateTime',
    'rescheduledAppointmentVersionId',
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

  var EXTEND_BLOCKED = 'Extend is not in the captured contract (no duration write).';
  var SAME_SLOT = 'Drop onto a different free slot.';
  var DURATION_LOCKED =
    'Move must keep the booking length. Cancel-then-create at 30 min overlapped the neighbour (TEST A).';
  var STRETCH_NEIGHBOUR_BOOKED =
    'Cannot stretch: the following slot is booked. Snap back — nothing staged.';
  var STRETCH_CANCEL_REASON = 'Stretched on organise canvas';
  var STRETCH_STEP_MINUTES = 15;
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
      siteId: column.siteId || null,
      siteName: column.siteName || '',
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
      appointmentTypeId: (entry.appointmentType && entry.appointmentType.id) || column.defaultAppointmentTypeId || null,
      deliveryMode: (entry.defaultDeliveryMode && entry.defaultDeliveryMode.value) || column.defaultDeliveryMode || null,
      siteId: column.siteId || null,
    };
  }

  function sessionColumn(staffName, staffId, session) {
    var summary = (session && session.summary) || {};
    var cat = summary.nhsNationalSlotTypeCategoryDefault || {};
    var delivery = summary.defaultDeliveryMode || {};
    var site = summary.site || {};
    var defType = summary.defaultAppointmentType || {};
    var column = {
      staffName: staffName || 'Unknown',
      staffId: staffId || null,
      diaryId: session && session.id,
      sessionStart: session && session.startDateTime,
      sessionEnd: session && session.endDateTime,
      usualDuration: Number(summary.usualAppointmentDuration) || 0,
      nhsNationalSlotTypeCategory: cat.value || '10127',
      defaultDeliveryMode: delivery.value || 'face-to-face',
      defaultAppointmentTypeId: defType.id || null,
      siteId: site.id || null,
      siteName: site.name || '',
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
        appointmentTypeId: column.defaultAppointmentTypeId,
        deliveryMode: column.defaultDeliveryMode,
        siteId: column.siteId,
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
    return { cancelIds: [], cancels: {}, moveIds: [], moves: {}, stretchIds: [], stretches: {} };
  }

  function cloneDraft(draft) {
    var src = draft || emptyDraft();
    return {
      cancelIds: (src.cancelIds || []).slice(),
      cancels: JSON.parse(JSON.stringify(src.cancels || {})),
      moveIds: (src.moveIds || []).slice(),
      moves: JSON.parse(JSON.stringify(src.moves || {})),
      stretchIds: (src.stretchIds || []).slice(),
      stretches: JSON.parse(JSON.stringify(src.stretches || {})),
    };
  }

  function hasDraftChanges(draft) {
    return !!(
      draft &&
      ((draft.cancelIds && draft.cancelIds.length) ||
        (draft.moveIds && draft.moveIds.length) ||
        (draft.stretchIds && draft.stretchIds.length))
    );
  }

  function canStageMove(appointment, target) {
    if (!appointment || !appointment.id) return { ok: false, reason: 'Missing appointment.' };
    if (appointment.locked || appointment.arrived) return { ok: false, reason: ARRIVED_LOCKED };
    if (!target || !target.diaryId || !target.startDateTime) {
      return { ok: false, reason: 'Drop onto a free slot.' };
    }
    if (target.diaryId === appointment.diaryId && target.startDateTime === appointment.startDateTime) {
      return { ok: false, reason: SAME_SLOT };
    }
    return { ok: true, reason: null };
  }

  function moveTypeFor(appointment, target) {
    return target && appointment && target.diaryId === appointment.diaryId ? 'to-same-diary' : 'to-another-diary';
  }

  function isCrossListMove(appointment, target) {
    return !!(appointment && target && target.diaryId && target.diaryId !== appointment.diaryId);
  }

  function moveDuration(appointment) {
    var n = Number(appointment && appointment.duration);
    if (!Number.isFinite(n) || n <= 0) throw new Error(DURATION_LOCKED);
    return n;
  }

  function parseDt(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  }

  function formatDt(d) {
    return (
      d.getFullYear() +
      '-' +
      pad(d.getMonth() + 1) +
      '-' +
      pad(d.getDate()) +
      ' ' +
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes()) +
      ':' +
      pad(d.getSeconds())
    );
  }

  function addMinutes(s, mins) {
    var d = parseDt(s);
    if (!d) return s;
    d.setMinutes(d.getMinutes() + Number(mins) || 0);
    return formatDt(d);
  }

  function intervalOverlaps(aStart, aEnd, bStart, bEnd) {
    var a0 = parseDt(aStart);
    var a1 = parseDt(aEnd);
    var b0 = parseDt(bStart);
    var b1 = parseDt(bEnd);
    if (!a0 || !a1 || !b0 || !b1) return false;
    return a0 < b1 && b0 < a1;
  }

  function findColumn(board, diaryId) {
    var cols = (board && board.columns) || [];
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].diaryId === diaryId) return cols[i];
    }
    return null;
  }

  function followingSlotsFree(board, appointment, newDuration) {
    if (!appointment || !board) return false;
    var keep = Number(appointment.duration);
    var next = Number(newDuration);
    if (!Number.isFinite(keep) || !Number.isFinite(next) || next <= keep) return false;
    var start = appointment.startDateTime;
    var extraStart = appointment.endDateTime || addMinutes(start, keep);
    var extraEnd = addMinutes(start, next);
    var col = findColumn(board, appointment.diaryId);
    if (col && col.sessionEnd) {
      var sessEnd = parseDt(col.sessionEnd);
      var winEnd = parseDt(extraEnd);
      if (sessEnd && winEnd && winEnd > sessEnd) return false;
    }
    var others = allAppointments(board).filter(function (a) {
      return a && a.diaryId === appointment.diaryId && a.id !== appointment.id;
    });
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      var oEnd = o.endDateTime || addMinutes(o.startDateTime, o.duration || 0);
      if (intervalOverlaps(extraStart, extraEnd, o.startDateTime, oEnd)) return false;
    }
    return true;
  }

  function canStageStretch(appointment, newDuration, board) {
    if (!appointment || !appointment.id) return { ok: false, reason: 'Missing appointment.' };
    if (appointment.locked || appointment.arrived) return { ok: false, reason: ARRIVED_LOCKED };
    var next = Number(newDuration);
    var keep = Number(appointment.duration);
    if (!Number.isFinite(next) || !Number.isFinite(keep) || next <= keep) {
      return { ok: false, reason: STRETCH_NEIGHBOUR_BOOKED };
    }
    if ((next - keep) % STRETCH_STEP_MINUTES !== 0) {
      return { ok: false, reason: STRETCH_NEIGHBOUR_BOOKED };
    }
    if (!followingSlotsFree(board, appointment, next)) {
      return { ok: false, reason: STRETCH_NEIGHBOUR_BOOKED };
    }
    return { ok: true, reason: null };
  }

  var REBOOK_NO_SLOT = 'No similar free slot today (same type, length, site, delivery). Still needs rebook.';
  var REBOOK_WAITING = 'Waiting room / arrived — do not rebook from this board.';
  var REBOOK_PAST = 'Remaining similar slots are already in the past. Still needs rebook.';
  var REBOOK_CLAIMED = 'Similar slots already offered to earlier patients on this list. Still needs rebook.';
  var SICK_DAY_DEST_EXTRA_CAP = 6;

  function isHomeVisit(appointment) {
    var d = String((appointment && appointment.deliveryMode) || '').toLowerCase();
    var t = String((appointment && appointment.appointmentTypeName) || '').toLowerCase();
    return d === 'home-visit' || d.indexOf('home') !== -1 || t.indexOf('home visit') !== -1;
  }

  function slotFitsIdentity(appointment, slot) {
    if (!appointment || !slot) return false;
    if (slot.diaryId === appointment.diaryId) return false;
    if (appointment.siteId && slot.siteId && appointment.siteId !== slot.siteId) return false;
    if (appointment.appointmentTypeId && slot.appointmentTypeId && appointment.appointmentTypeId !== slot.appointmentTypeId) {
      return false;
    }
    if (appointment.deliveryMode && slot.deliveryMode && appointment.deliveryMode !== slot.deliveryMode) {
      return false;
    }
    return true;
  }

  function slotConflicts(board, slot, ignoreId) {
    var end = slot.endDateTime || addMinutes(slot.startDateTime, slot.duration || 0);
    return allAppointments(board).some(function (a) {
      if (!a || a.diaryId !== slot.diaryId || a.id === ignoreId) return false;
      var aEnd = a.endDateTime || addMinutes(a.startDateTime, a.duration || 0);
      return intervalOverlaps(slot.startDateTime, end, a.startDateTime, aEnd);
    });
  }

  function slotIsPast(slot, board, now) {
    if (!slot || !board || !board.date) return false;
    if (board.date !== todayISO()) return false;
    var d = parseDt(slot.startDateTime);
    if (!d) return false;
    var t = now == null ? Date.now() : Number(now);
    return d.getTime() <= t;
  }

  function slotOverlapsClaimed(slot, claimed) {
    if (!slot || !claimed || !claimed.length) return false;
    var end = slot.endDateTime || addMinutes(slot.startDateTime, slot.duration || 0);
    return claimed.some(function (c) {
      return c.diaryId === slot.diaryId && intervalOverlaps(slot.startDateTime, end, c.startDateTime, c.endDateTime);
    });
  }

  function matchingSlots(board, appointment, opts) {
    opts = opts || {};
    var need = Number(appointment && appointment.duration) || 0;
    var out = [];
    ((board && board.columns) || []).forEach(function (col) {
      if (!appointment || col.diaryId === appointment.diaryId) return;
      var tiles = (col.slots || [])
        .map(function (raw) {
          return {
            diaryId: raw.diaryId || col.diaryId,
            staffName: raw.staffName || col.staffName,
            startDateTime: raw.startDateTime,
            endDateTime: raw.endDateTime,
            duration: Number(raw.duration) || col.usualDuration || 0,
            appointmentTypeId: raw.appointmentTypeId || col.defaultAppointmentTypeId || null,
            deliveryMode: raw.deliveryMode || col.defaultDeliveryMode || null,
            siteId: raw.siteId || col.siteId || null,
          };
        })
        .filter(function (slot) {
          return (
            slotFitsIdentity(appointment, slot) &&
            !slotConflicts(board, slot, appointment.id) &&
            !slotIsPast(slot, board, opts.now)
          );
        })
        .sort(function (a, b) {
          return String(a.startDateTime).localeCompare(String(b.startDateTime));
        });
      for (var i = 0; i < tiles.length; i++) {
        var covered = 0;
        var expected = tiles[i].startDateTime;
        var ok = true;
        for (var j = i; j < tiles.length && covered < need; j++) {
          if (tiles[j].startDateTime !== expected) {
            ok = false;
            break;
          }
          var tileDur = Number(tiles[j].duration) || 0;
          if (tileDur <= 0) {
            ok = false;
            break;
          }
          covered += tileDur;
          expected = addMinutes(tiles[j].startDateTime, tileDur);
        }
        if (ok && covered >= need) {
          out.push({
            diaryId: col.diaryId,
            staffName: col.staffName,
            startDateTime: tiles[i].startDateTime,
            endDateTime: addMinutes(tiles[i].startDateTime, need),
            duration: need,
            reserveDuration: Number(tiles[i].duration) || need,
            appointmentTypeId: tiles[i].appointmentTypeId,
            deliveryMode: tiles[i].deliveryMode,
            siteId: tiles[i].siteId,
          });
        }
      }
    });
    out.sort(function (a, b) {
      var t = String(a.startDateTime).localeCompare(String(b.startDateTime));
      if (t !== 0) return t;
      return String(a.staffName || '').localeCompare(String(b.staffName || ''));
    });
    return out;
  }

  function longestFreeRun(board, appointment) {
    var max = 0;
    var tileDurations = [];
    ((board && board.columns) || []).forEach(function (col) {
      if (!appointment || col.diaryId === appointment.diaryId) return;
      var tiles = (col.slots || [])
        .map(function (raw) {
          return {
            diaryId: col.diaryId,
            startDateTime: raw.startDateTime,
            duration: Number(raw.duration) || col.usualDuration || 0,
            appointmentTypeId: raw.appointmentTypeId || col.defaultAppointmentTypeId || null,
            deliveryMode: raw.deliveryMode || col.defaultDeliveryMode || null,
            siteId: raw.siteId || col.siteId || null,
            staffName: col.staffName,
          };
        })
        .filter(function (slot) {
          return (
            slotFitsIdentity(appointment, slot) &&
            !slotConflicts(board, slot, appointment.id) &&
            !slotIsPast(slot, board, null)
          );
        })
        .sort(function (a, b) {
          return String(a.startDateTime).localeCompare(String(b.startDateTime));
        });
      tiles.forEach(function (t) {
        if (tileDurations.indexOf(t.duration) === -1) tileDurations.push(t.duration);
      });
      var run = 0;
      var expected = null;
      tiles.forEach(function (t) {
        if (expected && t.startDateTime === expected) {
          run += t.duration;
        } else {
          run = t.duration;
        }
        if (run > max) max = run;
        expected = addMinutes(t.startDateTime, t.duration);
      });
    });
    tileDurations.sort(function (a, b) {
      return a - b;
    });
    return { max: max, tileDurations: tileDurations };
  }

  function destCapReason(cap) {
    return 'Covering list would take more than ' + cap + ' extra patients. Still needs rebook.';
  }

  function rebookMissReason(board, appointment, opts) {
    var need = Number(appointment && appointment.duration) || 0;
    if (
      board &&
      board.date === todayISO() &&
      matchingSlots(board, appointment, { now: 0 }).length &&
      !matchingSlots(board, appointment, opts).length
    ) {
      return REBOOK_PAST;
    }
    var run = longestFreeRun(board, appointment);
    if (!run.tileDurations.length) {
      var anyFree = false;
      ((board && board.columns) || []).forEach(function (col) {
        if (appointment && col.diaryId === appointment.diaryId) return;
        if (col.slots && col.slots.length) anyFree = true;
      });
      if (!anyFree) return 'No free slots on other lists today. Still needs rebook.';
      return 'Other free slots are a different type, site or delivery. Still needs rebook.';
    }
    if (run.max < need) {
      return (
        'Need ' +
        need +
        ' min; other Sunday lists only have ' +
        run.tileDurations.join('/') +
        '-min tiles (longest free run ' +
        run.max +
        ' min). Still needs rebook.'
      );
    }
    return REBOOK_NO_SLOT;
  }

  function suggestRebook(board, appointment, opts) {
    if (!appointment) return { ok: false, reason: 'Missing appointment.', suggestion: null };
    if (appointment.locked || appointment.arrived) {
      return { ok: false, reason: REBOOK_WAITING, suggestion: null };
    }
    var list = matchingSlots(board, appointment, opts);
    if (!list.length) return { ok: false, reason: rebookMissReason(board, appointment, opts), suggestion: null };
    return { ok: true, reason: null, suggestion: list[0] };
  }

  function proposeSickDay(board, sickDiaryId, opts) {
    opts = opts || {};
    var destExtraCap = Number(opts.destExtraCap);
    if (!Number.isFinite(destExtraCap) || destExtraCap < 1) destExtraCap = SICK_DAY_DEST_EXTRA_CAP;
    var col = findColumn(board, sickDiaryId);
    if (!col) {
      return { sickDiaryId: sickDiaryId, sickStaffName: '', destExtraCap: destExtraCap, rows: [] };
    }
    var claimed = [];
    var destCount = {};
    var appointments = (col.appointments || []).slice().sort(function (a, b) {
      return String(a.startDateTime).localeCompare(String(b.startDateTime));
    });
    var rows = appointments.map(function (a) {
      if (a.locked || a.arrived) {
        return { appointment: a, status: 'locked', suggestion: null, reason: REBOOK_WAITING, alternatives: [] };
      }
      var alts = matchingSlots(board, a, { now: opts.now });
      var usable = alts.filter(function (s) {
        if ((destCount[s.diaryId] || 0) >= destExtraCap) return false;
        return !slotOverlapsClaimed(s, claimed);
      });
      var sug = usable[0] || null;
      var reason = null;
      if (!sug) {
        if (!alts.length) reason = rebookMissReason(board, a, { now: opts.now });
        else if (alts.every(function (s) { return (destCount[s.diaryId] || 0) >= destExtraCap; })) {
          reason = destCapReason(destExtraCap);
        } else {
          reason = REBOOK_CLAIMED;
        }
      } else {
        claimed.push({
          diaryId: sug.diaryId,
          startDateTime: sug.startDateTime,
          endDateTime: sug.endDateTime || addMinutes(sug.startDateTime, sug.duration || 0),
        });
        destCount[sug.diaryId] = (destCount[sug.diaryId] || 0) + 1;
      }
      return {
        appointment: a,
        status: sug ? 'accept' : 'leave',
        suggestion: sug,
        reason: reason,
        alternatives: alts,
      };
    });
    return {
      sickDiaryId: sickDiaryId,
      sickStaffName: col.staffName,
      destExtraCap: destExtraCap,
      rows: rows,
    };
  }

  function sickDayAcceptCount(proposal) {
    return ((proposal && proposal.rows) || []).filter(function (row) {
      return row.status === 'accept' && row.suggestion;
    }).length;
  }

  function sickDayLeftovers(proposal) {
    return ((proposal && proposal.rows) || [])
      .filter(function (row) {
        return row.status === 'leave' || row.status === 'locked';
      })
      .map(function (row) {
        var a = row.appointment || {};
        return {
          appointmentId: a.id || null,
          patientName: a.patientName || 'Unknown',
          originalTime: a.startDateTime || '',
          duration: a.duration || 0,
          appointmentTypeName: a.appointmentTypeName || '',
          deliveryMode: a.deliveryMode || '',
          status: row.status,
          reason: row.reason || (row.status === 'locked' ? REBOOK_WAITING : REBOOK_NO_SLOT),
        };
      })
      .sort(function (a, b) {
        return String(a.originalTime).localeCompare(String(b.originalTime));
      });
  }

  function leftoverPhoneText(proposal) {
    var list = sickDayLeftovers(proposal);
    var sick = (proposal && proposal.sickStaffName) || 'this list';
    var lines = ['Still needs a phone call — ' + sick];
    if (!list.length) {
      lines.push('Nobody left to phone.');
      return lines.join('\n');
    }
    list.forEach(function (row) {
      lines.push(
        hhmm(row.originalTime) +
          '  ' +
          row.patientName +
          '  ' +
          (row.appointmentTypeName || 'Appointment') +
          (row.duration ? ' ' + row.duration + ' min' : '') +
          '  —  ' +
          row.reason
      );
    });
    lines.push('No phone numbers on the appointment book. Look the patient up in Medicus.');
    return lines.join('\n');
  }

  function remainingFreeAfterIncoming(col, claimed) {
    return ((col && col.slots) || []).filter(function (s) {
      var end = s.endDateTime || addMinutes(s.startDateTime, s.duration || 0);
      return !claimed.some(function (c) {
        return intervalOverlaps(s.startDateTime, end, c.startDateTime, c.endDateTime);
      });
    }).length;
  }

  function coverLoadPreview(board, proposal) {
    var dests = {};
    ((proposal && proposal.rows) || []).forEach(function (row) {
      if (row.status !== 'accept' || !row.suggestion) return;
      var id = row.suggestion.diaryId;
      if (!dests[id]) {
        var col = findColumn(board, id);
        dests[id] = {
          diaryId: id,
          staffName: (col && col.staffName) || row.suggestion.staffName || '',
          sessionStart: col && col.sessionStart,
          sessionEnd: col && col.sessionEnd,
          alreadyBooked: col ? (col.appointments || []).length : 0,
          incoming: 0,
          incomingMinutes: 0,
          claimed: [],
          col: col,
        };
      }
      dests[id].incoming += 1;
      dests[id].incomingMinutes += Number((row.appointment && row.appointment.duration) || 0);
      dests[id].claimed.push({
        startDateTime: row.suggestion.startDateTime,
        endDateTime: row.suggestion.endDateTime || addMinutes(row.suggestion.startDateTime, row.suggestion.duration || 0),
      });
    });
    var cap = Number(proposal && proposal.destExtraCap);
    if (!Number.isFinite(cap) || cap < 1) cap = SICK_DAY_DEST_EXTRA_CAP;
    return Object.keys(dests)
      .map(function (id) {
        var d = dests[id];
        d.remainingFree = remainingFreeAfterIncoming(d.col, d.claimed);
        d.afterBooked = d.alreadyBooked + d.incoming;
        d.overCap = d.incoming > cap;
        d.cap = cap;
        delete d.col;
        delete d.claimed;
        return d;
      })
      .sort(function (a, b) {
        return String(a.staffName).localeCompare(String(b.staffName));
      });
  }

  function applySickDayProposal(draft, proposal) {
    var next = cloneDraft(draft);
    ((proposal && proposal.rows) || []).forEach(function (row) {
      if (row.status !== 'accept' || !row.suggestion || !row.appointment) return;
      next = stageMove(next, row.appointment.id, row.suggestion);
    });
    return next;
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
    next.stretchIds = (next.stretchIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.stretches[appointmentId];
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
    if (next.stretches[appointmentId]) {
      next.stretches[appointmentId] = Object.assign({}, next.stretches[appointmentId], { included: !!included });
    }
    return next;
  }

  function stageStretch(draft, appointmentId, newDuration) {
    var next = cloneDraft(draft);
    if (!appointmentId) return next;
    next.cancelIds = (next.cancelIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.cancels[appointmentId];
    next.moveIds = (next.moveIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.moves[appointmentId];
    if (next.stretchIds.indexOf(appointmentId) === -1) next.stretchIds.push(appointmentId);
    next.stretches[appointmentId] = { duration: Number(newDuration), included: true };
    return next;
  }

  function unstageStretch(draft, appointmentId) {
    var next = cloneDraft(draft);
    next.stretchIds = (next.stretchIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.stretches[appointmentId];
    return next;
  }

  function stageMove(draft, appointmentId, target) {
    var next = cloneDraft(draft);
    if (!appointmentId || !target) return next;
    next.cancelIds = (next.cancelIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.cancels[appointmentId];
    next.stretchIds = (next.stretchIds || []).filter(function (id) {
      return id !== appointmentId;
    });
    delete next.stretches[appointmentId];
    if (next.moveIds.indexOf(appointmentId) === -1) next.moveIds.push(appointmentId);
    next.moves[appointmentId] = {
      diaryId: target.diaryId,
      startDateTime: target.startDateTime,
      staffName: target.staffName || '',
      reserveDuration: Number(target.reserveDuration) || Number(target.duration) || 0,
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
          'Rebooked with ' +
          (mv.staffName || 'the covering list') +
          ' at ' +
          hhmm(mv.startDateTime) +
          ' — ' +
          appt.patientName +
          ' (was ' +
          hhmm(appt.startDateTime) +
          (appt.staffName ? ' ' + appt.staffName : '') +
          ') — Medicus will not send a booking message',
      });
    });
    ((draft && draft.stretchIds) || []).forEach(function (id) {
      var appt = findAppointment(board, id) || { id: id, patientName: id, startDateTime: '', duration: 0 };
      var st = (draft.stretches && draft.stretches[id]) || {};
      items.push({
        kind: 'stretch',
        id: id,
        included: st.included !== false,
        patientName: appt.patientName,
        duration: st.duration,
        text:
          'Cancel then rebook ' +
          appt.patientName +
          ', ' +
          hhmm(appt.startDateTime) +
          ' ' +
          appt.duration +
          ' min → ' +
          st.duration +
          ' min — Medicus will not send a message',
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
        defaultAppointmentTypeId: col.defaultAppointmentTypeId,
        siteId: col.siteId,
        siteName: col.siteName,
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
    ((draft && draft.stretchIds) || []).forEach(function (id) {
      var st = draft.stretches[id];
      if (!st) return;
      nextCols.forEach(function (col) {
        col.appointments = col.appointments.map(function (a) {
          if (a.id !== id) return a;
          var extraEnd = addMinutes(a.startDateTime, st.duration);
          col.slots = col.slots.filter(function (s) {
            var s0 = parseDt(s.startDateTime);
            var win0 = parseDt(a.endDateTime || addMinutes(a.startDateTime, a.duration));
            var win1 = parseDt(extraEnd);
            return !(s0 && win0 && win1 && s0 >= win0 && s0 < win1);
          });
          return Object.assign({}, a, {
            duration: st.duration,
            endDateTime: extraEnd,
            stagedStretch: true,
          });
        });
      });
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

  function buildStretchUpdatePayload(opts) {
    opts = opts || {};
    if (!opts.slotReservationId) throw new Error('appointment-organise: slotReservationId required');
    if (!opts.diaryId) throw new Error('appointment-organise: diaryId required');
    return {
      slotReservationId: opts.slotReservationId,
      diaryId: opts.diaryId,
      rescheduledAppointmentId: null,
      intendedStartDateTime: opts.startDateTime,
      intendedDuration: Number(opts.intendedDuration),
    };
  }

  function buildStretchCreatePayload(opts) {
    opts = opts || {};
    if (!opts.patientId) throw new Error('appointment-organise: explicit patientId required');
    if (!opts.slotReservationId) throw new Error('appointment-organise: slotReservationId required');
    return {
      context: 'create-booked-appointment',
      appointmentTemporalType: 'timed',
      appointmentTypeId: opts.appointmentTypeId,
      patientId: opts.patientId,
      deliveryMode: opts.deliveryMode || 'face-to-face',
      intendedDuration: Number(opts.intendedDuration),
      diaryId: opts.diaryId,
      isHighPriority: false,
      isHiddenFromPatientFacingServices: !!opts.isHiddenFromPatientFacingServices,
      intendedStartDateTime: opts.startDateTime,
      reasonForAppointment: opts.reasonForAppointment == null ? null : opts.reasonForAppointment,
      additionalInformation: opts.additionalInformation == null ? null : opts.additionalInformation,
      embargoOverrideReason: null,
      slotReservationId: opts.slotReservationId,
      nhsNationalSlotTypeCategory: opts.nhsNationalSlotTypeCategory || '10127',
      gpadReportingExceptionReasons: [],
      clinicalCaseId: null,
      bookingConfirmationRecipients: [],
      followingSlotConvertToBreak: null,
      followingSlotNewAppointmentTypeId: null,
      followingSlotStartDateTime: null,
      followingSlotEndDateTime: null,
      rescheduledAppointmentVersionId: null,
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

  function verifyOverview(overview, pinned) {
    pinned = pinned || {};
    if (!overview) return { ok: false, reason: driftMessage('missing') };
    if (pinned.appointmentId && overview.appointmentId !== pinned.appointmentId) {
      return { ok: false, reason: driftMessage('id') };
    }
    if (pinned.versionId && overview.versionId !== pinned.versionId) {
      return { ok: false, reason: driftMessage('version') };
    }
    if (pinned.patientId && overview.patientId !== pinned.patientId) {
      return { ok: false, reason: driftMessage('patient') };
    }
    var details = overview.details || {};
    var display = String((details.displayStatus && details.displayStatus.value) || '').toLowerCase();
    var st = details.appointmentStatus || {};
    if (display === 'arrived' || (details.displayStatus && details.displayStatus.isArrived)) {
      return { ok: false, reason: ARRIVED_LOCKED };
    }
    if (st.isStarted || st.isSeen || st.isDidNotAttend) return { ok: false, reason: ARRIVED_LOCKED };
    if (st.isCancelled || display === 'cancelled') return { ok: false, reason: CANCELLED_EXCLUDED };
    return { ok: true, reason: null };
  }

  function requireBooking(booking) {
    if (!booking || typeof booking.createAppointment !== 'function') {
      throw new Error('appointment-organise: booking-core reserve/create/release required');
    }
    return booking;
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

    async function fetchAppointmentOverview(appointmentId) {
      return apiFetch(url(PATHS.appointmentOverview + encodeURIComponent(appointmentId)), {}, fetchImpl);
    }

    async function fetchCancelForm(appointmentId) {
      return apiFetch(url(PATHS.cancelForm + encodeURIComponent(appointmentId)), {}, fetchImpl);
    }

    async function fetchMoveForm(appointmentId, moveType) {
      var type = moveType === 'to-same-diary' ? 'to-same-diary' : 'to-another-diary';
      return apiFetch(
        url(PATHS.moveForm + encodeURIComponent(appointmentId) + '?moveType=' + type),
        {},
        fetchImpl
      );
    }

    async function reserveForMove(payload) {
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
      var overview = await fetchAppointmentOverview(opts.appointmentId);
      var ovCheck = verifyOverview(overview, {
        patientId: opts.patientId,
        appointmentId: opts.appointmentId,
        versionId: pinned.versionId,
      });
      if (!ovCheck.ok) throw new Error(ovCheck.reason);
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
      var gate = canStageMove(appointment, target);
      if (!gate.ok) throw new Error(gate.reason);
      requireBooking(deps.booking);
      if (pinned.apiBase && pinned.apiBase !== apiBase) {
        throw new Error(driftMessage('site'));
      }
      var board = await fetchBoard(opts.date);
      var live = findAppointment(board, appointment.id);
      var boardCheck = verifyAgainstBoard(live, {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        versionId: appointment.versionId,
      });
      if (!boardCheck.ok) throw new Error(boardCheck.reason);
      var form = await fetchMoveForm(appointment.id, moveTypeFor(appointment, target));
      var formCheck = verifyMoveForm(form, {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        versionId: appointment.versionId,
      });
      if (!formCheck.ok) throw new Error(formCheck.reason);
      var booking = requireBooking(deps.booking);
      var keepDuration = moveDuration(appointment);
      var reserveDuration = Number(target.reserveDuration) || Number(target.duration) || keepDuration;
      var reservationId = null;
      try {
        var reserved = await reserveForMove(
          buildReserveReschedulePayload({
            diaryId: target.diaryId,
            startDateTime: target.startDateTime,
            intendedDuration: reserveDuration,
          })
        );
        reservationId = reserved && reserved.slotReservationId;
        if (!reservationId) throw new Error('appointment-organise: reserve returned no slotReservationId');
        if (isCrossListMove(appointment, target)) {
          await updateSlotReservation(
            buildUpdateReservationPayload({
              slotReservationId: reservationId,
              diaryId: target.diaryId,
              appointmentId: appointment.id,
              startDateTime: target.startDateTime,
              intendedDuration: keepDuration,
            })
          );
        }
        var created = await booking.createAppointment(
          apiBase,
          buildRescheduleCreatePayload({
            patientId: appointment.patientId,
            appointmentId: appointment.id,
            versionId: appointment.versionId,
            slotReservationId: reservationId,
            diaryId: target.diaryId,
            startDateTime: target.startDateTime,
            intendedDuration: keepDuration,
            deliveryMode: appointment.deliveryMode,
            nhsNationalSlotTypeCategory: appointment.nhsNationalSlotTypeCategory,
            reasonForAppointment: appointment.reason || null,
            additionalInformation: appointment.additionalInformation,
            isHiddenFromPatientFacingServices: appointment.isHiddenFromPatientFacingServices,
          })
        );
        // Captured after create-appointment 200 on both same-list and
        // cross-list (07:32:37 / 07:17:41). Not failure-only cleanup.
        if (reservationId && typeof booking.releaseReservation === 'function') {
          await booking.releaseReservation(apiBase, reservationId);
        }
        return created;
      } catch (err) {
        if (reservationId && typeof booking.releaseReservation === 'function') {
          await booking.releaseReservation(apiBase, reservationId);
        }
        throw err;
      }
    }

    async function commitStretch(opts) {
      opts = opts || {};
      var pinned = opts.pinned || {};
      var appointment = opts.appointment;
      var newDuration = Number(opts.newDuration);
      if (!appointment || !appointment.patientId) {
        throw new Error('appointment-organise: explicit patientId required');
      }
      if (pinned.apiBase && pinned.apiBase !== apiBase) {
        throw new Error(driftMessage('site'));
      }
      var booking = requireBooking(deps.booking);
      var board = await fetchBoard(opts.date);
      var live = findAppointment(board, appointment.id);
      var boardCheck = verifyAgainstBoard(live, {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        versionId: appointment.versionId,
      });
      if (!boardCheck.ok) throw new Error(boardCheck.reason);
      var gate = canStageStretch(live, newDuration, board);
      if (!gate.ok) throw new Error(gate.reason);
      var overview = await fetchAppointmentOverview(appointment.id);
      var ovCheck = verifyOverview(overview, {
        patientId: appointment.patientId,
        appointmentId: appointment.id,
        versionId: appointment.versionId,
      });
      if (!ovCheck.ok) throw new Error(ovCheck.reason);
      await cancelAppointment(
        buildCancelPayload({
          appointmentId: appointment.id,
          reason: opts.reason || STRETCH_CANCEL_REASON,
        })
      );
      var reservationId = null;
      try {
        var reserved = await reserveForMove(
          buildReserveReschedulePayload({
            diaryId: appointment.diaryId,
            startDateTime: appointment.startDateTime,
            intendedDuration: appointment.duration,
          })
        );
        reservationId = reserved && reserved.slotReservationId;
        if (!reservationId) throw new Error('appointment-organise: reserve returned no slotReservationId');
        var stretchUpd = buildStretchUpdatePayload({
          slotReservationId: reservationId,
          diaryId: appointment.diaryId,
          startDateTime: appointment.startDateTime,
          intendedDuration: newDuration,
        });
        if (Object.prototype.hasOwnProperty.call(stretchUpd, 'allowOverlappingAppointments')) {
          throw new Error('appointment-organise: must not send allowOverlappingAppointments');
        }
        await updateSlotReservation(stretchUpd);
        var createdBody = buildStretchCreatePayload({
          patientId: appointment.patientId,
          appointmentTypeId: appointment.appointmentTypeId,
          slotReservationId: reservationId,
          diaryId: appointment.diaryId,
          startDateTime: appointment.startDateTime,
          intendedDuration: newDuration,
          deliveryMode: appointment.deliveryMode,
          nhsNationalSlotTypeCategory: appointment.nhsNationalSlotTypeCategory,
          reasonForAppointment: appointment.reason || null,
          additionalInformation: appointment.additionalInformation,
          isHiddenFromPatientFacingServices: appointment.isHiddenFromPatientFacingServices,
        });
        if (Object.prototype.hasOwnProperty.call(createdBody, 'allowOverlappingAppointments')) {
          throw new Error('appointment-organise: must not send allowOverlappingAppointments');
        }
        var created = await booking.createAppointment(apiBase, createdBody);
        if (reservationId && typeof booking.releaseReservation === 'function') {
          await booking.releaseReservation(apiBase, reservationId);
        }
        return created;
      } catch (err) {
        if (reservationId && typeof booking.releaseReservation === 'function') {
          await booking.releaseReservation(apiBase, reservationId);
        }
        throw err;
      }
    }

    return {
      fetchBoard: fetchBoard,
      fetchAppointmentOverview: fetchAppointmentOverview,
      fetchCancelForm: fetchCancelForm,
      fetchMoveForm: fetchMoveForm,
      cancelAppointment: cancelAppointment,
      reserveForMove: reserveForMove,
      updateSlotReservation: updateSlotReservation,
      commitCancel: commitCancel,
      commitMove: commitMove,
      commitStretch: commitStretch,
    };
  }

  var api = {
    PATHS: PATHS,
    CANCEL_PAYLOAD_KEYS: CANCEL_PAYLOAD_KEYS,
    RESERVE_RESCHEDULE_KEYS: RESERVE_RESCHEDULE_KEYS,
    UPDATE_RESERVATION_KEYS: UPDATE_RESERVATION_KEYS,
    STRETCH_UPDATE_KEYS: STRETCH_UPDATE_KEYS,
    STRETCH_CREATE_KEYS: STRETCH_CREATE_KEYS,
    RESCHEDULE_CREATE_KEYS: RESCHEDULE_CREATE_KEYS,
    EXTEND_BLOCKED: EXTEND_BLOCKED,
    DURATION_LOCKED: DURATION_LOCKED,
    STRETCH_NEIGHBOUR_BOOKED: STRETCH_NEIGHBOUR_BOOKED,
    STRETCH_CANCEL_REASON: STRETCH_CANCEL_REASON,
    STRETCH_STEP_MINUTES: STRETCH_STEP_MINUTES,
    SAME_SLOT: SAME_SLOT,
    moveDuration: moveDuration,
    moveTypeFor: moveTypeFor,
    isCrossListMove: isCrossListMove,
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
    canStageStretch: canStageStretch,
    followingSlotsFree: followingSlotsFree,
    isHomeVisit: isHomeVisit,
    matchingSlots: matchingSlots,
    suggestRebook: suggestRebook,
    proposeSickDay: proposeSickDay,
    applySickDayProposal: applySickDayProposal,
    sickDayAcceptCount: sickDayAcceptCount,
    sickDayLeftovers: sickDayLeftovers,
    leftoverPhoneText: leftoverPhoneText,
    coverLoadPreview: coverLoadPreview,
    rebookMissReason: rebookMissReason,
    slotIsPast: slotIsPast,
    REBOOK_NO_SLOT: REBOOK_NO_SLOT,
    REBOOK_WAITING: REBOOK_WAITING,
    REBOOK_PAST: REBOOK_PAST,
    REBOOK_CLAIMED: REBOOK_CLAIMED,
    SICK_DAY_DEST_EXTRA_CAP: SICK_DAY_DEST_EXTRA_CAP,
    addMinutes: addMinutes,
    stageCancel: stageCancel,
    unstageCancel: unstageCancel,
    setCancelReason: setCancelReason,
    setDraftIncluded: setDraftIncluded,
    stageMove: stageMove,
    unstageMove: unstageMove,
    stageStretch: stageStretch,
    unstageStretch: unstageStretch,
    summariseDraft: summariseDraft,
    applyDraftToBoard: applyDraftToBoard,
    buildCancelPayload: buildCancelPayload,
    buildReserveReschedulePayload: buildReserveReschedulePayload,
    buildUpdateReservationPayload: buildUpdateReservationPayload,
    buildRescheduleCreatePayload: buildRescheduleCreatePayload,
    buildStretchUpdatePayload: buildStretchUpdatePayload,
    buildStretchCreatePayload: buildStretchCreatePayload,
    verifyAgainstBoard: verifyAgainstBoard,
    verifyOverview: verifyOverview,
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
