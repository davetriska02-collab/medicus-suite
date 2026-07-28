// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking API shim for the Slots module.
//
// THE SPLIT (Phase D1 of docs/plans/RECEPTION-FEEDBACK-2026-07-28.md):
//
//   shared/booking-core.js  — the ENDPOINTS. Every /scheduling/* call, the
//                             window search and its caps, the keepalive release.
//                             One copy, shared by every booking surface; it
//                             exports NO tab detection and refuses to create an
//                             appointment without an explicit patientId.
//   this file (the shim)    — the slots module's IDENTITY resolution
//                             (detectMedicusTab / detectPatientId) plus a
//                             re-export of the core, so slots.js's existing
//                             `import { … } from './booking-api.js'` is
//                             unchanged by the extraction.
//
// Why detection stays here and not in the core: two identity sources exist in
// the suite and can disagree — reception resolves the *active* tab, this file
// resolves the *first matching* Medicus tab, active or not. Baking either one
// into the shared core would let a caller book the patient from tab 2 while
// showing the patient from tab 1, with a commit-time re-verify that passes
// because it re-checks the same wrong source (plan D1.2, hazard H-043).
//
// The /scheduling/* endpoints live on the API subdomain
// ({siteId}.api.england.medicus.health) — the SAME host the slots-overview call
// already uses (see slots.js) — NOT the page host. The page host serves the SPA
// HTML shell for /scheduling/* (that was the source of the "Unexpected token '<'"
// JSON errors). The side panel is an extension page with host_permissions for
// *.api.england.medicus.health, so it can fetch that host directly with
// credentials, exactly like the overview call does.
'use strict';

export {
  MAX_WINDOW_DAYS,
  MAX_CONCURRENCY,
  fetchAppointmentFinder,
  fetchAvailableSlots,
  reserveSlot,
  fetchCreateForm,
  createAppointment,
  releaseReservation,
  findSlotsInWindow,
} from '../../../shared/booking-core.js';

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
