# The Practice — appraisal: six new Investigation Results rules

**Date:** 2026-06-13 · **Scope:** the result-triage feature on branch
`claude/results-rules-multi-agent-ge66ff` (lithium toxicity, digoxin toxicity,
critical low potassium, high adjusted calcium, low-eGFR amber band, blood-culture
text rule) · **Surfaces rendered:** Triage Lens *Result rules* settings list
(light/dark/colourblind) and the result-rule editor.

> **This is a synthetic panel.** Every reaction below is a role-played persona, a
> heuristic device for surfacing UX/feature gaps cheaply. It is **not** real user
> research and no quote is a real clinician's. Findings were verified against the
> source before being adopted.

## 1 · Verdict

For its expert users this is close to best-of-type already; for the technophobe
floor it is a settings screen they will never open, which is fine because they
meet it only as chips in their inbox. The single biggest thing **carrying** it is
*transparency with a safety model*: the rules are visible, individually
toggleable, escalate-only (never hide a lab flag), and ship with honest inline
help and a "review before you enable" workflow — a real advance on monitoring
rules that historically lived invisibly in a lab system or in one partner's head.
The single biggest thing **holding it back** is that the rule **label** is doing
three incompatible jobs at once: it is the settings-screen description, the
queue-chip text, AND the clinician-facing accuracy contract. Today it bloats the
chip (too long for a dense inbox row) and, on three of the six rules, misstates
the firing boundary (`>1.0` where the engine fires at `≥1.0`). Fix the label
layer and most of the panel's pain dissolves.

## 2 · The panel

| Handle | Role | Band | Score | One-line verdict |
|---|---|---|---|---|
| Dr Margaret Aldous | Senior GP partner | technophobe | 4/10 | "Too small to read; am I allowed to touch it?" |
| Sister Eileen Cobb | Practice nurse | reluctant | 5/10 | "Reassuring to see at last, but what's *not* on the list?" |
| Dr Tom Hollis | Salaried GP | pragmatist | 6/10 | "Right flags, but the labels are written for a settings page, not a 2cm chip." |
| Raj Patel | Clinical pharmacist | savvy+domain | 6/10 | "Thresholds mostly right; the `>`-vs-`≥` label bug makes me doubt all of them." |
| Dr Geoff Pellew | GP partner / tinkerer | power user | 6.5/10 | "Per-rule editing is solid; I hit a wall the moment I want to act *across* rules." |
| Dr Priya Nair | GP registrar | savvy | 7/10 | "The help panel genuinely self-teaches; tell me what an *uncovered* result does." |

## 3 · Findings by bucket

### Universal friction (most/all bands)

- **U1 · The rule label is overloaded — MAJOR.** It is simultaneously the settings
  description, the queue chip text (`{analyte} — {rule label}`), and the accuracy
  contract. Tom would see `Lithium — Lithium level high — toxicity risk (amber
  >1.0, red ≥1.5)` on one inbox row: long, self-repeating, and duplicating the
  threshold the row already renders. Margaret can't read it at density.
  *Fix:* short clinical label (`High lithium level`); let the row/tooltip carry the
  threshold. (Hits Tom, Margaret; pre-existing builtins share the pattern.)

### The tech-literacy gradient (works for savvy, loses the floor)

- **G1 · "What happens to an uncovered result?" is never stated — MAJOR.** Eileen
  (reluctant) and Priya (savvy) independently asked: does an un-chipped result mean
  "checked and fine" or "no rule looked at it"? For a nurse, a silent absence of a
  chip is more frightening than a noisy one. The help text explains what rules do
  when they fire, never what *non-coverage* means.
  *Fix (copy):* one line in the pane intro / help panel — "A result no rule covers
  shows the lab's own flag only; an absent chip is not a clinical all-clear."
- **G2 · "built-in" and "Unreviewed" are unexplained — MINOR.** Eileen read
  "built-in" as possibly "the lab already flags this, so it's redundant"; Priya and
  Margaret didn't know if "Unreviewed" means disabled or just attention-flagged.
  *Fix:* a legend or tooltips; a badge column distinguishing built-in vs authored.
- **G3 · List density/legibility — MINOR (partly wrong-persona).** Margaret scored
  the *settings list* 4/10 on legibility, but a technophobe partner would meet this
  feature as inbox chips, not here. The pane already carries an explanatory intro
  (she couldn't read it at scale). *Fix:* route to `design-crit` for the list's
  type scale and a more prominent plain-English header; don't over-index on the
  technophobe reading a power-user surface.

### Role-specific needs

- **R1 · Pharmacist (Raj) — label/engine boundary mismatch — MAJOR, verified.**
  The engine fires **inclusively** (`value >= amber`, `value <= amber`), and the
  editor's own help text says so. But three labels use a strict inequality:
  - `Lithium … (amber >1.0, …)` — fires at **≥1.0** (1.0 mmol/L is the top of the
    therapeutic range — exactly the patient you want noticed).
  - `Critical low potassium (amber <3.0, …)` — fires at **≤3.0**.
  - `Low eGFR … (amber <30 …)` — fires at **≤30**.
  Digoxin (`red ≥2.0`) and calcium (`≥2.6 / ≥3.0`) are already correct.
  *Fix:* change the three labels to `≥`/`≤`. (The 11 pre-existing builtins share the
  same sloppiness — e.g. Hb `<100` fires at `≤100` — worth harmonising.)
- **R2 · Pharmacist (Raj) — calcium raw-vs-adjusted — MAJOR (clinical).** Match is
  bare `calcium` (exclude `urine`/`ionised`). A lab reporting both a raw serum
  calcium and an adjusted calcium will fire on the raw value too, and the raw figure
  is not the clinically actioned one. (Raj's hypoalbuminaemia *direction* is off —
  low albumin lowers total calcium, so it wouldn't trip a *high* rule — but the
  double-fire and "raw isn't the actioned number" concern stands.) *Fix:* review
  whether to prefer `adjusted/corrected calcium` matching, via **The Keeper**.
- **R3 · Power user (Geoff) — control stops at the single rule — MINOR/MAJOR.**
  No clone, no bulk enable/disable, no per-tab export button, no "what fired
  lately" audit, no keyboard nav. (His "delete has no confirm" and "LLM import
  auto-enables" fears are **false** — both are already guarded; see §5.)
  *Fix:* roadmap — clone, bulk toggle, fire-log; surface the existing suite backup
  on this tab.

### Standout strengths (protect these)

- **S1 · Escalate-only safety model**, stated plainly in the help panel — Priya
  and Raj both called it out; it's the right clinical primitive.
- **S2 · Review-before-enable** — the `Enabled (uncheck until you have reviewed)`
  hint and disabled-on-import flow; Priya named it the single most useful piece of
  UX on screen.
- **S3 · The `urine` exclude on potassium** — Raj: "whoever thought of that has
  real clinical understanding"; many commercial tools get this wrong.
- **S4 · Per-rule toggles + editable match/exclude/threshold/label** — Tom and
  Geoff agree this is what makes them willing to trust the rest.
- **S5 · Blood-culture "calm-on-no-growth, else review" logic** — Raj: well-conceived.

## 4 · Prioritised path to best-of-type

**Quick wins (S, < 2h) — do first**
1. **R1:** correct the three labels to `≥`/`≤` to match the inclusive engine
   (unblocks Raj's trust; safety-adjacent). *Clinical-label wording fix.*
2. **G1:** add the one-line "an absent chip is not an all-clear" copy to the help
   panel / pane intro (unblocks Eileen, Priya).
3. **G2:** tooltips/legend for "built-in" and "Unreviewed" (Priya, Eileen).

**Medium (M, half-day)**
4. **U1:** shorten the rule labels and move the threshold off the queue chip into a
   tooltip/expander → hand to `design-crit` (chip rendering) + a label-copy pass
   (unblocks Tom, helps Margaret).
5. **R3 (partial):** surface the existing suite backup/export on the Result rules
   tab; add "clone rule" (Geoff).

**Larger / roadmap (L–XL, feature gaps)**
6. **R2 + coverage:** route to **The Keeper** — review calcium raw-vs-adjusted
   matching, and assess the clinically-requested gaps Eileen/Raj raised
   (hypocalcaemia, hypomagnesaemia, TSH high/low). These echo candidates the
   original two-agent design deliberately deferred pending per-lab verification.
7. **R3 (full):** bulk enable/disable, and a "what fired this week" audit log
   (Geoff's calibration feedback loop).

*Routing:* UX/chip work → `design-crit`; token/legibility → `ui-design`; any
threshold/match/coverage change → `the-keeper` (never freehand). Label-wording and
help-copy fixes (items 1-3) are low-risk and can be applied directly.

## 5 · Judgement calls (overruled / reversible)

- **Geoff: "Delete rule has no confirmation."** *Overruled* — `confirm()` guards
  both delete paths (`options.js:1152, 1222`). If you'd rather a modal than a
  native confirm, that's a `design-crit` task.
- **Geoff/Priya: "LLM-imported rules might auto-enable / overwrite."** *Overruled*
  — imports are forced `enabled:false` and the button reads "Add N rules,
  disabled" (`options.js:652, 659, 1446, 1460`).
- **Raj: "eGFR reported as `>90` could false-fire the `<30` rule."** *Overruled* —
  the engine returns none for non-finite values (`result-severity.js:209`), and
  `>60`/`>90` exceed 30 regardless.
- **Raj: "eGFR 8 gets the same amber as 28 — no red."** *Overruled* — the existing
  `base-low-egfr` (red `≤15`) is untouched and fires red independently; the new
  rule only adds the amber 30 band. Both coexist; the engine takes the max.
- **Tom: complaints about "INR red >5", a "PSA >5 / prostate" rule, "palmer
  HbA1c"; Eileen's PSA mention.** *Overruled — misreads.* There is no PSA rule
  (deferred in design); INR fires at `≥8`; "not on record" belongs to the HbA1c
  rules, not PSA. Artefacts of reading dense small text in a screenshot.
- **Margaret: list legibility 4/10.** *Adapted, not adopted as a blocker* — she is
  the wrong persona for a rule-authoring surface; kept as a `design-crit` polish
  item, not a feature blocker.

*To reverse any "adapt": the labels, help copy and legend are plain strings in
`defaults.json` / `options.html`; revert the commit to restore prior wording.*

## 6 · Reproduce

- **Surfaces shot** (via `.claude/skills/design-crit/harness.mjs`, options page
  `#resultRules`, fetching the live `defaults.json`): `rules-list-light`,
  `rules-list-dark`, `rules-list-colourblind`, `rule-editor-lithium` →
  `/tmp/the-practice/result-rules/`.
- **Cast:** personas 1 (Margaret, haiku), 3 (Eileen), 5 (Tom), 9 (Raj), 10
  (Geoff), 7 (Priya) — sonnet unless noted — from `PERSONAS.md`.
- **Note:** the live queue chip itself lives in the third-party Medicus Vue/AG-Grid
  DOM, which the harness does not render; chip-length findings (U1) were reasoned
  from the verified `{analyte} — {rule}` template plus the real labels.
