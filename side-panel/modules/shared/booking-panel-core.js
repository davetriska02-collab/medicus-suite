// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — booking panel: pure-logic core (no chrome APIs, no DOM, no fetch)
//
// Phase D3 of docs/plans/RECEPTION-FEEDBACK-2026-07-28.md. The reception
// booking panel is the suite's first clinical WRITE surface aimed at
// non-clinical staff, so every decision that decides whether a booking may
// happen at all lives here, in chrome-free functions a test can drive as a
// truth table (hazard H-051):
//
//   bookingGateState()        — may the booking card render at all?
//   verifyBookingIdentity()   — the commit-time wrong-patient comparator
//   windowModeDays()          — date-mode chip → window length
//   recipientPayloadValues()  — checked confirmation channels → payload value set
//   bookedCaptureLine()       — the line the clinician reads in the capture text
//   orderSlotDays()           — day grouping that keeps "searched, none free"
//                               distinguishable from "never looked"
//
// Nothing in this file talks to the network. The endpoints live in ONE place
// (shared/booking-core.js); a second copy of them is exactly the failure plan D forbids.

'use strict';

// ── Date-mode chips (plan D3.1) ───────────────────────────────────────────────
// 'day' searches one explicitly chosen date; the window modes fan the core's
// findSlotsInWindow out across N consecutive calendar days. 28 is the core's
// own MAX_WINDOW_DAYS — the widest chip is the cap, never wider.

export const BOOKING_DATE_MODES = Object.freeze([
  { mode: 'day', label: 'Specific day', days: null },
  { mode: '1wk', label: '1 wk', days: 7 },
  { mode: '2wk', label: '2 wks', days: 14 },
  { mode: '3wk', label: '3 wks', days: 21 },
  { mode: '4wk', label: '4 wks', days: 28 },
]);

/**
 * windowModeDays(mode) → { mode, label, days, isWindow }
 *
 * Fails CLOSED: an unrecognised mode resolves to the single-day search, never
 * to a wider window. A UI bug that mislabels a chip must not turn into 28
 * credentialed calls the receptionist did not ask for.
 */
export function windowModeDays(mode) {
  const found = BOOKING_DATE_MODES.find((m) => m.mode === mode);
  const entry = found || BOOKING_DATE_MODES[0];
  return { mode: entry.mode, label: entry.label, days: entry.days, isWindow: entry.days != null };
}

// ── The gate (plan D3.2 / D3.3 / D3.8, hazard H-051) ──────────────────────────

// Wording is part of the control, not decoration: each blocked state has to
// tell a receptionist what is actually wrong, or they will look for another
// way to book.
export const BOOKING_GATE_MESSAGES = Object.freeze({
  popout: 'Booking lives in the docked side panel.',
  sensitive: 'Booking is off for this pathway — a clinician decides what to offer after a call like this.',
  'no-record':
    "Open the caller's record in Medicus first — booking stays off until the panel can see who you're booking.",
  'red-flag-positive': 'A red flag was answered YES — follow the escalation above. Booking is off.',
  'red-flag-unanswered':
    'Answer every red-flag question first — the booking option appears once they are all answered.',
});

/**
 * bookingGateState({ hasPatientContext, redFlagPositives, redFlagUnanswered,
 *                    isSensitivePathway, isPopOut })
 *   → { allowed, reason, render, message }
 *
 * `allowed`  — true only when a booking may be attempted at all.
 * `reason`   — '' when allowed, otherwise the blocking rule's id.
 * `render`   — how the host should present the block:
 *                'panel'    the booking panel itself
 *                'note'     a one-line note instead of the panel (pop-out)
 *                'disabled' the card, visibly disabled, with `message`
 *                'hidden'   no card at all
 * `message`  — the receptionist-facing sentence for the blocked state.
 *
 * ORDER OF APPLICATION — each earlier rule wins outright:
 *   1. pop-out context        → 'note'     (panel-only ruling, plan D3.8)
 *   2. sensitive pathway      → 'hidden'   (mental-health: a clinician decides)
 *   3. no open-record context → 'disabled' (never book against an ambient record)
 *   4. any POSITIVE red flag  → 'hidden'   (same gate as the disposition card)
 *   5. any UNANSWERED red flag→ 'note'     (see the CSO decision below)
 *
 * A POSITIVE red flag HIDES the card rather than disabling it, deliberately: a
 * Book button greyed out under a duty-escalation banner still reads as "the
 * system expects a booking here", which is the automation-bias failure
 * H-024/H-050 describe. There is also nothing to "unlock" — the answer is no.
 * The disposition card behaves identically for the same reason.
 *
 * CSO DECISION 2026-07-28 (H-051 review question 4; Dr D. Triska, via delegated
 * virtual-Dave agent at Dave's instruction — chat): the UNANSWERED state is
 * treated DIFFERENTLY from the positive one and renders an explanatory NOTE, not
 * a hidden card and not a disabled Book button. Reasons: (i) unanswered is the
 * NORMAL state at the start of every single capture, so "the card simply is not
 * there" is the state a receptionist sees most of the time — it teaches the desk
 * that panel booking is unreliable and pushes them to book the same appointment
 * in Medicus or the Slots tab instead, outside every control in this file, which
 * is the worse outcome; (ii) a one-line sentence is not a control affordance —
 * there is no button to press, so it carries none of the automation pull a greyed
 * Book button does; (iii) it makes completing the red-flag screen the visible
 * route to the thing the receptionist wants, which is the behaviour we are trying
 * to produce. Pinned in test-reception-booking.js and recorded in H-051.
 */
export function bookingGateState(input) {
  const i = input || {};
  const positives = Array.isArray(i.redFlagPositives) ? i.redFlagPositives : [];
  const unanswered = Array.isArray(i.redFlagUnanswered) ? i.redFlagUnanswered : [];
  const block = (reason, render) => ({ allowed: false, reason, render, message: BOOKING_GATE_MESSAGES[reason] || '' });

  if (i.isPopOut === true) return block('popout', 'note');
  if (i.isSensitivePathway === true) return block('sensitive', 'hidden');
  if (!i.hasPatientContext) return block('no-record', 'disabled');
  if (positives.length > 0) return block('red-flag-positive', 'hidden');
  if (unanswered.length > 0) return block('red-flag-unanswered', 'note');
  return { allowed: true, reason: '', render: 'panel', message: '' };
}

// ── Commit-time re-verification (plan D3.4, hazards H-043 + H-051) ────────────

export const BOOKING_VERIFY_MESSAGES = Object.freeze({
  'not-pinned': 'This booking has no pinned patient — booking cancelled, nothing was booked.',
  unresolved:
    'Could not re-check the patient open in Medicus — booking cancelled, nothing was booked. Open the record and try again.',
  'site-mismatch':
    'The Medicus site open in the browser has changed — booking cancelled, nothing was booked. Open the right record and search again.',
  'patient-mismatch':
    'The patient open in Medicus has changed — booking cancelled, nothing was booked. Open the right record and search again.',
  'context-unresolved':
    'This panel can no longer confirm which patient it is showing — booking cancelled, nothing was booked.',
  'context-mismatch':
    'This panel and the Medicus tab disagree about which patient is open — booking cancelled, nothing was booked.',
});

/**
 * verifyBookingIdentity({ pinnedPatientId, pinnedApiBase,
 *                         detectedPatientId, detectedApiBase,
 *                         contextPatientId })
 *   → { ok, code, message }
 *
 * Run immediately before the create call, never earlier (the booking-inline.js
 * H-043 discipline, not slots.js's older capture-once). THREE values must
 * agree, not two:
 *
 *   • `pinned*`    — what the panel pinned when it armed itself.
 *   • `detected*`  — a FRESH tab re-detection at commit time.
 *   • `contextPatientId` — who the panel is showing the receptionist right now
 *                          (reception's ACTIVE-tab Sentinel snapshot).
 *
 * The two identity sources are deliberately different resolvers and can
 * legitimately disagree (plan D1.2: reception resolves the *active* tab, the
 * booking shim resolves the *first matching* Medicus tab). A re-verify against
 * one source alone passes happily while the receptionist reads patient A off
 * the panel and the write lands on patient B — so agreement between BOTH is
 * the control, and anything unresolvable fails CLOSED.
 *
 * The site (`apiBase`) is compared as well as the patient uuid: the same uuid
 * sent to a different practice instance is still the wrong write.
 */
export function verifyBookingIdentity(input) {
  const i = input || {};
  const fail = (code) => ({ ok: false, code, message: BOOKING_VERIFY_MESSAGES[code] || 'Booking cancelled.' });

  if (!i.pinnedPatientId || !i.pinnedApiBase) return fail('not-pinned');
  if (!i.detectedPatientId || !i.detectedApiBase) return fail('unresolved');
  if (i.detectedApiBase !== i.pinnedApiBase) return fail('site-mismatch');
  if (i.detectedPatientId !== i.pinnedPatientId) return fail('patient-mismatch');
  if (!i.contextPatientId) return fail('context-unresolved');
  if (i.contextPatientId !== i.pinnedPatientId) return fail('context-mismatch');
  return { ok: true, code: 'ok', message: '' };
}

// ── Confirmation recipients (plan D3.5) ───────────────────────────────────────

// Both existing booking surfaces silently send EVERY channel the create form
// offers, which fires a patient SMS/email nobody at the desk chose. The panel
// renders the channels as checkboxes instead. Default is still all-checked —
// current suite behaviour, now visible and editable rather than hidden.

/** defaultRecipientValues(options) → string[] — every offered channel, in order. */
export function defaultRecipientValues(options) {
  return (Array.isArray(options) ? options : [])
    .map((o) => (o && o.value != null ? String(o.value) : null))
    .filter((v) => v !== null && v !== '');
}

/**
 * recipientPayloadValues(options, checkedValues) → string[]
 *
 * EXACTLY the checked subset, in the order the create form offered them, with
 * duplicates collapsed. A checked value that is not one of the offered options
 * is dropped — the payload can never carry a channel Medicus did not offer for
 * this appointment.
 */
export function recipientPayloadValues(options, checkedValues) {
  const checked = new Set((Array.isArray(checkedValues) ? checkedValues : []).map((v) => String(v)));
  const out = [];
  for (const value of defaultRecipientValues(options)) {
    if (checked.has(value) && out.indexOf(value) === -1) out.push(value);
  }
  return out;
}

// ── Slot presentation ─────────────────────────────────────────────────────────

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** formatDayLabel('2026-08-03') → 'Mon 3 Aug 2026'. Returns the input on anything unparseable. */
export function formatDayLabel(ymd) {
  const s = String(ymd || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Midday anchor so a DST boundary can never shift the rendered date.
  const d = new Date(`${s}T12:00:00`);
  if (isNaN(d.getTime())) return s;
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** slotTime(slot) → 'HH:MM' from `start` or `startDateTime` ('YYYY-MM-DD HH:MM:SS' or ISO). */
export function slotTime(slot) {
  const s = slot || {};
  if (s.start) return String(s.start);
  const m = /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(String(s.startDateTime || ''));
  return m ? m[1] : '';
}

/** slotDate(slot) → 'YYYY-MM-DD' from `startDateTime`, or ''. */
export function slotDate(slot) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String((slot && slot.startDateTime) || ''));
  return m ? m[1] : '';
}

/** formatSlotWhen(slot) → 'Mon 3 Aug 2026, 09:20' — the read-back and capture-line wording. */
export function formatSlotWhen(slot) {
  const date = slotDate(slot);
  const time = slotTime(slot);
  if (!date) return time;
  return time ? `${formatDayLabel(date)}, ${time}` : formatDayLabel(date);
}

/**
 * orderSlotDays(byDay) → [{ date, slots }]
 *
 * Days ascending, slots within a day ascending by start time. A day present in
 * `byDay` with an EMPTY array is kept: findSlotsInWindow records every date it
 * actually fetched, so "we looked at Thursday and it was full" stays visibly
 * different from "we never looked at Thursday" (plan D3.1). Losing that
 * distinction is how a receptionist tells a patient there is nothing for a
 * fortnight when the search simply stopped early.
 */
export function orderSlotDays(byDay) {
  const src = byDay && typeof byDay === 'object' ? byDay : {};
  return Object.keys(src)
    .sort()
    .map((date) => ({
      date,
      slots: (Array.isArray(src[date]) ? src[date].slice() : []).sort((a, b) =>
        String((a && a.startDateTime) || '').localeCompare(String((b && b.startDateTime) || ''))
      ),
    }));
}

// ── The capture-text line (plan D3, "the clinician sees what was booked") ─────

/**
 * bookedCaptureLine({ typeLabel, whenText, reason }) → string
 *
 * `Booked: <type> — <date/time> — reason: <reason>`
 *
 * Every field falls back to an explicit "not recorded" rather than collapsing:
 * a reading clinician must be able to tell an unrecorded reason from a booking
 * with no reason at all, and a half-empty line is what makes a wrong booking
 * hard to spot in a significant-event review.
 */
export function bookedCaptureLine(summary) {
  const s = summary || {};
  const type = String(s.typeLabel || '').trim() || 'appointment type not recorded';
  const when = String(s.whenText || '').trim() || 'date/time not recorded';
  const reason = String(s.reason || '').trim() || 'not recorded';
  return `Booked: ${type} — ${when} — reason: ${reason}`;
}

// ── Type-ahead filter for appointment-type pickers ────────────────────────────

/**
 * filterAppointmentTypes(types, query) → filtered [{ value, label }]
 *
 * Case-insensitive match of every whitespace-separated query word against the
 * type LABEL (all words must appear somewhere — "ac gp" matches "GP Acute").
 * An empty/whitespace query returns every type unchanged. Shared by all three
 * appointment-type pickers (slots booking, reception booking panel,
 * first-available) so "type 'acute' to filter" behaves identically everywhere.
 */
export function filterAppointmentTypes(types, query) {
  const list = Array.isArray(types) ? types : [];
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((t) => {
    const label = String((t && t.label) || '').toLowerCase();
    return words.every((w) => label.includes(w));
  });
}

export default {
  BOOKING_DATE_MODES,
  BOOKING_GATE_MESSAGES,
  BOOKING_VERIFY_MESSAGES,
  windowModeDays,
  bookingGateState,
  verifyBookingIdentity,
  defaultRecipientValues,
  recipientPayloadValues,
  formatDayLabel,
  slotTime,
  slotDate,
  formatSlotWhen,
  orderSlotDays,
  bookedCaptureLine,
  filterAppointmentTypes,
};
