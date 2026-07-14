// Medicus Suite — shared/panel-txn-feed.js tests
// Run with: node --test test-panel-txn-feed.js
//
// Pins the panel feed-selector contract: ONLY 'transactional' mode sources the
// panel from the API feed; 'session' and 'hybrid' (and every failure mode)
// return null so callers keep their existing session path. Never throws.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');

const MOD_URL = pathToFileURL(path.join(__dirname, 'shared', 'panel-txn-feed.js')).href;

const BUNDLE = {
  patientContext: { patientUuid: 'aaaaaaaa-0000-4000-8000-000000000001' },
  medications: [],
  observations: [],
  debug: {},
};

function chromeStub({ mode, resp, sendImpl }) {
  return {
    storage: { local: { get: async () => ({ 'txn.integrationMode': mode }) } },
    runtime: { sendMessage: sendImpl || (async () => resp) },
  };
}

test('transactional mode: returns the bundle, tagged with panelFeed provenance', async () => {
  const { getTxnBundleIfEnabled, feedSourceLabel } = await import(MOD_URL);
  const chromeApi = chromeStub({ mode: 'transactional', resp: { ok: true, bundle: { ...BUNDLE, debug: {} } } });
  const bundle = await getTxnBundleIfEnabled('aaaaaaaa-0000-4000-8000-000000000001', { chromeApi });
  assert.ok(bundle, 'bundle returned');
  assert.equal(bundle.debug.panelFeed, 'transactional');
  assert.equal(feedSourceLabel(bundle), 'API');
});

test('session and hybrid modes: null — panel modules keep their session path', async () => {
  const { getTxnBundleIfEnabled } = await import(MOD_URL);
  for (const mode of ['session', 'hybrid', undefined]) {
    let called = 0;
    const chromeApi = chromeStub({ mode, sendImpl: async () => (called++, { ok: true, bundle: BUNDLE }) });
    const bundle = await getTxnBundleIfEnabled('aaaaaaaa-0000-4000-8000-000000000001', { chromeApi });
    assert.equal(bundle, null, `mode=${mode} must not use the feed`);
    assert.equal(called, 0, `mode=${mode} must not even send the message`);
  }
});

test('failure modes all return null, never throw: error resp, no bundle, rejected message, no uuid', async () => {
  const { getTxnBundleIfEnabled, feedSourceLabel } = await import(MOD_URL);
  const cases = [
    chromeStub({ mode: 'transactional', resp: { ok: false, error: 'proxy 503' } }),
    chromeStub({ mode: 'transactional', resp: { ok: true, bundle: { medications: [] } } }), // no patientContext
    chromeStub({ mode: 'transactional', sendImpl: async () => Promise.reject(new Error('SW asleep')) }),
  ];
  for (const chromeApi of cases) {
    assert.equal(await getTxnBundleIfEnabled('aaaaaaaa-0000-4000-8000-000000000001', { chromeApi }), null);
  }
  assert.equal(await getTxnBundleIfEnabled(null, { chromeApi: cases[0] }), null, 'no uuid -> null');
  assert.equal(await getTxnBundleIfEnabled('x', { chromeApi: {} }), null, 'no chrome APIs -> null');
  assert.equal(feedSourceLabel(BUNDLE), 'session', 'untagged bundle labels as session');
});
