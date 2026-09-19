# PR review & repo governance

How contributions are reviewed and gated on this repo. Two halves:

- **Medicus Steward review** (sections 1–2) — contributor PR review is owned by
  **Medicus Steward** (the Grok Bot CI watch). It posts a safety-first review
  comment with a verdict (`Ship it` / `Ship after tweaks` / `Needs work`),
  giving Nick and any contributor fast feedback before a human looks. The old
  Claude "Virtual Dave" GitHub Action is **retired** (see "History" below).
- **The governance stack** (section 3) — branch protection, code owners, the
  patient-data CI guard and the contributor checklist that actually _gate_ a
  merge. The Steward is advisory; these are the real gates.

---

## 1. The `review` check (GitHub Action gate)

The workflow [`.github/workflows/steward-review.yml`](../.github/workflows/steward-review.yml)
triggers when a PR is **opened / reopened / marked ready for review** (not on
every push — re-trigger by closing and reopening the PR). It:

1. Keeps the check name branch protection expects — the job id is **`review`**,
   unchanged from the retired Claude workflow, and it always exits
   successfully, so the required check goes green with **no external
   dependency and no secrets beyond the built-in `GITHUB_TOKEN`**.
2. Posts **one** notice comment on the PR (deduped by a hidden marker) telling
   the contributor that Medicus Steward owns review.

The Steward's actual review of the diff arrives as its own PR comment.

### Who gets reviewed

It covers contributors' PRs but **skips the maintainer's own** — the `review`
job has an `if:` guard excluding `davetriska02-collab`, and drafts are skipped:

```yaml
review:
  if: ${{ github.event.pull_request.draft == false && github.event.pull_request.user.login != 'davetriska02-collab' }}
```

(A skipped required check still satisfies branch protection.)

### Setup

**None.** The workflow uses only the repository's built-in `GITHUB_TOKEN`.

### History — Claude "Virtual Dave" Action (retired)

Until v3.263.11 this gate ran `anthropics/claude-code-action` with the
`virtual-dave` persona, authenticated by a repo secret
`CLAUDE_CODE_OAUTH_TOKEN` that expired periodically and silently killed
reviews when it lapsed. That Action, the Claude GitHub App installation, and
the `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` secrets are **no longer
needed** — the secrets can be deleted from the repo settings and the app
uninstalled. The persona file (`.claude/agents/virtual-dave.md`) remains for
live-session use (section 2).

---

## 2. Live-session review (hands-on, no setup)

In any agent session on this repo you can still ask for an on-demand review of
a PR, or watch a PR and react to events as they arrive:

- **One-off:** ask the agent to _"review PR #N as virtual-dave"_ — it adopts
  the `virtual-dave` persona against the diff.
- **Watch a PR:** ask the agent to _"watch PR #N"_ — it subscribes to PR
  activity (CI results, review comments, new pushes) and responds as events
  come in. This only runs while a session is alive, so it's for active
  back-and-forth; the Steward's standing watch is the unattended coverage.

---

## What a Steward review checks

Reviews run in Dave's actual priority order:

1. **Patient safety first** — wrong/missing clinical alerts, PHI leaks, weakened
   review gates, anything breaking the read-only / no-exfiltration model is a
   blocker.
2. **The repo's golden rules** (from `CLAUDE.md`) — no patient data committed;
   `manifest.json` version bump + `CHANGELOG.md` entry on shipping changes;
   `defaults.json` version bump when shipped rules change; tests updated for new
   rule coverage.
3. **Correctness & tech debt** — does it do what it claims; will it survive the
   Vue/AG-Grid SPA churn if it touches queue injection; is there a simpler way.
4. **Clinician UX** — does it get in the way of an 8-minute appointment.

It reviews only — it never modifies code or pushes commits.

---

## 3. The wider governance stack

The Steward is **advisory** — a fast first opinion, never a gate. The actual
gates are deterministic and human, layered around it:

| Control                   | File                                                                                                                | What it enforces                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Branch protection**     | repo settings (see below)                                                                                           | No direct pushes to `main`; PR + passing checks + review required                                            |
| **Code owners**           | [`.github/CODEOWNERS`](../.github/CODEOWNERS)                                                                       | Maintainer review required on `rules/`, `engine/`, `content-scripts/`, `manifest.json`, `defaults.json`      |
| **Patient-data guard**    | [`scripts/check-no-patient-data.js`](../scripts/check-no-patient-data.js) (in `test.yml`)                           | Fails CI on files under `uploads/`/`data/sars/`/`output/`, or Modulus-11-valid NHS numbers in PR-added lines |
| **Contributor checklist** | [`CONTRIBUTING.md`](../CONTRIBUTING.md) + [`.github/pull_request_template.md`](../.github/pull_request_template.md) | No PHI, version+changelog, `defaults.json` bump, tests                                                       |

> **Important:** the Steward's review must stay advisory. Do **not** let a
> model auto-approve — it's non-deterministic, and a stochastic process should
> never be a patient-safety gate. The `review` check itself is now a
> deterministic no-op notice, so it is safe as a required check; the
> deterministic tests + human review (via CODEOWNERS) are the things that
> actually block.

### Branch protection — one-time setup

This is account-gated (no CLI/tool can set it). The GitHub **iOS app can't** —
it's web-only — but **Safari on iPhone works**:

1. Open **github.com** in Safari, sign in.
2. Tap **`aA`** in the address bar → **Request Desktop Website** (mobile view
   hides these settings).
3. Go to **Settings → Branches** (URL:
   `github.com/davetriska02-collab/medicus-suite/settings/branches`).
4. **Add rule** → branch name pattern: `main`.
5. Tick:
   - ✅ **Require a pull request before merging**
     - └ **Require approvals** → **1**
     - └ **Require review from Code Owners** ← _this activates `CODEOWNERS`;
       without it the file only auto-requests review, it doesn't block._
   - ✅ **Require status checks to pass before merging** → select **`test`**
     (and `lint`, `visualiser` if offered).
   - ⚠️ **Do not allow bypassing the above settings** — a conscious choice:
     leave **unticked** to keep your own admin override (you become the safety
     valve; Nick is fully gated regardless), or **tick** to apply the rules
     even to yourself.
6. **Create / Save**.

### Verifying it works

Quick non-destructive check (never touches `main`): open a throwaway PR against
`main` and read its merge state — a protected `main` reports
`mergeable_state: "blocked"` until the required gates are met. In a live
session you can just ask the agent to _"test branch protection"_ and it'll do
this and clean up after itself.

**Last verified:** 2026-06-21 — PR against `main` returned
`mergeable_state: "blocked"`, confirming protection is active. The remaining
real-world test of code-owner enforcement is the first contributor PR touching
a `CODEOWNERS` path (e.g. `rules/`), which should require maintainer review
before merge.
