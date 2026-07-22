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
  // and/or a trailing "NOS" (Not Otherwise Specified) — the two textual tells
  // of a legacy coded-entry description that usually has a cleaner modern
  // synonym under the SAME SNOMED concept.
  var LEGACY_PREFIX_RE = /^\[[A-Za-z]{1,2}\]\s*/;
  var LEGACY_SUFFIX_RE = /\s*\bNOS\b\.?\s*$/i;

  function looksOutdated(description) {
    var d = String(description == null ? '' : description);
    return LEGACY_PREFIX_RE.test(d) || LEGACY_SUFFIX_RE.test(d);
  }

  // Strips the legacy prefix/suffix to build search query text — e.g.
  // "[X]Attention deficit disorder" -> "Attention deficit disorder",
  // "Fracture of radius NOS" -> "Fracture of radius".
  function stripLegacyMarkers(description) {
    return String(description == null ? '' : description)
      .replace(LEGACY_PREFIX_RE, '')
      .replace(LEGACY_SUFFIX_RE, '')
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
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSLegacyCodedDescription = api;
  }
})(typeof window !== 'undefined' ? window : global);
