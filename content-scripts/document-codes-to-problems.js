// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Add as problem?" checkbox widget for document-filing task pages.
//
// A document-filing task's "Codes & actions" card lists every coded journal
// note added against that document (e.g. "Inflammatory bowel disease",
// "Shared care prescribing: Octasa"). Medicus itself has no "turn this code
// into a Problem" action anywhere on that card (confirmed live — the card's
// own `codesAndActionsOptions` list has entries for allergy/appointment/
// immunisation/prescription/etc but never "problem") — today the clinician
// has to separately open Medicus's own "New Problem" modal and retype the
// code, the note's free text (as "Additional information"), and the onset
// date by hand, with no link back to the document at all. This widget
// offers a checkbox per coded note entry and a single "Add selected as
// problems" button that drives Medicus's own create-problem endpoint
// directly, carrying the code/text/date across automatically.
//
// Confirmed via two live HAR captures (2026-08-12,
// 66-adding-codes-to-document.har / 67-adding-problem-to-record.har):
//
//   GET  /tasks/data/document/overview/{taskUuid}
//        → data.codesAndActions[{code,id,type:"note",text,...}],
//          data.inboundDocument{documentDate,recordDate,...}
//   GET  /clinical/data/note/edit-note/{noteId}
//        → {note, noteSNOMEDct:{conceptId,description,descriptionId}, ...}
//          — the SAME endpoint content-scripts/problem-description-cleanup.js's
//          fetchEditNoteForm already uses (journal-code-sync feature); see
//          docs/learnings-journal-note-edit-api.md for that contract.
//   GET  /clinical/data/problem/create-problem/{patientId}
//        → {recordDate, recordedByStaff, existingProblems[{value:{conceptId,...}}], ...}
//   POST /clinical/problem/create-problem
//        {patientId, problemCodeId, problemCodeDescription,
//         problemCodeDescriptionId, significance, onsetDate, episode,
//         additionalInformation, problemStatus, recordDate, recordedByStaff,
//         contextId:null, contextType:null, ...}
//        → 200 {}
//
// Full contract, including the two non-blocking warnings decoded from
// Medicus's own create-problem.vue source (exact-code duplicate check,
// allergy-code check), in docs/learnings-document-problem-creation-api.md.
//
// EXISTING-PROBLEM FLAG (2026-08-19 request): the exact-conceptId duplicate
// check above previously only ran at Submit time, per CHECKED row, inside
// the confirm() dialog. It now ALSO runs at load/Refresh time, for every
// not-yet-acted row, so the checklist itself shows the flag before the
// clinician ticks anything — same GET /clinical/data/problem/create-problem
// call, plus one GET /clinical/data/note/edit-note/{noteId} per pending row
// (codesAndActions never carries a conceptId, only a plain `code` display
// string). Deliberately NOT the canvas's SNOMED-ancestry/hierarchy check
// (problem-nesting.js's runScan) — that scales with the PATIENT's whole
// active-problem count (one overview fetch per problem, then descendant
// queries), not the document, so a busy multimorbid patient would slow
// every Refresh; exact-code match costs a fixed, small handful of requests
// (typically 2-3, one per coded entry on the document) regardless of the
// patient's own problem-list size. See fetchExistingProblemFlags/
// annotateExistingProblemFlags below.
//
// DATE: onsetDate prefers inboundDocument.documentDate, falling back to
// .recordDate only when documentDate is null (frequently the case — the
// live capture's own test document had no documentDate at all). Confirmed
// as the right preference order by Nick 2026-08-12.
//
// UI: per CLAUDE.md's rule for Vue-rendered surfaces (queue chips,
// task-overview cards alike) — never touch Medicus's own codesAndActions
// DOM rows, render a wholly separate checklist from data we fetched
// ourselves. NOT anchored inline below the "Codes & actions" card (tried
// first, abandoned 2026-08-13) — a fixed-position floating panel instead,
// appended directly to document.body. Confirmed live that inline placement
// has two fatal problems on this specific page: (1) the document task page
// has a switchable right pane (Codes & actions / existing problems /
// medication) — switching away unmounts the Codes & actions card and the
// widget along with it, with no way to act on it until switching back; (2)
// even the FIRST render on a freshly opened task can race Medicus's own
// Vue rendering of that card, so the anchor search can fail before it's
// even had a chance to exist. A body-level fixed panel sidesteps both:
// nothing to find, nothing that gets unmounted by pane-switching or Vue's
// own reconciliation (which only manages its own mounted subtree, not
// arbitrary body children) — the tradeoff, deliberately accepted, is a
// small persistent floating box rather than something that reads as part
// of the page's own layout.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

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

  // Onset date can never be in the future (Medicus's own create-problem.vue
  // enforces :max-date="new Date().toDateString()") — defensive clamp in
  // case a GP2GP-imported document date is malformed.
  function clampToToday(dateStr, today) {
    if (!dateStr) return null;
    var t = today || todayISO();
    return dateStr > t ? t : dateStr;
  }

  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Guards create-problem's onsetDate against anything that isn't a genuine
  // full ISO date. Confirmed live (2026-08-14): a document's own
  // recordDate/documentDate CAN be a partial date (year-only or
  // year-month — Medicus's own "Onset date" field is explicitly a partial-
  // date widget, a real shape for an old scanned letter where the exact
  // day isn't known). Forwarding a partial value straight through as
  // onsetDate 400s: {"onsetDate":["Value is not a valid partial date."]} —
  // the SAME error content-scripts/allergy-cleanup.js's own
  // normalizeOnsetDateForSubmit() was built to work around for a different
  // field/endpoint (a UK-display-string shape there, not a partial date,
  // but the identical validation message). Rather than fail the whole
  // problem-creation over an onset date it can't cleanly express — or guess
  // at whatever padded/reshaped partial-date format Medicus's own partial-
  // date widget might accept, never confirmed live — this drops back to no
  // onset date at all, an already-confirmed-accepted value (the real
  // manual capture in docs/learnings-document-problem-creation-api.md sent
  // onsetDate: null).
  function sanitizeOnsetDate(dateStr, today) {
    if (!dateStr || !ISO_DATE_RE.test(dateStr)) return null;
    return clampToToday(dateStr, today);
  }

  // Prefers documentDate; falls back to recordDate only when documentDate
  // is null (documentDate was null in BOTH real captures — recordDate is
  // the reliably-populated field). Never createdDate — that's a
  // filing/system timestamp, not the clinical event date.
  function documentDateSource(inboundDocument) {
    var d = inboundDocument || {};
    return d.documentDate || d.recordDate || null;
  }

  // data.data.patient.id / data.data.patientId / data.patient.id /
  // data.patientId — same four-way fallback chain as
  // document-file-inline.js's patientIdFromOverview / task-inline.js's
  // resolvePatientId, since different task types nest this differently.
  function patientIdFromOverview(data) {
    return (
      (data && data.data && data.data.patient && data.data.patient.id) ||
      (data && data.data && data.data.patientId) ||
      (data && data.patient && data.patient.id) ||
      (data && data.patientId) ||
      null
    );
  }

  function extractInboundDocument(overviewData) {
    var data = (overviewData && overviewData.data) || overviewData || {};
    return data.inboundDocument || null;
  }

  // Only `type:"note"` entries are journal notes with an edit-note/
  // change-note write path behind them (confirmed contract) — other
  // codesAndActions types (allergy, observation, etc, if they ever appear
  // here) aren't offered. Marked-incorrect/disabled entries are excluded —
  // nothing to convert from a struck-through entry. Entries with no `code`
  // at all are also excluded — confirmed live 2026-08-13: Medicus's own
  // "Note" action (one of codesAndActionsOptions) adds a plain FREE-TEXT
  // note with no SNOMED code attached, which showed up here as a
  // blank-looking checkbox with no label. Beyond the display glitch, a
  // code-less entry genuinely CAN'T become a Problem — create-problem's own
  // `problemCodeId`/`problemCodeDescription`/`problemCodeDescriptionId` are
  // required, non-null fields — so offering a checkbox for one would only
  // ever fail at submit time.
  function extractCodedNoteEntries(overviewData) {
    var data = (overviewData && overviewData.data) || overviewData || {};
    var list = Array.isArray(data.codesAndActions) ? data.codesAndActions : [];
    return list
      .filter(function (e) {
        return e && e.type === 'note' && e.id && e.code && !e.isMarkedIncorrect && !e.disabled;
      })
      .map(function (e) {
        return { id: e.id, code: e.code || '', text: e.text || e.code || '' };
      });
  }

  // codesAndActions' own `text` field is "{code}: {noteText}" when the note
  // has free text beyond its code, else just "{code}" (confirmed from the
  // real capture — "Shared care prescribing: Octasa" vs plain "Inflammatory
  // bowel disease"). Lets the checkbox list show a text preview WITHOUT an
  // extra per-entry fetch; the real free text is still re-fetched fresh via
  // note/edit-note immediately before any write (never trust this preview
  // for the actual payload).
  function derivePreviewText(entry) {
    var code = (entry && entry.code) || '';
    var text = (entry && entry.text) || '';
    var prefix = code + ': ';
    if (code && text.indexOf(prefix) === 0) return text.slice(prefix.length);
    return null;
  }

  // A refresh re-fetches the document's coded entries from scratch (new
  // objects, no `acted` flag) — without this, a code already turned into a
  // problem on a PREVIOUS refresh would silently revert to an unchecked,
  // not-yet-added-looking row. Matches freshEntries against priorEntries by
  // id and carries the acted/appliedDescription/appliedOnsetDate/
  // appliedEpisode fields across for any that were already actioned;
  // everything else starts blank. Pure — no DOM/fetch.
  function mergeActedState(freshEntries, priorEntries) {
    var priorById = {};
    (priorEntries || []).forEach(function (e) {
      if (e && e.id != null) priorById[e.id] = e;
    });
    return (freshEntries || []).map(function (e) {
      var prior = priorById[e.id];
      if (prior && prior.acted) {
        return Object.assign({}, e, {
          checked: false,
          acted: true,
          actError: null,
          appliedDescription: prior.appliedDescription,
          appliedOnsetDate: prior.appliedOnsetDate,
          appliedEpisode: prior.appliedEpisode || null,
          existsWarning: false, // matches annotateExistingProblemFlags' own acted-row shape — no flag needed, it already shows as added
        });
      }
      return Object.assign(
        {
          checked: false,
          acted: false,
          actError: null,
          appliedDescription: null,
          appliedOnsetDate: null,
          appliedEpisode: null,
          existsWarning: null, // null = not yet checked; recomputed fresh every load, never carried across a refresh — see annotateExistingProblemFlags
        },
        e
      );
    });
  }

  // Mirrors Medicus's own create-problem.vue checkProblemExists() exactly —
  // exact conceptId match against the create-problem prefill's
  // existingProblems list.
  function problemAlreadyExists(existingProblems, conceptId) {
    if (!Array.isArray(existingProblems) || !conceptId) return false;
    return existingProblems.some(function (p) {
      return !!(p && p.value && p.value.conceptId === conceptId);
    });
  }

  // Refresh-time "already a problem?" flag (2026-08-19 request) — same
  // exact-conceptId check doSubmit() already runs per CHECKED row before
  // writing, run here for every not-yet-acted row so the checklist can show
  // the flag BEFORE the clinician ticks anything, not just in the confirm()
  // dialog at submit time. Deliberately reuses problemAlreadyExists rather
  // than a second matching rule — one definition of "already exists"
  // everywhere in this file. Pure — takes already-fetched data
  // (noteDetailsById: {entryId -> the /note/edit-note response or null on a
  // per-entry fetch failure}, existingProblems: the create-problem
  // prefill's own list) and returns a new entries array; never mutates its
  // input, matching mergeActedState's own discipline. An acted row, or one
  // whose note detail couldn't be resolved, gets existsWarning: false — a
  // failed per-entry lookup must never masquerade as "confirmed not a
  // duplicate", but it also must never block the row from being offered;
  // doSubmit()'s own fresh check is the real safety net at write time, this
  // is advance notice only.
  function annotateExistingProblemFlags(entries, noteDetailsById, existingProblems) {
    var details = noteDetailsById || {};
    return (entries || []).map(function (e) {
      if (!e) return e;
      if (e.acted) return Object.assign({}, e, { existsWarning: false });
      var detail = details[e.id];
      var conceptId = detail && detail.noteSNOMEDct && detail.noteSNOMEDct.conceptId;
      return Object.assign({}, e, { existsWarning: problemAlreadyExists(existingProblems, conceptId) });
    });
  }

  // Mirrors Medicus's own checkIsAllergyRelated() — the code's own
  // description must appear as an exact label match in the
  // allergy-refset-constrained search, same as the .vue source's
  // `response.data.results.find(o => o.label === concept.description)`.
  function isAllergyRelatedCode(description, searchResults) {
    if (!description || !Array.isArray(searchResults)) return false;
    return searchResults.some(function (r) {
      return r && r.label === description;
    });
  }

  // Builds the POST /clinical/problem/create-problem body — confirmed live
  // 2026-08-12 (67-adding-problem-to-record.har). `code`:
  // {conceptId, description, descriptionId} from a FRESH
  // GET /clinical/data/note/edit-note/{noteId}'s noteSNOMEDct — never the
  // codesAndActions entry's own plain `code` string, which carries no ids.
  function buildCreateProblemPayload(opts) {
    opts = opts || {};
    var code = opts.code || {};
    return {
      patientId: opts.patientId,
      problemCodeId: code.conceptId,
      problemCodeDescription: code.description,
      problemCodeDescriptionId: code.descriptionId,
      significance: 'major',
      onsetDate: opts.onsetDate != null ? opts.onsetDate : null,
      automaticallySetToEndedOnDate: null,
      episode: opts.isSubsequentEpisode ? 'subsequent' : null,
      additionalInformation: opts.noteText != null ? opts.noteText : null,
      hiddenFromPatientFacingServices: false,
      confidentialFromThirdParties: false,
      problemStatus: 'active',
      recordDate: opts.recordDate != null ? opts.recordDate : null,
      recordedByOrganisation: null,
      recordedByPractitioner: null,
      recordedByStaff: opts.recordedByStaff != null ? opts.recordedByStaff : null,
      contextId: null,
      contextType: null,
    };
  }

  // Same-batch duplicate check (2026-08-19 review): _existsWarning only
  // covers codes that were ALREADY problems at prefill time — two selected
  // entries carrying the same conceptId would otherwise BOTH write as fresh
  // first-episode active problems (exactly the duplicate Medicus's own
  // create-problem.vue check exists to catch). Marks every row after the
  // first occurrence of its conceptId so the confirm summary can say so and
  // the write loop records it as a subsequent episode. Mutates the rows —
  // they're doSubmit's own working set, never the state entries.
  function markSameBatchDuplicates(rows) {
    var seen = {};
    (rows || []).forEach(function (r) {
      var cid = r && r._resolvedCode && r._resolvedCode.conceptId;
      if (!cid) return;
      r._dupInBatch = !!seen[cid];
      seen[cid] = true;
    });
    return rows;
  }

  // Layout helpers (pure) — default dock is top-right so it does not sit on
  // the document-file chip ("Save as document") or Medicus File document.
  // Nudge is used when those controls are on-screen and still overlap.
  function isFileDocumentButtonLabel(text) {
    var t = String(text == null ? '' : text)
      .replace(/\s+/g, ' ')
      .replace(/^✓\s*/, '')
      .trim();
    if (!t) return false;
    if (/^(file(\s+(this\s+)?document)?|filed(\s+document)?|document file)$/i.test(t)) return true;
    if (/^save as document$/i.test(t) || /^saved as document$/i.test(t)) return true;
    return false;
  }

  function normalizeRect(r) {
    if (!r) return null;
    var left = r.left;
    var top = r.top;
    var width = r.width != null ? r.width : r.right - r.left;
    var height = r.height != null ? r.height : r.bottom - r.top;
    if (!isFinite(left) || !isFinite(top) || !isFinite(width) || !isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { left: left, top: top, width: width, height: height, right: left + width, bottom: top + height };
  }

  function rectsOverlap(a, b, pad) {
    a = normalizeRect(a);
    b = normalizeRect(b);
    if (!a || !b) return false;
    pad = pad == null ? 8 : pad;
    return a.left < b.right + pad && a.right + pad > b.left && a.top < b.bottom + pad && a.bottom + pad > b.top;
  }

  function defaultPanelPosition(widgetSize, viewport, margin) {
    margin = margin == null ? 20 : margin;
    viewport = viewport || { width: 1280, height: 800 };
    widgetSize = widgetSize || { width: 340, height: 240 };
    var left = viewport.width - widgetSize.width - margin;
    if (left < margin) left = margin;
    return { left: left, top: 72 };
  }

  function nudgeClearOf(widget, obstacles, viewport, pad) {
    var wr = normalizeRect(widget);
    if (!wr) return { left: 20, top: 72 };
    viewport = viewport || { width: 1280, height: 800 };
    pad = pad == null ? 12 : pad;
    var left = wr.left;
    var top = wr.top;
    var w = wr.width;
    var h = wr.height;
    var list = (obstacles || []).map(normalizeRect).filter(Boolean);

    function clamp() {
      var maxL = Math.max(8, viewport.width - w - 8);
      var maxT = Math.max(8, viewport.height - h - 8);
      left = Math.max(8, Math.min(left, maxL));
      top = Math.max(8, Math.min(top, maxT));
    }

    clamp();
    for (var pass = 0; pass < 12; pass++) {
      var cur = { left: left, top: top, width: w, height: h, right: left + w, bottom: top + h };
      var hit = null;
      for (var i = 0; i < list.length; i++) {
        if (rectsOverlap(cur, list[i], pad)) {
          hit = list[i];
          break;
        }
      }
      if (!hit) break;
      var leftOf = hit.left - w - pad;
      var above = hit.top - h - pad;
      var below = hit.bottom + pad;
      if (leftOf >= 8) left = leftOf;
      else if (above >= 8) top = above;
      else if (below + h <= viewport.height - 8) top = below;
      else {
        left = 8;
        top = 72;
      }
      clamp();
    }
    return { left: Math.round(left), top: Math.round(top) };
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      todayISO,
      clampToToday,
      sanitizeOnsetDate,
      documentDateSource,
      patientIdFromOverview,
      extractInboundDocument,
      extractCodedNoteEntries,
      derivePreviewText,
      mergeActedState,
      problemAlreadyExists,
      annotateExistingProblemFlags,
      isAllergyRelatedCode,
      buildCreateProblemPayload,
      markSameBatchDuplicates,
      isFileDocumentButtonLabel,
      rectsOverlap,
      defaultPanelPosition,
      nudgeClearOf,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msDocCodesToProblems) return;
  window.__msDocCodesToProblems = true;

  var WIDGET_ID = 'ms-dcp-widget';
  var POS_KEY = 'ms-dcp-pos';
  var _userDragged = false;
  var _skipToggle = false;

  // Same localStorage flag content-scripts/triage-lens/content.js's own
  // [ClinHUD] pipeline logging already reads
  // (localStorage.setItem('ch-debug','1') + reload) — reused here rather
  // than inventing a second flag. Gated, not unconditional: scheduleInject/
  // runInject fire on every DOM mutation plus a 2s poll, so unconditional
  // logging would flood the console.
  function debugEnabled() {
    try {
      return localStorage.getItem('ch-debug') === '1';
    } catch (_) {
      return false;
    }
  }

  function dbg() {
    if (!debugEnabled()) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[MSDCP]');
    console.log.apply(console, args);
  }

  // ── URL detection ─────────────────────────────────────────────────────────────

  function getTaskInfo() {
    var m = location.pathname.match(
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // ── API ───────────────────────────────────────────────────────────────────────

  function apiBaseUrl() {
    var info = getTaskInfo();
    var parts = location.pathname.split('/').filter(Boolean);
    var siteId = (info && info.siteId) || parts[0] || '';
    return 'https://' + siteId + '.api.' + location.hostname;
  }

  // Surfaces Medicus's own validation message on a non-2xx response instead
  // of a bare status code — same discipline as
  // problem-description-cleanup.js's apiFetch/apiErrorMessage.
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
      throw new Error('API returned an unexpected response.');
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  function blankState() {
    return {
      taskUuid: null,
      patientId: null,
      inboundDocument: null,
      loading: false,
      loadError: null,
      entries: [], // {id, code, text, checked, acted, actError, appliedDescription, appliedOnsetDate, appliedEpisode}
      submitting: false,
      batchError: null,
      collapsed: false, // manual toggle — a permanently-floating panel needs an escape hatch
    };
  }

  var s = blankState();

  // ── DOM injection ─────────────────────────────────────────────────────────────
  // Fixed-position floating panel, appended directly to document.body — see
  // the file header for why (abandoned inline anchoring below the "Codes &
  // actions" card 2026-08-13: pane-switching unmounts that card and the
  // widget with it, and even the first render could race Medicus's own
  // rendering of it). Nothing to search for, so this is unconditional —
  // always succeeds once document.body exists.

  function readSavedPos() {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || typeof p.left !== 'number' || typeof p.top !== 'number') return null;
      return p;
    } catch (_) {
      return null;
    }
  }

  function savePos(left, top, dragged) {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ left: left, top: top, dragged: !!dragged }));
    } catch (_) {
      /* private mode / blocked storage — position just isn't remembered */
    }
  }

  function applyLeftTop(el, left, top) {
    if (!el) return;
    var wr = el.getBoundingClientRect();
    var w = wr.width || 340;
    var h = wr.height || 80;
    var maxL = Math.max(8, window.innerWidth - w - 8);
    var maxT = Math.max(8, window.innerHeight - h - 8);
    left = Math.max(8, Math.min(left, maxL));
    top = Math.max(8, Math.min(top, maxT));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function hostFileButtonRects() {
    var out = [];
    function addEl(el) {
      if (!el || (el.closest && el.closest('#' + WIDGET_ID))) return;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      out.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
    // The suite's own "Save as document" chip/form — this is the control
    // Nick's panel was covering (document-file-inline.js).
    document.querySelectorAll('.ms-df-chip, .ms-df-chip-wrap, #ms-df-widget, #ms-df-widget .ms-df-btn').forEach(addEl);
    var nodes = document.querySelectorAll('button, [role="button"], a.q-btn, .q-btn');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest && el.closest('#' + WIDGET_ID)) continue;
      var aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
      var text = el.textContent || '';
      if (!isFileDocumentButtonLabel(aria) && !isFileDocumentButtonLabel(text)) continue;
      addEl(el);
    }
    return out;
  }

  function placePanel(el) {
    if (!el) return;
    var saved = readSavedPos();
    if (saved && saved.dragged) _userDragged = true;
    var wr = el.getBoundingClientRect();
    var size = { width: wr.width || 340, height: wr.height || 80 };
    var vp = { width: window.innerWidth, height: window.innerHeight };
    var pos;
    if (_userDragged && saved) pos = { left: saved.left, top: saved.top };
    else pos = defaultPanelPosition(size, vp, 20);
    if (!_userDragged) {
      pos = nudgeClearOf(
        { left: pos.left, top: pos.top, width: size.width, height: size.height },
        hostFileButtonRects(),
        vp,
        12
      );
    } else {
      pos = nudgeClearOf({ left: pos.left, top: pos.top, width: size.width, height: size.height }, [], vp, 0);
    }
    applyLeftTop(el, pos.left, pos.top);
  }

  function ensureClearOfFileButton(el) {
    el = el || document.getElementById(WIDGET_ID);
    if (!el || _userDragged) return;
    placePanel(el);
  }

  function enableDrag(el) {
    var header = el.querySelector('.ms-dcp-header');
    if (!header || header.dataset.msDcpDrag === '1') return;
    header.dataset.msDcpDrag = '1';
    var dragging = false;
    var moved = false;
    var sx = 0;
    var sy = 0;
    var sl = 0;
    var st = 0;

    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - sx;
      var dy = e.clientY - sy;
      if (!moved && dx * dx + dy * dy < 25) return;
      moved = true;
      _skipToggle = true;
      el.classList.add('ms-dcp-dragging');
      applyLeftTop(el, sl + dx, st + dy);
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('ms-dcp-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', endDrag);
      window.removeEventListener('blur', endDrag);
      // A drag that ends off the toggle (mouseup elsewhere, or window blur)
      // never fires the click that consumes _skipToggle — left set, it would
      // silently swallow the NEXT legitimate collapse click. The click for a
      // drag that DOES end on the toggle is dispatched synchronously right
      // after this mouseup, so a deferred reset lets that one click be
      // suppressed and then always clears the flag.
      setTimeout(function () {
        _skipToggle = false;
      }, 0);
      if (!moved) return;
      _userDragged = true;
      var r = el.getBoundingClientRect();
      savePos(r.left, r.top, true);
    }

    header.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('#ms-dcp-refresh, .ms-dcp-refresh-btn, button, input')) return;
      var rect = el.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      sl = rect.left;
      st = rect.top;
      dragging = true;
      moved = false;
      _skipToggle = false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', endDrag);
      window.addEventListener('blur', endDrag);
    });
  }

  function injectWidget() {
    if (document.getElementById(WIDGET_ID)) {
      dbg('injectWidget: already present, no-op');
      return;
    }
    var w = document.createElement('div');
    w.id = WIDGET_ID;
    renderInto(w);
    dbg('injectWidget: appending fixed panel to document.body');
    withObserverPaused(function () {
      document.body.appendChild(w);
    });
    requestAnimationFrame(function () {
      placePanel(w);
    });
  }

  function removeWidget() {
    var w = document.getElementById(WIDGET_ID);
    if (!w) return;
    withObserverPaused(function () {
      w.remove();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    var w = document.getElementById(WIDGET_ID);
    if (w) renderInto(w);
  }

  function checkedCount() {
    return s.entries.filter(function (e) {
      return e.checked && !e.acted;
    }).length;
  }

  function formatDateForDisplay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderRow(e) {
    if (e.acted) {
      return (
        '<li class="ms-dcp-row ms-dcp-row-done">' +
        '<span class="ms-dcp-success-icon">✓</span> Added as problem: ' +
        '<strong>' +
        esc(e.appliedDescription) +
        '</strong>' +
        (e.appliedOnsetDate ? ' (onset ' + esc(formatDateForDisplay(e.appliedOnsetDate)) + ')' : ' (no onset date)') +
        (e.appliedEpisode === 'subsequent'
          ? ' — recorded as a <strong>subsequent</strong> episode (an active problem with this code already existed)'
          : '') +
        '</li>'
      );
    }
    var preview = derivePreviewText(e);
    return (
      '<li class="ms-dcp-row">' +
      '<label class="ms-dcp-row-label">' +
      '<input type="checkbox" class="ms-dcp-checkbox" data-entry-id="' +
      esc(e.id) +
      '"' +
      (e.checked ? ' checked' : '') +
      '>' +
      '<span class="ms-dcp-row-text"><strong>' +
      esc(e.code) +
      '</strong>' +
      (preview ? ': ' + esc(preview) : '') +
      '</span>' +
      '</label>' +
      // Advance notice only (2026-08-19) — the checkbox stays tickable;
      // doSubmit() runs its OWN fresh check at write time regardless and
      // records a subsequent episode rather than blocking, same as this
      // note says. existsWarning is null until the flag check resolves
      // (a moment after the row itself first renders — see loadTask), so
      // this simply doesn't show yet rather than flashing a false negative.
      (e.existsWarning
        ? '<div class="ms-dcp-row-flag">⚠ Already an active problem for this code — adding it will record a subsequent episode</div>'
        : '') +
      (e.actError ? '<div class="ms-dcp-row-error">' + esc(e.actError) + '</div>' : '') +
      '</li>'
    );
  }

  function headerHtml() {
    var count = s.entries.length;
    return (
      '<div class="ms-dcp-header">' +
      '<span class="ms-dcp-grip" title="Drag to move" aria-hidden="true"></span>' +
      '<span class="ms-dcp-header-toggle" id="ms-dcp-toggle" role="button" tabindex="0" aria-expanded="' +
      !s.collapsed +
      '">' +
      '<span class="ms-dcp-chevron">' +
      (s.collapsed ? '▸' : '▾') +
      '</span>' +
      '<span>Add coded entries as problems' +
      (s.collapsed && count ? ' (' + count + ')' : '') +
      '</span>' +
      '</span>' +
      (s.collapsed
        ? ''
        : '<button class="ms-dcp-refresh-btn" id="ms-dcp-refresh" type="button"' +
          (s.loading ? ' disabled' : '') +
          '>' +
          (s.loading ? 'Refreshing…' : '⟳ Refresh') +
          '</button>') +
      '</div>'
    );
  }

  function buildHtml() {
    // Persistent by design (2026-08-14) — a document is very often opened
    // BEFORE any codes have been added to it, so gating the whole panel's
    // existence on entries.length > 0 meant it could only ever appear after
    // a close-and-reopen. Always show the header; the body reflects
    // whichever state we're actually in, and Refresh re-fetches without a
    // full page reload. A fixed floating panel (2026-08-13) needs a manual
    // collapse escape hatch since it can't be scrolled past like an inline
    // one — collapsed shows just the header (with an entry count badge).
    if (s.collapsed) return headerHtml();
    if (s.loading) {
      return (
        headerHtml() + '<div class="ms-dcp-body"><div class="ms-dcp-loading">Checking for coded entries…</div></div>'
      );
    }
    if (s.loadError) {
      return headerHtml() + '<div class="ms-dcp-body"><div class="ms-dcp-error">' + esc(s.loadError) + '</div></div>';
    }
    if (!s.entries.length) {
      return (
        headerHtml() +
        '<div class="ms-dcp-body"><div class="ms-dcp-empty">No coded entries on this document yet. Add some via Medicus\'s own "Codes &amp; actions" section, then Refresh.</div></div>'
      );
    }
    var n = checkedCount();
    var label = s.submitting ? 'Adding…' : 'Add ' + n + ' selected as problem' + (n === 1 ? '' : 's');
    return (
      headerHtml() +
      '<div class="ms-dcp-body">' +
      (s.batchError ? '<div class="ms-dcp-error">' + esc(s.batchError) + '</div>' : '') +
      '<ul class="ms-dcp-list">' +
      s.entries.map(renderRow).join('') +
      '</ul>' +
      '<button class="ms-dcp-btn" id="ms-dcp-submit"' +
      (n > 0 && !s.submitting ? '' : ' disabled') +
      '>' +
      esc(label) +
      '</button>' +
      '</div>'
    );
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function doSubmit() {
    if (s.submitting) return;
    var checked = s.entries.filter(function (e) {
      return e.checked && !e.acted;
    });
    if (!checked.length) return;

    // WRONG-PATIENT/WRONG-TASK GUARD — same discipline as task-inline.js's
    // doCreate(): a clinical write must never fire against a task the
    // clinician has already navigated away from.
    var info = getTaskInfo();
    if (!info || info.typeSlug !== 'document' || info.taskUuid !== s.taskUuid) {
      s.batchError = 'Task changed — reopen the page and try again.';
      rerender();
      return;
    }
    if (!s.patientId) {
      s.batchError = 'Could not determine the patient for this task.';
      rerender();
      return;
    }

    s.submitting = true;
    s.batchError = null;
    checked.forEach(function (e) {
      e.actError = null;
    });
    rerender();
    var st = s;

    try {
      var prefill = await apiFetch('/clinical/data/problem/create-problem/' + encodeURIComponent(st.patientId));
      if (st !== s) return; // navigated away mid-fetch — discard

      // Per-row fresh detail fetch (conceptId/descriptionId aren't in the
      // task-overview's own codesAndActions entry, only a plain code
      // string) — never trust the checkbox-list preview text for the write.
      for (var row of checked) {
        try {
          var noteDetail = await apiFetch('/clinical/data/note/edit-note/' + encodeURIComponent(row.id));
          if (st !== s) return;
          var code = noteDetail.noteSNOMEDct || {};
          row._resolvedCode = {
            conceptId: code.conceptId,
            description: code.description,
            descriptionId: code.descriptionId,
          };
          row._resolvedNoteText = noteDetail.note || null;
          row._existsWarning = problemAlreadyExists(prefill.existingProblems, code.conceptId);
        } catch (err) {
          row.actError = (err && err.message) || "Could not load this entry's details.";
        }
      }
      if (st !== s) return;

      var readyRows = checked.filter(function (e) {
        return e._resolvedCode && e._resolvedCode.conceptId && !e.actError;
      });
      if (!readyRows.length) {
        rerender();
        return;
      }

      // Allergy-code check, once per distinct description (mirrors
      // Medicus's own checkIsAllergyRelated) — a WARNING only, shown in the
      // confirm() text below, never blocks the write.
      var allergyByDescription = {};
      for (var r of readyRows) {
        var desc = r._resolvedCode.description;
        if (Object.prototype.hasOwnProperty.call(allergyByDescription, desc)) continue;
        try {
          var searchRes = await apiFetch(
            '/clinical/gb/snomed/search/description/constrained?outputParentConceptIds=1&constrainingParentConcepts=420134006,281647001&query=' +
              encodeURIComponent(desc)
          );
          allergyByDescription[desc] = isAllergyRelatedCode(desc, searchRes && searchRes.results);
        } catch (_) {
          allergyByDescription[desc] = false; // fail open on this warning-only check
        }
      }
      if (st !== s) return;
      readyRows.forEach(function (e) {
        e._allergyWarning = !!allergyByDescription[e._resolvedCode.description];
      });
      markSameBatchDuplicates(readyRows);

      var summaryLines = readyRows.map(function (e) {
        var flags = [];
        if (e._existsWarning)
          flags.push('already an active problem for this code — will be recorded as a subsequent episode');
        if (e._dupInBatch && !e._existsWarning)
          flags.push('same code as another selected entry — will be recorded as a subsequent episode');
        if (e._allergyWarning) flags.push('allergy-related — not recommended as a problem record');
        return '• ' + e._resolvedCode.description + (flags.length ? ' (' + flags.join('; ') + ')' : '');
      });
      var confirmed = window.confirm(
        'Create ' +
          readyRows.length +
          ' new problem' +
          (readyRows.length === 1 ? '' : 's') +
          ' from this document?\n\n' +
          summaryLines.join('\n')
      );
      if (!confirmed) {
        st.submitting = false;
        rerender();
        return;
      }

      var today = todayISO();
      var onsetDate = sanitizeOnsetDate(documentDateSource(st.inboundDocument), today);
      var recordDate = prefill.recordDate || today;
      var recordedByStaff = prefill.recordedByStaff || null;

      // Tracks conceptIds SUCCESSFULLY created within this batch — a same-
      // batch duplicate is only truly "subsequent" once the first copy's
      // POST landed (if the first write failed, the second is still the
      // first episode on the record).
      var createdConceptIds = {};
      for (var w of readyRows) {
        try {
          var subsequent = !!w._existsWarning || !!createdConceptIds[w._resolvedCode.conceptId];
          var payload = buildCreateProblemPayload({
            patientId: st.patientId,
            code: w._resolvedCode,
            noteText: w._resolvedNoteText,
            onsetDate: onsetDate,
            recordDate: recordDate,
            recordedByStaff: recordedByStaff,
            isSubsequentEpisode: subsequent,
          });
          await apiFetch('/clinical/problem/create-problem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (st !== s) return;
          createdConceptIds[w._resolvedCode.conceptId] = true;
          w.acted = true;
          w.checked = false;
          w.appliedDescription = w._resolvedCode.description;
          w.appliedOnsetDate = onsetDate;
          w.appliedEpisode = subsequent ? 'subsequent' : null;
        } catch (err) {
          w.actError = (err && err.message) || 'Failed to create this problem — please try again.';
        }
      }
    } catch (err) {
      st.batchError = (err && err.message) || 'Failed to load problem-creation details — please try again.';
    } finally {
      st.submitting = false;
      if (st === s) rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    el.querySelectorAll('.ms-dcp-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-entry-id');
        var entry = s.entries.find(function (e) {
          return e.id === id;
        });
        if (entry) entry.checked = cb.checked;
        var submitBtn = el.querySelector('#ms-dcp-submit');
        if (submitBtn) {
          var n = checkedCount();
          submitBtn.disabled = !(n > 0 && !s.submitting);
          submitBtn.textContent = s.submitting ? 'Adding…' : 'Add ' + n + ' selected as problem' + (n === 1 ? '' : 's');
        }
      });
    });
    var submitBtn = el.querySelector('#ms-dcp-submit');
    if (submitBtn) submitBtn.addEventListener('click', doSubmit);
    var refreshBtn = el.querySelector('#ms-dcp-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', doRefresh);
    var toggle = el.querySelector('#ms-dcp-toggle');
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        if (_skipToggle) {
          _skipToggle = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        s.collapsed = !s.collapsed;
        rerender();
        var w = document.getElementById(WIDGET_ID);
        if (w && !_userDragged) placePanel(w);
      });
      toggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }
    enableDrag(el);
  }

  function doRefresh() {
    if (s.loading || !s.taskUuid) return;
    loadTask(s.taskUuid);
  }

  // ── Load ──────────────────────────────────────────────────────────────────────

  // Called both for the initial load on a fresh task page AND for a
  // Refresh click on the SAME task (picking up codes added to the document
  // after the page was first opened, without a full reload). On a refresh,
  // `priorEntries` carries any already-created rows across via
  // mergeActedState so a re-fetch doesn't make an "Added as problem" row
  // look unconverted again.
  async function loadTask(taskUuid) {
    dbg('loadTask: starting for', taskUuid);
    var sameTask = s.taskUuid === taskUuid;
    var priorEntries = sameTask ? s.entries : [];
    var st = blankState();
    st.taskUuid = taskUuid;
    st.loading = true;
    // A refresh on the SAME task (manual click, or the auto-refresh-on-
    // reappear path) must not silently re-expand a panel the clinician
    // deliberately collapsed — only a genuine navigation to a different
    // task resets to expanded-by-default.
    if (sameTask) st.collapsed = s.collapsed;
    s = st;
    // Show the panel immediately (in its loading state) rather than
    // waiting on the fetch — this IS the "load it by default" behaviour;
    // the body content fills in once the fetch resolves.
    requestAnimationFrame(function () {
      if (!document.hidden) injectWidget();
      rerender();
    });
    try {
      var overview = await apiFetch('/tasks/data/document/overview/' + encodeURIComponent(taskUuid));
      if (st !== s) {
        dbg('loadTask: navigated away mid-fetch, discarding result for', taskUuid);
        return;
      }
      st.patientId = patientIdFromOverview(overview);
      st.inboundDocument = extractInboundDocument(overview);
      // Log the RAW codesAndActions array too, not just the post-filter
      // count — if extractCodedNoteEntries() is silently filtering out
      // real entries (unexpected type/isMarkedIncorrect/disabled shape),
      // this is what proves it without needing another live round-trip.
      dbg(
        'loadTask: raw codesAndActions =',
        (overview && overview.data && overview.data.codesAndActions) || overview.codesAndActions || null
      );
      st.entries = mergeActedState(extractCodedNoteEntries(overview), priorEntries);
      dbg('loadTask: resolved,', st.entries.length, 'coded note entries (after filtering), patientId =', st.patientId);
    } catch (err) {
      if (st !== s) return;
      st.loadError = (err && err.message) || 'Could not check for coded entries — try Refresh.';
      st.entries = [];
      dbg('loadTask: fetch failed —', st.loadError);
    } finally {
      st.loading = false;
      if (st === s) rerender();
    }
    // Existing-problem flag check (2026-08-19 request) — deliberately AFTER
    // the block above, not folded into it: the checklist itself must appear
    // as fast as it always has (one fetch, the document overview); this is
    // a second, independent round of fetches that fills the flags in a
    // moment later rather than delaying the whole panel on them. Best-
    // effort — a failure here leaves entries with existsWarning: null
    // (never shown as a flag, never blocks Add), it does NOT become a
    // st.loadError.
    if (st === s && st.patientId && st.entries.some((e) => !e.acted)) {
      try {
        var flagData = await fetchExistingProblemFlags(st.patientId, st.entries);
        if (st !== s) return;
        // A submit that started while these flag fetches were in flight
        // holds references into the CURRENT st.entries rows (doSubmit writes
        // acted/appliedDescription onto them as each POST lands). Swapping
        // in annotate's CLONED rows now would orphan those writes — created
        // rows would re-render as still-pending, inviting a duplicate
        // submit. Flags are best-effort: skip them; doSubmit computes its
        // own _existsWarning fresh anyway.
        if (st.submitting) {
          dbg('loadTask: submit in flight — skipping existing-problem flag swap');
          return;
        }
        st.entries = annotateExistingProblemFlags(st.entries, flagData.noteDetailsById, flagData.existingProblems);
        dbg('loadTask: existing-problem flags resolved for', Object.keys(flagData.noteDetailsById).length, 'entries');
        rerender();
      } catch (err) {
        dbg('loadTask: existing-problem flag check failed (non-fatal) —', err && err.message);
      }
    }
  }

  // Fetches everything annotateExistingProblemFlags needs: the patient's
  // current problem list (existingProblems, from the SAME create-problem
  // prefill endpoint doSubmit() already calls) and, per not-yet-acted
  // entry, that entry's own SNOMED code (codesAndActions carries only a
  // plain `code` display string, never a conceptId — same reason doSubmit()
  // re-fetches /note/edit-note per checked row). Both fetched in parallel;
  // a single entry's own note-detail failure is swallowed per-entry (that
  // one row just gets no flag) rather than failing the whole check over one
  // bad row. Skips entirely (no existingProblems fetch either) when every
  // entry is already acted — nothing left to flag, no reason to spend the
  // request.
  async function fetchExistingProblemFlags(patientId, entries) {
    var pending = (entries || []).filter(function (e) {
      return e && !e.acted;
    });
    if (!pending.length) return { existingProblems: [], noteDetailsById: {} };
    var results = await Promise.all([
      apiFetch('/clinical/data/problem/create-problem/' + encodeURIComponent(patientId)),
      Promise.all(
        pending.map(function (e) {
          return apiFetch('/clinical/data/note/edit-note/' + encodeURIComponent(e.id))
            .then(function (detail) {
              return { id: e.id, detail: detail };
            })
            .catch(function () {
              return { id: e.id, detail: null };
            });
        })
      ),
    ]);
    var prefill = results[0] || {};
    var noteDetailsById = {};
    results[1].forEach(function (r) {
      noteDetailsById[r.id] = r.detail;
    });
    return { existingProblems: prefill.existingProblems, noteDetailsById: noteDetailsById };
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────
  // Same discipline as task-inline.js (own-mutation filter, throttle,
  // animation-frame deferral, remove-on-leave) — except the data fetch is
  // eager (keyed by taskUuid) rather than deferred to a toggle-click, since
  // the injection decision itself depends on whether there's anything to
  // show.

  var _lastPath = location.pathname;
  var _throttle = null;
  var _lastAutoRefreshAt = 0;
  var _obs = null;

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
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#' + WIDGET_ID)) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === WIDGET_ID) continue;
          if (n.closest && n.closest('#' + WIDGET_ID)) continue;
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
    var info = getTaskInfo();
    var onDocTask = !!(info && info.typeSlug === 'document');
    var pathChanged = location.pathname !== _lastPath;
    if (!onDocTask && !pathChanged) {
      dbg('scheduleInject: not on a document task and path unchanged — no-op (typeSlug =', info && info.typeSlug, ')');
      return;
    }
    // Panel is persistent once loaded (loading/error/empty/entries all
    // render something) — the only reason to re-schedule on the SAME task
    // is if the SPA wiped our own node and it needs re-inserting.
    if (onDocTask && !pathChanged && s.taskUuid === (info && info.taskUuid)) {
      var existing = document.getElementById(WIDGET_ID);
      if (existing && existing.isConnected) {
        ensureClearOfFileButton(existing);
        return;
      }
      dbg('scheduleInject: on same task, widget not connected — scheduling runInject');
    }
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    var currentPath = location.pathname;
    if (currentPath !== _lastPath) _lastPath = currentPath;
    if (document.hidden) return;
    var info = getTaskInfo();
    if (!info || info.typeSlug !== 'document') {
      dbg('runInject: not on a document task page (path =', currentPath + ') — removing widget, wiping state');
      removeWidget();
      if (s.taskUuid) s = blankState();
      return;
    }
    if (s.taskUuid !== info.taskUuid) {
      dbg('runInject: task changed (was', s.taskUuid, 'now', info.taskUuid + ') — reloading');
      loadTask(info.taskUuid);
      return;
    }
    var existing = document.getElementById(WIDGET_ID);
    if (existing && existing.isConnected) {
      dbg('runInject: widget still connected, no-op');
      return;
    }
    // Should be RARE now the widget is a body-level fixed panel (2026-08-13)
    // rather than nested inline below the "Codes & actions" card — nothing
    // in Medicus's own Vue reconciliation should ever touch a node that
    // isn't inside its own mounted subtree, so pane-switching no longer
    // unmounts it. Kept as a defensive backstop only (a full page
    // navigation within the SPA that doesn't go through the task-changed/
    // left-the-task branches above is the main remaining case) — still
    // re-fetches rather than just re-rendering possibly-stale state if it
    // ever does fire, rate-limited to once per 4s.
    if (!s.loading && Date.now() - _lastAutoRefreshAt > 4000) {
      dbg(
        'runInject: same task, widget missing — refreshing (was',
        s.entries.length,
        'entries) rather than re-rendering possibly-stale state'
      );
      _lastAutoRefreshAt = Date.now();
      loadTask(s.taskUuid);
      return;
    }
    dbg(
      'runInject: same task, widget missing from DOM, refreshed too recently — re-injecting from existing state (',
      s.entries.length,
      'entries)'
    );
    requestAnimationFrame(function () {
      if (!document.hidden) injectWidget();
    });
  }

  var _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(onMutations);
  } else {
    _obs = new MutationObserver(onMutations);
    observeBody();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleInject();
  });

  window.addEventListener('resize', function () {
    var w = document.getElementById(WIDGET_ID);
    if (w) placePanel(w);
  });

  // Defensive backstop beyond the mutation observer. Confirmed live
  // 2026-08-14: switching to view a different in-task section (existing
  // problems / medication) and back can wipe the widget's DOM node without
  // the observer's own filter reliably catching the swap in time to
  // re-trigger — this widget is also persistent-by-design (visible even at
  // zero entries, unlike the collapsed-by-default sibling widgets), so a
  // clinician is more likely to have it on screen through exactly that
  // kind of in-task navigation. scheduleInject() already no-ops cheaply
  // when nothing's changed, so polling it is safe.
  setInterval(function () {
    if (!document.hidden) scheduleInject();
  }, 2000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInject);
  } else {
    scheduleInject();
  }
})();
