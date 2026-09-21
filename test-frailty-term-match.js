// Medicus Suite — record-HUD frailty term matching
// Run with: node test-frailty-term-match.js
//
// The frailty signature in content-scripts/triage-lens/content.js used to
// substring-match every term, including "fall". That prefix sits inside
// fallopian, Fallot and fallen (fallen arches). Amber fires at one hit, so
// those problem names showed a frailty chip. This pins the word-boundary
// exception and that the call site actually uses it.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
const extracted = src.match(/function problemNameMatchesFrailtyTerm\(name, term\) \{[\s\S]*?\n {2}\}/);
check(!!extracted, 'problemNameMatchesFrailtyTerm extracted from content.js');
check(
  /FRAILTY_TERMS\.some\(t => problemNameMatchesFrailtyTerm\(p\.name, t\)\)/.test(src),
  'frailty hit filter calls problemNameMatchesFrailtyTerm'
);
check(/'falls', 'fall'/.test(src), 'both fall and falls remain in FRAILTY_TERMS');

const sandbox = {};
if (extracted)
  vm.runInNewContext(extracted[0] + '\nthis.problemNameMatchesFrailtyTerm = problemNameMatchesFrailtyTerm;', sandbox);
const match = sandbox.problemNameMatchesFrailtyTerm || (() => false);

console.log('\n--- fall is a whole word, not a prefix ---');
check(match('History of fall', 'fall') === true, 'history of fall matches');
check(match('Mechanical FALL outdoors', 'fall') === true, 'case-insensitive fall matches');
check(match('Recurrent falls', 'fall') === true, 'falls still matches the fall term');
check(match('Fear of falling', 'fall') === true, 'falling still matches the fall term');
check(match('Right fallopian tube', 'fall') === false, 'fallopian does not match fall');
check(match('Tetralogy of Fallot', 'fall') === false, 'Fallot does not match fall');
check(match('Fallen arches', 'fall') === false, 'fallen arches does not match fall');
check(match('pitfall in coding', 'fall') === false, 'pitfall does not match fall');

console.log('\n--- other terms stay on the substring test ---');
check(match('Acute confusional state', 'confusion') === true, 'confusional still matches confusion');
check(match('Increasing breathlessness', 'breathlessness') === true, 'breathlessness still matches');
check(match('Recurrent falls', 'falls') === true, 'falls term still matches falls');
check(match('Right fallopian tube', 'falls') === false, 'fallopian does not match the falls term');
check(match('', 'fall') === false, 'empty name does not match');
check(match(null, 'fall') === false, 'null name does not match');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
