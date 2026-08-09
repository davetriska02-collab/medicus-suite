# The Next-Level Swarm — multi-agent planning pipeline for Medicus Suite

A re-runnable, three-stage agent swarm that answers one question: **what are the top 10
next best developments for Medicus Suite?**

## Architecture

```
Stage 1 — RESEARCH (Sonnet, 4 parallel analysts)
  ├─ market          → UK primary-care tooling landscape, competitor scan, white space
  ├─ tech-trends     → extension platform / clinical-AI / interop technology scan
  ├─ engineering     → hands-on codebase review: architecture, debt, fragility, coverage
  └─ product-ux      → hands-on product review: IA, workflow fit, onboarding, vision gap
        │
        ▼  structured findings + opportunities
Stage 2 — ORCHESTRATION (Fable, main session)
  Reads the research digest, quality-checks it, and briefs Stage 3 with it.
        │
        ▼  research digest as args
Stage 3 — EXPERTS (Opus, 6 parallel personas + 2-judge challenge panel)
  ├─ platform-architect        ├─ clinical-safety-engineer
  ├─ clinical-ux-designer      ├─ data-engineer
  ├─ ai-engineer               └─ product-strategist
  Each proposes 4–6 buildable developments grounded in the repo.
  Then a challenge panel (ruthless skeptic + time-poor working GP) grades
  every proposal strong/keep/weak/kill — duplication and vapourware die here.
        │
        ▼  graded proposal set
Stage 4 — SYNTHESIS (Fable)
  Dedupes, weighs expert conviction against challenge verdicts, and presents
  the Top 10 Next Best Developments plan.
```

## Running it

From a Claude Code session in this repo:

1. `Workflow({scriptPath: ".claude/workflows/medicus-research-swarm.js"})`
2. When it completes, review the returned digest, then:
   `Workflow({scriptPath: ".claude/workflows/medicus-expert-swarm.js", args: <digest>})`
   (`args` is the Stage 1 return value — string or object both work.)
3. The orchestrator synthesises the graded proposals into the top-10 plan.

Or just ask: _"run the next-level swarm"_ — the orchestrator drives all stages.

## Design notes

- **Models are tiered on purpose.** Research is breadth work → Sonnet. Proposal and
  judgement are taste work → Opus. Orchestration/synthesis stays with the session model.
- **Structured output everywhere** (`schema`) — no prose parsing between stages.
- **The challenge panel is the safety valve.** Six enthusiastic experts will always
  produce 30+ proposals; the skeptic and the working-GP judge kill duplication, scope
  creep, and anything a 10-minute consultation wouldn't feel.
- **Proposals must be repo-grounded.** Experts can read the codebase and are told a
  proposal naming real modules/files beats a generic one.
- Outputs land in `docs/plans/` as dated top-10 plans; re-run the swarm after major
  releases to refresh the roadmap.
