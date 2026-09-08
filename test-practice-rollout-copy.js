// Medicus Suite — practice rollout copy lock
// Run with: node test-practice-rollout-copy.js
//
// The Options page used to tell every practice to Load unpacked FROM the
// shared folder. Chrome/Edge then drop the extension after a restart (Pete).
// This lock fails closed if that advice comes back, and checks the local-copy
// helper + playbook still exist.

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
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const optionsHtml = read('options/options.html');
const readme = read('README.md');
const playbook = read('docs/PRACTICE-ROLLOUT.md');
const cmd = read('copy-to-this-pc.cmd');
const ps1 = read('copy-to-this-pc.ps1');

check(fs.existsSync(path.join(ROOT, 'copy-to-this-pc.cmd')), 'copy-to-this-pc.cmd is at the repo root (ships in the zip)');
check(fs.existsSync(path.join(ROOT, 'copy-to-this-pc.ps1')), 'copy-to-this-pc.ps1 is at the repo root');
check(cmd.includes('copy-to-this-pc.ps1'), 'cmd wrapper launches the PowerShell copier');
check(ps1.includes('LOCALAPPDATA'), 'ps1 defaults dest to %LOCALAPPDATA%\\MedicusSuite');
check(ps1.includes('Load unpacked'), 'ps1 tells the user to Load unpacked from the local copy');
check(ps1.includes('Export entire suite') || ps1.includes('Export'), 'ps1 warns that a new path is a new install');
check(/robocopy/i.test(ps1), 'ps1 uses robocopy so a login script can refresh files');

const forbidden = [
  'navigate to the shared extension folder and click',
  'Each PC points to the same shared folder',
  'It should show the shared folder path, not a local path',
];
for (const phrase of forbidden) {
  check(!optionsHtml.includes(phrase), `options.html no longer says "${phrase}"`);
}

check(
  optionsHtml.includes('id="ppInstallWarn"'),
  'options.html has a visible install-location warning (ppInstallWarn)'
);
check(
  /Do not Load unpacked from a network/i.test(optionsHtml),
  'options warning says not to Load unpacked from a network drive'
);
check(
  optionsHtml.includes('copy-to-this-pc.cmd'),
  'options guide points at copy-to-this-pc.cmd'
);
check(
  optionsHtml.includes('%LOCALAPPDATA%\\MedicusSuite') || optionsHtml.includes('%LOCALAPPDATA%\\MedicusSuite'),
  'options guide names the local Load-unpacked path'
);
check(
  optionsHtml.includes('edge://policy') && optionsHtml.includes('DeveloperToolsAvailability'),
  'options guide names IT-policy checks if a local install still drops'
);
check(
  optionsHtml.includes('id="ppGoldSync"') && optionsHtml.includes('Automatic updates from the gold copy'),
  'options has a gold → local auto-sync card'
);
check(
  optionsHtml.includes('shared/gold-sync.js'),
  'options page loads shared/gold-sync.js'
);
check(
  /Load unpacked<\/strong>\s*<strong>once<\/strong>|Load unpacked\s+<strong>once<\/strong>/.test(optionsHtml) ||
    optionsHtml.includes('Load unpacked') && optionsHtml.includes('once</strong> from'),
  'options warning says Load unpacked is once, not every update'
);

check(/local disk/i.test(readme) || /LOCALAPPDATA/i.test(readme), 'README install step requires a local disk');
check(
  readme.includes('docs/PRACTICE-ROLLOUT.md'),
  'README links the practice rollout playbook'
);
check(
  /drop/i.test(playbook) && /LOCALAPPDATA/i.test(playbook),
  'playbook explains the drop-on-restart and the local path'
);
check(
  playbook.includes('Export entire suite'),
  'playbook tells Pete to export before changing the Load-unpacked path'
);
check(
  /DeveloperToolsAvailability|ExtensionInstallBlocklist/.test(playbook),
  'playbook lists the IT-policy names to ask CSU about'
);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
