# Drugs gap scan result (all sources verified 22 Aug 2026; sacubitril/valsartan confirmed already covered in ace-arb)

## gap-drug-01 — Thiazide/thiazide-like diuretics U&E — RED, HIGH ★rank 1 (largest-population gap in file)
- No thiazide term anywhere in drug-rules.json or alert library; loop diuretics get 180d PINCER chip, thiazides nothing.
- Rule sketch: id thiazide-diuretic-ue. match: [indapamide, natrilix, alkapamid, cardide, rawel, bendroflumethiazide, aprinox, neo-naclex, chlortalidone, chlorthalidone, hydrochlorothiazide, xipamide, diurexan, metolazone, xaqua, cyclopenthiazide, navidrex, co-amilozide, moduretic, co-triamterzide, co-tenidone, tenoret]. Tests: U&E (match u&e/urea and electrolytes/renal profile/sodium/potassium, snomed 1019331000000106) 365d dueSoon 30; U&E postInitiationDays 28 dueSoon 14.
- Sources: CKS hypertension thiazide-like prescribing info https://cks.nice.org.uk/topics/hypertension/prescribing-information/thiazide-like-diuretics/ ; indapamide SmPC https://www.medicines.org.uk/emc/product/4188/smpc ; NG136. Evidence: sodium before starting then regular intervals (asymptomatic fall, monitoring "essential", elderly more frequent); potassium first week then regularly; NG136 annual review.
- Frequency ~250–450 (HTN register ~1,600; thiazides 15–25% of treated + metolazone HF). Impact: thiazide hyponatraemia = top drug cause of confusion/falls/admission in elderly; hypokalaemia arrhythmia.
- Edge cases: ACE/ARB+HCTZ combos fire both rules (same test — verify merge not double-chip); combo brands carry hidden thiazide (no generic substring) — dm+d pass needed; "annual" is conservative synthesis (no crisp single-source interval); MHRA HCTZ skin-cancer point = notes only.

## gap-drug-02 — Denosumab calcium — RED, HIGH ★rank 2 (dispensing practice administers; 13 biosimilars since Nov 2025)
- Sketch: id denosumab-calcium. match: [denosumab, prolia, xgeva, stoboclo, jubbonti, obodence, osvyrti, conexxence, evfraxy, izamby, junod, kefdensis, ponlimsi, zadenvi, acvybra, bildyos, wyost, osenvelt, bomyntra, enwylma, jubereq, yaxwer, xbryk, vevzuo, denbrayce]. Tests: calcium (match calcium/corrected calcium/adjusted calcium/bone profile, snomed 390967006) 182d dueSoon 21; U&E/eGFR 365d dueSoon 30. sharedCare true.
- Sources: MHRA DSU Sept 2014 https://www.gov.uk/drug-safety-update/denosumab-monitoring-recommended (fatal hypocalcaemia); Prolia SmPC https://www.medicines.org.uk/emc/product/568/smpc ("clinical monitoring of calcium levels recommended before each dose"); SPS biosimilars https://www.sps.nhs.uk/articles/the-licence-and-supporting-evidence-for-denosumab-60mg-biosimilars/ (21 Nov 2025, upd 24 Apr 2026; 13 brands; denosumab MUST now be prescribed by brand).
- Frequency ~30–60. Impact: dose into unrecognised hypocalcaemia (seizures, QTc, deaths); 182d calcium chip also proxies on-time dosing (delay → rebound vertebral fractures).
- Edge cases: brand list churns — Keeper re-check each run; Xgeva 120mg oncology 4-weekly (notes: specialist schedule prevails); no "injection overdue" concept (true dose-interval alert = needs-engine-change); vit D = notes.

## gap-drug-03 — Aminosalicylates (mesalazine etc.) renal/FBC/LFT — RED, HIGH ★rank 3
- Sketch: id aminosalicylate-maintenance. match: [mesalazine, mesalamine, asacol, octasa, pentasa, salofalk, mezavant, salcrozine, zyduco, zintasa, olsalazine, dipentum, balsalazide, colazide]; exclude [enema, suppositor, rectal foam]. Tests: U&E 365d, FBC 365d, LFT 365d (dueSoon 30).
- Sources: BNF mesalazine https://bnf.nice.org.uk/drugs/mesalazine/ ("renal function before starting, at 3 months, then annually" — all aminosalicylates); SPS https://sps.nhs.uk/monitorings/mesalazine-monitoring/ (29 Apr 2025: + FBC/LFT annually). MDU medicolegal history on missed annual renal checks.
- Frequency ~15–30 (UC ~1/400–500, decade-long GP repeats, no specialist contact). Impact: interstitial nephritis insidious/irreversible if late; agranulocytosis.
- Edge cases: rectal-only forms excluded but exclude strings must be checked vs real Medicus formulation naming (exclude is sharp; oral+rectal patient still matches via oral); postInitiationDays 100 optional for 3-month check; "mesalamine" defensive.

## gap-drug-04 — Calcineurin inhibitors (ciclosporin/tacrolimus oral) — AMBER, HIGH ★rank 4 (engine's own HIGH_RISK_UNMATCHED backstop lists them = admission the rule is missing)
- Sketch: id calcineurin-inhibitor-maintenance. match: [ciclosporin, cyclosporin, neoral, sandimmun, capimune, capsorin, deximune, vanquoral, tacrolimus, prograf, adoport, advagraf, modigraf, envarsus, dailiport]; exclude [protopic, ointment, cream, eye drop, eye ointment, ikervis, verkazia]. Tests: U&E 90d, FBC 90d, LFT 90d (dueSoon 14), glucose/HbA1c 182d, BP 90d. sharedCare true.
- Sources: SPS https://sps.nhs.uk/monitorings/ciclosporin-monitoring/ (stable: creat/GFR, FBC, ALT/AST, albumin, glucose, BP every 1–3 months; withhold if creat >30% above baseline); SPS tacrolimus (from 12m: 3–6-monthly); Norfolk & Waveney tacrolimus-UC protocol 01 Feb 2026 (3-monthly indefinitely).
- Frequency ~8–15. Impact: nephrotoxicity, hyperkalaemia, PTDM, marrow suppression, graft loss; GP contractually must confirm monitoring before each shared-care issue.
- Edge cases: topical/ocular excluded — verify exclude strings vs real records; transplant-unit bloods outside GP record → chip may false-overdue ("confirm with unit before chasing" in notes); trough levels deliberately NOT enforced; legacy brands Tacni/Vivadex/Perixis pending dm+d confirmation.

## gap-drug-05 — Testosterone replacement HCT/PSA — AMBER, HIGH ★rank 5
- Sketch: id testosterone-replacement, sex M, ageMin 18. match: [testosterone, sustanon, nebido, testogel, tostran, testavan, testim, virormone]. Tests: FBC/haematocrit 365d, PSA 365d, testosterone level 365d.
- Source: BSSM 2023 practical guide https://bssm.org.uk/wp-content/uploads/2023/08/Trends-Urol-Men-s-Health-2023-Hackett-A-practical-guide-to-the-assessment-and-management-of-testosterone-deficiency-1.pdf — evaluate 3/6/12mo then 12-monthly: testosterone (target 15–30 nmol/L), HCT <54%, PSA (rise >1.4 ng/mL/yr → urology).
- Frequency ~10–30 and rising. Impact: polycythaemia HCT>0.54 thrombosis/stroke; missed PSA velocity in tumour-accelerating therapy.
- Edge cases: women on off-label low-dose T excluded by sex:M — deliberate, record decision; Sustanon/Nebido contain no "testosterone" substring — brands mandatory; Testim discontinued (legacy repeats); gender-affirming T also matches (HCT appropriate, PSA differs — notes).

## gap-drug-06 — Nitrofurantoin long-term LFT/renal — AMBER, ship DISABLED (needs duration gate)
- Sketch: id nitrofurantoin-longterm, enabled FALSE. match: [nitrofurantoin, macrobid, macrodantin, furadantin, genfura]. Tests: LFT 182d, U&E/eGFR 182d.
- Sources: BNF https://bnf.nice.org.uk/drugs/nitrofurantoin/ ("on long-term therapy, monitor liver function and monitor for pulmonary symptoms"); MHRA DSU https://www.gov.uk/drug-safety-update/nitrofurantoin-reminder-of-the-risks-of-pulmonary-and-hepatic-adverse-drug-reactions ; NHS Grampian guide (LFT+renal 3–6-monthly).
- BLOCKER: engine cannot distinguish 3-day acute course from prophylaxis → enabled rule false-fires on every acute cystitis script. Ship disabled like digoxin-renal-monitoring pending "repeat-medication-only"/"on-drug >N days" engine gate (same gate would unlock long-term oral corticosteroids).
- Frequency ~15–40 (elderly women, NG112 first-choice prophylactic). Impact: pulmonary fibrosis + autoimmune hepatitis (onset >6mo), irreversible/fatal; eGFR<30 contraindication drift.

## gap-drug-07 — Acitretin LFT/lipids — AMBER, HIGH
- Sketch: id acitretin-maintenance. match [acitretin, neotigason]; exclude [topical, gel, cream]. Tests: LFT 90d, fasting lipids (lipid profile/cholesterol/lipids/triglyceride, snomed 27171005) 90d. sharedCare true.
- Source: SmPC https://www.medicines.org.uk/emc/product/10291/smpc (LFT every 3 months after initial phase; fasting cholesterol/TG every 3 months); BAD PIL.
- Frequency ~3–8. Impact: hepatotoxicity + severe hypertriglyceridaemia (pancreatitis); specialist reviews 6–12-monthly at best.
- Edge cases: isotretinoin/alitretinoin deliberately NOT added (specialist-only, hospital-dispensed — record exclusion as deliberate); PPP stays in alert library.

## Rejected (with sources): phenytoin (SPS: routine level monitoring NOT recommended; no crisp interval — stays on backstop); long-term oral corticosteroids (same duration blocker, worse FP profile — deferred to same engine gate); dronedarone/hydroxycarbamide/riluzole/tolvaptan/apomorphine/teriparatide (0–2 patients each, specialist-dispensed — watch items).
## Cross-refs: MTX+folic acid = alert-library candidate; clozapine exclusion correct (CPMS/ZTAS); lamotrigine/levetiracetam + ezetimibe/bempedoic acid = no-monitoring-common candidates (currently "unmatched" noise); bisphosphonates no routine bloods; sacubitril/entresto already in ace-arb.
