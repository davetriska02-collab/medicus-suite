# Medicus Suite — Brand

The visual identity for Medicus Suite. Keep it consistent wherever the product
appears.

## Name & tagline

- **Name:** Medicus Suite
- **Tagline:** *The clinical intelligence layer for Medicus*

## The mark

A gold **precision reticle** — a rangefinder/avionics sight (outer ring, four
cardinal index ticks, an inner ring) — on a deep-navy instrument bezel, with a
glowing cyan **live-lock beacon** at the crosshair centre. The reticle says
*precision instrument under time pressure* (the doctrine's flight-deck /
rangefinder register, and the **Sentinel** that watches); the cyan beacon is the
recurring **focal element** — "the live insight, locked" — and what keeps the
mark legible when it shrinks. (Supersedes the earlier guardian-shield mark,
2026-06-21 — a shield read as a generic security badge; the reticle reads as the
clinical instrument the suite actually is.)

The vectors are the source of truth — the PNGs are derived, never hand-edited.

| File | Use |
|---|---|
| `app-icon-master.svg` | The 512px **vector master**. Source of truth for the in-product marks and the 48/128px icons. |
| `app-icon-16.svg` | Simplified favicon vector (bold gold ring + cardinal ticks, cyan centre dot) used for the 16px icon, where the master's reticle detail collapses. |
| `app-icon.png` | 512px raster, rendered from the master for `<img>` references. |
| `generate-icons.mjs` | Renders `app-icon.png` + `icons/icon-48/128.png` from the master and `icon-16.png` from the 16px vector. |

## The signature element

The cyan **live-lock dot** is the brand's one recurring beat — the focal point
of the mark, the about-panel logo and the visualiser drop screen. It lives in
the **brand register only** (the navy/gold/cyan mark surfaces), and is
deliberately kept **out of the clinical chrome**: the live UI runs on the slate
design tokens and reserves colour for clinical status, so the brand cyan never
appears as a UI accent where it could be mistaken for a signal (see DOCTRINE.md
"calm surfaces, sharp signals").

`icons/icon-16.png`, `icon-48.png`, `icon-128.png` are the Chrome extension
icons, derived from the master.

## Colours

| Element | Approx hex |
|---|---|
| Bezel (deep navy) | `#22416d` → `#0f2647` |
| Reticle (gold) | `#e7cd86` → `#b8923f` |
| Live-lock beacon (cyan) | `#43dcec` / core `#aef6ff` |

The rest of the suite UI runs on the design-token blue (`#2563eb`,
`.claude/skills/ui-design/TOKENS.md`); the icon's navy/gold is its own register
and is intentionally richer than the flat UI chrome.

## Regenerating the icons

The PNGs are derived from the **SVG masters** — never hand-edit a PNG. Edit
`app-icon-master.svg` (and `app-icon-16.svg` for the favicon), then:

```
npm install --no-save sharp   # if not already present
node brand/generate-icons.mjs
```

This re-renders `brand/app-icon.png` and `icons/icon-16/48/128.png`.

## Where the mark appears

- README banner
- Side-panel nav
- Pop-out titlebar
- Options sidebar
- About panel (mark + name + tagline)
- Visualiser drop screen
- Chrome extension icons (`icons/*.png`)

## Don't

- Don't hand-edit the PNGs; edit the SVG master and regenerate.
- Don't recolour the cyan live-lock dot away; it's the recurring focal element.
- Don't stretch the bezel or change its corner-radius ratio.
- Don't bring the brand cyan into the clinical UI as an accent — it stays in the
  brand register; the live UI reserves colour for clinical status.
- Don't re-theme the visualiser palette to the panel palette — only the mark is
  shared; the visualiser keeps its NHS palette (see `CLAUDE.md`).
