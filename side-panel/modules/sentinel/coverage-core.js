// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel rule-coverage drill-down core (pure ES module, no chrome/DOM)
//
// buildCoverageView(drugRulesData, qofRulesData) → CoverageView
//
// Patient-safety transparency: the panel's named failure mode is the SILENT
// false negative — a monitored drug or QOF area with no rule simply never
// produces a chip, and nothing on screen says so. The "N drug rules ·
// updated …" footer line is a fact, but on its own it doesn't let a clinician
// or pharmacist check "is MY drug/indicator actually covered?". This module
// turns the rules files themselves into a read-only, expandable listing —
// rule name + the drug terms it matches (drug-rules.json) + the QOF
// indicators/registers covered (qof-rules.json) — so coverage can be
// eyeballed without reading JSON.
//
// Deliberately dumb: no filtering, no interpretation, no "is my drug covered"
// search (that is future scope). It transcribes the rule files. Counts
// returned here MUST equal what's in the JSON — pinned by
// test-rule-coverage-view.js reading the real files directly.
//
// Renders WITHOUT a patient loaded (rules files, not a patient snapshot) —
// the caller (sentinel.js) fetches drug-rules.json/qof-rules.json once via
// chrome.runtime.getURL, same path as loadRuleCurrencyFooter, and can show
// this drill-down at any time.

'use strict';

// Build the drill-down view from the raw parsed rule-file JSON.
//   drugRulesData — parsed rules/drug-rules.json (or null/undefined)
//   qofRulesData  — parsed rules/qof-rules.json (or null/undefined)
//
// Returns:
//   {
//     drug: {
//       total, enabled,
//       rules: [ { id, drugClass, enabled, terms: [...], testCount } ]  // enabled-first, then alpha by id
//     },
//     qof: {
//       total, enabled, registerCount, indicatorCount,
//       registers:  [ { id, registerCode, registerName, enabled } ]
//       indicators: [ { id, indicatorCode, indicatorName, enabled, requiresRegister } ]
//     }
//   }
export function buildCoverageView(drugRulesData, qofRulesData) {
  return {
    drug: buildDrugCoverage(drugRulesData),
    qof: buildQofCoverage(qofRulesData),
  };
}

function buildDrugCoverage(data) {
  const rawRules = Array.isArray(data && data.rules) ? data.rules : [];
  // Only drug-monitoring rules carry a `drug.match` term list to surface here.
  // drug-no-monitoring rules are a deliberate "no monitoring needed" signal,
  // not a monitoring rule — listing them under "drug rules" would misrepresent
  // coverage, so they are excluded from this count (matches the footer's
  // existing drugCount convention: Array.isArray(drug.rules).length counts
  // ALL entries in the file; this view is scoped to what actually produces a
  // monitoring chip, so is intentionally the finer-grained, more useful cut).
  const monitoringRules = rawRules.filter((r) => r && r.type === 'drug-monitoring');

  const rules = monitoringRules
    .map((r) => ({
      id: r.id || '(unnamed rule)',
      drugClass: r.drugClass || '',
      enabled: r.enabled !== false,
      terms: Array.isArray(r.drug && r.drug.match) ? r.drug.match.slice() : [],
      testCount: Array.isArray(r.tests) ? r.tests.length : 0,
    }))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

  return {
    total: rawRules.length,
    enabled: rawRules.filter((r) => r && r.enabled !== false).length,
    monitoringTotal: monitoringRules.length,
    rules,
  };
}

function buildQofCoverage(data) {
  const rawRules = Array.isArray(data && data.rules) ? data.rules : [];
  const registerRules = rawRules.filter((r) => r && r.type === 'qof-register');
  const indicatorRules = rawRules.filter((r) => r && r.type === 'qof-indicator');

  const registers = registerRules
    .map((r) => ({
      id: r.id || '(unnamed register)',
      registerCode: r.registerCode || '',
      registerName: r.registerName || r.registerCode || '(unnamed)',
      enabled: r.enabled !== false,
    }))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.registerName.localeCompare(b.registerName);
    });

  const indicators = indicatorRules
    .map((r) => ({
      id: r.id || '(unnamed indicator)',
      indicatorCode: r.indicatorCode || '',
      indicatorName: r.indicatorName || r.indicatorCode || '(unnamed)',
      enabled: r.enabled !== false,
      requiresRegister: r.requiresRegister || '',
    }))
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return (a.indicatorCode || a.indicatorName).localeCompare(b.indicatorCode || b.indicatorName);
    });

  return {
    total: rawRules.length,
    enabled: rawRules.filter((r) => r && r.enabled !== false).length,
    registerCount: registerRules.length,
    indicatorCount: indicatorRules.length,
    registers,
    indicators,
  };
}
