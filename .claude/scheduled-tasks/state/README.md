# Loop run-state

Durable run-state for the scheduled loops — the **"durable state"** column of the
loop anatomy (see `../README.md`). One uniform schema, **two transports**, because
the execution container is ephemeral: state only survives if it lands somewhere
that outlives the container.

| Transport | Used by | Why |
|---|---|---|
| **Committed file** — `state/<loop>.last-run.json` | loops that push to the repo (e.g. `weekly-feature-list`) | the stamp lands in the commit the loop already makes, so it persists and the git history doubles as a loop-health log. |
| **Issue/PR footer** — an HTML comment in the artefact body | **report-only** loops (`weekly-bug-bash`, `weekly-security-audit`, `weekly-extraction-canary`) | these must NOT write to the repo, so their state rides in the GitHub issue/PR they already create. Invisible in the render, greppable in the raw body. |

> **The Keeper** (`monthly-rule-currency`) keeps its own richer, domain-specific
> state at `../../skills/the-keeper/references/state/last-run.json` (rule-file
> `lastUpdated`/`specVersion`, source URLs checked). It predates this helper and
> is left as-is. **Safety-case** uses an `origin/main` content compare as its
> durable state and has a strict "stage only the four docs" guard, so it is not
> wired to either transport here.

Read and write state **only** through the helper, so the schema stays identical
across loops:

```sh
# committed-file transport (push-loops):
node ../scripts/loop-state.js read   <loop>            # print current state (bootstrap if absent)
echo '{"lastRunMainSha":"<sha>","outcome":"pushed"}' \
  | node ../scripts/loop-state.js update <loop>        # merge + stamp lastRun=now + write the file

# issue/PR-footer transport (report-only loops):
node ../scripts/loop-state.js parse  < issue-body.md   # recover last run's state from a pasted body
echo '{"lastRunMainSha":"<sha>","outcome":"issue-opened","output":"issue #47"}' \
  | node ../scripts/loop-state.js footer <loop>         # emit the HTML-comment line to append to the new body
```

## Schema (`schemaVersion: 1`)

| Field | Type | Meaning |
|---|---|---|
| `loop` | string | The loop's filename stem (e.g. `weekly-bug-bash`). |
| `schemaVersion` | int | Bumped only if this shape changes. |
| `lastRun` | ISO string \| null | Timestamp of the last successful run; `null` on bootstrap. |
| `lastRunMainSha` | string \| null | `origin/main` short SHA at the last run. Scope "changed since" off this instead of a fixed time window. |
| `outcome` | string | `no-op` \| `issue-opened` \| `heartbeat` \| `proposed` \| `pushed` \| `tests-red` \| `aborted` \| … |
| `output` | string \| null | Ref to the artefact produced (issue #, commit SHA, PR, file path). |
| `window` | object \| null | Loop-specific scope of the last run, e.g. `{ "filesReviewed": 12 }`. |
| `openItems` | array | `[{ id, summary, firstFlagged }]` — flagged but not yet resolved, so the next run can mark them "previously flagged, still open" and show their age. |
| `notes` | string | Free text. |

## Conventions

- **Bootstrap (`lastRunMainSha: null`)**: treat as "first run — fall back to the
  default time window" rather than erroring. `parse` returning `null` (no footer
  found) is also bootstrap.
- **Stamp only on a real run.** Don't advance state for a run that decided not to
  do its work at all (e.g. bug-bash skipping a trivial week) — leave the prior
  `lastRunMainSha` intact so the next run still covers those commits. Do stamp
  when the loop did its work, including when the trustworthy result was "nothing
  to report" (`heartbeat`).
- **A report-only no-findings week may not advance state** if it opens no
  artefact to carry the footer (bug-bash). That's safe: the next run simply
  re-includes the clean stretch, which re-reviews to clean. Loops that always
  post something (security-audit's heartbeat) advance every week.
- **Carry forward `openItems`** (keeping each item's original `firstFlagged`) so a
  lingering finding shows its age across runs.
- **Forward-compatible reads**: `read` folds stored records over the current
  bootstrap default, so a file written by an older schema still reads with every
  current field present.

`node ../scripts/loop-state.js selftest` exercises both transports.
