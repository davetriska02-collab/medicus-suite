# Investigation: timestamp fields for per-entry GP2GP duplicate detection

**Status (2026-07-02, in progress):** live investigation into whether a genuine
per-entry (not just per-day) timestamp is available via the Medicus API, to
refine `engine/record-duplicate-parser.js` beyond its current day-level
`(date, code)` grouping — specifically to (a) corroborate that a candidate
group really is a GP2GP/migration duplicate, and (b) decide which of a
duplicate pair is the "keeper" vs. the reimport artifact, for the tiered
bulk-remove/merge recommendation in `duplicate-checker.js`.

Three patients sampled so far (see `project_duplicate-checker-cleansing-plan`
memory for full session history) — **not yet implemented in code**, this is
findings only.

---

## Endpoints involved

- **Bulk journal:** `GET /clinical/data/patient-journal/overview/{patientId}`
  (documented in `docs/learnings-patient-journal-api.md`) — day-grouped.
  `entry.createdDateTime` is **always** `null`/`undefined` here, for every
  entry type checked. `encounter.data.startTime` is time-only (e.g. `"08:54"`,
  no date component); `endTime` was `null` in every sample seen.
- **New this session — per-entry detail/"card" endpoints**, fetched only when
  a user opens an individual entry in the Journal UI (NOT present in the bulk
  payload at all):
  - `GET /clinical/data/note/overview/{noteId}` — **confirmed** live.
  - Equivalent `.../overview/{id}` endpoints for prescription,
    investigation-request, document etc. are presumed to exist (matches the
    same convention as the already-shipped
    `/clinical/data/encounter/overview/{encounterUuid}` in
    `engine/api-client.js`), but **not yet individually confirmed** — the
    prescription examples below were read from the note-equivalent view for
    a prescription entry, field names may differ slightly per type.

## Field behaviour — what's stable vs. what's a batch artifact

### Stable across every copy, every hop — trustworthy for matching

- Note: `recordDate`
- Prescription: `authorisedDate`, `startDate`

**General rule:** whatever field represents the clinical/business date of the
event survives re-transfer intact. This is what the parser's existing
`(date, code)` grouping key already relies on (via the journal's day-group
`title`) — so the existing grouping logic is validated by this investigation,
not changed by it.

### NOT stable — system timestamps that become batch artifacts

- `created` / `createdDateTime`
- `createdInOriginalSystemDateTime` — despite the name, only trustworthy on
  records that have been through **exactly one** hop (see finding 3 below).

## Examples gathered

### Patient A — GP2GP inter-practice transfer

Three notes checked, spanning two consultations (`recordDate` 2024-02-23 ×2,
2024-01-30 ×1):

| | Original | Duplicate |
|---|---|---|
| `recordDate` | 2024-02-23 / 2024-02-23 / 2024-01-30 | same, in all 3 |
| `created` | 2024-09-28 00:29:55 (all 3, identical) | 2026-02-03 09:04:43 (all 3, identical) |
| `createdInOriginalSystemDateTime` | 08:04:54 / 08:58:30 / 10:08:57 (all 2024, all different — genuine per-note times) | 2026-01-20 01:11:30 (all 3, identical) |
| `recordedBy` | "Dr Nicholas Grundy at The Park Road Surgery" | "Dr Nicholas Grundy" (org suffix dropped) |

### Patient B — Vision→Medicus system migration, then a later GP2GP-style re-registration reimport

Practice's actual Vision→Medicus go-live date independently confirmed by the
user as matching the cluster below.

| | Original | Duplicate |
|---|---|---|
| Prescription 1 — `authorisedDate`/`startDate` | 2024-11-18 | 2024-11-18 |
| Prescription 1 — `createdDateTime` | 2024-11-18 17:10:45 (genuine) | 2025-10-23 10:04:22 |
| Prescription 1 — `createdInOriginalSystemDateTime` | 2024-11-18 17:10:45 (genuine, matches `createdDateTime`) | 2025-10-23 10:04:22 |
| Prescription 2 — `authorisedDate`/`startDate` | 2023-06-27 | 2023-06-27 |
| Prescription 2 — `createdDateTime` | 2024-09-28 00:15:19 (migration batch stamp) | 2025-10-23 10:04:22 |
| Prescription 2 — `createdInOriginalSystemDateTime` | 2023-06-27 13:08:43 (genuine) | 2025-10-23 10:04:22 |
| Consultation — `recordDate` | 2024-09-26 | 2024-09-26 |
| Consultation — `created` | 2024-09-28 00:15:18 (migration batch stamp) | 2025-10-23 10:04:22 → later corrected, see below |
| Consultation — `createdInOriginalSystemDateTime` | 2024-09-26 08:30:40 (genuine) | 2025-10-21 23:20:36 |
| `recordedBy` | "...at The Park Road Surgery" | org suffix dropped, both examples |

Patient's registration history (confirmed by user): **deregistered
2025-10-21, re-registered 2025-10-23** — the two duplicate-side timestamps
above (`2025-10-21 23:20:36` and `2025-10-23 10:04:22`) map precisely onto
those two real dates.

### Patient C — deregistered 2025-09-25, re-registered 2025-10-23

**Investigation result (U&Es, recordDate 2022-12-14) — NOT duplicated**,
despite this patient going through the same kind of dereg→re-reg cycle that
produced duplicates for Patient B's notes/prescriptions. Full field set
(top-level item + nested `investigationReport`):

| Field | Value | Likely meaning |
|---|---|---|
| top-level `createdInOriginalSystemDateTime` | 2022-12-14 14:30:46 | matches nested `receivedDateTime` exactly |
| `issuedDateTime` | 2022-12-14 12:51:00 | lab issues the report |
| `receivedDateTime` | 2022-12-14 14:30:46 | practice's system receives it |
| nested `createdInOriginalSystemDateTime` | 2022-12-14 15:27:34 | ~57 min after received; matches `filingDateTime` exactly |
| `filingDateTime` | 2022-12-14 15:27:34 | staff filing action |
| `recordDate` | 2022-12-14 | stable business date |
| nested `createdDateTime` | 2024-09-28 01:43:14 | Vision migration batch stamp — same date as Patient B's, ~1hr later in the batch window |

Two document examples, both duplicated:

| | Document (16 Aug 2025) — Original | Duplicate | 2WW referral (23 Jul 2025) — Original | Duplicate |
|---|---|---|---|---|
| `careRecordEntryDate` | Sat 16 Aug 2025 | Sat 16 Aug 2025 | Wed 23 Jul 2025 | Wed 23 Jul 2025 |
| `documentDate` | 16 Aug 2025 | 16 Aug 2025 | **null** | 23 Jul 2025 |
| `recordDate` | 2025-08-20 | 2025-08-16 (mismatch) | 2025-07-23 | 2025-07-23 (match) |
| `createdDate` | 2025-08-20 16:30:56 | 2025-10-23 14:13:53 | 2025-07-23 14:33:47 | 2025-10-23 14:13:52 |
| `createdInOriginalSystemDateTime` | = `createdDate` | = `createdDate` | = `createdDate` | = `createdDate` |
| `filedDateTime` | 2025-09-02 17:47:09 | 2025-09-25 02:37:12 | 2025-07-23 14:34:47 | 2025-09-25 02:37:12 |

The 2WW referral duplicated as **multiple separate document entries** — the
referral form and every attachment that went with it, each an independent
"document"-type item, not one wrapper. Per the user: these won't match
anything in the original EPR since attachments like this likely only ever
existed in ERS (the e-Referral Service), not the source clinical system —
flagged as a case needing manual cleanup regardless of what the tool detects.

Also confirmed: the document wrapper-level API call (separate from the one
carrying the dates above) shows `typeLabel: "Other digital signal"` on
**every** duplicated document for this patient (not just the first one
noticed) — a possible cheaper, more direct duplicate signal than
timestamp-clustering, if it holds across other patients too. Same
system/EPR-specificity caveat as everything else here — consistent within
one patient, not yet cross-patient confirmed.

## Key findings

1. **`created`/`createdDateTime` on original (never re-transferred) records
   is a shared batch timestamp** reflecting the bulk onboarding/migration
   event — confirmed identical to the second across different patients'
   original records from the same practice migration (`2024-09-28
   00:15:18`–`00:29:55`), independently corroborated by the user's own
   knowledge of the practice's real Vision→Medicus go-live date.
2. **`createdInOriginalSystemDateTime` is genuine (non-batch) on original
   records** — consistently matches the real per-record authoring time in
   every example checked, *even on the same record* where `createdDateTime`
   is the batch stamp instead (Patient B, Prescription 2). So on
   never-re-transferred records, `createdInOriginalSystemDateTime` is the
   more trustworthy of the two fields.
3. **Once a record is duplicated via a second transfer/registration event,
   BOTH `created`/`createdDateTime` AND `createdInOriginalSystemDateTime`
   collapse into shared batch artifacts on the duplicate copy** — despite the
   field name's promise, it no longer reflects the true original
   authoring time once a record has passed through more than one hop.
4. **Duplicate-side batch stamps are shared per entry type within one
   reimport, and different entry types can carry different stamps within the
   *same* reimport event** — in Patient B, duplicated prescriptions (×2)
   clustered on the re-registration date/time; the duplicated consultation
   clustered on the deregistration date/time instead. Best explanation so
   far: different clinical-data sections of a GP2GP transfer get
   finalised/ingested at different points in the transfer pipeline (e.g.
   consultations captured at the outgoing/dereg side, medications
   reconciled at the incoming/re-reg side) — **strengthened by Patient C**,
   where a single duplicated *document* shows this split within itself:
   `filedDateTime` on the duplicate matches the deregistration date/time
   (2025-09-25) while `createdDate`/`createdInOriginalSystemDateTime` on the
   same duplicate matches the re-registration date/time (2025-10-23) — same
   split, now within one entry rather than only across entry types.
5. **Secondary, weaker signal:** `recordedBy` drops the practice-organisation
   suffix on the duplicate copy in every example seen so far (e.g. "Dr X at
   The Park Road Surgery" on the original vs. plain "Dr X" on the duplicate).
6. The mechanism producing a shared "created" batch timestamp is not
   GP2GP-specific — Patient B's original-side batch cluster came from a
   **Vision→Medicus system migration**, not a GP2GP inter-practice transfer,
   and produced the identical artifact (a shared timestamp across many
   records from one bulk-load event).
7. **`recordDate` is not reliably stable for the `document` entry type**,
   unlike notes/prescriptions — it mismatched between original and duplicate
   in one Patient C example (2025-08-20 vs 2025-08-16) and matched in
   another (2025-07-23 vs 2025-07-23). `careRecordEntryDate` (and, when
   populated, `documentDate`) matched cleanly in every document example
   instead — likely the more trustworthy business-date anchor for this
   entry type specifically, not `recordDate`.
8. **A duplicate can occasionally carry *more* complete data than the
   original**, not less — Patient C's 2WW referral duplicate has a populated
   `documentDate` ("23 Jul 2025") where the original has `null`. Exception to
   the general pattern that duplicates are the degraded copy (e.g. the
   `recordedBy` org-suffix drop) — worth not over-fitting "which copy looks
   more complete" as a keeper heuristic.
9. **Not every entry type duplicates under the same dereg/re-reg event** —
   Patient C's investigation result (U&Es) did not duplicate at all, despite
   notes/prescriptions/documents all duplicating for the same or similar
   registration cycles. Plausible explanation: structured results (lab data)
   likely carry their own unique identifier GP2GP/Medicus can use to
   recognise "already have this," while free-text notes and documents don't
   have an equivalent anchor. **n=1 patient — needs confirming or refuting
   with another patient's investigation results before treating as a real
   rule** (this would also retroactively justify why
   `record-duplicate-parser.js` already excludes investigation-type entries
   from tiering, per its file-header comment).
10. **Operational, not just data, complication:** a duplicated 2WW referral
    can produce multiple separate duplicated `document` entries (the referral
    form plus every attachment), rather than one document duplicating
    cleanly — per the user, these attachments may only ever have existed in
    ERS (the e-Referral Service) and won't have an equivalent in the original
    source EPR to reconcile against, meaning some duplicate clusters may need
    manual cleanup regardless of what detection logic is built.
11. **Possible additional signal:** the document wrapper-level API response
    (a separate call from the one carrying the date fields above) shows
    `typeLabel: "Other digital signal"` on **every** duplicated document
    checked for Patient C — consistent within-patient, not a one-off. If
    this holds across other patients too, it would be a more direct duplicate
    marker than inferring from timestamp clustering. Not yet cross-patient
    confirmed, and carries the same system/EPR-specificity caveat as
    everything else in this document.

## Implication for the duplicate-checker tool (not yet decided/implemented)

- The existing `(date, code)` grouping key in `groupAndTier()` is validated,
  not changed, by this investigation — it already effectively keys on the one
  stable clinical-date field via the journal's day-heading.
- `recordDate`/`startDate`/`authorisedDate` is the field to trust for
  confirming a match for notes/prescriptions; for documents, prefer
  `careRecordEntryDate`/`documentDate` instead, per finding 7.
- `created`/`createdDateTime`/`createdInOriginalSystemDateTime`
  should **not** be used to decide whether two entries are duplicates.
- Those system timestamps could still be useful on the duplicate side, just
  for a different purpose:
  - as a **keeper vs. reimport-artifact tie-breaker** (earliest `created`
    wins, in every example seen so far — n=2 patients, not yet enough to
    treat as a firm rule), and/or
  - as **corroborating evidence** that a candidate group really is a
    GP2GP/migration artifact, if the timestamp lines up with an
    independently-checkable registration or migration milestone.
- Getting these fields at all requires a **new per-entry API call**
  (`note/overview/{id}` or equivalent) not present in the bulk journal
  payload — i.e. a second pass, fetched only for already-flagged candidate
  entries, following the same pattern as the existing `runSecondPass()`
  problem-listing date-match check in `duplicate-checker.js`.
- **Nothing above has been implemented in code yet.** Still gathering
  examples before any design decision is made.

## Update 2026-07-04 — `id` is UUIDv7: the timestamp we were chasing is already in the bulk payload

**Major finding, live-confirmed on Patient C (this doc's Patient C, re-verified this session):** `item.id` / `entry.id` throughout the journal payload are **UUIDv7** — the first 48 bits are a millisecond Unix timestamp, decodable client-side with no extra request:

```js
new Date(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toISOString()
```

The "16 Aug 2025" document pair's **original** copy (`0198c81a-cc26-73fb-af8e-2bd734cfe431`) decodes to `2025-08-20T15:30:56.166Z` — matching this same doc's earlier live capture of `createdDate: 2025-08-20 16:30:56` (BST) **to the second**. So the id already encodes the same signal as `createdDate`/`createdInOriginalSystemDateTime`, but it's present in the bulk `patient-journal/overview` response already — no per-entry `/note/overview/{id}`-style second-pass fetch needed to get a keeper-vs-duplicate timestamp. This should simplify the "keeper vs. reimport-artifact tie-breaker" design noted in `project_duplicate-checker-cleansing-plan` memory.

**Batch-clustering re-confirmed, this time cross-checked against an independent Medicus record:** every document entry on this patient carrying the id-prefix `019a1134...` — across many different real-world clinical dates (31/26/19/4 Aug, 25/24/23/21/18 Jul) — decodes to the same ~7-second window, `2025-10-23T13:13:49–56Z` (14:13–14:13:56 BST). The user independently checked this patient's registration tasks: the "complete registration" task was created **2025-10-23 at 14:10 BST**, ~3–4 minutes before this id-cluster. Strong corroboration that the id-timestamp cluster marks the real reimport-processing moment, from a source entirely outside the journal payload.

**Nesting is NOT a reliable "which copy is the duplicate" signal — the id-timestamp is.** On the same patient: the 16 Aug pair is FLAT+FLAT (both top-level `document` items); several July entries pair a NESTED original (id-time matches the real clinical date, e.g. `2025-07-23T13:31:53Z` for a 23 Jul entry) against a FLAT duplicate (id-time in the `2025-10-23` reimport cluster). So whether an entry is flat or nested varies per document — but the decoded id-timestamp reliably separates original from reimport-artifact regardless.

**Root-cause reasoning (user, 2026-07-04 — parked, not yet investigated further):** this is unlikely to be a pure GP2GP-transport bug, because a transport-level duplication would compound with every hop (1 copy → 2 → 3/4 across repeated transfers), but every example found so far — across multiple patients and multiple dereg/re-reg cycles — shows exactly 2 copies, never more, regardless of transfer history. More likely explanation: something in how Medicus (or the sending EPR) processes/re-files the inbound GP2GP payload specifically at the point of completing a re-registration — possibly connected to the per-entry-type batch-clustering already documented above (finding 4). **Explicitly parked for a later session, not investigated yet.**

**Open gap, not yet resolved:** flat top-level `document` items have `title`/`descriptionText` as real keys (confirmed via `Object.keys`), but the *value* is `null` in every example seen so far. The actual identifying content likely lives inside `item.data` (unexplored — appeared as collapsed `{…}` in a console dump, not yet expanded). By contrast, nested document entries (`entryType: 'document'`/`'fit-note'` inside `consultationTopics[].headings[].entries[]`) carry rich fields directly on the entry object, confirmed live 2026-07-04:
```
entryType, id, documentTypeLabel, filingStatus, documentAuthorDepartment,
organisationName, clinicalSpeciality, title, documentDate,
documentDateIsNotEncounterDate, hasPlaceholderFile, additionalInformation,
isMarkedIncorrect, hiddenFromPatientFacingServices, confidentialFromThirdParties,
isRetrospectivelyAmended, isLocalOrganisation, careRecordElements,
linkedProblems, createdDateTime, matchesFilters
```
`documentDate` here corroborates finding 7 above (business-date anchor for documents).

**Gap closed, same session:** `item.data` for a flat `document` item has the **identical 21-key shape** to the nested entry above (`entryType, id, documentTypeLabel, filingStatus, documentAuthorDepartment, organisationName, clinicalSpeciality, title, documentDate, documentDateIsNotEncounterDate, hasPlaceholderFile, additionalInformation, isMarkedIncorrect, hiddenFromPatientFacingServices, confidentialFromThirdParties, isRetrospectivelyAmended, isLocalOrganisation, careRecordElements, linkedProblems, createdDateTime, matchesFilters`). So flat and nested documents share one content shape; flat items just wrap it one level down under `.data` instead of exposing it directly on the item. **Confirmed bug in the shipped code:** `record-duplicate-parser.js`'s current flat-`document` branch keys on `item.title`/`item.descriptionText` directly (always `null`) instead of `item.data.title`/`item.data.documentTypeLabel`/`item.data.documentDate` — meaning the flat-document matching implemented 2026-07-02 has never actually had real content to key on, for any patient, not just this one. **Not yet fixed — needs a code change, on hold pending go-ahead** (see [[feedback_wait-for-live-testing]]).

## Update 2026-07-04 — fixes verified against re-run scans (Patients 1/2/3)

Both fixes above (`item.data`-based document field reading + nested `document`/`fit-note` branch, and the UUIDv7 `keeperEntryId` tie-breaker) landed in `record-duplicate-parser.js`, 31/31 parser tests passing. Re-running "Analyze full record for duplicates" on the three reference patients:

| Patient | Problem duplicates (unchanged, separate code path) | Candidate groups before | after |
|---|---|---|---|
| 1 | 22 | 227 | 239 |
| 2 | 84 | 84 | 89 |
| 3 | 19 | 205 | 219 |

Problem-duplicate counts are unchanged as expected — `detectDuplicates()`/`runSecondPass()` are a separate code path (`problem/listing` endpoint) untouched by this fix.

**Patient 3 tier breakdown, before → after: 170/19/16 → 177/19/23 exact/high/review.** The whole +14 splits as +7 EXACT, +0 HIGH, +7 REVIEW — genuine new high-confidence matches plus messier real cases correctly flagged for manual review, not silently missed or wrongly auto-approved. Good signal the fix is behaving as intended rather than just adding noise.

**Direct confirmation of finding 11, from a different route than originally found:** finding 11 above noted `typeLabel: "Other digital signal"` on every duplicated document, but only via a *separate* document-wrapper-level API call. Post-fix, the 23 Jul 2025 cluster (4 "Referral Letter"-content entries + 1 "2WW Pan London..." entry) grouped together as ONE REVIEW-tier candidate under `documentTypeLabel: "Other digital signal"` — the *same* generic label is present directly in the bulk journal payload's `documentTypeLabel` field, not just the separate wrapper endpoint. Grouped-but-REVIEW (not falsely EXACT) is correct here: shared generic label, differing actual content — this is the known "2WW referral + every attachment duplicates separately" case, now correctly surfaced as one cluster for human review instead of not matching at all.

**Open, deliberately parked (2026-07-04):** the specific 16 Aug 2025 document pair examined earlier this doc does **NOT** appear in Patient 3's post-fix candidate list at all. We never captured `item.data` for those two specific ids (`019a1134-5464-...` / `0198c81a-cc26-...`) — only for an unrelated sample document (`documentTypeLabel: 'Consultation report'`) — so it's not yet known whether they fail to group because their `documentTypeLabel`/`title` genuinely differ between copies, or some other reason (e.g. a `recordDate`-style day-title mismatch, per finding 7). **Next step when resumed:** dump `item.data` for those two specific ids directly and compare.

## Open questions

- Does the per-entry-type batch-clustering (finding 4) hold across more
  entry types and more patients, or was the prescription/consultation/
  document split coincidental to these two patients' histories? (Now backed
  by within-single-entry evidence from Patient C's document, not just
  cross-entry-type — but still only 2 patients.)
- **Resolved for documents:** documents do carry a `createdInOriginalSystemDateTime`,
  but unlike notes it's always identical to `createdDate` on both original and
  duplicate copies — no independent second value the way notes/prescriptions
  sometimes show. **Still open for investigation-request specifically**,
  since the one example found wasn't duplicated, so no original-vs-duplicate
  comparison was possible for that type yet.
- What's the exact `.../overview/{id}` endpoint URL and field names for each
  entry type? Confirmed: note. Still to confirm: prescription (read via the
  note-equivalent view so far, not a dedicated confirmed endpoint),
  investigation-request, document (URL not yet captured — dates came from
  console output, not a pasted URL).
- Is the `recordedBy` org-suffix drop (finding 5) reliable enough to use as a
  secondary signal, or could a genuine non-duplicate entry also lack it for
  an unrelated reason (e.g. a locum with no listed organisation)?
- Does `typeLabel: "Other digital signal"` (finding 11, confirmed on every
  duplicated document within Patient C) hold for other patients too, and
  does it ever appear on a genuine (non-duplicate) document?
- Does the "not every entry type duplicates" finding (9) hold for a second
  patient's investigation results, or was Patient C's case a one-off?
