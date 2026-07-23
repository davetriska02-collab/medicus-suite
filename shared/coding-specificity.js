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
//
// THIRD CATEGORY (added 2026-07-23), `hintExpandedAlternatives`: found via a
// real "[SO]Rotator cuff" (7885001) problem with additionalInformation
// "-tear" that got NO suggestion of any kind from the first two categories.
// Root cause (confirmed via live capture, NOT the same bug as the
// word-mismatch fix above): 7885001 is a SNOMED BODY STRUCTURE concept
// ("Rotator cuff (structure)") — an anatomical site, not a disorder. It can
// never appear in the disorder/procedure-hierarchy search
// (sameConceptAlternatives), and no disorder result is worded plainly enough
// to exact-match "Rotator cuff" (crossConceptAlternatives). But the REAL
// intended target almost certainly exists — confirmed live: searching
// "rotator cuff tear" in the disorder hierarchy finds 926335004 "Rotator cuff
// tear" — and the additionalInformation hint ("-tear") is exactly what
// points at it. This category combines the stripped base description with a
// recognised pathology word found in additionalInformation and re-searches,
// treating the result as cross-concept (a genuinely different concept, no
// hierarchy proof — combining two text fragments is LESS certain than
// crossConceptAlternatives' single exact-text match, so this is the riskiest
// category yet and must be flagged even more strongly in the UI).
//
// EXPLICIT SCOPE DECISION (2026-07-23, discussed with the user after this
// case was found): an anatomical-structure concept should NEVER be a
// "problem" in its own right — the legacy code always really meant some
// pathology IN that structure. This makes hint-expansion safe to build now
// for the single-problem "Fix description" flow. But when this suggestion
// engine is later extended to run across the WHOLE record (not just
// already-flagged-outdated problems), the user's explicit plan is: same-
// concept and cross-concept-exact matches are "easy" cases that could
// eventually be bulk-auto-corrected, but hint-expanded matches must NEVER be
// bulk-applied — they must always prompt a clinician, because unlike the
// other categories there is no hierarchy proof AND no exact-text guarantee,
// only a constructed-query coincidence. Any future bulk-correction feature
// MUST exclude this category by construction, not just by convention.
//
// TRIGGER SCOPE (per the user's explicit choice): only attempted as a
// fallback when same-concept, descendant, AND cross-concept-exact all come
// back empty — no separate proactive check, no extra API call in the common
// case where one of the other three categories already found something.
//
// HINT EXTRACTION SCOPE (per the user's explicit choice): looks only at the
// FIRST sentence/clause of additionalInformation (before the first
// '.'/';'/newline) for a word from a curated pathology-word list — NOT the
// leading-dash shorthand specifically (so "-tear", "query tear" and "tear ?"
// all match equally), and NOT arbitrary freeform text (which would risk
// building a nonsense combined query from unrelated later notes).
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
  // closure, not just direct parents) whose description matches AT LEAST ONE
  // of the requested hint word(s) — candidates matching zero words are
  // dropped, since with the full-descendant-set retrieval now used upstream
  // (see searchDescendantsNarrowed's blank-query mode) most real descendants
  // of a broad parent concept will have nothing to do with the free text at
  // all, and showing all of them would overwhelm the clinician with noise.
  // Survivors are ranked by `matchScore` (0-100, the percentage of hint
  // words found in that candidate's own description) — RANKING, not another
  // gate: both the ancestry check and the "at least one word" floor are what
  // make this safe, matchScore only decides ORDER. Dedupes by descriptionId
  // (falling back to description text), same discipline as
  // sameConceptAlternatives in legacy-coded-description.js.
  //
  // SCOPE LIMIT (accepted, discussed 2026-07-23): this is literal
  // word-boundary overlap, not clinical synonym-awareness — "myomectomy"
  // scores 0% against a hint of "resection"/"fibroid" despite meaning
  // "fibroid removal", because the words don't literally share any text.
  // Catching that would need either a curated synonym dictionary (same
  // maintenance/risk profile as PATHOLOGY_HINT_WORDS) or an actual semantic
  // similarity call (sending patient free text to an LLM — a real
  // architecture/data-handling decision, explicitly deferred, not built
  // here).
  //
  // `hintWords` accepts a single string (the original laterality call shape —
  // 'right'/'left'/'bilateral') OR an array of words (GENERALISED 2026-07-23:
  // real example — "Hysteroscopy NEC" (233545006) with additionalInformation
  // "resection of uterine fibroid" has a confirmed genuine descendant,
  // 84064003 "Hysteroscopy with removal of uterine fibroid" — found this way,
  // not via a laterality word. The ancestry check is what guarantees safety,
  // not which specific word matched, so this is not a laterality-specific
  // function despite the parameter's original name.
  function descendantAlternatives(results, currentConceptId, hintWords) {
    if (!Array.isArray(results) || !currentConceptId) return [];
    var words = (Array.isArray(hintWords) ? hintWords : [hintWords]).filter(Boolean);
    if (!words.length) return [];
    var wordRes = words.map(function (w) {
      return new RegExp('\\b' + w + '\\b', 'i');
    });
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || !v.conceptId || v.conceptId === currentConceptId) return;
      if (!Array.isArray(v.parentConceptIds) || v.parentConceptIds.indexOf(currentConceptId) === -1) return;
      var desc = String(v.description || '');
      var matchedCount = wordRes.filter(function (re) {
        return re.test(desc);
      }).length;
      if (matchedCount === 0) return;
      var key = v.descriptionId || v.description;
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        description: v.description,
        conceptId: v.conceptId,
        descriptionId: v.descriptionId || null,
        matchScore: Math.round((100 * matchedCount) / words.length),
      });
    });
    out.sort(function (a, b) {
      return b.matchScore - a.matchScore;
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

  // Curated starter set of common pathology-descriptor words — deliberately
  // conservative, not exhaustive free-text NLP. A missed word here just means
  // no hint-expanded suggestion is offered (the safe default, same as any
  // other "nothing found" case), never a wrong one, so this list is safe to
  // grow incrementally as real cases surface — unlike drug-rules.json's
  // brand-list completeness requirement, there's no silent-harm failure mode
  // here to guard against with a version lock.
  var PATHOLOGY_HINT_WORDS = [
    'tear',
    'rupture',
    'sprain',
    'strain',
    'valvular',
    'stenosis',
    'regurgitation',
    'prolapse',
    'dislocation',
    'subluxation',
    'fracture',
    'laceration',
    'contusion',
    'tendinitis',
    'tendinopathy',
    'bursitis',
    'arthritis',
    'arthropathy',
    'impingement',
    'effusion',
    'degeneration',
    'inflammation',
    'infection',
    'abscess',
    'ulcer',
    'perforation',
    'thrombosis',
    'aneurysm',
  ];

  // Grabs everything before the first '.'/';'/newline — deliberately not the
  // WHOLE additionalInformation field, per the user's explicit scope choice,
  // to avoid picking up a hint word from unrelated later free-text notes.
  function firstClause(text) {
    var t = String(text == null ? '' : text);
    var m = t.match(/^[^.;\n]*/);
    return m ? m[0] : t;
  }

  // Returns the first recognised pathology word found in the first
  // sentence/clause of `text` (lowercase, canonical form), or null. Does NOT
  // require the leading-dash shorthand seen in the motivating example
  // ("-tear") — any word-boundary occurrence in the first clause counts.
  function detectPathologyHint(text) {
    var clause = firstClause(text);
    for (var i = 0; i < PATHOLOGY_HINT_WORDS.length; i++) {
      var word = PATHOLOGY_HINT_WORDS[i];
      if (new RegExp('\\b' + word + '\\b', 'i').test(clause)) return word;
    }
    return null;
  }

  // Generic (non-clinical) stop-words only — deliberately NOT a
  // clinical/pathology word list like PATHOLOGY_HINT_WORDS above. Used for
  // descendantAlternatives' generalised hint-word extraction (2026-07-23,
  // "Hysteroscopy NEC"/"resection of uterine fibroid" case): unlike
  // hintExpandedAlternatives, this path has a hard structural safety net
  // (parentConceptIds containment against the CURRENT concept), so it
  // doesn't need — and shouldn't rely on — a curated clinical vocabulary; any
  // significant word from the free text is safe to try, because ancestry is
  // what makes it safe, not which word matched.
  var GENERIC_STOP_WORDS = ['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with'];

  // Extracts unique, lowercase, non-trivial words from the WHOLE of `text`,
  // for use as descendantAlternatives' matchScore ranking input. E.g.
  // "resection of uterine fibroid." -> ['resection', 'uterine', 'fibroid'].
  //
  // SCANS THE WHOLE FIELD, NOT JUST THE FIRST CLAUSE (changed 2026-07-23 —
  // this originally reused detectPathologyHint's firstClause scope limit,
  // but that was wrong for this use: a real "Hysteroscopy NEC" case had
  // additionalInformation "& laparoscopy. resection of fibroid." — the
  // clinically relevant detail ("resection of fibroid") is in the SECOND
  // sentence, so first-clause-only silently missed it entirely. That
  // restriction made sense for detectPathologyHint/hintExpandedAlternatives,
  // which has NO structural safety net and so needs to stay conservative
  // about how much free text it trusts — but descendantAlternatives' hard
  // ancestry gate (candidates must be TRUE descendants of the current
  // concept) means a stray word from later in the note can't cause a false
  // match, only miss a true one if under-scoped. detectPathologyHint keeps
  // its own separate first-clause-scoped extraction; this function is now
  // independent of it.
  function significantWords(text) {
    var whole = String(text == null ? '' : text).toLowerCase();
    var candidates = whole.match(/[a-z]+/g) || [];
    var seen = Object.create(null);
    var out = [];
    candidates.forEach(function (w) {
      if (w.length < 3) return;
      if (GENERIC_STOP_WORDS.indexOf(w) !== -1) return;
      if (seen[w]) return;
      seen[w] = true;
      out.push(w);
    });
    return out;
  }

  // If the current description already mentions the hint word, there's
  // nothing to add — same discipline as descriptionAlreadySpecifiesLaterality.
  function descriptionAlreadyMentionsHint(description, hintWord) {
    if (!hintWord) return false;
    var d = String(description == null ? '' : description);
    return new RegExp('\\b' + hintWord + '\\b', 'i').test(d);
  }

  // Filters the results of a SEPARATE search (query = stripped base
  // description + hintWord — a new fetch, not a re-filter of the existing
  // combinedResults, since this is a different query text) down to genuine
  // candidates: never the current concept itself, and — belt and braces on
  // top of Medicus's own all-words-required search behaviour — the result's
  // own description must actually contain the hint word. Same dedupe
  // discipline as crossConceptAlternatives (by conceptId + descriptionId,
  // since candidates come from different concepts).
  function hintExpandedAlternatives(results, currentConceptId, hintWord) {
    if (!Array.isArray(results) || !currentConceptId || !hintWord) return [];
    var hintRe = new RegExp('\\b' + hintWord + '\\b', 'i');
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || !v.conceptId || v.conceptId === currentConceptId) return;
      if (!hintRe.test(String(v.description || ''))) return;
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
    PATHOLOGY_HINT_WORDS,
    detectPathologyHint,
    descriptionAlreadyMentionsHint,
    hintExpandedAlternatives,
    significantWords,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSCodingSpecificity = api;
  }
})(typeof window !== 'undefined' ? window : global);
