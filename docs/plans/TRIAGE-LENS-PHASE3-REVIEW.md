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

## Part C — Calibration content pass (3.3) — BUILT, VERIFIED, awaiting sign-off

Built and committed as a **draft** (`ef031d3` + corrections `d9d7615`), config
version 21→22, regen + lock refreshed. **Not released** — no manifest bump, not
merged to main. Every threshold was independently re-checked by a second agent
against a named UK source (the "Verdict" column). Suite 143/143.

### Shipped in this pass (all CONFIRMED or defensible)

| Analyte | Rule | Amber | Red | Source | Verdict |
|---|---|---|---|---|---|
| Sodium (high) | `base-high-sodium` | ≥150 | **≥160** | severe-hypernatraemia convention | corrected 155→160 (155 unsourced) |
| Creatinine absolute | `base-high-creatinine-aki` | — | ≥354 µmol/L | KDIGO AKI stage 3 (353.6) | ✅ CONFIRMED |
| Creatinine rise | `base-creatinine-delta-aki` | ≥+26.5 in 48h | — | KDIGO AKI stage 1 | ✅ CONFIRMED |
| Glucose high | `base-high-glucose` | ≥11.1 | ≥30 | WHO/NICE dx; JBDS HHS | ✅ CONFIRMED |
| Glucose low | `base-low-glucose` | ≤4.0 | ≤3.0 | "4 is the floor"; ISHG Level-2 | ✅ CONFIRMED |
| CRP high | `base-high-crp` | ≥20 | ≥100 | NICE CG191 pneumonia | ✅ CONFIRMED (exact) |
| WCC high | `base-high-wcc` | ≥12 | — | SIRS criterion | ✅ CONFIRMED |
| Potassium amber band | `base-high-potassium` | **≥6.0** (new) | ≥6.5 (unchanged) | UK Kidney Assoc. hyperkalaemia | ✅ CONFIRMED (exact) |
| HbA1c | `base-hba1c-diabetes` | **48** (was red) | — | NICE NG28 / WHO dx = 48 | value ✅; demotion = policy call ⚠ |
| ALT high | `base-high-alt` | ≥120 | ≥320 U/L | 3×ULN statin-stop; ~8×ULN | ⚠ amber grounded, red soft, lab-ULN varies |
| AST high | `base-high-ast` | ≥120 | ≥320 U/L | paired with ALT | ⚠ same caveat |
| Neutrophils high | `base-high-neutrophils` | ≥7.5 | — | UK lab reference ULN | ⚠ range-boundary, not an action threshold |

### Reverted after verification (NOT shipped)

- **FIB-4 age-adjustment** — my original instruction was clinically wrong. The
  shipped `red ≥3.25 for ≥65` used the **hepatitis-C** FIB-4 cutoff, not the
  NAFLD/MASLD one, and would have **missed referral-grade fibrosis in over-65s**
  (2.67–3.24 → only amber). The correct age-adjustment (McPherson 2017 / AASLD
  2023 / EASL-EASD-EASO 2024) *raises the rule-out cutoff* to 2.0 for ≥65 while
  keeping referral at 2.67 for all ages — but that needs the engine to
  **suppress** low-range elderly alerts, which the escalate-only model can't do.
  So FIB-4 is reverted to status quo (red ≥2.67 all ages) and the correct
  age-split is proposed below as follow-up, not shipped.

---

## Decisions that need you (short list)

1. **HbA1c red → amber** — value is correct (48 = diagnostic); demoting from red
   is an alert-fatigue tradeoff (new-diabetes isn't acutely dangerous like AKI).
   Your call: ship the demotion, or keep it red?
2. **ALT/AST 120 / 320 U/L** — amber (3×ULN) is well-grounded; red (8×ULN) is
   plausible but not guideline-cited, and both are inherently lab-ULN-dependent
   (labs vary 30–55 U/L). Ship as-is with the caveat, adjust the red, or hold LFTs?
3. **Neutrophils ≥7.5** — this is a lab-range boundary, not a validated action
   threshold like WCC>12. Keep as a low-confidence "outside range" flag, or drop it?
4. **Sodium red ≥160** — I moved it from 155 (unsourced) to 160 (better-sourced
   severe convention). Confirm 160, or prefer a different cutoff?
5. **FIB-4 follow-up** — do you want the correct age-split pursued? It needs an
   engine change (a way for a context rule to *raise a rule's own lower cutoff*
   for a band, i.e. controlled suppression) — a small Phase-5-style addition.
6. **Deferred deltas** — Hb-fall and K⁺-rise delta rules were not shippable (no
   defensible UK-guideline magnitude found). Pursue, or leave the point-in-time
   potassium/Hb thresholds to cover it?

---

## Sign-off

- [ ] Part A.1 positive-qualitative lexicon approved / amended
- [ ] Part A.2 negation & past-marker lists approved / amended
- [ ] Part C shipped rules approved (with any amendments to decisions 1–4 above)
- [ ] FIB-4 follow-up: pursue / drop (decision 5)
- [ ] Deferred deltas: pursue / drop (decision 6)
- [ ] **Release v3.150.0 authorised**

*No release commit (manifest bump + CHANGELOG + merge) happens until the release box is ticked.*
