// Source lock: book/allocate injectors register with InjectorRuntime instead
// of each keeping a documentElement MutationObserver + 1.5s tick.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const files = {
  'content-scripts/appointment-tally.js': 'appointment-tally',
  'content-scripts/appointment-organise-canvas.js': 'appointment-organise',
  'content-scripts/lab-allocate-canvas.js': 'lab-allocate',
  'content-scripts/rx-allocate-canvas.js': 'rx-allocate',
  'content-scripts/workflow-allocate-canvas.js': 'workflow-allocate',
  'content-scripts/request-allocate-canvas.js': 'request-allocate',
};

for (const [f, id] of Object.entries(files)) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  assert(/InjectorRuntime/.test(src), `${f} uses InjectorRuntime`);
  assert(src.includes("register('" + id + "'") || src.includes('register("' + id + '"'), `${f} registers as ${id}`);
  assert(/function stopHeavyChrome\(|function stopBookChrome\(/.test(src), `${f} has a stop hook`);
  assert(/place:\s*(ensureLauncher|tick)/.test(src), `${f} has a throttled place hook`);
  assert(!/__chObserverHub/.test(src), `${f} does not subscribe to the hub itself`);
  assert(!/already went/.test(src), `${f} does not claim the write already went`);
}
{
  const extra = {
    'content-scripts/allergy-cleanup.js': 'allergy-cleanup',
    'content-scripts/problem-nesting.js': 'problem-nesting',
    'content-scripts/document-codes-to-problems.js': 'document-codes',
    'content-scripts/document-file-inline.js': 'document-file-inline',
    'content-scripts/problem-description-cleanup.js': 'problem-description-cleanup',
    'content-scripts/patient-alerts-banner.js': 'patient-alerts-banner',
    'content-scripts/risk-flag-cleanup.js': 'risk-flag-cleanup',
    'content-scripts/repeat-prescribing-pills.js': 'repeat-prescribing-pills',
  };
  for (const [f, id] of Object.entries(extra)) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert(src.includes("register('" + id + "'"), `${f} registers as ${id}`);
    assert(/function stopHeavyChrome\(/.test(src), `${f} has a stop hook`);
  }
  {
    const allergy = fs.readFileSync(path.join(__dirname, 'content-scripts/allergy-cleanup.js'), 'utf8');
    const nesting = fs.readFileSync(path.join(__dirname, 'content-scripts/problem-nesting.js'), 'utf8');
    assert(/parseCareRecordPath/.test(allergy) && /parseTaskOverviewPath/.test(allergy), 'allergy route-gates to care-record / task overview');
    assert(/parseCareRecordPath/.test(nesting) && /parseTaskOverviewPath/.test(nesting), 'nesting route-gates to care-record / task overview');
  }
}
{
  const bulk = fs.readFileSync(path.join(__dirname, 'content-scripts/task-bulk-action.js'), 'utf8');
  assert(bulk.includes("register('task-bulk-' + config.id"), 'task-bulk registers per instantiation');
  assert(/function stopHeavyChrome\(/.test(bulk), 'task-bulk has a stop hook');
}
{
  const organise = fs.readFileSync(path.join(__dirname, 'content-scripts/appointment-organise-canvas.js'), 'utf8');
  assert(/function teardownOverlay\(/.test(organise), 'organise has teardownOverlay');
  assert(/function muteAllocateChrome\([\s\S]*?teardownOverlay\(\)/.test(organise), 'organise mute force-removes the overlay');
  assert(/actionLandedOnBoard/.test(organise), 'organise Finalise confirms on the post-write board');
  assert(!/li < writtenCount/.test(organise), 'organise does not treat throw-free POSTs as landed');
}

const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
assert(manifest.includes('shared/injector-runtime.js'), 'manifest loads injector-runtime.js');
assert(manifest.includes('shared/write-core.js'), 'manifest loads write-core.js');
const runtimeIdx = manifest.indexOf('shared/injector-runtime.js');
const tallyIdx = manifest.indexOf('content-scripts/appointment-tally.js');
assert(runtimeIdx !== -1 && runtimeIdx < tallyIdx, 'injector-runtime loads before tally');
assert(runtimeIdx < manifest.indexOf('content-scripts/problem-nesting.js'), 'injector-runtime loads before problem-nesting');
assert(
  runtimeIdx < manifest.indexOf('content-scripts/document-codes-to-problems.js'),
  'injector-runtime loads before document-codes'
);
assert(
  runtimeIdx < manifest.indexOf('content-scripts/patient-alerts-banner.js'),
  'injector-runtime loads before patient-alerts'
);
assert((manifest.match(/shared\/practice-packs\.js/g) || []).length === 1, 'practice-packs.js is parsed once');
const writeCoreIdx = manifest.indexOf('shared/write-core.js');
const labCoreIdx = manifest.indexOf('shared/lab-allocate-core.js');
const allergyIdx = manifest.indexOf('content-scripts/allergy-cleanup-canvas.js');
assert(writeCoreIdx !== -1 && writeCoreIdx < labCoreIdx, 'write-core loads before lab-allocate-core');
assert(writeCoreIdx !== -1 && writeCoreIdx < allergyIdx, 'write-core loads before allergy-cleanup-canvas');
{
  const harvest = [
    'content-scripts/lab-allocate-canvas.js',
    'content-scripts/rx-allocate-canvas.js',
    'content-scripts/workflow-allocate-canvas.js',
    'content-scripts/request-allocate-canvas.js',
  ];
  for (const f of harvest) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert(/var _boardGen = 0/.test(src), `${f} tracks a board generation`);
    assert(/gen !== _boardGen/.test(src), `${f} aborts overview harvest after close`);
    assert(/function closeOverlay\(\) \{\s*_boardGen\+\+/.test(src), `${f} bumps generation on close`);
  }
}

console.log('test-appointment-book-chrome: ok');
