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
//   - never writes suite.practiceProfile.publisher;
//   - reads and writes the remembered `profileFile` handle only (never the
//     Cleanup Code Preferences contributor handle).
//
// Version gates: a push is refused unless the on-disk profileVersion equals
// lastPulledVersion (this machine is based on that file). A pull/apply is
// refused if the incoming version is older than lastPulled/lastPushed.
// allowCreate is only for an empty/missing file — a corrupt non-empty file
// always aborts verify-failed rather than being replaced with a knowledge-only
// profile that would strip other modules.
//
// Residuals (documented, not fixed here): whole-set last-writer-wins across
// concurrent Knowledge editors; cross-module TOCTOU on the shared file
// without a true lock; a home PC without the shared folder stays local until
// Share or Import of a Save backup.
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
  const PROFILE_FILE_KEY = 'profileFile';

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

  function isOlderProfileVersion(incoming, baseline) {
    const a = _parseVersion(incoming);
    const b = _parseVersion(baseline);
    if (!a || !b) return false;
    if (a.date !== b.date) return a.date < b.date;
    return a.seq < b.seq;
  }

  function isNewerProfileVersion(incoming, baseline) {
    const a = _parseVersion(incoming);
    const b = _parseVersion(baseline);
    if (!a || !b) return false;
    if (a.date !== b.date) return a.date > b.date;
    return a.seq > b.seq;
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

  function isEmptyProfileText(text) {
    return !text || !String(text).trim();
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
    const dropped = [];
    for (const e of (localExport && localExport.items) || []) {
      const errs = utils.validateEntry(e);
      if (errs.length > 0) {
        dropped.push({ title: (e && e.title) || '?', errors: errs });
        continue;
      }
      const clean = utils.sanitiseEntry(e);
      if (!clean.id || taken.has(clean.id)) clean.id = utils.generateEntryId(clean.title, taken);
      taken.add(clean.id);
      items.push(clean);
    }
    const categories = utils.sanitiseCategories(localExport && localExport.categories);
    return { items, categories, dropped };
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

  function sharedHasKnowledge(sharedProfile) {
    const km = sharedProfile && sharedProfile.envelope && sharedProfile.envelope.modules && sharedProfile.envelope.modules.knowledge;
    return !!(km && typeof km === 'object');
  }

  // Never push a live set that is not based on the on-disk profileVersion.
  function canPushAgainstShared(sharedProfile, state) {
    if (!sharedProfile) return { ok: true };
    const sharedVer = sharedProfile.profileVersion;
    const lastPulled = state && state.lastPulledVersion;
    const lastPushed = state && state.lastPushedVersion;
    if (lastPulled && sharedVer !== lastPulled) {
      return { ok: false, reason: 'conflict', detail: sharedVer };
    }
    if (!lastPulled && lastPushed && sharedVer !== lastPushed) {
      return { ok: false, reason: 'conflict', detail: sharedVer };
    }
    if (!lastPulled && !lastPushed && sharedHasKnowledge(sharedProfile)) {
      return { ok: false, reason: 'conflict', detail: sharedVer };
    }
    return { ok: true };
  }

  function shouldApplyIncomingVersion(incomingVersion, state) {
    if (!incomingVersion) return { apply: false, reason: 'no-version' };
    const lastPulled = state && state.lastPulledVersion;
    const lastPushed = state && state.lastPushedVersion;
    if (lastPulled && incomingVersion === lastPulled) return { apply: false, reason: 'already-applied' };
    if (lastPulled && isOlderProfileVersion(incomingVersion, lastPulled)) {
      return { apply: false, reason: 'older-version' };
    }
    if (lastPushed && isOlderProfileVersion(incomingVersion, lastPushed)) {
      return { apply: false, reason: 'older-version' };
    }
    if (lastPulled && !isNewerProfileVersion(incomingVersion, lastPulled) && incomingVersion !== lastPulled) {
      // Unorderable vs lastPulled — do not roll back.
      return { apply: false, reason: 'older-version' };
    }
    return { apply: true };
  }

  function shouldSkipKnowledgeReload(editingId) {
    return editingId != null;
  }

  function buildKnowledgeContribution(sharedProfile, localKnowledgeExport, opts) {
    const options = opts || {};
    const KU = _resolveKU(options.KU);
    const sanitised = sanitiseSharedKnowledge(localKnowledgeExport || {}, KU);
    if (sanitised.dropped.length > 0 && !options.allowDropped) {
      return { skipReason: 'invalid-entries', dropped: sanitised.dropped };
    }
    const payload = { items: sanitised.items, categories: sanitised.categories };
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
    const KU = _resolveKU(null);
    const categories =
      km.categories !== undefined
        ? km.categories
        : KU
          ? KU.sanitiseCategories([])
          : [];
    return {
      mode,
      items: Array.isArray(km.items) ? km.items : [],
      categories,
      profileVersion: profile.profileVersion || null,
      publishedAt: profile.publishedAt || null,
    };
  }

  function shareErrorText(reason, detail) {
    switch (reason) {
      case 'stale-read':
        return 'Someone else updated the shared file just now. Reopen Knowledge, then try again.';
      case 'conflict':
        return 'The practice set has changed since this computer last loaded it. Reopen Knowledge before sharing, or you will overwrite their work.';
      case 'verify-failed':
        return (
          'The shared file is not a valid practice profile. Check you picked practice-profile.json next to manifest.json' +
          (detail ? ` (${detail})` : '') +
          '.'
        );
      case 'invalid-entries':
        return `${typeof detail === 'number' ? detail : 'Some'} entries could not be shared because they are invalid. Fix them and try again.`;
      case 'older-version':
        return 'The shared file is older than what this computer already has. Not replacing your set.';
      case 'read-back-failed':
        return 'Wrote the file but could not confirm it landed. Check the shared folder and try again.';
      case 'permission-not-granted':
        return 'Shared folder needs reconnecting before edits reach everyone.';
      case 'no-handle':
        return 'Only on this computer. Share with the practice so colleagues see the same set. At home, Import a Save backup from the surgery computer.';
      case 'no-shared-profile':
        return 'No practice profile file yet. Share with the practice and save it as practice-profile.json next to manifest.json.';
      case 'edit-dirty':
        return 'Finish or cancel the open entry before reloading the practice set.';
      case 'write-failed':
      case 'read-failed':
        return `Couldn't update the shared set${detail ? ` (${detail})` : ''}. This computer still has your edits.`;
      default:
        return detail ? String(detail) : null;
    }
  }

  function describeSyncStatus(state) {
    const s = state || {};
    const hasHandle = s.hasHandle === true;
    const result = s.lastResult || null;
    const mapped = shareErrorText(result, s.lastError || s.droppedCount);

    if (
      !s.lastPulledVersion &&
      (s.profilePending || (s.hasSharedProfile && !hasHandle && s.localCount === 0))
    ) {
      return {
        kind: 'pending',
        text: 'The practice set is not loaded yet. Wait a moment or reopen Knowledge — do not re-import.',
        action: null,
      };
    }
    if (hasHandle && (result === 'pushed' || result === 'no-change')) {
      return {
        kind: 'shared',
        text: 'Shared with the practice. Written to the shared folder as practice-profile.json. Colleagues pick this up within about 15 minutes, or on their next browser start.',
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
      return { kind: 'warn', text: mapped, action: 'reconnect' };
    }
    if (
      result === 'write-failed' ||
      result === 'read-failed' ||
      result === 'verify-failed' ||
      result === 'stale-read' ||
      result === 'conflict' ||
      result === 'invalid-entries' ||
      result === 'read-back-failed'
    ) {
      return { kind: 'err', text: mapped, action: 'retry' };
    }
    if (result === 'no-shared-profile') {
      return { kind: 'local', text: mapped, action: 'share' };
    }
    return {
      kind: 'local',
      text: 'Only on this computer. Share with the practice so colleagues see the same set. At home, Import a Save backup from the surgery computer.',
      action: 'share',
    };
  }

  async function applyKnowledgeFromProfile(profile, deps) {
    if (deps && deps.isEditing && deps.isEditing()) {
      return { applied: false, reason: 'edit-dirty' };
    }
    const spec = knowledgeApplySpec(profile);
    if (!spec) return { applied: false, reason: 'not-in-profile' };
    if (spec.mode !== 'replace') return { applied: false, reason: 'merge-deferred' };
    const importFn = deps && deps.knowledgeImport;
    if (!importFn) return { applied: false, reason: 'no-import' };

    const state = deps.getState ? await deps.getState() : null;
    const gate = shouldApplyIncomingVersion(spec.profileVersion, state);
    if (!gate.apply) return { applied: false, reason: gate.reason };

    const KU = _resolveKU(deps && deps.KU);
    const categories =
      spec.categories !== undefined
        ? spec.categories
        : KU
          ? KU.sanitiseCategories([])
          : [];
    await importFn({ items: spec.items, categories });
    if (deps.setState) {
      await deps.setState({
        lastPulledVersion: spec.profileVersion,
        lastPulledAt: (deps.now ? deps.now() : new Date()).toISOString(),
      });
    }
    return { applied: true, version: spec.profileVersion };
  }

  async function writeHandleVerified(handle, text, deps) {
    if (deps.writeHandleAtomic) {
      await deps.writeHandleAtomic(handle, text);
    } else if (typeof handle.getParent === 'function') {
      try {
        const dir = await handle.getParent();
        const tmpName = (handle.name || 'practice-profile.json') + '.tmp';
        const tmp = await dir.getFileHandle(tmpName, { create: true });
        const w = await tmp.createWritable();
        await w.write(text);
        await w.close();
        const w2 = await handle.createWritable();
        await w2.write(text);
        await w2.close();
        try {
          await dir.removeEntry(tmpName);
        } catch (_) {
          /* leftover tmp is harmless */
        }
      } catch (_) {
        await deps.writeHandleText(handle, text);
      }
    } else {
      await deps.writeHandleText(handle, text);
    }
    const readBack = await deps.readHandleText(handle);
    if (readBack !== text) {
      const err = new Error('read-back mismatch');
      err.code = 'read-back-failed';
      throw err;
    }
  }

  async function runKnowledgeSync(deps, _loop) {
    const loop = _loop || { staleRetries: 0 };
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
    if (!isEmptyProfileText(fileText)) {
      const verify = verifyProfileFile(fileText, deps.fetchedProfile || null);
      if (!verify.ok) {
        if (deps.setState) await deps.setState({ lastResult: 'verify-failed', lastError: verify.reason });
        return { ran: false, reason: 'verify-failed', detail: verify.reason };
      }
      sharedProfile = verify.profile;
    } else if (!deps.allowCreate) {
      return { ran: false, reason: 'no-shared-profile' };
    }

    if (sharedProfile && deps.fetchProfile) {
      const fetched = await deps.fetchProfile();
      if (fetched && fetched.profileVersion && fetched.profileVersion !== sharedProfile.profileVersion) {
        if (loop.staleRetries < 1) {
          return runKnowledgeSync(deps, { staleRetries: loop.staleRetries + 1 });
        }
        if (deps.setState) await deps.setState({ lastResult: 'stale-read', lastError: null });
        return { ran: false, reason: 'stale-read' };
      }
    }

    const state = deps.getState ? await deps.getState() : null;
    const gate = canPushAgainstShared(sharedProfile, state);
    if (!gate.ok) {
      if (deps.setState) await deps.setState({ lastResult: gate.reason, lastError: gate.detail || null });
      return { ran: false, reason: gate.reason, detail: gate.detail };
    }

    const local = await deps.getLocalKnowledge();
    const version = nextProfileVersion(sharedProfile, _todayStr(now));
    const result = buildKnowledgeContribution(sharedProfile, local, {
      version,
      now,
      KU: deps.KU,
      allowCreate: !!deps.allowCreate && !sharedProfile,
    });

    if (result.skipReason === 'invalid-entries') {
      if (deps.setState) {
        await deps.setState({ lastResult: 'invalid-entries', lastError: null, droppedCount: result.dropped.length });
      }
      return { ran: true, wrote: false, reason: 'invalid-entries', dropped: result.dropped };
    }

    if (result.skipReason) {
      if (deps.setState) {
        await deps.setState({ lastResult: result.skipReason, lastError: null });
      }
      return { ran: true, wrote: false, reason: result.skipReason };
    }

    const jsonStr = JSON.stringify(result.json, null, 2);
    try {
      await writeHandleVerified(handle, jsonStr, deps);
    } catch (e) {
      const reason = e && e.code === 'read-back-failed' ? 'read-back-failed' : 'write-failed';
      if (deps.setState) {
        await deps.setState({ lastResult: reason, lastError: e && e.message });
      }
      return { ran: true, wrote: false, reason, error: e && e.message };
    }

    if (deps.setState) {
      await deps.setState({
        lastResult: 'pushed',
        lastError: null,
        lastPushedAt: now.toISOString(),
        lastPushedVersion: version,
        lastPulledVersion: version,
        droppedCount: 0,
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
    return store.loadFileHandle(PROFILE_FILE_KEY);
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

  async function readProfilePreferringHandle(deps) {
    const handle = await deps.loadHandle();
    if (handle) {
      try {
        let perm = 'granted';
        if (handle.queryPermission) {
          perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm !== 'granted') perm = await handle.queryPermission({ mode: 'read' });
        }
        if (perm === 'granted') {
          const text = await deps.readHandleText(handle);
          if (!isEmptyProfileText(text)) {
            const verify = verifyProfileFile(text);
            if (verify.ok) return { profile: verify.profile, from: 'handle' };
            return { profile: null, from: 'handle', verifyFailed: verify.reason };
          }
          return { profile: null, from: 'handle', empty: true };
        }
      } catch (_) {
        /* fall through to getURL */
      }
    }
    const fetched = deps.fetchProfile ? await deps.fetchProfile() : null;
    return { profile: fetched || null, from: fetched ? 'url' : 'none' };
  }

  async function pushLiveKnowledge(overrides) {
    return runKnowledgeSync(browserDeps(overrides));
  }

  async function pullSharedKnowledge(overrides) {
    const deps = browserDeps(overrides);
    if (deps.isEditing && deps.isEditing()) return { applied: false, reason: 'edit-dirty' };
    const read = await readProfilePreferringHandle(deps);
    if (read.verifyFailed) return { applied: false, reason: 'verify-failed', detail: read.verifyFailed };
    if (!read.profile) return { applied: false, reason: 'no-profile' };
    return applyKnowledgeFromProfile(read.profile, deps);
  }

  const api = {
    KNOWLEDGE_SYNC_STATE_KEY,
    PROFILE_FILE_KEY,
    nextProfileVersion,
    isOlderProfileVersion,
    isNewerProfileVersion,
    isEmptyProfileText,
    verifyProfileFile,
    sanitiseSharedKnowledge,
    withKnowledgeReplace,
    canPushAgainstShared,
    shouldApplyIncomingVersion,
    shouldSkipKnowledgeReload,
    buildKnowledgeContribution,
    knowledgeApplySpec,
    shareErrorText,
    describeSyncStatus,
    applyKnowledgeFromProfile,
    writeHandleVerified,
    runKnowledgeSync,
    readProfilePreferringHandle,
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
