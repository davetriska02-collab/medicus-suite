// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Book appointment" / "Create task" floating panel for task pages.
//
// Replaces the two separate inline widgets that used to anchor below the
// "Codes & actions" card (booking-inline.js, task-inline.js) with ONE
// fixed-position floating panel, appended directly to document.body — the
// same pattern document-codes-to-problems.js established for the
// document-filing task page (2026-08-13) and is now being carried over here
// for the same reason: inline anchoring depends on finding a card that may
// not exist yet (a race with Medicus's own Vue render) or may not exist at
// all on some task types (prescribing overviews have no "Codes & actions"
// card), and the anchor-search machinery (findHeading/findCard/
// findActionRow, three gates deep) existed only to work around that. A
// body-level panel has nothing to find, so it always renders, and nothing to
// be unmounted by, so it survives any in-page pane-switching. The two
// features keep their own independent open/loading/step state (each is
// unrelated to the other) but now share one draggable, collapsible, position-
// persisted floating box instead of two separately-anchored ones.
//
// Booking API contract identical to the retired booking-inline.js (still the
// suite's only OTHER copy of this flow — shared/booking-core.js is the
// shared extraction other surfaces use, this widget still hand-rolls it, a
// pre-existing divergence this migration does not fix). Task-create API
// contract identical to the retired task-inline.js. See CHANGELOG for the
// original capture notes; nothing about either contract changed here.
//
// CSN write-path inventory: this file is now W2 (book) and W5 (create task)
// — see docs/CLINICAL-SAFETY-NOTICE.md and test-write-path-inventory.js.
'use strict';

(function () {
  if (window.__msTapWidget) return;
  window.__msTapWidget = true;

  const WIDGET_ID = 'ms-tap-widget';
  const POS_KEY = 'ms-tap-pos';

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function slotTime(dt) {
    return dt ? String(dt).substring(11, 16) : '';
  }

  // ── URL detection ─────────────────────────────────────────────────────────────

  function getTaskInfo() {
    const m = location.pathname.match(
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // The queue-list slugs (medical_patient_request_task / admin_patient_
  // request_task, used by content.js's isTriageQueueSlug) do NOT appear on
  // the individual task's own overview URL — confirmed live (2026-08-23 HAR
  // capture): a task opened from either queue loads at
  // /tasks/data/communication-thread/overview/{uuid}, a generic slug also
  // shared by repeat-prescription requests, patient-questionnaire responses
  // and plain patient conversations. The URL alone cannot tell them apart —
  // this is only a cheap pre-filter before fetching the overview itself,
  // where classifyPatientRequest() does the real classification.
  function isCommunicationThreadSlug(slug) {
    return String(slug || '').toLowerCase() === 'communication-thread';
  }

  // overview is the raw GET /tasks/data/communication-thread/overview/{uuid}
  // response. data.communicationThreadTaskType.isPatientRequestTask is false
  // for a questionnaire response or a plain conversation thread (both also
  // ride this same slug). Even a genuine patient-request thread can be a
  // repeat-prescription request, not medical/admin — patientRequestType
  // carries isMedical/isAdmin/isRepeatPrescription as three-way exclusive
  // flags, read off whichever communication entry actually carries the
  // original request (a reply-only entry carries none of this).
  function classifyPatientRequest(overview) {
    const d = (overview && overview.data) || {};
    const patientId = d.patientId || (d.patient && d.patient.id) || null;
    const threadType = d.communicationThreadTaskType;
    if (!threadType || !threadType.isPatientRequestTask) return { isTriage: false, patientId };
    const comms = (d.communicationThread && d.communicationThread.communications) || [];
    const withType = comms.find((c) => c && c.patientRequest && c.patientRequest.patientRequestType);
    const reqType = withType && withType.patientRequest.patientRequestType;
    const isTriage = !!(reqType && (reqType.isMedical || reqType.isAdmin));
    return { isTriage, patientId };
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  // Two independent sub-states (bk = booking, tk = create-task) nested under
  // one panel-level state so a wholesale-replace on SPA navigation (the same
  // discipline both retired widgets used) resets both at once. Every
  // wrong-patient guard below pins the SUB-state object (`st = s.bk` /
  // `st = s.tk`), not the outer `s` — an outer navigation-replace swaps in a
  // fresh nested object either way, so `st !== s.bk` / `st !== s.tk` still
  // catches it.

  function blankBookingState() {
    return {
      open: false,
      loading: false,
      error: null,
      patientId: null,
      providerId: null,
      types: [],
      selectedTypeId: '',
      date: todayISO(),
      slots: null,
      slotsLoading: false,
      slotsError: null,
      hasSearched: false,
      step: 'browse', // 'browse' | 'confirm' | 'booked'
      selectedSlot: null,
      reservationId: null,
      confirming: false,
      confirmError: null,
      reason: '',
      bookedId: null,
    };
  }

  function blankTaskState() {
    return {
      open: false,
      loading: false,
      error: null,
      patientId: null,
      teams: [],
      staff: [],
      priorities: [],
      assignee: '', // "type|value"
      priority: 0,
      description: '',
      step: 'form', // 'form' | 'created'
      creating: false,
      createError: null,
      createdAssignee: null,
    };
  }

  // Read-only context, medical/admin patient requests only — eager-loaded
  // (not click-to-open like bk/tk) because it exists to inform whether a
  // booking or task is even needed, not something the clinician opts into.
  // `applicable` is a tri-state: null while unclassified (or not a
  // communication-thread task at all — never checked), false once the
  // overview confirms this thread is something else (repeat-prescription,
  // questionnaire response, plain conversation), true once confirmed
  // medical/admin. The section renders only when `applicable === true` — a
  // classification failure fails CLOSED (stays hidden) rather than risk
  // showing scheduling data under an unrelated task, but once `applicable`
  // is true a later fetch failure shows an error instead of silently
  // nothing, since by then the section is known to belong here.
  // `loadedForTask` guards against re-fetching on every mutation-observer
  // tick while the panel sits on the same task.
  function blankRecordState() {
    return {
      checking: false,
      applicable: null,
      loading: false,
      error: null,
      patientId: null,
      loadedForTask: null,
      open: true,
      appointments: [], // future only, soonest first
      bookingLinks: [], // unused (appointmentBooked === 'No') only
    };
  }

  function blankState() {
    return {
      taskUuid: null,
      collapsed: false,
      bk: blankBookingState(),
      tk: blankTaskState(),
      rec: blankRecordState(),
    };
  }

  let s = blankState();

  // ── API (shared fetch plumbing) ──────────────────────────────────────────────

  function apiBaseUrl() {
    const info = getTaskInfo();
    const parts = location.pathname.split('/').filter(Boolean);
    const siteId = (info && info.siteId) || parts[0] || '';
    return `https://${siteId}.api.${location.hostname}`;
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const resp = await fetch(`${apiBaseUrl()}${path}`, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
      body: opts.body,
      // keepalive lets a fire-and-forget release survive page unload (see
      // apiReleaseReservation + the pagehide handler).
      keepalive: !!opts.keepalive,
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('API returned an unexpected response.');
    }
  }

  // Resolve task UUID → patient UUID via the API subdomain — used by both
  // sections (each re-resolves independently at open time and again at
  // commit time; there is no shared cache between them, matching the
  // originals' behaviour exactly).
  async function resolvePatientId(typeSlug, taskUuid) {
    const data = await apiFetch(`/tasks/data/${typeSlug}/overview/${taskUuid}`);
    return data?.data?.patient?.id || data?.data?.patientId || data?.patient?.id || data?.patientId || null;
  }

  // ── API: booking ──────────────────────────────────────────────────────────────

  async function apiFetchFinder() {
    return apiFetch('/scheduling/data/appointment-service/available-appointment-finder');
  }

  async function apiFetchSlots({ providerId, appointmentTypeId, date }) {
    const now = new Date();
    const todayYmd = todayISO();
    const minDateTime =
      date === todayYmd ? `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:00` : `${date} 00:00:00`;
    const qs = new URLSearchParams({
      providerId,
      providerIsLocalOrganisation: 'true',
      minDateTime,
      'localOrganisationFilters[appointmentTypeId]': appointmentTypeId,
    });
    const data = await apiFetch(
      `/scheduling/data/appointment-service/available-appointment-places-between-range?${qs}`
    );
    const slots = [];
    for (const diary of data.availablePlaces?.[date]?.diaries || []) {
      for (const entry of diary.entries || []) {
        if (entry.diaryEntryType?.isSlot) slots.push(entry);
      }
    }
    return slots;
  }

  async function apiReserve({ diaryId, startDateTime, duration, appointmentTypeId }) {
    return apiFetch('/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress', {
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

  async function apiFetchCreateForm({ slotReservationId, patientId }) {
    const qs = new URLSearchParams({
      context: 'create-booked-appointment',
      appointmentTemporalType: 'timed',
      slotReservationId,
      patientId,
    });
    return apiFetch(`/scheduling/data/appointment/create-appointment?${qs}`);
  }

  async function apiCreateAppointment(payload) {
    return apiFetch('/scheduling/appointment/create-appointment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  function apiReleaseReservation(slotReservationId) {
    if (!slotReservationId) return;
    apiFetch('/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotReservationId }),
      keepalive: true,
    }).catch(() => {});
  }

  // ── API: create task ──────────────────────────────────────────────────────────

  async function apiFetchTaskForm(patientId) {
    return apiFetch(`/patient/data/workflow/general-task/create?patientId=${encodeURIComponent(patientId)}`);
  }

  async function apiCreateTask(payload) {
    return apiFetch('/patient/workflow/general-task/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── API: patient record (read-only — triage tasks only) ─────────────────────
  // Also captured live (2026-08-23): GET .../communication-thread/overview/
  // {taskUuid} — the same overview call resolvePatientId already makes for
  // bk/tk — additionally carries data.communicationThreadTaskType and, per
  // communication entry, .patientRequest.patientRequestType, which is what
  // classifyPatientRequest() reads to tell a medical/admin request apart
  // from a repeat-prescription request, questionnaire response, or plain
  // conversation riding the same URL slug.
  //
  // Both captured live (2026-08-23): GET .../appointment/find-appointments
  // returns { appointments: [...] } — every appointment ever, newest first, no
  // date filter of its own (filtering to future is ours, below). GET
  // .../list-patient-booking-link/{patientId} returns
  // { patientBookingLinks: [...] }, already newest-created first;
  // `appointmentBooked` is "Yes"/"No" (No = outstanding/unused) and
  // `predefinedReasonForAppointment` is "-" when nothing was set.

  async function apiFetchTaskOverview(typeSlug, taskUuid) {
    return apiFetch(`/tasks/data/${typeSlug}/overview/${taskUuid}`);
  }

  async function apiFetchAppointments(patientId) {
    const qs = new URLSearchParams();
    qs.append('patientIds[]', patientId);
    qs.append('includeThirdPartyAppointments', 'true');
    const data = await apiFetch(`/scheduling/data/appointment/find-appointments?${qs}`);
    return Array.isArray(data.appointments) ? data.appointments : [];
  }

  async function apiFetchBookingLinks(patientId) {
    const data = await apiFetch(
      `/patient/data/scheduling/patient-booking-link/list-patient-booking-link/${encodeURIComponent(patientId)}`
    );
    return Array.isArray(data.patientBookingLinks) ? data.patientBookingLinks : [];
  }

  // "YYYY-MM-DD HH:mm:ss", local time — same shape as the API's own
  // startDateTime strings (confirmed live), so a plain lexical `>` compares
  // correctly without parsing either side as a Date.
  function nowDateTimeString() {
    const d = new Date();
    return `${todayISO()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // ── DOM injection ─────────────────────────────────────────────────────────────
  // Fixed-position floating panel, appended directly to document.body — see
  // the file header for why. Unconditional once document.body exists; there
  // is nothing to search for and nothing that can fail to be found.

  function readSavedPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || typeof p.left !== 'number' || typeof p.top !== 'number') return null;
      return p;
    } catch (_) {
      return null;
    }
  }

  function savePos(left, top, dragged) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left, top, dragged: !!dragged }));
    } catch (_) {
      /* private mode / blocked storage — position just isn't remembered */
    }
  }

  function applyLeftTop(el, left, top) {
    if (!el) return;
    const wr = el.getBoundingClientRect();
    const w = wr.width || 340;
    const h = wr.height || 80;
    const maxL = Math.max(8, window.innerWidth - w - 8);
    const maxT = Math.max(8, window.innerHeight - h - 8);
    left = Math.max(8, Math.min(left, maxL));
    top = Math.max(8, Math.min(top, maxT));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  let _userDragged = false;
  let _skipToggle = false;

  function placePanel(el) {
    if (!el) return;
    const saved = readSavedPos();
    if (saved && saved.dragged) _userDragged = true;
    if (_userDragged && saved) {
      applyLeftTop(el, saved.left, saved.top);
      return;
    }
    // Default dock: top-right, same convention as document-codes-to-problems.js
    // — clear of Medicus's own top bar/breadcrumb, and applyLeftTop's own
    // clamp keeps it on-screen at any viewport size.
    applyLeftTop(el, window.innerWidth - 340 - 20, 72);
  }

  function enableDrag(el) {
    const header = el.querySelector('.ms-tap-header');
    if (!header || header.dataset.msTapDrag === '1') return;
    header.dataset.msTapDrag = '1';
    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let sl = 0;
    let st = 0;

    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!moved && dx * dx + dy * dy < 25) return;
      moved = true;
      _skipToggle = true;
      el.classList.add('ms-tap-dragging');
      applyLeftTop(el, sl + dx, st + dy);
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('ms-tap-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', endDrag);
      window.removeEventListener('blur', endDrag);
      // A drag that ends off the toggle never fires the click that consumes
      // _skipToggle — left set, it would silently swallow the NEXT
      // legitimate collapse click. Deferred reset lets a same-target click
      // be suppressed and then always clears the flag.
      setTimeout(() => {
        _skipToggle = false;
      }, 0);
      if (!moved) return;
      _userDragged = true;
      const r = el.getBoundingClientRect();
      savePos(r.left, r.top, true);
    }

    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, input, select, textarea')) return;
      const rect = el.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      sl = rect.left;
      st = rect.top;
      dragging = true;
      moved = false;
      _skipToggle = false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', endDrag);
      window.addEventListener('blur', endDrag);
    });
  }

  function injectWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    const w = document.createElement('div');
    w.id = WIDGET_ID;
    renderInto(w);
    withObserverPaused(() => document.body.appendChild(w));
    requestAnimationFrame(() => placePanel(w));
  }

  // Release any held slot reservation before tearing the widget out — used
  // when leaving a task-overview page. Without this the reservation would
  // stay locked for other bookers until the backend TTL expires.
  function removeWidget() {
    const w = document.getElementById(WIDGET_ID);
    if (!w) return;
    if (s.bk.reservationId) apiReleaseReservation(s.bk.reservationId);
    withObserverPaused(() => w.remove());
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    const w = document.getElementById(WIDGET_ID);
    if (w) renderInto(w);
  }

  function outerHeaderHtml() {
    return (
      '<div class="ms-tap-header">' +
      '<span class="ms-tap-grip" title="Drag to move" aria-hidden="true"></span>' +
      '<span class="ms-tap-header-toggle" id="ms-tap-toggle" role="button" tabindex="0" aria-expanded="' +
      !s.collapsed +
      '">' +
      '<span class="ms-tap-chevron">' +
      (s.collapsed ? '▸' : '▾') +
      '</span>' +
      '<span>Patient actions</span>' +
      '</span>' +
      '</div>'
    );
  }

  function buildHtml() {
    if (s.collapsed) return outerHeaderHtml();
    const showRecord = s.rec.applicable === true;
    return (
      outerHeaderHtml() +
      '<div class="ms-tap-body">' +
      (showRecord ? recordSectionHtml() : '') +
      bookingSectionHtml() +
      taskSectionHtml() +
      '</div>'
    );
  }

  // ── Patient-record section (triage tasks only) ───────────────────────────────

  function apptStatusLabel(a) {
    return (a.appointmentStatus && a.appointmentStatus.label) || (a.displayStatus && a.displayStatus.label) || '';
  }

  function apptStatusValue(a) {
    return (a.appointmentStatus && a.appointmentStatus.value) || 'unknown';
  }

  function renderApptRow(a) {
    const typeName = (a.appointmentType && a.appointmentType.name) || a.serviceName || 'Appointment';
    const when = a.formattedDateTimeRange || a.startDateTime || '';
    const withWho = a.assignees ? ' with ' + esc(a.assignees) : '';
    return (
      '<li class="ms-tap-rec-row">' +
      '<div class="ms-tap-rec-row-top">' +
      '<span class="ms-tap-rec-when">' +
      esc(when) +
      '</span>' +
      '<span class="ms-tap-rec-status ms-tap-rec-status-' +
      esc(apptStatusValue(a)) +
      '">' +
      esc(apptStatusLabel(a)) +
      '</span>' +
      '</div>' +
      '<div class="ms-tap-rec-row-detail">' +
      esc(typeName) +
      withWho +
      '</div>' +
      '</li>'
    );
  }

  function renderLinkRow(l) {
    const reason =
      l.predefinedReasonForAppointment && l.predefinedReasonForAppointment !== '-'
        ? l.predefinedReasonForAppointment
        : '';
    const typeName = l.appointmentType || l.appointmentService || 'Appointment';
    return (
      '<li class="ms-tap-rec-row">' +
      '<div class="ms-tap-rec-row-top">' +
      '<span class="ms-tap-rec-when">Sent ' +
      esc(l.created || '') +
      '</span>' +
      '</div>' +
      '<div class="ms-tap-rec-row-detail">' +
      esc(typeName) +
      '</div>' +
      (reason ? '<div class="ms-tap-rec-row-reason">“' + esc(reason) + '”</div>' : '') +
      '</li>'
    );
  }

  function renderRecordBody() {
    const rec = s.rec;
    const apptsHtml = rec.appointments.length
      ? '<ul class="ms-tap-rec-list">' + rec.appointments.map(renderApptRow).join('') + '</ul>'
      : '<div class="ms-tap-rec-empty">No future appointments.</div>';
    const linksHtml = rec.bookingLinks.length
      ? '<ul class="ms-tap-rec-list">' + rec.bookingLinks.map(renderLinkRow).join('') + '</ul>'
      : '<div class="ms-tap-rec-empty">No unused booking links.</div>';
    return (
      '<div class="ms-tap-section-body">' +
      '<div class="ms-tap-rec-group">' +
      '<div class="ms-tap-rec-heading">Future appointments</div>' +
      apptsHtml +
      '</div>' +
      '<div class="ms-tap-rec-group">' +
      '<div class="ms-tap-rec-heading">Unused booking links</div>' +
      linksHtml +
      '</div>' +
      '</div>'
    );
  }

  function recordSectionHtml() {
    const rec = s.rec;
    let body = '';
    if (rec.open) {
      if (rec.loading) {
        body = '<div class="ms-tap-section-body"><div class="ms-tap-loading">Loading patient record…</div></div>';
      } else if (rec.error) {
        body = '<div class="ms-tap-section-body"><div class="ms-tap-error">' + esc(rec.error) + '</div></div>';
      } else {
        body = renderRecordBody();
      }
    }
    return (
      '<div class="ms-tap-section">' +
      '<div class="ms-tap-section-header" id="ms-tap-rec-toggle" role="button" tabindex="0" aria-expanded="' +
      rec.open +
      '">' +
      '<span class="ms-tap-chevron">' +
      (rec.open ? '▾' : '▸') +
      '</span>' +
      '<span>Patient record</span>' +
      '</div>' +
      body +
      '</div>'
    );
  }

  // ── Booking section (ported from booking-inline.js) ─────────────────────────

  function renderBookingBrowse() {
    const bk = s.bk;
    const typesHtml =
      bk.types.length === 0
        ? '<option value="" disabled>No appointment types found</option>'
        : bk.types
            .map(
              (t) =>
                `<option value="${esc(t.value)}"${bk.selectedTypeId === t.value ? ' selected' : ''}>${esc(t.label)}</option>`
            )
            .join('');

    let slotsHtml = '';
    if (bk.slotsLoading) {
      slotsHtml = `<div class="ms-tap-loading">Searching for slots…</div>`;
    } else if (bk.slotsError) {
      slotsHtml = `<div class="ms-tap-error">${esc(bk.slotsError)}</div>`;
    } else if (bk.hasSearched && bk.slots && bk.slots.length > 0) {
      slotsHtml = `<div class="ms-tap-bk-slot-list">${bk.slots
        .map(
          (sl, i) => `
        <button class="ms-tap-bk-slot" data-idx="${i}">
          <span class="ms-tap-bk-slot-time">${esc(slotTime(sl.startDateTime))}–${esc(slotTime(sl.endDateTime))}</span>
          <span class="ms-tap-bk-slot-dur">${esc(sl.formattedDuration || sl.duration + ' mins')}</span>
          <span class="ms-tap-bk-slot-site">${esc(sl.siteName || '')}</span>
        </button>`
        )
        .join('')}</div>`;
    } else if (bk.hasSearched) {
      slotsHtml = `<div class="ms-tap-no-slots">No available slots on this date.</div>`;
    }

    const canSearch = bk.selectedTypeId && bk.date && !bk.slotsLoading;
    return `
      <div class="ms-tap-section-body">
        ${!bk.patientId ? '<div class="ms-tap-warn">Could not determine patient ID — try navigating away and back.</div>' : ''}
        <div class="ms-tap-row">
          <label class="ms-tap-label" for="ms-tap-bk-type">Appointment type</label>
          <select class="ms-tap-select" id="ms-tap-bk-type"${bk.types.length === 0 ? ' disabled' : ''}>
            <option value="">— select type —</option>
            ${typesHtml}
          </select>
        </div>
        <div class="ms-tap-row">
          <label class="ms-tap-label" for="ms-tap-bk-date">Date</label>
          <input type="date" class="ms-tap-date-input" id="ms-tap-bk-date" value="${esc(bk.date)}" max="2099-12-31" />
        </div>
        <button class="ms-tap-btn" id="ms-tap-bk-find"${canSearch ? '' : ' disabled'}>Find slots</button>
        ${slotsHtml}
      </div>
    `;
  }

  function renderBookingConfirm() {
    const bk = s.bk;
    const sl = bk.selectedSlot;
    const timeStr = sl
      ? `${esc(slotTime(sl.startDateTime))}–${esc(slotTime(sl.endDateTime))} (${esc(sl.formattedDuration || sl.duration + ' mins')})`
      : '';
    return `
      <div class="ms-tap-section-body">
        <div class="ms-tap-summary">
          <div><strong>${esc(bk.date)}</strong> at ${timeStr}</div>
          ${sl?.siteName ? `<div>${esc(sl.siteName)}</div>` : ''}
          ${sl?.appointmentType?.name ? `<div>${esc(sl.appointmentType.name)}</div>` : ''}
        </div>
        <div class="ms-tap-row">
          <label class="ms-tap-label" for="ms-tap-bk-reason">Reason <span style="font-weight:400;text-transform:none;color:#999">(optional)</span></label>
          <input type="text" class="ms-tap-text-input" id="ms-tap-bk-reason" value="${esc(bk.reason)}" placeholder="Reason for appointment" maxlength="255" />
        </div>
        ${bk.confirmError ? `<div class="ms-tap-error">${esc(bk.confirmError)}</div>` : ''}
        <div class="ms-tap-actions">
          <button class="ms-tap-btn-ghost" id="ms-tap-bk-back"${bk.confirming ? ' disabled' : ''}>Back</button>
          <button class="ms-tap-btn" id="ms-tap-bk-confirm"${bk.confirming ? ' disabled' : ''}>${bk.confirming ? 'Booking…' : 'Confirm booking'}</button>
        </div>
      </div>
    `;
  }

  function renderBookingBooked() {
    const bk = s.bk;
    const sl = bk.selectedSlot;
    return `
      <div class="ms-tap-section-body ms-tap-success">
        <div class="ms-tap-success-icon">✓</div>
        <div><strong>Appointment booked</strong></div>
        <div>${esc(bk.date)}${sl ? ` at ${esc(slotTime(sl.startDateTime))}` : ''}</div>
        <button class="ms-tap-btn-ghost" id="ms-tap-bk-again">Book another</button>
      </div>
    `;
  }

  function bookingSectionHtml() {
    const bk = s.bk;
    let body = '';
    if (bk.open) {
      if (bk.loading) {
        body = `<div class="ms-tap-section-body"><div class="ms-tap-loading">Loading appointment types…</div></div>`;
      } else if (bk.error) {
        body = `<div class="ms-tap-section-body"><div class="ms-tap-error">${esc(bk.error)}</div></div>`;
      } else if (bk.step === 'booked') {
        body = renderBookingBooked();
      } else if (bk.step === 'confirm') {
        body = renderBookingConfirm();
      } else {
        body = renderBookingBrowse();
      }
    }
    return `
      <div class="ms-tap-section">
        <div class="ms-tap-section-header" id="ms-tap-bk-toggle" role="button" tabindex="0" aria-expanded="${bk.open}">
          <span class="ms-tap-chevron">${bk.open ? '▾' : '▸'}</span>
          <span>Book appointment for this patient</span>
        </div>
        ${body}
      </div>
    `;
  }

  // ── Create-task section (ported from task-inline.js) ────────────────────────

  function taskAssigneeOptionsHtml() {
    const tk = s.tk;
    function opts(list) {
      return list
        .map((o) => {
          const val = `${o.type}|${o.value}`;
          return `<option value="${esc(val)}"${tk.assignee === val ? ' selected' : ''}>${esc(o.label)}</option>`;
        })
        .join('');
    }
    let html = '<option value="">— select —</option>';
    if (tk.teams.length) html += `<optgroup label="Teams">${opts(tk.teams)}</optgroup>`;
    if (tk.staff.length) html += `<optgroup label="Staff">${opts(tk.staff)}</optgroup>`;
    return html;
  }

  function taskPriorityOptionsHtml() {
    const tk = s.tk;
    return tk.priorities
      .map(
        (p) =>
          `<option value="${esc(p.value)}"${String(tk.priority) === String(p.value) ? ' selected' : ''}>${esc(p.label)}</option>`
      )
      .join('');
  }

  function renderTaskForm() {
    const tk = s.tk;
    const canCreate = tk.description.trim() && tk.assignee && !tk.creating;
    return `
      <div class="ms-tap-section-body">
        ${!tk.patientId ? '<div class="ms-tap-warn">Could not determine patient ID — try navigating away and back.</div>' : ''}
        <div class="ms-tap-row">
          <label class="ms-tap-label" for="ms-tap-tk-assignee">Assign to</label>
          <select class="ms-tap-select" id="ms-tap-tk-assignee">${taskAssigneeOptionsHtml()}</select>
        </div>
        <div class="ms-tap-row">
          <label class="ms-tap-label" for="ms-tap-tk-desc">Details</label>
          <textarea class="ms-tap-textarea" id="ms-tap-tk-desc" rows="3" placeholder="What needs doing?" maxlength="2000">${esc(tk.description)}</textarea>
        </div>
        ${
          tk.priorities.length > 1
            ? `<div class="ms-tap-row">
                 <label class="ms-tap-label" for="ms-tap-tk-priority">Priority</label>
                 <select class="ms-tap-select" id="ms-tap-tk-priority">${taskPriorityOptionsHtml()}</select>
               </div>`
            : ''
        }
        ${tk.createError ? `<div class="ms-tap-error">${esc(tk.createError)}</div>` : ''}
        <button class="ms-tap-btn" id="ms-tap-tk-create"${canCreate ? '' : ' disabled'}>${tk.creating ? 'Creating…' : 'Create task'}</button>
      </div>
    `;
  }

  function renderTaskCreated() {
    const tk = s.tk;
    return `
      <div class="ms-tap-section-body ms-tap-success">
        <div class="ms-tap-success-icon">✓</div>
        <div><strong>Task created</strong></div>
        ${tk.createdAssignee ? `<div>Assigned to ${esc(tk.createdAssignee)}</div>` : ''}
        <button class="ms-tap-btn-ghost" id="ms-tap-tk-again">Create another</button>
      </div>
    `;
  }

  function taskSectionHtml() {
    const tk = s.tk;
    let body = '';
    if (tk.open) {
      if (tk.loading) {
        body = `<div class="ms-tap-section-body"><div class="ms-tap-loading">Loading task form…</div></div>`;
      } else if (tk.error) {
        body = `<div class="ms-tap-section-body"><div class="ms-tap-error">${esc(tk.error)}</div></div>`;
      } else if (tk.step === 'created') {
        body = renderTaskCreated();
      } else {
        body = renderTaskForm();
      }
    }
    return `
      <div class="ms-tap-section">
        <div class="ms-tap-section-header" id="ms-tap-tk-toggle" role="button" tabindex="0" aria-expanded="${tk.open}">
          <span class="ms-tap-chevron">${tk.open ? '▾' : '▸'}</span>
          <span>Create task for this patient</span>
        </div>
        ${body}
      </div>
    `;
  }

  // ── Actions: patient record ───────────────────────────────────────────────────
  // Read-only — no wrong-patient WRITE guard needed (nothing is written), but
  // still pins the sub-state and re-checks the task hasn't changed mid-fetch,
  // so a slow response for a task the clinician already left can't paint a
  // stranger's appointments under the current one.

  async function loadPatientRecord(info) {
    const rec = s.rec;
    rec.checking = true;
    rec.error = null;
    rerender();
    const st = rec;

    // Stage 1 — classify. A failure here means we cannot tell what kind of
    // thread this is at all; stay hidden rather than guess (fail closed).
    let overview;
    try {
      overview = await apiFetchTaskOverview(info.typeSlug, info.taskUuid);
    } catch (_) {
      if (st === s.rec) {
        st.checking = false;
        rerender();
      }
      return;
    }
    if (st !== s.rec) return;
    const classification = classifyPatientRequest(overview);
    st.checking = false;
    if (!classification.isTriage) {
      st.applicable = false;
      st.loadedForTask = info.taskUuid;
      rerender();
      return;
    }

    // Stage 2 — confirmed medical/admin request: the section is now known to
    // belong here, so a failure from here on shows an error rather than
    // silently nothing.
    st.applicable = true;
    st.patientId = classification.patientId;
    st.loading = true;
    rerender();
    try {
      if (!st.patientId) throw new Error('Could not determine the patient for this task.');
      const [appointments, bookingLinks] = await Promise.all([
        apiFetchAppointments(st.patientId),
        apiFetchBookingLinks(st.patientId),
      ]);
      if (st !== s.rec) return;
      const now = nowDateTimeString();
      st.appointments = appointments
        .filter((a) => a && typeof a.startDateTime === 'string' && a.startDateTime > now)
        .sort((a, b) => (a.startDateTime < b.startDateTime ? -1 : a.startDateTime > b.startDateTime ? 1 : 0));
      st.bookingLinks = bookingLinks.filter((l) => l && l.appointmentBooked === 'No');
    } catch (err) {
      st.error = (err && err.message) || 'Could not load the patient record.';
    } finally {
      st.loading = false;
      st.loadedForTask = info.taskUuid;
      if (st === s.rec) rerender();
    }
  }

  // ── Actions: booking ──────────────────────────────────────────────────────────

  async function doOpenBooking() {
    s.bk.open = true;
    // Cached for this task — state is reset on SPA navigation, so if
    // patient/provider/types are already populated nothing changed; just
    // reveal the form instead of re-resolving the patient and re-fetching.
    if (s.bk.patientId && s.bk.providerId && s.bk.types.length) {
      rerender();
      return;
    }
    s.bk.loading = true;
    s.bk.error = null;
    rerender();
    // WRONG-PATIENT GUARD (audit C1, 2026-07-18): pin THIS section's state
    // object before awaiting. Navigation replaces `s` (and therefore `s.bk`)
    // wholesale — without the pin, a resolution still in flight for task A
    // could land its patientId in task B's state. All writes go to the
    // pinned `st`; if `st !== s.bk` after an await, the results belong to a
    // task no longer on screen and are discarded.
    const st = s.bk;
    try {
      const info = getTaskInfo();
      // patient-id resolution and the appointment finder are independent —
      // run them in parallel so open latency is one round-trip, not two.
      const [patientId, finder] = await Promise.all([
        info ? resolvePatientId(info.typeSlug, info.taskUuid) : Promise.resolve(null),
        apiFetchFinder(),
      ]);
      if (st !== s.bk) return;
      st.patientId = patientId;
      st.providerId = finder.localOrganisationDetails?.id || null;
      const types = [];
      for (const svc of finder.localOrganisationDetails?.services || []) {
        for (const t of svc.appointmentTypes || []) {
          if (!types.some((e) => e.value === t.value)) types.push({ value: t.value, label: t.label });
        }
      }
      st.types = types;
      if (types.length === 1) st.selectedTypeId = types[0].value;
    } catch (err) {
      st.error = err.message || 'Failed to load appointment types.';
    } finally {
      st.loading = false;
      if (st === s.bk) rerender();
    }
  }

  async function doFindSlots() {
    const bk = s.bk;
    if (!bk.providerId || !bk.selectedTypeId || !bk.date) return;
    bk.slotsLoading = true;
    bk.slotsError = null;
    bk.slots = null;
    bk.hasSearched = false;
    rerender();
    const st = s.bk; // audit C1 pin
    try {
      st.slots = await apiFetchSlots({
        providerId: st.providerId,
        appointmentTypeId: st.selectedTypeId,
        date: st.date,
      });
    } catch (err) {
      st.slotsError = err.message || 'Failed to fetch available slots.';
    } finally {
      st.slotsLoading = false;
      st.hasSearched = true;
      if (st === s.bk) rerender();
    }
  }

  async function doSelectSlot(slot) {
    s.bk.slotsLoading = true;
    s.bk.slotsError = null;
    rerender();
    const st = s.bk; // audit C1 pin — a reservation must not land in a later task's state
    try {
      const result = await apiReserve({
        diaryId: slot.diaryId,
        startDateTime: slot.startDateTime,
        duration: slot.duration,
        appointmentTypeId: slot.appointmentType?.id,
      });
      if (st !== s.bk) {
        // Navigated while reserving — release the orphan reservation, never
        // attach it to the new task's state.
        apiReleaseReservation(result.slotReservationId);
        return;
      }
      st.reservationId = result.slotReservationId;
      st.selectedSlot = slot;
      st.step = 'confirm';
      st.confirmError = null;
      st.reason = '';
    } catch (err) {
      st.slotsError = err.message || 'Could not reserve slot — it may have just been taken.';
    } finally {
      st.slotsLoading = false;
      if (st === s.bk) rerender();
    }
  }

  function doBookingBack() {
    if (s.bk.reservationId) apiReleaseReservation(s.bk.reservationId);
    s.bk.reservationId = null;
    s.bk.selectedSlot = null;
    s.bk.step = 'browse';
    s.bk.confirmError = null;
    rerender();
  }

  async function doConfirmBooking() {
    const bk = s.bk;
    if (bk.confirming || !bk.reservationId || !bk.patientId || !bk.selectedSlot) return;
    bk.confirming = true;
    bk.confirmError = null;
    rerender();
    // WRONG-PATIENT GUARD (audit C1): pin the state, then HARD re-verify at
    // commit time that the task on screen is still the task this state
    // belongs to AND that it still resolves to the same patient. Booking is
    // a clinical WRITE; it must never fire off a stale identity.
    const st = s.bk;
    try {
      const info = getTaskInfo();
      if (!info || s.taskUuid !== info.taskUuid || st !== s.bk) {
        throw new Error('Task changed — reopen the booking panel.');
      }
      const verifiedPatientId = await resolvePatientId(info.typeSlug, info.taskUuid);
      if (st !== s.bk) return; // navigated during verification — abort silently
      if (!verifiedPatientId || verifiedPatientId !== st.patientId) {
        throw new Error('Patient could not be re-verified for this task — reopen the booking panel.');
      }
      const formData = await apiFetchCreateForm({
        slotReservationId: st.reservationId,
        patientId: st.patientId,
      });
      if (st !== s.bk) return; // navigated — do not book
      const sl = st.selectedSlot;
      const payload = {
        context: 'create-booked-appointment',
        appointmentTemporalType: 'timed',
        appointmentTypeId: sl.appointmentType?.id,
        patientId: st.patientId,
        deliveryMode: formData.deliveryMode || sl.defaultDeliveryMode?.value || 'face-to-face',
        intendedDuration: sl.duration,
        diaryId: sl.diaryId,
        isHighPriority: false,
        isHiddenFromPatientFacingServices: false,
        intendedStartDateTime: sl.startDateTime,
        reasonForAppointment: st.reason || null,
        additionalInformation: null,
        embargoOverrideReason: null,
        slotReservationId: st.reservationId,
        nhsNationalSlotTypeCategory:
          formData.nhsNationalSlotTypeCategory || sl.nhsNationalSlotTypeCategoryDefault?.value || '10127',
        allowOverlappingAppointments: 'allow',
        gpadReportingExceptionReasons: [],
        clinicalCaseId: null,
        bookingConfirmationRecipients: (formData.bookingConfirmationRecipientOptions || []).map((o) => o.value),
        rescheduledAppointmentVersionId: null,
      };
      const result = await apiCreateAppointment(payload);
      st.bookedId = result.appointmentId;
      st.reservationId = null;
      st.step = 'booked';
    } catch (err) {
      st.confirmError = err.message || 'Booking failed — please try again.';
    } finally {
      st.confirming = false;
      if (st === s.bk) rerender();
    }
  }

  // ── Actions: create task ──────────────────────────────────────────────────────

  function taskAssigneeLabel(encoded) {
    const all = s.tk.teams.concat(s.tk.staff);
    const hit = all.find((o) => `${o.type}|${o.value}` === encoded);
    return hit ? hit.label : '';
  }

  async function doOpenTask() {
    s.tk.open = true;
    if (s.tk.patientId && (s.tk.teams.length || s.tk.staff.length)) {
      s.tk.error = null;
      rerender();
      return;
    }
    s.tk.loading = true;
    s.tk.error = null;
    rerender();
    // WRONG-PATIENT GUARD (audit C1) — same pin discipline as doOpenBooking.
    const st = s.tk;
    try {
      const info = getTaskInfo();
      if (info) st.patientId = await resolvePatientId(info.typeSlug, info.taskUuid);
      if (st !== s.tk) return; // navigated mid-resolution — discard
      if (!st.patientId) throw new Error('Could not determine the patient for this task.');
      const form = await apiFetchTaskForm(st.patientId);
      if (st !== s.tk) return; // navigated during the form fetch — discard
      st.teams = (form.assigneeOptions && form.assigneeOptions.teams) || [];
      st.staff = (form.assigneeOptions && form.assigneeOptions.staff) || [];
      const pri = Array.isArray(form.priorityOptions)
        ? form.priorityOptions.map((o) => ({ value: o.value, label: o.label }))
        : [];
      st.priorities = pri.length ? pri : [{ value: 0, label: 'Normal' }];
      const def =
        st.priorities.find((p) => String(p.label).toLowerCase() === 'normal') ||
        st.priorities.find((p) => p.value === 0) ||
        st.priorities[0];
      st.priority = def ? def.value : 0;
    } catch (err) {
      st.error = err.message || 'Failed to load the task form.';
    } finally {
      st.loading = false;
      if (st === s.tk) rerender();
    }
  }

  async function doCreateTask() {
    const tk = s.tk;
    if (tk.creating || !tk.patientId || !tk.assignee || !tk.description.trim()) return;
    tk.creating = true;
    tk.createError = null;
    rerender();
    // WRONG-PATIENT GUARD (audit C1): pin the state and HARD re-verify the
    // on-screen task still resolves to this patient before the write — task
    // creation is a clinical write and must never fire off a stale identity.
    const st = s.tk;
    try {
      const info = getTaskInfo();
      if (!info || s.taskUuid !== info.taskUuid || st !== s.tk) {
        throw new Error('Task changed — reopen the panel.');
      }
      const verifiedPatientId = await resolvePatientId(info.typeSlug, info.taskUuid);
      if (st !== s.tk) return; // navigated during verification — abort silently
      if (!verifiedPatientId || verifiedPatientId !== st.patientId) {
        throw new Error('Patient could not be re-verified for this task — reopen the panel.');
      }
      const sep = st.assignee.indexOf('|');
      const assigneeType = st.assignee.slice(0, sep);
      const assigneeId = st.assignee.slice(sep + 1);
      const payload = {
        patientId: st.patientId,
        contextId: null,
        contextType: null,
        assigneeId,
        assigneeType,
        description: st.description.trim(),
        priority: Number(st.priority) || 0,
        snoozeUntil: null,
      };
      await apiCreateTask(payload);
      if (st !== s.tk) return; // task created for the pinned identity; UI state is gone
      st.createdAssignee = taskAssigneeLabel(st.assignee);
      st.step = 'created';
    } catch (err) {
      st.createError = err.message || 'Failed to create the task — please try again.';
    } finally {
      st.creating = false;
      if (st === s.tk) rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    const outerToggle = el.querySelector('#ms-tap-toggle');
    if (outerToggle) {
      outerToggle.addEventListener('click', (e) => {
        if (_skipToggle) {
          _skipToggle = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        s.collapsed = !s.collapsed;
        rerender();
        const w = document.getElementById(WIDGET_ID);
        if (w && !_userDragged) placePanel(w);
      });
      outerToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          outerToggle.click();
        }
      });
    }

    // Patient-record section — display toggle only, does not affect loading
    // (which is eager and independent of whether the section is expanded).
    const recToggle = el.querySelector('#ms-tap-rec-toggle');
    if (recToggle) {
      recToggle.addEventListener('click', () => {
        s.rec.open = !s.rec.open;
        rerender();
      });
      recToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          recToggle.click();
        }
      });
    }

    // Booking section
    const bkToggle = el.querySelector('#ms-tap-bk-toggle');
    if (bkToggle) {
      bkToggle.addEventListener('click', () => {
        if (s.bk.open) {
          if (s.bk.reservationId) apiReleaseReservation(s.bk.reservationId);
          s.bk.open = false;
          s.bk.reservationId = null;
          if (s.bk.step === 'confirm') {
            s.bk.step = 'browse';
            s.bk.selectedSlot = null;
          }
          rerender();
        } else {
          doOpenBooking();
        }
      });
      bkToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          bkToggle.click();
        }
      });
    }

    el.querySelector('#ms-tap-bk-type')?.addEventListener('change', (e) => {
      s.bk.selectedTypeId = e.target.value;
      s.bk.slots = null;
      s.bk.hasSearched = false;
      s.bk.slotsError = null;
      rerender();
    });

    el.querySelector('#ms-tap-bk-date')?.addEventListener('change', (e) => {
      s.bk.date = e.target.value;
      s.bk.slots = null;
      s.bk.hasSearched = false;
      s.bk.slotsError = null;
      rerender();
    });

    el.querySelector('#ms-tap-bk-find')?.addEventListener('click', () => doFindSlots());

    el.querySelectorAll('.ms-tap-bk-slot').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const slot = s.bk.slots?.[idx];
        if (slot) doSelectSlot(slot);
      });
    });

    el.querySelector('#ms-tap-bk-reason')?.addEventListener('input', (e) => {
      s.bk.reason = e.target.value;
    });

    el.querySelector('#ms-tap-bk-back')?.addEventListener('click', () => doBookingBack());
    el.querySelector('#ms-tap-bk-confirm')?.addEventListener('click', () => doConfirmBooking());
    el.querySelector('#ms-tap-bk-again')?.addEventListener('click', () => {
      const { patientId, providerId, types } = s.bk;
      s.bk = blankBookingState();
      s.bk.open = true;
      s.bk.patientId = patientId;
      s.bk.providerId = providerId;
      s.bk.types = types;
      rerender();
    });

    // Create-task section
    const tkToggle = el.querySelector('#ms-tap-tk-toggle');
    if (tkToggle) {
      tkToggle.addEventListener('click', () => {
        if (s.tk.open) {
          s.tk.open = false;
          rerender();
        } else {
          doOpenTask();
        }
      });
      tkToggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tkToggle.click();
        }
      });
    }

    el.querySelector('#ms-tap-tk-assignee')?.addEventListener('change', (e) => {
      s.tk.assignee = e.target.value;
      rerender();
    });

    // Don't rerender on each keystroke (it would drop focus); just keep
    // state and toggle the Create button's enabled flag live.
    const createBtn = el.querySelector('#ms-tap-tk-create');
    el.querySelector('#ms-tap-tk-desc')?.addEventListener('input', (e) => {
      s.tk.description = e.target.value;
      if (createBtn) createBtn.disabled = !(s.tk.description.trim() && s.tk.assignee && !s.tk.creating);
    });

    el.querySelector('#ms-tap-tk-priority')?.addEventListener('change', (e) => {
      s.tk.priority = e.target.value;
    });

    el.querySelector('#ms-tap-tk-create')?.addEventListener('click', () => doCreateTask());

    el.querySelector('#ms-tap-tk-again')?.addEventListener('click', () => {
      const { patientId, teams, staff, priorities, priority } = s.tk;
      s.tk = blankTaskState();
      s.tk.open = true;
      s.tk.patientId = patientId;
      s.tk.teams = teams;
      s.tk.staff = staff;
      s.tk.priorities = priorities;
      s.tk.priority = priority;
      rerender();
    });

    enableDrag(el);
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────
  // Same discipline as the retired widgets (own-mutation filter, throttle,
  // animation-frame deferral, remove-on-leave) — except there is no anchor
  // scan any more, so runInject's only jobs are: is this a task-overview
  // page, has the task changed, and is the panel currently on screen.

  let _lastPath = location.pathname;
  let _throttle = null;
  let _obs = null;

  function observeBody() {
    if (_obs) _obs.observe(document.body, { childList: true, subtree: true });
  }

  function withObserverPaused(fn) {
    if (!_obs) {
      fn();
      return;
    }
    _obs.disconnect();
    try {
      fn();
    } finally {
      observeBody();
    }
  }

  function _isOwnWidgetMutation(mutations) {
    for (const m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#' + WIDGET_ID)) {
        continue;
      }
      for (const nodes of [m.addedNodes, m.removedNodes]) {
        for (const n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === WIDGET_ID) continue;
          if (n.closest && n.closest('#' + WIDGET_ID)) continue;
          return false;
        }
      }
    }
    return true;
  }

  function onMutations(mutations) {
    if (_isOwnWidgetMutation(mutations)) return;
    scheduleInject();
  }

  function scheduleInject() {
    if (_throttle) return;
    // Document-filing task pages have Medicus's own direct /task and
    // /appointment access already (confirmed with Dave, 2026-08-19) — this
    // panel would only be a redundant duplicate there.
    const info = getTaskInfo();
    const onTaskPage = !!info && info.typeSlug !== 'document';
    const pathChanged = location.pathname !== _lastPath;
    if (!onTaskPage && !pathChanged) return;
    if (onTaskPage && !pathChanged) {
      const existing = document.getElementById(WIDGET_ID);
      if (existing && existing.isConnected) return;
    }
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    const currentPath = location.pathname;
    if (currentPath !== _lastPath) {
      _lastPath = currentPath;
      if (s.bk.reservationId) apiReleaseReservation(s.bk.reservationId);
      s = blankState();
    }
    if (document.hidden) return;
    const info = getTaskInfo();
    if (!info || info.typeSlug === 'document') {
      removeWidget();
      return;
    }
    s.taskUuid = info.taskUuid;
    if (
      isCommunicationThreadSlug(info.typeSlug) &&
      s.rec.loadedForTask !== info.taskUuid &&
      !s.rec.checking &&
      !s.rec.loading
    ) {
      loadPatientRecord(info);
    }
    const existing = document.getElementById(WIDGET_ID);
    if (existing && existing.isConnected) return;
    requestAnimationFrame(() => {
      if (document.hidden) return;
      const w = document.getElementById(WIDGET_ID);
      if (w && w.isConnected) return;
      injectWidget();
    });
  }

  const _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(onMutations);
  } else {
    _obs = new MutationObserver(onMutations);
    observeBody();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleInject();
  });

  window.addEventListener('resize', () => {
    const w = document.getElementById(WIDGET_ID);
    if (w) placePanel(w);
  });

  // Release any held slot reservation if the tab is closed/navigated
  // mid-booking — pagehide (not unload) fires on bfcache too; keepalive
  // lets the POST complete past teardown.
  window.addEventListener('pagehide', () => {
    if (s.bk.reservationId) apiReleaseReservation(s.bk.reservationId);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInject);
  } else {
    scheduleInject();
  }
})();
