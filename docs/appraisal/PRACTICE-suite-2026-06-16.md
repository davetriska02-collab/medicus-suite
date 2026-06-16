# The Practice — whole-suite appraisal

**Date:** 2026-06-16 · **Scope:** whole suite (13 modules) · **Lens:** features / UX / ease-of-use, weighted to ease-of-use · **Bar:** intrinsic usability across the full role + tech-literacy spread.

> **This panel is synthetic.** Every reaction below is a scripted persona, not a
> real clinician, and is a heuristic device for surfacing UX/feature gaps — never
> evidence that "a GP said X". Findings were verified against the real UI/source
> before being adopted; persona misreads are flagged and overruled.

## 1 · Verdict

The suite is **not yet best-of-type for *all* its users**, though it is close for the
clinical power users. What carries it is the **Today briefing** (one-glance morning
situational awareness that every clinician persona praised) plus **patient-aware
Monitoring** and a streak of genuinely thoughtful copy (the locum-aware "nothing for you
to do" notes, the "supplementary tool only / verify in source" caveats). What holds it
back is a **literacy tax**: unexplained abbreviations (NM/MR/NA/AR, 2WW, RAG) and opaque
proper-noun tab/feature names (Sentinel, Condor, Sweep) that the technophobe and
non-clinical bands bounce straight off, plus a handful of role-critical gaps. The
ease-of-use **floor (technophobes, 3–4/10) sits well below the ceiling (power users,
6–7/10)** — the suite leaks complexity at exactly the point its stated aim is to carry the
least technical user.

## 2 · The panel

| Persona | Role | Tech band | Ease-of-use /10 |
|---|---|---|---|
| Maureen Castle | Medical secretary | technophobe | **3** |
| Dr Margaret Aldous | Senior GP partner | technophobe | **4** |
| Dr Sam Okonkwo | Locum GP | pragmatist | **5** (7 if code auto-detects, 2 if not) |
| Sister Eileen Cobb | Practice nurse | reluctant | **6** |
| Chloe Danvers | Receptionist / care-nav | savvy consumer, low clinical | **6** |
| Dr Priya Nair | GP registrar | savvy | **6** |
| Janet Briggs | Practice manager | reluctant-capable | **6** |
| Dr Geoff Pellew | Partner / power user | savvy power user | **6** |
| Dr Tom Hollis | Salaried GP | pragmatist | **7** |
| Raj Patel | Clinical pharmacist | savvy + domain | **7** |

Spread 3–7, mean ~5.5. The two technophobes set the floor; no band rated it ≥8.

## 3 · Findings by bucket

### Universal friction (hits most/all bands)

| ID | Finding | Bands hurt | Severity | Fix |
|---|---|---|---|---|
| U1 | **Jargon/abbreviations unexpanded at point of use** — NM/MR/NA/AR on the Today strip, 2WW, RAG, "triage load", "unmatched", plus proper-noun names Sentinel/Condor/Sweep with no subtitle. Expansions sometimes exist nearby (the Triage Load card does spell out NEW MED etc.) but the compact strip and tab labels don't. | all; blocks technophobe + non-clinical | **major** | Expand at point of use; tooltips on every abbreviation; one-line subtitle under each opaque tab name. UX → `design-crit`/`ui-design`. |
| U2 | **"OVER THRESHOLD" with no threshold value or owner** — reads as a permanent red alarm; Tom predicts alert-fatigue, Margaret/Sam can't tell if it's actionable. | all | **major** | Show the threshold number inline; let the badge de-escalate when not breached (decoration only — do not soften the breach signal itself). |

### Tech-literacy gradient (fine for savvy, loses the technophobe/locum)

| ID | Finding | Bands hurt | Severity | Fix |
|---|---|---|---|---|
| G1 | **First-contact "GET SET UP" reads as broken** — Margaret ("I'd call IT") sees the big setup heading before the small "Nothing is broken" reassurance. This is the Today first screen, so it colours the whole-suite verdict. | technophobe, partner | **major** | Lead with the working data; demote the checklist to a quiet strip. → `design-crit`. |
| G2 | **Version chips on clinical screens** — `v0.5.1` on Monitoring (confirmed `sentinel.js:1782`), `v1.0` on Referrals. Margaret/Maureen read sub-1.0 as "still in testing"; Tom calls it dev noise. | technophobe, pragmatist | **minor** | Remove module-version chips from headers. |
| G3 | **Cold-start gates the locum** — if practice-code auto-detect doesn't fire silently, Sam closes the panel rather than hunt a code. | locum | **major** | Make Re-check auto-detect on any open Medicus tab with no button press. |

### Role-specific needs

| ID | Finding | Band | Severity | Fix / ruling |
|---|---|---|---|---|
| R1 | **Secretary can't find a named referral** — Referrals is aggregate-only (priority/status/clinician/specialty/hospital + clinician search; *verified* no per-patient list). Maureen's core job — find one patient's urgent/2WW referral — is impossible here, and nothing signals it's an audit summary not a worklist. | secretary | **blocker** (for her band) | **Adapt / feature decision:** either label it clearly as an aggregate audit, or add a searchable patient-level referral worklist. Flagged as judgement call below. |
| R2 | **Monitoring completeness is under-surfaced** — Eileen wants "all bases covered" (an expected-vs-done checklist), Raj wants the *unmatched* drug named. *Verified:* the unmatched meds **are** listed in a `<details>` block "Meds without a monitoring rule (N)" (`sentinel.js:2010`) — but it's **collapsed by default** and the "1 unmatched" headline doesn't signal it's clickable, so both domain experts missed it. | nurse, pharmacist | **major** (clinical salience) | Default-open the unmatched section when count > 0 / stronger affordance. Clinical-rule *content* (e.g. MTX renal monitoring) routes to `the-keeper`, not here. Salience increase only — never down. |
| R3 | **Manager can't audit two figures** — (a) "Submissions" means QOF returns to Janet but the screen shows daily inbound demand; terminology collision. (b) Pressure Index "56/100" has no visible methodology and no CSV. One unexplained number poisons her trust in the tool. | manager | **major** | Clarify/relabel Submissions scope; expose the pressure-index weighting and add export. |
| R4 | **Power user hits a glass ceiling** — no keyboard nav/shortcuts anywhere; Condor data trapped (clipped workload column, "COPY FIGURES" is clipboard not CSV). | power user | **major** (for his band) | Keyboard shortcuts (tab jump + export); Condor CSV + untruncated columns. |

### Standout strengths (protect these)

- **S1 — Today as a morning briefing.** Praised by Tom, Priya, Sam; even Margaret could not miss the red "2 URGENT" + named waiting list. The single biggest thing carrying the suite.
- **S2 — Patient-aware Monitoring.** Auto-loads the open patient, names the specific overdue tests (FBC/LFT), shows the BP threshold inline (Raj approved), with COPY ACTIONS / PRINT.
- **S3 — Locum-aware copy.** "As a locum there's nothing you need to do" was Sam's best-UX-of-the-day. More of this voice everywhere.
- **S4 — Responsible clinical caveats.** Sweep "supplementary tool only", Knowledge "verify against local guidance" — *increased* trust for Priya and Raj.
- **S5 — Exports + accessibility basics.** CSV in Referrals/Activity/Submissions/Trends (Geoff, Janet); colourblind mode keeps text labels so the alert state survives without colour (Eileen); solid dark mode (Geoff).
- **S6 — Numbers reconcile.** Janet cross-checked Referrals totals (6+3+3=12, 8+3+1=12) and Condor's "141" ties to the Submissions category sum — quiet but real trust-builder.

## 4 · Prioritised path to best-of-type

**Quick wins (S, < 2h each)**
1. Expand triage abbreviations at point of use + tooltips; add one-line subtitles to opaque tab names (Condor/Sweep). → unblocks Margaret, Chloe, Priya. *(U1)*
2. Remove version chips from clinical/data module headers. → Margaret, Maureen, Tom. *(G2)*
3. Default-open "Meds without a monitoring rule" when count > 0. → Eileen, Raj. *(R2, clinical salience)*
4. Show the threshold value beside "OVER THRESHOLD"; surface absolute HH:MM timestamps. → Tom, Margaret, Janet. *(U2)*

**Medium (M, ~half-day each)**
5. Rework Today first-contact to lead with working data, demote GET SET UP. → Margaret, Sam. *(G1)* → `design-crit`.
6. Silent practice-code auto-detect (no button press). → Sam. *(G3)*
7. Expose Pressure-Index methodology + add Condor CSV / untruncate columns. → Janet, Geoff. *(R3, R4)*

**Larger / feature (L–XL — roadmap)**
8. Patient-level referral worklist with search **or** an explicit "this is an aggregate audit" signal. → Maureen. *(R1 — feature decision)*
9. Expected-vs-done monitoring checklist view. → Eileen, Raj. Clinical content via `the-keeper`. *(R2)*
10. Keyboard shortcuts + tab navigation. → Geoff. *(R4)*

UX/UI items (1, 4, 5) route to `design-crit` (single surface) or `ui-design` (token polish). Feature items (8, 9, 10) are roadmap; if you want them benchmarked against rivals, chain into `the-gauntlet`. Clinical-rule items go to `the-keeper`.

## 5 · Judgement calls & overruled misreads

- **Overruled — "the unmatched/dangerous drug is invisible" (Raj, Eileen).** It is listed in a collapsed `<details>` block; the real defect is discoverability, not absence. Reframed as R2 (salience), not a missing feature.
- **Overruled — "the setup wizard follows me onto Trends/Knowledge/Capacity" (Priya, Janet).** Largely a render artifact: those fixtures had no practice code seeded, so the panel correctly showed the setup banner. Once configured it would not cohabit those tabs. The smaller *real* finding (a dismissible setup strip on configured screens, Tom) is kept.
- **Overruled — "Morning Sweep ran 21:01 = stale overnight data" (Margaret).** 21:01 is the fixture clock, not real staleness. The underlying lesson (relative vs absolute timestamps confuse people) is kept under U2.
- **Judgement call — Referrals worklist (R1).** I am flagging this as a *feature gap*, not asserting the module is wrong; Referrals may be intentionally an audit aggregator. **To reverse:** decide Referrals stays aggregate-only and instead just label it "referral audit summary (not a patient lookup)".
- **Clinical-safety guard.** No alert signal is recommended down. U2 softens only the *decoration* of "OVER THRESHOLD"; R2 makes monitoring completeness *more* visible. MTX renal-monitoring correctness (Raj) is referred to `the-keeper`, not adjudicated here.

## 6 · Reproduce

- **Surfaces shot (20 PNGs):** `/tmp/the-practice/suite/` — Today (light/dark/colourblind), cold-start no-code, Slots (cold+populated), Capacity (cold+populated), Submissions, Sentinel (cold/alerting/colourblind), Activity, Referrals, Condor, Trends, Reception, Sweep, Knowledge, Record. Rendered via `.claude/skills/design-crit/harness.mjs` with seeded `chrome.*` store + Medicus API fixtures (practice code `a1b2c3`, realistic UK GP volumes). No page errors.
- **Panel cast:** full 10-persona roster (PERSONAS.md), all run on sonnet per request, screenshots-only, one subagent each.
- **Verification:** Referrals aggregate-only (`referrals.js`), triage shortLabels, `sentinel.js:1782` version chip, `sentinel.js:2010` collapsed unmatched `<details>`.
