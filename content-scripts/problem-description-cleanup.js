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
// DETECTION: descriptionId === null on the current problemCode is a
// reliable machine signal for the ICD-bracket/NOS/NEC patterns (confirmed
// correlated on every example captured so far — see the learnings doc's
// "what's NOT yet confirmed" section for the caveat on sample size). Also
// now confirmed for the "H/O" prefix specifically — live-verified
// 2026-07-26 on a genuine pre-existing patient problem ("H/O: varicose
// veins", conceptId 161509009, descriptionId null), after an earlier same-day
// probe against a problem the tester had just added themselves came back
// non-null and was correctly discarded as not evidential (a freshly-coded
// problem is trivially expected to carry a populated descriptionId
// regardless of the H/O hypothesis — only a genuine historic entry tests it).
// n=1 genuine example, same caution as the bracket/NOS pattern's own small
// sample — see docs/learnings-problem-description-cleanup.md. The
// bracket-prefix/NOS text pattern is used for a cheap first-pass scan
// across clinical-summary/summary's plain-text problemCodeDescription list,
// without a per-problem edit-problem fetch. A leading "H/O" ("history of")
// prefix — either "H/O " or "H/O:" — was added to this same first-pass scan
// 2026-07-25 (LEGACY_HO_PREFIX_RE in shared/legacy-coded-description.js) —
// see that file's own comment for why it's safe by the same
// same-concept-only construction as the other legacy markers regardless of
// this correlation: descriptionId is never used as a detection gate
// (looksOutdated() is purely text-pattern-based), only ever available as a
// bonus confirmatory signal once a candidate is already flagged and fetched.
//
// CODING-SPECIFICITY EXTENSION (2026-07-23): the same click that opens this
// panel also checks for a laterality hint (rt/right, lt/left, bilateral) in
// the edit-form's `additionalInformation` free text not already reflected in
// the current description, and — if found — offers DESCENDANT concepts of
// the current code (e.g. "Fracture of radius" -> "Fracture of right
// radius"), not just same-concept synonyms. This is a materially different,
// higher-risk operation (a real re-code, not a cosmetic relabel) — see
// shared/coding-specificity.js for the full contract and the descendant
// safety test. DELIBERATE SCOPE DECISION: this only ever runs for problems
// ALREADY flagged as outdated (same trigger population as the description
// fix above) — no new proactive per-patient scanning, no new opt-in
// affordance, because `additionalInformation` isn't available without a
// per-problem fetch and this reuses the one the clinician already triggered.
// Running this across the WHOLE record (every problem, not just outdated
// ones; other entity types) was explicitly deferred, not built here.
//
// CROSS-CONCEPT EXTENSION (2026-07-23): the same click/fetch also checks for
// a DIFFERENT SNOMED concept whose description is textually identical to the
// current one once legacy markers are stripped (e.g. "[X]Heroin addiction"
// -> a different concept, "Heroin addiction") — the case
// sameConceptAlternatives can never catch, since it's a different conceptId
// by definition. This is the riskiest of the three categories (no
// same-concept guarantee, no hierarchy proof) so it renders in its own
// warning-flagged section — see shared/coding-specificity.js's
// crossConceptAlternatives for the full contract and its scope limits (exact
// text match only, not clinical-relatedness).
//
// WORD-MISMATCH FIX (2026-07-23): a legacy NEC-labelled problem ("Primary
// total knee replacement NEC") returned ZERO search results at all — not a
// filtering bug, the search itself. Medicus's search requires every query
// word present in a result; the real modern descendants ("Total replacement
// of left/right knee joint") don't contain "Primary" anywhere, so the whole
// query silently failed, taking same-concept AND descendant suggestions down
// with it. See searchDescendantsNarrowed's comment near SEARCH_PATH for the
// two confirmed-live supplementary searches that fix this.
//
// HINT-EXPANDED EXTENSION (2026-07-23): a DIFFERENT symptom from the
// word-mismatch bug — a legacy "[SO]Rotator cuff" problem got no suggestion
// of any kind because 7885001 is a SNOMED BODY STRUCTURE concept (an
// anatomical site), not a disorder, so it can never appear in the
// disorder/procedure search same-concept or cross-concept-exact ever
// matches. When same-concept, descendant, AND cross-concept-exact all come
// back empty, openPanel tries ONE more fallback search: the base description
// plus a recognised pathology word (see PATHOLOGY_HINT_WORDS in
// shared/coding-specificity.js) found in additionalInformation's first
// sentence — e.g. "Rotator cuff" + "tear" -> finds 926335004 "Rotator cuff
// tear". This is the riskiest category of the four (no hierarchy proof, and
// two combined text fragments rather than one exact match), so it renders in
// its own most-cautious red section. Per explicit discussion with the user:
// an anatomical structure should never really be coded as a "problem" in its
// own right, which is what makes this safe to offer for a single flagged
// problem now — but this category must NEVER be bulk-auto-applied if/when a
// whole-record bulk-correction feature is built later, unlike same-concept
// and cross-concept-exact matches which could eventually be "easy" bulk
// cases.
'use strict';

(function () {
  // ── Shared generic detection/safety-filter (looksOutdated,
  // stripLegacyMarkers, sameConceptAlternatives) ──────────────────────────────
  var shared =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/legacy-coded-description.js')
      : window.MSLegacyCodedDescription;
  var looksOutdated = shared.looksOutdated;

  // ── Shared "coding specificity" (descendant/laterality) helpers ─────────────
  var codingSpecificity =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/coding-specificity.js')
      : window.MSCodingSpecificity;
  var detectLateralityHint = codingSpecificity.detectLateralityHint;
  var descriptionAlreadySpecifiesLaterality = codingSpecificity.descriptionAlreadySpecifiesLaterality;
  var descendantAlternatives = codingSpecificity.descendantAlternatives;
  var crossConceptAlternatives = codingSpecificity.crossConceptAlternatives;
  var detectPathologyHint = codingSpecificity.detectPathologyHint;
  var detectAnatomicalSiteHint = codingSpecificity.detectAnatomicalSiteHint;
  var descriptionAlreadyMentionsHint = codingSpecificity.descriptionAlreadyMentionsHint;
  var hintExpandedAlternatives = codingSpecificity.hintExpandedAlternatives;
  var significantWords = codingSpecificity.significantWords;

  // ── Shared SNOMED-retirement parsing (active/inactivationReason/replacement) ──
  var snomedRetirement =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/snomed-retirement.js')
      : window.MSSnomedRetirement;
  var parseConceptRetirement = snomedRetirement.parseConceptRetirement;
  var buildConceptUrl = snomedRetirement.buildConceptUrl;

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
  // overrideAdditionalInformation (optional, added 2026-07-25 for the
  // generic-additional-info-text cleanup below): when passed, replaces
  // p.additionalInformation entirely — used for the ONE apply path that
  // changes additionalInformation instead of problemCode (removing known
  // GP2GP boilerplate lines), keeping problemCode itself untouched. Omitted
  // (undefined) preserves the original behaviour exactly for every existing
  // caller, which all change problemCode and never additionalInformation.
  //
  // OPTION-OBJECT ROUND-TRIP (found live 2026-07-27, the first "API 400"
  // apply failure — an EMIS-imported problem, the first ever seen with a
  // non-null episode): the GET prefill returns select-backed fields as the
  // SELECTED OPTION OBJECT (`episode: {value:"subsequent",label:"Subsequent"}`),
  // but the POST contract takes the bare enum value — compare `significance`,
  // a plain "major" string in BOTH directions of the confirmed capture, and
  // the staff[] options list, whose {value,label} entries exist precisely so
  // the form can submit `.value`. Every previously-confirmed apply happened
  // to be on an episode:null problem, so round-tripping the whole object
  // never surfaced until now. unwrapOptionValue() takes `.value` from
  // anything shaped exactly like an option ({value,label}) and passes every
  // other shape through untouched — deliberately strict, so a REAL object
  // field (recordedByOrganisation's {organisationName,...}) can never be
  // mangled by it.
  function unwrapOptionValue(field) {
    if (field && typeof field === 'object' && 'value' in field && 'label' in field) return field.value;
    return field;
  }

  function buildEditProblemPayload(prefill, newProblemCode, overrideAdditionalInformation) {
    var p = prefill || {};
    var additionalInformation =
      overrideAdditionalInformation !== undefined
        ? overrideAdditionalInformation
        : p.additionalInformation != null
          ? p.additionalInformation
          : null;
    var payload = {
      onsetDate: p.onsetDate != null ? p.onsetDate : null,
      contextId: p.contextId != null ? p.contextId : null,
      contextType: p.contextType != null ? p.contextType : null,
      significance: p.significance != null ? unwrapOptionValue(p.significance) : null,
      episode: p.episode != null ? unwrapOptionValue(p.episode) : null,
      problemCode: newProblemCode,
      additionalInformation: additionalInformation,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      endDate: p.endDate != null ? p.endDate : null,
      reasonEnded: p.reasonEnded != null ? unwrapOptionValue(p.reasonEnded) : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
    };
    if (p.recordedAtAnotherOrganisation) {
      payload.recordedByOrganisation = p.recordedByOrganisation != null ? p.recordedByOrganisation : null;
      payload.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      payload.recordedByStaff = p.recordedByStaff != null ? unwrapOptionValue(p.recordedByStaff) : null;
    }
    return payload;
  }

  // Turns a non-2xx API response into an error message that actually says
  // WHY the server refused. A bare "API 400" cost a live round (2026-07-27,
  // an edit-problem apply rejected on a real patient with nothing to act
  // on): Medicus validation failures carry a response body naming the
  // offending field, and apiFetch was discarding it. Best-effort extraction:
  // prefer the common message fields of a JSON body, fall back to the raw
  // body text, truncate hard (the UI renders this inline in a small panel),
  // and never throw — a diagnostic that crashes is worse than none. The
  // caller renders the result through esc(), so raw server text is safe to
  // include here.
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

  // Bridges the termbrowser API's confirmed REPLACED BY conceptId (see
  // shared/snomed-retirement.js) into something actually POST-able to
  // Medicus: Medicus's edit-problem contract needs a {description, conceptId,
  // descriptionId} sourced from MEDICUS'S OWN search index (same shape
  // sameConceptAlternatives/crossConceptAlternatives already produce), not
  // raw SNOMED RF2 data straight from termbrowser — a descriptionId invented
  // from a different data source wouldn't necessarily match what Medicus's
  // own index has for that concept and could behave unexpectedly on save.
  // Deliberately DIFFERENT from crossConceptAlternatives: this is matched by
  // conceptId ONLY (not by text at all) — the replacement is already
  // confirmed by SNOMED itself, so no text-similarity check is needed or
  // wanted. Returns null (never guesses) if Medicus's own search doesn't
  // have this concept indexed at all — the confirmed replacement still
  // exists, it just isn't offered as a one-click button; the caller shows
  // the concept's own name as a manual-search pointer instead.
  function confirmedReplacementAlternative(results, replacementConceptId) {
    if (!Array.isArray(results) || !replacementConceptId) return null;
    var match = results.find(function (r) {
      var v = r && r.value;
      return !!(v && v.conceptId === replacementConceptId);
    });
    if (!match) return null;
    var v = match.value;
    return { description: v.description, conceptId: v.conceptId, descriptionId: v.descriptionId || null };
  }

  // Manual-search results (2026-07-25, explicit user request — the "H/O:
  // urinary disease-UTI's" case, where "UTIs" is neither a same-concept
  // synonym, a hierarchy descendant, nor a text match of the current
  // description, so none of the automated categories above could ever find
  // it): normalises a RAW, UNFILTERED Medicus search response into
  // {description, conceptId, descriptionId}[] — deliberately NOT filtered by
  // conceptId at all, unlike every other function in this file. This is the
  // ONE category with no automated safety constraint whatsoever — the
  // clinician can pick any concept the search returns, exactly like
  // Medicus's own Edit Problem search box. Deduped by descriptionId (falling
  // back to conceptId+description, since results can span many different
  // concepts here, unlike sameConceptAlternatives' single-concept dedup).
  function normalizedSearchResults(results) {
    if (!Array.isArray(results)) return [];
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || !v.conceptId) return;
      var key = v.descriptionId || v.conceptId + '|' + v.description;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ description: v.description, conceptId: v.conceptId, descriptionId: v.descriptionId || null });
    });
    return out;
  }

  // Legacy Read-code-derived description detection (2026-07-25, explicit
  // user request, real example: 359609001 "Acute nonsupp. otitis media R",
  // problemCode.originalCodes: [{codeSystem:"read-v2", code:"F510.00",
  // description:"Acute non suppurative otitis media"}]). A DIFFERENT,
  // STRUCTURAL signal from every other detection in this file — not a text
  // pattern (this description contains no "[X]"/NOS/NEC/H-O marker at all,
  // so looksOutdated() would never catch it) and not concept retirement
  // (359609001 can be perfectly active/current) — the concept itself may be
  // entirely correctly forward-mapped, but the DESCRIPTION TEXT still
  // carries the old Read code's own abbreviated wording ("nonsupp.", a bare
  // "R" for right) verbatim. Per the user: these "almost always need
  // cleaned up even where they've been forward-mapped to a valid SNOMED
  // code" — so this flags independently of retirement status. Only
  // "read-v2" is checked (confirmed on TWO real examples so far — see the
  // retirement work's own 184063008 capture) — a different codeSystem value
  // (e.g. a CTV3/read-v3 variant) would need its own live confirmation
  // before being added, same discipline as every other code list in this
  // repo. Only available from the FULL edit-problem prefill (never the
  // cheap clinical-summary list), so — like retirement — this can only ever
  // be checked by the opt-in scan, never the automatic per-load text scan.
  function findLegacyReadCodeOrigin(originalCodes) {
    if (!Array.isArray(originalCodes)) return null;
    var match = originalCodes.find(function (oc) {
      return oc && oc.codeSystem === 'read-v2';
    });
    if (!match) return null;
    return { code: match.code, description: match.description };
  }

  // Generic GP2GP-import additionalInformation text (2026-07-25, explicit
  // user request, real example: additionalInformation "ear\nActive Problem,
  // Significant" — "ear" is a genuine free-text note, the second line is
  // pure boilerplate restating problemStatus/significance metadata already
  // captured structurally elsewhere on the problem). rules/
  // generic-additional-info-text.json holds the list of known generic
  // lines. Matching is PER LINE (split on "\n", trimmed, case-insensitive
  // exact match) — NEVER against the whole field — so a genuine free-text
  // line sharing the field with a generic one is always preserved. Returns
  // {cleaned, removed}: `removed` is the matched line(s) (empty if none —
  // callers check removed.length, not truthiness, to decide whether
  // anything is offered), `cleaned` is additionalInformation with those
  // lines stripped and surrounding whitespace trimmed, ready to submit as
  // the override to buildEditProblemPayload above.
  function stripGenericAdditionalInfoLines(additionalInformation, genericTexts) {
    var text = additionalInformation == null ? '' : String(additionalInformation);
    var genericSet = (Array.isArray(genericTexts) ? genericTexts : [])
      .map(function (t) {
        return String(t == null ? '' : t)
          .trim()
          .toLowerCase();
      })
      .filter(Boolean);
    var kept = [];
    var removed = [];
    text.split('\n').forEach(function (line) {
      var trimmed = line.trim();
      if (trimmed && genericSet.indexOf(trimmed.toLowerCase()) !== -1) {
        removed.push(trimmed);
      } else {
        kept.push(line);
      }
    });
    return { cleaned: kept.join('\n').trim(), removed: removed };
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
      LEGACY_TRAILING_ABBREVIATION_RE: shared.LEGACY_TRAILING_ABBREVIATION_RE,
      LEGACY_HO_PREFIX_RE: shared.LEGACY_HO_PREFIX_RE,
      // Re-exported from shared/coding-specificity.js, same reasoning.
      detectLateralityHint: codingSpecificity.detectLateralityHint,
      descriptionAlreadySpecifiesLaterality: codingSpecificity.descriptionAlreadySpecifiesLaterality,
      descendantAlternatives: codingSpecificity.descendantAlternatives,
      crossConceptAlternatives: codingSpecificity.crossConceptAlternatives,
      detectPathologyHint: codingSpecificity.detectPathologyHint,
      detectAnatomicalSiteHint: codingSpecificity.detectAnatomicalSiteHint,
      ANATOMICAL_SITE_HINT_WORDS: codingSpecificity.ANATOMICAL_SITE_HINT_WORDS,
      descriptionAlreadyMentionsHint: codingSpecificity.descriptionAlreadyMentionsHint,
      hintExpandedAlternatives: codingSpecificity.hintExpandedAlternatives,
      significantWords: codingSpecificity.significantWords,
      // Re-exported from shared/snomed-retirement.js, same reasoning.
      parseConceptRetirement: snomedRetirement.parseConceptRetirement,
      buildConceptUrl: snomedRetirement.buildConceptUrl,
      // Problem-specific.
      buildEditProblemPayload,
      unwrapOptionValue,
      apiErrorMessage,
      findOutdatedProblems,
      confirmedReplacementAlternative,
      normalizedSearchResults,
      findLegacyReadCodeOrigin,
      stripGenericAdditionalInfoLines,
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

  function fetchEditProblemForm(problemId) {
    return apiFetch('/clinical/data/problem/edit-problem/' + encodeURIComponent(problemId));
  }

  // Same endpoint content-scripts/problem-junk-code-cleanup.js already uses
  // (GET clinical/data/problem/slideover/overview/{problemId}) — used HERE
  // only to read problemCode.originalCodes for the legacy-Read-code check
  // (findLegacyReadCodeOrigin's own comment has the full story on why this
  // is a SEPARATE fetch from fetchEditProblemForm above, not a re-read of
  // the same data: originalCodes is confirmed present on THIS shape, not
  // confirmed on edit-problem's problemCode.value shape that openPanel's
  // apply flow relies on).
  function fetchProblemOverview(problemId) {
    return apiFetch('/clinical/data/problem/slideover/overview/' + encodeURIComponent(problemId));
  }

  // outputParentConceptIds=1 is additive — harmless for the existing
  // same-concept search, and it's what unlocks descendant/laterality
  // suggestions below (confirmed live 2026-07-23: every result carries a
  // parentConceptIds ancestor-closure array).
  var SEARCH_PATH =
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&outputParentConceptIds=1&query=';

  function searchDescriptions(queryText) {
    return apiFetch(SEARCH_PATH + encodeURIComponent(queryText)).then(function (data) {
      return (data && data.results) || [];
    });
  }

  // WORD-MISMATCH BUG (found live 2026-07-23, patient with "Primary total
  // knee replacement NEC" — a legacy Read-code-migration label): Medicus's
  // search requires EVERY word in the query to be present in a result's
  // description (order-independent, but not fuzzy/partial). The real
  // modern SNOMED descendants are worded "Total replacement of left/right
  // knee joint" — no "Primary" anywhere — so a query built from the
  // stripped legacy text ("Primary total knee replacement") returned ZERO
  // results, silently breaking BOTH the same-concept alternatives above AND
  // the descendant search below, for any legacy code with this property.
  //
  // Two confirmed-live fixes, both supplementary (never replace the
  // existing broad query, only add candidates to it):
  //   1. `query=<conceptId>` (a bare SCTID, not free text) reliably returns
  //      THAT concept's own synonyms regardless of text phrasing — used
  //      below to supplement the same-concept search.
  //   2. Narrowing `constrainingParentConcepts` to the CURRENT concept's own
  //      ID (instead of the six broad top-level hierarchies) scopes the
  //      search to true descendants only, so a bare laterality word
  //      ("left"/"right"/"bilateral") is enough to find them — no
  //      dependency on the parent's own (possibly mismatched) wording.
  //      Used below to supplement the descendant/laterality search.
  function searchDescendantsNarrowed(parentConceptId, queryText) {
    var path =
      '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=' +
      encodeURIComponent(parentConceptId) +
      '&outputParentConceptIds=1&query=' +
      encodeURIComponent(queryText);
    return apiFetch(path).then(function (data) {
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

  // Loads rules/generic-additional-info-text.json ONCE per page load — a
  // local extension resource, not a Medicus call. Falls back to an empty
  // list (never throws) if the resource is unavailable, same "fail open to
  // inert, not to a crash" discipline as ensureNonProblemRootsLoaded in
  // content-scripts/problem-junk-code-cleanup.js.
  var _genericAdditionalInfoPromise = null;
  function ensureGenericAdditionalInfoTextLoaded() {
    if (_genericAdditionalInfoPromise) return _genericAdditionalInfoPromise;
    _genericAdditionalInfoPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/generic-additional-info-text.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.entries)
          ? doc.entries
              .map(function (e) {
                return e && e.text;
              })
              .filter(Boolean)
          : [];
      } catch (e) {
        return [];
      }
    })();
    return _genericAdditionalInfoPromise;
  }

  // ── Retirement check (public NHS termbrowser API — a SEPARATE, no-auth
  // external host, not Medicus's own API) ──────────────────────────────────
  // See rules/snomed-terminology-server.json's own notes for why this API
  // and not the official NHS England Terminology Server FHIR API (that one
  // needs a system-to-system account, which can't be safely embedded in a
  // distributed browser extension).
  var _termServerConfigPromise = null;
  function ensureTermServerConfigLoaded() {
    if (_termServerConfigPromise) return _termServerConfigPromise;
    _termServerConfigPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/snomed-terminology-server.json');
        return await fetch(url).then(function (r) {
          return r.json();
        });
      } catch (e) {
        return null;
      }
    })();
    return _termServerConfigPromise;
  }

  // Fails closed to {active: null, ...} (via parseConceptRetirement) on ANY
  // problem — network error, non-2xx, malformed JSON, or the real
  // wrong-release-string response (a bare `false`, confirmed live
  // 2026-07-25) — never guesses a concept is active or inactive when the
  // check itself didn't cleanly succeed. Callers must treat active:null as
  // "skip", the same discipline as every other fail-open-to-inert pattern
  // in this codebase.
  async function fetchRetirementStatus(conceptId) {
    try {
      var config = await ensureTermServerConfigLoaded();
      var url = buildConceptUrl(config, conceptId);
      if (!url) return parseConceptRetirement(null);
      var resp = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
      if (!resp.ok) return parseConceptRetirement(null);
      var text = await resp.text();
      var data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return parseConceptRetirement(null);
      }
      return parseConceptRetirement(data);
    } catch (e) {
      return parseConceptRetirement(null);
    }
  }

  // ── DOM: finding each flagged problem's row ──────────────────────────────────
  // Confirmed live 2026-07-22 (Clinical Summary tab): each problem renders as
  // <li class="item"><a class="item__link …">{description}</a>{date}</li> —
  // matches engine/extractors/problems.js's own `li.item` selector for this
  // exact page. Matched by EXACT trimmed text against the description
  // clinical-summary/summary already gave us — same "match by known string"
  // discipline already proven safe for the attachment-detection work.
  //
  // DUPLICATE-DESCRIPTION BUG (found live 2026-07-23, fixed here): a patient
  // can have TWO separate problem entries with the IDENTICAL description
  // text (e.g. two "[X]Depression NOS" entries, different problemIds). Text
  // matching alone can't tell them apart — without `claimedAnchors`, both
  // problems would resolve to the SAME first-matching `<a>`, so both buttons
  // stacked on the first row (none on the second), and worse, the optimistic
  // post-save text update for EITHER problem would hit that same shared
  // anchor. `claimedAnchors` makes each call skip anchors already claimed by
  // an earlier problem in the same scan pass, so the Nth problem with
  // matching text claims the Nth matching DOM row, in document order — each
  // problemId gets its own distinct anchor. (The underlying SAVE was never
  // affected by this bug — postEditProblem always targets the real,
  // correct problemId regardless of DOM matching; only button placement and
  // the on-screen optimistic update were wrong.) Residual risk, accepted:
  // if Medicus ever reorders duplicate-text rows between scans, the two
  // problemIds could swap which physical row they're bound to — narrow edge
  // case, not solved here.
  function findProblemRow(description, claimedAnchors) {
    var links = document.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (claimedAnchors && claimedAnchors.has(a)) continue;
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
        additionalInformation: null,
        alternatives: null,
        laterality: null,
        descendantAlternatives: null,
        crossConceptAlternatives: null,
        hintExpandedAlternatives: null,
        retiredInfo: null, // {inactivationReason, replacement} — set by the opt-in retirement scan, never by the automatic text scan
        confirmedReplacement: null, // {description, conceptId, descriptionId} resolved from Medicus's own search, or null
        legacyReadCode: null, // {code, description} — set by the opt-in scan when originalCodes shows a read-v2 origin
        genericAdditionalInfo: null, // {cleaned, removed} — computed in openPanel from prefill.additionalInformation, ANY row
        genericAdditionalInfoSaving: false,
        manualSearchQuery: '',
        manualSearchResults: null,
        manualSearchLoading: false,
        manualSearchError: null,
        saving: false,
        saved: false,
      };
    }
    return _rows[problemId];
  }

  // Retirement banner — only rendered for rows flagged by the opt-in
  // retirement scan (st.retiredInfo set), never for text-flagged rows. Three
  // shapes, from best to worst evidence: a confirmed replacement Medicus's
  // own search recognises (one-click button, HIGHEST trust — SNOMED itself
  // names this as the successor, no text-similarity guess involved); a
  // confirmed replacement SNOMED names but Medicus's own search doesn't
  // recognise (informational only — nothing safe to offer a button for);
  // no replacement recorded at all (informational only — the suggestions
  // below, if any, are the clinician's best remaining option).
  function retiredInfoHtml(problemId, st) {
    if (!st.retiredInfo) return '';
    var reason = st.retiredInfo.inactivationReason;
    var reasonText = reason ? esc(reason.description) : 'unspecified reason';
    var html =
      '<div class="ms-pdc-retired-note">⚠ This code has been RETIRED by SNOMED CT (' + reasonText + ').</div>';
    if (st.confirmedReplacement) {
      html +=
        '<div class="ms-pdc-retired-replacement-section">' +
        '<span class="ms-pdc-retired-replacement-label">✓ SNOMED confirms the replacement code:</span>' +
        '<div class="ms-pdc-panel">' +
        '<button type="button" class="ms-pdc-retired-replacement-btn" data-problem-id="' +
        esc(problemId) +
        '">' +
        esc(st.confirmedReplacement.description) +
        '</button>' +
        '</div></div>';
    } else if (st.retiredInfo.replacement) {
      html +=
        '<div class="ms-pdc-retired-replacement-unmatched">SNOMED replaced this code with "' +
        esc(st.retiredInfo.replacement.description) +
        '" but it could not be matched in Medicus’s own search index — try the manual search below (it may need a different SNOMED hierarchy scope than this panel searches by default).</div>';
    } else {
      html +=
        '<div class="ms-pdc-retired-no-replacement">No automatic replacement is recorded for this retirement — review the suggestions below, or try the manual search further down this panel.</div>';
    }
    return html;
  }

  // Legacy Read-code-origin banner (2026-07-25) — see
  // findLegacyReadCodeOrigin's own comment for the full detection story.
  // Purely informational, same family as retiredInfoHtml's neutral notes —
  // this ISN'T saying the code is wrong, just that its description text is
  // Read-code-derived and worth checking against the suggestions below.
  function legacyReadCodeHtml(st) {
    if (!st.legacyReadCode) return '';
    return (
      '<div class="ms-pdc-legacy-readcode-note">ℹ This description is derived from an old Read code (' +
      esc(st.legacyReadCode.code) +
      ' “' +
      esc(st.legacyReadCode.description) +
      '”) — even if the SNOMED code itself is current, review the suggestions below for a clearer modern wording.</div>'
    );
  }

  // Generic-additional-info-text cleanup (2026-07-25) — see
  // stripGenericAdditionalInfoLines' own comment for the full story. Changes
  // additionalInformation only, NEVER problemCode — the safest apply path in
  // this whole file (surgical removal of an exact-matched known-boilerplate
  // line, no coding decision involved at all), so styled plainly rather than
  // with any of the risk-graded palettes above.
  function genericAdditionalInfoHtml(problemId, st) {
    if (!st.genericAdditionalInfo) return '';
    var lines = st.genericAdditionalInfo.removed;
    return (
      '<div class="ms-pdc-genericinfo-section">' +
      '<span class="ms-pdc-genericinfo-label">Generic import text found in Additional info (' +
      lines.map(esc).join(', ') +
      '):</span>' +
      '<button type="button" class="ms-pdc-genericinfo-btn" data-problem-id="' +
      esc(problemId) +
      '"' +
      (st.genericAdditionalInfoSaving ? ' disabled' : '') +
      '>' +
      (st.genericAdditionalInfoSaving ? 'Removing…' : 'Remove generic import text') +
      '</button>' +
      '</div>'
    );
  }

  // Manual search box (2026-07-25) — the ONE section always rendered
  // regardless of whether any automated category above found anything (see
  // panelHtml's call sites: it's appended in BOTH the early "nothing found"
  // return and the normal path), since it exists specifically to cover
  // cases none of the automated categories can reach. Deliberately styled
  // and labelled as distinct from every category above — this is the only
  // one with NO automated safety constraint, functionally identical to
  // typing into Medicus's own Edit Problem search box.
  function manualSearchHtml(problemId, st) {
    var results = st.manualSearchResults || [];
    var html =
      '<div class="ms-pdc-manualsearch-section">' +
      '<span class="ms-pdc-manualsearch-label">Or search manually — no automated check, same as Medicus’s own search:</span>' +
      '<div class="ms-pdc-manualsearch-row">' +
      '<input type="text" class="ms-pdc-manualsearch-input" data-problem-id="' +
      esc(problemId) +
      '" placeholder="e.g. UTI" value="' +
      esc(st.manualSearchQuery || '') +
      '">' +
      '<button type="button" class="ms-pdc-manualsearch-btn" data-problem-id="' +
      esc(problemId) +
      '"' +
      (st.manualSearchLoading ? ' disabled' : '') +
      '>' +
      (st.manualSearchLoading ? 'Searching…' : 'Search') +
      '</button>' +
      '</div>';
    if (st.manualSearchError) {
      html += '<div class="ms-pdc-manualsearch-error">' + esc(st.manualSearchError) + '</div>';
    } else if (st.manualSearchResults !== null) {
      html += results.length
        ? '<div class="ms-pdc-panel">' +
          results
            .map(function (a) {
              return (
                '<button type="button" class="ms-pdc-manualsearch-result" data-problem-id="' +
                esc(problemId) +
                '" data-concept-id="' +
                esc(a.conceptId) +
                '" data-description-id="' +
                esc(a.descriptionId || '') +
                '">' +
                esc(a.description) +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '<div class="ms-pdc-manualsearch-empty">No results.</div>';
    }
    html += '</div>';
    return html;
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
    var descendants = st.descendantAlternatives || [];
    var crossConcept = st.crossConceptAlternatives || [];
    var hintExpanded = st.hintExpandedAlternatives || [];
    // Surfaced regardless of whether any suggestion was found — supports the
    // clinician's own judgement call even when the tool has nothing to
    // offer (e.g. a "[SO]"/NEC code the search can't currently match).
    var infoHtml =
      (st.additionalInformation
        ? '<div class="ms-pdc-additional-info"><span class="ms-pdc-additional-info-label">Additional info:</span> ' +
          esc(st.additionalInformation) +
          '</div>'
        : '') +
      genericAdditionalInfoHtml(problemId, st) +
      retiredInfoHtml(problemId, st) +
      legacyReadCodeHtml(st);
    if (!alts.length && !descendants.length && !crossConcept.length && !hintExpanded.length) {
      return (
        infoHtml +
        '<div class="ms-pdc-panel"><span class="ms-pdc-empty">No alternative description found for this code.</span></div>' +
        manualSearchHtml(problemId, st)
      );
    }
    var html = infoHtml;
    if (alts.length) {
      html +=
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
        '</div>';
    }
    if (descendants.length) {
      // Deliberately separate from the same-concept panel above and labelled
      // to make the semantic difference obvious: this changes the CODE, not
      // just its label — a real coding decision, never auto-applied.
      html +=
        '<div class="ms-pdc-descendant-section">' +
        '<span class="ms-pdc-descendant-label">Additional info suggests a more specific code:</span>' +
        '<div class="ms-pdc-panel">' +
        descendants
          .map(function (a) {
            // matchScore (0-100): the % of free-text hint words found in
            // this candidate's own wording — RANKING signal only (ancestry
            // + "at least one word" already guarantee safety), shown so the
            // clinician can judge relevance at a glance across candidates,
            // e.g. "removal of uterine fibroid" (67%) vs "removal of uterine
            // myoma" (33%) for the same additional info.
            var scoreHtml =
              typeof a.matchScore === 'number'
                ? ' <span class="ms-pdc-descendant-score">(' + a.matchScore + '% match)</span>'
                : '';
            return (
              '<button type="button" class="ms-pdc-descendant" data-problem-id="' +
              esc(problemId) +
              '" data-description-id="' +
              esc(a.descriptionId || '') +
              '">' +
              esc(a.description) +
              scoreHtml +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '</div>';
    }
    if (crossConcept.length) {
      // Deliberately flagged, not just a third plain section: this is the
      // riskiest category (a text match to a DIFFERENT concept, no
      // hierarchy proof) — amber warning styling + explicit copy so a
      // clinician doesn't mistake it for a same-concept relabel.
      html +=
        '<div class="ms-pdc-crossconcept-section">' +
        '<span class="ms-pdc-crossconcept-label">⚠ Different SNOMED code, same description — verify before applying:</span>' +
        '<div class="ms-pdc-panel">' +
        crossConcept
          .map(function (a) {
            return (
              '<button type="button" class="ms-pdc-crossconcept" data-problem-id="' +
              esc(problemId) +
              '" data-concept-id="' +
              esc(a.conceptId) +
              '" data-description-id="' +
              esc(a.descriptionId || '') +
              '">' +
              esc(a.description) +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '</div>';
    }
    if (hintExpanded.length) {
      // The MOST cautious category — riskier than crossConcept above, since
      // it combines two text fragments (base description + a pathology word
      // found in free-text notes) rather than one verified exact match, and
      // has no hierarchy proof either. Never eligible for future bulk
      // auto-correction — see shared/coding-specificity.js.
      html +=
        '<div class="ms-pdc-hintexpand-section">' +
        '<span class="ms-pdc-hintexpand-label">⚠ Inferred from additional notes — verify carefully before applying:</span>' +
        '<div class="ms-pdc-panel">' +
        hintExpanded
          .map(function (a) {
            return (
              '<button type="button" class="ms-pdc-hintexpand" data-problem-id="' +
              esc(problemId) +
              '" data-concept-id="' +
              esc(a.conceptId) +
              '" data-description-id="' +
              esc(a.descriptionId || '') +
              '">' +
              esc(a.description) +
              '</button>'
            );
          })
          .join('') +
        '</div>' +
        '</div>';
    }
    html += manualSearchHtml(problemId, st);
    return html;
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
    root.querySelectorAll('.ms-pdc-descendant').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyDescendant(problemId, btn.getAttribute('data-description-id'));
      });
    });
    root.querySelectorAll('.ms-pdc-crossconcept').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyCrossConcept(problemId, btn.getAttribute('data-concept-id'), btn.getAttribute('data-description-id'));
      });
    });
    root.querySelectorAll('.ms-pdc-hintexpand').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyHintExpanded(problemId, btn.getAttribute('data-concept-id'), btn.getAttribute('data-description-id'));
      });
    });
    root.querySelectorAll('.ms-pdc-retired-replacement-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyConfirmedReplacement(problemId);
      });
    });
    root.querySelectorAll('.ms-pdc-manualsearch-result').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyManualSearchResult(
          problemId,
          btn.getAttribute('data-concept-id'),
          btn.getAttribute('data-description-id')
        );
      });
    });
    var searchInput = root.querySelector('.ms-pdc-manualsearch-input');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        rowState(problemId).manualSearchQuery = e.target.value;
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          runManualSearch(problemId);
        }
      });
    }
    var searchBtn = root.querySelector('.ms-pdc-manualsearch-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', function () {
        runManualSearch(problemId);
      });
    }
    root.querySelectorAll('.ms-pdc-genericinfo-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyRemoveGenericAdditionalInfo(problemId);
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
      // Reuse the prefill already fetched by the retirement scan (see
      // runRetiredCodesScan) when this row was flagged that way, instead of
      // re-fetching the identical edit-problem form a second time.
      var prefill = st.prefill || (await fetchEditProblemForm(problemId));
      var code = prefill && prefill.problemCode && prefill.problemCode.value;
      if (!code || !code.conceptId) throw new Error('Could not read this problem’s code.');
      st.prefill = prefill;
      st.conceptId = code.conceptId;
      st.currentDescription = code.description;
      st.additionalInformation = prefill.additionalInformation || '';
      // Computed for EVERY open panel, regardless of why this row was
      // flagged — additionalInformation is already in hand here whether the
      // fetch above just ran or was reused from the retirement/legacy-code
      // scan's own cache, so this costs nothing extra (one local extension
      // resource load, cached after the first panel opens).
      var genericTexts = await ensureGenericAdditionalInfoTextLoaded();
      var stripped = stripGenericAdditionalInfoLines(prefill.additionalInformation, genericTexts);
      st.genericAdditionalInfo = stripped.removed.length ? stripped : null;
      var queryText = stripLegacyMarkers(code.description);
      var results = await searchDescriptions(queryText);
      // Supplement with an SCTID-keyed search for the current concept's own
      // synonyms — see searchDescendantsNarrowed's comment above for why:
      // the broad free-text query can return zero results for a legacy
      // description whose wording doesn't literally match any current
      // synonym, and this bypasses that entirely.
      var byConceptId = await searchDescriptions(code.conceptId);
      var combinedResults = results.concat(byConceptId);
      st.alternatives = sameConceptAlternatives(combinedResults, code.conceptId, code.description);
      // Descendant search words: laterality (rt/lt/bilateral) PLUS generic
      // significant words from the WHOLE additionalInformation field (e.g.
      // "resection of uterine fibroid" -> "resection"/"uterine"/"fibroid") —
      // GENERALISED 2026-07-23 from laterality-only, real example:
      // "Hysteroscopy NEC" (233545006) has a confirmed genuine descendant,
      // 84064003 "Hysteroscopy with removal of uterine fibroid". Deliberately
      // tried ALONGSIDE same-concept alternatives, not just as a last-resort
      // fallback — a clinician may want BOTH a same-concept relabel AND a
      // more-specific descendant offered together (explicit user decision).
      //
      // RETRIEVAL (revised 2026-07-23): a single BLANK-QUERY fetch
      // (searchDescendantsNarrowed with an empty word) confirmed live to
      // return the full descendant set of the current concept directly —
      // `query=` empty bypasses text matching entirely, unlike guessing
      // individual words, which can silently miss a real descendant worded
      // differently (e.g. "Hysteroscopic myomectomy" never contains
      // "fibroid"/"resection"). One fetch, not one per word. Not provably
      // complete — the response has no total/pagination field, so a very
      // broad parent concept could in theory have more descendants than one
      // page returns — but confirmed far more complete than per-word
      // guessing for this real case. hintWords is then used only to RANK the
      // candidates (descendantAlternatives' matchScore), not to retrieve
      // them.
      var laterality = detectLateralityHint(prefill.additionalInformation);
      var hintWords = [];
      if (laterality && !descriptionAlreadySpecifiesLaterality(code.description, laterality)) {
        st.laterality = laterality;
        hintWords.push(laterality);
      } else {
        st.laterality = null;
      }
      significantWords(prefill.additionalInformation).forEach(function (w) {
        if (hintWords.indexOf(w) === -1) hintWords.push(w);
      });
      if (hintWords.length) {
        var allDescendants = await searchDescendantsNarrowed(code.conceptId, '');
        st.descendantAlternatives = descendantAlternatives(
          combinedResults.concat(allDescendants),
          code.conceptId,
          hintWords
        );
      } else {
        st.descendantAlternatives = [];
      }
      st.crossConceptAlternatives = crossConceptAlternatives(combinedResults, code.conceptId, code.description);
      // TRIGGER CONDITION (revised 2026-07-26 — real example: "[M]Tubular
      // adenoma NOS" coded to a RETIRED morphologic-abnormality-axis
      // concept with no IS-A path to the disorder-axis "of colon" family,
      // so descendantAlternatives can never reach it; crossConceptAlternatives
      // DOES find a same-text replacement (a real, separate recode), which
      // under the old "only when ALL THREE other categories are empty" rule
      // meant this fallback never even attempted a site-word search). Now
      // runs whenever same-concept AND descendant are both empty, REGARDLESS
      // of cross-concept-exact — mirrors descendantAlternatives' own
      // alongside-not-fallback trigger. Still the riskiest category (no
      // hierarchy proof, no exact-text guarantee) and still never
      // bulk-auto-applied later — see shared/coding-specificity.js's
      // hintExpandedAlternatives doc for the full contract.
      st.hintExpandedAlternatives = [];
      if (!st.alternatives.length && !st.descendantAlternatives.length) {
        // Pathology (symptom/injury-type) AND anatomical-site hints are
        // both tried — a problem's additionalInformation can carry either
        // or both. Each recognised word gets its OWN supplementary search
        // (never combined into one query): Medicus's search requires EVERY
        // query word to be present in a result, so "Tubular adenoma
        // descending sigmoid colon" as a single query would silently
        // zero-result against a real match worded just "...of colon" (the
        // same word-mismatch failure class already fixed once for the
        // knee-replacement case) — one word per query sidesteps that
        // entirely, and hintExpandedAlternatives (generalised 2026-07-26)
        // now accepts the combined raw results plus the full hint-word
        // list in one filtering pass.
        var pathologyHint = detectPathologyHint(prefill.additionalInformation);
        // detectAnatomicalSiteHint returns an ARRAY (every matched site
        // word, not just one) — see its own comment for why: site words
        // routinely co-occur while naming one concept, and a single pick is
        // at the mercy of curated-list order, not which word the real
        // target concept's description actually uses.
        var siteHints = detectAnatomicalSiteHint(prefill.additionalInformation);
        var expandHints = [pathologyHint].concat(siteHints).filter(function (h) {
          return h && !descriptionAlreadyMentionsHint(code.description, h);
        });
        if (expandHints.length) {
          var expandedResultSets = await Promise.all(
            expandHints.map(function (h) {
              return searchDescriptions(queryText + ' ' + h);
            })
          );
          var expandedResults = [].concat.apply([], expandedResultSets);
          st.hintExpandedAlternatives = hintExpandedAlternatives(expandedResults, code.conceptId, expandHints);
        }
      }
      // Confirmed SNOMED replacement (only set when this row was flagged by
      // the opt-in retirement scan, never by the automatic text scan) — one
      // more search, this time by the REPLACEMENT concept's own conceptId
      // (bare SCTID — see the WORD-MISMATCH FIX comment above for why this
      // reliably returns that concept's own synonyms regardless of text
      // phrasing), to find Medicus's own indexed form of it.
      if (st.retiredInfo && st.retiredInfo.replacement) {
        var replacementConceptId = st.retiredInfo.replacement.conceptId;
        var replacementResults = await searchDescriptions(replacementConceptId);
        st.confirmedReplacement = confirmedReplacementAlternative(replacementResults, replacementConceptId);
        // BODY-STRUCTURE FALLBACK (2026-07-26 — real case: 443897009 "[M]Tubular
        // adenoma NOS", REPLACED BY 1156654007 "Benign tubular adenoma
        // (morphologic abnormality)"). SEARCH_PATH's constrainingParentConcepts
        // scopes to Clinical finding/Procedure/Situation/Social context/Event —
        // a confirmed SNOMED replacement that's itself on the Body structure /
        // morphologic-abnormality axis is invisible to that search regardless of
        // query text, not because Medicus doesn't index it but because this
        // scope pre-emptively excludes that whole hierarchy. Live-confirmed via
        // the public NHS termbrowser API (2026-07-26): 1156654007 genuinely
        // descends from 123037004 "Body structure" (the SAME root already
        // confirmed live for the unrelated Rotator Cuff body-structure case,
        // 2026-07-17) — reuses searchDescendantsNarrowed exactly as-is (already
        // shipped, already used for hierarchy-descendant search elsewhere in
        // this file), just with the replacement's bare conceptId as the query
        // text instead of a hint word. One extra fetch, ONLY when the primary
        // broad search comes up empty — the common case (most replacements ARE
        // disorder/procedure-axis) stays exactly as cheap as before.
        if (!st.confirmedReplacement) {
          var bodyStructureResults = await searchDescendantsNarrowed('123037004', replacementConceptId);
          st.confirmedReplacement = confirmedReplacementAlternative(bodyStructureResults, replacementConceptId);
        }
      } else {
        st.confirmedReplacement = null;
      }
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

  // Core apply path, shared by both the same-concept alternatives (a cosmetic
  // relabel) and the descendant/laterality suggestions (a real code change) —
  // the safety difference between the two is entirely in HOW `chosen` was
  // selected upstream (sameConceptAlternatives vs descendantAlternatives),
  // not in how it's applied here.
  async function applyCode(problemId, chosen) {
    var st = rowState(problemId);
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

  function applyAlternative(problemId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.alternatives || []).find(function (a) {
      return (a.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  function applyDescendant(problemId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.descendantAlternatives || []).find(function (a) {
      return (a.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // Matched by conceptId + descriptionId together (not descriptionId alone,
  // unlike the two lookups above) — crossConceptAlternatives candidates come
  // from DIFFERENT concepts, so descriptionId alone isn't guaranteed unique
  // across them the way it is within a single concept's synonym list.
  function applyCrossConcept(problemId, conceptId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.crossConceptAlternatives || []).find(function (a) {
      return a.conceptId === conceptId && (a.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // Matched by conceptId + descriptionId together, same reasoning as
  // applyCrossConcept — candidates come from different concepts.
  function applyHintExpanded(problemId, conceptId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.hintExpandedAlternatives || []).find(function (a) {
      return a.conceptId === conceptId && (a.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // Only one candidate ever exists here (SNOMED's own confirmed replacement,
  // resolved once in openPanel), so no id-matching needed unlike the lookups
  // above — just apply whatever's already on the row's state.
  function applyConfirmedReplacement(problemId) {
    var st = rowState(problemId);
    return applyCode(problemId, st.confirmedReplacement);
  }

  // Manual search (2026-07-25) — available on every open panel regardless of
  // whether the automated categories above found anything, since it exists
  // specifically for cases none of them can reach (see
  // normalizedSearchResults' own comment for the motivating "UTIs" example).
  // Reuses the SAME broad SEARCH_PATH query the automated categories already
  // use, just without the conceptId/text-match filtering they apply.
  async function runManualSearch(problemId) {
    var st = rowState(problemId);
    var query = (st.manualSearchQuery || '').trim();
    if (!query || st.manualSearchLoading) return;
    st.manualSearchLoading = true;
    st.manualSearchError = null;
    renderPanel(problemId);
    try {
      var results = await searchDescriptions(query);
      st.manualSearchResults = normalizedSearchResults(results);
    } catch (err) {
      st.manualSearchError = (err && err.message) || 'Search failed — please try again.';
      st.manualSearchResults = null;
    } finally {
      st.manualSearchLoading = false;
      renderPanel(problemId);
    }
  }

  // Matched by conceptId + descriptionId together, same reasoning as
  // applyCrossConcept — manual search results can span many different
  // concepts, not just one.
  function applyManualSearchResult(problemId, conceptId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.manualSearchResults || []).find(function (a) {
      return a.conceptId === conceptId && (a.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // Removes the confirmed generic-import line(s) from additionalInformation
  // ONLY — problemCode is resent completely unchanged (buildEditProblemPayload's
  // overrideAdditionalInformation param, see its own comment). Separate from
  // applyCode: that function always changes problemCode and leaves
  // additionalInformation alone; this one is its exact mirror.
  async function applyRemoveGenericAdditionalInfo(problemId) {
    var st = rowState(problemId);
    if (!st.genericAdditionalInfo || st.genericAdditionalInfoSaving || !st.prefill) return;
    var code = st.prefill.problemCode && st.prefill.problemCode.value;
    if (!code) return;
    st.genericAdditionalInfoSaving = true;
    renderPanel(problemId);
    try {
      var payload = buildEditProblemPayload(st.prefill, code, st.genericAdditionalInfo.cleaned);
      await postEditProblem(problemId, payload);
      st.additionalInformation = st.genericAdditionalInfo.cleaned;
      st.prefill = Object.assign({}, st.prefill, { additionalInformation: st.genericAdditionalInfo.cleaned });
      st.genericAdditionalInfo = null;
    } catch (err) {
      st.error = (err && err.message) || 'Failed to remove generic text — please try again.';
    } finally {
      st.genericAdditionalInfoSaving = false;
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

  // ── Code-health scan: opt-in trigger, checks EVERY active problem ──────────
  // (retirement check added 2026-07-25 per explicit user request; the
  // legacy-Read-code check added the same day — see findLegacyReadCodeOrigin
  // and fetchProblemOverview's own comments for that one's full story).
  // Deliberately NOT folded into the automatic per-load text scan above:
  // `looksOutdated()` is a cheap, no-fetch heuristic, but BOTH checks here
  // need a per-problem fetch — retirement needs the conceptId (via
  // edit-problem, the SAME endpoint "Fix description" already uses when
  // clicked) PLUS one external NHS termbrowser fetch per DISTINCT conceptId;
  // the Read-code check needs slideover/overview's problemCode.originalCodes
  // — real per-patient cost, same class as problem-junk-code-cleanup.js's
  // "Bulk remove?" scan, so this is its own opt-in click, never automatic.
  // Internal names below still say "retired" (kept as-is rather than a
  // mechanical rename across every identifier) even though the scan and its
  // button now cover both signals — see the button's own label text for
  // what's actually shown to the clinician. A flagged row gets its "Fix
  // description" button injected (reusing injectFixButton, which already
  // de-dupes against a row already flagged by the text scan) with
  // st.retiredInfo and/or st.legacyReadCode pre-populated — see
  // retiredInfoHtml/legacyReadCodeHtml/openPanel above for how those render
  // and reuse the cached prefill.

  var _retiredScanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _retiredScanError = null;
  var _retiredFlaggedCount = 0;

  async function runRetiredCodesScan() {
    _retiredScanState = 'scanning';
    _retiredScanError = null;
    renderRetiredWidget();
    try {
      if (!_problemsCache || !_problemsCache.length) throw new Error('No active problems to check.');
      // Pre-claim anchors already used by text-flagged rows so this scan's
      // own findProblemRow calls can't collide with them on duplicate text —
      // same discipline findOutdatedProblems' own scan already relies on.
      var claimedAnchors = new Set();
      findOutdatedProblems(_problemsCache).forEach(function (p) {
        var row = findProblemRow(p.problemCodeDescription, claimedAnchors);
        if (row) claimedAnchors.add(row);
      });
      var prefillsById = Object.create(null);
      var overviewsById = Object.create(null);
      await Promise.all(
        _problemsCache.map(function (p) {
          return Promise.all([
            fetchEditProblemForm(p.id)
              .then(function (prefill) {
                prefillsById[p.id] = prefill;
              })
              .catch(function () {
                prefillsById[p.id] = null;
              }),
            fetchProblemOverview(p.id)
              .then(function (overview) {
                overviewsById[p.id] = overview;
              })
              .catch(function () {
                overviewsById[p.id] = null;
              }),
          ]);
        })
      );
      // One retirement-status fetch per DISTINCT conceptId, never one per
      // problem — same discipline as problem-junk-code-cleanup.js.
      var conceptIdByProblemId = Object.create(null);
      var distinctConceptIds = [];
      _problemsCache.forEach(function (p) {
        var prefill = prefillsById[p.id];
        var code = prefill && prefill.problemCode && prefill.problemCode.value;
        var conceptId = code && code.conceptId;
        if (!conceptId) return;
        conceptIdByProblemId[p.id] = conceptId;
        if (distinctConceptIds.indexOf(conceptId) === -1) distinctConceptIds.push(conceptId);
      });
      var retirementByConceptId = Object.create(null);
      await Promise.all(
        distinctConceptIds.map(function (conceptId) {
          return fetchRetirementStatus(conceptId).then(function (info) {
            retirementByConceptId[conceptId] = info;
          });
        })
      );
      // Zero extra fetches — prefillsById[p.id].additionalInformation is
      // already in hand from the edit-problem fetch above, so this THIRD
      // flagging reason costs only one local resource load (cached after
      // the first call), same as it does inside openPanel.
      var genericTexts = await ensureGenericAdditionalInfoTextLoaded();
      var flaggedCount = 0;
      _problemsCache.forEach(function (p) {
        var conceptId = conceptIdByProblemId[p.id];
        var retirement = conceptId ? retirementByConceptId[conceptId] : null;
        // active:null means the check itself didn't cleanly resolve (network
        // error, stale release string, …) — never treat as retired.
        var isRetired = !!(retirement && retirement.active === false);
        var overview = overviewsById[p.id];
        var legacyReadCode = findLegacyReadCodeOrigin(
          overview && overview.problemCode && overview.problemCode.originalCodes
        );
        var prefill = prefillsById[p.id];
        var genericInfo = stripGenericAdditionalInfoLines(prefill && prefill.additionalInformation, genericTexts);
        var hasGenericInfo = genericInfo.removed.length > 0;
        if (!isRetired && !legacyReadCode && !hasGenericInfo) return;
        flaggedCount++;
        var st = rowState(p.id);
        st.prefill = prefill;
        if (isRetired) {
          st.retiredInfo = { inactivationReason: retirement.inactivationReason, replacement: retirement.replacement };
        }
        if (legacyReadCode) st.legacyReadCode = legacyReadCode;
        if (hasGenericInfo) st.genericAdditionalInfo = genericInfo;
        var row = findProblemRow(p.problemCodeDescription, claimedAnchors);
        if (row) {
          claimedAnchors.add(row);
          injectFixButton(p.id, row);
        }
      });
      _retiredFlaggedCount = flaggedCount;
      _retiredScanState = 'done';
    } catch (err) {
      _retiredScanState = 'error';
      _retiredScanError = (err && err.message) || 'Failed to check for retired/legacy codes.';
    } finally {
      renderRetiredWidget();
    }
  }

  function buildRetiredWidgetHtml() {
    if (_retiredScanState === 'scanning') {
      return '<span class="ms-pdc-retired-scan-status ms-pdc-loading">Checking for retired/legacy codes and import noise…</span>';
    }
    if (_retiredScanState === 'error') {
      return (
        '<span class="ms-pdc-retired-scan-status ms-pdc-error">' +
        esc(_retiredScanError) +
        '</span> <button type="button" class="ms-pdc-retired-scan-retry" id="ms-pdc-retired-scan-retry">Retry</button>'
      );
    }
    if (_retiredScanState === 'done') {
      return (
        '<span class="ms-pdc-retired-scan-status">' +
        (_retiredFlaggedCount
          ? _retiredFlaggedCount +
            ' problem' +
            (_retiredFlaggedCount === 1 ? '' : 's') +
            ' flagged (retired code, Read-code-derived description, and/or generic import text) — see "Fix description" on the flagged problem(s) above.'
          : 'Nothing flagged.') +
        '</span>'
      );
    }
    return '<button type="button" class="ms-pdc-retired-scan-btn" id="ms-pdc-retired-scan-btn">Check for retired/legacy codes?</button>';
  }

  function bindRetiredWidgetEvents(el) {
    var btn = el.querySelector('#ms-pdc-retired-scan-btn');
    if (btn) btn.addEventListener('click', runRetiredCodesScan);
    var retry = el.querySelector('#ms-pdc-retired-scan-retry');
    if (retry) retry.addEventListener('click', runRetiredCodesScan);
  }

  function renderRetiredWidget() {
    var el = document.getElementById('ms-pdc-retired-widget');
    if (!el) return;
    el.innerHTML = buildRetiredWidgetHtml();
    bindRetiredWidgetEvents(el);
  }

  // Placement mirrors content-scripts/problem-junk-code-cleanup.js's own
  // "Major" heading anchor (duplicated rather than shared — see
  // findProblemRow's comment above for the precedent of small DOM-finding
  // helpers being kept local to each content script rather than factored
  // out for one call site). Falls back to whichever list holds the first
  // cached problem if no confirmed "Major" section exists on the page.
  function injectRetiredWidgetTrigger() {
    if (document.getElementById('ms-pdc-retired-widget')) return;
    if (!_problemsCache || !_problemsCache.length) return;
    var list = document.querySelector('ul[aria-labelledby="problems-major-label"]');
    if (!list) {
      var row = findProblemRow(_problemsCache[0].problemCodeDescription, null);
      if (!row) return;
      list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    }
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-pdc-retired-widget';
    w.innerHTML = buildRetiredWidgetHtml();
    list.parentElement.insertBefore(w, list);
    bindRetiredWidgetEvents(w);
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
      _retiredScanState = 'idle';
      _retiredScanError = null;
      _retiredFlaggedCount = 0;
      var staleRetiredWidget = document.getElementById('ms-pdc-retired-widget');
      if (staleRetiredWidget) staleRetiredWidget.remove();
    }
    if (!_problemsCache && !_scanInFlight) {
      // WRONG-PATIENT RACE (audit 2026-07-27, Critical) — see the same guard in
      // content-scripts/problem-bulk-end.js for the full sequence. An in-flight
      // fetch for patient A makes patient B skip its own fetch; without the
      // post-await re-check, A's problem list was cached and this widget then
      // offered "Fix description" edits against A's problemIds while the
      // clinician was viewing B.
      var pid = info.patientId;
      _scanInFlight = true;
      var fetched;
      try {
        fetched = await fetchClinicalSummaryProblems(pid);
      } catch (_) {
        fetched = [];
      } finally {
        _scanInFlight = false;
      }
      if (pid !== _lastPatientId) return;
      _problemsCache = fetched;
    }
    if (!_problemsCache) return;
    var outdated = findOutdatedProblems(_problemsCache);
    // See findProblemRow's comment: claimedAnchors ensures two problems with
    // IDENTICAL description text each get their own distinct DOM row instead
    // of colliding on the first match.
    var claimedAnchors = new Set();
    outdated.forEach(function (p) {
      var row = findProblemRow(p.problemCodeDescription, claimedAnchors);
      if (row) {
        claimedAnchors.add(row);
        injectFixButton(p.id, row);
      }
    });
    if (_problemsCache.length) injectRetiredWidgetTrigger();
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
        m.target.closest('.ms-pdc-panel-wrap, .ms-pdc-fix-btn, #ms-pdc-retired-widget')
      ) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-pdc-retired-widget') continue;
          if (n.classList && (n.classList.contains('ms-pdc-panel-wrap') || n.classList.contains('ms-pdc-fix-btn')))
            continue;
          if (n.closest && n.closest('.ms-pdc-panel-wrap, .ms-pdc-fix-btn, #ms-pdc-retired-widget')) continue;
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
