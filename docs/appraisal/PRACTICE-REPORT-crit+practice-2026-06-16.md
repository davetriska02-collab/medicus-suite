# Practice Report — converged design-crit + The Practice — 2026-06-16

> Two parallel workstreams on the new Practice Report surface (v3.100.0), converged.
> **design-crit** = art-director pixels + token/code surveyor (read the real CSS/markup).
> **The Practice** = synthetic persona panel (manager, power-user, technophobe partner,
> salaried GP) — *synthetic, not real user research.* Rendered states:
> `/tmp/the-practice/report-crit/` (management/staff/icb light, management dark, no-code).

## Verdict

The two lenses are complementary and agree on the shape of the work. **The Practice**
judged whether the numbers *mean* anything to the reader; **design-crit** judged how the
page *renders*. The report's bones are strong — every persona scored it 6–6.5 and praised
the audience profiles, the CSV/PDF exports, the honest limitations footer, and (Tom, the
GP) the deliberate per-clinician omission in the Staff briefing. It is **not yet a 9**, and
the gap is one convergent theme plus a rendering blocker: **every composite/headline figure
must explain its own scale and provenance** (the Pressure Index "25/100 AMBER" with no key —
flagged by all four personas), and **dark mode is currently broken** (section headings at
~1.35:1 — design-crit, which the personas could not see because they viewed light states).

## Scores (synthetic panel) + crit severity

| Lens / persona | Band | Score /10 | One-line |
|---|---|---|---|
| Janet (manager) | reluctant-capable | 6.5 | "Bones are better than most tools; label the by-clinician total and I'd circulate it" |
| Geoff (power user) | savvy | 6 | "CSV + PDF are right there; give me drill-down + per-day series + index basis" |
| Margaret (technophobe partner) | technophobe | 6 | "Tell me what 25/100 AMBER means — don't make me guess if I should panic" |
| Tom (salaried GP) | pragmatist | 6 | "Aggregate-only is the best decision here; the index needs a scale for a huddle" |
| design-crit | — | 2 blockers, 3 major, 6 minor | "Re-token dark mode and design the empty state; the rest is polish" |

## Converged findings

### Convergent across BOTH lenses (do first)

| # | Finding | Lens(es) | Severity | Verified | Fix |
|---|---|---|---|---|---|
| C1 | **Pressure Index "25/100 AMBER" has no scale, key or basis** — and shows AMBER at 25 (below the GREEN<40 line) because of the capacity band-floor, which looks like a *bug* out of Condor's context. | Margaret, Tom, Janet, Geoff (4) + implied by crit hierarchy | **major** | Yes — the snapshot carries band+ppi but no threshold legend or floor explanation | Add a one-line key ("GREEN <40 · AMBER 40–70 · RED 70+") and, when floored, the reason ("AMBER: over capacity"); ideally the weighting in a tooltip. *Mirrors the Condor #1 fix — carry the same explanation here.* |
| C2 | **Referrals failure shows developer language, in amber, on every run** ("No discovered URL — navigate to Referrals → Clinical Audit Report first"), and renders a **double full-stop** (`first..`). Reads as an error every time. | crit M2 + Janet, Margaret, Tom (3) | **major** | Yes (`report-render.js:227`) | Plain-English ("Referral data not available — open the Referrals tab once to enable it; figures above are unaffected"); demote to a neutral "Data notes" panel; reserve amber for true failures; strip the trailing `.`. |
| C3 | **Empty / no-code state is abandoned, not designed** — one line of grey text in a blank page; no card, no "Open options" action. Likely first-run experience. | crit M1 + Janet | **major** | Yes | Card-framed centred panel with heading + an "Open options" button. |

### design-crit caught (personas couldn't — they viewed light states)

| # | Finding | Severity | Verified | Fix |
|---|---|---|---|---|
| D1 | **Dark mode broken: section headings + cover title at ~1.35:1** — the dark block never re-tokens `--nhs-dark`/`--nhs-blue`; every section title disappears. Controls title + **sparklines** (data, not decoration) also sub-3:1. | **blocker** | Yes (`practice-report.css` dark block omits brand tokens) | Add lightened `--nhs-dark`/`--nhs-blue` (+RAG `--green/--amber/--red`) to `html[data-theme='dark']`. One change fixes headings, title, sparklines, badge text. |
| D2 | **`.pr-spark-wrap` is referenced but never styled** — the heading sparklines float baseline-misaligned, reading as a glitch/stray underline. | major | Yes (class absent from CSS) | Add the rule (`display:inline-flex;align-items:center`) or move sparklines to a captioned trend row. |
| D3 | **Print drops RAG fills** — no `print-color-adjust: exact`, so the AMBER pill can vanish in PDF (signal loss in a clinical doc). | minor (signal) | Yes | Add `print-color-adjust: exact` to the print `body`. |
| D4 | Stat-tile widths differ section to section (grid-3 vs grid-4); date inputs show US `mm/dd/yyyy` on an en-GB page; cover meta is an undifferentiated run-on. | minor | Yes | `minmax()` tiles; note the date-input locale; separate cover-meta fields. |

### The Practice caught (semantic/trust — crit's pixel/code lens didn't)

| # | Finding | Persona(s) | Severity | Fix |
|---|---|---|---|---|
| P1 | **"By clinician — Total" is unlabelled and doesn't visibly reconcile** — total of *what*? Janet: label it "Total activity items" + show a grand total that ties to the activity tiles (144+133+122 = 399 = 240+57+24+15+36+27). | Janet, Geoff (2) | **major** | Label the column + add a reconciling total row. |
| P2 | **Current snapshot bleeds into the period report** — live "today" figures (Requests today 151, Slots free now 33) sit at the top with equal weight to the 7-day data; "151" appears as both today's live count and the period total, read as a duplicate/error. | Janet, Margaret, Tom (3) | **major** | Visually separate the live snapshot (distinct background + a "live, not part of the period" stamp), or move it below the period sections. |
| P3 | **Demand vs Activity mismatch unexplained** — 151 requests vs 240 consultations; 12 Rx in vs 57 done. Legitimate but raises "which is right?" in a meeting. | Geoff, Janet, Tom (3) | minor | One-line note: inbound demand and work-done are different measures and need not match. |
| P4 | Power-user depth: per-clinician drill-down, per-day time series behind the summaries, section toggles, richer CSV (per-clinician per-type). | Geoff | feature | Roadmap — overlaps the deferred editable/drill-down work. |

### Standout strengths (protect)

Audience profiles that genuinely change content (Janet "protects me") · per-clinician omission in Staff, with the explicit note (Tom "the single best decision… keeps it collective") · CSV + Print/PDF prominent in the toolbar (Geoff) · the honest limitations footer ("not shown rather than estimated" — Janet "could go straight on a printed report") · the period + "as at" header · RAG badge component (crit "best-resolved element").

## Where the lenses diverged (worth noting)

- **Dark mode:** Geoff (glancing) said dark "works cleanly"; design-crit's contrast math says the headings fail at 1.35:1. **The instrument beats the eyeball** — adopt D1. A casual user not noticing does not make 1.35:1 acceptable.
- **The Pressure Index:** personas read it as "meaningless without a key"; design-crit read it as fine *pixels*. Both are right — it renders cleanly but communicates nothing. The fix is content (C1), not styling.

## Prioritised path

**Quick wins (S, < 2h) — ship before merge**
1. **D1** dark-mode token re-tokening (blocker; one CSS block).
2. **C1** Pressure Index scale + floor reason (the 4-persona convergent ask).
3. **C2** plain-English referrals note + demote + double-period fix.
4. **C3** designed empty state with Open-options action.
5. **D2** style/relocate the sparklines; **D3** print-color-adjust.

**Medium (M, ~half-day)**
6. **P1** label + reconcile the by-clinician table.
7. **P2** separate the live snapshot from the period body.
8. **P3** demand-vs-activity explainer line; **D4** tile sizing + cover meta.

**Feature (roadmap)**
9. **P4** per-clinician drill-down, per-day series, section toggles, richer CSV.

**Routing:** items 1–8 are UX/UI and content → apply directly (or via design-crit/ui-design
for the token work). Item 9 → roadmap. No clinical-rule changes involved.
