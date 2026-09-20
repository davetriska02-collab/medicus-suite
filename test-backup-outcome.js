// Medicus Suite — restore/import outcome banner (v3.264.1)
// Run with: node test-backup-outcome.js
//
// The v3.263.15 systemChips restore failure was hidden because #backupStatus
// sits at the bottom of Options and cleared after 4 s. This increment adds
// #backupOutcome next to the buttons and stops the auto-clear. Executable
// enough to prove setBackupStatus writes both nodes and never schedules a
// wipe; also source-locks the HTML id and the SW load banner.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const optsSrc = fs.readFileSync(path.join(__dirname, 'options', 'options.js'), 'utf8');
const optsHtml = fs.readFileSync(path.join(__dirname, 'options', 'options.html'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'panel.js'), 'utf8');

console.log('--- Options HTML: outcome banner lives next to the action ---');
{
  const exportIdx = optsHtml.indexOf('id="exportSuite"');
  const importIdx = optsHtml.indexOf('id="importSuiteBtn"');
  const outcomeIdx = optsHtml.indexOf('id="backupOutcome"');
  const statusIdx = optsHtml.indexOf('id="backupStatus"');
  check(exportIdx !== -1 && importIdx !== -1, 'export/import buttons exist');
  check(outcomeIdx !== -1, '#backupOutcome exists');
  check(
    outcomeIdx > importIdx && outcomeIdx - importIdx < 800,
    '#backupOutcome is immediately after the import button'
  );
  check(statusIdx === -1 || statusIdx > outcomeIdx, '#backupStatus if present is not the only near-button banner');
  check(optsHtml.includes('id="swLoadBanner"'), 'Suite health has #swLoadBanner for SW module-load failures');
}

console.log('--- setBackupStatus: writes both banners, no 4s auto-clear ---');
{
  const start = optsSrc.indexOf('function setBackupStatus(msg, isError)');
  check(start !== -1, 'setBackupStatus is in options.js');
  const rest = optsSrc.slice(start);
  const end = rest.search(/\n\/\/ --- Pending import state ---/);
  const body = end === -1 ? rest.slice(0, 800) : rest.slice(0, end);
  check(body.includes("getElementById('backupOutcome')"), 'setBackupStatus writes #backupOutcome');
  check(body.includes("getElementById('backupStatus')"), 'setBackupStatus still writes #backupStatus');
  check(!/setTimeout/.test(body), 'setBackupStatus does not auto-clear (no setTimeout)');
  check(!/4000/.test(body), 'setBackupStatus has no 4000 ms wipe');

  function makeEl() {
    return {
      textContent: '',
      style: {},
      attrs: {},
      setAttribute: function (k, v) {
        this.attrs[k] = v;
      },
    };
  }
  const outcome = makeEl();
  const status = makeEl();
  const sandbox = {
    document: {
      getElementById: function (id) {
        if (id === 'backupOutcome') return outcome;
        if (id === 'backupStatus') return status;
        return null;
      },
    },
  };
  vm.runInNewContext(body + '\nthis.setBackupStatus = setBackupStatus;', sandbox);
  sandbox.setBackupStatus('Restore failed: example — no changes were applied', true);
  check(outcome.textContent.indexOf('Restore failed') === 0, 'near-button banner shows the failure');
  check(status.textContent.indexOf('Restore failed') === 0, 'legacy #backupStatus also shows the failure');
  check(outcome.style.display === 'block' && status.style.display === 'block', 'both banners are shown');
  check(outcome.style.color === '#ef4444', 'error colour is red');
  check(outcome.attrs.role === 'status' && status.attrs.role === 'status', 'both banners are status live regions');
  sandbox.setBackupStatus('Suite backup downloaded.');
  check(outcome.style.color === '#166534', 'success colour is green');
}

console.log('--- SW load errors are not swallowed ---');
{
  check(optsSrc.includes('suite.swLoadErrors'), 'Options health refresh reads suite.swLoadErrors');
  check(optsSrc.includes('swLoadBanner'), 'Options paints #swLoadBanner');
  check(panelSrc.includes('suite.swLoadErrors'), 'panel health strip reads suite.swLoadErrors');
  check(panelSrc.includes('|sw:'), 'health-strip snooze signature includes SW load errors');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
