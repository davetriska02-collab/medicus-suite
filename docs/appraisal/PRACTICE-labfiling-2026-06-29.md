# The Practice — appraisal: Lab Results Auto-Filing (v3.138.x)

**Date:** 2026-06-29 · **Scope:** the new Lab filing module + injected "File all
normal" button · **Bar:** intrinsic usability across the tech-literacy spectrum.

> **This panel is synthetic.** The reactions below are a structured heuristic
> device (role-played personas reacting to real rendered screenshots), NOT real
> clinician feedback and NOT user research. Do not quote them as "a GP said X".

## Verdict

The feature's **bones are good and its honesty is its strongest asset** — every
persona, technophobe to power-user, praised the plain-English safety notice and
the fact it does not pretend to be autonomous. The single biggest thing carrying
it is that calm, irreversible-action-aware framing. The single biggest thing
holding it back is **the all-normal gate over-claiming**: the confirm dialog says
"the suite has confirmed every parameter is within normal limits", but the gate
reads numeric lab flags only — so cultures, free-text comments ("abnormal film"),
unflagged values and unmatched/wrong-patient reports can slip through as
"normal". The clinical-pharmacist persona reached this conclusion **from the
screenshots alone**, independently of the red-team reaching it from the code —
that convergence makes it the top fix. It is not best-of-type yet: it is
excellent for the power user and a jargon brick-wall for the technophobe partner.

## The panel

| Handle | Role | Band | Score | One-line |
|---|---|---|---|---|
| Dr Margaret Aldous | Senior GP partner | technophobe | **4/10** | Brick-walled at "Create from a screenshot with an LLM"; wants plain English / a test checklist |
| Sister Eileen Cobb | Practice nurse | reluctant | **5/10** | "Irreversible" leads too scary; "AI-drafted" alarming; wants to see the *hidden/failure* state, not just success |
| Dr Tom Hollis | Salaried GP | pragmatist | **7/10** | Loves the core flow + time saved; badges hard to parse fast; wants the commit mode shown in the dialog |
| Dr Sam Okonkwo | Locum GP | pragmatist (cold) | **3/10** | Cold-start is a doc panel not an empty state; feature invisible at point-of-use when unconfigured |
| Raj Patel | Clinical pharmacist | savvy+domain | **4/10** | The gate over-claims; suppress the button on non-numeric/flagged/free-text/unmatched results |
| Dr Geoff Pellew | GP partner / tinkerer | power user | **7.5/10** | Strong bones; internal-jargon field labels; wants profile export/import (already exists, hidden) |

## Findings by bucket

### Universal friction
- **U1 — Confirm dialog over-claims (major, clinical-trust).** "confirmed every
  parameter is within normal limits" implies clinical judgement the tool does not
  make. Reword to scope-accurate ("every numeric result the suite could read is
  within this profile's reference range — scan the values yourself"). Raj + Tom +
  red-team. The slow risk: by the fiftieth filing the GP stops reading and just
  clicks Confirm.
- **U2 — The gate fails OPEN on results it cannot reason about (BLOCKER,
  clinical-safety).** Cultures with growth, free-text comment lines, lab H/L
  flags, and unmatched (wrong-patient) reports can all score `none` and offer the
  button. Converged independently by Raj (screenshots) and the red-team (code,
  empirically reproduced). **Fix: suppress the button entirely on any
  non-numeric / lab-flagged / free-text / unmatched result, and show the
  suppression reason.**
- **U3 — Only the success state is visible (major).** Eileen + Sam: nothing tells
  a user when or why the button will NOT appear. Show a point-of-use "not offered
  because…" signal.

### Tech-literacy gradient (works for savvy, loses the floor)
- **G1 — "Create from a screenshot with an LLM" / "AI-drafted" jargon (major).**
  Brick wall for Margaret, alarming for Eileen ("which computer? has it seen my
  patients?"), fine for Geoff/Raj/Tom. Rename to plain English ("Build it
  automatically from a screenshot"), add a one-line tooltip, relabel "AI-drafted"
  → "auto-suggested — check before enabling".
- **G2 — Badge row conflates status and mode (minor→major).** REVIEWED /
  + PATIENT MESSAGE / CONFIRM-THEN-FILE read as three equal things; Tom can't
  parse them fast, Geoff/Raj can't tell status from mode. Differentiate visually
  and in wording.
- **G3 — Internal-jargon field labels (minor).** "rowSelector (advanced)",
  "openControlText" are DOM words, not filing-screen concepts (Geoff). Rename to
  filing-screen language; keep the truly advanced ones behind a toggle.

### Role-specific
- **R1 — Locum/cold-start (major for locums).** No empty-state guidance ("no
  profiles yet — your practice's regular GP sets these up, not you"), and the
  results page is silent when unconfigured so the feature is invisible at the
  point of use. Add an empty-state line + a point-of-use ghost hint.
- **R2 — Profile export/import (minor, discoverability).** Geoff wants it for
  practice-wide sharing/backup. **It already exists** (Options → Lab filing
  export/import, suite backup envelope) — it just isn't visible from the module.
  Surface a link/mention.
- **R3 — Show commit mode in the confirm dialog (minor→major).** Tom: "You are in
  CONFIRM mode — this files the result. Cannot be undone." Also: the patient-
  message clipboard copy should be visible/disable-able and only happen on a
  successful file (also red-team F5 — currently copies the patient first name even
  in manual/cancel paths).
- **R4 — Audit log too thin (minor).** Geoff (governance) + red-team: enrich with
  timestamp, patient/task identity, result type, profile, outcome.

### Standout strengths (protect these)
- The plain-English, irreversible-action-aware **safety notice** — universally
  praised; "whoever wrote that understood the clinical stakes" (Tom).
- The confirm dialog **enumerates the analytes** rather than a generic "are you
  sure" — the right level of friction (Tom, Raj).
- The **profile name in the button** ("…City Hospital — routine bloods (FBC /
  U&E / LFT)") — no ambiguity about which profile fires (Tom).
- **Clean, scannable cards** and badge density (Geoff, Sam, Tom); **dark mode
  legible** (Geoff).
- **Manual default + "you stay in control"** framing; the review-then-enable gate.
- **Colourblind:** enabled/reviewed state is carried in text labels (REVIEWED,
  On), so it survives colour loss (Eileen verified on the colourblind render).

## Rulings
- U2 **adopt (blocker)** · U1 **adopt (major)** · U3/R1 **adopt (major)** ·
  G1 **adopt (major)** · G2/G3/R3/R4 **adopt (minor→major, route wording/visual
  parts through design-crit)** · R2 **adapt** (exists; improve discoverability).
- Clinical-safety salience was never recommended down: U1/U2 make the alert
  *more* conservative, never less. Nothing recommended for deletion.

## Prioritised path to best-of-type
- **Quick wins (S, <2h each):** U1 dialog wording · G1 de-jargon LLM/AI labels ·
  R3 show commit mode in dialog · R1 empty-state + cold-start copy · R2 surface
  export/import.
- **Medium (M, ~half-day):** U2 suppress-and-explain gate for
  non-numeric/flagged/free-text/unmatched (shared with the red-team blocker) ·
  U3 point-of-use "not offered because…" hint · R4 enrich the audit log.
- **Design-crit pass (separate):** G2 badge status-vs-mode, G3 field labels — a
  single-surface pixel crit once the copy/logic fixes land.

## Reproduce
Surfaces shot (headless, `design-crit/harness.mjs`, light+dark+colourblind):
cold-start, profile list, add-profile form, LLM-helper expanded →
`/tmp/the-practice/labfiling/`. Panel: personas 1, 3, 5, 6, 9, 10 from
`.claude/skills/the-practice/PERSONAS.md`. The injected button + confirm dialog
were given to personas as verbatim text (that surface renders into the live
Medicus page and cannot be screenshotted headlessly).
