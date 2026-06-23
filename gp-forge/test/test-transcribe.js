// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — /v1/transcribe (verbatim STT) tests against a mock STT. Run: node test/test-transcribe.js
// Phase 1 = VERBATIM only: the server must return the STT text unaltered (no summarisation).

import { harness, startMockStt } from './helpers.js';
import { createSttClient } from '../src/stt-client.js';
import { createLlmClient } from '../src/llm-client.js';
import { AuditLog, verifyChain } from '../src/audit.js';
import { startServer } from '../src/server.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const { check, finish } = harness();

(async () => {
  const dir = join(tmpdir(), `gpf-stt-${randomUUID()}`);
  const llm = createLlmClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'm', timeoutMs: 500 }); // unused here
  const audioBytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]); // pretend webm bytes

  // 1) Configured STT → verbatim transcript, audited.
  let gotCT = '';
  const VERBATIM = 'No chest pain. Blood pressure discussed. Follow up in two weeks.';
  const mock = await startMockStt({
    transcribe: ({ contentType }) => {
      gotCT = contentType;
      return { status: 200, body: { text: VERBATIM } };
    },
  });
  const config = {
    port: 0,
    apiKeys: new Map([['k', 'alice']]),
    llm: { model: 'm' },
    stt: { baseUrl: mock.baseUrl, apiKey: 'x', model: 'whisper-1', timeoutMs: 5000 },
  };
  const audit = new AuditLog({ path: join(dir, 'audit.jsonl'), storeContent: false });
  const server = await startServer({ config, llm, audit, stt: createSttClient(config.stt) });
  const base = `http://127.0.0.1:${server.address().port}`;

  let r = await fetch(`${base}/v1/transcribe`, {
    method: 'POST',
    headers: { 'content-type': 'audio/webm', 'x-filename': 'c.webm', authorization: 'Bearer k' },
    body: audioBytes,
  });
  let j = await r.json();
  check(r.status === 200 && !!j.transcript && j.review_required === true && !!j.audit_id,
    'POST /v1/transcribe → 200 transcript, review_required, audit_id');
  check(j.transcript === VERBATIM, 'transcript is returned VERBATIM (server does not alter it)');
  check(gotCT.startsWith('multipart/form-data'), 'STT received a multipart/form-data upload');
  check(verifyChain(join(dir, 'audit.jsonl')).ok === true, 'audit chain intact after transcription');

  r = await fetch(`${base}/healthz`);
  j = await r.json();
  check(j.stt === 'up', 'GET /healthz reports stt up when configured');
  r = await fetch(`${base}/v1/info`);
  j = await r.json();
  check(/verbatim/.test(j.transcription || ''), 'GET /v1/info advertises verbatim transcription');

  r = await fetch(`${base}/v1/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: audioBytes });
  check(r.status === 401, 'POST /v1/transcribe without a key → 401');

  r = await fetch(`${base}/v1/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm', authorization: 'Bearer k' } });
  check(r.status === 400, 'POST /v1/transcribe with empty body → 400');

  await new Promise((res) => server.close(res));
  await mock.close();

  // 2) STT not configured → 501.
  const cfg2 = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { model: 'm' }, stt: { model: 'whisper-1' } };
  const server2 = await startServer({ config: cfg2, llm, audit: new AuditLog({ path: join(dir, 'a2.jsonl') }), stt: null });
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  r = await fetch(`${base2}/v1/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm', authorization: 'Bearer k' }, body: audioBytes });
  j = await r.json();
  check(r.status === 501 && j.error === 'transcription_not_configured', 'STT not configured → 501');
  await new Promise((res) => server2.close(res));

  // 3) STT backend down → 503.
  const cfg3 = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { model: 'm' }, stt: { baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'whisper-1', timeoutMs: 1500 } };
  const server3 = await startServer({ config: cfg3, llm, audit: new AuditLog({ path: join(dir, 'a3.jsonl') }), stt: createSttClient(cfg3.stt) });
  const base3 = `http://127.0.0.1:${server3.address().port}`;
  r = await fetch(`${base3}/v1/transcribe`, { method: 'POST', headers: { 'content-type': 'audio/webm', authorization: 'Bearer k' }, body: audioBytes });
  j = await r.json();
  check(r.status === 503 && j.error === 'stt_unavailable', 'STT backend down → 503 stt_unavailable');
  await new Promise((res) => server3.close(res));

  rmSync(dir, { recursive: true, force: true });
  finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
