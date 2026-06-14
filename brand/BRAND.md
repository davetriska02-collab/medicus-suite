# Medicus Suite — Brand

The visual identity for Medicus Suite. Keep it consistent wherever the product
appears.

## Name & tagline

- **Name:** Medicus Suite
- **Tagline:** *The clinical intelligence layer for Medicus*

Use the tagline as the product one-liner in the README, the About panel, the
Options Suite section, and the store description.

## The mark

A navy→accent-blue app tile with a clinical pulse line whose apex is an amber
status dot — the same RAG (red/amber/green) signal the suite uses throughout
its UI. The amber dot is the brand signature; do not recolour it to a flat
accent or drop it.

| File | Use |
|---|---|
| `logo-mark.svg` | The app mark. Use everywhere the mark appears at ≥24px (nav brand, Options sidebar, About panel, visualiser drop screen). |
| `logo-mark-small.svg` | Simplified mark (no halo, heavier pulse) — drives the 16px extension icon so it stays legible. Not for general use. |
| `logo-wordmark.svg` | Mark + "Medicus Suite" + tagline lockup. Use for headers and the README banner. |
| `logo-mark-512.png`, `logo-wordmark-1000.png` | Raster previews for docs / store listings. Not shipped in the extension zip. |

`icons/icon-16.png`, `icon-48.png`, `icon-128.png` are the Chrome extension
icons, generated from the marks.

## Colours

From the suite's design tokens (`.claude/skills/ui-design/TOKENS.md`).

| Token | Hex | Use |
|---|---|---|
| Tile gradient (top) | `#2f6bf0` | Mark tile top |
| Tile gradient (bottom) | `#16307c` | Mark tile bottom |
| Accent | `#2563eb` | "Suite" in the wordmark, brand accent |
| Amber (status dot) | `#fbbf24` | The RAG signal dot |
| Pulse | `#ffffff` | Pulse line on the tile |
| Ink | `#0f172a` | "Medicus" in the wordmark |

## Wordmark

"Medicus" in ink (`#0f172a`), "Suite" in accent blue (`#2563eb`), system sans
(`Segoe UI`/`system-ui` stack), with the tagline below in `#475569`.

## Regenerating the icons

The PNG icons are derived from the SVG marks — never hand-edit them. After
changing a mark:

```
npm install --no-save sharp   # if not already present
node brand/generate-icons.mjs
```

This rewrites `icons/icon-16/48/128.png` and the raster previews in `brand/`.

## Where the brand appears

- README banner (`logo-wordmark.svg`)
- Side-panel nav (`logo-mark.svg`)
- Pop-out titlebar (`logo-mark.svg`)
- Options sidebar + Suite section tagline
- About panel (mark + name + tagline)
- Visualiser drop screen (`logo-mark.svg`)
- Chrome extension icons (`icons/*.png`)
- Store description (`manifest.json` → `description`)

## Don't

- Don't recolour or remove the amber status dot.
- Don't stretch the tile or change its corner radius ratio.
- Don't re-theme the visualiser palette to the panel palette — only the mark is
  shared; the visualiser keeps its NHS palette (see `CLAUDE.md`).
- Don't hand-edit the PNG icons; regenerate them.
