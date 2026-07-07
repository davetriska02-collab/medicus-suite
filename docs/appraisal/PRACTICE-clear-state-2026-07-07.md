# The Practice — "what would make you smile?" (clear-state warmth)

**Date:** 2026-07-07 · **Scope:** one generative question — the maintainer
wants one light touch of warmth in the suite's finished-work moments, panel
consulted for ideas, practice lead vetting for professionalism.
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona — a
heuristic device, not user research.

## Verdict

The panel unanimously rejected the literal smiley/emoji (including the
youngest, most consumer-savvy persona: "patronising… you don't want cheerful,
you want competent") and converged on **one fixed line of warm, static text on
the genuinely finished pile**. The emotional note that fits a knackered
clinician is acknowledgement/permission, not celebration or praise.

## Panel + the rules they converged on

Cast: Chloe (receptionist, consumer-savvy), Dr Margaret Aldous (technophobe
partner), Dr Tom Hollis (pragmatist GP), Sister Eileen Cobb (nurse,
trust-keeper), Dr Geoff Pellew (power user). Screenshots-only, no cross-talk.

1. **No emoji, no mascot, no smiley** (Chloe, Margaret, Geoff). Text only.
2. **No animation** (Margaret: reports the software to the partnership;
   Geoff: "if it moves, build the switch first; static needs no setting").
3. **No rotation/randomness** (Tom, Chloe, Geoff): one identical line that
   "fades into competence" — a rotating quip is resented by week three.
4. **No sound, ever** (Chloe).
5. **Tom's guard (load-bearing):** warmth only when the pile is GENUINELY
   empty — every task type selected, no filter active. Warmth on a
   view-narrowed emptiness is a false all-clear.
6. **Eileen's line (trust-keeper):** delight may attach to finished WORK
   (empty pile, waiting room clear — "that's about us, not the patient's
   risk") and never near clinical rows or the "no monitoring flags ≠ all
   clear" caveat. Her admission is the whole doctrine: warmth beside a caveat
   would make even her check "half a beat faster" past it. "I trust this
   panel because it refuses to be reassuring where it can't back it up.
   Don't spend that trust on decoration."

## Ruling (practice lead) — shipped as v3.159.0

Adopted: Tom's copy with the suite's existing muted-green tick —
**"✓ Pile's clear — nothing waiting on you."** — on the Signing Queue's
genuinely-empty state only (`emptyStateKind` gate: all types ticked, no
location filter; otherwise the neutral wording stays). Rejected: time-aware
variants (adds variation, breaks rule 3), "Kettle's on" (jokey-once, week-3
risk by the panel's own rule), praise wording (Tom: wants permission, not
praise). The maintainer's original smiley: overruled by his own panel,
with affection.

Candidate future application of the same pattern (same gates): Sweep's
all-checked state, Today's nothing-needs-you headline. Not shipped here.

## Reproduce

Empty-state screenshots: /tmp/the-practice/signing-chip/clear-done2.png
(genuine, warm) and clear-narrowed.png (narrowed, neutral), via the
design-crit harness. Personas: 4, 1, 5, 3, 10; haiku for bands 1/4, sonnet
rest.
