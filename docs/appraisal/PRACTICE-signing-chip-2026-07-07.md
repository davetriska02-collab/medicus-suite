# The Practice — Signing Queue collection-location chip (placement appraisal)

**Date:** 2026-07-07 · **Scope:** one question on one surface — where should the
v3.157.0 collection-location chip live on Signing rows, and how should it read.
**SYNTHETIC PANEL:** every reaction below is from a synthetic persona
(`.claude/skills/the-practice/PERSONAS.md`), a heuristic device — not real user
research, and never to be quoted as a real clinician's view.

## Verdict

The chip's information is right and universally wanted; its current berth is
not. All four personas converged, from different directions, on the same
design: **the load-bearing control belongs at the top as location filter pills
with counts** ("Dispensary 6 · No location 3 …"), with the per-row chip demoted
to the meta line and reworded in plain language ("collect: Dispensary"). The
sharpest adopted finding is that **a chip-less row is ambiguous** — "not a
dispensing patient" and "location not recorded" currently render identically,
which two personas independently rated a trust/safety gap.

## Panel

| Persona (synthetic) | Role / band                                        | Score /10                   |
| ------------------- | -------------------------------------------------- | --------------------------- |
| Dr Tom Hollis       | GP signer, pragmatist                              | 7                           |
| Raj Patel           | Clinical pharmacist + dispenser lens, savvy/domain | 6 (4 for a dispensary tech) |
| Janet Briggs        | Practice manager, reluctant-but-capable            | 6                           |
| Dr Margaret Aldous  | Senior partner, technophobe                        | 6                           |

## Findings and rulings

1. **[ADOPT · major · all bands] No aggregate view — location filter pills
   with counts at the top.** Janet hand-counted 6 with a finger on the screen
   and would not defend the number; Raj's 12–15s scan "will not scale to a
   40-row Monday"; Tom independently proposed a filter as the alternative to
   the chip. Fix: derive pills from the location values present in the current
   pile ("Dispensary 6 · Boots Pharmacy, Godalming 1 · No location 3"), click
   to filter. Generic over recorded values — no hardcoded "dispensing"
   semantics, so it stays portable to any practice.
2. **[ADOPT · major · savvy + manager] Chip-less ambiguity.** "No chip" means
   both "not dispensing" and "not recorded" — Raj's silent-false-negative
   pattern, Janet's indefensible count. Fix folds into (1): "No location (N)"
   becomes an explicit named bucket, so absence is a countable, clickable
   state instead of a blank. (Verified against source: the chip comes from the
   task row, independent of the record fetch, so an error row CAN still show
   its location — Raj's Lyle worry is structurally impossible, recorded here
   as reassurance.)
3. **[ADAPT · major · pragmatist + technophobe] Top-right reads as a decision
   flag.** Tom: top-right beside the name is where the eye expects "act on
   me", not a destination label; Margaret: "looks like important information
   I'm supposed to already understand… makes me nervous about signing." Raj
   alone defended top-right (correct hierarchy vs clinical chips). Ruling:
   once (1) exists, demote the per-row chip to the bottom meta line — it keeps
   Raj's non-competition property while vacating the decision zone.
4. **[ADAPT · minor · technophobe] Plain-language reading.** Margaret can't
   decode ⌂ and asks, in one sentence, whether she must act. The existing
   `title=` tooltip fails the roster's accessibility lens (load-bearing info
   never tooltip-only). Ruling: chip text becomes "collect: Dispensary" —
   self-explaining, no glyph decoding; drop or keep ⌂ as decoration.
5. **[OVERRULE · reason recorded] Normalised "DISPENSING" badge.** Raj argued
   verbatim text is clinically safer (exposes stale pharmacy nominations) and
   nobody dissented. The verbatim reading stays. _(Reverse with: replace chip
   text with a practice-configured location→badge map — not recommended.)_
6. **[NOTE · minor] Items vs patients.** Janet: 6 requests = 5 patients (Moss
   ×2). Consider "10 open repeat requests · 8 patients" in the title.
7. **[STRENGTHS to protect]** Verbatim location text (Raj); calm accent colour
   that never competes with red/amber clinical chips (all four); ⌂/shape
   carries meaning under colourblind mode (Raj, verified render); chips absent
   entirely at practices that don't use the field.

## Prioritised path

- **S–M: location filter pills with counts** (finding 1+2) — unblocks Janet,
  Raj, and the dispensary tech in one control.
- **S: demote per-row chip to meta line, reword "collect: …"** (3+4) —
  unblocks Tom's scan path and Margaret's "is it a warning?".
- **S (optional): patients count in the title** (6).

Implementation is a separate request (this run is report-only); route the CSS
through the module's existing tokens, no new clinical semantics anywhere.

## Reproduce

Surfaces: `/tmp/the-practice/signing-chip/` — pile-light, pile-dark,
pile-colourblind; 10-row fixture (5 Dispensary, 2 community pharmacy, 3 none;
verdict spread incl. requested-red, stale eGFR, error row) via
`.claude/skills/design-crit/harness.mjs`. Cast: personas 5, 9, 8, 1; Margaret
on haiku, rest sonnet; screenshots-only, no source access, no cross-talk.

## Addendum (same day) — real user outranks the panel

After this run, real feedback from the practice's dispensary side (Chris M.,
via the maintainer) asked for the flag **after the patient's name** with a
**glanceable symbol** ("so I can say your prescription will be with — our
dispenser or your usual chemist"). Real-user evidence outranks the synthetic
panel by this skill's own doctrine: finding 3 (meta-line demotion) is
REVERSED — the chip stays in the row head with glyph-borne category (house =
dispensary, Rx = community pharmacy). Findings 1, 2 and the hidden-red filter
note shipped as adopted (v3.158.0). Finding 4's plain-language ask is served
by the glyph + tooltip rather than the "collect:" prefix.
