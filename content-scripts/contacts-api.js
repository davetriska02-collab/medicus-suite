// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Contacts linking: credentialed API wrapper (isolated-world content script)
//
// Thin wrapper around Medicus's own patient-contact endpoints, all confirmed via live HAR
// capture during the Contacts Management build (see the build plan). Same pattern as
// content-scripts/task-inline.js's apiFetch/apiBaseUrl: same-origin fetch with
// `credentials: 'include'` — content scripts already share the page's cookie jar, so no auth
// header is needed. The MAIN-world bridge (page-world.js) is NOT used here; it exists only to
// observe Medicus's OWN traffic under CSP constraints, not for the extension's own writes.
//
// Patient/site identity resolution reuses `window.SentinelApiClient` (engine/api-client.js),
// already loaded earlier in the manifest's content-script list — confirmed proven precedent:
// content-scripts/triage-lens/content.js reads `window.SentinelApiClient` from a LATER manifest
// block than the one that declares engine/api-client.js, so cross-block sharing of this global is
// established, working behaviour in this codebase, not an assumption.
'use strict';

(function () {
  if (window.ContactsApi) return; // re-entry guard

  // ── Canonical relationship data (browser-side wiring) ────────────────────────────────────────
  // engine/contact-relationships.js requires() the JSON directly under Node, but a content-script
  // browser context has no require() — it falls back to an empty placeholder until something sets
  // `window.ContactRelationshipsData`. This is that something: fetch the bundled JSON via
  // chrome.runtime.getURL (declared in manifest.json's web_accessible_resources) once, and cache
  // the in-flight promise so concurrent callers don't trigger duplicate fetches. Called eagerly at
  // the bottom of this file (fire-and-forget) so the data is very likely already loaded by the
  // time the user opens the widget; doOpen() in contacts-link-button.js also awaits it directly as
  // a safety net for the rare case a click beats the fetch.
  let _relationshipsDataPromise = null;
  function ensureRelationshipsData() {
    if (window.ContactRelationshipsData) return Promise.resolve(window.ContactRelationshipsData);
    if (_relationshipsDataPromise) return _relationshipsDataPromise;
    _relationshipsDataPromise = fetch(chrome.runtime.getURL('rules/contact-relationships.json'))
      .then((r) => r.json())
      .then((data) => {
        window.ContactRelationshipsData = data;
        return data;
      })
      .catch((err) => {
        _relationshipsDataPromise = null; // allow a retry on the next call
        throw err;
      });
    return _relationshipsDataPromise;
  }

  // ── Identity / API base resolution ───────────────────────────────────────────────────────────

  // resolveContext() -> { apiBase, patientId } | null
  // Tries the URL first (detectMedicusContext), then falls back to a DOM scan
  // (findPatientUuidFromDom) — same two-strategy, fail-closed-on-ambiguity resolution every other
  // feature in this repo uses. Returns null (never guesses) if neither resolves a patient.
  function resolveContext() {
    const API = window.SentinelApiClient;
    if (!API) return null;
    const ctx = API.detectMedicusContext(location.href);
    if (!ctx || !ctx.apiBase) return null;
    const patientId = ctx.patientUuid || API.findPatientUuidFromDom(document);
    if (!patientId) return null;
    return { apiBase: ctx.apiBase, patientId };
  }

  // ── Fetch wrapper ─────────────────────────────────────────────────────────────────────────────

  // Best-effort extraction of Medicus's own error detail from a failed response body, so a 4xx/5xx
  // surfaces the REASON (e.g. a specific field validation message) rather than just a bare status
  // code — the single biggest thing that makes a live API error self-diagnosing without needing a
  // fresh HAR capture every time.
  async function readErrorDetail(resp) {
    try {
      const text = await resp.text();
      if (!text) return '';
      try {
        const json = JSON.parse(text);
        return json.message || json.error || json.title || json.detail || text.slice(0, 300);
      } catch (_) {
        return text.slice(0, 300);
      }
    } catch (_) {
      return '';
    }
  }

  async function apiFetch(apiBase, path, opts) {
    opts = opts || {};
    const resp = await fetch(`${apiBase}${path}`, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
      body: opts.body,
    });
    if (!resp.ok) {
      const detail = await readErrorDetail(resp);
      throw new Error(`API ${resp.status} on ${opts.method || 'GET'} ${path}${detail ? ': ' + detail : ''}`);
    }
    const text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Medicus contacts API returned an unexpected response.');
    }
  }

  function postJson(apiBase, path, body) {
    return apiFetch(apiBase, path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ── Endpoint wrappers — every shape below is a live-confirmed call, not a guess ────────────────

  function searchPatients(apiBase, query) {
    return apiFetch(apiBase, `/patient/patient-finder?query=${encodeURIComponent(query)}`).then((r) => r.results || []);
  }

  function getPatientDetails(apiBase, patientId) {
    return apiFetch(apiBase, `/patient/data/patient/patient-details/${encodeURIComponent(patientId)}`);
  }

  function getAddPatientContactPreDialog(apiBase, patientId) {
    return apiFetch(apiBase, `/patient/data/patient-contact/add-patient-contact/${encodeURIComponent(patientId)}`);
  }

  function previewLinkCandidate(apiBase, patientId, linkPatientId) {
    return apiFetch(
      apiBase,
      `/patient/data/patient-contact/link-patient/${encodeURIComponent(patientId)}/${encodeURIComponent(linkPatientId)}`
    );
  }

  // body: exact shape from engine/contact-relationships.js's buildLinkPatientBody()
  function linkPatient(apiBase, body) {
    return postJson(apiBase, '/patient/patient-contact/link-patient', body);
  }

  function lookupPatientContacts(apiBase, patientId, otherPatientId) {
    return apiFetch(
      apiBase,
      `/patient/data/patient-contact/lookup-patient-contacts/${encodeURIComponent(patientId)}/${encodeURIComponent(otherPatientId)}`
    );
  }

  // body: { patientId, patientContactRelationships: [{ patientContactId, relationship, nextOfKin, copyCorrespondence, notes }] }
  // CONFIRMED BEHAVIOUR (do not use this to "convert" a manual contact): this is a BLIND copy that
  // preserves whatever the source contact already was. If the source patientContactId is itself
  // still a manual (unlinked) entry, the copy is ALSO manual — it does NOT create a real link.
  // Only call this against source contacts that are already real Medicus links.
  function linkContactsBulk(apiBase, body) {
    return postJson(apiBase, '/patient/patient-contact/link-contacts', body);
  }

  // body: exact shape from engine/contact-relationships.js's buildManualContactBody()
  function createManualContact(apiBase, body) {
    return postJson(apiBase, '/patient/patient-contact/create-patient-contact', body);
  }

  function viewPatientContact(apiBase, relationshipId) {
    return apiFetch(
      apiBase,
      `/patient/data/patient-contact/view-patient-contact/${encodeURIComponent(relationshipId)}`
    );
  }

  function deletePatientContactRelationship(apiBase, relationshipId) {
    return postJson(
      apiBase,
      `/patient/patient-contact/delete-patient-contact-relationship/${encodeURIComponent(relationshipId)}`,
      undefined
    );
  }

  function getAddressOverview(apiBase, addressId) {
    return apiFetch(apiBase, `/patient/data/home-address/overview/${encodeURIComponent(addressId)}`);
  }

  window.ContactsApi = {
    ensureRelationshipsData,
    resolveContext,
    searchPatients,
    getPatientDetails,
    getAddPatientContactPreDialog,
    previewLinkCandidate,
    linkPatient,
    lookupPatientContacts,
    linkContactsBulk,
    createManualContact,
    viewPatientContact,
    deletePatientContactRelationship,
    getAddressOverview,
  };

  // Fire-and-forget — see ensureRelationshipsData()'s comment above.
  ensureRelationshipsData().catch(() => {
    /* contacts-link-button.js's own doOpen() retries this and surfaces any real failure */
  });
})();
