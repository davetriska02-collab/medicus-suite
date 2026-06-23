// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — server integration tests against a mock LLM. Run: node test/test-server.js

import { harness, startMockLlm } from './helpers.js';
import { createLlmClient } from '../src/llm-client.js';
import { AuditLog, verifyChain } from '../src/audit.js';
import { startServer } from '../src/server.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const { check, finish } = harness();

(async () => {
  const dir = join(tmpdir(), `gpf-srv-${randomUUID()}`);
  const mock = await startMockLlm();
  const config = {
    port: 0,
    apiKeys: new Map([['k-alice', 'alice']]),
    llm: { baseUrl: mock.baseUrl, apiKey: 'x', model: 'qwen3-30b', timeoutMs: 5000 },
  };
  const audit = new AuditLog({ path: join(dir, 'audit.jsonl'), storeContent: false });
  const llm = createLlmClient(config.llm);
  const server = await startServer({ config, llm, audit });
  const base = `http://127.0.0.1:${server.address().port}`;

  let r = await fetch(`${base}/healthz`);
  let j = await r.json();
  check(r.status === 200 && j.status === 'ok' && j.llm === 'up', 'GET /healthz → 200, llm up');

  r = await fetch(`${base}/v1/info`);
  j = await r.json();
  check(r.status === 200 && j.phase === 1 && !!j.tasks.admin_draft, 'GET /v1/info advertises phase 1 + admin_draft');

  r = await fetch(`${base}/v1/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'recall', context: { freeText: 'flu clinic' } }),
  });
  check(r.status === 401, 'POST /v1/draft without a key → 401');

  r = await fetch(`${base}/v1/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer k-alice' },
    body: JSON.stringify({ kind: 'flu recall invitation', context: { freeText: 'invite eligible patients to the seasonal flu clinic' } }),
  });
  j = await r.json();
  check(r.status === 200 && j.draft && j.draft.title && j.review_required === true && j.audit_id,
    'POST /v1/draft → 200 validated draft, review_required, audit_id');

  r = await fetch(`${base}/v1/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer k-alice' },
    body: JSON.stringify({ kind: 'note', context: { freeText: 'what antibiotic should I prescribe for this UTI?' } }),
  });
  j = await r.json();
  check(r.status === 422 && j.error === 'refused', 'POST /v1/draft clinical request → 422 refused');

  check(verifyChain(join(dir, 'audit.jsonl')).ok === true, 'audit chain intact after requests');

  await new Promise((res) => server.close(res));
  await mock.close();

  // LLM backend down → 503 (client degrades gracefully).
  const downConfig = {
    port: 0,
    apiKeys: new Map([['k-alice', 'alice']]),
    llm: { baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'm', timeoutMs: 2000 },
  };
  const audit2 = new AuditLog({ path: join(dir, 'audit2.jsonl'), storeContent: false });
  const server2 = await startServer({ config: downConfig, llm: createLlmClient(downConfig.llm), audit: audit2 });
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  r = await fetch(`${base2}/v1/draft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer k-alice' },
    body: JSON.stringify({ kind: 'recall', context: { freeText: 'flu clinic' } }),
  });
  j = await r.json();
  check(r.status === 503 && j.error === 'llm_unavailable', 'LLM backend down → 503 llm_unavailable');
  await new Promise((res) => server2.close(res));

  rmSync(dir, { recursive: true, force: true });
  finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
