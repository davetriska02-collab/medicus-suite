# Doctrine — what good looks like for Medicus Suite

The one-line brief: **a precision clinical instrument**. Think flight-deck
avionics, a Leica rangefinder, Linear's issue list — not a SaaS landing page.
The user is a clinician making safety-relevant decisions under time pressure
in a 360–420px side panel. Beauty here *is* legibility, hierarchy, and calm.

## The five principles

### 1. Hierarchy is the design
At any moment the panel answers one question: *what needs my attention?*
Red/amber clinical states outrank everything; the active patient outranks the
list; data outranks chrome. If two things compete visually, demote the less
clinical one. Achieve hierarchy with weight, color temperature, and space —
not size inflation. The type scale is deliberately tight (9–18px); respect it.

### 2. Calm surfaces, sharp signals
The resting state of every screen is quiet: layered neutral backgrounds
(`--bg-deep` → `--bg-mid` → `--bg-elev`), hairline borders, near-invisible
shadows. Color is *spent*, not decorated with — when red appears it must mean
"clinical risk", never "I wanted some red here". This contrast between a calm
field and a sharp signal is the suite's entire visual identity. Guard it.

### 3. Density with breathing room
GPs want a lot on screen — this is a dense UI by design and that is correct.
Density is achieved with the compact type scale and tight-but-regular spacing
(4px grid), never by removing whitespace *between groups*. Within a card:
tight. Between cards and sections: generous enough to scan. The eye should
find group boundaries without borders doing all the work.

### 4. The dual-voice typography is the brand
Two voices, strictly cast:
- **Mono (JetBrains Mono), small caps, letterspaced** — the *machine* voice:
  labels, nav, badges, counts, metadata, anything the system says about data.
- **Sans, sentence case** — the *human* voice: patient names, clinical text,
  prose, anything a person reads as content.

Never blur the casting. A patient name in uppercase mono is a bug; a section
label in 13px sans is a missed note. This contrast does more for the
"professional instrument" feel than any color ever will.

### 5. States are part of the component, not an afterthought
Every interactive element ships with all of: rest, `:hover`,
`:focus-visible` (the tokenised ring — keyboard users are users), `:active`,
`:disabled`, and where relevant `.active`/selected. A hover state that only
changes color by 5% reads as broken; a missing focus ring is an accessibility
defect. State changes transition in ≤200ms with `--ease`; layout must never
shift between states (reserve the border, don't add it).

## Craft rules (the difference between 90% and 100%)

- **Borders + shadows together, both subtle.** Elevation = 1px hairline
  border *plus* the matching `--shadow-*`; never a heavy shadow alone.
- **Tinted, not gray.** Neutrals in this palette are blue-leaning slates.
  A pure `#888`/`#eee` anywhere reads as a foreign object.
- **Status colors come in triads** — text/icon (`--red`), wash
  (`--red-dim`), border (`--red-line`). Using full-strength status color as
  a background is almost always wrong; using a wash for text always is.
- **Numbers are data.** Counts, times, scores: mono, `font-variant-numeric:
  tabular-nums` where columns align.
- **Radius communicates scale**: 4px controls, 6px cards/inputs, 8px
  modals/sections, 999px pills. One element, one radius — never mix.
- **Icons are Feather-style strokes** at `currentColor`, 14px in chrome,
  16px in content. No emoji in chrome (emoji are tolerated only as existing
  strip glyphs), no filled icon sets, no second icon family.
- **Empty states and loading states get designed too** — a muted mono label
  and breathing room, not a bare "No data".
- **Dark theme is mapped, not inverted**: re-pick every value against the
  dark token column. Washes that work at 8% alpha on white need ~14–18% on
  `#0b1424`. If you didn't look at it rendered dark, it isn't done.

## Accessibility floor (non-negotiable)

- Body text ≥ 4.5:1 contrast against its actual background; large/bold ≥ 3:1.
  The muted tiers (`--text-4`, `--text-5`) are for *supplementary* text only —
  never for the only copy of information.
- Meaning never rides on hue alone — pair color with weight, an icon, or a
  label (the colorblind mode swaps hues; the design must already survive it).
- `:focus-visible` ring on every focusable element, no `outline: none`
  without a replacement.
- All motion respects `prefers-reduced-motion: reduce`.

## Taste references

When judging "is this good?", calibrate against: **Linear** (density +
hierarchy in lists), **Stripe Dashboard** (data tables, restrained color),
**Raycast** (compact chrome, mono accents), **GOV.UK/NHS service manual**
(clinical clarity, the visualiser's print idiom). If a choice would look
at home in those products *and* on an anaesthetic machine, it's right.
