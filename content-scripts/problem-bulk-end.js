// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk remove?" widget for the Clinical Summary problem list
//
// PURPOSE (user request 2026-07-27, refined same day): busy problem lists
// carry many problems that plainly need ending, and Medicus's own UI makes
// that one dialog per problem. Click "Bulk remove?" and a checkbox appears
// INLINE next to EVERY active problem in the live list — tick the ones to
// retire, review, confirm, and they're ended in one batch.
//
// MERGE HISTORY (explicit, 2026-07-27): this widget started life as TWO
// sibling triggers sharing the "Major" heading row —
//   - "Bulk remove?" (problem-junk-code-cleanup.js, v3.183.0): GATED to
//     problems coded under the admin/non-clinical SNOMED roots in
//     rules/non-problem-root-codes.json, panel checklist of flagged rows only.
//   - "Bulk end problems" (this file, v3.194.0): every active problem, but in
//     its own panel checklist, not inline.
// User feedback the same day v3.194.0 shipped: "I'd envisage Bulk remove as
// click on it, boxes appear next to ALL problems, you can tick and retire
// them. not gated." So the two are now ONE widget under the "Bulk remove?"
// label: ungated (every active problem gets a box), inline (the boxes sit in
// Medicus's own list, not a duplicate list in a panel), with the SNOMED
// junk-code detection kept as a BADGE ("admin?") on rows it would previously
// have gated on — the detection work (root list, combined descendant query,
// caution attribution) is still valuable for telling the clinician WHICH rows
// are probably safe import noise, it just no longer decides which rows get a
// checkbox. problem-junk-code-cleanup.js/.css were retired in the merge; its
// pure helpers and their tests moved here.
//
// CONFIRMED CONTRACT (live HAR capture, 2026-07-23, of a real "end problem"
// action):
//
//   GET  /clinical/data/clinical-summary/summary/{patientId}
//        → { problems: [{ id, problemCodeDescription, … }] }
//   GET  /clinical/data/problem/slideover/overview/{problemId}
//        → { problemCode: {conceptId, …}, … } — the cheapest confirmed way to
//        get a problem's own conceptId (the summary list never carries one);
//        used ONLY by the badge scan, never needed to end a problem.
//   GET  /clinical/data/problem/end-problem/{problemId}
//        → { problemId, activeChildProblems: [...], patientId } — a non-empty
//        activeChildProblems means ending this one has real consequences for
//        dependent problems, so it's excluded from bulk selection (checkbox
//        disabled), not blindly bulk-ended.
//   POST /clinical/problem/end-problem
//        body: { problemId, endDate, reason } → 200 {}
//        — reason is a plain string; NOT a full-record replace.
//
// BADGE DETECTION (ported verbatim from the retired sibling; confirmed live
// 2026-07-23): the `clinical/gb/snomed/search/description/constrained`
// endpoint with `constrainingParentConcepts=<all configured roots,
// comma-joined>&query=<conceptId>` — a hit means the concept is a descendant
// of at least one configured root (Medicus stores the full ancestor closure
// on the coded entry). One combined query per DISTINCT conceptId, never one
// per (candidate × root) pair, so adding roots to the JSON costs nothing
// extra. A concept coded AS a root itself is caught client-side with no
// fetch. The scan runs only after the explicit "Bulk remove?" click, never
// on page load (SCOPE DECISION 2026-07-23 — too costly per patient view for
// a comparatively rare import artefact), and it runs AFTER the checklist is
// already usable: badges fill in when it completes, and a scan failure just
// means no badges, never a blocked checklist.
//
// SAFETY POSTURE (CSO review 2026-07-26, carried through the merge — every
// row here is potentially a REAL clinical problem, so this is the sharper
// knife and keeps the stricter gate):
//   - Nothing is EVER pre-ticked, and there is deliberately NO blanket
//     "Select all" — every problem must be individually reviewed and ticked.
//     The one convenience is "Select flagged", which ticks ONLY rows the
//     SNOMED badge scan flagged as admin/non-clinical AND that carry no ⚠
//     caution (cautioned categories — referrals, EDD, admin statuses — are
//     usually import noise but can be LIVE clinical flags, e.g. an in-flight
//     2WW referral; a row whose caution attribution errored is treated as
//     cautioned, never as clean — fail closed).
//   - Problems whose end-problem form reports active child problems are
//     excluded (checkbox disabled), not just warned about.
//   - TWO-STEP CONFIRM: "Review selected" first renders an explicit
//     ENDING / KEEPING summary (the duplicate-checker's house pattern for
//     "about to change the live record") with the end date and reason echoed
//     back; only the Confirm button on that summary actually POSTs.
//   - End date AND reason are guarded at BOTH layers: the buttons disable
//     without them, and endSelected() refuses to POST regardless of button
//     state (an empty endDate/reason must never reach the record).
//   - Ending is not deletion — the code stays in the record, end-dated —
//     but it removes a VISIBLE flag, and the confirm copy says so plainly.
//   - No auto-reload after success: a "Refresh page" button is offered
//     instead, so a half-typed consultation is never binned by a reload the
//     clinician didn't ask for.
//   - Every successful batch is recorded in the machine-local Clinical
//     Event Ledger (shared/event-ledger.js, source 'record', action
//     'committed', patient UUID only — the free-typed reason is NEVER
//     written to the ledger, per its no-free-text label rule).
//   - Failed POSTs surface the server's response body per row (the
//     option-object/API-400 lesson of 2026-07-27) — never a bare status.
//
// INLINE INJECTION (2026-07-27): the checkboxes live inside Medicus's own
// Vue-rendered <li> rows, so the queue-chip discipline applies (see
// CLAUDE.md): PREPEND into the row (insertBefore firstChild — Vue's
// reconciler strips trailing foreign nodes), re-inject on every mutation
// tick while the widget is open (one inject never survives the SPA's
// re-renders), keep ALL state in JS keyed by problem id (a re-render
// recreates the DOM but never loses a tick), and make injection idempotent.
// Our own inline nodes are exempted from the mutation filter so injecting
// them never re-triggers the observer loop.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  var DEFAULT_REASON = 'Resolved';

  function buildEndProblemPayload(problemId, endDate, reason) {
    return { problemId: problemId, endDate: endDate, reason: reason };
  }

  // A row is selectable for ending when it hasn't already been ended this
  // session AND its end-problem form reported no active child problems.
  function isEndable(entry) {
    return !!entry && !entry.ended && (entry.activeChildCount || 0) === 0;
  }

  // The ONE place the submit guards live: something selected, a real end
  // date, a real (non-whitespace) reason, and no batch already in flight.
  // Both the buttons' disabled state AND endSelected()'s refusal-to-POST
  // check this, so a cleared field can never slip an empty value through.
  function canSubmit(selectedCount, endDate, reason, ending) {
    return (
      selectedCount > 0 &&
      typeof endDate === 'string' &&
      endDate.length > 0 &&
      typeof reason === 'string' &&
      reason.trim().length > 0 &&
      !ending
    );
  }

  // Splits the row list for the confirm summary: what the batch will END
  // (checked + endable) vs what it will KEEP (everything else not already
  // ended this session).
  function partitionSelection(rows) {
    var ending = [];
    var keeping = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.ended) return;
      if (r.checked && isEndable(r)) ending.push(r);
      else keeping.push(r);
    });
    return { ending: ending, keeping: keeping };
  }

  // Same extraction as problem-description-cleanup.js's apiErrorMessage —
  // duplicated (not shared) the same way each content script already carries
  // its own apiFetch; see that file's comment for the rules being pinned.
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

  // ── Page-shape parsing (pure, so both URL shapes are unit-testable) ──────────

  // Care-record page: .../{siteId}/patient/patient/care-record/{patientId}
  // (same confirmed-live / by-analogy notes as problem-description-cleanup.js's
  // RECORD_URL_RE copy — see that file's URL-detection comment).
  function parseCareRecordPath(pathname) {
    var m = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i.exec(
      String(pathname == null ? '' : pathname)
    );
    if (!m) return null;
    return { siteId: m[1], patientId: m[2] };
  }

  // Task-overview ("split") page: .../{siteId}/tasks/data/{typeSlug}/overview/
  // {taskUuid} — the same shape task-inline.js/booking-inline.js already
  // match. Its embedded Clinical Summary panel renders the same problem list
  // as the care-record page, but the URL carries no patientId — that's
  // resolved via the task's own overview endpoint (resolveTaskPatientId, in
  // the browser boot).
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

  // The task-overview response's patient id — the same fallback chain
  // task-inline.js's resolvePatientId already uses (data.data.patient.id →
  // data.data.patientId → data.patient.id → data.patientId). Null when the
  // task genuinely has no patient (some task types don't).
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

  // ── Badge-scan pure helpers (ported from the retired
  // problem-junk-code-cleanup.js, 2026-07-27 merge — see header) ───────────────

  // Builds the ONE comma-joined constrainingParentConcepts value covering
  // EVERY configured root — a single combined query rather than one per
  // root. Skips any entry with no conceptId rather than erroring, so a
  // malformed rules-file entry can't take the whole check down.
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

  // A concept is flagged if it matches a configured root exactly (checked
  // client-side, no fetch needed) OR the descendant-search response found it
  // under the combined root set (see rootConceptIdsCsv).
  function isFlaggedConceptId(conceptId, roots, descendantSearchResults) {
    if (!conceptId) return false;
    var isRootItself = (roots || []).some(function (r) {
      return r && r.conceptId === conceptId;
    });
    return isRootItself || resultContainsConceptId(descendantSearchResults, conceptId);
  }

  // Roots that carry a per-root `caution` (see the rules file's notes):
  // categories that are usually import noise but can be live clinical flags.
  // "Select flagged" never ticks a row attributed to one of these.
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
      DEFAULT_REASON: DEFAULT_REASON,
      buildEndProblemPayload: buildEndProblemPayload,
      isEndable: isEndable,
      canSubmit: canSubmit,
      partitionSelection: partitionSelection,
      apiErrorMessage: apiErrorMessage,
      parseCareRecordPath: parseCareRecordPath,
      parseTaskOverviewPath: parseTaskOverviewPath,
      parseSummaryBridgeAttr: parseSummaryBridgeAttr,
      extractPatientIdFromTaskOverview: extractPatientIdFromTaskOverview,
      rootConceptIdsCsv: rootConceptIdsCsv,
      resultContainsConceptId: resultContainsConceptId,
      isFlaggedConceptId: isFlaggedConceptId,
      cautionRootsOf: cautionRootsOf,
      withResolvedConceptIds: withResolvedConceptIds,
      uniqueConceptIds: uniqueConceptIds,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msProblemBulkEnd) return;
  window.__msProblemBulkEnd = true;

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

  // ── URL detection ────────────────────────────────────────────────────────────
  // Two page shapes carry the Clinical Summary problem list this widget
  // serves: the full care-record page (patientId in the URL) and the
  // task-overview "split" page (patient resolved via the task's own overview
  // endpoint — see resolveTaskPatientId below). Both parsers are pure
  // helpers above so the regexes stay unit-tested.
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
  // (never throws) if the resource is somehow unavailable — the badge scan
  // then simply flags nothing rather than erroring ("fail open to inert, not
  // to a crash", same as document-file-inline.js's ensureDocumentTypesLoaded).
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

  // ── Split-page patient resolution ─────────────────────────────────────────────
  // The task-overview URL carries no patientId, so it's resolved ONCE per
  // task via the same overview endpoint task-inline.js/booking-inline.js
  // already drive. Cache semantics matter for safety and for chatter: a
  // RESOLVED task caches its answer per taskUuid — including null for a
  // patientless task, so it is never refetched — while a FAILED fetch caches
  // nothing, so the throttled rescan retries later. The uuid keying (not a
  // single "current" slot) means a stale resolve can never be attributed to
  // a different task the clinician has since navigated to.
  var _taskPatientIdByUuid = Object.create(null);
  var _taskPatientResolveInFlight = false;

  async function resolveTaskPatientId(task) {
    if (_taskPatientIdByUuid[task.taskUuid] !== undefined) return _taskPatientIdByUuid[task.taskUuid];
    if (_taskPatientResolveInFlight) return null; // another tick's resolve is running — this one just waits for the cache
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

  function postEndProblem(problemId, endDate, reason) {
    return apiFetch('/clinical/problem/end-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEndProblemPayload(problemId, endDate, reason)),
    });
  }

  // ── DOM: finding a problem's row — same discipline (and duplicate-text
  // claimedAnchors guard) as problem-description-cleanup.js. ───────────────────
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
  // True when the current patient context came from the page-world bridge
  // rather than a parseable URL — gates injection on a DOM row match.
  var _contextViaBridge = false;
  var _problemsCache = null;
  var _open = false;
  var _step = 'select'; // 'select' | 'confirm' | 'done'
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
  var _flagScanState = 'idle'; // 'idle' | 'running' | 'done' | 'error' — the badge scan, never blocks the checklist
  var _rows = []; // [{ id, description, activeChildCount, anchorEl, flagged, caution, checked, ended, endError }]
  var _endDate = todayISO();
  var _reason = DEFAULT_REASON;
  var _ending = false;

  function resetForPatient() {
    removeInlineCheckboxes();
    _problemsCache = null;
    _open = false;
    _step = 'select';
    _scanState = 'idle';
    _scanError = null;
    _flagScanState = 'idle';
    _rows = [];
    _endDate = todayISO();
    _reason = DEFAULT_REASON;
    _ending = false;
  }

  function selectedCount() {
    return _rows.filter(function (r) {
      return r.checked && isEndable(r);
    }).length;
  }

  function flaggedRows() {
    return _rows.filter(function (r) {
      return r.flagged;
    });
  }

  // ── Scan (opt-in — only ever runs from the "Bulk remove?" click) ─────────────
  async function runScan() {
    _scanState = 'scanning';
    _scanError = null;
    render();
    try {
      var problems = _problemsCache || [];
      var endForms = await Promise.all(
        problems.map(function (p) {
          return fetchEndProblemForm(p.id).catch(function () {
            return null;
          });
        })
      );
      _rows = problems.map(function (p, i) {
        var form = endForms[i];
        var activeChildCount =
          (form && Array.isArray(form.activeChildProblems) && form.activeChildProblems.length) || 0;
        return {
          id: p.id,
          description: p.problemCodeDescription,
          activeChildCount: activeChildCount,
          anchorEl: null, // resolved fresh on every inline sync — Vue recreates the anchors constantly
          flagged: false,
          caution: null,
          checked: false,
          ended: false,
          endError: null,
        };
      });
      _scanState = 'done';
      // Badge scan fires AFTER the checklist is usable and is never awaited —
      // badges fill in when it completes; a failure just means no badges.
      runFlagScan();
    } catch (err) {
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to load the problem list.';
    } finally {
      render();
    }
  }

  // ── Badge scan (SNOMED junk-code detection, ported from the retired
  // sibling — see header). Sets row.flagged / row.caution only; it never
  // gates the checklist and its failure leaves the widget fully usable. ────────
  async function runFlagScan() {
    _flagScanState = 'running';
    render();
    try {
      var roots = await ensureNonProblemRootsLoaded();
      if (!roots.length) {
        _flagScanState = 'done';
        return;
      }
      var rootsCsv = rootConceptIdsCsv(roots);
      var problems = _problemsCache || [];
      var overviews = await Promise.all(
        problems.map(function (p) {
          return fetchProblemOverview(p.id).catch(function () {
            return null;
          });
        })
      );
      var withConcept = withResolvedConceptIds(problems, overviews);
      var conceptByProblemId = Object.create(null);
      withConcept.forEach(function (p) {
        conceptByProblemId[p.id] = p.conceptId;
      });
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
      var flaggedConcepts = concepts.filter(function (id) {
        return isFlaggedConceptId(id, roots, descendantResultsByConceptId[id]);
      });
      // Attribute cautioned roots per flagged concept. The main scan's ONE
      // combined constrained search can't say WHICH root matched, so each
      // flagged concept gets checked against each caution root individually
      // (caution roots are few, flagged concepts typically a handful). Fail
      // CLOSED: a concept whose caution check errors is treated as
      // cautioned, never as clean.
      var cautionRoots = cautionRootsOf(roots);
      var cautionByConceptId = Object.create(null);
      await Promise.all(
        flaggedConcepts.map(function (id) {
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
      _rows.forEach(function (r) {
        var conceptId = conceptByProblemId[r.id];
        if (conceptId && flaggedConcepts.indexOf(conceptId) !== -1) {
          r.flagged = true;
          r.caution = cautionByConceptId[conceptId] || null;
        }
      });
      _flagScanState = 'done';
    } catch (err) {
      _flagScanState = 'error';
    } finally {
      render();
    }
  }

  async function endSelected() {
    var targets = _rows.filter(function (r) {
      return r.checked && isEndable(r);
    });
    // Same double-layer guard as the buttons' disabled state — an empty end
    // date or blank reason must never reach the record, whatever the UI said.
    if (!canSubmit(targets.length, _endDate, _reason, _ending)) return;
    _ending = true;
    render();
    var reason = _reason.trim();
    var results = await Promise.allSettled(
      targets.map(function (r) {
        return postEndProblem(r.id, _endDate, reason);
      })
    );
    var succeeded = 0;
    results.forEach(function (res, i) {
      var r = targets[i];
      if (res.status === 'fulfilled') {
        succeeded++;
        r.ended = true;
        r.checked = false;
        r.endError = null;
      } else {
        r.endError = (res.reason && res.reason.message) || 'Failed to end this problem — please try again.';
      }
    });
    _ending = false;
    // Machine-local audit trail (F2 ledger): one event per batch, patient
    // UUID only, count in the label — NEVER the free-typed reason or any
    // problem description (the ledger's own no-free-text label rule).
    // Fire-and-forget; the ledger swallows its own failures.
    if (succeeded > 0 && typeof window !== 'undefined' && window.EventLedger) {
      // _lastPatientId holds the patient this batch was scanned for on BOTH
      // page shapes — URL-derived on the care-record page, task-overview-
      // resolved on the split page (where getPatientInfo() returns null).
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'bulk-end-problems',
        label: 'Bulk end: ' + succeeded + ' problem' + (succeeded === 1 ? '' : 's') + ' ended',
        action: 'committed',
      });
    }
    var anyFailed = results.some(function (res) {
      return res.status !== 'fulfilled';
    });
    // Failures return to the checklist so the per-row errors are visible and
    // retryable; a fully successful batch lands on the done panel with its
    // explicit "Refresh page" offer (never an auto-reload — see header).
    _step = anyFailed ? 'select' : 'done';
    render();
  }

  // ── Inline checkboxes in the live problem list ────────────────────────────────
  // See INLINE INJECTION in the header for the rules this follows. State
  // lives ONLY in _rows (keyed by problem id); the DOM nodes are disposable
  // and rebuilt from state on every sync.

  function inlineActive() {
    return _open && _scanState === 'done' && _rows.length > 0;
  }

  function removeInlineCheckboxes() {
    document.querySelectorAll('.ms-pbe-inline').forEach(function (n) {
      n.remove();
    });
  }

  function inlineBadgesHtml(r) {
    var badges = '';
    if (r.ended) {
      badges += '<span class="ms-pbe-inline-tag">Ended</span>';
    } else {
      if (r.activeChildCount > 0) {
        badges +=
          '<span class="ms-pbe-inline-warn" title="Has linked problems — end individually in Medicus">linked</span>';
      }
      if (r.flagged) {
        badges +=
          '<span class="ms-pbe-inline-flag" title="Coded under a configured admin/non-clinical SNOMED category — ' +
          'often a GP2GP import artefact rather than a real clinical problem">admin?</span>';
      }
      if (r.caution) {
        badges += '<span class="ms-pbe-inline-caution" title="' + esc(r.caution) + '">⚠</span>';
      }
      if (r.endError) {
        badges += '<span class="ms-pbe-inline-error" title="' + esc(r.endError) + '">✕</span>';
      }
    }
    return badges;
  }

  function buildInlineNode(r) {
    var wrap = document.createElement('span');
    wrap.className = 'ms-pbe-inline';
    wrap.setAttribute('data-problem-id', r.id);
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'ms-pbe-inline-cb';
    cb.setAttribute('aria-label', 'Select "' + r.description + '" for bulk removal');
    cb.addEventListener('change', function () {
      var row = _rows.find(function (x) {
        return x.id === r.id;
      });
      if (row) row.checked = cb.checked;
      render();
    });
    // Stop row-level click handlers on Medicus's own <li>/<a> from firing
    // (and navigating) when the clinician is just ticking the box.
    wrap.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    wrap.appendChild(cb);
    var badges = document.createElement('span');
    badges.className = 'ms-pbe-inline-badges';
    wrap.appendChild(badges);
    return wrap;
  }

  function updateInlineNode(node, r) {
    var cb = node.querySelector('.ms-pbe-inline-cb');
    if (cb) {
      cb.checked = r.ended ? true : !!r.checked;
      cb.disabled = !isEndable(r);
    }
    var badges = node.querySelector('.ms-pbe-inline-badges');
    if (badges) badges.innerHTML = inlineBadgesHtml(r);
  }

  // Idempotent, called on every render AND every mutation tick while the
  // widget is open — the inline equivalent of the queue chips'
  // reinject-on-every-refresh rule. Anchors are re-resolved from scratch
  // each pass (Vue recreates them constantly); a row whose anchor can't be
  // found this pass simply gets its checkbox in the panel fallback instead.
  function syncInlineCheckboxes() {
    if (!inlineActive()) {
      removeInlineCheckboxes();
      return;
    }
    var claimedAnchors = new Set();
    _rows.forEach(function (r) {
      var anchor = findProblemRow(r.description, claimedAnchors);
      r.anchorEl = anchor;
      if (!anchor) return;
      claimedAnchors.add(anchor);
      if (r.ended) anchor.classList.add('ms-pbe-anchor-ended');
      var host = anchor.closest('li') || anchor.parentElement;
      if (!host) return;
      var node = host.querySelector('.ms-pbe-inline');
      if (node && node.getAttribute('data-problem-id') !== r.id) {
        // Duplicate-description edge: the host was re-claimed by a different
        // row this pass — rebuild rather than mislabel.
        node.remove();
        node = null;
      }
      if (!node) {
        node = buildInlineNode(r);
        host.insertBefore(node, host.firstChild); // PREPEND — trailing foreign nodes get reconciled away
      }
      updateInlineNode(node, r);
    });
    // Sweep orphans: nodes whose host row no longer maps to any current row
    // (patient switched sections, list re-ordered, problem ended + refetched).
    document.querySelectorAll('.ms-pbe-inline').forEach(function (n) {
      var id = n.getAttribute('data-problem-id');
      var row = _rows.find(function (x) {
        return x.id === id;
      });
      var hostStillOurs =
        row && row.anchorEl && n.parentElement && n.parentElement.contains
          ? n.parentElement.contains(row.anchorEl)
          : false;
      if (!row || !hostStillOurs) n.remove();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderSelectStep() {
    var count = selectedCount();
    var matched = _rows.filter(function (r) {
      return !!r.anchorEl;
    });
    var unmatched = _rows.filter(function (r) {
      return !r.anchorEl;
    });
    var excludedCount = _rows.filter(function (r) {
      return !r.ended && r.activeChildCount > 0;
    }).length;
    var flagged = flaggedRows();
    var selectableFlagged = flagged.filter(function (r) {
      return isEndable(r) && !r.caution;
    });

    var summary =
      '<div class="ms-pbe-summary">Tick the box next to each problem you want to end — boxes are showing beside ' +
      'all ' +
      _rows.length +
      ' active problem' +
      (_rows.length === 1 ? '' : 's') +
      ' in the list. These are live clinical entries: nothing is ticked by default, and there is deliberately no ' +
      '"select all".' +
      (excludedCount > 0
        ? ' ' +
          excludedCount +
          ' problem' +
          (excludedCount === 1 ? ' has' : 's have') +
          ' linked problems (marked "linked") and must be ended individually in Medicus.'
        : '') +
      '</div>';

    var flagLine = '';
    if (_flagScanState === 'running') {
      flagLine = '<div class="ms-pbe-flag-note">Checking which problems look like admin/non-clinical codes…</div>';
    } else if (_flagScanState === 'done' && flagged.length > 0) {
      flagLine =
        '<div class="ms-pbe-flag-note">' +
        flagged.length +
        ' problem' +
        (flagged.length === 1 ? ' is' : 's are') +
        ' coded under a configured admin/non-clinical SNOMED category (badged "admin?") — often GP2GP import ' +
        'artefacts, but not always: rows badged ⚠ can be live clinical flags (e.g. an in-flight urgent referral) ' +
        'and must be reviewed individually. "Select flagged" skips ⚠ rows.</div>';
    } else if (_flagScanState === 'done') {
      flagLine = '<div class="ms-pbe-flag-note">None of these are coded under the admin/non-clinical categories.</div>';
    }

    var selectRow =
      '<div class="ms-pbe-select-row">' +
      (selectableFlagged.length > 0
        ? '<button type="button" class="ms-pbe-select-flagged" id="ms-pbe-select-flagged">Select flagged (' +
          selectableFlagged.length +
          ')</button>'
        : '') +
      '<button type="button" class="ms-pbe-select-none" id="ms-pbe-select-none"' +
      (count === 0 ? ' disabled' : '') +
      '>Clear selection</button>' +
      '</div>';

    // Rows the inline sync couldn't find in the on-screen list still need a
    // reachable checkbox — they fall back to the panel, same renderer the
    // whole widget used before the inline rework.
    var unmatchedHtml = '';
    if (unmatched.length > 0) {
      unmatchedHtml =
        '<div class="ms-pbe-flag-note">' +
        unmatched.length +
        ' problem' +
        (unmatched.length === 1 ? '' : 's') +
        " couldn't be matched to a row in the on-screen list — tick " +
        (unmatched.length === 1 ? 'it' : 'them') +
        ' here instead:</div>' +
        '<div class="ms-pbe-list">' +
        unmatched
          .map(function (r) {
            if (r.ended) {
              return (
                '<label class="ms-pbe-row ms-pbe-row-ended"><input type="checkbox" checked disabled>' +
                '<span class="ms-pbe-row-desc">' +
                esc(r.description) +
                '</span><span class="ms-pbe-row-tag">Ended</span></label>'
              );
            }
            var disabled = !isEndable(r);
            return (
              '<label class="ms-pbe-row' +
              (disabled ? ' ms-pbe-row-disabled' : '') +
              '">' +
              '<input type="checkbox" class="ms-pbe-checkbox" data-problem-id="' +
              esc(r.id) +
              '"' +
              (r.checked ? ' checked' : '') +
              (disabled ? ' disabled' : '') +
              '>' +
              '<span class="ms-pbe-row-desc">' +
              esc(r.description) +
              '</span>' +
              (r.activeChildCount > 0
                ? '<span class="ms-pbe-row-warn">Has linked problems — end individually in Medicus</span>'
                : '') +
              (r.flagged ? '<span class="ms-pbe-inline-flag">admin?</span>' : '') +
              (r.caution ? '<span class="ms-pbe-row-warn">⚠ ' + esc(r.caution) + '</span>' : '') +
              (r.endError ? '<span class="ms-pbe-row-error">' + esc(r.endError) + '</span>' : '') +
              '</label>'
            );
          })
          .join('') +
        '</div>';
    }

    // Per-row failures from the last batch, listed in full here (the inline
    // badge is just a ✕ with a tooltip).
    var failed = matched.filter(function (r) {
      return r.endError;
    });
    var failedHtml = failed.length
      ? '<div class="ms-pbe-fail-list">' +
        failed
          .map(function (r) {
            return '<div class="ms-pbe-row-error">' + esc(r.description) + ' — ' + esc(r.endError) + '</div>';
          })
          .join('') +
        '</div>'
      : '';

    return (
      '<div class="ms-pbe-body">' +
      summary +
      flagLine +
      selectRow +
      unmatchedHtml +
      failedHtml +
      '<div class="ms-pbe-field-row">' +
      '<label class="ms-pbe-label" for="ms-pbe-end-date">End date</label>' +
      '<input type="date" class="ms-pbe-date-input" id="ms-pbe-end-date" value="' +
      esc(_endDate) +
      '">' +
      '<label class="ms-pbe-label" for="ms-pbe-reason">Reason</label>' +
      '<input type="text" class="ms-pbe-reason-input" id="ms-pbe-reason" value="' +
      esc(_reason) +
      '" maxlength="120">' +
      '</div>' +
      '<div class="ms-pbe-field-note">One end date and reason for the whole batch.</div>' +
      '<button type="button" class="ms-pbe-review-btn" id="ms-pbe-review"' +
      (canSubmit(count, _endDate, _reason, _ending) ? '' : ' disabled') +
      '>Review ' +
      count +
      ' selected problem' +
      (count === 1 ? '' : 's') +
      '…</button>' +
      '</div>'
    );
  }

  // The house "about to change the live record" gate (duplicate-checker's
  // renderRemovalFormHtml pattern): an explicit ENDING vs KEEPING summary
  // with the date and reason echoed back, and only ITS confirm button POSTs.
  function renderConfirmStep() {
    var parts = partitionSelection(_rows);
    var endingHtml = parts.ending
      .map(function (r) {
        return '<li class="ms-pbe-confirm-item">' + esc(r.description) + '</li>';
      })
      .join('');
    return (
      '<div class="ms-pbe-body">' +
      '<div class="ms-pbe-confirm-ending"><span class="ms-pbe-confirm-heading">ENDING (' +
      parts.ending.length +
      ')</span><ul class="ms-pbe-confirm-list">' +
      endingHtml +
      '</ul></div>' +
      '<div class="ms-pbe-confirm-keeping">KEEPING the other ' +
      parts.keeping.length +
      ' active problem' +
      (parts.keeping.length === 1 ? '' : 's') +
      ' untouched.</div>' +
      '<div class="ms-pbe-confirm-meta">End date <strong>' +
      esc(_endDate) +
      '</strong> · Reason "<strong>' +
      esc(_reason.trim()) +
      '</strong>" (applies to every problem above)</div>' +
      '<div class="ms-pbe-confirm-warning">Ending removes these from the active problem list. The codes stay in ' +
      'the record with this end date, but there is no bulk undo — re-opening ' +
      'them is one problem at a time in Medicus.</div>' +
      '<div class="ms-pbe-confirm-actions">' +
      '<button type="button" class="ms-pbe-back-btn" id="ms-pbe-back"' +
      (_ending ? ' disabled' : '') +
      '>Back</button>' +
      '<button type="button" class="ms-pbe-end-btn" id="ms-pbe-confirm"' +
      (canSubmit(parts.ending.length, _endDate, _reason, _ending) ? '' : ' disabled') +
      '>' +
      (_ending
        ? 'Ending…'
        : 'Confirm — end ' + parts.ending.length + ' problem' + (parts.ending.length === 1 ? '' : 's')) +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderDoneStep() {
    var endedCount = _rows.filter(function (r) {
      return r.ended;
    }).length;
    return (
      '<div class="ms-pbe-body">' +
      '<div class="ms-pbe-done">✓ ' +
      endedCount +
      ' problem' +
      (endedCount === 1 ? '' : 's') +
      ' ended. Medicus’s own list won’t reflect this until the page is refreshed.</div>' +
      '<div class="ms-pbe-confirm-actions">' +
      '<button type="button" class="ms-pbe-refresh-btn" id="ms-pbe-refresh">Refresh page</button>' +
      '<button type="button" class="ms-pbe-back-btn" id="ms-pbe-close">Close</button>' +
      '</div>' +
      '</div>'
    );
  }

  function buildHtml() {
    var header =
      '<button type="button" class="ms-pbe-toggle" id="ms-pbe-toggle" aria-expanded="' +
      _open +
      '">' +
      (_open ? '▾' : '▸') +
      ' Bulk remove?</button>';
    if (!_open) return header;
    var body;
    if (_scanState === 'scanning') {
      body = '<div class="ms-pbe-body"><span class="ms-pbe-loading">Loading problems…</span></div>';
    } else if (_scanState === 'error') {
      body =
        '<div class="ms-pbe-body"><span class="ms-pbe-error">' +
        esc(_scanError) +
        '</span> <button type="button" class="ms-pbe-retry" id="ms-pbe-retry">Retry</button></div>';
    } else if (_scanState === 'done' && _rows.length === 0) {
      body = '<div class="ms-pbe-body"><span class="ms-pbe-empty">No active problems on this record.</span></div>';
    } else if (_scanState === 'done') {
      body = _step === 'confirm' ? renderConfirmStep() : _step === 'done' ? renderDoneStep() : renderSelectStep();
    } else {
      body = '';
    }
    return header + body;
  }

  function bindEvents(el) {
    el.querySelector('#ms-pbe-toggle').addEventListener('click', function () {
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
    el.querySelector('#ms-pbe-retry')?.addEventListener('click', function () {
      runScan();
    });
    el.querySelectorAll('.ms-pbe-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-problem-id');
        var r = _rows.find(function (x) {
          return x.id === id;
        });
        if (r) r.checked = cb.checked;
        render();
      });
    });
    el.querySelector('#ms-pbe-select-flagged')?.addEventListener('click', function () {
      _rows.forEach(function (r) {
        // Cautioned rows are never swept up by Select flagged — see header.
        if (r.flagged && !r.caution && isEndable(r)) r.checked = true;
      });
      render();
    });
    el.querySelector('#ms-pbe-select-none')?.addEventListener('click', function () {
      _rows.forEach(function (r) {
        r.checked = false;
      });
      render();
    });
    el.querySelector('#ms-pbe-end-date')?.addEventListener('change', function (e) {
      _endDate = e.target.value;
      render();
    });
    el.querySelector('#ms-pbe-reason')?.addEventListener('input', function (e) {
      _reason = e.target.value;
      // No full re-render on every keystroke (it would drop focus mid-word);
      // just keep the review button's disabled state honest.
      var btn = el.querySelector('#ms-pbe-review');
      if (btn) btn.disabled = !canSubmit(selectedCount(), _endDate, _reason, _ending);
    });
    el.querySelector('#ms-pbe-review')?.addEventListener('click', function () {
      if (!canSubmit(selectedCount(), _endDate, _reason, _ending)) return;
      _step = 'confirm';
      render();
    });
    el.querySelector('#ms-pbe-back')?.addEventListener('click', function () {
      _step = 'select';
      render();
    });
    el.querySelector('#ms-pbe-confirm')?.addEventListener('click', function () {
      endSelected();
    });
    el.querySelector('#ms-pbe-refresh')?.addEventListener('click', function () {
      location.reload();
    });
    el.querySelector('#ms-pbe-close')?.addEventListener('click', function () {
      _step = 'select';
      _open = false;
      render();
    });
  }

  function render() {
    // Inline boxes sync FIRST so renderSelectStep's matched/unmatched split
    // reflects this pass's anchors, not the previous render's.
    syncInlineCheckboxes();
    var el = document.getElementById('ms-pbe-widget');
    if (!el) return;
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  // ── Injection: one "Bulk remove?" trigger next to the "Major" heading —
  // same anchor discipline (and minor-problems fallback) as
  // problem-description-cleanup.js's retired-codes trigger. ────────────────────

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
    if (document.getElementById('ms-pbe-widget')) return;
    if (!_problemsCache || !_problemsCache.length) return;
    // Wrong-patient guard for bridge-derived contexts: the fetched list must
    // match at least one on-screen row before the widget offers itself — a
    // stale bridge attribute (page navigated on, panel not yet refetched)
    // produces rows that match nothing, and the widget simply stays away.
    if (_contextViaBridge && !findFirstProblemRow(_problemsCache)) return;
    var list = findMajorProblemsList();
    if (!list) {
      var row = findFirstProblemRow(_problemsCache);
      if (!row) return;
      list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    }
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-pbe-widget';
    w.innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Cheap summary fetch + re-injection — same observer-hub/throttle/own-
  // mutation pattern as problem-description-cleanup.js. ────────────────────────
  var _fetchInFlight = false;

  async function ensureProblemsLoaded() {
    var info = getPatientInfo();
    var viaBridge = false;
    if (!info) {
      // Split page: same widget, patient resolved from the task's overview.
      // Re-read the URL after the await — if the clinician navigated to a
      // different task while the resolve was in flight, drop this tick; the
      // next one re-reads the fresh URL and its own cached resolution.
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
        // on-screen problem row before the widget injects (see
        // injectTrigger) — a stale attribute can never act on the wrong
        // patient's rows.
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
      try {
        _problemsCache = await fetchClinicalSummaryProblems(info.patientId);
      } catch (_) {
        _problemsCache = [];
      } finally {
        _fetchInFlight = false;
      }
    }
    if (_problemsCache) injectTrigger();
    // Vue re-renders strip the inline boxes constantly — put them back on
    // every tick while the widget is open (state survives in _rows).
    syncInlineCheckboxes();
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
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-pbe-widget')) {
        continue;
      }
      // Our inline nodes live inside Medicus's own <li> rows — mutations we
      // cause by injecting/updating them must not re-trigger the observer
      // loop. (Vue WIPING one always comes with sibling churn from the same
      // re-render, so filtering our own nodes here never starves re-injection.)
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('.ms-pbe-inline')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-pbe-widget') continue;
          if (n.classList && n.classList.contains('ms-pbe-inline')) continue;
          if (n.closest && n.closest('#ms-pbe-widget')) continue;
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
