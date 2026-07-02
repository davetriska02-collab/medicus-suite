// test-result-severity.js — unit tests for evaluateReportSeverity
// Run with: node test-result-severity.js
'use strict';

const {
  evaluateReportSeverity,
  extractPrior,
  matchUnclassifiedPositive,
  POSITIVE_QUALITATIVE,
  UNCLASSIFIED_NEGATORS,
  contextAllows,
} = require('./engine/result-severity.js');

// The REAL shipped result rules (root defaults.json is the source of truth) — used by
// the item 3.3 (calibration pass) section below to test the actual calibrated content,
// not a hand-rolled stand-in, mirroring test-chip-label-migration.js's own pattern.
const SHIPPED_RESULT_RULES = require('./defaults.json').resultRules || [];
function shippedRule(id) {
  const r = SHIPPED_RESULT_RULES.find((x) => x && x.id === id);
  if (!r) throw new Error(`shippedRule: no shipped resultRule with id "${id}"`);
  return r;
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Normal WBC: in-range, not urgent
const wbcNormal = {
  name: 'WBC',
  value: 4.6,
  rawValue: '4.6',
  comparator: null,
  unit: '× 10⁹/L',
  low: 4,
  high: 11,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-01-09',
  history: [],
};

// Above RDW, urgent
const rdwUrgent = {
  name: 'RDW',
  value: 16.7,
  rawValue: '16.7',
  comparator: null,
  unit: '%',
  low: 11,
  high: 15,
  isAbove: true,
  isBelow: false,
  urgent: true,
  interpretation: 'Above reference range',
  date: '2026-01-09',
  history: [],
};

// Above MCV, non-urgent
const mcvAbove = {
  name: 'MCV',
  value: 102,
  rawValue: '102',
  comparator: null,
  unit: 'fL',
  low: 80,
  high: 100,
  isAbove: true,
  isBelow: false,
  urgent: false,
  interpretation: 'Above reference range',
  date: '2026-01-09',
  history: [],
};

// Below sodium, non-urgent
const sodiumBelow = {
  name: 'Sodium',
  value: 129,
  rawValue: '129',
  comparator: null,
  unit: 'mmol/L',
  low: 133,
  high: 146,
  isAbove: false,
  isBelow: true,
  urgent: false,
  interpretation: 'Below reference range',
  date: '2026-01-09',
  history: [],
};

function makeReport(results, unmatched) {
  return {
    patientUuid: 'patient-uuid-123',
    unmatched: !!unmatched,
    results: results || [],
  };
}

// ── Urgent → red ──────────────────────────────────────────────────────────────
console.log('\n--- Urgent result → red ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal, rdwUrgent]));
  assert(out.level === 'red', 'urgent result → level red');
  assert(out.urgentCount === 1, 'urgentCount is 1');
  assert(out.abnormalCount === 1, 'abnormalCount includes the above+urgent RDW');
  assert(out.top !== null, 'top is not null');
  assert(out.top.name === 'RDW', 'top is the urgent result');
  assert(out.top.value === 16.7, 'top value correct');
  assert(out.top.unit === '%', 'top unit correct');
  assert(
    out.misprioritised === true,
    'red + no priorityDisplay → misprioritised true (missing priority not high/urgent/immediate)'
  );
}

// ── Above/below → amber ───────────────────────────────────────────────────────
console.log('\n--- Abnormal (non-urgent) → amber ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal, mcvAbove]));
  assert(out.level === 'amber', 'above-range non-urgent → level amber');
  assert(out.urgentCount === 0, 'urgentCount 0');
  assert(out.abnormalCount === 1, 'abnormalCount 1 (MCV above)');
  assert(out.top !== null, 'top is the first abnormal result');
  assert(out.top.name === 'MCV', 'top is MCV');
  assert(out.misprioritised === false, 'amber → misprioritised always false');
}
{
  const out = evaluateReportSeverity(makeReport([wbcNormal, sodiumBelow]));
  assert(out.level === 'amber', 'below-range non-urgent → level amber');
  assert(out.top.name === 'Sodium', 'top is Sodium (first abnormal)');
}

// ── All in range → none ───────────────────────────────────────────────────────
console.log('\n--- All in range → none ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal]));
  assert(out.level === 'none', 'all-in-range → level none');
  assert(out.urgentCount === 0, 'urgentCount 0');
  assert(out.abnormalCount === 0, 'abnormalCount 0');
  assert(out.top === null, 'top null when no abnormal/urgent result');
  assert(out.misprioritised === false, 'none → misprioritised false');
}
{
  const out = evaluateReportSeverity(makeReport([]));
  assert(out.level === 'none', 'empty results → level none');
  assert(out.top === null, 'empty results → top null');
}

// ── ungroupedResults included (via normaliser fixture piped through severity) ─
console.log('\n--- ungroupedResults path via report fixture ---');
{
  // Simulate a report built from both grouped + ungrouped by the normaliser:
  // two results in the array (one normal, one urgent); the severity engine
  // doesn't care how they got into report.results, just that both are counted.
  const report = makeReport([wbcNormal, rdwUrgent]);
  const out = evaluateReportSeverity(report);
  assert(out.urgentCount === 1, 'urgent result counted (ungrouped path)');
  assert(out.abnormalCount === 1, 'abnormal result counted (ungrouped path)');
}

// ── misprioritised: red + "Routine" → true ───────────────────────────────────
console.log('\n--- misprioritised: red + Routine ---');
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'Routine' });
  assert(out.level === 'red', 'red level');
  assert(out.misprioritised === true, 'red + Routine → misprioritised true');
}

// ── misprioritised: red + "High" → false ─────────────────────────────────────
console.log('\n--- misprioritised: red + High ---');
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'High' });
  assert(out.misprioritised === false, 'red + High → misprioritised false');
}
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'Urgent' });
  assert(out.misprioritised === false, 'red + Urgent → misprioritised false');
}
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'Immediate' });
  assert(out.misprioritised === false, 'red + Immediate → misprioritised false');
}
{
  // Case-insensitive check
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { priorityDisplay: 'HIGH' });
  assert(out.misprioritised === false, 'red + HIGH (uppercase) → misprioritised false');
}

// ── misprioritised: amber → always false ─────────────────────────────────────
console.log('\n--- misprioritised: amber always false ---');
{
  const out = evaluateReportSeverity(makeReport([mcvAbove]), { priorityDisplay: 'Routine' });
  assert(out.level === 'amber', 'level amber');
  assert(out.misprioritised === false, 'amber + Routine → misprioritised false');
}

// ── unmatched passthrough ─────────────────────────────────────────────────────
console.log('\n--- unmatched passthrough ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal], true));
  assert(out.unmatched === true, 'unmatched true passes through');
}
{
  const out = evaluateReportSeverity(makeReport([wbcNormal], false));
  assert(out.unmatched === false, 'unmatched false passes through');
}

// ── Urgent beats abnormal for top selection ───────────────────────────────────
console.log('\n--- top selection: urgent beats first abnormal ---');
{
  // mcvAbove comes first in array (non-urgent above), rdwUrgent second
  const out = evaluateReportSeverity(makeReport([mcvAbove, rdwUrgent]));
  assert(out.top.name === 'RDW', 'urgent RDW is top even though MCV is first in array');
}

// ── Garbage / null input → safe shape ────────────────────────────────────────
console.log('\n--- Garbage / null input ---');
{
  const out = evaluateReportSeverity(null);
  assert(out.level === 'none', 'null report → level none');
  assert(out.urgentCount === 0, 'null report → urgentCount 0');
  assert(out.abnormalCount === 0, 'null report → abnormalCount 0');
  assert(out.top === null, 'null report → top null');
  assert(out.misprioritised === false, 'null report → misprioritised false');
  assert(out.unmatched === false, 'null report → unmatched false');
}
{
  const out = evaluateReportSeverity({});
  assert(out.level === 'none', 'empty object → level none');
}
{
  const out = evaluateReportSeverity(makeReport([null, undefined, 'garbage']));
  assert(out.level === 'none', 'garbage result entries → skipped, level none');
}

// ── thresholds opt passed but not yet acted on ────────────────────────────────
console.log('\n--- thresholds opt accepted (extension point) ---');
{
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { thresholds: { Sodium: { red: 125 } } });
  assert(out.level === 'none', 'thresholds passed but not acted on → none for in-range result');
}

// ── resultRules: no rules → behaviour identical to baseline ──────────────────
console.log('\n--- resultRules: no rules supplied → unchanged baseline ---');
{
  // empty array: same as no opts
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [] });
  assert(out.level === 'none', 'empty resultRules → level none (unchanged)');
  assert(out.urgentCount === 0, 'empty resultRules → urgentCount 0');
  assert(out.abnormalCount === 0, 'empty resultRules → abnormalCount 0');
  assert(out.top === null, 'empty resultRules → top null');
}
{
  // no opts at all: unchanged urgent path
  const out = evaluateReportSeverity(makeReport([rdwUrgent]));
  assert(out.level === 'red', 'no resultRules → urgent still red');
  assert(out.urgentCount === 1, 'no resultRules → urgentCount 1');
}

// ── resultRules: rule escalates in-lab-range analyte to amber ─────────────────
console.log('\n--- resultRules: escalate normal analyte to amber ---');
{
  // WBC is 4.6 and in-range; rule: above 4.0 → amber
  const potassiumAmberRule = {
    id: 'rule_test_1',
    enabled: true,
    label: 'WBC mildly elevated',
    analyte: { match: ['wbc'] },
    comparator: 'above',
    amber: 4.0,
    red: null,
    unit: '× 10⁹/L',
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [potassiumAmberRule] });
  assert(out.level === 'amber', 'rule escalates in-range WBC 4.6 >= 4.0 amber → amber');
  assert(out.abnormalCount === 1, 'abnormalCount 1 after rule escalation to amber');
  assert(out.urgentCount === 0, 'urgentCount 0 (amber only)');
  assert(out.top !== null, 'top is set for rule-escalated result');
  assert(out.top.name === 'WBC', 'top name is WBC');
}

// ── resultRules: rule escalates to red ───────────────────────────────────────
console.log('\n--- resultRules: escalate normal analyte to red ---');
{
  // WBC is 4.6; rule: above 3.0 amber, 4.5 red
  const rule = {
    id: 'rule_test_2',
    enabled: true,
    label: 'WBC critical high',
    analyte: { match: ['wbc'] },
    comparator: 'above',
    amber: 3.0,
    red: 4.5,
    unit: '× 10⁹/L',
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [rule] });
  assert(out.level === 'red', 'rule escalates in-range WBC 4.6 >= 4.5 red → red');
  assert(out.urgentCount === 1, 'urgentCount 1 after rule escalation to red');
  assert(out.top.name === 'WBC', 'top is the rule-escalated result');
}

// ── resultRules: rule NEVER lowers a lab-urgent analyte ───────────────────────
console.log('\n--- resultRules: rule never lowers lab-urgent analyte ---');
{
  // rdwUrgent is lab-urgent; rule matches but evaluates to 'none' (value 16.7 is above amber 10.0 but
  // let us use a rule that would NOT fire for this value to prove lab-urgent stays urgent)
  const nonMatchingRule = {
    id: 'rule_test_3',
    enabled: true,
    label: 'RDW above 20',
    analyte: { match: ['rdw'] },
    comparator: 'above',
    amber: 20.0,
    red: 25.0,
    unit: '%',
  };
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { resultRules: [nonMatchingRule] });
  assert(out.level === 'red', 'lab-urgent stays red even when rule does not fire');
  assert(out.urgentCount === 1, 'urgentCount still 1 — rule cannot lower lab urgent');
}
{
  // rdwUrgent is lab-urgent; rule matches and fires at amber — should not downgrade to amber
  const amberRule = {
    id: 'rule_test_4',
    enabled: true,
    label: 'RDW above 15 amber',
    analyte: { match: ['rdw'] },
    comparator: 'above',
    amber: 15.0,
    red: null,
    unit: '%',
  };
  const out = evaluateReportSeverity(makeReport([rdwUrgent]), { resultRules: [amberRule] });
  assert(out.level === 'red', 'lab-urgent stays red; rule amber cannot lower it');
  assert(out.urgentCount === 1, 'urgentCount 1 — rule did not downgrade');
}

// ── resultRules: 'below' comparator ──────────────────────────────────────────
console.log('\n--- resultRules: below comparator ---');
{
  // wbcNormal value 4.6 — rule: below 5.0 amber, below 4.0 red → amber expected (4.6 <= 5.0, 4.6 > 4.0)
  const belowAmberRule = {
    id: 'rule_test_5',
    enabled: true,
    label: 'WBC low',
    analyte: { match: ['wbc'] },
    comparator: 'below',
    amber: 5.0,
    red: 4.0,
    unit: '× 10⁹/L',
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [belowAmberRule] });
  assert(out.level === 'amber', 'below: WBC 4.6 <= amber 5.0 → amber');
  assert(out.abnormalCount === 1, 'abnormalCount 1 for below escalation');
  assert(out.urgentCount === 0, 'urgentCount 0 (not <= red 4.0)');
}
{
  // wbcNormal value 4.6 — below red 4.7 → red expected
  const belowRedRule = {
    id: 'rule_test_6',
    enabled: true,
    label: 'WBC critically low',
    analyte: { match: ['wbc'] },
    comparator: 'below',
    amber: 5.0,
    red: 4.7,
    unit: '× 10⁹/L',
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [belowRedRule] });
  assert(out.level === 'red', 'below: WBC 4.6 <= red 4.7 → red');
  assert(out.urgentCount === 1, 'urgentCount 1 for below red escalation');
}
{
  // sodiumBelow value 129; rule: below 130 amber, 125 red → amber (129 <= 130, 129 > 125)
  const sodiumRule = {
    id: 'rule_test_7',
    enabled: true,
    label: 'Low sodium',
    analyte: { match: ['sodium'] },
    comparator: 'below',
    amber: 130,
    red: 125,
    unit: 'mmol/L',
  };
  const out = evaluateReportSeverity(makeReport([sodiumBelow]), { resultRules: [sodiumRule] });
  // sodiumBelow is already lab-abnormal (isBelow); rule should escalate further to amber or stay amber
  assert(out.level === 'amber', 'sodiumBelow lab-abnormal stays amber with matching below rule (no red)');
}

// ── resultRules: red >= amber ordering in matching (above comparator) ─────────
console.log('\n--- resultRules: red/amber ordering respected in above comparator ---');
{
  // Both amber and red set. Value 5.6 >= amber 5.5 but < red 6.0 → amber expected
  const potRule = {
    id: 'rule_test_8',
    enabled: true,
    label: 'High potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
    unit: 'mmol/L',
  };
  const potResult = {
    name: 'Serum Potassium',
    value: 5.6,
    rawValue: '5.6',
    comparator: null,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.1,
    isAbove: true,
    isBelow: false,
    urgent: false,
    interpretation: 'Above reference range',
    date: '2026-01-09',
    history: [],
  };
  const out = evaluateReportSeverity(makeReport([potResult]), { resultRules: [potRule] });
  assert(out.level === 'amber', '5.6 >= amber 5.5 but < red 6.0 → amber');
  assert(out.urgentCount === 0, 'urgentCount 0 (below red threshold)');
}
{
  // Value 6.1 >= red 6.0 → red expected
  const potRule = {
    id: 'rule_test_9',
    enabled: true,
    label: 'High potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
    unit: 'mmol/L',
  };
  const potResultHigh = {
    name: 'Serum Potassium',
    value: 6.1,
    rawValue: '6.1',
    comparator: null,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.1,
    isAbove: true,
    isBelow: false,
    urgent: false,
    interpretation: 'Above reference range',
    date: '2026-01-09',
    history: [],
  };
  const out = evaluateReportSeverity(makeReport([potResultHigh]), { resultRules: [potRule] });
  assert(out.level === 'red', '6.1 >= red 6.0 → red');
  assert(out.urgentCount === 1, 'urgentCount 1 for value at red threshold');
}

// ── resultRules: disabled rule is ignored ─────────────────────────────────────
console.log('\n--- resultRules: disabled rule is ignored ---');
{
  const disabledRule = {
    id: 'rule_test_10',
    enabled: false,
    label: 'WBC low disabled',
    analyte: { match: ['wbc'] },
    comparator: 'above',
    amber: 1.0,
    red: null,
    unit: '× 10⁹/L',
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [disabledRule] });
  assert(out.level === 'none', 'disabled rule → not applied → level none');
}

// ── Text-rule fixtures ────────────────────────────────────────────────────────

// Culture result with "No growth" text in rawValue — should be noGrowth
const msuNoGrowth = {
  name: 'MSU - Microscopy and Culture',
  value: NaN,
  rawValue: 'No growth',
  comparator: null,
  unit: null,
  low: null,
  high: null,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-06-10',
  history: [],
  text: 'No growth',
};

// Culture result with organism growth — should be review
const msuGrowth = {
  name: 'MSU - Microscopy and Culture',
  value: NaN,
  rawValue: 'Escherichia coli >10^5',
  comparator: null,
  unit: null,
  low: null,
  high: null,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: 'Significant growth identified',
  date: '2026-06-10',
  history: [],
  text: 'Escherichia coli >10^5 Significant growth identified',
};

// Culture result where "no growth" appears only in performerComments (via text field)
const msuNoGrowthInComments = {
  name: 'Urine culture',
  value: NaN,
  rawValue: 'See comments',
  comparator: null,
  unit: null,
  low: null,
  high: null,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-06-10',
  history: [],
  text: 'See comments No growth after 48 hours incubation',
};

// Non-microbiology result (potassium) — text rule must NOT match this
const potassiumResult = {
  name: 'Serum Potassium',
  value: 4.1,
  rawValue: '4.1',
  comparator: null,
  unit: 'mmol/L',
  low: 3.5,
  high: 5.1,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-06-10',
  history: [],
  text: '4.1',
};

// Standard MSU text rule
const msuTextRule = {
  id: 'rule_msu_text',
  enabled: true,
  kind: 'text',
  label: 'Needs review',
  analyte: { match: ['MSU', 'urine culture'] },
  normalText: ['no growth'],
  normalLabel: 'No growth',
};

// ── abnormalText (flag-if-present) fixtures: bowel cancer screening ──────────────

// Bowel cancer screening non-responder — the BCS:FOB result whose value is the
// "No response to ... invitation" coded finding. Should be flagged 'review'.
const bowelNonResponder = {
  name: 'BCS:FOB result',
  value: NaN,
  rawValue: 'No response to bowel cancer screening programme invitation (finding) (preliminary)',
  comparator: null,
  unit: null,
  low: null,
  high: null,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-06-10',
  history: [],
  text: 'No response to bowel cancer screening programme invitation (finding) (preliminary)',
};

// Normal bowel screening result — no "no response" phrase → left untouched (no chip).
const bowelNormal = {
  name: 'BCS:FOB result',
  value: NaN,
  rawValue: 'Bowel cancer screening programme: normal. No further action required.',
  comparator: null,
  unit: null,
  low: null,
  high: null,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-06-10',
  history: [],
  text: 'Bowel cancer screening programme: normal. No further action required.',
};

// Abnormal/positive bowel screening result — the non-responder rule must NOT flag it
// (it has no "no response" phrase) and must NOT calm it (abnormalText only ever flags).
// Critically "abnormal" contains the substring "normal" — a normalText approach would
// have mis-classed this as calm; abnormalText cannot.
const bowelAbnormal = {
  name: 'BCS:FOB result',
  value: NaN,
  rawValue: 'Bowel cancer screening programme abnormal — patient referred for colonoscopy',
  comparator: null,
  unit: null,
  low: null,
  high: null,
  isAbove: false,
  isBelow: false,
  urgent: false,
  interpretation: null,
  date: '2026-06-10',
  history: [],
  text: 'Bowel cancer screening programme abnormal — patient referred for colonoscopy',
};

// Bowel screening non-responder rule (abnormalText-only) — mirrors the shipped builtin.
const bowelRule = {
  id: 'rule_bowel_nonresponder',
  enabled: true,
  kind: 'text',
  label: 'Bowel screening: no response',
  analyte: { match: ['bcs:fob', 'bowel cancer screening', 'faecal occult blood'] },
  abnormalText: ['no response to bowel cancer screening', 'bowel cancer screening programme non-responder'],
};

// ── abnormalText: non-responder is flagged for review (amber) ────────────────────
console.log('\n--- abnormalText: bowel screening non-responder → review, amber ---');
{
  const out = evaluateReportSeverity(makeReport([bowelNonResponder]), { resultRules: [bowelRule] });
  assert(out.reviewCount === 1, 'non-responder → reviewCount 1');
  assert(out.noGrowthCount === 0, 'non-responder → noGrowthCount 0');
  assert(out.level === 'amber', 'non-responder → level amber');
  assert(out.reviewTop !== null, 'reviewTop is set');
  assert(out.reviewTop.name === 'BCS:FOB result', 'reviewTop.name is the BCS:FOB result');
  assert(
    out.reviewTop.label === 'Bowel screening: no response',
    'reviewTop.label carries the rule label (for the attributable chip)'
  );
}
{
  // Case-insensitive: the same finding in uppercase still matches.
  const upper = Object.assign({}, bowelNonResponder, {
    text: 'NO RESPONSE TO BOWEL CANCER SCREENING PROGRAMME INVITATION',
  });
  const out = evaluateReportSeverity(makeReport([upper]), { resultRules: [bowelRule] });
  assert(out.reviewCount === 1, 'uppercase non-responder text → still flagged (case-insensitive)');
}

// ── abnormalText: normal / abnormal screening results are left untouched ─────────
console.log('\n--- abnormalText: normal & positive screening results → none (never hidden) ---');
{
  const out = evaluateReportSeverity(makeReport([bowelNormal]), { resultRules: [bowelRule] });
  assert(out.reviewCount === 0, 'normal screening result → reviewCount 0 (no over-flag)');
  assert(out.noGrowthCount === 0, 'abnormalText-only rule never produces a noGrowth/calm chip');
  assert(out.level === 'none', 'normal screening result → level none');
}
{
  // The safety case: a positive/abnormal result must NOT be flagged by this rule AND must
  // NOT be calmed. "abnormal" contains "normal" — an abnormalText rule is immune to that trap.
  const out = evaluateReportSeverity(makeReport([bowelAbnormal]), { resultRules: [bowelRule] });
  assert(out.reviewCount === 0, 'abnormal result not flagged by the non-responder rule');
  assert(out.noGrowthCount === 0, 'abnormal result NOT calmed (no false-negative)');
  assert(out.level === 'none', 'abnormal result → none from this rule (a lab flag would still apply)');
}

// ── abnormalText: a positive flag wins over a normal phrase in the same rule ─────
console.log('\n--- abnormalText: flag wins over normal phrase (precedence) ---');
{
  // A rule with BOTH lists; the result text contains both a flag phrase and a normal phrase.
  // The explicit abnormalText flag must win — the result is reviewed, not calmed.
  const bothRule = {
    id: 'rule_both',
    enabled: true,
    kind: 'text',
    label: 'Flagged finding',
    analyte: { match: ['bcs:fob'] },
    normalText: ['no further action'],
    abnormalText: ['no response to bowel cancer screening'],
  };
  const mixed = Object.assign({}, bowelNonResponder, {
    text: 'No response to bowel cancer screening programme invitation. No further action recorded.',
  });
  const out = evaluateReportSeverity(makeReport([mixed]), { resultRules: [bothRule] });
  assert(out.reviewCount === 1, 'flag phrase present → review (wins over normal phrase)');
  assert(out.noGrowthCount === 0, 'not calmed despite a normal phrase being present');
  assert(out.reviewTop.label === 'Flagged finding', 'review label from the flagging rule');
}
{
  // Same rule, but only the normal phrase is present (no flag) → calm.
  const calm = Object.assign({}, bowelNormal, { text: 'Routine recall. No further action required.' });
  const bothRule = {
    id: 'rule_both',
    enabled: true,
    kind: 'text',
    label: 'Flagged finding',
    normalLabel: 'Routine',
    analyte: { match: ['bcs:fob'] },
    normalText: ['no further action'],
    abnormalText: ['no response to bowel cancer screening'],
  };
  const out = evaluateReportSeverity(makeReport([calm]), { resultRules: [bothRule] });
  assert(out.noGrowthCount === 1, 'normal phrase, no flag → noGrowth (calm)');
  assert(out.reviewCount === 0, 'no flag phrase → not reviewed');
  assert(out.level === 'none', 'calm normal phrase → level none');
}

// ── Text rules: whitespace/line-break robustness ─────────────────────────────────
// Lab reports hard-wrap free text, so a multi-word phrase can arrive split across a
// newline (or padded with double spaces / tabs). Matching must collapse whitespace on
// both sides, or a normal phrase is missed (benign result wrongly flagged) and — worse —
// an abnormalText flag phrase split across a line break silently fails to fire.
console.log('\n--- text rules: phrase matching survives lab line-wrapping ---');
{
  // Real histology report: "no evidence of dysplasia or malignancy" wrapped across a line
  // break (twice — once as "evidence\nof", once as "no\nevidence"), exactly as the lab sent it.
  const histologyText =
    'MICROSCOPY:\n' +
    'A: Sections show a benign fibroepithelial polyp. There is no evidence\n' +
    'of dysplasia or malignancy.\n' +
    'B: This is part of an intradermal melanocytic naevus. There is no\n' +
    'evidence of dysplasia or malignancy.\n' +
    'Dr Javier Perez Consultant Histopathologist.';
  const histologyResult = {
    name: 'Histology report',
    value: NaN,
    rawValue: histologyText,
    comparator: null,
    unit: null,
    low: null,
    high: null,
    isAbove: false,
    isBelow: false,
    urgent: false,
    interpretation: null,
    date: '2026-05-21',
    history: [],
    text: histologyText,
  };
  const histologyRule = {
    id: 'rule_histology',
    enabled: true,
    kind: 'text',
    label: 'Histology — review',
    normalLabel: 'Benign — no dysplasia/malignancy',
    analyte: { match: ['histology', 'microscopy', 'biopsy'] },
    normalText: ['no evidence of dysplasia or malignancy'],
  };
  const out = evaluateReportSeverity(makeReport([histologyResult]), { resultRules: [histologyRule] });
  assert(out.noGrowthCount === 1, 'normalText phrase wrapped across a newline still matches → noGrowth');
  assert(out.reviewCount === 0, 'wrapped benign histology is NOT wrongly flagged for review');
  assert(out.level === 'none', 'wrapped benign histology → level none (calm)');
}
{
  // The dangerous direction: an abnormalText flag phrase split across a line break MUST
  // still fire — otherwise a bowel screening non-responder would be silently missed.
  const wrapped = Object.assign({}, bowelNonResponder, {
    rawValue: 'No response to bowel cancer\nscreening programme invitation (finding)',
    text: 'No response to bowel cancer\nscreening programme invitation (finding)',
  });
  const out = evaluateReportSeverity(makeReport([wrapped]), { resultRules: [bowelRule] });
  assert(out.reviewCount === 1, 'abnormalText flag phrase wrapped across a newline still fires');
  assert(out.level === 'amber', 'wrapped non-responder → still amber (no false negative)');
}
{
  // Padding variants — double spaces and a tab between words — also collapse and match.
  const padded = Object.assign({}, bowelNonResponder, {
    text: 'No response to bowel cancer  screening\tprogramme invitation',
  });
  const out = evaluateReportSeverity(makeReport([padded]), { resultRules: [bowelRule] });
  assert(out.reviewCount === 1, 'double-space / tab padding between words still matches');
}

// ── Text-rule: no text rules → new counts are zero, existing fields unchanged ─
console.log('\n--- text rules: no text rules → zero counts, existing behaviour unchanged ---');
{
  const out = evaluateReportSeverity(makeReport([msuGrowth]));
  assert(out.reviewCount === 0, 'no text rules → reviewCount 0');
  assert(out.noGrowthCount === 0, 'no text rules → noGrowthCount 0');
  assert(out.reviewTop === null, 'no text rules → reviewTop null');
  assert(out.noGrowthTop === null, 'no text rules → noGrowthTop null');
  assert(out.level === 'none', 'no text rules → culture with growth is level none (no numeric flags)');
}
{
  // Ensure numeric rule-only path still works correctly alongside zero text counts
  const out = evaluateReportSeverity(makeReport([wbcNormal]), { resultRules: [] });
  assert(out.reviewCount === 0, 'empty resultRules → reviewCount 0');
  assert(out.noGrowthCount === 0, 'empty resultRules → noGrowthCount 0');
}

// ── Text-rule: growth present → review outcome, amber level ──────────────────
console.log('\n--- text rules: growth in result text → review, amber level ---');
{
  const out = evaluateReportSeverity(makeReport([msuGrowth]), { resultRules: [msuTextRule] });
  assert(out.reviewCount === 1, 'growth result → reviewCount 1');
  assert(out.noGrowthCount === 0, 'growth result → noGrowthCount 0');
  assert(out.level === 'amber', 'review result → level amber');
  assert(out.reviewTop !== null, 'reviewTop is set');
  assert(out.reviewTop.name === 'MSU - Microscopy and Culture', 'reviewTop.name is the culture result');
  assert(out.reviewTop.label === 'Needs review', 'reviewTop.label from rule.label');
  assert(out.noGrowthTop === null, 'noGrowthTop null when only review results');
}

// ── Text-rule: "No growth" in rawValue → noGrowth outcome, level stays none ──
console.log('\n--- text rules: "No growth" in text → noGrowth outcome, level stays none ---');
{
  const out = evaluateReportSeverity(makeReport([msuNoGrowth]), { resultRules: [msuTextRule] });
  assert(out.noGrowthCount === 1, '"no growth" in text → noGrowthCount 1');
  assert(out.reviewCount === 0, '"no growth" in text → reviewCount 0');
  assert(out.level === 'none', 'noGrowth does NOT raise level (calm informational)');
  assert(out.noGrowthTop !== null, 'noGrowthTop is set');
  assert(out.noGrowthTop.name === 'MSU - Microscopy and Culture', 'noGrowthTop.name correct');
  assert(out.noGrowthTop.label === 'No growth', 'noGrowthTop.label from rule.normalLabel');
  assert(out.reviewTop === null, 'reviewTop null when only noGrowth results');
}

// ── Text-rule: "no growth" in comments (via text field) → noGrowth ───────────
console.log('\n--- text rules: "no growth" found in comment text field → noGrowth ---');
{
  const out = evaluateReportSeverity(makeReport([msuNoGrowthInComments]), {
    resultRules: [msuTextRule],
  });
  assert(out.noGrowthCount === 1, '"no growth" in comment text → noGrowthCount 1');
  assert(out.level === 'none', 'noGrowth from comments → level stays none');
}

// ── Text-rule: matching is case-insensitive on both name and text ─────────────
console.log('\n--- text rules: case-insensitive name and text matching ---');
{
  // Rule matches "urine culture" (lowercase); result name uses "Urine culture" (mixed)
  // text is "See comments No growth after 48 hours incubation" — "no growth" is present
  const out = evaluateReportSeverity(makeReport([msuNoGrowthInComments]), {
    resultRules: [msuTextRule],
  });
  assert(out.noGrowthCount === 1, 'case-insensitive name match ("urine culture" in rule, "Urine culture" in result)');
}
{
  // result text has "NO GROWTH" in uppercase — normal phrase "no growth" should still match
  const msuUpperCase = Object.assign({}, msuNoGrowth, { text: 'NO GROWTH' });
  const out = evaluateReportSeverity(makeReport([msuUpperCase]), { resultRules: [msuTextRule] });
  assert(out.noGrowthCount === 1, 'case-insensitive text match ("NO GROWTH" matches "no growth")');
  assert(out.level === 'none', 'uppercase no-growth → level still none');
}

// ── Text-rule: rule does NOT match unrelated analyte ─────────────────────────
console.log('\n--- text rules: rule does not match unrelated result name ---');
{
  // potassiumResult has name "Serum Potassium" — neither "MSU" nor "urine culture" substring
  const out = evaluateReportSeverity(makeReport([potassiumResult]), {
    resultRules: [msuTextRule],
  });
  assert(out.reviewCount === 0, 'text rule not applied to non-matching result name');
  assert(out.noGrowthCount === 0, 'noGrowthCount 0 for non-matching result');
  assert(out.level === 'none', 'non-matching result → level none');
}

// ── Text-rule: numeric and text rules coexist independently ──────────────────
console.log('\n--- text rules: numeric and text rules coexist, additive ---');
{
  // Mix: msuGrowth gets text review; wbcNormal gets numeric amber rule escalation
  const wbcAmberRule = {
    id: 'rule_wbc_amber',
    enabled: true,
    label: 'WBC check',
    analyte: { match: ['wbc'] },
    comparator: 'above',
    amber: 4.0,
    red: null,
    unit: '× 10⁹/L',
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal, msuGrowth]), {
    resultRules: [wbcAmberRule, msuTextRule],
  });
  assert(out.abnormalCount === 1, 'WBC numeric escalation still counted in abnormalCount');
  assert(out.reviewCount === 1, 'MSU text rule fires → reviewCount 1');
  assert(out.level === 'amber', 'mixed: both abnormal and review → amber');
  // review result does NOT inflate abnormalCount
  assert(out.abnormalCount === 1, 'text-review does NOT increment abnormalCount');
}
{
  // noGrowth result does not add to abnormalCount; numeric abnormal still counts
  const out = evaluateReportSeverity(makeReport([mcvAbove, msuNoGrowth]), {
    resultRules: [msuTextRule],
  });
  assert(out.abnormalCount === 1, 'noGrowth result does NOT increment abnormalCount');
  assert(out.noGrowthCount === 1, 'noGrowthCount 1 for no-growth culture');
  assert(out.level === 'amber', 'MCV above keeps level amber (noGrowth alone would not)');
}

// ── Text-rule: review escalates to amber; noGrowth alone keeps none ───────────
console.log('\n--- text rules: review → amber; noGrowth alone → none ---');
{
  // Only a noGrowth result: level must stay none
  const out = evaluateReportSeverity(makeReport([msuNoGrowth]), { resultRules: [msuTextRule] });
  assert(out.level === 'none', 'noGrowth alone → level none (calm, no escalation)');
  assert(out.noGrowthCount === 1, 'noGrowthCount 1');
  assert(out.reviewCount === 0, 'reviewCount 0');
}
{
  // Only a review result: level must be amber
  const out = evaluateReportSeverity(makeReport([msuGrowth]), { resultRules: [msuTextRule] });
  assert(out.level === 'amber', 'review alone → level amber');
}

// ── Text-rule: disabled text rule is ignored ──────────────────────────────────
console.log('\n--- text rules: disabled text rule is ignored ---');
{
  const disabledTextRule = Object.assign({}, msuTextRule, {
    id: 'rule_msu_disabled',
    enabled: false,
  });
  const out = evaluateReportSeverity(makeReport([msuGrowth]), {
    resultRules: [disabledTextRule],
  });
  assert(out.reviewCount === 0, 'disabled text rule → not applied → reviewCount 0');
  assert(out.level === 'none', 'disabled text rule → level none');
}

// ── Text-rule: urgent numeric result + review together → red (urgent wins) ────
console.log('\n--- text rules: urgent numeric + review → red (urgent overrides) ---');
{
  const out = evaluateReportSeverity(makeReport([rdwUrgent, msuGrowth]), {
    resultRules: [msuTextRule],
  });
  assert(out.level === 'red', 'urgent numeric result → level red even with review result');
  assert(out.urgentCount === 1, 'urgentCount 1');
  assert(out.reviewCount === 1, 'reviewCount 1 (text review still tracked)');
}

// ── Text-rule: misprioritised unchanged by text rules ─────────────────────────
console.log('\n--- text rules: misprioritised not affected by text rules ---');
{
  // review → amber, so misprioritised is always false for amber
  const out = evaluateReportSeverity(makeReport([msuGrowth]), {
    resultRules: [msuTextRule],
    priorityDisplay: 'Routine',
  });
  assert(out.misprioritised === false, 'amber (from review) + Routine → misprioritised false');
}

// ── Text-rule: default labels when rule omits normalLabel ─────────────────────
console.log('\n--- text rules: default labels when normalLabel omitted ---');
{
  const ruleNoNormalLabel = {
    id: 'rule_msu_nolabel',
    enabled: true,
    kind: 'text',
    label: 'Culture needs review',
    analyte: { match: ['msu'] },
    normalText: ['no growth'],
    // normalLabel intentionally omitted
  };
  const out = evaluateReportSeverity(makeReport([msuNoGrowth]), {
    resultRules: [ruleNoNormalLabel],
  });
  assert(out.noGrowthTop !== null, 'noGrowthTop set even when normalLabel omitted');
  assert(out.noGrowthTop.label === 'No growth', 'default normalLabel is "No growth"');
}
{
  const ruleNoLabel = {
    id: 'rule_msu_nolabel2',
    enabled: true,
    kind: 'text',
    // label intentionally omitted — validate falls back to default
    label: '', // empty string → treated as missing, computeTextOutcome uses default
    analyte: { match: ['msu'] },
    normalText: ['no growth'],
  };
  const out = evaluateReportSeverity(makeReport([msuGrowth]), {
    resultRules: [ruleNoLabel],
  });
  // label is empty string → falsy → falls back to 'Needs review'
  assert(out.reviewTop !== null, 'reviewTop set even when label is empty');
  assert(out.reviewTop.label === 'Needs review', 'default label is "Needs review"');
}

// ── Text-rule: null report new keys are zero/null ─────────────────────────────
console.log('\n--- text rules: null report → new keys are zero/null ---');
{
  const out = evaluateReportSeverity(null);
  assert(out.reviewCount === 0, 'null report → reviewCount 0');
  assert(out.noGrowthCount === 0, 'null report → noGrowthCount 0');
  assert(out.reviewTop === null, 'null report → reviewTop null');
  assert(out.noGrowthTop === null, 'null report → noGrowthTop null');
}

// ── analyte.exclude: shared-token false positives are skipped ─────────────────
console.log('\n--- resultRules: analyte.exclude skips look-alike analytes ---');
function mkResult(name, value, extra) {
  return Object.assign(
    {
      name,
      value,
      rawValue: String(value),
      comparator: null,
      unit: null,
      low: null,
      high: null,
      isAbove: false,
      isBelow: false,
      urgent: false,
      interpretation: null,
      date: '2026-06-13',
      history: [],
    },
    extra || {}
  );
}
{
  // "haemoglobin" rule must NOT fire on "Haemoglobin A1c" (excluded), MUST on "Haemoglobin"
  const hbRule = {
    id: 'rule_hb_excl',
    enabled: true,
    label: 'Low Hb',
    analyte: { match: ['haemoglobin'], exclude: ['a1c'] },
    comparator: 'below',
    amber: 100,
    red: 70,
    unit: 'g/L',
  };
  const a1c = evaluateReportSeverity(makeReport([mkResult('Haemoglobin A1c', 50)]), {
    resultRules: [hbRule],
  });
  assert(a1c.level === 'none', 'exclude: HbA1c 50 not fired by haemoglobin rule');
  const hb = evaluateReportSeverity(makeReport([mkResult('Haemoglobin', 65)]), {
    resultRules: [hbRule],
  });
  assert(hb.level === 'red', 'exclude: real Haemoglobin 65 still fires red');
}
{
  // "platelet" rule must NOT fire on "Mean platelet volume" (8.4 fL)
  const pltRule = {
    id: 'rule_plt_excl',
    enabled: true,
    label: 'Low platelets',
    analyte: { match: ['platelet'], exclude: ['mean platelet'] },
    comparator: 'below',
    amber: 100,
    red: 30,
    unit: '×10⁹/L',
  };
  const mpv = evaluateReportSeverity(makeReport([mkResult('Mean platelet volume', 8.4)]), {
    resultRules: [pltRule],
  });
  assert(mpv.level === 'none', 'exclude: MPV 8.4 not fired by platelet rule');
  const plt = evaluateReportSeverity(makeReport([mkResult('Platelets', 25)]), {
    resultRules: [pltRule],
  });
  assert(plt.level === 'red', 'exclude: real Platelets 25 still fires red');
}
{
  // exclude is optional — absent exclude reproduces the false positive (proves it's the guard)
  const noExcl = {
    id: 'rule_noexcl',
    enabled: true,
    label: 'Low Hb',
    analyte: { match: ['haemoglobin'] },
    comparator: 'below',
    amber: 100,
    red: 70,
    unit: 'g/L',
  };
  const out = evaluateReportSeverity(makeReport([mkResult('Haemoglobin A1c', 50)]), {
    resultRules: [noExcl],
  });
  assert(out.level === 'red', 'without exclude, HbA1c 50 DOES match — exclude is what prevents it');
}

// ── Shipped base result rules (defaults.json) ────────────────────────────────
console.log('\n--- shipped base result rules: present, valid, and fire correctly ---');
{
  const defaults = require('./defaults.json');
  const { validateResultRule } = require('./engine/result-rules.js');
  const rules = Array.isArray(defaults.resultRules) ? defaults.resultRules : [];
  const baseIds = [
    'base-low-haemoglobin',
    'base-high-potassium',
    'base-low-sodium',
    'base-low-egfr',
    'base-low-platelets',
    'base-low-neutrophils',
    'base-high-inr',
    'base-hba1c-prediabetes',
    'base-hba1c-diabetes',
  ];
  for (const id of baseIds) {
    const r = rules.find((x) => x && x.id === id);
    assert(!!r, `base rule present in defaults.json: ${id}`);
    if (r) {
      assert(r.builtin === true && r.enabled === true, `${id}: builtin + enabled`);
      assert(validateResultRule(r).length === 0, `${id}: validates clean`);
    }
  }
  // Fire the full shipped base set against representative results (mostly RED-ONLY;
  // potassium gained an amber band in item 3.3 — see below).
  const baseSet = rules.filter((r) => baseIds.includes(r.id));
  const fire = (name, value, problems) =>
    evaluateReportSeverity(makeReport([mkResult(name, value)]), { resultRules: baseSet, problems }).level;
  // Red-only: only critically-deranged values fire; the rest are left to the lab flag (none here).
  assert(fire('Haemoglobin', 65) === 'red', 'base: Haemoglobin 65 → red');
  assert(fire('Haemoglobin', 78) === 'red', 'base: Haemoglobin 78 → red (red threshold ≤80)');
  assert(fire('Haemoglobin', 95) === 'none', 'base: Haemoglobin 95 → none (red-only, >80, CSO-lowered from 100)');
  assert(fire('Haemoglobin', 130) === 'none', 'base: Haemoglobin 130 → none');
  assert(fire('Potassium', 6.6) === 'red', 'base: Potassium 6.6 → red');
  // item 3.3 added an amber band (UKKA "moderate" 6.0–6.4) below the pre-existing red 6.5.
  assert(fire('Potassium', 6.2) === 'amber', 'base: Potassium 6.2 → amber (item 3.3 amber band, was none)');
  assert(fire('Potassium', 5.8) === 'none', 'base: Potassium 5.8 → none (below the new amber 6.0)');
  assert(fire('Urine potassium', 60) === 'none', 'base: Urine potassium 60 → none (excluded)');
  assert(fire('Sodium', 118) === 'red', 'base: Sodium 118 → red');
  assert(fire('Sodium', 125) === 'none', 'base: Sodium 125 → none (red-only, >120)');
  assert(fire('eGFR', 12) === 'red', 'base: eGFR 12 → red');
  assert(fire('eGFR (CKD-EPI)', 28) === 'none', 'base: eGFR 28 → none (red-only, ≥15)');
  assert(fire('Platelets', 25) === 'red', 'base: Platelets 25 → red');
  assert(fire('Mean platelet volume', 8.4) === 'none', 'base: MPV 8.4 → none (excluded)');
  assert(fire('Neutrophils', 0.4) === 'red', 'base: Neutrophils 0.4 → red');
  assert(fire('INR', 8.5) === 'red', 'base: INR 8.5 → red');
  assert(fire('INR', 5.5) === 'none', 'base: INR 5.5 → none (red-only, <8)');

  // HbA1c conditional flags. item 3.3 demoted the ≥48 "possible diabetes" outcome from
  // red to amber (48 is the WHO/NICE NG28 DIAGNOSTIC threshold, not itself urgent —
  // alert-fatigue fix); every case below that used to assert 'red' now asserts 'amber'.
  assert(fire('HbA1c', 50) === 'amber', 'base: HbA1c 50, no record → amber (possible diabetes, item 3.3 demotion)');
  assert(fire('HbA1c', 44) === 'amber', 'base: HbA1c 44, no record → amber (prediabetes)');
  assert(fire('HbA1c', 38) === 'none', 'base: HbA1c 38 → none');
  // Known diabetic → diabetes flag suppressed (and prediabetes too)
  assert(
    fire('HbA1c', 60, [{ label: 'Type 2 diabetes mellitus' }]) === 'none',
    'base: HbA1c 60 with T2DM on record → none (suppressed)'
  );
  // Known prediabetic with a NEW diabetic-range HbA1c → diabetes flag still fires (progression)
  assert(
    fire('HbA1c', 50, [{ label: 'Pre-diabetes' }]) === 'amber',
    'base: HbA1c 50 with prediabetes on record → amber (progression to diabetes still flagged)'
  );
  // "non-diabetic hyperglycaemia" must NOT suppress the diabetes flag (footgun guard)
  assert(
    fire('HbA1c', 50, [{ label: 'Non-diabetic hyperglycaemia' }]) === 'amber',
    'base: HbA1c 50 with non-diabetic hyperglycaemia → amber (not a diabetes diagnosis)'
  );
  // Prediabetes flag suppressed once prediabetes is on record
  assert(
    fire('HbA1c', 44, [{ label: 'Impaired glucose tolerance' }]) === 'none',
    'base: HbA1c 44 with IGT on record → none (prediabetes suppressed)'
  );
  // H1 (patient-safety): a FAMILY HISTORY code must NOT suppress the new-diabetes flag
  assert(
    fire('HbA1c', 52, [{ label: 'Family history of diabetes mellitus' }]) === 'amber',
    'H1: HbA1c 52 with "Family history of diabetes mellitus" → amber (NOT suppressed)'
  );
  // M1 (alert fatigue): known diabetics coded without "mellitus"/"type N" still suppress
  assert(
    fire('HbA1c', 60, [{ label: 'Steroid-induced diabetes' }]) === 'none',
    'M1: steroid-induced diabetes → suppressed'
  );
  assert(fire('HbA1c', 60, [{ label: 'Pancreatic diabetes' }]) === 'none', 'M1: pancreatic diabetes → suppressed');
  assert(fire('HbA1c', 60, [{ label: 'Type-2 diabetes' }]) === 'none', 'M1: hyphenated "Type-2 diabetes" → suppressed');
  assert(fire('HbA1c', 60, [{ label: 'T2DM' }]) === 'none', 'M1: "T2DM" abbreviation → suppressed');
  // Broadened match must NOT over-suppress the footgun look-alikes
  assert(
    fire('HbA1c', 52, [{ label: 'Pre-diabetic retinopathy' }]) === 'amber',
    'pre-diabetic retinopathy → amber (not suppressed)'
  );
  assert(
    fire('HbA1c', 52, [{ label: 'Diabetes insipidus' }]) === 'amber',
    'diabetes insipidus → amber (not suppressed)'
  );

  // Attributable rule label flows onto top for rule-driven escalations
  const ruleDrivenRed = evaluateReportSeverity(makeReport([mkResult('Potassium', 6.7)]), { resultRules: baseSet });
  assert(
    ruleDrivenRed.top && ruleDrivenRed.top.ruleLabel && /potassium/i.test(ruleDrivenRed.top.ruleLabel),
    'rule-driven red carries top.ruleLabel naming the rule'
  );
  // A lab-urgent result (no rule) carries no ruleLabel
  const labUrgent = evaluateReportSeverity(makeReport([rdwUrgent]));
  assert(labUrgent.top && labUrgent.top.ruleLabel == null, 'lab-driven urgent has null top.ruleLabel');
}

// ── suppressIfProblem: the non-diabetic / pre-diabetic footgun guards ─────────
console.log('\n--- suppressIfProblem: word-boundary match + substring exclude ---');
{
  const diabetesRule = {
    id: 'rule_dm',
    enabled: true,
    label: 'Possible diabetes',
    analyte: { match: ['hba1c'] },
    comparator: 'above',
    red: 48,
    unit: 'mmol/mol',
    suppressIfProblem: {
      match: ['diabetes mellitus', 'type 2 diabetes', 'diabetic'],
      exclude: ['non-diabetic', 'pre-diabetic', 'prediabetes', 'pre-diabetes'],
    },
  };
  const lvl = (problems) =>
    evaluateReportSeverity(makeReport([mkResult('HbA1c', 52)]), { resultRules: [diabetesRule], problems }).level;
  assert(lvl([]) === 'red', 'suppress: no problems → fires red (fail-open)');
  assert(lvl(undefined) === 'red', 'suppress: undefined problems → fires red (fail-open)');
  assert(lvl([{ label: 'Type 2 diabetes mellitus' }]) === 'none', 'suppress: T2DM on record → suppressed');
  assert(lvl([{ label: 'Diabetic nephropathy' }]) === 'none', 'suppress: "diabetic nephropathy" → suppressed');
  assert(
    lvl([{ label: 'Non-diabetic hyperglycaemia' }]) === 'red',
    'suppress: "non-diabetic hyperglycaemia" → NOT suppressed (exclude wins)'
  );
  assert(
    lvl([{ label: 'Pre-diabetic retinopathy' }]) === 'red',
    'suppress: "pre-diabetic retinopathy" → NOT suppressed (exclude wins)'
  );
  assert(lvl([{ label: 'Prediabetes' }]) === 'red', 'suppress: "prediabetes" → NOT suppressed (excluded)');
  assert(lvl([{ label: 'Hypertension' }]) === 'red', 'suppress: unrelated problem → fires');
}

// ── Shipped builtin result rules: schema-valid + behave as labelled ───────────
// Guards the rules baked into defaults.json so a bad edit (wrong comparator,
// out-of-order thresholds, dropped match string) fails CI rather than silently
// shipping a non-firing patient-safety rule.
console.log('\n--- Shipped builtin resultRules: valid + fire as documented ---');
{
  const { validateResultRule } = require('./engine/result-rules.js');
  const shipped = require('./defaults.json').resultRules;

  assert(Array.isArray(shipped) && shipped.length > 0, 'defaults.json ships a non-empty resultRules array');

  let allValid = true;
  shipped.forEach((r) => {
    const errs = validateResultRule(r);
    if (errs.length) {
      allValid = false;
      console.error(`    ${r && r.id}: ${errs.join('; ')}`);
    }
  });
  assert(allValid, 'every shipped result rule validates against the schema');

  const byId = Object.fromEntries(shipped.map((r) => [r.id, r]));
  // The six rules added in this change must all be present.
  [
    'base-lithium-toxicity',
    'base-digoxin-toxicity',
    'base-low-potassium',
    'base-high-calcium',
    'base-egfr-amber',
    'base-blood-culture',
  ].forEach((id) => {
    assert(!!byId[id], `shipped rules include ${id}`);
  });

  // Helper: build a single-result report and grade it with the shipped rules.
  const grade = (name, value) =>
    evaluateReportSeverity(makeReport([{ name, value, urgent: false, isAbove: false, isBelow: false }]), {
      resultRules: shipped,
    });
  const gradeText = (name, text) =>
    evaluateReportSeverity(makeReport([{ name, value: null, text, urgent: false, isAbove: false, isBelow: false }]), {
      resultRules: shipped,
    });

  // Lithium: 0.8 calm, 1.2 amber (supratherapeutic), 1.8 red (toxic).
  assert(grade('Serum lithium', 0.8).level === 'none', 'lithium 0.8 → none (in target range)');
  assert(grade('Serum lithium', 1.2).level === 'amber', 'lithium 1.2 → amber (supratherapeutic)');
  assert(grade('Serum lithium', 1.8).level === 'red', 'lithium 1.8 → red (toxic)');

  // Digoxin: 1.0 calm, 2.4 red (toxic).
  assert(grade('Digoxin level', 1.0).level === 'none', 'digoxin 1.0 → none');
  assert(grade('Digoxin level', 2.4).level === 'red', 'digoxin 2.4 → red (toxic)');

  // Low potassium gap-fill: 2.8 amber, 2.3 red. (High-K rule untouched: 7.0 → red.)
  assert(grade('Serum potassium', 2.8).level === 'amber', 'potassium 2.8 → amber (hypokalaemia)');
  assert(grade('Serum potassium', 2.3).level === 'red', 'potassium 2.3 → red (severe hypokalaemia)');
  assert(grade('Serum potassium', 7.0).level === 'red', 'potassium 7.0 → red (existing high-K rule still fires)');
  // Urinary potassium must NOT trip the serum rule (exclude).
  assert(grade('Urine potassium', 2.0).level === 'none', 'urine potassium 2.0 → none (excluded)');

  // Hypercalcaemia: 2.7 amber, 3.2 red; ionised calcium must not false-fire.
  assert(grade('Adjusted calcium', 2.7).level === 'amber', 'adjusted calcium 2.7 → amber');
  assert(grade('Corrected calcium', 3.2).level === 'red', 'corrected calcium 3.2 → red (severe hypercalcaemia)');
  assert(grade('Ionised calcium', 1.3).level === 'none', 'ionised calcium 1.3 → none (excluded)');

  // eGFR amber band (CKD G4) added; existing red <15 preserved.
  assert(grade('eGFR', 25).level === 'amber', 'eGFR 25 → amber (CKD G4 band)');
  assert(grade('eGFR', 12).level === 'red', 'eGFR 12 → red (existing G5 rule still fires)');
  assert(grade('eGFR', 55).level === 'none', 'eGFR 55 → none');

  // Blood culture text rule: a known-negative phrase calms (noGrowth); anything else
  // (e.g. an organism isolated) escalates to review — it can never hide a positive.
  const calm = gradeText('Blood culture', 'No growth after 5 days');
  assert(calm.level === 'none' && calm.noGrowthCount === 1, 'blood culture "no growth" → calm noGrowth');
  const pos = gradeText('Blood culture', 'Staphylococcus aureus isolated');
  assert(pos.level === 'amber' && pos.reviewCount === 1, 'blood culture with organism → amber review');
  // "Gram negative" in a positive report must NOT calm it (no bare "negative" phrase).
  const gramNeg = gradeText('Blood culture', 'Escherichia coli (Gram negative bacilli) isolated');
  assert(
    gramNeg.level === 'amber' && gramNeg.reviewCount === 1,
    'blood culture "Gram negative ... isolated" → still amber review'
  );
}

// ── The Keeper additions: hypocalcaemia / hypomagnesaemia / TSH (enabled) ─────
// These four were CSO-signed-off and enabled. Guard: they are enabled, fire as
// shipped, and exclude / suppress correctly.
console.log('\n--- Keeper rules: low-Ca / low-Mg / TSH enabled, fire/exclude/suppress ---');
{
  const shipped = require('./defaults.json').resultRules;
  const byId = Object.fromEntries(shipped.map((r) => [r.id, r]));
  const keeperIds = ['base-low-calcium', 'base-low-magnesium', 'base-high-tsh', 'base-low-tsh'];

  keeperIds.forEach((id) => {
    assert(byId[id] && byId[id].enabled === true, `${id} is enabled (CSO signed off; live in defaults)`);
  });

  // As shipped (now enabled), a critical value fires.
  const asShipped = (name, value) =>
    evaluateReportSeverity(makeReport([{ name, value, urgent: false, isAbove: false, isBelow: false }]), {
      resultRules: shipped,
    });
  assert(asShipped('Adjusted calcium', 1.5).level === 'red', 'enabled low-Ca rule fires red as shipped');
  assert(asShipped('Serum magnesium', 0.3).level === 'red', 'enabled low-Mg rule fires red as shipped');
  assert(asShipped('TSH', 50).level === 'red', 'enabled high-TSH rule fires red as shipped');
  assert(asShipped('TSH', 0.005).level === 'red', 'enabled suppressed-TSH rule fires red as shipped');

  // Force-enable a single rule and grade against it (+ optional problem list).
  const withRule = (id, name, value, problems) =>
    evaluateReportSeverity(makeReport([{ name, value, text: '', urgent: false, isAbove: false, isBelow: false }]), {
      resultRules: [{ ...byId[id], enabled: true }],
      problems: problems || [],
    });

  // Hypocalcaemia: matches adjusted/corrected only; amber 2.1, red 1.9; ionised excluded.
  assert(withRule('base-low-calcium', 'Adjusted calcium', 2.05).level === 'amber', 'adjusted calcium 2.05 → amber');
  assert(withRule('base-low-calcium', 'Corrected calcium', 1.8).level === 'red', 'corrected calcium 1.8 → red');
  assert(
    withRule('base-low-calcium', 'Ionised calcium', 1.1).level === 'none',
    'ionised calcium 1.1 → none (excluded)'
  );
  // Deliberate design: a bare/un-adjusted "Calcium" must NOT trip the low rule (hypoalbuminaemia false-positive guard).
  assert(
    withRule('base-low-calcium', 'Calcium', 1.8).level === 'none',
    'bare "Calcium" 1.8 → none (adjusted-only match)'
  );

  // Hypomagnesaemia: amber 0.6, red 0.5; urine excluded.
  assert(withRule('base-low-magnesium', 'Serum magnesium', 0.58).level === 'amber', 'magnesium 0.58 → amber');
  assert(withRule('base-low-magnesium', 'Magnesium', 0.4).level === 'red', 'magnesium 0.4 → red');
  assert(withRule('base-low-magnesium', 'Urine magnesium', 0.4).level === 'none', 'urine magnesium → none (excluded)');

  // High TSH: amber 10, red 20; "TSH receptor antibody" excluded; suppressed by hypothyroidism on record.
  assert(withRule('base-high-tsh', 'TSH', 12).level === 'amber', 'TSH 12 → amber');
  assert(withRule('base-high-tsh', 'TSH', 25).level === 'red', 'TSH 25 → red');
  assert(
    withRule('base-high-tsh', 'TSH receptor antibody', 40).level === 'none',
    'TSH receptor antibody → none (excluded)'
  );
  assert(
    withRule('base-high-tsh', 'TSH', 25, [{ label: 'Hypothyroidism' }]).level === 'none',
    'high TSH suppressed when hypothyroidism is on the problem record'
  );

  // Suppressed TSH: amber 0.1, red 0.01; suppressed by thyrotoxicosis/carbimazole on record.
  assert(withRule('base-low-tsh', 'TSH', 0.05).level === 'amber', 'TSH 0.05 → amber');
  assert(withRule('base-low-tsh', 'TSH', 0.005).level === 'red', 'TSH 0.005 → red');
  assert(
    withRule('base-low-tsh', 'TSH', 0.005, [{ label: 'Thyrotoxicosis on carbimazole' }]).level === 'none',
    'suppressed TSH suppressed when thyrotoxicosis is on the problem record'
  );
}

// ── The Keeper: culture/blood-culture abnormalText positive-flag guard ────────
// Hardening for the result-triage false-calm hazard: a POSITIVE culture whose free text
// ALSO contains a "no growth" normalText substring (e.g. a blood culture positive in only
// one bottle: "...; no growth in anaerobic bottle") was being silently CALMED. The shipped
// msu-culture and base-blood-culture rules now carry abnormalText positive flags
// (sensitivities / Gram / organism / growth-quantity terms), checked FIRST so a positive is
// forced to review. Guard: positives → review; true negatives & contaminants → still calm.
console.log('\n--- Keeper: culture abnormalText positive-flag guard (shipped rules) ---');
{
  const shipped = require('./defaults.json').resultRules;
  const byId = Object.fromEntries(shipped.map((r) => [r.id, r]));
  const run = (name, text) =>
    evaluateReportSeverity(makeReport([{ name, value: NaN, urgent: false, isAbove: false, isBelow: false, text }]), {
      resultRules: shipped,
    });

  // msu-culture
  assert(
    Array.isArray(byId['msu-culture'].abnormalText) && byId['msu-culture'].abnormalText.length > 0,
    'msu-culture ships an abnormalText positive-flag set'
  );
  assert(
    run('MSU - Microscopy and Culture', 'No growth after 48 hours.').noGrowthCount === 1,
    'urine "No growth" → still calmed (noGrowth)'
  );
  assert(
    run(
      'Mid-stream urine',
      'Mixed growth of 3 organisms — probable contamination. No significant growth of a urinary pathogen.'
    ).noGrowthCount === 1,
    'urine contaminant "no significant growth" → still calmed (not over-flagged — "mixed growth" was dropped)'
  );
  assert(
    run(
      'Urine culture',
      'Significant growth of Escherichia coli >10^5 cfu/mL. No significant growth of a second organism. Sensitive to nitrofurantoin, resistant to trimethoprim.'
    ).reviewCount === 1,
    'urine positive carrying a "no significant growth" substring → review (not falsely calmed)'
  );

  // base-blood-culture (highest stakes)
  assert(
    Array.isArray(byId['base-blood-culture'].abnormalText) && byId['base-blood-culture'].abnormalText.length > 0,
    'base-blood-culture ships an abnormalText positive-flag set'
  );
  assert(
    run('Blood culture', 'No growth after 5 days incubation.').noGrowthCount === 1,
    'blood culture "No growth after 5 days" → still calmed'
  );
  {
    const positiveOneBottle = run(
      'Blood culture',
      'Staphylococcus aureus grown in aerobic bottle; no growth in anaerobic bottle. Gram-positive cocci in clusters seen. Sensitive to flucloxacillin.'
    );
    assert(
      positiveOneBottle.reviewCount === 1,
      'blood culture positive with "no growth in anaerobic bottle" substring → review (not falsely calmed)'
    );
    assert(positiveOneBottle.noGrowthCount === 0, 'blood culture positive-in-one-bottle is NOT counted as noGrowth');
  }

  // v21 false-amber negation fix: bare "gram positive"/"gram negative"/"candida" substrings
  // used to collide with NEGATIVE phrasing ("No gram negative organisms isolated", "Candida
  // species not isolated") and trip a false-amber review. Replaced with morphology-qualified
  // gram-stain terms and named candida species, which do not appear in negation phrasing.
  assert(
    run('Blood culture', 'No growth after 5 days. No gram negative organisms isolated.').noGrowthCount === 1,
    'blood culture "No gram negative organisms isolated" (negative) → calmed, not falsely reviewed'
  );
  assert(
    run('Blood culture', 'Candida species not isolated. No growth after 5 days.').noGrowthCount === 1,
    'blood culture "Candida species not isolated" (negative) → calmed, not falsely reviewed'
  );
  // Genuine positives still fire — including an interim gram-film-only report with no
  // genus name yet, proving the morphology-qualified terms alone still carry a positive.
  assert(
    run('Blood culture', 'Escherichia coli (Gram negative bacilli) isolated').reviewCount === 1,
    'blood culture genuine positive (named organism) → still review'
  );
  assert(
    run('Blood culture', 'Gram-positive cocci in clusters seen; identification to follow').reviewCount === 1,
    'blood culture interim gram-film-only positive (no genus name yet) → still review'
  );
  assert(
    run('Blood culture', 'Candida albicans isolated from both bottles').reviewCount === 1,
    'blood culture genuine candida positive (named species) → still review'
  );
}

// ── Word-boundary normalText matching (calm path tightened; flag path left broad) ─
// normalText is matched word-boundary-aware so a short normal token cannot false-calm
// inside a larger word ("normal" ⊂ "abnormal", "negative" ⊂ "seronegative"). abnormalText
// is DELIBERATELY left substring, so the positive-flag path stays broad and still catches
// inflections ("candida" ⊂ "candidaemia"). Both biases point the same safe way: toward review.
console.log('\n--- word-boundary normalText: short token cannot false-calm inside a larger word ---');
{
  // normalText "normal" must NOT match inside "abnormal" → flagged for review, not calmed.
  const rule = {
    id: 'wb_normal',
    enabled: true,
    kind: 'text',
    label: 'Needs review',
    normalLabel: 'Normal',
    analyte: { match: ['cytology'] },
    normalText: ['normal'],
  };
  const abnormal = evaluateReportSeverity(
    makeReport([
      {
        name: 'Cervical cytology',
        value: NaN,
        urgent: false,
        isAbove: false,
        isBelow: false,
        text: 'Result: abnormal — high-grade dyskaryosis. Refer colposcopy.',
      },
    ]),
    { resultRules: [rule] }
  );
  assert(
    abnormal.noGrowthCount === 0 && abnormal.reviewCount === 1,
    'normalText "normal" does NOT calm "abnormal" (word-boundary) → review'
  );
  // A genuine whole-word "normal" is still calmed.
  const genuine = evaluateReportSeverity(
    makeReport([
      {
        name: 'Cervical cytology',
        value: NaN,
        urgent: false,
        isAbove: false,
        isBelow: false,
        text: 'Result: normal. Routine recall in 3 years.',
      },
    ]),
    { resultRules: [rule] }
  );
  assert(genuine.noGrowthCount === 1, 'normalText "normal" still calms a genuine whole-word "normal"');

  // "negative" must NOT calm "seronegative".
  const seroRule = {
    id: 'wb_neg',
    enabled: true,
    kind: 'text',
    label: 'Needs review',
    normalLabel: 'Negative',
    analyte: { match: ['serology'] },
    normalText: ['negative'],
  };
  const sero = evaluateReportSeverity(
    makeReport([
      {
        name: 'Hepatitis B serology',
        value: NaN,
        urgent: false,
        isAbove: false,
        isBelow: false,
        text: 'Patient is seronegative for surface antigen but core antibody positive.',
      },
    ]),
    { resultRules: [seroRule] }
  );
  assert(sero.noGrowthCount === 0, 'normalText "negative" does NOT calm "seronegative" (word-boundary)');

  // Multi-word normal phrases are unaffected — "no growth" still calms.
  const cultureRule = {
    id: 'wb_growth',
    enabled: true,
    kind: 'text',
    label: 'Needs review',
    normalLabel: 'No growth',
    analyte: { match: ['culture'] },
    normalText: ['no growth'],
  };
  const noGrowth = evaluateReportSeverity(
    makeReport([
      {
        name: 'Wound culture',
        value: NaN,
        urgent: false,
        isAbove: false,
        isBelow: false,
        text: 'No growth after 48 hours.',
      },
    ]),
    { resultRules: [cultureRule] }
  );
  assert(noGrowth.noGrowthCount === 1, 'multi-word normalText "no growth" still calms "No growth after 48 hours"');

  // Asymmetry guard: abnormalText stays SUBSTRING, so "candida" still catches "candidaemia"
  // even though that has no word boundary around "candida". (Word-boundary here would miss
  // it AND the "no growth" substring would then false-calm — the exact failure we avoid.)
  const bloodRule = {
    id: 'wb_candida',
    enabled: true,
    kind: 'text',
    label: 'Blood culture — review',
    normalLabel: 'No growth',
    analyte: { match: ['blood culture'] },
    normalText: ['no growth'],
    abnormalText: ['candida'],
  };
  const candidaemia = evaluateReportSeverity(
    makeReport([
      {
        name: 'Blood culture',
        value: NaN,
        urgent: false,
        isAbove: false,
        isBelow: false,
        text: 'Candidaemia confirmed on blood culture. No growth in anaerobic bottle.',
      },
    ]),
    { resultRules: [bloodRule] }
  );
  assert(
    candidaemia.reviewCount === 1 && candidaemia.noGrowthCount === 0,
    'abnormalText "candida" still catches "candidaemia" (substring kept — deliberate asymmetry)'
  );
}

// ── analyte.specimen: fail-open narrowing AND-filter ─────────────────────────
// Tests the specimenAllows() gate that scopes a text rule (or threshold rule) to
// a specific specimen header captured by the normaliser. Four core semantics:
//   (a) matching specimen → rule applies normally
//   (b) non-matching specimen → rule is skipped (does not apply)
//   (c) absent/null specimen → PASS (fail-open)
//   (d) cross-type isolation: urine rule must not fire on throat swab + vice versa
console.log('\n--- analyte.specimen: fail-open specimen gate ---');

// Helper: build a result with a specimen header
function mkResultWithSpecimen(name, text, specimen) {
  return {
    name,
    value: NaN,
    rawValue: text,
    comparator: null,
    unit: null,
    low: null,
    high: null,
    isAbove: false,
    isBelow: false,
    urgent: false,
    interpretation: null,
    date: '2026-06-15',
    history: [],
    text,
    specimen: specimen || null,
  };
}

// Throat-scoped text rule — mirrors the shipped base-throat-swab rule.
const throatRule = {
  id: 'test-throat',
  enabled: true,
  kind: 'text',
  label: 'Throat swab — needs review',
  normalLabel: 'Negative',
  analyte: {
    match: ['throat swab', 'throat culture', 'culture'],
    specimen: ['throat swab', 'throat'],
  },
  normalText: [
    'beta haemolytic streptococcus not isolated',
    'no beta haemolytic streptococci',
    'anaerobes not isolated',
  ],
  abnormalText: ['beta haemolytic streptococcus isolated', 'group a streptococcus isolated'],
};

// (a) Matching specimen + name hit → rule applies.
{
  const negative = mkResultWithSpecimen(
    'Culture',
    'Beta haemolytic Streptococcus NOT isolated. Anaerobes NOT isolated.',
    'THROAT SWAB'
  );
  const out = evaluateReportSeverity(makeReport([negative]), { resultRules: [throatRule] });
  assert(
    out.noGrowthCount === 1,
    'specimen (a): matching specimen "THROAT SWAB" + negative phrase → noGrowth (calmed)'
  );
  assert(out.level === 'none', 'specimen (a): noGrowth → level stays none');
}
{
  const positive = mkResultWithSpecimen('Culture', 'Beta haemolytic Streptococcus isolated.', 'THROAT SWAB');
  const out = evaluateReportSeverity(makeReport([positive]), { resultRules: [throatRule] });
  assert(out.reviewCount === 1, 'specimen (a): matching specimen "THROAT SWAB" + positive phrase → review');
  assert(out.level === 'amber', 'specimen (a): review → level amber');
}

// (b) Non-matching specimen → rule is skipped entirely (no chip).
{
  const urineResult = mkResultWithSpecimen('Culture', 'No growth after 48 hours.', 'MSU - MID STREAM URINE');
  const out = evaluateReportSeverity(makeReport([urineResult]), { resultRules: [throatRule] });
  assert(
    out.noGrowthCount === 0,
    'specimen (b): specimen "MSU - MID STREAM URINE" does NOT match throat rule → rule skipped (no noGrowth chip)'
  );
  assert(out.reviewCount === 0, 'specimen (b): non-matching specimen → also not flagged for review');
  assert(out.level === 'none', 'specimen (b): non-matching specimen → level none');
}

// (c) Absent/null specimen → PASS (fail-open). Rule applies even without a header.
{
  const noHeader = mkResultWithSpecimen(
    'Culture',
    'Beta haemolytic Streptococcus NOT isolated.',
    null // no specimen header captured
  );
  const out = evaluateReportSeverity(makeReport([noHeader]), { resultRules: [throatRule] });
  assert(out.noGrowthCount === 1, 'specimen (c): null specimen → fail-open, rule still applies (noGrowth)');
  assert(out.level === 'none', 'specimen (c): fail-open noGrowth → level none');
}
{
  // Empty string specimen is also fail-open.
  const emptySpec = mkResultWithSpecimen('Culture', 'Beta haemolytic Streptococcus NOT isolated.', '');
  const out = evaluateReportSeverity(makeReport([emptySpec]), { resultRules: [throatRule] });
  assert(out.noGrowthCount === 1, 'specimen (c): empty-string specimen → fail-open, rule still applies');
}

// (d) Cross-type isolation: urine rule must not claim a throat-headed result,
//     and the throat rule must not claim a urine-headed result.
const urineRule = {
  id: 'test-urine',
  enabled: true,
  kind: 'text',
  label: 'MSU — needs review',
  normalLabel: 'No growth',
  analyte: {
    match: ['culture', 'msu', 'urine culture'],
    specimen: ['urine', 'msu'],
  },
  normalText: ['no growth', 'no significant growth'],
};

{
  // A culture result whose specimen header is a throat swab:
  //   - the urine-scoped rule must NOT apply (specimen mismatch)
  //   - the throat-scoped rule MUST apply (and calm it)
  const throat = mkResultWithSpecimen(
    'Culture',
    'Beta haemolytic Streptococcus NOT isolated. Anaerobes NOT isolated.',
    'THROAT SWAB'
  );
  const out = evaluateReportSeverity(makeReport([throat]), {
    resultRules: [throatRule, urineRule],
  });
  assert(out.noGrowthCount === 1, 'cross-type (d): throat-headed culture calmed by throat rule (noGrowthCount 1)');
  assert(out.reviewCount === 0, 'cross-type (d): urine rule did not fire on throat-headed culture');
}
{
  // A culture result whose specimen header is an MSU:
  //   - the throat-scoped rule must NOT apply (specimen mismatch)
  //   - the urine-scoped rule MUST apply (and calm it if normal phrase present)
  const urine = mkResultWithSpecimen('Culture', 'No growth after 48 hours.', 'MID STREAM URINE');
  const out = evaluateReportSeverity(makeReport([urine]), {
    resultRules: [throatRule, urineRule],
  });
  assert(out.noGrowthCount === 1, 'cross-type (d): urine-headed culture calmed by urine rule (noGrowthCount 1)');
  assert(out.reviewCount === 0, 'cross-type (d): throat rule did not fire on urine-headed culture');
}

// analyte.specimen also works for threshold (numeric) rules — same gate logic.
{
  const specimenThreshRule = {
    id: 'test-thr-spec',
    enabled: true,
    kind: 'threshold',
    label: 'High value in urine',
    analyte: { match: ['potassium'], specimen: ['urine'] },
    comparator: 'above',
    amber: null,
    red: 10,
    unit: 'mmol/L',
  };
  // Result with matching specimen: rule fires
  const urineK = {
    name: 'Potassium',
    value: 12,
    specimen: 'URINE ELECTROLYTES',
    rawValue: '12',
    urgent: false,
    isAbove: false,
    isBelow: false,
    low: null,
    high: null,
  };
  const hit = evaluateReportSeverity(makeReport([urineK]), { resultRules: [specimenThreshRule] });
  assert(hit.level === 'red', 'threshold specimen gate (d): matching specimen fires red');

  // Result with non-matching specimen: rule skipped
  const serumK = {
    name: 'Potassium',
    value: 12,
    specimen: 'SERUM',
    rawValue: '12',
    urgent: false,
    isAbove: false,
    isBelow: false,
    low: null,
    high: null,
  };
  const miss = evaluateReportSeverity(makeReport([serumK]), { resultRules: [specimenThreshRule] });
  assert(miss.level === 'none', 'threshold specimen gate (d): non-matching specimen rule skipped → none');

  // Result with null specimen: fail-open → rule fires
  const noSpecK = {
    name: 'Potassium',
    value: 12,
    specimen: null,
    rawValue: '12',
    urgent: false,
    isAbove: false,
    isBelow: false,
    low: null,
    high: null,
  };
  const openK = evaluateReportSeverity(makeReport([noSpecK]), { resultRules: [specimenThreshRule] });
  assert(openK.level === 'red', 'threshold specimen gate: null specimen → fail-open → rule fires red');
}

// ── shipped base-throat-swab rule: present, valid, fires as documented ─────
console.log('\n--- shipped base-throat-swab rule: valid, scoped, fires correctly ---');
{
  const defaults = require('./defaults.json');
  const { validateResultRule } = require('./engine/result-rules.js');
  const shipped = Array.isArray(defaults.resultRules) ? defaults.resultRules : [];
  const r = shipped.find((x) => x && x.id === 'base-throat-swab');
  assert(!!r, 'base-throat-swab is present in defaults.json resultRules');
  if (r) {
    assert(r.builtin === true && r.enabled === true, 'base-throat-swab: builtin + enabled');
    const errs = validateResultRule(r);
    assert(errs.length === 0, 'base-throat-swab: validates clean against schema');
    assert(
      Array.isArray(r.analyte.specimen) && r.analyte.specimen.length > 0,
      'base-throat-swab: analyte.specimen is a non-empty array (demonstrates specimen scoping)'
    );
    // The shipped rule must calm a negative throat swab (specimen-scoped)
    const neg = mkResultWithSpecimen(
      'Culture',
      'Beta haemolytic Streptococcus NOT isolated. Anaerobes NOT isolated.',
      'THROAT SWAB'
    );
    const outNeg = evaluateReportSeverity(makeReport([neg]), { resultRules: [r] });
    assert(outNeg.noGrowthCount === 1, 'base-throat-swab: negative throat swab → noGrowth (calmed)');
    // The shipped rule must flag a positive throat swab
    const pos = mkResultWithSpecimen('Culture', 'Beta haemolytic Streptococcus isolated.', 'THROAT SWAB');
    const outPos = evaluateReportSeverity(makeReport([pos]), { resultRules: [r] });
    assert(outPos.reviewCount === 1, 'base-throat-swab: positive throat swab → review');
    // Must NOT fire on a urine specimen (specimen gate blocks it)
    const urine = mkResultWithSpecimen('Culture', 'No significant growth.', 'MID STREAM URINE');
    const outUrine = evaluateReportSeverity(makeReport([urine]), { resultRules: [r] });
    assert(
      outUrine.noGrowthCount === 0 && outUrine.reviewCount === 0,
      'base-throat-swab: does NOT fire on urine-headed culture (specimen gate)'
    );
  }
}

// ── item 2.2/2.6 (TRIAGE-LENS-2026-07-02.md) — additive `flagged`/top.prior fields ──
console.log('\n--- item 2.2: evaluateReportSeverity() additive `flagged` array ---');
{
  const potassium = {
    name: 'Potassium',
    value: 6.8,
    rawValue: '6.8',
    comparator: null,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.3,
    isAbove: true,
    isBelow: false,
    urgent: true,
    interpretation: 'Above reference range',
    date: '2026-06-12',
    history: [],
  };
  const out = evaluateReportSeverity(makeReport([wbcNormal, potassium, mcvAbove]));
  assert(Array.isArray(out.flagged), 'flagged is an array');
  assert(out.flagged.length === 2, `flagged only contains the 2 non-normal results (got ${out.flagged.length})`);
  assert(out.flagged[0].name === 'Potassium', 'flagged[0] is Potassium (report order preserved)');
  assert(out.flagged[0].effSev === 'urgent', 'flagged[0].effSev is urgent (lab-flagged urgent)');
  assert(out.flagged[0].index === 1, 'flagged[0].index is its position in report.results (1)');
  assert(out.flagged[1].name === 'MCV' && out.flagged[1].effSev === 'abnormal', 'flagged[1] is MCV/abnormal');
  assert(
    out.flagged.every((f) => 'prior' in f),
    'every flagged entry carries a prior field (possibly null)'
  );
  // Existing fields still computed exactly as before — additive field changes nothing else.
  assert(out.level === 'red' && out.urgentCount === 1 && out.abnormalCount === 2, 'existing level/counts unchanged');

  const noneOut = evaluateReportSeverity(makeReport([]));
  assert(Array.isArray(noneOut.flagged) && noneOut.flagged.length === 0, 'empty report → flagged is []');
}

console.log('\n--- item 2.2: computeRuleSev additive comparator/threshold surface via `flagged` ---');
{
  const potassiumBorderline = {
    name: 'Potassium',
    value: 6.2,
    rawValue: '6.2',
    comparator: null,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.3,
    isAbove: true, // lab already flags it abnormal
    isBelow: false,
    urgent: false, // NOT lab-urgent — a rule pushes it to urgent
    interpretation: 'Above reference range',
    date: '2026-06-12',
    history: [],
  };
  const ruleRed = {
    id: 'k-critical',
    enabled: true,
    kind: 'threshold',
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
    label: 'Critical high potassium',
    analyte: { match: ['potassium'] },
  };
  const out = evaluateReportSeverity(makeReport([potassiumBorderline]), { resultRules: [ruleRed] });
  assert(out.flagged.length === 1, 'one flagged entry');
  const f = out.flagged[0];
  assert(f.effSev === 'urgent', 'rule pushed effSev to urgent (6.2 >= red 6.0)');
  assert(f.ruleLabel === 'Critical high potassium', 'ruleLabel set (rule-driven, exceeded lab severity)');
  assert(f.ruleComparator === 'above', 'ruleComparator carried (additive computeRuleSev field)');
  assert(f.ruleThreshold === 6.0, 'ruleThreshold carries the RED threshold that was crossed (additive field)');
  assert(out.top && out.top.ruleLabel === 'Critical high potassium', 'top.ruleLabel unaffected by the addition');

  // A rule that matches but does NOT exceed the lab's own severity must NOT be
  // treated as rule-driven (ruleLabel/ruleComparator/ruleThreshold stay null) —
  // unchanged precedence, just confirming the additive fields respect it too.
  const ruleSameLevel = { ...ruleRed, red: 8.0, amber: 5.0 }; // amber only, lab already says abnormal
  const out2 = evaluateReportSeverity(makeReport([potassiumBorderline]), { resultRules: [ruleSameLevel] });
  assert(out2.flagged[0].ruleLabel === null, 'rule matching at the SAME (not higher) severity → ruleLabel null');
  assert(out2.flagged[0].ruleComparator === null, 'not rule-driven → ruleComparator null');
  assert(out2.flagged[0].ruleThreshold === null, 'not rule-driven → ruleThreshold null');
}

console.log('\n--- item 2.7: computeRuleSev/flagged additive `ruleId` (guidance-action lookup key) ---');
{
  const potassiumBorderline = {
    name: 'Potassium',
    value: 6.2,
    rawValue: '6.2',
    comparator: null,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.3,
    isAbove: true,
    isBelow: false,
    urgent: false,
    interpretation: 'Above reference range',
    date: '2026-06-12',
    history: [],
  };
  const ruleRed = {
    id: 'k-critical',
    enabled: true,
    kind: 'threshold',
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
    label: 'Critical high potassium',
    analyte: { match: ['potassium'] },
    actions: [{ type: 'note', label: 'Reminder', text: 'Repeat urgently.' }],
  };

  // computeRuleSev itself (via evaluateReportSeverity's flagged[].ruleId) carries the
  // winning rule's id when it drove the escalation — this is the popover's lookup key
  // into CONFIG.resultRules to find `actions` (item 2.7), never consumed by grading.
  const out = evaluateReportSeverity(makeReport([potassiumBorderline]), { resultRules: [ruleRed] });
  assert(out.flagged.length === 1, 'one flagged entry');
  assert(out.flagged[0].ruleId === 'k-critical', "flagged[0].ruleId carries the rule-driven rule's id");
  // Existing counters/level are untouched by the additive field.
  assert(out.level === 'red' && out.urgentCount === 1, 'level/urgentCount unaffected by ruleId addition');

  // Not rule-driven (matches but does not exceed lab severity) → ruleId stays null,
  // same gate as ruleLabel/ruleComparator/ruleThreshold.
  const ruleSameLevel = { ...ruleRed, red: 8.0, amber: 5.0 };
  const out2 = evaluateReportSeverity(makeReport([potassiumBorderline]), { resultRules: [ruleSameLevel] });
  assert(out2.flagged[0].ruleId === null, 'not rule-driven → ruleId null (same gate as ruleLabel)');

  // Rule with no explicit id string → ruleId null (never a non-string/undefined leak).
  const ruleNoId = { ...ruleRed, id: undefined };
  const out3 = evaluateReportSeverity(makeReport([potassiumBorderline]), { resultRules: [ruleNoId] });
  assert(out3.flagged[0].ruleId === null, 'rule with no id → ruleId null, not undefined');

  // No rules at all → flagged is still populated (lab-driven), ruleId simply null.
  const labOnly = { ...potassiumBorderline, urgent: true }; // lab-urgent, no rules
  const out4 = evaluateReportSeverity(makeReport([labOnly]), { resultRules: [] });
  assert(out4.flagged[0].ruleId === null, 'lab-driven-only flagged entry → ruleId null (no rule fired)');
}

console.log('\n--- item 2.6: extractPrior() ---');
{
  assert(extractPrior(null) === null, 'null result → null');
  assert(extractPrior({ value: 5, history: [] }) === null, 'no history → null');
  assert(
    extractPrior({ value: NaN, unit: 'mmol/L', history: [{ value: 4, unit: 'mmol/L' }] }) === null,
    'non-finite current value → null'
  );

  const up = extractPrior({
    value: 6.2,
    unit: 'mmol/L',
    history: [{ value: 4.1, date: '2026-05-03', unit: 'mmol/L' }],
  });
  assert(
    up && up.dir === 'up' && up.value === 4.1 && up.date === '2026-05-03',
    'higher current value → dir "up", value/date carried'
  );

  const down = extractPrior({
    value: 82,
    unit: 'g/L',
    history: [{ value: 104, date: '2026-03-01', unit: 'g/L' }],
  });
  assert(down && down.dir === 'down', 'lower current value → dir "down"');

  const same = extractPrior({
    value: 5,
    unit: 'mmol/L',
    history: [{ value: 5, date: '2026-01-01', unit: 'mmol/L' }],
  });
  assert(same && same.dir === 'same', 'equal current/prior value → dir "same"');

  const mismatch = extractPrior({
    value: 6.2,
    unit: 'mmol/L',
    history: [{ value: 4.1, date: '2026-05-03', unit: 'mEq/L' }],
  });
  assert(mismatch === null, 'unit mismatch → null (never a cross-unit comparison)');

  const oneAbsent = extractPrior({
    value: 6.2,
    unit: 'mmol/L',
    history: [{ value: 4.1, date: '2026-05-03', unit: null }],
  });
  assert(oneAbsent === null, 'current has a unit, history entry does not → null (NOT "both absent")');

  const bothAbsent = extractPrior({
    value: 6.2,
    unit: null,
    history: [{ value: 4.1, date: '2026-05-03', unit: null }],
  });
  assert(bothAbsent && bothAbsent.dir === 'up', 'both units absent → treated as a match, arrow shown');

  const caseWhitespace = extractPrior({
    value: 6.2,
    unit: ' MMOL/L ',
    history: [{ value: 4.1, date: '2026-05-03', unit: 'mmol/l' }],
  });
  assert(caseWhitespace && caseWhitespace.dir === 'up', 'unit compare is case/whitespace-insensitive');

  // History is newest-first; a leading non-finite entry (e.g. unparsable prior value)
  // must be skipped in favour of the next finite one.
  const skipNonFinite = extractPrior({
    value: 6.2,
    unit: 'mmol/L',
    history: [
      { value: NaN, date: '2026-06-01', unit: 'mmol/L' },
      { value: 4.1, date: '2026-05-03', unit: 'mmol/L' },
    ],
  });
  assert(
    skipNonFinite && skipNonFinite.value === 4.1 && skipNonFinite.date === '2026-05-03',
    'skips a non-finite history entry to find the next finite prior value'
  );
}

console.log('\n--- item 2.6: top.prior on evaluateReportSeverity() ---');
{
  const kWithHistory = {
    name: 'Potassium',
    value: 6.8,
    rawValue: '6.8',
    comparator: null,
    unit: 'mmol/L',
    low: 3.5,
    high: 5.3,
    isAbove: true,
    isBelow: false,
    urgent: true,
    interpretation: 'Above reference range',
    date: '2026-06-12',
    history: [{ value: 4.1, date: '2026-05-03', unit: 'mmol/L', flag: 'normal' }],
  };
  const out = evaluateReportSeverity(makeReport([kWithHistory]));
  assert(
    out.top && out.top.prior && out.top.prior.dir === 'up',
    "top.prior computed from the salient result's history"
  );
  assert(
    out.flagged[0].prior && out.flagged[0].prior.dir === 'up',
    'flagged[0].prior matches top.prior for the same result'
  );

  const noHistOut = evaluateReportSeverity(makeReport([rdwUrgent])); // fixture has history: []
  assert(noHistOut.top && noHistOut.top.prior === null, 'no history on the salient result → top.prior null');
}

// ── item 3.1: unit-mismatch guard (TRIAGE-LENS-2026-07-02.md) ─────────────────
// A threshold rule's `unit` was historically display-only — the numeric threshold
// applied to result.value regardless of the result's own reported unit. These
// pin: a genuine mismatch SKIPS the rule (no grade, but recorded in
// unitMismatches); an absent unit on EITHER side fails open (graded exactly as
// before); notation-variant units (case/whitespace/µ-vs-u/cell-count) are
// recognised as the SAME family and grade normally, without being recorded as a
// mismatch.
console.log('\n--- item 3.1: unit-mismatch guard — computeRuleSev / evaluateReportSeverity ---');
{
  const digoxinRule = {
    id: 'test-digoxin',
    enabled: true,
    label: 'Digoxin toxicity',
    analyte: { match: ['digoxin'] },
    comparator: 'above',
    amber: 1.5,
    red: 2,
    unit: 'µg/L',
  };

  // Mismatch: reported in nmol/L, not the rule's µg/L. A naive apply-regardless
  // grading would fire red here (5 >= 2) — that would be the exact silent
  // mis-grade this guard exists to prevent. The rule must be SKIPPED entirely.
  const wrongUnitResult = mkResult('Digoxin level', 5, { unit: 'nmol/L' });
  const mismatchOut = evaluateReportSeverity(makeReport([wrongUnitResult]), { resultRules: [digoxinRule] });
  assert(mismatchOut.level === 'none', 'unit mismatch → rule SKIPPED, no grade contributed (not red despite 5 >= 2)');
  assert(mismatchOut.unitMismatches.length === 1, 'exactly one unit mismatch recorded');
  assert(mismatchOut.unitMismatches[0].name === 'Digoxin level', 'unitMismatches[0].name is the result name');
  assert(mismatchOut.unitMismatches[0].resultUnit === 'nmol/L', 'unitMismatches[0].resultUnit is the reported unit');
  assert(mismatchOut.unitMismatches[0].ruleId === 'test-digoxin', 'unitMismatches[0].ruleId carries the rule id');
  assert(
    mismatchOut.unitMismatches[0].ruleLabel === 'Digoxin toxicity',
    'unitMismatches[0].ruleLabel carries the rule label'
  );
  assert(
    mismatchOut.unitMismatches[0].ruleUnit === 'µg/L',
    'unitMismatches[0].ruleUnit carries the rule’s declared unit'
  );

  // Result has NO unit at all → fail-open: graded exactly as before this guard
  // existed, and NOT recorded as a mismatch (there was nothing to compare).
  const noUnitResult = mkResult('Digoxin level', 2.4); // mkResult defaults unit: null
  const noUnitOut = evaluateReportSeverity(makeReport([noUnitResult]), { resultRules: [digoxinRule] });
  assert(noUnitOut.level === 'red', 'result has no unit → fail-open, graded normally (2.4 >= red 2)');
  assert(noUnitOut.unitMismatches.length === 0, 'result has no unit → not recorded as a mismatch');

  // Rule has NO declared unit → fail-open: graded normally even though the result
  // DOES carry a unit (there is nothing on the rule side to conflict with).
  const ruleNoUnit = { ...digoxinRule, unit: undefined };
  const ruleNoUnitOut = evaluateReportSeverity(makeReport([mkResult('Digoxin level', 2.4, { unit: 'nmol/L' })]), {
    resultRules: [ruleNoUnit],
  });
  assert(ruleNoUnitOut.level === 'red', 'rule has no unit → fail-open, graded normally');
  assert(ruleNoUnitOut.unitMismatches.length === 0, 'rule has no unit → not recorded as a mismatch');

  // Notation-variant units (case / whitespace / µ-vs-u / cell-count magnitude
  // notation) are recognised as the SAME family via unitsCompatible's shared
  // normalisation and grade exactly as a same-unit result would — never flagged
  // as a mismatch.
  const wbcRule = {
    id: 'test-wbc',
    enabled: true,
    label: 'High WBC',
    analyte: { match: ['wbc'] },
    comparator: 'above',
    amber: 11,
    red: 20,
    unit: '×10⁹/L',
  };
  const wbcNotationVariant = mkResult('WBC', 25, { unit: 'x10^9/L' });
  const wbcOut = evaluateReportSeverity(makeReport([wbcNotationVariant]), { resultRules: [wbcRule] });
  assert(wbcOut.level === 'red', 'cell-count notation variant recognised as same family → grades normally (25 >= 20)');
  assert(wbcOut.unitMismatches.length === 0, 'notation-variant match → not recorded as a mismatch');

  const ferritinRule = {
    id: 'test-ferritin',
    enabled: true,
    label: 'Low ferritin',
    analyte: { match: ['ferritin'] },
    comparator: 'below',
    amber: 60,
    red: 15,
    unit: 'micrograms/L',
  };
  const ferritinSymbolUnit = mkResult('Ferritin', 10, { unit: 'µg/L' });
  const ferritinOut = evaluateReportSeverity(makeReport([ferritinSymbolUnit]), { resultRules: [ferritinRule] });
  assert(
    ferritinOut.level === 'red',
    'spelled-out "micrograms/L" rule vs symbolic "µg/L" result → same family → grades normally'
  );
  assert(ferritinOut.unitMismatches.length === 0, 'micrograms/L vs µg/L → not recorded as a mismatch');

  // Multiple flagged results with a genuine mismatch each → one entry per
  // (result, rule) pair, in report order.
  const potassiumRule = {
    id: 'test-k',
    enabled: true,
    label: 'Critical high potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 6,
    red: 6.5,
    unit: 'mmol/L',
  };
  const twoResults = evaluateReportSeverity(
    makeReport([mkResult('Digoxin level', 5, { unit: 'nmol/L' }), mkResult('Potassium', 9, { unit: 'mEq/L' })]),
    { resultRules: [digoxinRule, potassiumRule] }
  );
  assert(twoResults.level === 'none', 'both rules skipped on unit mismatch → level stays none');
  assert(twoResults.unitMismatches.length === 2, 'two distinct (result, rule) mismatches recorded');
  assert(
    twoResults.unitMismatches.some((m) => m.ruleId === 'test-digoxin') &&
      twoResults.unitMismatches.some((m) => m.ruleId === 'test-k'),
    'both rule ids present among the recorded mismatches'
  );
}

// ── item 3.1: unit-mismatch guard — combo numeric condition path ──────────────
// No shipped combo condition carries a `unit` field today (buildComboCondition in
// options.js has no such input) — these pin that the engine-level guard is ready
// for when one is added, and changes nothing for a condition that omits it.
console.log('\n--- item 3.1: unit-mismatch guard — combo numeric condition ---');
{
  const comboWithUnitGuard = {
    id: 'test-combo-unit',
    kind: 'combo',
    enabled: true,
    label: 'Test combo unit guard',
    level: 'amber',
    conditions: [
      { analyte: { match: ['pus cells'] }, comparator: 'above', value: 10, unit: 'mmol/L' },
      { analyte: { match: ['culture'] }, contains: ['no growth'] },
    ],
  };
  const pusWrongUnit = mkResult('Pus cells', 50, { unit: 'µmol/L' }); // conflicts with the condition's mmol/L
  const cultureResult = { name: 'Culture', value: NaN, text: 'No growth', unit: null, history: [] };

  const comboMismatchOut = evaluateReportSeverity(makeReport([pusWrongUnit, cultureResult]), {
    resultRules: [comboWithUnitGuard],
  });
  assert(
    comboMismatchOut.comboCount === 0,
    'combo condition unit mismatch → condition not satisfied → combo does not fire'
  );
  assert(comboMismatchOut.unitMismatches.length === 1, 'combo condition mismatch recorded once');
  assert(comboMismatchOut.unitMismatches[0].name === 'Pus cells', 'combo mismatch entry names the result');
  assert(comboMismatchOut.unitMismatches[0].resultUnit === 'µmol/L', 'combo mismatch entry carries the result unit');
  assert(
    comboMismatchOut.unitMismatches[0].ruleId === 'test-combo-unit',
    'combo mismatch entry carries the combo rule id'
  );
  assert(
    comboMismatchOut.unitMismatches[0].ruleUnit === 'mmol/L',
    'combo mismatch entry carries the condition’s declared unit'
  );

  // Same-family unit on the condition → fires normally, no mismatch recorded.
  const comboMatchingUnit = {
    ...comboWithUnitGuard,
    id: 'test-combo-unit-match',
    conditions: [
      { analyte: { match: ['pus cells'] }, comparator: 'above', value: 10, unit: 'mmol/L' },
      { analyte: { match: ['culture'] }, contains: ['no growth'] },
    ],
  };
  const pusMatchingUnit = mkResult('Pus cells', 50, { unit: 'mmol/L' });
  const comboMatchOut = evaluateReportSeverity(makeReport([pusMatchingUnit, cultureResult]), {
    resultRules: [comboMatchingUnit],
  });
  assert(comboMatchOut.comboCount === 1, 'matching unit on the condition → combo fires normally');
  assert(comboMatchOut.unitMismatches.length === 0, 'matching unit → no mismatch recorded');

  // Dedup: two conditions on the SAME analyte+unit that both mismatch the same
  // candidate result must collapse to ONE unitMismatches entry, not two.
  const comboDoubleCondition = {
    id: 'test-combo-dedup',
    kind: 'combo',
    enabled: true,
    label: 'Dedup test combo',
    level: 'amber',
    conditions: [
      { analyte: { match: ['pus cells'] }, comparator: 'above', value: 10, unit: 'mmol/L' },
      { analyte: { match: ['pus cells'] }, comparator: 'above', value: 5, unit: 'mmol/L' },
    ],
  };
  const dedupOut = evaluateReportSeverity(makeReport([pusWrongUnit]), { resultRules: [comboDoubleCondition] });
  assert(dedupOut.comboCount === 0, 'both conditions unsatisfied (unit mismatch) → combo does not fire');
  assert(
    dedupOut.unitMismatches.length === 1,
    'two conditions producing the same (result, rule) mismatch dedupe to one entry'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Item 3.2 — Close the qualitative fall-through
// ══════════════════════════════════════════════════════════════════════════════

// Fixtures: non-numeric text results (no numeric value, no lab flag).
const textResult = (name, over) =>
  Object.assign(
    {
      name,
      value: NaN,
      rawValue: '',
      comparator: null,
      unit: null,
      low: null,
      high: null,
      isAbove: false,
      isBelow: false,
      urgent: false,
      interpretation: null,
      date: '2026-06-01',
      history: [],
      text: '',
    },
    over
  );

// ── Leg A: red-capable text rules ─────────────────────────────────────────────
console.log('\n--- Leg A: red-capable text rules (abnormalLevel:red) ---');
{
  const bcRuleRed = {
    id: 'bc-red',
    kind: 'text',
    enabled: true,
    label: 'Positive blood culture',
    analyte: { match: ['blood culture'] },
    abnormalText: ['organism isolated'],
    abnormalLevel: 'red',
  };
  const bc = textResult('Blood culture', {
    rawValue: 'Staphylococcus aureus — organism isolated',
    text: 'Staphylococcus aureus — organism isolated',
  });
  const out = evaluateReportSeverity(makeReport([bc]), { resultRules: [bcRuleRed] });
  assert(out.level === 'red', 'red text rule (abnormalLevel:red) → report level red');
  assert(out.reviewCount === 1, 'reviewCount is 1');
  assert(out.reviewTop && out.reviewTop.level === 'red', "reviewTop.level is 'red'");
  assert(out.reviewTop.label === 'Positive blood culture', 'reviewTop carries the red rule label');
  assert(out.urgentCount === 0, 'urgentCount stays 0 (text-red is NOT lab-urgent)');
  assert(out.misprioritised === false, 'misprioritised stays false regardless of priority (text-red excluded)');
}
{
  // A red text rule is escalate-only and does not depend on priorityDisplay for misprioritised.
  const bcRuleRed = {
    id: 'bc-red',
    kind: 'text',
    enabled: true,
    label: 'Positive blood culture',
    analyte: { match: ['blood culture'] },
    abnormalText: ['organism isolated'],
    abnormalLevel: 'red',
  };
  const bc = textResult('Blood culture', { text: 'organism isolated' });
  const out = evaluateReportSeverity(makeReport([bc]), { resultRules: [bcRuleRed], priorityDisplay: 'Routine' });
  assert(
    out.level === 'red' && out.misprioritised === false,
    'text-red on a Routine row → red but never misprioritised'
  );
}
{
  // Default (no abnormalLevel) preserves EXACT prior behaviour: amber cap.
  const bcRuleAmber = {
    id: 'bc-amber',
    kind: 'text',
    enabled: true,
    label: 'Blood culture flag',
    analyte: { match: ['blood culture'] },
    abnormalText: ['organism isolated'],
  };
  const bc = textResult('Blood culture', { text: 'organism isolated' });
  const out = evaluateReportSeverity(makeReport([bc]), { resultRules: [bcRuleAmber] });
  assert(out.level === 'amber', 'text rule with no abnormalLevel → amber (unchanged behaviour)');
  assert(out.reviewTop.level === 'amber', "reviewTop.level defaults to 'amber'");
}
{
  // A red review promotes reviewTop over an earlier amber review.
  const amberRule = {
    id: 'a',
    kind: 'text',
    enabled: true,
    label: 'HVS review',
    analyte: { match: ['HVS'] },
    abnormalText: ['candida'],
  };
  const redRule = {
    id: 'r',
    kind: 'text',
    enabled: true,
    label: 'Positive blood culture',
    analyte: { match: ['blood culture'] },
    abnormalText: ['organism isolated'],
    abnormalLevel: 'red',
  };
  const hvs = textResult('HVS', { text: 'candida seen' });
  const bc = textResult('Blood culture', { text: 'organism isolated' });
  const out = evaluateReportSeverity(makeReport([hvs, bc]), { resultRules: [amberRule, redRule] });
  assert(out.reviewCount === 2, 'both reviews counted');
  assert(out.level === 'red', 'presence of a red review → level red');
  assert(
    out.reviewTop.level === 'red' && out.reviewTop.name === 'Blood culture',
    'reviewTop promoted to the red review'
  );
}
{
  // Red text review never LOWERS a lab-urgent result (escalate-only, stays red).
  const bcRuleRed = {
    id: 'bc-red',
    kind: 'text',
    enabled: true,
    label: 'Positive blood culture',
    analyte: { match: ['blood culture'] },
    abnormalText: ['organism isolated'],
    abnormalLevel: 'red',
  };
  const bc = textResult('Blood culture', { text: 'organism isolated' });
  const out = evaluateReportSeverity(makeReport([bc, rdwUrgent]), { resultRules: [bcRuleRed] });
  assert(out.level === 'red' && out.urgentCount === 1, 'lab-urgent + red text review → red, urgentCount from lab only');
}

// ── Leg B: unclassified-positive surfacing ────────────────────────────────────
console.log('\n--- Leg B: unclassified qualitative positive surfacing ---');
{
  // "Detected" with no rule, no lab flag → surfaced amber.
  const r = textResult('Respiratory PCR', { rawValue: 'Detected', text: 'Detected' });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.level === 'amber', 'unclassified positive → level amber');
  assert(out.unclassified.length === 1, 'unclassified list has 1 entry');
  assert(out.unclassified[0] && out.unclassified[0].name === 'Respiratory PCR', 'unclassified[0] names the analyte');
  assert(out.unclassified[0].token === 'detected', 'unclassified[0].token is the matched token');
  assert(out.urgentCount === 0 && out.abnormalCount === 0, 'never numeric-graded (no value)');
}
{
  // Negation guard: "Not detected" must NOT surface.
  const r = textResult('Respiratory PCR', { rawValue: 'Not detected', text: 'Not detected' });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.unclassified.length === 0, '"Not detected" → not surfaced (negation guard)');
  assert(out.level === 'none', 'genuinely-negative qualitative result stays none');
}
{
  // "No growth" negation guard.
  const r = textResult('Wound swab', { text: 'No growth after 48 hours' });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.unclassified.length === 0, '"No growth" → not surfaced');
}
{
  // Whole-word discipline: "represent"/"presentation" must not trip 'present'.
  const r = textResult('Note', { text: 'Sample representative of the presentation' });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.unclassified.length === 0, 'substring inside a larger word does not trip the lexicon');
}
{
  // A result COVERED by a text rule is left to that rule (not double-surfaced),
  // even when the rule's outcome is 'none' (lone abnormalText, no phrase hit).
  const coverRule = {
    id: 'cov',
    kind: 'text',
    enabled: true,
    label: 'Culture flag',
    analyte: { match: ['culture'] },
    abnormalText: ['heavy growth'],
  };
  const r = textResult('Urine culture', { text: 'Organism isolated, mixed growth' });
  const out = evaluateReportSeverity(makeReport([r]), { resultRules: [coverRule] });
  assert(out.unclassified.length === 0, 'a result a text rule touched is NOT also surfaced as unclassified');
}
{
  // A lab-flagged (abnormal) result is already visible → not unclassified.
  const r = textResult('Marker', { text: 'positive', isAbove: true });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.unclassified.length === 0, 'lab-flagged result → not surfaced as unclassified (already visible)');
}
{
  // A numeric result never enters the unclassified pass.
  const r = textResult('Value', { value: 12, rawValue: '12 positive', text: '12 positive' });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.unclassified.length === 0, 'numeric result → never unclassified');
}
{
  // Sentence-scoped: a negation in a DIFFERENT clause does not cancel a genuine positive.
  const r = textResult('Culture', { text: 'Organism isolated. No growth in anaerobic bottle.' });
  const out = evaluateReportSeverity(makeReport([r]));
  assert(out.unclassified.length === 1, 'positive in one sentence survives a negation in another');
}

// ── matchUnclassifiedPositive direct unit tests ───────────────────────────────
console.log('\n--- matchUnclassifiedPositive (direct) ---');
{
  assert(
    Array.isArray(POSITIVE_QUALITATIVE) && POSITIVE_QUALITATIVE.includes('reactive'),
    'POSITIVE_QUALITATIVE exported'
  );
  assert(
    Array.isArray(UNCLASSIFIED_NEGATORS) && UNCLASSIFIED_NEGATORS.includes('not'),
    'UNCLASSIFIED_NEGATORS exported'
  );
  assert(matchUnclassifiedPositive({ text: 'HIV reactive' }) === 'reactive', 'reactive token matched');
  assert(matchUnclassifiedPositive({ text: 'not reactive' }) === null, 'preceding negator negates the token');
  assert(
    matchUnclassifiedPositive({ text: 'none isolated' }) === null,
    "'none' negator (culture phrasing) negates 'isolated'"
  );
  assert(
    matchUnclassifiedPositive({ text: 'nothing to report' }) === null,
    'no false match on unrelated text (whole-word)'
  );
  // 'non-' / 'non ' glued prefix is a negating prefix — standard true-negative serology
  assert(
    matchUnclassifiedPositive({ text: 'Hepatitis C antibody non-reactive' }) === null,
    "'non-reactive' → not surfaced (glued negating prefix)"
  );
  assert(matchUnclassifiedPositive({ text: 'HBsAg non reactive' }) === null, "'non reactive' (spaced) → not surfaced");
  assert(
    matchUnclassifiedPositive({ text: 'non-Hodgkin lymphoma cells seen' }) === 'seen',
    "'non' only negates the abutting token, not a distant one ('seen' still surfaces)"
  );
  assert(
    matchUnclassifiedPositive({ text: 'cannon reactive' }) === 'reactive',
    "'non' must be a whole word — 'cannon' does not negate 'reactive'"
  );
  assert(matchUnclassifiedPositive(null) === null, 'null-safe');
}

// ── item 3.6: delta/trend rule grading ─────────────────────────────────────────
// No delta rule ships in defaults.json (ZERO shipped delta rules — see
// TRIAGE-LENS-2026-07-02.md item 3.6), so every rule here is constructed inline.
console.log('\n--- item 3.6: delta rules — rise/fall/either grading (absolute "by") ---');
{
  const risingCreatinine = {
    id: 'delta-aki',
    enabled: true,
    kind: 'delta',
    label: 'AKI watch',
    analyte: { match: ['creatinine'], exclude: ['urine'] },
    direction: 'rise',
    by: true,
    amber: 15,
    red: 26,
  };

  // Rise beyond red — fires urgent, matches the plan's illustrative example exactly.
  const creat148 = mkResult('Creatinine', 148, {
    unit: 'umol/L',
    low: 60,
    high: 120,
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const redOut = evaluateReportSeverity(makeReport([creat148]), { resultRules: [risingCreatinine] });
  assert(redOut.level === 'red', 'rise of 38 crosses red (>=26) → level red');
  assert(redOut.flagged[0].ruleLabel === 'AKI watch', 'flagged entry attributes the delta rule label');
  assert(redOut.flagged[0].ruleComparator === 'rise', 'flagged entry ruleComparator carries the observed direction');
  assert(redOut.flagged[0].ruleThreshold === 26, 'flagged entry ruleThreshold carries the winning (red) magnitude');
  assert(redOut.flagged[0].ruleId === 'delta-aki', 'flagged entry ruleId carries the rule id');
  assert(
    redOut.flagged[0].deltaSummary === '+38 in 5 days',
    `deltaSummary exact (got "${redOut.flagged[0].deltaSummary}")`
  );

  // Rise beyond amber but below red — fires abnormal.
  const creat128 = mkResult('Creatinine', 128, {
    unit: 'umol/L',
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const amberOut = evaluateReportSeverity(makeReport([creat128]), { resultRules: [risingCreatinine] });
  assert(amberOut.level === 'amber', 'rise of 18 crosses amber (>=15) but not red → level amber');

  // Rise below amber — no fire.
  const creat120 = mkResult('Creatinine', 120, {
    unit: 'umol/L',
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const noneOut = evaluateReportSeverity(makeReport([creat120]), { resultRules: [risingCreatinine] });
  assert(noneOut.level === 'none', 'rise of 10 stays below amber (15) → level none');

  // Wrong direction — a FALL never fires a 'rise'-only rule, even if the magnitude qualifies.
  const creatFallen = mkResult('Creatinine', 80, {
    unit: 'umol/L',
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const wrongDirOut = evaluateReportSeverity(makeReport([creatFallen]), { resultRules: [risingCreatinine] });
  assert(wrongDirOut.level === 'none', "a FALL never fires a 'rise'-only delta rule");

  // Excluded analyte (urine creatinine) never matches, even with a qualifying rise.
  const urineCreat = mkResult('Urine Creatinine', 148, {
    unit: 'umol/L',
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const excludedOut = evaluateReportSeverity(makeReport([urineCreat]), { resultRules: [risingCreatinine] });
  assert(excludedOut.level === 'none', 'analyte.exclude drops "Urine Creatinine" even with a qualifying rise');

  // 'fall'-only rule: a rise never fires it.
  const fallRule = { ...risingCreatinine, id: 'delta-fall', direction: 'fall' };
  const fallOnRiseOut = evaluateReportSeverity(makeReport([creat148]), { resultRules: [fallRule] });
  assert(fallOnRiseOut.level === 'none', "a RISE never fires a 'fall'-only delta rule");
  const fallOnFallOut = evaluateReportSeverity(makeReport([creatFallen]), { resultRules: [fallRule] });
  assert(fallOnFallOut.level === 'red', "a FALL of 30 fires a 'fall'-only delta rule (crosses red 26)");

  // 'either'-direction rule fires on BOTH a qualifying rise and a qualifying fall.
  const eitherRule = { ...risingCreatinine, id: 'delta-either', direction: 'either' };
  const eitherRiseOut = evaluateReportSeverity(makeReport([creat148]), { resultRules: [eitherRule] });
  assert(eitherRiseOut.level === 'red', "'either' direction fires on a qualifying rise");
  const eitherFallOut = evaluateReportSeverity(makeReport([creatFallen]), { resultRules: [eitherRule] });
  assert(eitherFallOut.level === 'red', "'either' direction fires on a qualifying fall");

  // No change at all (exactly equal) never fires, even an 'either' rule.
  const creatSame = mkResult('Creatinine', 110, {
    unit: 'umol/L',
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const sameOut = evaluateReportSeverity(makeReport([creatSame]), { resultRules: [eitherRule] });
  assert(sameOut.level === 'none', 'zero change never fires, even on an "either"-direction rule');
}

console.log('\n--- item 3.6: delta rules — percent change ("byPercent") ---');
{
  const fallingHb = {
    id: 'delta-hb',
    enabled: true,
    kind: 'delta',
    label: 'Falling Hb — possible bleed',
    analyte: { match: ['haemoglobin'], exclude: ['a1c'] },
    direction: 'fall',
    byPercent: true,
    amber: 15,
    red: 25,
  };
  // 104 → 82 is a ~21.15% fall — crosses amber (15%) but not red (25%).
  const hb82 = mkResult('Haemoglobin', 82, {
    unit: 'g/L',
    date: '2026-06-01',
    history: [{ value: 104, date: '2026-03-01', unit: 'g/L' }],
  });
  const hbOut = evaluateReportSeverity(makeReport([hb82]), { resultRules: [fallingHb] });
  assert(hbOut.level === 'amber', '~21% fall crosses amber (15%) but not red (25%) → level amber');
  assert(hbOut.flagged[0].deltaSummary.includes('%'), 'percent-mode deltaSummary includes a "%" suffix');
  assert(hbOut.flagged[0].deltaSummary.startsWith('-'), 'a FALL renders a signed negative percent (no explicit "+")');

  // A bigger percent fall crosses red.
  const hb60 = mkResult('Haemoglobin', 60, {
    unit: 'g/L',
    date: '2026-06-01',
    history: [{ value: 104, date: '2026-03-01', unit: 'g/L' }],
  });
  const hbRedOut = evaluateReportSeverity(makeReport([hb60]), { resultRules: [fallingHb] });
  assert(hbRedOut.level === 'red', '~42% fall crosses red (25%) → level red');

  // Zero-baseline prior never produces a meaningful percent change — fails closed, no fire.
  const hbZeroPrior = mkResult('Haemoglobin', 5, {
    unit: 'g/L',
    date: '2026-06-01',
    history: [{ value: 0, date: '2026-03-01', unit: 'g/L' }],
  });
  const zeroBaselineOut = evaluateReportSeverity(makeReport([hbZeroPrior]), { resultRules: [fallingHb] });
  assert(zeroBaselineOut.level === 'none', 'a zero-value prior never produces a percent-change delta (fails closed)');
}

console.log('\n--- item 3.6: delta rules — maxDays window ---');
{
  const kRise = {
    id: 'delta-k',
    enabled: true,
    kind: 'delta',
    label: 'Rising potassium',
    analyte: { match: ['potassium'] },
    direction: 'rise',
    by: true,
    amber: 0.5,
    red: 1,
    maxDays: 7,
  };
  // Prior 5 days ago — within the 7-day window → fires.
  const kRecent = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-06-08', unit: 'mmol/L' }],
  });
  const recentOut = evaluateReportSeverity(makeReport([kRecent]), { resultRules: [kRise] });
  assert(recentOut.level === 'red', 'prior within maxDays window → delta fires normally');

  // Prior 30 days ago — OUTSIDE the 7-day window → no fire, even though the magnitude qualifies.
  const kStale = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-05-14', unit: 'mmol/L' }],
  });
  const staleOut = evaluateReportSeverity(makeReport([kStale]), { resultRules: [kRise] });
  assert(staleOut.level === 'none', 'prior OLDER than maxDays → no delta fires (never falls back to it)');

  // Exactly at the boundary (7 days) → still within the window (inclusive).
  const kBoundary = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-06-06', unit: 'mmol/L' }],
  });
  const boundaryOut = evaluateReportSeverity(makeReport([kBoundary]), { resultRules: [kRise] });
  assert(boundaryOut.level === 'red', 'prior exactly at the maxDays boundary → still fires (inclusive)');

  // Either date missing → fails CLOSED (maxDays configured, age unverifiable).
  const kNoCurrentDate = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: null,
    history: [{ value: 5.0, date: '2026-06-08', unit: 'mmol/L' }],
  });
  const noCurrentDateOut = evaluateReportSeverity(makeReport([kNoCurrentDate]), { resultRules: [kRise] });
  assert(noCurrentDateOut.level === 'none', 'maxDays set + missing current date → fails closed, no delta');

  const kNoPriorDate = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: null, unit: 'mmol/L' }],
  });
  const noPriorDateOut = evaluateReportSeverity(makeReport([kNoPriorDate]), { resultRules: [kRise] });
  assert(noPriorDateOut.level === 'none', 'maxDays set + missing prior date → fails closed, no delta');

  // No maxDays configured at all → an old prior still fires (no age limit).
  const kNoLimit = { ...kRise, id: 'delta-k-nolimit', maxDays: undefined };
  const kVeryStale = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2023-01-01', unit: 'mmol/L' }],
  });
  const noLimitOut = evaluateReportSeverity(makeReport([kVeryStale]), { resultRules: [kNoLimit] });
  assert(noLimitOut.level === 'red', 'no maxDays configured → an old prior still fires (no age limit)');
}

console.log('\n--- item 3.6: delta rules — unit-guarded (3.1 reuse) ---');
{
  const kRise = {
    id: 'delta-k-unit',
    enabled: true,
    kind: 'delta',
    label: 'Rising potassium',
    analyte: { match: ['potassium'] },
    direction: 'rise',
    by: true,
    amber: 0.5,
    red: 1,
  };
  // Genuine mismatch (both units present, different families) → no delta, recorded.
  const kMismatch = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-06-08', unit: 'mg/dL' }],
  });
  const mismatchOut = evaluateReportSeverity(makeReport([kMismatch]), { resultRules: [kRise] });
  assert(mismatchOut.level === 'none', 'unit mismatch (mmol/L vs mg/dL) → delta SKIPPED, no fire');
  assert(mismatchOut.unitMismatches.length === 1, 'a genuine unit mismatch IS recorded (mirrors 3.1)');
  assert(mismatchOut.unitMismatches[0].ruleId === 'delta-k-unit', 'unitMismatches entry carries the delta rule id');

  // One side absent (current has a unit, prior does not) → no delta, NOT recorded
  // (nothing confidently wrong to report — same silent-fail-closed rule as extractPrior).
  const kOneAbsent = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-06-08', unit: null }],
  });
  const oneAbsentOut = evaluateReportSeverity(makeReport([kOneAbsent]), { resultRules: [kRise] });
  assert(oneAbsentOut.level === 'none', 'one side has a unit, the other does not → no delta (never a guess)');
  assert(
    oneAbsentOut.unitMismatches.length === 0,
    'one-side-absent is NOT recorded as a mismatch (nothing confirmed wrong)'
  );

  // Both sides absent → treated as comparable (matches extractPrior's own precedent).
  const kBothAbsent = mkResult('Potassium', 6.2, {
    unit: null,
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-06-08', unit: null }],
  });
  const bothAbsentOut = evaluateReportSeverity(makeReport([kBothAbsent]), { resultRules: [kRise] });
  assert(bothAbsentOut.level === 'red', 'both sides absent a unit → treated as comparable, delta fires normally');
}

console.log('\n--- item 3.6: delta rules — no history / suppressIfProblem / disabled ---');
{
  const kRise = {
    id: 'delta-k-hist',
    enabled: true,
    kind: 'delta',
    label: 'Rising potassium',
    analyte: { match: ['potassium'] },
    direction: 'rise',
    by: true,
    amber: 0.5,
    red: 1,
  };
  // No history at all → never fires (nothing to compare against).
  const kNoHistory = mkResult('Potassium', 6.2, { unit: 'mmol/L', date: '2026-06-13', history: [] });
  const noHistOut = evaluateReportSeverity(makeReport([kNoHistory]), { resultRules: [kRise] });
  assert(noHistOut.level === 'none', 'no history at all → delta never fires');

  // Disabled delta rule is ignored entirely.
  const kQualifying = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 5.0, date: '2026-06-08', unit: 'mmol/L' }],
  });
  const disabledOut = evaluateReportSeverity(makeReport([kQualifying]), {
    resultRules: [{ ...kRise, enabled: false }],
  });
  assert(disabledOut.level === 'none', 'a disabled delta rule is ignored (like every other rule kind)');

  // suppressIfProblem honoured — patient already on record for the relevant problem.
  const kSuppressed = {
    ...kRise,
    id: 'delta-k-suppress',
    suppressIfProblem: { match: ['chronic kidney disease'] },
  };
  const suppressedOut = evaluateReportSeverity(makeReport([kQualifying]), {
    resultRules: [kSuppressed],
    problems: [{ label: 'Chronic kidney disease stage 3' }],
  });
  assert(suppressedOut.level === 'none', 'suppressIfProblem honoured for a delta rule, exactly like other kinds');
  const notSuppressedOut = evaluateReportSeverity(makeReport([kQualifying]), {
    resultRules: [kSuppressed],
    problems: [{ label: 'Asthma' }],
  });
  assert(notSuppressedOut.level === 'red', 'an unrelated problem does not suppress the delta rule');
}

console.log('\n--- item 3.6: delta rules — escalate-only (raises, never lowers) ---');
{
  // A delta rule can RAISE a lab-normal result to amber/red …
  const raiseRule = {
    id: 'delta-raise',
    enabled: true,
    kind: 'delta',
    label: 'Rising creatinine',
    analyte: { match: ['creatinine'] },
    direction: 'rise',
    by: true,
    amber: 15,
    red: 26,
  };
  const labNormalButRising = mkResult('Creatinine', 128, {
    unit: 'umol/L',
    low: 60,
    high: 135, // 128 is within the lab's own reference range → isAbove/isBelow both false
    isAbove: false,
    isBelow: false,
    urgent: false,
    date: '2026-06-13',
    history: [{ value: 110, date: '2026-06-08', unit: 'umol/L' }],
  });
  const raisedOut = evaluateReportSeverity(makeReport([labNormalButRising]), { resultRules: [raiseRule] });
  assert(raisedOut.level === 'amber', "a delta rule RAISES a lab-normal-range result's severity");

  // … but NEVER lowers a lab-urgent flag, even when the delta itself would only grade amber.
  const labUrgentTinyRise = mkResult('Creatinine', 150, {
    unit: 'umol/L',
    low: 60,
    high: 120,
    isAbove: true,
    isBelow: false,
    urgent: true, // lab itself already flags this urgent
    date: '2026-06-13',
    history: [{ value: 148, date: '2026-06-12', unit: 'umol/L' }], // rise of only 2 — below even amber (15)
  });
  const neverLoweredOut = evaluateReportSeverity(makeReport([labUrgentTinyRise]), { resultRules: [raiseRule] });
  assert(neverLoweredOut.level === 'red', 'a lab-urgent flag is NEVER lowered by a weak/non-firing delta rule');
  assert(
    neverLoweredOut.flagged[0].ruleLabel === null,
    'the lab flag (not the delta rule) drove severity → no rule attribution on the chip'
  );

  // … nor lowers a THRESHOLD rule's escalation when the delta rule itself doesn't fire.
  const potassiumThreshold = {
    id: 'threshold-k',
    enabled: true,
    label: 'High potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
  };
  const weakDelta = {
    id: 'delta-k-weak',
    enabled: true,
    kind: 'delta',
    label: 'Rising potassium (weak)',
    analyte: { match: ['potassium'] },
    direction: 'rise',
    by: true,
    amber: 5, // a huge bar — this result's actual rise won't cross it
    red: 10,
  };
  const kBothRulesResult = mkResult('Potassium', 6.2, {
    unit: 'mmol/L',
    date: '2026-06-13',
    history: [{ value: 6.0, date: '2026-06-08', unit: 'mmol/L' }], // rise of only 0.2 — the delta rule never fires
  });
  const combinedOut = evaluateReportSeverity(makeReport([kBothRulesResult]), {
    resultRules: [potassiumThreshold, weakDelta],
  });
  assert(combinedOut.level === 'red', "the threshold rule's red escalation is not diluted by a non-firing delta rule");
  assert(
    combinedOut.flagged[0].ruleLabel === 'High potassium',
    'the THRESHOLD rule (not the delta) attributes the chip'
  );

  // When a delta rule reaches a HIGHER severity than a firing threshold rule, the
  // delta rule's attribution wins the chip (never diluted by the weaker threshold).
  const amberOnlyThreshold = { ...potassiumThreshold, id: 'threshold-k-amber-only', red: null };
  const strongDelta = {
    id: 'delta-k-strong',
    enabled: true,
    kind: 'delta',
    label: 'Rising potassium (strong)',
    analyte: { match: ['potassium'] },
    direction: 'rise',
    by: true,
    amber: 0.1,
    red: 0.15, // this result's rise of 0.2 crosses red
  };
  const bothFireOut = evaluateReportSeverity(makeReport([kBothRulesResult]), {
    resultRules: [amberOnlyThreshold, strongDelta],
  });
  assert(bothFireOut.level === 'red', 'threshold reaches amber, delta reaches red → combined level is red');
  assert(
    bothFireOut.flagged[0].ruleLabel === 'Rising potassium (strong)',
    'the HIGHER-severity delta rule attributes the chip, not the weaker amber-only threshold rule'
  );
  assert(bothFireOut.flagged[0].deltaSummary !== null, 'deltaSummary is set when the delta rule wins the attribution');

  // Tie (both reach the SAME severity): the threshold-rule result wins the tie, so a
  // report with NO delta rules configured is byte-identical to before this field existed.
  const tiedDelta = { ...strongDelta, id: 'delta-k-tied', amber: 0.15, red: 10 }; // reaches only 'abnormal', same as threshold
  const tiedOut = evaluateReportSeverity(makeReport([kBothRulesResult]), {
    resultRules: [amberOnlyThreshold, tiedDelta],
  });
  assert(tiedOut.level === 'amber', 'a tie between threshold and delta severity still grades correctly');
  assert(
    tiedOut.flagged[0].ruleLabel === 'High potassium',
    'on a severity TIE, the threshold-rule result wins attribution (preserves pre-delta behaviour)'
  );
  assert(tiedOut.flagged[0].deltaSummary === null, 'on a threshold-wins tie, deltaSummary is null');
}

// ── item 3.5: patient-context gate (contextAllows + evaluateReportSeverity) ───
// No shipped result rule carries a context clause (ZERO shipped context rules —
// see TRIAGE-LENS-2026-07-02.md item 3.5), so every rule here is constructed inline.
console.log('\n--- item 3.5: contextAllows (direct) ---');
{
  // No context clause on the rule → always allowed, regardless of patientContext.
  assert(contextAllows({}, undefined) === true, 'no context clause: allowed with no patientContext');
  assert(
    contextAllows({}, { ageYears: 10, sex: 'male' }) === true,
    'no context clause: allowed with any patientContext'
  );
  assert(contextAllows({ context: null }, undefined) === true, 'context: null is treated as no gate');

  // An EMPTY context object ({}) has no clauses to violate — always allowed.
  assert(contextAllows({ context: {} }, undefined) === true, 'context: {} (no clauses) allowed with no patientContext');

  // minAge / maxAge — fail closed when patientContext or ageYears is absent.
  const over65 = { context: { minAge: 65 } };
  assert(contextAllows(over65, undefined) === false, 'minAge clause: no patientContext at all → fail closed');
  assert(contextAllows(over65, {}) === false, 'minAge clause: patientContext present but no ageYears → fail closed');
  assert(contextAllows(over65, { ageYears: 70 }) === true, 'minAge clause: age 70 >= 65 → allowed');
  assert(contextAllows(over65, { ageYears: 65 }) === true, 'minAge clause: age exactly 65 (inclusive) → allowed');
  assert(contextAllows(over65, { ageYears: 64 }) === false, 'minAge clause: age 64 < 65 → not allowed');
  assert(contextAllows(over65, { ageYears: NaN }) === false, 'minAge clause: non-finite ageYears → fail closed');

  const under16 = { context: { maxAge: 15 } };
  assert(contextAllows(under16, { ageYears: 10 }) === true, 'maxAge clause: age 10 <= 15 → allowed');
  assert(contextAllows(under16, { ageYears: 15 }) === true, 'maxAge clause: age exactly 15 (inclusive) → allowed');
  assert(contextAllows(under16, { ageYears: 16 }) === false, 'maxAge clause: age 16 > 15 → not allowed');
  assert(contextAllows(under16, undefined) === false, 'maxAge clause: no patientContext → fail closed');

  const band = { context: { minAge: 18, maxAge: 65 } };
  assert(contextAllows(band, { ageYears: 40 }) === true, 'band clause: age within [18,65] → allowed');
  assert(contextAllows(band, { ageYears: 17 }) === false, 'band clause: age below band → not allowed');
  assert(contextAllows(band, { ageYears: 66 }) === false, 'band clause: age above band → not allowed');

  // sex — fail closed when patientContext or sex is absent; case-insensitive compare.
  const femaleOnly = { context: { sex: 'female' } };
  assert(contextAllows(femaleOnly, undefined) === false, 'sex clause: no patientContext → fail closed');
  assert(contextAllows(femaleOnly, {}) === false, 'sex clause: patientContext present but no sex → fail closed');
  assert(contextAllows(femaleOnly, { sex: 'female' }) === true, 'sex clause: matching sex → allowed');
  assert(contextAllows(femaleOnly, { sex: 'male' }) === false, 'sex clause: non-matching sex → not allowed');
  assert(contextAllows(femaleOnly, { sex: 'Female' }) === true, 'sex clause: case-insensitive match ("Female")');

  // Both age and sex clauses — AND semantics, both must be confirmed and satisfied.
  const both = { context: { minAge: 65, sex: 'male' } };
  assert(contextAllows(both, { ageYears: 70, sex: 'male' }) === true, 'both clauses satisfied → allowed');
  assert(contextAllows(both, { ageYears: 70, sex: 'female' }) === false, 'age ok, sex wrong → not allowed');
  assert(contextAllows(both, { ageYears: 40, sex: 'male' }) === false, 'sex ok, age wrong → not allowed');
  assert(contextAllows(both, { ageYears: 70 }) === false, 'age ok, sex missing from patientContext → fail closed');
  assert(contextAllows(both, { sex: 'male' }) === false, 'sex ok, age missing from patientContext → fail closed');
}

console.log('\n--- item 3.5: context gate — threshold rules ---');
{
  const fib4Over65 = {
    id: 'ctx-fib4-over65',
    enabled: true,
    kind: 'threshold',
    label: 'FIB-4 raised (over 65)',
    analyte: { match: ['fib-4'] },
    comparator: 'above',
    amber: 3.25,
    context: { minAge: 65 },
  };
  const fib4Result = mkResult('FIB-4', 3.5);

  const firesOut = evaluateReportSeverity(makeReport([fib4Result]), {
    resultRules: [fib4Over65],
    patientContext: { ageYears: 70 },
  });
  assert(firesOut.level === 'amber', 'threshold+context: fires when patient matches (age 70 >= 65)');
  assert(
    firesOut.flagged[0].ruleLabel === 'FIB-4 raised (over 65)',
    'threshold+context: chip attributes the context rule'
  );

  const noPatientContextOut = evaluateReportSeverity(makeReport([fib4Result]), { resultRules: [fib4Over65] });
  assert(
    noPatientContextOut.level === 'none',
    'threshold+context: SKIPPED (fail closed) when patientContext is omitted entirely'
  );

  const underAgeOut = evaluateReportSeverity(makeReport([fib4Result]), {
    resultRules: [fib4Over65],
    patientContext: { ageYears: 40 },
  });
  assert(underAgeOut.level === 'none', 'threshold+context: SKIPPED when patient age is confirmed but out of range');

  const noAgeFieldOut = evaluateReportSeverity(makeReport([fib4Result]), {
    resultRules: [fib4Over65],
    patientContext: { sex: 'male' }, // patientContext present, but no ageYears
  });
  assert(
    noAgeFieldOut.level === 'none',
    'threshold+context: SKIPPED when patientContext lacks the needed ageYears field'
  );
}

console.log('\n--- item 3.5: context gate — text rules ---');
{
  // Deliberately avoids every item-3.2-Part-B POSITIVE_QUALITATIVE lexicon token
  // ('positive','detected','reactive','isolated','abnormal','seen','present',
  // 'grown','raised') in both the abnormalText phrase and the result text — a
  // context-skipped rule is expected to fall through to 'none' here, and using a
  // lexicon word would instead trip the UNRELATED unclassified-positive fallback
  // (see the dedicated fall-through assertion further below, which deliberately
  // DOES use 'isolated' to pin that separate mechanism).
  const femaleTextRule = {
    id: 'ctx-text-female',
    enabled: true,
    kind: 'text',
    label: 'Needs review (female)',
    analyte: { match: ['culture'] },
    abnormalText: ['mrsa colonisation confirmed'],
    context: { sex: 'female' },
  };
  const cultureResult = { name: 'Culture', value: NaN, text: 'mrsa colonisation confirmed', unit: null, history: [] };

  const firesOut = evaluateReportSeverity(makeReport([cultureResult]), {
    resultRules: [femaleTextRule],
    patientContext: { sex: 'female' },
  });
  assert(firesOut.level === 'amber', 'text+context: fires when patient sex matches');
  assert(
    firesOut.reviewTop && firesOut.reviewTop.label === 'Needs review (female)',
    'text+context: reviewTop attributes the context rule'
  );

  const wrongSexOut = evaluateReportSeverity(makeReport([cultureResult]), {
    resultRules: [femaleTextRule],
    patientContext: { sex: 'male' },
  });
  assert(wrongSexOut.level === 'none', 'text+context: SKIPPED when patient sex does not match');
  assert(wrongSexOut.reviewCount === 0, 'text+context: no review recorded on a sex mismatch');

  const noPatientContextOut = evaluateReportSeverity(makeReport([cultureResult]), { resultRules: [femaleTextRule] });
  assert(noPatientContextOut.level === 'none', 'text+context: SKIPPED (fail closed) when patientContext is omitted');

  // A context-skipped text rule must NOT mark the result "applied" — it must stay
  // eligible for the item 3.2 Part B unclassified-positive fall-through exactly as
  // if no text rule existed at all (skipped ≡ not seen, not ≡ seen-but-none).
  const positiveOnlyResult = { name: 'Culture', value: NaN, text: 'Organisms isolated', unit: null, history: [] };
  const skippedFallThroughOut = evaluateReportSeverity(makeReport([positiveOnlyResult]), {
    resultRules: [femaleTextRule],
    patientContext: { sex: 'male' },
  });
  assert(
    skippedFallThroughOut.unclassified.length === 1 && skippedFallThroughOut.unclassified[0].token === 'isolated',
    'text+context: a context-skipped rule leaves the result open to the unclassified-positive fall-through'
  );
}

console.log('\n--- item 3.5: context gate — delta rules ---');
{
  const childKRise = {
    id: 'ctx-delta-child-k',
    enabled: true,
    kind: 'delta',
    label: 'Rising potassium (child)',
    analyte: { match: ['potassium'] },
    direction: 'rise',
    by: true,
    amber: 0.5,
    context: { maxAge: 15 },
  };
  const kResult = mkResult('Potassium', 5.0, {
    unit: 'mmol/L',
    history: [{ value: 4.2, date: '2026-06-08', unit: 'mmol/L' }],
  });

  const firesOut = evaluateReportSeverity(makeReport([kResult]), {
    resultRules: [childKRise],
    patientContext: { ageYears: 10 },
  });
  assert(firesOut.level === 'amber', 'delta+context: fires when patient matches (age 10 <= 15)');
  assert(
    firesOut.flagged[0].deltaSummary !== null,
    'delta+context: deltaSummary set when the context-gated delta wins attribution'
  );

  const adultOut = evaluateReportSeverity(makeReport([kResult]), {
    resultRules: [childKRise],
    patientContext: { ageYears: 40 },
  });
  assert(adultOut.level === 'none', 'delta+context: SKIPPED when patient age is confirmed but out of range');

  const noPatientContextOut = evaluateReportSeverity(makeReport([kResult]), { resultRules: [childKRise] });
  assert(noPatientContextOut.level === 'none', 'delta+context: SKIPPED (fail closed) when patientContext is omitted');
}

console.log('\n--- item 3.5: context gate — combo rules ---');
{
  const comboOver65Male = {
    id: 'ctx-combo-over65-male',
    kind: 'combo',
    enabled: true,
    label: 'Combo (over 65, male)',
    level: 'amber',
    context: { minAge: 65, sex: 'male' },
    conditions: [
      { analyte: { match: ['pus cells'] }, comparator: 'above', value: 10 },
      { analyte: { match: ['culture'] }, contains: ['no growth'] },
    ],
  };
  const pusResult = mkResult('Pus cells', 50);
  const noGrowthResult = { name: 'Culture', value: NaN, text: 'No growth', unit: null, history: [] };
  const comboReport = makeReport([pusResult, noGrowthResult]);

  const firesOut = evaluateReportSeverity(comboReport, {
    resultRules: [comboOver65Male],
    patientContext: { ageYears: 70, sex: 'male' },
  });
  assert(firesOut.comboCount === 1, 'combo+context: fires when patient matches both clauses');
  assert(firesOut.level === 'amber', 'combo+context: report escalated to amber');

  const wrongSexOut = evaluateReportSeverity(comboReport, {
    resultRules: [comboOver65Male],
    patientContext: { ageYears: 70, sex: 'female' },
  });
  assert(wrongSexOut.comboCount === 0, 'combo+context: SKIPPED when one clause (sex) does not match');

  const noPatientContextOut = evaluateReportSeverity(comboReport, { resultRules: [comboOver65Male] });
  assert(noPatientContextOut.comboCount === 0, 'combo+context: SKIPPED (fail closed) when patientContext is omitted');
}

console.log('\n--- item 3.5: byte-identical when no rule carries a context clause ---');
{
  // A report with a mix of threshold/text/delta rules, NONE carrying a context
  // clause, must produce the EXACT SAME evaluateReportSeverity output whether or
  // not patientContext is supplied — the gate must be a true no-op for every
  // rule that doesn't opt into it.
  const plainThreshold = {
    id: 'plain-k',
    enabled: true,
    kind: 'threshold',
    label: 'High potassium',
    analyte: { match: ['potassium'] },
    comparator: 'above',
    amber: 5.5,
    red: 6.0,
  };
  const plainText = {
    id: 'plain-msu',
    enabled: true,
    kind: 'text',
    label: 'Needs review',
    analyte: { match: ['MSU'] },
    normalText: ['no growth'],
  };
  const kResult = mkResult('Potassium', 6.2, { unit: 'mmol/L' });
  const msuResult = { name: 'MSU', value: NaN, text: 'growth of e. coli', unit: null, history: [] };
  const rules = [plainThreshold, plainText];
  const report = makeReport([kResult, msuResult]);

  const withoutPatientContext = evaluateReportSeverity(report, { resultRules: rules });
  const withPatientContext = evaluateReportSeverity(report, {
    resultRules: rules,
    patientContext: { ageYears: 70, sex: 'female' },
  });
  assert(
    JSON.stringify(withoutPatientContext) === JSON.stringify(withPatientContext),
    'output is byte-identical with/without patientContext when no rule carries a context clause'
  );
  assert(withoutPatientContext.level === 'red', 'sanity: the plain rules still fire as expected (level red)');
}

// ── item 3.3: calibration pass — new/changed shipped result rules ─────────────
// Tests the REAL shipped defaults.json rules (SHIPPED_RESULT_RULES/shippedRule above),
// not stand-ins — pins the calibrated thresholds themselves, so a future accidental
// edit to defaults.json fails here, not just in production.

console.log('\n--- item 3.3: base-high-sodium (hypernatraemia, NEW) ---');
{
  const rule = shippedRule('base-high-sodium');
  const rules = [rule];
  const below = evaluateReportSeverity(makeReport([mkResult('Sodium', 149, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(below.level === 'none', 'sodium 149 (below amber 150) → quiet');
  const amber = evaluateReportSeverity(makeReport([mkResult('Sodium', 152, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(amber.level === 'amber', 'sodium 152 (>= amber 150, < red 160) → amber');
  const stillAmber = evaluateReportSeverity(makeReport([mkResult('Sodium', 156, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(stillAmber.level === 'amber', 'sodium 156 (>= amber 150, still < red 160) → amber');
  const red = evaluateReportSeverity(makeReport([mkResult('Sodium', 162, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(red.level === 'red', 'sodium 162 (>= red 160, better-sourced "severe" cutoff) → red');
}

console.log('\n--- item 3.3: base-high-creatinine-aki (NEW) ---');
{
  const rule = shippedRule('base-high-creatinine-aki');
  const rules = [rule];
  const below = evaluateReportSeverity(makeReport([mkResult('Creatinine', 200, { unit: 'µmol/L' })]), {
    resultRules: rules,
  });
  assert(below.level === 'none', 'creatinine 200 (below red 354, no amber configured) → quiet');
  const red = evaluateReportSeverity(makeReport([mkResult('Creatinine', 400, { unit: 'µmol/L' })]), {
    resultRules: rules,
  });
  assert(red.level === 'red', 'creatinine 400 (>= red 354) → red (KDIGO stage 3)');
}

console.log('\n--- item 3.3: base-creatinine-delta-aki (NEW, kind:delta) ---');
{
  const rule = shippedRule('base-creatinine-delta-aki');
  assert(rule.kind === 'delta', 'sanity: base-creatinine-delta-aki is kind:delta');
  const rules = [rule];
  const risingWithinWindow = mkResult('Creatinine', 176, {
    unit: 'µmol/L',
    date: '2026-06-13',
    history: [{ value: 148, date: '2026-06-11', unit: 'µmol/L' }],
  });
  const fires = evaluateReportSeverity(makeReport([risingWithinWindow]), { resultRules: rules });
  assert(fires.level === 'amber', 'creatinine +28 µmol/L over 2 days (KDIGO stage 1 absolute rise) → amber');

  const smallRise = mkResult('Creatinine', 160, {
    unit: 'µmol/L',
    date: '2026-06-13',
    history: [{ value: 148, date: '2026-06-11', unit: 'µmol/L' }],
  });
  const quiet = evaluateReportSeverity(makeReport([smallRise]), { resultRules: rules });
  assert(quiet.level === 'none', 'creatinine +12 µmol/L (below the 26.5 delta) → quiet');

  const risingOutsideWindow = mkResult('Creatinine', 176, {
    unit: 'µmol/L',
    date: '2026-06-13',
    history: [{ value: 148, date: '2026-06-01', unit: 'µmol/L' }], // 12 days prior
  });
  const outsideWindow = evaluateReportSeverity(makeReport([risingOutsideWindow]), { resultRules: rules });
  assert(outsideWindow.level === 'none', 'same +28 rise but prior is outside the 48h maxDays window → quiet');
}

console.log('\n--- item 3.3: base-high-glucose (hyperglycaemia, NEW) ---');
{
  const rule = shippedRule('base-high-glucose');
  const rules = [rule];
  const below = evaluateReportSeverity(makeReport([mkResult('Glucose', 9, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(below.level === 'none', 'glucose 9 (below amber 11.1) → quiet');
  const amber = evaluateReportSeverity(makeReport([mkResult('Glucose', 15, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(amber.level === 'amber', 'glucose 15 (>= amber 11.1, < red 30) → amber');
  const red = evaluateReportSeverity(makeReport([mkResult('Glucose', 32, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(red.level === 'red', 'glucose 32 (>= red 30, HHS range) → red');
}

console.log('\n--- item 3.3: base-low-glucose (hypoglycaemia, NEW) ---');
{
  const rule = shippedRule('base-low-glucose');
  const rules = [rule];
  const above = evaluateReportSeverity(makeReport([mkResult('Glucose', 4.5, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(above.level === 'none', 'glucose 4.5 (above amber 4.0) → quiet');
  const amber = evaluateReportSeverity(makeReport([mkResult('Glucose', 3.5, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(amber.level === 'amber', 'glucose 3.5 (<= amber 4.0, > red 3.0) → amber ("4 is the floor")');
  const red = evaluateReportSeverity(makeReport([mkResult('Glucose', 2.6, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(red.level === 'red', 'glucose 2.6 (<= red 3.0, JBDS level 2) → red');
}

console.log('\n--- item 3.3: base-high-alt / base-high-ast (transaminitis, NEW) ---');
{
  for (const id of ['base-high-alt', 'base-high-ast']) {
    const rule = shippedRule(id);
    const name = id === 'base-high-alt' ? 'ALT' : 'AST';
    const rules = [rule];
    const below = evaluateReportSeverity(makeReport([mkResult(name, 80, { unit: 'U/L' })]), { resultRules: rules });
    assert(below.level === 'none', `${id}: ${name} 80 (below amber 120, ~2x ULN) → quiet`);
    const amber = evaluateReportSeverity(makeReport([mkResult(name, 150, { unit: 'U/L' })]), { resultRules: rules });
    assert(amber.level === 'amber', `${id}: ${name} 150 (>= amber 120, 3x ULN) → amber`);
    const red = evaluateReportSeverity(makeReport([mkResult(name, 350, { unit: 'U/L' })]), { resultRules: rules });
    assert(red.level === 'red', `${id}: ${name} 350 (>= red 320, 8x ULN) → red`);
  }
}

console.log('\n--- item 3.3: base-high-crp (NEW) ---');
{
  const rule = shippedRule('base-high-crp');
  const rules = [rule];
  const below = evaluateReportSeverity(makeReport([mkResult('CRP', 10, { unit: 'mg/L' })]), { resultRules: rules });
  assert(below.level === 'none', 'CRP 10 (below amber 20, NICE CG191 no-antibiotic band) → quiet');
  const amber = evaluateReportSeverity(makeReport([mkResult('CRP', 50, { unit: 'mg/L' })]), { resultRules: rules });
  assert(amber.level === 'amber', 'CRP 50 (>= amber 20, delayed-antibiotic band) → amber');
  const red = evaluateReportSeverity(makeReport([mkResult('CRP', 120, { unit: 'mg/L' })]), { resultRules: rules });
  assert(red.level === 'red', 'CRP 120 (>= red 100, immediate-antibiotic band) → red');
}

console.log('\n--- item 3.3: base-high-wcc / base-high-neutrophils (sepsis signal, NEW) ---');
{
  const wccRule = shippedRule('base-high-wcc');
  const below = evaluateReportSeverity(makeReport([mkResult('White cell count', 8, { unit: '×10⁹/L' })]), {
    resultRules: [wccRule],
  });
  assert(below.level === 'none', 'WCC 8 (below amber 12) → quiet');
  const amber = evaluateReportSeverity(makeReport([mkResult('White cell count', 14, { unit: '×10⁹/L' })]), {
    resultRules: [wccRule],
  });
  assert(amber.level === 'amber', 'WCC 14 (>= amber 12, SIRS/sepsis-screen criterion) → amber');

  const neutRule = shippedRule('base-high-neutrophils');
  const neutBelow = evaluateReportSeverity(makeReport([mkResult('Neutrophils', 6, { unit: '×10⁹/L' })]), {
    resultRules: [neutRule],
  });
  assert(neutBelow.level === 'none', 'neutrophils 6 (below amber 7.5) → quiet');
  const neutAmber = evaluateReportSeverity(makeReport([mkResult('Neutrophils', 9, { unit: '×10⁹/L' })]), {
    resultRules: [neutRule],
  });
  assert(neutAmber.level === 'amber', 'neutrophils 9 (>= amber 7.5) → amber (neutrophilia)');
}

console.log('\n--- item 3.3: base-high-potassium amber band (CHANGED — added amber) ---');
{
  const rule = shippedRule('base-high-potassium');
  const rules = [rule];
  const below = evaluateReportSeverity(makeReport([mkResult('Potassium', 5.8, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(below.level === 'none', 'potassium 5.8 (below amber 6.0) → quiet');
  const amber = evaluateReportSeverity(makeReport([mkResult('Potassium', 6.2, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(amber.level === 'amber', 'potassium 6.2 (UKKA "moderate" 6.0–6.4) → amber, NOT red');
  const red = evaluateReportSeverity(makeReport([mkResult('Potassium', 6.6, { unit: 'mmol/L' })]), {
    resultRules: rules,
  });
  assert(red.level === 'red', 'potassium 6.6 (still >= red 6.5, unchanged) → red');
}

console.log('\n--- item 3.3: base-hba1c-diabetes recalibration (CHANGED — red → amber) ---');
{
  const rule = shippedRule('base-hba1c-diabetes');
  assert(rule.red === null || rule.red === undefined, 'sanity: base-hba1c-diabetes no longer carries a red threshold');
  assert(rule.amber === 48, 'sanity: base-hba1c-diabetes amber is 48');
  const out = evaluateReportSeverity(makeReport([mkResult('HbA1c', 52, { unit: 'mmol/mol' })]), {
    resultRules: [rule],
  });
  assert(out.level === 'amber', 'HbA1c 52 (>= 48) → amber, not red (alert-fatigue demotion)');
  assert(out.urgentCount === 0, 'HbA1c 52 → urgentCount 0 (never escalates to red any more)');
}

console.log('\n--- item 3.3 (REVERTED): base-fib4-elevated status quo (red ≥2.67 all ages) ---');
{
  // The 3.3 FIB-4 recalibration (red→3.25 + a context:{maxAge:64} companion rule) was
  // REVERTED after independent verification: red 3.25 is the hepatitis-C FIB-4 cutoff,
  // wrong for NAFLD/MASLD; and the real age-adjustment raises the rule-OUT (low-risk)
  // cutoff for ≥65 — a SUPPRESSION this escalate-only engine cannot express. So the rule
  // is back at its original red 2.67 for all ages, and the under-65 companion rule is gone.
  const baseRule = shippedRule('base-fib4-elevated');
  assert(baseRule.red === 2.67, 'sanity: base-fib4-elevated red is back at the status-quo 2.67');
  assert(baseRule.amber === 1.3, 'sanity: base-fib4-elevated amber unchanged at 1.3');
  assert(
    !SHIPPED_RESULT_RULES.some((r) => r && r.id === 'base-fib4-elevated-under65'),
    'the base-fib4-elevated-under65 companion rule was deleted (no longer shipped)'
  );
  const rules = [baseRule];

  const highEveryone = evaluateReportSeverity(makeReport([mkResult('Fibrosis-4 score', 2.9)]), {
    resultRules: rules,
  });
  assert(highEveryone.level === 'red', 'FIB-4 2.9 (>= red 2.67) fires red for everyone, no patientContext needed');

  const amberBand = evaluateReportSeverity(makeReport([mkResult('Fibrosis-4 score', 2.0)]), {
    resultRules: rules,
  });
  assert(amberBand.level === 'amber', 'FIB-4 2.0 (>= amber 1.3, < red 2.67) → amber');

  const quiet = evaluateReportSeverity(makeReport([mkResult('Fibrosis-4 score', 1.1)]), {
    resultRules: rules,
  });
  assert(quiet.level === 'none', 'FIB-4 1.1 (below amber 1.3) → quiet');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
