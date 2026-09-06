// Medicus Suite — Knowledge shared-store sync tests
// Run with: node test-knowledge-sync.js
//
// Covers the Pete bug: import writes local only unless the live set is also
// pushed into practice-profile.json, after which a second context applying
// that profile sees the same items. Pure orchestration via injected deps
// (no real FileSystemFileHandle).

'use strict';

const store = {};
global.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    getManifest: () => ({ version: '3.260.0' }),
  },
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
        const out = {};
        ks.forEach((k) => {
          if (k in store) out[k] = store[k];
        });
        return out;
      },
      async set(obj) {
        Object.assign(store, obj);
      },
      async remove(keys) {
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach((k) => {
          delete store[k];
        });
      },
    },
  },
  notifications: { create: () => {} },
};

function reset() {
  for (const k of Object.keys(store)) delete store[k];
}

const KnowledgeUtils = require('./shared/knowledge-utils.js');
const { knowledgeExport, knowledgeImport } = require('./shared/io/knowledge-io.js');
const KnowledgeSync = require('./shared/io/knowledge-sync.js');

global.KnowledgeUtils = KnowledgeUtils;
global.knowledgeExport = knowledgeExport;
global.knowledgeImport = knowledgeImport;

const { sentinelImport } = require('./shared/io/sentinel-io.js');
const { receptionImport } = require('./shared/io/reception-io.js');
const { submissionsImport } = require('./shared/io/submissions-io.js');
const { slotCounterImport } = require('./shared/io/slot-counter-io.js');
const { capacityImport } = require('./shared/io/capacity-io.js');
const { referralsImport } = require('./shared/io/referrals-io.js');
const { requestMonitorImport } = require('./shared/io/request-monitor-io.js');
const TriageAlertIO = require('./shared/io/triage-alert-io.js');
const { problemDescriptionCleanupImport } = require('./shared/io/problem-description-cleanup-io.js');

global.sentinelImport = sentinelImport;
global.receptionImport = receptionImport;
global.submissionsImport = submissionsImport;
global.slotCounterImport = slotCounterImport;
global.capacityImport = capacityImport;
global.referralsImport = referralsImport;
global.requestMonitorImport = requestMonitorImport;
global.TriageAlertIO = TriageAlertIO;
global.problemDescriptionCleanupImport = problemDescriptionCleanupImport;

const PP = require('./shared/io/practice-profile.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

function makeSharedProfile(over) {
  return Object.assign(
    {
      format: 'medicus-suite-practice-profile',
      formatVersion: 2,
      profileVersion: '2026-09-06.1',
      profileLabel: 'Test Practice',
      publishedAt: '2026-09-06T00:00:00.000Z',
      publishedBy: 'admin@example.com',
      apply: { modules: { sentinel: 'merge' } },
      envelope: {
        modules: {
          sentinel: { rules: {}, config: {} },
        },
      },
    },
    over || {}
  );
}

function makeFakeHandle({ text, permission } = {}) {
  let fileText = text == null ? '' : text;
  return {
    async queryPermission() {
      return permission || 'granted';
    },
    async requestPermission() {
      return permission || 'granted';
    },
    async getFile() {
      return { text: async () => fileText };
    },
    async createWritable() {
      return {
        async write(str) {
          fileText = str;
        },
        async close() {},
      };
    },
    _getText: () => fileText,
  };
}

const SAMPLE_ENTRY = {
  id: 'dn-spa',
  title: 'District nursing — SPA',
  category: 'contacts',
  body: 'Referrals for housebound patients.',
  phone: '01234 567890',
  url: '',
  tags: ['community'],
  source: 'manual',
  reviewed: true,
  reviewBy: '2026-12-01',
  updatedAt: '2026-09-06T10:00:00Z',
};

(async () => {
  console.log('--- extractKnowledgeFromParsed ---');
  const pack = KnowledgeUtils.extractKnowledgeFromParsed({
    entries: [{ title: 'A', category: 'referrals' }],
  });
  check(pack.mode === 'merge' && pack.items.length === 1, 'LLM pack { entries } → merge');
  check(
    KnowledgeUtils.extractKnowledgeFromParsed([{ title: 'A', category: 'referrals' }]).mode === 'merge',
    'bare array → merge'
  );
  const live = KnowledgeUtils.extractKnowledgeFromParsed(
    KnowledgeUtils.wrapLiveKnowledge([SAMPLE_ENTRY], [{ id: 'contacts', name: 'Contacts' }], '2026-09-06T12:00:00Z')
  );
  check(live.mode === 'replace' && live.items[0].id === 'dn-spa', 'live-set backup → replace');
  const env = KnowledgeUtils.extractKnowledgeFromParsed({
    format: 'medicus-suite-backup',
    modules: { knowledge: { items: [SAMPLE_ENTRY], categories: [] } },
  });
  check(env.mode === 'replace' && env.items[0].id === 'dn-spa', 'suite envelope → replace');
  check(!!KnowledgeUtils.extractKnowledgeFromParsed({ foo: 1 }).error, 'unrecognised shape is an error');
  check(
    KnowledgeUtils.extractKnowledgeFromParsed({ title: 'One', category: 'referrals' }).items.length === 1,
    'single entry object → one-item merge'
  );

  console.log('\n--- describeSyncStatus ---');
  check(
    KnowledgeSync.describeSyncStatus({ hasHandle: false }).kind === 'local',
    'no handle → local-only copy'
  );
  check(
    KnowledgeSync.describeSyncStatus({ hasHandle: true, lastResult: 'pushed' }).kind === 'shared',
    'handle + pushed → shared'
  );
  check(
    KnowledgeSync.describeSyncStatus({ hasHandle: false, lastPulledVersion: '2026-09-06.2' }).kind === 'shared-ro',
    'pulled without write handle → read-only shared'
  );
  check(
    KnowledgeSync.describeSyncStatus({ hasHandle: true, lastResult: 'permission-not-granted' }).kind === 'warn',
    'lapsed grant → reconnect warning'
  );

  console.log('\n--- buildKnowledgeContribution ---');
  check(
    KnowledgeSync.buildKnowledgeContribution(null, { items: [SAMPLE_ENTRY] }, { KU: KnowledgeUtils }).skipReason ===
      'no-shared-profile',
    'no shared profile and allowCreate off → no-shared-profile'
  );

  const created = KnowledgeSync.buildKnowledgeContribution(
    null,
    { items: [SAMPLE_ENTRY], categories: [{ id: 'contacts', name: 'Contacts' }] },
    { KU: KnowledgeUtils, allowCreate: true, version: '2026-09-06.1', now: new Date('2026-09-06T12:00:00Z') }
  );
  check(created.changed === true, 'allowCreate bootstraps a knowledge-only profile');
  check(created.json.apply.modules.knowledge === 'replace', 'new profile applies knowledge as replace');
  check(created.json.envelope.modules.knowledge.items[0].id === 'dn-spa', 'bootstrapped profile carries imported items');
  check(!created.json.envelope.modules.knowledge.config, 'shared payload never includes knowledge.config');

  const existing = makeSharedProfile();
  const contrib = KnowledgeSync.buildKnowledgeContribution(
    existing,
    { items: [SAMPLE_ENTRY], categories: [{ id: 'contacts', name: 'Contacts & numbers' }] },
    { KU: KnowledgeUtils, version: '2026-09-06.2', now: new Date('2026-09-06T12:00:00Z') }
  );
  check(contrib.changed === true, 'writing knowledge into an existing profile → changed');
  check(contrib.json.apply.modules.knowledge === 'replace', 'existing profile gains knowledge: replace');
  check(contrib.json.apply.modules.sentinel === 'merge', 'other apply.modules modes are preserved');
  check(
    JSON.stringify(contrib.json.envelope.modules.sentinel) === JSON.stringify(existing.envelope.modules.sentinel),
    'every other module is carried forward byte-for-byte'
  );
  check(
    contrib.json.envelope.modules.knowledge.items[0].title === 'District nursing — SPA',
    'live set items land in the shared envelope'
  );

  const noop = KnowledgeSync.buildKnowledgeContribution(
    contrib.json,
    { items: contrib.json.envelope.modules.knowledge.items, categories: contrib.json.envelope.modules.knowledge.categories },
    { KU: KnowledgeUtils, version: '2026-09-06.3' }
  );
  check(noop.skipReason === 'no-change', 'identical live set + already replace → no-change');

  const dirty = KnowledgeSync.buildKnowledgeContribution(
    existing,
    {
      items: [{ title: 'Crafted', category: 'referrals', smuggled: 'nope', url: 'https://example.nhs.uk' }],
      categories: [{ id: 'referrals', name: 'Referral criteria' }],
      config: { noticeAcknowledgedAt: '2026-01-01T00:00:00Z' },
    },
    { KU: KnowledgeUtils, version: '2026-09-06.4', now: new Date('2026-09-06T13:00:00Z') }
  );
  check(!('smuggled' in dirty.json.envelope.modules.knowledge.items[0]), 'unknown fields stripped before share');
  check(!dirty.json.envelope.modules.knowledge.config, 'noticeAcknowledgedAt never written to the shared store');

  console.log('\n--- import → shared store → second context ---');
  reset();
  await knowledgeImport({
    items: [SAMPLE_ENTRY],
    categories: [{ id: 'contacts', name: 'Contacts & numbers' }],
  });
  check(store['knowledge.items'][0].id === 'dn-spa', 'context A: import writes local storage');

  const fromA = await knowledgeExport();
  const sharedAfterImport = KnowledgeSync.buildKnowledgeContribution(makeSharedProfile(), fromA, {
    KU: KnowledgeUtils,
    version: '2026-09-06.5',
    now: new Date('2026-09-06T14:00:00Z'),
  });
  check(sharedAfterImport.changed === true, 'context A: import is written into the shared profile payload');
  check(
    sharedAfterImport.json.envelope.modules.knowledge.items.some((e) => e.id === 'dn-spa'),
    'shared store contains the imported entry'
  );

  reset(); // context B — fresh browser profile, empty local Knowledge
  check(!store['knowledge.items'], 'context B starts with no local Knowledge');
  const applyB = await PP.applyProfile(sharedAfterImport.json);
  check(applyB.modulesApplied.includes('knowledge'), 'context B: applyProfile applies knowledge');
  check(
    Array.isArray(store['knowledge.items']) && store['knowledge.items'].some((e) => e.id === 'dn-spa'),
    'context B sees the imported District nursing entry'
  );
  check(
    store['knowledge.items'][0].title === 'District nursing — SPA',
    'context B title matches the live set Pete uploaded'
  );
  check(
    store['knowledge.categories'].some((c) => c.id === 'contacts'),
    'context B receives categories from the shared store'
  );
  check(!store['knowledge.config'] || !store['knowledge.config'].noticeAcknowledgedAt, 'context B does not inherit a notice attestation');

  console.log('\n--- edit on A reaches B ---');
  reset();
  const edited = Object.assign({}, SAMPLE_ENTRY, {
    title: 'District nursing — SPA (updated hours)',
    updatedAt: '2026-09-06T15:00:00Z',
  });
  store['knowledge.items'] = [edited];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts & numbers' }];
  const afterEdit = KnowledgeSync.buildKnowledgeContribution(sharedAfterImport.json, await knowledgeExport(), {
    KU: KnowledgeUtils,
    version: '2026-09-06.6',
    now: new Date('2026-09-06T15:00:00Z'),
  });
  reset();
  await PP.applyProfile(afterEdit.json);
  check(
    store['knowledge.items'][0].title === 'District nursing — SPA (updated hours)',
    'an individual edit on A replaces the live set on B'
  );

  console.log('\n--- applyKnowledgeFromProfile (replace only) ---');
  reset();
  const spec = KnowledgeSync.knowledgeApplySpec(afterEdit.json);
  check(spec && spec.mode === 'replace' && spec.items[0].id === 'dn-spa', 'knowledgeApplySpec reads replace + items');
  const pulled = await KnowledgeSync.applyKnowledgeFromProfile(afterEdit.json, {
    knowledgeImport,
    getState: async () => null,
    setState: async () => {},
  });
  check(pulled.applied === true, 'replace-mode profile applies via applyKnowledgeFromProfile');
  check(store['knowledge.items'][0].id === 'dn-spa', 'pull writes the shared items into local storage');

  const mergeProfile = makeSharedProfile({
    apply: { modules: { knowledge: 'merge' } },
    envelope: { modules: { knowledge: { items: [SAMPLE_ENTRY] } } },
  });
  const skippedMerge = await KnowledgeSync.applyKnowledgeFromProfile(mergeProfile, {
    knowledgeImport,
    getState: async () => null,
    setState: async () => {},
  });
  check(skippedMerge.reason === 'merge-deferred', 'tab pull defers merge-mode profiles to the existing apply path');

  console.log('\n--- runKnowledgeSync orchestration ---');
  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts & numbers' }];

  const noHandle = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => null,
    getLocalKnowledge: knowledgeExport,
    KU: KnowledgeUtils,
  });
  check(noHandle.reason === 'no-handle', 'no FileSystemFileHandle → no-handle (local-only fallback)');

  const handle = makeFakeHandle({ text: JSON.stringify(makeSharedProfile()) });
  const wrote = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => handle,
    readHandleText: async (h) => (await h.getFile()).text(),
    writeHandleText: async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    },
    getLocalKnowledge: knowledgeExport,
    KU: KnowledgeUtils,
    now: () => new Date('2026-09-06T16:00:00Z'),
    getState: async () => null,
    setState: async () => {},
  });
  check(wrote.wrote === true, 'granted handle writes the live set into the shared file');
  const written = JSON.parse(handle._getText());
  check(written.apply.modules.knowledge === 'replace', 'written file applies knowledge as replace');
  check(
    written.envelope.modules.knowledge.items.some((e) => e.id === 'dn-spa'),
    'written file contains the imported entry'
  );

  const denied = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => makeFakeHandle({ permission: 'prompt' }),
    getLocalKnowledge: knowledgeExport,
    KU: KnowledgeUtils,
  });
  check(denied.reason === 'permission-not-granted', 'lapsed grant without requestPermission → permission-not-granted');

  console.log('\n--- version gates ---');
  check(KnowledgeSync.PROFILE_FILE_KEY === 'profileFile', 'Knowledge reads/writes profileFile only');
  check(KnowledgeSync.canPushAgainstShared(makeSharedProfile(), null).ok === true, 'first push onto profile without knowledge is allowed');
  const sharedNewer = makeSharedProfile({
    profileVersion: '2026-09-06.5',
    apply: { modules: { sentinel: 'merge', knowledge: 'replace' } },
    envelope: {
      modules: {
        sentinel: { rules: {}, config: {} },
        knowledge: { items: [SAMPLE_ENTRY], categories: [{ id: 'contacts', name: 'Contacts' }] },
      },
    },
  });
  check(
    KnowledgeSync.canPushAgainstShared(sharedNewer, { lastPulledVersion: '2026-09-06.1' }).reason === 'conflict',
    'stale lastPulled vs newer shared → conflict'
  );
  check(
    KnowledgeSync.canPushAgainstShared(sharedNewer, null).reason === 'conflict',
    'never-pulled must not overwrite a profile that already has knowledge'
  );
  check(
    KnowledgeSync.shouldApplyIncomingVersion('2026-09-06.1', { lastPulledVersion: '2026-09-06.5' }).reason ===
      'older-version',
    'older incoming vs lastPulled → older-version'
  );
  check(
    KnowledgeSync.shouldApplyIncomingVersion('2026-09-06.5', { lastPulledVersion: '2026-09-06.5' }).reason ===
      'already-applied',
    'same version → already-applied'
  );
  check(
    KnowledgeSync.shouldApplyIncomingVersion('2026-09-06.6', { lastPulledVersion: '2026-09-06.5' }).apply === true,
    'newer incoming applies'
  );
  check(KnowledgeSync.shouldSkipKnowledgeReload('abc') === true, 'editingId set → skip reload');
  check(KnowledgeSync.shouldSkipKnowledgeReload(null) === false, 'not editing → allow reload');

  reset();
  store['knowledge.items'] = [Object.assign({}, SAMPLE_ENTRY, { title: 'LOCAL STALE' })];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts' }];
  const conflictHandle = makeFakeHandle({ text: JSON.stringify(sharedNewer) });
  const clobbered = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => conflictHandle,
    readHandleText: async (h) => (await h.getFile()).text(),
    writeHandleText: async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    },
    getLocalKnowledge: knowledgeExport,
    KU: KnowledgeUtils,
    now: () => new Date('2026-09-06T17:00:00Z'),
    getState: async () => ({ lastPulledVersion: '2026-09-06.1' }),
    setState: async () => {},
  });
  check(clobbered.reason === 'conflict', 'stale local push must not clobber newer shared');
  check(
    JSON.parse(conflictHandle._getText()).profileVersion === '2026-09-06.5',
    'conflict leaves the newer shared file untouched'
  );
  check(
    JSON.parse(conflictHandle._getText()).envelope.modules.knowledge.items[0].title === 'District nursing — SPA',
    'conflict does not write the stale local title'
  );

  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts' }];
  const olderIncoming = makeSharedProfile({
    profileVersion: '2026-09-06.1',
    apply: { modules: { knowledge: 'replace' } },
    envelope: {
      modules: {
        knowledge: {
          items: [Object.assign({}, SAMPLE_ENTRY, { id: 'old-peer', title: 'Should not apply' })],
          categories: [],
        },
      },
    },
  });
  const skipOld = await KnowledgeSync.applyKnowledgeFromProfile(olderIncoming, {
    knowledgeImport,
    getState: async () => ({ lastPulledVersion: '2026-09-06.5' }),
    setState: async () => {},
  });
  check(skipOld.reason === 'older-version', 'older incoming must not apply');
  check(store['knowledge.items'][0].id === 'dn-spa', 'older incoming leaves local items in place');

  console.log('\n--- runKnowledgeSync write → second context ---');
  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts & numbers' }];
  const syncHandle = makeFakeHandle({ text: JSON.stringify(makeSharedProfile()) });
  const syncState = {};
  const wroteSync = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => syncHandle,
    readHandleText: async (h) => (await h.getFile()).text(),
    writeHandleText: async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    },
    getLocalKnowledge: knowledgeExport,
    KU: KnowledgeUtils,
    now: () => new Date('2026-09-06T18:00:00Z'),
    getState: async () => syncState,
    setState: async (patch) => Object.assign(syncState, patch),
  });
  check(wroteSync.wrote === true, 'context A: runKnowledgeSync writes the live set');
  const writtenSync = JSON.parse(syncHandle._getText());
  reset();
  check(!store['knowledge.items'], 'context B starts empty');
  const peerPull = await KnowledgeSync.applyKnowledgeFromProfile(writtenSync, {
    knowledgeImport,
    getState: async () => null,
    setState: async () => {},
  });
  check(peerPull.applied === true, 'context B: pull applies the written profile');
  check(
    Array.isArray(store['knowledge.items']) && store['knowledge.items'].some((e) => e.id === 'dn-spa'),
    'context B sees the same ids written by runKnowledgeSync'
  );

  console.log('\n--- empty items: [] clears peer ---');
  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts' }];
  const emptyProf = makeSharedProfile({
    profileVersion: '2026-09-06.9',
    apply: { modules: { knowledge: 'replace' } },
    envelope: { modules: { knowledge: { items: [] } } },
  });
  const cleared = await KnowledgeSync.applyKnowledgeFromProfile(emptyProf, {
    knowledgeImport,
    getState: async () => ({ lastPulledVersion: '2026-09-06.1' }),
    setState: async () => {},
  });
  check(cleared.applied === true, 'replace with items: [] applies');
  check(Array.isArray(store['knowledge.items']) && store['knowledge.items'].length === 0, 'empty items clears the peer');
  check(Array.isArray(store['knowledge.categories']), 'replace with omitted categories still sets categories');

  console.log('\n--- verify-failed / allowCreate only empty ---');
  check(KnowledgeSync.isEmptyProfileText('') === true, 'empty string is empty');
  check(KnowledgeSync.isEmptyProfileText('  \n') === true, 'whitespace-only is empty');
  check(KnowledgeSync.isEmptyProfileText('{') === false, 'corrupt JSON is not empty');
  const corruptHandle = makeFakeHandle({ text: '{not-json' });
  const verifyFail = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => corruptHandle,
    readHandleText: async (h) => (await h.getFile()).text(),
    writeHandleText: async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    },
    getLocalKnowledge: async () => ({ items: [SAMPLE_ENTRY], categories: [] }),
    KU: KnowledgeUtils,
    allowCreate: true,
    now: () => new Date('2026-09-06T19:00:00Z'),
    getState: async () => null,
    setState: async () => {},
  });
  check(verifyFail.reason === 'verify-failed', 'corrupt non-empty file → verify-failed even with allowCreate');
  check(corruptHandle._getText() === '{not-json', 'verify-failed must not overwrite the corrupt file');

  const emptyHandle = makeFakeHandle({ text: '' });
  const createdEmpty = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => emptyHandle,
    readHandleText: async (h) => (await h.getFile()).text(),
    writeHandleText: async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    },
    getLocalKnowledge: async () => ({
      items: [SAMPLE_ENTRY],
      categories: [{ id: 'contacts', name: 'Contacts' }],
    }),
    KU: KnowledgeUtils,
    allowCreate: true,
    now: () => new Date('2026-09-06T19:30:00Z'),
    getState: async () => null,
    setState: async () => {},
  });
  check(createdEmpty.wrote === true, 'allowCreate writes only when the file is empty/missing');
  check(JSON.parse(emptyHandle._getText()).envelope.modules.knowledge.items[0].id === 'dn-spa', 'bootstrapped empty file carries knowledge');

  console.log('\n--- edit-dirty skips reload ---');
  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  const whileEditing = await KnowledgeSync.applyKnowledgeFromProfile(sharedNewer, {
    isEditing: () => true,
    knowledgeImport,
    getState: async () => null,
    setState: async () => {},
  });
  check(whileEditing.reason === 'edit-dirty', 'apply while editing → edit-dirty');
  check(store['knowledge.items'][0].id === 'dn-spa', 'edit-dirty leaves local items untouched');
  const dirtyPull = await KnowledgeSync.pullSharedKnowledge({
    isEditing: () => true,
    loadHandle: async () => null,
    fetchProfile: async () => sharedNewer,
    knowledgeImport,
    getState: async () => null,
    setState: async () => {},
  });
  check(dirtyPull.reason === 'edit-dirty', 'pullSharedKnowledge short-circuits while editing');

  console.log('\n--- noticeAcknowledgedAt preserved on peer ---');
  reset();
  store['knowledge.config'] = { noticeAcknowledgedAt: '2026-02-02T00:00:00Z' };
  store['knowledge.items'] = [];
  store['knowledge.categories'] = [];
  const ackPull = await KnowledgeSync.applyKnowledgeFromProfile(sharedNewer, {
    knowledgeImport,
    getState: async () => null,
    setState: async () => {},
  });
  check(ackPull.applied === true, 'peer apply succeeds');
  check(
    store['knowledge.config'].noticeAcknowledgedAt === '2026-02-02T00:00:00Z',
    'noticeAcknowledgedAt is preserved on the peer'
  );

  console.log('\n--- LLM {entries} merge keeps priors ---');
  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts' }];
  store['knowledge.config'] = { noticeAcknowledgedAt: '2026-03-03T00:00:00Z' };
  const llmPack = KnowledgeUtils.extractKnowledgeFromParsed({
    entries: [
      {
        title: 'New clinic hours',
        category: 'referrals',
        body: 'Monday late clinic 18:00–20:00.',
      },
    ],
  });
  check(llmPack.mode === 'merge', 'LLM {entries} is merge, not replace');
  const taken = new Set(store['knowledge.items'].map((e) => e.id));
  const catIds = new Set(store['knowledge.categories'].map((c) => c.id));
  const categories = store['knowledge.categories'].slice();
  const toAdd = [];
  for (const c of llmPack.items) {
    if (KnowledgeUtils.findSimilar(c.title, [...store['knowledge.items'], ...toAdd]).length > 0) continue;
    const clean = KnowledgeUtils.sanitiseEntry(c);
    clean.source = 'llm';
    clean.reviewed = false;
    clean.id = KnowledgeUtils.generateEntryId(clean.title, taken);
    taken.add(clean.id);
    if (!catIds.has(clean.category)) {
      categories.push({ id: clean.category, name: 'Referrals' });
      catIds.add(clean.category);
    }
    toAdd.push(clean);
  }
  await chrome.storage.local.set({
    'knowledge.items': [...store['knowledge.items'], ...toAdd],
    'knowledge.categories': categories,
  });
  check(
    store['knowledge.items'].some((e) => e.id === 'dn-spa') && store['knowledge.items'].some((e) => e.title === 'New clinic hours'),
    'LLM merge keeps prior entries and adds the new one'
  );
  check(
    store['knowledge.config'].noticeAcknowledgedAt === '2026-03-03T00:00:00Z',
    'LLM merge does not wipe noticeAcknowledgedAt'
  );

  console.log('\n--- invalid entries fail push; share errors in English ---');
  const invalidBuilt = KnowledgeSync.buildKnowledgeContribution(
    makeSharedProfile(),
    { items: [{ title: '', category: 'referrals' }] },
    { KU: KnowledgeUtils, version: '2026-09-06.8' }
  );
  check(invalidBuilt.skipReason === 'invalid-entries', 'dropped invalid entries fail the push rather than silent success');
  check(invalidBuilt.dropped.length === 1, 'dropped count is surfaced');
  check(
    /Someone else updated/.test(KnowledgeSync.shareErrorText('stale-read')),
    'stale-read maps to plain English'
  );
  check(/changed since this computer/.test(KnowledgeSync.shareErrorText('conflict')), 'conflict maps to plain English');
  check(
    KnowledgeSync.describeSyncStatus({
      hasSharedProfile: true,
      hasHandle: false,
      localCount: 0,
      lastPulledVersion: null,
    }).kind === 'pending',
    'empty peer with a practice profile → do-not-reimport copy'
  );
  check(
    /do not re-import/i.test(KnowledgeSync.describeSyncStatus({ profilePending: true }).text),
    'pending copy tells Pete not to re-import'
  );

  console.log('\n--- stale-read retries once ---');
  reset();
  store['knowledge.items'] = [SAMPLE_ENTRY];
  const staleFile = makeSharedProfile({ profileVersion: '2026-09-06.1' });
  const staleHandle = makeFakeHandle({ text: JSON.stringify(staleFile) });
  let fetches = 0;
  const stale = await KnowledgeSync.runKnowledgeSync({
    loadHandle: async () => staleHandle,
    readHandleText: async (h) => (await h.getFile()).text(),
    writeHandleText: async (h, text) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
    },
    fetchProfile: async () => {
      fetches += 1;
      return makeSharedProfile({ profileVersion: '2026-09-06.99' });
    },
    getLocalKnowledge: knowledgeExport,
    KU: KnowledgeUtils,
    now: () => new Date('2026-09-06T20:00:00Z'),
    getState: async () => null,
    setState: async () => {},
  });
  check(stale.reason === 'stale-read', 'mismatched fetched vs handle version → stale-read after retry');
  check(fetches === 2, 'stale-read retries exactly once');
  check(JSON.parse(staleHandle._getText()).profileVersion === '2026-09-06.1', 'stale-read does not write');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
