# Document-body Feature — Removal Plan

Removes the **document-body text-analysis** feature from Triage Lens: the
keyword/NLP chips that read clinical-document prose and the PDF body-extraction
pipeline that fed them. This was built across two phases:

- **v3.8.0 — Document-context lens (Phase 1):** intercepts the cheap JSON the
  SPA already loads (filed care-record entries + the electronic covering
  message `inboundMessage`) and keyword-matches it into `detail.docUrgent`
  (red) / `detail.docAction` (amber) chips.
- **v3.9.0 — Document-body PDF extraction (Phase 2):** downloads the
  server-converted document PDF and runs PDF.js in an MV3 offscreen document to
  feed the body prose into those same two chips.

## Scope

### REMOVE
- **Chips:** `detail.docUrgent`, `detail.docAction` (and the never-implemented
  `docMedChange` from the original plan).
- **PDF pipeline:** the offscreen document (`offscreen.html` / `offscreen.js`),
  the service-worker `sentinelDocPdfText` handler and its helpers, the
  `offscreen` permission, and the offscreen web-accessible resources.
- **Content-script body logic:** `requestDocPdfText`, `_docPdfRequestedFor`,
  `_docCtxMaybeClearPdf`, `extractDocContextText`, the negation guard and
  `DOC_URGENT_RE` / `DOC_ACTION_RE` matchers, the `ch-doc-preview`
  (`inboundMessage`) listener, and the urgent/action branch of
  `runDocContextChips`.
- **Page-world interceptor:** the `/document/modals/version/preview/`
  (`ch-doc-preview`) interception — no longer consumed.
- **Defaults & options:** the two chip definitions in `defaults.json`,
  `content-scripts/triage-lens/defaults.json`, the embedded defaults in
  `content.js`, and the two settings-catalogue entries in `options.js`.
- **Scratch files:** `doc-body-plan.md`, `doc-body-probe2.js`,
  `doc-body-discovery.js`.

### KEEP (separate, pre-existing, descriptive-only)
- `detail.docType` / `detail.docSpecialty` — sourced from `docInfo` in
  `runDetail` (document overview), unrelated to body text.
- `detail.docEntries` — "Filed notes ×N", an on-by-default count of filed
  care-record entries; descriptive metadata, not body prose. Continues to be
  powered by the `ch-doc-entries` interceptor.
- Queue monitoring (`ch-task-list-data` / `page-world.js` task-list path).

## File-by-file checklist

| File | Action |
|---|---|
| `offscreen.html` | delete |
| `offscreen.js` | delete |
| `content-scripts/triage-lens/doc-body-plan.md` | delete |
| `content-scripts/triage-lens/doc-body-probe2.js` | delete |
| `content-scripts/triage-lens/doc-body-discovery.js` | delete |
| `manifest.json` | drop `offscreen` permission + offscreen web-accessible resources; bump version |
| `service-worker.js` | remove the document-body PDF extraction block (helpers + `sentinelDocPdfText` listener) |
| `content-scripts/triage-lens/content.js` | remove body logic; slim `_docCtx` + `runDocContextChips` to `docEntries` only; drop `docUrgent`/`docAction` from embedded defaults |
| `content-scripts/triage-lens/page-world.js` | remove `ch-doc-preview` interception |
| `defaults.json` | remove `detail.docUrgent` / `detail.docAction` |
| `content-scripts/triage-lens/defaults.json` | remove `detail.docUrgent` / `detail.docAction` |
| `content-scripts/triage-lens/options.js` | remove the two catalogue entries |
| `CHANGELOG.md` | add removal entry |

## Safety / verification
- No `chrome.storage` keys are involved (the feature was deliberately ephemeral),
  so no `shared/io/*` or backup-envelope changes are needed.
- `vendor/pdf.min.js` / `pdf.worker.min.js` stay — still used by the Visualiser.
- Kept chips (`docType`, `docSpecialty`, `docEntries`) and queue monitoring must
  still render on document tasks after removal.
