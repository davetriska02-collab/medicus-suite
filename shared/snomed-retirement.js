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
// "REPLACED BY" and "POSSIBLY EQUIVALENT TO" are implemented (the latter
// added 2026-07-26, confirmed live via a real example: 69878008 "Polycystic
// ovaries (disorder)", inactivation reason "Ambiguous component", with TWO
// POSSIBLY EQUIVALENT TO memberships — 237055002 "Polycystic ovary syndrome"
// (the disease) and 781067001 "Polycystic ovary" (a structural/anatomical
// finding). SNOMED's historical-association family also includes SAME AS,
// MOVED TO, WAS A, and others, each with their own refset conceptId —
// undiscovered ones are NOT hardcoded here rather than guessed (this
// codebase's standing rule: never hardcode a SNOMED metadata ID without live
// confirmation — see rules/non-problem-root-codes.json's own history for
// why). Extend either list only after confirming a real example the same
// way these were.
//
// "SAME AS" folded into REPLACEMENT_REFSET_IDS 2026-07-29 (confirmed live via
// the public termbrowser API — real example: 176187002 "Flexible check
// cystoscopy (procedure)", inactivation reason "Duplicate component"
// (900000000000482003), a genuine ASSOCIATION membership on refset
// "900000000000527005" ("SAME AS association reference set") pointing to
// 301301002 "Flexible cystoscopy (procedure)" — the same real gap this
// comment predicted above, motivated by a clinician's "Clean up code" widget
// showing nothing for this problem at all: `176187002` looksOutdated()-fails
// (no bracket/NOS/NEC/H-O marker), so it only ever reaches the retirement
// check, which used to find isRetired:true but replacement:null since SAME
// AS wasn't in REPLACEMENT_REFSET_IDS — landing on the "no automatic
// replacement is recorded" copy despite SNOMED actually naming one. Treated
// as equal-confidence to REPLACED BY, not folded into possiblyEquivalentTo/
// partiallyEquivalentTo: "duplicate component" + "SAME AS" together assert
// these are literally the same clinical concept filed twice, not a hedge
// between several candidates or a meaning split across them — the single-
// `replacement` field's existing "first confirmed successor wins" semantics
// already fit this exactly, which is why REPLACEMENT_REFSET_IDS was kept as
// an array from the start (see 398307005's own history).
//
// POSSIBLY EQUIVALENT TO is DELIBERATELY kept separate from REPLACED BY, not
// folded into the same `replacement` field, for two reasons confirmed by the
// 69878008 example itself: (1) SNOMED's own wording is a genuine hedge, not
// a confident successor pointer — the source concept's own inactivation
// reason was literally "Ambiguous component"; (2) a concept can have
// MULTIPLE possibly-equivalent candidates with materially different clinical
// meaning (here: an actual disease vs. an incidental structural finding) —
// collapsing to "just pick one" would silently drop a real, different-meaning
// candidate. Callers must treat this as a lower-confidence, always
// multi-candidate signal, distinct from the single high-confidence
// `replacement`.
//
// "PARTIALLY EQUIVALENT TO" added 2026-07-27, confirmed live via a real
// example: 199317008 "Twin pregnancy - delivered (finding)", inactivation
// reason "Classification derived component", with TWO PARTIALLY EQUIVALENT
// TO memberships — 65147003 "Twin pregnancy (finding)" and 289256000 "Mother
// delivered (finding)". Unlike POSSIBLY EQUIVALENT TO (a hedge — pick
// whichever ONE candidate actually applies), PARTIALLY EQUIVALENT TO means
// the retired concept's meaning was SPLIT: the two candidates together
// (not either alone) reconstruct what the retired concept meant. Kept as its
// own `partiallyEquivalentTo` field, not merged into `possiblyEquivalentTo`,
// so callers can word the UI correctly ("this concept's meaning maps across
// several codes" vs "pick whichever of these is really meant") — same
// multi-candidate, lower-confidence-than-`replacement` shape either way.
'use strict';

(function (global) {
  var INACTIVATION_REASON_REFSET_ID = '900000000000489007';
  var REPLACEMENT_REFSET_IDS = ['900000000000526001', '900000000000527005']; // REPLACED BY, SAME AS — see header comment
  var POSSIBLY_EQUIVALENT_REFSET_IDS = ['900000000000523009']; // POSSIBLY EQUIVALENT TO only — see header comment
  var PARTIALLY_EQUIVALENT_REFSET_IDS = ['1186924009']; // PARTIALLY EQUIVALENT TO only — see header comment

  // Parses ONE termbrowser concept response into {active, inactivationReason,
  // replacement, possiblyEquivalentTo}. Fails closed to `active: null`
  // ("unknown, not confirmed either way") on anything that isn't a proper
  // concept object — including the literal `false` this API returns for an
  // unrecognised release/edition path, confirmed live 2026-07-25 — NEVER
  // guesses active or inactive when the response itself is unusable. Callers
  // must treat `active: null` as "skip this concept", not as evidence of
  // anything.
  function parseConceptRetirement(conceptResponse) {
    if (!conceptResponse || typeof conceptResponse !== 'object' || typeof conceptResponse.active !== 'boolean') {
      return {
        active: null,
        inactivationReason: null,
        replacement: null,
        possiblyEquivalentTo: [],
        partiallyEquivalentTo: [],
      };
    }
    var active = conceptResponse.active;
    if (active) {
      return {
        active: true,
        inactivationReason: null,
        replacement: null,
        possiblyEquivalentTo: [],
        partiallyEquivalentTo: [],
      };
    }
    var memberships = Array.isArray(conceptResponse.memberships) ? conceptResponse.memberships : [];
    var inactivationReason = null;
    var replacement = null;
    var possiblyEquivalentTo = [];
    var partiallyEquivalentTo = [];
    memberships.forEach(function (m) {
      if (!m || !m.refset || !m.cidValue) return;
      var refsetId = m.refset.conceptId;
      if (m.type === 'ATTRIBUTE_VALUE' && refsetId === INACTIVATION_REASON_REFSET_ID && !inactivationReason) {
        inactivationReason = { conceptId: m.cidValue.conceptId, description: m.cidValue.defaultTerm };
      }
      if (m.type === 'ASSOCIATION' && REPLACEMENT_REFSET_IDS.indexOf(refsetId) !== -1 && !replacement) {
        replacement = { conceptId: m.cidValue.conceptId, description: m.cidValue.defaultTerm };
      }
      // Multiple candidates are expected and kept, unlike `replacement`
      // above — see header comment. Deduped by conceptId in case the same
      // candidate is somehow referenced by more than one membership.
      if (m.type === 'ASSOCIATION' && POSSIBLY_EQUIVALENT_REFSET_IDS.indexOf(refsetId) !== -1) {
        var alreadyListedPossible = possiblyEquivalentTo.some(function (c) {
          return c.conceptId === m.cidValue.conceptId;
        });
        if (!alreadyListedPossible) {
          possiblyEquivalentTo.push({ conceptId: m.cidValue.conceptId, description: m.cidValue.defaultTerm });
        }
      }
      // Same multi-candidate/deduped shape as possiblyEquivalentTo above, but
      // a DIFFERENT refset (PARTIALLY, not POSSIBLY) — see header comment for
      // why these are never merged into one list.
      if (m.type === 'ASSOCIATION' && PARTIALLY_EQUIVALENT_REFSET_IDS.indexOf(refsetId) !== -1) {
        var alreadyListedPartial = partiallyEquivalentTo.some(function (c) {
          return c.conceptId === m.cidValue.conceptId;
        });
        if (!alreadyListedPartial) {
          partiallyEquivalentTo.push({ conceptId: m.cidValue.conceptId, description: m.cidValue.defaultTerm });
        }
      }
    });
    return {
      active: false,
      inactivationReason: inactivationReason,
      replacement: replacement,
      possiblyEquivalentTo: possiblyEquivalentTo,
      partiallyEquivalentTo: partiallyEquivalentTo,
    };
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
    POSSIBLY_EQUIVALENT_REFSET_IDS: POSSIBLY_EQUIVALENT_REFSET_IDS,
    PARTIALLY_EQUIVALENT_REFSET_IDS: PARTIALLY_EQUIVALENT_REFSET_IDS,
    parseConceptRetirement: parseConceptRetirement,
    buildConceptUrl: buildConceptUrl,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MSSnomedRetirement = api;
  }
})(typeof window !== 'undefined' ? window : global);
