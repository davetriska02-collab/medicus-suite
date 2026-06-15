# The Practice — RE-appraisal: Focus mode + Alert roll-up (post-fix)

**Date:** 2026-06-15 · **Scope:** the improved Focus/Zen mode + alert roll-up on
branch `claude/clinical-extension-redesign-pr1dso`, after the F1/F2/F3/F4/F7
fixes. Diffs against `PRACTICE-zen-rollup-2026-06-15.md`.

> **Synthetic panel — not user research.** Reactions are a heuristic device, never
> evidence a real clinician said anything.

## 1. Verdict

The fixes landed. Every previous blocker is resolved or verified-resolved, and
four of five scores rose. The on-state "Focus · Esc" pill defused the "it looks
broken" panic (Margaret, Geoff both credited it); the colourblind shape/icon/value
cues and the worst-wait on the bar passed the pharmacist's safety re-check; and
the count-reconciliation that was the manager's hard blocker is verified fixed
(her live complaint was a screenshot artefact, not a regression — see §3). The
single biggest thing still holding it back is **plain-language units**: "Demand"
and a bare count still read as jargon to the non-clinical front desk and lack a
unit even the experts want.

## 2. The panel — scores moved

| Persona | Role | Band | Prev | Now |
|---|---|---|---|---|
| Margaret Aldous | Senior GP partner | technophobe | 4 | **5** |
| Chloe Danvers | Receptionist | low-clinical | 5 | **6** |
| Janet Briggs | Practice manager | reluctant | 4 | 3* |
| Raj Patel | Clinical pharmacist | domain | 7 | **7.5** |
| Geoff Pellew | Power user | savvy | 7 | **8** |

\* Janet's score *fell*, but on a **verified false alarm** — see §3 F1. Her actual
blocker is resolved; the demo misled her.

## 3. Findings

### Resolved (verified)

- **F1 · counts reconcile — RESOLVED (verified).** Janet, seeing two screenshots,
  read "Demand 65" (collapsed) vs "115" (expanded) as non-reconciling. *Verified
  against a matched same-state render:* collapsed "Demand 115" == expanded
  "Medical 70 / Admin 45" = 115. The 65-vs-115 was the appraiser seeding two
  different data states, not the product. **Overruled as artefact.** Lesson for us:
  always demo collapsed+expanded of the *same* state.
- **F2 · Focus mode legible/escapable — RESOLVED.** Margaret: "the ESC prompt is
  clever... it tells me exactly how to get out", no longer thinks it crashed.
  Geoff: "printing its own exit is genuinely good, that's how you make a declutter
  mode non-scary." Both scores up.
- **F3 · colourblind severity — RESOLVED (on totality).** Raj: amber vs red is
  reliably separable without colour via the stacked redundant cues — warning icon
  vs filled disc, hollow vs filled pills, and the values. (He notes the *dot* alone
  is too small to carry it; the pill-fill + icon do the heavy lifting. That's fine —
  redundancy is the point.)
- **F4 · worst wait surfaced — RESOLVED.** Raj: "yes, and this is the fix I
  wanted... the longest-waiting patient is no longer hidden behind a click."
- **F7 · setup card separated — RESOLVED** (visible gap, no persona re-flagged it).

### Universal friction (the top remaining issue)

- **R1 · "Demand" and bare counts lack a unit / plain language. [MAJOR]** Hits 4 of
  5 bands. Chloe (blocked): "I don't know what Demand means... is 70 a lot?" and
  wants a dot/colour legend. Raj: label count vs wait ("3 pts · 55m" — a tired
  colleague could misread "3 55m"). Janet/Geoff: want the unit/trigger. **Fix:**
  unit-label the counts ("Demand 115 tasks", "Waiting 3 pts · 55m"), a
  plain-language tooltip on "Demand", and a small severity-dot legend.

### Tech-literacy gradient

- **R2 · Focus toggle icon still cryptic to the floor + on-state pill faint in
  dark. [MINOR]** Margaret can't tell the crosshair is a button until she's pressed
  it; wants a hover label. *Note:* the `title` tooltip already exists (hover shows
  "Focus mode (Ctrl+.)") — invisible in a screenshot, so partly already addressed.
  Real residue: the "FOCUS · Esc" pill is low-contrast on dark for tired eyes.
  **Fix:** bump the pill's dark contrast; keep the hover tooltip.

### Role-specific

- **R3 · count-vs-wait needs a unit (Raj). [MINOR]** Folded into R1.
- **R4 · "Monitoring →" truncation (Raj). [OVERRULED as safety issue].** Verified:
  that is the waiting-strip's "Go to Monitoring" *navigation button*, not a clinical
  monitoring flag — nothing clinical is hidden by the cut. The residual is cosmetic:
  patient-name chips clip at the narrow width. **Minor cosmetic fix only.**
- **R5 · persistent "always expanded" + expose thresholds (Geoff). [MINOR/feature]**
  Still wants a pinned-open roll-up and editable amber/red triggers. The config-pass
  groundwork (persisted prefs) is the natural home.
- **R6 · bar headline severity is colour-only (Geoff). [MINOR]** Amber and red bars
  both say "2 ALERTS"; severity escalation rides on hue at the *bar* level (the pills
  have shape cues, the headline doesn't). **Fix:** change the word on red (e.g.
  "2 URGENT") so the bar's escalation survives colourblind too. Complements F3.

### Standout strengths (protect)

The "Focus · Esc" self-documenting exit · worst-wait promoted onto the bar · the
stacked non-colour severity cues · red-auto-expands/amber-calm hierarchy · the
reconcilable Medical/Admin split that *adds up to* the headline.

## 4. Prioritised path

Quick wins (S–M):
1. **R1/R3** unit-label counts + plain-language "Demand" tooltip + dot legend —
   unblocks Chloe, satisfies Raj/Janet/Geoff. *Route: design-crit (one surface).*
2. **R6** non-colour severity word on the red bar ("URGENT"). *design-crit.*
3. **R2** dark-mode contrast bump on the "Focus · Esc" pill. *ui-design token check.*
4. **R4** stop the waiting-chip name truncation. *design-crit.*

Half-day (M, feature):
5. **R5** persistent "keep roll-up expanded" pref + expose alert thresholds —
   builds on the config pass.

## 5. Judgement calls

- **Janet's "numbers don't reconcile"** — overruled as a verified screenshot
  artefact; F1 is fixed. (No reversal needed; if doubted, re-run the matched-state
  render.)
- **Persistent visible text label under the focus icon** — overruled (conflicts with
  the minimal-chrome doctrine; the hover tooltip + the on-state pill cover the need).
  *Reverse by:* adding a small text label beside the crosshair.

## 6. Reproduce

States rendered via `.claude/skills/design-crit/harness.mjs` into
`/tmp/the-practice/reappraisal/` (focus off/on light+dark; roll-up collapsed/
expanded; colourblind) and `/tmp/the-practice/verify/` (matched same-state
collapsed+expanded, for the F1 verification). Panel: personas 1, 4, 8, 9, 10.
