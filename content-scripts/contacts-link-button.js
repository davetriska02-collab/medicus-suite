// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Contacts linking: injected "Convert to linked contact" widget
//
// Phase 1 of the Contacts Management build: a single-contact manual→linked conversion flow,
// injected onto the patient admin-record page next to the manual-contacts card. Validates the
// full write path (search, link both directions, delete the old manual entry) before the bigger
// drag-and-drop family-tree canvas (later phases) is built on top of it.
//
// Structural template: content-scripts/task-inline.js (state object replaced wholesale on SPA
// navigation, dom-observer-hub subscription, own-mutation filtering, wrong-patient guard
// immediately before every write). Business logic (API calls, relationship vocabulary, matching)
// comes from window.ContactsApi / window.ContactRelationships / window.ContactMatch.
//
// PROVISIONAL DOM ANCHOR: findContactsHeading() below guesses the contacts card's heading text
// (/contacts?/i). This has NOT been verified against the live Medicus admin-record page — unlike
// task-inline.js's "Codes & actions" heading (confirmed from real traffic), this repo has no
// existing capture of the admin-record page's actual rendered DOM. Verify live and tighten
// HEADING_RE / the anchor-walk once real markup is seen.
'use strict';

(function () {
  if (window.__msContactsWidget) return;
  window.__msContactsWidget = true;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────

  function blankState() {
    return {
      open: false,
      apiBase: null,
      patientId: null,
      indexPatientDetails: null, // full patient-details response for the page's own patient
      loading: false,
      error: null,
      step: 'pick', // 'pick' | 'search' | 'confirm' | 'working' | 'done'

      manualContacts: [], // [{ patientContactId, patientContactName, patientContactRelationship }]
      selectedManualContact: null,
      selectedManualDetail: null, // full view-patient-contact response
      relationshipGuess: null, // { baseId, modifierId, confidence } | null

      searchQuery: '',
      searchResults: [], // ranked: [{ candidate, score, tier, signals }]
      selectedCandidate: null,
      candidatePreview: null, // link-patient preview response
      existingReciprocal: null, // entry from indexPatientDetails.patientLinkedContactsSection matching the candidate, if any
      existingForwardLink: null, // entry from indexPatientDetails.patientContactsSection matching the candidate, if any
      baseIdSuggestedFromReciprocal: false,

      baseId: null,
      modifierId: null,
      forwardIsNextOfKin: false,
      forwardCopyCorrespondence: false,
      notes: '',
      reverseBaseId: null, // editable — pre-filled from invertRelationship when unambiguous
      reverseAmbiguous: false,
      reverseIsNextOfKin: false,
      reverseCopyCorrespondence: false,

      workingError: null,
      doneSummary: null,
      reverseManualMatch: null, // a likely-matching manual contact found on the candidate's OWN record, offered for removal
      reverseManualMatchError: null,
    };
  }

  let s = blankState();

  // ── DOM anchor (provisional — see file header) ──────────────────────────────────────────────

  const HEADING_SEL = 'h1,h2,h3,h4,h5,h6,strong,b,legend';
  const HEADING_RE_EXACT = /^\s*(patient\s+)?contacts?\s*$/i;
  const HEADING_RE_LOOSE = /contact/i;

  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  function findContactsHeading() {
    const candidates = Array.from(document.querySelectorAll(HEADING_SEL)).filter(
      (el) => !el.firstElementChild && !el.closest('#ms-contacts-widget') && visible(el)
    );
    const exact = candidates.find((el) => HEADING_RE_EXACT.test(el.textContent.trim()));
    if (exact) return exact;
    return candidates.find((el) => HEADING_RE_LOOSE.test(el.textContent.trim())) || null;
  }

  function injectWidget() {
    if (document.getElementById('ms-contacts-widget')) return;
    const heading = findContactsHeading();
    if (!heading) return; // nothing to anchor to yet — a later mutation tick will retry
    const w = document.createElement('div');
    w.id = 'ms-contacts-widget';
    renderInto(w);
    withObserverPaused(() => heading.after(w));
  }

  function removeWidget() {
    const w = document.getElementById('ms-contacts-widget');
    if (!w) return;
    withObserverPaused(() => w.remove());
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    const w = document.getElementById('ms-contacts-widget');
    if (w) renderInto(w);
  }

  function buildHtml() {
    let body = '';
    if (s.open) {
      if (s.loading) {
        body = `<div class="ms-ct-body"><div class="ms-ct-loading">Loading…</div></div>`;
      } else if (s.error) {
        body = `<div class="ms-ct-body"><div class="ms-ct-error">${esc(s.error)}</div></div>`;
      } else if (s.step === 'pick') {
        body = renderPick();
      } else if (s.step === 'search') {
        body = renderSearch();
      } else if (s.step === 'confirm') {
        body = renderConfirm();
      } else if (s.step === 'working') {
        body = `<div class="ms-ct-body"><div class="ms-ct-loading">Linking contact…</div></div>`;
      } else if (s.step === 'done') {
        body = renderDone();
      }
    }
    return `
      <div class="ms-ct-header" id="ms-ct-toggle" role="button" tabindex="0" aria-expanded="${s.open}">
        <span class="ms-ct-chevron">${s.open ? '▾' : '▸'}</span>
        <span>Convert a manual contact to a linked patient</span>
      </div>
      ${body}
    `;
  }

  function renderPick() {
    if (!s.manualContacts.length) {
      return `<div class="ms-ct-body"><div class="ms-ct-empty">No manual (unlinked) contacts found on this record.</div></div>`;
    }
    const rows = s.manualContacts
      .map(
        (c) => `
        <div class="ms-ct-row ms-ct-pick-row" data-contact-id="${esc(c.patientContactId)}">
          <div>
            <div class="ms-ct-pick-name">${esc(c.patientContactName)}</div>
            <div class="ms-ct-pick-rel">${esc(c.patientContactRelationship || 'No relationship recorded')}</div>
          </div>
          <button class="ms-ct-btn-ghost ms-ct-pick-btn" data-contact-id="${esc(c.patientContactId)}">Convert</button>
        </div>`
      )
      .join('');
    return `<div class="ms-ct-body">${rows}</div>`;
  }

  function renderSearch() {
    const results = s.searchResults
      .map(
        (r) => `
        <div class="ms-ct-row ms-ct-result-row" data-patient-id="${esc(r.candidate.patientId)}">
          <div>
            <div class="ms-ct-pick-name">${esc(r.candidate.displayName)}</div>
            <div class="ms-ct-pick-rel">${esc(r.candidate.dateOfBirth || '')} ${r.candidate.atSameAddress ? '· same address' : ''}</div>
          </div>
          <span class="ms-ct-tier ms-ct-tier-${r.tier}">${r.tier} · ${r.score}</span>
        </div>`
      )
      .join('');
    return `
      <div class="ms-ct-body">
        <div class="ms-ct-row">
          <label class="ms-ct-label" for="ms-ct-search">Searching for</label>
          <input class="ms-ct-input" id="ms-ct-search" type="text" value="${esc(s.searchQuery)}" placeholder="Patient name" />
        </div>
        ${results || '<div class="ms-ct-empty">No matches yet — refine the search.</div>'}
      </div>
    `;
  }

  function renderConfirm() {
    const rel = window.ContactRelationships;
    const validMods = rel.validModifiersForBase(s.baseId);
    const allRelIds = Object.keys(rel.ALIAS_TERMS).concat(['other']);
    const baseSelect = allRelIds
      .map((id) => {
        const r = rel.getRelationship(id);
        if (!r) return '';
        return `<option value="${esc(id)}"${s.baseId === id ? ' selected' : ''}>${esc(r.label)}</option>`;
      })
      .join('');
    const modRadios = validMods.length
      ? `<div class="ms-ct-row"><span class="ms-ct-label">Modifier</span>
          <label><input type="radio" name="ms-ct-mod" value="" ${!s.modifierId ? 'checked' : ''}/> None</label>
          ${validMods
            .map(
              (m) =>
                `<label><input type="radio" name="ms-ct-mod" value="${esc(m)}" ${s.modifierId === m ? 'checked' : ''}/> ${esc(rel.getModifiers().find((mm) => mm.id === m).label)}</label>`
            )
            .join(' ')}
        </div>`
      : '';
    const reverseLine = s.existingReciprocal
      ? `<div class="ms-ct-warn">${esc(s.selectedCandidate.displayName)} already lists this patient as their own contact
           (recorded as "${esc(s.existingReciprocal.patientContactRelationship)}") — no new reverse link will be created,
           to avoid duplicating it. Review or update that existing relationship directly on their own record if needed.</div>`
      : s.reverseAmbiguous
        ? `<div class="ms-ct-warn">Could not work out the reverse relationship automatically (patient's gender not recorded) — choose it or leave the reverse link unset.</div>
         <select class="ms-ct-select" id="ms-ct-reverse-base"><option value="">— leave reverse unset —</option>${allRelIds
           .map((id) => {
             const r = rel.getRelationship(id);
             return r ? `<option value="${esc(id)}">${esc(r.label)}</option>` : '';
           })
           .join('')}</select>`
        : `<div class="ms-ct-row"><span class="ms-ct-label">On their own record, this will record</span>
           <strong>${esc(rel.formatLabel(s.reverseBaseId, s.modifierId))}</strong></div>`;

    // When the index patient already has a real link to this candidate (found the hard way — see
    // findExistingForwardLink's comment), there's nothing to pick: show what's already recorded
    // instead of a relationship form, and skip the forward write entirely in doConfirm().
    const forwardSection = s.existingForwardLink
      ? `<div class="ms-ct-warn">This patient already has a real link to ${esc(s.selectedCandidate.displayName)}
           (recorded as "${esc(s.existingForwardLink.patientContactRelationship)}") — no new link will be created here.
           This manual contact looks like a stale duplicate, safe to remove.</div>`
      : `<div class="ms-ct-row">
          <label class="ms-ct-label" for="ms-ct-base">Relationship</label>
          <select class="ms-ct-select" id="ms-ct-base">${baseSelect}</select>
          ${s.baseIdSuggestedFromReciprocal ? `<span class="ms-ct-note">Suggested from ${esc(s.selectedCandidate.displayName)}'s own record.</span>` : ''}
        </div>
        ${modRadios}
        <div class="ms-ct-row"><span class="ms-ct-label">On this patient's record</span>
          <label><input type="checkbox" id="ms-ct-fwd-nok" ${s.forwardIsNextOfKin ? 'checked' : ''}/> Next of kin</label>
          <label><input type="checkbox" id="ms-ct-fwd-copy" ${s.forwardCopyCorrespondence ? 'checked' : ''}/> Copy correspondence</label>
        </div>`;

    const nothingToLink = s.existingForwardLink && s.existingReciprocal;

    return `
      <div class="ms-ct-body">
        <div class="ms-ct-row"><span class="ms-ct-label">Linking to</span><strong>${esc(s.selectedCandidate.displayName)}</strong></div>
        ${forwardSection}
        ${reverseLine}
        ${
          !s.existingReciprocal
            ? `<div class="ms-ct-row"><span class="ms-ct-label">On their record${s.reverseAmbiguous ? ' (if a reverse relationship is chosen above)' : ''}</span>
                <label><input type="checkbox" id="ms-ct-rev-nok" ${s.reverseIsNextOfKin ? 'checked' : ''}/> Next of kin</label>
                <label><input type="checkbox" id="ms-ct-rev-copy" ${s.reverseCopyCorrespondence ? 'checked' : ''}/> Copy correspondence</label>
              </div>`
            : ''
        }
        <div class="ms-ct-row">
          <label class="ms-ct-label" for="ms-ct-notes">Notes (optional)</label>
          <textarea class="ms-ct-textarea" id="ms-ct-notes" rows="2">${esc(s.notes)}</textarea>
        </div>
        ${s.workingError ? `<div class="ms-ct-error">${esc(s.workingError)}</div>` : ''}
        <button class="ms-ct-btn" id="ms-ct-confirm">${nothingToLink ? 'Remove the stale manual contact' : 'Link and remove the old manual contact'}</button>
      </div>
    `;
  }

  function renderDone() {
    return `
      <div class="ms-ct-body ms-ct-success">
        <div class="ms-ct-success-icon">✓</div>
        <div>${esc(s.doneSummary || 'Contact linked.')}</div>
        <div class="ms-ct-note">Medicus's own contacts card won't show this change until the page is refreshed.</div>
        <button class="ms-ct-btn" id="ms-ct-reload">Refresh now</button>
        ${
          s.reverseManualMatch
            ? `<div class="ms-ct-warn">${esc(s.selectedCandidate.displayName)} also has a manual contact named
                 "${esc(s.reverseManualMatch.patientContactName)}" that may represent this patient — it was NOT
                 removed automatically since no one has confirmed the match. Remove it too?</div>
               <button class="ms-ct-btn-ghost" id="ms-ct-remove-reverse-manual">Remove it</button>`
            : ''
        }
        ${s.reverseManualMatchError ? `<div class="ms-ct-error">${esc(s.reverseManualMatchError)}</div>` : ''}
        <button class="ms-ct-btn-ghost" id="ms-ct-again">Convert another</button>
      </div>
    `;
  }

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────

  async function doOpen() {
    s.open = true;
    const ctx = window.ContactsApi.resolveContext();
    if (!ctx) {
      s.error = 'Could not identify the current patient — try reloading the page.';
      rerender();
      return;
    }
    s.apiBase = ctx.apiBase;
    s.patientId = ctx.patientId;
    s.loading = true;
    s.error = null;
    rerender();
    const st = s; // WRONG-PATIENT GUARD pin — see doConfirm() for the hard re-verify before writes
    try {
      // Safety net for contacts-api.js's fire-and-forget fetch of rules/contact-relationships.json
      // — normally already resolved by the time a user opens the widget, but await it explicitly
      // in case a very fast click beat the fetch.
      await window.ContactsApi.ensureRelationshipsData();
      if (st !== s) return;
      const details = await window.ContactsApi.getPatientDetails(st.apiBase, st.patientId);
      if (st !== s) return;
      st.indexPatientDetails = details;
      const contacts = (details.patientContactsSection && details.patientContactsSection.patientContacts) || [];
      st.manualContacts = contacts.filter((c) => !c.patientContactPatientId);
      st.step = 'pick';
    } catch (err) {
      st.error = err.message || 'Failed to load this patient’s contacts.';
    } finally {
      st.loading = false;
      if (st === s) rerender();
    }
  }

  function pickManualContact(contactId) {
    const contact = s.manualContacts.find((c) => c.patientContactId === contactId);
    if (!contact) return;
    s.selectedManualContact = contact;
    s.relationshipGuess = window.ContactRelationships.normaliseFreeText(contact.patientContactRelationship);
    s.searchQuery = contact.patientContactName || '';
    s.step = 'search';
    rerender();
    runSearch();
    // Full detail (phone/email/notes/flags) fetched in the background for scoring/pre-fill;
    // not blocking the search UI since it's supplementary, not required to proceed.
    window.ContactsApi.viewPatientContact(s.apiBase, contact.patientContactId).then(
      (detail) => {
        if (s.selectedManualContact !== contact) return; // user moved on — discard
        s.selectedManualDetail = detail;
      },
      () => {
        /* best-effort only — search/matching still works without it */
      }
    );
  }

  function candidateAgeFromDob(dateOfBirth) {
    if (!dateOfBirth) return null;
    const d = new Date(dateOfBirth);
    if (isNaN(d.getTime())) return null;
    const diffMs = Date.now() - d.getTime();
    return Math.floor(diffMs / (365.25 * 86400000));
  }

  function sameAddress(a, b) {
    if (!a || !b) return false;
    const norm = (addr) =>
      [addr.line1, addr.postalCode]
        .map((x) =>
          String(x || '')
            .trim()
            .toLowerCase()
        )
        .join('|');
    return !!(a.postalCode && b.postalCode) && norm(a) === norm(b);
  }

  async function runSearch() {
    const query = s.searchQuery.trim();
    if (query.length < 2) {
      s.searchResults = [];
      rerender();
      return;
    }
    const indexAddress =
      s.indexPatientDetails &&
      s.indexPatientDetails.patientAddressSection &&
      s.indexPatientDetails.patientAddressSection.patientAddresses[0] &&
      s.indexPatientDetails.patientAddressSection.patientAddresses[0].address;
    try {
      const results = await window.ContactsApi.searchPatients(s.apiBase, query);
      const candidates = results.map((r) => ({
        patientId: r.patientId,
        displayName: r.displayName,
        dateOfBirth: r.dateOfBirth,
        age: candidateAgeFromDob(r.dateOfBirth),
        genderIdentity: r.genderIdentity,
        atSameAddress: sameAddress(indexAddress, r.address),
      }));
      const manualContact = {
        name: (s.selectedManualContact && s.selectedManualContact.patientContactName) || '',
      };
      const indexAge = candidateAgeFromDob(
        s.indexPatientDetails &&
          s.indexPatientDetails.patientDetailsSection &&
          s.indexPatientDetails.patientDetailsSection.dateOfBirth
      );
      s.searchResults = window.ContactMatch.rankCandidates(manualContact, candidates, {
        manualRelationshipGuess: s.relationshipGuess,
        indexPatientAge: indexAge,
      });
    } catch (err) {
      s.error = err.message || 'Search failed.';
    }
    rerender();
  }

  // findExistingReciprocal(candidatePatientId) -> the "Listed as Contact For" entry (if any) that
  // proves the candidate ALREADY lists this index patient as one of their own contacts. Sourced
  // from patient-details' patientLinkedContactsSection, fetched once in doOpen(). Checking this
  // before offering a reverse link matters because POST link-patient has no idempotency guard of
  // its own — firing it again would create a genuine duplicate relationship on the candidate's
  // record, not update the existing one.
  function findExistingReciprocal(candidatePatientId) {
    const list =
      (s.indexPatientDetails &&
        s.indexPatientDetails.patientLinkedContactsSection &&
        s.indexPatientDetails.patientLinkedContactsSection.patientContacts) ||
      [];
    return list.find((c) => c.linkedPatientId === candidatePatientId) || null;
  }

  // findExistingForwardLink(candidatePatientId) -> an entry from the index patient's OWN
  // patientContactsSection that's already a REAL link to this candidate (patientContactPatientId
  // set, not a manual entry). Found the hard way: Medicus's own POST link-patient rejects a
  // duplicate with a 400 ("Patient Contact already exists.") rather than silently no-op'ing or
  // updating — this happens when a manual contact turns out to represent someone already linked
  // (e.g. its reciprocal-cleanup counterpart wasn't actually removed). Checking this first lets us
  // skip the redundant forward write and just clean up the stale manual duplicate instead of
  // erroring out.
  function findExistingForwardLink(candidatePatientId) {
    const list =
      (s.indexPatientDetails &&
        s.indexPatientDetails.patientContactsSection &&
        s.indexPatientDetails.patientContactsSection.patientContacts) ||
      [];
    return list.find((c) => c.patientContactPatientId === candidatePatientId) || null;
  }

  // suggestForwardFromReciprocal(reciprocalEntry, candidateGenderIdentity) -> { baseId, modifierId } | null
  // When the candidate already lists the index patient as their own contact (e.g. "Mother"), that's
  // a stronger signal for what the FORWARD relationship should default to than the manual entry's
  // own (possibly blank or unreliable) free text — invert the already-established relationship
  // using the CANDIDATE's own gender (they're the one whose son/daughter-type label depends on it,
  // since the relationship was recorded from their side).
  function suggestForwardFromReciprocal(reciprocalEntry, candidateGenderIdentity) {
    if (!reciprocalEntry) return null;
    const guess = window.ContactRelationships.normaliseFreeText(reciprocalEntry.patientContactRelationship);
    if (!guess) return null;
    const inv = window.ContactRelationships.invertRelationship({
      baseId: guess.baseId,
      modifierId: guess.modifierId,
      indexGender: candidateGenderIdentity,
    });
    return inv.ambiguous ? null : { baseId: inv.baseId, modifierId: inv.modifierId };
  }

  // findReverseManualMatch(candidatePatientId) -> best-guess manual contact on the CANDIDATE's own
  // record that might represent the index patient (e.g. the mother's own GP2GP-imported "daughter"
  // manual entry), so it can be OFFERED for cleanup after we've just created a fresh reverse link.
  // Deliberately best-effort and NEVER auto-deletes: we have no independent confirmation this
  // manual entry is really the same person (only a name match against a patient we've never
  // viewed from their side), so the human always makes the final call, same as every other match
  // in this tool. Returns null on any failure or if nothing scores highly enough.
  async function findReverseManualMatch(candidatePatientId) {
    try {
      const candidateDetails = await window.ContactsApi.getPatientDetails(s.apiBase, candidatePatientId);
      const manuals = (
        (candidateDetails.patientContactsSection && candidateDetails.patientContactsSection.patientContacts) ||
        []
      ).filter((c) => !c.patientContactPatientId);
      const indexName =
        s.indexPatientDetails &&
        s.indexPatientDetails.patientDetailsSection &&
        s.indexPatientDetails.patientDetailsSection.fullOfficialName;
      if (!manuals.length || !indexName) return null;
      let best = null;
      for (const m of manuals) {
        const score = window.ContactMatch.nameSimilarity(indexName, m.patientContactName);
        if (!best || score > best.score) best = { contact: m, score };
      }
      return best && best.score >= 0.6 ? best.contact : null;
    } catch (_) {
      return null; // best-effort only — never blocks or fails the main conversion
    }
  }

  async function pickCandidate(patientId) {
    const result = s.searchResults.find((r) => r.candidate.patientId === patientId);
    if (!result) return;
    s.selectedCandidate = result.candidate;
    s.existingReciprocal = findExistingReciprocal(patientId);
    s.existingForwardLink = findExistingForwardLink(patientId);
    s.step = 'confirm';
    const reciprocalSuggestion = suggestForwardFromReciprocal(s.existingReciprocal, result.candidate.genderIdentity);
    s.baseIdSuggestedFromReciprocal = !!reciprocalSuggestion;
    s.baseId =
      (reciprocalSuggestion && reciprocalSuggestion.baseId) ||
      (s.relationshipGuess && s.relationshipGuess.baseId) ||
      'other';
    s.modifierId =
      (reciprocalSuggestion && reciprocalSuggestion.modifierId) ||
      (s.relationshipGuess && s.relationshipGuess.modifierId) ||
      null;
    s.forwardIsNextOfKin = !!(s.selectedManualDetail && s.selectedManualDetail.patientContactRelationshipIsNextOfKin);
    s.forwardCopyCorrespondence = !!(
      s.selectedManualDetail && s.selectedManualDetail.patientContactRelationshipCopyCorrespondence
    );
    s.notes = (s.selectedManualDetail && s.selectedManualDetail.patientContactRelationshipNotes) || '';
    s.reverseIsNextOfKin = false;
    s.reverseCopyCorrespondence = false;
    recomputeReverse();
    rerender();
  }

  function recomputeReverse() {
    if (s.existingReciprocal) {
      // Already listed as a contact for this candidate — never offer a second reverse link.
      s.reverseAmbiguous = false;
      s.reverseBaseId = null;
      return;
    }
    const rel = window.ContactRelationships;
    const indexGender =
      s.indexPatientDetails &&
      s.indexPatientDetails.patientDetailsSection &&
      s.indexPatientDetails.patientDetailsSection.genderIdentity;
    const inv = rel.invertRelationship({ baseId: s.baseId, modifierId: s.modifierId, indexGender });
    s.reverseAmbiguous = inv.ambiguous;
    s.reverseBaseId = inv.ambiguous ? null : inv.baseId;
  }

  async function doConfirm() {
    if (s.step !== 'confirm' || !s.selectedCandidate || !s.baseId) return;
    s.step = 'working';
    s.workingError = null;
    rerender();
    // WRONG-PATIENT GUARD: pin state and re-verify the live page still shows this same patient
    // immediately before firing any write — a real clinical-record write must never land on the
    // wrong patient because the SPA silently navigated while this widget was open.
    const st = s;
    try {
      const ctx = window.ContactsApi.resolveContext();
      if (!ctx || ctx.patientId !== st.patientId) {
        throw new Error('The page has moved to a different patient — reopen the panel and try again.');
      }
      if (!st.existingForwardLink) {
        const forwardBody = window.ContactRelationships.buildLinkPatientBody({
          patientId: st.patientId,
          linkPatientId: st.selectedCandidate.patientId,
          baseId: st.baseId,
          modifierId: st.modifierId,
          isNextOfKin: st.forwardIsNextOfKin,
          copyCorrespondence: st.forwardCopyCorrespondence,
          notes: st.notes,
        });
        await window.ContactsApi.linkPatient(st.apiBase, forwardBody);
        if (st !== s) return;
      }

      if (st.reverseBaseId) {
        const reverseBody = window.ContactRelationships.buildLinkPatientBody({
          patientId: st.selectedCandidate.patientId,
          linkPatientId: st.patientId,
          baseId: st.reverseBaseId,
          modifierId: st.modifierId,
          isNextOfKin: st.reverseIsNextOfKin,
          copyCorrespondence: st.reverseCopyCorrespondence,
          notes: null,
        });
        await window.ContactsApi.linkPatient(st.apiBase, reverseBody);
        if (st !== s) return;
        // Best-effort only — never blocks completion of the main conversion above.
        st.reverseManualMatch = await findReverseManualMatch(st.selectedCandidate.patientId);
        if (st !== s) return;
      }

      await window.ContactsApi.deletePatientContactRelationship(st.apiBase, st.selectedManualContact.patientContactId);
      if (st !== s) return;

      const notes = [];
      if (st.existingForwardLink) notes.push('the forward link already existed, so no new link was created');
      if (st.existingReciprocal) notes.push('their existing reverse link back to this patient was left untouched');
      st.doneSummary = notes.length
        ? `Removed the stale manual contact (${notes.join('; ')}).`
        : `Linked to ${st.selectedCandidate.displayName} and removed the old manual contact.`;
      st.step = 'done';
    } catch (err) {
      st.step = 'confirm';
      st.workingError = err.message || 'Failed to complete the link — nothing further was changed.';
    } finally {
      if (st === s) rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────────────────────

  function bindEvents(el) {
    const toggle = el.querySelector('#ms-ct-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (s.open) {
          s = blankState();
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

    el.querySelectorAll('.ms-ct-pick-btn').forEach((btn) => {
      btn.addEventListener('click', () => pickManualContact(btn.getAttribute('data-contact-id')));
    });

    let searchTimer = null;
    el.querySelector('#ms-ct-search')?.addEventListener('input', (e) => {
      s.searchQuery = e.target.value;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 300);
    });

    el.querySelectorAll('.ms-ct-result-row').forEach((row) => {
      row.addEventListener('click', () => pickCandidate(row.getAttribute('data-patient-id')));
    });

    el.querySelector('#ms-ct-base')?.addEventListener('change', (e) => {
      s.baseId = e.target.value;
      s.modifierId = null; // a new base may not support the previously-chosen modifier
      recomputeReverse();
      rerender();
    });

    el.querySelectorAll('input[name="ms-ct-mod"]').forEach((r) => {
      r.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        s.modifierId = e.target.value || null;
        recomputeReverse();
        rerender();
      });
    });

    el.querySelector('#ms-ct-reverse-base')?.addEventListener('change', (e) => {
      s.reverseBaseId = e.target.value || null;
    });

    el.querySelector('#ms-ct-fwd-nok')?.addEventListener('change', (e) => {
      s.forwardIsNextOfKin = e.target.checked;
    });
    el.querySelector('#ms-ct-fwd-copy')?.addEventListener('change', (e) => {
      s.forwardCopyCorrespondence = e.target.checked;
    });
    el.querySelector('#ms-ct-rev-nok')?.addEventListener('change', (e) => {
      s.reverseIsNextOfKin = e.target.checked;
    });
    el.querySelector('#ms-ct-rev-copy')?.addEventListener('change', (e) => {
      s.reverseCopyCorrespondence = e.target.checked;
    });
    el.querySelector('#ms-ct-notes')?.addEventListener('input', (e) => {
      s.notes = e.target.value;
    });

    el.querySelector('#ms-ct-confirm')?.addEventListener('click', () => doConfirm());
    el.querySelector('#ms-ct-again')?.addEventListener('click', () => {
      s = blankState();
      doOpen();
    });

    el.querySelector('#ms-ct-reload')?.addEventListener('click', () => location.reload());

    el.querySelector('#ms-ct-remove-reverse-manual')?.addEventListener('click', async (e) => {
      const match = s.reverseManualMatch;
      if (!match) return;
      e.target.disabled = true;
      try {
        await window.ContactsApi.deletePatientContactRelationship(s.apiBase, match.patientContactId);
        s.reverseManualMatch = null;
        s.reverseManualMatchError = null;
        rerender();
      } catch (err) {
        s.reverseManualMatchError =
          err.message || 'Failed to remove that manual contact — try again or remove it in Medicus directly.';
        rerender();
      }
    });
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────────────────────
  // Identical discipline to content-scripts/task-inline.js.

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
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-contacts-widget')) {
        continue;
      }
      for (const nodes of [m.addedNodes, m.removedNodes]) {
        for (const n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-contacts-widget') continue;
          if (n.closest && n.closest('#ms-contacts-widget')) continue;
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
    const pathChanged = location.pathname !== _lastPath;
    if (!pathChanged) {
      const existing = document.getElementById('ms-contacts-widget');
      if (existing && existing.isConnected) return;
    }
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    const currentPath = location.pathname;
    if (currentPath !== _lastPath) {
      _lastPath = currentPath;
      s = blankState();
      removeWidget();
    }
    if (document.hidden) return;
    const existing = document.getElementById('ms-contacts-widget');
    if (existing && existing.isConnected) return;
    requestAnimationFrame(() => {
      if (document.hidden) return;
      const w = document.getElementById('ms-contacts-widget');
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInject);
  } else {
    scheduleInject();
  }
})();
