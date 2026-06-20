// engine/acb-scores.js — Anticholinergic Cognitive Burden (ACB) scorer
// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// Starter set derived from the Boustani ACB scale (ACBcalc.com).
// REQUIRES CLINICAL SAFETY OFFICER VERIFICATION BEFORE CLINICAL RELEASE.
//
// Scoring: 1 = mild/weak anticholinergic effect, 2 = moderate, 3 = strong.
// Match convention: case-insensitive substring against the drug name string
// (suite-wide convention). For ACB a generic name ordinarily covers brand
// forms — e.g. "oxybutynin" matches "oxybutynin hydrochloride". Common UK
// brand names for the score-3 drugs are listed explicitly so that records
// containing only brand names (e.g. Detrusitol, Vesicare) still score.
//
// Longest-match-wins rule prevents double-counting when one term is a
// substring of another entry.
//
// Drug list below is ordered score-3 → score-2 → score-1. Each entry:
//   { term: string, score: 1|2|3, note?: string }
// A drug matches the FIRST entry whose term is a case-insensitive substring
// of the drug name, after sorting by term length descending (longest wins).

(function (global) {
  'use strict';

  // ── ACB drug table ──────────────────────────────────────────────────────────
  // Score 3 — strong (definite) anticholinergic activity
  // Score 2 — moderate anticholinergic activity (limited entries on Boustani list)
  // Score 1 — mild / possible anticholinergic activity
  const ACB_TABLE = [
    // ── Score 3: Tricyclic antidepressants ──────────────────────────────────
    { term: 'amitriptyline', score: 3 },
    { term: 'nortriptyline', score: 3 },
    { term: 'imipramine', score: 3 },
    { term: 'clomipramine', score: 3 },
    { term: 'doxepin', score: 3 },
    { term: 'dosulepin', score: 3, note: 'TCA (= dothiepin); Boustani score 3' },
    { term: 'dothiepin', score: 3, note: 'older UK name for dosulepin' },
    // ── Score 2: Tricyclic antidepressant (moderate ACB) ─────────────────────
    // Amoxapine — dibenzoxazepine tricyclic; Boustani/ACBcalc score 2 (medrev-005).
    { term: 'amoxapine', score: 2 },
    // ── Score 3: SSRIs/SNRIs with notable ACB ───────────────────────────────
    { term: 'paroxetine', score: 3 },
    // ── Score 3: Urological / bladder antispasmodics ─────────────────────────
    { term: 'oxybutynin', score: 3 },
    { term: 'lyrinel', score: 3, note: 'brand: oxybutynin' },
    { term: 'ditropan', score: 3, note: 'brand: oxybutynin' },
    { term: 'kentera', score: 3, note: 'brand: oxybutynin patch' },
    { term: 'tolterodine', score: 3 },
    { term: 'detrusitol', score: 3, note: 'brand: tolterodine' },
    { term: 'solifenacin', score: 3 },
    { term: 'vesicare', score: 3, note: 'brand: solifenacin' },
    { term: 'fesoterodine', score: 3 },
    { term: 'toviaz', score: 3, note: 'brand: fesoterodine' },
    // Trospium: quaternary ammonium compound — limited CNS penetration, but
    // ACBcalc assigns score 1; some sources list as score 3. Using score 1
    // (conservative, avoids over-flagging). Included for completeness.
    { term: 'trospium', score: 1, note: 'quaternary; ACBcalc score 1 (limited CNS penetration)' },
    { term: 'regurin', score: 1, note: 'brand: trospium' },
    // ── Score 3: Antimuscarinics / antispasmodics ────────────────────────────
    { term: 'hyoscine', score: 3 },
    { term: 'dicycloverine', score: 3 },
    { term: 'propantheline', score: 3 },
    { term: 'atropine', score: 3 },
    // ── Score 3: First-generation antihistamines ─────────────────────────────
    { term: 'chlorphenamine', score: 3 },
    { term: 'promethazine', score: 3 },
    { term: 'hydroxyzine', score: 3 },
    { term: 'diphenhydramine', score: 3 },
    { term: 'cyclizine', score: 3 },
    // ── Score 3: Antipsychotics with high ACB ────────────────────────────────
    { term: 'olanzapine', score: 3 },
    { term: 'quetiapine', score: 3 },
    { term: 'clozapine', score: 3 },
    { term: 'chlorpromazine', score: 3 },
    { term: 'levomepromazine', score: 3, note: 'Boustani/Campbell ACB score 3 (phenothiazine; = methotrimeprazine)' },
    { term: 'methotrimeprazine', score: 3, note: 'older name for levomepromazine; Boustani/Campbell ACB score 3' },
    { term: 'nozinan', score: 3, note: 'brand: levomepromazine' },
    // ── Score 3: Antiparkinson drugs with anticholinergic action ─────────────
    { term: 'procyclidine', score: 3 },
    { term: 'orphenadrine', score: 3 },
    { term: 'trihexyphenidyl', score: 3 },
    // ── Score 3: Antiemetic ───────────────────────────────────────────────────
    { term: 'prochlorperazine', score: 3 },
    // ── Score 1: Mild / possible anticholinergic effect ──────────────────────
    // These are on the Boustani ACB score-1 list. Confidence: high.
    { term: 'cetirizine', score: 1 },
    { term: 'loratadine', score: 1 },
    // fexofenadine: some lists omit it (low affinity); NOT included as evidence
    // is weak and omitting it is the safer conservative choice.
    { term: 'ranitidine', score: 1 },
    { term: 'metoprolol', score: 1 },
    { term: 'atenolol', score: 1 },
    { term: 'captopril', score: 1 },
    { term: 'codeine', score: 1 },
    { term: 'colchicine', score: 1 },
    { term: 'diazepam', score: 1 },
    { term: 'digoxin', score: 1 },
    { term: 'fentanyl', score: 1 },
    { term: 'furosemide', score: 1 },
    { term: 'fluvoxamine', score: 1 },
    { term: 'haloperidol', score: 1 },
    { term: 'hydralazine', score: 1 },
    { term: 'isosorbide', score: 1 },
    { term: 'loperamide', score: 1 },
    { term: 'morphine', score: 1 },
    { term: 'nifedipine', score: 1 },
    { term: 'prednisolone', score: 1 },
    { term: 'risperidone', score: 1 },
    { term: 'theophylline', score: 1 },
    { term: 'trazodone', score: 1 },
    { term: 'venlafaxine', score: 1 },
    { term: 'warfarin', score: 1 },
    { term: 'alprazolam', score: 1 },
    { term: 'aripiprazole', score: 1 },
    { term: 'asenapine', score: 1 },
    { term: 'mirtazapine', score: 1 },
  ];

  // Sort by term length descending — longest match wins, preventing double-counting
  // (e.g. "oxybutynin" before any shorter generic that might overlap).
  const SORTED_TABLE = ACB_TABLE.slice().sort((a, b) => b.term.length - a.term.length);

  /**
   * Compute the ACB score for a list of drugs.
   *
   * @param {Array<{label:string}|{terms:string[]}|string>} drugs
   *   Each element may be a string (drug name), an object with a `label`
   *   property (as produced by computeDrugMonitoring), or an object with a
   *   `terms` array. All are reduced to a searchable name string.
   *
   * @returns {{ total: number, perDrug: Array<{name:string, matchedTerm:string, score:number}>, alert: boolean }}
   */
  function computeACB(drugs) {
    const perDrug = [];
    let total = 0;

    for (const drug of drugs || []) {
      // Normalise to a name string
      const name = typeof drug === 'string' ? drug : drug.label || (drug.terms && drug.terms[0]) || '';
      if (!name) continue;
      const nameLow = name.toLowerCase();

      // Find the longest-matching ACB entry (first in SORTED_TABLE that matches)
      let matched = null;
      for (const entry of SORTED_TABLE) {
        if (nameLow.includes(entry.term)) {
          matched = entry;
          break;
        }
      }
      if (!matched) continue;

      perDrug.push({ name, matchedTerm: matched.term, score: matched.score });
      total += matched.score;
    }

    return { total, perDrug, alert: total >= 3 };
  }

  // ── Module export (dual-mode: Node require OR browser global) ───────────────
  const api = { computeACB, ACB_TABLE };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ACBScores = api;
  }
})(typeof window !== 'undefined' ? window : global);
