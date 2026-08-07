// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Clean up allergies?" widget: unifies what used to be two
// separate content scripts, allergy-junk-code-cleanup.js ("Bulk remove?")
// and allergy-duplicate-merge.js ("N possible duplicates — Review?"), into
// one shared scan + one trigger. Explicit 2026-08-02 decision, reversing the
// v3.205.0 changelog's own stated rationale ("deliberately split into two
// separate content scripts... not one generic clean up allergies tool") —
// see CHANGELOG.md for why. Substance-conversion (pre-defined-allergy code
// -> DMD substance) and synonym-based duplicate detection are BOTH planned
// as later stages, not part of this build — see
// [[project-allergy-cleanup]]/[[project-allergy-substance-conversion-har]].
//
// WHY ONE FILE, ONE SCAN: both source widgets independently fetched
// overview-allergy for every active allergy — junk-code-cleanup to read
// conceptId, duplicate-merge to read conceptId AND the five mergeable
// clinical fields. Same fetch, two callers. Here it's fetched once; junk
// matching and duplicate grouping are both derived from the same batch.
//
// DETECTION MODEL (explicit 2026-08-02 decision, AskUserQuestion): a FREE
// page-load hint, then a click-triggered full scan — not fully opt-in like
// problem-description-cleanup.js's "Check for retired/legacy codes?", to
// preserve duplicate-merge's old proactive-visibility behaviour:
//   - On page load: only the cheap clinical-summary/summary list is
//     fetched (unchanged), plus the FREE text-only duplicate grouping
//     (groupDuplicateAllergies — no API calls beyond the list itself). If
//     that finds anything, the trigger button's own label shows the count:
//     "Clean up allergies (2 possible duplicates)?" — never a separate
//     badge element, just the button text, same single-affordance
//     discipline as every other trigger in this file family.
//   - On click: the FULL scan runs — overview-allergy per active allergy
//     (junk matching + the five mergeable fields), then concept-ancestry
//     duplicate enrichment backgrounded exactly like the old pass 2. Junk
//     removal is a bulk checklist (no clinical judgement needed to remove
//     confirmed import noise); duplicate merge stays a mandatory per-group
//     modal review (a merge always "warrants a conscious clinical
//     decision" — same reasoning the old file stated explicitly, still
//     true, not revisited here).
//
// PLACEMENT — deliberate simplification vs the old duplicate-merge file:
// the old file injected one small trigger widget PER duplicate group,
// inline just above that group's own first row, and maintained fragile
// non-destructive multi-widget bookkeeping across rescans (three real bugs
// were found and fixed live doing this — see [[project-allergy-cleanup]]).
// This file injects exactly ONE widget, at the same anchor position
// junk-code-cleanup used (just above the first allergy row) — the summary
// panel underneath lists every duplicate group as a line within the SAME
// widget, not as separate DOM nodes scattered through the list. This
// collapses "N widgets to keep synced with N groups on every rescan" down
// to "one widget, replaced by reference every render" — the multi-widget
// bug class this file's predecessor hit twice cannot recur here.
//
// CONFIRMED CONTRACT (live HAR captures, 2026-07-29/30 — unchanged, see the
// retired files' own header comments in git history for the full capture
// list): clinical-summary/summary's allergies[] is
// {id, allergyCodeDescription, isDraft}, ACTIVE-only; overview-allergy
// returns {allergyCode|substance, allergyReactions, severity, certainty,
// additionalInformation, onsetDate (UK display string), recordDate, ...};
// end-allergy POST is {allergyId, endDate, reasonEnded} with NO
// organisation field, never blocked by the blank-organisation lock;
// change-allergy POST is a full-replace of edit-allergy's own prefill
// shape, branching on recordedAtAnotherOrganisation exactly like problems'
// own edit-problem payload.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────
  // Single copies of everything that used to be duplicated across both
  // retired files — see this file's header comment for why that dedupe is
  // safe now (this is genuinely one widget, not two independent ones
  // sharing a convention).

  var MERGE_REASON_ENDED =
    'Multiple allergy entries for same allergen - merged into single entry for clarity and to reduce dangerous / distracting clutter on clinical record';

  var UNKNOWN_ORGANISATION = {
    organisationName: 'Unknown',
    organisationIdentifierType: null,
    organisationIdentifierValue: null,
  };

  var MERGEABLE_FIELDS = ['severity', 'certainty', 'additionalInformation', 'allergyReactions', 'onsetDate'];

  // Matched by EXACT conceptId only — both confirmed junk codes are
  // single, self-contained SNOMED concepts, not broad admin-code
  // categories with real descendants worth a hierarchy search (unlike
  // problem-junk-code-cleanup.js's admin-root-code matching). See
  // rules/allergy-junk-codes.json's own notes for the full reasoning.
  function findJunkCodeEntry(conceptId, junkCodes) {
    if (!conceptId) return null;
    return (
      (Array.isArray(junkCodes) ? junkCodes : []).find(function (c) {
        return c && c.conceptId === conceptId;
      }) || null
    );
  }

  // Usually exactly one of allergyCode/substance is populated on a real
  // overview-allergy response — but NOT always: confirmed live 2026-08-02
  // (HAR46) a GP2GP-imported entry can carry BOTH simultaneously (a legacy
  // pre-defined-allergy code sitting alongside an already-populated,
  // already-authoritative substance — "ALLERGY PENICILLIN" 292954005
  // alongside substance "Penicillin V 250mg capsule",
  // allergyCodeType:"substances"). `allergyCodeType` says which one Medicus
  // actually treats as current, so defer to it when both are present rather
  // than blindly preferring allergyCode just because it happens to be
  // truthy — the old behaviour silently returned the STALE legacy code for
  // an entry like this, which would have broken junk-matching and
  // duplicate-grouping against its real current substance. Falls back to
  // "whichever is populated" when allergyCodeType doesn't disambiguate
  // (e.g. missing from an older/thinner overview shape).
  function resolveAllergyConceptId(overview) {
    if (!overview) return null;
    var codeId = overview.allergyCode && overview.allergyCode.conceptId;
    var substanceId = overview.substance && overview.substance.conceptId;
    if (overview.allergyCodeType === 'substances' && substanceId) return String(substanceId);
    if (overview.allergyCodeType === 'pre-defined-allergies' && codeId) return String(codeId);
    if (codeId) return String(codeId);
    if (substanceId) return String(substanceId);
    return null;
  }

  // True when BOTH allergyCode AND substance are populated on the same
  // overview-allergy response — the dual-coded case resolveAllergyConceptId's
  // own comment describes. A real, live, non-hypothetical state (HAR46),
  // not a defensive guess.
  function hasBothCodeTypes(overview) {
    return !!(
      overview &&
      overview.allergyCode &&
      overview.allergyCode.conceptId &&
      overview.substance &&
      overview.substance.conceptId
    );
  }

  // Classifies dual-coded entries for the bulk "legacy code alongside
  // substance" cleanup — same bulk-checklist safety class as junk removal
  // (not a per-entry modal like duplicate-merge/conversion): clearing the
  // NON-authoritative code field never touches any clinical fact
  // (severity/certainty/reactions/additionalInformation) or the
  // already-correct substance, so there's no clinical judgement call to
  // make per entry, unlike ending an allergy outright or merging two
  // different records. `excludeIds` is the SAME junk-flagged set
  // classifyConvertibleEntries also excludes on — an entry already
  // junk-matched only ever gets the removal offer, never a second,
  // unrelated cleanup offer on the same row.
  function classifyDualCodedEntries(candidates, overviewsById, excludeIds) {
    var exclude = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
    var flagged = [];
    (Array.isArray(candidates) ? candidates : []).forEach(function (a) {
      if (exclude.has(a.id)) return;
      var overview = (overviewsById && overviewsById[a.id]) || null;
      if (!hasBothCodeTypes(overview)) return;
      // ONLY the live-observed direction (HAR46): substance is authoritative,
      // legacy allergyCode is the stale field. The checklist UI promises the
      // substance is never touched, so a dual-coded entry whose authoritative
      // side is 'pre-defined-allergies' (or unknown) must NOT be offered
      // here — clearing ITS stale field would delete the substance, the exact
      // opposite of what the section says it does. A pre-defined-authoritative
      // entry falls through to classifyConvertibleEntries instead, where the
      // reviewed conversion flow handles it with a per-entry modal.
      if (overview.allergyCodeType !== 'substances') return;
      flagged.push({
        id: a.id,
        description: a.allergyCodeDescription,
        legacyCode: { conceptId: overview.allergyCode.conceptId, description: overview.allergyCode.description },
        substance: { conceptId: overview.substance.conceptId, description: overview.substance.description },
        authoritative: overview.allergyCodeType || null,
      });
    });
    return flagged;
  }

  function buildEndAllergyPayload(allergyId, endDate, reasonEnded) {
    return { allergyId: allergyId, endDate: endDate, reasonEnded: reasonEnded || null };
  }

  // A flagged junk entry is safe to bulk-end when it hasn't already been
  // ended this session AND isn't cautioned (see buildCautionMessage below).
  function isEndable(entry) {
    return !!entry && !entry.ended;
  }

  function normalizeAllergyDescription(desc) {
    return String(desc == null ? '' : desc)
      .trim()
      .toLowerCase();
  }

  // Narrows clinical-summary/summary's allergies[] to entries worth
  // checking — excludes isDraft entries defensively (never observed true
  // live so far, but a draft isn't yet a finalised clinical entry and
  // shouldn't be bulk-acted-on sight-unseen).
  function activeNonDraftAllergies(allergies) {
    return (Array.isArray(allergies) ? allergies : []).filter(function (a) {
      return a && a.id && !a.isDraft;
    });
  }

  // allergyReactions is an array of {conceptId, description, descriptionId}
  // on a real overview-allergy response — pulled into its own helper since
  // both buildCautionMessage and the junk-row display need the same "list
  // of reaction description strings".
  function reactionDescriptions(overview) {
    var reactions = overview && overview.allergyReactions;
    if (!Array.isArray(reactions)) return [];
    return reactions
      .map(function (r) {
        return r && r.description;
      })
      .filter(Boolean);
  }

  // CAUTION SIGNAL: both confirmed junk codes are structurally meaningless
  // to carry clinical detail against — "No known allergies" with a
  // recorded severity/certainty is nonsensical on its face — so if
  // additionalInformation, severity, certainty, OR a coded reaction IS
  // populated on a flagged entry, that's a strong sign a clinician used
  // this generic/junk code to record a REAL allergy, and it must never be
  // silently bulk-ended alongside genuine import noise. A property of the
  // INSTANCE, not the code — computed per-entry from overview-allergy, not
  // from the rules file. Returns null (no caution) when nothing is
  // populated, or a human-readable message naming which field(s) triggered
  // it — never a bare boolean.
  function buildCautionMessage(overview) {
    if (!overview) return null;
    var parts = [];
    if (overview.severity) parts.push('severity: ' + overview.severity);
    if (overview.certainty) parts.push('certainty: ' + overview.certainty);
    if (overview.additionalInformation && String(overview.additionalInformation).trim()) {
      parts.push('additional info recorded');
    }
    var reactions = reactionDescriptions(overview);
    if (reactions.length) parts.push('reaction: ' + reactions.join(', '));
    if (!parts.length) return null;
    return (
      'This entry has clinical detail recorded (' +
      parts.join(', ') +
      ') — may be a genuine allergy filed under this code, not import noise. Review before removing.'
    );
  }

  // Combines the two DIFFERENT caution signals a flagged junk entry can
  // carry: a per-INSTANCE one (buildCautionMessage, computed from THIS
  // patient's own clinical detail — its wording is specifically about the
  // "too-generic" category, where the code itself is ambiguous and clinical
  // detail might reveal a hidden real allergy) and a per-CODE static one
  // (junkEntry.caution, e.g. rules/allergy-junk-codes.json's
  // "low-prescribing-relevance" category — ALWAYS shown for every instance
  // of that code, regardless of what clinical detail is or isn't attached).
  // A per-CODE caution WINS outright, never concatenated with the
  // per-instance one — found live 2026-08-02: for a low-prescribing-relevance
  // code (e.g. "Allergy to pollen"), buildCautionMessage's "may be a genuine
  // allergy filed under this code, not import noise" framing is actively
  // WRONG (we already know it's a genuine, precisely-coded allergy — the
  // issue is relevance, not authenticity), and it duplicated the row's own
  // separately-rendered clinicalDetailHtml line to boot. The per-instance
  // message only ever fires when a code has NO static caution of its own
  // (the original too-generic use case, unchanged).
  function combinedCaution(junkEntry, overview) {
    var codeCaution = (junkEntry && junkEntry.caution) || null;
    if (codeCaution) return codeCaution;
    return buildCautionMessage(overview);
  }

  // Classifies the active/non-draft candidates against the junk-code rules
  // file, given an already-fetched {allergyId: overview} map (the shared
  // scan's own batch — no fetching happens here, pure classification only).
  // Returns UI-state-free flagged entries; the browser-boot layer adds
  // checked/ended/endError/anchorEl on top.
  function classifyJunkEntries(candidates, overviewsById, junkCodes) {
    var flagged = [];
    (Array.isArray(candidates) ? candidates : []).forEach(function (a) {
      var overview = (overviewsById && overviewsById[a.id]) || null;
      var conceptId = resolveAllergyConceptId(overview);
      var junkEntry = findJunkCodeEntry(conceptId, junkCodes);
      if (!junkEntry) return;
      flagged.push({
        id: a.id,
        description: a.allergyCodeDescription,
        conceptId: conceptId,
        reasonEnded: junkEntry.reasonEnded || null,
        additionalInformation: (overview && overview.additionalInformation) || null,
        severity: (overview && overview.severity) || null,
        certainty: (overview && overview.certainty) || null,
        reactions: reactionDescriptions(overview),
        caution: combinedCaution(junkEntry, overview),
      });
    });
    return flagged;
  }

  // Matched by EXACT conceptId only, same discipline as findJunkCodeEntry —
  // rules/allergy-substance-conversion.json is reviewed output, not a
  // hierarchy/descendant search target.
  function findConversionRule(conceptId, conversionRules) {
    if (!conceptId) return null;
    return (
      (Array.isArray(conversionRules) ? conversionRules : []).find(function (r) {
        return r && r.conceptId === conceptId;
      }) || null
    );
  }

  // Classifies the active/non-draft candidates for conversion eligibility,
  // given the SAME already-fetched {allergyId: overview} batch
  // classifyJunkEntries uses — no separate fetch pass. Flags any entry whose
  // overview has `allergyCodeType === 'pre-defined-allergies'`, EXCLUDING
  // anything already matched as junk (`junkFlaggedIds`) — a junk-matched
  // code should only ever offer removal, never also a conversion suggestion.
  // `rule` is null when the conceptId isn't in
  // rules/allergy-substance-conversion.json at all (falls to manual search
  // only, no pre-filled suggestion — this is the expected, common case for
  // any pre-defined-allergy code outside the reviewed 314-concept sweep,
  // e.g. "Amoxicillin allergy") or the matched rule object otherwise
  // (`kind: "substance" | "substance-plus-reaction" | "not-convertible" |
  // "not-an-allergy"` — see that file's own notes for what each means; the
  // render layer decides what's actionable per kind, this function just
  // classifies).
  function classifyConvertibleEntries(candidates, overviewsById, conversionRules, junkFlaggedIds) {
    var junkIds = junkFlaggedIds instanceof Set ? junkFlaggedIds : new Set(junkFlaggedIds || []);
    var flagged = [];
    (Array.isArray(candidates) ? candidates : []).forEach(function (a) {
      if (junkIds.has(a.id)) return;
      var overview = (overviewsById && overviewsById[a.id]) || null;
      if (!overview || overview.allergyCodeType !== 'pre-defined-allergies') return;
      var conceptId = resolveAllergyConceptId(overview);
      flagged.push({
        id: a.id,
        description: a.allergyCodeDescription,
        conceptId: conceptId,
        rule: findConversionRule(conceptId, conversionRules),
      });
    });
    return flagged;
  }

  // Normalizes a raw SNOMED constrained-search `results[]` array (shared
  // shape for both the substance search — constrainingRefsets=30931000001101
  // — and the reaction search — constrainingParentConcepts=404684003, the
  // same root HAR42 confirmed live for reaction picking) into
  // {description, conceptId, descriptionId} — same normalization discipline
  // as problem-description-cleanup.js's own normalizedSearchResults, deduped
  // by descriptionId (falling back to conceptId+description).
  function normalizedConceptSearchResults(results) {
    var seen = new Set();
    var out = [];
    (Array.isArray(results) ? results : []).forEach(function (r) {
      var v = r && r.value;
      if (!v || !v.conceptId) return;
      var key = v.descriptionId || v.conceptId + '|' + v.description;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        description: v.description,
        conceptId: String(v.conceptId),
        descriptionId: v.descriptionId || null,
        // Carried through from outputParentConceptIds=1 (already part of
        // SUBSTANCE_SEARCH_PATH) — no extra API call needed for
        // rankSubstanceResults below to use it.
        parentConceptIds: Array.isArray(v.parentConceptIds) ? v.parentConceptIds.map(String) : [],
      });
    });
    return out;
  }

  // A description that looks dose/form/brand-specific (a strength, a pack
  // size, a manufacturer in parentheses, "dose form" wording) marks a VMP/AMP
  // -level product, not a VTM — same filter already proven offline against
  // the full 169-term substance sweep during the CSV review that produced
  // rules/allergy-substance-conversion.json.
  var DOSE_OR_BRAND_RE =
    /\d|%|\b(mg|mcg|microgram|ml|tablet|capsule|solution|injection|suspension|cream|ointment|patch|inhaler|vial|pack|device|dose form)\b|\(.*(?:ltd|pharma|healthcare)/i;

  // Re-ranks live substance-search results toward the VTM-level candidate,
  // WITHOUT discarding any result — this only reorders what's shown, the
  // clinician can still see and pick anything. Found live 2026-08-02: a
  // "iodine" search returned the correct VTM-ish candidate, just not
  // FIRST, buried among salt/dose-specific siblings the clinician had to
  // scroll past. Reuses the exact heuristic already validated offline
  // against the 169-term substance sweep during the CSV review (see
  // [[project-allergy-substance-conversion-har]]) — an ancestor-of-siblings
  // candidate (per parentConceptIds, already present via
  // outputParentConceptIds=1, no extra fetch) whose own name doesn't look
  // dose/form/brand-specific is the best VTM guess; an exact name match to
  // the query is the next strongest signal; a "77"-prefixed conceptId is a
  // weak bonus signal only (confirmed NOT universal — e.g. Tirzepatide has
  // none — never used alone).
  function rankSubstanceResults(results, queryText) {
    var list = Array.isArray(results) ? results : [];
    var q = String(queryText == null ? '' : queryText)
      .trim()
      .toLowerCase();
    function isAncestorOfSibling(r) {
      return list.some(function (other) {
        return other !== r && other.parentConceptIds.indexOf(r.conceptId) !== -1;
      });
    }
    function score(r) {
      var s = 0;
      if (r.description && r.description.trim().toLowerCase() === q) s += 100;
      if (!DOSE_OR_BRAND_RE.test(r.description || '')) s += 40;
      if (isAncestorOfSibling(r)) s += 20;
      if (/^77/.test(r.conceptId)) s += 5;
      return s;
    }
    return list
      .map(function (r, i) {
        return { r: r, i: i, s: score(r) };
      })
      .sort(function (a, b) {
        return b.s - a.s || a.i - b.i;
      })
      .map(function (x) {
        return x.r;
      });
  }

  // Extracts a probable {substanceHint, reactionHint} pair from a legacy
  // code's OWN description text — used ONLY to pre-fill the search boxes'
  // query text for conversion-eligible entries with NO rules-file match
  // (rules/allergy-substance-conversion.json's reviewed 314-concept sweep is
  // necessarily incomplete — found live 2026-08-02: "Elastoplast contact
  // dermatitis", "Adverse reaction to iodine", "Cat allergy", "Shellfish
  // allergy" all fall outside it). NEVER auto-selects a conceptId — the
  // clinician still has to run the search and pick a real result
  // themselves, same discipline as every other search box in this file;
  // this only saves them from having to retype/edit the FULL raw
  // description as their starting query. Deliberately reuses the same small
  // set of structural templates already characterised (by hand, against
  // real examples) in the adverse-reaction-decomposition.csv review this
  // reviewed rules file was built from — not a new invented heuristic, the
  // same one just applied live instead of only to the pre-reviewed set:
  //   - "<X>-induced <Y>" -> substance X, reaction Y (e.g. "Allopurinol-induced DRESS syndrome")
  //   - "Allergy/Hypersensitivity/Adverse reaction to <X>" -> substance X, no reaction
  //   - "<X> allergy/hypersensitivity/(allergic )reaction" -> substance X, no reaction
  //   - anything else with 2+ words -> first word is the substance guess, the
  //     rest is the reaction guess (e.g. "Elastoplast contact dermatitis",
  //     "Chloroquine retinopathy" -- this last one matches the real reviewed
  //     answer for that exact code, a good sign the guess is reasonable) —
  //     the LEAST confident branch, since a genuinely drug-less code (e.g.
  //     "Reaction to spinal puncture") produces a nonsensical substance
  //     guess too; harmless because it only ever pre-fills an editable
  //     search box, never anything applied.
  function extractAllergenAndReactionHint(description) {
    var text = String(description == null ? '' : description).trim();
    if (!text) return { substanceHint: '', reactionHint: null };

    var m = /^(.+?)-induced\s+(.+)$/i.exec(text);
    if (m) return { substanceHint: m[1].trim(), reactionHint: m[2].trim() };

    m = /^(?:Allergy|Hypersensitivity|Adverse reaction)\s+to\s+(.+)$/i.exec(text);
    if (m) return { substanceHint: m[1].trim(), reactionHint: null };

    m = /^(.+?)\s+(?:allergic reaction|adverse reaction|hypersensitivity|allergy|reaction)$/i.exec(text);
    if (m) return { substanceHint: m[1].trim(), reactionHint: null };

    var words = text.split(/\s+/);
    if (words.length >= 2) {
      return { substanceHint: words[0], reactionHint: words.slice(1).join(' ') };
    }
    return { substanceHint: text, reactionHint: null };
  }

  // Priority order for what pre-fills the reaction search box: a curated
  // rules-file hint (Nick-reviewed, most authoritative) beats a pattern-
  // extracted one (from the code's own description text) beats the
  // patient's own additionalInformation free text (found live 2026-08-02:
  // "Adverse reaction to iodine" has no specific reaction in either the
  // rules file or the code text, but additionalInformation literally said
  // "shivering" — seeding the box with it, even unparsed, is strictly
  // better than leaving it blank and making the clinician retype what's
  // already on screen). Always just a search SEED, never a pre-selected
  // result — same discipline as extractAllergenAndReactionHint above.
  function pickReactionSeed(ruleReactionText, patternReactionHint, additionalInformation) {
    if (ruleReactionText && String(ruleReactionText).trim()) return String(ruleReactionText).trim();
    if (patternReactionHint && String(patternReactionHint).trim()) return String(patternReactionHint).trim();
    if (additionalInformation && String(additionalInformation).trim()) return String(additionalInformation).trim();
    return '';
  }

  // Groups the cheap allergies[] list by exact (trimmed, case-insensitive)
  // description text. Returns only groups of 2+. The FREE page-load pass —
  // no fetches, degenerate case of groupRelatedAllergies below with an
  // empty concept map.
  function groupDuplicateAllergies(allergies) {
    var candidates = activeNonDraftAllergies(allergies);
    var order = [];
    var byKey = Object.create(null);
    candidates.forEach(function (a) {
      var key = normalizeAllergyDescription(a.allergyCodeDescription);
      if (!key) return;
      if (!byKey[key]) {
        byKey[key] = [];
        order.push(key);
      }
      byKey[key].push(a);
    });
    return order
      .map(function (key) {
        return byKey[key];
      })
      .filter(function (group) {
        return group.length >= 2;
      });
  }

  // True when two SNOMED concepts represent the SAME underlying allergen in
  // a strict lineage sense — identical conceptId, or one is a genuine
  // ancestor of the other. Deliberately NOT "shares any ancestor somewhere
  // in the tree" — that would over-group unrelated allergies sitting under
  // the same broad category (real investigation: "Allergy to Arachis oil"
  // sits under a completely separate hierarchy from "Allergy to peanut"
  // despite both being food allergies — refined peanut oil often lacks the
  // allergenic protein, so they are NOT clinically the same, and this
  // check correctly leaves them ungrouped).
  function isSameAllergenConcept(conceptIdA, ancestorsA, conceptIdB, ancestorsB) {
    if (!conceptIdA || !conceptIdB) return false;
    if (conceptIdA === conceptIdB) return true;
    if (Array.isArray(ancestorsB) && ancestorsB.indexOf(conceptIdA) !== -1) return true;
    if (Array.isArray(ancestorsA) && ancestorsA.indexOf(conceptIdB) !== -1) return true;
    return false;
  }

  // Extends groupDuplicateAllergies with SNOMED-ancestry-based grouping —
  // entries with DIFFERENT description text but the same underlying
  // allergen (per isSameAllergenConcept) join the same group as any
  // exact-text match. `conceptInfoByEntryId` is
  // {[entryId]: {conceptId, ancestorConceptIds}} — entries missing from it
  // (concept lookup not yet run, or failed) still participate via
  // exact-text matching only. With an empty map this degenerates to
  // exactly groupDuplicateAllergies's own grouping. Each returned entry
  // gets `groupedBy: 'text' | 'concept'` plus `relatedToDescription` for a
  // 'concept' entry, so the review UI can explain ITS reasoning.
  function groupRelatedAllergies(allergies, conceptInfoByEntryId) {
    var candidates = activeNonDraftAllergies(allergies);
    var info = conceptInfoByEntryId || {};
    var n = candidates.length;
    var parent = candidates.map(function (_, i) {
      return i;
    });
    function find(i) {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    function union(i, j) {
      var ri = find(i);
      var rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }

    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var normI = normalizeAllergyDescription(candidates[i].allergyCodeDescription);
        var normJ = normalizeAllergyDescription(candidates[j].allergyCodeDescription);
        var textMatch = !!normI && normI === normJ;
        var ci = info[candidates[i].id];
        var cj = info[candidates[j].id];
        var conceptMatch =
          !!ci &&
          !!cj &&
          isSameAllergenConcept(ci.conceptId, ci.ancestorConceptIds, cj.conceptId, cj.ancestorConceptIds);
        if (textMatch || conceptMatch) union(i, j);
      }
    }

    var byRoot = Object.create(null);
    var order = [];
    candidates.forEach(function (a, idx) {
      var root = find(idx);
      if (!byRoot[root]) {
        byRoot[root] = [];
        order.push(root);
      }
      byRoot[root].push(a);
    });

    return order
      .map(function (root) {
        return byRoot[root];
      })
      .filter(function (group) {
        return group.length >= 2;
      })
      .map(function (group) {
        return group.map(function (a) {
          var norm = normalizeAllergyDescription(a.allergyCodeDescription);
          var sameTextPeer = group.some(function (other) {
            return other !== a && normalizeAllergyDescription(other.allergyCodeDescription) === norm;
          });
          var relatedTo = null;
          if (!sameTextPeer) {
            var differentPeer = group.find(function (other) {
              return other !== a && normalizeAllergyDescription(other.allergyCodeDescription) !== norm;
            });
            relatedTo = differentPeer ? differentPeer.allergyCodeDescription : null;
          }
          return Object.assign({}, a, {
            groupedBy: sameTextPeer ? 'text' : 'concept',
            relatedToDescription: relatedTo,
          });
        });
      });
  }

  // Default keeper = earliest recordDate among the group (ISO
  // "YYYY-MM-DD" strings, directly comparable). An entry with a genuine
  // date always beats one with none; ties/all-blank keep the earliest LIST
  // position. `entries` is [{id, recordDate}].
  function pickDefaultKeeperId(entries) {
    var list = (Array.isArray(entries) ? entries : []).filter(function (e) {
      return e && e.id;
    });
    if (!list.length) return null;
    var best = list[0];
    for (var i = 1; i < list.length; i++) {
      var candidate = list[i];
      var candidateDate = candidate.recordDate || '';
      var bestDate = best.recordDate || '';
      if (candidateDate && (!bestDate || candidateDate < bestDate)) {
        best = candidate;
      }
    }
    return best.id;
  }

  // "Remove from merge" — an entry the clinician has decided ISN'T actually
  // part of this duplicate set (2026-08-02, explicit request: a card-level
  // option distinct from picking a keeper). Filters it out of the review
  // WITHOUT ending or modifying it in any way — same "leave completely
  // untouched" idea as the rest of this file's own bulk-safe exclusion sets,
  // just scoped to one review's cards instead of the whole scan.
  function filterActiveEntries(entries, removedIds) {
    var removed = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
    return (Array.isArray(entries) ? entries : []).filter(function (e) {
      return e && e.id && !removed.has(e.id);
    });
  }

  // True when the free-text additional-info box still shows EXACTLY the
  // value it was last loaded from — never edited since. Safe to silently
  // re-seed it in that case (removeFromMerge does, when the card providing
  // it gets removed — found live 2026-08-02, the box used to keep showing
  // the now-orphaned value until a radio was clicked by hand). False the
  // moment the clinician has typed anything different — this file's own
  // long-standing rule ("typing anything after that is preserved verbatim")
  // must never be silently overwritten just because a card disappeared.
  function additionalInfoTextIsUnedited(currentText, loadedFromValue) {
    return (currentText || '') === (loadedFromValue || '');
  }

  // A field can arrive as a plain value OR wrapped in a UI-select shape
  // ({label, value: {...}}) — confirmed for allergyCode on edit-allergy's
  // prefill. Passes anything else through unchanged.
  function unwrapSelectValue(field) {
    if (field && field.value && typeof field.value === 'object') return field.value;
    return field != null ? field : null;
  }

  // Same shape/logic as problem-description-cleanup.js's own
  // unwrapRecordedByOrganisation.
  function unwrapRecordedByOrganisation(org) {
    if (org && org.value && typeof org.value === 'object' && org.value.organisationName != null) {
      return org.value;
    }
    return org != null ? org : null;
  }

  // Extracts a {entryId: value} map for ONE mergeable field across every
  // entry in a group, from each entry's already-fetched overview-allergy
  // response. `entries` is [{id, overview}]. allergyReactions is compared
  // by its whole array (one "value" to choose between, not merged
  // field-by-field within itself).
  function fieldValuesByEntry(entries, fieldName) {
    var out = {};
    (Array.isArray(entries) ? entries : []).forEach(function (e) {
      if (!e || !e.id || !e.overview) return;
      var raw = e.overview[fieldName];
      if (fieldName === 'allergyReactions') {
        var reactions = Array.isArray(raw) ? raw : [];
        if (reactions.length) out[e.id] = reactions;
        return;
      }
      if (raw != null && String(raw).trim()) out[e.id] = raw;
    });
    return out;
  }

  // Shared provenance/administrative-field passthrough — the fields that are
  // NEVER touched by either change-allergy payload builder below, only ever
  // carried through from the entry's own edit-allergy prefill unchanged.
  // Extracted once both builders needed it: the merge builder never changes
  // code identity (allergyCode/substance/allergyCodeType); the conversion
  // builder (buildConversionChangeAllergyPayload, below) never changes
  // clinical facts (severity/certainty/additionalInformation/allergyReactions/
  // onsetDate) — each has its OWN opposite invariant, but both need this same
  // block of "who recorded it, when, is it hidden/confidential, is it linked
  // to a problem or clinical case" fields carried through byte-for-byte.
  function buildAllergyProvenanceFields(prefill) {
    var p = prefill || {};
    var fields = {
      linkedProblemIds: Array.isArray(p.linkedProblemIds) ? p.linkedProblemIds : [],
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      endDate: p.endDate != null ? p.endDate : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
      clinicalCaseId:
        p.linkedClinicalCase && p.linkedClinicalCase.defaultClinicalCaseId != null
          ? p.linkedClinicalCase.defaultClinicalCaseId
          : null,
    };
    if (p.recordedAtAnotherOrganisation) {
      var unwrapped = unwrapRecordedByOrganisation(p.recordedByOrganisation);
      fields.recordedByOrganisation = unwrapped && unwrapped.organisationName ? unwrapped : UNKNOWN_ORGANISATION;
      fields.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      fields.recordedByStaff = p.recordedByStaff != null ? p.recordedByStaff : null;
    }
    return fields;
  }

  // Builds the full change-allergy POST body for the chosen keeper —
  // `prefill` is the keeper's own edit-allergy GET response; `chosen` is
  // the already-resolved values the clinician picked, any of which may be
  // omitted to mean "keep the keeper's own prefill value unchanged".
  // allergyCode/substance/allergyCodeType and everything
  // buildAllergyProvenanceFields carries are ALWAYS taken from the keeper's
  // own prefill, never overridden — a merge never changes what code
  // represents the allergy (that's the separate conversion stage, see
  // buildConversionChangeAllergyPayload below) and never re-litigates
  // provenance.
  function buildMergeChangeAllergyPayload(prefill, chosen) {
    var p = prefill || {};
    var c = chosen || {};
    return Object.assign(
      {
        allergyCode: p.allergyCode ? unwrapSelectValue(p.allergyCode) : null,
        substance: p.substance ? unwrapSelectValue(p.substance) : null,
        additionalInformation:
          c.additionalInformation !== undefined
            ? c.additionalInformation
            : p.additionalInformation != null
              ? p.additionalInformation
              : null,
        severity: c.severity !== undefined ? c.severity : p.severity != null ? p.severity : null,
        certainty: c.certainty !== undefined ? c.certainty : p.certainty != null ? p.certainty : null,
        allergyReactions:
          c.allergyReactions !== undefined
            ? c.allergyReactions
            : Array.isArray(p.allergyReactions)
              ? p.allergyReactions
              : [],
        onsetDate: c.onsetDate !== undefined ? c.onsetDate : p.onsetDate != null ? p.onsetDate : null,
        allergyCodeType: p.allergyCodeType != null ? p.allergyCodeType : null,
      },
      buildAllergyProvenanceFields(p)
    );
  }

  // Builds the full change-allergy POST body for a pre-defined-allergy ->
  // substance conversion. `prefill` is the entry's own edit-allergy GET
  // response; `newSubstance` is {conceptId, description, descriptionId} —
  // the clinician-picked substance, REQUIRED (there is no "conversion" with
  // no target). `newReactions` is an ARRAY of the same shape (0 or more —
  // real allergies can have more than one distinct reaction, e.g. a
  // patient with both "shivering" and "bradycardia" to the same substance,
  // found live 2026-08-02) — picking any is always optional (a clinician
  // who can't find a good reaction match can still convert with the
  // substance alone). The OPPOSITE invariant to
  // buildMergeChangeAllergyPayload: this NEVER touches
  // severity/certainty/additionalInformation/onsetDate (always the
  // prefill's own value, unchanged — conversion changes code identity,
  // never clinical facts) and allergyReactions is only overridden when at
  // least one reaction was actually picked, otherwise the prefill's own
  // reactions carry through unchanged too.
  function buildConversionChangeAllergyPayload(prefill, newSubstance, newReactions) {
    var p = prefill || {};
    var reactions = Array.isArray(newReactions) ? newReactions.filter(Boolean) : [];
    return Object.assign(
      {
        allergyCode: null,
        substance: newSubstance || null,
        additionalInformation: p.additionalInformation != null ? p.additionalInformation : null,
        severity: p.severity != null ? p.severity : null,
        certainty: p.certainty != null ? p.certainty : null,
        allergyReactions: reactions.length ? reactions : Array.isArray(p.allergyReactions) ? p.allergyReactions : [],
        onsetDate: p.onsetDate != null ? p.onsetDate : null,
        allergyCodeType: 'substances',
      },
      buildAllergyProvenanceFields(p)
    );
  }

  // Builds the full change-allergy POST body for clearing the NON-
  // authoritative code field off a dual-coded entry (see
  // hasBothCodeTypes/classifyDualCodedEntries above) — confirmed live
  // (HAR46) the real, observed shape is allergyCodeType:"substances" with a
  // stale allergyCode still populated, so that's what's cleared — the ONLY
  // direction this builder will ever produce; anything else throws (see
  // inside). Every clinical field (severity/certainty/
  // additionalInformation/allergyReactions/onsetDate) and the authoritative
  // code itself pass through UNCHANGED — this only ever nulls the one stale
  // field, nothing else about the record changes.
  function buildClearLegacyCodePayload(prefill) {
    var p = prefill || {};
    // FAIL CLOSED on anything except the one live-observed direction. The
    // checklist row was flagged from the OVERVIEW's allergyCodeType, but this
    // payload is built from the EDIT-ALLERGY prefill's — if the prefill
    // disagrees (or omits the field, the "older/thinner shape" case), a
    // symmetric clear here would silently delete the dm+d SUBSTANCE while the
    // UI told the clinician it never would. Refusing surfaces as a per-row
    // tidyError instead, and the record stays untouched.
    if (p.allergyCodeType !== 'substances') {
      throw new Error(
        'This entry no longer shows the substance as its current code — skipped to be safe. Please review it manually in Medicus.'
      );
    }
    return Object.assign(
      {
        allergyCode: null,
        substance: p.substance ? unwrapSelectValue(p.substance) : null,
        additionalInformation: p.additionalInformation != null ? p.additionalInformation : null,
        severity: p.severity != null ? p.severity : null,
        certainty: p.certainty != null ? p.certainty : null,
        allergyReactions: Array.isArray(p.allergyReactions) ? p.allergyReactions : [],
        onsetDate: p.onsetDate != null ? p.onsetDate : null,
        allergyCodeType: p.allergyCodeType != null ? p.allergyCodeType : null,
      },
      buildAllergyProvenanceFields(p)
    );
  }

  // overview-allergy returns onsetDate as a UK display string ("24 Jul
  // 2012"), but change-allergy's payload needs the ISO shape
  // edit-allergy's own prefill already uses ("2012-07-24") — CONFIRMED
  // live (HAR: 36-merge-failure.har): posting the overview's raw display
  // string back verbatim for a non-keeper copy's chosen onsetDate is
  // rejected — POST 400 {"errors":{"onsetDate":["Value is not a valid
  // partial date."]}}. Converts only the one confirmed display shape;
  // anything else (already ISO, null, unrecognised) passes through
  // unchanged rather than guessing at a shape never seen live.
  var OVERVIEW_DATE_RE = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/;
  var OVERVIEW_MONTH_ABBR = {
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

  function normalizeOnsetDateForSubmit(value) {
    if (value == null) return value;
    var m = OVERVIEW_DATE_RE.exec(String(value).trim());
    if (!m) return value;
    var month = OVERVIEW_MONTH_ABBR[m[2]];
    if (!month) return value;
    var day = m[1].length === 1 ? '0' + m[1] : m[1];
    return m[3] + '-' + month + '-' + day;
  }

  // ── Page-shape parsing (pure, so both URL shapes are unit-testable) ──────────
  // Same pair of parsers as problem-bulk-end.js — duplicated, not shared,
  // the same way each content script already carries its own apiFetch.

  // Care-record page: .../{siteId}/patient/patient/care-record/{patientId}.
  function parseCareRecordPath(pathname) {
    var m = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i.exec(
      String(pathname == null ? '' : pathname)
    );
    if (!m) return null;
    return { siteId: m[1], patientId: m[2] };
  }

  // Task-overview ("split") page: .../{siteId}/tasks/data/{typeSlug}/overview/
  // {taskUuid} — the same shape task-inline.js/booking-inline.js already
  // match. Its embedded Clinical Summary panel renders the same Allergies
  // card as the care-record page, but the URL carries no patientId — that's
  // resolved via the task's own overview endpoint (resolveTaskPatientId, in
  // the browser boot).
  function parseTaskOverviewPath(pathname) {
    var m =
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
        String(pathname == null ? '' : pathname)
      );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // The task-overview response's patient id — the same fallback chain
  // task-inline.js's resolvePatientId already uses (data.data.patient.id →
  // data.data.patientId → data.patient.id → data.patientId). Null when the
  // task genuinely has no patient (some task types don't).
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
      MERGE_REASON_ENDED: MERGE_REASON_ENDED,
      MERGEABLE_FIELDS: MERGEABLE_FIELDS,
      findJunkCodeEntry: findJunkCodeEntry,
      resolveAllergyConceptId: resolveAllergyConceptId,
      buildEndAllergyPayload: buildEndAllergyPayload,
      isEndable: isEndable,
      normalizeAllergyDescription: normalizeAllergyDescription,
      activeNonDraftAllergies: activeNonDraftAllergies,
      reactionDescriptions: reactionDescriptions,
      buildCautionMessage: buildCautionMessage,
      combinedCaution: combinedCaution,
      classifyJunkEntries: classifyJunkEntries,
      hasBothCodeTypes: hasBothCodeTypes,
      classifyDualCodedEntries: classifyDualCodedEntries,
      buildClearLegacyCodePayload: buildClearLegacyCodePayload,
      findConversionRule: findConversionRule,
      classifyConvertibleEntries: classifyConvertibleEntries,
      normalizedConceptSearchResults: normalizedConceptSearchResults,
      rankSubstanceResults: rankSubstanceResults,
      extractAllergenAndReactionHint: extractAllergenAndReactionHint,
      pickReactionSeed: pickReactionSeed,
      groupDuplicateAllergies: groupDuplicateAllergies,
      remapReviewsByGroupIdentity: remapReviewsByGroupIdentity,
      isSameAllergenConcept: isSameAllergenConcept,
      groupRelatedAllergies: groupRelatedAllergies,
      pickDefaultKeeperId: pickDefaultKeeperId,
      filterActiveEntries: filterActiveEntries,
      additionalInfoTextIsUnedited: additionalInfoTextIsUnedited,
      unwrapSelectValue: unwrapSelectValue,
      unwrapRecordedByOrganisation: unwrapRecordedByOrganisation,
      fieldValuesByEntry: fieldValuesByEntry,
      buildAllergyProvenanceFields: buildAllergyProvenanceFields,
      buildMergeChangeAllergyPayload: buildMergeChangeAllergyPayload,
      buildConversionChangeAllergyPayload: buildConversionChangeAllergyPayload,
      normalizeOnsetDateForSubmit: normalizeOnsetDateForSubmit,
      parseCareRecordPath: parseCareRecordPath,
      parseTaskOverviewPath: parseTaskOverviewPath,
      parseSummaryBridgeAttr: parseSummaryBridgeAttr,
      extractPatientIdFromTaskOverview: extractPatientIdFromTaskOverview,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msAllergyCleanup) return;
  window.__msAllergyCleanup = true;

  // Debug pipeline logging — same pattern as allergy-duplicate-merge.js's
  // old 'ms-adm-debug' flag / triage-lens/content.js's 'ch-debug'. OFF by
  // default, toggled via localStorage (survives reload).
  var DEBUG = (function () {
    try {
      return localStorage.getItem('ms-ac-debug') === '1';
    } catch (_) {
      return false;
    }
  })();
  function dbg() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[AllergyCleanup]');
    console.log.apply(console, args);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  // ── URL detection ────────────────────────────────────────────────────────────
  // Two page shapes carry the Allergies card this widget serves: the full
  // care-record page (patientId in the URL — identical to every other
  // content script in this family) and the task-overview "split" page
  // (patient resolved via the task's own overview endpoint — see
  // resolveTaskPatientId below). Both parsers are pure helpers above so the
  // regexes stay unit-tested.
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
      var errorBody = await resp.text().catch(function () {
        return '';
      });
      throw new Error('API ' + resp.status + (errorBody ? ': ' + errorBody.slice(0, 300) : ''));
    }
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Allergy API returned an unexpected response.');
    }
  }

  function fetchClinicalSummaryAllergies(patientId) {
    return apiFetch('/clinical/data/clinical-summary/summary/' + encodeURIComponent(patientId)).then(function (data) {
      return (data && data.allergies) || [];
    });
  }

  function fetchAllergyOverview(allergyId) {
    return apiFetch('/clinical/data/allergy/overview-allergy/' + encodeURIComponent(allergyId));
  }

  function fetchEditAllergyForm(allergyId) {
    return apiFetch('/clinical/data/allergy/edit-allergy/' + encodeURIComponent(allergyId));
  }

  function postChangeAllergy(allergyId, payload) {
    return apiFetch('/clinical/allergy/change-allergy/' + encodeURIComponent(allergyId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── Split-page patient resolution ─────────────────────────────────────────────
  // The task-overview URL carries no patientId, so it's resolved ONCE per
  // task via the same overview endpoint task-inline.js/booking-inline.js
  // already drive. Cache semantics matter for safety and for chatter: a
  // RESOLVED task caches its answer per taskUuid — including null for a
  // patientless task, so it is never refetched — while a FAILED fetch caches
  // nothing, so the throttled rescan retries later. The uuid keying (not a
  // single "current" slot) means a stale resolve can never be attributed to
  // a different task the clinician has since navigated to.
  var _taskPatientIdByUuid = Object.create(null);
  var _taskPatientResolveInFlight = false;

  async function resolveTaskPatientId(task) {
    if (_taskPatientIdByUuid[task.taskUuid] !== undefined) return _taskPatientIdByUuid[task.taskUuid];
    if (_taskPatientResolveInFlight) return null; // another tick's resolve is running — this one just waits for the cache
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

  function postEndAllergy(payload) {
    return apiFetch('/clinical/allergy/end-allergy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // Loads rules/allergy-junk-codes.json ONCE per page load — a local
  // extension resource, not a Medicus call. Never throws; falls back to an
  // empty list (the widget then simply never flags junk) if unavailable.
  var _junkCodesPromise = null;
  function ensureAllergyJunkCodesLoaded() {
    if (_junkCodesPromise) return _junkCodesPromise;
    _junkCodesPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/allergy-junk-codes.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.codes) ? doc.codes : [];
      } catch (e) {
        return [];
      }
    })();
    return _junkCodesPromise;
  }

  // Loads rules/allergy-substance-conversion.json ONCE per page load — same
  // "local extension resource, never throws, fails open to inert" discipline
  // as ensureAllergyJunkCodesLoaded above.
  var _conversionRulesPromise = null;
  function ensureAllergyConversionRulesLoaded() {
    if (_conversionRulesPromise) return _conversionRulesPromise;
    _conversionRulesPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/allergy-substance-conversion.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        return Array.isArray(doc && doc.entries) ? doc.entries : [];
      } catch (e) {
        return [];
      }
    })();
    return _conversionRulesPromise;
  }

  // ── Concept-ancestry lookup (duplicate enrichment) ────────────────────────────
  // outputParentConceptIds=1 + a bare-SCTID query — same confirmed
  // mechanism already proven live for problem-type concepts
  // (problem-description-cleanup.js's own SEARCH_PATH). Allergy
  // finding-type concepts sit under the same "Clinical finding" top-level
  // hierarchy, so the same five constrainingParentConcepts scope applies.
  // Fails closed (null, no ancestry check) on any error rather than
  // guessing.
  var CONCEPT_SEARCH_PATH =
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&outputParentConceptIds=1&query=';

  var _ancestorCache = Object.create(null);

  async function fetchAncestorConceptIds(conceptId) {
    if (!conceptId) return null;
    if (_ancestorCache[conceptId] !== undefined) return _ancestorCache[conceptId];
    var result = null;
    try {
      var data = await apiFetch(CONCEPT_SEARCH_PATH + encodeURIComponent(conceptId));
      var results = (data && data.results) || [];
      var match = results.find(function (r) {
        return r && r.value && String(r.value.conceptId) === String(conceptId);
      });
      if (match && Array.isArray(match.value.parentConceptIds)) {
        result = match.value.parentConceptIds.map(String);
      }
    } catch (_) {
      result = null;
    }
    _ancestorCache[conceptId] = result;
    return result;
  }

  // ── Conversion search (substance + reaction) ──────────────────────────────
  // Substance search: constrainingRefsets=30931000001101 — the dm+d
  // medicinal-substance refset, confirmed live in the substance-conversion
  // research (a DIFFERENT scope from CONCEPT_SEARCH_PATH's clinical-finding
  // roots above — dm+d substances aren't clinical findings at all, they live
  // in a completely separate part of the SNOMED/dm+d hierarchy). Reaction
  // search reuses CONCEPT_SEARCH_PATH as a plain free-text query — the same
  // endpoint/scope HAR42 confirmed live for picking a reaction once a
  // substance is already chosen, not a new mechanism.
  var SUBSTANCE_SEARCH_PATH =
    '/clinical/gb/snomed/search/description/constrained?constrainingRefsets=30931000001101&outputParentConceptIds=1&query=';

  function searchAllergySubstances(queryText) {
    return apiFetch(SUBSTANCE_SEARCH_PATH + encodeURIComponent(queryText)).then(function (data) {
      return (data && data.results) || [];
    });
  }

  function searchAllergyReactions(queryText) {
    return apiFetch(CONCEPT_SEARCH_PATH + encodeURIComponent(queryText)).then(function (data) {
      return (data && data.results) || [];
    });
  }

  // ── DOM: scoping to the Allergies card specifically ───────────────────────
  // Real bug, found live 2026-07-29 in both retired predecessors: an
  // unscoped, document-wide row search can match a Problem row whose text
  // happens to read identically to a real allergy entry (Problems renders
  // above Allergies on Clinical Summary). Every row search here is scoped
  // to the Allergies card's own DOM subtree, recomputed fresh on every call
  // (Vue's re-renders can replace the card's own root element). Fails
  // closed — no injection at all — when the section can't be confidently
  // found.
  function findAllergiesSectionRoot() {
    var headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="header"], [class*="title"]');
    for (var i = 0; i < headings.length; i++) {
      var el = headings[i];
      if ((el.textContent || '').trim() !== 'Allergies') continue;
      var node = el.parentElement;
      for (var depth = 0; node && depth < 6; depth++, node = node.parentElement) {
        if (node.querySelector('a.item__link, a[class*="item__link"]')) return node;
      }
    }
    return null;
  }

  function findAllergyRow(description, claimedAnchors, scopeEl) {
    var root = scopeEl || document;
    var links = root.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (claimedAnchors && claimedAnchors.has(a)) continue;
      if ((a.textContent || '').trim() === description) return a;
    }
    return null;
  }

  function findFirstAllergyRow(allergies, scopeEl) {
    for (var i = 0; i < allergies.length; i++) {
      var row = findAllergyRow(allergies[i].allergyCodeDescription, null, scopeEl);
      if (row) return row;
    }
    return null;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var _lastPatientId = null;
  // Bumped on every patient change (resetForPatient). Every async flow that
  // writes module state after an await captures this at its start and
  // discards its result if the epoch has moved on — otherwise a fetch/scan
  // started on patient A can resolve after SPA-navigation to patient B and
  // repopulate B's freshly-reset state with A's allergy IDs, and the
  // destructive actions would then target A's records from B's screen.
  var _patientEpoch = 0;
  var _allergiesCache = null;
  var _hintGroups = []; // free, text-only groupDuplicateAllergies result — page-load only
  var _open = false;
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
  var _junkFlagged = []; // [{ id, description, conceptId, reasonEnded, ..., anchorEl, checked, ended, endError }]
  var _duplicateGroups = []; // [{ key, description, entries: [{id, description, groupedBy, relatedToDescription}] }]
  var _endDate = todayISO(); // junk bulk-end shared date field
  var _ending = false;
  // Per-duplicate-group review state, keyed by group index — same shape as
  // the retired duplicate-merge widget's own _reviews.
  var _reviews = Object.create(null);
  var _modalRoot = null;
  // Concept-ancestry enrichment — persistent across rescans (a real bug in
  // the retired duplicate-merge widget came from NOT persisting this and
  // discarding pass-2's result on every subsequent rescan).
  var _conceptEnrichmentDone = false;
  var _conceptInfoByEntryId = {};
  var _conversionFlagged = []; // [{ id, description, conceptId, rule }] — from classifyConvertibleEntries
  // Per-conversion-entry review state, keyed by index — same pattern as _reviews.
  var _conversionReviews = Object.create(null);
  var _dualCodedFlagged = []; // [{ id, description, legacyCode, substance, authoritative, checked, tidied, tidyError }]
  var _dualCodedTidying = false;

  function resetForPatient() {
    _patientEpoch += 1;
    hideModal(); // an open review modal belongs to the previous patient
    _allergiesCache = null;
    _hintGroups = [];
    _open = false;
    _scanState = 'idle';
    _scanError = null;
    _junkFlagged = [];
    _duplicateGroups = [];
    _endDate = todayISO();
    _ending = false;
    _reviews = Object.create(null);
    _conceptEnrichmentDone = false;
    _conceptInfoByEntryId = {};
    _conversionFlagged = [];
    _conversionReviews = Object.create(null);
    _dualCodedFlagged = [];
    _dualCodedTidying = false;
  }

  function groupState(idx) {
    if (!_reviews[idx]) {
      _reviews[idx] = {
        open: false,
        loading: false,
        error: null,
        entries: null,
        keeperId: null,
        chosen: {},
        additionalInfoText: '',
        endDate: todayISO(),
        saving: false,
        saveError: null,
        merged: false,
        removedIds: new Set(), // entries excluded from THIS merge review — never ended/modified
      };
    }
    return _reviews[idx];
  }

  function conversionState(idx) {
    if (!_conversionReviews[idx]) {
      _conversionReviews[idx] = {
        open: false,
        loading: false,
        error: null,
        prefill: null,
        substanceQuery: '',
        substanceLoading: false,
        substanceError: null,
        substanceResults: null,
        pendingSubstance: null,
        reactionQuery: '',
        reactionLoading: false,
        reactionError: null,
        reactionResults: null,
        pendingReactions: [], // 0+ — a real allergy can have more than one distinct reaction
        saving: false,
        saveError: null,
        converted: false,
      };
    }
    return _conversionReviews[idx];
  }

  // ── Page load: cheap list + free duplicate hint only ──────────────────────────
  var _fetchInFlight = false;

  async function ensureAllergiesLoaded() {
    var info = getPatientInfo();
    if (!info) {
      // Split page: same widget, patient resolved from the task's overview.
      // Re-read the URL after the await — if the clinician navigated to a
      // different task while the resolve was in flight, drop this tick; the
      // next one re-reads the fresh URL and its own cached resolution.
      var task = getTaskInfo();
      if (task) {
        var resolvedPatientId = await resolveTaskPatientId(task);
        var nowTask = getTaskInfo();
        if (!resolvedPatientId || !nowTask || nowTask.taskUuid !== task.taskUuid) return;
        info = { siteId: task.siteId, patientId: resolvedPatientId };
      } else {
        // Any other page shape (appointment view, consultation view, …):
        // the page-world bridge tells us which patient the page's own
        // embedded Clinical Summary panel was last fetched for. No extra
        // injection gate is needed here: this widget only ever injects
        // against an exact-text-matched allergy row inside the scoped
        // Allergies card (findFirstAllergyRow), so a stale bridge patient
        // whose allergies match nothing on screen never renders anything.
        var bridged = parseSummaryBridgeAttr(document.documentElement.getAttribute('data-ch-summary-patient'));
        if (!bridged) return;
        info = { siteId: null, patientId: bridged };
      }
    }
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForPatient();
    }
    if (!_allergiesCache && !_fetchInFlight) {
      _fetchInFlight = true;
      var epoch = _patientEpoch;
      try {
        var fetched = await fetchClinicalSummaryAllergies(info.patientId);
        if (epoch !== _patientEpoch) return; // patient changed mid-fetch — this list is stale
        _allergiesCache = fetched;
      } catch (_) {
        if (epoch !== _patientEpoch) return;
        _allergiesCache = [];
      } finally {
        _fetchInFlight = false;
      }
    }
    if (_allergiesCache) {
      _hintGroups = groupDuplicateAllergies(_allergiesCache);
      injectTrigger();
    }
  }

  // ── Full scan (opt-in — only ever runs from the "Clean up allergies?" click) ──
  async function runFullScan() {
    var epoch = _patientEpoch;
    _scanState = 'scanning';
    _scanError = null;
    render();
    try {
      var junkCodes = await ensureAllergyJunkCodesLoaded();
      var conversionRules = await ensureAllergyConversionRulesLoaded();
      var candidates = activeNonDraftAllergies(_allergiesCache);
      var overviewList = await Promise.all(
        candidates.map(function (a) {
          return fetchAllergyOverview(a.id).catch(function () {
            return null;
          });
        })
      );
      // Patient changed while the overviews were in flight — every id in
      // `candidates` belongs to the PREVIOUS patient; writing them into the
      // freshly-reset state would offer destructive actions against the
      // wrong record. Discard everything.
      if (epoch !== _patientEpoch) return;
      var overviewsById = {};
      candidates.forEach(function (a, i) {
        overviewsById[a.id] = overviewList[i];
      });

      var scopeEl = findAllergiesSectionRoot();
      var claimedAnchors = new Set();
      var junkFlagged = classifyJunkEntries(candidates, overviewsById, junkCodes || []).map(function (f) {
        var anchorEl = findAllergyRow(f.description, claimedAnchors, scopeEl);
        if (anchorEl) claimedAnchors.add(anchorEl);
        return Object.assign({}, f, { anchorEl: anchorEl, checked: false, ended: false, endError: null });
      });
      _junkFlagged = junkFlagged;

      var junkIds = new Set(
        junkFlagged.map(function (f) {
          return f.id;
        })
      );
      var dualCodedFlagged = classifyDualCodedEntries(candidates, overviewsById, junkIds).map(function (f) {
        return Object.assign({}, f, { checked: false, tidied: false, tidyError: null });
      });
      _dualCodedFlagged = dualCodedFlagged;

      var excludeFromConversion = new Set(junkIds);
      dualCodedFlagged.forEach(function (f) {
        excludeFromConversion.add(f.id);
      });
      _conversionFlagged = classifyConvertibleEntries(
        candidates,
        overviewsById,
        conversionRules || [],
        excludeFromConversion
      );

      // Duplicate grouping reuses whatever concept-ancestry enrichment has
      // accumulated so far (empty on a fresh scan — degenerates to
      // text-only, same as the free page-load hint but now including
      // entries whose overview just got fetched above).
      applyDuplicateGroups(groupRelatedAllergies(_allergiesCache, _conceptInfoByEntryId));

      _scanState = 'done';
    } catch (err) {
      if (epoch !== _patientEpoch) return;
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to scan the allergy list.';
    } finally {
      if (epoch === _patientEpoch) render();
    }
    // Backgrounded pass-2 enrichment — never blocks the scan's own result.
    enrichGroupsWithConceptAncestry();
  }

  // Order-independent identity of a duplicate group — its member entry ids.
  function groupEntryIdKey(entries) {
    return (entries || [])
      .map(function (e) {
        return e.id;
      })
      .sort()
      .join('|');
  }

  // Per-group review state (_reviews) — and an open review modal — are keyed
  // by group INDEX, but the background concept-ancestry enrichment can
  // replace _duplicateGroups with a regrouped array (indices shift, text
  // groups merge). Remap surviving state to each group's NEW index by
  // entry-id identity; state for a group that no longer exists as-is (its
  // members got regrouped into a bigger one) is dropped, so its review
  // restarts from the fuller group rather than acting on a stale card set.
  // Pure — exported for tests.
  function remapReviewsByGroupIdentity(oldGroups, newGroups, oldReviews) {
    var keyToNewIdx = {};
    (newGroups || []).forEach(function (g, i) {
      keyToNewIdx[groupEntryIdKey(g.entries)] = i;
    });
    var out = Object.create(null);
    Object.keys(oldReviews || {}).forEach(function (oldIdx) {
      var og = (oldGroups || [])[oldIdx];
      if (!og) return;
      var ni = keyToNewIdx[groupEntryIdKey(og.entries)];
      if (ni !== undefined) out[ni] = oldReviews[oldIdx];
    });
    return out;
  }

  function applyDuplicateGroups(rawGroups) {
    var oldGroups = _duplicateGroups;
    _duplicateGroups = rawGroups.map(function (entries, i) {
      return {
        key: 'g' + i,
        description: entries[0].allergyCodeDescription,
        entries: entries.map(function (e) {
          return {
            id: e.id,
            description: e.allergyCodeDescription,
            groupedBy: e.groupedBy || 'text',
            relatedToDescription: e.relatedToDescription || null,
          };
        }),
      };
    });
    _reviews = remapReviewsByGroupIdentity(oldGroups, _duplicateGroups, _reviews);
    // If a duplicate-review modal is open, follow its group to the new index
    // (re-rendering rebinds the handlers to it); if the group was regrouped
    // away, close the modal — its cards no longer match any group, and
    // confirmMerge would otherwise act on a silently-stale index.
    if (_modalRoot && _modalRoot.style.display !== 'none' && _modalRoot.dataset.kind === 'duplicate') {
      var og = oldGroups[Number(_modalRoot.dataset.idx)];
      var newIdx = og
        ? _duplicateGroups.findIndex(function (g) {
            return groupEntryIdKey(g.entries) === groupEntryIdKey(og.entries);
          })
        : -1;
      if (newIdx === -1) hideModal();
      else showModal('duplicate', newIdx);
    }
  }

  async function enrichGroupsWithConceptAncestry() {
    if (_conceptEnrichmentDone || !_allergiesCache) return;
    var epoch = _patientEpoch;
    var candidates = activeNonDraftAllergies(_allergiesCache);
    if (candidates.length < 2) {
      _conceptEnrichmentDone = true;
      return;
    }
    _conceptEnrichmentDone = true; // set eagerly — one pass per patient load
    dbg('enrichGroupsWithConceptAncestry: starting, candidates:', candidates.length);
    try {
      await Promise.all(
        candidates.map(async function (a) {
          var overview;
          try {
            overview = await fetchAllergyOverview(a.id);
          } catch (e) {
            return;
          }
          var conceptId = resolveAllergyConceptId(overview);
          if (!conceptId) return;
          var ancestors = await fetchAncestorConceptIds(conceptId);
          _conceptInfoByEntryId[a.id] = { conceptId: conceptId, ancestorConceptIds: ancestors || [] };
        })
      );
      if (epoch !== _patientEpoch) return; // patient changed while fetching — results are stale
      var enriched = groupRelatedAllergies(_allergiesCache, _conceptInfoByEntryId);
      dbg('enrichGroupsWithConceptAncestry: done, groups now:', enriched.length);
      applyDuplicateGroups(enriched);
      if (_scanState === 'done') render();
    } catch (e) {
      dbg('enrichGroupsWithConceptAncestry: THREW', e && e.message, e && e.stack);
    }
  }

  // ── Junk bulk-end action ──────────────────────────────────────────────────────
  async function endSelectedJunk() {
    var targets = _junkFlagged.filter(function (f) {
      return f.checked && isEndable(f);
    });
    // No end date -> no POST, ever.
    if (!targets.length || _ending || !_endDate) return;
    // Ending an allergy is effectively irreversible from this widget — same
    // "Are you sure?" gate (cancel by default) the OIR select-all uses, per
    // the clinical safety notice, naming the exact count being acted on.
    if (
      !window.confirm(
        'End ' +
          targets.length +
          ' selected allerg' +
          (targets.length === 1 ? 'y' : 'ies') +
          ' as junk/low-relevance codes? This cannot be undone from here.'
      )
    ) {
      return;
    }
    _ending = true;
    render();
    var results = await Promise.allSettled(
      targets.map(function (f) {
        return postEndAllergy(buildEndAllergyPayload(f.id, _endDate, f.reasonEnded));
      })
    );
    var allSucceeded = true;
    results.forEach(function (r, i) {
      var f = targets[i];
      if (r.status === 'fulfilled') {
        f.ended = true;
        f.checked = false;
        f.endError = null;
        if (f.anchorEl) f.anchorEl.classList.add('ms-ac-anchor-ended');
      } else {
        allSucceeded = false;
        f.endError = (r.reason && r.reason.message) || 'Failed to end this allergy — please try again.';
      }
    });
    _ending = false;
    render();
    // Medicus's own allergy-list UI doesn't reflect an ended allergy until
    // the page is refreshed. Auto-reload ONLY when every targeted end
    // succeeded, after a brief pause so the "Ended" tags are actually
    // visible first — a failed end must stay on screen with its error
    // message so the clinician can see and retry it.
    if (allSucceeded && targets.length) {
      setTimeout(function () {
        location.reload();
      }, 900);
    }
  }

  // ── Dual-coded bulk cleanup (legacy code alongside an already-authoritative
  // substance — see classifyDualCodedEntries's own comment for why this is
  // bulk-safe, unlike merge/conversion) ─────────────────────────────────────
  async function tidySelectedDualCoded() {
    var targets = _dualCodedFlagged.filter(function (f) {
      return f.checked && !f.tidied;
    });
    if (!targets.length || _dualCodedTidying) return;
    if (
      !window.confirm(
        'Remove the stale legacy code from ' +
          targets.length +
          ' selected entr' +
          (targets.length === 1 ? 'y' : 'ies') +
          '? The current substance and all clinical detail are kept unchanged.'
      )
    ) {
      return;
    }
    _dualCodedTidying = true;
    render();
    var results = await Promise.allSettled(
      targets.map(function (f) {
        return fetchEditAllergyForm(f.id).then(function (prefill) {
          return postChangeAllergy(f.id, buildClearLegacyCodePayload(prefill));
        });
      })
    );
    var allSucceeded = true;
    results.forEach(function (r, i) {
      var f = targets[i];
      if (r.status === 'fulfilled') {
        f.tidied = true;
        f.checked = false;
        f.tidyError = null;
      } else {
        allSucceeded = false;
        f.tidyError = (r.reason && r.reason.message) || 'Failed to tidy this entry — please try again.';
      }
    });
    _dualCodedTidying = false;
    render();
    if (allSucceeded && targets.length) {
      setTimeout(function () {
        location.reload();
      }, 900);
    }
  }

  // ── Duplicate per-group review (opt-in — only from a "Review?" click) ─────────
  async function openReview(idx) {
    var group = _duplicateGroups[idx];
    if (!group) return;
    var st = groupState(idx);
    st.open = true;
    if (st.entries) {
      showModal('duplicate', idx);
      return;
    }
    st.loading = true;
    st.error = null;
    showModal('duplicate', idx);
    try {
      var overviews = await Promise.all(
        group.entries.map(function (e) {
          return fetchAllergyOverview(e.id).catch(function () {
            return null;
          });
        })
      );
      var entries = group.entries.map(function (e, i) {
        return {
          id: e.id,
          description: e.description,
          overview: overviews[i],
          groupedBy: e.groupedBy,
          relatedToDescription: e.relatedToDescription,
        };
      });
      st.entries = entries;
      st.keeperId = pickDefaultKeeperId(
        entries.map(function (e) {
          return { id: e.id, recordDate: e.overview && e.overview.recordDate };
        })
      );
      MERGEABLE_FIELDS.forEach(function (field) {
        var values = fieldValuesByEntry(entries, field);
        if (values[st.keeperId] !== undefined) {
          st.chosen[field] = st.keeperId;
        } else {
          var firstWithValue = Object.keys(values)[0];
          if (firstWithValue) st.chosen[field] = firstWithValue;
        }
      });
      var aiEntryId = st.chosen.additionalInformation;
      var aiEntry =
        aiEntryId &&
        entries.find(function (e) {
          return e.id === aiEntryId;
        });
      st.additionalInfoText = (aiEntry && aiEntry.overview && aiEntry.overview.additionalInformation) || '';
    } catch (err) {
      st.error = (err && err.message) || 'Failed to load these allergies for comparison.';
    } finally {
      st.loading = false;
      showModal('duplicate', idx);
    }
  }

  function closeReview(idx) {
    var st = groupState(idx);
    st.open = false;
    hideModal();
  }

  // Excludes one entry from the current merge review — its card disappears
  // immediately, but it is NEVER ended or modified (see confirmMerge's own
  // "others" computation, which only ever targets active entries). If the
  // removed entry was the keeper, or was the source of a chosen field
  // value, both are re-derived from whatever remains active — same
  // defaulting logic openReview used on first load, reusing the already-
  // tested pickDefaultKeeperId rather than duplicating it.
  function removeFromMerge(idx, entryId) {
    var st = groupState(idx);
    if (!st.entries) return;
    var removedEntry = st.entries.find(function (e) {
      return e.id === entryId;
    });
    // Computed BEFORE any mutation below, against the pre-removal state —
    // was the additional-info box currently showing exactly THIS entry's
    // own unedited value?
    var wasAdditionalInfoSource =
      st.chosen.additionalInformation === entryId &&
      additionalInfoTextIsUnedited(
        st.additionalInfoText,
        removedEntry && removedEntry.overview && removedEntry.overview.additionalInformation
      );
    st.removedIds.add(entryId);
    var active = filterActiveEntries(st.entries, st.removedIds);
    if (st.keeperId === entryId) {
      st.keeperId = pickDefaultKeeperId(
        active.map(function (e) {
          return { id: e.id, recordDate: e.overview && e.overview.recordDate };
        })
      );
    }
    MERGEABLE_FIELDS.forEach(function (field) {
      if (st.chosen[field] !== entryId) return;
      var values = fieldValuesByEntry(active, field);
      if (values[st.keeperId] !== undefined) {
        st.chosen[field] = st.keeperId;
        return;
      }
      var firstWithValue = Object.keys(values)[0];
      if (firstWithValue) st.chosen[field] = firstWithValue;
      else delete st.chosen[field];
    });
    // Re-seed the free-text box exactly the way clicking a radio already
    // would — but only when it's safe (see additionalInfoTextIsUnedited's
    // own comment).
    if (wasAdditionalInfoSource) {
      var newSource = active.find(function (e) {
        return e.id === st.chosen.additionalInformation;
      });
      st.additionalInfoText = (newSource && newSource.overview && newSource.overview.additionalInformation) || '';
    }
    refreshModal('duplicate', idx);
  }

  function restoreToMerge(idx, entryId) {
    var st = groupState(idx);
    st.removedIds.delete(entryId);
    refreshModal('duplicate', idx);
  }

  async function confirmMerge(idx) {
    var group = _duplicateGroups[idx];
    var st = groupState(idx);
    if (!group || !st.entries || !st.keeperId || st.saving || !st.endDate) return;
    // SNAPSHOT everything the merge acts on BEFORE the first await. The
    // modal's radios/checkboxes stay live while the save is in flight, and
    // their handlers mutate st directly — without this, a keeper click
    // mid-save would POST the OLD keeper's prefill onto the NEW keeper's
    // record and then end the old keeper as a duplicate.
    var keeperId = st.keeperId;
    var chosen = Object.assign({}, st.chosen);
    var endDate = st.endDate;
    var additionalInfoText = st.additionalInfoText;
    var active = filterActiveEntries(st.entries, st.removedIds);
    st.saving = true;
    st.saveError = null;
    refreshModal('duplicate', idx);
    try {
      var prefill = await fetchEditAllergyForm(keeperId);
      var resolved = {};
      MERGEABLE_FIELDS.forEach(function (field) {
        if (field === 'additionalInformation') return;
        var chosenEntryId = chosen[field];
        if (!chosenEntryId) return;
        var chosenEntry = active.find(function (e) {
          return e.id === chosenEntryId;
        });
        var value = chosenEntry && chosenEntry.overview && chosenEntry.overview[field];
        if (value === undefined) return;
        resolved[field] = field === 'onsetDate' ? normalizeOnsetDateForSubmit(value) : value;
      });
      resolved.additionalInformation = (additionalInfoText || '').trim() || null;
      var payload = buildMergeChangeAllergyPayload(prefill, resolved);
      await postChangeAllergy(keeperId, payload);
      // Only ACTIVE entries are ever ended — anything removed from this
      // merge (filterActiveEntries above) must be left completely untouched.
      var others = active.filter(function (e) {
        return e.id !== keeperId;
      });
      var results = await Promise.allSettled(
        others.map(function (e) {
          return postEndAllergy(buildEndAllergyPayload(e.id, endDate, MERGE_REASON_ENDED));
        })
      );
      var failed = results
        .map(function (r, i) {
          return r.status === 'rejected' ? others[i] : null;
        })
        .filter(Boolean);
      if (failed.length) {
        st.saveError =
          'The merged entry was saved, but ' +
          failed.length +
          ' duplicate' +
          (failed.length === 1 ? '' : 's') +
          ' could not be ended — please end ' +
          (failed.length === 1 ? 'it' : 'them') +
          ' manually via Medicus.';
      } else {
        st.merged = true;
        setTimeout(function () {
          location.reload();
        }, 900);
      }
    } catch (err) {
      st.saveError = (err && err.message) || 'Failed to save the merged entry — please try again.';
    } finally {
      st.saving = false;
      refreshModal('duplicate', idx);
    }
  }

  // ── Per-entry conversion review (opt-in — only from a "Convert?" click) ──────
  async function openConversionReview(idx) {
    var f = _conversionFlagged[idx];
    if (!f) return;
    var st = conversionState(idx);
    st.open = true;
    if (st.prefill) {
      showModal('convert', idx);
      return;
    }
    st.loading = true;
    st.error = null;
    showModal('convert', idx);
    try {
      st.prefill = await fetchEditAllergyForm(f.id);
      var rule = f.rule;
      var patternHint = null;
      if (rule && rule.substance) {
        // A curated, Nick-reviewed rules-file match — pre-SELECTED, not just
        // a search seed (still requires the explicit Convert click below to
        // actually apply).
        st.pendingSubstance = rule.substance;
        st.substanceQuery = rule.substance.description;
      } else {
        // No reviewed match — fall back to the live pattern-extraction
        // heuristic rather than seeding the search with the full raw
        // description. Search-seed ONLY, nothing pre-selected — the
        // clinician must run the search and pick a real result themselves.
        patternHint = extractAllergenAndReactionHint(f.description);
        st.substanceQuery = patternHint.substanceHint;
      }
      // Reaction seed priority: curated rule hint > pattern-extracted hint >
      // the patient's own additionalInformation free text (see
      // pickReactionSeed's own comment for why the last resort matters —
      // found live 2026-08-02, "shivering" was sitting right there unused).
      st.reactionQuery = pickReactionSeed(
        rule && rule.reaction && rule.reaction.text,
        patternHint && patternHint.reactionHint,
        st.prefill && st.prefill.additionalInformation
      );
    } catch (err) {
      st.error = (err && err.message) || 'Failed to load this allergy for conversion.';
    } finally {
      st.loading = false;
      showModal('convert', idx);
    }
  }

  function closeConversionReview(idx) {
    var st = conversionState(idx);
    st.open = false;
    hideModal();
  }

  async function runSubstanceSearch(idx) {
    var st = conversionState(idx);
    var q = (st.substanceQuery || '').trim();
    if (!q || st.substanceLoading) return;
    st.substanceLoading = true;
    st.substanceError = null;
    refreshModal('convert', idx);
    try {
      var results = await searchAllergySubstances(q);
      // Ranked toward the VTM-level candidate — see rankSubstanceResults'
      // own comment. Never discards a result, only reorders.
      st.substanceResults = rankSubstanceResults(normalizedConceptSearchResults(results), q);
    } catch (err) {
      st.substanceError = (err && err.message) || 'Substance search failed — please try again.';
      st.substanceResults = null;
    } finally {
      st.substanceLoading = false;
      refreshModal('convert', idx);
    }
  }

  function applySubstanceResult(idx, conceptId, description, descriptionId) {
    var st = conversionState(idx);
    st.pendingSubstance = { conceptId: conceptId, description: description, descriptionId: descriptionId || null };
    refreshModal('convert', idx);
  }

  async function runReactionSearch(idx) {
    var st = conversionState(idx);
    var q = (st.reactionQuery || '').trim();
    if (!q || st.reactionLoading) return;
    st.reactionLoading = true;
    st.reactionError = null;
    refreshModal('convert', idx);
    try {
      var results = await searchAllergyReactions(q);
      st.reactionResults = normalizedConceptSearchResults(results);
    } catch (err) {
      st.reactionError = (err && err.message) || 'Reaction search failed — please try again.';
      st.reactionResults = null;
    } finally {
      st.reactionLoading = false;
      refreshModal('convert', idx);
    }
  }

  // Reactions are multi-select (found live 2026-08-02: a real entry needed
  // BOTH "shivering" and "bradycardia") — picking a result ADDS it to the
  // pending list rather than replacing a single slot, deduped by conceptId
  // so clicking the same result twice is a no-op, not a double-add.
  function addReactionResult(idx, conceptId, description, descriptionId) {
    var st = conversionState(idx);
    var already = st.pendingReactions.some(function (r) {
      return r.conceptId === conceptId;
    });
    if (!already) {
      st.pendingReactions = st.pendingReactions.concat([
        { conceptId: conceptId, description: description, descriptionId: descriptionId || null },
      ]);
    }
    refreshModal('convert', idx);
  }

  // A picked reaction is always optional (see
  // buildConversionChangeAllergyPayload's own comment) — removing one, or
  // all of them, just means "convert with the substance alone (or the
  // remaining picks)", never a dead end.
  function removeReactionResult(idx, conceptId) {
    var st = conversionState(idx);
    st.pendingReactions = st.pendingReactions.filter(function (r) {
      return r.conceptId !== conceptId;
    });
    refreshModal('convert', idx);
  }

  async function confirmConversion(idx) {
    var f = _conversionFlagged[idx];
    var st = conversionState(idx);
    if (!f || !st.prefill || !st.pendingSubstance || st.saving) return;
    st.saving = true;
    st.saveError = null;
    refreshModal('convert', idx);
    try {
      var payload = buildConversionChangeAllergyPayload(st.prefill, st.pendingSubstance, st.pendingReactions);
      await postChangeAllergy(f.id, payload);
      st.converted = true;
      setTimeout(function () {
        location.reload();
      }, 900);
    } catch (err) {
      st.saveError = (err && err.message) || 'Failed to convert this allergy — please try again.';
    } finally {
      st.saving = false;
      refreshModal('convert', idx);
    }
  }

  // ── Render: junk checklist ──────────────────────────────────────────────────

  function clinicalDetailHtml(f) {
    var parts = [];
    if (f.severity) parts.push('Severity: ' + esc(f.severity));
    if (f.certainty) parts.push('Certainty: ' + esc(f.certainty));
    if (f.additionalInformation) parts.push('Additional info: ' + esc(f.additionalInformation));
    if (f.reactions && f.reactions.length) parts.push('Reaction: ' + esc(f.reactions.join(', ')));
    if (!parts.length) return '';
    return '<span class="ms-ac-row-detail">' + parts.join(' · ') + '</span>';
  }

  function renderJunkChecklist() {
    var selectedCount = _junkFlagged.filter(function (f) {
      return f.checked && isEndable(f);
    }).length;
    var rows = _junkFlagged
      .map(function (f) {
        if (f.ended) {
          return (
            '<label class="ms-ac-row ms-ac-row-ended"><input type="checkbox" checked disabled>' +
            '<span class="ms-ac-row-desc">' +
            esc(f.description) +
            '</span><span class="ms-ac-row-tag">Ended</span></label>'
          );
        }
        return (
          '<label class="ms-ac-row' +
          (f.caution ? ' ms-ac-row-caution' : '') +
          '">' +
          '<input type="checkbox" class="ms-ac-checkbox" data-allergy-id="' +
          esc(f.id) +
          '"' +
          (f.checked ? ' checked' : '') +
          '>' +
          '<span class="ms-ac-row-desc">' +
          esc(f.description) +
          '</span>' +
          (f.reasonEnded ? '<span class="ms-ac-row-reason">' + esc(f.reasonEnded) + '</span>' : '') +
          clinicalDetailHtml(f) +
          (f.caution ? '<span class="ms-ac-row-warn">⚠ ' + esc(f.caution) + '</span>' : '') +
          (f.endError ? '<span class="ms-ac-row-error">' + esc(f.endError) + '</span>' : '') +
          '</label>'
        );
      })
      .join('');
    return (
      '<div class="ms-ac-section">' +
      '<div class="ms-ac-section-title">Junk / low-relevance codes (' +
      _junkFlagged.length +
      ')</div>' +
      '<div class="ms-ac-summary">Usually import noise or low-relevance codes, but not always safe to bulk-remove: ' +
      'rows marked ⚠ either carry severity/certainty/additional info recorded (may be a genuine allergy filed ' +
      "under this code) or are a code that's technically correct but worth a second look before removing — " +
      'either way they need reviewing individually. Nothing is ticked by default, and "Select all" skips ⚠ rows.</div>' +
      '<div class="ms-ac-select-row">' +
      '<button type="button" class="ms-ac-select-all" id="ms-ac-select-all">Select all</button>' +
      '<button type="button" class="ms-ac-select-none" id="ms-ac-select-none">Select none</button>' +
      '</div>' +
      '<div class="ms-ac-list">' +
      rows +
      '</div>' +
      '<div class="ms-ac-end-row">' +
      '<label class="ms-ac-label" for="ms-ac-end-date">End date</label>' +
      '<input type="date" class="ms-ac-date-input" id="ms-ac-end-date" value="' +
      esc(_endDate) +
      '">' +
      '</div>' +
      '<button type="button" class="ms-ac-end-btn" id="ms-ac-end-selected"' +
      (selectedCount === 0 || _ending || !_endDate ? ' disabled' : '') +
      '>' +
      (_ending ? 'Ending…' : 'End ' + selectedCount + ' selected allerg' + (selectedCount === 1 ? 'y' : 'ies')) +
      '</button>' +
      '</div>'
    );
  }

  // ── Render: duplicate group list (each line opens the shared modal) ──────────

  function renderDuplicateSection() {
    var rows = _duplicateGroups
      .map(function (g, idx) {
        return (
          '<button type="button" class="ms-ac-dup-row-btn" data-group="' +
          esc(idx) +
          '">' +
          esc(g.entries.length) +
          ' entries for "' +
          esc(g.description) +
          '" — Review?</button>'
        );
      })
      .join('');
    return (
      '<div class="ms-ac-section">' +
      '<div class="ms-ac-section-title">Possible duplicates (' +
      _duplicateGroups.length +
      ' group' +
      (_duplicateGroups.length === 1 ? '' : 's') +
      ')</div>' +
      '<div class="ms-ac-summary">Every group always needs your review — nothing is merged in bulk.</div>' +
      '<div class="ms-ac-dup-list">' +
      rows +
      '</div>' +
      '</div>'
    );
  }

  // Convertible entries list — same list-of-buttons pattern as duplicate
  // groups, except a "not-an-allergy" match (rules/allergy-substance-
  // conversion.json) is never offered a "Convert?" action at all — it's
  // shown as a plain informational note pointing at removal instead (see
  // that file's own notes for why: these are miscoded, not badly-coded).
  function renderConvertibleSection() {
    var rows = _conversionFlagged
      .map(function (f, idx) {
        if (f.rule && f.rule.kind === 'not-an-allergy') {
          return (
            '<div class="ms-ac-convert-info-row">' +
            esc(f.description) +
            ' — <span class="ms-ac-convert-info-note">' +
            esc(f.rule.notes || 'This may not be a genuine allergy — consider removing instead of converting.') +
            '</span></div>'
          );
        }
        return (
          '<button type="button" class="ms-ac-convert-row-btn" data-conversion="' +
          esc(idx) +
          '">' +
          esc(f.description) +
          ' — Convert?</button>'
        );
      })
      .join('');
    return (
      '<div class="ms-ac-section">' +
      '<div class="ms-ac-section-title">Pre-defined-allergy codes (' +
      _conversionFlagged.length +
      ')</div>' +
      '<div class="ms-ac-summary">Pre-defined-allergy codes are less reliable for prescribing-safety checks ' +
      'than a coded substance. Every conversion always needs your review — nothing is applied automatically.</div>' +
      '<div class="ms-ac-dup-list">' +
      rows +
      '</div>' +
      '</div>'
    );
  }

  // Bulk checklist, same safety class as the junk checklist (see
  // classifyDualCodedEntries's own comment) — but with its own control
  // classes/ids (ms-ac-dual-*), NOT ms-ac-checkbox/ms-ac-select-all/
  // ms-ac-select-none/ms-ac-end-selected, since this section can be visible
  // in the SAME panel alongside the junk checklist and those ids/classes
  // are already claimed by it.
  function renderDualCodedChecklist() {
    var selectedCount = _dualCodedFlagged.filter(function (f) {
      return f.checked && !f.tidied;
    }).length;
    var rows = _dualCodedFlagged
      .map(function (f) {
        if (f.tidied) {
          return (
            '<label class="ms-ac-row ms-ac-row-ended"><input type="checkbox" checked disabled>' +
            '<span class="ms-ac-row-desc">' +
            esc(f.description) +
            '</span><span class="ms-ac-row-tag">Tidied</span></label>'
          );
        }
        return (
          '<label class="ms-ac-row">' +
          '<input type="checkbox" class="ms-ac-dual-checkbox" data-allergy-id="' +
          esc(f.id) +
          '"' +
          (f.checked ? ' checked' : '') +
          '>' +
          '<span class="ms-ac-row-desc">' +
          esc(f.description) +
          '</span>' +
          '<span class="ms-ac-row-detail">Legacy code: ' +
          esc(f.legacyCode.description) +
          ' (' +
          esc(f.legacyCode.conceptId) +
          ') · Current substance: ' +
          esc(f.substance.description) +
          ' (' +
          esc(f.substance.conceptId) +
          ')</span>' +
          (f.tidyError ? '<span class="ms-ac-row-error">' + esc(f.tidyError) + '</span>' : '') +
          '</label>'
        );
      })
      .join('');
    return (
      '<div class="ms-ac-section">' +
      '<div class="ms-ac-section-title">Legacy code alongside substance (' +
      _dualCodedFlagged.length +
      ')</div>' +
      '<div class="ms-ac-summary">These entries carry an old pre-defined-allergy code sitting alongside the ' +
      'already-correct current substance — clearing the old code just tidies the record. Never touches ' +
      'severity, certainty, reactions, or the substance itself.</div>' +
      '<div class="ms-ac-select-row">' +
      '<button type="button" class="ms-ac-dual-select-all" id="ms-ac-dual-select-all">Select all</button>' +
      '<button type="button" class="ms-ac-dual-select-none" id="ms-ac-dual-select-none">Select none</button>' +
      '</div>' +
      '<div class="ms-ac-list">' +
      rows +
      '</div>' +
      '<button type="button" class="ms-ac-end-btn" id="ms-ac-dual-tidy-selected"' +
      (selectedCount === 0 || _dualCodedTidying ? ' disabled' : '') +
      '>' +
      (_dualCodedTidying
        ? 'Tidying…'
        : 'Remove ' + selectedCount + ' selected legacy code' + (selectedCount === 1 ? '' : 's')) +
      '</button>' +
      '</div>'
    );
  }

  // ── Render: shared summary panel ──────────────────────────────────────────────

  function buttonLabel() {
    if (_scanState === 'idle' && _hintGroups.length) {
      return (
        'Clean up allergies (' +
        _hintGroups.length +
        ' possible duplicate' +
        (_hintGroups.length === 1 ? '' : 's') +
        ')?'
      );
    }
    return 'Clean up allergies?';
  }

  function buildHtml() {
    var header =
      '<button type="button" class="ms-ac-toggle" id="ms-ac-toggle" aria-expanded="' +
      _open +
      '">' +
      (_open ? '▾' : '▸') +
      ' ' +
      esc(buttonLabel()) +
      '</button>';
    if (!_open) return header;
    var body;
    if (_scanState === 'scanning') {
      body = '<div class="ms-ac-body"><span class="ms-ac-loading">Scanning allergies…</span></div>';
    } else if (_scanState === 'error') {
      body =
        '<div class="ms-ac-body"><span class="ms-ac-error">' +
        esc(_scanError) +
        '</span> <button type="button" class="ms-ac-retry" id="ms-ac-retry">Retry</button></div>';
    } else if (_scanState === 'done') {
      if (!_junkFlagged.length && !_duplicateGroups.length && !_conversionFlagged.length && !_dualCodedFlagged.length) {
        body =
          '<div class="ms-ac-body"><span class="ms-ac-empty">Nothing to clean up — no known junk/low-relevance ' +
          'codes, possible duplicates, dual-coded entries, or pre-defined-allergy codes found.</span></div>';
      } else {
        body =
          '<div class="ms-ac-body">' +
          (_junkFlagged.length ? renderJunkChecklist() : '') +
          (_dualCodedFlagged.length ? renderDualCodedChecklist() : '') +
          (_duplicateGroups.length ? renderDuplicateSection() : '') +
          (_conversionFlagged.length ? renderConvertibleSection() : '') +
          '</div>';
      }
    } else {
      body = '';
    }
    return header + body;
  }

  function bindEvents(el) {
    el.querySelector('#ms-ac-toggle').addEventListener('click', function () {
      if (_open) {
        _open = false;
        render();
        return;
      }
      _open = true;
      if (_scanState === 'idle') {
        runFullScan();
      } else {
        render();
      }
    });
    el.querySelector('#ms-ac-retry')?.addEventListener('click', function () {
      runFullScan();
    });
    el.querySelectorAll('.ms-ac-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-allergy-id');
        var f = _junkFlagged.find(function (x) {
          return x.id === id;
        });
        if (f) f.checked = cb.checked;
        render();
      });
    });
    el.querySelector('#ms-ac-select-all')?.addEventListener('click', function () {
      _junkFlagged.forEach(function (f) {
        if (isEndable(f) && !f.caution) f.checked = true;
      });
      render();
    });
    el.querySelector('#ms-ac-select-none')?.addEventListener('click', function () {
      _junkFlagged.forEach(function (f) {
        f.checked = false;
      });
      render();
    });
    el.querySelector('#ms-ac-end-date')?.addEventListener('input', function (e) {
      _endDate = e.target.value;
    });
    el.querySelector('#ms-ac-end-selected')?.addEventListener('click', function () {
      endSelectedJunk();
    });
    el.querySelectorAll('.ms-ac-dup-row-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openReview(Number(btn.getAttribute('data-group')));
      });
    });
    el.querySelectorAll('.ms-ac-convert-row-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openConversionReview(Number(btn.getAttribute('data-conversion')));
      });
    });
    el.querySelectorAll('.ms-ac-dual-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-allergy-id');
        var f = _dualCodedFlagged.find(function (x) {
          return x.id === id;
        });
        if (f) f.checked = cb.checked;
        render();
      });
    });
    el.querySelector('#ms-ac-dual-select-all')?.addEventListener('click', function () {
      _dualCodedFlagged.forEach(function (f) {
        if (!f.tidied) f.checked = true;
      });
      render();
    });
    el.querySelector('#ms-ac-dual-select-none')?.addEventListener('click', function () {
      _dualCodedFlagged.forEach(function (f) {
        f.checked = false;
      });
      render();
    });
    el.querySelector('#ms-ac-dual-tidy-selected')?.addEventListener('click', function () {
      tidySelectedDualCoded();
    });
  }

  function render() {
    var el = document.getElementById('ms-ac-widget');
    if (!el) return;
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  // ── Render: duplicate-merge modal (unchanged from the retired widget) ────────

  function fieldLabel(field) {
    return (
      {
        severity: 'Severity',
        certainty: 'Certainty',
        additionalInformation: 'Additional info',
        allergyReactions: 'Reaction(s)',
        onsetDate: 'Onset date',
      }[field] || field
    );
  }

  function fieldValueLabel(field, value) {
    if (field === 'allergyReactions') {
      return (Array.isArray(value) ? value : [])
        .map(function (r) {
          return r && r.description;
        })
        .filter(Boolean)
        .join(', ');
    }
    return String(value == null ? '' : value);
  }

  function entryCardHtml(idx, st, e) {
    var isKeeper = st.keeperId === e.id;
    var ov = e.overview || {};
    var lines = [
      cardDetailLineHtml('Severity', fieldValueLabel('severity', ov.severity)),
      cardDetailLineHtml('Certainty', fieldValueLabel('certainty', ov.certainty)),
      cardDetailLineHtml('Additional info', fieldValueLabel('additionalInformation', ov.additionalInformation)),
      cardDetailLineHtml('Reaction(s)', fieldValueLabel('allergyReactions', ov.allergyReactions)),
      cardDetailLineHtml('Onset', fieldValueLabel('onsetDate', ov.onsetDate)),
    ]
      .filter(Boolean)
      .join('');
    var conceptNote =
      e.groupedBy === 'concept'
        ? '<div class="ms-ac-card-concept-note">Different code — SNOMED links this to ' +
          (e.relatedToDescription ? '"' + esc(e.relatedToDescription) + '"' : 'another entry here') +
          ' as the same underlying allergen.</div>'
        : '';
    // A plain <div>, not a <label> — the whole card is still click-to-select-
    // keeper (wired in bindDuplicateModalEvents, proxying to the radio
    // below), but that's done in JS now rather than native label semantics,
    // specifically so the "Remove from merge" checkbox+text can be a REAL
    // (non-nested) <label> of its own — nesting one label inside another is
    // invalid HTML with inconsistent browser behaviour, not worth risking
    // in clinical software.
    return (
      '<div class="ms-ac-card' +
      (isKeeper ? ' ms-ac-card-keeper' : '') +
      '">' +
      '<input type="radio" class="ms-ac-card-radio" name="ms-ac-keeper-' +
      esc(idx) +
      '" data-entry-id="' +
      esc(e.id) +
      '"' +
      (isKeeper ? ' checked' : '') +
      '>' +
      '<label class="ms-ac-card-remove-row">' +
      '<input type="checkbox" class="ms-ac-card-remove-checkbox" data-remove-entry="' +
      esc(e.id) +
      '" data-group="' +
      esc(idx) +
      '"> Remove from merge' +
      '</label>' +
      '<div class="ms-ac-card-badge' +
      (isKeeper ? '' : ' ms-ac-card-badge-other') +
      '">' +
      (isKeeper ? '✓ KEEP' : 'Other copy') +
      '</div>' +
      '<div class="ms-ac-card-title">' +
      esc(e.description) +
      '</div>' +
      conceptNote +
      '<div class="ms-ac-card-date">' +
      (ov.recordDate ? 'Recorded ' + esc(ov.recordDate) : '<span class="ms-ac-card-muted">No record date</span>') +
      '</div>' +
      (lines || '<div class="ms-ac-card-muted ms-ac-card-line">No other clinical detail recorded</div>') +
      '</div>'
    );
  }

  function cardDetailLineHtml(label, value) {
    if (!value) return '';
    return (
      '<div class="ms-ac-card-line"><span class="ms-ac-card-line-label">' +
      esc(label) +
      ':</span> ' +
      esc(value) +
      '</div>'
    );
  }

  function fieldTableHtml(idx, st, active) {
    var colHeaders = active
      .map(function (e) {
        var isKeeper = st.keeperId === e.id;
        return (
          '<th class="ms-ac-th' +
          (isKeeper ? ' ms-ac-th-keep' : '') +
          '">' +
          (isKeeper ? '✓ KEEP — kept copy' : 'Other copy') +
          '</th>'
        );
      })
      .join('');

    var lockedRow =
      '<tr><td class="ms-ac-row-label">Recorded <span class="ms-ac-locked-mark" title="Always kept from the keeper copy">🔒</span></td>' +
      active
        .map(function (e) {
          var isKeeper = st.keeperId === e.id;
          var v = e.overview && e.overview.recordDate;
          return (
            '<td class="ms-ac-td ms-ac-td-locked' +
            (isKeeper ? ' ms-ac-td-keep' : '') +
            '">' +
            (v ? esc(v) : '<span class="ms-ac-td-none">(none)</span>') +
            '</td>'
          );
        })
        .join('') +
      '</tr>';

    var fieldRows = MERGEABLE_FIELDS.map(function (field) {
      var values = fieldValuesByEntry(active, field);
      if (!Object.keys(values).length) return '';
      var cells = active
        .map(function (e) {
          var isKeeper = st.keeperId === e.id;
          var cellClass = 'ms-ac-td' + (isKeeper ? ' ms-ac-td-keep' : '');
          if (values[e.id] === undefined) {
            return '<td class="' + cellClass + '"><span class="ms-ac-td-none">(none)</span></td>';
          }
          var label = fieldValueLabel(field, values[e.id]);
          return (
            '<td class="' +
            cellClass +
            '"><label class="ms-ac-td-radio"><input type="radio" name="ms-ac-field-' +
            esc(idx) +
            '-' +
            esc(field) +
            '" data-field="' +
            esc(field) +
            '" data-entry-id="' +
            esc(e.id) +
            '"' +
            (st.chosen[field] === e.id ? ' checked' : '') +
            '><span>' +
            esc(label) +
            '</span></label></td>'
          );
        })
        .join('');
      return (
        '<tr><td class="ms-ac-row-label">' +
        esc(fieldLabel(field)) +
        ' <span class="ms-ac-mergeable-mark" title="Mergeable — pick which copy\'s value to use">✎</span></td>' +
        cells +
        '</tr>'
      );
    }).join('');

    return (
      '<table class="ms-ac-table"><thead><tr><th></th>' +
      colHeaders +
      '</tr></thead><tbody>' +
      lockedRow +
      (fieldRows ||
        '<tr><td colspan="' +
          (active.length + 1) +
          '" class="ms-ac-empty">No differing clinical detail found between these entries.</td></tr>') +
      '</tbody></table>'
    );
  }

  function groupSubtitleHtml(group) {
    var counts = {};
    var order = [];
    group.entries.forEach(function (e) {
      if (!counts[e.description]) {
        counts[e.description] = 0;
        order.push(e.description);
      }
      counts[e.description]++;
    });
    if (order.length <= 1) {
      return esc(group.entries.length) + ' entries for "' + esc(group.description) + '"';
    }
    return (
      esc(group.entries.length) +
      ' entries — ' +
      order
        .map(function (d) {
          return esc(counts[d]) + ' as "' + esc(d) + '"';
        })
        .join(', ')
    );
  }

  function duplicateModalBodyHtml(idx) {
    var group = _duplicateGroups[idx];
    var st = groupState(idx);

    if (st.loading || st.error || st.merged || !st.entries) {
      var loadingHeader =
        '<div class="ms-ac-modal-header">' +
        '<div><div class="ms-ac-modal-title">Review duplicate allergy entries</div>' +
        '<div class="ms-ac-modal-subtitle">' +
        groupSubtitleHtml(group) +
        '</div></div>' +
        '<button type="button" class="ms-ac-modal-close" data-group="' +
        esc(idx) +
        '" aria-label="Close">✕</button>' +
        '</div>';
      if (st.loading) {
        return (
          loadingHeader +
          '<div class="ms-ac-modal-body"><span class="ms-ac-loading">Loading for comparison…</span></div>'
        );
      }
      if (st.error) {
        return (
          loadingHeader +
          '<div class="ms-ac-modal-body"><span class="ms-ac-error">' +
          esc(st.error) +
          '</span> <button type="button" class="ms-ac-retry" data-group="' +
          esc(idx) +
          '">Retry</button></div>'
        );
      }
      if (st.merged) {
        return loadingHeader + '<div class="ms-ac-modal-body"><span class="ms-ac-done">Merged.</span></div>';
      }
      return loadingHeader + '<div class="ms-ac-modal-body"></div>';
    }

    // "Remove from merge" — entries excluded from THIS review (see
    // removeFromMerge's own comment) are filtered out of every rendered
    // part below, but kept in st.entries so they can be restored.
    var active = filterActiveEntries(st.entries, st.removedIds);
    var removedEntries = st.entries.filter(function (e) {
      return st.removedIds.has(e.id);
    });
    var header =
      '<div class="ms-ac-modal-header">' +
      '<div><div class="ms-ac-modal-title">Review duplicate allergy entries</div>' +
      '<div class="ms-ac-modal-subtitle">' +
      groupSubtitleHtml({ entries: active, description: group.description }) +
      '</div></div>' +
      '<button type="button" class="ms-ac-modal-close" data-group="' +
      esc(idx) +
      '" aria-label="Close">✕</button>' +
      '</div>';
    var removedNoteHtml = removedEntries.length
      ? '<div class="ms-ac-removed-note">' +
        removedEntries.length +
        ' removed from this merge: ' +
        removedEntries
          .map(function (e) {
            return (
              esc(e.description) +
              ' (<button type="button" class="ms-ac-restore-btn" data-restore="' +
              esc(e.id) +
              '" data-group="' +
              esc(idx) +
              '">Restore</button>)'
            );
          })
          .join(' · ') +
        '</div>'
      : '';

    if (active.length < 2) {
      return (
        header +
        '<div class="ms-ac-modal-body">' +
        removedNoteHtml +
        '<div class="ms-ac-empty">Only ' +
        active.length +
        (active.length === 1 ? ' entry is' : ' entries are') +
        ' left in this group — nothing to merge. Close this review, or restore an entry above.</div></div>'
      );
    }

    var cards = active
      .map(function (e) {
        return entryCardHtml(idx, st, e);
      })
      .join('');

    return (
      header +
      '<div class="ms-ac-modal-body">' +
      removedNoteHtml +
      '<div class="ms-ac-note">This always requires your review — nothing here is applied in bulk. Pick ' +
      'which entry to keep, and for each field that differs, which entry’s value to use. The others are ' +
      'ended (never deleted) with a clear audit reason. Anything marked "Remove from merge" is left ' +
      'completely untouched.</div>' +
      '<div class="ms-ac-cards">' +
      cards +
      '</div>' +
      '<div class="ms-ac-hint">Click a card, or a row in the table below, to change which copy is kept.</div>' +
      fieldTableHtml(idx, st, active) +
      '<div class="ms-ac-hint">Additional info is edited freely, not auto-merged — duplicate copies are ' +
      "usually near-identical or junk here. Pick a radio above to load that copy's text (replacing this " +
      'box), or type/combine details from any copy yourself.</div>' +
      '<label class="ms-ac-label" for="ms-ac-ai-text-' +
      esc(idx) +
      '">Additional info</label>' +
      '<textarea class="ms-ac-ai-textarea" id="ms-ac-ai-text-' +
      esc(idx) +
      '" data-group="' +
      esc(idx) +
      '" rows="3">' +
      esc(st.additionalInfoText || '') +
      '</textarea>' +
      '<div class="ms-ac-end-row">' +
      '<label class="ms-ac-label" for="ms-ac-modal-end-date-' +
      esc(idx) +
      '">End date (for the merged-away entries)</label>' +
      '<input type="date" class="ms-ac-date-input" id="ms-ac-modal-end-date-' +
      esc(idx) +
      '" data-group="' +
      esc(idx) +
      '" value="' +
      esc(st.endDate) +
      '">' +
      '</div>' +
      (st.saveError ? '<div class="ms-ac-error">' + esc(st.saveError) + '</div>' : '') +
      '<div class="ms-ac-actions">' +
      '<button type="button" class="ms-ac-confirm-btn" data-group="' +
      esc(idx) +
      '"' +
      (st.saving || !st.endDate ? ' disabled' : '') +
      '>' +
      (st.saving ? 'Merging…' : 'Merge and end duplicates') +
      '</button>' +
      '<button type="button" class="ms-ac-cancel-btn" data-group="' +
      esc(idx) +
      '">Cancel</button>' +
      '</div>' +
      '</div>'
    );
  }

  // ── Render: conversion modal — search + explicit confirm, never apply-on-click ─
  // Deliberately different from problem-description-cleanup.js's own manual
  // search (which POSTs immediately on a result click) — converting an
  // allergy's code identity is more consequential than fixing a problem's
  // description text, and every other action in this widget already
  // requires an explicit confirm button. Picking a result here only sets a
  // PENDING selection (shown, editable by searching again); "Convert" is a
  // separate, deliberate click. Shared between the substance box (always
  // shown) and the optional reaction box (substance-plus-reaction kind
  // only) via `fieldPrefix` — same tri-state loading/error/empty pattern
  // for both, just a different target state field.
  // `opts.pendingHtml` is a fully-rendered string the CALLER builds — the
  // substance box (single pending pick) and reaction box (0+ pending picks,
  // each individually removable — see addReactionResult/removeReactionResult)
  // have different-shaped pending state, so this function only owns the
  // shared query-input/search-button/results-list plumbing, not how a pick
  // is displayed once made.
  function conceptSearchSectionHtml(idx, opts) {
    var inputId = 'ms-ac-conv-' + opts.fieldPrefix + '-input-' + idx;
    var resultsHtml = '';
    if (opts.loading) {
      resultsHtml = '<div class="ms-ac-loading">Searching…</div>';
    } else if (opts.error) {
      resultsHtml = '<div class="ms-ac-error">' + esc(opts.error) + '</div>';
    } else if (Array.isArray(opts.results)) {
      // conceptId shown alongside every result, not just after picking —
      // 2026-08-02 live-testing feedback: Medicus's own search UI already
      // has a known problem showing several identically-labelled results
      // with no way to tell them apart; ours shouldn't repeat that.
      resultsHtml = !opts.results.length
        ? '<div class="ms-ac-empty">No results.</div>'
        : '<div class="ms-ac-conv-results">' +
          opts.results
            .map(function (r) {
              return (
                '<button type="button" class="ms-ac-conv-result" data-conv-pick="' +
                esc(opts.fieldPrefix) +
                '" data-idx="' +
                esc(idx) +
                '" data-concept-id="' +
                esc(r.conceptId) +
                '" data-description-id="' +
                esc(r.descriptionId || '') +
                '" data-description="' +
                esc(r.description) +
                '">' +
                esc(r.description) +
                ' <span class="ms-ac-conv-result-id">(' +
                esc(r.conceptId) +
                ')</span></button>'
              );
            })
            .join('') +
          '</div>';
    }
    return (
      '<div class="ms-ac-conv-search-section">' +
      '<label class="ms-ac-label" for="' +
      inputId +
      '">' +
      esc(opts.label) +
      '</label>' +
      (opts.pendingHtml || '') +
      '<div class="ms-ac-conv-search-row">' +
      '<input type="text" class="ms-ac-conv-search-input" id="' +
      inputId +
      '" data-conv-query="' +
      esc(opts.fieldPrefix) +
      '" data-idx="' +
      esc(idx) +
      '" value="' +
      esc(opts.query || '') +
      '">' +
      '<button type="button" class="ms-ac-conv-search-btn" data-conv-search="' +
      esc(opts.fieldPrefix) +
      '" data-idx="' +
      esc(idx) +
      '"' +
      (opts.loading ? ' disabled' : '') +
      '>Search</button>' +
      '</div>' +
      resultsHtml +
      '</div>'
    );
  }

  function conversionModalBodyHtml(idx) {
    var f = _conversionFlagged[idx];
    var st = conversionState(idx);
    var header =
      '<div class="ms-ac-modal-header">' +
      '<div><div class="ms-ac-modal-title">Convert to substance</div>' +
      '<div class="ms-ac-modal-subtitle">' +
      esc(f ? f.description : '') +
      '</div></div>' +
      '<button type="button" class="ms-ac-modal-close" aria-label="Close">✕</button>' +
      '</div>';

    if (!f) return header + '<div class="ms-ac-modal-body"></div>';
    if (st.loading) {
      return header + '<div class="ms-ac-modal-body"><span class="ms-ac-loading">Loading…</span></div>';
    }
    if (st.error) {
      return (
        header +
        '<div class="ms-ac-modal-body"><span class="ms-ac-error">' +
        esc(st.error) +
        '</span> <button type="button" class="ms-ac-retry">Retry</button></div>'
      );
    }
    if (st.converted) {
      return header + '<div class="ms-ac-modal-body"><span class="ms-ac-done">Converted.</span></div>';
    }

    var rule = f.rule;
    var ruleNoteHtml = rule && rule.notes ? '<div class="ms-ac-note">' + esc(rule.notes) + '</div>' : '';
    var ov = st.prefill || {};

    // "Current record" — shown FIRST and in full, not condensed into a
    // one-line afterthought below the search boxes (2026-08-02 live-testing
    // feedback: the clinician should see everything that's carrying across
    // BEFORE picking a substance, not have to hunt for it after). Reuses the
    // same card-line rendering the duplicate-merge modal already uses.
    var currentLines = [
      cardDetailLineHtml('Severity', fieldValueLabel('severity', ov.severity)),
      cardDetailLineHtml('Certainty', fieldValueLabel('certainty', ov.certainty)),
      cardDetailLineHtml('Additional info', fieldValueLabel('additionalInformation', ov.additionalInformation)),
      cardDetailLineHtml('Existing reaction(s)', fieldValueLabel('allergyReactions', ov.allergyReactions)),
      cardDetailLineHtml('Onset', fieldValueLabel('onsetDate', ov.onsetDate)),
      cardDetailLineHtml('Recorded', fieldValueLabel('recordDate', ov.recordDate)),
    ]
      .filter(Boolean)
      .join('');
    var currentRecordHtml =
      '<div class="ms-ac-conv-current">' +
      '<div class="ms-ac-conv-current-title">Current record — carried through unchanged unless you pick a new reaction below</div>' +
      (currentLines || '<div class="ms-ac-card-muted ms-ac-card-line">No other clinical detail recorded</div>') +
      '</div>';

    // Substance: single pending pick, shown/replaced as one line.
    var substancePendingHtml = st.pendingSubstance
      ? '<div class="ms-ac-conv-pending">Selected: <strong>' +
        esc(st.pendingSubstance.description) +
        '</strong> (' +
        esc(st.pendingSubstance.conceptId) +
        ')</div>'
      : '';
    // Reaction: 0+ pending picks (multi-select — see addReactionResult's own
    // comment), each its own removable chip.
    var reactionPendingHtml = st.pendingReactions.length
      ? '<div class="ms-ac-conv-pending-list">' +
        st.pendingReactions
          .map(function (r) {
            return (
              '<div class="ms-ac-conv-pending">Selected: <strong>' +
              esc(r.description) +
              '</strong> (' +
              esc(r.conceptId) +
              ') <button type="button" class="ms-ac-conv-clear-btn" data-conv-remove-reaction="' +
              esc(idx) +
              '" data-remove-concept-id="' +
              esc(r.conceptId) +
              '">Remove</button></div>'
            );
          })
          .join('') +
        '</div>'
      : '';

    // Substance and reaction search always shown together, side by side —
    // never gated behind picking the allergen first (2026-08-02
    // live-testing feedback). Picking a reaction is always optional, for
    // any conversion, not just decompose-shaped ones — a clinician
    // converting e.g. "Cat allergy" may still want to add a reaction the
    // code itself never named, and can pick MORE THAN ONE (e.g. a patient
    // with both "shivering" and "bradycardia" to the same substance).
    var body =
      '<div class="ms-ac-modal-body">' +
      '<div class="ms-ac-note">Pick the substance this allergy is really to. Severity, certainty, additional ' +
      'info and (unless you pick a new reaction below) existing reactions are all carried through unchanged.</div>' +
      ruleNoteHtml +
      currentRecordHtml +
      conceptSearchSectionHtml(idx, {
        fieldPrefix: 'substance',
        label: 'Substance',
        query: st.substanceQuery,
        loading: st.substanceLoading,
        error: st.substanceError,
        results: st.substanceResults,
        pendingHtml: substancePendingHtml,
      }) +
      conceptSearchSectionHtml(idx, {
        fieldPrefix: 'reaction',
        label: 'Reaction(s) (optional)',
        query: st.reactionQuery,
        loading: st.reactionLoading,
        error: st.reactionError,
        results: st.reactionResults,
        pendingHtml: reactionPendingHtml,
      }) +
      (st.saveError ? '<div class="ms-ac-error">' + esc(st.saveError) + '</div>' : '') +
      '<div class="ms-ac-actions">' +
      '<button type="button" class="ms-ac-conv-confirm-btn"' +
      (st.saving || !st.pendingSubstance ? ' disabled' : '') +
      '>' +
      (st.saving ? 'Converting…' : 'Convert') +
      '</button>' +
      '<button type="button" class="ms-ac-cancel-btn">Cancel</button>' +
      '</div>' +
      '</div>';

    return header + body;
  }

  function bindConversionModalEvents(root, idx) {
    var st = conversionState(idx);
    root.querySelector('.ms-ac-modal-backdrop')?.addEventListener('click', function () {
      closeConversionReview(idx);
    });
    root.querySelector('.ms-ac-modal-close')?.addEventListener('click', function () {
      closeConversionReview(idx);
    });
    root.querySelector('.ms-ac-cancel-btn')?.addEventListener('click', function () {
      closeConversionReview(idx);
    });
    root.querySelector('.ms-ac-retry')?.addEventListener('click', function () {
      st.prefill = null;
      openConversionReview(idx);
    });
    root.querySelectorAll('input[data-conv-query]').forEach(function (input) {
      var field = input.getAttribute('data-conv-query');
      input.addEventListener('input', function (e) {
        if (field === 'substance') st.substanceQuery = e.target.value;
        else st.reactionQuery = e.target.value;
      });
      input.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (field === 'substance') runSubstanceSearch(idx);
        else runReactionSearch(idx);
      });
    });
    root.querySelectorAll('[data-conv-search]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.getAttribute('data-conv-search');
        if (field === 'substance') runSubstanceSearch(idx);
        else runReactionSearch(idx);
      });
    });
    root.querySelectorAll('[data-conv-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.getAttribute('data-conv-pick');
        var conceptId = btn.getAttribute('data-concept-id');
        var description = btn.getAttribute('data-description');
        var descriptionId = btn.getAttribute('data-description-id') || null;
        if (field === 'substance') applySubstanceResult(idx, conceptId, description, descriptionId);
        else addReactionResult(idx, conceptId, description, descriptionId);
      });
    });
    root.querySelectorAll('[data-conv-remove-reaction]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        removeReactionResult(idx, btn.getAttribute('data-remove-concept-id'));
      });
    });
    root.querySelector('.ms-ac-conv-confirm-btn')?.addEventListener('click', function () {
      confirmConversion(idx);
    });
  }

  function ensureModalRoot() {
    if (_modalRoot && document.body.contains(_modalRoot)) return _modalRoot;
    _modalRoot = document.createElement('div');
    _modalRoot.id = 'ms-ac-modal-root';
    _modalRoot.className = 'ms-ac-modal-root';
    _modalRoot.style.display = 'none';
    document.body.appendChild(_modalRoot);
    return _modalRoot;
  }

  // Generalized modal shell — hosts EITHER a duplicate-group review OR a
  // conversion review, keyed by {kind, idx}, since only one modal can be
  // open at a time either way (same discipline as before, just no longer
  // assuming every open modal is a duplicate review).
  function _onModalKeydown(e) {
    if (e.key !== 'Escape' || !_modalRoot) return;
    var kind = _modalRoot.dataset.kind;
    var idx = _modalRoot.dataset.idx;
    if (idx == null || idx === '') return;
    if (kind === 'convert') closeConversionReview(Number(idx));
    else closeReview(Number(idx));
  }

  function bindDuplicateModalEvents(root, idx) {
    var st = groupState(idx);
    root.querySelector('.ms-ac-modal-backdrop')?.addEventListener('click', function () {
      closeReview(idx);
    });
    root.querySelector('.ms-ac-modal-close')?.addEventListener('click', function () {
      closeReview(idx);
    });
    root.querySelector('.ms-ac-cancel-btn')?.addEventListener('click', function () {
      closeReview(idx);
    });
    root.querySelector('.ms-ac-retry')?.addEventListener('click', function () {
      st.entries = null;
      openReview(idx);
    });
    // Cards are plain <div>s now, not <label>s (see entryCardHtml's own
    // comment on why) — proxy a card-body click to the radio underneath,
    // UNLESS the click landed in the "Remove from merge" row, which owns
    // its own real <label> and must not also select this as keeper.
    root.querySelectorAll('.ms-ac-card').forEach(function (card) {
      card.addEventListener('click', function (ev) {
        if (ev.target.closest('.ms-ac-card-remove-row')) return;
        var radio = card.querySelector('.ms-ac-card-radio');
        if (radio && !radio.checked) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });
    root.querySelectorAll('input[name="ms-ac-keeper-' + idx + '"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        st.keeperId = radio.getAttribute('data-entry-id');
        refreshModal('duplicate', idx);
      });
    });
    root.querySelectorAll('.ms-ac-card-remove-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function (ev) {
        ev.stopPropagation();
        if (cb.checked) removeFromMerge(idx, cb.getAttribute('data-remove-entry'));
      });
    });
    root.querySelectorAll('.ms-ac-restore-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        restoreToMerge(idx, btn.getAttribute('data-restore'));
      });
    });
    root.querySelectorAll('input[data-field]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        var field = radio.getAttribute('data-field');
        var entryId = radio.getAttribute('data-entry-id');
        st.chosen[field] = entryId;
        if (field === 'additionalInformation') {
          var active = filterActiveEntries(st.entries, st.removedIds);
          var entry = active.find(function (e) {
            return e.id === entryId;
          });
          st.additionalInfoText = (entry && entry.overview && entry.overview.additionalInformation) || '';
          refreshModal('duplicate', idx);
        }
      });
    });
    root.querySelector('.ms-ac-ai-textarea')?.addEventListener('input', function (e) {
      st.additionalInfoText = e.target.value;
    });
    root.querySelector('.ms-ac-date-input')?.addEventListener('input', function (e) {
      st.endDate = e.target.value;
    });
    root.querySelector('.ms-ac-confirm-btn')?.addEventListener('click', function () {
      confirmMerge(idx);
    });
  }

  function showModal(kind, idx) {
    var root = ensureModalRoot();
    root.dataset.kind = kind;
    root.dataset.idx = String(idx);
    var body = kind === 'convert' ? conversionModalBodyHtml(idx) : duplicateModalBodyHtml(idx);
    root.innerHTML =
      '<div class="ms-ac-modal-backdrop"></div><div class="ms-ac-modal" role="dialog" aria-modal="true">' +
      body +
      '</div>';
    root.style.display = 'block';
    if (kind === 'convert') bindConversionModalEvents(root, idx);
    else bindDuplicateModalEvents(root, idx);
    document.addEventListener('keydown', _onModalKeydown);
  }

  function refreshModal(kind, idx) {
    if (!_modalRoot || _modalRoot.style.display === 'none') return;
    if (_modalRoot.dataset.kind !== kind || _modalRoot.dataset.idx !== String(idx)) return;
    showModal(kind, idx);
  }

  function hideModal() {
    if (!_modalRoot) return;
    _modalRoot.style.display = 'none';
    _modalRoot.innerHTML = '';
    document.removeEventListener('keydown', _onModalKeydown);
  }

  // ── Injection: ONE "Clean up allergies?" trigger, placed above the first
  // allergy row ──────────────────────────────────────────────────────────────
  // Non-destructive — refreshed in place on every rescan, never
  // removed-then-reinserted (the multi-widget destroy/reinsert bug that hit
  // the retired duplicate-merge widget twice cannot recur here since there
  // is only ever one widget node).
  function injectTrigger() {
    var existing = document.getElementById('ms-ac-widget');
    if (existing) {
      // Refresh the trigger label (hint count may have changed) without
      // touching an already-open panel's scan results.
      if (!_open) {
        existing.innerHTML = buildHtml();
        bindEvents(existing);
      }
      return;
    }
    if (!_allergiesCache || !_allergiesCache.length) return;
    var scopeEl = findAllergiesSectionRoot();
    if (!scopeEl) return;
    var row = findFirstAllergyRow(_allergiesCache, scopeEl);
    if (!row) return;
    var list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-ac-widget';
    w.innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Scan (cheap summary fetch) + re-injection ─────────────────────────────────
  var _throttle = null;
  function scheduleScan() {
    if (_throttle) return;
    _throttle = setTimeout(function () {
      _throttle = null;
      if (!document.hidden) ensureAllergiesLoaded();
    }, 400);
  }

  function _isOwnMutation(mutations) {
    for (var m of mutations) {
      if (
        m.target &&
        m.target.nodeType === 1 &&
        m.target.closest &&
        (m.target.closest('#ms-ac-widget') || m.target.closest('#ms-ac-modal-root'))
      ) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-ac-widget' || n.id === 'ms-ac-modal-root') continue;
          if (n.closest && (n.closest('#ms-ac-widget') || n.closest('#ms-ac-modal-root'))) continue;
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

  // Safety-net periodic rescan — mutation-driven scheduling alone can get
  // permanently stuck if the page goes idle right after a transient
  // row-lookup failure with no further mutations to trigger a retry. Cheap
  // and safe: injectTrigger is non-destructive and a no-op when nothing has
  // changed.
  setInterval(function () {
    if (!document.hidden) scheduleScan();
  }, 5000);
})();
