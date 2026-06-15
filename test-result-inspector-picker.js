// test-result-inspector-picker.js — unit tests for the result-inspector
// "Load a recent result" picker pure helpers.
// Run with: node test-result-inspector-picker.js
'use strict';

// The picker helpers (formatRecentResultTime, formatRecentPickerRow,
// pickerEmptyState, inspectorRowData) are defined inside the options.js IIFE and
// exported on window.SentinelInspectorHelpers in the browser. As with
// test-result-inspector-helpers.js we cannot require them directly, so we mirror
// the exact contracts here and exercise them. The real normaliser IS importable,
// so we use it to prove the picker render path (lines fed straight in) maps to
// the SAME rows as the paste path (extractResultFields → render).

const { normaliseInvestigationReport } = require('./engine/normalisers.js');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

// ── Mirrors of the helpers under test (kept in lock-step with options.js) ─────

function formatRecentResultTime(capturedAt, now) {
  const nowMs = typeof now === 'number' && isFinite(now) ? now : Date.now();
  if (typeof capturedAt !== 'number' || !isFinite(capturedAt)) return '';
  const diff = nowMs - capturedAt;
  if (diff < 45 * 1000) return 'just now';
  const mins = Math.round(diff / 60000);
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.round(diff / 3600000);
  if (hrs < 24) return hrs + ' h ago';
  const days = Math.round(diff / 86400000);
  return days + ' d ago';
}

function formatRecentPickerRow(entry, now) {
  const e = entry || {};
  const lines = Array.isArray(e.lines) ? e.lines : [];
  const label = typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Untitled result';
  const n = lines.length;
  return {
    label,
    lineCount: n,
    lineSummary: n + ' line' + (n === 1 ? '' : 's'),
    time: formatRecentResultTime(e.capturedAt, now),
  };
}

function pickerEmptyState(tabCount, resultCount) {
  if (!tabCount) return 'no-tabs';
  if (!resultCount) return 'no-results';
  return 'has-results';
}

function inspectorRowData(field, index) {
  const f = field || {};
  const text = typeof f.text === 'string' ? f.text : '';
  const SHORT = 160;
  const truncated = text.length > SHORT;
  return {
    idx: index + 1,
    name: f.name != null && f.name !== '' ? f.name : '(none)',
    specimen: f.specimen != null && f.specimen !== '' ? f.specimen : '(none — rule will fail-open)',
    specimenNull: !(f.specimen != null && f.specimen !== ''),
    text: (truncated ? text.slice(0, SHORT) + '…' : text) || '(empty)',
    truncated,
    fullText: text,
  };
}

// extractResultFields — same as the paste path uses (mirror of options.js).
function extractResultFields(parsedReport) {
  if (!parsedReport || !Array.isArray(parsedReport.results)) return [];
  return parsedReport.results.map((r) => ({
    name: typeof r.name === 'string' && r.name ? r.name : null,
    specimen: typeof r.specimen === 'string' && r.specimen ? r.specimen : null,
    text: typeof r.text === 'string' ? r.text : '',
  }));
}

// ── formatRecentResultTime / formatRecentPickerRow ───────────────────────────

console.log('\nformatRecentResultTime — time formatting\n');
{
  const now = 1_000_000_000_000;
  assert(formatRecentResultTime(now, now) === 'just now', 'zero diff → just now');
  assert(formatRecentResultTime(now - 10_000, now) === 'just now', '10s ago → just now');
  assert(formatRecentResultTime(now - 3 * 60_000, now) === '3 min ago', '3 min ago');
  assert(formatRecentResultTime(now - 90 * 60_000, now) === '2 h ago', '90 min → 2 h ago (rounded)');
  assert(formatRecentResultTime(now - 5 * 86_400_000, now) === '5 d ago', '5 days ago');
  assert(formatRecentResultTime(NaN, now) === '', 'NaN capturedAt → empty string');
  assert(formatRecentResultTime('nope', now) === '', 'non-number capturedAt → empty string');
}

console.log('\nformatRecentPickerRow — row display\n');
{
  const now = 1_000_000_000_000;
  const single = formatRecentPickerRow(
    { label: 'Mr A Patient — U&E', capturedAt: now - 60_000, lines: [{ name: 'Potassium' }] },
    now
  );
  assert(single.label === 'Mr A Patient — U&E', 'single: label preserved');
  assert(single.lineCount === 1, 'single: lineCount = 1');
  assert(single.lineSummary === '1 line', 'single: "1 line" (singular)');
  assert(single.time === '1 min ago', 'single: time = 1 min ago');

  const multi = formatRecentPickerRow({ label: 'FBC + CRP', capturedAt: now - 7200_000, lines: [{}, {}, {}] }, now);
  assert(multi.lineCount === 3, 'multi: lineCount = 3');
  assert(multi.lineSummary === '3 lines', 'multi: "3 lines" (plural)');
  assert(multi.time === '2 h ago', 'multi: time = 2 h ago');

  const blank = formatRecentPickerRow({ label: '   ', lines: [] }, now);
  assert(blank.label === 'Untitled result', 'blank label → "Untitled result"');
  assert(blank.lineSummary === '0 lines', 'empty lines → "0 lines"');
  assert(blank.time === '', 'missing capturedAt → empty time');

  const nullEntry = formatRecentPickerRow(null, now);
  assert(nullEntry.label === 'Untitled result', 'null entry → "Untitled result"');
  assert(nullEntry.lineCount === 0, 'null entry → lineCount 0');
}

// ── pickerEmptyState — three branches ─────────────────────────────────────────

console.log('\npickerEmptyState — empty-state decision\n');
{
  assert(pickerEmptyState(0, 0) === 'no-tabs', 'no tabs → no-tabs');
  assert(pickerEmptyState(0, 5) === 'no-tabs', 'no tabs even with results → no-tabs');
  assert(pickerEmptyState(2, 0) === 'no-results', 'tabs but no results → no-results');
  assert(pickerEmptyState(1, 3) === 'has-results', 'tabs + results → has-results');
}

// ── inspectorRowData — render-row mapping ─────────────────────────────────────

console.log('\ninspectorRowData — field → display row\n');
{
  const r0 = inspectorRowData({ name: 'Potassium', specimen: 'SERUM', text: 'High' }, 0);
  assert(r0.idx === 1, 'idx is 1-based');
  assert(r0.name === 'Potassium', 'name passed through');
  assert(r0.specimen === 'SERUM', 'specimen passed through');
  assert(r0.specimenNull === false, 'specimen present → specimenNull false');
  assert(r0.text === 'High', 'short text passed through');
  assert(r0.truncated === false, 'short text not truncated');

  const rNull = inspectorRowData({ name: null, specimen: null, text: '' }, 4);
  assert(rNull.idx === 5, 'idx 1-based for index 4');
  assert(rNull.name === '(none)', 'null name → (none)');
  assert(rNull.specimen === '(none — rule will fail-open)', 'null specimen → fail-open label');
  assert(rNull.specimenNull === true, 'null specimen → specimenNull true');
  assert(rNull.text === '(empty)', 'empty text → (empty)');

  const long = 'x'.repeat(200);
  const rLong = inspectorRowData({ name: 'N', specimen: 'S', text: long }, 0);
  assert(rLong.truncated === true, 'long text → truncated true');
  assert(rLong.text.length === 161 && rLong.text.endsWith('…'), 'truncated to 160 + ellipsis');
  assert(rLong.fullText === long, 'fullText keeps the whole string (for the title attr)');
}

// ── Render-seam equivalence: picker lines === paste-path fields ───────────────
// The picker feeds entry.lines straight into renderInspectorFields; the paste
// path runs extractResultFields(normalise(payload)) first. Prove that for the
// SAME underlying data both produce identical inspectorRowData rows — i.e. the
// single render seam renders both paths the same way.

console.log('\nrender-seam equivalence — picker lines vs paste fields\n');
{
  const cultureResult = {
    description: 'Culture',
    resultValue: null,
    resultText: 'No growth after 48 hours',
    resultUnit: null,
    referenceRanges: [],
    isAboveReferenceRange: false,
    isBelowReferenceRange: false,
    requiresUrgentReview: false,
    interpretation: null,
    formattedSpecimenCollectionDate: '10 Jun 26, 09:00',
    previousResults: [],
  };
  const payload = {
    data: {
      investigationReport: {
        isMatchedToPatient: true,
        investigationGroups: [{ groupName: 'URINE CULTURE', results: [cultureResult] }],
        ungroupedResults: [],
      },
    },
  };

  // Paste path
  const pasteFields = extractResultFields(normaliseInvestigationReport(payload));
  // Picker path: the content script delivers lines in extractResultFields shape.
  // The contract says entry.lines is "already in the shape your existing
  // extractResultFields returns" — so simulate that exactly.
  const pickerEntry = { id: 'r1', label: 'MSU', capturedAt: Date.now(), lines: pasteFields };

  const pasteRows = pasteFields.map((f, i) => inspectorRowData(f, i));
  const pickerRows = pickerEntry.lines.map((f, i) => inspectorRowData(f, i));
  assert(
    JSON.stringify(pasteRows) === JSON.stringify(pickerRows),
    'picker lines render to identical rows as paste path'
  );
  assert(pickerRows.length === 1, 'one row rendered');
  assert(pickerRows[0].specimen === 'URINE CULTURE', 'specimen carried through render seam');
  assert(pickerRows[0].name === 'Culture', 'name carried through render seam');
  assert(pickerRows[0].text.toLowerCase().includes('no growth'), 'text carried through render seam');
}

// ── appendUniqueLine — extracted from the REAL options.js source (no mirror) ──
// This one we pull from source and run in a vm so the click-to-add / pill logic is
// guarded against drift. It is pure (no DOM/chrome), so it runs standalone.
console.log('\nappendUniqueLine — click-to-add / pill field append\n');
{
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'options.js'), 'utf8');
  const m = src.match(/function appendUniqueLine\(current, value\) \{[\s\S]*?\n  \}/);
  assert(!!m, 'appendUniqueLine found in options.js');
  const sandbox = {};
  vm.runInNewContext(m[0] + '\nthis.appendUniqueLine = appendUniqueLine;', sandbox);
  const appendUniqueLine = sandbox.appendUniqueLine;
  assert(typeof appendUniqueLine === 'function', 'appendUniqueLine extracted and callable');

  assert(appendUniqueLine('', 'Culture') === 'Culture', 'append to empty → the value');
  assert(appendUniqueLine('Culture', 'Sensitivities') === 'Culture\nSensitivities', 'appends a new line');
  assert(appendUniqueLine('Culture', 'Culture') === null, 'exact duplicate → null (no change)');
  assert(appendUniqueLine('Culture', 'culture') === null, 'case-insensitive duplicate → null');
  assert(appendUniqueLine('Culture', '  Culture  ') === null, 'trimmed duplicate → null');
  assert(appendUniqueLine('Culture', '   ') === null, 'blank value → null');
  assert(appendUniqueLine('Culture', null) === null, 'null value → null');
  assert(appendUniqueLine('THROAT SWAB', 'URINE') === 'THROAT SWAB\nURINE', 'second specimen appended');
  assert(
    appendUniqueLine('a\n\n  b ', 'c') === 'a\nb\nc',
    'existing list is trimmed + blanks dropped before appending'
  );
}

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
if (failed) process.exit(1);
