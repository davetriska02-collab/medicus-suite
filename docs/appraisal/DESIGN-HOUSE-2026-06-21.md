# Medicus Suite — design-house appraisal against a £200m bar — 2026-06-21

> Engagement framing: judge the suite as an outside world-class design house
> would judge a product underpinning a **£200m turnover** — i.e. not "is this
> good clinical software" (it is) but "does it look and feel like a valuable,
> owned commercial commodity". Evidence base: the live token canon
> (`ui-design/TOKENS.md`), the aesthetic doctrine (`DOCTRINE.md`), and ~32
> rendered screenshots of the real product at v3.126.x in light/dark/colourblind.

---

## 1 · Verdict

**Top-decile clinical craft sitting on a thin commercial identity.** The
foundations are genuinely excellent and already commercial-grade *as a system*:
a disciplined slate token canon with proper status triads, a real dual-voice
typographic doctrine, mapped (not inverted) dark mode, colourblind handled at the
triad level, and designed empty/cold states. Most clinical software never reaches
this. Against Linear / Stripe / Raycast — the doctrine's own stated bar — the
*thinking* is there.

It does **not** yet read as a £200m commodity, and the gap is specific: it is an
**identity and finish gap, not a foundations gap.** Three things hold it below the
bar. First, the **brand expression is forgettable** — a generic shield plus a
mono wordmark; nothing a buyer would recognise in a one-second glance or feel they
were paying a premium for. Second, the **chrome is undisciplined against its own
doctrine** — permanent alert wash-bands that never rest (violating "calm field,
sharp signal") and consume up to a third of a 400px canvas before any data.
Third, **craft consistency has drifted** — legacy per-surface components never
converged on the canonical ones, and load-bearing 9px grey type undercuts a
premium legibility bar. None is structural; all are closable in weeks, not
quarters, precisely because the system underneath is sound.

**One line for the board:** the product is engineered like a £200m asset and
*documented* like one; it is not yet *branded* or *finished* like one.

---

## 2 · Does the aesthetic match the valuation? Scorecard

| Dimension | Bar (£200m commodity) | Today | Gap |
|---|---|---|---|
| Token system / theming | Owned, consistent, dark-mapped | **A** | Already there |
| Dark mode & colourblind | Re-picked, survives without hue | **A−** | Strong |
| Empty / cold states | Designed, on-brand | **A−** | A real strength |
| Typographic *system* | Distinctive, dual-voice | **B+** | Right idea, mono overused |
| Information hierarchy | Clear focal point per view | **B−** | Wall-of-cards monotony |
| Chrome economy | Content-first, chrome earns its space | **C+** | Always-on strips eat budget |
| Component consistency | One canon, fully converged | **C+** | Legacy pills/chips/strips |
| Legibility floor | No load-bearing micro-grey type | **C+** | 9px grey carries meaning |
| **Brand identity** | Recognisable, owned, premium | **C−** | The headline gap |
| Motion / microinteraction | A considered signature moment | **C** | Functional, not memorable |

Composite: **B−**. Excellent system, under-delivered identity and finish.

---

## 3 · The gaps (severity-rated, grounded in the rendered product and its own doctrine)

### Tier 0 — Identity (the single biggest "doesn't look £200m" gap)

- **G1 · The brand is a placeholder.** *Severity: blocker for the valuation
  framing.* The wordmark is "MEDICUS SUITE" set in the UI mono with a generic
  shield glyph. There is no owned mark, no signature colour moment, no
  illustrative idiom, nothing memorable. A £200m product is identifiable from a
  cropped corner; this reads as a competent internal tool. This is the one gap
  that no amount of CSS polish closes — it needs actual identity design.

### Tier 1 — Chrome economy & hierarchy

- **G2 · The permanent alert strips break the suite's own first principle.**
  *Severity: major.* `DOCTRINE.md #2` is "calm surfaces, sharp signals — when
  red appears it must mean clinical risk". But `#wrStrip` washes `--red-dim` /
  `--amber-dim` whenever the waiting room crosses threshold (i.e. most of a busy
  morning), and it sits permanently above every tab alongside the
  `--accent-dim`-washed triage strip and the setup banner. Stacked, these consume
  ~30% of a 400px canvas before any data, and the "signal" band is on so
  constantly it stops reading as a signal. The strips are correctly *tokenised*;
  the fault is that an always-on wash cannot also be a sharp signal.
- **G3 · Wall-of-cards monotony — hierarchy under-delivered at page level.**
  *Severity: major.* `DOCTRINE.md #1` is "hierarchy is the design", yet Today and
  Condor render as vertical stacks of equal-weight white rounded cards with
  identical borders and shadow. There is no hero, no focal point; the eye has to
  read every card to find the one that matters. Stripe and Linear (the cited
  references) always establish one dominant element. The suite achieves *card*
  craft but not *composition*.

### Tier 2 — Craft consistency

- **G4 · Component convergence debt is visible.** *Severity: major.* `TOKENS.md`
  itself flags that legacy per-surface pills should "converge on [the canonical
  `.pill`] over time". They have not: `slot-pill` (5 rule blocks), `condor-pill`,
  the strip chips and the ampm/ppi chips each render slightly differently across
  modules. A premium product has one pill, one chip, everywhere; the drift is
  legible to a trained eye and accumulates as "not quite finished".
- **G5 · Legibility floor is too low for the price.** *Severity: major (also a
  usability finding — the technophobe/eyesight personas bounced off it
  repeatedly).* Load-bearing labels sit at 9px mono in `--text-4`/`--text-5`
  grey. The doctrine reserves those tiers for "supplementary only", but in
  practice the practice-code banner, freshness stamps, section labels and
  metadata all live there. £200m products do not make information-carrying text
  9px grey.
- **G6 · The machine voice is overused.** *Severity: minor-major.* The dual-voice
  idea (mono = machine, sans = human) is the brand's best typographic asset, but
  tiny uppercase letterspaced mono is applied to *nearly every* label, which
  gives whole screens a "terminal readout" texture. Used sparingly it signals
  precision; used everywhere it reads utilitarian, not luxe. The sans voice
  should carry more of the secondary labelling.

### Tier 3 — Finish

- **G7 · Chrome iconography is cramped and under-explained.** *Severity: minor
  (partly addressed in v3.126.1).* 13px Feather icons packed tight with a bare
  count badge; premium chrome gives its controls room and a label. Aria-labels
  landed last sprint; the spatial cramping remains.
- **G8 · No motion signature.** *Severity: minor.* Transitions are specced and
  correct, but there is no considered "moment" — a number settling, a state
  cross-fade, a gauge sweep — that telegraphs craft. Functional, not memorable.

---

## 4 · The plan to close the gap

Phased, highest-leverage first. Effort: S < 0.5d · M ~1d · L 2–3d · XL = a sprint.

### Phase 1 — Identity (XL · the valuation-defining work)
The only phase that needs a discipline the repo's skills don't cover (brand
design), and the one that moves "£200m" most.
1. Commission a real **mark + wordmark** (a clinical-instrument idiom — a
   precision reticle / sentinel motif, not another shield), a **signature accent
   moment** (one owned use of `--accent` that recurs as a brand beat), and an
   **icon/illustration idiom** for empty states.
2. Deliver a one-page **brand mini-guide** that extends `DOCTRINE.md` with the
   identity layer (mark usage, the signature moment, do/don't).
3. Apply to the nav wordmark, the favicon/action icon, the tour, and the
   visualiser cover. *Owns: identity designer (brief required) — flag: outside
   `ui-design`/`design-crit` scope; everything else below is in-house.*

### Phase 2 — Chrome economy (L · reclaims the canvas and restores the doctrine)
4. Collapse the always-on strips into **one adaptive demand bar** that **rests
   neutral** and only washes on threshold crossing — restoring "calm field,
   sharp signal" and handing ~25–30% of vertical budget back to content (G2).
5. Establish **one hero per tab**: promote the single most decision-relevant
   element (Today's "what needs me now"; Condor's gauge) in weight/scale, demote
   the rest to a supporting grid (G3). *Owns: `design-crit`, per surface.*

### Phase 3 — Consistency convergence (L · the "finished" pass)
6. Migrate `slot-pill` / `condor-pill` / strip + ampm/ppi chips onto the
   canonical `.pill` / status-chip recipes; delete the per-surface variants (G4).
7. Raise the **legibility floor**: retire 9px load-bearing greys to ≥10.5px and a
   darker tier, keep `--text-4/5` for true decoration only (G5).
8. **Rebalance the voices**: move secondary labels from mono-caps to sans where
   they are content, not metadata (G6). *Owns: `ui-design` (Atelier), suite-wide.*

### Phase 4 — Finish (M, ongoing)
9. Add **one motion signature** (gauge sweep + tabular number settle on data
   refresh, reduced-motion guarded) (G8).
10. Give chrome icons breathing room; run a per-surface `design-crit` "100%
    details" sweep in light + dark (G7). *Owns: `ui-design` + `design-crit`.*

**Sequencing rationale:** Phase 1 buys the perception of value; Phase 2 buys
back the canvas and re-earns the doctrine; Phase 3 removes the "not quite
finished" tells; Phase 4 adds the delight. Phases 2–4 are entirely deliverable
through the repo's existing `ui-design` and `design-crit` skills; only Phase 1
needs an outside brief.

---

## 5 · Honest counter-view

A £200m turnover does not, on its own, demand visual extravagance — for a
clinician's safety instrument, restraint is correct and the doctrine knows it.
The risk in "make it look expensive" is gilding a tool whose value is calm
legibility. So the plan deliberately spends the budget on **identity, chrome
economy and consistency** — things that read as *valuable and finished* — and
explicitly **not** on decoration, saturated colour, or motion that competes with
clinical signal. The brief throughout: it should look at home on an anaesthetic
machine *and* in a Stripe-tier portfolio. It is most of the way to the first and
a sprint away from the second.

---

*Companion clinical-currency review of the Sentinel rule sets (The Keeper) was
run in parallel; see `KEEPER-sentinel-2026-06-21.md`.*
