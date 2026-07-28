// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Allergy evidence trawl — Phase 2 of docs/plans/ALLERGY-CLEANUP-2026-07-28.md.
//
// Given an allergy entry's display label and the patient-journal payload,
// finds and ranks DOCUMENTED evidence of that allergy already in the record:
// what the reaction was, when it happened, who recorded it. The output is
// quoted source text plus its date/author — the tool finds and quotes, the
// clinician judges. Same philosophy as the rest of the rules engine.
//
// HARD CONSTRAINTS (all deliberate, all load-bearing):
//  - **Deterministic text matching only.** No LLM, no inference, no
//    summarising, no paraphrase. Every `snippet` is a verbatim slice of a
//    single source field (see buildSnippet) — plan doc safety rule 3:
//    "Evidence is quoted, never summarised or paraphrased, and always dated
//    + attributed, so the clinician is reading the record, not the tool."
//  - **Pure.** No fetch, no DOM, no chrome.*, no timers, no logging. Runs
//    under plain `node --test` (test-allergy-evidence.js) and as a classic
//    browser script in a content script. The ONE soft dependency is
//    shared/legacy-coded-description.js (see below), resolved the same way
//    shared/coding-specificity.js resolves it.
//  - **Fail-soft everywhere.** A malformed day-group / item / entry is
//    skipped, never thrown on. `findEvidence()` on garbage returns an empty
//    evidence list, not an exception — plan doc safety rule 5: "any
//    fetch/parse failure just means 'no evidence panel', never a broken
//    summary screen".
//  - **Read-only.** Nothing here decides anything about the allergy record
//    itself. Detection (Phase 1) and any write (Phase 4) live elsewhere.
//
// JOURNAL SHAPE — every assumption below is confirmed live in
// docs/learnings-patient-journal-api.md (2026-07-02 / 2026-07-17). Nothing
// here guesses a field name; where a field is confirmed ABSENT that is
// honoured explicitly rather than read hopefully:
//  - Root: `patientJournalRecords[]` — the real key (the parser originally
//    guessed `journal`/`timeline`/`entries`/`days`; all wrong).
//  - Day group: `{ title: "Thu 02 Jul 2026", items: [] }`. `title` format is
//    "DayName DD Mon YYYY" — NOT the same as `entry.observationDate`'s
//    "DD Mon YYYY", so it is parsed defensively (parseDayTitle) and the raw
//    string is always carried alongside as `dateRaw`.
//  - Flat items: `item.type` is one of 11 confirmed values; `item.data`
//    carries the content, mirroring the nested entry fields (`note`,
//    `clinicalCodeDescription`, `recordedBy`, `recordedByOrganisation`).
//  - Flat prescription items: `data.productName` / `data.dosageText` are
//    real; `recordedBy`/`recordedByOrganisation` were live-confirmed
//    2026-07-17 NOT to exist at all on a prescription, so they are reported
//    as null rather than read.
//  - Nested: `encounter` items carry
//    `data.consultationTopics[].headings[].entries[]`, each entry with
//    `entryType`, `note` (plain string or null — confirmed plain string, not
//    a wrapper object), `clinicalCodeDescription`, `recordedBy` (plain
//    string), `recordedByOrganisation` (plain string or null),
//    `isMarkedIncorrect`. The encounter's `data` also carries
//    `responsiblePractitioner` (plain string) and `startTime`.
//  - `isMarkedIncorrect` (NOT `isMarkedAsIncorrect` — that's a different
//    endpoint) and `isDraft` are honoured: such items/entries are skipped
//    entirely and never become evidence.
//  - GP2GP: an encounter with a `consultationTopics[].title` of "Data
//    Transferred from other system" is a transfer/migration encounter
//    (marker's live hit rate confirmed 2026-07-17). Evidence found inside
//    one is flagged `isGp2gpImport: true`, because its `recordedBy` reflects
//    the IMPORTER, not the original author — the UI must say "imported —
//    original authorship at previous practice", never pretend otherwise
//    (plan doc, Phase 2 "Provenance answer").
//
// NOT USED, deliberately: `encounter.data.startTime` (the day-group title is
// the canonical date bucket for the whole payload — mixing two date sources
// would make sorting non-comparable), and `entry.value` (a measurement, not
// narrative — no reaction can be quoted from it).

'use strict';

(function (global) {
  // Reuses the ICD-bracket / "H/O" / NOS-NEC strippers from
  // shared/legacy-coded-description.js rather than keeping a second copy of
  // those regexes — one source of truth, exactly as shared/coding-specificity.js
  // does. It was built entity-agnostic for precisely this second consumer
  // (see its header, and the plan doc's Phase 1 note).
  //
  // Soft dependency by design: if the shared file isn't loaded (a browser
  // context whose manifest entry hasn't listed it yet — Phase 3 must list it
  // BEFORE this file, the way problem-description-cleanup.js does), legacy
  // markers simply aren't stripped and everything else still works. Node
  // always has it via require(), so the tests always exercise the real path.
  var legacyCodedDescription =
    typeof module !== 'undefined' && module.exports
      ? require('../shared/legacy-coded-description.js')
      : global.MSLegacyCodedDescription;

  // ── Tunables (all overridable per call via findEvidence's `opts`) ─────────

  // Proximity window, in characters, between the START of a substance match
  // and the START of a reaction match within the SAME text field for the
  // top tier. ±120 chars is roughly a long sentence either side — tight
  // enough that "amoxicillin" in one paragraph and "rash" three paragraphs
  // later doesn't get promoted to "strongest evidence".
  var DEFAULT_PROXIMITY_CHARS = 120;

  // Maximum snippet length INCLUDING any ellipsis characters, so a caller
  // can size a UI column against this number and be right.
  var DEFAULT_SNIPPET_CHARS = 240;

  // Output cap. A busy record can mention a common drug dozens of times;
  // beyond ~25 ranked items the clinician is scrolling, not reviewing. The
  // cap is applied AFTER sorting, so what survives is the highest-scoring
  // and (within a tier) earliest evidence. Nothing is logged about the
  // truncation — this module is silent by contract.
  var MAX_EVIDENCE_ITEMS = 25;

  var ELLIPSIS = '…';

  // Confirmed GP2GP transfer-encounter marker (docs/learnings-patient-journal-api.md,
  // hit rate confirmed live 2026-07-17). Matched with `indexOf` rather than
  // `===` (which is what record-duplicate-parser.js's isTransferEncounter
  // uses) so a topic title that carries the marker plus extra wording still
  // flags — over-flagging here costs a caveat label, under-flagging costs a
  // wrong authorship claim, and the second is the one that matters.
  var GP2GP_TOPIC_MARKER = 'Data Transferred from other system';

  // ── Reaction lexicon ─────────────────────────────────────────────────────
  // A CURATED STARTING SET, not a clinical ontology, and deliberately not
  // exhaustive: it exists to RANK evidence the clinician then reads, so a
  // term missing from this list costs a demotion from score 3/2 to score 1
  // (the entry is still surfaced whenever the substance is mentioned), never
  // a disappearance. Grown from the term list in the plan doc's Phase 2
  // "Reaction extraction" bullet; expect it to grow again from live use.
  //
  // Morphological variants are listed explicitly (itch/itching/itchy,
  // swelling/swollen, vomiting/vomited) rather than stemmed — stemming is a
  // guess, an explicit list is not. Simple plurals are handled by the
  // matcher itself (see buildTermMatcher).
  //
  // Known limitation, accepted: "sob" is genuine clinical shorthand for
  // shortness of breath but is also an ordinary English word, so a note
  // reading "began to sob" scores as a reaction mention. Matching is
  // case-insensitive by contract, so it can't be narrowed to the
  // capitalised abbreviation. False positives here are cheap (a snippet the
  // clinician reads and dismisses); false negatives are not.
  var REACTION_TERMS = [
    'rash',
    'urticaria',
    'hives',
    'itch',
    'itching',
    'itchy',
    'pruritus',
    'swelling',
    'swollen',
    'angioedema',
    'blister',
    'anaphylaxis',
    'anaphylactic',
    'wheeze',
    'wheezing',
    'breathless',
    'breathlessness',
    'dyspnoea',
    'shortness of breath',
    'sob',
    'collapse',
    'hypotension',
    'nausea',
    'vomiting',
    'vomited',
    'diarrhoea',
    'abdominal pain',
    'cramp',
    'headache',
    'dizziness',
    'dizzy',
    'palpitations',
    'felt unwell',
    'intolerance',
    'intolerant',
    'sensitivity',
    'reaction',
    'allergic',
  ];

  // Words that carry no substance identity of their own — dropped when a
  // multi-word allergy label is broken into individual head words, so
  // "Allergy to nut product" never trawls the record for the word "product".
  // Only consulted for the head-word split; the full normalised phrase is
  // always kept regardless.
  var GENERIC_SUBSTANCE_WORDS = [
    'allergy',
    'allergies',
    'allergic',
    'reaction',
    'reactions',
    'adverse',
    'drug',
    'drugs',
    'medication',
    'medications',
    'medicine',
    'medicines',
    'product',
    'products',
    'substance',
    'substances',
    'agent',
    'agents',
    'preparation',
    'preparations',
    'compound',
    'compounds',
    'containing',
    'unspecified',
    'unknown',
    'other',
    'history',
    'intolerance',
    'sensitivity',
    'hypersensitivity',
    'class',
    'group',
    'type',
    'therapy',
    'caused',
    'from',
    'with',
    'and',
  ];

  // Grammatical glue. Only used (together with GENERIC_SUBSTANCE_WORDS) to
  // recognise a label that, once unwrapped, names no substance at all — e.g.
  // a bare "Allergy" or "Adverse drug reaction" with the substance missing.
  // Such a label must yield NO search terms, because a term like "allergy"
  // would otherwise match half the record and drown the panel in noise.
  var CONNECTOR_WORDS = ['to', 'of', 'the', 'a', 'an', 'or', 'in', 'on', 'by', 'due', 'not', 'nos', 'nec'];

  // Minimum length for a head word extracted from a multi-word label. Below
  // this a "word" is almost always a salt/route fragment or an abbreviation
  // too short to word-boundary match usefully across a whole record.
  var MIN_HEAD_WORD_CHARS = 4;

  function isNonSubstanceWord(word) {
    return GENERIC_SUBSTANCE_WORDS.indexOf(word) !== -1 || CONNECTOR_WORDS.indexOf(word) !== -1;
  }

  // ── Label normalisation ──────────────────────────────────────────────────

  // Leading wrappers Medicus/GP2GP descriptions put in front of the actual
  // substance. Anchored and applied repeatedly (see stripWrappers) so
  // stacked wrappers — "H/O: allergy to penicillin" — fully unwind.
  var LEADING_WRAPPER_RE =
    /^(?:allergy to|allergic to|adverse reaction to|adverse reaction caused by|adverse drug reaction to|adverse drug reaction caused by|drug allergy to|reaction to|hypersensitivity to|sensitivity to|intolerance to)\s+/i;

  // Trailing wrappers — "Penicillin allergy", "Amoxicillin adverse reaction".
  var TRAILING_WRAPPER_RE =
    /\s+(?:allergy|allergies|adverse reaction|adverse drug reaction|drug allergy|hypersensitivity|intolerance|sensitivity)\.?$/i;

  // Bounded so a pathological label can never spin here. Four passes covers
  // every stacked form seen in the plan doc's examples with room to spare.
  var MAX_WRAPPER_PASSES = 4;

  function stripLegacyMarkers(text) {
    // ICD bracket prefix ("[X]"/"[D]"/"[M]"), "H/O"/"H/O:" prefix, trailing
    // NOS/NEC, trailing bracketed abbreviation. Degrades to a no-op if the
    // shared module isn't loaded (see the soft-dependency note above).
    if (!legacyCodedDescription || typeof legacyCodedDescription.stripLegacyMarkers !== 'function') {
      return text;
    }
    return legacyCodedDescription.stripLegacyMarkers(text);
  }

  function stripWrappers(text) {
    var s = text;
    for (var pass = 0; pass < MAX_WRAPPER_PASSES; pass++) {
      var before = s;
      s = stripLegacyMarkers(s).replace(LEADING_WRAPPER_RE, '').replace(TRAILING_WRAPPER_RE, '').trim();
      if (s === before) break;
    }
    return s;
  }

  /**
   * normaliseAllergyLabel(label) -> string[]
   *
   * Turns an allergy entry's display label into the list of lowercase
   * substance terms to search the record for. The FULL normalised phrase is
   * always term [0]; for a multi-word substance its individual head words
   * (>= MIN_HEAD_WORD_CHARS, excluding GENERIC_SUBSTANCE_WORDS) follow, in
   * label order, so "amoxicillin trihydrate" still finds a note that only
   * ever says "amoxicillin".
   *
   *   "Allergy to penicillin"                        -> ["penicillin"]
   *   "[X]Adverse reaction to amoxicillin trihydrate"
   *        -> ["amoxicillin trihydrate", "amoxicillin", "trihydrate"]
   *   "H/O: penicillin allergy"                      -> ["penicillin"]
   *
   * Returns [] for anything unusable (null, non-string, whitespace, or a
   * label that is nothing BUT wrapper words) — an empty term list is the
   * documented "nothing to search for" signal, and findEvidence honours it
   * by returning no evidence rather than matching everything.
   *
   * Words are split on whitespace, "/" and "," so a combined label like
   * "penicillins/cephalosporins" contributes both components as head words
   * while the exact combined phrase is still searched as term [0].
   */
  function normaliseAllergyLabel(label) {
    if (typeof label !== 'string' && typeof label !== 'number') return [];
    var raw = String(label).trim();
    if (!raw) return [];

    var phrase = stripWrappers(raw)
      // Trailing/leading punctuation left behind by wrapper stripping.
      .replace(/^[\s,.;:-]+/, '')
      .replace(/[\s,.;:-]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!phrase) return [];

    var words = phrase.split(/[\s/,]+/).filter(Boolean);
    // Nothing but wrapper/glue words survived — the label never named a
    // substance, so there is nothing to search for (see CONNECTOR_WORDS).
    if (!words.length || words.every(isNonSubstanceWord)) return [];

    var terms = [phrase];
    if (words.length > 1) {
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (w.length < MIN_HEAD_WORD_CHARS) continue;
        if (GENERIC_SUBSTANCE_WORDS.indexOf(w) !== -1) continue;
        if (terms.indexOf(w) !== -1) continue;
        terms.push(w);
      }
    }
    return terms;
  }

  // ── Term matching ────────────────────────────────────────────────────────

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Case-insensitive word-boundary matcher for one term.
  //
  // Boundaries are lookarounds on [A-Za-z0-9] rather than \b so a term whose
  // first/last character isn't a word character (e.g. a "+"-containing
  // product name) still boundary-matches correctly instead of silently
  // never matching.
  //
  // A single optional trailing "s" is allowed so a label of "penicillin"
  // matches a note reading "penicillins". This is a deliberate, documented
  // widening beyond a bare word boundary: this module surfaces candidate
  // evidence for a human to read, so a spurious extra snippet costs a
  // glance whereas a missed one costs the whole point of the feature. It is
  // NOT general stemming — "cramping" still does not match "cramp".
  function buildTermMatcher(term) {
    return new RegExp('(?<![A-Za-z0-9])' + escapeRegExp(term) + 's?(?![A-Za-z0-9])', 'gi');
  }

  function compileTerms(terms) {
    var out = [];
    for (var i = 0; i < terms.length; i++) {
      var t = String(terms[i] || '')
        .trim()
        .toLowerCase();
      if (!t) continue;
      try {
        out.push({ term: t, re: buildTermMatcher(t) });
      } catch (_) {
        // A term that can't be compiled is dropped, never thrown on.
      }
    }
    return out;
  }

  // All matches of every compiled term in `text`, as {term, index, length}.
  function findTermMatches(text, compiled) {
    var hits = [];
    for (var i = 0; i < compiled.length; i++) {
      var re = compiled[i].re;
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        hits.push({ term: compiled[i].term, index: m.index, length: m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++; // defensive: zero-width safety
      }
    }
    return hits;
  }

  // ── Snippets ─────────────────────────────────────────────────────────────

  /**
   * A verbatim slice of `text`, centred on the match at `centre`, at most
   * `maxChars` long INCLUDING the ellipsis characters marking each cut end.
   * The returned inner content is always an exact `text.slice()` — this
   * function must never rewrite, join, summarise or reflow source text.
   * (The only whitespace liberty taken anywhere in this module is trimming
   * the outer whitespace of a source field at collection time; interior
   * text is untouched.)
   */
  function buildSnippet(text, centre, matchLength, maxChars) {
    var max = maxChars > 0 ? maxChars : DEFAULT_SNIPPET_CHARS;
    if (text.length <= max) return text;

    var half = Math.floor((max - matchLength) / 2);
    var start = Math.max(0, centre - Math.max(0, half));
    var end = Math.min(text.length, start + max);
    start = Math.max(0, end - max);

    var lead = start > 0 ? ELLIPSIS : '';
    var tail = end < text.length ? ELLIPSIS : '';
    var room = max - lead.length - tail.length;
    return lead + text.slice(start, start + room) + tail;
  }

  // ── Dates ────────────────────────────────────────────────────────────────

  var MONTHS = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };

  // Deliberately unanchored and day-name-agnostic: the confirmed format is
  // "DayName DD Mon YYYY" ("Thu 02 Jul 2026"), but a day title is display
  // text from someone else's API, so this pulls the DD/Mon/YYYY triple out
  // of whatever surrounds it and returns null rather than guessing when it
  // can't. Every evidence item carries `dateRaw` (the untouched title) too,
  // so a title this can't parse is still shown to the clinician verbatim.
  var DAY_TITLE_RE = /(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /**
   * parseDayTitle("Thu 02 Jul 2026") -> "2026-07-02" (ISO date, no time).
   * Returns null for anything unparseable. ISO strings are used rather than
   * Date objects so that plain lexicographic sorting is chronological and
   * the value survives JSON round-trips unchanged.
   */
  function parseDayTitle(title) {
    if (typeof title !== 'string') return null;
    var m = title.match(DAY_TITLE_RE);
    if (!m) return null;
    var day = parseInt(m[1], 10);
    var month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    var year = parseInt(m[3], 10);
    if (!month || !(day >= 1 && day <= 31) || !(year >= 1900 && year <= 2200)) return null;
    return year + '-' + pad2(month) + '-' + pad2(day);
  }

  // ── Journal walking ──────────────────────────────────────────────────────

  /**
   * Accepts the raw `clinical/data/patient-journal/overview/{patientId}`
   * payload or a bare array of day-groups. `patientJournalRecords` is the
   * live-confirmed key (docs/learnings-patient-journal-api.md, 2026-07-02);
   * unlike record-duplicate-parser.js's extractDayGroups this does NOT keep
   * the pre-confirmation `journal`/`timeline`/`days` guesses, because a new
   * consumer written after the shape was confirmed shouldn't inherit them.
   */
  function extractDayGroups(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    var records = payload.patientJournalRecords;
    return Array.isArray(records) ? records : [];
  }

  // An entry/item that Medicus itself has retracted is not evidence of
  // anything. `isMarkedIncorrect` (confirmed spelling — the problem-listing
  // endpoint elsewhere uses `isMarkedAsIncorrect`; do not conflate) and
  // `isDraft` are both hard skips.
  function isRetracted(node) {
    return !!(node && (node.isMarkedIncorrect === true || node.isDraft === true));
  }

  function isTransferEncounter(encounterData) {
    var topics = (encounterData && encounterData.consultationTopics) || [];
    if (!Array.isArray(topics)) return false;
    for (var i = 0; i < topics.length; i++) {
      var title = topics[i] && topics[i].title;
      if (typeof title === 'string' && title.indexOf(GP2GP_TOPIC_MARKER) !== -1) return true;
    }
    return false;
  }

  // Collects the searchable text fields of one item/entry, in the order they
  // should be PREFERRED for a snippet: narrative first (a note is the thing
  // a clinician wants quoted), then coded descriptions and titles, then
  // product/dosage text. Non-strings and blanks are dropped; arrays of
  // strings (e.g. investigation-request's `investigationRequestItems`) are
  // flattened in place. Outer whitespace is trimmed — interior text never.
  function collectTexts(values) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (Array.isArray(v)) {
        for (var j = 0; j < v.length; j++) {
          if (typeof v[j] === 'string' && v[j].trim()) out.push(v[j].trim());
        }
        continue;
      }
      if (typeof v === 'string' && v.trim()) out.push(v.trim());
    }
    return out;
  }

  // Maps a flat top-level `item.type` onto the evidence item's sourceType.
  // The 8 types with no dedicated branch (investigation, referral,
  // communication, observation, future-action, investigation-request,
  // medication-statement-prescribed-elsewhere) are NOT skipped — unlike
  // record-duplicate-parser.js, which only compares a subset, this module
  // wants every scrap of text in the record, so they land in 'other' and
  // are still searched via their title/descriptionText.
  function flatSourceType(type) {
    if (type === 'note') return 'note';
    if (type === 'prescription') return 'prescription';
    if (type === 'document') return 'document';
    return 'other';
  }

  // Nested entries are labelled 'encounter-entry' by default, EXCEPT
  // prescriptions and documents: a prescription is the same corroborating-
  // exposure evidence whether it renders flat or nested (and the tier-1
  // "prescription of the substance" rule is defined on the source type, not
  // on where it happened to sit in the payload), and a document is a
  // document. `fit-note` is the confirmed finer-grained document subtype.
  function nestedSourceType(entryType) {
    if (entryType === 'prescription' || entryType === 'prescription-issue') return 'prescription';
    if (entryType === 'document' || entryType === 'fit-note') return 'document';
    return 'encounter-entry';
  }

  // Walks the payload into a flat list of scoreable candidates. Each level
  // is individually try/caught by the caller loop below, so one malformed
  // day/item/entry can never lose the rest of the record.
  function collectCandidates(dayGroups) {
    var candidates = [];

    for (var d = 0; d < dayGroups.length; d++) {
      var day = dayGroups[d];
      if (!day || typeof day !== 'object') continue;
      var dateRaw = typeof day.title === 'string' ? day.title : null;
      var date = parseDayTitle(dateRaw);
      var items = Array.isArray(day.items) ? day.items : [];

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || typeof item !== 'object') continue;
        if (isRetracted(item)) continue;
        var data = item.data && typeof item.data === 'object' ? item.data : {};

        if (item.type === 'encounter') {
          var gp2gp = isTransferEncounter(data);
          // Encounter-level authorship, used only as a fallback when the
          // entry itself carries none (confirmed plain string). Prescription
          // entries have NO recordedBy field at all, so for those this is the
          // only authorship signal the payload offers — it is the encounter's
          // responsible practitioner, not a per-entry claim, which is why the
          // UI wording must stay "recorded in this encounter by", never
          // "recorded by".
          var practitioner = typeof data.responsiblePractitioner === 'string' ? data.responsiblePractitioner : null;
          var topics = Array.isArray(data.consultationTopics) ? data.consultationTopics : [];

          for (var t = 0; t < topics.length; t++) {
            var topic = topics[t];
            if (!topic || typeof topic !== 'object') continue;
            var headings = Array.isArray(topic.headings) ? topic.headings : [];
            for (var h = 0; h < headings.length; h++) {
              var heading = headings[h];
              if (!heading || typeof heading !== 'object') continue;
              var entries = Array.isArray(heading.entries) ? heading.entries : [];
              for (var e = 0; e < entries.length; e++) {
                var entry = entries[e];
                if (!entry || typeof entry !== 'object') continue;
                if (isRetracted(entry)) continue;
                var isRx = entry.entryType === 'prescription' || entry.entryType === 'prescription-issue';
                candidates.push({
                  date: date,
                  dateRaw: dateRaw,
                  sourceType: nestedSourceType(entry.entryType),
                  recordedBy: (!isRx && typeof entry.recordedBy === 'string' ? entry.recordedBy : null) || practitioner,
                  recordedByOrganisation:
                    !isRx && typeof entry.recordedByOrganisation === 'string' ? entry.recordedByOrganisation : null,
                  isGp2gpImport: gp2gp,
                  texts: collectTexts([
                    entry.note,
                    entry.clinicalCodeDescription,
                    entry.title,
                    entry.descriptionText,
                    entry.documentTypeLabel,
                    entry.additionalInformation,
                    entry.type,
                    entry.productName,
                    entry.dosageText,
                    entry.investigationRequestItems,
                  ]),
                });
              }
            }
          }
          continue;
        }

        // Flat top-level item.
        var flatType = flatSourceType(item.type);
        var flatIsRx = flatType === 'prescription';
        candidates.push({
          date: date,
          dateRaw: dateRaw,
          sourceType: flatType,
          // Prescriptions: confirmed-absent fields are reported as null
          // rather than read hopefully (live check 2026-07-17).
          // investigation-request's `requestedBy`/`requestingOrganisation`
          // are the confirmed authorship fields for that type.
          recordedBy: flatIsRx
            ? null
            : (typeof data.recordedBy === 'string' ? data.recordedBy : null) ||
              (typeof data.requestedBy === 'string' ? data.requestedBy : null),
          recordedByOrganisation: flatIsRx
            ? null
            : (typeof data.recordedByOrganisation === 'string' ? data.recordedByOrganisation : null) ||
              (typeof data.requestingOrganisation === 'string' ? data.requestingOrganisation : null),
          // A flat item is not inside an encounter, so there is no transfer
          // topic to read — never claim an import we can't see.
          isGp2gpImport: false,
          texts: collectTexts([
            data.note,
            data.clinicalCodeDescription,
            // For a flat DOCUMENT the real title lives at `data.title`;
            // `item.title`/`item.descriptionText` were live-confirmed always
            // null for documents (record-duplicate-parser.js header,
            // 2026-07-04). They are still read here because they are real
            // fields on other item types and cost nothing when null.
            data.title,
            item.title,
            item.descriptionText,
            data.descriptionText,
            data.documentTypeLabel,
            data.additionalInformation,
            data.productName,
            data.dosageText,
            data.investigationRequestItems,
          ]),
        });
      }
    }

    return candidates;
  }

  // ── Scoring ──────────────────────────────────────────────────────────────
  //
  // Tiers, highest first:
  //   3  substance term AND a reaction term within ±proximityChars of each
  //      other in the SAME text field — "urticarial rash after amoxicillin".
  //   2  substance term AND a reaction term somewhere in the same entry, but
  //      not close together (or in different fields of it).
  //   1  substance term only — a bare mention in a note / document title /
  //      coded description, or a prescription of the substance (which
  //      corroborates exposure rather than describing a reaction).
  //
  // A reaction term with NO substance match is not evidence of THIS allergy
  // and is never emitted. Prescriptions are scored by the same rules as
  // everything else rather than being pinned to 1: in practice their text is
  // productName/dosageText, which carries no reaction narrative, so they land
  // at 1 anyway — but if a dosage line genuinely does record a reaction, that
  // is real evidence and shouldn't be artificially demoted.
  function scoreCandidate(candidate, subCompiled, reactCompiled, proximityChars) {
    // Pass 1 — substance only. The overwhelming majority of a record's
    // entries mention neither the substance nor anything else relevant, and
    // bailing here means the (much larger) reaction lexicon is never run
    // across them at all.
    var subsByField = [];
    var matchedSub = [];
    var firstSub = null; // {textIndex, index, length}
    for (var i = 0; i < candidate.texts.length; i++) {
      var subs = findTermMatches(candidate.texts[i], subCompiled);
      subsByField.push(subs);
      for (var s = 0; s < subs.length; s++) {
        if (matchedSub.indexOf(subs[s].term) === -1) matchedSub.push(subs[s].term);
      }
      if (!firstSub && subs.length) {
        firstSub = { textIndex: i, index: subs[0].index, length: subs[0].length };
      }
    }
    // A reaction word with no substance match is not evidence of THIS
    // allergy — nothing is emitted for it.
    if (!firstSub) return null;

    // Pass 2 — reactions across EVERY field (score 2 is "anywhere in the
    // same entry", including a field the substance never appeared in), plus
    // the first same-field proximity pair for score 3.
    var matchedReact = [];
    var proximate = null; // {textIndex, index, length}
    for (var j = 0; j < candidate.texts.length; j++) {
      var reacts = findTermMatches(candidate.texts[j], reactCompiled);
      for (var r = 0; r < reacts.length; r++) {
        if (matchedReact.indexOf(reacts[r].term) === -1) matchedReact.push(reacts[r].term);
      }
      if (proximate || !reacts.length) continue;
      var fieldSubs = subsByField[j];
      for (var a = 0; a < fieldSubs.length && !proximate; a++) {
        for (var b = 0; b < reacts.length; b++) {
          if (Math.abs(fieldSubs[a].index - reacts[b].index) <= proximityChars) {
            proximate = { textIndex: j, index: fieldSubs[a].index, length: fieldSubs[a].length };
            break;
          }
        }
      }
    }

    var score = proximate ? 3 : matchedReact.length ? 2 : 1;
    var anchor = proximate || firstSub;
    return {
      score: score,
      matchedSubstanceTerms: matchedSub,
      matchedReactionTerms: matchedReact,
      anchor: anchor,
    };
  }

  // ── Public entry point ───────────────────────────────────────────────────

  /**
   * findEvidence(allergyLabel, journalPayload, opts?)
   *   -> { evidence: EvidenceItem[], provenance: Provenance|null, substanceTerms: string[] }
   *
   * EvidenceItem:
   *   {
   *     date,                    // "YYYY-MM-DD" from the day-group title, or null
   *     dateRaw,                 // the day-group title verbatim, or null
   *     sourceType,              // 'note'|'prescription'|'document'|'encounter-entry'|'other'
   *     recordedBy,              // string|null
   *     recordedByOrganisation,  // string|null
   *     snippet,                 // VERBATIM slice of the source field, <= snippetChars
   *     matchedSubstanceTerms,   // string[]
   *     matchedReactionTerms,    // string[]
   *     score,                   // 3 | 2 | 1  (see scoreCandidate)
   *     isGp2gpImport,           // true => recordedBy is the importer, not the author
   *   }
   *
   * Provenance (the earliest DATED evidence item of any tier — the likely
   * origin event), or null when nothing dated was found:
   *   { date, dateRaw, recordedBy, recordedByOrganisation, sourceType, isGp2gpImport }
   *
   * Sorted score DESC, then date ASC (earliest first within a tier; undated
   * items sort last), then payload order. Capped at `maxItems`.
   *
   * `provenance` is computed from ALL evidence found, BEFORE the cap — the
   * origin event is the clinically interesting fact and must not vanish
   * because a chatty record pushed it past item 25. It carries no snippet,
   * so it can never present unquoted text as a quote.
   *
   * opts (all optional):
   *   maxItems             number   default MAX_EVIDENCE_ITEMS (25)
   *   proximityChars       number   default DEFAULT_PROXIMITY_CHARS (120)
   *   snippetChars         number   default DEFAULT_SNIPPET_CHARS (240)
   *   extraSubstanceTerms  string[] appended to the normalised label terms —
   *                                 the injection point for brand<->generic
   *                                 bridging (e.g. a drug-rules.json match
   *                                 list) WITHOUT this module taking a
   *                                 dependency on the rule set. Everything
   *                                 not covered by a rule degrades to the
   *                                 plain text match, exactly as the plan
   *                                 doc requires.
   */
  function findEvidence(allergyLabel, journalPayload, opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var maxItems = typeof o.maxItems === 'number' && o.maxItems >= 0 ? o.maxItems : MAX_EVIDENCE_ITEMS;
    var proximityChars =
      typeof o.proximityChars === 'number' && o.proximityChars >= 0 ? o.proximityChars : DEFAULT_PROXIMITY_CHARS;
    var snippetChars =
      typeof o.snippetChars === 'number' && o.snippetChars > 0 ? o.snippetChars : DEFAULT_SNIPPET_CHARS;

    var substanceTerms = [];
    try {
      substanceTerms = normaliseAllergyLabel(allergyLabel);
      if (Array.isArray(o.extraSubstanceTerms)) {
        for (var x = 0; x < o.extraSubstanceTerms.length; x++) {
          var extra = String(o.extraSubstanceTerms[x] || '')
            .trim()
            .toLowerCase();
          if (extra && substanceTerms.indexOf(extra) === -1) substanceTerms.push(extra);
        }
      }
    } catch (_) {
      substanceTerms = [];
    }

    var empty = { evidence: [], provenance: null, substanceTerms: substanceTerms };
    if (!substanceTerms.length) return empty;

    var subCompiled = compileTerms(substanceTerms);
    var reactCompiled = compileTerms(REACTION_TERMS);
    if (!subCompiled.length) return empty;

    var candidates;
    try {
      candidates = collectCandidates(extractDayGroups(journalPayload));
    } catch (_) {
      return empty;
    }

    var scored = [];
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c];
      var result;
      try {
        result = scoreCandidate(cand, subCompiled, reactCompiled, proximityChars);
      } catch (_) {
        continue; // one bad candidate never loses the rest of the record
      }
      if (!result) continue;
      var sourceText = cand.texts[result.anchor.textIndex];
      scored.push({
        order: c,
        item: {
          date: cand.date,
          dateRaw: cand.dateRaw,
          sourceType: cand.sourceType,
          recordedBy: cand.recordedBy || null,
          recordedByOrganisation: cand.recordedByOrganisation || null,
          snippet: buildSnippet(sourceText, result.anchor.index, result.anchor.length, snippetChars),
          matchedSubstanceTerms: result.matchedSubstanceTerms,
          matchedReactionTerms: result.matchedReactionTerms,
          score: result.score,
          isGp2gpImport: !!cand.isGp2gpImport,
        },
      });
    }

    // score DESC, then date ASC (undated last), then payload order — the
    // explicit order tiebreak keeps the result identical regardless of the
    // host engine's sort stability.
    scored.sort(function (a, b) {
      if (a.item.score !== b.item.score) return b.item.score - a.item.score;
      var ad = a.item.date;
      var bd = b.item.date;
      if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;
      if (ad && !bd) return -1;
      if (!ad && bd) return 1;
      return a.order - b.order;
    });

    var all = scored.map(function (s) {
      return s.item;
    });

    var provenance = null;
    for (var p = 0; p < all.length; p++) {
      var it = all[p];
      if (!it.date) continue;
      if (!provenance || it.date < provenance.date) {
        provenance = {
          date: it.date,
          dateRaw: it.dateRaw,
          recordedBy: it.recordedBy,
          recordedByOrganisation: it.recordedByOrganisation,
          sourceType: it.sourceType,
          isGp2gpImport: it.isGp2gpImport,
        };
      }
    }

    return {
      evidence: all.slice(0, maxItems),
      provenance: provenance,
      substanceTerms: substanceTerms,
    };
  }

  var api = {
    normaliseAllergyLabel,
    findEvidence,
    // Exported for tests / future consumers — deliberately part of the
    // contract so a change to any of them is visible in a diff of the tests.
    parseDayTitle,
    extractDayGroups,
    buildSnippet,
    REACTION_TERMS,
    GENERIC_SUBSTANCE_WORDS,
    MAX_EVIDENCE_ITEMS,
    DEFAULT_PROXIMITY_CHARS,
    DEFAULT_SNIPPET_CHARS,
    GP2GP_TOPIC_MARKER,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.AllergyEvidence = api;
  }
})(typeof window !== 'undefined' ? window : global);
