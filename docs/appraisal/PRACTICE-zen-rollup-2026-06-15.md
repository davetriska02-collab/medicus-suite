# The Practice — appraisal: Focus (Zen) mode + Alert roll-up

**Date:** 2026-06-15 · **Scope:** the two features on branch
`claude/clinical-extension-redesign-pr1dso` (side-panel nav + global alert strips).

> **Synthetic panel — not user research.** Every reaction below is a synthetic
> persona used as a heuristic device to surface UX/feature gaps cheaply. None of
> it is evidence that a real clinician said anything. Do not launder these into
> "a GP told us".

## 1. Verdict

The roll-up's bones are right and one decision — **red auto-expands** — is
quietly excellent and praised across the whole panel. The single biggest thing
holding both features back is **number legibility**: the collapsed pills use a
bare integer that means three different things (patients vs categories vs
channels), so the manager can't reconcile it and a clinician can't read
proximity-to-breach from it. Focus mode is a clean power-user win but fails the
technophobe floor on discoverability and "how do I undo this". Not best-of-type
yet, but close, and the fixes are mostly small.

## 2. The panel

| Handle | Role | Band | Score /10 |
|---|---|---|---|
| Dr Margaret Aldous | Senior GP partner | technophobe | 4 |
| Chloe Danvers | Receptionist / care-navigator | savvy-consumer, low clinical | 5 |
| Dr Tom Hollis | Salaried GP | pragmatist | 7 |
| Janet Briggs | Practice manager | reluctant-capable | 4 |
| Raj Patel | Clinical pharmacist | savvy + domain | 7 |
| Dr Geoff Pellew | GP partner / power user | savvy | 7 |

## 3. Findings

### Universal friction

- **F1 · Pill counts are inconsistent and unreconcilable. [MAJOR]** Hurts:
  Janet (blocker), Tom, Chloe, Margaret. *Verified in source:* the `Waiting`
  pill = patient count (`patients.length`); `Demand`/`Triage` = number of
  categories/buckets over threshold (`triggered.length`); the headline
  "N ALERTS" = number of elevated channels. A bare number means three different
  things in one bar, and "Demand 2" reads as "2 tasks" when the detail is 115
  (70+45). *Note on the demo:* the "collapsed Waiting 1 → expanded Waiting 3"
  jump the panel saw was partly a render-fixture artefact (different patient
  counts seeded per shot), but the cross-pill semantic mismatch is real.
  **Fix:** one consistent, labelled semantic — either "Demand 115" (the count
  that matters) or "Demand: 2 categories" — so collapsed reconciles to expanded.

### Tech-literacy gradient

- **F2 · Focus mode is undiscoverable and its undo is invisible to the floor.
  [MAJOR for technophobe, MINOR for savvy]** Hurts: Margaret (would close the
  panel and call it broken), Tom (never finds Ctrl+., won't use), Geoff (can't
  tell the focus icon from the full-screen/theme icons). The toggle is an
  unlabelled icon among ambiguous twins; Ctrl+. is advertised nowhere on screen;
  entering Zen (brand + labels gone) reads as "something broke" to a technophobe
  with no obvious way back. **Fix (route to design-crit):** clearer/were-distinct
  icon + persistent "Focus on — Esc to exit" affordance; surface the shortcut on
  hover; consider a one-time hint. Keep nav labels on by default.

### Role-specific

- **F3 · Colourblind: amber vs red leans on hue at the chip level. [MAJOR]**
  Raj: the only colour-independent cues are layout (red auto-expands) and the
  DETAILS/HIDE word; the chips and the ⚠ icon are otherwise identical. **Fix:**
  add a non-colour severity token (shape or "AMBER"/"RED" text) to the chips.
  *Salience is never reduced — this only adds a redundant cue.*
- **F4 · Wait-time hidden behind DETAILS in amber. [MAJOR, safety-relevant]**
  Raj: a 12-min and a 55-min wait both collapse to "Waiting 1"; proximity to a
  breach — the clinically meaningful number — is one click away. **Fix:** show
  the worst single wait-time on the collapsed waiting pill.
- **F5 · "Demand"/"Medical 70" is jargon with no unit or scale. [MAJOR]**
  Chloe can't tell if 70 is normal or alarming, or whether it's her problem.
  **Fix:** plain-language tooltip/expansion and a sense of scale.
- **F6 · Power-user wants a persistent "always expanded". [MINOR]** Geoff: the
  sticky expand choice resets when the alert set changes ("a goldfish") — in a
  live queue that is constant. **Fix:** a real persisted "keep alerts expanded"
  preference that survives set changes.
- **F7 · Two "expand" affordances stacked. [MINOR]** Raj: the roll-up "DETAILS"
  sits directly above the setup card's "EXPAND" — mis-click hazard. **Fix:**
  visually separate the roll-up from the setup card.

### Standout strengths (protect these)

- **Red auto-expands** — Tom, Raj, Geoff all called it correct: the worst case
  forces itself open, can't be left folded.
- **Counts on the collapsed bar** (not a bare "N ALERTS") — Raj: this is what
  stops it being a black box.
- **Three strips → one calm line** — Tom, Janet, Chloe liked the reduction.
- **Focus mode keeps warm strips while stripping chrome** — Raj: "declutter the
  decoration, never the danger." The core safety invariant held on screen.
- **Expanded layout** (names + timers + Medical/Admin split) — Geoff: "exactly
  what I want resting."

## 4. Prioritised path to best-of-type

Quick wins (S < 2h):
1. **F1** consistent + labelled pill counts (reconcile collapsed↔expanded).
2. **F3** non-colour severity token on chips.
3. **F4** worst wait-time on the collapsed waiting pill.
4. **F7** separate roll-up from setup card.

Half-day (M):
5. **F2** focus-mode affordance + exit hint + distinct icon — *hand to design-crit*.
6. **F5** plain-language tooltips / scale for Demand.
7. **F6** persistent "always expanded" preference.

## 5. Judgement calls

- **Margaret's "is the focus button even necessary?"** — overruled (do not
  delete; it's a deliberate, requested feature). Her point is folded into F2:
  make it safe to ignore and easy to undo. *Reverse by:* if real users echo
  this, gate Focus mode behind a setting rather than a default nav button.
- **Geoff's Ctrl+. rebinding and tunable collapse threshold** — deferred to
  roadmap, not treated as a defect.

## 6. Reproduce

- Surfaces shot (12 states, light/dark/colourblind/cold-start/zen/rollup):
  rendered via `.claude/skills/design-crit/harness.mjs` into
  `/tmp/the-practice/zen-rollup/`.
- Panel cast: personas 1, 4, 5, 8, 9, 10 from `PERSONAS.md`
  (technophobe floor + savvy ceiling + manager).
