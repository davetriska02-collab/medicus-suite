// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — HTTP API (zero-dependency, built-in node:http).
// Phase-1 endpoints:
//   GET  /healthz      liveness + LLM reachability (always 200)
//   GET  /v1/info      service info, phase, allowed tasks
//   POST /v1/draft     administrative draft (auth required) — guarded, constrained, validated, audited
// The server NEVER writes to Medicus and returns review_required:true on every draft (human-in-the-loop).

import { createServer } from 'node:http';
import { guardRequest, buildPrompt, SYSTEM_PROMPT, PHASE1_TASKS } from './phase1.js';
import { ADMIN_DRAFT_SCHEMA } from './schemas.js';
import { parseJson, validateAdminDraft } from './validate.js';
import { LlmUnavailableError } from './llm-client.js';

const VERSION = '0.1.0';

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limitBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function authenticate(req, apiKeys) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return apiKeys.get(m[1].trim()) || null; // actor name, or null if unknown key
}

// deps: { llm, audit } — injected so the server is testable without a real backend.
export function createApp({ config, llm, audit }) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/healthz') {
        const llmUp = await llm.ping();
        return send(res, 200, { status: 'ok', version: VERSION, llm: llmUp ? 'up' : 'down' });
      }

      if (req.method === 'GET' && url.pathname === '/v1/info') {
        return send(res, 200, {
          service: 'gp-forge',
          version: VERSION,
          phase: 1,
          note: 'Administrative/documentation support only. Not a medical device. Human review required.',
          tasks: Object.fromEntries(Object.entries(PHASE1_TASKS).map(([k, v]) => [k, v.description])),
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/draft') {
        const actor = authenticate(req, config.apiKeys);
        if (!actor) return send(res, 401, { error: 'unauthorized', message: 'valid Bearer key required' });

        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          return send(res, 400, { error: 'bad_request', message: err.message });
        }

        const task = 'admin_draft';
        const guard = guardRequest({ task, context: body.context });
        if (!guard.ok) {
          audit.append({ actor, task, model: config.llm.model, action: 'refused', input: stableInput(body) });
          return send(res, 422, { error: 'refused', code: guard.code, message: guard.refusal });
        }

        const prompt = buildPrompt({ kind: body.kind, context: body.context });
        let content;
        try {
          content = await llm.chat({ system: SYSTEM_PROMPT, user: prompt, schema: ADMIN_DRAFT_SCHEMA });
        } catch (err) {
          if (err instanceof LlmUnavailableError) {
            audit.append({ actor, task, model: config.llm.model, action: 'llm_unavailable', input: stableInput(body) });
            return send(res, 503, { error: 'llm_unavailable', message: 'local LLM backend is unavailable' });
          }
          throw err;
        }

        const parsed = parseJson(content);
        const validated = parsed.ok ? validateAdminDraft(parsed.value) : parsed;
        if (!validated.ok) {
          audit.append({ actor, task, model: config.llm.model, action: 'rejected_output', input: stableInput(body), output: content });
          return send(res, 502, { error: 'invalid_output', messages: validated.errors });
        }

        const record = audit.append({
          actor,
          task,
          model: config.llm.model,
          action: 'drafted',
          input: stableInput(body),
          output: JSON.stringify(validated.value),
        });

        return send(res, 200, {
          draft: validated.value,
          audit_id: record.id,
          review_required: true, // human-in-the-loop: nothing is filed by GP Forge
        });
      }

      return send(res, 404, { error: 'not_found' });
    } catch (err) {
      return send(res, 500, { error: 'internal_error', message: err.message });
    }
  };
}

function stableInput(body) {
  return JSON.stringify({ kind: body.kind ?? null, context: body.context ?? null });
}

export function startServer({ config, llm, audit }) {
  const server = createServer(createApp({ config, llm, audit }));
  return new Promise((resolve) => {
    server.listen(config.port, () => resolve(server));
  });
}
