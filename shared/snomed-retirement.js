// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared SNOMED CT concept-retirement parsing, generic across
// EVERY kind of SNOMED-coded entry (problems, and eventually
// procedures/referrals/journal entries, …) — not specific to problems. Same
// split as shared/legacy-coded-description.js: this file owns the
// entity-agnostic parsing of a termbrowser concept response; the actual
// "which entity types get checked, when, and what happens with the result"
// lives in the content script that uses it (content-scripts/
// problem-description-cleanup.js).
//
// DATA SOURCE (confirmed live 2026-07-25, two real examples — see chat
// history, not guessed): the public, no-auth NHS SNOMED CT UK-edition
// termbrowser API (rules/snomed-terminology-server.json holds the
// baseUrl/edition/release config — see that file's own notes for why THIS
// API, not the official NHS England Terminology Server FHIR API, which
// requires a system-to-system account that can't be safely embedded in a
// distributed browser extension).
//
//   GET {baseUrl}/{edition}/v{release}/concepts/{conceptId}
//     -> { active: boolean, memberships: [...], relationships: [...], fsn,
//          conceptId, defaultTerm, effectiveTime, ... }
//
// Two real concepts captured live to derive this parsing, both confirmed via
// the termbrowser UI's own red "inactive" highlighting before being treated
// as ground truth:
//   - 184063008 "Patient signed registration form" — active:false, a
//     memberships[] entry with type "ATTRIBUTE_VALUE" and
//     refset.conceptId "900000000000489007" ("Concept inactivation
//     indicator attribute value reference set") whose cidValue is
//     723277005 "Nonconformance to editorial policy component" — the
//     INACTIVATION REASON. No ASSOCIATION-type membership pointing to a
//     replacement concept at all.
//   - 398307005 "Low cervical caesarean section" (LSCS) — active:false,
//     the SAME inactivation-indicator membership shape (reason
//     900000000000483008 "Outdated component"), PLUS a memberships[] entry
//     with type "ASSOCIATION" and refset.conceptId "900000000000526001"
//     ("REPLACED BY association reference set") whose cidValue is
//     788180009 "Lower uterine segment cesarean section (procedure)" — the
//     REPLACEMENT concept. Matches this file's own docs/learnings-
//     problem-description-cleanup.md note that 398307005 is retired with
//     788180009 as its active successor, now independently confirmed via
//     this live API rather than only the SNOMED CT browser UI.
//
// CONFUSABLE, EXPLICITLY EXCLUDED: both real examples ALSO carry a
// memberships[] entry with type "ASSOCIATION" and refset.conceptId
// "1322291000000109" ("National Health Service Care Record Element
// association reference set") — an NHS care-record CLASSIFICATION tag,
// completely unrelated to retirement/replacement. Only refset.conceptId
// "900000000000526001" is treated as a genuine replacement pointer here.
//
// ONLY "REPLACED BY" IS IMPLEMENTED (deliberate scope limit, 2026-07-25):
// SNOMED's historical-association family also includes SAME AS, POSSIBLY
// EQUIVALENT TO, MOVED TO, WAS A, and others, each with their own refset
// conceptId — none of those have been seen in a live capture yet, so their
// IDs are NOT hardcoded here rather than guessed (this codebase's standing
// rule: never hardcode a SNOMED metadata ID without live confirmation — see
// rules/non-problem-root-codes.json's own history for why). Extend
// REPLACEMENT_REFSET_IDS only after confirming a real example the same way
// 900000000000526001 was confirmed via 398307005 above.
'use strict';

(function (global) {
  var INACTIVATION_REASON_REFSET_ID = '900000000000489007';
  var REPLACEMENT_REFSET_IDS = ['900000000000526001']; // REPLACED BY only — see header comment

  // Parses ONE termbrowser concept response into {active, inactivationReason,
  // replacement}. Fails closed to `active: null` ("unknown, not confirmed
  // either way") on anything that isn't a proper concept object — including
  // the literal `false` this API returns for an unrecognised release/edition
  // path, confirmed live 2026-07-25 — NEVER guesses active or inactive when
  // the response itself is unusable. Callers must treat `active: null` as
  // "skip this concept", not as evidence of anything.
  function parseConceptRetirement(conceptResponse) {
    if (!conceptResponse || typeof conceptResponse !== 'object' || typeof conceptResponse.active !== 'boolean') {
      return { active: null, inactivationReason: null, replacement: null };
    }
    var active = conceptResponse.active;
    if (active) {
      return { active: true, inactivationReason: null, replacement: null };
    }
    var memberships = Array.isArray(conceptResponse.memberships) ? conceptResponse.memberships : [];
    var inactivationReason = null;
    var replacement = null;
    memberships.forEach(function (m) {
      if (!m || !m.refset || !m.cidValue) return;
      var refsetId = m.refset.conceptId;
      if (m.type === 'ATTRIBUTE_VALUE' && refsetId === INACTIVATION_REASON_REFSET_ID && !inactivationReason) {
        inactivationReason = { conceptId: m.cidValue.conceptId, description: m.cidValue.defaultTerm };
      }
      if (m.type === 'ASSOCIATION' && REPLACEMENT_REFSET_IDS.indexOf(refsetId) !== -1 && !replacement) {
        replacement = { conceptId: m.cidValue.conceptId, description: m.cidValue.defaultTerm };
      }
    });
    return { active: false, inactivationReason: inactivationReason, replacement: replacement };
  }

  // Builds the full concept-lookup URL from rules/snomed-terminology-server.json's
  // config shape ({baseUrl, edition, release}). Returns null (never throws)
  // if the config is malformed, so a broken/missing config file fails the
  // same "unknown, skip" way as an unparseable response, not a crash.
  function buildConceptUrl(config, conceptId) {
    if (!config || !config.baseUrl || !config.edition || !config.release || !conceptId) return null;
    return config.baseUrl + '/' + config.edition + '/' + config.release + '/concepts/' + encodeURIComponent(conceptId);
  }

  var api = {
    INACTIVATION_REASON_REFSET_ID: INACTIVATION_REASON_REFSET_ID,
    REPLACEMENT_REFSET_IDS: REPLACEMENT_REFSET_IDS,
    parseConceptRetirement: parseConceptRetirement,
    buildConceptUrl: buildConceptUrl,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSSnomedRetirement = api;
  }
})(typeof window !== 'undefined' ? window : global);
