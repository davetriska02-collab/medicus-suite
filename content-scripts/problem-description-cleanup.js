// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Clean up code" widget for outdated SNOMED problem codes
// (renamed 2026-07-26 from "Fix description" once the widget grew beyond
// same-concept relabelling to also cover better-code suggestions, retired/
// Read-code-derived detection, and generic import-text removal — internal
// identifiers (ms-pdc-* CSS classes, file name) are unchanged, this is a
// display-text-only rename).
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
//
// SEVERITY-DEFAULTING CONTRADICTION EXTENSION (2026-07-29, real example: HAR
// capture, SCTID 433144002 "Chronic kidney disease stage 3"): a different
// class of GP2GP import defect from everything above — this one is about
// additionalInformation containing a self-contradicting pair of boilerplate
// lines, not an outdated description or a retired code. Medicus's own "Edit
// Problem" UI only has a plain Major/Minor significance dropdown; when a
// GP2GP-transferred source record carries no machine-readable significance
// value (or one from a scheme the importer has no mapping for), the importer
// defaults the structured field to Minor and writes what it did, PLUS what
// the source record's own free text actually said the severity was, into
// additionalInformation as plain text — e.g. "Unspecified Significance:
// Defaulted to Minor\nProblem severity: Major". The structured field is never
// corrected afterwards even when the source-supplied value is sitting right
// there in the same field disagreeing with the default — the real example
// above was stored as significance:"minor" while its own import text says the
// source severity was Major. CONSOLIDATED 2026-07-29 into ONE rules file,
// rules/generic-additional-info-text.json — a `kind:"pattern"` entry there
// holds the regex source (as data, not hardcoded, so a differently-worded
// sibling needs only a data-file edit) plus an `action` flag saying this one
// isn't just noise, it needs a mismatch check. The pattern is matched against
// the WHOLE additionalInformation text (not per-line), so it recognises the
// boilerplate whether the two fragments land on separate lines OR are run
// together on one line separated by whitespace — BOTH confirmed live
// (2026-07-29: the second, no-mismatch variant was "...Defaulted to Minor
// Problem severity: Minor" on a single line, no newline at all). See
// findPatternMatch/severityCorrectionNeeded/computeAdditionalInfoFindings
// below. When the two values agree (no contradiction), this reduces to
// ordinary boilerplate removal — the same two fragments are ALSO listed as
// plain `kind:"literal"` entries in the same file, so a solo/unpaired
// occurrence of either is still recognised; only a genuine mismatch offers
// the combined "correct severity + remove junk text" action
// (applyCorrectSeverityAndRemoveJunk), never a silent auto-fix.
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

  // ── Shared generic "what does this practice prefer" tally/override —
  // serves BOTH the wording-preference axis (pdc.preferredDescriptions) and
  // the concept-remap axis (pdc.conceptRemap); see the shared module's own
  // header for the full story ─────────────────────────────────────────────
  var preferredDescriptions =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/preferred-descriptions.js')
      : window.MSPreferredDescriptions;
  var recordPreference = preferredDescriptions.recordChoice;
  var resolvePreference = preferredDescriptions.resolvePreferred;

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
      payload.recordedByOrganisation = unwrapRecordedByOrganisation(p.recordedByOrganisation);
      payload.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      payload.recordedByStaff = p.recordedByStaff != null ? unwrapOptionValue(p.recordedByStaff) : null;
    }
    return payload;
  }

  // Found live 2026-07-26, real example: a GP2GP-imported problem recorded
  // with no defined author. edit-problem's GET can return
  // recordedByOrganisation wrapped as a UI-select shape —
  // {label:"Park Road Surgery", value:{organisationName:"Park Road Surgery",
  // organisationIdentifierType:"nhs-england-ods-code",
  // organisationIdentifierValue:"H84002"}} — rather than the plain
  // {organisationName, …} object the POST actually wants. Round-tripping the
  // wrapper verbatim 400'd: {"recordedByOrganisation.organisationName":
  // ["This field is missing."], ".label"/".value": ["This field was not
  // expected."]} — confirmed via apiFetch's error-body surfacing (see its own
  // comment). The data was never actually missing, just double-wrapped.
  // Unwraps ONLY when this exact wrapped shape is detected (a real inner
  // object carrying organisationName); otherwise passes the field through
  // completely unchanged, since the ORIGINAL confirmed-live capture
  // (docs/learnings-problem-description-cleanup.md) showed
  // recordedByOrganisation already unwrapped ({organisationName, …} directly)
  // for a normally-recorded problem — both shapes are real, this must not
  // assume only one of them.
  function unwrapRecordedByOrganisation(org) {
    if (org && org.value && typeof org.value === 'object' && org.value.organisationName != null) {
      return org.value;
    }
    return org != null ? org : null;
  }

  // Builds the POST /clinical/note/change-note body from a FRESH
  // GET /clinical/data/note/edit-note/{noteId} prefill — confirmed live via
  // 3 HAR captures 2026-08-13 (see fetchEditNoteForm/postChangeNote's own
  // header comment for the full contract). A WRITABLE-SUBSET full replace —
  // narrower than edit-problem's "resend literally everything" contract,
  // but every field below is still resent even when unchanged, confirmed
  // identical across all 3 captures. newCode: {description, conceptId,
  // descriptionId} — the code to write (the PROBLEM's current code, not
  // searched/picked per journal entry).
  function buildChangeNotePayload(notePrefill, newCode) {
    var p = notePrefill || {};
    return {
      noteId: p.noteId,
      note: p.note,
      noteSNOMEDct: newCode,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      flagOnPatientBanner: !!p.flagOnPatientBanner,
      recordedByOrganisation: p.recordedByOrganisation != null ? p.recordedByOrganisation : null,
      recordedByPractitioner: p.recordedByPractitioner != null ? p.recordedByPractitioner : null,
      recordedByStaff: p.recordedByStaff != null ? p.recordedByStaff : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
      flags: Array.isArray(p.flags) ? p.flags : [],
      clinicalCaseId: (p.linkedClinicalCase && p.linkedClinicalCase.defaultClinicalCaseId) || null,
      linkedProblemIds: Array.isArray(p.linkedProblemIds) ? p.linkedProblemIds : [],
    };
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

  // Same conceptId-match discipline as confirmedReplacementAlternative above,
  // but returns EVERY matching description row (deduped by descriptionId,
  // falling back to description text), not just the first. Found live
  // 2026-07-28: a SNOMED concept resolved as a confirmed/possibly/partially
  // -equivalent candidate can itself carry SEVERAL synonyms — real example,
  // 402222007 "Pompholyx of hand" ALSO carries the synonym "Chiropompholyx",
  // and 201201000 "Pompholyx of foot" ALSO carries "Podopompholyx".
  // confirmedReplacementAlternative's `.find()` picked whichever synonym
  // happened to sort first in Medicus's bare-SCTID search response — often
  // the more obscure/eponymous one, purely by accident of array order, never
  // a deliberate choice (there is no preferred-term/acceptability signal in
  // Medicus's own search response to rank by, so guessing "which wording
  // looks nicer" would just be a different accident). Used by
  // resolveSnomedNamedCandidate so this whole SNOMED-confirmed-candidate
  // family of buttons behaves like every OTHER alternatives category in this
  // file (sameConceptAlternatives, descendantAlternatives, …) — show every
  // real synonym, let the clinician pick the wording, never silently guess.
  function confirmedReplacementAlternatives(results, replacementConceptId) {
    if (!Array.isArray(results) || !replacementConceptId) return [];
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || v.conceptId !== replacementConceptId) return;
      var key = v.descriptionId || v.description;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ description: v.description, conceptId: v.conceptId, descriptionId: v.descriptionId || null });
    });
    return out;
  }

  // Groups a flat list of {description, conceptId, descriptionId, matchScore?}
  // candidates by conceptId — 2026-07-28, explicit user request after the
  // Pompholyx case above: several rows sharing one conceptId (structurally
  // ONE SNOMED code, several wordings) were rendering as several separate
  // buttons, reading as several different codes. Groups preserve first-seen
  // conceptId order; each group's `options` keeps every distinct synonym
  // (deduped by descriptionId, falling back to description text) in the
  // order they were found. `bestScore` carries descendantAlternatives' own
  // matchScore through grouping (the highest score among that concept's
  // synonyms — the ranking signal is about the CODE's relevance, a per-
  // synonym artefact of which words happen to appear in which wording isn't
  // meaningful once grouped) — null when the input has no matchScore field
  // at all (every other category). When any group has a score, groups are
  // re-sorted by bestScore descending, same ranking intent
  // descendantAlternatives already had before grouping existed.
  function groupCandidatesByConcept(items) {
    var order = [];
    var byConceptId = Object.create(null);
    (Array.isArray(items) ? items : []).forEach(function (item) {
      if (!item || !item.conceptId) return;
      if (!byConceptId[item.conceptId]) {
        byConceptId[item.conceptId] = { conceptId: item.conceptId, options: [], bestScore: null };
        order.push(item.conceptId);
      }
      var group = byConceptId[item.conceptId];
      var key = item.descriptionId || item.description;
      var alreadyListed = group.options.some(function (o) {
        return (o.descriptionId || o.description) === key;
      });
      if (!alreadyListed) {
        group.options.push({ description: item.description, descriptionId: item.descriptionId || null });
      }
      if (typeof item.matchScore === 'number') {
        group.bestScore = group.bestScore === null ? item.matchScore : Math.max(group.bestScore, item.matchScore);
      }
    });
    var groups = order.map(function (conceptId) {
      return byConceptId[conceptId];
    });
    if (
      groups.some(function (g) {
        return g.bestScore !== null;
      })
    ) {
      groups.sort(function (a, b) {
        return (b.bestScore || 0) - (a.bestScore || 0);
      });
    }
    return groups;
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

  // Which conceptId the descendant/laterality search should target (2026-07-29
  // — see openPanel's own comment on the RETIRED-CONCEPT PIVOT for the full
  // story and motivating example, 179304004). A retired problem's own
  // conceptId is frequently a dead-end for this search (SNOMED stops growing
  // a retired concept's subtree once it's retired — the motivating example,
  // 179304004, has zero descendants), while its confirmed replacement is the
  // live, current concept that could genuinely have laterality-specific
  // children. Prefers retiredInfo.replacement.conceptId when present
  // (already resolved by the opt-in retirement scan, no extra fetch needed),
  // falls back to the problem's own currentConceptId otherwise — covers both
  // an active concept (no retiredInfo at all) and a retired concept with no
  // confirmed replacement.
  function descendantSearchTargetConceptId(retiredInfo, currentConceptId) {
    return (retiredInfo && retiredInfo.replacement && retiredInfo.replacement.conceptId) || currentConceptId || null;
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

  // ── Unified rules/generic-additional-info-text.json entries (2026-07-29
  // consolidation — ALL known GP2GP boilerplate lives in this ONE file now,
  // literal strings and value-capturing patterns alike; see the file's own
  // header note for the full schema). `kind:"pattern"` entries carry a
  // captured VALUE worth checking against the record, unlike a bare literal
  // string — an entry with no explicit kind defaults to "literal" for
  // forward compatibility. ──────────────────────────────────────────────────
  function literalTextsFromEntries(entries) {
    return (Array.isArray(entries) ? entries : [])
      .filter(function (e) {
        return e && e.kind !== 'pattern';
      })
      .map(function (e) {
        return e && e.text;
      })
      .filter(Boolean);
  }

  function patternEntriesFromEntries(entries) {
    return (Array.isArray(entries) ? entries : []).filter(function (e) {
      return e && e.kind === 'pattern' && e.pattern;
    });
  }

  // Matches ONE pattern-kind entry against the WHOLE additionalInformation
  // text — deliberately never split by line first, unlike literal matching,
  // so the boilerplate is recognised regardless of whether it lands on
  // separate lines or is run together on a single line separated by
  // whitespace (both confirmed live for severityDefaultingContradiction —
  // see that entry's own rationale in the rules file: a `\s+` between the
  // two fragments in the stored regex source matches a newline OR a plain
  // space, so a differently-joined variant needs only a data-file edit, not
  // a new code path). Returns {raw, groups} (raw = the exact matched
  // substring, needed to remove just that span; groups = captured values,
  // index 0 = capture group 1) or null if the pattern doesn't match, or the
  // regex source is malformed (never throws).
  function findPatternMatch(text, entry) {
    if (!entry || !entry.pattern) return null;
    var re;
    try {
      re = new RegExp(entry.pattern, entry.flags || '');
    } catch (e) {
      return null;
    }
    var m = (text == null ? '' : String(text)).match(re);
    if (!m) return null;
    return { raw: m[0], groups: m.slice(1) };
  }

  // Removes ONE matched substring (found by findPatternMatch) from the text,
  // then collapses any now-blank line left behind — same "split by line,
  // trim, filter, rejoin" discipline as stripGenericAdditionalInfoLines, so
  // genuine free text elsewhere in the field survives untouched regardless
  // of whether the removed span occupied whole line(s) or shared a line with
  // other text.
  function removeMatchedSpan(text, raw) {
    var str = text == null ? '' : String(text);
    if (!raw) return str;
    var idx = str.indexOf(raw);
    if (idx === -1) return str;
    var joined = str.slice(0, idx) + str.slice(idx + raw.length);
    return joined
      .split('\n')
      .map(function (l) {
        return l.trim();
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  // Returns the significance value to correct TO ('major'/'minor'), or null
  // when there's nothing to act on — either no stated value was captured, or
  // it already matches what's currently stored (the ordinary no-mismatch
  // case, left to plain boilerplate removal like every other entry).
  function severityCorrectionNeeded(statedSeverity, currentSignificance) {
    if (!statedSeverity) return null;
    var stated = String(statedSeverity).toLowerCase();
    var current = (currentSignificance == null ? '' : String(currentSignificance)).toLowerCase();
    if (stated === current) return null;
    return stated;
  }

  // Single source of truth for every additionalInformation-derived finding —
  // used identically by the opt-in code-health scan and by openPanel, so a
  // row's flagged state and its re-computed panel state can never disagree
  // (see openPanel's own comment on why it recomputes rather than trusting
  // the scan's cache). Two passes: PATTERN entries first (matched and
  // stripped against the whole text, regardless of whether their `action` —
  // if any — actually fires, so the boilerplate is always removed once
  // recognised, whichever action type matched or none at all), THEN literal
  // entries (stripGenericAdditionalInfoLines) mop up whatever's left — any
  // unrelated generic line, or a solo/unpaired occurrence of one half of a
  // pattern entry's own fragments. Two action types are handled: a
  // `severityCorrection` SUPERSEDES the plain generic-strip offer for the
  // same field (a confident auto-fix, never shown alongside a redundant
  // plain-strip button); a `reviewSeverity` (2026-07-29 — source-system
  // "PRIORITY=n" values) does NOT supersede anything by default — it's an
  // informational prompt that coexists with the ordinary generic-strip
  // removal offer, since most captured values have no confirmed Major/Minor
  // mapping, only a suggestion to check manually. A `reviewSeverity` entry
  // CAN still drive a confident correction for specific captured values via
  // its own `valueSeverityMap` (2026-07-29 — e.g. this practice's own
  // confirmed "PRIORITY=1 always means Major" convention, holding across
  // every example seen from that source system) — when the captured value
  // has a mapped entry, it's treated exactly like severityCorrection
  // (mismatch-checked and offered as a correction, superseding the plain
  // strip); only an UNMAPPED value falls through to the plain review note.
  // `cleaned` always has every matched line/pattern removed regardless of
  // action type, so whichever combination of actions/offers ends up shown,
  // none of them is ever less thorough about what gets removed than a plain
  // strip would have been.
  // otherProblems (2026-08-09, optional — existing callers work unchanged
  // when omitted): [{id, description}] for every OTHER active problem on
  // this patient's record, excluding the one this additionalInformation
  // belongs to. Used ONLY by the new `linkSuggestion` action type (see
  // rules/generic-additional-info-text.json's own note on it, and
  // shared/problem-text-linking.js for the matching rules) — a captured
  // problem-name reference ("(Grouped with X)") is resolved against this
  // list via window.MSProblemTextLinking.matchProblemByName. When
  // otherProblems is omitted or the match module isn't loaded, a
  // linkSuggestion entry degrades to a plain reviewSeverity-style
  // informational note (never silently dropped, never guessed).
  function computeAdditionalInfoFindings(additionalInformation, currentSignificance, entries, otherProblems) {
    var workingText = additionalInformation == null ? '' : String(additionalInformation);
    var patternRemoved = [];
    var severityContradiction = null;
    var severityReviewNote = null;
    var linkSuggestion = null;
    var matcher = typeof window !== 'undefined' && window.MSProblemTextLinking;
    patternEntriesFromEntries(entries).forEach(function (entry) {
      var match = findPatternMatch(workingText, entry);
      if (!match) return;
      patternRemoved.push(match.raw);
      workingText = removeMatchedSpan(workingText, match.raw);
      if (!entry.action) return;
      if (entry.action.type === 'severityCorrection') {
        var statedIdx = entry.action.capturesStatedSeverity;
        var stated = statedIdx ? match.groups[statedIdx - 1] : null;
        var corrected = severityCorrectionNeeded(stated, currentSignificance);
        if (corrected) severityContradiction = { stated: corrected, source: entry.id || null };
      } else if (entry.action.type === 'reviewSeverity') {
        var priorityIdx = entry.action.capturesPriorityValue;
        var priorityValue = priorityIdx ? match.groups[priorityIdx - 1] : null;
        if (!priorityValue) return;
        var mappedSeverity = entry.action.valueSeverityMap && entry.action.valueSeverityMap[priorityValue];
        if (mappedSeverity) {
          var mappedCorrection = severityCorrectionNeeded(mappedSeverity, currentSignificance);
          if (mappedCorrection) severityContradiction = { stated: mappedCorrection, source: entry.id || null };
        } else {
          severityReviewNote = { priorityValue: priorityValue };
        }
      } else if (entry.action.type === 'linkSuggestion') {
        var nameIdx = entry.action.capturesProblemName;
        var problemName = nameIdx ? match.groups[nameIdx - 1] : null;
        if (!problemName) return;
        var found = matcher ? matcher.matchProblemByName(problemName, otherProblems || []) : null;
        linkSuggestion = {
          problemName: problemName,
          match: found, // {problemId, description, confidence} | null
          source: entry.id || null,
        };
      }
    });
    var literalStrip = stripGenericAdditionalInfoLines(workingText, literalTextsFromEntries(entries));
    var removed = patternRemoved.concat(literalStrip.removed);
    var current = (currentSignificance == null ? '' : String(currentSignificance)).toLowerCase();
    if (severityReviewNote) severityReviewNote.current = current;
    // linkSuggestion's `cleaned` text is offered whether or not a candidate
    // match was found — the "(Grouped with X)" boilerplate is recognised
    // either way, same "always removed once recognised" discipline as every
    // other pattern entry (see this function's own header note).
    if (linkSuggestion) linkSuggestion.cleaned = literalStrip.cleaned;
    if (severityContradiction) {
      severityContradiction.current = current;
      severityContradiction.cleaned = literalStrip.cleaned;
      return {
        genericAdditionalInfo: null,
        severityContradiction: severityContradiction,
        severityReviewNote: severityReviewNote,
        linkSuggestion: linkSuggestion,
      };
    }
    // A CONFIDENT linkSuggestion (a match was found) supersedes the plain
    // strip offer the same way severityContradiction does — three dedicated
    // relationship buttons already cover "remove this text" as part of
    // whichever one is clicked, so a redundant plain-strip button alongside
    // them would just be confusing. An UNMATCHED linkSuggestion has no
    // confident action to offer, so it coexists with the plain strip —
    // same as reviewSeverity's own informational-only behaviour.
    var linkSuggestionSupersedesStrip = !!(linkSuggestion && linkSuggestion.match);
    return {
      genericAdditionalInfo:
        !linkSuggestionSupersedesStrip && removed.length ? { cleaned: literalStrip.cleaned, removed: removed } : null,
      severityContradiction: null,
      severityReviewNote: severityReviewNote,
      linkSuggestion: linkSuggestion,
    };
  }

  // Strips EVERY known generic-import-text pattern from `text` — deliberately
  // NOT computeAdditionalInfoFindings, and not a thin wrapper around it.
  // Found live 2026-08-14 (real journal note, text " PRIORITY=1"): calling
  // computeAdditionalInfoFindings(text, null, ...) for a journal note (which
  // has no `significance` field at all, unlike a problem) makes
  // sourceSystemPriorityValue's reviewSeverity action ALWAYS look like a
  // contradiction — severityCorrectionNeeded('major', null) never matches
  // "already agrees with what's stored", because nothing IS stored — so
  // computeAdditionalInfoFindings routes into its severityContradiction
  // branch and returns genericAdditionalInfo: null, silently discarding a
  // pattern match that WAS found and WAS removable. That branching is
  // CORRECT for a problem (a severity mismatch deserves the combined
  // correct+remove action, superseding a plain strip) — the bug was reusing
  // that same function for a context (a journal note) where the concept it's
  // branching on doesn't exist. Journal notes have no significance to
  // correct and no "other problems" to link against, so this function skips
  // ALL action interpretation (severityCorrection/reviewSeverity/
  // linkSuggestion) entirely — every pattern match is stripped
  // unconditionally, same as a literal entry. Small, deliberate duplication
  // of the pattern-walking loop above rather than a shared helper — the two
  // loop bodies genuinely diverge (one interprets actions, one doesn't), and
  // computeAdditionalInfoFindings is load-bearing, tested, PROBLEM-facing
  // code not worth the risk of restructuring for this. Returns {cleaned,
  // removed} — removed empty (never truthy-but-empty) when nothing matched,
  // same "check .length, not truthiness" convention as
  // stripGenericAdditionalInfoLines.
  function stripAllKnownGenericText(text, entries) {
    var workingText = text == null ? '' : String(text);
    var patternRemoved = [];
    patternEntriesFromEntries(entries).forEach(function (entry) {
      var match = findPatternMatch(workingText, entry);
      if (!match) return;
      patternRemoved.push(match.raw);
      workingText = removeMatchedSpan(workingText, match.raw);
    });
    var literalStrip = stripGenericAdditionalInfoLines(workingText, literalTextsFromEntries(entries));
    return { cleaned: literalStrip.cleaned, removed: patternRemoved.concat(literalStrip.removed) };
  }

  // Whether there's an actual reason to believe THIS problem's own SNOMED
  // code needs review — as opposed to the problem row merely having a
  // "Clean up code" button because of import-text housekeeping (junk
  // generic text, a severity contradiction/review note) with the code
  // itself otherwise unremarkable. Reuses looksOutdated() (the SAME cheap,
  // no-fetch text-pattern check the automatic per-load scan already runs)
  // plus the two signals only the opt-in retirement scan can set
  // (retiredInfo/legacyReadCode) — never a new heuristic, purely surfacing
  // signals the tool already computes elsewhere. `st` is
  // {currentDescription, retiredInfo, legacyReadCode} — a subset of a row's
  // full state, so this is easy to call with a plain object in tests.
  function codeQualityConcernExists(st) {
    return !!((st && looksOutdated(st.currentDescription)) || (st && st.retiredInfo) || (st && st.legacyReadCode));
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
      // Re-exported from shared/preferred-descriptions.js, same reasoning —
      // full coverage lives in test-preferred-descriptions.js.
      recordPreference: preferredDescriptions.recordChoice,
      resolvePreference: preferredDescriptions.resolvePreferred,
      // Problem-specific.
      buildEditProblemPayload,
      unwrapOptionValue,
      buildChangeNotePayload,
      apiErrorMessage,
      findOutdatedProblems,
      confirmedReplacementAlternative,
      confirmedReplacementAlternatives,
      groupCandidatesByConcept,
      normalizedSearchResults,
      findLegacyReadCodeOrigin,
      descendantSearchTargetConceptId,
      stripGenericAdditionalInfoLines,
      literalTextsFromEntries,
      patternEntriesFromEntries,
      findPatternMatch,
      removeMatchedSpan,
      severityCorrectionNeeded,
      computeAdditionalInfoFindings,
      stripAllKnownGenericText,
      codeQualityConcernExists,
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
      // Surfaces Medicus's own validation message (e.g. which field a 400
      // rejected) instead of a bare status code — found live 2026-07-26
      // debugging applyRemoveGenericAdditionalInfo's 400, where "API 400"
      // alone gave no way to confirm which field was wrong without a
      // separate Network-tab capture. apiErrorMessage() (above) does the
      // best-effort JSON-field extraction + truncation; here we just need to
      // read the body without letting an unreadable one crash the error path.
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

  // Same endpoint content-scripts/problem-bulk-end.js already uses
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

  // Resolves a SNOMED-NAMED candidate conceptId — a REPLACED BY or POSSIBLY
  // EQUIVALENT TO target from shared/snomed-retirement.js — against Medicus's
  // OWN search index. Extracted 2026-07-27 (previously inlined only for the
  // single REPLACED BY case) so the same two-step lookup — bare-SCTID query
  // against the broad 6-hierarchy scope, then a Body-structure-scoped
  // fallback (see BODY-STRUCTURE FALLBACK's own history, v3.193.0) if that
  // comes up empty — can also resolve MULTIPLE possibly-equivalent
  // candidates, not just the one confirmed replacement. Returns EVERY
  // matching synonym (via confirmedReplacementAlternatives, plural — see its
  // own comment for why picking just one is a silent guess), never a single
  // arbitrary pick — an empty array (never null) if neither search finds
  // this conceptId at all.
  async function resolveSnomedNamedCandidate(conceptId) {
    var results = await searchDescriptions(conceptId);
    var matches = confirmedReplacementAlternatives(results, conceptId);
    if (matches.length) return matches;
    var bodyStructureResults = await searchDescendantsNarrowed('123037004', conceptId);
    return confirmedReplacementAlternatives(bodyStructureResults, conceptId);
  }

  function postEditProblem(problemId, payload) {
    return apiFetch('/clinical/problem/edit-problem/' + encodeURIComponent(problemId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // JOURNAL NOTE WRITE PATH (2026-08-13) — confirmed live via 3 HAR
  // captures on a real patient (editing a note's free text, editing its
  // code via search, and editing an "orphan" note not inside a
  // consultation). All three confirmed the SAME endpoint and payload shape
  // — no special-casing for consultation-nested vs orphan notes.
  //
  //   GET  /clinical/data/note/edit-note/{noteId}
  //        → the edit-form prefill: { noteId, note, noteSNOMEDct:
  //          {conceptId,description,descriptionId}, recordDate,
  //          recordedByPractitioner, recordedByStaff, recordedByOrganisation,
  //          hiddenFromPatientFacingServices, confidentialFromThirdParties,
  //          flagOnPatientBanner, flags, linkedProblemIds (plain id array —
  //          NOT {id,problemCodeDescription} objects, a DIFFERENT shape from
  //          the bulk patient-journal/overview payload's linkedProblems),
  //          linkedClinicalCase: {options, defaultClinicalCaseId,
  //          requiresClinicalCase}, contextType/contextId (null for an
  //          orphan note, "consultation-topic-heading"+id when nested —
  //          confirmed IRRELEVANT to the write, see below), plus UI-only
  //          fields (linkableProblems, staff, riskContextIds, flagOptions,
  //          excludeConsentCodes, isDraft, isMarkedAsIncorrect,
  //          allowEditLinkedProblems, organisationEntry,
  //          recordedByOrganisationManual, patientId,
  //          recordedAtAnotherOrganisation, localOrganisation) never resent. }
  //   POST /clinical/note/change-note
  //        body: see buildChangeNotePayload below — a WRITABLE-SUBSET full
  //        replace, confirmed identical shape across all 3 captures
  //        regardless of what changed. Confirmed via the orphan-note capture
  //        that NO contextType/contextId/patientId is needed in the POST —
  //        resolved server-side purely from noteId.
  //        → 200 {}
  //
  // NOT YET CONFIRMED (flag, don't guess): a non-null recordedByOrganisation
  // shape (every capture had recordedAtAnotherOrganisation:false and
  // recordedByOrganisation:null) and a non-null clinicalCaseId/
  // defaultClinicalCaseId case. buildChangeNotePayload passes both through
  // verbatim from the fresh GET rather than reshaping — safe either way
  // since nothing here tries to interpret or change them.
  //
  // SAFETY SCOPE, DELIBERATELY DIFFERENT FROM "Clean up code": that flow
  // only ever offers a same-concept relabel (never changes conceptId). This
  // write is different by design — its purpose is making a journal note's
  // code equal the PROBLEM's current code, which may be a different concept
  // than what the note currently has (that's the divergence being fixed).
  // No same-concept constraint here — confirmed intended by Nick.
  function fetchEditNoteForm(noteId) {
    return apiFetch('/clinical/data/note/edit-note/' + encodeURIComponent(noteId));
  }

  function postChangeNote(noteId, payload) {
    return apiFetch('/clinical/note/change-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // Loads rules/generic-additional-info-text.json ONCE per page load — a
  // local extension resource, not a Medicus call. Returns the RAW `entries`
  // array (literal AND pattern entries alike — see the file's own header
  // note and literalTextsFromEntries/patternEntriesFromEntries above for how
  // callers split them apart) so ONE loader/one file serves every
  // additionalInformation-boilerplate check in this widget. Falls back to an
  // empty list (never throws) if the resource is unavailable, same "fail
  // open to inert, not to a crash" discipline as ensureNonProblemRootsLoaded
  // in content-scripts/problem-bulk-end.js.
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
  // RELAYED THROUGH THE BACKGROUND SERVICE WORKER (2026-07-29) — a direct
  // `fetch()` to termbrowser.nhs.uk from THIS content script (injected into
  // the Medicus page) was found live to be blocked by the browser's own CORS
  // check, with the request's origin reported as the MEDICUS PAGE's origin,
  // not the extension's — despite termbrowser.nhs.uk being correctly
  // declared in manifest.json's host_permissions. Content-script-issued
  // fetches to a cross-origin host don't reliably get that CORS bypass in
  // practice; a service-worker-issued fetch has no such ambiguity. See
  // service-worker.js's own comment on the 'termbrowser:fetchConcept' relay
  // for the full story. Fails closed to parseConceptRetirement(null) on ANY
  // failure — relay error, non-2xx, malformed JSON — same discipline as
  // before this change, never guesses active/inactive.
  async function fetchRetirementStatus(conceptId) {
    try {
      var config = await ensureTermServerConfigLoaded();
      var url = buildConceptUrl(config, conceptId);
      if (!url) return parseConceptRetirement(null);
      var relayed = await chrome.runtime.sendMessage({ action: 'termbrowser:fetchConcept', url: url });
      if (!relayed || !relayed.ok || !relayed.httpOk) return parseConceptRetirement(null);
      var data;
      try {
        data = JSON.parse(relayed.text);
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
  // scopeEl (added 2026-07-26, see buildAnchorMap below): when given, only
  // that element's own descendant links are searched — lets a caller
  // disambiguate duplicate-text problems that live in DIFFERENT significance
  // lists (Major vs Minor) instead of matching against the whole page.
  function findProblemRow(description, claimedAnchors, scopeEl) {
    var root = scopeEl || document;
    var links = root.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (claimedAnchors && claimedAnchors.has(a)) continue;
      if ((a.textContent || '').trim() === description) return a;
    }
    return null;
  }

  // WRONG-ROW BUG (found live 2026-07-26; first fix attempt below was
  // INSUFFICIENT, see the 2026-07-26(2) note underneath for the real cause).
  // The Nth-claims-Nth-row invariant documented on findProblemRow above only
  // holds if EVERY problem sharing that duplicate text calls findProblemRow,
  // in list order — not just whichever ones later turn out to be flagged.
  // scan() and runRetiredCodesScan() each used to build their OWN
  // claimedAnchors Set and only call findProblemRow for the subset they were
  // about to flag. Real case: two problems, both "Infantile eczema"
  // (90823000), one GP2GP-imported with a Read-v2 origin (flagged by the
  // retirement scan), one not. First fix: compute ONE shared anchor map,
  // up front, from the FULL problem list in order, so every problem claims
  // its own row here regardless of flag status.
  //
  // 2026-07-26(2) — first fix confirmed live-tested as STILL BROKEN, same
  // symptom. Root cause is one level deeper: clinical-summary/summary's
  // `problems` array is NOT in whole-page DOM order at all — it groups by
  // `significance.value` ("minor" then "major", confirmed live via a raw
  // console capture: 11 minor-significance entries at array indices 0-10,
  // then 9 major-significance entries at 11-19), while the PAGE renders a
  // Major `<ul aria-labelledby="problems-major-label">` BEFORE the Minor
  // `<ul aria-labelledby="problems-minor-label">`. So the very first
  // "Infantile eczema" the array reaches (index 2, the Minor/Read-v2 one)
  // greedily claimed the Major list's "Infantile eczema" row, since that one
  // appears first in a flat whole-document query — exactly backwards.
  // **Confirmed (same live capture) that WITHIN one significance group, the
  // API's relative order DOES match that group's own `<ul>`'s DOM order** —
  // the invariant is real, just scoped narrower than assumed.
  //
  // Fix: partition problems by significance.value, resolve each partition's
  // OWN `<ul aria-labelledby="problems-<value>-label">` (falls back to an
  // unscoped/whole-document search if no such list exists for that value —
  // e.g. a patient with zero Major problems), and run the existing
  // claim-in-order logic SEPARATELY per partition/scope, sharing one
  // claimedAnchors Set throughout (harmless once scoped, and still a safety
  // net if a fallback ever lands two partitions in the same unscoped root).
  function significanceValue(p) {
    return (p && p.significance && p.significance.value) || '';
  }

  function significanceListElement(value) {
    if (!value) return null;
    return document.querySelector('ul[aria-labelledby="problems-' + value + '-label"]');
  }

  function buildAnchorMap(problems) {
    var claimedAnchors = new Set();
    var byProblemId = Object.create(null);
    var buckets = Object.create(null); // significance value -> problems, original relative order
    var bucketOrder = [];
    (problems || []).forEach(function (p) {
      var value = significanceValue(p);
      if (!buckets[value]) {
        buckets[value] = [];
        bucketOrder.push(value);
      }
      buckets[value].push(p);
    });
    bucketOrder.forEach(function (value) {
      var scopeEl = significanceListElement(value);
      buckets[value].forEach(function (p) {
        var row = findProblemRow(p.problemCodeDescription, claimedAnchors, scopeEl);
        if (row) {
          claimedAnchors.add(row);
          byProblemId[p.id] = row;
        }
      });
    });
    return byProblemId;
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
        // Set only by openInContainer (window.ProblemDescriptionCleanup
        // bridge, 2026-08-08) — when present, renderPanel appends panelEl
        // here instead of inline next to the Medicus row, so an external
        // caller (e.g. the "Organise problems" canvas) can embed the panel
        // in its own surface without needing anchorEl's row to be visible.
        hostContainer: null,
        // Set only by openInContainer, alongside hostContainer — called by
        // applyCode on a successful save (2026-08-08 follow-up: "problem
        // code edits refresh within the canvas") so the caller can update
        // its own copy of this problem's description instead of only the
        // Medicus row's own text (st.anchorEl.textContent, updated
        // unconditionally by applyCode regardless of this callback).
        onApplied: null,
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
        retiredInfo: null, // {inactivationReason, replacement, possiblyEquivalentTo, partiallyEquivalentTo} — set by the opt-in retirement scan, never by the automatic text scan
        confirmedReplacement: null, // [{description, conceptId, descriptionId}, …] — EVERY synonym Medicus's own search has for the REPLACED BY target concept (may be several — see confirmedReplacementAlternatives), or null
        confirmedPossibleEquivalents: null, // [{description, conceptId, descriptionId}, …] — every synonym of every POSSIBLY EQUIVALENT TO candidate concept resolved from Medicus's own search (multiple candidates AND multiple synonyms per candidate can both contribute)
        confirmedPartiallyEquivalents: null, // [{description, conceptId, descriptionId}, …] — same shape as confirmedPossibleEquivalents but for PARTIALLY EQUIVALENT TO, a distinct SNOMED association (see partiallyEquivalentHtml)
        practiceRemap: null, // {conceptId, descriptionId, description} — resolved from pdc.conceptRemap, keyed by this problem's OWN current conceptId (the source), or null. See openPanel's own comment.
        legacyReadCode: null, // {code, description} — set by the opt-in scan when originalCodes shows a read-v2 origin
        journalMatches: null, // [{entryId, encounterId, date, clinicalCodeDescription, tier}] — set by openPanel's best-effort journal duplicate check (shared/journal-problem-matching.js). null = not yet checked or the check failed; [] = checked, none found.
        journalApply: {}, // entryId -> {saving, saved, error, appliedDescription, prevCode, undoing, undone, restoredDescription} — per-journal-match write state (applyToJournal) plus its one-click revert (undoJournalCodeSync; prevCode is the pre-sync noteSNOMEDct captured from the write's own prefill). Nested by entryId, unlike every other flag on this row, because one problem can have several journal matches, each an independent write target.
        journalInfoApply: {}, // entryId -> {saving, saved, error, appliedText, prevNote, undoing, undone} — SEPARATE per-journal-match state for the "remove generic import text" sync (applyGenericAdditionalInfoToJournal) plus its revert (undoJournalTextSync; prevNote is the pre-strip note text, '' allowed), kept apart from journalApply so a code-sync and a text-sync on the same entry don't conflate their saved/error state.
        genericAdditionalInfo: null, // {cleaned, removed} — computed in openPanel from prefill.additionalInformation, ANY row
        genericAdditionalInfoSaving: false,
        severityContradiction: null, // {stated, current, cleaned} — set when the GP2GP severity-defaulting text contradicts the stored significance (see computeAdditionalInfoFindings)
        severityContradictionSaving: false,
        severityReviewNote: null, // {priorityValue, current} — set when a source-system "PRIORITY=n" value with no confirmed Major/Minor mapping was found (see computeAdditionalInfoFindings) — informational only, no correction offered
        linkSuggestion: null, // {problemName, match:{problemId,description,confidence}|null, source, cleaned} — set when a "(Grouped with X)" reference was found (see computeAdditionalInfoFindings / shared/problem-text-linking.js)
        linkSuggestionActing: false, // true while a create-link POST for this row is in flight (any of the three relationship choices)
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
    if (st.confirmedReplacement && st.confirmedReplacement.length) {
      html +=
        '<div class="ms-pdc-retired-replacement-section">' +
        '<span class="ms-pdc-retired-replacement-label">✓ SNOMED confirms the replacement code:</span>' +
        '<div class="ms-pdc-panel">' +
        candidateGroupsHtml(
          problemId,
          st.confirmedReplacement,
          'confirmedreplacement',
          'ms-pdc-retired-replacement-btn',
          false
        ) +
        '</div></div>';
    } else if (st.retiredInfo.replacement) {
      html +=
        '<div class="ms-pdc-retired-replacement-unmatched">SNOMED replaced this code with "' +
        esc(st.retiredInfo.replacement.description) +
        '" but it could not be matched in Medicus’s own search index — try the manual search below (it may need a different SNOMED hierarchy scope than this panel searches by default).</div>';
    } else if (
      (!st.retiredInfo.possiblyEquivalentTo || !st.retiredInfo.possiblyEquivalentTo.length) &&
      (!st.retiredInfo.partiallyEquivalentTo || !st.retiredInfo.partiallyEquivalentTo.length)
    ) {
      html +=
        '<div class="ms-pdc-retired-no-replacement">No automatic replacement is recorded for this retirement — review the suggestions below, or try the manual search further down this panel.</div>';
    }
    html += possiblyEquivalentHtml(problemId, st);
    html += partiallyEquivalentHtml(problemId, st);
    return html;
  }

  // POSSIBLY EQUIVALENT TO banner (2026-07-27 — real example: 69878008
  // "Polycystic ovaries", retired as "Ambiguous component" with two
  // candidates of genuinely different clinical meaning, 237055002 "Polycystic
  // ovary syndrome" the disease vs. 781067001 "Polycystic ovary" a structural
  // finding). DELIBERATELY kept visually and behaviourally separate from the
  // confirmed-replacement section above: SNOMED itself is hedging here (not a
  // confident successor pointer), and this can genuinely offer SEVERAL
  // lozenges at once — one per candidate CONCEPT (see groupCandidatesByConcept
  // above — several candidate concepts, or one concept with several
  // synonyms, both collapse to one lozenge per real SNOMED code).
  function possiblyEquivalentHtml(problemId, st) {
    var candidates = st.retiredInfo && st.retiredInfo.possiblyEquivalentTo;
    if (!candidates || !candidates.length) return '';
    var resolved = st.confirmedPossibleEquivalents || [];
    if (resolved.length) {
      return (
        '<div class="ms-pdc-possibly-equivalent-section">' +
        '<span class="ms-pdc-possibly-equivalent-label">⚠ SNOMED marks this as POSSIBLY (not confirmed) equivalent to — verify which applies before applying:</span>' +
        '<div class="ms-pdc-panel">' +
        candidateGroupsHtml(problemId, resolved, 'possiblyequivalent', 'ms-pdc-possibly-equivalent-btn', true) +
        '</div></div>'
      );
    }
    return (
      '<div class="ms-pdc-possibly-equivalent-unmatched">SNOMED marks this as possibly equivalent to ' +
      candidates
        .map(function (c) {
          return '"' + esc(c.description) + '"';
        })
        .join(' or ') +
      ' (not a confirmed replacement) but neither could be matched in Medicus’s own search index — try the manual search below.</div>'
    );
  }

  // PARTIALLY EQUIVALENT TO banner (2026-07-28 — real example: 199317008
  // "Twin pregnancy - delivered", retired as "Classification derived
  // component" with two candidates — 65147003 "Twin pregnancy" and 289256000
  // "Mother delivered" — that TOGETHER reconstruct the retired concept's
  // meaning, unlike possiblyEquivalentHtml's candidates which are
  // alternatives to CHOOSE BETWEEN). Deliberately separate section/copy from
  // possiblyEquivalentHtml even though the resolve/render shape is identical,
  // because the clinical instruction is different: "this record may need
  // splitting into several problems" vs "pick whichever of these applies".
  // Still offered as one-click apply-and-replace buttons like every other
  // category — this widget doesn't attempt to auto-create the second problem
  // entry, only lets the clinician swap toward whichever single candidate is
  // the more clinically useful record now (same one-code-at-a-time model as
  // every other suggestion here).
  function partiallyEquivalentHtml(problemId, st) {
    var candidates = st.retiredInfo && st.retiredInfo.partiallyEquivalentTo;
    if (!candidates || !candidates.length) return '';
    var resolved = st.confirmedPartiallyEquivalents || [];
    if (resolved.length) {
      return (
        '<div class="ms-pdc-partially-equivalent-section">' +
        '<span class="ms-pdc-partially-equivalent-label">⚠ SNOMED marks this retired concept\'s meaning as split across several codes — this record may need reviewing as more than one problem:</span>' +
        '<div class="ms-pdc-panel">' +
        candidateGroupsHtml(problemId, resolved, 'partiallyequivalent', 'ms-pdc-partially-equivalent-btn', true) +
        '</div></div>'
      );
    }
    return (
      '<div class="ms-pdc-partially-equivalent-unmatched">SNOMED marks this retired concept\'s meaning as split across ' +
      candidates
        .map(function (c) {
          return '"' + esc(c.description) + '"';
        })
        .join(' and ') +
      ' but neither could be matched in Medicus’s own search index — try the manual search below.</div>'
    );
  }

  // Renders ONE lozenge per DISTINCT SNOMED code (see groupCandidatesByConcept)
  // instead of one per synonym — 2026-07-28, explicit user request after the
  // Pompholyx grouping was missing: a code with only one offered synonym
  // keeps its EXISTING single-button markup/class/click-binding untouched
  // (`singleBtnClass` — ms-pdc-alt, ms-pdc-descendant, …, so nothing
  // downstream needs to change for the common case); a code with several
  // synonyms gets a <select> of the wordings plus one shared "Use" button
  // (`.ms-pdc-multi-apply-btn`, bound once in bindPanelEvents and routed by
  // `category` through applyGroupedCandidate — see its own comment).
  // `includeConceptId` mirrors whichever existing single-button markup this
  // category used (some apply-functions match by descriptionId alone, some
  // need conceptId too — see each applyX function's own comment).
  function candidateGroupsHtml(problemId, items, category, singleBtnClass, includeConceptId) {
    var groups = groupCandidatesByConcept(items);
    return groups
      .map(function (g) {
        var scoreHtml =
          typeof g.bestScore === 'number'
            ? ' <span class="ms-pdc-descendant-score">(' + g.bestScore + '% match)</span>'
            : '';
        if (g.options.length === 1) {
          var only = g.options[0];
          return (
            '<button type="button" class="' +
            singleBtnClass +
            '" data-problem-id="' +
            esc(problemId) +
            '"' +
            (includeConceptId ? ' data-concept-id="' + esc(g.conceptId) + '"' : '') +
            ' data-description-id="' +
            esc(only.descriptionId || '') +
            '">' +
            esc(only.description) +
            scoreHtml +
            '</button>'
          );
        }
        var options = g.options
          .map(function (o) {
            return '<option value="' + esc(o.descriptionId || '') + '">' + esc(o.description) + '</option>';
          })
          .join('');
        return (
          '<span class="ms-pdc-multi-group" data-concept-id="' +
          esc(g.conceptId) +
          '">' +
          '<select class="ms-pdc-multi-select">' +
          options +
          '</select>' +
          scoreHtml +
          '<button type="button" class="ms-pdc-multi-apply-btn" data-problem-id="' +
          esc(problemId) +
          '" data-category="' +
          esc(category) +
          '">Use</button>' +
          '</span>'
        );
      })
      .join('');
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

  // Shared by journalMatchesHtml (display) and applyToJournal (confirm()
  // dialog text) so the two never disagree on wording — module-scope `var`,
  // hoisted, safe to reference from either location regardless of source
  // order.
  var JOURNAL_MATCH_LABELS = {
    linked: 'Linked to this problem in the journal',
    'linked-exact-text': 'Linked to this problem, matching wording',
    'linked-partial-text': 'Linked to this problem, similar wording',
    'verified-date-exact-text': "Matching wording, confirmed against the note's own date",
    'verified-date-partial-text': "Similar wording, confirmed against the note's own date",
    'date-exact-text': 'Same date, matching wording',
    'date-partial-text': 'Same date, similar wording',
    'fuzzy-code-text-exact': 'Approximate date, code text found in note',
    'fuzzy-code-text-partial': 'Approximate date, code text similar to note',
    'fuzzy-additional-info-exact': 'Approximate date, matching additional details',
    'fuzzy-additional-info-partial': 'Approximate date, similar additional details',
  };

  // Journal duplicate detection (2026-08-12) — see
  // shared/journal-problem-matching.js header for the full detection story.
  // Lists journal note entries that look like the same clinical event as
  // this problem. Silent (returns '') when nothing was found, so the
  // common no-duplicate case adds no noise to the panel.
  //
  // MULTIPLE-MATCH WARNING (2026-08-12, Nick's request): GP2GP import can
  // duplicate whole records, not just individual codes, so more than one
  // genuine journal match for a single problem is itself a signal worth
  // surfacing — rather than us guessing which of several is the "real" one
  // to sync, point the clinician at the purpose-built tool
  // (duplicate-checker.html's "Analyse full record for duplicates") first.
  // Shown ABOVE the match list, not instead of it — the individual matches
  // are still useful context either way.
  //
  // WRITE ACTION (2026-08-13) — see applyToJournal's own comment for the
  // confirmed POST /clinical/note/change-note contract. Each row gets an
  // "Apply to journal" button UNLESS its own clinicalCodeDescription
  // already normalises the same as st.currentDescription (nothing to
  // sync), mirroring the "never offered if it's already the current
  // description" rule used elsewhere in this file for preferredDescriptions.
  // Per-row write state lives in st.journalApply[entryId], not the
  // problem-level st.saving/st.saved (see rowState's own comment on why).
  function journalMatchesHtml(problemId, st) {
    if (!st.journalMatches || !st.journalMatches.length) return '';
    var normalise = (window.MSProblemTextLinking && window.MSProblemTextLinking.normaliseText) || String;
    var currentNormalised = normalise(st.currentDescription);
    var hasDateConfirmed = st.journalMatches.some(function (m) {
      return m.dateConfirmed;
    });
    // MULTI-MATCH DISAMBIGUATION (2026-08-14) — see
    // shared/journal-problem-matching.js's applyDateConfirmation for the
    // full story. When one match's own true recordDate exactly confirms
    // against the problem, say so in the warning itself — the clinician
    // shouldn't have to work out which highlighted row it refers to.
    var warningHtml =
      st.journalMatches.length > 1
        ? '<div class="ms-pdc-journal-matches-warning">⚠ ' +
          st.journalMatches.length +
          ' journal entries matched this problem. GP2GP import can duplicate whole records, not just codes — consider running "Analyse full record for duplicates" (Duplicate Checker) before syncing these individually.' +
          (hasDateConfirmed
            ? ' The entry marked ✓ below has its own recordDate confirmed against this problem’s recordDate/onsetDate — the most likely genuine match.'
            : '') +
          '</div>'
        : '';
    return (
      '<div class="ms-pdc-journal-matches-section">' +
      warningHtml +
      '<span class="ms-pdc-journal-matches-label">Also found in the journal — review and update these separately in the Journal tab:</span>' +
      '<ul class="ms-pdc-journal-matches-list">' +
      st.journalMatches
        .map(function (m) {
          var jst = st.journalApply[m.entryId];
          var alreadyMatches = normalise(m.clinicalCodeDescription) === currentNormalised;
          var actionHtml;
          if (jst && jst.saved) {
            // UNDO (2026-08-14) — see undoJournalCodeSync's own comment.
            // Only offered while the previous code is actually in hand
            // (prevCode captured from the pre-write prefill) — a success
            // with nothing to restore renders the plain confirmation only.
            actionHtml =
              '<div class="ms-pdc-journal-apply-row">' +
              '<div class="ms-pdc-journal-apply-success">✓ Journal entry updated to “' +
              esc(jst.appliedDescription) +
              '”</div>' +
              (jst.prevCode && jst.prevCode.description
                ? '<button type="button" class="ms-pdc-journal-undo-btn" data-entry-id="' +
                  esc(m.entryId) +
                  '" data-undo-kind="code"' +
                  (jst.undoing ? ' disabled' : '') +
                  '>' +
                  (jst.undoing ? 'Undoing…' : 'Undo') +
                  '</button>'
                : '') +
              (jst.error ? '<span class="ms-pdc-journal-apply-error">' + esc(jst.error) + '</span>' : '') +
              '</div>';
          } else if (alreadyMatches) {
            // A revert leaves the entry back on its old code, which no
            // longer normalises to the current description — so this
            // branch is only reachable pre-sync or when there was nothing
            // to sync; jst.undone never needs handling here.
            actionHtml = '';
          } else {
            actionHtml =
              '<div class="ms-pdc-journal-apply-row">' +
              (jst && jst.undone
                ? '<span class="ms-pdc-journal-undo-note">↩ Sync undone — “' +
                  esc(jst.restoredDescription) +
                  '” restored</span>'
                : '') +
              '<button type="button" class="ms-pdc-journal-apply-btn" data-entry-id="' +
              esc(m.entryId) +
              '"' +
              (jst && jst.saving ? ' disabled' : '') +
              '>' +
              (jst && jst.saving ? 'Applying…' : 'Apply to journal') +
              '</button>' +
              (jst && jst.error ? '<span class="ms-pdc-journal-apply-error">' + esc(jst.error) + '</span>' : '') +
              '</div>';
          }
          // Separate state map (journalInfoApply, not journalApply) — see
          // that field's own comment on rowState. No button here: this
          // sync only ever happens as a prompt chained after "Remove
          // generic import text" succeeds (applyGenericAdditionalInfoToJournal),
          // never a standalone action, so there's nothing to click — just
          // the resulting saved/error state to echo, same "never claim
          // completion silently" discipline as the code-sync action above.
          var infoJst = st.journalInfoApply[m.entryId];
          var infoHtml = '';
          if (infoJst && infoJst.saved) {
            // UNDO (2026-08-14) — text-sync twin of the code-sync Undo
            // above; see undoJournalTextSync's own comment. prevNote is ''
            // for a note whose text was ENTIRELY boilerplate (the confirmed
            // live "{Episodicity…}"-only case), which is still a real
            // previous state worth restoring — hence != null, not truthy.
            infoHtml =
              '<div class="ms-pdc-journal-apply-row">' +
              '<div class="ms-pdc-journal-apply-success">✓ Additional details also cleaned in this entry</div>' +
              (infoJst.prevNote != null
                ? '<button type="button" class="ms-pdc-journal-undo-btn" data-entry-id="' +
                  esc(m.entryId) +
                  '" data-undo-kind="text"' +
                  (infoJst.undoing ? ' disabled' : '') +
                  '>' +
                  (infoJst.undoing ? 'Undoing…' : 'Undo') +
                  '</button>'
                : '') +
              (infoJst.error ? '<span class="ms-pdc-journal-apply-error">' + esc(infoJst.error) + '</span>' : '') +
              '</div>';
          } else if (infoJst && infoJst.undone) {
            infoHtml =
              '<div class="ms-pdc-journal-undo-note">↩ Text cleanup undone — the entry’s previous details were restored</div>';
          } else if (infoJst && infoJst.error) {
            infoHtml = '<div class="ms-pdc-journal-apply-error">' + esc(infoJst.error) + '</div>';
          }
          return (
            '<li class="ms-pdc-journal-match ms-pdc-journal-match-' +
            m.tier +
            (m.dateConfirmed ? ' ms-pdc-journal-match-date-confirmed' : '') +
            '"><span class="ms-pdc-journal-match-date">' +
            esc(m.date || '') +
            '</span> <span class="ms-pdc-journal-match-desc">' +
            esc(m.clinicalCodeDescription) +
            '</span> <span class="ms-pdc-journal-match-confidence">' +
            (m.dateConfirmed
              ? '✓ Confirmed — recordDate matches this problem exactly'
              : esc(JOURNAL_MATCH_LABELS[m.tier] || m.tier)) +
            '</span>' +
            actionHtml +
            infoHtml +
            '</li>'
          );
        })
        .join('') +
      '</ul></div>'
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

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Severity-defaulting contradiction (2026-07-29) — see this file's own
  // header comment for the full GP2GP mechanism. Deliberately its own
  // section, not folded into genericAdditionalInfoHtml above: this is a
  // genuine clinical-data correction (the structured significance field
  // itself changes), not just a cosmetic text tidy-up, so it gets an
  // explanatory note plus its own explicit action — never silently applied
  // alongside the code-description fix.
  // Explanation text branches on sc.source (the pattern entry's own `id` —
  // see computeAdditionalInfoFindings) since the two configured sources have
  // genuinely different evidence behind the suggested value: the GP2GP
  // defaulting text (severityDefaultingContradiction) directly STATES the
  // value in the import text itself; the source-system priority mapping
  // (sourceSystemPriorityValue, 2026-07-29 — "PRIORITY=1" -> Major) is a
  // locally-configured convention this practice has confirmed from its own
  // experience of that source system, not something the import text asserts
  // in plain English — worth being explicit about the provenance so the
  // clinician isn't misled into thinking the source record spelled out
  // "Major" itself.
  function severityContradictionExplanation(sc) {
    if (sc.source === 'sourceSystemPriorityValue') {
      return (
        'the source record’s own "PRIORITY=1" value maps to <strong>Major</strong> under this practice’s ' +
        'own confirmed convention for that source system — Medicus stored it as <strong>' +
        esc(capitalize(sc.current)) +
        '</strong> without applying that mapping.'
      );
    }
    return (
      'its own import text says the source record’s severity was <strong>' +
      esc(capitalize(sc.stated)) +
      '</strong> — Medicus couldn’t map that value automatically on import, so it defaulted the structured ' +
      'field to Minor and left the real value as plain text instead of correcting it.'
    );
  }

  function severityContradictionHtml(problemId, st) {
    if (!st.severityContradiction) return '';
    var sc = st.severityContradiction;
    return (
      '<div class="ms-pdc-severity-section">' +
      '<div class="ms-pdc-severity-note">⚠ Import text contradicts the stored severity: this problem is recorded as <strong>' +
      esc(capitalize(sc.current)) +
      '</strong>, but ' +
      severityContradictionExplanation(sc) +
      '</div>' +
      '<button type="button" class="ms-pdc-severity-correct-btn" data-problem-id="' +
      esc(problemId) +
      '"' +
      (st.severityContradictionSaving ? ' disabled' : '') +
      '>' +
      (st.severityContradictionSaving
        ? 'Correcting…'
        : 'Correct severity to ' + esc(capitalize(sc.stated)) + ' and remove junk text') +
      '</button>' +
      '</div>'
    );
  }

  // Source-system priority value, no confirmed severity mapping (2026-07-29)
  // — see rules/generic-additional-info-text.json's sourceSystemPriorityValue
  // entry for the full story. Deliberately informational-only, no button:
  // unlike severityContradictionHtml above, there is no reliable mapping
  // from this source system's own priority scale to Major/Minor, so the
  // honest response is a prompt to check manually, never a guessed
  // correction. The raw "PRIORITY=n" text itself is still offered for
  // removal via the ordinary genericAdditionalInfoHtml button below (this
  // note and that button coexist, unlike the contradiction case which
  // supersedes it).
  function severityReviewNoteHtml(st) {
    if (!st.severityReviewNote) return '';
    var note = st.severityReviewNote;
    return (
      '<div class="ms-pdc-priority-review-note">ℹ Import text included a source-system priority value ("PRIORITY=' +
      esc(note.priorityValue) +
      '") with no confirmed mapping to Major/Minor — this problem is currently recorded as <strong>' +
      esc(capitalize(note.current)) +
      "</strong>; please check that's clinically correct.</div>"
    );
  }

  // "(Grouped with X)" reference (2026-08-09) — see shared/problem-text-
  // linking.js's header for the full story. Two states: no confident match
  // (informational only, same "ask the clinician to check" philosophy as
  // severityReviewNoteHtml above) vs a confident match, offering all THREE
  // relationship choices Nick asked for (2026-08-09: "the safest thing to
  // assume is a 'linked problem' relationship... but I would like us to
  // offer both that and a child/parent relationship in either direction") —
  // deliberately never pre-selecting one, since the text alone gives no
  // reliable signal about hierarchy direction.
  function linkSuggestionHtml(problemId, st) {
    if (!st.linkSuggestion) return '';
    var ls = st.linkSuggestion;
    if (!ls.match) {
      return (
        '<div class="ms-pdc-link-review-note">ℹ Import text mentions "Grouped with ' +
        esc(ls.problemName) +
        '" but no clearly matching problem was found on this record — check manually whether a link should be created.</div>'
      );
    }
    var m = ls.match;
    // Someone already created this relationship manually in Medicus
    // (checkExistingRelationship, run when this suggestion was flagged) —
    // offering to (re)create it would be redundant at best and confusing at
    // worst; the only genuinely useful action left is cleaning up the now-
    // stale import text (2026-08-09 request).
    if (ls.alreadyRelated) {
      return (
        '<div class="ms-pdc-link-section">' +
        '<div class="ms-pdc-link-note">🔗 Already linked/nested with <strong>' +
        esc(m.description) +
        '</strong> — the import text is now redundant.</div>' +
        '<div class="ms-pdc-link-actions">' +
        '<button type="button" class="ms-pdc-link-btn" data-problem-id="' +
        esc(problemId) +
        '" data-relationship="alreadyRelated"' +
        (st.linkSuggestionActing ? ' disabled' : '') +
        '>Remove import text</button>' +
        '</div>' +
        (st.linkSuggestionActing ? '<div class="ms-pdc-link-saving">Removing…</div>' : '') +
        '</div>'
      );
    }
    // Two-step confirm for the three RELATIONSHIP writes (review finding:
    // the canvas gained a confirm bar for these identical choices, this
    // inline widget was committing update-parent-problem/update-problem-
    // links on a single click — a misclick between the two adjacent inverse
    // nest buttons wrote an inverted hierarchy with no confirm and no undo).
    // The text-only actions above ('alreadyRelated'/'leaveAsIs') stay
    // single-click, consistent with this widget's other text-cleanup
    // buttons — they never write a relationship.
    if (st.linkSuggestionPending) {
      var pendingMsg;
      var pendingConfirmLabel;
      if (st.linkSuggestionPending === 'linked') {
        pendingMsg =
          'This will create a flat (non-hierarchical) link between this problem and <strong>' +
          esc(m.description) +
          '</strong> — neither becomes a child of the other.';
        pendingConfirmLabel = 'Confirm — link them';
      } else if (st.linkSuggestionPending === 'thisChildOfMatch') {
        pendingMsg =
          'This will nest this problem under <strong>' +
          esc(m.description) +
          '</strong> — it will display as a child on the problem list, not as a top-level problem.';
        pendingConfirmLabel = 'Confirm — nest it';
      } else {
        pendingMsg =
          'This will nest <strong>' +
          esc(m.description) +
          '</strong> under this problem — it will display as a child on the problem list, not as a top-level problem.';
        pendingConfirmLabel = 'Confirm — nest it';
      }
      return (
        '<div class="ms-pdc-link-section">' +
        '<div class="ms-pdc-link-confirm">' +
        '<div class="ms-pdc-link-confirm-msg">' +
        pendingMsg +
        '</div>' +
        '<div class="ms-pdc-link-actions">' +
        '<button type="button" class="ms-pdc-link-cancel-btn" data-problem-id="' +
        esc(problemId) +
        '"' +
        (st.linkSuggestionActing ? ' disabled' : '') +
        '>Cancel</button>' +
        '<button type="button" class="ms-pdc-link-confirm-btn" data-problem-id="' +
        esc(problemId) +
        '"' +
        (st.linkSuggestionActing ? ' disabled' : '') +
        '>' +
        (st.linkSuggestionActing ? 'Creating…' : pendingConfirmLabel) +
        '</button>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="ms-pdc-link-section">' +
      '<div class="ms-pdc-link-note">🔗 Import text suggests a relationship with <strong>' +
      esc(m.description) +
      '</strong>' +
      (m.confidence === 'partial' ? ' (best match for "' + esc(ls.problemName) + '")' : '') +
      ':</div>' +
      // A relationship with someone ELSE already exists (checkExistingRelationship,
      // 2026-08-09 follow-up — real case: the text named a plausible-but-wrong
      // problem, the clinician had actually already sorted this one out with a
      // DIFFERENT problem). The 3-way offer below still stands (the text's guess
      // might be right in ADDITION to the existing one), but a clinician who's
      // already satisfied needs an escape hatch that doesn't force a redundant
      // or conflicting write.
      (ls.hasOtherRelationship
        ? '<div class="ms-pdc-link-review-note">This problem already has another relationship recorded.</div>'
        : '') +
      '<div class="ms-pdc-link-actions">' +
      '<button type="button" class="ms-pdc-link-btn" data-problem-id="' +
      esc(problemId) +
      '" data-relationship="linked"' +
      (st.linkSuggestionActing ? ' disabled' : '') +
      '>Link as related problem</button>' +
      '<button type="button" class="ms-pdc-link-btn" data-problem-id="' +
      esc(problemId) +
      '" data-relationship="thisChildOfMatch"' +
      (st.linkSuggestionActing ? ' disabled' : '') +
      '>Nest this under ' +
      esc(m.description) +
      '</button>' +
      '<button type="button" class="ms-pdc-link-btn" data-problem-id="' +
      esc(problemId) +
      '" data-relationship="matchChildOfThis"' +
      (st.linkSuggestionActing ? ' disabled' : '') +
      '>Nest ' +
      esc(m.description) +
      ' under this</button>' +
      (ls.hasOtherRelationship
        ? '<button type="button" class="ms-pdc-link-btn ms-pdc-link-btn-leave" data-problem-id="' +
          esc(problemId) +
          '" data-relationship="leaveAsIs"' +
          (st.linkSuggestionActing ? ' disabled' : '') +
          '>Leave as-is, remove import text</button>'
        : '') +
      '</div>' +
      (st.linkSuggestionActing ? '<div class="ms-pdc-link-saving">Creating…</div>' : '') +
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

  // PRACTICE CONCEPT-REMAP banner — see openPanel's own comment (where
  // st.practiceRemap is resolved) for the full story. A materially
  // higher-confidence signal than the crossConcept text-match section below
  // (a REAL precedent this practice has already applied, not a text
  // coincidence), so it gets its own clearly-labelled section — still
  // requires the explicit click, same discipline as everywhere else here.
  function practiceRemapHtml(problemId, st) {
    if (!st.practiceRemap) return '';
    var r = st.practiceRemap;
    return (
      '<div class="ms-pdc-practice-remap-section">' +
      '<span class="ms-pdc-practice-remap-label">✓ This practice has previously replaced this code with:</span>' +
      '<div class="ms-pdc-panel">' +
      '<button type="button" class="ms-pdc-practice-remap-btn" data-problem-id="' +
      esc(problemId) +
      '" data-concept-id="' +
      esc(r.conceptId) +
      '" data-description-id="' +
      esc(r.descriptionId || '') +
      '">' +
      esc(r.description) +
      '</button>' +
      '</div></div>'
    );
  }

  // Reassurance note (2026-07-29, real user concern raised from a
  // screenshot): a problem flagged ONLY for import-text housekeeping (junk
  // generic text, a severity contradiction/review note) but with NO actual
  // code-quality signal (not retired, not Read-code-derived, not
  // looksOutdated()-flagged) still surfaces the SAME wall of
  // alternative-code suggestion buttons as a genuinely outdated code —
  // purely because additionalInformation happens to contain wording that
  // matches a hint word for the (unrelated) descendant/cross-concept
  // search. Visually indistinguishable from "this code is wrong, pick a
  // replacement", which misleads when the code itself was never actually
  // in question. codeQualityConcernExists (pure logic, testable) lives with
  // the other pure helpers above; this just renders it.
  function codeLooksOkNoteHtml(st, hasAnySuggestion) {
    if (!hasAnySuggestion || codeQualityConcernExists(st)) return '';
    return (
      '<div class="ms-pdc-code-ok-note">ℹ This problem’s own SNOMED code hasn’t been flagged as outdated or ' +
      'retired — it was only flagged here for import-text housekeeping. Any suggestions below come from wording ' +
      'in “Additional info” and are optional, not a sign the current code is wrong.</div>'
    );
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
      severityContradictionHtml(problemId, st) +
      severityReviewNoteHtml(st) +
      linkSuggestionHtml(problemId, st) +
      genericAdditionalInfoHtml(problemId, st) +
      retiredInfoHtml(problemId, st) +
      legacyReadCodeHtml(st) +
      journalMatchesHtml(problemId, st);
    var remapHtml = practiceRemapHtml(problemId, st);
    if (!alts.length && !descendants.length && !crossConcept.length && !hintExpanded.length && !remapHtml) {
      return (
        infoHtml +
        '<div class="ms-pdc-panel"><span class="ms-pdc-empty">No alternative description found for this code.</span></div>' +
        manualSearchHtml(problemId, st)
      );
    }
    var hasAnySuggestion = !!(
      alts.length ||
      descendants.length ||
      crossConcept.length ||
      hintExpanded.length ||
      remapHtml
    );
    var html = infoHtml + codeLooksOkNoteHtml(st, hasAnySuggestion) + remapHtml;
    if (alts.length) {
      html +=
        '<div class="ms-pdc-panel">' + candidateGroupsHtml(problemId, alts, 'alt', 'ms-pdc-alt', false) + '</div>';
    }
    if (descendants.length) {
      // Deliberately separate from the same-concept panel above and labelled
      // to make the semantic difference obvious: this changes the CODE, not
      // just its label — a real coding decision, never auto-applied.
      // matchScore (0-100, see candidateGroupsHtml/groupCandidatesByConcept):
      // the % of free-text hint words found in a candidate's own wording —
      // RANKING signal only (ancestry + "at least one word" already
      // guarantee safety), shown so the clinician can judge relevance at a
      // glance, e.g. "removal of uterine fibroid" (67%) vs "removal of
      // uterine myoma" (33%) for the same additional info.
      html +=
        '<div class="ms-pdc-descendant-section">' +
        '<span class="ms-pdc-descendant-label">Additional info suggests a more specific code:</span>' +
        '<div class="ms-pdc-panel">' +
        candidateGroupsHtml(problemId, descendants, 'descendant', 'ms-pdc-descendant', false) +
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
        candidateGroupsHtml(problemId, crossConcept, 'crossconcept', 'ms-pdc-crossconcept', true) +
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
        candidateGroupsHtml(problemId, hintExpanded, 'hintexpand', 'ms-pdc-hintexpand', true) +
        '</div>' +
        '</div>';
    }
    html += manualSearchHtml(problemId, st);
    return html;
  }

  function renderPanel(problemId) {
    var st = rowState(problemId);
    // hostContainer (set by openInContainer) takes priority over the default
    // inline-next-to-the-row insertion — falls back to the original
    // anchorEl.parentElement behaviour untouched when hostContainer is unset,
    // so the accordion-triggered flow this file already shipped is unchanged.
    var host = st.hostContainer || (st.anchorEl && st.anchorEl.parentElement);
    if (!st.open) {
      if (st.panelEl) {
        st.panelEl.remove();
        st.panelEl = null;
      }
      return;
    }
    if (!host) return;
    if (!st.panelEl) {
      st.panelEl = document.createElement('div');
      st.panelEl.className = 'ms-pdc-panel-wrap';
      host.appendChild(st.panelEl);
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
        applyConfirmedReplacement(problemId, btn.getAttribute('data-description-id'));
      });
    });
    root.querySelectorAll('.ms-pdc-possibly-equivalent-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPossiblyEquivalent(
          problemId,
          btn.getAttribute('data-concept-id'),
          btn.getAttribute('data-description-id')
        );
      });
    });
    root.querySelectorAll('.ms-pdc-partially-equivalent-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPartiallyEquivalent(
          problemId,
          btn.getAttribute('data-concept-id'),
          btn.getAttribute('data-description-id')
        );
      });
    });
    root.querySelectorAll('.ms-pdc-practice-remap-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyPracticeRemap(problemId);
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
    root.querySelectorAll('.ms-pdc-severity-correct-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyCorrectSeverityAndRemoveJunk(problemId);
      });
    });
    root.querySelectorAll('.ms-pdc-link-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var relationship = btn.getAttribute('data-relationship');
        if (relationship === 'alreadyRelated' || relationship === 'leaveAsIs') {
          // Text-only cleanup — single click, same as the widget's other
          // text-cleanup buttons; no relationship write happens here.
          applyLinkSuggestion(problemId, relationship);
          return;
        }
        // Relationship writes arm the confirm step (see linkSuggestionHtml's
        // own comment) — only the Confirm button below actually commits.
        rowState(problemId).linkSuggestionPending = relationship;
        renderPanel(problemId);
      });
    });
    root.querySelectorAll('.ms-pdc-link-confirm-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyLinkSuggestion(problemId, rowState(problemId).linkSuggestionPending);
      });
    });
    root.querySelectorAll('.ms-pdc-link-cancel-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        rowState(problemId).linkSuggestionPending = null;
        renderPanel(problemId);
      });
    });
    root.querySelectorAll('.ms-pdc-journal-apply-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyToJournal(problemId, btn.getAttribute('data-entry-id'));
      });
    });
    // Undo buttons for both journal-sync write paths (2026-08-14) — one
    // class, discriminated by data-undo-kind, since the two undos are
    // rendered by the same journalMatchesHtml rows but revert different
    // fields (code vs note text) held in different state maps.
    root.querySelectorAll('.ms-pdc-journal-undo-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var entryId = btn.getAttribute('data-entry-id');
        if (btn.getAttribute('data-undo-kind') === 'text') {
          undoJournalTextSync(problemId, entryId);
        } else {
          undoJournalCodeSync(problemId, entryId);
        }
      });
    });
    // Grouped multi-synonym "Use" button (see candidateGroupsHtml) — reads
    // the sibling <select>'s current value, not a fixed data attribute,
    // since the whole point is the clinician picks the wording at click time.
    root.querySelectorAll('.ms-pdc-multi-apply-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.closest('.ms-pdc-multi-group');
        var select = group && group.querySelector('select');
        if (!group || !select) return;
        applyGroupedCandidate(
          problemId,
          btn.getAttribute('data-category'),
          group.getAttribute('data-concept-id'),
          select.value
        );
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
      st.currentDescriptionId = code.descriptionId; // needed to build a correct noteSNOMEDct for applyToJournal — not used by any existing apply path, which only ever needs conceptId/description
      st.additionalInformation = prefill.additionalInformation || '';
      // Computed for EVERY open panel, regardless of why this row was
      // flagged — additionalInformation is already in hand here whether the
      // fetch above just ran or was reused from the retirement/legacy-code
      // scan's own cache, so this costs nothing extra (one local extension
      // resource load, cached after the first panel opens).
      var genericInfoEntries = await ensureGenericAdditionalInfoTextLoaded();
      var otherProblemsForLinking = (_problemsCache || [])
        .filter(function (p) {
          return p.id !== problemId;
        })
        .map(function (p) {
          return { id: p.id, description: p.problemCodeDescription };
        });
      var findings = computeAdditionalInfoFindings(
        prefill.additionalInformation,
        prefill.significance,
        genericInfoEntries,
        otherProblemsForLinking
      );
      st.genericAdditionalInfo = findings.genericAdditionalInfo;
      st.severityContradiction = findings.severityContradiction;
      st.severityReviewNote = findings.severityReviewNote;
      st.linkSuggestion = findings.linkSuggestion;
      // A confident match might already be a real relationship on the
      // record (someone fixed it manually in Medicus) — checked here so the
      // panel never offers a redundant "create this link" button for a
      // relationship that already exists (2026-08-09 request). Best-effort:
      // a failed check leaves alreadyRelated unset, which reads as "not
      // known to be related" — the ordinary 3-way offer still appears
      // rather than the panel silently showing nothing.
      if (st.linkSuggestion && st.linkSuggestion.match && window.ProblemNesting) {
        try {
          var relResult = await window.ProblemNesting.checkExistingRelationship(
            problemId,
            st.linkSuggestion.match.problemId
          );
          st.linkSuggestion.alreadyRelated = relResult.relatedToMatch;
          // A relationship with someone ELSE, not the text's guess — see
          // checkExistingRelationship's own header for the real case that
          // motivated this distinction.
          st.linkSuggestion.hasOtherRelationship = !relResult.relatedToMatch && relResult.hasAnyRelationship;
        } catch (e) {
          /* left unset — see comment above */
        }
      }
      // JOURNAL DUPLICATE DETECTION — see shared/journal-problem-matching.js
      // header for the detection story; see applyToJournal/
      // buildChangeNotePayload's own comments for the write path (confirmed
      // live 2026-08-13, POST /clinical/note/change-note). Best-effort, own
      // try/catch — a slow or failed journal fetch must never block the
      // rest of the panel, same discipline as the relationship check just
      // above.
      st.journalMatches = null;
      try {
        var journalPatientId = prefill.patientId || _lastPatientId || (getPatientInfo() || {}).patientId;
        if (journalPatientId && window.MSJournalProblemMatching && window.MSProblemTextLinking) {
          var journalPayload = await apiFetch(
            '/clinical/data/patient-journal/overview/' + encodeURIComponent(journalPatientId)
          );
          var dayGroups = (journalPayload && journalPayload.patientJournalRecords) || [];
          var journalProblem = {
            id: problemId,
            description: code.description,
            recordDate: prefill.recordDate || null,
            onsetDate: prefill.onsetDate || null,
            additionalInformation: prefill.additionalInformation || null,
          };
          st.journalMatches = window.MSJournalProblemMatching.findJournalMatchesForProblem(
            journalProblem,
            dayGroups,
            window.MSProblemTextLinking.matchProblemByName
          );

          // DATE VERIFICATION (2026-08-13, Nick's request): the day-group
          // title used above is confirmed sometimes wrong (see
          // shared/journal-problem-matching.js header) — a candidate whose
          // OWN clinicalCodeDescription already matches this problem's code,
          // but whose day-group date didn't line up, might just be a
          // day-group artifact. Only spend the extra per-note fetch on
          // candidates that would otherwise be silently dropped (not
          // already structurally linked, not already date-matched) —
          // narrows this to a small set, not the whole journal.
          var codeTextCandidates = window.MSJournalProblemMatching.findCodeTextMatches(
            journalProblem,
            dayGroups,
            window.MSProblemTextLinking.matchProblemByName
          );
          var needsVerification = codeTextCandidates.filter(function (c) {
            return !c.alreadyStructurallyLinked && !c.alreadyDateMatched;
          });
          if (needsVerification.length) {
            var verifiedResults = await Promise.all(
              needsVerification.map(async function (c) {
                try {
                  var noteDetail = await apiFetch('/clinical/data/note/overview/' + encodeURIComponent(c.entryId));
                  return window.MSJournalProblemMatching.resolveVerifiedDateMatch(
                    journalProblem,
                    c,
                    noteDetail && noteDetail.recordDate
                  );
                } catch (e) {
                  return null; // best-effort per candidate — one failed lookup must not affect the others
                }
              })
            );
            var verifiedMatches = verifiedResults.filter(Boolean);
            if (verifiedMatches.length) {
              // dedupeJournalMatches, NOT sortJournalMatches (fix,
              // 2026-08-14 post-review): the fuzzy fallback inside
              // findJournalMatchesForProblem and this verified-date pass
              // can BOTH surface the same entryId — see that module
              // function's own header for the full story. A plain sorted
              // concat rendered one real journal note as two match rows
              // (two "Apply to journal" buttons) and made
              // resolveJournalSyncTargets alert "2 matched, none
              // confirmed" instead of auto-prompting the sync.
              st.journalMatches = window.MSJournalProblemMatching.dedupeJournalMatches(
                st.journalMatches.concat(verifiedMatches)
              );
            }
          }

          // MULTI-MATCH DISAMBIGUATION (2026-08-14, Nick's real test case —
          // see shared/journal-problem-matching.js's applyDateConfirmation
          // for the full story: a paediatric-surveillance problem with 4
          // structurally-linked, identically-worded journal entries, only
          // ONE of which had a recordDate exactly matching the problem's
          // own recordDate/onsetDate). Only worth the extra per-entry
          // fetches when there's actually more than one match to tell
          // apart — a single match has nothing to disambiguate.
          if (st.journalMatches.length > 1) {
            var verifiedDatesByEntryId = {};
            await Promise.all(
              st.journalMatches.map(async function (m) {
                try {
                  var detail = await apiFetch('/clinical/data/note/overview/' + encodeURIComponent(m.entryId));
                  if (detail && detail.recordDate) verifiedDatesByEntryId[m.entryId] = detail.recordDate;
                } catch (e) {
                  /* best-effort per entry — one failed lookup must not affect the others */
                }
              })
            );
            st.journalMatches = window.MSJournalProblemMatching.applyDateConfirmation(
              journalProblem,
              st.journalMatches,
              verifiedDatesByEntryId
            );
          }
        }
      } catch (e) {
        console.warn('[Clean up code] journal duplicate check failed (non-fatal):', e && e.message);
      }
      var queryText = stripLegacyMarkers(code.description);
      var results = await searchDescriptions(queryText);
      // Supplement with an SCTID-keyed search for the current concept's own
      // synonyms — see searchDescendantsNarrowed's comment above for why:
      // the broad free-text query can return zero results for a legacy
      // description whose wording doesn't literally match any current
      // synonym, and this bypasses that entirely.
      var byConceptId = await searchDescriptions(code.conceptId);
      // SAME-CONCEPT BODY-STRUCTURE FALLBACK (2026-07-28 — real case:
      // "[M]Tubulovillous adenoma", conceptId 61722000, an ACTIVE concept —
      // this isn't a retirement case at all). SEARCH_PATH's
      // constrainingParentConcepts is Clinical finding/Procedure/Situation/
      // Social context/Event only, so a bare-SCTID query for a concept that
      // itself lives on the Body structure / morphologic-abnormality axis
      // (like every "(morphologic abnormality)"-suffixed ICD-O [M]-code
      // concept) returns ZERO results regardless of query text — same root
      // cause as resolveSnomedNamedCandidate's own BODY-STRUCTURE FALLBACK
      // (v3.193.0), just hit here on the everyday same-concept-alternatives
      // path instead of the retirement-replacement path. Same two-step fix:
      // only retried when the broad-scope bare-SCTID query came back empty.
      if (!byConceptId.length) {
        byConceptId = await searchDescendantsNarrowed('123037004', code.conceptId);
      }
      var combinedResults = results.concat(byConceptId);
      st.alternatives = sameConceptAlternatives(combinedResults, code.conceptId, code.description);
      // PRACTICE-PREFERENCE SUPPLEMENT (2026-07-29, real gap reported live):
      // a clinician had to fall back to manual search because NONE of the
      // search-based candidates above found anything for this concept —
      // Medicus's own index can legitimately have nothing to offer. But if
      // this practice has already resolved this exact conceptId before
      // (recorded in pdc.preferredDescriptions, written by applyCode on
      // every successful save — including manual-search applies, since they
      // go through the same applyCode path), that choice needs no re-search
      // at all: it's a pure local lookup, so it can supply a candidate even
      // when the search-based sources above are completely empty. Same
      // safety tier as sameConceptAlternatives — resolvePreference is looked
      // up BY this concept's own conceptId, so it can never surface a
      // different concept. Deduped against the search-based candidates
      // (harmless overlap if Medicus's own index also had it); never offered
      // if it's already the current description (nothing to suggest).
      try {
        var pdcStore = await chrome.storage.local.get('pdc.preferredDescriptions');
        var pdcEntry = pdcStore['pdc.preferredDescriptions'] && pdcStore['pdc.preferredDescriptions'][code.conceptId];
        var preferred = resolvePreference(pdcEntry);
        if (
          preferred &&
          preferred.candidate &&
          preferred.candidate.description !== code.description &&
          !st.alternatives.some(function (a) {
            return (a.descriptionId || '') === preferred.key;
          })
        ) {
          st.alternatives.push({
            description: preferred.candidate.description,
            conceptId: code.conceptId,
            descriptionId: preferred.key,
          });
        }
      } catch (_) {
        // Never let a preference-store hiccup block the panel opening.
      }
      // PRACTICE CONCEPT-REMAP (2026-07-29 — a materially different, higher-
      // confidence signal than crossConceptAlternatives below: this is a
      // REAL PRECEDENT this practice has actually applied before (recorded
      // in pdc.conceptRemap, keyed by the SOURCE conceptId — see applyCode's
      // own comment for where it's written), not a text coincidence. Real
      // motivating case: "Injection into varicose vein of leg" (449705007)
      // manually replaced with "Injection of varicose vein of lower limb"
      // (449708009) — crossConceptAlternatives' text-match could never catch
      // this (the wordings don't match), but this practice has now done it
      // for real, so the NEXT problem still coded 449705007 should offer it
      // directly. Rendered in its own distinctly-labelled section (see
      // practiceRemapHtml) — still requires the explicit click, same
      // discipline as everywhere else in this file.
      st.practiceRemap = null;
      try {
        var remapStore = await chrome.storage.local.get('pdc.conceptRemap');
        var remapEntry = remapStore['pdc.conceptRemap'] && remapStore['pdc.conceptRemap'][code.conceptId];
        var remapPreferred = resolvePreference(remapEntry);
        if (remapPreferred && remapPreferred.candidate && remapPreferred.candidate.conceptId) {
          st.practiceRemap = remapPreferred.candidate;
        }
      } catch (_) {
        // Never let a preference-store hiccup block the panel opening.
      }
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
      // RETRIEVAL (revised 2026-07-23, then AGAIN 2026-07-27 — see below): a
      // single BLANK-QUERY fetch (searchDescendantsNarrowed with an empty
      // word) confirmed live to return the full descendant set of the
      // current concept directly — `query=` empty bypasses text matching
      // entirely, unlike guessing individual words, which can silently miss
      // a real descendant worded differently (e.g. "Hysteroscopic
      // myomectomy" never contains "fibroid"/"resection"). Confirmed far
      // more complete than per-word guessing FOR A NARROW PARENT CONCEPT.
      //
      // 2026-07-27 — the blank-query enumeration ALONE was found live to be
      // NOT enough for a BROAD parent concept: real case, "Closed Left
      // radial head fracture." coded to 125605004 "Fracture" (effectively
      // the root of every fracture in the body). The blank-query fetch caps
      // at 20 results (no pagination — the "could in theory have more" risk
      // below is a real, common failure here, not just theoretical) and for
      // a subtree this size those 20 are an arbitrary slice (hip/foot/jaw/
      // rib/skull fractures in the live capture) containing ZERO
      // radius-related entries — the real answers (68854005, 263196008)
      // never got fetched at all, so descendantAlternatives' filter had
      // nothing to match against regardless of ranking. Live-confirmed fix
      // (console probe against Medicus's own index): a narrowed query using
      // an actual hint word — `constrainingParentConcepts=125605004&query=
      // head` — finds BOTH target codes directly, each confirmed via their
      // own `parentConceptIds` to be true descendants; "radial" alone finds
      // one of the two. Now fires ONE narrowed query per hint word (same
      // discipline as the pathology/site hint searches below — one word per
      // query, never combined, since Medicus's all-words-required search
      // would silently zero-result a combined multi-word query) IN ADDITION
      // TO the blank-query fetch, concatenating every result set before
      // filtering — additive, not a replacement, since blank-query retrieval
      // is still the more complete option for a narrower parent concept.
      // descendantAlternatives already dedupes by descriptionId/description
      // and computes matchScore from each result's own text, so candidates
      // found by more than one word are never offered twice.
      //
      // RETIRED-CONCEPT PIVOT (2026-07-29 — real question, not yet a bug: a
      // clinician asked why 179304004 "Primary uncemented total hip
      // replacement" — retired, additionalInformation contains "right" —
      // didn't offer a right-specific descendant. Investigation found
      // 430694001 "Prosthetic arthroplasty of right hip" genuinely ISN'T a
      // descendant of anything relevant here — its own relationships carry
      // no "uncemented"/"total" facet at all, and SNOMED has no
      // precoordinated concept combining all three, so nothing was actually
      // missed for THAT case. But a REAL latent gap surfaced during the
      // investigation: this search was narrowing under `code.conceptId` —
      // the problem's OWN current conceptId — which for a retired problem is
      // the OLD, often-childless retired concept (179304004 itself has ZERO
      // descendants, confirmed live), not the confirmed REPLACEMENT concept
      // that's actually live in SNOMED and could genuinely have laterality-
      // specific children. Now prefers the confirmed replacement's conceptId
      // (st.retiredInfo.replacement, already resolved by the opt-in
      // retirement scan before this row ever got a button — no extra fetch)
      // when this row was flagged as retired WITH a confirmed replacement,
      // falling back to code.conceptId exactly as before otherwise (an
      // active concept, or a retired one with no confirmed replacement).
      // Passed as the ancestry-check conceptId to descendantAlternatives too
      // — not just the search target — since a candidate must be a genuine
      // descendant of WHICHEVER concept was actually searched, or the
      // hierarchy-safety filter would reject every real result.
      var descendantSearchConceptId = descendantSearchTargetConceptId(st.retiredInfo, code.conceptId);
      // Diagnostic log, retired rows only (low frequency, not noise on the
      // common active-concept path) — content-script console output appears
      // directly in the page's own DevTools console, no page-console bridge
      // needed, so this is the fastest way to confirm live which conceptId
      // this search actually targeted, without guessing from the outside.
      if (st.retiredInfo) {
        console.log(
          '[Clean up code] descendant/laterality search for retired concept',
          code.conceptId,
          '-> targeting',
          descendantSearchConceptId,
          st.retiredInfo.replacement
            ? '(confirmed replacement: ' + st.retiredInfo.replacement.description + ')'
            : '(no confirmed replacement — falling back to the retired concept itself)'
        );
      }
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
        var narrowedResultSets = await Promise.all(
          [''].concat(hintWords).map(function (word) {
            return searchDescendantsNarrowed(descendantSearchConceptId, word);
          })
        );
        var allDescendants = [].concat.apply([], narrowedResultSets);
        st.descendantAlternatives = descendantAlternatives(
          combinedResults.concat(allDescendants),
          descendantSearchConceptId,
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
      // 2026-07-17) — resolveSnomedNamedCandidate (see its own comment) now
      // does this two-step lookup for both this single confirmed replacement
      // AND the possibly-equivalent candidates below.
      if (st.retiredInfo && st.retiredInfo.replacement) {
        st.confirmedReplacement = await resolveSnomedNamedCandidate(st.retiredInfo.replacement.conceptId);
      } else {
        st.confirmedReplacement = null;
      }
      // POSSIBLY EQUIVALENT TO candidates (2026-07-27) — see
      // possiblyEquivalentHtml's own comment for why these are kept separate
      // from confirmedReplacement above: SEVERAL candidates can genuinely
      // exist, each resolved independently, none discarded just because
      // another one also resolved. resolveSnomedNamedCandidate now returns
      // an ARRAY per candidate (every synonym that concept has, not just
      // one — see its own comment), so the per-candidate arrays are
      // flattened into one flat button list, not filtered to one-per-candidate.
      var possiblyEquivalentTo = (st.retiredInfo && st.retiredInfo.possiblyEquivalentTo) || [];
      if (possiblyEquivalentTo.length) {
        var resolvedPossibleEquivalents = await Promise.all(
          possiblyEquivalentTo.map(function (c) {
            return resolveSnomedNamedCandidate(c.conceptId);
          })
        );
        st.confirmedPossibleEquivalents = [].concat.apply([], resolvedPossibleEquivalents);
      } else {
        st.confirmedPossibleEquivalents = null;
      }
      // PARTIALLY EQUIVALENT TO candidates (2026-07-28) — same resolution
      // shape as possiblyEquivalentTo above, distinct field (see
      // partiallyEquivalentHtml's own comment for why these stay separate).
      var partiallyEquivalentTo = (st.retiredInfo && st.retiredInfo.partiallyEquivalentTo) || [];
      if (partiallyEquivalentTo.length) {
        var resolvedPartialEquivalents = await Promise.all(
          partiallyEquivalentTo.map(function (c) {
            return resolveSnomedNamedCandidate(c.conceptId);
          })
        );
        st.confirmedPartiallyEquivalents = [].concat.apply([], resolvedPartialEquivalents);
      } else {
        st.confirmedPartiallyEquivalents = null;
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
    // Reset the two openInContainer-only fields on every close, whichever
    // path closed it — so a problem opened once via the canvas, closed
    // without saving, then later opened again via the ordinary inline
    // button never fires a stale caller callback into a container that may
    // no longer exist.
    st.hostContainer = null;
    st.onApplied = null;
    renderPanel(problemId);
  }

  // ── Bridge for external callers (problem-nesting-canvas.js's "Edit
  // problem" trigger, 2026-08-08 request) ──────────────────────────────────
  // Runs the SAME check openPanel always runs for any problem — same-concept
  // alternatives, descendant/laterality suggestions, cross-concept
  // alternatives, generic-import-text cleanup, severity-contradiction
  // detection — for ANY problemId, not just one already flagged by the
  // automatic text-pattern scan. Deliberately does NOT run retirement or
  // legacy-Read-code detection (Nick's explicit call, 2026-08-08: that's
  // already available via the separate opt-in "Check for retired/legacy
  // codes?" scan — no need to duplicate it here).
  //
  // Renders into `containerEl` (supplied by the caller) instead of inline
  // next to the Medicus row — see renderPanel's hostContainer support above
  // — so this can be embedded inside another surface (the canvas overlay)
  // without needing to close it or leave it first. `onApplied(newDescription)`
  // — optional — fires from applyCode's success path (2026-08-08 follow-up:
  // "problem code edits refresh within the canvas") so the caller can update
  // its OWN copy of this problem's description instead of relying solely on
  // st.anchorEl.textContent, which only helps if the Medicus row happens to
  // be findable right now.
  function openInContainer(problemId, containerEl, onApplied) {
    var st = rowState(problemId);
    // Re-opening AFTER a successful save (st.saved): every fetched/derived
    // field in this row's state — prefill, conceptId, currentDescription,
    // the candidate lists — describes the record as it was BEFORE that save,
    // and openPanel's `st.alternatives || st.saved` short-circuit would
    // render it all as current. Worse than cosmetic: a second apply would
    // build its full-record-replace payload from the PRE-save prefill
    // (buildEditProblemPayload(st.prefill, …)). The inline flow never hits
    // this (its button removes itself on save), but the canvas's "Edit
    // problem…" button is always offered — so discard the whole row state
    // and start factory-fresh, forcing openPanel to refetch everything
    // against the live record. (anchorEl is re-resolved below; hostContainer/
    // onApplied are re-set below; panelEl was already removed on the save.)
    if (st.saved) {
      if (st.panelEl) st.panelEl.remove();
      delete _rows[problemId];
      st = rowState(problemId);
    }
    // A stale panelEl (detached from any host, e.g. the caller's own
    // container was torn down and rebuilt since the last time this problem's
    // panel was opened here) must be discarded, or renderPanel would silently
    // update a node nobody can see instead of creating a fresh one in the
    // new container.
    if (st.panelEl && !(containerEl && containerEl.contains(st.panelEl))) {
      st.panelEl.remove();
      st.panelEl = null;
    }
    st.hostContainer = containerEl || null;
    st.onApplied = typeof onApplied === 'function' ? onApplied : null;
    // Best-effort anchor lookup for the live-list-text-update nicety only
    // (st.anchorEl.textContent, set on a successful apply — see applyCode)
    // — uses the SAME whole-list claiming discipline as buildAnchorMap to
    // avoid the documented duplicate-description wrong-row bug (2026-07-26).
    // Never blocks opening: a missing anchor (row not currently rendered,
    // e.g. a different page shape) just means that one nicety doesn't fire.
    if (!st.anchorEl && _problemsCache) {
      var anchors = buildAnchorMap(_problemsCache);
      if (anchors[problemId]) st.anchorEl = anchors[problemId];
    }
    return openPanel(problemId);
  }

  window.ProblemDescriptionCleanup = {
    openInContainer: openInContainer,
    close: closePanel,
    stripGenericAdditionalInfoText: stripGenericAdditionalInfoText,
  };

  // Core apply path, shared by both the same-concept alternatives (a cosmetic
  // relabel) and the descendant/laterality suggestions (a real code change) —
  // the safety difference between the two is entirely in HOW `chosen` was
  // selected upstream (sameConceptAlternatives vs descendantAlternatives),
  // not in how it's applied here.
  // ── Preference tally (pdc.preferredDescriptions + pdc.conceptRemap) ────────
  // Fire-and-forget from applyCode below — a storage hiccup here must never
  // affect the already-successful clinical save, so failures are swallowed
  // (logged), never surfaced to the clinician. Every apply* path (same-
  // concept, descendant, cross-concept, hint-expanded, confirmed-replacement,
  // possibly/partially-equivalent, manual search) funnels through here
  // identically via applyCode, regardless of which category the choice came
  // from — see shared/preferred-descriptions.js's own header for why that's
  // uniform rather than special-cased per category.
  //   - WORDING axis (pdc.preferredDescriptions[chosen.conceptId]): always
  //     recorded when chosen has a descriptionId — "which synonym does this
  //     practice prefer for this code."
  //   - CONCEPT-REMAP axis (pdc.conceptRemap[sourceConceptId]): additionally
  //     recorded whenever the applied concept genuinely differs from the
  //     concept the problem was coded as BEFORE this save (sourceConceptId,
  //     i.e. st.conceptId captured at panel-open time) — "which code has
  //     this practice actually replaced this one with." Real motivating
  //     case (2026-07-29): "Injection into varicose vein of leg" (449705007)
  //     manually replaced with "Injection of varicose vein of lower limb"
  //     (449708009) — see openPanel's own comment on st.practiceRemap for
  //     how this then surfaces on the NEXT problem coded 449705007.
  async function recordPreferenceChoices(sourceConceptId, chosen) {
    if (!chosen || !chosen.conceptId) return;
    if (chosen.descriptionId) {
      var wordingR = await chrome.storage.local.get('pdc.preferredDescriptions');
      var wordingAll =
        wordingR['pdc.preferredDescriptions'] && typeof wordingR['pdc.preferredDescriptions'] === 'object'
          ? wordingR['pdc.preferredDescriptions']
          : {};
      wordingAll[chosen.conceptId] = recordPreference(wordingAll[chosen.conceptId], chosen.descriptionId, {
        description: chosen.description,
        descriptionId: chosen.descriptionId,
      });
      await chrome.storage.local.set({ 'pdc.preferredDescriptions': wordingAll });
    }

    if (sourceConceptId && sourceConceptId !== chosen.conceptId) {
      var remapR = await chrome.storage.local.get('pdc.conceptRemap');
      var remapAll =
        remapR['pdc.conceptRemap'] && typeof remapR['pdc.conceptRemap'] === 'object' ? remapR['pdc.conceptRemap'] : {};
      var remapKey = chosen.conceptId + '|' + (chosen.descriptionId || '');
      remapAll[sourceConceptId] = recordPreference(remapAll[sourceConceptId], remapKey, {
        conceptId: chosen.conceptId,
        descriptionId: chosen.descriptionId,
        description: chosen.description,
      });
      await chrome.storage.local.set({ 'pdc.conceptRemap': remapAll });
    }
  }

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
      // Reflect the newly-applied code on st itself (2026-08-13) — until
      // now nothing here did this, only st.anchorEl.textContent/onApplied
      // got the new description, because nothing downstream ever needed
      // st.currentDescription/conceptId/currentDescriptionId to be current
      // after a save (the panel closes immediately below). Now something
      // does: offerJournalSyncAfterCodeApply below (and applyToJournal,
      // which it calls) reads exactly these three fields to know WHAT code
      // to write to a matched journal entry — without this update they'd
      // still hold the pre-save values.
      st.currentDescription = chosen.description;
      st.conceptId = chosen.conceptId;
      st.currentDescriptionId = chosen.descriptionId;
      // Learn from this choice — see recordPreferenceChoices' own comment
      // for why this is fire-and-forget and never awaited/surfaced.
      recordPreferenceChoices(st.conceptId, newCode).catch(function (e) {
        console.warn('[Clean up code] failed to record description preference:', e && e.message);
      });
      // Optimistic in-place update — the save is confirmed correct
      // server-side; this just keeps the on-screen text in sync without
      // depending on Medicus's own Vue re-render (which this content script
      // has no hook into). A later natural page re-render/reload picks up
      // the same corrected value fresh from the server either way.
      if (st.anchorEl) st.anchorEl.textContent = chosen.description;
      // Same optimistic update, for whichever external caller opened this
      // via openInContainer (2026-08-08) — st.anchorEl only helps when the
      // Medicus row is actually findable right now, so a caller keeping its
      // own copy of the description (the canvas's tile text) needs its own
      // notification. Never lets a caller's own callback failing affect the
      // already-successful save.
      if (st.onApplied) {
        try {
          st.onApplied(chosen.description);
        } catch (_) {
          /* caller's own refresh failing must never affect this save */
        }
      }
      // JOURNAL SYNC PROMPT (2026-08-13, Nick's request): fires on EVERY
      // code-selection path — every one of the 9 apply* wrapper functions
      // above this file's applyCode call funnels through here, so this is
      // the single choke point, not something duplicated per-wrapper. Runs
      // BEFORE the panel-close sequence below, deliberately — it calls
      // applyToJournal, which does its own renderPanel() calls to show
      // saving/saved/error state on the journal-match rows, and those only
      // work while the panel is still live in the DOM.
      await offerJournalSyncAfterCodeApply(problemId);
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

  // Shared by offerJournalSyncAfterCodeApply and
  // offerJournalTextSyncAfterInfoCleanup (2026-08-14) — both need the same
  // "which matches should an AUTOMATIC prompt actually target" decision,
  // now that applyDateConfirmation exists. Returns the array of matches to
  // target, or null if nothing should happen (an alert has already
  // explained why — the caller just returns in that case). No prompt at
  // all when st.journalMatches is null (check never ran/failed — genuinely
  // unknown, say nothing). A single match: itself. SEVERAL matches: only
  // the date-confirmed one(s) — auto-prompting for every ambiguous
  // candidate (e.g. all 4 identically-worded "Paediatric surveillance
  // admin" entries in the real case that motivated applyDateConfirmation)
  // would mean several back-to-back confirm() dialogs for entries we
  // cannot actually tell apart. When NONE of several matches is
  // date-confirmed, this deliberately does NOT guess by prompting for all
  // of them anyway — it alerts instead and leaves it to the standalone
  // "Apply to journal" button (or the Duplicate Checker) for the clinician
  // to resolve by hand. buildNoMatchMessage/buildAmbiguousMessage are
  // functions, not strings — st.journalMatches.length is only safe to read
  // once we've already confirmed the array isn't null/empty, so the
  // message text is built lazily, inside here, not by the caller upfront.
  function resolveJournalSyncTargets(st, buildNoMatchMessage, buildAmbiguousMessage) {
    if (!Array.isArray(st.journalMatches)) {
      console.log(
        '[Clean up code] journal sync: st.journalMatches is not an array (check never ran or failed) — nothing to target',
        st.journalMatches
      );
      return null;
    }
    if (!st.journalMatches.length) {
      window.alert(buildNoMatchMessage());
      return null;
    }
    if (st.journalMatches.length === 1) return st.journalMatches;
    var confirmed = st.journalMatches.filter(function (m) {
      return m.dateConfirmed;
    });
    if (confirmed.length) return confirmed;
    window.alert(buildAmbiguousMessage(st.journalMatches.length));
    return null;
  }

  // Called by applyCode, right after a successful problem-code save, for
  // EVERY code-selection path (see applyCode's own comment — this is the
  // single choke point all 9 apply* wrappers funnel through, so this only
  // needs to exist once). Each TARGETED match (see resolveJournalSyncTargets
  // above) gets its own confirm()-gated prompt via applyToJournal (already
  // built, unmodified here) — sequential, not batched into one dialog, so
  // the clinician can accept or decline each one individually; the
  // existing multiple-match warning banner is still visible in the
  // (still-open) panel while these fire.
  async function offerJournalSyncAfterCodeApply(problemId) {
    var st = rowState(problemId);
    var targets = resolveJournalSyncTargets(
      st,
      function () {
        return (
          'No matching journal entry was found for this problem, so nothing was synced automatically. ' +
          'If a journal duplicate exists, you may need to update it in the Journal tab yourself.'
        );
      },
      function (count) {
        return (
          count +
          ' journal entries matched this problem, but none could be confirmed as the right one by date. ' +
          'Nothing was synced automatically — review them below (or run "Analyse full record for duplicates") and use "Apply to journal" on the right one yourself.'
        );
      }
    );
    if (!targets) return;
    var anyApplied = false;
    for (var i = 0; i < targets.length; i++) {
      var entryId = targets[i].entryId;
      var jst = st.journalApply[entryId];
      if (jst && (jst.saving || jst.saved)) continue; // already applied (e.g. via the standalone button) or mid-flight
      await applyToJournal(problemId, entryId);
      if (st.journalApply[entryId] && st.journalApply[entryId].saved) anyApplied = true;
    }
    // applyCode's own panel-close sequence runs immediately after this
    // function returns — without a beat here, a successful "✓ Journal
    // entry updated…" render (set inside applyToJournal's own renderPanel
    // call, above) and the panel's removal could both happen within the
    // same JS turn, with the browser never actually PAINTING the
    // confirmation before it's torn down. Only pauses when a write
    // genuinely succeeded — declining every prompt, or there being nothing
    // to apply, closes exactly as before.
    if (anyApplied) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 1400);
      });
    }
  }

  // Writes the PROBLEM's current code into a matched journal entry — see
  // buildChangeNotePayload/fetchEditNoteForm/postChangeNote's own header
  // comment for the confirmed POST /clinical/note/change-note contract
  // (3 live HAR captures, 2026-08-13). Deliberately NOT constrained to a
  // same-concept relabel the way applyCode is — this write's whole purpose
  // is making the note match the problem's CURRENT code, whatever that is.
  //
  // Per-entry state (st.journalApply[entryId]), not the row-level
  // st.saving/st.saved applyCode uses — a single problem can have several
  // journal matches, each an independent write target (see rowState's own
  // comment).
  //
  // window.confirm() naming the exact before/after text and match
  // confidence — same established pattern as
  // content-scripts/allergy-cleanup.js's bulk-action gates ("End N selected
  // allergies…", cancel by default) — lets the clinician judge a low-
  // confidence fuzzy-tier match before committing, since this write (unlike
  // applyCode's same-concept relabel) can genuinely change the concept.
  //
  // On success: echoes the actual description written (jst.appliedDescription),
  // never a bare "Saved"/"Done" claim — same discipline CLAUDE.md documents
  // for content-scripts/reception-quick-actions.js. No re-fetch/read-back
  // to re-verify — trusts a non-throwing POST, same standard applyCode
  // already uses for problem-code writes.
  async function applyToJournal(problemId, entryId) {
    var st = rowState(problemId);
    if (!st.journalApply) st.journalApply = {};
    var jst = st.journalApply[entryId];
    if (!jst) {
      jst = { saving: false, saved: false, error: null, appliedDescription: null };
      st.journalApply[entryId] = jst;
    }
    if (jst.saving || jst.saved) return;

    var match = (st.journalMatches || []).find(function (m) {
      return m.entryId === entryId;
    });
    if (!match) return;

    var newCode = {
      description: st.currentDescription,
      conceptId: st.conceptId,
      descriptionId: st.currentDescriptionId,
    };
    var confirmed = window.confirm(
      'Apply "' +
        st.currentDescription +
        '" to this journal entry?\n\n' +
        'Current entry text: "' +
        match.clinicalCodeDescription +
        '"\n' +
        'Match confidence: ' +
        (JOURNAL_MATCH_LABELS[match.tier] || match.tier) +
        '\n\n' +
        "This replaces the entry's current code with the problem's current code."
    );
    if (!confirmed) return;

    jst.error = null;
    jst.saving = true;
    renderPanel(problemId);
    try {
      var notePrefill = await fetchEditNoteForm(entryId);
      var payload = buildChangeNotePayload(notePrefill, newCode);
      await postChangeNote(entryId, payload);
      jst.saved = true;
      jst.appliedDescription = st.currentDescription;
      // UNDO support (2026-08-14): the pre-write code is already in hand
      // from the prefill just fetched — captured ONLY after the POST
      // succeeded (a failed write changed nothing, so there's nothing to
      // undo) and only when the prefill actually carried one. See
      // undoJournalCodeSync for the revert itself.
      jst.prevCode = notePrefill.noteSNOMEDct || null;
      jst.undone = false;
    } catch (err) {
      jst.error = (err && err.message) || 'Failed to update the journal entry — please try again.';
    } finally {
      jst.saving = false;
      renderPanel(problemId);
    }
  }

  // Reverts a code sync applied by applyToJournal above — writes the
  // note's pre-sync code (jst.prevCode, captured from the write's own
  // prefill) back via the exact same confirmed contract
  // (fresh GET edit-note prefill → POST change-note), so every other field
  // is resent from the note's CURRENT server state, never from anything
  // cached at sync time. Same confirm() gate and same "echo what was
  // actually written" discipline as the forward write. WHY THIS EXISTS
  // (2026-08-14): this write is the one action in this panel that can
  // genuinely change a note's CONCEPT (see applyToJournal's own comment on
  // its deliberately-unconstrained scope), gated only by a confirm() — a
  // clinician who realises a beat too late that they synced the WRONG
  // entry (the multi-match cases that motivated applyDateConfirmation are
  // exactly where that mistake is easiest) previously had to reconstruct
  // the old code by hand in the Journal tab. One click now restores it.
  async function undoJournalCodeSync(problemId, entryId) {
    var st = rowState(problemId);
    var jst = st.journalApply && st.journalApply[entryId];
    if (!jst || !jst.saved || jst.undoing || !jst.prevCode || !jst.prevCode.description) return;

    var confirmed = window.confirm(
      'Undo this sync?\n\n' +
        'The journal entry will be set back to its previous code: "' +
        jst.prevCode.description +
        '"\n' +
        '(currently "' +
        jst.appliedDescription +
        '").'
    );
    if (!confirmed) return;

    jst.error = null;
    jst.undoing = true;
    renderPanel(problemId);
    try {
      var notePrefill = await fetchEditNoteForm(entryId);
      var payload = buildChangeNotePayload(notePrefill, jst.prevCode);
      await postChangeNote(entryId, payload);
      jst.restoredDescription = jst.prevCode.description;
      jst.saved = false;
      jst.appliedDescription = null;
      jst.prevCode = null;
      jst.undone = true;
    } catch (err) {
      jst.error = (err && err.message) || 'Failed to undo — the journal entry was left as it is.';
    } finally {
      jst.undoing = false;
      renderPanel(problemId);
    }
  }

  // Text-sync twin of undoJournalCodeSync — restores the note's pre-strip
  // free text (jst.prevNote, captured by applyGenericAdditionalInfoToJournal
  // from the write's own prefill). The code field is passed through from
  // the FRESH prefill, not from anything remembered — if the entry's code
  // was also synced (and possibly undone) since, this revert touches ONLY
  // the note text, leaving the code exactly as the server currently has it.
  async function undoJournalTextSync(problemId, entryId) {
    var st = rowState(problemId);
    var jst = st.journalInfoApply && st.journalInfoApply[entryId];
    // prevNote can legitimately be '' (a note whose text was ENTIRELY
    // boilerplate) — that's still a real previous state, so != null, not
    // truthy, same convention as the render side.
    if (!jst || !jst.saved || jst.undoing || jst.prevNote == null) return;

    var confirmed = window.confirm(
      'Undo this cleanup?\n\n' + 'The removed import text will be restored to this journal entry.'
    );
    if (!confirmed) return;

    jst.error = null;
    jst.undoing = true;
    renderPanel(problemId);
    try {
      var notePrefill = await fetchEditNoteForm(entryId);
      var payload = buildChangeNotePayload(
        Object.assign({}, notePrefill, { note: jst.prevNote }),
        notePrefill.noteSNOMEDct
      );
      await postChangeNote(entryId, payload);
      jst.saved = false;
      jst.appliedText = null;
      jst.prevNote = null;
      jst.undone = true;
    } catch (err) {
      jst.error = (err && err.message) || 'Failed to undo — the journal entry was left as it is.';
    } finally {
      jst.undoing = false;
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

  // Always the SAME conceptId (SNOMED's own confirmed REPLACED BY target),
  // but that concept can carry several of its own synonyms (see
  // confirmedReplacementAlternatives' own comment — real example,
  // "Pompholyx of hand" ALSO carries "Chiropompholyx") — matched by
  // descriptionId, same discipline as applyAlternative/applyDescendant.
  function applyConfirmedReplacement(problemId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.confirmedReplacement || []).find(function (a) {
      return (a.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // Several candidates can genuinely exist here (see possiblyEquivalentHtml's
  // own comment), AND each candidate concept can itself carry several
  // synonyms — matched by conceptId + descriptionId together, same
  // discipline as applyCrossConcept/applyHintExpanded.
  function applyPossiblyEquivalent(problemId, conceptId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.confirmedPossibleEquivalents || []).find(function (c) {
      return c.conceptId === conceptId && (c.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // Same matching discipline as applyPossiblyEquivalent — several candidates,
  // each with possibly several synonyms, matched by conceptId + descriptionId.
  function applyPartiallyEquivalent(problemId, conceptId, descriptionId) {
    var st = rowState(problemId);
    var chosen = (st.confirmedPartiallyEquivalents || []).find(function (c) {
      return c.conceptId === conceptId && (c.descriptionId || '') === (descriptionId || '');
    });
    return applyCode(problemId, chosen);
  }

  // st.practiceRemap is already resolved to a single {description,
  // conceptId, descriptionId} candidate (or null) by openPanel — no lookup
  // needed here, unlike every apply* above which searches its own state
  // array by id.
  function applyPracticeRemap(problemId) {
    var st = rowState(problemId);
    return applyCode(problemId, st.practiceRemap);
  }

  // Routes a click on the grouped multi-synonym "Use" button (see
  // candidateGroupsHtml) to whichever category's own apply function actually
  // owns that state array — the `category` tag is set once, in
  // candidateGroupsHtml's caller, per section (alt/descendant/crossconcept/
  // hintexpand/confirmedreplacement/possiblyequivalent/partiallyequivalent).
  // Single-synonym lozenges never go through here — they keep calling their
  // existing per-category apply function directly, unchanged.
  function applyGroupedCandidate(problemId, category, conceptId, descriptionId) {
    switch (category) {
      case 'alt':
        return applyAlternative(problemId, descriptionId);
      case 'descendant':
        return applyDescendant(problemId, descriptionId);
      case 'crossconcept':
        return applyCrossConcept(problemId, conceptId, descriptionId);
      case 'hintexpand':
        return applyHintExpanded(problemId, conceptId, descriptionId);
      case 'confirmedreplacement':
        return applyConfirmedReplacement(problemId, descriptionId);
      case 'possiblyequivalent':
        return applyPossiblyEquivalent(problemId, conceptId, descriptionId);
      case 'partiallyequivalent':
        return applyPartiallyEquivalent(problemId, conceptId, descriptionId);
      default:
        return undefined;
    }
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
    var codeValue = st.prefill.problemCode && st.prefill.problemCode.value;
    if (!codeValue) return;
    // Narrowed to the same 3-field shape applyCode already sends
    // successfully (found live 2026-07-26: passing edit-problem's raw
    // problemCode.value straight through — untouched, since this apply path
    // only changes additionalInformation — 400'd; that GET shape is
    // confirmed to carry EXTRA fields beyond what the POST accepts, e.g.
    // slideover/overview's sibling shape for the same field carries
    // originalCodes, and edit-problem's own .value was never actually
    // confirmed safe to round-trip verbatim, only assumed — see
    // findLegacyReadCodeOrigin's comment for that open question). Every
    // other apply path in this file already builds problemCode fresh from
    // exactly {description, conceptId, descriptionId} — this is a no-op
    // change (same concept, same description), so building the same narrow
    // shape here is not a behaviour change, just the correct payload.
    var code = {
      description: codeValue.description,
      conceptId: codeValue.conceptId,
      descriptionId: codeValue.descriptionId,
    };
    st.genericAdditionalInfoSaving = true;
    renderPanel(problemId);
    try {
      var payload = buildEditProblemPayload(st.prefill, code, st.genericAdditionalInfo.cleaned);
      await postEditProblem(problemId, payload);
      st.additionalInformation = st.genericAdditionalInfo.cleaned;
      st.prefill = Object.assign({}, st.prefill, { additionalInformation: st.genericAdditionalInfo.cleaned });
      st.genericAdditionalInfo = null;
      // JOURNAL TEXT-SYNC PROMPT (2026-08-13, Nick's request — "the same
      // thing" as the code-apply prompt above, for this text cleanup path
      // instead). This panel doesn't close on success (unlike applyCode),
      // so no ordering concern — offerJournalTextSyncAfterInfoCleanup's own
      // renderPanel() calls are safe to run here.
      await offerJournalTextSyncAfterInfoCleanup(problemId);
    } catch (err) {
      st.error = (err && err.message) || 'Failed to remove generic text — please try again.';
    } finally {
      st.genericAdditionalInfoSaving = false;
      renderPanel(problemId);
    }
  }

  // Companion to offerJournalSyncAfterCodeApply, for the "Remove generic
  // import text" path instead of a code change. A journal note has its OWN
  // free-text `note` field (fetched fresh per candidate, not cached
  // anywhere — journalMatches only carries clinicalCodeDescription, not
  // note text) — this checks THAT text for the same known GP2GP boilerplate
  // via stripAllKnownGenericText (see that function's own header for why
  // it's a SEPARATE, simpler function from computeAdditionalInfoFindings —
  // a journal note has no `significance` field, so the severity-comparison
  // side effect that function applies for problems doesn't apply here and
  // was silently swallowing genuine matches), not by copying the PROBLEM's
  // own cleaned text over verbatim — the note's own text may have entry-
  // specific content alongside the same boilerplate (the confirmed hernia
  // capture, docs/learnings-journal-note-edit-api.md, had exactly this: a
  // coded line plus its own separate "(para umbilicAL)" note text). Same
  // resolveJournalSyncTargets narrowing as the code-apply path — several
  // ambiguous matches with none date-confirmed means this checks NONE of
  // them automatically, not all of them.
  async function offerJournalTextSyncAfterInfoCleanup(problemId) {
    var st = rowState(problemId);
    var targets = resolveJournalSyncTargets(
      st,
      function () {
        return 'No matching journal entry was found for this problem, so its additional details were not checked for the same import text.';
      },
      function (count) {
        return (
          count +
          ' journal entries matched this problem, but none could be confirmed as the right one by date. ' +
          'Their additional details were not checked automatically — review them in the Journal tab yourself.'
        );
      }
    );
    if (!targets) return;
    var genericInfoEntries = await ensureGenericAdditionalInfoTextLoaded();
    for (var i = 0; i < targets.length; i++) {
      await applyGenericAdditionalInfoToJournal(problemId, targets[i].entryId, genericInfoEntries);
    }
  }

  // entryId: the journal note to check/clean. genericInfoEntries: the
  // SAME loaded rules/generic-additional-info-text.json entries the
  // problem-side detection uses (ensureGenericAdditionalInfoTextLoaded is
  // cached after its first load, so this costs nothing extra to call
  // again). Silent (no prompt at all) when the note's own text has no
  // matching boilerplate — that's the common, unremarkable case, distinct
  // from "no journal match at all", which offerJournalTextSyncAfterInfoCleanup
  // already notes separately.
  async function applyGenericAdditionalInfoToJournal(problemId, entryId, genericInfoEntries) {
    var st = rowState(problemId);
    if (!st.journalInfoApply) st.journalInfoApply = {};
    var jst = st.journalInfoApply[entryId];
    if (!jst) {
      jst = { saving: false, saved: false, error: null, appliedText: null };
      st.journalInfoApply[entryId] = jst;
    }
    if (jst.saving || jst.saved) return;

    var notePrefill;
    try {
      notePrefill = await fetchEditNoteForm(entryId);
    } catch (e) {
      console.warn('[Clean up code] journal text-sync: fetchEditNoteForm failed for', entryId, '—', e && e.message);
      return; // best-effort — if we can't even check, skip silently rather than erroring the whole flow
    }
    // stripAllKnownGenericText, NOT computeAdditionalInfoFindings — see that
    // function's own header for why: computeAdditionalInfoFindings's
    // severity-comparison side effect silently discarded a genuine match
    // here (found live 2026-08-14, a bare " PRIORITY=1" note text) because
    // a journal note has no `significance` field to compare against at all.
    var stripped = stripAllKnownGenericText(notePrefill.note, genericInfoEntries);
    if (!stripped.removed.length) {
      console.log(
        '[Clean up code] journal text-sync: no known generic import text found in this entry’s own note field —',
        entryId,
        JSON.stringify(notePrefill.note)
      );
      return;
    }

    // Names the specific removed fragment(s), not the full current/cleaned
    // text — a note's genuine free text can be much longer than the
    // boilerplate buried in it, and asking the clinician to diff two full
    // paragraphs in a plain OS dialog (no bold, no strikethrough, nothing
    // to anchor on) is the wrong shape for this. What's actually leaving
    // the record is the only thing worth naming (design review, 2026-08-14).
    var removedList = stripped.removed.map(function (r) {
      return '"' + r + '"';
    });
    var removedText =
      removedList.length > 1
        ? removedList.slice(0, -1).join(', ') + ' and ' + removedList[removedList.length - 1]
        : removedList[0];
    var confirmed = window.confirm('This journal entry also has generic import text: ' + removedText + '. Remove it?');
    if (!confirmed) return;

    jst.saving = true;
    renderPanel(problemId);
    try {
      var payload = buildChangeNotePayload(
        Object.assign({}, notePrefill, { note: stripped.cleaned }),
        notePrefill.noteSNOMEDct
      );
      await postChangeNote(entryId, payload);
      jst.saved = true;
      jst.appliedText = stripped.cleaned;
      // UNDO support (2026-08-14) — see undoJournalTextSync. The pre-strip
      // text is normalised to '' rather than left null/undefined so the
      // "was there a previous state to restore" check stays a clean
      // != null test (an all-boilerplate note genuinely had '' left after
      // the strip, and its pre-strip text is still worth restoring).
      jst.prevNote = notePrefill.note != null ? notePrefill.note : '';
      jst.undone = false;
    } catch (err) {
      jst.error = (err && err.message) || 'Failed to update the journal entry — please try again.';
    } finally {
      jst.saving = false;
      renderPanel(problemId);
    }
  }

  // Corrects the structured significance field to match what the GP2GP
  // import text actually said (st.severityContradiction.stated) AND removes
  // the now-resolved boilerplate lines from additionalInformation, in ONE
  // save — see this file's header comment for why these two changes are
  // bundled rather than offered separately (the boilerplate lines only
  // become safe to discard once the value they were disagreeing with has
  // actually been corrected). problemCode itself is resent completely
  // unchanged, same discipline as applyRemoveGenericAdditionalInfo. Unlike
  // buildEditProblemPayload's additionalInformation override, there's no
  // dedicated significance-override param — the prefill is cloned with the
  // corrected value instead, since that's a one-line change and adding a
  // second override param for a single caller isn't worth the extra surface.
  async function applyCorrectSeverityAndRemoveJunk(problemId) {
    var st = rowState(problemId);
    if (!st.severityContradiction || st.severityContradictionSaving || !st.prefill) return;
    var codeValue = st.prefill.problemCode && st.prefill.problemCode.value;
    if (!codeValue) return;
    var code = {
      description: codeValue.description,
      conceptId: codeValue.conceptId,
      descriptionId: codeValue.descriptionId,
    };
    var correctedSignificance = st.severityContradiction.stated;
    var cleanedAdditionalInformation = st.severityContradiction.cleaned;
    st.severityContradictionSaving = true;
    renderPanel(problemId);
    try {
      var prefillForPayload = Object.assign({}, st.prefill, { significance: correctedSignificance });
      var payload = buildEditProblemPayload(prefillForPayload, code, cleanedAdditionalInformation);
      await postEditProblem(problemId, payload);
      st.additionalInformation = cleanedAdditionalInformation;
      st.prefill = Object.assign({}, st.prefill, {
        additionalInformation: cleanedAdditionalInformation,
        significance: correctedSignificance,
      });
      st.severityContradiction = null;
      // The plain generic-strip offer was suppressed while the contradiction
      // was live (see computeAdditionalInfoFindings) — cleared here too since
      // this save already removed every matched generic line, same `cleaned`
      // value either action would have produced.
      st.genericAdditionalInfo = null;
    } catch (err) {
      st.error = (err && err.message) || 'Failed to correct the severity — please try again.';
    } finally {
      st.severityContradictionSaving = false;
      renderPanel(problemId);
    }
  }

  // Creates the relationship the "(Grouped with X)" text suggested, via
  // content-scripts/problem-nesting.js's bridge (this file owns no write
  // path of its own for problem-to-problem relationships — see
  // shared/problem-text-linking.js's header for the full architecture).
  // relationshipType is one of:
  //   'linked'          — flat, non-hierarchical (commitFlatLink)
  //   'thisChildOfMatch' — this problem becomes a child of the matched one
  //   'matchChildOfThis' — the matched problem becomes a child of this one
  // Unlike applyCorrectSeverityAndRemoveJunk, the relationship write and the
  // text-cleanup write are to TWO DIFFERENT ENDPOINTS (Medicus has no single
  // combined call for "create this relationship AND edit that problem's
  // text") — sequential, not bundled. If the relationship write fails,
  // nothing else happens (the suggestion stays offered, retry-safe — both
  // commitFlatLink and commitParentLink are no-ops/idempotent-safe against
  // an already-current relationship). If it succeeds but the follow-up
  // text-strip fails, the relationship is still real and kept — only the
  // cosmetic cleanup didn't complete, surfaced as its own distinct message
  // rather than implying the whole action failed.
  async function applyLinkSuggestion(problemId, relationshipType) {
    var st = rowState(problemId);
    if (!st.linkSuggestion || !st.linkSuggestion.match || st.linkSuggestionActing || !st.prefill) return;
    if (!relationshipType) return; // no armed choice (confirm clicked with nothing pending)
    var isTextOnly = relationshipType === 'alreadyRelated' || relationshipType === 'leaveAsIs';
    var otherId = st.linkSuggestion.match.problemId;
    st.linkSuggestionActing = true;
    st.error = null;
    renderPanel(problemId);
    try {
      if (isTextOnly) {
        // 'alreadyRelated': the relationship the text described is already
        // real. 'leaveAsIs': a DIFFERENT relationship already exists and
        // the clinician is satisfied with it, not the text's guess (both
        // via checkExistingRelationship, run when this suggestion was
        // flagged). Either way — no write here, just the text cleanup
        // below.
      } else if (!window.ProblemNesting) {
        throw new Error('The problem-linking tool is unavailable on this page.');
      } else if (relationshipType === 'linked') {
        await window.ProblemNesting.commitFlatLink(problemId, otherId);
      } else if (relationshipType === 'thisChildOfMatch') {
        await window.ProblemNesting.commitParentLink(problemId, otherId);
      } else if (relationshipType === 'matchChildOfThis') {
        await window.ProblemNesting.commitParentLink(otherId, problemId);
      } else {
        throw new Error('Unknown relationship type.');
      }
      // Relationship created (or, for the text-only actions, nothing to
      // create) — now the "(Grouped with X)" text is genuinely redundant
      // with what's structurally captured, same "structural fix supersedes
      // the free text" reasoning as applyCorrectSeverityAndRemoveJunk. A
      // failure past this point does NOT roll back the relationship
      // (already real) — only the cosmetic strip didn't complete.
      //
      // st.linkSuggestion is nulled ONLY on the paths that consume it
      // (review finding: nulling it up front left a failed text-only strip
      // with a "please try again" error and no button left to retry with —
      // the canvas keeps its card offered on this exact failure, this
      // widget now matches). After a successful RELATIONSHIP write the
      // suggestion is always consumed — leaving it offered would invite
      // re-creating the just-created relationship.
      var cleaned = st.linkSuggestion.cleaned;
      var codeValue = st.prefill.problemCode && st.prefill.problemCode.value;
      var code = codeValue && {
        description: codeValue.description,
        conceptId: codeValue.conceptId,
        descriptionId: codeValue.descriptionId,
      };
      if (!code) {
        // No code in the prefill = the text edit cannot be built. For the
        // text-only actions that IS the whole action — a visible failure,
        // never a silently-disappearing suggestion that reads as success.
        if (isTextOnly) {
          st.error = 'Could not load this problem’s current code — the import text was not removed. Try again.';
        } else {
          st.linkSuggestion = null;
          st.error = 'Link created, but the import text could not be removed — remove it separately.';
        }
      } else {
        try {
          var payload = buildEditProblemPayload(st.prefill, code, cleaned);
          await postEditProblem(problemId, payload);
          st.additionalInformation = cleaned;
          st.prefill = Object.assign({}, st.prefill, { additionalInformation: cleaned });
          st.linkSuggestion = null; // fully done — relationship (if any) and text both settled
        } catch (textErr) {
          if (isTextOnly) {
            // Removing the text was the whole action and it failed —
            // keep the suggestion so the button is still there to retry.
            st.error = 'Failed to remove the import text — please try again.';
          } else {
            st.linkSuggestion = null;
            st.error = 'Link created, but failed to remove the import text — you can remove it separately.';
          }
        }
      }
    } catch (err) {
      st.error = (err && err.message) || 'Failed to create the link — please try again.';
    } finally {
      st.linkSuggestionPending = null;
      st.linkSuggestionActing = false;
      renderPanel(problemId);
    }
  }

  // Strips whatever generic/boilerplate additionalInformation text is
  // currently recognised (see computeAdditionalInfoFindings — this reuses
  // the SAME text-cleanup applyLinkSuggestion above already applies inline,
  // never a second copy of it) for a problem this file's own row state has
  // NOT necessarily touched yet — exposed via window.ProblemDescriptionCleanup
  // so content-scripts/problem-nesting-canvas.js's own "(Grouped with X)"
  // tray can reuse the ONE real text-editing implementation after ITS OWN
  // relationship commit, rather than duplicating fetch-prefill/build-
  // payload/post here a second time (2026-08-09: "offer to remove the
  // generic text as part of the linking process", extended to the canvas to
  // match what this file's own inline flow already does). otherProblems is
  // deliberately omitted from the computeAdditionalInfoFindings call below
  // — the caller has ALREADY resolved whichever relationship/match mattered;
  // this call exists purely to recover the same `cleaned` text every action
  // type derives from (severityContradiction/linkSuggestion/
  // genericAdditionalInfo all resolve to the identical literalStrip.cleaned
  // value — see that function's own header). Returns false (a no-op, not an
  // error) when there's genuinely nothing to clean; throws on a real fetch/
  // post failure so the caller can show its OWN "relationship created, but
  // text removal failed" message.
  async function stripGenericAdditionalInfoText(problemId) {
    var prefill = await fetchEditProblemForm(problemId);
    var codeValue = prefill && prefill.problemCode && prefill.problemCode.value;
    if (!codeValue) return false;
    var genericInfoEntries = await ensureGenericAdditionalInfoTextLoaded();
    var findings = computeAdditionalInfoFindings(
      prefill.additionalInformation,
      prefill.significance,
      genericInfoEntries
    );
    // First finding that CARRIES a cleaned value — explicitly != null, never
    // a || chain (review finding): a legitimate cleaned === '' (the text was
    // entirely boilerplate) is falsy, and the old chain skipped past it to
    // null, silently no-opping the strip while the caller announced success.
    var findingWithCleaned = [
      findings.severityContradiction,
      findings.linkSuggestion,
      findings.genericAdditionalInfo,
    ].find(function (f) {
      return f && f.cleaned != null;
    });
    var cleaned = findingWithCleaned ? findingWithCleaned.cleaned : null;
    if (cleaned == null || cleaned === (prefill.additionalInformation || '')) return false;
    var code = {
      description: codeValue.description,
      conceptId: codeValue.conceptId,
      descriptionId: codeValue.descriptionId,
    };
    var payload = buildEditProblemPayload(prefill, code, cleaned);
    await postEditProblem(problemId, payload);
    var st = rowState(problemId);
    st.additionalInformation = cleaned;
    st.prefill = Object.assign({}, st.prefill || prefill, { additionalInformation: cleaned });
    return true;
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
    btn.textContent = 'Clean up code';
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
  // — real per-patient cost, same class as problem-bulk-end.js's
  // "Bulk remove?" scan, so this is its own opt-in click, never automatic.
  // Internal names below still say "retired" (kept as-is rather than a
  // mechanical rename across every identifier) even though the scan and its
  // button now cover both signals — see the button's own label text for
  // what's actually shown to the clinician. A flagged row gets its "Fix
  // description" button injected (reusing injectFixButton, which already
  // de-dupes against a row already flagged by the text scan) with
  // st.retiredInfo and/or st.legacyReadCode pre-populated — see
  // retiredInfoHtml/legacyReadCodeHtml/openPanel above for how those render
  // and reuse the cached prefill. Generic-import-text and severity-
  // defaulting-contradiction detection (a fourth/fifth signal, added
  // 2026-07-25/2026-07-29) piggyback on the SAME edit-problem prefill
  // already fetched for the checks above — zero extra per-problem fetches,
  // see computeAdditionalInfoFindings.

  var _retiredScanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _retiredScanError = null;
  var _retiredFlaggedCount = 0;

  async function runRetiredCodesScan() {
    // Captured before the first await (review finding): scan() resets
    // _rows/_retiredScanState to a fresh 'idle' on an SPA patient
    // navigation, and every continuation below must stop writing state the
    // moment that happens — otherwise this scan's completion clobbers the
    // NEW patient's reset state ('done' over empty rows, no offer to scan).
    var scanPatientId = _lastPatientId;
    _retiredScanState = 'scanning';
    _retiredScanError = null;
    renderRetiredWidget();
    try {
      if (!_problemsCache || !_problemsCache.length) throw new Error('No active problems to check.');
      // See buildAnchorMap's comment: one shared map built from the FULL
      // problem list, so a problem this scan is about to flag can never
      // steal an unrelated, unflagged duplicate-text problem's row (or
      // vice versa) — replaces this scan's own former partial claiming.
      var anchorsByProblemId = buildAnchorMap(_problemsCache);
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
      if (_lastPatientId !== scanPatientId) return; // patient changed mid-fetch — the reset owns the state now
      // One retirement-status fetch per DISTINCT conceptId, never one per
      // problem — same discipline as problem-bulk-end.js's badge scan.
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
      // (and FOURTH — severity contradiction, same source data) flagging
      // reason costs only one local resource load (cached after the first
      // call), same as it does inside openPanel.
      var genericInfoEntries = await ensureGenericAdditionalInfoTextLoaded();
      if (_lastPatientId !== scanPatientId) return;

      // Compute the Read-v2-origin signal for every problem up front (no
      // fetch — reads overview data already in hand) so we know which
      // DISTINCT conceptIds need the "is there actually a better wording"
      // check below.
      var legacyReadCodeByProblemId = Object.create(null);
      _problemsCache.forEach(function (p) {
        var overview = overviewsById[p.id];
        var legacyReadCode = findLegacyReadCodeOrigin(
          overview && overview.problemCode && overview.problemCode.originalCodes
        );
        if (legacyReadCode) legacyReadCodeByProblemId[p.id] = legacyReadCode;
      });

      // NO-OP READ-V2 FLAG SUPPRESSION (found live 2026-07-26, real example:
      // "Infantile eczema" 90823000) — a Read-v2 import origin only tells us
      // the RECORD is old; it says nothing about whether the description
      // CURRENTLY recorded is still outdated. This patient has two problems
      // for the same concept: one genuinely Read-v2-derived, one already
      // carrying the modern preferred wording (SNOMED offers nothing better
      // for it) — flagging both as "needs review" is noise for the one
      // that's already correct, and clicking its button correctly finds no
      // alternatives (there aren't any), which reads as broken rather than
      // "nothing to fix". Reuses the SAME same-concept search "Fix
      // description" already runs when opened (searchDescriptions on the
      // stripped description text PLUS the bare conceptId, concatenated,
      // exactly mirroring openPanel's own two-part fetch) rather than a new
      // heuristic — if that search finds no OTHER synonym for this exact
      // conceptId beyond what's already recorded, there is genuinely
      // nothing to offer, so the Read-v2 signal alone is suppressed
      // (isRetired/hasGenericInfo/hasSeverityContradiction below are
      // independent reasons and are unaffected). One extra search per DISTINCT conceptId among
      // Read-v2-flagged problems only — never per problem, never for a
      // conceptId with no Read-v2 signal at all — same "distinct concept,
      // not distinct problem" cost discipline as the retirement check above.
      var readCodeConceptIds = [];
      _problemsCache.forEach(function (p) {
        if (!legacyReadCodeByProblemId[p.id]) return;
        var conceptId = conceptIdByProblemId[p.id];
        if (conceptId && readCodeConceptIds.indexOf(conceptId) === -1) readCodeConceptIds.push(conceptId);
      });
      var sameConceptResultsByConceptId = Object.create(null);
      await Promise.all(
        readCodeConceptIds.map(function (conceptId) {
          var describingProblem = _problemsCache.find(function (p) {
            return conceptIdByProblemId[p.id] === conceptId && legacyReadCodeByProblemId[p.id];
          });
          var prefillForQuery = describingProblem && prefillsById[describingProblem.id];
          var codeForQuery = prefillForQuery && prefillForQuery.problemCode && prefillForQuery.problemCode.value;
          var descriptionForQuery = (codeForQuery && codeForQuery.description) || '';
          return Promise.all([
            searchDescriptions(stripLegacyMarkers(descriptionForQuery)),
            searchDescriptions(conceptId),
          ])
            .then(function (resultsPair) {
              sameConceptResultsByConceptId[conceptId] = resultsPair[0].concat(resultsPair[1]);
            })
            .catch(function () {
              sameConceptResultsByConceptId[conceptId] = [];
            });
        })
      );

      // Everything fetched — last stop before per-row state writes into
      // _rows, which a patient change has by now replaced (see scan()).
      if (_lastPatientId !== scanPatientId) return;

      // Built once for the whole scan — every problem's own {id, description},
      // filtered per-row below to exclude the one being scanned. Feeds
      // linkSuggestion's candidate matching (see computeAdditionalInfoFindings's
      // own comment on otherProblems / shared/problem-text-linking.js).
      var allProblemsForLinking = _problemsCache.map(function (p) {
        return { id: p.id, description: p.problemCodeDescription };
      });

      var flaggedCount = 0;
      _problemsCache.forEach(function (p) {
        var conceptId = conceptIdByProblemId[p.id];
        var retirement = conceptId ? retirementByConceptId[conceptId] : null;
        // active:null means the check itself didn't cleanly resolve (network
        // error, stale release string, …) — never treat as retired.
        var isRetired = !!(retirement && retirement.active === false);
        var legacyReadCode = legacyReadCodeByProblemId[p.id] || null;
        var prefill = prefillsById[p.id];
        if (legacyReadCode) {
          var code = prefill && prefill.problemCode && prefill.problemCode.value;
          var currentDescription = code && code.description;
          var sameConceptResults = sameConceptResultsByConceptId[conceptId] || [];
          var hasBetterWording = sameConceptAlternatives(sameConceptResults, conceptId, currentDescription).length > 0;
          if (!hasBetterWording) legacyReadCode = null;
        }
        var otherProblemsForLinking = allProblemsForLinking.filter(function (op) {
          return op.id !== p.id;
        });
        var findings = computeAdditionalInfoFindings(
          prefill && prefill.additionalInformation,
          prefill && prefill.significance,
          genericInfoEntries,
          otherProblemsForLinking
        );
        var hasGenericInfo = !!findings.genericAdditionalInfo;
        var hasSeverityContradiction = !!findings.severityContradiction;
        var hasSeverityReviewNote = !!findings.severityReviewNote;
        var hasLinkSuggestion = !!findings.linkSuggestion;
        if (
          !isRetired &&
          !legacyReadCode &&
          !hasGenericInfo &&
          !hasSeverityContradiction &&
          !hasSeverityReviewNote &&
          !hasLinkSuggestion
        ) {
          return;
        }
        flaggedCount++;
        var st = rowState(p.id);
        st.prefill = prefill;
        if (isRetired) {
          st.retiredInfo = {
            inactivationReason: retirement.inactivationReason,
            replacement: retirement.replacement,
            possiblyEquivalentTo: retirement.possiblyEquivalentTo || [],
            partiallyEquivalentTo: retirement.partiallyEquivalentTo || [],
          };
        }
        if (legacyReadCode) st.legacyReadCode = legacyReadCode;
        if (hasGenericInfo) st.genericAdditionalInfo = findings.genericAdditionalInfo;
        if (hasSeverityContradiction) st.severityContradiction = findings.severityContradiction;
        if (hasSeverityReviewNote) st.severityReviewNote = findings.severityReviewNote;
        if (hasLinkSuggestion) st.linkSuggestion = findings.linkSuggestion;
        var row = anchorsByProblemId[p.id];
        if (row) injectFixButton(p.id, row);
      });
      // Settled BEFORE _retiredScanState flips to 'done' (so the widget's
      // first render of a flagged row already has a definitive true/false,
      // never a flash of the 3-way offer that then disappears) — same
      // "check before someone already fixed this manually" as
      // problem-nesting.js's own scan-time check (2026-08-09 request).
      // Bounded by how many confident matches actually resolved, never by
      // list size — see checkExistingRelationship's own header.
      if (window.ProblemNesting) {
        await Promise.all(
          Object.keys(_rows)
            .filter(function (id) {
              var st = _rows[id];
              return st.linkSuggestion && st.linkSuggestion.match;
            })
            .map(function (id) {
              return window.ProblemNesting.checkExistingRelationship(id, _rows[id].linkSuggestion.match.problemId)
                .then(function (result) {
                  _rows[id].linkSuggestion.alreadyRelated = result.relatedToMatch;
                  _rows[id].linkSuggestion.hasOtherRelationship = !result.relatedToMatch && result.hasAnyRelationship;
                })
                .catch(function () {
                  /* left unset — reads as "not known to be related" */
                });
            })
        );
      }
      // Final patient re-check (review finding): the relationship-check
      // batch above is one network round-trip per confident match — plenty
      // of time for an SPA patient navigation to have reset this widget.
      if (_lastPatientId !== scanPatientId) return;
      _retiredFlaggedCount = flaggedCount;
      _retiredScanState = 'done';
    } catch (err) {
      if (_lastPatientId !== scanPatientId) return;
      _retiredScanState = 'error';
      _retiredScanError = (err && err.message) || 'Failed to check for retired/legacy codes.';
    } finally {
      if (_lastPatientId === scanPatientId) renderRetiredWidget();
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
            ' flagged (retired code, Read-code-derived description, generic import text, a GP2GP severity-defaulting contradiction, an unmapped source-system priority value, and/or a "Grouped with" reference suggesting a link to another problem) — see "Clean up code" on the flagged problem(s) above.'
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

  // Placement mirrors content-scripts/problem-bulk-end.js's own
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
      _scanInFlight = true;
      // Mirrors the stale-response discipline from the PR #227 audit fixes
      // (_evalGen/_runToken in sentinel.js/record.js): the clinician can open
      // a DIFFERENT patient while this fetch is in flight. That second
      // scan() sees _scanInFlight already true and skips fetching, so when
      // patient A's response lands here it must not be cached against
      // whatever patient is now on screen — captured BEFORE the await so it
      // reflects who this specific fetch was actually for, not whoever
      // _lastPatientId points to by the time it resolves.
      var requestedPatientId = info.patientId;
      try {
        var fetched = await fetchClinicalSummaryProblems(info.patientId);
        if (_lastPatientId === requestedPatientId) _problemsCache = fetched;
        // else: patient changed mid-fetch — discard silently, the next
        // mutation tick's scan() will refetch for whoever is on screen now.
      } catch (_) {
        if (_lastPatientId === requestedPatientId) _problemsCache = [];
      } finally {
        _scanInFlight = false;
      }
    }
    if (!_problemsCache) return;
    var outdated = findOutdatedProblems(_problemsCache);
    // See buildAnchorMap's comment: computed from the FULL problem list so a
    // duplicate-text problem not in 'outdated' still claims its own row.
    var anchorsByProblemId = buildAnchorMap(_problemsCache);
    // Union with any problem already flagged by the opt-in retirement scan
    // (runRetiredCodesScan sets these once, as a side effect of the scan
    // completing, and never repeats the injection itself). Without this,
    // a problem flagged ONLY by that scan (not the cheap text heuristic
    // above) loses its "Clean up code" button for good the moment Vue
    // wipes it on same-patient tab navigation, since nothing in this
    // recurring loop otherwise knows it was ever flagged — the opt-in
    // widget itself reappears fine (injectRetiredWidgetTrigger runs
    // unconditionally below), but the per-row button did not. Found live
    // 2026-07-28 via a timed peak/final DOM-count capture spanning a
    // navigate-away-and-back: widget count recovered, button count did not.
    var flaggedIds = outdated.map(function (p) {
      return String(p.id);
    });
    Object.keys(_rows).forEach(function (id) {
      if (flaggedIds.indexOf(id) !== -1) return;
      var st = _rows[id];
      var flaggedByRetiredScan =
        st.retiredInfo ||
        st.legacyReadCode ||
        (st.genericAdditionalInfo && st.genericAdditionalInfo.removed.length > 0);
      if (flaggedByRetiredScan) flaggedIds.push(id);
    });
    flaggedIds.forEach(function (id) {
      var row = anchorsByProblemId[id];
      if (row) injectFixButton(id, row);
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
