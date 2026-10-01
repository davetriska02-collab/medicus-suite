// Medicus Suite — no release zip is tracked
// Run with: node test-no-tracked-zips.js
//
// Release zips are build output. git rm --cached drops them from the index
// without rewriting history. .gitignore must keep *.zip ignored, with no
// negation that would let one back in.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

const root = path.join(__dirname);
let listed = '';
try {
  listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
} catch (err) {
  check(false, 'git ls-files failed: ' + err.message);
  process.exit(1);
}

const tracked = listed.split('\0').filter((name) => name && name.toLowerCase().endsWith('.zip'));
check(tracked.length === 0, tracked.length === 0 ? 'no .zip is tracked' : 'tracked zips: ' + tracked.join(', '));

const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/);
check(
  ignore.some((line) => line.trim() === '*.zip'),
  '.gitignore contains *.zip'
);
const reincluded = ignore.filter((line) => /^\s*!.+\.zip\s*$/i.test(line));
check(
  reincluded.length === 0,
  reincluded.length === 0 ? 'no .zip is re-included by .gitignore' : 're-included: ' + reincluded.join(', ')
);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
