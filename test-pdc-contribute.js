// Medicus Suite — pdc-contribute.js tests
// Run with: node test-pdc-contribute.js
//
// Exercises the pure logic (verifyProfileFile, buildPdcContribution,
// shouldContributeToday) directly, and runPdcContribution's orchestration
// via fully injected deps (no real chrome.storage/FileSystemFileHandle).

'use strict';

const PdcContribute = require('./shared/io/pdc-contribute.js');
const { problemDescriptionCleanupMergeForPublish } = require('./shared/io/problem-description-cleanup-io.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

function makeSharedProfile(over = {}) {
  return Object.assign(
    {
      format: 'medicus-suite-practice-profile',
      formatVersion: 2,
      profileVersion: '2026-08-03.1',
      profileLabel: 'Test Practice',
      publishedAt: '2026-08-03T00:00:00.000Z',
      publishedBy: 'admin@example.com',
      apply: { modules: { problemDescriptionCleanup: 'merge', sentinel: 'merge' } },
      envelope: {
        modules: {
          sentinel: { rules: {}, config: {} },
          problemDescriptionCleanup: { preferredDescriptions: {}, conceptRemap: {} },
        },
      },
    },
    over
  );
}

function makeFakeHandle({ text, permission = 'granted' } = {}) {
  let fileText = text;
  return {
    async queryPermission() {
      return permission;
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

(async () => {
  // ── verifyProfileFile ───────────────────────────────────────────────────────
  console.log('\n--- verifyProfileFile ---');

  check(!PdcContribute.verifyProfileFile('not json').ok, 'rejects invalid JSON');
  check(!PdcContribute.verifyProfileFile(JSON.stringify({ foo: 'bar' })).ok, 'rejects a file with the wrong format');
  check(
    !PdcContribute.verifyProfileFile(JSON.stringify({ format: 'medicus-suite-practice-profile' })).ok,
    'rejects a file missing profileVersion/envelope'
  );
  const validProfile = makeSharedProfile();
  check(PdcContribute.verifyProfileFile(JSON.stringify(validProfile)).ok, 'accepts a well-formed profile file');

  const fetchedProfile = makeSharedProfile({ envelope: { modules: { sentinel: {} } } });
  const unrelatedProfile = makeSharedProfile({ envelope: { modules: { knowledge: {} } } });
  check(
    !PdcContribute.verifyProfileFile(JSON.stringify(unrelatedProfile), fetchedProfile).ok,
    "rejects a file whose modules share nothing with the install's own fetched profile"
  );
  const sameFamilyProfile = makeSharedProfile({ profileVersion: '2026-08-01.1' });
  check(
    PdcContribute.verifyProfileFile(JSON.stringify(sameFamilyProfile), fetchedProfile).ok,
    'accepts a file that overlaps modules with the fetched profile even at a different version'
  );

  // ── nextProfileVersion ───────────────────────────────────────────────────────
  console.log('\n--- nextProfileVersion ---');
  check(
    PdcContribute.nextProfileVersion({ profileVersion: '2026-08-03.1' }, '2026-08-03') === '2026-08-03.2',
    'bumps the sequence when the shared profile is from today'
  );
  check(
    PdcContribute.nextProfileVersion({ profileVersion: '2026-08-02.5' }, '2026-08-03') === '2026-08-03.1',
    'starts a fresh sequence when the shared profile is from a previous day'
  );
  check(
    PdcContribute.nextProfileVersion(null, '2026-08-03') === '2026-08-03.1',
    'starts a fresh sequence when there is no shared profile at all'
  );

  // ── shouldContributeToday ────────────────────────────────────────────────────
  console.log('\n--- shouldContributeToday ---');
  check(PdcContribute.shouldContributeToday(null, '2026-08-03'), 'no prior state -> should contribute');
  check(
    PdcContribute.shouldContributeToday({ lastContributedAt: '2026-08-02' }, '2026-08-03'),
    'a different day -> should contribute'
  );
  check(
    !PdcContribute.shouldContributeToday({ lastContributedAt: '2026-08-03' }, '2026-08-03'),
    'already attempted today -> should not contribute again'
  );

  // ── buildPdcContribution ─────────────────────────────────────────────────────
  console.log('\n--- buildPdcContribution ---');

  check(
    PdcContribute.buildPdcContribution(null, {}, { version: 'v1', mergePdc: problemDescriptionCleanupMergeForPublish })
      .skipReason === 'no-shared-profile',
    'no shared profile at all -> no-shared-profile'
  );

  const notPublishedProfile = makeSharedProfile({ apply: { modules: { sentinel: 'merge' } } });
  check(
    PdcContribute.buildPdcContribution(
      notPublishedProfile,
      {},
      {
        version: 'v1',
        mergePdc: problemDescriptionCleanupMergeForPublish,
      }
    ).skipReason === 'not-published',
    'shared profile does not list problemDescriptionCleanup -> not-published (never publishes a module nobody chose)'
  );

  const noopProfile = makeSharedProfile();
  check(
    PdcContribute.buildPdcContribution(
      noopProfile,
      { preferredDescriptions: {}, conceptRemap: {} },
      {
        version: 'v2',
        mergePdc: problemDescriptionCleanupMergeForPublish,
      }
    ).skipReason === 'no-change',
    'local pdc export is a subset of what is already shared -> no-change (no pointless write)'
  );

  const localPdc = {
    preferredDescriptions: {
      123: {
        tally: {
          456: { candidate: { description: 'Foo', descriptionId: '456' }, count: 3, lastUsed: '2026-08-03T00:00:00Z' },
        },
        override: null,
      },
    },
    conceptRemap: {},
  };
  const changedResult = PdcContribute.buildPdcContribution(noopProfile, localPdc, {
    version: '2026-08-03.2',
    now: new Date('2026-08-03T12:00:00.000Z'),
    mergePdc: problemDescriptionCleanupMergeForPublish,
  });
  check(changedResult.changed === true, 'new local tally data -> changed:true, produces a json payload');
  check(changedResult.json.profileVersion === '2026-08-03.2', 'json carries the new profileVersion');
  check(
    changedResult.json.envelope.modules.problemDescriptionCleanup.preferredDescriptions['123'].tally['456'].count === 3,
    "the merged pdc payload contains this machine's new tally"
  );
  check(
    JSON.stringify(changedResult.json.envelope.modules.sentinel) ===
      JSON.stringify(noopProfile.envelope.modules.sentinel),
    'every other module is carried forward byte-for-byte'
  );
  check(
    JSON.stringify(changedResult.json.apply) === JSON.stringify(noopProfile.apply),
    'apply.modules is carried forward untouched — a contributor never changes what gets published'
  );
  check(
    changedResult.json.publishedBy === noopProfile.publishedBy,
    'publishedBy is carried forward — a contribution is not a re-attestation of who published'
  );

  // includeOverride:false is always used — a contribution must never let a
  // locally-pinned override become the practice-wide enforced choice.
  const overrideProfile = makeSharedProfile({
    envelope: { modules: { problemDescriptionCleanup: { preferredDescriptions: {}, conceptRemap: {} } } },
  });
  const localWithOverride = {
    preferredDescriptions: {
      999: { tally: {}, override: { key: '111', candidate: { description: 'LocalPin', descriptionId: '111' } } },
    },
    conceptRemap: {},
  };
  const overrideResult = PdcContribute.buildPdcContribution(overrideProfile, localWithOverride, {
    version: 'v3',
    mergePdc: problemDescriptionCleanupMergeForPublish,
  });
  check(
    !overrideResult.json.envelope.modules.problemDescriptionCleanup.preferredDescriptions['999'].override,
    'a local override never rides along into the published override via a contribution (includeOverride:false)'
  );

  // ── runPdcContribution: orchestration with fully injected deps ─────────────
  console.log('\n--- runPdcContribution ---');

  function baseDeps(overrides = {}) {
    let state = { enabled: true };
    const handle = makeFakeHandle({ text: JSON.stringify(noopProfile) });
    return Object.assign(
      {
        getState: async () => state,
        setState: async (patch) => {
          state = Object.assign({}, state, patch);
        },
        loadHandle: async () => handle,
        readHandleText: async (h) => (await h.getFile()).text(),
        writeHandleText: async (h, text) => {
          const w = await h.createWritable();
          await w.write(text);
          await w.close();
        },
        fetchProfile: async () => noopProfile,
        getLocalPdc: async () => ({ preferredDescriptions: {}, conceptRemap: {} }),
        mergePdc: problemDescriptionCleanupMergeForPublish,
        now: () => new Date('2026-08-03T12:00:00.000Z'),
      },
      overrides
    );
  }

  const rNotEnabled = await PdcContribute.runPdcContribution(baseDeps({ getState: async () => ({ enabled: false }) }));
  check(rNotEnabled.ran === false && rNotEnabled.reason === 'not-enabled', 'enabled:false -> does not run at all');

  const rNoState = await PdcContribute.runPdcContribution(baseDeps({ getState: async () => null }));
  check(rNoState.ran === false && rNoState.reason === 'not-enabled', 'no state at all -> treated as not-enabled');

  const rAlreadyToday = await PdcContribute.runPdcContribution(
    baseDeps({ getState: async () => ({ enabled: true, lastContributedAt: '2026-08-03' }) })
  );
  check(rAlreadyToday.ran === false && rAlreadyToday.reason === 'already-today', 'already contributed today -> skips');

  const rNoHandle = await PdcContribute.runPdcContribution(baseDeps({ loadHandle: async () => null }));
  check(rNoHandle.ran === false && rNoHandle.reason === 'no-handle', 'no handle available -> does not run');

  const rPermNotGranted = await PdcContribute.runPdcContribution(
    baseDeps({ loadHandle: async () => makeFakeHandle({ text: JSON.stringify(noopProfile), permission: 'prompt' }) })
  );
  check(
    rPermNotGranted.ran === false && rPermNotGranted.reason === 'permission-not-granted',
    'permission lapsed (not "granted") -> silently does not run, never calls requestPermission itself'
  );

  const rInvalidFile = await PdcContribute.runPdcContribution(
    baseDeps({ loadHandle: async () => makeFakeHandle({ text: 'not json at all' }) })
  );
  check(
    rInvalidFile.ran === false && rInvalidFile.reason === 'verify-failed',
    'malformed file contents -> verify-failed, no write attempted'
  );

  const rStaleRead = await PdcContribute.runPdcContribution(
    baseDeps({ fetchProfile: async () => makeSharedProfile({ profileVersion: 'DIFFERENT-VERSION' }) })
  );
  check(
    rStaleRead.ran === false && rStaleRead.reason === 'stale-read',
    "on-disk copy disagrees with this install's own independent read -> aborts rather than risk clobbering a concurrent write"
  );

  let setStateCalls = [];
  const rNoop = await PdcContribute.runPdcContribution(
    baseDeps({
      setState: async (patch) => {
        setStateCalls.push(patch);
      },
    })
  );
  check(rNoop.ran === true && rNoop.wrote === false, 'nothing new locally -> ran but did not write');
  check(
    setStateCalls.length === 1 && setStateCalls[0].lastContributedAt === '2026-08-03',
    'still records the attempt so it does not retry again today even on a no-op'
  );

  let writtenText = null;
  const handleForWrite = makeFakeHandle({ text: JSON.stringify(noopProfile) });
  const rWrote = await PdcContribute.runPdcContribution(
    baseDeps({
      loadHandle: async () => handleForWrite,
      getLocalPdc: async () => localPdc,
    })
  );
  check(rWrote.ran === true && rWrote.wrote === true, 'new local data + a published, readable profile -> writes');
  writtenText = handleForWrite._getText();
  const writtenJson = JSON.parse(writtenText);
  check(
    writtenJson.envelope.modules.problemDescriptionCleanup.preferredDescriptions['123'].tally['456'].count === 3,
    'the written file actually contains the new tally'
  );
  check(
    JSON.stringify(writtenJson.envelope.modules.sentinel) === JSON.stringify(noopProfile.envelope.modules.sentinel),
    'the written file carries every other module forward untouched'
  );

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  process.exit(failed > 0 ? 1 : 0);
})();
