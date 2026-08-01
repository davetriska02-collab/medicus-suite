// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk remove?" widget for junk allergy codes.
//
// Two DIFFERENT reasons an allergy code ends up in rules/allergy-junk-codes.json
// (see that file's own `category` field and notes for the full rationale
// per code) — confirmed live 2026-07-29, real patients + user's own
// clinical experience:
//   - `import-artefact` codes are NEVER a genuine allergy under any
//     circumstances — pure GP2GP/import noise:
//       - 716186003 "No known allergies" — a redundant marker for the
//         ABSENCE of allergies; the allergy list already shows the correct
//         empty state on its own. Seen duplicated FIVE times on one real
//         patient.
//       - 161611007 "H/O: non-drug allergy" — a historic "were they asked
//         about allergies" marker from a locally-commissioned service,
//         never meant to represent a genuine allergy, but erroneously
//         pulled into the allergy list.
//   - `too-generic` codes CAN occasionally carry a real allergy, just coded
//     uselessly vaguely — 115665000 "Atopy" and 419076005 "Allergic
//     reaction" (real motivating case: a patient's genuine peanut allergy
//     found coded under "Allergic reaction" with the actual allergen only
//     in free-text additionalInformation, "peanut"). These are only safe to
//     flag here at all because of the caution mechanism below — see
//     buildCautionMessage's own comment.
// This widget finds every ACTIVE allergy whose own SNOMED code EXACTLY
// MATCHES one of these, and offers a one-click "end allergy" bulk action —
// same pattern as content-scripts/problem-junk-code-cleanup.js's "Bulk
// remove?" for problems, adapted to the allergy domain.
//
// EXACT MATCH ONLY, NOT A DESCENDANT/HIERARCHY SEARCH (deliberately simpler
// than problem-junk-code-cleanup.js's approach): both confirmed junk codes
// are single, self-contained SNOMED concepts, not broad admin-code
// categories with many real children — there's no equivalent here to
// 14734007 "Administrative procedure"'s 103 direct children that made a
// constrainingParentConcepts descendant search worthwhile for problems. See
// rules/allergy-junk-codes.json's own notes for the full reasoning.
//
// CONFIRMED CONTRACT (live HAR captures, 2026-07-29, real test patient —
// creating an allergy by substance, by pre-defined code, converting between
// the two, and ending one with an end date + reason):
//
//   GET  /clinical/data/clinical-summary/summary/{patientId}
//        → { allergies: [{ id, allergyCodeDescription, isDraft }] } — same
//        cheap list pattern as problems[] — text only, no conceptId, and
//        ACTIVE allergies only (confirmed live: an ended allergy disappears
//        from this array entirely, no extra filtering needed on our side).
//   GET  /clinical/data/allergy/overview-allergy/{allergyId}
//        → { allergyCode: {conceptId, description, descriptionId,
//          originalCodes} | null, substance: {conceptId, description,
//          descriptionId} | null, allergyCodeType, isEnded, status,
//          isDraft, … } — the cheapest confirmed way to get an allergy's
//          own conceptId. Exactly one of allergyCode/substance is populated,
//          depending on allergyCodeType ("pre-defined-allergies" vs
//          "substances") — both confirmed junk codes are always the
//          pre-defined-allergies type, so allergyCode.conceptId is what
//          matters here, but resolveAllergyConceptId below checks both
//          defensively rather than assuming which field is populated.
//   GET  /clinical/data/allergy/end-allergy/{allergyId}
//        → { allergyId, patientId } — the end-allergy form prefill, minimal,
//        no defaults for endDate/reasonEnded.
//   POST /clinical/allergy/end-allergy
//        body: { allergyId, endDate, reasonEnded } → 200 {}
//        — deliberately NOT /end-allergy/{id} in the URL, the id lives in
//        the body instead. CRITICALLY, confirmed live: this payload has NO
//        recordedByOrganisation field at all — unlike change-allergy (the
//        convert-to-substance sibling feature, not yet built), ending an
//        allergy is NEVER blocked by the blank-organisation validation lock
//        some GP2GP-imported records carry (recordedAtAnotherOrganisation:
//        true but recordedByOrganisation: null). That lock only matters for
//        the convert path, not this bulk-remove one.
//
// SCOPE DECISION (mirrors problem-junk-code-cleanup.js's own, same
// reasoning): the scan (one overview-allergy fetch per ACTIVE allergy, to
// get its conceptId) runs ONLY when the clinician clicks "Bulk remove?" —
// never proactively on page load. The cheap clinical-summary fetch (text
// only, no conceptId) still happens on page load, only to place the trigger
// button — no per-allergy cost until the explicit click.
//
// Checkboxes default UNCHECKED (same discipline as problem-junk-code-cleanup.js)
// — ending an allergy is a real, consequential clinical-record action, so
// nothing is ever pre-ticked even though both confirmed codes are
// unambiguous junk with no "caution" exceptions like the admin-root-codes
// list has. A "Select all" convenience exists regardless.
//
// DOM PLACEMENT — row markup confirmed live (`a.item__link`, same shared
// list-item convention already proven for Problems), but a REAL BUG was
// found live 2026-07-29 from an unscoped row search: a patient's Minor
// Problems list happened to contain entries worded identically to real
// allergy entries ("Peanut allergy", "Arachis oil allergy" as PROBLEM
// text), and since Problems renders ABOVE Allergies on Clinical Summary, a
// document-wide search matched the wrong section's row first — the trigger
// button ended up floating above the Problems list instead of Allergies.
// Fixed via findAllergiesSectionRoot (below): every row search is now
// scoped to the Allergies card's own DOM subtree (found by locating the
// "Allergies" section heading and walking up to the smallest ancestor that
// also contains an item row), and FAILS CLOSED — no injection at all —
// when that section can't be confidently found, rather than risking an
// unscoped, potentially-wrong match again.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  // Matched by EXACT conceptId only — see header comment for why no
  // descendant/hierarchy search is needed here, unlike
  // problem-junk-code-cleanup.js's admin-root-code matching.
  function findJunkCodeEntry(conceptId, junkCodes) {
    if (!conceptId) return null;
    return (
      (Array.isArray(junkCodes) ? junkCodes : []).find(function (c) {
        return c && c.conceptId === conceptId;
      }) || null
    );
  }

  // Exactly one of allergyCode/substance is populated on a real overview-allergy
  // response, depending on allergyCodeType — checked defensively rather than
  // assuming which one, since both confirmed junk codes happen to be the
  // pre-defined-allergies type but a future entry might not be.
  function resolveAllergyConceptId(overview) {
    if (!overview) return null;
    var code = overview.allergyCode && overview.allergyCode.conceptId;
    if (code) return code;
    var substance = overview.substance && overview.substance.conceptId;
    return substance || null;
  }

  function buildEndAllergyPayload(allergyId, endDate, reasonEnded) {
    return { allergyId: allergyId, endDate: endDate, reasonEnded: reasonEnded || null };
  }

  // A flagged entry is safe to bulk-end when it hasn't already been ended
  // this session AND isn't cautioned (see buildCautionMessage below) — unlike
  // problem-junk-code-cleanup.js's isEndable, there's no "activeChildCount"
  // analogue for allergies (no linked-child-problem concept here), so this
  // is otherwise simpler.
  function isEndable(entry) {
    return !!entry && !entry.ended;
  }

  // CAUTION SIGNAL (2026-07-29, explicit user request): both confirmed junk
  // codes are structurally meaningless to carry clinical detail against —
  // "No known allergies" with a recorded severity/certainty is nonsensical
  // on its face — so if additionalInformation, severity, OR certainty IS
  // populated on a flagged entry, that's a strong sign a clinician actually
  // used this generic/junk code to record a REAL allergy (a "genuine
  // allergy recorded using a crap code", not import noise), and it must
  // never be silently bulk-ended alongside the genuine no-op entries. Unlike
  // problem-junk-code-cleanup.js's caution mechanism (a property of the
  // ROOT/CODE itself, configured in rules/non-problem-root-codes.json), this
  // is a property of the INSTANCE — the same junk code can be safely
  // cautioned on one patient's entry and not on another's, so it's computed
  // per-entry from data already fetched (overview-allergy), not from the
  // rules file. Returns null (no caution) when all three fields are
  // genuinely blank, or a human-readable message naming which field(s)
  // triggered it — never a bare boolean, so the clinician sees WHY before
  // reviewing.
  // allergyReactions is an array of {conceptId, description, descriptionId}
  // on a real overview-allergy response (confirmed live: populated e.g.
  // [{description: "Anaphylaxis", …}] on a genuine allergy, and the empty
  // array [] on the real "No known allergies" junk capture) — pulled out as
  // its own helper since both buildCautionMessage and the row display need
  // the same "list of reaction description strings" derived from it.
  function reactionDescriptions(overview) {
    var reactions = overview && overview.allergyReactions;
    if (!Array.isArray(reactions)) return [];
    return reactions
      .map(function (r) {
        return r && r.description;
      })
      .filter(Boolean);
  }

  function buildCautionMessage(overview) {
    if (!overview) return null;
    var parts = [];
    if (overview.severity) parts.push('severity: ' + overview.severity);
    if (overview.certainty) parts.push('certainty: ' + overview.certainty);
    if (overview.additionalInformation && String(overview.additionalInformation).trim()) {
      parts.push('additional info recorded');
    }
    var reactions = reactionDescriptions(overview);
    // A CODED REACTION is the strongest of the four signals — 2026-07-29,
    // explicit user request ("more information better, and the absence of a
    // coded reaction is probably a helpful signal"): a genuine allergy is
    // far more likely to carry a recorded reaction than a coincidentally-set
    // severity/certainty default, so this is worth naming explicitly (with
    // the actual reaction(s), not just "reaction recorded") rather than
    // folding into a generic "clinical detail" phrase. Conversely, an EMPTY
    // reactions array contributes nothing here (by design, not an omission)
    // — that's exactly the reinforcing "this really does look like junk"
    // signal the user described; it's expressed by this function returning
    // null when nothing at all is populated, not by a separate branch.
    if (reactions.length) parts.push('reaction: ' + reactions.join(', '));
    if (!parts.length) return null;
    return (
      'This entry has clinical detail recorded (' +
      parts.join(', ') +
      ') — may be a genuine allergy filed under this code, not import noise. Review before removing.'
    );
  }

  // Narrows clinical-summary/summary's `allergies[]` down to just
  // {id, description} for allergies worth checking — excludes isDraft
  // entries defensively (never observed true in any live capture so far,
  // but a draft isn't yet a finalised clinical entry and shouldn't be
  // bulk-ended sight-unseen; same "fail toward inert, not toward acting on
  // an unconfirmed state" discipline as elsewhere in this codebase).
  function activeNonDraftAllergies(allergies) {
    return (Array.isArray(allergies) ? allergies : []).filter(function (a) {
      return a && a.id && !a.isDraft;
    });
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      findJunkCodeEntry: findJunkCodeEntry,
      resolveAllergyConceptId: resolveAllergyConceptId,
      buildEndAllergyPayload: buildEndAllergyPayload,
      isEndable: isEndable,
      activeNonDraftAllergies: activeNonDraftAllergies,
      reactionDescriptions: reactionDescriptions,
      buildCautionMessage: buildCautionMessage,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msAllergyJunkCleanup) return;
  window.__msAllergyJunkCleanup = true;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  // ── URL detection — identical to every other content script in this family ───
  var RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;

  function getPatientInfo() {
    var m = location.pathname.match(RECORD_URL_RE);
    if (!m) return null;
    return { siteId: m[1], patientId: m[2] };
  }

  // ── API ───────────────────────────────────────────────────────────────────────

  function apiBaseUrl() {
    var info = getPatientInfo();
    var parts = location.pathname.split('/').filter(Boolean);
    var siteId = (info && info.siteId) || parts[0] || '';
    return 'https://' + siteId + '.api.' + location.hostname;
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    var resp = await fetch(apiBaseUrl() + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
      body: opts.body,
    });
    if (!resp.ok) {
      var errorBody = await resp.text().catch(function () {
        return '';
      });
      throw new Error('API ' + resp.status + (errorBody ? ': ' + errorBody.slice(0, 300) : ''));
    }
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Allergy API returned an unexpected response.');
    }
  }

  function fetchClinicalSummaryAllergies(patientId) {
    return apiFetch('/clinical/data/clinical-summary/summary/' + encodeURIComponent(patientId)).then(function (data) {
      return (data && data.allergies) || [];
    });
  }

  function fetchAllergyOverview(allergyId) {
    return apiFetch('/clinical/data/allergy/overview-allergy/' + encodeURIComponent(allergyId));
  }

  function postEndAllergy(payload) {
    return apiFetch('/clinical/allergy/end-allergy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // Loads rules/allergy-junk-codes.json ONCE per page load — a local
  // extension resource, not a Medicus call. Falls back to an empty list
  // (never throws) if the resource is unavailable — the widget then simply
  // never flags anything rather than erroring, same "fail open to inert,
  // not to a crash" discipline as problem-junk-code-cleanup.js's own
  // ensureNonProblemRootsLoaded.
  var _junkCodesPromise = null;
  function ensureAllergyJunkCodesLoaded() {
    if (_junkCodesPromise) return _junkCodesPromise;
    _junkCodesPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/allergy-junk-codes.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.codes) ? doc.codes : [];
      } catch (e) {
        return [];
      }
    })();
    return _junkCodesPromise;
  }

  // ── DOM: scoping to the Allergies card specifically ───────────────────────
  // REAL BUG, found live 2026-07-29 (user screenshot): document-wide row
  // matching found the WRONG row — a patient's Minor Problems list happened
  // to contain entries coincidentally worded identically to real allergy
  // entries ("Peanut allergy", "Arachis oil allergy" as PROBLEM text), and
  // since Problems renders ABOVE Allergies on Clinical Summary, an unscoped
  // document-wide search matched the Problem row first. Every row search in
  // this file must now be scoped to the Allergies card's own DOM subtree,
  // never the whole document. Recomputed fresh on every call (never cached)
  // since Vue's re-renders can replace/move the card's own root element —
  // cheap query, no reason to risk a stale reference.
  //
  // Finds the smallest ancestor of the "Allergies" section heading that
  // ALSO contains at least one item row — i.e. the card's own content
  // boundary, not just the heading's immediate wrapper. Capped at 6 levels
  // so a failed match can never silently widen to the whole page. Returns
  // null (fail closed — no injection at all, see injectTrigger below)
  // rather than falling back to an unscoped, potentially-wrong search.
  function findAllergiesSectionRoot() {
    var headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"]');
    for (var i = 0; i < headings.length; i++) {
      var el = headings[i];
      if ((el.textContent || '').trim() !== 'Allergies') continue;
      var node = el.parentElement;
      for (var depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        if (node.querySelector('a.item__link, a[class*="item__link"]')) return node;
      }
    }
    return null;
  }

  // Mirrors problem rows' own duplicate-anchor discipline (claimedAnchors)
  // in case two allergies ever share identical description text (e.g. two
  // of the same junk code before this tool ever gets a chance to remove
  // them). `scopeEl` is REQUIRED in practice (callers always pass the
  // resolved Allergies section root) — accepting it as a parameter rather
  // than querying document internally keeps this function a pure DOM
  // search, testable in isolation from findAllergiesSectionRoot.
  function findAllergyRow(description, claimedAnchors, scopeEl) {
    var root = scopeEl || document;
    var links = root.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (claimedAnchors && claimedAnchors.has(a)) continue;
      if ((a.textContent || '').trim() === description) return a;
    }
    return null;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var _lastPatientId = null;
  var _allergiesCache = null; // allergies[] for _lastPatientId, refetched on patient change
  var _open = false;
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
  var _flagged = []; // [{ id, description, conceptId, reasonEnded, anchorEl, checked, ended, endError }]
  var _endDate = todayISO();
  var _ending = false;

  function resetForPatient() {
    _allergiesCache = null;
    _open = false;
    _scanState = 'idle';
    _scanError = null;
    _flagged = [];
    _endDate = todayISO();
    _ending = false;
  }

  // ── Scan (opt-in — only ever runs from the "Bulk remove?" click, see the
  // header comment's SCOPE DECISION) ──────────────────────────────────────────
  async function runScan() {
    _scanState = 'scanning';
    _scanError = null;
    render();
    try {
      var junkCodes = await ensureAllergyJunkCodesLoaded();
      if (!junkCodes.length)
        throw new Error('No allergy junk-code rules are configured (rules/allergy-junk-codes.json).');
      var candidates = activeNonDraftAllergies(_allergiesCache);
      var overviews = await Promise.all(
        candidates.map(function (a) {
          return fetchAllergyOverview(a.id).catch(function () {
            return null;
          });
        })
      );
      var scopeEl = findAllergiesSectionRoot();
      var claimedAnchors = new Set();
      var flagged = [];
      candidates.forEach(function (a, i) {
        var overview = overviews[i];
        var conceptId = resolveAllergyConceptId(overview);
        var junkEntry = findJunkCodeEntry(conceptId, junkCodes);
        if (!junkEntry) return;
        var anchorEl = findAllergyRow(a.allergyCodeDescription, claimedAnchors, scopeEl);
        if (anchorEl) claimedAnchors.add(anchorEl);
        flagged.push({
          id: a.id,
          description: a.allergyCodeDescription,
          conceptId: conceptId,
          reasonEnded: junkEntry.reasonEnded || null,
          additionalInformation: (overview && overview.additionalInformation) || null,
          severity: (overview && overview.severity) || null,
          certainty: (overview && overview.certainty) || null,
          reactions: reactionDescriptions(overview),
          caution: buildCautionMessage(overview),
          anchorEl: anchorEl,
          checked: false,
          ended: false,
          endError: null,
        });
      });
      _flagged = flagged;
      _scanState = 'done';
    } catch (err) {
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to scan the allergy list.';
    } finally {
      render();
    }
  }

  async function endSelected() {
    var targets = _flagged.filter(function (f) {
      return f.checked && isEndable(f);
    });
    // No end date -> no POST, ever. The button is disabled without one, but
    // a cleared date field must not slip an `endDate: ""` through to the
    // record — same discipline as problem-junk-code-cleanup.js's own guard.
    if (!targets.length || _ending || !_endDate) return;
    _ending = true;
    render();
    var results = await Promise.allSettled(
      targets.map(function (f) {
        return postEndAllergy(buildEndAllergyPayload(f.id, _endDate, f.reasonEnded));
      })
    );
    var allSucceeded = true;
    results.forEach(function (r, i) {
      var f = targets[i];
      if (r.status === 'fulfilled') {
        f.ended = true;
        f.checked = false;
        f.endError = null;
        if (f.anchorEl) f.anchorEl.classList.add('ms-ajc-anchor-ended');
      } else {
        allSucceeded = false;
        f.endError = (r.reason && r.reason.message) || 'Failed to end this allergy — please try again.';
      }
    });
    _ending = false;
    render();
    // Same discipline as problem-junk-code-cleanup.js: Medicus's own
    // allergy-list UI doesn't reflect an ended allergy until the page is
    // refreshed — assumed by analogy, NOT yet independently confirmed live
    // for allergies specifically. Auto-reload ONLY when every targeted end
    // succeeded, after a brief pause so the "Ended" tags are actually
    // visible first — a failed end must stay on screen with its error
    // message so the clinician can see and retry it.
    if (allSucceeded && targets.length) {
      setTimeout(function () {
        location.reload();
      }, 900);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Compact "Severity: X · Certainty: Y · Additional info: Z" line, only the
  // fields actually populated — expected to be empty/absent for the common
  // genuine-junk case (both confirmed codes: severity/certainty/
  // additionalInformation all null), so this renders nothing extra for most
  // rows. When it DOES render, that's precisely the signal buildCautionMessage
  // above is warning about — shown together so the clinician can judge
  // without leaving this panel.
  function clinicalDetailHtml(f) {
    var parts = [];
    if (f.severity) parts.push('Severity: ' + esc(f.severity));
    if (f.certainty) parts.push('Certainty: ' + esc(f.certainty));
    if (f.additionalInformation) parts.push('Additional info: ' + esc(f.additionalInformation));
    if (f.reactions && f.reactions.length) parts.push('Reaction: ' + esc(f.reactions.join(', ')));
    if (!parts.length) return '';
    return '<span class="ms-ajc-row-detail">' + parts.join(' · ') + '</span>';
  }

  function renderChecklist() {
    var selectedCount = _flagged.filter(function (f) {
      return f.checked && isEndable(f);
    }).length;
    var rows = _flagged
      .map(function (f) {
        if (f.ended) {
          return (
            '<label class="ms-ajc-row ms-ajc-row-ended"><input type="checkbox" checked disabled>' +
            '<span class="ms-ajc-row-desc">' +
            esc(f.description) +
            '</span><span class="ms-ajc-row-tag">Ended</span></label>'
          );
        }
        return (
          '<label class="ms-ajc-row' +
          (f.caution ? ' ms-ajc-row-caution' : '') +
          '">' +
          '<input type="checkbox" class="ms-ajc-checkbox" data-allergy-id="' +
          esc(f.id) +
          '"' +
          (f.checked ? ' checked' : '') +
          '>' +
          '<span class="ms-ajc-row-desc">' +
          esc(f.description) +
          '</span>' +
          (f.reasonEnded ? '<span class="ms-ajc-row-reason">' + esc(f.reasonEnded) + '</span>' : '') +
          clinicalDetailHtml(f) +
          (f.caution ? '<span class="ms-ajc-row-warn">⚠ ' + esc(f.caution) + '</span>' : '') +
          (f.endError ? '<span class="ms-ajc-row-error">' + esc(f.endError) + '</span>' : '') +
          '</label>'
        );
      })
      .join('');
    return (
      '<div class="ms-ajc-body">' +
      '<div class="ms-ajc-summary">Found ' +
      _flagged.length +
      ' allergy entr' +
      (_flagged.length === 1 ? 'y' : 'ies') +
      ' matching known import-artefact codes — usually import noise, but not always: rows ' +
      'marked ⚠ have severity/certainty/additional info recorded and may be a genuine allergy ' +
      'filed under this code, so they need reviewing individually. Nothing is ticked by ' +
      'default, and "Select all" skips ⚠ rows.</div>' +
      '<div class="ms-ajc-select-row">' +
      '<button type="button" class="ms-ajc-select-all" id="ms-ajc-select-all">Select all</button>' +
      '<button type="button" class="ms-ajc-select-none" id="ms-ajc-select-none">Select none</button>' +
      '</div>' +
      '<div class="ms-ajc-list">' +
      rows +
      '</div>' +
      '<div class="ms-ajc-end-row">' +
      '<label class="ms-ajc-label" for="ms-ajc-end-date">End date</label>' +
      '<input type="date" class="ms-ajc-date-input" id="ms-ajc-end-date" value="' +
      esc(_endDate) +
      '">' +
      '</div>' +
      '<button type="button" class="ms-ajc-end-btn" id="ms-ajc-end-selected"' +
      (selectedCount === 0 || _ending || !_endDate ? ' disabled' : '') +
      '>' +
      (_ending ? 'Ending…' : 'End ' + selectedCount + ' selected allerg' + (selectedCount === 1 ? 'y' : 'ies')) +
      '</button>' +
      '</div>'
    );
  }

  function buildHtml() {
    var header =
      '<button type="button" class="ms-ajc-toggle" id="ms-ajc-toggle" aria-expanded="' +
      _open +
      '">' +
      (_open ? '▾' : '▸') +
      ' Bulk remove?</button>';
    if (!_open) return header;
    var body;
    if (_scanState === 'scanning') {
      body = '<div class="ms-ajc-body"><span class="ms-ajc-loading">Scanning allergies…</span></div>';
    } else if (_scanState === 'error') {
      body =
        '<div class="ms-ajc-body"><span class="ms-ajc-error">' +
        esc(_scanError) +
        '</span> <button type="button" class="ms-ajc-retry" id="ms-ajc-retry">Retry</button></div>';
    } else if (_scanState === 'done' && _flagged.length === 0) {
      body =
        '<div class="ms-ajc-body"><span class="ms-ajc-empty">No known import-artefact codes found in ' +
        'the allergy list.</span></div>';
    } else if (_scanState === 'done') {
      body = renderChecklist();
    } else {
      body = '';
    }
    return header + body;
  }

  function bindEvents(el) {
    el.querySelector('#ms-ajc-toggle').addEventListener('click', function () {
      if (_open) {
        _open = false;
        render();
        return;
      }
      _open = true;
      if (_scanState === 'idle') {
        runScan();
      } else {
        render();
      }
    });
    el.querySelector('#ms-ajc-retry')?.addEventListener('click', function () {
      runScan();
    });
    el.querySelectorAll('.ms-ajc-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-allergy-id');
        var f = _flagged.find(function (x) {
          return x.id === id;
        });
        if (f) f.checked = cb.checked;
        render();
      });
    });
    el.querySelector('#ms-ajc-select-all')?.addEventListener('click', function () {
      _flagged.forEach(function (f) {
        // Cautioned rows are never swept up by "Select all" — see
        // buildCautionMessage's own comment. Must be reviewed and ticked
        // individually.
        if (isEndable(f) && !f.caution) f.checked = true;
      });
      render();
    });
    el.querySelector('#ms-ajc-select-none')?.addEventListener('click', function () {
      _flagged.forEach(function (f) {
        f.checked = false;
      });
      render();
    });
    el.querySelector('#ms-ajc-end-date')?.addEventListener('input', function (e) {
      _endDate = e.target.value;
    });
    el.querySelector('#ms-ajc-end-selected')?.addEventListener('click', function () {
      endSelected();
    });
  }

  function render() {
    var el = document.getElementById('ms-ajc-widget');
    if (!el) return;
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  // ── Injection: one "Bulk remove?" trigger next to the allergy list ───────────
  // Placement is now SCOPED (2026-07-29 fix, see findAllergiesSectionRoot's
  // own comment) — every row lookup happens within the Allergies card only.
  // FAILS CLOSED: if the Allergies section root can't be confidently found
  // at all, this simply doesn't inject anything rather than falling back to
  // an unscoped document-wide search that could land the button in the
  // wrong section again.

  function findFirstAllergyRow(allergies, scopeEl) {
    for (var i = 0; i < allergies.length; i++) {
      var row = findAllergyRow(allergies[i].allergyCodeDescription, null, scopeEl);
      if (row) return row;
    }
    return null;
  }

  function injectTrigger() {
    if (document.getElementById('ms-ajc-widget')) return;
    if (!_allergiesCache || !_allergiesCache.length) return;
    var scopeEl = findAllergiesSectionRoot();
    if (!scopeEl) return;
    var row = findFirstAllergyRow(_allergiesCache, scopeEl);
    if (!row) return;
    var list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-ajc-widget';
    w.innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Scan (cheap summary fetch) + re-injection ─────────────────────────────────
  // Same discipline as problem-junk-code-cleanup.js: re-check on every
  // mutation tick since Vue re-renders strip foreign nodes, throttled,
  // own-mutation-filtered. Only the cheap clinical-summary fetch (text only,
  // no conceptId) runs here — the expensive per-allergy scan is opt-in, see
  // runScan() above.
  var _fetchInFlight = false;

  async function ensureAllergiesLoaded() {
    var info = getPatientInfo();
    if (!info) return;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForPatient();
    }
    if (!_allergiesCache && !_fetchInFlight) {
      _fetchInFlight = true;
      try {
        _allergiesCache = await fetchClinicalSummaryAllergies(info.patientId);
      } catch (_) {
        _allergiesCache = [];
      } finally {
        _fetchInFlight = false;
      }
    }
    if (_allergiesCache) injectTrigger();
  }

  var _throttle = null;
  function scheduleScan() {
    if (_throttle) return;
    _throttle = setTimeout(function () {
      _throttle = null;
      if (!document.hidden) ensureAllergiesLoaded();
    }, 400);
  }

  function _isOwnMutation(mutations) {
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-ajc-widget')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-ajc-widget') continue;
          if (n.closest && n.closest('#ms-ajc-widget')) continue;
          return false;
        }
      }
    }
    return true;
  }

  var _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      scheduleScan();
    });
  } else {
    var _obs = new MutationObserver(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      scheduleScan();
    });
    _obs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleScan();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleScan);
  } else {
    scheduleScan();
  }
})();
