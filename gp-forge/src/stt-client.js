// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — speech-to-text client (OpenAI-compatible /audio/transcriptions; e.g. faster-whisper).
//
// PHASE 1 = VERBATIM transcription only. This returns the STT engine's transcript unaltered; it does
// NOT summarise (generative summarisation into a record would be a Phase-2 medical device). The
// clinician verifies the transcript against what was said.

export class SttUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SttUnavailableError';
  }
}

// Build a multipart/form-data body (Buffer) for the OpenAI-style transcription endpoint.
function buildMultipart(boundary, { file, model }) {
  const CRLF = '\r\n';
  const head =
    `--${boundary}${CRLF}Content-Disposition: form-data; name="model"${CRLF}${CRLF}${model}${CRLF}` +
    `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${file.filename}"${CRLF}` +
    `Content-Type: ${file.mimeType}${CRLF}${CRLF}`;
  const tail = `${CRLF}--${boundary}--${CRLF}`;
  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  return Buffer.concat([Buffer.from(head, 'utf8'), data, Buffer.from(tail, 'utf8')]);
}

export function createSttClient({ baseUrl, apiKey, model = 'whisper-1', timeoutMs = 60000, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('No fetch implementation available (Node >=18 or inject fetchImpl)');

  async function transcribe({ audio, filename = 'audio', mimeType = 'application/octet-stream' }) {
    const boundary = '----gpf' + Math.random().toString(16).slice(2);
    const body = buildMultipart(boundary, { file: { filename, mimeType, data: audio }, model });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await doFetch(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${apiKey}` },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new SttUnavailableError(`STT backend unreachable: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status >= 500 || res.status === 404) throw new SttUnavailableError(`STT backend error ${res.status}`);
      throw new Error(`STT request rejected (${res.status})`);
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      const j = await res.json();
      return typeof j.text === 'string' ? j.text : String(j.text ?? '');
    }
    return await res.text();
  }

  async function ping() {
    try {
      const res = await doFetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
      return res.ok;
    } catch {
      return false;
    }
  }

  return { transcribe, ping };
}
