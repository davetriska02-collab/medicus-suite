// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — UI-state persistence helper
//
// Stores per-module view preferences (selected tabs, filters, search text, etc.)
// in a SINGLE chrome.storage.local key: 'suite.uiState'.
//
// Shape of suite.uiState:
//   {
//     [moduleName]: {
//       savedAt: <epoch ms>,   // when the state was last persisted
//       state: { ... }         // module-specific payload (opaque to this helper)
//     }
//   }
//
// Design notes:
//   - This is per-machine view preference. It is deliberately NOT included in
//     suite backups (suite.uiState is on the ALLOWLIST in test-backup-coverage.js).
//   - TTL defaults to 24 h. Expired entries return null so modules fall back to
//     their own defaults naturally — no "restore a stale filter from last week".
//   - Writes are a full read-merge-write of the top-level key to avoid races
//     between concurrent module switches. Callers must NOT call saveUiState on
//     every render tick — only on discrete user actions (or debounced for text).
//   - No external dependencies; chrome.storage.local is the only API used.

'use strict';

const STORAGE_KEY = 'suite.uiState';

/**
 * Load saved view-state for a module.
 *
 * @param {string} moduleName   - e.g. 'trends', 'slots'
 * @param {{ ttlMs?: number }}  - options; ttlMs defaults to 24 h
 * @returns {Promise<object|null>} the saved state object, or null if absent/expired
 */
export async function loadUiState(moduleName, { ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const root = r[STORAGE_KEY];
    if (!root || typeof root !== 'object') return null;

    const entry = root[moduleName];
    if (!entry || typeof entry !== 'object') return null;

    // Validate shape
    if (typeof entry.savedAt !== 'number' || typeof entry.state !== 'object' || entry.state === null) return null;

    // TTL check
    if (Date.now() - entry.savedAt > ttlMs) return null;

    return entry.state;
  } catch (_) {
    // Any storage read error → treat as no saved state
    return null;
  }
}

/**
 * Persist view-state for a module.
 * Merges into the shared 'suite.uiState' key — reads first to preserve other
 * modules' entries, then writes back.
 *
 * @param {string} moduleName  - e.g. 'trends', 'slots'
 * @param {object} stateObj    - the state snapshot to save (shallow-cloned)
 * @returns {Promise<void>}
 */
export async function saveUiState(moduleName, stateObj) {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEY);
    const root = r[STORAGE_KEY] && typeof r[STORAGE_KEY] === 'object' ? r[STORAGE_KEY] : {};

    root[moduleName] = {
      savedAt: Date.now(),
      state: { ...stateObj },
    };

    await chrome.storage.local.set({ [STORAGE_KEY]: root });
  } catch (_) {
    // Storage write failures are silent — the UI degrades gracefully to defaults
  }
}
