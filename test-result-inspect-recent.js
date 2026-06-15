// Medicus Suite — "Load a recent result" inspector capture tests
// Run with: node test-result-inspect-recent.js
//
// Covers the content-script side of serving recently-parsed investigation results to
// the options-page result-rule inspector. The two pure helpers under test live inside
// content.js's IIFE, so — as with test-result-triage-queue.js — we extract them by
// regex and evaluate them in an isolated VM context (content.js is a content script,
// not require-able).

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
  }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// --- Extract the two pure helpers from the IIFE ---
const sandbox = {};
const buildMatch = src.match(/function buildRecentInspectEntry\(report, taskUuid, now\) \{[\s\S]*?\n  \}/);
const insertMatch = src.match(/function insertRecentInspect\(store, entry, cap\) \{[\s\S]*?\n  \}/);
const mapMatch = src.match(/function mapRecentInspectResponse\(store\) \{[\s\S]*?\n  \}/);

check(!!buildMatch, 'buildRecentInspectEntry found in content.js');
check(!!insertMatch, 'insertRecentInspect found in content.js');
check(!!mapMatch, 'mapRecentInspectResponse found in content.js');

vm.runInNewContext(
  [buildMatch[0], insertMatch[0], mapMatch[0]].join('\n') +
    '\nthis.buildRecentInspectEntry = buildRecentInspectEntry;' +
    '\nthis.insertRecentInspect = insertRecentInspect;' +
    '\nthis.mapRecentInspectResponse = mapRecentInspectResponse;',
  sandbox
);
const { buildRecentInspectEntry, insertRecentInspect, mapRecentInspectResponse } = sandbox;

check(typeof buildRecentInspectEntry === 'function', 'buildRecentInspectEntry extracted and callable');
check(typeof insertRecentInspect === 'function', 'insertRecentInspect extracted and callable');
check(typeof mapRecentInspectResponse === 'function', 'mapRecentInspectResponse extracted and callable');

// ============================================================
// buildRecentInspectEntry — line mapping mirrors extractResultFields
// ============================================================
console.log('\nbuildRecentInspectEntry: line mapping');
{
  const report = {
    results: [
      { name: 'Sodium', specimen: 'SERUM', text: '140 mmol/L' },
      { name: '', specimen: null, text: undefined },
      { name: 'Culture', specimen: 'THROAT SWAB' }, // missing text
      { name: 42, specimen: 7, text: 99 }, // non-strings → null/'' fallbacks
    ],
  };
  const entry = buildRecentInspectEntry(report, 'uuid-1', 1234);
  check(entry.id === 'uuid-1', 'id is the taskUuid');
  check(entry.capturedAt === 1234, 'capturedAt is the passed-in now');
  check(Array.isArray(entry.lines) && entry.lines.length === 4, 'one line per result');

  check(entry.lines[0].name === 'Sodium', 'non-empty name preserved');
  check(entry.lines[0].specimen === 'SERUM', 'non-empty specimen preserved');
  check(entry.lines[0].text === '140 mmol/L', 'text preserved as string');

  check(entry.lines[1].name === null, 'empty-string name → null');
  check(entry.lines[1].specimen === null, 'null specimen → null');
  check(entry.lines[1].text === '', 'undefined text → empty string');

  check(entry.lines[2].text === '', 'missing text key → empty string');

  check(entry.lines[3].name === null, 'non-string name → null');
  check(entry.lines[3].specimen === null, 'non-string specimen → null');
  check(entry.lines[3].text === '', 'non-string text → empty string');
}

// Empty / malformed report
{
  const e1 = buildRecentInspectEntry({ results: [] }, 'u', 1);
  check(Array.isArray(e1.lines) && e1.lines.length === 0, 'empty results → empty lines');
  const e2 = buildRecentInspectEntry({}, 'u', 1);
  check(e2.lines.length === 0, 'missing results array → empty lines');
  const e3 = buildRecentInspectEntry(null, 'u', 1);
  check(e3.lines.length === 0, 'null report → empty lines (no throw)');
}

// ============================================================
// buildRecentInspectEntry — label generation
// ============================================================
console.log('\nbuildRecentInspectEntry: label generation');
{
  // Single specimen across all lines
  const single = buildRecentInspectEntry(
    {
      results: [
        { name: 'a', specimen: 'THROAT SWAB', text: '' },
        { name: 'b', specimen: 'THROAT SWAB', text: '' },
        { name: 'c', specimen: 'THROAT SWAB', text: '' },
      ],
    },
    'u',
    0
  );
  check(single.label === 'THROAT SWAB · 3 lines', `single-specimen label (got "${single.label}")`);

  // Multiple distinct specimens
  const multi = buildRecentInspectEntry(
    {
      results: [
        { name: 'a', specimen: 'THROAT SWAB', text: '' },
        { name: 'b', specimen: 'BLOOD', text: '' },
        { name: 'c', specimen: 'URINE', text: '' },
      ],
    },
    'u',
    0
  );
  check(multi.label === 'THROAT SWAB +2 more · 3 lines', `multi-specimen label (got "${multi.label}")`);

  // No specimen on any line → fall back to first line's name
  const noSpec = buildRecentInspectEntry(
    {
      results: [
        { name: 'Haemoglobin', specimen: null, text: '' },
        { name: 'WBC', specimen: null, text: '' },
      ],
    },
    'u',
    0
  );
  check(noSpec.label === 'Haemoglobin · 2 lines', `no-specimen falls back to first name (got "${noSpec.label}")`);

  // No specimen and no name → "Result · N lines"
  const bare = buildRecentInspectEntry({ results: [{ text: 'free text' }] }, 'u', 0);
  check(bare.label === 'Result · 1 line', `no specimen/name → "Result" with singular line (got "${bare.label}")`);

  // Singular line count
  const one = buildRecentInspectEntry({ results: [{ specimen: 'SERUM', text: '' }] }, 'u', 0);
  check(one.label === 'SERUM · 1 line', `singular "1 line" pluralisation (got "${one.label}")`);

  // Label carries no patient identifiers — only specimen/name tokens + count
  check(!/\d{4}-\d{2}-\d{2}/.test(multi.label), 'label has no date-like identifier');
}

// ============================================================
// insertRecentInspect — cap + dedupe insertion
// ============================================================
console.log('\ninsertRecentInspect: cap + dedupe + ordering');
{
  // Newest-first ordering
  const store = [];
  insertRecentInspect(store, { id: 'a', label: 'A' }, 20);
  insertRecentInspect(store, { id: 'b', label: 'B' }, 20);
  insertRecentInspect(store, { id: 'c', label: 'C' }, 20);
  check(store.map((e) => e.id).join(',') === 'c,b,a', 'newest-first ordering (unshift)');

  // Dedupe by id: re-inserting 'a' replaces + promotes to front
  insertRecentInspect(store, { id: 'a', label: 'A2' }, 20);
  check(store.map((e) => e.id).join(',') === 'a,c,b', 'dedupe-by-id promotes to front');
  check(store.length === 3, 'dedupe does not grow the store');
  check(store[0].label === 'A2', 'dedupe replaces with newer entry payload');

  // Cap enforcement (cap=20)
  const capStore = [];
  for (let i = 0; i < 25; i++) insertRecentInspect(capStore, { id: 'k' + i, label: '' }, 20);
  check(capStore.length === 20, 'cap=20 enforced (25 inserts → 20 retained)');
  check(capStore[0].id === 'k24', 'newest survives the cap');
  check(capStore[19].id === 'k5', 'oldest-within-cap is k5 (k0..k4 trimmed)');

  // Dedupe of an entry that fell out of cap still re-adds it at front
  insertRecentInspect(capStore, { id: 'k0', label: 'back' }, 20);
  check(capStore[0].id === 'k0' && capStore.length === 20, 'trimmed id re-added at front, cap held');

  // Defensive: bad inputs do not throw and do not corrupt the store
  const s2 = [{ id: 'x' }];
  check(insertRecentInspect(s2, null, 20) === s2, 'null entry is a no-op (returns store)');
  check(insertRecentInspect(s2, { label: 'no id' }, 20).length === 1, 'entry without id is ignored');
  check(insertRecentInspect('notarray', { id: 'y' }, 20) === 'notarray', 'non-array store returns unchanged');
}

// ============================================================
// mapRecentInspectResponse — contract shape
// ============================================================
console.log('\nmapRecentInspectResponse: contract shape');
{
  const empty = mapRecentInspectResponse([]);
  check(
    empty.ok === true && Array.isArray(empty.results) && empty.results.length === 0,
    'empty store → { ok:true, results:[] }'
  );

  const store = [{ id: 'a', label: 'A', capturedAt: 1, lines: [] }];
  const resp = mapRecentInspectResponse(store);
  check(resp.ok === true, 'ok:true');
  check(resp.results.length === 1 && resp.results[0].id === 'a', 'results carried through newest-first');
  check(resp.results !== store, 'returns a defensive copy (not the live store)');

  const bad = mapRecentInspectResponse(undefined);
  check(bad.ok === true && bad.results.length === 0, 'non-array store → empty results, no throw');
}

// ============================================================
// onMessage listener wiring is present in content.js
// ============================================================
console.log('\ncontent.js wiring');
check(/chrome\.runtime\.onMessage\.addListener/.test(src), 'chrome.runtime.onMessage listener registered');
check(/getRecentInvestigationResults/.test(src), 'handler matches getRecentInvestigationResults action');
check(/sender\.id !== chrome\.runtime\.id/.test(src), 'sender validated against chrome.runtime.id');
check(
  /insertRecentInspect\(\s*_recentInspectResults/.test(src),
  'computeQueueRowResult populates _recentInspectResults'
);

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
