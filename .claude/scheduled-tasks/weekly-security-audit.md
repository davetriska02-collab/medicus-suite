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

Follow the skill exactly, in its **unattended** output mode:
- Fan out across all 8 attack surfaces, then verify every finding against the
  current `main` tip before reporting (downgrade over-rated / unreachable claims).
- Open ONE GitHub issue on `davetriska02-collab/medicus-suite` titled
  `Weekly security audit — YYYY-MM-DD`, labelled `security-audit` and `automated`,
  in the structure the skill defines. If an open `Weekly security audit` issue from
  the last 10 days already exists, comment on it instead of duplicating.
- If there are no new findings after verification, open a short heartbeat issue
  (with the audited `main` sha) so there's a visible signal the routine ran.

Do NOT open fix PRs, comment on unrelated issues, or modify any file.
