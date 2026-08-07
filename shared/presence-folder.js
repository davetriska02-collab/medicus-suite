// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — task-presence folder store
//
// THE PRACTICE'S OWN SHARED FOLDER IS THE STORE (user decision 2026-08-04:
// "the practice extension folder acts as the repository, not sending data off
// somewhere else"). Practices already mount one shared folder on every
// machine — the one the unpacked extension loads from — so presence rides it:
//
//   <picked folder>/ms-presence/<site>-<staffId>.json
//
// One file PER STAFF MEMBER, written only by its owner (a heartbeat is a
// whole-file replace), so there is no locking problem and no write conflict
// by construction. Readers list the directory and TTL-filter, exactly as the
// hosted-store path filters its rows. Nothing leaves the practice network;
// there are no accounts and no credentials.
//
// ACCESS: the File System Access API. A human picks the folder ONCE per
// machine (Options → Task Presence → "Choose folder" — a picker requires a
// user gesture; that single click is the irreducible setup). The directory
// handle persists in extension IndexedDB; Chrome's persistent-permission
// prompt ("Allow on every visit") makes the grant survive restarts. The
// service worker then does all IO on behalf of the content script — the
// content script itself never touches the filesystem.
//
// This module is loaded by BOTH the service worker (importScripts) and the
// options page (script tag), and its pure helpers are require()able by node
// tests — hence the global/module export shape (same pattern as txn-config).

(function (global) {
  'use strict';

  var DIR_NAME = 'ms-presence';
  var MAX_FILE_BYTES = 4096; // a beat file is ~200 bytes; anything big is junk
  var GC_AGE_MS = 24 * 60 * 60 * 1000; // opportunistic cleanup of dead files
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SITE_RE = /^[0-9a-z]{2,12}$/i;

  // ── pure helpers (node-testable) ──────────────────────────────────────────

  // '<site>-<staffId>.json' — one file per staff member per site, so a writer
  // only ever replaces its OWN file. Returns null on any invalid part rather
  // than building a path from unchecked input.
  function beatFileName(site, staffId) {
    if (typeof site !== 'string' || !SITE_RE.test(site)) return null;
    if (typeof staffId !== 'string' || !UUID_RE.test(staffId)) return null;
    return site.toLowerCase() + '-' + staffId.toLowerCase() + '.json';
  }

  function parseBeatFileName(name) {
    if (typeof name !== 'string') return null;
    var m = name.match(/^([0-9a-z]{2,12})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/i);
    if (!m) return null;
    return { site: m[1].toLowerCase(), staffId: m[2].toLowerCase() };
  }

  // Validate + normalise one beat row (same snake_case shape as the hosted
  // store, so the content script's activeOthers filter works unchanged).
  // Null on anything malformed — folder contents are UNTRUSTED (any process
  // on the practice network can write to the share).
  function sanitizeBeatRow(row) {
    if (!row || typeof row !== 'object') return null;
    if (typeof row.site !== 'string' || !SITE_RE.test(row.site)) return null;
    if (typeof row.task_uuid !== 'string' || !UUID_RE.test(row.task_uuid)) return null;
    if (typeof row.staff_id !== 'string' || !UUID_RE.test(row.staff_id)) return null;
    var opened = Date.parse(row.opened_at);
    var seen = Date.parse(row.last_seen);
    if (!isFinite(seen)) return null;
    return {
      site: row.site.toLowerCase(),
      task_uuid: row.task_uuid.toLowerCase(),
      staff_id: row.staff_id.toLowerCase(),
      staff_label:
        typeof row.staff_label === 'string' && row.staff_label.trim()
          ? row.staff_label.trim().slice(0, 60)
          : 'A colleague',
      opened_at: isFinite(opened) ? new Date(opened).toISOString() : new Date(seen).toISOString(),
      last_seen: new Date(seen).toISOString(),
    };
  }

  function serializeBeatRow(row) {
    var clean = sanitizeBeatRow(row);
    if (!clean) return null;
    return JSON.stringify(clean);
  }

  function parseBeatFile(text) {
    if (typeof text !== 'string' || !text || text.length > MAX_FILE_BYTES) return null;
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      return null;
    }
    return sanitizeBeatRow(parsed);
  }

  // ── handle persistence (IndexedDB, extension origin) ──────────────────────
  var DB_NAME = 'ms-presence-store';
  var STORE = 'handles';
  var KEY = 'root';

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

  function saveHandle(handle) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, KEY);
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

  function loadHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).get(KEY);
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

  function clearHandle() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
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

  // ── folder IO (used by the service worker; handle-first arguments) ────────

  // 'granted' | 'prompt' | 'denied' | 'none'. queryPermission never prompts —
  // prompting needs a user gesture and lives in the Options page only.
  function permissionState(handle) {
    if (!handle || typeof handle.queryPermission !== 'function') return Promise.resolve('none');
    return handle.queryPermission({ mode: 'readwrite' }).then(
      function (p) {
        return p;
      },
      function () {
        return 'none';
      }
    );
  }

  function presenceDir(root, create) {
    return root.getDirectoryHandle(DIR_NAME, { create: !!create });
  }

  // Write this user's own beat file (whole-file replace — the folder-store
  // equivalent of the hosted upsert; opened_at must therefore be supplied on
  // EVERY beat, from the beacon's local state).
  async function writeBeat(root, row) {
    var name = beatFileName(row && row.site, row && row.staff_id);
    var body = serializeBeatRow(row);
    if (!name || !body) throw new Error('invalid beat row');
    var dir = await presenceDir(root, true);
    var fh = await dir.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(body);
    await w.close();
  }

  async function clearBeat(root, site, staffId) {
    var name = beatFileName(site, staffId);
    if (!name) return;
    try {
      var dir = await presenceDir(root, false);
      await dir.removeEntry(name);
    } catch (_) {
      /* no dir / no file — already clear */
    }
  }

  // All fresh-enough beats for a site. Skips unreadable/junk files silently —
  // the share is a shared surface and a colleague's half-written beat (or a
  // stray file) must never break everyone's read.
  async function readAllBeats(root, site, nowMs, ttlMs) {
    var out = [];
    var dir;
    try {
      dir = await presenceDir(root, false);
    } catch (_) {
      return out; // directory not created yet — nobody has beaten
    }
    var wantSite = typeof site === 'string' ? site.toLowerCase() : '';
    for await (var entry of dir.values()) {
      if (entry.kind !== 'file') continue;
      var named = parseBeatFileName(entry.name);
      if (!named || (wantSite && named.site !== wantSite)) continue;
      try {
        var file = await entry.getFile();
        if (file.size > MAX_FILE_BYTES) continue;
        var row = parseBeatFile(await file.text());
        if (!row) continue;
        // The filename is the write-authorisation unit — a row claiming a
        // different staff_id/site than its own filename is junk.
        if (row.staff_id !== named.staffId || row.site !== named.site) continue;
        out.push(row);
      } catch (_) {
        /* mid-write / vanished / unreadable — skip */
      }
    }
    // Opportunistic GC: delete long-dead files (log-off leftovers). Never
    // touches anything fresh enough to matter; failures are silent.
    if (typeof nowMs === 'number' && typeof ttlMs === 'number') {
      try {
        for await (var e2 of dir.values()) {
          if (e2.kind !== 'file') continue;
          var n2 = parseBeatFileName(e2.name);
          if (!n2) continue;
          try {
            var f2 = await e2.getFile();
            if (nowMs - f2.lastModified > GC_AGE_MS) await dir.removeEntry(e2.name);
          } catch (_) {}
        }
      } catch (_) {}
    }
    return out;
  }

  var api = {
    DIR_NAME: DIR_NAME,
    beatFileName: beatFileName,
    parseBeatFileName: parseBeatFileName,
    sanitizeBeatRow: sanitizeBeatRow,
    serializeBeatRow: serializeBeatRow,
    parseBeatFile: parseBeatFile,
    saveHandle: saveHandle,
    loadHandle: loadHandle,
    clearHandle: clearHandle,
    permissionState: permissionState,
    writeBeat: writeBeat,
    clearBeat: clearBeat,
    readAllBeats: readAllBeats,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.PresenceFolder = api;
})(typeof self !== 'undefined' ? self : this);
