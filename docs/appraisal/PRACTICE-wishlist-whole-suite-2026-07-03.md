# The Practice — whole-suite FEATURE WISHLIST panel — 2026-07-03

> **This panel is synthetic.** Every reaction below is from a structured
> fictional persona, not a real clinician, and none of it is user research.
> It is a heuristic device for surfacing feature gaps cheaply. No line here
> is evidence that "a GP asked for X". Findings were verified against the
> real UI or source where they bear on a ruling. Rendered from the real
> product at **v3.151.0** (19 screenshots via the design-crit harness, all 13
> modules in LOADED states — closing the prior run's cold-state evidence gap
> — plus dark/cold/colourblind/alerting variants, realistic practice volume:
> 12 staff, demand 23 medical / 14 admin, velocity 56, 30 free slots).
> Technophobe/plain-language bands ran on haiku; domain/power bands on sonnet.

Scope: **whole suite**, lens: **features / wishlist** (per Dave's ask: "what
features do they most want"), usability noted only where it blocks a wanted
feature. Bar: intrinsic; for a market bar chain into `the-gauntlet`.
Diffs against `PRACTICE-whole-suite-2026-06-21.md` (v3.126.0).

---

## 1 · Verdict

**The panel has stopped asking the suite to explain itself and started asking
it to do their work.** That is the headline shift since 2026-06-21: with every
module rendered loaded, scores compressed to a 6–7 band (mean ≈ 6.4, prior
5.7) and the wishlists are dominated not by confusion but by workflow asks —
"attach what you know to today's actual patient list", "give me the month, not
just today", "turn this alert into the action it implies". The single biggest
carrying strength, named independently by four bands, is **honesty**: the
self-declaring snapshots, dated provenance lines, and the cross-screen number
reconciliation (Submissions 56 = Condor velocity 56; Demand 37 = 23+14;
Capacity 30 = Slots 30) that the manager persona called the first dashboard
arithmetic she'd ever seen tie together unprompted. The single biggest gap:
**the suite still describes the day instead of preparing it** — the top
convergent ask across GP, nurse, technophobe partner and pharmacist is to
project Sentinel/Sweep intelligence onto *today's booked list* as a worklist
(prep the bloods tray, flag the 3 of 14 booked with overdue checks, draft the
chase), rather than leaving each role to cross-reference tabs themselves.

A striking secondary finding: **four asks the panel made are already shipped**
(named unmatched-meds drill-down, tunable pressure-index weights, Sentinel
auto-follow of the open patient, results-queue triage/keyboard/all-normal
markers). Personas working from static screenshots couldn't discover them —
which on a real desk is a discoverability signal, not an acquittal. The tour
and per-tab help should carry these harder before any of them is rebuilt.

---

## 2 · The panel

| # | Handle | Role | Band | Ease /10 | Single biggest ask (one line) |
|---|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner | technophobe | **6** | Tell me in plain English what action each number demands |
| 2 | Maureen Castle | Medical secretary | technophobe | **6** | Full patient names visible in the referral list, never truncated |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | **6** | Name every unmatched/skipped med or patient — never just a count |
| 4 | Chloe Danvers | Receptionist | savvy-consumer | **7** | Tell me what to SAY to the caller (timeline + escalation words) |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | **6** | Sentinel brief follows me patient-by-patient with zero clicks |
| 6 | Dr Sam Okonkwo | Locum | pragmatist | **7** | A one-screen locum brief: who's who, who's on call, what's normal here |
| 7 | Dr Priya Nair | Registrar | savvy | **7** | Label every icon; one waiting-room truth (refuted — see §5) |
| 8 | Janet Briggs | Practice manager | reluctant-capable | **6** | The same reconciled numbers rolled up to a month |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | **6** | Join monitoring alerts to renal function; name what was checked |
| 10 | Dr Geoff Pellew | Partner / tinkerer | power user | **7** | Show (and let me tune) the formula behind every composite number |

Spread 6–7, mean ≈ **6.4** (prior run 5.7 with a cold-state caveat; this run
removes that caveat, so the comparison flatters the prior run, not this one).

---

## 3 · The wishlist, synthesised

### 3a · Convergent asks (multiple bands independently — build these first)

- **W1 · "Prepare my day": project alerts onto today's booked list.**
  *Asked by Tom (#4), Eileen (#3), Margaret (#1, #5), Raj (#5) — four bands.*
  The Sweep already checks the day's booked patients against the rules engine;
  the ask is to surface its output where each role works: a one-line "3 of
  your 14 booked today have overdue checks" on Today; a nurse clinic-prep
  worklist ("everyone booked today due bloods / a jab / a review, with what")
  so the tray and fridge are prepped in advance; named patients (not bare
  `DM037` rows) in the QOF-points list. Most of the data already exists —
  this is a presentation-and-routing feature, not a new engine.
- **W2 · A plain-action layer on every alert.** *Margaret (#1), Eileen (#1),
  Chloe (#1), Tom.* "FBC, LFT overdue" → "take FBC + LFT today; next due
  [date]". One plain-English "what needs you now" sentence on Today
  (recurring from every prior run; still the technophobe's price of entry).
  Sentinel already glosses QOF codes ("DM006 — Diabetes: BP 140/80 or less");
  Sweep's bare-code rows don't — carry the same gloss everywhere.
- **W3 · History and baselines: "is this normal?"** *Janet (#2), Geoff (#5),
  Sam (#5).* Everything is Today. The manager wants month-on-month
  Submissions/Activity/Condor for the partners' pack; the power user wants
  "this Friday vs the last 8 Fridays" overlays; the locum wants "vs this
  practice's usual" on the Today numbers. `shared/event-ledger.js` already
  exists as a local history substrate — this is the natural growth ring.
- **W4 · Closed-loop acknowledgement.** *Eileen (#5), echoed by Tom's queue
  habits.* When the nurse takes the bloods or gives the jab, let her tick it
  so the chip stops re-alerting the next clinician as if nothing happened —
  session-local and visual-only (like the shipped seen-dimming), never
  suppressing a re-graded alert, never writing to the record.

### 3b · Role-specific asks (one role's must-have)

**Manager (Janet):** (1) **QOF income projection in pounds** — list size +
point value entered once, "40 points at risk" becomes a £ figure for the
partners (her #1, ~4–6 h/month saved); (2) **CQC evidence export** of the 2WW
safety-net log — dated breaches + when actioned; (3) **session-adjusted
per-clinician activity** (raw totals mislead on part-timers — Geoff
independently mistrusted the same number); (4) DNA rate + FFT/complaints
tracking (needs endpoint scoping — may not be in reach).

**Pharmacist (Raj), patient-safety-ranked:** (1) **renal context joined to
monitoring chips** — the suite holds drug, CKD stage and eGFR on three
different screens and never joins them; "overdue bloods" on
methotrexate/lithium in CKD3a should read "…and dose may need review at this
eGFR". Clinical-rule change → route via `the-keeper` + CSO review; (2)
**interaction/PINCER combinations at point of care** — partially shipped
(live STOPP/START prompts exist in Triage Lens on the record view; not
rendered in this run) — audit coverage before building anything; (3) **live
ACB score on the patient card** — `engine/acb-scores.js` already powers the
Visualiser; surfacing it live is engine-reuse, but a clinical surface → CSO
review; (4) **SMR prep pack** — one printable sheet per patient composing
what Sentinel + Record + Trends already hold; (5) **named, auditable Sweep
output** — who was checked, who skipped and why, CSV.

**Reception (Chloe):** (1) **caller scripts per pathway** — what to ask and
what to say about timing; (2) **red-flag explainers in plain words** before
the form starts; (3) honest **callback expectation** (only if derivable from
queue data — never promise what the data can't support); (4) 111/A&E
guidance — **constrained**: the suite must not make triage decisions
(intended-purpose §"does not generate… triage decisions"); any escalation
wording must be CSO-signed signposting reference text via `the-keeper`, like
the existing pathways; (5) **auto-suggest the matching NHS leaflet per
pathway tile** — cheap join of two existing modules.

**Secretary (Maureen):** (1) full names in the safety-net card — wrap, never
truncate (a 400px-panel rendering defect, fix now); (2) **per-referral status
she can read to a patient on the phone** ("sent / acknowledged / appointment
booked / needs chasing") — depends on what the audit endpoint exposes; (3) a
**prepare-only chase-letter draft** (copy-to-clipboard, same doctrine as the
shipped ask-back drafts — never auto-sent).

**Locum (Sam):** (1) a **"Locum brief" card** — who's on call, who to
escalate to, practice quirks — a practice-authored Knowledge-module extension,
not new infrastructure; (2) inline "what is a Team ID and who holds it" at
the point it's asked for; (3) an **end-of-day handover note generator**
("seen X, outstanding Y, safety-netted Z" — local, prepare-only).

**Trainee (Priya):** (1) an **auto-built portfolio/learning log** from
actions the suite already sees (2WW raised, red-flag calls escalated, QOF
gaps closed) — genuinely novel; must be patient-identifier-free by design;
(2) **"teach me" links** from each clinical trigger to its source guideline
(CKS/NICE) — turns the disclaimers into one-click lessons.

**Power user (Geoff):** (1) **scheduled exports** — "Activity + Submissions
CSV every Monday 07:00". Honest constraint: an extension cannot email;
alarm-driven auto-download is feasible, a practice-sync backend remains the
known-deferred P7; (2) **keyboard-first panel navigation** (queue-side j/k
shipped in v3.151.0; the panel itself has nothing); (3) **cross-tab
drill-through** (click a clinician on Activity → their filtered view
elsewhere); (4) a data table under Trends charts, not hover-only points.

**GP (Tom), by minutes saved:** (1) his #1 (auto-follow) is **shipped** —
see §5; residual: make the red/amber state of the open patient visible from
*any* tab (the strip already carries "Monitoring →"; add the count); (2)
**"safe to sign" for repeat prescriptions** — show monitoring currency
against the request so the 6pm pile can be authorised or bounced without
opening the full record. Read-only display of existing checks fits the
intended purpose; needs scoping; (3) results-queue triage — **largely
shipped in-page** (result chips, keyboard nav, all-normal fileable marker,
lab filing); the un-shipped residual is exactly the known-deferred **P4 bulk
filing**; (4) = W1; (5) **letters/Docman triage** — a genuinely new modality
the suite doesn't touch; needs endpoint/DOM scoping before it's a plan.

### 3c · Standout strengths (protect these; they anchor "best of type")

- **Honest states everywhere** — "live snapshot, not the full record", dated
  "checked 08:30" provenance, "No alert ≠ monitoring complete". Named
  unprompted by Raj, Priya, Sam and Eileen as the reason they'd trust it.
- **Cross-screen number reconciliation** (Submissions ↔ Condor ↔ Slots) —
  the manager's poison test, passed for the first time.
- **The Sentinel per-patient brief** — Tom: "the one screen that changes what
  I do at the point of care"; 2 clicks vs 4–5 Medicus screens.
- **Knowledge tab as locum gold** ("the laminated sheet every practice never
  hands me"), **Leaflets** at the front desk, **CSV on every analytic tab**,
  and a dark mode that is actually designed, not inverted.

---

## 4 · Prioritised path

**Quick wins (S, <2h) — UX-level, route via `design-crit`/`ui-design`:**
1. Un-truncate patient names in the 2WW safety-net card (Maureen). Defect-class.
2. Label the safety-net tiers on-card ("watch ≥14d · overdue ≥21d") (Janet).
3. Carry QOF-code glosses into Sweep rows + patient names in points-at-risk (W2/W1 slice; Eileen, Raj, Janet).
4. Auto-suggest the matching leaflet on each Reception pathway tile (Chloe).
5. Tour/help pass to surface the four already-shipped features the panel
   couldn't find (unmatched drill-down, PPI cog, auto-follow, queue tools) —
   `update-tour` skill.

**Half-day (M):**
6. Today line: "N of today's booked have overdue checks" reusing Sweep output (W1 slice; Tom, Margaret).
7. Named skipped-entries list in Sweep, with reasons (Eileen, Raj).
8. Open-patient red/amber count on the header strip from any tab (Tom residual).
9. Locum brief card + Team-ID inline explainer (Sam) — Knowledge extension.

**1–2 days (L) — feature roadmap:**
10. Nurse clinic-prep worklist view over Sweep (W1 core; Eileen).
11. Month-on-month rollups for Submissions/Activity/Condor on the event-ledger (W3; Janet, Geoff).
12. QOF £ projection (arithmetic display; non-clinical) (Janet).
13. SMR prep pack export composing existing data (Raj).
14. Prepare-only referral chase-letter draft (Maureen).
15. Keyboard-first panel navigation (Geoff).
16. Session-adjusted per-clinician toggle in Activity (Janet, Geoff).

**XL / needs its own scoping (decision first, then breakdown):**
17. "Safe to sign" repeats view (Tom) — high value, fits read-only doctrine, needs endpoint scoping.
18. Renal-context join + live ACB on monitoring chips (Raj) — highest
    patient-safety value on the list; clinical rules → `the-keeper` + CSO.
19. Bulk inbox filing — already the recorded next build (P4, labfiling response doc).
20. Letters/Docman triage (Tom) — new modality; scope before promising.
21. Trainee portfolio log (Priya) — novel differentiator; identifier-free by design.
22. Closed-loop acknowledgement ticks (W4) — visual-only; hazard-log entry needed.
23. Scheduled exports (Geoff) — alarm-driven download flavour only; sync backend stays deferred.

For a market comparison of any of these, chain into `the-gauntlet`.

---

## 5 · Judgement calls & verification rulings

- **Refuted — Priya's "two waiting-room truths" (strip 6 vs Condor 10).**
  Checked on pixels: condor.png strip=6/body=6; condor-alert.png strip=10
  (red, 44m)/body=10. Both internally consistent — the persona compared two
  different fixture moments. The standing minor note from 2026-06-21 (Today
  and Condor read different WR endpoints, so live divergence is *possible*)
  remains open but unproven. *To escalate: verify on live data once.*
- **Already shipped, reported as missing (discoverability, not gaps):**
  named unmatched meds (`sentinel.js:1326` — the count is a click-to-expand
  link); tunable PPI weights (`condor.js` item 8 — the cog on the gauge,
  shipped after last run's P1); Sentinel auto-follow of the open patient
  (active-tab snapshot polling); results-queue triage/keyboard/all-normal
  markers (v3.148–3.151, in-page, not rendered this run). Ruled: adopt as
  tour/help items (#5), not rebuilds.
- **Downgraded — fixture artefacts, not product findings:** uniform
  slots-by-clinician rows ("3am·0pm·3" ×10) and Capacity's identical 26/25
  days (uniform fixtures); Sweep's "6 entries no UUID" (seeded without UUIDs);
  Sentinel "8 meds" vs Record "4 medications" (two independent fixtures).
  The last is worth one live-data spot-check; the skipped-entries *count
  without names* is adopted as feature #7 regardless.
- **Constrained — Chloe's 111/A&E decision tree.** The intended-purpose
  statement excludes triage decisions. Adopted as CSO-signed signposting
  reference text via `the-keeper`, mirroring the shipped pathway doctrine —
  never as the tool telling reception where to send a patient.
- **Clinical-safety salience:** no persona asked for any alert to be quieter
  this run; nothing recommended down. W4's acknowledgement tick is
  deliberately specified as visual-only and never suppressing a live alert.
- **No feature recommended for deletion.**

---

## 6 · Reproduce

- **Surfaces:** 19 PNGs, `/tmp/the-practice/whole-wishlist-2026-07-03/` — all
  13 modules resting LOADED (light), today/sentinel dark, today cold +
  colourblind, condor alerting. Practice code `a3f2b1`, volumes as §header.
  Rendered via `.claude/skills/design-crit/harness.mjs`, Playwright 1.56.1,
  zero page errors.
- **Cast:** full 10-persona roster, one subagent each, screenshots-only, no
  source access, no cross-talk; bands 1/2/4 on haiku, rest on sonnet. Return
  contract = standard six items + a ranked 3–5-item feature wishlist.
- **Verification:** condor strip/body consistency (pixels), safety-net
  thresholds (`shared/referrals-api.js` watch 14 / overdue 21), unmatched-med
  drill-down (`sentinel.js:1326`), PPI weight editor (`condor.js` item 8),
  Sentinel active-tab snapshot polling, shipped queue features (CHANGELOG
  v3.151.0). Cross-referenced against the labfiling wishlist-response
  deferred list (P4/P7) so known-deferred items aren't re-litigated.
- **Diffs against:** `PRACTICE-whole-suite-2026-06-21.md`. Verified closed
  since: cold-state evidence gap (all modules loaded), PPI tunability (P1),
  Condor gauge/band coherence. Still recurring: plain-English action line on
  Today (three runs running), bare codes in Sweep, header icon labelling
  (the unexplained "16" badge).
