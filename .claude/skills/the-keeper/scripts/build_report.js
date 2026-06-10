// The Keeper - rule-change proposal report builder
// Usage: node build_report.js <changes.json> <run-meta.json> <output.md>
// Reads the verified, applied rule changes + run metadata and writes a
// Clinical-Safety-Officer change-proposal report in Markdown (no deps).

'use strict';
const fs = require('fs');

const [, , changesPath, metaPath, outPath] = process.argv;
if (!changesPath || !metaPath || !outPath) {
  console.error('Usage: node build_report.js <changes.json> <run-meta.json> <out.md>');
  process.exit(1);
}

const changes = JSON.parse(fs.readFileSync(changesPath, 'utf8'));
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

const SECTIONS = [
  { key: 'drugs', title: 'Medicines monitoring', file: 'rules/drug-rules.json' },
  { key: 'qof', title: 'QOF registers and indicators', file: 'rules/qof-rules.json' },
  { key: 'vaccines', title: 'Vaccine eligibility', file: 'rules/vaccine-rules.json' },
  { key: 'alerts', title: 'Prescribing-safety alerts', file: 'rules/alert-library.json' },
  {
    key: 'medreview',
    title: 'Medication-review instruments (ACB / STOPP-START / PINCER)',
    file: 'engine/acb-scores.js, engine/stopp-start.js, visualiser-core.js',
  },
  {
    key: 'pathways',
    title: 'Reception pathways and clinical thresholds',
    file: 'rules/reception-pathways.json + threshold constants',
  },
];
const RAG_BADGE = { Red: '🔴 Red', Amber: '🟠 Amber', Green: '🟢 Green' };
const RAG_ORDER = { Red: 0, Amber: 1, Green: 2 };

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|');

const L = [];
const p = (s = '') => L.push(s);

// ---- Title block ----
p('# The Keeper — Sentinel rule-change proposal');
p('');
p(`**Practice:** ${meta.practice_name || 'GP Practice'}  `);
p(`**Generated:** ${fmtDate(meta.generated_at)}  `);
if (meta.manifest_version_before || meta.manifest_version_after) {
  p(`**Extension version:** ${meta.manifest_version_before || '?'} → ${meta.manifest_version_after || '(unbumped)'}  `);
}
p(`**Rule files touched:** ${(meta.rule_files_touched || []).join(', ') || 'none'}  `);
p(
  `**Tests:** ${meta.tests_passed ? '✅ passing' : '❌ FAILING — do not merge'}${meta.tests_run && meta.tests_run.length ? ` (${meta.tests_run.join(', ')})` : ''}`
);
p('');
p(
  '> **How to read this.** The Keeper compares the suite’s clinical rule sets against their ' +
    'authoritative UK sources and proposes only verified, sourced changes. Every change links to the ' +
    'source it was checked against. Changes are rated 🔴 Red (a current patient-safety drift — usually ' +
    'a silent monitoring/alerting gap), 🟠 Amber (update to stay current) or 🟢 Green (housekeeping). ' +
    '**This is a proposal for the Clinical Safety Officer to review — clinical rule changes are not ' +
    'auto-merged.** Anything that could *reduce* alerting is collected in the sign-off box below.'
);
p('');

// ---- Sign-off box (safety-weakening changes) ----
const weakening = changes.filter((c) => !c.killed && c.weakens_safety);
p('## ⚠️ Changes needing CSO sign-off');
p('');
if (weakening.length === 0) {
  p('_None. No proposed change reduces alerting; all changes are additive or housekeeping._');
} else {
  p(
    'These changes could *reduce* what Sentinel flags (longer interval, removed test, narrower ' +
      'match, new exclude, disabled/retired rule, or higher threshold). Each needs explicit CSO ' +
      'approval before merge.'
  );
  p('');
  p('| Rule | Change | Source says | RAG |');
  p('|------|--------|-------------|-----|');
  for (const c of weakening) {
    p(
      `| \`${esc(c.rule_id)}\` (${esc(c.domain)}) | ${esc(c.proposed)} | ${esc((c.provenance || {}).evidence || c.rationale)} | ${RAG_BADGE[c.rag] || c.rag} |`
    );
  }
}
p('');

// ---- Action this run (Red) ----
const reds = changes.filter((c) => !c.killed && c.rag === 'Red');
p('## Action this run (Red)');
p('');
if (reds.length === 0) {
  p('_No Red drift found this run._');
} else {
  p('| Rule | Domain | Change | Test lock-in |');
  p('|------|--------|--------|--------------|');
  for (const c of reds) {
    p(`| \`${esc(c.rule_id)}\` | ${esc(c.domain)} | ${esc(c.title)} | ${esc(c.test_update || 'none')} |`);
  }
}
p('');

// ---- Sections ----
for (const sec of SECTIONS) {
  p(`## ${sec.title}`);
  p(`<sub>\`${sec.file}\`</sub>`);
  p('');
  const items = changes
    .filter((c) => !c.killed && c.domain === sec.key)
    .sort((a, b) => (RAG_ORDER[a.rag] ?? 3) - (RAG_ORDER[b.rag] ?? 3));
  if (items.length === 0) {
    p('_No changes this run._');
    p('');
    continue;
  }
  for (const c of items) {
    const status = c.window_status === 'previously-flagged' ? ' _(previously flagged, still open)_' : '';
    p(`### ${RAG_BADGE[c.rag] || c.rag} — ${c.title}${status}`);
    p('');
    p(
      `- **Rule:** \`${esc(c.rule_id)}\`${c.needs_engine_change ? '  ⚙️ _needs rules-engine extension — ship disabled with placeholder_' : ''}`
    );
    p(`- **Now:** ${esc(c.current)}`);
    p(`- **Proposed:** ${esc(c.proposed)}`);
    p(`- **Why it matters:** ${esc(c.rationale)}`);
    if (c.test_update && c.test_update !== 'none') p(`- **Regression lock-in:** ${esc(c.test_update)}`);
    const pv = c.provenance || {};
    p(`- **Source:** ${esc(c.source)} — ${c.source_url ? `<${c.source_url}>` : '(no URL)'} (${esc(c.source_date)})`);
    if (pv.evidence) p(`- **Verified evidence:** ${esc(pv.evidence)}`);
    p(
      `- **Provenance:** verified by ${esc(pv.verified_by || 'unconfirmed')} on ${fmtDate(pv.checked_at)} — ${esc(pv.method || 'method not recorded')}, confidence ${esc(pv.confidence || 'unknown')}.`
    );
    p('');
  }
}

// ---- Appendix ----
p('---');
p('');
p('## Appendix: scan transparency');
p('');
p(`**Sources checked:** ${(meta.sources_checked || []).join('; ')}.`);
p('');
if (meta.baseline) {
  p('**Rule-file baseline at start of run:**');
  for (const [k, v] of Object.entries(meta.baseline)) p(`- \`${k}\`: ${v}`);
  p('');
}
p(`**Candidates excluded as low relevance:** ${meta.excluded_low_relevance ?? 0}.`);
p('');
const killed = changes.filter((c) => c.killed);
if (killed.length) {
  p('**Candidates killed during verification (not applied):**');
  for (const c of killed) p(`- \`${esc(c.id)}\`: ${esc(c.reason)}`);
  p('');
}
if (meta.source_gaps && meta.source_gaps.length) {
  p(
    `**⚠️ Sources that could not be reached this run:** ${meta.source_gaps.join('; ')}. _Treat the affected rules as unchecked this run._`
  );
  p('');
}
p(
  '**Out of scope:** local ICB formularies and shared-care boundaries are not covered by this ' +
    'national scan. Paste a local formulary line into a run to fold it in.'
);
p('');
p(
  "**Disclaimer:** The Keeper keeps Sentinel's approximations of the source guidance current. It is " +
    'a memory aid, not the official QOF business rules, the BNF, or a prescribing system. The CSO ' +
    'reviews and approves every clinical rule change.'
);
p('');

fs.writeFileSync(outPath, L.join('\n'));
const applied = changes.filter((c) => !c.killed).length;
console.log(
  `Wrote ${outPath} (${applied} changes, ${reds.length} red, ${weakening.length} needing sign-off, ${killed.length} killed)`
);
