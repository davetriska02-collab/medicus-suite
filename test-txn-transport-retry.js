// Medicus Suite — txn-transport read-retry tests
// Run with: node --test test-txn-transport-retry.js
//
// Pins the retry contract added to shared/txn-transport.js: transient READ
// failures (timeouts, bare network rejections, 502/503/504/429) get one
// retry by default, backing off `backoffMs * 2^(attemptIndex-1)` (+ jitter
// unless disabled). WRITES ARE NEVER SILENTLY RETRIED — exactly one attempt,
// ever, regardless of how transient the failure looks.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const TxnTransport = require('./shared/txn-transport.js');

function baseCfg(overrides) {
  return Object.assign(
    {
      proxyUrl: 'https://p.example',
      getCallerCredential: async () => 'k',
    },
    overrides
  );
}

function okResp(body) {
  return { ok: true, text: async () => JSON.stringify(body === undefined ? { status: 'ok' } : body) };
}

function statusResp(status, error) {
  return { ok: false, status, text: async () => JSON.stringify({ error: error || 'err' }) };
}

function recordingSleep(calls) {
  return async (ms) => {
    calls.push(ms);
  };
}

test('retry: read + 503 then success succeeds with 2 tries, sleeps once with expected base delay (jitter off)', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { backoffMs: 100, jitter: false },
      sleepFn: recordingSleep(sleeps),
      fetchFn: async () => {
        calls += 1;
        return calls === 1 ? statusResp(503) : okResp();
      },
    })
  );
  const out = await transport({ method: 'GET', path: '/x', isWrite: false });
  assert.deepEqual(out, { status: 'ok' });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [100]); // backoffMs * 2^(1-1) = 100, no jitter
});

test('retry: read + timeout then success succeeds', async () => {
  let calls = 0;
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      timeoutMs: 30,
      retry: { backoffMs: 5, jitter: false },
      sleepFn: async () => {},
      fetchFn: (url, opts) => {
        calls += 1;
        if (calls === 1) {
          return new Promise((_, rej) => {
            opts.signal.addEventListener('abort', () =>
              rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            );
          });
        }
        return Promise.resolve(okResp());
      },
    })
  );
  const out = await transport({ method: 'GET', path: '/x', isWrite: false });
  assert.deepEqual(out, { status: 'ok' });
  assert.equal(calls, 2);
});

test('retry: write + 503 makes exactly ONE fetch call; error propagates immediately with isWrite true', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { backoffMs: 100, jitter: false },
      sleepFn: recordingSleep(sleeps),
      fetchFn: async () => {
        calls += 1;
        return statusResp(503);
      },
    })
  );
  await assert.rejects(
    () => transport({ method: 'POST', path: '/transactional-api/create-note', body: {}, isWrite: true }),
    (e) => e.status === 503 && e.isWrite === true && e.attempts === 1
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('retry: read + 400 makes one call, no retry', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { backoffMs: 100, jitter: false },
      sleepFn: recordingSleep(sleeps),
      fetchFn: async () => {
        calls += 1;
        return statusResp(400);
      },
    })
  );
  await assert.rejects(
    () => transport({ method: 'GET', path: '/x', isWrite: false }),
    (e) => e.status === 400 && e.attempts === 1
  );
  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
});

test('retry: read + persistent 503 with attempts:2 throws last error with err.attempts = 2', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { attempts: 2, backoffMs: 10, jitter: false },
      sleepFn: recordingSleep(sleeps),
      fetchFn: async () => {
        calls += 1;
        return statusResp(503);
      },
    })
  );
  await assert.rejects(
    () => transport({ method: 'GET', path: '/x', isWrite: false }),
    (e) => e.status === 503 && e.attempts === 2
  );
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [10]);
});

test('retry: attempts configured above 3 are capped at 3', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { attempts: 10, backoffMs: 1, jitter: false },
      sleepFn: recordingSleep(sleeps),
      fetchFn: async () => {
        calls += 1;
        return statusResp(502);
      },
    })
  );
  await assert.rejects(
    () => transport({ method: 'GET', path: '/x', isWrite: false }),
    (e) => e.status === 502 && e.attempts === 3
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1, 2]); // backoffMs*2^0, backoffMs*2^1
});

test('retry: jitter disabled produces deterministic delay values across retries', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { attempts: 3, backoffMs: 50, jitter: false },
      sleepFn: recordingSleep(sleeps),
      randomFn: () => {
        throw new Error('randomFn must not be called when jitter is disabled');
      },
      fetchFn: async () => {
        calls += 1;
        return statusResp(429);
      },
    })
  );
  await assert.rejects(() => transport({ method: 'GET', path: '/x', isWrite: false }));
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [50, 100]);
});

test('retry: jitter enabled adds 0-50% of the base delay, using injected randomFn', async () => {
  let calls = 0;
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { attempts: 2, backoffMs: 100, jitter: true },
      sleepFn: recordingSleep(sleeps),
      randomFn: () => 0.5, // deterministic: adds exactly 50% of base
      fetchFn: async () => {
        calls += 1;
        return statusResp(503);
      },
    })
  );
  await assert.rejects(() => transport({ method: 'GET', path: '/x', isWrite: false }));
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [125]); // 100 + 0.5*0.5*100
});

test('retry: bare network rejection (no err.status) on a read is retried', async () => {
  let calls = 0;
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { backoffMs: 1, jitter: false },
      sleepFn: async () => {},
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) throw new Error('ECONNRESET');
        return okResp();
      },
    })
  );
  const out = await transport({ method: 'GET', path: '/x', isWrite: false });
  assert.deepEqual(out, { status: 'ok' });
  assert.equal(calls, 2);
});

test('retry: first-try success has no added latency (sleepFn never called)', async () => {
  const sleeps = [];
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      retry: { backoffMs: 100, jitter: false },
      sleepFn: recordingSleep(sleeps),
      fetchFn: async () => okResp(),
    })
  );
  const out = await transport({ method: 'GET', path: '/x', isWrite: false });
  assert.deepEqual(out, { status: 'ok' });
  assert.deepEqual(sleeps, []);
});
