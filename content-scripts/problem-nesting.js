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
//     parent, so a wrong link visually demotes a live clinical problem. Every
//     link is therefore an individual, explicit, per-pair confirm (child and
//     parent echoed back by name) — no bulk apply, no select-all, nothing
//     pre-chosen except a single-option default the clinician still confirms.
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

  // Parent options for the MANUAL link builder: any OTHER problem the chosen
  // child could be nested under without creating a loop. Deliberately looser
  // than buildNestingSuggestions — no SNOMED gate, no same-concept exclusion,
  // and already-parented problems are valid PARENTS (a parent can itself have
  // a parent; the hierarchy is confirmed multi-level) — because here the
  // clinician is making the call, not the terminology. The cycle guard is the
  // one rule that stays hard: it protects the record's structure, not a
  // judgement call.
  function manualParentOptions(childId, problems, parentIdByProblemId) {
    if (!childId) return [];
    return (Array.isArray(problems) ? problems : []).filter(function (p) {
      if (!p || !p.id || p.id === childId) return false;
      return !wouldCreateCycle(childId, p.id, parentIdByProblemId || {});
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
      manualParentOptions: manualParentOptions,
      apiErrorMessage: apiErrorMessage,
      resultContainsConceptId: resultContainsConceptId,
      parseCareRecordPath: parseCareRecordPath,
      parseTaskOverviewPath: parseTaskOverviewPath,
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
  var _problemsCache = null;
  var _open = false;
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
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
  // Manual link builder state + this-session committed manual links
  // ([{childDescription, parentDescription}], display only).
  var _manual = { childId: null, parentId: null, confirming: false, linking: false, linkError: null };
  var _manualLinked = [];

  function resetForPatient() {
    _problemsCache = null;
    _open = false;
    _scanState = 'idle';
    _scanError = null;
    _suggestions = [];
    _parentIdByProblemId = {};
    _problems = [];
    _infoById = {};
    _manual = { childId: null, parentId: null, confirming: false, linking: false, linkError: null };
    _manualLinked = [];
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
    } catch (err) {
      s.linkError = (err && err.message) || 'Failed to link — please try again.';
    } finally {
      s.linking = false;
      render();
    }
  }

  async function confirmManualLink() {
    var m = _manual;
    if (m.linking || !m.childId || !m.parentId) return;
    var child = _problems.find(function (p) {
      return p.id === m.childId;
    });
    var parent = _problems.find(function (p) {
      return p.id === m.parentId;
    });
    if (!child || !parent) return;
    m.linking = true;
    m.linkError = null;
    render();
    try {
      await commitParentLink(m.childId, m.parentId);
      _manualLinked.push({ childDescription: child.description, parentDescription: parent.description });
      // Keep the child's info honest so a suggestion card for it (if any)
      // retires, and reset the builder for the next link.
      if (_infoById[m.childId]) _infoById[m.childId].parentProblemId = m.parentId;
      _manual = { childId: null, parentId: null, confirming: false, linking: false, linkError: null };
    } catch (err) {
      m.linkError = (err && err.message) || 'Failed to link — please try again.';
      m.linking = false;
      m.confirming = false;
    } finally {
      render();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function cardHtml(s, idx) {
    if (s.linked) {
      return (
        '<div class="ms-pn-card ms-pn-card-linked">✓ <strong>' +
        esc(s.childDescription) +
        '</strong> is now nested under <strong>' +
        esc(s.linkedParentDescription) +
        '</strong>. Medicus’s own list shows this after a page refresh.</div>'
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
    // Options are re-filtered against the LIVE link map on every render, so a
    // link committed on another card can retire a now-cyclic option here.
    var liveOptions = s.parentOptions.filter(function (o) {
      return !wouldCreateCycle(s.childId, o.id, _parentIdByProblemId);
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
      picker =
        'child of <strong>' +
        esc(liveOptions[0].description) +
        '</strong>' +
        '<input type="hidden" data-idx="' +
        idx +
        '">';
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
              esc(o.description) +
              '</option>'
            );
          })
          .join('') +
        '</select>';
    }
    var body =
      '<div class="ms-pn-card-main"><strong>' +
      esc(s.childDescription) +
      '</strong> — SNOMED marks this as a ' +
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

  function problemDescription(problemId) {
    var p = _problems.find(function (x) {
      return x.id === problemId;
    });
    return p ? p.description : null;
  }

  // The manual link builder — the clinician's own pairing, no SNOMED gate.
  // Same per-link explicit confirm and the same commit path as the suggestion
  // cards; the confirm copy additionally calls out a re-parent (moving a
  // problem that already has a parent) and a same-code pair (probably a
  // duplicate — pointed at the right tool, but not blocked: clinical call).
  function manualHtml() {
    var m = _manual;
    var childOptions = _problems
      .map(function (p) {
        var currentParentId = _parentIdByProblemId[p.id] || null;
        var currentParentDesc = currentParentId ? problemDescription(currentParentId) : null;
        return (
          '<option value="' +
          esc(p.id) +
          '"' +
          (m.childId === p.id ? ' selected' : '') +
          '>' +
          esc(p.description) +
          (currentParentDesc ? ' (currently under ' + esc(currentParentDesc) + ')' : '') +
          '</option>'
        );
      })
      .join('');
    var parentOpts = manualParentOptions(m.childId, _problems, _parentIdByProblemId);
    var parentOptions = parentOpts
      .map(function (p) {
        return (
          '<option value="' +
          esc(p.id) +
          '"' +
          (m.parentId === p.id ? ' selected' : '') +
          '>' +
          esc(p.description) +
          '</option>'
        );
      })
      .join('');

    var linkedHtml = _manualLinked
      .map(function (l) {
        return (
          '<div class="ms-pn-card ms-pn-card-linked">✓ <strong>' +
          esc(l.childDescription) +
          '</strong> is now nested under <strong>' +
          esc(l.parentDescription) +
          '</strong>. Medicus’s own list shows this after a page refresh.</div>'
        );
      })
      .join('');

    var confirmHtml = '';
    if (m.confirming && m.childId && m.parentId) {
      var childDesc = problemDescription(m.childId) || '';
      var parentDesc = problemDescription(m.parentId) || '';
      var currentParent = _parentIdByProblemId[m.childId] || null;
      var moveNote = '';
      if (currentParent) {
        moveNote =
          ' It is currently nested under <strong>' +
          esc(problemDescription(currentParent) || 'another problem') +
          '</strong> — confirming MOVES it to the new parent.';
      }
      var ci = _infoById[m.childId];
      var pi = _infoById[m.parentId];
      var sameCodeNote =
        ci && pi && ci.conceptId && ci.conceptId === pi.conceptId
          ? ' Both problems carry the SAME SNOMED code — if these are duplicate entries rather than parent/child, ' +
            'the Duplicate Problem Checker is the better tool; nesting keeps both active.'
          : '';
      confirmHtml =
        '<div class="ms-pn-confirm">This will nest <strong>' +
        esc(childDesc) +
        '</strong> under <strong>' +
        esc(parentDesc) +
        '</strong> — it will display as a child on the problem list, not as a top-level problem.' +
        moveNote +
        sameCodeNote +
        ' There is no bulk undo; un-nesting is done in Medicus, one problem at a time.' +
        '<div class="ms-pn-confirm-actions">' +
        '<button type="button" class="ms-pn-cancel" id="ms-pn-man-cancel"' +
        (m.linking ? ' disabled' : '') +
        '>Cancel</button>' +
        '<button type="button" class="ms-pn-confirm-btn" id="ms-pn-man-confirm"' +
        (m.linking ? ' disabled' : '') +
        '>' +
        (m.linking ? 'Linking…' : 'Confirm — nest it') +
        '</button>' +
        '</div></div>';
    }

    return (
      '<div class="ms-pn-manual">' +
      '<div class="ms-pn-manual-title">Link manually</div>' +
      '<div class="ms-pn-manual-note">Your pairing, your call — no SNOMED gate. Pick the problem to nest, then its parent.</div>' +
      '<div class="ms-pn-manual-row">Nest ' +
      '<select class="ms-pn-parent-select" id="ms-pn-man-child">' +
      '<option value=""' +
      (m.childId ? '' : ' selected') +
      ' disabled>Choose problem…</option>' +
      childOptions +
      '</select>' +
      ' under ' +
      '<select class="ms-pn-parent-select" id="ms-pn-man-parent"' +
      (m.childId ? '' : ' disabled') +
      '>' +
      '<option value=""' +
      (m.parentId ? '' : ' selected') +
      ' disabled>Choose parent…</option>' +
      parentOptions +
      '</select>' +
      ' <button type="button" class="ms-pn-link-btn" id="ms-pn-man-link"' +
      (m.childId && m.parentId && !m.confirming ? '' : ' disabled') +
      '>Nest…</button>' +
      '</div>' +
      confirmHtml +
      (m.linkError ? '<div class="ms-pn-card-error">' + esc(m.linkError) + '</div>' : '') +
      linkedHtml +
      '</div>'
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
      var suggestionsHtml;
      if (_suggestions.length === 0) {
        suggestionsHtml =
          '<div class="ms-pn-empty">No nesting suggestions — no active problem is coded as a SNOMED descendant of ' +
          'another problem on this record. You can still link problems yourself below.</div>';
      } else {
        suggestionsHtml =
          '<div class="ms-pn-summary">Suggestions come only from SNOMED parent/child relationships between problems ' +
          'already coded on this record — nothing is ever linked automatically, and each link needs its own confirm. ' +
          'Problems that already have a parent are left alone.</div>' +
          _suggestions
            .map(function (s, i) {
              return cardHtml(s, i);
            })
            .join('');
      }
      var linkedCount =
        _suggestions.filter(function (s) {
          return s.linked;
        }).length + _manualLinked.length;
      body =
        '<div class="ms-pn-body">' +
        suggestionsHtml +
        manualHtml() +
        (linkedCount > 0
          ? '<div class="ms-pn-footer">' +
            linkedCount +
            ' link' +
            (linkedCount === 1 ? '' : 's') +
            ' created. <button type="button" class="ms-pn-refresh" id="ms-pn-refresh">Refresh page</button></div>'
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
    el.querySelector('#ms-pn-man-child')?.addEventListener('change', function (e) {
      _manual.childId = e.target.value || null;
      // A new child invalidates the old parent pick (it may now be the child
      // itself, or cycle-filtered out) and any open confirm.
      _manual.parentId = null;
      _manual.confirming = false;
      _manual.linkError = null;
      render();
    });
    el.querySelector('#ms-pn-man-parent')?.addEventListener('change', function (e) {
      _manual.parentId = e.target.value || null;
      _manual.confirming = false;
      _manual.linkError = null;
      render();
    });
    el.querySelector('#ms-pn-man-link')?.addEventListener('click', function () {
      if (_manual.childId && _manual.parentId) {
        _manual.confirming = true;
        render();
      }
    });
    el.querySelector('#ms-pn-man-cancel')?.addEventListener('click', function () {
      _manual.confirming = false;
      render();
    });
    el.querySelector('#ms-pn-man-confirm')?.addEventListener('click', function () {
      confirmManualLink();
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

  function render() {
    var el = document.getElementById('ms-pn-widget');
    if (!el) return;
    el.innerHTML = buildHtml();
    bindEvents(el);
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
    var list = findMajorProblemsList();
    if (!list) {
      var row = findFirstProblemRow(_problemsCache);
      if (!row) return;
      list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    }
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-pn-widget';
    w.innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Cheap summary fetch + re-injection — same observer-hub/throttle/own-
  // mutation pattern as problem-bulk-end.js, extended with the split-page
  // patient resolution. ────────────────────────────────────────────────────────
  var _fetchInFlight = false;

  async function ensureProblemsLoaded() {
    var info = getPatientInfo();
    if (!info) {
      var task = getTaskInfo();
      if (!task) return;
      var resolvedPatientId = await resolveTaskPatientId(task);
      var nowTask = getTaskInfo();
      if (!resolvedPatientId || !nowTask || nowTask.taskUuid !== task.taskUuid) return;
      info = { siteId: task.siteId, patientId: resolvedPatientId };
    }
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
