// Medicus Suite — CQC readiness renderer integration test
// Run with: node test-cqc-render.js
//
// Feeds the REAL engine output (engine/cqc-evidence.js buildReadiness) into the
// renderer (cqc-render.js buildReadinessHtml) and asserts the contract holds — this
// guards the engine↔renderer field-name drift that hid the statement title, summary,
// inline provenance, per-file currency and toFix (v3.108.1 fix).

'use strict';

const path = require('path');

(async () => {
  let passed = 0,
    failed = 0;
  const check = (cond, msg) => {
    if (cond) {
      console.log(`  OK  ${msg}`);
      passed++;
    } else {
      console.error(`  FAIL  ${msg}`);
      failed++;
      process.exitCode = 1;
    }
  };

  const engine = require('./engine/cqc-evidence.js');
  const render = await import(new URL('cqc-render.js', `file://${path.resolve(__dirname)}/`).href);

  // Fixture rule files (real field names) + injected currency assessment.
  const ruleFiles = {
    drug: {
      lastUpdated: '2026-06-14',
      schemaVersion: 2,
      specVersion: 'Sentinel drug rules - June 2026 review',
      sourceNotes: 'BNF/NICE/MHRA; brand-completeness pass (The Keeper) 2026-06-04.',
      rules: [{ type: 'drug-monitoring', drug: { match: ['methotrexate', 'maxtrex'] } }],
    },
    qof: { lastUpdated: '2026-06-10', rules: [{ type: 'qof-indicator', category: 'safety-monitoring' }] },
    vaccine: { lastUpdated: '2026-06-01', rules: [{ type: 'vaccine' }] },
    alert: { lastUpdated: '2026-06-05', library: [{ id: 'a1' }] },
  };
  const currency = {
    overall: 'amber',
    files: [
      { id: 'drug-rules', lastUpdated: '2026-06-14', ageDays: 2, level: 'green', message: 'Last updated 2 days ago.' },
    ],
    warnings: ['One file approaching staleness.'],
  };

  const readiness = engine.buildReadiness(ruleFiles, { todayISO: '2026-06-16', currency });
  const html = render.buildReadinessHtml(readiness, { mode: 'readiness' });

  console.log('--- engine→renderer contract ---');
  check(
    html.includes('Safe and effective medicines management'),
    'statement TITLE renders (qualityStatement, not qs.title)'
  );
  check(html.includes('drug-monitoring rules'), 'statement SUMMARY renders');
  check(html.includes('rules/drug-rules.json'), 'statement-level inline PROVENANCE renders (A1)');
  check(
    html.includes('Last updated 2 days ago.'),
    'per-file CURRENCY message renders (currencyFiles was dropped before)'
  );
  check(!html.includes('No evidence items derivable'), 'cards are no longer empty placeholders');
  check(html.includes('methotrexate') && html.includes('maxtrex'), 'matched drug terms render (A2)');
  check(/Coded data only/i.test(html), 'coded-data caveat present (A5)');
  check(html.includes('not patient numbers'), 'counts-are-rules-not-patients note present (F3)');
  check(/last reviewed against BNF/i.test(html), 'prominent "reviewed against BNF/NICE/MHRA" line present (F1)');

  console.log('\n--- toFix is a string, must not explode into characters ---');
  // The Well-led/amber statement has a string toFix; readiness mode shows it as ONE item.
  check(
    html.includes('<li>Review and refresh') || html.includes('Run The Keeper'),
    'string toFix renders as a whole bullet'
  );
  check(!/<li>R<\/li>\s*<li>e<\/li>/.test(html), 'string toFix is NOT iterated character-by-character');

  console.log('\n--- export mode gating ---');
  const exportHtml = render.buildReadinessHtml(readiness, { mode: 'export' });
  check(
    exportHtml.includes('Sign-off') && exportHtml.includes('Practice Manager'),
    'export shows the role-labelled sign-off (F5)'
  );
  check(!exportHtml.includes('To fix'), 'export drops the internal "to fix" lists');
  check(/Supporting evidence, not proof/i.test(exportHtml), 'disclaimer present in export mode');

  console.log(`\n${passed} passed, ${failed} failed`);
})();
