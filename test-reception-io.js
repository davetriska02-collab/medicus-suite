// Medicus Suite — Reception IO import-hardening tests
// Run with: node test-reception-io.js
//
// receptionImport is an attack surface: a crafted backup could try to smuggle
// malformed pathway content (rendered to reception staff) or silently flip
// the enable flags. These tests pin the validation and the preview warning.

'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
}

// Minimal chrome.storage mock (same shape as test-import-hardening.js).
const _store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const out = {};
        ks.forEach(k => { if (k in _store) out[k] = _store[k]; });
        return out;
      },
      async set(obj) { Object.assign(_store, obj); },
    },
  },
};

const { receptionImport, receptionExport } = require('./shared/io/reception-io.js');
const suiteEnv = require('./shared/io/suite-envelope.js');

function goodPathway(over) {
  return Object.assign({
    id: 'custom-test',
    title: 'Custom test',
    redFlags: [{ id: 'rf-1', ask: 'Severe difficulty breathing right now?', escalate: '999' }],
    questions: [{ id: 'q-1', ask: 'How long?', type: 'text' }],
  }, over || {});
}

async function expectReject(data, msgPart, label) {
  try {
    await receptionImport(data);
    check(false, `${label} (no error thrown)`);
  } catch (e) {
    check(String(e.message).includes(msgPart), `${label} — "${e.message}"`);
  }
}

(async () => {
  console.log('--- receptionImport: config validation ---');
  await expectReject({ config: [] }, 'must be an object', 'config array rejected');
  await expectReject({ config: { enabledPathways: { a: 'yes' } } }, 'booleans', 'non-boolean enable flags rejected');
  await expectReject({ config: { hiddenChipRules: ['x'] } }, 'booleans', 'array hiddenChipRules rejected');
  await expectReject({ config: { disclaimerAcceptedAt: 12345 } }, 'ISO datetime', 'numeric disclaimerAcceptedAt rejected');
  await expectReject({ config: { disclaimerAcceptedAt: 'yesterday' } }, 'ISO datetime', 'non-ISO disclaimerAcceptedAt rejected');

  await receptionImport({ config: { enabledPathways: { 'sore-throat': true }, disclaimerAcceptedAt: '2026-06-10T10:00:00Z', hiddenChipRules: {} } });
  check(_store['reception.config'].enabledPathways['sore-throat'] === true, 'valid config imported');

  // Unknown config fields are dropped, not stored.
  await receptionImport({ config: { enabledPathways: {}, sneaky: 'payload' } });
  check(!('sneaky' in _store['reception.config']), 'unknown config fields stripped on import');

  console.log('\n--- receptionImport: pathway validation ---');
  await expectReject({ customPathways: 'nope' }, 'array', 'non-array customPathways rejected');
  await expectReject({ customPathways: [goodPathway({ redFlags: [] })] }, 'red-flag', 'custom pathway without red flags rejected');
  await expectReject({ customPathways: [goodPathway({ questions: [{ id: 'q', ask: 'x', type: 'banana' }] })] }, 'type', 'invalid question type rejected');
  await expectReject({ pathwayOverrides: [] }, 'object', 'array pathwayOverrides rejected');
  await expectReject({ pathwayOverrides: { 'sore-throat': goodPathway({ id: 'other-id' }) } }, 'mismatch', 'override id mismatch rejected');

  const withJunk = goodPathway({ extraField: 'gone' });
  withJunk.redFlags[0].surprise = 'gone';
  await receptionImport({ customPathways: [withJunk] });
  const stored = _store['reception.customPathways'][0];
  check(!('extraField' in stored) && !('surprise' in stored.redFlags[0]), 'imported pathways whitelist-sanitised');

  console.log('\n--- export round-trip ---');
  const exported = await receptionExport();
  check(Array.isArray(exported.customPathways) && exported.customPathways.length === 1, 'export returns stored custom pathways');
  check(typeof exported.config === 'object', 'export returns config');

  console.log('\n--- previewEnvelope: enable-flag warning ---');
  const envEnable = suiteEnv.wrap('reception', {
    reception: {
      config: { enabledPathways: { 'sore-throat': true, 'headache': true } },
      customPathways: [goodPathway()],
      pathwayOverrides: {},
    },
  });
  let lines = suiteEnv.previewEnvelope(envEnable);
  let warn = lines.find(l => l.startsWith('WARNING') && l.includes('reception capture pathway'));
  check(!!warn && warn.includes('2'), 'preview WARNS when backup enables pathways');
  check(lines.some(l => l.startsWith('Reception: 1 custom pathway')), 'preview summarises custom/edited counts');

  const envOff = suiteEnv.wrap('reception', {
    reception: { config: { enabledPathways: {} }, customPathways: [], pathwayOverrides: {} },
  });
  lines = suiteEnv.previewEnvelope(envOff);
  check(!lines.some(l => l.startsWith('WARNING') && l.includes('reception')), 'no warning when nothing enabled');

  check(suiteEnv.VALID_SCOPES.includes('reception'), "'reception' registered in VALID_SCOPES");

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
