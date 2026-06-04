# Monthly rule-currency check (The Keeper)

Paste this body into a scheduled trigger in Claude Code on the web. Recommended
cadence: monthly (e.g. first Sunday, 03:00). Run it **off-cycle more often around
the QOF turnover (Feb–Apr)** and the **autumn vaccination cohort announcements
(Jun–Aug)**, when the source guidance moves.

This routine runs **The Keeper** skill (`.claude/skills/the-keeper/`), which keeps
the four Sentinel rule files current against their authoritative UK sources:

- `rules/drug-rules.json` — BNF monitoring / BSR shared care / MHRA DSU
- `rules/qof-rules.json` — NHS England QOF guidance / NICE indicator menu
- `rules/vaccine-rules.json` — UKHSA Green Book / JCVI / annual flu letter
- `rules/alert-library.json` — PINCER / NICE Key Therapeutic Topics / MHRA DSU

---

## Prompt to use

> Run The Keeper for the Sentinel rules. Follow `.claude/skills/the-keeper/SKILL.md`
> exactly: read the source register and the four current rule files, fan out the
> four domain scanners, verify every candidate change against its source page
> (no provenance, no edit), then apply only the verified, **conservative,
> additive** changes.
>
> Hard rules (non-negotiable — these are live clinical-safety rules):
> - **Never silently weaken monitoring or alerting.** Any change that lengthens a
>   monitoring interval, removes a test, narrows a `match`, adds an `exclude`,
>   disables/retires a rule, or raises a threshold must be listed in the report's
>   "Changes needing CSO sign-off" box and left **for Dave to approve** — do not
>   merge it.
> - **Brand completeness is mandatory** when touching any `drug.match` list
>   (BNF / dm+d / emc), because a missing brand silently fails to fire.
> - **Update the regression guard**: after any `match`/`exclude` change, extend
>   `test-drug-brand-coverage.js` (and the relevant `test-*.js`) so the change is
>   locked in, then run the rule test suite. **Do not push if any test fails** —
>   report the failure instead.
> - Bump `manifest.json` and add a `CHANGELOG.md` entry on the same commit, per
>   `CLAUDE.md` (patch for a brand/interval fix, minor for new rules or a QOF-year
>   refresh).
> - **Push to the session dev branch and present the change-proposal report and
>   the diff for review. Do NOT push to `main` and do NOT open a PR** unless Dave
>   explicitly asks — clinical rule changes are CSO-approved, not auto-merged.
> - If nothing has drifted since `references/state/last-run.json`, end with a
>   short "all rules confirmed current" note and write the state file — do not
>   create an empty commit or PR.
>
> Finish by writing the change-proposal report to
> `/tmp/the-keeper/the-keeper-report.md` via `scripts/build_report.js`, updating
> `references/state/last-run.json`, and giving a two or three line summary of the
> headline changes and anything awaiting CSO sign-off.
