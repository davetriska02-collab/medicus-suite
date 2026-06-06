---
name: audit-sweep
description: >-
  Fan out 5 Haiku sub-agents to sweep the codebase for bugs, disconnected
  wiring, and broken references across non-overlapping domains, then have the
  orchestrator (you) independently VERIFY every reported finding against the
  real source before trusting it, triage real bugs from false positives, and
  present a fix plan for approval. Use when the user asks to "audit", "sweep",
  "thrash through the codebase", "look for errors/problems/disconnected
  wiring", or wants a multi-agent health check. Does NOT fix anything until the
  user approves the plan.
---

# Audit Sweep — multi-agent codebase health check

A fan-out / verify / triage / plan routine. Cheap Haiku agents do broad
parallel discovery; you (the orchestrator) do the expensive verification and
judgement. **Discovery is untrusted until you confirm it firsthand.**

## Step 0 — Orient

Read `CLAUDE.md` and the project layout. Partition the codebase into ~5
**non-overlapping** domains so agents don't collide. For this repo the natural
split is:

1. `side-panel/` shell + modules (panel.html/js/css, MODULES registry, nav tabs, global strips)
2. `pop-out/` and its **parity** with side-panel (every real module must exist in both; `visualiser`/`about` are intentional panel-only exceptions)
3. `shared/` + `shared/io/` backup chain → `options/` (VALID_SCOPES, doFullExport/applyEnvelope, previewEnvelope, per-module Export/Import, storage-key drift)
4. `engine/` + `content-scripts/` (imports resolve, exported symbols exist, message-passing wiring, logic bugs)
5. `manifest.json` + `options/` + `visualiser*.html` + service worker (every referenced file exists, permissions declared, dangling element ids)

If the repo layout differs, re-partition sensibly — keep domains disjoint.

## Step 1 — Fan out 5 Haiku agents (one message, parallel)

Launch all five with the `Agent` tool, `subagent_type: general-purpose`,
`model: haiku`, in a **single message** so they run concurrently. Give each
agent a tightly-scoped prompt that:

- Names its domain and tells it to **stay in scope**.
- Tells it to read `CLAUDE.md` first for conventions.
- Focuses on **disconnected wiring and broken references**: registry/nav
  mismatches, import paths that don't resolve, imported symbols that aren't
  exported, element ids referenced in JS but absent from HTML (and vice
  versa), storage keys written but missing from IO backup files, functions
  called but never defined, manifest references to missing files.
- Forbids fixing anything and forbids style/preference nits.
- Requires output as a numbered list; each finding = (1) one-line title,
  (2) exact `file:line` reference(s), (3) why it's a bug, (4) severity
  (high/med/low). "If a category is clean, say so."
- Ends with: "I will independently verify every claim, so be precise and
  avoid speculation."

You may run the longer-running agents with `run_in_background: true` and let
completion notifications wake you, or wait for all five.

## Step 2 — VERIFY firsthand (the important part)

When the reports land, **do not relay them as-is.** Haiku agents
over-report and misread line context (a reassignment looks like a
declaration; a graceful-404 looks like a missing file). For every HIGH and
MED claim — and any LOW you'd act on — open the actual source with
Read/Grep/Bash and confirm:

- The cited line really contains the defect.
- It isn't already handled (null-check, try/catch, fallback, by-design).
- The variable/symbol isn't defined elsewhere in scope.

Batch these verification reads in parallel. Treat every claim as guilty-until-
proven: this step is what stops you from "fixing" a non-bug.

## Step 3 — Triage

Produce a single consolidated table splitting findings into:
**✅ Confirmed real** · **🟡 Minor / optional** · **❌ False positive (dismissed,
with the reason)**. Cite `file:line` for each. Be explicit about which agent
claims didn't survive verification and why.

## Step 4 — Plan & ask, don't fix

Present the triaged report. Use `AskUserQuestion` to let the user pick which
fixes to apply (multi-select). **Do not modify any code until they choose.**

## Step 5 — Fix (only the approved items)

For approved fixes, follow repo conventions from `CLAUDE.md`:
- Develop on the session's designated branch (create if needed).
- Bump `manifest.json` `version` (patch for bug fixes) + add a `CHANGELOG.md`
  entry on the same commit.
- Syntax-check edited JS (`node --check`), re-validate `manifest.json` as JSON.
- Confirm nothing from `uploads/`, `data/sars/`, or `output/` is staged.
- Commit with a descriptive message and push with retry. Do NOT open a PR
  unless explicitly asked.
