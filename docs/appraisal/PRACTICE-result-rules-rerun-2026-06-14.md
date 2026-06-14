# The Practice — re-run appraisal: Investigation Results rules

**Date:** 2026-06-14 (re-run of `PRACTICE-result-rules-2026-06-13.md`) · **Scope:**
the result-triage feature as shipped on `main` after v3.76.0→v3.77.2 (21 rules,
label/copy polish, design-crit badges, Keeper rules enabled). Same six-persona
panel, fresh eyes, screenshots-only.

> **Synthetic panel.** Reactions are role-played heuristics, not real user
> research. Findings verified against source before adoption.

## Verdict (vs first run)

Materially better for every band except the power user, who is now held back by
the *absence* of fleet-management tooling that 21 rules make more pressing. The
v3.76.1 label work and the "absent chip is not an all-clear" copy are the single
biggest wins — they resolved the first run's top universal and gradient findings
outright (Tom now praises label length; Eileen and Priya both cite the bold header
as the thing that "settled" them). The colour-plus-text severity badges from the
design-crit pass survive the colourblind view (Eileen confirmed), so the new
visual hierarchy doesn't smuggle in a colour-only signal. What remains is a
shorter, higher-quality list: a nurse's *scope* anxiety, a daily GP's *over-fire*
worry on chronic-disease rules (TSH), and a power user's *export/audit* gap.

## Scores: run 1 → run 2

| Persona | Band | Run 1 | Run 2 | Move |
|---|---|---|---|---|
| Margaret (partner) | technophobe | 4 | 6 | ▲▲ |
| Eileen (nurse) | reluctant | 5 | 7 | ▲▲ |
| Tom (salaried GP) | pragmatist | 6 | 7 | ▲ |
| Raj (pharmacist) | savvy+domain | 6 | 7 | ▲ |
| Geoff (tinkerer) | power user | 6.5 | 6 | ▼ |
| Priya (registrar) | savvy | 7 | 8 | ▲ |

## Resolved since the first run

- **Label overload + `>`/`≥` boundary mismatch (was U1 + R1, MAJOR)** — gone.
  Labels are short clinical names; Tom now reads the chip "at a glance" and the
  thresholds show once, inclusively, in the row summary. Verified: no shipped
  label embeds a `<`/`>` threshold.
- **"Uncovered result" framing (was G1, MAJOR)** — resolved. The bold list-header
  line is the most-cited improvement across the reluctant/savvy bands.
- **"built-in"/"Unreviewed" opacity + list density (was G2 + Margaret, MAJOR/MINOR)**
  — much improved by the severity badges, recoloured (blue) Unreviewed state,
  mono machine-voice columns and tooltips. Margaret 4→6.
- **Colourblind safety** — the badges carry the words RED/AMBER/INFO, so severity
  survives deuteranopia (a verified strength, not just colour).

## Findings this run

### Role-specific (rank first)

- **N1 · Scope ambiguity — MAJOR (nurse).** Eileen's trust now turns on a new
  question: "a missing rule looks identical to a deliberate exclusion." She wants
  a one-line note of what is *intentionally out of scope* (she named B12/folate,
  ferritin; she wrongly thought HbA1c was missing — it is covered). *Fix:* a scope
  line on the list, e.g. "covers acute biochemistry + therapeutic drug levels;
  haematinics and microbiology interpretation are out of scope." This is the
  evolved form of G1 — once "absent chip" is explained, the next question is
  "absent *from the rule set* — on purpose?".
- **R3 · Fleet management still missing — MAJOR (power user), unchanged.** Geoff
  (6.5→6): no clone, no bulk enable/disable, no **fire-log/audit** ("I'm tuning
  thresholds blind"), no keyboard nav, no list sort/filter. Export exists at the
  *suite-backup* level but not as a per-ruleset JSON he can version-control. The
  audit-of-what-fired is the one he most wants and the one most useful for
  calibrating the new thresholds.
- **T1 · TSH over-fire on treated patients — MAJOR (daily GP), known residual.**
  Tom would disable the high-TSH rule first: "sixty patients on levothyroxine"
  whose TSH drifts mildly high between reviews. `suppressIfProblem` mitigates this
  for *coded* thyroid patients (and works in the live queue — the content script
  fetches the problem list when a suppressing rule's analyte is present), but
  levothyroxine-without-a-coded-diagnosis and pregnancy still fire. *Options:* keep
  the conservative ≥10/≥20 thresholds (already above the lab upper limit), and/or
  add a medication-based suppression (levothyroxine on the repeat list), and/or
  revisit whether high-TSH should ship enabled at all.

### Universal / gradient (minor)

- **U-a · Paired high/low rules look alike — MINOR.** Calcium high vs low, TSH high
  vs suppressed, potassium high vs low: Eileen and Tom each had to re-read to be
  sure they weren't seeing the same row twice. *Fix:* a directional cue (↑/↓ glyph
  or grouping) so the pair is distinguishable at a glance.
- **U-b · Editor "Enabled" is at the bottom of a long form — MINOR.** Geoff and
  Priya both expected the live/not-live toggle next to the label at the top.
- **U-c · "Unit (display only)" needs more weight — MINOR (Priya).** It's a
  silent-misfire risk in the same grey as ordinary hints; promote it (amber ink).
- **U-d · The LLM-import affordance is unexplained — MINOR (Priya, Geoff).** "Which
  LLM? does it send patient data? does it overwrite my rules?" One sentence of
  provenance + reword "Import rule(s)" (read as "rulesy") to "Import rules".
- **U-e · "built-in" delete/validation — MINOR (Priya).** Clarify (tooltip/header)
  whether built-in thresholds are UK-standard and what Delete does to a built-in.
- **M1 · Margaret still wants a "you're allowed to be here" line — MINOR.** A
  reassurance that the screen is informational and safe to close, plus larger
  small-print (she still can't read the threshold summaries).

### Standout strengths (protect)

- The permanent editor help panel (inclusive ≥/≤, escalate-only, exclude examples,
  "no rule matched" note) — Priya: "self-teaching… I could onboard myself."
- The **Test match** advisory field — teaches the right mental model (paste the
  lab's own result name).
- Both-directions clinical completeness (high+low K/Ca/TSH) — Eileen: "someone who
  actually does this job helped write the rules."
- The calcium high-vs-low match split — Raj: "genuinely clever and clinically
  correct."

## Judgement calls (overruled — verified against source)

- **"Two identical TSH rules / a duplicate" (Tom)** — *overruled.* Distinct rules:
  `base-high-tsh` (hypothyroidism) and `base-low-tsh` (thyrotoxicosis). Feeds the
  real but minor U-a scannability point.
- **"Import rulesy" typo (Geoff, Priya)** — *overruled.* The text is
  `Import rule(s)`; the `(s)` misreads. Still worth rewording (U-d).
- **Magnesium exclude misses the hyphenated "24-hour" form (Raj)** — *overruled.*
  The exclude is `["urine","urinary","24 hour","24-hour"]` — both forms present.
- **Low-calcium might exclude "albumin" and drop adjusted calcium (Raj)** —
  *overruled.* No "albumin" in the exclude; the match includes
  "albumin-adjusted calcium".
- **"No export, my config is trapped" (Geoff)** — *partially overruled.* The suite
  Backup/restore captures `triagelens.config` (incl. `resultRules`); the genuine
  gap is a per-ruleset JSON export for version control.
- **"Let me set a custom threshold" (Tom)** — *already possible.* Per-rule amber/red
  fields are editable in the editor; the residual is the default behaviour, not a
  missing control.
- **Digoxin unit mismatch risk (Raj)** — *context, not a defect.* The unit field is
  display-only and the editor says so; thresholds are in micrograms/L per UK labs.
  A genuine caveat for the local-LIMS check, not a rule error.

## Prioritised path

1. **N1 scope note** (S, copy) — biggest trust win for the nurse band.
2. **U-a directional cue on paired rules** + **U-b move Enabled to the top** +
   **U-c promote the unit warning** + **U-d/U-e LLM + built-in copy** (S–M) →
   route to `design-crit`/copy pass.
3. **T1 TSH over-fire** (M, clinical) — medication-based suppression and/or a
   default-state decision → route to `the-keeper`.
4. **R3 fleet tooling** (L–XL, roadmap) — fire-log/audit first (calibration), then
   clone + bulk toggle + per-ruleset export.

## Reproduce

Surfaces: `/content-scripts/triage-lens/options.html#resultRules` list
(light/dark/colourblind) + editor, via `design-crit/harness.mjs` →
`/tmp/the-practice/rerun/`. Cast: personas 1 (haiku), 3, 5, 9, 10, 7 (sonnet).
