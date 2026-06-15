# Token canon — single source of truth

Authoritative implementation: `side-panel/panel.css` `:root` (light) and
`html[data-theme="dark"]` (dark). Every extension page loads it (panel,
pop-out, options, sentinel-options). This document is the spec; if the two
ever disagree, fix one in the same commit. **Never write a raw hex / radius /
shadow / timing in module CSS** — consume tokens. If a real gap exists,
extend the canon here _and_ in `panel.css`, then use it.

## Surfaces & text (slate family — tinted, never pure gray)

| Token         | Light     | Dark      | Role                              |
| ------------- | --------- | --------- | --------------------------------- |
| `--bg-deep`   | `#f8fafc` | `#050a14` | page background                   |
| `--bg-mid`    | `#f1f5f9` | `#0b1424` | nav, grouped regions, input wells |
| `--bg-elev`   | `#ffffff` | `#131e34` | cards, popovers                   |
| `--bg-hover`  | `#e2eaf5` | `#1a2a44` | hover wash on neutral elements    |
| `--border`    | `#cbd5e1` | `#1c2e4e` | hairline default                  |
| `--border-hi` | `#94a3b8` | `#2a4060` | emphasised / hovered border       |
| `--text-1`    | `#0f172a` | `#f1f5f9` | headings, primary data            |
| `--text-2`    | `#1e3a5f` | `#cfe1ff` | secondary, active chrome          |
| `--text-3`    | `#475569` | `#93a8c5` | tertiary, labels with content     |
| `--text-4`    | `#64748b` | `#5d7a9d` | muted — supplementary only        |
| `--text-5`    | `#94a3b8` | `#3d5070` | faintest — decoration-grade       |

Legacy aliases `--t1`…`--t5` map to `--text-1`…`--text-5` (older strip CSS
referenced them before they existed — the aliases make those rules resolve).
Write `--text-*` in new code.

## Accent & status (triads: ink / wash / line)

Every status color exists in three strengths. **Ink** for text+icons, **wash**
for backgrounds, **line** for borders. Full-strength ink as a background or
wash as text = bug.

| Triad                                         | Light                                                       | Dark                                                          |
| --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `--accent` / `--accent-dim` / `--accent-line` | `#2563eb` / `rgba(37,99,235,.09)` / `rgba(37,99,235,.30)`   | `#5b8fc7` / `rgba(91,143,199,.14)` / `rgba(91,143,199,.35)`   |
| `--accent-hover`                              | `#1d4ed8`                                                   | `#7eaad6`                                                     |
| `--green` / `--green-dim` / `--green-line`    | `#16a34a` / `rgba(22,163,74,.09)` / `rgba(22,163,74,.30)`   | `#4ade80` / `rgba(74,222,128,.12)` / `rgba(74,222,128,.32)`   |
| `--amber` / `--amber-dim` / `--amber-line`    | `#b45309` / `rgba(180,83,9,.09)` / `rgba(180,83,9,.32)`     | `#fbbf24` / `rgba(251,191,36,.16)` / `rgba(251,191,36,.32)`   |
| `--red` / `--red-dim` / `--red-line`          | `#dc2626` / `rgba(220,38,38,.08)` / `rgba(220,38,38,.30)`   | `#f87171` / `rgba(248,113,113,.17)` / `rgba(248,113,113,.34)` |
| `--violet` / `--violet-dim` / `--violet-line` | `#7c3aed` / `rgba(124,58,237,.09)` / `rgba(124,58,237,.30)` | `#a78bfa` / `rgba(167,139,250,.14)` / `rgba(167,139,250,.35)` |

The violet triad is the **custom/user-defined accent** (custom-rule tags and
similar user-authored markers) — it is deliberately NOT a clinical status and
colorblind mode leaves it alone. Dark `--red-dim`/`--amber-dim` were raised to
.17/.16 (2026-06-12 Monitoring crit) so the red-vs-amber tier survives on
`#0b1424`.

### Non-clinical categorical data-viz ramp

The suite-wide qualitative chart palette — used by the Activity chart and the
Submissions Tracker charts to colour workload/category series. This is the ONE
data-series ramp; new charts consume it rather than declaring their own.
Intentionally **outside the status triads** — workload counts (consultations,
prescription tasks, etc.) are operational data, never clinical alerts. Spending
`--amber` or `--red` on a bar-chart segment dilutes the alert palette's signal
strength. If you need a chart for clinical data, define a new scope.

Consume via inline `style="fill:var(--cat-N)"` / `style="stroke:…"` /
`background:var(--cat-N)` — CSS variables resolve there (and adapt to the
active theme), whereas SVG `fill=`/`stroke=` presentation attributes do NOT.
`--cat-5` is the recessive slate member: use it for the de-emphasised
"everything else"/admin series, not a headline category.

| Token     | Light     | Dark      |
| --------- | --------- | --------- |
| `--cat-1` | `#2563eb` | `#5b8fc7` |
| `--cat-2` | `#0d9488` | `#2dd4bf` |
| `--cat-3` | `#a21caf` | `#e879c9` |
| `--cat-4` | `#7c3aed` | `#a78bfa` |
| `--cat-5` | `#64748b` | `#93a8c5` |
| `--cat-6` | `#0891b2` | `#38bdf8` |

Dark values are lightness-raised for legibility on `#0b1424`.
Canon source: `side-panel/panel.css` `:root` / `html[data-theme="dark"]`.
Do not use `--cat-*` for status chips, badges, or any clinical-meaning surface.

Colorblind mode (`html[data-colorblind="true"]`) re-points the **whole red
and green triads** (red→orange `#ea580c`, green→blue `#2563eb` + matching
dim/line alphas). Components built from triads inherit the swap for free —
that is the point of the triads.

## Shape, depth, motion, focus

| Token                                 | Light                           | Dark                          |
| ------------------------------------- | ------------------------------- | ----------------------------- |
| `--r-sm` `--r-md` `--r-lg` `--r-pill` | `4px` `6px` `8px` `999px`       | same                          |
| `--shadow-1`                          | `0 1px 2px rgba(15,23,42,.05)`  | `0 1px 2px rgba(0,0,0,.4)`    |
| `--shadow-2`                          | `0 2px 8px rgba(15,23,42,.08)`  | `0 4px 12px rgba(0,0,0,.45)`  |
| `--shadow-3`                          | `0 8px 28px rgba(15,23,42,.14)` | `0 10px 32px rgba(0,0,0,.55)` |
| `--ease`                              | `cubic-bezier(.2,0,0,1)`        | same                          |
| `--fast` / `--med`                    | `120ms` / `200ms`               | same                          |

Radius semantics: `--r-sm` compact controls/badges, `--r-md` buttons, inputs,
chips, cards, `--r-lg` modals/popovers/sections, `--r-pill` pills & toggles.
Elevation = hairline border **plus** shadow, always both, both subtle.
`--shadow-1` cards at rest · `--shadow-2` hover lift & dropdowns ·
`--shadow-3` modals/HUD only.

Overlay veil: `--scrim` — the dimming layer behind modals, the tab chooser and
the tour spotlight. Light `rgba(15,23,42,.55)`; dark `rgba(0,0,0,.66)` (the
light slate value barely darkens an already-dark page, so dark is re-picked
deeper, not inherited). Consume `var(--scrim)` — never a raw scrim rgba.

Focus: `panel.css` ships a global
`:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }`.
Never suppress it; never use `:focus` for the ring (mouse users get flashed).

Motion: transitions use `var(--fast) var(--ease)` (color/border/background)
or `var(--med)` (transform/opacity/layout-adjacent). Any keyframe animation
gets a `prefers-reduced-motion: reduce` kill switch.

## Typography

- `--sans` (system stack) — human voice: content, names, prose. 11–13px body,
  16px module titles, weight 400–600.
- `--mono` (JetBrains Mono) — machine voice: labels, nav, badges, counts,
  metadata. 9–11px, weight 500–600, `text-transform: uppercase`,
  `letter-spacing: .06em–.12em` (smaller text → wider tracking).
- Aligned numerals: `font-variant-numeric: tabular-nums` on counts/tables.
- No new font families. No new weights without updating the Google Fonts
  import in `panel.css` (MV3 CSP — this import is the only sanctioned
  external asset).

## Component recipes (copy these, don't reinvent)

**Card** — `background: var(--bg-elev); border: 1px solid var(--border);
border-radius: var(--r-md); box-shadow: var(--shadow-1);` hover (if
interactive): `border-color: var(--border-hi); box-shadow: var(--shadow-2);`

**Ghost button** (default action) — transparent bg, `1px solid var(--border-hi)`,
mono uppercase 9–10px, `--text-3`; hover: `border-color: var(--accent);
color: var(--text-2); background: var(--accent-dim);`

**Primary button** (one per view, max) — `background: var(--accent); color:
var(--bg-deep);` hover `--accent-hover`; disabled: `opacity:.45;
cursor:not-allowed`. On-accent text is `var(--bg-deep)`, not `#fff`: it is
theme-adaptive (reads near-white on light, dark-ink on dark) and clears
contrast on the pastel **dark** accent `#5b8fc7`, where pure `#fff` is only
~3.4:1. Same rule for any text/glyph sitting on an `--accent` fill (nav badge,
copy buttons, tour/tabs CTAs).

**Status chip** — `background: var(--<c>-dim); color: var(--<c>);
border: 1px solid var(--<c>-line); border-radius: var(--r-sm);` mono 10px.
Pair every chip hue with a glyph or label — hue is never the only signal.

**Pill** (canonical — `.pill` in `panel.css`) — the suite-wide pill,
generalised from the Slots per-type pills. Anatomy: a coloured **dot**
(`.pill-dot`, category/severity carrier), a **name** (`.pill-name`, sans, human
voice, `--text-2`), a **count** (`.pill-count`, mono, tabular, `--text-1`).
`border-radius: var(--r-pill)`, `padding: 3px 9px 3px 7px`. Colour rides on two
custom props so an organise mode can set them per pill: `--pill-line` (border +
dot) and `--pill-fill` (background); defaults `--border` / `--bg-mid`.

- _Categorical mode_ (non-clinical organising): set `--pill-line`/`--pill-fill`
  from the `--cat-*` ramp — never raw hex, never a status hue. Fully
  user-configurable.
- _Clinical RAG mode_ (`.pill--green` / `.pill--amber` / `.pill--red`): dot +
  border = triad line, fill = triad wash, count = triad ink. **Non-colour
  severity cue:** red dot is FILLED, amber dot is a HOLLOW ring — so red vs amber
  survives colourblind by shape, not hue alone.
- **Safety lock:** `.pill--red` fixes `--pill-fill` to `--red-dim` with
  `!important`. User colour config may change a red pill's border only, never
  neutralise its red fill. Alert salience is a safety property — see SKILL.md.

Legacy per-surface pills (`.slot-pill`, `.condor-pill`, strip chips, …) converge
on this over time; do not mass-rename in one pass.

**Input** — `background: var(--bg-mid); border: 1px solid var(--border);
border-radius: var(--r-md); color: var(--text-2);` focus:
`border-color: var(--accent); background: var(--bg-elev);` (plus the global
ring).

**Section label** — mono 9px, `letter-spacing:.12em`, uppercase, `--text-4`,
generous top margin: groups are separated by space first, rules second.

**Empty state** — centered, mono 10px `--text-4` label over an optional
14px stroke icon at `--text-5`, ≥24px vertical padding. Never a bare string.

**Selected/active state** — wash + line from the accent triad
(`--accent-dim` bg, `--accent-line` border) and **reserve the border on the
rest state** (`border: 1px solid transparent`) so activation never shifts
layout.

## Injected surfaces (content scripts) — self-contained token rule

`sidebar/sidebar.css` and `content-scripts/triage-lens/hud.css` are injected
into Medicus pages, which never load `panel.css` — `var(--bg-elev)` etc.
resolve to nothing there. Therefore each injected stylesheet **defines its own
scoped token block** on its root (`.sentinel-root { --… }`,
`#medicus-clinical-hud { --… }`) carrying the _light-theme_ canon values
(host page is light), with a comment pointing back to this file. Inside the
scope, rules consume the scoped vars exactly like module CSS. When the canon
changes, these blocks are updated in the same commit — the surveyor stage
checks for drift.

## Out-of-scope / constraints

- `visualiser-core.html` keeps its NHS palette (`--nhs-blue: #005eb8` etc.)
  — it exports to print/PDF and reads as an NHS document on purpose. Polish
  spacing/type/states there, never re-brand it to the panel palette.
- **Pinned files — never edit for styling:**
  `content-scripts/triage-lens/content.js` (tests pin exact content), either
  `defaults.json`.
- `html[data-size]` handles text sizing via `zoom` — never write your own
  size-mode overrides.
- Suite chrome (`.suite-nav`, strips, `.module-wrap` etc.) is owned by
  `panel.css`; module CSS must not restyle it.
