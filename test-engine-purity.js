// Medicus Suite — engine purity manifest (architecture plan Phase 3.1)
// Run with: node test-engine-purity.js
//
// Declares which engine files are logic-only (no DOM / chrome.* / fetch)
// and which are adapters. Adding fetch() to a pure evaluator fails CI.
// Same discipline rota/engine already gets from eslint.config.mjs.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const ROOT = __dirname;
const ENGINE = path.join(ROOT, 'engine');

const PURE = [
  'rules-engine.js',
  'result-severity.js',
  'negation-terms.js',
  'pincer-tables.js',
  'result-rules.js',
  'triage-alert-engine.js',
  'acb-scores.js',
  'stopp-start.js',
  'eval-cache.js',
  'ruleset-io.js',
  'preflight.js',
  'outstanding-match.js',
  'reception-match.js',
  'contact-match.js',
  'contact-relationships.js',
  'contact-tree.js',
  'name-derivations.js',
];

const ADAPTERS = {
  'api-client.js': 'session fetch + DOM fallbacks',
  'data-fetcher.js': 'DOM + chrome.runtime + chrome.storage',
  'normalisers.js': 'soft document.title / location.href fallback',
  'cqc-evidence.js': 'chrome.runtime.getURL + fetch helpers around a pure core',
  'record-duplicate-parser.js': 'write-payload builders (W11); no live fetch, but not an evaluator',
};

const FORBIDDEN = [
  { re: /\bdocument\s*\./, name: 'document.' },
  { re: /\bchrome\s*\./, name: 'chrome.' },
  { re: /\bfetch\s*\(/, name: 'fetch(' },
  { re: /\blocalStorage\b/, name: 'localStorage' },
];

for (const name of PURE) {
  const abs = path.join(ENGINE, name);
  check(fs.existsSync(abs), `${name} exists`);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  for (const { re, name: what } of FORBIDDEN) {
    const hits = [];
    src.split(/\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (re.test(line)) hits.push(i + 1);
    });
    check(hits.length === 0, `${name} has no ${what}${hits.length ? ` (lines ${hits.join(', ')})` : ''}`);
  }
}

for (const [name, reason] of Object.entries(ADAPTERS)) {
  check(fs.existsSync(path.join(ENGINE, name)), `adapter ${name} exists — ${reason}`);
}

const listed = new Set([...PURE, ...Object.keys(ADAPTERS)]);
const onDisk = fs.readdirSync(ENGINE).filter((n) => n.endsWith('.js'));
const unlisted = onDisk.filter((n) => !listed.has(n));
// extractors/ are DOM walkers — classified as a directory of adapters.
check(fs.existsSync(path.join(ENGINE, 'extractors')), 'engine/extractors/ exists (DOM adapters)');
check(
  unlisted.length === 0,
  unlisted.length === 0
    ? `every engine/*.js is classified (${onDisk.length})`
    : `unclassified engine file(s) — add to PURE or ADAPTERS: ${unlisted.join(', ')}`
);

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
