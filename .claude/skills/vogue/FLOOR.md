# The instrument floor — what a season may NEVER move

This is the line between *bold* and *broke a safety property*. Vogue may
override any taste position in Atelier's doctrine — flat vs. glass, gradients,
texture, accent, motion personality. It may **never** move anything below.
Every candidate season is checked against this list on paper (Translate) and
again in the render (Render). A season that can only achieve its look by
breaching the floor is not a candidate — redesign it or drop it.

If the floor and a season ever disagree, **the floor wins, every time.**

## 1. Contrast is a floor, not a knob
- Body text ≥ **4.5:1** against its *actual* rendered background; large/bold
  ≥ **3:1**. A glass/translucent surface is measured against what shows
  *through* it in the worst case, not against the tint in isolation.
- The muted text tiers (`--text-4`, `--text-5`) stay supplementary — never the
  only copy of a piece of information.
- A season that lowers contrast to look "softer/airier" is rejected.

## 2. Alert salience is sacred
- Red / amber clinical states — chips, RAG pills, the global strips
  (`#wrStrip`, `#rmStrip`, `#subRagStrip`) — **may never be dimmed, blurred,
  desaturated, frosted-over, or demoted** for aesthetic reasons. If an alert
  looks "too loud", it is correct.
- A translucent/glass material may **not** sit over an alert state if it
  reduces its salience. Elevation effects stop at the alert's edge.
- Status colour keeps its triad meaning (text `--red`, wash `--red-dim`,
  border `--red-line`); a season may restyle neutrals freely but must not
  repurpose or weaken the status hues.

## 3. The dual-voice typography is the brand, not the season
- **Mono, small-caps, letterspaced = the machine voice** (labels, nav, counts,
  metadata). **Sans, sentence case = the human voice** (patient names, clinical
  prose). A season may change *type treatment within a voice* but must not blur
  the casting — a patient name never becomes uppercase mono; a system label
  never becomes sentence-case sans.
- The tight type scale (9–18px) stays. Seasons express mood through material,
  colour and space — **not** size inflation.

## 4. Density is a clinical requirement
- The 4px grid and the compact, information-dense layout stay. A season may not
  introduce landing-page whitespace that pushes content below the fold of a
  360–420px panel. Breathing room *between groups* is good; air *for its own
  sake* that costs a row of clinical data is not.

## 5. Motion is feedback, never decoration
- Transitions ≤ **200ms**, easing via `--ease`. No decorative/ambient
  animation, no parallax, no looping motion.
- **Every** motion respects `@media (prefers-reduced-motion: reduce)`. A
  scroll-driven or animated season degrades to static under that query.
- Layout must not shift between states (reserve the border/space, don't add it).

## 6. Focus and keyboard access
- A tokenised `:focus-visible` ring on **every** focusable element. No
  `outline: none` without a visible replacement. A season may restyle the ring;
  it may not remove it.
- Meaning never rides on hue alone — colour is always paired with weight, an
  icon, or a label. The colourblind mode (`data-colorblind`) must survive the
  season unchanged in meaning.

## 7. Both themes, all sizes, colourblind
- Light is the default and most-used; dark is a peer, **mapped not inverted** —
  re-pick every season value against the dark column (washes that read at 8% on
  white need ~14–18% on `#0b1424`). A season that only works in one theme is
  unfinished.
- The three sizes (`zoom`) and `data-colorblind` must all survive every season.

## 8. The visualiser keeps its NHS idiom
- `visualiser-core.html` prints / exports to PDF and stays NHS-aligned and
  print-friendly. A season polishes it but does not re-brand it, and does not
  apply screen-only materials (glass, shadow-heavy elevation) that won't print.

## 9. Platform reality
- MV3 + CSP: no new external fonts or image assets without explicit maintainer
  approval. Pure-CSS materials (glass via `backdrop-filter`, gradients, OKLCH,
  `color-mix`, texture via CSS) are fair game.
- Never touch the test-pinned files for styling: `content-scripts/triage-lens/
  content.js` and either `defaults.json`. Their UI lives in `hud.css`.

---

**The check (run for every candidate, both on paper and in the render):**

1. Contrast still ≥ 4.5:1 (3:1 large) on the worst-case background? ✓/✗
2. Every alert state at full salience, nothing frosted/dimmed over it? ✓/✗
3. Dual-voice casting intact; type scale untouched? ✓/✗
4. No clinical data lost to new whitespace; 4px grid held? ✓/✗
5. Motion ≤200ms and reduced-motion degrades cleanly? ✓/✗
6. Focus ring present on every focusable; meaning not hue-only? ✓/✗
7. Renders correctly in **both** themes, all sizes, colourblind? ✓/✗
8. Visualiser still NHS-aligned and print-safe? ✓/✗

Any ✗ → fix the season or drop it. Never render or present a season with an
open ✗ as if it were a valid option.
