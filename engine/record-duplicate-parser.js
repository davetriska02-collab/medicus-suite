// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Per-patient record duplicate parser — feeds the duplicate-checker click-through.
//
// Takes the patient journal/timeline payload (day-grouped encounters, notes,
// prescriptions, investigations — the same shape as the Medicus care-record
// "journal" tab) and finds candidate duplicate entries, tiered by match
// confidence so the UI can offer bulk-remove vs merge accordingly.
//
// Evidence this is built from (2026-07-01 sample record review, cross-checked
// live against the real `clinical/data/patient-journal/overview/{patientId}`
// endpoint on 2026-07-02 — full findings in
// docs/learnings-patient-journal-api.md):
//  - The same clinical entry legitimately appears twice in the payload: once
//    as a flat top-level day item, once nested inside that day's encounter
//    (different entry IDs, same content) — NOT a data-quality bug, just the
//    API's own dual rendering. Grouping by (date, code, normalised text)
//    rather than by ID naturally treats these as one candidate group.
//  - `"Problem Info: Problem Notes: ...{Episodicity : code=..., displayName=...}"`
//    is a recurring GP2GP-reimport text wrapper (seen on an independent
//    "Pigmented naevus" problem AND a note, so treated as a confirmed
//    signature, not a one-off). NOT yet cross-checked against the live
//    endpoint (2026-07-02) — still resting on the original single sample.
//  - `consultationTopics[].title === "Data Transferred from other system"`
//    combined with a generic (non-treating) `responsiblePractitioner` marks
//    a migration/administrative encounter — but only ever tag such an
//    encounter's *content* as duplicate once matched against another entry;
//    the label alone is too small a sample (n=2 in the review) to trust as a
//    standalone deletion trigger. Also not yet cross-checked live.
//  - `linkedProblems` appears at THREE levels on a live encounter: the
//    encounter itself (`item.data.linkedProblems`, confirmed populated live),
//    each consultation topic (`topic.linkedProblems`), and each individual
//    heading entry (`entry.linkedProblems`) — all three are read and
//    deduplicated per-encounter by problem id (`dedupeProblemsPerEncounter`)
//    so the same linked problem referenced at multiple nesting levels isn't
//    counted as multiple duplicate occurrences.
//  - `document`/`fit-note` entries (live-confirmed 2026-07-04, docs/learnings-
//    duplicate-entry-timestamps.md) carry their real content — `title`,
//    `documentTypeLabel`, `documentDate`, `organisationName`,
//    `clinicalSpeciality`, `additionalInformation` — under `item.data` for
//    FLAT top-level items, or directly on the entry object for NESTED
//    entries (`entryType === 'document'`/`'fit-note'` inside
//    `consultationTopics[].headings[].entries[]`). `item.title`/
//    `item.descriptionText` (the fields the flat branch used before this
//    date) are confirmed always `null` — never a real signal.
//  - `item.id`/`entry.id` are **UUIDv7**: the leading 48 bits are a
//    millisecond Unix timestamp, decodable client-side (`decodeIdTimestamp`
//    below). Live-confirmed 2026-07-04 to match the previously-fetched
//    `createdDate` field to the second, and to cluster tightly around an
//    independently-confirmed real registration-completion event — so it's
//    used here as a free "which copy came first" signal, replacing the
//    per-entry API fetch the original design assumed would be needed.
//  - A document's `documentTypeLabel` can be genericised to "Other digital
//    signal" by a reimport, with the real type/author-org/custodian-org/
//    description serialised into `title` instead as a fixed-order,
//    optional-segment list (see `parseGenericDocumentTitle`). Live-confirmed
//    2026-07-04 across two patients: 165/168 sampled titles matched this
//    shape; the 3 exceptions (no `Type:` segment at all) were all 2WW/SPA-
//    referral-form documents, and a third patient had zero occurrences of
//    the generic label at all — this behaviour is real but not universal
//    across every patient/transfer history.
//
// Only problem/note/prescription/investigation-request/document entries are
// compared for duplicates in this first pass. Investigation *results* (lab
// values, item.type === 'investigation') are deliberately NOT flattened —
// live testing (2026-07-02, docs/learnings-duplicate-entry-timestamps.md)
// found a lab result that did NOT duplicate under the same reimport event
// that duplicated this patient's notes/prescriptions/documents, suggesting
// structured results may carry their own dedup key on ingestion. n=1, not
// confirmed as a general rule, but no evidence yet that this heuristic
// extends usefully to lab data. `future-action`, `communication`,
// `referral`, `observation`, `medication-statement-prescribed-elsewhere` are
// also unhandled — no duplicate evidence for any of them either way.

(function (global) {
  'use strict';

  const TIER = { EXACT: 'exact', HIGH: 'high', REVIEW: 'review' };

  const GP2GP_WRAPPER_RE = /^problem info:\s*problem notes:\s*/i;
  const EPISODICITY_SUFFIX_RE = /\s*\{episodicity\s*:[^}]*\}\s*$/i;
  const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function normCode(s) {
    return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  // Decodes the leading 48-bit millisecond timestamp from a UUIDv7 id.
  // Returns null for anything that isn't a well-formed UUIDv7 (defensive —
  // every id seen live so far has matched, but this is user-facing clinical
  // tooling, so a malformed/legacy id must degrade to "unknown", not throw
  // or produce a nonsense date).
  function decodeIdTimestamp(id) {
    if (typeof id !== 'string' || !UUIDV7_RE.test(id)) return null;
    const ms = parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    return Number.isFinite(ms) ? ms : null;
  }

  const GENERIC_DOCUMENT_LABEL = 'other digital signal';
  const TITLE_LABELS = ['Type', 'Author Org', 'Custodian Org', 'Description'];
  const TITLE_LABEL_RE = new RegExp(`\\b(${TITLE_LABELS.join('|')}):\\s*`, 'g');

  // When a document's real `documentTypeLabel` has been genericised to
  // "Other digital signal" by a reimport, Medicus serialises the real type
  // (plus author/custodian org and a description) into `title` instead, as
  // a fixed-order, optional-segment key/value list — e.g. "Type: Referral
  // letter Author Org: Kingston Hospital Custodian Org: Park Road Surgery
  // Description: Internal to Gastro". Live-confirmed 2026-07-04 across two
  // patients: 165/168 sampled titles matched this shape; the 3 exceptions
  // (no `Type:` segment at all) were all 2WW/SPA-referral-form documents —
  // see docs/learnings-duplicate-entry-timestamps.md. Returns {} for a
  // title that doesn't match this shape at all (e.g. a normal, non-generic
  // document's title, which is usually null anyway).
  function parseGenericDocumentTitle(title) {
    if (typeof title !== 'string') return {};
    const matches = [...title.matchAll(TITLE_LABEL_RE)];
    if (!matches.length) return {};
    const result = {};
    for (let i = 0; i < matches.length; i++) {
      const label = matches[i][1];
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : title.length;
      result[label] = title.slice(start, end).trim();
    }
    return result;
  }

  // Recovers the real document type for matching purposes when
  // `documentTypeLabel` has been genericised (see parseGenericDocumentTitle
  // above). Falls back to the literal label unchanged for every other
  // document, AND for the known 2WW/SPA-referral exception where no `Type:`
  // segment is recoverable — so those still group under the shared generic
  // label as before, rather than going unmatched.
  function resolveDocumentTypeLabel(documentTypeLabel, title) {
    if (normCode(documentTypeLabel) !== GENERIC_DOCUMENT_LABEL) return documentTypeLabel;
    const parsed = parseGenericDocumentTitle(title);
    return parsed.Type || documentTypeLabel;
  }

  // Normalises entry text for comparison: unifies line endings, strips the
  // GP2GP "Problem Info: Problem Notes: ... {Episodicity...}" wrapper, treats
  // null/empty as equivalent, collapses whitespace, lowercases.
  function normText(raw) {
    if (raw === null || raw === undefined) return '';
    let s = String(raw).replace(/\r\n/g, '\n');
    const beforeStrip = s;
    s = s.replace(GP2GP_WRAPPER_RE, '').replace(EPISODICITY_SUFFIX_RE, '');
    const wrapped = s !== beforeStrip;
    return { text: s.trim().replace(/\s+/g, ' ').toLowerCase(), wrapped };
  }

  // Loose signal that a text looks like it MIGHT be a GP2GP wrapper —
  // deliberately unanchored and whitespace-tolerant, unlike the strict
  // GP2GP_WRAPPER_RE/EPISODICITY_SUFFIX_RE above, which were built from a
  // single 2026-07-01 sample and never cross-checked live. Used only to spot
  // near-misses (see analyzeGp2gpWrapperCoverage) — text the strict regexes
  // SHOULD probably have stripped but didn't, e.g. because the wrapper
  // wasn't right at the start/end of the string, or used slightly different
  // spacing/casing than the one sample it was built from.
  const GP2GP_WRAPPER_CANDIDATE_RE = /problem\s*info\s*:|problem\s*notes\s*:|episodicity\s*:/i;

  // Diagnostic (2026-07-04): reports how often the strict wrapper regex
  // actually fires across a real patient's entries, plus any near-miss text
  // that looks wrapper-like but wasn't stripped — evidence for whether the
  // n=2-sample regex generalises or needs broadening. Not used by
  // grouping/tiering itself.
  function analyzeGp2gpWrapperCoverage(entries) {
    let strictMatches = 0;
    const nearMisses = [];
    for (const e of entries) {
      if (!e.rawText) continue;
      const { wrapped } = normText(e.rawText);
      if (wrapped) {
        strictMatches++;
        continue;
      }
      if (GP2GP_WRAPPER_CANDIDATE_RE.test(e.rawText)) {
        nearMisses.push({
          kind: e.kind,
          date: e.date,
          fromTransferEncounter: e.fromTransferEncounter,
          sample: e.rawText.slice(0, 160),
        });
      }
    }
    return { strictMatches, nearMisses };
  }

  function isTransferEncounter(encounterData) {
    return (encounterData.consultationTopics || []).some((ct) => ct.title === 'Data Transferred from other system');
  }

  // ── Flatten ───────────────────────────────────────────────────────────────
  // Walks a day-grouped journal payload into a flat list of comparable
  // entries plus a separate list of transfer/migration encounters.
  function flattenJournal(dayGroups) {
    const entries = [];
    const transferEncounters = [];

    function pushEntry(
      kind,
      id,
      code,
      text,
      recordedBy,
      recordedByOrganisation,
      date,
      encounterId,
      fromTransferEncounter
    ) {
      if (!code) return;
      entries.push({
        kind,
        id,
        code,
        rawText: text,
        recordedBy: recordedBy || null,
        recordedByOrganisation: recordedByOrganisation || null,
        date,
        encounterId: encounterId || null,
        fromTransferEncounter: !!fromTransferEncounter,
        idTime: decodeIdTimestamp(id),
      });
    }

    function pushProblem(problem, date, recordedBy, encounterId, fromTransferEncounter) {
      if (!problem || !problem.problemCodeDescription) return;
      pushEntry(
        'problem',
        problem.id,
        problem.problemCodeDescription,
        problem.problemCodeDescription,
        recordedBy,
        null,
        date,
        encounterId,
        fromTransferEncounter
      );
    }

    // linkedProblems can appear on the encounter itself, on each consultation
    // topic, AND on each individual heading entry — the same real-world
    // linked problem can be referenced at more than one of those levels
    // simultaneously. Collect once per encounter, deduped by problem id, so
    // a single linked problem doesn't get counted as several duplicate
    // occurrences just because the API surfaces it at multiple nesting
    // depths (see file header).
    function collectProblemsOnce(seenIds, list, out) {
      for (const p of list || []) {
        if (!p) continue;
        const key = p.id || p.problemCodeDescription;
        if (!key || seenIds.has(key)) continue;
        seenIds.add(key);
        out.push(p);
      }
    }

    for (const day of dayGroups || []) {
      const date = day.title || null;
      for (const item of day.items || []) {
        if (item.type === 'encounter') {
          const enc = item.data || {};
          const transfer = isTransferEncounter(enc);
          if (transfer) {
            transferEncounters.push({
              encounterId: item.id,
              date,
              responsiblePractitioner: enc.responsiblePractitioner || null,
              contentConfirmed: false, // filled in after grouping, see markTransferConfirmation()
            });
          }

          const seenProblemIds = new Set();
          const encounterProblems = [];
          collectProblemsOnce(seenProblemIds, enc.linkedProblems, encounterProblems);

          for (const topic of enc.consultationTopics || []) {
            collectProblemsOnce(seenProblemIds, topic.linkedProblems, encounterProblems);
            for (const heading of topic.headings || []) {
              for (const entry of heading.entries || []) {
                collectProblemsOnce(seenProblemIds, entry.linkedProblems, encounterProblems);
                if (entry.entryType === 'note') {
                  pushEntry(
                    'note',
                    entry.id,
                    entry.clinicalCodeDescription,
                    entry.note,
                    entry.recordedBy,
                    entry.recordedByOrganisation,
                    date,
                    item.id,
                    transfer
                  );
                } else if (entry.entryType === 'prescription') {
                  pushEntry(
                    'prescription',
                    entry.id,
                    entry.productName,
                    `${entry.productName || ''} ${entry.dosageText || ''} ${entry.issueQuantity || ''}`.trim(),
                    entry.recordedBy,
                    entry.recordedByOrganisation,
                    date,
                    item.id,
                    transfer
                  );
                } else if (entry.entryType === 'investigation-request') {
                  const label = (entry.investigationRequestItems || []).join(', ');
                  pushEntry(
                    'investigation-request',
                    entry.id,
                    label,
                    label,
                    entry.requestedBy,
                    null,
                    date,
                    item.id,
                    transfer
                  );
                } else if (entry.entryType === 'document' || entry.entryType === 'fit-note') {
                  pushEntry(
                    'document',
                    entry.id,
                    resolveDocumentTypeLabel(entry.documentTypeLabel, entry.title) || null,
                    `${entry.documentTypeLabel || ''} ${entry.title || ''} ${entry.documentDate || ''} ${entry.organisationName || ''} ${entry.additionalInformation || ''}`.trim(),
                    entry.documentAuthorDepartment,
                    entry.organisationName,
                    date,
                    item.id,
                    transfer
                  );
                }
              }
            }
          }

          for (const p of encounterProblems) pushProblem(p, date, enc.responsiblePractitioner, item.id, transfer);
        } else if (item.type === 'note') {
          const d = item.data || {};
          pushEntry(
            'note',
            d.id,
            d.clinicalCodeDescription,
            d.note,
            d.recordedBy,
            d.recordedByOrganisation,
            date,
            null,
            false
          );
          for (const p of d.linkedProblems || []) pushProblem(p, date, d.recordedBy, null, false);
        } else if (item.type === 'prescription') {
          const d = item.data || {};
          pushEntry(
            'prescription',
            d.id,
            d.productName,
            `${d.productName || ''} ${d.dosageText || ''} ${d.issueQuantity || ''}`.trim(),
            d.recordedBy,
            d.recordedByOrganisation,
            date,
            null,
            false
          );
          for (const p of d.linkedProblems || []) pushProblem(p, date, d.recordedBy, null, false);
        } else if (item.type === 'investigation-request') {
          const d = item.data || {};
          const label = (d.investigationRequestItems || []).join(', ');
          pushEntry('investigation-request', d.id, label, label, d.requestedBy, null, date, null, false);
        } else if (item.type === 'document') {
          // Live-confirmed 2026-07-04 (docs/learnings-duplicate-entry-timestamps.md):
          // `item.title`/`item.descriptionText` are always null — a flat
          // document's real content lives under `item.data`, in the same
          // shape a nested document/fit-note entry exposes directly (see
          // the `entry.entryType === 'document'` branch above).
          const d = item.data || {};
          pushEntry(
            'document',
            d.id || item.id,
            resolveDocumentTypeLabel(d.documentTypeLabel, d.title) || null,
            `${d.documentTypeLabel || ''} ${d.title || ''} ${d.documentDate || ''} ${d.organisationName || ''} ${d.additionalInformation || ''}`.trim(),
            d.documentAuthorDepartment,
            d.organisationName,
            date,
            null,
            false
          );
          for (const p of d.linkedProblems || []) pushProblem(p, date, null, null, false);
        }
        // 'investigation' (lab result) items are intentionally not flattened
        // here — see file header. Extend separately if lab-result dedup is
        // ever needed, with its own clinical review.
      }
    }
    return { entries, transferEncounters };
  }

  // ── Group + tier ──────────────────────────────────────────────────────────
  // Groups flattened entries by (kind, date, normalised code) and assigns a
  // confidence tier per candidate group.
  function groupAndTier(entries, suppressed) {
    const groups = new Map();
    for (const e of entries) {
      const key = `${e.kind}|${e.date}|${normCode(e.code)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    const result = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue;

      // Two mentions of the same code, same day, from the SAME single
      // consultation are not a GP2GP import duplicate — they're just one
      // consultation legitimately referencing something twice (e.g. across
      // two headings). Exclude only when EVERY member shares one identical,
      // non-null encounterId. A flat top-level item (encounterId null)
      // paired with an encounter-nested entry is NOT the same-consultation
      // case — that's the flat/nested dual-render pattern this parser is
      // built to catch (see file header) — so a shared null doesn't count.
      const encounterIds = new Set(members.map((m) => m.encounterId));
      if (encounterIds.size === 1 && members[0].encounterId) {
        // Diagnostic only (2026-07-04, investigating a live report of a
        // transfer-heavy patient's group count collapsing to zero): record
        // what this exclusion just suppressed so the UI/tests can tell
        // whether it's firing on genuine single-consultation repeats or on
        // transfer-encounter entries where a shared encounterId may not
        // reliably mean "one real consultation".
        if (suppressed) {
          const [kind, date] = key.split('|');
          suppressed.push({
            kind,
            date,
            code: members[0].code,
            count: members.length,
            encounterId: members[0].encounterId,
            allFromTransferEncounter: members.every((m) => m.fromTransferEncounter),
          });
        }
        continue;
      }

      const [kind, date] = key.split('|');
      const normed = members.map((m) => ({ m, ...normText(m.rawText) }));

      const distinctText = new Set(normed.map((n) => n.text));
      const anyWrapped = normed.some((n) => n.wrapped);
      const recordedBySet = new Set(members.map((m) => m.recordedBy || ''));
      const orgSet = new Set(members.map((m) => m.recordedByOrganisation || ''));

      let tier;
      if (distinctText.size === 1 && recordedBySet.size === 1) {
        tier = TIER.EXACT;
      } else if (distinctText.size === 1) {
        // Same normalised text, different recordedByOrganisation/entering-user
        // presentation (or the GP2GP wrapper was stripped to get the match).
        tier = TIER.HIGH;
      } else {
        tier = TIER.REVIEW;
      }

      // Keeper vs. reimport-artifact tie-breaker, from the UUIDv7 id
      // timestamp (see file header) rather than a second per-entry API
      // fetch. Only called when at least two members have a decodable id —
      // with fewer than that there's nothing to compare, so leave it
      // unresolved rather than guessing off a single data point.
      const withTime = members.filter((m) => m.idTime != null);
      let keeperEntryId = null;
      if (withTime.length >= 2) {
        keeperEntryId = withTime.reduce((a, b) => (a.idTime <= b.idTime ? a : b)).id;
      }

      result.push({
        kind,
        date,
        code: members[0].code,
        tier,
        gp2gpWrapper: anyWrapped,
        recordedByVaries: recordedBySet.size > 1,
        recordedByOrganisationVaries: orgSet.size > 1,
        keeperEntryId,
        entries: members.map((m) => ({ ...m, isKeeper: keeperEntryId != null && m.id === keeperEntryId })),
      });
    }
    return result;
  }

  // Cross-references transfer encounters against grouped candidates: an
  // encounter is "content confirmed" duplicate if any of its own entries
  // landed in an EXACT/HIGH tier group. Encounters with no confirmed content
  // match are surfaced separately for manual review rather than auto-tiered
  // (see file header caveat — n=2 sample, label alone isn't proof).
  function markTransferConfirmation(transferEncounters, groups) {
    const confirmedEncounterIds = new Set();
    for (const g of groups) {
      if (g.tier === TIER.REVIEW) continue;
      for (const e of g.entries) {
        if (e.encounterId) confirmedEncounterIds.add(e.encounterId);
      }
    }
    return transferEncounters.map((te) => ({
      ...te,
      contentConfirmed: confirmedEncounterIds.has(te.encounterId),
    }));
  }

  // ── Public entry point ────────────────────────────────────────────────────
  // Accepts either the raw array of day-groups, or a payload object with the
  // array under a common wrapper key. `patientJournalRecords` is the real,
  // live-confirmed key returned by
  // `clinical/data/patient-journal/overview/{patientId}` (2026-07-02); the
  // rest are defensive fallbacks kept from before that was confirmed.
  function extractDayGroups(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    return (
      payload.patientJournalRecords ||
      payload.journal ||
      payload.timeline ||
      payload.data?.journal ||
      payload.data?.timeline ||
      payload.entries ||
      payload.days ||
      []
    );
  }

  function analyzeJournal(payload) {
    const dayGroups = extractDayGroups(payload);
    const { entries, transferEncounters } = flattenJournal(dayGroups);
    const suppressedSameConsultation = [];
    const groups = groupAndTier(entries, suppressedSameConsultation);
    const confirmedTransfers = markTransferConfirmation(transferEncounters, groups);
    const gp2gpWrapperCoverage = analyzeGp2gpWrapperCoverage(entries);

    const byTier = { exact: 0, high: 0, review: 0 };
    for (const g of groups) byTier[g.tier]++;

    return {
      groups,
      transferEncounters: confirmedTransfers,
      suppressedSameConsultation,
      gp2gpWrapperCoverage,
      summary: {
        totalEntries: entries.length,
        totalCandidateGroups: groups.length,
        byTier,
        transferEncountersTotal: confirmedTransfers.length,
        transferEncountersConfirmed: confirmedTransfers.filter((t) => t.contentConfirmed).length,
        suppressedSameConsultationTotal: suppressedSameConsultation.length,
        suppressedSameConsultationFromTransfer: suppressedSameConsultation.filter((s) => s.allFromTransferEncounter)
          .length,
        gp2gpWrapperStrictMatches: gp2gpWrapperCoverage.strictMatches,
        gp2gpWrapperNearMisses: gp2gpWrapperCoverage.nearMisses.length,
      },
    };
  }

  const api = {
    TIER,
    analyzeJournal,
    flattenJournal,
    groupAndTier,
    normCode,
    normText,
    decodeIdTimestamp,
    parseGenericDocumentTitle,
    resolveDocumentTypeLabel,
    analyzeGp2gpWrapperCoverage,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.RecordDuplicateParser = api;
  }
})(typeof window !== 'undefined' ? window : global);
