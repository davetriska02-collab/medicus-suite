// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared "legacy coded-entry description" detection + safety
// filter, generic across EVERY kind of SNOMED-coded entry Medicus records
// (problems, and eventually procedures/referrals/journal entries, …) — not
// specific to problems.
//
// Split out of content-scripts/problem-description-cleanup.js (2026-07-22,
// same day the problem-specific version was built and confirmed live) once
// the user confirmed they want this to eventually cover every coded entry
// type, not just problems — problems remain the test bed (the only entity
// type with a confirmed edit endpoint so far), but the detection heuristic
// and the "never re-code to a different concept" safety filter don't depend
// on which entity type owns the coded entry, so they live here to be reused
// without rederiving them per entity type. What ISN'T shareable: the actual
// "fetch prefill / build payload / POST" API layer — that's confirmed
// entity-by-entity via its own live capture (clinical/problem/edit-problem
// for problems; a different endpoint/shape is expected for procedures,
// referrals, etc., same as documents already had one of their own — see
// docs/learnings-problem-description-cleanup.md).
'use strict';

(function (global) {
  // Historic ICD/Read cross-map bracket marker ("[X]", "[D]", "[M]", "[V]", …)
  // and/or a trailing "NOS" (Not Otherwise Specified) or "NEC" (Not Elsewhere
  // Classified) — the textual tells of a legacy coded-entry description that
  // usually has a cleaner modern synonym under the SAME SNOMED concept.
  var LEGACY_PREFIX_RE = /^\[[A-Za-z]{1,2}\]\s*/;
  var LEGACY_SUFFIX_RE = /\s*\b(?:NOS|NEC)\b\.?\s*$/i;

  // A trailing bracketed abbreviation immediately before the NOS/NEC suffix
  // — e.g. "Lower uterine segment caesarean section (LSCS) NEC". Found live
  // 2026-07-23: the concept behind that description (398307005) is RETIRED
  // in SNOMED (confirmed via the SNOMED CT browser — no parents/children),
  // and its real active replacement (788180009) has a synonym that is an
  // EXACT text match to the current description ONLY once "(LSCS)" is also
  // stripped — crossConceptAlternatives' exact-match rule can't see past it
  // otherwise.
  //
  // ACCEPTED RISK, explicitly flagged by the user rather than silently
  // assumed: stripping this unconditionally is a simplification that can be
  // WRONG for a description where the bracketed text is integral to its
  // meaning rather than a legacy artefact (e.g. a hypothetical "...disorder
  // (ADHD)" flagged outdated for an unrelated reason) — over-stripping
  // there risks a false exact-text cross-concept match. Mitigated by
  // crossConceptAlternatives already being the "verify before applying"
  // category, never auto-applied, and by this only ever running on
  // descriptions ALREADY confirmed outdated (via the prefix/suffix checks
  // above), not the whole record. Revisit if a false-positive from this
  // specific step is ever found live — deliberately not solved more
  // precisely than this for now.
  var LEGACY_TRAILING_ABBREVIATION_RE = /\s*\([A-Za-z]{2,6}\)\s*$/;

  function looksOutdated(description) {
    var d = String(description == null ? '' : description);
    return LEGACY_PREFIX_RE.test(d) || LEGACY_SUFFIX_RE.test(d);
  }

  // Strips the legacy prefix/suffix (and, once exposed, a trailing bracketed
  // abbreviation) to build search query text — e.g. "[X]Attention deficit
  // disorder" -> "Attention deficit disorder", "Fracture of radius NOS" ->
  // "Fracture of radius", "Lower uterine segment caesarean section (LSCS)
  // NEC" -> "Lower uterine segment caesarean section".
  function stripLegacyMarkers(description) {
    return String(description == null ? '' : description)
      .replace(LEGACY_PREFIX_RE, '')
      .replace(LEGACY_SUFFIX_RE, '')
      .replace(LEGACY_TRAILING_ABBREVIATION_RE, '')
      .trim();
  }

  // Filters a snomed search-results list down to alternate descriptions of
  // the SAME concept as `conceptId` — the safety rule that guarantees this
  // tool only ever offers a different SYNONYM of the current code, never a
  // re-code to a different clinical concept. Excludes the entry that's just
  // the current description again (nothing to offer) and dedupes by
  // descriptionId (falling back to description text when descriptionId is
  // absent, since a small number of results have been seen without one).
  function sameConceptAlternatives(results, conceptId, currentDescription) {
    if (!Array.isArray(results) || !conceptId) return [];
    var seen = Object.create(null);
    var out = [];
    results.forEach(function (r) {
      var v = r && r.value;
      if (!v || v.conceptId !== conceptId) return;
      if (v.description === currentDescription) return;
      var key = v.descriptionId || v.description;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ description: v.description, conceptId: v.conceptId, descriptionId: v.descriptionId || null });
    });
    return out;
  }

  var api = {
    looksOutdated,
    stripLegacyMarkers,
    sameConceptAlternatives,
    LEGACY_PREFIX_RE,
    LEGACY_SUFFIX_RE,
    LEGACY_TRAILING_ABBREVIATION_RE,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSLegacyCodedDescription = api;
  }
})(typeof window !== 'undefined' ? window : global);
