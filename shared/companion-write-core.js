// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Companion write-core (W2 booking confirm, W5 task create).
//
// Identity-gate + ready-to-write + landed-id helpers. The POSTs stay in
// content-scripts/task-actions-panel.js. Pure: no DOM, no chrome, no fetch.
//
// Dual-mode: module.exports for Node; window.CompanionWriteCore in the page.

'use strict';

(function () {
  function bookingReady(st) {
    return !!(st && !st.confirming && st.reservationId && st.patientId && st.selectedSlot);
  }

  function taskReady(st) {
    return !!(st && !st.creating && st.patientId && st.assignee && String(st.description || '').trim());
  }

  function identitiesMatch(pinnedPatientId, livePatientId) {
    if (!pinnedPatientId || !livePatientId) return false;
    return String(pinnedPatientId) === String(livePatientId);
  }

  function refuseIfIdentityMoved(pinnedPatientId, livePatientId, message) {
    if (identitiesMatch(pinnedPatientId, livePatientId)) return { ok: true };
    return {
      ok: false,
      reason: message || 'Patient could not be re-verified — reopen the panel.',
    };
  }

  function bookingWriteGate(st, verifiedPatientId) {
    if (!bookingReady(st)) return { ok: false, reason: 'Booking is not ready to write.' };
    return refuseIfIdentityMoved(st.patientId, verifiedPatientId);
  }

  function taskWriteGate(st, verifiedPatientId) {
    if (!taskReady(st)) return { ok: false, reason: 'Task is not ready to write.' };
    return refuseIfIdentityMoved(st.patientId, verifiedPatientId);
  }

  function confirmBookingLanded(result) {
    var id = result && (result.appointmentId || result.id);
    return id ? [{ id: String(id) }] : [];
  }

  function confirmTaskLanded(result) {
    var id = result && (result.taskId || result.id);
    return id ? [{ id: String(id) }] : [];
  }

  var api = {
    bookingReady: bookingReady,
    taskReady: taskReady,
    identitiesMatch: identitiesMatch,
    refuseIfIdentityMoved: refuseIfIdentityMoved,
    bookingWriteGate: bookingWriteGate,
    taskWriteGate: taskWriteGate,
    confirmBookingLanded: confirmBookingLanded,
    confirmTaskLanded: confirmTaskLanded,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.CompanionWriteCore = api;
  }
})();
