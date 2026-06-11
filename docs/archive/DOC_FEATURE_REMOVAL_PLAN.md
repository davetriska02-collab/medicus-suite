> Archived 2026-06-11 — implemented/superseded; kept for historical reference.

# Document-context Lens — Removal Plan

Removes the **document-context lens** from Triage Lens **in full** — a dead
feature. This covers the v3.8.0 lens (the `docEntries` / `docUrgent` /
`docAction` chips and the JSON interceptor that fed them) **and** the v3.9.0 PDF
body-extraction pipeline built on top of it. Only the separate, DOM-sourced
document **metadata** chips (`detail.docType`, `detail.docSpecialty`) survive.
The feature was built across two phases:

- **v3.8.0 — Document-context lens (Phase 1):** intercepts the cheap JSON the
  SPA already loads (filed care-record entries + the electronic covering
  message `inboundMessage`) and keyword-matches it into `detail.docUrgent`
  (red) / `detail.docAction` (amber) chips.
- **v3.9.0 — Document-body PDF extraction (Phase 2):** downloads the
  server-converted document PDF and runs PDF.js in an MV3 offscreen document to
  feed the body prose into those same two chips.

## Scope

### REMOVE (the entire document-context lens)
- **Chips:** `detail.docEntries`, `detail.docUrgent`, `detail.docAction` (and
  the never-implemented `docMedChange` from the original plan).
- **PDF pipeline:** the offscreen document (`offscreen.html` / `offscreen.js`),
  the service-worker `sentinelDocPdfText` handler and its helpers, the
  `offscreen` permission, and the offscreen web-accessible resources.
- **Content-script logic:** `_docCtx`, the `ch-doc-entries` listener,
  `runDocContextChips`, the `injectDocContextInterceptor` stub and its init
  call, plus the body machinery (`requestDocPdfText`, `_docPdfRequestedFor`,
  `_docCtxMaybeClearPdf`, `extractDocContextText`, the negation guard and
  `DOC_URGENT_RE` / `DOC_ACTION_RE` matchers, the `ch-doc-preview` listener).
- **Page-world interceptor:** all document-context interception
  (`/clinical/document/entries/` → `ch-doc-entries` and
  `/document/modals/version/preview/` → `ch-doc-preview`, `handleDoc`, the
  entries/preview regexes). `page-world.js` keeps only the queue task-list path.
- **Defaults & options:** the three chip definitions in `defaults.json`,
  `content-scripts/triage-lens/defaults.json`, the embedded defaults in
  `content.js`, and the settings-catalogue entries in `options.js`.
- **Scratch files:** `doc-body-plan.md`, `doc-body-probe2.js`,
  `doc-body-discovery.js`.

### KEEP (separate features, not the document-context lens)
- `detail.docType` / `detail.docSpecialty` — read from the document task card by
  `extractDocumentTaskInfo` (`docInfo` in `runDetail`), not via any interceptor.
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
| `content-scripts/triage-lens/content.js` | remove `_docCtx`, the `ch-doc-entries` listener, `runDocContextChips`, the interceptor stub + init call, the body machinery, and `docEntries`/`docUrgent`/`docAction` from embedded defaults |
| `content-scripts/triage-lens/page-world.js` | remove all document-context interception (entries + preview); keep only the task-list path |
| `defaults.json` | remove `detail.docEntries` / `detail.docUrgent` / `detail.docAction` |
| `content-scripts/triage-lens/defaults.json` | remove `detail.docEntries` / `detail.docUrgent` / `detail.docAction` |
| `content-scripts/triage-lens/options.js` | remove the three catalogue entries |
| `CHANGELOG.md` | add removal entry |

## Safety / verification
- No `chrome.storage` keys are involved (the feature was deliberately ephemeral),
  so no `shared/io/*` or backup-envelope changes are needed.
- `vendor/pdf.min.js` / `pdf.worker.min.js` stay — still used by the Visualiser.
- Kept chips (`docType`, `docSpecialty`) and queue monitoring must still render on
  document tasks / the queue after removal.
- `test-triage-defaults.js` (defaults drift guard) must stay green.
