# Learnings: editing a journal note's code (`clinical/note/change-note`)

Confirmed 2026-08-13 via three real HAR captures on the live patient record
(Nick's own edits, in Medicus's own UI): editing a note's free text, editing
its code via search, and editing an "orphan" note not inside a consultation.
Captured to unblock the journal-code-sync write path (`applyToJournal` in
`content-scripts/problem-description-cleanup.js`) — same discipline as every
other `docs/learnings-*.md` in this repo: never construct Medicus API URLs
or payload shapes from scratch, capture and replay.

## Confirmed contract

### 1. Prefill — `GET /clinical/data/note/edit-note/{noteId}`

```json
{
  "noteId": "{noteId}",
  "note": "classic visual symptoms with subsequent headache",
  "noteSNOMEDct": { "conceptId": "4473006", "description": "Migraine with aura", "descriptionId": "7595017" },
  "isDraft": false,
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "isMarkedAsIncorrect": false,
  "allowEditLinkedProblems": false,
  "excludeConsentCodes": ["773051000000102", "..."],
  "patientId": "{patientId}",
  "recordDate": "2024-10-30",
  "recordedAtAnotherOrganisation": false,
  "organisationEntry": "searchable",
  "recordedByOrganisation": null,
  "recordedByOrganisationManual": null,
  "recordedByPractitioner": "Dr Nicholas Grundy",
  "recordedByStaff": "{staffId}",
  "linkedProblemIds": [],
  "linkableProblems": [
    { "value": "{problemId}", "label": "Migraine with aura (Onset unknown)", "conceptId": "4473006", "hasEnded": false, "startDate": "...", "endedDate": null, "isMarkedIncorrect": false, "hiddenFromPatientFacingServices": false, "confidentialFromThirdParties": false }
  ],
  "contextType": "consultation-topic-heading",
  "contextId": "{topicHeadingId}",
  "flagOnPatientBanner": false,
  "riskContextIds": { "risk-to-self": ["..."], "risk-to-others": ["..."], "risk-from-others": ["..."] },
  "localOrganisation": "Park Road Surgery",
  "staff": [{ "label": "...", "value": "..." }],
  "flags": [],
  "flagOptions": [{ "value": "risk-to-self", "label": "Risk to self" }],
  "linkedClinicalCase": { "options": [], "defaultClinicalCaseId": null, "requiresClinicalCase": false }
}
```

**A DIFFERENT endpoint from `GET /clinical/data/note/overview/{noteId}`**
(the read-only display endpoint, already used by the journal-duplicate
detection feature's date-verification step — see
`shared/journal-problem-matching.js`'s `resolveVerifiedDateMatch`). Same
`noteSNOMEDct`-carrying shape in spirit as `note/overview`'s own
`noteSNOMEDctCode`, but a different field name (`noteSNOMEDct`, no `Code`
suffix) and a materially different surrounding shape (this one is the full
edit-form prefill: `linkableProblems`, `staff`, `riskContextIds`,
`flagOptions`, `excludeConsentCodes` etc. — form-UI scaffolding, not present
on the read-only overview).

`linkedProblemIds` here is a **plain array of ids** (`["p1", "p2"]`) — a
DIFFERENT shape from the bulk `patient-journal/overview` payload's
`linkedProblems` (`[{id, problemCodeDescription}]` objects). Don't conflate
the two when reading either.

**`contextType`/`contextId`**: `"consultation-topic-heading"` + an id when
the note sits inside a consultation; both `null` for a standalone/"orphan"
note (confirmed via the orphan-note capture, `noteId`
`01998559-2f40-7019-8e69-8a08408ac820`). **Confirmed irrelevant to the
write** — see below, neither field appears in the POST body at all,
regardless of which case it is.

### 2. Write — `POST /clinical/note/change-note`

**Writable-subset full replace** — confirmed byte-for-byte identical field
set across all 3 captures (editing free text only, editing the code, and
the orphan-note case), every field resent regardless of what changed:

```json
{
  "noteId": "0192dcca-b742-7000-95f9-864602e9e715",
  "note": "classic visual symptoms with subsequent headache test addition",
  "noteSNOMEDct": { "description": "Migraine with aura", "conceptId": "4473006", "descriptionId": "7595017" },
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "flagOnPatientBanner": false,
  "recordedByOrganisation": null,
  "recordedByPractitioner": "Dr Nicholas Grundy",
  "recordedByStaff": "0192351f-fd7f-725c-a267-2120c486b6be",
  "recordDate": "2024-10-30",
  "flags": [],
  "clinicalCaseId": null,
  "linkedProblemIds": []
}
```

Response: `200 {}` — same shape as `edit-problem`'s own POST.

**Fields present on the GET prefill but confirmed NOT part of this POST**:
`isDraft`, `isMarkedAsIncorrect`, `allowEditLinkedProblems`,
`excludeConsentCodes`, `patientId`, `recordedAtAnotherOrganisation`,
`organisationEntry`, `recordedByOrganisationManual`, `linkableProblems`,
`contextType`, `contextId`, `riskContextIds`, `localOrganisation`, `staff`,
`flagOptions`, `linkedClinicalCase` (only `clinicalCaseId`, its resolved
scalar, is sent — see below). This is a genuinely NARROWER contract than
`edit-problem`'s own "resend literally everything from the GET" pattern
(`docs/learnings-problem-description-cleanup.md`) — don't assume the two
endpoints share the same "full round-trip" discipline just because both are
full-replace-of-*something*.

`clinicalCaseId` in the POST corresponds to
`linkedClinicalCase.defaultClinicalCaseId` from the GET — confirmed only as
`null` → `null` in all 3 captures. **Not yet confirmed**: what a populated
`defaultClinicalCaseId` round-trips as. Implementation
(`buildChangeNotePayload`) passes it through unmodified rather than
reshaping it, since nothing here has ever observed a non-null case.

### 3. Confirmed: the code CAN be changed to a different concept entirely

The "editing the code itself" capture (same `noteId` as the free-text
capture, immediately after) changed `noteSNOMEDct` from
`{conceptId:"4473006", description:"Migraine with aura", descriptionId:"7595017"}`
to `{conceptId:"4473006", description:"Classical migraine", descriptionId:"7596016"}`
— a same-concept relabel in this particular capture, but nothing about the
endpoint itself constrains this. The GET prefill's own search results
(`GET /clinical/gb/snomed/search/description/constrained?...`, same
endpoint/params `problem-description-cleanup.js` already uses for problems)
return alternatives across MANY different concepts, and the write endpoint
has no visible server-side same-concept check — the constraint in
"Clean up code" (`content-scripts/problem-description-cleanup.js`'s
`sameConceptAlternatives`) is a CLIENT-SIDE safety filter on what's
*offered*, not something this endpoint itself enforces. The journal-sync
write (`applyToJournal`) deliberately does NOT apply that same filter here
— its purpose is making the note's code equal the problem's current code,
which may genuinely be a different concept than what the note currently
has (Nick, 2026-08-13: "we will just be writing the problem code back").

### 4. Confirmed: identical payload shape for a note inside a consultation vs a standalone note

The orphan-note capture (`noteId` `01998559-2f40-7019-8e69-8a08408ac820`,
`contextType`/`contextId` both `null` on the GET) produced the exact same
POST body shape as the consultation-nested captures — same field set, same
absence of `contextType`/`contextId`/`patientId`. The write is resolved
server-side purely from `noteId` in the URL path. **No special-casing
needed** in `buildChangeNotePayload` for orphan vs nested notes.

## Open questions — not yet confirmed

- A non-null `recordedByOrganisation` shape on this endpoint specifically
  (every capture had `recordedAtAnotherOrganisation: false` and
  `recordedByOrganisation: null` on both GET and POST). `edit-problem`'s own
  equivalent field has a confirmed UI-select-wrapper trap
  (`unwrapRecordedByOrganisation`, `docs/learnings-problem-description-cleanup.md`)
  — unknown whether `edit-note`/`change-note` share that trap. Not guessed
  at; `buildChangeNotePayload` passes the field through verbatim.
- A non-null `clinicalCaseId`/`defaultClinicalCaseId` case — see above.
- Whether the server enforces ANY validation on `noteSNOMEDct` beyond
  requiring valid `conceptId`/`descriptionId` values (e.g. whether a
  genuinely nonsensical concept for the clinical context would be
  rejected) — not tested, since every capture used a real, valid SNOMED
  code from Medicus's own search results.
