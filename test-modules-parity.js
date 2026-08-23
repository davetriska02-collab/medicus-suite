// Medicus Suite — MODULES-map parity (architecture plan Phase 0.2 / Phase 1)
// Run with: node test-modules-parity.js
//
// Both shells derive MODULES from tab-catalog.js. This test asserts the
// catalog's loadable-module set matches what each shell would load, and that
// full-tab openers stay out of MODULES.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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

(async () => {
  const ROOT = __dirname;
  const { TAB_CATALOG, loadableModuleIds, isLoadableModule } = await import(
    pathToFileURL(path.join(ROOT, 'side-panel', 'tab-catalog.js')).href
  );

  const panelIds = loadableModuleIds('panel');
  const popoutIds = loadableModuleIds('popout');

  check(panelIds.length >= 15, `catalog has ${panelIds.length} panel-loadable modules`);
  check(popoutIds.length >= 15, `catalog has ${popoutIds.length} popout-loadable modules`);
  check(
    panelIds.join(',') === popoutIds.join(','),
    'every loadable module is in both shells (no panel-only real module)'
  );

  const panelSrc = fs.readFileSync(path.join(ROOT, 'side-panel', 'panel.js'), 'utf8');
  const popoutSrc = fs.readFileSync(path.join(ROOT, 'pop-out', 'pop-out.js'), 'utf8');
  check(panelSrc.includes('modulesFromCatalog'), 'panel.js derives MODULES from the catalog');
  check(popoutSrc.includes('modulesFromCatalog'), 'pop-out.js derives MODULES from the catalog');
  check(panelSrc.includes("out.about = null") || panelSrc.includes('out.about = null'), 'panel.js still registers about: null');

  for (const id of ['visualiser', 'duplicate-checker', 'rota-app']) {
    const tab = TAB_CATALOG.find((t) => t.id === id);
    check(tab && tab.kind === 'fulltab', `${id} is kind=fulltab (not in MODULES)`);
    check(!isLoadableModule(tab, 'panel'), `${id} is not loadable as a panel module`);
  }

  const about = TAB_CATALOG.find((t) => t.id === 'about');
  check(about && about.kind === 'about', 'about is kind=about (inline, panel-only)');
  check(about.shells.includes('panel') && !about.shells.includes('popout'), 'about is panel-only');

  if (failed) {
    console.error(`\n${failed} check(s) failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\nAll ${passed} checks passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
