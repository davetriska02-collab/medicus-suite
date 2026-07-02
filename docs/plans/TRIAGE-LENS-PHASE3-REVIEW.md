# Triage Lens Phase 3 — Clinical Review & Sign-off

**For:** Dr Dave Triska (CSO) · **Status:** DRAFT, in progress — do not ship until signed
**Release gated:** v3.150.0 will not be committed until this document is signed off.

Phase 3 ("Smarter grading") is the first phase that changes **what fires red and
amber**. Everything else in the triage rebuild has been guardrails, honesty
states, and surfacing of already-computed data — self-reviewable. This phase
changes clinical behaviour, so it stops here for your eyes before release.

This document has two kinds of content:

1. **Engine mechanisms already merged** (behaviourally inert on the current
   shipped ruleset — no shipped rule uses the new fields yet — but two of them
   ship *lexicons* that fire behaviour now; those need your eyes).
2. **The calibration content pass (3.3)** — new/changed shipped rules in
   `defaults.json`. *Populated once 3.3 is built; this is the part that most
   needs Keeper-sourced verification.*

---

## Part A — Mechanisms merged (grading byte-identical without new content)

| Item | What it adds | Shipped rules using it |
|---|---|---|
| 3.1 Unit-mismatch guard | A rule is skipped (not applied) when its `unit` and the result's reported unit disagree; surfaced as a "unit?" chip. Fail-open when either unit is absent. | none — guards existing rules only |
| 3.2 Text rules → red | Optional `abnormalLevel:'red'` lets a designated positive text finding escalate to red instead of the amber cap. | none yet (3.3 decides) |
| 3.2 Unclassified-positive net | An unmatched non-numeric positive result surfaces amber instead of vanishing. **Ships a lexicon — see A.1.** | n/a (engine safety net) |
| 3.4 Negation/past demotion | Request chips visually demote (never suppress) when the match is negated or historic. **Ships two word-lists — see A.2.** | applies to all request rules |
| 3.6 Delta rule kind | Grade on change-over-time (rising creatinine, falling Hb). | none — candidates in Part C |
| 3.5 Patient context | Age/sex gates on result rules; age/meds/problems gates on request rules; fail-closed. | none — candidates pending |

### A.1 — Positive-qualitative lexicon (3.2, `engine/result-severity.js`) — LIVE NOW

The unclassified-positive safety net surfaces an amber "? {analyte}" chip when a
result is non-numeric, un-flagged by the lab, matched by no rule, and contains
one of these tokens **not** preceded by a negator:

```
positive · detected · reactive · isolated · abnormal · seen · present · grown · raised
```

Negation guard (whole-word, within 6 words before the token, same sentence):
`no · not · denies · denied · denying · without · never · nil · none`, **plus** a
glued-prefix guard so `non-reactive` / `non reactive` never trip it (orchestrator
fix — standard true-negative serology).

**Your call:** is this token set right — too broad (alert fatigue) or missing a
common positive phrasing? `abnormal` and `raised` are the widest; `seen`/`present`
lean on the negation guard. This is amber-max and only fires when nothing else
classified the result, so the failure direction is over-surfacing, never hiding.

### A.2 — Negation & past-reference markers (3.4, `content-scripts/triage-lens/rule-match.js`) — LIVE NOW

Request chips demote (outline + "(negated?)"/"(past?)" suffix, ranked below
un-demoted, **never removed**) when the matched phrase is:

- **Negated** — one of `no · not · denies · denied · denying · without · never · nil`
  as a whole word within 6 words before the match, same sentence.
- **Past/historic** — one of `last year · last month · years ago · months ago ·
  weeks ago · previously · in the past · history of · previous` anywhere in the
  sentence.

**Your call:** these lists drive whether a red-flag chip dims. Because demotion
never hides a chip, an over-eager negator is cosmetic; a *missed* one just leaves
the chip at full strength (safe). Anything obviously missing (e.g. "resolved",
"settled", "no longer")?

---

## Part B — Delta rule candidates (3.6) — NOT yet shipped

The delta mechanism is merged; these are *proposed* rules for the 3.3 content
pass, each needing Keeper-style source verification before shipping:

| Analyte | Direction | Basis | Amber / Red | Window | Source to verify |
|---|---|---|---|---|---|
| Creatinine | rise | absolute | +15 / +26 µmol/L | 48h–7d | KDIGO AKI stage-1 absolute-rise |
| Haemoglobin | fall | percent | ~15% / ~25% | wide/none | occult bleed heuristic |
| Potassium | rise | absolute | +0.5 / +1.0 mmol/L | short | rapid-trajectory hyperkalaemia |
| eGFR | fall | percent | ~15–25% | — | NICE CKD progression |

---

## Part C — Calibration content pass (3.3) — PENDING BUILD

*This section is populated when item 3.3 is built. It will contain, as a
reviewable diff, every new and changed shipped rule in `defaults.json`:*

- **New analytes** (missed-alert gaps): hypernatraemia, absolute creatinine/AKI,
  glucose, LFT transaminases, high CRP/WCC, a K⁺ 6.0–6.5 amber band.
- **Recalibrations** (alert-fatigue): HbA1c ≥48 red → amber (diagnostic, not
  urgent), each with its `RETIRED_*` un-stick entry so it reaches existing installs.
- **Context-paired rules** (from 3.5): e.g. FIB-4 base red ≥3.25 for all + a
  `<65` rule at 2.67, so the elderly aren't systematically over-called.

Every row will cite its primary source (BNF / NICE / KDIGO / specialty guidance)
and note the defaults version bump + un-stick requirement.

---

## Sign-off

- [ ] Part A.1 lexicon approved / amended
- [ ] Part A.2 marker lists approved / amended
- [ ] Part B delta candidates approved for build (which, at what thresholds)
- [ ] Part C calibration diffs reviewed and approved
- [ ] Release v3.150.0 authorised

*Nothing in `defaults.json` changes, and no release commits, until the boxes above are ticked.*
