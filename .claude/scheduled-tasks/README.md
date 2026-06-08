# Automated loops — anatomy & catalog

> **Core thesis:** stop being the thing inside the loop. *Write* the loop, give it
> skills, a feedback gate, and hard stops — then let it run on a schedule.

This directory holds the prompt bodies for Medicus Suite's scheduled Claude Code
routines. Each file is pasted into a scheduled trigger in Claude Code on the web.
This README is the single place that defines **what a good loop here looks like**
and tracks **which loops we run**. Read it before adding or editing a routine.

## Why loops, not one-shot prompts

A one-shot prompt makes *you* the loop: you have to remember to run the check,
read the output, and decide what's next. A loop encodes the intent and the
stopping behaviour once, then runs itself. The compounding asset is the
**skill library** (`.claude/skills/`) — named, tested routines that loops invoke
and that get sharper every time we trim a false-positive class. Loop + skills
compounds; a pile of ad-hoc prompts does not.

## Loop anatomy — the seven parts

Every routine in this directory should be expressible in these terms. If you
can't name all seven for a new loop, it isn't finished.

| Part | What it means here | The failure it prevents |
|---|---|---|
| **Schedule** | A cadence (weekly/monthly) + slot, chosen so loops don't fight for resources. | Drift goes unnoticed for months. |
| **Skill** | The reusable routine the loop invokes (`.claude/skills/...`), or an inline body if it's truly one-off. | Logic copy-pasted across triggers, fixed in one and not the others. |
| **Tools** | What the agent actually drives: tests, `git`, subagents, GitHub issues/PRs, doc generators. | A "review" with nothing concrete behind it. |
| **Feedback gate** | The check that decides whether output is trustworthy: the test suite, a verifier pass against the `main` tip, a docx-validity check, a destructive-change self-audit. | Confident-sounding but wrong output reaching the user. |
| **Done / no-op condition** | An explicit "nothing to do" exit — no empty commits, no duplicate issues, no churn. | Noise that erodes trust in the signal. |
| **Durable state** | What survives between runs so the loop knows what changed: a `last-run.json`, or an `origin/main` comparison, or an existing-issue lookback. | Re-reporting the same finding every week. |
| **Hard limits** | Caps that stop a runaway: subagent count, word ceilings, "do not push if a test fails", "never auto-merge a clinical rule", report-only mode. | A loop that spins, over-spends, or silently weakens a safety rule. |

### Production-reality reminders (from hard experience)

- **No-progress detection.** A green week, a clean audit, an unchanged feature
  surface are *valid results* — say so plainly and exit. Don't manufacture work.
- **Report-only by default.** The overnight loops (bug-bash, security-audit,
  extraction-canary) produce a written artefact, not code changes. Promote a
  loop to "writes code" only deliberately, and never let it touch `main` for a
  clinical rule without CSO sign-off.
- **Fail loud, change nothing.** When a feedback gate can't be satisfied
  (converter failed, destructive diff detected, test red), abort and report —
  never commit a half-result. The feature-list 404 and the safety-case
  self-audit guard both exist because of this.

## The loops we run

| Loop | Cadence | Skill / body | Feedback gate | Durable state | Writes to | Mode |
|---|---|---|---|---|---|---|
| [`weekly-bug-bash`](weekly-bug-bash.md) | Weekly, Sun 02:00 | inline (6 sonnet subagents) | verify every finding against `main` tip (reject unreal/fixed/dupe) | **issue footer** (`lastRunMainSha`) | GitHub issue | report-only |
| [`weekly-security-audit`](weekly-security-audit.md) | Weekly, Sun 03:00 | `security-audit` skill (8 surfaces) | verify each finding against `main`, downgrade over-rated | **issue footer** (+ <10-day lookback) | GitHub issue (or heartbeat) | report-only |
| [`weekly-extraction-canary`](weekly-extraction-canary.md) | Weekly, Mon 05:00 | inline | full `test-*.js` suite + `regen-defaults --check` + fragility review | **PR/issue footer** (`lastRunMainSha`) | PR/issue + **human spot-check** | report-only |
| [`weekly-feature-list`](weekly-feature-list.md) | Weekly, Sun 03:00 | inline | docx is a valid OOXML zip; push-landed verify | **committed `state/…last-run.json`** + `origin/main` compare | `docs/feature-list.{md,docx}` on `main` | writes docs |
| [`weekly-safety-case`](weekly-safety-case.md) | Weekly, Sun 04:00 | inline | destructive-change self-audit (abort on any weakening) | `origin/main` doc compare | 4 safety docs on `main` | writes docs (additive only) |
| [`monthly-rule-currency`](monthly-rule-currency.md) | Monthly, first Sun 03:00 | `the-keeper` skill | per-change verifier + rule test suite + CSO sign-off box | `the-keeper/references/state/last-run.json` | rule files on **dev branch** | writes code, no auto-merge |

> **Durable state is now standardized** ([`state/`](state/README.md)). One schema,
> two transports, because the container is ephemeral and report-only loops must
> not write to the repo:
> - **Report-only loops** (bug-bash, security-audit, extraction-canary) carry
>   state in an invisible `loop-state` footer inside the issue/PR they already
>   create — read back next run via `loop-state.js parse`. This replaces the old
>   fixed-week git window that silently lost a week whenever a run slipped.
> - **Push-loops** stamp a committed `state/<loop>.last-run.json` via
>   `loop-state.js update` (feature-list does this). The Keeper keeps its own
>   richer state; safety-case uses its `origin/main` content compare.
>
> Use the `scripts/loop-state.js` helper (`read`/`update`/`footer`/`parse`,
> `selftest`) so the schema never drifts loop-to-loop.

## Adding a new loop

1. **Name all seven anatomy parts** (table above) before writing the prompt. If
   the logic is reusable or already exists, invoke a **skill** in
   `.claude/skills/` instead of inlining it — that's where the compounding value
   lives.
2. **Write the prompt body** as `<cadence>-<name>.md` in this directory, in the
   style of the existing files: a short "why this exists / honest constraints"
   note, then numbered steps, then an explicit **"What NOT to do"** block.
3. **Make the feedback gate and the no-op condition explicit.** State exactly
   what counts as "trustworthy output" and exactly when the loop should exit
   having changed nothing.
4. **State the hard limits inline**: subagent cap, report-only vs writes-code,
   whether it may touch `main`, and the non-negotiables (for any clinical-rule
   loop: never silently weaken monitoring/alerting; never auto-merge — CSO
   sign-off only, per `CLAUDE.md`).
5. **Wire durable state** through `scripts/loop-state.js` ([`state/`](state/README.md)):
   pick the transport that matches the loop's contract — the committed-file
   (`read`/`update`) for a loop that pushes, or the issue/PR footer
   (`footer`/`parse`) for a report-only loop — and read state at the start to
   scope off `lastRunMainSha` instead of a fixed time window.
6. **Add a row to the catalog table above** so the loop is discoverable.
7. Register the trigger in Claude Code on the web at the chosen cadence/slot,
   spacing it so it doesn't contend with the existing slots.

## See also

- [`state/`](state/README.md) — durable run-state: schema, the two transports,
  and the `loop-state.js` helper.
- `.claude/skills/` — the skill library the loops invoke (`the-keeper`,
  `security-audit`).
- `CLAUDE.md` → *Automated loops* — the one-line pointer back here.
