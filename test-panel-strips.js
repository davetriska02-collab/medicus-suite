// Medicus Suite — panel strip extraction lock (architecture plan Phase 4.1)
// Run with: node test-panel-strips.js

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
const panelSrc = fs.readFileSync(path.join(ROOT, 'side-panel', 'panel.js'), 'utf8');
const panelLines = panelSrc.split('\n').length;
check(panelLines < 1200, `panel.js is ${panelLines} lines (target < 1200)`);
check(panelSrc.includes("from './strips/index.js'"), 'panel.js imports initPanelStrips');
check(panelSrc.includes('initPanelStrips({ switchModule, SuiteMessages })'), 'panel.js boots the strip orchestrator');
check(!panelSrc.includes('function fetchAndRenderStrip'), 'panel.js no longer owns the WR fetch');
check(!panelSrc.includes('function makePoller'), 'panel.js no longer owns makePoller');

const STRIPS = [
  'rollup.js',
  'waiting-room.js',
  'request-monitor.js',
  'submissions-rag.js',
  'health.js',
  'patient-alerts.js',
  'sla-breach.js',
];
for (const name of STRIPS) {
  const src = fs.readFileSync(path.join(ROOT, 'side-panel', 'strips', name), 'utf8');
  check(/export function initStrip\s*\(/.test(src), `${name} exports initStrip(el, bus)`);
}

const wr = fs.readFileSync(path.join(ROOT, 'side-panel', 'strips', 'waiting-room.js'), 'utf8');
check(wr.includes('panel-wr-strip'), 'waiting-room.js keeps the AppointmentsFeed diag label');
check(wr.includes('AppointmentsFeed.fetchRaw'), 'waiting-room.js uses the shared appointments feed');

if (failed) {
  console.error(`\n${failed} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nAll ${passed} checks passed`);
