// Medicus Suite — Local bits detector tests
// Run with: node test-local-bits.js

'use strict';

const mockStore = {};
global.chrome = {
  storage: {
    local: {
      get: async (keysOrKey) => {
        if (typeof keysOrKey === 'string') return { [keysOrKey]: mockStore[keysOrKey] };
        if (Array.isArray(keysOrKey)) {
          const out = {};
          for (const k of keysOrKey) if (mockStore[k] !== undefined) out[k] = mockStore[k];
          return out;
        }
        return { ...mockStore };
      },
      set: async (obj) => {
        Object.assign(mockStore, obj);
      },
    },
  },
  runtime: {
    getManifest: () => ({ version: '3.261.16' }),
    getURL: (p) => 'chrome-extension://testid/' + String(p).replace(/^\//, ''),
  },
};

const LB = require('./shared/local-bits.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

console.log('\n--- stamps ---');
assert(
  LB.readReleaseStamp({ format: 'medicus-suite-release', version: '3.262.0', ready: true }).version === '3.262.0',
  'release stamp: version + ready'
);
assert(LB.readReleaseStamp({ format: 'medicus-suite-release', version: '3.262.0', ready: true }).ready === true, 'release stamp ready true');
assert(
  LB.readReleaseStamp({ format: 'medicus-suite-release', version: '3.262.0', ready: false }).ready === false,
  'release stamp ready false (Pete mid-publish)'
);
assert(LB.readReleaseStamp({ format: 'nope', version: '3.262.0', ready: true }) === null, 'wrong format rejected');
assert(LB.readReleaseStamp({ format: 'medicus-suite-release', version: 'not-a-version', ready: true }) === null, 'bad version rejected');
assert(
  LB.readReleaseStamp({
    format: 'medicus-suite-release',
    version: '3.260.0',
    ready: true,
    allowDowngrade: true,
  }).allowDowngrade === true,
  'allowDowngrade is explicit true only'
);
assert(
  LB.readReleaseStamp({ format: 'medicus-suite-release', version: '3.260.0', ready: true, allowDowngrade: 'yes' })
    .allowDowngrade === false,
  'allowDowngrade string is not true'
);

assert(
  LB.readSyncStamp({ format: 'medicus-suite-sync-status', copiedVersion: '3.262.0', ok: true }).ready === true,
  'sync-status ok → ready'
);
assert(
  LB.readSyncStamp({ format: 'medicus-suite-sync-status', copiedVersion: '3.262.0', ok: false }).ready === false,
  'sync-status not ok → not ready'
);

assert(LB.readManifestStamp({ version: '3.261.16' }).source === 'manifest', 'manifest stamp');
assert(LB.readManifestStamp({ version: 'v3.261.16' }).version === '3.261.16', 'manifest strips v');

console.log('\n--- decide (no silent downgrade) ---');
const running = '3.261.16';
assert(LB.decide({ source: 'manifest', version: '3.261.16', ready: true }, running).status === 'current', 'same version → current');
assert(LB.decide({ source: 'suite-release', version: '3.262.0', ready: true }, running).status === 'ready', 'newer → ready');
assert(LB.decide({ source: 'suite-release', version: '3.262.0', ready: true }, running).shouldReload === true, 'newer → shouldReload');
assert(
  LB.decide({ source: 'suite-release', version: '3.260.0', ready: true }, running).status === 'older-ignored',
  'older stamp → older-ignored'
);
assert(
  LB.decide({ source: 'suite-release', version: '3.260.0', ready: true }, running).shouldReload === false,
  'older stamp must not reload'
);
assert(
  LB.decide({ source: 'suite-release', version: '3.260.0', ready: true, allowDowngrade: true }, running).status ===
    'ready',
  'older + allowDowngrade → ready (explicit only)'
);
assert(
  LB.decide({ source: 'suite-release', version: '3.262.0', ready: false }, running).status === 'not-ready',
  'ready:false blocks even a newer version'
);
assert(LB.decide(null, running).status === 'unknown', 'no stamp → unknown');
assert(LB.decide({ source: 'suite-release', version: '3.262.0', ready: true }, running).practiceManaged === true, 'release is practice-managed');
assert(LB.decide({ source: 'manifest', version: '3.262.0', ready: true }, running).practiceManaged === false, 'bare manifest is not practice-managed');

console.log('\n--- inspect via getURL (no UNC) ---');

function fetchMap(map) {
  return async (url) => {
    assert(String(url).startsWith('chrome-extension://'), 'fetch URL is chrome-extension:// (not file:/UNC)');
    const name = String(url).split('/').pop();
    if (!map[name]) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => map[name] };
  };
}

(async () => {
  const r1 = await LB.inspect({
    fetchImpl: fetchMap({
      'suite-release.json': { format: 'medicus-suite-release', version: '3.262.0', ready: true },
      'manifest.json': { version: '3.262.0' },
    }),
  });
  assert(r1.status === 'ready' && r1.source === 'suite-release', 'inspect prefers suite-release.json');
  assert(r1.shouldReload === true, 'inspect newer release → shouldReload');

  const r2 = await LB.inspect({
    fetchImpl: fetchMap({
      'suite-release.json': { format: 'medicus-suite-release', version: '3.262.0', ready: false },
      'manifest.json': { version: '3.262.0' },
    }),
  });
  assert(r2.status === 'not-ready', 'unready release does not fall through to disk manifest');

  const r3 = await LB.inspect({
    fetchImpl: fetchMap({
      'sync-status.json': { format: 'medicus-suite-sync-status', copiedVersion: '3.262.0', ok: true },
      'manifest.json': { version: '3.262.0' },
    }),
  });
  assert(r3.source === 'sync-status' && r3.status === 'ready', 'falls back to sync-status.json');

  const r4 = await LB.inspect({
    fetchImpl: fetchMap({
      'manifest.json': { version: '3.262.0' },
    }),
  });
  assert(r4.source === 'manifest' && r4.status === 'ready', 'falls back to disk manifest.json');

  const r5 = await LB.inspect({
    fetchImpl: fetchMap({
      'suite-release.json': { format: 'medicus-suite-release', version: '3.260.0', ready: true },
    }),
  });
  assert(r5.status === 'older-ignored' && r5.shouldReload === false, 'inspect refuses silent downgrade');

  const r6 = await LB.checkAndPersist({
    fetchImpl: fetchMap({
      'suite-release.json': { format: 'medicus-suite-release', version: '3.262.0', ready: true },
    }),
  });
  assert(r6.status === 'ready', 'checkAndPersist returns ready');
  const state = await LB.getState();
  assert(state.status === 'ready' && state.diskVersion === '3.262.0', 'persist writes suite.localBits.* (not suite.update.*)');
  assert(state.practiceManaged === true, 'practiceManaged persisted');
  assert(LB.isReloadAvailable(state) === true, 'isReloadAvailable true for ready+newer');
  assert(LB.isReloadAvailable({ status: 'older-ignored', diskVersion: '3.260.0', runningVersion: '3.261.16' }) === false, 'isReloadAvailable false for older');

  const src = require('fs').readFileSync(require('path').join(__dirname, 'shared', 'local-bits.js'), 'utf8');
  assert(!/file:\/\//.test(src), 'local-bits.js does not mention file://');
  assert(!/\\\\/.test(src), 'local-bits.js does not embed a UNC path');
  assert(!/writeFile|createWritable|showDirectoryPicker/.test(src), 'local-bits.js does not write the filesystem');
  assert(!/suite\.update\./.test(src), 'local-bits.js does not touch GitHub suite.update.* keys');

  const optHtml = require('fs').readFileSync(require('path').join(__dirname, 'options', 'options.html'), 'utf8');
  assert(
    /Each PC Load unpacked from a folder on that PC/.test(optHtml) || /local folder on that PC/.test(optHtml),
    'Options install copy tells Pete each PC loads from a LOCAL folder'
  );
  assert(
    !/Each PC points to the same shared folder/.test(optHtml),
    'Options no longer says every PC points at the shared folder as the default'
  );
  assert(/settings only/i.test(optHtml), 'Practice Profile card says settings only');
  assert(/does not copy the extension files/i.test(optHtml) || /not the extension files/i.test(optHtml), 'bits vs settings split is in Options');

  const sw = require('fs').readFileSync(require('path').join(__dirname, 'service-worker.js'), 'utf8');
  assert(/local-bits\.js/.test(sw), 'service worker importScripts local-bits.js');
  assert(/older-ignored/.test(sw) || /shouldReload/.test(sw), 'service worker honours LocalBits shouldReload / no-downgrade');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
