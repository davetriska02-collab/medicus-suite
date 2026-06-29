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

  const { buildReadiness, buildReconciliation, diffReadiness } = require('./engine/cqc-evidence.js');
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
        drugClass: 'DMARD',
        drug: { match: ['Methotrexate', 'maxtrex', 'metoject', 'methotrexate'] }, // dup + case variant
        tests: [
          { name: 'FBC', intervalDays: 84 },
          { name: 'U&E', intervalDays: 84 },
          { name: 'LFT', intervalDays: 84 },
        ],
      },
      {
        type: 'drug-monitoring',
        id: 'lithium-maintenance',
        drugClass: 'Mood stabiliser',
        drug: { match: ['lithium', 'priadel', 'camcolit'] },
        tests: [
          { name: 'Lithium level', intervalDays: 90 },
          { name: 'U&E', intervalDays: 180 },
        ],
      },
      {
        type: 'drug-monitoring',
        id: 'amiodarone-maintenance',
        drugClass: 'Antiarrhythmic',
        drug: { match: ['amiodarone', 'cordarone'] },
        tests: [
          { name: 'TFT', intervalDays: 180 },
          { name: 'LFT', intervalDays: 180 },
        ],
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
  check(JSON.stringify(lower) === JSON.stringify([...lower].sort((a, b) => a.localeCompare(b))), 'matchedTerms sorted');
  check(
    !mt.includes('ignored-but-still-a-term'),
    'matched terms come ONLY from drug-monitoring rules (non-monitoring rule excluded)'
  );

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
  check(
    typeof r.coverage.undercountCaveat === 'string' && /floor, not a ceiling/.test(r.coverage.undercountCaveat),
    'undercountCaveat present (A5)'
  );
  check(
    typeof r.coverage.keeperProvenance === 'string' && r.coverage.keeperProvenance.length > 0,
    'keeperProvenance non-empty (A3)'
  );

  // Currency passthrough
  check(r.currency.overall === currency.overall, 'currency.overall passed through');
  check(Array.isArray(r.currency.files) && r.currency.files.length === 4, 'currency.files passed through');

  // Quality statements
  const qs = r.qualityStatements;
  check(Array.isArray(qs) && qs.length >= 3, 'at least 3 quality statements');
  const meds = qs.find((s) => s.qualityStatement === 'Safe and effective medicines management');
  const gov = qs.find((s) => s.qualityStatement === 'Governance: safety rules kept current');
  const transp = qs.find((s) => s.qualityStatement === 'Medicines coverage transparency');
  check(
    meds && meds.keyQuestion === 'Safe' && meds.evidenceCategory === 'Processes',
    'medicines-mgmt statement: Safe / Processes'
  );
  check(
    gov && gov.keyQuestion === 'Well-led' && gov.evidenceCategory === 'Processes',
    'governance statement: Well-led / Processes'
  );
  check(
    transp && transp.keyQuestion === 'Safe' && transp.evidenceCategory === 'Processes',
    'coverage-transparency statement: Safe / Processes'
  );

  // RAG derives from currency
  check(
    meds.rag === (currency.files.find((f) => f.id === 'drug') || {}).level,
    'medicines RAG derives from drug currency level'
  );
  check(gov.rag === currency.overall, 'governance RAG = currency.overall');
  check(transp.rag === 'green', 'coverage-transparency RAG green when matchedTerms present');

  // Provenance fields on each statement
  check(
    qs.every((s) => s.provenance && s.provenance.asAt && s.provenance.source),
    'every statement carries provenance{asAt,source}'
  );
  check(
    meds.provenance.source.includes('rules/drug-rules.json') && meds.provenance.source.includes('specVersion'),
    'medicines provenance.source names file + specVersion'
  );

  // No anchor → delta null
  check(r.delta === null, 'no anchor → delta null');

  // ── RAG amber path (stale drug rules) ───────────────────────────────────────
  console.log('\n--- RAG / toFix (stale drug) ---');
  const staleCurrency = RuleCurrency.assessRuleCurrency(
    [{ id: 'drug', lastUpdated: '2024-01-01', specVersion: drug.specVersion }],
    todayISO
  );
  const rStale = buildReadiness({ drug }, { todayISO, currency: staleCurrency, anchor: null });
  const medsStale = rStale.qualityStatements.find(
    (s) => s.qualityStatement === 'Safe and effective medicines management'
  );
  check(medsStale.rag === 'amber' || medsStale.rag === 'red', 'stale drug rules → medicines RAG amber/red');
  check(
    typeof medsStale.toFix === 'string' && /Keeper/.test(medsStale.toFix),
    'stale drug rules → toFix mentions The Keeper'
  );

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
  const forbidden = [
    'nhsnumber',
    'nhs number',
    'dateofbirth',
    'date of birth',
    'patientname',
    'firstname',
    'surname',
    'patientid',
  ];
  check(
    forbidden.every((k) => !blob.includes(k)),
    'no patient-identifiable field names in output'
  );
  // No 10-digit NHS-number-like token
  check(!/\b\d{10}\b/.test(JSON.stringify(r)), 'no NHS-number-shaped token in output');
  // No cohort/patient counts implied — coverage carries codedDataOnly + caveat, not patient totals
  check(r.coverage.codedDataOnly === true, 'output explicitly coded-data-only (no cohort enumeration in P1)');

  // ── buildReconciliation ─────────────────────────────────────────────────────
  console.log('\n--- buildReconciliation ---');

  // Produce a reconciliation directly from the fixture drug file.
  const recon = buildReconciliation(drug);

  check(recon && typeof recon === 'object', 'buildReconciliation returns an object');
  check(Array.isArray(recon.entries), 'reconciliation has entries array');
  check(typeof recon.caveat === 'string' && recon.caveat.length > 0, 'reconciliation carries coded-data caveat');
  check(/coded/i.test(recon.caveat), 'caveat mentions coded data');
  check(/floor/i.test(recon.caveat) || /ceiling/i.test(recon.caveat), 'caveat mentions floor/ceiling');

  // One entry per enabled drug-monitoring rule (3 in fixture: methotrexate, lithium, amiodarone).
  check(recon.entries.length === 3, 'one reconciliation entry per enabled drug-monitoring rule (3 in fixture)');

  // No entry for the noise rule (type 'other-thing').
  check(
    recon.entries.every((e) => e.ruleId !== 'noise'),
    'non-drug-monitoring rules produce no reconciliation entry'
  );

  // Each entry must carry a non-empty definition string and NO numeric count field.
  check(
    recon.entries.every((e) => typeof e.definition === 'string' && e.definition.length > 0),
    'every entry carries a non-empty definition string'
  );
  check(
    recon.entries.every((e) => !('count' in e) && !('patientCount' in e) && !('cohortSize' in e)),
    'no numeric count field on any reconciliation entry (honesty invariant)'
  );

  // Check that each entry has required fields.
  check(
    recon.entries.every((e) => e.ruleId && e.drugName && Array.isArray(e.matchTerms) && e.matchTerms.length > 0),
    'every entry has ruleId, drugName and matchTerms'
  );

  // Definition references the drug name and a test name.
  const mtkEntry = recon.entries.find((e) => e.ruleId === 'methotrexate-maintenance');
  check(mtkEntry != null, 'methotrexate-maintenance entry present');
  check(mtkEntry && /methotrexate/i.test(mtkEntry.definition), 'methotrexate definition names the drug');
  check(
    mtkEntry && /FBC|LFT|U&E/i.test(mtkEntry.definition),
    'methotrexate definition names at least one required test'
  );
  check(mtkEntry && /coded/i.test(mtkEntry.definition), 'definition carries the coded-data qualifier');

  // Definition contains an interval (derived from the rule's own intervalDays).
  check(
    mtkEntry && /week|month|year|day/i.test(mtkEntry.definition),
    'methotrexate definition carries a time interval'
  );

  // matchTerms carries the full drug.match list from the rule.
  check(
    mtkEntry &&
      mtkEntry.matchTerms.some((t) => /methotrexate/i.test(t)) &&
      mtkEntry.matchTerms.some((t) => /maxtrex/i.test(t)),
    'methotrexate entry matchTerms includes both generic and brand'
  );

  // buildReconciliation on null/empty input is safe (no throw).
  const reconNull = buildReconciliation(null);
  check(Array.isArray(reconNull.entries) && reconNull.entries.length === 0, 'null drug file → empty entries (safe)');

  const reconEmpty = buildReconciliation({ rules: [] });
  check(Array.isArray(reconEmpty.entries) && reconEmpty.entries.length === 0, 'empty rules → empty entries (safe)');

  // ── Per-exclude reasons (Eileen): each dropped term carries a clinical rationale ──
  {
    const recon = buildReconciliation({
      rules: [
        {
          type: 'drug-monitoring',
          id: 'hrt-systemic',
          drugClass: 'HRT',
          drug: { match: ['estradiol'], exclude: ['vagifem', 'qlaira'] },
          tests: [{ name: 'BP', intervalDays: 365 }],
        },
      ],
    });
    const e = recon.entries[0];
    check(e && Array.isArray(e.excludeDetails) && e.excludeDetails.length === 2, 'excludeDetails: one per exclude term');
    const vagifem = e.excludeDetails.find((d) => d.term === 'vagifem');
    const qlaira = e.excludeDetails.find((d) => d.term === 'qlaira');
    check(vagifem && /vaginal|systemic absorption/i.test(vagifem.reason), 'vaginal-oestrogen exclude carries its reason');
    check(qlaira && /contracept/i.test(qlaira.reason), 'contraceptive exclude carries its reason');
    check(
      e.excludeDetails.every((d) => typeof d.reason === 'string' && d.reason.length > 0),
      'no exclude is shown reason-less (generic fallback)'
    );
  }

  // ── Clinical methods & sources (Raj): named, drift-safe versions ──
  {
    const r2 = buildReadiness(ruleFiles, {
      todayISO,
      currency,
      clinicalMethods: {
        acb: { name: 'Anticholinergic burden', version: 'Boustani ACB scale (ACBcalc.com)', source: 'Boustani 2008' },
        stoppStart: { name: 'STOPP/START', version: 'v3 (2023)', source: 'OMahony 2023' },
      },
    });
    const cm = r2.clinicalMethods;
    check(Array.isArray(cm) && cm.length >= 3, 'clinicalMethods lists PINCER + ACB + STOPP/START');
    check(cm.some((m) => /STOPP\/START/.test(m.name) && /v3 \(2023\)/.test(m.version)), 'STOPP/START version named');
    check(cm.some((m) => /Boustani/.test(m.version)), 'ACB (Boustani) scale named');
    check(cm.some((m) => /PINCER/i.test(m.name) && m.inCurrency === true), 'PINCER named + flagged in rule-currency');
    check(
      cm.some((m) => /PINCER/i.test(m.name) && /\d+ of \d+ alert rules are PINCER-derived/.test(m.detail || '')),
      'PINCER detail reconciles count against total alert rules (Raj)'
    );
    check(cm.some((m) => /STOPP/.test(m.name) && m.inCurrency === false), 'engine methods flagged NOT in rule-currency');
  }

  // A disabled rule must not appear in reconciliation.
  const disabledDrug = {
    rules: [
      {
        type: 'drug-monitoring',
        enabled: false,
        id: 'disabled-rule',
        drug: { match: ['foo'] },
        tests: [{ name: 'FBC', intervalDays: 84 }],
      },
      {
        type: 'drug-monitoring',
        enabled: true,
        id: 'active-rule',
        drug: { match: ['bar'] },
        tests: [{ name: 'LFT', intervalDays: 84 }],
      },
    ],
  };
  const reconDisabled = buildReconciliation(disabledDrug);
  check(
    reconDisabled.entries.length === 1 && reconDisabled.entries[0].ruleId === 'active-rule',
    'disabled rules are excluded from reconciliation'
  );

  // ── reconciliation carried on buildReadiness output ─────────────────────────
  console.log('\n--- reconciliation on buildReadiness output ---');
  check(r.reconciliation && typeof r.reconciliation === 'object', 'readiness object carries reconciliation');
  check(
    Array.isArray(r.reconciliation.entries) && r.reconciliation.entries.length > 0,
    'readiness.reconciliation.entries non-empty'
  );
  check(
    typeof r.reconciliation.caveat === 'string' && r.reconciliation.caveat.length > 0,
    'readiness.reconciliation.caveat present'
  );

  // Honesty: reconciliation entries must never carry a count field.
  check(
    r.reconciliation.entries.every((e) => !('count' in e) && !('patientCount' in e)),
    'readiness.reconciliation entries carry no fabricated patient count (honesty invariant)'
  );

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
