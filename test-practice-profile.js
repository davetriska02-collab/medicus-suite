// Medicus Suite — Practice Profile v2 tests
// Run with: node test-practice-profile.js
//
// Tests applyProfile directly with constructed profile objects (no fetchProfile mock needed).
// Uses the same in-memory chrome.storage.local mock pattern as test-backup-keys.js.
// Requires the real IO modules so delegation runs for real.

'use strict';

// ── in-memory chrome.storage.local mock ──────────────────────────────────────
const store = {};
global.chrome = {
  runtime: {
    getURL: (path) => `chrome-extension://test/${path}`,
    getManifest: () => ({ version: '3.42.3' }),
  },
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        const out = {};
        ks.forEach(k => { if (k in store) out[k] = store[k]; });
        return out;
      },
      async set(obj) { Object.assign(store, obj); },
      async remove(keys) {
        const ks = Array.isArray(keys) ? keys : [keys];
        ks.forEach(k => { delete store[k]; });
      },
    },
  },
  notifications: { create: () => {} },
};

function reset() { for (const k of Object.keys(store)) delete store[k]; }

// ── Load IO modules as globals (simulating the importScripts / <script> pattern) ──
// The IO modules publish themselves onto `global` (which is `self` in Node tests
// because practice-profile.js uses _io() which checks global first).

const { knowledgeImport }      = require('./shared/io/knowledge-io.js');
const { receptionImport }      = require('./shared/io/reception-io.js');
const { sentinelImport }       = require('./shared/io/sentinel-io.js');
const { submissionsImport }    = require('./shared/io/submissions-io.js');
const { slotCounterImport }    = require('./shared/io/slot-counter-io.js');
const { capacityImport }       = require('./shared/io/capacity-io.js');
const { referralsImport }      = require('./shared/io/referrals-io.js');
const { requestMonitorImport } = require('./shared/io/request-monitor-io.js');
const TriageAlertIO            = require('./shared/io/triage-alert-io.js');
const KnowledgeUtils           = require('./shared/knowledge-utils.js');
const { problemDescriptionCleanupImport } = require('./shared/io/problem-description-cleanup-io.js');

// Inject as globals so practice-profile.js's _io() resolver can find them
global.knowledgeImport      = knowledgeImport;
global.receptionImport      = receptionImport;
global.sentinelImport       = sentinelImport;
global.submissionsImport    = submissionsImport;
global.slotCounterImport    = slotCounterImport;
global.capacityImport       = capacityImport;
global.referralsImport      = referralsImport;
global.requestMonitorImport = requestMonitorImport;
global.TriageAlertIO        = TriageAlertIO;
global.KnowledgeUtils       = KnowledgeUtils;
global.problemDescriptionCleanupImport = problemDescriptionCleanupImport;

const PP = require('./shared/io/practice-profile.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}
async function throws(fn) { try { await fn(); return false; } catch (_) { return true; } }

// Build a minimal valid profile object for testing
function makeProfile(over = {}) {
  return Object.assign({
    format:         'medicus-suite-practice-profile',
    profileVersion: 'v1.0',
    profileLabel:   'Test Practice',
    apply:          {},
    envelope:       { modules: {} },
  }, over);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

  // ── v1 back-compat: apply.modules as array + mode 'mergeMissing' → merge ─────
  console.log('\n--- v1 back-compat: array modules + mergeMissing ---');
  reset();
  const v1MergeProfile = makeProfile({
    profileVersion: 'v1.1',
    apply: {
      mode:    'mergeMissing',
      modules: ['sentinel', 'slots'],
    },
    envelope: {
      modules: {
        sentinel: {
          rules: { 'methotrexate': { snoozeUntil: null } },
          config: { density: 'compact' },
        },
        slots: {
          hiddenTypes: ['admin'],
          alertRules:  [{ id: 'r1', threshold: 10 }],
        },
      },
    },
  });

  // No existing data — merge should write both
  const r1 = await PP.applyProfile(v1MergeProfile);
  check(!r1.skipped, 'v1 merge profile not skipped');
  check(r1.modulesApplied.includes('sentinel'), 'v1 merge: sentinel applied');
  check(r1.modulesApplied.includes('slots'), 'v1 merge: slots applied');
  check(store['sentinel.config']?.density === 'compact', 'v1 merge: sentinel.config written when absent');
  check(store['slots.hiddenTypes']?.[0] === 'admin', 'v1 merge: slots.hiddenTypes written when absent');

  // Now set local data and re-apply: merge must NOT overwrite
  store['sentinel.config'] = { density: 'comfortable' };
  store['slots.hiddenTypes'] = ['existing'];
  // Force re-apply by bumping profileVersion
  const v1MergeProfile2 = Object.assign({}, v1MergeProfile, { profileVersion: 'v1.2' });
  const r2 = await PP.applyProfile(v1MergeProfile2);
  check(store['sentinel.config'].density === 'comfortable', 'v1 merge: existing sentinel.config not overwritten');
  check(store['slots.hiddenTypes'][0] === 'existing', 'v1 merge: existing slots.hiddenTypes not overwritten');

  // ── v1 back-compat: forceOverride → replace ───────────────────────────────
  console.log('\n--- v1 back-compat: forceOverride → replace ---');
  reset();
  store['sentinel.config'] = { density: 'comfortable' };
  const v1ReplaceProfile = makeProfile({
    profileVersion: 'v2.0',
    apply: { mode: 'forceOverride' },
    envelope: {
      modules: {
        sentinel: {
          config: { density: 'compact' },
        },
      },
    },
  });
  const r3 = await PP.applyProfile(v1ReplaceProfile);
  check(!r3.skipped, 'v1 replace profile not skipped');
  check(store['sentinel.config'].density === 'compact', 'v1 forceOverride: replaces existing sentinel.config');

  // ── Version gating: same profileVersion skipped ───────────────────────────
  console.log('\n--- version gating ---');
  reset();
  store['suite.practiceProfile'] = { lastAppliedVersion: 'v1.0' };
  const gateProfile = makeProfile({ profileVersion: 'v1.0' });
  const r4 = await PP.applyProfile(gateProfile);
  check(r4.skipped, 'same profileVersion is skipped');
  check(r4.reason.includes('already on this version'), 'skip reason: already on this version');

  // force: true bypasses version gate
  const r5 = await PP.applyProfile(gateProfile, { force: true });
  check(!r5.skipped, 'force:true bypasses version gate');

  // ── firstRunOnly: applies once ────────────────────────────────────────────
  console.log('\n--- firstRunOnly ---');
  reset();
  // No lastAppliedVersion yet — should apply
  const firstRunProfile = makeProfile({
    profileVersion: 'v1.0',
    apply: { mode: 'firstRunOnly' },
    envelope: {
      modules: {
        sentinel: { config: { density: 'compact' } },
      },
    },
  });
  const r6 = await PP.applyProfile(firstRunProfile);
  check(!r6.skipped, 'firstRunOnly: applies on first run');

  // Now lastAppliedVersion is set — should skip
  const r7 = await PP.applyProfile(firstRunProfile);
  check(r7.skipped, 'firstRunOnly: skips after first apply');
  check(r7.reason.includes('firstRunOnly'), 'firstRunOnly: correct skip reason');

  // ── Knowledge merge: new ids appended, collisions skipped ────────────────
  console.log('\n--- knowledge merge ---');
  reset();
  const existingEntry = {
    id: 'local-1', title: 'District nursing SPA', category: 'contacts',
    body: 'Local DN contact', tags: [], source: 'manual', reviewed: false,
    reviewBy: null, updatedAt: '2026-01-01T00:00:00Z',
  };
  store['knowledge.items'] = [existingEntry];
  store['knowledge.categories'] = [{ id: 'contacts', name: 'Contacts' }];

  const kbMergeProfile = makeProfile({
    profileVersion: 'km-1',
    apply: {
      modules: { knowledge: 'merge' },
    },
    envelope: {
      modules: {
        knowledge: {
          items: [
            { id: 'local-1', title: 'Should not overwrite', category: 'referrals', body: 'COLLISION' }, // id collision
            { id: 'new-kb-1', title: 'New entry from profile', category: 'referrals', body: 'New body' }, // new
          ],
          categories: [
            { id: 'contacts', name: 'Contacts REPLACE' }, // existing id — skip
            { id: 'referrals', name: 'Referral criteria' }, // new category
          ],
        },
      },
    },
  });
  const r8 = await PP.applyProfile(kbMergeProfile);
  check(r8.modulesApplied.includes('knowledge'), 'knowledge merge applied');
  check(store['knowledge.items'].length === 2, 'knowledge merge: appended new item');
  check(store['knowledge.items'].find(i => i.id === 'local-1')?.title === existingEntry.title,
    'knowledge merge: existing item not overwritten (id collision)');
  check(store['knowledge.items'].find(i => i.id === 'new-kb-1') !== undefined,
    'knowledge merge: new id item appended');
  // Existing category id not overwritten
  check(store['knowledge.categories'].find(c => c.id === 'contacts')?.name === 'Contacts',
    'knowledge merge: existing category not overwritten');
  check(store['knowledge.categories'].find(c => c.id === 'referrals') !== undefined,
    'knowledge merge: new category appended');

  // ── Knowledge merge: near-duplicate title detection ────────────────────────
  console.log('\n--- knowledge merge: near-duplicate title skipped ---');
  reset();
  store['knowledge.items'] = [{
    id: 'cardiology-chest', title: 'Cardiology — chest pain referral criteria', category: 'referrals',
    body: 'Local', tags: [], source: 'manual', reviewed: false, reviewBy: null, updatedAt: '2026-01-01T00:00:00Z',
  }];
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];

  const kbDupProfile = makeProfile({
    profileVersion: 'km-dup-1',
    apply: { modules: { knowledge: 'merge' } },
    envelope: {
      modules: {
        knowledge: {
          items: [
            // Near-duplicate title (different order, same tokens) — should be skipped
            { id: 'cardiology-chest-2', title: 'Referral criteria: chest pain (cardiology)', category: 'referrals', body: 'dup' },
            // Genuinely new
            { id: 'msk-physio-1', title: 'MSK physio self-referral pathway', category: 'pathways', body: 'some body' },
          ],
          categories: [{ id: 'pathways', name: 'Pathways' }],
        },
      },
    },
  });
  const r9 = await PP.applyProfile(kbDupProfile);
  check(!store['knowledge.items'].find(i => i.id === 'cardiology-chest-2'),
    'knowledge merge: near-duplicate title skipped');
  check(store['knowledge.items'].find(i => i.id === 'msk-physio-1') !== undefined,
    'knowledge merge: non-duplicate item appended');

  // ── Knowledge: config never written in either mode ─────────────────────────
  console.log('\n--- knowledge: config never written ---');
  reset();
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];
  const kbConfigProfile = makeProfile({
    profileVersion: 'km-cfg-1',
    apply: { modules: { knowledge: 'replace' } },
    envelope: {
      modules: {
        knowledge: {
          items: [{ id: 'item-1', title: 'Something useful', category: 'referrals', body: 'body' }],
          categories: [{ id: 'referrals', name: 'Referrals' }],
          config: { noticeAcknowledgedAt: '2026-01-01T00:00:00Z' }, // MUST be stripped
        },
      },
    },
  });
  await PP.applyProfile(kbConfigProfile);
  check(!store['knowledge.config']?.noticeAcknowledgedAt,
    'knowledge replace: config.noticeAcknowledgedAt never written');

  // merge mode too
  reset();
  store['knowledge.items'] = [];
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];
  const kbConfigMergeProfile = makeProfile({
    profileVersion: 'km-cfg-merge-1',
    apply: { modules: { knowledge: 'merge' } },
    envelope: {
      modules: {
        knowledge: {
          items: [{ id: 'item-2', title: 'Another entry', category: 'referrals', body: 'body' }],
          config: { noticeAcknowledgedAt: '2026-01-01T00:00:00Z' },
        },
      },
    },
  });
  await PP.applyProfile(kbConfigMergeProfile);
  check(!store['knowledge.config']?.noticeAcknowledgedAt,
    'knowledge merge: config.noticeAcknowledgedAt never written');

  // ── Knowledge replace: items replaced wholesale ───────────────────────────
  console.log('\n--- knowledge replace ---');
  reset();
  store['knowledge.items'] = [
    { id: 'old-1', title: 'Old item', category: 'referrals', body: 'old', tags: [], source: 'manual', reviewed: false, reviewBy: null, updatedAt: '2026-01-01T00:00:00Z' },
  ];
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Old' }];
  const kbReplaceProfile = makeProfile({
    profileVersion: 'km-rep-1',
    apply: { modules: { knowledge: 'replace' } },
    envelope: {
      modules: {
        knowledge: {
          items: [{ id: 'new-1', title: 'New item', category: 'referrals', body: 'new body' }],
          categories: [{ id: 'referrals', name: 'New Referrals' }],
        },
      },
    },
  });
  await PP.applyProfile(kbReplaceProfile);
  check(!store['knowledge.items'].find(i => i.id === 'old-1'), 'knowledge replace: old item removed');
  check(store['knowledge.items'].find(i => i.id === 'new-1') !== undefined, 'knowledge replace: new item written');
  check(store['knowledge.categories'].find(c => c.id === 'referrals')?.name === 'New Referrals',
    'knowledge replace: categories replaced');

  // ── Reception merge: enabledPathways flags ────────────────────────────────
  console.log('\n--- reception merge: enabledPathways ---');
  reset();
  // User has explicitly set sore-throat to false
  store['reception.config'] = { enabledPathways: { 'sore-throat': false } };

  const goodPathway = (id) => ({
    id,
    title: `Test pathway ${id}`,
    redFlags: [{ id: 'rf-1', ask: 'Severe difficulty breathing right now?', escalate: '999' }],
    questions: [{ id: 'q-1', ask: 'How long has this been going on?', type: 'text' }],
  });

  const rcMergeProfile = makeProfile({
    profileVersion: 'rc-1',
    apply: { modules: { reception: 'merge' } },
    envelope: {
      modules: {
        reception: {
          config: {
            enabledPathways: {
              'sore-throat':  true,   // user has this set to false — must not overwrite
              'headache':     true,   // new id — must be added
            },
          },
          customPathways: [goodPathway('custom-profile-pathway')],
        },
      },
    },
  });
  await PP.applyProfile(rcMergeProfile);
  check(store['reception.config']?.enabledPathways?.['sore-throat'] === false,
    'reception merge: existing enabledPathways flag NOT overwritten (user set false)');
  check(store['reception.config']?.enabledPathways?.['headache'] === true,
    'reception merge: new id flag added');
  check(!('disclaimerAcceptedAt' in (store['reception.config'] || {})),
    'reception merge: disclaimerAcceptedAt never written');

  // ── Reception: disclaimerAcceptedAt never written in replace mode ─────────
  console.log('\n--- reception replace: disclaimerAcceptedAt never written ---');
  reset();
  store['reception.customPathways'] = [];
  const rcReplaceProfile = makeProfile({
    profileVersion: 'rc-rep-1',
    apply: { modules: { reception: 'replace' } },
    envelope: {
      modules: {
        reception: {
          config: {
            enabledPathways: { 'sore-throat': true },
            disclaimerAcceptedAt: '2026-01-01T00:00:00Z', // MUST be stripped
          },
          customPathways: [goodPathway('rep-pathway')],
        },
      },
    },
  });
  await PP.applyProfile(rcReplaceProfile);
  check(!('disclaimerAcceptedAt' in (store['reception.config'] || {})),
    'reception replace: disclaimerAcceptedAt never written');

  // ── Triage Lens merge: oirTests field-level merge (2026-07-29 regression) ──
  // Real bug: the OLD code only ever applied triagelens.config when the local
  // copy was completely empty — but service-worker.js's initialiseTriage()
  // ALWAYS seeds it from defaults.json on install, so it's never actually
  // empty, on any machine. This confirms the fix: oirTests now merges by
  // `key` even when local triagelens.config is already populated (simulating
  // the real-world always-populated case).
  console.log('\n--- triage merge: oirTests field-level merge (2026-07-29 regression fix) ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    rules: { existingRule: true },
    oirTests: [{ key: 'local-test-1', label: 'Local custom test', pattern: 'foo' }],
  };
  const triageMergeProfile = makeProfile({
    profileVersion: 'tr-1',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: {
          config: {
            version: 99, // must NOT overwrite local version — rules/version untouched
            rules: { profileRule: true },
            oirTests: [
              { key: 'local-test-1', label: 'Should not overwrite', pattern: 'COLLISION' }, // key collision
              { key: 'profile-test-1', label: 'New from profile', pattern: 'bar' }, // new
            ],
          },
        },
      },
    },
  });
  const rTriage = await PP.applyProfile(triageMergeProfile);
  check(rTriage.modulesApplied.includes('triage'), 'triage merge applied (local config was NOT empty)');
  check(store['triagelens.config'].oirTests.length === 2,
    'triage merge: appended the new oirTests entry, kept the local one (not 3, not 1)');
  check(store['triagelens.config'].oirTests.find(t => t.key === 'local-test-1')?.label === 'Local custom test',
    'triage merge: existing oirTests entry NOT overwritten (key collision)');
  check(store['triagelens.config'].oirTests.find(t => t.key === 'profile-test-1') !== undefined,
    'triage merge: new-key oirTests entry appended');
  check(store['triagelens.config'].version === 7, 'triage merge: local version untouched (only oirTests merges)');
  check(store['triagelens.config'].rules?.existingRule === true && !store['triagelens.config'].rules?.profileRule,
    'triage merge: local rules untouched — rules/thresholds/systemChips/resultRules are NOT merged, by design');

  // ── Triage Lens merge: genuinely empty local config still applies wholesale ─
  console.log('\n--- triage merge: genuinely empty local config -> whole config applied ---');
  reset();
  const triageEmptyProfile = makeProfile({
    profileVersion: 'tr-2',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: {
          config: { version: 1, oirTests: [{ key: 'first-test', label: 'First', pattern: 'x' }] },
        },
      },
    },
  });
  await PP.applyProfile(triageEmptyProfile);
  check(store['triagelens.config']?.version === 1, 'triage merge: whole config applied when local was truly empty');
  check(store['triagelens.config']?.oirTests?.[0]?.key === 'first-test',
    'triage merge: oirTests present via whole-config path when local was empty');

  // ── Triage Lens replace: still applies unconditionally, unchanged ──────────
  console.log('\n--- triage replace: applies unconditionally ---');
  reset();
  store['triagelens.config'] = { version: 5, oirTests: [{ key: 'old', label: 'Old', pattern: 'x' }] };
  const triageReplaceProfile = makeProfile({
    profileVersion: 'tr-3',
    apply: { modules: { triage: 'replace' } },
    envelope: {
      modules: { triage: { config: { version: 6, oirTests: [{ key: 'new', label: 'New', pattern: 'y' }] } } },
    },
  });
  await PP.applyProfile(triageReplaceProfile);
  check(store['triagelens.config'].version === 6, 'triage replace: whole config overwritten, unchanged behaviour');
  check(store['triagelens.config'].oirTests.length === 1 && store['triagelens.config'].oirTests[0].key === 'new',
    'triage replace: old oirTests entries wiped, replaced wholesale (unchanged behaviour)');

  // ── Triage Lens merge: retirement is CONTENT-AWARE ────────────────────────
  // An edited test republishes under a NEW key (rotated at publish time,
  // shared/io/oir-key-rotation.js) and the superseded PUBLISHED content travels
  // with it in retiredOirTests. The apply side may only drop a local test whose
  // content still equals that superseded copy — a local test under the same key
  // with DIFFERENT content is a clinician's own edit and must survive (a blind
  // key filter destroyed it, including the publisher's own newest edit via its
  // self-apply).
  console.log('\n--- triage merge: retiredOirTests removes only an UNEDITED superseded copy ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [
      { key: 'crp', label: 'CRP', pattern: 'stale' },
      { key: 'untouched', label: 'Untouched', pattern: 'keep-me' },
    ],
  };
  const retireProfile = makeProfile({
    profileVersion: 'tr-4',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: {
          config: {
            oirTests: [{ key: 'crp-2', label: 'CRP', pattern: 'fresh' }],
            retiredOirTests: [{ key: 'crp', test: { label: 'CRP', pattern: 'stale' } }],
            retiredOirKeys: ['crp'],
          },
        },
      },
    },
  });
  const rRetire = await PP.applyProfile(retireProfile);
  check(rRetire.modulesApplied.includes('triage'), 'triage merge: retirement + append counts as applied');
  check(store['triagelens.config'].oirTests.find(t => t.key === 'crp') === undefined,
    'triage merge: an unedited copy of the superseded content is removed');
  check(store['triagelens.config'].oirTests.find(t => t.key === 'crp-2')?.pattern === 'fresh',
    'triage merge: rotated replacement key appended');
  check(store['triagelens.config'].oirTests.find(t => t.key === 'untouched') !== undefined,
    'triage merge: unrelated local entry survives retirement');
  check(store['triagelens.config'].oirTests.length === 2,
    'triage merge: net count reflects one retired + one added (2, not 3)');

  console.log('\n--- triage merge: a LOCALLY EDITED test under a retired key is NEVER deleted ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [{ key: 'crp', label: 'CRP', pattern: 'MY OWN LOCAL EDIT' }],
  };
  const retireEditedProfile = makeProfile({
    profileVersion: 'tr-4b',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: {
          config: {
            oirTests: [{ key: 'crp-2', label: 'CRP', pattern: 'fresh' }],
            retiredOirTests: [{ key: 'crp', test: { label: 'CRP', pattern: 'stale' } }],
            retiredOirKeys: ['crp'],
          },
        },
      },
    },
  });
  await PP.applyProfile(retireEditedProfile);
  check(store['triagelens.config'].oirTests.find(t => t.key === 'crp')?.pattern === 'MY OWN LOCAL EDIT',
    "triage merge: the clinician's own edit under the retired key is preserved, not silently deleted");
  check(store['triagelens.config'].oirTests.find(t => t.key === 'crp-2') !== undefined,
    'triage merge: the rotated replacement still appends, so both are visible for human reconciliation');

  console.log('\n--- triage merge: a legacy bare retiredOirKeys entry never deletes blindly ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [{ key: 'obsolete', label: 'Obsolete', pattern: 'gone' }],
  };
  const legacyRetireProfile = makeProfile({
    profileVersion: 'tr-5',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: { triage: { config: { retiredOirKeys: ['obsolete'] } } },
    },
  });
  const rLegacy = await PP.applyProfile(legacyRetireProfile);
  check(!rLegacy.modulesApplied.includes('triage'),
    'triage merge: a bare key list carries no superseded content, so nothing can be proven stale -> no-op');
  check(store['triagelens.config'].oirTests.length === 1,
    'triage merge: legacy bare retiredOirKeys leaves local content alone (fail toward preserving local edits)');

  console.log('\n--- triage merge: retiredOirTests alone (no accompanying oirTests) still retires ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [{ key: 'obsolete', label: 'Obsolete', pattern: 'gone' }],
  };
  const retireOnlyProfile = makeProfile({
    profileVersion: 'tr-5b',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: { config: { retiredOirTests: [{ key: 'obsolete', test: { label: 'Obsolete', pattern: 'gone' } }] } },
      },
    },
  });
  const rRetireOnly = await PP.applyProfile(retireOnlyProfile);
  check(rRetireOnly.modulesApplied.includes('triage'), 'triage merge: pure retirement counts as applied');
  check(store['triagelens.config'].oirTests.length === 0, 'triage merge: pure retirement empties the retired key out');

  // ── Triage Lens merge: built-in-key overrides update IN PLACE ─────────────
  // A disable/extend entry keyed by a built-in test key is never rotated (the
  // key IS the semantics — mergeTestDefs applies it by key). It can therefore
  // only reach other machines as an in-place update, and only when the local
  // copy is provably the previously published one.
  console.log('\n--- triage merge: built-in-key override updates in place when the local copy is unedited ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [{ key: 'fbc', disabled: false, req: ['old lab name'] }],
  };
  const builtinUpdateProfile = makeProfile({
    profileVersion: 'tr-7',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: {
          config: {
            oirTests: [{ key: 'fbc', disabled: true, req: [] }],
            supersededOirTests: [{ key: 'fbc', test: { disabled: false, req: ['old lab name'] } }],
          },
        },
      },
    },
  });
  const rBuiltin = await PP.applyProfile(builtinUpdateProfile);
  check(rBuiltin.modulesApplied.includes('triage'), 'triage merge: in-place built-in update counts as applied');
  check(store['triagelens.config'].oirTests.length === 1,
    'triage merge: the built-in override is updated in place, never duplicated under a rotated key');
  check(store['triagelens.config'].oirTests[0].key === 'fbc' && store['triagelens.config'].oirTests[0].disabled === true,
    'triage merge: the published built-in override replaces the previously published copy');

  console.log('\n--- triage merge: a locally edited built-in-key override is kept, not overwritten ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [{ key: 'fbc', disabled: false, req: ['MY OWN LOCAL TERM'] }],
  };
  const builtinEditedProfile = makeProfile({
    profileVersion: 'tr-7b',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: {
        triage: {
          config: {
            oirTests: [{ key: 'fbc', disabled: true, req: [] }],
            supersededOirTests: [{ key: 'fbc', test: { disabled: false, req: ['old lab name'] } }],
          },
        },
      },
    },
  });
  const rBuiltinEdited = await PP.applyProfile(builtinEditedProfile);
  check(store['triagelens.config'].oirTests[0].req[0] === 'MY OWN LOCAL TERM',
    'triage merge: a local edit under a built-in key wins over the incoming in-place update');
  check(!rBuiltinEdited.modulesApplied.includes('triage'),
    'triage merge: nothing changed -> not marked applied');

  // ── Triage Lens merge: no retirement, no new tests -> no-op, unapplied ─────
  console.log('\n--- triage merge: neither retirement nor new tests -> not marked applied ---');
  reset();
  store['triagelens.config'] = {
    version: 7,
    oirTests: [{ key: 'stable', label: 'Stable', pattern: 'x' }],
  };
  const noopProfile = makeProfile({
    profileVersion: 'tr-6',
    apply: { modules: { triage: 'merge' } },
    envelope: {
      modules: { triage: { config: { someOtherField: true } } },
    },
  });
  const rNoop = await PP.applyProfile(noopProfile);
  check(!rNoop.modulesApplied.includes('triage'), 'triage merge: genuinely nothing to do -> not marked applied');
  check(store['triagelens.config'].oirTests.length === 1, 'triage merge: local oirTests untouched by true no-op');

  // ── OIR content equality: the two implementations must stay in step ────────
  // practice-profile.js keeps a private copy of the comparison because it is
  // imported into the service worker, which cannot load oir-key-rotation.js.
  console.log('\n--- OIR content equality: practice-profile and oir-key-rotation agree ---');
  {
    const ROT = require('./shared/io/oir-key-rotation.js');
    const pairs = [
      [{ key: 'a', label: 'X', req: ['1'] }, { key: 'b', label: 'X', req: ['1'] }],
      [{ key: 'a', label: 'X', req: ['1'] }, { key: 'a', label: 'X', req: ['2'] }],
      [{ key: 'a', label: 'X', req: ['1'] }, { req: ['1'], label: 'X', key: 'zzz' }],
      [{ key: 'a', disabled: true }, { key: 'a', disabled: false }],
      [null, null],
      [{ key: 'a' }, null],
    ];
    const agree = pairs.every(([x, y]) => PP.oirTestContentEqual(x, y) === ROT.testContentEqual(x, y));
    check(agree, 'both content-equality implementations return the same verdict on every shape tested');
  }

  // ── Version gate is ORDERING-AWARE, not just equality-aware ───────────────
  // profileVersion is 'YYYY-MM-DD.N'. Applying an OLDER shared file (a restored
  // or rolled-back copy on the network drive) would re-run retirement against
  // stale content, so an older version is skipped with a logged reason.
  console.log('\n--- version ordering: an OLDER shared profile is not applied ---');
  reset();
  store['suite.practiceProfile'] = { lastAppliedVersion: '2026-07-30.2' };
  const olderProfile = makeProfile({
    profileVersion: '2026-07-30.1',
    apply: { modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { config: { density: 'compact' } } } },
  });
  const rOlder = await PP.applyProfile(olderProfile);
  check(rOlder.skipped, 'an older same-day sequence number is skipped');
  check(/older/i.test(rOlder.reason || ''), 'skip reason names the ordering problem');
  check(store['sentinel.config'] === undefined, 'nothing was written by the skipped older profile');

  const olderDayProfile = makeProfile({
    profileVersion: '2026-07-29.9',
    apply: { modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { config: { density: 'compact' } } } },
  });
  check((await PP.applyProfile(olderDayProfile)).skipped, 'an earlier DATE is skipped even with a higher sequence');

  const newerProfile = makeProfile({
    profileVersion: '2026-07-31.1',
    apply: { modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { config: { density: 'compact' } } } },
  });
  check(!(await PP.applyProfile(newerProfile)).skipped, 'a newer version still applies');

  reset();
  store['suite.practiceProfile'] = { lastAppliedVersion: '2026-07-30.2' };
  check(!(await PP.applyProfile(olderProfile, { force: true })).skipped,
    'force:true (the explicit Apply-now button) still re-applies an older profile');

  reset();
  store['suite.practiceProfile'] = { lastAppliedVersion: 'v1.9' };
  const unorderableProfile = makeProfile({
    profileVersion: 'v1.2',
    apply: { modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { config: { density: 'compact' } } } },
  });
  check(!(await PP.applyProfile(unorderableProfile)).skipped,
    'versions that are not YYYY-MM-DD.N cannot be ordered -> unchanged behaviour, still applies');

  // ── Sentinel: alertLibraryAcknowledged stripped in both modes ─────────────
  console.log('\n--- sentinel: alertLibraryAcknowledged stripped ---');
  reset();
  const sentMergeProfile = makeProfile({
    profileVersion: 'sent-1',
    apply: { modules: { sentinel: 'merge' } },
    envelope: {
      modules: {
        sentinel: {
          alertLibraryAcknowledged: true,
          config: { density: 'compact' },
        },
      },
    },
  });
  await PP.applyProfile(sentMergeProfile);
  check(store['sentinel.alertLibrary.acknowledged'] === undefined,
    'sentinel merge: alertLibraryAcknowledged not written');
  check(store['sentinel.config']?.density === 'compact',
    'sentinel merge: config written');

  reset();
  const sentReplaceProfile = makeProfile({
    profileVersion: 'sent-rep-1',
    apply: { modules: { sentinel: 'replace' } },
    envelope: {
      modules: {
        sentinel: {
          alertLibraryAcknowledged: true,
          config: { density: 'comfortable' },
        },
      },
    },
  });
  await PP.applyProfile(sentReplaceProfile);
  check(store['sentinel.alertLibrary.acknowledged'] === undefined,
    'sentinel replace: alertLibraryAcknowledged not written');

  // ── Suite: practiceCode + feedbackEmail only ──────────────────────────────
  console.log('\n--- suite module ---');
  reset();
  const suiteProfile = makeProfile({
    profileVersion: 'suite-1',
    apply: { modules: { suite: 'merge' } },
    envelope: {
      modules: {
        suite: {
          practiceCode:  'ABC123',
          feedbackEmail: 'admin@gp.nhs.uk',
          display:       { theme: 'dark' },   // must never be written
          tabOrder:      ['slots', 'sentinel'], // must never be written
        },
      },
    },
  });
  await PP.applyProfile(suiteProfile);
  check(store['suite.practiceCode'] === 'ABC123', 'suite merge: practiceCode set when absent');
  check(store['suite.feedbackEmail'] === 'admin@gp.nhs.uk', 'suite merge: feedbackEmail set when absent');
  check(store['suite.display'] === undefined, 'suite merge: display NEVER written');
  check(store['suite.tabOrder'] === undefined, 'suite merge: tabOrder NEVER written');

  // merge mode: practiceCode not overwritten when already present
  store['suite.practiceCode'] = 'EXISTING';
  const suiteProfile2 = makeProfile({
    profileVersion: 'suite-2',
    apply: { modules: { suite: 'merge' } },
    envelope: { modules: { suite: { practiceCode: 'NEW_CODE' } } },
  });
  await PP.applyProfile(suiteProfile2);
  check(store['suite.practiceCode'] === 'EXISTING',
    'suite merge: existing practiceCode not overwritten');

  // replace mode: practiceCode IS overwritten
  const suiteProfile3 = makeProfile({
    profileVersion: 'suite-3',
    apply: { modules: { suite: 'replace' } },
    envelope: { modules: { suite: { practiceCode: 'REPLACED' } } },
  });
  await PP.applyProfile(suiteProfile3);
  check(store['suite.practiceCode'] === 'REPLACED',
    'suite replace: practiceCode overwritten');

  // ── Cleanup Code Preferences: tallies always max(), override follows mode ──
  console.log('\n--- problemDescriptionCleanup merge: tally reconciles via max(), never adds ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    35253001: {
      tally: { 111111: { candidate: { description: 'Local pick' }, count: 20, lastUsed: '2026-07-28T09:00:00Z' } },
      override: null,
    },
  };
  const pdcMergeProfile = makeProfile({
    profileVersion: 'pdc-1',
    apply: { modules: { problemDescriptionCleanup: 'merge' } },
    envelope: {
      modules: {
        problemDescriptionCleanup: {
          preferredDescriptions: {
            35253001: {
              tally: { 111111: { candidate: { description: 'Published pick' }, count: 8, lastUsed: '2026-07-29T09:00:00Z' } },
              override: null,
            },
          },
        },
      },
    },
  });
  const rPdc1 = await PP.applyProfile(pdcMergeProfile);
  check(store['pdc.preferredDescriptions']['35253001'].tally['111111'].count === 20,
    'tally takes the LARGER of local (20) vs published (8), not the sum (28)');
  check(rPdc1.modulesApplied.includes('problemDescriptionCleanup'), 'problemDescriptionCleanup recorded as applied');

  // Re-applying the SAME published snapshot again (simulating a later re-check
  // cycle) must not inflate the count further.
  const pdcMergeProfile2 = makeProfile({
    profileVersion: 'pdc-2',
    apply: { modules: { problemDescriptionCleanup: 'merge' } },
    envelope: { modules: { problemDescriptionCleanup: pdcMergeProfile.envelope.modules.problemDescriptionCleanup } },
  });
  await PP.applyProfile(pdcMergeProfile2);
  check(store['pdc.preferredDescriptions']['35253001'].tally['111111'].count === 20,
    'repeated sync of the same published snapshot does not inflate the count (still 20, not 28 or 36)');

  console.log('\n--- problemDescriptionCleanup merge: local override always wins ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    35253001: { tally: {}, override: { key: '111111', candidate: { description: 'Local admin decision' } } },
  };
  const pdcMergeOverrideProfile = makeProfile({
    profileVersion: 'pdc-3',
    apply: { modules: { problemDescriptionCleanup: 'merge' } },
    envelope: {
      modules: {
        problemDescriptionCleanup: {
          preferredDescriptions: {
            35253001: { tally: {}, override: { key: '222222', candidate: { description: 'Published decision' } } },
          },
        },
      },
    },
  });
  await PP.applyProfile(pdcMergeOverrideProfile);
  check(store['pdc.preferredDescriptions']['35253001'].override.key === '111111',
    'merge mode: local override survives a conflicting published one');

  console.log('\n--- problemDescriptionCleanup replace: published override is authoritative ---');
  reset();
  store['pdc.preferredDescriptions'] = {
    35253001: { tally: {}, override: { key: '111111', candidate: { description: 'Local admin decision' } } },
  };
  const pdcReplaceProfile = makeProfile({
    profileVersion: 'pdc-4',
    apply: { modules: { problemDescriptionCleanup: 'replace' } },
    envelope: {
      modules: {
        problemDescriptionCleanup: {
          preferredDescriptions: {
            35253001: { tally: {}, override: { key: '222222', candidate: { description: 'Practice-agreed decision' } } },
          },
        },
      },
    },
  });
  await PP.applyProfile(pdcReplaceProfile);
  check(store['pdc.preferredDescriptions']['35253001'].override.key === '222222',
    'replace mode: published override replaces the local one (curated practice decision wins)');

  console.log('\n--- problemDescriptionCleanup: empty payload is not applied ---');
  reset();
  const pdcEmptyProfile = makeProfile({
    profileVersion: 'pdc-5',
    apply: { modules: { problemDescriptionCleanup: 'merge' } },
    envelope: { modules: { problemDescriptionCleanup: { preferredDescriptions: {}, conceptRemap: {} } } },
  });
  const rPdcEmpty = await PP.applyProfile(pdcEmptyProfile);
  check(!rPdcEmpty.modulesApplied.includes('problemDescriptionCleanup'),
    'an empty preferredDescriptions/conceptRemap payload is not recorded as applied');

  // ── ALWAYS_MERGE_MODULES: pdc applies even when apply.modules omits it ──────
  console.log('\n--- ALWAYS_MERGE_MODULES: pdc merges even when the admin never ticked its checkbox ---');
  reset();
  const pdcForgottenProfile = makeProfile({
    profileVersion: 'pdc-always-1',
    // apply.modules explicitly present (v2 object) but does NOT mention
    // problemDescriptionCleanup — simulates an admin who published without
    // ever ticking the "Cleanup Code Preferences" box.
    apply: { modules: { sentinel: 'merge' } },
    envelope: {
      modules: {
        problemDescriptionCleanup: {
          preferredDescriptions: { '123': { tally: { '456': { candidate: { description: 'Foo', descriptionId: '456' }, count: 1, lastUsed: '2026-01-01T00:00:00Z' } }, override: null } },
          conceptRemap: {},
        },
      },
    },
  });
  const rPdcForgotten = await PP.applyProfile(pdcForgottenProfile);
  check(rPdcForgotten.modulesApplied.includes('problemDescriptionCleanup'),
    'pdc still applies when apply.modules is a v2 object that omits it entirely');

  console.log('\n--- ALWAYS_MERGE_MODULES: an explicit mode in apply.modules is not overridden ---');
  reset();
  const pdcExplicitReplaceProfile = makeProfile({
    profileVersion: 'pdc-always-2',
    apply: { modules: { problemDescriptionCleanup: 'replace' } },
    envelope: {
      modules: {
        problemDescriptionCleanup: {
          preferredDescriptions: {},
          conceptRemap: { '789': { tally: {}, override: { key: '1|2', candidate: { conceptId: '2', descriptionId: '1', description: 'Bar' } } } },
        },
      },
    },
  });
  store['pdc.conceptRemap'] = { '789': { tally: {}, override: { key: '9|9', candidate: { conceptId: '9', descriptionId: '9', description: 'LocalPin' } } } };
  const rPdcExplicitReplace = await PP.applyProfile(pdcExplicitReplaceProfile);
  check(rPdcExplicitReplace.modulesApplied.includes('problemDescriptionCleanup'), 'pdc applied under an explicit mode');
  check(store['pdc.conceptRemap']['789'].override.candidate.description === 'Bar',
    'explicit "replace" in apply.modules is honoured, not silently forced to merge by the always-merge fallback');

  console.log('\n--- ALWAYS_MERGE_MODULES: v1 array config also gets pdc filled in ---');
  reset();
  const pdcV1Profile = makeProfile({
    profileVersion: 'pdc-always-3',
    apply: { mode: 'mergeMissing', modules: ['sentinel'] }, // v1 array shape, pdc absent
    envelope: {
      modules: {
        problemDescriptionCleanup: {
          preferredDescriptions: { '111': { tally: { '222': { candidate: { description: 'Baz', descriptionId: '222' }, count: 1, lastUsed: '2026-01-01T00:00:00Z' } }, override: null } },
          conceptRemap: {},
        },
      },
    },
  });
  const rPdcV1 = await PP.applyProfile(pdcV1Profile);
  check(rPdcV1.modulesApplied.includes('problemDescriptionCleanup'), 'pdc still applies under a v1 array apply.modules config');

  // ── Malformed module section: records error, other modules still apply ─────
  console.log('\n--- malformed module section: per-module error isolation ---');
  reset();
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];
  const mixedProfile = makeProfile({
    profileVersion: 'mix-1',
    apply: { modules: { knowledge: 'replace', sentinel: 'merge' } },
    envelope: {
      modules: {
        knowledge: {
          items: 'NOT AN ARRAY', // malformed — should record an error
        },
        sentinel: {
          config: { density: 'compact' }, // valid — should still be applied
        },
      },
    },
  });
  const r10 = await PP.applyProfile(mixedProfile);
  check(r10.errors.length > 0, 'malformed module: error recorded');
  check(r10.errors.some(e => e.includes('knowledge')), 'malformed module: error references knowledge');
  check(r10.modulesApplied.includes('sentinel'), 'malformed module: other modules still applied');
  check(store['sentinel.config']?.density === 'compact', 'malformed module: sentinel.config written despite knowledge error');

  // ── lastCheckedAt / history bookkeeping ───────────────────────────────────
  console.log('\n--- lastCheckedAt / history bookkeeping ---');
  reset();
  const histProfile = makeProfile({
    profileVersion: 'hist-1',
    apply: { modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { config: {} } } },
  });
  await PP.applyProfile(histProfile);
  const meta = store['suite.practiceProfile'];
  check(typeof meta?.lastAppliedAt === 'string' && meta.lastAppliedAt.includes('T'),
    'history: lastAppliedAt is ISO timestamp');
  check(meta?.lastAppliedVersion === 'hist-1', 'history: lastAppliedVersion recorded');
  check(Array.isArray(meta?.history) && meta.history.length > 0, 'history: history array populated');
  check(meta.history[0].profileVersion === 'hist-1', 'history: latest entry is head of array');

  // Apply a second version — history should grow, capped at 10
  for (let i = 2; i <= 12; i++) {
    const p = makeProfile({
      profileVersion: `hist-${i}`,
      apply: { modules: { sentinel: 'merge' } },
      envelope: { modules: { sentinel: { config: {} } } },
    });
    await PP.applyProfile(p, { force: true });
  }
  const meta2 = store['suite.practiceProfile'];
  check(meta2.history.length === 10, 'history: capped at 10 entries');
  check(meta2.history[0].profileVersion === 'hist-12', 'history: most recent is first');

  // ── errors stored in history ───────────────────────────────────────────────
  console.log('\n--- errors in history entry ---');
  reset();
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];
  const errProfile = makeProfile({
    profileVersion: 'err-1',
    apply: { modules: { knowledge: 'merge' } },
    envelope: { modules: { knowledge: { items: 'bad' } } },
  });
  const r11 = await PP.applyProfile(errProfile);
  const errMeta = store['suite.practiceProfile'];
  check(r11.errors.length > 0, 'errors returned from applyProfile');
  check(errMeta.history[0].errors?.length > 0, 'errors stored in history entry');

  // ── v2: modules as object map ──────────────────────────────────────────────
  console.log('\n--- v2: modules as object map ---');
  reset();
  store['sentinel.config'] = { density: 'comfortable' };
  const v2Profile = makeProfile({
    profileVersion: 'v2-1',
    apply: {
      modules: {
        sentinel:  'replace', // replace mode: should overwrite
        submissions: 'merge', // merge mode: only if absent
      },
    },
    envelope: {
      modules: {
        sentinel:    { config: { density: 'compact' } },
        submissions: { config: { teamId: 'x' } },
      },
    },
  });
  await PP.applyProfile(v2Profile);
  check(store['sentinel.config']?.density === 'compact',
    'v2 modules map: replace overwrites existing sentinel.config');
  check(store['submissions.config']?.teamId === 'x',
    'v2 modules map: merge writes absent submissions.config');

  // Merge must not overwrite existing submissions.config
  const v2Profile2 = makeProfile({
    profileVersion: 'v2-2',
    apply: { modules: { submissions: 'merge' } },
    envelope: { modules: { submissions: { config: { teamId: 'y' } } } },
  });
  await PP.applyProfile(v2Profile2);
  check(store['submissions.config']?.teamId === 'x',
    'v2 merge: existing submissions.config not overwritten');

  // ── checkEveryMinutes is honoured (presence check only — alarm scheduling is SW-only) ──
  console.log('\n--- checkEveryMinutes clamping ---');
  // This tests the _ppCheckIntervalMinutes helper indirectly via the profile
  // by verifying the clamp range. We construct profiles with various values and
  // check that the apply.checkEveryMinutes field is readable (no validation error).
  for (const mins of [5, 15, 60, 1440]) {
    const p = makeProfile({
      profileVersion: `chk-${mins}`,
      apply: { checkEveryMinutes: mins, modules: { sentinel: 'merge' } },
      envelope: { modules: { sentinel: { config: {} } } },
    });
    const r = await PP.applyProfile(p, { force: true });
    check(!r.errors?.length, `checkEveryMinutes ${mins}: no errors`);
  }

  // ── autoReloadOnNewVersion in profile (readable without error) ────────────
  console.log('\n--- autoReloadOnNewVersion ---');
  reset();
  const noReloadProfile = makeProfile({
    profileVersion: 'ar-1',
    apply: { autoReloadOnNewVersion: false, modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { config: {} } } },
  });
  const r12 = await PP.applyProfile(noReloadProfile);
  check(!r12.errors?.length, 'autoReloadOnNewVersion false: no errors');

  // ── Unsupported modules silently ignored (condor, popout) ─────────────────
  console.log('\n--- unsupported modules silently ignored ---');
  reset();
  const unsupportedProfile = makeProfile({
    profileVersion: 'unsup-1',
    apply: { modules: { condor: 'replace', popout: 'merge', sentinel: 'merge' } },
    envelope: {
      modules: {
        condor:   { something: 'ignored' },
        popout:   { something: 'ignored' },
        sentinel: { config: { density: 'compact' } },
      },
    },
  });
  const r13 = await PP.applyProfile(unsupportedProfile);
  check(r13.modulesApplied.includes('sentinel'), 'unsupported: sentinel still applied');
  check(!r13.modulesApplied.includes('condor'), 'unsupported: condor silently skipped');
  check(!r13.modulesApplied.includes('popout'), 'unsupported: popout silently skipped');
  check(!r13.errors?.length, 'unsupported: no errors for condor/popout');

  // ── Central practice attestation: reception gate ──────────────────────────
  console.log('\n--- central attestation: reception gate ---');
  reset();
  const rcAttProfile = makeProfile({
    profileVersion: 'att-rc-1',
    apply: { modules: { reception: 'merge' } },
    practiceAttestation: {
      attestedBy: 'admin@gp.nhs.uk',
      attestedAt: '2026-06-01T09:00:00Z',
      gates: { reception: true },
    },
    envelope: {
      modules: {
        reception: { config: { enabledPathways: { headache: true } } },
      },
    },
  });
  await PP.applyProfile(rcAttProfile);
  check(store['reception.config']?.disclaimerAcceptedAt === '2026-06-01T09:00:00Z',
    'attestation reception: disclaimerAcceptedAt written from attestedAt');
  check(store['reception.config']?.enabledPathways?.headache === true,
    'attestation reception: other config keys preserved');
  check(store['suite.practiceProfile.attestations']?.reception?.by === 'admin@gp.nhs.uk',
    'attestation reception: provenance by recorded');
  check(store['suite.practiceProfile.attestations']?.reception?.via === 'practice-profile',
    'attestation reception: provenance via recorded');

  // WITHOUT the block, disclaimerAcceptedAt is NOT written (current behaviour)
  reset();
  const rcNoAttProfile = makeProfile({
    profileVersion: 'att-rc-none-1',
    apply: { modules: { reception: 'merge' } },
    envelope: { modules: { reception: { config: { enabledPathways: { headache: true } } } } },
  });
  await PP.applyProfile(rcNoAttProfile);
  check(!('disclaimerAcceptedAt' in (store['reception.config'] || {})),
    'no attestation reception: disclaimerAcceptedAt NOT written');
  check(store['suite.practiceProfile.attestations'] === undefined,
    'no attestation reception: provenance marker NOT written');

  // Genuine local acceptance never overwritten/downgraded by a gate
  reset();
  store['reception.config'] = { disclaimerAcceptedAt: '2025-01-01T00:00:00Z' };
  const rcLocalWins = makeProfile({
    profileVersion: 'att-rc-local-1',
    apply: { modules: { reception: 'merge' } },
    practiceAttestation: {
      attestedBy: 'admin@gp.nhs.uk', attestedAt: '2026-06-01T09:00:00Z', gates: { reception: true },
    },
    envelope: { modules: { reception: { config: {} } } },
  });
  await PP.applyProfile(rcLocalWins);
  check(store['reception.config'].disclaimerAcceptedAt === '2025-01-01T00:00:00Z',
    'attestation reception: genuine local acceptance not overwritten');

  // ── Central attestation is MODULE-INDEPENDENT ─────────────────────────────
  // A signed gate opens its per-install attestation even when that module is NOT
  // part of this push (the acceptance rides the signature, not the content —
  // which an earlier profile version may have pushed). Here NO modules are
  // pushed at all, yet all three gates must still apply.
  console.log('\n--- central attestation: applies even when the gated module is not in the push ---');
  reset();
  const attIndepProfile = makeProfile({
    profileVersion: 'att-indep-1',
    apply: { modules: {} }, // no modules pushed
    practiceAttestation: {
      attestedBy: 'cso@gp.nhs.uk',
      attestedAt: '2026-06-02T08:00:00Z',
      gates: { reception: true, knowledge: true, alertLibrary: true },
    },
    envelope: { modules: {} },
  });
  await PP.applyProfile(attIndepProfile);
  check(store['reception.config']?.disclaimerAcceptedAt === '2026-06-02T08:00:00Z',
    'attestation independent: reception disclaimer written though reception module absent');
  check(store['knowledge.config']?.noticeAcknowledgedAt === '2026-06-02T08:00:00Z',
    'attestation independent: knowledge notice written though knowledge module absent');
  check(store['sentinel.alertLibrary.acknowledged'] === true,
    'attestation independent: alert-library ack written though sentinel module absent');
  check(
    store['suite.practiceProfile.attestations']?.reception?.via === 'practice-profile' &&
    store['suite.practiceProfile.attestations']?.knowledge?.via === 'practice-profile' &&
    store['suite.practiceProfile.attestations']?.alertLibrary?.via === 'practice-profile',
    'attestation independent: provenance recorded for all three gates');

  // ── Central attestation: alertLibrary gate ────────────────────────────────
  console.log('\n--- central attestation: alertLibrary gate ---');
  reset();
  const slAttProfile = makeProfile({
    profileVersion: 'att-sl-1',
    apply: { modules: { sentinel: 'merge' } },
    practiceAttestation: {
      attestedBy: 'admin@gp.nhs.uk', attestedAt: '2026-06-01T09:00:00Z', gates: { alertLibrary: true },
    },
    envelope: { modules: { sentinel: { config: { density: 'compact' } } } },
  });
  await PP.applyProfile(slAttProfile);
  check(store['sentinel.alertLibrary.acknowledged'] === true,
    'attestation alertLibrary: acknowledged written true with gate');
  check(store['suite.practiceProfile.attestations']?.alertLibrary?.via === 'practice-profile',
    'attestation alertLibrary: provenance recorded');

  // WITHOUT the gate, acknowledged is NOT written (preserves current strip behaviour)
  reset();
  const slNoAttProfile = makeProfile({
    profileVersion: 'att-sl-none-1',
    apply: { modules: { sentinel: 'merge' } },
    envelope: { modules: { sentinel: { alertLibraryAcknowledged: true, config: { density: 'compact' } } } },
  });
  await PP.applyProfile(slNoAttProfile);
  check(store['sentinel.alertLibrary.acknowledged'] === undefined,
    'no attestation alertLibrary: acknowledged NOT written even if payload carries it');

  // ── Central attestation: knowledge gate ───────────────────────────────────
  console.log('\n--- central attestation: knowledge gate ---');
  reset();
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];
  const kbAttProfile = makeProfile({
    profileVersion: 'att-kb-1',
    apply: { modules: { knowledge: 'replace' } },
    practiceAttestation: {
      attestedBy: 'admin@gp.nhs.uk', attestedAt: '2026-06-01T09:00:00Z', gates: { knowledge: true },
    },
    envelope: {
      modules: {
        knowledge: {
          items: [{ id: 'k1', title: 'An entry', category: 'referrals', body: 'body' }],
          categories: [{ id: 'referrals', name: 'Referrals' }],
        },
      },
    },
  });
  await PP.applyProfile(kbAttProfile);
  check(store['knowledge.config']?.noticeAcknowledgedAt === '2026-06-01T09:00:00Z',
    'attestation knowledge: noticeAcknowledgedAt written from attestedAt');
  check(store['suite.practiceProfile.attestations']?.knowledge?.via === 'practice-profile',
    'attestation knowledge: provenance recorded');

  // WITHOUT the gate, noticeAcknowledgedAt is NOT written
  reset();
  store['knowledge.categories'] = [{ id: 'referrals', name: 'Referrals' }];
  const kbNoAttProfile = makeProfile({
    profileVersion: 'att-kb-none-1',
    apply: { modules: { knowledge: 'replace' } },
    envelope: {
      modules: {
        knowledge: {
          items: [{ id: 'k2', title: 'Another entry', category: 'referrals', body: 'body' }],
          categories: [{ id: 'referrals', name: 'Referrals' }],
          config: { noticeAcknowledgedAt: '2026-01-01T00:00:00Z' },
        },
      },
    },
  });
  await PP.applyProfile(kbNoAttProfile);
  check(!store['knowledge.config']?.noticeAcknowledgedAt,
    'no attestation knowledge: noticeAcknowledgedAt NOT written');
  check(store['suite.practiceProfile.attestations'] === undefined,
    'no attestation knowledge: provenance marker NOT written');

  // Gate present but value false → behaves as no gate (fail-safe)
  reset();
  const slGateFalse = makeProfile({
    profileVersion: 'att-sl-false-1',
    apply: { modules: { sentinel: 'merge' } },
    practiceAttestation: {
      attestedBy: 'admin@gp.nhs.uk', attestedAt: '2026-06-01T09:00:00Z', gates: { alertLibrary: false },
    },
    envelope: { modules: { sentinel: { alertLibraryAcknowledged: true, config: { density: 'compact' } } } },
  });
  await PP.applyProfile(slGateFalse);
  check(store['sentinel.alertLibrary.acknowledged'] === undefined,
    'attestation gate=false: behaves as no gate (acknowledged NOT written)');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);

})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
