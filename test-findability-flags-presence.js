// Medicus Suite — findability of custom flags, task presence, and the
// book-signing right-hand view (v3.264.32).
// Run with: node test-findability-flags-presence.js
//
// Labels and empty states only. The strip still hides when no flags are
// recorded, and presence still refuses the book-signing column.

'use strict';

const fs = require('fs');
const path = require('path');

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

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

function moduleOrder(html) {
  return [...html.matchAll(/data-module="([a-z-]+)"/g)].map((m) => m[1]);
}

const panel = read('side-panel/panel.html');
const popout = read('pop-out/pop-out.html');
const catalog = read('side-panel/tab-catalog.js');
const alerts = read('side-panel/modules/patient-alerts/patient-alerts.js');
const panelJs = read('side-panel/panel.js');
const signing = read('side-panel/modules/signing/signing.js');
const palette = read('side-panel/palette/palette.js');
const banner = read('content-scripts/patient-alerts-banner.js');
const presence = read('content-scripts/task-presence.js');
const manifest = read('manifest.json');

console.log('\n--- tab names, order unchanged ---');
for (const [name, html] of [
  ['panel', panel],
  ['pop-out', popout],
]) {
  const order = moduleOrder(html);
  check(order.indexOf('reception') < order.indexOf('signing'), `${name}: Book sign stays after Reception`);
  check(order.indexOf('signing') < order.indexOf('sweep'), `${name}: Book sign stays before Sweep`);
  check(order.indexOf('rota-app') < order.indexOf('patient-alerts'), `${name}: Flags stays after Rota manager`);
  check(order.indexOf('patient-alerts') < order.indexOf('phrases'), `${name}: Flags stays before Phrases`);
  check(/<span>Book sign<\/span>/.test(html), `${name} visible label is Book sign`);
  check(/<span>Flags<\/span>/.test(html), `${name} visible label is Flags`);
  check(/Book-signing — right-hand view/.test(html), `${name} names the book-signing right-hand view`);
  check(/Custom flags — practice notes/.test(html), `${name} names custom flags`);
}
check(/name: 'Book sign'/.test(catalog), 'tab catalog name is Book sign');
check(/name: 'Flags'/.test(catalog), 'tab catalog name is Flags');
check(!/name: 'Pt Alerts'/.test(catalog), 'catalog no longer says Pt Alerts');

console.log('\n--- custom flags empty states point at Add flag ---');
check(/<h2 class="pa-title">Custom flags<\/h2>/.test(alerts), 'module title is Custom flags');
check(/Open a record there, then use Add flag/.test(alerts), 'idle state names the Medicus record and Add flag');
check(/Use Add flag below/.test(alerts), 'no-flags state names Add flag');
check(/\+ Add flag/.test(alerts), 'primary control is Add flag');
check(!/all clear/i.test(alerts), 'flags copy does not say all clear');
check(/Open the Flags tab/.test(panelJs), 'strip button opens the Flags tab');
check(/FLAG\$\{name/.test(panelJs), 'strip label is FLAG');
check(/if \(alerts\.length === 0\) \{\s*hide\(\)/.test(panelJs), 'strip still hides when nothing is recorded');
check(/Custom flags:/.test(banner), 'on-page banner lead is Custom flags');
check(/Open the Flags tab/.test(banner), 'on-page banner points at the Flags tab');

console.log('\n--- book-signing panel is the right-hand view ---');
check(/class="mod-eyebrow">Book-signing</.test(signing), 'eyebrow is Book-signing');
check(/Right-hand view of the Medicus book-signing list/.test(signing), 'subtitle names the right-hand view');
check(/Whole-practice book-signing pile/.test(signing), 'practice scope line stays visible');
check(/open one person’s list and this panel follows it/.test(signing), 'practice line points at the Medicus list');
check(/No open repeat requests on this list/.test(signing), 'individual empty keeps its honest line');
check(/Switch lists on the Medicus book-signing page/.test(signing), 'individual empty points at the page list');
check(/Tick Routine or Non-routine above/.test(signing), 'type-narrowed empty points at the ticks');
check(/Pile&rsquo;s clear/.test(signing), 'warm clear line is unchanged');

console.log('\n--- task presence has a visible entry; book-signing column stays out ---');
check(/'presence',\s*'Task Presence'/.test(palette), 'palette opens Settings: Task Presence');
check(/Command palette: Settings: Task Presence/.test(presence), 'Change look names the palette entry');
check(/k === 'book-signing'/.test(presence), 'presence still refuses the book-signing column');

console.log('\n--- version ---');
check(/"version": "3.264.32"/.test(manifest), 'manifest is 3.264.32');

console.log(`\n${pass} passed, ${failures} failed`);
if (failures) process.exit(1);
