# Vaccines gap scan result (sources fetched; engine semantics verified incl. 2026-08-01 ageMin/ageMax fix on problem/medication clauses, and season-without-endMonth = year-round calendar-year lookback)

## gap-vax-01 — Pneumococcal PCV20 clinical risk groups 2–64 — RED, HIGH confidence ★top rank
- Current rule covers only 65+/homeless 16+; file notes record under-65 at-risk cohort "intentionally not encoded". Asplenics under 65 invisible (OPSI mortality up to 50%).
- Source: Green Book ch 25 Table 25.2 (12 Jun 2025 version) https://assets.publishing.service.gov.uk/media/684b1fbc1c8d5c94e201abae/Green_Book__Chapter_25_pneumococcal_12_6_25.pdf ; PCV20 replaced PPV23 late 2025/early 2026.
- Sketch: new rule vax-pneumo-risk-u65, schedule once, anyOf: problem [asplenia, splenectomy, hyposplenism, splenic dysfunction, sickle cell, thalassaemia major, hereditary spherocytosis] age 2–64; register [DM,CKD,COPD,CHD,HF]; problem [bronchiectasis, cystic fibrosis, interstitial lung, pulmonary fibrosis, pneumoconiosis, cerebral palsy, cirrhosis, biliary atresia, chronic hepatitis, nephrotic syndrome, cochlear implant, csf leak, complement deficiency/disorder, hiv, aids, transplant, leukaemia, lymphoma, myeloma, primary immunodeficiency] 2–64; medication [rituximab, azathioprine, ciclosporin, mycophenolate, tacrolimus, sirolimus, methotrexate, cyclophosphamide, chemotherapy, prednisolone, dexamethasone] 2–64. Reuse ppv23 statusTerms.
- Frequency ~450–650 eligible; ~250–400 flag due. VERIFY: register clause handler applies NO age gating (rules-engine.js 2348–2368) — must patch engine (mirror 2026-08-01 fix) or use problem-kind substitutes, else 65+ double-fire.
- Edge cases: DM register incl. diet-only (not eligible — mild over-flag); pred/dex no dose check (GB threshold ≥20mg/d >1mo); childhood PCV13 records could false-GIVEN via generic "pneumococcal conjugate vaccin" given-term — drop generic conjugate terms from this rule's given list; under-2s excluded (separate schedule).

## gap-vax-02 — Shingles Shingrix severely immunosuppressed 18+ — RED, HIGH ★stale-blocker finding
- File's note "engine cannot combine age + clinical criteria in one clause" is STALE — invalidated by 2026-08-01 engine fix recorded in the same file's specVersion. Immunosuppressed 18–64 AND 80+ (no upper limit) invisible.
- Source: NHSE/UKHSA letter 22 Jul 2025, effective 1 Sep 2025: https://www.gov.uk/government/publications/expansion-of-shingrix-vaccine-eligibility-to-all-those-who-are-severely-immunosuppressed-and-aged-18-years-and-over-letter/... ; Vaccine Update 363.
- Sketch: vax-shingles-immuno, schedule once, anyOf: problem [transplant, stem cell, bone marrow, leukaemia/leukemia, lymphoma, myeloma, primary immunodeficiency, scid, hiv, aids] ageMin 18; medication [rituximab, alemtuzumab, ofatumumab, ciclosporin, mycophenolate, tacrolimus, azathioprine, cyclophosphamide, chemotherapy, ibrutinib, venetoclax] ageMin 18. Terms deliberately CONSERVATIVE (severely immunosuppressed per GB 28a — no methotrexate/low-dose steroids).
- Frequency: ~75–110 severely immunosuppressed; ~60–90 outside existing bands; ~40–70 flag.
- Edge cases: 65–79 overlap double-chip (resolves on vaccination); Zostavax-then-immunosuppression needs Shingrix but reused given-terms incl. zostavax → false-GIVEN — consider dropping zostavax from this rule's given list; correct the stale sentence in vax-shingles notes in same change.

## gap-vax-03 — Pertussis in pregnancy (from 16wk, every pregnancy) — AMBER, MEDIUM ★workaround unlocks deliberate omission
- Omission reason (lifetime lookback can't distinguish prior-pregnancy doses) correct for schedule:once but season {startMonth:1, startDay:1} with NO endMonth = year-round + calendar-year lookback (seasonEnd() null, rules-engine.js 2443–2449). Failure bias flips to false-DUE (fail-safe).
- Source: UKHSA pertussis-in-pregnancy HCP page (GB ch24, updated Jun 2025) https://www.gov.uk/government/publications/vaccination-against-pertussis-whooping-cough-for-pregnant-women/... ; GB ch11 (30 Mar 2026) Table 4 "from week 16 of every pregnancy".
- Sketch: vax-pertussis-preg, season Jan 1 no end, problem ["pregnan"] sex F age 12–55 (mirrors proven flu clause). Given terms: pertussis vaccination, whooping cough vaccin, boostrix, adacel, repevax, tdap, dtap/ipv in pregnancy. Chip label must instruct "offer from 16 weeks — confirm gestation".
- Frequency: ~100–120 pregnancies/yr; ~15–25 actionable at any time. Impact: maternal vax ~90% effective vs infant pertussis death (2024 resurgence deaths in babies of unvaccinated mothers).
- Edge cases: false DUE for winter-spanning pregnancy (fail-safe); false GIVEN if two pregnancies ≥16wk with doses same calendar year (rare, C2-class residual); fires from conception; stale pregnancy codes persist chip; maternity-service doses may be uncoded → over-flag. CSO sign-off required.

## gap-vax-04 — RSV in pregnancy (from 28wk, Abrysvo) — AMBER, MEDIUM
- Same mechanism as vax-03, cleaner (≤12wk dose-to-delivery). Programme 1 Sep 2024, year-round.
- Source: https://www.gov.uk/government/publications/respiratory-syncytial-virus-rsv-programme-information-for-healthcare-professionals/rsv-vaccination-of-pregnant-women-for-infant-protection-information-for-healthcare-practitioners ; GB ch11 Table 4.
- Sketch: vax-rsv-preg, vaccine key "rsv-maternal" (distinct from older-adult vax-rsv), season Jan 1, problem ["pregnan"] F 12–55. Given: [respiratory syncytial virus vaccin, rsv vaccination, rsv vaccine, abrysvo] — Abrysvo ONLY (Arexvy/mRESVIA deliberately absent).
- Impact: cuts infant RSV hospitalisation ~70%. ~10–12 actionable at any time.
- LINKED LATENT DEFECT: existing vax-rsv lifetime lookback + abrysvo given-term means a maternal dose will falsely satisfy the older-adult rule decades later — log for CSO (cohort/logic edit out of scope).

## gap-vax-05 — MMR catch-up age 1–11 zero-dose — AMBER, MEDIUM ★time-sensitive
- 2026/27 national catch-up campaign IS MMR/V (Jun 2026–Mar 2027, contractual under-6 call/recall); England lost WHO measles elimination Jan 2026; 953 confirmed cases + 3 deaths Jan–Aug 2026; South East active (24% of recent cases).
- Source: https://www.england.nhs.uk/long-read/confirmation-national-vaccines-immunisations-catch-up-campaign-2026-27/ ; UKHSA epi 2026-08.
- Sketch: vax-mmr-catchup, schedule once, age 1–11 clause only. Given: [mmr vaccination, mmr vaccine, measles mumps rubella, mmrv, priorix, mmrvaxpro, vaxpro, proquad, measles vaccination, measles vaccine given]. Zero-dose flag ONLY — cannot count doses; 1-of-2-dose children not flagged (documented limitation).
- Frequency: ~1,250–1,350 aged 1–11; ~60–90 zero-dose flagged. MMRV routing for children born ≥1 Jan 2020.
- Edge cases: in-movers/vaccinated abroad over-flag (aligned with NHSE new-registrant guidance); adults in-policy but deliberately excluded (pre-digital records → false-positive flood); under-1s excluded.

## Dismissed: Td/IPV boosters (dose counting), hep B risk groups (under-coded behavioural risk + serology), childhood schedule status (CHIS territory, no dose arithmetic).
