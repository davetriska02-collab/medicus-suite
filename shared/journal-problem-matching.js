// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — finds patient-journal note entries that look like the SAME
// clinical event as a given problem, so "Clean up code" (content-scripts/
// problem-description-cleanup.js) can tell the clinician a journal duplicate
// exists and also needs fixing. DETECTION ONLY — this module surfaces
// candidates and does not itself write anything. The write path (confirmed
// live 2026-08-13, POST /clinical/note/change-note) is implemented in
// content-scripts/problem-description-cleanup.js's own applyToJournal/
// buildChangeNotePayload — kept out of this module deliberately, since this
// file is pure (no fetch/DOM) and the write needs both.
//
// WHY A PURPOSE-BUILT WALKER, NOT A REUSE OF engine/record-duplicate-parser.js's
// flattenJournal(): that function already walks the full journal shape (all
// 11 item types, both nesting styles, all three linkedProblems levels) but
// lives only in the duplicate-checker.html bundle, not the medicus.health
// content-script group. Rather than extract it (touching a stable, tested,
// load-bearing file for a second consumer), this module walks a narrower
// slice on purpose: only entryType/type === 'note' entries. Prescriptions,
// documents, investigation-requests etc. carry productName/documentTypeLabel/
// investigationRequestItems text — not a SNOMED-code-style clinical
// description — so comparing them against a problem's problemCodeDescription
// would be comparing unrelated kinds of text, not a corner cut.
//
// Journal entries carry NO conceptId/descriptionId in the BULK
// patient-journal/overview payload this module reads — only
// clinicalCodeDescription free text (docs/learnings-patient-journal-api.md).
// So matching here is text/date-based, corroborated by Medicus's own
// linkedProblems back-reference where it's populated. (Two SEPARATE
// per-note endpoints DO expose a full structured code —
// GET /clinical/data/note/overview/{noteId} (confirmed live 2026-08-12,
// `noteSNOMEDctCode`, used by the date-verification caller-orchestrated
// fetch — see resolveVerifiedDateMatch) and
// GET /clinical/data/note/edit-note/{noteId} (confirmed live 2026-08-13,
// `noteSNOMEDct`, the write-path prefill — see
// content-scripts/problem-description-cleanup.js's applyToJournal). Neither
// is fetched by THIS module, which stays pure/no-fetch by design — both are
// orchestrated by the caller.)
//
// linkedProblems appears at three levels — encounter, topic, entry — and
// they are NOT equally trustworthy as a per-entry signal. CONFIRMED LIVE
// 2026-08-12 (real patient, "Obesity" problem, 11 journal entries in one
// consultation topic): topic-level linkedProblems tags the WHOLE topic, not
// the one specific entry that's the real duplicate — 10 of those 11 entries
// (alcohol/smoking/aspirin/drug-therapy notes) inherited the "linked to
// Obesity" flag purely because they sat in the same consultation topic as
// the one entry actually coded "Obesity". Treating topic/encounter-level
// linkedProblems as sufficient on its own (as an earlier version of this
// module did, fixed same day as a different bug — an umbilical-hernia
// note+problem pair where topic-level was the ONLY populated level) was
// therefore too broad: it floods the panel with unrelated sibling entries
// for any problem discussed alongside several other things in one visit.
//
// So this module distinguishes:
//   - ENTRY-level linkedProblems — a true per-entry fact when Medicus
//     populates it (confirmed real via the per-note detail endpoint, see
//     below, though rarely populated in the BULK payload this module
//     reads) — trusted standalone, tier 'linked', no text/date needed.
//   - TOPIC/ENCOUNTER-level linkedProblems — a topic-wide or encounter-wide
//     fact, NOT a per-entry one — only used to UPGRADE a candidate that ALSO
//     has a text match (its own clinicalCodeDescription genuinely matching
//     the problem's description), never as a standalone bypass. This is
//     what fixes the Obesity flood (the 10 unrelated siblings have zero
//     text overlap with "Obesity" and are correctly excluded) without
//     breaking the hernia case (its one candidate had both topic-level
//     linkage AND matching text).
//
// Field access mirrors engine/record-duplicate-parser.js's flattenJournal
// exactly for the 'note' branches (nested-under-encounter and flat
// top-level) — same confirmed live shape, just narrower coverage.
//
// FUZZY FALLBACK (added 2026-08-12, Nick's request; extended same day with
// a second check): GP2GP import can duplicate whole records, not just
// individual codes — so if the primary tiers above find NOTHING for a
// problem, that's not proof no duplicate exists; it may just mean the
// duplicate's own clinicalCodeDescription doesn't textually resemble the
// problem's CURRENT description (see the KNOWN LIMITATION below — this is
// the same underlying gap, addressed here for the "found literally
// nothing" case specifically). Only runs when the primary pass found zero
// results — never alongside a confident primary match, and never invented
// from nothing. Both checks below share the same loosened date requirement
// (exact day-equality relaxed to FUZZY_DATE_TOLERANCE_DAYS, see that
// constant's own comment for why) and the same non-fuzzy word-overlap
// matcher (matchProblemByName) as every other tier — "fuzzy" here means
// loosened DATE and a DIFFERENT field pair, not a different (edit-distance/
// stemming) comparison algorithm; this codebase deliberately avoids that
// elsewhere (see shared/problem-text-linking.js's own header) and this
// module follows the same discipline. Both scoped to 'note' entries only,
// same as the rest of this module — document entries also carry their own
// additionalInformation field (confirmed in engine/record-duplicate-
// parser.js's document branch) which could extend either check later; not
// done here, flagged as a follow-up, not an oversight.
//
// Two DIFFERENT field pairings, checked in this order per candidate
// (first match wins — a candidate is never counted under both tiers):
//   1. 'fuzzy-code-text-exact'/'fuzzy-code-text-partial' — does the
//      candidate's own free-text `note` field CONTAIN the problem's own
//      code text (problem.description)? Checked via matchProblemByName's
//      existing 'partial' tier semantics (every significant word of the
//      code text present, word-boundary, somewhere in the note) — this IS
//      a "contains" check, just implemented via the same word-overlap
//      matcher as everywhere else rather than a separate literal-substring
//      code path. Tried first: a problem's code text is normally a short,
//      fairly distinctive phrase, less likely to coincidentally overlap
//      than free-form additionalInformation prose — a judgement call on
//      ordering, not a proven ranking, easy to swap.
//   2. 'fuzzy-additional-info-exact'/'fuzzy-additional-info-partial' — the
//      original fuzzy check: problem.additionalInformation against the same
//      `note` field. Only tried if (1) didn't match.
//
// KNOWN LIMITATION, NOT YET FIXED (flagged 2026-08-12, live testing): once a
// problem's code has ALREADY been cleaned up via "Clean up code", its
// description has changed to the new/clean wording — but the journal
// duplicate still carries the OLD, pre-cleanup wording.
// findJournalMatchesForProblem compares against the problem's CURRENT
// description only, so every tier that requires a text match
// ('linked-exact-text', 'linked-partial-text', 'date-exact-text',
// 'date-partial-text') will typically fail to recognise a journal duplicate
// of an ALREADY-edited problem, even though that's exactly the case most
// worth surfacing (the two are now MOST out of sync). Only the entry-level
// 'linked' tier is unaffected (pure ID match, no text involved) — but entry-
// level linkedProblems is rarely populated in the bulk payload this module
// reads (confirmed empty in both live examples so far; topic/encounter-level
// was where the real signal was in each case), so in practice most already-
// cleaned-up problems will show NO journal match at all post-cleanup. The
// fuzzy fallback above gives a PARTIAL mitigation (a different field pair,
// additionalInformation vs note, might still line up even when
// clinicalCodeDescription no longer does) but is not a real fix — it only
// runs when the primary pass found nothing, and additionalInformation is
// often GP2GP boilerplate rather than free prose, so it won't always help.
// Planned direction, not started: reuse matching/tiering logic already built
// for engine/record-duplicate-parser.js's duplicate-checker (which has its
// own, more robust cross-entity comparison heuristics beyond a literal
// string match) rather than reinventing a second historical-text comparison
// here.

'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ──

  var MONTHS = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };

  // Day-group `title` is "DayName DD Mon YYYY" (confirmed live,
  // docs/learnings-patient-journal-api.md — e.g. "Thu 02 Jul 2026"). Takes
  // the LAST 3 whitespace-separated tokens rather than assuming a fixed
  // weekday-name position/format, so it's robust to a longer/shorter
  // weekday token. Never throws — null on anything unparseable.
  function normaliseJournalDayTitle(title) {
    var s = title == null ? '' : String(title).trim();
    if (!s) return null;
    var parts = s.split(/\s+/);
    if (parts.length < 3) return null;
    var day = parts[parts.length - 3];
    var mon = parts[parts.length - 2];
    var year = parts[parts.length - 1];
    if (!/^\d{1,2}$/.test(day)) return null;
    if (!/^\d{4}$/.test(year)) return null;
    var mm = MONTHS[mon.toLowerCase().slice(0, 3)];
    if (!mm) return null;
    var dd = day.length === 1 ? '0' + day : day;
    return year + '-' + mm + '-' + dd;
  }

  function dedupeIds(list) {
    var out = [];
    var seen = {};
    (Array.isArray(list) ? list : []).forEach(function (p) {
      var id = p && p.id;
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function unionIds(a, b) {
    var out = a.slice();
    b.forEach(function (id) {
      if (out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  // Absolute day difference between two 'YYYY-MM-DD' strings, or null if
  // either is missing/unparseable. Parsed as UTC midnight so this never
  // drifts by a day depending on the machine's local timezone/DST.
  function daysBetween(dateA, dateB) {
    if (!dateA || !dateB || !/^\d{4}-\d{2}-\d{2}$/.test(dateA) || !/^\d{4}-\d{2}-\d{2}$/.test(dateB)) return null;
    var msA = Date.parse(dateA + 'T00:00:00Z');
    var msB = Date.parse(dateB + 'T00:00:00Z');
    if (isNaN(msA) || isNaN(msB)) return null;
    return Math.round(Math.abs(msA - msB) / 86400000);
  }

  // WHY A TOLERANCE WINDOW AT ALL, NOT EXACT-DATE MATCHING (Nick,
  // 2026-08-12): UK GP clinical systems routinely code information from a
  // document (e.g. a hospital discharge letter) against the date the
  // document was RECEIVED or CODED at the practice, not the date the
  // clinical event actually happened. For a single real episode this can
  // produce up to five genuinely different dates: (1) the actual event
  // date (e.g. when the patient had the heart attack), (2) the document
  // date (e.g. when they were discharged after treatment for it), (3) the
  // document SEND date (when the hospital posted/transmitted the letter),
  // (4) the document RECEIPT date (when it reached the practice), and (5)
  // the CODING date (when practice staff actually entered it against the
  // record) — and a problem and its journal duplicate can each have been
  // dated against a DIFFERENT one of these five, independently. This is
  // the same underlying phenomenon as the 12-day drift already confirmed
  // live between a journal day-group's date and a note's own recordDate
  // (the hernia case, docs/learnings-patient-journal-api.md) — just with
  // more possible causes than that one case alone showed. 30 days is
  // Nick's chosen window to reasonably span this cross-system drift without
  // being unbounded — a deliberate judgement call, not a measured optimum,
  // kept as a single named constant so it's easy to revisit.
  var FUZZY_DATE_TOLERANCE_DAYS = 30;

  // Walks the ALREADY-EXTRACTED patientJournalRecords array — this module
  // doesn't guess wrapper keys (unlike record-duplicate-parser.js's
  // extractDayGroups, written before patientJournalRecords was confirmed).
  // Returns only entryType/type === 'note' entries with a non-empty
  // clinicalCodeDescription, from both the nested-under-encounter shape
  // (data.consultationTopics[].headings[].entries[]) and the flat
  // top-level shape (item.type === 'note').
  //
  // entryLinkedProblemIds vs wideLinkedProblemIds — see file header for why
  // these are kept SEPARATE rather than unioned into one list: entry-level
  // is a true per-entry fact (trusted standalone by findJournalMatchesForProblem);
  // topic/encounter-level is topic-wide/encounter-wide (only used to upgrade
  // a candidate that also has a text match).
  function extractJournalNoteCandidates(dayGroups) {
    var out = [];

    (Array.isArray(dayGroups) ? dayGroups : []).forEach(function (day) {
      var rawDate = day && day.title ? day.title : null;
      var normalisedDate = normaliseJournalDayTitle(rawDate);

      (day && Array.isArray(day.items) ? day.items : []).forEach(function (item) {
        if (!item) return;

        if (item.type === 'encounter') {
          var enc = item.data || {};
          var encounterLinkedIds = dedupeIds(enc.linkedProblems);

          (Array.isArray(enc.consultationTopics) ? enc.consultationTopics : []).forEach(function (topic) {
            var topicWideLinkedIds = unionIds(encounterLinkedIds, dedupeIds(topic && topic.linkedProblems));
            (Array.isArray(topic && topic.headings) ? topic.headings : []).forEach(function (heading) {
              (Array.isArray(heading && heading.entries) ? heading.entries : []).forEach(function (entry) {
                if (!entry || entry.entryType !== 'note' || !entry.clinicalCodeDescription) return;
                out.push({
                  entryId: entry.id,
                  encounterId: item.id,
                  rawDate: rawDate,
                  normalisedDate: normalisedDate,
                  clinicalCodeDescription: entry.clinicalCodeDescription,
                  note: entry.note || null,
                  entryLinkedProblemIds: dedupeIds(entry.linkedProblems),
                  wideLinkedProblemIds: topicWideLinkedIds,
                });
              });
            });
          });
        } else if (item.type === 'note') {
          var d = item.data || {};
          if (!d.clinicalCodeDescription) return;
          out.push({
            entryId: d.id || item.id,
            encounterId: null,
            rawDate: rawDate,
            normalisedDate: normalisedDate,
            clinicalCodeDescription: d.clinicalCodeDescription,
            note: d.note || null,
            entryLinkedProblemIds: dedupeIds(d.linkedProblems),
            wideLinkedProblemIds: [],
          });
        }
      });
    });

    return out;
  }

  var TIER_RANK = {
    linked: 0,
    'linked-exact-text': 1,
    'linked-partial-text': 2,
    'verified-date-exact-text': 3,
    'verified-date-partial-text': 4,
    'date-exact-text': 5,
    'date-partial-text': 6,
    'fuzzy-code-text-exact': 7,
    'fuzzy-code-text-partial': 8,
    'fuzzy-additional-info-exact': 9,
    'fuzzy-additional-info-partial': 10,
  };

  // 'verified-date-exact-text'/'verified-date-partial-text' (added
  // 2026-08-13, Nick's request): the day-group `title` this module uses for
  // 'date-exact-text'/'date-partial-text' is confirmed to sometimes be the
  // WRONG date (it's createdInOriginalSystemDateTime, not the note's own
  // recordDate — see docs/learnings-patient-journal-api.md and
  // FUZZY_DATE_TOLERANCE_DAYS's comment on why GP systems produce this kind
  // of drift). A candidate whose OWN clinicalCodeDescription genuinely
  // matches the problem's code, but whose day-group-title date doesn't line
  // up, might just be a day-group-title artifact — not a real non-match.
  // Getting the note's TRUE recordDate needs a separate per-note fetch
  // (GET /clinical/data/note/overview/{noteId}, confirmed live 2026-08-12 —
  // NOT available in the bulk payload this module otherwise reads), which
  // this PURE module cannot do itself. So this is split across two pure
  // functions the CALLER orchestrates around its own fetch:
  //   - findCodeTextMatches(problem, dayGroups, matchProblemByName) — every
  //     candidate whose clinicalCodeDescription text-matches the problem,
  //     regardless of date, flagged with whether it's already covered by a
  //     cheaper tier (alreadyStructurallyLinked / alreadyDateMatched) so the
  //     caller only spends a fetch on candidates that would OTHERWISE be
  //     silently dropped — not on every text-matched candidate.
  //   - resolveVerifiedDateMatch(problem, candidate, verifiedRecordDate) —
  //     given a candidate from the above PLUS the note's genuine recordDate
  //     (fetched by the caller), decides whether it's within
  //     FUZZY_DATE_TOLERANCE_DAYS of EITHER problem.recordDate OR
  //     problem.onsetDate — "chiefly recordDate and onsetDate", Nick's own
  //     framing, tried as alternatives rather than requiring both. Ranked
  //     ABOVE the day-group-title-based date-exact-text/date-partial-text —
  //     a genuinely confirmed date is more trustworthy than a proxy one.
  // Deliberately does NOT also try the note's createdDate/
  // createdInOriginalSystemDateTime, or the problem's own createdDateTime —
  // scoped to "chiefly recordDate and onsetDate" per Nick's explicit
  // steer, not every date field that exists.
  var VERIFIED_DATE_TOLERANCE_DAYS = FUZZY_DATE_TOLERANCE_DAYS;

  // Every candidate whose OWN clinicalCodeDescription text-matches
  // problem.description (exact or partial), regardless of date or
  // structural linkage. Each result also reports whether it's already
  // covered by a cheaper tier, so the caller can skip fetching verification
  // for candidates that don't need it.
  function findCodeTextMatches(problem, dayGroups, matchProblemByName) {
    if (!problem || !problem.id || typeof matchProblemByName !== 'function') return [];
    var candidates = extractJournalNoteCandidates(dayGroups);
    var out = [];

    candidates.forEach(function (c) {
      var match = matchProblemByName(problem.description, [{ id: c.entryId, description: c.clinicalCodeDescription }]);
      if (!match) return;
      var alreadyStructurallyLinked =
        c.entryLinkedProblemIds.indexOf(problem.id) !== -1 || c.wideLinkedProblemIds.indexOf(problem.id) !== -1;
      var alreadyDateMatched = !!(problem.recordDate && c.normalisedDate && c.normalisedDate === problem.recordDate);
      out.push({
        entryId: c.entryId,
        encounterId: c.encounterId,
        clinicalCodeDescription: c.clinicalCodeDescription,
        confidence: match.confidence,
        alreadyStructurallyLinked: alreadyStructurallyLinked,
        alreadyDateMatched: alreadyDateMatched,
      });
    });

    return out;
  }

  // candidate: one entry from findCodeTextMatches's output.
  // verifiedRecordDate: the note's OWN true recordDate ('YYYY-MM-DD' or
  // null/undefined), fetched by the CALLER from
  // GET /clinical/data/note/overview/{noteId} — this module never fetches.
  // Returns a match object ({entryId, encounterId, date,
  // clinicalCodeDescription, tier}) or null. Tries problem.recordDate first,
  // then problem.onsetDate — either falling within
  // VERIFIED_DATE_TOLERANCE_DAYS counts, per Nick's "match a combination of
  // these" ask.
  function resolveVerifiedDateMatch(problem, candidate, verifiedRecordDate) {
    if (!candidate || !verifiedRecordDate) return null;
    var recordDiff = daysBetween(verifiedRecordDate, problem && problem.recordDate);
    var onsetDiff = daysBetween(verifiedRecordDate, problem && problem.onsetDate);
    var withinTolerance =
      (recordDiff !== null && recordDiff <= VERIFIED_DATE_TOLERANCE_DAYS) ||
      (onsetDiff !== null && onsetDiff <= VERIFIED_DATE_TOLERANCE_DAYS);
    if (!withinTolerance) return null;
    return {
      entryId: candidate.entryId,
      encounterId: candidate.encounterId,
      date: verifiedRecordDate,
      clinicalCodeDescription: candidate.clinicalCodeDescription,
      tier: candidate.confidence === 'exact' ? 'verified-date-exact-text' : 'verified-date-partial-text',
    };
  }

  function sortJournalMatches(matches) {
    var out = (Array.isArray(matches) ? matches : []).slice();
    out.sort(function (a, b) {
      // dateConfirmed (see applyDateConfirmation) always sorts first,
      // ahead of tier ranking — a candidate whose OWN true recordDate
      // exactly matches the problem is the single most actionable signal
      // in a multi-match list, more so than which tier found it.
      var aConfirmed = a.dateConfirmed ? 0 : 1;
      var bConfirmed = b.dateConfirmed ? 0 : 1;
      if (aConfirmed !== bConfirmed) return aConfirmed - bConfirmed;
      var rankDiff = (TIER_RANK[a.tier] || 0) - (TIER_RANK[b.tier] || 0);
      if (rankDiff !== 0) return rankDiff;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0;
    });
    return out;
  }

  // MULTI-MATCH DISAMBIGUATION (added 2026-08-14, Nick's real test case): a
  // single problem can genuinely have several journal entries that all look
  // like matches — same text, same structural linkedProblems reference,
  // even the same consultation topic (confirmed live: an 8-year paediatric
  // surveillance history where 4 separate "Paediatric surveillance admin"
  // entries all carry the identical clinicalCodeDescription and are all
  // topic-linked to the same problem). The existing tiers (linked/date/
  // fuzzy) can't tell these apart — they're tied on every signal those
  // tiers look at. What DOES discriminate: each entry's own TRUE recordDate
  // (fetched via note/overview, not the day-group title — see this file's
  // top-of-file header on why the day-group title can't be trusted for
  // this). Confirmed live on the real case above: recordDate for the
  // correct entry (10 Jun 1994) matched the problem's recordDate AND
  // onsetDate (both 1994-06-10) EXACTLY, while the other 3 candidates' own
  // recordDates (1997-09-19, 1994-08-10, 1994-06-22) matched neither.
  // `created` was IDENTICAL across all 8 entries (a bulk-migration
  // timestamp, confirmed not clinically meaningful — see
  // FUZZY_DATE_TOLERANCE_DAYS's own comment on why this codebase already
  // treats a bare "created" timestamp with suspicion) so it's deliberately
  // NOT used here.
  //
  // Deliberately EXACT equality, not FUZZY_DATE_TOLERANCE_DAYS/
  // VERIFIED_DATE_TOLERANCE_DAYS's ±30-day window — those exist to rescue a
  // candidate that would otherwise be dropped entirely (a wide net is the
  // right call there). This is the opposite problem: picking ONE winner out
  // of several near-identical siblings that are ALL already included, where
  // a 30-day window would typically match multiple of them at once and
  // discriminate nothing (the 4 siblings here span 3+ years, but a busier
  // record could easily have several within 30 days of each other).
  //
  // problem: { id, recordDate, onsetDate }. matches: st.journalMatches-
  // shaped array. verifiedDatesByEntryId: {entryId: recordDate}, fetched by
  // the CALLER (this module never fetches) — typically only worth doing
  // when matches.length > 1, since a single match has nothing to
  // disambiguate against. Returns a NEW array (does not mutate `matches`),
  // each confirmed entry gaining `dateConfirmed: true` and
  // `confirmedDate: <the matching date>`, re-sorted via sortJournalMatches
  // so confirmed entries lead.
  function applyDateConfirmation(problem, matches, verifiedDatesByEntryId) {
    var list = Array.isArray(matches) ? matches : [];
    if (!problem) return sortJournalMatches(list);
    var dates = verifiedDatesByEntryId || {};
    var flagged = list.map(function (m) {
      var verified = dates[m.entryId];
      if (!verified) return m;
      var matchesRecordDate = problem.recordDate && daysBetween(verified, problem.recordDate) === 0;
      var matchesOnsetDate = problem.onsetDate && daysBetween(verified, problem.onsetDate) === 0;
      if (!matchesRecordDate && !matchesOnsetDate) return m;
      var confirmed = {};
      for (var k in m) confirmed[k] = m[k];
      confirmed.dateConfirmed = true;
      confirmed.confirmedDate = verified;
      return confirmed;
    });
    return sortJournalMatches(flagged);
  }

  // problem: { id, description, recordDate, onsetDate, additionalInformation } —
  // recordDate/onsetDate already 'YYYY-MM-DD' or null; onsetDate is only
  // used by resolveVerifiedDateMatch (see that function and the
  // VERIFIED_DATE_TOLERANCE_DAYS comment above), not by the day-group-title
  // based tiers this function computes itself — the day-group title has no
  // time-of-onset equivalent to compare onsetDate against. additionalInformation
  // only used by the fuzzy fallback (see file header), optional/nullable.
  // matchProblemByName is passed in explicitly (not read off a global) so
  // this module stays runnable standalone under plain require() — same
  // style shared/problem-text-linking.js itself uses for its inputs.
  //
  // Tiering, per candidate, in order (see file header for the Obesity-flood
  // reasoning behind why topic/encounter-level linkage is NOT a standalone
  // tier here):
  //   1. entryLinkedProblemIds includes problem.id -> 'linked'. A true
  //      per-entry structural fact — trusted alone, no text/date needed.
  //   2. else, compute a text match (matchProblemByName) regardless of date.
  //      If wideLinkedProblemIds (topic/encounter-level) includes
  //      problem.id AND text matches -> 'linked-exact-text' /
  //      'linked-partial-text' (date not required — the structural +
  //      textual signals corroborate each other independently of the
  //      day-group date field, which is known to sometimes disagree with a
  //      note's own recordDate — see docs/learnings-patient-journal-api.md).
  //   3. else (no structural link at all), require day-level date equality
  //      too, on top of the text match -> 'date-exact-text' /
  //      'date-partial-text' — the original "same code AND date" ask, for
  //      candidates with no structural corroboration to lean on.
  //   4. else no primary-tier match for this candidate. If NO candidate at
  //      all matched (results is still empty after all candidates are
  //      checked), the FUZZY FALLBACK runs — see file header — trying, per
  //      candidate within FUZZY_DATE_TOLERANCE_DAYS, first whether the
  //      problem's own code text is found in the candidate's `note`
  //      ('fuzzy-code-text-exact'/'fuzzy-code-text-partial'), then whether
  //      problem.additionalInformation is
  //      ('fuzzy-additional-info-exact'/'fuzzy-additional-info-partial').
  //      This is what drops the Obesity flood's 10 unrelated sibling entries
  //      (topic-linked, but neither their text nor date-plus-text condition
  //      is satisfied) while still giving a problem with genuinely zero
  //      primary-tier matches two more chances via different field pairs.
  function findJournalMatchesForProblem(problem, dayGroups, matchProblemByName) {
    if (!problem || !problem.id) return [];
    var candidates = extractJournalNoteCandidates(dayGroups);
    var results = [];

    candidates.forEach(function (c) {
      if (c.entryLinkedProblemIds.indexOf(problem.id) !== -1) {
        results.push({
          entryId: c.entryId,
          encounterId: c.encounterId,
          date: c.normalisedDate || c.rawDate,
          clinicalCodeDescription: c.clinicalCodeDescription,
          tier: 'linked',
        });
        return;
      }

      var match =
        typeof matchProblemByName === 'function'
          ? matchProblemByName(problem.description, [{ id: c.entryId, description: c.clinicalCodeDescription }])
          : null;

      var isWideLinked = c.wideLinkedProblemIds.indexOf(problem.id) !== -1;
      if (isWideLinked && match) {
        results.push({
          entryId: c.entryId,
          encounterId: c.encounterId,
          date: c.normalisedDate || c.rawDate,
          clinicalCodeDescription: c.clinicalCodeDescription,
          tier: match.confidence === 'exact' ? 'linked-exact-text' : 'linked-partial-text',
        });
        return;
      }

      if (!match || !problem.recordDate || !c.normalisedDate || c.normalisedDate !== problem.recordDate) return;

      results.push({
        entryId: c.entryId,
        encounterId: c.encounterId,
        date: c.normalisedDate || c.rawDate,
        clinicalCodeDescription: c.clinicalCodeDescription,
        tier: match.confidence === 'exact' ? 'date-exact-text' : 'date-partial-text',
      });
    });

    // FUZZY FALLBACK — see file header. Only when the primary pass found
    // nothing at all. Two field pairings tried per candidate, in order,
    // first match wins (a candidate is never counted under both).
    if (!results.length && typeof matchProblemByName === 'function') {
      candidates.forEach(function (c) {
        if (!c.note) return;
        var dayDiff = daysBetween(c.normalisedDate, problem.recordDate);
        if (dayDiff === null || dayDiff > FUZZY_DATE_TOLERANCE_DAYS) return;

        var codeTextMatch = matchProblemByName(problem.description, [{ id: c.entryId, description: c.note }]);
        if (codeTextMatch) {
          results.push({
            entryId: c.entryId,
            encounterId: c.encounterId,
            date: c.normalisedDate || c.rawDate,
            clinicalCodeDescription: c.clinicalCodeDescription,
            tier: codeTextMatch.confidence === 'exact' ? 'fuzzy-code-text-exact' : 'fuzzy-code-text-partial',
          });
          return;
        }

        if (!problem.additionalInformation) return;
        var infoMatch = matchProblemByName(problem.additionalInformation, [{ id: c.entryId, description: c.note }]);
        if (!infoMatch) return;
        results.push({
          entryId: c.entryId,
          encounterId: c.encounterId,
          date: c.normalisedDate || c.rawDate,
          clinicalCodeDescription: c.clinicalCodeDescription,
          tier: infoMatch.confidence === 'exact' ? 'fuzzy-additional-info-exact' : 'fuzzy-additional-info-partial',
        });
      });
    }

    return sortJournalMatches(results);
  }

  var api = {
    normaliseJournalDayTitle: normaliseJournalDayTitle,
    daysBetween: daysBetween,
    extractJournalNoteCandidates: extractJournalNoteCandidates,
    findJournalMatchesForProblem: findJournalMatchesForProblem,
    findCodeTextMatches: findCodeTextMatches,
    resolveVerifiedDateMatch: resolveVerifiedDateMatch,
    sortJournalMatches: sortJournalMatches,
    applyDateConfirmation: applyDateConfirmation,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined') {
    self.MSJournalProblemMatching = api;
  }
})();
