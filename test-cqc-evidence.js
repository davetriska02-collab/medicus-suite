// Medicus Suite — CQC Inspection Readiness data-engine tests
// Run with: node test-cqc-evidence.js
//
// Guards the PURE readiness builder (engine/cqc-evidence.js): coverage manifest
// (de-duped/sorted matched terms, rule counts, safety-monitoring count), the
// per-quality-statement evidence shape and RAG derivation, the anchored delta,
// and the honest-framing strings. Also asserts NO patient-identifiable data
// appears anywhere in the output — it is system metadata only.

'use strict';

(async () => {
  let passed = 0,
    failed = 0;
  function check(cond, msg) {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  }

  const { buildReadiness, diffReadiness } = require('./engine/cqc-evidence.js');
  const RuleCurrency = require('./shared/rule-currency.js');

  // ── Fixture rule files (real field names, trimmed) ──────────────────────────
  const drug = {
    lastUpdated: '2026-06-14',
    schemaVersion: 2,
    specVersion: 'Sentinel drug rules - June 2026 review',
    sourceNotes:
      'Curated subset of primary care drug-monitoring rules from BNF, NICE, BSR shared care ' +
      'and MHRA Drug Safety Updates. 2026-06-04 brand-completeness pass (The Keeper): added UK brands.',
    rules: [
      {
        type: 'drug-monitoring',
        id: 'methotrexate-maintenance',
        drug: { match: ['Methotrexate', 'maxtrex', 'metoject', 'methotrexate'] }, // dup + case variant
      },
      {
        type: 'drug-monitoring',
        id: 'lithium-maintenance',
        drug: { match: ['lithium', 'priadel', 'camcolit'] },
      },
      {
        type: 'drug-monitoring',
        id: 'amiodarone-maintenance',
        drug: { match: ['amiodarone', 'cordarone'] },
      },
      // a non-monitoring rule should NOT be counted as a monitoring rule
      { type: 'other-thing', id: 'noise', drug: { match: ['ignored-but-still-a-term'] } },
    ],
  };

  const qof = {
    schemaVersion: 2,
    lastUpdated: '2026-06-10',
    specVersion: 'QOF 2026/27',
    rules: [
      { id: 'qof-reg-dm', type: 'qof-register', registerCode: 'DM' },
      { id: 'qof-ind-1', type: 'qof-indicator' },
      { id: 'qof-ind-2', type: 'qof-indicator', category: 'safety-monitoring' },
      { id: 'qof-ind-3', type: 'qof-indicator', category: 'safety-monitoring' },
    ],
  };

  const vaccine = {
    lastUpdated: '2026-06-14',
    specVersion: 'JCVI/UKHSA 2026/27 season',
    rules: [
      { id: 'vax-flu', type: 'vaccine' },
      { id: 'vax-covid', type: 'vaccine' },
    ],
  };

  const alert = {
    version: '1.2',
    lastUpdated: '2026-06-14',
    specVersion: 'PINCER/NICE prescribing-safety alert library v1.2',
    library: [{ libId: 'pincer-1' }, { libId: 'pincer-2' }, { libId: 'pincer-3' }],
  };

  const ruleFiles = { drug, qof, vaccine, alert };
  const todayISO = '2026-06-16';

  // Build a realistic currency from the real assessor (green expected at todayISO).
  const currencyInput = [
    { id: 'drug', lastUpdated: drug.lastUpdated, specVersion: drug.specVersion },
    { id: 'qof', lastUpdated: qof.lastUpdated, specVersion: qof.specVersion },
    { id: 'vaccine', lastUpdated: vaccine.lastUpdated, specVersion: vaccine.specVersion },
    { id: 'alert', lastUpdated: alert.lastUpdated, specVersion: alert.specVersion },
  ];
  const currency = RuleCurrency.assessRuleCurrency(currencyInput, todayISO);

  // ── buildReadiness ──────────────────────────────────────────────────────────
  console.log('--- buildReadiness ---');
  const r = buildReadiness(ruleFiles, { todayISO, currency, anchor: null });

  check(r.generatedAt === todayISO, 'generatedAt passes through todayISO');
  check(r.disclaimer && /Not proof of compliance/.test(r.disclaimer), 'honest-bound disclaimer present');

  // Coverage manifest
  const mt = r.coverage.drug.matchedTerms;
  check(Array.isArray(mt) && mt.length > 0, 'matchedTerms is non-empty');
  // de-duped (case-insensitive): "Methotrexate"/"methotrexate" collapse to one
  const lower = mt.map((s) => s.toLowerCase());
  check(new Set(lower).size === lower.length, 'matchedTerms de-duped (case-insensitive)');
  check(
    JSON.stringify(lower) === JSON.stringify([...lower].sort((a, b) => a.localeCompare(b))),
    'matchedTerms sorted'
  );
  check(!mt.includes('ignored-but-still-a-term'), 'matched terms come ONLY from drug-monitoring rules (non-monitoring rule excluded)');

  check(r.coverage.drug.ruleCount === 3, 'drug ruleCount counts only drug-monitoring rules (3)');
  check(r.coverage.drug.lastUpdated === '2026-06-14', 'drug lastUpdated carried');
  check(r.coverage.drug.specVersion === drug.specVersion, 'drug specVersion carried');
  check(r.coverage.drug.schemaVersion === 2, 'drug schemaVersion carried');

  check(r.coverage.qof.indicatorCount === 3, 'qof indicatorCount = 3');
  check(r.coverage.qof.safetyMonitoringCount === 2, 'qof safetyMonitoringCount = 2');
  check(r.coverage.qof.lastUpdated === '2026-06-10', 'qof lastUpdated carried');

  check(r.coverage.vaccine.ruleCount === 2, 'vaccine ruleCount = 2');
  check(r.coverage.alert.ruleCount === 3, 'alert ruleCount = 3');

  check(r.coverage.codedDataOnly === true, 'codedDataOnly flag true');
  check(typeof r.coverage.undercountCaveat === 'string' && /floor, not a ceiling/.test(r.coverage.undercountCaveat), 'undercountCaveat present (A5)');
  check(typeof r.coverage.keeperProvenance === 'string' && r.coverage.keeperProvenance.length > 0, 'keeperProvenance non-empty (A3)');

  // Currency passthrough
  check(r.currency.overall === currency.overall, 'currency.overall passed through');
  check(Array.isArray(r.currency.files) && r.currency.files.length === 4, 'currency.files passed through');

  // Quality statements
  const qs = r.qualityStatements;
  check(Array.isArray(qs) && qs.length >= 3, 'at least 3 quality statements');
  const meds = qs.find((s) => s.qualityStatement === 'Safe and effective medicines management');
  const gov = qs.find((s) => s.qualityStatement === 'Governance: safety rules kept current');
  const transp = qs.find((s) => s.qualityStatement === 'Medicines coverage transparency');
  check(meds && meds.keyQuestion === 'Safe' && meds.evidenceCategory === 'Processes', 'medicines-mgmt statement: Safe / Processes');
  check(gov && gov.keyQuestion === 'Well-led' && gov.evidenceCategory === 'Processes', 'governance statement: Well-led / Processes');
  check(transp && transp.keyQuestion === 'Safe' && transp.evidenceCategory === 'Processes', 'coverage-transparency statement: Safe / Processes');

  // RAG derives from currency
  check(meds.rag === (currency.files.find((f) => f.id === 'drug') || {}).level, 'medicines RAG derives from drug currency level');
  check(gov.rag === currency.overall, 'governance RAG = currency.overall');
  check(transp.rag === 'green', 'coverage-transparency RAG green when matchedTerms present');

  // Provenance fields on each statement
  check(qs.every((s) => s.provenance && s.provenance.asAt && s.provenance.source), 'every statement carries provenance{asAt,source}');
  check(meds.provenance.source.includes('rules/drug-rules.json') && meds.provenance.source.includes('specVersion'), 'medicines provenance.source names file + specVersion');

  // No anchor → delta null
  check(r.delta === null, 'no anchor → delta null');

  // ── RAG amber path (stale drug rules) ───────────────────────────────────────
  console.log('\n--- RAG / toFix (stale drug) ---');
  const staleCurrency = RuleCurrency.assessRuleCurrency(
    [{ id: 'drug', lastUpdated: '2024-01-01', specVersion: drug.specVersion }],
    todayISO
  );
  const rStale = buildReadiness({ drug }, { todayISO, currency: staleCurrency, anchor: null });
  const medsStale = rStale.qualityStatements.find((s) => s.qualityStatement === 'Safe and effective medicines management');
  check(medsStale.rag === 'amber' || medsStale.rag === 'red', 'stale drug rules → medicines RAG amber/red');
  check(typeof medsStale.toFix === 'string' && /Keeper/.test(medsStale.toFix), 'stale drug rules → toFix mentions The Keeper');

  // ── diffReadiness ───────────────────────────────────────────────────────────
  console.log('\n--- diffReadiness ---');
  check(diffReadiness(r, null) === null, 'no anchor → null');

  // Anchor with different counts/dates
  const anchor = buildReadiness(
    {
      drug: { ...drug, lastUpdated: '2026-05-01', rules: drug.rules.slice(0, 2) }, // 1 fewer monitoring rule + older date
      qof,
      vaccine,
      alert,
    },
    { todayISO: '2026-05-02', currency, anchor: null }
  );
  const d = diffReadiness(r, anchor);
  check(d && Array.isArray(d.changes), 'anchored delta returns changes array');
  check(d.sinceAnchorAt === anchor.generatedAt, 'delta sinceAnchorAt = anchor.generatedAt');
  const labels = d.changes.map((c) => c.label);
  check(labels.includes('Drug-monitoring rule count'), 'delta lists changed rule count');
  check(labels.includes('Drug rules last reviewed'), 'delta lists changed lastUpdated');
  const ruleCountChange = d.changes.find((c) => c.label === 'Drug-monitoring rule count');
  check(ruleCountChange.from === 2 && ruleCountChange.to === 3, 'rule count change from 2 to 3');

  // identical anchor → no changes
  const dSame = diffReadiness(r, r);
  check(dSame && dSame.changes.length === 0, 'identical anchor → no changes');

  // ── No patient-identifiable data anywhere in the output ─────────────────────
  console.log('\n--- privacy: system metadata only ---');
  const blob = JSON.stringify(r).toLowerCase();
  // Fields that would indicate patient data leaked in
  const forbidden = ['nhsnumber', 'nhs number', 'dateofbirth', 'date of birth', 'patientname', 'firstname', 'surname', 'patientid'];
  check(forbidden.every((k) => !blob.includes(k)), 'no patient-identifiable field names in output');
  // No 10-digit NHS-number-like token
  check(!/\b\d{10}\b/.test(JSON.stringify(r)), 'no NHS-number-shaped token in output');
  // No cohort/patient counts implied — coverage carries codedDataOnly + caveat, not patient totals
  check(r.coverage.codedDataOnly === true, 'output explicitly coded-data-only (no cohort enumeration in P1)');

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
