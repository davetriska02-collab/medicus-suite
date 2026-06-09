// redteam-rules — red-team report builder
// Usage: node build_report.js <findings.json> <run-meta.json> <output.md>
// Reads mechanical verification findings + run metadata and writes a
// patient-safety red-team report in Markdown (no deps beyond Node core).

'use strict';

const fs = require('fs');

const [, , findingsPath, metaPath, outPath] = process.argv;
if (!findingsPath || !metaPath || !outPath) {
  console.error('Usage: node build_report.js <findings.json> <run-meta.json> <out.md>');
  process.exit(1);
}

const findings = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, OK: 3, UNKNOWN: 4 };
const SEVERITY_BADGE = {
  CRITICAL: '🔴 CRITICAL',
  HIGH: '🟠 HIGH',
  MEDIUM: '🟡 MEDIUM',
  OK: '🟢 OK',
};

const L = [];
const p = (s = '') => L.push(s);

const gaps = findings.filter(f => f.classification === 'CONFIRMED_GAP')
  .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
const fps = findings.filter(f => f.classification === 'FALSE_POSITIVE');
const ok = findings.filter(f => f.classification === 'OK');
const criticalGaps = gaps.filter(f => f.severity === 'CRITICAL');
const highGaps = gaps.filter(f => f.severity === 'HIGH');

// ---- Title block ----
p('# Redteam Rules — Sentinel drug-monitoring coverage report');
p('');
p(`**Practice:** ${meta.practice_name || 'GP Practice'}  `);
p(`**Generated:** ${fmtDate(meta.generated_at)}  `);
p(`**Extension version:** ${meta.manifest_version || '?'}  `);
p(`**Engine:** \`${meta.engine_file || 'engine/rules-engine.js'}\`  `);
p(`**Rules checked:** ${meta.rules_checked || '?'} · **Agents dispatched:** ${meta.agents_dispatched || '?'}  `);
p(`**Candidates evaluated:** ${meta.total_candidates || findings.length} · **Confirmed gaps:** ${meta.confirmed_gaps ?? gaps.length} · **False positives:** ${meta.false_positives ?? fps.length} · **OK/already covered:** ${meta.ok_count ?? ok.length}`);
p('');
p('> **How to read this report.** Every finding below was verified against the **live `drugMatchesRule()` engine** — these are not LLM guesses. A CONFIRMED GAP means the engine returns `false` for a prescription that should trigger monitoring. A FALSE POSITIVE means the engine fires a chip for a drug outside the rule\'s scope. No rule edits have been made — this is a proposal for the Clinical Safety Officer (Dave) to review.');
p('');

// ---- Patient-safety banner ----
if (criticalGaps.length > 0) {
  p('## ⚠️ Patient-safety alert');
  p('');
  p(`**${criticalGaps.length} CRITICAL gap${criticalGaps.length > 1 ? 's' : ''} found** on high-risk drug rules (DMARD / lithium / antipsychotic / antithyroid / amiodarone / antiepileptic). A prescription matching these patterns would silently receive no monitoring chip — a missed clinical alert on a drug with narrow therapeutic index or serious toxicity risk.`);
  p('');
}

// ---- CRITICAL gaps ----
p('## Critical gaps (immediate action)');
p('');
if (criticalGaps.length === 0) {
  p('_No critical gaps found this run. All high-risk monitoring rules appear to cover their UK brand set._');
} else {
  p('These prescriptions should trigger a monitoring chip but currently do not. Verified against the real engine.');
  p('');
  p('| Rule | Drug class | Prescription string | Reason | Suggested match term |');
  p('|------|-----------|---------------------|--------|---------------------|');
  for (const f of criticalGaps) {
    p(`| \`${esc(f.ruleId)}\` | ${esc(f.drugClass)} | ${esc(f.drug)} | ${esc(f.reason)} | \`${esc(f.suggestedMatchTerm || '—')}\` |`);
  }
}
p('');

// ---- HIGH gaps ----
p('## High-priority gaps');
p('');
if (highGaps.length === 0) {
  p('_No high-priority gaps found this run._');
} else {
  p('| Rule | Drug class | Prescription string | Reason | Suggested match term |');
  p('|------|-----------|---------------------|--------|---------------------|');
  for (const f of highGaps) {
    p(`| \`${esc(f.ruleId)}\` | ${esc(f.drugClass)} | ${esc(f.drug)} | ${esc(f.reason)} | \`${esc(f.suggestedMatchTerm || '—')}\` |`);
  }
}
p('');

// ---- False positives ----
p('## False positives (rules firing incorrectly)');
p('');
if (fps.length === 0) {
  p('_No false positives found this run. Substring matching appears well-scoped._');
} else {
  p('These prescriptions incorrectly trigger a monitoring chip. Verified against the real engine.');
  p('');
  p('| Rule | Drug class | Prescription string | Reason | Note |');
  p('|------|-----------|---------------------|--------|------|');
  for (const f of fps) {
    p(`| \`${esc(f.ruleId)}\` | ${esc(f.drugClass)} | ${esc(f.drug)} | ${esc(f.reason)} | ${esc(f.note)} |`);
  }
}
p('');

// ---- Actionable additions ----
const actionable = gaps.filter(f => f.suggestedMatchTerm);
if (actionable.length > 0) {
  p('## Actionable: suggested `drug.match` additions');
  p('');
  p('For each confirmed gap, the suggested lowercase match term to add to `drug.match` in `rules/drug-rules.json`. Verify each against BNF / dm+d before applying. After adding, extend `EXPECTED` in `test-drug-brand-coverage.js` and run `node test-drug-brand-coverage.js`.');
  p('');

  // Group by ruleId
  const byRule = {};
  for (const f of actionable) {
    if (!byRule[f.ruleId]) byRule[f.ruleId] = [];
    byRule[f.ruleId].push(f);
  }
  for (const [ruleId, items] of Object.entries(byRule)) {
    const terms = [...new Set(items.map(f => f.suggestedMatchTerm).filter(Boolean))];
    p(`**\`${ruleId}\`** — add to \`drug.match\`: \`${terms.join('`, `')}\``);
    for (const f of items) {
      p(`- \`"${f.drug}"\` → \`"${f.suggestedMatchTerm}"\` _(${f.reason})_`);
    }
    p('');
  }
}

// ---- Per-rule summary ----
p('## Per-rule summary');
p('');
const rulesSeen = [...new Set(findings.map(f => f.ruleId))].sort();
p('| Rule | Drug class | Gaps | False positives | Status |');
p('|------|-----------|------|----------------|--------|');
for (const ruleId of rulesSeen) {
  const ruleFindings = findings.filter(f => f.ruleId === ruleId);
  const rGaps = ruleFindings.filter(f => f.classification === 'CONFIRMED_GAP');
  const rFps = ruleFindings.filter(f => f.classification === 'FALSE_POSITIVE');
  const drugClass = ruleFindings[0]?.drugClass || '';
  const status = rGaps.length > 0
    ? (rGaps.some(f => f.severity === 'CRITICAL') ? '🔴 CRITICAL gaps' : '🟠 Gaps found')
    : rFps.length > 0 ? '🟡 False positives' : '🟢 Clean';
  p(`| \`${esc(ruleId)}\` | ${esc(drugClass)} | ${rGaps.length} | ${rFps.length} | ${status} |`);
}
p('');

// ---- Appendix ----
p('---');
p('');
p('## Appendix: verification methodology');
p('');
p('All candidates were verified mechanically via `engine/rules-engine.js` `drugMatchesRule()` — the same function the regression test suite (`test-drug-brand-coverage.js`) uses. A CONFIRMED GAP is a candidate for which `drugMatchesRule` returned `false`; a FALSE POSITIVE is one for which it returned `true`. Model recall was used only for candidate generation; mechanical verification is the source of truth.');
p('');
p(`**Candidates marked OK (already covered or correctly rejected):** ${ok.length}`);
p('');
p('**Out of scope for this tool:** Rules with `enabled: false`; the hrtContext oestrogen-gate secondary logic (see note on hrt-systemic false positives above); local ICB formulary items; individual patient prescription history.');
p('');
p('**This report does not edit any rule files.** The CSO reviews findings and approves changes. To apply a gap fix: add the term to `drug.match`, update `EXPECTED` in `test-drug-brand-coverage.js`, run the test suite, bump manifest (patch), add a CHANGELOG entry, commit and push.');

fs.writeFileSync(outPath, L.join('\n'));

const summary = `Report written: ${outPath}\n  ${criticalGaps.length} CRITICAL gaps · ${highGaps.length} HIGH gaps · ${fps.length} false positives · ${ok.length} OK`;
console.log(summary);
