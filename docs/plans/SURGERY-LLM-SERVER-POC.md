# Surgery LLM Server — Phase 1 Proof-of-Concept Spec

*Status: implementation sketch. Pairs with `docs/plans/SURGERY-LLM-SERVER-PLAN.md` (architecture)
and `docs/INTENDED-PURPOSE-LLM-SERVER.md` (Phase-1 scope / device boundary). Code below is
illustrative skeleton, not production code. The PoC runs against MOCK / test-patient data only
until the DPIA + DCB0160 are signed.*

*Revised 2026-06-22 after review: single-egress specified as a fail-closed monitored control; STT
mis-transcription and prompt injection added as net-new hazards with release-gate tests; the review
gate given a measurable definition; exit criteria require a **fresh** DPIA + hazard log (not an
extension of the suite's); RAG corpus licensing flagged.*

---

## 0. What the PoC proves (and what it deliberately doesn't)

**Proves:** that a self-contained box on the LAN can (1) serve a 30B-class model over an
OpenAI-compatible endpoint to the Medicus Suite extension, (2) transcribe audio locally, (3) return
a useful, constrained, cited draft for a human to review, (4) do all of this with **no egress except
the one allow-listed Medicus link**, and (5) degrade gracefully — the suite behaves exactly as today
when the box is off.

**Deliberately NOT in the PoC:** generative clinical summarisation into the record (Phase 2,
Class 1), any decision-support (Phase 3, Class IIa), and the autonomous server-to-server Medicus
connector (blocked on the Medicus partner-API question — see plan §11). PoC is interactive,
browser-mediated, mock-data only.

**Build-vs-buy note:** the *generative scribe* (Phase 2) is now a commodity with ~23 assured
AVT-registry vendors who already hold Class 1 + DTAC + DSPT + DCB0129/0160 — buying it is the
pragmatic path. This PoC deliberately builds only the **self-hosted, no-egress** thesis and the
**Medicus-native augmentation layer** (the genuine white space), for the niche that cannot accept
any cloud processing. If that niche doesn't apply to a given practice, buy the scribe and build only
the `ai-assist` layer (see plan §9½).

**Exit criteria → Phase 2:** see §6.

---

## 1. Bill of materials

### Hardware (single appliance)

| Item | PoC spec | Production target | ~£ (PoC) |
|------|----------|-------------------|----------|
| GPU | 1× RTX 5090 32 GB *or* RTX 6000 Ada 48 GB | RTX PRO 6000 Blackwell 96 GB | £2–7k |
| CPU / board | 16-core, PCIe 5.0 | same | £0.8k |
| System RAM | 64 GB (ECC if board allows) | ≥128 GB ECC | £0.3k |
| Storage | 2 TB NVMe (models + vector DB + logs) | 2× NVMe (RAID1) | £0.2k |
| PSU | 1000–1200 W (or 300 W Max-Q card) | same | £0.2k |
| UPS | small line-interactive | rack UPS | £0.2k |
| Network | 2.5/10 GbE to the LAN switch | same, dedicated VLAN | — |

A 5090-based box (~£3.5k all-in) is enough to prove the PoC on a 30B MoE; the 96 GB card is the
production buy once value is shown.

### Software (all open-weight / permissive licence, self-hosted)

| Layer | PoC pick | Notes |
|-------|----------|-------|
| Inference | **Ollama** (lowest ops) → migrate to **vLLM** for concurrency | Both OpenAI-compatible; swap by URL. |
| Model | **Qwen3-30B-A3B** (Apache-2.0) | gpt-oss-20b as the lighter fallback. |
| Gateway | **LiteLLM** | virtual keys, per-user quotas, audit log. |
| Edge | **nginx** | TLS (internal CA), concurrency cap; `proxy_buffering off` for streaming. |
| STT | **faster-whisper** OpenAI-compatible server | verbatim transcription only in Phase 1. |
| Embeddings | **TEI** serving **bge-m3** | for the retrieval/signposting function. |
| Vector DB | **pgvector** in Postgres | Postgres also backs LiteLLM keys/audit — one fewer service. |

> **RAG corpus caveat:** BNF/NICE text is **not freely redistributable** — a local guidance corpus
> must be licence-cleared before indexing. Retrieval is also the highest device-line risk (plan §7c
> / the intended-purpose statement); keep it extractive/quote-only, or defer it past the PoC.

---

## 2. Network & security checklist (PoC)

- [ ] Appliance on its **own VLAN**; inbound only from clinician subnets to the nginx endpoint.
- [ ] **Default-deny egress**, allow-list **only** the Medicus API host — implemented as a
      **continuously monitored, fail-closed runtime control** (not a one-time check): if egress
      integrity can't be verified, the box refuses to process PHI. The egress test below is the
      *start* of this control, not the whole of it.
- [ ] TLS via internal CA; per-clinician LiteLLM virtual key (no shared key).
- [ ] Append-only audit log {who, when, model+version, inputs, outputs, reviewer, action}.
- [ ] **Decide consciously:** whether prompts/responses are stored. LiteLLM stores them **plaintext**
      when enabled → if yes, DB encryption-at-rest + retention (`"7d"`) + lock the logging callback.
- [ ] Audio retention policy: transient audio deleted post-transcription.
- [ ] **STT verification UX:** verbatim transcripts shown as *unverified* and read against source;
      mis-transcription (inverted negation / wrong dose / wrong drug) treated as a logged hazard.
- [ ] **Committed adversarial / prompt-injection test** that fails CI before any RAG or record
      content can enter a model context (cf. `test-drug-brand-coverage.js`).
- [ ] **PoC uses MOCK data only** until DPIA + DCB0160 signed.

---

## 3. The `ai-assist` side-panel module

Follows the module convention in `CLAUDE.md` (ES module exporting `init(container)`/`cleanup()`,
registered in `panel.js` **and** `pop-out.js`, nav-tab in both HTML shells). It is **panel-and-popout**
(a real module), unlike the panel-only `visualiser`/`about` exceptions.

### 3a. `manifest.json` — host permission for the appliance

```diff
   "host_permissions": [
     "https://*.medicus.health/*",
     "https://*.api.england.medicus.health/*",
-    "https://api.github.com/repos/davetriska02-collab/medicus-suite/*"
+    "https://api.github.com/repos/davetriska02-collab/medicus-suite/*",
+    "https://ai.surgery.local/*"
   ],
```
*(Use the appliance's internal-CA hostname. Avoid wildcard LAN ranges. This change is a hazard-log
entry: it widens where the extension may send data.)*

### 3b. Module registration

`side-panel/panel.js` and `pop-out/pop-out.js` — add to the `MODULES` map:
```js
  'ai-assist': { js: () => import('./modules/ai-assist/ai-assist.js'), css: './modules/ai-assist/ai-assist.css' },
```
`side-panel/panel.html` and `pop-out/pop-out.html` — add the nav tab:
```html
<button class="nav-tab" data-module="ai-assist">AI Assist</button>
```

### 3c. `side-panel/modules/ai-assist/ai-assist.js` (skeleton)

```js
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — AI Assist module (Phase 1)
// Client for the local Surgery LLM Server. PHASE 1 ONLY: verbatim transcription,
// administrative drafting, local-guidance retrieval/signposting, reformatting.
// NO generative clinical summary, NO decision support (see
// docs/INTENDED-PURPOSE-LLM-SERVER.md). Degrades gracefully when the server is off.
//
// Storage: aiAssist.config (server URL, virtual key ref, enabled flag)
'use strict';

let container = null;
let _cfg = { baseUrl: '', enabled: false };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Server reachability: never block the panel on the LLM box ──────────────────
async function probe() {
  if (!_cfg.enabled || !_cfg.baseUrl) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${_cfg.baseUrl}/v1/models`, {
      headers: authHeaders(), signal: ctrl.signal,
    });
    clearTimeout(t);
    return r.ok;
  } catch { return false; } // offline → caller renders the graceful-degradation notice
}

function authHeaders() {
  // Virtual key fetched from the gateway per clinician; never a shared god-key.
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${_cfg.keyRef || ''}` };
}

// ── A Phase-1 call: administrative draft, constrained to a schema ──────────────
async function draftAdminText({ kind, context }) {
  const body = {
    model: 'qwen3-30b',
    messages: [
      { role: 'system', content: PHASE1_GUARD }, // "admin/reference only; no clinical advice"
      { role: 'user', content: buildPrompt(kind, context) },
    ],
    // Constrained decoding → schema-valid output by construction (format, not facts).
    response_format: { type: 'json_schema', json_schema: ADMIN_DRAFT_SCHEMA },
    temperature: 0.2,
  };
  const r = await fetch(`${_cfg.baseUrl}/v1/chat/completions`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}`);
  const out = await r.json();
  return validateDownstream(JSON.parse(out.choices[0].message.content)); // range/format checks
}

// ── Init / cleanup ─────────────────────────────────────────────────────────────
export async function init(el) {
  container = el;
  _cfg = await loadConfig(); // chrome.storage.local: aiAssist.config
  const up = await probe();
  if (!up) {
    container.innerHTML = offlineNotice(); // "Local AI server not reachable — Phase-1 features unavailable"
    return; // suite continues to work everywhere else, unchanged
  }
  renderUi(container); // transcription pane, admin-draft pane, guidance-search pane
  // Every draft is shown with an explicit "review & edit before use" gate;
  // nothing is written to Medicus by this module.
}

export function cleanup() {
  container = null;
}
```

### 3d. Backup IO (per `CLAUDE.md` convention)

The module persists `aiAssist.config`, so add `shared/io/ai-assist-io.js` with
`aiAssistExport()` / `aiAssistImport(data)`, register the scope in `shared/io/suite-envelope.js`
`VALID_SCOPES`, wire it into `doFullExport()` / `applyEnvelope()` in `options/options.js`, add a
preview line, and add the `<script>` + an export card to `options/options.html`. **Note:** the
server URL/key reference is config, not patient data — never back up patient content.

### 3e. Graceful degradation (the non-negotiable)

- Server unreachable → module shows an offline notice; **every other tab and the rules engine work
  exactly as today.** No clinical feature depends on the LLM.
- The optional engine-side enrichment (annotating existing chips) is wrapped the same way: if the
  probe fails, chips render exactly as they do now.

---

## 4. `docker-compose.yml` for the appliance (PoC)

```yaml
# Surgery LLM Server — Phase 1 PoC stack. Mock-data only until DPIA + DCB0160 signed.
# No service has internet egress; the host firewall allow-lists ONLY the Medicus API host.
services:
  ollama:                         # inference (swap for a vllm service in production)
    image: ollama/ollama:latest
    deploy: { resources: { reservations: { devices: [{ capabilities: [gpu] }] } } }
    volumes: [ollama_models:/root/.ollama]
    # model pre-pulled offline: `ollama pull qwen3:30b-a3b`
    restart: unless-stopped

  stt:                            # faster-whisper, OpenAI-compatible /v1/audio/transcriptions
    image: fedirz/faster-whisper-server:latest-cuda
    deploy: { resources: { reservations: { devices: [{ capabilities: [gpu] }] } } }
    environment: [WHISPER__MODEL=large-v3, WHISPER__COMPUTE_TYPE=int8]
    restart: unless-stopped

  tei:                            # embeddings (bge-m3) for retrieval/signposting
    image: ghcr.io/huggingface/text-embeddings-inference:latest
    command: ["--model-id", "BAAI/bge-m3"]
    deploy: { resources: { reservations: { devices: [{ capabilities: [gpu] }] } } }
    restart: unless-stopped

  postgres:                       # pgvector (RAG) + LiteLLM keys/audit in one DB
    image: pgvector/pgvector:pg16
    environment: [POSTGRES_PASSWORD=__set_me__, POSTGRES_DB=ai]
    volumes: [pg:/var/lib/postgresql/data]
    restart: unless-stopped

  litellm:                        # gateway: virtual keys, quotas, audit, OpenAI-compatible
    image: ghcr.io/berriai/litellm:main-stable
    depends_on: [ollama, postgres]
    environment:
      - LITELLM_MASTER_KEY=sk-__set_me__
      - DATABASE_URL=postgresql://postgres:__set_me__@postgres:5432/ai
    volumes: [./litellm.config.yaml:/app/config.yaml]
    command: ["--config", "/app/config.yaml"]
    restart: unless-stopped

  nginx:                          # TLS edge (internal CA); the ONLY port exposed to the LAN
    image: nginx:stable
    depends_on: [litellm]
    ports: ["443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro      # proxy_buffering off; concurrency cap; long read timeout
      - ./tls:/etc/nginx/tls:ro
    restart: unless-stopped

volumes: { ollama_models: {}, pg: {} }
```

`litellm.config.yaml` (sketch) — note: **only** local backends, so there is no code path to the
internet for inference:
```yaml
model_list:
  - model_name: qwen3-30b
    litellm_params: { model: ollama/qwen3:30b-a3b, api_base: http://ollama:11434 }
general_settings:
  master_key: sk-__set_me__
  database_url: postgresql://postgres:__set_me__@postgres:5432/ai
  # store_prompts_in_spend_logs: decide consciously (plaintext when on) — default OFF for the PoC
```

---

## 5. PoC walkthrough (one happy path)

1. Clinician opens **AI Assist** in the side panel. Module probes the box (`/v1/models`), renders.
2. Clinician dictates; audio → `stt` → verbatim, speaker-labelled transcript shown for the clinician
   to read/verify. (Phase 1: transcript only — no generated note.)
3. Clinician clicks "draft recall invitation" for a **mock** cohort; `ai-assist` → nginx → LiteLLM →
   Ollama with a JSON-schema-constrained request; draft returned, passed through downstream
   validation, shown with an explicit **review-and-edit** gate.
4. Clinician searches local guidance; `tei` + `pgvector` return cited passages — surfaced, not
   synthesised into advice.
5. Pull the box's power: every other suite tab and the rules engine keep working unchanged.

---

## 6. Exit criteria (PoC → Phase 2 build)

- [ ] Single-egress control demonstrably enforced (egress test passes).
- [ ] 5–20 simulated concurrent users at acceptable latency on the chosen GPU.
- [ ] Constrained decoding yields 100% parseable output across the test schemas; downstream
      validators catch injected bad values.
- [ ] Graceful degradation verified (box off → suite unaffected).
- [ ] Audit log captures who/what/when/reviewer for every call.
- [ ] **Review gate is *evidenced*, not theatre:** source span shown beside each drafted line,
      keystroke-level edit deltas logged, drafts filed *unedited* flagged for audit (a measurable
      pass, not a yes/no opinion).
- [ ] Governance readiness: a **fresh** high-risk DPIA (the suite's is invalidated by runtime AI +
      egress) and a **new** Phase-1 hazard log whose top hazards (hallucination, prompt injection,
      STT error) are absent from the suite's 35-hazard register; CSO engaged, Caldicott briefed.
- [ ] **Medicus partner-API question answered** before any Phase-2 autonomous/server-to-server work.

Only when these pass — and the governance artefacts are signed — does Phase 2 (generative scribe as a
registered Class 1 device) begin.
