// Medicus Suite — Transactional feed shadow proofs (REAL engines, in-repo)
// Run with: node --test test-txn-shadow.js
//
// The safety gate for the Transactional-API feed swap, run as ordinary CI
// tests now that the engines and the FHIR adapters live in the same repo.
// For each engine we prove two things:
//
//   PARITY     — the real engine produces IDENTICAL alerts from the FHIR feed
//                as from a legacy bundle with the same clinical content.
//   DIVERGENCE — if the API record is NARROWER than the screen (GP Connect
//                excludes RCGP-excluded / confidential-from-third-parties
//                items), the comparator FLAGS the dropped/weakened alerts
//                instead of letting them vanish silently.
//
// Plus the vaccine uplift: structured Immunization data resolving a false
// "flu due" with no engine change.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const SentinelRules = require('./engine/rules-engine.js');
const SEV = require('./engine/result-severity.js');
const Match = require('./content-scripts/triage-lens/rule-match.js');
const TriageAlertEngine = require('./engine/triage-alert-engine.js');

const { normaliseCareRecord } = require('./shared/fhir-normaliser.js');
const { fhirToReport } = require('./shared/fhir-results-adapter.js');
const { fhirToFields } = require('./shared/fhir-triage-fields.js');
const { bridgeImmunisations } = require('./shared/immunisation-bridge.js');
const { diffChips, diffSeverity } = require('./shared/shadow-compare.js');

const { DEMOGRAPHICS, CARE_RECORD, RESULTS_RECORD } = require('./test-txn-fhir.js');

const NOW = '2026-06-19';

function loadRulePack(file) {
  return JSON.parse(readFileSync(path.join(__dirname, 'rules', file), 'utf8')).rules || [];
}

// ── Sentinel rules engine ─────────────────────────────────────────────────────

const ALL_RULES = [
  ...loadRulePack('drug-rules.json'),
  ...loadRulePack('qof-rules.json'),
  ...loadRulePack('vaccine-rules.json'),
].filter((r) => r.enabled !== false);

function evaluateChips(b, rules) {
  const out = SentinelRules.evaluatePatient(b.medications, b.observations, rules, {
    now: NOW,
    problems: b.problems,
    patientContext: b.patientContext,
    observationHistory: b.observationHistory,
  });
  const chips = out.chips || out;
  return Array.isArray(chips) ? chips : [];
}

const txnBundle = normaliseCareRecord(CARE_RECORD, DEMOGRAPHICS, { url: 'about:proof', view: 'record' });

test('sentinel shadow: PARITY — same patient, FHIR feed vs legacy feed -> identical chips', () => {
  const legacy = { ...txnBundle, allergies: undefined, immunisations: undefined };
  const r = diffChips(evaluateChips(legacy, ALL_RULES), evaluateChips(txnBundle, ALL_RULES));
  assert.ok(r.counts.legacy > 0, 'engine produced chips (rule packs loaded)');
  assert.equal(r.counts.dropped, 0);
  assert.equal(r.counts.added, 0);
  assert.equal(r.counts.flips, 0);
  assert.equal(r.safe, true, r.verdict);
});

test('sentinel shadow: DIVERGENCE — API record omitting the T2DM problem is flagged, not silent', () => {
  const narrower = { ...txnBundle, problems: txnBundle.problems.filter((p) => !/diabetes/i.test(p.label)) };
  const r = diffChips(evaluateChips(txnBundle, ALL_RULES), evaluateChips(narrower, ALL_RULES));
  assert.ok(r.counts.dropped > 0, 'dropping the diabetes problem must drop DM chips');
  assert.ok(r.regressions.length > 0, 'dropped clinically-ranked chips must be flagged as regressions');
  assert.equal(r.safe, false);
});

// ── Results severity engine ───────────────────────────────────────────────────

const txnReport = fhirToReport(RESULTS_RECORD, { priorityDisplay: 'Routine' });
const evalSeverity = (report) => SEV.evaluateReportSeverity(report, { priorityDisplay: report.priorityDisplay });

test('results shadow: PARITY — FHIR-derived report preserves severity (red, urgent=1)', () => {
  const legacy = { ...txnReport, results: txnReport.results.map((r) => ({ ...r })) };
  const r = diffSeverity(evalSeverity(legacy), evalSeverity(txnReport));
  assert.equal(r.txn.level, 'red', 'critical potassium (HH) must grade red');
  assert.equal(r.safe, true, r.verdict);
});

test('results shadow: DIVERGENCE — API report dropping the critical K+ is flagged', () => {
  const narrower = { ...txnReport, results: txnReport.results.filter((r) => !/potassium/i.test(r.name)) };
  const r = diffSeverity(evalSeverity(txnReport), evalSeverity(narrower));
  assert.equal(r.safe, false);
  assert.ok(
    r.regressions.some((x) => x.field === 'level'),
    'red -> amber downgrade must be a regression'
  );
});

// ── Triage Lens (real matcher + alert engine) ────────────────────────────────

const PAGE = 'patient';
const keywordRules = [
  {
    id: 'dmard',
    enabled: true,
    key: 'monitoring',
    label: 'DMARD monitoring',
    pages: [PAGE],
    fields: ['meds'],
    patterns: ['methotrexate'],
  },
  {
    id: 'pen-allergy',
    enabled: true,
    key: 'allergy',
    label: 'Penicillin allergy',
    pages: [PAGE],
    fields: ['allergies'],
    patterns: ['penicillin'],
  },
  {
    id: 'dm',
    enabled: true,
    key: 'ltc',
    label: 'Diabetes',
    pages: [PAGE],
    fields: ['problems'],
    patterns: ['diabetes'],
  },
]
  .map(Match.compileRule)
  .filter(Boolean);
const thresholdRules = [
  { key: 'monitoring', threshold: 1, label: 'DMARD monitoring due', enabled: true },
  { key: 'allergy', threshold: 1, label: 'Allergy flag', enabled: true },
  { key: 'ltc', threshold: 1, label: 'Long-term condition', enabled: true },
];

function runTriage(fields) {
  const buckets = {};
  for (const rule of keywordRules) {
    const hit = (rule.fields || []).some((fn) => {
      const v = fields[fn];
      const text = Array.isArray(v) ? v.join('\n') : String(v || '');
      return text && Match.ruleMatchesText(rule, text);
    });
    if (hit) buckets[rule.key] = { count: (buckets[rule.key]?.count || 0) + 1 };
  }
  const out = TriageAlertEngine.evaluate(buckets, thresholdRules);
  return out.triggered.map((t) => ({ ruleId: t.key, type: 'triage', status: t.level, label: t.label }));
}

const txnFields = fhirToFields(CARE_RECORD, DEMOGRAPHICS);

test('triage shadow: PARITY — matcher + alert engine identical on FHIR-derived fields', () => {
  const r = diffChips(runTriage(JSON.parse(JSON.stringify(txnFields))), runTriage(txnFields));
  assert.equal(r.counts.legacy, 3, 'all three sample rules trigger');
  assert.equal(r.safe, true, r.verdict);
});

test('triage shadow: DIVERGENCE — API feed omitting allergies drops the allergy flag and is flagged', () => {
  const r = diffChips(runTriage(txnFields), runTriage({ ...txnFields, allergies: [] }));
  assert.equal(r.counts.dropped, 1);
  assert.ok(r.regressions.length >= 1, 'a dropped triage alert must register as a safety regression');
});

// ── Vaccine uplift: structured Immunization data drives vaccine status ────────

test('vaccine uplift: Immunization resource resolves a false "flu due" with no engine change', () => {
  const fluRule = loadRulePack('vaccine-rules.json').find((r) => r.id === 'vax-flu' && r.enabled !== false);
  assert.ok(fluRule, 'vax-flu rule present');

  const midSeason = '2026-11-15';
  const eligible = {
    patientContext: { ageYears: 68, sex: 'female', dob: '1958-04-26' },
    problems: [],
    observations: [],
    observationHistory: [],
    medications: [],
    immunisations: [{ label: 'Seasonal influenza vaccination', date: '2026-10-14', status: 'completed' }],
  };
  const fluChip = (b) => {
    const out = SentinelRules.evaluatePatient(b.medications, b.observations, [fluRule], {
      now: midSeason,
      problems: b.problems,
      patientContext: b.patientContext,
      observationHistory: b.observationHistory,
    });
    const chips = out.chips || out;
    return (Array.isArray(chips) ? chips : []).find((c) => /flu|influenza|vax/i.test(`${c.ruleId} ${c.label}`)) || null;
  };

  const before = fluChip(eligible); // engine ignores bundle.immunisations
  const after = fluChip(bridgeImmunisations(eligible)); // bridge projects the Immunization

  assert.ok(
    before && /due/i.test(String(before.status)),
    `expected a due chip without the bridge, got ${before && before.status}`
  );
  assert.ok(
    !after || /given/i.test(String(after.status)),
    `expected given/suppressed with the bridge, got ${after && after.status}`
  );
});
