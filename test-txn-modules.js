// Medicus Suite — Transactional API module contract tests
// Run with: node --test test-txn-modules.js
//
// Pins the contracts of the Transactional-integration plumbing:
//   shared/txn-config.js     — settings keys/defaults, base-URL builder, enable check
//   shared/txn-api.js        — typed endpoint client (method/url/body/isWrite shapes)
//   shared/txn-transport.js  — proxy transport ({method,path,body} -> POST {proxyUrl}/proxy)
//   shared/record-provider.js— session/transactional strategy (reads fall back, writes never)

'use strict';

const test = require('node:test');
const assert = require('node:assert');

const TxnConfig = require('./shared/txn-config.js');
const TxnApi = require('./shared/txn-api.js');
const TxnTransport = require('./shared/txn-transport.js');
const { createRecordProvider } = require('./shared/record-provider.js');

test('txn-config: baseUrl builds staging and prod hosts, rejects bad tenants', () => {
  assert.equal(TxnConfig.baseUrl('a30005', 'staging'), 'https://a30005.api.staging.england.medicus.health');
  assert.equal(TxnConfig.baseUrl('a30005', 'prod'), 'https://a30005.api.england.medicus.health');
  assert.throws(() => TxnConfig.baseUrl('not-a-code', 'prod'));
  assert.throws(() => TxnConfig.baseUrl('', 'staging'));
});

test('txn-config: integration is dormant by default', () => {
  assert.equal(TxnConfig.DEFAULTS.integrationMode, 'session');
  assert.equal(TxnConfig.isTransactionalEnabled('session'), false);
  assert.equal(TxnConfig.isTransactionalEnabled('hybrid'), true);
  assert.equal(TxnConfig.isTransactionalEnabled('transactional'), true);
});

test('txn-api: builds correct method/path/body and flags writes', async () => {
  const seen = [];
  const txn = TxnApi.createTxnApi({
    baseUrl: 'https://a30005.api.staging.england.medicus.health',
    fetchFn: async (req) => {
      seen.push(req);
      return { ok: true };
    },
  });
  await txn.getDemographics('p1');
  await txn.retrieveCareRecord('p1');
  await txn.createNote({ patientId: 'p1' });

  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].path, '/transactional-api/patient/p1/demographics');
  assert.equal(seen[0].isWrite, false);
  assert.equal(seen[1].method, 'POST');
  assert.deepEqual(seen[1].body, { patientId: 'p1' });
  assert.equal(seen[2].path, '/transactional-api/create-note');
  assert.equal(seen[2].isWrite, true);
});

test('txn-transport: forwards call shape to {proxyUrl}/proxy with tenant/env/userEmail', async () => {
  let captured = null;
  const transport = TxnTransport.createProxyTransport({
    proxyUrl: 'https://proj.supabase.co/functions/v1/',
    getCallerCredential: async () => 'caller-key',
    getTenant: async () => 'a30005',
    getEnvironment: async () => 'staging',
    getUserEmail: async () => 'gp@example.nhs',
    fetchFn: async (url, init) => {
      captured = { url, init };
      return { ok: true, text: async () => JSON.stringify({ status: 'ok' }) };
    },
  });
  const out = await transport({ method: 'POST', path: '/transactional-api/ping', body: null, isWrite: false });
  assert.deepEqual(out, { status: 'ok' });
  assert.equal(captured.url, 'https://proj.supabase.co/functions/v1/proxy');
  assert.equal(captured.init.headers.authorization, 'Bearer caller-key');
  const payload = JSON.parse(captured.init.body);
  assert.equal(payload.tenant, 'a30005');
  assert.equal(payload.environment, 'staging');
  assert.equal(payload.userEmail, 'gp@example.nhs');
  assert.equal(payload.path, '/transactional-api/ping');
});

test('txn-transport: refuses without proxyUrl or credential; surfaces HTTP errors with isWrite', async () => {
  const noUrl = TxnTransport.createProxyTransport({ getCallerCredential: async () => 'k' });
  await assert.rejects(() => noUrl({ method: 'GET', path: '/x' }), /proxy URL not configured/);

  const noCred = TxnTransport.createProxyTransport({
    proxyUrl: 'https://p.example',
    getCallerCredential: async () => null,
  });
  await assert.rejects(() => noCred({ method: 'GET', path: '/x' }), /credential not configured/);

  const err401 = TxnTransport.createProxyTransport({
    proxyUrl: 'https://p.example',
    getCallerCredential: async () => 'k',
    fetchFn: async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: 'unauthorized' }) }),
  });
  await assert.rejects(
    () => err401({ method: 'POST', path: '/transactional-api/create-note', body: {}, isWrite: true }),
    (e) => e.status === 401 && e.isWrite === true
  );
});

test('record-provider: session mode uses session client; hybrid falls back on txn read failure', async () => {
  const sessionOnly = createRecordProvider({
    mode: 'session',
    sessionClient: { getDemographics: async () => ({ src: 'session' }) },
    txnClient: { getDemographics: async () => ({ src: 'txn' }) },
  });
  assert.deepEqual(await sessionOnly.getDemographics('p1'), { src: 'session' });

  const hybrid = createRecordProvider({
    mode: 'hybrid',
    features: { demographics: true },
    sessionClient: { getDemographics: async () => ({ src: 'session' }) },
    txnClient: {
      getDemographics: async () => {
        throw new Error('401');
      },
    },
  });
  assert.deepEqual(await hybrid.getDemographics('p1'), { src: 'session' });
});

test('record-provider: writes never fall back and require the transactional client', async () => {
  const noTxn = createRecordProvider({ mode: 'session', sessionClient: {}, txnClient: null });
  await assert.rejects(() => noTxn.write('createNote', {}), /writes unavailable/);

  let called = false;
  const withTxn = createRecordProvider({
    mode: 'hybrid',
    txnClient: {
      createNote: async () => {
        called = true;
        return { id: 'x' };
      },
    },
  });
  assert.deepEqual(await withTxn.write('createNote', { patientId: 'p1' }), { id: 'x' });
  assert.ok(called);
});
