# Why Medicus Suite Exists — A First-of-Type Augmentation Layer

**Status:** positioning statement · grounded in the shipped codebase at v3.236+; write surfaces enumerated in [`CLINICAL-SAFETY-NOTICE.md`](CLINICAL-SAFETY-NOTICE.md) §6.1
**Companion docs:** [`INTENDED-PURPOSE.md`](INTENDED-PURPOSE.md) (regulatory scope),
[`feature-list.md`](feature-list.md) (full feature inventory),
[`benchmark/GAUNTLET-2026-06-11.md`](benchmark/GAUNTLET-2026-06-11.md) (competitive analysis)

This document explains *why* the suite is built the way it is and what makes its
delivery model distinctive. It is a positioning statement, not marketing copy:
every capability claim below is traceable to shipped code, and the limits are
stated as plainly as the strengths.

---

## The problem

Medicus is the first genuinely new UK GP clinical system in a generation. It does
the core EPR job well — modern UI, integration, the fundamentals — but like every
EPR it is a *general* system. The deep, opinionated, power-user intelligence that a
working GP wants on top of the record (capacity forecasting, proactive per-patient
safety monitoring, free-text triage red-flagging, reception decision support,
operational dashboards, an offline record visualiser) is not something any vendor
ships out of the box, and historically clinicians have waited years for it to
arrive through the slow channels of vendor roadmaps, procurement, and integration
politics.

The conventional ways to add that intelligence all carry friction: bolt-on products
that need IM1 pairing and ICB funding; static template packs; single-purpose SaaS
portals that pull the clinician out of the record into yet another tab. Each solves
one column of the problem.

## The approach: an augmentation layer, not another system

Medicus Suite takes a different path. It is a **Chrome extension that sits
lightly on top of the live Medicus session** — a thin "intelligence layer" rather
than a replacement system. The default path is local read and overlay: it reads
what is already on the clinician's screen and in the data they are already
authorised to see, reorganises and threshold-checks it, and surfaces the result
in a side panel and in-record overlays. Writes exist, but they are a small,
enumerated, user-initiated set (listed in full at
[`CLINICAL-SAFETY-NOTICE.md`](CLINICAL-SAFETY-NOTICE.md) §6.1). Each is confirmed
at commit and executed under the user's own Medicus session; Medicus remains the
system of record. The suite performs no AI inference at runtime. In its default
configuration it sends no patient data anywhere. (See
[`INTENDED-PURPOSE.md`](INTENDED-PURPOSE.md) for the frozen scope statement and the
"what this is not" list.)

This model deliberately sidesteps the usual barriers:

- **No vendor dependency for delivery.** It runs client-side on the clinician's own
  authenticated session, so it ships and updates on its own cadence rather than the
  EPR's.
- **Safety by construction.** No silent or background writes — every write is
  user-initiated, identity-rechecked, and confirmed. The architecture does not
  make writes impossible; it makes unconfirmed writes impossible. Default traffic
  is local-only (no telemetry). Medicus stays the system of record.
- **Stays in the record.** The clinician never leaves Medicus to use it; the panel
  and chips appear alongside the live patient and queue.
- **Instantly updatable.** New built-in rules and chips propagate to existing
  installs through a versioned shipped-config migration, not a procurement cycle.

## What "first-of-type" means here — and what it does not

The claim is specific and bounded. Per the competitive review in
[`benchmark/GAUNTLET-2026-06-11.md`](benchmark/GAUNTLET-2026-06-11.md), which scored
the suite against the strongest UK GP add-on vendors (Ardens, PCIT, Eclipse, FDB
OptimiseRx, APEX, GP Automate, Accurx) from primary sources:

> Medicus Suite is the only product found that combines per-patient clinical safety
> alerting, free-text triage red-flagging, reception decision support, demand/capacity
> operations, and an offline record visualiser **in one tool**; every commercial
> competitor owns exactly one of those columns.

Three capabilities appear to be genuine white space — not matched by any of the seven
competitors reviewed:

- **Free-text clinical red-flag triage of inbound request text** (MH crisis, sepsis,
  DKA, cauda equina and other patterns) — competitors offer patient-facing checkboxes
  or routing, not text classification.
- **STOPP/START and anticholinergic-burden (ACB) prompts at the point of care.**
- **A real-time, in-record safety overlay running on Medicus**, where incumbents are
  absent or dashboard-only.

What "first-of-type" does **not** claim:

- It is not "better than" any incumbent on every axis. OptimiseRx delivers interaction
  alerts inside the prescribing act itself and carries a published RCT evidence base;
  Ardens has greater breadth-per-pound and a stronger compliance posture; Accurx owns
  the patient-facing triage front door.
- It does not yet close the **recall loop** (alert → invite → book → re-test) — it
  stops at the chip and a copy-ready Action Pack. Several competitors manage the full
  cycle.
- It uses **substring approximation** of clinical concepts where incumbents run on
  SNOMED refsets and QOF business rules — a documented, test-guarded limitation, not a
  closed one.
- It is an **internal tool for named clinical users**. It is not a medical device,
  carries no DTAC/DSPT/certified DCB0129 stack, and is not affiliated with or endorsed
  by Medicus Health, NHS England, or any regulator.

These are the honest boundaries of the claim. The novelty is the *combination and the
delivery model*, not supremacy on any single dimension.

## Medicus native vs Suite augmentation

What the base EPR provides versus what the augmentation layer adds. "Medicus native"
reflects a general-purpose EPR's typical scope; the Suite column lists only shipped,
code-verified capability.

| Capability | Medicus (native EPR) | Medicus Suite (augmentation layer) |
|---|---|---|
| Patient record, scheduling, prescribing, messaging | ✅ Core function | — (reads from it; writes only as a bounded, confirmed overlay of Medicus's own endpoints — not a second system of record) |
| Per-patient drug-monitoring alerts in the record, real time | General prescribing safety | ✅ Sentinel — 25 drug-monitoring rules with interval + source citation, overdue/due-soon chips |
| QOF register & indicator tracking, current year | General reporting | ✅ 13 registers, 48+ indicators (2025/26), per-patient chips |
| PINCER / STOPP-START / ACB prompts at point of care | — | ✅ In-record combination chips + importable prescribing-safety library |
| Free-text red-flag triage of inbound request text | — | ✅ 77+ semantic chips on the request queue (sepsis, stroke, MH crisis, 2WW…) |
| Investigation-results queue severity triage | Lab flags shown | ✅ Per-row chips: urgent, N-abnormal, under-prioritised, unmatched; can escalate never suppress lab flags |
| Reception-facing red-flag decision support | — | ✅ Guided capture pathways with 999/duty escalation; ship disabled pending practice sign-off |
| Pre-clinic population sweep (today's book, worst-first) | — | ✅ Sweep — monitoring rules across today's appointments before clinic |
| Demand / capacity / operations dashboards | Basic scheduling views | ✅ Slots, Capacity Forecast, Condor (8 metrics), Submissions, Activity, Referrals |
| Longitudinal observation trends with clinical context | Values in record | ✅ Trends — sparklines, KDIGO grid, age/register-derived BP targets |
| Offline EPR-export record visualiser | — | ✅ Local PDF analysis: continuity indices, eFI, PINCER flags, trends, swim-lane timeline |
| Practice knowledge base / reference | General docs | ✅ Searchable, practice-owned, categorised reference base |
| Recall loop management (invite → book → re-test) | Recall tooling | ⚠️ Not yet — stops at chip + Action Pack |
| Writes back to the record | ✅ System of record | ⚠️ Bounded, user-initiated, confirmed overlay of Medicus's own endpoints — Medicus remains the system of record |

## Safety posture in one line

Medicus Suite is overwhelmingly a **read-and-display layer**: it reads data already
present in Medicus, threshold-checks and reorganises it locally, and shows the
result. Writes exist but are a small, enumerated, user-initiated set (see
[`CLINICAL-SAFETY-NOTICE.md`](CLINICAL-SAFETY-NOTICE.md) §6.1): each is confirmed
at commit, identity-rechecked, and executed under the user's own session so
Medicus's ACL and audit fire. There are no silent or background writes. It
performs no runtime AI inference. In its default configuration it transmits no
patient data to any external service (the GitHub version check carries none; the
optional Transactional API proxy is off by default, read-only, and
practice-configured). It makes no clinical decision. Every displayed value must
be verified against the source record, and all clinical judgement remains the
clinician's. The full scope, contraindications, and limitations are in
[`INTENDED-PURPOSE.md`](INTENDED-PURPOSE.md) and [`HAZARD-LOG.md`](HAZARD-LOG.md).

## Why it matters

The interesting part is not any one module — it is the demonstration that a single
working clinician, with AI as a genuine co-pilot, can ship an agile, end-user-controlled
augmentation layer that makes an EPR materially smarter without waiting for the vendor
and without becoming a second system of record. Writes, where they exist, stay inside
Medicus's own endpoints, confirmed and attributed to the signed-in user. That is a
faster, less disruptive path to better primary-care tooling than monolithic EPR upgrades —
and the safety case stays simple because the default path is local read and overlay,
writes are enumerated and never silent, and Medicus remains the system of record.
