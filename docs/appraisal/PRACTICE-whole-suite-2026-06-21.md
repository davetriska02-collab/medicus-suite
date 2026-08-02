# The Practice — whole-suite appraisal — 2026-06-21

> **This panel is synthetic.** Every reaction below is from a structured
> fictional persona, not a real clinician. It is a heuristic device for
> surfacing UX and feature gaps cheaply — **not** user research, and no line
> here is evidence that "a GP said X". Findings are hypotheses, rated and
> **verified against source or pixels** where they bear on a decision. Rendered
> from the real product at **v3.126.0** (30 screenshots of the actual modules in
> light / dark / cold-start / colourblind / large-text states via the
> design-crit harness, at realistic practice volume: 12 staff, ~37 task demand,
> 56 submission velocity, 30 free slots). Technophobe/plain-language bands run on
> haiku so they do not out-reason a real Luddite; domain/power bands on sonnet.

Scope: **whole suite** (13 side-panel modules). Lens: all three, weighted to
ease of use. Bar: intrinsic best-of-type usability (no competitor bar; use
`the-gauntlet` for a market comparison).

---

## 1 · Verdict

**Not best-of-type for *all* its users yet, but the daily-driver core is genuinely
strong and the worst blocker from the last whole-suite run is verified fixed.**
Condor no longer contradicts itself: it leads with "Demand 37 · Capacity 30 · At
capacity" and floors the band to AMBER instead of showing GREEN while over
capacity (verified, `condor.js:105`). The pragmatist GP, the registrar, the
pharmacist and the power user all rewarded the suite (7–7.5) and three of them
named the honest, self-describing states as the reason.

**The single biggest thing carrying it:** the honest states. Sentinel's idle
panel spells out "the waiting room above is not a monitoring result" and stamps a
dated rule-currency footer; the cold-start "Nothing is broken" checklist; the
Capacity worked-example empty state; Submissions as the one place the maths
visibly ties together. Three different bands credited these unprompted.

**The single biggest thing holding it back:** the suite still cannot hand a
**reconcilable single number** to the person who pays for it. On one Condor screen
"Demand 37" (medical+admin, for the pressure index) sits beside a velocity "Total
today 56" (all five task types) with no on-screen label reconciling them — the
manager could not pull a figure she would defend to the partners. That, plus a
persistent floor of small friction — a truncated "Setup: practice code re…"
banner on every tab, an unlabelled header icon row, and a Sentinel waiting-room
block that visually mimics a clinical alert — is the gap between "the power users
love it" and "the partner can use it".

**Honesty caveat on the low scores.** Three of the four lowest scores reflect
**cold/unconfigured render states, not the deployed product**: Maureen judged
Referrals in its "open the report once" state, Chloe judged Reception
shipped-disabled, and the manager's lowest tabs (Referrals, Capacity) were empty.
In a configured practice these carry data and would score higher. The findings
that survive that caveat are the ones ranked below.

---

## 2 · The panel

| # | Handle | Role | Band | Ease /10 | The one thing for a 9 |
|---|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner | technophobe | **5** | One plain-English "here's what needs you now" line on Today |
| 2 | Maureen Castle | Medical secretary | technophobe | **3** | A patient-name search on Referrals (cold-state caveat) |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | **5** | A ticked "checks complete" list I can trace to source |
| 4 | Chloe Danvers | Receptionist | savvy-consumer / low-clinical | **5** | Show the caller questions in-tab; explain "pathway" |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | **7** | One consistent waiting count; un-hedge the pressure verdict |
| 6 | Dr Sam Okonkwo | Locum (cold) | pragmatist | **6.5** | Say plainly whether the live data is confirmed for *this* practice |
| 7 | Dr Priya Nair | Registrar | savvy | **7.5** | Tooltips on every header icon; a worked-example Trends empty state |
| 8 | Janet Briggs | Practice manager | reluctant-but-capable | **4** | One labelled demand figure with "as at HH:MM" and a definition |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | **7** | Drill into the "27 drug rules" to see coverage, not just currency |
| 10 | Dr Geoff Pellew | Partner / tinkerer | power user | **7** | A cog on the Pressure gauge to tune inputs and band thresholds |

Spread 3–7.5, mean ≈ **5.7**. Ceiling (registrar, GP, pharmacist, power user) at
7–7.5; floor (secretary, manager) depressed partly by cold-render states (caveat
above) and partly by the real reconciliation finding below.

---

## 3 · Findings by bucket

### Universal friction (most/all bands)

- **U1 · Truncated "Setup: practice code re…" banner on every tab.** *Severity:
  major. Hurts: all bands (Sam, Priya, Margaret).* The persistent setup nudge is
  cut off mid-word on every single screen, so nobody can tell if it says
  "required", "recognised" or "re-check". It nags without informing. **Fix:**
  show the full status in plain words ("Practice code set ✓" or "Practice code
  needed — enter once"); never truncate a status line. Cheap.
- **U2 · Unlabelled header icon row.** *Severity: major. Hurts: all bands
  (Priya, Margaret).* The top strip carries a bare "15", a magnifier, two
  sun/gear glyphs and a chevron with no tooltips; nobody could say what "15"
  means. **Fix:** a `title=`/aria-label on every header control, and a "?"
  pop-over. Cheap.

### The tech-literacy gradient (works for the savvy, loses the floor)

- **G1 · No plain-English "what needs me now" line on Today.** *Severity: major.
  Hurts: technophobe (Margaret).* She can read the numbers (6 waiting, 23
  medical) but not what *action* they demand; after 10s of "am I a dashboard
  analyst?" she would close it and revert. The power users never hit this — they
  read dashboards natively. **Fix:** one sentence at the top of Today that names
  the single most urgent thing in words ("Longest wait 63m — consider bringing
  forward"). Recurring from prior runs.
- **G2 · Sentinel waiting-room block visually reads as a clinical alert.**
  *Severity: major. Hurts: nurse + pharmacist + registrar (Eileen, Raj, Priya —
  three-band convergence).* An amber-bordered card of patients colour-graded
  red/amber by minutes-waited, sitting under a header that says "Monitoring",
  reads as six monitoring flags. The honest disclaimer line mitigates but the
  visual hierarchy fights the words, and "small print loses on a Monday". **Fix
  (decoration only — this is NOT an alert being dimmed, it is a *non*-alert
  mis-styled as one):** give the waiting-room block a visibly non-clinical
  treatment (neutral border, a clock/"waiting" motif, not the amber alert
  border) so red-minutes can't be read as red-overdue.
- **G3 · Clinical/jargon words at the reception desk.** *Severity: minor
  (cold-state caveat). Hurts: receptionist (Chloe).* "Pathway" and a setup-gated
  tab give her nothing to act on; she'd interrupt a clinician. Partly the
  shipped-disabled state. **Fix:** when enabled, lead with the plain caller
  questions; gloss "pathway" in one line.

### Role-specific needs

- **R1 · The manager cannot pull one reconcilable demand figure.** *Severity:
  major. Hurts: practice manager (Janet); echoed by the GP (Tom).* **Verified:**
  on the Condor screen "Demand 37" (`condor.js:74`, medical+admin, for the
  pressure index) coexists with the velocity card "Total today 56" (all five
  task types) and Submissions' 56, with **no on-screen label** reconciling them —
  the "(medical + admin)" qualifier exists only in the CSV/copy export, not on
  the visible strip. One wrong-looking number poisons the tool for her. **Fix:**
  surface the "(medical + admin)" qualifier on the visible Demand strip, and a
  one-line "as at HH:MM" timestamp instead of "just now". Small.
- **R2 · "just now" is not a defensible timestamp.** *Severity: major. Hurts:
  manager (Janet).* Every freshness stamp says "updated · just now"; she needs an
  actual clock time and an "as at" cut-off to quote a morning figure. **Fix:**
  render the real HH:MM alongside the relative label.
- **R3 · Referrals is an audit view, not a patient finder.** *Severity: major
  (cold-state caveat). Hurts: secretary (Maureen).* She wants to type "Probert"
  and see one referral; the cold tab tells her to open a Medicus report first and
  offers no name search. Recurring role-mismatch. **Fix:** add an on-tab
  patient-name filter once data is loaded; consider loading on landing.
- **R4 · Sentinel proves rule *currency* but not *coverage*.** *Severity: major
  (feature gap). Hurts: nurse + pharmacist (Eileen, Raj — domain convergence).*
  "27 drug rules · 63 QOF indicators · updated 2026-06-20" reassures on vintage
  but is a dead-end count: neither can see *which* drugs are covered, so a silent
  false-negative (a monitored drug with no rule) is invisible — their exact
  failure mode. **Fix:** make the counts expandable into the list of covered
  drugs/indicators, so an "all clear" can't hide a missing rule. Feature, route
  to roadmap; rule content stays with `the-keeper`.

### Power-user ceiling

- **P1 · The Pressure index is shown but not tunable.** *Severity: major
  (feature gap). Hurts: power user (Geoff).* The card explicitly tells him a
  "weighted index" exists, then offers no control to set the Demand/Capacity
  inputs or the AMBER/RED band cut-offs — "you've shown me the lever and hidden
  it". **Fix:** a cog on the gauge exposing the thresholds. Feature.
- **P2 · No global export.** *Severity: minor. Hurts: power user (Geoff).*
  Per-card CSV is good (Condor, Activity, Submissions) but there's no
  one-click "export the lot". **Fix:** optional; low priority.

### Standout strengths (protect these)

- **S1 · Self-describing idle/cold states.** Sentinel's "the waiting room is not
  a monitoring result" + dated rule footer, the "Nothing is broken" cold-start,
  Capacity's worked-example empty state — credited unprompted by Eileen, Raj,
  Priya, Sam. This honesty *is* the product's signature; do not let a redesign
  flatten it.
- **S2 · Condor self-contradiction is fixed and the safety floor is honest.**
  Verified: never GREEN while over capacity, with the override captioned. Both
  reconciling bands accepted the *logic* (they want the *labels* tightened, R1,
  not the floor removed).
- **S3 · Alert state survives colourblind AND dark mode via text, not hue.**
  Geoff verified the word "AMBER", the wait-minutes and the counts are all
  spelled out, not colour-only — better than most NHS-facing kit.
- **S4 · Submissions reconciles + exports.** The one surface where the manager's
  maths tied together (5 categories → 56) with CSV. The template for R1.

---

## 4 · Prioritised path to best-of-type

**Quick wins (S, < 2h each) — UX, route to `design-crit`/`ui-design`:**
1. **U1** — stop truncating the practice-code banner; show full plain status.
   *(unblocks Sam, Priya, Margaret)*
2. **U2** — tooltips/aria-labels on every header icon + a "?" pop-over.
   *(unblocks Priya, Margaret)*
3. **R1 + R2** — put "(medical + admin)" on the visible Demand strip and a real
   "as at HH:MM" on every freshness stamp. *(unblocks Janet, Tom)*
4. **Condor dial polish** — colour the gauge arc to match the *floored* band so
   "38 on a green-looking arc · AMBER" stops fighting itself (decoration only;
   keep the floor). *(unblocks Tom, Geoff)*

**Half-day (M):**
5. **G2** — re-style the Sentinel waiting-room block as visibly non-clinical so
   it can't be misread as monitoring flags. *(unblocks Eileen, Raj, Priya)*
6. **G1** — one plain-English "what needs you now" line on Today.
   *(unblocks Margaret)*
7. **Trends empty state** — give it a Capacity-style worked example instead of one
   line in a void; resolve the Sentinel/"Monitoring"/"v0.5.1" naming wobble.
   *(unblocks Priya)*

**1–2 days (L) — feature gaps, roadmap (benchmark via `the-gauntlet` if wanted):**
8. **R4** — expandable rule-coverage drill-down on Sentinel. *(Eileen, Raj)*
9. **R3** — on-tab patient-name search / load-on-landing for Referrals.
   *(Maureen)*
10. **P1** — tunable Pressure-index inputs and band thresholds. *(Geoff)*

---

## 5 · Judgement calls (reversible)

- **Overruled — the "AMBER at index 38" hedge (Tom, Geoff).** This is the
  capacity safety floor working as designed (`condor.js:105`, never GREEN while
  over capacity), inherited from the v3.110.2 fix. Per clinical-salience policy I
  will not recommend the signal down; I adopted only the *decoration* (arc colour
  to match the floored band). *To reverse: treat it as a defect and unfloor the
  band — not advised.*
- **Downgraded — the "6 vs 5 waiting" contradiction (Tom, Janet).** The specific
  mismatch was injected by this run's fixtures (Today's WR fixture had 6 arrived,
  Condor's had 5). It is **not** a confirmed product bug. It does, however, expose
  a real structural fact: Today reads `/homepage/my-appointments` and Condor reads
  `embedded-overview` — two endpoints for "waiting room", so a production mismatch
  is *possible*. Logged as a **minor** structural risk to verify on live data, not
  a blocker. *To escalate: confirm whether the two endpoints can disagree in a
  real practice; if so, source both from one.*
- **No feature recommended for deletion.**

---

## 6 · Reproduce

- **Surfaces shot (30 PNGs, `/tmp/the-practice/whole-2026-06-21/`):** all 13
  modules resting light + dark; plus `today-cold`, `today-colourblind`,
  `today-large`, `condor-colourblind`. Practice code `a3f2b1`; realistic volume
  (12 staff; demand medical 23 / admin 14; velocity 56; 30 free slots; 6/5
  waiting). Loaded with data: Today, Slots, Submissions, Condor, Activity. Self-
  describing idle/cold (realistic first contact): Sentinel (idle, no patient),
  Referrals (pre-report), Capacity (no preset), Reception (shipped-disabled),
  Record + Trends (no patient open). Rendered via
  `.claude/skills/design-crit/harness.mjs`, Playwright 1.56.1.
- **Cast:** full 10-persona roster; one subagent each, screenshots-only, no
  source access, no cross-talk; technophobe/plain bands on haiku, domain/power on
  sonnet.
- **Verification:** R1 and the AMBER-floor confirmed against `condor.js`; the
  WR-count discrepancy traced to fixture inputs vs the two-endpoint design.
- **Diffs against:** `PRACTICE-whole-suite-ui-theming-2026-06-16.md` (v3.110.2).
  Verified-fixed/holding since: Condor self-contradiction (gone), Sentinel
  all-clear provenance footer (present and credited). Still open: the
  practice-code banner truncation, header-icon discoverability, jargon/plain-
  English to the floor, the demand-figure reconciliation (now a labelling gap,
  R1, rather than an outright contradiction).
- **Evidence gap to close next run:** fixture the loaded per-patient Sentinel and
  the configured Reception/Referrals so the floor scores aren't depressed by
  cold-render states; render `sentinel-colourblind` for the G2 misread on pixels.
```
```
