// Medicus Suite — OIR write-core (W22) executable tests
// Run with: node test-oir-write-core.js
'use strict';

const OIR = require('./shared/oir-write-core.js');

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

console.log('--- autoTickPrefEnabled ---');
check(OIR.autoTickPrefEnabled(true) === true, 'explicit true is enabled');
check(OIR.autoTickPrefEnabled(false) === false, 'false is off');
check(OIR.autoTickPrefEnabled(1) === false, 'truthy junk (1) is off');
check(OIR.autoTickPrefEnabled('yes') === false, 'truthy junk ("yes") is off');
check(OIR.autoTickPrefEnabled({}) === false, 'truthy junk ({}) is off');
check(OIR.autoTickPrefEnabled(undefined) === false, 'undefined is off');

console.log('--- shouldPerformAutoTick ---');
{
  const box = { type: 'checkbox', checked: false };
  const rows = { 0: { box: box }, 1: { box: { type: 'checkbox', checked: false } } };
  const verdicts = [
    { id: 0, autoTick: true, name: 'FBC' },
    { id: 1, autoTick: false, name: 'U&E' },
  ];
  const off = OIR.shouldPerformAutoTick(false, verdicts, rows);
  check(off.run === false && off.boxes.length === 0, 'pref off → no run');
  const junk = OIR.shouldPerformAutoTick('true', verdicts, rows);
  check(junk.run === false, 'string "true" is not opt-in');
  const on = OIR.shouldPerformAutoTick(true, verdicts, rows);
  check(on.run === true && on.boxes.length === 1 && on.boxes[0] === box, 'pref on → only autoTick rows');
  check(on.verdicts[0].name === 'FBC', 'returned verdicts keep the ticked name');
  const none = OIR.shouldPerformAutoTick(true, [{ id: 0, autoTick: false }], rows);
  check(none.run === false, 'no eligible verdicts → no run');
  const missingRow = OIR.shouldPerformAutoTick(true, [{ id: 9, autoTick: true }], rows);
  check(missingRow.run === false, 'autoTick with no row is not run');
}

console.log('--- pendingBulkTickVerdicts ---');
{
  const unchecked = { type: 'checkbox', checked: false };
  const checked = { type: 'checkbox', checked: true };
  const aria = {
    type: 'div',
    getAttribute: function (n) {
      return n === 'aria-checked' ? 'false' : null;
    },
  };
  const rows = { 0: { box: unchecked }, 1: { box: checked }, 2: { box: aria } };
  const found = [
    { id: 0, name: 'A' },
    { id: 1, name: 'B' },
    { id: 2, name: 'C' },
    { id: 3, name: 'gone' },
  ];
  const pending = OIR.pendingBulkTickVerdicts(found, rows);
  check(
    pending.length === 2 && pending[0].name === 'A' && pending[1].name === 'C',
    'unchecked native + aria pending; checked skipped; missing row skipped'
  );
}

console.log('--- buildBulkTickConfirmMessage ---');
{
  const msg = OIR.buildBulkTickConfirmMessage(
    [
      {
        name: 'HbA1c',
        elsewhereDate: '2026-01-02',
        matchedValue: '48',
        matchedUnit: 'mmol/mol',
        matchedObsName: 'HbA1c',
        sharedCount: 1,
      },
    ],
    function (iso) {
      return '2 Jan 2026';
    }
  );
  check(/Tick off 1 request /.test(msg), 'singular request count');
  check(/HbA1c — completed 2 Jan 2026 — HbA1c 48 mmol\/mol/.test(msg), 'line names date and value');
  check(/also satisfies 1 other request\)/.test(msg), 'sharedCount is stated');
  check(/cannot be undone/.test(msg), 'irreversibility is stated');
  check(/OK = tick it off/.test(msg), 'OK labels the tick, not Done/Sent');
  check(!/\b(Done|Sent|Booked|Submitted)\b/.test(msg), 'confirm copy never claims completion');
  const multi = OIR.buildBulkTickConfirmMessage([{ name: 'A' }, { name: 'B' }]);
  check(/Tick off 2 requests /.test(multi) && /OK = tick them all/.test(multi), 'plural copy');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
