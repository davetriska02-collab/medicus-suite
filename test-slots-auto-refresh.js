// Medicus Suite — Slots auto-refresh wiring guards
// Run with: node test-slots-auto-refresh.js
//
// The Slots board used to sit on the last manual fetch (or a Pusher ping) until
// the clinician hit Refresh. These are source guards in the
// test-reception-patient-card.js style: they pin the poll interval, the
// visibility pause, cleanup symmetry, the quiet refetch path, and that the
// existing manual / date-change refresh still uses the loud fetch.

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

const src = fs.readFileSync(path.join(__dirname, 'side-panel/modules/slots/slots.js'), 'utf8');

function fnBody(marker, len = 2600) {
  const at = src.indexOf(marker);
  return at === -1 ? '' : src.slice(at, at + len);
}

// ── 1. Poll wiring ──────────────────────────────────────────────────────────
{
  console.log('— auto-refresh wiring —');
  check(
    /const POLL_MS = 60 \* 1000/.test(src),
    'POLL_MS is 60s (same cadence as Today Slots / Submissions today-mode)'
  );
  const initBody = fnBody('export async function init', 4500);
  check(initBody.includes('setInterval(onSlotsPoll, POLL_MS)'), 'init() starts the poll on POLL_MS');
  check(
    initBody.includes("document.addEventListener('visibilitychange', onSlotsVisibility)"),
    'init() listens for visibilitychange (kick a tick when the tab comes back)'
  );
  check(initBody.includes('clearInterval(pollTimer)'), 'init() cleanup clears the poll timer');
  check(
    initBody.includes("document.removeEventListener('visibilitychange', onSlotsVisibility)"),
    'init() cleanup removes the visibility listener'
  );
}

// ── 2. Visibility pause + unmount cancel ────────────────────────────────────
{
  console.log('\n— visibility + busy gates —');
  const pollBody = fnBody('function onSlotsPoll()', 500);
  check(
    /document\.hidden/.test(pollBody) && /visibilityState !== 'visible'/.test(pollBody),
    'onSlotsPoll returns while the document is hidden'
  );
  check(pollBody.includes('isSlotsUiBusy()'), 'onSlotsPoll skips a tick while the user is editing');
  check(pollBody.includes('fetchAndRender({ quiet: true })'), 'the poll uses the quiet refetch path');
  const visBody = fnBody('function onSlotsVisibility()', 280);
  check(visBody.includes('onSlotsPoll()'), 'becoming visible reuses the same gated poll (no hidden hammering)');
}

// ── 3. Quiet path does not skeleton / does preserve scroll ──────────────────
{
  console.log('\n— quiet refetch discipline —');
  const fetchBody = fnBody('async function fetchAndRender', 2200);
  check(
    fetchBody.includes('opts.quiet === true') || fetchBody.includes('quiet === true'),
    'fetchAndRender accepts a quiet option'
  );
  check(
    /const silent = quiet && !!state\.data/.test(fetchBody),
    'quiet is silent only when the board already has data (first load still shows the skeleton)'
  );
  check(
    /if \(!silent\) \{[\s\S]{0,120}state\.loading = true/.test(fetchBody),
    'silent ticks never flip loading (no skeleton flicker)'
  );
  check(
    fetchBody.includes('captureScroll()') && fetchBody.includes('restoreScroll(savedScroll)'),
    'a quiet redraw that changes counts restores scroll'
  );
  check(
    fetchBody.includes('patchFreshness()'),
    'an unchanged quiet tick updates the freshness stamp in place (no full rebuild)'
  );
  check(
    /if \(silent\) return;[\s\S]{0,80}state\.error = err\.message/.test(fetchBody),
    'a failed quiet tick keeps the last good board (no error-banner flash)'
  );
}

// ── 4. Manual refresh and date change stay loud ─────────────────────────────
{
  console.log('\n— manual refresh still works —');
  check(
    src.includes("querySelector('#refreshSlots')?.addEventListener('click', () => fetchAndRender())"),
    'the Refresh button still calls fetchAndRender() with no quiet flag'
  );
  check(
    /#slotsDate[\s\S]{0,180}fetchAndRender\(\)/.test(src),
    'changing the date still uses the loud fetchAndRender()'
  );
  check(
    /preset-btn[\s\S]{0,220}fetchAndRender\(\)/.test(src),
    'Today / Next working day presets still use the loud fetchAndRender()'
  );
}

// ── 5. Teardown symmetry ────────────────────────────────────────────────────
{
  console.log('\n— cleanup symmetry —');
  const intervals = (src.match(/setInterval\(/g) || []).length;
  const clears = (src.match(/clearInterval\(/g) || []).length;
  check(intervals === clears && intervals > 0, `setInterval/clearInterval are symmetric (${intervals}/${clears})`);
  const visAdds = (src.match(/addEventListener\('visibilitychange'/g) || []).length;
  const visRemoves = (src.match(/removeEventListener\('visibilitychange'/g) || []).length;
  check(visAdds === visRemoves && visAdds > 0, `visibilitychange add/remove are symmetric (${visAdds}/${visRemoves})`);
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed) process.exit(1);
