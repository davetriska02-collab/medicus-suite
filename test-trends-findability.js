// Medicus Suite — Trends date honesty and empty-state copy
// Run with: node test-trends-findability.js
//
// Charts must not label a first-to-last span as if every day in between had a
// reading, and an unloaded tab must not say the reading is absent.

'use strict';
const fs = require('fs');
const path = require('path');

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

const trendsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'trends', 'trends.js'), 'utf8');

function extract(name) {
  const m = trendsSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  check(!!m, `${name} extracted from trends.js`);
  return m ? m[0] : '';
}

const readingSpanLabel = new Function(`${extract('readingSpanLabel')}\nreturn readingSpanLabel;`)();
const chartSpacingNote = new Function(`${extract('chartSpacingNote')}\nreturn chartSpacingNote;`)();
const fixedAxisCaption = new Function(`${extract('fixedAxisCaption')}\nreturn fixedAxisCaption;`)();
const acrUnitCaution = new Function(`${extract('acrUnitCaution')}\nreturn acrUnitCaution;`)();

console.log('\n--- date captions name only dates on the chart ---');
{
  const span = readingSpanLabel(['2024-06-01', '2020-01-02', '2020-01-02'], (d) => d);
  check(span.includes('earliest 2020-01-02'), 'earliest is the first ISO date');
  check(span.includes('latest 2024-06-01'), 'latest is the last ISO date');
  check(span.includes('these dates only'), 'multi-date caption refuses a filled window');
  check(!/–/.test(span) && !/\d\s+-\s+\d/.test(span), 'caption has no from-to date range');
  check(readingSpanLabel(['2020-01-02'], (d) => d) === 'recorded 2020-01-02', 'one date is not stretched into a range');
  check(
    readingSpanLabel(['2020-01-02', '2024-06-01'], () => '01 Jan 20') === 'recorded 01 Jan 20',
    'dates that format to one day are not given a span'
  );
  check(readingSpanLabel([], (d) => d) === '', 'no dates produce no caption');
  check(readingSpanLabel([null, ''], (d) => d) === '', 'blank dates are dropped');
  const unordered = readingSpanLabel(['yesterday', 'today'], (d) => d);
  check(unordered === '2 dated readings on the chart', 'non-ISO dates are not ordered by guess');
  check(!/earliest|latest/.test(unordered), 'non-ISO caption does not claim an order');
}

console.log('\n--- spacing note only when more than one date ---');
{
  check(chartSpacingNote(0) === '', 'no spacing note without dates');
  check(chartSpacingNote(1) === '', 'one date needs no spacing note');
  const note = chartSpacingNote(2);
  check(/order of readings/.test(note), 'note says spacing is by reading order');
  check(/Days with no reading are not on the chart/.test(note), 'note says missing days are absent');
}

console.log('\n--- fixed axis does not pretend to be the data range ---');
{
  const cap = fixedAxisCaption(40, 200, 'mmHg');
  check(cap.includes('40–200') && cap.includes('mmHg'), 'caption names the axis limits and unit');
  check(/not at its value/.test(cap), 'caption says an outside result is not drawn at its value');
  check(
    fixedAxisCaption(0, 120, '') === 'Axis 0–120. A result outside that is drawn on the edge, not at its value.',
    'unit is omitted when absent'
  );
}

console.log('\n--- ACR unit is not assumed when the loaded unit differs ---');
{
  check(acrUnitCaution('mg/mmol') === '', 'mg/mmol needs no extra caution');
  check(acrUnitCaution('MG/MMOL') === '', 'unit check is case-insensitive');
  const other = acrUnitCaution('mg/g');
  check(/mg\/mmol/.test(other) && /mg\/g/.test(other), 'a different unit is named, not converted');
  check(/missing/.test(acrUnitCaution('')), 'a missing unit is called missing');
  check(/missing/.test(acrUnitCaution(null)), 'a null unit is called missing');
}

console.log('\n--- unloaded and empty copy in the module ---');
{
  check(!/No blood pressure readings found/.test(trendsSrc), 'unloaded BP is not described as no readings');
  check(!/No observation data found/.test(trendsSrc), 'unloaded observations are not described as absent');
  check(!/No ACR readings available/.test(trendsSrc), 'a missing ACR chart is not a dead-end one-liner');
  check(!/fmtDate\(first\.date\)\} –/.test(trendsSrc), 'observation footer no longer draws a date span');
  check(/Trends has not loaded results/.test(trendsSrc), 'unloaded state says results are not loaded');
  check(/not a blank record/.test(trendsSrc), 'unloaded state says this is not a blank record');
  check(/in the loaded results/.test(trendsSrc), 'empty series is limited to loaded results');
  check(/Other metrics are on the tabs above/.test(trendsSrc), 'empty tab points at the other metrics');
  check(/missingSeriesHtml\('ACR', 'sibling'\)/.test(trendsSrc), 'ACR still has a slot when it is missing');
  check(/missingSeriesHtml\('eGFR', 'sibling'\)/.test(trendsSrc), 'eGFR still has a slot when it is missing');
  check(
    /missingSeriesHtml\('creatinine', 'sibling'\)/.test(trendsSrc),
    'creatinine still has a slot when it is missing'
  );
  check(/Blood pressure \(mmHg\)/.test(trendsSrc), 'BP chart has a visible heading');
  check(/fixedAxisCaption\(40, 200, 'mmHg'\)/.test(trendsSrc), 'BP chart states its fixed axis');
  check(/fixedAxisCaption\(0, 120/.test(trendsSrc), 'a 0–120 chart states its fixed axis');
  check(/values above 100 plotted at 100/.test(trendsSrc), 'ACR cap disclosure stays');
  check(/vs previous reading/.test(trendsSrc), 'delta is the change from the previous reading');
  check(!/pick a metric/.test(trendsSrc), 'resting state does not ask for a picker that is not on screen');
  check(/chartDateFoot\(/.test(trendsSrc), 'charts carry a date foot');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
