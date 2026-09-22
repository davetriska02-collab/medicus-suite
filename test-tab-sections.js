// Medicus Suite — tab grouping scheme A
// Run with: node test-tab-sections.js
//
// Locks the menu/palette section membership, the ungrouped Slots + Monitoring
// pins, and the shipped strip: same order as v3.264.15, minus Rota manager
// and Duplicates. Those two stay reachable (palette, Open full rota, manager
// preset) and must not sit on the strip.

'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0;
let failures = 0;
function check(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  OK    ${msg}`);
  } else {
    failures++;
    console.error(`  FAIL  ${msg}`);
  }
}

const ROOT = __dirname;

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function between(html, start, end) {
  const s = html.indexOf(start);
  const e = html.indexOf(end, s + start.length);
  if (s < 0 || e < 0) return '';
  return html.slice(s, e);
}

function moduleIds(block) {
  return [...block.matchAll(/data-module="([a-z-]+)"/g)].map((m) => m[1]);
}

function spanLabels(block) {
  return [...block.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]);
}

function menuTokens(html) {
  return [...html.matchAll(/data-section="([^"]+)"|data-module="([^"]+)"/g)].map((m) =>
    m[1] ? `section:${m[1]}` : `item:${m[2]}`
  );
}

const PANEL_STRIP = [
  'slots',
  'sentinel',
  'trends',
  'capacity',
  'submissions',
  'activity',
  'referrals',
  'reception',
  'signing',
  'sweep',
  'knowledge',
  'leaflets',
  'record',
  'rota',
  'patient-alerts',
  'phrases',
];

const PANEL_LABELS = [
  'Slots',
  'Monitoring',
  'Trends',
  'Forecast',
  'Submissions',
  'Activity',
  'Referrals',
  'Reception',
  'Signing',
  'Sweep',
  'Knowledge',
  'Leaflets',
  'Record',
  'Rota',
  'Pt Alerts',
  'Phrases',
];

const POPOUT_STRIP = [
  'slots',
  'sentinel',
  'trends',
  'capacity',
  'submissions',
  'activity',
  'referrals',
  'reception',
  'signing',
  'sweep',
  'record',
  'patient-alerts',
  'knowledge',
  'rota',
  'leaflets',
  'phrases',
];

const POPOUT_LABELS = [
  'Slots',
  'Monitor',
  'Trends',
  'Forecast',
  'Subs',
  'Activity',
  'Referrals',
  'Reception',
  'Signing',
  'Sweep',
  'Record',
  'Pt Alerts',
  'Knowledge',
  'Rota',
  'Leaflets',
  'Phrases',
];

const MENU_ORDER = [
  'item:slots',
  'item:sentinel',
  'section:with-patient',
  'item:record',
  'item:trends',
  'item:sweep',
  'item:signing',
  'item:patient-alerts',
  'item:phrases',
  'section:desk',
  'item:reception',
  'item:submissions',
  'section:practice',
  'item:capacity',
  'item:activity',
  'item:referrals',
  'item:rota',
  'item:rota-app',
  'item:duplicate-checker',
  'section:reference',
  'item:knowledge',
  'item:leaflets',
];

(async () => {
  const sectionsUrl = pathToFileURL(path.join(ROOT, 'side-panel', 'tab-sections.js')).href;
  const catalogUrl = pathToFileURL(path.join(ROOT, 'side-panel', 'tab-catalog.js')).href;
  const sections = await import(sectionsUrl);
  const { TAB_CATALOG, ROLE_PRESETS } = await import(catalogUrl);
  const {
    PINNED_IDS,
    OFF_STRIP_IDS,
    TAB_SECTIONS,
    paletteGroupFor,
    orderedMenuIds,
    digitJumpIds,
    digitJumpCaption,
    renderTabMenuHTML,
  } = sections;

  console.log('Section membership');
  check(PINNED_IDS.join(',') === 'slots,sentinel', 'Slots and Monitoring are the only pinned tabs');
  check(
    TAB_SECTIONS.map((s) => s.label).join('|') === 'With the patient|Desk|Practice|Reference',
    'section names match the palette and the All-tabs menu'
  );
  const expectedIds = {
    'With the patient': ['record', 'trends', 'sweep', 'signing', 'patient-alerts', 'phrases'],
    Desk: ['reception', 'submissions'],
    Practice: ['capacity', 'activity', 'referrals', 'rota', 'rota-app', 'duplicate-checker'],
    Reference: ['knowledge', 'leaflets'],
  };
  for (const section of TAB_SECTIONS) {
    check(
      section.ids.join(',') === expectedIds[section.label].join(','),
      `${section.label} members are ${expectedIds[section.label].join(', ')}`
    );
  }
  const classified = [...PINNED_IDS, ...TAB_SECTIONS.flatMap((s) => s.ids)];
  check(new Set(classified).size === classified.length, 'every tab is in at most one section or the pin list');
  const catalogIds = TAB_CATALOG.map((t) => t.id);
  check(
    classified.slice().sort().join(',') === catalogIds.slice().sort().join(','),
    'section map covers the catalog, nothing more'
  );
  check(paletteGroupFor('slots') === '' && paletteGroupFor('sentinel') === '', 'pinned tabs have no parent badge');
  check(
    paletteGroupFor('signing') === 'With the patient',
    'Signing stays in With the patient (main label, not Book sign)'
  );
  check(paletteGroupFor('patient-alerts') === 'With the patient', 'Pt Alerts stays in With the patient');
  check(
    paletteGroupFor('reception') === 'Desk' && paletteGroupFor('submissions') === 'Desk',
    'Desk is Reception and Submissions'
  );
  check(
    paletteGroupFor('rota-app') === 'Practice' && paletteGroupFor('duplicate-checker') === 'Practice',
    'launchers sit in Practice'
  );
  check(
    paletteGroupFor('knowledge') === 'Reference' && paletteGroupFor('leaflets') === 'Reference',
    'Reference is Knowledge and Leaflets, as peers'
  );
  check(
    !/today|board|tally|note tv|consult/i.test(JSON.stringify(TAB_SECTIONS) + PINNED_IDS.join(',')),
    'no Today, tally, Note TV, or Consult parent'
  );
  check(OFF_STRIP_IDS.join(',') === 'rota-app,duplicate-checker', 'off-strip set is Rota manager and Duplicates');
  check(orderedMenuIds().join(',') === classified.join(','), 'palette order is pinned, then sections');

  console.log('\nMenu HTML');
  const shuffled = TAB_CATALOG.map((t) => ({ id: t.id, label: t.name, active: t.id === 'slots' })).sort((a, b) =>
    b.id < a.id ? -1 : 1
  );
  const html = renderTabMenuHTML(shuffled, (s) => s);
  check(menuTokens(html).join(',') === MENU_ORDER.join(','), 'menu lists pins, then sections, ignoring input order');
  check(
    html.includes('alltabs-item active') && html.includes('data-module="slots"'),
    'active pin keeps the active class'
  );
  const slotsAt = html.indexOf('data-module="slots"');
  const firstSection = html.indexOf('data-section=');
  check(slotsAt > -1 && firstSection > slotsAt, 'Slots is rendered before any section heading');
  check(
    !html.includes('alltabs-group" role="group"><div class="alltabs-group'),
    'Knowledge and Leaflets are not a nested child menu'
  );
  const hiddenDup = renderTabMenuHTML(
    shuffled.map((e) => (e.id === 'duplicate-checker' ? { ...e, hidden: true } : e)),
    (s) => s
  );
  check(!hiddenDup.includes('data-module="duplicate-checker"'), 'a hidden launcher is omitted from the menu');
  check(
    hiddenDup.includes('data-section="practice"') && hiddenDup.includes('data-module="rota-app"'),
    'Practice remains when one member is hidden'
  );
  const noRef = renderTabMenuHTML(
    shuffled.map((e) => (e.id === 'knowledge' || e.id === 'leaflets' ? { ...e, hidden: true } : e)),
    (s) => s
  );
  check(!noRef.includes('data-section="reference"'), 'an empty section heading is omitted');
  const escaped = renderTabMenuHTML([{ id: 'slots', label: 'A"B<C' }], (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  );
  check(escaped.includes('A&quot;B&lt;C') && !escaped.includes('A"B'), 'menu labels are escaped by the caller');

  console.log('\nDigit map');
  check(
    digitJumpCaption(PANEL_LABELS) ===
      '1 Slots, 2 Monitoring, 3 Trends, 4 Forecast, 5 Submissions, 6 Activity, 7 Referrals, 8 Reception, 9 Signing',
    '1–9 on the shipped strip still starts Slots, Monitoring and does not shift'
  );
  check(digitJumpCaption(PANEL_LABELS).split(', ').length === 9, 'caption stops at 9');
  check(
    digitJumpIds(PANEL_STRIP.concat(OFF_STRIP_IDS)).join(',') === PANEL_STRIP.slice(0, 9).join(','),
    'off-strip ids are not numbered even if appended to the strip list'
  );

  console.log('\nStrip DOM');
  const panelHtml = read('side-panel/panel.html');
  const popHtml = read('pop-out/pop-out.html');
  const panelNav = between(panelHtml, 'class="nav-tabs"', 'class="nav-actions"');
  const popNav = between(popHtml, 'id="popoutTabs"', 'class="popout-actions"');
  check(
    moduleIds(panelNav).join(',') === PANEL_STRIP.join(','),
    'panel strip order is unchanged apart from the two demotions'
  );
  check(
    spanLabels(panelNav).join('|') === PANEL_LABELS.join('|'),
    'panel strip labels unchanged (Slots, Monitoring, Signing, Pt Alerts)'
  );
  check(
    !panelNav.includes('rota-app') && !panelNav.includes('duplicate-checker'),
    'Rota manager and Duplicates are not on the panel strip'
  );
  check(!panelNav.includes('nav-parent') && !/>\s*Consult\s*</.test(panelNav), 'the strip has no parent button');
  check(moduleIds(popNav).join(',') === POPOUT_STRIP.join(','), 'pop-out strip order is untouched');
  check(spanLabels(popNav).join('|') === POPOUT_LABELS.join('|'), 'pop-out strip labels are untouched');
  const tplAt = panelHtml.indexOf('<template id="offStripLaunchers">');
  const tpl = panelHtml.slice(tplAt, panelHtml.indexOf('</template>', tplAt));
  check(tplAt > panelHtml.indexOf('class="nav-actions"'), 'launcher template sits outside the strip');
  check(
    tpl.includes('data-module="rota-app"') && tpl.includes('data-module="duplicate-checker"'),
    'template keeps both launchers for menu icons'
  );
  check(!/class="nav-tab"/.test(tpl), 'template buttons are not strip tabs');

  console.log('\nReachable paths');
  const manager = ROLE_PRESETS.find((p) => p.id === 'manager');
  check(manager && manager.show.includes('rota-app'), 'Practice manager preset still shows Rota manager');
  check(read('side-panel/modules/rota/rota.js').includes('Open full rota'), 'compact Rota still has Open full rota');
  const palette = read('side-panel/palette/palette.js');
  check(palette.includes('orderedMenuIds()'), 'palette lists tabs via the section order');
  check(palette.includes('paletteGroupFor(tab.dataset.module)'), 'palette badges use the section map');
  check(
    palette.includes("paletteGroupFor('rota-app')") && palette.includes("id: 'open:rota'"),
    'Open Rota manager stays a palette command in Practice'
  );
  check(
    palette.includes("paletteGroupFor('duplicate-checker')") && palette.includes("id: 'open:duplicates'"),
    'Open Duplicates is a palette command in Practice'
  );
  check(
    palette.includes('openDuplicateCheckerTab') && palette.includes('openRotaTab'),
    'palette calls the shared openers'
  );
  check(!palette.includes("group: 'Tab'"), 'palette no longer dumps every tab into one Tab group');
  const panelJs = read('side-panel/panel.js');
  check(panelJs.includes('renderTabMenuHTML('), 'All-tabs menu renders the section groups');
  check(
    panelJs.includes('digitJumpCaption(') && panelJs.includes('jump along the strip'),
    'help shortcut names the strip, not a shifted 1–9'
  );
  check(
    panelJs.includes('OFF_STRIP_IDS') && panelJs.includes('openDuplicateCheckerTab'),
    'digit jump and the duplicates opener share the off-strip set'
  );

  console.log(`\n--- Results: ${pass} passed, ${failures} failed ---`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(`  FAIL  ${e.stack || e.message}`);
  process.exit(1);
});
