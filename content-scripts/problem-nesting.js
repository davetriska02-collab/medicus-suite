// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Nest problems?" widget for the Clinical Summary problem list
//
// PURPOSE (user request 2026-08-03): related problems often sit flat next to
// each other ("Insertion of coronary artery stent" beside "Percutaneous
// balloon coronary angioplasty") when Medicus can nest one under the other as
// a child problem. Medicus's own UI does this one slideover at a time with a
// manual picker. This widget scans the active problem list, uses SNOMED
// ancestry BETWEEN the problems already on the record to suggest child→parent
// pairs, and lets the clinician confirm each link individually.
//
// CONFIRMED CONTRACT (live capture 2026-08-03, scripts/problem-nesting-capture.js —
// full write-up in docs/learnings-problem-nesting-api.md):
//
//   GET  /clinical/data/clinical-summary/summary/{patientId}
//        → { problems: [{ id, problemCodeDescription, … }] } — FLAT, no
//        hierarchy fields.
//   GET  /clinical/data/problem/slideover/overview/{problemId}
//        → { problemCode: {conceptId,…}, parentProblemId, parentProblem,
//        childProblems, … } — conceptId AND the existing link graph in one
//        cheap read per problem.
//   POST /clinical/problem/update-parent-problem
//        body: { patientId, problemId, parentProblemId } → 200 {}
//        — exactly three fields, NOT a full-record replace.
//
//   The parent-side sibling (POST /clinical/problem/update-child-problems,
//   childProblemsToAdd) is deliberately NOT used: despite its name its array
//   is a FULL REPLACE of the child set (the captured Vue form seeds it with
//   the existing children), so posting one id to a parent that already has
//   children would silently unlink the others. One child → one parent through
//   update-parent-problem has no such trap.
//
// SUGGESTION MODEL: a pair is suggested only when the candidate child's
// conceptId is a genuine SNOMED descendant of another on-record problem's
// conceptId, via the same confirmed constrained-search mechanism the
// bulk-remove badge scan uses (constrainingParentConcepts + query=conceptId;
// a hit means descendant-of). Identical concepts are never paired (two copies
// of the same problem are a DUPLICATE, not a hierarchy — different tool), and
// a problem that already has a parent is never re-parented by suggestion.
// Suggestions come only from what is already coded on this record — the
// widget never invents codes, never searches free text, never links anything
// automatically.
//
// SAFETY POSTURE (same family rules as problem-bulk-end.js, adapted):
//   - Nesting changes how the problem list READS — a child renders under its
//     parent, so a wrong link visually demotes a live clinical problem.
//     Suggestion cards confirm per pair (child and parent echoed back by
//     name); the manual builder confirms per BATCH under one parent, with
//     every ticked child listed by name and any re-parents counted — but
//     nothing is ever pre-ticked, there is no select-all, and each child
//     still commits (and cycle-checks) individually.
//   - Cycle guard at BOTH layers: suggestions that would create a loop are
//     filtered at render time against the LIVE link map (which updates as
//     links commit), and confirmLink() re-checks before POSTing regardless of
//     what the UI showed.
//   - No auto-reload after success — Medicus's own list shows the change on
//     the next refresh; a "Refresh page" button is offered instead.
//   - Every committed link is recorded in the machine-local Clinical Event
//     Ledger (patient UUID only, fixed label, never problem descriptions).
//   - Failed POSTs surface the server's response body per card, never a bare
//     status.
//   - Unlink is NOT offered: the null-parent unlink shape is inferred from
//     the captured Vue form but has never been captured live (see the
//     learnings doc) — this widget only writes the one confirmed shape.
//
// Works on BOTH page shapes (v3.213.0 discipline): the care-record page
// (patientId in the URL) and the task-overview "split" page (patient resolved
// via the task's own overview endpoint, cached per taskUuid).
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  // The confirmed three-field update-parent-problem POST body — never more.
  function buildUpdateParentProblemPayload(patientId, problemId, parentProblemId) {
    return { patientId: patientId, problemId: problemId, parentProblemId: parentProblemId };
  }

  function resolveOverviewConceptId(overview) {
    var code = overview && overview.problemCode;
    return code && code.conceptId ? String(code.conceptId) : null;
  }

  // True when making `childId` a child of `parentId` would create a loop in
  // the existing link graph — i.e. walking up from parentId via
  // parentIdByProblemId reaches childId. Visited-guard so a (never expected,
  // but server data is server data) pre-existing loop can't hang us.
  function wouldCreateCycle(childId, parentId, parentIdByProblemId) {
    if (!childId || !parentId) return false;
    if (childId === parentId) return true;
    var map = parentIdByProblemId || {};
    var seen = {};
    var cur = parentId;
    while (cur) {
      if (cur === childId) return true;
      if (seen[cur]) return false;
      seen[cur] = true;
      cur = map[cur] || null;
    }
    return false;
  }

  // Builds the suggestion list from the scan's raw materials:
  //   problems     — [{id, description}] (the active summary list)
  //   infoById     — {id: {conceptId, parentProblemId}} from each overview
  //   pairHits     — Set of 'childConceptId|parentConceptId' strings, one per
  //                  CONFIRMED SNOMED descendant relationship (built by the
  //                  scan's attribution queries — this function trusts it).
  // Rules (each is a safety decision, not styling):
  //   - a child needs a resolved conceptId and NO existing parent;
  //   - parent options are other problems whose conceptId differs and whose
  //     (child, parent) concept pair is in pairHits;
  //   - identical-concept pairs never suggest (duplicate ≠ hierarchy);
  //   - options that would create a cycle against the CURRENT link map are
  //     dropped here AND re-checked at commit time by the caller.
  function buildNestingSuggestions(problems, infoById, pairHits) {
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var hits = pairHits instanceof Set ? pairHits : new Set(pairHits || []);
    var parentIdByProblemId = {};
    list.forEach(function (p) {
      var i = info[p.id];
      if (i && i.parentProblemId) parentIdByProblemId[p.id] = i.parentProblemId;
    });
    var out = [];
    list.forEach(function (child) {
      var ci = info[child.id];
      if (!ci || !ci.conceptId) return;
      if (ci.parentProblemId) return; // already nested — never re-parent by suggestion
      var options = [];
      list.forEach(function (parent) {
        if (parent.id === child.id) return;
        var pi = info[parent.id];
        if (!pi || !pi.conceptId) return;
        if (pi.conceptId === ci.conceptId) return; // duplicate, not hierarchy
        if (!hits.has(ci.conceptId + '|' + pi.conceptId)) return;
        if (wouldCreateCycle(child.id, parent.id, parentIdByProblemId)) return;
        options.push({ id: parent.id, description: parent.description });
      });
      if (options.length) {
        out.push({
          childId: child.id,
          childDescription: child.description,
          childConceptId: ci.conceptId,
          parentOptions: options,
        });
      }
    });
    return out;
  }

  // Child options for the MANUAL link builder: every OTHER problem that could
  // be nested under the chosen parent without creating a loop. Parent-first,
  // multi-child (2026-08-03 feedback: several problems usually belong under
  // one title — one at a time was too slow). Deliberately looser than
  // buildNestingSuggestions — no SNOMED gate, no same-concept exclusion, and
  // already-parented problems are valid candidates (re-parenting; annotated
  // and called out at confirm) — because here the clinician is making the
  // call, not the terminology. The cycle guard is the one rule that stays
  // hard: it protects the record's structure, not a judgement call.
  function manualChildOptions(parentId, problems, parentIdByProblemId) {
    if (!parentId) return [];
    return (Array.isArray(problems) ? problems : []).filter(function (p) {
      if (!p || !p.id || p.id === parentId) return false;
      return !wouldCreateCycle(p.id, parentId, parentIdByProblemId || {});
    });
  }

  // ── Duplicate-merge helpers (the in-panel "merge these copies" shortcut) ─────
  // Groups the active problems by IDENTICAL conceptId — two entries carrying
  // the same code are duplicate copies, not a hierarchy (the exact case the
  // suggestion engine refuses to pair). Groups of 2+ only; problems with no
  // resolved conceptId never group. This is the lightweight, same-code-only
  // sibling of the full Duplicate Problem Checker — it deliberately does NOT
  // attempt the checker's fuzzy/cross-kind matching.
  function buildDuplicateGroups(problems, infoById) {
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var byConcept = Object.create(null);
    var order = [];
    list.forEach(function (p) {
      if (!p || !p.id) return;
      var ci = info[p.id];
      if (!ci || !ci.conceptId) return;
      if (!byConcept[ci.conceptId]) {
        byConcept[ci.conceptId] = [];
        order.push(ci.conceptId);
      }
      byConcept[ci.conceptId].push(p);
    });
    return order
      .filter(function (c) {
        return byConcept[c].length >= 2;
      })
      .map(function (c) {
        return { conceptId: c, entries: byConcept[c] };
      });
  }

  // Default keeper = the EARLIEST copy. Medicus problem ids are UUIDv7
  // (time-ordered), so the lexicographically smallest id is the oldest entry
  // — the same "kept (earliest copy)" default the Duplicate Problem Checker
  // uses. A default only; the keeper radio stays the clinician's choice.
  function pickEarliestCopyId(entries) {
    var best = null;
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (!e || !e.id) return;
      if (best === null || e.id < best) best = e.id;
    });
    return best;
  }

  // The confirmed mark-incorrect-and-hidden POST body (identical to the
  // Duplicate Problem Checker's buildRemovalRequest for kind 'problem'):
  // {problemId, reason, isConfirmedRemoval: true}. Null (never a partial
  // body) on a missing id or blank reason — a removal must never reach the
  // record without its reason.
  function buildMarkIncorrectPayload(problemId, reason) {
    var trimmed = (reason || '').trim();
    if (!problemId || !trimmed) return null;
    return { problemId: problemId, reason: trimmed, isConfirmedRemoval: true };
  }

  // Which copies in a group the merge may actually remove: everything except
  // the keeper and except any copy that has nested children (removing a
  // parent would leave its children dangling — those copies need the full
  // Duplicate Checker or Medicus itself, where the structure is visible).
  function removableDuplicateIds(entries, keeperId) {
    return (Array.isArray(entries) ? entries : [])
      .filter(function (e) {
        return e && e.id && e.id !== keeperId && !e.hasChildren;
      })
      .map(function (e) {
        return e.id;
      });
  }

  // Same extraction as problem-bulk-end.js's apiErrorMessage — duplicated (not
  // shared) the same way each content script already carries its own apiFetch.
  function apiErrorMessage(status, bodyText) {
    var base = 'API ' + status;
    var detail = typeof bodyText === 'string' ? bodyText.trim() : '';
    if (detail) {
      try {
        var data = JSON.parse(detail);
        if (data && typeof data === 'object') {
          if (typeof data.message === 'string' && data.message) detail = data.message;
          else if (typeof data.error === 'string' && data.error) detail = data.error;
          else if (data.errors && typeof data.errors === 'object') detail = JSON.stringify(data.errors);
          else detail = JSON.stringify(data);
        }
      } catch (_) {
        /* not JSON — use the raw text as-is */
      }
    }
    detail = detail.replace(/\s+/g, ' ').trim();
    if (detail.length > 220) detail = detail.slice(0, 220) + '…';
    return detail ? base + ' — ' + detail : base;
  }

  // The search response shape is `{results:[{label, value:{conceptId, …}}]}`
  // — same tolerant reader as problem-bulk-end.js.
  function resultContainsConceptId(results, conceptId) {
    if (!Array.isArray(results) || !conceptId) return false;
    return results.some(function (r) {
      var v = (r && r.value) || r;
      return !!(v && v.conceptId === conceptId);
    });
  }

  // ── Page-shape parsing (pure — same pair as problem-bulk-end.js) ─────────────
  function parseCareRecordPath(pathname) {
    var m = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i.exec(
      String(pathname == null ? '' : pathname)
    );
    if (!m) return null;
    return { siteId: m[1], patientId: m[2] };
  }

  function parseTaskOverviewPath(pathname) {
    var m =
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        String(pathname == null ? '' : pathname)
      );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // Parses the page-world bridge attribute ('data-ch-summary-patient',
  // written by triage-lens/page-world.js as '<patientId>|<epoch-ms>'): the
  // patientId of the page's OWN most recent Clinical Summary panel fetch.
  // This is the context source for page shapes with no parseable patientId
  // in the URL (appointment views, consultation views, whatever Medicus adds
  // next) — wherever the summary panel renders, the page itself has already
  // told us whose it is. Strict full-UUID check; anything else is null.
  function parseSummaryBridgeAttr(value) {
    if (!value) return null;
    var id = String(value).split('|')[0];
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  }

  function extractPatientIdFromTaskOverview(data) {
    var candidates = [data && data.data, data];
    for (var i = 0; i < candidates.length; i++) {
      var d = candidates[i];
      if (!d || typeof d !== 'object') continue;
      if (d.patient && d.patient.id) return String(d.patient.id);
      if (d.patientId) return String(d.patientId);
    }
    return null;
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildUpdateParentProblemPayload: buildUpdateParentProblemPayload,
      resolveOverviewConceptId: resolveOverviewConceptId,
      wouldCreateCycle: wouldCreateCycle,
      buildNestingSuggestions: buildNestingSuggestions,
      manualChildOptions: manualChildOptions,
      buildDuplicateGroups: buildDuplicateGroups,
      pickEarliestCopyId: pickEarliestCopyId,
      buildMarkIncorrectPayload: buildMarkIncorrectPayload,
      removableDuplicateIds: removableDuplicateIds,
      apiErrorMessage: apiErrorMessage,
      resultContainsConceptId: resultContainsConceptId,
      parseCareRecordPath: parseCareRecordPath,
      parseTaskOverviewPath: parseTaskOverviewPath,
      parseSummaryBridgeAttr: parseSummaryBridgeAttr,
      extractPatientIdFromTaskOverview: extractPatientIdFromTaskOverview,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msProblemNesting) return;
  window.__msProblemNesting = true;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Render-layer helpers (glyphs, dates, live region, focus restore) ─────────

  // Feather-style stroke glyphs at currentColor — success check and the
  // destructive-merge warning triangle. Inline so no external asset ever loads.
  var CHECK_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><polyline points="20 6 9 17 4 12"/></svg>';
  var WARN_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

  // Onset date for a problem reference — accepts a problemId (looked up in
  // the scan's info map) or an entry object that carries its own onsetDate
  // (merge-group entries survive removal of their info-map row).
  function onsetDateFor(ref) {
    if (ref && typeof ref === 'object') return ref.onsetDate || null;
    var i = _infoById[ref];
    return (i && i.onsetDate) || null;
  }

  // HTML date suffix for names in markup; empty string when no date.
  function dateSuffix(ref) {
    var d = onsetDateFor(ref);
    return d ? ' <span class="ms-pn-date">· ' + esc(d) + '</span>' : '';
  }

  // Plain-text date suffix for <option> labels (no markup inside options).
  // Callers esc() the combined string.
  function dateSuffixText(ref) {
    var d = onsetDateFor(ref);
    return d ? ' · ' + d : '';
  }

  // Screen-reader announcements — writes into the persistent polite live
  // region (which render() never rebuilds).
  function announce(text) {
    var el = document.getElementById('ms-pn-widget');
    var live = el && el.querySelector('.ms-pn-live');
    if (live) live.textContent = text;
  }

  // Focus restore across innerHTML rebuilds: capture the focused element's
  // identity (id, or ms-pn-* class token + its data-* keys) before a render,
  // re-focus the equivalent element after.
  var FOCUS_KEY_ATTRS = ['data-idx', 'data-child-id', 'data-entry-id', 'data-gidx', 'data-sec'];

  function captureFocusKey(el) {
    var a = document.activeElement;
    if (!a || !el.contains(a)) return null;
    if (a.id) return { id: a.id };
    var cls = null;
    String(a.className || '')
      .split(/\s+/)
      .some(function (c) {
        if (c.indexOf('ms-pn-') === 0) {
          cls = c;
          return true;
        }
        return false;
      });
    if (!cls) return null;
    var key = { cls: cls };
    FOCUS_KEY_ATTRS.forEach(function (attr) {
      if (a.hasAttribute(attr)) key[attr] = a.getAttribute(attr);
    });
    return key;
  }

  function restoreFocusKey(el, key) {
    if (!key) return;
    var target = null;
    if (key.id) {
      target = el.querySelector('#' + key.id);
    } else {
      var sel = '.' + key.cls;
      FOCUS_KEY_ATTRS.forEach(function (attr) {
        if (key[attr] !== undefined) sel += '[' + attr + '="' + key[attr] + '"]';
      });
      target = el.querySelector(sel);
    }
    if (target && typeof target.focus === 'function') target.focus();
  }

  // ── URL detection — both page shapes (v3.213.0 discipline) ───────────────────
  function getPatientInfo() {
    return parseCareRecordPath(location.pathname);
  }

  function getTaskInfo() {
    return parseTaskOverviewPath(location.pathname);
  }

  // ── API ───────────────────────────────────────────────────────────────────────
  function apiBaseUrl() {
    var info = getPatientInfo() || getTaskInfo();
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
      var errBody = '';
      try {
        errBody = await resp.text();
      } catch (_) {
        /* unreadable body — the status alone will have to do */
      }
      throw new Error(apiErrorMessage(resp.status, errBody));
    }
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

  function fetchProblemOverview(problemId) {
    return apiFetch('/clinical/data/problem/slideover/overview/' + encodeURIComponent(problemId));
  }

  // Descendant test via the confirmed constrained-search mechanism (see the
  // bulk-remove badge scan): a hit for `conceptId` under `rootsCsv` means the
  // concept is a genuine SNOMED descendant of at least one root.
  function fetchDescendantSearchResults(conceptId, rootsCsv) {
    var path =
      '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=' +
      encodeURIComponent(rootsCsv) +
      '&query=' +
      encodeURIComponent(conceptId);
    return apiFetch(path).then(function (data) {
      return (data && data.results) || [];
    });
  }

  function postUpdateParentProblem(payload) {
    return apiFetch('/clinical/problem/update-parent-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // Same confirmed write the Duplicate Problem Checker uses to retire a
  // duplicate copy (engine/record-duplicate-parser.js WRITE_CONTRACTS.problem)
  // — marks the entry incorrect and hides it from the record. Not an
  // end-date: the copy disappears as recorded-in-error. No undo endpoint is
  // known (the checker's own open question), so the confirm copy says so.
  function postMarkIncorrectAndHidden(payload) {
    return apiFetch('/clinical/problem/mark-incorrect-and-hidden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── Split-page patient resolution (same block as problem-bulk-end.js) ────────
  var _taskPatientIdByUuid = Object.create(null);
  var _taskPatientResolveInFlight = false;

  async function resolveTaskPatientId(task) {
    if (_taskPatientIdByUuid[task.taskUuid] !== undefined) return _taskPatientIdByUuid[task.taskUuid];
    if (_taskPatientResolveInFlight) return null;
    _taskPatientResolveInFlight = true;
    try {
      var data = await apiFetch(
        '/tasks/data/' + encodeURIComponent(task.typeSlug) + '/overview/' + encodeURIComponent(task.taskUuid)
      );
      _taskPatientIdByUuid[task.taskUuid] = extractPatientIdFromTaskOverview(data);
    } catch (_) {
      /* transient failure — left uncached so a later tick retries */
    } finally {
      _taskPatientResolveInFlight = false;
    }
    var resolved = _taskPatientIdByUuid[task.taskUuid];
    return resolved === undefined ? null : resolved;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var _lastPatientId = null;
  // True when the current patient context came from the page-world bridge
  // rather than a parseable URL — gates injection on a DOM row match.
  var _contextViaBridge = false;
  var _problemsCache = null;
  var _open = false;
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
  // Accordion: which done-view section is expanded (one at a time).
  var _openSection = null; // 'suggest' | 'merge' | 'manual' | null
  // [{childId, childDescription, childConceptId, parentOptions, chosenParentId,
  //   confirming, linking, linked, linkedParentDescription, linkError}]
  var _suggestions = [];
  // Live link map (problemId → parentProblemId) — seeded from the scan's
  // overviews, updated on every committed link so cycle checks and rescans
  // stay honest without refetching.
  var _parentIdByProblemId = {};
  // Scan products the manual link builder reuses: the active problem list
  // ({id, description}) and each problem's overview-derived info.
  var _problems = [];
  var _infoById = {};
  // Manual link builder state (parent-first, multi-child) + this-session
  // committed manual links ([{childDescription, parentDescription}], display
  // only). childIds is the ticked set; childErrors carries per-child commit
  // failures so a partial batch shows exactly which links didn't land.
  var _manual = { parentId: null, childIds: {}, confirming: false, linking: false, childErrors: {} };
  var _manualLinked = [];
  // Duplicate-merge groups: [{conceptId, description, entries: [{id,
  //   description, hasChildren, additionalInformation}], keeperId, open,
  //   confirming, removing, reason, errors: {id: msg}, removedCount, done}]
  var _mergeGroups = [];

  function resetForPatient() {
    _problemsCache = null;
    _open = false;
    _scanState = 'idle';
    _scanError = null;
    _openSection = null;
    _suggestions = [];
    _parentIdByProblemId = {};
    _problems = [];
    _infoById = {};
    _manual = { parentId: null, childIds: {}, confirming: false, linking: false, childErrors: {} };
    _manualLinked = [];
    _mergeGroups = [];
  }

  // ── Scan (opt-in — only ever runs from the "Nest problems?" click) ───────────
  async function runScan() {
    var scanPatientId = _lastPatientId;
    _scanState = 'scanning';
    _scanError = null;
    render();
    try {
      var problems = (_problemsCache || []).map(function (p) {
        return { id: p.id, description: p.problemCodeDescription };
      });
      var overviews = await Promise.all(
        problems.map(function (p) {
          return fetchProblemOverview(p.id).catch(function () {
            return null;
          });
        })
      );
      if (_lastPatientId !== scanPatientId) return; // patient changed mid-scan — discard
      var infoById = {};
      problems.forEach(function (p, i) {
        var ov = overviews[i];
        infoById[p.id] = {
          conceptId: resolveOverviewConceptId(ov),
          parentProblemId: (ov && ov.parentProblemId) || null,
          hasChildren: !!(ov && Array.isArray(ov.childProblems) && ov.childProblems.length),
          additionalInformation: (ov && ov.additionalInformation) || null,
          // Confirmed slideover-overview field — a UK display string like
          // "20 Apr 2020"; shown beside every problem reference so same-named
          // entries stay tellable-apart.
          onsetDate: (ov && ov.onsetDate) || null,
        };
        if (ov && ov.parentProblemId) _parentIdByProblemId[p.id] = ov.parentProblemId;
      });

      // Distinct concept per candidate child; one combined query decides IF it
      // descends from any other on-record concept, then per-parent queries
      // attribute exactly which — concept-level, deduped, so duplicate
      // problems don't multiply fetches.
      var conceptsByProblem = problems
        .map(function (p) {
          return infoById[p.id].conceptId;
        })
        .filter(Boolean);
      var distinctConcepts = conceptsByProblem.filter(function (c, i) {
        return conceptsByProblem.indexOf(c) === i;
      });
      var pairHits = new Set();
      await Promise.all(
        distinctConcepts.map(function (childConcept) {
          return (async function () {
            var otherConcepts = distinctConcepts.filter(function (c) {
              return c !== childConcept;
            });
            if (!otherConcepts.length) return;
            var combined;
            try {
              combined = await fetchDescendantSearchResults(childConcept, otherConcepts.join(','));
            } catch (_) {
              return; // fail closed: no suggestion beats a guessed one
            }
            if (!resultContainsConceptId(combined, childConcept)) return;
            await Promise.all(
              otherConcepts.map(function (parentConcept) {
                return fetchDescendantSearchResults(childConcept, parentConcept)
                  .then(function (results) {
                    if (resultContainsConceptId(results, childConcept)) {
                      pairHits.add(childConcept + '|' + parentConcept);
                    }
                  })
                  .catch(function () {
                    /* fail closed per pair */
                  });
              })
            );
          })();
        })
      );
      if (_lastPatientId !== scanPatientId) return;

      _problems = problems;
      _infoById = infoById;
      _mergeGroups = buildDuplicateGroups(problems, infoById).map(function (g) {
        var entries = g.entries.map(function (p) {
          var ci = infoById[p.id] || {};
          return {
            id: p.id,
            description: p.description,
            hasChildren: !!ci.hasChildren,
            additionalInformation: ci.additionalInformation || null,
            onsetDate: ci.onsetDate || null,
          };
        });
        return {
          conceptId: g.conceptId,
          description: entries[0].description,
          entries: entries,
          keeperId: pickEarliestCopyId(entries),
          open: false,
          confirming: false,
          removing: false,
          reason: 'Duplicate entry - merged into retained copy',
          errors: {},
          removedCount: 0,
          done: false,
        };
      });
      _suggestions = buildNestingSuggestions(problems, infoById, pairHits).map(function (s) {
        return Object.assign({}, s, {
          chosenParentId: s.parentOptions.length === 1 ? s.parentOptions[0].id : null,
          confirming: false,
          linking: false,
          linked: false,
          linkedParentDescription: null,
          linkError: null,
        });
      });
      _scanState = 'done';
      // Accordion default: first section with something in it.
      _openSection = _suggestions.length ? 'suggest' : _mergeGroups.length ? 'merge' : 'manual';
      announce(
        _suggestions.length +
          ' suggestion' +
          (_suggestions.length === 1 ? '' : 's') +
          ', ' +
          _mergeGroups.length +
          ' duplicate group' +
          (_mergeGroups.length === 1 ? '' : 's')
      );
    } catch (err) {
      if (_lastPatientId !== scanPatientId) return;
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to scan the problem list.';
    } finally {
      if (_lastPatientId === scanPatientId) render();
    }
  }

  // Shared commit path for BOTH the suggestion cards and the manual builder:
  // commit-time cycle hard-guard (independent of what the UI showed — the
  // live map may have changed since render), the confirmed three-field POST,
  // the live-map update, and the ledger record. Throws on failure with a
  // user-facing message.
  async function commitParentLink(childId, parentId) {
    if (wouldCreateCycle(childId, parentId, _parentIdByProblemId)) {
      throw new Error('Linking these two would create a loop — another link committed first. Rescan to refresh.');
    }
    await postUpdateParentProblem(buildUpdateParentProblemPayload(_lastPatientId, childId, parentId));
    _parentIdByProblemId[childId] = parentId;
    // Machine-local audit trail: patient UUID only, fixed label — never the
    // problem descriptions (the ledger's no-free-text label rule).
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'problem-nesting',
        label: 'Nest problems: 1 link created',
        action: 'committed',
      });
    }
  }

  async function confirmLink(s) {
    if (s.linking || s.linked) return;
    var parentId = s.chosenParentId;
    var parent = s.parentOptions.find(function (o) {
      return o.id === parentId;
    });
    if (!parent) return;
    s.linking = true;
    s.linkError = null;
    render();
    try {
      await commitParentLink(s.childId, parentId);
      s.linked = true;
      s.confirming = false;
      s.linkedParentDescription = parent.description;
      announce('Nested ' + s.childDescription + ' under ' + parent.description);
    } catch (err) {
      s.linkError = (err && err.message) || 'Failed to link — please try again.';
      announce('Action failed — see panel');
    } finally {
      s.linking = false;
      render();
    }
  }

  function manualSelectedChildIds() {
    return Object.keys(_manual.childIds).filter(function (id) {
      return _manual.childIds[id];
    });
  }

  // Commits the ticked children under the chosen parent, SEQUENTIALLY — one
  // confirmed update-parent-problem POST per child, never the
  // update-child-problems full-replace endpoint (see the header's trap note).
  // Each child re-passes the commit-time cycle guard inside commitParentLink;
  // a failure records a per-child error and the batch carries on, so one bad
  // link never blocks the rest. Successes untick; failures stay ticked for
  // retry with their error shown against the row.
  async function confirmManualBatch() {
    var m = _manual;
    if (m.linking || !m.parentId) return;
    var parent = _problems.find(function (p) {
      return p.id === m.parentId;
    });
    var targets = manualSelectedChildIds();
    if (!parent || !targets.length) return;
    m.linking = true;
    m.childErrors = {};
    render();
    for (var i = 0; i < targets.length; i++) {
      var childId = targets[i];
      var child = _problems.find(function (p) {
        return p.id === childId;
      });
      if (!child) continue;
      try {
        await commitParentLink(childId, m.parentId);
        _manualLinked.push({ childDescription: child.description, parentDescription: parent.description });
        // Keep the child's info honest so a suggestion card for it (if any)
        // retires, and untick it now it's landed.
        if (_infoById[childId]) _infoById[childId].parentProblemId = m.parentId;
        delete m.childIds[childId];
        announce('Nested ' + child.description + ' under ' + parent.description);
      } catch (err) {
        m.childErrors[childId] = (err && err.message) || 'Failed to link — please try again.';
        announce('Action failed — see panel');
      }
    }
    m.linking = false;
    m.confirming = false;
    render();
  }

  // Removes a merged-away copy from every piece of live widget state so the
  // other sections stop offering it: the problem list, the info/link maps,
  // any manual tick or parent pick, and (via the existence checks in
  // cardHtml) any suggestion card that referenced it.
  function forgetProblem(problemId) {
    _problems = _problems.filter(function (p) {
      return p.id !== problemId;
    });
    delete _infoById[problemId];
    delete _parentIdByProblemId[problemId];
    delete _manual.childIds[problemId];
    if (_manual.parentId === problemId) {
      _manual = { parentId: null, childIds: {}, confirming: false, linking: false, childErrors: {} };
    }
  }

  // Commits one duplicate group's merge: mark-incorrect-and-hidden on every
  // removable non-keeper copy, SEQUENTIALLY, with the group's shared reason.
  // Per-copy failures record against their row and the rest carry on — the
  // keeper is never touched by definition, so a partial batch is always
  // recoverable (retry or fall back to the Duplicate Checker).
  async function confirmMergeGroup(g) {
    if (g.removing || g.done) return;
    var targets = removableDuplicateIds(g.entries, g.keeperId);
    var payloadCheck = buildMarkIncorrectPayload('x', g.reason);
    if (!targets.length || !payloadCheck) return; // blank reason never reaches the record
    g.removing = true;
    g.errors = {};
    render();
    var batchRemoved = 0;
    for (var i = 0; i < targets.length; i++) {
      var id = targets[i];
      try {
        await postMarkIncorrectAndHidden(buildMarkIncorrectPayload(id, g.reason));
        batchRemoved++;
        g.removedCount++;
        forgetProblem(id);
        g.entries = g.entries.filter(function (e) {
          return e.id !== id;
        });
      } catch (err) {
        g.errors[id] = (err && err.message) || 'Failed to remove this copy — please try again.';
      }
    }
    g.removing = false;
    g.confirming = false;
    if (!Object.keys(g.errors).length) g.done = true;
    if (Object.keys(g.errors).length) {
      announce('Action failed — see panel');
    } else if (batchRemoved > 0) {
      announce(batchRemoved + ' cop' + (batchRemoved === 1 ? 'y' : 'ies') + ' removed');
    }
    // One ledger record per batch (batch-local count so a retry never
    // re-reports earlier successes), fixed label — never the problem
    // description or the free-typed reason.
    if (batchRemoved > 0 && window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'problem-merge',
        label: 'Merge problems: ' + batchRemoved + ' duplicate cop' + (batchRemoved === 1 ? 'y' : 'ies') + ' removed',
        action: 'committed',
      });
    }
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function cardHtml(s, idx) {
    if (s.linked) {
      return (
        '<div class="ms-pn-card ms-pn-card-linked">' +
        CHECK_SVG +
        ' <strong>' +
        esc(s.childDescription) +
        '</strong> is now nested under <strong>' +
        esc(s.linkedParentDescription) +
        '</strong>. Medicus’s own list shows this after a page refresh.</div>'
      );
    }
    // A child removed as a duplicate this session no longer exists to nest.
    if (
      !_problems.some(function (p) {
        return p.id === s.childId;
      })
    ) {
      return (
        '<div class="ms-pn-card ms-pn-card-stale"><strong>' +
        esc(s.childDescription) +
        '</strong> — removed as a duplicate copy this session.</div>'
      );
    }
    // A child linked through the MANUAL builder this session retires its
    // suggestion card (its map entry exists but s.linked is false).
    if (_parentIdByProblemId[s.childId]) {
      return (
        '<div class="ms-pn-card ms-pn-card-stale"><strong>' +
        esc(s.childDescription) +
        '</strong> — already nested this session via a manual link.</div>'
      );
    }
    // Options are re-filtered against the LIVE link map (and the live problem
    // list — a merged-away parent is gone) on every render, so a link or
    // merge committed elsewhere can retire an option here.
    var liveOptions = s.parentOptions.filter(function (o) {
      return (
        _problems.some(function (p) {
          return p.id === o.id;
        }) && !wouldCreateCycle(s.childId, o.id, _parentIdByProblemId)
      );
    });
    if (!liveOptions.length) {
      return (
        '<div class="ms-pn-card ms-pn-card-stale"><strong>' +
        esc(s.childDescription) +
        '</strong> — its suggested parent is no longer linkable (a link committed elsewhere). Rescan to refresh.</div>'
      );
    }
    var picker;
    if (liveOptions.length === 1) {
      picker = 'child of <strong>' + esc(liveOptions[0].description) + '</strong>' + dateSuffix(liveOptions[0].id);
      s.chosenParentId = liveOptions[0].id;
    } else {
      picker =
        'child of <select class="ms-pn-parent-select" data-idx="' +
        idx +
        '">' +
        '<option value=""' +
        (s.chosenParentId ? '' : ' selected') +
        ' disabled>Choose parent…</option>' +
        liveOptions
          .map(function (o) {
            return (
              '<option value="' +
              esc(o.id) +
              '"' +
              (s.chosenParentId === o.id ? ' selected' : '') +
              '>' +
              esc(o.description + dateSuffixText(o.id)) +
              '</option>'
            );
          })
          .join('') +
        '</select>';
    }
    var body =
      '<div class="ms-pn-card-main"><strong>' +
      esc(s.childDescription) +
      '</strong>' +
      dateSuffix(s.childId) +
      ' — SNOMED marks this as a ' +
      picker +
      '</div>';
    var actions;
    if (s.confirming) {
      var chosen = liveOptions.find(function (o) {
        return o.id === s.chosenParentId;
      });
      actions =
        '<div class="ms-pn-confirm">This will nest <strong>' +
        esc(s.childDescription) +
        '</strong> under <strong>' +
        esc(chosen ? chosen.description : '') +
        '</strong> — it will display as a child on the problem list, not as a top-level problem. ' +
        'There is no bulk undo; un-nesting is done in Medicus, one problem at a time.' +
        '<div class="ms-pn-confirm-actions">' +
        '<button type="button" class="ms-pn-cancel" data-idx="' +
        idx +
        '"' +
        (s.linking ? ' disabled' : '') +
        '>Cancel</button>' +
        '<button type="button" class="ms-pn-confirm-btn" data-idx="' +
        idx +
        '"' +
        (s.linking || !s.chosenParentId ? ' disabled' : '') +
        '>' +
        (s.linking ? 'Linking…' : 'Confirm — nest it') +
        '</button>' +
        '</div></div>';
    } else {
      actions =
        '<button type="button" class="ms-pn-link-btn" data-idx="' +
        idx +
        '"' +
        (s.chosenParentId ? '' : ' disabled') +
        '>Nest…</button>';
    }
    var error = s.linkError ? '<div class="ms-pn-card-error">' + esc(s.linkError) + '</div>' : '';
    return '<div class="ms-pn-card">' + body + actions + error + '</div>';
  }

  // One duplicate group's card in the "Merge duplicate copies" section.
  // Collapsed: description + copy count + "Merge…". Expanded: keeper radios
  // (blocked copies flagged, additional-info copies cautioned), then the
  // KEEPING / REMOVING confirm with the reason echoed and the
  // mark-incorrect-and-hidden consequence stated plainly.
  function mergeGroupHtml(g, gIdx) {
    if (g.done) {
      return (
        '<div class="ms-pn-card ms-pn-card-linked">' +
        CHECK_SVG +
        ' <strong>' +
        esc(g.description) +
        '</strong> — ' +
        g.removedCount +
        ' duplicate cop' +
        (g.removedCount === 1 ? 'y' : 'ies') +
        ' removed, earliest copy kept. Medicus’s own list shows this after a page refresh.</div>'
      );
    }
    if (!g.open) {
      return (
        '<div class="ms-pn-card"><div class="ms-pn-card-main"><strong>' +
        esc(g.description) +
        '</strong> — ' +
        g.entries.length +
        ' copies with the same code.</div>' +
        '<button type="button" class="ms-pn-link-btn ms-pn-merge-open" data-gidx="' +
        gIdx +
        '">Merge…</button></div>'
      );
    }
    var rows = g.entries
      .map(function (e) {
        var notes = [];
        if (e.hasChildren) notes.push('has nested children — kept; merge it via the Duplicate Checker or Medicus');
        if (e.additionalInformation)
          notes.push('has additional info — removing loses it; compare in the Duplicate Checker first');
        var err = g.errors[e.id];
        return (
          '<label class="ms-pn-man-child-row">' +
          '<input type="radio" name="ms-pn-merge-keeper-' +
          gIdx +
          '" class="ms-pn-merge-keeper" data-gidx="' +
          gIdx +
          '" data-entry-id="' +
          esc(e.id) +
          '"' +
          (g.keeperId === e.id ? ' checked' : '') +
          (g.removing ? ' disabled' : '') +
          '>' +
          '<span>' +
          esc(e.description) +
          dateSuffix(e) +
          (g.keeperId === e.id ? ' <span class="ms-pn-merge-keep-tag">keep this copy</span>' : '') +
          (notes.length ? ' <span class="ms-pn-man-child-note">(' + esc(notes.join('; ')) + ')</span>' : '') +
          '</span>' +
          (err ? '<span class="ms-pn-card-error">' + esc(err) + '</span>' : '') +
          '</label>'
        );
      })
      .join('');
    var removable = removableDuplicateIds(g.entries, g.keeperId);
    var confirmHtml = '';
    if (g.confirming && removable.length) {
      var kept = g.entries.filter(function (e) {
        return removable.indexOf(e.id) === -1;
      });
      confirmHtml =
        '<div class="ms-pn-confirm ms-pn-confirm-danger">' +
        WARN_SVG +
        ' <strong>Keeping</strong> ' +
        kept
          .map(function (e) {
            return '<strong>' + esc(e.description) + '</strong>' + dateSuffix(e);
          })
          .join(', ') +
        ' · <strong>Removing</strong> ' +
        removable.length +
        ' cop' +
        (removable.length === 1 ? 'y' : 'ies') +
        ' via Medicus’s mark-incorrect-and-hidden — removed copies are hidden from the record as recorded-in-error, ' +
        'not end-dated, and this cannot be undone from this tool. Reason recorded against each: ' +
        '<input type="text" class="ms-pn-merge-reason" data-gidx="' +
        gIdx +
        '" value="' +
        esc(g.reason) +
        '" maxlength="120">' +
        '<div class="ms-pn-confirm-actions">' +
        '<button type="button" class="ms-pn-cancel ms-pn-merge-back" data-gidx="' +
        gIdx +
        '"' +
        (g.removing ? ' disabled' : '') +
        '>Back</button>' +
        '<button type="button" class="ms-pn-confirm-btn ms-pn-merge-confirm" data-gidx="' +
        gIdx +
        '"' +
        (g.removing || !(g.reason || '').trim() ? ' disabled' : '') +
        '>' +
        (g.removing
          ? 'Removing…'
          : 'Confirm — remove ' + removable.length + ' cop' + (removable.length === 1 ? 'y' : 'ies')) +
        '</button>' +
        '</div></div>';
    }
    return (
      '<div class="ms-pn-card">' +
      '<div class="ms-pn-card-main"><strong>' +
      esc(g.description) +
      '</strong> — pick the copy to <strong>keep</strong>; every other removable copy is removed.</div>' +
      '<div class="ms-pn-man-children">' +
      rows +
      '</div>' +
      (g.confirming
        ? confirmHtml
        : '<button type="button" class="ms-pn-link-btn ms-pn-merge-review" data-gidx="' +
          gIdx +
          '"' +
          (removable.length && !g.removing ? '' : ' disabled') +
          '>Review merge (' +
          removable.length +
          ' to remove)…</button>') +
      '</div>'
    );
  }

  function liveMergeGroups() {
    return _mergeGroups.filter(function (g) {
      return g.done || g.entries.length >= 2;
    });
  }

  function emptyBlockHtml(title, sub) {
    return (
      '<div class="ms-pn-empty-block"><div class="ms-pn-empty-title">' +
      esc(title) +
      '</div><div class="ms-pn-empty-sub">' +
      esc(sub) +
      '</div></div>'
    );
  }

  function suggestSectionContent() {
    if (!_suggestions.length) {
      return emptyBlockHtml(
        'No nesting suggestions',
        'Nothing on this record is coded as a SNOMED descendant of anything else.'
      );
    }
    return _suggestions
      .map(function (s, i) {
        return cardHtml(s, i);
      })
      .join('');
  }

  function mergeSectionContent() {
    var live = liveMergeGroups();
    if (!live.length) {
      return emptyBlockHtml('No duplicate copies', 'No two active problems here share the same SNOMED code.');
    }
    return (
      '<div class="ms-pn-sec-note">Same code recorded more than once. Pick the copy to keep.</div>' +
      live
        .map(function (g) {
          return mergeGroupHtml(g, _mergeGroups.indexOf(g));
        })
        .join('')
    );
  }

  function problemDescription(problemId) {
    var p = _problems.find(function (x) {
      return x.id === problemId;
    });
    return p ? p.description : null;
  }

  // The manual link builder — parent-first, multi-child, the clinician's own
  // grouping, no SNOMED gate. Pick the parent "title", tick every problem to
  // nest under it, then ONE explicit confirm that lists the whole batch by
  // name. The confirm copy additionally calls out re-parents (ticked problems
  // that already have a parent get MOVED) and same-code picks (probably a
  // duplicate — pointed at the right tool, but not blocked: clinical call).
  // Commits are still one confirmed POST per child (see confirmManualBatch).
  function manualSectionContent() {
    var m = _manual;
    var parentOptions = _problems
      .map(function (p) {
        return (
          '<option value="' +
          esc(p.id) +
          '"' +
          (m.parentId === p.id ? ' selected' : '') +
          '>' +
          esc(p.description + dateSuffixText(p.id)) +
          '</option>'
        );
      })
      .join('');

    var childListHtml = '';
    if (m.parentId) {
      var candidates = manualChildOptions(m.parentId, _problems, _parentIdByProblemId);
      var pi = _infoById[m.parentId];
      var tickedCount = manualSelectedChildIds().length;
      childListHtml =
        '<div class="ms-pn-man-count">' +
        candidates.length +
        ' problem' +
        (candidates.length === 1 ? '' : 's') +
        ' · ' +
        tickedCount +
        ' selected</div>' +
        '<div class="ms-pn-man-children">' +
        candidates
          .map(function (p) {
            var currentParentId = _parentIdByProblemId[p.id] || null;
            var notes = [];
            if (currentParentId) {
              notes.push(
                'currently under ' + (problemDescription(currentParentId) || 'another problem') + ' — will move'
              );
            }
            var ci = _infoById[p.id];
            if (ci && pi && ci.conceptId && ci.conceptId === pi.conceptId) {
              notes.push('same code as the parent — duplicate?');
            }
            var err = m.childErrors[p.id];
            return (
              '<label class="ms-pn-man-child-row">' +
              '<input type="checkbox" class="ms-pn-man-child-cb" data-child-id="' +
              esc(p.id) +
              '"' +
              (m.childIds[p.id] ? ' checked' : '') +
              (m.linking ? ' disabled' : '') +
              '>' +
              '<span>' +
              esc(p.description) +
              dateSuffix(p.id) +
              (notes.length ? ' <span class="ms-pn-man-child-note">(' + esc(notes.join('; ')) + ')</span>' : '') +
              '</span>' +
              (err ? '<span class="ms-pn-card-error">' + esc(err) + '</span>' : '') +
              '</label>'
            );
          })
          .join('') +
        '</div>';
    }

    var linkedHtml = _manualLinked
      .map(function (l) {
        return (
          '<div class="ms-pn-card ms-pn-card-linked">' +
          CHECK_SVG +
          ' <strong>' +
          esc(l.childDescription) +
          '</strong> is now nested under <strong>' +
          esc(l.parentDescription) +
          '</strong>. Medicus’s own list shows this after a page refresh.</div>'
        );
      })
      .join('');

    var selected = manualSelectedChildIds();
    var confirmHtml = '';
    if (m.confirming && m.parentId && selected.length) {
      var parentDesc = problemDescription(m.parentId) || '';
      var moveCount = selected.filter(function (id) {
        return !!_parentIdByProblemId[id];
      }).length;
      confirmHtml =
        '<div class="ms-pn-confirm">This will nest ' +
        selected.length +
        ' problem' +
        (selected.length === 1 ? '' : 's') +
        ' under <strong>' +
        esc(parentDesc) +
        '</strong> — each will display as a child on the problem list, not as a top-level problem:' +
        '<ul class="ms-pn-confirm-list">' +
        selected
          .map(function (id) {
            return '<li>' + esc(problemDescription(id) || id) + dateSuffix(id) + '</li>';
          })
          .join('') +
        '</ul>' +
        (moveCount > 0
          ? ' ' +
            moveCount +
            ' of these already ' +
            (moveCount === 1 ? 'has' : 'have') +
            ' a parent and will be <strong>moved</strong> to the new one.'
          : '') +
        ' There is no bulk undo; un-nesting is done in Medicus, one problem at a time.' +
        '<div class="ms-pn-confirm-actions">' +
        '<button type="button" class="ms-pn-cancel" id="ms-pn-man-cancel"' +
        (m.linking ? ' disabled' : '') +
        '>Cancel</button>' +
        '<button type="button" class="ms-pn-confirm-btn" id="ms-pn-man-confirm"' +
        (m.linking ? ' disabled' : '') +
        '>' +
        (m.linking
          ? 'Linking…'
          : 'Confirm — nest ' + selected.length + ' problem' + (selected.length === 1 ? '' : 's')) +
        '</button>' +
        '</div></div>';
    }

    var failedCount = Object.keys(m.childErrors).length;
    return (
      '<div class="ms-pn-sec-note">Your grouping, your call — no SNOMED gate.</div>' +
      '<div class="ms-pn-manual-row">Under ' +
      '<select class="ms-pn-parent-select" id="ms-pn-man-parent">' +
      '<option value=""' +
      (m.parentId ? '' : ' selected') +
      ' disabled>Choose parent…</option>' +
      parentOptions +
      '</select>' +
      ' nest:' +
      ' <button type="button" class="ms-pn-link-btn" id="ms-pn-man-link"' +
      (m.parentId && selected.length && !m.confirming && !m.linking ? '' : ' disabled') +
      '>Nest ' +
      (selected.length || '') +
      ' selected…</button>' +
      '</div>' +
      childListHtml +
      confirmHtml +
      (failedCount && !m.confirming
        ? '<div class="ms-pn-card-error">' +
          failedCount +
          ' link' +
          (failedCount === 1 ? '' : 's') +
          ' failed — the error is shown against each row; they stay ticked so you can retry.</div>'
        : '') +
      linkedHtml
    );
  }

  // Accordion section header: sans 12px/600 label, text chevron left,
  // mono count right, aria-expanded honest. One open at a time.
  function sectionHeadHtml(key, label, countText) {
    var open = _openSection === key;
    return (
      '<button type="button" class="ms-pn-sec-head" data-sec="' +
      key +
      '" aria-expanded="' +
      (open ? 'true' : 'false') +
      '">' +
      '<span class="ms-pn-sec-chevron">' +
      (open ? '▾' : '▸') +
      '</span>' +
      '<span>' +
      esc(label) +
      '</span>' +
      '<span class="ms-pn-sec-count">' +
      esc(countText) +
      '</span>' +
      '</button>'
    );
  }

  function buildHtml() {
    var header =
      '<button type="button" class="ms-pn-toggle" id="ms-pn-toggle" aria-expanded="' +
      _open +
      '">' +
      (_open ? '▾' : '▸') +
      ' Nest problems?</button>';
    if (!_open) return header;
    var body;
    if (_scanState === 'scanning') {
      body =
        '<div class="ms-pn-body"><span class="ms-pn-loading">Checking SNOMED relationships between the active problems…</span></div>';
    } else if (_scanState === 'error') {
      body =
        '<div class="ms-pn-body"><span class="ms-pn-error">' +
        esc(_scanError) +
        '</span> <button type="button" class="ms-pn-retry" id="ms-pn-retry">Retry</button></div>';
    } else if (_scanState === 'done') {
      var linkedCount =
        _suggestions.filter(function (s) {
          return s.linked;
        }).length + _manualLinked.length;
      var selectedCount = manualSelectedChildIds().length;
      var manualCountText = selectedCount > 0 ? selectedCount + ' selected' : String(_problems.length);
      body =
        '<div class="ms-pn-body">' +
        '<div class="ms-pn-summary">From SNOMED codes already on this record — nothing links without its own confirm.</div>' +
        sectionHeadHtml('suggest', 'Suggested links', String(_suggestions.length)) +
        (_openSection === 'suggest' ? '<div class="ms-pn-sec-body">' + suggestSectionContent() + '</div>' : '') +
        sectionHeadHtml('merge', 'Merge duplicate copies', String(liveMergeGroups().length)) +
        (_openSection === 'merge' ? '<div class="ms-pn-sec-body">' + mergeSectionContent() + '</div>' : '') +
        sectionHeadHtml('manual', 'Link manually', manualCountText) +
        (_openSection === 'manual' ? '<div class="ms-pn-sec-body">' + manualSectionContent() + '</div>' : '') +
        (linkedCount > 0
          ? '<div class="ms-pn-footer"><span class="ms-pn-footer-count">' +
            linkedCount +
            ' link' +
            (linkedCount === 1 ? '' : 's') +
            ' created</span> <button type="button" class="ms-pn-refresh" id="ms-pn-refresh">Refresh page</button></div>'
          : '') +
        '</div>';
    } else {
      body = '';
    }
    return header + body;
  }

  function bindEvents(el) {
    el.querySelector('#ms-pn-toggle').addEventListener('click', function () {
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
    el.querySelectorAll('.ms-pn-sec-head').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sec');
        _openSection = _openSection === key ? null : key;
        render();
      });
    });
    el.querySelector('#ms-pn-retry')?.addEventListener('click', function () {
      runScan();
    });
    el.querySelector('#ms-pn-refresh')?.addEventListener('click', function () {
      location.reload();
    });
    el.querySelectorAll('.ms-pn-parent-select[data-idx]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var s = _suggestions[Number(sel.getAttribute('data-idx'))];
        if (s) {
          s.chosenParentId = sel.value || null;
          render();
        }
      });
    });
    el.querySelector('#ms-pn-man-parent')?.addEventListener('change', function (e) {
      _manual.parentId = e.target.value || null;
      // A new parent invalidates the ticked set (candidates and cycle
      // filtering both change) and any open confirm.
      _manual.childIds = {};
      _manual.confirming = false;
      _manual.childErrors = {};
      render();
    });
    el.querySelectorAll('.ms-pn-man-child-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-child-id');
        if (cb.checked) _manual.childIds[id] = true;
        else delete _manual.childIds[id];
        _manual.confirming = false;
        render();
      });
    });
    el.querySelector('#ms-pn-man-link')?.addEventListener('click', function () {
      if (_manual.parentId && manualSelectedChildIds().length) {
        _manual.confirming = true;
        render();
      }
    });
    el.querySelector('#ms-pn-man-cancel')?.addEventListener('click', function () {
      _manual.confirming = false;
      render();
    });
    el.querySelector('#ms-pn-man-confirm')?.addEventListener('click', function () {
      confirmManualBatch();
    });
    el.querySelectorAll('.ms-pn-merge-open').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var g = _mergeGroups[Number(btn.getAttribute('data-gidx'))];
        if (g) {
          g.open = true;
          render();
        }
      });
    });
    el.querySelectorAll('.ms-pn-merge-keeper').forEach(function (radio) {
      radio.addEventListener('change', function () {
        var g = _mergeGroups[Number(radio.getAttribute('data-gidx'))];
        if (g && radio.checked) {
          g.keeperId = radio.getAttribute('data-entry-id');
          g.confirming = false;
          render();
        }
      });
    });
    el.querySelectorAll('.ms-pn-merge-review').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var g = _mergeGroups[Number(btn.getAttribute('data-gidx'))];
        if (g && removableDuplicateIds(g.entries, g.keeperId).length) {
          g.confirming = true;
          render();
        }
      });
    });
    el.querySelectorAll('.ms-pn-merge-back').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var g = _mergeGroups[Number(btn.getAttribute('data-gidx'))];
        if (g) {
          g.confirming = false;
          render();
        }
      });
    });
    el.querySelectorAll('.ms-pn-merge-reason').forEach(function (input) {
      input.addEventListener('input', function () {
        var g = _mergeGroups[Number(input.getAttribute('data-gidx'))];
        if (!g) return;
        g.reason = input.value;
        // No full re-render on every keystroke (it would drop focus
        // mid-word); just keep the confirm button's disabled state honest —
        // same discipline as problem-bulk-end's reason input.
        var btn = el.querySelector('.ms-pn-merge-confirm[data-gidx="' + input.getAttribute('data-gidx') + '"]');
        if (btn) btn.disabled = g.removing || !(g.reason || '').trim();
      });
    });
    el.querySelectorAll('.ms-pn-merge-confirm').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var g = _mergeGroups[Number(btn.getAttribute('data-gidx'))];
        if (g) confirmMergeGroup(g);
      });
    });
    el.querySelectorAll('.ms-pn-link-btn[data-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = _suggestions[Number(btn.getAttribute('data-idx'))];
        if (s && s.chosenParentId) {
          s.confirming = true;
          render();
        }
      });
    });
    el.querySelectorAll('.ms-pn-cancel[data-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = _suggestions[Number(btn.getAttribute('data-idx'))];
        if (s) {
          s.confirming = false;
          render();
        }
      });
    });
    el.querySelectorAll('.ms-pn-confirm-btn[data-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = _suggestions[Number(btn.getAttribute('data-idx'))];
        if (s) confirmLink(s);
      });
    });
  }

  // Rebuilds ONLY .ms-pn-root — the polite live region is a persistent
  // sibling so announcements survive re-renders. Focus is captured before the
  // rebuild and restored to the equivalent element after (an innerHTML swap
  // otherwise dumps keyboard users back to <body>).
  function render() {
    var el = document.getElementById('ms-pn-widget');
    if (!el) return;
    var root = el.querySelector('.ms-pn-root');
    if (!root) return;
    var focusKey = captureFocusKey(el);
    root.innerHTML = buildHtml();
    bindEvents(el);
    restoreFocusKey(el, focusKey);
  }

  // ── Injection: one "Nest problems?" trigger — same anchor discipline as
  // problem-bulk-end.js (Major-problems list, first-row fallback). ─────────────
  function findProblemRow(description) {
    var links = document.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      if ((links[i].textContent || '').trim() === description) return links[i];
    }
    return null;
  }

  function findFirstProblemRow(problems) {
    for (var i = 0; i < problems.length; i++) {
      var row = findProblemRow(problems[i].problemCodeDescription);
      if (row) return row;
    }
    return null;
  }

  function findMajorProblemsList() {
    return document.querySelector('ul[aria-labelledby="problems-major-label"]');
  }

  function injectTrigger() {
    if (document.getElementById('ms-pn-widget')) return;
    if (!_problemsCache || _problemsCache.length < 2) return; // nesting needs at least two problems
    // Wrong-patient guard for bridge-derived contexts: the fetched list must
    // match at least one on-screen row before the widget offers itself — a
    // stale bridge attribute produces rows that match nothing, and the
    // widget simply stays away.
    if (_contextViaBridge && !findFirstProblemRow(_problemsCache)) return;
    var list = findMajorProblemsList();
    if (!list) {
      var row = findFirstProblemRow(_problemsCache);
      if (!row) return;
      list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    }
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-pn-widget';
    w.innerHTML = '<div class="ms-pn-live" role="status" aria-live="polite"></div><div class="ms-pn-root"></div>';
    w.querySelector('.ms-pn-root').innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Cheap summary fetch + re-injection — same observer-hub/throttle/own-
  // mutation pattern as problem-bulk-end.js, extended with the split-page
  // patient resolution. ────────────────────────────────────────────────────────
  var _fetchInFlight = false;

  async function ensureProblemsLoaded() {
    var info = getPatientInfo();
    var viaBridge = false;
    if (!info) {
      var task = getTaskInfo();
      if (task) {
        var resolvedPatientId = await resolveTaskPatientId(task);
        var nowTask = getTaskInfo();
        if (!resolvedPatientId || !nowTask || nowTask.taskUuid !== task.taskUuid) return;
        info = { siteId: task.siteId, patientId: resolvedPatientId };
      } else {
        // Any other page shape (appointment view, consultation view, …):
        // the page-world bridge tells us which patient the page's own
        // embedded Clinical Summary panel was last fetched for. Guarded
        // downstream: a bridge-derived context must ALSO match at least one
        // on-screen problem row before the widget injects (injectTrigger).
        var bridged = parseSummaryBridgeAttr(document.documentElement.getAttribute('data-ch-summary-patient'));
        if (!bridged) return;
        info = { siteId: null, patientId: bridged };
        viaBridge = true;
      }
    }
    _contextViaBridge = viaBridge;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForPatient();
    }
    if (!_problemsCache && !_fetchInFlight) {
      _fetchInFlight = true;
      var requestedPatientId = info.patientId;
      try {
        var fetched = await fetchClinicalSummaryProblems(info.patientId);
        if (_lastPatientId === requestedPatientId) _problemsCache = fetched;
      } catch (_) {
        if (_lastPatientId === requestedPatientId) _problemsCache = [];
      } finally {
        _fetchInFlight = false;
      }
    }
    if (_problemsCache) injectTrigger();
  }

  var _throttle = null;
  function scheduleScan() {
    if (_throttle) return;
    _throttle = setTimeout(function () {
      _throttle = null;
      if (!document.hidden) ensureProblemsLoaded();
    }, 400);
  }

  function _isOwnMutation(mutations) {
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-pn-widget')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-pn-widget') continue;
          if (n.closest && n.closest('#ms-pn-widget')) continue;
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

  // Safety-net periodic rescan — same rationale as allergy-cleanup.js's.
  setInterval(function () {
    if (!document.hidden) scheduleScan();
  }, 5000);
})();
