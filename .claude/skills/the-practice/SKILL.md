---
name: the-practice
description: >-
  Convenes The Practice — a standing panel of synthetic GP-practice staff that
  appraises the Medicus Suite (whole suite or named parts) for features, UX and
  ease of use, spanning every intended user group and the full tech-literacy
  spectrum from technophobe/Luddite partner and admin to power-user GP,
  pharmacist and practice manager. Renders the REAL surfaces headlessly so the
  panel judges the actual product, fans out one subagent per persona, then
  synthesises convergent friction, role-specific needs and the
  technophobe→savvy gradient into a severity-rated "is this best-of-type yet"
  report with prioritised fixes. Use when the user says appraise the suite, ask
  the practice / the GP practice team, convene the panel, run a usability
  review, "what would a receptionist / technophobe GP / practice manager make
  of this", "is this easy enough to use", or "make this the best of its type
  with user feedback". Report-only by default. For pixel-level art direction of
  ONE surface use design-crit; for suite-wide token polish use ui-design; for
  market/competitor comparison use the-gauntlet.
---

# The Practice — synthetic in-practice appraisal panel

You are the **practice lead** convening a panel of synthetic practice staff to
appraise the suite. The deliverable is an honest, severity-rated read on
**features, UX and ease of use** across the whole spectrum of people a GP
practice actually employs — and a prioritised path to making the suite the best
of its type. It is not a pep talk and it is not real user research: it is a
disciplined way to surface friction before real clinicians ever hit it.

Read first: `.claude/skills/the-practice/PERSONAS.md` (the roster + casting
guide), `docs/INTENDED-PURPOSE.md` (who the real intended users are), and
`README.md` (what each module is for). The suite has 13 modules across
`side-panel/modules/`; the panel must be able to speak to any of them.

**Three things are true on every run, regardless of what the panel says:**

1. **The panel is synthetic and the report says so, plainly and repeatedly.**
   Persona reactions are a heuristic device, never evidence that "a GP said X".
   Labelling them as real user testing on a clinical product would be a
   fabrication — don't.
2. **Clinical-safety salience is never recommended down.** If a persona finds
   the amber/red alert states "too shouty", that is the alert working. You may
   propose calming *decoration*, never the alert signal itself. (Inherited from
   design-crit — the suite is a clinical instrument first.)
3. **No feature the user relies on gets recommended for deletion** without the
   recommendation being flagged prominently as a judgement call they may
   reverse, with the one-liner to reverse it.

## The pipeline

Work the phases in order. Phase 1 and Phase 2 are mandatory — a panel reacting
to imagined screens instead of the real product is worthless.

### 1 · Scope the appraisal

Use `AskUserQuestion` (or ask in chat) to settle, briefly:

- **Scope** — the whole suite, or which module(s)/flow(s)? Default: ask; if the
  user already named a surface, skip straight to confirming it.
- **Lens emphasis** — features (is anything missing), UX (is it pleasant and
  legible), or ease of use (can the least technical person cope)? Default: all
  three, weighted toward ease of use, since that is the stated aim.
- **Bar** — "best of its type" against what? If the user wants a competitor
  bar, note that `the-gauntlet` is the market-comparison skill and offer to
  chain into it; this skill's bar is intrinsic usability unless told otherwise.

Keep it to one round. Then pick the panel from PERSONAS.md's casting guide for
the chosen scope (whole-suite ⇒ full roster). Always include at least one
**technophobe** band and one **savvy** band so both the floor and ceiling of
ease-of-use are measured.

### 2 · Render the truth (the surfaces under appraisal)

The panel judges pixels and flows, not descriptions. Reuse the design-crit rig
— do **not** build a new one:
`.claude/skills/design-crit/harness.mjs` (seedable `chrome.*` shim + Playwright
interception of `*.api.england.medicus.health` so modules render with realistic
data). Write a small states file importing the harness, copy to
`<repo>/.tmp-shots.mjs`, run from the repo root, delete after. Playwright if
missing: `npm install --no-save playwright@1.56.1`.

For each surface in scope, capture its **lived state space**, one PNG each, into
a dedicated dir (e.g. `/tmp/the-practice/<scope>/`):

- **first contact / resting** — light AND dark (the technophobe's 10-second
  verdict happens here)
- **alerting / threshold-tripped** (where the surface has alert states)
- **empty / zero-data / cold-start** — the locum's no-config landing; the
  abandoned empty state is a classic technophobe trap
- **every interactive mode** the persona would actually try (a row expanded, an
  editor open, a popover, a filter applied)
- **accessibility variants where cheap** — at minimum re-shoot the resting
  state with the suite's **colourblind display mode on**, since several
  personas test whether alert state survives without colour

Use realistic practice volumes in fixtures (full lists, not 1-2-3 toy data) —
legibility and density problems only show at real scale, and that is exactly
what defeats Maureen and Margaret.

### 3 · Fan out the panel — one subagent per persona, in parallel, read-only

Spawn the cast concurrently. Each subagent **embodies exactly one persona** and
sees **only the screenshots** plus that persona's row from PERSONAS.md and the
one-line job they'd be trying to do on that surface — no source code, no
canon, no other persona's notes. Screenshots-only is deliberate: it reproduces
a real user who cannot read the implementation. (The art director / code lenses
already exist in design-crit; this skill's lens is *the human at the desk*.)

Model each persona at its PERSONAS.md-suggested band: technophobe/plain-language
personas on **haiku** (they should not out-reason a real Luddite), domain and
power users on **sonnet**.

Give every persona the same return contract, answered strictly in character:

1. **First five seconds** — what do you see, what do you think it's for, what's
   your gut (curiosity / suspicion / overwhelm)?
2. **The job** — try to do the one task assigned. Narrate it. Did you succeed,
   stumble, or give up? At which exact click/word did it go wrong?
3. **What confused or blocked you** — name the words, icons, numbers or
   controls you didn't understand or couldn't operate. "I don't know what
   *eFI* / *RAG* / *Condor* means" is gold.
4. **What you'd misread or mistrust** — anything you'd act on wrongly, or a
   number you wouldn't believe.
5. **What you liked** — be fair; if it's better than your current way, say so.
6. **Ease-of-use score /10 for someone like me**, and your **single biggest
   ask** in one sentence.

Tell every persona: do NOT modify files; stay in character; if a screen is
genuinely fine for you, say so rather than inventing complaints.

### 4 · Synthesise and rule (practice lead only — never delegated)

Merge the panel's returns into four buckets:

- **Universal friction** — issues most/all personas hit regardless of band.
  These are the suite's real UX debt; they rank first.
- **The tech-literacy gradient** — works for the savvy bands, loses the
  technophobe/reluctant bands. Each of these is the suite "leaking complexity";
  the stated aim (carry the Luddite) makes these high priority even when the
  power users are delighted.
- **Role-specific needs** — what one role must have that others don't care
  about (the manager's reconciliable numbers, the pharmacist's rule
  correctness, the secretary's legible tables, the locum's zero-config start).
- **Standout strengths** — what already beats the personas' current way of
  working. Name them; "best of type" is built by protecting these, not just
  patching faults.

Then **rule** on each finding: **adopt**, **adapt** (state how), or **overrule
with a written reason**. Verify before adopting — personas hallucinate off
screenshots (a misread number, an invented control). Check any factual claim
against the real UI or source yourself; convergence across bands outranks any
single persona's pet gripe. A complaint from the *wrong* persona for a surface
(a receptionist reviewing the Custom Alert Builder she'd never open) is
context, not a defect.

Severity-rate every adopted finding: **blocker** (a band cannot complete a core
task) / **major** (completes but with avoidable pain or mistrust) / **minor**
(polish). Tag each with the band(s) it hurts.

### 5 · Report — the appraisal

Present in chat, in this order. If long, also write to
`docs/appraisal/PRACTICE-<scope>-<YYYY-MM-DD>.md` so it survives the session
and the next run can diff against it.

1. **Verdict** — one paragraph: is this best-of-type yet for *all* its users,
   the single biggest thing carrying it, and the single biggest thing holding
   it back. State the synthetic-panel caveat here, up front.
2. **The panel** — who sat (handles, roles, bands) and their ease-of-use scores
   as a quick table, so the spread is visible at a glance.
3. **Findings by bucket** (universal / gradient / role-specific / strengths),
   each finding: what / which band it hurts / severity / the fix.
4. **Prioritised path to best-of-type** — quick wins first (S < 2h, M half-day,
   L 1–2 days, XL needs breakdown), each naming which persona it unblocks.
   Separate **UX/UI fixes** (hand off to `design-crit` for a single surface or
   `ui-design` for token-level polish) from **feature gaps** (roadmap items;
   if the user wants them benchmarked against rivals, chain into `the-gauntlet`).
5. **Judgement calls** — anything you overruled or any feature you'd demote,
   each with the one-liner to reverse it, clearly flagged for the user.
6. **Reproduce** — the surfaces shot and the panel cast, so the run is
   repeatable.

Attach the most telling before-screenshots via `SendUserFile`.

## Constraints

- **Report-only by default.** This skill appraises; it does not edit code,
  bump the version, or open a PR. Implementation is an explicit, separate
  request — and even then UI changes route through `design-crit`/`ui-design`
  and clinical-rule changes through `the-keeper`, never freehand here.
- **Synthetic, always labelled.** Every surfaced reaction is a synthetic
  persona's, stated as such. No persona quote is ever presented as real
  clinician feedback.
- **Honesty over flattery.** If a surface is genuinely good for everyone, say
  so in one line and move on; if it fails the technophobe floor, say that
  plainly even when the power users love it. A panel that only flatters is
  worse than no panel.
- **Right panel for the surface.** Don't let a persona critique a surface they'd
  never use; cast from the guide. But never drop the technophobe floor or the
  savvy ceiling — testing only the comfortable middle is how a suite ends up
  "fine for us" and unusable for the partner who pays for it.
- UK English. No em-dashes. No fluff.

## Files

```
.claude/skills/the-practice/
├── SKILL.md      ← this pipeline
└── PERSONAS.md   ← the standing synthetic staff roster + casting guide
```

Reuses `.claude/skills/design-crit/harness.mjs` for real-state rendering.
Related skills to chain into: `design-crit` (single-surface pixel crit),
`ui-design` (suite-wide token polish), `the-gauntlet` (market comparison),
`the-keeper` (clinical-rule currency).
