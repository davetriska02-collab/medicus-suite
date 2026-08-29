// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Capacity Forecast IO helpers

'use strict';

const CAPACITY_KEYS = [
  'capacity.presets',
  'capacity.activePresetId',
  'capacity.viewMode',
  'capacity.showWeekends',
  'capacity.lookahead',
];

async function capacityExport() {
  const r = await chrome.storage.local.get(CAPACITY_KEYS);
  return {
    presets: r['capacity.presets'] ?? [],
    activePresetId: r['capacity.activePresetId'] ?? null,
    viewMode: r['capacity.viewMode'] ?? 'week',
    showWeekends: r['capacity.showWeekends'] ?? false,
    lookahead: r['capacity.lookahead'] ?? null,
  };
}

// Import capacity data.
// merge=false: replace all presets.
// merge=true: append imported presets, skipping those with conflicting IDs.
// Returns { conflicts: [{ existing, incoming }] } so the UI can prompt.
async function capacityImport(data, { merge = false } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Capacity data must be an object.');
  if (data.presets !== undefined && !Array.isArray(data.presets)) {
    throw new Error('capacity.presets must be an array.');
  }
  data.presets?.forEach((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`Preset at index ${i} is not an object.`);
    if (!p.id || typeof p.id !== 'string') throw new Error(`Preset at index ${i}: id is required.`);
    if (!p.name || typeof p.name !== 'string') throw new Error(`Preset at index ${i}: name is required.`);
  });
  const cleanPresets = Array.isArray(data.presets) ? data.presets.map(sanitiseImportedPreset).filter(Boolean) : null;

  const toSet = {};
  let conflicts = [];

  if (cleanPresets) {
    if (merge) {
      const existing = await chrome.storage.local.get('capacity.presets');
      const existingPresets = existing['capacity.presets'] || [];
      const existingIds = new Map(existingPresets.map((p) => [p.id, p]));
      const merged = [...existingPresets];
      for (const incoming of cleanPresets) {
        if (existingIds.has(incoming.id)) {
          conflicts.push({ existing: existingIds.get(incoming.id), incoming });
        } else {
          merged.push(incoming);
        }
      }
      toSet['capacity.presets'] = merged;
    } else {
      toSet['capacity.presets'] = cleanPresets;
    }
  }
  if (data.activePresetId !== undefined) toSet['capacity.activePresetId'] = data.activePresetId;
  if (data.viewMode !== undefined) {
    if (!['day', 'week', 'month'].includes(data.viewMode)) {
      throw new Error('viewMode must be "day", "week", or "month".');
    }
    toSet['capacity.viewMode'] = data.viewMode;
  }
  if (data.showWeekends !== undefined) toSet['capacity.showWeekends'] = !!data.showWeekends;
  if (data.lookahead !== undefined) {
    if (data.lookahead !== null && typeof data.lookahead !== 'object') {
      throw new Error('capacity.lookahead must be an object or null.');
    }
    toSet['capacity.lookahead'] = data.lookahead;
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  return { conflicts };
}

function sanitiseImportedPreset(p) {
  if (!p || typeof p !== 'object') return null;
  const id = typeof p.id === 'string' ? p.id.trim().slice(0, 80) : '';
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 80) : '';
  if (!id || !name) return null;
  const slotTypes = Array.isArray(p.slotTypes)
    ? p.slotTypes
        .filter((t) => typeof t === 'string' && t.trim())
        .map((t) => t.trim())
        .slice(0, 80)
    : [];
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const src = p.minimumByDay && typeof p.minimumByDay === 'object' ? p.minimumByDay : {};
  const legacy = Number(p.minimumPerDay);
  const fallback = Number.isFinite(legacy) ? Math.max(0, Math.min(999, Math.round(legacy))) : 0;
  const minimumByDay = {};
  days.forEach((k) => {
    const n = Number(src[k]);
    if (Number.isFinite(n)) minimumByDay[k] = Math.max(0, Math.min(999, Math.round(n)));
    else minimumByDay[k] = k === 'sat' || k === 'sun' ? 0 : fallback;
  });
  const tightRaw = Number(p.thresholds && p.thresholds.tight);
  const lowRaw = Number(p.thresholds && p.thresholds.low);
  const tight = Number.isFinite(tightRaw) ? Math.max(1, Math.min(99, Math.round(tightRaw))) : 75;
  let low = Number.isFinite(lowRaw) ? Math.max(1, Math.min(99, Math.round(lowRaw))) : 50;
  if (low >= tight) low = Math.max(1, tight - 1);
  const out = { id, name, slotTypes, minimumByDay, thresholds: { tight, low } };
  if (typeof p.createdAt === 'string') out.createdAt = p.createdAt;
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { capacityExport, capacityImport };
}
