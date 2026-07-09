// Medicus Suite — engine/data-fetcher.js hybrid-mode (shadow) fetch tests
// Run with: node --test test-txn-hybrid-fetch.js
//
// Pins the crossover-safety contract added to fetchTransactionalOrLive():
//   'session'        — never calls chrome.runtime.sendMessage at all.
//   'transactional'   — unchanged: returns the txn bundle on success, falls
//                        back to the session bundle with debug.txnFallback
//                        set on any failure.
//   'hybrid'          — TRUE shadow mode: ALWAYS returns the session bundle;
//                        the txn bundle is fetched concurrently and attached
//                        as debug.txnShadow ({ bundle } on success, { error }
//                        on failure) and never sets debug.txnFallback (the
//                        session bundle was never at risk of not rendering).
//
// Stubbing idiom follows the repo convention (see test-contract-canary.js,
// test-txn-modules.js): a fake global.chrome (storage.local.get +
// runtime.sendMessage), a fake global.SentinelApiClient.detectMedicusContext,
// and — because fetchLive() is a real, non-mockable internal call inside
// data-fetcher.js's own closure — a fake global.SentinelApiClient.fetchAll +
// global.SentinelNormalisers.normaliseAll so fetchLive() resolves a
// deterministic "session" bundle without ever touching a real DOM.

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const DataFetcher = require('./engine/data-fetcher.js');

const SESSION_PATIENT_CONTEXT = { patientUuid: 'aaaaaaaa-0000-4000-8000-000000000001', patientName: 'Session View' };
const TXN_BUNDLE = {
  mode: 'live',
  patientContext: { patientUuid: 'aaaaaaaa-0000-4000-8000-000000000001', patientName: 'Txn View' },
  medications: [{ name: 'Txn Med', source: 'txn' }],
  observations: [],
  observationHistory: [],
  problems: [],
  debug: { dataSource: 'txn' },
};

function installEnv({ txnMode, sendMessage } = {}) {
  global.location = {
    href: 'https://tenant.medicus.health/patient/patient/summary/aaaaaaaa-0000-4000-8000-000000000001',
  };
  global.document = { title: 'Session View' };
  global.SentinelApiClient = {
    detectMedicusContext: () => ({
      patientUuid: 'aaaaaaaa-0000-4000-8000-000000000001',
      apiBase: 'https://tenant.api.medicus.health',
      encounterUuid: null,
    }),
    fetchAll: async () => ({ banner: {}, errors: {} }),
  };
  global.SentinelNormalisers = {
    normaliseAll: () => ({
      patientContext: SESSION_PATIENT_CONTEXT,
      medications: [],
      observations: [],
      observationHistory: [],
      problems: [],
      pastProblems: [],
    }),
  };
  let sendMessageCalls = 0;
  global.chrome = {
    storage: {
      local: {
        get: async () => ({ 'txn.integrationMode': txnMode }),
      },
    },
    runtime: {
      sendMessage: async (msg) => {
        sendMessageCalls++;
        if (typeof sendMessage === 'function') return sendMessage(msg);
        return { ok: false, error: 'not configured' };
      },
    },
  };
  return {
    get sendMessageCalls() {
      return sendMessageCalls;
    },
  };
}

test('session mode: never calls chrome.runtime.sendMessage, returns the session bundle', async () => {
  const env = installEnv({ txnMode: 'session' });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.equal(env.sendMessageCalls, 0, 'sendMessage must not be called in session mode');
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT);
  assert.equal(bundle.debug.txnShadow, undefined, 'session mode never attaches a shadow');
  assert.equal(bundle.debug.txnFallback, undefined, 'session mode never sets txnFallback');
});

test('transactional mode: unchanged — returns the txn bundle on success', async () => {
  installEnv({ txnMode: 'transactional', sendMessage: async () => ({ ok: true, bundle: TXN_BUNDLE }) });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.equal(bundle, TXN_BUNDLE, 'transactional success returns the txn bundle itself');
  assert.equal(bundle.debug.txnFallback, undefined);
});

test('transactional mode: unchanged — falls back to session bundle with txnFallback on failure', async () => {
  installEnv({ txnMode: 'transactional', sendMessage: async () => ({ ok: false, error: 'proxy 401' }) });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT, 'falls back to the session bundle');
  assert.equal(bundle.debug.txnFallback, 'proxy 401');
  assert.equal(bundle.debug.txnShadow, undefined, 'transactional mode never sets a shadow');
});

test('transactional mode: unchanged — a throwing sendMessage still falls back with txnFallback (never throws)', async () => {
  installEnv({
    txnMode: 'transactional',
    sendMessage: async () => {
      throw new Error('network down');
    },
  });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT);
  assert.equal(bundle.debug.txnFallback, 'network down');
});

test('hybrid mode: ALWAYS returns the session bundle, with debug.txnShadow.bundle attached on txn success', async () => {
  installEnv({ txnMode: 'hybrid', sendMessage: async () => ({ ok: true, bundle: TXN_BUNDLE }) });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.deepEqual(
    bundle.patientContext,
    SESSION_PATIENT_CONTEXT,
    'hybrid displays the SESSION bundle, not the txn one'
  );
  assert.equal(bundle.debug.txnShadow.bundle, TXN_BUNDLE);
  assert.equal(bundle.debug.txnShadow.error, undefined);
  assert.equal(
    bundle.debug.txnFallback,
    undefined,
    'hybrid never sets txnFallback — the session bundle was never at risk'
  );
});

test('hybrid mode: debug.txnShadow.error set on txn failure; txnFallback still NOT set', async () => {
  installEnv({ txnMode: 'hybrid', sendMessage: async () => ({ ok: false, error: 'proxy 500' }) });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT);
  assert.equal(bundle.debug.txnShadow.error, 'proxy 500');
  assert.equal(bundle.debug.txnShadow.bundle, undefined);
  assert.equal(
    bundle.debug.txnFallback,
    undefined,
    'a hybrid shadow failure must never look like a transactional fallback'
  );
});

test('hybrid mode: a rejecting sendMessage never throws — resolves to the session bundle with txnShadow.error', async () => {
  installEnv({
    txnMode: 'hybrid',
    sendMessage: async () => {
      throw new Error('timeout');
    },
  });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT);
  assert.equal(bundle.debug.txnShadow.error, 'timeout');
  assert.equal(bundle.debug.txnFallback, undefined);
});

test('hybrid mode: a malformed bundle (no patientContext) is treated as a shadow error, not a crash', async () => {
  installEnv({ txnMode: 'hybrid', sendMessage: async () => ({ ok: true, bundle: { medications: [] } }) });
  const bundle = await DataFetcher.fetchTransactionalOrLive();
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT);
  assert.equal(bundle.debug.txnShadow.error, 'no bundle');
});

test('hybrid mode: a hung txn request cannot delay the session render past the shadow budget', async () => {
  installEnv({ txnMode: 'hybrid', sendMessage: () => new Promise(() => {}) }); // never resolves
  const started = Date.now();
  const bundle = await DataFetcher.fetchHybrid('aaaaaaaa-0000-4000-8000-000000000001', 50);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `render was delayed ${elapsed}ms — the budget must cut the shadow loose`);
  assert.deepEqual(bundle.patientContext, SESSION_PATIENT_CONTEXT, 'session bundle still returned');
  assert.match(bundle.debug.txnShadow.error, /shadow budget exceeded/, 'budget breach recorded as shadow error');
  assert.equal(bundle.debug.txnFallback, undefined, 'hybrid never sets txnFallback');
});
