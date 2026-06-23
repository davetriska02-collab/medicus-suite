# Surgery-Hosted LLM Server — Architecture & Controls Sketch

*Status: discussion sketch / research synthesis. Not a committed build plan, not a clinical-safety
artefact. Author: Claude (Opus) at Dave's request, 2026-06-22. Everything here is grounded in a
~20-thread primary-source research sweep done the same day; load-bearing regulatory dates and
fast-moving model facts must be re-verified against the cited primaries before any of it becomes a
real procurement or DPIA input.*

*Revised 2026-06-22 after a `virtual-dave` review. Corrected the governance-inheritance claim (this
needs a **fresh** DPIA + hazard log — the suite's are premised on no-runtime-AI/no-egress and are
**invalidated**, not extended); hardened single-egress into a fail-closed runtime control; added the
net-new clinical-safety hazards (STT error, confident hallucination, LLM-vs-rule divergence, prompt
injection) and an evidenced review gate; flagged the RAG/retrieval function as the highest
device-line risk; and added a Build-vs-buy section (§9½). The self-hosted direction is retained
deliberately — the genuine niche is practices/contexts that cannot accept **any** cloud processing.*

---

## 0. The one-paragraph version

Put a single, self-contained inference appliance in the surgery comms cupboard. It runs an
open-weight LLM (not Kimi K2 — that's a ~1-trillion-param model that needs a ~$40k cluster; the
realistic on-prem tier is **30B-class**), an OpenAI-compatible serving stack, a local speech-to-text
engine for the scribe, and a retrieval index over local clinical guidance. Every PC in the surgery
talks to **one** internal API on that box; the box has **exactly one** permitted egress — an
allow-listed connection to the Medicus clinical API — and **no** other internet access. That single
design choice (data never leaves the practice perimeter, no cloud LLM, no third-party processor)
is what collapses most of the data-protection problem. The hard part is **not** the silicon or the
model; it's the governance: the moment a feature is *claimed* to inform diagnosis/triage/risk it
becomes a regulated medical device, and a practice that *builds and runs* its own tool wears both
the manufacturer (DCB0129) and deployer (DCB0160) hats. The whole strategy is therefore:
**augment the existing deterministic rules engine, keep a clinician meaningfully in the loop on
everything, and stage features so the regulated-device ones come last and deliberately.**

---

## 1. Headline decisions (so the rest of the doc has a spine)

| # | Decision | Rationale (one line) |
|---|----------|----------------------|
| D1 | **One appliance, one Medicus port, zero other egress** | The data-protection case *is* the architecture (no transfer, no processor — see §8). |
| D2 | **30B-class open-weight model, not Kimi K2** | Kimi K2 = 1T MoE, ~594 GB INT4; needs a cluster. 30B MoE fits one GPU and serves 5–20 clinicians. |
| D3 | **Workhorse = Qwen3-30B-A3B (MoE) under vLLM** | 30.5B total / 3.3B active → 30B footprint, ~3B decode cost; Apache-2.0; best concurrency-per-watt. |
| D4 | **Single RTX PRO 6000 Blackwell (96 GB) is the target box** | Runs 30B MoE with huge batching *or* 70B FP8 for 13–26 users; one device, ECC, ~£8k. |
| D5 | **Augment the rules engine; never replace it** | UK case-finding/recall is deterministic and proven (QOF/PINCER/eFI). LLMs there are still experimental. |
| D6 | **Meaningful human-in-the-loop on every clinical output** | Keeps us out of "solely automated" (UK GDPR Art 22B) *and* off the worst of the MHRA device ladder. |
| D7 | **Stage by regulatory risk: admin → scribe → decision-support** | Phase 1 is (likely) not a medical device; Phase 3 is Class IIa and goes through proper conformity / the MHRA AI Airlock. |
| D8 | **Structured/constrained decoding for every machine-read output** | Guarantees *format*, eliminates parse-failure branches — but does **not** guarantee facts (validate downstream). |

---

## 2. Design principles

1. **Local by default, single controlled link.** The appliance is air-gapped from the internet
   except a firewall-allow-listed route to the Medicus API host. Models and updates are
   side-loaded (signed bundles on removable media or via that one link), never pulled from the
   open internet at runtime.
2. **Read-mostly, write-deliberately.** Mirror the existing Medicus Suite posture: the suite today
   is read-only over Medicus. Any *write-back* (a coded entry, a draft letter) is a separate,
   explicit, audited capability that a human approves.
3. **Augment, don't replace.** The suite already has a deterministic rules engine
   (`engine/rules-engine.js`: drug-monitoring, QOF registers/indicators). The LLM adds
   *narrative, synthesis, drafting and pattern-surfacing* on top — it never silently overrides a
   rule, and the rules keep working if the LLM is offline.
4. **Human-in-the-loop is non-negotiable and must be *meaningful*.** A clinician reviewing a
   confident draft they didn't really read is the central failure mode (automation bias + plausible
   hallucination). Design for *real* review: show provenance, force edit-before-file, log that
   review happened.
5. **Format-guaranteed, fact-checked.** Constrained decoding makes outputs schema-valid by
   construction; semantic validation (range checks, code-set validation, cross-field consistency)
   happens in our code, not the model's "safety."
6. **Everything is logged, tamper-evidently.** Who asked, what model/version, what context went in,
   what came out, who reviewed it. This is both a clinical-safety control and the audit trail the
   regulators expect.
7. **Graceful degradation.** LLM down → suite falls back to today's behaviour. No clinical feature
   becomes *dependent* on the LLM for safety.

---

## 3. Target architecture

```
                          SURGERY LAN (its own VLAN, default-deny egress)
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │                                                                                    │
   │   Clinician PCs (Chrome + Medicus Suite ext.)        Reception PCs / batch jobs    │
   │        │  mic audio (scribe)    │ patient snapshot         │                       │
   │        ▼                        ▼                          ▼                       │
   │   ┌────────────────────────────────────────────────────────────────────────────┐ │
   │   │  EDGE: nginx / Traefik  — TLS (internal CA), concurrency cap, rate limit     │ │
   │   └────────────────────────────────────────────────────────────────────────────┘ │
   │                                   │  (one internal HTTPS endpoint)                 │
   │   ┌────────────────────────────────────────────────────────────────────────────┐ │
   │   │  GATEWAY: LiteLLM  — per-user/team virtual keys, quotas, audit log, routing  │ │
   │   └────────────────────────────────────────────────────────────────────────────┘ │
   │        │                     │                      │                  │           │
   │        ▼                     ▼                      ▼                  ▼           │
   │   ┌─────────┐         ┌──────────────┐      ┌──────────────┐    ┌──────────────┐  │
   │   │  vLLM   │         │  STT server  │      │  Embeddings  │    │  Guardrails  │  │
   │   │ 30B MoE │         │ Parakeet /   │      │  (TEI) +     │    │ (Llama Guard │  │
   │   │ +struct │         │ faster-whisper│     │  pgvector/   │    │  / NeMo) +   │  │
   │   │ decode  │         │ + pyannote   │      │  Qdrant RAG  │    │  validators  │  │
   │   └─────────┘         └──────────────┘      └──────────────┘    └──────────────┘  │
   │                                                                                    │
   │   ┌────────────────────────────────────────────────────────────────────────────┐ │
   │   │  ORCHESTRATOR (thin app): tool-loop, RAG, audit, write-back queue            │ │
   │   └────────────────────────────────────────────────────────────────────────────┘ │
   │                                   │                                                │
   └───────────────────────────────────┼────────────────────────────────────────────-─┘
                                        │  ❶ THE SINGLE PERMITTED EGRESS
                                        ▼     (firewall allow-list: Medicus API host only)
                              ┌────────────────────┐
                              │   Medicus cloud API │   *.api.england.medicus.health
                              └────────────────────┘
```

**Two integration topologies, and why we want both:**

- **Browser-mediated (interactive).** For scribe and per-patient assistance, the existing Medicus
  Suite extension already gathers the patient snapshot from Medicus via the clinician's
  authenticated session (`engine/api-client.js`, credentialed `fetch` to
  `https://{siteId}.api.england.medicus.health`). It POSTs that snapshot to the local server,
  gets a draft back, the clinician reviews, and write-back goes through the same browser session.
  *Here the LLM box never touches Medicus directly* — data path is Medicus → browser → LAN box →
  browser. Cleanest for IG.
- **Server-to-server (autonomous).** For overnight population/recall scans there's no browser open,
  so the box needs the **single API port to Medicus** you described — a server-side connector
  (proper API credential, not session cookies) that is the *only* thing allowed out. This is the
  one egress on the firewall. **Dependency/risk:** this requires Medicus to expose a partner/server
  API with appropriate auth and scope; the suite today rides the *user's* session, which doesn't
  exist for a headless job. Confirm what Medicus actually offers before committing to autonomous
  batch features (see §11).

Everything else — every clinician PC, reception PC, batch worker — talks **only** to the gateway's
internal endpoint. That is the "talk to all the network PCs" surface, and it's all inbound to the
box.

---

## 4. The "Kimi or similar" question — model selection

**Short answer: not Kimi K2.** It's a ~1.04-trillion-parameter Mixture-of-Experts model
(32B active, 384 experts). Even at its native INT4 it's ~594 GB of weights; FP8 is ~1 TB. The
configurations people actually run it on are a 4× Mac Studio cluster (~$40k, ~25 tok/s) or an
8×H200 node. On any single affordable surgery box it either doesn't fit or crawls at a few tok/s
with quality-destroying 1.8-bit quantisation. It's an "API/datacentre tier" model. (Licence is fine
— modified-MIT, the 100M-MAU attribution clause is irrelevant at GP scale — but the hardware kills
it.)

**The realistic on-prem tier is 30B-class.** A 30B *MoE* is the sweet spot: it has a 30B model's
VRAM footprint but a ~3B model's decode cost, which is exactly what you want for many concurrent
clinicians.

### Candidate models (all self-hostable, commercial-OK)

| Model | Params (active) | Arch | Licence | Ctx | ~Q4 VRAM | Notes |
|-------|-----------------|------|---------|-----|----------|-------|
| **Qwen3-30B-A3B** ⭐ | 30.5B (3.3B) | MoE | **Apache-2.0** | 32K→256K | ~18.6 GB | Workhorse. Fast (3.3B active), clean licence, strong. 2507 builds do 256K + split instruct/thinking. |
| **gpt-oss-20b** | 21B (3.6B) | MoE (MXFP4) | **Apache-2.0** | 128K | ~16 GB | Lightest good option; ships native MXFP4; runs on a 16–24 GB card. Needs "harmony" format. |
| **Llama 3.3 70B** | 70.6B | Dense | Llama Community | 128K | ~42 GB | Strongest single model here; FP8 fits the 96 GB card (~31–34 tok/s, 13–26 users). "Built with Llama" branding. |
| **Mistral Small 3.2** | 24B | Dense | **Apache-2.0** | 128K | ~14 GB | Vision-capable, single-24 GB-GPU friendly. |
| **Gemma 3 27B** | 27.4B | Dense | Gemma Terms | 128K | ~14 GB (QAT int4) | Multimodal; Google ships official QAT-int4 weights. Pass-through use restrictions. |
| **Phi-4 14B** | 14.7B | Dense | **MIT** | **16K only** | ~9 GB | Cleanest licence; but 16K context is limiting for long records. |
| **MedGemma 27B / 4B** | 27B / 4B | Dense | HAI-DEF | 128K | ~20 GB / ~7 GB | *Only* purpose-built medical model — but **explicitly research-only**: "not intended to directly inform clinical diagnosis… validate before deployment." Useful as a fine-tune base, **not** a drop-in clinical product. |

**Recommendation:** start on **Qwen3-30B-A3B** for general drafting/synthesis/extraction; keep
**gpt-oss-20b** as the low-footprint fallback; hold **Llama 3.3 70B** in reserve for the hardest
summarisation if the 96 GB card is bought. Treat **MedGemma** as a *research/fine-tune* avenue,
not a clinical answer — its own card forbids unvalidated clinical use, and using it for decision
support would pull in MHRA + DCB obligations regardless.

> ⚠️ The model landscape moves monthly. By the time anyone builds this, re-check the current best
> 30B-class instruct model and its licence file. The *architecture* (30B MoE on one GPU under vLLM)
> is the durable decision; the exact checkpoint is not.

### Supporting models

- **Speech-to-text (scribe):** **Parakeet-TDT-0.6B** (NVIDIA, CC-BY-4.0, English, ~6% WER, huge
  throughput, built-in word timestamps) *or* **faster-whisper / WhisperX large-v3** (MIT, 99
  languages) for multilingual. **Diarisation** via **pyannote 3.1** (MIT). All of this fits a single
  8–12 GB GPU — the STT layer is cheap; the LLM is where the VRAM budget goes.
- **Embeddings (RAG):** **bge-m3** (MIT, multilingual, 8K context, dense+sparse+multi-vector in one
  pass) or **multilingual-e5-large** (lightweight, non-English) or **Qwen3-Embedding**. Mind the
  prefix conventions and pgvector's 2000-dim index cap (use 768–1024-dim models or `halfvec`).

---

## 5. Hardware — the box

**Two numbers decide everything:** *memory bandwidth* governs single-user token speed (decode is
memory-bound), *VRAM capacity* governs how many concurrent users you can batch.

| Option | VRAM / BW | Runs | Concurrency (interactive) | ~£ | Verdict |
|--------|-----------|------|---------------------------|----|---------|
| **RTX PRO 6000 Blackwell** ⭐ | 96 GB / 1.79 TB/s | 30B MoE w/ huge KV headroom; **or 70B FP8** | 30B: comfortably 20–40; 70B FP8: 13–26 | ~£8k | **Target.** One device, ECC, FP8/FP4. 300 W Max-Q variant for a quiet cupboard. |
| RTX 6000 Ada | 48 GB / 960 GB/s | 14–32B comfortably; 70B Q4 low-concurrency | ~10–20 (32B) | ~£6–7k | Cheaper fallback if you stay ≤32B. |
| RTX 5090 | 32 GB / 1.79 TB/s | 30B MoE | ~5–15 | ~£2–2.8k | Surprisingly strong *budget* box for a 30B MoE; no ECC, KV-cache-capped. |
| Mac Studio M3 Ultra | up to 512 GB / ~820 GB/s | very large models load | **only 1–4** | £8k+ | Great single-user big-model box; **poor at 5–20 concurrent** (weak batched serving, slow prefill on long records). Not recommended for this. |
| 2× consumer GPU | 48–64 GB | 70B Q4 | concurrency win | varies | NVLink gone on 40/50-series; PCIe-only ~1.4–1.5× scaling + driver-patch fragility. A single PRO 6000 usually beats it. |

Plus the boring-but-essential bits: ECC system RAM ≥128 GB, fast NVMe, a ~1000–1200 W PSU (or the
300 W Max-Q card), real cooling/acoustics for an office, and a **UPS**. There's even a 2025 paper
benchmarking private Qwen3-30B servers on exactly this class of hardware — worth reading before
buying.

---

## 6. Software stack

| Layer | Pick | Why | Caveat |
|-------|------|-----|--------|
| **Inference** | **vLLM** (start on **Ollama** for the PoC) | PagedAttention + continuous batching = the concurrency lever; OpenAI-compatible. Ollama is the lowest-ops way to *start*. | vLLM is GPU/ops-heavy; Ollama caps out under sustained concurrency. Migrate when measured load demands. |
| **Gateway** | **LiteLLM** behind **nginx/Traefik** | Per-clinician virtual keys, per-user/team quotas, model routing, **audit log**, one stable endpoint. Edge does TLS + concurrency cap. | LiteLLM prompt/response logging is **off by default and *plaintext* when on** — if you log patient content, encrypt at rest + retention policy. For SSE streaming set `proxy_buffering off`. |
| **Structured output** | Constrained decoding: vLLM `structured_outputs`/XGrammar, llama.cpp GBNF, or Outlines | Schema-valid output *by construction* — no parse-failure branch. | Guarantees **format, not facts**. Don't use `tool_choice=required` for optional actions (it fabricates argument values). Pin the version (vLLM renamed `guided_*`→`structured_outputs` at v0.12.0). |
| **STT** | faster-whisper/WhisperX or Parakeet + pyannote | Real-time, on-prem, single modest GPU. | Whisper degrades in forced-streaming mode; chunk carefully. |
| **RAG** | TEI/Ollama embeddings + **pgvector** (or **Qdrant**) | pgvector if Postgres already present (fewest moving parts, SQL filtering, transactional). Qdrant if rich metadata filtering dominates. | pgvector HNSW index caps at 2000 dims; Chroma is RAM-bound. |
| **Quantisation** | **FP8/INT8 (W8A8)** if VRAM allows, else **4-bit weight-only (Q4_K_M / W4A16)** | FP8 ≈ lossless; Q4_K_M is the proven sweet spot. | **Never below 4-bit, never W4A8** for clinical — reasoning/factuality erode faster than perplexity shows, and *small* models suffer most. Bigger-model-at-4-bit > smaller-at-8-bit. Validate on task accuracy, not perplexity. |
| **Guardrails** | Llama Guard 3 / NeMo Guardrails + our own validators | Input/output safety classification, retrieval/exec rails, PII checks. | They *reduce*, never *eliminate*, risk. The real controls are our semantic validators + audit + the human gate. |
| **Orchestration** | Thin app + direct tool-loop; **LangGraph** only if flows get genuinely stateful | Anthropic's own data: start simple (augmented single LLM + tools); multi-agent burns ~15× tokens and rarely pays off here. | Avoid premature multi-agent complexity. |

---

## 7. The three services

### 7a. Ambient scribe service

**Pipeline:** mic capture at the clinician PC → stream to the local STT server (transcribe +
diarise clinician/patient) → LLM summarises the diarised transcript into a structured note
(SOAP/custom) with **constrained decoding** → clinician **reviews and edits** → write-back to
Medicus on approval. **Audio never leaves the LAN.** Transient audio is deleted after
transcription; the transcript/note retention is an explicit, documented policy.

**The regulatory line you must not cross by accident (this is the crux):**
- Producing a **verbatim transcript** that a clinician verifies → *likely not a medical device.*
- Using **generative AI to summarise** into the record → **likely a medical device, ≥ MHRA Class 1.**
- Generating **diagnoses / management plans / "call to action"** → **≥ Class IIa** (Approved Body,
  UKCA).
- This is verbatim NHS England AVT guidance, reinforced by the **9 June 2025 Priority Notification**
  that mandates *ceasing* use of any AVT product without ≥ Class 1 registration, DCB0160, a DPIA,
  DTAC, DSPT and Cyber Essentials Plus — with **both the organisation and the individual clinician**
  liable for non-compliant tools. There is now a national **AVT Self-Certified Supplier Registry**.

**Evidence it's worth it:** the GOSH/TORTUS NHS trial (>17,000 encounters) showed +23.5%
patient-facing time and note time roughly halved. **Counterweight:** peer-reviewed studies show
~70% of scribe notes contained at least one error, with documented hallucinations (exams that never
happened, invented diagnoses) and non-determinism. **Hence: review-before-file is the safety
control, not a nicety**, and the BMA explicitly warned GPs about the risks.

**Scribe-specific controls:** patient informed at the *start* of every session; consent/objection
handled (esp. sensitive consultations); vendor/own guarantee that **patient data is never used to
train the model** without a lawful basis; clinician edits the draft and that edit is logged.

### 7b. Patient recall / population-health / pattern detection

**Design steer from the research:** routine UK population-health and case-finding is **deterministic
and proven** — QOF registers, Ardens-style coded searches (~87% of practices), **PINCER** medication
-safety indicators (15–17% reductions in hazardous prescribing, GI-bleed aOR ~0.76), **eFI** and
**QRISK3**/**FAMCAT** statistical scores, OpenSAFELY-scale analytics. LLMs there are still
*experimental* (mostly coding/terminology mapping). **So the recall engine stays deterministic;
the LLM augments at the edges:**

- **Coding-gap and missed-monitoring surfacing** that's hard to express as a rigid rule (the suite's
  rules engine already does the rigid ones — extend it, per `engine/rules-engine.js`).
- **Cohort narrative summaries** for a clinician running a recall list ("12 of these 40 diabetics
  have an HbA1c overdue *and* an ACR never coded").
- **Drafting recall communications** (letters/SMS) for human approval.
- **SNOMED/ICD mapping suggestions** (LLM-assisted coding is the one genuinely maturing LLM use
  here) — always *suggestions* a human confirms.

**Critical control:** any *patient-facing significant decision* (e.g. auto-flagging someone for
review) made with health data and **no meaningful human involvement** runs into UK GDPR Art 22B
(the DUAA 2025 reforms, in force 5 Feb 2026, *kept* the special-category restriction). Keep these as
**worklists a human triages**, not autonomous decisions. And the autonomous/overnight version needs
the server-to-server Medicus connector (§3, §11).

### 7c. General agentic assistant (RAG over local guidance)

A single augmented LLM + tools + **RAG over a local corpus** (NICE/CKS/BNF/local formulary/practice
policies — the same sources the suite's rules already encode). Pattern: hybrid retrieve (dense +
keyword) → rerank → generate **with mandatory inline citations** → **refuse when off-corpus** →
human reads.

> ⚠️ **This is the highest device-line risk in the plan and the riskiest Phase-1 item.** The suite's
> existing signposting is defensible because it is *deterministic* (a chip that links to QRISK3 and
> computes nothing). A generative model *told* to behave like static reference text is one
> system-prompt regression away from synthesising a clinical recommendation (→ Class IIa). Controls:
> keep it **extractive / quote-only** (return cited source spans, never free-form synthesis) and
> gate it with a committed adversarial release test. Plus a **licensing landmine** — BNF/NICE text is
> not freely redistributable; the local corpus must be licence-cleared before indexing. Tools are narrow and least-privilege (look up a guideline, fetch a structured value,
draft a document). This is the "ask the practice's knowledge base" capability.

**The acute clinical threat here is indirect prompt injection** (OWASP LLM01): a poisoned
instruction hidden in a patient record or document flows through RAG into the context and hijacks
the model (medical-dialogue attack studies hit ~94% success). Defences: treat all
record/RAG content as untrusted, separate instructions from data, output validation, least-privilege
tools, human approval for any action, and adversarial testing as a release gate.

---

## 8. Controls & governance (the part that actually matters)

The technology is the easy 20%. Here's what a practice that *builds and runs* this must actually do.
A self-built tool means the practice is **simultaneously the manufacturer and the deployer**, so it
wears **both** clinical-safety hats.

### 8a. Regulatory / IG controls mapped to their driver

| Control / artefact | Driver | What it means here |
|--------------------|--------|--------------------|
| **Intended-purpose statement (written first)** | MHRA SaMD | The single document that decides device status. Write it before building. Admin/documentation = likely not a device; diagnosis/triage/risk = device. *(You already have `docs/INTENDED-PURPOSE.md` for the suite — extend that discipline.)* |
| **MHRA device classification + UKCA** (if/when applicable) | UK MDR 2002; MHRA | Generative summarisation → ≥ Class 1 (register with MHRA). Decision support → ≥ Class IIa (Approved Body, UKCA mark). The **AI Airlock** sandbox is the route for novel generative-AI devices (TORTUS was in Phase 2). |
| **DPIA (before go-live)** | UK GDPR Art 35(3)(b) + ICO "innovative tech" | Mandatory — novel AI on large-scale special-category data trips multiple high-risk triggers at once. *(⚠️ The suite's `docs/DPIA.md` is premised on "no AI inference at runtime… no external transmission" — this server **invalidates** that premise. A fresh, from-scratch high-risk DPIA is required, **not** an amendment.)* |
| **Lawful basis: Art 6(1)(e) public task + Art 9(2)(h) health/social care** | UK GDPR; DPA 2018 Sch 1 Pt 1 para 2 | Not consent. Plus an **Appropriate Policy Document** (DPA 2018 Sch 1 Pt 4). |
| **Clinical Safety Officer + Hazard Log + Clinical Safety Case Report** | **DCB0129 (manufacturer) + DCB0160 (deployer)** — statutory under s.250 HSCA 2012 | A registered clinician CSO; a living hazard log; a safety case. *(⚠️ A **fresh** hazard log — the suite's 35-hazard register covers a read-only, no-inference tool and contains **no** hazard for hallucination, prompt injection or STT error. Start a new log + safety case, dual-hatted; do not extend the suite's.)* |
| **DTAC pack** | NHS procurement baseline | Clinical safety (C1→DCB), data protection (C2→DPIA/DSPT), technical security (C3→Cyber Essentials), interoperability (C4), usability (D). *(You have `docs/DTAC-STATUS.md`.)* |
| **DSPT + Cyber Essentials (Plus)** | NHS Data Security & Protection Toolkit | Organisational security baseline; required to be on the AVT registry. |
| **Caldicott Guardian sign-off** | Caldicott Principles | The practice's Guardian owns the "is this a justified use of confidential data" call. |
| **Meaningful human involvement** | UK GDPR Art 22A/22B (DUAA 2025, live 5 Feb 2026) | Keeps it decision-*support*, not solely-automated decision-*making* on health data (still restricted). |
| **Patient transparency** | UK GDPR Arts 13/14; NHS AVT guidance | Tell patients AI supports (not replaces) clinical decisions; inform at session start for the scribe. |

**Why on-prem/no-egress is the strongest single mitigation:** it advances data minimisation
(Art 5(1)(c)) and security (Art 5(1)(f)/Art 32), and it **removes two entire compliance
workstreams** — no international transfer (Chapter V) and no third-party processor contract
(Art 28) — *provided the no-egress is genuine* (no vendor remote-support backdoor). That's the
core of the data-protection argument in this design's favour.

### 8b. Technical security controls

- **Network:** appliance on its own VLAN; **default-deny egress** with a single allow-list entry
  (Medicus API host); inbound only from surgery subnets to the gateway.
- **Single-egress is a *runtime* control, not a checklist tick — CSO sign-off depends on it.** It
  must be **continuously monitored, alerting, and fail-closed**: if egress integrity cannot be
  verified (an unexpected outbound route, a `:latest` image phoning home, a debug port left open),
  the appliance **refuses to process patient data**. A one-time PoC egress test is a snapshot, not a
  control.
- **Auth:** per-clinician virtual keys (LiteLLM) mapped to SSO; mTLS or short-lived tokens between
  clients and the box; no shared "god key".
- **Audit:** append-only, tamper-evident log of {who, when, model+version, inputs, outputs,
  reviewer, action}. EU AI Act Art 12 is a useful spec even pre-applicability: traceable, ≥6-month
  retention, records *who verified* a result. **Decide consciously** whether to store
  patient-identifiable prompts/responses; if yes, encrypt at rest + retention policy + lock the
  logging callback so it can't be silently disabled.
- **Updates:** signed model/software bundles, side-loaded; a staging/validation step before a new
  model version reaches clinicians (model swaps can change behaviour — treat as a change under
  DCB0160).
- **Prompt-injection defence:** untrusted-by-default handling of record/RAG content, output
  validation, least-privilege tools, human approval for actions, and a **committed adversarial test
  suite that fails CI** (the same discipline as `test-drug-brand-coverage.js`) — until injection
  defence is a failing-CI gate, it is aspirational.

### 8c. Clinical-safety controls (the human layer)

- **Evidenced edit-before-file:** not merely "logged that review happened" (that's theatre) —
  surface the source span beside each drafted line, log keystroke-level edit deltas, and flag drafts
  filed *unedited* for audit. This is the *measurable* definition of "the review gate is real".
- **Provenance on every claim** (citations / source spans) so review is *possible*, not theatre.
- **Refuse-when-uncertain / off-corpus** rather than confabulate.
- **Semantic validators** downstream of the model: dose/range checks, controlled-vocabulary/code-set
  validation, cross-field consistency — the schema won't catch a valid-but-wrong SNOMED or dose.
- **Automation-bias mitigation:** label AI content clearly; don't pre-tick; surface disagreement
  with the deterministic rules engine rather than hiding it.
- **Net-new hazards for the *fresh* hazard log (none are in the suite's 35-hazard register):**
  (1) **STT mis-transcription** — Whisper inverting a negation ("no chest pain"→"chest pain") or
  mangling a dose/drug name, presented as a *faithful* verbatim transcript; a Phase-1 hazard that
  exists the day transcription ships. (2) **Confident hallucination + automation bias** — a fluent,
  wrong draft is a nastier over-trust surface than an over-trusted deterministic chip. (3)
  **LLM-narrative-vs-rule divergence** — when an LLM annotation contradicts the deterministic rule
  that fired a chip, the persuasive narrative can win in the clinician's eye (cf. suite H-031); the
  rule must visibly win and the divergence be surfaced. (4) **Indirect prompt injection** via a
  poisoned record/RAG passage.

---

## 9. Integration with the Medicus Suite

The suite is the natural client. From the codebase:

- **Manifest change required.** `manifest.json` `host_permissions` currently allows only
  `*.medicus.health`, `*.api.england.medicus.health`, and the GitHub update host. To let the
  extension reach the LAN appliance, add the appliance's host (e.g. `https://ai.surgery.local/*` via
  internal CA, or `http://127.0.0.1:PORT/*` if co-located). This is a deliberate, reviewable change
  — and a hazard-log entry.
- **New side-panel module** `side-panel/modules/ai-assist/` (follow the module convention in
  `CLAUDE.md`: `init(container)`/`cleanup()`, register in `panel.js` *and* `pop-out.js`, add backup
  IO if it persists keys). This is the user-facing surface for scribe drafts, cohort summaries and
  the assistant.
- **Optional post-evaluation enrichment** in the engine: after `data-fetcher.js` normalises the
  patient snapshot and `rules-engine.js` evaluates, an *optional* enrichment step can ask the LLM
  for a narrative/triage-context annotation on existing chips. **Must degrade gracefully** — if the
  box is offline, chips render exactly as today. Never block rule evaluation on the LLM.
- **Reuse the read-only, credentialed-fetch posture.** The suite already extracts patient context,
  meds, problems, observations + history (`engine/extractors/*`, `engine/normalisers.js`). That
  normalised snapshot is exactly what you POST to the local server — no new Medicus scraping needed
  for the interactive path.

---

## 9½. Build vs buy (an honest fork — added after review)

The AVT Self-Certified Supplier Registry now lists ~23 assured scribe suppliers (TORTUS, Heidi,
Accurx Scribe, Microsoft Dragon, Optum/EMIS…) who have **already** carried the cost this plan would
otherwise impose: Class 1 MHRA registration, DTAC, DSPT, DCB0129/0160 safety cases, and evidence of
benefit (the GOSH/TORTUS trial is *theirs*). You cannot realistically out-govern a funded vendor
whose entire existence is clearing that bar, and the 9 June 2025 Priority Notification makes an
unassured scribe a live liability for both the practice **and** the individual clinician.

The honest split:
- **Buy** the generative scribe (the Phase-2 Class-1 piece). It's now a commodity with assured
  suppliers; re-deriving it solo means a worse evidence base and a one-person safety case.
- **Build** the white space the market does *not* sell: the **read-only, Medicus-native,
  deterministic augmentation layer** — the `ai-assist` thin client + orchestration surface,
  safety-by-architecture graceful degradation, suite-native review gates, and (optionally)
  LLM-narrative-on-deterministic-chips enrichment. The best-shaped version of the whole idea:
  *the assured third-party scribe writes the note; the Medicus Suite is the local intelligence layer
  that makes the rest of the record smarter around it.*

**Why self-hosting is nonetheless retained here as the chosen direction:** there's a genuine niche
the AVT market doesn't fully serve — practices or data-sensitive contexts that cannot accept *any*
cloud processing of patient audio/text. A self-contained, no-egress appliance is the only answer for
them, and it keeps the augmentation white space and the scribe under one roof. That's a deliberate
choice for the hard-local-only minority, made with eyes open to the ops cost in §11 — not the
default recommendation for every practice.

---

## 10. Phased roadmap (staged by regulatory risk, not by tech difficulty)

**Phase 0 — Foundations & paperwork (do this first, in parallel with the PoC).**
Stand up the appliance, vLLM/Ollama, gateway, audit, network lockdown. *Simultaneously* start the
intended-purpose statement, DPIA, and engage the CSO + Caldicott Guardian. The governance has the
longest lead time — start it on day one, not after the demo.

**Phase 1 — Non-device admin tooling (likely not a medical device).**
Drafting assistance, document summarisation *for the clinician to verify*, cohort-list narratives,
"ask the local guidelines" RAG with citations. Verbatim-transcript scribe. No clinical claims, no
decision support. Prove value and exercise the human-in-the-loop UX safely.

**Phase 2 — Generative scribe + recall augmentation (≥ Class 1 device).**
Generative consultation-note summarisation → register as ≥ Class 1, complete DCB0160 + DPIA + DTAC,
get on the AVT registry. LLM-assisted coding suggestions and recall-list augmentation on top of the
deterministic engine. The server-to-server Medicus connector for overnight scans lands here (pending
the Medicus API dependency).

**Phase 3 — Decision support (≥ Class IIa — deliberate, slow, sandboxed).**
Anything that informs diagnosis/triage/risk. Full conformity assessment / UKCA, very likely via the
**MHRA AI Airlock**. Don't drift into this by feature-creep from Phase 2 — the MHRA explicitly flags
generative tools "operating beyond intended purpose" as the risk. Cross this line on purpose or not
at all.

---

## 11. Honest risks & open questions

1. **The Medicus server API is an unverified dependency.** Interactive features work browser-mediated
   today. *Autonomous* recall needs a server-to-server Medicus API with proper credentials and
   scope. **Confirm what Medicus actually exposes** before promising overnight population jobs — this
   is the biggest unknown in the whole plan.
2. **"Build it yourself" = you are the manufacturer.** That's DCB0129 *and* DCB0160, a CSO, hazard
   log, safety case, and (for any device-class feature) MHRA registration/UKCA. This is real, ongoing
   work, not a one-off — and **it does not inherit from the suite's governance.** The suite's DPIA
   and 35-hazard register are built on *no runtime AI and no egress*, the two things this server
   adds, so they are **invalidated, not extended**. Budget for a fresh DPIA, a fresh hazard log (top
   hazards: hallucination, prompt injection, STT error), and a living dual-hat safety case.
3. **Hallucination + automation bias is the headline patient-safety risk**, and "a clinician
   reviewed it" is a *leaky* control (the literature is clear it's necessary but not sufficient). The
   mitigations (provenance, edit-before-file, validators, audit of *actual* review) are load-bearing.
4. **Model/quant choices erode quality in non-obvious ways.** Sub-4-bit and W4A8 hurt reasoning and
   factuality more than perplexity suggests, worst on small models. Validate on *clinical/reasoning*
   tasks, not perplexity, and re-validate on every model/quant change.
5. **Fast-moving everything.** Model rankings, vLLM's structured-output API, FP4 tooling, and the
   regulatory dates (DUAA commencement, MHRA's promised 2026 AIaMD framework, CE-recognition end
   dates) all change. Pin versions; re-verify regulatory specifics on the primary sources before any
   real artefact.
6. **Concurrency reality.** 5–20 clinicians rarely hammer simultaneously; bursty load on a single
   PRO 6000 with vLLM continuous batching is comfortable. But size `max_num_seqs` to true peak and
   add admission control so a spike degrades gracefully, not silently.
7. **Cost & maintenance.** ~£8k box + UPS + a competent maintainer + ongoing governance. Cheaper than
   per-seat cloud AI at scale and far better for IG, but it's not free and it's not zero-ops. Running
   vLLM/LiteLLM/Postgres/TEI/nginx on a GPU box is a small production ML platform (CUDA/driver
   patching, image CVEs, thermal/acoustics, cert rotation) *on top of* a living dual-hat safety
   case — be honest about whether that eats a partner's life (see §9½).
8. **RAG corpus licensing + device-line drift.** BNF/NICE text is not freely redistributable — any
   local guidance corpus must be licence-cleared before indexing. And the retrieval feature is the
   one most likely to drift across the device line (§7c): keep it extractive/quote-only and
   release-gated, or defer it.

---

## 12. Key sources (grouped; all gathered 2026-06-22, verify primaries before relying)

- **Models / serving / hardware:** Kimi K2 (github.com/MoonshotAI/Kimi-K2, arXiv:2507.20534);
  Qwen3 (huggingface.co/Qwen/Qwen3-30B-A3B, qwenlm.github.io/blog/qwen3); gpt-oss
  (openai.com/index/introducing-gpt-oss, arXiv:2508.10925); Llama 3.3 70B
  (huggingface.co/meta-llama/Llama-3.3-70B-Instruct); MedGemma
  (developers.google.com/health-ai-developer-foundations/medgemma); vLLM
  (docs.vllm.ai), Ollama (github.com/ollama/ollama), llama.cpp (github.com/ggml-org/llama.cpp),
  SGLang (github.com/sgl-project/sglang), LiteLLM (docs.litellm.ai); RTX PRO 6000 / hardware
  (nvidia.com, XiongjieDai/GPU-Benchmarks-on-LLM-Inference, arXiv:2512.23029 private-Qwen3 server);
  quantisation ("Give Me BF16…" arXiv:2411.02355, reasoning-degradation arXiv:2504.04823).
- **STT / scribe tech:** faster-whisper (github.com/SYSTRAN/faster-whisper), WhisperX
  (github.com/m-bain/whisperX), Parakeet/Canary (huggingface.co/nvidia), pyannote
  (huggingface.co/pyannote/speaker-diarization-3.1); Open ASR Leaderboard (arXiv:2510.06961).
- **RAG / structured output:** XGrammar (github.com/mlc-ai/xgrammar, arXiv:2411.15100), Outlines
  (github.com/dottxt-ai/outlines), pgvector (github.com/pgvector/pgvector), Qdrant (qdrant.tech),
  bge-m3 / Qwen3-Embedding / MTEB (huggingface.co, arXiv:2210.07316, arXiv:2502.13595); RAG safety
  (iatrox.com clinical-RAG, RAGAS).
- **UK regulation / IG / safety:** NHS England AVT guidance
  (england.nhs.uk/long-read/guidance-on-the-use-of-ai-enabled-ambient-scribing-products…) + AVT
  registry (transform.england.nhs.uk) + 9 June 2025 Priority Notification; DTAC
  (transform.england.nhs.uk/.../digital-technology-assessment-criteria-dtac); DCB0129/DCB0160
  (digital.nhs.uk/services/clinical-safety); MHRA SaMD + AI Airlock
  (gov.uk/government/collections/ai-airlock-the-regulatory-sandbox-for-aiamd, MHRA LLM blog
  medregs.blog.gov.uk 2023-03-03); UK GDPR/DPA 2018 (legislation.gov.uk; ICO AI guidance
  ico.org.uk); DUAA 2025 (legislation.gov.uk/ukpga/2025/18/section/80, in force 5 Feb 2026);
  guardrails (OWASP GenAI Top 10, JAMA automation-bias 2023, JAMA Netw Open prompt-injection 2025,
  EU AI Act Art 12); population health (PINCER PLOS Med 2022, OpenSAFELY bennett.ox.ac.uk, eFI/
  QRISK3/FAMCAT, QOF 2025/26 england.nhs.uk).
