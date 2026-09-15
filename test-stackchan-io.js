// Medicus Suite — StackChan backup IO tests
// Run with: node test-stackchan-io.js

'use strict';

const io = require('./shared/io/stackchan-io.js');
const suiteEnv = require('./shared/io/suite-envelope.js');
const Bridge = require('./shared/stackchan-bridge.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK    ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL  ${msg}`);
  }
}

check(
  typeof io.stackchanExport === 'function' && typeof io.stackchanImport === 'function',
  'exports stackchanExport/Import'
);
check(io.STACKCHAN_KEYS.includes('suite.stackchan'), 'covers suite.stackchan');
check(suiteEnv.VALID_SCOPES.includes('stackchan'), 'stackchan is a valid envelope scope');

{
  const env = suiteEnv.wrap('stackchan', { stackchan: { enabled: true, baseUrl: 'http://192.168.1.9' } }, '3.262.0');
  const lines = suiteEnv.previewEnvelope(env);
  check(
    lines.some((l) => /^StackChan:/.test(l) && /enabled/.test(l)),
    'previewEnvelope summarises StackChan'
  );
}

const store = {};
global.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const out = {};
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) if (store[k] !== undefined) out[k] = store[k];
        return out;
      },
      set: async (obj) => {
        Object.assign(store, obj);
      },
    },
  },
};

(async () => {
  await io.stackchanImport({
    enabled: true,
    baseUrl: 'http://10.0.0.8:8080',
    token: 'lan',
    hookCompanion: false,
  });
  const exported = await io.stackchanExport();
  check(exported.enabled === true, 'import then export: enabled');
  check(exported.baseUrl === 'http://10.0.0.8:8080', 'import then export: baseUrl');
  check(exported.token === 'lan', 'import then export: token');
  check(exported.hookCompanion === false, 'import then export: hook flag');
  check(exported.hookSentinel === true, 'missing hook defaults on');

  let threw = false;
  try {
    await io.stackchanImport({ enabled: 'yes' });
  } catch (_) {
    threw = true;
  }
  check(threw, 'rejects non-boolean enabled');

  const clean = Bridge.sanitiseConfig({ enabled: true, baseUrl: 'javascript:alert(1)', token: 12 });
  check(clean.baseUrl === '' && clean.token === '', 'sanitise drops script URL and non-string token');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
