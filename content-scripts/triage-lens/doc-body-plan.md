# Document Body — Implementation Plan

## Phase 0 — Discovery (DONE 2026-05-30)

Discovery ran on a live `document_task`. Confirmed endpoint chain (site `560b6c`):

| Step | Endpoint | Type | Carries |
|---|---|---|---|
| 1 | `/tasks/data/document/overview/{taskUuid}` | JSON | `data.fileId` |
| 2 | `/clinical/data/document/modals/version/preview/{versionId}` | JSON | `attachment`, `inboundMessage`, `documentId`, `document.typeLabel` |
| 3 | `/tasks/data/document/file/document-preview/{fileId}` | JSON | `rendersAsPdf`, `conversionInProgress`, `conversionFailed`, `conversionFailureReason` |
| 4 | `/clinical/document/entries/{documentId}` | JSON | `entries`, `sortOrderHash` |
| 5 | **`/clinical/document/download-file/{fileId}?convertToPDF=1`** | **application/pdf** | **the letter body** |

**Outcome: B (binary PDF).** The authoritative letter body is a PDF at step 5.
Medicus server-side converts source formats to PDF (`convertToPDF=1`, with
`conversionInProgress`/`conversionFailed` flags surfaced at step 3).

**Open question (Probe 2 resolves this):** steps 2 and 4 are JSON and *may* carry
the text directly:
- `inboundMessage` (step 2) — for electronic letters, often the plain-text covering message
- `entries` (step 4) — possibly text leaves, possibly only coded items

If either carries usable prose, we skip PDF.js entirely (much simpler). If both
are empty / codes-only, we need PDF.js on the step-5 PDF via the service worker.

### ID plumbing
- `taskUuid` — from the page URL (`detectMedicusContext` already extracts it)
- `fileId` — from step 1 `data.fileId` (we already call step 1 in `resolveTaskToPatient`)
- `documentId` — from step 2 `documentId` / `document.id`
- `versionId` — from step 1 or the document-preview component; needs confirming

So `fetchDocumentBody` is: step 1 (have it) → fileId → step 5 PDF, OR step 1 →
step 2 → `inboundMessage`. Both start from the taskUuid already in the URL.

---

## Phase 0b — Probe 2 (run next)

Paste `doc-body-probe2.js` into the console on a document task page, then open a
document. It dumps the actual *values* of `inboundMessage` and `entries` so we can
choose the JSON path (simple) vs the PDF.js path (heavier). Report the output.

---

## (Superseded) Phase 0 — original discovery instructions

Paste `doc-body-discovery.js` into the browser console on a document task page
(`/tasks/data/document/overview/UUID`), then open or expand the letter.

---

## What each outcome means

### Outcome A — JSON with non-empty letterLeaves / body / content
*Console shows: `*** FOUND: letterLeaves = Array(N) ***` or similar*

The front-end fetches a second JSON endpoint after the overview. The URL logged will
look something like:
- `/tasks/data/document/content/{docUuid}` or
- `/care-record/data/document/leaves/{docUuid}` or
- `/tasks/data/document/overview/{taskUuid}` with a query param that triggers full body

**Implementation:**
1. Add `fetchDocumentBody(apiBase, docUuid)` to `engine/api-client.js` using `safeFetch`
2. Add a passive fetch interceptor to `content.js` (same pattern as `injectTaskListInterceptor`)
   that captures the body response and fires `CustomEvent('ch-doc-body', { text, docUuid })`
3. In `runDetail`, listen for `ch-doc-body` and feed the text into `buildFieldsData`

**Latency:** zero added — we capture what the page already fetches.

---

### Outcome B — Binary/PDF response
*Console shows: `*** BINARY RESPONSE *** Content-Type: application/pdf`*

The document is a PDF served at a URL we can observe. Two sub-cases:

**B1 — Typed PDF (has text layer):**
1. Content script captures the PDF URL from the interceptor
2. Sends `{ type: 'fetchDocPdf', url }` to the background service worker via `chrome.runtime.sendMessage`
3. Service worker fetches the PDF bytes (has host_permissions for the API domain), runs PDF.js,
   extracts text, returns it
4. Content script feeds text into the chips pipeline

**B2 — Scanned/faxed PDF (image-only, no text layer):**
PDF.js returns empty or near-empty text. The feature gracefully degrades to "no body text
available" — show no chip rather than a false signal.

**Latency:** 200ms–2s for PDF.js parse in the service worker, off main thread.

---

### Outcome C — `<iframe>` added with API src
*Console shows: `*** <iframe> added with src: https://....api.england.medicus.health/...`*

The document is rendered in an iframe. Cross-origin access to `contentDocument` is blocked
(api subdomain ≠ page origin). However, the iframe `src` URL is observable and is probably
a PDF or HTML endpoint — treat it as Outcome B (fetch the URL from the service worker).

---

### Outcome D — Nothing fires, text appears in DOM
*No new network calls after opening; letter text appears in a DOM element*

The body is rendered client-side from data already in the page JS. Use a `MutationObserver`
(already added to the discovery script) to watch for a container that receives the text.
Once the selector is identified, read it directly in the content script.

---

## Phase 1 — API client addition (after Outcome A confirmed)

In `engine/api-client.js`, add after `resolveTaskToPatient`:

```js
async function fetchDocumentBody(apiBase, taskTypeSlug, taskUuid) {
  // First: fetch the overview to get the documentId (different from taskUuid)
  const overview = await safeFetch(
    `${apiBase}/tasks/data/${taskTypeSlug}/overview/${taskUuid}`
  );
  const docId = overview?.data?.documentId
             || overview?.data?.document?.id
             || overview?.documentId
             || null;
  if (!docId) return null;
  // Then: fetch the body using the discovered endpoint (update URL below after Phase 0)
  const body = await safeFetch(`${apiBase}/DISCOVERED_ENDPOINT/${docId}`);
  return body;
}
```

Export it alongside the others.

---

## Phase 2 — Passive fetch intercept in content.js

Add a second page-world interceptor (or extend `injectTaskListInterceptor`) that also
watches for the document body URL pattern and fires:

```js
window.dispatchEvent(new CustomEvent('ch-doc-body', {
  detail: { docUuid, text: leaves.map(l => l.text || l.content || '').join('\n') }
}));
```

---

## Phase 3 — NLP chips (all deterministic, local only, no LLM)

Three new async chips modelled on `computeMonitoringChip`:

| Chip ID | Kind | Trigger phrases |
|---|---|---|
| `detail.docUrgent` | red | `2-week wait`, `2ww`, `suspected cancer`, `safeguarding`, `urgent referral`, `red flag` |
| `detail.docAction` | amber | `please arrange`, `GP to`, `we recommend`, `please prescribe`, `follow-up in`, `kindly` |
| `detail.docMedChange` | amber | `please start`, `commence`, `discontinue`, `stop` + drug name near `HIGH_RISK_DRUGS` |

Rules:
- All default `enabled: false` in defaults.json (opt-in)
- Negation check: skip matches preceded by `no \|not \|denies \|ruled out \|nil` (prevents "no evidence of cancer" firing)
- Ephemeral: body text never written to chrome.storage, cleared on `monitoringToken()` change
- If body text unavailable: show no chip (not a false all-clear)

---

## Safety invariants (non-negotiable)

- [ ] No patient text leaves the browser (no LLM calls, no telemetry)
- [ ] Body text variable is local-scope only — never assigned to a module-level variable
- [ ] Never written to `chrome.storage` — not added to any `shared/io/*-io.js`
- [ ] Staleness guard: discard body fetch result if `monitoringToken()` changed during fetch
- [ ] Chips are additive context only — no automated actions triggered
- [ ] All chips default `enabled: false` — require explicit opt-in in Settings
