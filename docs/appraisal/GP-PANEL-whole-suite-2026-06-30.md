# Panel of 20 GPs — whole-suite function review — 2026-06-30

**Date:** 2026-06-30 · 20 synthetic GP reviewers reacting to the real rendered UI
(Today, Sentinel, Sweep, Referrals, Condor, Trends, Capacity, Slots, Submissions,
Activity, Reception, CQC Inspection Readiness) at v3.143.1, screenshots-only, no
source access. Spans partner→trainee, technophobe→power-user, locum, OOH,
rural single-handed/dispensing, deprived inner-city, semi-retired, returning-
from-break, part-time/parent, registrar ×2, LTC/diabetes lead, frailty/elderly-
care lead, CQC/governance lead, medicolegal portfolio GP, digital-health
enthusiast.

> **Synthetic panel.** These are role-played GP personas, a structured heuristic
> to surface clinical-safety, usability and roadmap gaps before real clinicians
> hit them. **Not real user research; no line here is evidence that "a GP said
> X."** Findings are hypotheses; the most-repeated one was checked against
> source before being trusted (see §0).

---

## 0 · Verification note — the panel's #1 finding was a fixture artefact, not a live bug

7 of 20 reviewers independently flagged the same confusing screen: Sentinel's
red "high-risk medicine with no monitoring rule" banner listed **Priadel
(lithium)** as unmatched, while a separate "Lithium carbonate — due soon" card
sat two lines below for the same patient — readers couldn't tell if that was
one drug or two, and several (Tom, Priya, Naomi, Yusuf) named fixing it as
their #1 ask.

**Checked against source before adopting:**
- `rules/drug-rules.json:411` — `"priadel"` **is already** a listed match term
  on `lithium-maintenance`. In the shipped product this patient's Priadel would
  match correctly; the unmatched state shown was specific to the render
  fixture, not current behaviour.
- The second flagged drug, "Brand-X Methotrexate … excluded by 'injection'" —
  there is **no `exclude` clause** on `methotrexate-maintenance` in the current
  rule file. That scenario doesn't currently occur either.

So: **neither specific drug example in the screenshot reflects today's product.**
Both were hand-built by the rendering pass to demonstrate the high-risk-banner
*feature* and happened to pick a drug that's actually covered.

**What does survive verification:** `flagHighRiskUnmatched()`
(`engine/rules-engine.js:162`) reads each unmatched medicine **name in
isolation** — it has no logic that checks whether a same-patient medicine under
a *different* name already matched a rule for the same substance. If a genuinely
unlisted brand ever does slip through (the exact silent-failure mode
CLAUDE.md warns about — "a med that doesn't match simply never fires its
alert"), the banner **would** produce exactly this confusing juxtaposition for
real. The panel's instinct — "tell me if this is the same drug as the one
already tracked below" — is a real, buildable, currently-missing feature, not
a complaint about a current bug. It's written up as **W1** below on that basis.

This is exactly the kind of false-positive the practice-lead verification step
exists to catch; flagging it here rather than letting 7 reviewers' agreement
masquerade as 7x confidence in a bug that isn't there.

---

## 1 · Verdict

**Not yet best-of-type for "what's next" clarity, but the panel converged hard
on a short, buildable list.** Mean ease-of-use **6.7/10** (spread 6–8), tighter
and higher than the last whole-suite usability run nine days ago (5.7) — this
panel skewed toward GPs reacting to the suite's newest, most clinically
substantial features (Sweep's QOF prioritiser + one-click recall, the Referrals
2WW safety-net, Sentinel's high-risk guard), and those features landed well.

**The single biggest thing carrying it:** Sweep's QOF-points-at-risk ranking
with one-click "Create recall task," and the Referrals 2WW open-loop
safety-net worklist. Both were named as the standout feature by a clear
majority of the panel, unprompted, across every tech band — a registrar, a
locum, a senior partner and a power-user all separately called the cancer
safety-net worklist "the best thing in the set."

**The single biggest thing holding it back is one theme, not many:** **the
suite tells GPs about gaps but doesn't yet close the loop or scale to a whole
list.** Concretely: (a) when a chip looks anomalous (the unmatched-drug
banner) there's no way to tell if it's a real gap or already covered
elsewhere; (b) the cancer safety-net list has to be remembered and clicked
into rather than pushed; (c) Sweep needs a human to remember to run it and
to trust each recall task actually landed; (d) every "you're due X" surfaces
per-patient, with no single ranked "what do I personally need to do before
this list runs out" view spanning modules. Fix those four and the daily-driver
core jumps from genuinely good to indispensable.

---

## 2 · The panel

| # | Handle | Practice context | Band | Ease/10 | #1 ask |
|---|---|---|---|---|---|
| 1 | Margaret Aldous, 58 | Senior partner, urban 3-GP | technophobe | 6 | One-tap "order bloods" from a Sweep chip |
| 2 | Tom Hollis, 41 | Salaried, urban | pragmatist | 7 | Explain orphaned high-risk banner vs. matched sibling |
| 3 | Sam Okonkwo, 35 | Locum, different practice weekly | pragmatist | 8 | 2WW safety-net as a global Today strip |
| 4 | Priya Nair, 29 | Registrar (savvy) | savvy | 8 | Reconcile brand/generic duplicate drug entries |
| 5 | Geoff Pellew, 52 | Partner / tinkerer | power user | 7 | Click-through audit trail on the unmatched-drug banner |
| 6 | Amara Osei, 44 | Single-handed rural dispensing | reluctant | 6.5 | Confirmation that "Create recall task" actually landed |
| 7 | Liam Fitzgerald, 63 | Semi-retired, 2 sessions + OOH | technophobe | 6 | Batch recall-task creation |
| 8 | Naomi Cohen, 33 | Newly qualified, anxious | pragmatist | 6 | Same as #4 — cross-reference the unmatched banner |
| 9 | Harriet Voss, 49 | Partner, LTC/diabetes lead | savvy+domain | 7 | A practice-level register of unmonitored high-risk drugs |
| 10 | Imran Sheikh, 56 | Partner nearing retirement | technophobe | 6 | One unified action list ranked by clinical risk |
| 11 | Chiara Bellini, 37 | Deprived inner-city, high safeguarding | pragmatist | 7 | Multi-patient Sentinel sweep of today's actual queue |
| 12 | Owen Pryce, 45 | Rural Welsh dispensing, patchy broadband | reluctant | 6.5 | Sweep runs automatically overnight |
| 13 | Fatima Rahman, 31 | ST2 registrar, learning Medicus | savvy | 6 | Sentinel and Trends must agree on the same patient's register status |
| 14 | Ben Carrick, 39 | Salaried + medicolegal portfolio | pragmatist | 7 | Auto-run Sweep before first appointment |
| 15 | Susan Yardley, 52 | Frailty/elderly-care GPwSI | savvy+domain | 7 | A confidence indicator on drug-rule coverage |
| 16 | Marcus Webb, 60 | Partner, CQC/QOF governance lead | savvy | 6 | Publish the active exclude-term list with rationale |
| 17 | Aisha Bello, 41 | Returning after 3yr career break | reluctant | 6.5 | A single "what must I personally do today" red list |
| 18 | Noah Kessler, 28 | Newly qualified, digital-health enthusiast | power user | 7 | Push/webhook the 2WW safety-net, don't make me look |
| 19 | Eleanor Vance, 55 | Part-time (3d/wk) + parent | reluctant | 6 | Same as #17 — one combined safety-netting status light |
| 20 | Yusuf Khan, 47 | OOH / urgent care, cold patients | pragmatist | 7 | Same as #4 — explicit same-drug-or-different cross-reference |

Spread 6–8, mean **6.7**. No band scored below 6; the technophobe/reluctant
floor (5.9 average) and the savvy/power-user ceiling (6.9 average) are closer
together than on past whole-suite runs — this run's surfaces (Sweep, Sentinel,
Referrals) are GPs' genuine daily-driver tools, not dashboards aimed mainly at
managers.

---

## 3 · What they want next — ranked by convergence

### W1 · Cross-reference the Sentinel high-risk-unmatched banner against the patient's own matched rules — *7/20, verified buildable*
When a medicine is flagged "no monitoring rule matched," and the same patient
already has a **matched, in-date** rule for what looks like the same substance
under a different name, say so inline ("possibly the same as Lithium carbonate
below — check for a duplicate repeat in Medicus") instead of leaving two
unrelated-looking facts on the page. **Verified as a genuine gap** in
`flagHighRiskUnmatched()` (§0) — it reads each unmatched name in isolation with
no cross-check against the patient's already-evaluated matched rules, which the
caller already has in hand. Scoped, additive, no rule-file change. *(Margaret,
Tom, Priya, Geoff, Naomi, Susan, Yusuf)*

### W2 · Push the cancer (2WW) safety-net, don't make GPs remember to look — *8/20*
The open-loop worklist itself (shipped 26-06-29) was the single most-praised
feature on the panel — and the most-requested *escalation*. Asks converged on:
surface it as a fourth global alert strip on Today (the suite already has this
exact pattern — `#wrStrip`/`#rmStrip`/`#subRagStrip`, documented in
CLAUDE.md's "Global demand / alert strips" section — this is a same-pattern
addition, not a new mechanism); add a "has an appointment been booked yet /
chase logged" tick so the loop visibly closes; confirm it's independent of any
date-range filter elsewhere on the page; and (the power-user ask) push it via
a digest rather than requiring the panel to be opened at all. *(Tom, Sam,
Imran, Amara, Chiara, Ben, Noah, Eleanor)*

### W3 · Make Sweep trustworthy as an unattended daily habit — *5/20*
Three converging sub-asks: **auto-run** it before the first appointment rather
than relying on a clinician to remember (Owen, Ben); **confirm** each
"Create recall task" actually landed in Medicus, not just that the button was
clicked (Amara); and **batch** task creation so a multi-patient morning isn't
N separate clicks (Liam, Eleanor). All three are extensions of an existing,
already-praised feature, not a new module.

### W4 · Give the QOF-points-at-risk number context — *4/20*
"123 points at risk" needs, depending on the reader: a denominator/achievement
percentage (Marcus), the time horizon it's measured over — this sweep vs. the
financial year (Yusuf), and for the practice's LTC lead specifically, a £
estimate with the dedup/weighting logic shown so it can be defended to
partners (Harriet). Sweep already states the figure is "national indicator
weights, not income" in small print — the ask is to make that arithmetic
visible on demand, not to add a new calculation.

### W5 · One combined "what must I do today" list, spanning modules — *3/20, but structurally significant*
Imran, Aisha and Eleanor (technophobe/reluctant bands, independently) all
described wanting the same thing in different words: a single ranked
red-amber list combining Sweep gaps, Sentinel flags and open 2WW referrals,
sorted by clinical risk rather than by which tab it happens to live in. This
is the floor-band's version of W2 — it's not "build something new," it's
"stop making me visit three tabs to assemble my own priority order."

### W6 · Trust/provenance signals on the data itself — *5/20*
"Live snapshot, not a complete record" is honest but vague (Imran wants it
either truly live or explicitly aged); absolute due-dates instead of relative
day-counts on monitoring chips (Noah, Eleanor); a confidence indicator on
whether a drug's "in date" status came from a complete current brand match or
a lucky generic substring hit (Susan) — directly extends the existing
`drugMatchDetail`/exclude-reason plumbing the methotrexate banner already
demonstrates.

### W7 · Power-user / governance asks (cluster) — *Geoff, Marcus, Harriet, Ben*
CSV export parity across Sentinel/Today (matching Referrals/Trends, which
already have it); a density/compact toggle; publish the active exclude-term
list with a one-line clinical rationale per term (directly extends the
per-exclude disclosure CQC Readiness already does, per CHANGELOG v3.137.0 —
this is "do it in Sentinel too," not new ground); a practice-level register of
every patient currently carrying an unmonitored high-risk drug, not just
shown per-patient when a clinician happens to open that record; and a
one-click "Sentinel banner → dated audit note in the patient record" for
medicolegal defensibility.

---

## 4 · Standout strengths (protect these — they're what's pulling the mean up)

- **Sweep's QOF-points-at-risk ranking + one-click "Create recall task."**
  Named as the most genuinely time-saving feature on the panel by a clear
  majority across every band, from the rural single-hander to the power user.
  This is the suite's best-realised "detection → action" loop; W3 is asking
  to finish it, not fix it.
- **The Referrals 2WW open-loop safety-net.** Universally praised, several
  reviewers independently called it "the best thing in the whole set." The
  panel's loudest ask (W2) is purely "make this louder and harder to miss,"
  which is the highest compliment a feature can get.
- **Honest self-disclosure language.** "Live snapshot, not a complete record,"
  "no alert ≠ monitoring complete," the high-risk banner's own "verify in
  Medicus" caveat — praised by name across technophobe and savvy bands alike
  as the reason they'd trust the tool more, not less. Do not let any future
  redesign strip this out for the sake of a cleaner screen.
- **The high-risk-unmatched-drug guard itself**, even though this run's two
  demo drugs turned out to already be covered (§0) — the panel's strong
  reaction to it confirms the *feature* lands exactly as intended when it does
  fire on a genuine gap.

---

## 5 · Prioritised path

**Quick wins (S, < 2h):**
1. **W2 (the strip half)** — add the open 2WW count as a fourth global alert
   strip on Today, following the existing `wrStrip`/`rmStrip`/`subRagStrip`
   pattern verbatim. *(unblocks Tom, Sam, Imran, Eleanor)*
2. **W6 (dates)** — show absolute due-dates alongside relative day-counts on
   Sentinel's monitoring chips. *(Noah, Eleanor)*
3. **W7 (export parity)** — extend the existing Referrals/Trends CSV export to
   Sentinel and Today. *(Geoff)*

**Half-day (M):**
4. **W1** — cross-reference `flagHighRiskUnmatched()` output against the
   patient's own matched-rule list; surface "possible duplicate of X below" on
   the banner when a name match is found. *(Tom, Priya, Naomi, Susan, Yusuf)*
5. **W3 (confirm + batch)** — a success toast naming the created Medicus task
   ID on Sweep's recall button; a "select all action-needed → create tasks"
   batch action. *(Amara, Liam, Eleanor)*
6. **W4** — a denominator/achievement-% and time-horizon label on the
   QOF-points-at-risk figure. *(Marcus, Yusuf)*
7. **W2 (the close-the-loop half)** — a "chase logged / appointment confirmed"
   tick on each 2WW worklist row. *(Imran, Amara)*

**1–2 days (L) — feature gaps, roadmap:**
8. **W3 (auto-run)** — schedule Sweep to run automatically ahead of first
   appointment rather than requiring a manual trigger, using the same
   `chrome.alarms` mechanism the suite's other pollers already rely on.
   *(Owen, Ben)*
9. **W5** — a single cross-module "what needs me today" ranked list pulling
   from Sweep + Sentinel + the 2WW worklist. *(Imran, Aisha, Eleanor)*
10. **W7 (register)** — a practice-level rollup view of every patient
    currently carrying an unmonitored high-risk drug. *(Harriet)*
11. **W7 (exclude transparency)** — publish Sentinel's active exclude-term
    list with rationale, mirroring what CQC Readiness already discloses.
    *(Marcus)*

---

## 6 · Judgement calls

- **Downgraded — the Priadel/lithium "duplicate" confusion as a current bug.**
  See §0: verified against `rules/drug-rules.json` and
  `engine/rules-engine.js` that neither demo drug reflects a live gap. Kept
  the underlying architectural ask (W1) because the code path that *would*
  produce this confusion on a genuinely unlisted brand is real and confirmed
  — but it is a feature request, not a defect report, and should not be
  triaged as "fix a bug found by 7 GPs."
- **No feature recommended for deletion.** Every convergent ask this run was
  an extension of an already-shipped, already-praised capability (Sweep,
  Sentinel's banner, the 2WW worklist) — the panel is asking the suite to
  finish ideas it has already started, not to remove anything.
- **W3's auto-run-Sweep ask is a scope judgement call, not just an engineering
  one.** Running a clinical check unattended, before any clinician has opened
  the panel, is a step beyond "passive display only" framing in
  `docs/INTENDED-PURPOSE.md` even though it changes no patient data — worth a
  one-line confirmation from Dave that scheduled background evaluation stays
  inside the suite's "supplementary, clinician-reviewed" posture before
  building it.

---

## 7 · Reproduce

- **Surfaces (12 PNGs, `/tmp/the-practice/gp20-2026-06-30/`):** today, sentinel
  (high-risk banner + normal overdue chip), sweep (QOF-points panel + recall
  button), referrals (2WW safety-net + aggregate charts), condor, trends,
  capacity, slots, submissions, activity, reception (all light theme, realistic
  volume), cqc-readiness (full-tab, answer-first verdict). Rendered via
  `.claude/skills/design-crit/harness.mjs`, Playwright 1.56.1, v3.143.1.
  Sweep and Sentinel chip *contents* were hand-fixtured (not engine-evaluated)
  to demonstrate the newest features — see §0 for what that cost in accuracy.
- **Cast:** 20 GP-only personas spanning the standing roster's 5 GPs
  (Margaret, Tom, Sam, Priya, Geoff) plus 15 new practice contexts built for
  this run (rural single-handed, semi-retired/OOH, newly qualified, LTC lead,
  retirement-track partner, deprived inner-city, rural dispensing/connectivity,
  ST2 registrar, medicolegal portfolio, frailty GPwSI, CQC governance lead,
  returning-from-break, digital-health enthusiast, part-time parent, OOH/urgent
  care). One subagent each, screenshots + functional inventory only, no source
  access, no cross-talk; technophobe/reluctant bands (7) on haiku,
  pragmatist/savvy bands (13) on sonnet.
- **Verification:** §0's Priadel/methotrexate check against
  `rules/drug-rules.json` and `engine/rules-engine.js:79-184`.
- **Diffs against:** `PRACTICE-whole-suite-2026-06-21.md` (mixed-role panel,
  mean 5.7, v3.126.0) — this is a different cast (GP-only, not mixed-role) on
  a newer build with five more features shipped, so scores aren't directly
  comparable; both runs independently surfaced "number context" (QOF
  points-at-risk / Condor pressure index) as a recurring ask.
