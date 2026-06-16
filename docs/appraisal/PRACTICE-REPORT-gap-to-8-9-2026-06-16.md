# The Practice — Practice Report, gap to 8/9 — 2026-06-16

> **Synthetic panel — not user research.** Four fictional personas reacted to
> screenshots of the real Practice Report at v3.103.0 (after the design-crit fixes
> + headless discovery; referrals now populate). A heuristic for finding friction.
> States: `/tmp/the-practice/report-final/` (management light+dark, staff, icb, no-code).

## 1. Verdict

The report is **good, not yet an 8/9** — it sits around 6–7. The thing carrying it
is its **honesty and governance furniture**: the period + "as at" header, the
"what this doesn't cover (not shown rather than estimated)" footer (the manager
would "put that straight on a report to the ICB"), the **explicit per-clinician
omission** in Staff/ICB (the GP: "exactly right — nothing derails a huddle faster
than an accidental league table"), the **live-snapshot vs period separation**, and
the per-clinician drill-down + reconciling total (the power user: "appraisal-ready").

The single thing holding it back is **convergent across all four bands**: the
**Pressure Index "25/100 · AMBER"** in the current-snapshot. The number reads
green-ish (below its own 40 line), the badge says AMBER, and the reconciling
explanation ("shown as AMBER because over capacity") is in small grey text. Every
persona snagged on it — the manager won't quote it, the power user won't trust an
unexplained composite, the technophobe doesn't know what it means, the GP predicts
"a three-minute definitional argument at the huddle". Fix that one tile and the
report jumps a full band for everyone.

## 2. The panel

| Persona | Role | Band | Score /10 | The one thing for an 8/9 |
|---|---|---|---|---|
| Janet Briggs | Practice manager (primary) | reluctant-capable | **6** | A one-line plain-English meaning on any non-count/composite figure (esp. the index) so she can defend it |
| Dr Geoff Pellew | Partner / power user | savvy | **7** | CSV that exports the **per-clinician table** (+ referrals), not just demand, and sortable columns |
| Dr Margaret Aldous | Senior partner | technophobe | **7** staff / **5** mgmt | A plain footnote on the traffic-light ("AMBER = at/over capacity") |
| Dr Tom Hollis | Salaried GP (staff briefing) | pragmatist | **6** | A plain-English headline ("busy week — demand above capacity") so the team shares a frame before any number |

## 3. Findings by bucket

### Universal friction (all/most bands) — these are the gap to 8/9

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| U1 | **The Pressure Index "25/100 · AMBER" reads as a contradiction.** Number below the green line, badge amber, reason in small grey print. It is also a *live* composite sitting inside a *period* report. | all 4 | **major** | **Adopt — the decisive lever.** Lead the snapshot with a plain-English status line ("This was a busy week — demand above capacity"); make the band reason prominent (not small grey); consider dropping the raw "/100" in the report context or pairing it with the word. *(The scale-key fix landed already but at-a-glance the badge/number still fight.)* → design-crit. |
| U2 | **Demand 151 vs Activity 288 looks wrong without a bridge.** The "different measures, need not match" note exists but is small and late; the manager and GP both predict "partners/team will ask why we did 288 consultations on 151 requests". | Janet, Tom | **major** | **Adopt.** Lift the explainer to a leading line, or add a one-line period summary at the top of the report. → design-crit. |

### Tech-literacy gradient (loses the floor)

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| G1 | **"Rx" is prescribing jargon** ("Routine Rx" / "Non-routine Rx"); a receptionist/technophobe won't parse it. | Margaret, Tom | **minor** | **Adopt.** Relabel to "Routine prescriptions" / "Non-routine prescriptions" in the activity tiles. Trivial. |
| G2 | **By-type breakdown doesn't say it's a breakdown.** "Are these part of 151 or on top of it?" (They sum to 151.) | Margaret, Janet | **minor** | **Adopt.** Label it "of which" / "Breakdown of the 151". Trivial. |

### Role-specific

| # | Finding | Hurts | Severity | Ruling / fix |
|---|---|---|---|---|
| R1 | **CSV exports only demand-per-day, not the per-clinician activity table or referrals.** Verified in `report-render.js buildReportCsv` — header is `date + demand keys` only. So the power user "gets a PDF and retypes the table like it's 2004". | Geoff | **major** | **Adopt.** Enrich the CSV to include the activity (per-clinician, management profile) + referrals breakdowns. This is the deferred P4 item, now with a clear demand. (Respect the profile rule — no per-clinician rows in the staff/ICB CSV.) |
| R2 | **Live snapshot can mislead by meeting time.** "Slots free now 50 / Waiting room 0" is an 07:57 reading shown at a 10:00–12:30 meeting; the "as at" stamp exists but is easy to miss. | Janet, Tom | **minor** | **Adapt.** Put the "as at HH:MM" on the snapshot tiles themselves, or make the live block collapsible in the period report. *Judgement call — see §5.* |
| R3 | **Sortable per-clinician columns + demand-as-%.** | Geoff | **minor** | **Roadmap.** Power-user depth; not blocking. |

### Standout strengths (protect)

- The honest **limitations footer** — the manager would file/send it externally *because of* that line.
- **Per-clinician omission stated plainly** in Staff/ICB (the GP singled it out twice).
- **Live-snapshot vs period separation** (the GP: "genuinely smart").
- **Per-clinician drill-down by type + reconciling total row** (the power user: "appraisal-ready at a glance").
- **Period + "as at" header**, CSV/PDF buttons visible, **dark mode** legible.

## 4. Prioritised path to 8/9

**Quick wins (S, < 2h) — biggest band-lift**
1. **U1 — Pressure Index plain-English status + prominent band reason.** The one lever that moves all four bands. → design-crit.
2. **U2 — lead with a one-line "how the week went" summary / lift the demand-vs-activity bridge.** Janet, Tom. → design-crit.
3. **G1/G2 — "Rx" → "prescriptions"; "of which" on the by-type breakdown.** Margaret, Tom, Janet. Trivial.

**Medium (M, ~half-day)**
4. **R1 — richer CSV (per-clinician activity + referrals), profile-aware.** Geoff. (feature)
5. **R2 — per-tile "as at" stamp / collapsible live block.** Janet, Tom. → design-crit.

**Roadmap**
6. **R3 — sortable columns, demand percentages.** Geoff.

## 5. Judgement calls (reversible)

- **The live snapshot in a period report (R2).** It's a genuine strength (the snapshot/period split was praised) but also the home of the confusing Pressure Index and the stale "slots free now". Option to make it collapsible or move it below the period sections. *Reverse by* keeping it leading if real use shows people want "now" first.
- **Overruled — Margaret's "temporal logics", "Messier", "Practice Rx", "Incidents", "Booked day".** *Verified: none of these strings exist in the report* — confabulated by the technophobe persona off a dense screenshot. Kept only the real signal underneath (Rx jargon, breakdown ambiguity).
- **Overruled — Geoff "stuck with presets, no custom range".** A **Custom** period button is present in the control bar; he missed it. Real takeaway is discoverability only (the date inputs appear after clicking Custom).
- **Overruled — "a1b2c3 looks like a mistake" (Janet, Tom).** That's the test-fixture practice code in the render; production shows the real code.
- **No clinical-alert salience reduced; no feature recommended for deletion.**

## 6. Reproduce

States in `/tmp/the-practice/report-final/` (management light+dark, staff, icb,
no-code), rendered via the design-crit harness with referrals-populated fixtures.
Panel: Janet (8/manager), Geoff (10/power), Margaret (1/technophobe), Tom (5/GP);
manager+power on sonnet, technophobe on haiku. Screenshots-only, in character.
