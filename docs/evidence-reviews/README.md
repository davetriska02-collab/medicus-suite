# Weekly evidence reviews

This folder holds the output of the **weekly clinical evidence-review routine**
(`.claude/scheduled-tasks/weekly-evidence-review.md`). Each week the routine
checks every clinical rule the suite ships against current best evidence and
files a dated report here. **Nothing in `rules/` or `defaults.json` is changed
by the routine** — it only proposes, after independent verification, and you
apply the changes you approve.

## What the routine reviews

- `rules/qof-rules.json` — QOF registers + indicators → **NHS England QOF
  business rules / indicator spec** + NICE indicator menu
- `rules/drug-rules.json` — drug-monitoring intervals/tests → **BNF/BNFc**,
  **NICE NG/CKS**, shared-care protocols, **MHRA Drug Safety Updates**
- `rules/alert-library.json` — PINCER + prescribing-safety alerts → **PINCER
  spec**, **SIGN**, **MHRA**
- `defaults.json` (Triage Lens — the "extended suite") — CKS / Pharmacy First
  signposting links → **NICE CKS**, **NHS Pharmacy First**

## How it works (the safety gate)

1. **Propose** — per-rule evidence search by scoped agents → flags `OK` /
   `STALE` / `DISCREPANCY` / `NEW-SIGNAL` with a precise proposed change + source.
2. **Verify** — a *separate, independent* agent re-checks each proposed value
   from primary sources **without seeing the proposer's reasoning**. Only
   `VERIFIED` changes (where proposer and verifier agree) become patches.
3. **Synthesise** — Opus groups verified changes into a build plan and writes a
   gated **patch file** per change (before/after snippet + citation + risk class).
4. **Approve** — *you* review the report and apply the patches you accept. A
   `REJECTED` / `UNCERTAIN` / disagreed proposal is parked under "Needs human
   review", never auto-applied.

## Layout of each week's review

```
docs/evidence-reviews/
  <YYYY-MM-DD>/
    report.md              # human-readable review (priority signals, tables, coverage)
    patches/
      <rule-id>--<field>.md  # one gated, apply-by-hand patch per VERIFIED change
```

## Applying a patch

Patches are intentionally **not** pre-applied. To accept one:
1. Open the patch file; re-read its source + verifier citation.
2. Make the named edit in the target rule file by hand.
3. Bump `manifest.json` (patch/minor per `CLAUDE.md`) and add a `CHANGELOG.md`
   entry on the same commit — the rule change *is* extension content.
4. For drug-monitoring/QOF/PINCER changes, also reconcile the safety case
   (`docs/HAZARD-LOG.md`, etc.) if the change alters a documented behaviour.

## Index

| Date | Verified | Needs review | Priority signal | Report |
|---|---|---|---|---|
| _(routine appends rows here)_ | | | | |
