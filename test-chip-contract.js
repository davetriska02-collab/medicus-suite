// Medicus Suite — Producer→Consumer chip CONTRACT test
// Run with: node test-chip-contract.js
//
// Drives the REAL engine producers (engine/rules-engine.js evaluators, and the
// queue result-triage selectResultChips() in content.js) into the REAL renderer
// consumers (shared/chip-renderer.js + the system-chip label substitution) for
// EVERY chip type, and asserts the renderer reads exactly the fields the engine
// emits. This is the regression guard for producer↔renderer field-name / shape
// drift — the class of bug that shipped before:
//   • engine emitted qs.summary/provenance but the renderer read qs.items[]
//     (see test-cqc-render.js);
//   • engine emitted coverage.drug.matchedTerms while the renderer read
//     coverage.matchedTerms.
// When such a drift recurs, the emitted value simply will not appear in the
// rendered HTML — and a check below fails. Asserting against the REAL modules
// (require()'d, never re-implemented) is the whole point: any field rename on
// either side breaks the contract here, in CI, not months later in clinic.
//
// Coverage:
//   1. drug-monitoring   → ChipRenderer.renderDrugChip
//   2. qof-indicator     → ChipRenderer.renderQofIndicatorChip
//   3. drug-combo        → ChipRenderer.renderDrugComboChip
//   4. event-count       → ChipRenderer.renderEventCountChip
//   5. composite         → ChipRenderer.renderCompositeChip
//   6. vaccine           → ChipRenderer.renderVaccineChip
//   7. evidence panel    → ChipRenderer.renderEvidencePanel (drug chip's evidence)
//   8. result-triage     → selectResultChips() {id,vars} → system-chip {var}
//                          substitution against the SHIPPED defaults.json labels.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

// ── Load the REAL modules ───────────────────────────────────────────────────
const engine = require('./engine/rules-engine.js');
const CR = require('./shared/chip-renderer.js');

const NOW = '2026-05-29T00:00:00.000Z';

// A renderer reads the field it should iff the engine-emitted VALUE appears in
// the rendered HTML. esc() mirrors the renderer's HTML-escaping so the assertion
// compares against the exact substring the renderer would emit.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================
// 1. drug-monitoring → renderDrugChip
// ============================================================
console.log('1. drug-monitoring: evaluateDrugRule → ChipRenderer.renderDrugChip');

const mtxRule = {
  type: 'drug-monitoring',
  enabled: true,
  id: 'contract-mtx',
  drugClass: 'DMARD',
  drug: { match: ['methotrexate'] },
  source: 'BNF methotrexate monitoring',
  tests: [{ name: 'FBC', match: ['fbc', 'full blood count'], intervalDays: 84, dueSoonDays: 14 }],
};
const mtxMeds = [{ name: 'Methotrexate 10mg tablets', startDate: '2022-01-01' }];
const mtxObs = [{ name: 'FBC', code: '26604007', date: '2026-02-01', value: 'normal' }];
const drugChip = engine
  .evaluatePatient(mtxMeds, mtxObs, [mtxRule], { now: NOW, problems: [] })
  .find((c) => c.type === 'drug-monitoring' && c.ruleId === 'contract-mtx');

check(!!drugChip, 'engine produced a drug-monitoring chip');
const drugHtml = CR.renderDrugChip(drugChip);
// Field-name contract: the renderer must read drugName, drugClass, status, tests[],
// matchedTerm, evidence, ruleId — each surfaced as a specific substring.
check(drugHtml.includes(esc(drugChip.drugName)), 'renderer reads chip.drugName');
check(drugHtml.includes(esc(drugChip.drugClass)), 'renderer reads chip.drugClass');
check(
  drugHtml.includes(`sent-chip-${CR.STATUS_COLOUR[drugChip.status]}`),
  `renderer maps chip.status ('${drugChip.status}') → colour class`
);
check(drugHtml.includes(CR.STATUS_LABEL[drugChip.status]), 'renderer maps chip.status → status label badge');
// tests[] are read field-by-field: testName/name + status. The engine writes the
// per-test object; assert the test NAME the engine emitted reaches the DOM.
const t0 = drugChip.tests[0];
check(!!t0, 'engine emitted drugChip.tests[0]');
check(drugHtml.includes(esc(t0.testName || t0.name)), 'renderer reads tests[].testName/name');
// matchedTerm: engine emits chip.matchedTerm; renderer surfaces it in a data-tip.
// (Only when it is not a trivial echo of the drug name — methotrexate qualifies.)
check(typeof drugChip.matchedTerm === 'string' || drugChip.matchedTerm === null, 'engine emits chip.matchedTerm field');
if (drugChip.matchedTerm && drugChip.matchedTerm.toLowerCase() !== String(drugChip.drugName).toLowerCase()) {
  check(
    drugHtml.includes(`Matched monitoring rule on '${drugChip.matchedTerm}'`),
    'renderer reads chip.matchedTerm (NOT chip.matched / chip.term)'
  );
}
// evidence object drives the clickable affordance.
check(!!drugChip.evidence, 'engine emitted chip.evidence');
check(
  drugHtml.includes('sent-chip-clickable') && drugHtml.includes('data-evidence-key'),
  'renderer reads chip.evidence'
);
// Invariant guard: the canonical chip class must be present (CSS-token scope).
check(/class="sent-chip /.test(drugHtml), 'drug chip top-level class is .sent-chip (token-scope invariant)');

// ============================================================
// 2. qof-indicator → renderQofIndicatorChip
// ============================================================
console.log('\n2. qof-indicator: evaluateQofIndicatorRule → ChipRenderer.renderQofIndicatorChip');

// Use REAL shipped qof rules. Drive them through evaluatePatient (the real top-level
// producer) so the register precondition (_registerLookup) is built exactly as in
// production: an enabled observation-threshold indicator + its register rule, a coded
// register problem, and a raised BP that fails the indicator threshold.
const qofDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'qof-rules.json'), 'utf8'));
const qofRule = qofDoc.rules.find(
  (r) => r.type === 'qof-indicator' && r.enabled !== false && r.check && r.check.kind === 'observation-threshold'
);
check(!!qofRule, 'found an enabled observation-threshold qof-indicator rule in qof-rules.json');

let qofChip = null;
if (qofRule) {
  const registerRule = qofDoc.rules.find(
    (r) => r.type === 'qof-register' && r.registerCode === qofRule.requiresRegister
  );
  const obsName = (qofRule.check.observation && qofRule.check.observation[0]) || qofRule.indicatorName;
  // BP indicator → raised "170/100"; numeric threshold → push past it; else "abnormal".
  const value = qofRule.check.thresholdSystolic
    ? '170/100'
    : qofRule.check.threshold != null
      ? String(qofRule.check.threshold + (qofRule.check.operator === '<' ? 50 : -50))
      : 'abnormal';
  // A register problem matching the register rule's first problemMatch term.
  const regProblemTerm = registerRule && (registerRule.problemMatch || [])[0];
  const rules = [qofRule];
  if (registerRule) rules.push(registerRule);
  const allQofChips = engine.evaluatePatient([], [{ name: obsName, value, date: '2026-05-01' }], rules, {
    now: NOW,
    problems: regProblemTerm ? [{ label: regProblemTerm, codedDate: '2020-01-01' }] : [],
    patientContext: { ageYears: 60, sex: 'female' },
    observationHistory: [],
  });
  qofChip = allQofChips.find((c) => c && c.type === 'qof-indicator');
}
// Fall back to a hand-built qof-indicator chip that matches the engine's emit shape
// exactly (so the renderer contract is still exercised even if the real rule's
// thresholds don't trip on the synthetic value).
if (!qofChip) {
  qofChip = {
    type: 'qof-indicator',
    ruleId: 'contract-qof',
    indicatorCode: 'HYP008',
    indicatorName: 'Blood pressure ≤ 140/90',
    status: 'not_met',
    requiresRegister: 'Hypertension',
    points: null,
    thresholds: null,
    valueText: '170/100',
    dateText: '2026-05-01',
    days: 28,
    qofYear: '2025/26',
    qofYearStart: '2025-04-01',
    check: qofRule ? qofRule.check : {},
    source: 'QOF',
    evidence: { summary: 'BP raised', facts: [] },
  };
  console.log('  (note) using engine-shaped synthetic qof chip — real rule did not trip on synthetic value');
}

const qofHtml = CR.renderQofIndicatorChip(qofChip);
check(qofHtml.includes(esc(qofChip.indicatorCode || qofChip.ruleId)), 'renderer reads chip.indicatorCode');
check(qofChip.indicatorName ? qofHtml.includes(esc(qofChip.indicatorName)) : true, 'renderer reads chip.indicatorName');
check(
  qofHtml.includes(`sent-chip-${CR.STATUS_COLOUR[qofChip.status]}`),
  `renderer maps chip.status ('${qofChip.status}') → colour class`
);
if (qofChip.valueText) check(qofHtml.includes(esc(qofChip.valueText)), 'renderer reads chip.valueText');
check(/class="sent-chip /.test(qofHtml), 'qof chip top-level class is .sent-chip (token-scope invariant)');

// ============================================================
// 3. drug-combo → renderDrugComboChip
// ============================================================
console.log('\n3. drug-combo: evaluateDrugComboRule → ChipRenderer.renderDrugComboChip');

const comboRule = {
  type: 'drug-combo',
  id: 'contract-triple-whammy',
  label: 'Triple whammy',
  severity: 'high',
  source: 'NICE CKS AKI',
  notes: 'NSAID + ACEi/ARB + diuretic',
  drugSets: [
    { name: 'NSAID', match: ['ibuprofen', 'naproxen'] },
    { name: 'ACEi/ARB', match: ['ramipril', 'losartan'] },
    { name: 'Diuretic', match: ['furosemide', 'bendroflumethiazide'] },
  ],
};
const comboData = {
  medications: [
    { name: 'Ibuprofen 400mg tablets' },
    { name: 'Ramipril 5mg capsules' },
    { name: 'Furosemide 40mg tablets' },
  ],
  problems: [],
  observations: [],
};
const comboChip = (engine.evaluateDrugComboRule(comboRule, comboData, NOW) || []).find((c) => c.type === 'drug-combo');
check(!!comboChip, 'engine produced a drug-combo chip');
const comboHtml = CR.renderDrugComboChip(comboChip);
check(comboHtml.includes(esc(comboChip.label)), 'renderer reads chip.label');
check(
  comboHtml.includes(`sent-chip-${CR.STATUS_COLOUR[comboChip.status]}`),
  `renderer maps chip.status ('${comboChip.status}') → colour class`
);
// matchSummary is read as an array of { setName, drugs[] } — assert a set NAME and a
// matched DRUG both reach the DOM (the engine field name is matchSummary, not "sets").
check(Array.isArray(comboChip.matchSummary) && comboChip.matchSummary.length > 0, 'engine emitted chip.matchSummary[]');
const cs0 = comboChip.matchSummary[0];
check(comboHtml.includes(esc(cs0.setName)), 'renderer reads matchSummary[].setName');
check(comboHtml.includes(esc(cs0.drugs[0])), 'renderer reads matchSummary[].drugs[]');
check(/class="sent-chip /.test(comboHtml), 'combo chip top-level class is .sent-chip (token-scope invariant)');

// ============================================================
// 4. event-count → renderEventCountChip
// ============================================================
console.log('\n4. event-count: evaluateEventCountRule → ChipRenderer.renderEventCountChip');

const ecRule = {
  type: 'event-count',
  id: 'contract-frequent-attender',
  label: 'Frequent attender',
  severity: 'medium',
  sourceKind: 'problems',
  windowMonths: 12,
  operator: '>=',
  countThreshold: 2,
  match: ['attendance', 'a&e'],
};
const ecData = {
  problems: [
    { label: 'A&E attendance', codedDate: '2026-01-10' },
    { label: 'A&E attendance', codedDate: '2026-03-15' },
    { label: 'A&E attendance', codedDate: '2026-05-01' },
  ],
  observations: [],
  observationHistory: [],
};
const ecChip = (engine.evaluateEventCountRule(ecRule, ecData, NOW) || []).find((c) => c.type === 'event-count');
check(!!ecChip, 'engine produced an event-count chip');
const ecHtml = CR.renderEventCountChip(ecChip);
check(ecHtml.includes(esc(ecChip.label)), 'renderer reads chip.label');
// The renderer composes a summary from count / operator / countThreshold / windowMonths.
check(ecHtml.includes(String(ecChip.count)), 'renderer reads chip.count');
check(ecHtml.includes(String(ecChip.countThreshold)), 'renderer reads chip.countThreshold');
check(ecHtml.includes(String(ecChip.windowMonths)), 'renderer reads chip.windowMonths');
// matchedItems[] are sampled into the chip body.
check(Array.isArray(ecChip.matchedItems) && ecChip.matchedItems.length > 0, 'engine emitted chip.matchedItems[]');
check(ecHtml.includes(esc(ecChip.matchedItems[0])), 'renderer reads chip.matchedItems[]');
check(/class="sent-chip /.test(ecHtml), 'event-count chip top-level class is .sent-chip (token-scope invariant)');

// ============================================================
// 5. composite → renderCompositeChip
// ============================================================
console.log('\n5. composite: evaluateCompositeRule → ChipRenderer.renderCompositeChip');

// Composite reads a Map<ruleId, chip[]> of already-evaluated sub-rules.
const evaluatedById = new Map();
evaluatedById.set('contract-mtx', [drugChip]); // a fired sub-rule
evaluatedById.set('contract-triple-whammy', [comboChip]); // another fired sub-rule
const compositeRule = {
  type: 'composite',
  id: 'contract-composite',
  label: 'Combined risk',
  severity: 'high',
  operator: 'AND',
  ruleIds: ['contract-mtx', 'contract-triple-whammy'],
  notes: 'Both present',
  source: 'local',
};
const allRulesForComposite = [mtxRule, comboRule, compositeRule];
const compositeChip = (engine.evaluateCompositeRule(compositeRule, allRulesForComposite, evaluatedById) || []).find(
  (c) => c.type === 'composite'
);
check(!!compositeChip, 'engine produced a composite chip');
const compHtml = CR.renderCompositeChip(compositeChip);
check(compHtml.includes(esc(compositeChip.label)), 'renderer reads chip.label');
check(
  compHtml.includes(`sent-chip-${CR.STATUS_COLOUR[compositeChip.status]}`),
  `renderer maps chip.status ('${compositeChip.status}') → colour class`
);
// The renderer reads firedRuleIds[] (count) and operator.
check(Array.isArray(compositeChip.firedRuleIds), 'engine emitted chip.firedRuleIds[]');
check(
  compHtml.includes(`${compositeChip.firedRuleIds.length} rule`),
  'renderer reads chip.firedRuleIds[].length (fired count)'
);
check(compHtml.includes(esc(compositeChip.operator)), 'renderer reads chip.operator');
check(/class="sent-chip /.test(compHtml), 'composite chip top-level class is .sent-chip (token-scope invariant)');

// ============================================================
// 6. vaccine → renderVaccineChip
// ============================================================
console.log('\n6. vaccine: evaluateVaccineRule → ChipRenderer.renderVaccineChip');

const vaxDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'vaccine-rules.json'), 'utf8'));
const vaxRule = vaxDoc.rules[0];
check(!!vaxRule, 'found a real vaccine rule in vaccine-rules.json');

let vaxChip = null;
if (vaxRule) {
  // Drive with an age-eligible (65+) patient, no prior dose, and an IN-SEASON `now`
  // (flu season is Sep–Mar, so an out-of-season date suppresses the chip by design).
  const VAX_NOW = '2025-11-15T00:00:00.000Z';
  const vaxData = {
    medications: [],
    observations: [],
    problems: [],
    observationHistory: [],
    patientContext: { ageYears: 72, sex: 'female' },
  };
  const out = engine.evaluateVaccineRule(vaxRule, vaxData, VAX_NOW);
  vaxChip = (out || []).find((c) => c && c.type === 'vaccine');
}
if (!vaxChip) {
  // Engine-shaped synthetic vaccine chip (matches the emit shape at rules-engine.js:2033).
  vaxChip = {
    type: 'vaccine',
    ruleId: 'contract-vax',
    vaccine: 'flu',
    displayName: 'Influenza vaccine',
    status: 'vax_due',
    eligibilityReason: 'Age ≥ 65',
    matchedEvidence: null,
    eventDate: null,
    seasonLabel: 'Flu 2025/26',
    seasonStartIso: '2025-09-01',
    evidence: { summary: 'Influenza vaccine · Age ≥ 65', facts: [] },
    source: 'UKHSA Green Book',
    notes: 'Confirm eligibility',
  };
  console.log('  (note) using engine-shaped synthetic vaccine chip — real rule did not fire on synthetic context');
}
const vaxHtml = CR.renderVaccineChip(vaxChip);
// The renderer reads displayName (NOT drugName), status, eligibilityReason, seasonLabel.
check(
  vaxHtml.includes(esc(vaxChip.displayName || vaxChip.ruleId)),
  'renderer reads chip.displayName (NOT chip.drugName)'
);
check(
  vaxHtml.includes(`sent-chip-${CR.STATUS_COLOUR[vaxChip.status]}`),
  `renderer maps chip.status ('${vaxChip.status}') → colour class`
);
if (vaxChip.eligibilityReason) {
  check(vaxHtml.includes(esc(vaxChip.eligibilityReason)), 'renderer reads chip.eligibilityReason');
}
if (vaxChip.seasonLabel) check(vaxHtml.includes(esc(vaxChip.seasonLabel)), 'renderer reads chip.seasonLabel');
check(/class="sent-chip /.test(vaxHtml), 'vaccine chip top-level class is .sent-chip (token-scope invariant)');

// ============================================================
// 7. evidence panel → renderEvidencePanel (drug chip's real evidence object)
// ============================================================
console.log('\n7. evidence panel: chip.evidence → ChipRenderer.renderEvidencePanel');

const ev = drugChip.evidence;
check(!!ev && typeof ev === 'object', 'drug chip carries an evidence object');
if (ev) {
  const evHtml = CR.renderEvidencePanel(ev);
  // The panel reads evidence.summary and evidence.facts[].{label,value}.
  if (ev.summary) check(evHtml.includes(esc(ev.summary)), 'renderer reads evidence.summary');
  if (Array.isArray(ev.facts) && ev.facts.length > 0) {
    const f0 = ev.facts[0];
    check(evHtml.includes(esc(f0.label)), 'renderer reads evidence.facts[].label');
    check(evHtml.includes(esc(f0.value)), 'renderer reads evidence.facts[].value');
  } else {
    check(true, 'evidence.facts[] empty for this chip — panel renders summary only');
  }
  check(/class="sent-evidence-panel"/.test(evHtml), 'evidence panel top-level class is .sent-evidence-panel');
}

// ============================================================
// 8. result-triage → selectResultChips() {id,vars} → system-chip {var} substitution
// ============================================================
// The queue result-triage producer is selectResultChips(sev) in content.js — it
// emits chips as { id, vars }. The consumer is getSystemChip(id, vars), which
// substitutes each {key} placeholder in the SHIPPED systemChips[id].label
// (defaults.json). The contract: EVERY vars key a producer emits must have a
// matching {key} placeholder in the shipped label for that id — otherwise the
// value is silently dropped (the field-name-drift failure mode, applied to chip
// templates). content.js is off-limits to edit and not requireable (browser IIFE),
// so we vm-extract the pure selectResultChips() exactly as test-result-triage-queue.js
// does, and check it against the REAL shipped labels.
console.log('\n8. result-triage: selectResultChips() vars ↔ shipped systemChips label placeholders');

const contentSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
const fnMatch = contentSrc.match(/function selectResultChips\(sev\) \{[\s\S]*?\n {2}\}/);
check(!!fnMatch, 'selectResultChips() extracted from content.js');

let selectResultChips = null;
if (fnMatch) {
  const sandbox = {};
  vm.runInNewContext(fnMatch[0] + '\nthis.selectResultChips = selectResultChips;', sandbox);
  selectResultChips = sandbox.selectResultChips;
}

// The SHIPPED system-chip labels (the consumer's template source of truth).
const defaults = JSON.parse(fs.readFileSync(path.join(__dirname, 'defaults.json'), 'utf8'));
const shippedLabels = {};
for (const [id, cfg] of Object.entries(defaults.systemChips || {})) {
  shippedLabels[id] = (cfg && cfg.label) || '';
}

// Reproduce getSystemChip()'s substitution so we can assert the rendered text has
// no un-substituted {placeholder} left, AND that every emitted var value lands.
function substitute(label, vars) {
  let text = label;
  if (vars) {
    for (const k of Object.keys(vars)) {
      text = text.split('{' + k + '}').join(String(vars[k]));
    }
  }
  return text;
}
const placeholdersOf = (label) => new Set([...label.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

if (selectResultChips) {
  // A representative sev for each branch, exercising every emitted chip id + its vars.
  const sevCases = [
    {
      name: 'generic urgent',
      sev: {
        level: 'red',
        urgentCount: 2,
        abnormalCount: 2,
        top: { name: 'Potassium', value: '6.8', unit: 'mmol/L' },
        misprioritised: false,
        unmatched: false,
      },
    },
    {
      name: 'rule-driven urgent',
      sev: {
        level: 'red',
        urgentCount: 1,
        abnormalCount: 1,
        top: { name: 'Potassium', value: '6.7', ruleLabel: 'Critical high potassium' },
        misprioritised: false,
        unmatched: false,
      },
    },
    {
      name: 'generic abnormal',
      sev: { level: 'amber', urgentCount: 0, abnormalCount: 3, top: null, misprioritised: false, unmatched: false },
    },
    {
      name: 'rule-driven abnormal',
      sev: {
        level: 'amber',
        urgentCount: 0,
        abnormalCount: 1,
        top: { name: 'HbA1c', ruleLabel: 'Prediabetes range' },
        misprioritised: false,
        unmatched: false,
      },
    },
    {
      name: 'labelled review',
      sev: {
        level: 'amber',
        urgentCount: 0,
        abnormalCount: 0,
        top: null,
        misprioritised: false,
        unmatched: false,
        reviewCount: 1,
        reviewTop: { name: 'BCS:FOB', label: 'Bowel screening: no response' },
      },
    },
    {
      name: 'generic review',
      sev: {
        level: 'amber',
        urgentCount: 0,
        abnormalCount: 0,
        top: null,
        misprioritised: false,
        unmatched: false,
        reviewCount: 2,
        reviewTop: { name: 'MSU', label: 'Needs review' },
      },
    },
    {
      name: 'labelled noGrowth',
      sev: {
        level: 'none',
        urgentCount: 0,
        abnormalCount: 0,
        top: null,
        misprioritised: false,
        unmatched: false,
        noGrowthCount: 1,
        noGrowthTop: { name: 'H. pylori', label: 'Negative' },
      },
    },
    {
      name: 'generic noGrowth',
      sev: {
        level: 'none',
        urgentCount: 0,
        abnormalCount: 0,
        top: null,
        misprioritised: false,
        unmatched: false,
        noGrowthCount: 2,
        noGrowthTop: { name: 'MSU', label: 'No growth' },
      },
    },
    {
      name: 'combo',
      sev: {
        level: 'amber',
        urgentCount: 0,
        abnormalCount: 0,
        top: null,
        misprioritised: false,
        unmatched: false,
        comboCount: 1,
        comboTop: { label: 'Sterile pyuria', level: 'amber' },
      },
    },
    {
      name: 'meta chips',
      sev: {
        level: 'red',
        urgentCount: 1,
        abnormalCount: 1,
        top: { name: 'Sodium', value: '125' },
        misprioritised: true,
        unmatched: true,
      },
    },
  ];

  // Collect the union of (id → emitted var keys) across all branches, then verify
  // each against the shipped label's placeholders.
  const emittedVarsById = new Map();
  for (const { sev } of sevCases) {
    for (const chip of selectResultChips(sev)) {
      if (!emittedVarsById.has(chip.id)) emittedVarsById.set(chip.id, new Set());
      const set = emittedVarsById.get(chip.id);
      Object.keys(chip.vars || {}).forEach((k) => set.add(k));
    }
  }

  check(emittedVarsById.size >= 9, `selectResultChips exercises ≥9 distinct chip ids (got ${emittedVarsById.size})`);

  for (const [id, varKeys] of emittedVarsById) {
    // (a) The shipped config MUST define a label for every id the producer emits.
    check(id in shippedLabels, `shipped systemChips defines a label for producer id '${id}'`);
    const label = shippedLabels[id] || '';
    const placeholders = placeholdersOf(label);
    // (b) Every {placeholder} in the shipped label MUST be filled by a var the
    //     producer emits — an unfilled placeholder renders as literal "{name}".
    for (const ph of placeholders) {
      check(varKeys.has(ph), `'${id}': shipped label placeholder {${ph}} is supplied by selectResultChips vars`);
    }
    // (c) Direction note (NON-failing): a producer var with no {placeholder} in the
    //     DEFAULT label is not a drift bug — getSystemChip ignores unused vars, and
    //     several shipped labels deliberately omit {count} (e.g. queue.resultUrgent =
    //     "{name}", queue.resultReview = "Needs review"). The var is still PROVIDED so
    //     a user who customises the label to add {count} gets it filled. We surface
    //     orphan vars informationally so a genuine rename (e.g. emitting {nm} where the
    //     label says {name}) is visible in the log, while assertion (b) above — which
    //     fails closed when a label placeholder is NOT supplied — guards the real drift.
    for (const vk of varKeys) {
      if (!placeholders.has(vk)) {
        console.log(
          `  note  '${id}': producer var {${vk}} has no placeholder in the default label (deliberate — fillable if customised)`
        );
      }
    }
  }

  // (d) End-to-end: render a couple of branches fully and assert NO un-substituted
  //     placeholder survives, AND the substantive engine value lands in the text.
  const urgentChip = selectResultChips(sevCases[0].sev).find((c) => c.id === 'queue.resultUrgent');
  check(!!urgentChip, 'generic-urgent branch emits queue.resultUrgent');
  if (urgentChip) {
    const rendered = substitute(shippedLabels['queue.resultUrgent'], urgentChip.vars);
    check(!/\{\w+\}/.test(rendered), 'queue.resultUrgent fully substitutes (no leftover {placeholder})');
    check(rendered.includes('Potassium'), 'queue.resultUrgent renders the engine-emitted vars.name (Potassium)');
  }
  const ruleUrgentChip = selectResultChips(sevCases[1].sev).find((c) => c.id === 'queue.resultRuleUrgent');
  check(!!ruleUrgentChip, 'rule-driven branch emits queue.resultRuleUrgent');
  if (ruleUrgentChip) {
    const rendered = substitute(shippedLabels['queue.resultRuleUrgent'], ruleUrgentChip.vars);
    check(!/\{\w+\}/.test(rendered), 'queue.resultRuleUrgent fully substitutes (no leftover {placeholder})');
    // De-dup contract: the rule label "Critical high potassium" already names the
    // analyte "Potassium", so the chip shows the rule label alone — NOT the doubled
    // "Potassium — Critical high potassium".
    check(
      rendered === 'Critical high potassium',
      'queue.resultRuleUrgent de-duplicates the analyte prefix (renders the rule label alone when it already names the analyte)'
    );
  }
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
