# Learnings: document-filing "Codes & actions" + creating a new Problem

Confirmed 2026-08-12 via two live HAR captures on a test patient
(`66-adding-codes-to-document.har`, `67-adding-problem-to-record.har`):
adding two coded entries to a document, then manually creating one Problem
from one of them via Medicus's own "New Problem" modal. Captured to unblock
the "Add as problem?" checkbox widget
(`content-scripts/document-codes-to-problems.js`) — same discipline as every
other `docs/learnings-*.md` here: never construct Medicus API URLs or
payload shapes from scratch, capture and replay.

This is new ground for the repo on two fronts: nothing had previously read
the "Codes & actions" task-overview surface, and nothing had previously
*created* a new Problem — every prior problem-write path
(`content-scripts/problem-description-cleanup.js`,
`content-scripts/problem-bulk-end.js`, `content-scripts/problem-nesting.js`)
only edits an existing one via `edit-problem`/`{problemId}`.

## Confirmed contract

### 1. Document-filing task overview — `GET /tasks/data/document/overview/{taskUuid}`

Same shape as every other `/tasks/data/{typeSlug}/overview/{taskUuid}` call
already used by `task-inline.js`/`document-file-inline.js`/
`booking-inline.js` — called bare, no query string needed (the
`?viewContext=...&statuses[]=...` seen in the capture is the page's own
list-context breadcrumb, confirmed non-required by the established
precedent in those three files).

```json
{
  "data": {
    "patient": { "id": "{patientId}", "displayName": "...", "deceased": false },
    "inboundDocument": {
      "id": "{documentId}",
      "typeLabel": "Discharge letter",
      "documentDate": null,
      "recordDate": "2026-07-20",
      "createdDate": "2026-07-20 14:03:33",
      "createdInOriginalSystemDateTime": "2026-07-20 14:03:33",
      "linkedProblems": []
    },
    "codesAndActions": [
      {
        "code": "Inflammatory bowel disease",
        "id": "{noteId}",
        "type": "note",
        "onClickUrl": "/clinical/data/note/edit-note/{noteId}",
        "text": "Inflammatory bowel disease",
        "isMarkedIncorrect": false,
        "isFinalised": false,
        "disabled": false
      },
      {
        "code": "Shared care prescribing",
        "id": "{noteId2}",
        "type": "note",
        "text": "Shared care prescribing: Octasa",
        "isMarkedIncorrect": false,
        "isFinalised": false,
        "disabled": false
      }
    ],
    "codesAndActionsOptions": [
      { "type": "allergy", "label": "Allergy", "url": "..." },
      { "type": "appointment", "label": "Appointment", "url": "..." },
      { "type": "communication", "label": "Communication", "url": "..." },
      { "type": "medication-administration", "label": "Drug/device administration", "url": "..." },
      { "type": "firearm-license", "label": "Firearm license", "url": "..." },
      { "type": "fit-note", "label": "Fit note", "url": "..." },
      { "type": "future-action", "label": "Future action/recall", "url": "..." },
      { "type": "immunisation", "label": "Immunisation", "url": "..." },
      { "type": "investigation-request", "label": "Investigation request", "url": "..." },
      { "type": "medication-statement-prescribed-elsewhere", "label": "Medication prescribed elsewhere", "url": "..." },
      { "type": "medication-review", "label": "Medication review", "url": "..." },
      { "type": "note", "label": "Note", "url": "..." },
      { "type": "observation", "label": "Observation", "url": "..." },
      { "type": "medication-statement-over-the-counter", "label": "Over-the-counter medication", "url": "..." },
      { "type": "prescription", "label": "Prescription", "url": "..." },
      { "type": "procedure", "label": "Procedure", "url": "..." },
      { "type": "outbound-referral", "label": "Referral", "url": "..." },
      { "type": "routine-observations", "label": "Routine observations", "url": "..." },
      { "type": "task", "label": "Task", "url": "..." },
      { "type": "template", "label": "Template", "url": "..." }
    ]
  }
}
```

**Confirmed: no "problem" entry anywhere in `codesAndActionsOptions`** —
Medicus itself has no add-as-problem action from a document at all. The
checkbox widget fills a genuine gap, not a duplicate of an existing feature.

**Date fields**: `documentDate` was `null` in this real capture (a test
document); `recordDate` was always populated. `createdDate`/
`createdInOriginalSystemDateTime` are filing/migration timestamps, not the
clinical event date — never used for onset-date derivation (same reasoning
as `docs/learnings-patient-journal-api.md`'s treatment of `createdDate` on
journal notes). Confirmed order of preference (Nick, 2026-08-12): prefer
`documentDate`, fall back to `recordDate` only when `documentDate` is null
— `documentDateSource()` in `document-codes-to-problems.js`.

**`codesAndActions[].text`** is `"{code}: {noteText}"` when the underlying
note has free text beyond its code, else just `"{code}"` (see the two real
entries above) — lets the checkbox list show a text preview from data
already in hand, no extra fetch. **Not used for the actual write** — the
real free text/code ids are always re-fetched fresh via `note/edit-note`
immediately before creating a problem (see below).

### 2. Per-entry detail — `GET /clinical/data/note/edit-note/{noteId}`

The SAME endpoint already confirmed and used by the journal-code-sync
feature's `fetchEditNoteForm`
(`content-scripts/problem-description-cleanup.js`) — see
`docs/learnings-journal-note-edit-api.md` for the full contract. Relevant
fields here: `note` (free text, e.g. `"Octasa"`), `noteSNOMEDct:
{conceptId, description, descriptionId}`. The task-overview's own
`codesAndActions[].code` is a plain display string with no ids — this fetch
is the only source of the `conceptId`/`descriptionId` the create-problem
write needs.

### 3. Create-problem prefill — `GET /clinical/data/problem/create-problem/{patientId}`

```json
{
  "patientId": "{patientId}",
  "significances": [{ "value": "major", "label": "Major" }, { "value": "minor", "label": "Minor" }],
  "episodes": [{ "value": "first", "label": "First" }, { "value": "subsequent", "label": "Subsequent" }],
  "defaultDateToEnd": "2026-09-09",
  "contextId": null,
  "contextType": null,
  "problemStatuses": [{ "value": "active", "label": "Active" }, { "value": "ended", "label": "Ended" }],
  "localOrganisation": "Park Road Surgery",
  "recordAuthor": "Dr Nicholas Grundy at Park Road Surgery",
  "recordDate": "2026-08-12",
  "recordedByStaff": "{staffId}",
  "staff": [{ "value": "{staffId}", "label": "..." }],
  "existingProblems": [
    { "label": "Ascaridiasis (Onset 01 Jan 2000)", "value": { "description": "Ascaridiasis", "descriptionId": "481892013", "conceptId": "2435008" } }
  ]
}
```

`recordedByStaff` is the current clinician's own staff id, pre-resolved —
no separate "who am I" lookup needed. `recordDate` is today. `existingProblems`
is the patient's full current problem list in the exact `{description,
descriptionId, conceptId}` shape needed to build a create-problem payload
directly — used for the exact-code duplicate check (below), not exposed
anywhere else in this repo until now.

### 4. Create-problem write — `POST /clinical/problem/create-problem`

```json
{
  "patientId": "{patientId}",
  "problemCodeId": "415522008",
  "problemCodeDescription": "Shared care prescribing",
  "problemCodeDescriptionId": "2534089011",
  "significance": "major",
  "onsetDate": null,
  "automaticallySetToEndedOnDate": null,
  "episode": null,
  "additionalInformation": "Octasa",
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "problemStatus": "active",
  "recordDate": "2026-08-12",
  "recordedByOrganisation": null,
  "recordedByPractitioner": null,
  "recordedByStaff": "{staffId}",
  "contextId": null,
  "contextType": null
}
```

Response: `200 {}` — same bare-object shape as `edit-problem`'s and
`change-note`'s own POSTs.

**Confirmed mapping from the manual capture** (the "same information in"
Nick asked for): the code that was added to the document
(`problemCodeId`/`Description`/`DescriptionId`, from the note's
`noteSNOMEDct`) became the problem's own code; the note's free text
(`"Octasa"`) became `additionalInformation`. `onsetDate` was sent `null` in
this manual capture — the clinician didn't backfill it from the document
date by hand, which is exactly the gap the widget's automatic
`documentDateSource()` derivation closes. `recordDate` was today (the date
the PROBLEM RECORD was authored), deliberately different from `onsetDate`
(the date the CLINICAL EVENT happened) — the widget preserves this same
split, never conflating the two.

**Confirmed: no structural link back to the source document.**
`contextId`/`contextType` were both `null` in the real POST even though the
"New Problem" modal was opened from the document task — Medicus's own
manual flow doesn't link the new problem back to its source document
either. Nothing to replicate; any future document↔problem cross-reference
would have to be text/date-based, not a structural id.

### 5. Confirmed from the decoded `.vue` source (`create-problem.vue`)

Medicus serves its own Vue SFCs as literal source text (same technique
`docs/learnings-triage-attachment-to-document.md` §1 used for
`create-inbound-document-form.vue`) — `GET
/clinical/ui/problem/create-problem.vue`, base64-decoded in the capture.
Confirms two **non-blocking warnings** the widget mirrors exactly:

- **`checkProblemExists(conceptId)`** — exact match against
  `existingProblems[].value.conceptId`. If found: sets `episode:
  'subsequent'` and shows "There is already an active problem for this
  clinical code in the patients problem list." Doesn't block creation.
  `problemAlreadyExists()` in `document-codes-to-problems.js`.
- **`checkIsAllergyRelated(concept)`** — searches
  `clinical/gb/snomed/search/description/constrained?outputParentConceptIds=1&constrainingParentConcepts=420134006,281647001&query={description}`
  and warns "The chosen code is an allergy code. It is not recommended to
  create problem records for allergies…" if `concept.description` appears
  as an exact `label` match in the results. Doesn't block creation.
  `isAllergyRelatedCode()` in `document-codes-to-problems.js`.

Also confirmed from the source: `onsetDate` has `:max-date="new
Date().toDateString()"` — "Onset date cannot be in the future." The widget
defensively clamps its derived onset date to today (`clampToToday()`) in
case a GP2GP-imported document date is malformed, even though this hasn't
been observed live.

## Open questions — not yet confirmed

- What Medicus does with a populated `contextId`/`contextType` on
  create-problem (both fields exist in the `.vue` component's `data()` but
  were `null` throughout this capture, and nothing in the template actually
  sets them from the document context they were opened from) — not guessed
  at, the widget sends both `null`.
- Whether `significance: 'minor'` behaves differently in any way relevant
  to this widget — the capture only exercised `'major'` (the default), which
  is also this widget's own fixed default (no code-derived signal exists to
  choose otherwise).
- The **date-proximity duplicate check** Nick asked to defer to a follow-up
  pass (checking for an existing problem near the document's date, not just
  an exact code match) — not investigated yet; `existingProblems` doesn't
  carry a full onset date in a machine-parseable form on every entry (only
  inside the free-text `label`, e.g. `"(Onset 01 Jan 2000)"`), so this would
  need either a parse of that label or a separate per-problem fetch —
  unresolved design question for that follow-up, not this capture.
