// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// GP Forge — test harness + a mock OpenAI-compatible LLM server. No real backend/GPU required.

import { createServer } from 'node:http';

export function harness() {
  let passed = 0;
  let failed = 0;
  return {
    check(cond, msg) {
      if (cond) {
        console.log(`  OK  ${msg}`);
        passed += 1;
      } else {
        console.error(`  FAIL  ${msg}`);
        failed += 1;
      }
    },
    finish() {
      console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed`);
      if (failed) process.exit(1);
    },
  };
}

// Mock OpenAI-compatible STT (/audio/transcriptions). transcribe: ({contentType,length}) => {status,body}
export function startMockStt({ text = 'This is a verbatim transcript.', transcribe } = {}) {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/audio/transcriptions') {
      const ct = req.headers['content-type'] || '';
      let size = 0;
      req.on('data', (c) => (size += c.length));
      req.on('end', () => {
        const result = transcribe ? transcribe({ contentType: ct, length: size }) : { status: 200, body: { text } };
        res.writeHead(result.status || 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result.body));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function defaultChat() {
  const content = JSON.stringify({
    title: 'Flu clinic invitation',
    body: 'Dear [PATIENT NAME], you are invited to our seasonal flu clinic. Please contact [PRACTICE NAME] to book a convenient time.',
    placeholders: ['[PATIENT NAME]', '[PRACTICE NAME]'],
  });
  return { status: 200, body: { choices: [{ message: { content } }] } };
}

// chat: (requestBody) => { status, body }  — override to simulate errors / bad output.
export function startMockLlm({ chat } = {}) {
  const responder = chat || defaultChat;
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/chat/completions') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const result = responder(body ? JSON.parse(body) : {});
        res.writeHead(result.status || 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result.body));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
