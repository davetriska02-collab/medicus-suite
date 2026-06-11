// engine/stopp-start.js — STOPP/START v3 implementable-subset engine
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Implements a structured-data-safe subset of STOPP/START v3 (2023).
// Inputs:  { drugs, problems, ageYears, egfr }
//   drugs    — array of {label:string} or strings (suite-wide drug list)
//   problems — array of {name:string} or strings (active + past problems)
//   ageYears — number | null  (age in years; age-gated criteria fail-closed
//               when null/NaN)
//   egfr     — number | null  (latest eGFR in mL/min/1.73m²; eGFR-gated
//               criteria fail-closed when null/NaN)
//
// Each returned flag: { id, kind:'stopp'|'start', criterion, detail,
//                       severity:'red'|'amber', source }
//
// Drug matching: case-insensitive substring (suite-wide convention).
// Generic names cover qualified generics; brands listed where records may
// contain only brand names. Drug class helpers use conservative term lists
// drawn from HIGH_RISK_DRUGS in visualiser-core.js (see comment per class).
//
// Exclusion notes: exclude strings are avoided except where genuinely
// necessary (per CLAUDE.md warning). Each criterion's edge-case handling
// is documented inline.
//
// REQUIRES CLINICAL SAFETY OFFICER VERIFICATION BEFORE CLINICAL RELEASE.

(function (global) {
  'use strict';

  // ── Drug-class term lists ──────────────────────────────────────────────────
  // These mirror the terms in HIGH_RISK_DRUGS (visualiser-core.js) where the
  // loading model does not allow direct reuse. Comments reference the source.

  // NSAIDs — from HIGH_RISK_DRUGS id:'nsaid_long' + common UK brands
  const NSAID_TERMS = [
    'ibuprofen',
    'naproxen',
    'diclofenac',
    'celecoxib',
    'etoricoxib',
    'meloxicam',
    // Common UK brand names that may appear in med lists without generic name:
    'brufen', // ibuprofen
    'nurofen', // ibuprofen (OTC brand; may appear on acute prescription)
    'voltarol', // diclofenac
    'arcoxia', // etoricoxib
    'mobic', // meloxicam
  ];

  // Loop diuretics — subset of HIGH_RISK_DRUGS id:'diuretic'
  const LOOP_DIURETIC_TERMS = ['furosemide', 'frusemide', 'bumetanide'];

  // Benzodiazepines — standard UK generics
  const BENZO_TERMS = [
    'diazepam',
    'lorazepam',
    'temazepam',
    'nitrazepam',
    'chlordiazepoxide',
    'clonazepam',
    'alprazolam',
    'oxazepam',
  ];

  // Z-drugs (non-benzodiazepine hypnotics)
  const ZDRUG_TERMS = [
    'zopiclone',
    'zolpidem',
    'zaleplon',
    // UK brand names:
    'zimovane', // zopiclone
    'stilnoct', // zolpidem
  ];

  // First-generation (sedating) antihistamines
  const FIRSTGEN_AH_TERMS = ['chlorphenamine', 'promethazine', 'hydroxyzine', 'diphenhydramine', 'cyclizine'];

  // PPIs — from HIGH_RISK_DRUGS id:'ppi'
  const PPI_TERMS = ['omeprazole', 'lansoprazole', 'pantoprazole', 'esomeprazole', 'rabeprazole'];

  // Aspirin (low-dose antiplatelet) — from HIGH_RISK_DRUGS id:'aspirin_ap'
  // We match 'aspirin' broadly but exclude compound names that contain aspirin
  // as a component word in a safe context — however, per CLAUDE.md, we keep
  // exclusions minimal. A simple prefix check for low-dose forms:
  const ASPIRIN_TERMS = ['aspirin 75', 'aspirin 300', 'aspirin tablet', 'aspirin dispersible'];

  // Long-acting sulfonylureas (glibenclamide, glimepiride)
  const LONG_SU_TERMS = ['glibenclamide', 'glimepiride'];

  // Statins — from HIGH_RISK_DRUGS id:'statin'
  const STATIN_TERMS = ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin', 'fluvastatin'];

  // ACE inhibitors — from HIGH_RISK_DRUGS id:'acei' (first 5 entries are ACEi)
  const ACEI_TERMS = ['ramipril', 'lisinopril', 'perindopril', 'enalapril', 'captopril'];

  // ARBs — from HIGH_RISK_DRUGS id:'acei' (remaining entries are ARBs)
  const ARB_TERMS = ['candesartan', 'losartan', 'irbesartan', 'valsartan', 'olmesartan'];

  // Beta-blockers — from HIGH_RISK_DRUGS id:'beta_block'
  const BETA_BLOCKER_TERMS = [
    'atenolol',
    'bisoprolol',
    'propranolol',
    'metoprolol',
    'carvedilol',
    'sotalol',
    'nebivolol',
    'labetalol',
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Normalise a drug to a searchable lowercase string
  function drugName(d) {
    if (typeof d === 'string') return d.toLowerCase();
    return ((d && d.label) || '').toLowerCase();
  }

  // Normalise a problem to a searchable lowercase string
  function problemName(p) {
    if (typeof p === 'string') return p.toLowerCase();
    return ((p && p.name) || '').toLowerCase();
  }

  // True if any drug in the list matches any of the given terms
  function hasDrug(drugs, terms) {
    return drugs.some((d) => {
      const n = drugName(d);
      return terms.some((t) => n.includes(t));
    });
  }

  // True if any problem matches any of the given terms
  function hasProblem(problems, terms) {
    return problems.some((p) => {
      const n = problemName(p);
      return terms.some((t) => n.includes(t));
    });
  }

  // ── Problem term lists ─────────────────────────────────────────────────────

  // Cardiovascular/cerebrovascular disease (for aspirin primary-prevention check)
  const CV_DISEASE_TERMS = [
    'coronary',
    'ischaemic heart',
    'ischemic heart',
    'myocardial infarction',
    ' mi ',
    'angina',
    'heart failure',
    'atrial fibrillation',
    'stroke',
    'tia',
    'transient ischaemic',
    'peripheral arterial',
    'peripheral vascular',
    'carotid',
    'aortic',
    'cardiac arrest',
    'revascularisation',
    'revascularization',
    'stent',
    'cabg',
    'bypass',
  ];

  // Coronary / ischaemic heart disease (for statin START)
  const IHD_TERMS = [
    'coronary artery disease',
    'ischaemic heart disease',
    'ischemic heart disease',
    'myocardial infarction',
    'angina',
    'stemi',
    'nstemi',
    'acute coronary',
    'unstable angina',
    'stable angina',
    'cabg',
    'percutaneous coronary',
    'coronary stent',
  ];

  // Diabetes
  const DIABETES_TERMS = [
    'type 2 diabetes',
    'type 1 diabetes',
    'diabetes mellitus',
    'insulin-dependent diabetes',
    'non-insulin-dependent diabetes',
    'diabetic',
    't2dm',
    't1dm',
  ];

  // CKD
  const CKD_TERMS = [
    'chronic kidney disease',
    'ckd',
    'renal failure',
    'renal impairment',
    'nephropathy',
    'end stage renal',
  ];

  // Myocardial infarction (for beta-blocker START)
  const MI_TERMS = ['myocardial infarction', 'mi ', ' mi\b', 'stemi', 'nstemi', 'heart attack'];

  // Digoxin
  const DIGOXIN_TERMS = ['digoxin'];

  // Metformin
  const METFORMIN_TERMS = ['metformin'];

  // ── Main function ─────────────────────────────────────────────────────────

  /**
   * Compute STOPP/START v3 flags from a structured patient snapshot.
   *
   * @param {{ drugs: Array, problems: Array, ageYears: number|null, egfr: number|null }} opts
   * @returns {Array<{ id:string, kind:'stopp'|'start', criterion:string, detail:string, severity:'red'|'amber', source:string }>}
   */
  function computeStoppStart({ drugs = [], problems = [], ageYears = null, egfr = null }) {
    const flags = [];

    const age = typeof ageYears === 'number' && isFinite(ageYears) ? ageYears : null;
    const gfr = typeof egfr === 'number' && isFinite(egfr) ? egfr : null;
    const ageKnown = age !== null;
    const gfrKnown = gfr !== null;

    // ── STOPP ─────────────────────────────────────────────────────────────────

    // STOPP 1: NSAID with eGFR <50 (red)
    // Fail-closed: no flag if eGFR unknown.
    if (hasDrug(drugs, NSAID_TERMS) && gfrKnown && gfr < 50) {
      flags.push({
        id: 'stopp_nsaid_ckd',
        kind: 'stopp',
        criterion: 'NSAID with eGFR <50 mL/min/1.73m²',
        detail:
          `NSAID detected; latest eGFR ${gfr.toFixed(0)} mL/min/1.73m². NSAIDs reduce renal perfusion ` +
          'and are potentially inappropriate in moderate-to-severe CKD (eGFR <50). ' +
          'Risk of AKI, hyperkalaemia, and accelerated GFR decline.',
        severity: 'red',
        source: 'STOPP/START v3 (2023) — Section H: Renal',
      });
    }

    // STOPP 2: NSAID + loop diuretic (amber)
    if (hasDrug(drugs, NSAID_TERMS) && hasDrug(drugs, LOOP_DIURETIC_TERMS)) {
      flags.push({
        id: 'stopp_nsaid_loop',
        kind: 'stopp',
        criterion: 'NSAID co-prescribed with loop diuretic',
        detail:
          'NSAID + loop diuretic combination: NSAIDs antagonise the natriuretic effect of diuretics and ' +
          'increase risk of AKI, fluid retention, and cardiac decompensation. Review NSAID indication.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section H: Renal',
      });
    }

    // STOPP 3: First-generation antihistamine in age ≥65 (amber)
    // Fail-closed: if age unknown, flag does NOT fire.
    if (hasDrug(drugs, FIRSTGEN_AH_TERMS) && ageKnown && age >= 65) {
      // Identify which antihistamine matched for the detail text
      const matched = FIRSTGEN_AH_TERMS.find((t) => drugs.some((d) => drugName(d).includes(t)));
      flags.push({
        id: 'stopp_firstgen_ah_elderly',
        kind: 'stopp',
        criterion: 'First-generation antihistamine in patient aged ≥65',
        detail:
          `Sedating antihistamine (${matched || 'first-generation'}) detected in patient aged ` +
          `${Math.floor(age)}y. First-generation antihistamines have significant anticholinergic ` +
          'activity and cause sedation, falls, urinary retention, and cognitive impairment in older adults. ' +
          'Prefer a non-sedating alternative (cetirizine, loratadine) if an antihistamine is required.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section D: CNS/Psychotropic',
      });
    }

    // STOPP 4: Benzodiazepine in age ≥65 (amber)
    // Duration unknowable from a snapshot — caveat included in detail.
    // Fail-closed: if age unknown, flag does NOT fire.
    if (hasDrug(drugs, BENZO_TERMS) && ageKnown && age >= 65) {
      const matched = BENZO_TERMS.find((t) => drugs.some((d) => drugName(d).includes(t)));
      flags.push({
        id: 'stopp_benzo_elderly',
        kind: 'stopp',
        criterion: 'Benzodiazepine in patient aged ≥65',
        detail:
          `Benzodiazepine (${matched || 'benzodiazepine'}) detected in patient aged ${Math.floor(age)}y. ` +
          'In older adults, benzodiazepines increase risk of falls, fractures, motor vehicle accidents, ' +
          'and cognitive impairment. Review duration: ≥2 weeks for insomnia is potentially inappropriate. ' +
          'Note: duration cannot be determined from this point-in-time snapshot — verify against the live record.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section D: CNS/Psychotropic',
      });
    }

    // STOPP 5: Z-drug in age ≥65 (amber)
    // Same duration caveat.
    // Fail-closed: if age unknown, flag does NOT fire.
    if (hasDrug(drugs, ZDRUG_TERMS) && ageKnown && age >= 65) {
      const matched = ZDRUG_TERMS.find((t) => drugs.some((d) => drugName(d).includes(t)));
      flags.push({
        id: 'stopp_zdrug_elderly',
        kind: 'stopp',
        criterion: 'Z-drug (non-benzodiazepine hypnotic) in patient aged ≥65',
        detail:
          `Z-drug (${matched || 'zopiclone/zolpidem'}) detected in patient aged ${Math.floor(age)}y. ` +
          'Z-drugs have similar adverse effects to benzodiazepines in older adults (falls, cognitive impairment). ' +
          'Review duration: ≥2 weeks for sleep is potentially inappropriate. ' +
          'Duration cannot be determined from this point-in-time snapshot — verify against the live record.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section D: CNS/Psychotropic',
      });
    }

    // STOPP 6: Digoxin with eGFR <30 (red)
    // Fail-closed: if eGFR unknown, flag does NOT fire.
    if (hasDrug(drugs, DIGOXIN_TERMS) && gfrKnown && gfr < 30) {
      flags.push({
        id: 'stopp_digoxin_gfr30',
        kind: 'stopp',
        criterion: 'Digoxin with eGFR <30 mL/min/1.73m²',
        detail:
          `Digoxin detected; latest eGFR ${gfr.toFixed(0)} mL/min/1.73m². Digoxin is renally cleared; ` +
          'accumulation at eGFR <30 risks toxicity (arrhythmia, bradycardia, nausea, confusion). ' +
          'Review dose — therapeutic drug monitoring is essential.',
        severity: 'red',
        source: 'STOPP/START v3 (2023) — Section H: Renal',
      });
    }

    // STOPP 7: Metformin with eGFR <30 (red)
    // Fail-closed: if eGFR unknown, flag does NOT fire.
    if (hasDrug(drugs, METFORMIN_TERMS) && gfrKnown && gfr < 30) {
      flags.push({
        id: 'stopp_metformin_gfr30',
        kind: 'stopp',
        criterion: 'Metformin with eGFR <30 mL/min/1.73m²',
        detail:
          `Metformin detected; latest eGFR ${gfr.toFixed(0)} mL/min/1.73m². Metformin is contraindicated ` +
          'at eGFR <30 (risk of lactic acidosis). Refer to NICE NG28 / BNF: reduce dose at eGFR 30–45, ' +
          'withhold at eGFR <30.',
        severity: 'red',
        source: 'STOPP/START v3 (2023) — Section H: Renal',
      });
    }

    // STOPP 8: PPI present — review indication and duration (amber)
    // Conservative: flags presence only. Cannot assess indication from snapshot.
    if (hasDrug(drugs, PPI_TERMS)) {
      flags.push({
        id: 'stopp_ppi_review',
        kind: 'stopp',
        criterion: 'Proton pump inhibitor — review indication and duration',
        detail:
          'PPI detected. Review indication and duration: >8 weeks of PPI without an ongoing clear indication ' +
          "(e.g. Barrett's oesophagus, active ulcer, NSAID/antiplatelet + GI risk factor) is potentially " +
          'inappropriate. Long-term PPI use is associated with hypomagnesaemia, C. difficile, fractures, and ' +
          'B12 deficiency. Duration cannot be determined from this snapshot — verify against the live record.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section F: GI',
      });
    }

    // STOPP 9: Aspirin with no cardiovascular/cerebrovascular disease problem
    //          (primary prevention — amber)
    // Approach: if aspirin is present AND no CV/cerebrovascular disease found
    // in the problem list, flag as possible primary prevention.
    // Conservative: the terms list for CV disease is broad to minimise
    // false positives. If the problem list contains any CV term, no flag.
    if (hasDrug(drugs, ASPIRIN_TERMS) && !hasProblem(problems, CV_DISEASE_TERMS)) {
      flags.push({
        id: 'stopp_aspirin_primary_prev',
        kind: 'stopp',
        criterion: 'Aspirin without documented cardiovascular/cerebrovascular disease',
        detail:
          'Low-dose aspirin detected without a coded cardiovascular or cerebrovascular disease indication. ' +
          'Aspirin for primary prevention is not recommended (NICE NG204, ESC 2021): bleeding risk exceeds ' +
          'benefit in patients without established CV disease. If aspirin is genuinely indicated (e.g. ACS ' +
          'within last 12 months not yet coded), review the problem list for completeness.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section I: Cardiovascular',
      });
    }

    // STOPP 10: Long-acting sulfonylurea in age ≥65 (amber)
    // Fail-closed: if age unknown, flag does NOT fire.
    if (hasDrug(drugs, LONG_SU_TERMS) && ageKnown && age >= 65) {
      const matched = LONG_SU_TERMS.find((t) => drugs.some((d) => drugName(d).includes(t)));
      flags.push({
        id: 'stopp_long_su_elderly',
        kind: 'stopp',
        criterion: 'Long-acting sulfonylurea in patient aged ≥65',
        detail:
          `Long-acting sulfonylurea (${matched || 'glibenclamide/glimepiride'}) detected in patient aged ` +
          `${Math.floor(age)}y. Long-acting sulfonylureas carry sustained hypoglycaemia risk in older adults ` +
          '(impaired counter-regulation, reduced food intake, renal clearance decline). ' +
          'Prefer a shorter-acting agent (gliclazide) or alternative class.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — Section J: Endocrine',
      });
    }

    // ── START ─────────────────────────────────────────────────────────────────

    // START 11: Coronary/IHD present AND no statin (amber)
    if (hasProblem(problems, IHD_TERMS) && !hasDrug(drugs, STATIN_TERMS)) {
      flags.push({
        id: 'start_statin_ihd',
        kind: 'start',
        criterion: 'Consider statin in established coronary/ischaemic heart disease',
        detail:
          'Coronary or ischaemic heart disease problem coded but no statin detected. ' +
          'Statins reduce mortality and major cardiovascular events in established IHD (NICE CG181). ' +
          'Check whether statin therapy was declined, not tolerated, or is prescribed elsewhere.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — START Section A: Cardiovascular',
      });
    }

    // START 12: Diabetes + CKD (or eGFR <60) AND no ACEi/ARB (amber)
    // Fail-closed on eGFR gate: fires if CKD problem present OR eGFR <60.
    // Does not fire if neither CKD problem nor eGFR available.
    const hasDiabetes = hasProblem(problems, DIABETES_TERMS);
    const hasCkdProblem = hasProblem(problems, CKD_TERMS);
    const gfrBelow60 = gfrKnown && gfr < 60;
    const hasAceiOrArb = hasDrug(drugs, ACEI_TERMS) || hasDrug(drugs, ARB_TERMS);

    if (hasDiabetes && (hasCkdProblem || gfrBelow60) && !hasAceiOrArb) {
      const gfrNote = gfrKnown ? ` (latest eGFR ${gfr.toFixed(0)})` : '';
      flags.push({
        id: 'start_acei_arb_dm_ckd',
        kind: 'start',
        criterion: 'Consider ACE inhibitor or ARB in diabetes with CKD',
        detail:
          `Diabetes coded with CKD${gfrNote} but no ACE inhibitor or ARB detected. ` +
          'ACEi/ARB reduces the rate of progression to end-stage renal disease in diabetic nephropathy ' +
          '(NICE NG28). Check for contraindication or intolerance.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — START Section A: Cardiovascular',
      });
    }

    // START 13: Myocardial infarction AND no beta-blocker (amber)
    if (hasProblem(problems, MI_TERMS) && !hasDrug(drugs, BETA_BLOCKER_TERMS)) {
      flags.push({
        id: 'start_bb_post_mi',
        kind: 'start',
        criterion: 'Consider beta-blocker following myocardial infarction',
        detail:
          'Myocardial infarction problem coded but no beta-blocker detected. ' +
          'Beta-blockers reduce mortality post-MI (NICE CG172 / ESC guidelines). ' +
          'If not prescribed, check for contraindication (asthma, severe bradycardia, cardiogenic shock) ' +
          'or whether it was discontinued.',
        severity: 'amber',
        source: 'STOPP/START v3 (2023) — START Section A: Cardiovascular',
      });
    }

    return flags;
  }

  // ── Module export (dual-mode: Node require OR browser global) ──────────────
  const api = { computeStoppStart };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.StoppStart = api;
  }
})(typeof window !== 'undefined' ? window : global);
