// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — local-guidance RAG tests. Run: node test/test-rag.js
// Extractive/quote-only: a grounded answer must cite verbatim quotes from the retrieved passages,
// and off-corpus questions are refused. Uses mock embeddings + mock LLM (no real models needed).

import { harness, startMockLlm, startMockEmbeddings } from './helpers.js';
import { cosine, VectorStore } from '../src/vector-store.js';
import { validateRagAnswer } from '../src/rag.js';
import { createLlmClient } from '../src/llm-client.js';
import { createEmbeddingsClient } from '../src/embeddings-client.js';
import { AuditLog } from '../src/audit.js';
import { startServer } from '../src/server.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

const { check, finish } = harness();

// ── unit: cosine + store ───────────────────────────────────────────────────────
check(Math.abs(cosine([1, 0, 0], [1, 0, 0]) - 1) < 1e-9, 'unit: cosine of identical vectors = 1');
check(cosine([1, 0], [0, 1]) === 0, 'unit: cosine of orthogonal vectors = 0');
const vs = new VectorStore({});
vs.add({ source: 'a', text: 'alpha', embedding: [1, 0] });
vs.add({ source: 'b', text: 'beta', embedding: [0, 1] });
const ranked = vs.search([1, 0], 2);
check(ranked[0].source === 'a' && ranked[0].score > ranked[1].score, 'unit: store.search ranks by cosine');

// ── unit: validateRagAnswer (grounding) ────────────────────────────────────────
const CTX = 'Patients aged 65 and over are eligible for the flu vaccine.';
check(validateRagAnswer({ answer: 'See guidance.', grounded: true, citations: [{ source: 'flu', quote: 'aged 65 and over are eligible' }] }, CTX).ok, 'unit: grounded + cited-in-context validates');
check(validateRagAnswer({ answer: 'x', grounded: true, citations: [{ source: 'flu', quote: 'everyone gets a jab' }] }, CTX).ok === false, 'unit: ungrounded citation rejected');
check(validateRagAnswer({ answer: 'Not covered by local guidance.', grounded: false, citations: [] }, CTX).ok, 'unit: grounded=false with no citations is valid (refusal)');

const FLU = 'Patients aged 65 and over are eligible for the flu vaccine.';
const CANCER = 'Refer urgently for cancer if red flag symptoms are present.';
const groundedAnswer = { status: 200, body: { choices: [{ message: { content: JSON.stringify({ answer: 'Patients aged 65 and over are eligible.', grounded: true, citations: [{ source: 'flu-policy', quote: 'aged 65 and over are eligible for the flu vaccine' }] }) } }] } };
const ungroundedAnswer = { status: 200, body: { choices: [{ message: { content: JSON.stringify({ answer: 'Everyone should be vaccinated now.', grounded: true, citations: [{ source: 'flu-policy', quote: 'everyone under 18 should get the flu jab immediately' }] }) } }] } };

(async () => {
  const dir = join(tmpdir(), `gpf-rag-${randomUUID()}`);
  const emb = await startMockEmbeddings();
  const embClient = createEmbeddingsClient({ baseUrl: emb.baseUrl, apiKey: 'x', model: 'm', timeoutMs: 5000 });

  // not configured → 501
  {
    const mockLlm = await startMockLlm();
    const config = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { baseUrl: mockLlm.baseUrl, apiKey: 'x', model: 'm', timeoutMs: 5000 }, ragMinScore: 0.3 };
    const server = await startServer({ config, llm: createLlmClient(config.llm), audit: new AuditLog({ path: join(dir, 'a0.jsonl') }), embeddings: null, store: null });
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch(`${base}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ question: 'x' }) });
    check(r.status === 501, 'server: /v1/ask without embeddings configured → 501');
    await new Promise((res) => server.close(res));
    await mockLlm.close();
  }

  // configured: ingest + ask (grounded + off-corpus)
  {
    const store = new VectorStore({ path: join(dir, 'corpus.jsonl') });
    const mockLlm = await startMockLlm({ chat: () => groundedAnswer });
    const config = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { baseUrl: mockLlm.baseUrl, apiKey: 'x', model: 'm', timeoutMs: 5000 }, corpusPath: store.path, ragMinScore: 0.3 };
    const server = await startServer({ config, llm: createLlmClient(config.llm), audit: new AuditLog({ path: join(dir, 'audit.jsonl') }), embeddings: embClient, store });
    const base = `http://127.0.0.1:${server.address().port}`;

    let r = await fetch(`${base}/v1/corpus`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ source: 'flu-policy', chunks: [FLU, CANCER] }) });
    let j = await r.json();
    check(r.status === 200 && j.ingested === 2 && j.total === 2, 'server: /v1/corpus ingests 2 chunks');

    r = await fetch(`${base}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'flu' }) });
    check(r.status === 401, 'server: /v1/ask without key → 401');

    r = await fetch(`${base}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ question: 'Who is eligible for the flu vaccine?' }) });
    j = await r.json();
    check(r.status === 200 && j.grounded === true && j.citations.length > 0 && j.review_required === true, 'server: relevant question → grounded answer with citations');

    r = await fetch(`${base}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ question: 'Tell me about the history of jazz music' }) });
    j = await r.json();
    check(r.status === 200 && j.grounded === false && j.citations.length === 0, 'server: off-corpus question → refusal (grounded false, no citations)');

    await new Promise((res) => server.close(res));
    await mockLlm.close();
  }

  // ungrounded model output → 502
  {
    const store = new VectorStore({ path: join(dir, 'corpus2.jsonl') });
    const mockLlm = await startMockLlm({ chat: () => ungroundedAnswer });
    const config = { port: 0, apiKeys: new Map([['k', 'alice']]), llm: { baseUrl: mockLlm.baseUrl, apiKey: 'x', model: 'm', timeoutMs: 5000 }, corpusPath: store.path, ragMinScore: 0.3 };
    const server = await startServer({ config, llm: createLlmClient(config.llm), audit: new AuditLog({ path: join(dir, 'audit2.jsonl') }), embeddings: embClient, store });
    const base = `http://127.0.0.1:${server.address().port}`;
    await fetch(`${base}/v1/corpus`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ source: 'flu-policy', chunks: [FLU] }) });
    const r = await fetch(`${base}/v1/ask`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: JSON.stringify({ question: 'Who is eligible for the flu vaccine?' }) });
    const j = await r.json();
    check(r.status === 502 && j.error === 'invalid_output', 'server: ungrounded RAG output → 502 (citation grounding catches fabrication)');
    await new Promise((res) => server.close(res));
    await mockLlm.close();
  }

  await emb.close();
  rmSync(dir, { recursive: true, force: true });
  finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
