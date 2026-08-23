# The Keeper (expanded) — Gap analysis: highest-value MISSING clinical rules

**Practice:** Witley and Milford Surgery (11,500 patients, rural dispensing, total triage)
**Generated:** 22 August 2026 · **Baseline:** rule files as of the 18 Aug 2026 Keeper run (manifest 3.236.25)
**Scope:** unlike a standard Keeper run (drift in *existing* rules), this run asks the opposite question: *what high-value rules are missing entirely?* Six gap scanners swept the current UK sources (BNF/SPS/emc, NHS England QOF 2026/27 guidance PRN02356 incl. the July 2026 update, UKHSA Green Book + JCVI/NHSE letters, MHRA Drug Safety Update, STOPP/START v3 full text, ACBcalc, NICE CKS/NG + Pharmacy First spec) against the full rule inventory (37 drug rules, 14 QOF registers + 46 indicators, 5 vaccines, 38 alerts, 13 reception pathways, 14 STOPP/START criteria, 82-term ACB table). Engine-feasibility claims were verified against `engine/rules-engine.js` in this repo, not assumed.

> **This is a proposal document — NO rule file has been modified.** Every proposed rule is CSO-review clinical content: nothing here ships until Dr Triska signs it off, per the file-level governance and the Keeper's own charter. Prioritisation = clinical impact × frequency on this list × feasibility in the existing engine.

## How to read the specs

Each top-10 gap carries: the source(s) it was verified against (fetched this run unless marked VERIFY), the exact rule JSON in the schema the engine already evaluates, the edge cases that must be documented or handled before enabling, the **provenance still required** before shipping (dm+d brand passes, engine checks), and the **test cases** that lock the rule in per `CLAUDE.md` convention.

---

## Engine feasibility facts established this run (repo-verified)

These determine several rulings below; each was checked against source code, not scanner assertion:

1. **Register-less QOF indicators work today.** `evaluateQofIndicatorRule` only gates on register when `requiresRegister` is truthy, and `trend-egfr-falling` already ships enabled with no register and `ageRange {min: 18}` (`rules/qof-rules.json:1580`). BP002/CS005-6 are expressible now.
2. **Vaccine `register`-kind eligibility clauses apply NO age gating.** The `problem` and `medication` branches enforce `ageMin`/`ageMax` (the 2026-08-01 fix); the `register` branch (`rules-engine.js:2348–2368`) does not. Gap 5 needs either a ~4-line engine patch mirroring the medication branch, or problem-kind substitutes.
3. **A vaccine `season` with `startMonth`/`startDay` and no `endMonth` is year-round with a calendar-year lookback** (`seasonEnd()` returns null, `rules-engine.js:2443–2448`). This unlocks a defensible per-pregnancy approximation (runners-up 14–15).
4. **The drug-combo distinct-drug guard** (`rules-engine.js:~1252`) requires one distinct medication per set when drugSets overlap — duplicate-class detection (STOPP A3) is expressible without engine work.
5. **3-set drug-combo rules are supported** (drugSets is N-ary; ALL sets must match) — the triple whammy is expressible; it would be the library's first N=3 rule and needs a dedicated regression test.

## ⚠️ Cross-cutting RED finding in EXISTING rules (repo-verified, fix in the same batch)

**The two alert-library lithium rules are brand-blind.** `pincer-12` (line 288) and `nice-lithium-monitoring` (line 363) match only `["lithium"]` — but the UK lithium brands **Priadel, Camcolit, Liskonum and Li-Liquid do not contain the substring "lithium"**. A brand-only script currently never fires PINCER #12 (lithium + NSAID) or the custom lithium-monitoring alert. `drug-rules.json`'s `lithium-maintenance` already lists all four brands (line 255), so the fix is copying that match list into both alert rules + extending the alert-coverage test. This is drift, not a missing rule, but it was verified during this scan and is the cheapest Red fix in this report.

---

# Top 10 missing rules (ranked)

## 1. 🔴 Reception pathway: Fever / hot-and-unwell (adult) — including neutropenic sepsis

**File:** `rules/reception-pathways.json` · **Domain:** pathways · **Feasibility: fits schema as-is**

**The gap (verified against v1.9):** no pathway exists for adult "fever / flu-like / hot and shivery" — one of the highest-volume reception presentations (~5–15 calls/day in winter). Worse, **no red flag anywhere in the file asks whether the patient is on chemotherapy or other anticancer treatment**: `sore-throat`/`sinusitis` carry `rf-immune` (duty) but only fire on those complaints; the `general` catch-all a fever caller actually reaches has no chemo, immunosuppression, meningism or non-blanching-rash flag. A chemo patient's "flu" queued for an afternoon callback is the exact avoidable-death scenario NICE CG151 and NCEPOD document. This is the single most dangerous hole found this run.

**Sources (fetched):** NICE CG151 recs 1.3.1.1–1.3.1.2 ("Suspect neutropenic sepsis in patients having anticancer treatment who become unwell… refer immediately"; treat as "acute medical emergency") — https://www.nice.org.uk/guidance/cg151/chapter/recommendations; NICE NG253–255 (suspected sepsis). VERIFY before sign-off: primary CKS Malaria page (geo-restricted this run) for the returned-traveller flag.

**Proposed rule (exact spec):**

```json
{
  "id": "fever-adult",
  "title": "Fever / feeling hot and unwell (adult)",
  "appliesTo": "Adults. Feverish children use the Feverish child pathway.",
  "sources": [
    "NICE CG151: Neutropenic sepsis — recs 1.3.1.1–1.3.1.2",
    "NICE NG253/NG254/NG255: Suspected sepsis",
    "NICE CKS: Malaria (returned traveller — VERIFY primary page next sweep)"
  ],
  "redFlags": [
    { "id": "rf-chemo-fever", "ask": "Have they had chemotherapy or any other cancer treatment (tablets, injections, or drips) in the last few weeks? (If yes with this fever — this is an emergency: do not book; escalate NOW and check the patient's chemotherapy alert-card / hotline number)", "escalate": "999" },
    { "id": "rf-sepsis", "ask": "Shivering or shaking uncontrollably, skin that looks very pale, mottled (blotchy), or feels cold and clammy, or the person is saying they feel like they might die?", "escalate": "999" },
    { "id": "rf-confusion", "ask": "New confusion, slurred speech, or unusually hard to wake?", "escalate": "999" },
    { "id": "rf-nonblanching", "ask": "Any rash that does NOT fade when a glass is pressed against it?", "escalate": "999" },
    { "id": "rf-meningism", "ask": "Severe headache with a stiff neck or dislike of bright light?", "escalate": "999" },
    { "id": "rf-immune-other", "ask": "Do they take medicines that weaken the immune system (e.g. methotrexate, long-term steroids, transplant tablets, biologic injections), or have they had their spleen removed?", "escalate": "duty" },
    { "id": "rf-travel", "ask": "Have they returned from Africa, Asia, or South or Central America within the last month?", "escalate": "duty" },
    { "id": "rf-fluids", "ask": "Unable to keep any fluids down, or hardly passing any urine?", "escalate": "duty" }
  ],
  "questions": [
    { "id": "temp", "ask": "Has the temperature been measured? What was it?", "type": "text", "label": "Temperature" },
    { "id": "duration", "ask": "How long have they had the fever?", "type": "text", "label": "Duration" },
    { "id": "localising", "ask": "Anything else with it — cough, waterworks symptoms, tummy pain, rash, sore throat?", "type": "text", "label": "Other symptoms" },
    { "id": "conditions", "ask": "Any long-term conditions or regular medicines?", "type": "text", "label": "Conditions / medicines" }
  ],
  "disposition": null
}
```

**Implementation notes:** clinician-only pathway (no disposition — `gu-male`/`gyn-female` precedent): add to `CLINICIAN_ONLY_IDS`; add match terms (fever, high temperature, hot and shivery, flu, influenza) to `engine/reception-match.js`; `rf-sepsis` shares the house shared-flag pattern with `general`.

**Edge cases:** caller says "flu" not "fever" (match terms must cover); chemo >6 weeks ago (flag deliberately over-triages "last few weeks"); immunotherapy/targeted agents covered by "any other cancer treatment"; **companion single-flag gap: `feverish-child` also lacks a chemo flag** — raise as a one-flag addition in the same CSO pass.

**Frequency × impact:** ~40–80 patients on active SACT at any time; missed neutropenic sepsis progresses to septic shock in hours (mortality ~20% established).

**Tests:** `test-reception-pathways.js` — pin `fever-adult` exists; `rf-chemo-fever` escalate === '999' and ask mentions chemotherapy; `rf-nonblanching` 999; pathway carries no disposition; shared `rf-sepsis` text byte-identical with `general`'s.

---

## 2. 🔴 Drug monitoring: Thiazide and thiazide-like diuretics — U&E

**File:** `rules/drug-rules.json` · **Domain:** drugs · **Feasibility: fits schema as-is**

**The gap:** no thiazide term appears anywhere in `drug-rules.json` or the alert library, while loop diuretics already carry a 180-day PINCER U&E chip. Thiazides are a far larger cohort (~250–450 patients: HTN register ~1,600 × 15–25% on a thiazide, plus metolazone in HF) with the same electrolyte physiology — thiazide hyponatraemia is one of the commonest drug causes of confusion, falls and admission in the elderly, and its onset is asymptomatic. Largest-population silent-monitoring gap in the file.

**Sources (fetched):** NICE CKS Hypertension — thiazide-like diuretics prescribing information (https://cks.nice.org.uk/topics/hypertension/prescribing-information/thiazide-like-diuretics/): sodium before starting then at regular intervals ("essential", more frequent in elderly), potassium first week then regularly; indapamide SmPC (https://www.medicines.org.uk/emc/product/4188/smpc); NICE NG136 annual review. "Annual" is a conservative synthesis — no single crisp source interval exists; state this in `notes`.

**Proposed rule (exact spec):**

```json
{
  "type": "drug-monitoring",
  "enabled": true,
  "id": "thiazide-diuretic-ue",
  "drugClass": "Thiazide / thiazide-like diuretic",
  "drug": {
    "match": ["indapamide", "natrilix", "alkapamid", "cardide", "rawel", "bendroflumethiazide", "aprinox", "neo-naclex", "chlortalidone", "chlorthalidone", "hydrochlorothiazide", "xipamide", "diurexan", "metolazone", "xaqua", "cyclopenthiazide", "navidrex", "co-amilozide", "moduretic", "co-triamterzide", "co-tenidone", "tenoret"],
    "exclude": []
  },
  "phase": "maintenance",
  "tests": [
    { "name": "U&E (sodium/potassium/renal)", "match": ["u&e", "urea and electrolytes", "renal profile", "sodium", "potassium"], "snomed": ["1019331000000106"], "intervalDays": 365, "dueSoonDays": 30 },
    { "name": "U&E (post-initiation)", "match": ["u&e", "urea and electrolytes", "renal profile"], "postInitiationDays": 28, "postInitiationDueSoonDays": 14 }
  ],
  "source": "NICE CKS Hypertension (thiazide-like diuretics) / indapamide SmPC / NICE NG136 annual review",
  "notes": "Sodium falls can be asymptomatic — CKS calls regular monitoring essential, more frequent in the elderly. Annual interval is a conservative synthesis of CKS 'regular intervals' + the NG136 annual review; no single-source interval exists. Combo brands (co-amilozide, co-tenidone etc.) carry hidden thiazide content.",
  "sharedCare": false
}
```

**Provenance still required:** dm+d confirmation pass on the combo brands (co-amilozide/Moduretic/co-triamterzide/co-tenidone/Tenoret — no generic substring, so a missing combo brand silently never fires); bare `"sodium"`/`"potassium"` observation terms need an `exclude` check against urine-specimen labels (the audit-H4 failure mode — mirror the exclusions used elsewhere).

**Edge cases:** ACE/ARB + HCTZ combination products (Zestoretic etc.) fire both this rule and `ace-arb` — same annual U&E, verify chips merge rather than duplicate; MHRA 2015 hydrochlorothiazide skin-cancer counselling is a notes item, not a test.

**Tests:** `test-drug-brand-coverage.js` — add `EXPECTED['thiazide-diuretic-ue']` covering every brand above (e.g. 'Natrilix SR 1.5mg tablets', 'Moduretic 5/50 tablets'); must-NOT-fire: furosemide (loop, covered by pincer-10), amiloride alone.

---

## 3. 🔴 Alert: Opioid + benzodiazepine / Z-drug / gabapentinoid — respiratory depression

**File:** `rules/alert-library.json` · **Domain:** alerts · **Feasibility: fits schema as-is (2-set drug-combo)**

**The gap:** the single largest driver of drug-poisoning deaths in England & Wales, subject of three MHRA DSUs, entirely unrepresented. Estimated 60–140 concurrent patients on this list — and as a dispensing practice, every one of those scripts passes through the suite.

**Sources (fetched):** MHRA DSU 18 Mar 2020 (benzos + opioids — "potentially fatal respiratory depression", Coroner-triggered) https://www.gov.uk/drug-safety-update/benzodiazepines-and-opioids-reminder-of-risk-of-potentially-fatal-respiratory-depression; MHRA DSU 26 Oct 2017 (gabapentin severe respiratory depression); MHRA DSU 18 Feb 2021 (pregabalin — 122 Yellow Card respiratory-depression reports 2014–20, 80 with a concomitant CNS depressant).

**Proposed rule (exact spec):** `libId: mhra-opioid-cns-depressant`, type `drug-combo`, severity **amber** (the combination is sometimes unavoidable — palliative care — so the alert prompts deliberate review, dose minimisation and naloxone/safety counselling, not automatic stopping):

```json
{
  "type": "drug-combo",
  "enabled": true,
  "label": "Opioid + CNS depressant — respiratory depression risk",
  "drugSets": [
    { "name": "Opioid", "match": ["morphine", "zomorph", "mst continus", "sevredol", "oramorph", "mxl", "oxycodone", "oxycontin", "oxynorm", "longtec", "shortec", "targinact", "fentanyl", "durogesic", "matrifen", "fencino", "mezolar", "opiodur", "yemex", "abstral", "effentora", "actiq", "instanyl", "pecfent", "buprenorphine", "butrans", "transtec", "bupeaze", "butec", "hapoctasin", "reletrans", "sevodyne", "temgesic", "tramadol", "zydol", "marol", "maxitram", "tramquel", "tramulief", "tradorec", "invodol", "codeine", "co-codamol", "zapain", "solpadol", "kapake", "codipar", "dihydrocodeine", "co-dydramol", "dhc continus", "methadone", "physeptone", "tapentadol", "palexia", "pethidine", "hydromorphone", "palladone", "meptazinol", "meptid", "papaveretum"], "exclude": ["linctus", "cough"] },
    { "name": "Benzodiazepine / Z-drug / gabapentinoid", "match": ["diazepam", "lorazepam", "temazepam", "nitrazepam", "oxazepam", "clonazepam", "chlordiazepoxide", "alprazolam", "clobazam", "loprazolam", "lormetazepam", "zopiclone", "zimovane", "zolpidem", "stilnoct", "gabapentin", "neurontin", "pregabalin", "lyrica", "alzain", "axalid", "lecaent"], "exclude": ["rectal", "rectubes", "stesolid"] }
  ],
  "sex": "any",
  "severity": "amber",
  "notes": "MHRA Mar 2020: additive CNS depression — sedation, respiratory depression, coma, death; co-prescribe only if no alternative, lowest dose, shortest duration. Gabapentinoids carry their own respiratory-depression DSUs (2017/2021), amplified by opioids, renal impairment, respiratory disease and age ≥65. Methadone: monitor ≥2 weeks after any change. Counsel on naloxone where appropriate.",
  "source": "MHRA DSU 18 Mar 2020 / 26 Oct 2017 / 18 Feb 2021"
}
```

**Provenance still required:** dm+d pass for niche fentanyl-patch brands (Victanyl, Osmanil) and new generics.

**Edge cases:** palliative/EOL patients legitimately on both — amber + review framing controls fatigue; co-codamol 8/500 matches (accepted — the MHRA advice is not dose-gated); Stesolid rectal tubes excluded (epilepsy rescue, not chronic co-prescription); OST methadone/buprenorphine fires — clinically correct per the DSU (the index death involved methadone) but flag shared-care handling to the CSO; note `"codeine"` does not substring-match co-codamol/co-dydramol — both listed explicitly.

**Tests:** `test-alert-library-coverage.js` — pin `EXPECTED['mhra-opioid-cns-depressant']`; end-to-end: Zomorph + zopiclone fires; Zomorph alone does not; codeine linctus + diazepam does not (exclude); Targinact + pregabalin fires.

---

## 4. 🟠 QOF: the SMI physical-health suite — MH002, MH003, MH006, MH007, MH012 (21 points)

**File:** `rules/qof-rules.json` · **Domain:** qof · **Feasibility: copy of the shipped `qof-mh011-lipid` pattern — zero engine work**

**The gap:** the file encodes only MH011 (lipids) on the SMI register. QOF 2026/27 carries five sibling indicators on the same register, none encoded: MH002 care plan (5 pts, 40–90%), MH003 BP (3 pts), MH006 BMI (3 pts), MH007 alcohol (3 pts), MH012 glucose/HbA1c (7 pts, diabetes excluded) — all 50–90%. ~110–115 SMI patients; the cohort with the worst mortality gap in primary care (15–20 years, CVD-driven). Encoding lipids alone gives a false "SMI check done" signal.

**Sources (fetched, full PDF text):** NHS England QOF guidance 2026/27 (PRN02356, July 2026 update) §2.1 + §3.12 — https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf; NICE IND143 (MH002), IND84 (MH003), IND83 (MH006), IND82 (MH007), IND159 (MH012). "Patients who have a diagnosis of diabetes will be excluded from MH012" read directly from the PDF.

**Proposed rules (exact specs — all `requiresRegister: "SMI"`, `check.kind: "observation-recent"`, `withinDays: 365`):**

```json
[
  { "id": "qof-mh002", "type": "qof-indicator", "enabled": true, "indicatorCode": "MH002", "indicatorName": "Comprehensive care plan in SMI (preceding 12 months)", "requiresRegister": "SMI", "check": { "kind": "observation-recent", "observation": ["mental health care plan", "comprehensive care plan", "care programme approach", "cpa review", "smi care plan", "mental health review"], "withinDays": 365 }, "thresholds": { "lower": 40, "upper": 90 }, "points": 5, "source": "QOF 26/27 MH002 (NICE IND143)", "notes": "Presence of a care-plan/review code only — content ('comprehensive', carer-agreed) is not verifiable; same caveat as DEM004/AST007. Secondary-care plans filed as documents will not surface — chip prompts, never asserts absence." },
  { "id": "qof-mh003", "type": "qof-indicator", "enabled": true, "indicatorCode": "MH003", "indicatorName": "BP recorded in SMI (preceding 12 months)", "requiresRegister": "SMI", "check": { "kind": "observation-recent", "observation": ["blood pressure", "bp"], "withinDays": 365 }, "thresholds": { "lower": 50, "upper": 90 }, "points": 3, "source": "QOF 26/27 MH003 (NICE IND84)" },
  { "id": "qof-mh006", "type": "qof-indicator", "enabled": true, "indicatorCode": "MH006", "indicatorName": "BMI recorded in SMI (preceding 12 months)", "requiresRegister": "SMI", "check": { "kind": "observation-recent", "observation": ["bmi", "body mass index"], "withinDays": 365 }, "thresholds": { "lower": 50, "upper": 90 }, "points": 3, "source": "QOF 26/27 MH006 (NICE IND83)" },
  { "id": "qof-mh007", "type": "qof-indicator", "enabled": true, "indicatorCode": "MH007", "indicatorName": "Alcohol consumption recorded in SMI (preceding 12 months)", "requiresRegister": "SMI", "check": { "kind": "observation-recent", "observation": ["alcohol consumption", "alcohol intake", "alcohol units", "audit-c", "audit c score"], "withinDays": 365 }, "thresholds": { "lower": 50, "upper": 90 }, "points": 3, "source": "QOF 26/27 MH007 (NICE IND82)", "notes": "Alcohol is often questionnaire-coded (AUDIT-C) — validate the term list against real Medicus journal labels before enabling." },
  { "id": "qof-mh012", "type": "qof-indicator", "enabled": true, "indicatorCode": "MH012", "indicatorName": "Blood glucose or HbA1c recorded in SMI (preceding 12 months)", "requiresRegister": "SMI", "excludeIfProblem": ["type 1 diabetes", "type 2 diabetes", "diabetes mellitus"], "check": { "kind": "observation-recent", "observation": ["hba1c", "haemoglobin a1c", "blood glucose", "fasting glucose", "plasma glucose"], "withinDays": 365 }, "thresholds": { "lower": 50, "upper": 90 }, "points": 7, "source": "QOF 26/27 MH012 (NICE IND159)" }
]
```

**Edge cases:** the MH012 exclusion must **never** be bare `"diabetes"` (would wrongly exclude diabetes insipidus / gestational diabetes); confirm the negation-aware matcher applies to `excludeIfProblem` so "no diabetes mellitus" doesn't exclude; MH011's own 12-vs-24-month split does NOT apply to these five (flat 12-month windows per the indicator wording); Sentinel's SMI register does not exclude "in remission" patients (known approximation, same as today).

**Tests:** `test-qof-indicator-filters.js` — SMI-register patient with BP 6 months old → MH003 achieved; 18 months old → overdue; DM-coded SMI patient → MH012 skipped (`excluded-by-problem`); diabetes-insipidus patient → MH012 NOT skipped.

---

## 5. 🔴 Vaccine: Pneumococcal (PCV20) clinical risk groups aged 2–64

**File:** `rules/vaccine-rules.json` · **Domain:** vaccines · **Feasibility: fits post-check — one engine VERIFY (register-clause age gating, confirmed absent this run)**

**The gap:** the current rule covers only 65+ and homelessness 16+; its own notes record the under-65 at-risk cohort as "intentionally not encoded". Green Book ch 25 has recommended vaccination for all clinical risk groups from age 2 since long before this file existed — and the highest-fatality cohort (asplenia/splenic dysfunction: OPSI mortality up to 50% untreated) is silently invisible today. ~450–650 eligible patients aged 2–64; national risk-group uptake historically <50%, so ~250–400 would flag due.

**Sources (fetched):** UKHSA Green Book Chapter 25, Table 25.2 (version 12 Jun 2025) — https://assets.publishing.service.gov.uk/media/684b1fbc1c8d5c94e201abae/Green_Book__Chapter_25_pneumococcal_12_6_25.pdf; PCV20 replaced PPV23 for the adult routine and at-risk programmes late 2025/early 2026 (NHSE/UKHSA change letter, JCVI Oct 2025 note).

**Proposed rule (exact spec):**

```json
{
  "id": "vax-pneumo-risk-u65",
  "type": "vaccine",
  "enabled": true,
  "vaccine": "pneumococcal",
  "displayName": "Pneumococcal vaccine (PCV20, clinical risk group)",
  "schedule": "once",
  "eligibility": { "anyOf": [
    { "kind": "problem", "match": ["asplenia", "splenectomy", "hyposplenism", "splenic dysfunction", "sickle cell", "thalassaemia major", "hereditary spherocytosis"], "ageMin": 2, "ageMax": 64, "label": "Asplenia or splenic dysfunction (age 2–64)" },
    { "kind": "register", "registers": ["DM", "CKD", "COPD", "CHD", "HF"], "label": "Clinical risk group (QOF register, under 65)" },
    { "kind": "problem", "match": ["bronchiectasis", "cystic fibrosis", "interstitial lung", "pulmonary fibrosis", "pneumoconiosis", "cerebral palsy", "cirrhosis", "biliary atresia", "chronic hepatitis", "nephrotic syndrome", "cochlear implant", "cerebrospinal fluid leak", "csf leak", "complement deficiency", "complement disorder", "hiv", "aids", "transplant", "leukaemia", "lymphoma", "myeloma", "primary immunodeficiency"], "ageMin": 2, "ageMax": 64, "label": "Clinical risk group — problem (age 2–64)" },
    { "kind": "medication", "match": ["rituximab", "azathioprine", "ciclosporin", "mycophenolate", "tacrolimus", "sirolimus", "methotrexate", "cyclophosphamide", "chemotherapy", "prednisolone", "dexamethasone"], "ageMin": 2, "ageMax": 64, "label": "Immunosuppressive medication (age 2–64)" }
  ] },
  "statusTerms": "(reuse vax-pneumo-ppv23 given/declined lists, MINUS generic 'pneumococcal conjugate vaccin' terms — see edge cases)",
  "source": "Green Book ch 25 Table 25.2 (12 Jun 2025); PCV20 switch late 2025/early 2026",
  "notes": "Separate rule with ageMax 64 so it never double-fires with the 65+ rule. Revaccination q5y for asplenia/CKD is not encodable (schedule: once) — manual-check note stays. DM register includes diet-only diabetics who are NOT Green-Book-eligible — mild over-flag, say so in chip text."
}
```

**BLOCKING engine item (verified this run):** the `register`-kind clause applies no `ageMax`, so DM/CKD/COPD/CHD/HF register members aged 65+ would double-fire alongside `vax-pneumo-ppv23`. Either patch `rules-engine.js:2348–2368` to honour `ageMin`/`ageMax` on register clauses (mirroring the medication branch — ~4 lines + tests), or replace the register clause with problem-kind equivalents. Do not ship without one of the two.

**Edge cases:** childhood PCV13 primary-course records must NOT satisfy this rule for life — drop generic "pneumococcal conjugate vaccin" given-terms from this rule (accept the tiny false-DUE cohort vaccinated in infancy, which is the fail-safe direction); prednisolone/dexamethasone matching cannot check the ≥20mg/day >1 month Green Book threshold (over-flags short courses); under-2s deliberately excluded (separate multi-dose schedule, Table 25.3).

**Tests:** `test-vaccine-rules.js` — age 40 + splenectomy fires; age 40 no risk does not; age 70 + DM does NOT fire this rule (double-fire guard — this is the test that pins the engine patch); age 40 + methotrexate fires; infant PCV13 record does not suppress a 40-year-old asplenic's due status.

---

## 6. 🔴 STOPP/START: bone protection — START H4 (osteoporosis / fragility fracture) + degraded H2 (steroid)

**File:** `engine/stopp-start.js` (data tables only) · **Domain:** medreview · **Feasibility: (a) exact fit; (b) honest degraded variant**

**The gap:** the 14-criterion subset is silent on bone health — and the secondary-fracture-prevention treatment gap is the best-documented prescribing omission in UK elderly care (40–60% of coded-osteoporosis patients untreated → ~50–90 flags here; hip fracture 1-year mortality 20–30%).

**Source (fetched):** STOPP/START v3 (O'Mahony et al., Eur Geriatr Med 2023;14:625–632), START Section H criteria H2/H3/H4, full text via the NHS Somerset reproduction — https://nhssomerset.nhs.uk/wp-content/uploads/sites/2/STOPP-START-V3.pdf (2023-05-31).

**Proposed criteria (data-table style of the shipped `start_statin_ihd`):**

```text
(a) id: start_bone_protection_osteoporosis · kind: start · severity: amber
    Gate: hasProblem(problems, OSTEOPOROSIS_TERMS) && !hasDrug(drugs, BONE_THERAPY_TERMS)
    OSTEOPOROSIS_TERMS = ['osteoporosis', 'osteoporotic', 'fragility fracture']
      — deliberately NOT bare 'fracture' (traumatic flood) and NOT 'osteopenia' (H4 requires T ≤ -2.5)
    BONE_THERAPY_TERMS = ['alendron', 'fosamax', 'binosto', 'risedron', 'actonel', 'ibandron',
      'bonviva', 'zoledron', 'aclasta', 'pamidron', 'denosumab', 'prolia', 'teriparatide',
      'forsteo', 'movymia', 'terrosa', 'sondelbay', 'romosozumab', 'evenity', 'raloxifene',
      'evista', 'abaloparatide', 'eladynos', 'strontium ranelate']
      — 'alendron' stem covers alendronic acid + alendronate

(b) id: start_bone_protection_steroid · kind: start · severity: amber · DEGRADED
    Gate: hasDrug(drugs, ['prednisolone', 'deflazacort', 'methylprednisolone', 'dexamethasone'])
          && !hasDrug(drugs, BONE_THERAPY_TERMS) && !hasDrug(drugs, CALCIUM_VITD_TERMS)
    CALCIUM_VITD_TERMS = ['adcal', 'calcichew', 'accrete', 'evacal', 'theical', 'calceos',
      'natecal', 'colecalciferol', 'cholecalciferol', 'fultium', 'desunin', 'invita d3',
      'stexerol', 'plenachol', 'calcium carbonate']
    Detail text MUST state: "course duration cannot be determined from this snapshot — applies to
    corticosteroid courses expected to run ≥3 months; verify against the live record."
```

**Edge cases:** denosumab (6-monthly clinic-administered) and annual IV zoledronate may not appear in the active med list → false positives, name this in the detail text; HRT is a NOGG-endorsed alternative in younger post-menopausal women and is not in the term set (acceptable amber); hydrocortisone deliberately excluded from the steroid list (substring hits topical creams) → Addisonian replacement missed, documented limitation; palliative patients exempt per the v3 preamble (clinician judgement, not codeable).

**Tests:** `test-stopp-start.js` — coded osteoporosis + no bone therapy fires (a); + alendronic acid does not; "family history of osteoporosis" does not (negation matcher); prednisolone + nothing fires (b); prednisolone + Adcal-D3 does not; hydrocortisone cream alone does not.

---

## 7. 🔴 Drug monitoring: Denosumab — calcium before each dose

**File:** `rules/drug-rules.json` · **Domain:** drugs · **Feasibility: fits schema as-is**

**The gap:** this dispensing practice administers denosumab 6-monthly in-house; there is no rule. MHRA warns of **fatal** hypocalcaemia; the SmPC mandates calcium monitoring before each dose. And since the November 2025 patent expiry, denosumab **must be prescribed by brand** across a 13-biosimilar landscape — making brand completeness the difference between a working rule and a decorative one (the repo's own doctrine).

**Sources (fetched):** MHRA DSU Sept 2014 — https://www.gov.uk/drug-safety-update/denosumab-monitoring-recommended; Prolia SmPC ("clinical monitoring of calcium levels is recommended before each dose") — https://www.medicines.org.uk/emc/product/568/smpc; SPS denosumab 60 mg biosimilars (21 Nov 2025, updated 24 Apr 2026) — https://www.sps.nhs.uk/articles/the-licence-and-supporting-evidence-for-denosumab-60mg-biosimilars/.

**Proposed rule (exact spec):**

```json
{
  "type": "drug-monitoring",
  "enabled": true,
  "id": "denosumab-calcium",
  "drugClass": "RANKL inhibitor",
  "drug": {
    "match": ["denosumab", "prolia", "xgeva", "stoboclo", "jubbonti", "obodence", "osvyrti", "conexxence", "evfraxy", "izamby", "junod", "kefdensis", "ponlimsi", "zadenvi", "acvybra", "bildyos", "wyost", "osenvelt", "bomyntra", "enwylma", "jubereq", "yaxwer", "xbryk", "vevzuo", "denbrayce"],
    "exclude": []
  },
  "phase": "maintenance",
  "tests": [
    { "name": "Calcium (before each 6-monthly dose)", "match": ["calcium", "corrected calcium", "adjusted calcium", "bone profile"], "snomed": ["390967006"], "intervalDays": 182, "dueSoonDays": 21 },
    { "name": "U&E / eGFR", "match": ["u&e", "urea and electrolytes", "renal profile", "egfr", "creatinine"], "snomed": ["1019331000000106"], "intervalDays": 365, "dueSoonDays": 30 }
  ],
  "source": "MHRA DSU Sept 2014 (fatal hypocalcaemia) / Prolia SmPC / SPS biosimilar brand set (Nov 2025–Apr 2026)",
  "notes": "Hypocalcaemia risk rises steeply with renal impairment. The 182-day calcium chip also proxies on-time dosing — delayed denosumab causes rebound vertebral fractures. Xgeva 120mg (oncology, 4-weekly) is secondary-care administered: specialist schedule prevails, chip is a backstop. Denosumab must now be prescribed BY BRAND (SPS): keep this brand list current every Keeper run.",
  "sharedCare": true
}
```

**Edge cases:** brand list churns (further EMA products pending UK filing) — a standing Keeper re-check item, exactly the valproate-brand failure class; a true "injection overdue" alert is `needs-engine-change` (no dose-interval concept) — the calcium chip is the nearest schema fit; vitamin D adequacy is notes-only.

**Tests:** `test-drug-brand-coverage.js` — `EXPECTED['denosumab-calcium']` covering all 25 terms (e.g. 'Stoboclo 60mg solution for injection', 'Prolia 60mg'); calcium observation matching must not hit "calcium channel blocker" med text (observation matching only — verify).

---

## 8. 🔴 STOPP/START: regular opioid without laxative — STOPP L2 / START K2

**File:** `engine/stopp-start.js` (data tables only) · **Domain:** medreview · **Feasibility: degraded presence-only (regular-vs-PRN unknowable — stated honestly)**

**The gap:** opioid-induced constipation affects 40–80% of regular opioid users; in the elderly it means impaction, overflow incontinence, delirium, admission. ~80–150 patients on strong-opioid repeats; 40–60% typical laxative co-prescription → ~40–80 flags. Highest-volume medreview gap.

**Source (fetched):** STOPP/START v3 Sections L2/K2 — https://nhssomerset.nhs.uk/wp-content/uploads/sites/2/STOPP-START-V3.pdf (2023-05-31).

**Proposed criterion:**

```text
id: stopp_opioid_no_laxative · kind: stopp · severity: amber
Gate: hasDrug(drugs, STRONG_OPIOID_TERMS) && !hasDrug(drugs, LAXATIVE_TERMS)
STRONG_OPIOID_TERMS = ['morphine', 'zomorph', 'mst continus', 'sevredol', 'oramorph', 'mxl',
  'oxycodone', 'oxycontin', 'oxynorm', 'longtec', 'shortec', 'reltebon', 'abtard', 'fentanyl',
  'durogesic', 'matrifen', 'mezolar', 'fencino', 'buprenorphine', 'butrans', 'butec', 'transtec',
  'bupeaze', 'sevodyne', 'tapentadol', 'palexia', 'methadone', 'physeptone', 'diamorphine',
  'pethidine', 'tramadol', 'zydol', 'zamadol', 'marol', 'maxitram', 'meptazinol', 'meptid',
  'dihydrocodeine', 'dhc continus']
LAXATIVE_TERMS = ['senna', 'senokot', 'lactulose', 'duphalac', 'macrogol', 'movicol', 'laxido',
  'cosmocol', 'molaxole', 'bisacodyl', 'dulcolax', 'sodium picosulfate', 'docusate', 'dioctyl',
  'docusol', 'ispaghula', 'fybogel', 'methylcellulose', 'celevac', 'sterculia', 'normacol',
  'glycerol suppositor', 'glycerin suppositor', 'magnesium hydroxide', 'co-danthramer',
  'co-danthrusate', 'dantron', 'linaclotide', 'constella', 'prucalopride', 'resolor',
  'naloxegol', 'moventig', 'methylnaltrexone', 'relistor', 'naldemedine', 'rizmoic', 'naloxone']
Detail text: "criterion applies to DAILY REGULAR opioids — verify this is not PRN-only use."
```

**Edge cases:** PRN-only Oramorph (breathlessness, palliative) fires falsely — PRN status is unknowable, caveat carried in detail text; OTC senna invisible to the med list; `'naloxone'` in the laxative list deliberately self-covers Targinact (oxycodone/naloxone); weak opioids (codeine/co-codamol) deliberately excluded from v1 to control false positives — extend later if volume tolerates; OST buprenorphine/methadone patients still constipate (flag valid; framing note).

**Tests:** `test-stopp-start.js` — Zomorph + nothing fires; Zomorph + senna does not; Targinact alone does not (naloxone self-cover); co-codamol alone does not (weak-opioid exclusion pinned as deliberate).

---

## 9. 🔴 Vaccine: Shingles (Shingrix) — severely immunosuppressed 18+ (stale-blocker correction)

**File:** `rules/vaccine-rules.json` · **Domain:** vaccines · **Feasibility: fits schema TODAY — the recorded blocker is stale**

**The gap — and a governance finding:** the file's notes say the immunosuppressed pathway is "NOT encoded (engine cannot combine age + clinical criteria in one clause)". That was true before the 2026-08-01 engine fix — which this same file's `specVersion` records — made `ageMin`/`ageMax` enforceable on problem and medication clauses (re-verified in `rules-engine.js:2339–2376` this run). The blocker is stale; meanwhile severely immunosuppressed 18–64s **and 80+** (eligible, no upper age limit) are invisible. ~60–90 patients outside the existing bands; programme one year old → ~40–70 flags.

**Sources (fetched):** NHSE/UKHSA bipartite letter 22 Jul 2025 (effective 1 Sep 2025): "expand the eligibility to all severely immunosuppressed people aged 18 years and over (with no upper age limit)" — https://www.gov.uk/government/publications/expansion-of-shingrix-vaccine-eligibility-to-all-those-who-are-severely-immunosuppressed-and-aged-18-years-and-over-letter/shingles-vaccination-programme-expansion-of-shingrix-vaccine-eligibility-to-all-those-who-are-severely-immunosuppressed-and-aged-18-years-and-over; UKHSA Vaccine Update 363 (Sept 2025).

**Proposed rule (exact spec):**

```json
{
  "id": "vax-shingles-immuno",
  "type": "vaccine",
  "enabled": true,
  "vaccine": "shingles",
  "displayName": "Shingles vaccine (Shingrix, severely immunosuppressed 18+)",
  "schedule": "once",
  "eligibility": { "anyOf": [
    { "kind": "problem", "match": ["transplant", "stem cell", "bone marrow", "leukaemia", "leukemia", "lymphoma", "myeloma", "primary immunodeficiency", "severe combined immunodeficiency", "scid", "hiv", "aids"], "ageMin": 18, "label": "Severely immunosuppressed — disease (18+, from 1 Sept 2025)" },
    { "kind": "medication", "match": ["rituximab", "alemtuzumab", "ofatumumab", "ciclosporin", "mycophenolate", "tacrolimus", "azathioprine", "cyclophosphamide", "chemotherapy", "ibrutinib", "venetoclax"], "ageMin": 18, "label": "Severely immunosuppressed — medication (18+, from 1 Sept 2025)" }
  ] },
  "statusTerms": "(reuse vax-shingles given/declined lists — CSO decision on dropping 'zostavax' from THIS rule's given list, see edge cases)",
  "source": "NHSE/UKHSA letter 22 Jul 2025 (effective 1 Sep 2025); UKHSA Vaccine Update 363",
  "notes": "Cohort is SEVERELY immunosuppressed per Green Book ch 28a — terms deliberately conservative (no methotrexate / low-dose steroids, unlike the flu rule's broader list). 2-dose completion (0 and 8wk–6mo) not verifiable — same documented limitation as vax-shingles. CORRECT THE STALE SENTENCE in vax-shingles notes in the same change."
}
```

**Edge cases:** 65–79 immunosuppressed patients double-chip alongside `vax-shingles` while due (both resolve on vaccination — acceptable); Zostavax-given-then-immunosuppressed patients need Shingrix re-vaccination but reused given-terms would show GIVEN — consider omitting `zostavax` from this rule's given list (over-flag = fail-safe direction), CSO to decide; anticipatory pre-immunosuppression vaccination is in-policy but not detectable.

**Tests:** `test-vaccine-rules.js` — age 45 + lymphoma fires; age 45 + methotrexate only does NOT (conservative terms pinned as deliberate); age 82 + rituximab fires (no upper limit); age 45 + lymphoma + shingrix-given record → vax_given.

---

## 10. 🟠 Alert: Valproate in MALE under 55 — MHRA regulatory measures

**File:** `rules/alert-library.json` · **Domain:** alerts · **Feasibility: near-clone of the existing female rule**

**The gap:** the library implements exactly half of the January 2024 MHRA measures. Since 31 Jan 2024 valproate must not be *started* in ANY patient under 55 without two independent specialist sign-offs, and men on valproate should use effective contraception (MHRA Sep 2024 precaution; Feb 2025 clarification: existing male patients don't need the two-specialist review). Males under 55 on valproate currently generate no chip. National Patient Safety Alert-backed mandate, not advisory. ~5–12 males under 55 on this list.

**Source (fetched):** MHRA DSU 22 Jan 2024 — https://www.gov.uk/drug-safety-update/valproate-belvo-convulex-depakote-dyzantil-epilim-epilim-chrono-or-chronosphere-episenta-epival-and-syonellv-new-safety-and-educational-materials-to-support-regulatory-measures-in-men-and-women-under-55-years-of-age; timeline at https://www.gov.uk/guidance/valproate-reproductive-risks.

**Proposed rule (exact spec):**

```json
{
  "type": "drug-combo",
  "enabled": true,
  "label": "Valproate — male under 55 (MHRA 2024 conditions)",
  "drugSets": [
    { "name": "Valproate", "match": ["sodium valproate", "valproic acid", "valproate", "semisodium valproate", "epilim", "depakote", "convulex", "belvo", "dyzantil", "episenta", "epival", "syonell"] }
  ],
  "ageRange": { "min": 12, "max": 55 },
  "sex": "M",
  "severity": "amber",
  "notes": "MHRA Jan 2024 (in force 31 Jan 2024): no new initiation under 55 in either sex without two specialists' independent sign-off; new male initiations need a two-specialist Risk Acknowledgement Form (initiation only — Feb 2025 clarification). Sep 2024 precaution: men on valproate and partners should use effective contraception. GP role: confirm specialist oversight, counsel, NEVER stop valproate abruptly. Amber deliberately — compliance/counselling check, not a pregnancy-exposure emergency.",
  "source": "MHRA DSU 22 Jan 2024 / valproate reproductive-risks guidance"
}
```

**Edge cases:** men 55+ deliberately excluded per MHRA; `"valproate"` substring covers semisodium forms; Depakote-for-bipolar matches (correct — restrictions are indication-agnostic). **Linked drift ticket:** the existing *female* rule carries a shorter brand list than the MHRA DSU title's brand set — audit it in the same batch.

**Tests:** `test-alert-library-coverage.js` — pin `EXPECTED['mhra-valproate-male-u55']`; end-to-end: Epilim in a 30-year-old male fires; 60-year-old male does not; 30-year-old female fires the existing female rule not this one; Dyzantil (brand-only) fires.

---

# Runners-up (ranked 11–25 — sourced and specified in the scan artefacts, not expanded here)

| # | Gap | Domain | RAG | One-line spec | Why not top-10 |
|---|-----|--------|-----|---------------|----------------|
| 11 | ACB table additions (propiverine/flavoxate/cinnarizine/cyproheptadine/methocarbamol/clemastine/pericyazine @3; nefopam/tramadol/pimozide/perphenazine/disopyramide @2) | medreview | 🔴 | Pure `ACB_TABLE` additions, every score verified line-by-line on the fetched ACBcalc table (03 Jul 2024); each score-≥2 miss silently breaks `computeACB` + `stopp-anticholinergic-elderly` + the proposed dementia rule simultaneously; propiverine is a same-class hole (every other OAB antimuscarinic is listed) | Tramadol@2 causes a step-change in elderly-rule flag volume — needs a CSO volume decision first |
| 12 | Renal-gate expansion: STOPP E2/E3/E7/E8/E9/E10 (dabigatran<30, FXa<15, MRA<30, nitrofurantoin<45, bisphosphonate<30, methotrexate<30) | medreview | 🔴 | Six sibling blocks of the shipped `stopp_nsaid_ckd` (fail-closed on unknown eGFR); ~5–15 flags, near-zero false positives | Small n; straight pattern-copy any time |
| 13 | Reception pathway: abdominal pain (adult) — AAA (NG156 1.1.7), GI bleed, peritonism, ectopic/torsion cross-flags | pathways | 🔴 | Full pathway spec in scan artefact; ruptured-AAA-booked-routine is unsurvivable | Second pathway slot; fever-adult ranked ahead on lethality-frequency product |
| 14 | Pertussis in pregnancy (from 16wk, every pregnancy) | vaccines | 🟠 | Year-round `season {startMonth:1, startDay:1}` calendar-year lookback approximates per-pregnancy gating, fail-safe direction (false-DUE); gestation not verifiable — chip carries "offer from 16 weeks" | Workaround needs explicit CSO acceptance of two documented failure modes |
| 15 | RSV in pregnancy (from 28wk, Abrysvo, key `rsv-maternal`) | vaccines | 🟠 | Same mechanism, cleaner (≤12wk dose-to-delivery); Abrysvo-only given-terms. **Linked latent defect:** existing `vax-rsv`'s lifetime lookback + `abrysvo` given-term means a maternal dose falsely satisfies the older-adult rule decades later — log for CSO regardless | Same CSO-acceptance dependency |
| 16 | SSRI + NSAID/antiplatelet without gastroprotection (NG222) | alerts | 🟠 | 2-set combo + `mustNotBePresent` PPI/H2 gate, pincer-1 pattern | Largest fire-count (~40–70) — stage rollout or gate ≥65 first |
| 17 | Triple whammy ACEi/ARB + diuretic + NSAID (3-set) | alerts | 🔴 | First N=3 drugSets rule; AKI OR 2.01 (BJCP 2025 meta-analysis); co-fires with pincer-4 by design | 10–25 patients; needs the N=3 regression test written first |
| 18 | Macrolide (clarithro/erythro) + simvastatin (contraindicated) / atorvastatin (cap 20mg) | alerts | 🔴 | Acute-prescribing trap; azithromycin deliberately absent (it's the switch) | Episodic (2–5 concurrent); single severity over-calls the atorvastatin arm |
| 19 | Aminosalicylate (mesalazine et al.) renal/FBC/LFT annual | drugs | 🔴 | BNF-mandated (3mo then annual renal); decade-long GP repeats, medicolegal history | ~15–30 patients; exclude-list (rectal forms) needs real-record validation — exclude is sharp |
| 20 | QOF BP002 (BP in 5 years, all 45+, 15 pts) | qof | 🟠 | Register-less indicator now PROVEN expressible (`trend-egfr-falling` precedent); rolling `withinDays: 1825`, NOT QOF-year floor | Huge denominator, low per-flag urgency; chip-volume decision |
| 21 | Lithium + ACEi/ARB or thiazide/loop (completes the toxicity trio with pincer-12) | alerts | 🟠 | 2-set combo; **must include lithium brands** (see cross-cutting Red finding) | 4–10 patients; ship after/with the brand fix |
| 22 | Anticholinergic (ACB≥2) + dementia — STOPP D14/I1 | medreview | 🔴 | Reuses shared ACB term set; red severity; not age-gated | Value multiplies if #11 lands first |
| 23 | Reception pathway: skin infection / bites / shingles (completes the 3 missing Pharmacy First mappings with clean age gates) | pathways | 🟠 | Full spec in artefact; also narrows `rash`'s PF label to impetigo-only | PF plumbing decision (two gates in one pathway) for CSO |
| 24 | MMR catch-up age 1–11, zero-dose flag (2026/27 national MMR/V campaign; elimination status lost Jan 2026) | vaccines | 🟠 | `schedule: once`, age 1–11, measles-containing given-terms incl. MMRV/Priorix/ProQuad | Cannot count doses (1-of-2 children pass silently — documented); CHIS remains authoritative |
| 25 | Calcineurin inhibitors (ciclosporin/tacrolimus) 90d bloods | drugs | 🟠 | The engine's own `HIGH_RISK_UNMATCHED_CLASSES` backstop lists both — an admission the rule is missing | 8–15 patients; transplant-unit bloods outside GP record → false-overdue noise |

Also specified in the scan artefacts (`/tmp/keeper-gaps/*.md`, preserved in the PR): testosterone HCT/PSA (BSSM), acitretin LFT/lipids, TCA+BPH/angle-closure, duplicate drug-class (STOPP A3 via the distinct-drug guard), dopamine-blocker-in-parkinsonism, fluoroquinolone restriction, montelukast neuropsych, eye/leg/D&V pathways, QOF CS005/6 + VI004, MH002 companion notes.

# Engine extensions worth making (each unlocks multiple held rules)

1. **Age gating on vaccine `register` clauses** (~4 lines mirroring the medication branch + tests) — unblocks gap 5's register clause cleanly.
2. **A `repeat-medication-only` / on-drug->N-days gate** — unlocks nitrofurantoin-prophylaxis monitoring (BNF-mandated, shipped-disabled spec in artefact) AND long-term oral corticosteroid monitoring AND upgrades gap 6(b)/gap 8 from degraded to precise. The single highest-leverage engine change this scan found.
3. **Age-at-event logic** — would unlock QOF VI001–003 (54 pts) and the true VI004 cohort; large; record as a deliberate hold like OB004/OB005 if declined.

# Deliberately not proposed (verified absent or infeasible — do not re-derive)

- **QOF CAN/EP/RA/OST/PC/DEP registers**: retired 2025/26, absent from the 2026/27 indicator set — verified against both years' PRN02356 PDFs. Not gaps.
- **Phenytoin monitoring**: SPS explicitly does not recommend routine level monitoring; no defensible interval — stays on the high-risk backstop.
- **Clozapine**: exclusion remains correct (CPMS/ZTAS, secondary-care dispensed).
- **Weekly-MTX-dosed-daily, metoclopramide >5 days, benzo ≥4 weeks**: dose/duration logic — inexpressible.
- **Td/IPV boosters, hep B risk groups, childhood schedule status**: dose-counting/serology/CHIS territory.
- **STOPP C5 pairwise antiplatelet+anticoagulant**: 12-month post-PCI legitimacy + unknowable stent recency → false positives would swamp; pincer-13 covers the triple.
- **Housekeeping cross-refs**: lamotrigine/levetiracetam/ezetimibe/bempedoic-acid → `no-monitoring-common` candidates (currently "unmatched" noise); sacubitril/Entresto already covered in `ace-arb` (verified).

# Drift items found incidentally (route to a standard Keeper pass)

1. 🔴 **Lithium brands missing from pincer-12 + nice-lithium-monitoring** (repo-verified — see cross-cutting finding above).
2. 🟠 **AST007→AST015 / AST012→AST014 ID renames** confirmed readable in the July 2026 PRN02356 update (both PDFs fetched in full this run — the file header's "July amendment unread" note can be cleared; this was already a held item).
3. 🟠 **Stale engine-limitation sentence in `vax-shingles` notes** (see gap 9).
4. 🟠 **`vax-rsv` latent false-GIVEN** via maternal Abrysvo records (see runner-up 15).
5. 🟠 **Female valproate rule brand list** shorter than the MHRA 2024 brand set (see gap 10).
6. 🟢 **ACBcalc 2024 re-scores** (furosemide/metoprolol/codeine/warfarin/trazodone/colchicine/nifedipine now 0; alimemazine 1; hydroxyzine 3; carbamazepine 2) — repo keeps conservative-higher; CSO judgement, no change proposed.

# Honest limitations

- **National sources only** — local ICB formulary/shared-care nuances are out of scope; absence of a local nuance is not "nothing to change".
- **Geo-restricted CKS pages** (malaria, bites, shingles, limb ischaemia, gout, GI bleeding, T1DM sick-day) were corroborated via NHS.uk/NHS Inform/BMJ Best Practice/NICE guideline pages but the primary CKS wording needs verifier confirmation before CSO sign-off — each such flag is marked VERIFY in its spec.
- **dm+d brand passes still owed** on: thiazide combo brands, fentanyl-patch niche brands, Tacni/Vivadex/Perixis, Virormone, Genfura — per house convention, before any of those rules ship.
- **Frequency estimates** are national-prevalence arithmetic scaled to an 11,500 list, not practice-audit numbers; treat as order-of-magnitude.
- **Nothing in this report modifies a rule file.** The Keeper proposes; the CSO decides.

---

*Scan artefacts (full scanner outputs with the complete runner-up specs): `docs/keeper/gap-scan-2026-08-22/` — one file per domain (drugs, qof, vaccines, alerts, medreview, pathways).*
