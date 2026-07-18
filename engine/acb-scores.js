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
    { term: 'allegron', score: 3, note: 'brand: nortriptyline (King Pharmaceuticals) — 2026-07-18 Keeper' },
    { term: 'imipramine', score: 3 },
    { term: 'clomipramine', score: 3 },
    { term: 'anafranil', score: 3, note: 'brand: clomipramine (Mallinckrodt) — 2026-07-18 Keeper' },
    { term: 'doxepin', score: 3 },
    { term: 'dosulepin', score: 3, note: 'TCA (= dothiepin); Boustani score 3' },
    { term: 'dothiepin', score: 3, note: 'older UK name for dosulepin' },
    { term: 'prothiaden', score: 3, note: 'brand: dosulepin (King Pharmaceuticals) — 2026-07-18 Keeper' },
    { term: 'trimipramine', score: 3, note: 'TCA; Boustani ACB score 3 (2026-07-11 Keeper addition)' },
    { term: 'surmontil', score: 3, note: 'brand: trimipramine (2026-07-11 Keeper addition)' },
    // ── Score 2: Tricyclic antidepressant (moderate ACB) ─────────────────────
    // Amoxapine — dibenzoxazepine tricyclic; Boustani/ACBcalc score 2 (medrev-005).
    { term: 'amoxapine', score: 2 },
    // ── Score 2 additions (Keeper 2026-06-20, CSO proposal; medium confidence —
    //    ACBcalc.com 403, corroborated vs Campbell 2012 Boustani ACB update +
    //    multiple NHS ACB-scale reproductions). 5 further candidates were KILLED
    //    in verification (cyclobenzaprine/loxapine: not UK primary-care; cimetidine/
    //    baclofen: score conflict 1-vs-2; levomepromazine: actually score 3). ──
    { term: 'carbamazepine', score: 2, note: 'Boustani/Campbell ACB score 2 (antiepileptic)' },
    { term: 'oxcarbazepine', score: 2, note: 'Boustani/Campbell ACB score 2; 10-keto analogue of carbamazepine (not a substring of carbamazepine — no collision)' },
    { term: 'amantadine', score: 2, note: 'Boustani/Campbell ACB score 2 (Parkinson); corroborated Nawaz 2022 (PMID 35983547), Mühlberg 2017; score-1 assignment in some lists reflects dose-dependent effect — score 2 is the consensus for prescribing-age patients' },
    { term: 'pethidine', score: 2, note: 'Boustani/Campbell ACB score 2 (opioid; UK name — meperidine is US name, not added)' },
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
    { term: 'vesicare', score: 3, note: 'brand: solifenacin (AstraZeneca)' },
    { term: 'giraxine', score: 3, note: 'brand: solifenacin (Astellas) — 2026-07-18 Keeper' },
    { term: 'fesoterodine', score: 3 },
    { term: 'toviaz', score: 3, note: 'brand: fesoterodine' },
    { term: 'darifenacin', score: 3, note: 'M3-selective antimuscarinic (OAB); Boustani ACB score 3 (2026-07-11 Keeper addition)' },
    { term: 'emselex', score: 3, note: 'brand: darifenacin (2026-07-11 Keeper addition)' },
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
    { term: 'piriton', score: 3, note: 'brand: chlorphenamine (GSK Consumer) — 2026-07-18 Keeper' },
    { term: 'promethazine', score: 3 },
    { term: 'phenergan', score: 3, note: 'brand: promethazine (Sanofi) — 2026-07-18 Keeper' },
    { term: 'sominex', score: 3, note: 'brand: promethazine hydrochloride 20 mg (Dexcel-Pharma/OTC) — 2026-07-18 Keeper' },
    { term: 'hydroxyzine', score: 3 },
    { term: 'atarax', score: 3, note: 'brand: hydroxyzine (Alliance Pharmaceuticals) — 2026-07-18 Keeper' },
    { term: 'ucerax', score: 3, note: 'brand: hydroxyzine (UCB Pharma) — 2026-07-18 Keeper' },
    { term: 'diphenhydramine', score: 3 },
    { term: 'cyclizine', score: 3 },
    // Alimemazine (= trimeprazine): phenothiazine first-gen AH; ACBcalc score 3
    // (medium confidence — ACBcalc 403; corroborated via NHS formulary reproductions).
    // CSO note: alimemazine/trimeprazine usage in adults is now mainly palliative;
    // Vallergan (alimemazine tartrate, Rosemont) is UK paediatric brand.
    { term: 'alimemazine', score: 3, note: 'phenothiazine first-gen AH; ACBcalc score 3 (medium confidence — ACBcalc 403; NHS formulary corroboration) — 2026-07-18 Keeper' },
    { term: 'trimeprazine', score: 3, note: 'older name for alimemazine (not a substring of it); same ACB basis — 2026-07-18 Keeper' },
    { term: 'vallergan', score: 3, note: 'brand: alimemazine tartrate (Rosemont, paediatric) — 2026-07-18 Keeper' },
    // ── Score 3: Antipsychotics with high ACB ────────────────────────────────
    { term: 'olanzapine', score: 3 },
    { term: 'quetiapine', score: 3 },
    { term: 'clozapine', score: 3 },
    { term: 'chlorpromazine', score: 3 },
    { term: 'levomepromazine', score: 3, note: 'Boustani/Campbell ACB score 3 (phenothiazine; = methotrimeprazine)' },
    { term: 'methotrimeprazine', score: 3, note: 'older name for levomepromazine; Boustani/Campbell ACB score 3' },
    { term: 'nozinan', score: 3, note: 'brand: levomepromazine' },
    { term: 'trifluoperazine', score: 3, note: 'phenothiazine antipsychotic; Boustani ACB score 3; former UK brand Stelazine (discontinued) — no brand term added as no current UK brand (2026-07-11 Keeper addition)' },
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
    // fexofenadine: second-generation AH; ACBcalc assigns no ACB score (not listed),
    // confirming negligible anticholinergic burden. Correctly excluded from this table.
    { term: 'ranitidine', score: 1 },
    { term: 'metoprolol', score: 1 },
    { term: 'atenolol', score: 1 },
    { term: 'captopril', score: 1 },
    { term: 'codeine', score: 1, note: 'ACBcalc score 1 (opioid; weak anticholinergic effect)' },
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
    // SSRIs: ACBcalc/Boustani score 1 (mild/possible; paroxetine is score 3 and listed above).
    // sertraline, citalopram, escitalopram, fluoxetine all confirmed score 1 by VERIFIER-A
    // 2026-07-18 (Boustani 2012/ACBcalc; corroborated via NHS SPS references). Not score 3.
    { term: 'sertraline', score: 1, note: 'SSRI; ACBcalc score 1 — 2026-07-18 Keeper' },
    { term: 'citalopram', score: 1, note: 'SSRI; ACBcalc score 1 — 2026-07-18 Keeper' },
    { term: 'escitalopram', score: 1, note: 'SSRI; ACBcalc score 1 — 2026-07-18 Keeper' },
    { term: 'fluoxetine', score: 1, note: 'SSRI; ACBcalc score 1 — 2026-07-18 Keeper' },
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
  // SPEC is the published identifier of the scale implemented here. Read by the CQC
  // readiness disclosure so the named version cannot drift from the engine.
  const SPEC = { name: 'Anticholinergic burden', version: 'Boustani ACB scale (ACBcalc.com)', source: 'Boustani et al. 2008' };
  const api = { computeACB, ACB_TABLE, SPEC };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.ACBScores = api;
  }
})(typeof window !== 'undefined' ? window : global);
