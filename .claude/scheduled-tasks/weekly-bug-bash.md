# Weekly bug bash prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: weekly, overnight (e.g. Sunday 02:00 in the user's local timezone).
Iterate on this prompt over time — every false-positive class you trim here
saves morning triage time.

---

## Prompt to use

You are running an automated weekly bug bash on the medicus-suite Chrome
extension. The user is asleep — this run produces a written report, not code
changes.

### What to do

1. **Scope**: review code changed on `main` in the last 7 days (`git log
   --since="7 days ago" --name-only --pretty=format:` to get the file list).
   If fewer than 5 files changed, broaden to 14 days. If still trivial, skip
   the run and open no issue.

2. **Fan out**: launch up to 6 sonnet subagents in parallel, each scoped to a
   distinct area so they don't overlap. Suggested split (adapt to what
   actually changed):
   - Engine + rules (`engine/`, `rules/`)
   - Content scripts + service worker (`content-scripts/`, `service-worker.js`,
     `popup.js`)
   - Side panel modules (`side-panel/`)
   - Options pages (`options/`, `sentinel-options/`, `pop-out/`)
   - Shared IO + backup (`shared/`)
   - Triage lens + visualiser (`content-scripts/triage-lens/`,
     `visualiser-core.*`)

   Each agent prompt should ask for: logic bugs, erroneous chrome.* API usage,
   data corruption risks, XSS via innerHTML, async safety, race conditions.
   Tell each agent: **real bugs only**, no style nits, no hypothetical risk,
   under 1000 words per report, file:line + severity + one-line fix per finding.

3. **Verify before reporting (critical)**: after agents return, for every
   finding open the cited file and confirm the bug is real on the current `main`
   tip. Reject anything that:
   - References code that doesn't exist or has different line numbers
   - Was already fixed in a previous commit
   - Is a duplicate of another agent's finding
   - Is intent-ambiguous (e.g. "threshold seems off" without evidence)

   Today's run rejected 5 of 27 findings at this step. Be ruthless — false
   positives are worse than missed bugs because they erode trust.

4. **Output**: open ONE GitHub issue on `davetriska02-collab/medicus-suite`
   titled `Weekly bug bash — YYYY-MM-DD` with this structure:

   ```
   ## Summary
   N findings across M files. Window: last 7 days.

   ## Critical (crash / wrong clinical output)
   - **`path/to/file.js:42`** — one-sentence bug.
     Fix: one-line idea.

   ## High (silent failure / data loss / XSS)
   ...

   ## Medium
   ...

   ## Low (intent ambiguity / cosmetic)
   ...

   ## Rejected during verification (kept for transparency)
   - Brief note on what was rejected and why.
   ```

   Label the issue `bug-bash` and `automated`. Don't open fix PRs — the user
   triages and decides.

5. **No issue if no findings**: if every finding is rejected during
   verification, do not open an issue. Just end the session.

### What NOT to do

- Do NOT push commits, open PRs, or modify any file.
- Do NOT comment on other PRs or issues.
- Do NOT include findings about code that hasn't changed in the review window
  (the goal is to catch new bugs early, not relitigate old code).
- Do NOT include process suggestions, refactoring ideas, doc improvements, or
  "while you're here" findings. Bugs only.
