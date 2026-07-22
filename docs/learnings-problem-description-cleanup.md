# Learnings: cleaning up outdated SNOMED problem/diagnosis descriptions

Phase 0 discovery for "clean up outdated SNOMED code descriptions" — many
older problem/diagnosis entries carry a historic Read-code-migration display
string (a `[X]`/`[D]`/`[M]`-style ICD cross-map prefix, or a trailing `NOS`)
even though the underlying SNOMED concept has a perfectly good modern plain
synonym. Medicus's own "Edit Problem" UI lets a clinician pick a cleaner
description for the SAME code. Captured 2026-07-22 via
`scripts/document-create-capture.js` (`chDocCap`, `.all()` mode — same
capture tool as `docs/learnings-triage-attachment-to-document.md`, reused
unchanged) on a real patient's real "[X]Attention deficit disorder" problem,
performing the actual intended edit end-to-end.

## Confirmed contract

### 1. Prefill — `GET clinical/data/problem/edit-problem/{problemId}`

```json
{
  "problemId": "{problemId}",
  "problemCode": {
    "label": "[X]Attention deficit disorder",
    "value": { "conceptId": "35253001", "description": "[X]Attention deficit disorder", "descriptionId": null }
  },
  "existingProblems": [
    {
      "label": "[X]Depression NOS (Onset unknown)",
      "value": { "description": "[X]Depression NOS", "descriptionId": null, "conceptId": "35489007" }
    }
    /* … every other CURRENT problem on this patient, same {description,descriptionId,conceptId} shape,
         used by the form to warn about duplicates — NOT itself an edit target */
  ],
  "significance": "major",
  "episode": null,
  "onsetDate": null,
  "additionalInformation": "…",
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "status": "active",
  "endDate": null,
  "reasonEnded": null,
  "patientId": "{patientId}",
  "recordDate": "2019-06-27",
  "recordedAtAnotherOrganisation": true,
  "recordedByOrganisation": { "organisationName": "…", "organisationIdentifierType": null, "organisationIdentifierValue": null },
  "recordedByPractitioner": "…",
  "staff": [ /* {value, label} for recordedByStaff, only relevant when recordedAtAnotherOrganisation=false */ ]
}
```

- **`descriptionId: null` is the reliable machine-detectable signal**, not just
  the bracket/NOS text — a legacy/degraded code carries no live SNOMED
  description link at all, only a free-text `description` string plus the
  `conceptId`. TWO other problems on this same real patient showed the exact
  same pattern (`"[X]Depression NOS"` conceptId `35489007`, `"Fracture of
  radius NOS"` conceptId `12676007`, both `descriptionId: null`) — consistent,
  not a one-off.
- `existingProblems` is a full list of the patient's OTHER current problems in
  the identical `{description, descriptionId, conceptId}` shape — a
  side-channel confirmation that this shape is the general "coded entry"
  representation across the record, not something special to this one field.

### 2. Search for alternate descriptions of the SAME concept —
`GET clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=404684003,71388002,243796009,48176007,272379006&excludeConstrainingConcepts=307824009&query={text}`

This is Medicus's own generic problem/diagnosis-code search (parent concepts:
clinical finding / procedure / situation-with-explicit-context / (unconfirmed)
/ event — `307824009` excluded). Confirmed real response for
`query=Attention+deficit+disorder`:

```json
{
  "results": [
    { "label": "Attention deficit disorder", "value": { "description": "Attention deficit disorder", "conceptId": "35253001", "descriptionId": "486108019" } },
    { "label": "ADD - Attention deficit disorder", "value": { "description": "ADD - Attention deficit disorder", "conceptId": "35253001", "descriptionId": "486104017" } },
    { "label": "Attention deficit disorder without hyperactivity", "value": { "description": "Attention deficit disorder without hyperactivity", "conceptId": "35253001", "descriptionId": "486107012" } },
    { "label": "ADD - Attention deficit disorder without hyperactivity", "value": { "description": "ADD - Attention deficit disorder without hyperactivity", "conceptId": "35253001", "descriptionId": "486105016" } },
    { "label": "Child attention deficit disorder", "value": { "description": "Child attention deficit disorder", "conceptId": "192127007", "descriptionId": "295618015" } }
    /* … 15 more results, mostly DIFFERENT conceptIds (ADHD, adult ADHD, etc.) */
  ]
}
```

**This confirms the "single store" the question was about**: it isn't a
static file, it's this live search — one `conceptId` genuinely has several
description rows (synonyms), and querying by the cleaned-up text (bracket/NOS
stripped) surfaces them alongside unrelated concepts. **The safe filter for a
cleanup tool is: keep only results whose `value.conceptId` matches the
problem's CURRENT `conceptId`** — this guarantees the tool only ever offers
alternate descriptions of the exact same code, never a re-code to a different
clinical concept.

### 3. Save — `POST clinical/problem/edit-problem/{problemId}`

**Full replace, not a partial patch** — confirmed real body (this is
everything the Vue form (`edit-problem-form.vue`) submits, all fields, not
just the changed one):

```json
{
  "onsetDate": null,
  "contextId": null,
  "contextType": null,
  "significance": "major",
  "episode": null,
  "problemCode": { "description": "Attention deficit disorder", "conceptId": "35253001", "descriptionId": "486108019" },
  "additionalInformation": "adult ( provisional diagnosis )",
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": false,
  "endDate": null,
  "reasonEnded": null,
  "recordDate": "2019-06-27",
  "recordedByOrganisation": { "organisationName": "The Park Road Surgery", "organisationIdentifierType": null, "organisationIdentifierValue": null },
  "recordedByPractitioner": "Mrs Sarah Elliott"
}
```

→ `200 {}` (empty body). A subsequent `GET
clinical/data/problem/slideover/overview/{problemId}` confirms the change
stuck: `conceptId` unchanged (`35253001`), `description` now `"Attention
deficit disorder"`, `descriptionId` now populated (`486108019`, was `null`)
— **exactly the "same code, clearer description" behaviour the whole feature
is about**, confirmed end-to-end on a real patient record, not a test one.

- Only `problemCode` changed between the GET-prefill values and the POST body
  in this capture — every other field (`significance`, `additionalInformation`,
  `recordDate`, `recordedByOrganisation`/`recordedByPractitioner`, etc.) was
  resent unchanged. **A cleanup tool must GET the full prefill first and
  round-trip every other field untouched** — sending only `{problemCode:...}`
  has never been confirmed and, given `m-edit-form`'s full-object binding, is
  likely to blank the other fields.
- Whether `recordedByOrganisation`+`recordedByPractitioner` or
  `recordedByStaff` is required depends on `recordedAtAnotherOrganisation`
  (from the GET prefill) — mirror whichever branch the prefill indicates,
  don't assume one.

## What this means for a cleanup tool

- **Detection**: `patient/data/clinical-summary/summary/{patientId}`'s
  `problems[].problemCodeDescription` (plain text, already used elsewhere in
  this repo) is enough to flag CANDIDATES by pattern (`/^\[[A-Za-z]{1,2}\]/`,
  `/\bNOS$/i`) for a quick scan across a problem list without extra calls.
  `descriptionId === null` (only visible after the per-problem
  `edit-problem` GET) is the more RELIABLE signal, confirmed correlated with
  the bracket/NOS text on every example seen so far, but costs one API call
  per candidate to check.
- **Suggesting a fix**: GET `edit-problem/{problemId}` for the current
  `conceptId`, search with the bracket/NOS stripped from the current
  description, filter results to the same `conceptId`, and offer the
  shortest/no-bracket/no-NOS survivor as the suggested replacement — never
  auto-apply; a clinician must confirm, same as Medicus's own UI requires.
- **Applying a fix**: resend the FULL `edit-problem` payload with only
  `problemCode` swapped (per §3 above).

## 4. DOM injection point (live capture, 2026-07-22)

Address bar, viewing a patient's Active Problems (Clinical Summary tab):

```
https://england.medicus.health/{siteId}/patient/patient/care-record/{patientId}?careRecordTab=clinical-summary
```

Each problem renders as:

```html
<li class="item">
  <a class="item__link m-link medicus-outline item__link">[X]Depression NOS</a>
  Jan 2004*
</li>
```

nested inside `div.m-card-v2 > div.m-card-v2__content > ul` under an "Active
Problems" heading — the same `li.item` shape
`engine/extractors/problems.js`'s own Strategy 1 selector
(`li.m-list-item, li.item, li`) already expects for this page. The `<a>`'s
trimmed textContent is an EXACT match for `problemCodeDescription` from the
`clinical-summary/summary` API response — safe to match by text, same
discipline already proven for attachment detection
(`docs/learnings-triage-attachment-to-document.md` §8).

The bare `.../{siteId}/care-record/{patientId}` URL form (no
`patient/patient/` segment) is supported by the widget's URL regex too, but
only BY ANALOGY — `content-scripts/triage-lens/content.js`'s `pageType()`
already treats `/care-record/` and `/patient/patient/` as equivalent
record-page markers, and a `window.open()` elsewhere in that file constructs
exactly this shorter path — not independently captured this session.

## What's NOT yet confirmed

- Whether `descriptionId === null` is EVER seen on a legitimately-current,
  freshly-coded problem (i.e. is it a 100%-reliable "needs cleanup" signal,
  or could a fresh entry also have a null descriptionId for an unrelated
  reason)? Only 3 examples seen so far, all genuinely historic/migrated —
  worth widening the sample before trusting this as the sole detector.
  before Do NOT rely on this signal alone without checking a few more real
  examples first.
- Whether the SAME endpoint pair applies to non-"problem" coded entries that
  can carry the same bracket/NOS legacy pattern (e.g. procedures, referral
  reasons, other coded record types) — only problems have been captured.
- The full meaning of `constrainingParentConcepts=404684003,71388002,
243796009,48176007,272379006` and `excludeConstrainingConcepts=307824009` —
  `404684003` (Clinical finding) and `71388002` (Procedure) are confirmed SCT
  root concepts by general SNOMED knowledge; the other three parent concepts
  and the excluded one were not individually verified against a SNOMED
  browser in this session.
