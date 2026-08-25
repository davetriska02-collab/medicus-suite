// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — lab allocation canvas IO (favourite destinations).
//
// Favourites are clinician column keys (`clinician:surname|i`). They are a
// personal ordering preference, not patient data and not a write. An imported
// key that is not a clinician: key is dropped — a backup must never invent a
// drop target.

'use strict';

const LAB_ALLOCATE_KEYS = ['labAllocate.favourites'];
const FAV_CAP = 24;
const FAV_KEY_RE = /^clinician:[a-z0-9| .'-]{1,80}$/i;

function sanitiseFavouriteKeys(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const k = item.trim();
    if (!FAV_KEY_RE.test(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= FAV_CAP) break;
  }
  return out;
}

function asStore(raw) {
  const keys = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? raw.keys : [];
  return { version: 1, keys: sanitiseFavouriteKeys(keys) };
}

async function labAllocateExport() {
  const r = await chrome.storage.local.get(LAB_ALLOCATE_KEYS);
  return { favourites: asStore(r['labAllocate.favourites']) };
}

async function labAllocateImport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('labAllocate must be an object.');
  }
  if (data.favourites === undefined) return;
  await chrome.storage.local.set({ 'labAllocate.favourites': asStore(data.favourites) });
}

if (typeof window !== 'undefined') {
  window.labAllocateExport = labAllocateExport;
  window.labAllocateImport = labAllocateImport;
  window.LAB_ALLOCATE_KEYS = LAB_ALLOCATE_KEYS;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    labAllocateExport,
    labAllocateImport,
    LAB_ALLOCATE_KEYS,
    sanitiseFavouriteKeys,
    asStore,
  };
}
