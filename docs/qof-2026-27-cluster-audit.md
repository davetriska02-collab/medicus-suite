# QOF 2026/27 look-for audit

**Date:** 2026-09-28  
**Product:** Medicus Suite v3.267.6 (stacked on the v3.267.5 coded-note change)  
**Rules file:** `rules/qof-rules.json` (66 indicator rules, including retired and safety-trend rows), plus `rules/vaccine-rules.json` and `rules/drug-rules.json`  
**Cluster source:** NHSD Primary Care Domain refsets as mirrored on OpenCodelists, version tag **20260630** (`nhsd-primary-care-domain-refsets/<cluster>/20260630/`). Wording of the indicators is the NHS England QOF guidance for 2026/27 (PRN02356, July 2026 update). The TRUD business-rules spreadsheet was not available in this environment. Where a slug did not resolve, the cluster is recorded as not found, and the rule was not given invented concept ids.

This is a read of what the suite matches today. It is not a QOF claim calculator. A green chip means the coded record matched the rule. It does not mean the practice has achieved the indicator.

## Ranked gaps

| Rank | Gap | Points | What was wrong | What this change does |
| --- | --- | --- | --- | --- |
| 1 | COPD010 was an OR of a review **or** an MRC grade, and the official review term does not contain "COPD" | 9 | False green on MRC alone. False overdue on "Chronic obstructive pulmonary disease annual review". Exacerbation count was absent | Require all three groups. Concept ids from COPDRVW_COD, COPDEXACB_COD, MRC_COD |
| 2 | CHOL004 looked for `ldl` / `non-hdl` only | 44 | "Low density lipoprotein cholesterol" does not contain `ldl` | Added the long forms, and 372361000119104. The single cut-off of 2.6 for both LDL and non-HDL is unchanged |
| 3 | DM037 smoking slot was "smoking status" / "tobacco use" | 10 | A Smoker note (the usual coded entry) did not complete one of the eight processes. "Tobacco use" could | Smoking slot now uses the same SMOK_COD list as SMOK002 |
| 4 | HF007 looked for "heart failure review" | 7 | "Heart failure 6 month review" and "Congestive heart failure monitoring" do not contain that phrase | HFRVW_COD terms and nine concept ids |
| 5 | AST014 missed reversibility preferred terms | 15 | "Airways obstruction reversible" and "Positive reversibility test to salbutamol" were invisible | ASTSPIR_COD terms and concept ids. FeNO and peak-flow clusters were not found as their own slugs |
| 6 | MH007 missed ordinary alcohol-status terms | 3 | "Light drinker" is in ALC_COD and did not match | ALC_COD, AUDIT_COD and AUDITC_COD concept ids |
| 7 | DEM004 missed "Dementia advance care plan agreed" | 14 | The words "dementia" and "care plan" are not contiguous in that term | DEMCP_COD concept ids, and the advance-care-plan phrase. Broader review phrases were left in (see residual) |
| 8 | Short tokens `bp`, `bmi`, `acr`, `ldl` | several | `acr` matches inside "acrocyanosis" | Those four tokens are whole words |
| 9 | DM014, NDH003, HbA1c thresholds, DM037 foot and eGFR | 11–27 | A concept whose description does not repeat the substring was invisible. "Glomerular filtration rate" (80274001) does not contain "eGFR". Ipswich Touch Test does not contain "foot examination" | Concept ids added. Foot pulses from the 153-code FOOTEXAM_COD were **not** added |
| 10 | Medication indicators (CHD005, STIA007, CHOL003, AF008, DM006, DM034, DM035, HF009, CKD-RASI) | up to 20 | Drug-name substrings, not a dm+d cluster. A brand that does not contain the generic is missed | Not changed. No dm+d cluster was loaded |
| 11 | Domains with no shipped indicator | — | Cancer, depression, learning disability, osteoporosis, rheumatoid arthritis, palliative care, cervical screening, QOF vaccination indicators | Not added. A new indicator is a new rule, not a look-for repair |

SMOK002 and AST015 were already corrected on the parent change (v3.267.5). They are listed below as closed.

## What "coded note" means here

From v3.267.5 a consultation entry with `entryType: "note"` and a `clinicalCodeDescription` is read as an observation, with the concept id when the payload has one. Before that, a review or a smoking status filed as a coded note was invisible even when the words were right. Every indicator below can now see those notes. The remaining miss is a preferred term or a concept id the rule still does not list.

## Closed on the parent change

| Indicator | Look-for now | Cluster | Notes |
| --- | --- | --- | --- |
| SMOK002 (nine register variants) | SMOK_COD, 71 concept ids, plus status rubrics. Not cessation education (225323000) or a cessation referral (871661000000106) | SMOK_COD | Cigarette consumption counts, because it is in the refset. Newest date wins |
| AST015 | Four required groups: review, control score, exacerbation count (from one month before the review through that day), written plan (same day as the review) | Review cluster used in v3.267.5; ASTCONTASS_COD; ASTEXACB_COD 366874008; WRITPASTP_COD | Inhaler technique is in the published wording and is not a fifth group (H-086) |

## Fixed in this change

### COPD010 — COPD review (9 points, 50–90%)

**Was:** one `observation-recent` list: `copd review`, `copd annual review`, `mrc dyspnoea`, `medical research council dyspnoea`. Any one of them achieved the indicator.

**Guidance:** a review in the preceding 12 months, including a record of the number of exacerbations **and** an MRC dyspnoea grade.

**Clusters (20260630):**

| Group | Cluster | Codes |
| --- | --- | --- |
| COPD review | COPDRVW_COD | 394703002 Chronic obstructive pulmonary disease annual review; 760601000000107 3 monthly review; 760621000000103 6 monthly review |
| Exacerbation count | COPDEXACB_COD | 723245007 Number of chronic obstructive pulmonary disease exacerbations in past year |
| MRC dyspnoea | MRC_COD | 391120009 grade 1; 391123006 grade 2; 391124000 grade 3; 391125004 grade 4; 391126003 grade 5 |

The annual-review preferred term does not contain "copd". The exacerbation preferred term does not contain "copd". Both are the codes a template files, including as a coded note.

**Now:** three named groups, all required. Not required to be the same day (the published rule is "in the preceding 12 months" for each). A review alone stays `not_met` and names the missing groups.

### CHOL004 — LDL or non-HDL (44 points) on CHD, PAD and stroke/TIA

**Was:** `ldl`, `ldl cholesterol`, `non-hdl`, `non hdl`.

**Miss:** "Low density lipoprotein cholesterol" does not contain `ldl`. "Non high density lipoprotein cholesterol" does not contain `non-hdl`.

**Now:** those long forms, plus concept 372361000119104 (Low density lipoprotein cholesterol by direct assay, from CHOL_COD). No separate LDL or non-HDL refset slug was found (`ldl_cod`, `nonhdl_cod` and the variants probed returned 404).

**Left as it was:** one numeric cut-off of 2.6 mmol/L for whichever row matches. The rule notes already say LDL should be ≤2.0. That needs an OR of two thresholds in the engine. It was not changed here.

CKD is not a CHOL004 register. That is unchanged.

### DM037 — eight care processes (10 points)

The bundle was already require-all. The slots were short substrings, and they were not named, so a 7/8 chip did not say which process was missing. They are named now.

| Slot | Was | Cluster considered | Change |
| --- | --- | --- | --- |
| BMI | `bmi`, `body mass index` | BMI_COD (42 codes) | Concept 60621009 only. **Not** "Obese" / "On examination - obese" — those are in BMI_COD and would mark the process done without a BMI |
| BP | `blood pressure`, `bp` | BP_COD (165), HOMEBP_COD, ABPM_COD | No new codes. A paired reading's preferred term already contains "blood pressure". Systolic-only codes would become the latest BP and hide a paired value on a threshold rule; the same risk applies if they merely "count as recorded" |
| HbA1c | `hba1c`, `haemoglobin a1c` | IFCCHBAM_COD | 999791000000106, 1049301000000100, 1049321000000109, plus "glycated haemoglobin" |
| Cholesterol | `cholesterol`, `lipid profile` | CHOL_COD / CHOL2_COD | Unchanged text. "Serum cholesterol level" already matches. Finding codes such as "above reference range" were not added as concept ids |
| Smoking | `smoking status`, `tobacco use` | SMOK_COD | Same list as SMOK002. A Smoker note completes the slot. "Tobacco use" on its own does not |
| Foot exam | `foot examination`, `diabetic foot` | FOOTEXAM_COD (153) | Monofilament foot sensation (134388005) and Ipswich Touch Test (1433601000000104, 1443851000000100). Leg-pulse codes in that refset were not added |
| ACR | `acr`, `albumin creatinine ratio`, `albumin:creatinine` | No `acr_cod` slug | Text kept. `acr` is now a whole word |
| eGFR / creatinine | `egfr`, `estimated glomerular filtration rate`, `creatinine`, excluding urine | EGFR_COD (12) | Those 12 concept ids, including 80274001 Glomerular filtration rate. Urine names still cannot complete the slot |

### HF007 — heart failure review (7 points)

**Was:** `heart failure review`, `hf review`, `heart failure annual review`.

**Cluster:** HFRVW_COD (9 codes). Missed preferred terms included "Heart failure 6 month review" (247361000000100), "Congestive heart failure monitoring" (134378009), "Heart failure monitoring" (871681000000102), "Heart failure self-management plan review" (810971000000105), "Heart failure initial assessment" (851071000000108), "Discussion about heart failure care plan" (872361000000105), "Education about deteriorating heart failure" (813991000000101). "Heart failure annual review" (390885007) and "Heart failure review completed" (202231000000106) already matched.

**Now:** those terms and all nine concept ids. The cluster is what QOF counts as the review. It is wider than the phrase "annual review".

### AST014 — objective test after a new asthma diagnosis (15 points)

**Was:** `spirometry`, `fev1`, `feno`, `fractional exhaled nitric oxide`, `peak flow variability`, `bronchodilator reversibility`.

**Cluster found:** ASTSPIR_COD. Missed: "Airways obstruction reversible" (170627008), "Positive reversibility test to salbutamol" (391118006) and the ipratropium / combination / corticosteroid reversibility codes. "Post bronchodilator spirometry" already matched `spirometry`.

**Not found:** `astfeno_cod`, `astpefr_cod`. The FeNO and peak-flow text terms stay.

**Still true, and not changed:** the rule checks a test in the last 12 months for a diagnosis coded on or after 1 April 2025. It does not check the three months either side of the diagnosis date. The rule notes already say so.

### MH007 — alcohol in severe mental illness (3 points)

**Was:** alcohol consumption / intake / units, AUDIT-C, teetotal, non-drinker.

**Clusters:** ALC_COD (58), AUDIT_COD (4), AUDITC_COD (2). "Light drinker" (160575005), "Stopped drinking alcohol" (160579004) and "Social drinker" (28127009) did not match the old phrases. They are in the refset, so the concept ids were added. The old phrases stay, including teetotal, which a live consult had already shown was needed.

### DEM004 — dementia care plan review (14 points)

**Cluster:** DEMCP_COD is only 956841000000106 Dementia care plan agreed, and 1095121000000102 Dementia advance care plan agreed. The second does not contain the contiguous phrase "dementia care plan".

**Now:** both concept ids, and the advance-care-plan phrase.

**Left in on purpose:** `dementia review`, `memory clinic review`, `dementia annual review`, `dementia health check`. Taking them out would mark overdue a review the practice has coded in those words, and the published indicator is a **review**, while the refset found here is two "agreed" codes. That over-match (a memory-clinic review clearing the care plan) is recorded for the CSO. It was not silently narrowed.

### DM014 — structured education (11 points)

**Cluster:** DSEP_COD, ten referral codes (DESMOND, DAFNE, X-PERT, Healthy Living, online, family/carer). Most preferred terms already contain "diabetes structured education". The ten concept ids were added so a short local description with the right code still counts. The rule still cannot tell a new diagnosis from a long-standing one. The notes already say that.

### HbA1c concept ids

IFCCHBAM_COD (999791000000106, 1049301000000100, 1049321000000109) added to NDH003, MH012, DM020, DM021, and the retired DM007 / DM008 rows so they do not drift. The preferred terms already contain "Haemoglobin A1c". The concept id covers a description that does not.

### Whole-word tokens

`hr` and `tte` were already whole words. `bp`, `bmi`, `acr` and `ldl` now are too. "Blood pressure", "body mass index", "albumin creatinine ratio" and "low density lipoprotein" are longer terms and still match as substrings. "O/E - BP reading" still matches `bp`.

## Every other shipped indicator

Retired rows (enabled false) are listed so the file is covered. They were not re-opened.

### Blood pressure targets

CD001 (CHD and stroke/TIA, under 80), CD002 (80 and over), HYP010, HYP011, DM036, CKD-BP. Retired: HYP008, HYP009, CHD015, CHD016, STIA014, STIA015.

**Look-for:** `blood pressure`, `bp`.

**Cluster:** BP_COD, and for home readings HOMEBP_COD and ABPM_COD. A reading whose preferred term contains "blood pressure" already matches (clinic, home, ambulatory, 24 hour). Lone systolic and diastolic codes in BP_COD ("Sitting systolic blood pressure" does contain the words; "Diastolic arterial pressure" and "Systolic arterial pressure" do not) were not added. On a threshold rule the latest match has to parse as a pair (`120/80`). A lone systolic would hide that pair.

**Coded notes:** a BP filed as a coded note is visible since v3.267.5 if the description matches.

**Over-match:** `bp` was a substring. It is a whole word now.

**Multi-component:** QOF achievement is the pair in range, with age and frailty gates the rules already express. No second clinical component (no bundle).

### Lipids and statins

| Rule | Look-for | Cluster it should track | Gap left |
| --- | --- | --- | --- |
| CHOL003 on CHD, PAD, stroke/TIA, CKD | statin generic names, ezetimibe, inclisiran, bempedoic acid, alirocumab, evolocumab | a lipid-lowering therapy medication cluster | Name match. A brand with none of those stems is missed. No dm+d list was loaded |
| DM034, DM035 | same statin list, without the word "statin" itself on DM034/035 | same | Same |
| MH011 | lipid profile, cholesterol, HDL, LDL, non-HDL, triglyceride | CHOL_COD | "Cholesterol" already matches "Serum cholesterol level" and "Total cholesterol measurement". Lower priority than CHOL004 because the bare word is already there |

### Antithrombotic and RAAS drugs

| Rule | Look-for | Gap left |
| --- | --- | --- |
| CHD005, STIA007 | aspirin, clopidogrel, ticagrelor, prasugrel, dipyridamole, warfarin, the four DOACs | Brand-only names (a product that does not contain the generic) |
| AF008 | the four DOACs and warfarin, gated on CHA2DS2-VASc ≥ 2 where the engine supports it | Same. Not a full exception model (declined, contraindicated, specialist advice) |
| DM006, CKD-RASI | named ACE inhibitors and ARBs | Same. Nephropathy / proteinuria gating is the rule's problem list, not a cluster |
| HF009 | four groups: RAAS (including sacubitril/valsartan stems), beta-blocker, MRA, SGLT2 inhibitor | Already a require-all medication bundle. Still names, not dm+d |

### AF006 — stroke risk score (12 points)

**Look-for:** `cha2ds2-vasc`, `cha2ds2 vasc`, `chads2-vasc`, `stroke risk score`.

**Cluster found, and not used:** CHAD_COD is the older score. Its preferred terms are "Congestive heart failure, hypertension, age 75 years or older, diabetes mellitus and previous stroke or transient ischaemic attack score" (1085111000000109, 763007002, 763008007). That is CHADS2, not CHA2DS2-VASc. Putting it on AF006 would clear the indicator off the wrong score.

**Not found:** `chadsvasc_cod`, `cha2ds2_cod`. A CHA2DS2-VASc code whose description is only the expanded phrase, with no abbreviation, would still be missed. Left for a sourced cluster.

### Asthma and COPD, other than AST015 / COPD010

AST014 is in the fixed section. COPD register text is unchanged (COPD_COD is a diagnosis refset; the register is still a substring). COPDSPIR_COD exists (post-bronchodilator spirometry and referrals). There is no shipped COPD spirometry indicator to attach it to.

### Heart failure, other than HF007

| Rule | Look-for | Gap |
| --- | --- | --- |
| HF008 | echocardiogram, echocardiography, transthoracic echo, `tte` (whole word), heart failure specialist assessment | No echo cluster slug (`echo_cod`, `echocard_cod` were 404). `tte` no longer matches "cigarette" or "written" (v3.267.5) |
| HF003, HF006 | retired, empty checks | Left retired |

### Mental health, other than MH007

| Rule | Look-for | Cluster | Gap |
| --- | --- | --- | --- |
| MH002 care plan | mental health care plan, comprehensive care plan, CPA, smi care plan, mental health review | No care-plan slug (`mhcp_cod`, `mhcplan_cod` 404) | "Mental health review" can clear a care-plan indicator. Not removed, for the same reason as DEM004: the real review phrase in this system may be the only code the practice files |
| MH003 BP | `blood pressure`, `bp` | BP_COD | Same BP decision as the targets. Presence, not a threshold |
| MH006 BMI | `bmi`, `body mass index` | BMI_COD | Measurement wording matches. Obese was not added |
| MH011 | see lipids | CHOL_COD | Covered above |
| MH012 glucose or HbA1c | hba1c, haemoglobin a1c, blood glucose, fasting glucose, plasma glucose, plus IFCCHBAM_COD | GLUC_COD is 43 codes and includes a glucose tolerance test | The tolerance-test codes were **not** added. HbA1c concept ids were. Diabetes diagnoses are already excluded |

### Diabetes, other than DM037 / DM014

| Rule | Look-for | Gap |
| --- | --- | --- |
| DM020, DM021 | HbA1c ≤58 (no frailty) or ≤75 (frailty), plus IFCCHBAM_COD | Frailty is a problem-list gate, not a cluster. The value still has to parse as a number |
| DM006, DM034, DM035, DM036 | see medication and BP tables | — |
| DM007, DM008 | retired | IFCC ids copied so the retired rows do not drift. Still disabled |

### NDH003 (20 points)

**Look-for:** HbA1c or fasting glucose, plus the three IFCC concept ids. GLUC_COD was not added: a random glucose is not the indicator. Fasting terms were already present ("Serum fasting glucose level" contains "fasting glucose").

### Dementia, obesity, CKD, smoking support

| Rule | Look-for | Gap |
| --- | --- | --- |
| DEM004 | see the fixed section | Memory-clinic review still matches |
| OB004 | weight-management referral phrases | No `obref` / `wtman` slug was found. Text only |
| OB005 | three pathway groups with concept ids already (pharmacotherapy code, behavioural-support referral, shared decision), not drug brands | Already the component-group pattern. Residual limits are in the rule notes (ethnicity, comorbidity substrings) |
| CKD-BP, CKD-RASI | see BP and RAAS | — |
| TREND-EGFR, TREND-HBA1C, K-HIGH | safety trends and a potassium alert, not QOF payment indicators | Trend matching does not read concept ids. The HbA1c trend text already includes "haemoglobin a1c" |
| SMOK004 | retired. Smoking-cessation support phrases | SMOKADV_COD exists (Very Brief Advice 1110791000000100, referral, leaflet, declined). Not applied while the rule is disabled |

## Domains in the 2026/27 guidance with no shipped indicator

These are coverage gaps, not look-for bugs. They were not added in this change.

| Domain | Why it is absent |
| --- | --- |
| Cancer | No CAN review rule |
| Depression | No DEP rule |
| Learning disability | No health-check rule |
| Osteoporosis | No DXA / treatment rule. `dxa_cod` exists and was not attached to a rule that does not exist |
| Rheumatoid arthritis | No RA review rule |
| Palliative care | No PC register-maintenance rule |
| Cervical screening | No CS rule. `smear_cod` exists and was not attached |
| QOF vaccination and immunisation indicators | Not the same as `rules/vaccine-rules.json` (below) |

## Other rules files

### `rules/vaccine-rules.json`

These are Green Book / JCVI eligibility prompts (flu, COVID, pneumococcal, shingles, RSV), not the QOF vaccination indicators. Look-fors are problem phrases, drug names, and a few concept ids (the carer code 224484003 is already exact). Status terms list given and declined separately so "refused" does not match "given". They were not rewritten onto QOF clusters. A QOF VI indicator would be a different rule.

### `rules/drug-rules.json`

Drug-monitoring alerts (lithium, methotrexate, and the rest). Matching is case-insensitive substring of the drug name, with explicit brands, which is the convention in `CLAUDE.md`. They are not QOF business-rule clusters. This audit did not edit them. `rules/alert-library.json` has no rules.

## Over-match that was considered and not "fixed" by widening

| Refset | Why it was not poured into a rule |
| --- | --- |
| BMI_COD | Includes Obese and "On examination - obese" |
| BP_COD | Includes a lone systolic or diastolic, and narrative findings ("O/E - BP reading raised") |
| FOOTEXAM_COD | 153 codes, including leg pulses that are not a diabetic foot examination |
| CHAD_COD | CHADS2, not CHA2DS2-VASc |
| GLUC_COD | Includes a glucose tolerance test and timed samples. NDH003 is HbA1c or fasting glucose |
| DEMCP_COD vs current DEM004 phrases | The refset is two "agreed" codes. Deleting "dementia review" would be a behaviour change in the other direction |

## Tests

`test-qof-cluster-gaps.js` uses synthetic codes and dates only. It checks: COPD review alone is not met; MRC alone is not met; all three components are met; a Smoker note completes DM037 and "tobacco use" does not; acrocyanosis does not complete ACR; Ipswich Touch Test completes the foot slot; concept 80274001 completes eGFR; "Low density lipoprotein cholesterol" meets CHOL004; heart failure 6 month review meets HF007; airways obstruction reversible meets AST014; light drinker meets MH007; dementia advance care plan meets DEM004 by concept id; DSEP 415270003 meets DM014; IFCC 999791000000106 meets NDH003.

## Hazard

H-087 is proposed, unsigned, for CSO review. It does not move the product pin.
