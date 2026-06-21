# The Keeper — Sentinel rule-currency review — 2026-06-21

> Scope: the Sentinel engine's clinical rule sets only — `rules/drug-rules.json`
> (27 drug-monitoring rules) and `rules/qof-rules.json` (QOF 2026/27 indicators).
> Two scanner passes (drugs, QOF), each cross-checked. **Report-only: no rule
> file was edited** — see "Why nothing was applied" below.

## Headline

**The Sentinel rules are current.** No drift was found in any *enabled* drug
interval, drug brand set, or QOF indicator value. This is the direct, evidenced
answer to the Practice panel's R4 worry ("the footer proves currency, not
coverage"): on this review, coverage and currency both hold. The actionable
output is three **additive source/notes refreshes** (no interval or matching
change) and **one age-band discrepancy** to resolve against the primary QOF PDF.

## Critical caveat — primary sources were unreachable this run

Every authoritative URL (NHS England QOF PRN02356 PDF, gov.uk MHRA Drug Safety
Updates, the Oxford/Rheumatology BSR 2025 guideline, SPS monitoring pages)
returned **HTTP 403** from this sandbox. All findings below are **corroborated
from multiple consistent secondary summaries**, not primary-fetched. Every item
is therefore tagged *needs primary confirmation*. A reviewer with browser/
authenticated access should confirm the four flagged items before any edit.

---

## Drug-monitoring (`drug-rules.json`)

**Verified as NOT drifted (no change):** methotrexate, hydroxychloroquine and
amiodarone brand sets are complete vs current dm+d/emc (Cordarone X ⊂ "cordarone";
Quinoric/Plaquenil/generic all covered; all MTX brands present). DMARD stable-phase
intervals are **not** drifted — the 2025 BSR guideline only relaxes monitoring
*after* 12 months stable, which the rule's 84-day baseline already safely
under-shoots. No interval lengthening was proposed (that would be the unsafe
direction).

| # | Rule | Change type | Severity | Verified? |
|---|------|-------------|----------|-----------|
| D1 | `glp1-receptor-agonist` | **notes + source** — add MHRA DSU 29 Jan 2026: strengthened acute-pancreatitis warning (necrotising/fatal; 1,296 Yellow Card reports to Oct 2025) across all GLP-1 / GIP-GLP-1 agonists | Amber | corroborated, needs confirmation |
| D2 | `methotrexate-maintenance` (+ leflunomide / azathioprine / sulfasalazine / hydroxychloroquine) | **source citation** — refresh "2024 update" → "2025 BSR csDMARD guideline (Rheumatology, Nov 2025)" | Green | corroborated, needs confirmation |
| D3 | `chc-combined-hormonal` | **notes** — flag MHRA tirzepatide→reduced oral-contraceptive absorption (advise barrier/non-oral method for 4 weeks after start and each dose step) | Amber | corroborated, needs confirmation |

All three are **additive** (notes/source only) — no `match`, `exclude`, or
`intervalDays` change, so `test-drug-brand-coverage.js` EXPECTED is unaffected.
The finasteride/dutasteride May-2026 DSU was checked and is **out of scope**
(psychiatric/sexual warnings, no blood/clinical monitoring requirement).

---

## QOF 2026/27 (`qof-rules.json`)

**Verified as NOT drifted (no change):** every *enabled* indicator value that
could be corroborated **matched the file** — HYP010 (38), HYP011 (14), CD001
(41, 40–90%), CD002 (20, 46–90%), CHOL003 (38), CHOL004 (44), AF008 (12,
70–95%), HF009 (12, 20–50%), DM037 (10, all-or-nothing), AST012 (15, 45–80%).
Retired 25/26 indicators (HYP008/009, CHD015/016, STIA014/015, DM007/008,
HF003/006) are correctly kept disabled — do not delete. No 26/27 indicator is
missing from the file.

| # | Item | Finding | Action |
|---|------|---------|--------|
| Q1 | `qof-dm036` | **Age-band discrepancy.** File uses `ageRange.max: 70` ("was <80, now ≤70"); one 26/27 secondary summary describes DM036 as "aged 79 and under". If the true 26/27 band is ≤79, the chip **silently fails to fire for diabetics aged 71–79** (missed BP-control prompt). Could not resolve against primary. | **Confirm against PRN02356 before any edit.** Top priority. No change made. |
| Q2 | `qof-ob004` | Draft values (5 pts, 10–30%) corroborated exactly. | **Keep disabled.** Enabling needs an engine change (BMI-driven register + 90-day timing window), not a JSON flip. |
| Q3 | `qof-ob005` | Draft values (13 pts, 50–80%) corroborated exactly. | **Keep disabled.** Needs TA1026 cohort gating + shared-decision-making coding (engine change). |
| Q4 | `qof-reg-ob` | OB register definition (BMI≥30, or ≥27.5 for specified family backgrounds, in preceding 12m) corroborated; file's note already accurate. | Keep disabled until a BMI-driven register exists. |
| Q5 | provenance | File asserts primary "PRN02356" backing; this scan could not fetch it. | Add a scan note recording corroboration-only verification (honesty, not a clinical change). |

---

## Why nothing was applied

The Keeper applies a rule change only when it is **verified against a primary
source, conservative, and accompanied by the required test/version updates**.
On this run **no primary source was reachable** (all 403), so every proposal is
"corroborated, needs confirmation". Editing clinical rules — especially the
DM036 age band — off secondary snippets would be exactly the silent-error risk
the Keeper exists to prevent. The three drug items (D1–D3) are additive and
low-risk, but they too cite primary documents whose exact wording I could not
read, so they are staged as proposals, not commits.

## Recommended next step (one re-run)

Re-run with an un-blocked fetch path (or paste the PRN02356 PDF + the 29-Jan-2026
GLP-1 pancreatitis DSU). On confirmation, the safe order is: (1) resolve **Q1
DM036 age band** — the only patient-safety-adjacent item; (2) apply **D1/D3**
safety notes and **D2** source refresh (additive, no interval change), bump
`drug-rules.json` `lastUpdated`, manifest version + CHANGELOG, and run
`node test-drug-brand-coverage.js` + `npm test`. OB004/005 enablement stays a
roadmap engine task regardless of confirmation.

*Companion design-house appraisal: `DESIGN-HOUSE-2026-06-21.md`.*
