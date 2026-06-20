# Automated PR review — "Virtual Dave"

This repo can auto-review every pull request in the voice of **Virtual Dave**
(Dr Dave Triska's digital twin, persona defined in
[`.claude/agents/virtual-dave.md`](../.claude/agents/virtual-dave.md)). It's
aimed at giving Nick — and any contributor — fast, safety-first feedback before
a human review.

There are **two ways** it runs. They're complementary.

---

## 1. Always-on GitHub Action (set up once)

The workflow [`.github/workflows/claude-review.yml`](../.github/workflows/claude-review.yml)
triggers on every PR (opened / new pushes / reopened), gets into the
virtual-dave persona, reads `CLAUDE.md` + the diff, and posts **one** review
comment with a verdict (`Ship it` / `Ship after tweaks` / `Needs work`).

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
