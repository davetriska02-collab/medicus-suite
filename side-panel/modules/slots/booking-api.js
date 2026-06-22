// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking API client for the Slots module.
//
// The /scheduling/* endpoints live on the API subdomain
// ({siteId}.api.england.medicus.health) — the SAME host the slots-overview call
// already uses (see slots.js) — NOT the page host. The page host serves the SPA
// HTML shell for /scheduling/* (that was the source of the "Unexpected token '<'"
// JSON errors). The side panel is an extension page with host_permissions for
// *.api.england.medicus.health, so it can fetch that host directly with
// credentials, exactly like the overview call does.
'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}

// Returns { tabId, origin, apiBase, tab } for the best available Medicus app tab,
// or null if no Medicus tab is open / signed in. apiBase is the scheduling API
// host derived from the site id in the tab's URL path.
export async function detectMedicusTab() {
  const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
  for (const t of tabs) {
    try {
      const u = new URL(t.url);
      if (u.hostname.includes('.api.')) continue;
      const siteId = u.pathname.split('/').filter(Boolean)[0] || '';
      if (!/^[0-9a-f]{4,}$/i.test(siteId)) continue;
      return { tabId: t.id, origin: u.origin, apiBase: `https://${siteId}.api.${u.hostname}`, tab: t };
    } catch (_) {}
  }
  return null;
}

// Detects the patient UUID from the given tab object. Handles:
//   - direct patient URLs: /patient/{uuid}, /care-record/{uuid}
//   - task URLs: /tasks/data/{typeSlug}/overview/{taskUuid}
// Task URLs are resolved via the API subdomain (returns data.patient.id).
export async function detectPatientId(tab) {
  if (!tab) return null;
  let u;
  try {
    u = new URL(tab.url);
  } catch (_) {
    return null;
  }

  const careMatch = u.pathname.match(/\/care-record\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (careMatch) return careMatch[1];

  const patMatch = u.pathname.match(/\/patient\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (patMatch) return patMatch[1];

  // Task URL: /tasks/data/{typeSlug}/overview/{taskUuid} — taskUuid ≠ patientId
  const taskMatch = u.pathname.match(
    /\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  );
  if (taskMatch) {
    const parts = u.pathname.split('/').filter(Boolean);
    const siteId = parts[0];
    if (/^[0-9a-f]{4,}$/i.test(siteId)) {
      const apiBase = `https://${siteId}.api.${u.hostname}`;
      const typeSlug = taskMatch[1];
      const taskUuid = taskMatch[2];
      try {
        const resp = await fetch(`${apiBase}/tasks/data/${typeSlug}/overview/${taskUuid}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
        if (resp.ok) {
          const data = await resp.json();
          return data?.data?.patient?.id || data?.data?.patientId || data?.patient?.id || data?.patientId || null;
        }
      } catch (_) {}
    }
  }

  return null;
}

// Direct credentialed fetch against the scheduling API subdomain. Reads the body
// as text first so a stray HTML response yields a clear message rather than a
// cryptic JSON-parse error.
async function apiFetch(url, opts) {
  opts = opts || {};
  const resp = await fetch(url, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
    body: opts.body,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Scheduling API returned an unexpected response.');
  }
}

export async function fetchAppointmentFinder(apiBase) {
  return apiFetch(`${apiBase}/scheduling/data/appointment-service/available-appointment-finder`);
}

export async function fetchAvailableSlots(apiBase, { providerId, appointmentTypeId, date }) {
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
  const data = await apiFetch(
    `${apiBase}/scheduling/data/appointment-service/available-appointment-places-between-range?${qs}`
  );
  const slots = [];
  for (const diary of data.availablePlaces?.[date]?.diaries || []) {
    for (const entry of diary.entries || []) {
      if (entry.diaryEntryType?.isSlot) slots.push(entry);
    }
  }
  return slots;
}

export async function reserveSlot(apiBase, { diaryId, startDateTime, duration, appointmentTypeId }) {
  return apiFetch(`${apiBase}/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress`, {
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

export async function fetchCreateForm(apiBase, { slotReservationId, patientId }) {
  const qs = new URLSearchParams({
    context: 'create-booked-appointment',
    appointmentTemporalType: 'timed',
    slotReservationId,
    patientId,
  });
  return apiFetch(`${apiBase}/scheduling/data/appointment/create-appointment?${qs}`);
}

export async function createAppointment(apiBase, payload) {
  return apiFetch(`${apiBase}/scheduling/appointment/create-appointment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function releaseReservation(apiBase, slotReservationId) {
  if (!apiBase || !slotReservationId) return;
  try {
    await apiFetch(
      `${apiBase}/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotReservationId }),
      }
    );
  } catch (_) {}
}
