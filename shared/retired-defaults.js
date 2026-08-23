// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — retired shipped-default un-stick tables (single source)
//
// content.js and triage-lens/options.js both run mergeShippedDefaults. These
// tables un-stick a held builtin whose stored label/threshold is a since-changed
// shipped value. WHEN YOU CHANGE A SHIPPED CHIP LABEL OR RESULT-RULE FIELD:
// add the old value here AND bump defaults.json "version".
// No-value-change extract — flagged to CSO as a location refactor only.

'use strict';

(function (global) {
    const RETIRED_CHIP_LABELS = {
      'queue.resultUrgent': ['Urgent: {name}'],
      'queue.resultRuleUrgent': ['Urgent: {name} — {rule}', '{name} — {rule}'],
      'queue.resultRuleAbnormal': ['{name} — {rule}']
    };
    const revertRetiredChipLabels = (chips, shippedChips) => {
      if (!chips || !shippedChips) return;
      for (const id of Object.keys(RETIRED_CHIP_LABELS)) {
        const entry = chips[id];
        const shippedNow = shippedChips[id];
        if (entry && shippedNow && RETIRED_CHIP_LABELS[id].indexOf(entry.label) !== -1) {
          entry.label = shippedNow.label;
        }
      }
    };
    const RESULT_RULES_GAINED_ABNORMALTEXT = ['msu-culture', 'base-blood-culture'];
    const backfillBuiltinAbnormalText = (resultRules, shippedResultRules) => {
      if (!Array.isArray(resultRules) || !Array.isArray(shippedResultRules)) return;
      for (const id of RESULT_RULES_GAINED_ABNORMALTEXT) {
        const held = resultRules.find(r => r && r.id === id && r.builtin);
        if (!held || (Array.isArray(held.abnormalText) && held.abnormalText.length)) continue;
        const shippedRule = shippedResultRules.find(r => r && r.id === id);
        if (shippedRule && Array.isArray(shippedRule.abnormalText) && shippedRule.abnormalText.length) {
          held.abnormalText = [...shippedRule.abnormalText];
        }
      }
    };
    const RETIRED_RESULTRULE_FIELDS = {
      'base-low-haemoglobin': { label: ['Critical low haemoglobin'], red: [100] },
      // v22 added an amber band (6.0–6.4 mmol/L, UKKA Oct 2023 "moderate" hyperkalaemia
      // band) below the pre-existing red ≥6.5 — a NEW field on a held builtin, which the
      // append-by-id merge never delivers on its own. Both the ancient (pre-v17) and the
      // v17 numbered label are listed as retired candidates so either vintage of held rule
      // (which never carried an amber field) is brought up to the new label + amber value.
      'base-high-potassium': {
        label: ['Critical high potassium', 'Critical high potassium (red ≥6.5 mmol/L)'],
        amber: [undefined]
      },
      'base-low-sodium': { label: ['Critical low sodium'] },
      'base-low-egfr': { label: ['Critical low eGFR'] },
      'base-low-platelets': { label: ['Critical low platelets'] },
      'base-low-neutrophils': { label: ['Critical low neutrophils'] },
      'base-high-inr': { label: ['High INR'] },
      'base-lithium-toxicity': { label: ['High lithium level — toxicity risk'] },
      'base-digoxin-toxicity': { label: ['High digoxin level — toxicity risk'] },
      'base-low-potassium': { label: ['Critical low potassium'] },
      'base-high-calcium': { label: ['High calcium — hypercalcaemia'] },
      'base-egfr-amber': { label: ['Low eGFR — significant CKD'] },
      'base-low-calcium': { label: ['Low adjusted calcium — hypocalcaemia'] },
      'base-low-magnesium': { label: ['Low magnesium — hypomagnesaemia'] },
      'base-high-tsh': { label: ['High TSH — possible hypothyroidism'] },
      'base-low-tsh': { label: ['Suppressed TSH — possible thyrotoxicosis'] },
      // v22 (CSO calibration pass, TRIAGE-LENS-2026-07-02.md item 3.3) demoted HbA1c ≥48 from
      // red to amber — 48 mmol/mol is the WHO/NICE NG28 DIAGNOSTIC threshold, not itself a
      // marker of clinical urgency, and firing red on every newly-diagnostic HbA1c was alert
      // fatigue. A held rule still at the old red:48/no-amber shape is moved to red:null,
      // amber:48 (label text is unchanged — "HbA1c ≥48" reads correctly at either severity, so
      // it is not part of this un-stick).
      'base-hba1c-diabetes': { red: [48], amber: [undefined] },
      // v21 tightened the bare "gram positive"/"gram negative"/"candida" substrings (they
      // matched NEGATIVE phrasing like "No gram negative organisms isolated" and tripped a
      // false-amber review) to morphology-qualified gram-stain terms and named candida
      // species. A held rule whose abnormalText still deep-equals this OLD 30-element
      // shipped array is un-stuck to the new shipped array; a customised array is left alone.
      'base-blood-culture': {
        abnormalText: [
          [
            'grown in aerobic bottle',
            'grown in anaerobic bottle',
            'positive blood culture',
            'gram positive',
            'gram negative',
            'gram-positive',
            'gram-negative',
            'bacteraemia',
            'bacteremia',
            'fungaemia',
            'sensitive to',
            'resistant to',
            'sensitivities shown',
            'staphylococcus',
            'streptococcus',
            'escherichia',
            'klebsiella',
            'enterococcus',
            'pseudomonas',
            'haemophilus',
            'neisseria',
            'listeria',
            'salmonella',
            'candida',
            'acinetobacter',
            'serratia',
            'enterobacter',
            'proteus',
            'citrobacter',
            'stenotrophomonas'
          ]
        ]
      }
    };
    const arraysShallowEqual = (a, b) =>
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
    const fieldStillDefault = (candidates, heldValue) => {
      if (Array.isArray(heldValue)) return candidates.some(c => arraysShallowEqual(c, heldValue));
      return candidates.indexOf(heldValue) !== -1;
    };
    const revertRetiredResultRuleFields = (resultRules, shippedResultRules) => {
      if (!Array.isArray(resultRules) || !Array.isArray(shippedResultRules)) return;
      for (const id of Object.keys(RETIRED_RESULTRULE_FIELDS)) {
        const held = resultRules.find(r => r && r.id === id && r.builtin);
        const shippedRule = shippedResultRules.find(r => r && r.id === id);
        if (!held || !shippedRule) continue;
        const fields = RETIRED_RESULTRULE_FIELDS[id];
        const stillDefault = Object.keys(fields).every(f => fieldStillDefault(fields[f], held[f]));
        if (!stillDefault) continue;
        for (const f of Object.keys(fields)) {
          if (shippedRule[f] === undefined) continue;
          held[f] = Array.isArray(shippedRule[f]) ? [...shippedRule[f]] : shippedRule[f];
        }
      }
    };
  const api = {
    RETIRED_CHIP_LABELS,
    revertRetiredChipLabels,
    RESULT_RULES_GAINED_ABNORMALTEXT,
    backfillBuiltinAbnormalText,
    RETIRED_RESULTRULE_FIELDS,
    revertRetiredResultRuleFields,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.RetiredDefaults = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
