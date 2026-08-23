# QOF gap scan result (verified against PRN02356 2026/27 incl. July 2026 update — both fetched in full)

Headlines:
- CAN/EP/RA/OST/PC/DEP retired 2025/26, absent from 2026/27 — NOT gaps (verified both years' PDFs).
- Genuine gaps: SMI/MH suite beyond MH011, BP002, CS005/006, VI indicators (~101 pts total; ~36 pts expressible now).
- NDH003 noted, NOT proposed (held): NDH002 retired→NDH003, now 20 pts, 50–90%, cohort incl. previous gestational diabetes.
- DRIFT flag (pass to drift scanner): July 2026 PRN02356 renames AST007→AST015, AST012→AST014 (thresholds unchanged); file has old IDs. File header's "July amendment unread" note can be cleared.

## gap-qof-01 — SMI physical-health suite MH003 (BP, 3pts 50-90%), MH006 (BMI, 3pts), MH007 (alcohol, 3pts), MH012 (glucose/HbA1c, 7pts; diabetes excluded) — GREEN, HIGH confidence
- Source: PRN02356 July 2026 update §2.1 + §3.12; NICE IND84/IND83/IND82/IND159. URL: https://www.england.nhs.uk/wp-content/uploads/2026/03/prn02356-quality-outcomes-framework-guidance-2026-27-july-update.pdf (effective 1 Apr 2026)
- Evidence: full wordings/points/thresholds read from fetched PDF text; "Patients who have a diagnosis of diabetes will be excluded from MH012". Unchanged from 25/26.
- Frequency: SMI prevalence ~1.0% → ~110–115 patients; MH012 denominator ~95.
- Impact: SMI 15–20yr mortality gap, CVD-driven; MH011-lipids-only encoding gives false "done" sense.
- Feasibility: HIGH — identical to shipped qof-mh011-lipid (observation-recent on SMI register). MH012 exclusion via excludeIfProblem.
- Sketches (observation-recent, withinDays 365, requiresRegister SMI):
  - qof-mh003: obs ["blood pressure","bp"], thresholds 50-90, points 3
  - qof-mh006: obs ["bmi","body mass index"], 50-90, 3
  - qof-mh007: obs ["alcohol consumption","alcohol intake","alcohol units","audit-c","audit c score"], 50-90, 3
  - qof-mh012: obs ["hba1c","haemoglobin a1c","blood glucose","fasting glucose","plasma glucose"], excludeIfProblem ["type 1 diabetes","type 2 diabetes","diabetes mellitus"], 50-90, 7
- Edge cases: MH012 exclusion must NOT be bare "diabetes" (diabetes insipidus/gestational); verify negation handling applies to excludeIfProblem; MH011's 12-vs-24-month split does NOT apply to these four (flat 12m); alcohol often questionnaire-coded (AUDIT-C) — validate term list vs real Medicus labels before enabling MH007; Sentinel SMI register doesn't exclude "in remission".

## gap-qof-02 — MH002 comprehensive care plan in SMI (5 pts, 40-90%) — GREEN, HIGH
- Source: PRN02356 July 2026 §3.12; NICE IND143. Same URL.
- Sketch: qof-mh002 observation-recent obs ["mental health care plan","comprehensive care plan","care programme approach","cpa review","smi care plan","mental health review"], withinDays 365, thresholds 40-90, points 5.
- Feasibility HIGH — structurally identical to qof-dem004. Cannot verify plan content, only presence of code (same caveat as DEM004/AST007).
- Edge cases: care-plan coding varies (CPA being phased out); secondary-care plan letters filed as documents don't surface as coded observations — under-detection likely; chip should prompt, not assert absence.

## gap-qof-03 — BP002: BP recorded in preceding 5 years, all patients 45+ (15 pts, 50-90%) — AMBER; HIGH on facts, MEDIUM on expressibility
- Source: PRN02356 July 2026 §4 public health; NICE IND112. Unchanged from 25/26.
- Sketch: qof-bp002, requiresRegister null, ageRange {min:45}, observation-recent ["blood pressure","bp"], withinDays 1825, rolling window (useQofYearFloor:false), thresholds 50-90, points 15.
- Frequency: ~4,800–5,300 patients 45+ (Surrey skews older); chip fires only on unmeasured long tail.
- Feasibility: check trivial; register-less cohort is the question. BP002's gate is pure ageRange (supported field) unlike SMOK004 — verify engine accepts null register before enabling; if not, BP002+SMOK004 (27 pts) justify the engine extension.
- Edge cases: requiresRegister:null behaviour unverified — may silently never fire (SMOK004 failure mode), MUST test; home/ambulatory BP labels must match; must use rolling 1825d NOT QOF-year floor; PCAs don't generally apply to BP002 (favourable).

## gap-qof-04 — CS005/CS006 cervical screening (7 pts 25-49 within 3.5y; 4 pts 50-64 within 5.5y; both 45-80%) — AMBER; HIGH facts, MEDIUM data-path
- Source: PRN02356 July 2026 §5 additional services.
- Sketches: sex "female"; CS005 ageRange 25-49 withinDays 1277; CS006 50-64 withinDays 2008; obs ["cervical screening","cervical smear","smear test","cervical cytology","hpv screening","hpv test"].
- Frequency: ~2,800–3,000 eligible; national coverage ~69% → ~900 flagged at any time.
- Feasibility: sex/ageRange supported; HONEST DEPENDENCY — smear/HPV results must surface as observations in Medicus journal endpoint (may be lab-filed/CSMS docs); false "unscreened" chip worse than none. Also register-less cohort question.
- Edge cases: add excludeIfProblem ["hysterectomy"] (total hysterectomy = permanently ineligible); QOF 26/27 still 3.5y for CS005 despite NHSCSP 5-yearly HPV-primary move — encode QOF window; trans men with cervix registered male missed (same as official rules); PCAs/declines invisible — keep amber, never red.

## gap-qof-05 — VI004 shingles vaccination QOF indicator (10 pts, 50-60%) — AMBER, HIGH
- Source: PRN02356 July 2026 §4.3; NICE IND219.
- Sketch: qof-vi004 ageRange 70-79, observation-recent ["shingles vaccination","shingles vaccine","herpes zoster vaccin","shingrix","zostavax","zoster vaccination"], withinDays 3650, thresholds 50-60, points 10.
- True cohort ("reached 80 in preceding 12m, vaccinated 70-79") needs age-at-event logic — not expressible; sketch flags current 70-79s without vaccine code (prompt while actionable).
- Edge cases: DUPLICATION with vax-shingles clinical chip — decide extend-tooltip vs second chip before enabling; Shingrix 2-dose course, any-code over-credits; vaccinated-at-65-69 nuance inexpressible; label as prompt, not claim verifier.

## gap-qof-06 — VI001-003 childhood imms (54 pts; MMRV added + NEW improvement thresholds 26/27) — RED (expressibility LOW)
- Source: PRN02356 July 2026 §4.3 + improvement-payments section (VI001 18%pts / VI002 23 / VI003 30 max bands); NHS England GP-contract long-read https://www.england.nhs.uk/long-read/changes-to-the-gp-contract-in-2026-27/; NICE IND215/216/217.
- All three need age-at-event dose-counting — not expressible. At most ship DISABLED qof-vi002 approximation (age 1-2, no MMR/MMRV code; obs ["mmr vaccination","mmr vaccine","measles mumps rubella","mmrv","priorix","vaxpro"], withinDays 730, thresholds 86-96, 18 pts).
- Frequency ~100–125 children/cohort-year; 54 pts combined.
- Edge cases: vaccinations elsewhere arrive late/as documents — false "unvaccinated" flags with parents present are costly; PCAs invisible; improvement-threshold math inexpressible; if rejected, record VI001-003 as deliberate "not expressible" hold like OB004/OB005.

Ranked: 1–2 SMI/MH suite (copy MH011 pattern, zero engine risk; anomalous MH011 was encoded alone). 3 BP002 (15 pts, trivial check, register-less question). 4 CS005/006 (data-path dependency). 5 VI004 (may be redundant with vax-shingles). 6 VI001-003 (mostly hold).
