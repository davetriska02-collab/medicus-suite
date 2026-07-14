// Medicus Suite — Transactional request concurrency gate tests
// Run with: node --test test-txn-request-gate.js
//
// Pins the contract of shared/txn-request-gate.js: never more than
// maxConcurrent in flight, FIFO release order for queued work, a rejecting
// fn still frees its slot and its rejection reaches the run() caller without
// breaking the queue, and inFlight()/queued() report accurately.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createRequestGate } = require('./shared/txn-request-gate.js');

// A deferred promise the test controls the resolution/rejection of.
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// setImmediate is a macrotask, so awaiting it drains the ENTIRE microtask
// queue first — including any chained/recursive .then()s the gate schedules
// internally (e.g. scheduleNext() re-entering runNow()). Using this instead
// of counting `await Promise.resolve()` hops keeps the tests independent of
// the gate's internal promise-chain depth.
function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('run() executes immediately under the limit and resolves to the fn result', async () => {
  const gate = createRequestGate({ maxConcurrent: 3 });
  const result = await gate.run(() => Promise.resolve('value1'));
  assert.equal(result, 'value1');
  await tick();
  assert.equal(gate.inFlight(), 0);
  assert.equal(gate.queued(), 0);
});

test('never runs more than maxConcurrent fns at once', async () => {
  const maxConcurrent = 3;
  const gate = createRequestGate({ maxConcurrent });

  let current = 0;
  let peak = 0;
  const gates = [];
  for (let i = 0; i < 8; i++) gates.push(deferred());

  const runs = gates.map((d) =>
    gate.run(() => {
      current += 1;
      peak = Math.max(peak, current);
      return d.promise.then((v) => {
        current -= 1;
        return v;
      });
    })
  );

  await tick();

  assert.equal(gate.inFlight(), maxConcurrent);
  assert.equal(gate.queued(), gates.length - maxConcurrent);
  assert.ok(peak <= maxConcurrent, `peak concurrency ${peak} exceeded limit ${maxConcurrent}`);

  // Release them all one at a time, checking the limit holds throughout.
  for (let i = 0; i < gates.length; i++) {
    gates[i].resolve(i);
    await tick();
    assert.ok(gate.inFlight() <= maxConcurrent, `inFlight exceeded limit after release ${i}`);
  }

  const results = await Promise.all(runs);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(peak <= maxConcurrent);
  await tick();
  assert.equal(gate.inFlight(), 0);
  assert.equal(gate.queued(), 0);
});

test('queued fns are released in FIFO order', async () => {
  const gate = createRequestGate({ maxConcurrent: 1 });

  const order = [];
  const d1 = deferred();
  const d2 = deferred();
  const d3 = deferred();

  const r1 = gate.run(() => {
    order.push('start-1');
    return d1.promise.then(() => order.push('end-1'));
  });
  const r2 = gate.run(() => {
    order.push('start-2');
    return d2.promise.then(() => order.push('end-2'));
  });
  const r3 = gate.run(() => {
    order.push('start-3');
    return d3.promise.then(() => order.push('end-3'));
  });

  await tick();
  assert.deepEqual(order, ['start-1']); // only the first slot runs immediately
  assert.equal(gate.queued(), 2);

  d1.resolve();
  await r1;
  await tick();
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2']);

  d2.resolve();
  await r2;
  await tick();
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3']);

  d3.resolve();
  await r3;
  await tick();
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
  assert.equal(gate.inFlight(), 0);
  assert.equal(gate.queued(), 0);
});

test('a rejecting fn frees its slot, its rejection propagates, and the queue keeps going', async () => {
  const gate = createRequestGate({ maxConcurrent: 1 });

  const failing = gate.run(() => Promise.reject(new Error('boom')));
  const following = gate.run(() => Promise.resolve('after-failure'));

  await assert.rejects(failing, /boom/);
  const result = await following;
  assert.equal(result, 'after-failure');
  await tick();
  assert.equal(gate.inFlight(), 0);
  assert.equal(gate.queued(), 0);
});

test('a synchronously throwing fn also frees its slot and rejects run()', async () => {
  const gate = createRequestGate({ maxConcurrent: 1 });

  const throwing = gate.run(() => {
    throw new Error('sync boom');
  });
  const following = gate.run(() => Promise.resolve('after-throw'));

  await assert.rejects(throwing, /sync boom/);
  const result = await following;
  assert.equal(result, 'after-throw');
});

test('inFlight() and queued() report zero on an idle gate', () => {
  const gate = createRequestGate({ maxConcurrent: 3 });
  assert.equal(gate.inFlight(), 0);
  assert.equal(gate.queued(), 0);
});

test('defaults to maxConcurrent = 3 when no options are passed', async () => {
  const gate = createRequestGate({});

  const gates = [deferred(), deferred(), deferred(), deferred()];
  const runs = gates.map((d) => gate.run(() => d.promise));

  await tick();

  assert.equal(gate.inFlight(), 3);
  assert.equal(gate.queued(), 1);

  gates.forEach((d, i) => d.resolve(i));
  const results = await Promise.all(runs);
  assert.deepEqual(results, [0, 1, 2, 3]);
});
