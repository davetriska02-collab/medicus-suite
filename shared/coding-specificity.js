// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared "coding specificity" helpers: suggesting a more
// SPECIFIC SNOMED concept than the one currently coded, restricted to true
// descendants of the current concept in the SNOMED IS-A hierarchy.
//
// Materially different, higher-risk cousin of shared/legacy-coded-description.js:
// that file only ever offers a different DESCRIPTION of the SAME concept (a
// cosmetic relabel); this one can suggest a genuinely DIFFERENT concept — a
// real coding decision (affects QOF/referrals/audit). The safety rule that
// makes this acceptable: only ever offer a concept that is a strict
// specialisation (descendant) of what's already coded, never a lateral or
// unrelated recode — confirmed via Medicus's own `parentConceptIds` ancestor
// closure (see below), never guessed.
//
// SCOPE FOR THIS PASS: laterality only (rt/right, lt/left, bilateral) — not
// full free-text-to-code NLP, which is large and risky (abbreviation
// ambiguity -> wrong-but-confident suggestions are worse than none). Kept
// entity-agnostic (no window/document/fetch, no problem-specific field
// names) so it can be reused if/when this is extended beyond problems, or
// beyond laterality, later — same split rationale as
// shared/legacy-coded-description.js.
//
// CONFIRMED CONTRACT (live capture, 2026-07-22/23, real patient query
// "fracture of radius" against the existing problem-search endpoint with
// `&outputParentConceptIds=1` appended): every result carries a
// `parentConceptIds` array — the concept's FULL ancestor closure (not just
// direct parents). "Fracture of right radius" (446461000124103) and
// "Fracture of distal end of radius" (263199001) both list `12676007`
// ("Fracture of radius") in their `parentConceptIds`. THE DESCENDANT TEST:
// does the CURRENT concept's conceptId appear in a candidate's
// `parentConceptIds`? If yes, the candidate is a strict specialisation.
//
// SECOND CATEGORY (added 2026-07-23), `crossConceptAlternatives`: real
// example — "[X]Heroin addiction" (75544000) has NO same-concept
// alternative (sameConceptAlternatives finds nothing, since the modern term
// lives under a genuinely different concept, 231477003 "Heroin addiction"),
// yet a DIFFERENT concept exists whose description is textually IDENTICAL
// once the legacy markers are stripped. This is the riskiest category here —
// no hierarchy proof like descendantAlternatives, only a text match — so the
// UI must flag it explicitly (distinct styling + explanatory copy) rather
// than presenting it like a same-concept relabel.
'use strict';

(function (global) {
  // Reuses stripLegacyMarkers from legacy-coded-description.js for
  // crossConceptAlternatives below, rather than a second copy of the
  // bracket/NOS/NEC regexes — one source of truth, no risk of the two
  // drifting apart. Loaded first in manifest.json's content_scripts array.
  var legacyCodedDescription =
    typeof module !== 'undefined' && module.exports
      ? require('./legacy-coded-description.js')
      : global.MSLegacyCodedDescription;

  // Word-boundary laterality tokens. Clinical shorthand ("rt"/"lt") and the
  // full word are both accepted. If a description mentions BOTH right and
  // left without "bilateral" wording, that's ambiguous — no confident hint
  // beats a wrong one, so detectLateralityHint returns null.
  var RIGHT_RE = /\b(?:rt|right)\b/i;
  var LEFT_RE = /\b(?:lt|left)\b/i;
  var BILATERAL_RE = /\b(?:bilat|bilateral)\b/i;

  function detectLateralityHint(text) {
    var t = String(text == null ? '' : text);
    if (BILATERAL_RE.test(t)) return 'bilateral';
    var right = RIGHT_RE.test(t);
    var left = LEFT_RE.test(t);
    if (right && left) return null; // ambiguous — don't guess
    if (right) return 'right';
    if (left) return 'left';
    return null;
  }

  // Word-boundary check for the CANONICAL word (SNOMED descriptions use the
  // full word, never "rt"/"lt" shorthand) — if the current description
  // already specifies this laterality, there's nothing to suggest.
  function descriptionAlreadySpecifiesLaterality(description, laterality) {
    if (!laterality) return false;
    var d = String(description == null ? '' : description);
    var re = new RegExp('\\b' + laterality + '\\b', 'i');
    return re.test(d);
  }

  // Filters a searchDescriptions()-shaped results array down to genuine
  // DESCENDANTS of `currentConceptId` (per parentConceptIds — the ancestor
  // closure, not just direct parents) whose description also matches the
  // requested laterality's canonical word. Both filters are required: ancestry
  // alone would surface unrelated-laterality descendants (e.g. "Open fracture
  // of radius"), and text alone would drop the descendant safety guarantee.
  // Dedupes by descriptionId (falling back to description text), same
  // discipline as sameConceptAlternatives in legacy-coded-description.js.
  function descendantAlternatives(results, currentConceptId, laterality) {
    if (!Array.isArray(results) || !currentConceptId || !laterality) return [];
    var lateralityRe = new RegExp('\\b' + laterality + '\\b', 'i');
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || !v.conceptId || v.conceptId === currentConceptId) return;
      if (!Array.isArray(v.parentConceptIds) || v.parentConceptIds.indexOf(currentConceptId) === -1) return;
      if (!lateralityRe.test(String(v.description || ''))) return;
      var key = v.descriptionId || v.description;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ description: v.description, conceptId: v.conceptId, descriptionId: v.descriptionId || null });
    });
    return out;
  }

  // Normalises a description for the exact-text-match comparison below:
  // trims and collapses internal whitespace, case-insensitive. Deliberately
  // NOT fuzzy — this must only fire on a TRUE exact match once legacy
  // markers are stripped, never a near-miss.
  function normaliseText(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // Finds a DIFFERENT SNOMED concept whose description is IDENTICAL to the
  // current one once legacy markers ("[X]"/NOS/NEC) are stripped — e.g.
  // "[X]Heroin addiction" (75544000) -> "Heroin addiction" is the literal
  // description of a genuinely different, modern concept (231477003).
  // sameConceptAlternatives (legacy-coded-description.js) can never surface
  // this, because by definition it's a DIFFERENT conceptId — this is exactly
  // the case that safety filter was designed to exclude, and exactly why
  // this is a separate, explicitly-flagged category: unlike
  // descendantAlternatives (hierarchy-proven), there is NO structural
  // guarantee the two concepts mean the same thing, only that their text is
  // identical — a clinician must actively confirm this is correct, not just
  // click through it as a cosmetic relabel would be.
  //
  // NOTE ON SCOPE: this only catches cases where the modern replacement has
  // the EXACT SAME wording as the legacy description (post-strip) — it will
  // NOT catch a modern replacement with genuinely different wording (e.g.
  // "Opioid dependence" for old "[X]Heroin addiction" text) — that would
  // require real terminology-mapping data, not a text match, and is out of
  // scope here.
  function crossConceptAlternatives(results, currentConceptId, currentDescription) {
    if (!Array.isArray(results) || !currentConceptId) return [];
    var target = normaliseText(legacyCodedDescription.stripLegacyMarkers(currentDescription));
    if (!target) return [];
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || !v.conceptId || v.conceptId === currentConceptId) return;
      if (normaliseText(v.description) !== target) return;
      var key = v.conceptId + '|' + (v.descriptionId || v.description);
      if (seen[key]) return;
      seen[key] = true;
      out.push({ description: v.description, conceptId: v.conceptId, descriptionId: v.descriptionId || null });
    });
    return out;
  }

  var api = {
    detectLateralityHint,
    descriptionAlreadySpecifiesLaterality,
    descendantAlternatives,
    crossConceptAlternatives,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSCodingSpecificity = api;
  }
})(typeof window !== 'undefined' ? window : global);
