// Medicus Suite — txn-transport request timeout tests
// Run with: node --test test-txn-transport-timeout.js
//
// Pins the timeout contract added to shared/txn-transport.js: a hung proxy
// call must abort after `timeoutMs` rather than stalling on the browser's
// own (30s+) default, and the resulting error must never look like a
// silently-retryable one for writes.

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

test('txn-transport: hung fetch aborts and rejects with isTimeout after timeoutMs', async () => {
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      timeoutMs: 50,
      fetchFn: (url, opts) =>
        new Promise((_, rej) => {
          opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    })
  );
  await assert.rejects(
    () => transport({ method: 'GET', path: '/x', isWrite: false }),
    (e) => e.isTimeout === true && /timeout/.test(e.message)
  );
});

test('txn-transport: timeout propagates isWrite so writes are never silently retried', async () => {
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      timeoutMs: 50,
      fetchFn: (url, opts) =>
        new Promise((_, rej) => {
          opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    })
  );
  await assert.rejects(
    () => transport({ method: 'POST', path: '/transactional-api/create-note', body: {}, isWrite: true }),
    (e) => e.isTimeout === true && e.isWrite === true
  );
});

test('txn-transport: fast fetch still succeeds and clears the timer (no stray rejection)', async () => {
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      timeoutMs: 50,
      fetchFn: async () => ({ ok: true, text: async () => JSON.stringify({ status: 'ok' }) }),
    })
  );
  const out = await transport({ method: 'GET', path: '/x', isWrite: false });
  assert.deepEqual(out, { status: 'ok' });
  // Give any stray timer callback a chance to fire; it must not throw/reject.
  await new Promise((resolve) => setTimeout(resolve, 100));
});

test('txn-transport: plain network error rethrows with isWrite set, isTimeout falsy', async () => {
  const transport = TxnTransport.createProxyTransport(
    baseCfg({
      timeoutMs: 50,
      fetchFn: async () => {
        throw new Error('ECONNRESET');
      },
    })
  );
  await assert.rejects(
    () => transport({ method: 'POST', path: '/transactional-api/create-note', body: {}, isWrite: true }),
    (e) => e.message === 'ECONNRESET' && e.isWrite === true && !e.isTimeout
  );
});
