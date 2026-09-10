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
}

const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
assert(manifest.includes('shared/injector-runtime.js'), 'manifest loads injector-runtime.js');
assert(manifest.includes('shared/write-core.js'), 'manifest loads write-core.js');
const runtimeIdx = manifest.indexOf('shared/injector-runtime.js');
const tallyIdx = manifest.indexOf('content-scripts/appointment-tally.js');
assert(runtimeIdx !== -1 && runtimeIdx < tallyIdx, 'injector-runtime loads before tally');

console.log('test-appointment-book-chrome: ok');
