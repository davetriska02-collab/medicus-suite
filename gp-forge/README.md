# GP Forge

A self-contained, on-prem LLM orchestrator for general practice — the standalone server in the
architecture sketched in [`../docs/plans/SURGERY-LLM-SERVER-PLAN.md`](../docs/plans/SURGERY-LLM-SERVER-PLAN.md).

> **Phase 1 = administrative / documentation support only. NOT a medical device.** Scope and the
> device-status boundary are fixed in
> [`../docs/INTENDED-PURPOSE-LLM-SERVER.md`](../docs/INTENDED-PURPOSE-LLM-SERVER.md). The PoC plan is
> [`../docs/plans/SURGERY-LLM-SERVER-POC.md`](../docs/plans/SURGERY-LLM-SERVER-POC.md). **Run against
> MOCK / test-patient data only until a fresh DPIA + DCB0160 are signed.**

## What it is

GP Forge is the thin **orchestrator** that sits between practice clients (the Medicus Suite
`ai-assist` module, other LAN PCs) and a local LLM. The heavy lifting — inference, embeddings, STT —
runs in containers (Ollama/vLLM, TEI, faster-whisper); GP Forge owns the **safety posture**:

- **Single, fail-closed egress.** On startup it probes a canary external host; if the box can reach
  the internet beyond the allow-listed Medicus host, it **refuses to start** (`src/egress-guard.js`).
  A dev override (`GPF_ALLOW_OPEN_EGRESS=true`) downgrades this to a loud warning for MOCK use only.
- **Phase-1 scope guard.** Only administrative/documentation tasks are accepted; anything that looks
  like clinical advice/decision-support is refused (`src/phase1.js`).
- **Constrained output, validated downstream.** Drafts are generated with JSON-schema-constrained
  decoding (format guaranteed) and re-validated in code (`src/validate.js`) — *format, not facts*.
- **Human-in-the-loop.** Every draft is returned with `review_required: true`; GP Forge **never**
  writes to Medicus.
- **Hash-chained audit.** Append-only, tamper-evident, storing **hashes** of content (not raw PHI)
  by default (`src/audit.js`).

## Run it

**Dev (no GPU, mock LLM):** the test suite exercises the whole server against a mock backend.

```
cd gp-forge
npm test        # 30 checks across guard / validate / audit / egress / server
```

**Dev against a real local model:**

```
cp .env.example .env          # set GPF_ALLOW_OPEN_EGRESS=true for dev/MOCK only
ollama serve & ollama pull qwen3:30b-a3b   # or run the full stack below
npm start
curl -s localhost:8089/healthz
curl -s -X POST localhost:8089/v1/draft \
  -H 'authorization: Bearer dev-key-alice' -H 'content-type: application/json' \
  -d '{"kind":"flu recall invitation","context":{"freeText":"invite eligible patients to the seasonal flu clinic"}}'
```

**Full stack (appliance):** `deploy/docker-compose.yml` brings up GP Forge + Ollama + LiteLLM +
Postgres + nginx. Pre-pull models with `deploy/pull-models.sh`, then lock egress and set
`GPF_ALLOW_OPEN_EGRESS=false`.

**Production concurrency (vLLM):** for real 5–20-concurrent-clinician throughput on one GPU
(e.g. an RTX PRO 6000 96GB running the 30B MoE), use `deploy/docker-compose.vllm.yml` instead — it
swaps Ollama for **vLLM** (PagedAttention + continuous batching) behind the same LiteLLM gateway:

```
docker compose -f deploy/docker-compose.vllm.yml up -d
```

The GP Forge orchestrator is **unchanged** — only the backend behind LiteLLM differs (everything is
OpenAI-compatible, so the swap is a config change). Pre-download the model weights into the
`hf_cache` volume before locking egress.

## API (Phase 1)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/healthz` | liveness + LLM reachability |
| GET | `/v1/info` | service info, phase, allowed tasks |
| POST | `/v1/draft` | administrative draft. Bearer key required. Guarded → constrained → validated → audited. Returns `{ draft, audit_id, review_required: true }`. `401` no key · `422` refused (out-of-scope/clinical) · `502` invalid output · `503` LLM down. |
| POST | `/v1/transcribe` | **verbatim** speech-to-text (Phase 1 — not a generative summary). Bearer key + raw audio body (`content-type: audio/*`, optional `x-filename`). Forwards to the local STT engine, audited. Returns `{ transcript, audit_id, review_required: true }`. `401` no key · `501` STT not configured · `503` STT down. |
| POST | `/v1/note` | **Phase 2 (medical-device-class) — DISABLED by default** (`GPF_ENABLE_PHASE2`). Generative SOAP summary of a transcript, **grounded** by verbatim evidence quotes (an ungrounded quote → rejected). `501` when disabled · `422` injected transcript · `502` invalid/ungrounded · `503` LLM down. **Not for clinical use without conformity assessment.** |
| POST | `/v1/corpus` | Ingest local guidance into the RAG store: `{ source, chunks: [text…] }` → embedded + stored. Requires embeddings configured (`501` otherwise). Corpus must be **licence-cleared**. |
| POST | `/v1/ask` | **Extractive/quote-only** local-guidance retrieval: `{ question }` → retrieve → answer **only** by citing verbatim quotes from the passages, with **refuse-when-off-corpus**. An ungrounded citation → `502`. Surfaces existing guidance; **not clinical advice**. `501` if RAG not configured. |
| GET | `/metrics` | Prometheus exposition (aggregate counters only, **no PHI**, no auth) — `gpf_actions_total{action}` etc. for monitoring/scraping. |
| GET | `/v1/audit/verify` | Bearer key. Hash-chain integrity check (`{ ok, count }` or `{ ok:false, brokenAt, reason }`) — cron/CSO-friendly. |
| GET | `/v1/audit/query` | Bearer key. Post-market-surveillance query over the audit log: `?action=&actor=&task=&since=&limit=`. Returns metadata records (content only if `storeContent`). |
| GET | `/v1/safety/summary` | Bearer key. CSO console: chain status + action counts + **flagged** events (refusals, rate-limits, caught fabrications, unavailability, off-corpus). |

## Layout

```
src/  config · llm-client (constrained) · stt-client (verbatim STT) · phase1 (scope guard) ·
      phase2 (gated SOAP, grounded) · schemas · validate · audit (hash chain) + audit-cli ·
      rate-limit · egress-guard (fail-closed) · server · index
test/ exit-code-driven suites (run standalone or under `node --test`)
deploy/ docker-compose · litellm.config.yaml · nginx.conf (streaming-safe) · pull-models.sh
```

## Not in Phase 1 (by design)

Generative clinical summarisation (Phase 2, ≥ MHRA Class 1), decision-support (Phase 3, ≥ Class IIa),
RAG/guidance retrieval (highest device-line risk + corpus licensing), and the autonomous
server-to-server Medicus connector (blocked on the Medicus partner-API question). See the plan §9½
for the build-vs-buy position (buy the assured AVT-registry scribe; build this augmentation layer).

*GP Forge is a separate subproject; it does not change the Medicus Suite extension and carries its
own version (`package.json`), independent of the extension's `manifest.json`.*
