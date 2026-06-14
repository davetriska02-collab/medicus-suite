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
