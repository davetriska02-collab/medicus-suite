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
      if (!text) return { text: '', errorCode: null };
      try {
        const json = JSON.parse(text);
        // Confirmed live: Medicus 403s with { errorCode: "inactive-patient-access" } for a patient
        // past the access grace period — normally gated behind an "are you sure" popup in the
        // Medicus UI that this credentialed fetch can't click through. Translated to plain English
        // rather than surfacing the raw error-code JSON; deliberately NOT worked around (an
        // inactive record is also the least likely to have current contact info worth converting).
        // errorCode is also returned alongside the translated text (not just baked into it) so a
        // caller that needs to BRANCH on this specific case (e.g. the family-cycling skip-loop in
        // contacts-canvas.js) can check a stable code rather than substring-matching prose that's
        // free to reword later.
        if (json.errorCode === 'inactive-patient-access') {
          return {
            text: "this patient's record is inactive (past the access grace period) and can't be opened here.",
            errorCode: 'inactive-patient-access',
          };
        }
        return {
          text: json.message || json.error || json.title || json.detail || text.slice(0, 300),
          errorCode: json.errorCode || null,
        };
      } catch (_) {
        return { text: text.slice(0, 300), errorCode: null };
      }
    } catch (_) {
      return { text: '', errorCode: null };
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
      const err = new Error(
        `API ${resp.status} on ${opts.method || 'GET'} ${path}${detail.text ? ': ' + detail.text : ''}`
      );
      err.status = resp.status;
      err.errorCode = detail.errorCode;
      throw err;
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

  // Confirmed via HAR capture 2026-07-25 (editing an existing phone number, not creating one —
  // the earlier capture only covered create-telephone-number). Used to let the contacts canvas
  // correct a candidate's own wrongly-attributed phone number (e.g. a parent's mobile left on a
  // child's own record, flagged via patientTelephoneNumbers[].notes) directly from the
  // merge-compare panel, without leaving the canvas. This edits the PATIENT's own registered
  // number, not a "contact" relationship record — a different, materially bigger write than
  // everything else in contacts-api.js, so it gets its own pair of functions rather than reusing
  // the patient-contact naming/shape.
  function getEditTelephoneNumber(apiBase, telephoneNumberId) {
    return apiFetch(apiBase, `/patient/data/telephone/edit-telephone-number/${encodeURIComponent(telephoneNumberId)}`);
  }

  // body: { id, telephoneNumber, telephoneNumberType, preferredTelephoneNumberForSms, notes }
  // Note: no patientId in the body — confirmed live that `id` (the telephoneNumberId) alone
  // identifies which patient's number this updates.
  function changeTelephoneNumber(apiBase, body) {
    return postJson(apiBase, '/patient/telephone/change-telephone-number', body);
  }

  // Confirmed via HAR capture 2026-07-26 (changing a phone number's type, then deleting it — the
  // same capture that confirmed the four-type enum used elsewhere). No request body, id in the
  // URL only, same shape as deletePatientContactRelationship.
  function deleteTelephoneNumber(apiBase, telephoneNumberId) {
    return postJson(
      apiBase,
      `/patient/telephone/delete-telephone-number/${encodeURIComponent(telephoneNumberId)}`,
      undefined
    );
  }

  // Confirmed via HAR capture 2026-07-26 (editing an EXISTING patient-contact's relationship —
  // creating a new one is buildLinkPatientBody/linkPatient, an entirely different endpoint). Lets
  // the canvas write a corrected relationship label back to Medicus for an already-real link whose
  // recorded free text didn't map to a canonical category, once the user picks one via the confirm
  // panel. The id used here is the SAME patientContactId already used by viewPatientContact /
  // deletePatientContactRelationship (findExistingForwardLink's own patientContactId field) — this
  // response just calls it patientContactRelationshipId, an API naming inconsistency, not a
  // different id (Medicus itself has no canonical relationship vocabulary at all: even for a real
  // patient-to-patient link, patientContactRelationship is plain free text on their side, exactly
  // like a manual contact's).
  function getEditPatientContact(apiBase, relationshipId) {
    return apiFetch(
      apiBase,
      `/patient/data/patient-contact/edit-patient-contact/${encodeURIComponent(relationshipId)}`
    );
  }

  // body: { patientContactTitle, patientContactFirstName, patientContactMiddleNames, patientContactLastName,
  //   patientContactHomeTelephoneNumber, patientContactMobileTelephoneNumber, patientContactWorkTelephoneNumber,
  //   patientContactEmailAddress, patientContactAddress, patientContactRelationship,
  //   patientContactRelationshipIsNextOfKin, patientContactRelationshipNotes,
  //   patientContactRelationshipCopyCorrespondence }
  // Confirmed live: for a REAL linked contact (getEditPatientContact returns contactEditable:false)
  // every manual-contact-only field above (name/phone/email/address) was sent null in the capture
  // and had no effect — only the patientContactRelationship* fields actually apply to a real link.
  // Full replace, not a partial update — callers preserve isNextOfKin/notes/copyCorrespondence from
  // the GET response unless deliberately changing them too.
  function changePatientContact(apiBase, relationshipId, body) {
    return postJson(
      apiBase,
      `/patient/patient-contact/change-patient-contact/${encodeURIComponent(relationshipId)}`,
      body
    );
  }

  // ── Shared write orchestration (used by both the wizard widget and the canvas) ─────────────────
  // Safety-critical logic — the wrong-patient guard and duplicate-link avoidance — lives here ONCE
  // so the two UI surfaces that both create real Medicus links can't drift out of sync on it.

  // findReverseManualMatch(apiBase, candidatePatientId, indexPatientFullName) -> best-guess manual
  // contact on the CANDIDATE's own record that might represent the index patient (e.g. the
  // mother's own GP2GP-imported "daughter" manual entry), offered for cleanup after a fresh
  // reverse link is created. Deliberately best-effort and NEVER auto-deletes — only a name match
  // against a patient we've never viewed from their side, so the human always makes the final
  // call. Returns null on any failure or if nothing scores highly enough. The returned object also
  // carries the match's own full detail (phone/email/notes, via view-patient-contact) so a caller
  // can show the same kind of comparison evidence as the main merge panel before the user decides
  // whether to remove it — a best-effort ADDITION, never blocks returning the match itself if this
  // second fetch fails.
  async function findReverseManualMatch(apiBase, candidatePatientId, indexPatientFullName) {
    try {
      const candidateDetails = await getPatientDetails(apiBase, candidatePatientId);
      const manuals = (
        (candidateDetails.patientContactsSection && candidateDetails.patientContactsSection.patientContacts) ||
        []
      ).filter((c) => !c.patientContactPatientId);
      if (!manuals.length || !indexPatientFullName) return null;
      let best = null;
      for (const m of manuals) {
        const score = window.ContactMatch.nameSimilarity(indexPatientFullName, m.patientContactName);
        if (!best || score > best.score) best = { contact: m, score };
      }
      if (!best || best.score < 0.6) return null;
      const detail = await viewPatientContact(apiBase, best.contact.patientContactId).catch(() => null);
      return Object.assign({}, best.contact, { detail });
    } catch (_) {
      return null; // best-effort only — never blocks or fails the main write
    }
  }

  // performLinkAndCleanup(params) -> { summary, reverseManualMatch }
  //   apiBase, patientId (index patient, the identity the WRONG-PATIENT GUARD re-verifies),
  //   candidatePatientId, candidateDisplayName, indexPatientFullName,
  //   baseId, modifierId, forwardIsNextOfKin, forwardCopyCorrespondence, notes,
  //   existingForwardLink (entry|null — skips the forward write if set),
  //   reverseBaseId (string|null — fires the reverse write only if set), reverseIsNextOfKin, reverseCopyCorrespondence,
  //   existingReciprocal (entry|null — informational only, for the summary text),
  //   manualContactIdToDelete (string|null)
  //
  // WRONG-PATIENT GUARD lives HERE (not in each caller) so it can never be forgotten or
  // implemented slightly differently by a second UI surface: re-derives the live page's current
  // patient identity via resolveContext() and aborts before any write if it no longer matches the
  // patientId the caller pinned when the user opened this confirm action.
  async function performLinkAndCleanup(params) {
    const ctx = resolveContext();
    if (!ctx || ctx.patientId !== params.patientId) {
      throw new Error('The page has moved to a different patient — reopen the panel and try again.');
    }
    const CR = window.ContactRelationships;

    if (!params.existingForwardLink) {
      const forwardBody = CR.buildLinkPatientBody({
        patientId: params.patientId,
        linkPatientId: params.candidatePatientId,
        baseId: params.baseId,
        modifierId: params.modifierId,
        isNextOfKin: params.forwardIsNextOfKin,
        copyCorrespondence: params.forwardCopyCorrespondence,
        notes: params.notes,
      });
      await linkPatient(params.apiBase, forwardBody);
    } else if (params.relationshipUpdateId) {
      // The link already exists, but its relationship text didn't map to a canonical category
      // (relationshipKnown was false) — the user has just picked one via the confirm panel's
      // picker, so write it back rather than only reclassifying it locally for this canvas
      // session. Fetch first rather than reusing anything cached: isNextOfKin/notes/
      // copyCorrespondence must be preserved exactly as currently recorded (this is a full
      // replace, not a partial update), and this is a fresh enough action that a stale local copy
      // isn't worth the risk of clobbering a value someone else changed since page load.
      const current = await getEditPatientContact(params.apiBase, params.relationshipUpdateId);
      await changePatientContact(params.apiBase, params.relationshipUpdateId, {
        patientContactTitle: null,
        patientContactFirstName: null,
        patientContactMiddleNames: null,
        patientContactLastName: null,
        patientContactHomeTelephoneNumber: null,
        patientContactMobileTelephoneNumber: null,
        patientContactWorkTelephoneNumber: null,
        patientContactEmailAddress: null,
        patientContactAddress: null,
        patientContactRelationship: CR.formatLabel(params.baseId, params.modifierId),
        patientContactRelationshipIsNextOfKin: current.patientContactRelationshipIsNextOfKin,
        patientContactRelationshipNotes: current.patientContactRelationshipNotes,
        patientContactRelationshipCopyCorrespondence: current.patientContactRelationshipCopyCorrespondence,
      });
    }

    let reverseManualMatch = null;
    if (params.reverseBaseId) {
      const reverseBody = CR.buildLinkPatientBody({
        patientId: params.candidatePatientId,
        linkPatientId: params.patientId,
        baseId: params.reverseBaseId,
        modifierId: params.modifierId,
        isNextOfKin: params.reverseIsNextOfKin,
        copyCorrespondence: params.reverseCopyCorrespondence,
        notes: null,
      });
      await linkPatient(params.apiBase, reverseBody);
      reverseManualMatch = await findReverseManualMatch(
        params.apiBase,
        params.candidatePatientId,
        params.indexPatientFullName
      );
    }

    if (params.manualContactIdToDelete) {
      await deletePatientContactRelationship(params.apiBase, params.manualContactIdToDelete);
    }

    // Built from what actually happened rather than assumed, since callers differ: the wizard
    // widget always has a manual contact to delete, but the canvas can also link a fresh
    // Medicus-only candidate with no manual precedent at all.
    const parts = [];
    parts.push(
      params.existingForwardLink
        ? `${params.candidateDisplayName} was already linked — no new forward link created`
        : `Linked to ${params.candidateDisplayName}`
    );
    if (params.relationshipUpdateId) parts.push('updated their recorded relationship');
    if (params.manualContactIdToDelete) parts.push('removed the old manual contact');
    if (params.reverseBaseId) parts.push('created the reverse link on their record');
    else if (params.existingReciprocal) parts.push('left their existing reverse link untouched');
    const summary = parts.join('; ') + '.';

    return { summary, reverseManualMatch };
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
    getEditTelephoneNumber,
    changeTelephoneNumber,
    deleteTelephoneNumber,
    getEditPatientContact,
    changePatientContact,
    findReverseManualMatch,
    performLinkAndCleanup,
  };

  // Fire-and-forget — see ensureRelationshipsData()'s comment above.
  ensureRelationshipsData().catch(() => {
    /* contacts-link-button.js's own doOpen() retries this and surfaces any real failure */
  });
})();
