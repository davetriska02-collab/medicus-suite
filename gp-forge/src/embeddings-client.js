// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — embeddings client (OpenAI-compatible /embeddings; e.g. TEI serving bge-m3, or Ollama).

export class EmbeddingsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EmbeddingsUnavailableError';
  }
}

export function createEmbeddingsClient({ baseUrl, apiKey, model = 'bge-m3', timeoutMs = 30000, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('No fetch implementation available (Node >=18 or inject fetchImpl)');

  async function embed(input) {
    const arr = Array.isArray(input) ? input : [input];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: arr }),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new EmbeddingsUnavailableError(`embeddings backend unreachable: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      if (res.status >= 500 || res.status === 404) throw new EmbeddingsUnavailableError(`embeddings backend error ${res.status}`);
      throw new Error(`embeddings request rejected (${res.status})`);
    }
    const data = await res.json();
    return (data.data || []).map((d) => d.embedding);
  }

  async function ping() {
    try {
      const res = await doFetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
      return res.ok;
    } catch {
      return false;
    }
  }

  return { embed, ping };
}
