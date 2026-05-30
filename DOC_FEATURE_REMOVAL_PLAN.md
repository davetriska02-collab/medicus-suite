# Document-context / PDF-body feature — removal plan

Status: **NOT YET DONE.** A first attempt (commit reverted in `3aa5b0e`) failed
because the session's container was silently dropping file writes. Execute this
in a fresh, stable session. The plan below is corrected against the real code
(the earlier attempt used wrong anchors).

## Why we're removing it
The experimental document-context lens (overlaying key actions on Medicus
document tasks via PDF text extraction) never worked reliably and adds code
surface across the suite. The **queue drug-monitoring overlay is the priority and
must stay working** — several files are shared between the two features, so the
edits are surgical, not whole-file deletes.

## Keep / do-not-touch
- `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` — **KEEP.** The patient-record
  **visualiser** (`visualiser-core.html` / `visualiser-core.js`) uses them. They
  are NOT exclusive to the document feature.
- In `page-world.js`: keep `TL_RE`, `pickUuid`, `handleTaskList`, the fetch/XHR
  wrapping scaffolding and the `ch-task-list-data` event — that IS queue
  monitoring.
- In `service-worker.js`: keep the `toggleSidebar` / `openOptionsPage` /
  pusher / config-init handlers.

## 1. Delete entire files (document-only)
- `offscreen.html`
- `offscreen.js`
- `content-scripts/triage-lens/doc-body-discovery.js`  (dev console script)
- `content-scripts/triage-lens/doc-body-probe2.js`     (dev console script)
- `content-scripts/triage-lens/doc-body-plan.md`        (dev notes)

## 2. `manifest.json` (surgical)
- Remove `"offscreen"` from `permissions`.
- Remove `"offscreen.html","offscreen.js"` from `web_accessible_resources[0].resources`.
- Keep `"vendor/*"`.
- (Bump version + changelog as the last step.)

## 3. `service-worker.js` (surgical)
Remove the document-body PDF extraction block: the banner comment
`// ── Triage Lens: document-body PDF text extraction` through the end of the
`sentinelDocPdfText` `onMessage` listener. In the last verified read this was
**lines 58–164** (anchors, not line numbers, are authoritative):
- `let _offscreenCreating`, `abToBase64()`, `ensureOffscreenDocument()`,
  `closeOffscreenDocument()`, `extractDocPdfText()`, and the
  `if (msg.type !== 'sentinelDocPdfText')` listener.
- There is NO PDF bullet in the file header (the earlier attempt wrongly looked
  for one — that bad anchor aborted the script).
- Everything AFTER the doc block (broadcastToSidePanel, polling, config init,
  migration) must be KEPT — the block does NOT run to EOF.

## 4. `content-scripts/triage-lens/page-world.js` (surgical)
Remove document interception, keep task-list:
- Delete `ENTRIES_RE`, `PREVIEW_RE`, `TAIL_RE`, `tailId()`, `handleDoc()`.
- `isInteresting(u)` → `return TL_RE.test(u);` only.
- In both the fetch and XHR handlers, drop the `else { … handleDoc … }` branch;
  keep the `handleTaskList` path.
- Remove the `ch-doc-entries` / `ch-doc-preview` mentions from the header comment.

## 5. The 5 document chips
**Container key is `systemChips`** (NOT `chips`). The 5 keys:
`detail.docType`, `detail.docSpecialty`, `detail.docEntries`, `detail.docUrgent`,
`detail.docAction`. Remove them from ALL of:
- `defaults.json` (root) → `systemChips`
- `content-scripts/triage-lens/defaults.json` → `systemChips`
- `content-scripts/triage-lens/content.js` → the **`EMBEDDED_DEFAULTS`** value.
  This is a **template literal**: `const EMBEDDED_DEFAULTS = ` + backtick + JSON +
  backtick + `;`. The drift test (`test-triage-defaults.js`) extracts it with
  `/const EMBEDDED_DEFAULTS = ` + backtick + `([\s\S]*?)` + backtick + `;/` and
  requires the parsed object to `deepStrictEqual` the file `defaults.json`. So all
  three copies must end up identical, and the literal must remain a backtick
  template with no backticks/`${` inside.
- `content-scripts/triage-lens/options.js` → remove the 5 metadata rows whose id
  is one of the above (each is a self-contained `{ id: 'detail.docX', … },` row).

## 6. `content-scripts/triage-lens/content.js` doc CODE (surgical, ~2665 lines)
This is the risky file — it holds the queue feature. Verified doc constructs
(line numbers from the last good read; re-locate by anchor before editing):
- `const isDocumentTask = () => …;` (≈900)
- `const extractDocumentTaskInfo = () => { … };` (≈902–~933)
- the detail-render usages of `docInfo` (≈1924–1963): the
  `const docInfo = isDocumentTask() ? extractDocumentTaskInfo() : null;` decl and
  every `if (docInfo) { … }` block / `runDocContextChips(); requestDocPdfText();`
  call, and the `log(... docInfo)` reference.
- `const injectDocContextInterceptor = () => { /* no-op */ };` (≈2020) and its
  call site `injectDocContextInterceptor();` (≈2640).
- The whole doc-context section ≈2028–2189: `_docCtx`, `_docPdfRequestedFor`,
  `_docCtxMaybeClearPdf`, the `ch-doc-entries` / `ch-doc-preview` listeners,
  `extractDocContextText`, `DOC_NEGATION_RE`, `matchDocTerm`, `DOC_URGENT_RE`,
  `DOC_ACTION_RE`, `requestDocPdfText`, `runDocContextChips`, and the `.ch-doc-ctx`
  span injection/removal.
- Remove declarations and their call sites **together** — removing a function but
  leaving its caller is a runtime ReferenceError (won't be caught by `node --check`
  or the tests, which don't exercise content.js behaviour).

## 7. Verify (do not trust terminal/Read display if it looks corrupted)
- `npm test` must be all green (especially the defaults-drift test).
- `node --check` each edited `.js`.
- Grep that no doc residue remains anywhere except this file and `CHANGELOG.md`:
  `offscreen`, `sentinelDocPdfText`, `ch-doc-entries`, `ch-doc-preview`,
  `requestDocPdfText`, `runDocContextChips`, `extractDocumentTaskInfo`,
  `isDocumentTask`, `_docCtx`, `detail.doc`, `extractPdf`, `abToBase64`.
- Confirm `vendor/pdf*.js` still present.
- **Verify the committed blobs from git's object store** (content-addressed), not
  the working-tree display, before declaring done.

## 8. Finish
- Delete this file as part of the removal commit.
- Bump `manifest.json` to v3.12.0 + add a CHANGELOG entry (or `npm run bump minor`).
