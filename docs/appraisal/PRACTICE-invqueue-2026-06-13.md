# The Practice — appraisal: Investigation Results queue feature (v3.62.0–v3.63.0)

Date: 2026-06-13. Scope: the injected queue triage chips + the Triage Lens
result-rules customisation UI. Lens: features / UX / ease-of-use, weighted to
ease-of-use.

**These personas are synthetic.** They are a structured heuristic for surfacing
UX and safety friction cheaply. Nothing here is real user testing and no line
may be cited as "a clinician said X".

## The panel

| Handle | Role | Band | Score /10 |
|---|---|---|---|
| Dr Margaret Aldous | senior GP partner | technophobe | 5 |
| Dr Tom Hollis | salaried GP | pragmatist | 7 |
| Sister Eileen Cobb | practice nurse | reluctant | 5 |
| Raj Patel | clinical pharmacist | savvy+domain | 7 (4 for a less-numerate GP) |
| Dr Geoff Pellew | GP partner / tinkerer | savvy power user | 8 |

## Verdict

The bones are right and the safety architecture is genuinely good (escalate-only,
ship-disabled, lab-named urgent chips, unmatched safety-net). It is not yet
best-of-type for *all* users because of one universal, safety-relevant gap: on
the live queue, **a blank row does not visibly mean anything**, and four of five
personas independently feared treating "no chip" as "normal, safe to skip". The
single biggest thing carrying it: the escalate-only design and the at-a-glance
"Urgent: K+" naming. The single biggest thing holding it back: the absence-≠-safe
message lives in the safety docs, not on the screen where the fear happens.

## Findings by bucket

### Universal friction (ranked first)
- **U1 [MAJOR, all bands] "No chip ≠ normal" is invisible on the queue.** Margaret,
  Tom, Eileen and Raj each feared a blank row reads as a clean bill of health.
  A blank row can be: assessed-and-nothing-triggered, not-yet-swept, or a silent
  fetch failure — indistinguishable. Fix: a concise persistent on-queue note that
  chips are additive and absence asserts nothing. (Do NOT add a per-row
  "checked/clean" tick — that is the false-reassurance green chip we deliberately
  excluded; it would be wrong on fetch-fail/pending rows.)
- **U2 [MAJOR, Tom; mixed] filled-red vs outline-red too subtle at speed.** Tom
  could conflate "Urgent" (act now) with "Under-prioritised" (process). Eileen
  found the fill/outline split worked. Harden the clinical chip without reducing
  salience: a small leading glyph on the filled Urgent/abnormal chips.
- **U3 [MAJOR, Tom/Raj] truncated analyte name ("Urgent: Estimated glome…").**
  Loses clinical meaning. A hover tooltip already exists (design-crit) but is
  invisible in static review; widen slightly and prefer short forms; consider
  showing the value.

### The tech-literacy gradient
- Margaret (technophobe) reached 5/10 almost entirely because of U1 — she will
  not trust a tool that leaves her unsure what a blank row means. Carrying the
  Luddite here IS fixing U1.

### Role-specific
- **R1 [MAJOR, Raj] comparator label wrong.** "above — fires when value is above"
  implies strict `>`, but the engine is `>=`. A K of exactly 6.0 is the dangerous
  boundary. Relabel to "at or above (>=)" / "at or below (<=)".
- **R2 [MAJOR, Raj] unit is display-only with no warning.** Safe for mmol/L
  analytes; a latent silent misfire for analytes with differing unit conventions
  (TSH, glucose mg/dL vs mmol/L). Add a warning by the unit field. (Do not attempt
  conversion.)
- **R3 [MAJOR, Raj, his top ask] no way to test analyte match strings.** Substring
  matching can silently miss ("Plasma potassium" vs match "Serum Potassium") or
  over-match ("urine potassium"). Add a "test match" box: paste a lab result name,
  see live whether the current match strings would catch it.
- **R4 [MAJOR, Raj/Geoff] LLM import has no human-readable preview before commit.**
  A hallucinated `60.0` for `6.0` is caught only by eye on a JSON blob. Add a
  preview/confirm step listing the rules about to be imported (all still disabled).
- **R5 [MINOR-MAJOR, Geoff, his top ask] no targeted export/import of the rule set**
  for git/federation sharing. (The whole-CONFIG backup already round-trips them;
  a targeted export is the nice-to-have.)
- **R6 [MINOR, Geoff] Baseline-chips list: result chips read as the existing
  priority chip; section separators too subtle.** Clarify labels/grouping.

### Standout strengths (protect these)
- Escalate-only architecture (Raj "cannot praise enough"): a misconfigured rule
  can never suppress a lab-flagged abnormal.
- Ship-disabled / review-before-enable gate on manual and LLM rules.
- Lab-named urgent chips ("Urgent: K+") — what is urgent, not just that something is.
- "Unmatched patient" safety net; dark-mode legibility; the system-ID column +
  reset-to-default; the inline "how it works" help box; multiple match strings per rule.

## Prioritised path

Quick wins (S < 2h): R1 comparator labels; R2 unit warning; U1 on-queue legend;
R6 baseline-chips clarity.
Half-day (M): R3 test-match box; R4 LLM import preview; U2 clinical-chip glyph.
Later (roadmap): U3 analyte short-forms + value-on-chip; R5 targeted rules export.

## Judgement calls (flagged for reversal)
- **Kept kind-based colours, not a custom hex picker** (Geoff wanted a custom
  slot). Per the explicit decision to preserve red/amber salience. Reverse:
  add a custom-colour severity slot to the chip editor.
- **No per-row "assessed/clean" tick** (Eileen/Tom wanted one). It is the
  false-reassurance green chip we excluded and would be wrong on pending/failed
  rows. The U1 legend addresses the fear safely instead. Reverse: add a neutral
  "assessed" marker only if we can reliably distinguish assessed from pending/failed.

## Reproduce
Surfaces shot: queue chips (faithful AG-grid reproduction, real .ch-chip CSS) +
Triage Lens options panes (chrome-shim over http). Panel: personas 1,5,3,9,10
from PERSONAS.md.
