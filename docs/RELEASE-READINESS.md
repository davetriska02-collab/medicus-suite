# Medicus Suite — Release-Readiness Checklist

A one-page pre-tag checklist. It does **not** replace any control — it pulls the
controls that already exist (CI workflows, scheduled tasks, `CLAUDE.md`
conventions) into one place so nothing is silently skipped before a release is
tagged.

This is a **checklist, not an agent.** Most lines are already enforced
automatically by CI; they are listed so a human can confirm the gate is green,
not so anyone re-runs them by hand. The lines that are *not* machinable —
clinical sign-off above all — are the point of the document.

How to read the **Gate** column:
- **CI** — enforced automatically by `.github/workflows/` on push/PR; you are
  confirming it went green, not running it.
- **Convention** — a `CLAUDE.md` rule; check it held for this change.
- **Human** — a judgement only a person can make. These do not block in CI by
  design; they block *here*.

---

## 1 · Build hygiene

| ✓ | Check | Gate | Where |
|---|---|---|---|
| | `manifest.json` `version` bumped (semver: patch/minor/major) | Convention | `CLAUDE.md` §Version bumping |
| | `CHANGELOG.md` entry added on the **same commit**, version + date correct | Convention | `CHANGELOG.md` |
| | Tag (if pushing one) matches `manifest.json` version exactly | CI | `release.yml` "Verify manifest version matches tag" |
| | No patient data staged — nothing from `uploads/`, `data/sars/`, `output/` | Human | `git status`; `CLAUDE.md` §Git workflow |

## 2 · Automated gates (confirm green, don't re-run)

| ✓ | Check | Gate | Where |
|---|---|---|---|
| | Full test suite passes | CI | `test.yml` (release gate; H-006) |
| | Triage Lens 3-copy defaults in sync | CI | `scripts/regen-defaults.js --check` |
| | Safety-doc versions track manifest | CI | `scripts/check-doc-versions.js` |
| | Vendored-library integrity matches `vendor-versions.json` | CI | `test.yml` vendor step |
| | Drug-brand coverage guard passes (if `match`/`exclude` changed) | CI | `node test-drug-brand-coverage.js`; `CLAUDE.md` §drug rules |
| | Lint + format clean on changed JS | Convention | `npm run lint`, `npm run format:check` (pre-commit hook) |

## 3 · Did this change touch one of these? Then…

| ✓ | If the change… | …confirm | Gate |
|---|---|---|---|
| | added a **new module** | button in **both** `panel.html` and `pop-out.html`; entry in `MODULES` in **both** `panel.js` and `pop-out.js` | Convention |
| | added a **storage key** | the key is in the module's `shared/io/<module>-io.js` export **and** import | Convention |
| | added a **brand-new module with storage** | full IO wiring per `CLAUDE.md` (VALID_SCOPES, doFullExport, applyEnvelope, preview, options.html) | Convention |
| | changed **side-panel UI** | run the `update-tour` skill; tour anchors still resolve; `TOUR_VERSION` bumped if steps changed | Human |
| | changed a **clinical rule set** (drug/QOF/vaccine/alert/ACB/STOPP-START) | the change came through `the-keeper` (verified against source), regression tests updated | Human |

## 4 · Clinical safety — the lines that actually gate

These are non-machinable and are the reason this document exists. If the change
touches patient-facing logic or any safety claim, **none of section 2 going
green substitutes for these.**

| ✓ | Check | Gate |
|---|---|---|
| | Does this change introduce, alter, or remove a **hazard**? If so, `docs/HAZARD-LOG.md` updated *before* release (additive; never delete a hazard or lower a rating) | Human |
| | Safety case (`INTENDED-PURPOSE`, `CLINICAL-SAFETY-NOTICE`, `HAZARD-LOG`, `sentinel-DISCLAIMER`) synced with the code as shipped | Human / `weekly-safety-case` task |
| | New third-party dependency or model call? `docs/SOUP.md` updated | Human |
| | Any change to **patient-facing logic or safety docs** has explicit **CSO sign-off** (Dr Dave Triska, GMC 7534932) | Human — **hard gate** |

---

## What this checklist deliberately is *not*

- It does not chase **release velocity.** For a clinical decision-support tool,
  the human clinical-judgement lines in §4 are the bottleneck *by design*; a fast
  release that skips them is the failure mode, not the goal.
- It does not produce "regulatory-grade" or "courtroom-grade" evidence. The
  `release.yml` build already emits a real SHA-256 of the shipped zip
  (`SHA256SUMS.txt`) — that proves the artefact wasn't altered after build, and
  nothing more. It is not provenance, not correctness, and not a substitute for
  the human sign-off in §4.
