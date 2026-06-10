#!/usr/bin/env node
// scripts/check-rule-currency.js
//
// Staleness check for bundled rule files.
// Used by the rule-currency.yml GitHub Actions workflow (weekly cron).
// Also runnable manually: node scripts/check-rule-currency.js [--threshold-days N] [--json]
//
// Exits 0 always — the workflow step decides what to do based on JSON output.
// Prints a JSON report (--json flag) and a Markdown summary to stdout.
// A non-green overall level prints warnings to stderr as well.

'use strict';

const path = require('path');
const fs = require('fs');

// Parse CLI args
const args = process.argv.slice(2);
const thresholdIdx = args.indexOf('--threshold-days');
const thresholdDays = thresholdIdx >= 0 ? parseInt(args[thresholdIdx + 1], 10) : 120;
const jsonOutput = args.includes('--json');

if (!Number.isFinite(thresholdDays) || thresholdDays <= 0) {
  process.stderr.write('Error: --threshold-days must be a positive integer\n');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');

const { assessRuleCurrency } = require(path.join(ROOT, 'shared', 'rule-currency.js'));

// Load all five rule files (same set as the options card).
function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

let drug, qof, vax, alert, reception;
try {
  drug = loadJson('rules/drug-rules.json');
  qof = loadJson('rules/qof-rules.json');
  vax = loadJson('rules/vaccine-rules.json');
  alert = loadJson('rules/alert-library.json');
  reception = loadJson('rules/reception-pathways.json');
} catch (e) {
  process.stderr.write(`Error loading rule files: ${e.message}\n`);
  process.exit(1);
}

const files = [
  { id: 'drug', lastUpdated: drug.lastUpdated, specVersion: drug.specVersion, displayName: 'Drug monitoring rules' },
  { id: 'qof', lastUpdated: qof.lastUpdated, specVersion: qof.specVersion, displayName: 'QOF rules' },
  { id: 'vaccine', lastUpdated: vax.lastUpdated, specVersion: vax.specVersion, displayName: 'Vaccine rules' },
  { id: 'alert', lastUpdated: alert.lastUpdated, specVersion: alert.specVersion, displayName: 'Alert library' },
  {
    id: 'reception',
    lastUpdated: reception.lastUpdated,
    specVersion: reception.specVersion,
    displayName: 'Reception pathways',
  },
];

const today = new Date().toISOString().slice(0, 10);
const result = assessRuleCurrency(files, today, { staleDays: thresholdDays });

// Build JSON report
const report = {
  overall: result.overall,
  today,
  thresholdDays,
  files: result.files.map((f, i) => ({
    id: f.id,
    displayName: files[i].displayName,
    lastUpdated: f.lastUpdated,
    ageDays: f.ageDays,
    specVersion: f.specVersion,
    level: f.level,
    message: f.message || null,
  })),
  warnings: result.warnings,
};

if (jsonOutput) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

// Build Markdown summary
const levelIcon = { green: '✅', amber: '⚠️', red: '🔴' };
const lines = [
  `## Rule currency check — ${today}`,
  '',
  `**Overall: ${result.overall.toUpperCase()}** ${levelIcon[result.overall] || ''}`,
  `(threshold: ${thresholdDays}d for early warning)`,
  '',
  '| File | Last updated | Age | Spec version | Status |',
  '|---|---|---|---|---|',
  ...report.files.map((f) => {
    const age = f.ageDays != null ? `${f.ageDays}d` : '?';
    const spec = f.specVersion || '—';
    const icon = levelIcon[f.level] || f.level;
    return `| ${f.displayName} | ${f.lastUpdated || '?'} | ${age} | ${spec} | ${icon} |`;
  }),
];

if (result.warnings.length) {
  lines.push('', '### Warnings', '');
  result.warnings.forEach((w) => lines.push(`- ${w}`));
}

if (result.overall !== 'green') {
  lines.push('');
  lines.push('> **Action required**: run The Keeper skill to refresh stale rules from source guidance.');
}

const markdown = lines.join('\n');

if (!jsonOutput) {
  process.stdout.write(markdown + '\n');
}

if (result.overall !== 'green') {
  process.stderr.write(`Rule currency: ${result.overall.toUpperCase()} — ${result.warnings.join('; ')}\n`);
}

// Exit 0 always — the workflow decides what to do based on JSON output.
process.exit(0);
