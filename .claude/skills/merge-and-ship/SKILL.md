---
name: merge-and-ship
description: >
  Merge all open feature-branch PRs targeting the current integration branch into main.
  Recovers any stalled agents, resolves manifest/changelog version conflicts, wires
  cross-module integration points, runs the full test suite, and creates + merges a
  PR to main. Use after a /batch build completes or whenever you want to consolidate
  a set of feature branches. Args (optional): a PR number or integration branch name
  to target instead of the default.
triggers:
  - merge and ship
  - merge to main
  - consolidate prs
  - ship it
---

# Merge and Ship

You are executing the Medicus Suite integration workflow. Your goal is to merge all
open feature-branch PRs into the integration branch, then ship that branch to main.

## Step 1 — Audit open PRs

Use `mcp__github__list_pull_requests` (state: open) to list all open PRs.
Identify:
- Which PRs target the integration branch (not main directly)
- Which branches exist on origin but have no PR yet
- Which agents stalled (have a worktree but no PR)

If args were provided, use that as the target integration branch. Otherwise infer it
from the open PRs (the branch most PRs are targeting).

## Step 2 — Recover stalled branches

For each branch that has no PR (check `git branch -r | grep condor` or similar):
- Spawn a recovery agent pointing at the existing worktree
- The agent should: read the file, fix any code-review findings, commit, push, create PR
- Run recovery agents in parallel with `run_in_background: true`
- Wait for all to complete before continuing

## Step 3 — Merge in order

Check out the integration branch locally (`git checkout <branch>`), then merge each
feature branch with `git merge --no-ff origin/<branch>`.

**Merge order:**
1. Shell/data-layer branches (foundational — creates files others depend on)
2. Card/feature branches (pure new files, usually conflict-free)
3. IO/backup branch (last — depends on the module existing)

**Conflict resolution:**
- `manifest.json`: always keep `--ours` (highest version wins)
- `CHANGELOG.md`: always keep `--ours` (the integration branch has the canonical entry)
- Anything else: resolve properly — do not blindly take ours

## Step 4 — Wire integration points

After all merges, check for cross-module wiring that isn't done automatically:
- Any `export async function save*` or `export async function persist*` in card files
  must be called from the orchestrator's poll loop
- Grep: `grep -r "^export async function" side-panel/modules/*/cards/`
- For each such export, confirm it is imported and called in the parent orchestrator

## Step 5 — Test

Run `node test-*.js` — all suites must pass (0 failures). If any fail, fix before
continuing.

## Step 6 — Push integration branch

```
git push -u origin <integration-branch>
```

Retry up to 4× with exponential backoff (2s, 4s, 8s, 16s) on network failure.

## Step 7 — PR to main + merge

Use `mcp__github__create_pull_request` to open a PR from the integration branch to
`main`. Title: concise description of what's being shipped. Body: bullet summary of
what each major unit does + test plan checklist.

Then use `mcp__github__merge_pull_request` (merge_method: "merge") to merge it.

## Step 8 — Report

Print a final table:

| # | Unit | Branch | PR | Status |
|---|------|--------|----|--------|
| 1 | ... | ... | #nn | merged |

One-line summary: "X/Y units shipped to main as PR #nn."
