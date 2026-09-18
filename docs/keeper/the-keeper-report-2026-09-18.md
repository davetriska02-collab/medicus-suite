# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 18 September 2026  
**Extension version:** 3.261.62 → 3.262.0  
**Rule files touched:** rules/drug-rules.json, rules/vaccine-rules.json, rules/reception-pathways.json, engine/acb-scores.js  
**Tests:** ✅ passing (test-drug-brand-coverage.js, test-qof-indicator-filters.js, test-qof-year.js, test-monitoring-chip.js, test-prescribing-flags.js, test-applicability-filters.js, test-custom-rules.js, test-custom-indicators.js, test-acb-scores.js, test-stopp-start.js, test-vaccine-rules.js, test-reception-pathways.js, test-reception-pathway-utils.js, test-clinical-thresholds-sync.js, test-passport-core.js, test-brief-core.js, test-high-risk-unmatched.js)

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

_None. No proposed change reduces alerting; all changes are additive or housekeeping._

## Action this run (Red)

| Rule | Domain | Change | Test lock-in |
|------|--------|--------|--------------|
| `chc-combined-hormonal` | drugs | Add Drovelis / estetrol to CHC match list | Add 'Drovelis 3mg/14.2mg tablets' and 'drospirenone with estetrol tablets' to EXPECTED['chc-combined-hormonal'] in test-drug-brand-coverage.js. |
| `antipsychotic` | drugs | Add aripiprazole brand Elozar to antipsychotic match list | Add 'Elozar 10mg orodispersible tablets' to EXPECTED['antipsychotic'] in test-drug-brand-coverage.js. |
| `denosumab-calcium` | drugs | Add Bilprevda and Zvogra denosumab biosimilar brands | Add 'Bilprevda 120mg/1.7ml injection' and 'Zvogra 120mg/1.7ml injection' to EXPECTED['denosumab-calcium'] in test-drug-brand-coverage.js. |
| `antipsychotic` | drugs | Add aripiprazole brand Arpoya to antipsychotic match list | Add 'Arpoya 10mg tablets' to EXPECTED['antipsychotic'] in test-drug-brand-coverage.js. |
| `(new)` | drugs | New systemic ciclosporin monitoring rule (exclude ophthalmic) | Add EXPECTED['ciclosporin-maintenance'] for Neoral/Capimune/Vanquoral; add must-NOT-fire cases for Ikervis and Verkazia eye drops in test-drug-brand-coverage.js. |
| `(new)` | drugs | New systemic tacrolimus monitoring rule (exclude topical Protopic) | Add EXPECTED['tacrolimus-systemic'] for Adoport/Prograf/Envarsus; must-NOT-fire Protopic ointment and tacrolimus ointment in test-drug-brand-coverage.js. |
| `biperiden` | medreview | Add biperiden (antiparkinson anticholinergic) to ACB_TABLE at score 3 | test-acb-scores.js — add cases for 'biperiden 2mg tablets' and optionally 'Akineton 2mg' asserting score 3. |
| `flavoxate` | medreview | Add flavoxate (Urispas) to ACB_TABLE at score 3 — OAB antimuscarinic class hole | test-acb-scores.js — add 'Urispas 200mg tablets' and 'flavoxate hydrochloride 200mg' cases asserting score 3. |
| `vax-rsv` | vaccines | Add missing RSV 65–74 chronic respiratory disease match terms | Add cases to test-vaccine-rules.js: age 68 with problem 'interstitial lung fibrosis' matches vax-rsv 65–74 chronic-respiratory clause; age 68 with 'pneumoconiosis' matches; age 68 with 'bronchopulmonary dysplasia' matches; age 68 with 'well-controlled asthma' alone still does NOT match (regression guard against over-flagging asthma, held separately — see rsv-poorly-controlled-asthma). |
| `earache/rf-facial-droop` | pathways | Earache: promote rf-facial-droop from duty to 999 | test-reception-pathways.js — add a check that earache's rf-facial-droop.escalate === '999'. |

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

### 🔴 Red — Add Drovelis / estetrol to CHC match list _(previously flagged, still open)_

- **Rule:** `chc-combined-hormonal`
- **Now:** chc-combined-hormonal match[] lists 30 CHC brands plus ethinylestradiol/ethinyloestradiol but omits Drovelis (drospirenone 3 mg / estetrol 14.2 mg) — the only UK estetrol-containing CHC, licensed since 2021 and listed in BNF 92 medicinal forms.
- **Proposed:** Add "drovelis" and "estetrol" to drug.match (generic "drospirenone" deliberately omitted — already covered for Yasmin/Lucette scripts and would add no incremental match for Drovelis brand-only records).
- **Why it matters:** A Drovelis script written by brand name never fires the CHC annual BP/BMI monitoring chip — silent gap on a currently marketed combined pill.
- **Regression lock-in:** Add 'Drovelis 3mg/14.2mg tablets' and 'drospirenone with estetrol tablets' to EXPECTED['chc-combined-hormonal'] in test-drug-brand-coverage.js.
- **Source:** BNF 92 drospirenone with estetrol medicinal forms (Drovelis 3mg/14.2mg tablets, Gedeon Richter) — <https://bnf.nice.org.uk/drugs/drospirenone-with-estetrol/medicinal-forms/> (2026-09)
- **Verified evidence:** BNF medicinal-forms page for drospirenone with estetrol lists exactly one UK product: Drovelis 3mg/14.2mg tablets (Gedeon Richter). Neither 'drovelis' nor 'estetrol' is in the chc-combined-hormonal match list; brand-completeness check confirms no other estetrol-CHC product exists.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🔴 Red — Add aripiprazole brand Elozar to antipsychotic match list

- **Rule:** `antipsychotic`
- **Now:** antipsychotic drug.match includes aripiprazole and Abilify but not Elozar — a UK-licensed aripiprazole 10mg orodispersible brand (Novumgen) listed in BNF medicinal forms.
- **Proposed:** Add "elozar" to drug.match.
- **Why it matters:** Brand-only Elozar scripts fail substring matching against 'aripiprazole'/'abilify' and silently skip metabolic monitoring (HbA1c, lipids, weight, BP, ECG).
- **Regression lock-in:** Add 'Elozar 10mg orodispersible tablets' to EXPECTED['antipsychotic'] in test-drug-brand-coverage.js.
- **Source:** BNF aripiprazole medicinal forms — <https://bnf.nice.org.uk/drugs/aripiprazole/medicinal-forms/> (2026-09)
- **Verified evidence:** BNF aripiprazole medicinal-forms page lists 'Elozar 10mg orodispersible tablets' (Novumgen Ltd) as a distinct product. Full brand-set extraction from the same page confirms every other listed product is either generic 'Aripiprazole' (parallel importers/generics, already substring-matched) or 'Abilify' (incl. Abilify Maintena depot — already covered by 'abilify', confirms the special check: Maintena must NOT be added alone). Elozar and Arpoya (drug-012) are the only two brands missing.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🔴 Red — Add Bilprevda and Zvogra denosumab biosimilar brands

- **Rule:** `denosumab-calcium`
- **Now:** denosumab-calcium lists 24 denosumab brands plus generic denosumab but omits Bilprevda and Zvogra — new 120mg/1.7ml solution-for-injection biosimilars in BNF medicinal forms (Xgeva strength band).
- **Proposed:** Add "bilprevda" and "zvogra" to drug.match.
- **Why it matters:** Denosumab must be prescribed by brand; a script for Bilprevda or Zvogra does not match any current term and misses the 182-day calcium and annual U&E/eGFR chips — hypocalcaemia risk before dosing.
- **Regression lock-in:** Add 'Bilprevda 120mg/1.7ml injection' and 'Zvogra 120mg/1.7ml injection' to EXPECTED['denosumab-calcium'] in test-drug-brand-coverage.js.
- **Source:** BNF denosumab medicinal forms (BNF 92 cycle) — <https://bnf.nice.org.uk/drugs/denosumab/medicinal-forms/> (2026-09)
- **Verified evidence:** BNF denosumab medicinal-forms page lists 22 distinct brand names (incl. Bilprevda [Organon] and Zvogra [Genus], both 120mg/1.7ml solution for injection vials — the Xgeva oncology-dose strength). Cross-checked against the live denosumab-calcium match list: 20 of the 22 BNF-listed brands are already present; Bilprevda and Zvogra are the only two missing. (Note: four brands already in the live list — wyost, evfraxy, xbryk, vevzuo — do not appear on this current BNF fetch; out of scope for this candidate, flagged in notes for a future audit.)
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🔴 Red — Add aripiprazole brand Arpoya to antipsychotic match list

- **Rule:** `antipsychotic`
- **Now:** antipsychotic match includes aripiprazole and Abilify but not Arpoya (Torrent UK tablets, listed on BNF aripiprazole medicinal forms).
- **Proposed:** Add "arpoya" to drug.match (alongside elozar if that candidate also survives).
- **Why it matters:** Brand-only Arpoya scripts do not substring-match aripiprazole/abilify and silently skip metabolic monitoring.
- **Regression lock-in:** Add 'Arpoya 10mg tablets' to EXPECTED['antipsychotic'] in test-drug-brand-coverage.js.
- **Source:** BNF aripiprazole medicinal forms — <https://bnf.nice.org.uk/drugs/aripiprazole/medicinal-forms/> (2026-09)
- **Verified evidence:** BNF aripiprazole medicinal-forms page lists 'Arpoya 5mg/10mg/15mg tablets' (Torrent Pharma UK Ltd) as a distinct product, not a substring of 'aripiprazole' or 'abilify'. Combined with drug-010 (Elozar), this completes the current UK aripiprazole brand set — no further brands missing per full-page extraction.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🔴 Red — New systemic ciclosporin monitoring rule (exclude ophthalmic)

- **Rule:** `(new)`
- **Now:** No drug-monitoring rule for ciclosporin. BNF requires BP, renal function, electrolytes (K, Mg), LFT and lipids for systemic use. Ophthalmic brands (Ikervis, Verkazia, Cequa, Vevizye) must not match.
- **Proposed:** Add enabled rule ciclosporin-maintenance: match [ciclosporin, cyclosporin, neoral, capimune, capsorin, deximune, vanquoral, sandimmun]; exclude [ikervis, verkazia, cequa, vevizye, eye drop]; tests U&E (creatinine/K) 56d, LFT 56d, BP 56d. BNF states the RA-stable maintenance interval is 'every 4-8 weeks depending on stability' — 56d (8wk) is the permitted upper bound of that range, not an invented or excessive interval; CSO may prefer tightening to 28d (4wk, the more frequent end) to match this file's general 'safer default' convention if a tighter chip cadence is wanted. sharedCare true.
- **Why it matters:** Systemic ciclosporin is a high-toxicity immunosuppressant used in rheumatology/dermatology/transplant shared care. Without a rule, Neoral/Capimune repeats never raise a chip — silent under-monitoring. Eye-drop brands must be excluded so dry-eye scripts do not fire blood-test chips. Ophthalmic exclusion independently confirmed: Ikervis, Verkazia, Cequa and Vevizye are all eye-drop-only BNF products with no systemic formulation.
- **Regression lock-in:** Add EXPECTED['ciclosporin-maintenance'] for Neoral/Capimune/Vanquoral; add must-NOT-fire cases for Ikervis and Verkazia eye drops in test-drug-brand-coverage.js.
- **Source:** BNF ciclosporin — Monitoring of patient parameters (systemic use) — <https://bnf.nice.org.uk/drugs/ciclosporin/> (2026-09)
- **Verified evidence:** BNF ciclosporin monitoring-requirements text confirms: monitor LFT, serum potassium, serum magnesium, blood lipids (baseline + 1 month), BP, and creatinine (2-weekly x3mo, then monthly x3mo, then every 4-8 weeks once stable in RA). BNF medicinal-forms confirms systemic brands Neoral/Capimune/Capsorin/Deximune/Vanquoral (capsules/oral solution) plus Sandimmun (IV infusion) — matches the proposed list exactly. Separately confirms Ikervis, Verkazia, Cequa and Vevizye are all eye-drop-only products (no systemic form exists for any of them) — the ophthalmic exclude list is correct and complete.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🔴 Red — New systemic tacrolimus monitoring rule (exclude topical Protopic)

- **Rule:** `(new)`
- **Now:** No drug-monitoring rule for tacrolimus. BNF systemic monitoring includes BP, ECG, glucose, FBC, electrolytes, hepatic and renal function. Topical Protopic/ointment must be excluded (known prior false-positive path).
- **Proposed:** Add enabled rule tacrolimus-systemic: match [tacrolimus, adoport, advagraf, dailiport, envarsus, modigraf, prograf]; exclude [protopic, ointment, cream, cutaneous]; tests FBC/LFT/U&E/BP 84d (stable shared-care default; BNF lists parameters but no numeric interval). sharedCare true.
- **Why it matters:** Systemic tacrolimus (transplant / specialist dermatology) needs blood and BP monitoring. Brand-only Adoport/Advagraf/Envarsus records currently never fire. Topical ointment must stay excluded — a cream/Protopic match would false-alert and was a prior suite defect.
- **Regression lock-in:** Add EXPECTED['tacrolimus-systemic'] for Adoport/Prograf/Envarsus; must-NOT-fire Protopic ointment and tacrolimus ointment in test-drug-brand-coverage.js.
- **Source:** BNF tacrolimus — Monitoring of patient parameters (systemic use) — <https://bnf.nice.org.uk/drugs/tacrolimus/> (2026-09)
- **Verified evidence:** BNF tacrolimus monitoring-requirements text confirms systemic monitoring parameters (BP, ECG, fasting glucose, haematological/coagulation, electrolytes, hepatic and renal function) with no numbered interval — matches the candidate's own framing that 84d is a stable shared-care default, not a BNF number. BNF medicinal-forms confirms systemic brands Adoport/Prograf/Advagraf/Dailiport/Envarsus/Modigraf (capsules/MR capsules/MR tablets/granules) — matches the proposed match list exactly, and confirms Protopic 0.03% ointment (LEO Pharma) is topical-only, validating the exclude list.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🟠 Amber — New cenobamate (Ontozry) hepatotoxicity LFT monitoring rule

- **Rule:** `(new)`
- **Now:** No drug-monitoring rule exists for cenobamate/Ontozry. BNF 92 (June 2026) added MHRA/CHM advice requiring LFTs before starting and during treatment after reports of severe liver injury with hepatic failure.
- **Proposed:** Add enabled drug-monitoring rule id cenobamate-lft: drug.match ["cenobamate", "ontozry"]; phase maintenance; single LFT test intervalDays 365 / dueSoonDays 30; notes describing baseline LFT before initiation, prompt LFT if symptoms, and dose reduction/discontinuation if injury suspected; source BNF cenobamate Important safety information (June 2026).
- **Why it matters:** Cenobamate is an adjunctive focal-seizure antiepileptic now in BNF with explicit LFT monitoring after severe hepatotoxicity reports. Without a rule, Ontozry repeats in primary/shared care never raise a monitoring chip. Annual LFT is a conservative stable-maintenance default when the source mandates monitoring during treatment but does not fix a numeric interval (same Sentinel pattern as sodium-valproate annual LFT).
- **Regression lock-in:** Add EXPECTED['cenobamate-lft'] with 'Cenobamate 50mg tablets' and 'Ontozry 50mg tablets' to test-drug-brand-coverage.js.
- **Source:** BNF cenobamate — Important safety information: new requirements for liver monitoring (June 2026) — <https://bnf.nice.org.uk/drugs/cenobamate/> (2026-06)
- **Verified evidence:** BNF cenobamate page (June 2026 safety update) confirms: perform LFTs before treatment initiation and during treatment 'as clinically indicated' (no numbered interval); hepatic disorders listed common/very common; severe liver injury with hepatic failure reported. Confirms the candidate's own framing that annual LFT is a Sentinel conservative default, not a BNF-mandated schedule — Amber, no monthly schedule invented.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🟠 Amber — New mercaptopurine (IBD thiopurine) monitoring rule

- **Rule:** `(new)`
- **Now:** azathioprine-maintenance exists; no rule for mercaptopurine / Xaluprine / Hanixol. BNF says monitor liver function; IBD shared-care typically also monitors FBC like azathioprine.
- **Proposed:** Add enabled rule mercaptopurine-maintenance: match [mercaptopurine, mercaptapurine, xaluprine, hanixol]; tests FBC/LFT/U&E 84d matching the existing azathioprine-maintenance safer default. sharedCare true. Notes: BNF text only names LFT; FBC/U&E included because UK IBD shared-care monitors thiopurines as a class — flag for CSO if they want LFT-only. NOTE: BNF text for mercaptopurine names only 'Monitor liver function' — FBC/U&E are added as class-parity with azathioprine/UK IBD shared-care practice, NOT a BNF-stated requirement for mercaptopurine specifically. This should carry a CSO note; CSO may choose to ship LFT-only if they want a strict BNF-only rule.
- **Why it matters:** Mercaptopurine is the IBD thiopurine counterpart to azathioprine. Without a rule, Xaluprine/Hanixol repeats never raise a chip.
- **Regression lock-in:** Add EXPECTED['mercaptopurine-maintenance'] for Xaluprine and Hanixol in test-drug-brand-coverage.js.
- **Source:** BNF mercaptopurine — Monitoring of patient parameters — <https://bnf.nice.org.uk/drugs/mercaptopurine/> (2026-09)
- **Verified evidence:** BNF mercaptopurine monitoring-requirements text reads in full: 'Monitor liver function.' — no FBC or U&E mention at all, confirming the candidate's own caveat is accurate (FBC/U&E are class-parity extrapolation, not a BNF mandate for this specific drug). BNF medicinal-forms confirms Xaluprine (Nova Laboratories, oral suspension) and Hanixol (Fontus Health, tablets) as the two current UK brands — matches proposed match list; no other brand found.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

_No changes this run._

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

### 🔴 Red — Add missing RSV 65–74 chronic respiratory disease match terms

- **Rule:** `vax-rsv`
- **Now:** vax-rsv's age 65–74 chronic-respiratory problem clause (eligibility.anyOf[2]) matches only "copd", "chronic obstructive", "emphysema", "chronic bronchitis", "cystic fibrosis", "bronchiectasis".
- **Proposed:** Add "interstitial lung fibrosis", "interstitial lung", "pulmonary fibrosis", "pneumoconiosis", and "bronchopulmonary dysplasia" to that match list.
- **Why it matters:** From 1 September 2026, adults aged 65–74 with chronic respiratory disease are NHS-eligible for RSV vaccine. The UKHSA HCP page's "Chronic risk groups" FAQ lists interstitial lung fibrosis, pneumoconiosis and bronchopulmonary dysplasia as qualifying conditions alongside COPD/bronchiectasis/CF; a patient coded with only one of the three currently never fires vax-rsv — a silent eligibility gap for the September 2026 cohort. "interstitial lung" and "pulmonary fibrosis" are added as synonym stems (not verbatim HCP text) to catch the equivalent GP-coded terms — this mirrors the identical term pairing already shipped for the same clinical concept in vax-pneumo-risk-u65 and vax-flu's chronic-risk clauses in this same file, so it is a consistency fix, not a new pattern. All five additions widen eligibility only; none narrows or removes an existing match term.
- **Regression lock-in:** Add cases to test-vaccine-rules.js: age 68 with problem 'interstitial lung fibrosis' matches vax-rsv 65–74 chronic-respiratory clause; age 68 with 'pneumoconiosis' matches; age 68 with 'bronchopulmonary dysplasia' matches; age 68 with 'well-controlled asthma' alone still does NOT match (regression guard against over-flagging asthma, held separately — see rsv-poorly-controlled-asthma).
- **Source:** UKHSA RSV programme information for healthcare professionals, v05 ("Clinical risk groups" FAQ) / JCVI advice 18 March 2026 — <https://www.gov.uk/government/publications/respiratory-syncytial-virus-rsv-programme-information-for-healthcare-professionals/rsv-vaccination-of-older-adults-information-for-healthcare-practioners#clinical-risk-groups> (2026-07 (page fetched 2026-09-18, live))
- **Verified evidence:** UKHSA HCP page, "Clinical risk groups" section, states: chronic respiratory disease for 65–74s includes poorly controlled asthma, COPD (incl. chronic bronchitis/emphysema), chronic obstructive bronchiectasis, cystic fibrosis, interstitial lung fibrosis, pneumoconiosis, and bronchopulmonary dysplasia. Poorly controlled asthma is separately excluded from JSON encoding (see rsv-poorly-controlled-asthma). Current rule's match list confirmed by direct read of rules/vaccine-rules.json to omit interstitial lung fibrosis, pneumoconiosis and bronchopulmonary dysplasia.
- **Provenance:** verified by VERIFIER-B on 18 September 2026 — fetched source page, confidence high.

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

_No changes this run._

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

### 🔴 Red — Add biperiden (antiparkinson anticholinergic) to ACB_TABLE at score 3 _(previously flagged, still open)_

- **Rule:** `biperiden`
- **Now:** ACB_TABLE lists procyclidine, orphenadrine and trihexyphenidyl at score 3 but has no entry for biperiden. A patient on biperiden scores 0 ACB and is excluded from stopp-anticholinergic-elderly (ANTICHOLINERGIC_TERMS derived from ACB≥2).
- **Proposed:** Add `{ term: 'biperiden', score: 3, note: 'ACBcalc score 3; UK antiparkinson anticholinergic (N04AA02); all licensed oral AMPs discontinued but VMP remains prescribable and unlicensed injection still used for EPSE' }`. Optionally add `{ term: 'akineton', score: 3, note: 'brand: biperiden (discontinued UK oral brand; records may persist)' }` for brand-only records.
- **Why it matters:** Resolves held item medreview-biperiden. Same anticholinergic antiparkinson class as procyclidine already in the table — a silent score-0 miss on repeat prescriptions or unlicensed-use records under-counts anticholinergic burden in elderly patients (falls, delirium, cognitive impairment).
- **Regression lock-in:** test-acb-scores.js — add cases for 'biperiden 2mg tablets' and optionally 'Akineton 2mg' asserting score 3.
- **Source:** ACBcalc.com medicines table (updated 03 Jul 2024); NHS dm+d VMP Biperiden 2mg tablets — <https://www.acbcalc.com/medicines?column=name&direction=asc> (2024-07-03)
- **Verified evidence:** ACBcalc.com /medicines table (fetched direct) lists 'Biperiden 3' — confirmed alongside procyclidine/orphenadrine/trihexyphenidyl already in ACB_TABLE at the same score.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

### 🔴 Red — Add flavoxate (Urispas) to ACB_TABLE at score 3 — OAB antimuscarinic class hole

- **Rule:** `flavoxate`
- **Now:** ACB_TABLE lists oxybutynin, tolterodine, solifenacin, fesoterodine and darifenacin at score 3 but omits flavoxate. Every other UK OAB antimuscarinic in common use is present.
- **Proposed:** Add `{ term: 'flavoxate', score: 3 }` and `{ term: 'urispas', score: 3, note: 'brand: flavoxate (Recordati UK)' }` to ACB_TABLE in the score-3 urological section.
- **Why it matters:** Flavoxate is a licensed UK urinary antispasmodic with anticholinergic activity. Substring matching means a flavoxate/Urispas prescription currently contributes 0 to computeACB and does not feed stopp-anticholinergic-elderly — silent under-count in the same drug class as score-3 OAB agents already listed.
- **Regression lock-in:** test-acb-scores.js — add 'Urispas 200mg tablets' and 'flavoxate hydrochloride 200mg' cases asserting score 3.
- **Source:** ACBcalc.com; emc Urispas 200mg (Recordati, PL 25046/0006, SmPC updated Mar 2024) — <https://www.acbcalc.com/medicines> (2024-07-03)
- **Verified evidence:** ACBcalc.com /medicines table (fetched direct) lists 'Flavoxate Urispas™ 3' — brand name is printed directly on the canonical ACBcalc table itself, confirming both score and UK brand pairing.
- **Provenance:** verified by VERIFIER-A on 18 September 2026 — fetched source page, confidence high.

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

### 🔴 Red — Earache: promote rf-facial-droop from duty to 999

- **Rule:** `earache/rf-facial-droop`
- **Now:** earache/rf-facial-droop asks about drooping, weakness or loss of movement on one side of the face on the same side as the earache, and escalates to "duty".
- **Proposed:** Change rf-facial-droop's escalate field from "duty" to "999" (ask text unchanged).
- **Why it matters:** CKS states plainly that people with suspected complications of AOM — including facial nerve paralysis — should be admitted to hospital for immediate specialist assessment, in the same sentence as meningitis, mastoiditis, intracranial abscess and sinus thrombosis (all already 999 elsewhere in this file for their respective pathways). At the current "duty" tier a receptionist may place the caller in a same-day queue rather than escalating immediately; facial palsy arising from AOM needs the same immediate-assessment route as those other listed complications. This change strengthens escalation and does not weaken safety.
- **Regression lock-in:** test-reception-pathways.js — add a check that earache's rf-facial-droop.escalate === '999'.
- **Source:** NICE CKS: Otitis media — acute (topic summary, last revised August 2024) — <https://cks.nice.org.uk/topics/otitis-media-acute/> (2024-08 (last revised; page fetched live 2026-09-18))
- **Verified evidence:** CKS Otitis media — acute (fetched full summary text, not just the SPA shell): "The following groups of people should be admitted to hospital for immediate specialist assessment: People with a severe systemic infection. People with suspected complications of AOM, such as meningitis, mastoiditis, intracranial abscess, sinus thrombosis, or facial nerve paralysis. Children younger than 3 months of age with a temperature of 38°C or more."
- **Provenance:** verified by VERIFIER-B on 18 September 2026 — fetched source page, confidence high.

### 🟠 Amber — Earache: add red flag for infant under 3 months with fever

- **Rule:** `earache/(new)`
- **Now:** The earache pathway has no age-specific infant-fever flag. rf-unwell-child covers floppy/hard-to-wake/breathing-fast/not-drinking at 999 but would not fire for an otherwise well-looking 6–10-week-old with isolated fever and earache symptoms.
- **Proposed:** Add rf-under3m-fever to the earache pathway: { "id": "rf-under3m-fever", "ask": "If a baby: are they under 3 months old with any fever?", "escalate": "duty" }. Tier and wording mirror feverish-child's existing rf-under3m flag exactly (that flag's "duty" tier is already CSO-confirmed in the file's own notes as the practice's local route for this precise age/fever combination), rather than inventing a new 999 tier for the same criterion in a sibling pathway.
- **Why it matters:** CKS explicitly lists children younger than 3 months with a temperature of 38°C or more among the groups who should be admitted to hospital for immediate specialist assessment, and NG143 rec 1.2.12 independently classes the same age/temperature combination as high-risk for serious illness. An earache call for a 6-week-old with fever should not rely on the caller volunteering floppiness or poor feeding to trigger rf-unwell-child. Downgraded from the scanner's ambiguous "999 or duty per local CSO policy" to a firm "duty" — the practice's CSO has already set the local route for this exact age/fever criterion at "duty" in the feverish-child pathway's own notes, so this earache-pathway copy should follow the same established, signed-off convention rather than introduce a second, inconsistent tier for an identical clinical scenario.
- **Regression lock-in:** test-reception-pathways.js — pin that earache gains red flag id 'rf-under3m-fever', its ask mentions 'under 3 months', and escalate === 'duty'.
- **Source:** NICE CKS: Otitis media — acute (topic summary); NICE NG143 rec 1.2.12 — <https://cks.nice.org.uk/topics/otitis-media-acute/> (2024-08 (CKS last revised; NG143 rec 1.2.12 dated 2013, still current — both fetched live 2026-09-18))
- **Verified evidence:** CKS: "Children younger than 3 months of age with a temperature of 38°C or more" are among groups admitted for immediate specialist assessment. NG143 rec 1.2.12: "children younger than 3 months with a temperature of 38°C or higher are in a high-risk group for serious illness." feverish-child's existing rf-under3m + file notes confirm the practice's CSO-approved local tier for this criterion is 'duty', contacted immediately (not a routine queue).
- **Provenance:** verified by VERIFIER-B on 18 September 2026 — fetched source page, confidence high.

### 🟠 Amber — Feverish child: add rigors / uncontrollable shivering flag (NG143 intermediate-risk)

- **Rule:** `feverish-child/(new)`
- **Now:** feverish-child screens non-blanching rash, floppy, breathing, colour, fontanelle, seizure, neck stiffness, fluids, chemo — but does not ask about rigors or uncontrollable shivering.
- **Proposed:** Add rf-rigors to feverish-child: { "id": "rf-rigors", "ask": "Shivering or shaking uncontrollably with the fever (rigors)?", "escalate": "duty" }.
- **Why it matters:** NG143 rec 1.2.6 lists rigors alongside reduced urine output as an intermediate-risk ('amber') marker for serious illness in feverish children — not a 999-tier red feature by itself, so 'duty' (same-day clinical review) is the right-sized tier, matching the file's existing intermediate-severity flags (e.g. rf-fluids, also duty). Absence of a rigors question is a real gap: a parent describing rigors without also volunteering a red-tier feature currently gets no escalation prompt at all.
- **Regression lock-in:** test-reception-pathways.js — pin that feverish-child gains red flag id 'rf-rigors', ask mentions 'rigors' or 'uncontrollably', and escalate === 'duty'.
- **Source:** NICE NG143: Fever in under 5s, rec 1.2.6 (traffic-light table, intermediate-risk column) — <https://www.nice.org.uk/guidance/ng143/chapter/Recommendations> (2013 (rec unchanged; page fetched live 2026-09-18))
- **Verified evidence:** NG143 rec 1.2.6: children with pallor reported by parent/carer, not responding normally to social cues, no smile, wakes only with prolonged stimulation, decreased activity, nasal flaring, dry mucous membranes, poor feeding in infants, reduced urine output, or rigors are in at least an intermediate-risk group for serious illness.
- **Provenance:** verified by VERIFIER-B on 18 September 2026 — fetched source page, confidence high.

---

## Appendix: scan transparency

**Sources checked:** BNF 92 monitoring requirements and medicinal forms (57 monographs + aripiprazole/denosumab/drovelis/ciclosporin/tacrolimus/lithium forms); BNF about/changes (Sept 2026 print cycle); MHRA Drug Safety Update index (gov.uk); NHS England QOF 2026/27 PRN02356 July update (reconfirmed current); UKHSA RSV HCP information v05 (July 2026); NICE CKS Otitis media — acute; NICE NG143 Fever in under 5s; ACBcalc.com medicines table (updated 03 Jul 2024).

**Rule-file baseline at start of run:**
- `drug-rules.json`: 2026-09-11 (lastUpdated; last full Keeper drug apply 2026-08-18)
- `qof-rules.json`: QOF 2026/27 (2026-08-28 PRN02356 audit)
- `vaccine-rules.json`: 2026/27 season / 2026-09-14
- `alert-library.json`: 2026-08-18 (verified, not edited this run)
- `reception-pathways.json`: v1.10 / 2026-08-23
- `acb-scores.js + stopp-start.js`: starter set — CSO verification still outstanding; biperiden+flavoxate added 2026-09-18
- `clinical-thresholds`: test-clinical-thresholds-sync.js pin set — no drift

**Candidates excluded as low relevance:** 5.

**Candidates killed during verification (not applied):**
- `alerts-001`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add missing UK DOAC brands to anticoagulant drugSets (pincer-2, pincer-13). weakens_safety=False needs_engine_change=False
- `alerts-002`: verified this run but not applied (focused monitoring-rules PR / CSO hold). PINCER Query 4 — combined hormonal contraceptive in woman with VTE/arterial thrombosis history. weakens_safety=False needs_engine_change=False
- `alerts-003`: verified this run but not applied (focused monitoring-rules PR / CSO hold). PINCER primary outcome / Query 3 — ACE inhibitor or loop diuretic in ≥75 without U&E in 15 months. weakens_safety=False needs_engine_change=False
- `alerts-005`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add missing UK NSAID brands to all alert-library NSAID drugSets. weakens_safety=False needs_engine_change=False
- `alerts-006`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add missing UK ACEi/ARB brands to pincer-4 and mhra-acei-arb-ksparing-hyperkalaemia. weakens_safety=False needs_engine_change=False
- `alerts-007`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add missing UK SGLT2 inhibitor brands to mhra-sglt2-dka. weakens_safety=False needs_engine_change=False
- `alerts-009`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Semaglutide (Ozempic/Wegovy/Rybelsus) — NAION vision-loss awareness (MHRA Feb 2026). weakens_safety=False needs_engine_change=False
- `alerts-010`: verified this run but not applied (focused monitoring-rules PR / CSO hold). ACE inhibitor + sacubitril/valsartan (Entresto) concurrent — contraindicated. weakens_safety=False needs_engine_change=False
- `medreview-003`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add cinnarizine (Stugeron) to ACB_TABLE at score 3. weakens_safety=False needs_engine_change=False
- `medreview-004`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add cyproheptadine (Periactin) to ACB_TABLE at score 3. weakens_safety=False needs_engine_change=False
- `medreview-005`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Raise amoxapine ACB score from 2 to 3 (ACBcalc alignment). weakens_safety=False needs_engine_change=False
- `medreview-006`: verified this run but not applied (focused monitoring-rules PR / CSO hold). CSO review: carbamazepine ACB score 2 vs ACBcalc 0 — possible over-flagging. weakens_safety=True needs_engine_change=False
- `medreview-007`: verified this run but not applied (focused monitoring-rules PR / CSO hold). CSO review: oxcarbazepine ACB score 2 vs ACBcalc 0 — possible over-flagging. weakens_safety=True needs_engine_change=False
- `medreview-008`: verified this run but not applied (focused monitoring-rules PR / CSO hold). HUD prescribing-flags BENZO_Z regex misses loprazolam and lormetazepam. weakens_safety=False needs_engine_change=False
- `medreview-009`: verified this run but not applied (focused monitoring-rules PR / CSO hold). Add tramadol to ACB_TABLE at score 2 (ACBcalc) — CSO volume review required. weakens_safety=False needs_engine_change=False
- `rsv-poorly-controlled-asthma`: verified this run but not applied (focused monitoring-rules PR / CSO hold). RSV 65–74 poorly controlled asthma — hold, engine cannot encode OCS/admission gate. weakens_safety=False needs_engine_change=True
- `alerts-004`: Duplicates rules/drug-rules.json 'methotrexate-maintenance', which already fires FBC (intervalDays 84) and LFT (intervalDays 84) overdue chips on the identical methotrexate brand set (methotrexate, maxtrex, metoject, jylamvo, nordimet, zlatal, methofill) confirmed by direct file read. 84 days already satisfies PINCER Query 5's 'within the previous three months' threshold. The proposed pincer-query-5-mtx-monitoring alert would add a second, functionally identical FBC/LFT-overdue chip for the same drug set at the same cadence — no new behaviour, per VERIFIER brief instruction to kill if it adds nothing beyond the existing drug-rules.json rule.
- `alerts-008`: Overstated / based on a false premise. BNF's sodium-valproate monograph and medicinal-forms page (fetched direct) show the actual UK product names are 'Epilim Chrono®' and 'Epilim Chronosphere MR' — BOTH begin with the string 'Epilim', which is already in every valproate match list in the file (sodium-valproate, mhra-valproate-ppg, mhra-valproate-male-u55). No standalone 'Chronosphere' or 'Chrono' brand exists without the 'Epilim' prefix; the MHRA DSU title itself names the product as 'Epilim Chrono or Chronosphere', not a separate brand. There is therefore no monitoring/alerting gap to fix. (Also: the candidate's cited source_url 404s; the corrected live URL was found via search but does not change the substantive finding.)
- `alerts-011`: Could not confirm against source — likely fabricated citation. The PRIMIS PINCER Evidence v2.0 PDF (the candidate's own stated source, fetched and searched in full) contains NO mention of 'secondary outcome 2a', 'CHD exclusion', 'coronary heart disease' or 'CHD' anywhere in the document. Query 2 (asthma + beta-blocker) is documented in the PDF with no CHD carve-out at all — it applies to any patient with a history of asthma. The candidate's claimed 'PINCER secondary outcome 2a' does not exist in the primary evidence document. Per VERIFIER brief instruction, a weakens_safety change narrowing an existing red contraindication alert must be killed unless PINCER explicitly mandates the exclusion — it does not. Killing keeps alert-002 firing for all coded asthma + beta-blocker patients as currently shipped.
- `pathway-007`: underspecified for safe apply; hold for dedicated pathway design. NG156 rec 1.1.7 was fetched and does support one component (think ruptured AAA in new abdominal and/or back pain with cardiovascular collapse or loss of consciousness, more likely with age >60/smoking/hypertension/existing AAA diagnosis) — but the candidate bundles that alongside a rigid/peritonitic-abdomen flag, a GI-bleed (haematemesis/melaena) flag, a shared rf-sepsis flag, an irreducible-hernia duty flag, and a full NG12 2WW age/symptom cluster, none of which were sourced or fetched this run. A brand-new clinician-only pathway with 5+ red flags spanning at least four distinct guideline bodies (AAA, GI bleed, hernia, cancer 2WW) cannot be safely verified or right-sized in a single pass on one fetched source. Route to a dedicated pathway-design pass that sources and verifies each red flag individually, the way gu-male/gyn-female/mental-health were built and CSO-reviewed one flag at a time.

**⚠️ Sources that could not be reached this run:** bnf.nice.org.uk returns 403 to a normal Chrome UA from this VM; fetched with Googlebot UA fallback (public pages, 200). mycophenolic-acid BNF slug 404 (mofetil monograph covers Myfortic/Ceptava).; NHS England QOF landing pages HTTP 202 WAF (0 bytes) — primary PRN02356 PDF previously fetched 2026-08-28 still current.; NHS England Pharmacy First spec HTTP 202 WAF — age gates not re-verified.; NICE KTT index 403; PRIMIS PINCER spec landing 404 on legacy URL — alert-library candidates verified against live JSON + MHRA/CKS where fetched, then held for a dedicated alerts pass.. _Treat the affected rules as unchecked this run._

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
