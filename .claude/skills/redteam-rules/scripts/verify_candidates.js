// redteam-rules — mechanical candidate verifier
// Usage: node verify_candidates.js <candidates.json> <findings.json>
//
// Reads the merged agent output (potentialGaps + potentialFalsePositives),
// runs every candidate through the REAL drugMatchesRule() engine, and classifies
// each as CONFIRMED_GAP, FALSE_POSITIVE, or OK. Never trusts model recall —
// verification is entirely mechanical against the live rule files.

'use strict';

const fs = require('fs');
const path = require('path');

const [, , candidatesPath, findingsPath] = process.argv;
if (!candidatesPath || !findingsPath) {
  console.error('Usage: node verify_candidates.js <candidates.json> <findings.json>');
  process.exit(1);
}

// Resolve from project root (three levels up from this script)
const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const engine = require(path.join(ROOT, 'engine', 'rules-engine.js'));
const ruleset = require(path.join(ROOT, 'rules', 'drug-rules.json'));

// Build a rule index
const ruleIndex = {};
for (const rule of ruleset.rules || []) {
  ruleIndex[rule.id] = rule;
}

// High-risk rules where a confirmed gap is CRITICAL (narrow therapeutic index,
// haematological/hepatic toxicity, or serious psychiatric monitoring obligation)
const CRITICAL_RULES = new Set([
  'methotrexate-maintenance',
  'leflunomide-maintenance',
  'azathioprine-maintenance',
  'hydroxychloroquine-maintenance',
  'carbamazepine-maintenance',
  'lithium-maintenance',
  'amiodarone-maintenance',
  'carbimazole-propylthiouracil',
  'antipsychotic',
]);

const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

const findings = [];
let confirmedGaps = 0;
let falsePositives = 0;
let okCount = 0;

for (const c of candidates) {
  const rule = ruleIndex[c.ruleId];
  if (!rule) {
    findings.push({ ...c, classification: 'UNKNOWN_RULE', note: `Rule "${c.ruleId}" not found in drug-rules.json` });
    continue;
  }

  const matches = engine.drugMatchesRule(c.drug, rule);

  let classification, severity, note;

  if (c.kind === 'gap') {
    if (!matches) {
      classification = 'CONFIRMED_GAP';
      severity = CRITICAL_RULES.has(c.ruleId) ? 'CRITICAL' : 'HIGH';
      note = `drugMatchesRule returned false — this prescription would NOT trigger the ${c.ruleId} chip`;
      confirmedGaps++;
    } else {
      classification = 'OK';
      severity = 'OK';
      note = 'Already matched by an existing match substring — no gap';
      okCount++;
    }
  } else if (c.kind === 'fp') {
    if (matches) {
      classification = 'FALSE_POSITIVE';
      severity = 'MEDIUM';
      // Special case: hrt-systemic has an additional oestrogen gate in evaluateDrugRule
      // that may suppress the chip even if drugMatchesRule returns true
      if (c.ruleId === 'hrt-systemic') {
        note = 'drugMatchesRule returned true — hrtContext oestrogen gate may suppress at eval time; verify manually against evaluateDrugRule logic';
      } else {
        note = `drugMatchesRule returned true — this unrelated prescription WOULD incorrectly trigger the ${c.ruleId} chip`;
      }
      falsePositives++;
    } else {
      classification = 'OK';
      severity = 'OK';
      note = 'Correctly rejected by engine — no false positive';
      okCount++;
    }
  } else {
    classification = 'UNKNOWN_KIND';
    severity = 'UNKNOWN';
    note = `Unknown candidate kind: "${c.kind}"`;
  }

  // For confirmed gaps, suggest which match term to add
  let suggestedMatchTerm = null;
  if (classification === 'CONFIRMED_GAP') {
    // Suggest the first word of the drug name (likely the brand/generic stem) if it's
    // not already a substring of an existing match term
    const words = c.drug.toLowerCase().split(/\s+/);
    const existing = (rule.drug?.match || []).map(m => m.toLowerCase());
    suggestedMatchTerm = words.find(w => w.length > 3 && !existing.some(m => m.includes(w) || w.includes(m)));
    if (!suggestedMatchTerm) suggestedMatchTerm = words[0] || null;
  }

  findings.push({
    ruleId: c.ruleId,
    drugClass: rule.drugClass || '',
    drug: c.drug,
    kind: c.kind,
    reason: c.reason,
    classification,
    severity,
    note,
    ...(suggestedMatchTerm ? { suggestedMatchTerm } : {}),
  });
}

fs.writeFileSync(findingsPath, JSON.stringify(findings, null, 2));

const total = candidates.length;
console.log(`\nVerification complete: ${total} candidates`);
console.log(`  CONFIRMED GAPS: ${confirmedGaps} (${findings.filter(f => f.severity === 'CRITICAL').length} CRITICAL, ${findings.filter(f => f.severity === 'HIGH').length} HIGH)`);
console.log(`  FALSE POSITIVES: ${falsePositives}`);
console.log(`  OK (no action): ${okCount}`);
console.log(`\nFindings written to: ${findingsPath}`);
