# The Practice — appraisal: live-first Visualiser tab (PDF nested for detail)

**Date:** 2026-06-16 · **Scope:** proposed redesign of the Patient Record Visualiser ·
**Skill:** the-practice · **Status:** report-only

> **Synthetic-panel caveat (read every time):** the reactions below are from
> *synthetic personas*, a heuristic device for surfacing UX/feature gaps before
> real clinicians hit them. They are **not** user research and no quote is a real
> clinician's. They react to a *concept* (the tab is not built) grounded in real
> screenshots of today's product.

## 1. Verdict

Strong yes on the principle. The live-first tab attacks exactly the problem that
prompted this — the Visualiser is powerful but under-used — and the reason is
visible in the first screenshot: today the surface is a **"Drop a Medicus EPR
export PDF here" wall** that does nothing until the user finds, exports and loads
a file. The two personas who never use it today (the technophobe partner, the
time-pressed salaried GP) both flip to "I'd use this daily" once it shows a live
summary on the patient already on screen — a 1→8 and 2→8 swing. The PDF-nested-
for-detail model is endorsed as **sensible tiering, not hiding** (only the power
user reads it as "buried", and his objection is fixable). **The make-or-break is
not the idea but the safety framing:** removing the PDF friction also removes the
signal that taught users "this is a snapshot, not the whole record". The single
biggest thing carrying the proposal is *instant, zero-step, reads-the-open-
patient*. The single biggest thing that could sink it is a quietly-incomplete
live view — above all **no allergies / no immunisations** — presented as if
complete. Ship the gap-markers or don't ship.

## 2. The panel

| Persona | Role / band | Score (concept) | Headline |
|---|---|---|---|
| Dr Margaret Aldous | Senior partner · technophobe | PDF **1/10** → live **8/10** | "Instant tab I'd actually click; PDF export I never have and never will." |
| Dr Tom Hollis | Salaried GP · pragmatist | PDF **2/10** → live **8/10** | "Earns a click mid-clinic where the PDF never did — if it loads in <2s." |
| Sister Eileen Cobb | Nurse · reluctant | ease **7/10** · trust **4/10** | "Use it to *open* a recall, never to *close* one. No-allergies must be a red banner, not a footnote." |
| Dr Priya Nair | Registrar · savvy | **6/10** | "The friction was educational. Remove it and newcomers think the live view is the whole record." |
| Raj Patel | Clinical pharmacist · domain | clinical-trust **6/10** | "Live coded meds-with-doses are a real upgrade for PINCER/STOPP. But a clean score with allergies excluded is dangerous." |
| Dr Geoff Pellew | Partner · power user | **4/10** | "Don't bury my deep analytics in a Post-it-width panel. Guarantee full-tab + relabel the button." |

Spread is the story: technophobe + pragmatist *delighted*; domain experts +
power user *conditionally positive, guardrail-gated*. Nobody rejected live-first;
the low scores are about safety framing and the narrow-panel execution, not the
concept.

## 3. Findings by bucket

### Universal friction (ranks first)
- **The PDF export wall is the thing suppressing adoption.** Confirmed by the
  real landing screenshot and by the two non-users flipping to daily-use.
  *Severity: this IS the win the proposal delivers.*
- **Incompleteness must be surfaced in-place, not as a footnote.** Eileen, Priya
  and Raj converged independently: a persistent, un-dismissable **gap-marker
  where the missing data would appear** ("Allergies · Immunisations — not in live
  view; open full record"), not the word "memory-aid" at the bottom.
  **Severity: BLOCKER (clinical).** Without it, do not ship.

### The tech-literacy gradient
- **Removing friction removes the educational signal.** Priya's insight: today
  the mandatory PDF *teaches* you it's a snapshot. Live-first looks complete to a
  newcomer. The fix is provenance + gap-markers, weighted high because the people
  it traps are exactly the less-experienced (locum, trainee, newly-qualified).
  **Severity: MAJOR.**
- **"Memory-aid" reads as apologetic / informal** (Priya, Raj) and trains
  reflexive distrust of the whole panel (Tom). Replace with precise per-section
  provenance. **Severity: MINOR.**

### Role-specific needs
- **Pharmacist (Raj):** per-score inline caveats on PINCER/STOPP/eFI — "score may
  undercount: allergies excluded, problems from [date] only" — *next to the
  number*, not in a tooltip. A clean PINCER 0 must not read as a clean bill of
  health. **Severity: MAJOR.** (He also confirms the upside: live coded
  meds-with-doses make dose-dependent STOPP criteria fire at all — they *can't*
  on the PDF's dose-less guesswork.)
- **Nurse (Eileen):** trusts live to *open* a recall, not *close* one; wants the
  data window stated plainly. **Severity: MAJOR** (addressed by the same
  provenance/gap-marker work).
- **Power user (Geoff):** the deep PDF analytics (D3 timeline, UPC/Bice) cannot
  live in a ~400px column. Guarantee they still open **full-tab** (they already
  do — `panel.js:334`), **relabel** the nested entry from "Import a PDF" to
  "Open full visualiser (deep history)", add a keyboard shortcut.
  **Severity: MAJOR (power-user); low effort.**
- **Pragmatist (Tom):** **<2s render or a skeleton/partial state, never a blank
  load** — a blank panel mid-appointment is behaviourally identical to the PDF
  wall and kills the habit within a week. **Severity: MAJOR.**

### Standout strengths (protect these)
- **Instant, zero-step, reads the open patient** — no name/NHS typing. Cited by
  Margaret, Tom, Priya as the thing that makes it usable at all.
- **Tiering principle (quick live + deep PDF on demand)** — endorsed as
  architecturally correct by Tom, Raj *and* Geoff even while quibbling execution.
- **Live coded meds + doses materially improve the safety scores** vs PDF
  text-scraping — the domain expert's verdict, i.e. this is a *clinical* upgrade,
  not just UX.

## 4. Verify-before-adopt corrections (panel misreads)

- **"Bloods capped at 13 months" — FALSE.** The investigation dashboard returns
  full per-analyte history (`engine/normalisers.js:181-182`). The 400-day cap
  (`content-scripts/sentinel.js:391-392`) is **only** journal-coded observations
  (smoking status, review codes). Eileen's/Geoff's truncated-bloods fear is
  unfounded — *but* the fix is to label the window per section so it never
  arises. The live snapshot is **richer** than two personas assumed.
- **Full-tab home already exists.** The `visualiser` nav button already opens the
  full tab (`panel.js:333-334`); Geoff's "guarantee full-tab" ask is already true
  in code — it just needs to stay, and be labelled as such.

## 5. Prioritised path to best-of-type

**Quick wins (S, <2h)**
- Relabel nested entry "Import a PDF" → **"Open full visualiser (deep history)"**; unblocks Geoff.
- Replace "memory-aid" with per-section source labels; unblocks Priya/Raj mistrust.
- Keep the existing full-tab launch for deep analytics (already in code); unblocks Geoff.

**Medium (half-day each)**
- **Persistent in-place gap-markers** for Allergies + Immunisations ("not in live view — open full record"); unblocks the BLOCKER (Eileen, Priya, Raj).
- **Per-section data-window stamp** ("Bloods: full history · Coded reviews: last 400 days · Allergies: unavailable live · No consultation history"); unblocks Eileen/Geoff.
- **Per-score inline caveats** on PINCER/STOPP/eFI; unblocks Raj.
- **Skeleton / partial-load** state with a <2s budget; unblocks Tom.

**Large (1–2 days)**
- Jargon tooltips with thresholds (eFI/PINCER/continuity index); unblocks Priya.
- Pop-out / full-tab for dense charts + keyboard shortcut; unblocks Geoff.

**Hand-offs:** the gap-marker/provenance *visual design* → `design-crit` on the
Visualiser surface once a live render exists; token polish → `ui-design`. The
*clinical wording* of the caveats (which scores need which warning) is a
clinical-safety call for Dave, not freehand here.

## 6. Judgement calls (reversible)

- **Not recommending the PDF path be removed** — it is tiered, not deleted (Dave
  relies on it; Geoff loves it). *Reverse if tiering buries it:* restore a
  top-level "Visualiser (full)" nav button alongside the live tab.

## 7. Reproduce

- Surfaces shot (real): `visualiser-core.html` landing (PDF wall) light+dark;
  `side-panel/panel.html` nav (tab idiom). Rig: `.claude/skills/design-crit/harness.mjs`.
- Panel cast: personas 1, 3, 5, 7, 9, 10 from `.claude/skills/the-practice/PERSONAS.md`
  (technophobe→savvy spread; reception/secretary excluded — they don't open the Visualiser).
