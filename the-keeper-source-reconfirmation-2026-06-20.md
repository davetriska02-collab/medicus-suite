# The Keeper — Phase-2 Primary-Source Reconfirmation (2026-06-20)

Follow-up verification for the Keeper Phase-2 clinical changes that were merged flagged
**"pending primary-source confirmation"** because the primary pages
(BNF / NHS SPS / MHRA / emc / FSRH / ACBcalc) returned **HTTP 403** to direct `WebFetch`
during the original run.

This pass re-attempted confirmation for each change via **both** `WebFetch` (primary page)
**and** `WebSearch`. No clinical value was changed — this is confirmation-only.

## Method outcome at a glance

- **`WebFetch` to every primary page: STILL HTTP 403** this run — identical to the original
  Phase-2 run. Pages attempted and all 403/unreachable:
  `sps.nhs.uk` (methotrexate interactions; DOAC monitoring),
  `medicines.org.uk` / `www2.medicines.org.uk` emc (allopurinol 1187, Adenuric 487/4831),
  `gov.uk` MHRA DSU article + the `assets.publishing.service.gov.uk` DSU PDF,
  `fsrh.org` (injectable + CHC guidance pages and the PDF assets),
  `acbcalc.com`, `bnf.nice.org.uk`.
- **`WebSearch` REACHED primary-domain content** for several items — the search index
  returns text attributed to the primary domains (`sps.nhs.uk`, `medicines.org.uk`,
  `gov.uk`, `fsrh.org`) even though the live page refuses a direct fetch. Where that text
  confirms the change it is recorded below as **REACHED (via WebSearch index of the primary
  domain)** with the quote. This is stronger than the original "secondary ICB sources only"
  but is **not** a clean fetch of the rendered primary page, so it is reported as a distinct,
  honestly-labelled tier — not upgraded to a bare "primary-source confirmed".

## Reconfirmation table

| # | Change | Primary source | WebFetch | WebSearch (primary-domain index) | Confirming quote / honest note |
|---|--------|----------------|----------|----------------------------------|-------------------------------|
| 1 | Methotrexate + trimethoprim/co-trimoxazole = severe/fatal marrow suppression; "avoid" | NHS SPS "Managing interactions with methotrexate" | **403** | **REACHED** | sps.nhs.uk: *"Avoid prescribing co-trimoxazole or trimethoprim with methotrexate, due to the risk of severe bone marrow suppression. Consult your local microbiologist to consider alternative antibiotics."* Also confirms the interaction *"may be delayed and has occurred in people who have taken co-trimoxazole after recently stopping methotrexate."* **Change CONFIRMED** (matches rule note verbatim in substance). URL: https://www.sps.nhs.uk/articles/managing-interactions-with-methotrexate/ |
| 2 | Allopurinol/febuxostat + azathioprine/mercaptopurine = life-threatening myelosuppression; febuxostat contraindicated | emc allopurinol / mercaptopurine & Adenuric (febuxostat) SmPCs | **403** | **REACHED (Adenuric SmPC text)** | emc Adenuric SmPC: *"Febuxostat use is not recommended in patients concomitantly treated with mercaptopurine/azathioprine... Where the combination cannot be avoided, a reduction of the dose of mercaptopurine/azathioprine to 20% or less of the previously prescribed dose is recommended."* **Interaction + severity CONFIRMED.** **HONEST CORRECTION:** the primary SmPC wording is **"not recommended"** (with 20%-dose reduction if unavoidable), **not strictly "contraindicated."** The rule description's "febuxostat: contraindicated" is **stronger than the current UK SmPC wording** and should be softened to "not recommended / avoid" at the next CSO pass. Allopurinol+thiopurine 25%-dose-reduction limb not separately fetched (emc 1187 403); long-established and uncontested. URL: https://www.medicines.org.uk/emc/product/487/smpc |
| 3 | ACEi/ARB + K-sparing diuretic = hyperkalaemia risk (amber) | MHRA Drug Safety Update Feb 2016 | **403** (article + PDF) | **REACHED** | gov.uk DSU title confirms: *"Spironolactone and renin-angiotensin system drugs in heart failure: risk of potentially fatal hyperkalaemia — February 2016."* Dec-2016 clarification: *"concomitant use of spironolactone with ACEi or ARB increases the risk of severe hyperkalaemia, particularly in patients with marked renal impairment, and should be used with caution."* **Change CONFIRMED** (existence, Feb-2016 date, and amber "use with caution / monitor" framing all match). URL: https://www.gov.uk/drug-safety-update/spironolactone-and-renin-angiotensin-system-drugs-in-heart-failure-risk-of-potentially-fatal-hyperkalaemia |
| 4 | DOAC monitoring uses CrCl (Cockcroft-Gault) not eGFR; bands annual/6mo/3mo | NHS SPS "DOACs monitoring" / EHRA | **403** | **REACHED** | sps.nhs.uk DOAC monitoring: *"Cockcroft and Gault is recommended for calculating creatinine clearance for DOACs. Estimated glomerular filtration rate can overestimate renal function and increase risk of bleeding events."* Frequency: *"the frequency of renal function monitoring (in months) may be guided by creatinine clearance divided by 10"* (so CrCl 60 → 6-monthly, CrCl 30 → 3-monthly; ≤4-monthly if >75/frail; otherwise up to annual). **CrCl/Cockcroft-Gault-not-eGFR CONFIRMED.** Note: SPS expresses bands as **CrCl÷10 months** rather than fixed "annual/6mo/3mo" labels — the rule's bands are a faithful interpretation of that formula, not a verbatim SPS list. URL: https://www.sps.nhs.uk/monitorings/doacs-direct-oral-anticoagulants-monitoring/ |
| 5 | ACB score 2: carbamazepine, oxcarbazepine, amantadine, pethidine | Boustani/Campbell ACB scale (ACBcalc.com) | **403** | **PARTIAL** (ACBcalc primary page 403; scores surfaced via secondary/index text, not the ACBcalc drug page) | Scale provenance confirmed (Boustani M, Campbell N et al. 2008, scores 1–3). **carbamazepine = score 2, oxcarbazepine = score 2, pethidine = score 2 — CONFIRMED** via index text. **HONEST DISCREPANCY: amantadine is reported as ACB score 1 ("mild anticholinergic effects"), NOT score 2.** The Phase-2 change lists amantadine at score 2. The authoritative ACBcalc drug page could not be fetched (403) to settle this; the available primary-scale descriptions point to **score 1**. **FLAG FOR CSO: re-check amantadine's ACB score against the live ACBcalc entry before relying on score 2.** URL: https://www.acbcalc.com/ |
| 6 | FSRH: DMPA 2-yearly review; CHC annual BP+BMI | FSRH Progestogen-only Injectable + Combined Hormonal Contraception guidelines | **403** | **REACHED** | FSRH (injectable / over-40s guidance): *"Women of all ages using DMPA should be reviewed every 2 years to assess the benefits and risks of use."* **DMPA 2-yearly CONFIRMED.** FSRH CHC guideline: *"routine annual review of their contraception is recommended during CHC use... BMI and blood pressure should be recorded."* **CHC annual BP+BMI CONFIRMED.** (Initial CHC-only search missed the DMPA interval; a targeted second search located it.) URLs: https://www.fsrh.org/standards-and-guidance/documents/cec-ceu-guidance-injectable-contraception/ ; https://www.fsrh.org/standards-and-guidance/documents/combined-hormonal-contraception/ |

## Summary

| Item | Direct primary-page WebFetch | Net confirmation status |
|------|------------------------------|-------------------------|
| 1 MTX + trimethoprim/co-trimoxazole | 403 | **Confirmed** (WebSearch index of NHS SPS) |
| 2 XOI + thiopurine | 403 | **Confirmed with correction** — febuxostat is "not recommended", not strictly "contraindicated" per emc SmPC |
| 3 ACEi/ARB + K-sparing (amber) | 403 | **Confirmed** (gov.uk MHRA DSU Feb 2016) |
| 4 DOAC CrCl/Cockcroft-Gault | 403 | **Confirmed** (NHS SPS; bands = CrCl÷10 interpretation) |
| 5 ACB score 2 list | 403 | **Partial** — carbamazepine/oxcarbazepine/pethidine confirmed; **amantadine appears to be score 1, not 2 — CSO recheck needed** |
| 6 FSRH DMPA 2-yr / CHC annual BP+BMI | 403 | **Confirmed** (FSRH) |

## Disposition of rule-file note upgrades

The task's conditional step — upgrade
`"(corroborated; primary page 403, pending confirmation)"` →
`"(primary-source confirmed <date>)"` — was scoped to where a primary page was **genuinely
fetched**. Two facts govern the disposition:

1. **No primary page was fetched.** Every `WebFetch` returned HTTP 403. The confirmations
   above came from the `WebSearch` index of the primary domains, which is a stronger but
   still distinct tier from a clean primary-page fetch. Per The Keeper's verification
   discipline (and to keep the provenance label honest), the "(primary page 403, pending
   confirmation)" tags were therefore **left as-is** — they remain factually accurate: the
   primary page is still 403.

2. **The Phase-2 strings do not exist on this branch's HEAD.** This branch was cut from
   the current worktree HEAD (`edb053d`), which **predates** the Phase-2 merge
   (`fdaf8a8` / merge `0e5674c`). The new alert IDs (`pincer-mtx-trimethoprim`,
   `mhra-acei-arb-ksparing-hyperkalaemia`, `alert-xoi-thiopurine-myelosuppression`), the
   DOAC-CrCl note, the DMPA rule, and the ACB additions live on the `origin/main` lineage,
   **not here**. There is consequently no pending-confirmation string in this branch's rule
   files to edit. Any provenance-note refresh must be applied on the branch that actually
   carries Phase-2.

For both reasons, **no clinical rule file was modified.** This markdown is the honest
status record of the reconfirmation attempt, plus two findings the CSO should action on the
Phase-2 lineage:

- **Item 2:** soften "febuxostat: contraindicated" → "febuxostat: not recommended (avoid;
  20% dose reduction if unavoidable)" to match the current UK emc SmPC wording.
- **Item 5:** re-check **amantadine**'s ACB score against the live ACBcalc entry — available
  primary-scale text indicates **score 1**, not the score 2 currently encoded.
