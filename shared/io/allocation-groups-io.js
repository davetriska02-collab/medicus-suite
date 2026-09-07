// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Allocation groups IO (backup/restore).
//
// Presets (named sets of people work is split onto) are practice-shareable.
// last-used dest set is this computer only and is NOT exported.

'use strict';

(function (global) {
  var KEYS = ['allocationGroups.presets'];
  var CONFIG_KEY = 'allocationGroups.config';

  function loadCore() {
    if (global && global.AllocationGroupsCore) return global.AllocationGroupsCore;
    if (typeof require === 'function') {
      try {
        return require('../allocation-groups-core.js');
      } catch (_) {}
    }
    return null;
  }

  async function allocationGroupsExport() {
    var r = await chrome.storage.local.get(KEYS);
    var Core = loadCore();
    var presets = Core ? Core.normalisePresets(r['allocationGroups.presets']) : r['allocationGroups.presets'] || [];
    return { presets: presets };
  }

  async function allocationGroupsImport(data) {
    if (!data || typeof data !== 'object') return;
    var Core = loadCore();
    if (!Core) throw new Error('Allocation groups core not loaded — cannot validate import.');
    if (data.presets === undefined) return;
    if (!Array.isArray(data.presets)) throw new Error('allocationGroups.presets must be an array.');
    var cleaned = [];
    data.presets.forEach(function (raw, i) {
      var errs = Core.presetErrors(raw);
      if (errs.length) throw new Error('allocationGroups.presets[' + i + ']: ' + errs[0]);
      var p = Core.normalisePreset(raw);
      if (p) cleaned.push(p);
    });
    await chrome.storage.local.set({ 'allocationGroups.presets': cleaned });
  }

  async function loadAllocationGroupsState() {
    var r = await chrome.storage.local.get(KEYS.concat([CONFIG_KEY]));
    var Core = loadCore();
    return {
      presets: Core ? Core.normalisePresets(r['allocationGroups.presets']) : r['allocationGroups.presets'] || [],
      config: Core ? Core.normaliseConfig(r[CONFIG_KEY]) : r[CONFIG_KEY] || {},
    };
  }

  async function saveAllocationGroupsPresets(presets) {
    var Core = loadCore();
    var cleaned = Core ? Core.normalisePresets(presets) : presets || [];
    await chrome.storage.local.set({ 'allocationGroups.presets': cleaned });
    return cleaned;
  }

  async function saveAllocationGroupsConfig(config) {
    var Core = loadCore();
    var cleaned = Core ? Core.normaliseConfig(config) : config || {};
    await chrome.storage.local.set({ 'allocationGroups.config': cleaned });
    return cleaned;
  }

  var api = {
    ALLOCATION_GROUPS_KEYS: KEYS,
    allocationGroupsExport: allocationGroupsExport,
    allocationGroupsImport: allocationGroupsImport,
    loadAllocationGroupsState: loadAllocationGroupsState,
    saveAllocationGroupsPresets: saveAllocationGroupsPresets,
    saveAllocationGroupsConfig: saveAllocationGroupsConfig,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.allocationGroupsExport = allocationGroupsExport;
    global.allocationGroupsImport = allocationGroupsImport;
    global.loadAllocationGroupsState = loadAllocationGroupsState;
    global.saveAllocationGroupsPresets = saveAllocationGroupsPresets;
    global.saveAllocationGroupsConfig = saveAllocationGroupsConfig;
    global.AllocationGroupsIO = api;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
