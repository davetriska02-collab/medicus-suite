---
name: pen-test-simulator
description: >-
  Executable penetration-test simulation against the medicus-suite Chrome MV3
  extension (UK GP patient data). Unlike the report-only `security-audit` skill,
  this one BUILDS AND RUNS exploit harnesses against the real modules — crafting
  malicious backup envelopes, spoofed cross-context messages, XSS payloads,
  SSRF/open-redirect URLs, prototype-pollution objects, ReDoS inputs and
  alert-suppression configs — and records each scenario as BLOCKED (control held)
  or EXPLOITED (vulnerability confirmed), with reproducible evidence. Produces a
  PTES/CREST-style engagement report. Use when the user asks to pen-test,
  penetration-test, "simulate an attack", run the attack harness, prove
  exploitability, or validate that a security control actually holds at runtime.
  Authorised on this repo only (the maintainer's own extension). Report-only by
  default: it runs attacks against code in a sandbox and reports — it does not
  modify product code or open fix PRs unless the user explicitly asks.
---

# Pen-test simulator (executable red-team) skill

Run an **authorised, executable** penetration test of the medicus-suite Chrome
MV3 extension. This is the maintainer's own repository and an authorised exercise.

This skill is the **active** counterpart to `security-audit`:

| | `security-audit` | `pen-test-simulator` (this) |
|---|---|---|
| Method | Static red-team read of source | **Builds + runs exploit harnesses** against the real modules |
| Output | Severity-ranked findings | Per-scenario **BLOCKED / EXPLOITED** with repro evidence |
| Proof | "this *looks* exploitable" | "I *ran* the attack — here's what happened" |

Use them together: the audit finds candidate weaknesses; the simulator proves or
disproves them at runtime. A finding the audit rates High but the simulator
shows BLOCKED is a control working as intended (record it); a scenario the
simulator shows EXPLOITED is a confirmed vulnerability with a working PoC.

**Default mode is report-only.** You may freely *run* attack inputs against the
modules (that is the whole point — it's a sandboxed Node harness, no product code
changes, no network egress). You may NOT change product code, push fixes, or open
PRs unless the user explicitly asks ("fix it", "remediate"); then do it on a
branch + PR for review, the same flow `SECURITY-AUDIT.md` records.

## Scope & rules of engagement

- **In scope:** every module reachable from an attacker-controlled input — backup
  import (`shared/io/*`, `engine/ruleset-io.js`, `shared/io/suite-envelope.js`),
  cross-context messaging (`service-worker.js`, the MAIN↔isolated bridge),
  chip/DOM rendering (`shared/chip-renderer.js`, content scripts), the rules /
  triage engine (`engine/*`), network clients (`shared/update-checker.js`,
  `engine/api-client.js`), and the visualiser / vendored libs.
- **Out of scope / acknowledged residual risks** (note them, don't waste cycles
  re-deriving them — confirm the stated mitigation still holds and move on):
  - the deferred **PDF.js CVE-2024-4367** (mitigated by `isEvalSupported:false`);
  - **plaintext `chrome.storage.local`** for non-PHI config (a browser-sandbox
    property, accepted);
  - the manual **"load unpacked"** install vector (requires local admin / dev
    mode — out of remote attacker reach);
  - the inherent **client-side nature** (browser sandbox both limits and is the
    attack surface).
  - No formal third-party pen-test / SOC2 — this skill is the internal
    substitute, not a replacement for one; say so in the report.
- **Hard limits:** no real network egress, no targeting any host other than this
  repo's code, no destructive filesystem actions. Everything runs in-process
  against `require()`d modules with synthetic inputs.

If the user passed an argument, scope to it: a path/subsystem (`import`,
`messaging`, `xss`, `network`, `rules`) → run only that battery; `quick` → run the
default battery and skip writing new bespoke harnesses; otherwise → full run.

## 1. Recon (context first)

Read `CLAUDE.md`, `SECURITY-AUDIT.md`, and the latest `CHANGELOG.md` "Security"
entries. Record: current `manifest.json` version, the `main`/branch short SHA
under test, today's date, and the list of already-fixed findings (F1–F8, NF1–NF6,
TF1–TF4) so an EXPLOITED result on one of those is flagged as a **regression**,
and a BLOCKED result is recorded as **regression guard holding**.

Then read `references/attack-playbook.md` — the catalogue of attack scenarios,
each mapped to a concrete entry point, a malicious-input recipe, and the
"BLOCKED vs EXPLOITED" oracle (what output proves which).

## 2. Run the standing harness

The skill ships a runnable battery that exercises the real modules:

```
node .claude/skills/pen-test-simulator/scripts/pentest-harness.js
```

It `require()`s the actual `engine/` and `shared/` modules and fires the standing
attack batteries (import/envelope, prototype pollution, alert-suppression, XSS
escaping, SSRF/open-redirect, ReDoS). Each scenario prints
`BLOCKED` (the control rejected/neutralised the attack) or `EXPLOITED` (the attack
succeeded), plus the payload and the observed result so it is reproducible. Exit
code is non-zero if **any** scenario is EXPLOITED — so this doubles as a CI gate.

Read its output. Treat the harness as the floor, not the ceiling.

## 3. Improvise — write new attack cases (the actual pen-testing)

The standing harness covers known surfaces. Real pen-testing means probing for
the *unknown*. For the surfaces relevant to this run (or whatever the user
scoped), **author new exploit cases** against the live modules:

- Pick an entry point an attacker controls (a backup file field, a message
  payload, a chip's text, a URL the extension will fetch/render).
- Construct the nastiest input you can (deeper prototype-pollution chains,
  Unicode/normalisation bypasses of escaping, mutation/throwing getters in
  imported objects, type-confusion on numeric thresholds that silences a
  clinical alert, regex catastrophic backtracking, ToCToU on consume-on-read).
- Drive it through the real function and **observe** — don't reason about whether
  it's escaped, run it and check the bytes. For DOM sinks, render to a string and
  assert no executable breakout survives; for thresholds, assert the alert still
  fires; for pollution, check `({}).polluted` afterwards.
- Add genuinely new, repeatable cases into `scripts/pentest-harness.js` (or a
  scratch file alongside it) so the next run re-tests them.

Prioritise **patient-safety** exploits: any input that makes a drug-monitoring or
RAG/triage alert **silently not fire** is a critical pen-test finding even though
it leaks no data — the harm is a missed clinical alert.

## 4. Triage results (no false alarms)

Automated harnesses and eager exploit attempts over-claim. For every EXPLOITED
result, confirm it is **really reachable by a real attacker** before reporting it:

- There is **no `externally_connectable`** — arbitrary web pages / other
  extensions cannot reach `chrome.runtime.onMessage`; only intra-extension
  senders and (indirectly) a compromised Medicus page via the MAIN-world bridge.
- The MAIN-world bridge **nonce is theatre** (the page shares that world) — the
  real controls are defensive validation + rate-limiting, so test those, not the
  nonce.
- A harness "EXPLOITED" that requires an input the product never constructs, or a
  guard applied one layer up that the harness bypassed, is a **false positive** —
  downgrade it and say why. Re-drive through the *real* call path before believing
  it.

Keep a short downgraded/rejected list with the reason, exactly like the audit.

## 5. Report — engagement style

Produce a penetration-test engagement report using
`references/report-template.md`. It is **outcome-led**, not finding-led: every
attempted attack is listed with its result, so "we tried X and the control held"
is itself a deliverable (that is what a pen-test buys you).

### Output mode

- **Interactive** (a person asked in-session): present the report in chat —
  engagement summary (version/SHA/date, scenarios run, blocked vs exploited
  counts), the scenario results table, a detail block + repro for every EXPLOITED
  scenario, the downgraded/false-positive list, and a "controls confirmed holding"
  section (the regression guards that survived). Then offer to remediate any
  EXPLOITED finding on a branch + PR. Do not change product code unasked.
- **Unattended** (scheduled run, or the user says "open an issue"): search open
  issues on `davetriska02-collab/medicus-suite` for a recent `Pen-test simulation`
  issue (last 10 days) — comment on it if found, else open ONE issue titled
  `Pen-test simulation — YYYY-MM-DD`, labelled `security-audit` and `automated`,
  with the report. If nothing was EXPLOITED, still open a short heartbeat issue
  stating the run was clean with the SHA and scenario count. Do NOT open fix PRs.

## What NOT to do

- Do NOT modify product code, push commits, or open PRs unless the user explicitly
  asks for remediation (then: branch + PR, never a direct push to `main`).
- Do NOT perform real network requests, scan external hosts, or touch any repo
  other than this one. All attacks are in-process against synthetic inputs.
- Do NOT report an EXPLOITED result you have not driven through the real call path
  and confirmed reachable — a working PoC or it didn't happen.
- Do NOT re-report acknowledged residual risks (PDF.js CVE, plaintext config,
  load-unpacked) as new findings; confirm the mitigation and note it.
- Do NOT pad with style nits — exploitable behaviour and patient-safety logic
  flaws only.
