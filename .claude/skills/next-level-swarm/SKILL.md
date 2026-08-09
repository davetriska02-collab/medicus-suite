---
name: next-level-swarm
description: >
  Runs the Medicus Suite Next-Level Swarm — a three-stage multi-agent planning
  pipeline (Sonnet research swarm → orchestrator review → Opus expert swarm with
  a skeptic + working-GP challenge panel) that produces a ranked Top-10
  next-best-developments plan, fact-checked by virtual-dave and filed under
  docs/plans/. Use this skill whenever Dave says "next-level swarm", "run the
  swarm", "roadmap swarm", "top 10 developments", "what should we build next",
  "refresh the roadmap", "re-run the planning swarm", or asks for a strategic
  review of where Medicus Suite should go — including after a major release or
  when the competitive landscape has shifted. Also trigger when Dave asks to
  "check the market and the repo" for Medicus Suite planning purposes. Do NOT
  trigger for single-feature design questions or ordinary code review.
---

# The Next-Level Swarm

A re-runnable planning pipeline answering one question: **what are the top 10
next best developments for Medicus Suite?** Architecture and design rationale
live in `docs/AGENT-SWARM.md`. The pipeline is expensive (~1.3M subagent tokens,
~30 min) — confirm with Dave before running if the request is ambiguous, but a
direct invocation ("run the next-level swarm") is confirmation enough.

The stages must run in order; you (the orchestrating session) are stage 2 and 4
— review, brief, synthesise. Don't delegate the synthesis to a subagent: the
judgement calls between conflicting expert proposals are the orchestrator's job.

## Stage 1 — Research swarm (Sonnet)

```
Workflow({scriptPath: "<repo>/.claude/workflows/medicus-research-swarm.js"})
```

Four parallel analysts: market landscape, tech trends, hands-on engineering
review, hands-on product/UX review. Invoke by `scriptPath` (the name registry
may not include repo workflows). It runs in the background; wait for the
completion notification — never fabricate results.

## Stage 2 — Review and brief (you)

Read the full result from the task output file. Sanity-check all four lanes
returned (the script logs a warning for empty lanes). Extract the `result`
object to a JSON file in your scratchpad directory — the expert swarm accepts
an absolute `.json` path as `args`, which keeps your prompt small:

```
Workflow({scriptPath: "<repo>/.claude/workflows/medicus-expert-swarm.js",
          args: "/absolute/path/to/research-digest.json"})
```

## Stage 3 — Expert swarm (Opus)

Six expert personas (platform architect, clinical UX designer, AI engineer,
clinical safety engineer, data engineer, product strategist) each propose 4–6
repo-grounded developments; then a two-judge challenge panel (ruthless skeptic
+ time-poor working GP) grades every proposal strong/keep/weak/kill. Wait for
completion; the full result lands in the task output file (typically ~120k
chars — summarise it with a script before reading details).

## Stage 4 — Synthesis (you)

1. Score each proposal (strong=3, keep=2, weak=1, kill=0, summed across both
   judges) and cluster duplicates — independent experts converging on one idea
   is a strong signal; merge the best-argued variant with the judges'
   corrections folded in.
2. Rank a Top 10. Respect kills unless the underlying research evidence clearly
   survives the judge's stated objection (say so explicitly if you override).
3. Write the plan to `docs/plans/next-level-top10-YYYY-MM.md` following the
   structure of the previous plan in `docs/plans/` (methodology header,
   research headlines, ten items with impact/effort and judge verdicts,
   fix-now bugs, deliberately-rejected list, wave sequencing).
4. **Fact-check before landing:** spawn the `virtual-dave` agent on the draft
   ("Is the ranking right? Anything mis-ranked, missing, or vetoed?"). This
   step is not optional — the first run's flagship safety item contained a
   would-break-production error that only the fact-check caught (a proposal to
   delete a host permission that a live feature depended on). Fold his
   corrections into the doc and credit them inline.
5. Commit per repo conventions (CHANGELOG entry; version bump per CLAUDE.md),
   push, and present the Top 10 in chat — lead with the list, note what the
   fact-check changed, and link the plan doc.

## Hard-won rules

- **Pass the digest by file path, not inline** — 50k+ chars of research JSON
  in a tool call wastes context; the expert script detects an absolute `.json`
  path and tells each expert to Read it.
- **Trust the challenge panel over expert enthusiasm** — six experts always
  produce 30+ proposals; the panel exists to kill duplication and vapourware.
- **The swarm can misread the code.** Stage 4's virtual-dave pass is the
  control for that; a plan item that changes manifest permissions, deletes
  files, or touches the safety case needs its claims verified against the
  actual source before it ships in the doc.
- Re-run after major releases or landscape shifts; each plan is dated, and the
  previous plans stay in `docs/plans/` as the improvement baseline.
