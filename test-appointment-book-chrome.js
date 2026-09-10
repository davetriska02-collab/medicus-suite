// Source lock: appointment-book tally and organise observers only run on
// the book route. Off-book they disconnect the MutationObserver, clear the
// 1.5s placement interval, and remove the host.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const tally = fs.readFileSync(path.join(__dirname, 'content-scripts/appointment-tally.js'), 'utf8');
assert(/function stopBookChrome\(/.test(tally), 'tally defines stopBookChrome');
assert(/function startBookChrome\(/.test(tally), 'tally defines startBookChrome');
assert(/function syncBookChrome\(/.test(tally), 'tally defines syncBookChrome');
assert(
  /if \(currentRoute\(\)\) startBookChrome\(\);\s*else stopBookChrome\(\);/.test(tally),
  'tally calls stopBookChrome when !route'
);
assert(/_mo\.disconnect\(\)/.test(tally), 'tally disconnects its observer off-book');
assert(/clearInterval\(_poll\)/.test(tally), 'tally clears the 1.5s interval off-book');

const organise = fs.readFileSync(path.join(__dirname, 'content-scripts/appointment-organise-canvas.js'), 'utf8');
assert(/function stopHeavyChrome\(/.test(organise), 'organise defines stopHeavyChrome');
assert(/function startHeavyChrome\(/.test(organise), 'organise defines startHeavyChrome');
assert(
  /if \(currentRoute\(\)\) startHeavyChrome\(\);\s*else stopHeavyChrome\(\);/.test(organise),
  'organise calls stopHeavyChrome when !route'
);
assert(/function onRoutePulse\(/.test(organise), 'organise route-gates via onRoutePulse');

const allocateFiles = [
  'content-scripts/lab-allocate-canvas.js',
  'content-scripts/rx-allocate-canvas.js',
  'content-scripts/workflow-allocate-canvas.js',
  'content-scripts/request-allocate-canvas.js',
];
for (const f of allocateFiles) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  assert(/function stopHeavyChrome\(/.test(src), `${f} defines stopHeavyChrome`);
  assert(/function startHeavyChrome\(/.test(src), `${f} defines startHeavyChrome`);
  assert(
    /if \(currentRoute\(\)\) startHeavyChrome\(\);\s*else stopHeavyChrome\(\);/.test(src),
    `${f} calls stopHeavyChrome when !route`
  );
  assert(/__chObserverHub/.test(src), `${f} subscribes to the shared DOM hub`);
}

console.log('test-appointment-book-chrome: ok');
