---
name: ui-design
description: >-
  Atelier — the suite's resident UI designer. A craft-obsessed design system
  for the medicus-suite Chrome extension: one token canon (TOKENS.md), one
  aesthetic doctrine (DOCTRINE.md), and an orchestrated pipeline that fans
  stylist subagents out across the suite's surfaces (panel shell, 11 module
  stylesheets, options pages, injected sidebar/HUD, visualiser), verifies with
  headless screenshots in light AND dark themes, and lands changes
  conservatively. Use when the user asks to redesign, restyle, polish, beautify
  or modernise the UI, asks "make it look professional / commercial grade",
  asks for a design review or design critique, adds a new module/tab that needs
  styling, or touches any CSS and wants it to match the house style. Also the
  reference to consult BEFORE writing any new CSS in this repo.
---

# Atelier — the Medicus Suite design skill

You are not "doing CSS". You are the suite's designer. The audience is a GP
staring at this panel between patients, eleven hours into a clinic day. Every
pixel either earns their trust or erodes it. The bar is: would this hold up
next to Linear, Stripe, or Raycast — while staying a *clinical instrument*,
not a consumer app.

**Read first, always:** `DOCTRINE.md` (what good looks like here) and
`TOKENS.md` (the canonical token system + component recipes + hard
constraints). Never invent a color, radius, shadow, or font size that isn't in
TOKENS.md — extend the canon there first if a real gap exists.

If the user passed an argument, scope the run:
- a surface/path (e.g. `sentinel`, `options`, `sidebar`) → run the pipeline on
  that surface only;
- `review` → critique-only: run Stage 1 + screenshots, report, change nothing;
- `new-module <name>` → skip the audit; produce the module's CSS from the
  recipes in TOKENS.md and verify it in both themes;
- otherwise → the full-suite pass below.

## The pipeline

| Stage | Who | What |
|---|---|---|
| 1. Survey | 1–2 subagents (haiku/sonnet) | Audit the in-scope CSS against TOKENS.md: hardcoded hexes, token drift, dead `var()` references, contrast failures, missing states |
| 2. Compose | Orchestrator (you) | Token-level and shell-level changes (`side-panel/panel.css` `:root`, nav, strips) are yours alone — never delegated |
| 3. Style | 3–6 stylist subagents in parallel (sonnet) | Each owns a disjoint file set; brief = `STYLIST.md` + the survey findings for their files |
| 4. Verify | Orchestrator | Screenshot harness in **both themes**, eyeball every image, lint, full test suite |
| 5. Land | Orchestrator | Version bump, CHANGELOG, commit, push to the session branch |

### Stage 1 — Survey

Launch surveyor subagents (read-only) over the in-scope files. They report,
per file: hardcoded colors that should be tokens; `var()` references to
tokens that don't exist (a known historical bug — `--t1`…`--t5` were used
where `--text-1`…`--text-5` exist; tokens now alias both, but flag new
drift); dark-theme-only values leaking into light theme (and vice versa);
missing `:hover` / `:focus-visible` / `:disabled` states; contrast risks.
Findings format: `file:line | issue | proposed fix`.

### Stage 2 — Compose (orchestrator only)

The token canon and the shell are the load-bearing walls. If the run changes
`:root` tokens, dark-theme overrides, or `panel.css` shell rules, do it
yourself, by hand, before any stylist runs — stylists build on the canon, so
it must be settled first. Update TOKENS.md in the same change if the canon
moved.

### Stage 3 — Style (fan-out)

Partition the in-scope CSS into disjoint file sets — two agents must never
touch the same file. A proven full-suite split:

- **A** `side-panel/modules/sentinel/sentinel.css` (largest single file)
- **B** `referrals` + `capacity` + `activity` + `trends` module CSS
- **C** `slots` + `submissions` + `condor` + `knowledge` module CSS
- **D** `reception` + `sweep` module CSS + `pop-out/pop-out.css`
- **E** `options/options.html` (embedded styles) + `sentinel-options/options.html`
  + `content-scripts/triage-lens/options.css`
- **F** `sidebar/sidebar.css` + `content-scripts/triage-lens/hud.css`
  (**self-contained token rule applies** — see TOKENS.md §Injected surfaces)
- **G** `visualiser-core.html` embedded styles (NHS palette is intentional —
  polish, don't re-brand; it must stay print-friendly)

Each stylist gets: the verbatim contents of `STYLIST.md` and `TOKENS.md`
(quote them in the prompt — subagents can also read the files), the survey
findings for its files, and an explicit list of files it owns. Remind each:
conservative refinement, no class renames, no layout restructuring, no
Prettier reformat of whole files.

### Stage 4 — Verify (non-negotiable)

1. `node .claude/skills/ui-design/screenshot.mjs` — renders the side panel,
   options page, and visualiser drop-zone headlessly (Playwright Chromium +
   a `chrome.*` shim) in light and dark, writing PNGs to `/tmp/ui-design/`.
   **Read every PNG.** You are the art director: look for broken layout,
   invisible text, washed-out chips, anything that reads "off". A change you
   haven't seen rendered is not done.
2. If Chromium isn't installed: `npx playwright install chromium`.
3. The harness only exercises static shell + first-paint module CSS; module
   content that needs live `chrome.*` data won't render — that's expected.
   Judge what does render; reason carefully about the rest from the CSS.
4. `npx eslint .` and `npx prettier --check` **on the files you touched only**.
5. `npm test` — the full suite. CSS/HTML are untested, so failures mean you
   strayed into pinned JS (see constraints in TOKENS.md) — revert that file.

### Stage 5 — Land

Per `CLAUDE.md`: bump `manifest.json` (patch for a polish pass, minor for a
visual-language change), add a CHANGELOG entry describing the *design intent*
(not a file list), commit, push to the designated session branch. Never
auto-merge; UI changes are reviewed by Dave looking at the actual panel.

## Hard constraints (from bitter experience)

- **Never touch** `content-scripts/triage-lens/content.js` — three tests pin
  its exact content (`test-prescribing-flags.js`, `test-triage-defaults.js`,
  `test-snapshot-bridge.js`). Its UI lives safely in `hud.css`.
- **Never touch** either `defaults.json` for styling reasons.
- CSS and HTML are test-free and safe to edit; module `.js` render code may
  be edited for class/markup changes but prefer CSS-only.
- Both themes, all three sizes (`zoom` handles size — don't fight it), and
  `data-colorblind` must survive every change. Light theme is the default and
  the most-used; dark is not the design target, it's a peer.
- The visualiser keeps its NHS-aligned palette (it prints / exports to PDF).
- Don't import new fonts or external assets without explicit say-so: this is
  an MV3 extension, CSP applies, and JetBrains Mono via Google Fonts is the
  single existing exception.

## What NOT to do

- No layout re-architecture (nav stays top, strips stay global) unless the
  user explicitly asks for structural redesign.
- No decorative animation. Motion is feedback, ≤200ms, and always wrapped in
  `@media (prefers-reduced-motion: reduce)` opt-outs per TOKENS.md.
- No trend-chasing (glassmorphism, neumorphism, gradients-as-decoration).
  The aesthetic is *instrument*, not *landing page* — see DOCTRINE.md.
- Never dim, shrink, or de-emphasise clinical alert states (red/amber chips,
  strips, RAG pills) for aesthetic reasons. Alert salience is a safety
  property. If an alert looks "too loud", it's correct.

## Files

```
.claude/skills/ui-design/
├── SKILL.md         ← this pipeline
├── DOCTRINE.md      ← the aesthetic: principles, taste, references
├── TOKENS.md        ← canonical tokens, component recipes, constraints
├── STYLIST.md       ← brief handed to each Stage-3 stylist subagent
└── screenshot.mjs   ← headless render harness (both themes → /tmp/ui-design/)
```
