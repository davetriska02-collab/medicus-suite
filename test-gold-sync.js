// Medicus Suite — gold-copy → local-clone sync helpers
// Run with: node test-gold-sync.js

'use strict';

const GS = require('./shared/gold-sync.js');

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

check(GS.parseVersion('3.261.4') && GS.parseVersion('3.261.4').patch === 4, 'parseVersion accepts a suite semver');
check(GS.parseVersion('v3.261.4') === null, 'parseVersion rejects a leading v');
check(GS.parseVersion('3.261') === null, 'parseVersion rejects a two-part version');
check(GS.compareVersions('3.261.4', '3.261.3') === 1, '3.261.4 is newer than 3.261.3');
check(GS.compareVersions('3.260.0', '3.261.0') === -1, '3.260.0 is older than 3.261.0');
check(GS.compareVersions('3.261.4', '3.261.4') === 0, 'equal versions compare 0');
check(GS.compareVersions('nope', '3.261.4') === null, 'incomparable versions return null');

check(GS.shouldSkipDir('.git') === true, 'skip .git');
check(GS.shouldSkipDir('ms-presence') === true, 'skip ms-presence (stays on the share)');
check(GS.shouldSkipDir('node_modules') === true, 'skip node_modules');
check(GS.shouldSkipDir('side-panel') === false, 'do not skip side-panel');
check(GS.shouldSkipDir('.claude') === true, 'skip hidden dirs');

check(GS.shouldSkipFile('.DS_Store') === true, 'skip .DS_Store');
check(GS.shouldSkipFile('test-gold-sync.js') === true, 'skip test-*.js');
check(GS.shouldSkipFile('manifest.json') === false, 'copy manifest.json');
check(GS.shouldSkipFile('practice-profile.json') === false, 'copy practice-profile.json');

check(
  GS.decideSync('3.261.5', '3.261.4', '3.261.4').mode === 'full',
  'newer gold than running → full copy'
);
check(
  GS.decideSync('3.261.4', '3.261.3', '3.261.4').mode === 'full',
  'local clone behind gold/running → full copy'
);
check(
  GS.decideSync('3.261.4', '3.261.4', '3.261.4').mode === 'data',
  'same version everywhere → data-only (profile / presence-config)'
);
check(
  GS.decideSync('3.261.4', null, '3.261.4').mode === 'full',
  'local folder has no manifest yet → full copy'
);
check(GS.decideSync('nope', '3.261.4', '3.261.4').mode === 'none', 'garbage gold version refuses to copy');
check(GS.DATA_FILES.includes('practice-profile.json'), 'data-only sync includes practice-profile.json');
check(GS.META_KEY === 'suite.goldSync', 'status lives on suite.goldSync (machine-local)');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
