# Medicus Suite — Brand

The visual identity for Medicus Suite. Keep it consistent wherever the product
appears.

## Name & tagline

- **Name:** Medicus Suite
- **Tagline:** *The clinical intelligence layer for Medicus*

## The mark

A gold **guardian shield** on a deep navy rounded-square tile, with a cyan
**ECG / pulse line** running across it and a glowing **beacon** on the trace.
The shield signals protection and vigilance (Sentinel / monitoring); the pulse
line makes the clinical purpose explicit; the beacon is the recurring "insight"
element and the focal point that keeps the mark legible when it shrinks.

| File | Use |
|---|---|
| `app-icon.png` | The 512px master. Source of truth for the in-product marks and the 48/128px icons. |
| `app-icon-16.svg` | Simplified favicon vector (bold gold shield rim, navy centre, one QRS spike + beacon) used for the 16px icon, where the master's detail collapses to a blob. |
| `generate-icons.mjs` | Regenerates `icons/icon-48/128.png` from the master and `icon-16.png` from the 16px vector. |

`icons/icon-16.png`, `icon-48.png`, `icon-128.png` are the Chrome extension
icons, derived from the master.

## Colours

| Element | Approx hex |
|---|---|
| Tile (deep navy) | `#1c3a63` → `#0f2647` |
| Helmet (gold) | `#c8b48a` / `#9c8456` |
| Beacon (cyan) | `#4fd6e0` |

The rest of the suite UI runs on the design-token blue (`#2563eb`,
`.claude/skills/ui-design/TOKENS.md`); the icon's navy/gold is its own register
and is intentionally richer than the flat UI chrome.

## Regenerating the icons

The PNG icons are derived from the master — never hand-edit them. After
replacing `app-icon.png`:

```
npm install --no-save sharp   # if not already present
node brand/generate-icons.mjs
```

## Where the mark appears

- README banner
- Side-panel nav
- Pop-out titlebar
- Options sidebar
- About panel (mark + name + tagline)
- Visualiser drop screen
- Chrome extension icons (`icons/*.png`)

## Don't

- Don't hand-edit the PNG icons; replace `app-icon.png` and regenerate.
- Don't recolour the cyan beacon away; it's the recurring focal element.
- Don't stretch the tile or change its corner-radius ratio.
- Don't re-theme the visualiser palette to the panel palette — only the mark is
  shared; the visualiser keeps its NHS palette (see `CLAUDE.md`).

## Replacing the icon with a higher-resolution source

`app-icon.png` is currently cropped from a design mockup. To swap in a cleaner
export: drop the new square art in as `brand/app-icon.png` (512px, rounded
corners) and run `node brand/generate-icons.mjs`.
