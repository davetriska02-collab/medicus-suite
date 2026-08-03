# Learnings — Medicus SNOMED search, live console verification (2026-08-01)

Live run by Dave, DevTools console, england.medicus.health, logged-in session.
Purpose: verify the Document Coder extraction engine's offered-term vocabulary
resolves against Medicus's OWN concept index (the runtime resolution path).

## Confirmed (live)

- **API base discovery from console**: `performance.getEntriesByType('resource')`
  → first entry containing `.api.england.medicus.health` → origin. App at
  `england.medicus.health`, API at `https://560b6c.api.england.medicus.health`
  (site code is NOT derivable from the app hostname label — earlier attempt
  `england.api.england…` 500s with no CORS headers).
- **CORS**: credentialed console fetch to the real API origin succeeds (server
  sends ACAO for the app origin). Console-world diagnostics work; the earlier
  guide assumption holds.
- **`query` without `constrainingParentConcepts` returns HTTP 200 with an
  EMPTY result set** — a malformed call fails silently-empty, not loudly.
  Product code must treat empty-with-missing-param as its own failure mode
  (four-state honesty: "search did not run correctly" ≠ "no matches").
- **Response shape** exactly as SNOMED-API-GUIDE.md: `{results:[{label,
value:{description, conceptId, descriptionId, parentConceptIds?}}]}`.
- **All 14 extractor corpus terms resolve** (constrained to 404684003
  Clinical finding, `outputParentConceptIds=1`): 12/14 with the exact concept
  as top hit, incl. Community acquired pneumonia→385093006 (unique match),
  **Atrial fibrillation→49436004 (mockup's pinned ID, now live-confirmed)**,
  T2DM→44054006, Hypertension→38341003, NSTEMI→401314000, Gout→90560007,
  Acute otitis media→3110003, Falls→161898004, Recurrent falls→279992002.
- **Laterality survives resolution**: "Cellulitis of left leg" → pre-coordinated
  "Cellulitis of left lower leg" (41651000087106) — descendant refinement works.
- **One instructive weak case**: "Moderate depressive episode" has no exact
  concept; top hits are recurrent/bipolar variants — exactly the case the
  tier system must grade weak (tier B/C), never one-click. Keep as the
  canonical tier-calibration example.

## Still to confirm

- Same calls from the extension's isolated world (expected fine — host
  permission exists); the §14 capture session Q1–Q6 remain open.

---

# Part 2 — Document-processing capture, Q1/Q2 answered (2026-08-03, live)

## Q1 — the queue (CONFIRMED)

- `GET /tasks/data/document_task/task-list?statuses[]=pending-initial-review&statuses[]=awaiting-filing&statuses[]=awaiting-patient-registration&viewContext=workflow`
- Rows carry everything the Phase-4 worklist line needs: `documentCode`
  (SNOMED doc type), `documentType`, `author`, `patientName`, `namedGp`,
  `priorityDisplay`, `dueDate`/`isOverdue`, `assignedTo`, `status`,
  `unmatchedToPatient`, and `overviewURL`.
- **Slug quirk:** task-list slug is `document_task` but overviewURL is
  `/tasks/data/document/overview/{taskId}` — our content script currently
  404s fetching `/tasks/data/document_task/overview/{id}`. BUG TO FIX in
  triage-lens queue fetch for document tasks.

## Q2 — how content is served (CONFIRMED — the go/no-go passes)

Task overview (`/tasks/data/document/overview/{taskId}`) returns
`data.versionId` + `data.fileId`; then:

- `GET /clinical/data/document/modals/version/preview/{versionId}` →
  attachment metadata: `fileType` (e.g. `text/xml`), `fileName`
  (`kettering_*.xml`), `fileRoute` (`xml/gb-nhs-kettering`).
- `GET /tasks/data/document/xml/gb-nhs-kettering/document-preview/{fileId}` →
  JSON with **document-borne patient demographics + `isMatched`** (the
  wrong-patient banner data, served by Medicus itself!), and content flags:
  `isHTML` / `isPDF` / `isTIF` / `hasContent`, with `clinicalReport` holding
  the letter body as HTML when `isHTML=true` (per the .vue template, which
  srcdoc's it into an iframe). When `isPDF`, bytes come from
  `GET /clinical/document/xml/gb-nhs-kettering/pdf-preview/{fileId}`
  (application/pdf) — that's the PDF.js lane. `isTIF` exists → a natural
  COULD-NOT-READ lane. Raw Kettering XML is exportable (`fileCanExport`).
- **Read strategy for Phase 1:** three lanes — (1) `isHTML` → extract text
  from `clinicalReport` directly, NO PDF.js; (2) `isPDF` → pdf-preview bytes
  → PDF.js text layer; (3) `isTIF`/no text → COULD NOT READ. Plus the raw
  XML export as a possible richer source (Kettering carries structured
  sections) — probe later.

## Q3 partial — coding surface (from overview payload, clicks pending)

- Existing coded entries: `GET /clinical/document/entries/{documentId}` →
  `entries[]` with `type` (seen: `note`), `code` (null for notes), `text`,
  `onClickUrl`. Card is titled "Codes & Actions" (anchor for the widget).
- `codesAndActionsOptions[]` enumerates Medicus's own create-actions with
  URLs + `contextId`/`contextType=document`: allergy, appointment,
  communication, drug administration, fit note, **future action/recall**,
  immunisation, investigation request, medication (elsewhere/OTC/review),
  note, observation, prescription, procedure, referral, routine obs, task.
  **NOTABLE: no problem/diagnosis create option in the menu** — how a
  diagnosis code is attached from a letter is the open Q3 click.
- `inboundDocument.linkedProblems[]` exists (documents link to problems,
  with description/onsetDate/significance) — the delta's record-side join
  may be even more direct than problem-list matching.
- `ocrStatus: null` field exists — Medicus has OCR plumbing (watch item).

## Part 3 — Q3 write path + non-Kettering lane (2026-08-03, live)

- **Coding writes on a document go through
  `POST /clinical/document/{documentId}/change-notes`** (fired ×3 during a
  live coding action on the Codes & Actions card) — request body shape
  pending from dump. Task completion/filing:
  `POST /clinical/inbound-document-task/complete`. Workflow conveyor:
  `GET /task-list/document_task/next-task/{taskId}`.
- **Non-Kettering (file/scan) lane CONFIRMED:** file documents preview via
  `GET /tasks/data/document/file/document-preview/{fileId}` and serve their
  bytes via `GET /clinical/document/download-file/{fileId}` — the generic
  content read for uploaded/scanned letters (PDF.js or COULD-NOT-READ lane
  depending on text layer).

## Part 4 — the coding write contract, CONFIRMED (2026-08-03, live)

(Endpoint shapes only; capture bodies contained live patient data and are
NOT reproduced anywhere.)

- **Coded entry on a document**:
  `POST /clinical/document/{documentId}/change-notes` with
  `{ notesToSave: [{ uuid (client-generated v7-style), entryType: "note",
   code: { description, conceptId, descriptionId, parentConceptIds[] } }],
   sortOrder: [{id, entryType}...], sortOrderHash }`
  → responds `{ sortOrderHash }` (optimistic concurrency: GET
  `/clinical/document/entries/{documentId}` first, replay its hash; each
  write returns the next hash). Free-text note = same call with `text`
  instead of `code`.
- **THE PIPELINE CLOSES**: the `code` object is byte-shaped like the
  `value` object Medicus's own SNOMED search returns (description,
  conceptId, descriptionId, parentConceptIds) — extractor term → Medicus
  search → human confirms → change-notes POST with the chosen search row.
  No transformation layer needed.
- **Filing**: `POST /clinical/inbound-document-task/complete { taskId }`;
  conveyor `GET /task-list/document_task/next-task/{taskId}` → `{ route,
foundNextTask }`. Entries become `isFinalised: true` after filing.
- **Coded-data lane exists natively**: document entries can be
  `type: "observation"` (BP/weight/pulse coded from letters) — created via
  the codesAndActionsOptions observation URL. The plan's copy-assist lane
  has a real write path behind it (still human-gated, Phase 3+ and CSO).
- **File lane completed**: `GET /tasks/data/document/file/document-preview/
{fileId}` → `{ fileType, conversionInProgress, conversionFailed,
rendersAsPdf, conversionFailureReason }` then
  `GET /clinical/document/download-file/{fileId}?convertToPDF=1` →
  application/pdf. Server converts non-PDF uploads; `rendersAsPdf` and the
  conversion flags are clean COULD-NOT-READ signals.
- Real letters carry rich metadata: `clinicalSpecialtyLabel`,
  `additionalInformation`, `isHiddenFromPFS` (sensitivity flag — feeds the
  Caldicott role gate), `linkedProblems`.

**Capture session Q1/Q2/Q3/Q5/Q6 CLOSED.** Remaining: Q4 outerHTML anchor
snippets (any time), Q7 letter-format tally (ongoing). Phase 1 can build
against confirmed contracts end to end.

## Part 5 — Q7 content-lane tally, CLOSED (2026-08-03, live)

Whole-queue sweep of a real working inbox (40 pending document tasks; counts
only — no patient data in the capture).

Lane mix:

| Lane                            | Count | Meaning for the reader                                  |
| ------------------------------- | ----- | ------------------------------------------------------- |
| `file-pdf`                      | 25    | uploaded/scanned file, `rendersAsPdf` → PDF.js lane     |
| `kettering-pdf`                 | 9     | Kettering XML wrapping a PDF payload → PDF.js lane      |
| `kettering-tif`                 | 5     | TIF image payload → **COULD-NOT-READ** (no text layer)  |
| `kettering-html`                | 1     | `clinicalReport` letter HTML → the fast structured lane |
| failures / unknown / no-content | 0     | every task classified cleanly                           |

Document types over the same 40: Clinical letter 22, A&E report 3,
Discharge letter 3, Prescription 2, Administration section 2, Discharge
report 2, Shared-care management plan 2, Home-visit admin 1, DNA letter 1,
Discharge summary 1, Telephone consultation 1.

**What this decides (feeds plan §reality-stats):**

- **PDF.js is the critical path, not an optional lane** — 34/40 (85%) of the
  real inbox renders as PDF. Phase 1 text extraction must lead with the
  PDF.js pipeline; the Kettering `clinicalReport` HTML fast path is real but
  rare (1/40) and cannot carry the feature.
- **COULD-NOT-READ share ≈ 12%** (5/40 TIFs). The four-state honesty model's
  "could not read this document" state will show on roughly one task in
  eight — it is a routine state, not an edge case, so its UI copy matters.
- **Zero conversion failures / unknowns** in the sweep — the lane classifier
  logic (preview-endpoint flags) covers the real distribution completely.
- Incidental re-confirmation: the extension's `document_task` overview-slug
  bug (api-client.js `resolveTaskToPatient`) 404-spammed twice per task
  throughout the sweep — fix queued.

**Capture programme status: only Q4 (Codes & Actions card outerHTML anchor)
still open.** Everything else Phase 1 needs is confirmed against the live
system.
