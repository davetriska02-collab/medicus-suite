// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — configuration loader. Validates env into a typed config object.
// Phase 1: administrative/documentation support only. No real patient data until DPIA + DCB0160 signed.

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return String(v).toLowerCase() === 'true' || v === '1';
}

function parseApiKeys(raw) {
  // "key1:alice,key2:bob" -> Map(key -> actor)
  const map = new Map();
  for (const pair of String(raw || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const idx = pair.indexOf(':');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const actor = pair.slice(idx + 1).trim();
    if (key && actor) map.set(key, actor);
  }
  return map;
}

export function loadConfig(env = process.env) {
  const cfg = {
    port: Number(env.GPF_PORT || 8089),
    apiKeys: parseApiKeys(env.GPF_API_KEYS),
    llm: {
      baseUrl: (env.GPF_LLM_BASE_URL || 'http://localhost:4000/v1').replace(/\/$/, ''),
      apiKey: env.GPF_LLM_API_KEY || '',
      model: env.GPF_MODEL || 'qwen3-30b',
      timeoutMs: Number(env.GPF_LLM_TIMEOUT_MS || 30000),
    },
    audit: {
      path: env.GPF_AUDIT_PATH || './data/audit.jsonl',
      storeContent: bool(env.GPF_AUDIT_STORE_CONTENT, false),
    },
    egress: {
      canaryHost: env.GPF_EGRESS_CANARY_HOST || '1.1.1.1',
      canaryPort: Number(env.GPF_EGRESS_CANARY_PORT || 443),
      allowOpen: bool(env.GPF_ALLOW_OPEN_EGRESS, false),
    },
    // Optional local speech-to-text (faster-whisper, OpenAI-compatible). Empty baseUrl = disabled.
    stt: {
      baseUrl: (env.GPF_STT_BASE_URL || '').replace(/\/$/, ''),
      apiKey: env.GPF_STT_API_KEY || '',
      model: env.GPF_STT_MODEL || 'whisper-1',
      timeoutMs: Number(env.GPF_STT_TIMEOUT_MS || 60000),
    },
  };

  const errors = [];
  if (!Number.isFinite(cfg.port) || cfg.port <= 0) errors.push('GPF_PORT must be a positive number');
  if (cfg.apiKeys.size === 0) errors.push('GPF_API_KEYS must define at least one key:actor pair');
  if (errors.length) throw new Error(`GP Forge config invalid:\n - ${errors.join('\n - ')}`);
  return cfg;
}
