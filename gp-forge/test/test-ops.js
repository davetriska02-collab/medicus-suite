// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — safety & ops console tests. Run: node test/test-ops.js

import { harness, startMockLlm } from './helpers.js';
import { createMetrics } from '../src/metrics.js';
import { AuditLog, queryAudit } from '../src/audit.js';
import { createLlmClient } from '../src/llm-client.js';
import { startServer } from '../src/server.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const { check, finish } = harness();

// ── unit: metrics ──────────────────────────────────────────────────────────────
const m = createMetrics();
m.inc('gpf_actions_total', { action: 'drafted' });
m.inc('gpf_actions_total', { action: 'drafted' });
m.inc('gpf_actions_total', { action: 'refused' });
check(m.actionCounts().drafted === 2 && m.actionCounts().refused === 1, 'unit: metrics actionCounts');
const prom = m.prometheus();
check(prom.includes('gpf_actions_total{action="drafted"} 2') && prom.includes('# TYPE gpf_actions_total counter'), 'unit: prometheus exposition format');

(async () => {
  const dir = join(tmpdir(), `gpf-ops-${randomUUID()}`);

  // unit: queryAudit
  const qpath = join(dir, 'q.jsonl');
  const qlog = new AuditLog({ path: qpath });
  qlog.append({ actor: 'a', task: 'admin_draft', action: 'drafted' });
  qlog.append({ actor: 'b', task: 'admin_draft', action: 'refused' });
  qlog.append({ actor: 'a', task: 'admin_draft', action: 'drafted' });
  check(queryAudit(qpath, { action: 'drafted' }).length === 2, 'unit: queryAudit filters by action');
  check(queryAudit(qpath, { actor: 'b' }).length === 1, 'unit: queryAudit filters by actor');

  // server with metrics fed from the audit log
  const metrics = createMetrics();
  const audit = new AuditLog({ path: join(dir, 'audit.jsonl'), onAppend: (rec) => metrics.inc('gpf_actions_total', { action: rec.action || 'unknown' }) });
  const mock = await startMockLlm();
  const config = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { baseUrl: mock.baseUrl, apiKey: 'x', model: 'm', timeoutMs: 5000 } };
  const server = await startServer({ config, llm: createLlmClient(config.llm), audit, metrics });
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { 'content-type': 'application/json', authorization: 'Bearer k' };

  // one successful draft + one refused (clinical) to populate the surveillance metrics
  await fetch(`${base}/v1/draft`, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'recall', context: { freeText: 'invite eligible patients to the seasonal flu clinic' } }) });
  await fetch(`${base}/v1/draft`, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'x', context: { freeText: 'what antibiotic should I prescribe' } }) });

  let r = await fetch(`${base}/metrics`);
  const t = await r.text();
  check(r.status === 200 && /text\/plain/.test(r.headers.get('content-type') || '') && t.includes('gpf_actions_total'), 'server: GET /metrics → Prometheus text (no auth)');
  check(t.includes('gpf_actions_total{action="drafted"} 1') && t.includes('gpf_actions_total{action="refused"} 1'), 'server: metrics counted drafted + refused');

  r = await fetch(`${base}/v1/audit/verify`, { headers: { authorization: 'Bearer k' } });
  let j = await r.json();
  check(r.status === 200 && j.ok === true, 'server: /v1/audit/verify → chain intact');
  r = await fetch(`${base}/v1/audit/verify`);
  check(r.status === 401, 'server: /v1/audit/verify without key → 401');

  r = await fetch(`${base}/v1/audit/query?action=refused`, { headers: { authorization: 'Bearer k' } });
  j = await r.json();
  check(r.status === 200 && j.count === 1 && j.records[0].action === 'refused', 'server: /v1/audit/query?action=refused → 1 record');

  r = await fetch(`${base}/v1/safety/summary`, { headers: { authorization: 'Bearer k' } });
  j = await r.json();
  check(r.status === 200 && j.flagged.refused === 1 && j.audit.ok === true, 'server: /v1/safety/summary → flagged counts + audit ok');

  await new Promise((res) => server.close(res));
  await mock.close();
  rmSync(dir, { recursive: true, force: true });
  finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
