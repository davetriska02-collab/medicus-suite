// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Fix description" widget for outdated SNOMED problem codes.
//
// Many older problem/diagnosis entries carry a historic Read-code-migration
// display string — a "[X]"/"[D]"/"[M]"-style ICD cross-map prefix, or a
// trailing "NOS" (Not Otherwise Specified) — even though the underlying
// SNOMED concept has a perfectly good modern plain synonym. Medicus's own
// "Edit Problem" UI lets a clinician pick a cleaner description for the SAME
// code (conceptId unchanged). This widget surfaces that as a one-click "Fix
// description" action, instead of the clinician retyping a search manually.
//
// PROBLEMS ARE THE TEST BED, not the only intended entity type — the
// detection heuristic and the "never re-code to a different concept" safety
// filter are entity-agnostic and live in shared/legacy-coded-description.js
// so a later pass covering procedures/referrals/journal entries can reuse
// them directly. What's problem-SPECIFIC (and lives here, not there): the
// actual edit-problem API contract below, and findOutdatedProblems' reliance
// on clinical-summary/summary's `problemCodeDescription` field name.
//
// CONFIRMED CONTRACT (live capture, 2026-07-22, real patient, real edit) —
// see docs/learnings-problem-description-cleanup.md for the full capture:
//
//   GET  /clinical/data/clinical-summary/summary/{patientId}
//        → { problems: [{ id, problemCodeDescription, significance, … }] }
//   GET  /clinical/data/problem/edit-problem/{problemId}
//        → the full edit-form prefill: { problemCode:{value:{conceptId,
//          description,descriptionId}}, existingProblems[], significance,
//          episode, onsetDate, additionalInformation,
//          hiddenFromPatientFacingServices, confidentialFromThirdParties,
//          endDate, reasonEnded, recordDate, recordedAtAnotherOrganisation,
//          recordedByOrganisation, recordedByPractitioner, recordedByStaff, … }
//   GET  /clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=
//        404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=
//        307824009&query={text}
//        → { results: [{ label, value:{description,conceptId,descriptionId} }] }
//        — ONE conceptId genuinely has several description rows (synonyms).
//          THE SAFETY RULE: only ever offer alternatives whose conceptId
//          matches the problem's CURRENT conceptId — never a re-code.
//   POST /clinical/problem/edit-problem/{problemId}
//        body: the FULL prefill object with only `problemCode` swapped (this
//        is a full replace, not a partial patch — every other field must be
//        resent unchanged, confirmed via the real captured request body).
//        → 200 {}
//
// DETECTION: descriptionId === null on the current problemCode is the
// reliable machine signal (confirmed correlated with the bracket/NOS text on
// every example captured so far — see the learnings doc's "what's NOT yet
// confirmed" section for the caveat on sample size). The bracket-prefix/NOS
// text pattern is used for a cheap first-pass scan across
// clinical-summary/summary's plain-text problemCodeDescription list, without
// a per-problem edit-problem fetch.
'use strict';

(function () {
  // ── Shared generic detection/safety-filter (looksOutdated,
  // stripLegacyMarkers, sameConceptAlternatives) ──────────────────────────────
  var shared =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/legacy-coded-description.js')
      : window.MSLegacyCodedDescription;
  var looksOutdated = shared.looksOutdated;

  // ── Pure helpers, problem-specific (no window/document/fetch — unit-
  // testable via require()) ───────────────────────────────────────────────────

  // Builds the full edit-problem POST body from the edit-problem GET
  // prefill, swapping ONLY `problemCode` for the chosen alternative — see the
  // SCOPE comment above: this endpoint is a full replace, not a partial
  // patch, confirmed via a real captured request. Mirrors the confirmed
  // edit-problem-form.vue template exactly: recordedAtAnotherOrganisation
  // decides whether recordedByOrganisation+recordedByPractitioner or
  // recordedByStaff is the field actually sent (read straight from the
  // .vue source captured in docs/learnings-problem-description-cleanup.md,
  // not guessed).
  function buildEditProblemPayload(prefill, newProblemCode) {
    var p = prefill || {};
    var payload = {
      onsetDate: p.onsetDate != null ? p.onsetDate : null,
      contextId: p.contextId != null ? p.contextId : null,
      contextType: p.contextType != null ? p.contextType : null,
      significance: p.significance != null ? p.significance : null,
      episode: p.episode != null ? p.episode : null,
      problemCode: newProblemCode,
      additionalInformation: p.additionalInformation != null ? p.additionalInformation : null,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      endDate: p.endDate != null ? p.endDate : null,
      reasonEnded: p.reasonEnded != null ? p.reasonEnded : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
    };
    if (p.recordedAtAnotherOrganisation) {
      payload.recordedByOrganisation = p.recordedByOrganisation != null ? p.recordedByOrganisation : null;
      payload.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      payload.recordedByStaff = p.recordedByStaff != null ? p.recordedByStaff : null;
    }
    return payload;
  }

  // Narrows clinical-summary/summary's `problems[]` list down to candidates
  // worth offering a fix for — cheap first-pass text scan, no extra API
  // calls. Each entry is `{ id, problemCodeDescription, … }` (confirmed
  // shape). Returns the subset whose problemCodeDescription looks outdated.
  function findOutdatedProblems(problems) {
    if (!Array.isArray(problems)) return [];
    return problems.filter(function (p) {
      return p && looksOutdated(p.problemCodeDescription);
    });
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      // Re-exported from the shared module so existing/expected callers
      // (and this file's own tests) don't need to know about the split.
      looksOutdated: shared.looksOutdated,
      stripLegacyMarkers: shared.stripLegacyMarkers,
      sameConceptAlternatives: shared.sameConceptAlternatives,
      LEGACY_PREFIX_RE: shared.LEGACY_PREFIX_RE,
      LEGACY_SUFFIX_RE: shared.LEGACY_SUFFIX_RE,
      // Problem-specific.
      buildEditProblemPayload,
      findOutdatedProblems,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msProblemDescCleanup) return;
  window.__msProblemDescCleanup = true;

  var stripLegacyMarkers = shared.stripLegacyMarkers;
  var sameConceptAlternatives = shared.sameConceptAlternatives;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── URL detection ─────────────────────────────────────────────────────────────
  // Confirmed live 2026-07-22: .../{siteId}/patient/patient/care-record/{patientId}
  // (?careRecordTab=clinical-summary). The bare .../{siteId}/care-record/{patientId}
  // form is only known BY ANALOGY (content-scripts/triage-lens/content.js's own
  // pageType() treats /care-record/ and /patient/patient/ as equivalent record-page
  // markers, and a window.open() elsewhere in that file constructs exactly this
  // shorter path) — supported here for robustness, not independently captured.
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
    if (!resp.ok) throw new Error('API ' + resp.status);
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Problem API returned an unexpected response.');
    }
  }

  function fetchClinicalSummaryProblems(patientId) {
    return apiFetch('/clinical/data/clinical-summary/summary/' + encodeURIComponent(patientId)).then(function (data) {
      return (data && data.problems) || [];
    });
  }

  function fetchEditProblemForm(problemId) {
    return apiFetch('/clinical/data/problem/edit-problem/' + encodeURIComponent(problemId));
  }

  var SEARCH_PATH =
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&query=';

  function searchDescriptions(queryText) {
    return apiFetch(SEARCH_PATH + encodeURIComponent(queryText)).then(function (data) {
      return (data && data.results) || [];
    });
  }

  function postEditProblem(problemId, payload) {
    return apiFetch('/clinical/problem/edit-problem/' + encodeURIComponent(problemId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── DOM: finding each flagged problem's row ──────────────────────────────────
  // Confirmed live 2026-07-22 (Clinical Summary tab): each problem renders as
  // <li class="item"><a class="item__link …">{description}</a>{date}</li> —
  // matches engine/extractors/problems.js's own `li.item` selector for this
  // exact page. Matched by EXACT trimmed text against the description
  // clinical-summary/summary already gave us — same "match by known string"
  // discipline already proven safe for the attachment-detection work.
  function findProblemRow(description) {
    var links = document.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if ((a.textContent || '').trim() === description) return a;
    }
    return null;
  }

  // ── Per-row widget state ─────────────────────────────────────────────────────
  // Keyed by problemId. Each flagged row gets its own tiny inline
  // open/loading/alternatives/done state — independent of the others, so
  // fixing one problem never disturbs another on the same page.
  var _rows = Object.create(null); // problemId -> { anchorEl, panelEl, state }

  function rowState(problemId) {
    if (!_rows[problemId]) {
      _rows[problemId] = {
        anchorEl: null,
        btnEl: null,
        panelEl: null,
        open: false,
        loading: false,
        error: null,
        conceptId: null,
        currentDescription: null,
        alternatives: null,
        saving: false,
        saved: false,
      };
    }
    return _rows[problemId];
  }

  function panelHtml(problemId) {
    var st = rowState(problemId);
    if (st.loading) {
      return '<div class="ms-pdc-panel"><span class="ms-pdc-loading">Loading alternatives…</span></div>';
    }
    if (st.error) {
      return '<div class="ms-pdc-panel"><span class="ms-pdc-error">' + esc(st.error) + '</span></div>';
    }
    var alts = st.alternatives || [];
    if (!alts.length) {
      return '<div class="ms-pdc-panel"><span class="ms-pdc-empty">No alternative description found for this code.</span></div>';
    }
    return (
      '<div class="ms-pdc-panel">' +
      alts
        .map(function (a) {
          return (
            '<button type="button" class="ms-pdc-alt" data-problem-id="' +
            esc(problemId) +
            '" data-description-id="' +
            esc(a.descriptionId || '') +
            '">' +
            esc(a.description) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderPanel(problemId) {
    var st = rowState(problemId);
    if (!st.anchorEl || !st.anchorEl.parentElement) return;
    if (!st.open) {
      if (st.panelEl) {
        st.panelEl.remove();
        st.panelEl = null;
      }
      return;
    }
    if (!st.panelEl) {
      st.panelEl = document.createElement('div');
      st.panelEl.className = 'ms-pdc-panel-wrap';
      st.anchorEl.parentElement.appendChild(st.panelEl);
    }
    st.panelEl.innerHTML = panelHtml(problemId);
    bindPanelEvents(st.panelEl, problemId);
  }

  function bindPanelEvents(root, problemId) {
    root.querySelectorAll('.ms-pdc-alt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyAlternative(problemId, btn.getAttribute('data-description-id'));
      });
    });
  }

  async function openPanel(problemId) {
    var st = rowState(problemId);
    st.open = true;
    if (st.alternatives || st.saved) {
      renderPanel(problemId);
      return;
    }
    st.loading = true;
    st.error = null;
    renderPanel(problemId);
    try {
      var prefill = await fetchEditProblemForm(problemId);
      var code = prefill && prefill.problemCode && prefill.problemCode.value;
      if (!code || !code.conceptId) throw new Error('Could not read this problem’s code.');
      st.prefill = prefill;
      st.conceptId = code.conceptId;
      st.currentDescription = code.description;
      var queryText = stripLegacyMarkers(code.description);
      var results = await searchDescriptions(queryText);
      st.alternatives = sameConceptAlternatives(results, code.conceptId, code.description);
    } catch (err) {
      st.error = (err && err.message) || 'Failed to load alternative descriptions.';
    } finally {
      st.loading = false;
      renderPanel(problemId);
    }
  }

  function closePanel(problemId) {
    var st = rowState(problemId);
    st.open = false;
    renderPanel(problemId);
  }

  async function applyAlternative(problemId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.alternatives || []).find(function (a) {
      return (a.descriptionId || '') === (descriptionId || '');
    });
    if (!chosen || st.saving) return;
    st.saving = true;
    renderPanel(problemId);
    try {
      var newCode = {
        description: chosen.description,
        conceptId: chosen.conceptId,
        descriptionId: chosen.descriptionId,
      };
      var payload = buildEditProblemPayload(st.prefill, newCode);
      await postEditProblem(problemId, payload);
      st.saved = true;
      // Optimistic in-place update — the save is confirmed correct
      // server-side; this just keeps the on-screen text in sync without
      // depending on Medicus's own Vue re-render (which this content script
      // has no hook into). A later natural page re-render/reload picks up
      // the same corrected value fresh from the server either way.
      if (st.anchorEl) st.anchorEl.textContent = chosen.description;
      // Fixed — remove the "Fix description" button and panel entirely
      // rather than leaving a lingering "Saved" chip; the corrected text
      // itself is the confirmation.
      if (st.btnEl) {
        st.btnEl.remove();
        st.btnEl = null;
      }
      st.open = false;
      if (st.panelEl) {
        st.panelEl.remove();
        st.panelEl = null;
      }
      return;
    } catch (err) {
      st.error = (err && err.message) || 'Failed to save — please try again.';
    } finally {
      st.saving = false;
      renderPanel(problemId);
    }
  }

  // ── Injection: one "Fix description" button per flagged row ─────────────────

  function injectFixButton(problemId, anchorEl) {
    if (
      anchorEl.parentElement &&
      anchorEl.parentElement.querySelector('.ms-pdc-fix-btn[data-problem-id="' + problemId + '"]')
    ) {
      return;
    }
    var st = rowState(problemId);
    st.anchorEl = anchorEl;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-pdc-fix-btn';
    btn.setAttribute('data-problem-id', problemId);
    btn.textContent = 'Fix description';
    st.btnEl = btn;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (st.open) closePanel(problemId);
      else openPanel(problemId);
    });
    anchorEl.insertAdjacentElement('afterend', btn);
    if (st.open) renderPanel(problemId);
  }

  // ── Scan + re-injection ───────────────────────────────────────────────────────
  // Same discipline as the other inline widgets (document-file-inline.js,
  // task-inline.js): re-check on every mutation tick since Vue re-renders
  // strip foreign nodes, throttled, own-mutation-filtered.

  var _lastPatientId = null;
  var _problemsCache = null; // problems[] for _lastPatientId, refetched on patient change
  var _scanInFlight = false;

  async function scan() {
    var info = getPatientInfo();
    if (!info) return;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      _problemsCache = null;
      _rows = Object.create(null);
    }
    if (!_problemsCache && !_scanInFlight) {
      _scanInFlight = true;
      try {
        _problemsCache = await fetchClinicalSummaryProblems(info.patientId);
      } catch (_) {
        _problemsCache = [];
      } finally {
        _scanInFlight = false;
      }
    }
    if (!_problemsCache) return;
    var outdated = findOutdatedProblems(_problemsCache);
    outdated.forEach(function (p) {
      var row = findProblemRow(p.problemCodeDescription);
      if (row) injectFixButton(p.id, row);
    });
  }

  var _throttle = null;
  function scheduleScan() {
    if (_throttle) return;
    _throttle = setTimeout(function () {
      _throttle = null;
      if (!document.hidden) scan();
    }, 400);
  }

  function _isOwnMutation(mutations) {
    for (var m of mutations) {
      if (
        m.target &&
        m.target.nodeType === 1 &&
        m.target.closest &&
        m.target.closest('.ms-pdc-panel-wrap, .ms-pdc-fix-btn')
      ) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList && (n.classList.contains('ms-pdc-panel-wrap') || n.classList.contains('ms-pdc-fix-btn')))
            continue;
          if (n.closest && n.closest('.ms-pdc-panel-wrap, .ms-pdc-fix-btn')) continue;
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
