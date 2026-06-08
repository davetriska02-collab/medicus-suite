# Weekly security audit (red-team) prompt

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: weekly, overnight (e.g. Sunday 03:00 in the user's local timezone) —
after the bug-bash slot, since this is the deeper, adversarial pass.

The audit logic lives in the **`security-audit` skill**
(`.claude/skills/security-audit/SKILL.md`) so there's a single source of truth —
the same routine you can run on demand by typing `/security-audit` in any session.
This scheduled prompt just invokes it in unattended (issue-opening) mode.

---

## Prompt to use

Run the `security-audit` skill as an authorised, unattended weekly red-team review
of the medicus-suite Chrome extension. The user is asleep — this is a **report-only**
run: do not modify code or open fix PRs.

Before you start, **recover durable state**. This loop is report-only and can't
write to the repo, so its state rides in the last audit issue's body as a
`loop-state` footer. Fetch the most recent `security-audit`-labelled issue and
parse it to learn what was last audited and what's still open:
```
node .claude/scheduled-tasks/scripts/loop-state.js parse < /tmp/last-audit-issue.md
```
Use `lastRunMainSha` to focus on what changed since (verify findings against the
current `main` tip regardless), and carry forward any unresolved `openItems`
(keeping their `firstFlagged`) so a still-unfixed finding shows its age.

Follow the skill exactly, in its **unattended** output mode:
- Fan out across all 8 attack surfaces, then verify every finding against the
  current `main` tip before reporting (downgrade over-rated / unreachable claims).
- Open ONE GitHub issue on `davetriska02-collab/medicus-suite` titled
  `Weekly security audit — YYYY-MM-DD`, labelled `security-audit` and `automated`,
  in the structure the skill defines. If an open `Weekly security audit` issue from
  the last 10 days already exists, comment on it instead of duplicating.
- If there are no new findings after verification, open a short heartbeat issue
  (with the audited `main` sha) so there's a visible signal the routine ran.
- **Embed the durable-state footer** as the last line of whichever artefact you
  post (full issue, comment, or heartbeat) — invisible in the render, parsed next
  week:
  ```
  SHA=$(git rev-parse --short origin/main)
  echo "{\"lastRunMainSha\":\"$SHA\",\"outcome\":\"issue-opened\",\"output\":\"issue #<n>\",\"openItems\":[]}" \
    | node .claude/scheduled-tasks/scripts/loop-state.js footer weekly-security-audit
  ```
  Use `"outcome":"heartbeat"` for a clean week. Because a heartbeat is always
  posted, state advances every week even when there's nothing to report.

Do NOT open fix PRs, comment on unrelated issues, or modify any file.
