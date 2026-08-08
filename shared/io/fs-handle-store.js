// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — persisted FileSystemFileHandle store.
//
// Extracted from options.js (the Practice Profile "Publish to shared folder"
// flow), which originally kept its own private openHandleDB/loadFileHandle/
// saveFileHandle trio hardcoded to a single key ('profileFile'). Generalised
// here (an explicit `key` argument, defaulting to 'profileFile' so every
// existing options.js call site is unchanged) so shared/io/pdc-contribute.js
// can store a SEPARATE handle ('pdcContribFile') under the same IndexedDB
// database without either flow reaching into the other's storage.
//
// A FileSystemFileHandle is only ever usable from a page context (options.js,
// the side panel) — never the MV3 service worker — and only once a human has
// granted it via a picker. This module does not change that; it only persists
// whatever handle was already granted, across reloads.

'use strict';

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('medicus-suite-pp', 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore('handles');
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function loadFileHandle(key) {
  const storeKey = key || 'profileFile';
  try {
    const db = await openHandleDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get(storeKey);
      req.onsuccess = (e) => resolve(e.target.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (_) {
    return null;
  }
}

async function saveFileHandle(handle, key) {
  const storeKey = key || 'profileFile';
  try {
    const db = await openHandleDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      const req = tx.objectStore('handles').put(handle, storeKey);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  } catch (_) {}
}

const api = { openHandleDB, loadFileHandle, saveFileHandle };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof self !== 'undefined') {
  self.FsHandleStore = api;
}
