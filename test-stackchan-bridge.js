// Medicus Suite — StackChan presence-bridge tests
// Run with: node test-stackchan-bridge.js
//
// No hardware. Proves event → command mapping and that payloads never
// carry patient identifiers or free text.

'use strict';

const Bridge = require('./shared/stackchan-bridge.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

console.log('\n--- sanitize / fail-closed ---');
assert(Bridge.sanitizeCommand('alert') === 'alert', 'known command passes through');
assert(Bridge.sanitizeCommand('ALERT') === 'alert', 'command is case-insensitive');
assert(Bridge.sanitizeCommand('explode') === 'idle', 'unknown command → idle');
assert(Bridge.sanitizeCommand(null) === 'idle', 'null command → idle');
assert(Bridge.sanitizeCommand({ evil: true }) === 'idle', 'object command → idle');
assert(Bridge.sanitizeSeverity('red') === 'red', 'known severity passes');
assert(Bridge.sanitizeSeverity('neutral') === 'none', 'neutral severity → none');
assert(Bridge.sanitizeSeverity('critical') === 'none', 'unknown severity → none');
assert(Bridge.sanitizeEvent('sentinel-severity') === 'sentinel-severity', 'known event passes');
assert(Bridge.sanitizeEvent('patient.opened') === 'unknown', 'unknown event code → unknown');

console.log('\n--- Sentinel chip severity → command ---');
{
  const red = Bridge.mapSentinelEvent({ statuses: ['overdue', 'in_date'] });
  assert(red.command === 'alert' && red.severity === 'red', 'overdue (red) wins over in_date → alert');
  assert(red.event === Bridge.EVENTS.SENTINEL, 'sentinel event code');
}
{
  const amber = Bridge.mapSentinelEvent({ statuses: ['due_soon', 'achieved'] });
  assert(amber.command === 'wait' && amber.severity === 'amber', 'due_soon (amber) → wait');
}
{
  const green = Bridge.mapSentinelEvent({ statuses: ['in_date', 'achieved', 'vax_given'] });
  assert(green.command === 'calm' && green.severity === 'green', 'all-green chips → calm');
}
{
  const empty = Bridge.mapSentinelEvent({ statuses: [] });
  assert(empty.command === 'idle' && empty.severity === 'none', 'no chips → idle');
}
{
  const nav = Bridge.mapSentinelEvent({ unavailable: true, statuses: ['overdue'] });
  assert(nav.command === 'idle' && nav.severity === 'none', 'unavailable snapshot → idle (never keep previous red)');
}
{
  const fromChips = Bridge.mapSentinelEvent({
    chips: [
      { status: 'alert', drugName: 'MUST-NOT-LEAK', patientName: 'A. Patient' },
      { status: 'in_date', label: 'QOF' },
    ],
  });
  assert(fromChips.command === 'alert' && fromChips.severity === 'red', 'reads .status from chips, ignores names');
  assert(!('drugName' in fromChips) && !('patientName' in fromChips), 'mapped sentinel result has no chip fields');
}
{
  const mixed = Bridge.worstSeverityFromStatuses(['noted', 'no_data', 'caution', 'vax_due']);
  assert(mixed === 'amber', 'caution + vax_due → amber (no red)');
}
assert(Bridge.commandFromSeverity('red') === 'alert', 'red → alert');
assert(Bridge.commandFromSeverity('amber') === 'wait', 'amber → wait');
assert(Bridge.commandFromSeverity('green') === 'calm', 'green → calm');
assert(Bridge.commandFromSeverity('none') === 'idle', 'none → idle');

console.log('\n--- Request Monitor fresh work → command ---');
{
  const med = Bridge.mapRequestMonitorEvent({ buckets: ['medNew'] });
  assert(med.command === 'alert' && med.severity === 'red', 'new medical request → alert');
}
{
  const admin = Bridge.mapRequestMonitorEvent({ buckets: ['adminNew'] });
  assert(admin.command === 'listen' && admin.severity === 'red', 'new admin request → listen');
}
{
  const reply = Bridge.mapRequestMonitorEvent({ buckets: ['medReply'] });
  assert(reply.command === 'listen' && reply.severity === 'amber', 'reply only → listen / amber');
}
{
  const none = Bridge.mapRequestMonitorEvent({ buckets: [] });
  assert(none === null, 'no fresh buckets → do not send');
}
{
  const fromObj = Bridge.mapRequestMonitorEvent({
    freshByBucket: {
      medNew: { items: [{ patientName: 'MUST-NOT-READ', id: 'task-1' }] },
    },
  });
  assert(fromObj.command === 'alert', 'uses freshByBucket keys only');
  assert(!JSON.stringify(fromObj).includes('MUST-NOT-READ'), 'never copies item fields');
}

console.log('\n--- Companion role → command ---');
assert(Bridge.mapCompanionRole('clinic').command === 'idle', 'clinic → idle');
assert(Bridge.mapCompanionRole('reception').command === 'listen', 'reception → listen');
assert(Bridge.mapCompanionRole('triage').command === 'wait', 'triage → wait');
assert(Bridge.mapCompanionRole('nursing').command === 'calm', 'nursing → calm');
assert(Bridge.mapCompanionRole('wizard').command === 'idle', 'unknown role → idle');
assert(Bridge.mapCompanionRole('TRIAGE').event === Bridge.EVENTS.COMPANION, 'role map stamps companion event');

console.log('\n--- mapSuiteEvent router ---');
assert(
  Bridge.mapSuiteEvent({ source: 'sentinel', statuses: ['stale'] }).command === 'wait',
  'router: sentinel stale → wait'
);
assert(Bridge.mapSuiteEvent({ source: 'requestMonitor', buckets: ['medNew'] }).command === 'alert', 'router: RM');
assert(Bridge.mapSuiteEvent({ source: 'companion.role', role: 'nursing' }).command === 'calm', 'router: companion');
assert(
  Bridge.mapSuiteEvent({ source: 'options.test', command: 'celebrate' }).command === 'celebrate',
  'router: test face'
);
assert(
  Bridge.mapSuiteEvent({ source: 'options.test', command: 'open-mic' }).command === 'idle',
  'test face unknown cmd → idle'
);
assert(Bridge.mapSuiteEvent({ source: 'invented' }).command === 'idle', 'invented source → idle');
assert(Bridge.mapSuiteEvent(null).command === 'idle', 'null message → idle');

console.log('\n--- payload builder (no PHI) ---');
{
  const payload = Bridge.buildPayload({
    command: 'alert',
    event: 'sentinel-severity',
    severity: 'red',
    ts: 1700000000000,
    patientName: 'Jane Doe',
    // 943 476 5911 is Modulus-11 INVALID (same fixture as test-patient-alerts-core.js).
    // The payload test only needs a 10-digit lookalike to prove it never ships.
    nhsNumber: '943 476 5911',
    label: 'lithium overdue',
    chips: [{ drugName: 'lithium' }],
  });
  assert(payload.v === 1, 'protocol version 1');
  assert(payload.cmd === 'alert', 'cmd set');
  assert(payload.event === 'sentinel-severity', 'event set');
  assert(payload.severity === 'red', 'severity set');
  assert(payload.ts === 1700000000000, 'ts passed through when numeric');
  assert(Object.keys(payload).sort().join(',') === 'cmd,event,severity,ts,v', 'only v/cmd/event/severity/ts');
  assert(!Bridge.payloadHasForbiddenKeys(payload), 'no forbidden keys on the wire');
  const json = JSON.stringify(payload);
  assert(!/Jane|lithium|943|Doe|nhs/i.test(json), 'JSON has no name / NHS / drug text');
}
{
  const bad = Bridge.buildPayload({ command: 'launch-missiles', event: 'nope' });
  assert(bad.cmd === 'idle' && bad.event === 'unknown' && bad.severity === 'none', 'junk input → idle/unknown/none');
}

console.log('\n--- URL + headers ---');
assert(Bridge.normalizeBaseUrl('192.168.1.80') === 'http://192.168.1.80', 'bare LAN IP gets http://');
assert(Bridge.normalizeBaseUrl('http://192.168.1.80/') === 'http://192.168.1.80', 'trailing slash stripped');
assert(Bridge.normalizeBaseUrl('http://192.168.1.80:8080') === 'http://192.168.1.80:8080', 'port kept');
assert(Bridge.normalizeBaseUrl('https://user:pass@evil.example/') === '', 'URL with credentials rejected');
assert(Bridge.normalizeBaseUrl('javascript:alert(1)') === '', 'javascript: rejected');
assert(Bridge.normalizeBaseUrl('ftp://192.168.1.80') === '', 'non-http rejected');
assert(Bridge.originFromBaseUrl('http://10.0.0.5:80/foo') === 'http://10.0.0.5', 'origin is host only');
{
  const headers = Bridge.buildHeaders('  secret-token  ');
  assert(headers['Content-Type'] === 'application/json', 'JSON content type');
  assert(headers[Bridge.TOKEN_HEADER] === 'secret-token', 'token header trimmed');
  assert(!Bridge.buildHeaders('').hasOwnProperty(Bridge.TOKEN_HEADER), 'empty token omitted');
}
{
  const post = Bridge.buildPost(
    { baseUrl: 'http://192.168.0.12', token: 't' },
    Bridge.buildPayload({ command: 'calm', event: 'options.test', severity: 'green', ts: 1 })
  );
  assert(post.url === 'http://192.168.0.12/cmd', 'POST targets /cmd');
  assert(post.init.method === 'POST', 'method POST');
  const body = JSON.parse(post.init.body);
  assert(body.cmd === 'calm' && !body.token, 'body is the payload, not the token');
}
assert(Bridge.buildPost({ baseUrl: '' }, { cmd: 'idle' }) === null, 'empty URL → no post');
assert(Bridge.buildHealthGet({ baseUrl: 'http://192.168.0.12' }).url === 'http://192.168.0.12/health', 'GET /health');

console.log('\n--- shouldDispatch ---');
{
  const off = Bridge.sanitiseConfig({ enabled: false, baseUrl: 'http://192.168.1.9' });
  assert(off.enabled === false, 'default / explicit off');
  assert(Bridge.shouldDispatch(off, {}) === false, 'disabled → no dispatch');
  assert(Bridge.shouldDispatch(off, { isTest: true }) === true, 'Test face still fires when disabled');
}
{
  const on = Bridge.sanitiseConfig({
    enabled: true,
    baseUrl: 'http://192.168.1.9',
    respectQuiet: true,
    hookSentinel: true,
    hookCompanion: false,
  });
  assert(Bridge.shouldDispatch(on, { quiet: true }) === false, 'quiet mode blocks auto events');
  assert(Bridge.shouldDispatch(on, { quiet: true, isTest: true }) === true, 'Test face ignores quiet');
  assert(Bridge.shouldDispatch(on, { quiet: false, event: Bridge.EVENTS.SENTINEL }) === true, 'sentinel hook on');
  assert(Bridge.shouldDispatch(on, { quiet: false, event: Bridge.EVENTS.COMPANION }) === false, 'companion hook off');
}
{
  const noUrl = Bridge.sanitiseConfig({ enabled: true, baseUrl: 'not a url ://' });
  assert(noUrl.baseUrl === '', 'garbage URL sanitised to empty');
  assert(Bridge.shouldDispatch(noUrl, {}) === false, 'enabled-but-no-URL → no dispatch');
}

console.log('\n--- sanitiseConfig defaults ---');
{
  const d = Bridge.sanitiseConfig(null);
  assert(d.enabled === false, 'default OFF');
  assert(d.respectQuiet === true, 'default respect quiet');
  assert(d.hookSentinel === true, 'default sentinel hook on');
  assert(d.timeoutMs === 1500, 'default timeout 1500ms');
}
assert(Bridge.clampTimeout(50) === 250, 'timeout floor 250ms');
assert(Bridge.clampTimeout(99999) === 5000, 'timeout cap 5s');

console.log('\n--- firmware IG defaults (source) ---');
{
  const fs = require('fs');
  const path = require('path');
  const sketch = fs.readFileSync(path.join(__dirname, 'firmware/stackchan/stackchan.ino'), 'utf8');
  const ini = fs.readFileSync(path.join(__dirname, 'firmware/stackchan/platformio.ini'), 'utf8');
  assert(!/Camera\.begin\s*\(/.test(sketch), 'firmware never calls Camera.begin');
  assert(!/Mic\.begin\s*\(/.test(sketch), 'firmware never calls Mic.begin');
  assert(/STACKCHAN_CAMERA_ENABLED=0/.test(ini), 'PlatformIO camera default 0');
  assert(/STACKCHAN_MIC_ENABLED=0/.test(ini), 'PlatformIO mic default 0');
  assert(/#error "Camera must stay off/.test(sketch), 'compile fails if camera flag flipped on');
  assert(/#error "Mics must stay muted/.test(sketch), 'compile fails if mic flag flipped on');
  assert(/internal_mic = false/.test(sketch), 'M5Unified internal_mic forced false');
  assert(/camera\\":false/.test(sketch) && /mic\\":false/.test(sketch), 'health JSON reports camera/mic false');
}

console.log('\n--- chrome.storage get/setConfig ---');
{
  const store = {};
  global.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (obj) => {
          Object.assign(store, obj);
        },
      },
    },
  };
  (async () => {
    const before = await Bridge.getConfig();
    assert(before.enabled === false, 'getConfig default off when empty');
    const saved = await Bridge.setConfig({
      enabled: true,
      baseUrl: 'http://192.168.4.20',
      token: 'desk',
      hookRequestMonitor: false,
    });
    assert(saved.enabled === true && saved.baseUrl === 'http://192.168.4.20', 'setConfig persists enable + URL');
    assert(saved.hookRequestMonitor === false, 'hook flag stored');
    const again = await Bridge.getConfig();
    assert(again.token === 'desk', 'token round-trips');
    finish();
  })().catch((e) => {
    console.error('  FAIL  get/setConfig threw', e);
    failed++;
    finish();
  });
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
