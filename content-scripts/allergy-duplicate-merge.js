// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Review duplicates?" widget for merging duplicate allergy
// entries. Separate widget from content-scripts/allergy-junk-code-cleanup.js
// ("Bulk remove?" for known import-artefact codes) — deliberate split,
// explicit user decision 2026-07-29: junk-code removal is safe to offer as a
// checklist with a shared bulk action; merging genuine duplicate allergy
// records is NOT — it "warrants a conscious clinical decision" per entry
// group, so there is NO bulk action anywhere in this file, only one
// per-group "Review duplicates?" trigger that always requires the clinician
// to walk through a real comparison before anything is saved or ended.
//
// DETECTION — TWO passes, same trigger, same modal (2026-07-30, following
// live confirmation on a real 6-duplicate peanut-allergy patient):
//
//   PASS 1 (synchronous, no fetches): groups clinical-summary/summary's
//   cheap allergies[] list by exact (trimmed, case-insensitive)
//   allergyCodeDescription — the SAME cheap list allergy-junk-code-cleanup.js
//   already uses, real duplication already confirmed live 2026-07-29 (HAR
//   capture: converting one allergy code produced two entries both reading
//   "Amoxicillin"). Renders the "N possible duplicates — Review?" trigger(s)
//   immediately — zero fetch cost, unchanged from the original build.
//
//   PASS 2 (async, backgrounded, ONE pass per patient page-load): fetches
//   overview-allergy for every active entry (conceptId — the cheap list
//   doesn't carry one, mirrors allergy-junk-code-cleanup.js's own existing
//   proactive fetch-every-active-allergy pattern, not a new one), then each
//   DISTINCT conceptId's ancestor (IS-A) closure via Medicus's own search
//   endpoint (same confirmed outputParentConceptIds=1 bare-SCTID-query
//   mechanism already proven live for problems in
//   problem-description-cleanup.js's SEARCH_PATH — allergy finding-type
//   concepts sit under the same "Clinical finding" top-level hierarchy, so
//   the same five constrainingParentConcepts apply; NOT yet independently
//   live-confirmed for an allergy conceptId specifically, so
//   fetchAncestorConceptIds fails closed — null, no ancestry check — on any
//   error rather than guessing). Two entries are then the SAME underlying
//   allergen when their conceptIds are identical OR one is a genuine
//   ancestor of the other (isSameAllergenConcept) — deliberately NOT "shares
//   any common ancestor somewhere in the tree", which would over-group
//   unrelated allergies sitting under the same broad category.
//
//   REAL INVESTIGATION THAT SHAPED THIS (2026-07-30, live termbrowser API
//   lookups, real patient with 6 "Peanut allergy" duplicates PLUS one
//   "Peanut-induced anaphylaxis"): 241933001 "Peanut-induced anaphylaxis" IS-A
//   DIRECTLY 91935009 "Allergy to peanut", and both share Causative Agent
//   762952008 "Peanut (substance)" — a genuine same-allergen duplicate pass
//   1 can't see (different wording). The patient ALSO has 294317009 "Allergy
//   to Arachis oil" — checked and confirmed this is NOT the same allergen by
//   this mechanism: its Causative Agent is 417889008 "Arachis oil
//   (substance)", modelled entirely under the "Fixed oil"/"oil derived from
//   plant" hierarchy with NO ancestor/descendant link to "Peanut
//   (substance)" or "Allergy to peanut" at all — which matches the real
//   clinical fact that refined arachis/peanut oil has the allergenic protein
//   removed and is often tolerated by peanut-allergic patients. The strict
//   ancestor/descendant check (never "common ancestor") is what correctly
//   leaves this entry alone rather than silently merging away a deliberately
//   distinct clinical fact.
//
//   PRESENTATION (explicit user decision 2026-07-30): pass-2 entries join
//   the SAME trigger/group as any pass-1 text match, not a separate/more
//   cautious one — but each entry carries `groupedBy: 'text' | 'concept'`
//   (and `relatedToDescription` for a 'concept' entry) so the review modal
//   can show ITS reasoning ("identical text" vs "SNOMED links this to
//   \"Peanut allergy\" as the same underlying allergen") rather than
//   presenting a bare list.
//
// CONFIRMED CONTRACT (live HAR captures, 2026-07-29, real test patient —
// see allergy-junk-code-cleanup.js's own header comment for the
// create/overview/end-allergy contract, all shared with this widget):
//
//   GET  /clinical/data/allergy/overview-allergy/{allergyId}
//        → full detail per entry, used to populate the comparison view
//        (severity, certainty, additionalInformation, allergyReactions,
//        onsetDate, recordDate — the fields the clinician can pick between).
//   GET  /clinical/data/allergy/edit-allergy/{allergyId}
//        → the chosen KEEPER's own edit-form prefill, fetched only once the
//        clinician confirms — needed for the organisation-lock fields
//        (recordedAtAnotherOrganisation/recordedByOrganisation/
//        recordedByPractitioner vs recordedByStaff) that overview-allergy
//        doesn't carry. CONFIRMED live (both HAR32 and HAR35) that
//        change-allergy's payload branches on recordedAtAnotherOrganisation
//        EXACTLY like edit-problem's own payload does — recordedByStaff when
//        false, recordedByOrganisation+recordedByPractitioner when true.
//        recordedByOrganisation can arrive WRAPPED in a UI-select shape
//        ({label, value:{organisationName, …}}) rather than the plain object
//        the POST needs — same quirk already confirmed and fixed for
//        problems (problem-description-cleanup.js's own
//        unwrapRecordedByOrganisation) — applied here by the same proven
//        fix, not yet independently re-confirmed for a POPULATED allergy
//        example specifically (only ever seen null so far), but the SAME
//        branching logic is now confirmed live for allergies via the
//        blank-organisation "prev GP"/"Unknown" case, so the wrapping
//        pattern is very likely identical.
//   POST /clinical/allergy/change-allergy/{allergyId}
//        body: the FULL edit-form prefill shape with allergyCode/substance
//        UNWRAPPED (.value, not the {label,value} UI-select shape) and the
//        clinician's merged field choices substituted in — confirmed a full
//        replace, not a partial patch, same discipline as change-allergy's
//        already-confirmed convert-to-substance use in HAR32/HAR35.
//   POST /clinical/allergy/end-allergy
//        body: { allergyId, endDate, reasonEnded } — used for every entry in
//        the group OTHER than the chosen keeper, with the fixed
//        MERGE_REASON_ENDED text below (explicit user wording, 2026-07-29).
//
// BLANK-ORGANISATION PLACEHOLDER: "Unknown", not a guessed practice name —
// explicit user decision 2026-07-29 (see allergy-junk-code-cleanup.js's
// sibling feature and the conversation this was agreed in): fabricating a
// plausible-looking organisation name would add false provenance to the
// record; "Unknown" honestly reports what's actually known, and who
// recorded/where an allergy was recorded is not the safety-relevant fact
// here — record clarity is.
//
// MERGE SCOPE (explicit, 2026-07-29): only the CLINICAL fields that can
// genuinely differ meaningfully between duplicate copies are offered for
// per-field choice — severity, certainty, additionalInformation,
// allergyReactions, onsetDate. The allergyCode/substance identity itself is
// ALWAYS carried through unchanged from the chosen keeper — this widget
// never changes what code represents the allergy (that is the separate,
// not-yet-built "convert pre-defined code to substance" feature); merging
// duplicates and converting a code type are two different actions, not
// bundled together. recordDate/recordedByOrganisation/recordedByPractitioner/
// recordedByStaff are also always inherited from the keeper as-is — they are
// provenance fields, not clinical facts about the allergy itself, and
// re-litigating "who recorded this and when" is out of scope for a merge
// whose whole point is to reduce clutter, not manufacture new provenance
// decisions.
//
// ADDITIONAL INFO (2026-07-29, following user feedback on the modal
// redesign): unlike every other mergeable field, additionalInformation is
// NOT resolved by picking one copy's raw stored value — it's a free-text
// box the clinician edits directly, seeded from whichever copy is initially
// chosen. Explicit user request: duplicate copies' additionalInformation is
// usually near-identical or junk, so auto-concatenating every copy's text
// (the way duplicate-checker.js's note-merge suggests a stitched blob) would
// itself produce junk — but the box must stay freely editable so a
// clinician CAN preserve/combine a genuinely distinct detail from a second
// copy when one exists. Clicking a radio in the Additional info table row
// loads (replaces) the box's content with that copy's raw text; typing
// anything after that is preserved verbatim into the change-allergy POST.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  var MERGE_REASON_ENDED =
    'Multiple allergy entries for same allergen - merged into single entry for clarity and to reduce dangerous / distracting clutter on clinical record';

  var UNKNOWN_ORGANISATION = {
    organisationName: 'Unknown',
    organisationIdentifierType: null,
    organisationIdentifierValue: null,
  };

  var MERGEABLE_FIELDS = ['severity', 'certainty', 'additionalInformation', 'allergyReactions', 'onsetDate'];

  function normalizeAllergyDescription(desc) {
    return String(desc == null ? '' : desc)
      .trim()
      .toLowerCase();
  }

  // Same filter as allergy-junk-code-cleanup.js's own copy — duplicated
  // locally rather than shared, same "small helpers stay local to each
  // content script" convention already established across this file family
  // (see e.g. findProblemRow's own comment in problem-description-cleanup.js).
  function activeNonDraftAllergies(allergies) {
    return (Array.isArray(allergies) ? allergies : []).filter(function (a) {
      return a && a.id && !a.isDraft;
    });
  }

  // Groups the cheap allergies[] list by exact (trimmed, case-insensitive)
  // description text. Returns only groups of 2+ — a solo entry is never a
  // duplicate candidate. Preserves the list's own relative order both
  // across groups and within each group.
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

  // Same filter as allergy-junk-code-cleanup.js's own copy — duplicated
  // locally, same convention as activeNonDraftAllergies above. overview's
  // allergyCode/substance are FLAT here (unlike edit-allergy's {label,value}
  // wrap) — confirmed live, see this file's header comment.
  function resolveAllergyConceptId(overview) {
    if (!overview) return null;
    var code = overview.allergyCode && overview.allergyCode.conceptId;
    if (code) return String(code);
    var substance = overview.substance && overview.substance.conceptId;
    return substance ? String(substance) : null;
  }

  // True when two SNOMED concepts represent the SAME underlying allergen in
  // a strict lineage sense — identical conceptId, or one is a genuine
  // ancestor of the other (its conceptId appears in the other's ancestor
  // closure). Deliberately NOT "shares any ancestor somewhere in the tree" —
  // that would over-group unrelated allergies that merely sit under the same
  // broad category (e.g. two different foods both under "Allergy to food").
  // See this file's header comment's real Arachis-oil investigation for why
  // this distinction matters, not just a theoretical concern.
  function isSameAllergenConcept(conceptIdA, ancestorsA, conceptIdB, ancestorsB) {
    if (!conceptIdA || !conceptIdB) return false;
    if (conceptIdA === conceptIdB) return true;
    if (Array.isArray(ancestorsB) && ancestorsB.indexOf(conceptIdA) !== -1) return true;
    if (Array.isArray(ancestorsA) && ancestorsA.indexOf(conceptIdB) !== -1) return true;
    return false;
  }

  // Extends groupDuplicateAllergies with SNOMED-ancestry-based grouping —
  // entries with DIFFERENT description text but the same underlying allergen
  // (per isSameAllergenConcept) join the same group as any exact-text match
  // (or form a new group together, if no exact-text pair exists at all).
  // `conceptInfoByEntryId` is {[entryId]: {conceptId, ancestorConceptIds}} —
  // entries missing from it (concept lookup not yet run, or failed) still
  // participate via exact-text matching only, never silently dropped. With
  // an empty map this degenerates to exactly groupDuplicateAllergies's own
  // grouping (text-only), so it's a strict superset, not a competing
  // algorithm. Each returned entry gets `groupedBy: 'text' | 'concept'` —
  // 'text' if it shares its exact normalized description with ANY other
  // member of its final group, 'concept' otherwise — plus
  // `relatedToDescription` (some other member's description) for a
  // 'concept' entry, so the review UI can explain ITS reasoning rather than
  // presenting a bare list.
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

  // Default keeper = earliest recordDate among the group (ISO "YYYY-MM-DD"
  // strings, directly comparable) — explicit user preference, 2026-07-29
  // ("probably the earliest record-entry by default"). An entry with a
  // genuine date always beats one with none; ties/all-blank keep the
  // earliest LIST position (stable, never arbitrary). `entries` is
  // [{id, recordDate}] — a caller-resolved shape (see fieldValuesByEntry's
  // own comment for why raw overview-allergy shapes aren't consumed here
  // directly).
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

  // A field can arrive as a plain value OR wrapped in a UI-select shape
  // ({label, value: {...}}) — confirmed for allergyCode on edit-allergy's
  // prefill (real capture: {label:"Amoxicillin allergy", value:{conceptId,
  // description, descriptionId}}), applied defensively to substance too
  // (same form-component family, not yet independently seen populated in a
  // live capture). Passes anything else through unchanged, same "only
  // unwrap the confirmed shape, never assume" discipline as
  // problem-description-cleanup.js's own unwrapRecordedByOrganisation.
  function unwrapSelectValue(field) {
    if (field && field.value && typeof field.value === 'object') return field.value;
    return field != null ? field : null;
  }

  // Same shape/logic as problem-description-cleanup.js's own
  // unwrapRecordedByOrganisation — duplicated, not imported (this content
  // script doesn't load that file). See this file's header comment for the
  // confirmation status.
  function unwrapRecordedByOrganisation(org) {
    if (org && org.value && typeof org.value === 'object' && org.value.organisationName != null) {
      return org.value;
    }
    return org != null ? org : null;
  }

  // Extracts a {entryId: value} map for ONE mergeable field across every
  // entry in a group, from each entry's already-fetched overview-allergy
  // response — used by the review UI to build the per-field radio choices
  // (one option per DISTINCT non-empty value found, per field). `entries`
  // is [{id, overview}]. allergyReactions is compared by its joined
  // description list (a whole array is one "value" to choose between, not
  // merged field-by-field within itself — see this file's header comment's
  // MERGE SCOPE note).
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

  // Builds the full change-allergy POST body for the chosen keeper —
  // `prefill` is the keeper's own edit-allergy GET response; `chosen` is
  // {severity, certainty, additionalInformation, allergyReactions,
  // onsetDate} — the ALREADY-RESOLVED values the clinician picked (which
  // source entry each came from doesn't matter once resolved), any of which
  // may be omitted to mean "keep the keeper's own prefill value unchanged".
  // allergyCode/substance/recordDate/recordedBy*/allergyCodeType/
  // linkedProblemIds/hidden*/confidential*/endDate/clinicalCaseId are ALWAYS
  // taken from the keeper's own prefill, never overridden — see this file's
  // header comment's MERGE SCOPE note for why.
  function buildMergeChangeAllergyPayload(prefill, chosen) {
    var p = prefill || {};
    var c = chosen || {};
    var payload = {
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
      payload.recordedByOrganisation = unwrapped && unwrapped.organisationName ? unwrapped : UNKNOWN_ORGANISATION;
      payload.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      payload.recordedByStaff = p.recordedByStaff != null ? p.recordedByStaff : null;
    }
    return payload;
  }

  // overview-allergy returns onsetDate as a UK display string ("24 Jul
  // 2012"), but change-allergy's payload needs the same ISO shape
  // edit-allergy's own prefill already uses ("2012-07-24") — CONFIRMED live
  // 2026-07-30 (HAR: 36-merge-failure.har, a real 6-duplicate peanut-allergy
  // merge): posting the overview's raw display string back verbatim for a
  // non-keeper copy's chosen onsetDate is rejected — POST 400
  // {"errors":{"onsetDate":["Value is not a valid partial date."]}}. The
  // keeper's OWN onsetDate never hit this (buildMergeChangeAllergyPayload
  // falls back to the prefill's already-ISO value whenever `chosen.onsetDate`
  // is omitted) — the bug only bites once ANY entry's onsetDate is resolved
  // via the review UI's per-field pick, which always sources from
  // overview-allergy. Converts only the one confirmed display shape ("D(D)
  // Mon YYYY"); anything else (already ISO, null, an unrecognised format)
  // passes through unchanged rather than guessing at a shape never seen live.
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

  // Same payload shape as allergy-junk-code-cleanup.js's own
  // buildEndAllergyPayload (duplicated, not imported), but this file only
  // ever calls it with MERGE_REASON_ENDED — never a caller-supplied reason —
  // since every end triggered from this widget is, definitionally, a
  // duplicate being merged away, never a junk-code removal.
  function buildEndAllergyPayload(allergyId, endDate, reasonEnded) {
    return { allergyId: allergyId, endDate: endDate, reasonEnded: reasonEnded || null };
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MERGE_REASON_ENDED: MERGE_REASON_ENDED,
      MERGEABLE_FIELDS: MERGEABLE_FIELDS,
      normalizeAllergyDescription: normalizeAllergyDescription,
      activeNonDraftAllergies: activeNonDraftAllergies,
      groupDuplicateAllergies: groupDuplicateAllergies,
      resolveAllergyConceptId: resolveAllergyConceptId,
      isSameAllergenConcept: isSameAllergenConcept,
      groupRelatedAllergies: groupRelatedAllergies,
      pickDefaultKeeperId: pickDefaultKeeperId,
      unwrapSelectValue: unwrapSelectValue,
      unwrapRecordedByOrganisation: unwrapRecordedByOrganisation,
      fieldValuesByEntry: fieldValuesByEntry,
      normalizeOnsetDateForSubmit: normalizeOnsetDateForSubmit,
      buildMergeChangeAllergyPayload: buildMergeChangeAllergyPayload,
      buildEndAllergyPayload: buildEndAllergyPayload,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msAllergyDuplicateMerge) return;
  window.__msAllergyDuplicateMerge = true;

  // Debug pipeline logging — same pattern as triage-lens/content.js's own
  // 'ch-debug' flag (see CLAUDE.md's queue-chip debugging section): OFF by
  // default, toggled via localStorage (survives page reload, unlike any
  // in-memory state) so a flash-then-vanish widget can be diagnosed without
  // needing a fresh console snippet re-pasted after every reload — the
  // logging just happens automatically on each load once the flag is set,
  // and DevTools' own "Preserve log" keeps the full timeline across
  // navigations. Added 2026-07-30 after a live report: the trigger worked
  // once, then started flashing and vanishing, and a one-off console poll
  // couldn't catch the transition because navigating to reproduce it kills
  // any running poll.
  var DEBUG = (function () {
    try {
      return localStorage.getItem('ms-adm-debug') === '1';
    } catch (_) {
      return false;
    }
  })();
  function dbg() {
    if (!DEBUG) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[AllergyDupMerge]');
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

  // ── URL detection — identical to every other content script in this family ───
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

  function postEndAllergy(payload) {
    return apiFetch('/clinical/allergy/end-allergy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  // ── Concept-ancestry lookup (pass 2 — see this file's header comment) ───────
  // outputParentConceptIds=1 + a bare-SCTID query — SAME confirmed mechanism
  // already proven live for problem-type concepts (see
  // problem-description-cleanup.js's own SEARCH_PATH comment). Allergy
  // finding-type concepts sit under the same "Clinical finding" top-level
  // hierarchy, so the same five constrainingParentConcepts scope applies —
  // NOT yet independently live-confirmed for an allergy conceptId
  // specifically, hence the fail-closed (null, no ancestry check) handling
  // on any error or unexpected shape below, rather than guessing.
  var CONCEPT_SEARCH_PATH =
    '/clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&outputParentConceptIds=1&query=';

  var _ancestorCache = Object.create(null); // conceptId -> string[] ancestor conceptIds, or null on failure

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

  // ── DOM: scoping to the Allergies card specifically — REAL BUG, found live
  // 2026-07-29 (user screenshot): the "N possible duplicates — Review?"
  // trigger anchored itself above the Minor PROBLEMS list, because this
  // patient's problem list coincidentally contained entries worded
  // identically to real allergy entries ("Peanut allergy" x2, "Arachis oil
  // allergy") — a document-wide row search matched the Problem row first,
  // since Problems renders above Allergies on Clinical Summary. Same fix as
  // allergy-junk-code-cleanup.js's own copy of this function/comment —
  // duplicated, not shared (see that file's own note on why small DOM
  // helpers stay local per content script). Every row search here is now
  // scoped to the Allergies card's own DOM subtree, computed fresh on every
  // call (Vue's re-renders can replace the card's root element). Fails
  // closed (returns null, no injection) when the section can't be
  // confidently found, rather than risking an unscoped, potentially-wrong
  // match again.
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

  // ── State ─────────────────────────────────────────────────────────────────────
  var _lastPatientId = null;
  var _allergiesCache = null;
  var _groups = []; // [{ key, description, entries: [{id, description, anchorEl}] }]
  // Per-group review state, keyed by group index. Only populated once a
  // group's "Review duplicates?" trigger is clicked — never proactively.
  var _reviews = Object.create(null);
  // The review UI lives in a single fixed-position modal appended to
  // document.body (2026-07-29 redesign, user request: the inline panel was
  // squeezed into the Allergies card's own narrow column width, unworkable
  // once a group has more than 2-3 copies — a real case had 6). Explicitly
  // kept ON this page rather than popped into a separate extension tab
  // (user's own words: "keep it on the clinical summary page, bearing in
  // mind that we may fold this into a single, multi-step process" — a modal
  // is a natural container for a future multi-step wizard; a separate tab
  // is not). Only one group's modal can be open at a time — opening a new
  // one replaces any other. The trigger buttons injected inline into the
  // Allergies card stay tiny; all the real estate goes to the modal.
  var _modalRoot = null;

  function resetForPatient() {
    _allergiesCache = null;
    _groups = [];
    _reviews = Object.create(null);
    _conceptEnrichmentDone = false;
    _conceptInfoByEntryId = {};
  }

  function groupState(idx) {
    if (!_reviews[idx]) {
      _reviews[idx] = {
        open: false,
        loading: false,
        error: null,
        entries: null, // [{id, description, overview}]
        keeperId: null,
        chosen: {}, // { fieldName: entryId } — which entry's value to use per field
        // additionalInformation is NOT resolved via `chosen` like the other
        // mergeable fields — see this file's header comment's ADDITIONAL
        // INFO note. It's free text the clinician edits directly; clicking a
        // radio in that field's table row loads (replaces) this box's
        // content rather than being the value submitted.
        additionalInfoText: '',
        endDate: todayISO(),
        saving: false,
        saveError: null,
        merged: false,
      };
    }
    return _reviews[idx];
  }

  // ── Detection (cheap, page-load only) ───────────────────────────────────────
  var _fetchInFlight = false;

  async function ensureAllergiesLoaded() {
    var info = getPatientInfo();
    if (!info) return;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForPatient();
    }
    if (!_allergiesCache && !_fetchInFlight) {
      _fetchInFlight = true;
      try {
        _allergiesCache = await fetchClinicalSummaryAllergies(info.patientId);
      } catch (_) {
        _allergiesCache = [];
      } finally {
        _fetchInFlight = false;
      }
    }
    if (_allergiesCache) {
      // Regroup using whatever concept info pass 2 has resolved SO FAR
      // (empty before it's run — degenerates to plain text-only grouping,
      // same as groupDuplicateAllergies). REAL BUG fixed 2026-07-30: this
      // used to always call groupDuplicateAllergies (text-only) here,
      // discarding pass 2's result on every subsequent mutation-triggered
      // rescan — pass 2 only ever runs ONCE per patient
      // (_conceptEnrichmentDone latches true), so nothing ever restored the
      // richer grouping afterward. Confirmed live via debug log: a group
      // pass 2 found and successfully injected got wiped by the very next
      // rescan, which recomputed text-only groups (0) and pruned the widget
      // as "orphaned". Using the accumulated _conceptInfoByEntryId here
      // instead means every rescan reflects whatever's been resolved so
      // far, never regressing to a poorer grouping once enrichment exists.
      var rawGroups = groupRelatedAllergies(_allergiesCache, _conceptInfoByEntryId);
      dbg(
        'ensureAllergiesLoaded: patient',
        info.patientId,
        '— allergies:',
        _allergiesCache.length,
        '— groups:',
        rawGroups.length,
        rawGroups
          .map(function (g) {
            return g.length + 'x "' + g[0].allergyCodeDescription + '"';
          })
          .join(', ')
      );
      applyGroups(rawGroups);
      injectTriggers();
      enrichGroupsWithConceptAncestry();
    }
  }

  function applyGroups(rawGroups) {
    _groups = rawGroups.map(function (entries, i) {
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
  }

  // Pass 2 (see this file's header comment) — backgrounded, one pass per
  // patient page-load. Runs AFTER pass 1's cheap trigger(s) are already
  // showing, so it never delays the fast path; if it finds anything new the
  // trigger count(s) simply update in place a moment later.
  var _conceptEnrichmentDone = false;
  // Persistent (not a throwaway local) — see ensureAllergiesLoaded's own
  // comment on the real bug this fixed: every rescan now regroups using
  // whatever's accumulated here, so a concept-based group pass 2 found is
  // never lost on a later text-only recompute.
  var _conceptInfoByEntryId = {};

  async function enrichGroupsWithConceptAncestry() {
    if (_conceptEnrichmentDone || !_allergiesCache) return;
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
            dbg('enrichGroupsWithConceptAncestry: overview fetch failed for', a.id, e && e.message);
            return;
          }
          var conceptId = resolveAllergyConceptId(overview);
          if (!conceptId) {
            dbg('enrichGroupsWithConceptAncestry: no conceptId resolved for', a.id, '(', a.allergyCodeDescription, ')');
            return;
          }
          var ancestors = await fetchAncestorConceptIds(conceptId);
          dbg(
            'enrichGroupsWithConceptAncestry:',
            a.allergyCodeDescription,
            '-> concept',
            conceptId,
            'ancestors:',
            ancestors ? ancestors.length : 'null (lookup failed)'
          );
          _conceptInfoByEntryId[a.id] = { conceptId: conceptId, ancestorConceptIds: ancestors || [] };
        })
      );
      if (!_allergiesCache) return; // patient may have changed while fetching
      var enriched = groupRelatedAllergies(_allergiesCache, _conceptInfoByEntryId);
      dbg('enrichGroupsWithConceptAncestry: done, groups now:', enriched.length);
      applyGroups(enriched);
      injectTriggers();
    } catch (e) {
      dbg('enrichGroupsWithConceptAncestry: THREW', e && e.message, e && e.stack);
    }
  }

  // ── Per-group review (opt-in — only ever runs from a "Review duplicates?"
  // click) ──────────────────────────────────────────────────────────────────
  async function openReview(idx) {
    var group = _groups[idx];
    if (!group) return;
    var st = groupState(idx);
    st.open = true;
    if (st.entries) {
      showModal(idx);
      return;
    }
    st.loading = true;
    st.error = null;
    showModal(idx);
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
      // Default each mergeable field's choice to whichever entry the keeper
      // itself supplies a value for, falling back to the first entry that
      // has ANY value for that field if the keeper's own is blank — so the
      // clinician sees a fully-populated, sensible starting point rather
      // than empty radio groups.
      MERGEABLE_FIELDS.forEach(function (field) {
        var values = fieldValuesByEntry(entries, field);
        if (values[st.keeperId] !== undefined) {
          st.chosen[field] = st.keeperId;
        } else {
          var firstWithValue = Object.keys(values)[0];
          if (firstWithValue) st.chosen[field] = firstWithValue;
        }
      });
      // Seed the free-text additional-info box from whichever entry got
      // chosen above — a sensible starting point, not an auto-merge (see
      // this file's header comment's ADDITIONAL INFO note for why no
      // auto-merge is offered).
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
      showModal(idx);
    }
  }

  function closeReview(idx) {
    var st = groupState(idx);
    st.open = false;
    hideModal();
  }

  async function confirmMerge(idx) {
    var group = _groups[idx];
    var st = groupState(idx);
    if (!group || !st.entries || !st.keeperId || st.saving || !st.endDate) return;
    st.saving = true;
    st.saveError = null;
    refreshModal(idx);
    try {
      var prefill = await fetchEditAllergyForm(st.keeperId);
      var resolved = {};
      MERGEABLE_FIELDS.forEach(function (field) {
        // additionalInformation is resolved from the free-text box below,
        // never from a single copy's raw stored value — see this file's
        // header comment's ADDITIONAL INFO note.
        if (field === 'additionalInformation') return;
        var chosenEntryId = st.chosen[field];
        if (!chosenEntryId) return;
        var chosenEntry = st.entries.find(function (e) {
          return e.id === chosenEntryId;
        });
        var value = chosenEntry && chosenEntry.overview && chosenEntry.overview[field];
        if (value === undefined) return;
        resolved[field] = field === 'onsetDate' ? normalizeOnsetDateForSubmit(value) : value;
      });
      resolved.additionalInformation = (st.additionalInfoText || '').trim() || null;
      var payload = buildMergeChangeAllergyPayload(prefill, resolved);
      await postChangeAllergy(st.keeperId, payload);
      var others = st.entries.filter(function (e) {
        return e.id !== st.keeperId;
      });
      var results = await Promise.allSettled(
        others.map(function (e) {
          return postEndAllergy(buildEndAllergyPayload(e.id, st.endDate, MERGE_REASON_ENDED));
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
      refreshModal(idx);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

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

  // Small per-copy card — quick-scan overview + the "which copy to keep"
  // control. Clicking a card (its radio) changes the keeper.
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
    // A group can now mix entries with DIFFERENT description text (pass 2's
    // concept-ancestry grouping — see this file's header comment), so each
    // card names its own allergy rather than assuming the group heading
    // covers it. groupedBy: 'concept' entries also explain WHY they're
    // here — different wording, SNOMED-linked to another member — rather
    // than presenting a bare, unexplained inclusion.
    var conceptNote =
      e.groupedBy === 'concept'
        ? '<div class="ms-adm-card-concept-note">Different code — SNOMED links this to ' +
          (e.relatedToDescription ? '"' + esc(e.relatedToDescription) + '"' : 'another entry here') +
          ' as the same underlying allergen.</div>'
        : '';
    return (
      '<label class="ms-adm-card' +
      (isKeeper ? ' ms-adm-card-keeper' : '') +
      '">' +
      '<input type="radio" class="ms-adm-card-radio" name="ms-adm-keeper-' +
      esc(idx) +
      '" data-entry-id="' +
      esc(e.id) +
      '"' +
      (isKeeper ? ' checked' : '') +
      '>' +
      '<div class="ms-adm-card-badge' +
      (isKeeper ? '' : ' ms-adm-card-badge-other') +
      '">' +
      (isKeeper ? '✓ KEEP' : 'Other copy') +
      '</div>' +
      '<div class="ms-adm-card-title">' +
      esc(e.description) +
      '</div>' +
      conceptNote +
      '<div class="ms-adm-card-date">' +
      (ov.recordDate ? 'Recorded ' + esc(ov.recordDate) : '<span class="ms-adm-card-muted">No record date</span>') +
      '</div>' +
      (lines || '<div class="ms-adm-card-muted ms-adm-card-line">No other clinical detail recorded</div>') +
      '</label>'
    );
  }

  function cardDetailLineHtml(label, value) {
    if (!value) return '';
    return (
      '<div class="ms-adm-card-line"><span class="ms-adm-card-line-label">' +
      esc(label) +
      ':</span> ' +
      esc(value) +
      '</div>'
    );
  }

  // Field-comparison table — one column per copy, one row per field.
  // Mergeable fields (MERGEABLE_FIELDS) get a radio per copy that has a
  // value; a locked "Recorded" evidence row shows each copy's own
  // recordDate for context but is never itself choosable — recordDate
  // always comes from the keeper's own edit-allergy prefill unchanged (see
  // buildMergeChangeAllergyPayload's own comment). Fields with no value
  // anywhere in the group are omitted entirely rather than shown as an
  // all-"(none)" row.
  function fieldTableHtml(idx, st) {
    var colHeaders = st.entries
      .map(function (e) {
        var isKeeper = st.keeperId === e.id;
        return (
          '<th class="ms-adm-th' +
          (isKeeper ? ' ms-adm-th-keep' : '') +
          '">' +
          (isKeeper ? '✓ KEEP — kept copy' : 'Other copy') +
          '</th>'
        );
      })
      .join('');

    var lockedRow =
      '<tr><td class="ms-adm-row-label">Recorded <span class="ms-adm-locked-mark" title="Always kept from the keeper copy — see this widget\'s MERGE SCOPE note">🔒</span></td>' +
      st.entries
        .map(function (e) {
          var isKeeper = st.keeperId === e.id;
          var v = e.overview && e.overview.recordDate;
          return (
            '<td class="ms-adm-td ms-adm-td-locked' +
            (isKeeper ? ' ms-adm-td-keep' : '') +
            '">' +
            (v ? esc(v) : '<span class="ms-adm-td-none">(none)</span>') +
            '</td>'
          );
        })
        .join('') +
      '</tr>';

    var fieldRows = MERGEABLE_FIELDS.map(function (field) {
      var values = fieldValuesByEntry(st.entries, field);
      if (!Object.keys(values).length) return '';
      var cells = st.entries
        .map(function (e) {
          var isKeeper = st.keeperId === e.id;
          var cellClass = 'ms-adm-td' + (isKeeper ? ' ms-adm-td-keep' : '');
          if (values[e.id] === undefined) {
            return '<td class="' + cellClass + '"><span class="ms-adm-td-none">(none)</span></td>';
          }
          var label = fieldValueLabel(field, values[e.id]);
          return (
            '<td class="' +
            cellClass +
            '"><label class="ms-adm-td-radio"><input type="radio" name="ms-adm-field-' +
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
        '<tr><td class="ms-adm-row-label">' +
        esc(fieldLabel(field)) +
        ' <span class="ms-adm-mergeable-mark" title="Mergeable — pick which copy\'s value to use">✎</span></td>' +
        cells +
        '</tr>'
      );
    }).join('');

    return (
      '<table class="ms-adm-table"><thead><tr><th></th>' +
      colHeaders +
      '</tr></thead><tbody>' +
      lockedRow +
      (fieldRows ||
        '<tr><td colspan="' +
          (st.entries.length + 1) +
          '" class="ms-adm-empty">No differing clinical detail found between these entries.</td></tr>') +
      '</tbody></table>'
    );
  }

  // Counts distinct description text within the group and phrases the
  // subtitle accordingly — a single phrase ("6 entries for \"X\"") for the
  // common exact-text case, or a breakdown ("7 entries — 6 as \"Peanut
  // allergy\", 1 as \"Peanut-induced anaphylaxis\"") once pass 2's
  // concept-ancestry grouping has pulled in differently-worded entries.
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

  function modalBodyHtml(idx) {
    var group = _groups[idx];
    var st = groupState(idx);
    var header =
      '<div class="ms-adm-modal-header">' +
      '<div><div class="ms-adm-modal-title">Review duplicate allergy entries</div>' +
      '<div class="ms-adm-modal-subtitle">' +
      groupSubtitleHtml(group) +
      '</div></div>' +
      '<button type="button" class="ms-adm-modal-close" data-group="' +
      esc(idx) +
      '" aria-label="Close">✕</button>' +
      '</div>';

    if (st.loading) {
      return (
        header + '<div class="ms-adm-modal-body"><span class="ms-adm-loading">Loading for comparison…</span></div>'
      );
    }
    if (st.error) {
      return (
        header +
        '<div class="ms-adm-modal-body"><span class="ms-adm-error">' +
        esc(st.error) +
        '</span> <button type="button" class="ms-adm-retry" data-group="' +
        esc(idx) +
        '">Retry</button></div>'
      );
    }
    if (st.merged) {
      return header + '<div class="ms-adm-modal-body"><span class="ms-adm-done">Merged.</span></div>';
    }
    if (!st.entries) return header + '<div class="ms-adm-modal-body"></div>';

    var cards = st.entries
      .map(function (e) {
        return entryCardHtml(idx, st, e);
      })
      .join('');

    return (
      header +
      '<div class="ms-adm-modal-body">' +
      '<div class="ms-adm-note">This always requires your review — nothing here is applied in bulk. Pick ' +
      'which entry to keep, and for each field that differs, which entry’s value to use. The others are ' +
      'ended (never deleted) with a clear audit reason.</div>' +
      '<div class="ms-adm-cards">' +
      cards +
      '</div>' +
      '<div class="ms-adm-hint">Click a card, or a row in the table below, to change which copy is kept.</div>' +
      fieldTableHtml(idx, st) +
      '<div class="ms-adm-hint">Additional info is edited freely, not auto-merged — duplicate copies are ' +
      "usually near-identical or junk here. Pick a radio above to load that copy's text (replacing this " +
      'box), or type/combine details from any copy yourself.</div>' +
      '<label class="ms-adm-label" for="ms-adm-ai-text-' +
      esc(idx) +
      '">Additional info</label>' +
      '<textarea class="ms-adm-ai-textarea" id="ms-adm-ai-text-' +
      esc(idx) +
      '" data-group="' +
      esc(idx) +
      '" rows="3">' +
      esc(st.additionalInfoText || '') +
      '</textarea>' +
      '<div class="ms-adm-end-row">' +
      '<label class="ms-adm-label" for="ms-adm-end-date-' +
      esc(idx) +
      '">End date (for the merged-away entries)</label>' +
      '<input type="date" class="ms-adm-date-input" id="ms-adm-end-date-' +
      esc(idx) +
      '" data-group="' +
      esc(idx) +
      '" value="' +
      esc(st.endDate) +
      '">' +
      '</div>' +
      (st.saveError ? '<div class="ms-adm-error">' + esc(st.saveError) + '</div>' : '') +
      '<div class="ms-adm-actions">' +
      '<button type="button" class="ms-adm-confirm-btn" data-group="' +
      esc(idx) +
      '"' +
      (st.saving || !st.endDate ? ' disabled' : '') +
      '>' +
      (st.saving ? 'Merging…' : 'Merge and end duplicates') +
      '</button>' +
      '<button type="button" class="ms-adm-cancel-btn" data-group="' +
      esc(idx) +
      '">Cancel</button>' +
      '</div>' +
      '</div>'
    );
  }

  function groupHtml(idx) {
    var group = _groups[idx];
    return (
      '<button type="button" class="ms-adm-toggle" data-group="' +
      esc(idx) +
      '">' +
      group.entries.length +
      ' possible duplicates — Review?</button>'
    );
  }

  function bindGroupEvents(el, idx) {
    el.querySelector('.ms-adm-toggle')?.addEventListener('click', function () {
      openReview(idx);
    });
  }

  // ── Modal (single instance, appended to document.body — see this file's
  // own State comment for why this replaced the old inline-panel render).
  function ensureModalRoot() {
    if (_modalRoot && document.body.contains(_modalRoot)) return _modalRoot;
    _modalRoot = document.createElement('div');
    _modalRoot.id = 'ms-adm-modal-root';
    _modalRoot.className = 'ms-adm-modal-root';
    _modalRoot.style.display = 'none';
    document.body.appendChild(_modalRoot);
    return _modalRoot;
  }

  function _onModalKeydown(e) {
    if (e.key !== 'Escape' || !_modalRoot) return;
    var idx = _modalRoot.dataset.group;
    if (idx != null && idx !== '') closeReview(Number(idx));
  }

  function bindModalEvents(root, idx) {
    var st = groupState(idx);
    root.querySelector('.ms-adm-modal-backdrop')?.addEventListener('click', function () {
      closeReview(idx);
    });
    root.querySelector('.ms-adm-modal-close')?.addEventListener('click', function () {
      closeReview(idx);
    });
    root.querySelector('.ms-adm-cancel-btn')?.addEventListener('click', function () {
      closeReview(idx);
    });
    root.querySelector('.ms-adm-retry')?.addEventListener('click', function () {
      st.entries = null;
      openReview(idx);
    });
    root.querySelectorAll('input[name="ms-adm-keeper-' + idx + '"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        st.keeperId = radio.getAttribute('data-entry-id');
        refreshModal(idx);
      });
    });
    root.querySelectorAll('input[data-field]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        var field = radio.getAttribute('data-field');
        var entryId = radio.getAttribute('data-entry-id');
        st.chosen[field] = entryId;
        // Additional info alone also loads (replaces) the free-text box —
        // every other field's radio just marks which copy's value to use
        // directly, no box to keep in sync.
        if (field === 'additionalInformation') {
          var entry = st.entries.find(function (e) {
            return e.id === entryId;
          });
          st.additionalInfoText = (entry && entry.overview && entry.overview.additionalInformation) || '';
          refreshModal(idx);
        }
      });
    });
    root.querySelector('.ms-adm-ai-textarea')?.addEventListener('input', function (e) {
      st.additionalInfoText = e.target.value;
    });
    root.querySelector('.ms-adm-date-input')?.addEventListener('input', function (e) {
      st.endDate = e.target.value;
    });
    root.querySelector('.ms-adm-confirm-btn')?.addEventListener('click', function () {
      confirmMerge(idx);
    });
  }

  function showModal(idx) {
    var root = ensureModalRoot();
    root.dataset.group = String(idx);
    root.innerHTML =
      '<div class="ms-adm-modal-backdrop"></div><div class="ms-adm-modal" role="dialog" aria-modal="true">' +
      modalBodyHtml(idx) +
      '</div>';
    root.style.display = 'block';
    bindModalEvents(root, idx);
    document.addEventListener('keydown', _onModalKeydown);
  }

  // Re-renders the modal in place without a fetch — used after a
  // keeper/field pick or a confirmMerge state change. No-ops if the modal
  // isn't currently showing this group (e.g. it was closed mid-fetch).
  function refreshModal(idx) {
    if (!_modalRoot || _modalRoot.style.display === 'none') return;
    if (_modalRoot.dataset.group !== String(idx)) return;
    showModal(idx);
  }

  function hideModal() {
    if (!_modalRoot) return;
    _modalRoot.style.display = 'none';
    _modalRoot.innerHTML = '';
    document.removeEventListener('keydown', _onModalKeydown);
  }

  // ── Injection: one "N possible duplicates — Review?" trigger per group,
  // placed just before the FIRST entry's own row. NEVER destructive — a
  // previous version of this function removed EVERY existing widget up
  // front, then tried to re-find each group's anchor row and reinsert.
  // REAL BUG (found live 2026-07-30, user report: trigger worked once then
  // started "flashing and vanishing"): Medicus's own Vue re-renders happen
  // often enough on Clinical Summary (same "re-renders constantly" dynamic
  // CLAUDE.md documents for the AG-Grid queue) that a row-lookup can
  // transiently fail for a group that's ALREADY correctly showing its
  // widget — the old code had already destroyed that working widget before
  // discovering the lookup failed, with no guaranteed retry. Now: an
  // existing widget for a still-current group index is only ever refreshed
  // IN PLACE (innerHTML + rebind, cheap, never removed) — a failed row
  // lookup this cycle just leaves it alone. Only widgets whose index is now
  // out of range (pass 2 shrank _groups.length) get removed; only a group
  // with NO existing widget yet attempts the row lookup + insert.
  function injectTriggers() {
    var scopeEl = findAllergiesSectionRoot();
    if (!scopeEl) {
      dbg(
        'injectTriggers: findAllergiesSectionRoot() returned null — Allergies section not found, skipping this cycle'
      );
      return; // fail closed — see findAllergiesSectionRoot's own comment
    }

    // Refresh content/bindings for widgets that already occupy a still-valid
    // slot — covers pass 2 changing a group's entry count/reasoning without
    // ever touching the DOM node's position.
    _groups.forEach(function (group, idx) {
      var existing = document.getElementById('ms-adm-widget-' + idx);
      if (existing) {
        existing.innerHTML = groupHtml(idx);
        bindGroupEvents(existing, idx);
      }
    });

    // Prune only widgets whose index no longer corresponds to ANY current
    // group (the group count shrank) — never a widget still in range.
    document.querySelectorAll('[id^="ms-adm-widget-"]').forEach(function (el) {
      var idx = parseInt(el.id.slice('ms-adm-widget-'.length), 10);
      if (!(idx < _groups.length)) {
        dbg('injectTriggers: removing orphaned widget', el.id, '(only', _groups.length, 'group(s) now)');
        el.remove();
      }
    });

    // Insert a widget for any group that doesn't have one positioned yet.
    _groups.forEach(function (group, idx) {
      if (document.getElementById('ms-adm-widget-' + idx)) return;
      var claimedAnchors = new Set();
      var firstRow = null;
      group.entries.forEach(function (e) {
        var row = findAllergyRow(e.description, claimedAnchors, scopeEl);
        if (row) {
          claimedAnchors.add(row);
          if (!firstRow) firstRow = row;
        }
      });
      if (!firstRow) {
        dbg(
          'injectTriggers: no row found yet for group',
          idx,
          '(' +
            group.entries
              .map(function (e) {
                return e.description;
              })
              .join(' | ') +
            ') — will retry next scan'
        );
        return;
      }
      var list = firstRow.closest('li') ? firstRow.closest('li').parentElement : firstRow.parentElement;
      if (!list || !list.parentElement) return;
      var w = document.createElement('div');
      w.id = 'ms-adm-widget-' + idx;
      w.className = 'ms-adm-widget';
      w.innerHTML = groupHtml(idx);
      list.parentElement.insertBefore(w, list);
      bindGroupEvents(w, idx);
      dbg('injectTriggers: inserted widget for group', idx, '(' + group.entries.length + ' entries)');
    });
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
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('[id^="ms-adm-widget"]')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id && n.id.indexOf('ms-adm-widget') === 0) continue;
          if (n.closest && n.closest('[id^="ms-adm-widget"]')) continue;
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
      dbg('MutationObserver (shared hub): foreign mutation detected, scheduling rescan');
      scheduleScan();
    });
  } else {
    var _obs = new MutationObserver(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      dbg('MutationObserver (own): foreign mutation detected, scheduling rescan');
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

  // Safety-net periodic rescan (2026-07-30) — mutation-driven scheduling
  // alone can get permanently stuck: a live debug-log capture showed several
  // scans in a row all failing to find the Allergies row anchors during
  // heavy initial-page-load DOM churn, but a manual console check moments
  // later confirmed the row lookup succeeds once the page settles — nothing
  // ever triggered that retry because scheduleScan only runs off
  // MutationObserver events, visibilitychange, and initial
  // DOMContentLoaded. If the page goes idle right after the last failed
  // attempt (no further mutations), there is no time-based backstop. This
  // low-frequency timer guarantees a retry within a few seconds regardless —
  // cheap and safe since injectTriggers is non-destructive and a no-op when
  // nothing has changed.
  setInterval(function () {
    if (!document.hidden) scheduleScan();
  }, 5000);
})();
