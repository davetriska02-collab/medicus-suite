// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Inline booking widget for task pages.
//
// Injects a collapsible "Book appointment" panel below the "Codes & actions"
// section on patient-request / task overview pages. Fetches to /scheduling/*
// are same-origin from the content script context (page is on england.medicus.health)
// so no bridge is needed here.
'use strict';

(function () {
  if (window.__msBkInline) return;
  window.__msBkInline = true;

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

  // ── State ─────────────────────────────────────────────────────────────────────

  function blankState() {
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
      step: 'browse',
      selectedSlot: null,
      reservationId: null,
      confirming: false,
      confirmError: null,
      reason: '',
      bookedId: null,
    };
  }

  let s = blankState();

  // ── API ───────────────────────────────────────────────────────────────────────

  // Resolve task UUID → patient UUID via the API subdomain.
  // The API subdomain allows CORS from england.medicus.health (Medicus's own SPA
  // fetches from it constantly), so this works from the content script context.
  async function resolvePatientId(siteId, typeSlug, taskUuid) {
    const apiBase = `https://${siteId}.api.${location.hostname}`;
    const resp = await fetch(`${apiBase}/tasks/data/${typeSlug}/overview/${taskUuid}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Task resolve ${resp.status}`);
    const data = await resp.json();
    return data?.data?.patient?.id || data?.data?.patientId || data?.patient?.id || data?.patientId || null;
  }

  // The /scheduling/* API lives on the API subdomain ({siteId}.api.<host>) — the
  // SAME host the slots-overview call uses — NOT the page host. The page host
  // (england.medicus.health) serves the SPA HTML shell for /scheduling/*, which
  // is what produced the "Unexpected token '<'" JSON errors. The API subdomain
  // allows CORS from the page origin (Medicus's own SPA calls it the same way).
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
    });
    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Scheduling API returned an unexpected response.');
    }
  }

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
    }).catch(() => {});
  }

  // ── DOM injection ─────────────────────────────────────────────────────────────

  // Find the whole "Codes & actions" CARD so we can insert our widget directly
  // after it (below the section, not inside it). The card is the smallest
  // ancestor of the section heading that ALSO contains the form's "Submit"
  // button — i.e. the lowest common ancestor of the heading and the Submit
  // button, which is exactly the bounding card.
  function findCard() {
    let heading = null;
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b,legend,div,span,p')) {
      const txt = el.textContent.trim();
      if (!/^Codes\s*(?:&|&amp;|and)\s*actions$/i.test(txt)) continue;
      if (el.closest('#ms-bk-widget')) continue;
      heading = el;
      break;
    }
    if (!heading) return null;
    let node = heading.parentElement;
    let fallback = node;
    while (node && node !== document.body) {
      const btns = node.querySelectorAll('button, [role="button"], input[type="submit"]');
      for (const b of btns) {
        if (/^submit$/i.test((b.value || b.textContent || '').trim())) return node;
      }
      fallback = node;
      node = node.parentElement;
    }
    return fallback;
  }

  function injectWidget() {
    if (!getTaskInfo()) return;
    if (document.getElementById('ms-bk-widget')) return;
    const card = findCard();
    if (!card || !card.parentElement) return;
    const w = document.createElement('div');
    w.id = 'ms-bk-widget';
    renderInto(w);
    card.after(w);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    const w = document.getElementById('ms-bk-widget');
    if (w) renderInto(w);
  }

  function buildHtml() {
    let body = '';
    if (s.open) {
      if (s.loading) {
        body = `<div class="ms-bk-body"><div class="ms-bk-loading">Loading appointment types…</div></div>`;
      } else if (s.error) {
        body = `<div class="ms-bk-body"><div class="ms-bk-error">${esc(s.error)}</div></div>`;
      } else if (s.step === 'booked') {
        body = renderBooked();
      } else if (s.step === 'confirm') {
        body = renderConfirm();
      } else {
        body = renderBrowse();
      }
    }
    return `
      <div class="ms-bk-header" id="ms-bk-toggle" role="button" tabindex="0" aria-expanded="${s.open}">
        <span class="ms-bk-chevron">${s.open ? '▾' : '▸'}</span>
        <span>Book appointment for this patient</span>
      </div>
      ${body}
    `;
  }

  function renderBrowse() {
    const typesHtml =
      s.types.length === 0
        ? '<option value="" disabled>No appointment types found</option>'
        : s.types
            .map(
              (t) =>
                `<option value="${esc(t.value)}"${s.selectedTypeId === t.value ? ' selected' : ''}>${esc(t.label)}</option>`
            )
            .join('');

    let slotsHtml = '';
    if (s.slotsLoading) {
      slotsHtml = `<div class="ms-bk-loading">Searching for slots…</div>`;
    } else if (s.slotsError) {
      slotsHtml = `<div class="ms-bk-error">${esc(s.slotsError)}</div>`;
    } else if (s.hasSearched && s.slots && s.slots.length > 0) {
      slotsHtml = `<div class="ms-bk-slot-list">${s.slots
        .map(
          (sl, i) => `
        <button class="ms-bk-slot" data-idx="${i}">
          <span class="ms-bk-slot-time">${esc(slotTime(sl.startDateTime))}–${esc(slotTime(sl.endDateTime))}</span>
          <span class="ms-bk-slot-dur">${esc(sl.formattedDuration || sl.duration + ' mins')}</span>
          <span class="ms-bk-slot-site">${esc(sl.siteName || '')}</span>
        </button>`
        )
        .join('')}</div>`;
    } else if (s.hasSearched) {
      slotsHtml = `<div class="ms-bk-no-slots">No available slots on this date.</div>`;
    }

    const canSearch = s.selectedTypeId && s.date && !s.slotsLoading;
    return `
      <div class="ms-bk-body">
        ${!s.patientId ? '<div class="ms-bk-warn">Could not determine patient ID — try navigating away and back.</div>' : ''}
        <div class="ms-bk-row">
          <label class="ms-bk-label" for="ms-bk-type">Appointment type</label>
          <select class="ms-bk-select" id="ms-bk-type"${s.types.length === 0 ? ' disabled' : ''}>
            <option value="">— select type —</option>
            ${typesHtml}
          </select>
        </div>
        <div class="ms-bk-row">
          <label class="ms-bk-label" for="ms-bk-date">Date</label>
          <input type="date" class="ms-bk-date-input" id="ms-bk-date" value="${esc(s.date)}" max="2099-12-31" />
        </div>
        <button class="ms-bk-btn" id="ms-bk-find"${canSearch ? '' : ' disabled'}>Find slots</button>
        ${slotsHtml}
      </div>
    `;
  }

  function renderConfirm() {
    const sl = s.selectedSlot;
    const timeStr = sl
      ? `${esc(slotTime(sl.startDateTime))}–${esc(slotTime(sl.endDateTime))} (${esc(sl.formattedDuration || sl.duration + ' mins')})`
      : '';
    return `
      <div class="ms-bk-body">
        <div class="ms-bk-summary">
          <div><strong>${esc(s.date)}</strong> at ${timeStr}</div>
          ${sl?.siteName ? `<div>${esc(sl.siteName)}</div>` : ''}
          ${sl?.appointmentType?.name ? `<div>${esc(sl.appointmentType.name)}</div>` : ''}
        </div>
        <div class="ms-bk-row">
          <label class="ms-bk-label" for="ms-bk-reason">Reason <span style="font-weight:400;text-transform:none;color:#999">(optional)</span></label>
          <input type="text" class="ms-bk-text-input" id="ms-bk-reason" value="${esc(s.reason)}" placeholder="Reason for appointment" maxlength="255" />
        </div>
        ${s.confirmError ? `<div class="ms-bk-error">${esc(s.confirmError)}</div>` : ''}
        <div class="ms-bk-actions">
          <button class="ms-bk-btn-ghost" id="ms-bk-back"${s.confirming ? ' disabled' : ''}>Back</button>
          <button class="ms-bk-btn" id="ms-bk-confirm"${s.confirming ? ' disabled' : ''}>${s.confirming ? 'Booking…' : 'Confirm booking'}</button>
        </div>
      </div>
    `;
  }

  function renderBooked() {
    const sl = s.selectedSlot;
    return `
      <div class="ms-bk-body ms-bk-success">
        <div class="ms-bk-success-icon">✓</div>
        <div><strong>Appointment booked</strong></div>
        <div>${esc(s.date)}${sl ? ` at ${esc(slotTime(sl.startDateTime))}` : ''}</div>
        <button class="ms-bk-btn-ghost" id="ms-bk-again">Book another</button>
      </div>
    `;
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function doOpen() {
    s.open = true;
    s.loading = true;
    s.error = null;
    rerender();
    try {
      const info = getTaskInfo();
      if (info) {
        s.patientId = await resolvePatientId(info.siteId, info.typeSlug, info.taskUuid);
      }
      const finder = await apiFetchFinder();
      s.providerId = finder.localOrganisationDetails?.id || null;
      const types = [];
      for (const svc of finder.localOrganisationDetails?.services || []) {
        for (const t of svc.appointmentTypes || []) {
          if (!types.some((e) => e.value === t.value)) types.push({ value: t.value, label: t.label });
        }
      }
      s.types = types;
      if (types.length === 1) s.selectedTypeId = types[0].value;
    } catch (err) {
      s.error = err.message || 'Failed to load appointment types.';
    } finally {
      s.loading = false;
      rerender();
    }
  }

  async function doFind() {
    if (!s.providerId || !s.selectedTypeId || !s.date) return;
    s.slotsLoading = true;
    s.slotsError = null;
    s.slots = null;
    s.hasSearched = false;
    rerender();
    try {
      s.slots = await apiFetchSlots({
        providerId: s.providerId,
        appointmentTypeId: s.selectedTypeId,
        date: s.date,
      });
    } catch (err) {
      s.slotsError = err.message || 'Failed to fetch available slots.';
    } finally {
      s.slotsLoading = false;
      s.hasSearched = true;
      rerender();
    }
  }

  async function doSelectSlot(slot) {
    s.slotsLoading = true;
    s.slotsError = null;
    rerender();
    try {
      const result = await apiReserve({
        diaryId: slot.diaryId,
        startDateTime: slot.startDateTime,
        duration: slot.duration,
        appointmentTypeId: slot.appointmentType?.id,
      });
      s.reservationId = result.slotReservationId;
      s.selectedSlot = slot;
      s.step = 'confirm';
      s.confirmError = null;
      s.reason = '';
    } catch (err) {
      s.slotsError = err.message || 'Could not reserve slot — it may have just been taken.';
    } finally {
      s.slotsLoading = false;
      rerender();
    }
  }

  function doBack() {
    if (s.reservationId) apiReleaseReservation(s.reservationId);
    s.reservationId = null;
    s.selectedSlot = null;
    s.step = 'browse';
    s.confirmError = null;
    rerender();
  }

  async function doConfirm() {
    if (s.confirming || !s.reservationId || !s.patientId || !s.selectedSlot) return;
    s.confirming = true;
    s.confirmError = null;
    rerender();
    try {
      const formData = await apiFetchCreateForm({
        slotReservationId: s.reservationId,
        patientId: s.patientId,
      });
      const sl = s.selectedSlot;
      const payload = {
        context: 'create-booked-appointment',
        appointmentTemporalType: 'timed',
        appointmentTypeId: sl.appointmentType?.id,
        patientId: s.patientId,
        deliveryMode: formData.deliveryMode || sl.defaultDeliveryMode?.value || 'face-to-face',
        intendedDuration: sl.duration,
        diaryId: sl.diaryId,
        isHighPriority: false,
        isHiddenFromPatientFacingServices: false,
        intendedStartDateTime: sl.startDateTime,
        reasonForAppointment: s.reason || null,
        additionalInformation: null,
        embargoOverrideReason: null,
        slotReservationId: s.reservationId,
        nhsNationalSlotTypeCategory:
          formData.nhsNationalSlotTypeCategory || sl.nhsNationalSlotTypeCategoryDefault?.value || '10127',
        allowOverlappingAppointments: 'allow',
        gpadReportingExceptionReasons: [],
        clinicalCaseId: null,
        bookingConfirmationRecipients: (formData.bookingConfirmationRecipientOptions || []).map((o) => o.value),
        rescheduledAppointmentVersionId: null,
      };
      const result = await apiCreateAppointment(payload);
      s.bookedId = result.appointmentId;
      s.reservationId = null;
      s.step = 'booked';
    } catch (err) {
      s.confirmError = err.message || 'Booking failed — please try again.';
    } finally {
      s.confirming = false;
      rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    const toggle = el.querySelector('#ms-bk-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (s.open) {
          if (s.reservationId) apiReleaseReservation(s.reservationId);
          s.open = false;
          s.reservationId = null;
          if (s.step === 'confirm') {
            s.step = 'browse';
            s.selectedSlot = null;
          }
          rerender();
        } else {
          doOpen();
        }
      });
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }

    el.querySelector('#ms-bk-type')?.addEventListener('change', (e) => {
      s.selectedTypeId = e.target.value;
      s.slots = null;
      s.hasSearched = false;
      s.slotsError = null;
      rerender();
    });

    el.querySelector('#ms-bk-date')?.addEventListener('change', (e) => {
      s.date = e.target.value;
      s.slots = null;
      s.hasSearched = false;
      s.slotsError = null;
      rerender();
    });

    el.querySelector('#ms-bk-find')?.addEventListener('click', () => doFind());

    el.querySelectorAll('.ms-bk-slot').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const slot = s.slots?.[idx];
        if (slot) doSelectSlot(slot);
      });
    });

    el.querySelector('#ms-bk-reason')?.addEventListener('input', (e) => {
      s.reason = e.target.value;
    });

    el.querySelector('#ms-bk-back')?.addEventListener('click', () => doBack());
    el.querySelector('#ms-bk-confirm')?.addEventListener('click', () => doConfirm());
    el.querySelector('#ms-bk-again')?.addEventListener('click', () => {
      const { patientId, providerId, types } = s;
      s = blankState();
      s.open = true;
      s.patientId = patientId;
      s.providerId = providerId;
      s.types = types;
      rerender();
    });
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────

  let _lastPath = location.pathname;
  let _throttle = null;

  function tryInject() {
    if (_throttle) return;
    _throttle = setTimeout(() => {
      _throttle = null;
      const currentPath = location.pathname;
      if (currentPath !== _lastPath) {
        _lastPath = currentPath;
        if (s.reservationId) apiReleaseReservation(s.reservationId);
        s = blankState();
      }
      if (!document.getElementById('ms-bk-widget')) injectWidget();
    }, 350);
  }

  const _obs = new MutationObserver(tryInject);
  _obs.observe(document.body, { childList: true, subtree: true });

  // Initial inject
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
})();
