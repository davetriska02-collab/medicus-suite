// Medicus Suite — shell nav information architecture
// Run with: node test-nav-ia.js
//
// Locks the side-panel and pop-out nav against the discoverability gaps that
// showed up after Today, the appointment tally, and Note TV were removed:
// the two shells' default order, the Monitoring vs Submissions icons, the
// pop-out strip labels, and the panel's g-chord map.

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK  ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

function navButtons(html) {
  const out = [];
  const re = /<button\b[\s\S]*?<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!/class="[^"]*\bnav-tab\b/.test(m[0])) continue;
    const id = (m[0].match(/data-module="([^"]+)"/) || [])[1];
    const span = (m[0].match(/<span>([^<]*)<\/span>/) || [])[1] || '';
    out.push({ id, span, html: m[0] });
  }
  return out;
}

const ECG = '22 12 18 12 15 21 9 3 6 12 2 12';
const INBOX = '22 12 16 12 14 15 10 15 8 12 2 12';
const PANEL_ONLY = new Set(['rota-app', 'duplicate-checker']);
// Digits 1–9 follow DOM order. The tail was regrouped; these nine must not move.
const DIGIT_TABS = [
  'slots',
  'sentinel',
  'trends',
  'capacity',
  'submissions',
  'activity',
  'referrals',
  'reception',
  'signing',
];

const panelBtns = navButtons(read('side-panel/panel.html'));
const popBtns = navButtons(read('pop-out/pop-out.html'));
const panelIds = panelBtns.map((b) => b.id);
const popIds = popBtns.map((b) => b.id);
const panelJs = read('side-panel/panel.js');

console.log('Default order');
check(panelIds.slice(0, 9).join(',') === DIGIT_TABS.join(','), 'digits 1–9 still land on the same nine tabs');
check(
  panelIds.filter((id) => !PANEL_ONLY.has(id)).join(',') === popIds.join(','),
  'pop-out default order matches the panel for every shared tab'
);
check(panelIds.indexOf('record') === panelIds.indexOf('sweep') + 1, 'Record follows Sweep');
check(panelIds.indexOf('patient-alerts') === panelIds.indexOf('record') + 1, 'Patient Alerts follows Record');
check(panelIds.indexOf('rota-app') === panelIds.indexOf('rota') + 1, 'Rota manager stays beside Rota');

console.log('\nLabels');
for (const id of ['sentinel', 'submissions']) {
  const panel = panelBtns.find((b) => b.id === id);
  const pop = popBtns.find((b) => b.id === id);
  check(
    !!panel && !!pop && panel.span === pop.span,
    `${id} strip label matches across shells ("${panel && panel.span}")`
  );
}
check(panelBtns.find((b) => b.id === 'sentinel').span === 'Monitoring', 'Monitoring is not labelled Monitor');
check(panelBtns.find((b) => b.id === 'submissions').span === 'Submissions', 'Submissions is not abbreviated to Subs');

console.log('\nIcons');
for (const [name, btns] of [
  ['panel', panelBtns],
  ['pop-out', popBtns],
]) {
  const mon = btns.find((b) => b.id === 'sentinel');
  const sub = btns.find((b) => b.id === 'submissions');
  check(mon.html.includes(ECG), `${name} Monitoring keeps the trace icon`);
  check(
    sub.html.includes(INBOX) && !sub.html.includes(ECG),
    `${name} Submissions uses an inbox icon, not the Monitoring trace`
  );
}

console.log('\nRemoved features stay out of the nav');
for (const id of ['today', 'board', 'condor']) {
  check(!panelIds.includes(id) && !popIds.includes(id), `neither shell has a ${id} tab`);
}
check(!/today:\s*\{/.test(panelJs) && !/board:\s*\{/.test(panelJs), 'panel.js does not register today or board');

console.log('\ng-chord map');
const mapStart = panelJs.indexOf('const G_CHORD_MAP = {');
const mapEnd = panelJs.indexOf('};', mapStart);
const mapBlock = panelJs.slice(mapStart, mapEnd);
const chords = {};
for (const m of mapBlock.matchAll(/([a-z]):\s*'([a-z0-9-]+)'/g)) chords[m[1]] = m[2];
const jumpable = panelIds.filter((id) => !PANEL_ONLY.has(id));
const targeted = Object.values(chords);
check(
  jumpable.slice().sort().join(',') === targeted.slice().sort().join(','),
  `g-chord reaches every in-panel tab (${jumpable.length})`
);
check(!('t' in chords) && !('b' in chords), 'g-t and g-b stay unbound (removed Today and Note/TV)');
check(!targeted.includes('today') && !targeted.includes('board'), 'g-chord does not target a removed tab');
check(
  chords.p === 'patient-alerts' && chords.i === 'signing' && chords.o === 'rota' && chords.h === 'phrases',
  'new chords are the mnemonic letters'
);
check(panelJs.includes('navMenuLabelText'), 'all-tabs menu uses the full accessible name');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
