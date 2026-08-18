# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 18 August 2026  
**Extension version:** 3.232.0 → 3.233.0  
**Rule files touched:** rules/drug-rules.json, rules/vaccine-rules.json, rules/alert-library.json, rules/reception-pathways.json  
**Tests:** ✅ passing (test-drug-brand-coverage.js, test-alert-library-coverage.js, test-vaccine-rules.js, test-reception-pathways.js, test-rule-schema.js)

> **CSO SIGNED OFF 2026-08-18.** Dr D. Triska (CSO, GMC 6159481) approved the twelve applied additive changes below in session. Held / killed items (CKD002/003 disable, AST ID rename, NDH, RSV care-home `ageMin: 18`, CHC brand sweep, MEDREVIEW) remain **not applied**. This is not a full hazard-log or CSN re-baseline.

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

_None. No proposed change reduces alerting; all changes are additive or housekeeping._

## Action this run (Red)

| Rule | Domain | Change | Test lock-in |
|------|--------|--------|--------------|
| `warfarin-vka` | drugs | New warfarin / oral VKA INR monitoring rule (84 days) | Add EXPECTED['warfarin-vka'] in test-drug-brand-coverage.js (Warfarin, Marevan, Acenocoumarol, Sinthrome, Phenindione, Dindevan). |
| `ace-arb` | drugs | Add eprosartan / Teveten to ACE/ARB match list | Add 'Eprosartan 600mg tablets' and 'Teveten 600mg tablets' to EXPECTED['ace-arb']. |
| `antipsychotic` | drugs | Add Mintreleq XL and Sondate XL (quetiapine MR) | Add 'Mintreleq XL 200mg tablets' and 'Sondate XL 300mg tablets' to EXPECTED['antipsychotic']. |
| `carbamazepine-maintenance` | drugs | Add Curatil (carbamazepine PR) | Add 'Curatil PR 400mg tablets' to EXPECTED['carbamazepine-maintenance']. |
| `vax-rsv` | vaccines | Encode RSV 65–74 COPD and immunosuppression cohorts (from 1 Sept 2026) | test-vaccine-rules.js: age 70+COPD fires; age 70 no risk does not; age 70+asthma does not; age 64+COPD does not; age 70+lymphoma and age 70+mycophenolate fire. |
| `mhra-topiramate-ppp` | alerts | New topiramate Pregnancy Prevention Programme alert | Pin EXPECTED['mhra-topiramate-ppp'] and end-to-end fire Topamax in a 28-year-old female; must not fire for a male. |
| `mhra-warfarin-tramadol` | alerts | New warfarin / oral VKA + tramadol interaction alert | Pin EXPECTED['mhra-warfarin-tramadol'] and fire Marevan + Zydol; Marevan alone must not fire. |
| `pincer-7` | alerts | Add Marevan to PINCER #7 warfarin INR match | Add 'marevan' to EXPECTED['pincer-7'].drugTerms. |
| `sore-throat/rf-unwell-child` | pathways | Promote sore-throat unwell-child from duty to 999 | test-reception-pathways.js pins sore-throat rf-unwell-child escalate === '999'. |
| `headache/rf-household-co` | pathways | Add headache household-same-time carbon monoxide 999 flag | test-reception-pathways.js pins rf-household-co exists, escalate 999, ask mentions household / carbon monoxide. |

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

### 🔴 Red — New warfarin / oral VKA INR monitoring rule (84 days)

- **Rule:** `warfarin-vka`
- **Now:** No warfarin or other oral VKA monitoring rule in drug-rules.json. PINCER #7 in the alert library matches generic 'warfarin' only.
- **Proposed:** Add enabled rule warfarin-vka: match warfarin, marevan, acenocoumarol, sinthrome, phenindione, dindevan; INR intervalDays 84, dueSoonDays 14.
- **Why it matters:** A patient on Marevan, Sinthrome or phenindione currently generates no Sentinel INR chip. That is a silent monitoring gap on the highest-risk oral anticoagulant class.
- **Regression lock-in:** Add EXPECTED['warfarin-vka'] in test-drug-brand-coverage.js (Warfarin, Marevan, Acenocoumarol, Sinthrome, Phenindione, Dindevan).
- **Source:** BNF warfarin sodium — monitoring requirements — <https://bnf.nice.org.uk/drugs/warfarin-sodium/> (2026-08)
- **Verified evidence:** BNF warfarin-sodium monograph states INR monitoring at least every 12 weeks once stable; more often after dose change or interacting medicines.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🔴 Red — Add eprosartan / Teveten to ACE/ARB match list

- **Rule:** `ace-arb`
- **Now:** ace-arb drug.match listed the common UK ACE inhibitors and ARBs but not eprosartan or Teveten.
- **Proposed:** Add "eprosartan" and "teveten" to ace-arb drug.match.
- **Why it matters:** A script written as Teveten never fired the annual U&E/BP chip. Substring matching makes a missing brand a silent fail.
- **Regression lock-in:** Add 'Eprosartan 600mg tablets' and 'Teveten 600mg tablets' to EXPECTED['ace-arb'].
- **Source:** BNF eprosartan medicinal forms (Teveten 600mg, Viatris + generic) — <https://bnf.nice.org.uk/drugs/eprosartan/medicinal-forms/> (2026-08)
- **Verified evidence:** BNF medicinal forms list generic eprosartan and Teveten 600 mg (Viatris) as current UK presentations.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🔴 Red — Add Mintreleq XL and Sondate XL (quetiapine MR)

- **Rule:** `antipsychotic`
- **Now:** antipsychotic match listed quetiapine, Seroquel, Atrolak, Biquelle, Zaluron but not Mintreleq or Sondate.
- **Proposed:** Add "mintreleq" and "sondate" to antipsychotic drug.match.
- **Why it matters:** Brand-only quetiapine MR scripts as Mintreleq XL or Sondate XL never fired metabolic monitoring.
- **Regression lock-in:** Add 'Mintreleq XL 200mg tablets' and 'Sondate XL 300mg tablets' to EXPECTED['antipsychotic'].
- **Source:** BNF quetiapine medicinal forms — <https://bnf.nice.org.uk/drugs/quetiapine/medicinal-forms/> (2026-08)
- **Verified evidence:** BNF quetiapine modified-release medicinal forms list Mintreleq XL and Sondate XL as UK presentations.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🔴 Red — Add Curatil (carbamazepine PR)

- **Rule:** `carbamazepine-maintenance`
- **Now:** carbamazepine-maintenance match listed carbamazepine, tegretol, carbagen only.
- **Proposed:** Add "curatil" to carbamazepine-maintenance drug.match.
- **Why it matters:** A Curatil PR script never fired FBC/LFT/sodium/level monitoring.
- **Regression lock-in:** Add 'Curatil PR 400mg tablets' to EXPECTED['carbamazepine-maintenance'].
- **Source:** BNF carbamazepine medicinal forms — <https://bnf.nice.org.uk/drugs/carbamazepine/medicinal-forms/> (2026-08)
- **Verified evidence:** BNF carbamazepine medicinal forms list Curatil PR as a UK prolonged-release presentation.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🟠 Amber — New mycophenolate maintenance FBC/LFT/U&E rule (84 days)

- **Rule:** `mycophenolate-maintenance`
- **Now:** No mycophenolate monitoring rule. Patients on CellCept / Myfortic appeared only as unmatched immunosuppressants.
- **Proposed:** Add enabled rule mycophenolate-maintenance: match mycophenolate, mycophenolic acid, cellcept, myfenax, myfortic, ceptava; FBC, LFT, U&E intervalDays 84.
- **Why it matters:** Shared-care mycophenolate is used in primary care under protocol. Missing 12-weekly bloods is a silent safety gap. Interval kept at 12 weeks even if a local protocol later permits longer.
- **Regression lock-in:** Add EXPECTED['mycophenolate-maintenance'] covering CellCept, Myfenax, Myfortic, Ceptava.
- **Source:** SPS mycophenolate monitoring (updated 7 January 2026) — <https://www.sps.nhs.uk/monitorings/mycophenolate-mofetil-and-mycophenolic-acid-monitoring/> (2026-01-07)
- **Verified evidence:** SPS page dated 7 Jan 2026 states FBC, LFT and U&E at least 12-weekly once stable on mycophenolate / mycophenolic acid.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🟠 Amber — New fezolinetant / Veoza LFT monitoring rule (90 days)

- **Rule:** `fezolinetant-lft`
- **Now:** No fezolinetant rule. Veoza scripts generated no liver-function chip.
- **Proposed:** Add enabled rule fezolinetant-lft: match fezolinetant, veoza; LFT intervalDays 90. Notes describe monthly LFTs for the first 3 months (not engine-enforced).
- **Why it matters:** MHRA requires LFTs before treatment, monthly for 3 months, then periodically. A 90-day maintenance chip is a conservative periodic reminder; the monthly initiation phase is documented in notes because the engine cannot yet time-limit an initiation schedule.
- **Regression lock-in:** Add EXPECTED['fezolinetant-lft'] for Fezolinetant 45mg and Veoza 45mg.
- **Source:** MHRA Drug Safety Update 10 April 2025 — fezolinetant (Veoza) and risk of liver injury — <https://www.gov.uk/drug-safety-update/fezolinetant-veoza-risk-of-liver-injury-new-recommendations-to-minimise-risk> (2025-04-10)
- **Verified evidence:** MHRA DSU 10 Apr 2025 recommends LFTs before starting fezolinetant, monthly for the first 3 months, then periodically, and to stop if ALT/AST exceed 3× ULN or symptoms of liver injury appear.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

_No changes this run._

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

### 🔴 Red — Encode RSV 65–74 COPD and immunosuppression cohorts (from 1 Sept 2026) _(previously flagged, still open)_

- **Rule:** `vax-rsv`
- **Now:** vax-rsv eligibility was age 75+ or any-age care-home resident. 65–74 clinical-risk was notes-only because the engine previously ignored ageMin/ageMax on problem clauses.
- **Proposed:** Add three anyOf clauses, all ageMin 65 / ageMax 74: chronic respiratory problems (COPD, chronic bronchitis, emphysema, bronchiectasis, cystic fibrosis — not bare asthma); immunosuppression problems; listed immunosuppressant medications. Effective 1 Sept 2026.
- **Why it matters:** From 1 September 2026 a 68-year-old with COPD or on mycophenolate is eligible for NHS Abrysvo and would otherwise get no chip. Bare asthma is omitted on purpose — poorly-controlled asthma is in the source but needs a 24-month OCS/admission count the engine cannot do.
- **Regression lock-in:** test-vaccine-rules.js: age 70+COPD fires; age 70 no risk does not; age 70+asthma does not; age 64+COPD does not; age 70+lymphoma and age 70+mycophenolate fire.
- **Source:** UKHSA RSV healthcare-professional information v05 / NHSE operational letter 2 July 2026 — <https://www.gov.uk/government/publications/respiratory-syncytial-virus-rsv-programme-information-for-healthcare-professionals> (2026-07)
- **Verified evidence:** UKHSA HCP v05 / NHSE letter: from 1 Sept 2026 adults 65–74 with chronic respiratory disease (including poorly controlled asthma, chronic bronchitis, CF) or immunosuppression due to disease or treatment become eligible. CVD/liver/kidney not in this wave.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

### 🔴 Red — New topiramate Pregnancy Prevention Programme alert

- **Rule:** `mhra-topiramate-ppp`
- **Now:** Alert library had valproate PPP and isotretinoin PPP but nothing for topiramate.
- **Proposed:** Add mhra-topiramate-ppp: drug-combo topiramate/topamax, sex F, age 12–55, severity red.
- **Why it matters:** Topiramate has been under a mandatory PPP since June 2024. A woman of childbearing potential on Topamax currently gets no Sentinel reminder to check the annual form and contraception.
- **Regression lock-in:** Pin EXPECTED['mhra-topiramate-ppp'] and end-to-end fire Topamax in a 28-year-old female; must not fire for a male.
- **Source:** MHRA Drug Safety Update 20 June 2024 — topiramate new safety measures including a Pregnancy Prevention Programme — <https://www.gov.uk/drug-safety-update/topiramate-topamax-introduction-of-new-safety-measures-including-a-pregnancy-prevention-programme> (2024-06-20)
- **Verified evidence:** MHRA DSU 20 June 2024 introduces a Pregnancy Prevention Programme for topiramate: contraindicated in pregnancy and in women of childbearing potential unless PPP conditions are fulfilled.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🔴 Red — New warfarin / oral VKA + tramadol interaction alert

- **Rule:** `mhra-warfarin-tramadol`
- **Now:** No combo alert for tramadol with oral VKAs.
- **Proposed:** Add mhra-warfarin-tramadol: oral VKA set (warfarin, marevan, acenocoumarol, sinthrome, phenindione, dindevan) AND tramadol set (tramadol, zydol, tramulief, marol, maxitram, tradorec); severity red.
- **Why it matters:** Tramadol can raise INR and has been associated with serious bleeding on warfarin. A same-day script of Zydol on a Marevan patient currently produced no chip.
- **Regression lock-in:** Pin EXPECTED['mhra-warfarin-tramadol'] and fire Marevan + Zydol; Marevan alone must not fire.
- **Source:** BNF warfarin sodium interactions; MHRA Drug Safety Update June 2024 — <https://bnf.nice.org.uk/interactions/warfarin-sodium/> (2024-06)
- **Verified evidence:** BNF lists a warfarin–tramadol interaction (raised INR / bleeding). MHRA DSU June 2024 highlights the same pairing.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🔴 Red — Add Marevan to PINCER #7 warfarin INR match

- **Rule:** `pincer-7`
- **Now:** pincer-7 drug.match was ["warfarin"] only.
- **Proposed:** Add "marevan" to pincer-7 drug.match.
- **Why it matters:** PINCER #7 is the overdue-INR indicator. A Marevan-only repeat never matched, so the 84-day INR chip in the alert library was silently dead for brand-only records.
- **Regression lock-in:** Add 'marevan' to EXPECTED['pincer-7'].drugTerms.
- **Source:** BNF warfarin sodium medicinal forms (Marevan) — <https://bnf.nice.org.uk/drugs/warfarin-sodium/medicinal-forms/> (2026-08)
- **Verified evidence:** BNF lists Marevan as the UK brand of warfarin sodium. The string 'marevan' does not contain 'warfarin'.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

_No changes this run._

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

### 🔴 Red — Promote sore-throat unwell-child from duty to 999

- **Rule:** `sore-throat/rf-unwell-child`
- **Now:** sore-throat rf-unwell-child (floppy, unusually drowsy, or not drinking at all) escalated to duty. Earache's equivalent flag already escalates to 999.
- **Proposed:** Change escalate from "duty" to "999". Ask text unchanged.
- **Why it matters:** A floppy child who is not drinking is an emergency presentation. Routing that caller to duty rather than 999 under-escalates against current CKS.
- **Regression lock-in:** test-reception-pathways.js pins sore-throat rf-unwell-child escalate === '999'.
- **Source:** NICE CKS Sore throat — acute (May 2026) — immediate admission if the child is floppy or not taking fluids — <https://cks.nice.org.uk/topics/sore-throat-acute/> (2026-05)
- **Verified evidence:** NICE CKS Sore throat — acute (updated May 2026) lists immediate admission for a child who is floppy, drowsy, or dehydrated / not taking fluids.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

### 🔴 Red — Add headache household-same-time carbon monoxide 999 flag

- **Rule:** `headache/rf-household-co`
- **Now:** Headache pathway had thunderclap, neuro, meningism, injury, eye, GCA, pregnancy, anticoagulants and morning-vomiting flags. No household-cluster / carbon-monoxide question.
- **Proposed:** Add rf-household-co: ask whether anyone else in the household has the same new headache at the same time; escalate 999.
- **Why it matters:** Shared new headache across a household is the classic telephone clue for carbon monoxide. Reception currently never asked it.
- **Regression lock-in:** test-reception-pathways.js pins rf-household-co exists, escalate 999, ask mentions household / carbon monoxide.
- **Source:** NICE CKS Headache — assessment (consider carbon monoxide when household contacts share the headache) — <https://cks.nice.org.uk/topics/headache-assessment/> (2026)
- **Verified evidence:** NICE CKS Headache — assessment lists carbon monoxide as a red-flag consideration when household contacts have the same headache.
- **Provenance:** verified by orchestrator on 17 August 2026 — fetched source page, confidence high.

---

## Appendix: scan transparency

**Sources checked:** BNF warfarin-sodium monitoring and interactions; BNF eprosartan / quetiapine / carbamazepine medicinal forms; SPS mycophenolate monitoring (7 Jan 2026); MHRA DSU fezolinetant/Veoza 10 Apr 2025; MHRA DSU topiramate PPP 20 Jun 2024; MHRA DSU tramadol and warfarin Jun 2024; UKHSA RSV HCP information v05 / NHSE operational letter 2 July 2026; NICE CKS Sore throat — acute (May 2026); NICE CKS Headache — assessment; NHS England QOF 2026/27 PRN02356 July update (readable this run; QOF edits held); NICE indicator menu / QOF business rules landing pages.

**Rule-file baseline at start of run:**
- `drug-rules.json`: 2026-07-25
- `qof-rules.json`: QOF 2026/27 / 2026-07-25 (unchanged this run)
- `vaccine-rules.json`: 2026-08-01
- `alert-library.json`: 1.5 / 2026-07-25
- `reception-pathways.json`: v1.8 / 2026-07-28
- `acb-scores.js + stopp-start.js`: starter set — MEDREVIEW scanner hung; not scanned this run
- `clinical-thresholds`: test-clinical-thresholds-sync.js pin set — confirmed unchanged

**Candidates excluded as low relevance:** 3.

**Candidates killed during verification (not applied):**
- `qof-005`: CKD002/CKD003 disable is weakens_safety. Held for CSO sign-off even though scanners say those IDs are not in the official 2026/27 tables. Not applied.
- `qof-006`: Paired with qof-005 — CKD003 disable not applied.
- `qof-001`: AST012→AST014 / AST007→AST015 ID rename held. Keep old IDs live until CSO confirms the July PRN02356 mapping; renaming would break overrides keyed on id.
- `qof-007`: NDH register + NDH003 held pending CSO review of the July QOF PDF extract.
- `vax-004`: Care-home ageMin: 18 would narrow alerting (weakens_safety). UKHSA HCP v05 says under-18 care-home residents are not eligible, but the current rule flags all ages. Not applied.
- `drug-003`: CHC brand-list expansion (Drovelis / estetrol etc.) not applied — each BNF medicinal form was not re-fetched brand-by-brand this apply pass.
- `pathway-009`: Rash orbital 999 candidate not applied — verification did not re-confirm the CKS wording this apply pass.
- `medreview-scan`: MEDREVIEW scanner hung (~1665s) and was killed. ACB scores, STOPP/START term lists and visualiser PINCER tables were not scanned this run. Treat as unchecked.

**⚠️ Sources that could not be reached this run:** BSR 2025 full-text PDF (Cloudflare); NHS Digital QOF v51 extract files (landing page only); MEDREVIEW domain (ACB / STOPP / visualiser PINCER tables) — scanner hung, not scanned; CHC brand-completeness sweep — not re-fetched brand-by-brand this apply pass. _Treat the affected rules as unchecked this run._

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
