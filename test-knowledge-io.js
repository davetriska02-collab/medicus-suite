// Medicus Suite — Knowledge IO round-trip tests
// Run with: node test-knowledge-io.js
//
// Uses the same in-memory chrome.storage.local mock as test-backup-keys.js.
// Guards: export → import round-trip, whitelist sanitisation on import,
// rejection of malformed backups, and that noticeAcknowledgedAt (per-install
// attestation) never survives an import.

'use strict';

const store = {};
global.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const out = {};
        ks.forEach(k => { if (k in store) out[k] = store[k]; });
        return out;
      },
      async set(obj) { Object.assign(store, obj); },
    },
  },
};

const { knowledgeExport, knowledgeImport } = require('./shared/io/knowledge-io.js');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}
function reset() { for (const k of Object.keys(store)) delete store[k]; }
async function throws(fn) { try { await fn(); return false; } catch (_) { return true; } }

(async () => {
  console.log('--- export → import round-trip ---');
  reset();
  const entry = {
    id: 'dn-spa', title: 'District nursing — SPA', category: 'contacts',
    body: 'Referrals for housebound patients.', phone: '01234 567890', url: '',
    tags: ['community'], source: 'manual', reviewed: true, reviewBy: '2026-12-01',
    updatedAt: '2026-06-10T10:00:00Z',
  };
  store['knowledge.items'] = [entry];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts & numbers' }];
  store['knowledge.config'] = { noticeAcknowledgedAt: '2026-06-01T09:00:00Z' };

  const exported = await knowledgeExport();
  check(exported.items.length === 1 && exported.items[0].id === 'dn-spa', 'items captured in export');
  check(exported.categories.length === 1, 'categories captured in export');
  check(exported.config.noticeAcknowledgedAt === '2026-06-01T09:00:00Z', 'config captured in export (local state)');

  reset(); // fresh install
  await knowledgeImport(exported);
  check(store['knowledge.items'].length === 1 && store['knowledge.items'][0].title === 'District nursing — SPA', 'items restored on import');
  check(store['knowledge.items'][0].reviewBy === '2026-12-01' && store['knowledge.items'][0].source === 'manual', 'entry fields survive round-trip');
  check(store['knowledge.categories'][0].id === 'contacts', 'categories restored on import');
  check(store['knowledge.config'].noticeAcknowledgedAt === undefined, 'noticeAcknowledgedAt NOT imported (per-install attestation)');

  console.log('\n--- import sanitisation ---');
  reset();
  check(await throws(() => knowledgeImport({
    items: [{ title: 'Crafted', category: 'referrals', url: 'javascript:alert(1)' }],
  })), 'javascript: url rejected loudly (not silently stripped)');

  reset();
  await knowledgeImport({
    items: [{ title: 'Crafted', category: 'referrals', smuggled: 'field', source: 'llm', reviewed: 'true' }],
  });
  const imported = store['knowledge.items'][0];
  check(!('smuggled' in imported), 'unknown fields stripped on import (whitelist rebuild)');
  check(imported.reviewed === false, 'non-boolean reviewed → false (AI entries stay flagged)');
  check(typeof imported.id === 'string' && imported.id.length > 0, 'missing id generated on import');

  reset();
  await knowledgeImport({ items: [
    { id: 'same', title: 'One', category: 'referrals' },
    { id: 'same', title: 'Two', category: 'referrals' },
  ]});
  const ids = store['knowledge.items'].map(e => e.id);
  check(new Set(ids).size === 2, 'duplicate ids in a backup are de-collided');

  console.log('\n--- malformed backups rejected ---');
  reset();
  check(await throws(() => knowledgeImport({ items: 'not-an-array' })), 'non-array items rejected');
  check(await throws(() => knowledgeImport({ items: [{ category: 'c' }] })), 'entry without title rejected');
  check(await throws(() => knowledgeImport({ categories: {} })), 'non-array categories rejected');
  check(await throws(() => knowledgeImport({ config: [] })), 'non-object config rejected');
  check(Object.keys(store).length === 0, 'no partial writes after rejected imports');

  await knowledgeImport({});  // no-op
  await knowledgeImport(null); // no-op
  check(Object.keys(store).length === 0, 'empty/null import is a no-op (no throw)');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
