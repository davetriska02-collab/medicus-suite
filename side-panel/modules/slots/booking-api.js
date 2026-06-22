// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking API client for the Slots module.
'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}

export async function detectAppOrigin() {
  const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
  for (const t of tabs) {
    try {
      const u = new URL(t.url);
      if (!u.hostname.includes('.api.')) return u.origin;
    } catch (_) {}
  }
  return null;
}

export async function detectPatientId() {
  const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
  for (const t of tabs) {
    const m = t.url.match(/(?:patient|care-record)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m) return m[1];
  }
  return null;
}

export async function fetchAppointmentFinder(origin) {
  const resp = await fetch(`${origin}/scheduling/data/appointment-service/available-appointment-finder`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`Appointment finder: ${resp.status}`);
  return resp.json();
}

export async function fetchAvailableSlots(origin, { providerId, appointmentTypeId, date }) {
  const now = new Date();
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const minDateTime =
    date === todayYmd ? `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}:00` : `${date} 00:00:00`;
  const qs = new URLSearchParams({
    providerId,
    providerIsLocalOrganisation: 'true',
    minDateTime,
    'localOrganisationFilters[appointmentTypeId]': appointmentTypeId,
  });
  const resp = await fetch(
    `${origin}/scheduling/data/appointment-service/available-appointment-places-between-range?${qs}`,
    { credentials: 'include', headers: { Accept: 'application/json' } }
  );
  if (!resp.ok) throw new Error(`Available slots: ${resp.status}`);
  const data = await resp.json();
  const slots = [];
  for (const diary of data.availablePlaces?.[date]?.diaries || []) {
    for (const entry of diary.entries || []) {
      if (entry.diaryEntryType?.isSlot) slots.push(entry);
    }
  }
  return slots;
}

export async function reserveSlot(origin, { diaryId, startDateTime, duration, appointmentTypeId }) {
  const resp = await fetch(
    `${origin}/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
    }
  );
  if (!resp.ok) throw new Error(`Reserve slot: ${resp.status}`);
  return resp.json();
}

export async function fetchCreateForm(origin, { slotReservationId, patientId }) {
  const qs = new URLSearchParams({
    context: 'create-booked-appointment',
    appointmentTemporalType: 'timed',
    slotReservationId,
    patientId,
  });
  const resp = await fetch(`${origin}/scheduling/data/appointment/create-appointment?${qs}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`Create form: ${resp.status}`);
  return resp.json();
}

export async function createAppointment(origin, payload) {
  const resp = await fetch(`${origin}/scheduling/appointment/create-appointment`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`Create appointment: ${resp.status}`);
  return resp.json();
}

export async function releaseReservation(origin, slotReservationId) {
  if (!origin || !slotReservationId) return;
  try {
    await fetch(
      `${origin}/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ slotReservationId }),
      }
    );
  } catch (_) {}
}
