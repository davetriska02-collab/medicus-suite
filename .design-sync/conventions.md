# Medicus Suite design system — conventions

A React mirror of the Medicus Suite (UK GP clinical tooling) house style. Two
atoms in this POC: `Chip` (RAG status tag) and `NavTab` (suite-nav pill). Both
are styled entirely from a CSS **token canon** — no per-component class names to
author, no theme provider to wrap.

## Setup — load the stylesheet, set the theme on `<html>`

There is **no provider component**. Styling comes from `styles.css` (it `@import`s
the token canon + component CSS). Themes are attributes on the root element:

- Dark: `<html data-theme="dark">` (default is light).
- Colourblind-safe: `<html data-colorblind="true">` — re-points the whole red and
  green triads (red→orange, green→blue). Build from the triads and you inherit it.

## Styling idiom — props on components, `var(--*)` tokens for your own glue

Components carry the design language through **props**, not classes:

- `<Chip tone="red|amber|green|info|violet">` — `red`/`amber`/`green` are the
  clinical RAG triads; `info` is the neutral accent; `violet` is the non-clinical
  user/custom accent (never a clinical status). Always pair a hue with a glyph or
  a clear label — `<Chip tone="amber" icon={…}>` — hue is never the only signal.
- `<NavTab active>` — active state is the accent wash + line; the rest state
  reserves a transparent border so selection never shifts layout.

For your **own** layout/glue around these components, consume the canon tokens —
never raw hex:

- Surfaces: `--bg-deep` (page), `--bg-mid` (nav/wells), `--bg-elev` (cards),
  `--bg-hover`. Borders: `--border`, `--border-hi`.
- Text: `--text-1` (primary) → `--text-5` (faintest).
- Status triads, each in three strengths — ink / wash / line:
  `--accent` / `--accent-dim` / `--accent-line` (and `--green`/`--amber`/`--red`/
  `--violet` likewise). Ink for text+icons, wash for backgrounds, line for borders.
- Radii: `--r-sm` `--r-md` `--r-lg` `--r-pill`. Fonts: `--sans` (content) and
  `--mono` (labels/nav — uppercase, tracked). JetBrains Mono is provided by the
  host at runtime.

## Where the truth lives

Read the bound stylesheet `_ds/<folder>/styles.css` (and its `@import`ed
`_ds_bundle.css`) for the full token list and component CSS, and each component's
`.prompt.md` / `.d.ts` for its API.

## Build snippet

```tsx
import { Chip, NavTab } from '@medicus/design-system';

<div style={{ display: 'flex', gap: 4, background: 'var(--bg-mid)', padding: 6, borderRadius: 'var(--r-md)' }}>
  <NavTab active>Today</NavTab>
  <NavTab>Results</NavTab>
</div>
<Chip tone="red" icon={<span aria-hidden>▲</span>}>Critical high potassium</Chip>
```
