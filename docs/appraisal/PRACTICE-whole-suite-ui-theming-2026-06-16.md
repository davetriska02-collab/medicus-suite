# The Practice — whole-suite appraisal (UI / display / theming focus) — 2026-06-16

> **This panel is synthetic.** Every reaction below is from a structured
> fictional persona, not a real clinician. It is a heuristic device for
> surfacing UX and feature gaps cheaply — **not** user research, and no line
> here is evidence that "a GP said X". Findings are hypotheses, rated and
> **verified against source or pixels** where they bear on a decision. Rendered
> from the real product at **v3.110.2** (46 screenshots of the actual modules in
> light / dark / cold-start / empty / alerting / colourblind states via the
> design-crit harness, at realistic practice volume). Personas were run on
> Sonnet at the user's request; the technophobe bands were held hard to
> character so they did not out-reason a real Luddite.

Scope: **whole suite** (13 side-panel modules + visualiser). Lens emphasis per
the brief: **UI, display, theming — "make it awesome for end users"**, weighted
to ease-of-use. Bar: intrinsic best-of-type usability (no competitor bar; use
`the-gauntlet` if a market comparison is wanted).

---

## 1 · Verdict

**Not best-of-type for *all* its users yet — but materially closer than the last
whole-suite run (v3.98.1), and the two biggest blockers from that run are
verified fixed.** Condor no longer contradicts itself (it now leads with
"Demand 150 · Capacity 72 · Over capacity" and floors the band to AMBER with the
weighting explained — both reconciling roles, Tom and Janet, now accept it), and
Sentinel's all-clear provenance line ("16 meds checked · 6 matched · 4 overdue ·
1 unmatched · checked 10:47") landed and was credited by three different bands.

**The single biggest thing carrying it:** the honest, self-describing states —
the cold-start "Get set up" checklist (the locum and the registrar both rated it
the best discoverability in the suite), Sentinel firing with zero config plus its
"Verify in Medicus" escape hatch, the always-on alerting strip, and Referrals as
a manager-defensible audit.

**The single biggest thing holding it back:** the suite still **leaks its own
vocabulary to the floor of the tech-literacy gradient.** Two-letter triage codes
(NM/MR/NA/AR), an icon-only nav strip, unlabelled demand bars, clinical words at
the reception desk ("escalate", "structured history"), and one dead-end number
("1 unmatched") that simultaneously frightens the nurse and the pharmacist. None
of these is hard to fix; together they are the difference between "the power
users love it" and "the partner who pays for it can use it".

**Honesty caveat on scores:** this run loaded real data into most surfaces, so
fewer scores are cold-render artefacts than last time. The two low scores that
remain are genuine: Maureen (3) hit a real role/expectation mismatch on Referrals
(an audit view, not a patient finder), and Margaret (5) hit real jargon and
contrast friction, not an empty screen.

---

## 2 · The panel

| # | Handle | Role | Band | Ease-of-use /10 | The one thing for a 9 |
|---|---|---|---|---|---|
| 1 | Dr Margaret Aldous | Senior GP partner | technophobe | **5** | One plain-English "here's what needs you now" line at the top |
| 2 | Maureen Castle | Medical secretary | technophobe | **3** | A patient-name search — I can't find one referral on this screen |
| 3 | Sister Eileen Cobb | Practice nurse | reluctant | **6** | Tell me what "1 unmatched" is — safe, or silently missed? |
| 4 | Chloe Danvers | Receptionist | savvy-consumer / low-clinical | **6** | Spell out what "escalate" means as an action |
| 5 | Dr Tom Hollis | Salaried GP | pragmatist | **8** | Show all "needs action" items without a scroll |
| 6 | Dr Sam Okonkwo | Locum (cold) | pragmatist | **7** | Label the four triage badges in full, no click needed |
| 7 | Dr Priya Nair | Registrar | savvy | **7** | Text labels under the nav icons |
| 8 | Janet Briggs | Practice manager | reluctant-but-capable | **7** | One line per metric: what it counts + as-at time |
| 9 | Raj Patel | Clinical pharmacist | savvy + domain | **7** | Drill into "1 unmatched" — that's where a safety gap hides |
| 10 | Dr Geoff Pellew | Partner / tinkerer | power user | **7** | Keyboard shortcuts + CSV export everywhere |

Spread **3–8, mean ≈ 6.3** (up from ≈ 5.4 last run). Ceiling (daily GP) at 8;
floor (secretary) at 3 on a real role mismatch, not a cold render.

---

## 3 · Findings by bucket

### Universal friction (most/all bands, ranked first)

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| **U1** | **Triage badges "NM / MR / NA / AR" are undecodable on the top strip.** Four personas across the whole gradient independently stalled on them. *Verified: the full labels (New Med / Med Reply / New Admin / Admin Reply) DO appear in the Triage Load card lower down, but the persistent top strip shows only the 2-letter codes with no expansion or tooltip.* | 1, 4, 6, 7 | **major** | **Adopt.** Expand the codes on the strip itself (or full-word labels at the panel's real width) and add accessible `title`/`aria-label`. → design-crit copy. |
| **U2** | **"1 unmatched" (Sentinel) is a dead-end black box** that frightens the nurse and the pharmacist for the *same* reason: they cannot tell "no rule needed = safe" from "couldn't read the entry = silent false negative". It is the single biggest ask of **both** Eileen and Raj. *Verified: `unmatchedMedsDetailed` already exists in scope (`sentinel.js:1024`); the headline count simply doesn't drill into it.* | 3, 5, 9 | **major (safety-salient)** | **Adopt.** Make the number expandable to show *which* drug, with a one-line plain-English reason ("no monitoring rule — nothing to do" vs "couldn't classify — verify in Medicus"). Data exists; this is a surfacing change. → design-crit + tiny data wire. |
| **U3** | **The Demand-meter bars carry no visible scale, denominator or direction**, and read as loading spinners. *Verified: the bar's only quantitative cue is its `aria-label` "{val} of {red} red threshold" (`today.js:449`) — the denominator (the red alert threshold) is invisible on screen.* | 1, 5, 7 | **major** | **Adopt.** Put the threshold tick / endpoint labels on the bar so "24 medical" has a visible "of N". → design-crit. |

### The tech-literacy gradient (works for the savvy bands, loses the floor)

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| **G1** | **Icon-only nav strip with no text labels**, an unexplained overflow `›` chevron, and two unlabelled affordances (the "15" by the search glass, the "Monitoring →" pill that reads as an alert not a link). *Even the savvy registrar could not name half the tabs from icons alone* — so the floor is lost entirely. | 1, 6, 7, 10 | **major** | **Adopt.** Text labels under the nav icons (or a labelled overflow menu at narrow width); label the "15" and clarify "Monitoring →" as navigation. → ui-design / design-crit. |
| **G2** | **Reception jargon blocks the non-clinician at the decisive moment.** Chloe found the symptom tiles excellent but stalled hard on "Capture a **structured history**", "**red-flag** questions", and above all "**escalate** straight away" — she does not know what *action* "escalate" means and would either over-interrupt a GP or freeze. | 4 | **major** | **Adopt (clinical-salience permitted — this makes a safety instruction *more* actionable, never less).** Where the pathway says escalate, add one plain action line ("knock on the duty GP's door now / call 999 if they agree"). → design-crit copy. |
| **G3** | **Letter-spaced small-caps + pale grey defeat tired eyes** (persists from the prior run). The caps eyebrows, the small grey "66% / 26%" figures, and the Trends "verify any personalised target" disclaimer are all load-bearing but low-contrast. Margaret misread "Demand" as "DERRAND". | 1, 2, (10 on the Trends caveat) | **major** | **Adopt the legibility signal; overrule the "DERRAND" typo** (the label is "Demand Today" — it's the letter-spaced caps, not a typo). Lift contrast on load-bearing copy; make the Trends personalised-target caveat sticky to the badge, not buried below the chart. → ui-design. |

### Role-specific needs

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| **R1 (manager)** | **Metric provenance — every card needs "what it counts + as-at period".** Janet could defend Referrals and Condor but **not** Activity ("736 — received or completed? I won't put it to partners") and stumbled on Capacity ("today 12/30 vs other days 16/30 — why?", "Cap 72/30 — what's the /30?"). Worst: **Submissions is mislabelled** — *verified: eyebrow "Submissions Tracker" + subtitle "Live count of inbound work" (`submissions.js:153`)* — "submissions" reads as outbound (QOF income) but it counts inbound work. | 8 | **major** (one unreconcilable number poisons the whole tool for her) | **Adopt.** One line per metric card: "counts X · as at HH:MM". Re-word the Submissions subtitle so it can't be read as QOF claims. → design-crit copy + labelling pass. |
| **R2 (secretary)** | **Referrals can't find ONE patient** — the only search is clinician-name. *Verified: sole input is `placeholder="Search clinician…"` (`referrals.js:608`).* Maureen came to "is Mrs Jones's 2WW done?" and gave up — no patient name, no list. **But** Referrals is, by intended purpose, a practice-level **audit** view, not a patient finder. | 2 | **major for her, but a scope/expectation mismatch** | **Adapt, not adopt verbatim — flagged judgement call (see §5).** Either add a patient-name filter *if it's within intended scope*, or make the surface state plainly "practice audit — for one patient, look in Medicus". → product decision then design-crit. |
| **R3 (pharmacist)** | **Clinical interpretability gaps in Sentinel:** no per-drug interval ("overdue *by how long*, expected interval?"), the "+3 more below" hides items so completeness can't be signed off, and QOF achievement flags (DM019 HbA1c above target) get the *same red treatment* as overdue-test monitoring gaps, conflating "do the test" with "value out of range". Raj also flagged a plausible levothyroxine-TFT / eGFR false-negative he couldn't confirm from the brief. | 9 | **major** | **Adopt the *display* changes** (show last-done/interval/overdue-by; visually distinguish QOF-target from overdue-test; surface the hidden items' presence). **Route any change to rule *semantics / coverage* through `the-keeper`, never freehand here.** → design-crit (display) + the-keeper (any rule question). |
| **R4 (power user)** | **No keyboard shortcuts anywhere; Condor has no CSV (only "COPY FIGURES", a clipboard dump he can't script); low density** (the Condor dial eats the fold, Trends has a vast empty lower half, the Clinician Workload card is clipped on the right). | 10 | **major** | **Adopt.** Shortcut map (jump-to-tab, export, cycle date range); CSV on Condor's time-series; a compact/density option; fix the clipped workload card. → design-crit (density) + feature (shortcuts/CSV). |

### Standout strengths (protect these — "best-of-type" is built by defending them)

- **Cold-start onboarding** — the "Get set up" checklist with "Nothing is broken — the suite works as soon as your practice code is set". Sam (locum) expected a 4 and gave a 7 *because* of it; Priya called it the best discoverability in the suite.
- **Sentinel zero-config auto-fire + provenance line + "Verify in Medicus"** — Sam, Raj and Eileen all credited the "N checked · M matched · K overdue · checked HH:MM" line (the prior run's G3 fix, verified landed) and the escape hatch to the source record.
- **The alerting strip** — red "2 URGENT", worst-wait, and a HIDE button. Margaret and Tom both named it the best part of the screen. Clinical salience working as intended.
- **Referrals as a defensible audit** — Janet: "exactly right" (date range shown, totals reconcile, "Updated just now", CSV). The model the other metric tabs should copy.
- **Condor no longer contradicts itself** — verified fix of the prior run's #1 finding: leads with the labelled Demand/Capacity banner, floors to AMBER over capacity, explains the 20% weighting, and offers "COPY FIGURES".
- **Trends thresholds-on-chart + verify caveat; Record's explicit "what's NOT shown"; Knowledge's practice-verification banner; genuinely dark dark-mode** — all praised for honest, trust-calibrating design.

---

## 4 · Prioritised path to best-of-type

**Quick wins (S, < 2h each) — each unblocks a named persona:**
1. **Expand NM/MR/NA/AR on the top strip** + `title`/`aria-label` (U1) → unblocks Margaret, Chloe, Sam, Priya. *design-crit*
2. **Plain-English escalation action in Reception pathways** (G2) → unblocks Chloe. *design-crit copy*
3. **Re-word the Submissions subtitle** so it can't read as QOF income, and stamp an "as at HH:MM" (R1 part) → unblocks Janet. *design-crit copy*
4. **Make "1 unmatched" a click-to-expand** showing the drug + safe/verify reason (U2; data already exists) → unblocks Eileen, Raj. *design-crit + tiny wire*

**Medium (M, ~half-day):**
5. **Demand-meter scale/endpoint labels** (U3) → Margaret, Tom, Priya. *design-crit*
6. **"Counts X · as at HH:MM" provenance line on every metric card** (R1) → Janet. *design-crit + labelling*
7. **Text labels under nav icons / labelled overflow** (G1) → Priya, Margaret, Sam. *ui-design*
8. **Contrast + letter-spacing pass on caps eyebrows and the Trends caveat** (G3) → Margaret, Maureen. *ui-design*

**Large (L, 1–2 days):**
9. **Keyboard-shortcut map + Condor CSV + a density/compact option + fix clipped workload card** (R4) → Geoff. *design-crit (density) + feature (shortcuts/CSV)*
10. **Sentinel per-drug interval display + QOF-target-vs-overdue-test visual distinction** (R3, display only) → Raj. *design-crit; any rule-semantics change via the-keeper*

**XL / needs a product call first:**
11. **Referrals: patient lookup vs scope** (R2) — decide whether per-patient search is in intended purpose before building; see §5.

**Routing summary:** UI / copy / theming → `design-crit` (single surface) or `ui-design` (tokens, contrast, density, nav labels). Clinical-rule semantics → `the-keeper`. Feature gaps (keyboard shortcuts, Condor CSV, Referrals patient lookup) → roadmap; `the-gauntlet` if you want them benchmarked against rivals.

---

## 5 · Judgement calls (flagged for you — reversible)

- **R2 — Referrals patient search: adapted, not adopted verbatim.** Maureen's literal ask is "add a patient-name search box". I did **not** rule that a straight adopt because Referrals is, per `docs/INTENDED-PURPOSE.md`, a practice-level **audit** display, and per-patient lookup is arguably Medicus's job, not the suite's. The conservative fix is to *label the surface as an audit view and signpost Medicus for one patient*. **To reverse:** if you decide per-patient referral lookup is in scope, treat R2 as a feature (add a patient-name filter to `referrals.js`) and it jumps to a quick win for Maureen.
- **Geoff's "colourblind GREEN-text contradiction" — overruled.** *Verified in `condor-colourblind-light.png`:* the gauge arc **and** the band text are both blue; only the band **name** word "GREEN" is retained, which is correct (colourblind users read the band name, not the hue). Residual minor: consider whether rendering the word "GREEN" in blue ink is itself confusing — a naming question, not a bug. **To reverse:** if you want, rename bands to hue-neutral words (e.g. "OK / WATCH / ALERT") so word and colour never disagree.
- **Raj's "Sentinel may fail colourblind" — resolved from source, not re-rendered.** Colourblind mode is a hue-swap (`--red`→orange, `--green`→blue; `panel.css:1631`) with no shape added, but Sentinel severity is **text-carried** ("U&E overdue", "4 red · 3 amber", the "4 overdue" headline), so it survives. Residual minor: cb-red (orange) and genuine amber land in the same hue family, so the *dot* distinction weakens — keep the word labels doing the work. **To reverse / harden:** add a shape token (e.g. filled vs ring dot) if you want colour-independent severity on the dots themselves.
- **Setup strip persistence (Tom/Margaret/Sam) — rated minor, not major.** *Verified: it is dismissible and re-collapses (`setup/setup.js`); it only persists while setup is incomplete and un-dismissed.* Part of the complaint is a harness artefact (the render left it un-dismissed). Still worth a polish so the collapsed strip is a thin one-liner. **To reverse:** if you'd rather it never re-show after first collapse, persist the collapsed state across loads.

---

## 6 · Reproduce

- **Surfaces shot (46 PNGs, `/tmp/the-practice/whole-suite/`):** all 13 modules resting in light + dark; visualiser landing (light/dark); plus `today-alerting`, `today-cold`, `today-colourblind`, `sentinel-loaded`, `sentinel-cold`, `condor-alerting`, `condor-colourblind`, `referrals-loaded`, `panel-nav` (light + dark each). Practice code `a3f2b1`, realistic volume (12 staff, ~140 referrals, 22-patient sweep, 22-entry knowledge base, 45-day Condor history). Rendered via `.claude/skills/design-crit/harness.mjs` at v3.110.2.
- **Panel cast:** the full 10-persona roster from `PERSONAS.md`, one Sonnet subagent each, screenshots-only, no source access, no cross-talk.
- **Evidence gap to close next run:** Sentinel was not shot in colourblind mode (resolved here from source); add `sentinel-colourblind` to the render set so the dot/hue question is judged on pixels too.
- **Diffs against:** `PRACTICE-whole-suite-gap-to-9-2026-06-16.md` (v3.98.1). Verified-fixed since: Condor self-contradiction (U1 there), Sentinel all-clear provenance (G3 there). Still open: eyesight/contrast floor, per-tab/nav discoverability, jargon to the floor.
