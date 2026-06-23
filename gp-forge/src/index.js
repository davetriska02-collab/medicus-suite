// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — entry point. Wires config → fail-closed egress guard → LLM client → audit → HTTP server.

import { loadConfig } from './config.js';
import { assertEgressLocked, EgressOpenError } from './egress-guard.js';
import { createLlmClient } from './llm-client.js';
import { createSttClient } from './stt-client.js';
import { createEmbeddingsClient } from './embeddings-client.js';
import { VectorStore } from './vector-store.js';
import { createRateLimiter } from './rate-limit.js';
import { AuditLog } from './audit.js';
import { startServer } from './server.js';

async function main() {
  const config = loadConfig();

  // Fail-closed egress control BEFORE anything else (the CSO sign-off condition).
  try {
    const egress = await assertEgressLocked({
      canaryHost: config.egress.canaryHost,
      canaryPort: config.egress.canaryPort,
      allowOpen: config.egress.allowOpen,
    });
    if (egress.locked) console.log('[gp-forge] egress locked ✓ (canary unreachable)');
  } catch (err) {
    if (err instanceof EgressOpenError) {
      console.error(`[gp-forge] REFUSING TO START: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }

  const llm = createLlmClient(config.llm);
  const stt = config.stt.baseUrl ? createSttClient(config.stt) : null;
  const audit = new AuditLog(config.audit);
  const embeddings = config.embeddings.baseUrl ? createEmbeddingsClient(config.embeddings) : null;
  const store = embeddings ? new VectorStore({ path: config.corpusPath }) : null;
  const limiter = createRateLimiter({ rpm: config.rateRpm });
  const up = await llm.ping();
  console.log(`[gp-forge] LLM backend ${up ? 'reachable ✓' : 'NOT reachable (clients will get 503 until it is up)'} at ${config.llm.baseUrl}`);
  if (stt) {
    const sttUp = await stt.ping();
    console.log(`[gp-forge] STT backend ${sttUp ? 'reachable ✓' : 'NOT reachable'} at ${config.stt.baseUrl}`);
  } else {
    console.log('[gp-forge] STT backend not configured (transcription disabled)');
  }

  if (config.phase2Enabled) {
    console.warn('[gp-forge] WARNING: Phase-2 (SOAP summarisation, /v1/note) ENABLED — a medical-device-class feature, NOT cleared, NOT for clinical use without conformity assessment.');
  }

  if (embeddings) {
    const eUp = await embeddings.ping();
    console.log(`[gp-forge] embeddings backend ${eUp ? 'reachable ✓' : 'NOT reachable'} at ${config.embeddings.baseUrl} — local-guidance corpus: ${store.size} chunks`);
  } else {
    console.log('[gp-forge] embeddings backend not configured (local-guidance RAG disabled)');
  }

  await startServer({ config, llm, audit, stt, embeddings, store, limiter });
  console.log(`[gp-forge] listening on :${config.port} — Phase 1 (admin/documentation only, human-in-the-loop, audited)`);
}

main().catch((err) => {
  console.error('[gp-forge] fatal:', err);
  process.exit(1);
});
