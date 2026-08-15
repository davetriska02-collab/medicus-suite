# Sentinel clinical alert reference (non-QOF)

Machine-generated from the shipped rule files by `scripts/gen-sentinel-reference.js`. Do not hand-edit — edit the rule JSON and regenerate.

| Source | Version / last updated |
|---|---|
| `manifest.json` | v3.232.1 |
| `rules/drug-rules.json` | 2026-07-25 (schema v2) |
| `rules/vaccine-rules.json` | 2026-08-01 |
| `rules/alert-library.json` | v1.5 — 2026-07-25 |

**Scope.** This is the full Sentinel rule set *minus QOF*: drug monitoring, drug–allergy cross-checks, vaccine eligibility, and the prescribing-safety alert library. QOF indicators/registers (`rules/qof-rules.json`, 60 indicators + 14 registers) are contractual achievement rather than patient-safety monitoring and are excluded by design.

## How to read these rules (engine semantics)

- **Matching is case-insensitive SUBSTRING matching** against the drug/observation name (`engine/rules-engine.js` → `drugMatchesRule`). A generic term therefore auto-covers its qualified forms (`lithium` matches `lithium carbonate`), but **every distinct brand must be listed explicitly** or it silently never matches. A non-match produces no alert and no error.
- **`exclude` is sharp**: any drug whose name *contains* an exclude string is dropped entirely, including legitimate ones. Excludes exist to suppress genuine false positives (e.g. topical NSAIDs, vaginal oestrogens).
- **SNOMED codes**, where present, are secondary identifiers alongside the text match, not the primary key.
- **Monitoring test statuses** derived from `intervalDays` / `dueSoonDays`:

  | Status | Meaning |
  |---|---|
  | `in_date` | last result within `intervalDays` |
  | `due_soon` | within the last `dueSoonDays` of the interval (amber) |
  | `overdue` | older than `intervalDays` (red) |
  | `stale` | severely overdue (≥2× interval) |
  | `no_data` | no matching observation found (neutral — not actionable on its own) |
  | `recently_initiated` | drug started within the smallest interval; `no_data` suppressed |

- **`postInitiationDays`** (currently only the ACE-I/ARB U&E test) fires only when the drug start date is known AND no test has been recorded since starting: ≤ `postInitiationDueSoonDays` = neutral, then `due_soon`, then `overdue`. It cannot raise a false alert on an established patient whose start date is not visible.
- **Severity**: `red` = alert/actionable, `amber` = caution, `info` = noted/awareness only.
- **`mustNotBePresent`** on a drug-combo rule inverts that clause: the rule fires only when *none* of the listed drugs is co-prescribed (this is how "without gastroprotection" is expressed).
- **Drug–allergy rules FAIL CLOSED** on the legacy session/DOM feed: allergies are only available from the Transactional (GP Connect Structured) feed, so with no allergy bundle they never fire.

---

## Part 1 — Drug monitoring rules (29)

Source file: `rules/drug-rules.json`. Sentinel drug rules - July 2026 review (The Keeper)

### Index

| Rule ID | Class | Shared care | Tests | Interval(s) |
|---|---|---|---|---|
| `methotrexate-maintenance` | DMARD | yes | FBC, U&E, LFT | 84 d (12 wk) |
| `leflunomide-maintenance` | DMARD | yes | FBC, U&E, LFT, BP, Weight | 84 d (12 wk) |
| `hydroxychloroquine-maintenance` | DMARD | yes | FBC, LFT, U&E | 365 d (1 y) |
| `azathioprine-maintenance` | DMARD | yes | FBC, LFT, U&E | 84 d (12 wk) |
| `sulfasalazine-maintenance` | DMARD | yes | FBC, LFT | 84 d (12 wk) |
| `carbamazepine-maintenance` | Antiepileptic | yes | FBC, LFT, U&E / Sodium, Carbamazepine level, Lipid profile | 182 d (26 wk), 365 d (1 y) |
| `lithium-maintenance` | Mood stabiliser | yes | Lithium level, U&E, TFT, Calcium | 90 d (~3 mo), 180 d (~6 mo) |
| `amiodarone-maintenance` | Antiarrhythmic | no | TFT, LFT, CXR, U&E / Creatinine | 180 d (~6 mo), 365 d (1 y), 182 d (26 wk) |
| `carbimazole-propylthiouracil` | Antithyroid | no | TFT, FBC, LFT | 90 d (~3 mo), 365 d (1 y) |
| `ace-arb` | RAAS blocker | no | U&E, BP, U&E (within ~2 weeks of starting) | 365 d (1 y), — |
| `spironolactone` | Aldosterone antagonist | no | U&E | 120 d (~4 mo) |
| `sglt2-inhibitor` | SGLT2 inhibitor | no | U&E | 365 d (1 y) |
| `glp1-receptor-agonist` | GLP-1 receptor agonist | no | Annual review, U&E | 365 d (1 y) |
| `doac` | DOAC | no | FBC, U&E, LFT | 365 d (1 y) |
| `statin` | Statin | no | LFT | 365 d (1 y) |
| `allopurinol` | Xanthine oxidase inhibitor | no | U&E, Urate | 365 d (1 y) |
| `antipsychotic` | Antipsychotic | yes | HbA1c, Lipids, Weight, BP, ECG | 365 d (1 y) |
| `mirabegron` | Beta-3 agonist | no | BP | 365 d (1 y) |
| `levothyroxine` | Thyroid hormone | no | TSH | 365 d (1 y) |
| `hrt-systemic` | HRT | no | BP, Weight | 365 d (1 y) |
| `adhd-stimulant-paediatric` | ADHD stimulant | yes | Blood pressure, Pulse / heart rate, Weight, Height | 182 d (26 wk) |
| `adhd-stimulant-adult` | ADHD stimulant | yes | Blood pressure, Pulse / heart rate, Weight | 182 d (26 wk) |
| `atomoxetine-maintenance` | ADHD non-stimulant | yes | Blood pressure, Pulse / heart rate, Weight, LFT | 182 d (26 wk), 365 d (1 y) |
| `guanfacine-maintenance` | ADHD non-stimulant | yes | Blood pressure, Pulse / heart rate, Weight | 84 d (12 wk) |
| `sodium-valproate` | Antiepileptic / mood stabiliser | yes | FBC, LFT, U&E / Ammonia | 365 d (1 y) |
| `finerenone` | Non-steroidal MRA | no | U&E (serum potassium + eGFR) | 120 d (~4 mo) |
| `dmpa-injectable` | Progestogen-only injectable contraception | no | Blood pressure, Weight | 730 d (2 y) |
| `chc-combined-hormonal` | Combined hormonal contraception | no | Blood pressure, BMI / Weight | 365 d (1 y) |
| `digoxin-renal-monitoring` *(disabled)* | — | no | U&E / eGFR | 365 d (1 y) |

### `methotrexate-maintenance`

**Class:** DMARD  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `methotrexate`, `maxtrex`, `metoject`, `jylamvo`, `nordimet`, `zlatal`, `methofill`
**Drug SNOMED:** `387381009`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 84 d (12 wk) | 14 d (2 wk) | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 84 d (12 wk) | 14 d (2 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 84 d (12 wk) | 14 d (2 wk) | — |

**Source:** BNF / 2025 BSR guideline for prescription & monitoring of csDMARDs (Rheumatology, Nov 2025)

**Notes:** Intensive monitoring (every 2 weeks) for first 6 weeks, then 4-weekly until stable, then 12-weekly. BSR 2025 guideline now permits 6-monthly monitoring after 12 months of stable treatment with normal results — Sentinel keeps the 12-week baseline as the safer default; clinicians may extend intervals via Options if local shared care permits.

### `leflunomide-maintenance`

**Class:** DMARD  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `leflunomide`, `arava`
**Drug SNOMED:** `386982008`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 84 d (12 wk) | 14 d (2 wk) | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 84 d (12 wk) | 14 d (2 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 84 d (12 wk) | 14 d (2 wk) | — |
| BP | `blood pressure`, `bp` | `75367002` | 84 d (12 wk) | 14 d (2 wk) | — |
| Weight | `weight`, `body weight` | `27113001` | 84 d (12 wk) | 14 d (2 wk) | — |

**Source:** BNF / 2025 BSR guideline for prescription & monitoring of csDMARDs (Rheumatology, Nov 2025)

**Notes:** Monthly FBC/U&E/LFT/BP/weight for first 6 months on initiation, then 12-weekly when stable. Hypertension is a recognised adverse effect. Long half-life (washout with cholestyramine if severe toxicity).

### `hydroxychloroquine-maintenance`

**Class:** DMARD  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `hydroxychloroquine`, `chloroquine`, `quinoric`, `plaquenil`, `avloclor`
**Drug SNOMED:** `387397007`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 365 d (1 y) | 30 d | — |
| LFT | `lft`, `liver function` | `26958001` | 365 d (1 y) | 30 d | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 365 d (1 y) | 30 d | — |

**Source:** BNF / 2025 BSR guideline for prescription & monitoring of csDMARDs (Rheumatology, Nov 2025) / RCOphth retinopathy screening guidelines (2020, reviewed 2024)

**Notes:** Annual FBC/LFT/U&E plus annual review. RCOphth recommends baseline ophthalmology assessment within 6-12 months of starting and annual screening from 5 years cumulative use, or earlier if dose >5 mg/kg/day, eGFR <60, concurrent tamoxifen, or pre-existing retinal disease. Eye check is not a blood test so not enforced here.

### `azathioprine-maintenance`

**Class:** DMARD  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `azathioprine`, `imuran`, `azapress`, `jayempi`
**Drug SNOMED:** `372574004`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 84 d (12 wk) | 14 d (2 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 84 d (12 wk) | 14 d (2 wk) | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 84 d (12 wk) | 14 d (2 wk) | — |

**Source:** BNF / 2025 BSR guideline for prescription & monitoring of csDMARDs (Rheumatology, Nov 2025)

**Notes:** TPMT activity should be checked before initiation. Intensive monitoring in first 8 weeks.

### `sulfasalazine-maintenance`

**Class:** DMARD  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `sulfasalazine`, `sulphasalazine`, `salazopyrin`, `sulazine`
**Drug SNOMED:** `387308006`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 84 d (12 wk) | 14 d (2 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 84 d (12 wk) | 14 d (2 wk) | — |

**Source:** BNF / 2025 BSR guideline for prescription & monitoring of csDMARDs (Rheumatology, Nov 2025)

**Notes:** Monitoring may be discontinued after 12 months of stable treatment per some shared care protocols. Check local guidance.

### `carbamazepine-maintenance`

**Class:** Antiepileptic  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `carbamazepine`, `tegretol`, `carbagen`
**Drug SNOMED:** `387222003`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 182 d (26 wk) | 21 d (3 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 182 d (26 wk) | 21 d (3 wk) | — |
| U&E / Sodium | `u&e`, `urea and electrolytes`, `renal profile`, `sodium` | `1019331000000106` | 182 d (26 wk) | 21 d (3 wk) | — |
| Carbamazepine level | `carbamazepine level`, `carbamazepine concentration`, `serum carbamazepine` | — | 182 d (26 wk) | 21 d (3 wk) | — |
| Lipid profile | `lipid profile`, `cholesterol`, `lipids` | `27171005` | 365 d (1 y) | 30 d | — |

**Source:** BNF / MHRA / NICE CG137 / shared care

**Notes:** FBC: haematological toxicity risk (aplastic anaemia, agranulocytosis — rare but serious; check at baseline, 4 weeks, 6 months, then 6-monthly). LFT: hepatotoxicity risk; check same schedule. U&E/Sodium: enzyme-induction can cause SIADH and hyponatraemia — sodium should be monitored 6-monthly; risk heightened in the elderly and on concurrent diuretics. Carbamazepine level: narrow therapeutic index (target typically 4–12 mg/L); useful if toxicity suspected, poor seizure control, or dose change. Lipid profile: CYP enzyme induction raises LDL and total cholesterol — annual check. For women of childbearing age, ensure adequate contraception (enzyme inducer reduces hormonal contraceptive efficacy) and consider folic acid supplementation (teratogenicity risk — neural tube defects); refer to specialist before conception.

### `lithium-maintenance`

**Class:** Mood stabiliser  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `lithium`, `priadel`, `camcolit`, `liskonum`, `li-liquid`
**Drug SNOMED:** `73572009`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Lithium level | `lithium level`, `serum lithium` | `166833002` | 90 d (~3 mo) | 14 d (2 wk) | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 180 d (~6 mo) | 21 d (3 wk) | — |
| TFT | `tft`, `thyroid function` | `166842003` | 180 d (~6 mo) | 21 d (3 wk) | — |
| Calcium | `calcium`, `ca2+`, `corrected calcium` | `390967006` | 180 d (~6 mo) | 21 d (3 wk) | — |

**Source:** BNF / NICE CG185 / shared care

**Notes:** Level should be 12 hours post-dose. Take sample before next dose if compliance unclear.

### `amiodarone-maintenance`

**Class:** Antiarrhythmic  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `amiodarone`, `cordarone`
**Drug SNOMED:** `372813003`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| TFT | `tft`, `thyroid function` | `166842003` | 180 d (~6 mo) | 21 d (3 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 180 d (~6 mo) | 21 d (3 wk) | — |
| CXR | `chest x-ray`, `cxr`, `chest xray` | — | 365 d (1 y) | 30 d | — |
| U&E / Creatinine | `u&e`, `urea and electrolytes`, `renal profile`, `urea`, `electrolytes`, `creatinine` | `1019331000000106` | 182 d (26 wk) | 21 d (3 wk) | — |

**Source:** BNF / MHRA Drug Safety Update / NICE CG185 (amiodarone monitoring) / BSR shared care

**Notes:** Pulmonary toxicity is the principal monitoring concern. Patient should report new cough or breathlessness. CSO FLAG (drugs-002, 2026-07-25 Keeper, PLAUSIBLE/apply): U&E monitoring at 6-monthly intervals added per BNF/NICE CG185 (amiodarone can cause hypothyroidism-associated hyponatraemia and has occasional direct renal effects; 6-monthly U&E is standard shared-care practice). VERIFIER-A confirmed the clinical rationale from BNF and shared-care protocol summaries; primary-source PDF 403 this run. CSO to review this addition before next PR merge — if local shared-care protocol omits U&E, notes can be updated to reflect that.

### `carbimazole-propylthiouracil`

**Class:** Antithyroid  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `carbimazole`, `propylthiouracil`, `neo-mercazole`, `neomercazole`
**Drug SNOMED:** `387534003`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| TFT | `tft`, `thyroid function`, `tsh`, `free t4` | `166842003` | 90 d (~3 mo) | 14 d (2 wk) | — |
| FBC | `fbc`, `full blood count` | `26604007` | 365 d (1 y) | 30 d | — |
| LFT | `lft`, `liver function` | `26958001` | 365 d (1 y) | 30 d | — |

**Source:** BNF / MHRA Drug Safety Update / British Thyroid Association

**Notes:** Agranulocytosis is a rare but life-threatening adverse effect — counsel patient to report sore throat, fever, mouth ulcers urgently. PTU carries hepatotoxicity risk. TFT every 4-6 weeks during titration, then 3-monthly when stable.

### `ace-arb`

**Class:** RAAS blocker  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `ramipril`, `tritace`, `triapin`, `lisinopril`, `zestril`, `carace`, `zestoretic`, `perindopril`, `coversyl`, `enalapril`, `innovace`, `innozide`, `captopril`, `capoten`, `noyada`, `trandolapril`, `gopten`, `fosinopril`, `staril`, `losartan`, `cozaar`, `hyzaar`, `arbli`, `candesartan`, `amias`, `valsartan`, `diovan`, `exforge`, `irbesartan`, `aprovel`, `karvea`, `telmisartan`, `micardis`, `pritor`, `tolura`, `olmesartan`, `olmetec`, `sevikar`, `azilsartan`, `edarbi`, `sacubitril`, `entresto`, `cilazapril`, `vascace`, `imidapril`, `tanatril`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 365 d (1 y) | 30 d | — |
| BP | `blood pressure`, `bp` | `75367002` | 365 d (1 y) | 30 d | — |
| U&E (within ~2 weeks of starting) | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | — | — | overdue at 21 d (3 wk) from drug start (amber from 14 d (2 wk)) |

**Source:** NICE NG136 / BNF

**Notes:** U&E within 1-2 weeks of initiation or dose change, then annual review thereafter unless eGFR <60. The post-initiation U&E test fires only when the drug's start date is known and no U&E has been recorded since starting (it cannot cry wolf on an established patient whose start date is not visible). Sacubitril/valsartan (Entresto) added to match list for HFrEF use. Cilazapril (brand Vascace) and imidapril (brand Tanatril) are legacy UK ACE inhibitors, no longer widely initiated but may appear on older repeat prescriptions — added 2026-07-11 to close silent-failure gap (BNF/dm+d corroborated; primary-source PDFs 403 this run).

### `spironolactone`

**Class:** Aldosterone antagonist  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `spironolactone`, `aldactone`, `eplerenone`, `inspra`
**Drug SNOMED:** `387078006`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 120 d (~4 mo) | 21 d (3 wk) | — |

**Source:** BNF / NICE NG106 heart failure

**Notes:** Hyperkalaemia is the principal monitoring concern. Staged monitoring schedule (1 week, 4 weeks, 8 weeks, 12 weeks, then 4-monthly) for new starts. Now part of HF four-pillar therapy (QOF HF009).

### `sglt2-inhibitor`

**Class:** SGLT2 inhibitor  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `dapagliflozin`, `forxiga`, `xigduo`, `qtern`, `empagliflozin`, `jardiance`, `synjardy`, `glyxambi`, `canagliflozin`, `invokana`, `vokanamet`, `ertugliflozin`, `steglatro`, `segluromet`, `steglujan`
**Drug SNOMED:** `703674001`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| U&E | `u&e`, `urea and electrolytes`, `renal profile`, `egfr` | `1019331000000106` | 365 d (1 y) | 30 d | — |

**Source:** NICE NG28 (T2DM), NG203 (CKD), NG106 (HF) / BNF / MHRA Drug Safety Updates 2020-2024

**Notes:** Baseline and annual eGFR. Increased risk of DKA (including euglycaemic DKA) — counsel patient on sick-day rules and to stop before major surgery/illness. Increased risk of Fournier's gangrene and lower-limb amputation (canagliflozin). Volume depletion risk in elderly or on diuretics.

### `glp1-receptor-agonist`

**Class:** GLP-1 receptor agonist  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `semaglutide`, `ozempic`, `wegovy`, `rybelsus`, `tirzepatide`, `mounjaro`, `zepbound`, `dulaglutide`, `trulicity`, `liraglutide`, `victoza`, `saxenda`, `xultophy`, `lixisenatide`, `lyxumia`, `exenatide`, `byetta`, `bydureon`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Annual review | `glp-1 review`, `weight management review`, `diabetes annual review`, `obesity review` | — | 365 d (1 y) | 30 d | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile`, `egfr` | `1019331000000106` | 365 d (1 y) | 30 d | — |

**Source:** BNF / NICE TA1026 (semaglutide for weight), TA1004 (tirzepatide) / SPCs / MHRA Drug Safety Update Jan 2024 / MHRA DSU 29 Jan 2026 (GLP-1 & GIP/GLP-1 pancreatitis)

**Notes:** No mandatory blood monitoring schedule but annual review (renal function, treatment response, side-effect screening) is appropriate. Counsel on pancreatitis warning signs, dehydration risk from GI side effects, gallbladder disease, and (for T2DM) accelerated diabetic retinopathy when HbA1c drops rapidly. Tirzepatide specifically requires renal function assessment pre-initiation. SafePrescriber/MHRA repeatedly highlights non-medical use risks for weight-loss formulations. MHRA DSU 29 Jan 2026 strengthened the acute-pancreatitis warning across all GLP-1 and dual GIP/GLP-1 agonists (rare necrotising/fatal cases reported) — counsel patients to seek urgent help for severe persistent abdominal pain radiating to the back with vomiting, and to report via Yellow Card (corroborated 2026-06-21; primary DSU PDF pending confirmation). MHRA Jan 2025 aspiration risk during surgical procedures: GLP-1 agonists delay gastric emptying; pre-operative fasting periods may be inadequate — patients should inform anaesthetist/surgeon of GLP-1 use; consider withholding the weekly injection on the week of planned surgery per RCOA/MHRA guidance (corroborated 2026-07-11; primary PDF 403 this run). LIXISENATIDE WITHDRAWAL (drugs-003, 2026-07-25 Keeper, CONFIRMED): Lyxumia (lixisenatide, Sanofi) was withdrawn from the UK market; 'lixisenatide' and 'lyxumia' terms retained in match[] so that existing patients on repeat (or legacy records) still receive monitoring flags — confirm with dispensary that no new supplies are being issued. Patients still prescribed lixisenatide should be switched to an alternative GLP-1 agonist at next medication review.

### `doac`

**Class:** DOAC  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `apixaban`, `eliquis`, `rivaroxaban`, `xarelto`, `edoxaban`, `lixiana`, `dabigatran`, `pradaxa`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 365 d (1 y) | 30 d | — |
| U&E | `u&e`, `urea and electrolytes`, `renal profile`, `egfr` | `1019331000000106` | 365 d (1 y) | 30 d | — |
| LFT | `lft`, `liver function` | `26958001` | 365 d (1 y) | 30 d | — |

**Source:** BNF / NICE NG196 / EHRA guideline (2024 update)

**Notes:** Renal function for DOAC monitoring must be calculated as CrCl (Cockcroft-Gault), NOT eGFR — eGFR overestimates clearance (especially in low-weight elderly patients) and its use raises bleeding risk (MHRA/SPS). Monitoring frequency by CrCl: ≥60 mL/min → annual; 30–59 → 6-monthly; 15–29 → 3-monthly; <15 → all DOACs contraindicated (refer). EHRA rule-of-thumb for CrCl ≤60: recheck interval (months) = CrCl ÷ 10. Elderly (>75) or frail: at least 4–6 monthly regardless of band. Drug-specific renal handling: dabigatran ~80% renally cleared (contraindicated CrCl <30), edoxaban dose-adjusted <50, rivaroxaban ~35%, apixaban ~27% (least renal dependence). Sentinel enforces only the annual 365-day baseline (the schema cannot encode CrCl-conditional intervals — flagged for an engine extension); the clinician must intensify per CrCl band, age and frailty. Source: NHS SPS DOACs monitoring; EHRA practical guidance; 2024–2025 NHS ICB DOAC guidelines (corroborated; primary pages 403, pending confirmation).

### `statin`

**Class:** Statin  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `atorvastatin`, `lipitor`, `atozet`, `simvastatin`, `inegy`, `rosuvastatin`, `crestor`, `enebium`, `pravastatin`, `lipostat`, `fluvastatin`, `lescol`, `pitavastatin`, `livazo`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| LFT | `lft`, `liver function` | `26958001` | 365 d (1 y) | 30 d | — |

**Source:** NICE NG181 (Lipids) / BNF

**Notes:** NICE NG181: LFT baseline, at 3 months, and at 12 months only. Routine ongoing monitoring not required after 12 months on stable dose; do not check unless clinically indicated. CK only if muscle symptoms. Rule retained as a one-off prompt for new starts; consider disabling in Options once initial monitoring is complete on a given patient.

### `allopurinol`

**Class:** Xanthine oxidase inhibitor  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `allopurinol`, `zyloric`, `caplenal`, `uricto`, `febuxostat`, `adenuric`
**Drug SNOMED:** `387481004`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | `1019331000000106` | 365 d (1 y) | 30 d | — |
| Urate | `urate`, `uric acid`, `serum urate` | `302393005` | 365 d (1 y) | 30 d | — |

**Source:** NICE NG219 (Gout, 2022) / BSR guideline

**Notes:** Target serum urate <360 micromol/L (or <300 micromol/L in tophaceous gout, chronic arthropathy, or frequent flares). Annual review once stable. Febuxostat added to match list; carries cardiovascular warning per MHRA — use with caution in established CVD.

### `antipsychotic`

**Class:** Antipsychotic  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `olanzapine`, `zyprexa`, `zalasta`, `zypadhera`, `risperidone`, `risperdal`, `okedi`, `quetiapine`, `seroquel`, `atrolak`, `biquelle`, `zaluron`, `aripiprazole`, `abilify`, `haloperidol`, `serenace`, `dozic`, `haldol`, `chlorpromazine`, `largactil`, `amisulpride`, `solian`, `paliperidone`, `invega`, `xeplion`, `trevicta`, `byannli`, `lurasidone`, `latuda`, `asenapine`, `sycrest`, `cariprazine`, `reagila`, `sulpiride`, `dolmatil`, `sulpitil`, `sulpor`, `zuclopenthixol`, `clopixol`, `flupentixol`, `depixol`, `fluanxol`, `fluphenazine`, `modecate`
**Excluded:** `clozapine`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| HbA1c | `hba1c`, `haemoglobin a1c`, `glycated` | `43396009` | 365 d (1 y) | 30 d | — |
| Lipids | `lipid profile`, `cholesterol`, `lipids` | `166830004` | 365 d (1 y) | 30 d | — |
| Weight | `weight`, `body weight` | `27113001` | 365 d (1 y) | 30 d | — |
| BP | `blood pressure`, `bp` | `75367002` | 365 d (1 y) | 30 d | — |
| ECG | `ecg`, `electrocardiogram` | — | 365 d (1 y) | 30 d | — |

**Source:** NICE CG178 / Maudsley Prescribing Guidelines 14th ed / QOF MH002-MH012 / BNF

**Notes:** Metabolic syndrome screening. ECG recommended at baseline and annually if cardiovascular risk factors or QTc-prolonging concomitant drugs. Clozapine EXCLUDED here — monitored under separate national protocol (CPMS/ZTAS) with weekly FBC for 18 weeks, then 2-weekly to 1 year, then 4-weekly indefinitely; mandatorily clozapine-clinic led, not amenable to primary-care rule firing. 2026-07-11: added sulpiride (brands Dolmatil, Sulpitil, Sulpor), zuclopenthixol (brand Clopixol), flupentixol (brands Depixol, Fluanxol) and fluphenazine (brand Modecate) — depot antipsychotics frequently managed in primary care under shared-care; omission would silently fail metabolic monitoring for these patients (BNF/dm+d corroborated; primary-source PDFs 403 this run).

### `mirabegron`

**Class:** Beta-3 agonist  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `mirabegron`, `betmiga`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| BP | `blood pressure`, `bp` | `75367002` | 365 d (1 y) | 30 d | — |

**Source:** BNF / MHRA Drug Safety Update 2015 (severe hypertension warning) / SPC

**Notes:** Causes hypertension — measure BP before starting and periodically during treatment, particularly in patients with pre-existing hypertension. Contraindicated in severe uncontrolled hypertension (≥180/110). BP rise typically modest (mean 1-3 mmHg) but case reports of severe hypertension and hypertensive crisis. Annual BP is a reasonable baseline for stable patients.

### `levothyroxine`

**Class:** Thyroid hormone  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `levothyroxine`, `eltroxin`, `euthyrox`, `liothyronine`, `tertroxin`
**Drug SNOMED:** `10049011000001109`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| TSH | `tsh`, `thyroid stimulating hormone`, `thyroid function`, `tft` | `1022791000000101`, `166842003` | 365 d (1 y) | 30 d | — |

**Source:** NICE NG145 / BTA guidance

**Notes:** Annual TSH once stable on levothyroxine. More frequent during dose titration or in pregnancy. TSH alone is sufficient for monitoring stable replacement; full TFTs only needed if TSH abnormal or symptoms.

### `hrt-systemic`

**Class:** HRT  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `estradiol`, `oestradiol`, `conjugated oestrogens`, `conjugated estrogens`, `tibolone`, `femoston`, `kliovance`, `kliofem`, `kliogest`, `elleste duet`, `elleste solo`, `indivina`, `premique`, `premarin`, `evorel`, `femseven`, `estradot`, `sandrena`, `oestrogel`, `livial`, `lenzetto`, `progynova`, `zumenon`, `climaval`, `estraderm`, `nuvelle`, `norethisterone`, `medroxyprogesterone`, `micronised progesterone`, `utrogestan`, `bijuve`, `mirena`, `levonorgestrel intrauterine`, `levonorgestrel ius`, `levosert`, `jaydess`, `kyleena`, `lng-ius`
**Excluded:** `vagifem`, `imvaggis`, `ovestin`, `estring`, `vagirux`, `blissel`, `intrarosa`, `vaginal cream`, `vaginal tablet`, `vaginal ring`, `vaginal pessary`, `vaginal gel`, `pessary`, `ethinylestradiol`, `ethinyloestradiol`, `qlaira`, `zoely`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| BP | `blood pressure`, `bp` | `75367002` | 365 d (1 y) | 30 d | — |
| Weight | `weight`, `body weight` | `27113001` | 365 d (1 y) | 30 d | — |

**HRT context (endometrial-protection logic):**

- Oestrogen terms (gate the chip): `estradiol`, `oestradiol`, `conjugated oestrogens`, `conjugated estrogens`, `tibolone`, `femoston`, `kliovance`, `kliofem`, `kliogest`, `elleste duet`, `elleste solo`, `indivina`, `premique`, `premarin`, `evorel`, `femseven`, `estradot`, `sandrena`, `oestrogel`, `livial`, `lenzetto`, `bijuve`, `progynova`, `zumenon`, `climaval`, `estraderm`, `nuvelle`
- LNG-IUS terms: `mirena`, `levonorgestrel intrauterine`, `levonorgestrel ius`, `levosert`, `jaydess`, `kyleena`, `lng-ius`
- IUS problem-code terms: `intrauterine system`, `intrauterine device`, `mirena coil`, `insertion of mirena`, `introduction of mirena`, `replacement of intrauterine`, `fitting of intrauterine`, `iud fitted`, `ius fitted`, `coil fitted`, `coil inserted`, `hormone releasing intrauterine`, `insertion of hormone releasing`
- Progestogen terms: `utrogestan`, `micronised progesterone`, `norethisterone`, `medroxyprogesterone`, `dydrogesterone`, `progesterone`
- Hysterectomy terms: `hysterectomy`, `hysterectomised`, `hysterectomized`
- IUS validity: 5 years (older/undated coil code → `expired`)

**Source:** NICE NG23 (review 2024) / BNF / British Menopause Society

**Notes:** Annual HRT review: BP, weight, symptom control, risks/benefits, breast awareness. No routine bloods required for standard HRT. Mammography per national screening. Excludes local vaginal preparations which have no systemic effects (vaginal pessaries, creams, tablets, rings, gels). The chip fires ONLY when a systemic oestrogen / HRT agent (estradiol, conjugated oestrogens, tibolone, etc.) is prescribed: a progestogen or LNG-IUS (Mirena, Levosert, Jaydess, Kyleena) on its own is contraception, not HRT, so it does not raise this review. When oestrogen IS prescribed, a co-prescribed LNG-IUS/progestogen is reported as the progestogen (endometrial-protection) component via hrtContext. A problem-coded IUS insertion only counts as cover if coded within iusValidityYears (5y, the licensed endometrial-protection life of the 52mg LNG-IUS); an older/undated coil code is flagged 'expired' so cover falls through to the patient's actual progestogen rather than a removed device silently asserting protection.

### `adhd-stimulant-paediatric`

**Class:** ADHD stimulant  
**Phase:** maintenance · **Shared care:** yes
**Applies to:** age <17, sex any

**Drug match terms:** `methylphenidate`, `ritalin`, `concerta`, `equasym`, `medikinet`, `xenidate`, `delmosart`, `tranquilyn`, `affenid`, `atenza`, `kixel`, `matoride`, `xaggitin`, `focusim`, `meflynate`, `metyrol`, `lisdexamfetamine`, `elvanse`, `vyvanse`, `dexamfetamine`, `dexedrine`, `amfexa`, `amphetamine`
**Drug SNOMED:** `372574004`, `387340002`, `31994002`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Blood pressure | `blood pressure`, `bp` | `75367002` | 182 d (26 wk) | 21 d (3 wk) | — |
| Pulse / heart rate | `pulse`, `heart rate`, `hr`, `resting heart rate` | `78564009` | 182 d (26 wk) | 21 d (3 wk) | — |
| Weight | `weight`, `body weight` | `27113001` | 182 d (26 wk) | 21 d (3 wk) | — |
| Height | `height`, `body height` | `248335003` | 182 d (26 wk) | 21 d (3 wk) | — |

**Source:** NICE NG87 (ADHD diagnosis and management, 2018 updated 2019); BNF for Children; NHS shared care protocols

**Notes:** Post-stabilisation shared-care monitoring for ADHD stimulants in under-18s: BP, pulse, weight and height every 6 months. Consider 3-monthly in children under 10. Plot height and weight on centile charts — Sentinel confirms the measurement was taken but cannot verify centile position or growth velocity; the clinician must interpret the result. Action if >10% weight loss over weeks or height tracking significantly below the expected centile (consider planned treatment breaks over school holidays). Withhold/refer if sustained resting HR >130 bpm or BP >95th centile for age/height; review if HR >120 bpm. Refer to cardiology on unexplained syncope, palpitations with dizziness, or QT prolongation. Contraindicated in structural heart disease, uncontrolled hypertension or arrhythmia. Annual formal review of ongoing need. No routine bloods required by NG87; ECG only if cardiac risk factors at baseline.

### `adhd-stimulant-adult`

**Class:** ADHD stimulant  
**Phase:** maintenance · **Shared care:** yes
**Applies to:** age ≥18, sex any

**Drug match terms:** `methylphenidate`, `ritalin`, `concerta`, `equasym`, `medikinet`, `xenidate`, `delmosart`, `tranquilyn`, `affenid`, `atenza`, `kixel`, `matoride`, `xaggitin`, `focusim`, `meflynate`, `metyrol`, `lisdexamfetamine`, `elvanse`, `vyvanse`, `dexamfetamine`, `dexedrine`, `amfexa`, `amphetamine`
**Drug SNOMED:** `372574004`, `387340002`, `31994002`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Blood pressure | `blood pressure`, `bp` | `75367002` | 182 d (26 wk) | 21 d (3 wk) | — |
| Pulse / heart rate | `pulse`, `heart rate`, `hr`, `resting heart rate` | `78564009` | 182 d (26 wk) | 21 d (3 wk) | — |
| Weight | `weight`, `body weight` | `27113001` | 182 d (26 wk) | 21 d (3 wk) | — |

**Source:** NICE NG87 (ADHD diagnosis and management, 2018 updated 2019); BNF; NHS shared care protocols

**Notes:** Post-stabilisation shared-care monitoring for ADHD stimulants in adults (18+): BP, pulse and weight every 6 months. Height is not monitored in adults. Withhold/refer if sustained resting HR >130 bpm or BP >140/90 mmHg; review if HR >120 bpm. Refer to cardiology on unexplained syncope, palpitations with dizziness, or QT prolongation. Contraindicated in structural heart disease, uncontrolled hypertension or arrhythmia. Annual formal review of ongoing need. No routine bloods required by NG87; ECG only if cardiac risk factors at baseline.

### `atomoxetine-maintenance`

**Class:** ADHD non-stimulant  
**Phase:** maintenance · **Shared care:** yes
**Applies to:** age any, sex any

**Drug match terms:** `atomoxetine`, `strattera`
**Drug SNOMED:** `407146000`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Blood pressure | `blood pressure`, `bp` | `75367002` | 182 d (26 wk) | 21 d (3 wk) | — |
| Pulse / heart rate | `pulse`, `heart rate`, `hr`, `resting heart rate` | `78564009` | 182 d (26 wk) | 21 d (3 wk) | — |
| Weight | `weight`, `body weight` | `27113001` | 182 d (26 wk) | 21 d (3 wk) | — |
| LFT | `lft`, `liver function` | `26958001` | 365 d (1 y) | 30 d | — |

**Source:** NICE NG87; BNF / atomoxetine SmPC; MHRA hepatic and suicidality warnings

**Notes:** Non-stimulant. BP, pulse and weight 6-monthly; annual LFT (hepatotoxicity risk — advise patient to report jaundice, dark urine or unexplained upper abdominal pain; discontinue and refer urgently if liver injury confirmed). Monitor closely for suicidal ideation, agitation or irritability in the first month and after any dose change — this is a clinical review responsibility not enforceable by Sentinel. In children, plot height and weight on centile charts 3-monthly (Sentinel does not enforce height to avoid false alerts in adults). Withhold/refer if resting HR sustained >130 bpm or significant BP rise (6-12% of patients experience clinically significant BP or HR increases). Contraindicated in narrow-angle glaucoma and concurrent MAOI use.

### `guanfacine-maintenance`

**Class:** ADHD non-stimulant  
**Phase:** maintenance · **Shared care:** yes
**Applies to:** age any, sex any

**Drug match terms:** `guanfacine`, `intuniv`
**Drug SNOMED:** `96308008`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Blood pressure | `blood pressure`, `bp` | `75367002` | 84 d (12 wk) | 14 d (2 wk) | — |
| Pulse / heart rate | `pulse`, `heart rate`, `hr`, `resting heart rate` | `78564009` | 84 d (12 wk) | 14 d (2 wk) | — |
| Weight | `weight`, `body weight` | `27113001` | 84 d (12 wk) | 14 d (2 wk) | — |

**Source:** NICE NG87; BNF / guanfacine (Intuniv) SmPC; Sussex ICS shared care protocol

**Notes:** Non-stimulant alpha-2A agonist with stricter cardiovascular monitoring than stimulants. BP and pulse 3-monthly (Sentinel enforces 84-day interval as the safer default for year 1; local shared care may permit 6-monthly once stable beyond year 1). Risks: hypotension, bradycardia, syncope, and AV block — check lying and standing BP. Dose must be tapered on discontinuation to avoid rebound hypertension; never abruptly stop. In children, plot height and weight on centile charts 3-monthly (Sentinel confirms measurement recency but cannot verify centile). Contraindicated in significant cardiovascular or cerebrovascular disease and concurrent strong CYP3A4 inhibitors (e.g. ketoconazole, clarithromycin).

### `sodium-valproate`

**Class:** Antiepileptic / mood stabiliser  
**Phase:** maintenance · **Shared care:** yes

**Drug match terms:** `sodium valproate`, `valproate`, `valproic acid`, `epilim`, `episenta`, `orlept`, `convulex`, `depakote`, `belvo`, `dyzantil`, `epival`, `syonell`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| FBC | `fbc`, `full blood count` | `26604007` | 365 d (1 y) | 30 d | — |
| LFT | `lft`, `liver function` | `26958001` | 365 d (1 y) | 30 d | — |
| U&E / Ammonia | `u&e`, `urea and electrolytes`, `renal profile`, `ammonia` | `1019331000000106` | 365 d (1 y) | 30 d | — |

**Source:** BNF / NICE CG137 / Valproate Pregnancy Prevention Programme (MHRA 2018, updated 2024) / MHRA Drug Safety Update Feb 2025 (new branded formulations: Belvo, Dyzantil, Epival, Syonell)

**Notes:** Annual FBC, LFT, U&E for patients on long-term valproate. More frequent monitoring during the first 6 months and after any dose change. VALPROATE PREGNANCY PREVENTION PROGRAMME (PPP): women and girls of childbearing potential must NOT be prescribed valproate without a signed annual Risk Acknowledgement Form — this is a regulatory requirement (MHRA 2018). Prescribers must confirm each year that: the patient understands the teratogenic risk (spina bifida, other birth defects, neurodevelopmental disorders); effective contraception is being used; and the patient has a specialist review annually. Sentinel cannot enforce the PPP form — check manually for all female patients of childbearing age. 'Epilim Chrono' (valproate semisodium controlled release) is matched by 'epilim'. Convulex = valproic acid (essentially the same drug). Depakote = valproate semisodium. 2026-07-25 Keeper (drugs-001 RED): Added four new UK valproate brands named in MHRA Feb 2025 Drug Safety Update — Belvo (Atnahs Pharma), Dyzantil (Pfizer UK), Epival (Abbott), Syonell (Zentiva) — to plug a patient-safety monitoring gap confirmed by VERIFIER-A. Added 2026-07-11: BNF/MHRA corroborated; primary-source PDFs 403 that run.

### `finerenone`

**Class:** Non-steroidal MRA  
**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `finerenone`, `kerendia`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| U&E (serum potassium + eGFR) | `u&e`, `urea and electrolytes`, `renal profile`, `potassium`, `egfr` | `1019331000000106` | 120 d (~4 mo) | 21 d (3 wk) | — |

**Source:** BNF / NICE TA877 (finerenone for CKD in T2DM, 2023) / finerenone SmPC (Kerendia, Bayer) / MHRA

**Notes:** Finerenone (Kerendia) is a non-steroidal mineralocorticoid receptor antagonist licensed for CKD in T2DM (NICE TA877). Primary monitoring concern is hyperkalaemia — serum potassium and eGFR at baseline, at 4 weeks after initiation, and then every 4 months (120d) during maintenance. Withhold if serum K+ >5.5 mmol/L before starting; restart only when K+ <5.0 mmol/L. Reduce or withhold if eGFR falls to <25 mL/min/1.73m² or K+ consistently >5.5 mmol/L. Contraindicated with strong CYP3A4 inhibitors (itraconazole, ketoconazole, clarithromycin, ritonavir). Dispensing-practice note: ensure patients receive branded Kerendia (not generic preparations of spironolactone etc.) — finerenone is structurally distinct from spironolactone and eplerenone. Added 2026-07-11: BNF/NICE TA877 corroborated; primary SmPC PDF 403 this run.

### `dmpa-injectable`

**Class:** Progestogen-only injectable contraception  
**Phase:** maintenance · **Shared care:** no
**Applies to:** age any, sex female

**Drug match terms:** `depo-provera`, `depo provera`, `sayana press`, `sayana`, `dmpa`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Blood pressure | `blood pressure`, `bp` | `75367002` | 730 d (2 y) | 60 d (~2 mo) | — |
| Weight | `weight`, `body weight` | `27113001` | 730 d (2 y) | 60 d (~2 mo) | — |

**Source:** FSRH Clinical Guideline: Progestogen-only Injectables (Dec 2014, amended Jul 2023)

**Notes:** DMPA = Depo-Provera (medroxyprogesterone acetate 150mg/1ml IM) and Sayana Press (104mg/0.65ml SC). FSRH: review at least every 2 years (730d) to reassess risk/benefit — particularly bone mineral density (small, largely reversible loss; heightened under-18 and over-40 and with osteoporosis risk factors). Review weight at the 2-yearly assessment (weight gain is a recognised effect). BP does not rise with progestogen-only injectables (unlike CHC) but is checked as a UKMEC eligibility criterion at each visit (UKMEC 4 if BP ≥160/100). Return to fertility may be delayed up to ~1 year after the last injection. MATCH is brand-only by design: the bare generic 'medroxyprogesterone' is deliberately NOT used because it appears in the hrt-systemic rule (oral MPA), so a generic-string injectable record would double-fire — flagged for engine disambiguation. Noristerat (norethisterone enantate, 8-weekly, short-term only) is a different depot and is out of scope. SOURCE GAP: FSRH primary PDF 403 — corroborated via NHS formulary reproductions; pending primary-source confirmation.

### `chc-combined-hormonal`

**Class:** Combined hormonal contraception  
**Phase:** maintenance · **Shared care:** no
**Applies to:** age any, sex female

**Drug match terms:** `microgynon`, `ovranette`, `rigevidon`, `levest`, `maexeni`, `cilique`, `lizinna`, `marvelon`, `mercilon`, `gedarel`, `cimizt`, `femodene`, `femodette`, `millinette`, `yasmin`, `lucette`, `eloine`, `dianette`, `brevinor`, `norimin`, `ovysmen`, `loestrin`, `qlaira`, `zoely`, `evra`, `nuvaring`, `syreniring`, `ethinylestradiol`, `ethinyloestradiol`, `logynon`, `synphase`
**Excluded:** `cerazette`, `cerelle`, `zelleta`, `lovima`, `hana`, `nacrez`, `slinda`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| Blood pressure | `blood pressure`, `bp` | `75367002` | 365 d (1 y) | 30 d | — |
| BMI / Weight | `bmi`, `body mass index`, `weight`, `body weight` | `60621009`, `27113001` | 365 d (1 y) | 30 d | — |

**Source:** FSRH Guideline: Combined Hormonal Contraception (Jan 2019, amended Oct 2023); NICE CKS Contraception

**Notes:** FSRH/NICE mandate BP+BMI at initiation, a 3-month review, then at least annually — this rule enforces the annual recurring BP+BMI check. CHC = combined pills + Evra patch + NuvaRing/SyreniRing. Contraindicated in uncontrolled hypertension (UKMEC 4 ≥160/100; UKMEC 3 ≥140/90 or BMI ≥35); reassess VTE/CVD risk at each review. DISAMBIGUATION (enabled 2026-06-20): the hrt-systemic rule matches the bare term 'estradiol', which is a SUBSTRING of the contraceptive oestrogen 'ethinylestradiol' and of the natural-oestrogen pills' 'estradiol valerate' (Qlaira) / 'estradiol hemihydrate' (Zoely). To stop CHC patients double-firing the HRT review, hrt-systemic now EXCLUDES 'ethinylestradiol'/'ethinyloestradiol'/'qlaira'/'zoely' (none of which are HRT). CHC matches by brand plus the contraceptive-only oestrogen 'ethinylestradiol'/'ethinyloestradiol' (so generic ethinylestradiol+progestogen combos fire here, never as HRT). POPs (Cerazette/Cerelle/Zelleta/Lovima/Hana/Nacrez — desogestrel) are excluded. Slinda (drospirenone 4 mg POP) added to exclude list 2026-07-11 — it is a POP, not a CHC, but 'slinda' contains no CHC-like substring that would auto-fire; excluded explicitly to future-proof against any prescribing-system records that render it alongside ethinylestradiol component names (BNF/FSRH corroborated; primary PDFs 403 this run). Logynon and Synphase (triphasic ethinylestradiol+levonorgestrel) added to match list 2026-07-11 — both are actively dispensed in the UK (BNF/dm+d corroborated). SOURCE: FSRH Combined Hormonal Contraception (2019, amended 2023); corroborated via NHS formulary/NICE CKS. MHRA: co-prescribed tirzepatide (Mounjaro) may reduce absorption of oral contraceptives, especially in overweight/obese patients — advise an additional barrier method or a non-oral method for 4 weeks after starting tirzepatide and after each dose increase (corroborated 2026-06-21; primary MHRA wording pending confirmation).

### `digoxin-renal-monitoring` **[SHIPPED DISABLED]**

**Phase:** maintenance · **Shared care:** no

**Drug match terms:** `digoxin`, `lanoxin`

**Monitoring requirements:**

| Test | Match terms | SNOMED | Interval | Due-soon window | Post-initiation |
|---|---|---|---|---|---|
| U&E / eGFR | `urea`, `electrolytes`, `egfr`, `creatinine`, `renal function`, `u&e` | `166717003`, `80274001` | 365 d (1 y) | 30 d | — |

**Source:** BNF Digoxin monograph (monitoring: U&E/eGFR at least annually; dose reduction required if eGFR <30 per STOPP v3 B1). 2026-08-01 (The Keeper, alert-C005 RED): gap identified by direct code inspection — no digoxin monitoring rule existed in drug-rules.json; stopp-start.js encodes the STOPP v3 B1 eGFR<30 dose-criterion (fail-closed when eGFR unknown) but provides no proactive annual monitoring chip. Lanoxin confirmed only UK-licensed brand (dm+d/BNF).

**Notes:** DISABLED PENDING CSO ACTIVATION (enabled:false). The Keeper identified this gap on 2026-08-01 (alert-C005, RED): digoxin is a high-risk drug with a narrow therapeutic index and renal-dose sensitivity but had no entry in Sentinel drug-monitoring rules. Lanoxin (GlaxoSmithKline/Aspen) is the only UK-licensed brand (Lanoxin-PG is the 25 mcg/5 ml paediatric liquid, same brand family). Annual U&E/eGFR monitoring is required to detect toxicity risk from renal impairment. CSO must review the monitoring interval and confirm this rule is appropriate for this practice before enabling. STOPP v3 B1 separately flags digoxin use when eGFR<30 — that criterion is in engine/stopp-start.js and fires independently of this rule.

---

## Part 2 — Drug–allergy cross-checks (4)

Type `drug-allergy`. Fires only when a documented **active** allergy co-occurs with a contraindicated drug. Requires the Transactional feed (fails closed otherwise).

### `allergy-penicillin` — Penicillin allergy + penicillin/beta-lactam

**Severity:** red

**Allergy terms:** `penicillin`, `amoxicillin allerg`, `flucloxacillin allerg`, `co-amoxiclav allerg`, `beta-lactam allerg`, `betalactam allerg`, `phenoxymethylpenicillin allerg`, `benzylpenicillin allerg`
**Drug set — Penicillins:** `penicillin`, `amoxicillin`, `ampicillin`, `flucloxacillin`, `co-amoxiclav`, `co amoxiclav`, `phenoxymethylpenicillin`, `benzylpenicillin`, `pivmecillinam`, `piperacillin`, `temocillin`

**Source:** BNF/NICE CKS drug allergy; MHRA. PENDING CSO REVIEW.

**Notes:** Fires when an active penicillin/beta-lactam allergy co-occurs with a penicillin-class drug. Cross-reactivity with cephalosporins/carbapenems is handled by the separate cross-sensitivity rule.

### `allergy-penicillin-cephalosporin-xs` — Penicillin allergy + cephalosporin (cross-sensitivity)

**Severity:** amber · cross-sensitivity caution (not absolute)

**Allergy terms:** `penicillin`, `beta-lactam allerg`, `betalactam allerg`
**Drug set — Cephalosporins/carbapenems:** `cefalexin`, `cephalexin`, `cefaclor`, `cefadroxil`, `cefuroxime`, `cefixime`, `cefotaxime`, `ceftriaxone`, `ceftazidime`, `cefepime`, `meropenem`, `imipenem`, `ertapenem`, `aztreonam`

**Source:** BNF/NICE CKS: ~1-3% cephalosporin cross-reactivity in penicillin allergy; lower with 3rd-gen. PENDING CSO REVIEW.

**Notes:** Cross-sensitivity CAUTION (amber), not an absolute contraindication — review documented reaction severity.

### `allergy-nsaid` — NSAID/aspirin hypersensitivity + NSAID

**Severity:** red

**Allergy terms:** `nsaid`, `non-steroidal anti-inflammatory`, `aspirin allerg`, `ibuprofen allerg`, `naproxen allerg`, `diclofenac allerg`, `salicylate allerg`
**Drug set — NSAIDs:** `ibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `indometacin`, `indomethacin`, `ketoprofen`, `mefenamic acid`, `nabumetone`, `etodolac`, `aspirin`, `acetylsalicylic`
**Excluded:** `topical`, `gel`, `cream`, `patch`, `spray`, `eye drop`

**Source:** BNF/NICE CKS NSAID hypersensitivity; cross-reactivity across NSAID class. PENDING CSO REVIEW.

**Notes:** Fires when active NSAID/aspirin/salicylate hypersensitivity co-occurs with a systemic NSAID. Topical formulations excluded. Aspirin-exacerbated respiratory disease is a class effect.

### `allergy-sulfonamide` — Sulfonamide allergy + sulfonamide antibiotic

**Severity:** red

**Allergy terms:** `sulfonamide`, `sulphonamide`, `sulfa allerg`, `co-trimoxazole allerg`, `trimethoprim-sulfamethoxazole allerg`, `sulfamethoxazole allerg`
**Drug set — Sulfonamide antibiotics:** `co-trimoxazole`, `co trimoxazole`, `sulfamethoxazole`, `sulfadiazine`, `sulfasalazine`

**Source:** BNF/NICE CKS sulfonamide allergy. PENDING CSO REVIEW.

**Notes:** Fires when an active sulfonamide-antibiotic allergy co-occurs with a sulfonamide antibiotic. Non-antibiotic sulfonamide cross-reactivity (e.g. thiazides, sulfonylureas) is contested and NOT encoded.

---

## Part 3 — Vaccine rules (5)

Source file: `rules/vaccine-rules.json`. JCVI/UKHSA 2026/27 season (2026-06-17 CSO-approved: RSV 75+/care-home expansion, flu homelessness cohort, pneumococcal PCV20 relabel — verify against source letters; applied this run without page-verification due to WebFetch 403). 2026-07-11 (The Keeper): flu homelessness clause corrected to ageMin:16 per gov.uk flu programme amendment letter 9 June 2026; shingles notes corrected to immunosuppressed 18+ (was 50+, expanded from 1 Sept 2025); RSV notes updated re 65-74 clinical-risk future eligibility. 2026-07-25 (The Keeper): RSV notes updated — 65-74 clinical-risk expansion confirmed published 2 July 2026 (NHSE operational letter), effective 1 Sept 2026; mRESVIA (mRNA RSV vaccine, Moderna, MHRA authorised Feb 2025) added to statusTerms.given; RSV care-home note corrected to 'all adult residents (no minimum age)'; pneumococcal homelessness cohort (age 16+, effective 1 Oct 2026) added. 2026-08-01 (The Keeper, vax-002 RED): mRESVIA declined variants added to vax-rsv statusTerms.declined — gap confirmed by code inspection (no mresvia declined terms existed; 'mresvia refused' substring-matches the given term 'mresvia' → C2-class false-GIVEN risk); 5 declined terms added: mresvia refused/contraindicated/not given/not indicated/declined. 2026-08-01 (The Keeper, vax-003 RED): engine/rules-engine.js matchVaccineEligibility() fixed — problem and medication handlers now enforce ageMin/ageMax, mirroring the age handler; ageMin:16 on the flu and pneumococcal homelessness clauses was silently unenforced before this fix.

**File-level note:** Seasonal rules (flu, COVID) use schedule+season for campaign-window suppression. One-off lifetime rules (pneumococcal, shingles, RSV) use schedule:once. INTENTIONAL OMISSIONS: pertussis-in-pregnancy and RSV-in-pregnancy are not encoded — the engine has no per-pregnancy episode gate or gestational-age gate; a lifetime lookback cannot distinguish doses given in prior pregnancies.

Eligibility is `anyOf` — a patient matching **any one** clause is eligible. Clause kinds:

| Kind | Meaning |
|---|---|
| `age` | age band (`ageMin`/`ageMax`) |
| `problem` | substring match against coded problems (optionally age/sex-gated) |
| `medication` | substring match against current medication |
| `register` | membership of a QOF register (register codes) |
| `conditional-register` | register membership AND at least one of `andAnyOf` sub-conditions |
| `observation-threshold` | numeric observation compared with `operator` + `value` |

`statusTerms.given` / `statusTerms.declined` are matched against coded immunisation/problem entries. **Order matters**: a declined term that is a superstring of a given term must be listed in `declined` or it substring-matches as GIVEN (the mRESVIA vax-002 defect).

### `vax-flu` — Flu vaccine

**Vaccine:** flu · **Schedule:** seasonal, campaign window 1/9 – 31/3

**Eligibility (anyOf):**

| Clause | Criteria |
|---|---|
| Age 65+ *(age)* | age ≥65 |
| Child (2–17 years) *(age)* | age 2–17 |
| Pregnancy *(problem)* | sex female · match `pregnan` |
| Experiencing homelessness (age 16+) *(problem)* | age ≥16 · match `homeless`, `rough sleeper`, `no fixed abode`, `night shelter resident`, `hostel resident` |
| Clinical risk group (QOF register) *(register)* | registers `DM`, `CKD`, `COPD`, `CHD`, `HF`, `STIA`, `AF`, `PAD` |
| Clinical risk group (problem) *(problem)* | match `cirrhosis`, `chronic hepatitis b`, `chronic hepatitis c`, `chronic liver disease`, `primary biliary`, `primary sclerosing cholangitis`, `biliary atresia`, `epilepsy`, `multiple sclerosis`, `parkinson`, `cerebral palsy`, `motor neurone`, `huntington`, `splenectomy`, `asplenia`, `hyposplenism`, `sickle cell`, `thalassaemia major`, `hereditary spherocytosis`, `hiv`, `aids`, `transplant`, `leukaemia`, `lymphoma`, `myeloma`, `bronchiectasis`, `cystic fibrosis`, `pulmonary fibrosis`, `interstitial lung`, `learning disabilit`, `downs syndrome`, `down syndrome` |
| Immunosuppressive medication *(medication)* | match `rituximab`, `adalimumab`, `infliximab`, `etanercept`, `abatacept`, `tocilizumab`, `secukinumab`, `ustekinumab`, `baricitinib`, `tofacitinib`, `azathioprine`, `ciclosporin`, `mycophenolate`, `tacrolimus`, `sirolimus`, `methotrexate`, `cyclophosphamide`, `chlorambucil`, `prednisolone`, `dexamethasone`, `chemotherapy` |
| BMI ≥40 kg/m² *(observation-threshold)* | observation `bmi`, `body mass index` >= 40 |
| Asthma on inhaled/systemic steroids *(conditional-register)* | register `ASTHMA` · AND any of → medication: `beclometasone`, `budesonide`, `fluticasone`, `mometasone`, `ciclesonide`, `seretide`, `symbicort`, `fostair`, `clenil`, `relvar`, `trimbow` **OR** problem: `brittle asthma`, `severe asthma`, `admission for asthma`, `hospitalisation for asthma` |

**Coded as GIVEN:** `influenza vaccination given`, `influenza vaccine given`, `flu vaccin`, `seasonal influenza vaccin`, `influenza immunisation given`

**Coded as DECLINED / not given:** `influenza vaccination declined`, `flu vaccine declined`, `influenza immunisation declined`, `influenza vaccination not given`, `flu vaccination not given`, `flu vaccin refused`, `flu vaccin contraindicated`, `flu vaccin not given`, `flu vaccin not indicated`, `flu vaccin declined`, `influenza immunisation refused`, `influenza immunisation contraindicated`, `influenza immunisation not given`, `influenza immunisation not indicated`, `influenza vaccination refused`, `influenza vaccination contraindicated`, `influenza vaccination not indicated`, `influenza vaccine refused`, `influenza vaccine contraindicated`, `influenza vaccine not given`, `influenza vaccine not indicated`, `influenza vaccine declined`, `seasonal influenza vaccin refused`, `seasonal influenza vaccin contraindicated`, `seasonal influenza vaccin not given`, `seasonal influenza vaccin not indicated`, `seasonal influenza vaccin declined`

**Source:** JCVI/UKHSA Green Book Chapter 19 (Influenza). 2026/27 programme carries forward the 2025/26 eligible groups, age bands and risk groups; a people-experiencing-homelessness cohort is added from 1 Oct 2026 (CSO-approved 2026-06-17; confirm against the flu letter).

**Notes:** DOUBLE-CHECK ELIGIBILITY: Status inferred from coded records only — vaccination given elsewhere may not appear. Asthma sub-criterion requires inhaled/systemic steroids or prior hospital admission (proxy via medication check). Carers and care home residents are not detected. Homelessness is rarely coded in GP records, so the homelessness cohort flags only patients with an explicit code — not the broader population; operational outreach remains the primary route. BMI reading may be out of date.

### `vax-covid` — COVID vaccine

**Vaccine:** covid · **Schedule:** seasonal, campaign window 1/10 – 31/3

**Eligibility (anyOf):**

| Clause | Criteria |
|---|---|
| Age 75+ *(age)* | age ≥75 |
| Care home resident *(problem)* | match `care home resident`, `nursing home resident`, `residential care` |
| Immunosuppressed (problem) *(problem)* | match `transplant`, `stem cell`, `bone marrow`, `leukaemia`, `lymphoma`, `myeloma`, `hiv`, `aids`, `primary immunodeficiency`, `severe combined immunodeficiency`, `scid`, `chronic leukaemia`, `hodgkin` |
| Immunosuppressed (medication) *(medication)* | match `rituximab`, `ciclosporin`, `mycophenolate`, `tacrolimus`, `azathioprine`, `methotrexate`, `cyclophosphamide`, `chemotherapy`, `alemtuzumab`, `ofatumumab`, `ibrutinib`, `venetoclax` |

**Coded as GIVEN:** `covid-19 vaccination`, `covid vaccination`, `sars-cov-2 vaccin`, `covid booster`, `covid-19 booster`, `covid vaccine given`

**Coded as DECLINED / not given:** `covid-19 vaccination declined`, `covid vaccine declined`, `covid vaccination declined`, `covid booster refused`, `covid booster contraindicated`, `covid booster not given`, `covid booster not indicated`, `covid booster declined`, `covid vaccination refused`, `covid vaccination contraindicated`, `covid vaccination not given`, `covid vaccination not indicated`, `covid vaccine refused`, `covid vaccine contraindicated`, `covid vaccine not given`, `covid vaccine not indicated`, `covid-19 booster refused`, `covid-19 booster contraindicated`, `covid-19 booster not given`, `covid-19 booster not indicated`, `covid-19 booster declined`, `covid-19 vaccination refused`, `covid-19 vaccination contraindicated`, `covid-19 vaccination not given`, `covid-19 vaccination not indicated`, `sars-cov-2 vaccin refused`, `sars-cov-2 vaccin contraindicated`, `sars-cov-2 vaccin not given`, `sars-cov-2 vaccin not indicated`, `sars-cov-2 vaccin declined`

**Source:** JCVI COVID-19 autumn 2026/27 eligibility statement — confirmed NO eligible-cohort changes from autumn 2025: only age 75+, care home residents, and the immunosuppressed remain eligible.

**Notes:** DOUBLE-CHECK ELIGIBILITY: As of 2025/26, clinical risk groups (diabetes, CHD, CKD, asthma) are NO LONGER eligible for COVID booster — only age 75+, care home residents, and immunosuppressed. Status inferred from coded records only — vaccination given elsewhere may not appear.

### `vax-pneumo-ppv23` — Pneumococcal vaccine (PCV20)

**Vaccine:** pneumococcal · **Schedule:** once (lifetime)

**Eligibility (anyOf):**

| Clause | Criteria |
|---|---|
| Age 65+ *(age)* | age ≥65 |
| Experiencing homelessness (age 16+, from 1 Oct 2026) *(problem)* | age ≥16 · match `homeless`, `rough sleeper`, `no fixed abode`, `night shelter resident`, `hostel resident` |

**Coded as GIVEN:** `pneumococcal vaccination`, `pneumococcal vaccine`, `pneumococcal polysaccharide vaccin`, `pneumovax`, `ppv23`, `23-valent pneumococcal`, `pcv20`, `20-valent pneumococcal`, `apexxnar`, `prevenar 20`, `pneumococcal conjugate vaccin`, `pneumococcal immunisation`

**Coded as DECLINED / not given:** `pneumococcal vaccination declined`, `pneumococcal vaccine declined`, `pneumococcal immunisation declined`, `pneumococcal vaccination not given`, `20-valent pneumococcal refused`, `20-valent pneumococcal contraindicated`, `20-valent pneumococcal not given`, `20-valent pneumococcal not indicated`, `20-valent pneumococcal declined`, `23-valent pneumococcal refused`, `23-valent pneumococcal contraindicated`, `23-valent pneumococcal not given`, `23-valent pneumococcal not indicated`, `23-valent pneumococcal declined`, `apexxnar refused`, `apexxnar contraindicated`, `apexxnar not given`, `apexxnar not indicated`, `apexxnar declined`, `pcv20 refused`, `pcv20 contraindicated`, `pcv20 not given`, `pcv20 not indicated`, `pcv20 declined`, `pneumococcal conjugate vaccin refused`, `pneumococcal conjugate vaccin contraindicated`, `pneumococcal conjugate vaccin not given`, `pneumococcal conjugate vaccin not indicated`, `pneumococcal conjugate vaccin declined`, `pneumococcal immunisation refused`, `pneumococcal immunisation contraindicated`, `pneumococcal immunisation not given`, `pneumococcal immunisation not indicated`, `pneumococcal polysaccharide vaccin refused`, `pneumococcal polysaccharide vaccin contraindicated`, `pneumococcal polysaccharide vaccin not given`, `pneumococcal polysaccharide vaccin not indicated`, `pneumococcal polysaccharide vaccin declined`, `pneumococcal vaccination refused`, `pneumococcal vaccination contraindicated`, `pneumococcal vaccination not indicated`, `pneumococcal vaccine refused`, `pneumococcal vaccine contraindicated`, `pneumococcal vaccine not given`, `pneumococcal vaccine not indicated`, `pneumovax refused`, `pneumovax contraindicated`, `pneumovax not given`, `pneumovax not indicated`, `pneumovax declined`, `ppv23 refused`, `ppv23 contraindicated`, `ppv23 not given`, `ppv23 not indicated`, `ppv23 declined`, `prevenar 20 refused`, `prevenar 20 contraindicated`, `prevenar 20 not given`, `prevenar 20 not indicated`, `prevenar 20 declined`

**Source:** UKHSA Green Book Chapter 25 (Pneumococcal) — single dose at age 65+; the routine adult vaccine changed from PPV23 to PCV20 (Apexxnar) in early 2026 (CSO-approved 2026-06-17; confirm against the change-of-vaccine letter). No routine revaccination. 2026-07-25 (vacc-003, VERIFIER-B AMBER): People experiencing homelessness (PEH) aged 16+ confirmed as a new eligible cohort from 1 October 2026, per GOV.UK published commissioning letter (JCVI advice June 2024, policy confirmed July 2026).

**Notes:** DOUBLE-CHECK ELIGIBILITY: One-off dose from age 65 (routine vaccine is now PCV20; a previously-recorded PPV23 dose still counts as given). Status inferred from coded records only — vaccination given elsewhere (or pre-registration) may not appear. Revaccination every 5 years applies ONLY to asplenia/splenic dysfunction/CKD and is NOT encoded here — check manually for those patients. At-risk under-65 cohort (Green Book ch 25 risk groups) intentionally not encoded EXCEPT the homelessness cohort below. Rule id retained as 'vax-pneumo-ppv23' so existing user snoozes/overrides are preserved. HOMELESSNESS COHORT (vacc-003, effective 1 Oct 2026): people experiencing homelessness aged 16+ become eligible — rough sleepers and those using hostels for the homeless or night shelters. Match terms proxy the coding used in Medicus; homelessness is rarely coded so this will flag only patients with an explicit code. Operational outreach remains the primary delivery route. Source: GOV.UK pneumococcal vaccination expansion letter, JCVI advice June 2024.

### `vax-shingles` — Shingles vaccine (Shingrix)

**Vaccine:** shingles · **Schedule:** once (lifetime)

**Eligibility (anyOf):**

| Clause | Criteria |
|---|---|
| Age 70–79 (routine shingles cohort) *(age)* | age 70–79 |
| Turned 65 on/after 1 Sept 2023 (phased cohort) *(age)* | age 65–69 |

**Coded as GIVEN:** `shingles vaccination`, `shingles vaccine`, `herpes zoster vaccin`, `shingrix`, `zostavax`, `zoster vaccination`

**Coded as DECLINED / not given:** `shingles vaccination declined`, `shingles vaccine declined`, `herpes zoster vaccination declined`, `shingles vaccination not given`, `herpes zoster vaccin refused`, `herpes zoster vaccin contraindicated`, `herpes zoster vaccin not given`, `herpes zoster vaccin not indicated`, `herpes zoster vaccin declined`, `shingles vaccination refused`, `shingles vaccination contraindicated`, `shingles vaccination not indicated`, `shingles vaccine refused`, `shingles vaccine contraindicated`, `shingles vaccine not given`, `shingles vaccine not indicated`, `shingrix refused`, `shingrix contraindicated`, `shingrix not given`, `shingrix not indicated`, `shingrix declined`, `zostavax refused`, `zostavax contraindicated`, `zostavax not given`, `zostavax not indicated`, `zostavax declined`, `zoster vaccination refused`, `zoster vaccination contraindicated`, `zoster vaccination not given`, `zoster vaccination not indicated`, `zoster vaccination declined`

**Source:** UKHSA Green Book Chapter 28a (Shingles) — phased programme from 1 Sept 2023: routine offer on turning 65 (cohort born on/after 1 Sept 1958) plus existing 70–79 cohort; Shingrix 2 doses 6–12 months apart

**Notes:** DOUBLE-CHECK ELIGIBILITY AND DOSES: Shingrix is a 2-dose course (6–12 months apart) — this chip shows GIVEN on ANY recorded shingles/zoster vaccination and CANNOT verify 2-dose completion; check dose count manually. People aged 68–69 who turned 65 before 1 Sept 2023 are NOT yet eligible and are correctly not flagged. Severely immunosuppressed adults aged 18+ pathway (from 1 Sept 2025) is NOT encoded (engine cannot combine age + clinical criteria in one clause) — assess manually for immunosuppressed patients from age 18. Historic Zostavax counts as given. 2026-07-11: corrected notes age for immunosuppressed pathway from '50+' to '18+' per UKHSA expansion from 1 Sept 2025 (corroborated via UKHSA Green Book Ch 28a search; primary PDF 403).

### `vax-rsv` — RSV vaccine

**Vaccine:** rsv · **Schedule:** once (lifetime)

**Eligibility (anyOf):**

| Clause | Criteria |
|---|---|
| Age 75+ *(age)* | age ≥75 |
| Care-home resident (adult, all ages) *(problem)* | match `care home resident`, `nursing home resident`, `residential care` |

**Coded as GIVEN:** `respiratory syncytial virus vaccin`, `rsv vaccination`, `rsv vaccine`, `abrysvo`, `arexvy`, `mresvia`

**Coded as DECLINED / not given:** `rsv vaccination declined`, `rsv vaccine declined`, `respiratory syncytial virus vaccination declined`, `rsv vaccination not given`, `abrysvo refused`, `abrysvo contraindicated`, `abrysvo not given`, `abrysvo not indicated`, `abrysvo declined`, `arexvy refused`, `arexvy contraindicated`, `arexvy not given`, `arexvy not indicated`, `arexvy declined`, `respiratory syncytial virus vaccin refused`, `respiratory syncytial virus vaccin contraindicated`, `respiratory syncytial virus vaccin not given`, `respiratory syncytial virus vaccin not indicated`, `respiratory syncytial virus vaccin declined`, `rsv vaccination refused`, `rsv vaccination contraindicated`, `rsv vaccination not indicated`, `rsv vaccine refused`, `rsv vaccine contraindicated`, `rsv vaccine not given`, `rsv vaccine not indicated`, `mresvia refused`, `mresvia contraindicated`, `mresvia not given`, `mresvia not indicated`, `mresvia declined`

**Source:** UKHSA Green Book Chapter 27a (RSV) / JCVI advice / NHSE operational letter July 2026 (65-74 clinical-risk expansion, effective 1 Sept 2026) / MHRA marketing authorisation (mRESVIA, Feb 2025).

**Notes:** DOUBLE-CHECK ELIGIBILITY: Single dose, no booster currently recommended. Eligibility expanded 1 April 2026 to remove the upper age bound (now age 75+) and to include ALL adult care-home residents (no minimum age) — applied on CSO direction; verify against the JCVI/NHSE letter. RSV-in-pregnancy pathway (from 28 weeks) is intentionally NOT encoded — see pertussis omission note. FUTURE ELIGIBILITY — 65-74 CLINICAL RISK (vacc-001, 2026-07-25): NHSE operational letter confirmed published 2 July 2026. From 1 September 2026, adults aged 65-74 in TWO specific clinical-risk groups become eligible: (1) chronic respiratory disease including poorly controlled asthma, chronic bronchitis, or cystic fibrosis; (2) immunosuppression due to disease or treatment (e.g. blood cancer, chemotherapy). NOT included in this September 2026 wave: cardiovascular disease, liver disease, kidney disease. NHS programme vaccine remains Abrysvo® only (not mRESVIA). An engine change is needed to encode conditional-age eligibility (age band + clinical-risk) before this clause can go live in the extension — eligibility not yet encoded in the anyOf clause; assess manually for 65-74 clinical-risk patients from 1 Sept 2026. CARE-HOME NOTES (vacc-004, 2026-07-25): all adult residents of care homes for older adults are eligible — no minimum age, following JCVI advice that eligibility extends to all adults regardless of age in that setting. NOTE re mRESVIA (vacc-002): MHRA authorised mRESVIA (Moderna mRNA RSV vaccine) February 2025 for adults 60+; it is NOT the NHS programme vaccine (NHS uses Abrysvo only) but may appear in records for patients vaccinated privately — 'mresvia' added to statusTerms.given to prevent false 'unvaccinated' flags for those patients.

---

## Part 4 — Prescribing-safety alert library (35)

Source file: `rules/alert-library.json` v1.5. PINCER/NICE prescribing-safety alert library v1.4

**File-level note:** Starter library of prescribing-safety and clinical alerts for UK primary care. Based on PINCER (BMJ 2012, doi:10.1136/bmj.e6501) and UK prescribing safety guidelines. Each rule is an editable starting point — GPs should review match terms and thresholds against their local formulary and patient population. See individual notes fields for clinical justification and known limitations.

### Index

| libId | Severity | Type | Category / subcategory | Title |
|---|---|---|---|---|
| `pincer-1` | red | drug-combo | Prescribing safety / GI bleed | NSAID without gastroprotection (≥65) |
| `pincer-2` | red | drug-combo | Prescribing safety / GI bleed | Anticoagulant + NSAID concurrent |
| `pincer-3` | red | drug-combo | Prescribing safety / GI bleed | Aspirin + NSAID concurrent (no PPI) |
| `pincer-4` | red | drug-combo | Prescribing safety / Renal | ACE inhibitor or ARB + NSAID concurrent |
| `pincer-5` | red | drug-combo | Prescribing safety / Cardiovascular | Beta-blocker + verapamil or diltiazem concurrent |
| `pincer-6` | red | drug-combo | Prescribing safety / Heart failure | NSAID in heart failure |
| `pincer-7` | — | drug-monitoring | Prescribing safety / Anticoagulation | Warfarin without recent INR (90 days) |
| `pincer-8` | amber | drug-combo | Prescribing safety / Bleeding | Aspirin + clopidogrel without PPI (dual antiplatelet) |
| `pincer-9` | — | drug-monitoring | Prescribing safety / Renal | Metformin without recent renal function check |
| `pincer-10` | — | drug-monitoring | Prescribing safety / Electrolytes | Loop diuretic without recent U&E (6 months) |
| `pincer-11` | — | drug-monitoring | Prescribing safety / Electrolytes | Amiodarone without 6-monthly TFT/LFT |
| `pincer-12` | red | drug-combo | Prescribing safety / Lithium safety | Lithium + NSAID concurrent |
| `pincer-13` | red | drug-combo | Prescribing safety / Anticoagulation | Anticoagulant + antiplatelet (triple therapy) in ≥75s |
| `mhra-valproate-ppg` | red | drug-combo | Prescribing safety / Teratogenicity | Valproate in female of childbearing age |
| `nice-lithium-monitoring` | — | drug-monitoring | Prescribing safety / Lithium safety | Lithium without 3-monthly level + 6-monthly U&E/TFT |
| `mhra-sglt2-dka` | info | drug-combo | Prescribing safety / Renal | SGLT2 inhibitor — DKA awareness reminder |
| `mhra-glp1-acute-pancreatitis` | amber | drug-combo | Prescribing safety / GI | GLP-1 / GIP agonist — acute pancreatitis awareness reminder |
| `mhra-isotretinoin-ppg` | red | drug-combo | Prescribing safety / Teratogenicity | Isotretinoin in female of childbearing age |
| `prescribing-qtc-combination` | amber | drug-combo | Prescribing safety / QTc prolongation | Two or more QTc-prolonging drugs concurrent |
| `event-count-1` | amber | event-count | Clinical review / Infections | Recurrent UTI (≥3 in 12 months, female <65) |
| `event-count-2` | amber | event-count | Clinical review / Falls | Recurrent falls (≥2 in 12 months, ≥65) |
| `composite-1` *(disabled)* | red | composite | Prescribing safety / GI bleed | High-risk GI bleed combination (NSAID + anticoagulant, ≥65, HF) |
| `trend-1` | — | qof-indicator | Clinical review / Cancer screening | Rising PSA trend (≥3 readings, 24 months) |
| `pincer-mtx-trimethoprim` | red | drug-combo | Prescribing safety / Bone marrow suppression | Methotrexate + trimethoprim / co-trimoxazole — severe bone marrow suppression |
| `mhra-acei-arb-ksparing-hyperkalaemia` | amber | drug-combo | Prescribing safety / Electrolytes | ACEi/ARB + potassium-sparing diuretic/aldosterone antagonist — hyperkalaemia |
| `alert-001` | red | drug-combo | Prescribing safety / GI bleed | NSAID + peptic ulcer history without PPI (PINCER primary outcome) |
| `alert-002` | red | drug-combo | Prescribing safety / Respiratory | Beta-blocker + asthma (PINCER primary outcome) |
| `alert-004` | red | drug-combo | Prescribing safety / Teratogenicity | Acitretin or alitretinoin in female of childbearing age (oral retinoids) |
| `alert-005` | amber | drug-combo | Prescribing safety / Psychiatric adverse effects | Finasteride or dutasteride — psychiatric adverse effects (MHRA May 2026) |
| `alert-008` | amber | drug-combo | Prescribing safety / GI bleed | Antiplatelet + peptic ulcer history without PPI (PRIMIS secondary) |
| `alert-009` | amber | drug-combo | Prescribing safety / Renal | Systemic NSAID in coded CKD |
| `alert-domperidone-phaeo` | red | drug-combo | Prescribing safety / Endocrine / catecholamine crisis | Domperidone — CONTRAINDICATED in phaeochromocytoma / paraganglioma |
| `alert-acei-angioedema` | red | drug-combo | Prescribing safety / Angioedema / airway risk | ACEi — recurrent or severe angioedema (absolute contraindication to re-prescribing) |
| `alert-antipsychotic-dementia` | amber | drug-combo | Prescribing safety / Dementia / sedation risk | Antipsychotic in dementia — increased mortality and stroke risk (AMBER); CONTRAINDICATED in Lewy body dementia (RED — see notes) |
| `alert-xoi-thiopurine-myelosuppression` | red | drug-combo | Prescribing safety / Bone marrow suppression | Allopurinol/febuxostat + azathioprine/mercaptopurine — life-threatening myelosuppression |

### `pincer-1` — NSAID without gastroprotection (≥65)

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / GI bleed

**Description:** PINCER #1: patient aged ≥65 prescribed a systemic NSAID without a co-prescribed PPI or H2-blocker. The absence-of-gastroprotection half cannot be fully expressed with a single drug-combo set; this rule fires on NSAID presence in ≥65s and flags review. Enable the mustNotBePresent variant below if your formulary is consistent.

**Trigger logic — ALL drug sets must be present:**

- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **AND none of (must not be present):** `omeprazole`, `lansoprazole`, `esomeprazole`, `pantoprazole`, `rabeprazole`, `ranitidine`, `famotidine`, `cimetidine`
- **Demographics:** age ≥65, sex any

**Source:** PINCER #1

**Notes:** PINCER #1. Co-prescribe PPI (first line) or H2-blocker if NSAID must be continued. Consider whether NSAID can be stopped. mustNotBePresent list covers PPIs and H2-blockers — rule fires only when NONE of these are co-prescribed.

### `pincer-2` — Anticoagulant + NSAID concurrent

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / GI bleed

**Description:** PINCER #2: patient prescribed an oral anticoagulant (warfarin or DOAC) AND a systemic NSAID — major GI bleed risk.

**Trigger logic — ALL drug sets must be present:**

- **Anticoagulant:** `warfarin`, `acenocoumarol`, `phenindione`, `apixaban`, `rivaroxaban`, `dabigatran`, `edoxaban`
- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **Demographics:** age any, sex any

**Source:** PINCER #2

**Notes:** PINCER #2. Concurrent anticoagulant + systemic NSAID markedly increases GI bleed risk. Consider stopping NSAID; ensure PPI co-prescribed if continuation unavoidable.

### `pincer-3` — Aspirin + NSAID concurrent (no PPI)

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / GI bleed

**Description:** PINCER #3: concurrent aspirin and systemic NSAID without gastroprotection — additive GI bleed risk.

**Trigger logic — ALL drug sets must be present:**

- **Aspirin:** `aspirin 75`, `aspirin 300`, `aspirin tablet`, `aspirin dispersible`, `aspirin gastro`, `nu-seals`, `caprin`, `micropirin`
  - excluding: `aspirin 500`, `aspirin 600`, `migraleve`, `anadin`
- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **AND none of (must not be present):** `omeprazole`, `lansoprazole`, `esomeprazole`, `pantoprazole`, `rabeprazole`, `ranitidine`, `famotidine`
- **Demographics:** age any, sex any

**Source:** PINCER #3

**Notes:** PINCER #3. Aspirin + NSAID combination carries significantly elevated GI bleed risk. Co-prescription of PPI is strongly recommended if both drugs must be continued. Review indication for NSAID.

### `pincer-4` — ACE inhibitor or ARB + NSAID concurrent

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Renal

**Description:** PINCER #4: concurrent RAAS blocker (ACEi/ARB) + systemic NSAID — risk of acute kidney injury.

**Trigger logic — ALL drug sets must be present:**

- **ACEi/ARB:** `ramipril`, `lisinopril`, `perindopril`, `enalapril`, `captopril`, `trandolapril`, `fosinopril`, `quinapril`, `imidapril`, `cilazapril`, `losartan`, `candesartan`, `valsartan`, `irbesartan`, `telmisartan`, `olmesartan`, `azilsartan`, `eprosartan`, `sacubitril`
- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **Demographics:** age any, sex any

**Source:** PINCER #4

**Notes:** PINCER #4. 'Triple whammy' risk if diuretic also present. NSAIDs reduce renal perfusion synergistically with RAAS blockade. Counsel sick-day rules; review NSAID indication.

### `pincer-5` — Beta-blocker + verapamil or diltiazem concurrent

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Cardiovascular

**Description:** PINCER #5: concurrent beta-blocker and rate-limiting calcium channel blocker — risk of bradycardia and heart block.

**Trigger logic — ALL drug sets must be present:**

- **Beta-blocker:** `bisoprolol`, `atenolol`, `metoprolol`, `carvedilol`, `nebivolol`, `propranolol`, `sotalol`, `nadolol`, `labetalol`
- **Rate-limiting CCB:** `verapamil`, `diltiazem`
- **Demographics:** age any, sex any

**Source:** PINCER #5

**Notes:** PINCER #5. Combination causes additive negative chronotropic and dromotropic effects. Risk of severe bradycardia, AV block, and asystole. Usually contraindicated unless under specialist supervision (e.g. refractory angina).

### `pincer-6` — NSAID in heart failure

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Heart failure

**Description:** PINCER #6: systemic NSAID prescribed in a patient with a heart failure diagnosis — fluid retention worsens HF.

**Trigger logic — ALL drug sets must be present:**

- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **AND coded problem required:** `heart failure`
- **Demographics:** age any, sex any

**Source:** PINCER #6

**Notes:** PINCER #6. NSAIDs cause sodium and water retention, worsen cardiac function, and antagonise the effect of loop diuretics. Avoid in heart failure; paracetamol is preferred for analgesia.

### `pincer-7` — Warfarin without recent INR (90 days)

**Severity:** — · **Type:** drug-monitoring · **Category:** Prescribing safety / Anticoagulation

**Description:** PINCER #7: patient on warfarin with no INR recorded in the last 90 days — INR monitoring overdue.

**Drug match:** `warfarin`

**Monitoring requirement:**

| Test | Match terms | Interval | Due-soon window |
|---|---|---|---|
| INR | `inr`, `international normalised ratio`, `prothrombin time` | 84 d (12 wk) | 14 d (2 wk) |

**Source:** PINCER #7

**Notes:** PINCER #7. INR must be within therapeutic range for warfarin to be safe. Monitoring frequency: NHS SPS specifies 12 weeks (84 days) as the maximum gap for stable patients (BCSH guideline). Corrected from 90d to 84d 2026-07-11 (The Keeper, NHS SPS corroborated; primary PDF 403).

### `pincer-8` — Aspirin + clopidogrel without PPI (dual antiplatelet)

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / Bleeding

**Description:** PINCER #8: dual antiplatelet therapy (aspirin + clopidogrel/ticagrelor/prasugrel) without PPI gastroprotection.

**Trigger logic — ALL drug sets must be present:**

- **Aspirin:** `aspirin 75`, `aspirin 300`, `aspirin tablet`, `aspirin dispersible`, `aspirin gastro`, `nu-seals`, `caprin`, `micropirin`
  - excluding: `aspirin 500`, `anadin`, `migraleve`
- **P2Y12:** `clopidogrel`, `ticagrelor`, `prasugrel`
- **AND none of (must not be present):** `omeprazole`, `lansoprazole`, `esomeprazole`, `pantoprazole`, `rabeprazole`
- **Demographics:** age any, sex any

**Source:** PINCER #8

**Notes:** PINCER #8. NICE recommends PPI co-prescription with dual antiplatelet therapy. Review after 12 months — dual antiplatelet is usually time-limited post-ACS or PCI.

### `pincer-9` — Metformin without recent renal function check

**Severity:** — · **Type:** drug-monitoring · **Category:** Prescribing safety / Renal

**Description:** PINCER #9: patient on metformin with no U&E/eGFR in the last 12 months — lactic acidosis risk if eGFR <30.

**Drug match:** `metformin`, `glucophage`, `janumet`, `komboglyze`, `eucreas`, `xigduo`, `synjardy`, `vipdomet`, `jentadueto`

**Monitoring requirement:**

| Test | Match terms | Interval | Due-soon window |
|---|---|---|---|
| U&E / eGFR | `u&e`, `urea and electrolytes`, `renal profile`, `egfr`, `creatinine` | 365 d (1 y) | 30 d |

**Source:** PINCER #9

**Notes:** PINCER #9. Metformin is contraindicated when eGFR <30 mL/min/1.73m² and should be used with caution <45. Annual renal function monitoring is essential. Stop/withhold during acute illness, dehydration, or before iodinated contrast.

### `pincer-10` — Loop diuretic without recent U&E (6 months)

**Severity:** — · **Type:** drug-monitoring · **Category:** Prescribing safety / Electrolytes

**Description:** PINCER #10: patient on a loop diuretic (furosemide/bumetanide) without U&E check in 6 months — hypokalaemia and electrolyte disturbance risk.

**Drug match:** `furosemide`, `frusemide`, `bumetanide`, `torasemide`

**Monitoring requirement:**

| Test | Match terms | Interval | Due-soon window |
|---|---|---|---|
| U&E | `u&e`, `urea and electrolytes`, `renal profile`, `electrolytes` | 180 d (~6 mo) | 21 d (3 wk) |

**Source:** PINCER #10

**Notes:** PINCER #10. Loop diuretics cause electrolyte loss — especially hypokalaemia and hyponatraemia. 6-monthly U&E is the minimum; more frequent if frail, high dose, or renal impairment.

### `pincer-11` — Amiodarone without 6-monthly TFT/LFT

**Severity:** — · **Type:** drug-monitoring · **Category:** Prescribing safety / Electrolytes

**Description:** PINCER #11: patient on amiodarone without thyroid and liver function tests in 6 months — amiodarone-induced thyroid and hepatic toxicity.

**Drug match:** `amiodarone`

**Monitoring requirement:**

| Test | Match terms | Interval | Due-soon window |
|---|---|---|---|
| TFT | `tft`, `thyroid function`, `tsh` | 180 d (~6 mo) | 21 d (3 wk) |
| LFT | `lft`, `liver function` | 180 d (~6 mo) | 21 d (3 wk) |

**Source:** PINCER #11

**Notes:** PINCER #11. Amiodarone causes both hypo- and hyperthyroidism and hepatotoxicity. 6-monthly TFT and LFT are mandatory. CXR annually for pulmonary toxicity.

### `pincer-12` — Lithium + NSAID concurrent

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Lithium safety

**Description:** PINCER #12: concurrent lithium and systemic NSAID — NSAIDs reduce renal lithium clearance causing toxicity.

**Trigger logic — ALL drug sets must be present:**

- **Lithium:** `lithium`
  - excluding: `shampoo`, `topical`, `gel`, `cream`
- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **Demographics:** age any, sex any

**Source:** PINCER #12

**Notes:** PINCER #12. NSAIDs reduce renal lithium excretion by up to 25%, raising levels into the toxic range (>1.5 mmol/L). Recommend paracetamol as first-line analgesia for patients on lithium. If NSAID unavoidable, check lithium level urgently and reduce dose.

### `pincer-13` — Anticoagulant + antiplatelet (triple therapy) in ≥75s

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Anticoagulation

**Description:** PINCER #13: triple therapy (anticoagulant + dual antiplatelet) in patients aged ≥75 — very high bleeding risk.

**Trigger logic — ALL drug sets must be present:**

- **Anticoagulant:** `warfarin`, `acenocoumarol`, `phenindione`, `apixaban`, `rivaroxaban`, `dabigatran`, `edoxaban`
- **Antiplatelet 1:** `aspirin 75`, `aspirin 300`, `aspirin tablet`, `aspirin dispersible`, `aspirin gastro`, `nu-seals`, `caprin`, `micropirin`
  - excluding: `aspirin 500`, `anadin`, `migraleve`
- **Antiplatelet 2:** `clopidogrel`, `ticagrelor`, `prasugrel`
- **Demographics:** age ≥75, sex any

**Source:** PINCER #13

**Notes:** PINCER #13. Triple antithrombotic therapy in ≥75s carries very high bleeding risk. NICE recommends limiting dual antiplatelet + anticoagulant therapy duration (typically 1–4 weeks post-ACS/PCI) then stepping down to single agent. Review indication and duration urgently.

### `mhra-valproate-ppg` — Valproate in female of childbearing age

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Teratogenicity

**Description:** Valproate (sodium valproate / valproic acid) in female aged 12–55 — MHRA Pregnancy Prevention Programme (PPP) mandatory.

**Trigger logic — ALL drug sets must be present:**

- **Valproate:** `sodium valproate`, `valproic acid`, `valproate`, `epilim`, `depakote`, `convulex`
- **Demographics:** age 12–55, sex female

**Source:** MHRA Drug Safety Update

**Notes:** MHRA Pregnancy Prevention Programme (PPP): valproate must not be prescribed to women/girls of childbearing potential without annual specialist review, confirmed effective contraception, and a signed PPP form (MHRA 2024 update). Check PPP compliance annually. Valproate causes major congenital malformations (10%) and neurodevelopmental disorders (30–40%) in children exposed in utero.

### `nice-lithium-monitoring` — Lithium without 3-monthly level + 6-monthly U&E/TFT

**Severity:** — · **Type:** drug-monitoring · **Category:** Prescribing safety / Lithium safety

**Description:** Lithium monitoring overdue — serum level every 3 months, U&E and TFT every 6 months.

**Drug match:** `lithium`

**Monitoring requirement:**

| Test | Match terms | Interval | Due-soon window |
|---|---|---|---|
| Lithium level | `lithium level`, `serum lithium` | 90 d (~3 mo) | 14 d (2 wk) |
| U&E | `u&e`, `urea and electrolytes`, `renal profile` | 180 d (~6 mo) | 21 d (3 wk) |
| TFT | `tft`, `thyroid function` | 180 d (~6 mo) | 21 d (3 wk) |
| Calcium | `calcium`, `corrected calcium` | 180 d (~6 mo) | 21 d (3 wk) |

**Source:** NICE CG185

**Notes:** NICE CG185. Level should be taken 12 hours post-dose. Target 0.6–1.0 mmol/L (or 0.4–0.8 mmol/L in elderly). Symptoms of toxicity: coarse tremor, polyuria, vomiting, confusion.

### `mhra-sglt2-dka` — SGLT2 inhibitor — DKA awareness reminder

**Severity:** info · **Type:** drug-combo · **Category:** Prescribing safety / Renal

**Description:** Patient on SGLT2 inhibitor: reminder to check sick-day rules and DKA risk awareness (including euglycaemic DKA).

**Trigger logic — ALL drug sets must be present:**

- **SGLT2 inhibitor:** `dapagliflozin`, `empagliflozin`, `canagliflozin`, `ertugliflozin`
- **Demographics:** age any, sex any

**Source:** MHRA

**Notes:** MHRA Drug Safety Updates 2020–2024. SGLT2 inhibitors carry risk of euglycaemic DKA (blood glucose may be near-normal). Sick-day rules: withhold during acute illness, dehydration, surgery, or prolonged fasting. Counsel on symptoms of DKA. Annual eGFR monitoring via drug-monitoring rule (sglt2-inhibitor). This alert is an informational prompt — review sick-day rule education at each medication review. Note: aspiration risk during surgical procedures is a separate MHRA concern for GLP-1 agonists (January 2025) — see the mhra-glp1-acute-pancreatitis alert note and the glp1-receptor-agonist drug-monitoring rule for the surgical aspiration counselling point.

### `mhra-glp1-acute-pancreatitis` — GLP-1 / GIP agonist — acute pancreatitis awareness reminder

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / GI

**Description:** Patient on a GLP-1 or dual GLP-1/GIP receptor agonist: counselling reminder to watch for severe persistent abdominal pain radiating to the back (acute pancreatitis, including necrotising and fatal cases).

**Trigger logic — ALL drug sets must be present:**

- **GLP-1 / GIP agonist:** `semaglutide`, `ozempic`, `wegovy`, `rybelsus`, `tirzepatide`, `mounjaro`, `zepbound`, `dulaglutide`, `trulicity`, `liraglutide`, `victoza`, `saxenda`, `xultophy`, `lixisenatide`, `lyxumia`, `exenatide`, `byetta`, `bydureon`
- **Demographics:** age any, sex any

**Source:** MHRA Drug Safety Update — GLP-1/GIP receptor agonists: strengthened warnings on acute pancreatitis (including necrotising and fatal cases) — https://www.gov.uk/drug-safety-update/glp-1-receptor-agonists-and-dual-glp-1-slash-gip-receptor-agonists-strengthened-warnings-on-acute-pancreatitis-including-necrotising-and-fatal-cases

**Notes:** MHRA Drug Safety Update — GLP-1/GIP receptor agonists: strengthened warnings on acute pancreatitis (including necrotising and fatal cases), following Yellow Card reports. Counsel patients to seek urgent medical attention for severe, persistent abdominal pain that may radiate to the back, with or without vomiting — a red-flag symptom of acute pancreatitis. Discontinue the GLP-1/GIP agonist if pancreatitis is suspected and do not restart if confirmed. ASPIRATION RISK (MHRA January 2025): GLP-1 agonists delay gastric emptying; patients having surgical or endoscopic procedures must inform their anaesthetist/surgeon that they are taking a GLP-1 agonist — standard fasting periods may be insufficient to ensure an empty stomach. For weekly injections, withhold the dose on the week of a planned procedure per RCOA/MHRA guidance. Review this counselling point at each medication review. Sources corroborated 2026-07-11; primary MHRA January 2025 DSU PDF 403 this run. NAION WARNING (alert-C002, MHRA DSU Feb 5 2026, CONFIRMED 2026-07-25): MHRA Drug Safety Update (5 February 2026) warned of a possible association between semaglutide (Ozempic, Wegovy, Rybelsus) and non-arteritic anterior ischaemic optic neuropathy (NAION — sudden painless vision loss). Signal is under investigation; MHRA advises: (1) counsel all semaglutide patients on sudden, painless loss of vision as a red-flag symptom requiring immediate referral to ophthalmology; (2) report any case via Yellow Card; (3) benefit–risk assessment ongoing. Association with other GLP-1 agonists not yet established; caution is appropriate. VERIFIER-A confirmed this DSU from MHRA sources.

### `mhra-isotretinoin-ppg` — Isotretinoin in female of childbearing age

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Teratogenicity

**Description:** Isotretinoin (Roaccutane) in female aged 12–55 — Pregnancy Prevention Programme mandatory, initiated and managed by dermatology but GP must be aware.

**Trigger logic — ALL drug sets must be present:**

- **Isotretinoin:** `isotretinoin`, `roaccutane`
  - excluding: `topical`, `gel`, `cream`
- **Demographics:** age 12–55, sex female

**Source:** MHRA Pregnancy Prevention Programme

**Notes:** Isotretinoin is highly teratogenic (Category X). The MHRA Pregnancy Prevention Programme requires two forms of contraception and monthly pregnancy tests. Prescribing is via specialist only. GP role: be aware the patient is on isotretinoin and that PPP compliance is being maintained.

### `prescribing-qtc-combination` — Two or more QTc-prolonging drugs concurrent

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / QTc prolongation

**Description:** Concurrent use of two or more drugs known to prolong the QT interval — additive risk of torsades de pointes.

**Trigger logic — ALL drug sets must be present:**

- **QTc drug A:** `amiodarone`, `sotalol`, `quinidine`, `disopyramide`, `domperidone`, `methadone`, `haloperidol`, `chlorpromazine`, `quetiapine`, `citalopram`, `escitalopram`, `azithromycin`, `erythromycin`, `clarithromycin`, `fluconazole`, `hydroxychloroquine`, `pimozide`
- **QTc drug B:** `amiodarone`, `sotalol`, `quinidine`, `disopyramide`, `domperidone`, `methadone`, `haloperidol`, `chlorpromazine`, `quetiapine`, `citalopram`, `escitalopram`, `azithromycin`, `erythromycin`, `clarithromycin`, `fluconazole`, `hydroxychloroquine`, `pimozide`
- **Demographics:** age any, sex any

**Source:** crediblemeds.org

**Notes:** Note: this rule will fire when any two drugs from the QTc list are co-prescribed, including the same drug in different formulations. Review the matchSummary in the chip to confirm these are genuinely two different QTc-prolonging agents. Consider ECG monitoring, especially if patient has hypokalaemia, bradycardia, or prior QTc prolongation. Pimozide added 2026-07-11 — known high-risk QTc-prolonger (MHRA DSU; BNF has explicit contraindication with other QTc drugs; corroborated). Ondansetron is on the CredibleMeds CQTDB list but the 2012 MHRA DSU was for IV use at high doses; low-dose oral ondansetron has a lower risk profile and has been deliberately omitted to avoid over-alerting in common antiemetic use — reassess if prescribing practices change. DOMPERIDONE — PHAEOCHROMOCYTOMA (alert-C004, CONFIRMED 2026-07-25): domperidone is included in this QTc rule. See also the separate alert 'alert-domperidone-phaeo' (RED): domperidone is absolutely contraindicated in phaeochromocytoma/paraganglioma — it stimulates catecholamine release and can precipitate a hypertensive crisis. If domperidone appears in the QTc chip alongside a phaeo diagnosis, treat as RED rather than AMBER.

### `event-count-1` — Recurrent UTI (≥3 in 12 months, female <65)

**Severity:** amber · **Type:** event-count · **Category:** Clinical review / Infections

**Description:** Female patient aged under 65 with 3 or more UTI / cystitis problems coded in the last 12 months — consider recurrent UTI workup.

**Trigger:** count of `problems` matching `urinary tract infection`, `uti`, `cystitis`, `lower urinary tract` >= 3 within 12 months.
**Excluded terms:** `history of`, `chronic`, `interstitial`, `radiation`, `previous`, `old`, `symptoms`, `luts`, `outflow`
**Demographics:** age <65, sex female

**Source:** NICE NG112

**Notes:** NICE NG112: consider recurrent UTI if ≥2 in 6 months or ≥3 in 12 months. Workup: MSU culture, urine dipstick, consider renal USS and referral. Low-dose antibiotic prophylaxis or vaginal oestrogen may be appropriate post-menopausally.

### `event-count-2` — Recurrent falls (≥2 in 12 months, ≥65)

**Severity:** amber · **Type:** event-count · **Category:** Clinical review / Falls

**Description:** Patient aged ≥65 with 2 or more falls coded in the last 12 months — consider multifactorial falls assessment.

**Trigger:** count of `problems` matching `fall`, `fallen`, `falling`, `trip and fall` >= 2 within 12 months.
**Excluded terms:** `risk of fall`, `fear of fall`, `history of fall`
**Demographics:** age ≥65, sex any

**Source:** NICE CG161

**Notes:** NICE CG161: offer multifactorial falls assessment to older people with ≥2 falls or one fall with injury in 12 months. Review medications (particularly those causing hypotension, sedation), vision, balance, home hazards. Consider medication review, physiotherapy, and home assessment.

### `composite-1` **[SHIPPED DISABLED]** — High-risk GI bleed combination (NSAID + anticoagulant, ≥65, HF)

**Severity:** red · **Type:** composite · **Category:** Prescribing safety / GI bleed

**Description:** Example composite: fires when BOTH pincer-2 (anticoagulant + NSAID) AND pincer-6 (NSAID in HF) are active — i.e. the patient has all three risk factors simultaneously. Shows how composite rules combine others.

**Trigger:** `AND` across rule IDs `custom-replace-with-pincer-2-id`, `custom-replace-with-pincer-6-id`.

**Source:** Composite example

**Notes:** Composite rule example. Replace the placeholder ruleIds above with the actual saved IDs of the pincer-2 (anticoagulant+NSAID) and pincer-6 (NSAID in HF) rules in your custom rules list after importing them. When both fire simultaneously this composite surfaces a consolidated high-severity alert.

### `trend-1` — Rising PSA trend (≥3 readings, 24 months)

**Severity:** — · **Type:** qof-indicator · **Category:** Clinical review / Cancer screening

**Description:** PSA values showing a rising trend across ≥3 readings in 24 months with a minimum delta of 1.0 ng/mL — consider urology referral.

**Indicator:** `TREND-PSA` — Rising PSA trend
**Check (observation-trend):** observation `psa`, `prostate specific antigen`, direction rising, ≥3 points within 24 months, minimum delta 1.
**Demographics:** age ≥40, sex male

**Source:** NICE NG12

**Notes:** Observation history is required for trend analysis. Currently, only the latest PSA value is available via the investigation dashboard API. This rule will show no_data until multi-point history is available. When history is available: a PSA rise >1 ng/mL/year or PSA velocity >0.75 ng/mL/year warrants urology referral (NICE NG12).

### `pincer-mtx-trimethoprim` — Methotrexate + trimethoprim / co-trimoxazole — severe bone marrow suppression

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Bone marrow suppression

**Description:** Concurrent (or recent) methotrexate with trimethoprim or co-trimoxazole — additive antifolate effect causes potentially fatal bone-marrow suppression. NHS SPS: avoid; consult microbiology for an alternative antibiotic.

**Trigger logic — ALL drug sets must be present:**

- **Methotrexate:** `methotrexate`, `maxtrex`, `metoject`, `jylamvo`, `nordimet`, `zlatal`, `methofill`
  - excluding: `topical`, `cream`, `gel`
- **Trimethoprim/Co-trimoxazole:** `trimethoprim`, `co-trimoxazole`, `septrin`
- **Demographics:** age any, sex any

**Source:** NHS SPS 'Managing interactions with methotrexate' (corroborated; primary page 403, pending confirmation)

**Notes:** NHS SPS: avoid co-trimoxazole or trimethoprim with methotrexate — risk of severe, potentially fatal bone-marrow suppression (pancytopenia) via additive dihydrofolate-reductase inhibition plus increased free methotrexate (sulfamethoxazole protein-binding displacement). The interaction may be DELAYED — cases have occurred when trimethoprim/co-trimoxazole was given after recently stopping methotrexate. Consult microbiology for an alternative; if unavoidable, warn the patient to report sore throat, mouth ulcers, fever, bruising or bleeding urgently and monitor FBC. SOURCE GAP: BNF/SPS/MHRA primary pages 403 — corroborated (NHS SPS article, Medsafe alert, emc SmPCs); pending primary-source confirmation.

### `mhra-acei-arb-ksparing-hyperkalaemia` — ACEi/ARB + potassium-sparing diuretic/aldosterone antagonist — hyperkalaemia

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / Electrolytes

**Description:** Concurrent ACE inhibitor or ARB with spironolactone, eplerenone, amiloride, triamterene or their combination products — risk of severe, potentially fatal hyperkalaemia (MHRA DSU Feb 2016). Guideline-endorsed in heart failure under monitoring; this alert prompts a potassium/U&E check, not a contraindication.

**Trigger logic — ALL drug sets must be present:**

- **ACEi/ARB:** `ramipril`, `lisinopril`, `perindopril`, `enalapril`, `captopril`, `trandolapril`, `fosinopril`, `quinapril`, `imidapril`, `cilazapril`, `losartan`, `candesartan`, `valsartan`, `irbesartan`, `telmisartan`, `olmesartan`, `azilsartan`, `eprosartan`, `sacubitril`
- **Potassium-sparing diuretic / aldosterone antagonist:** `spironolactone`, `eplerenone`, `amiloride`, `triamterene`, `co-amilofruse`, `co-amilozide`, `co-triamterzide`
- **Demographics:** age any, sex any

**Source:** MHRA Drug Safety Update 17 February 2016 (corroborated; primary page 403, pending confirmation)

**Notes:** MHRA DSU Feb 2016: spironolactone (or eplerenone, amiloride, triamterene) + ACE inhibitor/ARB risks severe, potentially fatal hyperkalaemia — especially with renal impairment, diabetes, or in the elderly. Deliberately AMBER not red: spironolactone + ACEi/ARB is guideline-endorsed four-pillar heart-failure therapy (NICE NG106); a red would fire on much of the HF register and drown actionable alerts. Amber prompts a serum K+/U&E check: before co-prescribing, at ~1 and ~4 weeks, then 3–6 monthly; reduce/stop if K+ ≥5.5 mmol/L. co-amilofruse = amiloride+furosemide; co-amilozide = amiloride+hydrochlorothiazide; co-triamterzide = triamterene+hydrochlorothiazide. SOURCE GAP: MHRA primary page 403 — corroborated via secondary NHS/regulatory sources; pending primary-source confirmation.

### `alert-001` — NSAID + peptic ulcer history without PPI (PINCER primary outcome)

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / GI bleed

**Description:** PINCER primary outcome #1: patient with a coded history of peptic ulcer, gastric ulcer, or duodenal ulcer prescribed a systemic NSAID without a co-prescribed PPI — very high GI bleed risk.

**Trigger logic — ALL drug sets must be present:**

- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **AND none of (must not be present):** `omeprazole`, `lansoprazole`, `esomeprazole`, `pantoprazole`, `rabeprazole`, `ranitidine`, `famotidine`, `cimetidine`
- **AND coded problem required:** `peptic ulcer`, `gastric ulcer`, `duodenal ulcer`, `gastroduodenal ulcer`, `peptic ulcer disease`
- **Demographics:** age any, sex any

**Source:** PRIMIS PINCER primary outcome 1 (Avery et al., BMJ 2012; corroborated; primary PDF 403)

**Notes:** PINCER primary outcome 1 (Avery et al., BMJ 2012). Prescribing an NSAID to a patient with a coded peptic ulcer without PPI gastroprotection is a primary preventable prescribing error. This is distinct from pincer-1 (age ≥65 + NSAID, no PPI) — this rule fires on the combination of ulcer history + NSAID, regardless of age. Action: stop NSAID and/or start PPI immediately; review NSAID indication. Source: PRIMIS PINCER primary indicators (corroborated 2026-07-11; primary PDF 403 this run).

### `alert-002` — Beta-blocker + asthma (PINCER primary outcome)

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Respiratory

**Description:** PINCER primary outcome #2: patient with a coded asthma diagnosis prescribed a systemic beta-blocker — risk of severe bronchospasm.

**Trigger logic — ALL drug sets must be present:**

- **Beta-blocker:** `bisoprolol`, `atenolol`, `metoprolol`, `carvedilol`, `nebivolol`, `propranolol`, `sotalol`, `nadolol`, `labetalol`, `acebutolol`, `celiprolol`, `oxprenolol`, `pindolol`, `betaxolol`, `timolol`
  - excluding: `timolol eye drops`, `eye drop`, `ophthalmic`, `topical`, `latanoprost`, `bimatoprost`
- **AND coded problem required:** `asthma`
- **AND NOT coded problem:** `resolved asthma`, `no asthma`, `copd`, `chronic obstructive`
- **Demographics:** age any, sex any

**Source:** PRIMIS PINCER primary outcome 2 (Avery et al., BMJ 2012; corroborated; primary PDF 403)

**Notes:** PINCER primary outcome 2 (Avery et al., BMJ 2012). Beta-blockers are contraindicated in asthma: can cause life-threatening bronchospasm. Note: COPD is NOT a contraindication (bisoprolol and carvedilol are used in HF+COPD under specialist supervision); excludesProblem removes COPD-coded patients from this alert. Cardioselective beta-blockers (bisoprolol, atenolol) carry a lower but still present risk in asthma — still contraindicated per BNF. If in doubt about the asthma diagnosis (vs COPD or resolved childhood asthma), this alert should prompt confirmation. Source: PRIMIS PINCER primary indicators (corroborated 2026-07-11; primary PDF 403 this run).

### `alert-004` — Acitretin or alitretinoin in female of childbearing age (oral retinoids)

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Teratogenicity

**Description:** Acitretin or alitretinoin (oral retinoids) in female aged 12–55 — Pregnancy Prevention Programme mandatory. Acitretin has an exceptionally long washout (2 years after stopping).

**Trigger logic — ALL drug sets must be present:**

- **Oral retinoid (non-isotretinoin):** `acitretin`, `neotigason`, `alitretinoin`, `toctino`
  - excluding: `topical`, `gel`, `cream`
- **Demographics:** age 12–55, sex female

**Source:** MHRA Pregnancy Prevention Programme — oral retinoids; MHRA Drug Safety Update 2024 (corroborated; primary PDF 403)

**Notes:** MHRA PPP applies to all oral retinoids — acitretin (Neotigason, for psoriasis) and alitretinoin (Toctino, for chronic hand eczema) as well as isotretinoin (already covered by mhra-isotretinoin-ppg). Acitretin requires TWO forms of contraception during treatment and for 2 YEARS after stopping (etretinate can form from acitretin in the presence of alcohol). Alitretinoin requires contraception during treatment and for 1 month after stopping. Both require monthly pregnancy testing and a signed PPP form. Prescribing is by specialist only; GP role is awareness and ensuring PPP compliance is maintained. Added 2026-07-11 (The Keeper): MHRA 2024 DSU extending PPP to all oral retinoids confirmed this gap — corroborated; primary PDF 403 this run.

### `alert-005` — Finasteride or dutasteride — psychiatric adverse effects (MHRA May 2026)

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / Psychiatric adverse effects

**Description:** Patient on finasteride or dutasteride: MHRA May 2026 Drug Safety Update citing 19 fatal suicide reports — review psychiatric symptoms at each contact.

**Trigger logic — ALL drug sets must be present:**

- **5-ARI:** `finasteride`, `propecia`, `proscar`, `dutasteride`, `avodart`, `combodart`, `duodart`
- **Demographics:** age any, sex any

**Source:** MHRA Drug Safety Update May 2026 — 5-alpha reductase inhibitors (corroborated; primary PDF 403)

**Notes:** MHRA Drug Safety Update May 2026: 19 fatal suicide reports associated with finasteride/dutasteride in the Yellow Card database. Known psychiatric adverse effects include depression, anxiety, suicidal ideation, insomnia, and sexual dysfunction (libido, erectile dysfunction, ejaculation disorders). Post-finasteride syndrome (PFS): a subset of patients report persistent adverse effects after stopping. Review psychiatric symptoms at each contact; advise patient to report mood changes, low mood, or suicidal thoughts promptly. Review ongoing need for 5-ARI regularly. Added 2026-07-11 (The Keeper, MHRA May 2026 DSU corroborated; primary PDF 403 this run).

### `alert-008` — Antiplatelet + peptic ulcer history without PPI (PRIMIS secondary)

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / GI bleed

**Description:** Patient with coded peptic ulcer history on antiplatelet therapy (aspirin/clopidogrel/ticagrelor/prasugrel) without a co-prescribed PPI — preventable GI bleed risk (PRIMIS secondary outcome).

**Trigger logic — ALL drug sets must be present:**

- **Antiplatelet:** `aspirin 75`, `aspirin 300`, `aspirin tablet`, `aspirin dispersible`, `aspirin gastro`, `nu-seals`, `caprin`, `micropirin`, `clopidogrel`, `ticagrelor`, `prasugrel`, `dipyridamole`
  - excluding: `aspirin 500`, `anadin`, `migraleve`
- **AND none of (must not be present):** `omeprazole`, `lansoprazole`, `esomeprazole`, `pantoprazole`, `rabeprazole`, `ranitidine`, `famotidine`, `cimetidine`
- **AND coded problem required:** `peptic ulcer`, `gastric ulcer`, `duodenal ulcer`, `gastroduodenal ulcer`, `peptic ulcer disease`
- **Demographics:** age any, sex any

**Source:** PRIMIS PINCER secondary indicators; NICE NG111 (corroborated; primary PDF 403)

**Notes:** PRIMIS secondary indicator: antiplatelet + peptic ulcer history without PPI is a preventable prescribing risk. NICE recommends PPI co-prescription when aspirin or antiplatelet is prescribed in patients with peptic ulcer disease history. Amber (rather than red) as the risk is lower than NSAID+ulcer+no-PPI (alert-001) but still significant. Action: add PPI gastroprotection. Complements alert-001 (NSAID variant). Added 2026-07-11 (The Keeper, PRIMIS/NICE NG111 corroborated; primary PDF 403).

### `alert-009` — Systemic NSAID in coded CKD

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / Renal

**Description:** Patient with a coded CKD (stage 3–5) diagnosis on a systemic NSAID — NSAIDs further impair renal perfusion and accelerate CKD progression.

**Trigger logic — ALL drug sets must be present:**

- **NSAID:** `ibuprofen`, `dexibuprofen`, `naproxen`, `diclofenac`, `aceclofenac`, `celecoxib`, `etoricoxib`, `meloxicam`, `piroxicam`, `tenoxicam`, `indomethacin`, `indometacin`, `etodolac`, `flurbiprofen`, `sulindac`, `ketoprofen`, `dexketoprofen`, `tiaprofenic acid`, `mefenamic acid`, `tolfenamic acid`, `fenoprofen`, `nabumetone`
  - excluding: `topical`, `gel`, `cream`, `patch`, `spray`
- **AND coded problem required:** `chronic kidney disease`, `ckd stage 3`, `ckd stage 4`, `ckd stage 5`
- **AND NOT coded problem:** `ckd stage 1`, `ckd stage 2`
- **Demographics:** age any, sex any

**Source:** NICE NG203; BNF; STOPP v3 criterion E2 (O'Mahony et al., Age Ageing 2023; corroborated; primary PDF 403)

**Notes:** NSAIDs inhibit prostaglandin-mediated afferent arteriolar dilation, reducing GFR — particularly harmful in CKD where renal perfusion is already compromised. Risk of AKI on CKD and accelerated progression. STOPP v3 criterion E2 (NSAID contraindicated in eGFR <45). Amber rather than red: not all NSAIDs are equally nephrotoxic and short-course topical alternatives may be appropriate; clinical context determines urgency. Action: review NSAID indication; consider paracetamol or topical NSAID for musculoskeletal pain; check eGFR trend. Added 2026-07-11 (The Keeper, NICE NG203/STOPP v3 corroborated; primary PDF 403). Complementary to stopp_nsaid_ckd in stopp-start.js (which fires at eGFR<45 via observation; this alert fires on the coded CKD problem — both may fire for the same patient, which is intended as belt-and-braces).

### `alert-domperidone-phaeo` — Domperidone — CONTRAINDICATED in phaeochromocytoma / paraganglioma

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Endocrine / catecholamine crisis

**Description:** Domperidone prescribed to a patient with a coded phaeochromocytoma or paraganglioma. Domperidone stimulates catecholamine release and can precipitate a life-threatening hypertensive crisis in these patients — absolute contraindication per UK SmPC.

**Trigger logic — ALL drug sets must be present:**

- **Domperidone:** `domperidone`, `motilium`
- **AND coded problem required:** `phaeochromocytoma`, `paraganglioma`
- **Demographics:** age any, sex any

**Source:** MHRA Drug Safety Update July 2026; domperidone UK SmPC (Motilium, Sanofi)

**Notes:** Domperidone stimulates catecholamine release and is absolutely contraindicated in phaeochromocytoma (and by extension paraganglioma, a closely related catecholamine-secreting tumour). Co-prescription can precipitate a hypertensive crisis. Source: MHRA Drug Safety Update July 2026; UK SmPC (Motilium). 'Motilium' added as UK brand term. Paraganglioma included in requiresProblem — if only phaeochromocytoma is coded in this practice, the rule will fail-closed for paraganglioma (correct behaviour; add 'paraganglioma' to coded terms when a case presents). CSO flag: this rule requires phaeochromocytoma/paraganglioma to be actively coded as a problem in Medicus — if the diagnosis is in free text or a letter only, it will not fire. Added 2026-07-25 (The Keeper, alert-C001).

### `alert-acei-angioedema` — ACEi — recurrent or severe angioedema (absolute contraindication to re-prescribing)

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Angioedema / airway risk

**Description:** Patient with a coded history of ACEi-induced angioedema currently prescribed an ACE inhibitor. ACEi-induced angioedema can be life-threatening (laryngeal oedema, airway obstruction). Re-prescribing after documented angioedema is an absolute contraindication per BNF/MHRA.

**Trigger logic — ALL drug sets must be present:**

- **ACE inhibitor:** `ramipril`, `lisinopril`, `perindopril`, `enalapril`, `captopril`, `trandolapril`, `fosinopril`, `quinapril`, `imidapril`, `cilazapril`, `accupro`, `tanatril`, `vascace`
- **AND coded problem required:** `angioedema`
- **AND NOT coded problem:** `hereditary angioedema`
- **Demographics:** age any, sex any

**Source:** MHRA Drug Safety Update 17 June 2026 — ACE inhibitors and angioedema; BNF section 2.5.5.1; NICE CG127; BNF drug interactions (ACEi, adverse reactions)

**Notes:** ACE inhibitor-induced angioedema is a class-effect adverse reaction that occurs in 0.1-0.7% of patients, with Black patients at 2-4x higher risk. Angioedema after ACEi can be life-threatening due to laryngeal involvement. MHRA DSU June 17 2026 reinforced the absolute contraindication: once ACEi-induced angioedema is documented, the entire class must be avoided permanently. ARBs (sartans) carry a much lower risk of angioedema (~10-fold less than ACEi) and are the preferred RAAS alternative after ACEi angioedema; their use in this context is under specialist guidance. excludesProblem: hereditary angioedema — patients with HAE have angioedema for a different reason (C1-inhibitor deficiency); their angioedema history should not trigger an ACEi contraindication unless the angioedema was ACEi-induced. Verify the angioedema coding (some ACEi-angioedema patients are coded as 'allergic reaction' — the sensitivity of this rule depends on coding quality). ARBs (losartan, candesartan, etc.) are NOT included in match: they are the recommended switch, not the contraindicated class. Added 2026-07-25 (The Keeper, alert-C003). CSO note: confirm problem term 'angioedema' is the coding convention used in this practice before relying on this rule.

### `alert-antipsychotic-dementia` — Antipsychotic in dementia — increased mortality and stroke risk (AMBER); CONTRAINDICATED in Lewy body dementia (RED — see notes)

**Severity:** amber · **Type:** drug-combo · **Category:** Prescribing safety / Dementia / sedation risk

**Description:** Antipsychotic prescribed to a patient with coded dementia. MHRA 2004/updated 2023: antipsychotics approximately double the risk of stroke and increase mortality in people with dementia (all types). They should be used only when non-pharmacological approaches have failed, at the lowest dose, for the shortest time, with documented risk-benefit discussion. SPECIAL HAZARD — LEWY BODY DEMENTIA (LBD): antipsychotics are effectively contraindicated in LBD and related conditions (DLB, PDD, LBD with parkinsonism) — severe antipsychotic sensitivity reactions including irreversible parkinsonism and death have been reported. If 'Lewy body' or 'DLB' or 'Parkinson disease dementia' appears in the problem list, escalate to RED immediately.

**Trigger logic — ALL drug sets must be present:**

- **Antipsychotic:** `olanzapine`, `risperidone`, `quetiapine`, `aripiprazole`, `haloperidol`, `clozapine`, `chlorpromazine`, `amisulpride`, `paliperidone`, `levomepromazine`, `methotrimeprazine`, `trifluoperazine`, `fluphenazine`, `zuclopenthixol`, `flupentixol`, `prochlorperazine`, `asenapine`, `lurasidone`
- **AND coded problem required:** `dementia`, `alzheimer`, `vascular dementia`, `frontotemporal dementia`, `lewy body`, `dlb`, `parkinson disease dementia`, `mixed dementia`
- **Demographics:** age any, sex any

**Source:** MHRA Drug Safety Update 2004, reinforced 2009; NICE NG97 (Dementia care) 2018/2023; BNF antipsychotics adverse-effects section; Alzheimer's Society / RCPsych guidance on antipsychotics in dementia

**Notes:** MHRA/CSM advice (2004, reinforced 2009, updated NICE NG97 2023): antipsychotic use in dementia is associated with approximately doubled stroke risk and increased all-cause mortality. Use only when: (1) non-pharmacological approaches have been tried and failed; (2) the patient is at risk of harm to self or others; (3) documented risk-benefit discussion has taken place with patient/carer. At the lowest effective dose, for the shortest time (typically no more than 6 weeks), with regular review for discontinuation. Risperidone is the only antipsychotic with a UK licence for short-term management of aggression in Alzheimer's dementia; use off-licence for other dementias is a specific risk that warrants discussion. LEWY BODY DEMENTIA — ESCALATE TO RED: If the patient also has 'Lewy body dementia', 'DLB' (dementia with Lewy bodies), 'Parkinson disease dementia', or 'PDD' coded, antipsychotics are effectively contraindicated. Severe antipsychotic sensitivity (neuroleptic malignancy-like syndrome, irreversible worsening of parkinsonism, extreme sedation, sudden death) has been reported. Even 'atypical' antipsychotics carry this risk in LBD. If LBD/DLB is coded and an antipsychotic is present, this chip should be treated as RED by the reviewing clinician regardless of the AMBER severity shown — the engine cannot currently auto-escalate based on secondary problem coding. Added 2026-07-25 (The Keeper, alert-C006).

### `alert-xoi-thiopurine-myelosuppression` — Allopurinol/febuxostat + azathioprine/mercaptopurine — life-threatening myelosuppression

**Severity:** red · **Type:** drug-combo · **Category:** Prescribing safety / Bone marrow suppression

**Description:** Concurrent xanthine-oxidase inhibitor (allopurinol or febuxostat) with azathioprine or mercaptopurine — raises active thiopurine metabolite levels several-fold, causing life-threatening myelosuppression. Allopurinol: only with specialist-directed thiopurine dose reduction (~25%); febuxostat: contraindicated.

**Trigger logic — ALL drug sets must be present:**

- **Xanthine oxidase inhibitor:** `allopurinol`, `zyloric`, `caplenal`, `uricto`, `febuxostat`, `adenuric`
- **Thiopurine:** `azathioprine`, `mercaptopurine`, `imuran`, `azapress`, `jayempi`, `xaluprine`
- **Demographics:** age any, sex any

**Source:** emc allopurinol/mercaptopurine & Adenuric SmPCs; NHS shared-care guidance (corroborated; primary pages 403, pending confirmation)

**Notes:** Allopurinol and febuxostat both inhibit xanthine oxidase, which clears azathioprine's active metabolite 6-mercaptopurine; co-prescription raises 6-MP ~3–4 fold → life-threatening myelosuppression (leucopenia, thrombocytopenia, anaemia). Do NOT co-prescribe allopurinol with azathioprine/mercaptopurine except on explicit specialist instruction with the thiopurine reduced to ~25% and frequent FBC. Febuxostat is CONTRAINDICATED with azathioprine/mercaptopurine (UK SmPC). Brand terms (zyloric/caplenal/uricto/adenuric for the XOI set; azapress/jayempi/xaluprine for the thiopurine set) are listed explicitly because substring matching means a brand-only record otherwise never fires. SOURCE GAP: BNF/emc primary pages 403 — corroborated across NHS shared-care guidance, emc SmPC text and Medsafe; pending primary-source confirmation.

---

## Part 5 — Explicit "no monitoring required" suppression list

### `no-monitoring-common`

**Notes:** Common drugs with no BNF/NICE-mandated routine primary-care blood monitoring protocol. Matched drugs are excluded from the 'Meds without a monitoring rule' diagnostic list to suppress noise. No monitoring chips are generated for these drugs.

**Drugs (64):** `aspirin`, `clopidogrel`, `dipyridamole`, `prasugrel`, `amlodipine`, `felodipine`, `lercanidipine`, `nifedipine`, `verapamil`, `diltiazem`, `bisoprolol`, `atenolol`, `metoprolol`, `nebivolol`, `propranolol`, `carvedilol`, `tamsulosin`, `alfuzosin`, `doxazosin`, `terazosin`, `finasteride`, `dutasteride`, `omeprazole`, `lansoprazole`, `esomeprazole`, `pantoprazole`, `rabeprazole`, `salbutamol`, `salmeterol`, `formoterol`, `indacaterol`, `vilanterol`, `olodaterol`, `beclometasone`, `budesonide`, `ciclesonide`, `mometasone`, `fluticasone`, `azelastine`, `ipratropium`, `tiotropium`, `aclidinium`, `glycopyrronium`, `umeclidinium`, `montelukast`, `zafirlukast`, `cetirizine`, `loratadine`, `fexofenadine`, `chlorphenamine`, `promethazine`, `acrivastine`, `bilastine`, `desloratadine`, `levocetirizine`, `rupatadine`, `cholecalciferol`, `colecalciferol`, `calcium carbonate`, `calcium citrate`, `folic acid`, `ferrous sulfate`, `ferrous fumarate`, `ferrous gluconate`

---

## Known limitations (carry these into any downstream report)

1. **Coded records only.** Every rule reads the GP record. Vaccines given at a pharmacy, bloods taken in secondary care, and uncoded diagnoses are invisible — a "due" or "no data" state is not proof the activity did not happen.
2. **Substring matching under-matches silently.** A brand absent from a `match` list produces no alert and no error. Brand-list completeness is guarded by `test-drug-brand-coverage.js`.
3. **`exclude` over-suppresses.** Any drug containing an exclude string is dropped, including legitimate prescriptions.
4. **Intervals are stable-maintenance intervals.** Intensified initiation/titration monitoring is described in the notes but not enforced (except the ACE-I/ARB post-initiation U&E).
5. **Drug–allergy rules need the Transactional feed.** On the legacy feed there is no allergy bundle and they never fire.
6. **Pregnancy-episode vaccines are not encoded.** Pertussis-in-pregnancy and RSV-in-pregnancy are deliberately omitted — the engine has no per-pregnancy or gestational-age gate.
7. **`trend-1` (rising PSA) reports `no_data` in practice** — only the latest PSA is available from the investigation dashboard API; multi-point history is not yet exposed.
8. **Some sources are pending primary confirmation.** Several Keeper passes were corroborated against secondary reproductions because gov.uk / BNF / journal PDFs returned 403. These are flagged in the per-rule notes and in the file-level spec versions above.

