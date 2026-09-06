// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Practice Knowledge: share the live set via practice-profile.json
//
// Root cause this exists to close: Knowledge was written only to
// chrome.storage.local (per browser profile). An upload populated beautifully
// on one PC and was invisible on every other machine in the same practice,
// including the same user at home. There is no Medicus org-cloud for this;
// the existing shared store is practice-profile.json on the shared extension
// folder (the same channel as published practice rules / settings).
//
// Distinct from a full "Publish to shared folder" (options.js doPublish), which
// curates and overwrites every module an admin opted into. A Knowledge sync
// only ever:
//   - writes THIS machine's current live Knowledge set (items + categories;
//     never knowledge.config / noticeAcknowledgedAt);
//   - sets apply.modules.knowledge = 'replace' so the live set, including
//     edits and deletions, is what other PCs apply;
//   - carries every other module, apply settings and practiceAttestation
//     forward VERBATIM;
//   - never writes suite.practiceProfile.publisher.
//
// Last-writer-wins for the whole set: two people editing different entries
// at the same moment can lose one side. Documented residual — there is no
// per-entry lock on a shared network file.
//
// Runs from a page context that already holds (or can grant) a
// FileSystemFileHandle — Knowledge tab, pop-out, Options. Never the service
// worker: requestPermission() needs a user gesture.
//
// Pure orchestration below: every IO operation is injected via `deps` so this
// runs identically from the UI or a Node test.

'use strict';

(function () {
  const KNOWLEDGE_SYNC_STATE_KEY = 'suite.knowledgeSync';

  // Same v1 default module list as practice-profile.js — used only when we
  // materialise an absent apply.modules into a v2 object so adding knowledge
  // does not drop the historical defaults.
  const V1_DEFAULT_MODULES = ['sentinel', 'triage', 'submissions', 'slots', 'capacity'];

  function _todayStr(now) {
    return (now || new Date()).toISOString().slice(0, 10);
  }

  function _parseVersion(v) {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(v || ''));
    if (!m) return null;
    return { date: m[1], seq: parseInt(m[2], 10) };
  }

  function nextProfileVersion(sharedProfile, todayISO) {
    const parsed = _parseVersion(sharedProfile && sharedProfile.profileVersion);
    if (parsed && parsed.date === todayISO) return `${todayISO}.${parsed.seq + 1}`;
    return `${todayISO}.1`;
  }

  function _stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(_stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${_stableStringify(value[k])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  function verifyProfileFile(text, fetchedProfile) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      return { ok: false, reason: 'File is not valid JSON.' };
    }
    if (!parsed || parsed.format !== 'medicus-suite-practice-profile') {
      return { ok: false, reason: 'Not a Medicus Suite practice profile file.' };
    }
    if (!parsed.profileVersion || !parsed.envelope) {
      return { ok: false, reason: 'File is missing profileVersion or envelope.' };
    }
    if (fetchedProfile && fetchedProfile.envelope && fetchedProfile.envelope.modules) {
      const parsedMods = Object.keys((parsed.envelope && parsed.envelope.modules) || {});
      const fetchedMods = Object.keys(fetchedProfile.envelope.modules);
      const overlap = parsedMods.some((m) => fetchedMods.includes(m));
      if (fetchedMods.length > 0 && parsedMods.length > 0 && !overlap) {
        return { ok: false, reason: 'This file does not look like the practice profile currently in use.' };
      }
    }
    return { ok: true, profile: parsed };
  }

  function _resolveKU(explicit) {
    if (explicit) return explicit;
    if (typeof global !== 'undefined' && global.KnowledgeUtils) return global.KnowledgeUtils;
    if (typeof self !== 'undefined' && self.KnowledgeUtils) return self.KnowledgeUtils;
    if (typeof module !== 'undefined' && typeof require === 'function') {
      try {
        return require('../knowledge-utils.js');
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function sanitiseSharedKnowledge(localExport, KU) {
    const utils = _resolveKU(KU);
    if (!utils) throw new Error('Knowledge utilities not loaded — cannot sanitise a shared set.');
    const taken = new Set();
    const items = [];
    for (const e of (localExport && localExport.items) || []) {
      const errs = utils.validateEntry(e);
      if (errs.length > 0) continue;
      const clean = utils.sanitiseEntry(e);
      if (!clean.id || taken.has(clean.id)) clean.id = utils.generateEntryId(clean.title, taken);
      taken.add(clean.id);
      items.push(clean);
    }
    const categories = utils.sanitiseCategories(localExport && localExport.categories);
    return { items, categories };
  }

  // Promote apply.modules to a v2 object and force knowledge: 'replace'.
  // Other modules keep whatever mode they already had. An absent / v1-array
  // apply is materialised so adding knowledge does not drop historical defaults.
  function withKnowledgeReplace(applyCfg) {
    const apply = Object.assign({}, applyCfg || {});
    const mods = apply.modules;
    if (mods && !Array.isArray(mods) && typeof mods === 'object') {
      apply.modules = Object.assign({}, mods, { knowledge: 'replace' });
      return apply;
    }
    const derived = apply.mode === 'forceOverride' ? 'replace' : 'merge';
    const obj = {};
    const list = Array.isArray(mods) ? mods : V1_DEFAULT_MODULES;
    for (const name of list) obj[name] = derived;
    obj.knowledge = 'replace';
    apply.modules = obj;
    if (apply.autoApplyOnStartup == null) apply.autoApplyOnStartup = true;
    if (apply.checkEveryMinutes == null) apply.checkEveryMinutes = 15;
    if (apply.autoReloadOnNewVersion == null) apply.autoReloadOnNewVersion = true;
    return apply;
  }

  function buildKnowledgeContribution(sharedProfile, localKnowledgeExport, opts) {
    const options = opts || {};
    const KU = _resolveKU(options.KU);
    const payload = sanitiseSharedKnowledge(localKnowledgeExport || {}, KU);
    const now = options.now || new Date();
    const version = options.version || nextProfileVersion(sharedProfile, _todayStr(now));

    if (!sharedProfile || !sharedProfile.envelope || !sharedProfile.envelope.modules) {
      if (!options.allowCreate) return { skipReason: 'no-shared-profile' };
      return {
        changed: true,
        json: {
          format: 'medicus-suite-practice-profile',
          formatVersion: 2,
          profileVersion: version,
          profileLabel: (sharedProfile && sharedProfile.profileLabel) || 'Practice Knowledge',
          publishedAt: now.toISOString(),
          publishedBy: (sharedProfile && sharedProfile.publishedBy) || '',
          apply: withKnowledgeReplace({
            autoApplyOnStartup: true,
            checkEveryMinutes: 15,
            autoReloadOnNewVersion: true,
            notifyUserOnApply: false,
          }),
          envelope: { modules: { knowledge: payload } },
        },
      };
    }

    const existing = sharedProfile.envelope.modules.knowledge || {};
    const existingSafe = {
      items: Array.isArray(existing.items) ? existing.items : [],
      categories: Array.isArray(existing.categories) ? existing.categories : [],
    };
    const applyMods =
      sharedProfile.apply && sharedProfile.apply.modules && !Array.isArray(sharedProfile.apply.modules)
        ? sharedProfile.apply.modules
        : null;
    const alreadyReplace = applyMods && applyMods.knowledge === 'replace';
    if (alreadyReplace && _stableStringify(payload) === _stableStringify(existingSafe)) {
      return { skipReason: 'no-change' };
    }

    const carriedModules = Object.assign({}, sharedProfile.envelope.modules, { knowledge: payload });
    const json = Object.assign({}, sharedProfile, {
      profileVersion: version,
      publishedAt: now.toISOString(),
      apply: withKnowledgeReplace(sharedProfile.apply),
      envelope: Object.assign({}, sharedProfile.envelope, { modules: carriedModules }),
    });
    return { json, changed: true };
  }

  // What a consumer should apply from a fetched practice-profile.json.
  // Returns null when Knowledge is not opted into apply.modules.
  function knowledgeApplySpec(profile) {
    if (!profile || !profile.envelope || !profile.envelope.modules) return null;
    const km = profile.envelope.modules.knowledge;
    if (!km || typeof km !== 'object') return null;
    const applyCfg = profile.apply || {};
    const mods = applyCfg.modules;
    let mode = null;
    if (mods && !Array.isArray(mods) && typeof mods === 'object') {
      if (mods.knowledge === 'merge' || mods.knowledge === 'replace') mode = mods.knowledge;
    } else if (Array.isArray(mods) && mods.includes('knowledge')) {
      mode = applyCfg.mode === 'forceOverride' ? 'replace' : 'merge';
    }
    if (!mode) return null;
    return {
      mode,
      items: km.items,
      categories: km.categories,
      profileVersion: profile.profileVersion || null,
      publishedAt: profile.publishedAt || null,
    };
  }

  function describeSyncStatus(state) {
    const s = state || {};
    const hasHandle = s.hasHandle === true;
    const result = s.lastResult || null;

    if (hasHandle && (result === 'pushed' || result === 'no-change')) {
      return {
        kind: 'shared',
        text: 'Shared with the practice. Colleagues pick this up within about 15 minutes, or on their next browser start.',
        action: null,
      };
    }
    if (!hasHandle && s.lastPulledVersion) {
      return {
        kind: 'shared-ro',
        text: 'Showing the practice set. Edits on this computer stay local until you can write to the shared folder.',
        action: 'share',
      };
    }
    if (result === 'permission-not-granted') {
      return {
        kind: 'warn',
        text: 'Shared folder needs reconnecting before edits reach everyone.',
        action: 'reconnect',
      };
    }
    if (result === 'write-failed' || result === 'read-failed' || result === 'verify-failed') {
      const detail = s.lastError ? ` (${s.lastError})` : '';
      return {
        kind: 'err',
        text: `Couldn't update the shared set${detail}. This computer still has your edits.`,
        action: 'retry',
      };
    }
    if (result === 'no-shared-profile') {
      return {
        kind: 'local',
        text: 'No practice profile file yet. Share with the practice and save it as practice-profile.json next to the extension (same folder as manifest.json).',
        action: 'share',
      };
    }
    return {
      kind: 'local',
      text: 'Only on this computer. Share with the practice so colleagues and your other machines see the same set.',
      action: 'share',
    };
  }

  async function applyKnowledgeFromProfile(profile, deps) {
    const spec = knowledgeApplySpec(profile);
    if (!spec) return { applied: false, reason: 'not-in-profile' };
    if (spec.mode !== 'replace') return { applied: false, reason: 'merge-deferred' };
    const importFn = deps && deps.knowledgeImport;
    if (!importFn) return { applied: false, reason: 'no-import' };

    const state = deps.getState ? await deps.getState() : null;
    if (state && spec.profileVersion && state.lastPulledVersion === spec.profileVersion) {
      return { applied: false, reason: 'already-applied' };
    }

    const payload = {};
    if (spec.items !== undefined) payload.items = spec.items;
    if (spec.categories !== undefined) payload.categories = spec.categories;
    if (!Object.keys(payload).length) return { applied: false, reason: 'empty' };

    await importFn(payload);
    if (deps.setState) {
      await deps.setState({
        lastPulledVersion: spec.profileVersion,
        lastPulledAt: (deps.now ? deps.now() : new Date()).toISOString(),
      });
    }
    return { applied: true, version: spec.profileVersion };
  }

  async function runKnowledgeSync(deps) {
    const now = deps.now ? deps.now() : new Date();
    const handle = await deps.loadHandle();
    if (!handle) return { ran: false, reason: 'no-handle' };

    let perm;
    try {
      perm = await handle.queryPermission({ mode: 'readwrite' });
    } catch (e) {
      return { ran: false, reason: 'permission-check-failed', error: e && e.message };
    }
    if (perm !== 'granted' && deps.requestPermission) {
      try {
        perm = await handle.requestPermission({ mode: 'readwrite' });
      } catch (e) {
        return { ran: false, reason: 'permission-not-granted', error: e && e.message };
      }
    }
    if (perm !== 'granted') return { ran: false, reason: 'permission-not-granted' };

    let fileText = '';
    try {
      fileText = await deps.readHandleText(handle);
    } catch (e) {
      return { ran: false, reason: 'read-failed', error: e && e.message };
    }

    let sharedProfile = null;
    if (fileText && String(fileText).trim()) {
      const verify = verifyProfileFile(fileText, deps.fetchedProfile || null);
      if (verify.ok) {
        sharedProfile = verify.profile;
      } else if (!deps.allowCreate) {
        return { ran: false, reason: 'verify-failed', detail: verify.reason };
      }
    } else if (!deps.allowCreate) {
      return { ran: false, reason: 'no-shared-profile' };
    }

    if (sharedProfile && deps.fetchProfile) {
      const fetched = await deps.fetchProfile();
      if (fetched && fetched.profileVersion && fetched.profileVersion !== sharedProfile.profileVersion) {
        return { ran: false, reason: 'stale-read' };
      }
    }

    const local = await deps.getLocalKnowledge();
    const version = nextProfileVersion(sharedProfile, _todayStr(now));
    const result = buildKnowledgeContribution(sharedProfile, local, {
      version,
      now,
      KU: deps.KU,
      allowCreate: !!deps.allowCreate,
    });

    if (result.skipReason) {
      if (deps.setState) {
        await deps.setState({ lastResult: result.skipReason, lastError: null });
      }
      return { ran: true, wrote: false, reason: result.skipReason };
    }

    try {
      await deps.writeHandleText(handle, JSON.stringify(result.json, null, 2));
    } catch (e) {
      if (deps.setState) {
        await deps.setState({ lastResult: 'write-failed', lastError: e && e.message });
      }
      return { ran: true, wrote: false, reason: 'write-failed', error: e && e.message };
    }

    if (deps.setState) {
      await deps.setState({
        lastResult: 'pushed',
        lastError: null,
        lastPushedAt: now.toISOString(),
        lastPushedVersion: version,
        lastPulledVersion: version,
      });
    }
    return { ran: true, wrote: true, version, json: result.json };
  }

  async function _defaultFetchProfile() {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) return null;
      const resp = await fetch(chrome.runtime.getURL('practice-profile.json'), { cache: 'no-store' });
      if (!resp.ok) return null;
      const profile = await resp.json();
      if (profile.format !== 'medicus-suite-practice-profile') return null;
      if (!profile.profileVersion || !profile.envelope) return null;
      return profile;
    } catch (_) {
      return null;
    }
  }

  async function _defaultLoadHandle() {
    const store = typeof self !== 'undefined' ? self.FsHandleStore : null;
    if (!store || !store.loadFileHandle) return null;
    return (await store.loadFileHandle('profileFile')) || (await store.loadFileHandle('pdcContribFile'));
  }

  async function _defaultGetState() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return null;
    const r = await chrome.storage.local.get(KNOWLEDGE_SYNC_STATE_KEY);
    return r[KNOWLEDGE_SYNC_STATE_KEY] || null;
  }

  async function _defaultSetState(patch) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const r = await chrome.storage.local.get(KNOWLEDGE_SYNC_STATE_KEY);
    await chrome.storage.local.set({
      [KNOWLEDGE_SYNC_STATE_KEY]: Object.assign({}, r[KNOWLEDGE_SYNC_STATE_KEY] || {}, patch),
    });
  }

  function browserDeps(overrides) {
    const exportFn =
      (typeof global !== 'undefined' && global.knowledgeExport) ||
      (typeof self !== 'undefined' && self.knowledgeExport) ||
      null;
    const importFn =
      (typeof global !== 'undefined' && global.knowledgeImport) ||
      (typeof self !== 'undefined' && self.knowledgeImport) ||
      null;
    return Object.assign(
      {
        loadHandle: _defaultLoadHandle,
        readHandleText: async (h) => (await h.getFile()).text(),
        writeHandleText: async (h, text) => {
          const w = await h.createWritable();
          await w.write(text);
          await w.close();
        },
        fetchProfile: _defaultFetchProfile,
        getLocalKnowledge: () => (exportFn ? exportFn() : { items: [], categories: [] }),
        knowledgeImport: importFn,
        KU: _resolveKU(null),
        getState: _defaultGetState,
        setState: _defaultSetState,
      },
      overrides || {}
    );
  }

  async function pushLiveKnowledge(overrides) {
    return runKnowledgeSync(browserDeps(overrides));
  }

  async function pullSharedKnowledge(overrides) {
    const deps = browserDeps(overrides);
    const profile = deps.fetchProfile ? await deps.fetchProfile() : null;
    if (!profile) return { applied: false, reason: 'no-profile' };
    return applyKnowledgeFromProfile(profile, deps);
  }

  const api = {
    KNOWLEDGE_SYNC_STATE_KEY,
    nextProfileVersion,
    verifyProfileFile,
    sanitiseSharedKnowledge,
    withKnowledgeReplace,
    buildKnowledgeContribution,
    knowledgeApplySpec,
    describeSyncStatus,
    applyKnowledgeFromProfile,
    runKnowledgeSync,
    browserDeps,
    pushLiveKnowledge,
    pullSharedKnowledge,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof self !== 'undefined') {
    self.KnowledgeSync = api;
  }
})();
