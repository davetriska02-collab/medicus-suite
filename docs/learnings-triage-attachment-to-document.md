# Learnings: create-document API (`clinical/document/create`)

Phase 0 discovery for the "save a triage-task attachment as a document"
feature. No endpoint anywhere in this repo had ever CREATED a new Medicus
document before this session — only edit-existing
(`clinical/document/edit-details`) and remove-existing
(`clinical/document/mark-incorrect-and-hidden`) were confirmed
(`engine/record-duplicate-parser.js`). Captured 2026-07-20 via
`scripts/document-create-capture.js` (a page-console fetch/XHR interceptor) on
a test patient with a throwaway test PNG, replicating Medicus's own "Add
document" → "Upload from my computer" flow end-to-end. Same discovery
doctrine as `docs/learnings-patient-journal-api.md`: never construct Medicus
API URLs from scratch — capture and replay. Identifiers below are placeholders
(`{patientId}`, `<staff-uuid>`, …), not the real values captured.

---

## Confirmed contract

### 1. Form load (GET calls — informational, not needed by our create path except the SNOMED search endpoints)

- `GET clinical/data/document/new-document-modal/{patientId}` → `{ patientId }`.
  Appears to be a no-op ping fired when the "New Document" modal opens. Not
  needed for a direct-API create — flagged as a small residual risk below in
  case it turns out to register something server-side that the create call
  implicitly expects.
- `GET clinical/data/document/forms/create-inbound-document-form/{patientId}`
  → the prefill model:
  ```json
  {
    "reviewerOptions": {
      "teams": [{ "value": "<team-uuid>", "label": "…", "type": "team", "organisationName": "…" }],
      "staff": [{ "value": "<staff-uuid>", "label": "…", "type": "staff", "jobRole": "…" }]
    },
    "linkableProblems": [
      { "value": "<problem-uuid>", "label": "…", "conceptId": "…", "hasEnded": false, "startDate": "…" }
    ],
    "patientId": "{patientId}",
    "isWithinPatientContext": true,
    "localOrganisationName": "…",
    "contextId": null,
    "contextType": null,
    "selectedReviewerAssignee": { "value": "<team-uuid>", "label": "…", "type": "team" },
    "hiddenFromPatientFacingServices": false,
    "confidentialFromThirdParties": false,
    "recordDate": "YYYY-MM-DD",
    "staff": [
      /* same shape as reviewerOptions.staff */
    ]
  }
  ```
- `documentType` is **not** part of this prefill payload — it's a live
  SNOMED search-as-you-type against
  `clinical/gb/snomed/search/description/constrained?constrainingRefsets=1127551000000109`
  (confirmed by reading the `.vue` component source — Medicus serves its own
  Vue SFCs as literal source text over `GET clinical/ui/document/forms/
create-inbound-document-form.vue`, which is how the field wiring below was
  read directly rather than inferred).
- `clinicalSpecialty` is the same search-select pattern against
  `clinical/gb/snomed/search/description/constrained?constrainingParentConcepts=394658006,394733009`.

### 2. The create call

`POST clinical/document/create` — **one** multipart request, not a two-step
upload-then-attach. `multipart/form-data` (`FormData`) with exactly two parts:

- `file` — the actual file bytes (field name literally `file`).
- `formPayload` — **a single JSON-stringified string**, not individual fields
  per key. Confirmed real shape (values replaced with placeholders):

  ```json
  {
    "patientId": "{patientId}",
    "documentType": {
      "description": "Medical photograph",
      "conceptId": "820241000000102",
      "descriptionId": "2136431000000115"
    },
    "documentDate": "2026-07-20",
    "authoredByDepartment": null,
    "authoredByPractitioner": "<staff-uuid-or-null>",
    "clinicalSpecialty": null,
    "authoredByOrganisation": null,
    "linkedProblemIds": [],
    "contextId": null,
    "contextType": null,
    "reviewerAssigneeId": "<team-or-staff-uuid>",
    "reviewerAssigneeType": "team",
    "hiddenFromPatientFacingServices": false,
    "confidentialFromThirdParties": false,
    "title": "Test photo from triage",
    "additionalInformation": null,
    "problemCode": null,
    "recordDate": "2026-07-20",
    "authorOrganisationOption": "local",
    "clinicalCaseId": null,
    "nextStep": "file-into-patient-record",
    "reviewTaskPriority": 0
  }
  ```

- Response (200): `{ "documentId": "<new-document-uuid>" }`.

### 3. Field notes (from the `.vue` source — real validation/defaults, not guessed)

- `documentType` — **required**. SNOMED-coded `{conceptId, description,
descriptionId}` — the same shape as the already-confirmed edit-existing-
  document contract (`record-duplicate-parser.js`'s `code` field), good
  corroboration this is the stable representation for a document's type
  across both create and edit.
- `file` — **required**. `accept=".txt,.html,.htm,.pdf,.xml,.rtf,.rtx,.au,
.mp3,.png,.gif,.jpg,.jpe,.jpeg,.tif,.tiff,.mpg,.mpeg,.mpe,.doc,.docx,.dcm,
.xls,.xlsx"`, max size 151MB.
- `authorOrganisationOption` — **required**, `'local'` | `'other'`. `'local'`
  → `authoredByPractitioner` is an optional (`clearable`) select from
  `staff[]`; `'other'` → requires `authoredByOrganisation` (org lookup or
  manual entry) plus `authoredByPractitioner` as free text.
- `nextStep` — `'file-into-patient-record'` (default) | `'send-for-review'`.
  The review path additionally requires `reviewerAssigneeId`/
  `reviewerAssigneeType` + `reviewTaskPriority`; `'file-into-patient-record'`
  needs none of that.
- `title`, `documentDate`, `clinicalSpecialty`, `additionalInformation`,
  `linkedProblemIds`, `hiddenFromPatientFacingServices`,
  `confidentialFromThirdParties` — all optional, present as `null`/`false`/
  `[]` when left untouched.
- `recordDate` — defaulted from the form-load response (today, in this
  capture); becomes independently editable only under a condition
  (`recordDateEditable`) not exercised in this capture. A safe default is to
  mirror `documentDate`.
- `reviewerOptions` / `selectedReviewerAssignee` / `staff` / `linkableProblems`
  all come from the form-load GET, keyed to the current patient.

### 4. What's still unconfirmed

- **Error-response shape** (bad file type, oversize, or a missing required
  field) — this capture only exercised the happy path. Before shipping,
  deliberately trigger at least one failure (e.g. an unsupported file
  extension) and capture the response.
- `recordDateEditable`'s trigger condition — not exercised.
- Behaviour for provider types other than a standard GP practice
  (`$isMentalHealthProvider`/`$isCommunityServiceProvider` branches in the
  template affect `clinicalCaseId`) — not relevant to a standard GP setup,
  skip unless it becomes relevant.
- Whether the `new-document-modal/{patientId}` GET registers anything
  server-side that the create call implicitly depends on having fired first
  (see above) — untested; the happy-path capture worked without deliberately
  isolating this.

### 5. Second confirmed code — non-image attachments (2026-07-20, follow-up capture)

A follow-up capture (same technique, real test PDF this time — `PDF doc test.pdf`,
`application/pdf`) confirmed a second real `documentType`, obtained by searching
Medicus's own "Document type" field independently of what file was attached
(the SNOMED search-select is unrelated to the `file` field, so this doesn't
require the file itself to be a PDF — any test file works):

```json
{ "description": "Patient/Carer Correspondence", "conceptId": "163181000000107", "descriptionId": "214931000000113" }
```

Everything else in the `formPayload` was identical in shape to the photo
capture (§2) — same `authorOrganisationOption: 'local'`, same
`nextStep: 'file-into-patient-record'`, same `reviewerAssigneeId`/`Type`
defaulted from the form-load GET.

Between "Medical photograph" (images) and "Patient/Carer Correspondence"
(PDF/Word), every extension `content.js`'s `extractInitialRequest()` itself
recognises as a triage attachment (`pdf|docx?|jpe?g|png|tiff?|heic|gif`) now
has a confirmed code — the widget's eligibility no longer needs to be
narrower than that extraction.

### 6. What this means for the widget (step 2 of the plan)

- **Single POST, not two-step** — this simplifies the widget considerably
  versus the "two-step upload" hypothesis in the original plan.
- `documentType` being a live SNOMED search (not a fixed picklist) means a
  fully general "any document type" picker would need that search endpoint's
  query contract confirmed (still not done — see §4). Instead the widget picks
  between the **two confirmed codes** by file extension (§5) — no free-text
  search, no guessing.
- `nextStep: 'file-into-patient-record'` should be the widget's fixed choice
  — no review-routing UI needed, since the clinician acting on the triage
  task from which the attachment came IS the reviewer.
- `authorOrganisationOption: 'local'` with `authoredByPractitioner` left
  unset/null is a safe default — the document originates from a patient
  submission via triage, not authored by an external organisation or a named
  local clinician.
- Inputs the widget needs: `patientId` (resolvable the same way
  `content-scripts/task-inline.js`'s `resolvePatientId()` already does), the
  file itself (fetched from the attachment's `href`, now captured by
  `content-scripts/triage-lens/content.js`'s `extractInitialRequest()`),
  `documentType` (auto-picked from the file extension between the two
  confirmed codes — no picker shown), title (prefill from filename), document
  date (default today).
- `formPayload` must be sent as a JSON **string** field inside the
  `FormData`, not as separate `FormData` entries per key — easy to get wrong
  when building the request by hand.

## Capture method

Captured via `scripts/document-create-capture.js` — see that script's header
comment for reuse instructions (paste into DevTools console, use Medicus's
own "Add document" flow on a test patient/file, then `chDocCap.summary()` /
`.dump()`).

## 7. A better long-term option exists: the official Transactional API's `create-document` (2026-07-20)

Medicus's own help centre documents a genuinely official, stable
`POST {{base_url}}/transactional-api/create-document` endpoint (Medicus Help
Centre, "Transactional API Endpoints" article) — a materially cleaner
contract than the internal UI endpoint this widget currently drives:

```json
{
  "patientId": "019ac994-3e6d-7352-8511-b3e2978a42c7",
  "fileName": "discharge.docx",
  "title": "Discharge letter from ED",
  "contentType": "application/msword",
  "data": "<base64-encoded file bytes>",
  "code": { "conceptId": "823701000000103", "description": "Discharge letter" },
  "clinicalSpecialty": { "conceptId": "773568002", "description": "Emergency medicine" },
  "hiddenFromPatientFacingServices": false,
  "confidentialFromThirdParties": true,
  "recordDate": "2026-03-25",
  "documentDate": "2026-03-25",
  "authorDepartment": "Emergency Department",
  "additionalInformation": "Lorem ipsum"
}
```

→ `{ "id": "<uuid>" }`. Plain JSON with base64 file data (not multipart), a
**2-field** `code` (`conceptId`/`description` — no `descriptionId`), and none
of the review-routing fields (`nextStep`, `reviewerAssigneeId`/`Type`,
`reviewTaskPriority`) our internal-API contract carries. `823701000000103`
("Discharge letter") sits in the same UK national-namespace numbering pattern
as our two confirmed codes (§2, §5) — consistent with all three being members
of the same underlying SNOMED document-type refset.

**Why this widget doesn't use it (yet):** this repo already has a
Transactional API integration (`docs/TRANSACTIONAL-API-INTEGRATION.md`),
deliberately **read-only and dormant by default**. The architecture is
server-to-server — the extension never holds the signing key or calls
`.../transactional-api/...` directly; it's content script → service worker →
a backend proxy (Supabase, in the separate private `medicus-suite-private`
repo) which signs a short-lived Medicus JWT. Using `create-document` for real
needs, outside this repo:

- the proxy's endpoint allowlist extended to include `create-document`
  (nothing is wired for writes today);
- Medicus-side onboarding for this specific endpoint (JWKS registration,
  `client_id`, granted permissions — staging first per that doc);
- its own governance sign-off (arguably a bigger deal than the read-only
  bundle fetch already required, since this _creates_ a permanent record
  rather than reading one).

**Decision (2026-07-20):** keep the shipped widget on the internal API for
now (it's built, tested, and working) — this is recorded as the target
migration once the Transactional API's write path is provisioned, not
something to build against speculatively today.

## 8. The widget was invisible on live tasks: attachments aren't always an `<a>` (2026-07-20)

Live debugging session (page-console DOM/network capture, not guessed) found
the widget never appeared on a real communication-thread task with a genuine
patient-submitted attachment. Root cause: **the "Initial Request" card does
not always render an attachment as `<a href="...">`.** On a communication-
thread task it's a plain `<button>` with the filename as its label and no
href, `data-*`, or any other identifier in the DOM at all:

```html
<div>
  <p class="m-mt-sm"><strong>Attachment</strong></p>
  <button class="m-link medicus-outline" type="button" tabindex="0">thisisnotaphoto.png</button>
</div>
```

`content.js`'s `extractInitialRequest()` only ever scanned `<a>` tags, so this
was silently invisible to it — `window.__msTriageAttachments` came back empty
even with a real attachment present. (Separately, the SAME task type also has
neither a "Codes & actions" card nor a "More actions" button — the two anchor
points every inline widget on this page currently relies on — confirmed via
the same session; **not yet fixed**, tracked as a follow-up.)

### Confirmed: the button's click handler and its real download contract

Captured via `scripts/document-create-capture.js` (`chDocCap`, default filter
— no `.all()` needed) by clicking the button:

```
GET /communication/data/online-message/download-attachment/{attachmentId}?convertToPDF=0
→ 200, Content-Type: image/png   (raw file bytes, ONE GET, no signed-URL indirection)
```

### Confirmed: where the attachment id/URL actually comes from

A second capture (`chDocCap.all()` across a fresh in-app navigation into the
task, not a hard reload — a hard reload wipes a console-pasted capture script)
found the task-overview call every inline widget already makes for patient
resolution — `GET /tasks/data/{typeSlug}/overview/{taskUuid}` — carries the
real attachment metadata in its response body. Confirmed real shape (task
type: `communication_thread_task`):

```json
{
  "data": {
    "patientId": "01923625-8042-7071-a04d-1c610de03944",
    "communicationThread": {
      "communications": [
        {
          "patientRequest": {
            "attachments": [
              {
                "id": "0195b355-79ea-7380-9707-4d4aac734718",
                "fileName": "thisisnotaphoto.png",
                "fileSize": 12765,
                "contentType": "image/png",
                "fileURI": "/communication/data/online-message/download-attachment/0195b355-79ea-7380-9707-4d4aac734718?convertToPDF=0"
              }
            ]
          },
          "operativeChannel": {
            "attachments": [
              /* identical object, duplicated — dedupe by id */
            ]
          }
        }
      ]
    }
  }
}
```

- `fileURI` is the exact download path above — confirmed real, used AS GIVEN,
  never reconstructed.
- The SAME attachment object appears under both `patientRequest.attachments`
  and `operativeChannel.attachments` for the communication that carries it —
  any consumer must dedupe by `id`.
- `data.patientId` (top-level under `data`) is ALSO the patient id for this
  task type — already covered by `resolvePatientId`'s existing fallback chain
  in `document-file-inline.js`, so no fix was needed there, only for
  attachments.
- Not yet confirmed: whether other task types (e.g. `medical_patient_request_task`,
  the type the original "patient request" bug report referred to) nest
  attachments under the same `communicationThread.communications[]` path or a
  different one. `findAttachmentsInOverview` in `document-file-inline.js`
  deliberately walks the WHOLE response tree looking for the `{id, fileName,
fileURI}` shape rather than hardcoding this one path, specifically so it
  generalises across task types without needing a separate capture for each —
  but this hasn't been verified live on a task type other than
  communication-thread.

### What this means for the widget

- `content.js`'s `extractInitialRequest()` now also detects the button
  pattern, recording `{ href: '', filename }` for it (a real attachment with
  an unresolved download identifier, not nothing).
- `document-file-inline.js` accepts these as eligible (by filename extension,
  same as before) and resolves the real download URL lazily, when the widget
  is opened or the save button is pressed — via the SAME
  `/tasks/data/{slug}/overview/{taskUuid}` fetch already made for patient
  resolution (one fetch serves both needs now), matched by filename against
  `findAttachmentsInOverview`'s result. No new eager network call is added.
- **Fixed (follow-up pass, same day):** the missing anchor point (no "Codes &
  actions" card, no "More actions" button) on communication-thread tasks.
  Both `task-inline.js` and `document-file-inline.js` gained a fourth/third
  fallback: anchor after the "Initial Request" card itself — the same card
  `content.js`'s `extractInitialRequest()` reads, confirmed present on every
  request/communication task type observed so far (including the "no
  attachment" control task from the original debugging session). Matches the
  heading text EXACTLY ("Initial Request", not content.js's own looser
  starts-with match) so it can never mis-anchor on an unrelated section.
  `task-inline.js` gained the same fix since it has the identical gap on this
  task type — one root cause, one fix, applied to both consumers.
