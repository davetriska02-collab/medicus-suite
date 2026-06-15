# The Practice — pass 3: the gap to a 9

**Date:** 2026-06-15 · **Scope:** Focus/Zen mode + alert roll-up at **v3.97.0**,
after R1/R2/R5/R6. Brief: re-score, and ask each persona the concrete thing that
would take it to **9/10**.

> **Synthetic panel — not user research.** A heuristic for finding friction.

## 1. Verdict

The recent fixes moved every band up and the technophobe floor is no longer
failing — Margaret and Chloe both jumped ~2 points and now *use* the surface
rather than fearing it. The remaining gap to "best of its type" is one
convergent theme: **the numbers don't yet explain their own provenance.** Three
of five personas independently want a figure to carry its context — *as at when*
(Janet's timestamp), *past which threshold* (Geoff/Raj), *how many and how acute*
(Raj). Close that and add a legibility bump for tired eyes, and this is a 9 across
the board. None of the gap-to-9 asks are bugs; they are ceiling features.

## 2. The panel — scores and the 9-ask

| Persona | Band | Pass 2 | Pass 3 | The one concrete thing for a 9 |
|---|---|---|---|---|
| Margaret | technophobe | 5 | **7** | Alert-bar text ~10–12% larger / crisper sans — "Waiting 1 · 12m" strains her eyes |
| Chloe | low-clinical | 6 | **7.5** | Act from the bar (open the patient/queue) + name the *kind* of urgent |
| Janet | manager | (resolved) | **6** | A visible **"as at HH:MM" timestamp** on the roll-up + full non-truncated waiting names |
| Raj | pharmacist | 7.5 | **7** | A count + acuity on every pill, never an arrow alone; show what made it red |
| Geoff | power user | 8 | **7.5** | **User-editable, persisted thresholds** (in the palette) + visible/rebindable shortcuts |

*(Raj and Geoff nominally dipped: the "what would make it a 9" lens makes the
domain/power users scrutinise harder and surface ceiling asks. Their pass-2
blockers stay resolved.)*

## 3. Findings

### The convergent theme — numbers must explain their provenance [MAJOR, 3 bands]

- **Janet — timestamp.** "115 *as of when*? A live number with no 'as at 11:02'
  is one I won't put in an email." She can reconcile the arithmetic (115 = 70+45,
  confirmed) but won't *quote* an unanchored figure. **Fix:** an "as at HH:MM"
  stamp on the roll-up (or in the hover); a "view in source" link is the cherry.
- **Geoff / Raj — threshold on the chip.** Both want the number to show the line
  it crossed: "Demand 115 (red ≥100)". Geoff: "right now I'm trusting a shipped
  default someone picked." **Fix:** render the active threshold inline; longer
  term, make it user-editable (see below).
- **Raj — count + acuity, denominator.** "115 of what, over what window?" Wants
  each pill's dot to carry the headline's filled/hollow severity so he can see
  *which* stream is red without expanding.

### Tech-literacy floor

- **Margaret — alert-bar legibility [MAJOR, eyesight].** The fixes landed ("URGENT
  is professional… the hover explanations solved it") but the small mono counts
  ("Waiting 1 · 12m") strain her. **Fix:** bump the bar's count/meta size ~10–12%.
  *Route: ui-design (respect the type scale — this is the one place it's too tight
  for the eyesight floor).*

### Role-specific

- **Chloe — act from the bar [feature, constrained].** Wants a "call in" button by
  the patient name. **Important boundary:** the suite is read-only and never writes
  to the record (intended-purpose). So "call in / mark ready" is **out of scope**;
  what *is* in scope is a navigation action — click a waiting patient to open their
  record/the queue. **Adapt to navigation, not write-back.** She also wants the red
  state to name its *kind* ("2 urgent: waiting + demand") rather than bare "URGENT".
- **Geoff — editable thresholds + shortcuts [feature].** Persisted per-user amber/
  red thresholds exposed in the palette (this single lever also satisfies Raj's
  acuity and Janet's defensibility), plus a palette "Keyboard shortcuts" list and
  rebindable Ctrl+. / Ctrl+K.

### Verified / overruled

- **Raj "the Monitoring pill needs a count, never an arrow."** *Verified against
  source:* "Monitoring →" is the waiting strip's **Go-to-Monitoring navigation
  button**, not an alert stream — the roll-up has only Waiting / Triage / Demand.
  **Literal ask overruled** (there is no Monitoring count to show). The *underlying*
  confusion is real and adopted: the nav button abuts truncated name chips and reads
  like a hidden-count pill — tidy that (cosmetic).
- **Raj "can I HIDE an urgent state?"** *Verified:* "HIDE" collapses the *detail*;
  the red "URGENT" bar and the underlying strips persist — the alert is not
  suppressed. **Adopt a wording tweak only:** label it "Hide detail".

### Standout strengths (protect)

"URGENT as a word, not just colour" (Margaret "professional", Chloe "chef's
kiss", Raj "not betting a patient on telling red from amber") · the plain-English
hover explanations (turned Chloe's blocker into "I don't need to interrupt the
GPs") · worst-wait promoted to the headline · the persistent pin-open toggle in
the palette (Geoff "the right fix, in the right place") · colourblind render
essentially equivalent to standard.

## 4. Prioritised path to 9

Quick wins (S, < 2h):
1. **"as at HH:MM" stamp** on the roll-up — unblocks Janet. *design-crit.*
2. **Bar text-size bump** for the eyesight floor — Margaret. *ui-design.*
3. **Tidy the nav-button / truncated-name** collision — Raj/Janet. *design-crit.*
4. **"Hide detail"** wording + name the urgent kind — Raj/Chloe. *design-crit.*

Medium (M):
5. **Threshold-on-chip** context ("Demand 115 · red ≥100") — Geoff/Raj/Janet.

Feature (L, roadmap):
6. **User-editable persisted thresholds** in the palette — Geoff (serves 3 bands).
7. **Open-from-the-bar navigation** to a waiting patient's record — Chloe
   (navigation only; never write-back, per intended-purpose).
8. **Keyboard-shortcuts list + rebinding** — Geoff.

## 5. Judgement calls

- **Chloe's "call in" button** — adapted to *navigation only*, not a write action;
  the suite deliberately never writes to the record. *Reverse only if* the
  intended-purpose boundary changes (it should not).
- **Raj's Monitoring-count ask** — overruled as a misread nav button. *Reverse by:*
  if a genuine Monitoring alert stream is ever added to the roll-up, it must carry a
  count like the others.

## 6. Reproduce

States in `/tmp/the-practice/pass3/` (focus off/on; roll-up amber-collapsed,
red-expanded "URGENT", colourblind, light). Panel: personas 1, 4, 8, 9, 10. Hover
tooltips supplied as text (invisible in screenshots).
