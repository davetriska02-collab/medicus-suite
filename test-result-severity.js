// test-result-severity.js — unit tests for evaluateReportSeverity
// Run with: node test-result-severity.js
'use strict';

const { evaluateReportSeverity } = require('./engine/result-severity.js');

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
    id: 'rule_both', enabled: true, kind: 'text', label: 'Flagged finding',
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
    id: 'rule_both', enabled: true, kind: 'text', label: 'Flagged finding', normalLabel: 'Routine',
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
    name: 'Histology report', value: NaN, rawValue: histologyText,
    comparator: null, unit: null, low: null, high: null,
    isAbove: false, isBelow: false, urgent: false, interpretation: null,
    date: '2026-05-21', history: [], text: histologyText,
  };
  const histologyRule = {
    id: 'rule_histology', enabled: true, kind: 'text',
    label: 'Histology — review', normalLabel: 'Benign — no dysplasia/malignancy',
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
    const r = rules.find(x => x && x.id === id);
    assert(!!r, `base rule present in defaults.json: ${id}`);
    if (r) {
      assert(r.builtin === true && r.enabled === true, `${id}: builtin + enabled`);
      assert(validateResultRule(r).length === 0, `${id}: validates clean`);
    }
  }
  // Fire the full shipped base set against representative results (now RED-ONLY).
  const baseSet = rules.filter(r => baseIds.includes(r.id));
  const fire = (name, value, problems) =>
    evaluateReportSeverity(makeReport([mkResult(name, value)]), { resultRules: baseSet, problems }).level;
  // Red-only: only critically-deranged values fire; the rest are left to the lab flag (none here).
  assert(fire('Haemoglobin', 65) === 'red', 'base: Haemoglobin 65 → red');
  assert(fire('Haemoglobin', 95) === 'red', 'base: Haemoglobin 95 → red (red threshold <100)');
  assert(fire('Haemoglobin', 130) === 'none', 'base: Haemoglobin 130 → none');
  assert(fire('Potassium', 6.6) === 'red', 'base: Potassium 6.6 → red');
  assert(fire('Potassium', 6.2) === 'none', 'base: Potassium 6.2 → none (red-only, <6.5)');
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

  // HbA1c conditional flags
  assert(fire('HbA1c', 50) === 'red', 'base: HbA1c 50, no record → red (possible diabetes)');
  assert(fire('HbA1c', 44) === 'amber', 'base: HbA1c 44, no record → amber (prediabetes)');
  assert(fire('HbA1c', 38) === 'none', 'base: HbA1c 38 → none');
  // Known diabetic → diabetes flag suppressed (and prediabetes too)
  assert(
    fire('HbA1c', 60, [{ label: 'Type 2 diabetes mellitus' }]) === 'none',
    'base: HbA1c 60 with T2DM on record → none (suppressed)'
  );
  // Known prediabetic with a NEW diabetic-range HbA1c → diabetes flag still fires (progression)
  assert(
    fire('HbA1c', 50, [{ label: 'Pre-diabetes' }]) === 'red',
    'base: HbA1c 50 with prediabetes on record → red (progression to diabetes still flagged)'
  );
  // "non-diabetic hyperglycaemia" must NOT suppress the diabetes flag (footgun guard)
  assert(
    fire('HbA1c', 50, [{ label: 'Non-diabetic hyperglycaemia' }]) === 'red',
    'base: HbA1c 50 with non-diabetic hyperglycaemia → red (not a diabetes diagnosis)'
  );
  // Prediabetes flag suppressed once prediabetes is on record
  assert(
    fire('HbA1c', 44, [{ label: 'Impaired glucose tolerance' }]) === 'none',
    'base: HbA1c 44 with IGT on record → none (prediabetes suppressed)'
  );
  // H1 (patient-safety): a FAMILY HISTORY code must NOT suppress the new-diabetes flag
  assert(
    fire('HbA1c', 52, [{ label: 'Family history of diabetes mellitus' }]) === 'red',
    'H1: HbA1c 52 with "Family history of diabetes mellitus" → red (NOT suppressed)'
  );
  // M1 (alert fatigue): known diabetics coded without "mellitus"/"type N" still suppress
  assert(fire('HbA1c', 60, [{ label: 'Steroid-induced diabetes' }]) === 'none', 'M1: steroid-induced diabetes → suppressed');
  assert(fire('HbA1c', 60, [{ label: 'Pancreatic diabetes' }]) === 'none', 'M1: pancreatic diabetes → suppressed');
  assert(fire('HbA1c', 60, [{ label: 'Type-2 diabetes' }]) === 'none', 'M1: hyphenated "Type-2 diabetes" → suppressed');
  assert(fire('HbA1c', 60, [{ label: 'T2DM' }]) === 'none', 'M1: "T2DM" abbreviation → suppressed');
  // Broadened match must NOT over-suppress the footgun look-alikes
  assert(fire('HbA1c', 52, [{ label: 'Pre-diabetic retinopathy' }]) === 'red', 'pre-diabetic retinopathy → red (not suppressed)');
  assert(fire('HbA1c', 52, [{ label: 'Diabetes insipidus' }]) === 'red', 'diabetes insipidus → red (not suppressed)');

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
  shipped.forEach(r => {
    const errs = validateResultRule(r);
    if (errs.length) { allValid = false; console.error(`    ${r && r.id}: ${errs.join('; ')}`); }
  });
  assert(allValid, 'every shipped result rule validates against the schema');

  const byId = Object.fromEntries(shipped.map(r => [r.id, r]));
  // The six rules added in this change must all be present.
  ['base-lithium-toxicity', 'base-digoxin-toxicity', 'base-low-potassium',
   'base-high-calcium', 'base-egfr-amber', 'base-blood-culture'].forEach(id => {
    assert(!!byId[id], `shipped rules include ${id}`);
  });

  // Helper: build a single-result report and grade it with the shipped rules.
  const grade = (name, value) =>
    evaluateReportSeverity(makeReport([{ name, value, urgent: false, isAbove: false, isBelow: false }]),
      { resultRules: shipped });
  const gradeText = (name, text) =>
    evaluateReportSeverity(makeReport([{ name, value: null, text, urgent: false, isAbove: false, isBelow: false }]),
      { resultRules: shipped });

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
  assert(gramNeg.level === 'amber' && gramNeg.reviewCount === 1, 'blood culture "Gram negative ... isolated" → still amber review');
}

// ── The Keeper additions: hypocalcaemia / hypomagnesaemia / TSH (disabled) ────
// These four ship disabled-by-default (Unreviewed) pending CSO source verification.
// Guard: they exist, are inert as shipped, and fire/exclude/suppress correctly once enabled.
console.log('\n--- Keeper rules: low-Ca / low-Mg / TSH ship disabled, behave when enabled ---');
{
  const shipped = require('./defaults.json').resultRules;
  const byId = Object.fromEntries(shipped.map(r => [r.id, r]));
  const keeperIds = ['base-low-calcium', 'base-low-magnesium', 'base-high-tsh', 'base-low-tsh'];

  keeperIds.forEach(id => {
    assert(byId[id] && byId[id].enabled === false,
      `${id} ships disabled-by-default (Unreviewed, awaiting CSO sign-off)`);
  });

  // As shipped (disabled), they must NOT fire even on a critical value.
  const asShipped = (name, value) =>
    evaluateReportSeverity(makeReport([{ name, value, urgent: false, isAbove: false, isBelow: false }]),
      { resultRules: shipped });
  assert(asShipped('Adjusted calcium', 1.5).level === 'none', 'disabled low-Ca rule does not fire as shipped');
  assert(asShipped('Serum magnesium', 0.3).level === 'none', 'disabled low-Mg rule does not fire as shipped');
  assert(asShipped('TSH', 50).level === 'none', 'disabled high-TSH rule does not fire as shipped');

  // Force-enable a single rule and grade against it (+ optional problem list).
  const withRule = (id, name, value, problems) =>
    evaluateReportSeverity(
      makeReport([{ name, value, text: '', urgent: false, isAbove: false, isBelow: false }]),
      { resultRules: [{ ...byId[id], enabled: true }], problems: problems || [] }
    );

  // Hypocalcaemia: matches adjusted/corrected only; amber 2.1, red 1.9; ionised excluded.
  assert(withRule('base-low-calcium', 'Adjusted calcium', 2.05).level === 'amber', 'adjusted calcium 2.05 → amber');
  assert(withRule('base-low-calcium', 'Corrected calcium', 1.8).level === 'red', 'corrected calcium 1.8 → red');
  assert(withRule('base-low-calcium', 'Ionised calcium', 1.1).level === 'none', 'ionised calcium 1.1 → none (excluded)');
  // Deliberate design: a bare/un-adjusted "Calcium" must NOT trip the low rule (hypoalbuminaemia false-positive guard).
  assert(withRule('base-low-calcium', 'Calcium', 1.8).level === 'none', 'bare "Calcium" 1.8 → none (adjusted-only match)');

  // Hypomagnesaemia: amber 0.6, red 0.5; urine excluded.
  assert(withRule('base-low-magnesium', 'Serum magnesium', 0.58).level === 'amber', 'magnesium 0.58 → amber');
  assert(withRule('base-low-magnesium', 'Magnesium', 0.4).level === 'red', 'magnesium 0.4 → red');
  assert(withRule('base-low-magnesium', 'Urine magnesium', 0.4).level === 'none', 'urine magnesium → none (excluded)');

  // High TSH: amber 10, red 20; "TSH receptor antibody" excluded; suppressed by hypothyroidism on record.
  assert(withRule('base-high-tsh', 'TSH', 12).level === 'amber', 'TSH 12 → amber');
  assert(withRule('base-high-tsh', 'TSH', 25).level === 'red', 'TSH 25 → red');
  assert(withRule('base-high-tsh', 'TSH receptor antibody', 40).level === 'none', 'TSH receptor antibody → none (excluded)');
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

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
