# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 20 June 2026  
**Extension version:** 3.123.0 → 3.124.0  
**Rule files touched:** rules/alert-library.json, engine/acb-scores.js, rules/drug-rules.json, rules/term-coverage-snapshot.json  
**Tests:** ✅ passing (test-alert-library-coverage.js, test-drug-brand-coverage.js, test-acb-scores.js, test-stopp-start.js, test-rule-schema.js, test-term-coverage.js, test-custom-rules.js, test-rule-currency.js, full suite (node --test test-*.js))

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

_None. No proposed change reduces alerting; all changes are additive or housekeeping._

## Action this run (Red)

| Rule | Domain | Change | Test lock-in |
|------|--------|--------|--------------|
| `pincer-mtx-trimethoprim` | alerts | Methotrexate + trimethoprim/co-trimoxazole — severe bone marrow suppression | EXPECTED['pincer-mtx-trimethoprim'] in test-alert-library-coverage.js + firing checks (MTX+trimethoprim, MTX+co-trimoxazole hyphen, MTX+nitrofurantoin must not). |
| `alert-xoi-thiopurine-myelosuppression` | alerts | Allopurinol/febuxostat + azathioprine/mercaptopurine — life-threatening myelosuppression | EXPECTED['alert-xoi-thiopurine-myelosuppression'] in test-alert-library-coverage.js + firing checks incl. Adenuric(brand)+mercaptopurine. |

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

### 🟠 Amber — Correct DOAC monitoring notes — CrCl (Cockcroft-Gault), not eGFR (no interval change)

- **Rule:** `doac`
- **Now:** doac rule notes reference 'eGFR' for renal-banded monitoring; intervalDays kept at 365.
- **Proposed:** Replace notes to specify CrCl (Cockcroft-Gault), not eGFR, with the renal/age banding (annual ≥60; 6-monthly 30–59; 3-monthly 15–29; contraindicated <15; CrCl/10 months; elderly/frail 4–6 monthly). 365-day default unchanged.
- **Why it matters:** eGFR is the wrong measure for DOAC monitoring/dose-adjustment — it overestimates clearance in low-weight elderly and raises bleeding risk. Notes correction only; the schema cannot encode CrCl-conditional intervals (flagged for an engine extension).
- **Regression lock-in:** none (notes-only; no match/interval change).
- **Source:** NHS SPS DOACs monitoring; EHRA practical guidance; 2024–2025 NHS ICB DOAC guidelines; MHRA — <https://www.sps.nhs.uk/monitorings/doacs-direct-oral-anticoagulants-monitoring/> (2025-04)
- **Verified evidence:** SE London ICS Jan 2024: 'Cockcroft and Gault is recommended for calculating creatinine clearance for DOACs. Use of eGFR is known to increase bleeding risk.' Bands and CrCl/10 formula consistent across multiple NHS ICB guidelines and EHRA. Primary SPS page 403.
- **Provenance:** verified by VERIFIER-1 on 20 June 2026 — corroborated, confidence high.

### 🟠 Amber — Add DMPA injectable-contraception monitoring rule (enabled)

- **Rule:** `dmpa-injectable`
- **Now:** No monitoring rule for depot medroxyprogesterone acetate (Depo-Provera, Sayana Press).
- **Proposed:** New drug-monitoring rule (sex F): 2-yearly (730d) BP + weight review; brand-only match (depo-provera, depo provera, sayana press, sayana, dmpa).
- **Why it matters:** Whole domain previously absent. FSRH mandates a 2-yearly risk/benefit review (BMD, weight). Brand-only match avoids colliding with the hrt-systemic rule's bare 'medroxyprogesterone' term.
- **Regression lock-in:** EXPECTED['dmpa-injectable'] + a MUST_NOT (oral MPA tablet) in test-drug-brand-coverage.js.
- **Source:** FSRH Clinical Guideline: Progestogen-only Injectables (Dec 2014, amended Jul 2023) — <https://www.fsrh.org/standards-and-guidance/> (2023-07)
- **Verified evidence:** FSRH injectable guidance mandates 2-yearly review; Depo-Provera and Sayana Press confirmed as the only UK DMPA brands; Noristerat (NET-EN) is a distinct short-term depot, out of scope. FSRH PDF 403 — medium confidence.
- **Provenance:** verified by VERIFIER-2 on 20 June 2026 — corroborated, confidence medium.

### 🟠 Amber — Add combined-hormonal-contraception monitoring rule (SHIPPED DISABLED — needs engine work)

- **Rule:** `chc-combined-hormonal`  ⚙️ _needs rules-engine extension — ship disabled with placeholder_
- **Now:** No monitoring rule for combined hormonal contraception (pills, Evra patch, NuvaRing/SyreniRing).
- **Proposed:** New drug-monitoring rule (sex F): annual BP + BMI; comprehensive UK brand match, POPs excluded. Shipped enabled:false.
- **Why it matters:** FSRH mandates annual BP+BMI for CHC users. SHIPPED DISABLED because the hrt-systemic rule matches the bare term 'estradiol', a substring of 'ethinylestradiol' (and of the natural-oestrogen pills' 'estradiol valerate'), so an enabled CHC rule would double-fire the HRT rule for oestrogen-ingredient / Qlaira / Zoely records. Enabling safely requires engine-level drug-class disambiguation.
- **Regression lock-in:** none yet — rule is enabled:false so the inverse-coverage check skips it; add EXPECTED when enabled.
- **Source:** FSRH Guideline: Combined Hormonal Contraception (Jan 2019, amended Oct 2023); NICE CKS Contraception — <https://www.fsrh.org/standards-and-guidance/> (2023-10)
- **Verified evidence:** FSRH CHC guideline + NICE CKS confirm BP+BMI at initiation, 3 months, then annually. Brand set verified against UK prescribing sources. needs_engine_change flagged for the ethinylestradiol/estradiol substring overlap with hrt-systemic. FSRH PDF 403 — medium confidence.
- **Provenance:** verified by VERIFIER-2 on 20 June 2026 — corroborated, confidence medium.

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

_No changes this run._

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

_No changes this run._

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

### 🔴 Red — Methotrexate + trimethoprim/co-trimoxazole — severe bone marrow suppression

- **Rule:** `pincer-mtx-trimethoprim`
- **Now:** No alert existed for methotrexate co-prescribed with trimethoprim or co-trimoxazole; the methotrexate-maintenance rule covers monitoring intervals only.
- **Proposed:** New drug-combo RED alert: Methotrexate set (methotrexate + brands, topical excluded) + Trimethoprim/Co-trimoxazole set (trimethoprim, co-trimoxazole, septrin).
- **Why it matters:** A patient on methotrexate co-prescribed trimethoprim or co-trimoxazole (common primary-care antibiotics) currently fires no alert. The combination causes severe, potentially fatal pancytopenia via additive antifolate effect; NHS SPS says avoid. The combo normaliser fix (Phase 1) ensures the hyphenated 'co-trimoxazole' matches correctly.
- **Regression lock-in:** EXPECTED['pincer-mtx-trimethoprim'] in test-alert-library-coverage.js + firing checks (MTX+trimethoprim, MTX+co-trimoxazole hyphen, MTX+nitrofurantoin must not).
- **Source:** NHS SPS 'Managing interactions with methotrexate'; MHRA/Medsafe; emc co-trimoxazole/methotrexate SmPC — <https://www.sps.nhs.uk/articles/managing-interactions-with-methotrexate/> (2026-03)
- **Verified evidence:** NHS SPS: 'Avoid prescribing co-trimoxazole or trimethoprim with methotrexate, due to the risk of severe bone marrow suppression.' Medsafe: some cases fatal; interaction may be delayed after recently stopping MTX. Primary pages returned HTTP 403; corroborated across SPS, Medsafe and emc SmPC content — pending primary-source confirmation.
- **Provenance:** verified by VERIFIER-1 on 20 June 2026 — corroborated, confidence high.

### 🔴 Red — Allopurinol/febuxostat + azathioprine/mercaptopurine — life-threatening myelosuppression

- **Rule:** `alert-xoi-thiopurine-myelosuppression`
- **Now:** No alert existed for xanthine-oxidase inhibitors co-prescribed with thiopurines.
- **Proposed:** New drug-combo RED alert: XOI set (allopurinol, zyloric, caplenal, uricto, febuxostat, adenuric) + Thiopurine set (azathioprine, mercaptopurine, imuran, azapress, jayempi, xaluprine). Brand terms added explicitly so brand-only records fire (substring matching).
- **Why it matters:** Accidental co-prescription (e.g. gout flare treated with allopurinol in a patient on azathioprine) is a silent, potentially fatal prescribing error. Allopurinol+thiopurine is a serious interaction requiring 25% dose reduction under specialist care; febuxostat+thiopurine is contraindicated (UK SmPC). Brand-completeness corrected: a 'Zyloric'/'Adenuric'/'Xaluprine' record would otherwise never fire under substring matching.
- **Regression lock-in:** EXPECTED['alert-xoi-thiopurine-myelosuppression'] in test-alert-library-coverage.js + firing checks incl. Adenuric(brand)+mercaptopurine.
- **Source:** emc allopurinol/mercaptopurine & Adenuric SmPCs; NHS shared-care guidance; Medsafe Sept 2020 — <https://www.medicines.org.uk/emc/product/4655/smpc> (2025-05)
- **Verified evidence:** UK mercaptopurine SmPC: 'Concomitant administration of other xanthine oxidase inhibitors, such as febuxostat, should be avoided'; allopurinol+thiopurine requires 25% dose. NHS shared-care guidance: 'DO NOT GIVE ALLOPURINOL TO PATIENTS ON AZATHIOPRINE/MERCAPTOPURINE unless advised by the specialist.' Medsafe: life-threatening. Primary emc pages 403; corroborated across multiple NHS regional guidelines.
- **Provenance:** verified by VERIFIER-1 on 20 June 2026 — corroborated, confidence high.

### 🟠 Amber — ACEi/ARB + potassium-sparing diuretic/aldosterone antagonist — hyperkalaemia

- **Rule:** `mhra-acei-arb-ksparing-hyperkalaemia`
- **Now:** No alert existed for ACEi/ARB co-prescribed with spironolactone/eplerenone/amiloride/triamterene or their combination products.
- **Proposed:** New drug-combo AMBER alert: ACEi/ARB set (mirrors pincer-4) + K-sparing/aldosterone-antagonist set (spironolactone, eplerenone, amiloride, triamterene, co-amilofruse, co-amilozide, co-triamterzide).
- **Why it matters:** MHRA confirmed fatal hyperkalaemia from this combination. Deliberately AMBER not Red: spironolactone + ACEi/ARB is guideline-endorsed four-pillar heart-failure therapy (NICE NG106); an unconditional Red would fire across the HF register and drown actionable alerts. Amber prompts a potassium/U&E check without implying the combination is wrong.
- **Regression lock-in:** EXPECTED['mhra-acei-arb-ksparing-hyperkalaemia'] in test-alert-library-coverage.js + firing checks (ramipril+spironolactone fires; ramipril alone does not).
- **Source:** MHRA Drug Safety Update 17 February 2016 — Spironolactone and renin-angiotensin system drugs: risk of potentially fatal hyperkalaemia — <https://www.gov.uk/drug-safety-update/spironolactone-and-renin-angiotensin-system-drugs-risk-of-hyperkalaemia> (2016-02)
- **Verified evidence:** MHRA DSU Feb 2016: monitoring of blood electrolytes essential when co-prescribing a K-sparing diuretic with an ACEi/ARB; a fatal case triggered the DSU; combination used in HF, mandating monitoring not prohibition. Severity right-sized Red→Amber per the HF four-pillar nuance. Primary page 403; corroborated via secondary NHS/regulatory sources.
- **Provenance:** verified by VERIFIER-1 on 20 June 2026 — corroborated, confidence high.

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

### 🟠 Amber — Add carbamazepine to ACB scale at score 2

- **Rule:** `carbamazepine`
- **Now:** carbamazepine absent from ACB_TABLE.
- **Proposed:** Add { term: 'carbamazepine', score: 2 }.
- **Why it matters:** Widely prescribed antiepileptic with definite ACB activity; absence meant patients on it received no anticholinergic-burden score — a silent under-count feeding STOPP anticholinergic-elderly.
- **Regression lock-in:** test-acb-scores.js: carbamazepine scores 2; matches own term not oxcarbazepine.
- **Source:** Campbell NL et al. 2012 update to the Boustani ACB scale (JAGS 2013); corroborated NHS ACB-scale reproductions — <https://research.aston.ac.uk/en/publications/the-2012-update-to-the-anticholinergic-cognitive-burden-scale/> (2013)
- **Verified evidence:** Campbell 2012 ACB update and multiple NHS ICB ACB-scale reproductions list carbamazepine at score 2. ACBcalc.com returned 403 — confidence medium, pending primary-source confirmation.
- **Provenance:** verified by VERIFIER-2 on 20 June 2026 — corroborated, confidence medium.

### 🟠 Amber — Add oxcarbazepine to ACB scale at score 2

- **Rule:** `oxcarbazepine`
- **Now:** oxcarbazepine absent from ACB_TABLE.
- **Proposed:** Add { term: 'oxcarbazepine', score: 2 }. No substring collision with carbamazepine (verified).
- **Why it matters:** UK-licensed antiepileptic (Trileptal/generic) on the ACB scale at score 2; was silently unscored.
- **Regression lock-in:** test-acb-scores.js: oxcarbazepine scores 2 and matches its own term (not carbamazepine).
- **Source:** Campbell NL et al. 2012 Boustani ACB update; corroborated — <https://research.aston.ac.uk/en/publications/the-2012-update-to-the-anticholinergic-cognitive-burden-scale/> (2013)
- **Verified evidence:** Multiple ACB-scale papers list carbamazepine and oxcarbazepine at score 2. Substring analysis confirms 'oxcarbazepine' does not contain 'carbamazepine'. ACBcalc 403 — medium confidence.
- **Provenance:** verified by VERIFIER-2 on 20 June 2026 — corroborated, confidence medium.

### 🟠 Amber — Add amantadine to ACB scale at score 2 (and remove from term-coverage 'dropped' audit list)

- **Rule:** `amantadine`
- **Now:** amantadine absent from ACB_TABLE and listed in rules/term-coverage-snapshot.json _droppedFromContentJs.terms (asserted to score 0).
- **Proposed:** Add { term: 'amantadine', score: 2 }; remove 'amantadine' from the term-coverage-snapshot dropped-terms audit list (it is now genuinely on the scale).
- **Why it matters:** Parkinson's-disease drug used in frail older patients at particular cognitive risk; on the ACB scale at score 2; was silently unscored.
- **Regression lock-in:** test-acb-scores.js: amantadine scores 2. test-term-coverage.js + term-coverage-snapshot.json updated (amantadine no longer a 'dropped' zero-score term — a reviewed re-add per the snapshot's own note).
- **Source:** Campbell NL et al. 2012 Boustani ACB update; corroborated — <https://research.aston.ac.uk/en/publications/the-2012-update-to-the-anticholinergic-cognitive-burden-scale/> (2013)
- **Verified evidence:** Multiple ACB-scale sources list amantadine at score 2; UK licensed for Parkinson's. ACBcalc 403 — medium confidence.
- **Provenance:** verified by VERIFIER-2 on 20 June 2026 — corroborated, confidence medium.

### 🟠 Amber — Add pethidine to ACB scale at score 2

- **Rule:** `pethidine`
- **Now:** pethidine absent from ACB_TABLE.
- **Proposed:** Add { term: 'pethidine', score: 2 }. US name 'meperidine' deliberately not added (not used on UK records).
- **Why it matters:** Opioid with definite ACB activity at score 2; UK-relevant under the name 'pethidine'.
- **Regression lock-in:** test-acb-scores.js: pethidine scores 2.
- **Source:** Boustani 2008 / Campbell 2012 ACB scale; corroborated — <https://www.sps.nhs.uk/category/medicine/pethidine/> (2024)
- **Verified evidence:** Multiple secondary sources citing Boustani list pethidine/meperidine at score 2; UK name confirmed pethidine. ACBcalc 403 — medium confidence.
- **Provenance:** verified by VERIFIER-2 on 20 June 2026 — corroborated, confidence medium.

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

_No changes this run._

---

## Appendix: scan transparency

**Sources checked:** NHS SPS — Managing interactions with methotrexate; DOACs monitoring; ACEi/ARB monitoring; MHRA Drug Safety Update (spironolactone + RAS drugs, Feb 2016); emc SmPCs (methotrexate, co-trimoxazole, allopurinol, Adenuric/febuxostat, mercaptopurine); Medsafe interaction reminders (MTX+trimethoprim; allopurinol+thiopurine); Boustani/Campbell Anticholinergic Cognitive Burden scale (ACBcalc.com / 2012 update); EHRA practical guidance on NOACs; multiple 2024–2025 NHS ICB DOAC guidelines; FSRH guidelines — Combined Hormonal Contraception (2023); Progestogen-only Injectables (2023); NICE CKS Contraception; NICE NG106 (heart failure); NICE NG203 (CKD).

**Rule-file baseline at start of run:**
- `alert-library.json`: 1.2 / 2026-06-14
- `drug-rules.json`: Sentinel drug rules - June 2026 review / 2026-06-14
- `acb-scores.js`: starter set — CSO verification standing work
- `qof-rules.json`: QOF 2026/27 (not in scope this run)
- `vaccine-rules.json`: 2025/26 season (not in scope this run)
- `reception-pathways.json`: not in scope this run

**Candidates excluded as low relevance:** 0.

**Candidates killed during verification (not applied):**
- `medrev-acb-cyclobenzaprine`: cyclobenzaprine is not UK-licensed (US drug) — would be dead code on UK records.
- `medrev-acb-loxapine`: loxapine UK-licensed only as Adasuve (hospital-only inhaled acute agitation); not a primary-care chronic medication.
- `medrev-acb-levomepromazine`: methotrimeprazine/levomepromazine is ACB score 3, NOT 2 — adding at 2 would under-score it. Genuine score-3 gap noted for a future run.
- `medrev-acb-cimetidine`: sources conflict on ACB score (1 vs 2); ACBcalc 403 — cannot adjudicate. Per verifier rules, score conflict = kill.
- `medrev-acb-baclofen`: sources conflict on ACB score (1 vs 2 across scales); ACBcalc 403. Score conflict = kill.

**⚠️ Sources that could not be reached this run:** bnf.nice.org.uk, gov.uk (MHRA/SPS), medicines.org.uk (emc), fsrh.org, acbcalc.com, NICE CKS — all returned HTTP 403 to direct fetch this run. Every change is corroborated across multiple independent NHS ICB / regulatory secondary sources and is flagged 'pending primary-source confirmation'; CSO to confirm against the primary page before clinical release.. _Treat the affected rules as unchecked this run._

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
