// Medicus Suite v1.3.1 — Update Checker Tests
// Run with: node test-update-checker.js

'use strict';

// Mock chrome before loading the module
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
      set: async (obj) => { Object.assign(mockStore, obj); },
    },
  },
  runtime: { getManifest: () => ({ version: '1.3.1' }) },
};

const UC = require('./shared/update-checker.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

// ── Version normalisation ────────────────────────────────────────────────────

console.log('\n--- normaliseVersion ---');
assert(UC.normaliseVersion('v1.2.3') === '1.2.3', 'strips leading v');
assert(UC.normaliseVersion('V1.2.3') === '1.2.3', 'strips leading V (case-insensitive)');
assert(UC.normaliseVersion('1.2.3') === '1.2.3', 'passes through if no v');
assert(UC.normaliseVersion('  v1.2.3  ') === '1.2.3', 'trims whitespace');
assert(UC.normaliseVersion(null) === '', 'null → empty');
assert(UC.normaliseVersion(undefined) === '', 'undefined → empty');

// ── Comparison ───────────────────────────────────────────────────────────────

console.log('\n--- compareVersions ---');
assert(UC.compareVersions('1.0.0', '1.0.0') === 0, 'equal versions');
assert(UC.compareVersions('1.0.1', '1.0.0') === 1, 'patch greater');
assert(UC.compareVersions('1.1.0', '1.0.9') === 1, 'minor greater');
assert(UC.compareVersions('2.0.0', '1.99.99') === 1, 'major greater');
assert(UC.compareVersions('1.0.0', '1.0.1') === -1, 'patch less');
assert(UC.compareVersions('v1.3.0', '1.3.0') === 0, 'leading v ignored');
assert(UC.compareVersions('1.3', '1.3.0') === 0, 'missing patch treated as 0');
assert(UC.compareVersions('1.3.0', '1.3') === 0, 'extra zero patch equal');

console.log('\n--- isNewer ---');
assert(UC.isNewer('1.3.1', '1.3.0') === true, 'newer patch');
assert(UC.isNewer('v1.3.1', '1.3.0') === true, 'newer with v prefix');
assert(UC.isNewer('1.3.0', '1.3.0') === false, 'same version not newer');
assert(UC.isNewer('1.2.9', '1.3.0') === false, 'older not newer');
assert(UC.isNewer('', '1.3.0') === false, 'empty latest never newer');

// ── checkForUpdate ────────────────────────────────────────────────────────────

(async () => {
  console.log('\n--- checkForUpdate (mocked fetch) ---');

  // Clear store
  for (const k of Object.keys(mockStore)) delete mockStore[k];

  const mockReleaseResponse = {
    tag_name: 'v1.4.0',
    html_url: 'https://github.com/davetriska02-collab/medicus-suite/releases/tag/v1.4.0',
    body: '## What\'s new\nFeature X, fix Y',
    assets: [
      { name: 'medicus-suite-v1.4.0.zip', browser_download_url: 'https://github.com/.../medicus-suite-v1.4.0.zip' },
    ],
    zipball_url: 'https://api.github.com/.../zipball/v1.4.0',
  };

  const mockFetch = async (url) => ({
    ok: true,
    json: async () => mockReleaseResponse,
  });

  const r1 = await UC.checkForUpdate({ fetchImpl: mockFetch });
  assert(r1.ok === true, 'checkForUpdate: ok on success');
  assert(r1.latestVersion === '1.4.0', 'checkForUpdate: latest version extracted and v stripped');
  assert(r1.downloadUrl.endsWith('.zip'), 'checkForUpdate: prefers zip asset over zipball');
  assert(r1.releaseUrl.includes('releases/tag/v1.4.0'), 'checkForUpdate: release URL captured');

  // Second call within cooldown should be skipped
  let fetchCallCount = 0;
  const countingFetch = async () => {
    fetchCallCount++;
    return { ok: true, json: async () => mockReleaseResponse };
  };
  const r2 = await UC.checkForUpdate({ fetchImpl: countingFetch });
  assert(r2.ok === true && r2.skipped === true, 'checkForUpdate: respects cooldown');
  assert(fetchCallCount === 0, 'checkForUpdate: no fetch on cooldown skip');

  // Force flag bypasses cooldown
  const r3 = await UC.checkForUpdate({ force: true, fetchImpl: countingFetch });
  assert(r3.ok === true && !r3.skipped, 'checkForUpdate: force bypasses cooldown');
  assert(fetchCallCount === 1, 'checkForUpdate: force triggers actual fetch');

  // Error handling — HTTP 404
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  const mockFetch404 = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const rErr = await UC.checkForUpdate({ fetchImpl: mockFetch404 });
  assert(rErr.ok === false, 'checkForUpdate: ok=false on HTTP error');
  assert(rErr.error.includes('404'), 'checkForUpdate: error includes status code');

  // Network error
  const mockFetchThrows = async () => { throw new Error('DNS lookup failed'); };
  const rNet = await UC.checkForUpdate({ force: true, fetchImpl: mockFetchThrows });
  assert(rNet.ok === false && rNet.error.includes('DNS'), 'checkForUpdate: network error captured');

  // No zip asset — falls back to zipball_url
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  const responseNoAssets = { ...mockReleaseResponse, assets: [], zipball_url: 'https://fallback.zip' };
  const rFallback = await UC.checkForUpdate({ fetchImpl: async () => ({ ok: true, json: async () => responseNoAssets }) });
  assert(rFallback.downloadUrl === 'https://fallback.zip', 'checkForUpdate: falls back to zipball_url when no zip asset');

  // ── isUpdateAvailable ─────────────────────────────────────────────────────
  console.log('\n--- isUpdateAvailable ---');
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  await UC.checkForUpdate({ force: true, fetchImpl: mockFetch });
  // Mock manifest version is 1.3.1, latest is 1.4.0 → update available
  const avail = await UC.isUpdateAvailable();
  assert(avail === true, 'isUpdateAvailable: true when GitHub has newer version');

  // Now set latestVersion to match installed
  global.chrome.runtime.getManifest = () => ({ version: '1.4.0' });
  const noAvail = await UC.isUpdateAvailable();
  assert(noAvail === false, 'isUpdateAvailable: false when GitHub matches installed');

  // And when GitHub is older (shouldn't happen but defensive)
  global.chrome.runtime.getManifest = () => ({ version: '1.5.0' });
  const stale = await UC.isUpdateAvailable();
  assert(stale === false, 'isUpdateAvailable: false when installed is ahead of GitHub');

  // ── getState ──────────────────────────────────────────────────────────────
  console.log('\n--- getState ---');
  const state = await UC.getState();
  assert(state.latestVersion === '1.4.0', 'getState: returns stored latestVersion');
  assert(state.releaseUrl?.includes('github.com'), 'getState: returns stored releaseUrl');
  assert(state.checkedAt > 0, 'getState: checkedAt is a timestamp');

  // ── Hardcoded URL sanity ──────────────────────────────────────────────────
  console.log('\n--- Hardcoded constants ---');
  assert(UC.REPO_OWNER === 'davetriska02-collab', 'REPO_OWNER points to Dave\'s repo');
  assert(UC.REPO_NAME === 'medicus-suite', 'REPO_NAME is medicus-suite');
  assert(UC.RELEASES_URL.includes('davetriska02-collab/medicus-suite'), 'RELEASES_URL is correctly assembled');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})();
