// Medicus Suite — floating Companion "What's due" source invariants
// Run with: node test-task-actions-due.js
//
// The due strip lives inside the task-actions IIFE and can't be imported, so
// these are source-level safety pins: identity gate, no all-clear claim, the
// snapshot is read (never re-evaluated with a partial ruleset), and the
// Companion role toggle does not bypass those controls.

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
    process.exitCode = 1;
  }
}

const panel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.css'), 'utf8');
const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
const sentinel = fs.readFileSync(path.join(__dirname, 'content-scripts', 'sentinel.js'), 'utf8');

console.log('--- manifest wires due-mini + companion-role before the panel ---');
{
  const tapBlock = manifest.slice(manifest.indexOf('shared/due-mini.js'));
  const dueIdx = tapBlock.indexOf('shared/due-mini.js');
  const roleIdx = tapBlock.indexOf('shared/companion-role.js');
  const panelIdx = tapBlock.indexOf('content-scripts/task-actions-panel.js');
  check(dueIdx !== -1 && panelIdx !== -1 && dueIdx < panelIdx, 'due-mini.js is injected before task-actions-panel.js');
  check(roleIdx !== -1 && roleIdx < panelIdx, 'companion-role.js is injected before task-actions-panel.js');
}

console.log('\n--- identity gate ---');
check(
  /dueFromSnapshot/.test(panel),
  'panel calls MsDueMini.dueFromSnapshot (identity gate lives in the tested module)'
);
check(/__msReadSentinelSnapshot/.test(panel), 'panel reads the live snapshot via __msReadSentinelSnapshot');
check(/st !== s\.due/.test(panel), 'loadWhatsDue pins due sub-state across the patient-id await');
check(/live\.pageKey !== ctx\.pageKey/.test(panel), 'loadWhatsDue re-checks the live pageKey after the resolve await');
check(/stopDuePoll\(\)/.test(panel), 'SPA navigation / pagehide stops the due poll');
check(/state === 'pending' && s\.due\.mini/.test(panel), 'a pending snapshot clears any painted chips immediately');
check(/function clearDuePaint/.test(panel), 'path change clears painted due chips synchronously');
check(
  /if \(pathChanged\) clearDuePaint\(\)/.test(panel),
  'scheduleInject calls clearDuePaint on path change before the inject throttle'
);
check(
  /if \(_throttle\) return/.test(panel) &&
    panel.indexOf('if (pathChanged) clearDuePaint()') < panel.indexOf('if (_throttle) return'),
  'path-change clear runs even when a throttle is already armed'
);
check(
  /st\.loadedForTask = info\.taskUuid/.test(panel) &&
    !/due\.loadedForTask = info\.taskUuid/.test(
      panel.split('async function loadWhatsDue')[1].split('function retryWhatsDue')[0]
    ),
  'loadedForTask is set only after a successful patient resolve (one-shot fail is retryable)'
);
check(/function retryWhatsDue/.test(panel) && /ms-tap-due-retry/.test(panel), 'error state offers Try again');
check(/scheduleDueRetry/.test(panel), 'resolve failure schedules an automatic retry');
check(/function countInt/.test(panel), 'due counts are coerced to integers before HTML interpolation');
check(!/evaluatePatient/.test(panel), 'panel does not re-evaluate rules itself (would risk a partial ruleset)');
check(/function setRole/.test(panel) && /ms-tap-role/.test(panel), 'Companion role toggle is wired');
check(/dueVoiceForRole/.test(panel), 'role change rebuilds due-mini with the matching voice');
check(/writeSavedRole/.test(panel), 'chosen role is persisted (never yanked mid-clinic)');
check(/Pulse is on the medical queue/.test(panel), 'triage off the queue stays honest (no invented counts)');
check(!/Open the medical queue for the pulse/.test(panel), 'off-queue pulse copy is not a fake button');
check(/moreLineText/.test(panel), '+N more uses the tested moreLineText helper ("of them overdue")');
check(/ms-tap-due-show-all/.test(panel), 'overflow expands in the widget (default still 4)');
check(/Open Monitoring/.test(panel), 'Monitoring is a real open-panel control');
check(/Open Slot Counter/.test(panel), 'Slot Counter is a real open-panel control');
check(/Already booked/.test(panel), 'reception sees this-patient future appointments');
check(/ms-open-panel/.test(panel), 'panel open goes through the allow-listed SW action');
check(/suggestedBookHint/.test(panel), 'reception due rows carry a book-type hint');
check(/roleCaption/.test(panel), 'role pills have a one-line caption');
check(/lang.*en-GB/.test(panel), 'widget is en-GB so the date field is not US-formatted');
{
  const sw = fs.readFileSync(path.join(__dirname, 'service-worker.js'), 'utf8');
  check(/case 'ms-open-panel'/.test(sw), 'service worker handles ms-open-panel');
  check(/mod !== 'sentinel' && mod !== 'slots'/.test(sw), 'ms-open-panel allow-lists only Monitoring and Slot Counter');
}
check(/Couldn't load the desk glance/.test(panel), 'desk fetch failure is named, not painted as zero');
check(
  /appointment-book\/embedded-overview/.test(panel),
  'slots glance uses the Slot Counter embedded-overview scrape, not the first two finder types'
);
check(/slotsFromOverview/.test(panel), 'slots glance maps the overview through the tested helper');
check(/ms-tap-title">Companion</.test(panel), 'header title is Companion');
check(/ms-tap-minimise/.test(panel), 'header has a dedicated Minimise / Restore button');
check(/ms-tap-icon-btn/.test(panel) && /function iconSvg/.test(panel), 'chrome uses stroke icons, not Unicode corners');
check(!/⌞/.test(panel), 'pop-in control is not the ⌞ character that rendered as L');
check(/ms-tap-mark/.test(panel) && /ms-tap-dock-chevron/.test(panel), 'header and docked tab share the Companion mark');
check(
  /ms-tap-signal-red/.test(panel) && /function dueSignal/.test(panel),
  'collapsed / docked chrome carries a severity signal class'
);
check(/ms-companion-collapsed/.test(panel), 'minimise state is persisted in localStorage');
check(/function readCollapsed/.test(panel) && /function writeCollapsed/.test(panel), 'collapsed persist helpers exist');
check(/function setCollapsed/.test(panel), 'title click and minimise both go through setCollapsed');
check(/ms-tap-minimised/.test(css), 'minimised chrome shrinks to a compact bar');
check(/ms-tap-icon-btn/.test(css) && /transparent/.test(css), 'chrome buttons are ghost at rest');
check(/ms-tap-dock-tab/.test(panel) && /ms-tap-docked/.test(css), 'Companion can pop in to an edge tab');
check(/ms-tap-signal-red::before/.test(css), 'reduced states promote severity onto the identity hairline');
{
  const dockFn = panel.slice(panel.indexOf('function setDocked'), panel.indexOf('function outerCollapsedDueBadge'));
  check(dockFn.length > 80 && /apiReleaseReservation/.test(dockFn), 'popping in releases any held booking reservation');
}
check(/ms-tap-resize/.test(panel) && /nwse-resize/.test(css), 'Companion has a resize handle');
check(/Show on every Medicus screen/.test(panel), 'all-screens opt-in is in the widget, not forced on');
{
  const roleSrc = fs.readFileSync(path.join(__dirname, 'shared', 'companion-role.js'), 'utf8');
  check(/ms-companion-all-screens/.test(roleSrc), 'all-screens preference is persisted');
  check(/kind: 'elsewhere'/.test(roleSrc), 'all-screens patient pages are a distinct elsewhere kind');
}

console.log('\n--- snapshot ping ---');
check(/ms-sentinel-snapshot/.test(panel), 'panel listens for the same-page snapshot ping');
check(
  /__msReadSentinelSnapshot/.test(sentinel) && /ms-sentinel-snapshot/.test(sentinel),
  'sentinel exposes the reader and the ping'
);

console.log('\n--- no completion / all-clear claim ---');
{
  const dueChunk = panel.slice(panel.indexOf('function dueDegradedHtml'), panel.indexOf('function apptStatusLabel'));
  check(dueChunk.length > 200, 'due HTML helpers are present');
  check(!/\ball clear\b/i.test(dueChunk), 'due UI never says "all clear"');
  check(!/\bsafe to\b/i.test(dueChunk), 'due UI never says "safe to"');
  check(!/\b(Done|Sent|Booked|Submitted)\b/.test(dueChunk), 'due UI never claims completion');
  check(/Nothing due right now/.test(dueChunk), 'empty state is bounded ("nothing due right now")');
  check(
    /Couldn\\u2019t verify everything that\\u2019s due/.test(dueChunk),
    'journal / unmatched-high-risk empty state does not claim nothing due'
  );
  check(/Journal data unavailable/.test(dueChunk), 'journal-augment failure is named on the strip');
  check(/high-risk medicine/.test(dueChunk), 'unmatched high-risk drugs are named on the strip');
  check(/Couldn\\u2019t classify alerts/.test(dueChunk), 'unrecognised chip statuses fail closed, not as nothing due');
  check(/Monitoring/.test(dueChunk), 'overflow / empty points at Monitoring for the full list');
  check(/moreRed/.test(dueChunk), 'hidden reds are named in the "+N more" line');
  check(/No recent/.test(dueChunk), 'no_data drug-monitoring gets a No recent tag, not Overdue');
}

console.log('\n--- CSS: hue is never the only signal ---');
check(/ms-tap-due-red \.ms-tap-due-dot/.test(css) && /background: var\(--red\)/.test(css), 'red due-dot is filled');
check(
  /ms-tap-due-amber \.ms-tap-due-dot/.test(css) && /background: transparent/.test(css),
  'amber due-dot is a hollow ring'
);
check(/ms-tap-due-tag/.test(css), 'status tag accompanies the dot');
check(/--red-dim/.test(css) && /--amber-dim/.test(css), 'due styles consume scoped status tokens');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
