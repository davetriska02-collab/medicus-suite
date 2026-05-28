// Medicus Suite — Practice Profile
//
// Reads practice-profile.json from the extension folder (when the practice admin
// has created one), compares its profileVersion against the last-applied version
// in chrome.storage.local, and merges or replaces settings accordingly.
//
// Designed to be self-contained — no dependency on other IO modules — so it can
// run in both the service worker (importScripts) and the options page (<script>).
// Exposes itself as self.PracticeProfile in both contexts.
//
// Apply modes:
//   mergeMissing  (default) — only writes keys the user hasn't set yet; for
//                             rule arrays, adds by id only if id absent locally.
//   forceOverride           — replaces everything, like a manual backup restore.
//   firstRunOnly            — applies once on fresh installs, never again.

'use strict';

const PracticeProfile = (() => {
  const META_KEY     = 'suite.practiceProfile';
  const NOTIFIED_KEY = 'suite.practiceProfile.notifiedVersions';

  // ── Fetch ───────────────────────────────────────────────────────────────────

  async function fetchProfile() {
    try {
      const url = chrome.runtime.getURL('practice-profile.json');
      const resp = await fetch(url);
      if (!resp.ok) return null; // 404 means no profile file — silent no-op
      const profile = await resp.json();
      if (profile.format !== 'medicus-suite-practice-profile') return null;
      if (!profile.profileVersion || !profile.envelope) return null;
      return profile;
    } catch (_) {
      return null;
    }
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  async function getStatus() {
    const r = await chrome.storage.local.get(META_KEY);
    return r[META_KEY] || null;
  }

  // ── Apply ───────────────────────────────────────────────────────────────────

  async function applyProfile(profile, { force = false } = {}) {
    if (!profile || !profile.envelope || !profile.profileVersion) {
      throw new Error('Invalid practice profile: missing envelope or profileVersion.');
    }

    const cfg     = profile.apply || {};
    const mode    = cfg.mode || 'mergeMissing';
    const allowed = new Set(cfg.modules || ['sentinel', 'triage', 'submissions', 'slots', 'capacity']);
    const merge   = mode === 'mergeMissing';

    if (!force) {
      const status = await getStatus();
      if (mode === 'firstRunOnly' && status?.lastAppliedVersion) {
        return { skipped: true, reason: 'firstRunOnly — already applied on this install' };
      }
      if (mode !== 'forceOverride' && status?.lastAppliedVersion === profile.profileVersion) {
        return { skipped: true, reason: 'already on this version' };
      }
    }

    const mods    = profile.envelope.modules || {};
    const applied = [];

    // ── Sentinel ────────────────────────────────────────────────────────────
    if (allowed.has('sentinel') && mods.sentinel && typeof mods.sentinel === 'object') {
      const toSet = {};

      if (mods.sentinel.rules && !Array.isArray(mods.sentinel.rules)) {
        if (merge) {
          const ex = await chrome.storage.local.get('sentinel.rules');
          // Existing user overrides win; profile provides new ones only
          toSet['sentinel.rules'] = Object.assign({}, mods.sentinel.rules, ex['sentinel.rules'] || {});
        } else {
          toSet['sentinel.rules'] = mods.sentinel.rules;
        }
      }

      if (Array.isArray(mods.sentinel.customRules) && mods.sentinel.customRules.length > 0) {
        if (merge) {
          const ex = await chrome.storage.local.get('sentinel.customRules');
          const existing = ex['sentinel.customRules'] || [];
          const existingIds = new Set(existing.map(r => r.id));
          const incoming = mods.sentinel.customRules.filter(r => !existingIds.has(r.id));
          toSet['sentinel.customRules'] = [...existing, ...incoming];
        } else {
          toSet['sentinel.customRules'] = mods.sentinel.customRules;
        }
      }

      if (mods.sentinel.config && !Array.isArray(mods.sentinel.config)) {
        if (merge) {
          const ex = await chrome.storage.local.get('sentinel.config');
          if (!ex['sentinel.config'] || Object.keys(ex['sentinel.config']).length === 0) {
            toSet['sentinel.config'] = mods.sentinel.config;
          }
        } else {
          toSet['sentinel.config'] = mods.sentinel.config;
        }
      }

      if (Object.keys(toSet).length > 0) {
        await chrome.storage.local.set(toSet);
        applied.push('sentinel');
      }
    }

    // ── Triage Lens ─────────────────────────────────────────────────────────
    if (allowed.has('triage') && mods.triage && typeof mods.triage.config === 'object') {
      const cfg = mods.triage.config;
      if (Object.keys(cfg).length > 0) {
        if (merge) {
          const ex = await chrome.storage.local.get('triagelens.config');
          if (!ex['triagelens.config'] || Object.keys(ex['triagelens.config']).length === 0) {
            await chrome.storage.local.set({ 'triagelens.config': cfg });
            applied.push('triage');
          }
        } else {
          await chrome.storage.local.set({ 'triagelens.config': cfg });
          applied.push('triage');
        }
      }
    }

    // ── Submissions / Practice Code ─────────────────────────────────────────
    if (allowed.has('submissions') && mods.submissions) {
      const toSet = {};

      if (mods.submissions.practiceCode) {
        if (merge) {
          const ex = await chrome.storage.local.get('suite.practiceCode');
          if (!ex['suite.practiceCode']) toSet['suite.practiceCode'] = mods.submissions.practiceCode;
        } else {
          toSet['suite.practiceCode'] = mods.submissions.practiceCode;
        }
      }

      if (mods.submissions.config && !Array.isArray(mods.submissions.config)) {
        if (merge) {
          const ex = await chrome.storage.local.get('submissions.config');
          if (!ex['submissions.config']) toSet['submissions.config'] = mods.submissions.config;
        } else {
          toSet['submissions.config'] = mods.submissions.config;
        }
      }

      if (mods.submissions.thresholds && !Array.isArray(mods.submissions.thresholds)) {
        if (merge) {
          const ex = await chrome.storage.local.get('submissions.thresholds');
          if (!ex['submissions.thresholds']) toSet['submissions.thresholds'] = mods.submissions.thresholds;
        } else {
          toSet['submissions.thresholds'] = mods.submissions.thresholds;
        }
      }

      if (Object.keys(toSet).length > 0) {
        await chrome.storage.local.set(toSet);
        applied.push('submissions');
      }
    }

    // ── Slot Counter ────────────────────────────────────────────────────────
    if (allowed.has('slots') && mods.slots) {
      const toSet = {};

      if (Array.isArray(mods.slots.hiddenTypes)) {
        if (merge) {
          const ex = await chrome.storage.local.get('slots.hiddenTypes');
          if (!ex['slots.hiddenTypes']) toSet['slots.hiddenTypes'] = mods.slots.hiddenTypes;
        } else {
          toSet['slots.hiddenTypes'] = mods.slots.hiddenTypes;
        }
      }

      if (Array.isArray(mods.slots.alertRules)) {
        if (merge) {
          const ex = await chrome.storage.local.get('slots.alertRules');
          if (!ex['slots.alertRules'] || ex['slots.alertRules'].length === 0) {
            toSet['slots.alertRules'] = mods.slots.alertRules;
          }
        } else {
          toSet['slots.alertRules'] = mods.slots.alertRules;
        }
      }

      if (Object.keys(toSet).length > 0) {
        await chrome.storage.local.set(toSet);
        applied.push('slots');
      }
    }

    // ── Capacity Presets ────────────────────────────────────────────────────
    if (allowed.has('capacity') && mods.capacity && Array.isArray(mods.capacity.presets) && mods.capacity.presets.length > 0) {
      if (merge) {
        const ex = await chrome.storage.local.get('capacity.presets');
        if (!ex['capacity.presets'] || ex['capacity.presets'].length === 0) {
          await chrome.storage.local.set({ 'capacity.presets': mods.capacity.presets });
          applied.push('capacity');
        }
      } else {
        await chrome.storage.local.set({ 'capacity.presets': mods.capacity.presets });
        applied.push('capacity');
      }
    }

    await _recordApplication({
      profileVersion: profile.profileVersion,
      profileLabel:   profile.profileLabel || '',
      mode,
      appliedAt:      new Date().toISOString(),
      modulesApplied: applied,
    });

    return { skipped: false, modulesApplied: applied };
  }

  async function _recordApplication(entry) {
    const r = await chrome.storage.local.get(META_KEY);
    const meta = r[META_KEY] || {};
    meta.lastAppliedVersion = entry.profileVersion;
    meta.lastAppliedAt      = entry.appliedAt;
    meta.lastAppliedLabel   = entry.profileLabel;
    meta.lastAppliedMode    = entry.mode;
    const history = meta.history || [];
    history.unshift(entry);
    meta.history = history.slice(0, 10);
    await chrome.storage.local.set({ [META_KEY]: meta });
  }

  async function _maybeNotify(profile) {
    try {
      const r = await chrome.storage.local.get(NOTIFIED_KEY);
      const notified = r[NOTIFIED_KEY] || [];
      if (notified.includes(profile.profileVersion)) return;
      if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
        chrome.notifications.create(`pp_${Date.now()}`, {
          type:     'basic',
          iconUrl:  'icons/icon-128.png',
          title:    'Practice settings updated',
          message:  profile.profileLabel || `Profile ${profile.profileVersion} applied`,
          priority: 0,
          silent:   true,
        });
      }
      const updated = [...notified, profile.profileVersion].slice(-20);
      await chrome.storage.local.set({ [NOTIFIED_KEY]: updated });
    } catch (_) {}
  }

  // Main entry point for the service worker: fetch, compare, auto-apply if needed.
  async function checkAndApply() {
    try {
      const profile = await fetchProfile();
      if (!profile) return { present: false };

      const status     = await getStatus();
      const current    = status?.lastAppliedVersion;
      const incoming   = profile.profileVersion;
      const autoApply  = profile.apply?.autoApplyOnStartup !== false;

      if (current === incoming) return { present: true, current: true };
      if (!autoApply)           return { present: true, current: false, pendingVersion: incoming };

      const result = await applyProfile(profile);
      if (!result.skipped && profile.apply?.notifyUserOnApply) {
        await _maybeNotify(profile);
      }
      console.log('[Practice Profile] Applied version', incoming, '— modules:', result.modulesApplied);
      return { present: true, applied: !result.skipped, result };
    } catch (e) {
      console.warn('[Practice Profile] checkAndApply failed:', e.message);
      return { present: false, error: e.message };
    }
  }

  const api = { fetchProfile, getStatus, applyProfile, checkAndApply };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined') {
    self.PracticeProfile = api;
  }

  return api;
})();
