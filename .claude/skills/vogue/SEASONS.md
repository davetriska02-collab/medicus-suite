<!-- Vogue season ledger. Append a new entry at the top of "The seasons" on
     every Land. Bump SEASON_VERSION when a new season ships. This file is
     Vogue's memory: it reads the active season here and is FORBIDDEN from
     re-proposing it. Every candidate must move meaningfully off the entry at
     the top. -->

SEASON_VERSION: 2

# Vogue season ledger

The history of the suite's aesthetic directions. The **top entry is the active
season** — Vogue must move meaningfully off it and never re-propose it. Each
entry records what changed and *why* (the trend evidence), so the rotation is
deliberate and traceable, not random.

## The seasons

### Season 2 — "Frosted Deck" — active since 2026-06-21
- **Mood:** Modern depth. Self-owned frosted glass on the nav/chrome over a
  deepened field, so light reads as coming through the panel's top layer.
- **Surface material:** Frosted glass on `.suite-nav` ONLY
  (`backdrop-filter: blur(14px) saturate(1.45)` over a `color-mix` tint; tokens
  `--glass-blur`/`--glass-fill`). Content cards stay opaque `--bg-elev`; the
  field `--bg-deep` is deepened (light `#f8fafc`→`#e9eef6`, dark `#050a14`→
  `#03070f`) with a faint `--accent` radial bleed. Elevation lifted/softer
  (`--shadow-*` raised); radii rounded (`--r-sm/md/lg` 4/6/8 → 5/8/11).
- **Accent / colour:** Unchanged from Instrument — clinical blue accent, status
  triads untouched (FLOOR). The season is material + depth, not palette.
- **Type:** Dual-voice casting and the 9–18px scale unchanged.
- **Motion:** Unchanged (≤200ms, reduced-motion honoured); glass also collapses
  to solid under `prefers-reduced-transparency: reduce`.
- **Source / rationale:** Vogue scout (2026-06-21). Durable, MV3-safe signal:
  Apple "Liquid Glass" (iOS/macOS 26, HIG Materials) + Linear's *self-owned*
  frosted nav material (linear.app/now/linear-liquid-glass) — apply glass
  sparingly to navigation, own the material rather than depend on the OS.
  `backdrop-filter` + `color-mix()` are Baseline-stable in Chrome. Chosen by Dave
  from a 5-candidate rendered mood board (over Warm Paper, Warm Frosted,
  Graphite).
- **Retired:** Season 1 "Instrument" — flat opaque elevation retired in favour of
  glass-on-chrome depth; the calm instrument identity is preserved underneath.
- **FLOOR check at land:** contrast held (glass on chrome only, never behind text
  or chips); alert strips carved out opaque; dual-voice + density + focus +
  reduced-motion untouched; reduced-transparency fallback added; visualiser
  (NHS print palette) not in scope. Headless screenshot verification deferred —
  Chromium unavailable in the build env; verified via the live HTML mood board
  + lint + full test suite, pending Dave's eyeball on the real panel.

### Season 1 — "Instrument" — active 2026-06-21 → 2026-06-21 (inaugural)
- **Mood:** Precision clinical instrument. Flight-deck avionics / Leica /
  Linear's issue list. Calm layered neutral field, sharp clinical signals.
- **Surface material:** Flat, opaque. Elevation = 1px hairline border + a
  near-invisible matching shadow. No glass, no gradients-as-decoration.
- **Accent / colour:** Blue-leaning slate neutrals; status colour spent only
  on clinical meaning, in text/wash/border triads.
- **Type:** Dual-voice — JetBrains Mono small-caps (machine) vs. sans sentence
  case (human). Tight 9–18px scale.
- **Motion:** Feedback only, ≤200ms, reduced-motion honoured.
- **Source / rationale:** The founding doctrine — codified in Atelier's
  `DOCTRINE.md` and `TOKENS.md`. Not the product of a Vogue scout; this entry
  exists to give the ledger a baseline to evolve *from*.
- **Retired:** — (inaugural)

<!-- TEMPLATE for the next entry — copy above this line on Land:

### Season N — "<name>" — active since <YYYY-MM-DD>
- **Mood:** <one line>
- **Surface material:** <flat / frosted glass / paper / … and how elevation reads>
- **Accent / colour:** <what moved in the palette; status hues stay per FLOOR>
- **Type:** <treatment changes within the dual-voice casting; scale stays>
- **Motion:** <personality; still ≤200ms + reduced-motion>
- **Source / rationale:** <primary sources from the Scout that motivated it>
- **Retired:** Season <N-1> "<name>" — <one line on why it was time>
- **FLOOR check at land:** all 8 ✓ (contrast, alert salience, dual-voice,
  density, motion, focus, both-themes, visualiser print)
-->
