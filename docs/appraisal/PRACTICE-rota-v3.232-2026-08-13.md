# The Practice — appraisal: Rota Manager v3.232.0 features

Run date: 2026-08-13. Scope: the five feature packages merged in v3.232.0 (PR #279):
passcode access gate, first-run setup assistant, grid UX pack, Solver v2 surfacing,
side-panel live drift card. Lens: ease of use, weighted to the technophobe floor, per the
product owner's stated goals ("a complete doddle to first-time set up", "easy and
intuitive" drag-and-drop).

**This panel is synthetic.** Every reaction below is a persona simulation reacting to real
screenshots of the real product — a structured heuristic for surfacing friction cheaply,
not user research, and no quote here is a real clinician's. Real-world validation (one
practice manager, one technophobe partner, one locum) remains the gold standard before
calling any of this settled.

Surfaces rendered (design-crit harness, seeded chrome shim + intercepted Medicus API,
21 states): setup wizard steps 1–4, dashboard checklist, rota grid (light/dark,
selection+bulk bar, cell menu, shortcuts strip, rooms mode), solve panel with results,
unlock screen (strict), staff-view read-only grid, staff-view My week, settings access
card, panel drift card (light/dark/colourblind/strict-locked). Fixtures: 10-staff demo
practice, 4 generated weeks; wizard shots used the 4-clinician sample payload.

## Verdict

Not best-of-type for *all* its users yet, but closer than any GP-native competitor the
June/August Gauntlet surveyed. The single biggest thing carrying it: **honest,
teach-as-you-go copy at the moments of fear** — "nothing is saved until you say so", the
review-before-import table with its evidence column, the passcode card that refuses to
oversell itself, the drift card that names the consequence ("lost capacity") and whose
numbers tie out. The single biggest thing holding it back: **the solver's results screen
argues with itself** — a 38-change proposal rendered directly above a checks panel still
evaluating the un-applied rota, with an unexplained score in raw decimals — which cost it
the trust of both personas senior enough to press Apply. Second: the wizard's
one-default-fits-all import (everyone a GP, everyone duty-ticked) is a quiet trap that a
skimming manager will fall into exactly because the rest of the wizard is so easy.

## The panel (synthetic)

| Persona | Role | Band | Score /10 |
|---|---|---|---|
| Dr Margaret Aldous | Senior partner | technophobe | 3 |
| Maureen Castle | Medical secretary | technophobe | 7 |
| Sister-band not cast (leave/monitoring out of scope) | — | — | — |
| Dr Sam Okonkwo | Locum GP | pragmatist | 5 |
| Janet Briggs | Practice manager | reluctant-but-capable | 6 |
| Dr Geoff Pellew | Partner, power user | savvy | 6 |
| Dr Priya Nair | Registrar | savvy | 7 |

Spread reading: the floor (Margaret, 3) fails on vocabulary and drag confidence, not on
layout; the ceiling (Geoff/Priya, 6–7) is capped by solver trust and two consistency nits,
not by capability. Maureen's 7 shows the read-only staff view is already genuinely right
for the look-don't-touch user.

## Findings

### Universal friction

- **U1 · major · Solver results contradict the checks panel.** The proposal table sits
  above a checks list still computed from the committed rota, so ten "no duty doctor"
  HIGHs stay red under a proposal that fixes them. Both senior personas independently
  refused to trust Apply. Also: "Score 50480 → 13181.4375" (raw decimals, no units), and
  the per-dimension line shows remaining-only, so the dominant remaining term (enhanced
  access, which the solver honestly could not fix) reads as a failure of the whole run.
  Fix: recompute (or clearly label) checks against the proposed state; highlight the
  proposed diff in the grid itself; round scores; show per-dimension before→after.
  Verified real: checks panel renders from `state` while the proposal is un-applied.
- **U2 · major (technophobe bands) · Session codes have no visible legend.** SUR/TRI/ADM/
  TUT/CPD decode only on hover (`typeChip` title attrs — verified present), which
  technophobes don't do and print doesn't have. Margaret's biggest ask. Fix: a visible
  one-line legend (the shortcuts strip is the natural host) + include it in print.
- **U3 · minor · Numbers without provenance.** The capacity tile shows the benchmark
  without its derivation; the manager persona only trusted it after reverse-engineering
  72/1,000 × list size from Settings. Fix: derivation in the tile's title/sub-line.

### The tech-literacy gradient

- **G1 · major · Wizard review defaults are a silent trap.** Every imported clinician
  defaults to role "GP" with Duty doctor pre-ticked (`setup.js` candidate defaults —
  verified). In the shots, "Hannah Reid ANP" sat as a duty-ticked GP; two personas caught
  it, a skimming manager wouldn't. No explanation of what the duty tick commits to; no
  registrar guard (domain rule: registrars default duty-ineligible). Fix: keyword-guess
  role from the imported name (ANP/nurse/HCA/pharm), amber-flag rows whose name disagrees
  with the selected role, one sentence on what duty-eligible means, registrars unticked.
- **G2 · major · The unlock screen is a dead end.** In staff-view mode it never says
  view-only exists ("Continue in view-only →" missing); in strict mode it doesn't say who
  to ask; "stored as a one-way hash" is jargon to the technophobe. The honest
  forgotten-passcode copy should stay — reword the mechanism in plain English.
- **G3 · major · Manager-grade red HIGHs render in staff view.** Both the technophobe
  partner and the locum read "no duty doctor rostered (0/1)" as *their* fault/problem.
  The alert signal must not be softened (house rule) — but in read-only staff view the
  checks belong behind a labelled summary ("Rota manager's checks — 10 high") so the
  audience is named, not frightened.
- **G4 · minor · The grid caption under-teaches the click path.** "Click to edit · drag to
  move" made the technophobe attempt a low-confidence drag; the click-menu (which she can
  operate) is the safer path and should lead the caption.
- **G5 · minor · Caption/footnote type is too small for the eyesight lens.** The staff-view
  explainer and drift-card detail lines are readable but effortful (Maureen).

### Role-specific needs

- **R1 · major (locum/staff) · Self-service actions are undiscoverable from the grid.**
  No visible route from the read-only grid to swap/leave requests; the My week identity
  picker defaults to the first staff member's name rather than "Select your name…", which
  reads as someone else's page. Fix: blank picker default + one caption pointer.
- **R2 · minor (manager) · Duty-eligible ≠ duty-rostered.** Ticking duty at import then
  seeing "Duty today: nobody" reads as contradiction. One sentence on the wizard's final
  step ("nobody is on duty until you assign it — use Auto-duty or Solve") closes it.
- **R3 · minor (power user) · Bulk power gaps.** No whole-row/column selection; no
  fill-forward/repeat-week from the grid (Copy week exists in Actions but wasn't
  discovered); rooms mode opens as a wall of "Unassigned" with no pointer to Assign rooms.
- **R4 · minor · Rooms wording and chips.** "We will set up 3 consulting rooms … with a
  usual room each for 4 of them" is technically consistent (4 clinicians pinned across 3
  rooms) but reads as a contradiction — reword. Rooms-mode initials chips decode only on
  hover.
- **R5 · minor · Wizard step tracker is unlabeled** (four grey dashes; savvy users want to
  see the road ahead).

### Standout strengths (protect these)

- Review-before-import with the SEEN evidence column and "nothing is saved until you say
  so" at both nervous moments — the manager persona compared it to payslip-checking and
  meant it as praise.
- The passcode card's honest threat model ("it is not security…") — called the
  best-explained section in the product; the unlock screen's forgotten-passcode copy tells
  the truth instead of "contact your administrator".
- The staff-view "view only" pill + plain-English caption — the technophobe admin's 7/10
  rests on it.
- The drift card: consequence-first framing, a count that ties out (6+1+1=8, verified by
  the most sceptical persona), and a colourblind rendering that carries the full signal
  without hue.
- The GAP footer row on every column — named better than RotaMaster's separate coverage
  report by the persona who has used RotaMaster.
- The connection check reporting a named, checkable day rather than a bare green tick.

## Prioritised path

Quick wins (S, under ~2h each):
1. Unlock screen: "Continue in view-only →" link (staff-view mode), plain-English hash
   copy, "ask the practice manager" line (unblocks Margaret, Sam) — G2.
2. My week picker defaults to "Select your name…" (Sam) — R1.
3. Solver display: round scores; label the checks panel's basis (first half of U1) —
   Geoff, Janet.
4. Read-only grid caption: lead with click-menu; add "swaps and leave live in My week"
   (Margaret, Sam) — G4/R1.
5. Rooms-mode empty state pointer + wizard rooms sentence reword (Geoff, Priya) — R3/R4.
6. Wizard final-step sentence on duty-eligible vs rostered (Janet) — R2.

Medium (M, half-day):
7. Wizard review guards: keyword role guess, mismatch amber flag, duty explainer,
   registrar default (Janet, Priya) — G1. The most clinically-adjacent fix on the list.
8. Visible session-type legend in the shortcuts strip + print output (Margaret, Maureen)
   — U2.
9. Staff-view checks panel behind a labelled summary (Margaret, Sam) — G3.

Large (L, 1–2 days):
10. Solver proposal surfacing v2.1: in-grid highlighted diff + checks recomputed against
    the proposed state + per-dimension before→after (Geoff's apply-trust; Janet) — U1
    full. The single highest-trust-value item on the list.
11. Row/column selection + repeat-week fill-forward (Geoff) — R3.

Routing: items 1–9 are UX/copy work (design-crit per surface, or direct); 10–11 are
feature work (10 touches solver surfacing only, not the engine). None of these change
clinical rules; nothing here routes through the-keeper.

## Judgement calls (reversible)

- **Full-tab rota app is single-theme dark** (ATELIER-committed); the suite panel themes,
  the app does not. Recorded as intentional, not a defect. Reverse by commissioning a
  light theme via ui-design.
- **Paste of a blank source cell clears its target** (Excel semantics, undoable, counted
  in the toast). Kept. Reverse one-liner: make paste skip blank source cells.
- **Red HIGH duty alerts stay loud.** G3 is a placement/labelling fix for the staff-view
  audience only; the alert signal itself is never softened (house rule).

## Overruled persona claims (checked, not adopted)

- "8 of 3 key steps" on the suite Get-set-up card: the counter maxes at 3 by construction
  (`mandatoryDoneCount()` counts three booleans); glyph misread of "0 of 3".
- Benchmark "moving" 720→749 between screens: artefact of two fixtures with different
  list sizes (default 10,000 vs demo 10,400); in one practice it cannot move. U3's
  show-the-derivation still adopted.
- "Dr Felix Adeyemi never imported": two different fixture datasets (wizard sample payload
  vs demo seed), not a product inconsistency.
- "Drift card has no action button": it does ("Open Live sync →", deep-links to the sync
  view); likely below the fold of the persona's reading.

## Reproduce

Shots: `/tmp/the-practice/rota/` (21 states), states file preserved at the session
scratchpad (`rota-practice-shots.mjs`) — design-crit harness, demo seed + generated
4 weeks, `makeAccess('2468')` for lock states. Panel: personas 1, 2, 6, 8, 10, 7 from
`.claude/skills/the-practice/PERSONAS.md`; haiku for technophobe bands, sonnet otherwise;
screenshots-only, single-persona isolation, standard six-part return contract.
