// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Nest problems?" widget for the Clinical Summary problem list
//
// PURPOSE (user request 2026-08-03): related problems often sit flat next to
// each other ("Insertion of coronary artery stent" beside "Percutaneous
// balloon coronary angioplasty") when Medicus can nest one under the other as
// a child problem. Medicus's own UI does this one slideover at a time with a
// manual picker. This widget scans the active problem list, uses SNOMED
// ancestry BETWEEN the problems already on the record to suggest child→parent
// pairs, and exposes both the scan and the write path (via window.ProblemNesting,
// near the bottom of this file) to problem-nesting-canvas.js — the drag-and-drop
// organiser (2026-08-08, significance lanes + End bin 2026-08-17) is where the
// clinician confirms nest/link, significance, and single-problem end. This file
// itself still owns the scan and every write — the canvas never writes to
// Medicus directly. 2026-08-19: the trigger button now opens the canvas
// directly with no accordion panel of its own any more — the "Change
// significance" accordion section was removed (the canvas's own significance
// lanes cover it) and the "Merge duplicate copies" accordion section moved to
// content-scripts/problem-bulk-end.js (folded into "Bulk remove/merge" — see
// that file's own header for the full history). The significance-write
// functions below (commitSignificanceChange, buildUnknownSignificanceSuggestions,
// SIG_TARGETS, etc.) stay here — the canvas still calls them via
// window.ProblemNesting.
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
//        — exactly three fields, NOT a full-record replace. parentProblemId:
//        null UN-nests the problem — CONFIRMED live 2026-08-08 (two real HAR
//        captures, docs/learnings-problem-nesting-api.md) — same endpoint,
//        same payload builder, no separate write path.
//
//   The parent-side sibling (POST /clinical/problem/update-child-problems,
//   childProblemsToAdd) is deliberately NOT used, for EITHER linking or
//   unlinking: despite its name its array is a FULL REPLACE of the child set
//   (confirmed again by the 2026-08-08 unlink captures — an empty array
//   removed a parent's only child, which is fine with one child and silently
//   wrong with more than one). One child → one parent through
//   update-parent-problem, in both directions, has no such trap.
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
//     parent, so a wrong link visually demotes a live clinical problem (and
//     a wrong UNLINK promotes one back to top-level unexpectedly). The
//     canvas confirms every drag-created link, and every connector-click
//     unlink, individually (child and parent echoed back by name) before it
//     commits — nothing writes on drop or click alone.
//   - Cycle guard at BOTH layers for LINKING: wouldCreateCycle() is exported
//     via the bridge so the canvas can reject an invalid drop before even
//     offering a confirm, and commitParentLink() re-checks before POSTing
//     regardless of what the UI showed (a link committed elsewhere between
//     the check and the confirm click). Unlinking needs no cycle check —
//     removing a link can never create a loop.
//   - No auto-reload after success — Medicus's own list shows the change on
//     the next refresh; a "Refresh page" button is offered instead.
//   - Every committed link OR unlink is recorded in the machine-local
//     Clinical Event Ledger (patient UUID only, fixed label, never problem
//     descriptions).
//   - Failed POSTs surface the server's response body per card, never a bare
//     status.
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

  // The confirmed update-problem-links POST body (docs/learnings-problem-
  // nesting-api.md, HAR 50/51/53) — problemIdsToLink is a FULL REPLACE of
  // this problem's entire linked-problem set, never a single id to add.
  // Callers must build `problemIdsToLink` from a FRESH prefill read
  // (existingLinkedProblems) plus/minus exactly the one id changing — see
  // commitFlatLink below, which is the only confirmed-safe way to do that.
  function buildUpdateProblemLinksPayload(patientId, problemId, problemIdsToLink) {
    return { patientId: patientId, problemId: problemId, problemIdsToLink: problemIdsToLink };
  }

  // Same three-field end-problem POST as problem-bulk-end.js — duplicated,
  // not shared, the same way each content script already carries its own
  // tiny payload builder. reason defaults to 'Resolved' at the commit site.
  function buildEndProblemPayload(problemId, endDate, reason) {
    return { problemId: problemId, endDate: endDate, reason: reason };
  }

  // True when some other live problem lists this id as its parent.
  function hasActiveChildren(problemId, parentIdByProblemId) {
    if (!problemId) return false;
    var map = parentIdByProblemId || {};
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) {
      if (map[keys[i]] === problemId) return true;
    }
    return false;
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

  var ONSET_DATE_RE = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/;
  var ONSET_MONTH_ABBR = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  // recordDate comes back from slideover/overview ALREADY in ISO shape
  // (confirmed live 2026-08-08, HAR 48: "recordDate":"2025-01-15" on the
  // SAME response as "onsetDate":"20 Apr 2006") — onsetDate and recordDate
  // are two DIFFERENT formats on the same object, not one format that's
  // sometimes present. dateSortKey below must recognise both, or the
  // onset-blank record-date fallback silently returns null (the mis-sorting
  // Nick found live 2026-08-08 — a chronology check built on a null date
  // fails open, so this also silently defeated predatesParent below).
  var ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // Parses either the confirmed "DD Mon YYYY" onset-date display shape OR
  // an already-ISO "YYYY-MM-DD" shape (recordDate) into a zero-padded
  // 'YYYY-MM-DD' string (lexically comparable). Returns null for
  // missing/malformed input — never guesses a date. Same regex/table as
  // problem-nesting-canvas.js's own dateSortKey and allergy-cleanup.js's
  // normalizeOnsetDateForSubmit — duplicated, not shared, the same way each
  // content script already carries its own copy of small parsing helpers.
  function dateSortKey(value) {
    if (value == null) return null;
    var s = String(value).trim();
    var iso = ISO_DATE_RE.exec(s);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var m = ONSET_DATE_RE.exec(s);
    if (!m) return null;
    var month = ONSET_MONTH_ABBR[m[2]];
    if (!month) return null;
    var day = m[1].length === 1 ? '0' + m[1] : m[1];
    return m[3] + '-' + month + '-' + day;
  }

  // Onset date, falling back to record date when onset is blank — same
  // fallback the canvas already uses for display (2026-08-08), so "which
  // date counts" stays consistent between what's shown on a tile and what
  // the chronology check below judges it against.
  function resolveChronologyDate(info) {
    if (!info) return null;
    return dateSortKey(info.onsetDate) || dateSortKey(info.recordDate);
  }

  // True when childInfo/parentInfo's own dates rule OUT a parent/child
  // relationship: a child can't chronologically PREDATE the parent
  // condition it's supposedly part of (2026-08-08 request). Fails OPEN when
  // either date is unknown — this is a negative/exclusionary check on
  // positive evidence, not a data-completeness requirement, so missing
  // dates never block a suggestion that would otherwise have been offered.
  // Equal dates (e.g. a stent inserted the same day the underlying disease
  // was recorded) are NOT excluded — only a strictly earlier child is.
  function predatesParent(childInfo, parentInfo) {
    var childDate = resolveChronologyDate(childInfo);
    var parentDate = resolveChronologyDate(parentInfo);
    if (!childDate || !parentDate) return false;
    return childDate < parentDate;
  }

  // Builds the 'childConceptId|parentConceptId' key Set from
  // rules/problem-nesting-overrides.json's own pairs — the SAME string
  // shape buildNestingSuggestions' pairHits already uses, so its existing
  // lookup logic needs no new matching code, only a second Set to check and
  // a 'source' tag on the resulting option. See that file's own header for
  // what these pairs are and why they exist (2026-08-08 request): practice-
  // defined parent/child relationships SNOMED itself doesn't model as a
  // genuine IS-A hierarchy (first entry: pseudophakia as a child of
  // cataract — the expected post-op state, but a different SNOMED branch).
  function buildOverridePairSet(entries) {
    var set = new Set();
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (e && e.childConceptId && e.parentConceptId) {
        set.add(String(e.childConceptId) + '|' + String(e.parentConceptId));
      }
    });
    return set;
  }

  // Builds the suggestion list from the scan's raw materials:
  //   problems           — [{id, description}] (the active summary list)
  //   infoById           — {id: {conceptId, parentProblemId, onsetDate,
  //                        recordDate}} from each overview
  //   pairHits           — Set of 'childConceptId|parentConceptId' strings,
  //                        one per CONFIRMED SNOMED descendant relationship
  //                        (built by the scan's attribution queries — this
  //                        function trusts it).
  //   overridePairHits   — same string shape, from
  //                        rules/problem-nesting-overrides.json (see
  //                        buildOverridePairSet above) — practice-defined
  //                        pairs SNOMED doesn't recognise as a hierarchy.
  //                        Optional; defaults to empty.
  // Rules (each is a safety decision, not styling):
  //   - a child needs a resolved conceptId and NO existing parent;
  //   - parent options are other problems whose conceptId differs and whose
  //     (child, parent) concept pair is in pairHits OR overridePairHits — a
  //     pair in BOTH is tagged 'snomed' (the stronger evidence), pairHits
  //     alone 'snomed', overridePairHits alone 'override' — this tag is
  //     what lets the canvas show accurate provenance copy ("SNOMED marks
  //     this..." vs "this practice's own reference list marks this...")
  //     instead of crediting SNOMED for a pairing it never actually made;
  //   - identical-concept pairs never suggest (duplicate ≠ hierarchy);
  //   - options that would create a cycle against the CURRENT link map are
  //     dropped here AND re-checked at commit time by the caller;
  //   - a candidate child that chronologically PREDATES the candidate
  //     parent is dropped too (predatesParent, 2026-08-08) — a child can't
  //     have happened before the parent condition it's part of existed.
  //     Applies equally to override pairs — a practice-defined relationship
  //     is still subject to the same chronology sense-check.
  //     SUGGESTION-only: none of this constrains manual/drag-created links,
  //     where the clinician's own judgement is never overridden.
  function buildNestingSuggestions(problems, infoById, pairHits, overridePairHits) {
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var hits = pairHits instanceof Set ? pairHits : new Set(pairHits || []);
    var overrides = overridePairHits instanceof Set ? overridePairHits : new Set(overridePairHits || []);
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
        var pairKey = ci.conceptId + '|' + pi.conceptId;
        var isSnomedHit = hits.has(pairKey);
        var isOverrideHit = overrides.has(pairKey);
        if (!isSnomedHit && !isOverrideHit) return;
        if (wouldCreateCycle(child.id, parent.id, parentIdByProblemId)) return;
        if (predatesParent(ci, pi)) return; // can't have happened before the parent existed
        options.push({
          id: parent.id,
          description: parent.description,
          source: isSnomedHit ? 'snomed' : 'override',
        });
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

  // "(Grouped with X)" text-derived suggestions (2026-08-09) — see
  // shared/problem-text-linking.js's header for the full architecture.
  // Deliberately a SEPARATE list from buildNestingSuggestions above, not
  // merged into it: these aren't "a child needing a parent from a list of
  // candidates" (the shape every existing suggestion/tray assumes) — each
  // one is already a SPECIFIC resolved pair, offering a relationship-TYPE
  // choice instead (flat link, or nest either direction; see
  // content-scripts/problem-description-cleanup.js's own linkSuggestionHtml
  // for the identical three-way choice offered there). Only pairs with a
  // CONFIDENT match are included — an unmatched reference has nothing
  // actionable to suggest here (it still surfaces as an informational note
  // in the "Code cleanup?" panel instead).
  //
  // `matcher` is dependency-injected (shared/problem-text-linking.js's
  // exports) rather than read from `window` directly, so this stays a pure,
  // unit-testable function like everything else in this section — the
  // browser call site passes window.MSProblemTextLinking.
  function buildTextLinkSuggestions(problems, infoById, entries, matcher) {
    if (!matcher) return [];
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var out = [];
    list.forEach(function (p) {
      var text = info[p.id] && info[p.id].additionalInformation;
      if (!text) return;
      var ref = matcher.extractGroupedWithReference(text, entries);
      if (!ref) return;
      var others = list
        .filter(function (op) {
          return op.id !== p.id;
        })
        .map(function (op) {
          return { id: op.id, description: op.description };
        });
      var match = matcher.matchProblemByName(ref.problemName, others);
      if (!match) return;
      out.push({
        problemId: p.id,
        problemDescription: p.description,
        matchedProblemId: match.problemId,
        matchedDescription: match.description,
        confidence: match.confidence,
      });
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
  // ── Significance re-grade helpers ────────────────────────────────────────
  // Change-significance rides the CONFIRMED edit-problem full-replace
  // contract problem-description-cleanup.js drives in production: the
  // payload below mirrors its buildEditProblemPayload rule-for-rule (same
  // key set, same option-object unwraps, same recordedAtAnotherOrganisation
  // branch), with significance swapped instead of problemCode. See
  // docs/learnings-problem-description-cleanup.md for the captures that
  // pinned every rule — including the two live-400 traps (option-object
  // round-trip, wrapped recordedByOrganisation) the unwraps below exist for.

  // Takes `.value` from anything shaped exactly like a UI-select option
  // ({value,label}); passes every other shape through untouched.
  function unwrapOptionValue(field) {
    if (field && typeof field === 'object' && 'value' in field && 'label' in field) return field.value;
    return field;
  }

  // Unwraps ONLY the confirmed double-wrapped shape ({label, value:
  // {organisationName, …}}); both wrapped and plain shapes are real.
  function unwrapRecordedByOrganisation(org) {
    if (org && org.value && typeof org.value === 'object' && org.value.organisationName != null) {
      return org.value;
    }
    return org != null ? org : null;
  }

  // problemCode passes through UNCHANGED here (this flow never re-codes),
  // but defensively unwraps a {label, value:{conceptId,…}} select shape.
  function unwrapProblemCode(code) {
    if (code && code.value && typeof code.value === 'object' && code.value.conceptId != null) return code.value;
    return code != null ? code : null;
  }

  // Builds the full edit-problem POST body with ONLY significance changed.
  // `newSignificanceValue` is the bare enum value already resolved from the
  // prefill's own significances options (resolveSignificanceOption below) —
  // null/empty refuses outright (returns null): a missing significance must
  // never reach the record via a full-replace write.
  function buildSignificancePayload(prefill, newSignificanceValue) {
    if (!newSignificanceValue) return null;
    var p = prefill || {};
    var payload = {
      onsetDate: p.onsetDate != null ? p.onsetDate : null,
      contextId: p.contextId != null ? p.contextId : null,
      contextType: p.contextType != null ? p.contextType : null,
      significance: newSignificanceValue,
      episode: p.episode != null ? unwrapOptionValue(p.episode) : null,
      problemCode: p.problemCode != null ? unwrapProblemCode(p.problemCode) : null,
      additionalInformation: p.additionalInformation != null ? p.additionalInformation : null,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      endDate: p.endDate != null ? p.endDate : null,
      reasonEnded: p.reasonEnded != null ? unwrapOptionValue(p.reasonEnded) : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
    };
    if (p.recordedAtAnotherOrganisation) {
      payload.recordedByOrganisation = unwrapRecordedByOrganisation(p.recordedByOrganisation);
      payload.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      payload.recordedByStaff = p.recordedByStaff != null ? unwrapOptionValue(p.recordedByStaff) : null;
    }
    return payload;
  }

  // Resolves the bare enum value for a target grade ('major' | 'minor' |
  // 'unknown') from the prefill's OWN significances option list — never
  // guessed. The only live-confirmed enum value is 'major'; anything the
  // form itself doesn't offer is a per-row refusal, not an invented string.
  function resolveSignificanceOption(options, targetKey) {
    var key = String(targetKey == null ? '' : targetKey).toLowerCase();
    if (!key) return null;
    var list = Array.isArray(options) ? options : [];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o) continue;
      var v = String(o.value == null ? '' : o.value).toLowerCase();
      var l = String(o.label == null ? '' : o.label).toLowerCase();
      if (v === key || v.indexOf(key) === 0 || l === key || l.indexOf(key) === 0) return o.value;
    }
    return null;
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
      buildUpdateProblemLinksPayload: buildUpdateProblemLinksPayload,
      resolveOverviewConceptId: resolveOverviewConceptId,
      wouldCreateCycle: wouldCreateCycle,
      dateSortKey: dateSortKey,
      resolveChronologyDate: resolveChronologyDate,
      predatesParent: predatesParent,
      buildOverridePairSet: buildOverridePairSet,
      buildNestingSuggestions: buildNestingSuggestions,
      buildTextLinkSuggestions: buildTextLinkSuggestions,
      buildUnknownSignificanceSuggestions: buildUnknownSignificanceSuggestions,
      manualChildOptions: manualChildOptions,
      unwrapOptionValue: unwrapOptionValue,
      unwrapRecordedByOrganisation: unwrapRecordedByOrganisation,
      buildSignificancePayload: buildSignificancePayload,
      resolveSignificanceOption: resolveSignificanceOption,
      apiErrorMessage: apiErrorMessage,
      resultContainsConceptId: resultContainsConceptId,
      parseCareRecordPath: parseCareRecordPath,
      parseTaskOverviewPath: parseTaskOverviewPath,
      parseSummaryBridgeAttr: parseSummaryBridgeAttr,
      extractPatientIdFromTaskOverview: extractPatientIdFromTaskOverview,
      buildEndProblemPayload: buildEndProblemPayload,
      hasActiveChildren: hasActiveChildren,
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

  // ── Render-layer helpers (live region, focus restore) ────────────────────────
  // CHECK_SVG/onsetDateFor/dateSuffix (glyph + date-suffix helpers, used by
  // the old accordion's merge/significance card rendering) were removed
  // 2026-08-19 once both sections left this file — see MERGE DUPLICATES
  // ADDITION in problem-bulk-end.js's header and buildHtml()'s own comment
  // below for where each moved to.

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
  var FOCUS_KEY_ATTRS = ['data-idx', 'data-child-id', 'data-entry-id', 'data-gidx', 'data-sec', 'data-sig-id'];

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

  // Confirmed 2026-08-08 (HAR 52/53) — the update-problem-links prefill's
  // `existingLinkedProblems` is the only confirmed source of linked-problem
  // IDs (slideover/overview's own `linkedProblems` is display text only, no
  // ids — can't be used to draw an exact tile-to-tile line without risking
  // matching the wrong entry when two problems share the same description,
  // a real documented case elsewhere in this codebase). One extra GET per
  // active problem, same cost class as the overview fetch already made.
  function fetchLinkedProblemIds(patientId, problemId) {
    return apiFetch(
      '/clinical/data/problem/update-problem-links/' +
        encodeURIComponent(patientId) +
        '/' +
        encodeURIComponent(problemId)
    );
  }

  // Loads rules/problem-nesting-overrides.json ONCE per page load — a local
  // extension resource, not a Medicus call. Never throws; falls back to an
  // empty list (the scan then simply offers no override-sourced
  // suggestions) if unavailable — same pattern as allergy-cleanup.js's
  // ensureAllergyJunkCodesLoaded.
  var _overridesPromise = null;
  function ensureNestingOverridesLoaded() {
    if (_overridesPromise) return _overridesPromise;
    _overridesPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/problem-nesting-overrides.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.pairs) ? doc.pairs : [];
      } catch (e) {
        return [];
      }
    })();
    return _overridesPromise;
  }

  // Loads rules/generic-additional-info-text.json ONCE per page load — same
  // pattern as ensureNestingOverridesLoaded above. This is the SAME rules
  // file content-scripts/problem-description-cleanup.js already loads for
  // its own "(Grouped with X)" detection (2026-08-09) — loaded independently
  // here (not bridged from that file) so this scan has no load-order
  // dependency on the other content script, but both read the identical
  // configured entry via shared/problem-text-linking.js's
  // extractGroupedWithReference, so the regex itself is never duplicated.
  var _genericAdditionalInfoPromise = null;
  function ensureGenericAdditionalInfoTextLoaded() {
    if (_genericAdditionalInfoPromise) return _genericAdditionalInfoPromise;
    _genericAdditionalInfoPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/generic-additional-info-text.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.entries) ? doc.entries : [];
      } catch (e) {
        return [];
      }
    })();
    return _genericAdditionalInfoPromise;
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

  function postUpdateProblemLinks(payload) {
    return apiFetch('/clinical/problem/update-problem-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── Split-page patient resolution (same block as problem-bulk-end.js) ────────
  function fetchEditProblemPrefill(problemId) {
    return apiFetch('/clinical/data/problem/edit-problem/' + encodeURIComponent(problemId));
  }

  // The confirmed FULL-REPLACE write (see the significance helpers above) —
  // the same endpoint problem-description-cleanup.js posts in production.
  function postEditProblem(problemId, payload) {
    return apiFetch('/clinical/problem/edit-problem/' + encodeURIComponent(problemId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  function fetchEndProblemForm(problemId) {
    return apiFetch('/clinical/data/problem/end-problem/' + encodeURIComponent(problemId));
  }

  function postEndProblem(payload) {
    return apiFetch('/clinical/problem/end-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

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
  // 'idle' | 'scanning' | 'done' | 'error' — still owned here (runScan/
  // ensureScanned) since problem-nesting-canvas.js's own open() calls
  // window.ProblemNesting.ensureScanned() and reads scanState via
  // getSnapshot(). This file's OWN trigger no longer renders a body of its
  // own for any of these states (2026-08-19: "Organise problems?" now
  // opens the canvas directly — see buildHtml()/bindEvents() below); the
  // canvas has its own loading/error/retry UI, confirmed self-sufficient.
  var _scanState = 'idle';
  var _scanError = null;
  // [{childId, childDescription, childConceptId, parentOptions, chosenParentId,
  //   confirming, linking, linked, linkedParentDescription, linkError}] — no
  // longer rendered by this file's own accordion (see the "canvas" section in
  // buildHtml); read by the canvas overlay via the window.ProblemNesting
  // bridge below instead.
  var _suggestions = [];
  // [{problemId, problemDescription, matchedProblemId, matchedDescription,
  //   confidence}] — "(Grouped with X)" text-derived suggestions (2026-08-09),
  // deliberately separate from _suggestions above (see
  // buildTextLinkSuggestions' own comment for why). Read by the canvas via
  // the bridge below.
  var _textLinkSuggestions = [];
  // Live link map (problemId → parentProblemId) — seeded from the scan's
  // overviews, updated on every committed link so cycle checks and rescans
  // stay honest without refetching.
  var _parentIdByProblemId = {};
  // True only once runScan has populated _parentIdByProblemId from every
  // problem's overview for the CURRENT patient. While false, the sync
  // wouldCreateCycle(_parentIdByProblemId) check would pass vacuously on an
  // empty map — commitParentLink falls back to the fetch-walking
  // wouldCreateCycleAuthoritative instead (review finding: the cleanup
  // surface's bridge calls arrive without any scan having run).
  var _parentMapComplete = false;
  // Scan products consumed both by the sections still rendered here (merge,
  // significance) and, via the bridge, by the canvas overlay: the active
  // problem list ({id, description}) and each problem's overview-derived info.
  var _problems = [];
  var _infoById = {};
  // Lazy linked-problem-id prefill state ('idle' | 'loading' | 'done') —
  // the per-problem update-problem-links GETs only ever run once the canvas
  // actually opens (ensureLinkedIdsLoaded), never as part of the scan
  // itself: the accordion's own merge/significance/suggestion features
  // don't use linked ids, and paying one extra GET per problem on every
  // scan doubled the scan's API fan-out for data most sessions never look
  // at (review finding on the canvas PR).
  var _linkedIdsState = 'idle';
  // Subscribers to the bridge's onChange (see window.ProblemNesting below) —
  // notified at the end of every render() so the canvas overlay
  // (problem-nesting-canvas.js) stays in sync with state changed from
  // either surface, without either file duplicating the other's logic.
  var _subscribers = [];

  function resetForPatient() {
    _problemsCache = null;
    _scanState = 'idle';
    _scanError = null;
    _suggestions = [];
    _textLinkSuggestions = [];
    _parentIdByProblemId = {};
    _parentMapComplete = false;
    _problems = [];
    _infoById = {};
    _linkedIdsState = 'idle';
    // Notify subscribers (the canvas overlay) even though our own widget DOM
    // is about to be rebuilt by injectTrigger — the canvas is a fixed overlay
    // nothing else closes on an SPA patient navigation, and it decides
    // whether to shut itself by comparing the snapshot's patientId on each
    // notification. Without this call it could sit open on the old patient's
    // tree with a live confirm bar until some later render happens to fire.
    render();
  }

  // ── Scan (opt-in — only ever runs from the "Nest problems?" click) ───────────
  async function runScan() {
    var scanPatientId = _lastPatientId;
    _scanState = 'scanning';
    _scanError = null;
    render();
    try {
      // Kicked off in parallel with everything else below — doesn't depend
      // on this patient's own problem data, awaited only once pairHits
      // itself is ready (right before buildNestingSuggestions).
      var overridesPromise = ensureNestingOverridesLoaded();
      var genericInfoPromise = ensureGenericAdditionalInfoTextLoaded();
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
      // Rebuilt fresh from the overviews below on EVERY scan — scans can now
      // re-run mid-session (updateProblemDescription's rescan-after-edit), and
      // carrying old entries forward would keep a parent link that was
      // removed outside this extension looking alive.
      _parentIdByProblemId = {};
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
          // recordDate is CONFIRMED as a real Medicus field (the edit-problem
          // prefill/POST round-trips it — see docs/learnings-problem-description
          // -cleanup.md) but NOT confirmed on THIS endpoint (slideover/overview)
          // specifically — reading it here speculatively costs nothing extra
          // (no new fetch) and degrades harmlessly to null if it isn't actually
          // populated on this response. Used by the canvas as the onset-date
          // fallback (2026-08-08 request) — verify live whether it ever
          // populates; if it never does, this needs its own edit-problem
          // prefill fetch instead (a real added cost per problem).
          recordDate: (ov && ov.recordDate) || null,
          // Confirmed slideover-overview display string ('Major' / 'Minor' /
          // 'Unknown Significance') — the current grade shown per row.
          significance: (ov && ov.significance) || null,
          // From update-problem-links' own prefill (2026-08-08) — the
          // CURRENT full linked-problem id set for this problem. Symmetric
          // (confirmed live) — a problem this record links FROM will also
          // carry the reverse entry in its own list, so the canvas dedupes
          // by unordered pair rather than drawing each line twice. Fetched
          // LAZILY by ensureLinkedIdsLoaded (only the canvas consumes these
          // — the plain accordion never draws linked-problem lines, so the
          // scan itself must not pay one extra GET per problem for them); a
          // rescan carries the already-loaded set forward rather than
          // refetching (a code edit never changes linked relationships).
          linkedProblemIds: (_infoById[p.id] && _infoById[p.id].linkedProblemIds) || [],
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
      // Every problem's overview has been read into _parentIdByProblemId by
      // this point — commitParentLink's sync cycle guard can trust the map
      // from here on (see _parentMapComplete's own comment).
      _parentMapComplete = true;
      // Practice-defined pairs (rules/problem-nesting-overrides.json) fold
      // into the same suggestion builder as the live SNOMED hits — see
      // buildNestingSuggestions' own comment for how the two are merged and
      // tagged with 'source' so the canvas can credit each accurately.
      var overrideEntries = await overridesPromise;
      if (_lastPatientId !== scanPatientId) return; // patient changed while awaiting — resetForPatient owns the state now
      var overridePairHits = buildOverridePairSet(overrideEntries);
      // Raw suggestion list — no per-card UI state, this accordion no longer
      // renders suggestion cards itself (see the "canvas" section in
      // buildHtml); the canvas overlay reads this via the bridge and tracks
      // its own transient drag/confirm state independently.
      _suggestions = buildNestingSuggestions(problems, infoById, pairHits, overridePairHits);
      var genericInfoEntries = await genericInfoPromise;
      if (_lastPatientId !== scanPatientId) return;
      _textLinkSuggestions = buildTextLinkSuggestions(
        problems,
        infoById,
        genericInfoEntries,
        typeof window !== 'undefined' ? window.MSProblemTextLinking : null
      );
      // Settled BEFORE scanState flips to 'done' (so the canvas's first
      // render of a scanned tree already has a definitive true/false, never
      // a flash of the 3-way offer that then disappears) — see
      // checkExistingRelationship's own header for why this is safe to pay
      // for here specifically (bounded by how many text-link suggestions
      // actually resolved, not by list size).
      await Promise.all(
        _textLinkSuggestions.map(function (s) {
          return checkExistingRelationship(s.problemId, s.matchedProblemId).then(function (result) {
            s.alreadyRelated = result.relatedToMatch;
            // A relationship with someone ELSE, not the text's guess — see
            // checkExistingRelationship's own header for the real case that
            // motivated this distinction.
            s.hasOtherRelationship = !result.relatedToMatch && result.hasAnyRelationship;
          });
        })
      );
      // Final patient re-check before flipping to 'done' (review finding):
      // the relationship-check batch above is one network round-trip per
      // confident suggestion, plenty of time for an SPA patient navigation.
      // resetForPatient set _scanState back to 'idle' for the NEW patient —
      // writing 'done' here would present a completed scan over cleared
      // data instead of offering to scan.
      if (_lastPatientId !== scanPatientId) return;
      _scanState = 'done';
      announce(_suggestions.length + ' suggestion' + (_suggestions.length === 1 ? '' : 's'));
    } catch (err) {
      if (_lastPatientId !== scanPatientId) return;
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to scan the problem list.';
    } finally {
      if (_lastPatientId === scanPatientId) render();
    }
  }

  // Lazily fetches every problem's linked-problem id set (one
  // update-problem-links prefill GET per problem — confirmed 2026-08-08,
  // HAR 52/53: slideover/overview's own linkedProblems field is display
  // text only, no ids). Called by the canvas overlay once its tree is
  // actually on screen — the sole consumer of these ids — so a session
  // that never opens the canvas never pays for them. Runs in bounded
  // batches rather than one unbounded parallel burst, and re-renders once
  // at the end so the canvas draws the lines when they're ready.
  var LINKED_IDS_BATCH = 5;
  async function ensureLinkedIdsLoaded() {
    if (_linkedIdsState !== 'idle' || _scanState !== 'done') return;
    _linkedIdsState = 'loading';
    var scanPatientId = _lastPatientId;
    var problems = _problems.slice();
    for (var i = 0; i < problems.length; i += LINKED_IDS_BATCH) {
      if (_lastPatientId !== scanPatientId) return; // patient changed mid-fetch — discard; reset already set state back to 'idle'
      await Promise.all(
        problems.slice(i, i + LINKED_IDS_BATCH).map(function (p) {
          return fetchLinkedProblemIds(scanPatientId, p.id)
            .then(function (data) {
              var ids = Array.isArray(data && data.existingLinkedProblems) ? data.existingLinkedProblems : [];
              if (_lastPatientId === scanPatientId && _infoById[p.id]) _infoById[p.id].linkedProblemIds = ids;
            })
            .catch(function () {
              /* fail closed per problem: no line beats a guessed one */
            });
        })
      );
    }
    if (_lastPatientId !== scanPatientId) return;
    _linkedIdsState = 'done';
    render();
  }

  // Commit-time cycle walk that does NOT trust an unpopulated map (review
  // finding): _parentIdByProblemId is only complete after THIS file's own
  // runScan, but commitParentLink is also called through the bridge by
  // content-scripts/problem-description-cleanup.js's "(Grouped with X)"
  // offer, on a page where the nesting scan may never have run — there the
  // sync wouldCreateCycle(childId, parentId, {}) passes vacuously and a
  // nest of A under its own descendant creates a real loop on the record.
  // So: when the map is not known-complete (_parentMapComplete), walk the
  // ancestor chain by fetching each node's overview (parentProblemId) —
  // the same authoritative source runScan itself uses — caching what it
  // learns into the map. FAIL CLOSED: if any fetch on the chain fails, the
  // hierarchy cannot be verified, so the nest is refused rather than risked.
  async function wouldCreateCycleAuthoritative(childId, parentId) {
    if (!childId || !parentId) return false;
    if (childId === parentId) return true;
    var seen = {};
    var cur = parentId;
    while (cur) {
      if (cur === childId) return true;
      if (seen[cur]) return false; // pre-existing server-side loop — don't hang
      seen[cur] = true;
      var next;
      if (Object.prototype.hasOwnProperty.call(_parentIdByProblemId, cur)) {
        next = _parentIdByProblemId[cur] || null;
      } else {
        var ov;
        try {
          ov = await fetchProblemOverview(cur);
        } catch (e) {
          throw new Error(
            'Could not verify the existing hierarchy — not nesting, to avoid creating a loop. Try again.'
          );
        }
        next = (ov && ov.parentProblemId) || null;
        _parentIdByProblemId[cur] = next; // cache what the walk learned (null = confirmed parentless)
      }
      cur = next;
    }
    return false;
  }

  // Shared commit path for BOTH the suggestion cards and the manual builder:
  // commit-time cycle hard-guard (independent of what the UI showed — the
  // live map may have changed since render), the confirmed three-field POST,
  // the live-map update, and the ledger record. Throws on failure with a
  // user-facing message.
  async function commitParentLink(childId, parentId) {
    if (!parentId) throw new Error('A parent must be chosen.'); // guards misuse — commitUnlink below is the null-parent path
    if (_parentMapComplete) {
      if (wouldCreateCycle(childId, parentId, _parentIdByProblemId)) {
        throw new Error('Linking these two would create a loop — another link committed first. Rescan to refresh.');
      }
    } else if (await wouldCreateCycleAuthoritative(childId, parentId)) {
      throw new Error('Linking these two would create a loop in the problem hierarchy — not nesting.');
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

  // Un-nests a problem: the SAME three-field update-parent-problem POST,
  // parentProblemId: null. CONFIRMED live 2026-08-08 via two real HAR
  // captures Nick recorded (see docs/learnings-problem-nesting-api.md) — no
  // longer the inferred/unconfirmed shape the original header comment
  // warned about. No cycle check needed: removing a link can never create a
  // loop. Throws on failure with a user-facing message, same discipline as
  // commitParentLink.
  async function commitUnlink(childId) {
    await postUpdateParentProblem(buildUpdateParentProblemPayload(_lastPatientId, childId, null));
    delete _parentIdByProblemId[childId];
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'problem-nesting',
        label: 'Un-nest problem: 1 link removed',
        action: 'committed',
      });
    }
  }

  // Single-problem, always-fresh read of a problem's current flat-linked-id
  // set (2026-08-19, for content-scripts/problem-description-cleanup.js's
  // "Edit problem" panel to offer removing a link) — deliberately NOT
  // ensureLinkedIdsLoaded (that populates EVERY on-record problem's
  // linkedProblemIds in one batched pass for the canvas's own tree
  // rendering, and only after a full nesting scan has completed). This is
  // the one-fetch, scan-independent read commitFlatLink/commitFlatUnlink
  // already do for themselves, exposed so a caller can show the CURRENT
  // set without committing anything.
  async function getLinkedProblemIds(problemId) {
    var prefill = await fetchLinkedProblemIds(_lastPatientId, problemId);
    return Array.isArray(prefill && prefill.existingLinkedProblems) ? prefill.existingLinkedProblems : [];
  }

  // Creates a flat (non-hierarchical) link between two problems via the
  // update-problem-links endpoint — confirmed 2026-08-08, CONFIRMED FULL
  // REPLACE (docs/learnings-problem-nesting-api.md, HAR 53): unlike
  // commitParentLink/commitUnlink above, there is no single-field endpoint
  // to sidestep the trap, so this MUST read-modify-write every time:
  //   1. fetch a FRESH prefill right now (never _infoById's scan-time
  //      cache — the set may genuinely have changed since, e.g. linked from
  //      the other side by someone else mid-session);
  //   2. add the one id if it isn't already present (a no-op POST is not
  //      just wasteful — it would needlessly re-trigger EventLedger/onChange
  //      for a link that already existed);
  //   3. POST the resulting FULL array back.
  // No cycle check: this relationship is flat, not hierarchical — linking
  // A↔B can never create a loop the way nesting can.
  async function commitFlatLink(problemId, otherProblemId) {
    if (!otherProblemId) throw new Error('A problem to link must be chosen.');
    if (problemId === otherProblemId) throw new Error('A problem cannot be linked to itself.');
    var prefill = await fetchLinkedProblemIds(_lastPatientId, problemId);
    var existing = Array.isArray(prefill && prefill.existingLinkedProblems) ? prefill.existingLinkedProblems : [];
    if (existing.indexOf(otherProblemId) === -1) {
      var next = existing.concat([otherProblemId]);
      await postUpdateProblemLinks(buildUpdateProblemLinksPayload(_lastPatientId, problemId, next));
      if (_infoById[problemId]) _infoById[problemId].linkedProblemIds = next;
    }
    // Symmetric (confirmed live — linking from one side is readable from the
    // other): update the OTHER side's own local cache too, so the canvas's
    // dedupe-by-unordered-pair logic sees the reverse entry immediately
    // without needing a full rescan. This is a local-state courtesy only —
    // the next real read of THAT problem's own linked-problem set still goes
    // through the same fresh-fetch discipline above, never trusts this copy.
    if (_infoById[otherProblemId] && _infoById[otherProblemId].linkedProblemIds.indexOf(problemId) === -1) {
      _infoById[otherProblemId].linkedProblemIds = _infoById[otherProblemId].linkedProblemIds.concat([problemId]);
    }
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'problem-nesting',
        label: 'Link problems: 1 link created',
        action: 'committed',
      });
    }
  }

  // Removes a flat (non-hierarchical) link between two problems — the
  // counterpart commitFlatLink never had (2026-08-19 report: a clinician
  // could create a flat link but had no way to undo one, unlike
  // commitUnlink for a parent/child nest). Same full-replace discipline as
  // commitFlatLink: fetch a fresh set right now (never the scan-time
  // cache), drop the one id if present, POST the resulting array back. A
  // no-op (the link is already gone) skips the write entirely — same
  // "don't needlessly re-trigger EventLedger/onChange" reasoning as the
  // no-op guard in commitFlatLink.
  async function commitFlatUnlink(problemId, otherProblemId) {
    if (!otherProblemId) throw new Error('No linked problem given to remove.');
    var prefill = await fetchLinkedProblemIds(_lastPatientId, problemId);
    var existing = Array.isArray(prefill && prefill.existingLinkedProblems) ? prefill.existingLinkedProblems : [];
    var idx = existing.indexOf(otherProblemId);
    if (idx === -1) {
      if (_infoById[problemId]) _infoById[problemId].linkedProblemIds = existing;
      return;
    }
    var next = existing.slice(0, idx).concat(existing.slice(idx + 1));
    await postUpdateProblemLinks(buildUpdateProblemLinksPayload(_lastPatientId, problemId, next));
    if (_infoById[problemId]) _infoById[problemId].linkedProblemIds = next;
    if (_infoById[otherProblemId]) {
      var otherNext = _infoById[otherProblemId].linkedProblemIds.filter(function (id) {
        return id !== problemId;
      });
      _infoById[otherProblemId].linkedProblemIds = otherNext;
    }
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'problem-nesting',
        label: 'Remove link: 1 link removed',
        action: 'committed',
      });
    }
  }

  // Confirms whether problemId and otherProblemId are ALREADY related on the
  // record — either a flat link (update-problem-links) or a parent/child
  // nesting in EITHER direction — so a confident "(Grouped with X)" text
  // match can offer just a text cleanup instead of a redundant relationship
  // button when the relationship the text describes has already been
  // created (2026-08-09 request: "check for existing relationships... has
  // someone already manually fixed this"). Deliberately self-contained
  // rather than assuming a prior scan has run: content-scripts/problem-
  // description-cleanup.js's own "Code cleanup?" scan
  // never calls this file's runScan, so _infoById may be empty when this is
  // called from there — falls back to a fresh overview fetch per problem
  // only when the cached parentProblemId isn't already known (the canvas's
  // own scan-time call pays nothing extra here, since _infoById is already
  // populated by the time text-link suggestions are built). The
  // linkedProblemIds check ALWAYS fetches fresh regardless of cache state —
  // no cheaper confirmed source exists (2026-08-08) — but this function only
  // ever runs for the rare confidently-matched suggestion, never per problem
  // on the list, so the cost is bounded by how many "(Grouped with X)"
  // references actually resolve, not by list size.
  //
  // Returns {relatedToMatch, hasAnyRelationship} rather than a single
  // boolean (2026-08-09 follow-up — real case found live: the text named a
  // plausible-but-wrong problem, the clinician had actually already nested
  // this one under a DIFFERENT problem entirely). relatedToMatch is the
  // ORIGINAL check — specifically to otherProblemId. hasAnyRelationship is
  // broader — a parent, at least one child, or at least one flat link with
  // ANYONE — so the caller can distinguish "already sorted, just not with
  // who the text guessed" from "genuinely has nothing yet" and offer a
  // "leave as-is, remove the text" choice in the former case without
  // silently discarding the 3-way create-relationship offer either (the
  // text's guess might still be right in addition to the existing one).
  async function checkExistingRelationship(problemId, otherProblemId) {
    var aParent = _infoById[problemId] ? _infoById[problemId].parentProblemId : undefined;
    var bParent = _infoById[otherProblemId] ? _infoById[otherProblemId].parentProblemId : undefined;
    // undefined = not known yet (no scan cache) — resolved from the same
    // overview fetch as the parent below, NOT defaulted to false: from the
    // cleanup surface _infoById is empty, and discarding the overview's
    // childProblems here made hasAnyRelationship blind to children on that
    // surface only (review finding — the canvas offered the "leave as-is"
    // escape hatch on the same patient, this path didn't).
    var aHasChildren = _infoById[problemId] ? !!_infoById[problemId].hasChildren : undefined;
    if (aParent === undefined || bParent === undefined) {
      var overviews = await Promise.all([
        aParent === undefined
          ? fetchProblemOverview(problemId).catch(function () {
              return null;
            })
          : null,
        bParent === undefined
          ? fetchProblemOverview(otherProblemId).catch(function () {
              return null;
            })
          : null,
      ]);
      if (aParent === undefined) {
        aParent = (overviews[0] && overviews[0].parentProblemId) || null;
        aHasChildren = !!(
          overviews[0] &&
          Array.isArray(overviews[0].childProblems) &&
          overviews[0].childProblems.length
        );
      }
      if (bParent === undefined) bParent = (overviews[1] && overviews[1].parentProblemId) || null;
    }
    if (aHasChildren === undefined) aHasChildren = false;
    var relatedToMatch = aParent === otherProblemId || bParent === problemId;
    var linkedIds = [];
    try {
      var linked = await fetchLinkedProblemIds(_lastPatientId, problemId);
      linkedIds = Array.isArray(linked && linked.existingLinkedProblems) ? linked.existingLinkedProblems : [];
    } catch (e) {
      // fail closed: can't confirm either way -> treat as NOT already
      // related, so the ordinary 3-way create-relationship offer still
      // appears rather than silently hiding a real option.
    }
    if (!relatedToMatch && linkedIds.indexOf(otherProblemId) !== -1) relatedToMatch = true;
    var hasAnyRelationship = relatedToMatch || !!aParent || aHasChildren || linkedIds.length > 0;
    return { relatedToMatch: relatedToMatch, hasAnyRelationship: hasAnyRelationship };
  }

  var SIG_TARGETS = [
    { key: 'major', label: 'Major' },
    { key: 'minor', label: 'Minor' },
    { key: 'unknown', label: 'Unknown significance' },
  ];

  function sigTargetLabel(key) {
    var t = SIG_TARGETS.find(function (x) {
      return x.key === key;
    });
    return t ? t.label : String(key || '');
  }

  // Current display grade ('Major'/'Minor'/'Unknown Significance') vs a
  // target key — prefix match, case-insensitive.
  function sigCurrentMatchesTarget(currentLabel, targetKey) {
    if (!targetKey) return false;
    return (
      String(currentLabel || '')
        .toLowerCase()
        .indexOf(String(targetKey).toLowerCase()) === 0
    );
  }

  // Flags every problem whose CURRENT significance reads as "Unknown" (same
  // prefix match as sigCurrentMatchesTarget, which already drives the
  // existing bulk re-grade tool above) for the canvas's own tray (2026-08-09
  // request: "flag any problems with 'unknown' severity, and offer to
  // promote them to major or minor"). Deliberately never auto-picks a
  // target — unlike the confident SNOMED/text-link matches above, there is
  // no signal here for WHICH grade is correct, only that a decision is
  // outstanding; the clinician always chooses. Pure and cheap (no fetch —
  // significance is already in infoById from the scan's own overview
  // fetch), so the canvas recomputes this fresh on every snapshot read
  // rather than caching it at scan time — see getSnapshot's own comment.
  function buildUnknownSignificanceSuggestions(problems, infoById) {
    var list = Array.isArray(problems) ? problems : [];
    var info = infoById || {};
    var out = [];
    list.forEach(function (p) {
      var current = (info[p.id] && info[p.id].significance) || 'Unknown';
      if (sigCurrentMatchesTarget(current, 'unknown')) {
        out.push({ problemId: p.id, problemDescription: p.description, currentSignificance: current });
      }
    });
    return out;
  }

  // Single-problem significance change — a confirmed full-replace write
  // (GET the problem's own edit-problem prefill, resolve the target grade
  // from the prefill's OWN significances options, rebuild with ONLY
  // significance changed, POST), exposed for the canvas's own "Unknown
  // significance" tray suggestions (2026-08-09) rather than routing through
  // the old accordion's manual tick-and-batch UI. Throws on failure (a
  // per-row refusal or a real API error) with a user-facing message, same
  // discipline as commitFlatLink/commitParentLink.
  async function commitSignificanceChange(problemId, targetKey) {
    var prefill = await fetchEditProblemPrefill(problemId);
    var value = resolveSignificanceOption(prefill && prefill.significances, targetKey);
    if (!value) {
      throw new Error(
        "Medicus's own edit form doesn't offer that significance for this problem — change it in Medicus."
      );
    }
    var payload = buildSignificancePayload(prefill, value);
    if (!payload) throw new Error('Could not build a safe update for this problem — skipped.');
    await postEditProblem(problemId, payload);
    if (_infoById[problemId]) _infoById[problemId].significance = sigTargetLabel(targetKey);
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'problem-significance',
        label: 'Change significance: 1 problem re-graded',
        action: 'committed',
      });
    }
  }

  // Single-problem end from the canvas bin — same endpoint and default
  // reason as Bulk remove?, but one problem at a time, with a commit-time
  // child re-check (parent map first, then Medicus's own end-problem form).
  // Removes the ended id from the live scan lists so the canvas tile
  // disappears without a rescan.
  async function commitEndProblem(problemId) {
    if (!problemId) throw new Error('A problem must be chosen.');
    if (!_lastPatientId) throw new Error('Patient context was lost — not ending.');
    if (hasActiveChildren(problemId, _parentIdByProblemId)) {
      throw new Error('This problem still has active children — end or un-nest them first, or use Bulk remove?.');
    }
    var form = await fetchEndProblemForm(problemId);
    var childCount = (form && Array.isArray(form.activeChildProblems) && form.activeChildProblems.length) || 0;
    if (childCount > 0) {
      throw new Error('This problem still has active children — end or un-nest them first, or use Bulk remove?.');
    }
    await postEndProblem(buildEndProblemPayload(problemId, todayISO(), 'Resolved'));
    _problems = (_problems || []).filter(function (p) {
      return !p || p.id !== problemId;
    });
    delete _infoById[problemId];
    delete _parentIdByProblemId[problemId];
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'record',
        patientRef: _lastPatientId,
        severity: null,
        ruleId: 'bulk-end-problems',
        label: 'End problem: 1 problem ended',
        action: 'committed',
      });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function problemDescription(problemId) {
    var p = _problems.find(function (x) {
      return x.id === problemId;
    });
    return p ? p.description : null;
  }

  function buildHtml() {
    // 2026-08-19: "Organise problems?" now opens the canvas directly —
    // no more accordion panel of its own (Change significance moved fully
    // onto the canvas's significance lanes, v3.234.0; Merge duplicate
    // copies moved to "Bulk remove/merge", problem-bulk-end.js). This was
    // also the fix for the reported reflow bug: the trigger never grows a
    // .ms-pn-body sibling now, so the :has(.ms-pn-body) CSS flex-basis
    // flip that pushed it onto its own row (problem-nesting.css) never
    // fires — the button simply never changes shape when clicked.
    return '<button type="button" class="ms-pn-toggle" id="ms-pn-toggle">Organise problems?</button>';
  }

  function bindEvents(el) {
    // 2026-08-19: goes straight to the canvas — no accordion state of its
    // own to toggle. ProblemNestingCanvas.open() calls
    // window.ProblemNesting.ensureScanned() itself, so this doesn't need to
    // trigger or await the scan; the canvas shows its own loading state.
    el.querySelector('#ms-pn-toggle').addEventListener('click', function () {
      if (window.ProblemNestingCanvas) window.ProblemNestingCanvas.open();
    });
  }

  // Rebuilds ONLY .ms-pn-root — the polite live region is a persistent
  // sibling so announcements survive re-renders. Focus is captured before the
  // rebuild and restored to the equivalent element after (an innerHTML swap
  // otherwise dumps keyboard users back to <body>).
  function render() {
    var el = document.getElementById('ms-pn-widget');
    if (el) {
      var root = el.querySelector('.ms-pn-root');
      if (root) {
        var focusKey = captureFocusKey(el);
        root.innerHTML = buildHtml();
        bindEvents(el);
        restoreFocusKey(el, focusKey);
      }
    }
    // Notify the canvas overlay (problem-nesting-canvas.js), if it's
    // currently subscribed — a link committed from either surface must be
    // reflected on both, without either file reaching into the other's DOM.
    _subscribers.forEach(function (cb) {
      try {
        cb();
      } catch (_) {
        /* a subscriber's own render failing must never break this one */
      }
    });
  }

  // ── Bridge to problem-nesting-canvas.js ───────────────────────────────────
  // The ONLY way the canvas overlay touches this widget's state or writes to
  // Medicus — no scan/commit/cycle logic is duplicated in the canvas file.
  // getSnapshot() returns the SAME live objects (not copies), so a mutation
  // made through commitParentLink is visible to the canvas the moment it next
  // reads the snapshot; refresh()/onChange exist so a canvas-driven commit
  // also updates this widget's own (possibly still-mounted, just hidden
  // behind the overlay) accordion DOM and counts.
  window.ProblemNesting = {
    getSnapshot: function () {
      return {
        patientId: _lastPatientId,
        problems: _problems,
        infoById: _infoById,
        suggestions: _suggestions,
        textLinkSuggestions: _textLinkSuggestions,
        // unknownSignificanceSuggestions was dropped from the snapshot when
        // the canvas's unknown-significance tray was removed (v3.236.x —
        // significance is now changed by dragging between lanes); the pure
        // buildUnknownSignificanceSuggestions helper stays exported for its
        // unit tests and any future consumer.
        parentIdByProblemId: _parentIdByProblemId,
        scanState: _scanState,
      };
    },
    ensureScanned: function () {
      if (_scanState === 'idle') runScan();
    },
    ensureLinkedIdsLoaded: ensureLinkedIdsLoaded,
    getLinkedProblemIds: getLinkedProblemIds,
    commitParentLink: commitParentLink,
    commitUnlink: commitUnlink,
    commitFlatLink: commitFlatLink,
    commitFlatUnlink: commitFlatUnlink,
    checkExistingRelationship: checkExistingRelationship,
    commitSignificanceChange: commitSignificanceChange,
    commitEndProblem: commitEndProblem,
    wouldCreateCycle: wouldCreateCycle,
    // Text-link suggestion lifecycle, called by the canvas after it actions
    // a card (review finding: the canvas's own dismissed-ids Set is reset on
    // every open() while _textLinkSuggestions persists until a rescan, so a
    // committed card came back on reopen still offering to create the
    // just-created relationship). The canvas mutates the SOURCE list here:
    // consume removes the suggestion outright (relationship created AND text
    // stripped — nothing left to offer); markAlreadyRelated flips it to the
    // single "remove import text" offer (relationship created but the strip
    // failed — the leftover text is the only remaining work).
    consumeTextLinkSuggestion: function (problemId) {
      _textLinkSuggestions = _textLinkSuggestions.filter(function (s) {
        return s.problemId !== problemId;
      });
    },
    markTextLinkAlreadyRelated: function (problemId) {
      _textLinkSuggestions.forEach(function (s) {
        if (s.problemId === problemId) {
          s.alreadyRelated = true;
          s.hasOtherRelationship = false;
        }
      });
    },
    // Called by the canvas after a successful "Edit problem" code change
    // (window.ProblemDescriptionCleanup's own onApplied callback, 2026-08-08
    // follow-up: "problem code edits refresh within the canvas") — updates
    // the cached description so the tile shows the corrected text
    // immediately, then RESCANS. The description alone is not enough
    // (review finding): a code change invalidates every scan-derived fact
    // about this problem — _infoById's conceptId and every suggestion built
    // from the old concept's SNOMED/override pair hits. Without the rescan,
    // suggestions the NEW code earns (the very reason the code was fixed —
    // the live "Cataracts"→"Cataract" case) never appear until a page
    // reload, and a stale "SNOMED marks this as a child of X" claim about
    // the OLD code stays in the tray, still confirmable. The rescan's
    // overview fetches re-read everything fresh from the server; the
    // already-loaded linked-problem ids carry over (a code edit never
    // changes linked relationships — see runScan).
    updateProblemDescription: function (problemId, newDescription) {
      if (!newDescription) return;
      var p = _problems.find(function (x) {
        return x.id === problemId;
      });
      if (p) p.description = newDescription;
      var cached = (_problemsCache || []).find(function (x) {
        return x.id === problemId;
      });
      if (cached) cached.problemCodeDescription = newDescription;
      // Only from a settled state — 'scanning' means a scan is already in
      // flight (runScan has no reentrancy guard; racing two would let the
      // stale one finish last and win).
      if (_scanState === 'done' || _scanState === 'error') {
        _scanState = 'idle';
        runScan();
      } else {
        render();
      }
    },
    refresh: render,
    onChange: function (cb) {
      if (typeof cb === 'function') _subscribers.push(cb);
    },
  };

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
