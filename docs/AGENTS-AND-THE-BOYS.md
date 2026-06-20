# Agents, models & "The Boys" — a guide for Nick

A follow-on to your getting-started guide. This is about the *power tools*:
how to use AI agents well, which Claude model to reach for, when to send in a
whole swarm, and an intro to the team Dave's built — the ones he calls
**"The Boys."**

---

## 1. What an "agent" actually is

When you chat with Claude Code, you're talking to one assistant holding the
whole conversation. An **agent** (or "subagent") is a *fresh* Claude that the
main one spins up to go do one focused job on its own — research a question,
audit the code, review a design — and report back a clean answer.

Why bother instead of just asking directly?
- **It keeps the main thread clean.** The agent reads 40 files, you get the
  3-line conclusion — not 40 files dumped into your conversation.
- **It can run in parallel.** Need three different things looked at? Fire three
  agents at once and they work simultaneously.
- **It can be a specialist.** An agent can be given a persona and a remit (e.g.
  "you are a security red-teamer") so it thinks the right way for the job.

You don't manage any of this by hand — you just *ask*, e.g. "explore how the
record visualiser parses dates" or "get Virtual Dave to review this." Claude
picks and runs the agent. You mostly need to know they exist so you can ask for
them.

---

## 2. Opus vs Sonnet vs Haiku — which brain to use

Claude comes in three sizes. Bigger = smarter but slower and more expensive;
smaller = faster and cheaper but less able on hard problems. Match the model to
the job:

- **Opus** — the heavyweight. Best judgement and reasoning. Use it for hard
  thinking: architecture decisions, tricky bugs, clinical-safety calls,
  planning a big change, anything where being *right* matters more than being
  fast. This is what Virtual Dave runs on. When in doubt on something important,
  Opus.

- **Sonnet** — the workhorse. Fast and very capable — the sweet spot for the
  vast majority of day-to-day coding: writing a feature, editing files, normal
  Q&A about the codebase. Great default. Most of your work lives here.

- **Haiku** — the sprinter. Fastest and cheapest. Use it for simple, well-defined,
  high-volume jobs: quick lookups, simple text edits, "find me where X is."
  Don't hand it anything that needs real reasoning — it'll be confidently wrong.

Rule of thumb: **start on Sonnet. Reach for Opus when it's hard or high-stakes.
Drop to Haiku when it's trivial and you want it instant.** On the £20 Pro plan
you mostly get Sonnet (and some Opus); don't burn your Opus allowance on typo
fixes.

---

## 3. Best practice — getting good work out of agents

1. **One clear job per agent.** "Audit the backup-import code for security
   holes" beats "look at the code." Vague brief → vague work.
2. **Give it everything it needs up front.** An agent starts fresh — it can't
   see your chat history. Spell out the context, the files, the goal.
3. **Ask for a plan before a big build.** "Plan how you'd do this, don't write
   code yet." Read the plan, correct it, *then* let it build. Catches wrong
   turns before they cost you.
4. **Research and editing are different modes.** Use a read-only explorer to
   *find and understand*; use the builder to *change*. Don't let an explorer
   start editing.
5. **Always review the output.** Agents are powerful, not infallible — and this
   is clinical software. Read what they did. The diff is the truth, not the
   summary.
6. **Don't over-engineer it.** For a one-line fix, just ask directly. Agents
   shine on big or parallel work, not trivial edits.

---

## 4. Swarms — when to send in several at once

A **swarm** is just several agents working at the same time on *independent*
pieces of a problem. The trick is in that word: **independent**. Swarms work
when the parts don't depend on each other.

- ✅ Good swarm: "audit security, review the UI, and check test coverage" —
  three separate lenses, no overlap, all at once.
- ❌ Bad swarm: "design the feature, then build it, then test it" — each step
  needs the one before it. That's a *sequence*, not a swarm. Do it in order.

Several of The Boys (below) are swarms internally — they fan a team of
sub-agents out across the codebase and then synthesise one report. You don't
build that yourself; you just invoke them.

---

## 5. Meet "The Boys" — the team Dave built

These are custom specialists living in the repo (`.claude/`). Each is summoned
by asking for it in plain English. They're Dave's standing crew:

- **Virtual Dave** — Dave's digital twin. His verdict on anything: "is this
  shippable, is it safe, would I run it in my own practice." Sharp, safety-first,
  swears when impressed. This is who auto-reviews your pull requests. Ask:
  *"what would Dave think of this?"*

- **The Keeper** — the clinical-rules watchman. Sweeps the authoritative UK
  sources (BNF, NICE, MHRA, QOF, the Green Book…) and checks the suite's drug /
  QOF / vaccine / monitoring rules are still current. Never auto-merges a
  clinical change — proposes them for review. Ask: *"run The Keeper."*

- **The Practice** — a synthetic GP-practice team (receptionist, technophobe
  partner, practice manager, power-user pharmacist…) that road-tests the suite
  for usability across the whole tech-literacy spectrum. Ask: *"ask The Practice
  what they make of the slots page."*

- **Atelier** (UI design) — the resident designer. One house style, one set of
  design tokens; restyles and polishes any surface to "commercial-grade." Consult
  it *before* writing new CSS. Ask: *"have Atelier polish this tab."*

- **design-crit** — a deep design critique loop for *one* screen: renders it for
  real, sends in three critics with different eyes, and lands the fixes. Ask:
  *"do a design crit on the visualiser."*

- **repo-audit** — a principal-engineer technical audit of the whole codebase:
  architecture, code quality, security, tests, with a prioritised improvement
  plan. Analysis only, no changes. Ask: *"run a repo audit."*

- **security-audit** & **pen-test-simulator** — the red team. The first reviews
  the attack surface and reports; the second actually *builds and runs* exploit
  attempts against the extension to prove what holds and what doesn't. Patient
  data lives here, so these matter. Ask: *"run a security audit."*

- **The Gauntlet** — competitive benchmarking. Researches the strongest rival
  products and produces a match / beat / leapfrog plan. Ask: *"run The Gauntlet
  against [product]."*

- **update-tour** — keeps the in-app guided walkthrough in sync with the UI
  after changes ship. Ask: *"update the tour."*

There's also a backstage crew of **built-in** helpers Claude uses automatically
— an *Explorer* for fanning out searches, a *Planner* for designing an approach
before coding, and a *guide* for questions about Claude Code itself. You rarely
call these by name; Claude reaches for them on its own.

---

## 6. The short version

- **Sonnet by default. Opus when it's hard or safety-critical. Haiku when it's
  trivial.**
- **Agents** do focused jobs and report back; **swarms** are agents on
  *independent* parts at once.
- **One clear brief, plan-before-build, always review the output.**
- **The Boys** are on-call specialists — just ask for them by name, and let
  Virtual Dave have the last word on whether it's good enough to ship.

When in doubt, ask Claude: *"who's the best agent for this, and which model?"* —
it'll tell you.
