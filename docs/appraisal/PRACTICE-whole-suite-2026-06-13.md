# The Practice — whole-suite appraisal

**Date:** 2026-06-13 · **Suite version:** 3.60.14 · **Scope:** whole suite
(13 modules) · **Lenses:** features + UX + ease of use, weighted to ease of use
· **Bar:** intrinsic usability (no competitor benchmark this run)

> **This is a synthetic panel, not user research.** Every reaction below comes
> from a role-played persona reacting to real rendered screenshots of the
> suite. It is a structured heuristic for surfacing friction cheaply, not
> evidence that any real clinician said anything. Treat the findings as
> hypotheses to act on, not as field data.

---

## 1 · Verdict

For its **daily clinical power users the suite is already very good** — the
Today command centre and the Slots breakdown drew the highest marks and genuine
"this saves me time" reactions, and the clinical-safety framing (the Sweep's
"no alert ≠ monitoring complete", the dated rules footer) is better than most
commercial tools. But it is **not yet best-of-type for everyone who has to
touch it**, because the same screens that delight the savvy bands lose the
technophobe and non-clinical bands: the secretary, the receptionist and the
nurse scored it 3–4/10 while the salaried GP and pharmacist scored 7–8. The
single thing carrying the suite is the **Today screen answering the two
questions a GP actually has (who's waiting, what's left) in one glance**. The
single biggest thing holding it back is **ambiguous liveness** — across the
clinical, manager and power-user bands, people could not tell whether a number
was live, stale, or silently broken, and on the Monitoring tab that ambiguity
becomes a patient-safety concern (a populated waiting list sitting above a "NO
MEDICUS TAB ACTIVE" notice reads as "assessed, all clear" when nothing has been
checked).

---

## 2 · The panel

| # | Persona | Role | Tech band | Ease-of-use |
|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner | technophobe | 6/10 |
| 2 | Maureen Castle | Medical secretary | technophobe | **3/10** |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | **4/10** |
| 4 | Chloe Danvers | Receptionist / care navigator | savvy-consumer, low-clinical | **3/10** |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | **8/10** |
| 6 | Dr Sam Okonkwo | Locum GP | pragmatist | 5 cold / 8 configured |
| 7 | Dr Priya Nair | GP registrar | savvy | 5/10 |
| 8 | Janet Briggs | Practice manager | reluctant-capable | 5/10 |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | **7/10** |
| 10 | Dr Geoff Pellew | GP partner / power user | savvy | 5/10 |

The spread is the story: floor 3 (non-clinical / technophobe), ceiling 8 (daily
clinical users). The suite is tuned for the comfortable middle-to-top and leaks
complexity at the bottom.

---

## 3 · Findings

Severity: **blocker** (a band cannot complete a core task) · **major**
(completes but with avoidable pain or mistrust) · **minor** (polish).

### A · Universal friction (hit across bands — fix first)

| # | Finding | Hurts | Sev | Fix |
|---|---|---|---|---|
| A1 | **Ambiguous liveness everywhere.** "Updated 08:47" reads as a clock, not a freshness signal; nobody can tell live vs stale vs silently-failed. Tom and Geoff want "last sync Xs ago"; Eileen and Raj want a "monitoring live / offline" badge; Janet won't trust a 0 she can't confirm is real. | all | **major** | One shared freshness component: relative time ("synced 12s ago") + an explicit state dot (live / stale / offline) on every data surface, especially Monitoring. |
| A2 | **"Go to Medicus and come back" empty states feel like dead-ends.** Referrals ("navigate to the referrals page"), Reception/Sentinel/Trends ("open a patient record") all blocked the non-technical bands, who read them as broken rather than as the suite mirroring the active Medicus tab. | Maureen, Chloe, Eileen, Sam | **major** | Reframe these empty states to explain the mirror model in one line ("This shows whichever patient you have open in Medicus — open one to populate") rather than an imperative that looks like an error. |
| A3 | **Action prompts clutter read-only dashboards.** "Triage not configured", "No sweep run", "Choose tabs" sit inside what users read as a glance-only dashboard and nag every visit. | Margaret, Tom, Priya | minor→major | Demote configuration nudges to a single dismissible setup affordance; suppress them during clinic hours (Tom's ask). |

### B · The tech-literacy gradient (works at the top, loses the bottom)

| # | Finding | Hurts | Sev | Fix |
|---|---|---|---|---|
| B1 | **Most of the suite is invisible.** Only Today + Slots show as labelled tabs; the other ~11 modules hide behind a ">" chevron and Ctrl+K. The power users found Ctrl+K (and liked it); the technophobes never will. Priya: "the majority of the suite is invisible." | Margaret, Maureen, Priya | **major** | Make the overflow chevron carry a count + label ("+11 tabs"); after setup, a persistent one-line "press Ctrl+K for all tabs" hint. Keep the power-user "choose your tabs" default, but don't let it hide the door. |
| B2 | **The setup checklist dominates first-run on every tab, and its wording alarms the cautious.** "1 of 3 essentials" over 5 visible rows (two of them RECOMMENDED/OPTIONAL) confused Sam; "essentials" + the red-looking nag made Margaret think it was broken. Priya, by contrast, loved it. | Margaret, Sam (Priya +) | **major** | Keep the checklist (it helps newcomers) but: soften "essentials", make the counter match the visible mandatory rows, and make "Dismiss" a genuine permanent dismiss so it never re-nags a returning technophobe. |
| B3 | **Clinical/operational jargon unexplained.** "Condor" appears nowhere on the Condor screen (heading says "Practice Pressure"); "Condor PPI" reads as proton-pump inhibitor to a clinician; "structured history", "pathway", "Monitoring →" chip, "Day Score" all stalled the non-clinical/newcomer bands. | Chloe, Priya, Sam | **major** | Rename or gloss in-place: tab tooltip "Condor — practice pressure dashboard"; expand "PPI" to "Pressure Index" on the gauge; one-line plain-English subtitles on Reception pathways for care navigators. |
| B4 | **Legibility floor.** Small grey type and dense date controls defeat the eyesight-limited secretary; the Referrals range silently defaults to a **full year**, so her "30d" instinct fights a manual year range she'd fiddle with instead of using the quick button. | Maureen, Margaret | major | Larger base type / bigger touch targets on the data tables; default Referrals to a sane recent window (e.g. 30d) and make the quick-range buttons the obvious primary control. |

### C · Role-specific needs

| # | Finding | Role | Sev | Fix |
|---|---|---|---|---|
| C1 | **Numbers that don't reconcile — and at least one verified on-screen contradiction.** The Condor "Submission velocity" panel shows **"Total today: 115"** while its *own* chart caption reads "No submissions recorded today", the Today's Activity row shows 0, and the Submissions tab shows 0. (Verified on screen; may be a harness-fixture artifact — **needs a code check before it ever reaches a partners' meeting**.) Janet won't quote any figure she can't tie to one source. | Practice manager | **major** | Single sourced "submissions this period" figure reused across Condor + Submissions with a visible date range + timestamp; investigate the 115-vs-0 divergence in code. |
| C2 | **Composite index contradicts its loudest sub-signal.** Condor gauge reads "GREEN · 25/100" directly above a red "Over capacity · 46 requests · 30 slots". Three personas flagged it; nobody can see the formula. | Manager, power user, trainee | **major** | Show the PPI inputs on tap (what feeds the score), and make an over-capacity sub-state nudge the headline gauge or carry a visible caveat so green never sits atop red unexplained. |
| C3 | **"No alert" can't be distinguished from "not assessed".** The Monitoring waiting list renders above "NO MEDICUS TAB ACTIVE" with no visual break — a populated list reads as screened-and-clear. Eileen (nurse) and Raj (pharmacist) independently rated this their top concern. | Nurse, pharmacist | **major (clinical-safety UX)** | A persistent, unmissable monitoring-state banner ("Sentinel has NOT assessed these patients — open the record") visually separating the waiting-room list from any assessed state. **Do not reduce the existing amber/red salience — add the not-assessed state, don't soften the alert state.** |
| C4 | **Rules scope is undisclosed.** The dated rules footer ("drug rules updated 2026-06-04") earns trust, but Raj can't see *what* it covers; he can't calibrate the safety net cold. | Pharmacist | minor | Add scope near the version stamp: "covers N monitoring rules across M drug categories", linkable to the list. |
| C5 | **No way to get data out.** No CSV/copy on Slots, Condor, Submissions. Geoff's top ask; Janet needs it for board packs. | Power user, manager | major (feature) | Copy-to-clipboard / CSV export on every data surface. |

### D · Standout strengths (protect these — best-of-type is built on them)

- **Today as a command centre** — both of a GP's morning questions answered in
  one glance, counts legible across a desk. Tom 8/10, "zero extra clicks".
- **Slots** — by type *and* by clinician in a 400px panel; the density the
  power user and the salaried GP both praised.
- **Empty states that teach** — Capacity's "Welcome" with a worked preset
  example (Priya's "best empty state"), Knowledge's pre-content disclaimer
  (right clinically and legally for a trainee).
- **Clinical-safety honesty** — the Sweep's "Supplementary tool only · no alert
  ≠ monitoring complete" and the dated rules footer were cited by Raj, Sam and
  Eileen as the things that build appropriate trust. Rare and valuable.
- **Cold-start grace + auto-detect** — graceful "No practice code · set up now",
  and the Ctrl+K reopener; Sam went 5→8 once the code auto-detected.
- **Power-user respect** — Ctrl+K palette and "your tab choice is never
  overwritten by practice-pushed config" both landed with Geoff.

---

## 4 · Prioritised path to best-of-type

Effort: **S** <2h · **M** half-day · **L** 1–2 days · **XL** needs breakdown.

### Quick wins (do first)

1. **(S, UX) Reframe the "open Medicus" empty states** as the mirror model, not
   an error — unblocks Maureen, Chloe, Sam. [A2]
2. **(S, UX) Default Referrals to a recent range; promote the quick-range
   buttons** — unblocks Maureen. [B4]
3. **(S, copy) Soften "essentials", fix the counter, make Dismiss permanent** —
   unblocks Margaret, Sam. [B2]
4. **(S, copy) Gloss the jargon in place** (Condor tooltip, "PPI" → "Pressure
   Index", pathway subtitles) — unblocks Chloe, Priya. [B3]
5. **(S, UX) Label the overflow chevron with a count + persistent Ctrl+K hint** —
   unblocks Margaret, Priya. [B1]

### Mid (the trust layer)

6. **(M, UX) Shared freshness/liveness indicator** on every data surface —
   serves everyone; this is the highest-leverage single change. [A1]
7. **(M, clinical-safety UX) Monitoring "not assessed" banner** separating the
   waiting list from any screened state — unblocks Eileen, Raj. Route through
   `design-crit` so alert salience is provably preserved. [C3]
8. **(M, data) Investigate the Condor 115-vs-0 submissions divergence** and
   unify on one sourced figure — unblocks Janet. [C1]
9. **(M, UX) Show Condor PPI inputs and reconcile green-over-red** — unblocks
   Janet, Geoff, Priya. [C2]

### Larger (feature gaps — roadmap)

10. **(L, feature) CSV / copy export on every data surface** — Geoff, Janet. [C5]
11. **(S, feature) Rules-scope disclosure** by the version stamp — Raj. [C4]

**Handoffs:** the UX/UI items (1–7, 9) are `design-crit` single-surface passes
(Monitoring, Condor, Referrals, the setup card) or `ui-design` token work for
the legibility floor (B4). The data/feature items (8, 10, 11) are engineering
roadmap. If you want the export/feature gaps benchmarked against rival GP
dashboards before building, chain into `the-gauntlet`.

---

## 5 · Judgement calls (flagged for you to reverse)

- **Overruled: "let me search/paste a patient in Reception/Referrals" (Maureen,
  Chloe).** The suite is read-only against the *active* Medicus tab by design
  and intended-purpose (`docs/INTENDED-PURPOSE.md`); adding patient search would
  change its data-access model. I adapted their ask into A2 (explain the mirror
  model) instead of building search. *To reverse: if you do want in-panel
  patient lookup, that is a deliberate scope expansion — say so and it goes on
  the roadmap as its own item.*
- **Overruled: "get rid of the setup checklist" (Margaret).** It is a net win
  for newcomers (Priya, Sam). Kept it; fixed the wording and made Dismiss stick
  (B2). *To reverse: hide the checklist entirely by default and surface it only
  under Ctrl+K.*
- **Caveat on C1's "115":** verified on-screen, but it surfaced under synthetic
  fixtures and may be a harness artifact rather than a live bug. I have *not*
  asserted it is a production defect — only that the contradiction is real on
  the rendered surface and warrants a code check.

---

## 6 · Reproduce

- **Surfaces shot** (`/tmp/the-practice/whole-suite/`, via
  `.claude/skills/design-crit/harness.mjs`): all 13 modules in light; Today /
  Sentinel / Submissions / Referrals in dark; Today / Slots / Sentinel in
  colourblind mode and in cold-start (no practice code); plus setup-dismissed
  "steady" states for the data modules. Fixtures used realistic volumes (9
  waiting, 5 clinicians, mixed slot types).
- **Panel cast:** the full 10-persona roster from
  `.claude/skills/the-practice/PERSONAS.md`, each given screenshots only + their
  role and a single job, at their suggested model band.
- **Caveats:** Sentinel/Trends/Visualiser draw their richest content from an
  open Medicus patient record (content-script fed) and were assessed in their
  pre-patient and structural states, not with live drug/QOF chips. A deeper
  per-surface pass on Monitoring with a fixtured patient is worth a dedicated
  `design-crit` run.
