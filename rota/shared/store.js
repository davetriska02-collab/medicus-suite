// Persistence: chrome.storage.local in the extension, localStorage fallback
// so app/app.html can be opened in a plain browser tab during development.
// No patient-identifiable data is ever persisted by this product.

import { DEFAULT_SETTINGS } from './model.js';

const KEYS = {
  staff: 'rota.staff',
  entries: 'rota.entries',
  leave: 'rota.leave',
  rooms: 'rota.rooms',
  swaps: 'rota.swaps',
  audit: 'rota.audit',
  demand: 'rota.demand',
  settings: 'rota.settings',
};

const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

async function rawGet(keys) {
  if (hasChrome) return chrome.storage.local.get(keys);
  const out = {};
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v !== null) out[k] = JSON.parse(v);
  }
  return out;
}

async function rawSet(obj) {
  if (hasChrome) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) localStorage.setItem(k, JSON.stringify(v));
}

async function rawClear(keys) {
  if (hasChrome) return chrome.storage.local.remove(keys);
  for (const k of keys) localStorage.removeItem(k);
}

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1296;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + counter.toString(36);
}

export async function loadAll() {
  const got = await rawGet(Object.values(KEYS));
  return {
    staff: got[KEYS.staff] || [],
    entries: got[KEYS.entries] || [],
    leave: got[KEYS.leave] || [],
    rooms: got[KEYS.rooms] || [],
    swaps: got[KEYS.swaps] || [],
    audit: got[KEYS.audit] || [],
    demand: got[KEYS.demand] || { days: {}, pulledAt: '' },
    settings: { ...DEFAULT_SETTINGS, ...(got[KEYS.settings] || {}) },
  };
}

export async function save(part, value) {
  if (!KEYS[part]) throw new Error(`Unknown store part: ${part}`);
  await rawSet({ [KEYS[part]]: value });
}

export async function wipe() {
  await rawClear(Object.values(KEYS));
}

// Backup envelope, same shape philosophy as the Medicus Suite:
// versioned format + named scopes, forward-compatible on import.
export async function exportEnvelope() {
  const data = await loadAll();
  return {
    format: 1,
    product: 'medicus-rota-manager',
    exportedAt: new Date().toISOString(),
    scopes: {
      staff: data.staff,
      entries: data.entries,
      leave: data.leave,
      rooms: data.rooms,
      swaps: data.swaps,
      audit: data.audit,
      demand: data.demand,
      settings: data.settings,
    },
  };
}

export async function importEnvelope(envelope) {
  if (!envelope || envelope.product !== 'medicus-rota-manager' || envelope.format !== 1) {
    throw new Error('Not a Medicus Rota Manager backup file');
  }
  const s = envelope.scopes || {};
  if (Array.isArray(s.staff)) await save('staff', s.staff);
  if (Array.isArray(s.entries)) await save('entries', s.entries);
  if (Array.isArray(s.leave)) await save('leave', s.leave);
  if (Array.isArray(s.rooms)) await save('rooms', s.rooms);
  if (Array.isArray(s.swaps)) await save('swaps', s.swaps);
  if (Array.isArray(s.audit)) await save('audit', s.audit);
  if (s.demand && typeof s.demand === 'object') await save('demand', s.demand);
  if (s.settings && typeof s.settings === 'object') {
    await save('settings', { ...DEFAULT_SETTINGS, ...s.settings });
  }
}
