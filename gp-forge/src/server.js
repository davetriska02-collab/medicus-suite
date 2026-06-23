// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — HTTP API (zero-dependency, built-in node:http).
// Phase-1 endpoints:
//   GET  /healthz      liveness + LLM reachability (always 200)
//   GET  /v1/info      service info, phase, allowed tasks
//   POST /v1/draft       administrative draft (auth required) — guarded, constrained, validated, audited
//   POST /v1/transcribe  verbatim speech-to-text (auth required) — verbatim only (Phase 1), audited
// The server NEVER writes to Medicus and returns review_required:true on every output (human-in-the-loop).

import { createServer } from 'node:http';
import { guardRequest, buildPrompt, SYSTEM_PROMPT, PHASE1_TASKS, detectInjection } from './phase1.js';
import { ADMIN_DRAFT_SCHEMA, SOAP_NOTE_SCHEMA } from './schemas.js';
import { parseJson, validateAdminDraft } from './validate.js';
import { SOAP_SYSTEM_PROMPT, buildSoapPrompt, validateSoapNote } from './phase2.js';
import { LlmUnavailableError } from './llm-client.js';
import { SttUnavailableError } from './stt-client.js';

const VERSION = '0.1.0';

function send(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...(extraHeaders || {}) });
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

function readRawBody(req, limitBytes = 25_000_000) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function authenticate(req, apiKeys) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  return apiKeys.get(m[1].trim()) || null; // actor name, or null if unknown key
}

// deps: { llm, audit, stt, limiter } — injected so the server is testable without a real backend.
// stt may be null; limiter defaults to a pass-through.
export function createApp({ config, llm, audit, stt, limiter = { check: () => ({ ok: true }) } }) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/healthz') {
        const llmUp = await llm.ping();
        const sttUp = stt ? await stt.ping() : null;
        return send(res, 200, { status: 'ok', version: VERSION, llm: llmUp ? 'up' : 'down', stt: stt ? (sttUp ? 'up' : 'down') : 'n/a' });
      }

      if (req.method === 'GET' && url.pathname === '/v1/info') {
        return send(res, 200, {
          service: 'gp-forge',
          version: VERSION,
          phase: 1,
          note: 'Administrative/documentation support only. Not a medical device. Human review required.',
          tasks: Object.fromEntries(Object.entries(PHASE1_TASKS).map(([k, v]) => [k, v.description])),
          transcription: stt ? 'verbatim (configured) — not a generative summary' : 'not configured',
          phase2_soap: config.phase2Enabled ? 'ENABLED — experimental medical-device-class (NOT cleared, not for clinical use)' : 'disabled',
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/draft') {
        const actor = authenticate(req, config.apiKeys);
        if (!actor) return send(res, 401, { error: 'unauthorized', message: 'valid Bearer key required' });

        const rl = limiter.check(actor);
        if (!rl.ok) {
          audit.append({ actor, task: 'admin_draft', model: config.llm.model, action: 'rate_limited' });
          return send(res, 429, { error: 'rate_limited', message: 'too many requests', retry_after_s: rl.retryAfter }, { 'retry-after': String(rl.retryAfter) });
        }

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

      if (req.method === 'POST' && url.pathname === '/v1/transcribe') {
        const actor = authenticate(req, config.apiKeys);
        if (!actor) return send(res, 401, { error: 'unauthorized', message: 'valid Bearer key required' });

        const rl = limiter.check(actor);
        if (!rl.ok) {
          audit.append({ actor, task: 'transcribe', model: config.stt && config.stt.model, action: 'rate_limited' });
          return send(res, 429, { error: 'rate_limited', message: 'too many requests', retry_after_s: rl.retryAfter }, { 'retry-after': String(rl.retryAfter) });
        }
        if (!stt) return send(res, 501, { error: 'transcription_not_configured', message: 'no local STT backend configured' });

        let audio;
        try {
          audio = await readRawBody(req);
        } catch (err) {
          return send(res, 400, { error: 'bad_request', message: err.message });
        }
        if (!audio || audio.length === 0) return send(res, 400, { error: 'bad_request', message: 'empty audio body' });

        const mimeType = req.headers['content-type'] || 'application/octet-stream';
        const filename = (req.headers['x-filename'] || 'audio').toString().replace(/[^\w.-]/g, '_');

        let text;
        try {
          text = await stt.transcribe({ audio, filename, mimeType });
        } catch (err) {
          if (err instanceof SttUnavailableError) {
            audit.append({ actor, task: 'transcribe', model: config.stt.model, action: 'stt_unavailable', input: `audio:${audio.length}b` });
            return send(res, 503, { error: 'stt_unavailable', message: 'local STT backend is unavailable' });
          }
          throw err;
        }

        const record = audit.append({
          actor,
          task: 'transcribe',
          model: config.stt.model,
          action: 'transcribed',
          input: `audio:${audio.length}b`,
          output: text,
        });

        // Phase 1: VERBATIM transcript only — NOT a generative clinical summary (that is Phase 2).
        return send(res, 200, {
          transcript: text,
          audit_id: record.id,
          review_required: true,
          note: 'Verbatim transcript — verify against what was said. Not a clinical summary.',
        });
      }

      if (req.method === 'POST' && url.pathname === '/v1/note') {
        const actor = authenticate(req, config.apiKeys);
        if (!actor) return send(res, 401, { error: 'unauthorized', message: 'valid Bearer key required' });

        const rl = limiter.check(actor);
        if (!rl.ok) {
          audit.append({ actor, task: 'soap_note', model: config.llm.model, action: 'rate_limited' });
          return send(res, 429, { error: 'rate_limited', message: 'too many requests', retry_after_s: rl.retryAfter }, { 'retry-after': String(rl.retryAfter) });
        }
        // PHASE 2 = medical-device-class. Disabled by default; fail closed.
        if (!config.phase2Enabled) {
          return send(res, 501, {
            error: 'phase2_disabled',
            message: 'Generative SOAP summarisation is a Phase-2 medical-device-class feature and is disabled. Not for clinical use without conformity assessment.',
          });
        }

        let body;
        try {
          body = await readBody(req);
        } catch (err) {
          return send(res, 400, { error: 'bad_request', message: err.message });
        }
        const transcript = typeof body.transcript === 'string' ? body.transcript : '';
        if (!transcript.trim()) return send(res, 400, { error: 'bad_request', message: 'transcript (string) is required' });
        if (detectInjection(transcript)) {
          audit.append({ actor, task: 'soap_note', model: config.llm.model, action: 'refused', input: `transcript:${transcript.length}c` });
          return send(res, 422, { error: 'refused', code: 'prompt_injection', message: 'transcript contains an instruction-override pattern' });
        }

        let content;
        try {
          content = await llm.chat({ system: SOAP_SYSTEM_PROMPT, user: buildSoapPrompt(transcript), schema: SOAP_NOTE_SCHEMA });
        } catch (err) {
          if (err instanceof LlmUnavailableError) {
            audit.append({ actor, task: 'soap_note', model: config.llm.model, action: 'llm_unavailable', input: `transcript:${transcript.length}c` });
            return send(res, 503, { error: 'llm_unavailable', message: 'local LLM backend is unavailable' });
          }
          throw err;
        }

        const parsed = parseJson(content);
        const validated = parsed.ok ? validateSoapNote(parsed.value, transcript) : parsed;
        if (!validated.ok) {
          // Grounding failure (a quote not in the transcript) lands here — a caught fabrication.
          audit.append({ actor, task: 'soap_note', model: config.llm.model, action: 'rejected_output', input: `transcript:${transcript.length}c`, output: content });
          return send(res, 502, { error: 'invalid_output', messages: validated.errors });
        }

        const record = audit.append({
          actor,
          task: 'soap_note',
          model: config.llm.model,
          action: 'summarised',
          input: `transcript:${transcript.length}c`,
          output: JSON.stringify(validated.value),
        });

        return send(res, 200, {
          note: validated.value,
          audit_id: record.id,
          review_required: true,
          disclaimer:
            'Phase-2 experimental generative summary — NOT a cleared medical device and NOT for clinical use ' +
            'without conformity assessment. Every line must be verified against the transcript and the patient.',
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

export function startServer({ config, llm, audit, stt, limiter }) {
  const server = createServer(createApp({ config, llm, audit, stt, limiter }));
  return new Promise((resolve) => {
    server.listen(config.port, () => resolve(server));
  });
}
