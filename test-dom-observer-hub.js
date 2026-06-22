// Medicus Suite — shared DOM-observer hub tests
// Run with: node test-dom-observer-hub.js
//
// Loads content-scripts/dom-observer-hub.js in a vm sandbox with mocked
// window/document/MutationObserver/requestAnimationFrame and asserts the hub:
//   • exposes window.__chObserverHub.subscribe() returning an unsubscribe fn
//   • creates EXACTLY ONE MutationObserver for N subscribers (the consolidation)
//   • coalesces a burst of mutation batches into one rAF-aligned fan-out
//   • passes the combined MutationRecord[] batch to every subscriber, in order
//   • pauses delivery while document.hidden, and resumes when visible
//   • stops delivering to a subscriber after it unsubscribes
//   • isolates a throwing subscriber from the others
//   • is idempotent (re-running the source does not replace the hub)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'dom-observer-hub.js'), 'utf8');

// Build a fresh sandbox + a small driver harness around one hub instance.
function makeEnv() {
  const mos = []; // every MutationObserver constructed
  let rafQ = [];
  const win = {};
  const document = {
    hidden: false,
    body: {}, // truthy → start() observes immediately
    addEventListener: () => {},
  };
  const sandbox = {
    window: win,
    document,
    requestAnimationFrame: (fn) => {
      rafQ.push(fn);
      return rafQ.length;
    },
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb;
        this.disconnected = false;
        mos.push(this);
      }
      observe(t, o) {
        this.target = t;
        this.opts = o;
      }
      disconnect() {
        this.disconnected = true;
      }
    },
  };
  win.document = document;
  vm.runInNewContext(src, sandbox);
  return {
    win,
    sandbox,
    document,
    mos,
    rafLen: () => rafQ.length,
    flushRaf: () => {
      const q = rafQ;
      rafQ = [];
      q.forEach((f) => f());
    },
    // Simulate the browser delivering a mutation batch to the live observer(s).
    fire: (records) => mos.forEach((m) => !m.disconnected && m.cb(records)),
  };
}

console.log('--- API shape ---');
{
  const e = makeEnv();
  check(
    e.win.__chObserverHub && typeof e.win.__chObserverHub.subscribe === 'function',
    'exposes window.__chObserverHub.subscribe()'
  );
  check(typeof e.win.__chObserverHub.subscribe(() => {}) === 'function', 'subscribe() returns an unsubscribe function');
}

console.log('\n--- one observer, coalesced fan-out, combined batch ---');
{
  const e = makeEnv();
  const hub = e.win.__chObserverHub;
  const got = [[], []];
  hub.subscribe((b) => got[0].push(b));
  hub.subscribe((b) => got[1].push(b));
  check(e.mos.length === 1, 'exactly ONE MutationObserver created for two subscribers');

  e.fire([{ id: 'a' }]); // two batches within the same frame
  e.fire([{ id: 'b' }]);
  check(got[0].length === 0, 'no synchronous delivery before the frame flush (coalesced)');
  check(e.rafLen() === 1, 'a single rAF is scheduled for the burst');

  e.flushRaf();
  check(got[0].length === 1 && got[1].length === 1, 'each subscriber called exactly once after the flush');
  check(
    got[0][0].length === 2 && got[0][0][0].id === 'a' && got[0][0][1].id === 'b',
    'combined batch carries both records, in order'
  );
}

console.log('\n--- hidden pause / resume ---');
{
  const e = makeEnv();
  let n = 0;
  e.win.__chObserverHub.subscribe(() => n++);
  e.document.hidden = true;
  e.fire([{ id: 'x' }]);
  check(e.rafLen() === 0, 'no rAF scheduled while document.hidden');
  e.flushRaf();
  check(n === 0, 'no delivery while hidden');
  e.document.hidden = false;
  e.fire([{ id: 'y' }]);
  e.flushRaf();
  check(n === 1, 'delivery resumes once visible');
}

console.log('\n--- unsubscribe ---');
{
  const e = makeEnv();
  let n = 0;
  const unsub = e.win.__chObserverHub.subscribe(() => n++);
  e.fire([{}]);
  e.flushRaf();
  check(n === 1, 'subscriber receives the first batch');
  unsub();
  e.fire([{}]);
  e.flushRaf();
  check(n === 1, 'no delivery after unsubscribe');
}

console.log('\n--- error isolation ---');
{
  const e = makeEnv();
  let good = 0;
  e.win.__chObserverHub.subscribe(() => {
    throw new Error('boom');
  });
  e.win.__chObserverHub.subscribe(() => good++);
  e.fire([{}]);
  e.flushRaf();
  check(good === 1, 'a throwing subscriber does not starve the others');
}

console.log('\n--- idempotent re-run ---');
{
  const e = makeEnv();
  const first = e.win.__chObserverHub;
  vm.runInNewContext(src, e.sandbox); // re-run the source in the same sandbox
  check(e.win.__chObserverHub === first, 're-running the hub source is a no-op (same instance kept)');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
