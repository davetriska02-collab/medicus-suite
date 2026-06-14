# The Keeper — Sentinel rule-change proposal

**Practice:** Witley and Milford Surgery  
**Generated:** 14 June 2026  
**Extension version:** 3.76.1 → 3.77.0  
**Rule files touched:** defaults.json, content-scripts/triage-lens/defaults.json, content-scripts/triage-lens/content.js  
**Tests:** ✅ passing (test-result-severity.js, test-result-rules.js, test-triage-defaults.js)

> **How to read this.** The Keeper compares the suite’s clinical rule sets against their authoritative UK sources and proposes only verified, sourced changes. Every change links to the source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). **This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.

## ⚠️ Changes needing CSO sign-off

_None. No proposed change reduces alerting; all changes are additive or housekeeping._

## Action this run (Red)

_No Red drift found this run._

## Medicines monitoring
<sub>`rules/drug-rules.json`</sub>

_No changes this run._

## QOF registers and indicators
<sub>`rules/qof-rules.json`</sub>

_No changes this run._

## Vaccine eligibility
<sub>`rules/vaccine-rules.json`</sub>

_No changes this run._

## Prescribing-safety alerts
<sub>`rules/alert-library.json`</sub>

_No changes this run._

## Medication-review instruments (ACB / STOPP-START / PINCER)
<sub>`engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js`</sub>

_No changes this run._

## Reception pathways and clinical thresholds
<sub>`rules/reception-pathways.json + threshold constants`</sub>

### 🟠 Amber — Add hypocalcaemia rule (low adjusted calcium) — DISABLED by default

- **Rule:** `base-low-calcium`
- **Now:** No hypocalcaemia rule exists; only the high-calcium rule is present.
- **Proposed:** Add base-low-calcium (enabled:false, builtin): match ['adjusted calcium','corrected calcium','albumin-adjusted calcium','albumin adjusted calcium'], exclude ['urine','urinary','24 hour','24-hour','/creat','ionised','ionized'], comparator below, amber 2.1, red 1.9, mmol/L. Matches ADJUSTED/corrected calcium only (not bare 'Calcium') to avoid hypoalbuminaemia false-positives, where total calcium is spuriously low but the albumin-adjusted value is normal. Ships DISABLED — CSO to verify thresholds against a primary source and enable.
- **Why it matters:** Hypocalcaemia is a genuine emergency (tetany, laryngospasm, seizures, QT prolongation/arrhythmia). UK adult adjusted-calcium reference ~2.2-2.6 mmol/L; severe symptomatic hypocalcaemia is conventionally <1.9 mmol/L. Amber 2.1 (mild, work-up), red 1.9 (severe). Matching adjusted-only is the deliberate false-positive guard for the low direction.
- **Regression lock-in:** Added to test-result-severity.js Keeper block: adjusted 2.05 -> amber, corrected 1.8 -> red, ionised 1.1 -> none (excluded), bare 'Calcium' 1.8 -> none (adjusted-only match).
- **Source:** Society for Endocrinology endocrine-emergency guidance (acute hypocalcaemia); UK NHS trust lab handbooks (Leeds: adjusted calcium 2.20-2.60 mmol/L) — <https://ec.bioscientifica.com/view/journals/ec/5/5/G7.xml> (2016 (SfE emergency guidance); 2024 (Leeds Health Pathways ref range))
- **Verified evidence:** Multiple UK NHS sources give adjusted calcium reference 2.2-2.6 mmol/L and define severe/symptomatic hypocalcaemia as <1.9 mmol/L; ionised calcium (~1.1-1.3 mmol/L) must be excluded or it would false-fire a 'below' rule.
- **Provenance:** verified by Keeper orchestrator (verifier stage) on 14 June 2026 — corroborated (multi-source WebSearch; WebFetch egress-blocked this run), confidence medium.

### 🟠 Amber — Add hypomagnesaemia rule (low magnesium) — DISABLED by default

- **Rule:** `base-low-magnesium`
- **Now:** No magnesium rule exists.
- **Proposed:** Add base-low-magnesium (enabled:false, builtin): match ['magnesium'], exclude ['urine','urinary','24 hour','24-hour'], comparator below, amber 0.6, red 0.5, mmol/L. Ships DISABLED — CSO to verify and enable.
- **Why it matters:** Severe hypomagnesaemia causes arrhythmia (incl. torsades), seizures and refractory hypokalaemia/hypocalcaemia. UK reference 0.70-1.00 mmol/L; symptomatic/critical commonly cited around <0.5 mmol/L. PPIs are a recognised cause (MHRA 2011), so a GP would want a low magnesium surfaced. Amber 0.6 (deficiency), red 0.5 (symptomatic/arrhythmia risk). Low false-positive (Mg rarely tested in primary care).
- **Regression lock-in:** Added to test-result-severity.js Keeper block: magnesium 0.58 -> amber, 0.4 -> red, urine magnesium -> none (excluded).
- **Source:** NHS Specialist Pharmacy Service (treating acute hypomagnesaemia); NICE ESuoM4; MHRA Drug Safety Update (PPIs and hypomagnesaemia, 2011) — <https://www.sps.nhs.uk/articles/treating-acute-hypomagnesaemia-in-adults/> (2024 (SPS); 2011 (MHRA DSU))
- **Verified evidence:** NHS SPS and UK lab handbooks give magnesium reference 0.70-1.00 mmol/L and treat symptomatic hypomagnesaemia around <0.5 mmol/L; MHRA 2011 DSU links long-term PPIs to hypomagnesaemia. No single national consensus critical value exists, so thresholds ship conservative and disabled for CSO confirmation.
- **Provenance:** verified by Keeper orchestrator (verifier stage) on 14 June 2026 — corroborated (multi-source WebSearch; WebFetch egress-blocked this run), confidence medium.

### 🟠 Amber — Add markedly-high TSH rule (possible hypothyroidism) — DISABLED by default

- **Rule:** `base-high-tsh`
- **Now:** No TSH rule exists.
- **Proposed:** Add base-high-tsh (enabled:false, builtin): match ['tsh','thyroid stimulating hormone','thyroid-stimulating hormone'], exclude ['receptor','antibody','antibodies'], comparator above, amber 10, red 20, mU/L, suppressIfProblem on hypothyroidism/levothyroxine/thyroxine/myxoedema. Ships DISABLED — CSO to verify and enable.
- **Why it matters:** NICE NG145: consider levothyroxine for TSH >=10 mU/L (with low T4 = overt hypothyroidism). Amber 10, red 20 (markedly raised). DISABLED by default and value-only: TSH is heavily perturbed by levothyroxine dosing and pregnancy, so an absolute-threshold rule fires on many monitored patients (alert fatigue), and in the live queue suppressIfProblem fails OPEN when the problem list is not passed. Excludes 'receptor'/'antibody' so it cannot misfire on a TSH-receptor-antibody (TRAb) titre.
- **Regression lock-in:** Added to test-result-severity.js Keeper block: TSH 12 -> amber, 25 -> red, 'TSH receptor antibody' -> none (excluded), and suppressed when hypothyroidism on the problem record.
- **Source:** NICE NG145 Thyroid disease (recommendations); UK lab TSH reference 0.4-4.5 mU/L — <https://www.nice.org.uk/guidance/ng145/chapter/recommendations> (2019, updated; NICE NG145)
- **Verified evidence:** NICE NG145 names TSH >=10 mU/L as the levothyroxine-consideration threshold for primary hypothyroidism; UK TSH reference range 0.4-4.5 mU/L. Shipped disabled because of the high false-positive rate in treated/pregnant patients.
- **Provenance:** verified by Keeper orchestrator (verifier stage) on 14 June 2026 — corroborated (multi-source WebSearch; WebFetch egress-blocked this run), confidence medium.

### 🟠 Amber — Add suppressed-TSH rule (possible thyrotoxicosis) — DISABLED by default

- **Rule:** `base-low-tsh`
- **Now:** No TSH rule exists.
- **Proposed:** Add base-low-tsh (enabled:false, builtin): match ['tsh','thyroid stimulating hormone','thyroid-stimulating hormone'], exclude ['receptor','antibody','antibodies'], comparator below, amber 0.1, red 0.01, mU/L, suppressIfProblem on thyrotoxicosis/hyperthyroidism/graves/carbimazole/propylthiouracil/thyroid cancer/levothyroxine. Ships DISABLED — CSO to verify and enable.
- **Why it matters:** Suppressed TSH (<0.1 mU/L) signals thyrotoxicosis (Graves, toxic nodule, thyroiditis) or iatrogenic over-replacement (AF / osteoporosis risk). Amber 0.1, red 0.01. DISABLED by default: patients on carbimazole/PTU stay suppressed for months during titration, and intentional suppression (post-thyroid-cancer) is common; firing on every <0.1 during known treatment is counterproductive. Excludes 'receptor'/'antibody' to avoid TRAb misfire.
- **Regression lock-in:** Added to test-result-severity.js Keeper block: TSH 0.05 -> amber, 0.005 -> red, suppressed when thyrotoxicosis/carbimazole on the problem record.
- **Source:** NICE NG145 Thyroid disease (subclinical thyrotoxicosis TSH <0.1 mU/L); NICE NG230 thyroid cancer (TSH suppression targets) — <https://www.nice.org.uk/guidance/ng145/chapter/recommendations> (2019 (NG145); 2022 (NG230))
- **Verified evidence:** NICE NG145 defines subclinical thyrotoxicosis as TSH <0.1 mU/L with normal free hormones; NG230 uses TSH suppression targets in some thyroid-cancer risk groups. Shipped disabled due to the treated-patient false-positive problem.
- **Provenance:** verified by Keeper orchestrator (verifier stage) on 14 June 2026 — corroborated (multi-source WebSearch; WebFetch egress-blocked this run), confidence medium.

---

## Appendix: scan transparency

**Sources checked:** NICE CKS Hypercalcaemia / Hypocalcaemia; Society for Endocrinology endocrine-emergency guidance (acute hypocalcaemia); NHS Specialist Pharmacy Service — acute hypomagnesaemia; NICE ESuoM4 (recurrent hypomagnesaemia); MHRA Drug Safety Update — PPIs and hypomagnesaemia (2011); NICE NG145 Thyroid disease; NICE NG230 Thyroid cancer; UK NHS trust biochemistry lab handbooks (Leeds, North Bristol) for reference/critical values.

**Rule-file baseline at start of run:**
- `defaults.json resultRules`: v11 (17 built-in result rules; 6 added v3.76.0, labels polished v3.76.1)

**Candidates excluded as low relevance:** 0.

**Candidates killed during verification (not applied):**
- `result-cal-narrow-high`: Scanner proposed narrowing the existing base-high-calcium match from bare 'calcium' to 'adjusted/corrected calcium' only. KILLED as a safety-weakening narrowing the source does not mandate: many UK labs report hypercalcaemia under an un-prefixed 'Calcium' result name, so narrowing would silently miss them. A high total calcium is not spuriously raised by hypoalbuminaemia (which lowers total), and the engine renders one chip per report, so the 'double-fire' concern is cosmetic. Keep bare 'calcium' match on the high rule.

**⚠️ Sources that could not be reached this run:** WebFetch egress was BLOCKED to NICE/NHS/BNF this run (HTTP 403) — every threshold was corroborated via multi-source WebSearch, NOT confirmed by fetching the primary source page. Confidence is 'medium', not 'high'. All four new rules therefore ship DISABLED-by-default ('Unreviewed') for the CSO to verify against the primary source and enable.. _Treat the affected rules as unchecked this run._

**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this national scan. Paste a local formulary line into a run to fold it in.

**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO reviews and approves every clinical rule change.
