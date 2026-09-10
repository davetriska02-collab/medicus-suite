// Injector runtime: route match starts, leaving the route stops.
'use strict';

const runtime = require('./shared/injector-runtime.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL  ' + msg);
  }
}

runtime.resetForTest();

const log = [];
runtime.register('book', {
  match: function (pathname) {
    return /appointment-book/.test(pathname);
  },
  start: function () {
    log.push('start');
  },
  stop: function () {
    log.push('stop');
  },
});

runtime.setLocation('/abc/scheduling/homepage', '?tab=slots');
runtime.boot();
check(runtime.isStarted('book') === false, 'off-book does not start');
check(log.length === 0, 'off-book does not call start');

runtime.setLocation('/abc/scheduling/appointment-book', '?date=2026-09-10');
runtime.sync();
check(runtime.isStarted('book') === true, 'book route starts');
check(log[0] === 'start', 'start called on book route');

runtime.sync();
check(
  log.filter(function (x) {
    return x === 'start';
  }).length >= 2,
  'already-on start is re-entered (placement)'
);

runtime.setLocation('/abc/care-record/uuid', '');
runtime.sync();
check(runtime.isStarted('book') === false, 'leaving the book stops');
check(log[log.length - 1] === 'stop', 'stop called off-book');

runtime.setLocation('/abc/care-record/uuid', '');
runtime.sync();
check(
  log.filter(function (x) {
    return x === 'stop';
  }).length === 1,
  'stop is not repeated while already off'
);

runtime.resetForTest();
check(runtime.isStarted('book') === false, 'resetForTest clears started');

console.log('test-injector-runtime: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
