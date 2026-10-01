// Medicus Suite — ESLint stays on 9.39.5 (not 10)
// Run with: node test-eslint-pin.js
//
// 9.39.5 clears the dev-only npm audit highs (brace-expansion, js-yaml) without
// moving the linter to ESLint 10. The extension does not ship node_modules.

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

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8'));

const PIN = '9.39.5';
check(pkg.devDependencies.eslint === PIN, 'package.json pins eslint at 9.39.5');
check(pkg.devDependencies['@eslint/js'] === PIN, 'package.json pins @eslint/js at 9.39.5');
check(!pkg.dependencies || !pkg.dependencies.eslint, 'eslint is not a runtime dependency');
check(pkg.devDependencies.eslint.startsWith('9.'), 'eslint stays on 9.x');
check(!pkg.devDependencies.eslint.startsWith('10.'), 'eslint is not 10.x');

const lockedEslint = lock.packages && lock.packages['node_modules/eslint'];
const lockedJs = lock.packages && lock.packages['node_modules/@eslint/js'];
check(lockedEslint && lockedEslint.version === PIN, 'lockfile eslint is 9.39.5');
check(lockedJs && lockedJs.version === PIN, 'lockfile @eslint/js is 9.39.5');
check(lockedEslint && lockedEslint.dev === true, 'lockfile marks eslint dev-only');
check(lock.packages[''].devDependencies.eslint === PIN, 'lockfile root devDependency matches');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
