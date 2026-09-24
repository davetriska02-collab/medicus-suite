#!/usr/bin/env node
// Headless proof for the document catalogue.
//
// History, Examination, Impression, and Plan each open the organiser. Document
// search must be called with that heading's patient, context id, and
// context type. A field with no heading context must leave the footer gap
// and must not call document search.
//
// Not part of npm test (CI has no Chrome). Run:
//   node scripts/template-organiser-documents-harness.js

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PATIENT = '22222222-2222-4222-8222-222222222222';
const TOPIC = '11111111-1111-4111-8111-111111111111';
const ENTRY = '66666666-6666-4666-8666-666666666666';
const DOC = '77777777-7777-4777-8777-777777777777';
const TPL = '44444444-4444-4444-8444-444444444444';
const IDS = {
  history: 'aaaa1111-1111-4111-8111-111111111111',
  examination: 'bbbb2222-2222-4222-8222-222222222222',
  impression: 'cccc3333-3333-4333-8333-333333333333',
  plan: 'dddd4444-4444-4444-8444-444444444444',
};

const FILES = {
  '/shared/practice-packs.js': path.join(ROOT, 'shared/practice-packs.js'),
  '/shared/template-organiser-core.js': path.join(ROOT, 'shared/template-organiser-core.js'),
  '/shared/template-organiser-client.js': path.join(ROOT, 'shared/template-organiser-client.js'),
  '/content-scripts/template-organiser/template-organiser-canvas.js': path.join(
    ROOT,
    'content-scripts/template-organiser/template-organiser-canvas.js'
  ),
};

function pageHtml() {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>document catalogue harness</title></head>
<body>
<main id="host"></main>
<footer><button type="button" id="complete">Complete consultation</button></footer>
<pre id="result">PENDING</pre>
<script>
  window.chrome = {
    storage: {
      local: {
        get: function (key, cb) {
          const out = {};
          const keys = Array.isArray(key) ? key : typeof key === 'string' ? [key] : [];
          keys.forEach(function (k) {
            if (k === 'suite.ui.templateOrganiser') out[k] = true;
          });
          if (cb) cb(out);
        },
        set: function (_obj, cb) { if (cb) cb(); }
      }
    },
    runtime: {}
  };
</script>
<script src="/shared/practice-packs.js"></script>
<script>
  window.PracticePacks.remember('suite.ui.templateOrganiser', true);
</script>
<script src="/shared/template-organiser-core.js"></script>
<script src="/shared/template-organiser-client.js"></script>
<script src="/content-scripts/template-organiser/template-organiser-canvas.js"></script>
<script>
  const PATIENT = ${JSON.stringify(PATIENT)};
  const TOPIC = ${JSON.stringify(TOPIC)};
  const DOC = ${JSON.stringify(DOC)};
  const TPL = ${JSON.stringify(TPL)};
  const IDS = ${JSON.stringify(IDS)};
  const calls = [];
  let overview = { consultationTopics: [{ id: TOPIC, patientId: PATIENT, headings: [] }] };
  let draftHeadings = [];
  window.fetch = function (url) {
    const target = String(url);
    calls.push(target);
    let body = { items: [{ id: TPL, name: 'Asthma review' }] };
    if (target.indexOf('/encounter/overview/') !== -1) body = overview;
    else if (target.indexOf('/draft-consultation-topic/') !== -1) {
      body = { id: TOPIC, patientId: PATIENT, headings: draftHeadings };
    } else if (target.indexOf('/document/template/search/') !== -1) {
      body = {
        items: [],
        document: [{ id: DOC, name: 'Food bank letter' }],
        referralForm: [{ id: '88888888-8888-4888-8888-888888888888', name: 'Referral form' }]
      };
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async function () { return JSON.stringify(body); }
    });
  };

  function waitFor(pred) {
    return new Promise(function (resolve, reject) {
      var left = 40;
      function tick() {
        if (pred()) resolve();
        else if (left <= 0) reject(new Error('timed out'));
        else {
          left -= 1;
          setTimeout(tick, 25);
        }
      }
      tick();
    });
  }

  function mount(kind, withId) {
    const host = document.getElementById('host');
    host.innerHTML = '';
    const section = document.createElement('section');
    if (withId) section.id = 'heading-' + kind + '-' + IDS[kind];
    const heading = document.createElement('h2');
    heading.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
    const field = document.createElement('textarea');
    section.appendChild(heading);
    section.appendChild(field);
    host.appendChild(section);
    return field;
  }

  function fullOverview() {
    return {
      consultationTopics: [{
        id: TOPIC,
        patientId: PATIENT,
        headings: ['history', 'examination', 'impression', 'plan'].map(function (kind) {
          return { id: 'heading-' + kind + '-' + IDS[kind], title: kind.charAt(0).toUpperCase() + kind.slice(1) };
        })
      }]
    };
  }

  async function openOrganiser(field) {
    field.focus();
    const launch = document.getElementById('ms-toc-launch');
    if (!launch) {
      throw new Error(
        'launcher did not show ' +
          JSON.stringify({
            packs: !!window.PracticePacks,
            on: !!(window.PracticePacks && window.PracticePacks.peek('suite.ui.templateOrganiser')),
            core: !!window.TemplateOrganiserCore,
            client: !!window.TemplateOrganiserClient,
            canvas: !!window.__msTemplateOrganiserCanvas,
            path: location.pathname,
            host: location.hostname
          })
      );
    }
    launch.click();
    await waitFor(function () {
      const status = document.querySelector('#ms-toc-overlay .ms-toc-status');
      return document.getElementById('ms-toc-overlay') && (!status || status.textContent.indexOf('Reading') === -1);
    });
  }

  function closeOrganiser() {
    const close = document.getElementById('ms-toc-close');
    if (close) close.click();
  }

  async function run() {
    const lines = [];
    overview = fullOverview();
    for (const kind of ['history', 'examination', 'impression', 'plan']) {
      const before = calls.length;
      const field = mount(kind, true);
      await openOrganiser(field);
      const docsTab = document.querySelector('#ms-toc-overlay [data-surface="documents"]');
      docsTab.click();
      const want = '/clinical/data/document/template/search/' + PATIENT +
        '?contextId=' + IDS[kind] + '&contextType=consultation-topic-heading';
      const hit = calls.slice(before).find(function (url) { return url.indexOf(want) !== -1; });
      const hostOk = calls.slice(before).every(function (url) {
        return url.indexOf('https://560b6c.api.england.medicus.health/') === 0;
      });
      const card = document.querySelector('#ms-toc-overlay .ms-toc-card-title');
      lines.push(kind + ' url ' + (hit ? 'ok' : 'MISSING'));
      lines.push(kind + ' host ' + (hostOk ? 'ok' : 'BAD'));
      lines.push(kind + ' card ' + (card && card.textContent === 'Food bank letter' ? 'ok' : 'MISSING'));
      if (kind === 'history') {
        const launchEl = document.getElementById('ms-toc-launch');
        const complete = document.getElementById('complete');
        const l = launchEl ? launchEl.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
        const c = complete.getBoundingClientRect();
        const beside = l.right <= c.left + 4 || l.bottom <= c.top + 4;
        const corner = l.left > window.innerWidth - 280 && l.top > window.innerHeight - 80;
        lines.push('launcher beside complete ' + (beside && !corner ? 'ok' : 'MISSING'));
      }
      closeOrganiser();
      await waitFor(function () { return !document.getElementById('ms-toc-overlay'); });
    }

    const textOnly = mount('examination', false);
    overview = {
      consultationTopics: [{
        id: TOPIC,
        patientId: PATIENT,
        headings: [{ id: IDS.examination, title: 'Examination' }]
      }]
    };
    const beforeKind = calls.length;
    await openOrganiser(textOnly);
    const examWant = '/document/template/search/' + PATIENT + '?contextId=' + IDS.examination + '&contextType=consultation-topic-heading';
    const examHit = calls.slice(beforeKind).some(function (url) { return url.indexOf(examWant) !== -1; });
    lines.push('examination title row ' + (examHit ? 'ok' : 'MISSING'));
    closeOrganiser();
    await waitFor(function () { return !document.getElementById('ms-toc-overlay'); });

    const bare = mount('history', false);
    overview = { consultationTopics: [{ id: TOPIC, patientId: PATIENT, headings: [] }] };
    const beforeGap = calls.length;
    await openOrganiser(bare);
    const templateCard = document.querySelector('#ms-toc-overlay .ms-toc-card-title');
    lines.push('templates still list ' + (templateCard && templateCard.textContent === 'Asthma review' ? 'ok' : 'MISSING'));
    document.querySelector('#ms-toc-overlay [data-surface="documents"]').click();
    const gap = document.querySelector('#ms-toc-overlay .ms-toc-footer .ms-toc-gap');
    const gapText = gap ? gap.textContent : '';
    const searched = calls.slice(beforeGap).some(function (url) {
      return url.indexOf('/document/template/search/') !== -1;
    });
    const docCard = document.querySelector('#ms-toc-overlay .ms-toc-card');
    lines.push('footer gap ' + (gap && gapText.indexOf('Nothing was read') !== -1 ? 'ok' : 'MISSING ' + gapText));
    lines.push('no document search ' + (searched ? 'CALLED' : 'ok'));
    lines.push('no document card ' + (docCard ? 'SHOWN' : 'ok'));
    closeOrganiser();
    await waitFor(function () { return !document.getElementById('ms-toc-overlay'); });

    draftHeadings = [{ id: IDS.history, title: 'History' }];
    overview = { consultationTopics: [{ id: TOPIC, patientId: PATIENT, headings: [] }] };
    const fromDraft = mount('history', false);
    const beforeDraft = calls.length;
    await openOrganiser(fromDraft);
    document.querySelector('#ms-toc-overlay [data-surface="documents"]').click();
    const draftWant = '/document/template/search/' + PATIENT + '?contextId=' + IDS.history + '&contextType=consultation-topic-heading';
    const draftHit = calls.slice(beforeDraft).some(function (url) { return url.indexOf(draftWant) !== -1; });
    const draftCard = document.querySelector('#ms-toc-overlay .ms-toc-card-title');
    lines.push('draft heading search ' + (draftHit ? 'ok' : 'MISSING'));
    lines.push('draft heading card ' + (draftCard && draftCard.textContent === 'Food bank letter' ? 'ok' : 'MISSING'));
    document.getElementById('result').textContent = lines.join('\\n');
  }

  run().catch(function (err) {
    document.getElementById('result').textContent = 'HARNESS ERROR ' + (err && err.message ? err.message : err);
  });
</script>
</body>
</html>`;
}

function startServer() {
  const html = pageHtml();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://england.medicus.health');
    const file = FILES[url.pathname];
    if (file) {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.end(fs.readFileSync(file));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const n = probe.address().port;
      probe.close(() => resolve(n));
    });
    probe.on('error', reject);
  });
}

async function waitForJson(url) {
  let last = '';
  for (let i = 0; i < 40; i += 1) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return await resp.json();
      last = 'HTTP ' + resp.status;
    } catch (err) {
      last = err.message;
    }
    await sleep(100);
  }
  throw new Error('debug port not ready: ' + last);
}

function runChrome(port, debugPort) {
  const url = 'http://england.medicus.health:' + port + '/560b6c/clinical/encounter/overview/' + ENTRY;
  const chrome = process.env.CHROME_BIN || 'google-chrome';
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'toc-docs-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + userData,
      '--remote-debugging-port=' + debugPort,
      '--host-resolver-rules=MAP england.medicus.health 127.0.0.1',
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  let err = '';
  child.stderr.on('data', (chunk) => {
    err += chunk;
  });
  return { child, err: () => err, userData };
}

function cdp(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const done = pending.get(msg.id);
      pending.delete(msg.id);
      done(msg);
    }
  });
  return function send(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(method + ' timed out'));
        }
      }, 5000);
    });
  };
}

async function readResult(debugPort) {
  const targets = await waitForJson('http://127.0.0.1:' + debugPort + '/json/list');
  const page = (Array.isArray(targets) ? targets : []).find(
    (target) => target.type === 'page' && target.webSocketDebuggerUrl
  );
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const send = cdp(ws);
  let text = '';
  for (let i = 0; i < 80; i += 1) {
    const msg = await send('Runtime.evaluate', {
      expression: "document.getElementById('result') ? document.getElementById('result').textContent : ''",
      returnByValue: true,
    });
    text = msg.result && msg.result.result ? String(msg.result.result.value || '') : '';
    if (text && text !== 'PENDING') break;
    await sleep(150);
  }
  ws.close();
  return text;
}

(async () => {
  const server = await startServer();
  const port = server.address().port;
  const debugPort = await freePort();
  const chrome = runChrome(port, debugPort);
  let text = '';
  try {
    text = await readResult(debugPort);
  } finally {
    chrome.child.kill('SIGKILL');
    server.close();
    fs.rmSync(chrome.userData, { recursive: true, force: true });
  }
  console.log(text || '(no result)');
  const ok =
    text &&
    !/MISSING|CALLED|SHOWN|HARNESS ERROR|PENDING/.test(text) &&
    text.indexOf('history url ok') !== -1 &&
    text.indexOf('footer gap ok') !== -1;
  if (!ok) {
    console.error('harness failed');
    process.exit(1);
  }
  console.log('harness passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
