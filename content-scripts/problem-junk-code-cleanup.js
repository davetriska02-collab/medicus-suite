// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk remove?" widget for administrative-noise problem codes.
//
// GP2GP-imported records can carry entries in the problem list that are not
// clinical problems at all — administrative/claim-processing artefacts some
// source systems file as problems (the motivating real example: FP10
// temporary-resident-claim codes, filed under SNOMED 14734007 "Administrative
// procedure"). This widget finds every ACTIVE problem whose own SNOMED code
// EXACTLY MATCHES or is a DESCENDANT of any root conceptId listed in
// rules/non-problem-root-codes.json, and offers a one-click bulk "end
// problem" action with a fixed reason ("not a problem"), rather than
// requiring the clinician to open and end each one individually via
// Medicus's own UI.
//
// ROOT LIST IS DATA, NOT CODE (explicit, 2026-07-24): 14734007 is the first
// entry, not a hardcoded special case — rules/non-problem-root-codes.json
// holds the full list, following the same "edit the JSON, no code change"
// convention as rules/drug-rules.json etc. Add a new root there (a different
// GP2GP-noise category, a different source system's import artefact, …) and
// every patient's problem list gets checked against it too, with no extra
// fetch cost per additional root — see the DETECTION section below for why
// all configured roots are checked in ONE combined query, not one query per
// root.
//
// CONFIRMED CONTRACT (live capture, 2026-07-23, HAR of a real "end problem"
// action) — see the user-supplied HAR for the full capture:
//
//   GET  /clinical/data/clinical-summary/summary/{patientId}
//        → { problems: [{ id, problemCodeDescription, … }] } — same cheap
//        list problem-description-cleanup.js already uses; never carries a
//        conceptId, text only.
//   GET  /clinical/data/problem/slideover/overview/{problemId}
//        → { problemCode: {conceptId, description, descriptionId, …}, … } —
//        the cheapest confirmed way to get a problem's own conceptId.
//   GET  /clinical/data/problem/end-problem/{problemId}
//        → { problemId, activeChildProblems: [...], patientId } — the
//        end-problem form prefill; a non-empty activeChildProblems means
//        ending this one has real consequences for dependent problems, so
//        it's excluded from bulk selection (checkbox disabled) rather than
//        blindly bulk-ended.
//   POST /clinical/problem/end-problem
//        body: { problemId, endDate, reason } → 200 {}
//        — deliberately NOT a full-record replace like edit-problem's POST;
//        confirmed via the real captured request/response, this one only
//        ever needs these three fields.
//
// DETECTION (confirmed live 2026-07-23, see chat history, not guessed): the
// SAME `clinical/gb/snomed/search/description/constrained` endpoint already
// used by problem-description-cleanup.js/shared/coding-specificity.js, with
// `constrainingParentConcepts=<all configured roots, comma-joined>&query=
// <conceptId>` (a bare SCTID, not free text) — if the response contains a
// result matching that conceptId, it IS a descendant of at least one
// configured root (Medicus stores the full ancestor closure on the coded
// entry itself, confirmed reaching 5 hierarchy levels deep for the real
// FP10/temporary-resident codes that motivated this feature — see the
// "claim"/"FP10"/"temporary resident" queries in chat). Passing every root as
// ONE comma-joined list (the same multi-concept-scope pattern
// problem-description-cleanup.js's own SEARCH_PATH already relies on) means
// adding another root to the JSON file costs nothing extra per candidate —
// still exactly one fetch per distinct conceptId on the patient's problem
// list, never one fetch per (candidate × root) pair. A candidate's own
// conceptId is also checked directly against the root list (no fetch needed)
// so a problem coded AS a root itself, not just a descendant of one, is
// still caught.
//
// A blank-query fetch (used elsewhere in this codebase to enumerate a WHOLE
// descendant set up front) was deliberately NOT used here: 14734007
// ("Administrative procedure") alone has 103 direct children per the SNOMED
// CT browser, and the blank-query endpoint caps out at ~20 results with no
// pagination — enumerating any root's full descendant set up front would
// silently miss most of it. Checking each patient's OWN problem conceptId
// individually (this file's approach) never hits that cap, and scales to
// however many roots get added later.
//
// SCOPE DECISION (explicit, 2026-07-23): the scan (one fetch per ACTIVE
// problem to get its conceptId, plus one per distinct conceptId to test
// descendant status) runs ONLY when the clinician clicks "Bulk remove?" —
// never proactively on page load. Cost was judged too high to run on every
// patient view of Clinical Summary for what's a comparatively rare
// bulk-import artefact; the cheap clinical-summary fetch (description text
// only, no conceptId) still happens on page load same as
// problem-description-cleanup.js already does, only to place the trigger
// button — no per-problem cost until the explicit click.
//
// Checkboxes default UNCHECKED (explicit, 2026-07-23) — the descendant match
// is a soft hierarchy signal, not a guarantee every flagged item is genuinely
// non-clinical, so nothing is ever pre-ticked. A "Select all" convenience
// exists, but it deliberately SKIPS any row attributed to a root carrying a
// `caution` in rules/non-problem-root-codes.json (2026-07-26: referrals, EDD,
// administrative statuses — categories that are usually import noise but can
// be LIVE clinical flags, e.g. an in-flight 2WW referral). Cautioned rows
// render a per-row ⚠ warning and must be reviewed and ticked individually;
// a row whose caution attribution could not be verified (fetch failure) is
// treated as cautioned, never as clean.
//
// NO TEXT-BASED VISIBILITY GATE (explicit, 2026-07-25 — tried and reverted
// same day): a text-substring pre-check on the trigger button's visibility
// was built and shipped, then reverted before ever reaching a release, once
// live testing showed it could hide a GENUINE code-based match — a problem
// correctly coded as a descendant of a configured root, but whose free-text
// description didn't happen to contain any of the configured hint words (the
// real motivating case: "FP/RF - new reg.check to FPC" needed a hint added
// after the fact just to make the button appear at all). The code is the
// ground truth for this widget, never the text — a problem miscoded under a
// junk root MUST always be reachable for the clinician to consider, however
// unrelated its free text looks. Storing the full descendant tree locally to
// make an automatic scan cheap enough to run on every page load was also
// considered and rejected: the dominant cost is resolving each ACTIVE
// problem's own conceptId (one fetch per problem, unavoidable — the cheap
// list endpoint never carries one), which a stored tree does nothing for:
// only the per-distinct-conceptId descendant check would get cheaper. The
// trigger button therefore always renders whenever the patient has ANY
// active problems, same as the original v3.183.0 behaviour, so the
// authoritative SNOMED-based scan is always one click away.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  var REASON_NOT_A_PROBLEM = 'not a problem';

  // Builds the ONE comma-joined constrainingParentConcepts value covering
  // EVERY configured root — see the header comment for why this is a single
  // combined query rather than one per root. Skips any entry with no
  // conceptId rather than erroring, so a malformed rules-file entry can't
  // take the whole check down.
  function rootConceptIdsCsv(roots) {
    if (!Array.isArray(roots)) return '';
    return roots
      .map(function (r) {
        return r && r.conceptId;
      })
      .filter(Boolean)
      .join(',');
  }

  // The search response shape is `{results:[{label, value:{conceptId, …}}]}`
  // (confirmed live, same shape used throughout shared/coding-specificity.js)
  // — tolerates an already-unwrapped `{conceptId}` item too, defensively.
  function resultContainsConceptId(results, conceptId) {
    if (!Array.isArray(results) || !conceptId) return false;
    return results.some(function (r) {
      var v = (r && r.value) || r;
      return !!(v && v.conceptId === conceptId);
    });
  }

  // A candidate is flagged if its OWN conceptId matches a configured root
  // exactly (checked client-side, no fetch needed — a problem coded AS
  // "Administrative procedure" itself, not just a descendant of it, should
  // still be caught) OR the descendant-search response found it under the
  // combined root set (see rootConceptIdsCsv).
  function isFlaggedConceptId(conceptId, roots, descendantSearchResults) {
    if (!conceptId) return false;
    var isRootItself = (roots || []).some(function (r) {
      return r && r.conceptId === conceptId;
    });
    return isRootItself || resultContainsConceptId(descendantSearchResults, conceptId);
  }

  function buildEndProblemPayload(problemId, endDate, reason) {
    return { problemId: problemId, endDate: endDate, reason: reason };
  }

  // A flagged entry is safe to bulk-end when it hasn't already been ended
  // this session AND the end-problem form reported no active child problems
  // (see the header comment on why that specifically excludes it, not just
  // warns).
  function isEndable(entry) {
    return !!entry && !entry.ended && (entry.activeChildCount || 0) === 0;
  }

  // Roots that carry a per-root `caution` (see the rules file's notes):
  // categories that are usually import noise but can be live clinical flags.
  // "Select all" never ticks a row attributed to one of these.
  function cautionRootsOf(roots) {
    return (Array.isArray(roots) ? roots : []).filter(function (r) {
      return !!(r && r.conceptId && typeof r.caution === 'string' && r.caution);
    });
  }

  // Narrows clinical-summary/summary's `problems[]` down to just
  // {id, description, conceptId} once each has been resolved via the
  // per-problem overview fetch — drops any whose conceptId couldn't be read
  // rather than guessing.
  function withResolvedConceptIds(problems, overviews) {
    var out = [];
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var ov = overviews[i];
      var code = ov && ov.problemCode;
      var conceptId = code && code.conceptId;
      if (p && conceptId) {
        out.push({ id: p.id, description: p.problemCodeDescription, conceptId: conceptId });
      }
    }
    return out;
  }

  function uniqueConceptIds(withConcept) {
    var seen = [];
    withConcept.forEach(function (p) {
      if (seen.indexOf(p.conceptId) === -1) seen.push(p.conceptId);
    });
    return seen;
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      REASON_NOT_A_PROBLEM: REASON_NOT_A_PROBLEM,
      rootConceptIdsCsv: rootConceptIdsCsv,
      resultContainsConceptId: resultContainsConceptId,
      isFlaggedConceptId: isFlaggedConceptId,
      buildEndProblemPayload: buildEndProblemPayload,
      isEndable: isEndable,
      cautionRootsOf: cautionRootsOf,
      withResolvedConceptIds: withResolvedConceptIds,
      uniqueConceptIds: uniqueConceptIds,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msProblemJunkCleanup) return;
  window.__msProblemJunkCleanup = true;

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

  // ── URL detection — identical to problem-description-cleanup.js's copy ───────
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

  function fetchProblemOverview(problemId) {
    return apiFetch('/clinical/data/problem/slideover/overview/' + encodeURIComponent(problemId));
  }

  function fetchEndProblemForm(problemId) {
    return apiFetch('/clinical/data/problem/end-problem/' + encodeURIComponent(problemId));
  }

  // rootsCsv is the ONE combined constrainingParentConcepts value covering
  // every configured root (rootConceptIdsCsv) — a single fetch tests a
  // candidate against the whole rules-file list at once.
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

  // Loads rules/non-problem-root-codes.json ONCE per page load — a local
  // extension resource, not a Medicus call. Falls back to an empty root list
  // (never throws) if the resource is somehow unavailable — the widget then
  // simply never flags anything rather than erroring, same "fail open to
  // inert, not to a crash" discipline as document-file-inline.js's
  // ensureDocumentTypesLoaded().
  var _rootsPromise = null;
  function ensureNonProblemRootsLoaded() {
    if (_rootsPromise) return _rootsPromise;
    _rootsPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/non-problem-root-codes.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.roots) ? doc.roots : [];
      } catch (e) {
        return [];
      }
    })();
    return _rootsPromise;
  }

  function postEndProblem(problemId, endDate, reason) {
    return apiFetch('/clinical/problem/end-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEndProblemPayload(problemId, endDate, reason)),
    });
  }

  // ── DOM: finding a problem's row — identical discipline to
  // problem-description-cleanup.js's findProblemRow (see that file's comment
  // for the duplicate-description-text edge case claimedAnchors guards
  // against). ──────────────────────────────────────────────────────────────────
  function findProblemRow(description, claimedAnchors) {
    var links = document.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (claimedAnchors && claimedAnchors.has(a)) continue;
      if ((a.textContent || '').trim() === description) return a;
    }
    return null;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var _lastPatientId = null;
  var _problemsCache = null; // problems[] for _lastPatientId, refetched on patient change
  var _open = false;
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
  var _flagged = []; // [{ id, description, conceptId, activeChildCount, anchorEl, caution, checked, ended, endError }]
  var _rootLabels = []; // descriptions of the configured roots, for the summary copy — never hardcode a root's name
  var _endDate = todayISO();
  var _ending = false;

  function resetForPatient() {
    _problemsCache = null;
    _open = false;
    _scanState = 'idle';
    _scanError = null;
    _flagged = [];
    _rootLabels = [];
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
      var roots = await ensureNonProblemRootsLoaded();
      if (!roots.length)
        throw new Error('No non-problem code rules are configured (rules/non-problem-root-codes.json).');
      var rootsCsv = rootConceptIdsCsv(roots);
      _rootLabels = roots
        .map(function (r) {
          return r && r.description;
        })
        .filter(Boolean);
      var problems = _problemsCache || [];
      var overviews = await Promise.all(
        problems.map(function (p) {
          return fetchProblemOverview(p.id).catch(function () {
            return null;
          });
        })
      );
      var withConcept = withResolvedConceptIds(problems, overviews);
      var concepts = uniqueConceptIds(withConcept);
      var descendantResultsByConceptId = Object.create(null);
      await Promise.all(
        concepts.map(function (id) {
          return fetchDescendantSearchResults(id, rootsCsv)
            .then(function (results) {
              descendantResultsByConceptId[id] = results;
            })
            .catch(function () {
              descendantResultsByConceptId[id] = [];
            });
        })
      );
      var candidates = withConcept.filter(function (p) {
        return isFlaggedConceptId(p.conceptId, roots, descendantResultsByConceptId[p.conceptId]);
      });
      // Attribute cautioned roots per candidate. The main scan's ONE combined
      // constrained search can't say WHICH root matched, so each candidate
      // concept gets checked against each caution root individually (caution
      // roots are few and candidates are typically a handful — this only runs
      // after the explicit opt-in scan). Fail CLOSED: a candidate whose
      // caution check errors is treated as cautioned, never as clean.
      var cautionRoots = cautionRootsOf(roots);
      var cautionByConceptId = Object.create(null);
      await Promise.all(
        uniqueConceptIds(candidates).map(function (id) {
          return (async function () {
            for (var i = 0; i < cautionRoots.length; i++) {
              var root = cautionRoots[i];
              if (root.conceptId === id) {
                cautionByConceptId[id] = root.caution;
                return;
              }
              var hit;
              try {
                hit = resultContainsConceptId(await fetchDescendantSearchResults(id, root.conceptId), id);
              } catch (_) {
                cautionByConceptId[id] =
                  'Could not verify this entry against the caution list — check it individually before ending.';
                return;
              }
              if (hit) {
                cautionByConceptId[id] = root.caution;
                return;
              }
            }
          })();
        })
      );
      var endForms = await Promise.all(
        candidates.map(function (p) {
          return fetchEndProblemForm(p.id).catch(function () {
            return null;
          });
        })
      );
      var claimedAnchors = new Set();
      _flagged = candidates.map(function (p, i) {
        var form = endForms[i];
        var activeChildCount =
          (form && Array.isArray(form.activeChildProblems) && form.activeChildProblems.length) || 0;
        var anchorEl = findProblemRow(p.description, claimedAnchors);
        if (anchorEl) claimedAnchors.add(anchorEl);
        return {
          id: p.id,
          description: p.description,
          conceptId: p.conceptId,
          activeChildCount: activeChildCount,
          anchorEl: anchorEl,
          caution: cautionByConceptId[p.conceptId] || null,
          checked: false,
          ended: false,
          endError: null,
        };
      });
      _scanState = 'done';
    } catch (err) {
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to scan the problem list.';
    } finally {
      render();
    }
  }

  async function endSelected() {
    var targets = _flagged.filter(function (f) {
      return f.checked && isEndable(f);
    });
    // No end date -> no POST, ever. The button is disabled without one, but a
    // cleared date field must not slip an `endDate: ""` through to the record.
    if (!targets.length || _ending || !_endDate) return;
    _ending = true;
    render();
    var results = await Promise.allSettled(
      targets.map(function (f) {
        return postEndProblem(f.id, _endDate, REASON_NOT_A_PROBLEM);
      })
    );
    var allSucceeded = true;
    results.forEach(function (r, i) {
      var f = targets[i];
      if (r.status === 'fulfilled') {
        f.ended = true;
        f.checked = false;
        f.endError = null;
        if (f.anchorEl) f.anchorEl.classList.add('ms-pjc-anchor-ended');
      } else {
        allSucceeded = false;
        f.endError = (r.reason && r.reason.message) || 'Failed to end this problem — please try again.';
      }
    });
    _ending = false;
    render();
    // Medicus's own problem-list UI (outside this widget) doesn't reflect an
    // ended problem until the page is refreshed — confirmed live, reported by
    // the user 2026-07-26. Auto-reload ONLY when every targeted end
    // succeeded, after a brief pause so the "Ended" tags are actually visible
    // first — a failed end must stay on screen with its error message so the
    // clinician can see and retry it, not get wiped by a reload they didn't
    // ask for.
    if (allSucceeded && targets.length) {
      setTimeout(function () {
        location.reload();
      }, 900);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderChecklist() {
    var selectedCount = _flagged.filter(function (f) {
      return f.checked && isEndable(f);
    }).length;
    var rows = _flagged
      .map(function (f) {
        if (f.ended) {
          return (
            '<label class="ms-pjc-row ms-pjc-row-ended"><input type="checkbox" checked disabled>' +
            '<span class="ms-pjc-row-desc">' +
            esc(f.description) +
            '</span><span class="ms-pjc-row-tag">Ended</span></label>'
          );
        }
        var disabled = !isEndable(f);
        return (
          '<label class="ms-pjc-row' +
          (disabled ? ' ms-pjc-row-disabled' : '') +
          '">' +
          '<input type="checkbox" class="ms-pjc-checkbox" data-problem-id="' +
          esc(f.id) +
          '"' +
          (f.checked ? ' checked' : '') +
          (disabled ? ' disabled' : '') +
          '>' +
          '<span class="ms-pjc-row-desc">' +
          esc(f.description) +
          '</span>' +
          (f.activeChildCount > 0
            ? '<span class="ms-pjc-row-warn">Has linked problems — review individually in Medicus</span>'
            : '') +
          (f.caution ? '<span class="ms-pjc-row-warn">⚠ ' + esc(f.caution) + '</span>' : '') +
          (f.endError ? '<span class="ms-pjc-row-error">' + esc(f.endError) + '</span>' : '') +
          '</label>'
        );
      })
      .join('');
    var rootLabelsText = _rootLabels.length ? _rootLabels.map(esc).join('", "') : 'a configured non-problem category';
    return (
      '<div class="ms-pjc-body">' +
      '<div class="ms-pjc-summary">Found ' +
      _flagged.length +
      ' problem' +
      (_flagged.length === 1 ? '' : 's') +
      ' coded under "' +
      rootLabelsText +
      '" in SNOMED — often GP2GP import artefacts rather than real clinical ' +
      'problems, but not always: rows marked ⚠ can be live clinical flags ' +
      '(e.g. an in-flight urgent referral) and must be reviewed individually. ' +
      'Review each row before ending; nothing is ticked by default, and ' +
      '"Select all" skips ⚠ rows.</div>' +
      '<div class="ms-pjc-select-row">' +
      '<button type="button" class="ms-pjc-select-all" id="ms-pjc-select-all">Select all</button>' +
      '<button type="button" class="ms-pjc-select-none" id="ms-pjc-select-none">Select none</button>' +
      '</div>' +
      '<div class="ms-pjc-list">' +
      rows +
      '</div>' +
      '<div class="ms-pjc-end-row">' +
      '<label class="ms-pjc-label" for="ms-pjc-end-date">End date</label>' +
      '<input type="date" class="ms-pjc-date-input" id="ms-pjc-end-date" value="' +
      esc(_endDate) +
      '">' +
      '<span class="ms-pjc-reason-note">Reason: "not a problem"</span>' +
      '</div>' +
      '<button type="button" class="ms-pjc-end-btn" id="ms-pjc-end-selected"' +
      (selectedCount === 0 || _ending || !_endDate ? ' disabled' : '') +
      '>' +
      (_ending ? 'Ending…' : 'End ' + selectedCount + ' selected problem' + (selectedCount === 1 ? '' : 's')) +
      '</button>' +
      '</div>'
    );
  }

  function buildHtml() {
    var header =
      '<button type="button" class="ms-pjc-toggle" id="ms-pjc-toggle" aria-expanded="' +
      _open +
      '">' +
      (_open ? '▾' : '▸') +
      ' Bulk remove?</button>';
    if (!_open) return header;
    var body;
    if (_scanState === 'scanning') {
      body = '<div class="ms-pjc-body"><span class="ms-pjc-loading">Scanning problems…</span></div>';
    } else if (_scanState === 'error') {
      body =
        '<div class="ms-pjc-body"><span class="ms-pjc-error">' +
        esc(_scanError) +
        '</span> <button type="button" class="ms-pjc-retry" id="ms-pjc-retry">Retry</button></div>';
    } else if (_scanState === 'done' && _flagged.length === 0) {
      body =
        '<div class="ms-pjc-body"><span class="ms-pjc-empty">No administrative/non-clinical codes found in ' +
        'the problem list.</span></div>';
    } else if (_scanState === 'done') {
      body = renderChecklist();
    } else {
      body = '';
    }
    return header + body;
  }

  function bindEvents(el) {
    el.querySelector('#ms-pjc-toggle').addEventListener('click', function () {
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
    el.querySelector('#ms-pjc-retry')?.addEventListener('click', function () {
      runScan();
    });
    el.querySelectorAll('.ms-pjc-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-problem-id');
        var f = _flagged.find(function (x) {
          return x.id === id;
        });
        if (f) f.checked = cb.checked;
        render();
      });
    });
    el.querySelector('#ms-pjc-select-all')?.addEventListener('click', function () {
      _flagged.forEach(function (f) {
        // Cautioned rows are never swept up by Select all — see header comment.
        if (isEndable(f) && !f.caution) f.checked = true;
      });
      render();
    });
    el.querySelector('#ms-pjc-select-none')?.addEventListener('click', function () {
      _flagged.forEach(function (f) {
        f.checked = false;
      });
      render();
    });
    el.querySelector('#ms-pjc-end-date')?.addEventListener('input', function (e) {
      _endDate = e.target.value;
    });
    el.querySelector('#ms-pjc-end-selected')?.addEventListener('click', function () {
      endSelected();
    });
  }

  function render() {
    var el = document.getElementById('ms-pjc-widget');
    if (!el) return;
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  // ── Injection: one "Bulk remove?" trigger, next to the "Major" heading ───────
  // (placement confirmed live 2026-07-25, resuming the item deferred from the
  // original v3.183.0 build): the Active Problems card renders as
  // `.m-card-v2__content > h3#problems-major-label, ul[aria-labelledby=
  // "problems-major-label"], …` — "Major" is a SECTION HEADING for the whole
  // major-problems <ul>, not a per-problem badge. Anchoring on that heading's
  // own <ul> (rather than "whichever list holds the first cached problem",
  // the old approach) means the widget lands next to "Major" specifically
  // even when the first problem in clinical-summary's own list order happens
  // to be a minor one. `problems-minor-label` is INFERRED by naming symmetry,
  // never observed live (this capture's patient had no minor problems) — not
  // relied on here, only used as a documented assumption for future readers.

  function findFirstProblemRow(problems) {
    for (var i = 0; i < problems.length; i++) {
      var row = findProblemRow(problems[i].problemCodeDescription, null);
      if (row) return row;
    }
    return null;
  }

  function findMajorProblemsList() {
    return document.querySelector('ul[aria-labelledby="problems-major-label"]');
  }

  function injectTrigger() {
    if (document.getElementById('ms-pjc-widget')) return;
    if (!_problemsCache || !_problemsCache.length) return;
    var list = findMajorProblemsList();
    if (!list) {
      // Fallback for the shape not (yet) confirmed live: no "Major" heading
      // on the page at all (e.g. every active problem is minor) — anchor on
      // whichever list holds the first cached problem, same as before this
      // placement change, rather than not injecting at all.
      var row = findFirstProblemRow(_problemsCache);
      if (!row) return;
      list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    }
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-pjc-widget';
    w.innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Scan (cheap summary fetch) + re-injection ─────────────────────────────────
  // Same discipline as problem-description-cleanup.js: re-check on every
  // mutation tick since Vue re-renders strip foreign nodes, throttled,
  // own-mutation-filtered. Only the cheap clinical-summary fetch (text only,
  // no conceptId) runs here — the expensive per-problem scan is opt-in, see
  // runScan() above.
  var _fetchInFlight = false;

  async function ensureProblemsLoaded() {
    var info = getPatientInfo();
    if (!info) return;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForPatient();
    }
    if (!_problemsCache && !_fetchInFlight) {
      // WRONG-PATIENT RACE (audit 2026-07-27, Critical) — see the same guard in
      // content-scripts/problem-bulk-end.js for the full sequence. In short: an
      // in-flight fetch for patient A makes patient B skip its own fetch, and
      // A's response was then cached with no re-check, so this widget could
      // flag (and bulk-end) problems belonging to a patient nobody was viewing.
      var pid = info.patientId;
      _fetchInFlight = true;
      var fetched;
      try {
        fetched = await fetchClinicalSummaryProblems(pid);
      } catch (_) {
        fetched = [];
      } finally {
        _fetchInFlight = false;
      }
      if (pid !== _lastPatientId) return;
      _problemsCache = fetched;
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
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-pjc-widget')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-pjc-widget') continue;
          if (n.closest && n.closest('#ms-pjc-widget')) continue;
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
