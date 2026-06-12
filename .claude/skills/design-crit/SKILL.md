---
name: design-crit
description: Orchestrated single-surface design crit-and-improve loop for the Medicus Suite UI. Renders the REAL surface in multiple data states (mocked Medicus API), fans out three critics with different lenses (art director on pixels, token/code surveyor on CSS+markup, fresh-eyes GP persona on screenshots only), synthesizes their findings into settled rulings, implements via one stylist brief, and verifies with before/after screenshots. Use when the user asks to critique, review, improve, or "be critical of" a specific tab/module/page's UI — e.g. "overlook the slots page UI as an expert designer". For suite-wide token polish use ui-design (Atelier) instead; this skill is the deep loop for ONE surface.
---

# Design crit — single-surface critique → improve loop

You are the orchestrator (the art direction is ultimately yours). The
authority docs are `.claude/skills/ui-design/DOCTRINE.md` and `TOKENS.md` —
read both before anything else. The bar is unchanged: Linear / Stripe /
Raycast quality, as a clinical *instrument*.

Non-negotiables that survive every crit, regardless of what critics say:
**alert amber/red salience is never reduced**, and **user-facing
functionality the user explicitly asked for is never deleted** — it may be
re-homed, demoted, or made collapsible, but the orchestrator flags any such
judgement call to the user prominently in the final report.

## The pipeline

### 1 · Render the truth (before-shots)

Critics must judge pixels, not CSS in the abstract. Use
`.claude/skills/design-crit/harness.mjs` (storage-seedable chrome shim +
Playwright interception of `*.api.england.medicus.health` so modules render
with realistic data). Write a small states file importing the harness, copy
it to `<repo>/.tmp-shots.mjs`, run from the repo root, delete after.

Capture the surface's full state space, one PNG each, into a dedicated dir
(e.g. `/tmp/ui-design/<surface>-review/`):

- **calm/resting** (light AND dark — dark is judged on its own terms)
- **alerting/threshold-tripped** (if the surface has alert states)
- **empty / zero-data**
- **every interactive mode** (an editor open, a row expanded, a popover up)
- error/no-config state if reachable

Fixture data should mirror realistic practice numbers (not 1-2-3 toy data)
— critics catch density and alignment problems only at real volumes.
Playwright setup if missing: `npm install --no-save playwright@1.56.1`
(matches the preinstalled chromium build; the CDN is egress-blocked).

### 2 · Fan out three critics, in parallel, read-only

Three lenses, deliberately different inputs so their agreements mean
something:

| Critic | Model | Inputs | Brief |
|---|---|---|---|
| **Art director** | opus | DOCTRINE + TOKENS + the PNGs (subagents CAN Read images) | Hostile crit: hierarchy (what does the eye hit first, is that clinically right), rhythm/alignment, type voice casting, component quality, state differentiation, dark theme. Ranked findings, capped (~12), each as WHAT / WHY it hurts / concrete FIX referencing tokens. Demand a verdict paragraph: what's good + the single biggest move. |
| **Token/code surveyor** | sonnet | TOKENS + DOCTRINE + the module's CSS and render-producing JS | `file:line | issue | fix`, severity-tagged, grouped: token drift, missing `:hover/:focus-visible/:active/:disabled`, accessibility (keyboard operability of EVERY interaction, title-attr-only data, contrast at small sizes, emoji in chrome, aria/live-region gaps), consistency/dead CSS, density/radius semantics. Verified line refs only. |
| **Fresh-eyes persona** | haiku | The PNGs ONLY — no code, no canon | "A UK GP at 7:59am who has never seen this screen": what did you read first, what would you misread, what can't you figure out how to do, what looks broken. Per-screenshot bullets + a ranked top-5 confusion list. "I don't know what X means" is the most valuable output. |

Tell every critic: do NOT modify files. The convergences between the three
(same finding from different lenses) are your priority list.

### 3 · Synthesize and RULE (orchestrator only — never delegated)

Merge findings. For each: **adopt**, **adapt** (state how), or **overrule
with a written reason** (e.g. "raw hexes mirror Reception's sanctioned
decoration palette — cross-suite consistency wins"; "critic misread the
screenshot — the state already uses the accent triad"). Verify any factual
claim you doubt against the source before adopting — fresh-eyes personas
sometimes hallucinate numbers off screenshots; check arithmetic claims
yourself. Convergent findings outrank any single critic's pet issue.

Classic convergences to expect (all found in the v3.60.4 Slots crit):
duplicate data shown twice fighting for authority; decorative colour
spending the alert palette ("amber as wallpaper"); abandoned empty states;
split/duplicated controls; keyboard-unreachable custom widgets; 8px/grey
text carrying load-bearing data.

### 4 · Implement via ONE stylist brief (sonnet)

Write the settled rulings as a lettered decision list (A, B, C…) with exact
class names, token names, and behavioural requirements — the brief states
"the crit is settled; do not re-litigate". Constraints to include verbatim:
tokens only; the surface's sanctioned raw-hex exceptions if any; never
reduce alert salience; don't touch manifest/CHANGELOG (orchestrator versions
at the end); run prettier/eslint/`npm test` (ALL suites) before committing;
ONE commit, no push, no PR.

### 5 · Verify like the art director (orchestrator)

- **Check the repo state directly — do not trust the agent's report.**
  Known failure mode: implementation agents sometimes stall and spawn a
  duplicate worker; two variants of the same change can land (one committed,
  one in the working tree). `git log`/`git status`/`git diff` first; if two
  variants exist, reconcile by hand — watch for class names renamed in one
  file but not its pair, and double-rendered elements (e.g. a chevron in
  both markup and CSS `::after`).
- Re-shoot the SAME states as step 1 (after-shots) and Read every PNG.
  Specifically re-test every interactive mode — the
  re-render-during-event-bubble bug class (`closest()` on a detached node
  closing an overlay) only shows up when you actually click things in the
  harness.
- `npx eslint .`, prettier on touched files, `npm test` all green.

### 6 · Ship and report

Patch version bump (a crit pass is polish per Atelier's versioning rule —
keeps the safety docs aligned at the current minor), CHANGELOG entry
describing the design intent (cite that it came from a multi-critic review),
commit, push. NO merge and NO PR unless the user says so. Final report to
the user: before/after screenshots via SendUserFile, the convergent sins,
your rulings INCLUDING what you overruled and why, and a clearly flagged
list of judgement calls they may want reversed (with the one-liner to
reverse each).

## Files

```
.claude/skills/design-crit/
├── SKILL.md      ← this pipeline
└── harness.mjs   ← reusable shim+mock-API screenshot rig (see its header)
```

Related: `.claude/skills/ui-design/` (Atelier — suite-wide token canon and
polish pipeline; consult its TOKENS.md/DOCTRINE.md always, use its
screenshot.mjs for static-shell-only checks).
