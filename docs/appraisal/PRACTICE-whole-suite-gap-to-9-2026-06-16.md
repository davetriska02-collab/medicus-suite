# The Practice — whole-suite appraisal: the gap to a 9 — 2026-06-16

> **This panel is synthetic.** Every reaction below is from a structured
> fictional persona, not a real clinician. It is a heuristic device for
> surfacing UX and feature gaps cheaply — **not** user research, and no line
> here is evidence that "a GP said X". Findings are hypotheses, rated and
> verified against source where they bear on a decision. Rendered from the real
> product at **v3.98.1** (20 screenshots of the actual modules in
> light/dark/cold-start/empty/colourblind states via the design-crit harness).

## 1 · Verdict

The daily-driver core is already strong: **cold-start onboarding, the Slots tab,
and the reconcilable Submissions tracker** are best-in-class and the pragmatist,
locum and registrar bands all rewarded them (7–8). The suite is *not* yet a 9
across the board, and the gap is one convergent theme plus a floor problem.

The convergent theme: **composite and "all-clear" states must explain their own
provenance and never contradict themselves.** The single biggest thing holding
the product back is verified, not cosmetic: the Condor **Practice Pressure index
shows "GREEN · 25/100" on the same screen as "Over capacity (115 requests vs 50
slots)".** Three independent reconciling roles — the salaried GP, the manager and
the power user — each said this self-contradiction would make them stop trusting
the number. The floor problem is the eyesight/discoverability band: letter-spaced
small-caps and pale grey strain tired eyes, and there is no per-tab "what is this"
help for the technophobe and the trainee.

The single biggest thing carrying it: the honest, self-describing states — the
"nothing is broken, the suite works as soon as your practice code is set"
cold-start, the dated rule-currency footer, and Slots/Submissions that a manager
can reconcile to the source count.

**Important honesty caveat on the scores:** several low scores reflect
**cold/unconfigured render states**, not the deployed product. Chloe judged
Reception with pathways shipped-disabled; Maureen judged Referrals in its
"waiting for the report" state; Raj and Eileen judged Sentinel **idle (no patient
open)** — and the loaded Sentinel panel already does much of what they asked for
(see R1). In a configured, in-use practice these surfaces carry data and would
score higher. The findings that survive verification are the ones to act on.

## 2 · The panel

| # | Handle | Role | Band | Ease-of-use /10 | The one thing for a 9 |
|---|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior partner | technophobe | **6** | Darker/crisper load-bearing text; context on the 70/45 numbers |
| 2 | Maureen Castle | Medical secretary | technophobe | **4** | Show the referrals list on landing, don't make me open a report first |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | **5** | A persistent "last sweep 08:14 · N checked · 0 alerts" stamp |
| 4 | Chloe Danvers | Receptionist | savvy-consumer / low-clinical | **3** | Don't leave me locked out — say it's a one-time admin setup |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | **7** | Never show GREEN while over capacity; surface pressure on Today |
| 6 | Dr Sam Okonkwo | Locum (cold) | pragmatist | **6** | Label practice-setup tabs "not your job as a locum" |
| 7 | Dr Priya Nair | Registrar | savvy | **7** | A per-tab "?" with two lines: what it is / what to do first |
| 8 | Janet Briggs | Practice manager | reluctant-but-capable | **5** | Hard "as at HH:MM" + two labelled lines, not one contradictory dial |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | **5** | An explicit "checked N · matched M · overdue K" all-clear line |
| 10 | Dr Geoff Pellew | Partner / tinkerer | power user | **6** | Export + editable weightings for the composite indices |

Spread 3–7, mean ≈ 5.4. The ceiling (daily GP, registrar) sits at 7; the floor
(receptionist, secretary, nurse, pharmacist) is depressed partly by cold-render
states (see caveat) and partly by the real findings below.

## 3 · Findings by bucket

### Universal friction

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| U1 | **Composite contradicts itself: "GREEN · 25/100" beside "Over capacity (115 vs 50 slots)".** *Verified in `condor.js:63` — `ppi = scoreA*0.3 + scoreB*0.25 + scoreC*0.25 + scoreD*0.2`; capacity (scoreD) is weighted only 20%, and band is GREEN below 40, so a 2.3× capacity breach stays green.* The footnote explains it but in small amber text nobody reads. | 5, 8, 10 (the three reconcilers) | **major** | **Adopt — the single biggest lever.** Never show a GREEN headline while a hard sub-component (capacity over limit) is breached: floor the band to at least AMBER, and/or lead with the labelled component line ("Demand 115 · Capacity 50 · Over capacity") with the composite as a secondary, explained figure. *Clinical-salience rule cuts the other way here — this is raising a signal, which is permitted.* |
| U2 | **Unconfigured-optional cards read as broken / half-finished, mid-dashboard.** "Triage Load — not set up" on Today; "Task Inbox not configured", "Day Score available after 17:00", and "Clinician Workload · total 0 · consults 0" on Condor. They eat space and look like errors or a dead feed. | 1, 5, 8, 10 | **major** | **Adopt** (prior U3, partly persists). Demote unconfigured-optional to a thin, dismissible strip; visually separate three states — *not set up (optional)* vs *no data today* vs *can't reach Medicus*. The "0/0" workload panel needs an explicit state (loading / configure / genuinely zero). → design-crit. |
| U3 | **Letter-spaced small-caps + pale grey defeat the eyesight floor.** Margaret misread "DEMAND" as "DERRAND" and couldn't read "OPTIONAL" / the setup links. *Verified: the label is "Demand Today" (`today.js`) — the misread is the letter-spaced uppercase font, not a typo.* | 1, 2, 6 | **major** | **Adopt the legibility signal, overrule the typo.** Lift contrast on load-bearing copy and reconsider letter-spacing on the caps labels for tired eyes. → ui-design. |

### The tech-literacy gradient

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| G1 | **Cold/unconfigured surfaces leave non-power roles stuck and don't say "this is a one-time practice setup".** Reception "pathways switched off" (Chloe could not start a capture); Referrals "waiting for the report" (Maureen could not find 2WW); Capacity "create your first preset" (Sam). Each is a legitimate state that reads as "I can't do my job." | 2, 4, 6 | **major** | **Adopt (adapted).** Add a one-line banner on practice-level-setup surfaces: "This needs a one-time setup by your practice manager — nothing for you to do." Auto-trigger / deep-link where possible (Referrals). *Chloe's literal "remove the admin gate" is overruled* — pathways ship disabled by design behind a disclaimer (governance). → design-crit copy. |
| G2 | **No discoverable per-tab help; key jargon still opaque to the floor.** "QOF", "Triage Load", "Sentinel" (the tab is labelled "Monitoring"), the "14" badge, the unlabelled top icon strip; Trends and Sweep are "black boxes". Glossary tooltips exist (v3.79) but a non-hovering user finds no help *entry point*. | 1, 7 | **major** | **Adopt.** A persistent "?" per tab with two plain lines (what this is / what to do first); give Trends a self-describing resting state instead of one sentence. → design-crit. |
| G3 | **"No alert / no sweep run" provenance is ambiguous (safety-relevant).** "No alerts logged today" + "No sweep run this session" cannot be told from "ran, all clear". *Verified: the sweep already persists a last-run timestamp (`sweep.js:54`, TTL 2h) and Today reads it (`today.js:252`) — the infra exists; the gap is surfacing and unifying it.* | 3, 9 | **major** | **Adopt (adapted — copy/surfacing, not new infra).** Unify into one line: "Last sweep 08:14 · 32 checked · 0 alerts"; make "never run today" visually distinct from "run, clear". → design-crit. |

### Role-specific needs

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| R1 | **Explicit all-clear audit: "checked N · matched M · overdue K · unmatched P".** Raj and Eileen cannot tell "drug checked and in date" from "drug never matched a rule". | 9, 3 (safety) | **major (partly already shipped)** | **Adapt — verify-corrected.** Sentinel *already* surfaces the silent-false-negative mode: `renderUnmatchedMedsSection` (`sentinel.js:1886` — "unlisted brand → no alert", excluded meds annotated), an `evaluatedAt` timestamp, and per-chip matched-problem. **The panel judged the IDLE render only.** Remaining work: add a one-line **headline count** at the top of the *loaded* panel and a compact at-a-glance indicator. Brand-completeness itself → **the-keeper**. |
| R2 | **Composite indices: no export, no visible/editable weighting, no hard timestamp on COPY FIGURES.** Janet can't defend "25/100" or get an "as at" time; Geoff can't audit or tune the weighting or get a Condor time-series. | 8, 10 | **major** | **Adopt.** Quick: put "as at HH:MM" in the COPY FIGURES output and disclose the weighting (0.3/0.25/0.25/0.2) in the ⓘ popover. Feature: editable weightings in settings + Condor history CSV. |
| R3 | **Referrals default date window confuses.** Defaulted 18 May → 16 Jun when Maureen wanted "this month". | 2 | **minor** | **Adopt.** Default to month-to-date (or label the window). → design-crit. |

### Standout strengths (protect — this is the best-of-type core)

- **Cold-start onboarding** — "Nothing is broken; the suite works as soon as your
  practice code is set; the steps below are optional", greyed dependent steps,
  "reopen via Ctrl+K". Sam and Priya both singled it out. Rare and right.
- **Slots tab** — AM/PM split, per-clinician breakdown, CSV, live timestamp.
  Tom, Sam and Geoff independently named it the standout daily surface.
- **Reconcilable Submissions** — Janet verified 70+45+12+12+12 = 151 and that
  Condor independently shows "Total 151"; CSV + COPY FIGURES respect how she works.
- **Clinical-safety honesty** — dated rule-currency footer with counts, "the
  waiting room is not a monitoring result", the unmatched-meds silent-failure
  surfacing, "no alert ≠ all clear". The domain users rewarded all of it.
- **Knowledge** — the "can be wrong / verify locally" caveat + clean taxonomy.
- **Colourblind survival** — the band's *word* ("GREEN", "Over capacity") persists
  when the colour shifts; the alert state does not depend on hue.

## 4 · Prioritised path to a 9

**Quick wins (S, < 2h) — biggest trust- and floor-raise for least effort**
1. **Condor: floor the band** — never GREEN while capacity is over limit; lead
   with the labelled component line. *Unblocks Tom, Janet, Geoff — the #1 lever.*
   (design-crit + small logic change in `condor.js`.)
2. **Hard "as at HH:MM" in COPY FIGURES + weighting disclosed in the ⓘ popover.**
   *Janet, Geoff.* (design-crit.)
3. **Unify the sweep/all-clear provenance line on Today**; distinguish "never run"
   from "run, clear". *Eileen, Raj.* Infra already exists. (design-crit copy.)
4. **Demote unconfigured-optional cards** to thin strips; separate not-set-up /
   no-data / unreachable. *Margaret, Tom, Janet.* (design-crit.)
5. **"One-time practice setup — ask your manager" banner** on Reception / Capacity
   / Triage-Monitor cold states. *Sam, Chloe.* (design-crit copy.)
6. **Contrast lift + reconsider letter-spaced caps** on load-bearing labels.
   *Margaret, Maureen.* (ui-design.)

**Medium (M, ~half-day)**
7. **Per-tab "?" help** (two lines: what it is / what to do first) + a
   self-describing Trends resting state. *Priya, Margaret.*
8. **Sentinel loaded-panel headline audit count** ("8 meds · 3 matched · 0
   overdue · 1 unmatched"), extending the existing unmatched-meds work. *Raj,
   Eileen.*
9. **Referrals auto-load / clearer prompt + month-to-date default.** *Maureen.*

**Feature (L, 1–2 days)**
10. **Editable composite weightings in settings + Condor history CSV.** *Geoff.*

**Routing:** UX/UI (U2, U3, G1–G3 copy, R3, items 4–7) → **design-crit** for a
single surface or **ui-design** for token-level polish. Logic/feature (U1 band
floor, R1 audit headline, R2 export/weighting) → roadmap. Any clinical-rule or
drug-brand change → **the-keeper**, never freehand. For a market bar rather than
this intrinsic-usability bar, chain into **the-gauntlet**.

## 5 · Judgement calls (reversible)

- **"DERRAND" typo — overruled.** Verified the label is "Demand Today"; kept the
  underlying legibility signal. *Reverse if* a real typo is found in the rendered
  string.
- **Chloe's "remove the Reception admin gate" — overruled, adapted to copy.**
  Pathways ship disabled behind a disclaimer by design (governance/clinical
  safety). Fix the empty-state copy and signpost the manager, don't drop the gate.
  *Reverse only if* the governance model changes.
- **Raj/Eileen "the audit line is missing" — corrected.** Partly already shipped
  (unmatched-meds section + evaluatedAt); the panel saw the idle render only.
  Adapted to "surface a headline count + at-a-glance indicator", not "build anew".
- **Low cold-render scores (Chloe 3, Maureen 4, Raj 5, Eileen 5)** reflect
  unconfigured/idle states, not the deployed product. Flagged, not treated as
  defects of the configured suite.
- **No clinical-alert salience reduced. No feature recommended for deletion.**

## 6 · Reproduce

- **Surfaces shot (20 PNGs, `/tmp/the-practice/whole-2026-06-16/`):** today
  (light/dark/cold-start/colourblind), slots, capacity, sentinel (light/dark,
  idle), submissions, activity, referrals (light/dark), condor (light/colourblind),
  trends, reception (light/dark), knowledge, sweep, options.
- **Rig:** `.claude/skills/design-crit/harness.mjs` (seedable `chrome.*` shim +
  Playwright interception of `*.api.england.medicus.health`), Playwright 1.56.1.
- **Cast:** full 10-persona roster; one subagent each, screenshots-only;
  technophobe/plain-language bands on haiku, domain/power bands on sonnet.
- **Limits:** Sentinel was rendered **idle only** (the loaded per-patient panel,
  fed by the content script, was not fixtured) — R1 is verify-corrected against
  source, not the screenshot. Referrals/Reception/Capacity/Activity rendered in
  their cold/unconfigured states because no bridge data was fixtured; this is
  realistic for first contact but not for a configured practice. The Visualiser
  (PDF-driven) and the in-page Triage Lens were out of scope for this panel.
```
