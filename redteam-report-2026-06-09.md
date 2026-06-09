# Redteam Rules — Sentinel drug-monitoring coverage report

**Practice:** Witley and Milford Surgery  
**Generated:** 9 June 2026  
**Extension version:** 3.37.0  
**Engine:** `engine/rules-engine.js`  
**Rules checked:** 25 · **Agents dispatched:** 23  
**Candidates evaluated:** 41 · **Confirmed gaps:** 35 · **False positives:** 3 · **OK/already covered:** 3

> **How to read this report.** Every finding below was verified against the **live `drugMatchesRule()` engine** — these are not LLM guesses. A CONFIRMED GAP means the engine returns `false` for a prescription that should trigger monitoring. A FALSE POSITIVE means the engine fires a chip for a drug outside the rule's scope. No rule edits have been made — this is a proposal for the Clinical Safety Officer (Dave) to review.

## ⚠️ Patient-safety alert

**19 CRITICAL gaps found** on high-risk drug rules (DMARD / lithium / antipsychotic / antithyroid / amiodarone / antiepileptic). A prescription matching these patterns would silently receive no monitoring chip — a missed clinical alert on a drug with narrow therapeutic index or serious toxicity risk.

## Critical gaps (immediate action)

These prescriptions should trigger a monitoring chip but currently do not. Verified against the real engine.

| Rule | Drug class | Prescription string | Reason | Suggested match term |
|------|-----------|---------------------|--------|---------------------|
| `methotrexate-maintenance` | DMARD | Novatrex 10mg/0.2ml solution for injection | UK SC/IM methotrexate injection brand; trade name 'novatrex' contains none of the match substrings | `novatrex` |
| `hydroxychloroquine-maintenance` | DMARD | Nivaquine 250mg tablets | Discontinued UK chloroquine phosphate brand (SanofiPasteur); legacy repeat prescriptions persist; 'nivaquine' absent from match list | `nivaquine` |
| `antipsychotic` | Antipsychotic | Clopixol 200mg/ml solution for injection | Zuclopenthixol (UK typical antipsychotic depot); neither 'clopixol' nor 'zuclopenthixol' in match list | `clopixol` |
| `antipsychotic` | Antipsychotic | Zuclopenthixol 10mg tablets | Oral zuclopenthixol; generic name absent from match list; metabolic monitoring needed | `zuclopenthixol` |
| `antipsychotic` | Antipsychotic | Depixol 20mg/ml injection | Flupentixol depot (UK typical antipsychotic); neither 'depixol' nor 'flupentixol' in match list | `depixol` |
| `antipsychotic` | Antipsychotic | Flupentixol 3mg tablets | Oral flupentixol; generic name absent from match list | `flupentixol` |
| `antipsychotic` | Antipsychotic | Modecate 25mg/ml solution for injection | Fluphenazine decanoate depot (UK typical antipsychotic); neither 'modecate' nor 'fluphenazine' in match list | `modecate` |
| `antipsychotic` | Antipsychotic | Fluphenazine 1mg tablets | Oral fluphenazine; generic name absent from match list | `fluphenazine` |
| `antipsychotic` | Antipsychotic | Piportil 50mg/ml solution for injection | Pipothiazine palmitate depot (UK); neither 'piportil' nor 'pipothiazine' in match list | `piportil` |
| `antipsychotic` | Antipsychotic | Trifluoperazine 5mg tablets | UK-licensed typical antipsychotic; generic 'trifluoperazine' absent from match list | `trifluoperazine` |
| `antipsychotic` | Antipsychotic | Stelazine 1mg tablets | Trifluoperazine UK brand; 'stelazine' absent from match list | `stelazine` |
| `antipsychotic` | Antipsychotic | Sulpiride 200mg tablets | UK typical antipsychotic (benzamide); 'sulpiride' absent from match list — amisulpride IS listed but sulpiride is a different drug | `sulpiride` |
| `antipsychotic` | Antipsychotic | Dolmatil 200mg tablets | Sulpiride UK brand; 'dolmatil' not in match list | `dolmatil` |
| `antipsychotic` | Antipsychotic | Pimozide 2mg tablets | UK-licensed typical antipsychotic; 'pimozide' absent from match list | `pimozide` |
| `antipsychotic` | Antipsychotic | Orap 2mg tablets | Pimozide UK brand; 'orap' not in match list | `orap` |
| `antipsychotic` | Antipsychotic | Promazine 25mg tablets | UK phenothiazine antipsychotic (Sparine); 'promazine' absent from match list | `25mg` |
| `antipsychotic` | Antipsychotic | Brexpiprazole 1mg tablets | EMA-approved atypical antipsychotic; neither 'brexpiprazole' nor 'rexulti' in match list | `brexpiprazole` |
| `antipsychotic` | Antipsychotic | Rexulti 1mg tablets | Brexpiprazole brand; 'rexulti' absent from match list | `rexulti` |
| `antipsychotic` | Antipsychotic | Droperidol 2.5mg tablets | UK-licensed butyrophenone antipsychotic; 'droperidol' absent from match list | `droperidol` |

## High-priority gaps

| Rule | Drug class | Prescription string | Reason | Suggested match term |
|------|-----------|---------------------|--------|---------------------|
| `ace-arb` | RAAS blocker | Tarka 2mg/180mg modified-release tablets | UK combination (trandolapril+verapamil); brand name 'tarka' contains neither 'trandolapril' nor any other match substring | `tarka` |
| `spironolactone` | Aldosterone antagonist | Co-flumactone 25mg/25mg tablets | Spironolactone+hydroflumethiazide combination; 'co-flumactone' contains none of the match substrings | `co-flumactone` |
| `spironolactone` | Aldosterone antagonist | Aldactide tablets | Spironolactone+hydroflumethiazide brand; 'aldactide' does not contain 'aldactone' — different string | `aldactide` |
| `spironolactone` | Aldosterone antagonist | Kerendia 10mg tablets | Finerenone (NICE-approved non-steroidal MRA for CKD-diabetes 2024); neither 'kerendia' nor 'finerenone' in match list | `kerendia` |
| `sglt2-inhibitor` | SGLT2 inhibitor | Trijardy 10mg/5mg/850mg tablets | UK triple combination (empagliflozin+linagliptin+metformin); brand name 'trijardy' contains none of the SGLT2 match substrings | `trijardy` |
| `sglt2-inhibitor` | SGLT2 inhibitor | Trijardy 25mg/5mg/1000mg tablets | UK triple combination higher-dose strength; brand name contains no match substring | `trijardy` |
| `glp1-receptor-agonist` | GLP-1 receptor agonist | Suliqua 100 units/ml + 50 mcg/ml solution for injection | UK insulin glargine+lixisenatide combination; 'suliqua' contains none of the GLP-1 match substrings; lixisenatide is a listed GLP-1 RA | `suliqua` |
| `statin` | Statin | Vytorin 10/20mg tablets | Simvastatin+ezetimibe combination; 'vytorin' not in match list — note: verify UK licensing (UK brand is Inegy, which IS in list) | `vytorin` |
| `allopurinol` | Xanthine oxidase inhibitor | Lesinurad 200mg tablets | NICE-approved (2016) urate-lowering agent for gout; 'lesinurad' absent from match list — note: lesinurad is URAT1 inhibitor not XOI; clinical scope question for CSO | `lesinurad` |
| `allopurinol` | Xanthine oxidase inhibitor | Zurampic 200mg tablets | Lesinurad brand name; neither 'zurampic' nor 'lesinurad' in match list | `zurampic` |
| `hrt-systemic` | HRT | Dydrogesterone 10mg tablets | UK progestogen (Duphaston); used in HRT protocols; 'dydrogesterone' absent from match list — note: only used in combo HRT (Femoston), verify if prescribed as monotherapy | `dydrogesterone` |
| `cocp` | COCP | Loestrin 30 tablets | UK COCP (norethisterone acetate+ethinylestradiol); if prescribed brand-name only, 'loestrin' contains no match substring | `loestrin` |
| `cocp` | COCP | Loestrin 20 tablets | Low-dose UK COCP; brand name 'loestrin' alone contains no match substring | `loestrin` |
| `pop` | POP | Norethisterone 350mcg tablets | CRITICAL: Generic norethisterone POP prescription; 'noriday' is in match list but 'norethisterone' is NOT — generic POP prescribing will silently fail to fire the pop rule | `norethisterone` |
| `pop` | POP | Levonorgestrel 30mcg tablets | CRITICAL: Generic levonorgestrel POP; 'norgeston' is in match but 'levonorgestrel' is NOT — generic POP prescribing will not fire the pop rule | `levonorgestrel` |
| `pop` | POP | Slynd 4mg tablets | Drospirenone 4mg POP (UK-licensed 2023+); requires U&E monitoring per FSRH notes; neither 'slynd' nor 'drospirenone' in match list | `slynd` |

## False positives (rules firing incorrectly)

These prescriptions incorrectly trigger a monitoring chip. Verified against the real engine.

| Rule | Drug class | Prescription string | Reason | Note |
|------|-----------|---------------------|--------|------|
| `hrt-systemic` | HRT | Norethisterone 350mcg tablets | Generic POP prescription; 'norethisterone' IS in hrt-systemic match list — will drugMatchesRule() return true? (hrtContext oestrogen gate may suppress chip at eval time) | drugMatchesRule returned true — hrtContext oestrogen gate may suppress at eval time; verify manually against evaluateDrugRule logic |
| `adhd-stimulant-paediatric` | ADHD stimulant | Methamphetamine 5mg tablets | Contains 'amphetamine' as substring; methamphetamine is not a legitimate UK GP prescription but string would match | drugMatchesRule returned true — this unrelated prescription WOULD incorrectly trigger the adhd-stimulant-paediatric chip |
| `adhd-stimulant-adult` | ADHD stimulant | Methamphetamine 5mg tablets | Contains 'amphetamine' as substring; string would match if recorded in prescriptions | drugMatchesRule returned true — this unrelated prescription WOULD incorrectly trigger the adhd-stimulant-adult chip |

## Actionable: suggested `drug.match` additions

For each confirmed gap, the suggested lowercase match term to add to `drug.match` in `rules/drug-rules.json`. Verify each against BNF / dm+d before applying. After adding, extend `EXPECTED` in `test-drug-brand-coverage.js` and run `node test-drug-brand-coverage.js`.

**`methotrexate-maintenance`** — add to `drug.match`: `novatrex`
- `"Novatrex 10mg/0.2ml solution for injection"` → `"novatrex"` _(UK SC/IM methotrexate injection brand; trade name 'novatrex' contains none of the match substrings)_

**`hydroxychloroquine-maintenance`** — add to `drug.match`: `nivaquine`
- `"Nivaquine 250mg tablets"` → `"nivaquine"` _(Discontinued UK chloroquine phosphate brand (SanofiPasteur); legacy repeat prescriptions persist; 'nivaquine' absent from match list)_

**`antipsychotic`** — add to `drug.match`: `clopixol`, `zuclopenthixol`, `depixol`, `flupentixol`, `modecate`, `fluphenazine`, `piportil`, `trifluoperazine`, `stelazine`, `sulpiride`, `dolmatil`, `pimozide`, `orap`, `25mg`, `brexpiprazole`, `rexulti`, `droperidol`
- `"Clopixol 200mg/ml solution for injection"` → `"clopixol"` _(Zuclopenthixol (UK typical antipsychotic depot); neither 'clopixol' nor 'zuclopenthixol' in match list)_
- `"Zuclopenthixol 10mg tablets"` → `"zuclopenthixol"` _(Oral zuclopenthixol; generic name absent from match list; metabolic monitoring needed)_
- `"Depixol 20mg/ml injection"` → `"depixol"` _(Flupentixol depot (UK typical antipsychotic); neither 'depixol' nor 'flupentixol' in match list)_
- `"Flupentixol 3mg tablets"` → `"flupentixol"` _(Oral flupentixol; generic name absent from match list)_
- `"Modecate 25mg/ml solution for injection"` → `"modecate"` _(Fluphenazine decanoate depot (UK typical antipsychotic); neither 'modecate' nor 'fluphenazine' in match list)_
- `"Fluphenazine 1mg tablets"` → `"fluphenazine"` _(Oral fluphenazine; generic name absent from match list)_
- `"Piportil 50mg/ml solution for injection"` → `"piportil"` _(Pipothiazine palmitate depot (UK); neither 'piportil' nor 'pipothiazine' in match list)_
- `"Trifluoperazine 5mg tablets"` → `"trifluoperazine"` _(UK-licensed typical antipsychotic; generic 'trifluoperazine' absent from match list)_
- `"Stelazine 1mg tablets"` → `"stelazine"` _(Trifluoperazine UK brand; 'stelazine' absent from match list)_
- `"Sulpiride 200mg tablets"` → `"sulpiride"` _(UK typical antipsychotic (benzamide); 'sulpiride' absent from match list — amisulpride IS listed but sulpiride is a different drug)_
- `"Dolmatil 200mg tablets"` → `"dolmatil"` _(Sulpiride UK brand; 'dolmatil' not in match list)_
- `"Pimozide 2mg tablets"` → `"pimozide"` _(UK-licensed typical antipsychotic; 'pimozide' absent from match list)_
- `"Orap 2mg tablets"` → `"orap"` _(Pimozide UK brand; 'orap' not in match list)_
- `"Promazine 25mg tablets"` → `"25mg"` _(UK phenothiazine antipsychotic (Sparine); 'promazine' absent from match list)_
- `"Brexpiprazole 1mg tablets"` → `"brexpiprazole"` _(EMA-approved atypical antipsychotic; neither 'brexpiprazole' nor 'rexulti' in match list)_
- `"Rexulti 1mg tablets"` → `"rexulti"` _(Brexpiprazole brand; 'rexulti' absent from match list)_
- `"Droperidol 2.5mg tablets"` → `"droperidol"` _(UK-licensed butyrophenone antipsychotic; 'droperidol' absent from match list)_

**`ace-arb`** — add to `drug.match`: `tarka`
- `"Tarka 2mg/180mg modified-release tablets"` → `"tarka"` _(UK combination (trandolapril+verapamil); brand name 'tarka' contains neither 'trandolapril' nor any other match substring)_

**`spironolactone`** — add to `drug.match`: `co-flumactone`, `aldactide`, `kerendia`
- `"Co-flumactone 25mg/25mg tablets"` → `"co-flumactone"` _(Spironolactone+hydroflumethiazide combination; 'co-flumactone' contains none of the match substrings)_
- `"Aldactide tablets"` → `"aldactide"` _(Spironolactone+hydroflumethiazide brand; 'aldactide' does not contain 'aldactone' — different string)_
- `"Kerendia 10mg tablets"` → `"kerendia"` _(Finerenone (NICE-approved non-steroidal MRA for CKD-diabetes 2024); neither 'kerendia' nor 'finerenone' in match list)_

**`sglt2-inhibitor`** — add to `drug.match`: `trijardy`
- `"Trijardy 10mg/5mg/850mg tablets"` → `"trijardy"` _(UK triple combination (empagliflozin+linagliptin+metformin); brand name 'trijardy' contains none of the SGLT2 match substrings)_
- `"Trijardy 25mg/5mg/1000mg tablets"` → `"trijardy"` _(UK triple combination higher-dose strength; brand name contains no match substring)_

**`glp1-receptor-agonist`** — add to `drug.match`: `suliqua`
- `"Suliqua 100 units/ml + 50 mcg/ml solution for injection"` → `"suliqua"` _(UK insulin glargine+lixisenatide combination; 'suliqua' contains none of the GLP-1 match substrings; lixisenatide is a listed GLP-1 RA)_

**`statin`** — add to `drug.match`: `vytorin`
- `"Vytorin 10/20mg tablets"` → `"vytorin"` _(Simvastatin+ezetimibe combination; 'vytorin' not in match list — note: verify UK licensing (UK brand is Inegy, which IS in list))_

**`allopurinol`** — add to `drug.match`: `lesinurad`, `zurampic`
- `"Lesinurad 200mg tablets"` → `"lesinurad"` _(NICE-approved (2016) urate-lowering agent for gout; 'lesinurad' absent from match list — note: lesinurad is URAT1 inhibitor not XOI; clinical scope question for CSO)_
- `"Zurampic 200mg tablets"` → `"zurampic"` _(Lesinurad brand name; neither 'zurampic' nor 'lesinurad' in match list)_

**`hrt-systemic`** — add to `drug.match`: `dydrogesterone`
- `"Dydrogesterone 10mg tablets"` → `"dydrogesterone"` _(UK progestogen (Duphaston); used in HRT protocols; 'dydrogesterone' absent from match list — note: only used in combo HRT (Femoston), verify if prescribed as monotherapy)_

**`cocp`** — add to `drug.match`: `loestrin`
- `"Loestrin 30 tablets"` → `"loestrin"` _(UK COCP (norethisterone acetate+ethinylestradiol); if prescribed brand-name only, 'loestrin' contains no match substring)_
- `"Loestrin 20 tablets"` → `"loestrin"` _(Low-dose UK COCP; brand name 'loestrin' alone contains no match substring)_

**`pop`** — add to `drug.match`: `norethisterone`, `levonorgestrel`, `slynd`
- `"Norethisterone 350mcg tablets"` → `"norethisterone"` _(CRITICAL: Generic norethisterone POP prescription; 'noriday' is in match list but 'norethisterone' is NOT — generic POP prescribing will silently fail to fire the pop rule)_
- `"Levonorgestrel 30mcg tablets"` → `"levonorgestrel"` _(CRITICAL: Generic levonorgestrel POP; 'norgeston' is in match but 'levonorgestrel' is NOT — generic POP prescribing will not fire the pop rule)_
- `"Slynd 4mg tablets"` → `"slynd"` _(Drospirenone 4mg POP (UK-licensed 2023+); requires U&E monitoring per FSRH notes; neither 'slynd' nor 'drospirenone' in match list)_

## Per-rule summary

| Rule | Drug class | Gaps | False positives | Status |
|------|-----------|------|----------------|--------|
| `ace-arb` | RAAS blocker | 1 | 0 | 🟠 Gaps found |
| `adhd-stimulant-adult` | ADHD stimulant | 0 | 1 | 🟡 False positives |
| `adhd-stimulant-paediatric` | ADHD stimulant | 0 | 1 | 🟡 False positives |
| `allopurinol` | Xanthine oxidase inhibitor | 2 | 0 | 🟠 Gaps found |
| `antipsychotic` | Antipsychotic | 17 | 0 | 🔴 CRITICAL gaps |
| `carbamazepine-maintenance` | Antiepileptic | 0 | 0 | 🟢 Clean |
| `cocp` | COCP | 2 | 0 | 🟠 Gaps found |
| `glp1-receptor-agonist` | GLP-1 receptor agonist | 1 | 0 | 🟠 Gaps found |
| `hrt-systemic` | HRT | 1 | 1 | 🟠 Gaps found |
| `hydroxychloroquine-maintenance` | DMARD | 1 | 0 | 🔴 CRITICAL gaps |
| `methotrexate-maintenance` | DMARD | 1 | 0 | 🔴 CRITICAL gaps |
| `pop` | POP | 3 | 0 | 🟠 Gaps found |
| `sglt2-inhibitor` | SGLT2 inhibitor | 2 | 0 | 🟠 Gaps found |
| `spironolactone` | Aldosterone antagonist | 3 | 0 | 🟠 Gaps found |
| `statin` | Statin | 1 | 0 | 🟠 Gaps found |

---

## Appendix: verification methodology

All candidates were verified mechanically via `engine/rules-engine.js` `drugMatchesRule()` — the same function the regression test suite (`test-drug-brand-coverage.js`) uses. A CONFIRMED GAP is a candidate for which `drugMatchesRule` returned `false`; a FALSE POSITIVE is one for which it returned `true`. Model recall was used only for candidate generation; mechanical verification is the source of truth.

**Candidates marked OK (already covered or correctly rejected):** 3

**Out of scope for this tool:** Rules with `enabled: false`; the hrtContext oestrogen-gate secondary logic (see note on hrt-systemic false positives above); local ICB formulary items; individual patient prescription history.

**This report does not edit any rule files.** The CSO reviews findings and approves changes. To apply a gap fix: add the term to `drug.match`, update `EXPECTED` in `test-drug-brand-coverage.js`, run the test suite, bump manifest (patch), add a CHANGELOG entry, commit and push.