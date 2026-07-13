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
  //
  // The null path MUST return the same {text, wrapped} shape as every other
  // path. It used to return a bare '' string — buildGroupRecord spreads this
  // result, and spreading a string contributes nothing, so a null-text
  // member got text:undefined while a junk-only member (e.g. a note whose
  // whole body is "{Episodicity : code=..., displayName=First}", which the
  // suffix regex correctly strips to '') got text:'' — undefined !== '' and
  // the pair mis-tiered REVIEW ("same code, different content") instead of
  // EXACT. Found live 2026-07-08 on a real GP2GP note pair (original
  // note:null vs reimport copy note:"{Episodicity...}").
  function normText(raw) {
    if (raw === null || raw === undefined) return { text: '', wrapped: false };
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

  // Case-preserving counterpart to normText's wrapper-stripping. normText
  // lowercases everything for grouping/tiering comparison — but the
  // REVIEW-tier comparison UI needs to show the wrapper text to a human
  // (dimmed/labelled "reimport wrapper"), so it must keep original casing.
  // Reuses the same confirmed regexes as normText.
  function splitWrapperText(raw) {
    const s = raw === null || raw === undefined ? '' : String(raw).replace(/\r\n/g, '\n');
    const prefixMatch = s.match(GP2GP_WRAPPER_RE);
    const afterPrefix = prefixMatch ? s.slice(prefixMatch[0].length) : s;
    const suffixMatch = afterPrefix.match(EPISODICITY_SUFFIX_RE);
    const content = suffixMatch ? afterPrefix.slice(0, suffixMatch.index) : afterPrefix;
    return {
      prefix: prefixMatch ? prefixMatch[0] : '',
      content,
      suffix: suffixMatch ? suffixMatch[0] : '',
    };
  }

  // Known "junk"/reimport-artifact authoring users — a recordedBy value that
  // indicates an entry was administratively created by a migration/transfer
  // process rather than a real clinician, so its copy of a duplicate pair is
  // more likely the reimport artifact than the genuine original. Evidence-
  // based, currently n=1 (the 2026-07-01 sample record) — expected to grow
  // via live testing, same convention as GP2GP_WRAPPER_RE's own history.
  // Exact (not substring) case-insensitive match, so a real clinician whose
  // name happens to contain part of this text is never misflagged.
  const JUNK_RECORDED_BY_PATTERNS = ['user previous practice'];

  function isJunkRecordedBy(recordedBy) {
    if (typeof recordedBy !== 'string' || !recordedBy.trim()) return false;
    return JUNK_RECORDED_BY_PATTERNS.includes(recordedBy.trim().toLowerCase());
  }

  // Whitespace-tokenized word diff (LCS-based), pure. Used by the REVIEW-
  // tier comparison view to highlight what actually differs between two
  // entries' text, instead of asking a human to spot it by eye. Returns an
  // ordered array of {op, text} segments — 'equal' present in both,
  // 'delete' only in `a`, 'insert' only in `b`. Not a general-purpose diff
  // library: whitespace is normalised to single spaces on re-join (the goal
  // is spotting content differences, not preserving exact formatting).
  function wordDiff(a, b) {
    const tokA = (a || '').split(/\s+/).filter(Boolean);
    const tokB = (b || '').split(/\s+/).filter(Boolean);
    const n = tokA.length;
    const m = tokB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = tokA[i] === tokB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const segments = [];
    function push(op, text) {
      const last = segments[segments.length - 1];
      if (last && last.op === op) {
        last.text += ' ' + text;
      } else {
        segments.push({ op, text });
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (tokA[i] === tokB[j]) {
        push('equal', tokA[i]);
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        push('delete', tokA[i]);
        i++;
      } else {
        push('insert', tokB[j]);
        j++;
      }
    }
    while (i < n) {
      push('delete', tokA[i]);
      i++;
    }
    while (j < m) {
      push('insert', tokB[j]);
      j++;
    }
    return segments;
  }

  // Suggests merged text for a REVIEW-tier group with genuine content
  // differences — a starting point for the human to edit, never applied
  // automatically (see buildNoteChangeRequest below for the one path that
  // DOES write automatically, and only after this text has been reviewed).
  // Picks a reference entry (first non-junk-user entry if one exists, since
  // the junk-user copy is more likely the reimport artifact, else entry 0),
  // strips its GP2GP wrapper, then folds in 'insert' segments from wordDiff
  // against the other entries that aren't already present in the growing
  // suggestion (avoids duplicating content already captured).
  function buildMergeSuggestion(group) {
    const entries = (group && group.entries) || [];
    if (!entries.length) return { suggestedText: '', sources: [] };

    const split = entries.map((e) => splitWrapperText(e.rawText || ''));
    const sources = entries.map((e, idx) => ({
      entryId: e.id,
      recordedBy: e.recordedBy || null,
      isJunkUser: isJunkRecordedBy(e.recordedBy),
      hadWrapper: !!(split[idx].prefix || split[idx].suffix),
    }));

    const foundRefIdx = entries.findIndex((e) => !isJunkRecordedBy(e.recordedBy));
    const referenceIdx = foundRefIdx >= 0 ? foundRefIdx : 0;
    let suggested = split[referenceIdx].content.trim();

    for (let idx = 0; idx < entries.length; idx++) {
      if (idx === referenceIdx) continue;
      const otherContent = split[idx].content.trim();
      const diff = wordDiff(suggested, otherContent);
      const additions = diff
        .filter((seg) => seg.op === 'insert')
        .map((seg) => seg.text)
        .filter((text) => !suggested.toLowerCase().includes(text.toLowerCase()));
      if (additions.length) suggested = `${suggested} ${additions.join(' ')}`.trim();
    }

    return { suggestedText: suggested, sources };
  }

  // Field-by-field comparison for document-kind REVIEW-tier groups.
  // Live evidence 2026-07-08 (test patient 1, real 07/12 May 2025 document
  // pairs): buildMergeSuggestion's word-diff-on-concatenated-blob approach
  // (rawText = documentTypeLabel+title+documentDate+organisationName+
  // additionalInformation) mostly just shows Title/Type as one
  // undifferentiated mass, because those two dominate the blob while the
  // rest usually already match — it never surfaces Record date/Created/
  // Filed at all, since those aren't part of rawText. A document's
  // differences are STRUCTURED metadata, not free text, so this compares
  // each field independently instead.
  //
  // Field paths below confirmed live 2026-07-08 against real
  // `clinical/data/document/modals/preview/{documentId}` payloads (the same
  // endpoint already fetched for the fileType/fileSize checks — no new
  // endpoint). Values are the RAW API strings (ISO dates, "YYYY-MM-DD
  // HH:MM:SS" datetimes) — deliberately NOT reformatted to match Medicus's
  // own display style, to avoid a second, purely-cosmetic guessed
  // transformation layered on an already substantial live-evidence-based
  // feature.
  //
  // Write path (confirmed live 2026-07-08 via DevTools capture — see
  // buildDocumentEditRequest below): POST clinical/document/edit-details can
  // write SOME of these fields back. Three tiers of row:
  // - `editKey` set — covered by the confirmed write contract; the caller
  //   can apply the picked value to the kept copy automatically.
  // - `systemManaged` set (Created/Filed/File type/File size) — absent from
  //   the edit-details model entirely, so read-only even in Medicus's own
  //   edit pane, AND (user product decision, 2026-07-08) deliberately
  //   display-only here: whichever copy is retained keeps its own creation
  //   date, filing date/user and file type/size for audit purposes, so
  //   these rows offer no pick at all — they exist purely as evidence of
  //   which copy is which.
  // - neither (Clinical specialty) — editable in Medicus's own pane (it's
  //   in the edit model) but never live-tested non-null in the confirmed
  //   POST, so it stays pickable-for-the-summary, manual-correction only.
  //
  // A document's clinicalSpecialty is a plain string on some payloads and
  // an OBJECT on others (live finding 2026-07-08: a document whose visible
  // specialty was "Dermatology" carried an object here, which rendered as
  // "[object Object]"). Display-only unwrap below — known text keys only;
  // an unrecognised object shape says so rather than guessing or
  // masquerading as "(none)".
  function specialtyText(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      const inner =
        v.description ||
        v.label ||
        v.name ||
        (v.value && (v.value.description || v.value.label || v.value.name)) ||
        null;
      if (typeof inner === 'string' && inner.trim()) return inner;
      return '(present — format not recognised; check in Medicus)';
    }
    return String(v);
  }

  const DOCUMENT_COMPARISON_FIELDS = [
    { label: 'Title', editKey: 'title', get: (p) => p.document && p.document.title },
    { label: 'Type', editKey: 'code', get: (p) => p.document && p.document.typeCode && p.document.typeCode.description },
    { label: 'Document date', editKey: 'documentDate', get: (p) => p.document && p.document.documentDate },
    { label: 'Author', editKey: 'authoredByOrganisation', get: (p) => p.document && p.document.authoredByText },
    { label: 'Clinical specialty', get: (p) => p.document && specialtyText(p.document.clinicalSpecialty) },
    { label: 'Record date', editKey: 'recordDate', get: (p) => p.document && p.document.recordDate },
    { label: 'Created', systemManaged: true, get: (p) => p.document && p.document.createdDate },
    {
      label: 'Filed',
      systemManaged: true,
      get: (p) =>
        p.document &&
        (p.document.filedBy ? `${p.document.filedDateTime || ''} by ${p.document.filedBy}` : p.document.filedDateTime),
    },
    { label: 'File type', systemManaged: true, get: (p) => p.fileType },
    { label: 'File size', systemManaged: true, get: (p) => p.fileSize },
  ];

  // previewByEntryId is caller-fetched: { [entryId]: rawPreviewResponse }.
  // A missing preview for an entry just shows as a blank value for that
  // entry's column, never guessed. Each row reports `differs` so the caller
  // can visually de-emphasise fields that already match.
  function buildDocumentFieldComparison(group, previewByEntryId) {
    const entries = (group && group.entries) || [];
    const rows = DOCUMENT_COMPARISON_FIELDS.map((field) => {
      const values = entries.map((e) => {
        const preview = previewByEntryId && previewByEntryId[e.id];
        const value = preview ? field.get(preview) : null;
        return { entryId: e.id, value: value || null };
      });
      const distinct = new Set(values.map((v) => v.value || ''));
      return {
        label: field.label,
        editKey: field.editKey || null,
        systemManaged: !!field.systemManaged,
        values,
        differs: distinct.size > 1,
      };
    });
    return { rows };
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
      fromTransferEncounter,
      extra
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
        ...(extra || null),
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
              // Sibling document/fit-note entries in the SAME heading as a
              // note entry (2026-07-13) — a heading is a flat mixed-type
              // array, and a "note" here is often a consultation summary
              // line rather than a genuine freestanding note, so it can sit
              // right alongside its own attached document (e.g. an
              // "Additional" heading with both a "Seen in pain clinic" note
              // line and a "Document: Attachment" line). Captured once per
              // heading, cheaply, from data already being walked below — no
              // new fetch. Used to disambiguate note matches whose
              // attachments actually differ even though the note text/
              // author render identically (see hasAttachedDocumentMismatch).
              const headingAttachedDocIds = (heading.entries || [])
                .filter((e) => e.entryType === 'document' || e.entryType === 'fit-note')
                .map((e) => e.id)
                .filter(Boolean);
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
                    transfer,
                    headingAttachedDocIds.length ? { attachedDocumentIds: headingAttachedDocIds } : undefined
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
                    transfer,
                    { issueQuantity: entry.issueQuantity || null }
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
                    transfer,
                    { title: entry.title || null }
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
            false,
            { issueQuantity: d.issueQuantity || null }
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
            false,
            { title: d.title || null }
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
  function groupAndTier(entries, suppressed, suppressedQuantityMismatch) {
    const groups = new Map();
    for (const e of entries) {
      const key = `${e.kind}|${e.date}|${normCode(e.code)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }

    const result = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue;

      const [kind, date] = key.split('|');

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

      // Same-day, same-product prescriptions with a DIFFERENT issueQuantity
      // are routinely two genuinely separate real issues (e.g. topping up an
      // acute PRN med), not a reimport duplicate — a reimport dual-render
      // would carry the same quantity. Live-confirmed 2026-07-05: two acute
      // Paracetamol issues, same product/dosage text, different quantity
      // (16 vs 24 tablet) and ~29 minutes apart in real issue time. Hard
      // exclusion (not just a tier downgrade) so this stops being review
      // noise at scale — tracked in suppressedQuantityMismatch for
      // transparency, same principle as the encounterId exclusion above.
      if (kind === 'prescription') {
        const quantities = new Set(members.map((m) => (m.issueQuantity || '').trim().toLowerCase()).filter(Boolean));
        if (quantities.size > 1) {
          if (suppressedQuantityMismatch) {
            suppressedQuantityMismatch.push({
              kind,
              date,
              code: members[0].code,
              count: members.length,
              quantities: [...quantities],
            });
          }
          continue;
        }
      }

      result.push(buildGroupRecord(kind, date, members));
    }
    return result;
  }

  // Tier/keeper computation for one group's members, factored out of
  // groupAndTier's loop so splitDocumentGroupsByFileType (below) can rebuild
  // a correct group record for each re-partitioned sub-group rather than
  // duplicating this logic. Grouping-level exclusions (same-consultation,
  // prescription quantity mismatch) happen before a member set reaches this
  // point — either in groupAndTier's initial pass or by construction in a
  // re-partition — so this function only ever computes tier/keeper for an
  // already-decided member set.
  function buildGroupRecord(kind, date, members) {
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

    // Document-kind matches are capped at REVIEW regardless of text
    // similarity. Live-confirmed 2026-07-05: two genuinely unrelated
    // questionnaire-response documents (Asthma Review vs Triage-Dizziness)
    // shared identical generic journal-payload metadata (documentTypeLabel
    // "Questionnaire (qualifier value)", same date, empty title) and
    // tiered EXACT despite being completely different clinical content —
    // the real distinguishing content lives below the journal payload
    // (title/additionalInformation are too often generic/empty to trust).
    // `document` was never in isRemovableKind() anyway, so this only
    // changes the displayed recommendation, not any write behaviour.
    if (kind === 'document' && tier !== TIER.REVIEW) {
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

    return {
      kind,
      date,
      code: members[0].code,
      tier,
      gp2gpWrapper: anyWrapped,
      recordedByVaries: recordedBySet.size > 1,
      recordedByOrganisationVaries: orgSet.size > 1,
      keeperEntryId,
      entries: members.map((m) => ({ ...m, isKeeper: keeperEntryId != null && m.id === keeperEntryId })),
    };
  }

  // Splits an over-merged document-kind group when >=2 members have known,
  // differing fileType and/or fileSize — evidence (2026-07-07, real
  // test-patient pair) that two genuinely unrelated documents sharing a
  // date and a resolved generic type label (e.g. both "Clinical letter") can
  // otherwise collapse into one candidate group, since the grouping key is
  // only (kind, date, code). fileType survives reimport uncorrupted (unlike
  // documentTypeLabel/title, which get genericised) — confirmed present,
  // top-level, on `clinical/data/document/modals/preview/{documentId}`, the
  // same call already fetched on-demand for the questionnaire-template
  // cross-check — so it's a reliable post-hoc disambiguator with no extra
  // endpoint needed. (An `attachment` wrapper — `attachment.fileRoute`/
  // `attachment.fileId`, see hasQuestionnaireTemplateMismatch below — was
  // first assumed questionnaire-response-specific, but a real payload
  // 2026-07-08 showed it on an ordinary inbound XML document too. On every
  // real payload checked the top-level `fileType`/`fileSize` siblings were
  // present alongside it, so reading them at the root stays correct.)
  //
  // fileType alone isn't enough: a same-day batch of several genuinely
  // different documents (e.g. 3-4 separate NHS 111 referral letters uploaded
  // together, all PDFs, all filed under the same received/record date) can
  // share BOTH fileType and the resolved generic code — evidence from the
  // user, 2026-07-07. fileSize reliably differs between them even when
  // fileType doesn't, so members are now bucketed on the composite
  // (fileType, fileSize) pair when both are known. **`fileSize` field name
  // and top-level position CONFIRMED live 2026-07-07** — real anonymised
  // payload from `clinical/data/document/modals/preview/{id}`:
  // `"fileType":"xml","fileSize":"10.44 KB","fileCanExport":true` sit as
  // direct siblings on the response root (alongside `fileId`/`fileName`),
  // exactly where `fileTypeByEntryId`/`fileSizeByEntryId` already read them.
  //
  // fileTypeByEntryId/fileSizeByEntryId are caller-fetched (never a blanket
  // practice-wide fetch — same principle as every other on-demand cross-
  // check). Members with no known fileType are never guessed into a sized
  // bucket — they fall into a shared "type unknown" bucket, dropped below if
  // it has fewer than 2 members (a candidate group needs >=2 to exist at
  // all, matching groupAndTier's own rule). Members with a known fileType
  // but unknown fileSize bucket together under `${fileType}::unknown-size`
  // — i.e. when size can't be confirmed, this degrades to grouping by type
  // alone for those members, never guessing a size match. Non-document
  // groups pass through unchanged.
  function splitDocumentGroupsByFileType(groups, fileTypeByEntryId, fileSizeByEntryId) {
    const result = [];
    let documentGroupsSplit = 0;
    for (const g of groups) {
      if (g.kind !== 'document') {
        result.push(g);
        continue;
      }
      const fileTypes = g.entries.map((e) => fileTypeByEntryId[e.id] || null);
      const fileSizes = g.entries.map((e) => {
        const raw = fileSizeByEntryId ? fileSizeByEntryId[e.id] : null;
        return raw === undefined || raw === null || raw === '' ? null : String(raw).trim();
      });
      const keys = fileTypes.map((ft, i) => (ft ? `${ft}::${fileSizes[i] || 'unknown-size'}` : null));
      const knownKeys = new Set(keys.filter(Boolean));
      if (knownKeys.size < 2) {
        result.push(g);
        continue;
      }
      documentGroupsSplit++;
      const buckets = new Map();
      g.entries.forEach((e, i) => {
        const key = keys[i];
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(e);
      });
      for (const members of buckets.values()) {
        if (members.length < 2) continue;
        result.push(buildGroupRecord(g.kind, g.date, members));
      }
    }
    return { groups: result, documentGroupsSplit };
  }

  // ── Cross-record file-match duplicate detection (2026-07-08) ───────────────
  // Real motivating case (test patient 5, live): documents duplicated across
  // DIFFERENT journal dates — the primary (kind, date, code) key can never
  // catch these, no matter how the code/date resolve, because the two
  // "copies" genuinely disagree on date. Two independent, zero-fetch signals
  // (title shape, id-timestamp) flag which documents are WORTH suspecting;
  // the actual match is confirmed by file size + type, the one thing that
  // can't be corrupted by a reimport relabelling pass — same composite key
  // splitDocumentGroupsByFileType already uses, applied the opposite way
  // (forming new groups across the whole document pool instead of splitting
  // one over-merged group apart).

  // A document whose real title has been genericised carries its actual
  // metadata as `Type:`/`Author Org:`/`Custodian Org:` segments (see
  // parseGenericDocumentTitle above) — but on some reimports the title also
  // carries a raw filename/GUID fragment BEFORE those segments, e.g.
  // "tiff: 1C60D211-3115-4EAE-B2C3-86C905926DCB.tiff - Type: Admin Letter
  // Author Org: …" (live example, 2026-07-08). That leading fragment is
  // itself evidence of a degraded import — a normal title has nothing
  // before its first recognised label. Reuses parseGenericDocumentTitle's
  // own TITLE_LABEL_RE so the two stay in lock-step by construction.
  function hasJunkTitlePrefix(title) {
    if (typeof title !== 'string') return false;
    const matches = [...title.matchAll(TITLE_LABEL_RE)];
    if (!matches.length) return false;
    return title.slice(0, matches[0].index).trim().length > 0;
  }

  // A document whose recorded creation time postdates its own filing time is
  // logically backwards — evidence a later reimport pass rewrote one
  // timestamp but not the other. Both fields are the "YYYY-MM-DD HH:MM:SS"
  // shape already confirmed on `clinical/data/document/modals/preview/{id}`
  // (`document.createdDate` / `document.filedDateTime`). No threshold: this
  // is a logical-ordering check, not a timing-proximity heuristic like
  // hasPrescriptionTimingMismatch, so any postdating counts. Returns false
  // (never guesses) unless BOTH values are present and parseable.
  function hasCreatedAfterFiled(createdDate, filedDateTime) {
    if (typeof createdDate !== 'string' || typeof filedDateTime !== 'string') return false;
    const created = Date.parse(createdDate.trim().replace(' ', 'T'));
    const filed = Date.parse(filedDateTime.trim().replace(' ', 'T'));
    if (!Number.isFinite(created) || !Number.isFinite(filed)) return false;
    return created > filed;
  }

  // Free, zero-fetch trigger for the opt-in cross-record file-match check
  // below (2026-07-08): live timing on a 63-document record showed the
  // ALWAYS-ON version added ~25s (54.5s -> 79.3s) to "Analyse current
  // patient" — user decision, confirmed the matching itself is accurate
  // (correctly found real duplicates years apart) but too slow to run
  // unconditionally, so it becomes an opt-in second pass instead, gated on
  // these two zero-cost signals: hasJunkTitlePrefix (title shape, already
  // in memory) and a creation timestamp shared with >=1 other document
  // within the same MINUTE (via the id-timestamp every entry already
  // carries — decodeIdTimestamp, the same signal the keeper tie-breaker
  // uses — so this needs no new data, only grouping what's already there).
  // Scoped to kind==='document' only; the caller decides what to do with a
  // non-empty result (show an opt-in banner), never runs the expensive
  // match itself.
  function findSuspiciousDocuments(documentEntries) {
    const entries = (documentEntries || []).filter((e) => e && e.idTime != null);
    const minuteBuckets = new Map();
    for (const e of entries) {
      const minute = Math.floor(e.idTime / 60000);
      if (!minuteBuckets.has(minute)) minuteBuckets.set(minute, []);
      minuteBuckets.get(minute).push(e);
    }
    const sharedMinuteIds = new Set();
    for (const bucket of minuteBuckets.values()) {
      if (bucket.length < 2) continue;
      for (const e of bucket) sharedMinuteIds.add(e.id);
    }

    const flagged = [];
    for (const e of documentEntries || []) {
      const titleJunkPrefix = hasJunkTitlePrefix(e.title);
      const sharedCreationMinute = sharedMinuteIds.has(e.id);
      if (titleJunkPrefix || sharedCreationMinute) {
        flagged.push({ id: e.id, titleJunkPrefix, sharedCreationMinute });
      }
    }
    return flagged;
  }

  // Matches document-kind entries ACROSS THE WHOLE RECORD by (fileType,
  // fileSize) — deliberately not scoped to any date window or existing
  // group, per explicit product decision (2026-07-08): the duplicate of a
  // suspicious-looking document can just as easily be a completely
  // unremarkable-looking copy elsewhere in the record, so the search has to
  // cover every document, not just a cluster. Entries with an unknown
  // fileType or fileSize are excluded from matching entirely — never guess
  // a match off incomplete data, same principle as every cross-check above.
  //
  // `existingGroups` lets a cluster that's ALREADY exactly one existing
  // group (same member-id-set) skip re-reporting; a cluster that's only
  // partially covered, or spans documents that landed in different existing
  // groups (or none), IS still reported — that's the whole value of this
  // pass, surfacing a cross-date link the primary pass structurally cannot
  // see. Tier is always REVIEW: same-size-same-type is strong evidence, not
  // proof of identical content, so it's never auto-removable-by-default —
  // same discipline as documentLinked groups.
  function findFileMatchedDuplicates(documentEntries, existingGroups, fileTypeByEntryId, fileSizeByEntryId, createdDateByEntryId, filedDateTimeByEntryId) {
    const buckets = new Map();
    for (const e of documentEntries || []) {
      const ft = fileTypeByEntryId ? fileTypeByEntryId[e.id] : null;
      const fs = fileSizeByEntryId ? fileSizeByEntryId[e.id] : null;
      if (!ft || !fs) continue;
      const key = `${ft}::${fs}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }

    const existingIdSets = (existingGroups || []).map((g) => new Set((g.entries || []).map((e) => e.id)));
    const isAlreadyOneExistingGroup = (ids) =>
      existingIdSets.some((set) => ids.length === set.size && ids.every((id) => set.has(id)));

    const groups = [];
    let clustersChecked = 0;
    for (const [key, members] of buckets) {
      if (members.length < 2) continue;
      clustersChecked++;
      const ids = members.map((m) => m.id);
      if (isAlreadyOneExistingGroup(ids)) continue;

      const [fileType, fileSize] = key.split('::');
      const dates = new Set(members.map((m) => m.date || ''));
      const date = dates.size === 1 ? members[0].date : `${dates.size} dates`;
      const recordedBySet = new Set(members.map((m) => m.recordedBy || ''));
      const orgSet = new Set(members.map((m) => m.recordedByOrganisation || ''));

      const withTime = members.filter((m) => m.idTime != null);
      let keeperEntryId = null;
      if (withTime.length >= 2) {
        keeperEntryId = withTime.reduce((a, b) => (a.idTime <= b.idTime ? a : b)).id;
      }

      groups.push({
        kind: 'document',
        date,
        code: `${fileType} · ${fileSize}`,
        tier: TIER.REVIEW,
        gp2gpWrapper: false,
        recordedByVaries: recordedBySet.size > 1,
        recordedByOrganisationVaries: orgSet.size > 1,
        keeperEntryId,
        fileMatched: true,
        entries: members.map((m) => ({
          ...m,
          isKeeper: keeperEntryId != null && m.id === keeperEntryId,
          titleJunkPrefix: hasJunkTitlePrefix(m.title),
          createdAfterFiled: hasCreatedAfterFiled(
            createdDateByEntryId ? createdDateByEntryId[m.id] : null,
            filedDateTimeByEntryId ? filedDateTimeByEntryId[m.id] : null
          ),
        })),
      });
    }
    return { groups, clustersChecked };
  }

  // ── Document-linked-entry matching (2026-07-07, corrected 2026-07-08) ─────
  // GP EPR 2 reimport can SPLIT a source document: the standalone document
  // survives (genericised type, unlinked) but its previously-embedded coded
  // entries (notes) also independently survive as FREESTANDING entries on
  // the same date, no longer nested under the document. Nothing is lost, but
  // the freestanding copies now duplicate the document's own content and
  // `groupAndTier()`'s (kind, date, code) key can't catch this on its own,
  // because the document's linked entries never entered the comparable-
  // entries pool at all.
  //
  // CORRECTED 2026-07-08 (real payloads, test patient 1, 07 May 2025 pair):
  // the first attempt at this (2026-07-07) guessed the data lived in a
  // `careRecordElements` field on the document PREVIEW response
  // (`clinical/data/document/modals/preview/{documentId}`) — wrong. The
  // real source is a completely separate endpoint,
  // `GET clinical/document/entries/{documentId}`, returning
  // `{entries: [{id, type, code, text, onClickUrl, isMarkedIncorrect, ...}]}`.
  // Confirmed live: an original document's entries call returned 2 real
  // note-type entries (`code: "Abstinent from drug misuse"`,
  // `text: "Abstinent from drug misuse: abstinent from cannabis"`); the SAME
  // call against its reimport-duplicate copy's documentId returned
  // `{"entries":[]}` — direct confirmation the duplicate copy has lost the
  // link entirely, consistent with the "broken out into freestanding
  // entries" theory.
  //  - No date field exists on these entries at all. Reuses the CALLER's
  //    already-known journal-entry `.date` for the document itself (the
  //    exact `day.title`-format string already confirmed correct throughout
  //    this tool) rather than fetching or guessing a per-entry date — no
  //    format-mismatch risk, unlike the original attempt.
  //  - `text` is `"{code}: {freetext}"` for note-type entries, confirmed
  //    against 3 real examples — `rawText` strips that prefix to recover
  //    what a real freestanding note's own `.note` field would contain.
  //  - Only `type === 'note'` entries are usable. `observation`-type entries
  //    (e.g. "Alcohol units consumed per week") have no `code` field and
  //    `observation` isn't in this tool's comparable-entries pool at all
  //    (see file header) — explicitly skipped, a known scope gap, not a bug.
  //  - **Keeper asymmetry, fixed**: unlike every other group in this tool,
  //    the two "copies" here are NOT interchangeable — the document-linked
  //    entry is the genuine original, still correctly attached to its
  //    source document, and must NEVER be offered for removal; only its
  //    freestanding duplicate should be. `findDocumentLinkedDuplicates`
  //    below forces the document-linked entry as keeper unconditionally,
  //    overriding the generic UUIDv7-timestamp tie-breaker (which treats all
  //    members symmetrically and could otherwise recommend removing the
  //    linked original). This also means removal here only ever targets an
  //    ordinary freestanding note — the SAME already-confirmed
  //    `patient/note/mark-incorrect-and-hidden` contract used everywhere
  //    else, not an untested id path — a meaningfully safer design than the
  //    first attempt.
  //  - Still not fully proven: the `text` prefix-stripping is inferred from
  //    3 consistent real examples, not exhaustively verified across every
  //    possible note shape — worth a sanity check on first live run.
  //
  // Deliberately kept OUT of groupAndTier()/analyzeJournal()'s own group
  // list — this is a separate detection layered on top by the caller (see
  // findDocumentLinkedDuplicates), not merged into the primary pipeline.

  // Converts one document's raw `clinical/document/entries/{documentId}`
  // response array into pseudo `note`-kind entries in the shape
  // flattenJournal() produces, so groupAndTier() can compare them against
  // real freestanding entries with no special-casing. `recordedBy`/
  // `recordedByOrganisation`/`encounterId` aren't present on this endpoint,
  // so left null (same safe-null handling groupAndTier already applies
  // elsewhere). `documentDate` is the caller's already-known journal-entry
  // date for this document (see file-header note above) — not fetched here.
  function flattenDocumentEntries(documentId, documentDate, entries) {
    const out = [];
    for (const entry of entries || []) {
      if (!entry || entry.type !== 'note' || !entry.code) continue;
      if (entry.isMarkedIncorrect) continue;
      const prefix = `${entry.code}: `;
      const rawText =
        typeof entry.text === 'string' && entry.text.startsWith(prefix)
          ? entry.text.slice(prefix.length)
          : entry.text || null;
      out.push({
        kind: 'note',
        id: entry.id,
        code: entry.code,
        rawText,
        recordedBy: null,
        recordedByOrganisation: null,
        date: documentDate || null,
        encounterId: null,
        fromTransferEncounter: false,
        idTime: decodeIdTimestamp(entry.id),
        fromDocumentLinkedElement: true,
        linkedDocumentId: documentId,
      });
    }
    return out;
  }

  // Finds candidate duplicate groups formed ONLY when a document's own
  // linked note (recovered via a per-document on-demand fetch, never a
  // blanket practice-wide fetch) matches a real freestanding entry already
  // in this patient's journal. `documentLinkedDataByDocumentId` is
  // caller-fetched: `{ [documentEntryId]: { documentDate, entries } }`
  // (`entries` being the raw array from `clinical/document/entries/{id}`).
  // Returns groups already tagged `documentLinked: true`, with the
  // document-linked entry FORCED as keeper (see file-header note — this is
  // the one place in the tool where the two "copies" aren't interchangeable)
  // regardless of what the generic UUIDv7 tie-breaker in buildGroupRecord
  // picked, plus `linkedEntriesGenerated` for transparency even when zero
  // groups result.
  function findDocumentLinkedDuplicates(entries, documentLinkedDataByDocumentId) {
    const pseudoEntries = [];
    for (const [documentId, data] of Object.entries(documentLinkedDataByDocumentId || {})) {
      if (!data) continue;
      pseudoEntries.push(...flattenDocumentEntries(documentId, data.documentDate, data.entries));
    }
    if (!pseudoEntries.length) return { groups: [], linkedEntriesGenerated: 0 };

    const merged = (entries || []).concat(pseudoEntries);
    const mergedGroups = groupAndTier(merged, [], []);
    const groups = mergedGroups
      .filter((g) => g.entries.some((e) => e.fromDocumentLinkedElement))
      .map((g) => {
        const linkedMember = g.entries.find((e) => e.fromDocumentLinkedElement);
        const keeperEntryId = linkedMember ? linkedMember.id : g.keeperEntryId;
        return {
          ...g,
          documentLinked: true,
          keeperEntryId,
          entries: g.entries.map((e) => ({ ...e, isKeeper: e.id === keeperEntryId })),
        };
      });
    return { groups, linkedEntriesGenerated: pseudoEntries.length };
  }

  // Orders candidate groups by where their members actually sit in the
  // journal, so the rendered list reads top-to-bottom in the journal's own
  // order (2026-07-08 user feedback: documentLinked groups, produced by a
  // separate pass and concatenated after the main group list, landed at the
  // very bottom instead of adjacent to the document tasks they relate to).
  // Pure position sort — no date-string parsing, so it inherits whatever
  // order the journal payload itself uses and can never mis-parse a date
  // format. A documentLinked pseudo-entry isn't itself in the journal entry
  // list, so it falls back to its source document's position
  // (linkedDocumentId) — exactly what places the group next to its document
  // task. A group takes its EARLIEST-positioned member. Groups with no
  // locatable member sort last; ties and unlocatables keep their original
  // relative order (stable).
  function sortGroupsByJournalOrder(groups, entries) {
    const pos = new Map();
    (entries || []).forEach((e, i) => {
      if (e && e.id != null && !pos.has(e.id)) pos.set(e.id, i);
    });
    const groupKey = (g) => {
      let k = Infinity;
      for (const e of (g && g.entries) || []) {
        let p = pos.get(e.id);
        if (p === undefined && e.linkedDocumentId != null) p = pos.get(e.linkedDocumentId);
        if (p !== undefined && p < k) k = p;
      }
      return k;
    };
    return (groups || [])
      .map((g, i) => ({ g, i, k: groupKey(g) }))
      .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k - b.k))
      .map((x) => x.g);
  }

  // ── On-demand cross-checks (pure decision logic; I/O lives in the caller) ──
  // Both functions below take data the caller has already fetched on-demand
  // (never during a practice-wide scan — one extra call per candidate group,
  // fetched by duplicate-checker.js only for groups that already look like a
  // syntactic candidate) and decide whether the group is CONFIRMED not a
  // duplicate despite matching on the journal payload's own fields.

  // Live-confirmed 2026-07-05: two genuinely unrelated questionnaire-response
  // documents (Asthma Review vs Triage-Dizziness) shared identical generic
  // journal metadata. `questionnaireTemplateName` — fetched from
  // tasks/data/document/xml/patient-questionnaire-response/document-preview/{fileId}
  // — is a cheap, reliable disambiguator for this document subtype. Returns
  // false (no exclusion) unless at least two members have a KNOWN template
  // name and they genuinely differ — never guesses off incomplete data.
  function hasQuestionnaireTemplateMismatch(group, templateNameByEntryId) {
    const names = (group.entries || [])
      .map((e) => templateNameByEntryId[e.id])
      .filter((n) => typeof n === 'string' && n.trim());
    if (names.length < 2) return false;
    return new Set(names.map((n) => n.trim().toLowerCase())).size > 1;
  }

  // Live-confirmed 2026-07-13: a `note`-kind group can tier EXACT purely on
  // generic consultation-summary text/author (e.g. "Mr Docman PCTI") while
  // each member's attached document (captured on the entry as
  // `attachedDocumentIds` by flattenJournal, see its own comment above) is
  // genuinely different — the same generic-boilerplate risk already
  // documented for `document`-kind matches, but the tool never looked at a
  // note's own attachment at all. `fileTypeByEntryId`/`fileSizeByEntryId`
  // here are keyed by the ATTACHED DOCUMENT's id, not the note's own id —
  // same maps and same composite-key shape splitDocumentGroupsByFileType
  // already uses, just a different key space (caller-fetched, on demand,
  // only for note groups that actually carry an attachment). A member with
  // no known attachment signature contributes nothing (conservative
  // pass-through, mirrors that function's own knownKeys.size < 2 rule) —
  // never guesses a mismatch off incomplete data. Returns false unless at
  // least two members have a KNOWN signature and they disagree.
  function hasAttachedDocumentMismatch(group, fileTypeByEntryId, fileSizeByEntryId) {
    const signatures = (group.entries || [])
      .map((e) => {
        const keys = (e.attachedDocumentIds || [])
          .map((id) => {
            const ft = fileTypeByEntryId[id];
            if (!ft) return null;
            const rawSize = fileSizeByEntryId ? fileSizeByEntryId[id] : null;
            const fs = rawSize === undefined || rawSize === null || rawSize === '' ? 'unknown-size' : String(rawSize).trim();
            return `${ft}::${fs}`;
          })
          .filter(Boolean)
          .sort();
        return keys.length ? keys.join('|') : null;
      })
      .filter(Boolean);
    if (signatures.length < 2) return false;
    return new Set(signatures).size > 1;
  }

  // Live-confirmed 2026-07-05: two acute Paracetamol issues, same product and
  // dosage text (so already past the issueQuantity exclusion in
  // groupAndTier), but issued ~29 real minutes apart
  // (clinical/data/prescription/overview/{id}'s createdDateTime) — genuinely
  // separate real issues, not a reimport dual-render. A true dual-render of
  // one event is near-instant, so a gap of a minute or more is treated as
  // confirmed-not-a-duplicate. Returns false (no exclusion) unless at least
  // two members have a KNOWN, parseable timestamp.
  function hasPrescriptionTimingMismatch(group, createdDateTimeByEntryId) {
    const times = (group.entries || [])
      .map((e) => createdDateTimeByEntryId[e.id])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => Date.parse(t.trim().replace(' ', 'T')))
      .filter((ms) => Number.isFinite(ms));
    if (times.length < 2) return false;
    return Math.max(...times) - Math.min(...times) >= 60000;
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

  // ── Removal write contracts ──────────────────────────────────────────────
  // Confirmed live (2026-07-04/05, one test patient per kind) via DevTools
  // network capture — see project memory / docs/learnings-patient-journal-api.md
  // for the discovery trail. Only the "Remove from record" (hidden) variant
  // is implemented, per the deliberate scoping decision: a duplicate left
  // merely "marked incorrect but visible" doesn't reduce visible duplication,
  // which is this project's actual goal.
  //
  // `communication` uses a bespoke `visibility`-enum-string payload (not this
  // generic `{reason, isConfirmedRemoval}` family) and isn't handled by
  // flattenJournal() above, so it has no entry here.
  // `investigation-request` has no confirmed write endpoint at all — not
  // removable via this tool yet.
  //
  // `document` — confirmed live 2026-07-08 — is the SAME family as the three
  // above: POST clinical/document/mark-incorrect-and-hidden with
  // `{reason, isConfirmedRemoval: true, inboundDocumentId}`. The only
  // difference is the id field name (`inboundDocumentId`, not `documentId`).
  // This is the "Remove from record" action, which removes the document
  // completely. (Discovery trail worth remembering: Medicus's separate
  // "mark as incorrect only" action — struck through but still VISIBLE —
  // posts to the near-identical `clinical/document/mark-incorrect`
  // (no `-and-hidden`, no `isConfirmedRemoval`); v3.169.0 wired THAT one by
  // mistake and only struck documents through. The `-and-hidden` suffix is
  // exactly what hides/removes, consistent across all four kinds.) The
  // strike-only endpoint is deliberately not wired — a visible
  // struck-through duplicate doesn't reduce visible duplication.
  const WRITE_CONTRACTS = {
    problem: {
      path: 'clinical/problem/mark-incorrect-and-hidden',
      idField: 'problemId',
    },
    note: {
      path: 'patient/note/mark-incorrect-and-hidden',
      idField: 'noteId',
    },
    prescription: {
      path: 'clinical/prescription/mark-incorrect-and-hidden',
      idField: 'prescriptionId',
    },
    document: {
      path: 'clinical/document/mark-incorrect-and-hidden',
      idField: 'inboundDocumentId',
    },
  };

  function isRemovableKind(kind) {
    return Object.prototype.hasOwnProperty.call(WRITE_CONTRACTS, kind);
  }

  // Builds the {url, method, body} for removing one entry. Returns null
  // (never throws) for anything not safe to send — an unremovable kind, a
  // missing entry id, or a blank reason — so callers can treat null as "not
  // ready to send" without wrapping every call in a try/catch. All four
  // confirmed contracts carry `isConfirmedRemoval: true`.
  function buildRemovalRequest(kind, apiBase, entryId, reason) {
    const contract = WRITE_CONTRACTS[kind];
    if (!contract || !apiBase || !entryId) return null;
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) return null;
    return {
      url: `${apiBase}/${contract.path}`,
      method: 'POST',
      body: { [contract.idField]: entryId, reason: trimmedReason, isConfirmedRemoval: true },
    };
  }

  // ── Note edit contract (REVIEW-tier automated merge, note-kind only) ──────
  // Confirmed live 2026-07-06, one test-patient note, via DevTools network
  // capture (same discovery method as every write contract above).
  // GET clinical/data/note/edit-note/{noteId} returns the note's full
  // current object; POST clinical/note/change-note is a FULL-REPLACE write
  // (not a patch) — confirmed the GET response's fields are a superset of
  // everything the POST needs, either a direct name match or via
  // linkedClinicalCase.defaultClinicalCaseId -> clinicalCaseId. Only note is
  // confirmed this way — problem/prescription/document would each need
  // their own equivalent discovery before automating a merge for them too,
  // same per-kind-verified discipline as the removal contracts above.
  function buildNoteEditUrl(apiBase, noteId) {
    if (!apiBase || !noteId) return null;
    return `${apiBase}/clinical/data/note/edit-note/${noteId}`;
  }

  // Resolves the note's recorded-by organisation into the confirmed posted
  // shape, best evidence first: the edit model's structured object → its
  // manual text → a caller-supplied name (from the UI's organisation
  // prompt — Medicus's own form demands one before it will save a
  // previous-practice note whose stored org is blank, so the user typing a
  // name here is exactly what they'd do in Medicus). Null identifiers are
  // the confirmed manual-entry shape, same as documents.
  function resolveNoteOrganisation(n, suppliedName) {
    const v = n && n.recordedByOrganisation;
    if (v && v.organisationName && String(v.organisationName).trim()) return v;
    const manual = n && typeof n.recordedByOrganisationManual === 'string' ? n.recordedByOrganisationManual.trim() : '';
    if (manual) {
      return { organisationName: manual, organisationIdentifierType: null, organisationIdentifierValue: null };
    }
    const supplied = typeof suppliedName === 'string' ? suppliedName.trim() : '';
    if (supplied) {
      return { organisationName: supplied, organisationIdentifierType: null, organisationIdentifierValue: null };
    }
    return null;
  }

  // Builds the POST clinical/note/change-note request from a note object
  // already fetched via buildNoteEditUrl.
  //
  // Round-trip for previous-practice notes CONFIRMED live 2026-07-08 (a
  // real "Patient de-registration / recordedAtAnotherOrganisation: true"
  // note, GET + successful POST captured): the POST body has exactly the
  // same 13 keys as the local-note capture from 2026-07-06 —
  // `recordedAtAnotherOrganisation` / `recordedByOrganisationManual` /
  // `organisationEntry` are GET-only and never posted; the organisation
  // posts as the structured {organisationName, organisationIdentifierType,
  // organisationIdentifierValue} object (null identifiers for a
  // manually-typed name). So the old blanket refusals on those two flags
  // are lifted. What remains refused (null, never guessed): a real linked
  // clinical case (still never live-tested non-null), blank merged text,
  // and a previous-practice note with NO organisation name available
  // anywhere — Medicus's own form refuses to save that state, so the
  // caller should prompt the user for a name and re-call with
  // `manualOrganisationName`.
  function buildNoteChangeRequest(apiBase, currentNoteObject, newText, manualOrganisationName) {
    const n = currentNoteObject;
    if (!apiBase || !n || typeof n !== 'object' || !n.noteId) return null;
    const clinicalCaseId = (n.linkedClinicalCase && n.linkedClinicalCase.defaultClinicalCaseId) || null;
    if (clinicalCaseId) return null;
    const trimmedText = (newText || '').trim();
    if (!trimmedText) return null;
    const org = resolveNoteOrganisation(n, manualOrganisationName);
    if (n.recordedAtAnotherOrganisation && !org) return null;

    return {
      url: `${apiBase}/clinical/note/change-note`,
      method: 'POST',
      body: {
        noteId: n.noteId,
        note: trimmedText,
        noteSNOMEDct: n.noteSNOMEDct || null,
        hiddenFromPatientFacingServices: !!n.hiddenFromPatientFacingServices,
        confidentialFromThirdParties: !!n.confidentialFromThirdParties,
        flagOnPatientBanner: !!n.flagOnPatientBanner,
        recordedByOrganisation: org,
        recordedByPractitioner: n.recordedByPractitioner ?? null,
        recordedByStaff: n.recordedByStaff ?? null,
        recordDate: n.recordDate ?? null,
        flags: Array.isArray(n.flags) ? n.flags : [],
        clinicalCaseId,
        linkedProblemIds: Array.isArray(n.linkedProblemIds) ? n.linkedProblemIds : [],
      },
    };
  }

  // ── Note overview (read-only field comparison, 2026-07-08) ────────────────
  // GET clinical/data/note/overview/{noteId} — confirmed live 2026-07-08 from
  // two real payloads (a GP2GP original + its reimport copy). Richer than the
  // journal payload: it carries linkedProblems, created,
  // createdInOriginalSystemDateTime. Used for a READ-ONLY side-by-side field
  // table on note-kind groups (no note-metadata write path is confirmed
  // beyond the change-note text contract above) and for the linked-problems
  // keeper safety warning — the reimport copy routinely LOSES the problem
  // linkage the original still has, so removing the wrong copy would lose it.
  function buildNoteOverviewUrl(apiBase, noteId) {
    if (!apiBase || !noteId) return null;
    return `${apiBase}/clinical/data/note/overview/${noteId}`;
  }

  function noteLinkedProblemsText(overview) {
    const lp = overview && Array.isArray(overview.linkedProblems) ? overview.linkedProblems : [];
    const parts = lp
      .map((p) => {
        if (!p || !p.problemCodeDescription) return null;
        return p.significance ? `${p.problemCodeDescription} (${p.significance})` : p.problemCodeDescription;
      })
      .filter(Boolean);
    return parts.length ? parts.join('; ') : null;
  }

  const NOTE_COMPARISON_FIELDS = [
    { label: 'Code', get: (o) => o.noteSNOMEDctCode && o.noteSNOMEDctCode.description },
    { label: 'Note text', get: (o) => o.note },
    { label: 'Record date', get: (o) => o.recordDate },
    { label: 'Recorded by', get: (o) => o.recordedBy },
    { label: 'Created', get: (o) => o.created },
    { label: 'Created in original system', get: (o) => o.createdInOriginalSystemDateTime },
    { label: 'Linked problems', get: (o) => noteLinkedProblemsText(o) },
    { label: 'Marked incorrect', get: (o) => (o.isMarkedAsIncorrect ? 'yes' : null) },
  ];

  // Same row shape as buildDocumentFieldComparison ({label, values, differs})
  // minus editKey/systemManaged — every note row is reference-only. A missing
  // overview for an entry shows blank values, never guessed.
  function buildNoteFieldComparison(group, overviewByEntryId) {
    const entries = (group && group.entries) || [];
    const rows = NOTE_COMPARISON_FIELDS.map((field) => {
      const values = entries.map((e) => {
        const overview = overviewByEntryId && overviewByEntryId[e.id];
        const value = overview ? field.get(overview) : null;
        return { entryId: e.id, value: value || null };
      });
      const distinct = new Set(values.map((v) => v.value || ''));
      return { label: field.label, values, differs: distinct.size > 1 };
    });
    return { rows };
  }

  // ── Document edit contract (document-kind field apply) ────────────────────
  // Confirmed live 2026-07-08, one test-patient document, via DevTools
  // network capture (same discovery method as the note edit contract above).
  // GET clinical/data/document/edit-details/{documentId} returns the edit
  // form's full prefill model; POST clinical/document/edit-details (the
  // documentId travels in the BODY, not the URL — the one write contract in
  // this tool shaped that way) is a FULL-REPLACE write. The confirmed POST
  // body is a projection of the GET model: `code` and `authoredByOrganisation`
  // post their `.value` objects, `linkedProblems` posts as `linkedProblemIds`,
  // `linkedClinicalCase.defaultClinicalCaseId` posts as `clinicalCaseId`, and
  // `modelVersionHash` is echoed back verbatim (the optimistic-concurrency
  // guard — a stale hash presumably rejects the write; never deliberately
  // tested). `manualAuthoredByOrganisation` /
  // `shouldEnterAuthoredByOrganisationManually` / `documentType` /
  // `patientId` / `versionId` exist only in the GET model and do NOT appear
  // in the confirmed POST body, so they are never sent.
  function buildDocumentEditDetailsUrl(apiBase, documentId) {
    if (!apiBase || !documentId) return null;
    return `${apiBase}/clinical/data/document/edit-details/${documentId}`;
  }

  // Resolves a document's authored-by organisation into the confirmed
  // posted shape, from the best available evidence, in order: the edit
  // model's structured value → its manually-typed organisation text →
  // the preview's displayed author text → the "Author Org:" segment the
  // GP2GP reimport flattens into the genericised title (the org data ISN'T
  // lost on import, just demoted from structured data to freetext inside
  // `title` — user observation, 2026-07-08; parseGenericDocumentTitle's
  // 'Author Org' segment is label-bounded, so it's clean of the trailing
  // date that contaminates the last segment). A name with NULL identifiers
  // is a confirmed-valid stored shape (the first real edit model captured
  // stored exactly {organisationName, null, null} for a manually-entered
  // org), and it's precisely what typing into the form's free-text
  // Organisation field produces — so the text fallbacks are data
  // improvement, not identifier fabrication. GP2GP-imported entries
  // routinely arrive with the (form-required) organisation entirely blank,
  // so refusing here would block the exact records this tool exists to fix
  // (user decision, 2026-07-08). Returns null only when no name exists
  // anywhere — the caller may then fall back to asking the user.
  function resolveDocumentOrganisation(editModel, preview) {
    const m = editModel || {};
    const v = m.authoredByOrganisation && m.authoredByOrganisation.value;
    if (v && v.organisationName && String(v.organisationName).trim()) return v;
    const asManualShape = (name) => ({
      organisationName: name,
      organisationIdentifierType: null,
      organisationIdentifierValue: null,
    });
    const manual = typeof m.manualAuthoredByOrganisation === 'string' ? m.manualAuthoredByOrganisation.trim() : '';
    if (manual) return asManualShape(manual);
    const doc = preview && preview.document;
    const displayed = doc && typeof doc.authoredByText === 'string' ? doc.authoredByText.trim() : '';
    if (displayed) return asManualShape(displayed);
    const titleAuthorOrg = doc ? (parseGenericDocumentTitle(doc.title)['Author Org'] || '').trim() : '';
    if (titleAuthorOrg) return asManualShape(titleAuthorOrg);
    return null;
  }

  // Reads one writable field's value out of a fetched edit-details model, in
  // ALREADY-POSTED shape (`.value` objects, ISO dates) — never from the
  // display-formatted preview payload ("07 May 2026" etc.), which is a
  // different encoding of the same fields. Returns undefined (as distinct
  // from null, a legitimate stored value for title) for an unknown editKey
  // or a missing model, so callers can tell "can't read" from "stored null".
  function getDocumentEditValue(editModel, editKey) {
    const m = editModel;
    if (!m || typeof m !== 'object') return undefined;
    switch (editKey) {
      case 'title':
        return m.title ?? null;
      case 'code':
        return (m.code && m.code.value) || null;
      case 'documentDate':
        return m.documentDate ?? null;
      case 'recordDate':
        return m.recordDate ?? null;
      case 'authoredByOrganisation':
        return (m.authoredByOrganisation && m.authoredByOrganisation.value) || null;
      default:
        return undefined;
    }
  }

  // Turns the user's per-field picks ({editKey, entryId} for every
  // comparison row where they chose a NON-keeper copy's value) into the
  // override map buildDocumentEditRequest takes, reading each picked value
  // from that copy's own fetched edit model. Anything that can't be read
  // safely lands in `unapplied` with a reason instead of being guessed:
  // a row with no write mapping ('not-writable'), a copy whose edit model
  // wasn't fetched ('no-edit-model'), or a structured value missing on the
  // source copy ('source-value-missing' — only `title` may legitimately be
  // null). Picking the Author also carries the source copy's
  // authorOrganisationOption, since the two travel together in the form.
  //
  // Why read the edit model at all when the comparison table already shows
  // the values? Because the table shows the PREVIEW's display encodings
  // (type/author as plain description strings, documentDate as
  // "07 May 2026"), while the POST needs the structured identifiers behind
  // them ({conceptId, descriptionId} for the code, organisation identifier
  // fields for the author) — writing the display string alone would mean
  // FABRICATING clinical-code/organisation identifiers. A reimport copy's
  // edit model can genuinely hold nulls here (unresolved/degraded code,
  // manually-typed organisation) even though its preview displays fine —
  // that copy's field simply has no writable structured value.
  //
  // Confirmed-shape fallbacks (optional previewByEntryId param, 2026-07-08,
  // after exactly these null-on-the-source-copy cases live):
  // - code: preview `document.typeCode` carries the exact {conceptId,
  //   description, descriptionId} the POST needs (confirmed on every real
  //   payload seen).
  // - recordDate: preview `document.recordDate` is already ISO
  //   (confirmed), and buildDocumentEditRequest's ISO check still guards a
  //   surprise format downstream.
  // - authoredByOrganisation: resolveDocumentOrganisation below — a name
  //   with null identifiers is a confirmed-valid stored shape, so the
  //   manual-text / displayed-author fallbacks are data improvement, not
  //   fabrication.
  // documentDate (display-formatted in the preview) gets NO fallback —
  // refusing is the only non-guessing option for it.
  function buildDocumentEditOverrides(fieldChoices, editModelsByEntryId, previewByEntryId) {
    const overrides = {};
    const unapplied = [];
    for (const choice of fieldChoices || []) {
      const editKey = (choice && choice.editKey) || null;
      const m = choice && editModelsByEntryId ? editModelsByEntryId[choice.entryId] : null;
      const value = getDocumentEditValue(m, editKey);
      if (value === undefined) {
        unapplied.push({ editKey, reason: m ? 'not-writable' : 'no-edit-model' });
        continue;
      }
      if (value === null && editKey !== 'title') {
        const preview = choice && previewByEntryId ? previewByEntryId[choice.entryId] : null;
        if (editKey === 'code') {
          const tc = preview && preview.document && preview.document.typeCode;
          if (tc && tc.conceptId && tc.description && tc.descriptionId) {
            overrides.code = { conceptId: tc.conceptId, description: tc.description, descriptionId: tc.descriptionId };
            continue;
          }
        }
        if (editKey === 'recordDate') {
          const rd = preview && preview.document && preview.document.recordDate;
          if (rd) {
            overrides.recordDate = rd;
            continue;
          }
        }
        if (editKey === 'authoredByOrganisation') {
          const org = resolveDocumentOrganisation(m, preview);
          if (org) {
            overrides.authoredByOrganisation = org;
            overrides.authorOrganisationOption = m.authorOrganisationOption != null ? m.authorOrganisationOption : 'other';
            continue;
          }
        }
        unapplied.push({ editKey, reason: 'source-value-missing' });
        continue;
      }
      overrides[editKey] = value;
      if (editKey === 'authoredByOrganisation' && m.authorOrganisationOption != null) {
        overrides.authorOrganisationOption = m.authorOrganisationOption;
      }
    }
    return { overrides, unapplied };
  }

  const DOCUMENT_EDIT_OVERRIDE_KEYS = [
    'title',
    'code',
    'documentDate',
    'recordDate',
    'authoredByOrganisation',
    'authorOrganisationOption',
  ];
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Builds the POST clinical/document/edit-details request from a fetched
  // edit-details model plus optional per-field overrides (posted-shape
  // values, normally from buildDocumentEditOverrides). Refuses (returns
  // null) rather than guessing on every condition never live-tested with a
  // non-null/non-empty value: authoredByDepartment, authoredByPractitioner,
  // clinicalSpecialty, selectedStaff, linkedProblems, and a real linked
  // clinical case — each exists in the GET model but has only ever been
  // seen null/empty in the confirmed POST body, so their round-trip
  // encoding is unknown. Also refuses drafts, already-marked-incorrect
  // documents, a missing modelVersionHash (the concurrency guard must be
  // echoed, never fabricated), any override key outside the confirmed set,
  // and any effective value that doesn't match its confirmed shape.
  // Callers should fall back to manual-correction guidance on null.
  function buildDocumentEditRequest(apiBase, editModel, overrides) {
    const m = editModel;
    const o = overrides || {};
    const has = (key) => Object.prototype.hasOwnProperty.call(o, key);
    if (!apiBase || !m || typeof m !== 'object' || !m.documentId) return null;
    if (!m.modelVersionHash) return null;
    if (m.isDraft || m.isMarkedIncorrect) return null;
    if (m.authoredByDepartment != null) return null;
    if (m.authoredByPractitioner != null) return null;
    if (m.clinicalSpecialty != null) return null;
    if (Array.isArray(m.selectedStaff) && m.selectedStaff.length) return null;
    if (Array.isArray(m.linkedProblems) && m.linkedProblems.length) return null;
    if (m.linkedClinicalCase && m.linkedClinicalCase.defaultClinicalCaseId) return null;
    for (const key of Object.keys(o)) {
      if (!DOCUMENT_EDIT_OVERRIDE_KEYS.includes(key)) return null;
    }

    const code = has('code') ? o.code : (m.code && m.code.value) || null;
    if (!code || !code.conceptId || !code.description || !code.descriptionId) return null;
    // The kept copy's own organisation resolves through the same evidence
    // chain (structured value → manual text; no preview here — pass an
    // explicit override to use displayed-author evidence). GP2GP entries
    // routinely store a blank org, and a blank keeper org must not block an
    // edit to some other field.
    const org = has('authoredByOrganisation') ? o.authoredByOrganisation : resolveDocumentOrganisation(m, null);
    if (!org || !org.organisationName || !String(org.organisationName).trim()) return null;
    const documentDate = has('documentDate') ? o.documentDate : m.documentDate;
    const recordDate = has('recordDate') ? o.recordDate : m.recordDate;
    if (!ISO_DATE_RE.test(documentDate || '') || !ISO_DATE_RE.test(recordDate || '')) return null;
    const authorOrganisationOption =
      (has('authorOrganisationOption') ? o.authorOrganisationOption : m.authorOrganisationOption) || null;
    if (!authorOrganisationOption) return null;
    const title = has('title') ? o.title : (m.title ?? null);
    if (title != null && typeof title !== 'string') return null;

    return {
      url: `${apiBase}/clinical/document/edit-details`,
      method: 'POST',
      body: {
        documentId: m.documentId,
        code: { conceptId: code.conceptId, description: code.description, descriptionId: code.descriptionId },
        documentDate,
        authoredByDepartment: null,
        authoredByPractitioner: null,
        clinicalSpecialty: null,
        authoredByOrganisation: {
          organisationName: org.organisationName,
          organisationIdentifierType: org.organisationIdentifierType ?? null,
          organisationIdentifierValue: org.organisationIdentifierValue ?? null,
        },
        hiddenFromPatientFacingServices: !!m.hiddenFromPatientFacingServices,
        confidentialFromThirdParties: !!m.confidentialFromThirdParties,
        title,
        additionalInformation: m.additionalInformation ?? null,
        recordDate,
        authorOrganisationOption,
        selectedStaff: [],
        linkedProblemIds: [],
        clinicalCaseId: null,
        modelVersionHash: m.modelVersionHash,
      },
    };
  }

  // ── External links (2026-07-08) ────────────────────────────────────────────
  // Confirmed live via DevTools capture: clicking a document in Medicus's own
  // UI opens an in-page MODAL, not a navigable page — every call in that
  // sequence sits under `.../modals/...` and returns JSON. There is no
  // document-specific browser URL. Two links ARE confirmed real, navigable
  // targets:

  // The care-record journal page is a genuine UI route, distinct from the
  // `.../data/...` API family every other function in this file targets.
  // Its hostname differs from the API hostname only by moving the site code
  // from subdomain to the first path segment — e.g.
  // https://e38a9f.api.england.medicus.health -> https://england.medicus.health/e38a9f/...
  // Every apiBase in duplicate-checker.js is constructed as the fixed
  // `https://{code}.api.england.medicus.health` shape, so this regex matches
  // exactly that and REFUSES (null) rather than guessing if apiBase doesn't
  // match — same discipline as every write contract above.
  const API_BASE_RE = /^https:\/\/([a-z0-9]+)\.api\.(england\.medicus\.health)$/i;

  function buildCareRecordJournalUrl(apiBase, patientId) {
    const m = typeof apiBase === 'string' ? apiBase.match(API_BASE_RE) : null;
    if (!m || !patientId) return null;
    const [, code, domain] = m;
    return `https://${domain}/${code}/patient/patient/care-record/${patientId}?careRecordTab=journal`;
  }

  // Confirmed live 2026-07-08: GET clinical/document/download-file/{fileId}
  // ?convertToPDF=0 downloads the document's ORIGINAL file, unconverted —
  // the same bytes this tool's fileType/fileSize matching already compares.
  // Takes `fileId` (the document preview's own top-level `fileId` field —
  // see DOCUMENT_COMPARISON_FIELDS above), deliberately NOT documentId,
  // confirmed as a distinct id in the real capture. `convertToPDF=1` for a
  // PDF conversion is a highly plausible but UNCONFIRMED inference from the
  // parameter name and Medicus's own "Export as PDF" menu option — not
  // offered here without a direct capture of that variant.
  function buildDocumentDownloadUrl(apiBase, fileId) {
    if (!apiBase || !fileId) return null;
    return `${apiBase}/clinical/document/download-file/${fileId}?convertToPDF=0`;
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
    const suppressedQuantityMismatch = [];
    const groups = groupAndTier(entries, suppressedSameConsultation, suppressedQuantityMismatch);
    const confirmedTransfers = markTransferConfirmation(transferEncounters, groups);
    const gp2gpWrapperCoverage = analyzeGp2gpWrapperCoverage(entries);
    // Zero-fetch trigger for the opt-in cross-record file-match second pass
    // (see findSuspiciousDocuments' own header comment) — computed here,
    // always, since it costs nothing; the expensive match itself is opt-in.
    const suspiciousDocuments = findSuspiciousDocuments(entries.filter((e) => e.kind === 'document'));

    const byTier = { exact: 0, high: 0, review: 0 };
    for (const g of groups) byTier[g.tier]++;

    return {
      groups,
      entries,
      transferEncounters: confirmedTransfers,
      suppressedSameConsultation,
      suppressedQuantityMismatch,
      gp2gpWrapperCoverage,
      suspiciousDocuments,
      summary: {
        totalEntries: entries.length,
        totalCandidateGroups: groups.length,
        byTier,
        transferEncountersTotal: confirmedTransfers.length,
        transferEncountersConfirmed: confirmedTransfers.filter((t) => t.contentConfirmed).length,
        suppressedSameConsultationTotal: suppressedSameConsultation.length,
        suppressedSameConsultationFromTransfer: suppressedSameConsultation.filter((s) => s.allFromTransferEncounter)
          .length,
        suppressedQuantityMismatchTotal: suppressedQuantityMismatch.length,
        gp2gpWrapperStrictMatches: gp2gpWrapperCoverage.strictMatches,
        gp2gpWrapperNearMisses: gp2gpWrapperCoverage.nearMisses.length,
        suspiciousDocumentsTotal: suspiciousDocuments.length,
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
    flattenDocumentEntries,
    findDocumentLinkedDuplicates,
    sortGroupsByJournalOrder,
    hasQuestionnaireTemplateMismatch,
    hasPrescriptionTimingMismatch,
    hasAttachedDocumentMismatch,
    isRemovableKind,
    buildRemovalRequest,
    splitWrapperText,
    isJunkRecordedBy,
    wordDiff,
    buildMergeSuggestion,
    buildDocumentFieldComparison,
    buildNoteEditUrl,
    buildNoteChangeRequest,
    resolveNoteOrganisation,
    buildNoteOverviewUrl,
    buildNoteFieldComparison,
    buildDocumentEditDetailsUrl,
    getDocumentEditValue,
    resolveDocumentOrganisation,
    buildDocumentEditOverrides,
    buildDocumentEditRequest,
    splitDocumentGroupsByFileType,
    hasJunkTitlePrefix,
    hasCreatedAfterFiled,
    findSuspiciousDocuments,
    findFileMatchedDuplicates,
    buildCareRecordJournalUrl,
    buildDocumentDownloadUrl,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.RecordDuplicateParser = api;
  }
})(typeof window !== 'undefined' ? window : global);
