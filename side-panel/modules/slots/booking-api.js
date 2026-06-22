// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking API client for the Slots module.
//
// All /scheduling/* endpoints on england.medicus.health are same-origin only:
// they return the SPA HTML shell to cross-origin callers. We relay those
// fetches through booking-bridge.js (a content script running inside the
// Medicus tab) via chrome.tabs.sendMessage so the browser sees them as
// same-origin XHR with full session-cookie context.
'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}

// Returns { tabId, origin, tab } for the best available Medicus app tab,
// or null if no Medicus tab is open / signed in.
export async function detectMedicusTab() {
  const tabs = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
  for (const t of tabs) {
    try {
      const u = new URL(t.url);
      if (!u.hostname.includes('.api.')) return { tabId: t.id, origin: u.origin, tab: t };
    } catch (_) {}
  }
  return null;
}

// Detects the patient UUID from the given tab object. Handles:
//   - direct patient URLs: /patient/{uuid}, /care-record/{uuid}
//   - task URLs: /tasks/data/{typeSlug}/overview/{taskUuid}
// Task URLs are resolved via the API subdomain (works cross-origin from the
// extension — only the main-host /scheduling/ endpoints are origin-gated).
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

// Execute a fetch inside the Medicus tab via chrome.scripting.executeScript so
// it runs in the tab's renderer process (same-origin, full session cookies).
// No pre-loaded content script is required — executeScript injects on demand.
async function bridgeFetch(tabId, url, opts) {
  opts = opts || {};
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: async (fetchUrl, method, headers, body) => {
        try {
          const resp = await fetch(fetchUrl, {
            method,
            credentials: 'include',
            headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, headers),
            ...(body ? { body } : {}),
          });
          const text = await resp.text();
          return { ok: resp.ok, status: resp.status, text };
        } catch (err) {
          return { error: err.message };
        }
      },
      args: [url, opts.method || 'GET', opts.headers || {}, opts.body || null],
    });
  } catch (err) {
    throw new Error(`Could not reach Medicus tab: ${err.message}`);
  }
  const result = results?.[0]?.result;
  if (!result) throw new Error('No response from Medicus tab — try refreshing the Medicus tab.');
  if (result.error) throw new Error(result.error);
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  return JSON.parse(result.text);
}

export async function fetchAppointmentFinder(tabId, origin) {
  return bridgeFetch(tabId, `${origin}/scheduling/data/appointment-service/available-appointment-finder`);
}

export async function fetchAvailableSlots(tabId, origin, { providerId, appointmentTypeId, date }) {
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
  const data = await bridgeFetch(
    tabId,
    `${origin}/scheduling/data/appointment-service/available-appointment-places-between-range?${qs}`
  );
  const slots = [];
  for (const diary of data.availablePlaces?.[date]?.diaries || []) {
    for (const entry of diary.entries || []) {
      if (entry.diaryEntryType?.isSlot) slots.push(entry);
    }
  }
  return slots;
}

export async function reserveSlot(tabId, origin, { diaryId, startDateTime, duration, appointmentTypeId }) {
  return bridgeFetch(
    tabId,
    `${origin}/scheduling/slot-reservation/reserve-slot-and-broadcast-appointment-booking-in-progress`,
    {
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
    }
  );
}

export async function fetchCreateForm(tabId, origin, { slotReservationId, patientId }) {
  const qs = new URLSearchParams({
    context: 'create-booked-appointment',
    appointmentTemporalType: 'timed',
    slotReservationId,
    patientId,
  });
  return bridgeFetch(tabId, `${origin}/scheduling/data/appointment/create-appointment?${qs}`);
}

export async function createAppointment(tabId, origin, payload) {
  return bridgeFetch(tabId, `${origin}/scheduling/appointment/create-appointment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function releaseReservation(tabId, origin, slotReservationId) {
  if (!tabId || !origin || !slotReservationId) return;
  try {
    await bridgeFetch(
      tabId,
      `${origin}/scheduling/slot-reservation/remove-slot-reservation-and-broadcast-appointment-booking-ended`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotReservationId }),
      }
    );
  } catch (_) {}
}
