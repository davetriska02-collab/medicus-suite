# The Practice — whole-suite appraisal — 2026-06-14

> **This panel is synthetic.** Every reaction below is from a structured fictional
> persona, not a real clinician. It is a heuristic device for surfacing UX and
> feature gaps cheaply — **not** user research, and no line here is evidence that
> "a GP said X". Treat findings as hypotheses to verify, which is how they are
> rated. Rendered from the real product (46 screenshots of the actual modules in
> light/dark/alerting/empty/colourblind states via the design-crit harness).

## 1 · Verdict

The suite is on a genuine best-of-its-type trajectory and — importantly — **no
band was fully locked out of a core task**. Every persona, technophobe to power
user, completed their job, which is rare for a tool this dense. The single thing
carrying it is **clinical-safety honesty**: the "No alert ≠ everything is up to
date" caveat, the empty-monitoring state that names the rules it ran ("25 drug
rules · 61 QOF indicators") instead of going blank, the `CUSTOM` tags and the
rule-currency footer. The domain users (pharmacist, nurse) noticed and rewarded
all of this. The single biggest thing holding it back is **leaked complexity**:
unexplained clinical codes (`DM019`, `AST007`, `BP002`, "triple whammy", `RAG`,
`DMARD`, `PPI`) with no tooltip, plus a first-run setup checklist that dominates
whichever tab you land on. These hit the technophobe and non-clinical bands
hardest and pull an otherwise-strong product down to a 6 for them. Fix the
glossary and the first-run clutter and the floor rises a full point or two
without touching the ceiling.

## 2 · The panel

| # | Handle | Role | Band | Ease-of-use /10 |
|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner | technophobe | 6 |
| 2 | Maureen Castle | Medical secretary | technophobe | 6 |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | 6 |
| 4 | Chloe Danvers | Receptionist / care navigator | savvy-consumer, low clinical | 6.5 |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | 8 |
| 6 | Dr Sam Okonkwo | Locum GP (cold) | pragmatist | 5 |
| 7 | Dr Priya Nair | GP registrar | savvy | 7 |
| 8 | Janet Briggs | Practice manager | reluctant-but-capable | 7 |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | 7 |
| 10 | Dr Geoff Pellew | GP partner / tinkerer | power user | 7 |

Spread 5–8, mean ≈ 6.6. The ceiling (daily pragmatist, power user) is delighted;
the floor (cold locum, technophobe trio) is the work.

## 3 · Findings by bucket

### Universal friction (most/all bands)

| # | Finding | Hurts | Severity | Fix / ruling |
|---|---|---|---|---|
| U1 | **Unexplained clinical codes & jargon** — `DM019`, `AST007`, `BP002`, "triple whammy", `RAG`, `DMARD`, "Triage Load" — no tooltip, legend or expansion anywhere. | 1,2,3,4,7 (both ends of the band) | **major** | **Adopt.** Add a hover/tap glossary on every code + custom badge. Even savvy Priya can't tell a national QOF code from a locally invented one. |
| U2 | **First-run setup checklist dominates every module.** The "GET SET UP" card sits above module content on whichever tab you open; Priya hit it *inside* Trends and thought she'd broken something. | 2,6,7,8 | **major** | **Adopt.** Auto-collapse to a thin strip once the practice code is detected; don't re-render it over module bodies. Route to design-crit. |
| U3 | **"Triage Load / Triage monitor not configured" reads like a broken tile** mid-screen. | 1,5,7 | **minor** | **Adopt.** Make unconfigured-optional features visually distinct from errors; demote, don't alarm. |

### The tech-literacy gradient (works for savvy, loses the floor)

| # | Finding | Hurts | Severity | Fix / ruling |
|---|---|---|---|---|
| G1 | **Codes block action for non-clinical staff.** Chloe (care navigator) sees `DM019`/`AST007`/triple-whammy on the Reception status pill during a live call and can't tell if they bear on *this* call — she'd interrupt a GP rather than guess. | 4 (and 2) | **major** | **Adopt.** On non-clinical surfaces, plain-language the status pill or suppress clinical codes the navigator can't action. (Clinical salience stays; this is decoration/labelling only.) |
| G2 | **Empty ≠ broken is ambiguous on non-monitoring surfaces.** Sam can't tell "No sessions today" = genuinely empty vs not-configured vs can't-reach-Medicus. (Note: the *monitoring* empty state does this *brilliantly* — see strengths.) | 6 | **major** | **Adopt.** Give Slots/Capacity/etc. the same self-describing empty state Sentinel already has. |
| G3 | **Cold-start gates on practice code.** Four Today cards show "No practice code configured" for the cold locum. Auto-detect from an open Medicus tab exists, but isn't obvious when no tab is open. | 6,1 | **major** | **Adapt.** Auto-detect already exists — make it automatic and loud, and make the unconfigured state say "open a Medicus tab" rather than just greying out. |

### Role-specific needs

| # | Finding | Hurts | Severity | Fix / ruling |
|---|---|---|---|---|
| R1 | **Wrong-patient legibility risk (Sentinel).** The waiting-room list and the per-patient monitoring panel sit together; the disambiguating "Sentinel checks the record you open, not this list" is small grey print. A rushing GP could read patient A's alerts while consulting patient B. | 5 (safety-relevant, all clinical) | **major** | **Adopt.** Raise salience: a hard, unmissable banner when the open record doesn't match. This *increases* a safety signal (permitted) — the prominent NHS/DOB banner already mitigates partly. |
| R2 | **Silent false-negative invisibility (pharmacist).** From the screens you cannot distinguish "no alert because all is well" from "no alert because the drug name never substring-matched the rule". Lithium carbonate shows, but Raj can't confirm Priadel/Camcolit/Liskonum are covered. | 9 (safety-critical) | **major** | **Adopt.** Show the *resolved match list* per fired alert ("matched: methotrexate 2.5mg tablets") and make the all-clear state explicit: "X meds parsed · matched vs Y rules · 0 fired". Brand-completeness itself routes to **the-keeper**. |
| R3 | **Composite indices aren't reconcilable.** Practice Pressure `52/100` (PPI) and "Cap 27/0" are black boxes; Janet won't put `52/100` to partners, Geoff wants to tune the weighting. (Condor does show *some* working — "56 requests vs 27 slots".) | 8,10 | **major** | **Adopt.** A "how is this calculated?" tooltip on every composite score, screenshot-able for a partners' meeting. |
| R4 | **Referrals filters live below the fold and are small.** Maureen can find 2WW but must scroll past the setup card and hunt small pale chips. | 2,8 | **minor** | **Adopt.** Lift PRIORITY/STATUS chips up beside the date range; enlarge. Route to design-crit. |
| R5 | **No CSV on Trends.** Every other data surface (Referrals, Submissions, Activity) exports; Trends — the dataset Geoff most wants for QI — does not. | 10,8 | **minor** | **Adopt.** Add CSV export to Trends, matching the existing pattern. |
| R6 | **Monitoring digest truncates ("+3 more below").** Eileen feared a hidden red item. In fact the full chip list renders below and the "4 red · 3 amber" totals are in the header, so nothing is truly hidden. | 3 | **minor** | **Adapt** (partial overrule — see §5). Echo any red item into the digest so the count and the visible lines agree. |

### Standout strengths (protect these — this is the best-of-type core)

- **Clinical-safety honesty.** "No alert ≠ everything is up to date" + "Verify in Medicus" praised independently by the nurse, pharmacist and registrar. Rare and right. Do not dilute.
- **Self-describing empty monitoring state** ("25 drug rules · 61 QOF indicators") — Eileen and Sam both singled this out; it solves the "all-clear vs didn't-check" problem *on that surface*. Make it the template for R2/G2.
- **Ctrl+K command palette** — Tom, Priya and Geoff all loved it; it also surfaces overflow tabs and teaches itself in onboarding.
- **Reception guided capture** — red-flags-first, plain-English, escalation-aware; Chloe and Priya both called it genuinely better than guessing/interrupting.
- **Today at-a-glance + colourblind survival** — threshold tags and red numbers read as a crisis dashboard in seconds; the "OVER THRESHOLD" *text* label means the alert survives the colourblind palette (Eileen, colourblind, confirmed she reads the words not the dot).
- **Transparency furniture** — `CUSTOM` tags and the dated rule-currency footer let the pharmacist triage trust instantly.
- **Power surface** — five rule types + live medication-match preview + import/export; genuinely dark dark-mode; visible date ranges + CSV. Geoff and Raj both rated the bones right.
- **Referrals priority tiles** — big, colour-coded Routine/Urgent/2WW counts; even the two technophobes read them at a glance.

## 4 · Prioritised path to best-of-type

**Quick wins (S, < 2h each) — biggest floor-raise for least effort**
- Shared **glossary tooltip** for clinical codes/badges → unblocks Chloe, Margaret, Priya, Eileen (U1/G1). *(design-crit for styling.)*
- **Auto-collapse the setup checklist** once practice code is detected → Maureen, Janet, Priya, Sam (U2). *(design-crit.)*
- **CSV export on Trends** → Geoff (R5). *(feature, but small — matches existing export util.)*
- **Lift/enlarge Referrals filter chips** → Maureen (R4). *(design-crit.)*
- **Demote "not configured" optional tiles** so they don't read as broken → Margaret, Tom (U3). *(design-crit.)*

**Medium (M, ~half-day)**
- **Calc-transparency tooltips** on PPI / Practice Pressure / composite indices → Janet, Geoff (R3). *(feature.)*
- **Self-describing empty states** for Slots/Capacity/etc., copying Sentinel's pattern → Sam (G2). *(feature + design-crit copy.)*
- **Louder practice-code auto-detect** + "open a Medicus tab" empty copy → Sam, Margaret (G3). *(feature.)*

**Large (L, 1–2 days) — safety-led, do these properly**
- **Wrong-patient mismatch banner** in Sentinel (hard, unmissable when open record ≠ context) → Tom (R1). *(feature; clinical-safety.)*
- **Resolved match-list per alert + explicit all-clear audit line** → Raj (R2). *(feature.)* Pair with **the-keeper** to verify brand-list completeness (the substring-match silent-miss risk is real and already documented in `CLAUDE.md`).

**Routing:** UX/UI items (U2, U3, G1 copy, R4, glossary styling, empty-state copy) → **design-crit** for the single surface or **ui-design** for token-level polish. Feature gaps (R1, R2, R3, R5, G2, G3) → roadmap; if you want them benchmarked against rival GP-augmentation tools, chain into **the-gauntlet**. Any clinical-rule/brand change → **the-keeper**, never freehand.

## 5 · Judgement calls (reversible)

- **R6 partially overruled.** Eileen's fear that "+3 more below" hides a red item is largely unfounded — the full chip list renders below the digest and the red/amber totals sit in the header. Adopted only the polish (echo red items into the digest), not a redesign. *Reverse if* real testing shows clinicians act off the brief card alone without scrolling — then it becomes a blocker.
- **Margaret's "put waiting room + alerts on one screen" adapted, not adopted.** Today (operational) and Monitoring (per-patient) are deliberately separate, and merging them would *worsen* the wrong-patient risk Tom flagged (R1). Kept separate; improve the cross-link instead. *Reverse by* combining the cards if the wrong-patient banner (R1) lands first and removes the safety objection.
- **No alert salience reduced anywhere.** Margaret found "OVER THRESHOLD" shouty-without-context; the ruling is to *add* the missing context (what the threshold is), never soften the red. *(Inviolable — clinical instrument first.)*
- **No feature recommended for deletion.**

## 6 · Reproduce

- **Surfaces shot (46 PNGs, `/tmp/the-practice/whole-suite/`):** today (loaded/alerting/coldstart/cb, light+dark), sentinel (loaded light+dark, empty), reception (status light+dark, capture, coldstart), slots (loaded light+dark, alerting, empty), referrals (loaded light+dark, filtered, empty), condor (loaded light+dark+cb, empty), submissions/activity/capacity/trends (loaded light+dark), knowledge (loaded light+dark, empty, search), options (light/dark/cb), alert-builder (light/dark/overview), visualiser (landing), shell (nav light+dark, Ctrl+K palette).
- **Rig:** `.claude/skills/design-crit/harness.mjs` (seedable `chrome.*` shim + Playwright interception of `*.api.england.medicus.health`), Playwright 1.56.1.
- **Cast:** full 10-persona roster from `.claude/skills/the-practice/PERSONAS.md`, one subagent each, screenshots-only, technophobe/plain-language bands on haiku, domain/power users on sonnet.
- **Limit:** the Visualiser was captured at its upload landing only — it renders its dashboard solely from a parsed Medicus EPR PDF and ships no demo-data path, so the analytics tabs (eFI, PINCER, trends) were not panel-tested. Worth a dedicated design-crit run once a seam for seeded data exists.
