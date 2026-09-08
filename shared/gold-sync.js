// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — gold-copy → local-clone sync
//
// Why this exists: some PCs Load unpacked from the practice share and that
// is fine (the drive is up at browser start). Other PCs lose the race —
// Edge/Chrome starts before Y: is mapped — and drop the unpacked extension.
// Those machines Load unpacked from a local clone. Updates still live on
// the gold copy. After each of *those* machines picks both folders once,
// this module copies newer gold files onto the local clone so they never
// open chrome://extensions again.
//
// Same shape as shared/presence-folder.js: pure helpers are node-testable;
// handle persistence + FSA IO run in the service worker and the Options
// page. Picker / requestPermission stay on Options (they need a gesture).

(function (global) {
  'use strict';

  var VERSION_RE = /^\d+\.\d+\.\d+$/;
  var EXCLUDE_DIRS = {
    '.git': true,
    '.github': true,
    '.claude': true,
    '.githooks': true,
    node_modules: true,
    _build: true,
    'ms-presence': true,
  };
  var EXCLUDE_FILES = { '.DS_Store': true };
  var DATA_FILES = ['practice-profile.json', 'presence-config.json'];
  var META_KEY = 'suite.goldSync';
  var DB_NAME = 'ms-gold-sync';
  var STORE = 'handles';
  var GOLD_KEY = 'gold';
  var LOCAL_KEY = 'local';

  function parseVersion(v) {
    if (typeof v !== 'string' || !VERSION_RE.test(v)) return null;
    var parts = v.split('.');
    return {
      major: parseInt(parts[0], 10),
      minor: parseInt(parts[1], 10),
      patch: parseInt(parts[2], 10),
    };
  }

  function compareVersions(a, b) {
    var A = parseVersion(a);
    var B = parseVersion(b);
    if (!A || !B) return null;
    if (A.major !== B.major) return A.major < B.major ? -1 : 1;
    if (A.minor !== B.minor) return A.minor < B.minor ? -1 : 1;
    if (A.patch !== B.patch) return A.patch < B.patch ? -1 : 1;
    return 0;
  }

  function shouldSkipDir(name) {
    if (typeof name !== 'string' || !name) return true;
    if (name.charAt(0) === '.') return true;
    return !!EXCLUDE_DIRS[name.toLowerCase()];
  }

  function shouldSkipFile(name) {
    if (typeof name !== 'string' || !name) return true;
    if (EXCLUDE_FILES[name]) return true;
    if (name.indexOf('test-') === 0 && /\.js$/i.test(name)) return true;
    return false;
  }

  // 'none' = nothing to do / cannot sync
  // 'data' = same suite version — copy practice-profile.json (+ presence-config)
  // 'full' = gold version differs from running or local — copy the tree
  function decideSync(goldVersion, localVersion, runningVersion) {
    if (!parseVersion(goldVersion)) return { mode: 'none', reason: 'gold-bad-version' };
    if (!parseVersion(runningVersion)) return { mode: 'none', reason: 'running-bad-version' };
    if (goldVersion !== runningVersion || goldVersion !== localVersion) {
      return { mode: 'full', reason: 'version-mismatch' };
    }
    return { mode: 'data', reason: 'same-version' };
  }

  // ── handle persistence ────────────────────────────────────────────────────

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function putHandle(key, handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, key);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function getHandle(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () {
          db.close();
          resolve(req.result || null);
        };
        req.onerror = function () {
          db.close();
          reject(req.error);
        };
      });
    });
  }

  function deleteHandle(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function permissionState(handle, mode) {
    if (!handle || typeof handle.queryPermission !== 'function') return Promise.resolve('none');
    var m = mode || 'read';
    return handle.queryPermission({ mode: m }).then(
      function (p) {
        return p;
      },
      function () {
        return 'none';
      }
    );
  }

  // ── folder IO ─────────────────────────────────────────────────────────────

  async function readManifestVersion(dir) {
    if (!dir) return null;
    try {
      var fh = await dir.getFileHandle('manifest.json');
      var file = await fh.getFile();
      var json = JSON.parse(await file.text());
      return typeof json.version === 'string' && VERSION_RE.test(json.version) ? json.version : null;
    } catch (_) {
      return null;
    }
  }

  async function copyFile(srcEntry, destDir) {
    var srcFile = await srcEntry.getFile();
    var destFh = await destDir.getFileHandle(srcEntry.name, { create: true });
    try {
      var destFile = await destFh.getFile();
      if (destFile.size === srcFile.size && destFile.lastModified === srcFile.lastModified) return false;
    } catch (_) {
      /* dest missing or unreadable — write */
    }
    var w = await destFh.createWritable();
    await w.write(await srcFile.arrayBuffer());
    await w.close();
    return true;
  }

  async function copyNamedFiles(srcDir, destDir, names) {
    var copied = 0;
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      try {
        var fh = await srcDir.getFileHandle(name);
        if (await copyFile(fh, destDir)) copied += 1;
      } catch (_) {
        /* gold does not have this optional file */
      }
    }
    return copied;
  }

  async function copyTree(srcDir, destDir) {
    var copied = 0;
    var deferredManifest = null;

    async function walk(src, dest, top) {
      for await (var entry of src.values()) {
        if (entry.kind === 'directory') {
          if (shouldSkipDir(entry.name)) continue;
          var sub = await dest.getDirectoryHandle(entry.name, { create: true });
          await walk(entry, sub, false);
        } else {
          if (shouldSkipFile(entry.name)) continue;
          if (top && entry.name === 'manifest.json') {
            deferredManifest = { entry: entry, dest: dest };
            continue;
          }
          if (await copyFile(entry, dest)) copied += 1;
        }
      }
    }

    await walk(srcDir, destDir, true);
    if (deferredManifest) {
      if (await copyFile(deferredManifest.entry, deferredManifest.dest)) copied += 1;
    }
    return copied;
  }

  async function sync(goldDir, localDir, runningVersion) {
    if (!goldDir || !localDir) return { ok: false, reason: 'not-configured', copied: 0 };
    if (typeof goldDir.isSameEntry === 'function') {
      try {
        if (await goldDir.isSameEntry(localDir)) {
          return { ok: false, reason: 'same-folder', copied: 0 };
        }
      } catch (_) {
        /* isSameEntry can throw on stale handles — continue and let IO fail */
      }
    }
    var goldVersion = await readManifestVersion(goldDir);
    var localVersion = await readManifestVersion(localDir);
    var plan = decideSync(goldVersion, localVersion, runningVersion);
    if (plan.mode === 'none') return { ok: false, reason: plan.reason, goldVersion: goldVersion, localVersion: localVersion, copied: 0 };

    var copied = plan.mode === 'full' ? await copyTree(goldDir, localDir) : await copyNamedFiles(goldDir, localDir, DATA_FILES);

    return {
      ok: true,
      mode: plan.mode,
      reason: plan.reason,
      goldVersion: goldVersion,
      localVersion: goldVersion,
      copied: copied,
    };
  }

  var api = {
    VERSION_RE: VERSION_RE,
    DATA_FILES: DATA_FILES,
    META_KEY: META_KEY,
    parseVersion: parseVersion,
    compareVersions: compareVersions,
    shouldSkipDir: shouldSkipDir,
    shouldSkipFile: shouldSkipFile,
    decideSync: decideSync,
    permissionState: permissionState,
    readManifestVersion: readManifestVersion,
    copyNamedFiles: copyNamedFiles,
    copyTree: copyTree,
    sync: sync,
    saveGold: function (handle) {
      return putHandle(GOLD_KEY, handle);
    },
    saveLocal: function (handle) {
      return putHandle(LOCAL_KEY, handle);
    },
    loadGold: function () {
      return getHandle(GOLD_KEY).catch(function () {
        return null;
      });
    },
    loadLocal: function () {
      return getHandle(LOCAL_KEY).catch(function () {
        return null;
      });
    },
    clearGold: function () {
      return deleteHandle(GOLD_KEY);
    },
    clearLocal: function () {
      return deleteHandle(LOCAL_KEY);
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.GoldSync = api;
})(typeof self !== 'undefined' ? self : this);
