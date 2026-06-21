# PR review & repo governance

How contributions are reviewed and gated on this repo. Two halves:

- **Automated "Virtual Dave" review** (sections 1–2) — auto-reviews each PR in
  the voice of **Virtual Dave** (Dr Dave Triska's digital twin, persona in
  [`.claude/agents/virtual-dave.md`](../.claude/agents/virtual-dave.md)), giving
  Nick and any contributor fast, safety-first feedback before a human looks.
- **The governance stack** (section 3) — branch protection, code owners, the
  patient-data CI guard and the contributor checklist that actually *gate* a
  merge. Virtual Dave is advisory; these are the real gates.

Virtual Dave runs **two ways**, which are complementary.

---

## 1. Always-on GitHub Action (set up once)

The workflow [`.github/workflows/claude-review.yml`](../.github/workflows/claude-review.yml)
triggers when a PR is **opened / reopened / marked ready for review** (not on
every push — see "Cost / quota" below), gets into the virtual-dave persona,
reads `CLAUDE.md` + the diff, and posts **one** review comment with a verdict
(`Ship it` / `Ship after tweaks` / `Needs work`).

### One-time setup (Dave, repo owner)

1. **Install the Claude GitHub App** on the repo:
   - Go to https://github.com/apps/claude and install it on
     `davetriska02-collab/medicus-suite` (or run `/install-github-app` from the
     Claude Code CLI, which walks you through it).

2. **Add the auth secret** so the Action can talk to Claude on your Max plan
   (no per-PR API billing — it draws on your existing subscription):
   - On your machine with the CLI logged in, run:
     ```
     claude setup-token
     ```
   - Copy the token it prints.
   - In GitHub: **repo → Settings → Secrets and variables → Actions → New
     repository secret**.
   - Name it **`CLAUDE_CODE_OAUTH_TOKEN`**, paste the token, save.

That's it. The next PR Nick opens gets a Virtual Dave review automatically.

> The token expires periodically — if reviews stop appearing, re-run
> `claude setup-token` and update the secret.

### Who gets reviewed

It reviews contributors' PRs but **skips the maintainer's own** — the `review`
job has an `if:` guard excluding `davetriska02-collab`, because Dave doesn't
need his own digital twin reviewing him:

```yaml
  review:
    if: ${{ github.event.pull_request.draft == false && github.event.pull_request.user.login != 'davetriska02-collab' }}
```

To instead restrict it to *only* specific authors (e.g. once you know Nick's
GitHub username), swap the guard for:

```yaml
  review:
    if: ${{ github.event.pull_request.user.login == 'NICKS_USERNAME' }}
```

### Cost / quota

The review runs on `opened` / `reopened` / `ready_for_review` only — **not** on
every push (`synchronize`) — so iterating on a PR doesn't burn a fresh review
(and your subscription quota) on every commit. To re-trigger a review after
changes, close+reopen the PR, or ask in a live session (section 2). Add
`synchronize` back to the `on.pull_request.types` list in the workflow if you
want every push reviewed.

---

## 2. Live-session review (hands-on, no setup)

In any Claude Code session on this repo you can have Virtual Dave review a PR on
demand, or watch a PR and react to events as they arrive:

- **One-off:** ask Claude *"review PR #N as virtual-dave"* — it spawns the
  `virtual-dave` agent against the diff.
- **Watch a PR:** ask Claude to *"watch PR #N"* — it subscribes to PR activity
  (CI results, review comments, new pushes) and responds as events come in.
  This only runs while a session is alive, so it's for active back-and-forth,
  not unattended coverage. The always-on Action (above) is the safety net.

---

## What it checks

Virtual Dave reviews in Dave's actual priority order:

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

Virtual Dave is **advisory** — a fast first opinion, never a gate. The actual
gates are deterministic and human, layered around it:

| Control | File | What it enforces |
|---|---|---|
| **Branch protection** | repo settings (see below) | No direct pushes to `main`; PR + passing checks + review required |
| **Code owners** | [`.github/CODEOWNERS`](../.github/CODEOWNERS) | Maintainer review required on `rules/`, `engine/`, `content-scripts/`, `manifest.json`, `defaults.json` |
| **Patient-data guard** | [`scripts/check-no-patient-data.js`](../scripts/check-no-patient-data.js) (in `test.yml`) | Fails CI on files under `uploads/`/`data/sars/`/`output/`, or Modulus-11-valid NHS numbers in PR-added lines |
| **Contributor checklist** | [`CONTRIBUTING.md`](../CONTRIBUTING.md) + [`.github/pull_request_template.md`](../.github/pull_request_template.md) | No PHI, version+changelog, `defaults.json` bump, tests |

> **Important:** Virtual Dave must stay advisory. Do **not** wire it as a
> required status check or let it auto-approve — it's non-deterministic, and a
> stochastic process should never be a patient-safety gate. The deterministic
> tests + your human review (via CODEOWNERS) are the things that actually block.

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
     - └ **Require review from Code Owners** ← *this activates `CODEOWNERS`;
       without it the file only auto-requests review, it doesn't block.*
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
session you can just ask Claude to *"test branch protection"* and it'll do this
and clean up after itself.

**Last verified:** 2026-06-21 — PR against `main` returned
`mergeable_state: "blocked"`, confirming protection is active. The remaining
real-world test of code-owner enforcement is the first contributor PR touching
a `CODEOWNERS` path (e.g. `rules/`), which should require maintainer review
before merge.

### Token expiry (operational gotcha)

The `CLAUDE_CODE_OAUTH_TOKEN` secret expires periodically. When it lapses, the
review job fails silently and PRs just stop getting reviewed — no alarm. Set a
calendar reminder to re-run `claude setup-token` and update the secret, or
check the Action's status occasionally.
