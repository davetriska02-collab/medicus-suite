// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Local bits detector (practice OS-sync, not GitHub).
//
// After Pete's Windows helper copies a newer tree onto THIS machine's Load
// unpacked Source, the files on disk are already new but the running worker
// is still the old version until chrome.runtime.reload().
//
// This module ONLY reads files from the install dir via chrome.runtime.getURL
// (cache: 'no-store'). It never writes the package, never opens a UNC path,
// and never copies bits. That is the helper's job.
//
// Stamps (all optional, all local):
//   suite-release.json  — Pete drops this in the reference tree; robocopy
//                         brings it along. format === 'medicus-suite-release'
//   sync-status.json    — helper may write this AFTER a successful promote
//   manifest.json       — fallback disk semver (same as the old watcher)
//
// Storage keys (do NOT reuse the GitHub Releases keys from update-checker.js):
//   suite.localBits.diskVersion
//   suite.localBits.runningVersion
//   suite.localBits.status     current | ready | older-ignored | not-ready | unknown
//   suite.localBits.source     suite-release | sync-status | manifest | none
//   suite.localBits.practiceManaged  bool — a practice stamp was present
//   suite.localBits.checkedAt
//   suite.localBits.allowDowngrade
//   suite.localBits.error
//
// Loads in the service worker (importScripts) and Options / panel (<script>).

(function (global) {
  'use strict';

  const RELEASE_FORMAT = 'medicus-suite-release';
  const SYNC_FORMAT = 'medicus-suite-sync-status';
  const VERSION_RE = /^\d+\.\d+\.\d+$/;

  const STORAGE_KEYS = {
    diskVersion: 'suite.localBits.diskVersion',
    runningVersion: 'suite.localBits.runningVersion',
    status: 'suite.localBits.status',
    source: 'suite.localBits.source',
    practiceManaged: 'suite.localBits.practiceManaged',
    checkedAt: 'suite.localBits.checkedAt',
    allowDowngrade: 'suite.localBits.allowDowngrade',
    error: 'suite.localBits.error',
  };

  function normaliseVersion(v) {
    if (!v) return '';
    return String(v)
      .trim()
      .replace(/^v/i, '');
  }

  function compareVersions(a, b) {
    if (global.UpdateChecker && typeof global.UpdateChecker.compareVersions === 'function') {
      return global.UpdateChecker.compareVersions(a, b);
    }
    const pa = normaliseVersion(a)
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
    const pb = normaliseVersion(b)
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function isNewer(latest, current) {
    return compareVersions(latest, current) > 0;
  }

  function isValidVersion(v) {
    return VERSION_RE.test(normaliseVersion(v));
  }

  function getInstalledVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return null;
    }
  }

  async function fetchJson(relativePath, fetchImpl) {
    const _fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!_fetch || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
      return { ok: false, missing: true };
    }
    const url = chrome.runtime.getURL(relativePath);
    // Defence: we only ever resolve chrome-extension:// URLs. A caller that
    // handed us a file: / UNC path never reaches fetch.
    if (typeof url === 'string' && !url.startsWith('chrome-extension://') && !url.startsWith('chrome://')) {
      return { ok: false, error: 'refused-non-extension-url' };
    }
    try {
      const resp = await _fetch(url, { cache: 'no-store' });
      if (!resp || !resp.ok) return { ok: false, missing: true, status: resp && resp.status };
      const data = await resp.json();
      return { ok: true, data };
    } catch (_) {
      return { ok: false, missing: true };
    }
  }

  function readReleaseStamp(data) {
    if (!data || data.format !== RELEASE_FORMAT) return null;
    const version = normaliseVersion(data.version);
    if (!isValidVersion(version)) return null;
    return {
      source: 'suite-release',
      version,
      ready: data.ready === true,
      allowDowngrade: data.allowDowngrade === true,
    };
  }

  function readSyncStamp(data) {
    if (!data || data.format !== SYNC_FORMAT) return null;
    const version = normaliseVersion(data.copiedVersion || data.version);
    if (!isValidVersion(version)) return null;
    if (data.ok !== true) return { source: 'sync-status', version, ready: false, allowDowngrade: false };
    return { source: 'sync-status', version, ready: true, allowDowngrade: false };
  }

  function readManifestStamp(data) {
    const version = normaliseVersion(data && data.version);
    if (!isValidVersion(version)) return null;
    return { source: 'manifest', version, ready: true, allowDowngrade: false };
  }

  function decide(stamp, runningVersion) {
    if (!stamp) {
      return {
        status: 'unknown',
        diskVersion: null,
        runningVersion,
        source: 'none',
        practiceManaged: false,
        allowDowngrade: false,
        shouldReload: false,
      };
    }
    if (!stamp.ready) {
      return {
        status: 'not-ready',
        diskVersion: stamp.version,
        runningVersion,
        source: stamp.source,
        practiceManaged: stamp.source !== 'manifest',
        allowDowngrade: !!stamp.allowDowngrade,
        shouldReload: false,
      };
    }
    const cmp = compareVersions(stamp.version, runningVersion);
    if (cmp === 0) {
      return {
        status: 'current',
        diskVersion: stamp.version,
        runningVersion,
        source: stamp.source,
        practiceManaged: stamp.source !== 'manifest',
        allowDowngrade: !!stamp.allowDowngrade,
        shouldReload: false,
      };
    }
    if (cmp < 0 && !stamp.allowDowngrade) {
      return {
        status: 'older-ignored',
        diskVersion: stamp.version,
        runningVersion,
        source: stamp.source,
        practiceManaged: stamp.source !== 'manifest',
        allowDowngrade: false,
        shouldReload: false,
      };
    }
    return {
      status: 'ready',
      diskVersion: stamp.version,
      runningVersion,
      source: stamp.source,
      practiceManaged: stamp.source !== 'manifest',
      allowDowngrade: !!stamp.allowDowngrade,
      shouldReload: true,
    };
  }

  async function inspect({ fetchImpl } = {}) {
    const runningVersion = getInstalledVersion();
    const release = await fetchJson('suite-release.json', fetchImpl);
    let stamp = null;
    let error = null;

    if (release.ok) {
      stamp = readReleaseStamp(release.data);
      if (!stamp) error = 'suite-release.json present but invalid';
    } else if (release.error === 'refused-non-extension-url') {
      error = release.error;
    }

    if (!stamp) {
      const sync = await fetchJson('sync-status.json', fetchImpl);
      if (sync.ok) stamp = readSyncStamp(sync.data);
    }

    if (!stamp) {
      const manifest = await fetchJson('manifest.json', fetchImpl);
      if (manifest.ok) stamp = readManifestStamp(manifest.data);
    }

    const result = decide(stamp, runningVersion);
    result.error = error;
    result.checkedAt = Date.now();
    return result;
  }

  async function persist(result) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return result;
    await chrome.storage.local.set({
      [STORAGE_KEYS.diskVersion]: result.diskVersion,
      [STORAGE_KEYS.runningVersion]: result.runningVersion,
      [STORAGE_KEYS.status]: result.status,
      [STORAGE_KEYS.source]: result.source,
      [STORAGE_KEYS.practiceManaged]: !!result.practiceManaged,
      [STORAGE_KEYS.checkedAt]: result.checkedAt,
      [STORAGE_KEYS.allowDowngrade]: !!result.allowDowngrade,
      [STORAGE_KEYS.error]: result.error || null,
    });
    return result;
  }

  async function checkAndPersist({ fetchImpl } = {}) {
    const result = await inspect({ fetchImpl });
    await persist(result);
    return result;
  }

  async function getState() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return {
        diskVersion: null,
        runningVersion: getInstalledVersion(),
        status: 'unknown',
        source: 'none',
        practiceManaged: false,
        checkedAt: null,
        allowDowngrade: false,
        error: null,
      };
    }
    const r = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
    return {
      diskVersion: r[STORAGE_KEYS.diskVersion] || null,
      runningVersion: r[STORAGE_KEYS.runningVersion] || getInstalledVersion(),
      status: r[STORAGE_KEYS.status] || 'unknown',
      source: r[STORAGE_KEYS.source] || 'none',
      practiceManaged: !!r[STORAGE_KEYS.practiceManaged],
      checkedAt: r[STORAGE_KEYS.checkedAt] || null,
      allowDowngrade: !!r[STORAGE_KEYS.allowDowngrade],
      error: r[STORAGE_KEYS.error] || null,
    };
  }

  function isReloadAvailable(state) {
    return !!(state && state.status === 'ready' && state.diskVersion && isNewer(state.diskVersion, state.runningVersion || ''));
  }

  const api = {
    RELEASE_FORMAT,
    SYNC_FORMAT,
    STORAGE_KEYS,
    normaliseVersion,
    compareVersions,
    isNewer,
    isValidVersion,
    getInstalledVersion,
    readReleaseStamp,
    readSyncStamp,
    readManifestStamp,
    decide,
    inspect,
    persist,
    checkAndPersist,
    getState,
    isReloadAvailable,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LocalBits = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
