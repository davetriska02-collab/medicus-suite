# Agent harness — conventions for this repo

Adapted from the @0xCodez "Harness Engineering" checklist (June 2026). We took the
**principles** and rejected the parts that fight a mature, safety-critical codebase.
This file is the "explain every file in `.claude/` in 30 seconds" audit doc.

## What's in `.claude/`

| Path | Why it exists |
|---|---|
| `agents/` | Subagent personas the orchestrator can spawn (e.g. `virtual-dave.md`). Reviewer/verifier roles run with a fresh context window — we never grade our own work. |
| `skills/` | Reusable, named procedures (`the-keeper`, `the-practice`, `design-crit`, `security-audit`, `repo-audit`, `ui-design`, `update-tour`, `the-gauntlet`, `pen-test-simulator`). Long how-to lives here, loaded on demand — not in CLAUDE.md. |
| `scheduled-tasks/` | Cron-style task definitions. |
| `hooks/guard.sh` | PreToolUse Bash guard — deterministic enforcement of two CLAUDE.md safety rules (see below). |
| `settings.json` | Model/permission + hook wiring. |
| `README.md` | This file. |

Memory that compounds lives **inside the skill that owns it** (e.g.
`skills/the-keeper/references/state/last-run.json`), read at the start of a run and
written before it closes — not in a top-level `memory/` folder.

## The two divergences from the checklist (deliberate)

1. **CLAUDE.md is procedure-rich and well over 500 tokens — on purpose.** This is a
   read-only GP clinical tool; its CLAUDE.md encodes hard-won, expensive invariants
   ("PREPEND chips never append" — a shipped regression; "a missing drug brand is a
   silent patient-safety risk"; "bump the defaults version or the change never
   ships"; "careful merge"). These are true on *every* run and have repeatedly
   prevented real bugs. We keep must-not-violate invariants in CLAUDE.md and push
   only long walkthroughs into `skills/`. We do **not** apply a token cap.

2. **No format-on-edit (PostToolUse prettier) hook.** CLAUDE.md forbids reformatting
   whole files; `content-scripts/triage-lens/content.js` and `defaults.json` are
   prettier-excluded because tests match them byte-for-byte. A blanket
   `prettier --write` hook would break the suite. Formatting is gated at the
   **new-file** boundary by `.githooks/pre-commit`, not on every edit.

## Enforcement (must / must-not — judgement stays with the model)

- **`.claude/hooks/guard.sh`** (PreToolUse, Bash): blocks (exit 2)
  (1) force-pushing `main`, and (2) reading/transmitting a real `.env` secrets file.
- **`.githooks/pre-commit`**: blocks any commit that stages `uploads/`,
  `data/sars/` or `output/` (patient data), plus the existing ESLint / new-file
  Prettier gates. Activated by `git config core.hooksPath .githooks` (run by
  `npm install`).

Everything else — what to build, how to triage, when to merge — is the model's
judgement, reviewed by a fresh-context subagent where it matters.

## Quick self-audit

1. Can I explain every file in `.claude/` in 30s? (this table)
2. Are the safety must-nots enforced by a hook, not just prose? (guard.sh + pre-commit)
3. Does a reviewer/verifier run with fresh context? (agents/, the-keeper verifiers)
4. Does compounding memory get written before a run closes? (skill `state/` files)
