// Medicus Suite — Capacity Forecast IO helpers

'use strict';

const CAPACITY_KEYS = [
  'capacity.presets',
  'capacity.activePresetId',
  'capacity.viewMode',
  'capacity.showWeekends',
];

async function capacityExport() {
  const r = await chrome.storage.local.get(CAPACITY_KEYS);
  return {
    presets:         r['capacity.presets']         ?? [],
    activePresetId:  r['capacity.activePresetId']  ?? null,
    viewMode:        r['capacity.viewMode']         ?? 'week',
    showWeekends:    r['capacity.showWeekends']     ?? false,
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

  const toSet = {};
  let conflicts = [];

  if (data.presets !== undefined) {
    if (merge) {
      const existing = await chrome.storage.local.get('capacity.presets');
      const existingPresets = existing['capacity.presets'] || [];
      const existingIds = new Map(existingPresets.map(p => [p.id, p]));
      const merged = [...existingPresets];
      for (const incoming of data.presets) {
        if (existingIds.has(incoming.id)) {
          conflicts.push({ existing: existingIds.get(incoming.id), incoming });
        } else {
          merged.push(incoming);
        }
      }
      toSet['capacity.presets'] = merged;
    } else {
      toSet['capacity.presets'] = data.presets;
    }
  }
  if (data.activePresetId !== undefined) toSet['capacity.activePresetId'] = data.activePresetId;
  if (data.viewMode !== undefined) {
    if (!['week', 'month'].includes(data.viewMode)) throw new Error('viewMode must be "week" or "month".');
    toSet['capacity.viewMode'] = data.viewMode;
  }
  if (data.showWeekends !== undefined) toSet['capacity.showWeekends'] = !!data.showWeekends;

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
  return { conflicts };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { capacityExport, capacityImport };
}
