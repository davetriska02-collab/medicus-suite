// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — matches a free-text problem-name REFERENCE (extracted from
// GP2GP import boilerplate, e.g. "(Grouped with Anxiety with depression)")
// against the patient's OWN other problems, to suggest a relationship rather
// than just flagging the text as noise.
//
// WHY THIS EXISTS: some GP2GP additionalInformation boilerplate flattens
// genuinely useful STRUCTURED information into free text — same category as
// the severity-defaulting boilerplate already handled by
// generic-additional-info-text.json's severityDefaultingContradiction entry,
// but here the flattened fact is a RELATIONSHIP to another on-record problem
// ("this problem was grouped with X on the source system"), not a severity
// value. Detecting the "(Grouped with X)" text itself lives in
// content-scripts/problem-description-cleanup.js (rules/generic-additional-
// info-text.json, a new pattern entry); THIS file is only the matching step
// — turning the captured name "X" into a candidate problemId — shared by
// both problem-description-cleanup.js (the inline create-link offer in the
// "Check for retired/legacy codes?" scan) and content-scripts/problem-
// nesting.js (the same suggestion surfaced in the Organise-problems canvas
// tray), so the two surfaces can never disagree about which problem a given
// reference resolves to.
//
// DELIBERATELY NOT FUZZY/SEMANTIC (same discipline as
// shared/coding-specificity.js's normaliseText/descendantAlternatives, which
// this mirrors): no edit-distance, no synonym awareness, no clinical
// judgement about what the text "probably means". Two tiers only —
//   'exact'   — the captured name, normalised, is byte-identical to a
//               candidate's own normalised description.
//   'partial' — every significant word in the captured name (stopwords
//               excluded) appears, word-boundary matched, somewhere in a
//               candidate's description. Asymmetric: the candidate may have
//               EXTRA words the captured name doesn't (e.g. captured
//               "Anxiety with depression" against candidate "Mixed anxiety
//               with depression" still matches), but every word the
//               reference actually named must be present — a candidate
//               missing even one is not a match at this tier.
// Anything short of 'partial' (not every significant word found) returns
// null — no guessed link, ever; the caller's job is to fall back to an
// informational note, mirroring reviewSeverity's own "no confident mapping,
// ask the clinician to check" behaviour for an unmapped PRIORITY=n value.

'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ──

  // Same normalisation as shared/coding-specificity.js's normaliseText:
  // trim, collapse whitespace, lowercase. Duplicated rather than imported —
  // this file must also load standalone in contexts that don't already have
  // coding-specificity.js on the page (same "small helpers are duplicated,
  // not shared" convention as apiErrorMessage across content scripts).
  function normaliseText(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // Words carrying no matching signal on their own — excluded so a captured
  // name differing from a candidate only by one of these doesn't fail the
  // 'partial' tier. Deliberately short and unambiguous; this is NOT a
  // general-purpose stopword list, just enough to stop common connectives
  // from being treated as "must match" content words.
  var STOPWORDS = { with: 1, and: 1, of: 1, the: 1, a: 1, an: 1, in: 1, for: 1, to: 1, or: 1 };

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Significant words: normalised, split on whitespace, stopwords and
  // anything under 3 characters dropped (same rationale as the stopword
  // list — too short to carry match signal, and would trivially "match"
  // almost anything via word-boundary regex).
  function significantWords(text) {
    return normaliseText(text)
      .split(' ')
      .filter(function (w) {
        return w.length > 2 && !STOPWORDS[w];
      });
  }

  // candidates: [{id, description}]. Returns
  // {problemId, description, confidence:'exact'|'partial'} or null.
  //
  // AMBIGUITY IS A NON-MATCH (review finding on the original first-hit
  // implementation): when MORE THAN ONE candidate qualifies at the winning
  // tier, whichever happened to be first in the list would have been
  // presented as a confident "best match" — e.g. captured "Diabetes
  // mellitus" against a record carrying BOTH "Type 1 diabetes mellitus" and
  // "Type 2 diabetes mellitus" qualifies both at 'partial', and duplicate
  // problem entries (common enough that the suite ships a duplicate-merge
  // tool) tie at 'exact'. An arbitrary pick dressed as confidence is exactly
  // the guessing this module's header forswears, and the offered
  // relationship write would target a possibly-wrong problem — so a tie at
  // the winning tier returns null, falling back to the caller's existing
  // "check manually" informational note, same as any other non-match.
  function matchProblemByName(name, candidates) {
    var target = normaliseText(name);
    if (!target || !Array.isArray(candidates) || !candidates.length) return null;

    var exactMatches = candidates.filter(function (c) {
      return c && normaliseText(c.description) === target;
    });
    if (exactMatches.length === 1) {
      return { problemId: exactMatches[0].id, description: exactMatches[0].description, confidence: 'exact' };
    }
    if (exactMatches.length > 1) return null; // duplicate entries — no arbitrary pick

    var words = significantWords(name);
    if (!words.length) return null;
    var wordRes = words.map(function (w) {
      return new RegExp('\\b' + escapeRegExp(w) + '\\b', 'i');
    });

    var partialMatches = candidates.filter(function (cand) {
      if (!cand || !cand.description) return false;
      var desc = String(cand.description);
      return wordRes.every(function (re) {
        return re.test(desc);
      });
    });
    if (partialMatches.length === 1) {
      return { problemId: partialMatches[0].id, description: partialMatches[0].description, confidence: 'partial' };
    }
    return null; // zero qualifying, or several equally-qualifying — never guess between them
  }

  // Finds the ONE configured `linkSuggestion`-actioned pattern entry (there
  // is only ever one — see rules/generic-additional-info-text.json's own
  // "confirm before adding" discipline, one entry per real observed
  // boilerplate) and applies it. Single source of truth for the regex: both
  // content-scripts/problem-description-cleanup.js (via
  // computeAdditionalInfoFindings, which reads the same `entries` array) and
  // content-scripts/problem-nesting.js's own scan (via this function) load
  // the SAME rules/generic-additional-info-text.json rather than each
  // hardcoding an independent copy of the pattern that could silently drift
  // apart. Returns {problemName} or null (no entry configured, no match, or
  // a malformed regex source — never throws).
  function extractGroupedWithReference(additionalInformation, entries) {
    var entry = (Array.isArray(entries) ? entries : []).filter(function (e) {
      return e && e.kind === 'pattern' && e.action && e.action.type === 'linkSuggestion';
    })[0];
    if (!entry || !entry.pattern) return null;
    var re;
    try {
      re = new RegExp(entry.pattern, entry.flags || '');
    } catch (e) {
      return null;
    }
    var m = (additionalInformation == null ? '' : String(additionalInformation)).match(re);
    if (!m) return null;
    var idx = entry.action.capturesProblemName || 1;
    var name = m[idx];
    return name ? { problemName: name } : null;
  }

  var api = {
    normaliseText: normaliseText,
    significantWords: significantWords,
    matchProblemByName: matchProblemByName,
    extractGroupedWithReference: extractGroupedWithReference,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined') {
    self.MSProblemTextLinking = api;
  }
})();
