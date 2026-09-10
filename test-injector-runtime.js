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
  place: function () {
    log.push('place');
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
  }).length === 1,
  'already-on does not re-call start'
);
check(
  log.filter(function (x) {
    return x === 'place';
  }).length >= 1,
  'already-on calls place'
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

const log2 = [];
runtime.register('plain', {
  match: function () {
    return true;
  },
  start: function () {
    log2.push('start');
  },
  stop: function () {
    log2.push('stop');
  },
});
runtime.setLocation('/x', '');
runtime.boot();
runtime.sync();
check(
  log2.filter(function (x) {
    return x === 'start';
  }).length === 1,
  'injector without place is not re-started while on-route'
);

runtime.resetForTest();

console.log('test-injector-runtime: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
