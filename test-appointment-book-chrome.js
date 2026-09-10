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
  assert(!/__chObserverHub/.test(src), `${f} does not subscribe to the hub itself`);
  assert(!/already went/.test(src), `${f} does not claim the write already went`);
}
{
  const organise = fs.readFileSync(path.join(__dirname, 'content-scripts/appointment-organise-canvas.js'), 'utf8');
  assert(/function teardownOverlay\(/.test(organise), 'organise has teardownOverlay');
  assert(/function muteAllocateChrome\([\s\S]*?teardownOverlay\(\)/.test(organise), 'organise mute force-removes the overlay');
}

const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
assert(manifest.includes('shared/injector-runtime.js'), 'manifest loads injector-runtime.js');
assert(manifest.includes('shared/write-core.js'), 'manifest loads write-core.js');
const runtimeIdx = manifest.indexOf('shared/injector-runtime.js');
const tallyIdx = manifest.indexOf('content-scripts/appointment-tally.js');
assert(runtimeIdx !== -1 && runtimeIdx < tallyIdx, 'injector-runtime loads before tally');
const writeCoreIdx = manifest.indexOf('shared/write-core.js');
const labCoreIdx = manifest.indexOf('shared/lab-allocate-core.js');
const allergyIdx = manifest.indexOf('content-scripts/allergy-cleanup-canvas.js');
assert(writeCoreIdx !== -1 && writeCoreIdx < labCoreIdx, 'write-core loads before lab-allocate-core');
assert(writeCoreIdx !== -1 && writeCoreIdx < allergyIdx, 'write-core loads before allergy-cleanup-canvas');

console.log('test-appointment-book-chrome: ok');
