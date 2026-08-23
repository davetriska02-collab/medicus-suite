// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — reusable in-panel appointment booking component (plan D3)
//
// docs/plans/RECEPTION-FEEDBACK-2026-07-28.md phase D3. Mounted today by the
// Reception module as a third card under the guided-capture form; written as a
// standalone component because TRIAGE-NORTHSTAR C4 consumes the same flow.
//
// ── CONTRACT ─────────────────────────────────────────────────────────────────
//
//   createBookingPanel({
//     mountEl,            // Element — the component owns its INNER HTML only.
//                         //   The host keeps the card/container; the panel
//                         //   never re-renders the whole module (plan D3.1).
//     getPatientContext,  // () → { patientId, name, dob, nhsNumber } | null
//                         //   The host's identity source. The panel NEVER
//                         //   resolves the patient for itself.
//     getGateState,       // () → bookingGateState() result. Consulted on every
//                         //   render and again at commit; a closed gate
//                         //   releases any held slot and renders no controls.
//     getDefaultReason,   // () → string — pre-fills the (editable) reason.
//     onBooked,           // (summary) → void, after a successful create:
//                         //   { appointmentId, typeId, typeLabel, dateIso,
//                         //     timeText, whenText, reason, recipients, line }
//                         //   `line` is the capture-text line.
//     onStateChange,      // optional () → void, after any step change.
//   }) → { render, destroy, isBusy }
//
//   render()  — (re)draw from current gate + state. Returns the gate result so
//               the host can hide/show its own card. Safe to call on every
//               keystroke of the host form.
//   destroy() — release any held reservation, unbind, blank the mount. Idempotent.
//   isBusy()  — true while a reservation is held or a write is in flight.
//
// ── WHAT THIS FILE MUST NEVER GROW ───────────────────────────────────────────
//
// Endpoint code. Every call goes through shared/booking-core.js; identity
// resolution is shared/booking-identity.js (the core deliberately refuses to
// own tab detection — plan D1.2 / H-043). A third hand-copy of the booking
// flow is exactly what plan section D forbids and what test-reception-booking.js
// asserts against (no endpoint path literals here).
//
// ── SAFETY CONTROLS (hazard H-051) ───────────────────────────────────────────
//
//  1. No pre-selected appointment type and no auto-picked slot — both are the
//     receptionist's explicit choice, and the chosen type travels back into the
//     capture text so the clinician sees what was booked.
//  2. Identity is PINNED when the panel arms and both sources must agree then:
//     the host's context patient and a fresh tab detection. They are different
//     resolvers (active tab vs first matching tab) and can disagree.
//  3. Commit-time re-verification immediately before the create call —
//     re-detect, then verifyBookingIdentity() over pinned/detected/context,
//     patient AND site. Any mismatch or unresolvable value aborts, releases the
//     reservation and surfaces the reason; nothing is created.
//  4. Name + DOB read-back with an explicit tick that gates the Confirm button.
//  5. Confirmation channels are shown and editable; the payload carries exactly
//     the checked set.
//  6. Reservations are released on every exit: gate closure, back navigation,
//     re-render that unmounts, destroy(), and page teardown (`pagehide`, via the
//     core's keepalive release).
//  7. No booking, slot or patient state is ever written to chrome.storage.

'use strict';

import {
  fetchAppointmentFinder,
  fetchAvailableSlots,
  findSlotsInWindow,
  reserveSlot,
  fetchCreateForm,
  createAppointment,
  releaseReservation,
} from '../../../shared/booking-core.js';
import { detectMedicusTab, detectPatientId } from '../../../shared/booking-identity.js';

import {
  BOOKING_DATE_MODES,
  windowModeDays,
  verifyBookingIdentity,
  defaultRecipientValues,
  recipientPayloadValues,
  formatDayLabel,
  formatSlotWhen,
  slotTime,
  slotDate,
  orderSlotDays,
  bookedCaptureLine,
  filterAppointmentTypes,
} from './booking-panel-core.js';

const SLOT_LIMIT = 30; // plan D3.1 — window searches stop collecting at 30 slots

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function createBookingPanel(opts) {
  const options = opts || {};
  const mountEl = options.mountEl || null;
  const getPatientContext = typeof options.getPatientContext === 'function' ? options.getPatientContext : () => null;
  const getGateState =
    typeof options.getGateState === 'function'
      ? options.getGateState
      : () => ({ allowed: true, reason: '', render: 'panel', message: '' });
  const getDefaultReason = typeof options.getDefaultReason === 'function' ? options.getDefaultReason : () => '';
  const onBooked = typeof options.onBooked === 'function' ? options.onBooked : () => {};
  const onStateChange = typeof options.onStateChange === 'function' ? options.onStateChange : () => {};

  // ONE state instance for the life of the component, never reassigned. Every
  // async continuation below destructures/pins THIS object before its first
  // await — the booking-inline.js `const st = s` discipline (audit C1 / H-043),
  // so nothing resolving late can land in a different booking's state.
  const st = {
    destroyed: false,
    // arming
    phase: 'idle', // idle | arming | ready | error
    armError: null,
    apiBase: null,
    providerId: null,
    pinnedPatientId: null,
    pinnedApiBase: null,
    types: [],
    // browse
    step: 'browse', // browse | confirm | booked
    selectedTypeId: '',
    typeFilter: '', // typable filter over the type list ("acute" → matching types)
    dateMode: 'day',
    date: todayIso(),
    searching: false,
    searched: false,
    searchError: null,
    days: [],
    aborted: false,
    truncated: false,
    // confirm
    busy: false,
    reservationId: null,
    selectedSlot: null,
    formData: null,
    recipientOptions: [],
    recipientChecked: [],
    reason: '',
    patientTicked: false,
    committing: false,
    commitError: null,
    // booked
    booked: null,
  };

  // ── Reservation release ─────────────────────────────────────────────────────
  // Called from EVERY exit path. releaseReservation() in the core is
  // fire-and-forget with keepalive:true, so a release issued during teardown
  // still reaches the server instead of being cancelled with the page.
  function releaseHeld() {
    if (st.reservationId && st.apiBase) {
      try {
        const p = releaseReservation(st.apiBase, st.reservationId);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    }
    st.reservationId = null;
  }

  const onPageHide = () => {
    // Panel/window teardown: release before the context dies. keepalive lives
    // in the core's release path (plan D1.3), so this actually completes.
    releaseHeld();
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', onPageHide);
  }

  function clearSelection() {
    st.selectedSlot = null;
    st.formData = null;
    st.recipientOptions = [];
    st.recipientChecked = [];
    st.patientTicked = false;
    st.commitError = null;
  }

  function resetToBrowse() {
    releaseHeld();
    clearSelection();
    st.step = 'browse';
  }

  function resetSearch() {
    st.days = [];
    st.searched = false;
    st.searchError = null;
    st.aborted = false;
    st.truncated = false;
  }

  // ── Arming: pin the identity, then load the appointment types ───────────────
  async function arm() {
    const s = st; // pin (H-043)
    const ctx = getPatientContext();
    if (!ctx || !ctx.patientId) {
      s.phase = 'error';
      s.armError = 'No patient record is open — booking is off.';
      render();
      return;
    }
    s.phase = 'arming';
    s.armError = null;
    render();
    try {
      const detected = await detectMedicusTab();
      if (s.destroyed) return;
      if (!detected || !detected.apiBase) {
        s.phase = 'error';
        s.armError = 'Could not find a signed-in Medicus tab. Open Medicus and try again.';
        return;
      }
      const detectedPatientId = await detectPatientId(detected.tab);
      if (s.destroyed) return;
      // BOTH identity sources must agree BEFORE the panel arms — not only at
      // commit. The host resolves the ACTIVE tab; the booking shim resolves the
      // FIRST matching Medicus tab (plan D1.2). If those disagree the desk is
      // looking at one patient and this panel would search/book for another, so
      // the panel refuses to arm rather than show a Book button it cannot trust.
      if (!detectedPatientId) {
        s.phase = 'error';
        s.armError = 'Could not read the patient from the Medicus tab. Open the record and try again.';
        return;
      }
      if (detectedPatientId !== ctx.patientId) {
        s.phase = 'error';
        s.armError = 'This panel and the Medicus tab are showing different patients — booking is off until they match.';
        return;
      }
      s.pinnedPatientId = ctx.patientId;
      s.pinnedApiBase = detected.apiBase;
      s.apiBase = detected.apiBase;

      const finder = await fetchAppointmentFinder(s.apiBase);
      if (s.destroyed) return;
      s.providerId = finder?.localOrganisationDetails?.id || null;
      const types = [];
      for (const svc of finder?.localOrganisationDetails?.services || []) {
        for (const t of svc.appointmentTypes || []) {
          if (!types.some((e) => e.value === t.value)) types.push({ value: t.value, label: t.label });
        }
      }
      s.types = types;
      // NO auto-select, even for a single type (plan D3.1). slots.js pre-picks a
      // lone type; here the type lands in the clinical record, so it is chosen.
      s.phase = s.providerId ? 'ready' : 'error';
      if (!s.providerId) s.armError = 'Medicus did not return a booking provider for this practice.';
    } catch (err) {
      if (s.destroyed) return;
      s.phase = 'error';
      s.armError = err?.message || 'Could not load appointment types.';
    } finally {
      if (!s.destroyed) render();
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────
  async function search() {
    const s = st; // pin (H-043)
    if (s.phase !== 'ready' || !s.selectedTypeId || s.searching) return;
    const mode = windowModeDays(s.dateMode);
    if (!mode.isWindow && !s.date) return;
    s.searching = true;
    resetSearch();
    render();
    try {
      if (mode.isWindow) {
        // Caps (≤28 days, ≤4 concurrent, abort on 429/5xx) are enforced INSIDE
        // findSlotsInWindow — deliberately not re-implemented here (plan D1.4).
        const res = await findSlotsInWindow(s.apiBase, {
          appointmentTypeId: s.selectedTypeId,
          providerId: s.providerId,
          fromDate: todayIso(),
          days: mode.days,
          skipWeekends: true,
          limit: SLOT_LIMIT,
        });
        if (s.destroyed) return;
        s.days = orderSlotDays(res.byDay);
        // An aborted window search is NOT an error state — the days it did
        // reach are real and bookable; the "stopped early" note below says the
        // rest were never checked.
        s.aborted = !!res.aborted;
      } else {
        const slots = await fetchAvailableSlots(s.apiBase, {
          providerId: s.providerId,
          appointmentTypeId: s.selectedTypeId,
          date: s.date,
        });
        if (s.destroyed) return;
        s.days = orderSlotDays({ [s.date]: slots || [] });
      }
      const total = s.days.reduce((n, d) => n + d.slots.length, 0);
      s.truncated = total >= SLOT_LIMIT;
    } catch (err) {
      if (s.destroyed) return;
      s.days = [];
      s.searchError = err?.message || 'Could not search for slots.';
    } finally {
      if (!s.destroyed) {
        s.searching = false;
        s.searched = true;
        render();
      }
    }
  }

  // ── Reserve → confirm step ─────────────────────────────────────────────────
  async function selectSlot(slot) {
    const s = st; // pin (H-043)
    if (!slot || s.busy || s.phase !== 'ready') return;
    if (!getGateState().allowed) return;
    s.busy = true;
    s.searchError = null;
    render();
    try {
      const result = await reserveSlot(s.apiBase, {
        diaryId: slot.diaryId,
        startDateTime: slot.startDateTime,
        duration: slot.duration,
        appointmentTypeId: slot.appointmentType?.id,
      });
      if (s.destroyed) {
        // Unmounted mid-reserve: hand the slot straight back rather than
        // leaving it locked for every other booker.
        if (result?.slotReservationId && s.apiBase) {
          try {
            releaseReservation(s.apiBase, result.slotReservationId);
          } catch (_) {}
        }
        return;
      }
      s.reservationId = result?.slotReservationId || null;
      if (!s.reservationId) throw new Error('Medicus did not return a slot reservation.');

      // The create form is fetched here (not at commit) because its
      // bookingConfirmationRecipientOptions are what the confirm step renders as
      // editable channels. The commit ordering is unchanged:
      // reserve → create form → re-verify → create.
      const formData = await fetchCreateForm(s.apiBase, {
        slotReservationId: s.reservationId,
        patientId: s.pinnedPatientId,
      });
      if (s.destroyed) {
        releaseHeld();
        return;
      }
      s.formData = formData || {};
      s.recipientOptions = Array.isArray(formData?.bookingConfirmationRecipientOptions)
        ? formData.bookingConfirmationRecipientOptions
        : [];
      // Default: every offered channel checked. That is what both existing
      // booking surfaces already send silently — here it is visible and the
      // receptionist can un-tick a channel before anything reaches the patient.
      // TODO(D2 spike): capture Medicus's own default selection from the live
      // booking UI (plan D2/D3.5) and default to that instead of all-checked.
      s.recipientChecked = defaultRecipientValues(s.recipientOptions);
      s.selectedSlot = slot;
      s.reason = getDefaultReason() || '';
      s.patientTicked = false;
      s.commitError = null;
      s.step = 'confirm';
      onStateChange();
    } catch (err) {
      if (s.destroyed) return;
      // Anything after a successful reserve must not leave the slot held.
      releaseHeld();
      clearSelection();
      s.step = 'browse';
      s.searchError = err?.message || 'Could not hold that slot — it may have just been taken.';
    } finally {
      if (!s.destroyed) {
        s.busy = false;
        render();
      }
    }
  }

  // Commit-time wrong-patient abort: release the held slot (never leave one
  // locked by a booking we refused to make), drop back to browse, and say why.
  function abortOnIdentity(message) {
    releaseHeld();
    clearSelection();
    st.step = 'browse';
    resetSearch();
    st.searchError = message;
    st.commitError = message;
  }

  // ── Commit ─────────────────────────────────────────────────────────────────
  async function commit() {
    const s = st; // pin (H-043) — every write below targets THIS instance
    if (s.committing || !s.reservationId || !s.selectedSlot || !s.patientTicked) return;
    if (!getGateState().allowed) {
      abortOnIdentity('Booking is no longer allowed for this capture — nothing was booked.');
      render();
      return;
    }
    s.committing = true;
    s.commitError = null;
    render();
    try {
      const slot = s.selectedSlot;
      const formData = s.formData || {};

      // ── COMMIT-TIME WRONG-PATIENT RE-VERIFICATION (plan D3.4, H-043/H-051) ──
      // Re-detect the tab and re-resolve its patient NOW, then require the
      // pinned, the freshly-detected and the host's currently-displayed patient
      // to agree — on the site (apiBase) as well as the uuid. Anything
      // unresolvable fails closed. This is the booking-inline discipline, not
      // slots.js's older capture-once.
      const verifyTab = await detectMedicusTab();
      if (s.destroyed) return;
      const verifiedPatientId = verifyTab ? await detectPatientId(verifyTab.tab) : null;
      if (s.destroyed) return;
      const ctx = getPatientContext();
      const verdict = verifyBookingIdentity({
        pinnedPatientId: s.pinnedPatientId,
        pinnedApiBase: s.pinnedApiBase,
        detectedPatientId: verifiedPatientId,
        detectedApiBase: verifyTab ? verifyTab.apiBase : null,
        contextPatientId: ctx ? ctx.patientId : null,
      });
      if (!verdict.ok) {
        abortOnIdentity(verdict.message);
        return;
      }

      const recipients = recipientPayloadValues(s.recipientOptions, s.recipientChecked);
      const reason = String(s.reason || '').trim();
      const payload = {
        context: 'create-booked-appointment',
        appointmentTemporalType: 'timed',
        appointmentTypeId: slot.appointmentType?.id,
        patientId: s.pinnedPatientId,
        deliveryMode: formData.deliveryMode || slot.defaultDeliveryMode?.value || 'face-to-face',
        intendedDuration: slot.duration,
        diaryId: slot.diaryId,
        isHighPriority: false,
        isHiddenFromPatientFacingServices: false,
        intendedStartDateTime: slot.startDateTime,
        reasonForAppointment: reason || null,
        additionalInformation: null,
        embargoOverrideReason: null,
        slotReservationId: s.reservationId,
        nhsNationalSlotTypeCategory:
          formData.nhsNationalSlotTypeCategory || slot.nhsNationalSlotTypeCategoryDefault?.value || '10127',
        allowOverlappingAppointments: 'allow',
        gpadReportingExceptionReasons: [],
        clinicalCaseId: null,
        // Exactly the channels left ticked — never "everything the form offered".
        bookingConfirmationRecipients: recipients,
        rescheduledAppointmentVersionId: null,
      };

      const result = await createAppointment(s.apiBase, payload);
      if (s.destroyed) return;
      s.reservationId = null; // the server releases the reservation on create
      const typeLabel =
        (s.types.find((t) => t.value === s.selectedTypeId) || {}).label || slot.appointmentType?.name || '';
      const summary = {
        appointmentId: result?.appointmentId || null,
        typeId: s.selectedTypeId,
        typeLabel,
        dateIso: slotDate(slot),
        timeText: slotTime(slot),
        whenText: formatSlotWhen(slot),
        reason,
        recipients,
      };
      summary.line = bookedCaptureLine(summary);
      s.booked = summary;
      s.step = 'booked';
      onBooked(summary);
      onStateChange();
    } catch (err) {
      if (s.destroyed) return;
      s.commitError = err?.message || 'Booking failed — nothing was booked. Try again.';
    } finally {
      if (!s.destroyed) {
        s.committing = false;
        render();
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  function renderBlocked(gate) {
    if (gate.render === 'note') {
      return `<div class="rcp-bk-note">${esc(gate.message)}</div>`;
    }
    if (gate.render === 'disabled') {
      return `<div class="rcp-bk-blocked" aria-disabled="true">${esc(gate.message)}</div>`;
    }
    return '';
  }

  // The type-select's options under the current typable filter. The selected
  // type always stays in the list (even when it stops matching the filter) so
  // the select can never show a blank while state still holds a selection.
  function typeOptionsHtml() {
    const filtered = filterAppointmentTypes(st.types, st.typeFilter);
    const list = filtered.slice();
    if (st.selectedTypeId && !list.some((t) => t.value === st.selectedTypeId)) {
      const sel = st.types.find((t) => t.value === st.selectedTypeId);
      if (sel) list.unshift(sel);
    }
    const opts = list
      .map(
        (t) =>
          `<option value="${esc(t.value)}"${st.selectedTypeId === t.value ? ' selected' : ''}>${esc(t.label)}</option>`
      )
      .join('');
    const head =
      filtered.length === 0
        ? `<option value="" disabled>No types match &ldquo;${esc(st.typeFilter)}&rdquo;</option>`
        : `<option value="">${st.typeFilter ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}&hellip;` : 'Choose appointment type&hellip;'}</option>`;
    return head + opts;
  }

  function renderTypeRow() {
    return `
      <div class="rcp-bk-row">
        <label class="rcp-bk-label" for="rcpBkTypeFilter">Type</label>
        <div class="rcp-bk-type-picker">
          <input type="text" class="rcp-bk-text rcp-bk-type-filter" id="rcpBkTypeFilter" value="${esc(st.typeFilter)}"
            placeholder="Type to filter &mdash; e.g. acute" autocomplete="off" aria-label="Filter appointment types">
          <select class="rcp-bk-select" id="rcpBkType"${st.types.length === 0 ? ' disabled' : ''}>
            ${typeOptionsHtml()}
          </select>
        </div>
      </div>`;
  }

  function renderModeRow() {
    const chips = BOOKING_DATE_MODES.map(
      (m) =>
        `<button type="button" class="rcp-bk-chip${st.dateMode === m.mode ? ' rcp-bk-chip-on' : ''}" data-bk-mode="${esc(m.mode)}" aria-pressed="${st.dateMode === m.mode}">${esc(m.label)}</button>`
    ).join('');
    const dayRow =
      st.dateMode === 'day'
        ? `<div class="rcp-bk-row">
             <label class="rcp-bk-label" for="rcpBkDate">Day</label>
             <input type="date" class="rcp-bk-date" id="rcpBkDate" value="${esc(st.date)}" max="2099-12-31">
           </div>`
        : `<div class="rcp-bk-fineprint">Searching the next ${esc(String(windowModeDays(st.dateMode).days))} days from today, weekdays only.</div>`;
    return `<div class="rcp-bk-modes" role="group" aria-label="When to look">${chips}</div>${dayRow}`;
  }

  function renderSlotButton(slot, dayIdx, slotIdx) {
    const time = esc(slotTime(slot));
    const dur = esc(slot.formattedDuration || (slot.duration != null ? `${slot.duration} mins` : ''));
    const site = esc(slot.siteName || '');
    const type = esc(slot.appointmentType?.name || '');
    const meta = [site, type].filter(Boolean).join(' &middot; ');
    return `<button type="button" class="rcp-bk-slot" data-bk-day="${dayIdx}" data-bk-slot="${slotIdx}"${st.busy ? ' disabled' : ''}>
      <span class="rcp-bk-slot-time">${time}</span>
      <span class="rcp-bk-slot-meta">${meta}</span>
      <span class="rcp-bk-slot-dur">${dur}</span>
    </button>`;
  }

  function renderResults() {
    if (st.searching) return `<div class="rcp-bk-loading">Looking for slots&hellip;</div>`;
    if (st.searchError) return `<div class="rcp-error">${esc(st.searchError)}</div>`;
    if (!st.searched) return '';
    if (st.days.length === 0) return `<div class="rcp-bk-empty">No slots found.</div>`;
    const daysHtml = st.days
      .map(
        (d, i) => `<div class="rcp-bk-day">
          <div class="rcp-bk-day-head">${esc(formatDayLabel(d.date))}</div>
          ${
            d.slots.length === 0
              ? `<div class="rcp-bk-empty">No slots free this day.</div>`
              : `<div class="rcp-bk-slots">${d.slots.map((sl, j) => renderSlotButton(sl, i, j)).join('')}</div>`
          }
        </div>`
      )
      .join('');
    // "Searched and full" vs "we stopped looking" must stay distinguishable —
    // otherwise the desk tells a patient there is nothing for a fortnight when
    // the search simply hit a cap.
    const notes = [];
    if (st.aborted)
      notes.push(
        'The scheduler was busy, so the search stopped early — days after the last one shown were not checked.'
      );
    if (st.truncated)
      notes.push(`Showing the first ${SLOT_LIMIT} slots found — there may be more later in the window.`);
    return `<div class="rcp-bk-days">${daysHtml}</div>${notes.map((n) => `<div class="rcp-bk-fineprint">${esc(n)}</div>`).join('')}`;
  }

  function renderBrowse() {
    const canSearch = !!st.selectedTypeId && !st.searching && st.phase === 'ready';
    return `
      ${renderTypeRow()}
      ${renderModeRow()}
      <div class="rcp-bk-actions">
        <button type="button" class="rcp-btn rcp-btn-small" id="rcpBkSearch"${canSearch ? '' : ' disabled'}>Find slots</button>
        ${st.selectedTypeId ? '' : '<span class="rcp-bk-fineprint">Choose an appointment type first.</span>'}
      </div>
      ${renderResults()}`;
  }

  function renderConfirm() {
    const ctx = getPatientContext() || {};
    const slot = st.selectedSlot || {};
    const dur = esc(slot.formattedDuration || (slot.duration != null ? `${slot.duration} mins` : ''));
    const site = esc(slot.siteName || '');
    const typeLabel = esc(
      (st.types.find((t) => t.value === st.selectedTypeId) || {}).label || slot.appointmentType?.name || ''
    );
    const recips = st.recipientOptions.length
      ? st.recipientOptions
          .map((o) => {
            const v = esc(o.value);
            const on = st.recipientChecked.indexOf(String(o.value)) !== -1;
            return `<label class="rcp-bk-recip"><input type="checkbox" data-bk-recip="${v}"${on ? ' checked' : ''}> ${esc(o.label || o.value)}</label>`;
          })
          .join('')
      : `<span class="rcp-bk-fineprint">Medicus offered no confirmation channels for this appointment.</span>`;

    return `
      <div class="rcp-bk-readback">
        <div class="rcp-bk-readback-title">Read this back to the caller</div>
        <div class="rcp-bk-readback-name">${esc(ctx.name || 'Name not available')}</div>
        <div class="rcp-bk-readback-id">${ctx.dob ? `DOB ${esc(ctx.dob)}` : 'DOB not available'}${ctx.nhsNumber ? ` &middot; NHS ${esc(ctx.nhsNumber)}` : ''}</div>
        <label class="rcp-bk-tick"><input type="checkbox" id="rcpBkPatientOk"${st.patientTicked ? ' checked' : ''}> This is the right patient</label>
      </div>
      <div class="rcp-bk-summary">
        <div class="rcp-bk-sum-row"><span class="rcp-bk-sum-label">When</span><span>${esc(formatSlotWhen(slot))}${dur ? ` (${dur})` : ''}</span></div>
        ${typeLabel ? `<div class="rcp-bk-sum-row"><span class="rcp-bk-sum-label">Type</span><span>${typeLabel}</span></div>` : ''}
        ${site ? `<div class="rcp-bk-sum-row"><span class="rcp-bk-sum-label">Site</span><span>${site}</span></div>` : ''}
      </div>
      <div class="rcp-bk-row">
        <label class="rcp-bk-label" for="rcpBkReason">Reason</label>
        <input type="text" class="rcp-bk-text" id="rcpBkReason" maxlength="255" value="${esc(st.reason)}" autocomplete="off">
      </div>
      <fieldset class="rcp-bk-recips">
        <legend class="rcp-bk-recips-legend">Send the confirmation to</legend>
        ${recips}
      </fieldset>
      ${st.commitError ? `<div class="rcp-error">${esc(st.commitError)}</div>` : ''}
      <div class="rcp-bk-actions">
        <button type="button" class="rcp-btn rcp-btn-small" id="rcpBkBack"${st.committing ? ' disabled' : ''}>Back</button>
        <button type="button" class="rcp-btn rcp-btn-primary rcp-btn-small" id="rcpBkConfirm"${st.patientTicked && !st.committing ? '' : ' disabled'}>${st.committing ? 'Booking&hellip;' : 'Confirm booking'}</button>
      </div>
      <div class="rcp-bk-fineprint">The patient shown in Medicus is checked again the moment you press Confirm. If it has changed, nothing is booked.</div>`;
  }

  function renderBooked() {
    const b = st.booked || {};
    return `
      <div class="rcp-bk-booked">
        <div class="rcp-bk-booked-head"><span class="rcp-bk-booked-tick" aria-hidden="true">&#10003;</span> Appointment booked</div>
        <div class="rcp-bk-booked-detail">${esc(b.typeLabel || '')}${b.typeLabel && b.whenText ? ' &mdash; ' : ''}${esc(b.whenText || '')}</div>
        ${b.reason ? `<div class="rcp-bk-booked-detail">Reason: ${esc(b.reason)}</div>` : ''}
        <div class="rcp-bk-fineprint">Added to the summary text below as &ldquo;${esc(b.line || '')}&rdquo;.</div>
        <div class="rcp-bk-actions"><button type="button" class="rcp-btn rcp-btn-small" id="rcpBkAgain">Book another</button></div>
      </div>`;
  }

  function render() {
    const gate = getGateState();
    if (!mountEl || st.destroyed) return gate;

    // A gate that closed under a live reservation (a red flag flipped to YES on
    // the form behind this card) must hand the slot straight back.
    if (!gate.allowed) {
      if (st.reservationId || st.step !== 'browse') resetToBrowse();
      mountEl.innerHTML = renderBlocked(gate);
      return gate;
    }

    const ctx = getPatientContext();
    // The displayed patient changed under an armed panel: release, forget the
    // pin and re-arm against the new record rather than search on a stale one.
    if (st.phase !== 'idle' && ctx && st.pinnedPatientId && ctx.patientId !== st.pinnedPatientId) {
      resetToBrowse();
      resetSearch();
      st.phase = 'idle';
      st.pinnedPatientId = null;
      st.pinnedApiBase = null;
      st.types = [];
      st.selectedTypeId = '';
      st.booked = null;
    }

    if (st.phase === 'idle') {
      st.phase = 'arming';
      mountEl.innerHTML = `<div class="rcp-bk-loading">Checking the open record&hellip;</div>`;
      arm();
      return gate;
    }

    let inner;
    if (st.phase === 'arming') inner = `<div class="rcp-bk-loading">Loading appointment types&hellip;</div>`;
    else if (st.phase === 'error') inner = `<div class="rcp-error">${esc(st.armError || 'Booking unavailable.')}</div>`;
    else if (st.step === 'booked') inner = renderBooked();
    else if (st.step === 'confirm') inner = renderConfirm();
    else inner = renderBrowse();

    mountEl.innerHTML = `<div class="rcp-bk">${inner}</div>`;
    bind();
    return gate;
  }

  function bind() {
    if (!mountEl) return;
    // Typable type filter. Only the <select>'s options are rebuilt per
    // keystroke — a full render would recreate and blur the input mid-word.
    // A single remaining match auto-selects (that state change DOES re-render,
    // with focus restored) so "acute → Find slots" is two actions, not three.
    mountEl.querySelector('#rcpBkTypeFilter')?.addEventListener('input', (e) => {
      st.typeFilter = e.target.value;
      const filtered = filterAppointmentTypes(st.types, st.typeFilter);
      if (filtered.length === 1 && filtered[0].value !== st.selectedTypeId) {
        st.selectedTypeId = filtered[0].value;
        resetSearch();
        render();
        const input = mountEl.querySelector('#rcpBkTypeFilter');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }
        return;
      }
      const selectEl = mountEl.querySelector('#rcpBkType');
      if (selectEl) selectEl.innerHTML = typeOptionsHtml();
      const searchBtn = mountEl.querySelector('#rcpBkSearch');
      if (searchBtn) searchBtn.disabled = !(st.selectedTypeId && !st.searching && st.phase === 'ready');
    });
    mountEl.querySelector('#rcpBkType')?.addEventListener('change', (e) => {
      st.selectedTypeId = e.target.value;
      resetSearch();
      render();
    });
    mountEl.querySelectorAll('[data-bk-mode]').forEach((btn) =>
      btn.addEventListener('click', () => {
        st.dateMode = btn.dataset.bkMode;
        resetSearch();
        render();
      })
    );
    mountEl.querySelector('#rcpBkDate')?.addEventListener('change', (e) => {
      st.date = e.target.value || todayIso();
      resetSearch();
      render();
    });
    mountEl.querySelector('#rcpBkSearch')?.addEventListener('click', () => search());
    mountEl.querySelectorAll('.rcp-bk-slot').forEach((btn) =>
      btn.addEventListener('click', () => {
        const day = st.days[Number(btn.dataset.bkDay)];
        const slot = day ? day.slots[Number(btn.dataset.bkSlot)] : null;
        if (slot) selectSlot(slot);
      })
    );
    mountEl.querySelector('#rcpBkPatientOk')?.addEventListener('change', (e) => {
      st.patientTicked = !!e.target.checked;
      render();
    });
    mountEl.querySelector('#rcpBkReason')?.addEventListener('input', (e) => {
      st.reason = e.target.value;
    });
    mountEl.querySelectorAll('[data-bk-recip]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const value = String(cb.dataset.bkRecip);
        const at = st.recipientChecked.indexOf(value);
        if (cb.checked && at === -1) st.recipientChecked.push(value);
        else if (!cb.checked && at !== -1) st.recipientChecked.splice(at, 1);
      })
    );
    mountEl.querySelector('#rcpBkBack')?.addEventListener('click', () => {
      resetToBrowse();
      render();
    });
    mountEl.querySelector('#rcpBkConfirm')?.addEventListener('click', () => commit());
    mountEl.querySelector('#rcpBkAgain')?.addEventListener('click', () => {
      st.booked = null;
      resetToBrowse();
      resetSearch();
      render();
    });
  }

  function destroy() {
    if (st.destroyed) return;
    st.destroyed = true;
    releaseHeld();
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('pagehide', onPageHide);
    }
    if (mountEl) mountEl.innerHTML = '';
  }

  function isBusy() {
    return !!(st.reservationId || st.committing || st.busy);
  }

  return { render, destroy, isBusy };
}

export default createBookingPanel;
