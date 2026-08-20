// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Inline "Save attachment as document" widget for triage task pages.
//
// A triage request can arrive with a patient-submitted photo/document attached
// (content-scripts/triage-lens/content.js's extractInitialRequest() detects
// these and exposes them as window.__msTriageAttachments — see that file for
// the extraction). Today the only way to get one of those files onto the
// patient's record as a proper clinical document is Medicus's own manual
// "Add document" upload. This widget drives Medicus's OWN create-document
// endpoint directly with a credentialed same-origin fetch — the identical
// proven pattern task-inline.js/booking-inline.js already use:
//
//   GET  /clinical/data/document/forms/create-inbound-document-form/{patientId}
//        → { reviewerOptions:{teams[],staff[]}, selectedReviewerAssignee,
//            recordDate, staff[], linkableProblems[], localOrganisationName }
//   POST /clinical/document/create
//        multipart/form-data: { file: <bytes>, formPayload: <JSON string> }
//        → { documentId }
//
// Confirmed via live captures (scripts/document-create-capture.js) —
// see docs/learnings-triage-attachment-to-document.md for the full contract,
// including what's still NOT confirmed.
//
// SCOPE: the create call's `documentType` is a SNOMED-coded {conceptId,
// description, descriptionId} object. Medicus's own live search-as-you-type
// (`clinical/gb/snomed/search/description/constrained?constrainingRefsets=
// 1127551000000109`) was itself captured 2026-07-20 (docs/learnings-
// triage-attachment-to-document.md §9) and its response shape confirmed —
// {results:[{label, value:{description, conceptId, descriptionId}}]}, no
// hierarchy/parent data at all. The FULL active picklist behind that refset
// (1768 entries, June 2026 SNOMED CT UK Clinical Extension export, inactive
// members excluded) is bundled as rules/document-types.json and searched
// client-side here — never a live call to Medicus's own search endpoint (its
// query contract, e.g. debounce/paging, was never captured, and it isn't
// needed: the full picklist is small enough to search in memory). Each entry
// carries a `docPriority` 1-6 usefulness score (1 = most useful, 6 = never
// shown/junk) the practice scored against the full refset — used as a SOFT
// ranking + colour signal (green 1 → red 6) on search results, not a hard
// filter or fixed shortlist. That scoring was built with INBOUND documents in
// mind, not task attachments, so treating it as advisory rather than
// authoritative here was a deliberate call (2026-07-23) — an earlier cut of
// this widget offered a curated priority-tier chip shortlist ahead of search;
// live-tested and pulled in favour of this softer sort+colour approach once
// the priority data's inbound-document framing turned out not to map cleanly
// onto which document types matter for a task attachment. The
// extension-based guess (documentTypeForFilename below) still PRE-SELECTS a
// default — image → "Medical photograph", pdf/doc → "Patient/Carer
// Correspondence" — but the clinician can always override it via search
// before saving; nothing is filed without an explicit documentType being
// set. Ancestor/parent-concept filtering was investigated and ruled out —
// Medicus does not store a parentConceptIds-style hierarchy for Document
// entities (confirmed via two HAR-file captures, see §9) — so there is no
// hierarchy to prune the picklist by.
//
// UI: rather than one collapsed toggle bar anchored somewhere on the task
// page, a small "Save as document" chip is injected immediately after EACH
// eligible attachment's own link/button (see the "DOM injection" section
// below) — with several attachments in one request, each gets its own
// unambiguous entry point right next to the file it's for. Clicking a chip
// opens ONE shared form (there is only ever one on the page) and relocates
// it to sit right after that chip; clicking a different attachment's chip
// moves the same form there and re-populates it, rather than opening a
// second form (see the "one shared form" design decision, 2026-07-23 — the
// alternative, an independent form per attachment, was considered and
// deferred as a bigger change for little benefit). A chip already saved this
// page visit shows "✓ Saved as document" and is disabled.
//
// ALREADY-SAVED CROSS-CHECK (2026-08-19 request, matching logic corrected
// same day after live testing): a triage request is routinely worked across
// multiple computers by multiple people, so the per-visit "saved this
// visit" state above can't be the whole story — it's blind to a save made
// by a DIFFERENT clinician, on a DIFFERENT machine, or via Medicus's own
// native document upload. ensureSavedDocumentCheck cross-references the
// patient's journal (the same bulk GET /clinical/data/patient-journal/
// overview/{patientId} endpoint the duplicate-checker and journal-code-sync
// already use) for a document entry within a ±2-day window of the
// attachment's expected date, corroborated by a fileType check via the
// duplicate-checker's own per-entry preview endpoint.
//
// The first cut also required an exact TITLE match (titleFromFilename) —
// removed the same day, live HAR evidence (docs, see
// findPossibleSavedDocuments' own comment): it failed on the very case it
// exists for, because the widget's own default title is a meaningless
// attachment filename that any sensible clinician overwrites before saving.
// Since the real saved title can't be predicted, a match here is only ever
// a POSSIBLE one (date + file type, not title) — the chip stays enabled and
// shows a small non-blocking hint rather than disabling the "Save as
// document" button. Deliberately not a hard block: a wrong guess must never
// make a genuine save impossible with no way to override it. See
// extractJournalDocumentCandidates' own header comment for the walker
// design and findPossibleSavedDocuments for the matching logic.
//
// The side panel and content scripts alike have host_permissions for
// *.api.england.medicus.health, so this works directly from the content-script
// context (same as booking-inline.js / task-inline.js).
//
// ATTACHMENT RESOLUTION: some task types (confirmed live: communication-thread)
// render the attachment as a plain <button> labelled with the filename and NO
// href at all — content.js's extractInitialRequest() records these with
// href:'' (see that file). This widget resolves them via the SAME
// `/tasks/data/{typeSlug}/overview/{taskUuid}` call already made to find the
// patient (one fetch, not two): the response embeds the real attachment
// `{ id, fileName, fileSize, contentType, fileURI }` somewhere in its tree —
// the exact nesting differs by task type (confirmed:
// communicationThread.communications[].patientRequest.attachments /
// .operativeChannel.attachments), so findAttachmentsInOverview walks the
// whole JSON looking for that shape rather than hardcoding one path — a
// missing/wrong hardcoded path would silently drop a real attachment.
// `fileURI` is used AS GIVEN for the download (relative to the API host) —
// never reconstructed. Confirmed via live capture 2026-07-20, see
// docs/learnings-triage-attachment-to-document.md §8.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

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

  var IMAGE_EXT_RE = /\.(jpe?g|png|tiff?|heic|gif)$/i;
  var DOCFILE_EXT_RE = /\.(pdf|docx?)$/i;

  // The two CONFIRMED real documentType codes (see the SCOPE comment above)
  // — never invent a third without a live capture confirming it first.
  var DOCUMENT_TYPES = {
    image: { description: 'Medical photograph', conceptId: '820241000000102', descriptionId: '2136431000000115' },
    document: {
      description: 'Patient/Carer Correspondence',
      conceptId: '163181000000107',
      descriptionId: '214931000000113',
    },
  };

  // null for any extension we don't have a confirmed code for.
  function documentTypeForFilename(filename) {
    var f = filename || '';
    if (IMAGE_EXT_RE.test(f)) return DOCUMENT_TYPES.image;
    if (DOCFILE_EXT_RE.test(f)) return DOCUMENT_TYPES.document;
    return null;
  }

  // Narrows a raw attachments list (as extracted by content.js's
  // extractInitialRequest) down to the subset this widget can safely file —
  // see the SCOPE comment at the top of this file for why. An entry with no
  // href (button-rendered attachment, href:'') is still eligible as long as
  // it has a filename to identify/resolve it by — only a filename-less,
  // href-less entry (nothing to key off at all) is dropped.
  function filterEligibleAttachments(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (a) {
      if (!a || (!a.href && !a.filename)) return false;
      return documentTypeForFilename(a.filename || a.href) !== null;
    });
  }

  // Finds every attachment-shaped object ({ id, fileName, fileURI, … })
  // anywhere in a task-overview API response, deduped by id — see the
  // ATTACHMENT RESOLUTION header comment for why this walks the whole tree
  // instead of a hardcoded path. Returns [] for anything not shaped like the
  // confirmed contract (never guesses a shape).
  function findAttachmentsInOverview(data) {
    var out = [];
    var seen = Object.create(null);
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node.fileName === 'string' && typeof node.fileURI === 'string' && node.id) {
        if (!seen[node.id]) {
          seen[node.id] = true;
          out.push({
            id: node.id,
            filename: node.fileName,
            fileURI: node.fileURI,
            fileSize: node.fileSize,
            contentType: node.contentType,
          });
        }
        return; // an attachment object's own fields are never themselves attachments
      }
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k]);
      }
    })(data);
    return out;
  }

  // The same task-overview response's patient-id shape — task types nest this
  // differently (confirmed: a top-level data.patientId for communication-thread
  // tasks), so every known fallback is tried, same discipline as before.
  function patientIdFromOverview(data) {
    return (
      (data && data.data && data.data.patient && data.data.patient.id) ||
      (data && data.data && data.data.patientId) ||
      (data && data.patient && data.patient.id) ||
      (data && data.patientId) ||
      null
    );
  }

  // Resolves a single attachment to an absolute, fetchable download URL.
  // Already-resolved (href present, e.g. a real <a> in the DOM) passes
  // through unchanged. An unresolved (button-rendered) attachment is matched
  // by filename against the task-overview attachment list — `base` +
  // `fileURI` AS GIVEN, never reconstructed. Returns null (never a guess) if
  // no match is found.
  function resolveAttachmentUrl(att, resolvedList, base) {
    if (att && att.href) return att.href;
    var filename = att && att.filename;
    var match = (resolvedList || []).find(function (r) {
      return r.filename === filename;
    });
    return match ? String(base || '') + match.fileURI : null;
  }

  // docPriority values outside 1-6 (missing/null/undefined/out-of-range) are
  // never trusted as "1" or clamped to the nearest real tier — they sort/
  // colour as a single, deliberately worse-than-6 "unscored" bucket instead,
  // so an entry the practice never actually rated can't accidentally read as
  // high-priority.
  var UNSCORED_PRIORITY = 7;

  function normalisedPriority(docPriority) {
    return Number.isInteger(docPriority) && docPriority >= 1 && docPriority <= 6 ? docPriority : UNSCORED_PRIORITY;
  }

  // Case-insensitive substring match on `description` against the full
  // document-type picklist (rules/document-types.json), RANKED by docPriority
  // (1 = most useful, first; unscored entries sort last), tiebroken
  // alphabetically, and capped at `limit` results so a broad query never
  // renders an enormous dropdown. Empty/blank query returns [] — the search
  // only activates once the user has typed something, it is not a way to
  // browse all 1768 entries at once. docPriority is a SOFT signal (see the
  // SCOPE header comment) — this ranking never hides a genuine text match,
  // it only orders them.
  function filterDocumentTypes(entries, query, limit) {
    var q = String(query || '')
      .trim()
      .toLowerCase();
    if (!q || !Array.isArray(entries)) return [];
    var matches = entries.filter(function (e) {
      return e && typeof e.description === 'string' && e.description.toLowerCase().indexOf(q) !== -1;
    });
    matches.sort(function (a, b) {
      var pa = normalisedPriority(a.docPriority);
      var pb = normalisedPriority(b.docPriority);
      if (pa !== pb) return pa - pb;
      return String(a.description).localeCompare(String(b.description));
    });
    var cap = limit > 0 ? limit : matches.length;
    return matches.slice(0, cap);
  }

  // Green(1) -> red(6) sliding scale for a search result's docPriority — a
  // fixed 6-step palette rather than a continuous interpolation, so each
  // tier reads as visually distinct at a glance. A score outside 1-6
  // (missing/invalid) gets its own neutral grey — deliberately NOT the same
  // as tier 6's red, since "never scored" isn't the same claim as "scored as
  // junk".
  var PRIORITY_COLORS = {
    1: '#16a34a',
    2: '#65a30d',
    3: '#ca8a04',
    4: '#ea580c',
    5: '#dc2626',
    6: '#991b1b',
  };
  var UNSCORED_COLOR = '#9ca3af';

  function priorityColor(docPriority) {
    var p = normalisedPriority(Number(docPriority));
    return p === UNSCORED_PRIORITY ? UNSCORED_COLOR : PRIORITY_COLORS[p];
  }

  function findDocumentTypeByConceptId(entries, conceptId) {
    if (!Array.isArray(entries) || !conceptId) return null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i] && entries[i].conceptId === conceptId) return entries[i];
    }
    return null;
  }

  function titleFromFilename(filename) {
    if (!filename) return 'Attachment';
    var base = filename.replace(/\.[^./]+$/, '');
    return base || 'Attachment';
  }

  // ── "Already saved as a document?" cross-check (2026-08-19 request) ────────────
  // Nick's correction to an earlier local-storage-only design: triage
  // requests are routinely worked across multiple computers by multiple
  // people, so per-machine chrome.storage state can never be the source of
  // truth for "has ANYONE already filed this" — it has to be a live,
  // server-side check every clinician's browser gets the same answer from.
  //
  // The duplicate-checker (engine/record-duplicate-parser.js) already solves
  // "list every document on this patient's record": it reads the SAME bulk
  // GET /clinical/data/patient-journal/overview/{patientId} -> {
  // patientJournalRecords } contract shared/journal-problem-matching.js
  // already reads elsewhere in this suite, via its own flattenJournal(). Per
  // that file's own header comment discipline ("a PURPOSE-BUILT walker, not
  // a reuse of flattenJournal — that function lives only in the
  // duplicate-checker.html bundle, not this medicus.health content-script
  // group"), extractJournalDocumentCandidates below is a second, narrower
  // purpose-built walker for THIS file, not an extraction of a stable,
  // tested, load-bearing file for a second consumer. Field access (title,
  // documentTypeLabel, documentDate — item.data for flat top-level items,
  // directly on the entry for nested ones) mirrors record-duplicate-
  // parser.js's own confirmed document-entry shape exactly
  // (docs/learnings-duplicate-entry-timestamps.md).
  //
  // WHY THIS IS DATE + FILE TYPE, NOT TITLE OR FILESIZE. Filesize was ruled
  // out for the same reason the duplicate-checker never uses it as a primary
  // signal here: Medicus's own preview endpoint returns fileSize as a
  // human-rounded display string ("10.44 KB", confirmed in
  // engine/record-duplicate-parser.js's own comment), not a raw byte count,
  // so reproducing its exact rounding to compare against our attachment's
  // own raw byte count would be guessing at a format never captured live.
  //
  // Title was the FIRST design (2026-08-19) — the widget itself sets the
  // title at save time (titleFromFilename), so a document whose title
  // matched what we'd generate for THIS exact attachment looked like a much
  // stronger anchor than a coincidence. Live-tested and found to fail on the
  // very case it exists for (HAR 70-not-flipping.har, same day): the default
  // title is a meaningless attachment filename (a UUID, in the captured
  // case), so any clinician saving it sensibly types a real title instead —
  // "ENT letter New Victoria" for "d73050ca-....jpeg" was the actual
  // capture. That title can't be predicted from the filename, so exact-title
  // matching was near-guaranteed to never fire in the cross-machine case it
  // was built for.
  //
  // Corrected design: date window (±SAVED_DOC_DATE_TOLERANCE_DAYS of the
  // attachment's expected date) plus a fileType check via the same per-entry
  // preview fetch the duplicate-checker uses — two independent,
  // well-understood signals, no format-guessing, but also no title-strength
  // certainty. That's why a match here is surfaced as a non-blocking
  // "a .jpeg was filed on … — check before saving" hint (see
  // updatePossibleSavedHint) rather than disabling the chip outright — see
  // findPossibleSavedDocuments below. ±2 days (not ±7): a save from a
  // triage attachment lands on the task's own date; a 15-day window was
  // lighting up every same-extension document on an active patient's
  // record (H-061).
  var SAVED_DOC_DATE_TOLERANCE_DAYS = 2;

  // Journal overview `documentDate` is a DISPLAY string ("16 Aug 2025",
  // confirmed docs/learnings-duplicate-entry-timestamps.md:114/370);
  // `day.title` (the fallback when documentDate is null — same doc, row
  // 185, and content-scripts/document-codes-to-problems.js:133-135) is
  // the same shape, sometimes with a weekday prefix ("Sat 16 Aug 2025",
  // test-record-duplicate-parser.js). window.__msTaskCreatedDate is ISO
  // YYYY-MM-DD (content.js). Parse both explicitly to local midnight —
  // never rely on new Date()'s non-standard fallback, and never mix
  // UTC-parsed ISO with locally-parsed display strings (an hour of
  // timezone skew would flip a same-day match).
  var DOC_MONTHS = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };

  function parseDocDate(v) {
    if (typeof v !== 'string') return null;
    var t = v.trim();
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    // Optional weekday ("Sat 16 Aug 2025" / "Mon 1 Jan 2024") then D/DD Mon YYYY.
    m = t.match(/^(?:[A-Za-z]{3,9}\s+)?(\d{1,2})\s+([A-Z][a-z]{2})\s+(\d{4})$/);
    if (m && DOC_MONTHS[m[2]] !== undefined) return new Date(+m[3], DOC_MONTHS[m[2]], +m[1]);
    return null;
  }

  function candidateAnchorDate(c) {
    if (!c) return null;
    return c.documentDate || c.dayTitle || null;
  }

  function isDocumentKindEntry(entry) {
    // record-duplicate-parser.js treats document and fit-note as one
    // document kind (live-confirmed 2026-07-04) — a colleague who filed
    // the attachment via Medicus's own fit-note path would otherwise be
    // an invisible miss for this check.
    return !!entry && (entry.entryType === 'document' || entry.entryType === 'fit-note');
  }

  function extractJournalDocumentCandidates(dayGroups) {
    var out = [];
    (Array.isArray(dayGroups) ? dayGroups : []).forEach(function (day) {
      var dayTitle = (day && day.title) || null;
      (day && Array.isArray(day.items) ? day.items : []).forEach(function (item) {
        if (!item) return;
        if (item.type === 'encounter') {
          var enc = item.data || {};
          (Array.isArray(enc.consultationTopics) ? enc.consultationTopics : []).forEach(function (topic) {
            (Array.isArray(topic && topic.headings) ? topic.headings : []).forEach(function (heading) {
              (Array.isArray(heading && heading.entries) ? heading.entries : []).forEach(function (entry) {
                if (!isDocumentKindEntry(entry)) return;
                out.push({
                  entryId: entry.id,
                  title: entry.title || null,
                  documentTypeLabel: entry.documentTypeLabel || null,
                  documentDate: entry.documentDate || null,
                  dayTitle: dayTitle,
                });
              });
            });
          });
        } else if (item.type === 'document') {
          // Confirmed live (docs/learnings-duplicate-entry-timestamps.md): a
          // flat top-level document's real content lives under item.data,
          // in the SAME shape a nested entry exposes directly — item.title
          // itself is always null.
          var d = item.data || {};
          out.push({
            entryId: d.id || item.id,
            title: d.title || null,
            documentTypeLabel: d.documentTypeLabel || null,
            documentDate: d.documentDate || null,
            dayTitle: dayTitle,
          });
        }
      });
    });
    return out;
  }

  function daysBetween(a, b) {
    var da = parseDocDate(a);
    var db = parseDocDate(b);
    if (!da || !db) return null;
    return Math.abs(da.getTime() - db.getTime()) / (24 * 60 * 60 * 1000);
  }

  // The cheap pre-filter — no fetch, just comparing already-fetched fields.
  // No title involved (see the header comment above for why that was tried
  // and removed). Date anchor is documentDate, falling back to the journal
  // day's title when documentDate is null (a real original document in
  // docs/learnings-duplicate-entry-timestamps.md:185 has documentDate:
  // null — dropping those silently missed the native-upload case this
  // check exists for). Returns every candidate within the window, closest
  // first; the caller narrows further with a per-candidate fileType check
  // before treating anything as even a "possible" match.
  function findPossibleSavedDocuments(candidates, expectedDateIso, toleranceDays) {
    var tol = typeof toleranceDays === 'number' ? toleranceDays : SAVED_DOC_DATE_TOLERANCE_DAYS;
    if (!expectedDateIso) return [];
    return (Array.isArray(candidates) ? candidates : [])
      .filter(function (c) {
        var anchor = candidateAnchorDate(c);
        if (!anchor) return false;
        var diff = daysBetween(anchor, expectedDateIso);
        return diff !== null && diff <= tol;
      })
      .sort(function (x, y) {
        return (
          daysBetween(candidateAnchorDate(x), expectedDateIso) - daysBetween(candidateAnchorDate(y), expectedDateIso)
        );
      });
  }

  // Medicus preview `fileType` is a bare lowercase extension ('pdf',
  // 'jpeg', 'tiff' — live fixtures in test-record-duplicate-parser.js).
  // IMAGE_EXT_RE admits jpg/jpe/tif aliases, so exact-string compare
  // against extensionOf would silently miss photo.jpg vs stored jpeg.
  function normExt(e) {
    var x = (e || '').toString().trim().toLowerCase();
    if (x === 'jpg' || x === 'jpe') return 'jpeg';
    if (x === 'tif') return 'tiff';
    if (x === 'htm') return 'html';
    return x || null;
  }

  function extensionOf(filename) {
    var m = /\.([^./]+)$/.exec(filename || '');
    return m ? normExt(m[1]) : null;
  }

  // Strips a documentType object down to exactly the three fields Medicus's
  // create-document endpoint accepts (bug found live via HAR
  // 69-failed-docsave.har, 2026-08-19: `{"errors":{"documentType.docPriority":
  // ["This field was not expected."]}}`). Every one of the 1768 entries in
  // rules/document-types.json carries a FOURTH field, `docPriority` (1-6,
  // this extension's own local ranking/colour metadata for search results —
  // see the SCOPE header comment) — a real field on the object the search
  // picker sets `s.documentType` to (bindDocumentTypePicks), but one Medicus
  // has no concept of and rejects outright. The two hardcoded extension-
  // guess objects (DOCUMENT_TYPES.image/.document) happen to be clean
  // (no docPriority), which is why a save only ever worked when the
  // clinician accepted the auto-guess untouched — the INSTANT they used
  // search for ANY reason, on ANY file type (confirmed live: the failing
  // HAR's own file was a .jpeg, "Medical photograph" itself is also in the
  // rules file with docPriority — this was never actually a photo-vs-
  // document distinction), the picked object 400'd. One sanitize at this
  // single choke point — the one place the write payload gets built — fixes
  // every document type at once, not just the one in this capture.
  function sanitizeDocumentType(dt) {
    if (!dt) return null;
    return { conceptId: dt.conceptId, description: dt.description, descriptionId: dt.descriptionId };
  }

  // Builds the confirmed `formPayload` object (see
  // docs/learnings-triage-attachment-to-document.md) — pure, no fetch. The
  // caller JSON.stringifies this into the FormData field of the same name.
  function buildFormPayload(opts) {
    return {
      patientId: opts.patientId,
      documentType: sanitizeDocumentType(opts.documentType),
      documentDate: opts.documentDate,
      authoredByDepartment: null,
      authoredByPractitioner: null,
      clinicalSpecialty: null,
      authoredByOrganisation: null,
      linkedProblemIds: [],
      contextId: null,
      contextType: null,
      reviewerAssigneeId: opts.reviewerAssigneeId,
      reviewerAssigneeType: opts.reviewerAssigneeType,
      hiddenFromPatientFacingServices: false,
      confidentialFromThirdParties: false,
      title: opts.title,
      additionalInformation: null,
      problemCode: null,
      recordDate: opts.documentDate,
      authorOrganisationOption: 'local',
      clinicalCaseId: null,
      nextStep: 'file-into-patient-record',
      reviewTaskPriority: 0,
    };
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      filterEligibleAttachments,
      titleFromFilename,
      buildFormPayload,
      sanitizeDocumentType,
      documentTypeForFilename,
      findAttachmentsInOverview,
      patientIdFromOverview,
      resolveAttachmentUrl,
      filterDocumentTypes,
      priorityColor,
      findDocumentTypeByConceptId,
      extractJournalDocumentCandidates,
      findPossibleSavedDocuments,
      daysBetween,
      parseDocDate,
      candidateAnchorDate,
      normExt,
      extensionOf,
      SAVED_DOC_DATE_TOLERANCE_DAYS,
      DOCUMENT_TYPES,
      IMAGE_EXT_RE,
      DOCFILE_EXT_RE,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msDocFileInline) return;
  window.__msDocFileInline = true;

  function eligibleAttachments() {
    return filterEligibleAttachments(window.__msTriageAttachments);
  }

  // ── URL detection ─────────────────────────────────────────────────────────────

  function getTaskInfo() {
    var m = location.pathname.match(
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  function blankState() {
    return {
      open: false,
      loading: false,
      error: null,
      patientId: null,
      // The task uuid patientId was resolved FROM — doCreate's commit-time
      // re-verification (H-043 family) compares this against the task on
      // screen at save time and aborts on mismatch.
      resolvedForTaskUuid: null,
      // Cached once loaded — reused across every chip open/switch on this
      // task page, so switching between attachments never re-fetches it.
      reviewerAssigneeId: null,
      reviewerAssigneeType: null,
      recordDateDefault: null,
      // Attachment list from the task-overview API — resolves any DOM-detected
      // attachment that arrived with no href (see resolveAttachmentUrl above).
      resolvedAttachments: [],
      // The filename of the attachment the currently open form is filing —
      // the single source of truth for "which attachment", instead of an
      // array index (a filename is stable across re-extraction passes; an
      // index isn't, if the underlying attachment list is ever reordered).
      // null when no form is open.
      activeFilename: null,
      // Filenames already saved as a document THIS page visit, via THIS
      // widget — instant, free, no fetch (drives each chip's disabled "✓
      // Saved as document" state; possibleSavedMatches below is separate and
      // never disables the chip — see its own comment).
      savedFilenames: [],
      // filename -> {title, date} for a POSSIBLE (not confirmed) match found
      // via the server-side journal cross-check (2026-08-19 — see
      // ensureSavedDocumentCheck's own comment) — catches a save made by a
      // DIFFERENT clinician, on a DIFFERENT computer, or via Medicus's own
      // native upload, none of which savedFilenames above could ever see.
      // Genuinely non-blocking (unlike the name might suggest before you've
      // read the header comment): the chip stays enabled and shows a hint,
      // it never disables — see updatePossibleSavedHint.
      possibleSavedMatches: Object.create(null),
      // entryIds already assigned to an attachment THIS task load — one
      // journal document must not flag every same-extension attachment
      // on the card (three photos + one saved jpeg would otherwise all
      // show the same hint).
      claimedSavedEntryIds: [],
      // The ONE bulk GET /clinical/data/patient-journal/overview/{patientId}
      // fetch this whole check needs — 'idle'|'loading'|'done'|'error',
      // fetched once per task and cached here so re-running the check for a
      // later-appearing attachment never re-fetches it.
      journalFetchState: 'idle',
      journalDocCandidates: null,
      // Filenames already run through the per-attachment check THIS task
      // load, regardless of outcome — lets ensureSavedDocumentCheck skip
      // straight to any genuinely NEW attachment on a later tick instead of
      // repeating work for ones already resolved.
      serverCheckedFilenames: [],
      title: '',
      // The SNOMED code that will actually be sent — pre-filled from
      // documentTypeForFilename's extension-based guess, overridable via the
      // priority shortlist or search before saving. Nothing is filed while
      // this is null (see canCreate in renderForm).
      documentType: null,
      documentTypeQuery: '',
      // true when documentTypeQuery is just DISPLAYING the current selection
      // (pre-selected guess, or just picked from the shortlist/search) rather
      // than an in-progress search the clinician is typing — suppresses the
      // results dropdown so a freshly-made selection doesn't immediately show
      // a "here's what else you could pick" list under itself.
      documentTypeQueryLocked: false,
      documentDate: todayISO(),
      creating: false,
      createError: null,
    };
  }

  var s = blankState();

  // ── API ───────────────────────────────────────────────────────────────────────

  function apiBaseUrl() {
    var info = getTaskInfo();
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
    if (!resp.ok) throw new Error('API ' + resp.status);
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Document API returned an unexpected response.');
    }
  }

  // Multipart create call — deliberately does NOT set a Content-Type header:
  // the browser must generate the multipart boundary itself. Setting one
  // manually (even to 'multipart/form-data') breaks the server's parser.
  async function apiFetchMultipart(path, formData) {
    var resp = await fetch(apiBaseUrl() + path, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*' },
      body: formData,
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Document API returned an unexpected response.');
    }
  }

  // Fetches the task-overview API once (same call task-inline.js/
  // booking-inline.js make for patient resolution) and pulls BOTH the patient
  // id and the real attachment list out of it — one fetch serves both needs,
  // see the ATTACHMENT RESOLUTION header comment for why.
  async function fetchTaskOverview(typeSlug, taskUuid) {
    var data = await apiFetch('/tasks/data/' + typeSlug + '/overview/' + taskUuid);
    return { patientId: patientIdFromOverview(data), attachments: findAttachmentsInOverview(data) };
  }

  async function apiFetchCreateForm(patientId) {
    return apiFetch('/clinical/data/document/forms/create-inbound-document-form/' + encodeURIComponent(patientId));
  }

  // The SAME bulk endpoint shared/journal-problem-matching.js already reads
  // for journal-code-sync — see extractJournalDocumentCandidates' own
  // comment for the full "already saved?" cross-check design.
  async function fetchJournalDocumentCandidates(patientId) {
    var data = await apiFetch('/clinical/data/patient-journal/overview/' + encodeURIComponent(patientId));
    return extractJournalDocumentCandidates(data && data.patientJournalRecords);
  }

  // Confirms a date-window candidate is the same *kind* of file by
  // checking its fileType against the attachment's own extension — the
  // SAME GET /clinical/data/document/modals/preview/{entryId} endpoint
  // duplicate-checker.js's fetchDocumentPreviews already uses. Memoised
  // on entryId: three same-extension attachments used to re-fetch the
  // same preview N times each (duplicate-checker.js:908-913 recorded
  // that exact cost as ~25s on a 63-document record and made the pass
  // opt-in). Best-effort: a failed preview fetch for one candidate just
  // excludes that candidate (never treated as a match).
  var _previewFileTypeCache = Object.create(null);
  async function candidateFileTypeMatches(entryId, expectedExt) {
    var want = normExt(expectedExt);
    if (!want || !entryId) return false;
    if (!Object.prototype.hasOwnProperty.call(_previewFileTypeCache, entryId)) {
      try {
        var preview = await apiFetch('/clinical/data/document/modals/preview/' + encodeURIComponent(entryId));
        var ft = preview && typeof preview.fileType === 'string' ? preview.fileType.trim() : null;
        _previewFileTypeCache[entryId] = ft ? normExt(ft) : null;
      } catch (e) {
        _previewFileTypeCache[entryId] = null;
      }
    }
    var cached = _previewFileTypeCache[entryId];
    return !!cached && cached === want;
  }

  // Loads the full document-type picklist (rules/document-types.json, see the
  // SCOPE header comment) ONCE per page load — a local extension resource,
  // not a Medicus call, so this is cheap and kicked off at script boot below
  // rather than waiting for the widget to open. Cached as a promise so a
  // widget reopen (or a second task page) never re-fetches; falls back to an
  // empty picklist (never throws) if the resource is somehow unavailable —
  // the extension-based guess (documentTypeForFilename) still works even
  // then, only search would be empty.
  var _dtPromise = null;
  var _dtCache = null; // { entries } once resolved
  function ensureDocumentTypesLoaded() {
    if (_dtPromise) return _dtPromise;
    _dtPromise = (async function () {
      try {
        var url = chrome.runtime.getURL('rules/document-types.json');
        var doc = await fetch(url).then(function (r) {
          return r.json();
        });
        _dtCache = { entries: Array.isArray(doc && doc.entries) ? doc.entries : [] };
      } catch (e) {
        _dtCache = { entries: [] };
      }
      return _dtCache;
    })();
    return _dtPromise;
  }

  // Builds and sends the confirmed multipart contract — see
  // docs/learnings-triage-attachment-to-document.md. Every field here is
  // either a fixed, confirmed constant for this widget's narrow scope
  // (documentType, authorOrganisationOption, nextStep, …) or a live value
  // fetched from apiFetchCreateForm (reviewerAssigneeId/Type, recordDate) —
  // nothing is guessed.
  async function apiCreateDocument(opts) {
    var fd = new FormData();
    fd.append('file', opts.blob, opts.filename);
    fd.append('formPayload', JSON.stringify(buildFormPayload(opts)));
    return apiFetchMultipart('/clinical/document/create', fd);
  }

  // ── DOM injection: per-attachment chip + a single relocating form ──────────────
  // Originally this widget anchored ONE collapsed toggle bar near a
  // task-level landmark ("Codes & actions" card / booking or task widget /
  // bottom action row), falling back to the attachment's own card only as a
  // last resort. Confirmed live 2026-07-23: on a task that DOES have a
  // "Codes & actions" card, that landmark sits well below the message thread,
  // so the widget (and, via ensureWidgetRow, the task widget it paired with)
  // ended up far from the attachment it was actually for — confusing with
  // multiple attachments in play. Replaced with a small chip injected
  // immediately after EACH eligible attachment's own DOM element (button or
  // link) — clicking one opens the SAME single form and relocates it right
  // after that chip. No more task-landmark anchor priority chain at all.

  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  // Finds the real attachment <a>/<button> Medicus rendered for a given
  // filename — same exact-text match content.js's extractAllAttachments()
  // used to detect it in the first place. Skips anything already inside our
  // own widget/chips so a coincidental text match there can never self-match.
  function attachmentElementFor(filename) {
    var els = document.querySelectorAll('a, button');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.classList.contains('ms-df-chip')) continue;
      if (el.closest('#ms-df-widget')) continue;
      if ((el.textContent || '').trim() === filename) return el;
    }
    return null;
  }

  // filename -> injected chip element, so re-injection ticks can find and
  // refresh an already-placed chip instead of re-scanning for its anchor
  // every time, and positionWidgetAfterChip can find it without any CSS
  // selector/escaping concerns over filename punctuation.
  var _chipEls = Object.create(null);

  function updateChipVisual(chip, filename) {
    var saved = s.savedFilenames.indexOf(filename) !== -1;
    var active = s.open && s.activeFilename === filename;
    chip.disabled = saved;
    chip.textContent = saved ? '✓ Saved as document' : 'Save as document';
    chip.classList.toggle('ms-df-chip-saved', saved);
    chip.classList.toggle('ms-df-chip-active', active);
    updatePossibleSavedHint(chip, filename, saved);
  }

  // Renders (or removes) the non-blocking "possibly already saved" hint
  // next to a chip — see blankState's possibleSavedMatches comment and the
  // ALREADY-SAVED CROSS-CHECK header comment for why this is a hint, not a
  // disabled button. Never shown once savedFilenames already covers this
  // filename (that state — disabled "✓ Saved as document" — already says
  // more than the hint would, no need for both).
  function formatHintDate(v) {
    var d = parseDocDate(v);
    if (!d) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return d.getDate() + ' ' + months[d.getMonth()];
  }

  function updatePossibleSavedHint(chip, filename, saved) {
    var wrap = chip.parentElement;
    if (!wrap) return;
    var hint = wrap.querySelector('.ms-df-possible-saved-hint');
    var match = !saved ? s.possibleSavedMatches[filename] : null;
    if (!match) {
      if (hint) {
        withObserverPaused(function () {
          hint.remove();
        });
      }
      return;
    }
    if (!hint) {
      withObserverPaused(function () {
        hint = document.createElement('span');
        hint.className = 'ms-df-possible-saved-hint';
        hint.setAttribute('tabindex', '0');
        hint.setAttribute('role', 'note');
        wrap.appendChild(hint);
      });
    }
    // State the evidence, not the conclusion (H-061). Date + file type
    // cannot support "already saved as <title>" — that wording is what
    // a ±7-day same-extension coincidence used to assert.
    var dateBit = match.date ? ' on ' + formatHintDate(match.date) : '';
    var extBit = match.ext ? '.' + match.ext : 'document';
    hint.textContent = '⚠ a ' + extBit + ' was filed' + dateBit + ' — check before saving';
    var tip =
      'A ' +
      extBit +
      ' document is in the patient journal' +
      (match.date ? ' (' + match.date + ')' : '') +
      (match.title ? ', titled “' + String(match.title).slice(0, 40) + '”' : '') +
      ' — matched by date and file type, not by title. Check before saving again.';
    hint.title = tip;
    hint.setAttribute('aria-label', tip);
  }

  function refreshAllChipVisuals() {
    for (var filename in _chipEls) {
      if (!Object.prototype.hasOwnProperty.call(_chipEls, filename)) continue;
      var chip = _chipEls[filename];
      if (chip && chip.isConnected) updateChipVisual(chip, filename);
    }
  }

  // Idempotent — safe to call on every re-injection tick. Only creates a chip
  // for an attachment that doesn't already have a live one; existing chips
  // just get their visual state refreshed (saved/active). Wraps the
  // attachment element and the chip together in a small inline-flex span
  // (rather than just inserting the chip as a plain next sibling) so the chip
  // sits horizontally alongside the attachment link/button — confirmed live
  // 2026-07-23 that a plain sibling insert dropped below it instead, because
  // Medicus's own attachment button is block-level.
  function injectAttachmentChips() {
    eligibleAttachments().forEach(function (att) {
      var name = (att && att.filename ? att.filename : '').trim();
      if (!name) return;
      var existing = _chipEls[name];
      if (existing && existing.isConnected) {
        updateChipVisual(existing, name);
        return;
      }
      var anchorEl = attachmentElementFor(name);
      if (!anchorEl) return;
      // Reuse an already-wrapped anchor from an earlier pass whose chip
      // reference was lost (e.g. _chipEls got reset on a path change but the
      // DOM survived) rather than nesting a second wrapper around it.
      var wrap = anchorEl.parentElement;
      var chip = wrap && wrap.classList.contains('ms-df-chip-wrap') ? wrap.querySelector('.ms-df-chip') : null;
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ms-df-chip';
        chip.setAttribute('data-filename', name);
        chip.addEventListener('click', function (e) {
          // Confirmed live 2026-07-23: without this, clicking the chip
          // bubbled into whatever Medicus wraps the message/attachment in,
          // which has its own click handler that opened its "view care
          // related communication" pane — an unrelated side effect of a
          // click that should only ever open OUR form.
          e.stopPropagation();
          if (chip.disabled) return;
          openFormForAttachment(name);
        });
        withObserverPaused(function () {
          var w2 = document.createElement('span');
          w2.className = 'ms-df-chip-wrap';
          anchorEl.parentNode.insertBefore(w2, anchorEl);
          w2.appendChild(anchorEl);
          w2.appendChild(chip);
        });
      }
      updateChipVisual(chip, name);
      _chipEls[name] = chip;
    });
  }

  // Kicks off (and incrementally extends) the server-side "already saved?"
  // cross-check — see extractJournalDocumentCandidates' own header comment
  // for the full design. Proactive, not lazy: called from runInject
  // alongside injectAttachmentChips, so a chip can pick up its "possibly
  // already saved" hint before the clinician ever clicks it, not just after.
  // The bulk journal fetch happens ONCE per task (journalFetchState guards
  // it); each eligible attachment is then checked ONCE
  // (serverCheckedFilenames guards that) — so a later-appearing attachment
  // (content.js's own async extraction can populate
  // window.__msTriageAttachments progressively) still gets checked on a
  // later tick without ever re-fetching the journal. Fire-and-forget at the
  // call site, same discipline as ensureDocumentTypesLoaded — errors are
  // swallowed here, never surfaced as a load error, since this whole check
  // is advisory: a failure just leaves chips with no hint, same as before
  // this check existed.
  async function ensureSavedDocumentCheck() {
    var atts = eligibleAttachments();
    if (!atts.length) return;
    var st = s;

    if (st.journalFetchState === 'idle') {
      st.journalFetchState = 'loading';
      try {
        if (!st.patientId) {
          var info = getTaskInfo();
          if (!info) {
            st.journalFetchState = 'error';
            return;
          }
          var overview = await fetchTaskOverview(info.typeSlug, info.taskUuid);
          if (st !== s) return; // navigated away mid-fetch — discard
          st.patientId = overview.patientId;
          st.resolvedForTaskUuid = info.taskUuid;
          st.resolvedAttachments = overview.attachments;
        }
        if (!st.patientId) {
          st.journalFetchState = 'error';
          return;
        }
        st.journalDocCandidates = await fetchJournalDocumentCandidates(st.patientId);
        if (st !== s) return;
        st.journalFetchState = 'done';
      } catch (e) {
        if (st === s) st.journalFetchState = 'error';
        return;
      }
    }
    if (st.journalFetchState !== 'done' || !st.journalDocCandidates) return;

    var taskDate = (typeof window.__msTaskCreatedDate === 'string' && window.__msTaskCreatedDate) || null;
    var anyNewlyConfirmed = false;
    // Cap per-attachment preview walks — with the 2-day window this is
    // usually 0–2 candidates; the cap is the backstop if a busy record
    // still has a cluster of same-day documents.
    var PREVIEW_MATCH_CAP = 10;
    for (var i = 0; i < atts.length; i++) {
      var att = atts[i];
      var name = (att && att.filename ? att.filename : '').trim();
      if (!name || st.serverCheckedFilenames.indexOf(name) !== -1) continue;
      st.serverCheckedFilenames.push(name);
      var expectedExt = extensionOf(att.filename || att.href);
      var matches = findPossibleSavedDocuments(st.journalDocCandidates, taskDate, SAVED_DOC_DATE_TOLERANCE_DAYS).slice(
        0,
        PREVIEW_MATCH_CAP
      );
      for (var j = 0; j < matches.length; j++) {
        var entryId = matches[j].entryId;
        if (!entryId || st.claimedSavedEntryIds.indexOf(entryId) !== -1) continue;
        var ok = await candidateFileTypeMatches(entryId, expectedExt);
        if (st !== s) return;
        if (ok) {
          st.claimedSavedEntryIds.push(entryId);
          st.possibleSavedMatches[name] = {
            title: matches[j].title,
            date: candidateAnchorDate(matches[j]),
            ext: expectedExt,
          };
          anyNewlyConfirmed = true;
          break;
        }
      }
    }
    if (st === s && anyNewlyConfirmed) refreshAllChipVisuals();
  }

  // Moves the (already-mounted) form to sit immediately after the clicked
  // attachment's whole [attachment element + chip] wrapper, never inside it
  // (which would squeeze a full form panel into a small inline-flex row).
  function positionWidgetAfterChip(filename) {
    var w = document.getElementById('ms-df-widget');
    var chip = _chipEls[filename];
    if (!w || !chip || !chip.isConnected) return;
    var wrap = chip.closest('.ms-df-chip-wrap') || chip;
    withObserverPaused(function () {
      wrap.after(w);
    });
  }

  function mountWidgetIfNeeded() {
    if (document.getElementById('ms-df-widget')) return;
    var w = document.createElement('div');
    w.id = 'ms-df-widget';
    // Same reason as the chip's own stopPropagation above: the form can end
    // up as a DOM sibling inside the same Medicus container the attachment
    // lives in, so every click inside our own form needs to stop here too,
    // rather than adding stopPropagation to each individual control.
    w.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    withObserverPaused(function () {
      document.body.appendChild(w); // relocated to the right chip immediately after
    });
    renderInto(w);
  }

  function removeWidget() {
    var w = document.getElementById('ms-df-widget');
    if (!w) return;
    withObserverPaused(function () {
      w.remove();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  // Every state-changing action ends here — refreshes the (possibly absent)
  // form AND every injected chip's saved/active visual in one place, so no
  // call site has to remember to do both.
  function rerender() {
    var w = document.getElementById('ms-df-widget');
    if (w) renderInto(w);
    refreshAllChipVisuals();
  }

  function buildHtml() {
    if (s.loading) {
      return '<div class="ms-df-body"><div class="ms-df-loading">Loading…</div></div>';
    }
    if (s.error) {
      return '<div class="ms-df-body"><div class="ms-df-error">' + esc(s.error) + '</div></div>';
    }
    return renderForm();
  }

  // ── Document type picker (best-guess box that becomes a ranked, colour-coded search) ──

  // Inner HTML only (no wrapping element) — shared by the initial render and
  // the search input's live-update handler, which replaces JUST this
  // container's innerHTML on every keystroke rather than doing a full
  // rerender() (which would drop focus from the search box mid-type — same
  // discipline as the title/date inputs above). Results are already ranked
  // best-docPriority-first by filterDocumentTypes; each gets a left-border
  // dot in that same green(1)->red(6) colour so the ranking is visible at a
  // glance, not just implied by list order.
  function documentTypeResultsInnerHtml() {
    if (s.documentTypeQueryLocked) return '';
    var q = s.documentTypeQuery.trim();
    if (!q) return '';
    var entries = (_dtCache && _dtCache.entries) || [];
    var matches = filterDocumentTypes(entries, q, 40);
    if (!matches.length) return '<div class="ms-df-dt-empty">No matches.</div>';
    return (
      matches
        .map(function (dt) {
          var active = s.documentType && s.documentType.conceptId === dt.conceptId;
          return (
            '<button type="button" class="ms-df-dt-result' +
            (active ? ' ms-df-dt-result-active' : '') +
            '" style="border-left-color: ' +
            priorityColor(dt.docPriority) +
            ';" data-concept-id="' +
            esc(dt.conceptId) +
            '">' +
            esc(dt.description) +
            '</button>'
          );
        })
        .join('') +
      (matches.length >= 40 ? '<div class="ms-df-dt-more">Showing the first 40 — refine your search.</div>' : '')
    );
  }

  function currentAttachment() {
    return eligibleAttachments().find(function (a) {
      return (a.filename || '').trim() === s.activeFilename;
    });
  }

  function renderForm() {
    var att = currentAttachment();
    var canCreate = !!att && s.title.trim() && s.documentDate && s.documentType && !s.creating;
    return (
      '<div class="ms-df-body">' +
      '<div class="ms-df-filing-row">' +
      '<span class="ms-df-filing">Filing: <strong>' +
      esc(att ? att.filename : s.activeFilename || '') +
      '</strong></span>' +
      '<button type="button" class="ms-df-close" id="ms-df-close" aria-label="Close">×</button>' +
      '</div>' +
      (!s.patientId
        ? '<div class="ms-df-warn">Could not determine patient ID — try navigating away and back.</div>'
        : '') +
      '<div class="ms-df-row"><label class="ms-df-label" for="ms-df-title">Title</label>' +
      '<input class="ms-df-input" id="ms-df-title" type="text" maxlength="200" value="' +
      esc(s.title) +
      '"></div>' +
      '<div class="ms-df-row"><label class="ms-df-label" for="ms-df-date">Document date</label>' +
      '<input class="ms-df-input" id="ms-df-date" type="date" value="' +
      esc(s.documentDate) +
      '"></div>' +
      '<div class="ms-df-row">' +
      '<label class="ms-df-label" for="ms-df-dt-search">Document type</label>' +
      '<input class="ms-df-input" id="ms-df-dt-search" type="text" autocomplete="off" ' +
      'placeholder="Search all document types…" value="' +
      esc(s.documentTypeQuery) +
      '">' +
      (!s.documentType ? '<div class="ms-df-dt-none">No document type selected yet.</div>' : '') +
      '<div class="ms-df-dt-results" id="ms-df-dt-results">' +
      documentTypeResultsInnerHtml() +
      '</div>' +
      '</div>' +
      (s.createError ? '<div class="ms-df-error">' + esc(s.createError) + '</div>' : '') +
      '<button class="ms-df-btn" id="ms-df-create"' +
      (canCreate ? '' : ' disabled') +
      '>' +
      (s.creating ? 'Saving…' : 'Save as document') +
      '</button>' +
      '</div>'
    );
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  // Loads everything that's the SAME regardless of which attachment is being
  // filed (patient id, reviewer defaults, document date, the document-types
  // picklist) — once per task page. Fast-path returns immediately once
  // loaded, so switching between attachments (openFormForAttachment) never
  // re-fetches it.
  async function ensureLoaded() {
    if (s.patientId && s.reviewerAssigneeId !== null) {
      s.error = null;
      return;
    }
    s.loading = true;
    s.error = null;
    rerender();
    try {
      // ensureSavedDocumentCheck (2026-08-19) may have already fetched the
      // task overview to get patientId — never re-fetch it here if so, this
      // just needs the create-form's own reviewer/date defaults. If that
      // path set patientId without pinning resolvedForTaskUuid, pin it now
      // so doCreate's fail-closed H-043 check has an identity to compare.
      if (!s.patientId) {
        var info = getTaskInfo();
        if (info) {
          var overview = await fetchTaskOverview(info.typeSlug, info.taskUuid);
          // H-043 family: if the SPA navigated to a DIFFERENT task while the
          // overview fetch was in flight, discard the resolution — never bind a
          // stale patient to the task now on screen (audit, 2026-08-22).
          var nowInfo = getTaskInfo();
          if (!nowInfo || nowInfo.taskUuid !== info.taskUuid) {
            throw new Error('The task changed while loading — reopen the form on the task you want.');
          }
          s.patientId = overview.patientId;
          s.resolvedForTaskUuid = info.taskUuid;
          s.resolvedAttachments = overview.attachments;
        }
      } else if (!s.resolvedForTaskUuid) {
        var pinned = getTaskInfo();
        if (pinned) s.resolvedForTaskUuid = pinned.taskUuid;
      }
      if (!s.patientId) throw new Error('Could not determine the patient for this task.');
      var form = await apiFetchCreateForm(s.patientId);
      var sel = form && form.selectedReviewerAssignee;
      s.reviewerAssigneeId = (sel && sel.value) || null;
      s.reviewerAssigneeType = (sel && sel.type) || null;
      s.recordDateDefault = (form && form.recordDate) || todayISO();
      // Prefer the date the triage request itself was received (this task's
      // own "Created" date, exposed by content.js) over the create-form's own
      // recordDate default (today) — a document filed from a triage
      // attachment should be dated when the patient submitted it, not when
      // the clinician happened to action the task.
      s.documentDate =
        (typeof window.__msTaskCreatedDate === 'string' && window.__msTaskCreatedDate) || s.recordDateDefault;
      await ensureDocumentTypesLoaded();
    } catch (err) {
      s.error = err.message || 'Failed to load the document form.';
    } finally {
      s.loading = false;
    }
  }

  // The chip click handler. Re-clicking the chip that's already active closes
  // the form; clicking a different attachment's chip relocates the SAME form
  // there and re-populates it for that attachment (never opens a second
  // form — see the "one shared form" design decision, 2026-07-23).
  async function openFormForAttachment(filename) {
    if (s.open && s.activeFilename === filename) {
      closeForm();
      return;
    }
    if (s.creating) return; // don't yank the form away mid-save
    s.activeFilename = filename;
    s.open = true;
    s.createError = null;
    var att = currentAttachment();
    s.title = att ? titleFromFilename(att.filename) : '';
    s.documentType = att ? documentTypeForFilename(att.filename || att.href) : null;
    s.documentTypeQuery = s.documentType ? s.documentType.description : '';
    s.documentTypeQueryLocked = !!s.documentType;
    mountWidgetIfNeeded();
    positionWidgetAfterChip(filename);
    rerender();
    await ensureLoaded();
    // The clinician may have switched to a different attachment while this
    // was loading — only apply the result if we're still their target.
    if (s.activeFilename !== filename) return;
    positionWidgetAfterChip(filename); // in case the page churned during the fetch
    rerender();
  }

  function closeForm() {
    s.open = false;
    s.activeFilename = null;
    removeWidget();
    rerender();
  }

  async function doCreate() {
    var att = currentAttachment();
    var docType = s.documentType;
    if (s.creating || !s.patientId || !att || !docType || !s.title.trim() || !s.documentDate) return;
    s.creating = true;
    s.createError = null;
    rerender();
    try {
      // COMMIT-TIME RE-VERIFICATION (2026-08-22 clinical-safety audit — the
      // same H-043 contract W2/W5 carry): the patient id was resolved when the
      // form OPENED. Medicus is an SPA — the user may have navigated to a
      // different task since. Immediately before the write, re-read the task
      // from the URL and re-resolve its patient; abort on any mismatch rather
      // than filing this document into the previously-open patient's record.
      var commitInfo = getTaskInfo();
      // 2026-08-23 review fix: the uuid comparison used to sit behind
      // `s.resolvedForTaskUuid &&`, so it was SKIPPED entirely whenever that
      // value was falsy — a guard whose failure mode is silence. Unreachable
      // today, but it meant the check silently degraded to "trust it" the moment
      // any future path set patientId from elsewhere. Absent identity now fails
      // closed like every other arm.
      if (!commitInfo || !s.resolvedForTaskUuid || commitInfo.taskUuid !== s.resolvedForTaskUuid) {
        throw new Error(
          'The task on screen changed since this form was opened — nothing was saved. Reopen the form on the task you want.'
        );
      }
      var freshOverview = await fetchTaskOverview(commitInfo.typeSlug, commitInfo.taskUuid);
      if (!freshOverview.patientId || freshOverview.patientId !== s.patientId) {
        throw new Error(
          'Could not re-confirm the patient for this task at save time — nothing was saved. Reopen the form and try again.'
        );
      }
      // 2026-08-23 review fix: everything below awaits a multi-MB attachment
      // download before the POST, and `runInject` blanks `s` on any SPA path
      // change — so the write used to read `s.patientId` (and re-derive the API
      // base) AFTER that window. Pin the verified identity into locals here so
      // the write cannot be repointed by a navigation mid-download.
      var verifiedPatientId = freshOverview.patientId;
      var verifiedApiBase = apiBaseUrl();
      var downloadUrl = resolveAttachmentUrl(att, s.resolvedAttachments, verifiedApiBase);
      if (!downloadUrl) throw new Error("Could not locate this attachment's file — try reopening the task.");
      var resp = await fetch(downloadUrl, { credentials: 'include' });
      if (!resp.ok) throw new Error('Could not fetch the attachment (HTTP ' + resp.status + ').');
      var blob = await resp.blob();
      await apiCreateDocument({
        patientId: verifiedPatientId,
        blob: blob,
        filename: att.filename || 'attachment',
        title: s.title.trim(),
        documentDate: s.documentDate,
        documentType: docType,
        reviewerAssigneeId: s.reviewerAssigneeId,
        reviewerAssigneeType: s.reviewerAssigneeType,
      });
      s.savedFilenames.push(s.activeFilename);
      s.creating = false;
      closeForm();
    } catch (err) {
      s.createError = err.message || 'Failed to save this attachment as a document — please try again.';
      s.creating = false;
      rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    el.querySelector('#ms-df-close')?.addEventListener('click', function () {
      closeForm();
    });

    var createBtn = el.querySelector('#ms-df-create');
    function canCreateNow() {
      return !!(s.title.trim() && s.documentDate && s.documentType && !s.creating);
    }
    el.querySelector('#ms-df-title')?.addEventListener('input', function (e) {
      s.title = e.target.value;
      if (createBtn) createBtn.disabled = !canCreateNow();
    });
    el.querySelector('#ms-df-date')?.addEventListener('input', function (e) {
      s.documentDate = e.target.value;
      if (createBtn) createBtn.disabled = !canCreateNow();
    });

    // Search input: state + a TARGETED replace of just the results container's
    // innerHTML on every keystroke — never a full rerender() here, which would
    // reset the input's own DOM node and drop focus/cursor mid-type (same
    // discipline as the title/date inputs above).
    el.querySelector('#ms-df-dt-search')?.addEventListener('input', function (e) {
      s.documentTypeQuery = e.target.value;
      s.documentTypeQueryLocked = false;
      var resultsEl = el.querySelector('#ms-df-dt-results');
      if (resultsEl) {
        resultsEl.innerHTML = documentTypeResultsInnerHtml();
        bindDocumentTypePicks(resultsEl);
      }
    });

    bindDocumentTypePicks(el);

    el.querySelector('#ms-df-create')?.addEventListener('click', function () {
      doCreate();
    });
  }

  // Wires up the search-result buttons within `root` (the whole widget on
  // initial bind, or just the results container after a targeted innerHTML
  // replace — see the search input handler above) to select that document
  // type. A full rerender() here is fine: these are button clicks, not a
  // text input, so there's no cursor position to preserve.
  function bindDocumentTypePicks(root) {
    root.querySelectorAll('.ms-df-dt-result').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-concept-id');
        var entries = (_dtCache && _dtCache.entries) || [];
        var match = findDocumentTypeByConceptId(entries, id);
        if (!match) return;
        s.documentType = match;
        s.documentTypeQuery = match.description;
        s.documentTypeQueryLocked = true;
        rerender();
      });
    });
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────
  // Identical discipline to task-inline.js / booking-inline.js (own-mutation
  // filter, cheap path gate, throttle + animation-frame deferral, remove-on-leave).
  // Re-checking eligibleAttachments() on every tick also resolves the ordering
  // race with content.js's own async DOM extraction — window.__msTriageAttachments
  // may not be populated yet on the very first tick, but the shared mutation
  // observer keeps re-evaluating until it is.

  var _lastPath = location.pathname;
  var _throttle = null;
  var _obs = null;

  function observeBody() {
    if (_obs) _obs.observe(document.body, { childList: true, subtree: true });
  }

  function withObserverPaused(fn) {
    if (!_obs) {
      fn();
      return;
    }
    _obs.disconnect();
    try {
      fn();
    } finally {
      observeBody();
    }
  }

  function _isOwnWidgetMutation(mutations) {
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-df-widget')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-df-widget') continue;
          // Our injected nodes only — never the wrap's *contents*, which
          // include Medicus's own attachment button (a Vue re-render of
          // that button must still trigger re-inject).
          if (
            n.classList &&
            (n.classList.contains('ms-df-chip-wrap') ||
              n.classList.contains('ms-df-possible-saved-hint') ||
              n.classList.contains('ms-df-chip'))
          )
            continue;
          if (n.closest && n.closest('#ms-df-widget')) continue;
          return false;
        }
      }
    }
    return true;
  }

  function onMutations(mutations) {
    if (_isOwnWidgetMutation(mutations)) return;
    scheduleInject();
  }

  function scheduleInject() {
    if (_throttle) return;
    var onTaskPage = !!getTaskInfo();
    var pathChanged = location.pathname !== _lastPath;
    if (!onTaskPage && !pathChanged) return;
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    var currentPath = location.pathname;
    if (currentPath !== _lastPath) {
      _lastPath = currentPath;
      removeWidget();
      s = blankState();
      _chipEls = Object.create(null);
      _previewFileTypeCache = Object.create(null);
    }
    if (document.hidden) return;
    if (!getTaskInfo()) return;
    requestAnimationFrame(function () {
      if (document.hidden) return;
      // Idempotent — creates a chip for any eligible attachment that doesn't
      // already have a live one, and refreshes existing chips' saved/active
      // state. Also resolves the ordering race with content.js's own async
      // DOM extraction: window.__msTriageAttachments may not be populated
      // yet on the very first tick, but the shared mutation observer keeps
      // re-evaluating until it is.
      injectAttachmentChips();
      // Fire-and-forget (2026-08-19) — proactively checks whether any
      // eligible attachment is already saved as a document elsewhere
      // (a different clinician, a different computer, Medicus's own native
      // upload), so a chip can show the non-blocking "check before saving"
      // hint before it's ever clicked. Does NOT disable the chip (a wrong
      // guess must never block a genuine save). Cheap to call every tick:
      // internally guards both the one-off bulk journal fetch and each
      // attachment's own check, so a repeat call after the first is a
      // fast no-op unless a genuinely new attachment has appeared.
      ensureSavedDocumentCheck();
      // If a form is open, make sure it's still mounted and still sitting
      // right after its chip — SPA churn can detach either.
      if (s.open && s.activeFilename) {
        mountWidgetIfNeeded();
        positionWidgetAfterChip(s.activeFilename);
      }
    });
  }

  // Kicked off at boot, fire-and-forget — a local extension resource fetch,
  // not a Medicus call, so this overlaps with the clinician reading the task
  // before ever opening the widget rather than adding latency to doOpen().
  ensureDocumentTypesLoaded();

  var _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(onMutations);
  } else {
    _obs = new MutationObserver(onMutations);
    observeBody();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleInject();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInject);
  } else {
    scheduleInject();
  }
})();
