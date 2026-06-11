// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Profile (v2)
//
// Reads practice-profile.json from the extension folder (when the practice admin
// has created one), compares its profileVersion against the last-applied version
// in chrome.storage.local, and merges or replaces settings accordingly.
//
// Designed to run in both the service worker (importScripts) and the options page
// (<script>). Exposes itself as self.PracticeProfile in both contexts, and as
// module.exports in Node tests.
//
// v2 apply config schema (BACKWARDS COMPATIBLE with v1):
//   apply.modules  — object: { <moduleName>: 'merge' | 'replace' }
//                    OR array (v1 shape — inferred from apply.mode)
//                    OR absent (v1 default set: sentinel, triage, submissions, slots, capacity)
//   apply.mode             — v1 legacy scalar ('mergeMissing' | 'forceOverride' | 'firstRunOnly')
//   apply.autoApplyOnStartup    — boolean, default true
//   apply.checkEveryMinutes     — number, clamp 5..1440, default 15
//   apply.autoReloadOnNewVersion — boolean, default true
//   apply.notifyUserOnApply     — boolean, default false
//
// "merge" must NEVER overwrite anything the local user has already set.
// "replace" enforces the profile's data for that module (like a backup restore).
//
// Per-module try/catch: a malformed section records an error and other modules
// continue. Returns { modulesApplied, errors } from applyProfile.
//
// Delegate to per-module *Import() functions wherever possible so their validation
// and whitelist-sanitisation runs. In merge mode, pre-filter the payload to the
// safe-to-write subset before calling *Import().
//
// IO functions (capacityImport etc.) must already be in scope:
//   — service worker: loaded via importScripts before this file
//   — options page: loaded via <script> tags before this file
//   — node tests: required explicitly and injected into global before loading this

'use strict';

// Defence-in-depth: strip keys that could trigger prototype-pollution when
// merging IMPORTED/untrusted profile data via Object.assign. Mirrors
// engine/ruleset-io.js safeCopy — applied to the untrusted operand only.
const _PP_DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
function _stripDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  Object.keys(obj).forEach((k) => {
    if (!_PP_DANGEROUS_KEYS.includes(k)) out[k] = obj[k];
  });
  return out;
}

const PracticeProfile = (() => {
  const META_KEY = 'suite.practiceProfile';
  const NOTIFIED_KEY = 'suite.practiceProfile.notifiedVersions';

  // Default v1 module set, applied when apply.modules is absent.
  const V1_DEFAULT_MODULES = ['sentinel', 'triage', 'submissions', 'slots', 'capacity'];

  // ── IO function resolution ────────────────────────────────────────────────────
  // In a service worker these are on `self`; in the options page also on `self`
  // (which equals `window`); in Node tests they are globals injected by the test.

  function _io(name) {
    // Prefer explicit globals (node tests), then self.<name> (browser/SW).
    // Check for both function and object (e.g. KnowledgeUtils is an object, not a function).
    const fromGlobal = typeof global !== 'undefined' ? global[name] : undefined;
    if (fromGlobal != null) return fromGlobal;
    const fromSelf = typeof self !== 'undefined' ? self[name] : undefined;
    if (fromSelf != null) return fromSelf;
    return null;
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────────

  async function fetchProfile() {
    try {
      const url = chrome.runtime.getURL('practice-profile.json');
      // cache: 'no-store' ensures a changed file on the shared network drive is
      // always re-read rather than served from the browser HTTP cache.
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) return null; // 404 means no profile file — silent no-op
      const profile = await resp.json();
      if (profile.format !== 'medicus-suite-practice-profile') return null;
      if (!profile.profileVersion || !profile.envelope) return null;
      return profile;
    } catch (_) {
      return null;
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────────

  async function getStatus() {
    const r = await chrome.storage.local.get(META_KEY);
    return r[META_KEY] || null;
  }

  // ── Module map resolution ─────────────────────────────────────────────────────
  // Returns a Map<moduleName, 'merge'|'replace'> for the effective v2 config,
  // normalised from either the v2 object, v1 array, or absent (v1 default).

  function _resolveModuleMap(applyCfg) {
    const mods = applyCfg.modules;
    const mode = applyCfg.mode || 'mergeMissing';

    // v2: modules is a plain object { <name>: 'merge'|'replace' }
    if (mods && !Array.isArray(mods) && typeof mods === 'object') {
      const map = new Map();
      for (const [k, v] of Object.entries(mods)) {
        // Guard: only accept the known per-module strings
        if (v === 'merge' || v === 'replace') map.set(k, v);
      }
      return map;
    }

    // v1: modules is an array (explicit module list) or absent (default list)
    const list = Array.isArray(mods) ? mods : V1_DEFAULT_MODULES;
    const derived = mode === 'forceOverride' ? 'replace' : 'merge';
    const map = new Map();
    for (const name of list) map.set(name, derived);
    return map;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────────

  async function applyProfile(profile, { force = false } = {}) {
    if (!profile || !profile.envelope || !profile.profileVersion) {
      throw new Error('Invalid practice profile: missing envelope or profileVersion.');
    }

    const cfg = profile.apply || {};
    const mode = cfg.mode || 'mergeMissing';
    const modMap = _resolveModuleMap(cfg);

    if (!force) {
      const status = await getStatus();
      if (mode === 'firstRunOnly' && status?.lastAppliedVersion) {
        return { skipped: true, reason: 'firstRunOnly — already applied on this install' };
      }
      if (mode !== 'forceOverride' && status?.lastAppliedVersion === profile.profileVersion) {
        return { skipped: true, reason: 'already on this version' };
      }
    }

    const mods = profile.envelope.modules || {};
    const applied = [];
    const errors = [];

    // ── Sentinel ───────────────────────────────────────────────────────────────
    if (modMap.has('sentinel') && mods.sentinel && typeof mods.sentinel === 'object') {
      try {
        const merge = modMap.get('sentinel') === 'merge';
        // SAFETY: alertLibraryAcknowledged is a per-install attestation — never
        // push it from the profile in either mode; it is set only when this
        // install's admin explicitly clicks the alert library modal. Strip it
        // from the payload before delegation so sentinelImport can't write it.
        const payload = Object.assign({}, mods.sentinel);
        delete payload.alertLibraryAcknowledged;

        const sentinelImport = _io('sentinelImport');
        if (sentinelImport) {
          if (merge) {
            // Merge mode: existing user overrides win. Build a reduced payload
            // that only carries values not already present locally.
            const safe = {};
            if (payload.rules && !Array.isArray(payload.rules)) {
              // rules is a { drugId: override } map — local keys win
              const ex = await chrome.storage.local.get('sentinel.rules');
              const local = ex['sentinel.rules'] || {};
              // Incoming rule overrides fill only absent rule IDs.
              // Strip dangerous keys from the untrusted payload before merging.
              const merged = Object.assign({}, _stripDangerousKeys(payload.rules), local);
              if (Object.keys(merged).length > 0) safe.rules = merged;
            }
            if (Array.isArray(payload.customRules)) {
              // Custom rules merged by id — incoming ids not already present locally
              const ex = await chrome.storage.local.get('sentinel.customRules');
              const existing = ex['sentinel.customRules'] || [];
              const existingIds = new Set(existing.map((r) => r.id));
              const incoming = payload.customRules.filter((r) => !existingIds.has(r.id));
              if (incoming.length > 0) safe.customRules = [...existing, ...incoming];
            }
            if (payload.config && !Array.isArray(payload.config)) {
              const ex = await chrome.storage.local.get('sentinel.config');
              if (!ex['sentinel.config'] || Object.keys(ex['sentinel.config']).length === 0) {
                safe.config = payload.config;
              }
            }
            if (Object.keys(safe).length > 0) {
              await sentinelImport(safe);
              applied.push('sentinel');
            }
          } else {
            // Replace: pass the stripped payload through sentinelImport for validation
            await sentinelImport(payload);
            applied.push('sentinel');
          }
        } else {
          // Fallback (no sentinelImport in scope) — raw writes, same logic as before
          const toSet = {};
          if (payload.rules && !Array.isArray(payload.rules)) {
            if (merge) {
              const ex = await chrome.storage.local.get('sentinel.rules');
              // Strip dangerous keys from the untrusted payload before merging.
              toSet['sentinel.rules'] = Object.assign(
                {},
                _stripDangerousKeys(payload.rules),
                ex['sentinel.rules'] || {}
              );
            } else {
              toSet['sentinel.rules'] = payload.rules;
            }
          }
          if (Array.isArray(payload.customRules) && payload.customRules.length > 0) {
            if (merge) {
              const ex = await chrome.storage.local.get('sentinel.customRules');
              const existing = ex['sentinel.customRules'] || [];
              const existingIds = new Set(existing.map((r) => r.id));
              const incoming = payload.customRules.filter((r) => !existingIds.has(r.id));
              toSet['sentinel.customRules'] = [...existing, ...incoming];
            } else {
              toSet['sentinel.customRules'] = payload.customRules;
            }
          }
          if (payload.config && !Array.isArray(payload.config)) {
            if (merge) {
              const ex = await chrome.storage.local.get('sentinel.config');
              if (!ex['sentinel.config'] || Object.keys(ex['sentinel.config']).length === 0) {
                toSet['sentinel.config'] = payload.config;
              }
            } else {
              toSet['sentinel.config'] = payload.config;
            }
          }
          if (Object.keys(toSet).length > 0) {
            await chrome.storage.local.set(toSet);
            applied.push('sentinel');
          }
        }
      } catch (e) {
        errors.push(`sentinel: ${e.message}`);
      }
    }

    // ── Triage Lens ────────────────────────────────────────────────────────────
    if (modMap.has('triage') && mods.triage && typeof mods.triage.config === 'object') {
      try {
        const merge = modMap.get('triage') === 'merge';
        const config = mods.triage.config;
        if (Object.keys(config).length > 0) {
          if (merge) {
            const ex = await chrome.storage.local.get('triagelens.config');
            if (!ex['triagelens.config'] || Object.keys(ex['triagelens.config']).length === 0) {
              await chrome.storage.local.set({ 'triagelens.config': config });
              applied.push('triage');
            }
          } else {
            await chrome.storage.local.set({ 'triagelens.config': config });
            applied.push('triage');
          }
        }
      } catch (e) {
        errors.push(`triage: ${e.message}`);
      }
    }

    // ── Submissions ────────────────────────────────────────────────────────────
    // v1 profiles carried practiceCode under mods.submissions; v2 moves it to
    // mods.suite. Accept it in both places so v1 profiles still work.
    if (modMap.has('submissions') && mods.submissions) {
      try {
        const merge = modMap.get('submissions') === 'merge';
        const sub = mods.submissions;

        const submissionsImport = _io('submissionsImport');
        if (submissionsImport) {
          if (merge) {
            const safe = {};
            if (sub.config && !Array.isArray(sub.config)) {
              const ex = await chrome.storage.local.get('submissions.config');
              if (!ex['submissions.config']) safe.config = sub.config;
            }
            if (sub.thresholds && !Array.isArray(sub.thresholds)) {
              const ex = await chrome.storage.local.get('submissions.thresholds');
              if (!ex['submissions.thresholds']) safe.thresholds = sub.thresholds;
            }
            // v1 practiceCode in submissions.practiceCode → forward to suite module
            if (sub.practiceCode) {
              const ex = await chrome.storage.local.get('suite.practiceCode');
              if (!ex['suite.practiceCode']) safe.practiceCode = sub.practiceCode;
            }
            if (Object.keys(safe).length > 0) {
              await submissionsImport(safe);
              applied.push('submissions');
            }
          } else {
            const payload = {};
            if (sub.config) payload.config = sub.config;
            if (sub.thresholds) payload.thresholds = sub.thresholds;
            if (sub.practiceCode) payload.practiceCode = sub.practiceCode;
            if (Object.keys(payload).length > 0) {
              await submissionsImport(payload);
              applied.push('submissions');
            }
          }
        } else {
          // Fallback raw writes
          const toSet = {};
          if (sub.practiceCode) {
            if (merge) {
              const ex = await chrome.storage.local.get('suite.practiceCode');
              if (!ex['suite.practiceCode']) toSet['suite.practiceCode'] = sub.practiceCode;
            } else {
              toSet['suite.practiceCode'] = sub.practiceCode;
            }
          }
          if (sub.config && !Array.isArray(sub.config)) {
            if (merge) {
              const ex = await chrome.storage.local.get('submissions.config');
              if (!ex['submissions.config']) toSet['submissions.config'] = sub.config;
            } else {
              toSet['submissions.config'] = sub.config;
            }
          }
          if (sub.thresholds && !Array.isArray(sub.thresholds)) {
            if (merge) {
              const ex = await chrome.storage.local.get('submissions.thresholds');
              if (!ex['submissions.thresholds']) toSet['submissions.thresholds'] = sub.thresholds;
            } else {
              toSet['submissions.thresholds'] = sub.thresholds;
            }
          }
          if (Object.keys(toSet).length > 0) {
            await chrome.storage.local.set(toSet);
            applied.push('submissions');
          }
        }
      } catch (e) {
        errors.push(`submissions: ${e.message}`);
      }
    }

    // ── Slot Counter ───────────────────────────────────────────────────────────
    if (modMap.has('slots') && mods.slots) {
      try {
        const merge = modMap.get('slots') === 'merge';
        const sl = mods.slots;

        const slotCounterImport = _io('slotCounterImport');
        if (slotCounterImport) {
          if (merge) {
            const safe = {};
            if (Array.isArray(sl.hiddenTypes)) {
              const ex = await chrome.storage.local.get('slots.hiddenTypes');
              if (!ex['slots.hiddenTypes']) safe.hiddenTypes = sl.hiddenTypes;
            }
            if (Array.isArray(sl.alertRules)) {
              const ex = await chrome.storage.local.get('slots.alertRules');
              if (!ex['slots.alertRules'] || ex['slots.alertRules'].length === 0) safe.alertRules = sl.alertRules;
            }
            if (Object.keys(safe).length > 0) {
              await slotCounterImport(safe);
              applied.push('slots');
            }
          } else {
            const payload = {};
            if (sl.hiddenTypes !== undefined) payload.hiddenTypes = sl.hiddenTypes;
            if (sl.alertRules !== undefined) payload.alertRules = sl.alertRules;
            if (Object.keys(payload).length > 0) {
              await slotCounterImport(payload);
              applied.push('slots');
            }
          }
        } else {
          // Fallback raw writes
          const toSet = {};
          if (Array.isArray(sl.hiddenTypes)) {
            if (merge) {
              const ex = await chrome.storage.local.get('slots.hiddenTypes');
              if (!ex['slots.hiddenTypes']) toSet['slots.hiddenTypes'] = sl.hiddenTypes;
            } else {
              toSet['slots.hiddenTypes'] = sl.hiddenTypes;
            }
          }
          if (Array.isArray(sl.alertRules)) {
            if (merge) {
              const ex = await chrome.storage.local.get('slots.alertRules');
              if (!ex['slots.alertRules'] || ex['slots.alertRules'].length === 0) {
                toSet['slots.alertRules'] = sl.alertRules;
              }
            } else {
              toSet['slots.alertRules'] = sl.alertRules;
            }
          }
          if (Object.keys(toSet).length > 0) {
            await chrome.storage.local.set(toSet);
            applied.push('slots');
          }
        }
      } catch (e) {
        errors.push(`slots: ${e.message}`);
      }
    }

    // ── Capacity ───────────────────────────────────────────────────────────────
    if (
      modMap.has('capacity') &&
      mods.capacity &&
      Array.isArray(mods.capacity.presets) &&
      mods.capacity.presets.length > 0
    ) {
      try {
        const merge = modMap.get('capacity') === 'merge';
        const capacityImport = _io('capacityImport');
        if (capacityImport) {
          // capacityImport already supports { merge: true }
          await capacityImport({ presets: mods.capacity.presets }, { merge });
          applied.push('capacity');
        } else {
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
      } catch (e) {
        errors.push(`capacity: ${e.message}`);
      }
    }

    // ── Knowledge (v2 new) ─────────────────────────────────────────────────────
    if (modMap.has('knowledge') && mods.knowledge && typeof mods.knowledge === 'object') {
      try {
        const merge = modMap.get('knowledge') === 'merge';
        const km = mods.knowledge;

        // SAFETY: knowledge.config contains noticeAcknowledgedAt, a per-install
        // attestation. Strip config entirely — the profile must never push it.
        // knowledgeImport also blanks it, but double-defence is warranted here.
        const payload = Object.assign({}, km);
        delete payload.config;

        const knowledgeImport = _io('knowledgeImport');
        if (!knowledgeImport) throw new Error('knowledgeImport not available in this context.');

        if (merge) {
          // Merge items: append items whose id is absent locally AND whose
          // title has no near-duplicate among local items.
          const safe = {};

          if (payload.items !== undefined) {
            if (!Array.isArray(payload.items)) throw new Error('knowledge.items must be an array.');
            const ex = await chrome.storage.local.get('knowledge.items');
            const local = ex['knowledge.items'] || [];
            const localIds = new Set(local.map((i) => i.id));

            // KnowledgeUtils.findSimilar is used for near-duplicate title detection.
            const KU = _io('KnowledgeUtils') || (typeof self !== 'undefined' && self.KnowledgeUtils) || null;
            const incoming = [];
            for (const item of payload.items) {
              if (!item || typeof item !== 'object') continue;
              if (localIds.has(item.id)) continue; // id collision — local wins
              if (KU) {
                const similar = KU.findSimilar(item.title, local, { threshold: 0.6 });
                if (similar.length > 0) continue; // near-duplicate title — local wins
              }
              incoming.push(item);
            }
            if (incoming.length > 0) safe.items = [...local, ...incoming];
          }

          if (Array.isArray(payload.categories)) {
            // Append categories with missing ids
            const ex = await chrome.storage.local.get('knowledge.categories');
            const localCats = ex['knowledge.categories'] || [];
            const localCatIds = new Set(localCats.map((c) => c.id));
            const newCats = payload.categories.filter((c) => c && c.id && !localCatIds.has(c.id));
            if (newCats.length > 0) safe.categories = [...localCats, ...newCats];
          }

          if (Object.keys(safe).length > 0) {
            await knowledgeImport(safe);
            applied.push('knowledge');
          }
        } else {
          // Replace: push items and categories wholesale via knowledgeImport
          if (Object.keys(payload).length > 0) {
            await knowledgeImport(payload);
            applied.push('knowledge');
          }
        }
      } catch (e) {
        errors.push(`knowledge: ${e.message}`);
      }
    }

    // ── Reception (v2 new) ─────────────────────────────────────────────────────
    if (modMap.has('reception') && mods.reception && typeof mods.reception === 'object') {
      try {
        const merge = modMap.get('reception') === 'merge';
        const rc = mods.reception;

        // SAFETY: disclaimerAcceptedAt is a per-install attestation — never push
        // it. receptionImport already refuses it; strip it here too for clarity.
        const receptionImport = _io('receptionImport');
        if (!receptionImport) throw new Error('receptionImport not available in this context.');

        if (merge) {
          const safe = {};

          // Append customPathways with missing ids
          if (Array.isArray(rc.customPathways)) {
            const ex = await chrome.storage.local.get('reception.customPathways');
            const local = ex['reception.customPathways'] || [];
            const localIds = new Set(local.map((p) => p.id));
            const incoming = rc.customPathways.filter((p) => p && p.id && !localIds.has(p.id));
            if (incoming.length > 0) safe.customPathways = incoming; // receptionImport appends?
            // receptionImport replaces the whole array, so merge manually:
            if (incoming.length > 0) safe.customPathways = [...local, ...incoming];
          }

          // pathwayOverrides: add only for pathway ids with no local override
          if (rc.pathwayOverrides && typeof rc.pathwayOverrides === 'object' && !Array.isArray(rc.pathwayOverrides)) {
            const ex = await chrome.storage.local.get('reception.pathwayOverrides');
            const local = ex['reception.pathwayOverrides'] || {};
            const incoming = {};
            // Strip dangerous keys from the untrusted incoming override map.
            for (const [id, ov] of Object.entries(_stripDangerousKeys(rc.pathwayOverrides))) {
              if (!local[id]) incoming[id] = ov;
            }
            if (Object.keys(incoming).length > 0) {
              safe.pathwayOverrides = Object.assign({}, local, incoming);
            }
          }

          // config: merge enabledPathways (only new ids), hiddenChipRules (only new ids)
          if (rc.config && typeof rc.config === 'object' && !Array.isArray(rc.config)) {
            const ex = await chrome.storage.local.get('reception.config');
            const localCfg = ex['reception.config'] || {};
            const safeConfig = {};

            if (rc.config.enabledPathways && typeof rc.config.enabledPathways === 'object') {
              const localFlags = localCfg.enabledPathways || {};
              const incoming = {};
              // Strip dangerous keys from the untrusted incoming enabledPathways map.
              for (const [id, val] of Object.entries(_stripDangerousKeys(rc.config.enabledPathways))) {
                // Only add ids not already present locally — never overwrite a local flag
                if (!(id in localFlags)) incoming[id] = val;
              }
              if (Object.keys(incoming).length > 0) {
                safeConfig.enabledPathways = Object.assign({}, localFlags, incoming);
              }
            }

            if (rc.config.hiddenChipRules && typeof rc.config.hiddenChipRules === 'object') {
              const localRules = localCfg.hiddenChipRules || {};
              const incoming = {};
              // Strip dangerous keys from the untrusted incoming hiddenChipRules map.
              for (const [id, val] of Object.entries(_stripDangerousKeys(rc.config.hiddenChipRules))) {
                if (!(id in localRules)) incoming[id] = val;
              }
              if (Object.keys(incoming).length > 0) {
                safeConfig.hiddenChipRules = Object.assign({}, localRules, incoming);
              }
            }
            // disclaimerAcceptedAt: intentionally never written in either mode
            if (Object.keys(safeConfig).length > 0) safe.config = safeConfig;
          }

          // tilePrefs: merge — only set keys absent locally
          if (rc.tilePrefs && typeof rc.tilePrefs === 'object' && !Array.isArray(rc.tilePrefs)) {
            const ex = await chrome.storage.local.get('reception.tilePrefs');
            if (!ex['reception.tilePrefs']) safe.tilePrefs = rc.tilePrefs;
          }

          if (Object.keys(safe).length > 0) {
            await receptionImport(safe);
            applied.push('reception');
          }
        } else {
          // Replace: strip disclaimerAcceptedAt from config then push wholesale
          const payload = Object.assign({}, rc);
          if (payload.config && typeof payload.config === 'object') {
            const cleanConfig = Object.assign({}, payload.config);
            delete cleanConfig.disclaimerAcceptedAt;
            payload.config = cleanConfig;
          }
          await receptionImport(payload);
          applied.push('reception');
        }
      } catch (e) {
        errors.push(`reception: ${e.message}`);
      }
    }

    // ── Triage Alerts (v2 new) ─────────────────────────────────────────────────
    if (modMap.has('triageAlerts') && mods.triageAlerts && typeof mods.triageAlerts === 'object') {
      try {
        const merge = modMap.get('triageAlerts') === 'merge';
        const ta = mods.triageAlerts;

        const TriageAlertIO = _io('TriageAlertIO');
        if (!TriageAlertIO) throw new Error('TriageAlertIO not available in this context.');

        if (Array.isArray(ta.rules)) {
          if (merge) {
            // Merge by rule key: existing local rules win; add absent keys from profile
            const existingRules = await TriageAlertIO.getRules();
            const existingKeys = new Set(existingRules.map((r) => r.key));
            const incoming = ta.rules.filter((r) => r && r.key && !existingKeys.has(r.key));
            if (incoming.length > 0) {
              await TriageAlertIO.importData({ rules: [...existingRules, ...incoming] });
              applied.push('triageAlerts');
            }
          } else {
            await TriageAlertIO.importData({ rules: ta.rules });
            applied.push('triageAlerts');
          }
        }
      } catch (e) {
        errors.push(`triageAlerts: ${e.message}`);
      }
    }

    // ── Referrals (v2 new) ─────────────────────────────────────────────────────
    if (modMap.has('referrals') && mods.referrals && typeof mods.referrals === 'object') {
      try {
        const merge = modMap.get('referrals') === 'merge';
        const rf = mods.referrals;

        const referralsImport = _io('referralsImport');
        if (!referralsImport) throw new Error('referralsImport not available in this context.');

        // SAFETY: referrals.discovery is locally-discovered data, not config — never push it.
        if (rf.config !== undefined && rf.config !== null) {
          if (merge) {
            const ex = await chrome.storage.local.get('referrals.config');
            if (!ex['referrals.config']) {
              await referralsImport({ config: rf.config });
              applied.push('referrals');
            }
          } else {
            await referralsImport({ config: rf.config });
            applied.push('referrals');
          }
        }
      } catch (e) {
        errors.push(`referrals: ${e.message}`);
      }
    }

    // ── Request Monitor (v2 new) ───────────────────────────────────────────────
    if (modMap.has('requestMonitor') && mods.requestMonitor && typeof mods.requestMonitor === 'object') {
      try {
        const merge = modMap.get('requestMonitor') === 'merge';
        const rm = mods.requestMonitor;

        const requestMonitorImport = _io('requestMonitorImport');
        if (!requestMonitorImport) throw new Error('requestMonitorImport not available in this context.');

        if (merge) {
          // Merge: only write keys absent locally
          const RM_KEYS = [
            'suite.requestMonitor.enabled',
            'suite.requestMonitor.assigneeId',
            'suite.requestMonitor.pollSeconds',
            'suite.requestMonitor.notifyEnabled',
            'suite.requestMonitor.notifySound',
          ];
          const ex = await chrome.storage.local.get(RM_KEYS);
          const safe = {};
          if (rm.enabled !== undefined && ex['suite.requestMonitor.enabled'] == null) safe.enabled = rm.enabled;
          if (rm.assigneeId !== undefined && ex['suite.requestMonitor.assigneeId'] == null)
            safe.assigneeId = rm.assigneeId;
          if (rm.pollSeconds !== undefined && ex['suite.requestMonitor.pollSeconds'] == null)
            safe.pollSeconds = rm.pollSeconds;
          if (rm.notifyEnabled !== undefined && ex['suite.requestMonitor.notifyEnabled'] == null)
            safe.notifyEnabled = rm.notifyEnabled;
          if (rm.notifySound !== undefined && ex['suite.requestMonitor.notifySound'] == null)
            safe.notifySound = rm.notifySound;
          if (Object.keys(safe).length > 0) {
            await requestMonitorImport(safe);
            applied.push('requestMonitor');
          }
        } else {
          await requestMonitorImport(rm);
          applied.push('requestMonitor');
        }
      } catch (e) {
        errors.push(`requestMonitor: ${e.message}`);
      }
    }

    // ── Suite: practiceCode + feedbackEmail only (v2 new) ─────────────────────
    // NEVER push display, tabOrder, or any other suite.* key — those are
    // personal preferences of the individual user, not practice-wide config.
    const suiteModData =
      mods.suite ||
      // v1 fallback: practiceCode may have lived under mods.submissions (already
      // handled above). mods.suite is new in v2; accept it if present.
      null;

    if (modMap.has('suite') && suiteModData && typeof suiteModData === 'object') {
      try {
        const merge = modMap.get('suite') === 'merge';
        const toSet = {};
        const ALLOWED_SUITE_KEYS = ['practiceCode', 'feedbackEmail'];

        for (const key of ALLOWED_SUITE_KEYS) {
          const val = suiteModData[key];
          if (val == null) continue;
          const storageKey = `suite.${key}`;
          if (merge) {
            const ex = await chrome.storage.local.get(storageKey);
            if (!ex[storageKey]) toSet[storageKey] = val;
          } else {
            toSet[storageKey] = val;
          }
        }
        // Explicitly block any other keys even if accidentally present in the profile
        // (display, tabOrder, etc. are personal preferences and must never be pushed).

        if (Object.keys(toSet).length > 0) {
          await chrome.storage.local.set(toSet);
          applied.push('suite');
        }
      } catch (e) {
        errors.push(`suite: ${e.message}`);
      }
    }

    // Silently ignore: condor, popout (unsupported, see task spec).

    await _recordApplication({
      profileVersion: profile.profileVersion,
      profileLabel: profile.profileLabel || '',
      modeSummary: _buildModeSummary(modMap),
      appliedAt: new Date().toISOString(),
      modulesApplied: applied,
      errors,
    });

    return { skipped: false, modulesApplied: applied, errors };
  }

  // Build a human-readable summary of the module→mode map for history entries.
  function _buildModeSummary(modMap) {
    const parts = [];
    for (const [name, mode] of modMap) parts.push(`${name}:${mode}`);
    return parts.join(', ') || 'none';
  }

  async function _recordApplication(entry) {
    const r = await chrome.storage.local.get(META_KEY);
    const meta = r[META_KEY] || {};
    meta.lastAppliedVersion = entry.profileVersion;
    meta.lastAppliedAt = entry.appliedAt;
    meta.lastAppliedLabel = entry.profileLabel;
    meta.lastAppliedMode = entry.modeSummary;
    meta.lastCheckedAt = entry.appliedAt; // also set on every check — see checkAndApply
    const history = meta.history || [];
    history.unshift(entry);
    meta.history = history.slice(0, 10);
    await chrome.storage.local.set({ [META_KEY]: meta });
  }

  async function _updateLastChecked() {
    const r = await chrome.storage.local.get(META_KEY);
    const meta = r[META_KEY] || {};
    meta.lastCheckedAt = new Date().toISOString();
    await chrome.storage.local.set({ [META_KEY]: meta });
  }

  async function _maybeNotify(profile) {
    try {
      const r = await chrome.storage.local.get(NOTIFIED_KEY);
      const notified = r[NOTIFIED_KEY] || [];
      if (notified.includes(profile.profileVersion)) return;
      if (typeof chrome !== 'undefined' && chrome.notifications?.create) {
        chrome.notifications.create(`pp_${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon-128.png',
          title: 'Practice settings updated',
          message: profile.profileLabel || `Profile ${profile.profileVersion} applied`,
          priority: 0,
          silent: true,
        });
      }
      const updated = [...notified, profile.profileVersion].slice(-20);
      await chrome.storage.local.set({ [NOTIFIED_KEY]: updated });
    } catch (_) {}
  }

  // Main entry point for the service worker: fetch, compare, auto-apply if needed.
  // Also updates lastCheckedAt on every call regardless of whether anything was applied.
  async function checkAndApply() {
    try {
      const profile = await fetchProfile();
      await _updateLastChecked();
      if (!profile) return { present: false };

      const status = await getStatus();
      const current = status?.lastAppliedVersion;
      const incoming = profile.profileVersion;
      const autoApply = profile.apply?.autoApplyOnStartup !== false;

      if (current === incoming) return { present: true, current: true };
      if (!autoApply) return { present: true, current: false, pendingVersion: incoming };

      const result = await applyProfile(profile);
      if (!result.skipped && profile.apply?.notifyUserOnApply) {
        await _maybeNotify(profile);
      }
      console.log(
        '[Practice Profile] Applied version',
        incoming,
        '— modules:',
        result.modulesApplied,
        result.errors?.length ? `— errors: ${result.errors.join('; ')}` : ''
      );
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
