// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Contacts linking: three-column drag-and-drop canvas (Phase 3)
//
// A richer, all-at-once alternative to contacts-link-button.js's one-contact-at-a-time wizard:
// shows the index patient's manual contacts (column 1), their already-linked contacts plus
// name/address-ranked suggestions (column 2), and other patients registered at the same address
// (column 3), colour-coded by a normalised category of the relationship text so visually-related
// cards are easy to spot. Dragging a manual card onto a Medicus card pairs them (drag-to-merge);
// dragging any card onto the "link" drop zone opens the same confirm form the wizard uses
// (drag-to-assign) and fires the same shared write path.
//
// Business logic (API calls, relationship vocabulary, matching, and — critically — the
// wrong-patient guard and duplicate-link detection) all comes from window.ContactsApi /
// window.ContactRelationships / window.ContactMatch, exactly as contacts-link-button.js uses them
// — this file owns rendering and drag interaction only, not a second copy of anything
// safety-critical.
//
// Opened via window.ContactsCanvas.open(), called from a button in contacts-link-button.js.
'use strict';

(function () {
  if (window.ContactsCanvas) return; // re-entry guard

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Colour coding ─────────────────────────────────────────────────────────────────────────────
  // One colour per relationship tier, applied to a manual contact's own card, any Medicus
  // candidate suggested BECAUSE of that manual contact, and any already-linked contact whose own
  // recorded relationship normalises into the same tier — the visual pairing hint described in
  // the product design (colour-match a manual card to its likely Medicus counterpart).

  const TIER_COLOURS = {
    partner: '#f59e0b',
    'parent-child': '#2563eb',
    sibling: '#16a34a',
    'grandparent-grandchild': '#7c3aed',
    extended: '#0891b2',
    'in-law': '#db2777',
    care: '#64748b',
    other: '#94a3b8',
  };
  const NEEDS_REVIEW_COLOUR = '#cbd5e1';

  function colourForRelationshipText(text) {
    const CR = window.ContactRelationships;
    const guess = CR.normaliseFreeText(text);
    if (!guess) return NEEDS_REVIEW_COLOUR;
    const rel = CR.getRelationship(guess.baseId);
    return (rel && TIER_COLOURS[rel.tier]) || NEEDS_REVIEW_COLOUR;
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────

  let cs = null; // null when the canvas is closed

  function blankCanvasState() {
    return {
      apiBase: null,
      patientId: null,
      indexPatientDetails: null,
      loading: true,
      error: null,

      manualCards: [], // [{ id, name, relationshipText, colour, mergedWith: null|medicusCardId, mergedNotes: '' }]
      linkedCards: [], // [{ id, name, relationshipText, colour }] — locked, not draggable
      suggestedCards: [], // [{ id, name, dateOfBirth, genderIdentity, atSameAddress, score, tier, colour, forManualId }]
      addressCards: [], // [{ id, name }]

      pendingMerge: null, // { manualId, medicusId, manualDetail, medicusPreview, keepNotes, keepManualPhone } while the compare panel is open
      mergeLoading: false,
      mergeError: null,

      dropZoneCardId: null, // id of whichever card is currently staged for linking
      dropZoneCardKind: null, // 'manual' | 'medicus' — which array dropZoneCardId is drawn from
      confirm: null, // built when a card lands in the drop zone — same shape as the wizard's confirm fields
      workingError: null,
      doneSummary: null,
      reverseManualMatch: null, // a likely-matching manual contact found on the candidate's OWN record, offered for removal
      reverseManualMatchError: null,
    };
  }

  // ── Data loading ──────────────────────────────────────────────────────────────────────────────

  function candidateAgeFromDob(dateOfBirth) {
    if (!dateOfBirth) return null;
    const d = new Date(dateOfBirth);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (365.25 * 86400000));
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

  async function loadCanvas() {
    const ctx = window.ContactsApi.resolveContext();
    if (!ctx) {
      cs.error = 'Could not identify the current patient — try reloading the page.';
      cs.loading = false;
      render();
      return;
    }
    cs.apiBase = ctx.apiBase;
    cs.patientId = ctx.patientId;
    const st = cs;
    try {
      await window.ContactsApi.ensureRelationshipsData();
      if (st !== cs) return;
      const details = await window.ContactsApi.getPatientDetails(st.apiBase, st.patientId);
      if (st !== cs) return;
      st.indexPatientDetails = details;

      const allContacts = (details.patientContactsSection && details.patientContactsSection.patientContacts) || [];
      st.manualCards = allContacts
        .filter((c) => !c.patientContactPatientId)
        .map((c) => ({
          id: c.patientContactId,
          name: c.patientContactName,
          relationshipText: c.patientContactRelationship,
          colour: colourForRelationshipText(c.patientContactRelationship),
          mergedWith: null,
        }));
      st.linkedCards = allContacts
        .filter((c) => c.patientContactPatientId)
        .map((c) => ({
          id: c.patientContactPatientId,
          name: c.patientContactName,
          relationshipText: c.patientContactRelationship,
          colour: colourForRelationshipText(c.patientContactRelationship),
          isLinked: true, // distinguishes an already-linked card from a suggestedCards entry when the two share a row-cell array
        }));

      const alreadyKnownIds = new Set(st.linkedCards.map((c) => c.id));
      const indexAddress =
        details.patientAddressSection &&
        details.patientAddressSection.patientAddresses[0] &&
        details.patientAddressSection.patientAddresses[0].address;
      const indexAge = candidateAgeFromDob(details.patientDetailsSection && details.patientDetailsSection.dateOfBirth);

      // One patient-finder search per manual contact, run in parallel, ranked against THAT
      // specific manual contact and tagged with which one suggested it (drives the colour match).
      const searchResults = await Promise.all(
        st.manualCards.map((mc) =>
          window.ContactsApi.searchPatients(st.apiBase, mc.name)
            .then((results) => ({ mc, results }))
            .catch(() => ({ mc, results: [] }))
        )
      );
      if (st !== cs) return;

      const bestByPatientId = new Map();
      for (const { mc, results } of searchResults) {
        const candidates = results.map((r) => ({
          patientId: r.patientId,
          displayName: r.displayName,
          dateOfBirth: r.dateOfBirth,
          age: candidateAgeFromDob(r.dateOfBirth),
          genderIdentity: r.genderIdentity,
          atSameAddress: sameAddress(indexAddress, r.address),
        }));
        const ranked = window.ContactMatch.rankCandidates(
          { name: mc.name },
          candidates.filter((c) => !alreadyKnownIds.has(c.patientId)),
          {
            manualRelationshipGuess: window.ContactRelationships.normaliseFreeText(mc.relationshipText),
            indexPatientAge: indexAge,
          }
        ).slice(0, 3);
        for (const r of ranked) {
          const existing = bestByPatientId.get(r.candidate.patientId);
          if (!existing || r.score > existing.score) {
            bestByPatientId.set(r.candidate.patientId, {
              id: r.candidate.patientId,
              name: r.candidate.displayName,
              dateOfBirth: r.candidate.dateOfBirth,
              genderIdentity: r.candidate.genderIdentity,
              atSameAddress: r.candidate.atSameAddress,
              score: r.score,
              tier: r.tier,
              colour: mc.colour,
              forManualId: mc.id,
            });
          }
        }
      }
      st.suggestedCards = Array.from(bestByPatientId.values()).sort((a, b) => b.score - a.score);

      // Column 3: also registered at the index patient's own home address, minus anyone already
      // surfaced in column 2. Minimal shape ({id, displayName} only) — no scoring signals
      // available from this endpoint, so no ranking here, just a plain list.
      const addressId =
        details.patientAddressSection &&
        details.patientAddressSection.patientAddresses[0] &&
        details.patientAddressSection.patientAddresses[0].addressId;
      if (addressId) {
        try {
          const overview = await window.ContactsApi.getAddressOverview(st.apiBase, addressId);
          if (st !== cs) return;
          const suggestedIds = new Set(st.suggestedCards.map((c) => c.id));
          st.addressCards = (overview.alsoAtThisAddress || [])
            .filter((p) => !alreadyKnownIds.has(p.id) && !suggestedIds.has(p.id))
            .map((p) => ({ id: p.id, name: p.displayName }));
        } catch (_) {
          st.addressCards = []; // best-effort only — the rest of the canvas still works
        }
      }

      st.loading = false;
    } catch (err) {
      st.error = err.message || 'Failed to load this patient’s contacts.';
      st.loading = false;
    } finally {
      if (st === cs) render();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────────────────────

  function cardHtml(card, kind, opts) {
    opts = opts || {};
    // locked: true forces non-draggable regardless of the `draggable` opt — used for a manual
    // card once it's been merged, so the ONLY way to finish is dragging its (outlined) Medicus
    // counterpart to the drop zone, never the faded manual card itself a second time.
    const draggable = !opts.locked && opts.draggable !== false;
    const badge = opts.badge ? `<span class="ms-cv-badge">${esc(opts.badge)}</span>` : '';
    const sub = opts.sub ? `<div class="ms-cv-card-sub">${esc(opts.sub)}</div>` : '';
    const stateClass = opts.faded ? ' ms-cv-card-faded' : opts.outlined ? ' ms-cv-card-outlined' : '';
    return `
      <div class="ms-cv-card${stateClass}" ${draggable ? `draggable="true" data-card-id="${esc(card.id)}" data-card-kind="${esc(kind)}"` : ''}
           style="border-left-color:${esc(card.colour || NEEDS_REVIEW_COLOUR)}">
        <div class="ms-cv-card-name">${esc(card.name)}${badge}</div>
        ${sub}
      </div>`;
  }

  // buildAlignedRows() -> [{ manual: card|null, medicusCards: card[] }]
  // One row per already-linked contact (no manual counterpart — medicus-only row), THEN one row
  // per manual contact showing ONLY the candidates that manual contact's OWN search produced
  // (via each candidate's forManualId), never the globally-highest-scoring candidate regardless of
  // source. This is what keeps two same-named manual contacts (e.g. two "John Smith" entries for
  // two different real people) each aligned with THEIR OWN best match instead of both matches
  // landing wherever they happen to sort in one flat, unrelated list.
  function buildAlignedRows() {
    const rows = cs.linkedCards.map((c) => ({ manual: null, medicusCards: [c] }));
    for (const manual of cs.manualCards) {
      const matches = cs.suggestedCards.filter((c) => c.forManualId === manual.id);
      rows.push({ manual, medicusCards: matches });
    }
    return rows;
  }

  function renderColumns() {
    // Mirrors duplicate-checker.js's markGroupFates treatment: the "spoken for" side (here, a
    // manual card once paired) fades, its counterpart (the Medicus card it's paired with) gets an
    // outline — a single, consistent visual cue for "already merged, not yet linked" pending state.
    const mergedMedicusIds = new Set(cs.manualCards.filter((c) => c.mergedWith).map((c) => c.mergedWith));
    const rows = buildAlignedRows();

    // Grid rows are 1-indexed and row 1 is reserved for the two column titles (placed first, with
    // no explicit grid-row/grid-column, so they auto-flow into row 1 col 1 / col 2) — data starts
    // at grid-row 2. Explicit grid-row on every cell (rather than relying on source order/height)
    // is what actually GUARANTEES row N in the manual column lines up with row N in the Medicus
    // column, regardless of how many candidate cards or how much sub-text either cell holds.
    const manualCellsHtml = rows
      .map((row, i) => {
        const inner = row.manual
          ? cardHtml(row.manual, 'manual', {
              sub: row.manual.relationshipText || 'No relationship recorded',
              badge: row.manual.mergedWith ? ' · merged' : '',
              faded: !!row.manual.mergedWith,
              locked: !!row.manual.mergedWith,
            })
          : '';
        return `<div class="ms-cv-grid-cell" style="grid-row:${i + 2};grid-column:1">${inner}</div>`;
      })
      .join('');

    const medicusCellsHtml = rows
      .map((row, i) => {
        const inner = row.medicusCards
          .map((c) =>
            c.isLinked
              ? cardHtml(c, 'linked', { draggable: false, sub: c.relationshipText, badge: ' · linked' })
              : cardHtml(c, 'medicus', {
                  sub: `${c.tier} · ${c.score}${c.atSameAddress ? ' · same address' : ''}`,
                  outlined: mergedMedicusIds.has(c.id),
                })
          )
          .join('');
        return `<div class="ms-cv-grid-cell" style="grid-row:${i + 2};grid-column:2">${inner || '<div class="ms-cv-empty">No suggestions yet.</div>'}</div>`;
      })
      .join('');

    const alignedGrid = rows.length
      ? `<div class="ms-cv-aligned-pair">
          <div class="ms-cv-column-title">Manual contacts</div>
          <div class="ms-cv-column-title">Medicus contacts</div>
          ${manualCellsHtml}
          ${medicusCellsHtml}
        </div>`
      : '<div class="ms-cv-empty">No manual or Medicus contacts found.</div>';

    const addressHtml = cs.addressCards.length
      ? cs.addressCards.map((c) => cardHtml(c, 'address', { outlined: mergedMedicusIds.has(c.id) })).join('')
      : '<div class="ms-cv-empty">No one else found at this address.</div>';

    return `
      <div class="ms-cv-columns">
        ${alignedGrid}
        <div class="ms-cv-column">
          <div class="ms-cv-column-title">Also at this address</div>
          ${addressHtml}
        </div>
      </div>
    `;
  }

  function findCard(id, kind) {
    if (kind === 'manual') return cs.manualCards.find((c) => c.id === id);
    if (kind === 'medicus')
      return cs.suggestedCards.find((c) => c.id === id) || cs.linkedCards.find((c) => c.id === id);
    if (kind === 'address') return cs.addressCards.find((c) => c.id === id);
    return null;
  }

  function renderDropZone() {
    if (!cs.dropZoneCardId) {
      return `<div class="ms-cv-dropzone" id="ms-cv-dropzone">Drag a contact here to set their relationship</div>`;
    }
    if (cs.doneSummary) {
      return `
        <div class="ms-cv-dropzone ms-cv-dropzone-done">
          <div class="ms-cv-success-icon">✓</div>
          <div>${esc(cs.doneSummary)}</div>
          <div class="ms-ct-note">Medicus's own contacts card won't show this change until the page is refreshed.</div>
          <button class="ms-ct-btn" id="ms-cv-reload">Refresh now</button>
          ${
            cs.reverseManualMatch
              ? `<div class="ms-ct-warn">${esc(cs.confirm && cs.confirm.candidateDisplayName)} also has a manual contact named
                   "${esc(cs.reverseManualMatch.patientContactName)}" that may represent this patient — it was NOT
                   removed automatically since no one has confirmed the match. Remove it too?</div>
                 ${reverseManualMatchComparisonHtml(cs.reverseManualMatch, cs.indexPatientDetails)}
                 <button class="ms-ct-btn-ghost" id="ms-cv-remove-reverse-manual">Remove it</button>`
              : ''
          }
          ${cs.reverseManualMatchError ? `<div class="ms-ct-error">${esc(cs.reverseManualMatchError)}</div>` : ''}
          <button class="ms-ct-btn-ghost" id="ms-cv-drop-clear">Link another</button>
        </div>
      `;
    }
    const card = findCard(cs.dropZoneCardId, cs.dropZoneCardKind);
    if (!card || !cs.confirm) {
      return `<div class="ms-cv-dropzone" id="ms-cv-dropzone">Drag a contact here to set their relationship</div>`;
    }
    const rel = window.ContactRelationships;
    const allRelIds = Object.keys(rel.ALIAS_TERMS).concat(['other']);
    const baseSelect = allRelIds
      .map((id) => {
        const r = rel.getRelationship(id);
        return r
          ? `<option value="${esc(id)}"${cs.confirm.baseId === id ? ' selected' : ''}>${esc(r.label)}</option>`
          : '';
      })
      .join('');
    const validMods = rel.validModifiersForBase(cs.confirm.baseId);
    const modRadios = validMods.length
      ? `<span class="ms-ct-import-mods">
          <label><input type="radio" name="ms-cv-mod" value="" ${!cs.confirm.modifierId ? 'checked' : ''}/> None</label>
          ${validMods
            .map(
              (m) =>
                `<label><input type="radio" name="ms-cv-mod" value="${esc(m)}" ${cs.confirm.modifierId === m ? 'checked' : ''}/> ${esc(rel.getModifiers().find((mm) => mm.id === m).label)}</label>`
            )
            .join(' ')}
        </span>`
      : '';
    const reverseLine = cs.confirm.existingReciprocal
      ? `<div class="ms-ct-warn">${esc(card.name)} already lists this patient as their own contact (recorded as "${esc(cs.confirm.existingReciprocal.patientContactRelationship)}") — no reverse link will be created.</div>`
      : cs.confirm.reverseAmbiguous
        ? `<div class="ms-ct-note">Reverse relationship not auto-suggested (gender not recorded) — leave unset or pick one isn't offered here yet in the canvas; use the wizard for this case.</div>`
        : `<div class="ms-ct-note">On their record this will record: <strong>${esc(rel.formatLabel(cs.confirm.reverseBaseId, cs.confirm.modifierId))}</strong></div>`;

    return `
      <div class="ms-cv-dropzone ms-cv-dropzone-active">
        <div class="ms-cv-card-name">Linking: ${esc(card.name)}</div>
        ${
          cs.confirm.existingForwardLink
            ? `<div class="ms-ct-warn">Already linked (recorded as "${esc(cs.confirm.existingForwardLink.patientContactRelationship)}") — this will just clean up the manual duplicate, if one is merged in.</div>`
            : `<select class="ms-ct-select" id="ms-cv-base">${baseSelect}</select>
               ${modRadios}
               <label><input type="checkbox" id="ms-cv-fwd-nok" ${cs.confirm.forwardIsNextOfKin ? 'checked' : ''}/> Next of kin</label>
               <label><input type="checkbox" id="ms-cv-fwd-copy" ${cs.confirm.forwardCopyCorrespondence ? 'checked' : ''}/> Copy correspondence</label>`
        }
        ${reverseLine}
        ${cs.workingError ? `<div class="ms-ct-error">${esc(cs.workingError)}</div>` : ''}
        <div class="ms-cv-dropzone-actions">
          <button class="ms-ct-btn" id="ms-cv-confirm">Confirm link</button>
          <button class="ms-ct-btn-ghost" id="ms-cv-drop-clear">Cancel</button>
        </div>
      </div>
    `;
  }

  // renderMergePanel() — the drag-to-merge compare step, modelled on duplicate-checker.js's
  // note-compare-merge pattern (side-by-side table, a "kept" column that always wins, differing
  // rows flagged, only genuinely mergeable content gets a choice). Adapted for contacts: the
  // Medicus column ALWAYS wins (it's the live record, never a symmetric "pick either" choice like
  // duplicate-checker's), so the only decisions are whether to carry the manual record's notes
  // and/or a differing phone number forward into the new link's notes field as supplementary text
  // — everything else is read-only evidence that these two cards really are the same person.
  function renderMergePanel() {
    const pm = cs.pendingMerge;
    if (!pm) return '';
    if (cs.mergeLoading) {
      return `<div class="ms-cv-dropzone"><div class="ms-ct-loading">Comparing records…</div></div>`;
    }
    if (cs.mergeError) {
      return `<div class="ms-cv-dropzone"><div class="ms-ct-error">${esc(cs.mergeError)}</div><button class="ms-ct-btn-ghost" id="ms-cv-merge-cancel">Close</button></div>`;
    }
    if (!pm.manualDetail || !pm.medicusPreview) return '';
    const manual = pm.manualDetail;
    const medicus = pm.medicusPreview;
    const medicusPhone = medicus.linkPatientMobilePhoneNumber || medicus.linkPatientHomePhoneNumber;
    const rows = [
      { label: 'Name', manual: manual.patientContactName, medicus: medicus.linkPatientName, differs: false },
      // DOB: manual contacts don't carry one at all — shown purely as corroborating evidence
      // (e.g. an implausible age for the recorded relationship is a reason to cancel, not merge),
      // never a real comparison since there's nothing on the manual side to differ against.
      {
        label: 'Date of birth',
        manual: '(not recorded)',
        medicus: medicus.linkPatientDOB || '(not recorded)',
        differs: false,
      },
    ];
    if (pm.manualPhone || medicusPhone) {
      rows.push({
        label: 'Phone',
        manual: pm.manualPhone || '(none recorded)',
        medicus: medicusPhone || '(none recorded)',
        differs: pm.phonesDiffer,
      });
    }
    if (pm.manualEmail || pm.medicusEmail) {
      rows.push({
        label: 'Email',
        manual: pm.manualEmail || '(none recorded)',
        medicus: pm.medicusEmail || '(none recorded)',
        differs: pm.emailsDiffer,
      });
    }
    const rowsHtml = rows
      .map(
        (r) => `<tr${r.differs ? ' class="ms-cv-merge-row-differs"' : ''}>
          <td class="ms-cv-merge-label">${esc(r.label)}</td>
          <td>${esc(r.manual)}</td>
          <td class="ms-cv-merge-keep-col">${esc(r.medicus)}</td>
        </tr>`
      )
      .join('');
    const notesText = (manual.patientContactRelationshipNotes || '').trim();
    return `
      <div class="ms-cv-dropzone ms-cv-dropzone-active">
        <div class="ms-cv-card-name">Same person? Compare before merging</div>
        <table class="ms-cv-merge-table">
          <thead><tr><th></th><th>Manual record</th><th class="ms-cv-merge-keep-col">✓ Live Medicus record (kept)</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${
          pm.phonesDiffer
            ? `<label><input type="checkbox" id="ms-cv-merge-keep-phone" ${pm.keepManualPhone ? 'checked' : ''}/> Note the manual phone number in the new link's notes too</label>`
            : ''
        }
        ${
          pm.emailsDiffer
            ? `<label><input type="checkbox" id="ms-cv-merge-keep-email" ${pm.keepManualEmail ? 'checked' : ''}/> Note the manual email address in the new link's notes too</label>`
            : ''
        }
        ${
          notesText
            ? `<label><input type="checkbox" id="ms-cv-merge-keep-notes" ${pm.keepNotes ? 'checked' : ''}/> Carry forward the manual record's notes: "${esc(notesText)}"</label>`
            : ''
        }
        <div class="ms-cv-dropzone-actions">
          <button class="ms-ct-btn" id="ms-cv-merge-confirm">Confirm — same person</button>
          <button class="ms-ct-btn-ghost" id="ms-cv-merge-cancel">Cancel</button>
        </div>
      </div>
    `;
  }

  function render() {
    const overlay = document.getElementById('ms-contacts-canvas-overlay');
    if (!overlay) return;
    if (!cs) {
      overlay.remove();
      return;
    }
    overlay.innerHTML = `
      <div class="ms-cv-panel">
        <div class="ms-cv-header">
          <span>Contacts canvas${cs.indexPatientDetails ? ' — ' + esc(cs.indexPatientDetails.displayName || '') : ''}</span>
          <button class="ms-ct-btn-ghost" id="ms-cv-close">Close</button>
        </div>
        ${
          cs.loading
            ? `<div class="ms-cv-loading">Loading…</div>`
            : cs.error
              ? `<div class="ms-ct-error">${esc(cs.error)}</div>`
              : renderColumns() + (cs.pendingMerge ? renderMergePanel() : renderDropZone())
        }
      </div>
    `;
    bindEvents(overlay);
  }

  // ── Merge & assign actions ───────────────────────────────────────────────────────────────────

  function normalisePhoneForCompare(p) {
    return String(p || '').replace(/[^0-9]/g, '');
  }

  // reverseManualMatchComparisonHtml — same purpose/shape as the wizard's copy of this function:
  // a couple of plain evidence lines (not a full interactive table) so the removal decision isn't
  // made on a bare name-similarity score alone.
  function reverseManualMatchComparisonHtml(match, indexPatientDetails) {
    if (!match.detail) return '';
    const CR = window.ContactRelationships;
    const theirPhone =
      (match.detail.patientContactMobileTelephoneNumber && match.detail.patientContactMobileTelephoneNumber.value) ||
      (match.detail.patientContactHomeTelephoneNumber && match.detail.patientContactHomeTelephoneNumber.value) ||
      '(none recorded)';
    const theirEmail =
      (match.detail.patientContactEmailAddress && match.detail.patientContactEmailAddress.value) || '(none recorded)';
    const indexPhone = CR.extractPreferredPhone(indexPatientDetails) || '(none recorded)';
    const indexEmail = CR.extractPreferredEmail(indexPatientDetails) || '(none recorded)';
    return `
      <div class="ms-ct-note">Their manual entry: phone ${esc(theirPhone)}, email ${esc(theirEmail)}</div>
      <div class="ms-ct-note">This patient's own record: phone ${esc(indexPhone)}, email ${esc(indexEmail)}</div>
    `;
  }

  // startMerge — fetches the manual contact's full detail (view-patient-contact, for its
  // phone/email/notes), the Medicus candidate's live preview (link-patient's GET, for phone + DOB),
  // and the candidate's own patient-details (for email, which the preview doesn't carry) in
  // parallel, then opens the compare panel. Nothing is paired until the user explicitly confirms
  // the panel — a failed/slow fetch never silently merges anything.
  async function startMerge(manualId, medicusId) {
    const manual = cs.manualCards.find((c) => c.id === manualId);
    if (!manual) return;
    cs.pendingMerge = {
      manualId,
      medicusId,
      manualDetail: null,
      medicusPreview: null,
      keepNotes: false,
      keepManualPhone: false,
      keepManualEmail: false,
    };
    cs.mergeLoading = true;
    cs.mergeError = null;
    render();
    try {
      const [manualDetail, medicusPreview, medicusDetails] = await Promise.all([
        window.ContactsApi.viewPatientContact(cs.apiBase, manualId),
        window.ContactsApi.previewLinkCandidate(cs.apiBase, cs.patientId, medicusId),
        window.ContactsApi.getPatientDetails(cs.apiBase, medicusId),
      ]);
      if (!cs.pendingMerge || cs.pendingMerge.manualId !== manualId) return; // cancelled or superseded mid-fetch
      const manualPhone =
        (manualDetail.patientContactMobileTelephoneNumber && manualDetail.patientContactMobileTelephoneNumber.value) ||
        (manualDetail.patientContactHomeTelephoneNumber && manualDetail.patientContactHomeTelephoneNumber.value) ||
        null;
      const medicusPhone = medicusPreview.linkPatientMobilePhoneNumber || medicusPreview.linkPatientHomePhoneNumber;
      const manualEmail =
        (manualDetail.patientContactEmailAddress && manualDetail.patientContactEmailAddress.value) || null;
      const medicusEmail = window.ContactRelationships.extractPreferredEmail(medicusDetails);
      cs.pendingMerge.manualDetail = manualDetail;
      cs.pendingMerge.medicusPreview = medicusPreview;
      cs.pendingMerge.manualPhone = manualPhone;
      cs.pendingMerge.manualEmail = manualEmail;
      cs.pendingMerge.medicusEmail = medicusEmail;
      cs.pendingMerge.phonesDiffer = !!(
        manualPhone &&
        medicusPhone &&
        normalisePhoneForCompare(manualPhone) !== normalisePhoneForCompare(medicusPhone)
      );
      cs.pendingMerge.emailsDiffer = !!(
        manualEmail &&
        medicusEmail &&
        manualEmail.trim().toLowerCase() !== medicusEmail.trim().toLowerCase()
      );
      cs.pendingMerge.keepNotes = !!(
        manualDetail.patientContactRelationshipNotes && manualDetail.patientContactRelationshipNotes.trim()
      );
    } catch (err) {
      cs.mergeError = err.message || 'Failed to load comparison details.';
    } finally {
      cs.mergeLoading = false;
      render();
    }
  }

  function confirmMerge() {
    const pm = cs.pendingMerge;
    if (!pm || !pm.manualDetail) return;
    const manual = cs.manualCards.find((c) => c.id === pm.manualId);
    if (!manual) {
      cs.pendingMerge = null;
      render();
      return;
    }
    const notesParts = [];
    if (pm.keepNotes && pm.manualDetail.patientContactRelationshipNotes) {
      notesParts.push(pm.manualDetail.patientContactRelationshipNotes.trim());
    }
    if (pm.keepManualPhone && pm.manualPhone) {
      notesParts.push(`Also reachable on ${pm.manualPhone} (from previous manual contact record)`);
    }
    if (pm.keepManualEmail && pm.manualEmail) {
      notesParts.push(`Also reachable on ${pm.manualEmail} (from previous manual contact record)`);
    }
    manual.mergedWith = pm.medicusId;
    manual.mergedNotes = notesParts.join(' — ');
    cs.pendingMerge = null;
    render();
  }

  function cancelMerge() {
    cs.pendingMerge = null;
    cs.mergeError = null;
    render();
  }

  function tryMerge(sourceId, sourceKind, targetId, targetKind) {
    // Only manual<->medicus pairs can merge (declaring "these are the same person").
    const isManualMedicus =
      (sourceKind === 'manual' && (targetKind === 'medicus' || targetKind === 'address')) ||
      (targetKind === 'manual' && (sourceKind === 'medicus' || sourceKind === 'address'));
    if (!isManualMedicus) return false;
    const manualId = sourceKind === 'manual' ? sourceId : targetId;
    const medicusId = sourceKind === 'manual' ? targetId : sourceId;
    startMerge(manualId, medicusId);
    return true;
  }

  function buildConfirmForCard(card, kind) {
    const CR = window.ContactRelationships;
    let candidatePatientId = card.id;
    let manualContactIdToDelete = null;
    if (kind === 'manual') {
      // A manual-only card dropped directly can't be linked without a real patient — unless it's
      // been merged with a Medicus candidate first.
      if (!card.mergedWith) return null;
      candidatePatientId = card.mergedWith;
      manualContactIdToDelete = card.id;
    } else {
      // A Medicus/address card dropped — if it happens to be the merge target of some manual
      // card, treat that manual card as the one being superseded.
      const pairedManual = cs.manualCards.find((c) => c.mergedWith === card.id);
      if (pairedManual) manualContactIdToDelete = pairedManual.id;
    }
    const existingReciprocal = CR.findExistingReciprocal(cs.indexPatientDetails, candidatePatientId);
    const existingForwardLink = CR.findExistingForwardLink(cs.indexPatientDetails, candidatePatientId);
    const medicusCard =
      cs.suggestedCards.find((c) => c.id === candidatePatientId) ||
      cs.linkedCards.find((c) => c.id === candidatePatientId);
    const manualCard = manualContactIdToDelete ? cs.manualCards.find((c) => c.id === manualContactIdToDelete) : null;
    const guess = manualCard ? CR.normaliseFreeText(manualCard.relationshipText) : null;
    const reciprocalSuggestion = CR.suggestForwardFromReciprocal(
      existingReciprocal,
      medicusCard && medicusCard.genderIdentity
    );
    const baseId = (reciprocalSuggestion && reciprocalSuggestion.baseId) || (guess && guess.baseId) || 'other';
    const modifierId = (reciprocalSuggestion && reciprocalSuggestion.modifierId) || (guess && guess.modifierId) || null;
    let reverseBaseId = null;
    let reverseAmbiguous = false;
    if (!existingReciprocal) {
      const indexGender =
        cs.indexPatientDetails.patientDetailsSection && cs.indexPatientDetails.patientDetailsSection.genderIdentity;
      const inv = CR.invertRelationship({ baseId, modifierId, indexGender });
      reverseAmbiguous = inv.ambiguous;
      reverseBaseId = inv.ambiguous ? null : inv.baseId;
    }
    return {
      candidatePatientId,
      candidateDisplayName: (medicusCard && medicusCard.name) || card.name,
      manualContactIdToDelete,
      notes: (manualCard && manualCard.mergedNotes) || '',
      baseId,
      modifierId,
      forwardIsNextOfKin: false,
      forwardCopyCorrespondence: false,
      reverseBaseId,
      reverseAmbiguous,
      reverseIsNextOfKin: false,
      reverseCopyCorrespondence: false,
      existingReciprocal,
      existingForwardLink,
    };
  }

  function tryAssign(cardId, cardKind) {
    const card = findCard(cardId, cardKind);
    if (!card) return;
    const confirm = buildConfirmForCard(card, cardKind);
    if (!confirm) {
      cs.workingError =
        'A manual-only contact needs to be merged with a Medicus match first — drag it onto a candidate in the other columns.';
      cs.dropZoneCardId = cardId;
      cs.dropZoneCardKind = cardKind;
      cs.confirm = null;
      render();
      return;
    }
    cs.dropZoneCardId = cardId;
    cs.dropZoneCardKind = cardKind;
    cs.confirm = confirm;
    cs.workingError = null;
    render();
  }

  async function doCanvasConfirm() {
    if (!cs.confirm) return;
    const st = cs;
    cs.workingError = null;
    render();
    try {
      const result = await window.ContactsApi.performLinkAndCleanup({
        apiBase: st.apiBase,
        patientId: st.patientId,
        candidatePatientId: st.confirm.candidatePatientId,
        candidateDisplayName: st.confirm.candidateDisplayName,
        indexPatientFullName:
          st.indexPatientDetails.patientDetailsSection && st.indexPatientDetails.patientDetailsSection.fullOfficialName,
        baseId: st.confirm.baseId,
        modifierId: st.confirm.modifierId,
        forwardIsNextOfKin: st.confirm.forwardIsNextOfKin,
        forwardCopyCorrespondence: st.confirm.forwardCopyCorrespondence,
        notes: st.confirm.notes,
        existingForwardLink: st.confirm.existingForwardLink,
        reverseBaseId: st.confirm.reverseBaseId,
        reverseIsNextOfKin: st.confirm.reverseIsNextOfKin,
        reverseCopyCorrespondence: st.confirm.reverseCopyCorrespondence,
        existingReciprocal: st.confirm.existingReciprocal,
        manualContactIdToDelete: st.confirm.manualContactIdToDelete,
      });
      if (st !== cs) return;
      st.doneSummary = result.summary;
      st.reverseManualMatch = result.reverseManualMatch;
      // Remove the linked manual card from column 1 so the canvas reflects the change immediately
      // (Medicus's own page still needs a refresh — same limitation as the wizard).
      if (st.confirm.manualContactIdToDelete) {
        st.manualCards = st.manualCards.filter((c) => c.id !== st.confirm.manualContactIdToDelete);
      }
    } catch (err) {
      st.workingError = err.message || 'Failed to complete the link — nothing further was changed.';
    } finally {
      if (st === cs) render();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────────────────────

  function bindEvents(overlay) {
    overlay.querySelector('#ms-cv-close')?.addEventListener('click', () => close());

    let dragPayload = null;
    overlay.querySelectorAll('.ms-cv-card[draggable="true"]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        dragPayload = { id: el.getAttribute('data-card-id'), kind: el.getAttribute('data-card-kind') };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragover', (e) => {
        if (!dragPayload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!dragPayload) return;
        const targetId = el.getAttribute('data-card-id');
        const targetKind = el.getAttribute('data-card-kind');
        if (dragPayload.id === targetId && dragPayload.kind === targetKind) return;
        tryMerge(dragPayload.id, dragPayload.kind, targetId, targetKind);
        dragPayload = null;
      });
    });

    const zone = overlay.querySelector('#ms-cv-dropzone');
    if (zone) {
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        try {
          const payload = JSON.parse(raw);
          tryAssign(payload.id, payload.kind);
        } catch (_) {
          /* ignore malformed drag payload */
        }
      });
    }

    overlay.querySelector('#ms-cv-base')?.addEventListener('change', (e) => {
      cs.confirm.baseId = e.target.value;
      cs.confirm.modifierId = null;
      const CR = window.ContactRelationships;
      if (!cs.confirm.existingReciprocal) {
        const indexGender =
          cs.indexPatientDetails.patientDetailsSection && cs.indexPatientDetails.patientDetailsSection.genderIdentity;
        const inv = CR.invertRelationship({
          baseId: cs.confirm.baseId,
          modifierId: cs.confirm.modifierId,
          indexGender,
        });
        cs.confirm.reverseAmbiguous = inv.ambiguous;
        cs.confirm.reverseBaseId = inv.ambiguous ? null : inv.baseId;
      }
      render();
    });
    overlay.querySelectorAll('input[name="ms-cv-mod"]').forEach((r) => {
      r.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        cs.confirm.modifierId = e.target.value || null;
        render();
      });
    });
    overlay.querySelector('#ms-cv-fwd-nok')?.addEventListener('change', (e) => {
      cs.confirm.forwardIsNextOfKin = e.target.checked;
    });
    overlay.querySelector('#ms-cv-fwd-copy')?.addEventListener('change', (e) => {
      cs.confirm.forwardCopyCorrespondence = e.target.checked;
    });

    overlay.querySelector('#ms-cv-confirm')?.addEventListener('click', () => doCanvasConfirm());
    overlay.querySelector('#ms-cv-drop-clear')?.addEventListener('click', () => {
      cs.dropZoneCardId = null;
      cs.dropZoneCardKind = null;
      cs.confirm = null;
      cs.doneSummary = null;
      cs.workingError = null;
      cs.reverseManualMatch = null;
      cs.reverseManualMatchError = null;
      render();
    });
    overlay.querySelector('#ms-cv-reload')?.addEventListener('click', () => location.reload());

    overlay.querySelector('#ms-cv-remove-reverse-manual')?.addEventListener('click', async (e) => {
      const match = cs.reverseManualMatch;
      if (!match) return;
      e.target.disabled = true;
      try {
        await window.ContactsApi.deletePatientContactRelationship(cs.apiBase, match.patientContactId);
        cs.reverseManualMatch = null;
        cs.reverseManualMatchError = null;
        render();
      } catch (err) {
        cs.reverseManualMatchError =
          err.message || 'Failed to remove that manual contact — try again or remove it in Medicus directly.';
        render();
      }
    });

    overlay.querySelector('#ms-cv-merge-confirm')?.addEventListener('click', () => confirmMerge());
    overlay.querySelector('#ms-cv-merge-cancel')?.addEventListener('click', () => cancelMerge());
    overlay.querySelector('#ms-cv-merge-keep-phone')?.addEventListener('change', (e) => {
      cs.pendingMerge.keepManualPhone = e.target.checked;
    });
    overlay.querySelector('#ms-cv-merge-keep-email')?.addEventListener('change', (e) => {
      cs.pendingMerge.keepManualEmail = e.target.checked;
    });
    overlay.querySelector('#ms-cv-merge-keep-notes')?.addEventListener('change', (e) => {
      cs.pendingMerge.keepNotes = e.target.checked;
    });
  }

  // ── Open / close ──────────────────────────────────────────────────────────────────────────────

  function open() {
    if (document.getElementById('ms-contacts-canvas-overlay')) return;
    cs = blankCanvasState();
    const overlay = document.createElement('div');
    overlay.id = 'ms-contacts-canvas-overlay';
    document.body.appendChild(overlay);
    render();
    loadCanvas();
  }

  function close() {
    // A merged-but-not-yet-linked pairing lives only in cs, which is discarded on close — warn
    // before losing it, matching duplicate-checker.js's confirm() pattern for a similar
    // "in-progress decision about to be discarded" situation.
    if (cs && cs.manualCards.some((c) => c.mergedWith)) {
      // window.confirm's OK/Cancel buttons carry no inherent meaning of their own — spell out
      // which button does what rather than relying on the reader inferring it from context.
      const proceed = window.confirm(
        "You've merged one or more contacts that haven't been linked yet — nothing has been written to Medicus, so closing now will lose that pairing.\n\n" +
          'Click CANCEL to go back and drag the merged card down to the family tree to finish.\n' +
          'Click OK to close anyway and discard the unfinished merge.'
      );
      if (!proceed) return;
    }
    cs = null;
    const overlay = document.getElementById('ms-contacts-canvas-overlay');
    if (overlay) overlay.remove();
  }

  window.ContactsCanvas = { open, close };
})();
