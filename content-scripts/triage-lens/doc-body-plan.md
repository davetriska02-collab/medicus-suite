# Document Body — Implementation Plan

## Phase 0 — Discovery (run first)

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
