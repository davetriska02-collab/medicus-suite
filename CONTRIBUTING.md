# Contributing to Medicus Suite

This extension reads real GP clinical data, so contributing here carries a bit
more responsibility than a typical side project. The rules below keep it safe
and keep the codebase coherent. None of them are hard once you've done them
once — and Claude Code knows them all (they're in `CLAUDE.md`), so it'll help
you follow them.

New to the project? Start with [`docs/ONBOARDING-NICK.md`](docs/ONBOARDING-NICK.md)
and [`docs/AGENTS-AND-THE-BOYS.md`](docs/AGENTS-AND-THE-BOYS.md).

## The workflow

1. **Work on a branch, never on `main`.** `main` is the live version people run.
2. **Open a pull request** when ready. CI runs automatically; a Virtual Dave
   review is posted on contributor PRs as a first opinion (it's advisory — a
   human still approves).
3. **Don't merge on red.** If a check fails, ask Claude to explain and fix it.
4. **Safety-critical paths need owner review.** Changes to `rules/`, `engine/`,
   `content-scripts/`, `manifest.json` or `defaults.json` require
   @davetriska02-collab's approval (enforced via `.github/CODEOWNERS`).

## The hard rules

- **Never commit patient data.** Nothing from `uploads/`, `data/sars/`,
  `output/`, no real NHS numbers, no screenshots of real records — ever. CI
  enforces this (`scripts/check-no-patient-data.js`), but the first line of
  defence is you.
- **Version + changelog on every shipped change.** Bump `manifest.json`
  `version` (semver) and add a `CHANGELOG.md` entry on the same commit.
- **Shipped-config changes bump `defaults.json`'s integer `"version"`.** If you
  change shipped rules / chips / thresholds, bump it and run
  `node scripts/regen-defaults.js`, or the change silently never reaches
  existing installs. See `CLAUDE.md` for the full detail.
- **Add tests for new rule coverage.** Especially clinical rules — a missing
  alert is a patient-safety risk, not a cosmetic bug.

## Running things locally

```
npm install      # once after cloning — also activates the pre-commit hook
npm test         # run the full suite
npm run lint     # ESLint
```

Run a single test file directly: `node test-foo.js`.

## When in doubt

Ask. Either ask Claude to explain what it's about to do, or ping Dave on the PR.
There is no daft question on clinical software.
