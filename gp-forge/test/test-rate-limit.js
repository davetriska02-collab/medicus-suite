// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — per-key rate limiter tests (unit + server 429). Run: node test/test-rate-limit.js

import { harness, startMockLlm } from './helpers.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createLlmClient } from '../src/llm-client.js';
import { AuditLog } from '../src/audit.js';
import { startServer } from '../src/server.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const { check, finish } = harness();

// ── unit ─────────────────────────────────────────────────────────────────────
let t = 100000;
const rl = createRateLimiter({ rpm: 2, now: () => t });
check(rl.check('alice').ok, 'unit: 1st request allowed');
check(rl.check('alice').ok, 'unit: 2nd request allowed');
const third = rl.check('alice');
check(!third.ok && third.retryAfter > 0, 'unit: 3rd request blocked with retryAfter');
check(rl.check('bob').ok, 'unit: other key is independent');
t += 61_000;
check(rl.check('alice').ok, 'unit: allowed again after the window passes');
const rl0 = createRateLimiter({ rpm: 0 });
check(rl0.check('x').ok && rl0.check('x').ok && rl0.check('x').ok, 'unit: rpm=0 disables limiting');

// ── server integration ────────────────────────────────────────────────────────
(async () => {
  const dir = join(tmpdir(), `gpf-rl-${randomUUID()}`);
  const mock = await startMockLlm();
  const config = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { baseUrl: mock.baseUrl, apiKey: 'x', model: 'm', timeoutMs: 5000 } };
  const limiter = createRateLimiter({ rpm: 1 });
  const server = await startServer({ config, llm: createLlmClient(config.llm), audit: new AuditLog({ path: join(dir, 'a.jsonl') }), limiter });
  const base = `http://127.0.0.1:${server.address().port}`;
  const opts = {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
    body: JSON.stringify({ kind: 'recall', context: { freeText: 'invite eligible patients to the seasonal flu clinic' } }),
  };

  let r = await fetch(`${base}/v1/draft`, opts);
  check(r.status === 200, 'server: 1st /v1/draft within limit → 200');
  r = await fetch(`${base}/v1/draft`, opts);
  const j = await r.json();
  check(r.status === 429 && j.error === 'rate_limited' && !!r.headers.get('retry-after'), 'server: 2nd /v1/draft over limit → 429 + Retry-After');

  await new Promise((res) => server.close(res));
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
  finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
