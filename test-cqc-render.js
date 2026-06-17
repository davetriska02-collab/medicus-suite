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
      rules: [
        {
          type: 'drug-monitoring',
          id: 'methotrexate-maintenance',
          drugClass: 'DMARD',
          drug: { match: ['methotrexate', 'maxtrex'] },
          tests: [
            { name: 'FBC', intervalDays: 84 },
            { name: 'U&E', intervalDays: 84 },
            { name: 'LFT', intervalDays: 84 },
          ],
        },
      ],
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

  console.log('\n--- CSS class coverage (renderer → stylesheet) ---');
  // Guard: every class ragBadge() emits must be defined in cqc-readiness.css.
  // Prevents a renderer change from silently introducing unstyled "white rectangle" pills.
  const fs = require('fs');
  const cssText = fs.readFileSync(path.resolve(__dirname, 'cqc-readiness.css'), 'utf8');
  // Extract all class names defined in the CSS (lines starting with a dot selector).
  const cssClasses = new Set();
  for (const m of cssText.matchAll(/^\.(cqc-[\w-]+)/gm)) {
    cssClasses.add(m[1]);
  }
  const requiredBadgeClasses = ['cqc-badge', 'cqc-badge-green', 'cqc-badge-amber', 'cqc-badge-red', 'cqc-badge-na'];
  for (const cls of requiredBadgeClasses) {
    check(cssClasses.has(cls), `CSS defines .${cls} (used by ragBadge() in cqc-render.js)`);
  }

  console.log('\n--- reconciliation section ---');
  // The readiness fixture has a drug rule with methotrexate → the reconciliation section
  // must appear with the honest framing and no fabricated patient count.
  check(/Reconciliation/i.test(html), 'reconciliation section heading present');
  check(/run these in Medicus/i.test(html), 'reconciliation section carries "run these in Medicus" framing');
  check(
    /suite supplies the definition/i.test(html) || /suite cannot enumerate/i.test(html),
    'reconciliation carries explicit "suite cannot enumerate" or "suite supplies the definition" honesty statement'
  );
  check(
    /your count.*____/i.test(html),
    'reconciliation table has blank "your count: ____" column for practice to fill'
  );
  // Critical: no fabricated patient number — must not contain a digit that looks like a count
  // adjacent to "patients" or "count" (a bare "your count: ____" blank is fine).
  check(!/your count:\s*\d+/.test(html), 'reconciliation section does NOT contain a fabricated numeric patient count');
  check(/Coded data only/i.test(html), 'reconciliation section repeats coded-data-only caveat (A5)');
  check(/methotrexate/i.test(html), 'reconciliation table lists methotrexate (from fixture drug rule)');
  // Interval derived from the rule must appear.
  check(/week|month|year/i.test(html), 'reconciliation table shows a derived monitoring interval');

  // Export mode also renders the reconciliation section.
  check(/Reconciliation/i.test(exportHtml), 'reconciliation section present in export mode');
  check(/your count.*____/i.test(exportHtml), 'reconciliation "your count" blank present in export mode');

  // The reconciliation section must NOT appear to emit a numeric cohort count.
  // Parse out the reconciliation card and verify there is no "<digit>+ patients" pattern.
  const reconMatch = html.match(/<section[^>]*cqc-card-recon[^>]*>([\s\S]*?)<\/section>/);
  check(reconMatch != null, 'reconciliation section can be isolated from HTML');
  if (reconMatch) {
    const reconHtml = reconMatch[1];
    // Strip the "your count: ____" blank (it has no digit), then check no N patients pattern.
    check(!/\b\d+\s+patient/i.test(reconHtml), 'reconciliation card contains no "N patients" fabricated count');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
})();
