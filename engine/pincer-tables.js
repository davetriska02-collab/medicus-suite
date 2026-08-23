// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — PINCER / high-risk drug tables (single source)
//
// HIGH_RISK_DRUGS drives visualiser computePINCER / computeDrugMonitoring.
// evaluatePrescribingFlags is the triage-HUD regex implementation.
// The two evaluators stay separate (different matching models + pinned
// KD-18..21 LMWH divergence); the TABLES live here so a term cannot be
// added on one surface and forgotten on the other.
// No-value-change extract — flagged to CSO as a location refactor only.

'use strict';

(function (global) {
  const HIGH_RISK_DRUGS = [
    {
      id: 'methotrexate',
      label: 'Methotrexate',
      terms: ['methotrexate'],
      requires: [
        'fbc',
        'full blood count',
        'u&e',
        'urea & electrolytes',
        'urea and electrolytes',
        'liver function',
        'lft',
      ],
      interval: 91,
    },
    {
      id: 'azathioprine',
      label: 'Azathioprine',
      terms: ['azathioprine'],
      requires: ['fbc', 'full blood count', 'liver function', 'lft'],
      interval: 91,
    },
    {
      id: 'lithium',
      label: 'Lithium',
      terms: ['lithium'],
      requires: ['lithium level', 'u&e', 'tsh', 'thyroid'],
      interval: 91,
    },
    {
      id: 'amiodarone',
      label: 'Amiodarone',
      terms: ['amiodarone'],
      requires: ['tsh', 'thyroid', 'lft', 'liver function'],
      interval: 183,
    },
    {
      id: 'warfarin',
      label: 'Warfarin / VKA',
      // All UK oral vitamin-K antagonists share INR monitoring (BNF 2.8.2;
      // acenocoumarol/phenindione emc-corroborated, 2026-06-11 Keeper run).
      terms: ['warfarin', 'acenocoumarol', 'phenindione'],
      requires: ['inr', 'u&e'],
      interval: 42,
    },
    {
      id: 'doac',
      label: 'DOAC',
      terms: ['rivaroxaban', 'apixaban', 'dabigatran', 'edoxaban'],
      requires: ['u&e', 'urea', 'creatinine', 'egfr', 'fbc'],
      interval: 365,
    },
    {
      id: 'acei',
      label: 'ACEi / ARB',
      // Complete UK ACEi/ARB set (2026-06-11 Keeper, parity with the triage-lens
      // ACEI_ARB regex; quinapril/imidapril/eprosartan/cilazapril emc-corroborated
      // that run, the rest are BNF staples already shipped in content.js).
      terms: [
        'ramipril',
        'lisinopril',
        'perindopril',
        'enalapril',
        'captopril',
        'trandolapril',
        'fosinopril',
        'quinapril',
        'imidapril',
        'cilazapril',
        'candesartan',
        'losartan',
        'irbesartan',
        'valsartan',
        'olmesartan',
        'telmisartan',
        'azilsartan',
        'eprosartan',
      ],
      requires: ['u&e', 'urea', 'creatinine', 'egfr'],
      interval: 365,
    },
    {
      id: 'diuretic',
      label: 'Loop / thiazide diuretic',
      // Parity with content.js DIURETIC regex (torasemide/hydrochlorothiazide/
      // metolazone already shipped there and in the loop-diuretic drug rules).
      terms: [
        'furosemide',
        'frusemide',
        'bumetanide',
        'torasemide',
        'indapamide',
        'bendroflumethiazide',
        'hydrochlorothiazide',
        'chlortalidone',
        'chlorthalidone',
        'metolazone',
      ],
      requires: ['u&e', 'urea', 'creatinine', 'egfr', 'sodium', 'potassium'],
      interval: 365,
    },
    {
      id: 'nsaid_long',
      label: 'Long-term NSAID',
      // Complete UK systemic NSAID set (2026-06-11 Keeper, parity with the
      // triage-lens prescribing flags; emc/BNF-corroborated 2026-06-11 run).
      // NOTE: matching here is \b-bounded, so derivatives and spelling variants
      // must be listed explicitly (dexibuprofen, dexketoprofen, indometacin).
      terms: [
        'ibuprofen',
        'dexibuprofen',
        'naproxen',
        'diclofenac',
        'aceclofenac',
        'celecoxib',
        'etoricoxib',
        'meloxicam',
        'piroxicam',
        'tenoxicam',
        'indometacin',
        'indomethacin',
        'sulindac',
        'ketoprofen',
        'dexketoprofen',
        'tiaprofenic acid',
        'mefenamic acid',
        'tolfenamic acid',
        'fenoprofen',
        'nabumetone',
        'etodolac',
        'flurbiprofen',
      ],
      requires: ['u&e', 'urea', 'creatinine', 'egfr'],
      interval: 365,
    },
    {
      id: 'statin',
      label: 'Statin',
      terms: ['atorvastatin', 'simvastatin', 'rosuvastatin', 'pravastatin', 'fluvastatin', 'pitavastatin'],
      requires: ['lft', 'liver function', 'cholesterol'],
      interval: 365,
    },
    {
      id: 'digoxin',
      label: 'Digoxin',
      terms: ['digoxin'],
      requires: ['u&e', 'urea', 'potassium', 'creatinine'],
      interval: 365,
    },
    {
      id: 'thyroxine',
      label: 'Levothyroxine',
      terms: ['levothyroxine', 'liothyronine'],
      requires: ['tsh', 'thyroid'],
      interval: 365,
    },
    { id: 'metformin', label: 'Metformin', terms: ['metformin'], requires: ['u&e', 'egfr', 'creatinine'], interval: 365 },
    {
      id: 'opioid_str',
      label: 'Strong opioid',
      terms: ['morphine', 'oxycodone', 'fentanyl patch', 'buprenorphine', 'tapentadol'],
      requires: [],
      interval: 0,
    },
    {
      id: 'beta_block',
      label: 'Beta-blocker',
      terms: [
        'atenolol',
        'bisoprolol',
        'propranolol',
        'metoprolol',
        'carvedilol',
        'sotalol',
        'nebivolol',
        'labetalol',
        'acebutolol',
        'celiprolol',
        'nadolol',
        'oxprenolol',
      ],
      requires: [],
      interval: 0,
    },
    {
      id: 'ppi',
      label: 'PPI',
      terms: ['omeprazole', 'lansoprazole', 'pantoprazole', 'esomeprazole', 'rabeprazole'],
      requires: [],
      interval: 0,
    },
    // H2-blockers: extend gastroprotection detection (famotidine, cimetidine, nizatidine, ranitidine)
    {
      id: 'h2blocker',
      label: 'H2-blocker',
      terms: ['famotidine', 'cimetidine', 'nizatidine', 'ranitidine'],
      requires: [],
      interval: 0,
    },
    // Antiplatelet (non-aspirin): clopidogrel, prasugrel, ticagrelor, dipyridamole
    {
      id: 'antiplatelet',
      label: 'Antiplatelet',
      terms: ['clopidogrel', 'prasugrel', 'ticagrelor', 'dipyridamole'],
      requires: [],
      interval: 0,
    },
    // Aspirin (low-dose, antiplatelet indication): matched separately from NSAID
    {
      id: 'aspirin_ap',
      label: 'Aspirin (antiplatelet)',
      terms: [
        'aspirin 75',
        'aspirin 300',
        'aspirin tablet',
        'aspirin dispersible', // 2026-07-11 Keeper: dm+d form name may appear without dose
        'aspirin gastro', // 2026-07-11 Keeper: gastro-resistant form word-order variant
        'nu-seals', // 2026-07-11 Keeper: AZ aspirin 75mg brand
        'caprin', // 2026-07-11 Keeper: Pinewood aspirin 75mg brand
        'micropirin', // 2026-07-11 Keeper: M&A Pharmachem aspirin 75mg brand
      ],
      requires: [],
      interval: 0,
    },
    {
      id: 'antipsych',
      label: 'Antipsychotic',
      terms: [
        'olanzapine',
        'risperidone',
        'quetiapine',
        'aripiprazole',
        'haloperidol',
        'clozapine',
        'chlorpromazine',
        'amisulpride', // 2026-07-11 Keeper: atypical antipsychotic, NICE CG178 monitoring
        'paliperidone', // 2026-07-11 Keeper: active metabolite of risperidone, NICE CG178 monitoring
      ],
      requires: ['fbc', 'full blood count', 'u&e', 'lft', 'glucose', 'hba1c', 'cholesterol'],
      interval: 183,
    },
    // Benzodiazepines and Z-drugs: STOPP/PINCER — falls/sedation risk in the elderly.
    // Parity with the triage-lens BENZO_Z regex (2026-06-11 KD-33 resolution).
    {
      id: 'benzo_z',
      label: 'Benzodiazepine / Z-drug',
      terms: [
        'diazepam',
        'lorazepam',
        'temazepam',
        'nitrazepam',
        'oxazepam',
        'chlordiazepoxide',
        'clonazepam',
        'alprazolam',
        'loprazolam', // 2026-07-11 Keeper: BNF-listed UK benzo, missing from original list
        'lormetazepam', // 2026-07-11 Keeper: BNF-listed UK benzo, missing from original list
        'zopiclone',
        'zolpidem',
        'zaleplon',
      ],
      requires: [],
      interval: 0,
    },
    // 2026-07-25 Keeper additions — confirmed against BNF / BSR / NICE sources:
    {
      id: 'leflunomide',
      label: 'Leflunomide',
      terms: ['leflunomide', 'arava'],
      requires: ['fbc', 'full blood count', 'liver function', 'lft', 'u&e', 'urea'],
      interval: 84, // BNF / BSR: 3-monthly (12-weekly) after stabilisation
    },
    {
      id: 'carbamazepine',
      label: 'Carbamazepine',
      terms: ['carbamazepine', 'tegretol', 'carbagen'],
      requires: ['fbc', 'full blood count', 'liver function', 'lft', 'u&e', 'sodium', 'carbamazepine level'],
      interval: 182, // BNF: 6-monthly once stable; more frequent on initiation/dose change
    },
    {
      id: 'valproate',
      label: 'Sodium valproate / Valproic acid',
      terms: ['sodium valproate', 'valproate', 'valproic acid', 'epilim', 'episenta', 'orlept', 'convulex', 'depakote', 'belvo', 'dyzantil', 'epival', 'syonell'],
      requires: ['fbc', 'full blood count', 'liver function', 'lft', 'u&e'],
      interval: 365, // BNF: annually once stable; Valproate Pregnancy Prevention Programme triggers 3-monthly for WOCBP
    },
    {
      id: 'finerenone',
      label: 'Finerenone',
      terms: ['finerenone', 'kerendia'],
      requires: ['u&e', 'urea', 'potassium', 'egfr'],
      interval: 120, // NICE TA877 / SmPC: U&E at 1 month then every 4 months; using 120d (4 months) as recurring interval
    },
  ];
  function evaluatePrescribingFlags(meds, age) {
      const NSAIDS = /ibuprofen|naproxen|diclofenac|celecoxib|etoricoxib|meloxicam|piroxicam|tenoxicam|indometh?acin|sulindac|ketoprofen|dexketoprofen|tiaprofenic|mefenamic|tolfenamic|fenoprofen|aceclofenac|nabumetone|etodolac|flurbiprofen/i;
      const TOPICAL = /gel|cream|ointment|topical|patch|spray|eye ?drop|ear ?drop|foam/i;
      const ANTICOAG = /warfarin|apixaban|rivaroxaban|edoxaban|dabigatran|acenocoumarol|phenindione|enoxaparin|dalteparin|tinzaparin|heparin/i;
      const ANTIPLATELET = /aspirin|clopidogrel|ticagrelor|prasugrel|dipyridamole/i;
      const ACEI_ARB = /ramipril|lisinopril|perindopril|enalapril|captopril|trandolapril|fosinopril|quinapril|imidapril|cilazapril|losartan|candesartan|valsartan|irbesartan|olmesartan|telmisartan|azilsartan|eprosartan/i;
      const DIURETIC = /furosemide|frusemide|bumetanide|torasemide|bendroflumethiazide|indapamide|hydrochlorothiazide|chlortalidone|chlorthalidone|metolazone/i;
      const BENZO_Z = /diazepam|lorazepam|temazepam|nitrazepam|oxazepam|chlordiazepoxide|clonazepam|alprazolam|zopiclone|zolpidem|zaleplon/i;
      const GASTRO = /omeprazole|lansoprazole|esomeprazole|pantoprazole|rabeprazole|famotidine|cimetidine|nizatidine|ranitidine/i;
  
      const list = (meds || []).map(m => String(m || ''));
      const has = (re) => list.some(m => re.test(m));
      const systemicNSAID = list.some(m => NSAIDS.test(m) && !TOPICAL.test(m));
      const items = [];
  
      if (systemicNSAID && has(ANTICOAG)) {
        items.push({ severity: 'amber', text: 'NSAID + anticoagulant', detail: 'STOPP — major GI bleed risk; review need / gastroprotection' });
      } else if (systemicNSAID && has(ANTIPLATELET)) {
        items.push({ severity: 'amber', text: 'NSAID + antiplatelet', detail: 'STOPP — bleed risk; review need / gastroprotection' });
      }
      if (systemicNSAID && has(ACEI_ARB) && has(DIURETIC)) {
        items.push({ severity: 'amber', text: 'Triple whammy (NSAID + ACEi/ARB + diuretic)', detail: 'AKI risk (PINCER / STOPP) — review' });
      }
      if (age != null && age >= 80 && has(BENZO_Z)) {
        items.push({ severity: 'amber', text: 'Benzodiazepine/Z-drug in age ≥80', detail: 'STOPP — falls & sedation risk; consider deprescribing' });
      }
      // KD-32 — PINCER #1: NSAID in age ≥65 without gastroprotection
      // Fail-closed: age must be known (age != null) and ≥65.
      if (systemicNSAID && age != null && age >= 65 && !has(GASTRO)) {
        items.push({ severity: 'amber', text: 'NSAID in age ≥65 without gastroprotection', detail: 'PINCER #1 — GI bleed risk; consider PPI cover / review NSAID need' });
      }
      return items;
    }
  const api = { HIGH_RISK_DRUGS, evaluatePrescribingFlags };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.PincerTables = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
