// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — OpenAI-compatible LLM client (talks to the LiteLLM gateway in front of Ollama/vLLM).
// Uses constrained decoding (response_format: json_schema) so machine-read output is schema-valid
// BY CONSTRUCTION. NB: constrained decoding guarantees FORMAT, not FACTS — semantic validation
// (validate.js) and the human review gate are what handle correctness.

export class LlmUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}

export function createLlmClient({ baseUrl, apiKey, model, timeoutMs = 30000, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('No fetch implementation available (Node >=18 or inject fetchImpl)');

  async function chat({ system, user, schema, temperature = 0.2 }) {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature,
    };
    if (schema) {
      // Constrained decoding. (vLLM ≥0.12 / LiteLLM normalise this to the backend's structured-output API.)
      body.response_format = { type: 'json_schema', json_schema: { name: 'gpf_output', schema, strict: true } };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      // Connection refused / DNS / timeout → backend is down → client should degrade gracefully.
      throw new LlmUnavailableError(`LLM backend unreachable: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status >= 500 || res.status === 404) {
        throw new LlmUnavailableError(`LLM backend error ${res.status}`);
      }
      throw new Error(`LLM request rejected (${res.status})`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('LLM response missing message content');
    return content;
  }

  async function ping() {
    try {
      const res = await doFetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
      return res.ok;
    } catch {
      return false;
    }
  }

  return { chat, ping };
}
