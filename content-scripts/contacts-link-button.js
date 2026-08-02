// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Contacts linking: "import from another patient" widget
//
// Originally Phase 1's single-contact manual→linked conversion flow (pick a manual contact,
// search, confirm) plus Phase 2's bulk import from another patient's record, injected onto the
// patient admin-record page next to the manual-contacts card. The single-contact flow was
// retired 2026-07-28 once the family-tree canvas (content-scripts/contacts-canvas.js) had fully
// superseded it — the canvas does the same job and more (drag-and-drop, transitive pool,
// disambiguation, phone/email management) — see the build plan's status addendum and CHANGELOG
// v3.189.0 for the decision record. What's left here is the bulk-import flow specifically,
// because it does something the canvas genuinely can't: search ANY other patient (not just ones
// already reciprocally connected via "Listed as Contact For") and bulk-select several of their
// contacts to import in one action. This widget's own header toggle ("Manage this patient's
// contacts") is the canvas's sole entry point (window.ContactsCanvas.open() — the canvas has no
// injected button of its own) — the import flow rendered by THIS file is only ever reached from
// inside the canvas, via its "Import from another patient" header link
// (window.ContactsWidget.openImport), never by the toggle directly.
//
// Structural template: content-scripts/task-inline.js (state object replaced wholesale on SPA
// navigation, dom-observer-hub subscription, own-mutation filtering, wrong-patient guard
// immediately before every write). Business logic (API calls, relationship vocabulary, matching)
// comes from window.ContactsApi / window.ContactRelationships.
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
      step: 'import-search', // 'import-search' | 'import-pick' | 'import-working' | 'import-done'

      importSearchQuery: '',
      importSearchResults: [], // raw patient-finder results — no fuzzy scoring needed, this is picking a KNOWN patient
      importSourcePatient: null,
      importEligibleContacts: [], // [{ patientContactId, patientId, name, baseId, modifierId, isNextOfKin, copyCorrespondence, selected }]
      importIneligibleCount: 0, // source's own manual-only entries, filtered out (bulk-copying them would just create another manual duplicate)
      importAlreadyLinkedCount: 0, // entries the index patient already has a real link to, filtered out
      importWorkingError: null,
      importDoneSummary: null,
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
      } else if (s.step === 'import-search') {
        body = renderImportSearch();
      } else if (s.step === 'import-pick') {
        body = renderImportPick();
      } else if (s.step === 'import-working') {
        body = `<div class="ms-ct-body"><div class="ms-ct-loading">Importing contacts…</div></div>`;
      } else if (s.step === 'import-done') {
        body = renderImportDone();
      }
    }
    return `
      <div class="ms-ct-header" id="ms-ct-toggle" role="button" tabindex="0" aria-expanded="${s.open}">
        <span class="ms-ct-chevron">${s.open ? '▾' : '▸'}</span>
        <span>Manage this patient's contacts</span>
      </div>
      ${body}
    `;
  }

  function renderImportSearch() {
    const results = s.importSearchResults
      .map(
        (r) => `
        <div class="ms-ct-row ms-ct-import-result-row" data-import-patient-id="${esc(r.patientId)}" data-import-patient-name="${esc(r.displayName)}">
          <div>
            <div class="ms-ct-pick-name">${esc(r.displayName)}</div>
            <div class="ms-ct-pick-rel">${esc(r.dateOfBirth || '')}</div>
          </div>
        </div>`
      )
      .join('');
    // "Listed as Contact For" — patients who already list THIS patient as their own contact.
    // Already fetched in doOpen() as part of indexPatientDetails, so these are free, likely-family
    // shortcuts to start an import from, rather than making the user type a name they might not
    // even know is already connected.
    const reciprocalEntries =
      (s.indexPatientDetails.patientLinkedContactsSection &&
        s.indexPatientDetails.patientLinkedContactsSection.patientContacts) ||
      [];
    const quickPicks = reciprocalEntries
      .map(
        (c) => `
        <div class="ms-ct-row ms-ct-import-result-row" data-import-patient-id="${esc(c.linkedPatientId)}" data-import-patient-name="${esc(c.linkedPatientContactName)}">
          <div>
            <div class="ms-ct-pick-name">${esc(c.linkedPatientContactName)}</div>
            <div class="ms-ct-pick-rel">Lists this patient as their "${esc(c.patientContactRelationship)}"</div>
          </div>
        </div>`
      )
      .join('');
    return `
      <div class="ms-ct-body">
        <button class="ms-ct-btn-ghost" id="ms-ct-import-back">Close</button>
        ${
          quickPicks
            ? `<div class="ms-ct-row"><span class="ms-ct-label">Already listed as a contact for</span></div>${quickPicks}`
            : ''
        }
        <div class="ms-ct-row">
          <label class="ms-ct-label" for="ms-ct-import-search">Or search for another patient</label>
          <input class="ms-ct-input" id="ms-ct-import-search" type="text" value="${esc(s.importSearchQuery)}" placeholder="Patient name" />
        </div>
        ${results || (s.importSearchQuery.trim() ? '<div class="ms-ct-empty">No matches yet — refine the search.</div>' : '')}
      </div>
    `;
  }

  function renderImportPick() {
    const rel = window.ContactRelationships;
    const allRelIds = Object.keys(rel.ALIAS_TERMS).concat(['other']);
    const notes = [];
    if (s.importIneligibleCount) {
      notes.push(
        `${s.importIneligibleCount} of ${s.importSourcePatient.displayName}'s own contact${s.importIneligibleCount === 1 ? '' : 's'} ${s.importIneligibleCount === 1 ? 'is' : 'are'} still manual (not yet linked to a real Medicus patient) and can't be safely bulk-imported this way — convert ${s.importIneligibleCount === 1 ? 'it' : 'them'} on their own record first if needed.`
      );
    }
    if (s.importAlreadyLinkedCount) {
      notes.push(
        `${s.importAlreadyLinkedCount} already linked to this patient and ${s.importAlreadyLinkedCount === 1 ? 'was' : 'were'} left out to avoid a duplicate.`
      );
    }
    if (!s.importEligibleContacts.length) {
      return `<div class="ms-ct-body">
        <button class="ms-ct-btn-ghost" id="ms-ct-import-back">Close</button>
        <div class="ms-ct-empty">Nothing eligible to import from ${esc(s.importSourcePatient.displayName)}'s record.${notes.length ? ' ' + esc(notes.join(' ')) : ''}</div>
      </div>`;
    }
    const rows = s.importEligibleContacts
      .map((c) => {
        const validMods = rel.validModifiersForBase(c.baseId);
        const baseSelect = allRelIds
          .map((id) => {
            const r = rel.getRelationship(id);
            if (!r) return '';
            return `<option value="${esc(id)}"${c.baseId === id ? ' selected' : ''}>${esc(r.label)}</option>`;
          })
          .join('');
        const modRadios = validMods.length
          ? `<span class="ms-ct-import-mods" data-import-contact-id="${esc(c.patientContactId)}">
              <label><input type="radio" name="ms-ct-import-mod-${esc(c.patientContactId)}" value="" ${!c.modifierId ? 'checked' : ''}/> None</label>
              ${validMods
                .map(
                  (m) =>
                    `<label><input type="radio" name="ms-ct-import-mod-${esc(c.patientContactId)}" value="${esc(m)}" ${c.modifierId === m ? 'checked' : ''}/> ${esc(rel.getModifiers().find((mm) => mm.id === m).label)}</label>`
                )
                .join(' ')}
            </span>`
          : '';
        return `
        <div class="ms-ct-row ms-ct-import-row">
          <label><input type="checkbox" class="ms-ct-import-select" data-import-contact-id="${esc(c.patientContactId)}" ${c.selected ? 'checked' : ''}/> <strong>${esc(c.name)}</strong> <span class="ms-ct-note">(recorded as "${esc(c.sourceRelationship)}" on their record)</span></label>
          <select class="ms-ct-select ms-ct-import-base" data-import-contact-id="${esc(c.patientContactId)}">${baseSelect}</select>
          ${modRadios}
          <label><input type="checkbox" class="ms-ct-import-nok" data-import-contact-id="${esc(c.patientContactId)}" ${c.isNextOfKin ? 'checked' : ''}/> Next of kin</label>
          <label><input type="checkbox" class="ms-ct-import-copy" data-import-contact-id="${esc(c.patientContactId)}" ${c.copyCorrespondence ? 'checked' : ''}/> Copy correspondence</label>
        </div>`;
      })
      .join('');
    return `
      <div class="ms-ct-body">
        <button class="ms-ct-btn-ghost" id="ms-ct-import-back">Close</button>
        <div class="ms-ct-row"><span class="ms-ct-label">Importing from</span><strong>${esc(s.importSourcePatient.displayName)}</strong></div>
        ${notes.length ? `<div class="ms-ct-note">${esc(notes.join(' '))}</div>` : ''}
        ${rows}
        ${s.importWorkingError ? `<div class="ms-ct-error">${esc(s.importWorkingError)}</div>` : ''}
        <button class="ms-ct-btn" id="ms-ct-import-confirm">Import selected contacts</button>
      </div>
    `;
  }

  function renderImportDone() {
    return `
      <div class="ms-ct-body ms-ct-success">
        <div class="ms-ct-success-icon">✓</div>
        <div>${esc(s.importDoneSummary || 'Contacts imported.')}</div>
        <div class="ms-ct-note">Medicus's own contacts card won't show this change until the page is refreshed.</div>
        <button class="ms-ct-btn" id="ms-ct-reload">Refresh now</button>
        <button class="ms-ct-btn-ghost" id="ms-ct-import-again">Import more from another patient</button>
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
    const st = s; // WRONG-PATIENT GUARD pin — see doImportConfirm() for the hard re-verify before writes
    try {
      // Safety net for contacts-api.js's fire-and-forget fetch of rules/contact-relationships.json
      // — normally already resolved by the time a user opens the widget, but await it explicitly
      // in case a very fast click beat the fetch.
      await window.ContactsApi.ensureRelationshipsData();
      if (st !== s) return;
      const details = await window.ContactsApi.getPatientDetails(st.apiBase, st.patientId);
      if (st !== s) return;
      st.indexPatientDetails = details;
      st.step = 'import-search';
      st.importSearchQuery = '';
      st.importSearchResults = [];
      st.importSourcePatient = null;
      st.importEligibleContacts = [];
    } catch (err) {
      st.error = err.message || 'Failed to load this patient’s contacts.';
    } finally {
      st.loading = false;
      if (st === s) rerender();
    }
  }

  function closeWidget() {
    s = blankState();
    rerender();
  }

  async function runImportSearch() {
    const query = s.importSearchQuery.trim();
    if (query.length < 2) {
      s.importSearchResults = [];
      rerender();
      return;
    }
    try {
      s.importSearchResults = await window.ContactsApi.searchPatients(s.apiBase, query);
    } catch (err) {
      s.error = err.message || 'Search failed.';
    }
    rerender();
  }

  // pickImportSource({patientId, displayName}) — fetches the source patient's own full contact
  // list twice over: lookup-patient-contacts (Medicus's own "add contacts from another patient"
  // listing) and patient-details (which, unlike the lookup response, carries
  // patientContactPatientId per entry — the only way to tell a REAL link apart from a still-manual
  // one on their side). Confirmed live behaviour: bulk-copying a still-manual source entry via
  // link-contacts does NOT create a real link, just another manual duplicate — so entries without
  // a real patientContactPatientId are filtered out here rather than offered.
  // Accepts a plain {patientId, displayName} object directly (rather than looking one up by id in
  // s.importSearchResults) so it works equally for a typed search result AND a "Listed as Contact
  // For" quick-pick, which isn't sourced from patient-finder at all.
  //
  // CROSS-REFERENCE NOTE (confirmed live): lookup-patient-contacts' patientContactId is NOT the
  // same identifier as patientContactsSection's patientContactId for the same relationship —
  // they're distinct UUIDs (same creation-time prefix, since Medicus mints both around the same
  // moment, but genuinely different values). There is no shared id to join on. Matching by name +
  // relationship text is what actually lines up between the two responses, so that's the join key
  // used below — good enough given both fields are always present, but a source patient with two
  // contacts sharing an identical name AND relationship text (rare) could cross-reference the
  // wrong one. The lookup response's OWN patientContactId is still exactly what gets sent back to
  // Medicus in the link-contacts POST body — only the cross-reference below needed to change.
  async function pickImportSource(source) {
    if (!source || !source.patientId) return;
    s.importSourcePatient = source;
    s.loading = true;
    rerender();
    try {
      const [lookup, sourceDetails] = await Promise.all([
        window.ContactsApi.lookupPatientContacts(s.apiBase, s.patientId, source.patientId),
        window.ContactsApi.getPatientDetails(s.apiBase, source.patientId),
      ]);
      const sourceContacts =
        (sourceDetails.patientContactsSection && sourceDetails.patientContactsSection.patientContacts) || [];
      const alreadyLinkedIds = new Set(
        (
          (s.indexPatientDetails.patientContactsSection &&
            s.indexPatientDetails.patientContactsSection.patientContacts) ||
          []
        )
          .map((c) => c.patientContactPatientId)
          .filter(Boolean)
      );
      let ineligible = 0;
      let alreadyLinked = 0;
      const eligible = [];
      for (const entry of lookup.lookupPatientRelationships || []) {
        const sourceEntry = sourceContacts.find(
          (c) =>
            c.patientContactName === entry.patientContactName &&
            c.patientContactRelationship === entry.patientContactRelationship
        );
        const realPatientId = sourceEntry && sourceEntry.patientContactPatientId;
        if (!realPatientId) {
          ineligible++;
          continue;
        }
        if (alreadyLinkedIds.has(realPatientId)) {
          alreadyLinked++;
          continue;
        }
        const guess = window.ContactRelationships.normaliseFreeText(entry.patientContactRelationship);
        eligible.push({
          patientContactId: entry.patientContactId,
          patientId: realPatientId,
          name: entry.patientContactName,
          sourceRelationship: entry.patientContactRelationship,
          baseId: (guess && guess.baseId) || 'other',
          modifierId: (guess && guess.modifierId) || null,
          isNextOfKin: false,
          copyCorrespondence: false,
          selected: false,
        });
      }
      s.importEligibleContacts = eligible;
      s.importIneligibleCount = ineligible;
      s.importAlreadyLinkedCount = alreadyLinked;
      s.step = 'import-pick';
    } catch (err) {
      s.error = err.message || 'Failed to load contacts from that patient’s record.';
    } finally {
      s.loading = false;
      rerender();
    }
  }

  function updateImportRow(contactId, patch) {
    const row = s.importEligibleContacts.find((c) => c.patientContactId === contactId);
    if (!row) return;
    Object.assign(row, patch);
  }

  async function doImportConfirm() {
    const selected = s.importEligibleContacts.filter((c) => c.selected);
    if (s.step !== 'import-pick' || !selected.length) return;
    s.step = 'import-working';
    s.importWorkingError = null;
    rerender();
    // WRONG-PATIENT GUARD: re-verify immediately before the write.
    const st = s;
    try {
      const ctx = window.ContactsApi.resolveContext();
      if (!ctx || ctx.patientId !== st.patientId) {
        throw new Error('The page has moved to a different patient — reopen the panel and try again.');
      }
      const body = {
        patientId: st.patientId,
        patientContactRelationships: selected.map((c) => ({
          patientContactId: c.patientContactId,
          relationship: window.ContactRelationships.formatLabel(c.baseId, c.modifierId),
          nextOfKin: c.isNextOfKin,
          copyCorrespondence: c.copyCorrespondence,
          notes: '',
        })),
      };
      await window.ContactsApi.linkContactsBulk(st.apiBase, body);
      if (st !== s) return;
      st.importDoneSummary = `Imported ${selected.length} contact${selected.length === 1 ? '' : 's'} from ${st.importSourcePatient.displayName}'s record.`;
      st.step = 'import-done';
      // Refresh the cached index-patient details in the background so a subsequent "import more"
      // in this same widget session has an up-to-date already-linked list to de-dup against —
      // best-effort, never blocks the done screen from showing.
      window.ContactsApi.getPatientDetails(st.apiBase, st.patientId).then(
        (details) => {
          if (st === s) st.indexPatientDetails = details;
        },
        () => {}
      );
    } catch (err) {
      st.step = 'import-pick';
      st.importWorkingError = err.message || 'Failed to import the selected contacts — nothing was changed.';
    } finally {
      if (st === s) rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────────────────────

  function bindEvents(el) {
    const toggle = el.querySelector('#ms-ct-toggle');
    if (toggle) {
      // The canvas (content-scripts/contacts-canvas.js) is the main tool and has no entry point of
      // its own — this toggle IS that entry point (see this file's header comment). It used to
      // instead call doOpen() directly, opening this widget's own import-search view in place —
      // lost the canvas entirely as a reachable destination once the convert-flow retirement's
      // full-file rewrite pointed it at the wrong target. This widget's own inline body is now only
      // ever opened FROM the canvas (window.ContactsWidget.openImport, its "Import from another
      // patient" header link) — the toggle here always opens the canvas, never itself.
      toggle.addEventListener('click', () => window.ContactsCanvas.open());
      toggle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }

    el.querySelector('#ms-ct-reload')?.addEventListener('click', () => location.reload());

    // "Close" (was "← Back" — retired the screen it used to go back to, see file header) closes
    // the widget entirely rather than navigating to a step that no longer exists.
    el.querySelector('#ms-ct-import-back')?.addEventListener('click', () => closeWidget());

    let importSearchTimer = null;
    el.querySelector('#ms-ct-import-search')?.addEventListener('input', (e) => {
      s.importSearchQuery = e.target.value;
      if (importSearchTimer) clearTimeout(importSearchTimer);
      importSearchTimer = setTimeout(runImportSearch, 300);
    });

    el.querySelectorAll('.ms-ct-import-result-row').forEach((row) => {
      row.addEventListener('click', () =>
        pickImportSource({
          patientId: row.getAttribute('data-import-patient-id'),
          displayName: row.getAttribute('data-import-patient-name'),
        })
      );
    });

    el.querySelectorAll('.ms-ct-import-select').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        updateImportRow(cb.getAttribute('data-import-contact-id'), { selected: e.target.checked });
      });
    });
    el.querySelectorAll('.ms-ct-import-base').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        updateImportRow(sel.getAttribute('data-import-contact-id'), { baseId: e.target.value, modifierId: null });
        rerender();
      });
    });
    el.querySelectorAll('.ms-ct-import-mods input[type="radio"]').forEach((r) => {
      r.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        updateImportRow(r.closest('.ms-ct-import-mods').getAttribute('data-import-contact-id'), {
          modifierId: e.target.value || null,
        });
      });
    });
    el.querySelectorAll('.ms-ct-import-nok').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        updateImportRow(cb.getAttribute('data-import-contact-id'), { isNextOfKin: e.target.checked });
      });
    });
    el.querySelectorAll('.ms-ct-import-copy').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        updateImportRow(cb.getAttribute('data-import-contact-id'), { copyCorrespondence: e.target.checked });
      });
    });

    el.querySelector('#ms-ct-import-confirm')?.addEventListener('click', () => doImportConfirm());
    el.querySelector('#ms-ct-import-again')?.addEventListener('click', () => doOpen());
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

  // Called from contacts-canvas.js's own "Import from another patient" link, so this flow's
  // arbitrary-patient search/bulk-select stays reachable even though the header opens the canvas
  // directly rather than this widget. Opens this widget in place at its own position on the page,
  // exactly as if the user had expanded it via the header themselves — the canvas is expected to
  // close itself first.
  window.ContactsWidget = { openImport: () => doOpen() };

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
