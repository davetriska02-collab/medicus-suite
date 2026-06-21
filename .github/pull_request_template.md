<!--
Thanks for contributing to Medicus Suite. This is patient-adjacent software, so
the checklist below isn't bureaucracy — each item maps to a real failure mode.
Tick what applies; delete what genuinely doesn't. If unsure, ask in the PR.
-->

## What does this change do?

<!-- One or two plain-English sentences. What problem does it solve? -->

## How was it tested?

<!-- "Ran `npm test`", "loaded the extension and checked the X tab", etc. -->

---

### Checklist

- [ ] **No patient data** in the diff — nothing from `uploads/`, `data/sars/`,
      `output/`, no real NHS numbers, no screenshots of real records.
- [ ] **Version + changelog** — bumped `manifest.json` `version` and added a
      `CHANGELOG.md` entry on the same commit (for any shipped change).
- [ ] **Shipped-config bump** — if I changed `defaults.json` rules / chips /
      thresholds, I bumped its integer `"version"` and ran
      `node scripts/regen-defaults.js`.
- [ ] **Tests** — added/updated tests for new rule coverage, and `npm test`
      passes locally.
- [ ] **Scope** — this is one focused change, not several unrelated ones.

> New here? See [`CONTRIBUTING.md`](../blob/main/CONTRIBUTING.md) and
> [`docs/ONBOARDING-NICK.md`](../blob/main/docs/ONBOARDING-NICK.md). Don't merge
> on red CI — ask Claude to explain and fix it first.
